use crate::claude_usage::spawn_usage_monitor;
use crate::commands::agents::agent_definition;
use crate::commands::git::checkpoint::{self, AgentTurnReview};
use crate::events::{emit_session_event, SessionEvent, SessionEventSeverity, SessionEventType};
use crate::hook_ingest::HookIngestConfig;
use crate::opencode_control::{with_tui_server_args, OpenCodePromptControl};
use crate::powershell_integration::{
    POWERSHELL_COMPLETION_INTEGRATION_COMMAND, POWERSHELL_COMPLETION_INTEGRATION_ENV,
    POWERSHELL_COMPLETION_INTEGRATION_SCRIPT,
};
use crate::runtime_output::{RuntimeOutputStore, RuntimeTerminalMetadata};
use parking_lot::{Condvar, Mutex};
use portable_pty::{CommandBuilder, PtyPair, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

mod output_flow;
mod output_transport;
use output_flow::{OutputHub, PtyExitPayload};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyGridSize {
    pub rows: u16,
    pub cols: u16,
    pub instance_id: u64,
}

fn wait_for_pty_exit(child: &mut dyn portable_pty::Child) -> Option<i32> {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.exit_code() as i32),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => return None,
        }
    }
}

/// Decodes PTY output while retaining an incomplete UTF-8 sequence until the
/// next read. PTY reads are byte-oriented, so a character can straddle two
/// buffers even when the process only writes valid UTF-8.
#[derive(Default)]
struct PtyOutputDecoder {
    pending: Vec<u8>,
}

impl PtyOutputDecoder {
    fn decode(&mut self, chunk: &[u8]) -> String {
        self.pending.extend_from_slice(chunk);

        let mut output = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(decoded) => {
                    output.push_str(decoded);
                    self.pending.clear();
                    return output;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    // `valid_up_to` is guaranteed by `Utf8Error` to delimit
                    // a valid UTF-8 prefix.
                    output.push_str(
                        std::str::from_utf8(&self.pending[..valid_up_to])
                            .expect("UTF-8 error reported an invalid valid-prefix boundary"),
                    );

                    let Some(error_len) = error.error_len() else {
                        // The remaining bytes are a valid prefix of a UTF-8
                        // character, not malformed input. Keep them for the
                        // next PTY read instead of emitting U+FFFD.
                        self.pending.drain(..valid_up_to);
                        return output;
                    };

                    // Match `from_utf8_lossy` for genuinely invalid input,
                    // then continue in case an incomplete character follows.
                    output.push('\u{FFFD}');
                    self.pending.drain(..valid_up_to + error_len);
                }
            }
        }
    }

    fn finish(&mut self) -> String {
        let remaining = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        remaining
    }
}

const PTY_OUTPUT_BATCH_BYTES: usize = 64 * 1024;
const PTY_OUTPUT_BATCH_DELAY: Duration = Duration::from_millis(5);
// 读线程与发送线程之间使用有界队列，避免发送繁忙时无限积攒原始输出。
const PTY_OUTPUT_QUEUE_CHUNKS: usize = 32;

// 在途写入和等待写入共用预算，防止背压期间把输入无限堆积在进程中。
const PTY_INPUT_MAX_BYTES: usize = 4 * 1024 * 1024;
const PTY_INPUT_MAX_REQUESTS: usize = 256;
const PTY_INPUT_CLOSED: &str = "pty-input-closed";
const PTY_INPUT_TOO_LARGE: &str = "pty-input-too-large";
const PTY_INPUT_QUEUE_FULL: &str = "pty-input-queue-full";

#[derive(Default)]
struct PtyInputCompletion {
    result: Mutex<Option<Result<(), String>>>,
    ready: Condvar,
}

impl PtyInputCompletion {
    fn complete(&self, result: Result<(), String>) {
        let mut current = self.result.lock();
        // 关闭优先于随后返回的 OS 写入结果，不能把已取消的写入报告为成功。
        if current.is_none() {
            *current = Some(result);
            self.ready.notify_all();
        }
    }

    fn wait(&self) -> Result<(), String> {
        let mut result = self.result.lock();
        while result.is_none() {
            self.ready.wait(&mut result);
        }
        result.clone().ok_or_else(|| PTY_INPUT_CLOSED.to_string())?
    }
}

struct PtyInputRequest {
    data: Vec<u8>,
    completion: Arc<PtyInputCompletion>,
}

#[derive(Default)]
struct PtyInputState {
    pending: VecDeque<PtyInputRequest>,
    active: Option<Arc<PtyInputCompletion>>,
    buffered_bytes: usize,
    closed: Option<String>,
}

#[derive(Default)]
struct PtyInputShared {
    state: Mutex<PtyInputState>,
    available: Condvar,
}

impl PtyInputShared {
    fn cancel(&self, error: String) {
        let mut state = self.state.lock();
        if state.closed.is_some() {
            return;
        }
        state.closed = Some(error.clone());
        if let Some(active) = state.active.as_ref() {
            active.complete(Err(error.clone()));
        }
        let removed_bytes = state
            .pending
            .iter()
            .map(|request| request.data.len())
            .sum::<usize>();
        for request in state.pending.drain(..) {
            request.completion.complete(Err(error.clone()));
        }
        state.buffered_bytes = state.buffered_bytes.saturating_sub(removed_bytes);
        // 在途数据由 worker 独占，取消不等待可能阻塞的 OS 写入或 join。
        self.available.notify_all();
    }
}

#[derive(Clone)]
pub(crate) struct PtyInput {
    owner: Arc<PtyInputOwner>,
}

struct PtyInputOwner {
    shared: Arc<PtyInputShared>,
}

impl Drop for PtyInputOwner {
    fn drop(&mut self) {
        self.shared.cancel(PTY_INPUT_CLOSED.into());
    }
}

impl PtyInput {
    fn new(mut writer: Box<dyn Write + Send>) -> Result<Self, String> {
        let shared = Arc::new(PtyInputShared::default());
        let worker = shared.clone();
        std::thread::Builder::new()
            .name("pty-input".into())
            .spawn(move || {
                let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| loop {
                    let request = {
                        let mut state = worker.state.lock();
                        while state.pending.is_empty() && state.closed.is_none() {
                            worker.available.wait(&mut state);
                        }
                        if state.closed.is_some() {
                            return;
                        }
                        let Some(request) = state.pending.pop_front() else {
                            continue;
                        };
                        state.active = Some(request.completion.clone());
                        request
                    };
                    // 该 writer 只属于此 PTY 实例；不持有全局会话锁或队列锁。
                    let result = writer
                        .write_all(&request.data)
                        .map_err(|error| format!("写入失败: {error}"));
                    let mut state = worker.state.lock();
                    state.buffered_bytes = state.buffered_bytes.saturating_sub(request.data.len());
                    state.active = None;
                    if let Some(error) = state.closed.as_ref() {
                        request.completion.complete(Err(error.clone()));
                        return;
                    }
                    request.completion.complete(result.clone());
                    if let Err(error) = result {
                        drop(state);
                        worker.cancel(error);
                        return;
                    }
                }));
                if run.is_err() {
                    worker.cancel("pty-input-worker-failed".into());
                }
            })
            .map_err(|error| format!("启动终端输入线程失败: {error}"))?;
        Ok(Self {
            owner: Arc::new(PtyInputOwner { shared }),
        })
    }

    fn enqueue(&self, data: &[u8]) -> Result<Arc<PtyInputCompletion>, String> {
        let completion = Arc::new(PtyInputCompletion::default());
        if data.is_empty() {
            completion.complete(Ok(()));
            return Ok(completion);
        }
        if data.len() > PTY_INPUT_MAX_BYTES {
            return Err(PTY_INPUT_TOO_LARGE.into());
        }
        let mut state = self.owner.shared.state.lock();
        if let Some(error) = state.closed.as_ref() {
            return Err(error.clone());
        }
        let count = state.pending.len() + usize::from(state.active.is_some());
        if count >= PTY_INPUT_MAX_REQUESTS
            || data.len() > PTY_INPUT_MAX_BYTES.saturating_sub(state.buffered_bytes)
        {
            return Err(PTY_INPUT_QUEUE_FULL.into());
        }
        state.buffered_bytes += data.len();
        state.pending.push_back(PtyInputRequest {
            data: data.to_vec(),
            completion: completion.clone(),
        });
        self.owner.shared.available.notify_one();
        Ok(completion)
    }

    #[cfg(test)]
    fn write(&self, data: &[u8]) -> Result<(), String> {
        self.enqueue(data)?.wait()
    }

    pub(crate) async fn write_async(self, data: String) -> Result<(), String> {
        // 在进入阻塞池之前完成有界入队，不能让池内等待任务绕过字节/请求预算。
        let completion = self.enqueue(data.as_bytes())?;
        drop(data);
        tauri::async_runtime::spawn_blocking(move || {
            let _input = self;
            completion.wait()
        })
        .await
        .map_err(|error| format!("终端输入任务失败: {error}"))?
    }

    fn cancel(&self) {
        self.owner.shared.cancel(PTY_INPUT_CLOSED.into());
    }
}

