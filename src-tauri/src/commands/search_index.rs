use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use ignore::gitignore::GitignoreBuilder;
use ignore::{Match, WalkBuilder};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::database::{Database, SearchIndexStorageSettings};
use crate::path_utils::{display_path, normalize_input_path};

mod scheduling;
mod short_queries;
use scheduling::{ProjectRuntime, SearchActivityGuard, UpdateBatch};

// Schema v2 retains a row for non-text candidates.  That makes a watcher-driven
// update able to account for a file moving between indexed and skipped without
// rescanning the project.
// 升级 SQLite 后重建可再生缓存，避免继续写入旧版 FTS5 索引。
const INDEX_SCHEMA_VERSION: u32 = 3;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const STATUS_EMIT_INTERVAL: Duration = Duration::from_millis(150);
const SCHEDULER_TICK: Duration = Duration::from_millis(250);
const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".svn",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    "__pycache__",
    ".cache",
    "vendor",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchIndexStatus {
    pub project_path: String,
    pub enabled: bool,
    pub state: String,
    pub backend: String,
    pub phase: String,
    pub processed_files: u64,
    pub total_files: Option<u64>,
    pub indexed_files: u64,
    pub skipped_files: u64,
    pub processed_bytes: u64,
    pub total_bytes: Option<u64>,
    pub index_size_bytes: u64,
    pub started_at: Option<u64>,
    pub updated_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexStorageStatus {
    pub cache_root: String,
    pub quota_bytes: u64,
    pub used_bytes: u64,
    pub project_count: u64,
}

#[derive(Clone)]
struct ActiveEntry {
    job_id: u64,
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
    status: ProjectSearchIndexStatus,
    fallback_paths: Option<Arc<Mutex<LiveFileCatalog>>>,
}

// A paused or failed full-text writer cannot maintain the published SQLite file.
// Keep just the names in memory while that state lasts. Watcher revisions let
// successive keystrokes reuse the same directory walk.
#[derive(Default)]
struct LiveFileCatalog {
    database: Option<Connection>,
    revision: u64,
}

impl LiveFileCatalog {
    fn query<T>(
        &mut self,
        project: &ResolvedProject,
        cancel: &AtomicBool,
        query: impl FnOnce(&Connection, &ResolvedProject) -> Result<T, String>,
    ) -> Result<T, String> {
        let (revision, incremental) = {
            let changes = project
                .runtime
                .changes
                .lock()
                .map_err(|_| "Failed to read path changes")?;
            let incremental = self.database.is_some()
                && !changes
                    .reconcile
                    .is_some_and(|revision| revision > self.revision);
            (
                changes.revision,
                incremental.then(|| {
                    changes
                        .paths
                        .iter()
                        .filter(|(_, revision)| **revision > self.revision)
                        .map(|(path, _)| path.clone())
                        .collect::<Vec<_>>()
                }),
            )
        };
        if self.database.is_none() || self.revision != revision {
            if let (Some(database), Some(paths)) = (&mut self.database, incremental) {
                let tx = database.transaction().map_err(|error| error.to_string())?;
                for path in paths {
                    if let Some(candidate) = candidate_for_existing_path(project, &path)? {
                        tx.execute(
                            "INSERT OR IGNORE INTO indexed_files VALUES (?1)",
                            [candidate.relative_path],
                        )
                        .map_err(|error| error.to_string())?;
                    } else if let Ok(relative) = path.strip_prefix(&project.path) {
                        tx.execute(
                            "DELETE FROM indexed_files WHERE relative_path = ?1
                             OR substr(relative_path, 1, length(?1) + 1) = ?1 || '/'",
                            [relative.to_string_lossy().replace('\\', "/")],
                        )
                        .map_err(|error| error.to_string())?;
                    }
                }
                tx.commit().map_err(|error| error.to_string())?;
            } else {
                let candidates =
                    discover_candidates(project, cancel, &AtomicBool::new(false), |_, _, _| {})?;
                if cancel.load(Ordering::Relaxed) {
                    return Err("search-project-released".into());
                }
                let mut database =
                    Connection::open_in_memory().map_err(|error| error.to_string())?;
                database
                    .execute_batch("CREATE TABLE indexed_files(relative_path TEXT PRIMARY KEY)")
                    .map_err(|error| error.to_string())?;
                let tx = database.transaction().map_err(|error| error.to_string())?;
                {
                    let mut insert = tx
                        .prepare("INSERT INTO indexed_files VALUES (?1)")
                        .map_err(|error| error.to_string())?;
                    for candidate in candidates {
                        insert
                            .execute([candidate.relative_path])
                            .map_err(|error| error.to_string())?;
                    }
                }
                tx.commit().map_err(|error| error.to_string())?;
                self.database = Some(database);
            }
            self.revision = revision;
        }
        let result = query(
            self.database.as_ref().ok_or("search-index-unavailable")?,
            project,
        )?;
        let _lifetime = project.live()?;
        Ok(result)
    }
}

struct ProjectIndexWatcher {
    _watcher: Box<dyn Watcher + Send>,
    stop: Arc<AtomicBool>,
}

impl Drop for ProjectIndexWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[derive(Clone, Default)]
pub struct SearchIndexState {
    entries: Arc<Mutex<HashMap<String, ActiveEntry>>>,
    catalog_changed: Arc<Condvar>,
    storage_changes: Arc<Mutex<()>>,
    watchers: Arc<Mutex<HashMap<String, ProjectIndexWatcher>>>,
    next_job_id: Arc<AtomicU64>,
    runtimes: Arc<Mutex<HashMap<String, Arc<ProjectRuntime>>>>,
}

impl SearchIndexState {
    fn runtime(&self, key: &str) -> Result<Arc<ProjectRuntime>, String> {
        Ok(self
            .runtimes
            .lock()
            .map_err(|_| "Failed to access search index runtime".to_string())?
            .entry(key.to_string())
            .or_default()
            .clone())
    }
}

pub(super) fn capture_search_project(
    app: &AppHandle,
    path: &str,
) -> Result<ResolvedProject, String> {
    resolve_project(&app.state::<SearchIndexState>(), path)
}

#[derive(Clone)]
pub(super) struct ResolvedProject {
    runtime: Arc<ProjectRuntime>,
    generation: u64,
    path: PathBuf,
    display_path: String,
    preference_key: String,
}

#[derive(Clone)]
struct IndexCandidate {
    path: PathBuf,
    relative_path: String,
    size: u64,
    modified_ns: i64,
}

impl IndexCandidate {
    fn content_bytes(&self) -> u64 {
        if self.size <= MAX_FILE_BYTES {
            self.size
        } else {
            0
        }
    }

    fn read_content(&self, full_text: bool) -> Option<(String, TextEncoding)> {
        if full_text && self.size <= MAX_FILE_BYTES {
            read_text_file(&self.path).ok()
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IndexedFileStatus {
    Indexed,
    Skipped,
}

impl IndexedFileStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Indexed => "indexed",
            Self::Skipped => "skipped",
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct IndexUpdateSummary {
    total_files: u64,
    indexed_files: u64,
    skipped_files: u64,
    total_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TextEncoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
}

pub(crate) enum IndexCandidateLookup {
    ShortQueryError(&'static str),
    Ready {
        paths: Vec<PathBuf>,
        generation: u64,
    },
    Fallback {
        reason: String,
        index_state: String,
    },
}

impl TextEncoding {
    fn as_str(self) -> &'static str {
        match self {
            Self::Utf8 => "utf-8",
            Self::Utf8Bom => "utf-8-bom",
            Self::Utf16Le => "utf-16-le",
            Self::Utf16Be => "utf-16-be",
        }
    }
}

fn resolve_project(
    state: &SearchIndexState,
    project_path: &str,
) -> Result<ResolvedProject, String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Err("Project path cannot be empty".to_string());
    }
    let path = normalize_input_path(trimmed);
    if !path.is_dir() {
        return Err("Project directory does not exist".to_string());
    }
    let display = display_path(&path);
    let normalized = display.replace('\\', "/");
    #[cfg(windows)]
    let preference_key = normalized.to_lowercase();
    #[cfg(not(windows))]
    let preference_key = normalized;
    let runtime = state.runtime(&preference_key)?;
    let generation = *runtime
        .generation
        .lock()
        .map_err(|_| "Failed to lock project lifetime")?;
    Ok(ResolvedProject {
        runtime,
        generation,
        path,
        display_path: display,
        preference_key,
    })
}

impl ResolvedProject {
    pub(super) fn begin_content_search(&self) -> Result<SearchActivityGuard, String> {
        let _lifetime = self.live()?;
        Ok(self.runtime.begin_search())
    }

    // Hold through registering a watcher or committing a write. Release advances
    // the same generation, even if the project is immediately reopened.
    fn live(&self) -> Result<std::sync::MutexGuard<'_, u64>, String> {
        let guard = self
            .runtime
            .generation
            .lock()
            .map_err(|_| "Failed to lock project lifetime")?;
        if *guard != self.generation {
            return Err("search-project-released".into());
        }
        Ok(guard)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

fn disabled_status(project_path: String) -> ProjectSearchIndexStatus {
    ProjectSearchIndexStatus {
        project_path,
        enabled: false,
        state: "disabled".to_string(),
        backend: "scan".to_string(),
        phase: "disabled".to_string(),
        processed_files: 0,
        total_files: None,
        indexed_files: 0,
        skipped_files: 0,
        processed_bytes: 0,
        total_bytes: None,
        index_size_bytes: 0,
        started_at: None,
        updated_at: None,
        error: None,
    }
}

fn content_status(status: ProjectSearchIndexStatus) -> ProjectSearchIndexStatus {
    if status.enabled {
        status
    } else {
        disabled_status(status.project_path)
    }
}

fn initial_build_status(project_path: String) -> ProjectSearchIndexStatus {
    ProjectSearchIndexStatus {
        project_path,
        enabled: true,
        state: "preflight".to_string(),
        backend: "scan".to_string(),
        phase: "discovering".to_string(),
        processed_files: 0,
        total_files: None,
        indexed_files: 0,
        skipped_files: 0,
        processed_bytes: 0,
        total_bytes: None,
        index_size_bytes: 0,
        started_at: Some(now_ms()),
        updated_at: Some(now_ms()),
        error: None,
    }
}

fn project_hash(key: &str) -> String {
    format!("{:x}", Sha256::digest(key.as_bytes()))
}

fn default_index_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve application cache directory: {error}"))?
        .join("search-index"))
}

fn index_root_from_settings(
    app: &AppHandle,
    settings: &SearchIndexStorageSettings,
) -> Result<PathBuf, String> {
    match settings
        .cache_root
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(path) => Ok(PathBuf::from(path)),
        None => default_index_root(app),
    }
}

fn index_root(app: &AppHandle) -> Result<PathBuf, String> {
    let database = app.state::<Arc<Database>>();
    let settings = database.load_search_index_storage()?;
    index_root_from_settings(app, &settings)
}

fn index_directory(app: &AppHandle, project: &ResolvedProject) -> Result<PathBuf, String> {
    Ok(index_root(app)?
        .join(format!("v{INDEX_SCHEMA_VERSION}"))
        .join(project_hash(&project.preference_key)))
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let Ok(file_type) = entry.file_type() else {
                return 0;
            };
            if file_type.is_dir() {
                directory_size(&entry.path())
            } else if file_type.is_file() {
                entry.metadata().map(|metadata| metadata.len()).unwrap_or(0)
            } else {
                0
            }
        })
        .sum()
}

fn modified_at_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

fn touch_index_usage(index_dir: &Path) {
    let _ = fs::write(index_dir.join("last-used"), now_ms().to_string());
}

fn last_index_use(index_dir: &Path) -> u64 {
    fs::read_to_string(index_dir.join("last-used"))
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or_else(|| modified_at_ms(&index_dir.join("index.sqlite3")))
}

fn cached_index_directories(root: &Path) -> Vec<(PathBuf, u64, u64)> {
    let Ok(versions) = fs::read_dir(root) else {
        return Vec::new();
    };
    versions
        .flatten()
        .filter_map(|version| {
            version
                .file_type()
                .ok()
                .filter(|file_type| file_type.is_dir())
                .map(|_| version.path())
        })
        .flat_map(|version| fs::read_dir(version).into_iter().flatten().flatten())
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|file_type| file_type.is_dir())
                .map(|_| entry.path())
        })
        .filter(|path| path.join("index.sqlite3").is_file())
        .map(|path| {
            let size = directory_size(&path);
            let last_used = last_index_use(&path);
            (path, size, last_used)
        })
        .collect()
}

fn storage_status(app: &AppHandle) -> Result<SearchIndexStorageStatus, String> {
    let database = app.state::<Arc<Database>>();
    let settings = database.load_search_index_storage()?;
    let root = index_root_from_settings(app, &settings)?;
    let indexes = cached_index_directories(&root);
    Ok(SearchIndexStorageStatus {
        cache_root: display_path(&root),
        quota_bytes: settings.quota_bytes,
        used_bytes: indexes.iter().map(|(_, size, _)| *size).sum(),
        project_count: indexes.len() as u64,
    })
}

fn enforce_storage_quota(app: &AppHandle, keep: Option<&Path>) -> Result<(), String> {
    let database = app.state::<Arc<Database>>();
    let settings = database.load_search_index_storage()?;
    let root = index_root_from_settings(app, &settings)?;
    let state = app.state::<SearchIndexState>();
    let active_dirs: HashSet<_> = state
        .entries
        .lock()
        .map_err(|_| "Failed to read active projects")?
        .keys()
        .map(|key| {
            root.join(format!("v{INDEX_SCHEMA_VERSION}"))
                .join(project_hash(key))
        })
        .collect();
    let mut indexes = cached_index_directories(&root);
    let mut used_bytes: u64 = indexes.iter().map(|(_, size, _)| *size).sum();
    indexes.sort_by_key(|(_, _, last_used)| *last_used);
    for (path, size, _) in indexes {
        if used_bytes <= settings.quota_bytes {
            break;
        }
        if Some(path.as_path()) == keep || active_dirs.contains(&path) {
            continue;
        }
        fs::remove_dir_all(&path).map_err(|error| {
            format!(
                "Failed to evict old search index {}: {error}",
                path.display()
            )
        })?;
        used_bytes = used_bytes.saturating_sub(size);
    }
    Ok(())
}

