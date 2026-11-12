use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tempfile::{NamedTempFile, TempDir};

const MAX_SNAPSHOT_BYTES: usize = 32 * 1024 * 1024;
const MAX_CACHE_BYTES: usize = 256 * 1024 * 1024;
const MAX_CACHE_ENTRIES: usize = 256;

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunnerOutputSelection {
    pub start_column: u32,
    pub start_row: u32,
    pub end_column: u32,
    pub end_row: u32,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunnerOutputSnapshot {
    pub version: u8,
    pub data: String,
    pub cols: u16,
    pub rows: u16,
    pub viewport_y: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scrollback: Option<u32>,
    pub selection: Option<RunnerOutputSelection>,
}

impl RunnerOutputSnapshot {
    fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || !(2..=4096).contains(&self.cols)
            || !(1..=4096).contains(&self.rows)
            || u32::from(self.cols) * u32::from(self.rows) > 1_048_576
            || self
                .scrollback
                .is_some_and(|scrollback| scrollback > 50_000)
        {
            return Err("RUNNER_OUTPUT_INVALID:unsupported version or terminal dimensions".into());
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct CacheLimits {
    snapshot_bytes: usize,
    cache_bytes: usize,
    entries: usize,
}

impl Default for CacheLimits {
    fn default() -> Self {
        Self {
            snapshot_bytes: MAX_SNAPSHOT_BYTES,
            cache_bytes: MAX_CACHE_BYTES,
            entries: MAX_CACHE_ENTRIES,
        }
    }
}

#[derive(Default)]
struct SnapshotCache {
    // 首次保存才创建目录；进程退出由 TempDir 删除，不进入项目或持久化设置。
    directory: Option<TempDir>,
    sizes: HashMap<String, usize>,
    bytes: usize,
    limits: CacheLimits,
    closed: bool,
}

#[derive(Clone, Default)]
pub struct RunnerOutputSnapshots {
    cache: Arc<Mutex<SnapshotCache>>,
}

impl RunnerOutputSnapshots {
    pub fn cleanup(&self) -> Result<(), String> {
        self.cache.lock().map_err(io_error)?.cleanup()
    }
}

fn io_error(error: impl std::fmt::Display) -> String {
    format!("RUNNER_OUTPUT_IO:{error}")
}

fn snapshot_key(window_label: &str, session_id: &str) -> Result<String, String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("RUNNER_OUTPUT_INVALID:session id must contain 1-128 ASCII letters, digits, hyphens or underscores".into());
    }
    let mut hash = Sha256::new();
    hash.update(window_label.as_bytes());
    hash.update([0]);
    hash.update(session_id.as_bytes());
    Ok(format!("{:x}.json", hash.finalize()))
}

// 转义后的 JSON 也计入预算；序列化时就停止，避免先创建数倍大小的副本。
struct BoundedJson {
    bytes: Vec<u8>,
    limit: usize,
}

impl Write for BoundedJson {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if buffer.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("snapshot JSON exceeds limit"));
        }
        self.bytes.extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn serialize_snapshot(snapshot: &RunnerOutputSnapshot, limit: usize) -> Result<Vec<u8>, String> {
    snapshot.validate()?;
    if snapshot.data.len() > limit {
        return Err("RUNNER_OUTPUT_TOO_LARGE:snapshot JSON exceeds limit".into());
    }
    let mut writer = BoundedJson {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut writer, snapshot)
        .map_err(|_| "RUNNER_OUTPUT_TOO_LARGE:snapshot JSON exceeds limit".to_string())?;
    Ok(writer.bytes)
}

fn persist_snapshot(temporary: NamedTempFile, destination: &Path) -> Result<(), String> {
    temporary
        .persist(destination)
        .map_err(|error| io_error(error.error))?;
    Ok(())
}

impl SnapshotCache {
    fn save(&mut self, key: String, snapshot: &RunnerOutputSnapshot) -> Result<(), String> {
        self.save_with(key, snapshot, persist_snapshot)
    }

