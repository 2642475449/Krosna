use std::collections::HashMap;
use super::types::{GitBranchListItem, GitRemoteResult};
use super::utils::{git_command, open_repo, with_git_repository_access, GitRepositoryAccess};

fn normalize_worktree_compare_path(path: &str) -> String {
    let trimmed = path.trim().replace('\\', "/");
    let stripped = trimmed.trim_end_matches('/');
    #[cfg(windows)]
    {
        stripped.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        stripped.to_string()
    }
}

fn parse_worktree_branches(stdout: &str, current_worktree_path: &str) -> HashMap<String, String> {
    let current_norm = normalize_worktree_compare_path(current_worktree_path);
    let mut map = HashMap::new();
    let mut active_path: Option<String> = None;

    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            active_path = None;
            continue;
        }
        if let Some(wt_path) = line.strip_prefix("worktree ") {
            active_path = Some(wt_path.trim().to_string());
        } else if let Some(branch_ref) = line.strip_prefix("branch refs/heads/") {
            if let Some(wt_path) = active_path.as_ref() {
                if normalize_worktree_compare_path(wt_path) != current_norm {
                    map.insert(branch_ref.trim().to_string(), wt_path.clone());
                }
            }
        }
    }

    map
}

fn list_other_worktree_branches(project_path: &str, repo: &git2::Repository) -> HashMap<String, String> {
    let normalized = crate::path_utils::normalize_input_path(project_path);
    let current_workdir = repo
        .workdir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| normalized.to_string_lossy().to_string());

    let output = match git_command()
        .args(["worktree", "list", "--porcelain"])
        .current_dir(&normalized)
        .output()
    {
        Ok(out) if out.status.success() => out,
        _ => return HashMap::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_worktree_branches(&stdout, &current_workdir)
}

/// List all branches (local and remote).
#[tauri::command]
pub async fn git_list_branches(project_path: String) -> Result<Vec<GitBranchListItem>, String> {
    crate::commands::run_background_task("git_list_branches", move || {
        git_list_branches_blocking(project_path)
    })
    .await
}

pub fn git_list_branches_blocking(project_path: String) -> Result<Vec<GitBranchListItem>, String> {
    with_git_repository_access(&project_path, GitRepositoryAccess::Read, || {
        let repo = open_repo(&project_path)?;
        let other_worktrees = list_other_worktree_branches(&project_path, &repo);

        // Get current HEAD branch name
        let current_branch = repo
            .head()
            .ok()
            .and_then(|head| head.shorthand().map(|s| s.to_string()))
            .unwrap_or_default();

        let mut branches = Vec::new();

        // Local branches
        for branch_result in repo
            .branches(Some(git2::BranchType::Local))
            .map_err(|e| format!("列举本地分支失败: {}", e))?
        {
            let (branch, _) = branch_result.map_err(|e| format!("读取分支失败: {}", e))?;

            let name = branch
                .name()
                .map_err(|e| format!("获取分支名称失败: {}", e))?
                .unwrap_or("")
                .to_string();

            if name.is_empty() {
                continue;
            }

            let is_current = name == current_branch;
            let worktree_path = if is_current {
                None
            } else {
                other_worktrees.get(&name).cloned()
            };

            // Get upstream info
            let (upstream, ahead, behind) = match branch.upstream() {
                Ok(upstream_branch) => {
                    let upstream_name =
                        upstream_branch.name().ok().flatten().map(|s| s.to_string());

                    let (ahead, behind) = if let (Some(local_oid), Some(upstream_oid)) =
                        (branch.get().target(), upstream_branch.get().target())
                    {
                        repo.graph_ahead_behind(local_oid, upstream_oid)
                            .unwrap_or((0, 0))
                    } else {
                        (0, 0)
                    };

                    (upstream_name, ahead, behind)
                }
                Err(_) => (None, 0, 0),
            };

            branches.push(GitBranchListItem {
                name,
                is_current,
                is_remote: false,
                upstream,
                ahead,
                behind,
                worktree_path,
            });
        }

        // Remote branches
        for branch_result in repo
            .branches(Some(git2::BranchType::Remote))
            .map_err(|e| format!("列举远程分支失败: {}", e))?
        {
            let (branch, _) = branch_result.map_err(|e| format!("读取远程分支失败: {}", e))?;

            let name = branch
                .name()
                .map_err(|e| format!("获取远程分支名称失败: {}", e))?
                .unwrap_or("")
                .to_string();

            if name.is_empty() {
                continue;
            }

            branches.push(GitBranchListItem {
                name,
                is_current: false,
                is_remote: true,
                upstream: None,
                ahead: 0,
                behind: 0,
                worktree_path: None,
            });
        }

        // Sort: current first, then local, then remote
        branches.sort_by(|a, b| {
            a.is_current
                .cmp(&b.is_current)
                .reverse()
                .then_with(|| a.is_remote.cmp(&b.is_remote))
                .then_with(|| a.name.cmp(&b.name))
        });

        Ok(branches)
    })
}

