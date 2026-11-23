use super::types::GitCommitResult;
use super::utils::{
    ensure_repository_allows_normal_commit, git_command, open_repo, run_git_write, stage_paths,
};

/// Create a commit.
#[tauri::command]
pub async fn git_commit(
    project_path: String,
    message: String,
    files: Vec<String>,
) -> Result<GitCommitResult, String> {
    let lock_path = project_path.clone();
    run_git_write(lock_path, "创建 Git 提交", move || {
        git_commit_sync(project_path, message, files)
    })
    .await
}

pub(super) fn git_commit_sync(
    project_path: String,
    message: String,
    files: Vec<String>,
) -> Result<GitCommitResult, String> {
    let repo = open_repo(&project_path)?;
    ensure_repository_allows_normal_commit(&repo)?;
    drop(repo);
    stage_paths(&project_path, &files)?;
    run_commit_command(&project_path, &message, false)?;
    let oid = read_head_commit_oid(&project_path)?;

    Ok(GitCommitResult {
        commit_oid: oid.to_string(),
        message,
    })
}

/// Stage files.
#[tauri::command]
pub async fn git_stage_files(project_path: String, files: Vec<String>) -> Result<(), String> {
    let lock_path = project_path.clone();
    run_git_write(lock_path, "暂存 Git 文件", move || {
        git_stage_files_sync(project_path, files)
    })
    .await
}

fn git_stage_files_sync(project_path: String, files: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&project_path)?;
    ensure_repository_allows_normal_commit(&repo)?;
    drop(repo);
    stage_paths(&project_path, &files)
}

/// Unstage files.
#[tauri::command]
pub async fn git_unstage_files(project_path: String, files: Vec<String>) -> Result<(), String> {
    let lock_path = project_path.clone();
    run_git_write(lock_path, "取消暂存 Git 文件", move || {
        git_unstage_files_sync(project_path, files)
    })
    .await
}

fn git_unstage_files_sync(project_path: String, files: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&project_path)?;
    ensure_repository_allows_normal_commit(&repo)?;
    if files.is_empty() {
        return Ok(());
    }
    drop(repo);

    // 省略提交参数，Git 会在初始仓库中从空树恢复索引。
    let output =
        super::utils::run_git_with_literal_paths(&project_path, &["reset", "--quiet"], &files)
            .map_err(|error| format!("取消暂存失败: {}", error))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr.trim();
    Err(if detail.is_empty() {
        "取消暂存失败".to_string()
    } else {
        format!("取消暂存失败: {}", detail)
    })
}

/// Discard changes.
#[tauri::command]
pub async fn git_discard_changes(project_path: String, files: Vec<String>) -> Result<(), String> {
    let lock_path = project_path.clone();
    run_git_write(lock_path, "丢弃 Git 更改", move || {
        git_discard_changes_sync(project_path, files)
    })
    .await
}

fn git_discard_changes_sync(project_path: String, files: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&project_path)?;
    ensure_repository_allows_normal_commit(&repo)?;

    let mut status_opts = git2::StatusOptions::new();
    status_opts
        .include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(true);
    let statuses = repo
        .statuses(Some(&mut status_opts))
        .map_err(|e| format!("获取 Git 状态失败: {}", e))?;
    let mut status_map = std::collections::HashMap::new();
    for entry in statuses.iter() {
        if let Some(path) = entry.path() {
            status_map.insert(path.to_string(), entry.status());
        }
    }

    let mut tracked_paths = Vec::new();
    let mut untracked_paths = Vec::new();
    for file in files {
        let status = status_map
            .get(file.as_str())
            .copied()
            .unwrap_or(git2::Status::CURRENT);
        let has_staged_change = status.intersects(
            git2::Status::INDEX_NEW
                | git2::Status::INDEX_MODIFIED
                | git2::Status::INDEX_DELETED
                | git2::Status::INDEX_RENAMED
                | git2::Status::INDEX_TYPECHANGE,
        );
        let is_untracked_only = status.contains(git2::Status::WT_NEW) && !has_staged_change;

        if is_untracked_only {
            untracked_paths.push(file);
            continue;
        }

        // `StatusEntry::path` is the canonical path for the current worktree
        // change. Ignore an old rename path passed by the UI: restoring it can
        // make libgit2 report success without touching the actual file.
        if status != git2::Status::CURRENT {
            tracked_paths.push(file);
        }
    }

    if !tracked_paths.is_empty() {
        // Restore the working tree from the index, retaining any staged change.
        // Use Git itself instead of libgit2's selective checkout: on Windows the
        // latter can return success while a path was not actually updated.
        let output = super::utils::run_git_with_literal_paths(
            &project_path,
            &["restore", "--worktree"],
            &tracked_paths,
        )?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "丢弃更改失败".to_string()
            });
        }

        let mut verify_opts = git2::StatusOptions::new();
        verify_opts
            .include_untracked(true)
            .include_ignored(false)
            .recurse_untracked_dirs(true);
        let tracked_paths: std::collections::HashSet<&str> =
            tracked_paths.iter().map(String::as_str).collect();
        let remaining_paths: Vec<String> = repo
            .statuses(Some(&mut verify_opts))
            .map_err(|e| format!("验证丢弃结果失败: {}", e))?
            .iter()
            .filter_map(|entry| {
                let path = entry.path()?;
                let has_worktree_change = entry.status().intersects(
                    git2::Status::WT_NEW
                        | git2::Status::WT_MODIFIED
                        | git2::Status::WT_DELETED
                        | git2::Status::WT_RENAMED
                        | git2::Status::WT_TYPECHANGE
                        | git2::Status::CONFLICTED,
                );
                (has_worktree_change && tracked_paths.contains(&path)).then(|| path.to_string())
            })
            .collect();

        if !remaining_paths.is_empty() {
            return Err(format!(
                "以下文件仍有未暂存更改: {}",
                remaining_paths.join(", ")
            ));
        }
    }

    // 先完成并验证已跟踪文件的恢复，避免 Git 报错前就移动未跟踪文件。
    for file in untracked_paths {
        super::utils::trash_worktree_path(&project_path, &file)?;
    }

    Ok(())
}

