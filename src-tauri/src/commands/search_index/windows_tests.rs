// The native Tauri test host needs the Common Controls v6 manifest that
// tauri-build normally links only into application binaries.
#[cfg(target_env = "msvc")]
#[link(
    name = "resource.lib",
    kind = "static",
    modifiers = "-bundle,+verbatim"
)]
extern "C" {}

use super::*;
use crate::commands::content_search::{
    cancel_content_search, search_project_text, ContentSearchRequest, ContentSearchState,
};
use crate::commands::file_tree::search_indexed_project_entries;
use std::sync::mpsc;
use std::thread;
use tempfile::tempdir;

fn wait_for(label: &str, mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(75);
    while !predicate() {
        assert!(Instant::now() < deadline, "Timed out waiting for {label}");
        thread::sleep(Duration::from_millis(40));
    }
}

#[test]
fn windows_search_index_review_lifecycle() {
    let root = tempdir().unwrap();
    let cache = tempdir().unwrap();
    let state = SearchIndexState::default();
    let db = Arc::new(Database::open_in_memory());
    let settings = SearchIndexStorageSettings {
        cache_root: Some(display_path(cache.path())),
        ..Default::default()
    };
    db.save_search_index_storage(&settings).unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.krosna.test.search-index".into();
    context.config_mut().app.windows.clear();
    let desktop = tauri::Builder::default()
        .any_thread()
        .manage(ContentSearchState::default())
        .manage(db.clone())
        .manage(state.clone())
        .build(context)
        .unwrap();
    let app = desktop.handle();
    let root_path = display_path(root.path());
    let project = resolve_project(&state, &root_path).unwrap();
    db.save_project_search_index_enabled(&project.preference_key, true)
        .unwrap();
    let directory = index_directory(app, &project).unwrap();
    fs::create_dir_all(&directory).unwrap();
    let path = directory.join("index.sqlite3");
    let text = root.path().join("notes.txt");
    fs::write(&text, "登录按钮").unwrap();
    let has_marker = || {
        Connection::open(&path)
            .unwrap()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='review_marker')",
                [],
                |row| row.get::<_, bool>(0),
            )
            .unwrap()
    };
    let flag = AtomicBool::new(false);
    let inputs = discover_candidates(&project, &flag, &flag, |_, _, _| {}).unwrap();
    write_index_database(
        true,
        &path,
        &project,
        &inputs,
        &flag,
        &flag,
        |_, _, _, _| {},
    )
    .unwrap();
    Connection::open(&path).unwrap().execute_batch("DELETE FROM index_meta WHERE key='full_text_ready'; CREATE TABLE review_marker(id INTEGER);").unwrap();
    fs::File::create(root.path().join("archive.log"))
        .unwrap()
        .set_len(80 * 1024 * 1024)
        .unwrap();
    assert!(matches!(inspect_index_health(&path), IndexHealth::Healthy));
    let status =
        get_search_index_status_blocking(app.clone(), db.clone(), state.clone(), project.clone())
            .unwrap();
    assert_eq!(status.state, "ready");
    let has_name = |name| {
        search_project_entry_index(app, &project, name).is_ok_and(|entries| entries.len() == 1)
    };
    wait_for("restored v2 cache reconciliation", || {
        has_name("archive.log")
    });
    let request = ContentSearchRequest {
        search_id: "cjk-review".into(),
        project_path: root_path.clone(),
        scope_path: None,
        query: "登录".into(),
        case_sensitive: false,
        whole_word: false,
        use_regex: false,
        include_patterns: Vec::new(),
        exclude_patterns: Vec::new(),
    };
    wait_for("two-character content search after reconciliation", || {
        match tauri::async_runtime::block_on(search_project_text(
            app.clone(),
            app.state(),
            request.clone(),
        )) {
            Ok(summary) => {
                assert_eq!(summary.backend, "index");
                assert_eq!(summary.match_count, 1);
                true
            }
            Err(error) if error == "short-query-index-waiting" => false,
            Err(error) => panic!("unexpected search failure: {error}"),
        }
    });
    assert!(has_marker());

    let overlap = |release_project: bool| {
        thread::scope(|scope| {
            let (entered, reading) = mpsc::sync_channel(0);
            let (resume, paused) = mpsc::sync_channel(0);
            let reader = scope.spawn(|| {
                with_project_entry_index(app, &project, move |connection, project| {
                    entered.send(()).unwrap();
                    paused.recv().unwrap();
                    search_indexed_project_entries(connection, &project.path, "archive.log")
                })
            });
            reading.recv_timeout(Duration::from_secs(5)).unwrap();
            start_index_build(app.clone(), state.clone(), project.clone(), true).unwrap();
            wait_for("publication behind an open SQLite reader", || {
                let status = get_active_status(&state, &project.preference_key).unwrap();
                assert!(
                    !matches!(status.state.as_str(), "failed" | "ready"),
                    "expected a publisher blocked by a reader, got {status:?}"
                );
                status.phase == "finalizing"
            });
            if release_project {
                release_index_lifetime(&state, &project.preference_key);
            } else {
                pause_project_index(app.clone(), app.state(), root_path.clone()).unwrap();
            }
            resume.send(()).unwrap();
            let result = reader.join().unwrap();
            if release_project {
                assert_eq!(result.unwrap_err(), "search-project-released");
            } else {
                assert_eq!(result.unwrap().len(), 1);
            }
        });
    };
    overlap(false);
    wait_for("full-text publication", || {
        get_active_status(&state, &project.preference_key).is_some_and(|s| s.state == "ready")
    });
    assert!(!has_marker());

    let watcher = state.watchers.lock().unwrap()[&project.preference_key]
        .stop
        .clone();
    // The active cache is older than the eviction candidate and must survive quota enforcement.
    fs::write(directory.join("last-used"), "0").unwrap();
    let inactive = directory.parent().unwrap().join("inactive");
    fs::create_dir(&inactive).unwrap();
    fs::File::create(inactive.join("index.sqlite3"))
        .unwrap()
        .set_len(256 * 1024 * 1024)
        .unwrap();
    set_search_index_storage_blocking(
        app.clone(),
        db.clone(),
        state.clone(),
        settings.cache_root.clone(),
        256 * 1024 * 1024,
    )
    .unwrap();
    assert!(!inactive.exists());
    assert!(path.is_file());
    assert!(Arc::ptr_eq(
        &watcher,
        &state.watchers.lock().unwrap()[&project.preference_key].stop
    ));
    fs::write(root.path().join("after-quota.txt"), "新增").unwrap();
    wait_for("watcher after saving quota", || has_name("after-quota.txt"));

    Connection::open(&path)
        .unwrap()
        .execute_batch("CREATE TABLE review_marker(id INTEGER);")
        .unwrap();
    overlap(true);
    // Join the old writer before checking that it never replaced the marked cache.
    drop(project.runtime.writer.lock().unwrap());
    assert!(has_marker());
    assert!(get_active_status(&state, &project.preference_key).is_none());
    assert!(watcher.load(Ordering::Relaxed));
    // Queued searches captured this project before the window released it.
    assert!(matches!(
        lookup_index_candidates(app, &project, "登录", false),
        Err(error) if error == "search-project-released"
    ));
    assert_eq!(
        search_project_entry_index(app, &project, "archive.log").unwrap_err(),
        "search-project-released"
    );
    assert_eq!(
        terminal_entry_index(app, &project, &project.path, "archive.log").unwrap_err(),
        "search-project-released"
    );
    assert!(!state
        .watchers
        .lock()
        .unwrap()
        .contains_key(&project.preference_key));
    cancel_content_search(app.state(), request.search_id.clone()).unwrap();
    let cancelled = tauri::async_runtime::block_on(search_project_text(
        app.clone(),
        app.state(),
        request.clone(),
    ))
    .unwrap();
    assert!(cancelled.cancelled);
    assert!(!state
        .watchers
        .lock()
        .unwrap()
        .contains_key(&project.preference_key));

    let reopened = resolve_project(&state, &root_path).unwrap();
    get_search_index_status_blocking(app.clone(), db.clone(), state.clone(), reopened.clone())
        .unwrap();
    let writer = reopened.runtime.writer.lock().unwrap();
    thread::scope(|scope| {
        let request = scope.spawn(|| {
            tauri::async_runtime::block_on(set_project_index_enabled(
                app.clone(),
                app.state(),
                app.state(),
                root_path.clone(),
                false,
            ))
        });
        wait_for("toggle waiting on writer", || {
            state.entries.lock().unwrap()[&reopened.preference_key]
                .cancel
                .load(Ordering::Relaxed)
        });
        release_index_lifetime(&state, &reopened.preference_key);
        drop(writer);
        assert_eq!(
            request.join().unwrap().unwrap_err(),
            "search-project-released"
        );
    });
    assert!(!state
        .watchers
        .lock()
        .unwrap()
        .contains_key(&reopened.preference_key));
    assert!(get_active_status(&state, &reopened.preference_key).is_none());

    let cold_root = tempdir().unwrap();
    fs::write(cold_root.path().join("cold.txt"), "").unwrap();
    let cold_path = display_path(cold_root.path());
    let cold = resolve_project(&state, &cold_path).unwrap();
    let writer = cold.runtime.writer.lock().unwrap();
    start_index_build(app.clone(), state.clone(), cold.clone(), false).unwrap();
    assert_eq!(
        search_project_entry_index(app, &cold, "cold.txt").unwrap_err(),
        "search-index-building"
    );
    drop(writer);
    assert_eq!(
        search_project_entry_index(app, &cold, "cold.txt")
            .unwrap()
            .len(),
        1
    );
    drop(cold.runtime.writer.lock().unwrap());
    let moved_cache = tempdir().unwrap();
    let original_watcher = state.watchers.lock().unwrap()[&cold.preference_key]
        .stop
        .clone();
    set_search_index_storage_blocking(
        app.clone(),
        db.clone(),
        state.clone(),
        Some(display_path(moved_cache.path())),
        256 * 1024 * 1024,
    )
    .unwrap();
    assert!(Arc::ptr_eq(
        &original_watcher,
        &state.watchers.lock().unwrap()[&cold.preference_key].stop
    ));
    assert!(cold.runtime.changes.lock().unwrap().reconcile.is_some());
    let has_cold_name = |name| search_project_entry_index(app, &cold, name).unwrap().len() == 1;
    let added = cold_root.path().join("added-after-move.txt");
    fs::write(&added, "new text").unwrap();
    wait_for("new file at the relocated cache", || {
        has_cold_name("added-after-move.txt")
    });

    // Hold the build before discovery so even a very small fixture can be paused.
    let writer = cold.runtime.writer.lock().unwrap();
    db.save_project_search_index_enabled(&cold.preference_key, true)
        .unwrap();
    start_index_build(app.clone(), state.clone(), cold.clone(), true).unwrap();
    pause_project_index(app.clone(), app.state(), cold_path.clone()).unwrap();
    drop(writer);
    assert!(has_cold_name("added-after-move.txt"));
    let renamed = cold_root.path().join("renamed-during-pause.txt");
    fs::rename(&added, &renamed).unwrap();
    wait_for("renamed file while paused", || {
        has_cold_name("renamed-during-pause.txt") && !has_cold_name("added-after-move.txt")
    });
    fs::remove_file(&renamed).unwrap();
    fs::create_dir(cold_root.path().join("new-directory")).unwrap();
    fs::write(
        cold_root
            .path()
            .join("new-directory/created-during-pause.txt"),
        "new text",
    )
    .unwrap();
    wait_for("new and deleted paths while paused", || {
        has_cold_name("created-during-pause.txt") && !has_cold_name("renamed-during-pause.txt")
    });
    assert_eq!(
        get_active_status(&state, &cold.preference_key)
            .unwrap()
            .state,
        "paused"
    );
    let db_path = index_directory(app, &cold).unwrap().join("index.sqlite3");
    let disk = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        disk.query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name = 'content_fts'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    drop(disk);
    release_index_lifetime(&state, &cold.preference_key);
    drop(cold.runtime.writer.lock().unwrap());
}

#[test]
fn readonly_destination_is_a_permanent_publication_error() {
    let dir = tempdir().unwrap();
    let current = dir.path().join("index.sqlite3");
    let pending = dir.path().join("pending.sqlite3");
    fs::write(&current, "original").unwrap();
    fs::write(&pending, "replacement").unwrap();
    let original_permissions = fs::metadata(&current).unwrap().permissions();
    let mut readonly = original_permissions.clone();
    readonly.set_readonly(true);
    fs::set_permissions(&current, readonly).unwrap();
    let result = replace_index_atomically(dir.path(), &pending);
    fs::set_permissions(&current, original_permissions).unwrap();
    assert_eq!(
        result.unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
    assert_eq!(fs::read_to_string(&current).unwrap(), "original");
}
