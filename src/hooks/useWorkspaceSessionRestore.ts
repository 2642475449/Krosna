import { useEffect } from "react";
import { useAppStore } from "@/store";
import { useBackgroundStore } from "@/store/slices/background";
import { takeWorkspaceRestoreSession, useWorkspaceRecoveryStore } from "@/store/slices/workspaceRecovery";
import { useResumeSession } from "./useResumeSession";

const RESTORE_CONCURRENCY = 2;

/** 只消费启动快照中的打开标签；队列变化不重建 effect，避免取消正在恢复的会话。 */
export function useWorkspaceSessionRestore(): void {
  const enabled = useWorkspaceRecoveryStore((state) => state.enabled);
  const projectPath = useWorkspaceRecoveryStore((state) => state.projectPath);
  const phase = useWorkspaceRecoveryStore((state) => state.phase);
  const resumeSession = useResumeSession();

  useEffect(() => {
    if (!enabled || !projectPath || phase !== "ready") return;
    let stopped = false;
    const active = new Map<string, AbortController>();
    const stop = () => {
      stopped = true;
      for (const controller of active.values()) controller.abort();
    };
    const canRestore = () => {
      const recovery = useWorkspaceRecoveryStore.getState();
      const workspace = useAppStore.getState();
      const background = useBackgroundStore.getState();
      return !stopped && recovery.enabled && recovery.phase === "ready" && recovery.projectPath === projectPath
        && workspace.windowContextReady && workspace.currentProject?.path === projectPath
        && !background.exitPreparing && !background.closePreparing;
    };
    const isOpen = (sessionId: string) => {
      const workspace = useAppStore.getState();
      return workspace.sessions.some((session) => session.id === sessionId && session.path === projectPath && !session.archived)
        && workspace.tabsById[sessionId]?.kind === "session"
        && Object.values(workspace.panesById).some((pane) => pane.tabIds.includes(sessionId));
    };
    const check = () => {
      // 退出准备被撤销后也不重启本轮，避免关闭过程中刚停下的会话又被唤起。
      if (!canRestore()) { stop(); return; }
      for (const [id, controller] of active) if (!isOpen(id)) controller.abort();
    };
    const unsubscribeApp = useAppStore.subscribe(check);
    const unsubscribeRecovery = useWorkspaceRecoveryStore.subscribe(check);
    const unsubscribeBackground = useBackgroundStore.subscribe(check);
    const worker = async () => {
      while (canRestore()) {
        const id = takeWorkspaceRestoreSession();
        if (!id) return;
        if (!canRestore()) { stop(); return; }
        if (!isOpen(id) || active.has(id)) continue;
        const controller = new AbortController();
        active.set(id, controller);
        try {
          await resumeSession(id, { automatic: true, signal: controller.signal });
        } catch (error) {
          if (!controller.signal.aborted) console.warn("Could not automatically restore session", id, error);
        } finally {
          active.delete(id);
        }
      }
    };
    // StrictMode 首次 setup/cleanup 不消费队列；下一次真实挂载才开始领取任务。
    void Promise.resolve().then(() => {
      if (canRestore()) for (let index = 0; index < RESTORE_CONCURRENCY; index += 1) void worker();
    });
    return () => {
      stop();
      unsubscribeApp();
      unsubscribeRecovery();
      unsubscribeBackground();
    };
  }, [enabled, projectPath, phase, resumeSession]);
}
