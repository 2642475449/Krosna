use crate::commands::runner_output::RunnerOutputSnapshot;
use crate::database::{
    workspace_recovery::{project_identity, serialize_bounded},
    Database,
};
use parking_lot::Mutex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_TERMINAL_BYTES: u64 = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const SETTINGS_EVENT: &str = "workspace-restore-settings-changed";
static SNAPSHOT_IO: Mutex<()> = Mutex::new(());
static SETTINGS_WRITE: Mutex<()> = Mutex::new(());

fn io_error(error: impl std::fmt::Display) -> String {
    format!("WORKSPACE_RECOVERY_IO:{error}")
}

fn snapshot_key(project_path: &str, session_id: &str) -> Result<String, String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("WORKSPACE_RECOVERY_INVALID:invalid session id".into());
    }
    let mut hash = Sha256::new();
    hash.update(project_identity(project_path)?.as_bytes());
    hash.update([0]);
    hash.update(session_id.as_bytes());
    Ok(format!("{:x}.json", hash.finalize()))
}

fn snapshot_directory(app_data: &Path, create: bool) -> Result<Option<PathBuf>, String> {
    let directory = app_data.join("workspace-recovery");
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(io_error("snapshot directory is not a regular directory"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(&directory).map_err(io_error)?;
        }
        Err(error) => return Err(io_error(error)),
    }
    let canonical = fs::canonicalize(&directory).map_err(io_error)?;
    let parent = fs::canonicalize(app_data).map_err(io_error)?;
    if canonical.parent() != Some(parent.as_path()) {
        return Err(io_error("snapshot directory escapes application data"));
    }
    Ok(Some(canonical))
}

fn validate_snapshot(snapshot: Value) -> Result<RunnerOutputSnapshot, String> {
    let snapshot: RunnerOutputSnapshot = serde_json::from_value(snapshot)
        .map_err(|_| "WORKSPACE_RECOVERY_INVALID:invalid terminal snapshot".to_string())?;
    if snapshot.version != 1
        || !(2..=4096).contains(&snapshot.cols)
        || !(1..=4096).contains(&snapshot.rows)
        || u32::from(snapshot.cols) * u32::from(snapshot.rows) > 1_048_576
        || snapshot.scrollback.is_some_and(|value| value > 50_000)
    {
        return Err("WORKSPACE_RECOVERY_INVALID:unsupported terminal snapshot".into());
    }
    if snapshot.data.len() as u64 > MAX_TERMINAL_BYTES {
        return Err("WORKSPACE_RECOVERY_TOO_LARGE:terminal exceeds 8 MiB".into());
    }
    Ok(snapshot)
}

