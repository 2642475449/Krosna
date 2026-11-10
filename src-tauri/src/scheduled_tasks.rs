use chrono::{
    DateTime, Datelike, Duration as ChronoDuration, LocalResult, NaiveDate, NaiveTime, TimeZone,
    Utc,
};
use chrono_tz::Tz;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::{
    commands::{agent_runner::executable_command, agents::find_agent_executable},
    database::Database,
    events::SCHEDULED_TASKS_CHANGED_EVENT,
    network_proxy::{apply_proxy_to_command, resolve_network_proxy},
};

const SCHEDULER_TICK: Duration = Duration::from_secs(5);
const RECOVERY_GAP: Duration = Duration::from_secs(30);
const RECOVERY_GRACE_MS: i64 = 60 * 60 * 1000;
const MAX_CONCURRENT_RUNS: usize = 2;
const MAX_QUEUE_WAIT_MS: i64 = 15 * 60 * 1000;
const MAX_CAPTURE_BYTES: usize = 1024 * 1024;
const LOG_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const MAX_LOG_STORAGE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_TASK_NAME_LENGTH: usize = 160;
const MAX_TASK_CONTENT_LENGTH: usize = 64 * 1024;
const MIN_TIMEOUT_MS: i64 = 60_000;
const MAX_TIMEOUT_MS: i64 = 4 * 60 * 60 * 1000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduledTaskExecutionKind {
    Agent,
    Command,
}

