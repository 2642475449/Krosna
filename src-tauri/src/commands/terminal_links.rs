use crate::commands::file_tree::FileTreeEntryKind;
use crate::path_utils::{display_path, normalize_path_buf};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

#[cfg(test)]
const IGNORED_SEARCH_DIRECTORIES: &[&str] = &[
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

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLinkTarget {
    pub path: String,
    pub kind: FileTreeEntryKind,
    pub in_project: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_relative_path: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLinkResolution {
    pub targets: Vec<TerminalLinkTarget>,
    pub truncated: bool,
}

/// 终端链接只解析文件位置；项目外文件交由系统打开，不放宽项目读写接口的边界。
#[tauri::command]
pub async fn resolve_terminal_link(
    app: tauri::AppHandle,
    project_path: String,
    working_directory: String,
    path: String,
) -> Result<TerminalLinkResolution, String> {
    // Only bare names can fall back to the project index. Absolute paths and
    // terminal-relative hits also work when the project directory is unavailable.
    let text = path.trim();
    let project = if is_bare_name(Path::new(text), text) {
        super::search_index::capture_search_project(&app, &project_path).ok()
    } else {
        None
    };
    crate::commands::run_background_task("resolve_terminal_link", move || {
        resolve_terminal_link_blocking(
            &project_path,
            &working_directory,
            &path,
            dirs_next::home_dir().as_deref(),
            &|root, name| {
                let project = project.as_ref().ok_or("search-index-unavailable")?;
                super::search_index::terminal_entry_index(&app, project, root, name)
            },
        )
    })
    .await
}

fn canonical_path(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok().map(normalize_path_buf)
}

fn is_within_project(path: &Path, root: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        // Windows 的路径比较不区分大小写，同时按组件比较以排除相邻的同前缀目录。
        let path_components: Vec<_> = path
            .components()
            .map(|part| part.as_os_str().to_string_lossy().to_lowercase())
            .collect();
        let root_components: Vec<_> = root
            .components()
            .map(|part| part.as_os_str().to_string_lossy().to_lowercase())
            .collect();
        path_components.starts_with(&root_components)
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.starts_with(root)
    }
}

fn inspect_target(path: &Path, root: Option<&Path>) -> Option<TerminalLinkTarget> {
    let path = canonical_path(path)?;
    let metadata = fs::metadata(&path).ok()?;
    let kind = if metadata.is_dir() {
        FileTreeEntryKind::Directory
    } else if metadata.is_file() {
        FileTreeEntryKind::File
    } else {
        return None;
    };
    let in_project = root.is_some_and(|root| is_within_project(&path, root));
    let project_relative_path = root.filter(|_| in_project).map(|root| {
        // 前缀已经按平台规则验证；按组件截取，保留工作区原始别名与盘符大小写。
        let relative: PathBuf = path.components().skip(root.components().count()).collect();
        display_path(relative).replace('\\', "/")
    });
    Some(TerminalLinkTarget {
        in_project,
        project_relative_path,
        path: display_path(path),
        kind,
    })
}

fn expanded_home_path(path: &str, home: Option<&Path>) -> Result<Option<PathBuf>, String> {
    if path == "~" {
        return home
            .map(|home| Some(home.to_path_buf()))
            .ok_or_else(|| "无法确定用户主目录".to_string());
    }
    if let Some(relative) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        return home
            .map(|home| Some(home.join(relative)))
            .ok_or_else(|| "无法确定用户主目录".to_string());
    }
    Ok(None)
}

fn is_bare_name(path: &Path, text: &str) -> bool {
    !text.contains(['/', '\\'])
        && matches!(path.components().next(), Some(Component::Normal(_)))
        && path.components().count() == 1
}

fn name_matches(name: &str, expected: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        name.to_lowercase() == expected.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        name == expected
    }
}