/// Amend a commit.
#[tauri::command]
pub async fn git_commit_amend(
    project_path: String,
    message: String,
    files: Vec<String>,
) -> Result<GitCommitResult, String> {
    let lock_path = project_path.clone();
    run_git_write(lock_path, "修改 Git 提交", move || {
        git_commit_amend_sync(project_path, message, files)
    })
    .await
}

fn git_commit_amend_sync(
    project_path: String,
    message: String,
    files: Vec<String>,
) -> Result<GitCommitResult, String> {
    let repo = open_repo(&project_path)?;
    ensure_repository_allows_normal_commit(&repo)?;
    drop(repo);
    stage_paths(&project_path, &files)?;
    run_commit_command(&project_path, &message, true)?;
    let oid = read_head_commit_oid(&project_path)?;

    Ok(GitCommitResult {
        commit_oid: oid.to_string(),
        message,
    })
}

fn run_commit_command(project_path: &str, message: &str, amend: bool) -> Result<(), String> {
    let mut command = git_command();
    command.arg("commit");
    if amend {
        command.arg("--amend");
    }
    command
        .arg("-m")
        .arg(message)
        .current_dir(crate::path_utils::normalize_input_path(project_path));

    let output = command
        .output()
        .map_err(|e| format!("执行 git commit 失败: {}", e))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else if amend {
        "修改提交失败".to_string()
    } else {
        "创建提交失败".to_string()
    })
}

fn read_head_commit_oid(project_path: &str) -> Result<String, String> {
    let repo = open_repo(project_path)?;
    let head = repo.head().map_err(|e| format!("获取 HEAD 失败: {}", e))?;
    let commit = head
        .peel_to_commit()
        .map_err(|e| format!("获取 HEAD 提交失败: {}", e))?;
    Ok(commit.id().to_string())
}

#[cfg(test)]
mod tests {
    use super::{git_commit_sync, git_discard_changes_sync};
    use git2::{Repository, Signature, Status};
    use std::fs;
    use tempfile::TempDir;

    fn committed_repo() -> (TempDir, Repository) {
        committed_repo_with_files(&["tracked.txt"])
    }

    fn committed_repo_with_files(files: &[&str]) -> (TempDir, Repository) {
        let temp_dir = TempDir::new().unwrap();
        let repo = Repository::init(temp_dir.path()).unwrap();
        repo.config()
            .unwrap()
            .set_bool("core.autocrlf", false)
            .unwrap();
        let mut index = repo.index().unwrap();
        for file in files {
            fs::write(temp_dir.path().join(file), "base\n").unwrap();
            index.add_path(std::path::Path::new(file)).unwrap();
        }
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let signature = Signature::now("Krosna Test", "krosna@example.com").unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap();
        drop(tree);
        (temp_dir, repo)
    }

    #[test]
    fn unstage_only_resets_the_selected_literal_path_before_and_after_first_commit() {
        for has_head in [true, false] {
            let (temp_dir, repo) = if has_head {
                committed_repo()
            } else {
                let temp_dir = TempDir::new().unwrap();
                let repo = Repository::init(temp_dir.path()).unwrap();
                (temp_dir, repo)
            };
            let head_before = repo.head().ok().and_then(|head| head.target());
            let selected = "[ab].txt";
            let unselected = "a.txt";
            let mut index = repo.index().unwrap();
            for file in [selected, unselected] {
                fs::write(temp_dir.path().join(file), b"edited\n").unwrap();
                index.add_path(std::path::Path::new(file)).unwrap();
            }
            index.write().unwrap();

            let project_path = temp_dir.path().to_string_lossy().into_owned();
            super::git_unstage_files_sync(project_path.clone(), vec![selected.to_string()])
                .unwrap();
            super::git_unstage_files_sync(project_path, vec![]).unwrap();

            index.read(true).unwrap();
            assert!(index.get_path(std::path::Path::new(selected), 0).is_none());
            assert!(index
                .get_path(std::path::Path::new(unselected), 0)
                .is_some());
            assert_eq!(repo.head().ok().and_then(|head| head.target()), head_before);
            for file in [selected, unselected] {
                assert_eq!(fs::read(temp_dir.path().join(file)).unwrap(), b"edited\n");
            }
        }
    }