fn has_active_build(state: &SearchIndexState) -> bool {
    let building = state.entries.lock().ok().is_some_and(|entries| {
        entries.values().any(|entry| {
            matches!(
                entry.status.state.as_str(),
                "preflight" | "building" | "paused"
            )
        })
    });
    building
        || state.runtimes.lock().ok().is_some_and(|runtimes| {
            runtimes.values().any(|runtime| {
                runtime.short_query_upgrade.load(Ordering::Relaxed)
                    || runtime
                        .changes
                        .lock()
                        .map_or(true, |changes| changes.writing)
            })
        })
}

fn project_has_active_index_write(state: &SearchIndexState, key: &str) -> bool {
    let building = get_active_status(state, key).is_some_and(|status| {
        matches!(status.state.as_str(), "preflight" | "building" | "updating")
    });
    building
        || state.runtime(key).is_ok_and(|runtime| {
            runtime.short_query_upgrade.load(Ordering::Relaxed)
                || runtime
                    .changes
                    .lock()
                    .map_or(true, |changes| changes.writing)
        })
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| {
        format!(
            "Failed to create cache directory {}: {error}",
            destination.display()
        )
    })?;
    for entry in fs::read_dir(source).map_err(|error| {
        format!(
            "Failed to read cache directory {}: {error}",
            source.display()
        )
    })? {
        let entry = entry.map_err(|error| format!("Failed to enumerate cache files: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "Failed to inspect cache entry {}: {error}",
                source_path.display()
            )
        })?;
        if file_type.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "Failed to copy cache entry {}: {error}",
                    source_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn relocate_index_root(
    source: &Path,
    destination: &Path,
    save_location: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if source == destination || !source.exists() {
        return save_location();
    }
    let existed = destination.exists();
    if existed {
        let is_empty = fs::read_dir(destination)
            .map_err(|error| format!("Failed to read destination cache directory: {error}"))?
            .next()
            .is_none();
        if !is_empty {
            return Err("The selected index cache folder is not empty".to_string());
        }
    }
    let parent = destination
        .parent()
        .ok_or("The destination needs a parent directory")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if fs::canonicalize(parent)
        .map_err(|error| error.to_string())?
        .starts_with(fs::canonicalize(source).map_err(|error| error.to_string())?)
    {
        return Err("The destination cannot be inside the current index cache".into());
    }
    let temporary = tempfile::Builder::new()
        .prefix(".krosna-search-index-moving-")
        .tempdir_in(parent)
        .map_err(|error| error.to_string())?;
    copy_directory(source, temporary.path())?;
    if existed {
        fs::remove_dir(destination)
            .map_err(|error| format!("Failed to prepare destination cache directory: {error}"))?;
    }
    if let Err(error) = fs::rename(temporary.path(), destination) {
        if existed {
            let _ = fs::create_dir(destination);
        }
        return Err(format!("Failed to activate relocated index cache: {error}"));
    }
    if let Err(error) = save_location() {
        fs::rename(destination, temporary.path()).map_err(|rollback| {
            format!("{error}. Original cache retained; failed to roll back the copy: {rollback}")
        })?;
        if existed {
            fs::create_dir(destination).map_err(|restore| format!("{error}: {restore}"))?;
        }
        return Err(error);
    }
    // The preference now points at the complete copy. An external reader may
    // still hold the old directory open on Windows.
    if let Err(error) = fs::remove_dir_all(source) {
        eprintln!("Could not remove the previous search index cache: {error}");
    }
    Ok(())
}

fn get_active_status(state: &SearchIndexState, key: &str) -> Option<ProjectSearchIndexStatus> {
    state
        .entries
        .lock()
        .ok()
        .and_then(|entries| entries.get(key).map(|entry| entry.status.clone()))
}

fn set_status(
    app: &AppHandle,
    state: &SearchIndexState,
    key: &str,
    job_id: u64,
    status: ProjectSearchIndexStatus,
) -> bool {
    let finished = matches!(status.state.as_str(), "ready" | "failed" | "unsupported");
    let updated = state.entries.lock().ok().is_some_and(|mut entries| {
        let Some(entry) = entries.get_mut(key) else {
            return false;
        };
        if entry.job_id != job_id {
            return false;
        }
        if entry.pause.load(Ordering::Relaxed) && !finished {
            return false;
        }
        if finished {
            entry.pause.store(false, Ordering::Relaxed);
        }
        if status.state == "ready" {
            entry.fallback_paths = None;
        }
        entry.status = status.clone();
        true
    });
    if updated {
        if finished {
            state.catalog_changed.notify_all();
        }
        let _ = app.emit("search-index-status", content_status(status));
    }
    updated
}

fn cancel_active_job(state: &SearchIndexState, key: &str) {
    if let Ok(entries) = state.entries.lock() {
        if let Some(entry) = entries.get(key) {
            entry.cancel.store(true, Ordering::Relaxed);
        }
    }
}

fn wait_while_paused(pause: &AtomicBool, cancel: &AtomicBool) -> bool {
    while pause.load(Ordering::Relaxed) && !cancel.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(25));
    }
    !cancel.load(Ordering::Relaxed)
}

fn event_requires_rebuild(project_path: &Path, event: &Event) -> bool {
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }
    if event.need_rescan() || event.paths.is_empty() {
        return true;
    }
    if matches!(
        event.kind,
        EventKind::Remove(notify::event::RemoveKind::Folder)
    ) {
        return event
            .paths
            .iter()
            .any(|path| !is_under_ignored_directory(project_path, path));
    }
    event.paths.iter().any(|path| {
        let Ok(relative) = path.strip_prefix(project_path) else {
            return false;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        if relative == ".git/info/exclude" {
            return true;
        }
        if is_under_ignored_directory(project_path, path) {
            return false;
        }
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| matches!(name, ".gitignore" | ".ignore" | ".rgignore"))
        {
            return true;
        }
        if path.is_dir() {
            return true;
        }
        false
    })
}

fn is_under_ignored_directory(project_path: &Path, path: &Path) -> bool {
    path.strip_prefix(project_path)
        .ok()
        .is_some_and(|relative| {
            relative.components().any(|component| {
                let name = component.as_os_str().to_string_lossy();
                IGNORED_DIRECTORIES
                    .iter()
                    .any(|ignored| name.eq_ignore_ascii_case(ignored))
            })
        })
}

fn removed_path_had_indexed_children(
    app: &AppHandle,
    project: &ResolvedProject,
    path: &Path,
) -> bool {
    let Some(relative_path) = path
        .strip_prefix(&project.path)
        .ok()
        .and_then(Path::to_str)
        .map(|path| path.replace('\\', "/"))
    else {
        return false;
    };
    let Ok(database_path) = index_directory(app, project).map(|path| path.join("index.sqlite3"))
    else {
        return false;
    };
    let Ok(connection) =
        Connection::open_with_flags(&database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return false;
    };
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM indexed_files
                WHERE substr(relative_path, 1, length(?1) + 1) = ?1 || '/'
             )",
            [&relative_path],
            |row| row.get::<_, i64>(0),
        )
        .map(|exists| exists != 0)
        .unwrap_or(false)
}

fn watcher_event_paths(
    app: &AppHandle,
    project: &ResolvedProject,
    event: &Event,
) -> Option<Vec<PathBuf>> {
    if matches!(event.kind, EventKind::Access(_)) {
        return Some(Vec::new());
    }
    if event_requires_rebuild(&project.path, event) {
        return None;
    }
    let mut paths = Vec::new();
    for path in &event.paths {
        if is_under_ignored_directory(&project.path, path) {
            continue;
        }
        if !path.exists() && removed_path_had_indexed_children(app, project, path) {
            return None;
        }
        paths.push(path.clone());
    }
    Some(paths)
}

fn mark_index_for_rebuild(
    app: &AppHandle,
    state: &SearchIndexState,
    project: &ResolvedProject,
    error: Option<String>,
) {
    let Ok(_lifetime) = project.live() else {
        return;
    };
    let status = state.entries.lock().ok().and_then(|mut entries| {
        let entry = entries.get_mut(&project.preference_key)?;
        entry.status.state = "stale".to_string();
        entry.status.backend = "scan".to_string();
        entry.status.phase = "reconciling".to_string();
        entry.status.updated_at = Some(now_ms());
        entry.status.error = error;
        Some(entry.status.clone())
    });
    if let Some(status) = status {
        let _ = app.emit("search-index-status", content_status(status));
    }
}

fn apply_watcher_updates(
    app: &AppHandle,
    state: &SearchIndexState,
    project: &ResolvedProject,
    batch: &UpdateBatch,
) -> Result<bool, String> {
    let runtime = state.runtime(&project.preference_key)?;
    let _writer = runtime
        .writer
        .lock()
        .map_err(|_| "Failed to lock index writer")?;
    let active = state
        .entries
        .lock()
        .map_err(|_| "Failed to access index state")?
        .get(&project.preference_key)
        .cloned();
    let Some(active) = active
        .filter(|entry| entry.status.state == "ready" && !entry.cancel.load(Ordering::Relaxed))
    else {
        return Ok(false);
    };
    if runtime
        .changes
        .lock()
        .map_err(|_| "Failed to access pending changes")?
        .searches_active()
    {
        return Ok(false);
    }
    let database_path = index_directory(app, project)?.join("index.sqlite3");
    let paths = if batch.reconcile {
        reconciliation_paths(&database_path, project, &batch.paths)?
    } else {
        batch.paths.clone()
    };
    let summary =
        apply_incremental_updates(active.status.enabled, &database_path, project, &paths)?;
    let next_status = state.entries.lock().ok().and_then(|mut entries| {
        let entry = entries.get_mut(&project.preference_key)?;
        if entry.job_id != active.job_id || entry.status.state != "ready" {
            return None;
        }
        entry.status.total_files = Some(summary.total_files);
        entry.status.indexed_files = summary.indexed_files;
        entry.status.skipped_files = summary.skipped_files;
        entry.status.processed_files = summary.total_files;
        entry.status.total_bytes = Some(summary.total_bytes);
        entry.status.processed_bytes = summary.total_bytes;
        entry.status.index_size_bytes = fs::metadata(&database_path)
            .map(|meta| meta.len())
            .unwrap_or(0);
        entry.status.updated_at = Some(now_ms());
        entry.status.error = None;
        Some(entry.status.clone())
    });
    if let Some(next_status) = next_status {
        touch_index_usage(database_path.parent().unwrap_or_else(|| Path::new("")));
        let _ = app.emit("search-index-status", content_status(next_status));
        return Ok(true);
    }
    Ok(false)
}

// 大量事件或目录变化先核对文件元数据，只重新索引实际变化的文件。
fn reconciliation_paths(
    database_path: &Path,
    project: &ResolvedProject,
    pending_paths: &[PathBuf],
) -> Result<Vec<PathBuf>, String> {
    let candidates = discover_candidates(
        project,
        &AtomicBool::new(false),
        &AtomicBool::new(false),
        |_, _, _| {},
    )?;
    let connection =
        Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| format!("Failed to open index for reconciliation: {error}"))?;
    let mut statement = connection
        .prepare("SELECT relative_path, size, modified_ns FROM indexed_files")
        .map_err(|error| format!("Failed to read indexed file metadata: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                (row.get::<_, i64>(1)? as u64, row.get::<_, i64>(2)?),
            ))
        })
        .map_err(|error| format!("Failed to query indexed file metadata: {error}"))?;
    let mut old = rows
        .collect::<rusqlite::Result<HashMap<_, _>>>()
        .map_err(|error| format!("Failed to collect indexed file metadata: {error}"))?;
    let mut paths: HashSet<PathBuf> = pending_paths.iter().cloned().collect();
    for candidate in candidates {
        if old.remove(&candidate.relative_path) != Some((candidate.size, candidate.modified_ns)) {
            paths.insert(candidate.path);
        }
    }
    paths.extend(old.into_keys().map(|relative| project.path.join(relative)));
    Ok(paths.into_iter().collect())
}

fn record_watcher_result(
    app: &AppHandle,
    state: &SearchIndexState,
    project: &ResolvedProject,
    result: Result<Event, notify::Error>,
) {
    let (paths, reconcile) = match result {
        Ok(event) => match watcher_event_paths(app, project, &event) {
            Some(paths) => (paths, false),
            None => (Vec::new(), true),
        },
        Err(_) => (Vec::new(), true),
    };
    if let Ok(runtime) = state.runtime(&project.preference_key) {
        if let Ok(mut changes) = runtime.changes.lock() {
            changes.record(paths, reconcile, Instant::now());
        }
    }
}

