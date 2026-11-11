//! 标题生成由桌面进程统一去重；窗口切换和 StrictMode 重建不能重复启动 CLI。
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, Semaphore};

type JobKey = [u8; 32];
type TitleResult = Result<String, String>;
type Waiters = Vec<oneshot::Sender<TitleResult>>;
const MAX_PENDING_JOBS: usize = 16;
const MAX_WAITERS_PER_JOB: usize = 16;
const MAX_CACHED_TITLES: usize = 64;
const CACHE_TTL: Duration = Duration::from_secs(300);

#[derive(Default)]
struct Jobs {
    pending: HashMap<JobKey, Waiters>,
    completed: HashMap<JobKey, (Instant, String)>,
}

struct TitleJobs {
    jobs: Mutex<Jobs>,
    slots: Arc<Semaphore>,
    ttl: Duration,
}

impl TitleJobs {
    fn new(ttl: Duration) -> Arc<Self> {
        Arc::new(Self {
            jobs: Mutex::new(Jobs::default()),
            slots: Arc::new(Semaphore::new(2)),
            ttl,
        })
    }

    async fn request(
        self: &Arc<Self>,
        key: JobKey,
        work: impl FnOnce() -> TitleResult + Send + 'static,
    ) -> TitleResult {
        let (sender, receiver) = oneshot::channel();
        let launch = {
            let mut jobs = self.jobs.lock();
            jobs.completed.retain(|_, (at, _)| at.elapsed() < self.ttl);
            if let Some((_, title)) = jobs.completed.get(&key) {
                return Ok(title.clone());
            }
            if let Some(waiters) = jobs.pending.get_mut(&key) {
                waiters.retain(|waiter| !waiter.is_closed());
                if waiters.len() >= MAX_WAITERS_PER_JOB {
                    return Err("title-generation-busy".into());
                }
                waiters.push(sender);
                false
            } else {
                if jobs.pending.len() >= MAX_PENDING_JOBS {
                    return Err("title-generation-busy".into());
                }
                jobs.pending.insert(key, vec![sender]);
                true
            }
        };
        if launch {
            let coordinator = self.clone();
            // 请求方离开后仍完成已有任务；新的所属窗口可复用结果，不保留窗口句柄。
            tauri::async_runtime::spawn(async move {
                let result = match coordinator.slots.clone().acquire_owned().await {
                    Ok(_permit) => tauri::async_runtime::spawn_blocking(work)
                        .await
                        .map_err(|error| format!("标题生成任务失败: {error}"))
                        .and_then(|result| result),
                    Err(_) => Err("title-generation-busy".into()),
                };
                let waiters = {
                    let mut jobs = coordinator.jobs.lock();
                    if let Ok(title) = &result {
                        if jobs.completed.len() >= MAX_CACHED_TITLES {
                            let oldest = jobs
                                .completed
                                .iter()
                                .min_by_key(|(_, (at, _))| *at)
                                .map(|(key, _)| *key);
                            if let Some(oldest) = oldest {
                                jobs.completed.remove(&oldest);
                            }
                        }
                        jobs.completed.insert(key, (Instant::now(), title.clone()));
                    }
                    jobs.pending.remove(&key).unwrap_or_default()
                };
                for waiter in waiters {
                    let _ = waiter.send(result.clone());
                }
            });
        }
        receiver
            .await
            .map_err(|_| "title-generation-cancelled".to_string())?
    }
}

pub(super) fn request_key(prompt: &str, path: &str) -> JobKey {
    let path = path.replace('\\', "/");
    #[cfg(windows)]
    let path = path.to_lowercase();
    let path = path.trim_end_matches('/');
    let mut hash = Sha256::new();
    hash.update((path.len() as u64).to_le_bytes());
    hash.update(path.as_bytes());
    hash.update(prompt.as_bytes());
    hash.finalize().into()
}

