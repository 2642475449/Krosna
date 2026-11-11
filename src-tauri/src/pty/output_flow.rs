use super::output_transport::emit_pty_event;
use parking_lot::{Condvar, Mutex};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

// 每个窗口的所有终端共用在途预算，覆盖 IPC 与 xterm 解析队列。
pub const OUTPUT_WINDOW_BYTES: usize = 256 * 1024;
const OUTPUT_WINDOW_MESSAGES: usize = 128;

#[derive(Default)]
struct Pending {
    next_id: u64,
    bytes: usize,
    messages: HashMap<u64, usize>,
    closed: bool,
}

pub struct OutputFlow {
    pub subscription_id: String,
    pending: Mutex<Pending>,
    available: Condvar,
}

impl OutputFlow {
    pub fn new(subscription_id: String) -> Self {
        Self {
            subscription_id,
            pending: Mutex::new(Pending::default()),
            available: Condvar::new(),
        }
    }

    pub fn reserve(&self, bytes: usize, cancelled: &AtomicBool) -> Option<u64> {
        if bytes > OUTPUT_WINDOW_BYTES {
            return None;
        }
        let mut pending = self.pending.lock();
        loop {
            if pending.closed || cancelled.load(Ordering::Acquire) {
                return None;
            }
            if pending.bytes + bytes <= OUTPUT_WINDOW_BYTES
                && pending.messages.len() < OUTPUT_WINDOW_MESSAGES
            {
                pending.next_id += 1;
                let id = pending.next_id;
                pending.messages.insert(id, bytes);
                pending.bytes += bytes;
                return Some(id);
            }
            // 会话关闭不依赖 WebView 再回 ACK；最多 50ms 后结束此发送者的等待。
            self.available
                .wait_for(&mut pending, Duration::from_millis(50));
        }
    }

    pub fn acknowledge(&self, id: u64) {
        let mut pending = self.pending.lock();
        if let Some(bytes) = pending.messages.remove(&id) {
            pending.bytes -= bytes;
            self.available.notify_all();
        }
    }

    pub fn close(&self) {
        let mut pending = self.pending.lock();
        pending.closed = true;
        pending.messages.clear();
        pending.bytes = 0;
        self.available.notify_all();
    }

    #[allow(dead_code)] // 独立 WebView 内存回归宿主读取，不向生产 IPC 暴露。
    fn pending_counts(&self) -> (usize, usize) {
        let pending = self.pending.lock();
        (pending.bytes, pending.messages.len())
    }
}

#[derive(Serialize, Clone)]
pub struct PtyOutputPayload {
    pub session_id: String,
    pub data: String,
    pub subscription_id: String,
    pub delivery_id: u64,
}

#[derive(Serialize, Clone)]
pub struct PtyExitPayload {
    pub session_id: String,
    pub code: Option<i32>,
}

#[derive(Default)]
pub struct OutputHub {
    subscribers: Mutex<HashMap<String, Arc<OutputFlow>>>,
}

impl OutputHub {
    #[allow(dead_code)] // 独立 WebView 内存回归宿主读取，不向生产 IPC 暴露。
    pub fn pending_counts(&self) -> (usize, usize) {
        self.subscribers
            .lock()
            .values()
            .map(|flow| flow.pending_counts())
            .fold((0, 0), |sum, value| (sum.0 + value.0, sum.1 + value.1))
    }
    pub fn subscribe_output(&self, window: &str, subscription_id: String) -> Result<(), String> {
        if subscription_id.is_empty() || subscription_id.len() > 128 {
            return Err("Invalid PTY output subscription".into());
        }
        let previous = self.subscribers.lock().insert(
            window.to_string(),
            Arc::new(OutputFlow::new(subscription_id)),
        );
        if let Some(previous) = previous {
            previous.close();
        }
        Ok(())
    }

    pub fn unsubscribe_output(&self, window: &str, subscription_id: Option<&str>) {
        let mut subscribers = self.subscribers.lock();
        if subscribers
            .get(window)
            .is_some_and(|flow| subscription_id.is_none_or(|id| id == flow.subscription_id))
        {
            if let Some(flow) = subscribers.remove(window) {
                flow.close();
            }
        }
    }

    pub fn acknowledge_output(&self, window: &str, subscription_id: &str, delivery_id: u64) {
        if let Some(flow) = self.subscribers.lock().get(window).cloned() {
            if flow.subscription_id == subscription_id {
                flow.acknowledge(delivery_id);
            }
        }
    }

