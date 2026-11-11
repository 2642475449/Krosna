import { useCallback } from "react";
import { message } from "antd";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { cleanupSessionProcess, closePty, resolveRecentCodexSessionId, spawnPty } from "@/lib/api";
import { getAgentCommandShell, getAgentStartupCommand, isAiAgentId } from "@/lib/agents";
import type { SessionLaunchOptions } from "@/types";

class CodexSessionRestoreError extends Error {}
class SessionRestoreError extends Error {}

// 不同标签、侧边栏和退出提示共用同一把会话锁，避免并发重建同一个 PTY。
const launchingSessions = new Set<string>();

interface ResumeSessionOptions {
  restart?: boolean;
}

export function useResumeSession() {
  const { t } = useTranslation();
  const defaultTerminalShell = useAppStore((state) => state.defaultTerminalShell);
  const updateSession = useAppStore((state) => state.updateSession);

  return useCallback(async (sessionId: string, options: ResumeSessionOptions = {}) => {
    const session = useAppStore.getState().sessions.find((item) => item.id === sessionId);
    if (!session || (!options.restart && session.active) || session.status === "starting" || launchingSessions.has(sessionId)) return;

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
      let agentSessionId = session.agentSessionId;
      if (session.agentId === "codex") {
        if (!options.restart) {
          agentSessionId ??= await resolveRecentCodexSessionId(session.path, session.createdAt);
          if (!agentSessionId) throw new CodexSessionRestoreError();
        } else if (session.hasPromptHistory && !agentSessionId) {
          // 最近修改的对话可能属于同项目中另一个并发终端，重启只能使用已绑定 ID。
          throw new SessionRestoreError();
        }
      } else if (session.agentId === "pi") {
        // Pi can create or resume an exact UUID with --session-id. Reuse the
        // stable Krosna session ID so restoration never depends on recency.
        agentSessionId ??= sessionId;
      }
      if (options.restart && session.hasPromptHistory && !agentSessionId &&
        (session.agentId === "antigravity" || session.agentId === "qoder" || session.agentId === "opencode")) {
        // --continue 可能命中同一项目的另一段对话，重启不能用它猜测身份。
        throw new SessionRestoreError();
      }
      const launchOptions: SessionLaunchOptions | undefined = session.agentId === "antigravity"
        ? {
            dangerouslySkipPermissions: session.antigravityDangerouslySkipPermissions ?? false,
            sandbox: session.antigravitySandbox ?? false,
            mode: session.antigravityMode ?? "inherit",
          }
        : session.agentId === "qoder"
          ? { permissionMode: session.qoderPermissionMode ?? "inherit" }
          : undefined;

      if (!useAppStore.getState().sessions.some((item) => item.id === sessionId)) return;
      if (options.restart) {
        await closePty(sessionId);
        processStopped = true;
        if (!useAppStore.getState().sessions.some((item) => item.id === sessionId)) return;
        updateSession(sessionId, { active: false, status: "starting" });
      }
      await cleanupSessionProcess(sessionId);
      if (!useAppStore.getState().sessions.some((item) => item.id === sessionId)) return;

      await spawnPty(
        sessionId,
        session.path,
        Boolean(session.hasPromptHistory),
        session.agentId === "claude" || !session.agentId
          ? (session.claudeSkipPermissions ?? false)
          : false,
        session.agentId === "cmd" || session.agentId === "powershell" ? "" : getAgentStartupCommand(
          session.agentId,
          session.agentExecutablePath,
          agentSessionId,
          null,
          launchOptions,
          options.restart ? Boolean(agentSessionId) : true,
        ),
        undefined,
        isAiAgentId(session.agentId)
          ? getAgentCommandShell(session.agentId)
          : session.agentId === "cmd" || session.agentId === "powershell"
            ? session.agentId : defaultTerminalShell,
        session.agentId === "claude" ? (session.runtimeEffort ?? undefined) : undefined,
        session.agentId,
        options.restart && (session.agentId === "cmd" || session.agentId === "powershell")
          ? session.terminalWorkingDirectory ?? undefined
          : undefined,
        { label: session.name, kind: isAiAgentId(session.agentId) ? "agent" : "terminal" },
      );
      updateSession(sessionId, { active: true, status: "waiting", agentSessionId });
      useAppStore.getState().clearTerminalExitCode(sessionId);
    } catch (error) {
      console.error("Failed to resume session:", error);
      const currentSession = useAppStore.getState().sessions.find((item) => item.id === sessionId);
      if (currentSession && processStopped) {
        updateSession(sessionId, { active: false, status: "error" });
      } else if (currentSession?.status === "starting" && currentSession.statusRevision === 0) {
        // 预检期间收到的新状态事件应保留，不能拿旧快照覆盖。
        updateSession(sessionId, currentSession.active === previousState.active
          ? previousState
          : { active: currentSession.active, status: "error" });
      }
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
    } finally {
      launchingSessions.delete(sessionId);
    }
  }, [defaultTerminalShell, t, updateSession]);
}