fn ensure_project_watcher(
    app: &AppHandle,
    state: &SearchIndexState,
    project: &ResolvedProject,
) -> Result<(), String> {
    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "Failed to access search index watchers".to_string())?;
    if watchers.contains_key(&project.preference_key) {
        return Ok(());
    }
    // 唤醒信号也合并，避免批量 checkout 时事件队列无限增长。
    let (sender, receiver) = mpsc::sync_channel::<()>(1);
    let watcher_config = Config::default()
        .with_poll_interval(Duration::from_secs(2))
        .with_compare_contents(false);
    let make_callback = || {
        let app = app.clone();
        let state = state.clone();
        let project = project.clone();
        let sender = sender.clone();
        move |result| {
            // 在通知回调中立即登记，调度等待期间搜索也能补查最新文件。
            record_watcher_result(&app, &state, &project, result);
            let _ = sender.try_send(());
        }
    };
    let watcher: Box<dyn Watcher + Send> =
        match RecommendedWatcher::new(make_callback(), watcher_config.clone()).and_then(
            |mut watcher| {
                watcher.watch(&project.path, RecursiveMode::Recursive)?;
                Ok(watcher)
            },
        ) {
            Ok(watcher) => Box::new(watcher),
            Err(recommended_error) => {
                let mut watcher = notify::PollWatcher::new(make_callback(), watcher_config)
                    .map_err(|error| {
                        format!(
                        "Failed to create index watcher: native={recommended_error}; poll={error}"
                    )
                    })?;
                watcher
                    .watch(&project.path, RecursiveMode::Recursive)
                    .map_err(|error| format!("Failed to watch project: {error}"))?;
                Box::new(watcher)
            }
        };
    let worker_app = app.clone();
    let worker_state = state.clone();
    let worker_project = project.clone();
    let runtime = state.runtime(&project.preference_key)?;
    let stop = Arc::new(AtomicBool::new(false));
    let worker_stop = stop.clone();
    std::thread::Builder::new()
        .name(format!(
            "krosna-index-watch-{}",
            project_hash(&project.preference_key)
        ))
        .spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                match receiver.recv_timeout(SCHEDULER_TICK) {
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    _ => {}
                }
                if worker_stop.load(Ordering::Relaxed) {
                    break;
                }
                if !get_active_status(&worker_state, &worker_project.preference_key)
                    .is_some_and(|status| status.state == "ready")
                {
                    continue;
                }
                let batch = runtime
                    .changes
                    .lock()
                    .ok()
                    .and_then(|mut changes| changes.scheduled_batch(Instant::now()));
                let Some(batch) = batch else {
                    continue;
                };
                let app = worker_app.clone();
                let state = worker_state.clone();
                let project = worker_project.clone();
                let runtime = runtime.clone();
                let stop = worker_stop.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let result = if stop.load(Ordering::Relaxed) {
                        Ok(false)
                    } else {
                        apply_watcher_updates(&app, &state, &project, &batch)
                    };
                    if let Ok(mut changes) = runtime.changes.lock() {
                        if matches!(result, Ok(true)) {
                            changes.acknowledge(batch.revision, Instant::now());
                        }
                        changes.writing = false;
                    }
                    if let Err(error) = result {
                        if !stop.load(Ordering::Relaxed) {
                            mark_index_for_rebuild(&app, &state, &project, Some(error));
                            let _ = start_index_build(app, state, project, true);
                        }
                    }
                });
            }
        })
        .map_err(|error| format!("Failed to start search index watcher worker: {error}"))?;
    watchers.insert(
        project.preference_key.clone(),
        ProjectIndexWatcher {
            _watcher: watcher,
            stop,
        },
    );
    Ok(())
}

fn stop_project_watcher(state: &SearchIndexState, key: &str) {
    if let Ok(mut watchers) = state.watchers.lock() {
        watchers.remove(key);
    }
}

pub(super) fn release_project_watcher(app: &AppHandle, project_path: &str) {
    let path = display_path(&normalize_input_path(project_path)).replace('\\', "/");
    #[cfg(windows)]
    let path = path.to_lowercase();
    let state = app.state::<SearchIndexState>();
    release_index_lifetime(&state, &path);
}

fn release_index_lifetime(state: &SearchIndexState, path: &str) {
    let Ok(runtime) = state.runtime(path) else {
        return;
    };
    let Ok(mut generation) = runtime.generation.lock() else {
        return;
    };
    *generation += 1;
    if let Ok(mut entries) = state.entries.lock() {
        if let Some(entry) = entries.remove(path) {
            entry.cancel.store(true, Ordering::Relaxed);
            state.catalog_changed.notify_all();
        }
    }
    stop_project_watcher(state, path);
}

fn start_index_build(
    app: AppHandle,
    state: SearchIndexState,
    project: ResolvedProject,
    force: bool,
) -> Result<ProjectSearchIndexStatus, String> {
    let lifetime = project.live()?;
    let full_text = app
        .state::<Arc<Database>>()
        .load_project_search_index_enabled(&project.preference_key)?;
    if !force {
        if let Some(status) = get_active_status(&state, &project.preference_key) {
            if status.enabled == full_text
                && matches!(
                    status.state.as_str(),
                    "preflight" | "building" | "paused" | "ready"
                )
            {
                return Ok(status);
            }
        }
    }

    cancel_active_job(&state, &project.preference_key);
    let job_id = state.next_job_id.fetch_add(1, Ordering::Relaxed) + 1;
    let cancel = Arc::new(AtomicBool::new(false));
    let pause = Arc::new(AtomicBool::new(false));
    let mut status = initial_build_status(project.display_path.clone());
    status.enabled = full_text;
    state
        .entries
        .lock()
        .map_err(|_| "Failed to initialize search index state".to_string())?
        .insert(
            project.preference_key.clone(),
            ActiveEntry {
                job_id,
                cancel: cancel.clone(),
                pause: pause.clone(),
                status: status.clone(),
                fallback_paths: None,
            },
        );
    if let Err(error) = ensure_project_watcher(&app, &state, &project) {
        cancel.store(true, Ordering::Relaxed);
        if let Ok(mut entries) = state.entries.lock() {
            if entries
                .get(&project.preference_key)
                .is_some_and(|entry| entry.job_id == job_id)
            {
                entries.remove(&project.preference_key);
            }
        }
        return Err(error);
    }
    let _ = app.emit("search-index-status", content_status(status.clone()));

    drop(lifetime);
    tauri::async_runtime::spawn_blocking(move || {
        let result = build_project_index(&app, &state, &project, job_id, &cancel, &pause);
        if let Err(error) = result {
            if cancel.load(Ordering::Relaxed) {
                return;
            }
            let unsupported = error.contains("FTS5 is unavailable")
                || error.contains("no such module: fts5")
                || error.contains("no such tokenizer");
            let mut failed = get_active_status(&state, &project.preference_key)
                .unwrap_or_else(|| initial_build_status(project.display_path.clone()));
            failed.state = if unsupported {
                "unsupported".to_string()
            } else {
                "failed".to_string()
            };
            failed.phase = "failed".to_string();
            failed.backend = "scan".to_string();
            failed.updated_at = Some(now_ms());
            failed.error = Some(error);
            set_status(&app, &state, &project.preference_key, job_id, failed);
        }
    });

    Ok(status)
}

