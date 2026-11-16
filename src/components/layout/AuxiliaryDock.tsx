import {
  CloseOutlined,
  CodeOutlined,
  DownOutlined,
  ExportOutlined,
  FileOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Dropdown, Empty, Input, Modal, Spin, Tooltip, message, type MenuProps } from "antd";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MarkdownModeButtons } from "@/components/ui/MarkdownModeButtons";
import { TabSelectionIndicator } from "@/components/ui/TabSelectionIndicator";
import { useTranslation } from "react-i18next";
import { AgentActivityIcon } from "@/components/AgentActivityIcon";
import { AgentIcon } from "@/components/AgentIcon";
import { AgentSessionStatus } from "@/components/AgentSessionStatus";
import { TaskMonitorPanel } from "@/components/TaskMonitorPopover";
import { getFileDocument } from "@/lib/fileDocument";
import { cleanupSessionProcess, openInAssociatedApplication, openInFileManager, searchProjectEntries } from "@/lib/api";
import {
  OPEN_AUXILIARY_FILE_EVENT,
  type OpenAuxiliaryFileDetail,
} from "@/lib/auxiliaryDock";
import { useAppStore } from "@/store";
import { getFileIconByName, isMarkdownFile } from "@/lib/fileIcon";
import {
  clampAuxiliaryDockWidth,
  defaultAuxiliaryDockWidth,
  effectiveAuxiliaryDockWidth,
  type AuxiliaryTab,
  useAuxiliaryDockStore,
} from "@/store/auxiliaryDock";
import type { FileTreeEntry } from "@/types";

const TERMINAL_LAYOUT_SYNC_EVENT = "terminal:layout-sync";
const AuxiliaryFileView = lazy(() => import("@/components/AuxiliaryFileView"));
const Terminal = lazy(() => import("@/components/Terminal"));

interface AuxiliaryDockProps {
  onRequestTerminal: () => void;
  onRequestTask: () => void;
}

function tabIcon(kind: AuxiliaryTab["kind"]) {
  if (kind === "terminal") return <CodeOutlined />;
  if (kind === "task") return <RobotOutlined />;
  if (kind === "task-monitor") return <FileSearchOutlined />;
  return <FileOutlined />;
}

