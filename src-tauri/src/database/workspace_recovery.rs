use super::{read_setting, write_setting, Database};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::io::{self, Write};

const ENABLED_KEY: &str = "general.workspaceRestoreEnabled";
pub const MAX_WORKSPACE_RECOVERY_BYTES: usize = 4 * 1024 * 1024;

/// 序列化过程即限制预算，避免转义字符生成超额的大块中间字符串。
pub(crate) fn serialize_bounded(value: &impl Serialize, limit: usize) -> Result<Vec<u8>, String> {
    struct BoundedJson {
        bytes: Vec<u8>,
        limit: usize,
    }
    impl Write for BoundedJson {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            if buffer.len() > self.limit.saturating_sub(self.bytes.len()) {
                return Err(io::Error::other("recovery JSON exceeds limit"));
            }
            self.bytes.extend_from_slice(buffer);
            Ok(buffer.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut writer = BoundedJson {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut writer, value)
        .map_err(|_| "WORKSPACE_RECOVERY_TOO_LARGE:recovery JSON exceeds limit".to_string())?;
    Ok(writer.bytes)
}

/// 项目目录只用作数据库身份；磁盘快照文件名另行哈希，绝不拼接用户路径。
pub(crate) fn project_identity(project_path: &str) -> Result<String, String> {
    if project_path.is_empty()
        || project_path.len() > 8192
        || project_path.contains('\0')
        || !std::path::Path::new(project_path).is_absolute()
    {
        return Err("WORKSPACE_RECOVERY_INVALID:invalid project path".into());
    }
    let path = crate::path_utils::normalize_input_path(project_path);
    if !path.is_absolute() {
        return Err("WORKSPACE_RECOVERY_INVALID:project path must be absolute".into());
    }
    Ok(crate::path_utils::display_path(path))
}

fn valid_payload(payload: &Value, project_key: &str) -> bool {
    payload.get("version").and_then(Value::as_u64) == Some(1)
        && payload
            .get("projectPath")
            .and_then(Value::as_str)
            .and_then(|path| project_identity(path).ok())
            .as_deref()
            == Some(project_key)
        && payload.get("sessions").is_some_and(Value::is_array)
        && payload.get("workspace").is_some_and(Value::is_object)
        && payload.get("updatedAt").is_some_and(Value::is_number)
}

impl Database {
    pub fn get_workspace_restore_enabled(&self) -> Result<bool, String> {
        Ok(read_setting(&self.conn.lock(), ENABLED_KEY)?.unwrap_or(true))
    }

    pub fn set_workspace_restore_enabled(&self, enabled: bool) -> Result<(), String> {
        write_setting(&self.conn.lock(), ENABLED_KEY, &enabled)
    }

    pub fn save_workspace_recovery(
        &self,
        project_path: &str,
        payload: &Value,
    ) -> Result<(), String> {
        let project_key = project_identity(project_path)?;
        if !valid_payload(payload, &project_key) {
            return Err("WORKSPACE_RECOVERY_INVALID:unsupported workspace payload".into());
        }
        let serialized =
            String::from_utf8(serialize_bounded(payload, MAX_WORKSPACE_RECOVERY_BYTES)?)
                .map_err(|error| error.to_string())?;
        self.conn
            .lock()
            .execute(
                "INSERT INTO workspace_recovery (project_path, payload_json, updated_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(project_path) DO UPDATE SET payload_json = excluded.payload_json,
                 updated_at_ms = excluded.updated_at_ms",
                params![
                    project_key,
                    serialized,
                    payload["updatedAt"].as_i64().unwrap_or(0)
                ],
            )
            .map_err(|error| format!("保存工作区恢复数据失败: {error}"))?;
        Ok(())
    }

    pub fn read_workspace_recovery(&self, project_path: &str) -> Result<Option<Value>, String> {
        let Ok(project_key) = project_identity(project_path) else {
            return Ok(None);
        };
        let serialized: Option<String> = self
            .conn
            .lock()
            .query_row(
                "SELECT payload_json FROM workspace_recovery
             WHERE project_path = ?1 AND length(CAST(payload_json AS BLOB)) <= ?2",
                params![project_key, MAX_WORKSPACE_RECOVERY_BYTES as i64],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("读取工作区恢复数据失败: {error}"))?;
        Ok(serialized
            .and_then(|json| serde_json::from_str::<Value>(&json).ok())
            .filter(|payload| valid_payload(payload, &project_key)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;
    use rusqlite::Connection;
    use serde_json::json;
    use std::path::Path;

    fn open(path: &Path) -> Database {
        let connection = Connection::open(path).expect("open test database");
        super::super::schema::migrate(&connection).expect("migrate test database");
        Database {
            conn: Mutex::new(connection),
        }
    }

    fn payload(project: &str) -> Value {
        json!({ "version": 1, "projectPath": project, "sessions": [], "workspace": {}, "updatedAt": 100 })
    }

    #[test]
    fn workspace_recovery_and_disabled_setting_survive_database_reopen() {
        let directory = tempfile::tempdir().expect("test directory");
        let project = directory
            .path()
            .join("project")
            .to_string_lossy()
            .into_owned();
        let database_path = directory.path().join("database.sqlite");
        let database = open(&database_path);
        assert!(database
            .get_workspace_restore_enabled()
            .expect("default setting"));
        database
            .set_workspace_restore_enabled(false)
            .expect("disable");
        database
            .save_workspace_recovery(&project, &payload(&project))
            .expect("save workspace");
        database
            .save_general_persistent_settings(&Default::default())
            .expect("save unrelated settings");
        drop(database);
        let reopened = open(&database_path);
        assert!(!reopened
            .get_workspace_restore_enabled()
            .expect("disabled persists"));
        assert_eq!(
            reopened.read_workspace_recovery(&project).expect("read"),
            Some(payload(&project))
        );
    }

    #[test]
    fn workspace_recovery_is_project_scoped_and_rejects_invalid_or_large_payloads() {
        let directory = tempfile::tempdir().expect("test directory");
        let first = directory
            .path()
            .join("first")
            .to_string_lossy()
            .into_owned();
        let second = directory
            .path()
            .join("second")
            .to_string_lossy()
            .into_owned();
        let database = Database::open_in_memory();
        database
            .save_workspace_recovery(&first, &payload(&first))
            .expect("first workspace");
        assert_eq!(
            database
                .read_workspace_recovery(&second)
                .expect("second workspace"),
            None
        );
        assert!(database
            .save_workspace_recovery(&second, &payload(&first))
            .is_err());
        let mut invalid = payload(&first);
        invalid["version"] = json!(2);
        assert!(database.save_workspace_recovery(&first, &invalid).is_err());
        let mut large = payload(&first);
        large["workspace"] = json!({ "data": "a".repeat(MAX_WORKSPACE_RECOVERY_BYTES) });
        assert!(database.save_workspace_recovery(&first, &large).is_err());
        assert_eq!(
            database
                .read_workspace_recovery(&first)
                .expect("old workspace"),
            Some(payload(&first))
        );
    }

    #[test]
    fn corrupt_workspace_records_and_invalid_project_paths_degrade_to_none() {
        let directory = tempfile::tempdir().expect("test directory");
        let project = directory
            .path()
            .join("project")
            .to_string_lossy()
            .into_owned();
        let database = Database::open_in_memory();
        database
            .save_workspace_recovery(&project, &payload(&project))
            .expect("save");
        database
            .conn
            .lock()
            .execute("UPDATE workspace_recovery SET payload_json = 'broken'", [])
            .expect("corrupt test record");
        assert_eq!(
            database.read_workspace_recovery(&project).expect("read"),
            None
        );
        assert_eq!(
            database
                .read_workspace_recovery("relative")
                .expect("relative read"),
            None
        );
    }

    #[test]
    fn recovery_json_budget_counts_escaped_bytes() {
        assert_eq!(serialize_bounded(&"a", 3).expect("fits"), b"\"a\"");
        assert!(serialize_bounded(&"\0", 3).is_err());
        assert!(project_identity(".").is_err());
    }
}