fn build_project_index(
    app: &AppHandle,
    state: &SearchIndexState,
    project: &ResolvedProject,
    job_id: u64,
    cancel: &AtomicBool,
    pause: &AtomicBool,
) -> Result<(), String> {
    let runtime = state.runtime(&project.preference_key)?;
    let _writer = runtime
        .writer
        .lock()
        .map_err(|_| "Failed to lock index writer")?;
    if cancel.load(Ordering::Relaxed) {
        return Ok(());
    }
    let start_revision = runtime
        .changes
        .lock()
        .map_err(|_| "Failed to read pending index changes")?
        .revision;
    let index_dir = index_directory(app, project)?;
    fs::create_dir_all(&index_dir)
        .map_err(|error| format!("Failed to create search index directory: {error}"))?;
    let existing_path = index_dir.join("index.sqlite3");
    if existing_path.exists() {
        match inspect_index_health(&existing_path) {
            IndexHealth::Healthy => {}
            IndexHealth::Corrupt(reason) => {
                quarantine_corrupt_index(&existing_path)
                    .map_err(|error| format!("{reason}; {error}"))?;
            }
            IndexHealth::Unavailable(reason) => return Err(reason),
        }
    }
    cleanup_temporary_indexes(&index_dir);
    let temp_path = index_dir.join(format!("index.build-{job_id}.sqlite3"));
    if temp_path.exists() {
        fs::remove_file(&temp_path)
            .map_err(|error| format!("Failed to remove stale temporary index: {error}"))?;
    }

    let mut status = get_active_status(state, &project.preference_key)
        .unwrap_or_else(|| initial_build_status(project.display_path.clone()));
    status.state = "preflight".into();
    status.phase = "discovering".into();
    let mut last_emit = Instant::now();
    let candidates = discover_candidates(project, cancel, pause, |discovered, bytes, skipped| {
        status.processed_files = discovered;
        status.processed_bytes = bytes;
        status.skipped_files = skipped;
        status.updated_at = Some(now_ms());
        if last_emit.elapsed() >= STATUS_EMIT_INTERVAL {
            set_status(app, state, &project.preference_key, job_id, status.clone());
            last_emit = Instant::now();
        }
    })?;
    if cancel.load(Ordering::Relaxed) {
        return Ok(());
    }
    if !wait_while_paused(pause, cancel) {
        return Ok(());
    }

    let total_bytes = candidates.iter().map(IndexCandidate::content_bytes).sum();
    let preflight_skipped = status.skipped_files;
    status.state = "building".to_string();
    status.phase = "writing".to_string();
    status.processed_files = 0;
    status.processed_bytes = 0;
    status.total_files = Some(candidates.len() as u64);
    status.total_bytes = Some(total_bytes);
    status.indexed_files = 0;
    status.updated_at = Some(now_ms());
    set_status(app, state, &project.preference_key, job_id, status.clone());

    // Publish paths before the first full-text build, using the same discovery pass.
    // Existing caches remain searchable during rebuilds.
    if status.enabled && !existing_path.exists() {
        write_index_database(
            false,
            &temp_path,
            project,
            &candidates,
            cancel,
            pause,
            |_, _, _, _| {},
        )?;
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        if !publish_build(state, project, job_id, &index_dir, &temp_path)? {
            return Ok(());
        }
    }
    let build_result = write_index_database(
        status.enabled,
        &temp_path,
        project,
        &candidates,
        cancel,
        pause,
        |processed, indexed, skipped, bytes| {
            status.processed_files = processed;
            status.indexed_files = indexed;
            status.skipped_files = preflight_skipped.saturating_add(skipped);
            status.processed_bytes = bytes;
            status.updated_at = Some(now_ms());
            if last_emit.elapsed() >= STATUS_EMIT_INTERVAL || processed == candidates.len() as u64 {
                set_status(app, state, &project.preference_key, job_id, status.clone());
                last_emit = Instant::now();
            }
        },
    );

    if cancel.load(Ordering::Relaxed) {
        let _ = fs::remove_file(&temp_path);
        return Ok(());
    }
    if let Err(error) = build_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    status.phase = "finalizing".to_string();
    status.updated_at = Some(now_ms());
    set_status(app, state, &project.preference_key, job_id, status.clone());
    if !publish_build(state, project, job_id, &index_dir, &temp_path)? {
        return Ok(());
    }
    let _lifetime = project.live()?;

    if let Ok(mut changes) = runtime.changes.lock() {
        changes.acknowledge(start_revision, Instant::now());
    }

    let final_path = index_dir.join("index.sqlite3");
    status.state = "ready".to_string();
    status.phase = "ready".to_string();
    status.backend = "fts5".to_string();
    status.index_size_bytes = fs::metadata(&final_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    touch_index_usage(&index_dir);
    enforce_storage_quota(app, Some(&index_dir))?;
    status.updated_at = Some(now_ms());
    status.error = None;
    set_status(app, state, &project.preference_key, job_id, status);
    Ok(())
}

fn discover_candidates<F>(
    project: &ResolvedProject,
    cancel: &AtomicBool,
    pause: &AtomicBool,
    mut progress: F,
) -> Result<Vec<IndexCandidate>, String>
where
    F: FnMut(u64, u64, u64),
{
    let filter_root = project.path.clone();
    let mut builder = WalkBuilder::new(&project.path);
    builder
        .hidden(false)
        .follow_links(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .add_custom_ignore_filename(".rgignore")
        .filter_entry(move |entry| {
            if entry.depth() == 0 || !entry.file_type().is_some_and(|kind| kind.is_dir()) {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            let is_builtin = IGNORED_DIRECTORIES
                .iter()
                .any(|ignored| name.eq_ignore_ascii_case(ignored));
            !is_builtin && entry.path().starts_with(&filter_root)
        });

    let mut candidates = Vec::new();
    let mut discovered_bytes = 0_u64;
    let mut skipped = 0_u64;
    for entry in builder.build() {
        if !wait_while_paused(pause, cancel) {
            break;
        }
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let Some(file_type) = entry.file_type() else {
            skipped += 1;
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let Some(relative_path) = entry
            .path()
            .strip_prefix(&project.path)
            .ok()
            .and_then(Path::to_str)
            .map(|path| path.replace('\\', "/"))
        else {
            skipped += 1;
            continue;
        };
        if metadata.len() <= MAX_FILE_BYTES {
            discovered_bytes = discovered_bytes.saturating_add(metadata.len());
        }
        candidates.push(IndexCandidate {
            path: entry.path().to_path_buf(),
            relative_path,
            size: metadata.len(),
            modified_ns: modified_ns(&metadata),
        });
        progress(candidates.len() as u64, discovered_bytes, skipped);
    }
    Ok(candidates)
}

fn modified_ns(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn candidate_for_existing_path(
    project: &ResolvedProject,
    path: &Path,
) -> Result<Option<IndexCandidate>, String> {
    let relative_path = match path
        .strip_prefix(&project.path)
        .ok()
        .and_then(Path::to_str)
        .map(|path| path.replace('\\', "/"))
    {
        Some(relative_path) if !relative_path.is_empty() => relative_path,
        _ => return Ok(None),
    };
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) | Err(_) => return Ok(None),
    };

    if is_under_ignored_directory(&project.path, path)
        || path_is_ignored_by_project_rules(project, path)
    {
        return Ok(None);
    }

    Ok(Some(IndexCandidate {
        path: path.to_path_buf(),
        relative_path,
        size: metadata.len(),
        modified_ns: modified_ns(&metadata),
    }))
}

fn first_ignore_file_match(
    project: &ResolvedProject,
    path: &Path,
    file_name: &str,
) -> Option<bool> {
    let mut directory = path.parent()?.to_path_buf();
    loop {
        let ignore_path = directory.join(file_name);
        if ignore_path.is_file() {
            let mut builder = GitignoreBuilder::new(&directory);
            if builder.add(&ignore_path).is_none() {
                if let Ok(matcher) = builder.build() {
                    match matcher.matched(path, false) {
                        Match::Ignore(_) => return Some(true),
                        Match::Whitelist(_) => return Some(false),
                        Match::None => {}
                    }
                }
            }
        }
        if directory == project.path {
            break;
        }
        directory = directory.parent()?.to_path_buf();
    }
    None
}

fn project_has_git_directory(project: &ResolvedProject) -> bool {
    let mut directory = Some(project.path.as_path());
    while let Some(path) = directory {
        if path.join(".git").exists() {
            return true;
        }
        directory = path.parent();
    }
    false
}

fn path_is_ignored_by_project_rules(project: &ResolvedProject, path: &Path) -> bool {
    // This mirrors the ignore precedence used by the full walker: .rgignore,
    // .ignore, repository .gitignore/.git-info-exclude, then global Git
    // ignore. The closest matching file wins within each rule class.
    for file_name in [".rgignore", ".ignore"] {
        if let Some(ignored) = first_ignore_file_match(project, path, file_name) {
            return ignored;
        }
    }
    if project_has_git_directory(project) {
        for file_name in [".gitignore", ".git/info/exclude"] {
            if let Some(ignored) = first_ignore_file_match(project, path, file_name) {
                return ignored;
            }
        }
        let (global, _) = GitignoreBuilder::new(&project.path).build_global();
        if global.matched(path, false).is_ignore() {
            return true;
        }
    }
    false
}

fn update_index_metadata(
    transaction: &rusqlite::Transaction<'_>,
) -> Result<IndexUpdateSummary, String> {
    let summary = transaction
        .query_row(
            "SELECT
                count(*),
                count(CASE WHEN status = 'indexed' THEN 1 END),
                count(CASE WHEN status = 'skipped' THEN 1 END),
                coalesce(sum(CASE WHEN size <= ?1 THEN size ELSE 0 END), 0)
             FROM indexed_files",
            [MAX_FILE_BYTES],
            |row| {
                Ok(IndexUpdateSummary {
                    total_files: row.get::<_, i64>(0)? as u64,
                    indexed_files: row.get::<_, i64>(1)? as u64,
                    skipped_files: row.get::<_, i64>(2)? as u64,
                    total_bytes: row.get::<_, i64>(3)? as u64,
                })
            },
        )
        .map_err(|error| format!("Failed to recalculate index metadata: {error}"))?;
    let updated_at = now_ms().to_string();
    for (key, value) in [
        ("state", "ready".to_string()),
        ("built_at", updated_at),
        ("total_files", summary.total_files.to_string()),
        ("indexed_files", summary.indexed_files.to_string()),
        ("skipped_files", summary.skipped_files.to_string()),
        ("total_bytes", summary.total_bytes.to_string()),
    ] {
        transaction
            .execute(
                "UPDATE index_meta SET value = ?2 WHERE key = ?1",
                params![key, value],
            )
            .map_err(|error| format!("Failed to update index metadata: {error}"))?;
    }
    Ok(summary)
}

fn apply_incremental_updates(
    full_text: bool,
    database_path: &Path,
    project: &ResolvedProject,
    paths: &[PathBuf],
) -> Result<IndexUpdateSummary, String> {
    let mut connection = Connection::open(database_path)
        .map_err(|error| format!("Failed to open search index for update: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|error| format!("Failed to configure search index update: {error}"))?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Failed to start incremental index transaction: {error}"))?;
    let has_bigrams = short_queries::ready(&transaction);
    let mut seen = HashSet::new();
    for path in paths {
        let Some(relative_path) = path
            .strip_prefix(&project.path)
            .ok()
            .and_then(Path::to_str)
            .map(|path| path.replace('\\', "/"))
        else {
            continue;
        };
        if !seen.insert(relative_path.clone()) {
            continue;
        }
        let old = transaction
            .query_row(
                "SELECT id, status FROM indexed_files WHERE relative_path = ?1",
                [&relative_path],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .ok();
        if let Some((row_id, status)) = old {
            if status == IndexedFileStatus::Indexed.as_str() {
                if has_bigrams {
                    short_queries::remove(&transaction, row_id)
                        .map_err(|error| error.to_string())?;
                }
                transaction
                    .execute("DELETE FROM content_fts WHERE rowid = ?1", [row_id])
                    .map_err(|error| format!("Failed to remove outdated FTS row: {error}"))?;
            }
            transaction
                .execute("DELETE FROM indexed_files WHERE id = ?1", [row_id])
                .map_err(|error| format!("Failed to remove outdated index entry: {error}"))?;
        }
        let Some(candidate) = candidate_for_existing_path(project, path)? else {
            continue;
        };
        let indexed_at = now_ms() as i64;
        match candidate.read_content(full_text) {
            Some((content, encoding)) => {
                transaction
                    .execute(
                        "INSERT INTO indexed_files
                         (relative_path, size, modified_ns, encoding, status, indexed_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![
                            candidate.relative_path,
                            candidate.size as i64,
                            candidate.modified_ns,
                            encoding.as_str(),
                            IndexedFileStatus::Indexed.as_str(),
                            indexed_at,
                        ],
                    )
                    .map_err(|error| {
                        format!("Failed to insert incremental index entry: {error}")
                    })?;
                let row_id = transaction.last_insert_rowid();
                if has_bigrams {
                    short_queries::insert(&transaction, row_id, &content)
                        .map_err(|error| error.to_string())?;
                }
                transaction
                    .execute(
                        "INSERT INTO content_fts(rowid, content) VALUES (?1, ?2)",
                        params![row_id, content],
                    )
                    .map_err(|error| format!("Failed to insert incremental FTS entry: {error}"))?;
            }
            None => {
                transaction
                    .execute(
                        "INSERT INTO indexed_files
                         (relative_path, size, modified_ns, encoding, status, indexed_at)
                         VALUES (?1, ?2, ?3, NULL, ?4, ?5)",
                        params![
                            candidate.relative_path,
                            candidate.size as i64,
                            candidate.modified_ns,
                            IndexedFileStatus::Skipped.as_str(),
                            indexed_at,
                        ],
                    )
                    .map_err(|error| {
                        format!("Failed to record incrementally skipped file: {error}")
                    })?;
            }
        }
    }
    if !full_text && !seen.is_empty() {
        transaction
            .execute(
                "INSERT OR REPLACE INTO index_meta(key, value) VALUES ('full_text_ready', '0')",
                [],
            )
            .map_err(|error| error.to_string())?;
    }
    let _lifetime = project.live()?;
    let summary = update_index_metadata(&transaction)?;
    transaction
        .commit()
        .map_err(|error| format!("Failed to commit incremental index update: {error}"))?;
    Ok(summary)
}

fn write_index_database<F>(
    full_text: bool,
    path: &Path,
    project: &ResolvedProject,
    candidates: &[IndexCandidate],
    cancel: &AtomicBool,
    pause: &AtomicBool,
    mut progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, u64, u64, u64),
{
    let mut connection = Connection::open(path)
        .map_err(|error| format!("Failed to create temporary search index: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = DELETE;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             CREATE TABLE index_meta (
               key TEXT PRIMARY KEY NOT NULL,
               value TEXT NOT NULL
             );
             CREATE TABLE indexed_files (
               id INTEGER PRIMARY KEY,
               relative_path TEXT UNIQUE NOT NULL,
               size INTEGER NOT NULL,
               modified_ns INTEGER NOT NULL,
               encoding TEXT,
               status TEXT NOT NULL CHECK(status IN ('indexed', 'skipped')),
               indexed_at INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("Failed to create project file catalog: {error}"))?;
    if full_text {
        connection
            .execute_batch(
                "CREATE VIRTUAL TABLE content_fts USING fts5(
               content,
               content='',
               contentless_delete=1,
               tokenize='trigram'
             );",
            )
            .map_err(|error| format!("FTS5 is unavailable or could not initialize: {error}"))?;

        short_queries::create(&connection).map_err(|error| error.to_string())?;
    }
    let built_at = now_ms();
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Failed to start index transaction: {error}"))?;
    let mut indexed = 0_u64;
    let mut skipped = 0_u64;
    let mut processed_bytes = 0_u64;
    {
        let mut file_statement = transaction
            .prepare(
                "INSERT INTO indexed_files
                 (relative_path, size, modified_ns, encoding, status, indexed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|error| format!("Failed to prepare indexed file write: {error}"))?;
        let mut fts_statement = full_text
            .then(|| transaction.prepare("INSERT INTO content_fts(rowid, content) VALUES (?1, ?2)"))
            .transpose()
            .map_err(|error| format!("Failed to prepare FTS5 write: {error}"))?;

        for (index, candidate) in candidates.iter().enumerate() {
            if !wait_while_paused(pause, cancel) {
                return Ok(());
            }
            if cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            processed_bytes = processed_bytes.saturating_add(candidate.content_bytes());
            match candidate.read_content(full_text) {
                Some((content, encoding)) => {
                    file_statement
                        .execute(params![
                            candidate.relative_path,
                            candidate.size as i64,
                            candidate.modified_ns,
                            encoding.as_str(),
                            IndexedFileStatus::Indexed.as_str(),
                            built_at as i64,
                        ])
                        .map_err(|error| {
                            format!("Failed to index {}: {error}", candidate.relative_path)
                        })?;
                    let row_id = transaction.last_insert_rowid();
                    short_queries::insert(&transaction, row_id, &content)
                        .map_err(|error| error.to_string())?;
                    fts_statement
                        .as_mut()
                        .ok_or("Missing full-text writer")?
                        .execute(params![row_id, content])
                        .map_err(|error| {
                            format!(
                                "Failed to write FTS data for {}: {error}",
                                candidate.relative_path
                            )
                        })?;
                    indexed += 1;
                }
                None => {
                    file_statement
                        .execute(params![
                            candidate.relative_path,
                            candidate.size as i64,
                            candidate.modified_ns,
                            Option::<String>::None,
                            IndexedFileStatus::Skipped.as_str(),
                            built_at as i64,
                        ])
                        .map_err(|error| {
                            format!(
                                "Failed to record skipped {}: {error}",
                                candidate.relative_path
                            )
                        })?;
                    skipped += 1;
                }
            }
            progress(index as u64 + 1, indexed, skipped, processed_bytes);
        }
    }

    if cancel.load(Ordering::Relaxed) {
        return Ok(());
    }
    let metadata = [
        (
            "full_text_ready",
            if full_text { "1" } else { "0" }.to_string(),
        ),
        (
            "cjk_bigrams_version",
            if full_text { "1" } else { "0" }.to_string(),
        ),
        ("schema_version", INDEX_SCHEMA_VERSION.to_string()),
        ("project_path", project.display_path.clone()),
        ("project_key", project.preference_key.clone()),
        ("state", "ready".to_string()),
        ("built_at", built_at.to_string()),
        ("total_files", candidates.len().to_string()),
        ("indexed_files", indexed.to_string()),
        ("skipped_files", skipped.to_string()),
        ("total_bytes", processed_bytes.to_string()),
    ];
    for (key, value) in metadata {
        transaction
            .execute(
                "INSERT INTO index_meta(key, value) VALUES (?1, ?2)",
                params![key, value],
            )
            .map_err(|error| format!("Failed to write index metadata: {error}"))?;
    }
    if full_text {
        transaction
            .execute(
                "INSERT INTO content_fts(content_fts) VALUES ('optimize')",
                [],
            )
            .map_err(|error| format!("Failed to optimize FTS5 index: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Failed to commit search index: {error}"))?;

    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| format!("Failed to verify search index: {error}"))?;
    if integrity != "ok" {
        return Err(format!("Search index integrity check failed: {integrity}"));
    }
    if !full_text {
        return Ok(());
    }
    let fts_count: u64 = connection
        .query_row("SELECT count(*) FROM content_fts", [], |row| row.get(0))
        .map_err(|error| format!("Failed to verify FTS5 rows: {error}"))?;
    if fts_count != indexed {
        return Err(format!(
            "Search index row count mismatch: expected {indexed}, found {fts_count}"
        ));
    }
    Ok(())
}

fn read_text_file(path: &Path) -> Result<(String, TextEncoding), String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("file grew beyond the index size limit".to_string());
    }
    if bytes.starts_with(&[0xff, 0xfe]) {
        return decode_utf16(&bytes[2..], true).map(|text| (text, TextEncoding::Utf16Le));
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        return decode_utf16(&bytes[2..], false).map(|text| (text, TextEncoding::Utf16Be));
    }
    if bytes.contains(&0) {
        return Err("binary file".to_string());
    }
    if let Some(content) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8(content.to_vec())
            .map(|text| (text, TextEncoding::Utf8Bom))
            .map_err(|error| error.to_string());
    }
    String::from_utf8(bytes)
        .map(|text| (text, TextEncoding::Utf8))
        .map_err(|error| error.to_string())
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Result<String, String> {
    if bytes.len() % 2 != 0 {
        return Err("invalid UTF-16 byte length".to_string());
    }
    let units = bytes.chunks_exact(2).map(|pair| {
        if little_endian {
            u16::from_le_bytes([pair[0], pair[1]])
        } else {
            u16::from_be_bytes([pair[0], pair[1]])
        }
    });
    std::char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .map_err(|error| error.to_string())
}

fn publish_build(
    state: &SearchIndexState,
    project: &ResolvedProject,
    job_id: u64,
    index_dir: &Path,
    temp_path: &Path,
) -> Result<bool, String> {
    let mut delay = Duration::from_millis(15);
    loop {
        {
            let Ok(_lifetime) = project.live() else {
                let _ = fs::remove_file(temp_path);
                return Ok(false);
            };
            let entries = state
                .entries
                .lock()
                .map_err(|_| "Failed to publish project file catalog")?;
            if !entries.get(&project.preference_key).is_some_and(|entry| {
                entry.job_id == job_id && !entry.cancel.load(Ordering::Relaxed)
            }) {
                let _ = fs::remove_file(temp_path);
                return Ok(false);
            }
            match replace_index_atomically(index_dir, temp_path) {
                Ok(()) => {
                    state.catalog_changed.notify_all();
                    return Ok(true);
                }
                // SQLite readers on Windows hold handles without FILE_SHARE_DELETE.
                Err(error) if cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33)) => {}
                Err(error) => return Err(format!("Failed to publish search index: {error}")),
            }
        }
        // Never hold the job registry while a reader drains or the project is closing.
        std::thread::sleep(delay);
        delay = (delay * 2).min(Duration::from_millis(250));
    }
}

fn replace_index_atomically(index_dir: &Path, temp_path: &Path) -> std::io::Result<()> {
    let final_path = index_dir.join("index.sqlite3");
    // Both files are in the same directory. Rust uses a replace-existing rename
    // on Windows as well; a failed rename leaves the previous index in place.
    let result = fs::rename(temp_path, &final_path);
    #[cfg(windows)]
    if result.as_ref().err().and_then(std::io::Error::raw_os_error) == Some(5) {
        use std::os::windows::fs::OpenOptionsExt;
        // Replacing an open destination may return ACCESS_DENIED. Requesting
        // DELETE on it gives the sharing violation if SQLite still holds it.
        // If the reader has drained, this handle prevents a fresh incompatible
        // reader racing the second rename. Genuine access errors propagate.
        const DELETE_ACCESS: u32 = 0x0001_0000;
        let _delete_access = match fs::OpenOptions::new()
            .access_mode(DELETE_ACCESS)
            .open(&final_path)
        {
            Ok(handle) => Some(handle),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error),
        };
        return fs::rename(temp_path, &final_path);
    }
    result
}

fn cleanup_temporary_indexes(index_dir: &Path) {
    let Ok(entries) = fs::read_dir(index_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if file_name.starts_with("index.build-") && file_name.ends_with(".sqlite3") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

enum IndexHealth {
    Healthy,
    Corrupt(String),
    Unavailable(String),
}

fn inspect_index_health(path: &Path) -> IndexHealth {
    // FTS5 may require a writable handle for its virtual-table integrity check.
    // Open only an existing cache; an access or lock error is not evidence of corruption.
    let classify = |error: rusqlite::Error| match error.sqlite_error_code() {
        Some(rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase) => {
            IndexHealth::Corrupt(error.to_string())
        }
        _ => IndexHealth::Unavailable(error.to_string()),
    };
    let connection = match Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE) {
        Ok(connection) => connection,
        Err(error) => return classify(error),
    };
    match connection.query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0)) {
        Ok(result) if result == "ok" => IndexHealth::Healthy,
        // FTS5 reports operational failures as rows too (e.g. a read-only volume).
        Ok(result) if result.contains("unable to validate the inverted index") => {
            IndexHealth::Unavailable(result)
        }
        Ok(result) => IndexHealth::Corrupt(format!("quick_check returned {result}")),
        Err(error) => classify(error),
    }
}