impl ScheduledTaskExecutionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Command => "command",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "agent" => Ok(Self::Agent),
            "command" => Ok(Self::Command),
            _ => Err(format!("未知的定时任务执行方式: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ScheduledTaskSchedule {
    Once {
        run_at_ms: i64,
    },
    Interval {
        interval_minutes: u32,
        anchor_at_ms: i64,
    },
    Daily {
        time: String,
    },
    Weekly {
        weekday: u8,
        time: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduledTaskMissedRunPolicy {
    Skip,
    RunOnceWithinGrace,
}

impl ScheduledTaskMissedRunPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Skip => "skip",
            Self::RunOnceWithinGrace => "runOnceWithinGrace",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "skip" => Ok(Self::Skip),
            "runOnceWithinGrace" => Ok(Self::RunOnceWithinGrace),
            _ => Err(format!("未知的错过执行策略: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduledTaskNotificationPolicy {
    Failures,
    All,
    None,
}

impl ScheduledTaskNotificationPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Failures => "failures",
            Self::All => "all",
            Self::None => "none",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "failures" => Ok(Self::Failures),
            "all" => Ok(Self::All),
            "none" => Ok(Self::None),
            _ => Err(format!("未知的定时任务通知策略: {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduledTaskRunStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    TimedOut,
    Cancelled,
    Skipped,
    Interrupted,
}

impl ScheduledTaskRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::TimedOut => "timedOut",
            Self::Cancelled => "cancelled",
            Self::Skipped => "skipped",
            Self::Interrupted => "interrupted",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "succeeded" => Ok(Self::Succeeded),
            "failed" => Ok(Self::Failed),
            "timedOut" => Ok(Self::TimedOut),
            "cancelled" => Ok(Self::Cancelled),
            "skipped" => Ok(Self::Skipped),
            "interrupted" => Ok(Self::Interrupted),
            _ => Err(format!("未知的定时任务运行状态: {value}")),
        }
    }

    pub fn is_failure(self) -> bool {
        matches!(self, Self::Failed | Self::TimedOut | Self::Interrupted)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScheduledTaskTrigger {
    Schedule,
    Manual,
}

impl ScheduledTaskTrigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Schedule => "schedule",
            Self::Manual => "manual",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "schedule" => Ok(Self::Schedule),
            "manual" => Ok(Self::Manual),
            _ => Err(format!("未知的定时任务触发方式: {value}")),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskInput {
    pub project_path: String,
    pub name: String,
    pub execution_kind: ScheduledTaskExecutionKind,
    pub agent_id: Option<String>,
    pub prompt: Option<String>,
    pub command: Option<String>,
    pub shell: Option<String>,
    pub schedule: ScheduledTaskSchedule,
    pub timezone: String,
    pub enabled: bool,
    pub timeout_ms: i64,
    pub missed_run_policy: ScheduledTaskMissedRunPolicy,
    pub notification_policy: ScheduledTaskNotificationPolicy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskRecord {
    pub id: String,
    pub project_path: String,
    pub project_name: String,
    pub name: String,
    pub execution_kind: ScheduledTaskExecutionKind,
    pub agent_id: Option<String>,
    pub prompt: Option<String>,
    pub command: Option<String>,
    pub shell: Option<String>,
    pub schedule: ScheduledTaskSchedule,
    pub timezone: String,
    pub enabled: bool,
    pub next_run_at_ms: Option<i64>,
    pub timeout_ms: i64,
    pub missed_run_policy: ScheduledTaskMissedRunPolicy,
    pub notification_policy: ScheduledTaskNotificationPolicy,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub deleted_at_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskRunRecord {
    pub id: String,
    pub task_id: String,
    pub task_name: String,
    pub project_path: String,
    pub trigger: ScheduledTaskTrigger,
    pub scheduled_at_ms: Option<i64>,
    pub status: ScheduledTaskRunStatus,
    pub config_snapshot: serde_json::Value,
    pub started_at_ms: Option<i64>,
    pub completed_at_ms: Option<i64>,
    pub exit_code: Option<i32>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub log_available: bool,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct ScheduledTaskRunCompletion {
    pub status: ScheduledTaskRunStatus,
    pub completed_at_ms: i64,
    pub exit_code: Option<i32>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub log_path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewScheduledTaskRun {
    pub id: String,
    pub task_id: String,
    pub trigger: ScheduledTaskTrigger,
    pub scheduled_at_ms: Option<i64>,
    pub config_snapshot: serde_json::Value,
    pub created_at_ms: i64,
}

pub fn create_task_record(
    input: ScheduledTaskInput,
    now_ms: i64,
) -> Result<ScheduledTaskRecord, String> {
    let input = normalize_and_validate_input(input, now_ms)?;
    let next_run_at_ms = if input.enabled {
        next_run_after(&input.schedule, &input.timezone, now_ms.saturating_sub(1))?
    } else {
        None
    };

    Ok(ScheduledTaskRecord {
        id: unique_id("scheduled-task", now_ms),
        project_name: project_name_from_path(&input.project_path),
        project_path: input.project_path,
        name: input.name,
        execution_kind: input.execution_kind,
        agent_id: input.agent_id,
        prompt: input.prompt,
        command: input.command,
        shell: input.shell,
        schedule: input.schedule,
        timezone: input.timezone,
        enabled: input.enabled && next_run_at_ms.is_some(),
        next_run_at_ms,
        timeout_ms: input.timeout_ms,
        missed_run_policy: input.missed_run_policy,
        notification_policy: input.notification_policy,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
        deleted_at_ms: None,
    })
}

pub fn update_task_record(
    existing: &ScheduledTaskRecord,
    input: ScheduledTaskInput,
    now_ms: i64,
) -> Result<ScheduledTaskRecord, String> {
    let input = normalize_and_validate_input(input, now_ms)?;
    let next_run_at_ms = if input.enabled {
        next_run_after(&input.schedule, &input.timezone, now_ms.saturating_sub(1))?
    } else {
        None
    };

    Ok(ScheduledTaskRecord {
        id: existing.id.clone(),
        project_name: project_name_from_path(&input.project_path),
        project_path: input.project_path,
        name: input.name,
        execution_kind: input.execution_kind,
        agent_id: input.agent_id,
        prompt: input.prompt,
        command: input.command,
        shell: input.shell,
        schedule: input.schedule,
        timezone: input.timezone,
        enabled: input.enabled && next_run_at_ms.is_some(),
        next_run_at_ms,
        timeout_ms: input.timeout_ms,
        missed_run_policy: input.missed_run_policy,
        notification_policy: input.notification_policy,
        created_at_ms: existing.created_at_ms,
        updated_at_ms: now_ms,
        deleted_at_ms: existing.deleted_at_ms,
    })
}

fn normalize_and_validate_input(
    mut input: ScheduledTaskInput,
    now_ms: i64,
) -> Result<ScheduledTaskInput, String> {
    input.project_path = input.project_path.trim().to_string();
    input.name = input.name.trim().to_string();
    input.timezone = input.timezone.trim().to_string();
    input.agent_id = input
        .agent_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    input.prompt = input
        .prompt
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    input.command = input
        .command
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    input.shell = input
        .shell
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if input.project_path.is_empty() || !Path::new(&input.project_path).is_dir() {
        return Err("定时任务必须绑定一个存在的项目目录".to_string());
    }
    if input.name.is_empty() {
        return Err("请输入任务名称".to_string());
    }
    if input.name.chars().count() > MAX_TASK_NAME_LENGTH {
        return Err(format!("任务名称不能超过 {MAX_TASK_NAME_LENGTH} 个字符"));
    }
    if input.timezone.parse::<Tz>().is_err() {
        return Err("时区必须是有效的 IANA 时区名称，例如 Asia/Shanghai".to_string());
    }
    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&input.timeout_ms) {
        return Err("超时时间必须介于 1 分钟和 4 小时之间".to_string());
    }

    validate_schedule(&input.schedule, now_ms)?;
    match input.execution_kind {
        ScheduledTaskExecutionKind::Agent => {
            let agent_id = input
                .agent_id
                .as_deref()
                .ok_or_else(|| "请选择执行智能体".to_string())?;
            if agent_id != "codex" {
                return Err("当前只支持 Codex 的只读定时智能体任务".to_string());
            }
            if find_agent_executable(agent_id).is_err() {
                return Err("未找到 Codex CLI，请在设置中检查安装状态".to_string());
            }
            let prompt = input
                .prompt
                .as_deref()
                .ok_or_else(|| "请输入智能体任务内容".to_string())?;
            if prompt.chars().count() > MAX_TASK_CONTENT_LENGTH {
                return Err("智能体任务内容过长".to_string());
            }
            input.command = None;
            input.shell = None;
        }
        ScheduledTaskExecutionKind::Command => {
            let command = input
                .command
                .as_deref()
                .ok_or_else(|| "请输入终端命令".to_string())?;
            if command.chars().count() > MAX_TASK_CONTENT_LENGTH {
                return Err("终端命令内容过长".to_string());
            }
            let shell = input.shell.as_deref().unwrap_or("powershell");
            if !matches!(shell, "powershell" | "cmd") {
                return Err("终端命令只支持 PowerShell 或 CMD".to_string());
            }
            input.shell = Some(shell.to_string());
            input.agent_id = None;
            input.prompt = None;
        }
    }

    Ok(input)
}

fn validate_schedule(schedule: &ScheduledTaskSchedule, now_ms: i64) -> Result<(), String> {
    match schedule {
        ScheduledTaskSchedule::Once { run_at_ms } => {
            if *run_at_ms <= now_ms {
                return Err("一次性任务的执行时间必须晚于当前时间".to_string());
            }
        }
        ScheduledTaskSchedule::Interval {
            interval_minutes,
            anchor_at_ms,
        } => {
            if *interval_minutes == 0 || *interval_minutes > 7 * 24 * 60 {
                return Err("执行间隔必须介于 1 分钟和 7 天之间".to_string());
            }
            if *anchor_at_ms <= 0 {
                return Err("执行间隔缺少有效的起始时间".to_string());
            }
        }
        ScheduledTaskSchedule::Daily { time } => {
            parse_clock_time(time)?;
        }
        ScheduledTaskSchedule::Weekly { weekday, time } => {
            if !(1..=7).contains(weekday) {
                return Err("每周任务的日期必须在周一到周日之间".to_string());
            }
            parse_clock_time(time)?;
        }
    }
    Ok(())
}

pub fn next_run_after(
    schedule: &ScheduledTaskSchedule,
    timezone: &str,
    after_ms: i64,
) -> Result<Option<i64>, String> {
    let timezone = timezone
        .parse::<Tz>()
        .map_err(|_| "时区必须是有效的 IANA 时区名称".to_string())?;
    match schedule {
        ScheduledTaskSchedule::Once { run_at_ms } => {
            Ok((*run_at_ms > after_ms).then_some(*run_at_ms))
        }
        ScheduledTaskSchedule::Interval {
            interval_minutes,
            anchor_at_ms,
        } => {
            let interval_ms = i64::from(*interval_minutes)
                .checked_mul(60_000)
                .ok_or_else(|| "执行间隔超出支持范围".to_string())?;
            if *anchor_at_ms > after_ms {
                return Ok(Some(*anchor_at_ms));
            }
            let elapsed = after_ms.saturating_sub(*anchor_at_ms);
            let steps = elapsed / interval_ms + 1;
            Ok(anchor_at_ms.checked_add(steps.saturating_mul(interval_ms)))
        }
        ScheduledTaskSchedule::Daily { time } => next_daily_run(time, timezone, after_ms),
        ScheduledTaskSchedule::Weekly { weekday, time } => {
            next_weekly_run(*weekday, time, timezone, after_ms)
        }
    }
}

fn next_daily_run(time: &str, timezone: Tz, after_ms: i64) -> Result<Option<i64>, String> {
    let time = parse_clock_time(time)?;
    let after = utc_datetime(after_ms)?;
    let local_after = after.with_timezone(&timezone);
    for offset in 0..=370 {
        let Some(date) = local_after
            .date_naive()
            .checked_add_signed(ChronoDuration::days(offset))
        else {
            break;
        };
        if let Some(candidate) = local_datetime(timezone, date, time) {
            let candidate_ms = candidate.with_timezone(&Utc).timestamp_millis();
            if candidate_ms > after_ms {
                return Ok(Some(candidate_ms));
            }
        }
    }
    Ok(None)
}

fn next_weekly_run(
    weekday: u8,
    time: &str,
    timezone: Tz,
    after_ms: i64,
) -> Result<Option<i64>, String> {
    let time = parse_clock_time(time)?;
    let after = utc_datetime(after_ms)?;
    let local_after = after.with_timezone(&timezone);
    let current_weekday = local_after.weekday().num_days_from_monday() + 1;
    let initial_offset = (i32::from(weekday) - current_weekday as i32).rem_euclid(7) as i64;
    for weekly_offset in 0..=53 {
        let offset = initial_offset + weekly_offset * 7;
        let Some(date) = local_after
            .date_naive()
            .checked_add_signed(ChronoDuration::days(offset))
        else {
            break;
        };
        if let Some(candidate) = local_datetime(timezone, date, time) {
            let candidate_ms = candidate.with_timezone(&Utc).timestamp_millis();
            if candidate_ms > after_ms {
                return Ok(Some(candidate_ms));
            }
        }
    }
    Ok(None)
}

fn parse_clock_time(value: &str) -> Result<NaiveTime, String> {
    NaiveTime::parse_from_str(value, "%H:%M").map_err(|_| "时间必须使用 HH:MM 格式".to_string())
}

fn utc_datetime(timestamp_ms: i64) -> Result<DateTime<Utc>, String> {
    Utc.timestamp_millis_opt(timestamp_ms)
        .single()
        .ok_or_else(|| "时间戳超出支持范围".to_string())
}

fn local_datetime(timezone: Tz, date: NaiveDate, time: NaiveTime) -> Option<DateTime<Tz>> {
    match timezone.from_local_datetime(&date.and_time(time)) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(first, _) => Some(first),
        // 夏令时跳过的本地时刻没有对应的实际时间，按设计跳过该次。
        LocalResult::None => None,
    }
}

pub fn unique_id(prefix: &str, now_ms: i64) -> String {
    format!("{prefix}-{now_ms}-{:016x}", rand::random::<u64>())
}

fn project_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(path)
        .to_string()
}

#[derive(Default)]
struct SchedulerState {
    running: HashMap<String, RunningTask>,
    task_runs: HashMap<String, String>,
    queued: VecDeque<QueuedTask>,
}

struct RunningTask {
    cancel_requested: Arc<AtomicBool>,
    project_path: String,
}

struct QueuedTask {
    task: ScheduledTaskRecord,
    run: ScheduledTaskRunRecord,
}

struct QueueSelection {
    start: Vec<(ScheduledTaskRecord, ScheduledTaskRunRecord, Arc<AtomicBool>)>,
    expired: Vec<ScheduledTaskRunRecord>,
}

struct TaskExecution {
    status: ScheduledTaskRunStatus,
    exit_code: Option<i32>,
    output: String,
    error: Option<String>,
}

pub struct ScheduledTaskScheduler {
    app: AppHandle,
    database: Arc<Database>,
    log_dir: PathBuf,
    state: Mutex<SchedulerState>,
}

impl ScheduledTaskScheduler {
    pub fn start(app: AppHandle, database: Arc<Database>) -> Result<Arc<Self>, String> {
        database.mark_interrupted_scheduled_task_runs(Utc::now().timestamp_millis())?;
        let log_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("无法获取定时任务日志目录: {error}"))?
            .join("scheduled-task-logs");
        fs::create_dir_all(&log_dir)
            .map_err(|error| format!("无法创建定时任务日志目录: {error}"))?;

        let scheduler = Arc::new(Self {
            app,
            database,
            log_dir,
            state: Mutex::new(SchedulerState::default()),
        });
        if let Err(error) = scheduler.prune_run_logs() {
            eprintln!("Failed to prune scheduled task logs during startup: {error}");
        }
        let worker = scheduler.clone();
        thread::Builder::new()
            .name("krosna-scheduled-task-dispatcher".to_string())
            .spawn(move || worker.dispatch_loop())
            .map_err(|error| format!("无法启动定时任务调度服务: {error}"))?;
        Ok(scheduler)
    }

    pub fn create_task(&self, input: ScheduledTaskInput) -> Result<ScheduledTaskRecord, String> {
        let task = create_task_record(input, Utc::now().timestamp_millis())?;
        self.database.create_scheduled_task(&task)?;
        self.emit_changed();
        Ok(task)
    }

    pub fn update_task(
        &self,
        task_id: &str,
        input: ScheduledTaskInput,
    ) -> Result<ScheduledTaskRecord, String> {
        let existing = self.database.get_scheduled_task(task_id)?;
        let task = update_task_record(&existing, input, Utc::now().timestamp_millis())?;
        self.database.update_scheduled_task(&task)?;
        self.emit_changed();
        Ok(task)
    }

    pub fn set_task_enabled(
        &self,
        task_id: &str,
        enabled: bool,
    ) -> Result<ScheduledTaskRecord, String> {
        let mut task = self.database.get_scheduled_task(task_id)?;
        task.enabled = enabled;
        task.next_run_at_ms = if enabled {
            next_run_after(
                &task.schedule,
                &task.timezone,
                Utc::now().timestamp_millis().saturating_sub(1),
            )?
        } else {
            None
        };
        if task.next_run_at_ms.is_none() {
            task.enabled = false;
        }
        task.updated_at_ms = Utc::now().timestamp_millis();
        self.database.update_scheduled_task(&task)?;
        self.emit_changed();
        Ok(task)
    }

    pub fn delete_task(&self, task_id: &str) -> Result<(), String> {
        self.database
            .delete_scheduled_task(task_id, Utc::now().timestamp_millis())?;
        self.emit_changed();
        Ok(())
    }

    pub fn run_now(self: &Arc<Self>, task_id: &str) -> Result<ScheduledTaskRunRecord, String> {
        let task = self.database.get_scheduled_task(task_id)?;
        if self.is_task_active(task_id) {
            return Err("该任务已有运行中的实例".to_string());
        }
        let now_ms = Utc::now().timestamp_millis();
        let run = self
            .database
            .create_manual_scheduled_task_run(&task, now_ms)?;
        match self.enqueue(task, run.clone()) {
            Ok(()) => {
                self.emit_changed();
                Ok(run)
            }
            Err(error) => {
                self.database.complete_scheduled_task_run(
                    &run.id,
                    ScheduledTaskRunCompletion {
                        status: ScheduledTaskRunStatus::Skipped,
                        completed_at_ms: now_ms,
                        exit_code: None,
                        summary: Some("未执行".to_string()),
                        error: Some(error.clone()),
                        log_path: None,
                    },
                )?;
                self.emit_changed();
                Err(error)
            }
        }
    }

    pub fn cancel_run(&self, run_id: &str) -> Result<(), String> {
        let queued = {
            let mut state = self.state.lock();
            if let Some(position) = state.queued.iter().position(|entry| entry.run.id == run_id) {
                if let Some(entry) = state.queued.remove(position) {
                    state.task_runs.remove(&entry.task.id);
                    true
                } else {
                    return Err("未找到可取消的定时任务运行记录".to_string());
                }
            } else if let Some(running) = state.running.get(run_id) {
                running.cancel_requested.store(true, Ordering::SeqCst);
                false
            } else {
                return Err("未找到可取消的定时任务运行记录".to_string());
            }
        };

        if queued {
            self.database.complete_scheduled_task_run(
                run_id,
                ScheduledTaskRunCompletion {
                    status: ScheduledTaskRunStatus::Cancelled,
                    completed_at_ms: Utc::now().timestamp_millis(),
                    exit_code: None,
                    summary: Some("已在执行前取消".to_string()),
                    error: None,
                    log_path: None,
                },
            )?;
        }
        self.emit_changed();
        Ok(())
    }

    pub fn read_run_log(&self, run_id: &str) -> Result<String, String> {
        let Some(path) = self.database.get_scheduled_task_run_log_path(run_id)? else {
            return Ok(String::new());
        };
        let path = PathBuf::from(path);
        let canonical_log_dir = fs::canonicalize(&self.log_dir)
            .map_err(|error| format!("无法解析定时任务日志目录: {error}"))?;
        let canonical_path =
            fs::canonicalize(&path).map_err(|error| format!("读取定时任务日志失败: {error}"))?;
        if !canonical_path.starts_with(&canonical_log_dir) {
            return Err("定时任务日志路径无效".to_string());
        }
        fs::read_to_string(&canonical_path)
            .map_err(|error| format!("读取定时任务日志失败: {error}"))
    }

    fn dispatch_loop(self: Arc<Self>) {
        let mut previous_tick = Instant::now();
        let mut recovering = true;
        loop {
            let now = Instant::now();
            if now.duration_since(previous_tick) > RECOVERY_GAP {
                recovering = true;
            }
            previous_tick = now;
            if let Err(error) = self.dispatch_due_tasks(Utc::now().timestamp_millis(), recovering) {
                eprintln!("Scheduled task dispatch failed: {error}");
            }
            recovering = false;
            thread::sleep(SCHEDULER_TICK);
        }
    }

    fn dispatch_due_tasks(self: &Arc<Self>, now_ms: i64, recovering: bool) -> Result<(), String> {
        let tasks = self.database.list_due_scheduled_tasks(now_ms, 16)?;
        for task in tasks {
            let Some(scheduled_at_ms) = task.next_run_at_ms else {
                continue;
            };
            let overdue_ms = now_ms.saturating_sub(scheduled_at_ms);
            let should_skip = recovering
                && (task.missed_run_policy == ScheduledTaskMissedRunPolicy::Skip
                    || overdue_ms > RECOVERY_GRACE_MS);
            let next_anchor = if should_skip || recovering {
                now_ms
            } else {
                scheduled_at_ms
            };
            let next_run_at_ms = next_run_after(&task.schedule, &task.timezone, next_anchor)?;
            let Some(run) = self.database.claim_scheduled_task_run(
                &task,
                scheduled_at_ms,
                next_run_at_ms,
                now_ms,
            )?
            else {
                continue;
            };

            if should_skip {
                self.database.complete_scheduled_task_run(
                    &run.id,
                    ScheduledTaskRunCompletion {
                        status: ScheduledTaskRunStatus::Skipped,
                        completed_at_ms: now_ms,
                        exit_code: None,
                        summary: Some("错过的计划已跳过".to_string()),
                        error: None,
                        log_path: None,
                    },
                )?;
                continue;
            }

            if let Err(error) = self.enqueue(task, run.clone()) {
                self.database.complete_scheduled_task_run(
                    &run.id,
                    ScheduledTaskRunCompletion {
                        status: ScheduledTaskRunStatus::Skipped,
                        completed_at_ms: now_ms,
                        exit_code: None,
                        summary: Some("任务未执行".to_string()),
                        error: Some(error),
                        log_path: None,
                    },
                )?;
            }
        }
        self.emit_changed();
        Ok(())
    }

    fn enqueue(
        self: &Arc<Self>,
        task: ScheduledTaskRecord,
        run: ScheduledTaskRunRecord,
    ) -> Result<(), String> {
        let selection = {
            let mut state = self.state.lock();
            if state.task_runs.contains_key(&task.id) {
                return Err("该任务已有运行中的实例".to_string());
            }
            state.task_runs.insert(task.id.clone(), run.id.clone());
            state.queued.push_back(QueuedTask { task, run });
            take_startable_tasks(&mut state, Utc::now().timestamp_millis())
        };
        self.apply_queue_selection(selection);
        Ok(())
    }

    fn spawn_tasks(
        self: &Arc<Self>,
        tasks: Vec<(ScheduledTaskRecord, ScheduledTaskRunRecord, Arc<AtomicBool>)>,
    ) {
        for (task, run, cancel_requested) in tasks {
            let run_id = run.id.clone();
            let task_id = task.id.clone();
            let scheduler = self.clone();
            if let Err(error) = thread::Builder::new()
                .name(format!("krosna-scheduled-task-{run_id}"))
                .spawn(move || scheduler.execute_queued_task(task, run, cancel_requested))
            {
                let now_ms = Utc::now().timestamp_millis();
                if let Err(database_error) = self.database.complete_scheduled_task_run(
                    &run_id,
                    ScheduledTaskRunCompletion {
                        status: ScheduledTaskRunStatus::Failed,
                        completed_at_ms: now_ms,
                        exit_code: None,
                        summary: Some("无法启动任务".to_string()),
                        error: Some(format!("无法启动定时任务线程: {error}")),
                        log_path: None,
                    },
                ) {
                    eprintln!("Failed to record scheduled task start error: {database_error}");
                }
                self.finish_runtime_run(&run_id, &task_id);
                self.emit_changed();
            }
        }
    }

    fn execute_queued_task(
        self: Arc<Self>,
        task: ScheduledTaskRecord,
        run: ScheduledTaskRunRecord,
        cancel_requested: Arc<AtomicBool>,
    ) {
        let started_at_ms = Utc::now().timestamp_millis();
        if let Err(error) = self
            .database
            .mark_scheduled_task_run_running(&run.id, started_at_ms)
        {
            eprintln!("Failed to mark scheduled task run as started: {error}");
            self.finish_runtime_run(&run.id, &task.id);
            return;
        }
        self.emit_changed();

        let execution = self.execute_task(&task, &cancel_requested);
        let completed_at_ms = Utc::now().timestamp_millis();
        let log_path = self.write_run_log(&run, &execution).ok();
        let summary = summarize_execution(&execution);
        if let Err(error) = self.database.complete_scheduled_task_run(
            &run.id,
            ScheduledTaskRunCompletion {
                status: execution.status,
                completed_at_ms,
                exit_code: execution.exit_code,
                summary,
                error: execution.error.clone(),
                log_path,
            },
        ) {
            eprintln!("Failed to complete scheduled task run: {error}");
        } else if let Err(error) = self.prune_run_logs() {
            eprintln!("Failed to prune scheduled task logs: {error}");
        }
        self.notify_if_needed(&task, &execution);
        self.finish_runtime_run(&run.id, &task.id);
        self.emit_changed();
    }

    fn execute_task(
        &self,
        task: &ScheduledTaskRecord,
        cancel_requested: &AtomicBool,
    ) -> TaskExecution {
        let command = match self.build_task_command(task) {
            Ok(command) => command,
            Err(error) => {
                return TaskExecution {
                    status: ScheduledTaskRunStatus::Failed,
                    exit_code: None,
                    output: String::new(),
                    error: Some(error),
                };
            }
        };
        let mut execution = run_command(command.0, command.1, task.timeout_ms, cancel_requested);
        if task.execution_kind == ScheduledTaskExecutionKind::Agent {
            mark_agent_sandbox_failure(&mut execution);
        }
        execution
    }

    fn build_task_command(
        &self,
        task: &ScheduledTaskRecord,
    ) -> Result<(Command, Option<String>), String> {
        let mut command = match task.execution_kind {
            ScheduledTaskExecutionKind::Agent => {
                let agent_id = task
                    .agent_id
                    .as_deref()
                    .ok_or_else(|| "缺少智能体配置".to_string())?;
                if agent_id != "codex" {
                    return Err("当前只支持 Codex 的只读定时智能体任务".to_string());
                }
                let executable = find_agent_executable(agent_id)?;
                build_scheduled_agent_command(&executable)
            }
            ScheduledTaskExecutionKind::Command => build_shell_command(
                task.shell.as_deref().unwrap_or("powershell"),
                task.command
                    .as_deref()
                    .ok_or_else(|| "缺少终端命令".to_string())?,
            )?,
        };
        command.current_dir(&task.project_path);
        let settings = self.database.load_persistent_settings()?;
        let proxy = resolve_network_proxy(&settings.network_proxy_settings())?;
        apply_proxy_to_command(&mut command, &proxy);
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        let input = match task.execution_kind {
            ScheduledTaskExecutionKind::Agent => {
                command.stdin(Stdio::piped());
                task.prompt.clone()
            }
            ScheduledTaskExecutionKind::Command => {
                command.stdin(Stdio::null());
                None
            }
        };
        Ok((command, input))
    }

    fn write_run_log(
        &self,
        run: &ScheduledTaskRunRecord,
        execution: &TaskExecution,
    ) -> Result<String, String> {
        let path = self.log_dir.join(format!("{}.log", run.id));
        let mut log = String::new();
        log.push_str(&format!("status: {}\n", execution.status.as_str()));
        if let Some(exit_code) = execution.exit_code {
            log.push_str(&format!("exitCode: {exit_code}\n"));
        }
        if let Some(error) = &execution.error {
            log.push_str(&format!("error: {error}\n"));
        }
        if !execution.output.is_empty() {
            log.push_str("\n--- output ---\n");
            log.push_str(&execution.output);
        }
        fs::write(&path, log).map_err(|error| format!("写入定时任务日志失败: {error}"))?;
        Ok(path.to_string_lossy().to_string())
    }

    fn prune_run_logs(&self) -> Result<(), String> {
        let now_ms = Utc::now().timestamp_millis();
        let expiration = now_ms.saturating_sub(LOG_RETENTION_MS);
        let canonical_log_dir = fs::canonicalize(&self.log_dir)
            .map_err(|error| format!("无法解析定时任务日志目录: {error}"))?;
        let mut retained = Vec::new();

        for record in self.database.list_scheduled_task_run_logs()? {
            let path = PathBuf::from(&record.log_path);
            let canonical_path = match fs::canonicalize(&path) {
                Ok(path) => path,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    self.database
                        .clear_scheduled_task_run_log_path(&record.run_id)?;
                    continue;
                }
                Err(error) => return Err(format!("读取定时任务日志元数据失败: {error}")),
            };
            if !canonical_path.starts_with(&canonical_log_dir) {
                self.database
                    .clear_scheduled_task_run_log_path(&record.run_id)?;
                continue;
            }
            let size = match fs::metadata(&canonical_path) {
                Ok(metadata) => metadata.len(),
                Err(error) => return Err(format!("读取定时任务日志元数据失败: {error}")),
            };
            if record.completed_at_ms <= expiration {
                fs::remove_file(&canonical_path)
                    .map_err(|error| format!("清理过期定时任务日志失败: {error}"))?;
                self.database
                    .clear_scheduled_task_run_log_path(&record.run_id)?;
                continue;
            }
            retained.push((record, canonical_path, size));
        }

        let mut total_size = retained.iter().map(|(_, _, size)| *size).sum::<u64>();
        for (record, path, size) in retained {
            if total_size <= MAX_LOG_STORAGE_BYTES {
                break;
            }
            fs::remove_file(&path)
                .map_err(|error| format!("清理超出上限的定时任务日志失败: {error}"))?;
            self.database
                .clear_scheduled_task_run_log_path(&record.run_id)?;
            total_size = total_size.saturating_sub(size);
        }
        Ok(())
    }

    fn notify_if_needed(&self, task: &ScheduledTaskRecord, execution: &TaskExecution) {
        let should_notify = match task.notification_policy {
            ScheduledTaskNotificationPolicy::None => false,
            ScheduledTaskNotificationPolicy::All => true,
            ScheduledTaskNotificationPolicy::Failures => execution.status.is_failure(),
        };
        if !should_notify {
            return;
        }
        let Ok(settings) = self.database.load_persistent_settings() else {
            return;
        };
        if !settings.notification_enabled {
            return;
        }
        let body = execution
            .error
            .as_deref()
            .unwrap_or_else(|| match execution.status {
                ScheduledTaskRunStatus::Succeeded => "定时任务已完成",
                ScheduledTaskRunStatus::Cancelled => "定时任务已取消",
                _ => "定时任务未能完成",
            });
        if let Err(error) = self
            .app
            .notification()
            .builder()
            .title(&format!("Krosna · {}", task.name))
            .body(body)
            .show()
        {
            eprintln!("Scheduled task notification failed: {error}");
        }
    }

    fn finish_runtime_run(self: &Arc<Self>, run_id: &str, task_id: &str) {
        let selection = {
            let mut state = self.state.lock();
            state.running.remove(run_id);
            state.task_runs.remove(task_id);
            take_startable_tasks(&mut state, Utc::now().timestamp_millis())
        };
        self.apply_queue_selection(selection);
    }

    fn apply_queue_selection(self: &Arc<Self>, selection: QueueSelection) {
        for run in selection.expired {
            let now_ms = Utc::now().timestamp_millis();
            if let Err(error) = self.database.complete_scheduled_task_run(
                &run.id,
                ScheduledTaskRunCompletion {
                    status: ScheduledTaskRunStatus::Skipped,
                    completed_at_ms: now_ms,
                    exit_code: None,
                    summary: Some("队列等待超时，已跳过".to_string()),
                    error: Some(format!(
                        "定时任务在队列中等待超过 {} 分钟",
                        MAX_QUEUE_WAIT_MS / 60_000
                    )),
                    log_path: None,
                },
            ) {
                eprintln!("Failed to mark expired scheduled task queue entry: {error}");
            }
        }
        self.spawn_tasks(selection.start);
    }

    fn is_task_active(&self, task_id: &str) -> bool {
        self.state.lock().task_runs.contains_key(task_id)
    }

    fn emit_changed(&self) {
        if let Err(error) = self.app.emit(SCHEDULED_TASKS_CHANGED_EVENT, ()) {
            eprintln!("Failed to emit scheduled task update: {error}");
        }
    }
}

fn take_startable_tasks(state: &mut SchedulerState, now_ms: i64) -> QueueSelection {
    let mut selection = QueueSelection {
        start: Vec::new(),
        expired: Vec::new(),
    };
    let mut waiting = VecDeque::with_capacity(state.queued.len());

    while let Some(entry) = state.queued.pop_front() {
        if now_ms.saturating_sub(entry.run.created_at_ms) > MAX_QUEUE_WAIT_MS {
            state.task_runs.remove(&entry.task.id);
            selection.expired.push(entry.run);
            continue;
        }

        let project_is_running = state
            .running
            .values()
            .any(|running| running.project_path == entry.task.project_path);
        if state.running.len() >= MAX_CONCURRENT_RUNS || project_is_running {
            waiting.push_back(entry);
            continue;
        }

        let cancel_requested = Arc::new(AtomicBool::new(false));
        state.running.insert(
            entry.run.id.clone(),
            RunningTask {
                cancel_requested: cancel_requested.clone(),
                project_path: entry.task.project_path.clone(),
            },
        );
        selection
            .start
            .push((entry.task, entry.run, cancel_requested));
    }

    state.queued = waiting;
    selection
}

fn build_scheduled_agent_command(executable: &str) -> Command {
    let mut command = executable_command(executable);
    command.args([
        "exec",
        "--disable",
        "apps",
        "--disable",
        "plugins",
        "--disable",
        "hooks",
        "--sandbox",
        "read-only",
        "-c",
        "approval_policy=\"never\"",
        "--ephemeral",
        "--color",
        "never",
    ]);
    // 无人值守任务使用受限令牌沙箱，避免 elevated helper 的 deny-read ACL
    // 初始化失败导致只读命令也无法启动；只影响本次进程，仍禁止项目写入。
    #[cfg(target_os = "windows")]
    command.args(["-c", "windows.sandbox=\"unelevated\""]);
    // git status 默认可能刷新索引；只读巡检不需要这些可选写入。
    command.env("GIT_OPTIONAL_LOCKS", "0");
    command.arg("-");
    command
}

fn mark_agent_sandbox_failure(execution: &mut TaskExecution) {
    if execution.status != ScheduledTaskRunStatus::Succeeded {
        return;
    }
    let Some((stdout, stderr)) = execution.output.split_once("\n--- stderr ---\n") else {
        return;
    };
    // Codex 会将详细执行轨迹写入 stderr，其中可能包含它读取到的源码文本。
    // 因此不能仅凭 stderr 中的关键字判定失败；只有未得到任何最终回答时，
    // 才将明确的沙箱初始化错误作为本次任务失败处理。
    if !stdout.trim().is_empty() {
        return;
    }
    if stderr.lines().any(|line| {
        (line.contains("ERROR codex_core::tools::router")
            && line.contains("Failed to create unified exec process")
            && line.contains("apply deny-read ACLs"))
            || line.starts_with("windows sandbox failed:")
    }) {
        execution.status = ScheduledTaskRunStatus::Failed;
        execution.error = Some(
            "Codex Windows 沙箱初始化失败，任务未能执行。请检查 Codex 沙箱配置与目录权限后重试。"
                .to_string(),
        );
    }
}

fn build_shell_command(shell: &str, command_text: &str) -> Result<Command, String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = match shell {
            "powershell" => {
                let mut command = Command::new("powershell.exe");
                command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
                command
            }
            "cmd" => {
                let mut command = Command::new("cmd.exe");
                command.args(["/D", "/S", "/C"]);
                command
            }
            _ => return Err("终端命令只支持 PowerShell 或 CMD".to_string()),
        };
        command.arg(command_text);
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
        Ok(command)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = shell;
        let mut command = Command::new("sh");
        command.args(["-lc", command_text]);
        Ok(command)
    }
}

fn run_command(
    mut command: Command,
    stdin_input: Option<String>,
    timeout_ms: i64,
    cancel_requested: &AtomicBool,
) -> TaskExecution {
    // 所有定时任务（包括通过 .cmd 启动的智能体）统一在后台创建进程。
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let started = Instant::now();
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return TaskExecution {
                status: ScheduledTaskRunStatus::Failed,
                exit_code: None,
                output: String::new(),
                error: Some(format!("启动定时任务失败: {error}")),
            };
        }
    };

    let process_tree = match TaskProcessTree::new(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            return TaskExecution {
                status: ScheduledTaskRunStatus::Failed,
                exit_code: None,
                output: String::new(),
                error: Some(format!("无法建立定时任务进程保护: {error}")),
            };
        }
    };
    let mut stdin_handle = stdin_input.and_then(|input| {
        child.stdin.take().map(|mut stdin| {
            thread::spawn(move || {
                std::io::Write::write_all(&mut stdin, input.as_bytes())
                    .map_err(|error| format!("写入定时任务输入失败: {error}"))
            })
        })
    });
    let stdout = child.stdout.take().map(read_pipe_limited);
    let stderr = child.stderr.take().map(read_pipe_limited);
    let timeout = Duration::from_millis(timeout_ms.max(0) as u64);
    let mut cancelled = false;
    let mut timed_out = false;
    let mut exit_status = None;
    let mut process_error = None;
    // 父进程退出后管道仍可能由后代持有；整个输入/输出生命周期都受截止时间约束。
    loop {
        if cancel_requested.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            break;
        }
        if stdin_handle
            .as_ref()
            .is_some_and(thread::JoinHandle::is_finished)
        {
            if let Some(handle) = stdin_handle.take() {
                if let Err(error) = handle
                    .join()
                    .unwrap_or_else(|_| Err("定时任务输入线程失败".to_string()))
                {
                    process_error = Some(error);
                    break;
                }
            }
        }
        if exit_status.is_none() {
            match child.try_wait() {
                Ok(status) => exit_status = status,
                Err(error) => {
                    process_error = Some(format!("等待定时任务进程失败: {error}"));
                    break;
                }
            }
        }
        if exit_status.is_some()
            && stdin_handle.is_none()
            && stdout.as_ref().is_none_or(OutputCapture::is_finished)
            && stderr.as_ref().is_none_or(OutputCapture::is_finished)
        {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    process_tree.terminate();
    if exit_status.is_none() {
        let _ = child.kill();
    }
    // 通常杀死进程组后所有管道马上关闭；即使有句柄逃逸也不能无限阻塞调度器。
    let cleanup_started = Instant::now();
    while cleanup_started.elapsed() < Duration::from_millis(500) {
        if exit_status.is_none() {
            exit_status = child.try_wait().ok().flatten();
        }
        if exit_status.is_some()
            && stdin_handle
                .as_ref()
                .is_none_or(thread::JoinHandle::is_finished)
            && stdout.as_ref().is_none_or(OutputCapture::is_finished)
            && stderr.as_ref().is_none_or(OutputCapture::is_finished)
        {
            break;
        }
        thread::sleep(Duration::from_millis(10));
    }
    if let Some(handle) = stdin_handle.filter(thread::JoinHandle::is_finished) {
        let _ = handle.join();
    }
    let output = combine_output(
        stdout.map(OutputCapture::finish).unwrap_or_default(),
        stderr.map(OutputCapture::finish).unwrap_or_default(),
    );
    if cancelled {
        return TaskExecution {
            status: ScheduledTaskRunStatus::Cancelled,
            exit_code: exit_status.and_then(|status| status.code()),
            output,
            error: None,
        };
    }
    if timed_out {
        return TaskExecution {
            status: ScheduledTaskRunStatus::TimedOut,
            exit_code: exit_status.and_then(|status| status.code()),
            output,
            error: Some(format!("定时任务在 {} 分钟后超时", timeout_ms / 60_000)),
        };
    }
    if let Some(error) = process_error {
        return TaskExecution {
            status: ScheduledTaskRunStatus::Failed,
            exit_code: exit_status.and_then(|status| status.code()),
            output,
            error: Some(error),
        };
    }
    match exit_status {
        Some(status) if status.success() => TaskExecution {
            status: ScheduledTaskRunStatus::Succeeded,
            exit_code: status.code(),
            output,
            error: None,
        },
        Some(status) => TaskExecution {
            status: ScheduledTaskRunStatus::Failed,
            exit_code: status.code(),
            error: Some(
                extract_error_from_output(&output)
                    .unwrap_or_else(|| "定时任务执行失败".to_string()),
            ),
            output,
        },
        None => TaskExecution {
            status: ScheduledTaskRunStatus::Failed,
            exit_code: None,
            error: Some("无法读取定时任务退出状态".to_string()),
            output,
        },
    }
}