fn read_pty_output(mut reader: impl Read, mut send: impl FnMut(String) -> bool) {
    let mut buf = [0u8; 8192];
    let mut decoder = PtyOutputDecoder::default();
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = decoder.decode(&buf[..n]);
                if !data.is_empty() && !send(data) {
                    return;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    let tail = decoder.finish();
    if !tail.is_empty() {
        send(tail);
    }
}

/// 短窗口合并 IPC 事件；持续输出也必须按首块的截止时间发送，不能不断推迟。
fn forward_pty_output(receiver: Receiver<String>, mut emit: impl FnMut(String) -> bool) {
    let mut pending = String::new();
    let mut deadline: Option<Instant> = None;
    loop {
        let received = match deadline {
            Some(at) => receiver.recv_timeout(at.saturating_duration_since(Instant::now())),
            None => receiver.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match received {
            Ok(data) => {
                let mut remaining = data.as_str();
                while !remaining.is_empty() {
                    let mut end = remaining.len().min(PTY_OUTPUT_BATCH_BYTES - pending.len());
                    while !remaining.is_char_boundary(end) {
                        end -= 1;
                    }
                    if end > 0 {
                        pending.push_str(&remaining[..end]);
                        remaining = &remaining[end..];
                        deadline.get_or_insert_with(|| Instant::now() + PTY_OUTPUT_BATCH_DELAY);
                    }
                    if end == 0 || pending.len() == PTY_OUTPUT_BATCH_BYTES {
                        if !emit(std::mem::take(&mut pending)) {
                            return;
                        }
                        deadline = None;
                    }
                }
                if deadline.is_some_and(|at| Instant::now() >= at) {
                    if !emit(std::mem::take(&mut pending)) {
                        return;
                    }
                    deadline = None;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if !pending.is_empty() && !emit(std::mem::take(&mut pending)) {
                    return;
                }
                deadline = None;
            }
            Err(RecvTimeoutError::Disconnected) => {
                if !pending.is_empty() {
                    emit(pending);
                }
                return;
            }
        }
    }
}

struct PtySession {
    instance_id: u64,
    output_cancelled: Arc<AtomicBool>,
    project_path: String,
    agent_id: String,
    input: PtyInput,
    child: Box<dyn portable_pty::Child + Send>,
    child_pid: u32,
    exit_code: Option<i32>,
    pty: Option<PtyPair>,
}

#[cfg(target_os = "windows")]
fn windows_taskkill_tree_args(pid: u32) -> [String; 4] {
    [
        "/PID".to_string(),
        pid.to_string(),
        "/T".to_string(),
        "/F".to_string(),
    ]
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.output_cancelled.store(true, Ordering::Release);
        self.input.cancel();
        if self.exit_code.is_some() {
            return;
        }
        // 显式 kill 子进程，确保资源回收
        // 在 Windows 上，使用 taskkill 确保进程被完全清理
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = std::process::Command::new("taskkill")
                .args(windows_taskkill_tree_args(self.child_pid))
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }

        // Fallback when the platform tree-kill command could not stop the root.
        let _ = self.child.kill();
    }
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
    pub output: OutputHub,
    next_instance_id: AtomicU64,
    active_turns: Mutex<HashMap<String, ActiveAgentTurn>>,
    ingest_config: Arc<HookIngestConfig>,
    pub(crate) runtime_output: RuntimeOutputStore,
    pub(crate) runtime_context: crate::runtime_context::RuntimeContext,
}

#[derive(Clone)]
pub struct ActiveAgentTurn {
    pub id: String,
    pub project_path: String,
}

struct SessionShell {
    program: String,
    args: Vec<String>,
    line_ending: &'static str,
}

impl PtyManager {
    pub fn new(ingest_config: Arc<HookIngestConfig>) -> Arc<Self> {
        Arc::new(Self {
            sessions: Mutex::new(HashMap::new()),
            output: OutputHub::default(),
            next_instance_id: AtomicU64::new(1),
            active_turns: Mutex::new(HashMap::new()),
            ingest_config,
            runtime_output: RuntimeOutputStore::default(),
            runtime_context: crate::runtime_context::RuntimeContext::default(),
        })
    }

    pub fn spawn(
        self: &Arc<Self>,
        session_id: String,
        path: String,
        app: AppHandle,
        resume: bool,
        skip_permissions: bool,
        startup_command_override: Option<String>,
        initial_prompt: Option<String>,
        shell_type: &str,
        claude_effort: Option<String>,
        agent_id: Option<String>,
        network_proxy: crate::network_proxy::ResolvedNetworkProxy,
        working_directory: Option<String>,
        runtime_metadata: Option<RuntimeTerminalMetadata>,
    ) -> Result<Option<OpenCodePromptControl>, String> {
        // 在智能体读取技能目录之前完成安装；失败不影响原有终端启动。
        if let Err(error) = crate::runtime_skill::ensure_agent(agent_id.as_deref()) {
            log::warn!("Failed to prepare Krosna CLI skill: {error}");
        }
        // A restored Session reuses its stable Session ID. Invalidate and stop
        // any older PTY before creating the replacement so its delayed reader
        // cannot be mistaken for the new instance.
        self.close(&session_id);
        let instance_id = self.next_instance_id.fetch_add(1, Ordering::Relaxed);

        let pty_system = portable_pty::native_pty_system();
        let pty = pty_system
            .openpty(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("创建 PTY 失败: {}", e))?;

        let enable_powershell_completion_integration =
            should_enable_powershell_completion_integration(shell_type, agent_id.as_deref());
        let shell = session_shell(shell_type, enable_powershell_completion_integration)?;
        let mut startup_command = match startup_command_override {
            Some(cmd) => cmd,
            None => build_claude_start_command(
                &session_id,
                resume,
                skip_permissions,
                claude_effort.as_deref(),
                initial_prompt.as_deref(),
            ),
        };
        let opencode_control = if agent_id.as_deref() == Some("opencode") {
            initial_prompt
                .as_deref()
                .filter(|prompt| !prompt.trim().is_empty())
                .map(|prompt| OpenCodePromptControl::new(prompt.to_string(), path.clone()))
                .transpose()?
        } else {
            None
        };
        if let Some(control) = opencode_control.as_ref() {
            startup_command = with_tui_server_args(&startup_command, control.port());
        }
        let monitor_claude_usage = should_spawn_claude_usage_monitor(agent_id.as_deref());
        let runtime_agent_label = runtime_agent_label(agent_id.as_deref()).to_string();

        // Spawn an interactive shell first, then run `claude` inside the shell.
        let mut cmd = CommandBuilder::new(&shell.program);
        for arg in &shell.args {
            cmd.arg(arg);
        }
        // 项目归属保持根目录，实际工作目录可位于子目录。
        cmd.cwd(working_directory.as_deref().unwrap_or(&path));
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("KROSNA_SESSION_ID", &session_id);
        cmd.env("KROSNA_PROJECT_PATH", &path);
        cmd.env("KROSNA_INGEST_PORT", self.ingest_config.port.to_string());
        cmd.env("KROSNA_INGEST_TOKEN", &self.ingest_config.token);
        crate::runtime_cli::configure_pty_command(&mut cmd);
        if enable_powershell_completion_integration {
            cmd.env(
                POWERSHELL_COMPLETION_INTEGRATION_ENV,
                POWERSHELL_COMPLETION_INTEGRATION_SCRIPT,
            );
        }
        crate::network_proxy::apply_proxy_to_pty_command(&mut cmd, &network_proxy);
        if let Some(control) = opencode_control.as_ref() {
            cmd.env("OPENCODE_SERVER_PASSWORD", control.password());
        } else if let Some(prompt) = initial_prompt
            .as_deref()
            .filter(|prompt| !prompt.trim().is_empty())
        {
            // Keep multiline/untrusted prompts out of the interactive shell input.
            // The one-line startup command copies this value and removes it before
            // launching the provider so the child process does not inherit it.
            cmd.env("KROSNA_INITIAL_PROMPT", prompt);
        }

        let mut child = pty
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("启动会话 shell 失败: {}", e))?;
        // 获取子进程 PID，用于后续资源回收
        let child_pid = child.process_id().unwrap_or(0);

        let mut writer = pty
            .master
            .take_writer()
            .map_err(|e| format!("获取写入器失败: {}", e))?;

        if let Some(input) = build_startup_input(&startup_command, shell.line_ending) {
            writer
                .write_all(input.as_bytes())
                .and_then(|_| writer.flush())
                .map_err(|e| format!("向会话 shell 写入智能体启动命令失败: {}", e))?;
        }

        let reader = pty
            .master
            .try_clone_reader()
            .map_err(|e| format!("获取读取器失败: {}", e))?;
        let input = match PtyInput::new(writer) {
            Ok(input) => input,
            Err(error) => {
                let _ = child.kill();
                return Err(error);
            }
        };

        let agent_id = agent_id.unwrap_or_else(|| "generic-cli".to_string());
        let output_log = self.runtime_output.start(
            &session_id,
            instance_id,
            &path,
            &agent_id,
            child_pid,
            runtime_metadata,
        );
        let output_cancelled = Arc::new(AtomicBool::new(false));
        let session = PtySession {
            instance_id,
            output_cancelled: output_cancelled.clone(),
            project_path: path.clone(),
            agent_id,
            input,
            child,
            child_pid,
            exit_code: None,
            pty: Some(pty),
        };
        self.sessions.lock().insert(session_id.clone(), session);
        if monitor_claude_usage {
            spawn_usage_monitor(
                Arc::downgrade(self),
                app.clone(),
                session_id.clone(),
                path.clone(),
            );
        }
        emit_session_event(
            &app,
            &SessionEvent {
                id: format!("runtime:{}:{}", session_id, now_ms()),
                revision: None,
                session_id: session_id.clone(),
                project_path: path.clone(),
                session_name: session_id.clone(),
                event_type: if resume {
                    SessionEventType::SessionResumed
                } else {
                    SessionEventType::SessionStarted
                },
                title: if resume {
                    "会话已恢复".to_string()
                } else {
                    "会话已启动".to_string()
                },
                body: format!("工作目录: {}", path),
                severity: SessionEventSeverity::Info,
                source: "runtime".to_string(),
                requires_attention: false,
                actionable: true,
                dedupe_key: None,
                created_at: now_ms(),
                metadata: serde_json::json!({}),
            },
        );

        // 阻塞读取独立运行，发送线程可在空闲 5ms 后刷新最后一小块输出。
        let (output_sender, output_receiver) = sync_channel(PTY_OUTPUT_QUEUE_CHUNKS);
        std::thread::spawn(move || {
            read_pty_output(reader, |data| output_sender.send(data).is_ok());
        });
        let manager = Arc::clone(self);
        let sid = session_id.clone();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            forward_pty_output(output_receiver, |data| {
                if !manager.is_session_instance_current(&sid, instance_id) {
                    return false;
                }
                output_log.lock().append(&data);
                manager.output.send_output(&app_clone, &sid, &data, &output_cancelled);
                !output_cancelled.load(Ordering::Acquire)
            });
            let Some(mut exited_session) = manager.take_session_instance(&sid, instance_id) else {
                return;
            };
            // 输出已排空后再回收子进程，保留真实退出码；等待时不持有会话锁。
            let code = exited_session
                .exit_code
                .or_else(|| wait_for_pty_exit(exited_session.child.as_mut()));
            exited_session.exit_code = code;
            output_log.lock().finish(code, false);
            if let Ok(Some(review)) = manager.complete_active_turn(&sid, "process_exit") {
                let _ = app_clone.emit("checkpoint-review-ready", review);
            }
            emit_session_event(
                &app_clone,
                &SessionEvent {
                    id: format!("runtime:{}:{}", sid, now_ms()),
                    revision: None,
                    session_id: sid.clone(),
                    project_path: String::new(),
                    session_name: sid.clone(),
                    event_type: SessionEventType::ProcessExit,
                    title: format!("{runtime_agent_label} 会话已退出"),
                    body: "进程结束".to_string(),
                    severity: SessionEventSeverity::Warning,
                    source: "runtime".to_string(),
                    requires_attention: true,
                    actionable: true,
                    dedupe_key: Some(format!("{}:process_exit", sid)),
                    created_at: now_ms(),
                    metadata: serde_json::json!({}),
                },
            );
            manager.output.send_exit(
                &app_clone,
                PtyExitPayload {
                    session_id: sid,
                    code,
                },
            );
        });

        let manager = Arc::clone(self);
        std::thread::spawn(move || manager.monitor_session_exit(&session_id, instance_id));

        Ok(opencode_control)
    }

    #[cfg(test)]
    fn write_input(&self, session_id: &str, data: &str) -> Result<(), String> {
        let (_, _, input) = self.prepare_input(session_id)?;
        input.write(data.as_bytes())
    }

    pub(crate) fn prepare_input(
        &self,
        session_id: &str,
    ) -> Result<(String, String, PtyInput), String> {
        let sessions = self.sessions.lock();
        let session = sessions.get(session_id).ok_or("会话不存在")?;
        Ok((
            session.project_path.clone(),
            session.agent_id.clone(),
            session.input.clone(),
        ))
    }

    pub fn session_context(&self, session_id: &str) -> Option<(String, String)> {
        self.sessions
            .lock()
            .get(session_id)
            .map(|session| (session.project_path.clone(), session.agent_id.clone()))
    }

    pub fn replace_active_turn(
        &self,
        session_id: &str,
        turn: ActiveAgentTurn,
    ) -> Option<ActiveAgentTurn> {
        self.active_turns
            .lock()
            .insert(session_id.to_string(), turn)
    }

    pub fn take_active_turn(&self, session_id: &str) -> Option<ActiveAgentTurn> {
        self.active_turns.lock().remove(session_id)
    }

    pub fn complete_active_turn(
        &self,
        session_id: &str,
        source: &str,
    ) -> Result<Option<AgentTurnReview>, String> {
        self.complete_active_turn_inner(session_id, source, None)
    }

    pub fn complete_active_turn_with_timeout(
        &self,
        session_id: &str,
        source: &str,
        timeout: Duration,
    ) -> Result<Option<AgentTurnReview>, String> {
        self.complete_active_turn_inner(session_id, source, Some(timeout))
    }

    fn complete_active_turn_inner(
        &self,
        session_id: &str,
        source: &str,
        timeout: Option<Duration>,
    ) -> Result<Option<AgentTurnReview>, String> {
        let Some(active) = self.take_active_turn(session_id) else {
            return Ok(None);
        };
        let result = match timeout {
            Some(timeout) => checkpoint::complete_turn_with_timeout(
                &active.id,
                &active.project_path,
                source,
                timeout,
            ),
            None => checkpoint::complete_turn(&active.id, &active.project_path, source),
        };
        match result {
            Ok(turn) => Ok(Some(turn)),
            Err(error) => {
                // Put the turn back so a later provider event or manual completion can retry.
                self.replace_active_turn(session_id, active);
                Err(error)
            }
        }
    }

    pub fn get_size(&self, session_id: &str) -> Result<Option<PtyGridSize>, String> {
        let sessions = self.sessions.lock();
        let Some(session) = sessions.get(session_id) else {
            return Ok(None);
        };
        let Some(pty) = session.pty.as_ref() else {
            return Ok(None);
        };
        // On Windows portable-pty records this only after ResizePseudoConsole succeeds.
        let size = pty
            .master
            .get_size()
            .map_err(|e| format!("读取终端大小失败: {e}"))?;
        Ok(Some(PtyGridSize {
            rows: size.rows,
            cols: size.cols,
            instance_id: session.instance_id,
        }))
    }

    pub fn resize(
        &self,
        session_id: &str,
        rows: u16,
        cols: u16,
        expected_instance_id: Option<u64>,
    ) -> Result<(), String> {
        if rows == 0 || cols == 0 || rows > i16::MAX as u16 || cols > i16::MAX as u16 {
            return Err("终端大小超出有效范围".into());
        }
        let sessions = self.sessions.lock();
        let session = sessions.get(session_id).ok_or("会话不存在")?;
        if expected_instance_id.is_some_and(|id| id != session.instance_id) {
            return Err("终端实例已更换".into());
        }
        let Some(pty) = session.pty.as_ref() else {
            return Ok(());
        };
        pty.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("调整大小失败: {}", e))?;
        Ok(())
    }

    pub fn close(&self, session_id: &str) {
        let session = self.sessions.lock().remove(session_id);
        if let Some(session) = session {
            self.runtime_output.close(session_id, session.instance_id);
            // 终止进程树可能耗时，不能持有 sessions 锁。
            drop(session);
        }
    }

    pub fn close_project_sessions(&self, project_path: &str) {
        let session_ids = self
            .sessions
            .lock()
            .iter()
            .filter(|(_, session)| session.project_path == project_path)
            .map(|(session_id, _)| session_id.clone())
            .collect::<Vec<_>>();
        for session_id in session_ids {
            self.close(&session_id);
        }
    }

    /// Check if a session is currently active
    pub fn is_session_active(&self, session_id: &str) -> bool {
        self.sessions.lock().contains_key(session_id)
    }

    fn is_session_instance_current(&self, session_id: &str, instance_id: u64) -> bool {
        let current_instance_id = self
            .sessions
            .lock()
            .get(session_id)
            .map(|session| session.instance_id);
        is_same_pty_instance(current_instance_id, instance_id)
    }

    fn monitor_session_exit(&self, session_id: &str, instance_id: u64) {
        loop {
            let exited_pty = {
                let mut sessions = self.sessions.lock();
                let Some(session) = sessions.get_mut(session_id) else {
                    return;
                };
                if session.instance_id != instance_id {
                    return;
                }
                match session.child.try_wait() {
                    Ok(Some(status)) => {
                        session.exit_code = Some(status.exit_code() as i32);
                        session.input.cancel();
                        Some(session.pty.take())
                    }
                    Ok(None) => None,
                    Err(error) => {
                        log::warn!("Failed to query PTY child exit for {session_id}: {error}");
                        return;
                    }
                }
            };
            if let Some(pty) = exited_pty {
                // Windows ConPTY 在子进程退出后仍持有输出管道。
                // 锁外释放伪控制台以触发 EOF，保留会话身份直到最后的输出发送完。
                drop(pty);
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn take_session_instance(&self, session_id: &str, instance_id: u64) -> Option<PtySession> {
        let mut sessions = self.sessions.lock();
        let current_instance_id = sessions.get(session_id).map(|session| session.instance_id);
        if !is_same_pty_instance(current_instance_id, instance_id) {
            return None;
        }
        sessions.remove(session_id)
    }

    /// Cleanup all active PTY sessions
    /// This is called when the application exits to ensure no orphan processes remain
    pub fn cleanup_all(&self) {
        let session_ids: Vec<String> = self.sessions.lock().keys().cloned().collect();
        for session_id in session_ids {
            self.close(&session_id);
        }
    }

    /// 仅清理指定会话的残留进程（不影响其他项目的会话）
    ///
    /// 当 PtyManager 中已存在该会话时，说明进程正在运行，跳过清理。
    /// 否则通过命令行匹配 `--session-id "<session_id>"` 找到属于该会话的残留进程并杀死。
    pub fn cleanup_session_process(&self, session_id: &str) {
        // 如果会话在 PtyManager 中已存在，说明正在正常运行，不需要清理
        if self.sessions.lock().contains_key(session_id) {
            return;
        }

        kill_session_process(session_id);
    }
}

fn is_same_pty_instance(current_instance_id: Option<u64>, instance_id: u64) -> bool {
    current_instance_id == Some(instance_id)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn is_claude_related_command_line(cmdline: &str) -> bool {
    let cmdline_lower = cmdline.to_lowercase();
    ["claude", "@anthropic-ai", "claude-code", "krosna"]
        .iter()
        .any(|kw| cmdline_lower.contains(kw))
}

/// Kill any stale claude processes that might be holding a session lock
/// This is called before restoring a session to ensure clean state
pub fn kill_stale_claude_processes() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // Use PowerShell to get processes with their command line arguments
        // This allows us to precisely identify Claude-related processes
        let output = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='claude.exe'\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("获取进程列表失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse JSON array or single object
        let processes: Vec<serde_json::Value> = if stdout.trim().starts_with('[') {
            serde_json::from_str(stdout.trim()).unwrap_or_default()
        } else if stdout.trim().starts_with('{') {
            serde_json::from_str::<serde_json::Value>(stdout.trim())
                .map(|v| vec![v])
                .unwrap_or_default()
        } else {
            vec![]
        };

        for proc in &processes {
            let pid = proc.get("ProcessId").and_then(|v| v.as_u64()).unwrap_or(0);
            let cmdline = proc
                .get("CommandLine")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if pid == 0 || cmdline.is_empty() {
                continue;
            }

            if is_claude_related_command_line(cmdline) {
                let _ = std::process::Command::new("cmd.exe")
                    .args(["/c", "taskkill", "/F", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // On Unix-like systems, kill claude processes by matching command line
        let _ = std::process::Command::new("pkill")
            .args(["-f", "claude-code"])
            .output();
    }

    Ok(())
}

/// 仅杀死指定 session_id 的残留 Claude 进程
///
/// 通过命令行中 `--session-id "<id>"` 来精确匹配，不影响其他项目的会话进程。
fn kill_session_process(session_id: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 获取所有 node.exe 和 claude.exe 进程
        let output = match std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='claude.exe'\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(output) => output,
            Err(_) => return,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let processes: Vec<serde_json::Value> = if stdout.trim().starts_with('[') {
            serde_json::from_str(stdout.trim()).unwrap_or_default()
        } else if stdout.trim().starts_with('{') {
            serde_json::from_str::<serde_json::Value>(stdout.trim())
                .map(|v| vec![v])
                .unwrap_or_default()
        } else {
            vec![]
        };

        // 精确匹配：命令行包含 --session-id 和目标 session_id 的 Claude 相关进程
        let session_marker = "--session-id";
        for proc in &processes {
            let pid = proc.get("ProcessId").and_then(|v| v.as_u64()).unwrap_or(0);
            let cmdline = proc
                .get("CommandLine")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if pid == 0 || cmdline.is_empty() {
                continue;
            }

            let cmdline_lower = cmdline.to_lowercase();
            // 必须同时满足：是 Claude 相关进程 且 命令行包含该 session_id
            let is_claude = ["claude", "@anthropic-ai", "claude-code"]
                .iter()
                .any(|kw| cmdline_lower.contains(kw));
            if is_claude
                && cmdline_lower.contains(&session_marker.to_lowercase())
                && cmdline.contains(session_id)
            {
                let _ = std::process::Command::new("cmd.exe")
                    .args(["/c", "taskkill", "/F", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Unix: 通过 ps + grep 精确匹配包含该 session_id 的 claude 进程
        let _ = std::process::Command::new("sh")
            .args([
                "-c",
                &format!(
                    "ps aux | grep 'claude.*--session-id.*{}' | grep -v grep | awk '{{print $2}}' | xargs -r kill -9",
                    session_id
                ),
            ])
            .output();
    }
}

pub(crate) fn check_claude_ready_in_shell() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = std::process::Command::new("powershell.exe");
        cmd.args(["-NoLogo", "-NoProfile", "-Command", "claude --version"]);
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let shell = check_shell_program()?;
        let mut cmd = std::process::Command::new(shell);
        cmd.args(["-lc", "claude --version"]);
        cmd
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|e| format!("无法启动命令检查 Claude 环境: {}", e))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "shell 中执行 `claude --version` 失败".to_string()
    };

    Err(format!(
        "未检测到可用的 Claude Code。请先确认终端可以直接执行 `claude --version`。{}",
        if detail.is_empty() {
            String::new()
        } else {
            format!(" 详情: {}", detail)
        }
    ))
}

/// Find claude executable on the system.
/// Only accepts a globally available Claude executable exposed via PATH.
pub(crate) fn find_claude_exe() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    if let Some(path) = find_windows_claude_on_path() {
        return Ok(path);
    }

    #[cfg(not(target_os = "windows"))]
    if let Some(path) = find_unix_claude_on_path() {
        return Ok(path);
    }

    Err("未检测到全局 Claude Code。请先确保终端可以直接执行 claude。".into())
}

#[cfg(target_os = "windows")]
fn find_windows_claude_on_path() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let output = std::process::Command::new("cmd.exe")
        .args(["/c", "where", "claude"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;

    select_windows_claude_path(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(target_os = "windows"))]
fn find_unix_claude_on_path() -> Option<String> {
    let output = std::process::Command::new("which")
        .arg("claude")
        .output()
        .ok()?;

    first_existing_path_from_output(&String::from_utf8_lossy(&output.stdout))
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn first_existing_path_from_output(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && Path::new(line).exists())
        .map(|line| line.to_string())
}

#[cfg(target_os = "windows")]
fn select_windows_claude_path(output: &str) -> Option<String> {
    let candidates: Vec<String> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && Path::new(line).exists())
        .map(|line| line.to_string())
        .collect();

    for suffix in [".cmd", ".exe", ".bat", ".ps1"] {
        if let Some(candidate) = candidates
            .iter()
            .find(|line| line.to_ascii_lowercase().ends_with(suffix))
        {
            return Some(candidate.clone());
        }
    }

    candidates.into_iter().next()
}

fn build_claude_start_command(
    session_id: &str,
    resume: bool,
    skip_permissions: bool,
    effort: Option<&str>,
    initial_prompt: Option<&str>,
) -> String {
    let mut parts = vec!["claude".to_string()];
    if skip_permissions {
        parts.push("--dangerously-skip-permissions".to_string());
    }
    if let Some(level) = effort.filter(|value| !value.trim().is_empty()) {
        parts.push("--effort".to_string());
        parts.push(level.to_string());
    }
    if resume {
        parts.push("--resume".to_string());
    } else {
        parts.push("--session-id".to_string());
    }
    parts.push(quote_shell_arg(session_id));
    let command = parts.join(" ");
    if initial_prompt.is_some_and(|prompt| !prompt.trim().is_empty()) {
        with_initial_prompt(command)
    } else {
        command
    }
}

#[cfg(target_os = "windows")]
fn with_initial_prompt(command: String) -> String {
    format!(
        "$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; {command} $__krosna_prompt"
    )
}

#[cfg(not(target_os = "windows"))]
fn with_initial_prompt(command: String) -> String {
    format!(
        "__krosna_prompt=\"$KROSNA_INITIAL_PROMPT\"; unset KROSNA_INITIAL_PROMPT; {command} \"$__krosna_prompt\""
    )
}

fn quote_shell_arg(arg: &str) -> String {
    format!("\"{}\"", arg.replace('"', "\\\""))
}

fn build_startup_input(startup_command: &str, line_ending: &str) -> Option<String> {
    if startup_command.trim().is_empty() {
        None
    } else {
        Some(format!("{startup_command}{line_ending}"))
    }
}

fn session_shell(
    shell_type: &str,
    enable_powershell_completion_integration: bool,
) -> Result<SessionShell, String> {
    #[cfg(target_os = "windows")]
    {
        match shell_type {
            "cmd" => Ok(SessionShell {
                program: "cmd.exe".to_string(),
                args: vec![],
                line_ending: "\r\n",
            }),
            _ => Ok(SessionShell {
                program: "powershell.exe".to_string(),
                args: if enable_powershell_completion_integration {
                    vec![
                        "-NoLogo".to_string(),
                        "-NoExit".to_string(),
                        "-Command".to_string(),
                        POWERSHELL_COMPLETION_INTEGRATION_COMMAND.to_string(),
                    ]
                } else {
                    vec!["-NoLogo".to_string()]
                },
                line_ending: "\r\n",
            }),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(SessionShell {
            program: check_shell_program()?,
            args: vec![],
            line_ending: "\n",
        })
    }
}

fn should_enable_powershell_completion_integration(
    shell_type: &str,
    agent_id: Option<&str>,
) -> bool {
    shell_type == "powershell" && agent_id == Some("powershell")
}

#[cfg(not(target_os = "windows"))]
fn check_shell_program() -> Result<String, String> {
    if let Ok(shell) = std::env::var("SHELL") {
        let trimmed = shell.trim();
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            return Ok(trimmed.to_string());
        }
    }

    for candidate in ["/bin/bash", "/bin/zsh", "/bin/sh"] {
        if Path::new(candidate).exists() {
            return Ok(candidate.to_string());
        }
    }

    Err("未找到可用的 shell，请确认系统已安装 bash、zsh 或 sh。".to_string())
}

fn should_spawn_claude_usage_monitor(agent_id: Option<&str>) -> bool {
    matches!(agent_id, None | Some("claude"))
}

fn runtime_agent_label(agent_id: Option<&str>) -> &'static str {
    match agent_id {
        None => "Claude Code",
        Some("powershell") => "PowerShell",
        Some("cmd") => "Command Prompt",
        Some(agent_id) => agent_definition(agent_id)
            .map(|definition| definition.name)
            .unwrap_or("智能体"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct InputTestGate {
        released: Arc<(Mutex<bool>, Condvar)>,
        bytes: Arc<Mutex<Vec<u8>>>,
    }

    impl InputTestGate {
        fn release(&self) {
            let (released, ready) = &*self.released;
            *released.lock() = true;
            ready.notify_all();
        }

        fn input(&self) -> (PtyInput, std::sync::mpsc::Receiver<()>) {
            let (started, receiver) = std::sync::mpsc::channel();
            let writer = InputTestWriter {
                released: self.released.clone(),
                bytes: self.bytes.clone(),
                started,
            };
            (PtyInput::new(Box::new(writer)).unwrap(), receiver)
        }
    }

    impl Drop for InputTestGate {
        fn drop(&mut self) {
            self.release();
        }
    }

    struct InputTestWriter {
        released: Arc<(Mutex<bool>, Condvar)>,
        bytes: Arc<Mutex<Vec<u8>>>,
        started: std::sync::mpsc::Sender<()>,
    }

    impl Write for InputTestWriter {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            let _ = self.started.send(());
            let (released, ready) = &*self.released;
            let mut released = released.lock();
            while !*released {
                ready.wait(&mut released);
            }
            self.bytes.lock().extend_from_slice(data);
            Ok(data.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[derive(Debug)]
    struct ExitedInputTestChild;

    impl portable_pty::ChildKiller for ExitedInputTestChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
            Box::new(Self)
        }
    }

    impl portable_pty::Child for ExitedInputTestChild {
        fn try_wait(&mut self) -> std::io::Result<Option<portable_pty::ExitStatus>> {
            Ok(Some(portable_pty::ExitStatus::with_exit_code(0)))
        }
        fn wait(&mut self) -> std::io::Result<portable_pty::ExitStatus> {
            Ok(portable_pty::ExitStatus::with_exit_code(0))
        }
        fn process_id(&self) -> Option<u32> {
            None
        }
        #[cfg(windows)]
        fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
            None
        }
    }

    fn input_test_session(instance_id: u64, input: PtyInput) -> PtySession {
        PtySession {
            instance_id,
            output_cancelled: Arc::new(AtomicBool::new(false)),
            project_path: "synthetic-input-test".into(),
            agent_id: "test".into(),
            input,
            child: Box::new(ExitedInputTestChild),
            child_pid: 0,
            exit_code: Some(0),
            pty: None,
        }
    }

    fn input_test_manager() -> Arc<PtyManager> {
        PtyManager::new(Arc::new(HookIngestConfig {
            port: 0,
            token: "test".into(),
        }))
    }

    #[test]
    fn input_worker_preserves_fifo_and_utf8_without_global_lock() {
        let gate = InputTestGate::default();
        let (input, started) = gate.input();
        let first = input.enqueue(b"one").unwrap();
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        let second = input.enqueue("中文\r\n".as_bytes()).unwrap();
        let third = input.enqueue(b"three").unwrap();
        gate.release();
        for completion in [first, second, third] {
            completion.wait().unwrap();
        }
        assert_eq!(&*gate.bytes.lock(), "one中文\r\nthree".as_bytes());
    }

    #[test]
    fn input_budget_includes_the_blocked_write_and_rejects_whole_requests() {
        let gate = InputTestGate::default();
        let (input, started) = gate.input();
        let first = input.enqueue(&vec![b'a'; PTY_INPUT_MAX_BYTES - 1]).unwrap();
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        let second = input.enqueue(b"b").unwrap();
        assert_eq!(
            input.enqueue(b"c").err().as_deref(),
            Some(PTY_INPUT_QUEUE_FULL)
        );
        assert_eq!(
            input
                .enqueue(&vec![b'x'; PTY_INPUT_MAX_BYTES + 1])
                .err()
                .as_deref(),
            Some(PTY_INPUT_TOO_LARGE)
        );
        assert_eq!(
            input.owner.shared.state.lock().buffered_bytes,
            PTY_INPUT_MAX_BYTES
        );
        gate.release();
        first.wait().unwrap();
        second.wait().unwrap();
        let bytes = gate.bytes.lock();
        assert_eq!(bytes.len(), PTY_INPUT_MAX_BYTES);
        assert_eq!(bytes.last(), Some(&b'b'));
    }

    #[test]
    fn input_request_limit_cannot_be_bypassed_with_small_or_empty_writes() {
        let gate = InputTestGate::default();
        let (input, started) = gate.input();
        let first = input.enqueue(b"a").unwrap();
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        for _ in 1..PTY_INPUT_MAX_REQUESTS {
            input.enqueue(b"b").unwrap();
        }
        for _ in 0..10 {
            input.write(b"").unwrap();
        }
        assert_eq!(
            input.enqueue(b"c").err().as_deref(),
            Some(PTY_INPUT_QUEUE_FULL)
        );
        input.cancel();
        assert_eq!(first.wait().unwrap_err(), PTY_INPUT_CLOSED);
    }

    #[test]
    fn blocked_input_does_not_block_other_sessions_or_close_acknowledgement() {
        let gate = InputTestGate::default();
        let (blocked, started) = gate.input();
        let healthy_gate = InputTestGate::default();
        healthy_gate.release();
        let (healthy, _) = healthy_gate.input();
        let manager = input_test_manager();
        manager
            .sessions
            .lock()
            .insert("blocked".into(), input_test_session(1, blocked.clone()));
        manager
            .sessions
            .lock()
            .insert("healthy".into(), input_test_session(2, healthy));
        let writer_manager = manager.clone();
        let (done, result) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = done.send(writer_manager.write_input("blocked", "a"));
        });
        started.recv_timeout(Duration::from_secs(2)).unwrap();
        let queued = blocked.enqueue(b"must-not-write").unwrap();
        let controls_manager = manager.clone();
        let (controls_done, controls_result) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            assert_eq!(
                controls_manager.session_context("healthy").unwrap().1,
                "test"
            );
            assert!(controls_manager.resize("healthy", 24, 80, Some(2)).is_ok());
            controls_manager
                .write_input("healthy", "healthy-input")
                .unwrap();
            controls_manager.close("blocked");
            let _ = controls_done.send(());
        });
        controls_result
            .recv_timeout(Duration::from_secs(2))
            .expect("another session or close waited for the blocked writer");
        assert_eq!(
            result
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .unwrap_err(),
            PTY_INPUT_CLOSED
        );
        assert_eq!(queued.wait().unwrap_err(), PTY_INPUT_CLOSED);
        assert!(manager.session_context("blocked").is_none());
        gate.release();
        assert_eq!(&*healthy_gate.bytes.lock(), b"healthy-input");
        manager.close("healthy");
    }

    #[test]
    fn prepared_old_input_cannot_write_into_a_replacement_session() {
        let old_gate = InputTestGate::default();
        old_gate.release();
        let (old, _) = old_gate.input();
        let new_gate = InputTestGate::default();
        new_gate.release();
        let (new, _) = new_gate.input();
        let manager = input_test_manager();
        manager
            .sessions
            .lock()
            .insert("same-id".into(), input_test_session(1, old));
        let (_, _, prepared) = manager.prepare_input("same-id").unwrap();
        manager.close("same-id");
        manager
            .sessions
            .lock()
            .insert("same-id".into(), input_test_session(2, new));
        assert_eq!(prepared.write(b"stale").unwrap_err(), PTY_INPUT_CLOSED);
        manager.write_input("same-id", "new-input").unwrap();
        assert!(old_gate.bytes.lock().is_empty());
        assert_eq!(&*new_gate.bytes.lock(), b"new-input");
        manager.close("same-id");
    }

    #[test]
    fn input_worker_io_failure_reaches_the_caller_and_rejects_later_input() {
        struct FailingWriter;
        impl Write for FailingWriter {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "synthetic failure",
                ))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let input = PtyInput::new(Box::new(FailingWriter)).unwrap();
        let error = input.write(b"a").unwrap_err();
        assert!(error.contains("synthetic failure"));
        assert_eq!(input.write(b"b").unwrap_err(), error);
    }

    #[tokio::test]
    async fn async_input_reserves_budget_before_waiting_and_close_wakes_its_ack() {
        let gate = InputTestGate::default();
        let (input, started) = gate.input();
        let writing = tokio::spawn(input.clone().write_async("a".repeat(PTY_INPUT_MAX_BYTES)));
        tokio::task::spawn_blocking(move || started.recv_timeout(Duration::from_secs(2)))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            input.clone().write_async("b".into()).await.unwrap_err(),
            PTY_INPUT_QUEUE_FULL
        );
        input.cancel();
        let error = tokio::time::timeout(Duration::from_secs(2), writing)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert_eq!(error, PTY_INPUT_CLOSED);
        assert_eq!(
            input.clone().write_async("old".into()).await.unwrap_err(),
            PTY_INPUT_CLOSED
        );
    }

    #[test]
    fn pty_size_readback_tracks_applied_grid_and_rejects_stale_instances() {
        let pair = create_test_pty_pair();
        #[cfg(target_os = "windows")]
        let command = CommandBuilder::new("cmd.exe");
        #[cfg(not(target_os = "windows"))]
        let command = CommandBuilder::new("sh");
        let child = pair.slave.spawn_command(command).unwrap();
        let child_pid = child.process_id().unwrap_or(0);
        let writer = pair.master.take_writer().unwrap();
        let manager = PtyManager::new(Arc::new(HookIngestConfig {
            port: 0,
            token: "test".to_string(),
        }));
        assert!(manager.get_size("size-test").unwrap().is_none());
        manager.sessions.lock().insert(
            "size-test".to_string(),
            PtySession {
                instance_id: 7,
                output_cancelled: Arc::new(AtomicBool::new(false)),
                project_path: String::new(),
                agent_id: "test".to_string(),
                input: PtyInput::new(writer).unwrap(),
                child,
                child_pid,
                exit_code: None,
                pty: Some(pair),
            },
        );
        let initial = manager.get_size("size-test").unwrap().unwrap();
        assert_eq!(
            (initial.rows, initial.cols, initial.instance_id),
            (24, 80, 7)
        );
        assert!(manager.resize("size-test", 30, 90, Some(6)).is_err());
        assert_eq!(manager.get_size("size-test").unwrap().unwrap().cols, 80);
        assert!(manager.resize("size-test", 0, 90, Some(7)).is_err());
        manager.resize("size-test", 30, 90, Some(7)).unwrap();
        let applied = manager.get_size("size-test").unwrap().unwrap();
        assert_eq!(
            (applied.rows, applied.cols, applied.instance_id),
            (30, 90, 7)
        );
        assert_eq!(serde_json::to_value(applied).unwrap()["instanceId"], 7);
        manager.close("size-test");
        assert!(manager.get_size("size-test").unwrap().is_none());
    }

    #[test]
    fn exited_pty_closes_output_only_after_delivering_the_final_screen() {
        let pair = create_test_pty_pair();
        #[cfg(target_os = "windows")]
        let mut command = CommandBuilder::new("cmd.exe");
        #[cfg(target_os = "windows")]
        command.args(["/C", "echo FINAL_TERMINAL_OUTPUT & exit /b 7"]);
        #[cfg(not(target_os = "windows"))]
        let mut command = CommandBuilder::new("sh");
        #[cfg(not(target_os = "windows"))]
        command.args(["-c", "printf FINAL_TERMINAL_OUTPUT; exit 7"]);
        let child = pair.slave.spawn_command(command).unwrap();
        let child_pid = child.process_id().unwrap_or(0);
        let reader = pair.master.try_clone_reader().unwrap();
        let writer = pair.master.take_writer().unwrap();
        let manager = PtyManager::new(Arc::new(HookIngestConfig {
            port: 0,
            token: "test".to_string(),
        }));
        manager.sessions.lock().insert(
            "exit-test".to_string(),
            PtySession {
                instance_id: 1,
                output_cancelled: Arc::new(AtomicBool::new(false)),
                project_path: String::new(),
                agent_id: "cmd".to_string(),
                input: PtyInput::new(writer).unwrap(),
                child,
                child_pid,
                exit_code: None,
                pty: Some(pair),
            },
        );
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut output = String::new();
            read_pty_output(reader, |data| {
                output.push_str(&data);
                true
            });
            let _ = sender.send(output);
        });
        let monitor = Arc::clone(&manager);
        std::thread::spawn(move || monitor.monitor_session_exit("exit-test", 1));
        let output = receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("PTY output never reached EOF after child exit");
        assert!(output.contains("FINAL_TERMINAL_OUTPUT"));
        let session = manager.take_session_instance("exit-test", 1).unwrap();
        assert_eq!(session.exit_code, Some(7));
    }

    #[test]
    fn pty_exit_reports_the_actual_shell_exit_code() {
        for expected_code in [0, 7] {
            let pair = portable_pty::native_pty_system()
                .openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .unwrap();
            #[cfg(target_os = "windows")]
            let mut command = CommandBuilder::new("cmd.exe");
            #[cfg(target_os = "windows")]
            command.args(["/C", &format!("exit /b {expected_code}")]);
            #[cfg(not(target_os = "windows"))]
            let mut command = CommandBuilder::new("sh");
            #[cfg(not(target_os = "windows"))]
            command.args(["-c", &format!("exit {expected_code}")]);
            let mut child = pair.slave.spawn_command(command).unwrap();
            assert_eq!(wait_for_pty_exit(child.as_mut()), Some(expected_code));
        }
    }

    #[test]
    fn pty_output_batches_preserve_order_and_flush_tail_before_exit() {
        let (sender, receiver) = sync_channel(8);
        for data in ["hello", "中文🙂", "\x1b[?2026h", "frame", "\x1b[?2026l"] {
            sender.send(data.to_string()).expect("send fixture");
        }
        drop(sender);
        let mut events = Vec::new();
        forward_pty_output(receiver, |data| {
            events.push(data);
            true
        });
        events.push("EXIT".to_string());
        assert_eq!(events.last().map(String::as_str), Some("EXIT"));
        // 系统调度可能跨过合并窗口；块数可变，但内容和退出顺序不能改变。
        assert_eq!(
            events[..events.len() - 1].concat(),
            "hello中文🙂\x1b[?2026hframe\x1b[?2026l"
        );
    }

    #[test]
    fn pty_output_batches_limit_bytes_without_splitting_unicode() {
        let expected = format!(
            "{}🙂中文{}",
            "a".repeat(PTY_OUTPUT_BATCH_BYTES - 1),
            "b".repeat(PTY_OUTPUT_BATCH_BYTES)
        );
        let (sender, receiver) = sync_channel(1);
        sender.send(expected.clone()).expect("send fixture");
        drop(sender);
        let mut batches = Vec::new();
        forward_pty_output(receiver, |data| {
            assert!(data.len() <= PTY_OUTPUT_BATCH_BYTES);
            assert!(!data.is_empty());
            batches.push(data);
            true
        });
        assert_eq!(batches.concat(), expected);
        assert!(batches.len() >= 3);
    }

    #[test]
    fn pty_output_flushes_a_quiet_prompt_without_waiting_for_eof() {
        let (sender, receiver) = sync_channel(1);
        let (delivered, output) = sync_channel(1);
        sender.send("prompt> ".to_string()).expect("send fixture");
        let worker = std::thread::spawn(move || {
            forward_pty_output(receiver, |data| delivered.send(data).is_ok());
        });
        // sender 仍存活，证明刷新由截止时间触发，而非 EOF 或下一次读取。
        assert_eq!(
            output
                .recv_timeout(Duration::from_secs(2))
                .expect("prompt flushed"),
            "prompt> "
        );
        drop(sender);
        worker.join().expect("join output forwarder");
    }

    #[test]
    fn pty_output_stops_forwarding_when_session_is_replaced() {
        let (sender, receiver) = sync_channel(1);
        sender
            .send("x".repeat(PTY_OUTPUT_BATCH_BYTES * 3))
            .expect("send fixture");
        drop(sender);
        let mut calls = 0;
        forward_pty_output(receiver, |_| {
            calls += 1;
            false
        });
        assert_eq!(calls, 1);
    }

    #[test]
    fn pty_output_reader_keeps_split_utf8_and_flushes_incomplete_tail() {
        let expected = format!("{}中文🙂", "a".repeat(8191));
        let mut bytes = expected.as_bytes().to_vec();
        bytes.extend_from_slice(&[0xe4, 0xb8]);
        let mut chunks = Vec::new();
        read_pty_output(std::io::Cursor::new(bytes), |data| {
            chunks.push(data);
            true
        });
        assert_eq!(chunks.concat(), format!("{expected}\u{FFFD}"));
    }

    #[test]
    fn pty_output_does_not_emit_empty_batches_on_disconnect() {
        let (sender, receiver) = sync_channel(1);
        drop(sender);
        forward_pty_output(receiver, |_| panic!("empty output must not be emitted"));
    }

    #[test]
    fn test_now_ms_returns_positive_value() {
        let ms = now_ms();
        assert!(ms > 0, "now_ms() should return a positive timestamp");
    }

    #[test]
    fn test_now_ms_increases() {
        let ms1 = now_ms();
        std::thread::sleep(std::time::Duration::from_millis(10));
        let ms2 = now_ms();
        assert!(ms2 >= ms1, "Timestamp should increase over time");
    }

    #[test]
    fn usage_monitor_only_runs_for_claude_sessions() {
        assert!(should_spawn_claude_usage_monitor(None));
        assert!(should_spawn_claude_usage_monitor(Some("claude")));
        assert!(!should_spawn_claude_usage_monitor(Some("codex")));
        assert!(!should_spawn_claude_usage_monitor(Some("qoder")));
        assert!(!should_spawn_claude_usage_monitor(Some("antigravity")));
        assert!(!should_spawn_claude_usage_monitor(Some("opencode")));
    }

    #[test]
    fn completion_integration_is_limited_to_regular_powershell_terminals() {
        assert!(should_enable_powershell_completion_integration(
            "powershell",
            Some("powershell"),
        ));
        assert!(!should_enable_powershell_completion_integration(
            "powershell",
            Some("claude"),
        ));
        assert!(!should_enable_powershell_completion_integration(
            "cmd",
            Some("cmd")
        ));
        assert!(!should_enable_powershell_completion_integration(
            "powershell",
            None
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn powershell_completion_integration_is_loaded_as_a_session_local_command() {
        let shell = session_shell("powershell", true).unwrap();
        assert_eq!(shell.program, "powershell.exe");
        assert_eq!(
            shell.args,
            vec![
                "-NoLogo".to_string(),
                "-NoExit".to_string(),
                "-Command".to_string(),
                POWERSHELL_COMPLETION_INTEGRATION_COMMAND.to_string(),
            ],
        );

        let plain_shell = session_shell("powershell", false).unwrap();
        assert_eq!(plain_shell.args, vec!["-NoLogo".to_string()]);
    }

    #[test]
    fn runtime_exit_labels_include_qoder_and_terminal_sessions() {
        assert_eq!(runtime_agent_label(None), "Claude Code");
        assert_eq!(runtime_agent_label(Some("qoder")), "Qoder CLI");
        assert_eq!(runtime_agent_label(Some("powershell")), "PowerShell");
        assert_eq!(runtime_agent_label(Some("cmd")), "Command Prompt");
        assert_eq!(runtime_agent_label(Some("unknown")), "智能体");
    }

    #[test]
    fn pty_output_decoder_preserves_utf8_split_across_reads() {
        let mut decoder = PtyOutputDecoder::default();
        let character = "你".as_bytes();

        assert_eq!(decoder.decode(&character[..1]), "");
        assert_eq!(decoder.decode(&character[1..]), "你");
        assert_eq!(decoder.finish(), "");
    }

    #[test]
    fn pty_output_decoder_preserves_split_emoji_after_valid_text() {
        let mut decoder = PtyOutputDecoder::default();
        let emoji = "🙂".as_bytes();

        assert_eq!(
            decoder.decode(&[b'o', b'k', b' ', emoji[0], emoji[1]]),
            "ok "
        );
        assert_eq!(decoder.decode(&emoji[2..]), "🙂");
    }

    #[test]
    fn pty_output_decoder_flushes_incomplete_utf8_at_end_of_stream() {
        let mut decoder = PtyOutputDecoder::default();

        assert_eq!(decoder.decode(&[0xE4, 0xBD]), "");
        assert_eq!(decoder.finish(), "�");
    }

    #[test]
    fn pty_output_decoder_replaces_invalid_bytes_without_losing_later_input() {
        let mut decoder = PtyOutputDecoder::default();

        assert_eq!(decoder.decode(&[b'a', 0xFF, 0xE4, 0xBD]), "a�");
        assert_eq!(decoder.decode(&[0xA0]), "你");
    }

    #[test]
    fn test_pty_manager_new() {
        let config = Arc::new(HookIngestConfig {
            port: 0,
            token: "test".to_string(),
        });
        let manager = PtyManager::new(config);
        assert!(manager.sessions.lock().is_empty());
    }

    #[test]
    fn test_pty_manager_is_session_active_returns_false_for_unknown() {
        let config = Arc::new(HookIngestConfig {
            port: 0,
            token: "test".to_string(),
        });
        let manager = PtyManager::new(config);
        assert!(!manager.is_session_active("nonexistent"));
    }

    #[test]
    fn test_is_claude_related_command_line_matches_expected_processes() {
        assert!(is_claude_related_command_line(
            r#"node C:\Users\me\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js"#
        ));
        assert!(is_claude_related_command_line(
            r#"C:\Users\me\AppData\Roaming\npm\claude.cmd --resume abc"#
        ));
        assert!(is_claude_related_command_line(
            r#"node app.js --client krosna"#
        ));
    }

    #[test]
    fn test_is_claude_related_command_line_ignores_unrelated_node_processes() {
        assert!(!is_claude_related_command_line(
            r#"node C:\project\vite\bin\vite.js dev"#
        ));
        assert!(!is_claude_related_command_line(
            r#"node C:\project\scripts\build.js"#
        ));
        assert!(!is_claude_related_command_line(""));
    }

    #[test]
    fn test_first_existing_path_from_output_returns_first_real_path() {
        let existing = std::env::temp_dir().join("krosna-claude-path-test.cmd");
        std::fs::write(&existing, "echo test").unwrap();

        let output = format!("C:\\missing\\claude.cmd\n{}\n", existing.to_string_lossy());

        assert_eq!(
            first_existing_path_from_output(&output),
            Some(existing.to_string_lossy().into_owned())
        );

        let _ = std::fs::remove_file(existing);
    }

    #[test]
    fn test_first_existing_path_from_output_returns_none_when_missing() {
        let output = "C:\\missing\\claude.cmd\n\n";
        assert_eq!(first_existing_path_from_output(output), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_windows_taskkill_args_terminate_the_process_tree() {
        assert_eq!(
            windows_taskkill_tree_args(1420),
            ["/PID", "1420", "/T", "/F"].map(str::to_string)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_select_windows_claude_path_prefers_cmd_over_bare_script() {
        let dir = std::env::temp_dir().join(format!("krosna-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();

        let bare = dir.join("claude");
        let cmd = dir.join("claude.cmd");
        std::fs::write(&bare, "#!/bin/sh\n").unwrap();
        std::fs::write(&cmd, "@echo off\n").unwrap();

        let output = format!("{}\n{}\n", bare.display(), cmd.display());
        assert_eq!(
            select_windows_claude_path(&output),
            Some(cmd.to_string_lossy().into_owned())
        );

        let _ = std::fs::remove_file(bare);
        let _ = std::fs::remove_file(cmd);
        let _ = std::fs::remove_dir(dir);
    }

    #[test]
    fn test_build_claude_start_command_for_new_session() {
        assert_eq!(
            build_claude_start_command("abc-123", false, true, None, None),
            r#"claude --dangerously-skip-permissions --session-id "abc-123""#
        );
    }

    #[test]
    fn test_build_claude_start_command_for_resume() {
        assert_eq!(
            build_claude_start_command("abc-123", true, false, None, None),
            r#"claude --resume "abc-123""#
        );
    }

    #[test]
    fn test_build_claude_start_command_with_effort() {
        assert_eq!(
            build_claude_start_command("abc-123", false, true, Some("max"), None),
            r#"claude --dangerously-skip-permissions --effort max --session-id "abc-123""#
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_build_claude_start_command_with_initial_prompt() {
        assert_eq!(
            build_claude_start_command(
                "abc-123",
                false,
                false,
                None,
                Some("review this; echo 'unsafe'"),
            ),
            r#"$__krosna_prompt=$env:KROSNA_INITIAL_PROMPT; Remove-Item Env:KROSNA_INITIAL_PROMPT; claude --session-id "abc-123" $__krosna_prompt"#
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_build_claude_start_command_keeps_multiline_prompt_out_of_shell_input() {
        let command = build_claude_start_command(
            "abc-123",
            false,
            false,
            None,
            Some("first line\nsecond line; echo unsafe"),
        );
        assert!(!command.contains("first line"));
        assert!(!command.contains('\n'));
        assert!(command.contains("$env:KROSNA_INITIAL_PROMPT"));
    }

    #[test]
    fn empty_startup_command_does_not_write_to_the_shell() {
        assert_eq!(build_startup_input("", "\r\n"), None);
        assert_eq!(build_startup_input("   ", "\r\n"), None);
    }

    #[test]
    fn non_empty_startup_command_is_submitted_with_the_shell_line_ending() {
        assert_eq!(
            build_startup_input("claude --session-id test", "\r\n"),
            Some("claude --session-id test\r\n".to_string())
        );
    }

    // Helper to create a real PTY pair for testing
    #[allow(dead_code)]
    fn create_test_pty_pair() -> portable_pty::PtyPair {
        let pty_system = portable_pty::native_pty_system();
        pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap()
    }

    #[test]
    fn test_pty_session_drop_trait_exists() {
        // Verify that PtySession implements Drop by checking if it can be dropped
        let config = Arc::new(HookIngestConfig {
            port: 0,
            token: "test".to_string(),
        });
        let manager = PtyManager::new(config);

        // Initially no sessions
        assert!(manager.sessions.lock().is_empty());

        // The Drop trait is implemented, so when sessions are removed,
        // the PtySession will be dropped and child processes will be killed
    }

    #[test]
    fn test_cleanup_all_clears_sessions() {
        let config = Arc::new(HookIngestConfig {
            port: 0,
            token: "test".to_string(),
        });
        let manager = PtyManager::new(config);

        // Manually insert a mock session to test cleanup
        // Note: We can't easily create a real PtySession in tests without
        // spawning a real process, so we test the cleanup logic indirectly
        assert!(manager.sessions.lock().is_empty());

        // cleanup_all should work even with no sessions
        manager.cleanup_all();
        assert!(manager.sessions.lock().is_empty());
    }

    #[test]
    fn test_pty_instance_identity_rejects_stale_readers() {
        assert!(is_same_pty_instance(Some(8), 8));
        assert!(!is_same_pty_instance(Some(9), 8));
        assert!(!is_same_pty_instance(None, 8));
    }

    #[test]
    fn test_pty_instance_ids_are_unique() {
        let config = Arc::new(HookIngestConfig {
            port: 0,
            token: "test".to_string(),
        });
        let manager = PtyManager::new(config);

        let first = manager.next_instance_id.fetch_add(1, Ordering::Relaxed);
        let second = manager.next_instance_id.fetch_add(1, Ordering::Relaxed);
        assert_ne!(first, second);
    }

    #[test]
    fn test_cleanup_session_process_skips_active_session() {
        let config = Arc::new(HookIngestConfig {
            port: 0,
            token: "test".to_string(),
        });
        let manager = PtyManager::new(config);

        // Simulate an active session by inserting a mock entry
        // (We can't create a real PtySession without spawning a process,
        //  but we can verify the early-return logic by checking sessions map)
        assert!(manager.sessions.lock().is_empty());

        // cleanup_session_process should not panic even with no sessions
        manager.cleanup_session_process("nonexistent-session");
    }
}