export default function AuxiliaryDock({
  onRequestTerminal,
  onRequestTask,
}: AuxiliaryDockProps) {
  const { t } = useTranslation();
  const currentProject = useAppStore((state) => state.currentProject);
  const sessions = useAppStore((state) => state.sessions);
  const updateSession = useAppStore((state) => state.updateSession);
  const removeSession = useAppStore((state) => state.removeSession);
  const open = useAuxiliaryDockStore((state) => state.open);
  const widths = useAuxiliaryDockStore((state) => state.widths);
  const initialWidths = useAuxiliaryDockStore((state) => state.initialWidths);
  const initializeWidth = useAuxiliaryDockStore((state) => state.initializeWidth);
  const resetStoredWidth = useAuxiliaryDockStore((state) => state.resetWidth);
  const tabs = useAuxiliaryDockStore((state) => state.tabs);
  const activeTabId = useAuxiliaryDockStore((state) => state.activeTabId);
  const setWidth = useAuxiliaryDockStore((state) => state.setWidth);
  const activateTab = useAuxiliaryDockStore((state) => state.activateTab);
  const openFile = useAuxiliaryDockStore((state) => state.openFile);
  const openTaskMonitor = useAuxiliaryDockStore((state) => state.openTaskMonitor);
  const pinTab = useAuxiliaryDockStore((state) => state.pinTab);
  const setTabMarkdownViewMode = useAuxiliaryDockStore((state) => state.setTabMarkdownViewMode);
  const closeTab = useAuxiliaryDockStore((state) => state.closeTab);
  const reset = useAuxiliaryDockStore((state) => state.reset);
  const [pendingClose, setPendingClose] = useState<AuxiliaryTab[]>([]);
  const [closing, setClosing] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [fileResults, setFileResults] = useState<FileTreeEntry[]>([]);
  const [fileSearching, setFileSearching] = useState(false);
  const [hostWidth, setHostWidth] = useState(0);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const dockRef = useRef<HTMLElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const overflowControlRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const closingSessionIdsRef = useRef(new Set<string>());

  useLayoutEffect(() => {
    const host = dockRef.current?.parentElement;
    if (!host) return;

    const updateWidth = (nextHostWidth: number) => {
      if (nextHostWidth <= 0) return;
      setHostWidth(nextHostWidth);
    };

    updateWidth(host.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      updateWidth(entries[0]?.contentRect.width ?? host.getBoundingClientRect().width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const kind = activeTab?.kind ?? "task-monitor";
  const width = widths[kind] ?? initialWidths[kind] ?? defaultAuxiliaryDockWidth(kind, hostWidth);
  const effectiveWidth = effectiveAuxiliaryDockWidth(width, hostWidth);

  useLayoutEffect(() => {
    if (open && hostWidth > 0) initializeWidth(kind, hostWidth);
  }, [open, kind, hostWidth, initializeWidth]);

  useEffect(() => {
    reset();
    setPendingClose([]);
  }, [currentProject?.path, reset]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OpenAuxiliaryFileDetail>).detail;
      if (!detail?.projectPath || !detail.path) return;
      openFile(detail);
    };
    window.addEventListener(OPEN_AUXILIARY_FILE_EVENT, handler);
    return () => window.removeEventListener(OPEN_AUXILIARY_FILE_EVENT, handler);
  }, [openFile]);

  useEffect(() => {
    if (!filePickerOpen || !currentProject || !fileQuery.trim()) {
      setFileResults([]);
      setFileSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setFileSearching(true);
      void searchProjectEntries(currentProject.path, fileQuery)
        .then((items) => {
          if (!cancelled) setFileResults(items.filter((item) => item.kind === "file").slice(0, 80));
        })
        .finally(() => {
          if (!cancelled) setFileSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentProject, filePickerOpen, fileQuery]);

  const syncTerminalLayouts = useCallback(() => {
    const state = useAppStore.getState();
    const sessionIds = new Set(
      useAuxiliaryDockStore.getState().tabs
        .filter((tab) => tab.kind === "terminal" || tab.kind === "task")
        .map((tab) => tab.resourceId),
    );
    if (state.activeSessionId) sessionIds.add(state.activeSessionId);
    for (const sessionId of sessionIds) {
      window.dispatchEvent(new CustomEvent(TERMINAL_LAYOUT_SYNC_EVENT, {
        detail: { sessionId, reason: "auxiliary-dock-resized" },
      }));
    }
  }, []);

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockRef.current?.getBoundingClientRect().width ?? width;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = effectiveAuxiliaryDockWidth(
        clampAuxiliaryDockWidth(startWidth + startX - moveEvent.clientX), hostWidth,
      );
      setWidth(nextWidth);
      syncTerminalLayouts();
    };
    const onEnd = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      syncTerminalLayouts();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
  }, [setWidth, syncTerminalLayouts, width, hostWidth]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => syncTerminalLayouts());
    return () => window.cancelAnimationFrame(frame);
  }, [activeTabId, open, effectiveWidth, syncTerminalLayouts]);

  const handleCloseTab = useCallback(async (tab: AuxiliaryTab) => {
    if (tab.kind !== "terminal" && tab.kind !== "task") {
      closeTab(tab.id);
      return true;
    }
    const session = useAppStore.getState().sessions.find((item) => item.id === tab.resourceId);
    if (!session?.active) {
      useAppStore.getState().clearTerminalExitCode(tab.resourceId);
      removeSession(tab.resourceId);
      closeTab(tab.id);
      return true;
    }
    if (closingSessionIdsRef.current.has(tab.resourceId)) return false;
    closingSessionIdsRef.current.add(tab.resourceId);
    try {
      await cleanupSessionProcess(tab.resourceId);
      if (useAppStore.getState().currentProject?.path !== tab.projectPath) return false;
      removeSession(tab.resourceId);
      closeTab(tab.id);
      return true;
    } catch (error) {
      void message.error(String(error));
      return false;
    } finally {
      closingSessionIdsRef.current.delete(tab.resourceId);
    }
  }, [closeTab, removeSession]);

  const closeTabs = async (targets: AuxiliaryTab[]) => {
    for (const tab of targets) {
      if (useAppStore.getState().currentProject?.path !== tab.projectPath && tab.projectPath) break;
      if (!useAuxiliaryDockStore.getState().tabs.some((item) => item.id === tab.id)) continue;
      if (tab.kind === "file" && !await getFileDocument(tab.projectPath, tab.resourceId).save()) {
        void message.error(t("auxiliaryDock.saveBeforeCloseFailed"));
        break;
      }
      if (useAppStore.getState().currentProject?.path !== tab.projectPath && tab.projectPath) break;
      if (!await handleCloseTab(tab)) break;
    }
  };

  const requestClose = (targets: AuxiliaryTab[]) => {
    const hasLiveProcess = targets.some((tab) =>
      (tab.kind === "task" || tab.kind === "terminal") &&
      useAppStore.getState().sessions.some((session) => session.id === tab.resourceId && session.active));
    if (hasLiveProcess) setPendingClose(targets);
    else void closeTabs(targets).catch((error) => message.error(String(error)));
  };

  const finishMove = (tab: AuxiliaryTab) => {
    const app = useAppStore.getState();
    if (app.currentProject?.path !== tab.projectPath || !useAuxiliaryDockStore.getState().tabs.some((item) => item.id === tab.id)) return;
    if (!app.openFileTab(tab.resourceId, { preview: false })) return;
    openTaskMonitor({ title: t("taskMonitor.title"), projectPath: tab.projectPath });
    closeTab(tab.id, "aux:task-monitor");
  };

  const moveToWorkspace = async (tab: AuxiliaryTab) => {
    if (!await getFileDocument(tab.projectPath, tab.resourceId).save()) {
      void message.error(t("auxiliaryDock.saveBeforeCloseFailed"));
      return;
    }
    finishMove(tab);
  };

  const tabMenu = (tab: AuxiliaryTab) => ({
    items: [
      { key: "close", label: t("tabBar.closeTab") },
      { key: "close-others", label: t("tabBar.closeOtherTabs"), disabled: tabs.length <= 1 },
      { key: "close-all", label: t("tabBar.closeAllTabs") },
      ...(tab.kind === "file" ? [
        { type: "divider" as const },
        ...(tab.preview ? [{ key: "pin", label: t("auxiliaryDock.pin") }] : []),
        { key: "move", label: t("auxiliaryDock.openInWorkspace") },
        { type: "divider" as const },
        { key: "folder", label: t("common.openInFileManager") },
        { key: "copy", label: t("common.copyPath") },
        { key: "associated", label: t("common.openInAssociatedApp") },
      ] : []),
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "close") requestClose([tab]);
      if (key === "close-others") requestClose(tabs.filter((item) => item.id !== tab.id));
      if (key === "close-all") requestClose(tabs);
      if (key === "pin") pinTab(tab.id);
      if (key === "move") void moveToWorkspace(tab).catch((error) => message.error(String(error)));
      if (key === "folder") void openInFileManager(tab.resourceId).catch((error) => message.error(String(error)));
      if (key === "copy") void navigator.clipboard.writeText(tab.resourceId).catch((error) => message.error(String(error)));
      if (key === "associated") void openInAssociatedApplication(tab.resourceId).catch((error) => message.error(String(error)));
    },
  });

  const resetWidth = useCallback(() => {
    resetStoredWidth(hostWidth);
  }, [resetStoredWidth, hostWidth]);

  const revealTab = useCallback((tabId: string | null) => {
    const list = tabListRef.current;
    const tab = tabId ? tabRefs.current[tabId] : null;
    if (!list || !tab) return;
    const viewport = list.getBoundingClientRect();
    const bounds = tab.getBoundingClientRect();
    if (bounds.left < viewport.left) list.scrollLeft += bounds.left - viewport.left;
    else if (bounds.right > viewport.right) list.scrollLeft += bounds.right - viewport.right;
  }, []);

  useLayoutEffect(() => {
    const list = tabListRef.current;
    const bar = tabBarRef.current;
    if (!list || !bar) {
      setHasOverflow(false);
      return;
    }
    const update = () => {
      const tabNodes = list.querySelectorAll<HTMLElement>("[data-tab-id]");
      const minimumWidth = Array.from(tabNodes).reduce((sum, node) =>
        sum + (Number.parseFloat(getComputedStyle(node).minWidth) || node.offsetWidth), 0);
      // 计算不含下拉按钮的可用宽度，避免按钮本身导致临界宽度反复显隐。
      const availableWidth = list.clientWidth + (overflowControlRef.current?.offsetWidth ?? 0);
      setHasOverflow(minimumWidth > availableWidth + 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    observer.observe(list);
    return () => observer.disconnect();
  }, [tabs, sessions, hasOverflow, open]);

  useEffect(() => {
    if (!hasOverflow) setOverflowMenuOpen(false);
  }, [hasOverflow]);

  useEffect(() => {
    setOverflowMenuOpen(false);
  }, [currentProject?.path]);

  useEffect(() => {
    const list = tabListRef.current;
    if (!list) return;
    const revealActiveTab = () => revealTab(activeTabId);
    revealActiveTab();
    const observer = new ResizeObserver(revealActiveTab);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeTabId, tabIds, revealTab]);

  const overflowItems: MenuProps["items"] = tabs.map((tab) => {
    const session = tab.kind === "terminal" || tab.kind === "task"
      ? sessions.find((item) => item.id === tab.resourceId)
      : null;
    const title = session
      ? session.name
      : tab.kind === "task-monitor"
        ? t("taskMonitor.title")
        : tab.title;
    const fileVisual = tab.kind === "file" ? getFileIconByName(tab.title) : null;
    return {
      key: tab.id,
      icon: session ? (
        <AgentIcon agentId={session.agentId ?? "claude"} size={15} />
      ) : fileVisual ? (
        <span style={{ color: fileVisual.color }}>{fileVisual.icon}</span>
      ) : tabIcon(tab.kind),
      label: (
        <span className="app-tabbar-overflow-label">
          <span className="app-tabbar-overflow-title">{title}</span>
          {session && <AgentSessionStatus session={session} />}
        </span>
      ),
    };
  });

  const addMenuItems: MenuProps["items"] = [
    {
      key: "file",
      icon: <FolderOpenOutlined />,
      label: t("auxiliaryDock.file"),
      onClick: () => setFilePickerOpen(true),
    },
    {
      key: "task",
      icon: <RobotOutlined />,
      label: t("auxiliaryDock.sideTask"),
      onClick: onRequestTask,
    },
    {
      key: "terminal",
      icon: <CodeOutlined />,
      label: t("auxiliaryDock.terminal"),
      onClick: onRequestTerminal,
    },
    {
      key: "task-monitor",
      icon: <FileSearchOutlined />,
      label: t("taskMonitor.title"),
      onClick: () =>
        openTaskMonitor({
          title: t("taskMonitor.title"),
          projectPath: currentProject?.path ?? "",
        }),
    },
  ];

  const isActiveFileTab = activeTab?.kind === "file";
  const isActiveMarkdownTab = Boolean(isActiveFileTab && isMarkdownFile(activeTab.resourceId));
  const activeMarkdownViewMode = activeTab?.markdownViewMode ?? "preview";

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        className="app-auxiliary-divider shrink-0 cursor-col-resize"
        style={{
          display: open ? "block" : "none",
        }}
        onDoubleClick={resetWidth}
        onPointerDown={handleResizeStart}
      />
      <aside
        ref={dockRef}
        className="relative min-h-0 shrink-0 flex-col overflow-hidden"
        style={{
          display: open ? "flex" : "none",
          width: effectiveWidth,
          background: "var(--cs-bg-content)",
        }}
      >
        {tabs.length > 0 ? (
          <div
            ref={tabBarRef}
            className="app-shell-chrome app-glass-tabbar app-tabbar flex items-end shrink-0"
            style={{ background: "transparent", minHeight: 36 }}
          >
            <div
              ref={tabListRef}
              className="app-tabbar-tabs"
              onWheel={(event) => {
                const list = event.currentTarget;
                if (list.scrollWidth <= list.clientWidth || event.deltaX !== 0) return;
                list.scrollLeft += event.deltaY;
              }}
            >
              {tabs.map((tab) => {
                const active = tab.id === activeTabId;
                const session = tab.kind === "terminal" || tab.kind === "task"
                  ? sessions.find((item) => item.id === tab.resourceId)
                  : null;
                const displayTitle = session
                  ? session.name
                  : tab.kind === "task-monitor"
                    ? t("taskMonitor.title")
                    : tab.title;
                const fileVisual = tab.kind === "file" ? getFileIconByName(tab.title) : null;
                return (
                  <Dropdown key={tab.id} trigger={["contextMenu"]} menu={tabMenu(tab)}>
                    <div
                      data-tab-id={tab.id}
                      ref={(el) => {
                        tabRefs.current[tab.id] = el;
                      }}
                      className="app-tabbar-tab relative"
                    >
                      <div
                        role="tab"
                        tabIndex={active ? 0 : -1}
                        aria-selected={active}
                        data-active={active ? "true" : "false"}
                        className={`tab-item app-tab-chrome app-marker-host app-glass-tab ${active ? "app-glass-tab-active" : ""} flex items-center gap-1.5 px-3 cursor-pointer`}
                        onMouseDown={(event) => {
                          if (event.button === 1) event.preventDefault();
                        }}
                        onAuxClick={(event) => {
                          if (event.button !== 1) return;
                          event.preventDefault();
                          event.stopPropagation();
                          requestClose([tab]);
                        }}
                        onClick={() => activateTab(tab.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            activateTab(tab.id);
                          }
                        }}
                        onDoubleClick={() => pinTab(tab.id)}
                      >
                        {session ? (
                          <AgentActivityIcon
                            agentId={session.agentId ?? "claude"}
                            active={session.active}
                            status={session.status}
                            size={15}
                          />
                        ) : fileVisual ? (
                          <span className="text-xs inline-flex" style={{ color: fileVisual.color }}>{fileVisual.icon}</span>
                        ) : tabIcon(tab.kind)}
                        {tab.kind === "file" ? (
                          <Tooltip title={<><div>{displayTitle}</div><div>{tab.resourceId}</div></>} mouseEnterDelay={0.5}>
                            <span className={`app-tabbar-title text-xs ${tab.preview ? "italic opacity-70" : ""}`}>
                              {displayTitle}
                            </span>
                          </Tooltip>
                        ) : (
                          <Tooltip title={displayTitle} mouseEnterDelay={0.5}>
                            <span className={`app-tabbar-title text-xs ${tab.preview ? "italic opacity-70" : ""}`}>
                              {displayTitle}
                            </span>
                          </Tooltip>
                        )}
                        <span className="app-tabbar-action">
                          {session && (
                            <span className="app-tabbar-action-status">
                              <AgentSessionStatus session={session} visible={open && active} />
                            </span>
                          )}
                          <button
                            type="button"
                            className="tab-close-btn flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 hover:bg-[var(--cs-bg-hover)]"
                            style={{ color: "var(--cs-text-tertiary)" }}
                            aria-label={t("tabBar.closeTab")}
                            onPointerDown={(event) => {
                              if (event.button === 0) event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              requestClose([tab]);
                            }}
                            onDoubleClick={(event) => event.stopPropagation()}
                          >
                            <CloseOutlined style={{ fontSize: 10 }} />
                          </button>
                        </span>
                      </div>
                    </div>
                  </Dropdown>
                );
              })}
              <TabSelectionIndicator listRef={tabListRef} tabRefs={tabRefs} activeTabId={activeTabId} tabIds={tabIds} />
            </div>
            <div
              className="shrink-0 flex items-center justify-center px-1.5 gap-1.5"
              style={{ minHeight: 36 }}
            >
              <Dropdown trigger={["click"]} placement="bottomLeft" menu={{ items: addMenuItems }}>
                <Tooltip title={t("auxiliaryDock.add")} mouseEnterDelay={0.4}>
                  <button
                    type="button"
                    aria-label={t("auxiliaryDock.add")}
                    className="app-tabbar-new-button"
                  >
                    <PlusOutlined style={{ fontSize: 12, fontWeight: 600 }} />
                  </button>
                </Tooltip>
              </Dropdown>
            </div>
            {hasOverflow && (
              <div ref={overflowControlRef} className="app-tabbar-overflow-control">
                <Dropdown
                  trigger={["click"]}
                  placement="bottomRight"
                  open={overflowMenuOpen}
                  onOpenChange={setOverflowMenuOpen}
                  menu={{
                    items: overflowItems,
                    selectable: true,
                    selectedKeys: activeTabId ? [activeTabId] : [],
                    className: "app-tabbar-overflow-menu",
                    onClick: ({ key }) => {
                      setOverflowMenuOpen(false);
                      if (!useAuxiliaryDockStore.getState().tabs.some((item) => item.id === key)) return;
                      activateTab(key);
                      revealTab(key);
                    },
                  }}
                >
                  <Tooltip title={t("tabBar.allTabs")} mouseEnterDelay={0.4}>
                    <button
                      type="button"
                      aria-label={t("tabBar.allTabs")}
                      aria-haspopup="menu"
                      aria-expanded={overflowMenuOpen}
                      className="app-tabbar-mode-button app-tabbar-overflow-button"
                    >
                      <DownOutlined />
                    </button>
                  </Tooltip>
                </Dropdown>
              </div>
            )}
            {isActiveFileTab && activeTab ? (
              <div
                className="ml-auto shrink-0 flex items-center gap-0.5 pr-2"
                style={{ minHeight: 36 }}
              >
                {isActiveMarkdownTab ? (
                  <>
                    <MarkdownModeButtons
                      mode={activeMarkdownViewMode}
                      onChange={(mode) => setTabMarkdownViewMode(activeTab.id, mode)}
                    />
                    <span className="mx-1 h-3.5 w-px bg-[var(--cs-border-sidebar)]" aria-hidden="true" />
                  </>
                ) : null}
                <Tooltip title={t("auxiliaryDock.openInWorkspace")} mouseEnterDelay={0.4}>
                  <button
                    type="button"
                    className="app-tabbar-mode-button"
                    aria-label={t("auxiliaryDock.openInWorkspace")}
                    onClick={() => {
                      void moveToWorkspace(activeTab).catch((error) => message.error(String(error)));
                    }}
                  >
                    <ExportOutlined />
                  </button>
                </Tooltip>
                <Tooltip title={t("common.openInAssociatedApp")} mouseEnterDelay={0.4}>
                  <button
                    type="button"
                    className="app-tabbar-mode-button"
                    aria-label={t("common.openInAssociatedApp")}
                    onClick={() => {
                      void openInAssociatedApplication(activeTab.resourceId).catch((error) => message.error(String(error)));
                    }}
                  >
                    <FolderOpenOutlined />
                  </button>
                </Tooltip>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1" style={{ background: "transparent" }}>
          {!activeTab ? (
            <div className="flex h-full items-center justify-center px-8">
              <div className="w-full max-w-72 space-y-1">
                <button
                  type="button"
                  className="app-auxiliary-launcher-action"
                  onClick={() => setFilePickerOpen(true)}
                >
                  <FolderOpenOutlined />
                  <span>{t("auxiliaryDock.file")}</span>
                </button>
                <button
                  type="button"
                  className="app-auxiliary-launcher-action"
                  onClick={onRequestTask}
                >
                  <RobotOutlined />
                  <span>{t("auxiliaryDock.sideTask")}</span>
                </button>
                <button
                  type="button"
                  className="app-auxiliary-launcher-action"
                  onClick={onRequestTerminal}
                >
                  <CodeOutlined />
                  <span>{t("auxiliaryDock.terminal")}</span>
                </button>
                <button
                  type="button"
                  className="app-auxiliary-launcher-action"
                  onClick={() =>
                    openTaskMonitor({
                      title: t("taskMonitor.title"),
                      projectPath: currentProject?.path ?? "",
                    })
                  }
                >
                  <FileSearchOutlined />
                  <span>{t("taskMonitor.title")}</span>
                </button>
              </div>
            </div>
          ) : null}
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const session = sessions.find((item) => item.id === tab.resourceId) ?? null;
            return (
              <div
                key={tab.id}
                style={{ display: active ? "block" : "none", position: "absolute", inset: 0 }}
              >
                {tab.kind === "terminal" || tab.kind === "task" ? (
                  session ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="relative min-h-0 flex-1">
                        <Suspense
                          fallback={(
                            <div className="flex h-full items-center justify-center">
                              <Spin size="small" />
                            </div>
                          )}
                        >
                          <Terminal
                            sessionId={session.id}
                            allowIndependentFocus={open && active}
                            onExit={() => updateSession(session.id, { active: false })}
                            onClose={() => void handleCloseTab(tab)}
                          />
                        </Suspense>
                      </div>
                    </div>
                  ) : (
                    <Empty className="mt-16" description={t("auxiliaryDock.sessionUnavailable")} />
                  )
                ) : tab.kind === "file" ? (
                  <ErrorBoundary key={`${tab.projectPath}:${tab.resourceId}`} scope={`auxiliary:${tab.id}`} onClose={() => void handleCloseTab(tab)}>
                  <Suspense
                    fallback={(
                      <div className="flex h-full items-center justify-center">
                        <Spin size="small" />
                      </div>
                    )}
                  >
                    <AuxiliaryFileView
                      projectPath={tab.projectPath}
                      path={tab.resourceId}
                      active={active}
                      markdownViewMode={tab.markdownViewMode ?? "preview"}
                      onMarkdownViewModeChange={(mode) => setTabMarkdownViewMode(tab.id, mode)}
                    />
                  </Suspense>
                  </ErrorBoundary>
                ) : (
                  <TaskMonitorPanel active={open && active} embedded />
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <Modal
        centered
        open={pendingClose.length > 0}
        title={t("auxiliaryDock.closeProcessesTitle")}
        confirmLoading={closing}
        onCancel={() => { if (!closing) setPendingClose([]); }}
        onOk={() => {
          setClosing(true);
          void closeTabs(pendingClose).catch((error) => message.error(String(error))).finally(() => {
            setClosing(false);
            setPendingClose([]);
          });
        }}
      >
        {t("auxiliaryDock.closeProcessesDescription")}
      </Modal>
      <Modal
        centered
        open={filePickerOpen}
        title={t("auxiliaryDock.openFile")}
        footer={null}
        destroyOnHidden
        onCancel={() => setFilePickerOpen(false)}
      >
        <Input
          autoFocus
          allowClear
          value={fileQuery}
          placeholder={t("auxiliaryDock.filePlaceholder")}
          onChange={(event) => setFileQuery(event.target.value)}
        />
        <div className="mt-3 max-h-96 overflow-y-auto">
          {fileSearching ? (
            <div className="flex h-24 items-center justify-center"><Spin /></div>
          ) : !fileQuery.trim() ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("auxiliaryDock.fileHint")} />
          ) : fileResults.length === 0 ? (
            <div className="px-4 py-4 text-center text-sm text-[var(--cs-text-secondary)]">
              {t("auxiliaryDock.noFiles")}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--cs-border)]">
              {fileResults.map((item) => (
                <li key={item.path}>
                  <button
                    type="button"
                    className="flex w-full items-center px-4 py-2 text-left hover:bg-[var(--cs-bg-hover)]"
                    onClick={() => {
                      if (!currentProject) return;
                      openFile({ projectPath: currentProject.path, path: item.path, preview: true });
                      setFilePickerOpen(false);
                      setFileQuery("");
                    }}
                  >
                    <span className="truncate text-xs" title={item.path}>{item.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
