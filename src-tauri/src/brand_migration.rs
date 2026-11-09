//! One-time, non-destructive migration from the previous application identity.
//! Legacy names in this module are compatibility inputs, never new output names.
use rusqlite::{backup::Backup, Connection, OpenFlags};
use std::{collections::HashSet, fs, path::Path, time::Duration};

pub(crate) const LEGACY_ID: &str = "com.termflow.desktop";
pub(crate) const APP_ID: &str = "com.krosna.desktop";
pub(crate) const LEGACY_PROJECT_DIRECTORY: &str = ".termflow";
const LEGACY_DATABASE: &str = "termflow.db";
const DATABASE: &str = "krosna.db";

pub(crate) fn is_managed_name(value: &str, current: &str) -> bool {
    value.contains(current) || value.contains(&current.replace("krosna", "termflow"))
}

/// Must run before Tauri creates a WebView or opens the settings database.
pub(crate) fn migrate_app_data(identifier: &str) -> Result<(), String> {
    let Some(suffix) = identifier.strip_prefix(APP_ID) else { return Ok(()); };
    let previous = format!("{LEGACY_ID}{suffix}");
    let mut visited = HashSet::new();
    for base in [dirs_next::data_dir(), dirs_next::data_local_dir()].into_iter().flatten() {
        if visited.insert(base.clone()) {
            migrate_directory(&base.join(&previous), &base.join(identifier))?;
        }
    }
    if let Some(home) = dirs_next::home_dir() {
        migrate_directory(&home.join(LEGACY_PROJECT_DIRECTORY), &home.join(".krosna"))?;
    }
    Ok(())
}