    fn save_with(
        &mut self,
        key: String,
        snapshot: &RunnerOutputSnapshot,
        persist: impl FnOnce(NamedTempFile, &Path) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.closed {
            return Err(io_error("snapshot cache is shutting down"));
        }
        let serialized = serialize_snapshot(snapshot, self.limits.snapshot_bytes)?;
        let previous = self.sizes.get(&key).copied().unwrap_or(0);
        let next_bytes = self.bytes - previous + serialized.len();
        if next_bytes > self.limits.cache_bytes
            || (!self.sizes.contains_key(&key) && self.sizes.len() >= self.limits.entries)
        {
            return Err("RUNNER_OUTPUT_CACHE_FULL:snapshot cache budget exceeded".into());
        }
        if self.directory.is_none() {
            self.directory = Some(
                tempfile::Builder::new()
                    .prefix("krosna-runner-output-")
                    .tempdir()
                    .map_err(io_error)?,
            );
        }
        let directory = self
            .directory
            .as_ref()
            .ok_or_else(|| io_error("snapshot directory unavailable"))?;
        let mut temporary = NamedTempFile::new_in(directory.path()).map_err(io_error)?;
        temporary.write_all(&serialized).map_err(io_error)?;
        temporary.as_file_mut().sync_all().map_err(io_error)?;
        // 同目录原子替换；失败时旧文件、条目与额度均保持原样，不淘汰其他日志。
        persist(temporary, &directory.path().join(&key))?;
        self.sizes.insert(key, serialized.len());
        self.bytes = next_bytes;
        Ok(())
    }