/// Create a new branch from HEAD.
#[tauri::command]
pub async fn git_create_branch(project_path: String, name: String) -> Result<(), String> {
    crate::commands::run_background_task("git_create_branch", move || {
        git_create_branch_blocking(project_path, name)
    })
    .await
}

pub fn git_create_branch_blocking(project_path: String, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("分支名称不能为空".to_string());
    }

    with_git_repository_access(&project_path, GitRepositoryAccess::Write, || {
        let repo = open_repo(&project_path)?;
        let head = repo.head().map_err(|e| format!("获取 HEAD 失败: {}", e))?;
        let commit = head
            .peel_to_commit()
            .map_err(|e| format!("获取 HEAD 提交失败: {}", e))?;

        repo.branch(&name, &commit, false)
            .map_err(|e| format!("创建分支失败: {}", e))?;

        Ok(())
    })
}

/// Switch to a branch.
#[tauri::command]
pub async fn git_switch_branch(project_path: String, name: String) -> Result<(), String> {
    crate::commands::run_background_task("git_switch_branch", move || {
        git_switch_branch_blocking(project_path, name)
    })
    .await
}

pub fn git_switch_branch_blocking(project_path: String, name: String) -> Result<(), String> {
    with_git_repository_access(&project_path, GitRepositoryAccess::Write, || {
        let path = crate::path_utils::normalize_input_path(&project_path);
        let repo = open_repo(&project_path)?;
        let is_remote_branch =
            repo.find_branch(&name, git2::BranchType::Remote).is_ok() && !name.ends_with("/HEAD");

        // Use git CLI for checkout (more reliable with worktree updates)
        let mut command = git_command();
        command.arg("checkout");
        if is_remote_branch {
            command.arg("--track");
        }
        let output = command
            .arg(&name)
            .current_dir(&path)
            .output()
            .map_err(|e| format!("执行 git checkout 失败: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "切换分支失败".to_string()
            });
        }

        Ok(())
    })
}

/// Delete a branch.
#[tauri::command]
pub async fn git_delete_branch(
    project_path: String,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    crate::commands::run_background_task("git_delete_branch", move || {
        git_delete_branch_blocking(project_path, name, force)
    })
    .await
}

pub fn git_delete_branch_blocking(
    project_path: String,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    with_git_repository_access(&project_path, GitRepositoryAccess::Write, || {
        let path = crate::path_utils::normalize_input_path(&project_path);

        let flag = if force.unwrap_or(false) { "-D" } else { "-d" };

        let output = git_command()
            .args(["branch", flag, &name])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("执行 git branch 删除失败: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Err(if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "删除分支失败".to_string()
            });
        }

        Ok(())
    })
}

/// Merge a branch into the current branch.
#[tauri::command]
pub async fn git_merge_branch(
    project_path: String,
    branch_name: String,
) -> Result<GitRemoteResult, String> {
    crate::commands::run_background_task("git_merge_branch", move || {
        git_merge_branch_blocking(project_path, branch_name)
    })
    .await
}