    #[test]
    fn discard_restores_an_unstaged_file_from_the_index() {
        let (temp_dir, repo) = committed_repo();
        fs::write(temp_dir.path().join("tracked.txt"), "changed\n").unwrap();

        git_discard_changes_sync(
            temp_dir.path().to_string_lossy().into_owned(),
            vec!["tracked.txt".to_string()],
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(temp_dir.path().join("tracked.txt")).unwrap(),
            "base\n"
        );
        assert_eq!(
            repo.status_file(std::path::Path::new("tracked.txt"))
                .unwrap(),
            Status::CURRENT
        );
    }

    #[test]
    fn discard_preserves_staged_content_and_removes_only_worktree_changes() {
        let (temp_dir, repo) = committed_repo();
        fs::write(temp_dir.path().join("tracked.txt"), "staged\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("tracked.txt")).unwrap();
        index.write().unwrap();
        fs::write(temp_dir.path().join("tracked.txt"), "unstaged\n").unwrap();

        git_discard_changes_sync(
            temp_dir.path().to_string_lossy().into_owned(),
            vec!["tracked.txt".to_string()],
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(temp_dir.path().join("tracked.txt")).unwrap(),
            "staged\n"
        );
        assert_eq!(
            repo.status_file(std::path::Path::new("tracked.txt"))
                .unwrap(),
            Status::INDEX_MODIFIED
        );
    }

    #[test]
    fn discard_matches_the_selected_filename_literally() {
        let (temp_dir, _) = committed_repo_with_files(&["[01].txt", "0.txt"]);
        for file in ["[01].txt", "0.txt"] {
            fs::write(temp_dir.path().join(file), "changed\n").unwrap();
        }

        git_discard_changes_sync(
            temp_dir.path().to_string_lossy().into_owned(),
            vec!["[01].txt".to_string()],
        )
        .unwrap();

        assert_eq!(
            fs::read(temp_dir.path().join("[01].txt")).unwrap(),
            b"base\n"
        );
        assert_eq!(
            fs::read(temp_dir.path().join("0.txt")).unwrap(),
            b"changed\n"
        );
    }

    #[test]
    fn discard_handles_a_list_exceeding_the_windows_command_line_limit() {
        let selected: Vec<String> = (0..1500)
            .map(|i| format!("tracked-{i:04}-with-a-long-enough-name.txt"))
            .collect();
        assert!(selected.iter().map(|file| file.len() + 1).sum::<usize>() > 32767);
        let mut files: Vec<&str> = selected.iter().map(String::as_str).collect();
        files.push("unselected.txt");
        let (temp_dir, _) = committed_repo_with_files(&files);
        for file in &files {
            fs::write(temp_dir.path().join(file), "changed\n").unwrap();
        }

        git_discard_changes_sync(
            temp_dir.path().to_string_lossy().into_owned(),
            selected.clone(),
        )
        .unwrap();

        for file in &files[..files.len() - 1] {
            assert_eq!(fs::read(temp_dir.path().join(file)).unwrap(), b"base\n");
        }
        assert_eq!(
            fs::read(temp_dir.path().join("unselected.txt")).unwrap(),
            b"changed\n"
        );
    }

    #[test]
    fn discard_keeps_untracked_files_in_place_if_restore_fails() {
        let (temp_dir, repo) = committed_repo();
        fs::write(temp_dir.path().join("tracked.txt"), "changed\n").unwrap();
        fs::write(temp_dir.path().join("untracked.txt"), "keep me\n").unwrap();
        fs::write(repo.path().join("index.lock"), "").unwrap();

        let error = git_discard_changes_sync(
            temp_dir.path().to_string_lossy().into_owned(),
            vec!["untracked.txt".to_string(), "tracked.txt".to_string()],
        )
        .unwrap_err();

        assert!(error.contains("index.lock"), "{error}");
        assert_eq!(
            fs::read(temp_dir.path().join("tracked.txt")).unwrap(),
            b"changed\n"
        );
        assert_eq!(
            fs::read(temp_dir.path().join("untracked.txt")).unwrap(),
            b"keep me\n"
        );
    }

    #[test]
    fn commit_does_not_stage_files_while_a_merge_is_unfinished() {
        let (temp_dir, repo) = committed_repo();
        fs::write(
            temp_dir.path().join("new-file.txt"),
            "must remain unstaged\n",
        )
        .unwrap();
        fs::write(
            repo.path().join("MERGE_HEAD"),
            "0000000000000000000000000000000000000000\n",
        )
        .unwrap();

        let error = git_commit_sync(
            temp_dir.path().to_string_lossy().into_owned(),
            "should not commit".to_string(),
            vec!["new-file.txt".to_string()],
        )
        .unwrap_err();

        assert!(error.contains("尚未完成"));
        assert_eq!(
            repo.status_file(std::path::Path::new("new-file.txt"))
                .unwrap(),
            Status::WT_NEW
        );
    }
}
