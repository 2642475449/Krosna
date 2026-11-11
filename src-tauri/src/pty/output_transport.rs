use serde::Serialize;
#[cfg(windows)]
use std::sync::mpsc::sync_channel;
#[cfg(not(windows))]
use tauri::Emitter;

// 只从 PTY 转发线程调用。等待 UI 线程提交消息，避免把正文无限排入 UI 任务队列。
// 输出和退出共用 WebMessage 通道，保持最后一块输出先于退出事件抵达。
#[cfg(windows)]
pub fn emit_pty_event(
    window: &tauri::WebviewWindow,
    event: &str,
    payload: impl Serialize,
) -> Result<(), String> {
    let json = serde_json::to_string(&serde_json::json!({
        "channel": "krosna-pty", "event": event, "payload": payload,
    }))
    .map_err(|error| error.to_string())?;
    let (sent, received) = sync_channel(1);
    window
        .with_webview(move |platform| {
            let json = webview2_com::CoTaskMemPWSTR::from(json.as_str());
            let result = unsafe {
                platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.PostWebMessageAsJson(*json.as_ref().as_pcwstr()))
            };
            let _ = sent.send(result.map_err(|error| error.to_string()));
        })
        .map_err(|error| error.to_string())?;
    received.recv().map_err(|error| error.to_string())??;
    Ok(())
}

#[cfg(not(windows))]
pub fn emit_pty_event(
    window: &tauri::WebviewWindow,
    event: &str,
    payload: impl Serialize + Clone,
) -> Result<(), String> {
    window
        .emit_to(window.label(), event, payload)
        .map_err(|error| error.to_string())
}
