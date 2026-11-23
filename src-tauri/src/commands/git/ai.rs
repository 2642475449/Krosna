use crate::commands::agent_runner::{
    executable_command, run_agent_text, AgentTextErrorCode, AgentTextRunError, AgentTextRunOptions,
};
use crate::commands::agents::find_agent_executable;
use crate::path_utils::normalize_input_path;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::status::resolve_branch_info;
use super::utils::{open_repo, run_git_text_command};

/// AI 提交信息生成超时时间
const AI_COMMIT_TIMEOUT: Duration = Duration::from_secs(90);
/// 查询 ACP 会话选项超时时间
const ACP_INSPECT_TIMEOUT: Duration = Duration::from_secs(15);
const AI_COMMIT_CLAUDE_MAX_TURNS: u8 = 8;
const ACP_PREFERRED_FLASH_MODEL: &str = "gemini-3.8-flash";
const ACP_PREFERRED_THOUGHT_LEVEL: &str = "low";

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitGeneratorSelectOption {
    pub value: String,
    pub name: String,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitGeneratorCapabilities {
    pub agent_id: String,
    pub supports_model: bool,
    pub supports_reasoning_effort: bool,
    pub current_model: Option<String>,
    pub current_reasoning_effort: Option<String>,
    pub models: Vec<CommitGeneratorSelectOption>,
    pub reasoning_efforts: Vec<CommitGeneratorSelectOption>,
}

#[cfg(test)]
#[test]
fn commit_message_generation_allows_eight_claude_turns_with_a_ninety_second_timeout() {
    assert_eq!(AI_COMMIT_CLAUDE_MAX_TURNS, 8);
    assert_eq!(AI_COMMIT_TIMEOUT, Duration::from_secs(90));
}

/// Build a provider-neutral prompt for generating a commit message.
fn build_commit_prompt(
    project_path: &str,
    repo: &git2::Repository,
    profile_instructions: &str,
) -> Result<String, String> {
    let branch_name = resolve_branch_info(repo)
        .map(|info| info.branch_name)
        .unwrap_or_else(|_| "HEAD".to_string());
    let staged_files = run_git_text_command(
        project_path,
        &["diff", "--cached", "--name-only", "--no-ext-diff"],
    )?;
    let has_staged_changes = !staged_files.trim().is_empty();
    let status_text = if has_staged_changes {
        run_git_text_command(
            project_path,
            &["diff", "--cached", "--name-status", "--no-ext-diff"],
        )?
    } else {
        run_git_text_command(project_path, &["status", "--short"])?
    };
    let staged_summary = run_git_text_command(
        project_path,
        &[
            "diff",
            "--cached",
            "--no-ext-diff",
            "--stat=160,120",
            "--summary",
        ],
    )?;
    let staged_diff = run_git_text_command(
        project_path,
        &["diff", "--cached", "--no-ext-diff", "--unified=3"],
    )?;
    let (commit_scope, summary, diff) = if has_staged_changes {
        ("仅已暂存更改", staged_summary, staged_diff)
    } else {
        let unstaged_summary = run_git_text_command(
            project_path,
            &["diff", "--no-ext-diff", "--stat=160,120", "--summary"],
        )?;
        let unstaged_diff =
            run_git_text_command(project_path, &["diff", "--no-ext-diff", "--unified=3"])?;
        ("全部未暂存及未跟踪更改", unstaged_summary, unstaged_diff)
    };

    if status_text.trim().is_empty() {
        return Err("当前没有可用于生成提交信息的 Git 变更".to_string());
    }

    let profile_instructions = profile_instructions.trim();
    if profile_instructions.is_empty() {
        return Err("提交信息风格的生成规则不能为空".to_string());
    }

    let truncate_block = |text: &str, limit: usize| -> String {
        let trimmed = text.trim();
        if trimmed.chars().count() <= limit {
            trimmed.to_string()
        } else {
            let truncated: String = trimmed.chars().take(limit).collect();
            format!("{}\n...[truncated]", truncated)
        }
    };

    Ok(format!(
        "你是一个资深 Git 提交信息助手。请根据下面仓库的改动生成一条可以直接使用的提交信息。\n\
        固定要求（优先级高于风格规则）：\n\
        1. 只输出最终提交信息，不要解释，不要代码块，不要额外前后缀\n\
        2. 不要编造变更概览中无法确认的功能、Issue 编号或测试结果\n\
        3. 优先概括源码和配置改动，弱化或忽略构建产物、二进制、bundle 等派生产物\n\
        4. 正文要点必须基于提供的文件路径和 diff，写明“哪里改了什么”。只有 diff 能直接证实时才说明用户行为、兼容性或性能影响；否则陈述可验证的实现事实\n\
        5. 按独立改动主题组织正文，不要为了凑条目拆分同一项改动，也不要机械罗列每个文件\n\
        6. 不要只写“优化”“调整”“重构”等空泛描述；不要声称测试已通过，除非输入明确提供了测试运行结果\n\
        7. 输入的 diff 可能因长度限制而截断；只描述能从输入确认的改动，不要臆测\n\
        8. 不要调用任何工具、终端命令或额外读取文件，仅根据本消息提供的变更信息直接输出最终提交信息\n\n\
        当前选择的风格规则：\n{profile_instructions}\n\n\
        当前分支：\n{branch_name}\n\n\
        本次提交范围：\n{commit_scope}\n\n\
        Git Status（仅限本次提交范围）：\n{status}\n\n\
        Change Summary：\n{summary}\n\n\
        Change Diff：\n{diff}",
        branch_name = branch_name,
        commit_scope = commit_scope,
        profile_instructions = truncate_block(profile_instructions, 6000),
        status = truncate_block(&status_text, 4000),
        summary = truncate_block(&summary, 4000),
        diff = truncate_block(&diff, 12000),
    ))
}

/// Sanitize generated commit message.
fn sanitize_generated_commit_message(input: &str) -> Option<String> {
    let normalized = input.replace("\r\n", "\n");
    let trimmed = normalized
        .trim()
        .trim_matches(|c: char| c == '"' || c == '\'' || c == '`');
    if trimmed.is_empty() {
        return None;
    }

    let mut lines = Vec::new();
    let mut previous_blank = false;

    for raw_line in trimmed.lines() {
        let line = raw_line
            .trim()
            .trim_matches(|c: char| c == '"' || c == '\'' || c == '`');
        if line.is_empty() {
            if !lines.is_empty() && !previous_blank {
                lines.push(String::new());
            }
            previous_blank = true;
            continue;
        }

        if line.starts_with("```") {
            continue;
        }

        lines.push(line.to_string());
        previous_blank = false;
    }

    while matches!(lines.last(), Some(line) if line.is_empty()) {
        lines.pop();
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn normalize_optional_pref(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

/// Generate commit message using the explicitly selected agent (synchronous).
/// Antigravity uses ACP (`agy acp`) with independent session config; other agents reuse `run_agent_text`.
fn git_generate_commit_message_sync(
    project_path: String,
    agent_id: String,
    profile_instructions: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    proxy: crate::network_proxy::ResolvedNetworkProxy,
) -> Result<String, AgentTextRunError> {
    let repo = open_repo(&project_path)?;
    let prompt = build_commit_prompt(&project_path, &repo, &profile_instructions)?;
    let normalized_path = normalize_input_path(&project_path);
    let working_dir = normalized_path.to_string_lossy();
    let requested_model = normalize_optional_pref(model);
    let requested_effort = normalize_optional_pref(reasoning_effort);

    let stdout = if agent_id == "antigravity" {
        run_agy_acp_text(
            &prompt,
            working_dir.as_ref(),
            requested_model.as_deref(),
            requested_effort.as_deref(),
            AI_COMMIT_TIMEOUT,
            &proxy,
        )?
    } else {
        run_agent_text(
            &agent_id,
            &prompt,
            working_dir.as_ref(),
            AI_COMMIT_TIMEOUT,
            AgentTextRunOptions {
                claude_max_turns: Some(AI_COMMIT_CLAUDE_MAX_TURNS),
            },
            &proxy,
        )?
    };
    sanitize_generated_commit_message(&stdout)
        .ok_or_else(|| AgentTextRunError::new(AgentTextErrorCode::EmptyOutput, None))
}

/// Extract text chunk from an ACP `session/update` notification.
fn extract_acp_message_chunk(message: &Value) -> Option<&str> {
    if message.get("method").and_then(Value::as_str) != Some("session/update") {
        return None;
    }
    let update = message.get("params")?.get("update")?;
    if update.get("sessionUpdate").and_then(Value::as_str) != Some("agent_message_chunk") {
        return None;
    }
    let content = update.get("content")?;
    if content.get("type").and_then(Value::as_str) != Some("text") {
        return None;
    }
    content.get("text").and_then(Value::as_str)
}

fn acp_session_select<'a>(response: &'a Value, category: &str) -> Option<&'a Value> {
    response
        .pointer("/result/configOptions")?
        .as_array()?
        .iter()
        .find(|option| {
            option["category"].as_str() == Some(category) && option["type"].as_str() == Some("select")
        })
}

fn extract_acp_select_options(option: &Value) -> Vec<CommitGeneratorSelectOption> {
    option["options"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|choice| {
                    let value = choice["value"].as_str()?.trim();
                    if value.is_empty() {
                        return None;
                    }
                    let name = choice["name"]
                        .as_str()
                        .map(str::trim)
                        .filter(|name| !name.is_empty())
                        .unwrap_or(value);
                    Some(CommitGeneratorSelectOption {
                        value: value.to_string(),
                        name: name.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn extract_acp_capabilities(agent_id: &str, session_resp: &Value) -> CommitGeneratorCapabilities {
    let model_opt = acp_session_select(session_resp, "model");
    let effort_opt = acp_session_select(session_resp, "thought_level");
    let models = model_opt.map(extract_acp_select_options).unwrap_or_default();
    let reasoning_efforts = effort_opt
        .map(extract_acp_select_options)
        .unwrap_or_default();

    CommitGeneratorCapabilities {
        agent_id: agent_id.to_string(),
        supports_model: !models.is_empty(),
        supports_reasoning_effort: !reasoning_efforts.is_empty(),
        current_model: model_opt
            .and_then(|opt| opt["currentValue"].as_str())
            .map(str::to_string),
        current_reasoning_effort: effort_opt
            .and_then(|opt| opt["currentValue"].as_str())
            .map(str::to_string),
        models,
        reasoning_efforts,
    }
}

fn resolve_acp_preferred_model(option: &Value, requested_model: Option<&str>) -> Option<String> {
    let choices = extract_acp_select_options(option);
    if choices.is_empty() {
        return None;
    }

    if let Some(requested) = requested_model.map(str::trim).filter(|s| !s.is_empty()) {
        return choices
            .iter()
            .find(|choice| choice.value == requested)
            .map(|choice| choice.value.clone());
    }

    // 默认优先使用 Flash 快模型；先匹配已知值，再按名称/标识模糊匹配。
    if let Some(exact) = choices
        .iter()
        .find(|choice| choice.value == ACP_PREFERRED_FLASH_MODEL)
    {
        return Some(exact.value.clone());
    }

    choices
        .iter()
        .find(|choice| {
            choice.value.to_ascii_lowercase().contains("flash")
                || choice.name.to_ascii_lowercase().contains("flash")
        })
        .map(|choice| choice.value.clone())
}

fn resolve_acp_preferred_thought_level(
    option: &Value,
    requested_effort: Option<&str>,
) -> Option<String> {
    let choices = extract_acp_select_options(option);
    if choices.is_empty() {
        return None;
    }

    let target = requested_effort
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(ACP_PREFERRED_THOUGHT_LEVEL);

    choices
        .iter()
        .find(|choice| choice.value == target)
        .map(|choice| choice.value.clone())
}

/// Apply preferred ACP session options independently; missing options or rejected switches
/// fall back to the session's current available configuration on the same agent.
fn apply_acp_session_preferences(
    mut session_resp: Value,
    session_id: &str,
    requested_model: Option<&str>,
    requested_effort: Option<&str>,
    mut set_option: impl FnMut(u64, &str, &str, &str) -> Result<Value, AgentTextRunError>,
) -> Result<Value, AgentTextRunError> {
    let steps = [
        (3_u64, "model", requested_model),
        (4_u64, "thought_level", requested_effort),
    ];

    for (rpc_id, category, requested) in steps {
        let Some(option) = acp_session_select(&session_resp, category) else {
            continue;
        };
        let desired_value = if category == "model" {
            resolve_acp_preferred_model(option, requested)
        } else {
            resolve_acp_preferred_thought_level(option, requested)
        };
        let Some(target_value) = desired_value else {
            log::debug!("ACP commit session has no matching {category} option; keeping current");
            continue;
        };
        if option["currentValue"].as_str() == Some(target_value.as_str()) {
            continue;
        }
        let Some(config_id) = option["id"].as_str().map(str::to_string) else {
            continue;
        };

        let updated = set_option(rpc_id, session_id, &config_id, &target_value)?;
        if updated.get("error").is_some()
            || acp_session_select(&updated, category)
                .and_then(|opt| opt["currentValue"].as_str())
                != Some(target_value.as_str())
        {
            log::debug!(
                "ACP commit session rejected {category}={target_value}; keeping previous option"
            );
            continue;
        }
        session_resp = updated;
    }

    Ok(session_resp)
}

/// Build an ACP `session/request_permission` denial payload that rejects the tool call
/// without cancelling the entire prompt turn when a reject option is advertised.
fn build_acp_permission_rejection_outcome(message: &Value) -> Value {
    let reject_option_id = message
        .pointer("/params/options")
        .and_then(Value::as_array)
        .and_then(|options| {
            options
                .iter()
                .find(|opt| opt["kind"].as_str() == Some("reject_once"))
                .or_else(|| {
                    options
                        .iter()
                        .find(|opt| opt["kind"].as_str() == Some("reject_always"))
                })
                .and_then(|opt| opt["optionId"].as_str())
        });

    if let Some(option_id) = reject_option_id {
        json!({ "outcome": "selected", "optionId": option_id })
    } else {
        json!({ "outcome": "cancelled" })
    }
}

fn require_acp_response(response: Value) -> Result<Value, AgentTextRunError> {
    if let Some(error) = response.get("error") {
        let detail = error["message"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| error.to_string());
        return Err(AgentTextRunError::new(
            AgentTextErrorCode::ProcessFailed,
            Some(detail),
        ));
    }
    Ok(response)
}

struct AcpStdioClient {
    child: std::process::Child,
    stdin: Option<std::process::ChildStdin>,
    rx: mpsc::Receiver<Result<String, String>>,
    started_at: Instant,
    timeout: Duration,
}

impl AcpStdioClient {
    fn spawn(
        working_directory: &str,
        timeout: Duration,
        proxy: &crate::network_proxy::ResolvedNetworkProxy,
    ) -> Result<Self, AgentTextRunError> {
        let started_at = Instant::now();
        let executable_path = find_agent_executable("antigravity").map_err(|error| {
            AgentTextRunError::new(AgentTextErrorCode::Unavailable, Some(error))
        })?;
        let mut command = executable_command(&executable_path);
        command
            .arg("acp")
            .current_dir(working_directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        crate::network_proxy::apply_proxy_to_command(&mut command, proxy);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn().map_err(|error| {
            AgentTextRunError::new(
                AgentTextErrorCode::Unavailable,
                Some(format!("无法启动 Antigravity ACP: {error}")),
            )
        })?;

        let stdin = child.stdin.take().ok_or_else(|| {
            let _ = child.kill();
            let _ = child.wait();
            AgentTextRunError::new(
                AgentTextErrorCode::ProcessFailed,
                Some("无法获取 ACP 进程标准输入".to_string()),
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            let _ = child.kill();
            let _ = child.wait();
            AgentTextRunError::new(
                AgentTextErrorCode::ProcessFailed,
                Some("无法获取 ACP 进程标准输出".to_string()),
            )
        })?;

        let (tx, rx) = mpsc::channel::<Result<String, String>>();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let item = line.map_err(|error| error.to_string());
                if tx.send(item).is_err() {
                    break;
                }
            }
        });

        Ok(Self {
            child,
            stdin: Some(stdin),
            rx,
            started_at,
            timeout,
        })
    }

    fn send_rpc(&mut self, payload: &Value) -> Result<(), AgentTextRunError> {
        let Some(stdin) = self.stdin.as_mut() else {
            return Err(AgentTextRunError::new(
                AgentTextErrorCode::ProcessFailed,
                Some("ACP 标准输入已关闭".to_string()),
            ));
        };
        let encoded = serde_json::to_string(payload).map_err(|error| {
            AgentTextRunError::new(AgentTextErrorCode::ProcessFailed, Some(error.to_string()))
        })?;
        writeln!(stdin, "{encoded}")
            .and_then(|_| stdin.flush())
            .map_err(|error| {
                AgentTextRunError::new(
                    AgentTextErrorCode::ProcessFailed,
                    Some(format!("写入 ACP 请求失败: {error}")),
                )
            })
    }

    fn wait_for_response(
        &mut self,
        expected_id: u64,
        mut collected: Option<&mut String>,
    ) -> Result<Value, AgentTextRunError> {
        loop {
            let remaining = self.timeout.saturating_sub(self.started_at.elapsed());
            if remaining.is_zero() {
                return Err(AgentTextRunError::new(AgentTextErrorCode::Timeout, None));
            }
            let raw_line = match self.rx.recv_timeout(remaining) {
                Ok(Ok(line)) => line,
                Ok(Err(error)) => {
                    return Err(AgentTextRunError::new(
                        AgentTextErrorCode::ProcessFailed,
                        Some(format!("读取 ACP 输出失败: {error}")),
                    ));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    return Err(AgentTextRunError::new(AgentTextErrorCode::Timeout, None));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(AgentTextRunError::new(
                        AgentTextErrorCode::ProcessFailed,
                        Some("ACP 进程提前退出".to_string()),
                    ));
                }
            };

            let trimmed = raw_line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };

            // 后台只读场景：拒绝工具权限请求，但优先使用 reject 选项避免中止整个生成回合。
            if message.get("method").and_then(Value::as_str) == Some("session/request_permission") {
                if let Some(req_id) = message.get("id") {
                    let outcome = build_acp_permission_rejection_outcome(&message);
                    let _ = self.send_rpc(&json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": { "outcome": outcome }
                    }));
                }
                continue;
            }

            if let Some(buffer) = collected.as_deref_mut() {
                if let Some(chunk) = extract_acp_message_chunk(&message) {
                    buffer.push_str(chunk);
                }
            }

            if message.get("id").and_then(Value::as_u64) == Some(expected_id) {
                return Ok(message);
            }
        }
    }

    fn initialize(&mut self) -> Result<(), AgentTextRunError> {
        self.send_rpc(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
                "clientCapabilities": {}
            }
        }))?;
        require_acp_response(self.wait_for_response(1, None)?)?;
        Ok(())
    }

    fn new_session(&mut self, working_directory: &str) -> Result<(String, Value), AgentTextRunError> {
        self.send_rpc(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "session/new",
            "params": {
                "cwd": working_directory,
                "mcpServers": []
            }
        }))?;
        let session_resp = require_acp_response(self.wait_for_response(2, None)?)?;
        let session_id = session_resp
            .get("result")
            .and_then(|value| value.get("sessionId"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AgentTextRunError::new(
                    AgentTextErrorCode::ProcessFailed,
                    Some("ACP session/new 未返回 sessionId".to_string()),
                )
            })?
            .to_string();
        Ok((session_id, session_resp))
    }
}