#[derive(Default)]
struct CapturedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

struct OutputCapture {
    worker: thread::JoinHandle<()>,
    output: Arc<Mutex<CapturedOutput>>,
}

impl OutputCapture {
    fn is_finished(&self) -> bool {
        self.worker.is_finished()
    }

    fn finish(self) -> String {
        if self.worker.is_finished() {
            let _ = self.worker.join();
        }
        let output = self.output.lock();
        let mut text = String::from_utf8_lossy(&output.bytes).into_owned();
        if output.truncated {
            text.push_str("\n[输出超过 1 MiB，后续内容已截断]\n");
        }
        text
    }
}

fn read_pipe_limited<R>(mut reader: R) -> OutputCapture
where
    R: Read + Send + 'static,
{
    let output = Arc::new(Mutex::new(CapturedOutput::default()));
    let captured = output.clone();
    let worker = thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    let mut captured = captured.lock();
                    let remaining = MAX_CAPTURE_BYTES.saturating_sub(captured.bytes.len());
                    if remaining > 0 {
                        let take = remaining.min(length);
                        captured.bytes.extend_from_slice(&buffer[..take]);
                    }
                    if length > remaining {
                        captured.truncated = true;
                    }
                }
                Err(_) => break,
            }
        }
    });
    OutputCapture { worker, output }
}