fn resolve_terminal_link_blocking(
    project_path: &str,
    working_directory: &str,
    path: &str,
    home: Option<&Path>,
    lookup: &dyn Fn(&Path, &str) -> Result<TerminalLinkResolution, String>,
) -> Result<TerminalLinkResolution, String> {
    let text = path.trim();
    if text.is_empty() || text.contains(['\0', '\r', '\n']) || text.contains("://") {
        return Err("无效的本地文件路径".to_string());
    }

    let root = canonical_path(Path::new(project_path)).filter(|root| root.is_dir());
    let input = Path::new(text);
    let cwd = if working_directory.trim().is_empty() {
        root.clone()
    } else {
        let cwd_input = Path::new(working_directory);
        if cwd_input.is_absolute() {
            Some(cwd_input.to_path_buf())
        } else {
            root.as_deref().map(|root| root.join(cwd_input))
        }
    };
    let home_path = expanded_home_path(text, home)?;
    if input.has_root() || home_path.is_some() {
        let candidate = if let Some(home_path) = home_path {
            home_path
        } else if input.is_absolute() {
            input.to_path_buf()
        } else if let Some(cwd) = cwd.as_deref() {
            // Windows 的 `\folder\file` 继承终端当前目录的盘符，不能继承应用进程盘符。
            cwd.join(input)
        } else {
            return Ok(TerminalLinkResolution::default());
        };
        return Ok(TerminalLinkResolution {
            targets: inspect_target(&candidate, root.as_deref())
                .into_iter()
                .collect(),
            truncated: false,
        });
    }
    if matches!(input.components().next(), Some(Component::Prefix(_))) {
        return Err("文件路径需要明确的盘符根目录".to_string());
    }

    // 当前目录具有优先级；项目根目录只在当前目录未命中时作为相对路径的回退。
    for base in cwd.iter().chain(root.iter()) {
        if let Some(target) = inspect_target(&base.join(input), root.as_deref()) {
            return Ok(TerminalLinkResolution {
                targets: vec![target],
                truncated: false,
            });
        }
    }

    let Some(root) = root else {
        return Ok(TerminalLinkResolution::default());
    };
    if !is_bare_name(input, text) {
        return Ok(TerminalLinkResolution::default());
    }
    Ok(
        lookup(&root, text).unwrap_or_else(|_| TerminalLinkResolution {
            targets: Vec::new(),
            truncated: true,
        }),
    )
}

