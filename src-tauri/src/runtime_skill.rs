//! 将随应用分发的 CLI 技能接入智能体原生发现目录。
use crate::commands::skills::runtime_skill_roots;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const NAME: &str = "krosna-runtime";
const OWNER: &str = "com.krosna.desktop/runtime-skill";
const MANIFEST: &str = ".krosna-managed.json";
const CONTENT: &str = include_str!("../skills/krosna-runtime/SKILL.md");
const AGENTS: [&str; 6] = ["codex", "claude", "qoder", "antigravity", "opencode", "pi"];
static INSTALL_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedSkill {
    owner: String,
    content_hash: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SkillState {
    Installed,
    NotInstalled,
    Disabled,
    Modified,
    Conflict,
    Unavailable,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeSkillStatus {
    agent: &'static str,
    path: Option<String>,
    status: SkillState,
}

fn content_hash(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

fn inspect(directory: &Path, disabled: &Path) -> SkillState {
    // 使用设置页停用后，应用启动和会话启动都不能重新启用它。
    if fs::symlink_metadata(disabled.join(NAME)).is_ok() {
        return SkillState::Disabled;
    }
    let metadata = match fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return SkillState::NotInstalled
        }
        Err(_) => return SkillState::Unavailable,
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return SkillState::Conflict;
    }
    for name in ["SKILL.md", MANIFEST] {
        if fs::symlink_metadata(directory.join(name)).map_or(true, |metadata| {
            !metadata.is_file() || metadata.file_type().is_symlink()
        }) {
            return SkillState::Conflict;
        }
    }
    let manifest = fs::read(directory.join(MANIFEST))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<ManagedSkill>(&bytes).ok());
    let Some(manifest) = manifest.filter(|manifest| manifest.owner == OWNER) else {
        return SkillState::Conflict;
    };
    match fs::read(directory.join("SKILL.md")) {
        Ok(content) if content_hash(&content) == manifest.content_hash => SkillState::Installed,
        Ok(_) => SkillState::Modified,
        Err(_) => SkillState::Unavailable,
    }
}

fn install_at(enabled: &Path, disabled: &Path, content: &str) -> Result<SkillState, String> {
    migrate_previous_skill(enabled, disabled)?;
    let directory = enabled.join(NAME);
    let state = inspect(&directory, disabled);
    if !matches!(state, SkillState::NotInstalled | SkillState::Installed) {
        return Ok(state);
    }
    if state == SkillState::Installed
        && fs::read(directory.join("SKILL.md")).map_err(|error| error.to_string())?
            == content.as_bytes()
    {
        return Ok(state);
    }
    let manifest = serde_json::to_vec(&ManagedSkill {
        owner: OWNER.into(),
        content_hash: content_hash(content.as_bytes()),
    })
    .map_err(|error| error.to_string())?;
    if state == SkillState::NotInstalled {
        fs::create_dir_all(enabled).map_err(|error| error.to_string())?;
        let staging = tempfile::Builder::new()
            .prefix(".krosna-runtime-")
            .tempdir_in(enabled)
            .map_err(|error| error.to_string())?;
        fs::write(staging.path().join("SKILL.md"), content).map_err(|error| error.to_string())?;
        fs::write(staging.path().join(MANIFEST), manifest).map_err(|error| error.to_string())?;
        fs::rename(staging.path(), &directory).map_err(|error| error.to_string())?;
    } else {
        // 只有内容仍匹配上一次安装哈希的文件才可自动升级。
        crate::runtime_cli::write_atomic(&directory.join("SKILL.md"), content.as_bytes(), false)?;
        crate::runtime_cli::write_atomic(&directory.join(MANIFEST), &manifest, false)?;
    }
    Ok(SkillState::Installed)
}

