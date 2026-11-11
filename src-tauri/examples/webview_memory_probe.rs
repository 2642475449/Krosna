//! 隔离的 WebView2 诊断宿主，不启动主应用、数据库、CLI 或任何插件。
//! 示例：cargo run --example webview_memory_probe -- --duration-seconds 30
//! 可选：--url http://127.0.0.1:1420/diagnostics.html --debug-port 9223
//! 输出通道对照：--output-transport eval 或 web-message（20,000 条、每条 4 KiB）。

#[cfg(windows)]
mod probe {
    use std::{error::Error, io, net::IpAddr, path::PathBuf, thread, time::Duration};
    use tauri::{Url, WebviewUrl, WebviewWindowBuilder};
    use webview2_com::ProcessFailedEventHandler;

    struct Options {
        url: Url,
        duration: Duration,
        debug_port: Option<u16>,
        runtime_directory: Option<PathBuf>,
        windows: u8,
        unthrottled: bool,
        visible: bool,
        output_transport: Option<String>,
    }

    fn invalid(message: &str) -> io::Error {
        io::Error::new(io::ErrorKind::InvalidInput, message)
    }

    fn options() -> Result<Options, Box<dyn Error>> {
        let mut result = Options {
            url: Url::parse("about:blank")?,
            duration: Duration::from_secs(30),
            debug_port: None,
            runtime_directory: None,
            windows: 1,
            unthrottled: false,
            visible: false,
            output_transport: None,
        };
        let mut arguments = std::env::args().skip(1);
        while let Some(argument) = arguments.next() {
            match argument.as_str() {
                "--output-transport" => {
                    let mode = arguments
                        .next()
                        .ok_or_else(|| invalid("Missing transport"))?;
                    if mode != "eval" && mode != "web-message" {
                        return Err(invalid("Transport must be eval or web-message").into());
                    }
                    result.output_transport = Some(mode);
                }
                "--visible" => result.visible = true,
                "--unthrottled" => result.unthrottled = true,
                "--windows" => {
                    let count: u8 = arguments
                        .next()
                        .ok_or_else(|| invalid("Missing window count"))?
                        .parse()?;
                    if !(1..=4).contains(&count) {
                        return Err(invalid("Window count must be between 1 and 4").into());
                    }
                    result.windows = count;
                }
                "--url" => {
                    let value = arguments.next().ok_or_else(|| invalid("Missing URL"))?;
                    let url = Url::parse(&value)?;
                    let loopback = url.host_str().is_some_and(|host| {
                        host == "localhost"
                            || host
                                .trim_matches(['[', ']'])
                                .parse::<IpAddr>()
                                .is_ok_and(|address| address.is_loopback())
                    });
                    if value != "about:blank"
                        && (url.scheme() != "http"
                            || !loopback
                            || !url.username().is_empty()
                            || url.password().is_some())
                    {
                        return Err(invalid(
                            "Only an HTTP loopback URL or about:blank is accepted",
                        )
                        .into());
                    }
                    result.url = url;
                }
                "--duration-seconds" => {
                    let seconds: u64 = arguments
                        .next()
                        .ok_or_else(|| invalid("Missing duration"))?
                        .parse()?;
                    if !(1..=600).contains(&seconds) {
                        return Err(invalid("Duration must be between 1 and 600 seconds").into());
                    }
                    result.duration = Duration::from_secs(seconds);
                }
                "--debug-port" => {
                    let port: u16 = arguments
                        .next()
                        .ok_or_else(|| invalid("Missing debug port"))?
                        .parse()?;
                    if port < 1024 {
                        return Err(invalid("Debug port must be between 1024 and 65535").into());
                    }
                    result.debug_port = Some(port);
                }
                "--runtime-directory" => {
                    let directory = PathBuf::from(
                        arguments
                            .next()
                            .ok_or_else(|| invalid("Missing runtime directory"))?,
                    );
                    if !directory.is_absolute() || !directory.join("msedgewebview2.exe").is_file() {
                        return Err(invalid(
                            "Runtime directory must be absolute and contain msedgewebview2.exe",
                        )
                        .into());
                    }
                    result.runtime_directory = Some(directory);
                }
                _ => return Err(invalid("Unknown probe argument").into()),
            }
        }
        Ok(result)
    }

    pub fn run() -> Result<(), Box<dyn Error>> {
        let options = options()?;
        let profile_directory = tempfile::Builder::new()
            .prefix("krosna-webview-memory-")
            .tempdir()?;
        let profile_path = profile_directory.path().to_path_buf();

        // 环境变量只影响该诊断子进程；即使继承了外部覆盖，也不能使用生产 profile。
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &profile_path);
        std::env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
        if let Some(directory) = &options.runtime_directory {
            std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", directory);
        }

        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context.config_mut().identifier = format!("com.krosna.memoryprobe.p{}", std::process::id());

