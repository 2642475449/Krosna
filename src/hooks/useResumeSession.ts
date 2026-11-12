import { useCallback } from "react";
import { message } from "antd";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { cleanupSessionProcess, closePty, resolveRecentCodexSessionId, spawnPty } from "@/lib/api";
import { getAgentCommandShell, getAgentStartupCommand, isAiAgentId } from "@/lib/agents";
import { buildSessionRestorePlan } from "@/lib/sessionRestore";
import { waitForTerminalRecoveryReady } from "@/store/slices/terminalRecovery";
import type { ClaudeSessionLaunchOptions, SessionLaunchOptions } from "@/types";

class CodexSessionRestoreError extends Error {}
class SessionRestoreError extends Error {}
class SessionRestoreCancelledError extends Error {}

// 不同标签、侧边栏和退出提示共用同一把会话锁，避免并发重建同一个 PTY。
const launchingSessions = new Set<string>();

interface ResumeSessionOptions {
  restart?: boolean;
  automatic?: boolean;
  signal?: AbortSignal;
}

async function waitForTerminalReady(sessionId: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new SessionRestoreCancelledError();
  let abort: () => void = () => {};
  try {
    await Promise.race([
      waitForTerminalRecoveryReady(sessionId),
      ...(signal ? [new Promise<never>((_resolve, reject) => {
        abort = () => reject(new SessionRestoreCancelledError());
        signal.addEventListener("abort", abort, { once: true });
      })] : []),
    ]);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export function useResumeSession() {
  const { t } = useTranslation();
  const defaultTerminalShell = useAppStore((state) => state.defaultTerminalShell);
  const updateSession = useAppStore((state) => state.updateSession);

  return useCallback(async (sessionId: string, options: ResumeSessionOptions = {}): Promise<boolean> => {
    const session = useAppStore.getState().sessions.find((item) => item.id === sessionId);
    if (!session || options.signal?.aborted || (!options.restart && session.active) || session.status === "starting" || launchingSessions.has(sessionId)) return false;
    const automaticPlan = options.automatic ? buildSessionRestorePlan(session) : undefined;
    if (automaticPlan?.kind === "unavailable") return false;
    const isCurrentSession = () => !options.signal?.aborted && useAppStore.getState().sessions.some((item) =>
      item.id === sessionId && item.path === session.path && item.agentId === session.agentId && !item.archived);

    launchingSessions.add(sessionId);
    const previousState = { active: session.active, status: session.status, statusRevision: session.statusRevision, statusUpdatedAt: session.statusUpdatedAt };
    let processStopped = !session.active;

    try {
      updateSession(sessionId, {
        active: options.restart ? session.active : false,
        status: "starting",
        statusRevision: 0,
        statusUpdatedAt: Date.now(),
      });
      let agentSessionId = automaticPlan ? automaticPlan.agentSessionId : session.agentSessionId;
      if (!automaticPlan && session.agentId === "codex") {
        if (!options.restart) {
          agentSessionId ??= await resolveRecentCodexSessionId(session.path, session.createdAt);
          if (!agentSessionId) throw new CodexSessionRestoreError();
        } else if (session.hasPromptHistory && !agentSessionId) {
          // 最近修改的对话可能属于同项目中另一个并发终端，重启只能使用已绑定 ID。
          throw new SessionRestoreError();
        }
      } else if (!automaticPlan && session.agentId === "pi") {
        // Pi can create or resume an exact UUID with --session-id. Reuse the
        // stable Krosna session ID so restoration never depends on recency.
        agentSessionId ??= sessionId;
      }
      if (options.restart && session.hasPromptHistory && !agentSessionId &&
        (session.agentId === "antigravity" || session.agentId === "qoder" || session.agentId === "opencode")) {
        // --continue 可能命中同一项目的另一段对话，重启不能用它猜测身份。
        throw new SessionRestoreError();
      }
      const launchOptions: SessionLaunchOptions | undefined = session.launchConfigSnapshot ?? (session.agentId === "antigravity"
        ? {
            dangerouslySkipPermissions: session.antigravityDangerouslySkipPermissions ?? false,
            sandbox: session.antigravitySandbox ?? false,
            mode: session.antigravityMode ?? "inherit",
          }
        : session.agentId === "qoder"
          ? { permissionMode: session.qoderPermissionMode ?? "inherit" }
          : undefined);
      const claudeOptions = session.agentId === "claude" || !session.agentId
        ? session.launchConfigSnapshot as ClaudeSessionLaunchOptions | undefined : undefined;

      if (!isCurrentSession()) throw new SessionRestoreCancelledError();
      if (options.restart) {
        await closePty(sessionId);
        processStopped = true;
        if (!isCurrentSession()) throw new SessionRestoreCancelledError();
        updateSession(sessionId, { active: false, status: "starting" });
      }
      // starting 先挂载 Terminal，等待订阅完成后才允许新进程产生第一帧输出。
      if (options.automatic || session.workspaceRestorePending) await waitForTerminalReady(sessionId, options.signal);
      if (!isCurrentSession()) throw new SessionRestoreCancelledError();
      await cleanupSessionProcess(sessionId);
      if (!isCurrentSession()) throw new SessionRestoreCancelledError();

      await spawnPty(
        sessionId,
        session.path,
        automaticPlan ? automaticPlan.resume : Boolean(session.hasPromptHistory),
        session.agentId === "claude" || !session.agentId
          ? (claudeOptions?.skipPermissions ?? session.claudeSkipPermissions ?? false)
          : false,
        session.agentId === "cmd" || session.agentId === "powershell" ? "" : getAgentStartupCommand(
          session.agentId,
          session.agentExecutablePath,
          agentSessionId,
          null,
          launchOptions,
          automaticPlan ? automaticPlan.resume : options.restart ? Boolean(agentSessionId) : true,
        ),
        undefined,
        isAiAgentId(session.agentId)
          ? getAgentCommandShell(session.agentId)
          : session.agentId === "cmd" || session.agentId === "powershell"
            ? session.agentId : defaultTerminalShell,
        session.agentId === "claude" || !session.agentId
          ? claudeOptions?.effort && claudeOptions.effort !== "inherit"
            ? claudeOptions.effort : session.runtimeEffort ?? undefined
          : undefined,
        session.agentId,
        (options.restart || options.automatic || session.workspaceRestorePending) && (session.agentId === "cmd" || session.agentId === "powershell")
          ? session.terminalWorkingDirectory ?? undefined
          : undefined,
        { label: session.name, kind: isAiAgentId(session.agentId) ? "agent" : "terminal" },
      );
      if (!isCurrentSession()) {
        await closePty(sessionId);
        throw new SessionRestoreCancelledError();
      }
      updateSession(sessionId, { active: true, status: "waiting", agentSessionId, workspaceRestorePending: false });
      useAppStore.getState().clearTerminalExitCode(sessionId);
      return true;
    } catch (error) {
      const cancelled = error instanceof SessionRestoreCancelledError;
      if (!cancelled) console.error("Failed to resume session:", error);
      const currentSession = useAppStore.getState().sessions.find((item) =>
        item.id === sessionId && item.path === session.path && item.agentId === session.agentId && !item.archived);
      if (cancelled && currentSession?.status === "starting") {
        updateSession(sessionId, processStopped ? { ...previousState, active: false } : previousState);
      } else if (currentSession && processStopped && !cancelled) {
        updateSession(sessionId, { active: false, status: "error" });
      } else if (currentSession?.status === "starting" && currentSession.statusRevision === 0) {
        // 预检期间收到的新状态事件应保留，不能拿旧快照覆盖。
        updateSession(sessionId, currentSession.active === previousState.active
          ? previousState
          : { active: currentSession.active, status: "error" });
      }
      if (cancelled || options.automatic) return false;
      if (error instanceof CodexSessionRestoreError) {
        message.error({
          key: `codex-session-restore-${sessionId}`,
          title: t("sidebar.codexSessionRestoreFailedTitle"),
          content: t("sidebar.codexSessionRestoreFailedDescription"),
        });
      } else if (error instanceof SessionRestoreError) {
        message.error(t("tabBar.restartSessionRestoreFailed"));
      } else {
        message.error(error instanceof Error ? error.message : String(error));
      }
      return false;
    } finally {
      launchingSessions.delete(sessionId);
    }
  }, [defaultTerminalShell, t, updateSession]);
}