pub(super) async fn generate_once(
    key: JobKey,
    work: impl FnOnce() -> TitleResult + Send + 'static,
) -> TitleResult {
    static COORDINATOR: OnceLock<Arc<TitleJobs>> = OnceLock::new();
    COORDINATOR
        .get_or_init(|| TitleJobs::new(CACHE_TTL))
        .request(key, work)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn concurrent_windows_share_a_job_and_cached_success() {
        let jobs = TitleJobs::new(CACHE_TTL);
        let calls = Arc::new(AtomicUsize::new(0));
        let (release, blocked) = std::sync::mpsc::channel();
        let (started, begun) = oneshot::channel();
        let count = calls.clone();
        let first_jobs = jobs.clone();
        let first = tokio::spawn(async move {
            first_jobs
                .request([1; 32], move || {
                    count.fetch_add(1, Ordering::SeqCst);
                    let _ = started.send(());
                    blocked
                        .recv_timeout(Duration::from_secs(5))
                        .map_err(|e| e.to_string())?;
                    Ok("共享标题".into())
                })
                .await
        });
        begun.await.expect("job started");
        let second_jobs = jobs.clone();
        let second = tokio::spawn(async move {
            second_jobs
                .request([1; 32], || panic!("duplicate work must not run"))
                .await
        });
        while jobs.jobs.lock().pending.get(&[1; 32]).map(Vec::len) != Some(2) {
            tokio::task::yield_now().await;
        }
        release.send(()).expect("release work");
        assert_eq!(first.await.expect("first request"), Ok("共享标题".into()));
        assert_eq!(second.await.expect("second request"), Ok("共享标题".into()));
        assert_eq!(
            jobs.request([1; 32], || panic!("cache hit")).await,
            Ok("共享标题".into())
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(jobs.jobs.lock().pending.is_empty());
    }

    #[tokio::test]
    async fn failure_can_retry_and_expired_results_do_not_accumulate() {
        let jobs = TitleJobs::new(Duration::ZERO);
        assert!(jobs
            .request([2; 32], || Err("offline".into()))
            .await
            .is_err());
        assert_eq!(
            jobs.request([2; 32], || Ok("重试标题".into())).await,
            Ok("重试标题".into())
        );
        assert_eq!(
            jobs.request([2; 32], || Ok("更新标题".into())).await,
            Ok("更新标题".into())
        );
        assert_eq!(jobs.jobs.lock().completed.len(), 1);
    }

    #[tokio::test]
    async fn completed_results_have_a_hard_entry_limit() {
        let jobs = TitleJobs::new(CACHE_TTL);
        for index in 0..MAX_CACHED_TITLES + 3 {
            assert!(jobs
                .request([index as u8; 32], || Ok("标题".into()))
                .await
                .is_ok());
        }
        assert_eq!(jobs.jobs.lock().completed.len(), MAX_CACHED_TITLES);
    }

    #[tokio::test]
    async fn a_closed_window_does_not_cancel_shared_work_or_consume_a_waiter_slot() {
        let jobs = TitleJobs::new(CACHE_TTL);
        let (release, blocked) = std::sync::mpsc::channel();
        let (started, begun) = oneshot::channel();
        let first_jobs = jobs.clone();
        let first = tokio::spawn(async move {
            first_jobs
                .request([5; 32], move || {
                    let _ = started.send(());
                    blocked
                        .recv_timeout(Duration::from_secs(5))
                        .map_err(|error| error.to_string())?;
                    Ok("窗口交接后的标题".into())
                })
                .await
        });
        begun.await.expect("work started");
        first.abort();
        assert!(first.await.expect_err("window left").is_cancelled());
        let second_jobs = jobs.clone();
        let second = tokio::spawn(async move {
            second_jobs
                .request([5; 32], || panic!("shared work must not restart"))
                .await
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let ready = jobs
                    .jobs
                    .lock()
                    .pending
                    .get(&[5; 32])
                    .is_some_and(|waiters| waiters.len() == 1 && !waiters[0].is_closed());
                if ready {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("new window joined");
        release.send(()).expect("release work");
        assert_eq!(
            second.await.expect("new window result"),
            Ok("窗口交接后的标题".into())
        );
        assert!(jobs.jobs.lock().pending.is_empty());
    }

    #[tokio::test]
    async fn the_pending_job_budget_rejects_new_work_before_spawning_it() {
        let jobs = TitleJobs::new(CACHE_TTL);
        let mut receivers = Vec::new();
        for index in 0..MAX_PENDING_JOBS {
            let (sender, receiver) = oneshot::channel();
            receivers.push(receiver);
            jobs.jobs
                .lock()
                .pending
                .insert([index as u8; 32], vec![sender]);
        }
        assert_eq!(
            jobs.request([255; 32], || panic!("budget must reject work"))
                .await,
            Err("title-generation-busy".into())
        );
        assert_eq!(jobs.jobs.lock().pending.len(), MAX_PENDING_JOBS);
    }

    #[test]
    fn title_identity_includes_project_and_prompt() {
        assert_ne!(request_key("a", "D:/one"), request_key("a", "D:/two"));
        assert_ne!(request_key("a", "D:/one"), request_key("b", "D:/one"));
        assert_eq!(request_key("a", "D:/one/"), request_key("a", "D:\\one"));
    }
}