fn cache_file_name(name: &str) -> bool {
    name.strip_suffix(".json")
        .is_some_and(|stem| stem.len() == 64 && stem.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

/// 只清理本模块命名的终端画面缓存，不处理目录、符号链接或用户文件。
fn enforce_budget(directory: &Path, current: &Path, limit: u64) -> Result<(), String> {
    let mut entries = Vec::new();
    let mut total = 0_u64;
    for item in fs::read_dir(directory).map_err(io_error)? {
        let item = item.map_err(io_error)?;
        if !item.file_name().to_str().is_some_and(cache_file_name) {
            continue;
        }
        let metadata = fs::symlink_metadata(item.path()).map_err(io_error)?;
        if !metadata.file_type().is_file() {
            continue;
        }
        total = total.saturating_add(metadata.len());
        if item.path() != current {
            entries.push((metadata.modified().ok(), item.path(), metadata.len()));
        }
    }
    entries.sort_by(|first, second| first.0.cmp(&second.0).then_with(|| first.1.cmp(&second.1)));
    for (_, path, bytes) in entries {
        if total <= limit {
            break;
        }
        fs::remove_file(path).map_err(io_error)?;
        total = total.saturating_sub(bytes);
    }
    if total > limit {
        return Err(io_error("terminal cache budget exceeded"));
    }
    Ok(())
}

fn save_terminal(
    app_data: &Path,
    project_path: &str,
    session_id: &str,
    snapshot: Value,
) -> Result<(), String> {
    let key = snapshot_key(project_path, session_id)?;
    let snapshot = validate_snapshot(snapshot)?;
    let serialized = serialize_bounded(&snapshot, MAX_TERMINAL_BYTES as usize)?;
    let _guard = SNAPSHOT_IO.lock();
    let directory = snapshot_directory(app_data, true)?
        .ok_or_else(|| io_error("missing snapshot directory"))?;
    let destination = directory.join(key);
    if fs::symlink_metadata(&destination).is_ok_and(|metadata| !metadata.file_type().is_file()) {
        return Err(io_error("snapshot target is not a regular file"));
    }
    let mut temporary = tempfile::NamedTempFile::new_in(&directory).map_err(io_error)?;
    temporary.write_all(&serialized).map_err(io_error)?;
    temporary.as_file().sync_all().map_err(io_error)?;
    temporary
        .persist(&destination)
        .map_err(|error| io_error(error.error))?;
    enforce_budget(&directory, &destination, MAX_TOTAL_BYTES)
}

fn read_terminal(
    app_data: &Path,
    project_path: &str,
    session_id: &str,
) -> Result<Option<Value>, String> {
    let Ok(key) = snapshot_key(project_path, session_id) else {
        return Ok(None);
    };
    let _guard = SNAPSHOT_IO.lock();
    let Some(directory) = snapshot_directory(app_data, false)? else {
        return Ok(None);
    };
    let path = directory.join(key);
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return Ok(None);
    };
    if !metadata.file_type().is_file() || metadata.len() > MAX_TERMINAL_BYTES {
        return Ok(None);
    }
    let Ok(file) = File::open(path) else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    if file
        .take(MAX_TERMINAL_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() as u64 > MAX_TERMINAL_BYTES
    {
        return Ok(None);
    }
    let snapshot = serde_json::from_slice(&bytes)
        .ok()
        .and_then(|value| validate_snapshot(value).ok());
    Ok(snapshot.and_then(|value| serde_json::to_value(value).ok()))
}

#[tauri::command]
pub async fn get_workspace_restore_enabled(
    database: State<'_, Arc<Database>>,
) -> Result<bool, String> {
    let database = database.inner().clone();
    super::run_background_task("get_workspace_restore_enabled", move || {
        database.get_workspace_restore_enabled()
    })
    .await
}

#[tauri::command]
pub async fn set_workspace_restore_enabled(
    app: AppHandle,
    database: State<'_, Arc<Database>>,
    enabled: bool,
) -> Result<(), String> {
    let database = database.inner().clone();
    super::run_background_task("set_workspace_restore_enabled", move || {
        // 保存与事件同序，避免多个窗口并发切换后旧事件覆盖新设置。
        let _guard = SETTINGS_WRITE.lock();
        database.set_workspace_restore_enabled(enabled)?;
        app.emit(SETTINGS_EVENT, enabled)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn read_workspace_recovery(
    database: State<'_, Arc<Database>>,
    project_path: String,
) -> Result<Option<Value>, String> {
    let database = database.inner().clone();
    super::run_background_task("read_workspace_recovery", move || {
        database.read_workspace_recovery(&project_path)
    })
    .await
}

#[tauri::command]
pub async fn save_workspace_recovery(
    database: State<'_, Arc<Database>>,
    project_path: String,
    payload: Value,
) -> Result<(), String> {
    let database = database.inner().clone();
    super::run_background_task("save_workspace_recovery", move || {
        database.save_workspace_recovery(&project_path, &payload)
    })
    .await
}

#[tauri::command]
pub async fn read_terminal_recovery(
    app: AppHandle,
    project_path: String,
    session_id: String,
) -> Result<Option<Value>, String> {
    let directory = app.path().app_data_dir().map_err(io_error)?;
    super::run_background_task("read_terminal_recovery", move || {
        read_terminal(&directory, &project_path, &session_id)
    })
    .await
}

#[tauri::command]
pub async fn save_terminal_recovery(
    app: AppHandle,
    project_path: String,
    session_id: String,
    snapshot: Value,
) -> Result<(), String> {
    let directory = app.path().app_data_dir().map_err(io_error)?;
    super::run_background_task("save_terminal_recovery", move || {
        save_terminal(&directory, &project_path, &session_id, snapshot)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn snapshot(data: &str) -> Value {
        json!({ "version": 1, "data": data, "cols": 80, "rows": 24, "viewportY": 0, "selection": null })
    }

    #[test]
    fn terminal_recovery_survives_reopening_and_isolates_projects() {
        let app_data = tempfile::tempdir().expect("app data");
        let first = app_data.path().join("first").to_string_lossy().into_owned();
        let second = app_data
            .path()
            .join("second")
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            read_terminal(app_data.path(), &first, "s1").expect("missing"),
            None
        );
        save_terminal(app_data.path(), &first, "s1", snapshot("first")).expect("save first");
        save_terminal(app_data.path(), &second, "s1", snapshot("second")).expect("save second");
        save_terminal(app_data.path(), &first, "s1", snapshot("updated"))
            .expect("replace atomically");
        assert_eq!(
            read_terminal(app_data.path(), &first, "s1").expect("first"),
            Some(snapshot("updated"))
        );
        assert_eq!(
            read_terminal(app_data.path(), &second, "s1").expect("second"),
            Some(snapshot("second"))
        );
    }

    #[test]
    fn corrupt_invalid_and_oversized_terminal_snapshots_do_not_affect_other_sessions() {
        let app_data = tempfile::tempdir().expect("app data");
        let project = app_data.path().to_string_lossy().into_owned();
        save_terminal(app_data.path(), &project, "good", snapshot("keep")).expect("save");
        save_terminal(app_data.path(), &project, "bad", snapshot("corrupt")).expect("save");
        let directory = snapshot_directory(app_data.path(), false)
            .expect("directory")
            .expect("exists");
        fs::write(
            directory.join(snapshot_key(&project, "bad").expect("key")),
            b"broken",
        )
        .expect("corrupt");
        assert_eq!(
            read_terminal(app_data.path(), &project, "bad").expect("corrupt read"),
            None
        );
        assert_eq!(
            read_terminal(app_data.path(), &project, "../bad").expect("invalid read"),
            None
        );
        assert!(save_terminal(app_data.path(), &project, "../bad", snapshot("escape")).is_err());
        let mut unsupported = snapshot("bad version");
        unsupported["version"] = json!(2);
        assert!(save_terminal(app_data.path(), &project, "good", unsupported).is_err());
        assert!(save_terminal(
            app_data.path(),
            &project,
            "good",
            snapshot(&"a".repeat(MAX_TERMINAL_BYTES as usize))
        )
        .is_err());
        assert_eq!(
            read_terminal(app_data.path(), &project, "good").expect("good read"),
            Some(snapshot("keep"))
        );
    }

    #[test]
    fn quota_prunes_old_cache_files_and_preserves_unrelated_files_and_current_snapshot() {
        let directory = tempfile::tempdir().expect("cache");
        let first = directory.path().join(format!("{}.json", "a".repeat(64)));
        let current = directory.path().join(format!("{}.json", "b".repeat(64)));
        fs::write(&first, b"1234").expect("old");
        fs::write(&current, b"5678").expect("current");
        let unrelated = directory.path().join("user.json");
        fs::write(&unrelated, b"user").expect("unrelated");
        enforce_budget(directory.path(), &current, 4).expect("prune");
        assert!(!first.exists());
        assert!(current.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn snapshot_directory_and_file_targets_cannot_replace_unrelated_directories() {
        let app_data = tempfile::tempdir().expect("app data");
        let project = app_data.path().to_string_lossy().into_owned();
        let directory = app_data.path().join("workspace-recovery");
        fs::write(&directory, b"user data").expect("unrelated file");
        assert!(save_terminal(app_data.path(), &project, "s1", snapshot("data")).is_err());
        assert_eq!(fs::read(&directory).expect("preserved"), b"user data");
        fs::remove_file(&directory).expect("remove test file");
        fs::create_dir(&directory).expect("cache directory");
        let target = directory.join(snapshot_key(&project, "s1").expect("key"));
        fs::create_dir(&target).expect("unrelated directory");
        assert!(save_terminal(app_data.path(), &project, "s1", snapshot("data")).is_err());
        assert!(target.is_dir());
        assert_eq!(
            read_terminal(app_data.path(), &project, "s1").expect("invalid target"),
            None
        );
    }
}