    pub fn send_output(
        &self,
        app: &AppHandle,
        session_id: &str,
        data: &str,
        cancelled: &AtomicBool,
    ) {
        let subscribers: Vec<_> = self
            .subscribers
            .lock()
            .iter()
            .map(|(window, flow)| (window.clone(), flow.clone()))
            .collect();
        for (label, flow) in subscribers {
            let Some(window) = app.get_webview_window(&label) else {
                self.unsubscribe_output(&label, Some(&flow.subscription_id));
                continue;
            };
            let Some(delivery_id) = flow.reserve(data.len(), cancelled) else {
                continue;
            };
            if let Err(error) = emit_pty_event(
                &window,
                "pty-output",
                PtyOutputPayload {
                    session_id: session_id.to_string(),
                    data: data.to_string(),
                    subscription_id: flow.subscription_id.clone(),
                    delivery_id,
                },
            ) {
                log::warn!("Failed to deliver PTY output for {session_id}: {error}");
                self.unsubscribe_output(&label, Some(&flow.subscription_id));
            }
        }
    }

    pub fn send_exit(&self, app: &AppHandle, payload: PtyExitPayload) {
        let labels: Vec<_> = self.subscribers.lock().keys().cloned().collect();
        for label in labels {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = emit_pty_event(&window, "pty-exit", payload.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};

    #[test]
    fn stale_ack_and_unsubscribe_cannot_release_a_replacement_subscription() {
        let hub = OutputHub::default();
        hub.subscribe_output("main", "old".into()).unwrap();
        let old = hub.subscribers.lock()["main"].clone();
        old.reserve(64, &AtomicBool::new(false)).unwrap();
        hub.subscribe_output("main", "new".into()).unwrap();
        assert_eq!(old.pending_counts(), (0, 0));
        assert_eq!(old.reserve(1, &AtomicBool::new(false)), None);
        let current = hub.subscribers.lock()["main"].clone();
        let id = current.reserve(64, &AtomicBool::new(false)).unwrap();
        hub.acknowledge_output("main", "old", id);
        hub.unsubscribe_output("main", Some("old"));
        assert_eq!(hub.pending_counts(), (64, 1));
        hub.acknowledge_output("main", "new", id);
        assert_eq!(hub.pending_counts(), (0, 0));
        hub.unsubscribe_output("main", None);
        assert!(hub.subscribers.lock().is_empty());
    }

    #[test]
    fn parser_acknowledgements_bound_sustained_output_and_release_all_credits() {
        let flow = Arc::new(OutputFlow::new("window".into()));
        let (send, receive) = mpsc::channel();
        let producer = flow.clone();
        let worker = std::thread::spawn(move || {
            for _ in 0..4096 {
                let id = producer
                    .reserve(64 * 1024, &AtomicBool::new(false))
                    .unwrap();
                assert!(producer.pending.lock().bytes <= OUTPUT_WINDOW_BYTES);
                send.send(id).unwrap();
            }
        });
        let first: Vec<_> = (0..4).map(|_| receive.recv().unwrap()).collect();
        assert!(receive.recv_timeout(Duration::from_millis(80)).is_err());
        for id in first.into_iter().rev() {
            flow.acknowledge(id);
            flow.acknowledge(id);
        }
        for id in receive {
            flow.acknowledge(id);
        }
        worker.join().unwrap();
        assert_eq!(flow.pending.lock().bytes, 0);
        assert!(flow.pending.lock().messages.is_empty());
    }

    #[test]
    fn closing_a_window_or_session_unblocks_a_full_sender() {
        for close_window in [true, false] {
            let flow = Arc::new(OutputFlow::new("window".into()));
            let cancelled = Arc::new(AtomicBool::new(false));
            flow.reserve(OUTPUT_WINDOW_BYTES, &cancelled).unwrap();
            let worker_flow = flow.clone();
            let worker_cancelled = cancelled.clone();
            let (send, receive) = mpsc::channel();
            let worker = std::thread::spawn(move || {
                send.send(worker_flow.reserve(1, &worker_cancelled))
                    .unwrap();
            });
            if close_window {
                flow.close();
            } else {
                cancelled.store(true, Ordering::Release);
            }
            assert_eq!(receive.recv_timeout(Duration::from_secs(1)).unwrap(), None);
            worker.join().unwrap();
            flow.close();
            assert_eq!(flow.pending.lock().bytes, 0);
        }
    }

    #[test]
    fn small_messages_are_bounded_and_unknown_ack_cannot_grant_credit() {
        let flow = OutputFlow::new("window".into());
        for _ in 0..OUTPUT_WINDOW_MESSAGES {
            flow.reserve(1, &AtomicBool::new(false)).unwrap();
        }
        flow.acknowledge(u64::MAX);
        assert_eq!(flow.pending.lock().messages.len(), OUTPUT_WINDOW_MESSAGES);
        flow.close();
        assert_eq!(flow.reserve(1, &AtomicBool::new(false)), None);
    }
}