fn migrate_previous_skill(enabled: &Path, disabled: &Path) -> Result<(), String> {
    let old_name = "termflow-runtime";
    if fs::symlink_metadata(disabled.join(old_name)).is_ok()
        && fs::symlink_metadata(disabled.join(NAME)).is_err()
    {
        // A user's previous opt-out remains authoritative after the rename.
        fs::rename(disabled.join(old_name), disabled.join(NAME)).map_err(|error| error.to_string())?;
    }
    let old = enabled.join(old_name);
    let new = enabled.join(NAME);
    if new.exists() || !old.is_dir() || fs::symlink_metadata(&old).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Ok(());
    }
    let old_manifest = old.join(".termflow-managed.json");
    let manifest = fs::read(&old_manifest).ok()
        .and_then(|bytes| serde_json::from_slice::<ManagedSkill>(&bytes).ok());
    let Some(mut manifest) = manifest.filter(|manifest| manifest.owner == "com.termflow.desktop/runtime-skill") else {
        return Ok(());
    };
    if fs::read(old.join("SKILL.md")).map_or(true, |content| content_hash(&content) != manifest.content_hash) {
        // A modified legacy skill must also block an automatic second installation.
        return Err("旧版运行时技能已被修改，保留原文件；请手动迁移为 krosna-runtime".into());
    }
    manifest.owner = OWNER.into();
    let bytes = serde_json::to_vec(&manifest).map_err(|error| error.to_string())?;
    fs::rename(&old, &new).map_err(|error| error.to_string())?;
    crate::runtime_cli::write_atomic(&new.join(MANIFEST), &bytes, false)?;
    fs::remove_file(new.join(".termflow-managed.json")).map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn install_bundled(cli_directory: &Path) -> Result<(), String> {
    let _lock = INSTALL_LOCK.lock();
    install_at(
        &cli_directory.join("skills"),
        &cli_directory.join("skills-disabled"),
        CONTENT,
    )?;
    Ok(())
}

pub(crate) fn bundled_path() -> Result<PathBuf, String> {
    Ok(crate::runtime_cli::data_dir()?
        .join("cli")
        .join("skills")
        .join(NAME)
        .join("SKILL.md"))
}

pub(crate) fn ensure_agent(agent: Option<&str>) -> Result<(), String> {
    let Some((enabled, disabled)) = runtime_skill_roots(agent.unwrap_or("claude"))? else {
        return Ok(());
    };
    let _lock = INSTALL_LOCK.lock();
    let state = install_at(&enabled, &disabled, CONTENT)?;
    if matches!(
        state,
        SkillState::Conflict | SkillState::Modified | SkillState::Unavailable
    ) {
        log::warn!(
            "Krosna runtime skill was preserved without modification: {:?} ({state:?})",
            enabled.join(NAME)
        );
    }
    Ok(())
}

pub(crate) fn ensure_existing_agents() {
    for agent in AGENTS {
        // 未配置的智能体不创建用户目录；首次启动该智能体时再补装。
        if let Ok(Some((enabled, _))) = runtime_skill_roots(agent) {
            if enabled.parent().is_some_and(Path::is_dir) {
                if let Err(error) = ensure_agent(Some(agent)) {
                    log::warn!("Failed to install Krosna runtime skill for {agent}: {error}");
                }
            }
        }
    }
}