fn combine_output(stdout: String, stderr: String) -> String {
    match (stdout.trim(), stderr.trim()) {
        ("", "") => String::new(),
        (stdout, "") => stdout.to_string(),
        ("", stderr) => format!("\n--- stderr ---\n{stderr}"),
        (stdout, stderr) => format!("{stdout}\n\n--- stderr ---\n{stderr}"),
    }
}

fn extract_error_from_output(output: &str) -> Option<String> {
    output
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn summarize_execution(execution: &TaskExecution) -> Option<String> {
    if execution.status == ScheduledTaskRunStatus::Succeeded {
        return Some("执行完成".to_string());
    }
    execution.error.clone().or_else(|| {
        Some(match execution.status {
            ScheduledTaskRunStatus::Cancelled => "已取消".to_string(),
            ScheduledTaskRunStatus::Skipped => "已跳过".to_string(),
            ScheduledTaskRunStatus::TimedOut => "执行超时".to_string(),
            _ => "执行失败".to_string(),
        })
    })
}

#[cfg(target_os = "windows")]
struct TaskProcessTree(*mut std::ffi::c_void);

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateJobObjectW(
        attributes: *const std::ffi::c_void,
        name: *const u16,
    ) -> *mut std::ffi::c_void;
    fn AssignProcessToJobObject(job: *mut std::ffi::c_void, process: *mut std::ffi::c_void) -> i32;
    fn TerminateJobObject(job: *mut std::ffi::c_void, exit_code: u32) -> i32;
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
}