fn quarantine_corrupt_index(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let quarantine = path.with_file_name(format!("index.corrupt-{}.sqlite3", now_ms()));
    fs::rename(path, &quarantine)
        .map_err(|error| format!("Failed to isolate corrupt search index: {error}"))?;
    Ok(Some(quarantine))
}

fn recover_unusable_index(
    app: &AppHandle,
    state: &SearchIndexState,
    project: &ResolvedProject,
    reason: String,
) {
    // 检查和隔离由持有 writer 锁的构建任务完成，避免与增量提交争用文件。
    mark_index_for_rebuild(app, state, project, Some(reason));
    let _ = start_index_build(app.clone(), state.clone(), project.clone(), true);
}

fn load_ready_status(
    app: &AppHandle,
    project: &ResolvedProject,
    full_text: bool,
) -> Option<ProjectSearchIndexStatus> {
    let index_dir = index_directory(app, project).ok()?;
    let final_path = index_dir.join("index.sqlite3");
    let backup_path = index_dir.join("index.sqlite3.backup");
    if !final_path.exists() && backup_path.exists() {
        fs::rename(&backup_path, &final_path).ok()?;
    }
    if let IndexHealth::Corrupt(_) = inspect_index_health(&final_path) {
        let _ = quarantine_corrupt_index(&final_path);
        return None;
    }
    let connection =
        Connection::open_with_flags(&final_path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let read_meta = |key: &str| -> Option<String> {
        connection
            .query_row(
                "SELECT value FROM index_meta WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .ok()
    };
    if read_meta("schema_version")?.parse::<u32>().ok()? != INDEX_SCHEMA_VERSION
        || read_meta("project_key")? != project.preference_key
        || read_meta("state")?.as_str() != "ready"
        || (full_text && read_meta("full_text_ready").as_deref() == Some("0"))
    {
        return None;
    }
    let indexed_files = read_meta("indexed_files")?.parse().ok()?;
    let skipped_files = read_meta("skipped_files")?.parse().ok()?;
    let total_files = read_meta("total_files")?.parse().ok()?;
    let total_bytes = read_meta("total_bytes")?.parse().ok()?;
    let built_at = read_meta("built_at")?.parse().ok()?;
    Some(ProjectSearchIndexStatus {
        project_path: project.display_path.clone(),
        enabled: full_text,
        state: "ready".to_string(),
        backend: "fts5".to_string(),
        phase: "ready".to_string(),
        processed_files: total_files,
        total_files: Some(total_files),
        indexed_files,
        skipped_files,
        processed_bytes: total_bytes,
        total_bytes: Some(total_bytes),
        index_size_bytes: fs::metadata(final_path).map(|meta| meta.len()).unwrap_or(0),
        started_at: None,
        updated_at: Some(built_at),
        error: None,
    })
}

// 重启后核对离线变更，健康缓存无需重新生成整份全文索引。
fn restore_project_index(
    app: &AppHandle,
    state: &SearchIndexState,
    project: &ResolvedProject,
) -> Result<Option<ProjectSearchIndexStatus>, String> {
    let full_text = app
        .state::<Arc<Database>>()
        .load_project_search_index_enabled(&project.preference_key)?;
    let _lifetime = project.live()?;
    let Some(status) = load_ready_status(app, project, full_text) else {
        return Ok(None);
    };
    ensure_project_watcher(app, state, project)?;
    state
        .runtime(&project.preference_key)?
        .changes
        .lock()
        .map_err(|_| "Failed to schedule index reconciliation")?
        .record(Vec::new(), true, Instant::now());
    let mut entries = state
        .entries
        .lock()
        .map_err(|_| "Failed to restore search index state")?;
    // 状态查询和搜索可能并发恢复同一项目，不能覆盖已经启动的构建任务。
    if let Some(entry) = entries
        .get(&project.preference_key)
        .filter(|entry| entry.status.enabled == full_text)
    {
        return Ok(Some(entry.status.clone()));
    }
    if let Some(previous) = entries.get(&project.preference_key) {
        previous.cancel.store(true, Ordering::Relaxed);
    }
    entries.insert(
        project.preference_key.clone(),
        ActiveEntry {
            job_id: state.next_job_id.fetch_add(1, Ordering::Relaxed) + 1,
            cancel: Arc::new(AtomicBool::new(false)),
            pause: Arc::new(AtomicBool::new(false)),
            status: status.clone(),
            fallback_paths: None,
        },
    );
    drop(entries);
    if full_text {
        schedule_short_query_upgrade(app, state, project);
    }
    let _ = app.emit("search-index-status", content_status(status.clone()));
    Ok(Some(status))
}

fn quote_fts5_literal(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}

// 向缺少双字表的索引追加双字表，保留现有路径、三元词和文件 ID；不重新发现目录。
fn upgrade_short_query_database(
    path: &Path,
    project: &ResolvedProject,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let mut connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|error| error.to_string())?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|error| error.to_string())?;
    if short_queries::ready(&connection) {
        return Ok(());
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    short_queries::create(&transaction).map_err(|error| error.to_string())?;
    let rows = {
        let mut statement = transaction
            .prepare("SELECT id, relative_path FROM indexed_files WHERE status = 'indexed'")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
    };
    for (id, relative) in rows {
        if cancel.load(Ordering::Relaxed) {
            return Err("Index upgrade cancelled".into());
        }
        if !Path::new(&relative)
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)))
        {
            continue;
        }
        if let Ok((content, _)) = read_text_file(&project.path.join(relative)) {
            short_queries::insert(&transaction, id, &content).map_err(|error| error.to_string())?;
        }
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Index upgrade cancelled".into());
    }
    let _lifetime = project.live()?;
    short_queries::mark_ready(&transaction).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

fn schedule_short_query_upgrade(
    app: &AppHandle,
    state: &SearchIndexState,
    project: &ResolvedProject,
) {
    let Ok(runtime) = state.runtime(&project.preference_key) else {
        return;
    };
    if runtime.short_query_upgrade.swap(true, Ordering::Relaxed) {
        return;
    }
    let active = state
        .entries
        .lock()
        .ok()
        .and_then(|entries| entries.get(&project.preference_key).cloned());
    let Some(active) = active else {
        runtime.short_query_upgrade.store(false, Ordering::Relaxed);
        return;
    };
    let app = app.clone();
    let state = state.clone();
    let project = project.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| -> Result<u64, String> {
            let _writer = runtime
                .writer
                .lock()
                .map_err(|_| "Failed to lock index writer".to_string())?;
            if active.cancel.load(Ordering::Relaxed) {
                return Ok(0);
            }
            let path = index_directory(&app, &project)?.join("index.sqlite3");
            upgrade_short_query_database(&path, &project, &active.cancel)?;
            Ok(fs::metadata(path)
                .map(|metadata| metadata.len())
                .unwrap_or(0))
        })();
        runtime.short_query_upgrade.store(false, Ordering::Relaxed);
        if active.cancel.load(Ordering::Relaxed) {
            return;
        }
        let status = state.entries.lock().ok().and_then(|mut entries| {
            let entry = entries.get_mut(&project.preference_key)?;
            if entry.job_id != active.job_id {
                return None;
            }
            match result {
                Ok(size) => {
                    entry.status.index_size_bytes = size;
                    entry.status.error = None;
                }
                Err(error) => entry.status.error = Some(error),
            }
            Some(entry.status.clone())
        });
        if let Some(status) = status {
            let _ = app.emit("search-index-status", content_status(status));
        }
    });
}

pub(super) fn search_project_entry_index(
    app: &AppHandle,
    project: &ResolvedProject,
    query: &str,
) -> Result<Vec<super::file_tree::FileTreeEntry>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }
    with_project_entry_index(app, project, |connection, project| {
        super::file_tree::search_indexed_project_entries(connection, &project.path, query)
    })
}

pub(super) fn terminal_entry_index(
    app: &AppHandle,
    project: &ResolvedProject,
    root: &Path,
    name: &str,
) -> Result<super::terminal_links::TerminalLinkResolution, String> {
    with_project_entry_index(app, project, |connection, _| {
        super::terminal_links::search_indexed_exact_name(connection, root, name, 32)
    })
}

fn with_project_entry_index<T>(
    app: &AppHandle,
    project: &ResolvedProject,
    query: impl FnOnce(&Connection, &ResolvedProject) -> Result<T, String>,
) -> Result<T, String> {
    drop(project.live()?);
    let path = index_directory(app, project)?.join("index.sqlite3");
    if !path.is_file() {
        let state = app.state::<SearchIndexState>();
        let runtime = state.runtime(&project.preference_key)?;
        let _control = runtime
            .control
            .lock()
            .map_err(|_| "Failed to lock index settings")?;
        if !path.is_file() {
            match get_active_status(&state, &project.preference_key) {
                Some(status) if status.state == "ready" => {
                    start_index_build(app.clone(), state.inner().clone(), project.clone(), true)?;
                }
                None => {
                    start_index_build(app.clone(), state.inner().clone(), project.clone(), false)?;
                }
                _ => {}
            }
            drop(_control);
            // A first query can arrive during discovery. Wake it as soon as paths are
            // published, without waiting for the much longer text indexing phase.
            let entries = state
                .entries
                .lock()
                .map_err(|_| "search-index-unavailable")?;
            let (_entries, timeout) = state
                .catalog_changed
                .wait_timeout_while(entries, Duration::from_secs(30), |entries| {
                    entries.get(&project.preference_key).is_some_and(|entry| {
                        matches!(entry.status.state.as_str(), "preflight" | "building")
                            && !path.is_file()
                    })
                })
                .map_err(|_| "search-index-unavailable")?;
            if timeout.timed_out() && !path.is_file() {
                return Err("search-index-building".into());
            }
        }
    }
    let state = app.state::<SearchIndexState>();
    let fallback = {
        let _lifetime = project.live()?;
        let mut entries = state
            .entries
            .lock()
            .map_err(|_| "search-index-unavailable")?;
        entries
            .get_mut(&project.preference_key)
            .filter(|entry| {
                entry.fallback_paths.is_some()
                    || matches!(
                        entry.status.state.as_str(),
                        "paused" | "failed" | "unsupported"
                    )
            })
            .map(|entry| {
                (
                    entry
                        .fallback_paths
                        .get_or_insert_with(Default::default)
                        .clone(),
                    entry.cancel.clone(),
                )
            })
    };
    if let Some((catalog, cancel)) = fallback {
        return catalog
            .lock()
            .map_err(|_| "search-index-unavailable")?
            .query(project, &cancel, query);
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "search-index-unavailable".to_string())?;
    connection
        .busy_timeout(Duration::from_millis(50))
        .map_err(|error| error.to_string())?;
    let compatible: bool = connection
        .query_row(
            "SELECT (SELECT value FROM index_meta WHERE key = 'schema_version') = ?1
            AND (SELECT value FROM index_meta WHERE key = 'project_key') = ?2
            AND (SELECT value FROM index_meta WHERE key = 'state') = 'ready'",
            params![INDEX_SCHEMA_VERSION.to_string(), project.preference_key],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !compatible {
        return Err("search-index-unavailable".into());
    }
    let results = query(&connection, project)?;
    drop(project.live()?);
    Ok(results)
}

fn query_candidate_relative_paths(
    connection: &Connection,
    query: &str,
    limit: usize,
) -> rusqlite::Result<Vec<String>> {
    if let Some(token) = short_queries::token(query) {
        return short_queries::query(connection, &token, limit);
    }
    let mut statement = connection.prepare(
        "SELECT indexed_files.relative_path
         FROM content_fts
         JOIN indexed_files ON indexed_files.id = content_fts.rowid
         WHERE content_fts MATCH ?1 LIMIT ?2",
    )?;
    let rows = statement.query_map(
        params![quote_fts5_literal(query), (limit + 1) as i64],
        |row| row.get::<_, String>(0),
    )?;
    rows.collect()
}

fn pending_search_paths(runtime: &ProjectRuntime) -> Result<HashSet<PathBuf>, String> {
    let changes = runtime
        .changes
        .lock()
        .map_err(|_| "index_state_unavailable")?;
    if changes.reconcile.is_some() {
        return Err("index_reconciling".to_string());
    }
    Ok(changes.paths.keys().cloned().collect())
}

fn merge_search_candidates(
    project: &ResolvedProject,
    relative_paths: Vec<String>,
    pending: HashSet<PathBuf>,
) -> Vec<PathBuf> {
    let mut paths: HashSet<PathBuf> = relative_paths
        .into_iter()
        .filter(|relative| {
            Path::new(relative)
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_)))
        })
        .map(|relative| project.path.join(relative))
        .collect();
    paths.extend(pending.into_iter().filter(|path| {
        candidate_for_existing_path(project, path)
            .ok()
            .flatten()
            .is_some()
    }));
    paths.into_iter().collect()
}

