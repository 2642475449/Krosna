use crate::database::{background::BackgroundSettings, Database};
use crate::events::{
    BACKGROUND_SETTINGS_CHANGED_EVENT, WORKSPACE_CLOSE_REQUESTED_EVENT,
    WORKSPACE_EXIT_CANCELLED_EVENT, WORKSPACE_EXIT_PREPARE_EVENT,
};
use crate::pty::PtyManager;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WebviewWindow};

pub fn is_workspace(label: &str) -> bool {
    label != "voice-overlay" && label != "voice-worker"
}

#[derive(Default)]
pub struct WorkspaceExitState {
    sequence: AtomicU64,
    pending: parking_lot::Mutex<Option<WorkspaceExitPreparation>>,
}

struct WorkspaceExitPreparation {
    nonce: String,
    responses: HashMap<String, Option<bool>>,
}

impl WorkspaceExitState {
    fn begin(&self, labels: Vec<String>) -> Result<String, String> {
        let mut pending = self.pending.lock();
        if pending.is_some() {
            return Err("workspace-exit-in-progress".into());
        }
        let nonce = self.sequence.fetch_add(1, Ordering::Relaxed).to_string();
        *pending = Some(WorkspaceExitPreparation {
            nonce: nonce.clone(),
            responses: labels.into_iter().map(|label| (label, None)).collect(),
        });
        Ok(nonce)
    }

    fn acknowledge(&self, nonce: &str, label: &str, ready: bool) -> Result<(), String> {
        let mut pending = self.pending.lock();
        let preparation = pending
            .as_mut()
            .filter(|item| item.nonce == nonce)
            .ok_or("workspace-exit-stale-request")?;
        let response = preparation
            .responses
            .get_mut(label)
            .ok_or("workspace-exit-unknown-window")?;
        if response.is_some() {
            return Err("workspace-exit-duplicate-response".into());
        }
        *response = Some(ready);
        Ok(())
    }

    fn outcome(&self, nonce: &str, current: &[String]) -> Option<Result<(), String>> {
        let pending = self.pending.lock();
        let Some(preparation) = pending.as_ref().filter(|item| item.nonce == nonce) else {
            return Some(Err("workspace-exit-stale-request".into()));
        };
        // 准备期间新建的窗口也可能有草稿，不能绕过握手直接退出。
        if current
            .iter()
            .any(|label| !preparation.responses.contains_key(label))
        {
            return Some(Err("workspace-exit-windows-changed".into()));
        }
        if preparation
            .responses
            .values()
            .any(|ready| *ready == Some(false))
        {
            return Some(Err("workspace-exit-unsaved-documents".into()));
        }
        if preparation
            .responses
            .values()
            .all(|ready| *ready == Some(true))
        {
            Some(Ok(()))
        } else {
            None
        }
    }

    fn finish(&self, nonce: &str) -> Vec<String> {
        let mut pending = self.pending.lock();
        if pending.as_ref().is_some_and(|item| item.nonce == nonce) {
            return pending
                .take()
                .map(|item| {
                    item.responses
                        .into_iter()
                        .filter_map(|(label, ready)| (ready != Some(true)).then_some(label))
                        .collect()
                })
                .unwrap_or_default();
        }
        Vec::new()
    }
}

fn show_workspaces(app: &tauri::AppHandle) {
    let mut windows: Vec<_> = app
        .webview_windows()
        .into_values()
        .filter(|window| is_workspace(window.label()))
        .collect();
    windows.sort_by_key(|window| window.label().to_string());
    for window in windows {
        if let Err(error) = window
            .show()
            .and_then(|_| window.unminimize())
            .and_then(|_| window.set_focus())
        {
            log::error!("Failed to restore workspace: {error}");
        }
    }
}