pub fn git_merge_branch_blocking(
    project_path: String,
    branch_name: String,
) -> Result<GitRemoteResult, String> {
    with_git_repository_access(&project_path, GitRepositoryAccess::Write, || {
        let path = crate::path_utils::normalize_input_path(&project_path);

        let output = git_command()
            .args(["merge", &branch_name])
            .current_dir(&path)
            .output()
            .map_err(|e| format!("执行 git merge 失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let combined = format!("{}{}", stdout, stderr).trim().to_string();

        if output.status.success() {
            Ok(GitRemoteResult {
                success: true,
                message: if combined.is_empty() {
                    "合并成功".to_string()
                } else {
                    combined
                },
            })
        } else {
            Ok(GitRemoteResult {
                success: false,
                message: if combined.is_empty() {
                    "合并失败".to_string()
                } else {
                    combined
                },
            })
        }
    })
}

fn sanitize_worktree_dir_suffix(branch_name: &str) -> String {
    let mut result = String::with_capacity(branch_name.len());
    let mut prev_dash = false;
    for ch in branch_name.chars() {
        let invalid = matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            || ch.is_whitespace();
        if invalid {
            if !prev_dash {
                result.push('-');
                prev_dash = true;
            }
        } else {
            result.push(ch);
            prev_dash = false;
        }
    }
    result.trim_matches(|c| c == '-' || c == '.').to_string()
}

fn resolve_default_worktree_path(
    workdir: &std::path::Path,
    branch_name: &str,
) -> Result<std::path::PathBuf, String> {
    let suffix = sanitize_worktree_dir_suffix(branch_name);
    if suffix.is_empty() {
        return Err("无效的工作树分支名称".to_string());
    }
    let repo_name = workdir
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("repo");
    let parent = workdir
        .parent()
        .ok_or_else(|| "无法确定工作树上级目录".to_string())?;
    Ok(parent.join(format!("{}-{}", repo_name, suffix)))
}

/// Create a new git worktree (and branch if it does not yet exist) as a sibling directory.
#[tauri::command]
pub async fn git_create_worktree(
    project_path: String,
    branch_name: String,
    worktree_path: Option<String>,
) -> Result<String, String> {
    crate::commands::run_background_task("git_create_worktree", move || {
        git_create_worktree_blocking(project_path, branch_name, worktree_path)
    })
    .await
}

pub fn git_create_worktree_blocking(
    project_path: String,
    branch_name: String,
    worktree_path: Option<String>,
) -> Result<String, String> {
    let trimmed_branch = branch_name.trim();
    if trimmed_branch.is_empty() {
        return Err("分支名称不能为空".to_string());
    }
    if trimmed_branch.chars().any(char::is_whitespace) || trimmed_branch.contains("..") {
        return Err("分支名称格式无效".to_string());
    }

    with_git_repository_access(&project_path, GitRepositoryAccess::Write, || {
        let repo = open_repo(&project_path)?;
        let workdir = repo
            .workdir()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| std::path::PathBuf::from(&project_path));

        let target_path = match worktree_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        {
            Some(custom) => std::path::PathBuf::from(custom),
            None => resolve_default_worktree_path(&workdir, trimmed_branch)?,
        };

        if target_path.exists() {
            return Err(format!(
                "目标工作树目录已存在: {}",
                target_path.to_string_lossy().replace('\\', "/")
            ));
        }

        let target_path_str = target_path.to_string_lossy().to_string();
        let branch_exists = repo
            .find_branch(trimmed_branch, git2::BranchType::Local)
            .is_ok();

        let mut cmd = git_command();
        cmd.current_dir(&project_path);
        if branch_exists {
            cmd.args(["worktree", "add", &target_path_str, trimmed_branch]);
        } else {
            cmd.args(["worktree", "add", "-b", trimmed_branch, &target_path_str]);
        }

        let output = cmd
            .output()
            .map_err(|e| format!("执行 git worktree add 失败: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() { stderr } else { stdout };
            return Err(if detail.is_empty() {
                "创建工作树失败".to_string()
            } else {
                detail
            });
        }

        Ok(target_path.to_string_lossy().replace('\\', "/"))
    })
}

#[cfg(test)]
mod tests {
    use super::{
        parse_worktree_branches, resolve_default_worktree_path, sanitize_worktree_dir_suffix,
    };
    use std::path::Path;

    #[test]
    fn parses_other_worktrees_and_excludes_current_workdir() {
        let porcelain = "\
worktree D:/repo/main
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree C:/Users/dev/worktrees/feature-a
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feature-a

worktree C:/Users/dev/worktrees/detached
HEAD 3333333333333333333333333333333333333333
detached
";
        let map = parse_worktree_branches(porcelain, "D:\\repo\\main\\");
        assert!(!map.contains_key("main"));
        assert_eq!(
            map.get("feature-a").map(String::as_str),
            Some("C:/Users/dev/worktrees/feature-a")
        );
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn sanitizes_branch_name_and_resolves_sibling_worktree_path() {
        assert_eq!(sanitize_worktree_dir_suffix("feat/login-ui"), "feat-login-ui");
        assert_eq!(sanitize_worktree_dir_suffix("release/v1.8.39"), "release-v1.8.39");
        let resolved =
            resolve_default_worktree_path(Path::new("E:/7.project/test/Termflow"), "feat/worktree")
                .expect("should resolve sibling path");
        assert_eq!(
            resolved.to_string_lossy().replace('\\', "/"),
            "E:/7.project/test/Termflow-feat-worktree"
        );
    }
}
