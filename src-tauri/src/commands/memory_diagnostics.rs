use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererMemory {
    pid: u32,
    working_set_bytes: u64,
    private_working_set_bytes: Option<u64>,
    private_commit_bytes: u64,
    frame_count: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct JsHeap {
    used_size: u64,
    total_size: u64,
    embedder_heap_used_size: Option<u64>,
    backing_storage_size: Option<u64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DomCounters {
    documents: u32,
    nodes: u32,
    js_event_listeners: u32,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewMemorySample {
    supported: bool,
    renderer: Option<RendererMemory>,
    heap: Option<JsHeap>,
    dom: Option<DomCounters>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewAllocation {
    category: &'static str,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewAllocations {
    pid: u32,
    allocations: Vec<WebviewAllocation>,
}

#[tauri::command]
pub async fn sample_webview_memory(window: WebviewWindow) -> Result<WebviewMemorySample, String> {
    #[cfg(windows)]
    {
        webview2::sample(&window).await
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(WebviewMemorySample::default())
    }
}

#[tauri::command]
pub async fn capture_webview_allocations(
    window: WebviewWindow,
) -> Result<WebviewAllocations, String> {
    #[cfg(windows)]
    {
        webview2::capture_allocations(&window).await
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("MEMORY_CAPTURE_UNAVAILABLE".into())
    }
}

#[cfg(windows)]
mod webview2 {
    use super::{
        DomCounters, JsHeap, RendererMemory, WebviewAllocation, WebviewAllocations,
        WebviewMemorySample,
    };
    use serde::de::DeserializeOwned;
    use serde_json::{json, Value};
    use std::{collections::BTreeMap, mem::size_of, time::Duration};
    use tauri::WebviewWindow;
    use tokio::sync::{mpsc, oneshot, Mutex};
    use webview2_com::{
        take_pwstr, CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR,
        DevToolsProtocolEventReceivedEventHandler, GetProcessExtendedInfosCompletedHandler,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2, ICoreWebView2Environment13, ICoreWebView2FrameInfo2,
            ICoreWebView2ProcessExtendedInfoCollection, ICoreWebView2_2, ICoreWebView2_20,
            COREWEBVIEW2_PROCESS_KIND_RENDERER,
        },
    };
    use windows::Win32::{
        Foundation::CloseHandle,
        System::{
            ProcessStatus::{
                K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX, PROCESS_MEMORY_COUNTERS_EX2,
            },
            Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        },
    };
    use windows_core::Interface;

    const SAMPLE_TIMEOUT: Duration = Duration::from_secs(4);
    const TRACE_TIMEOUT: Duration = Duration::from_secs(8);
    static TRACE_LOCK: Mutex<()> = Mutex::const_new(());
    const TRACE_DATA_EVENT: &str = "Tracing.dataCollected";
    const TRACE_END_EVENT: &str = "Tracing.tracingComplete";
    const ALLOCATION_CATEGORIES: &[(&str, &str, &str)] = &[
        ("v8", "v8", "effective_size"),
        ("blink", "blink_gc", "effective_size"),
        ("partitionAlloc", "partition_alloc", "effective_size"),
        ("malloc", "malloc", "effective_size"),
        ("mallocObjects", "malloc", "allocated_objects_size"),
        ("gpu", "gpu", "effective_size"),
        ("skia", "skia", "effective_size"),
        ("canvas", "canvas", "effective_size"),
        ("shared", "shared_memory", "effective_size"),
        ("discardable", "discardable", "effective_size"),
        ("webCache", "web_cache", "effective_size"),
    ];

    pub(super) async fn sample(window: &WebviewWindow) -> Result<WebviewMemorySample, String> {
        let (renderer_tx, renderer_rx) = oneshot::channel();
        let (heap_tx, heap_rx) = oneshot::channel();
        let (dom_tx, dom_rx) = oneshot::channel();
        window
            .with_webview(move |platform| {
                let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
                    return;
                };
                request_renderer(&core, renderer_tx);
                request_metric::<JsHeap>(&core, "Runtime.getHeapUsage", "{}", heap_tx);
                request_metric::<DomCounters>(&core, "Memory.getDOMCounters", "{}", dom_tx);
            })
            .map_err(|error| error.to_string())?;
        let (renderer, heap, dom) = tokio::join!(
            read_result(renderer_rx),
            read_result(heap_rx),
            read_result(dom_rx)
        );
        let renderer = match renderer.flatten() {
            Some((pid, frames)) => {
                tauri::async_runtime::spawn_blocking(move || read_process_memory(pid, frames))
                    .await
                    .ok()
                    .flatten()
            }
            None => None,
        };
        Ok(WebviewMemorySample {
            supported: true,
            renderer,
            heap,
            dom,
        })
    }

    async fn read_result<T>(rx: oneshot::Receiver<T>) -> Option<T> {
        tokio::time::timeout(SAMPLE_TIMEOUT, rx).await.ok()?.ok()
    }

    enum DevToolsError {
        Failed,
        Timeout,
    }

    async fn call_devtools(
        window: &WebviewWindow,
        method: &'static str,
        params: Value,
    ) -> Result<Value, DevToolsError> {
        let (tx, rx) = oneshot::channel();
        window
            .with_webview(move |platform| {
                let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
                    return;
                };
                request_metric::<Value>(&core, method, &params.to_string(), tx);
            })
            .map_err(|_| DevToolsError::Failed)?;
        tokio::time::timeout(TRACE_TIMEOUT, rx)
            .await
            .map_err(|_| DevToolsError::Timeout)?
            .map_err(|_| DevToolsError::Failed)
    }

    pub(super) async fn capture_allocations(
        window: &WebviewWindow,
    ) -> Result<WebviewAllocations, String> {
        let _lock = TRACE_LOCK.try_lock().map_err(|_| "MEMORY_CAPTURE_BUSY")?;
        let (tx, rx) = oneshot::channel();
        window
            .with_webview(move |platform| {
                if let Ok(core) = unsafe { platform.controller().CoreWebView2() } {
                    request_renderer(&core, tx);
                }
            })
            .map_err(|_| "MEMORY_CAPTURE_UNAVAILABLE")?;
        let (pid, _) = read_result(rx)
            .await
            .flatten()
            .ok_or("MEMORY_CAPTURE_UNAVAILABLE")?;
        let (data_tx, mut data_rx) = mpsc::channel(8);
        let (done_tx, done_rx) = oneshot::channel();
        let (tokens_tx, tokens_rx) = oneshot::channel();
        window
            .with_webview(move |platform| {
                if let Ok(core) = unsafe { platform.controller().CoreWebView2() } {
                    if let Ok(tokens) = subscribe_trace(&core, pid, data_tx, done_tx) {
                        if let Err(tokens) = tokens_tx.send(tokens) {
                            unsubscribe_trace(&core, tokens);
                        }
                    }
                }
            })
            .map_err(|_| "MEMORY_CAPTURE_UNAVAILABLE")?;
        let tokens = read_result(tokens_rx)
            .await
            .ok_or("MEMORY_CAPTURE_UNAVAILABLE")?;
        let result = take_trace(window, done_rx).await;
        let _ = window.with_webview(move |platform| {
            if let Ok(core) = unsafe { platform.controller().CoreWebView2() } {
                unsubscribe_trace(&core, tokens);
            }
        });
        result?;
        let mut combined = BTreeMap::new();
        while let Ok(batch) = data_rx.try_recv() {
            combined.extend(batch);
        }
        if combined.is_empty() {
            return Err("MEMORY_CAPTURE_UNAVAILABLE".into());
        }
        let mut allocations: Vec<_> = combined
            .into_iter()
            .map(|(category, bytes)| WebviewAllocation { category, bytes })
            .collect();
        allocations.sort_unstable_by(|left, right| right.bytes.cmp(&left.bytes));
        Ok(WebviewAllocations { pid, allocations })
    }

    async fn take_trace(
        window: &WebviewWindow,
        done: oneshot::Receiver<()>,
    ) -> Result<(), &'static str> {
        let start = call_devtools(
            window,
            "Tracing.start",
            json!({
                "traceConfig": {
                    "includedCategories": ["disabled-by-default-memory-infra"],
                    "traceBufferSizeInKb": 2048,
                    "memoryDumpConfig": { "triggers": [] },
                }
            }),
        )
        .await;
        if let Err(error) = start {
            if matches!(error, DevToolsError::Timeout) {
                let _ = call_devtools(window, "Tracing.end", json!({})).await;
            }
            return Err("MEMORY_CAPTURE_UNAVAILABLE");
        }
        let dump = call_devtools(
            window,
            "Tracing.requestMemoryDump",
            json!({
                "deterministic": false,
                "levelOfDetail": "light",
            }),
        )
        .await;
        let end = call_devtools(window, "Tracing.end", json!({})).await;
        if end.is_err() {
            return Err("MEMORY_CAPTURE_UNAVAILABLE");
        }
        read_result(done)
            .await
            .ok_or("MEMORY_CAPTURE_UNAVAILABLE")?;
        if !dump.is_ok_and(|value| value.get("success").and_then(Value::as_bool) == Some(true)) {
            return Err("MEMORY_CAPTURE_UNAVAILABLE");
        }
        Ok(())
    }

    fn subscribe_trace(
        core: &ICoreWebView2,
        pid: u32,
        data_tx: mpsc::Sender<BTreeMap<&'static str, u64>>,
        done_tx: oneshot::Sender<()>,
    ) -> windows_core::Result<(i64, i64)> {
        let data_name = CoTaskMemPWSTR::from(TRACE_DATA_EVENT);
        let end_name = CoTaskMemPWSTR::from(TRACE_END_EVENT);
        let data_handler =
            DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut json = Default::default();
                    unsafe { args.ParameterObjectAsJson(&mut json)? };
                    let json = take_pwstr(json);
                    if json.len() <= 8 * 1024 * 1024 {
                        if let Ok(value) = serde_json::from_str(&json) {
                            let batch = parse_allocations(&value, pid);
                            if !batch.is_empty() {
                                let _ = data_tx.try_send(batch);
                            }
                        }
                    }
                }
                Ok(())
            }));
        let mut done = Some(done_tx);
        let end_handler =
            DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, _| {
                if let Some(tx) = done.take() {
                    let _ = tx.send(());
                }
                Ok(())
            }));
        unsafe {
            let data = core.GetDevToolsProtocolEventReceiver(*data_name.as_ref().as_pcwstr())?;
            let end = core.GetDevToolsProtocolEventReceiver(*end_name.as_ref().as_pcwstr())?;
            let mut data_token = 0;
            let mut end_token = 0;
            data.add_DevToolsProtocolEventReceived(&data_handler, &mut data_token)?;
            if let Err(error) = end.add_DevToolsProtocolEventReceived(&end_handler, &mut end_token)
            {
                let _ = data.remove_DevToolsProtocolEventReceived(data_token);
                return Err(error);
            }
            Ok((data_token, end_token))
        }
    }

    fn unsubscribe_trace(core: &ICoreWebView2, tokens: (i64, i64)) {
        for (name, token) in [(TRACE_DATA_EVENT, tokens.0), (TRACE_END_EVENT, tokens.1)] {
            let name = CoTaskMemPWSTR::from(name);
            unsafe {
                if let Ok(receiver) =
                    core.GetDevToolsProtocolEventReceiver(*name.as_ref().as_pcwstr())
                {
                    let _ = receiver.remove_DevToolsProtocolEventReceived(token);
                }
            }
        }
    }

    fn parse_allocations(event: &Value, pid: u32) -> BTreeMap<&'static str, u64> {
        let mut seen = BTreeMap::new();
        let Some(entries) = event.get("value").and_then(Value::as_array) else {
            return seen;
        };
        for entry in entries {
            if entry.get("pid").and_then(Value::as_u64) != Some(u64::from(pid)) {
                continue;
            }
            let Some(allocators) = entry.pointer("/args/dumps/allocators") else {
                continue;
            };
            for &(category, name, field) in ALLOCATION_CATEGORIES {
                let value = &allocators[name]["attrs"][field];
                if value["units"].as_str() == Some("bytes") {
                    if let Some(bytes) = value["value"]
                        .as_str()
                        .and_then(|value| u64::from_str_radix(value, 16).ok())
                    {
                        seen.insert(category, bytes);
                    }
                }
            }
        }
        seen
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn reports_only_byte_counters_for_the_requested_renderer() {
            let event = json!({"value": [
                {"pid": 41, "args": {"dumps": {"allocators": {
                    "v8": {"attrs": {"effective_size": {"units": "bytes", "value": "ff"}}}
                }}}},
                {"pid": 42, "args": {"dumps": {"allocators": {
                    "v8": {"attrs": {"effective_size": {"units": "bytes", "value": "a00000"}}},
                    "malloc": {"attrs": {
                        "effective_size": {"units": "bytes", "value": "400"},
                        "allocated_objects_size": {"units": "bytes", "value": "200"}
                    }},
                    "gpu": {"attrs": {"effective_size": {"units": "objects", "value": "10"}}},
                    "skia": {"attrs": {"effective_size": {"units": "bytes", "value": "0"}}},
                    "canvas": {"attrs": {"effective_size": {"units": "bytes", "value": "invalid"}}},
                    "v8/heap/private_detail": {"attrs": {"effective_size": {"units": "bytes", "value": "c0"}}}
                }}}}
            ]});
            assert_eq!(
                parse_allocations(&event, 42),
                BTreeMap::from([
                    ("malloc", 0x400),
                    ("mallocObjects", 0x200),
                    ("skia", 0),
                    ("v8", 0xa00000),
                ])
            );
            assert!(parse_allocations(&event, 43).is_empty());
        }
    }

    fn request_metric<T: DeserializeOwned + 'static>(
        core: &ICoreWebView2,
        method: &str,
        params: &str,
        tx: oneshot::Sender<T>,
    ) {
        let handler =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, json| {
                if result.is_ok() {
                    if let Ok(value) = serde_json::from_str(&json) {
                        let _ = tx.send(value);
                    }
                }
                Ok(())
            }));
        let method = CoTaskMemPWSTR::from(method);
        let params = CoTaskMemPWSTR::from(params);
        let _ = unsafe {
            core.CallDevToolsProtocolMethod(
                *method.as_ref().as_pcwstr(),
                *params.as_ref().as_pcwstr(),
                &handler,
            )
        };
    }

    fn request_renderer(core: &ICoreWebView2, tx: oneshot::Sender<Option<(u32, u32)>>) {
        let _ = (|| -> windows_core::Result<()> {
            let mut frame_id = 0;
            let environment = unsafe {
                core.cast::<ICoreWebView2_20>()?.FrameId(&mut frame_id)?;
                core.cast::<ICoreWebView2_2>()?.Environment()?
            };
            let handler = GetProcessExtendedInfosCompletedHandler::create(Box::new(
                move |result, processes| {
                    let matched = result
                        .ok()
                        .and_then(|_| processes)
                        .and_then(|processes| find_renderer(&processes, frame_id).ok().flatten());
                    let _ = tx.send(matched);
                    Ok(())
                },
            ));
            unsafe {
                environment
                    .cast::<ICoreWebView2Environment13>()?
                    .GetProcessExtendedInfos(&handler)
            }
        })();
    }

    fn find_renderer(
        processes: &ICoreWebView2ProcessExtendedInfoCollection,
        target_frame_id: u32,
    ) -> windows_core::Result<Option<(u32, u32)>> {
        // FrameId 可区分同源的工作区、语音窗口和跨源 iframe。
        unsafe {
            let mut count = 0;
            processes.Count(&mut count)?;
            for index in 0..count {
                let extended = processes.GetValueAtIndex(index)?;
                let process = extended.ProcessInfo()?;
                let mut kind = Default::default();
                process.Kind(&mut kind)?;
                if kind != COREWEBVIEW2_PROCESS_KIND_RENDERER {
                    continue;
                }
                // WebView2 的迭代器依赖原始集合，遍历完成前必须保持集合存活。
                let associated_frames = extended.AssociatedFrameInfos()?;
                let frames = associated_frames.GetIterator()?;
                let mut has_current = Default::default();
                frames.HasCurrent(&mut has_current)?;
                let mut matched = false;
                let mut frame_count = 0;
                while has_current.as_bool() {
                    let frame = frames.GetCurrent()?;
                    let mut frame_id = 0;
                    frame
                        .cast::<ICoreWebView2FrameInfo2>()?
                        .FrameId(&mut frame_id)?;
                    matched |= frame_id == target_frame_id;
                    frame_count += 1;
                    frames.MoveNext(&mut has_current)?;
                }
                if matched {
                    let mut pid = 0;
                    process.ProcessId(&mut pid)?;
                    return Ok(u32::try_from(pid)
                        .ok()
                        .filter(|pid| *pid != 0)
                        .map(|pid| (pid, frame_count)));
                }
            }
        }
        Ok(None)
    }

    fn read_process_memory(pid: u32, frame_count: u32) -> Option<RendererMemory> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut extended = PROCESS_MEMORY_COUNTERS_EX2 {
                cb: size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32,
                ..Default::default()
            };
            let sample = if K32GetProcessMemoryInfo(
                handle,
                (&mut extended as *mut PROCESS_MEMORY_COUNTERS_EX2).cast(),
                extended.cb,
            )
            .as_bool()
            {
                Some(RendererMemory {
                    pid,
                    frame_count,
                    working_set_bytes: extended.WorkingSetSize as u64,
                    private_working_set_bytes: Some(extended.PrivateWorkingSetSize as u64),
                    private_commit_bytes: extended.PrivateUsage as u64,
                })
            } else {
                let mut counters = PROCESS_MEMORY_COUNTERS_EX {
                    cb: size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
                    ..Default::default()
                };
                K32GetProcessMemoryInfo(
                    handle,
                    (&mut counters as *mut PROCESS_MEMORY_COUNTERS_EX).cast(),
                    counters.cb,
                )
                .as_bool()
                .then_some(RendererMemory {
                    pid,
                    frame_count,
                    working_set_bytes: counters.WorkingSetSize as u64,
                    private_working_set_bytes: None,
                    private_commit_bytes: counters.PrivateUsage as u64,
                })
            };
            let _ = CloseHandle(handle);
            sample
        }
    }
}
