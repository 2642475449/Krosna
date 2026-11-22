import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, StopOutlined } from "@ant-design/icons";
import { WorkbenchGlyph } from "@/components/ui/WorkbenchGlyph";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { EMPTY_RUNNER_TABS, isRunnerRunning, useBottomRunnerStore } from "@/store/slices/bottomRunner";
import { useShortcutStore } from "@/store/slices/shortcutSlice";
import { getAppShortcut } from "@/lib/appShortcuts";
import type { BottomRunnerTab, BottomRunnerTabStatus } from "@/store/types";
import "./bottomRunner.css";

export function RunnerStatusIcon({ status }: { status: BottomRunnerTabStatus }) {
  return <span key={status} className="app-bottom-runner-icon inline-flex" data-status={status} aria-hidden="true">
    {status === "starting" || status === "running" ? <LoadingOutlined />
      : status === "success" || status === "completed" ? <CheckCircleOutlined />
        : status === "error" ? <CloseCircleOutlined /> : <StopOutlined />}
  </span>;
}

export interface BottomRunnerRailBadge {
  variant: "error" | "running";
  count: number;
}

export function getBottomRunnerRailCounts(tabs: Pick<BottomRunnerTab, "status">[]) {
  let runningCount = 0;
  let errorCount = 0;
  for (const tab of tabs) {
    if (isRunnerRunning(tab)) runningCount += 1;
    else if (tab.status === "error") errorCount += 1;
  }
  return { runningCount, errorCount };
}

export function getBottomRunnerRailBadge(tabs: Pick<BottomRunnerTab, "status">[]): BottomRunnerRailBadge | null {
  const { runningCount, errorCount } = getBottomRunnerRailCounts(tabs);
  if (errorCount > 0) return { variant: "error", count: errorCount };
  if (runningCount > 0) return { variant: "running", count: runningCount };
  return null;
}

export function BottomRunnerRailButton() {
  const { t } = useTranslation();
  const projectPath = useAppStore((state) => state.windowMode === "project" ? state.currentProject?.path : undefined);
  const open = useBottomRunnerStore((state) => state.open);
  const tabs = useBottomRunnerStore((state) => state.tabsByProject[projectPath ?? ""] ?? EMPTY_RUNNER_TABS);
  const overrides = useShortcutStore((state) => state.overrides);
  if (!projectPath) return null;
  const { runningCount, errorCount } = getBottomRunnerRailCounts(tabs);
  const badge = getBottomRunnerRailBadge(tabs);
  const baseLabel = t("bottomRunner.toggleShortcut", { shortcut: getAppShortcut(overrides, "toggleBottomRunner") });
  const statusParts: string[] = [];
  if (runningCount > 0) statusParts.push(t("bottomRunner.runningTasks", { count: runningCount }));
  if (errorCount > 0) statusParts.push(t("bottomRunner.failedTasks", { count: errorCount }));
  const accessibleLabel = statusParts.length > 0 ? `${baseLabel} · ${statusParts.join(" · ")}` : baseLabel;
  const tooltipTitle = statusParts.length > 0 ? (
    <div>
      <div>{baseLabel}</div>
      {statusParts.map((part) => <div key={part}>{part}</div>)}
    </div>
  ) : baseLabel;
  return <Tooltip title={tooltipTitle} placement="right" mouseEnterDelay={0.4}>
    <button type="button" aria-label={accessibleLabel} aria-pressed={open} data-active={open}
      data-status={badge?.variant ?? "idle"}
      onMouseDown={(event) => event.preventDefault()} onClick={() => useBottomRunnerStore.getState().toggleOpen()}
      className="app-bottom-runner-rail app-rail-button relative flex h-10 w-10 items-center justify-center rounded-md">
      <WorkbenchGlyph kind="runner" />
      {badge && <span key={`${badge.variant}:${badge.count}`} aria-hidden="true" data-variant={badge.variant}
        className="app-rail-badge-count app-badge-pop pointer-events-none absolute bottom-0 right-0 flex h-5 min-w-5 items-center justify-center rounded-full px-1">
        {badge.count}
      </span>}
    </button>
  </Tooltip>;
}