fn sqlite_is_busy(error: &rusqlite::Error) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
    )
}

pub(super) fn lookup_index_candidates(
    app: &AppHandle,
    project: &ResolvedProject,
    query: &str,
    use_regex: bool,
) -> Result<IndexCandidateLookup, String> {
    drop(project.live()?);
    let lookup = lookup_index_candidates_inner(app, project, query, use_regex);
    drop(project.live()?);
    Ok(enforce_short_query_index(query, use_regex, lookup))
}

fn enforce_short_query_index(
    query: &str,
    use_regex: bool,
    lookup: IndexCandidateLookup,
) -> IndexCandidateLookup {
    // 两字中文的索引尚不可用时明确等待，绝不能悄悄退回目录扫描。
    if !use_regex && short_queries::token(query.trim()).is_some() {
        if let IndexCandidateLookup::Fallback {
            reason,
            index_state,
        } = &lookup
        {
            let error = match reason.as_str() {
                "index_disabled" => "short-query-index-disabled",
                "index_busy" | "index_reconciling" | "index_changed_during_query" => {
                    "short-query-index-waiting"
                }
                "index_open_failed_rebuilding" | "index_query_failed_rebuilding" => {
                    "short-query-index-waiting"
                }
                "index_not_ready" if index_state == "paused" => "short-query-index-paused",
                "index_not_ready"
                    if matches!(
                        index_state.as_str(),
                        "preflight" | "building" | "updating" | "stale"
                    ) =>
                {
                    "short-query-index-waiting"
                }
                _ => "short-query-index-unavailable",
            };
            return IndexCandidateLookup::ShortQueryError(error);
        }
    }
    lookup
}

fn lookup_index_candidates_inner(
    app: &AppHandle,
    project: &ResolvedProject,
    query: &str,
    use_regex: bool,
) -> IndexCandidateLookup {
    let query = query.trim();
    if use_regex || query.contains('\n') || query.contains('\r') {
        return IndexCandidateLookup::Fallback {
            reason: if use_regex {
                "regex_query"
            } else {
                "multiline_query"
            }
            .to_string(),
            index_state: "not_applicable".to_string(),
        };
    }
    if (query.chars().count() < 3 && short_queries::token(query).is_none()) || query.contains('\0')
    {
        return IndexCandidateLookup::Fallback {
            reason: "query_too_short".to_string(),
            index_state: "not_applicable".to_string(),
        };
    }
    let database = app.state::<Arc<Database>>();
    let enabled = match database.load_project_search_index_enabled(&project.preference_key) {
        Ok(enabled) => enabled,
        Err(reason) => {
            return IndexCandidateLookup::Fallback {
                reason,
                index_state: "unavailable".into(),
            }
        }
    };
    if !enabled {
        return IndexCandidateLookup::Fallback {
            reason: "index_disabled".to_string(),
            index_state: "disabled".to_string(),
        };
    }

    let state = app.state::<SearchIndexState>();
    if get_active_status(&state, &project.preference_key).is_none() {
        if let Ok(_control) = project.runtime.control.lock() {
            if database.load_project_search_index_enabled(&project.preference_key) == Ok(true) {
                let _ = ensure_index_mode(app, &state, project, true);
            }
        }
    }

    let snapshot = state.entries.lock().ok().and_then(|entries| {
        let entry = entries.get(&project.preference_key)?;
        if !entry.status.enabled || entry.status.state != "ready" {
            return None;
        }
        Some(entry.job_id)
    });
    let Some(job_id) = snapshot else {
        let index_state = get_active_status(&state, &project.preference_key)
            .map(|status| status.state)
            .unwrap_or_else(|| "unavailable".to_string());
        return IndexCandidateLookup::Fallback {
            reason: "index_not_ready".to_string(),
            index_state,
        };
    };

    let final_path = match index_directory(app, project) {
        Ok(directory) => directory.join("index.sqlite3"),
        Err(error) => {
            return IndexCandidateLookup::Fallback {
                reason: error,
                index_state: "unavailable".to_string(),
            }
        }
    };
    // 查询前后都保留脏路径；已经开始的提交可能在查询期间清理自己的批次。
    let mut pending = match pending_search_paths(&project.runtime) {
        Ok(paths) => paths,
        Err(reason) => {
            return IndexCandidateLookup::Fallback {
                reason,
                index_state: "reconciling".into(),
            }
        }
    };
    let connection =
        match Connection::open_with_flags(&final_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
            Ok(connection) => connection,
            Err(error) => {
                recover_unusable_index(
                    app,
                    state.inner(),
                    project,
                    format!("Search index could not be opened: {error}"),
                );
                return IndexCandidateLookup::Fallback {
                    reason: "index_open_failed_rebuilding".to_string(),
                    index_state: "unavailable".to_string(),
                };
            }
        };
    if let Err(error) = connection.busy_timeout(Duration::from_millis(50)) {
        return IndexCandidateLookup::Fallback {
            reason: error.to_string(),
            index_state: "ready".into(),
        };
    }
    const CANDIDATE_LIMIT: usize = 50_000;
    if short_queries::token(query).is_some() && !short_queries::ready(&connection) {
        if get_active_status(&state, &project.preference_key)
            .is_some_and(|status| status.error.is_some())
        {
            return IndexCandidateLookup::ShortQueryError("short-query-index-unavailable");
        }
        if let Ok(_lifetime) = project.live() {
            schedule_short_query_upgrade(app, state.inner(), project);
        }
        return IndexCandidateLookup::ShortQueryError("short-query-index-waiting");
    }
    let relative_paths = match query_candidate_relative_paths(&connection, query, CANDIDATE_LIMIT) {
        Ok(paths) => paths,
        Err(error) if sqlite_is_busy(&error) => {
            // 短暂锁竞争不代表损坏，不能因此触发全量重建。
            return IndexCandidateLookup::Fallback {
                reason: "index_busy".into(),
                index_state: "ready".into(),
            };
        }
        Err(reason) => {
            recover_unusable_index(
                app,
                state.inner(),
                project,
                format!("Search index query failed: {reason}"),
            );
            return IndexCandidateLookup::Fallback {
                reason: "index_query_failed_rebuilding".to_string(),
                index_state: "unavailable".to_string(),
            };
        }
    };
    if relative_paths.len() > CANDIDATE_LIMIT {
        return IndexCandidateLookup::Fallback {
            reason: "too_many_index_candidates".to_string(),
            index_state: "ready".to_string(),
        };
    }

    let still_current = state.entries.lock().ok().is_some_and(|entries| {
        entries
            .get(&project.preference_key)
            .is_some_and(|entry| entry.job_id == job_id && entry.status.state == "ready")
    });
    if !still_current {
        return IndexCandidateLookup::Fallback {
            reason: "index_changed_during_query".to_string(),
            index_state: "stale".to_string(),
        };
    }

    match pending_search_paths(&project.runtime) {
        Ok(paths) => pending.extend(paths),
        Err(reason) => {
            return IndexCandidateLookup::Fallback {
                reason,
                index_state: "reconciling".into(),
            }
        }
    }
    let paths = merge_search_candidates(project, relative_paths, pending);
    touch_index_usage(final_path.parent().unwrap_or_else(|| Path::new("")));
    IndexCandidateLookup::Ready {
        paths,
        generation: job_id,
    }
}

#[tauri::command]
pub async fn get_search_index_status(
    app: AppHandle,
    database: State<'_, Arc<Database>>,
    state: State<'_, SearchIndexState>,
    project_path: String,
) -> Result<ProjectSearchIndexStatus, String> {
    let database = database.inner().clone();
    let state = state.inner().clone();
    let project = resolve_project(&state, &project_path)?;
    crate::commands::run_background_task("get_search_index_status", move || {
        get_search_index_status_blocking(app, database, state, project)
    })
    .await
}

fn get_search_index_status_blocking(
    app: AppHandle,
    database: Arc<Database>,
    state: SearchIndexState,
    project: ResolvedProject,
) -> Result<ProjectSearchIndexStatus, String> {
    let runtime = state.runtime(&project.preference_key)?;
    let _control = runtime
        .control
        .lock()
        .map_err(|_| "Failed to lock index settings")?;
    let enabled = database.load_project_search_index_enabled(&project.preference_key)?;
    ensure_index_mode(&app, &state, &project, enabled).map(content_status)
}

fn ensure_index_mode(
    app: &AppHandle,
    state: &SearchIndexState,
    project: &ResolvedProject,
    enabled: bool,
) -> Result<ProjectSearchIndexStatus, String> {
    {
        let _lifetime = project.live()?;
        if let Some(status) = get_active_status(state, &project.preference_key) {
            if status.enabled == enabled {
                return Ok(status);
            }
            cancel_active_job(state, &project.preference_key);
        }
    }
    // A write from the previous mode can invalidate the persisted full-text cache.
    let runtime = state.runtime(&project.preference_key)?;
    let _writer = runtime
        .writer
        .lock()
        .map_err(|_| "Failed to lock index writer")?;
    if let Some(status) = restore_project_index(app, state, project)? {
        return Ok(status);
    }
    start_index_build(app.clone(), state.clone(), project.clone(), false)
}

#[tauri::command]
pub async fn set_project_index_enabled(
    app: AppHandle,
    database: State<'_, Arc<Database>>,
    state: State<'_, SearchIndexState>,
    project_path: String,
    enabled: bool,
) -> Result<ProjectSearchIndexStatus, String> {
    let database = database.inner().clone();
    let state = state.inner().clone();
    let project = resolve_project(&state, &project_path)?;
    crate::commands::run_background_task("set_project_index_enabled", move || {
        let runtime = state.runtime(&project.preference_key)?;
        let _control = runtime
            .control
            .lock()
            .map_err(|_| "Failed to lock index settings")?;
        {
            let _lifetime = project.live()?;
            database.save_project_search_index_enabled(&project.preference_key, enabled)?;
        }
        ensure_index_mode(&app, &state, &project, enabled).map(content_status)
    })
    .await
}

#[tauri::command]
pub fn rebuild_project_index(
    app: AppHandle,
    database: State<'_, Arc<Database>>,
    state: State<'_, SearchIndexState>,
    project_path: String,
) -> Result<ProjectSearchIndexStatus, String> {
    let project = resolve_project(&state, &project_path)?;
    let runtime = state.runtime(&project.preference_key)?;
    let _control = runtime
        .control
        .lock()
        .map_err(|_| "Failed to lock index settings")?;
    {
        let _lifetime = project.live()?;
        database.save_project_search_index_enabled(&project.preference_key, true)?;
    }
    start_index_build(app, state.inner().clone(), project, true)
}

#[tauri::command]
pub fn pause_project_index(
    app: AppHandle,
    state: State<'_, SearchIndexState>,
    project_path: String,
) -> Result<ProjectSearchIndexStatus, String> {
    let project = resolve_project(&state, &project_path)?;
    let status = state
        .entries
        .lock()
        .map_err(|_| "Failed to pause search index".to_string())?
        .get_mut(&project.preference_key)
        .and_then(|entry| {
            if !matches!(entry.status.state.as_str(), "preflight" | "building") {
                return None;
            }
            entry.pause.store(true, Ordering::Relaxed);
            entry.status.state = "paused".to_string();
            entry.status.phase = "paused".to_string();
            entry.status.backend = "scan".to_string();
            entry.status.updated_at = Some(now_ms());
            Some(entry.status.clone())
        })
        .ok_or_else(|| "Only an active index build can be paused".to_string())?;
    state.catalog_changed.notify_all();
    let _ = app.emit("search-index-status", content_status(status.clone()));
    Ok(status)
}

#[tauri::command]
pub fn resume_project_index(
    app: AppHandle,
    state: State<'_, SearchIndexState>,
    project_path: String,
) -> Result<ProjectSearchIndexStatus, String> {
    let project = resolve_project(&state, &project_path)?;
    let status = state
        .entries
        .lock()
        .map_err(|_| "Failed to resume search index".to_string())?
        .get_mut(&project.preference_key)
        .and_then(|entry| {
            if entry.status.state != "paused" {
                return None;
            }
            entry.pause.store(false, Ordering::Relaxed);
            entry.status.state =
                if entry.status.processed_files == 0 && entry.status.total_files.is_none() {
                    "preflight".to_string()
                } else {
                    "building".to_string()
                };
            entry.status.phase = if entry.status.state == "preflight" {
                "discovering".to_string()
            } else {
                "writing".to_string()
            };
            entry.status.updated_at = Some(now_ms());
            Some(entry.status.clone())
        })
        .ok_or_else(|| "No paused index build is available to resume".to_string())?;
    let _ = app.emit("search-index-status", content_status(status.clone()));
    Ok(status)
}

#[tauri::command]
pub async fn delete_project_index(
    app: AppHandle,
    database: State<'_, Arc<Database>>,
    state: State<'_, SearchIndexState>,
    project_path: String,
) -> Result<ProjectSearchIndexStatus, String> {
    let database = database.inner().clone();
    let state = state.inner().clone();
    crate::commands::run_background_task("delete_project_index", move || {
        delete_project_index_blocking(app, database, state, project_path)
    })
    .await
}

pub fn delete_project_index_blocking(
    app: AppHandle,
    database: Arc<Database>,
    state: SearchIndexState,
    project_path: String,
) -> Result<ProjectSearchIndexStatus, String> {
    let _storage = state
        .storage_changes
        .lock()
        .map_err(|_| "Failed to lock search index storage")?;
    let project = resolve_project(&state, &project_path)?;
    if project_has_active_index_write(&state, &project.preference_key) {
        return Err(
            "Wait for the active search index update to finish before deleting it".to_string(),
        );
    }
    cancel_active_job(&state, &project.preference_key);
    stop_project_watcher(&state, &project.preference_key);
    let index_dir = index_directory(&app, &project)?;
    if index_dir.exists() {
        fs::remove_dir_all(&index_dir).map_err(|error| {
            format!(
                "Failed to delete search index for {}: {error}",
                project.display_path
            )
        })?;
    }
    database.save_project_search_index_enabled(&project.preference_key, false)?;
    if let Ok(mut entries) = state.entries.lock() {
        entries.remove(&project.preference_key);
    }
    let status = disabled_status(project.display_path);
    let _ = app.emit("search-index-status", content_status(status.clone()));
    Ok(status)
}

