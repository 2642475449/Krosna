import { lazy, Suspense, useEffect } from "react";
import { Button, Spin } from "antd";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import type { BottomRunnerTab } from "@/store/types";
import { useBottomRunnerStore } from "@/store/slices/bottomRunner";
import {
  restoreRunnerOutput,
  setRunnerOutputVisible,
  useRunnerOutputStore,
} from "@/store/slices/runnerOutput";
import { completeRunner, markRunnerTerminalReady } from "@/store/slices/bottomRunnerRuntime";

const Terminal = lazy(() => import("../Terminal"));

export function RunnerTerminalView({ tab, visible }: { tab: BottomRunnerTab; visible: boolean }) {
  const { t } = useTranslation();
  const sessionExists = useAppStore((state) =>
    (state.projectSessions[tab.projectPath] ?? []).some((session) => session.id === tab.sessionId));
  // 视图只订阅轻量状态，避免 React 的前一帧引用额外保留整份恢复正文。
  const phase = useRunnerOutputStore((state) => state.entries[tab.sessionId]?.phase ?? "live");
  const error = useRunnerOutputStore((state) => state.entries[tab.sessionId]?.error);
  const autoScroll = useBottomRunnerStore((state) => state.autoScroll);
  const wordWrap = useBottomRunnerStore((state) => state.wordWrap);

  useEffect(() => {
    if (!sessionExists) return;
    setRunnerOutputVisible(tab.sessionId, visible);
    if (visible && phase === "archived") void restoreRunnerOutput(tab.sessionId);
  }, [tab.sessionId, visible, phase, sessionExists]);

  if (!sessionExists) return null;
  if (phase === "archived") return null;
  if (phase === "loading") {
    return <div role="status" className="flex h-full items-center justify-center">
      <Spin description={t("bottomRunner.restoringOutput")} />
    </div>;
  }
  if (phase === "restore-error") {
    return <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-sm text-[var(--cs-text-secondary)]">
      <span>{t("bottomRunner.restoreOutputFailed")}</span>
      <Button onClick={() => void restoreRunnerOutput(tab.sessionId)}>{t("common.retry")}</Button>
    </div>;
  }
  return <div className="flex h-full min-h-0 flex-col">
    {error && <div role="status" className="shrink-0 px-3 py-1 text-xs text-[var(--cs-text-secondary)]">
      {t("bottomRunner.archiveOutputFailed")}
    </div>}
    <div className="min-h-0 flex-1">
      <Suspense fallback={null}><Terminal sessionId={tab.sessionId}
        allowIndependentFocus={visible}
        runnerOptions={{ autoScroll, wordWrap,
          onAutoScrollChange: useBottomRunnerStore.getState().setAutoScroll,
          onReady: markRunnerTerminalReady, onCommandComplete: completeRunner }} />
      </Suspense>
    </div>
  </div>;
}
