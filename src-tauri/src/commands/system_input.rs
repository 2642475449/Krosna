#[cfg(target_os = "windows")]
use std::mem::size_of;

/// 终端复用 xterm 的整段粘贴，其他输入框使用系统键盘输入。两者均不占用剪贴板。
#[tauri::command]
pub async fn send_text_to_focused_window(
    window: tauri::WebviewWindow,
    text: String,
) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("没有可发送的文本".into());
    }

    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        let foreground = foreground_handle()?;
        let workspace = window.webview_windows().into_values().find(|candidate| {
            super::background::is_workspace(candidate.label())
                && candidate
                    .hwnd()
                    .is_ok_and(|hwnd| hwnd.0 as usize == foreground)
        });
        if let Some(workspace) = workspace {
            let origin = window.url().map_err(|e| e.to_string())?.origin();
            if workspace.url().map_err(|e| e.to_string())?.origin() == origin
                && paste_into_focused_terminal(&workspace, &origin.ascii_serialization(), &text)
                    .await?
            {
                return Ok(());
            }
        }
        send_text_windows(&text, foreground)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, text);
        Err("当前平台暂不支持系统级语音输入".into())
    }
}

#[cfg(target_os = "windows")]
fn foreground_handle() -> Result<usize, String> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return Err("未检测到可接收输入的前台窗口".into());
    }
    Ok(hwnd.0 as usize)
}

#[cfg(target_os = "windows")]
async fn paste_into_focused_terminal(
    workspace: &tauri::WebviewWindow,
    origin: &str,
    text: &str,
) -> Result<bool, String> {
    let timeout = std::time::Duration::from_secs(3);
    let deadline = (std::time::SystemTime::now() + timeout)
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let script = format!(
        "{}({},{},{deadline})",
        include_str!("dispatch_voice_input.js"),
        serde_json::to_string(origin).map_err(|e| e.to_string())?,
        serde_json::to_string(text).map_err(|e| e.to_string())?,
    );
    let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
    workspace
        .eval_with_callback(script, move |result| {
            let _ = sender.try_send(result);
        })
        .map_err(|e| e.to_string())?;
    // 只有明确返回 false 才回退。窗口关闭、JS 异常或确认超时时不能再次注入。
    let reply = tokio::time::timeout(timeout, receiver.recv()).await;
    match reply {
        Ok(Some(value)) if value == "true" => Ok(true),
        Ok(Some(value)) if value == "false" => Ok(false),
        _ => Err("settings.voice.inputUnconfirmed".into()),
    }
}

#[cfg(target_os = "windows")]
fn send_text_windows(text: &str, expected_foreground: usize) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    };

    let mut inputs = Vec::with_capacity(text.encode_utf16().count() * 2);
    for unit in text.encode_utf16() {
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: Default::default(),
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
        inputs.push(INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: Default::default(),
                    wScan: unit,
                    dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        });
    }

    if inputs.is_empty() {
        return Err("没有可发送的文本".into());
    }

    if foreground_handle()? != expected_foreground {
        return Err("settings.voice.inputFocusChanged".into());
    }
    let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err("系统输入发送失败，目标窗口可能不支持直接输入".into());
    }

    Ok(())
}