    fn read(&self, key: &str) -> Result<RunnerOutputSnapshot, String> {
        if self.closed {
            return Err(io_error("snapshot cache is shutting down"));
        }
        if !self.sizes.contains_key(key) {
            return Err("RUNNER_OUTPUT_NOT_FOUND:snapshot not found".into());
        }
        let directory = self
            .directory
            .as_ref()
            .ok_or_else(|| io_error("snapshot directory unavailable"))?;
        let file = File::open(directory.path().join(key)).map_err(io_error)?;
        if file.metadata().map_err(io_error)?.len() > self.limits.snapshot_bytes as u64 {
            return Err("RUNNER_OUTPUT_TOO_LARGE:snapshot JSON exceeds limit".into());
        }
        let mut bytes = Vec::new();
        file.take(self.limits.snapshot_bytes as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(io_error)?;
        if bytes.len() > self.limits.snapshot_bytes {
            return Err("RUNNER_OUTPUT_TOO_LARGE:snapshot JSON exceeds limit".into());
        }
        let snapshot: RunnerOutputSnapshot = serde_json::from_slice(&bytes)
            .map_err(|_| "RUNNER_OUTPUT_CORRUPT:invalid snapshot JSON".to_string())?;
        snapshot
            .validate()
            .map_err(|_| "RUNNER_OUTPUT_CORRUPT:invalid snapshot fields".to_string())?;
        Ok(snapshot)
    }

    fn remove(&mut self, key: &str) -> Result<(), String> {
        let Some(size) = self.sizes.get(key).copied() else {
            return Ok(());
        };
        let directory = self
            .directory
            .as_ref()
            .ok_or_else(|| io_error("snapshot directory unavailable"))?;
        match fs::remove_file(directory.path().join(key)) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error(error)),
        }
        self.sizes.remove(key);
        self.bytes -= size;
        Ok(())
    }

    fn cleanup(&mut self) -> Result<(), String> {
        // Tauri 正常退出会直接结束进程，不能仅依赖 managed state 的析构。
        self.closed = true;
        self.sizes.clear();
        self.bytes = 0;
        if let Some(directory) = self.directory.take() {
            directory.close().map_err(io_error)?;
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn save_runner_output(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RunnerOutputSnapshots>,
    session_id: String,
    snapshot: RunnerOutputSnapshot,
) -> Result<(), String> {
    let key = snapshot_key(window.label(), &session_id)?;
    let snapshots = state.inner().clone();
    super::run_background_task("save_runner_output", move || {
        snapshots
            .cache
            .lock()
            .map_err(io_error)?
            .save(key, &snapshot)
    })
    .await
}

#[tauri::command]
pub async fn read_runner_output(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RunnerOutputSnapshots>,
    session_id: String,
) -> Result<RunnerOutputSnapshot, String> {
    let key = snapshot_key(window.label(), &session_id)?;
    let snapshots = state.inner().clone();
    super::run_background_task("read_runner_output", move || {
        snapshots.cache.lock().map_err(io_error)?.read(&key)
    })
    .await
}

#[tauri::command]
pub async fn remove_runner_output(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RunnerOutputSnapshots>,
    session_id: String,
) -> Result<(), String> {
    let key = snapshot_key(window.label(), &session_id)?;
    let snapshots = state.inner().clone();
    super::run_background_task("remove_runner_output", move || {
        snapshots.cache.lock().map_err(io_error)?.remove(&key)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(data: &str) -> RunnerOutputSnapshot {
        RunnerOutputSnapshot {
            version: 1,
            data: data.into(),
            cols: 1024,
            rows: 24,
            viewport_y: 17,
            scrollback: Some(5000),
            selection: Some(RunnerOutputSelection {
                start_column: 1,
                start_row: 2,
                end_column: 3,
                end_row: 4,
            }),
        }
    }

    fn cache(snapshot_bytes: usize, cache_bytes: usize, entries: usize) -> SnapshotCache {
        SnapshotCache {
            limits: CacheLimits {
                snapshot_bytes,
                cache_bytes,
                entries,
            },
            ..Default::default()
        }
    }

    #[test]
    fn lazy_directory_and_missing_read_or_remove_do_not_create_files() {
        let mut cache = SnapshotCache::default();
        let key = snapshot_key("main", "runner-1").expect("key");
        assert!(cache
            .read(&key)
            .expect_err("missing")
            .starts_with("RUNNER_OUTPUT_NOT_FOUND:"));
        cache.remove(&key).expect("idempotent remove");
        assert!(cache.directory.is_none());
        assert_eq!(cache.bytes, 0);
    }

    #[test]
    fn isolates_windows_sessions_and_ambiguous_concatenations() {
        let mut cache = SnapshotCache::default();
        let first = snapshot_key("ab", "c").expect("key");
        let second = snapshot_key("a", "bc").expect("key");
        let third = snapshot_key("ab", "d").expect("key");
        for (key, text) in [(&first, "first"), (&second, "second"), (&third, "third")] {
            cache.save(key.clone(), &snapshot(text)).expect("save");
        }
        assert_eq!(cache.read(&first).expect("read"), snapshot("first"));
        assert_eq!(cache.read(&second).expect("read"), snapshot("second"));
        cache.remove(&first).expect("remove");
        assert_eq!(cache.read(&third).expect("read"), snapshot("third"));
        let same_session_other_window = snapshot_key("other", "c").expect("key");
        assert!(cache.read(&same_session_other_window).is_err());
    }

    #[test]
    fn rejects_invalid_ids_versions_dimensions_and_escaped_json_overflow() {
        for id in [
            "",
            "../runner",
            "a/b",
            "a\\b",
            "a:b",
            "a\0b",
            "a b",
            &"a".repeat(129),
        ] {
            assert!(snapshot_key("main", id)
                .expect_err("invalid id")
                .starts_with("RUNNER_OUTPUT_INVALID:"));
        }
        assert!(snapshot_key("main", &"a".repeat(128)).is_ok());
        for (version, cols, rows) in [
            (0, 80, 24),
            (2, 80, 24),
            (1, 0, 24),
            (1, 1, 24),
            (1, 4097, 24),
            (1, 80, 0),
            (1, 80, 4097),
            (1, 4096, 257),
        ] {
            let mut value = snapshot("text");
            value.version = version;
            value.cols = cols;
            value.rows = rows;
            assert!(serialize_snapshot(&value, 1024)
                .expect_err("invalid fields")
                .starts_with("RUNNER_OUTPUT_INVALID:"));
        }
        let escaped = snapshot(&"\0".repeat(100));
        assert!(escaped.data.len() < 512);
        assert!(serialize_snapshot(&escaped, 512)
            .expect_err("escaped JSON too large")
            .starts_with("RUNNER_OUTPUT_TOO_LARGE:"));
        let mut excessive_history = snapshot("text");
        excessive_history.scrollback = Some(50_001);
        assert!(serialize_snapshot(&excessive_history, 1024)
            .expect_err("history budget")
            .starts_with("RUNNER_OUTPUT_INVALID:"));
        let mut legacy: serde_json::Value = serde_json::to_value(snapshot("legacy")).expect("JSON");
        legacy.as_object_mut().expect("object").remove("scrollback");
        assert_eq!(
            serde_json::from_value::<RunnerOutputSnapshot>(legacy)
                .expect("old schema")
                .scrollback,
            None
        );
    }

    #[test]
    fn replacement_counts_only_new_size_and_delete_restores_capacity() {
        let large = snapshot(&"x".repeat(60));
        let small = snapshot("x");
        let large_size = serialize_snapshot(&large, 1024).expect("serialize").len();
        let small_size = serialize_snapshot(&small, 1024).expect("serialize").len();
        let mut cache = cache(1024, large_size, 1);
        let key = snapshot_key("main", "one").expect("key");
        let other = snapshot_key("main", "two").expect("key");
        cache.save(key.clone(), &large).expect("exact byte budget");
        cache
            .save(key.clone(), &small)
            .expect("replace at entry limit");
        assert_eq!(cache.bytes, small_size);
        assert!(cache
            .save(other.clone(), &small)
            .expect_err("entry limit")
            .starts_with("RUNNER_OUTPUT_CACHE_FULL:"));
        cache.remove(&key).expect("remove");
        cache.remove(&key).expect("remove again");
        assert_eq!(cache.bytes, 0);
        cache.save(other, &large).expect("capacity restored");
        assert_eq!(cache.bytes, large_size);
    }

    #[test]
    fn over_budget_or_failed_atomic_replace_preserves_prior_snapshot_and_accounting() {
        let original = snapshot("retained\u{1b}[31m日志");
        let size = serialize_snapshot(&original, 2048)
            .expect("serialize")
            .len();
        let mut cache = cache(2048, size, 10);
        let key = snapshot_key("main", "one").expect("key");
        cache.save(key.clone(), &original).expect("save");
        assert!(cache
            .save(key.clone(), &snapshot(&"x".repeat(1000)))
            .expect_err("budget")
            .starts_with("RUNNER_OUTPUT_CACHE_FULL:"));
        let failed = cache.save_with(
            key.clone(),
            &snapshot("replacement"),
            |_temporary, _destination| Err(io_error("injected atomic replacement failure")),
        );
        assert!(failed
            .expect_err("replacement failure")
            .starts_with("RUNNER_OUTPUT_IO:"));
        assert_eq!(cache.read(&key).expect("old data"), original);
        assert_eq!(cache.bytes, size);
        assert_eq!(cache.sizes.len(), 1);
        assert_eq!(
            fs::read_dir(cache.directory.as_ref().expect("directory").path())
                .expect("entries")
                .count(),
            1
        );
    }

    #[test]
    fn bounded_reads_reject_oversized_files_corrupt_json_and_invalid_fields() {
        let mut cache = cache(1024, 2048, 2);
        let key = snapshot_key("main", "one").expect("key");
        cache.save(key.clone(), &snapshot("saved")).expect("save");
        let path = cache
            .directory
            .as_ref()
            .expect("directory")
            .path()
            .join(&key);
        File::create(&path)
            .expect("file")
            .set_len(1025)
            .expect("grow");
        assert!(cache
            .read(&key)
            .expect_err("too large")
            .starts_with("RUNNER_OUTPUT_TOO_LARGE:"));
        fs::write(&path, b"invalid JSON").expect("write");
        assert!(cache
            .read(&key)
            .expect_err("corrupt")
            .starts_with("RUNNER_OUTPUT_CORRUPT:"));
        let mut invalid = snapshot("invalid version");
        invalid.version = 2;
        fs::write(&path, serde_json::to_vec(&invalid).expect("serialize")).expect("write");
        assert!(cache
            .read(&key)
            .expect_err("invalid fields")
            .starts_with("RUNNER_OUTPUT_CORRUPT:"));
    }

    #[test]
    fn process_owned_directory_is_removed_on_drop() {
        let path = {
            let mut cache = SnapshotCache::default();
            cache
                .save(
                    snapshot_key("main", "one").expect("key"),
                    &snapshot("saved"),
                )
                .expect("save");
            cache
                .directory
                .as_ref()
                .expect("directory")
                .path()
                .to_path_buf()
        };
        assert!(!path.exists());
    }

    #[test]
    fn exit_cleanup_removes_files_and_prevents_queued_saves_from_recreating_them() {
        let mut cache = SnapshotCache::default();
        let key = snapshot_key("main", "one").expect("key");
        cache.save(key.clone(), &snapshot("saved")).expect("save");
        let path = cache
            .directory
            .as_ref()
            .expect("directory")
            .path()
            .to_path_buf();
        cache.cleanup().expect("cleanup");
        cache.cleanup().expect("idempotent cleanup");
        assert!(!path.exists());
        assert_eq!(cache.bytes, 0);
        assert!(cache.sizes.is_empty());
        assert!(cache
            .read(&key)
            .expect_err("closed read")
            .starts_with("RUNNER_OUTPUT_IO:"));
        assert!(cache
            .save(key, &snapshot("late save"))
            .expect_err("closed")
            .starts_with("RUNNER_OUTPUT_IO:"));
        assert!(cache.directory.is_none());
    }
}
