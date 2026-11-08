use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use termflow_terminal_eval::{Backend, Config, Packet};

struct State {
    backend: Mutex<Option<Arc<Backend>>>,
}

#[tauri::command]
fn start_workload(app: tauri::AppHandle, state: tauri::State<State>) -> Result<Config, String> {
    let mut slot = state.backend.lock().unwrap();
    if slot.is_some() {
        return Err("already started".into());
    }
    let config = Config::from_args("webview");
    let (backend, receiver) = Backend::new(config.clone()).map_err(|e| e.to_string())?;
    *slot = Some(backend);
    std::thread::spawn(move || {
        for packet in receiver {
            if app.emit("eval-output", packet).is_err() {
                break;
            }
        }
    });
    Ok(config)
}

#[derive(serde::Deserialize)]
struct ParsedSample {
    packet: Packet,
    parse_us: f64,
    byte_count: usize,
}

#[tauri::command]
fn parsed(samples: Vec<ParsedSample>, state: tauri::State<State>) {
    if let Some(backend) = state.backend.lock().unwrap().as_ref() {
        for sample in samples {
            backend.observe_parsed(&sample.packet, sample.parse_us, sample.byte_count);
        }
    }
}
#[tauri::command]
fn input(session: usize, data: String, state: tauri::State<State>) -> Result<(), String> {
    state
        .backend
        .lock()
        .unwrap()
        .as_ref()
        .ok_or("not started")?
        .input(session, &data)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn tick(gap_ms: f64, painted: u64, app: tauri::AppHandle, state: tauri::State<State>) {
    if let Some(backend) = state.backend.lock().unwrap().as_ref() {
        backend.ui_gap(gap_ms);
        for _ in 0..painted {
            backend.painted();
        }
        if backend.finished() {
            if let Err(error) = backend.save("webview") {
                eprintln!("report: {error}");
            }
            backend.shutdown();
            app.exit(0);
        }
    }
}
fn main() {
    if termflow_terminal_eval::run_producer_if_requested() {
        return;
    }
    tauri::Builder::default()
        .manage(State {
            backend: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            start_workload,
            parsed,
            input,
            tick
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(backend) = window.state::<State>().backend.lock().unwrap().as_ref() {
                    backend.shutdown();
                }
            }
        })
        .run(tauri::generate_context!("tauri.conf.json"))
        .expect("run isolated xterm evaluation");
}