        eprintln!(
            "memory_probe pid={} duration_seconds={} windows={} profile={}",
            std::process::id(),
            options.duration.as_secs(),
            options.windows,
            profile_path.display()
        );
        tauri::Builder::default()
            .setup(move |app| {
                let exit_handle = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(options.duration);
                    exit_handle.exit(0);
                });

                for index in 1..=options.windows {
                    let label = format!("memory-probe-{index}");
                    let mut url = options.url.clone();
                    if url.scheme() == "http" {
                        url.query_pairs_mut()
                            .append_pair("writer", &index.to_string());
                    }
                    let mut builder =
                        WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
                            .title("Krosna WebView Memory Probe")
                            .data_directory(profile_path.clone())
                            .visible(options.visible)
                            .focused(false)
                            .skip_taskbar(!options.visible)
                            .inner_size(800.0, 600.0);
                    if options.output_transport.is_some() {
                        builder = builder.initialization_script(r#"
                            let count = 0, chars = 0, ordered = true;
                            window.__memoryProbeReceive = (data) => {
                                ordered &&= data.sequence === count;
                                count++; chars += data.text.length;
                                if (count === 20000) window.chrome.webview.postMessage({
                                    probeComplete: true, count, chars, ordered
                                });
                            };
                            window.chrome.webview.addEventListener('message', (event) => {
                                window.__memoryProbeReceive(event.data);
                            });
                        "#);
                    }
                    let mut browser_arguments = Vec::new();
                    if let Some(port) = options.debug_port {
                        browser_arguments.push(format!(
                            "--remote-debugging-address=127.0.0.1 --remote-debugging-port={port}"
                        ));
                    }
                    if options.unthrottled {
                        // 仅用于对照实验，使隐藏窗口的计时器保持设定的写入频率。
                        browser_arguments.push("--disable-background-timer-throttling".into());
                    }
                    if !browser_arguments.is_empty() {
                        builder = builder.additional_browser_args(&browser_arguments.join(" "));
                    }
                    let window = builder.build()?;
                    window.with_webview(move |platform| {
                        let result = (|| unsafe {
                            let core = platform.controller().CoreWebView2()?;
                            let mut browser_pid = 0;
                            core.BrowserProcessId(&mut browser_pid)?;
                            eprintln!("memory_probe window={label} browser_pid={browser_pid}");
                            let handler =
                                ProcessFailedEventHandler::create(Box::new(move |_, args| {
                                    if let Some(args) = args {
                                        let mut kind = Default::default();
                                        args.ProcessFailedKind(&mut kind)?;
                                        // 仅记录故障枚举；不采集网页、URL、命令行或用户文本。
                                        eprintln!(
                                            "memory_probe window={label} process_failed kind={}",
                                            kind.0
                                        );
                                    }
                                    Ok(())
                                }));
                            let mut token = 0;
                            // WebView2 在该临时 WebView 销毁前持有回调。
                            core.add_ProcessFailed(&handler, &mut token)
                        })();
                        if let Err(error) = result {
                            eprintln!("memory_probe native_diagnostics_error={error}");
                        }
                    })?;
                    if let Some(transport) = options.output_transport.clone() {
                        window.with_webview(|platform| unsafe {
                            let core = platform.controller().CoreWebView2().expect("probe core");
                            let handler = webview2_com::WebMessageReceivedEventHandler::create(Box::new(|_, args| {
                                if let Some(args) = args {
                                    let mut value = Default::default();
                                    args.WebMessageAsJson(&mut value)?;
                                    let value = webview2_com::take_pwstr(value);
                                    eprintln!("memory_probe received={value}");
                                }
                                Ok(())
                            }));
                            let mut token = 0;
                            core.add_WebMessageReceived(&handler, &mut token).expect("probe listener");
                        })?;
                        thread::spawn(move || {
                            thread::sleep(Duration::from_secs(2));
                            for sequence in 0..20000 {
                                let json = serde_json::json!({ "sequence": sequence, "text": "x".repeat(4096) }).to_string();
                                if transport == "eval" {
                                    let _ = window.eval(&format!("window.__memoryProbeReceive({json})"));
                                } else {
                                    let _ = window.with_webview(move |platform| unsafe {
                                        let json = webview2_com::CoTaskMemPWSTR::from(json.as_str());
                                        let result = platform.controller().CoreWebView2()
                                            .and_then(|core| core.PostWebMessageAsJson(*json.as_ref().as_pcwstr()));
                                        if let Err(error) = result { eprintln!("memory_probe send_error={error}"); }
                                    });
                                }
                                if sequence % 20 == 19 {
                                    thread::sleep(Duration::from_millis(10));
                                }
                            }
                            eprintln!("memory_probe sent=20000 transport={transport}");
                        });
                    }
                }
                Ok(())
            })
            .run(context)?;

        // TempDir 仅清理本程序新建的临时目录，不触碰生产数据。
        drop(profile_directory);
        Ok(())
    }
}

#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    probe::run()
}

#[cfg(not(windows))]
fn main() {
    eprintln!("This WebView2 memory probe requires Windows.");
}