#[tauri::command]
pub async fn get_search_index_storage_status(
    app: AppHandle,
) -> Result<SearchIndexStorageStatus, String> {
    crate::commands::run_background_task("get_search_index_storage_status", move || {
        get_search_index_storage_status_blocking(app)
    })
    .await
}

pub fn get_search_index_storage_status_blocking(
    app: AppHandle,
) -> Result<SearchIndexStorageStatus, String> {
    storage_status(&app)
}

#[tauri::command]
pub async fn set_search_index_storage(
    app: AppHandle,
    database: State<'_, Arc<Database>>,
    state: State<'_, SearchIndexState>,
    cache_root: Option<String>,
    quota_bytes: u64,
) -> Result<SearchIndexStorageStatus, String> {
    let database = database.inner().clone();
    let state = state.inner().clone();
    crate::commands::run_background_task("set_search_index_storage", move || {
        set_search_index_storage_blocking(app, database, state, cache_root, quota_bytes)
    })
    .await
}

pub fn set_search_index_storage_blocking(
    app: AppHandle,
    database: Arc<Database>,
    state: SearchIndexState,
    cache_root: Option<String>,
    quota_bytes: u64,
) -> Result<SearchIndexStorageStatus, String> {
    let _storage = state
        .storage_changes
        .lock()
        .map_err(|_| "Failed to lock search index storage")?;
    const MIN_QUOTA_BYTES: u64 = 256 * 1024 * 1024;
    if quota_bytes < MIN_QUOTA_BYTES {
        return Err("Search index cache limit must be at least 256 MiB".to_string());
    }
    let mut settings = database.load_search_index_storage()?;
    let source_root = index_root_from_settings(&app, &settings)?;
    let default_root = default_index_root(&app)?;
    let custom_root = cache_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    if let Some(path) = &custom_root {
        if !path.is_absolute() {
            return Err("Search index cache folder must be an absolute path".to_string());
        }
        if path.is_file() {
            return Err("Search index cache folder points to a file".to_string());
        }
    }
    let destination_root = custom_root.unwrap_or_else(|| default_root.clone());
    if source_root == destination_root
        || fs::canonicalize(&source_root).is_ok_and(|source| {
            fs::canonicalize(&destination_root).is_ok_and(|destination| destination == source)
        })
    {
        settings.quota_bytes = quota_bytes;
        database.save_search_index_storage(&settings)?;
        enforce_storage_quota(&app, None)?;
        return storage_status(&app);
    }
    if has_active_build(&state) {
        return Err(
            "Wait for active search index builds to finish before moving the cache".to_string(),
        );
    }

    {
        // Keep active project watchers. Block new runtimes and writers across
        // the copy and preference change so their next write uses the new root.
        let runtimes = state
            .runtimes
            .lock()
            .map_err(|_| "Failed to lock index runtimes")?;
        let _writers = runtimes
            .values()
            .map(|runtime| runtime.writer.try_lock())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Wait for active search index writes to finish before moving the cache")?;
        settings.cache_root = if destination_root == default_root {
            None
        } else {
            Some(display_path(&destination_root))
        };
        settings.quota_bytes = quota_bytes;
        relocate_index_root(&source_root, &destination_root, || {
            database.save_search_index_storage(&settings)
        })?;
        let entries = state
            .entries
            .lock()
            .map_err(|_| "Failed to read active projects")?;
        for key in entries.keys() {
            if let Some(runtime) = runtimes.get(key) {
                runtime
                    .changes
                    .lock()
                    .map_err(|_| "Failed to schedule index reconciliation")?
                    .record(Vec::new(), true, Instant::now());
            }
        }
    }
    enforce_storage_quota(&app, None)?;
    storage_status(&app)
}

#[tauri::command]
pub async fn clear_search_index_cache(
    app: AppHandle,
    state: State<'_, SearchIndexState>,
) -> Result<SearchIndexStorageStatus, String> {
    let state = state.inner().clone();
    crate::commands::run_background_task("clear_search_index_cache", move || {
        clear_search_index_cache_blocking(app, state)
    })
    .await
}

pub fn clear_search_index_cache_blocking(
    app: AppHandle,
    state: SearchIndexState,
) -> Result<SearchIndexStorageStatus, String> {
    let _storage = state
        .storage_changes
        .lock()
        .map_err(|_| "Failed to lock search index storage")?;
    if has_active_build(&state) {
        return Err(
            "Wait for active search index builds to finish before clearing the cache".to_string(),
        );
    }
    let root = index_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(&root)
            .map_err(|error| format!("Failed to clear search index cache: {error}"))?;
    }
    if let Ok(mut entries) = state.entries.lock() {
        for entry in entries.values() {
            entry.cancel.store(true, Ordering::Relaxed);
        }
        entries.clear();
    }
    if let Ok(mut watchers) = state.watchers.lock() {
        watchers.clear();
    }
    storage_status(&app)
}