pub(crate) fn installation_status() -> Vec<RuntimeSkillStatus> {
    AGENTS
        .into_iter()
        .map(|agent| match runtime_skill_roots(agent) {
            Ok(Some((enabled, disabled))) => RuntimeSkillStatus {
                agent,
                status: inspect(&enabled.join(NAME), &disabled),
                path: Some(crate::path_utils::display_path(
                    enabled.join(NAME).join("SKILL.md"),
                )),
            },
            _ => RuntimeSkillStatus {
                agent,
                path: None,
                status: SkillState::Unavailable,
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_owned_skill_and_retains_disabled_state() {
        let root = tempfile::tempdir().unwrap();
        let enabled = root.path().join("skills");
        let disabled = root.path().join("skills-disabled");
        let old = enabled.join("termflow-runtime");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("SKILL.md"), "old content").unwrap();
        fs::write(old.join(".termflow-managed.json"), serde_json::to_vec(&ManagedSkill {
            owner: "com.termflow.desktop/runtime-skill".into(),
            content_hash: content_hash(b"old content"),
        }).unwrap()).unwrap();
        assert_eq!(install_at(&enabled, &disabled, "new content").unwrap(), SkillState::Installed);
        assert!(!old.exists());
        assert_eq!(fs::read_to_string(enabled.join(NAME).join("SKILL.md")).unwrap(), "new content");
        fs::create_dir_all(&disabled).unwrap();
        fs::rename(enabled.join(NAME), disabled.join("termflow-runtime")).unwrap();
        assert_eq!(install_at(&enabled, &disabled, "later content").unwrap(), SkillState::Disabled);
        assert!(!enabled.join(NAME).exists());
        assert!(disabled.join(NAME).is_dir());
    }

    #[test]
    fn installs_and_upgrades_owned_skills_without_touching_neighbors() {
        let root = tempfile::tempdir().unwrap();
        let enabled = root.path().join("skills");
        let disabled = root.path().join("skills-disabled");
        fs::create_dir_all(enabled.join("other-skill")).unwrap();
        fs::write(enabled.join("other-skill/SKILL.md"), "keep").unwrap();
        assert_eq!(
            install_at(&enabled, &disabled, "version one").unwrap(),
            SkillState::Installed
        );
        assert_eq!(
            install_at(&enabled, &disabled, "version two").unwrap(),
            SkillState::Installed
        );
        assert_eq!(
            fs::read_to_string(enabled.join(NAME).join("SKILL.md")).unwrap(),
            "version two"
        );
        assert_eq!(
            fs::read_to_string(enabled.join("other-skill/SKILL.md")).unwrap(),
            "keep"
        );
    }

    #[test]
    fn preserves_custom_edits_unowned_names_and_disabled_skills() {
        let root = tempfile::tempdir().unwrap();
        let enabled = root.path().join("skills");
        let disabled = root.path().join("skills-disabled");
        install_at(&enabled, &disabled, "owned").unwrap();
        fs::write(enabled.join(NAME).join("SKILL.md"), "my changes").unwrap();
        assert_eq!(
            install_at(&enabled, &disabled, "new").unwrap(),
            SkillState::Modified
        );
        assert_eq!(
            fs::read_to_string(enabled.join(NAME).join("SKILL.md")).unwrap(),
            "my changes"
        );
        fs::remove_file(enabled.join(NAME).join(MANIFEST)).unwrap();
        assert_eq!(
            install_at(&enabled, &disabled, "new").unwrap(),
            SkillState::Conflict
        );
        fs::create_dir_all(&disabled).unwrap();
        fs::rename(enabled.join(NAME), disabled.join(NAME)).unwrap();
        assert_eq!(
            install_at(&enabled, &disabled, "new").unwrap(),
            SkillState::Disabled
        );
        assert!(!enabled.join(NAME).exists());
    }

    #[test]
    fn leaves_broken_or_foreign_skill_entries_untouched() {
        let root = tempfile::tempdir().unwrap();
        let enabled = root.path().join("skills");
        let disabled = root.path().join("skills-disabled");
        fs::create_dir_all(&enabled).unwrap();
        fs::write(enabled.join(NAME), "not a directory").unwrap();
        assert_eq!(
            install_at(&enabled, &disabled, CONTENT).unwrap(),
            SkillState::Conflict
        );
        assert_eq!(
            fs::read_to_string(enabled.join(NAME)).unwrap(),
            "not a directory"
        );
    }

    #[test]
    fn bundled_skill_uses_standard_metadata_and_supports_discovery() {
        let root = tempfile::tempdir().unwrap();
        install_bundled(root.path()).unwrap();
        let content =
            fs::read_to_string(root.path().join("skills").join(NAME).join("SKILL.md")).unwrap();
        let (name, description) = crate::commands::skills::parse_skill_frontmatter(&content);
        assert_eq!(name, NAME);
        assert!(description.contains("Krosna"));
        assert_eq!(content, CONTENT);
    }
}
