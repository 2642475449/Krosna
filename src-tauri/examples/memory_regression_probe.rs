//! 隔离内存回归宿主：使用生产输出传输/背压模块、临时 WebView profile 和合成数据。
//! pnpm exec vite --port 1431
//! cargo run --example memory_regression_probe
#[path = "../src/pty/output_flow.rs"]
mod output_flow;
#[path = "../src/pty/output_transport.rs"]
mod output_transport;

use output_flow::OutputHub;
use std::sync::{atomic::AtomicBool, Arc};
use tauri::{Manager, State, WebviewWindow};

#[tauri::command]
fn pty_output_subscribe(
    window: WebviewWindow,
    subscription_id: String,
    hub: State<'_, Arc<OutputHub>>,
) -> Result<(), String> {
    hub.subscribe_output(window.label(), subscription_id)
}
#[tauri::command]
fn pty_output_unsubscribe(
    window: WebviewWindow,
    subscription_id: String,
    hub: State<'_, Arc<OutputHub>>,
) {
    hub.unsubscribe_output(window.label(), Some(&subscription_id));
}
#[tauri::command]
fn pty_output_ack(
    window: WebviewWindow,
    subscription_id: String,
    delivery_id: u64,
    hub: State<'_, Arc<OutputHub>>,
) {
    hub.acknowledge_output(window.label(), &subscription_id, delivery_id);
}

#[tauri::command]
async fn probe_output(
    app: tauri::AppHandle,
    hub: State<'_, Arc<OutputHub>>,
) -> Result<usize, String> {
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let chunk = format!("{}\r\n", "x".repeat(65534));
        let cancelled = AtomicBool::new(false);
        for _ in 0..1024 {
            hub.send_output(&app, "memory-probe-terminal", &chunk, &cancelled);
        }
        hub.send_exit(
            &app,
            output_flow::PtyExitPayload {
                session_id: "memory-probe-terminal".into(),
                code: Some(0),
            },
        );
        chunk.len() * 1024
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn probe_pending(hub: State<'_, Arc<OutputHub>>) -> (usize, usize) {
    hub.pending_counts()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let profile = tempfile::Builder::new()
        .prefix("krosna-memory-regression-")
        .tempdir()?;
    std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", profile.path());
    std::env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier =
        format!("com.krosna.memoryregression.p{}", std::process::id());
    context.config_mut().build.dev_url = Some("http://127.0.0.1:1431".parse()?);
    let path = profile.path().to_path_buf();
    eprintln!("memory_regression pid={}", std::process::id());
    tauri::Builder::default()
        .manage(Arc::new(OutputHub::default()))
        .invoke_handler(tauri::generate_handler![pty_output_subscribe, pty_output_unsubscribe, pty_output_ack, probe_output, probe_pending])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("scripts/memory-regression-probe.html".into()))
                .data_directory(path)
                .title("Krosna memory regression probe")
                .visible(false).focused(false).skip_taskbar(true).inner_size(1000.0, 700.0)
                .additional_browser_args("--remote-debugging-address=127.0.0.1 --remote-debugging-port=9224 --enable-precise-memory-info --disable-background-timer-throttling")
                .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_secs(900)); handle.exit(0); });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<Arc<OutputHub>>().unsubscribe_output(window.label(), None);
            }
        })
        .run(context)?;
    drop(profile);
    Ok(())
}