#[cfg(all(test, windows))]
mod windows_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_project(path: &Path) -> ResolvedProject {
        let display = display_path(path);
        ResolvedProject {
            runtime: Arc::default(),
            generation: 0,
            path: path.to_path_buf(),
            preference_key: display.replace('\\', "/").to_lowercase(),
            display_path: display,
        }
    }

    #[test]
    fn chinese_bigrams_upgrade_in_place_and_follow_incremental_changes() {
        let root = tempdir().unwrap();
        let project = test_project(root.path());
        let first = root.path().join("first.txt");
        let second = root.path().join("second.txt");
        fs::write(&first, "问题").unwrap();
        fs::write(&second, "这是一个问题").unwrap();
        let database_path = root.path().join("index.sqlite3");
        let candidates = discover_candidates(
            &project,
            &AtomicBool::new(false),
            &AtomicBool::new(false),
            |_, _, _| {},
        )
        .unwrap();
        write_index_database(
            true,
            &database_path,
            &project,
            &candidates,
            &AtomicBool::new(false),
            &AtomicBool::new(false),
            |_, _, _, _| {},
        )
        .unwrap();
        {
            let connection = Connection::open(&database_path).unwrap();
            assert_eq!(
                query_candidate_relative_paths(&connection, "问题", 10)
                    .unwrap()
                    .len(),
                2
            );
            // 模拟升级前的 v2 数据库，既有路径、rowid 和 trigram 表必须保留。
            connection.execute_batch("DROP TABLE content_cjk_bigrams; DELETE FROM index_meta WHERE key = 'cjk_bigrams_version';").unwrap();
        }
        let unindexed = root.path().join("unindexed.txt");
        fs::write(&unindexed, "问题").unwrap();
        assert!(
            upgrade_short_query_database(&database_path, &project, &AtomicBool::new(true)).is_err()
        );
        assert!(!short_queries::ready(
            &Connection::open(&database_path).unwrap()
        ));
        upgrade_short_query_database(&database_path, &project, &AtomicBool::new(false)).unwrap();
        let connection = Connection::open(&database_path).unwrap();
        assert_eq!(
            query_candidate_relative_paths(&connection, "问题", 10)
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            query_candidate_relative_paths(&connection, "一个问", 10).unwrap(),
            vec!["second.txt"]
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM indexed_files", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            2
        );
        drop(connection);
        let renamed = root.path().join("renamed.txt");
        fs::rename(&first, &renamed).unwrap();
        fs::write(&second, "答案").unwrap();
        apply_incremental_updates(
            true,
            &database_path,
            &project,
            &[first, renamed.clone(), second.clone()],
        )
        .unwrap();
        let connection = Connection::open(&database_path).unwrap();
        assert_eq!(
            query_candidate_relative_paths(&connection, "问题", 10).unwrap(),
            vec!["renamed.txt"]
        );
        assert_eq!(
            query_candidate_relative_paths(&connection, "答案", 10).unwrap(),
            vec!["second.txt"]
        );
        drop(connection);
        fs::remove_file(&renamed).unwrap();
        apply_incremental_updates(true, &database_path, &project, &[renamed]).unwrap();
        let connection = Connection::open(&database_path).unwrap();
        assert!(query_candidate_relative_paths(&connection, "问题", 10)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn two_chinese_characters_never_turn_an_unavailable_index_into_a_directory_scan() {
        for (reason, state, expected) in [
            ("index_disabled", "disabled", "short-query-index-disabled"),
            ("index_not_ready", "building", "short-query-index-waiting"),
            ("index_not_ready", "paused", "short-query-index-paused"),
            ("index_not_ready", "failed", "short-query-index-unavailable"),
            ("index_busy", "ready", "short-query-index-waiting"),
            (
                "index_reconciling",
                "reconciling",
                "short-query-index-waiting",
            ),
            (
                "too_many_index_candidates",
                "ready",
                "short-query-index-unavailable",
            ),
        ] {
            let plan = enforce_short_query_index(
                "问题",
                false,
                IndexCandidateLookup::Fallback {
                    reason: reason.into(),
                    index_state: state.into(),
                },
            );
            assert!(
                matches!(plan, IndexCandidateLookup::ShortQueryError(actual) if actual == expected),
                "{reason}"
            );
        }
        let plan = enforce_short_query_index(
            "问题",
            false,
            IndexCandidateLookup::Ready {
                paths: Vec::new(),
                generation: 1,
            },
        );
        assert!(matches!(plan, IndexCandidateLookup::Ready { .. }));
        let plan = enforce_short_query_index(
            "问题",
            true,
            IndexCandidateLookup::Fallback {
                reason: "regex_query".into(),
                index_state: "not_applicable".into(),
            },
        );
        assert!(matches!(plan, IndexCandidateLookup::Fallback { .. }));
    }

    #[test]
    fn short_query_upgrade_is_treated_as_an_active_index_write() {
        let state = SearchIndexState::default();
        let runtime = state.runtime("project").unwrap();
        assert!(!has_active_build(&state));
        runtime.short_query_upgrade.store(true, Ordering::Relaxed);
        assert!(has_active_build(&state));
        assert!(project_has_active_index_write(&state, "project"));
        runtime.short_query_upgrade.store(false, Ordering::Relaxed);
        assert!(!project_has_active_index_write(&state, "project"));
    }

    #[test]
    fn builds_queryable_trigram_index_and_skips_ignored_and_binary_files() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("source.txt"), "alpha updateWrapper omega").unwrap();
        fs::write(root.path().join("quoted.txt"), "alpha OR \"beta\"").unwrap();
        fs::write(root.path().join("binary.dat"), [0, 1, 2, 3]).unwrap();
        fs::create_dir(root.path().join("node_modules")).unwrap();
        fs::write(
            root.path().join("node_modules").join("ignored.txt"),
            "updateWrapper",
        )
        .unwrap();
        let project = test_project(root.path());
        let cancel = AtomicBool::new(false);
        let pause = AtomicBool::new(false);
        let candidates = discover_candidates(&project, &cancel, &pause, |_, _, _| {}).unwrap();
        assert_eq!(candidates.len(), 3);

        let database_path = root.path().join("index.sqlite3");
        write_index_database(
            true,
            &database_path,
            &project,
            &candidates,
            &cancel,
            &pause,
            |_, _, _, _| {},
        )
        .unwrap();
        let connection = Connection::open(database_path).unwrap();
        let matches = query_candidate_relative_paths(&connection, "updateWrapper", 10).unwrap();
        assert_eq!(matches, vec!["source.txt"]);
        let quoted = query_candidate_relative_paths(&connection, "alpha OR \"beta\"", 10).unwrap();
        assert_eq!(quoted, vec!["quoted.txt"]);
        let tracked: u64 = connection
            .query_row("SELECT count(*) FROM indexed_files", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tracked, 3);
        let indexed: u64 = connection
            .query_row(
                "SELECT count(*) FROM indexed_files WHERE status = 'indexed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexed, 2);
    }

    #[test]
    fn decodes_supported_text_encodings_and_rejects_binary_data() {
        let root = tempdir().unwrap();
        let utf8_bom = root.path().join("utf8-bom.txt");
        fs::write(&utf8_bom, [b"\xef\xbb\xbf".as_slice(), b"hello"].concat()).unwrap();
        assert_eq!(read_text_file(&utf8_bom).unwrap().1, TextEncoding::Utf8Bom);

        let utf16 = root.path().join("utf16.txt");
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend("hello".encode_utf16().flat_map(u16::to_le_bytes));
        fs::write(&utf16, bytes).unwrap();
        assert_eq!(read_text_file(&utf16).unwrap().0, "hello");

        let binary = root.path().join("binary.dat");
        fs::write(&binary, [1, 0, 2]).unwrap();
        assert!(read_text_file(&binary).is_err());
    }

    #[test]
    fn file_catalog_lists_large_files_and_tracks_changes_without_content_indexes() {
        let root = tempdir().unwrap();
        let cache = tempdir().unwrap();
        let project = test_project(root.path());
        let log = root.path().join("server.log");
        fs::File::create(&log)
            .unwrap()
            .set_len(80 * 1024 * 1024)
            .unwrap();
        fs::write(root.path().join("notes.txt"), "needle").unwrap();
        let flag = AtomicBool::new(false);
        let candidates = discover_candidates(&project, &flag, &flag, |_, _, _| {}).unwrap();
        let db = cache.path().join("index.sqlite3");
        write_index_database(
            false,
            &db,
            &project,
            &candidates,
            &flag,
            &flag,
            |_, _, _, _| {},
        )
        .unwrap();
        let connection = Connection::open(&db).unwrap();
        let search = |name| {
            super::super::file_tree::search_indexed_project_entries(&connection, root.path(), name)
                .unwrap()
                .len()
        };
        assert_eq!(search("server.log"), 1);
        assert_eq!(search("notes.txt"), 1);
        assert_eq!(connection.query_row("SELECT count(*) FROM sqlite_master WHERE name IN ('content_fts','content_cjk_bigrams')", [], |r| r.get::<_, u64>(0)).unwrap(), 0);
        let moved = root.path().join("archive.log");
        fs::rename(&log, &moved).unwrap();
        apply_incremental_updates(false, &db, &project, &[log, moved]).unwrap();
        assert_eq!(search("server.log"), 0);
        assert_eq!(search("archive.log"), 1);
    }

    #[test]
    fn old_full_text_cache_backfills_large_names_and_handles_size_changes() {
        let root = tempdir().unwrap();
        let cache = tempdir().unwrap();
        let project = test_project(root.path());
        let file = root.path().join("server.log");
        let flag = AtomicBool::new(false);
        let db = cache.path().join("index.sqlite3");
        // A v2 cache built before large paths were discovered has no row for this log.
        fs::File::create(&file)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        write_index_database(true, &db, &project, &[], &flag, &flag, |_, _, _, _| {}).unwrap();
        let dirty = reconciliation_paths(&db, &project, &[]).unwrap();
        assert_eq!(dirty, vec![file.clone()]);
        let summary = apply_incremental_updates(true, &db, &project, &dirty).unwrap();
        assert_eq!((summary.total_files, summary.indexed_files), (1, 0));
        let connection = Connection::open(&db).unwrap();
        assert_eq!(
            super::super::file_tree::search_indexed_project_entries(
                &connection,
                root.path(),
                "server.log"
            )
            .unwrap()
            .len(),
            1
        );
        fs::write(&file, "needle in small file").unwrap();
        let dirty = [file.clone()];
        apply_incremental_updates(true, &db, &project, &dirty).unwrap();
        assert_eq!(
            query_candidate_relative_paths(&connection, "needle", 10).unwrap(),
            vec!["server.log"]
        );
        fs::OpenOptions::new()
            .write(true)
            .open(&file)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        apply_incremental_updates(true, &db, &project, &dirty).unwrap();
        assert!(query_candidate_relative_paths(&connection, "needle", 10)
            .unwrap()
            .is_empty());
        fs::remove_file(file).unwrap();
        assert_eq!(
            apply_incremental_updates(false, &db, &project, &dirty)
                .unwrap()
                .total_files,
            0
        );
    }

    #[test]
    fn paused_catalog_removes_descendants_on_a_directory_rename_from_event() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let project = test_project(root.path());
        let mut catalog = LiveFileCatalog::default();
        let cancel = AtomicBool::new(false);
        let find = |connection: &Connection, project: &ResolvedProject| {
            super::super::file_tree::search_indexed_project_entries(
                connection,
                &project.path,
                "child.txt",
            )
        };
        assert!(catalog.query(&project, &cancel, find).unwrap().is_empty());
        let folder = root.path().join("during-pause");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("child.txt"), "").unwrap();
        project
            .runtime
            .changes
            .lock()
            .unwrap()
            .record(Vec::new(), true, Instant::now());
        assert_eq!(catalog.query(&project, &cancel, find).unwrap().len(), 1);
        fs::rename(&folder, outside.path().join("moved")).unwrap();
        // The disk index never saw this folder. A rename-from event may only
        // carry the old directory path, without individual child removals.
        project
            .runtime
            .changes
            .lock()
            .unwrap()
            .record(vec![folder], false, Instant::now());
        assert!(catalog.query(&project, &cancel, find).unwrap().is_empty());
    }

    #[test]
    fn disabled_status_is_explicitly_scan_backed() {
        let status = disabled_status("E:/projects/Krosna".to_string());
        assert!(!status.enabled);
        assert_eq!(status.state, "disabled");
        assert_eq!(status.backend, "scan");
    }

    #[test]
    fn watcher_filters_generated_directories_but_keeps_source_changes() {
        let root = tempdir().unwrap();
        let source_event = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path(root.path().join("src").join("main.rs"));
        assert!(!event_requires_rebuild(root.path(), &source_event));

        let target_event = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path(root.path().join("target").join("debug").join("krosna.exe"));
        assert!(!event_requires_rebuild(root.path(), &target_event));

        let git_exclude_event = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path(root.path().join(".git").join("info").join("exclude"));
        assert!(event_requires_rebuild(root.path(), &git_exclude_event));

        let generated = root.path().join("target").join("debug");
        fs::create_dir_all(&generated).unwrap();
        let directory_event =
            Event::new(EventKind::Create(notify::event::CreateKind::Folder)).add_path(generated);
        assert!(!event_requires_rebuild(root.path(), &directory_event));

        let nested_ignore = Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
            .add_path(root.path().join("src").join(".gitignore"));
        assert!(event_requires_rebuild(root.path(), &nested_ignore));
    }

    #[test]
    fn pending_files_fill_stale_index_candidates_and_respect_ignores() {
        let fixture = tempdir().unwrap();
        let root = fixture.path().join("project");
        fs::create_dir_all(&root).unwrap();
        let project = test_project(&root);
        let source = root.join("source.txt");
        let deleted = root.join("deleted.txt");
        fs::write(&source, "oldneedle").unwrap();
        fs::write(&deleted, "oldneedle").unwrap();
        let database_path = fixture.path().join("index.sqlite3");
        let candidates = discover_candidates(
            &project,
            &AtomicBool::new(false),
            &AtomicBool::new(false),
            |_, _, _| {},
        )
        .unwrap();
        write_index_database(
            true,
            &database_path,
            &project,
            &candidates,
            &AtomicBool::new(false),
            &AtomicBool::new(false),
            |_, _, _, _| {},
        )
        .unwrap();

        fs::write(&source, "newneedle").unwrap();
        fs::remove_file(&deleted).unwrap();
        let created = root.join("created.txt");
        fs::write(&created, "newneedle").unwrap();
        fs::write(root.join(".ignore"), "ignored.txt\n").unwrap();
        let ignored = root.join("ignored.txt");
        fs::write(&ignored, "newneedle").unwrap();
        let runtime = ProjectRuntime::default();
        runtime.changes.lock().unwrap().record(
            vec![source.clone(), created.clone(), deleted, ignored],
            false,
            Instant::now(),
        );
        let connection = Connection::open(&database_path).unwrap();
        let indexed = query_candidate_relative_paths(&connection, "newneedle", 100).unwrap();
        assert!(indexed.is_empty());
        let merged: HashSet<_> =
            merge_search_candidates(&project, indexed, pending_search_paths(&runtime).unwrap())
                .into_iter()
                .collect();
        assert_eq!(merged, HashSet::from([source.clone(), created.clone()]));
        // 同一路径同时出现在旧索引与脏文件集合中时只搜索一次。
        let stale = query_candidate_relative_paths(&connection, "oldneedle", 100).unwrap();
        let merged =
            merge_search_candidates(&project, stale, pending_search_paths(&runtime).unwrap());
        assert_eq!(merged.iter().filter(|path| **path == source).count(), 1);
        runtime
            .changes
            .lock()
            .unwrap()
            .record(Vec::new(), true, Instant::now());
        assert!(pending_search_paths(&runtime).is_err());
    }

    #[test]
    fn reconciliation_updates_only_changed_new_deleted_and_explicitly_dirty_files() {
        let fixture = tempdir().unwrap();
        let root = fixture.path().join("project");
        fs::create_dir_all(&root).unwrap();
        let project = test_project(&root);
        let unchanged = root.join("unchanged.txt");
        let changed = root.join("changed.txt");
        let deleted = root.join("deleted.txt");
        let explicit = root.join("explicit.txt");
        for path in [&unchanged, &changed, &deleted, &explicit] {
            fs::write(path, "oldneedle").unwrap();
        }
        let database_path = fixture.path().join("index.sqlite3");
        let candidates = discover_candidates(
            &project,
            &AtomicBool::new(false),
            &AtomicBool::new(false),
            |_, _, _| {},
        )
        .unwrap();
        write_index_database(
            true,
            &database_path,
            &project,
            &candidates,
            &AtomicBool::new(false),
            &AtomicBool::new(false),
            |_, _, _, _| {},
        )
        .unwrap();
        fs::write(&changed, "newneedle changed length").unwrap();
        fs::remove_file(&deleted).unwrap();
        let created = root.join("created.txt");
        fs::write(&created, "newneedle").unwrap();
        let paths = reconciliation_paths(&database_path, &project, &[explicit.clone()]).unwrap();
        assert_eq!(
            paths.iter().cloned().collect::<HashSet<_>>(),
            HashSet::from([changed, deleted, explicit, created])
        );
        apply_incremental_updates(true, &database_path, &project, &paths).unwrap();
        let connection = Connection::open(&database_path).unwrap();
        assert_eq!(
            query_candidate_relative_paths(&connection, "newneedle", 100)
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn database_lock_contention_is_not_classified_as_corruption() {
        let fixture = tempdir().unwrap();
        let path = fixture.path().join("index.sqlite3");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE example(value TEXT); BEGIN EXCLUSIVE;")
            .unwrap();
        let reader = Connection::open(&path).unwrap();
        reader.busy_timeout(Duration::ZERO).unwrap();
        let error = reader.prepare("SELECT * FROM example").unwrap_err();
        assert!(sqlite_is_busy(&error));
        assert!(matches!(
            inspect_index_health(&path),
            IndexHealth::Unavailable(_)
        ));
    }

    #[test]
    fn corrupt_index_is_quarantined_before_rebuild() {
        let root = tempdir().unwrap();
        let database_path = root.path().join("index.sqlite3");
        fs::write(&database_path, b"not a sqlite database").unwrap();
        assert!(matches!(
            inspect_index_health(&database_path),
            IndexHealth::Corrupt(_)
        ));

        let quarantine = quarantine_corrupt_index(&database_path).unwrap().unwrap();
        assert!(!database_path.exists());
        assert!(quarantine.is_file());
        assert!(quarantine
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("index.corrupt-")));
    }

    #[test]
    fn incremental_updates_cover_modify_create_delete_and_rename() {
        let root = tempdir().unwrap();
        let source = root.path().join("source.txt");
        fs::write(&source, "alpha first-version").unwrap();
        let project = test_project(root.path());
        let cancel = AtomicBool::new(false);
        let pause = AtomicBool::new(false);
        let database_path = root.path().join("index.sqlite3");
        let candidates = discover_candidates(&project, &cancel, &pause, |_, _, _| {}).unwrap();
        write_index_database(
            true,
            &database_path,
            &project,
            &candidates,
            &cancel,
            &pause,
            |_, _, _, _| {},
        )
        .unwrap();

        fs::write(&source, "beta second-version").unwrap();
        let summary =
            apply_incremental_updates(true, &database_path, &project, &[source.clone()]).unwrap();
        assert_eq!(summary.indexed_files, 1);
        let connection = Connection::open(&database_path).unwrap();
        assert!(query_candidate_relative_paths(&connection, "alpha", 10)
            .unwrap()
            .is_empty());
        assert_eq!(
            query_candidate_relative_paths(&connection, "beta", 10).unwrap(),
            vec!["source.txt"]
        );

        let created = root.path().join("created.txt");
        fs::write(&created, "gamma created-file").unwrap();
        let summary =
            apply_incremental_updates(true, &database_path, &project, &[created.clone()]).unwrap();
        assert_eq!(summary.total_files, 2);
        assert_eq!(
            query_candidate_relative_paths(&connection, "gamma", 10).unwrap(),
            vec!["created.txt"]
        );

        fs::write(root.path().join(".ignore"), "ignored.txt\n").unwrap();
        let ignored = root.path().join("ignored.txt");
        fs::write(&ignored, "delta ignored-file").unwrap();
        let summary =
            apply_incremental_updates(true, &database_path, &project, &[ignored]).unwrap();
        assert_eq!(summary.total_files, 2);
        assert!(query_candidate_relative_paths(&connection, "delta", 10)
            .unwrap()
            .is_empty());

        fs::remove_file(&created).unwrap();
        let summary =
            apply_incremental_updates(true, &database_path, &project, &[created.clone()]).unwrap();
        assert_eq!(summary.total_files, 1);
        assert!(query_candidate_relative_paths(&connection, "gamma", 10)
            .unwrap()
            .is_empty());

        let renamed = root.path().join("renamed.txt");
        fs::rename(&source, &renamed).unwrap();
        let summary =
            apply_incremental_updates(true, &database_path, &project, &[source, renamed.clone()])
                .unwrap();
        assert_eq!(summary.total_files, 1);
        assert_eq!(
            query_candidate_relative_paths(&connection, "beta", 10).unwrap(),
            vec!["renamed.txt"]
        );
    }

    #[test]
    fn fts_literal_quoting_escapes_query_syntax() {
        assert_eq!(
            quote_fts5_literal("alpha OR \"beta\""),
            "\"alpha OR \"\"beta\"\"\""
        );
    }

    #[test]
    fn relocating_cache_preserves_index_files() {
        let root = tempdir().unwrap();
        let source = root.path().join("old-cache");
        let destination = root.path().join("new-cache");
        let index = source.join("v1").join("project-a").join("index.sqlite3");
        fs::create_dir_all(index.parent().unwrap()).unwrap();
        fs::write(&index, "index-content").unwrap();

        let failed = relocate_index_root(&source, &destination, || Err("save failed".into()));
        assert_eq!(failed.unwrap_err(), "save failed");
        assert!(index.exists());
        assert!(!destination.exists());
        relocate_index_root(&source, &destination, || Ok(())).unwrap();

        assert!(!source.exists());
        assert_eq!(
            fs::read_to_string(
                destination
                    .join("v1")
                    .join("project-a")
                    .join("index.sqlite3")
            )
            .unwrap(),
            "index-content"
        );
    }

    #[test]
    fn cached_indexes_include_size_and_last_use() {
        let root = tempdir().unwrap();
        let first = root.path().join("v1").join("first");
        let second = root.path().join("v1").join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::write(first.join("index.sqlite3"), [1_u8; 3]).unwrap();
        fs::write(second.join("index.sqlite3"), [2_u8; 5]).unwrap();
        fs::write(first.join("last-used"), "10").unwrap();
        fs::write(second.join("last-used"), "20").unwrap();

        let indexes = cached_index_directories(root.path());

        assert_eq!(indexes.len(), 2);
        assert!(indexes
            .iter()
            .any(|(path, size, used)| { path == &first && *size >= 3 && *used == 10 }));
        assert!(indexes
            .iter()
            .any(|(path, size, used)| { path == &second && *size >= 5 && *used == 20 }));
    }
}