fn migrate_directory(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() || !source.is_dir() { return Ok(()); }
    let parent = target.parent().ok_or("Invalid migration destination")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let staging = tempfile::Builder::new().prefix(".krosna-migration-")
        .tempdir_in(parent).map_err(|error| error.to_string())?;
    copy_tree(source, staging.path()).map_err(|error| format!(
        "无法迁移旧版应用数据，请关闭旧版后重试。原始数据仍保留在 {}: {error}", source.display()
    ))?;
    fs::write(staging.path().join("brand-migration.json"), b"{\"from\":\"Termflow\",\"to\":\"Krosna\",\"version\":1}\n")
        .map_err(|error| error.to_string())?;
    fs::rename(staging.path(), target).map_err(|error| error.to_string())
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        // Never follow links into unrelated user directories.
        if kind.is_symlink() { continue; }
        let source = entry.path();
        let destination = target.join(if name == LEGACY_DATABASE { DATABASE.into() } else { name.clone() });
        if kind.is_dir() {
            fs::create_dir(&destination).map_err(|error| error.to_string())?;
            copy_tree(&source, &destination)?;
        } else if kind.is_file() {
            let name = name.to_string_lossy();
            // Snapshot SQLite via its backup API, including committed WAL data.
            // CLI descriptors and shims belong to the previous running instance.
            if name == LEGACY_DATABASE {
                let old = Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(|error| error.to_string())?;
                let mut new = Connection::open(&destination).map_err(|error| error.to_string())?;
                Backup::new(&old, &mut new).and_then(|backup| backup.run_to_completion(128, Duration::from_millis(20), None))
                    .map_err(|error| error.to_string())?;
            } else if !matches!(name.as_ref(), "termflow.db-wal" | "termflow.db-shm" | "runtime-v1.json" | "termflow.cmd" | "termflow") {
                fs::copy(&source, &destination).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

/// Copy a legacy project configuration only after checking containment.
/// Keep the original for rollback and never overwrite a newer Krosna file.
pub(crate) fn migrate_project_file(root: &Path, file_name: &str) -> Result<(), String> {
    let directory = root.join(".krosna");
    let destination = directory.join(file_name);
    if fs::symlink_metadata(&destination).is_ok() { return Ok(()); }
    let legacy = root.join(LEGACY_PROJECT_DIRECTORY).join(file_name);
    let source = match fs::canonicalize(&legacy) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if !source.starts_with(root) || !source.is_file() {
        return Err("旧版项目配置必须位于项目目录内".into());
    }
    if fs::symlink_metadata(&directory).is_ok() {
        let resolved = fs::canonicalize(&directory).map_err(|error| error.to_string())?;
        if !resolved.starts_with(root) { return Err(".krosna 配置路径必须位于项目目录内".into()); }
    }
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(&directory).map_err(|error| error.to_string())?;
    let mut input = fs::File::open(source).map_err(|error| error.to_string())?;
    std::io::copy(&mut input, &mut temporary).map_err(|error| error.to_string())?;
    temporary.persist_noclobber(destination).map_err(|error| error.error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_database_does_not_publish_partial_migration() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join(LEGACY_ID);
        let new = temp.path().join(APP_ID);
        fs::create_dir(&old).unwrap();
        fs::write(old.join(LEGACY_DATABASE), b"invalid SQLite database").unwrap();
        assert!(migrate_directory(&old, &new).is_err());
        assert!(!new.exists());
        assert_eq!(fs::read(old.join(LEGACY_DATABASE)).unwrap(), b"invalid SQLite database");
    }

    #[test]
    fn release_workflow_keeps_legacy_bridge_separate_from_primary_release() {
        let workflow: serde_yaml::Value = serde_yaml::from_str(include_str!("../../.github/workflows/release.yml")).unwrap();
        let jobs = workflow["jobs"].as_mapping().unwrap();
        assert_eq!(jobs.len(), 2);
        assert!(workflow["jobs"]["release-windows"]["needs"].is_null());
        assert_eq!(workflow["jobs"]["legacy-update-bridge"]["needs"].as_str(), Some("release-windows"));
        assert!(workflow["jobs"]["legacy-update-bridge"]["if"].as_str().unwrap().contains("workflow_dispatch"));
    }

    #[test]
    fn copies_settings_and_wal_without_changing_original_or_overwriting_destination() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join(LEGACY_ID);
        let new = temp.path().join(APP_ID);
        fs::create_dir(&old).unwrap();
        let conn = Connection::open(old.join(LEGACY_DATABASE)).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE settings(value TEXT); INSERT INTO settings VALUES ('preserved');").unwrap();
        fs::write(old.join("preferences.json"), b"{\"theme\":\"dark\"}").unwrap();
        migrate_directory(&old, &new).unwrap();
        let copied = Connection::open(new.join(DATABASE)).unwrap();
        assert_eq!(copied.query_row("SELECT value FROM settings", [], |row| row.get::<_, String>(0)).unwrap(), "preserved");
        assert!(old.join(LEGACY_DATABASE).is_file());
        assert!(!new.join(LEGACY_DATABASE).exists());
        fs::write(old.join("preferences.json"), b"older application changed").unwrap();
        migrate_directory(&old, &new).unwrap();
        assert_eq!(fs::read(new.join("preferences.json")).unwrap(), b"{\"theme\":\"dark\"}");
    }

    #[test]
    fn migrates_project_configuration_and_preserves_newer_file() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir(root.join(LEGACY_PROJECT_DIRECTORY)).unwrap();
        fs::write(root.join(LEGACY_PROJECT_DIRECTORY).join("launchers.json"), b"legacy config").unwrap();
        migrate_project_file(&root, "launchers.json").unwrap();
        fs::write(root.join(".krosna/launchers.json"), b"new config").unwrap();
        migrate_project_file(&root, "launchers.json").unwrap();
        assert_eq!(fs::read(root.join(".krosna/launchers.json")).unwrap(), b"new config");
    }

    #[cfg(unix)]
    #[test]
    fn refuses_legacy_configuration_outside_project() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("launchers.json"), b"outside").unwrap();
        std::os::unix::fs::symlink(outside.path(), temp.path().join(LEGACY_PROJECT_DIRECTORY)).unwrap();
        assert!(migrate_project_file(&fs::canonicalize(temp.path()).unwrap(), "launchers.json").is_err());
        assert!(!temp.path().join(".krosna").exists());
    }
}