// 仅从共享路径索引中寻找精确文件名；只验证命中的少量路径，不遍历目录。
pub(super) fn search_indexed_exact_name(
    connection: &rusqlite::Connection,
    root: &Path,
    name: &str,
    limit: usize,
) -> Result<TerminalLinkResolution, String> {
    let mut statement = connection
        .prepare("SELECT relative_path FROM indexed_files ORDER BY relative_path")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut seen = HashSet::new();
    let mut result = TerminalLinkResolution::default();
    let mut verified = 0;
    'rows: for relative in rows {
        let relative = relative.map_err(|error| error.to_string())?;
        if relative.is_empty()
            || relative.contains('\\')
            || !Path::new(&relative)
                .components()
                .all(|part| matches!(part, Component::Normal(_)))
        {
            continue;
        }
        let mut path = relative.as_str();
        loop {
            if name_matches(path.rsplit('/').next().unwrap_or(path), name)
                && seen.insert(path.to_string())
            {
                // 大批陈旧索引项也不能导致无限量磁盘验证。
                if verified >= 256 {
                    result.truncated = true;
                    break 'rows;
                }
                verified += 1;
                if let Some(target) =
                    inspect_target(&root.join(path), Some(root)).filter(|target| target.in_project)
                {
                    if !result.targets.contains(&target) {
                        if result.targets.len() >= limit {
                            result.truncated = true;
                            break 'rows;
                        }
                        result.targets.push(target);
                    }
                }
            }
            let Some((parent, _)) = path.rsplit_once('/') else {
                break;
            };
            path = parent;
        }
    }
    result
        .targets
        .sort_by(|left, right| left.path.cmp(&right.path));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{tempdir, TempDir};

    fn write_file(root: &Path, path: &str) -> PathBuf {
        let path = root.join(path);
        fs::create_dir_all(path.parent().expect("file has parent")).expect("create parent");
        fs::write(&path, b"fixture").expect("write fixture");
        canonical_path(&path).expect("canonical fixture")
    }

    // 测试夹具模拟后台索引器；生产解析函数没有目录遍历。
    fn fixture_index(root: &Path) -> rusqlite::Connection {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE indexed_files(relative_path TEXT);")
            .unwrap();
        let mut pending = vec![root.to_path_buf()];
        while let Some(directory) = pending.pop() {
            for child in fs::read_dir(directory).unwrap().flatten() {
                let kind = child.file_type().unwrap();
                let name = child.file_name().to_string_lossy().into_owned();
                if kind.is_symlink() {
                    continue;
                }
                if kind.is_dir() {
                    if !IGNORED_SEARCH_DIRECTORIES.contains(&name.as_str()) {
                        pending.push(child.path());
                    }
                } else {
                    let relative = child
                        .path()
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    connection
                        .execute("INSERT INTO indexed_files VALUES (?1)", [relative])
                        .unwrap();
                }
            }
        }
        connection
    }

    fn fixture_index_lookup(root: &Path, name: &str) -> Result<TerminalLinkResolution, String> {
        search_indexed_exact_name(&fixture_index(root), root, name, 32)
    }

    #[test]
    fn explicit_paths_bypass_index_and_stale_or_escaping_entries_are_rejected() {
        let root = tempdir().unwrap();
        let file = write_file(root.path(), "nested/report.txt");
        let direct = resolve_terminal_link_blocking(
            &display_path(root.path()),
            &display_path(root.path()),
            "nested/report.txt",
            None,
            &|_, _| panic!("explicit paths must not query index"),
        )
        .unwrap();
        assert_eq!(direct.targets[0].path, display_path(file));
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE indexed_files(relative_path TEXT);
            INSERT INTO indexed_files VALUES ('../outside/report.txt'), ('a-deleted/report.txt'), ('b-deleted/report.txt'), ('nested/report.txt');").unwrap();
        let results = search_indexed_exact_name(&connection, root.path(), "report.txt", 1).unwrap();
        assert_eq!(results.targets.len(), 1);
        assert!(!results.truncated);
    }

    fn resolve(root: &TempDir, cwd: &Path, text: &str) -> TerminalLinkResolution {
        resolve_terminal_link_blocking(
            &display_path(root.path()),
            &display_path(cwd),
            text,
            None,
            &fixture_index_lookup,
        )
        .expect("resolve link")
    }

    #[test]
    fn absolute_files_and_directories_outside_project_are_system_targets() {
        let root = tempdir().expect("root");
        let outside = tempdir().expect("outside");
        let file = write_file(outside.path(), "中文 音频 (final).mp3");
        let result = resolve(&root, root.path(), &display_path(&file));
        assert_eq!(result.targets.len(), 1);
        assert_eq!(result.targets[0].path, display_path(&file));
        assert_eq!(result.targets[0].kind, FileTreeEntryKind::File);
        assert!(!result.targets[0].in_project);
        assert!(!result.truncated);

        let directory = resolve(&root, root.path(), &display_path(outside.path()));
        assert_eq!(directory.targets[0].kind, FileTreeEntryKind::Directory);
        assert!(!directory.targets[0].in_project);
    }

    #[test]
    fn current_directory_and_parent_segments_take_precedence_over_project_root() {
        let root = tempdir().expect("root");
        write_file(root.path(), "artifact.custom");
        let file = write_file(root.path(), "nested/artifact.custom");
        let cwd = root.path().join("nested");
        let direct = resolve(&root, &cwd, "artifact.custom");
        assert_eq!(direct.targets[0].path, display_path(&file));
        assert!(!direct.truncated);
        assert_eq!(
            resolve(&root, &cwd, "../nested/artifact.custom").targets,
            direct.targets
        );
    }

    #[test]
    fn project_relative_paths_fall_back_from_a_nested_current_directory() {
        let root = tempdir().expect("root");
        let file = write_file(root.path(), "workspace/audio/voice.wav");
        fs::create_dir_all(root.path().join("other")).expect("cwd");
        let result = resolve(
            &root,
            &root.path().join("other"),
            "workspace/audio/voice.wav",
        );
        assert_eq!(result.targets[0].path, display_path(file));
        assert!(result.targets[0].in_project);
    }

    #[test]
    fn bare_names_find_nested_generic_files_dotfiles_and_extensionless_files() {
        let root = tempdir().expect("root");
        for name in ["voice.mp3", "archive.unfamiliar", ".env", "LICENSE"] {
            let file = write_file(root.path(), &format!("nested/{name}"));
            let result = resolve(&root, root.path(), name);
            assert_eq!(result.targets.len(), 1, "{name}");
            assert_eq!(result.targets[0].path, display_path(file));
            assert!(!result.truncated);
        }
    }

    #[test]
    fn duplicate_basenames_return_every_exact_match_in_stable_order() {
        let root = tempdir().expect("root");
        let first = write_file(root.path(), "a/report.zip");
        let second = write_file(root.path(), "z/report.zip");
        write_file(root.path(), "b/other-report.zip");
        let result = resolve(&root, root.path(), "report.zip");
        assert_eq!(
            result
                .targets
                .iter()
                .map(|target| target.path.clone())
                .collect::<Vec<_>>(),
            vec![display_path(first), display_path(second)]
        );
        assert!(!result.truncated);
    }

    #[test]
    fn a_missing_explicit_path_does_not_fall_back_to_an_unrelated_basename() {
        let root = tempdir().expect("root");
        write_file(root.path(), "actual/report.pdf");
        assert!(resolve(&root, root.path(), "missing/report.pdf")
            .targets
            .is_empty());
        assert!(resolve(&root, root.path(), "missing.mp3")
            .targets
            .is_empty());
        assert!(resolve(
            &root,
            root.path(),
            &display_path(root.path().join("missing.pdf"))
        )
        .targets
        .is_empty());
    }

    #[test]
    fn ignored_directories_are_not_searched_but_explicit_paths_are_resolved() {
        let root = tempdir().expect("root");
        let file = write_file(root.path(), "node_modules/pkg/generated.bin");
        write_file(root.path(), ".git/internal.bin");
        assert!(resolve(&root, root.path(), "generated.bin")
            .targets
            .is_empty());
        assert!(resolve(&root, root.path(), "internal.bin")
            .targets
            .is_empty());
        assert_eq!(
            resolve(&root, root.path(), "node_modules/pkg/generated.bin").targets[0].path,
            display_path(file)
        );
    }

    #[test]
    fn home_paths_expand_without_using_the_application_current_directory() {
        let root = tempdir().expect("root");
        let home = tempdir().expect("home");
        let file = write_file(home.path(), "Documents/测试.txt");
        let result = resolve_terminal_link_blocking(
            &display_path(root.path()),
            &display_path(root.path()),
            "~/Documents/测试.txt",
            Some(home.path()),
            &fixture_index_lookup,
        )
        .expect("home file");
        assert_eq!(result.targets[0].path, display_path(file));
        assert!(!result.targets[0].in_project);
    }

    #[test]
    fn result_limit_and_unavailable_index_are_reported_without_scanning() {
        let root = tempdir().unwrap();
        write_file(root.path(), "a/report.mp3");
        write_file(root.path(), "b/report.mp3");
        let result = resolve_terminal_link_blocking(
            &display_path(root.path()),
            &display_path(root.path()),
            "report.mp3",
            None,
            &|root, name| {
                let connection = fixture_index(root);
                search_indexed_exact_name(&connection, root, name, 1)
            },
        )
        .unwrap();
        assert!(result.truncated);
        assert_eq!(result.targets.len(), 1);
        let result = resolve_terminal_link_blocking(
            &display_path(root.path()),
            &display_path(root.path()),
            "report.mp3",
            None,
            &|_, _| Err("index unavailable".into()),
        )
        .unwrap();
        assert!(result.truncated);
        assert!(result.targets.is_empty());
        let empty = rusqlite::Connection::open_in_memory().unwrap();
        empty
            .execute_batch("CREATE TABLE indexed_files(relative_path TEXT);")
            .unwrap();
        assert!(
            search_indexed_exact_name(&empty, root.path(), "report.mp3", 32)
                .unwrap()
                .targets
                .is_empty()
        );
    }

    #[test]
    fn sibling_with_a_matching_prefix_is_not_inside_project() {
        let root = tempdir().expect("root");
        let project = root.path().join("project");
        let sibling = root.path().join("project-other");
        fs::create_dir_all(&project).expect("project");
        let file = write_file(&sibling, "asset.mp4");
        assert!(
            !inspect_target(&file, Some(&project))
                .expect("target")
                .in_project
        );
    }

    #[test]
    fn resolution_serialization_matches_the_frontend_contract() {
        let value = serde_json::to_value(TerminalLinkResolution {
            targets: vec![TerminalLinkTarget {
                path: "/project/file.bin".to_string(),
                kind: FileTreeEntryKind::File,
                in_project: true,
                project_relative_path: Some("file.bin".to_string()),
            }],
            truncated: false,
        })
        .expect("serialize");
        assert_eq!(value["targets"][0]["kind"], "file");
        assert_eq!(value["targets"][0]["inProject"], true);
        assert_eq!(value["targets"][0]["projectRelativePath"], "file.bin");
        assert_eq!(value["truncated"], false);
    }

    #[test]
    fn project_relative_paths_preserve_directory_components_and_root_is_empty() {
        let root = tempdir().expect("root");
        let file = write_file(root.path(), "中文目录/nested/File.TXT");
        let canonical_root = canonical_path(root.path()).expect("canonical root");
        let target = inspect_target(&file, Some(&canonical_root)).expect("file target");
        assert_eq!(
            target.project_relative_path.as_deref(),
            Some("中文目录/nested/File.TXT")
        );
        let root_target =
            inspect_target(&canonical_root, Some(&canonical_root)).expect("root target");
        assert_eq!(root_target.project_relative_path.as_deref(), Some(""));
        let external = inspect_target(&file, None).expect("external target");
        let value = serde_json::to_value(external).expect("serialize external");
        assert!(value.get("projectRelativePath").is_none());
    }

    #[test]
    fn invalid_input_and_undecoded_urls_are_rejected() {
        let root = tempdir().expect("root");
        for text in [
            "",
            "   ",
            "bad\0path",
            "bad\npath",
            "https://host/a.mp3",
            "file:///tmp/a.mp3",
        ] {
            assert!(resolve_terminal_link_blocking(
                &display_path(root.path()),
                &display_path(root.path()),
                text,
                None,
                &fixture_index_lookup,
            )
            .is_err());
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_name_search_ignores_case() {
        let root = tempdir().expect("root");
        let file = write_file(root.path(), "nested/Voice.MP3");
        let result = resolve(&root, root.path(), "voice.mp3");
        assert_eq!(result.targets[0].path, display_path(file));
        assert!(result.targets[0].in_project);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_project_relative_paths_work_with_different_root_casing() {
        let root = tempdir().expect("root");
        let file = write_file(root.path(), "nested/Voice.MP3");
        let canonical_root = canonical_path(root.path()).expect("canonical root");
        let differently_cased_root = PathBuf::from(display_path(&canonical_root).to_uppercase());
        let result = inspect_target(&file, Some(&differently_cased_root)).expect("target");
        assert!(result.in_project);
        assert_eq!(
            result.project_relative_path.as_deref(),
            Some("nested/Voice.MP3")
        );
        let resolution = resolve_terminal_link_blocking(
            &display_path(differently_cased_root),
            &display_path(root.path()),
            "nested/Voice.MP3",
            None,
            &fixture_index_lookup,
        )
        .expect("resolve case variant");
        assert_eq!(
            resolution.targets[0].project_relative_path.as_deref(),
            Some("nested/Voice.MP3")
        );
        assert!(crate::commands::file_tree::inspect_project_file_blocking(
            display_path(root.path()).to_uppercase(),
            resolution.targets[0].path.clone(),
        )
        .is_ok());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rooted_windows_paths_inherit_the_terminal_drive() {
        let root = tempdir().expect("root");
        let file = write_file(root.path(), "nested/voice.mp3");
        let rooted: PathBuf = file.components().skip(1).collect();
        assert!(rooted.has_root());
        assert!(!rooted.is_absolute());
        let result = resolve(&root, root.path(), &display_path(rooted));
        assert_eq!(result.targets[0].path, display_path(file));
    }

    #[cfg(unix)]
    #[test]
    fn search_does_not_follow_external_symlinks_or_symlink_cycles() {
        let root = tempdir().expect("root");
        let outside = tempdir().expect("outside");
        let file = write_file(outside.path(), "external.mp3");
        std::os::unix::fs::symlink(outside.path(), root.path().join("external"))
            .expect("external link");
        std::os::unix::fs::symlink(root.path(), root.path().join("cycle")).expect("cycle");
        assert!(resolve(&root, root.path(), "external.mp3")
            .targets
            .is_empty());
        let explicit = resolve(&root, root.path(), "external/external.mp3");
        assert_eq!(explicit.targets[0].path, display_path(file));
        assert!(!explicit.targets[0].in_project);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_project_root_retains_relative_paths_and_existing_inspection_compatibility() {
        let container = tempdir().expect("container");
        let real_root = container.path().join("real-project");
        let file = write_file(&real_root, "nested/report.txt");
        let alias = container.path().join("project-alias");
        std::os::unix::fs::symlink(&real_root, &alias).expect("project root alias");
        let resolution = resolve_terminal_link_blocking(
            &display_path(&alias),
            &display_path(&alias),
            "nested/report.txt",
            None,
            &fixture_index_lookup,
        )
        .expect("resolve aliased project");
        assert_eq!(resolution.targets[0].path, display_path(file));
        assert_eq!(
            resolution.targets[0].project_relative_path.as_deref(),
            Some("nested/report.txt")
        );
        assert!(crate::commands::file_tree::inspect_project_file_blocking(
            display_path(alias),
            resolution.targets[0].path.clone(),
        )
        .is_ok());
    }
}