impl Drop for AcpStdioClient {
    fn drop(&mut self) {
        drop(self.stdin.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Run a single-turn read-only prompt via local `agy acp` stdio JSON-RPC server.
fn run_agy_acp_text(
    prompt: &str,
    working_directory: &str,
    requested_model: Option<&str>,
    requested_effort: Option<&str>,
    timeout: Duration,
    proxy: &crate::network_proxy::ResolvedNetworkProxy,
) -> Result<String, AgentTextRunError> {
    let total_start = Instant::now();
    let mut client = AcpStdioClient::spawn(working_directory, timeout, proxy)?;
    let spawn_ms = total_start.elapsed().as_millis();

    let init_start = Instant::now();
    client.initialize()?;
    let initialize_ms = init_start.elapsed().as_millis();

    let session_start = Instant::now();
    let (session_id, session_resp) = client.new_session(working_directory)?;
    let session_new_ms = session_start.elapsed().as_millis();

    let config_start = Instant::now();
    let configured_resp = apply_acp_session_preferences(
        session_resp,
        &session_id,
        requested_model,
        requested_effort,
        |rpc_id, sid, config_id, value| {
            client.send_rpc(&json!({
                "jsonrpc": "2.0",
                "id": rpc_id,
                "method": "session/set_config_option",
                "params": { "sessionId": sid, "configId": config_id, "value": value }
            }))?;
            client.wait_for_response(rpc_id, None)
        },
    )?;
    let configure_ms = config_start.elapsed().as_millis();
    let active_model = acp_session_select(&configured_resp, "model")
        .and_then(|opt| opt["currentValue"].as_str())
        .unwrap_or("unknown");
    let active_effort = acp_session_select(&configured_resp, "thought_level")
        .and_then(|opt| opt["currentValue"].as_str())
        .unwrap_or("unknown");

    let prompt_start = Instant::now();
    client.send_rpc(&json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "session/prompt",
        "params": {
            "sessionId": session_id,
            "prompt": [
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        }
    }))?;

    let mut output = String::new();
    require_acp_response(client.wait_for_response(5, Some(&mut output))?)?;
    let prompt_ms = prompt_start.elapsed().as_millis();
    let total_ms = total_start.elapsed().as_millis();
    log::info!(
        "Git commit message via ACP finished: model={active_model} effort={active_effort} spawn_ms={spawn_ms} init_ms={initialize_ms} session_new_ms={session_new_ms} configure_ms={configure_ms} prompt_ms={prompt_ms} total_ms={total_ms}"
    );
    Ok(output)
}

fn inspect_commit_generator_options_sync(
    agent_id: String,
    project_path: Option<String>,
    proxy: crate::network_proxy::ResolvedNetworkProxy,
) -> Result<CommitGeneratorCapabilities, AgentTextRunError> {
    if agent_id != "antigravity" {
        return Ok(CommitGeneratorCapabilities {
            agent_id,
            ..CommitGeneratorCapabilities::default()
        });
    }

    let working_dir = project_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(normalize_input_path)
        .filter(|path| path.is_dir())
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(std::env::temp_dir);
    let working_dir_str = working_dir.to_string_lossy();

    let mut client = AcpStdioClient::spawn(working_dir_str.as_ref(), ACP_INSPECT_TIMEOUT, &proxy)?;
    client.initialize()?;
    let (_session_id, session_resp) = client.new_session(working_dir_str.as_ref())?;
    Ok(extract_acp_capabilities(&agent_id, &session_resp))
}

/// Inspect model and reasoning options supported by a commit-message generator agent.
#[tauri::command]
pub async fn git_inspect_commit_generator_options(
    agent_id: String,
    project_path: Option<String>,
    database: tauri::State<'_, std::sync::Arc<crate::database::Database>>,
) -> Result<CommitGeneratorCapabilities, AgentTextRunError> {
    let proxy = super::super::network_proxy::load_resolved_proxy(&database)?;
    tauri::async_runtime::spawn_blocking(move || {
        inspect_commit_generator_options_sync(agent_id, project_path, proxy)
    })
    .await
    .map_err(|e| AgentTextRunError::new(AgentTextErrorCode::ProcessFailed, Some(e.to_string())))?
}

/// Generate commit message using the explicitly selected agent (async).
#[tauri::command]
pub async fn git_generate_commit_message(
    project_path: String,
    agent_id: String,
    profile_instructions: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    database: tauri::State<'_, std::sync::Arc<crate::database::Database>>,
) -> Result<String, AgentTextRunError> {
    let proxy = super::super::network_proxy::load_resolved_proxy(&database)?;
    tauri::async_runtime::spawn_blocking(move || {
        git_generate_commit_message_sync(
            project_path,
            agent_id,
            profile_instructions,
            model,
            reasoning_effort,
            proxy,
        )
    })
    .await
    .map_err(|e| AgentTextRunError::new(AgentTextErrorCode::ProcessFailed, Some(e.to_string())))?
}

#[cfg(test)]
mod tests {
    use super::{
        acp_session_select, apply_acp_session_preferences,
        build_acp_permission_rejection_outcome, build_commit_prompt, extract_acp_capabilities,
        resolve_acp_preferred_model, resolve_acp_preferred_thought_level,
    };
    use serde_json::{json, Value};
    use std::fs;
    use std::path::Path;

    fn sample_acp_session_response(
        current_model: &str,
        current_effort: &str,
        include_flash: bool,
    ) -> Value {
        let mut models = vec![
            json!({ "value": "gemini-4-neon", "name": "Gemini 4 Neon" }),
            json!({ "value": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5" }),
        ];
        if include_flash {
            models.push(json!({ "value": "gemini-3.8-flash", "name": "Gemini 3.8 Flash" }));
        }
        json!({
            "result": {
                "sessionId": "sess-1",
                "configOptions": [
                    {
                        "id": "model",
                        "name": "Model",
                        "category": "model",
                        "type": "select",
                        "currentValue": current_model,
                        "options": models
                    },
                    {
                        "id": "thought_level",
                        "name": "Thinking Level",
                        "category": "thought_level",
                        "type": "select",
                        "currentValue": current_effort,
                        "options": [
                            { "value": "low", "name": "Low" },
                            { "value": "medium", "name": "Medium" },
                            { "value": "high", "name": "High" }
                        ]
                    }
                ]
            }
        })
    }

    #[test]
    fn acp_session_select_uses_advertised_category_and_select_type() {
        let response = json!({
            "result": {
                "configOptions": [
                    { "category": "model", "type": "boolean", "id": "unsupported" },
                    { "category": "model", "type": "select", "id": "model-selector" }
                ]
            }
        });

        assert_eq!(
            acp_session_select(&response, "model").and_then(|option| option["id"].as_str()),
            Some("model-selector")
        );
        assert!(acp_session_select(&response, "thought_level").is_none());
        assert!(acp_session_select(&json!({ "result": {} }), "model").is_none());
    }

    #[test]
    fn acp_capabilities_extract_models_and_reasoning_efforts() {
        let response = sample_acp_session_response("gemini-4-neon", "high", true);
        let caps = extract_acp_capabilities("antigravity", &response);
        assert_eq!(caps.agent_id, "antigravity");
        assert!(caps.supports_model);
        assert!(caps.supports_reasoning_effort);
        assert_eq!(caps.current_model.as_deref(), Some("gemini-4-neon"));
        assert_eq!(caps.current_reasoning_effort.as_deref(), Some("high"));
        assert_eq!(caps.models.len(), 3);
        assert_eq!(caps.reasoning_efforts.len(), 3);
    }

    #[test]
    fn acp_auto_preferences_pick_flash_model_and_low_thought_level() {
        let initial = sample_acp_session_response("gemini-4-neon", "high", true);
        let mut calls = Vec::new();

        let final_resp = apply_acp_session_preferences(
            initial,
            "sess-1",
            None,
            None,
            |_rpc_id, _sid, config_id, value| {
                calls.push((config_id.to_string(), value.to_string()));
                let next_model = if config_id == "model" {
                    value
                } else {
                    "gemini-3.8-flash"
                };
                let next_effort = if config_id == "thought_level" {
                    value
                } else {
                    "high"
                };
                Ok(sample_acp_session_response(next_model, next_effort, true))
            },
        )
        .expect("preferences should succeed");

        assert_eq!(
            calls,
            vec![
                ("model".to_string(), "gemini-3.8-flash".to_string()),
                ("thought_level".to_string(), "low".to_string()),
            ]
        );
        assert_eq!(
            acp_session_select(&final_resp, "model").and_then(|o| o["currentValue"].as_str()),
            Some("gemini-3.8-flash")
        );
        assert_eq!(
            acp_session_select(&final_resp, "thought_level")
                .and_then(|o| o["currentValue"].as_str()),
            Some("low")
        );
    }

    #[test]
    fn acp_falls_back_to_current_model_when_flash_is_missing_and_still_sets_thought_level() {
        let initial = sample_acp_session_response("gemini-4-neon", "high", false);
        let mut calls = Vec::new();

        let final_resp = apply_acp_session_preferences(
            initial,
            "sess-1",
            None,
            None,
            |_rpc_id, _sid, config_id, value| {
                calls.push((config_id.to_string(), value.to_string()));
                Ok(sample_acp_session_response("gemini-4-neon", value, false))
            },
        )
        .expect("missing fast model should fall back cleanly");

        assert_eq!(calls, vec![("thought_level".to_string(), "low".to_string())]);
        assert_eq!(
            acp_session_select(&final_resp, "model").and_then(|o| o["currentValue"].as_str()),
            Some("gemini-4-neon")
        );
        assert_eq!(
            acp_session_select(&final_resp, "thought_level")
                .and_then(|o| o["currentValue"].as_str()),
            Some("low")
        );
    }

    #[test]
    fn acp_keeps_previous_model_on_rejection_and_still_applies_thought_level() {
        let initial = sample_acp_session_response("gemini-4-neon", "high", true);
        let mut calls = Vec::new();

        let final_resp = apply_acp_session_preferences(
            initial,
            "sess-1",
            Some("gemini-3.8-flash"),
            Some("medium"),
            |_rpc_id, _sid, config_id, value| {
                calls.push((config_id.to_string(), value.to_string()));
                if config_id == "model" {
                    // 模拟服务端拒绝模型切换
                    return Ok(json!({ "error": { "code": -32000, "message": "model unavailable" } }));
                }
                Ok(sample_acp_session_response("gemini-4-neon", value, true))
            },
        )
        .expect("rejected model switch should fall back to same agent");

        assert_eq!(
            calls,
            vec![
                ("model".to_string(), "gemini-3.8-flash".to_string()),
                ("thought_level".to_string(), "medium".to_string()),
            ]
        );
        assert_eq!(
            acp_session_select(&final_resp, "model").and_then(|o| o["currentValue"].as_str()),
            Some("gemini-4-neon")
        );
        assert_eq!(
            acp_session_select(&final_resp, "thought_level")
                .and_then(|o| o["currentValue"].as_str()),
            Some("medium")
        );
    }

    #[test]
    fn acp_resolves_future_flash_model_when_default_id_changes() {
        let option = json!({
            "id": "model",
            "category": "model",
            "type": "select",
            "currentValue": "gemini-4-neon",
            "options": [
                { "value": "gemini-4-neon", "name": "Gemini 4 Neon" },
                { "value": "gemini-4-flash", "name": "Gemini 4 Flash" }
            ]
        });
        assert_eq!(
            resolve_acp_preferred_model(&option, None).as_deref(),
            Some("gemini-4-flash")
        );
        assert_eq!(
            resolve_acp_preferred_model(&option, Some("nonexistent")),
            None
        );

        let effort_option = json!({
            "id": "thought_level",
            "category": "thought_level",
            "type": "select",
            "currentValue": "high",
            "options": [
                { "value": "medium", "name": "Medium" },
                { "value": "high", "name": "High" }
            ]
        });
        assert_eq!(resolve_acp_preferred_thought_level(&effort_option, None), None);
        assert_eq!(
            resolve_acp_preferred_thought_level(&effort_option, Some("medium")).as_deref(),
            Some("medium")
        );
    }

    #[test]
    fn acp_permission_rejection_prefers_reject_option_over_cancelling_turn() {
        let with_reject_once = json!({
            "params": {
                "options": [
                    { "optionId": "allow-1", "kind": "allow_once" },
                    { "optionId": "deny-1", "kind": "reject_once" }
                ]
            }
        });
        assert_eq!(
            build_acp_permission_rejection_outcome(&with_reject_once),
            json!({ "outcome": "selected", "optionId": "deny-1" })
        );

        let without_reject = json!({
            "params": {
                "options": [{ "optionId": "allow-1", "kind": "allow_once" }]
            }
        });
        assert_eq!(
            build_acp_permission_rejection_outcome(&without_reject),
            json!({ "outcome": "cancelled" })
        );
    }

    fn create_repository() -> (tempfile::TempDir, git2::Repository) {
        let temp_dir = tempfile::tempdir().expect("create temp directory");
        let repo = git2::Repository::init(temp_dir.path()).expect("initialize repository");
        fs::write(temp_dir.path().join("staged.txt"), "base staged\n").expect("write staged file");
        fs::write(temp_dir.path().join("unstaged.txt"), "base unstaged\n")
            .expect("write unstaged file");

        let mut index = repo.index().expect("open index");
        index
            .add_path(Path::new("staged.txt"))
            .expect("add staged file");
        index
            .add_path(Path::new("unstaged.txt"))
            .expect("add unstaged file");
        let tree_id = index.write_tree().expect("write tree");
        index.write().expect("write index");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let signature =
            git2::Signature::now("Krosna", "krosna@example.com").expect("create signature");
        repo.commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .expect("create initial commit");
        drop(tree);

        (temp_dir, repo)
    }

    #[test]
    fn commit_prompt_uses_only_staged_changes_when_index_is_not_empty() {
        let (temp_dir, repo) = create_repository();
        fs::write(
            temp_dir.path().join("staged.txt"),
            "included staged content\n",
        )
        .expect("modify staged file");
        let mut index = repo.index().expect("open index");
        index
            .add_path(Path::new("staged.txt"))
            .expect("stage modification");
        index.write().expect("write index");
        fs::write(
            temp_dir.path().join("unstaged.txt"),
            "excluded unstaged content\n",
        )
        .expect("modify unstaged file");

        let prompt = build_commit_prompt(
            temp_dir.path().to_string_lossy().as_ref(),
            &repo,
            "生成测试提交信息",
        )
        .expect("build prompt");

        assert!(prompt.contains("本次提交范围：\n仅已暂存更改"));
        assert!(prompt.contains("included staged content"));
        assert!(!prompt.contains("unstaged.txt"));
        assert!(!prompt.contains("excluded unstaged content"));
    }

    #[test]
    fn commit_prompt_uses_worktree_changes_when_index_is_empty() {
        let (temp_dir, repo) = create_repository();
        fs::write(
            temp_dir.path().join("unstaged.txt"),
            "included unstaged content\n",
        )
        .expect("modify unstaged file");

        let prompt = build_commit_prompt(
            temp_dir.path().to_string_lossy().as_ref(),
            &repo,
            "生成测试提交信息",
        )
        .expect("build prompt");

        assert!(
            prompt.contains("本次提交范围：\n全部未暂存及未跟踪更改"),
            "unexpected prompt: {prompt}"
        );
        assert!(prompt.contains("unstaged.txt"));
        assert!(prompt.contains("included unstaged content"));
    }
}