#[cfg(target_os = "windows")]
impl TaskProcessTree {
    fn new(child: &Child) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        // Job 持续追踪后代，即使最初的 cmd/PowerShell 已退出仍可终止整个任务。
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        if unsafe { AssignProcessToJobObject(handle, child.as_raw_handle()) } == 0 {
            let error = std::io::Error::last_os_error().to_string();
            unsafe {
                CloseHandle(handle);
            }
            return Err(error);
        }
        Ok(Self(handle))
    }

    fn terminate(&self) {
        unsafe {
            TerminateJobObject(self.0, 1);
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for TaskProcessTree {
    fn drop(&mut self) {
        self.terminate();
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[cfg(unix)]
struct TaskProcessTree(u32);

#[cfg(unix)]
impl TaskProcessTree {
    fn new(child: &Child) -> Result<Self, String> {
        Ok(Self(child.id()))
    }
    fn terminate(&self) {
        unsafe extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }
        unsafe {
            kill(-(self.0 as i32), 9);
        }
    }
}

#[cfg(unix)]
impl Drop for TaskProcessTree {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        next_run_after, take_startable_tasks, QueuedTask, ScheduledTaskExecutionKind,
        ScheduledTaskMissedRunPolicy, ScheduledTaskNotificationPolicy, ScheduledTaskRecord,
        ScheduledTaskRunRecord, ScheduledTaskRunStatus, ScheduledTaskSchedule,
        ScheduledTaskTrigger, SchedulerState, MAX_QUEUE_WAIT_MS,
    };
    use chrono::{TimeZone, Utc};

    fn command_with_background_pipe_holder() -> std::process::Command {
        #[cfg(windows)]
        let command_text = "start /b ping.exe -n 30 127.0.0.1";
        #[cfg(unix)]
        let command_text = "sleep 30 &";
        let mut command = super::build_shell_command("cmd", command_text).unwrap();
        command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null());
        command
    }

    #[test]
    fn task_timeout_covers_pipe_capture_after_parent_exits() {
        let started = std::time::Instant::now();
        let execution = super::run_command(
            command_with_background_pipe_holder(),
            None,
            1000,
            &std::sync::atomic::AtomicBool::new(false),
        );
        assert_eq!(execution.status, ScheduledTaskRunStatus::TimedOut);
        assert_eq!(
            execution.exit_code,
            Some(0),
            "parent exits before inherited pipes close"
        );
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
    }

    #[test]
    fn task_cancel_covers_pipe_capture_after_parent_exits() {
        let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let signal = cancelled.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(700));
            signal.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        let started = std::time::Instant::now();
        let execution = super::run_command(
            command_with_background_pipe_holder(),
            None,
            10_000,
            &cancelled,
        );
        canceller.join().unwrap();
        assert_eq!(execution.status, ScheduledTaskRunStatus::Cancelled);
        assert_eq!(execution.exit_code, Some(0));
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
    }

    #[test]
    fn task_timeout_also_covers_blocked_stdin_writer() {
        #[cfg(windows)]
        let command_text = "ping.exe -n 30 127.0.0.1 >nul";
        #[cfg(unix)]
        let command_text = "sleep 30";
        let mut command = super::build_shell_command("cmd", command_text).unwrap();
        command
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let started = std::time::Instant::now();
        let execution = super::run_command(
            command,
            Some("x".repeat(1024 * 1024)),
            300,
            &std::sync::atomic::AtomicBool::new(false),
        );
        assert_eq!(execution.status, ScheduledTaskRunStatus::TimedOut);
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
    }

    #[test]
    fn task_keeps_normal_success_output() {
        let mut command = super::build_shell_command("cmd", "echo task-output").unwrap();
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let execution = super::run_command(
            command,
            None,
            5000,
            &std::sync::atomic::AtomicBool::new(false),
        );
        assert_eq!(execution.status, ScheduledTaskRunStatus::Succeeded);
        assert!(execution.output.contains("task-output"));
    }

    #[test]
    fn scheduled_agent_keeps_read_only_unattended_permissions() {
        let command = super::build_scheduled_agent_command("codex.cmd");
        let args: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy())
            .collect();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "read-only"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-c", "approval_policy=\"never\""]));
        assert!(!args
            .iter()
            .any(|arg| arg.contains("bypass") || arg.contains("full-access")));
        assert_eq!(args.last().map(|arg| arg.as_ref()), Some("-"));
        #[cfg(target_os = "windows")]
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-c", "windows.sandbox=\"unelevated\""]));
    }

    #[test]
    fn sandbox_diagnostic_in_trace_does_not_override_a_successful_agent_report() {
        let mut execution = super::TaskExecution {
            status: ScheduledTaskRunStatus::Succeeded,
            exit_code: Some(0),
            output: super::combine_output(
                "发现 1 个需要修复的问题".into(),
                "2026-09-13 ERROR codex_core::tools::router: exec_command failed: Failed to create unified exec process: helper_unknown_error: apply deny-read ACLs".into(),
            ),
            error: None,
        };
        super::mark_agent_sandbox_failure(&mut execution);
        assert_eq!(execution.status, ScheduledTaskRunStatus::Succeeded);
        assert_eq!(execution.exit_code, Some(0));
        assert!(execution.error.is_none());
    }

    #[test]
    fn sandbox_diagnostic_in_answer_does_not_fail_successful_task() {
        let mut execution = super::TaskExecution {
            status: ScheduledTaskRunStatus::Succeeded,
            exit_code: Some(0),
            output: super::combine_output(
                "windows sandbox failed: example".into(),
                "tokens used: 10".into(),
            ),
            error: None,
        };
        super::mark_agent_sandbox_failure(&mut execution);
        assert_eq!(execution.status, ScheduledTaskRunStatus::Succeeded);
        execution.status = ScheduledTaskRunStatus::Cancelled;
        execution.output =
            super::combine_output(String::new(), "windows sandbox failed: failure".into());
        super::mark_agent_sandbox_failure(&mut execution);
        assert_eq!(execution.status, ScheduledTaskRunStatus::Cancelled);
    }

    #[test]
    fn agent_sandbox_failure_without_final_response_is_failed() {
        let mut execution = super::TaskExecution {
            status: ScheduledTaskRunStatus::Succeeded,
            exit_code: Some(0),
            output: super::combine_output(
                String::new(),
                "windows sandbox failed: helper_unknown_error: apply deny-read ACLs".into(),
            ),
            error: None,
        };
        super::mark_agent_sandbox_failure(&mut execution);
        assert_eq!(execution.status, ScheduledTaskRunStatus::Failed);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn scheduled_process_has_no_console_window() {
        let mut command = std::process::Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", r#"Add-Type -Name NativeConsole -Namespace KrosnaTest -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();'; if ([KrosnaTest.NativeConsole]::GetConsoleWindow() -ne [IntPtr]::Zero) { exit 1 }; Write-Output 'no-console'"#]);
        command
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let execution = super::run_command(
            command,
            None,
            30_000,
            &std::sync::atomic::AtomicBool::new(false),
        );
        assert_eq!(
            execution.status,
            ScheduledTaskRunStatus::Succeeded,
            "{}",
            execution.output
        );
        assert!(execution.output.contains("no-console"));
    }

    fn queued_task(
        task_id: &str,
        project_path: &str,
        run_id: &str,
        created_at_ms: i64,
    ) -> QueuedTask {
        QueuedTask {
            task: ScheduledTaskRecord {
                id: task_id.to_string(),
                project_path: project_path.to_string(),
                project_name: project_path.to_string(),
                name: task_id.to_string(),
                execution_kind: ScheduledTaskExecutionKind::Command,
                agent_id: None,
                prompt: None,
                command: Some("echo scheduled".to_string()),
                shell: Some("powershell".to_string()),
                schedule: ScheduledTaskSchedule::Daily {
                    time: "09:00".to_string(),
                },
                timezone: "Asia/Shanghai".to_string(),
                enabled: true,
                next_run_at_ms: Some(created_at_ms),
                timeout_ms: 60_000,
                missed_run_policy: ScheduledTaskMissedRunPolicy::Skip,
                notification_policy: ScheduledTaskNotificationPolicy::None,
                created_at_ms,
                updated_at_ms: created_at_ms,
                deleted_at_ms: None,
            },
            run: ScheduledTaskRunRecord {
                id: run_id.to_string(),
                task_id: task_id.to_string(),
                task_name: task_id.to_string(),
                project_path: project_path.to_string(),
                trigger: ScheduledTaskTrigger::Schedule,
                scheduled_at_ms: Some(created_at_ms),
                status: ScheduledTaskRunStatus::Queued,
                config_snapshot: serde_json::json!({}),
                started_at_ms: None,
                completed_at_ms: None,
                exit_code: None,
                summary: None,
                error: None,
                log_available: false,
                created_at_ms,
            },
        }
    }

    #[test]
    fn interval_uses_its_anchor_instead_of_completion_time() {
        let schedule = ScheduledTaskSchedule::Interval {
            interval_minutes: 60,
            anchor_at_ms: 1_000,
        };
        assert_eq!(
            next_run_after(&schedule, "Asia/Shanghai", 1_000).unwrap(),
            Some(3_601_000)
        );
        assert_eq!(
            next_run_after(&schedule, "Asia/Shanghai", 4_000_000).unwrap(),
            Some(7_201_000)
        );
    }

    #[test]
    fn daily_schedule_uses_the_task_timezone() {
        let after = Utc
            .with_ymd_and_hms(2026, 9, 13, 0, 30, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let schedule = ScheduledTaskSchedule::Daily {
            time: "09:00".to_string(),
        };
        let next = next_run_after(&schedule, "Asia/Shanghai", after)
            .unwrap()
            .unwrap();
        let expected = Utc
            .with_ymd_and_hms(2026, 9, 13, 1, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        assert_eq!(next, expected);
    }

    #[test]
    fn weekly_schedule_rolls_to_the_following_week_after_today_time_passes() {
        let after = Utc
            .with_ymd_and_hms(2026, 9, 14, 2, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let schedule = ScheduledTaskSchedule::Weekly {
            weekday: 1,
            time: "09:00".to_string(),
        };
        let next = next_run_after(&schedule, "Asia/Shanghai", after)
            .unwrap()
            .unwrap();
        let expected = Utc
            .with_ymd_and_hms(2026, 9, 21, 1, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        assert_eq!(next, expected);
    }

    #[test]
    fn daily_schedule_skips_a_nonexistent_daylight_saving_time() {
        let after = Utc
            .with_ymd_and_hms(2026, 3, 8, 5, 0, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let schedule = ScheduledTaskSchedule::Daily {
            time: "02:30".to_string(),
        };

        let next = next_run_after(&schedule, "America/New_York", after)
            .unwrap()
            .unwrap();
        let expected = Utc
            .with_ymd_and_hms(2026, 3, 9, 6, 30, 0)
            .single()
            .unwrap()
            .timestamp_millis();

        assert_eq!(next, expected);
    }

    #[test]
    fn daily_schedule_runs_an_ambiguous_daylight_saving_time_once() {
        let after = Utc
            .with_ymd_and_hms(2026, 11, 1, 5, 31, 0)
            .single()
            .unwrap()
            .timestamp_millis();
        let schedule = ScheduledTaskSchedule::Daily {
            time: "01:30".to_string(),
        };

        let next = next_run_after(&schedule, "America/New_York", after)
            .unwrap()
            .unwrap();
        let expected = Utc
            .with_ymd_and_hms(2026, 11, 2, 6, 30, 0)
            .single()
            .unwrap()
            .timestamp_millis();

        assert_eq!(next, expected);
    }

    #[test]
    fn queue_serializes_one_project_but_uses_a_second_global_slot() {
        let mut state = SchedulerState::default();
        state
            .queued
            .push_back(queued_task("task-a", "D:/project-a", "run-a", 1));
        state
            .queued
            .push_back(queued_task("task-b", "D:/project-a", "run-b", 1));
        state
            .queued
            .push_back(queued_task("task-c", "D:/project-c", "run-c", 1));

        let selection = take_startable_tasks(&mut state, 2);
        let started_ids: Vec<_> = selection
            .start
            .iter()
            .map(|(_, run, _)| run.id.as_str())
            .collect();

        assert_eq!(started_ids, ["run-a", "run-c"]);
        assert_eq!(state.running.len(), 2);
        assert_eq!(state.queued.len(), 1);
        assert_eq!(
            state.queued.front().map(|entry| entry.run.id.as_str()),
            Some("run-b")
        );
    }

    #[test]
    fn queue_marks_entries_waiting_too_long_as_expired() {
        let mut state = SchedulerState::default();
        state
            .queued
            .push_back(queued_task("task-a", "D:/project-a", "run-a", 1));

        let selection = take_startable_tasks(&mut state, MAX_QUEUE_WAIT_MS + 2);

        assert!(selection.start.is_empty());
        assert_eq!(selection.expired.len(), 1);
        assert_eq!(selection.expired[0].id, "run-a");
        assert!(state.queued.is_empty());
    }
}