pub fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let language = app
        .state::<Arc<Database>>()
        .load_persistent_settings()
        .map(|settings| settings.language)
        .unwrap_or_default();
    let (show_label, quit_label) = tray_labels(&language);
    let show = MenuItem::with_id(app, "background-show", show_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "background-quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    app.manage(TrayMenuState {
        show,
        quit,
        language: parking_lot::Mutex::new(language),
    });
    let mut builder = TrayIconBuilder::with_id("krosna-background")
        .tooltip("Krosna")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_workspaces(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "background-show" => show_workspaces(app),
            "background-quit" => {
                // 交给前端统一检查更新下载状态，再执行显式退出。
                if let Some(window) = app.get_webview_window("main").or_else(|| {
                    app.webview_windows()
                        .into_values()
                        .find(|window| is_workspace(window.label()))
                }) {
                    let _ = window.show();
                    let _ = window.set_focus();
                    if let Err(error) =
                        window.emit_to(window.label(), WORKSPACE_CLOSE_REQUESTED_EVENT, true)
                    {
                        log::error!("Failed to request application exit: {error}");
                    }
                }
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

struct TrayMenuState {
    show: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
    language: parking_lot::Mutex<String>,
}

fn tray_labels(language: &str) -> (String, String) {
    let catalog = match language {
        "en" => include_str!("../../../src/locales/en-US.json"),
        "ja" => include_str!("../../../src/locales/ja-JP.json"),
        _ => include_str!("../../../src/locales/zh-CN.json"),
    };
    let value: serde_json::Value = serde_json::from_str(catalog).unwrap_or_default();
    let label = |key: &str| {
        value["background"][key]
            .as_str()
            .unwrap_or("Krosna")
            .to_string()
    };
    (label("trayShow"), label("trayQuit"))
}

pub fn update_tray_language(app: &tauri::AppHandle, language: &str) -> tauri::Result<()> {
    if let Some(state) = app.try_state::<TrayMenuState>() {
        let mut previous = state.language.lock();
        if *previous != language {
            let (show, quit) = tray_labels(language);
            state.show.set_text(show)?;
            state.quit.set_text(quit)?;
            *previous = language.to_string();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_background_settings(
    database: State<'_, Arc<Database>>,
) -> Result<BackgroundSettings, String> {
    database.load_background_settings()
}

#[tauri::command]
pub fn set_background_settings(
    settings: BackgroundSettings,
    database: State<'_, Arc<Database>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    database.save_background_settings(&settings)?;
    app.emit(BACKGROUND_SETTINGS_CHANGED_EVENT, &settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn complete_workspace_close(window: WebviewWindow, background: bool) -> Result<(), String> {
    if !is_workspace(window.label()) {
        return Err("Not a workspace window".into());
    }
    if background {
        if window
            .app_handle()
            .tray_by_id("krosna-background")
            .is_none()
        {
            return Err("System tray is unavailable".into());
        }
        // 隐藏而不销毁，保留 PTY、工作区与调度器。
        window.hide().map_err(|error| error.to_string())
    } else {
        window.destroy().map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn acknowledge_workspace_exit(
    window: WebviewWindow,
    state: State<'_, WorkspaceExitState>,
    nonce: String,
    ready: bool,
) -> Result<(), String> {
    // 窗口标签来自 Tauri 注入的调用上下文，前端不能替其他窗口确认。
    if !is_workspace(window.label()) {
        return Err("Not a workspace window".into());
    }
    state.acknowledge(&nonce, window.label(), ready)
}

#[tauri::command]
pub async fn exit_background_application(
    app: tauri::AppHandle,
    state: State<'_, WorkspaceExitState>,
) -> Result<(), String> {
    let workspaces: Vec<_> = app
        .webview_windows()
        .into_values()
        .filter(|window| is_workspace(window.label()))
        .collect();
    let labels = workspaces
        .iter()
        .map(|window| window.label().to_string())
        .collect();
    let nonce = state.begin(labels)?;
    for window in workspaces {
        if window
            .emit_to(window.label(), WORKSPACE_EXIT_PREPARE_EVENT, &nonce)
            .is_err()
        {
            let _ = state.acknowledge(&nonce, window.label(), false);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(30);
    let result = loop {
        let current = app
            .webview_windows()
            .keys()
            .filter(|label| is_workspace(label))
            .cloned()
            .collect::<Vec<_>>();
        if let Some(result) = state.outcome(&nonce, &current) {
            break result;
        }
        if Instant::now() >= deadline {
            break Err("workspace-exit-save-timeout".into());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    let blocked = state.finish(&nonce);
    if let Err(error) = result {
        let _ = app.emit(WORKSPACE_EXIT_CANCELLED_EVENT, &nonce);
        if let Some(window) = blocked
            .iter()
            .find_map(|label| app.get_webview_window(label))
        {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return Err(error);
    }
    app.state::<Arc<PtyManager>>().cleanup_all();
    app.state::<Arc<crate::remote_ssh::RemoteSshManager>>()
        .disconnect_all();
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn voice_windows_never_enter_the_background_close_flow() {
        assert!(!is_workspace("voice-overlay"));
        assert!(!is_workspace("voice-worker"));
        assert!(is_workspace("main"));
        assert!(is_workspace("project:example"));
    }

    #[test]
    fn exit_requires_each_window_to_confirm_the_current_nonce() {
        let state = WorkspaceExitState::default();
        let labels = vec!["main".to_string(), "project:other".to_string()];
        let nonce = state.begin(labels.clone()).unwrap();
        assert!(state.begin(labels.clone()).is_err());
        assert!(state.acknowledge("stale", "main", true).is_err());
        assert!(state.acknowledge(&nonce, "unknown", true).is_err());
        state.acknowledge(&nonce, "main", true).unwrap();
        assert!(state.outcome(&nonce, &labels).is_none());
        assert!(state.acknowledge(&nonce, "main", true).is_err());
        state.acknowledge(&nonce, "project:other", true).unwrap();
        assert_eq!(state.outcome(&nonce, &labels), Some(Ok(())));
    }

    #[test]
    fn unsaved_or_new_windows_prevent_application_exit() {
        let state = WorkspaceExitState::default();
        let labels = vec!["main".to_string()];
        let nonce = state.begin(labels.clone()).unwrap();
        state.acknowledge(&nonce, "main", false).unwrap();
        assert!(matches!(state.outcome(&nonce, &labels), Some(Err(_))));
        assert_eq!(state.finish(&nonce), labels);
        let nonce = state.begin(labels.clone()).unwrap();
        state.acknowledge(&nonce, "main", true).unwrap();
        assert!(matches!(
            state.outcome(&nonce, &["main".into(), "project:new".into()]),
            Some(Err(_))
        ));
    }
}
