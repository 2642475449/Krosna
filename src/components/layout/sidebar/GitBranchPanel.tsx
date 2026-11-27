import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Dropdown, message, Modal, Popover } from "antd";
import type { MenuProps } from "antd";
import {
  BranchesOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  LoadingOutlined,
  MergeOutlined,
  SwapOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  gitSwitchBranch,
  gitDeleteBranch,
  gitMergeBranch,
  openInFileManager,
} from "@/lib/api";
import { useProjectLauncher } from "@/hooks/useProjectLauncher";
import { formatWorktreeDisplayPath, partitionGitBranches } from "@/lib/gitBranchWorktree";
import { refreshGitStateAndGraph } from "@/lib/gitGraphEvents";
import { projectPathKey } from "@/lib/openProjects";
import { isSessionTurnRunning } from "@/lib/sessions";
import { showWorkbenchFeedback } from "@/lib/workbenchFeedback";
import { useAppStore } from "@/store";
import { EMPTY_GIT_BRANCHES, useGitBranchesStore } from "@/store/slices/gitBranches";
import { useGitRemoteStore } from "@/store/slices/gitRemote";
import { useOpenProjectsStore } from "@/store/slices/openProjects";
import type { GitBranchListItem, ProjectOpenDisposition } from "@/types";

interface GitBranchPanelProps {
  disabled?: boolean;
  /** 当前项目路径 */
  projectPath: string | null;
  /** 当前分支名称 */
  currentBranch: string;
  /** 面板是否可见 */
  visible: boolean;
  /** 切换可见状态 */
  onVisibleChange: (visible: boolean) => void;
  /** 分支操作完成后回调 */
  onBranchChanged: () => Promise<void>;
  /** 浮层弹出方向，默认向下左对齐 */
  placement?: "bottomLeft" | "topLeft" | "topRight";
  /** 触发按钮 */
  children: ReactNode;
}

function isRemoteHeadBranch(name: string) {
  return /\/HEAD$/.test(name);
}

/**
 * Git 分支切换浮层（Popover）
 *
 * 悬浮展示分支列表，支持切换、删除、合并，
 * 以及其他 worktree 占用分支的状态标识与路径引导。
 */
export function GitBranchPanel({
  projectPath,
  currentBranch,
  disabled = false,
  visible,
  onVisibleChange,
  onBranchChanged,
  placement = "bottomLeft",
  children,
}: GitBranchPanelProps) {
  const { t } = useTranslation();
  const { openProject } = useProjectLauncher();
  const projectOpenBehavior = useAppStore((s) => s.projectOpenBehavior);
  const setProjectOpenBehavior = useAppStore((s) => s.setProjectOpenBehavior);
  const hasActiveContext = useAppStore(
    (s) =>
      s.sessions.some(isSessionTurnRunning) ||
      Object.values(s.tabsById).some((tab) => tab.dirty),
  );
  const projectWindows = useOpenProjectsStore((s) => s.windows);
  const setOpenProjectWindows = useOpenProjectsStore((s) => s.setOpenProjectWindows);
  const { branches, loading, error, updatedAt } = useGitBranchesStore(
    (s) => s.entries[projectPath ?? ""] ?? EMPTY_GIT_BRANCHES,
  );
  const refreshBranches = useGitBranchesStore((s) => s.refresh);
  const busy = useGitRemoteStore((s) => !!s.busy[projectPath ?? ""]);
  const blocked = disabled || busy;
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [activeIndex, setActiveIndex] = useState(0);
  const [confirmDeleteBranch, setConfirmDeleteBranch] = useState<string | null>(null);
  const [operatingBranch, setOperatingBranch] = useState<string | null>(null);
  const [openingWorktreePath, setOpeningWorktreePath] = useState<string | null>(null);
  const [pendingWorktreePath, setPendingWorktreePath] = useState<string | null>(null);
  const [rememberWorktreeOpenChoice, setRememberWorktreeOpenChoice] = useState(false);
  const [worktreeOpeningChoice, setWorktreeOpeningChoice] = useState<
    "current_window" | "new_window" | null
  >(null);
  const [worktreeOpenError, setWorktreeOpenError] = useState<string | null>(null);

  const loadBranches = useCallback(async (force = true) => {
    if (projectPath) await refreshBranches(projectPath, { force });
  }, [projectPath, refreshBranches]);

  useEffect(() => {
    // Warm the project cache before the first click; reopening still checks its TTL.
    if (!busy) {
      void loadBranches(false);
    }
  }, [visible, currentBranch, busy, loadBranches]);

  useEffect(() => {
    if (visible) {
      setConfirmDeleteBranch(null);
      void setOpenProjectWindows();
      const timer = window.setTimeout(() => listboxRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    setConfirmDeleteBranch(null);
  }, [setOpenProjectWindows, visible]);

  const handleOpenWorktreeProject = useCallback(
    async (worktreePath: string, disposition: ProjectOpenDisposition = "auto") => {
      if (openingWorktreePath === worktreePath) return;
      setOpeningWorktreePath(worktreePath);
      try {
        await openProject(worktreePath, disposition);
        onVisibleChange(false);
      } catch {
        message.error(t("sidebar.projectWindowOpenFailed"));
      } finally {
        setOpeningWorktreePath((prev) => (prev === worktreePath ? null : prev));
      }
    },
    [onVisibleChange, openProject, openingWorktreePath, t],
  );

  // 点击工作树时优先复用已打开窗口，否则按打开偏好直接打开或先关闭 Popover 再弹出窗口选择框。
  const requestOpenWorktreeProject = useCallback(
    (worktreePath: string) => {
      onVisibleChange(false);

      const alreadyOpen = projectWindows.some(
        (win) => win.projectPath && projectPathKey(win.projectPath) === projectPathKey(worktreePath),
      );
      if (alreadyOpen) {
        void handleOpenWorktreeProject(worktreePath, "new_window");
        return;
      }

      const state = useAppStore.getState();
      const hasRunningSessions = state.sessions.some(isSessionTurnRunning);
      const hasDirtyFiles = Object.values(state.tabsById).some((tab) => tab.dirty);
      if (
        projectOpenBehavior === "ask" ||
        (projectOpenBehavior === "current_window" && (hasRunningSessions || hasDirtyFiles))
      ) {
        window.setTimeout(() => {
          setRememberWorktreeOpenChoice(false);
          setWorktreeOpenError(null);
          setPendingWorktreePath(worktreePath);
        }, 0);
        return;
      }

      void handleOpenWorktreeProject(worktreePath, projectOpenBehavior);
    },
    [handleOpenWorktreeProject, onVisibleChange, projectOpenBehavior, projectWindows],
  );

  const confirmWorktreeOpen = useCallback(
    async (choice: "current_window" | "new_window") => {
      if (!pendingWorktreePath || worktreeOpeningChoice !== null) return;
      setWorktreeOpeningChoice(choice);
      setWorktreeOpenError(null);
      try {
        await openProject(pendingWorktreePath, choice);
        if (rememberWorktreeOpenChoice) {
          setProjectOpenBehavior(choice);
        }
        setPendingWorktreePath(null);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setWorktreeOpenError(`${t("sidebar.projectWindowOpenFailed")}: ${detail}`);
      } finally {
        setWorktreeOpeningChoice(null);
      }
    },
    [
      openProject,
      pendingWorktreePath,
      rememberWorktreeOpenChoice,
      setProjectOpenBehavior,
      t,
      worktreeOpeningChoice,
    ],
  );

  useEffect(() => {
    if (!pendingWorktreePath) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (worktreeOpeningChoice !== null) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "t") {
        event.preventDefault();
        event.stopPropagation();
        void confirmWorktreeOpen("current_window");
      } else if (key === "w") {
        event.preventDefault();
        event.stopPropagation();
        void confirmWorktreeOpen("new_window");
      } else if (key === "d") {
        event.preventDefault();
        event.stopPropagation();
        setRememberWorktreeOpenChoice((checked) => !checked);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [confirmWorktreeOpen, pendingWorktreePath, worktreeOpeningChoice]);

  const handleRevealWorktree = useCallback(
    async (worktreePath: string) => {
      try {
        await openInFileManager(worktreePath);
        onVisibleChange(false);
      } catch {
        message.error(t("common.openInFileManager", { defaultValue: "在文件管理器中打开" }));
      }
    },
    [onVisibleChange, t],
  );

  const handleCopyWorktreePath = useCallback(
    async (worktreePath: string) => {
      try {
        await navigator.clipboard.writeText(worktreePath);
        showWorkbenchFeedback(t("sidebar.gitBranchWorktreePathCopied"));
      } catch {
        message.error(t("common.copy"));
      }
    },
    [t],
  );

  // 切换分支：成功后状态栏即时更新不弹 Toast；仅在失败时用全局错误提示。
  const handleSwitchBranch = useCallback(
    async (name: string) => {
      if (!projectPath || disabled || useGitRemoteStore.getState().busy[projectPath]) return;
      useGitRemoteStore.getState().setBusy(projectPath, "branch");
      setOperatingBranch(name);
      setConfirmDeleteBranch(null);
      try {
        await gitSwitchBranch(projectPath, name);
        onVisibleChange(false);
        await loadBranches();
        await refreshGitStateAndGraph(projectPath, onBranchChanged);
      } catch (e) {
        message.error(
          `${t("sidebar.gitBranchSwitchFailed")}: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setOperatingBranch(null);
        useGitRemoteStore.getState().setBusy(projectPath, null);
      }
    },
    [projectPath, disabled, loadBranches, onBranchChanged, onVisibleChange, t],
  );

  // 删除分支：行内确认后直接执行，成功后列表即时移除不弹 Toast；失败时全局错误提示。
  const handleDeleteBranch = useCallback(
    async (name: string, force = false) => {
      if (!projectPath || disabled || useGitRemoteStore.getState().busy[projectPath]) return;
      useGitRemoteStore.getState().setBusy(projectPath, "branch");
      setOperatingBranch(name);
      try {
        await gitDeleteBranch(projectPath, name, force);
        setConfirmDeleteBranch(null);
        await loadBranches();
        await refreshGitStateAndGraph(projectPath, onBranchChanged);
      } catch (e) {
        setConfirmDeleteBranch(null);
        message.error(
          `${t("sidebar.gitBranchDeleteFailed")}: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setOperatingBranch(null);
        useGitRemoteStore.getState().setBusy(projectPath, null);
      }
    },
    [projectPath, disabled, loadBranches, onBranchChanged, t],
  );

  // 合并分支：成功后静默反馈；失败时全局错误提示。
  const handleMergeBranch = useCallback(
    async (name: string) => {
      if (!projectPath || disabled || useGitRemoteStore.getState().busy[projectPath]) return;
      useGitRemoteStore.getState().setBusy(projectPath, "branch");
      setOperatingBranch(name);
      setConfirmDeleteBranch(null);
      try {
        const result = await gitMergeBranch(projectPath, name);
        if (result.success) {
          showWorkbenchFeedback(t("sidebar.gitMergeSuccess"));
          onVisibleChange(false);
        } else {
          message.error(`${t("sidebar.gitMergeFailed")}: ${result.message}`);
        }
        await loadBranches();
        await refreshGitStateAndGraph(projectPath, onBranchChanged);
      } catch (e) {
        message.error(
          `${t("sidebar.gitMergeFailed")}: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setOperatingBranch(null);
        useGitRemoteStore.getState().setBusy(projectPath, null);
      }
    },
    [projectPath, disabled, loadBranches, onBranchChanged, onVisibleChange, t],
  );

  // 就地进入行内二次确认，保持 Popover 打开避免弹窗打断。
  const requestDeleteBranch = useCallback((branchName: string) => {
    setConfirmDeleteBranch(branchName);
  }, []);

  const buildBranchMenu = useCallback(
    (branch: GitBranchListItem): MenuProps => {
      const items: NonNullable<MenuProps["items"]> = [];
      const worktreePath = branch.worktreePath ?? null;

      if (worktreePath) {
        items.push({
          key: "open-worktree-current-window",
          label: t("sidebar.gitBranchOpenWorktreeCurrentWindow"),
          icon: <SwapOutlined />,
        });
        items.push({
          key: "open-worktree-new-window",
          label: t("sidebar.gitBranchOpenWorktreeNewWindow"),
          icon: <ExportOutlined />,
        });
        items.push({
          key: "reveal-worktree",
          label: t("sidebar.gitBranchRevealWorktree"),
          icon: <FolderOpenOutlined />,
        });
        items.push({
          key: "copy-worktree",
          label: t("sidebar.gitBranchCopyWorktreePath"),
          icon: <CopyOutlined />,
        });
      } else if (!branch.isCurrent && !isRemoteHeadBranch(branch.name)) {
        items.push({
          key: "switch",
          label: branch.isRemote
            ? t("sidebar.gitCheckoutRemoteBranch", { defaultValue: "检出远程分支" })
            : t("sidebar.gitSwitchBranch"),
          icon: <SwapOutlined />,
        });
      }

      if (!branch.isCurrent && !branch.isRemote) {
        if (worktreePath) {
          items.push({ type: "divider" });
        }
        items.push({
          key: "merge",
          label: t("sidebar.gitMergeBranch"),
          icon: <MergeOutlined />,
        });
      }

      if (!branch.isCurrent && !branch.isRemote && !worktreePath) {
        items.push({ type: "divider" });
        items.push({
          key: "delete",
          label: t("sidebar.gitDeleteBranch"),
          icon: <DeleteOutlined />,
          danger: true,
        });
      }

      return {
        items: items.map((item) =>
          item && item.type !== "divider"
            ? {
                ...item,
                disabled:
                  item.key === "open-worktree-current-window" ||
                  item.key === "open-worktree-new-window"
                    ? openingWorktreePath === worktreePath
                    : item.key === "reveal-worktree" || item.key === "copy-worktree"
                      ? false
                      : blocked,
              }
            : item,
        ),
        onClick: ({ key }) => {
          switch (key) {
            case "open-worktree-current-window":
              if (worktreePath) void handleOpenWorktreeProject(worktreePath, "current_window");
              break;
            case "open-worktree-new-window":
              if (worktreePath) void handleOpenWorktreeProject(worktreePath, "new_window");
              break;
            case "reveal-worktree":
              if (worktreePath) void handleRevealWorktree(worktreePath);
              break;
            case "copy-worktree":
              if (worktreePath) void handleCopyWorktreePath(worktreePath);
              break;
            case "switch":
              void handleSwitchBranch(branch.name);
              break;
            case "merge":
              void handleMergeBranch(branch.name);
              break;
            case "delete":
              requestDeleteBranch(branch.name);
              break;
          }
        },
      };
    },
    [
      blocked,
      handleCopyWorktreePath,
      handleMergeBranch,
      handleOpenWorktreeProject,
      handleRevealWorktree,
      handleSwitchBranch,
      openingWorktreePath,
      requestDeleteBranch,
      t,
    ],
  );

  const { localBranches, worktreeBranches, remoteBranches } = useMemo(
    () => partitionGitBranches(branches, ""),
    [branches],
  );

  type SelectableItem =
    | { id: string; kind: "local"; branch: GitBranchListItem }
    | { id: string; kind: "worktree"; branch: GitBranchListItem }
    | { id: string; kind: "remote"; branch: GitBranchListItem };

  const selectableItems = useMemo<SelectableItem[]>(() => {
    const items: SelectableItem[] = [];
    for (const branch of localBranches) {
      items.push({ id: `git-branch-option-local-${branch.name}`, kind: "local", branch });
    }
    for (const branch of worktreeBranches) {
      items.push({ id: `git-branch-option-worktree-${branch.name}`, kind: "worktree", branch });
    }
    for (const branch of remoteBranches) {
      items.push({ id: `git-branch-option-remote-${branch.name}`, kind: "remote", branch });
    }
    return items;
  }, [localBranches, remoteBranches, worktreeBranches]);

  const itemIndexById = useMemo(() => {
    const map = new Map<string, number>();
    selectableItems.forEach((item, index) => {
      map.set(item.id, index);
    });
    return map;
  }, [selectableItems]);

  useEffect(() => {
    setActiveIndex(0);
  }, [visible]);

  useEffect(() => {
    if (selectableItems.length === 0) return;
    if (activeIndex >= selectableItems.length) {
      setActiveIndex(selectableItems.length - 1);
    }
  }, [activeIndex, selectableItems.length]);

  const activeOption = selectableItems[activeIndex] ?? null;

  const activateSelectableItem = useCallback(
    (item: SelectableItem | null) => {
      if (!item) return;
      if (item.kind === "worktree") {
        const worktreePath = item.branch.worktreePath?.trim();
        if (worktreePath) {
          requestOpenWorktreeProject(worktreePath);
        }
        return;
      }
      if (item.kind === "local") {
        if (!item.branch.isCurrent && !blocked) {
          void handleSwitchBranch(item.branch.name);
        }
        return;
      }
      if (item.kind === "remote" && !blocked) {
        void handleSwitchBranch(item.branch.name);
      }
    },
    [
      blocked,
      handleSwitchBranch,
      requestOpenWorktreeProject,
    ],
  );

  const moveActiveIndex = useCallback(
    (delta: number) => {
      if (selectableItems.length === 0) return;
      setActiveIndex((prev) => {
        const next = (prev + delta + selectableItems.length) % selectableItems.length;
        const nextItem = selectableItems[next];
        if (nextItem) {
          optionRefs.current[nextItem.id]?.scrollIntoView({ block: "nearest" });
        }
        return next;
      });
    },
    [selectableItems],
  );

  const popoverContent = (
    <div className="app-overlay-surface git-branch-popover-card">
      {error && (
        <div
          role="alert"
          className="min-w-0 shrink-0 border-b border-[var(--cs-overlay-divider)] px-3 py-2 text-xs text-[var(--cs-error)] [overflow-wrap:anywhere]"
        >
          {t("sidebar.gitRefreshFailed", { detail: error })}
          <Button type="link" size="small" onClick={() => void loadBranches()}>
            {t("sidebar.remoteActions.retry")}
          </Button>
        </div>
      )}

      <div
        ref={listboxRef}
        id="git-branch-listbox"
        role="listbox"
        aria-label={t("sidebar.gitBranchSwitchHint")}
        tabIndex={0}
        aria-activedescendant={activeOption?.id}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            if (confirmDeleteBranch) {
              setConfirmDeleteBranch(null);
            } else {
              onVisibleChange(false);
            }
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            moveActiveIndex(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            moveActiveIndex(-1);
          } else if (e.key === "Enter" && e.target === e.currentTarget) {
            e.preventDefault();
            activateSelectableItem(activeOption);
          }
        }}
        className="app-project-tree-scroll min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {loading && updatedAt === null ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[var(--cs-text-tertiary)]">
            <LoadingOutlined />
            <span className="text-xs">{t("common.loading", { defaultValue: "加载中..." })}</span>
          </div>
        ) : (
          <>
            {localBranches.length > 0 && (
              <div>
                <div className="git-branch-section-label">
                  <span>{t("sidebar.gitLocalBranches")}</span>
                  <span className="git-branch-section-count">{localBranches.length}</span>
                </div>
                {localBranches.map((branch) => {
                  const optionId = `git-branch-option-local-${branch.name}`;
                  const isHighlighted = activeOption?.id === optionId;
                  const isConfirmingDelete = confirmDeleteBranch === branch.name;
                  const isDeleting = operatingBranch === branch.name;
                  return (
                    <Dropdown key={branch.name} trigger={["contextMenu"]} menu={buildBranchMenu(branch)}>
                      <div
                        ref={(el) => {
                          optionRefs.current[optionId] = el;
                        }}
                        id={optionId}
                        role="option"
                        aria-selected={isHighlighted}
                        className="git-branch-row group"
                        data-current={branch.isCurrent ? "true" : "false"}
                        data-highlighted={isHighlighted ? "true" : "false"}
                        data-confirming={isConfirmingDelete ? "true" : "false"}
                        onMouseEnter={() => {
                          const idx = itemIndexById.get(optionId);
                          if (idx !== undefined) setActiveIndex(idx);
                        }}
                      >
                        <button
                          type="button"
                          className="git-branch-row-main"
                          disabled={blocked && !branch.isCurrent}
                          onClick={() => {
                            if (isConfirmingDelete) {
                              setConfirmDeleteBranch(null);
                              return;
                            }
                            if (!branch.isCurrent && !blocked) {
                              void handleSwitchBranch(branch.name);
                            }
                          }}
                        >
                          <BranchesOutlined
                            className={`shrink-0 text-[12px] ${
                              branch.isCurrent
                                ? "text-[var(--cs-primary)]"
                                : "text-[var(--cs-text-secondary)]"
                            }`}
                          />
                          <span
                            className={`git-branch-row-name ${
                              branch.isCurrent ? "font-semibold" : "font-normal"
                            }`}
                          >
                            {branch.name}
                          </span>
                          {isDeleting && !isConfirmingDelete ? (
                            <LoadingOutlined className="shrink-0 text-[12px] text-[var(--cs-primary)]" />
                          ) : branch.isCurrent ? (
                            <CheckOutlined className="shrink-0 text-[12px] text-[var(--cs-primary)]" />
                          ) : null}
                          {!isConfirmingDelete && branch.ahead > 0 && (
                            <span className="shrink-0 rounded-sm bg-[color-mix(in_srgb,var(--cs-success)_12%,transparent)] px-1 font-mono text-[10px] tabular-nums text-[var(--cs-success)]">
                              ↑{branch.ahead}
                            </span>
                          )}
                          {!isConfirmingDelete && branch.behind > 0 && (
                            <span className="shrink-0 rounded-sm bg-[color-mix(in_srgb,var(--cs-error)_12%,transparent)] px-1 font-mono text-[10px] tabular-nums text-[var(--cs-error)]">
                              ↓{branch.behind}
                            </span>
                          )}
                        </button>
                        {!branch.isCurrent && (
                          <div className="git-branch-row-actions">
                            {isConfirmingDelete ? (
                              <>
                                <button
                                  type="button"
                                  className="git-branch-inline-confirm-btn"
                                  disabled={blocked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDeleteBranch(branch.name, false);
                                  }}
                                >
                                  {isDeleting ? <LoadingOutlined className="text-[12px]" /> : t("common.delete")}
                                </button>
                                <button
                                  type="button"
                                  className="git-branch-inline-cancel-btn"
                                  disabled={isDeleting}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmDeleteBranch(null);
                                  }}
                                >
                                  {t("common.cancel")}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                aria-label={t("sidebar.gitDeleteBranch")}
                                className="git-branch-row-delete-btn"
                                disabled={blocked}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestDeleteBranch(branch.name);
                                }}
                              >
                                <DeleteOutlined className="text-[12px]" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </Dropdown>
                  );
                })}
              </div>
            )}

            {worktreeBranches.length > 0 && (
              <div className={localBranches.length > 0 ? "mt-1" : undefined}>
                <div className="git-branch-section-label">
                  <span>{t("sidebar.gitWorktreeBranches")}</span>
                  <span className="git-branch-section-count">{worktreeBranches.length}</span>
                </div>
                {worktreeBranches.map((branch) => {
                  const worktreePath = branch.worktreePath ?? "";
                  const displayPath = formatWorktreeDisplayPath(worktreePath, projectPath);
                  const isOpening = openingWorktreePath === worktreePath;
                  const optionId = `git-branch-option-worktree-${branch.name}`;
                  const isHighlighted = activeOption?.id === optionId;
                  return (
                    <Dropdown
                      key={branch.name}
                      trigger={["contextMenu"]}
                      menu={buildBranchMenu(branch)}
                    >
                      <div
                        ref={(el) => {
                          optionRefs.current[optionId] = el;
                        }}
                        id={optionId}
                        role="option"
                        aria-selected={isHighlighted}
                        className="git-branch-row git-branch-worktree-row group"
                        data-worktree="true"
                        data-highlighted={isHighlighted ? "true" : "false"}
                        onMouseEnter={() => {
                          const idx = itemIndexById.get(optionId);
                          if (idx !== undefined) setActiveIndex(idx);
                        }}
                      >
                        <button
                          type="button"
                          className="git-branch-row-main"
                          onClick={() => {
                            if (worktreePath) {
                              requestOpenWorktreeProject(worktreePath);
                            }
                          }}
                        >
                          <FolderOutlined className="mt-0.5 shrink-0 text-[12px] text-[var(--cs-text-secondary)] group-hover:text-[var(--cs-primary)]" />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="git-branch-row-name font-medium">{branch.name}</span>
                              {isOpening ? (
                                <LoadingOutlined className="shrink-0 text-[12px] text-[var(--cs-primary)]" />
                              ) : null}
                              {branch.ahead > 0 && (
                                <span className="shrink-0 rounded-sm bg-[color-mix(in_srgb,var(--cs-success)_12%,transparent)] px-1 font-mono text-[10px] tabular-nums text-[var(--cs-success)]">
                                  ↑{branch.ahead}
                                </span>
                              )}
                              {branch.behind > 0 && (
                                <span className="shrink-0 rounded-sm bg-[color-mix(in_srgb,var(--cs-error)_12%,transparent)] px-1 font-mono text-[10px] tabular-nums text-[var(--cs-error)]">
                                  ↓{branch.behind}
                                </span>
                              )}
                            </div>
                            <div className="git-branch-worktree-subpath">{displayPath}</div>
                          </div>
                        </button>
                      </div>
                    </Dropdown>
                  );
                })}
              </div>
            )}

            {remoteBranches.length > 0 && (
              <div
                className={
                  localBranches.length > 0 || worktreeBranches.length > 0 ? "mt-1" : undefined
                }
              >
                <div className="git-branch-section-label">
                  <span>{t("sidebar.gitRemoteBranches")}</span>
                  <span className="git-branch-section-count">{remoteBranches.length}</span>
                </div>
                {remoteBranches.map((branch) => {
                  const canCheckout = !blocked && !isRemoteHeadBranch(branch.name);
                  const optionId = `git-branch-option-remote-${branch.name}`;
                  const isHighlighted = activeOption?.id === optionId;
                  return (
                    <Dropdown
                      key={branch.name}
                      trigger={["contextMenu"]}
                      menu={buildBranchMenu(branch)}
                      disabled={!canCheckout}
                    >
                      <div
                        ref={(el) => {
                          optionRefs.current[optionId] = el;
                        }}
                        id={optionId}
                        role="option"
                        aria-selected={isHighlighted}
                        className="git-branch-row"
                        data-disabled={canCheckout ? "false" : "true"}
                        data-highlighted={isHighlighted ? "true" : "false"}
                        onMouseEnter={() => {
                          const idx = itemIndexById.get(optionId);
                          if (idx !== undefined) setActiveIndex(idx);
                        }}
                      >
                        <button
                          type="button"
                          className="git-branch-row-main"
                          disabled={!canCheckout}
                          onClick={() => {
                            if (canCheckout) {
                              void handleSwitchBranch(branch.name);
                            }
                          }}
                        >
                          <BranchesOutlined className="shrink-0 text-[12px] text-[var(--cs-text-secondary)]" />
                          <span className="git-branch-row-name text-[var(--cs-text-secondary)]">
                            {branch.name}
                          </span>
                          {operatingBranch === branch.name ? (
                            <LoadingOutlined className="shrink-0 text-[12px] text-[var(--cs-text-tertiary)]" />
                          ) : null}
                        </button>
                      </div>
                    </Dropdown>
                  );
                })}
              </div>
            )}

            {localBranches.length === 0 &&
              worktreeBranches.length === 0 &&
              remoteBranches.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-[var(--cs-text-tertiary)]">
                <BranchesOutlined className="text-lg" />
                <span className="text-xs">
                  {t("sidebar.gitBranchEmpty")}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Popover
        trigger={["click"]}
        placement={placement}
        arrow={false}
        motion={{ motionName: "" }}
        open={visible}
        onOpenChange={onVisibleChange}
        classNames={{ root: "git-branch-popover-overlay" }}
        content={popoverContent}
      >
        {children}
      </Popover>

      <Modal
        open={pendingWorktreePath !== null}
        title={t("sidebar.gitBranchWorktreeOpenModalTitle")}
        centered
        width={520}
        destroyOnHidden
        closable={worktreeOpeningChoice === null}
        mask={{ closable: worktreeOpeningChoice === null }}
        keyboard={worktreeOpeningChoice === null}
        onCancel={() => {
          if (worktreeOpeningChoice === null) setPendingWorktreePath(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              autoFocus={!hasActiveContext}
              type={hasActiveContext ? "default" : "primary"}
              loading={worktreeOpeningChoice === "current_window"}
              disabled={worktreeOpeningChoice !== null}
              onClick={() => void confirmWorktreeOpen("current_window")}
            >
              {t("projectLauncher.openInCurrentWindow")}
            </Button>
            <Button
              autoFocus={hasActiveContext}
              type={hasActiveContext ? "primary" : "default"}
              loading={worktreeOpeningChoice === "new_window"}
              disabled={worktreeOpeningChoice !== null}
              onClick={() => void confirmWorktreeOpen("new_window")}
            >
              {t("projectLauncher.openInNewWindow")}
            </Button>
            <Button
              disabled={worktreeOpeningChoice !== null}
              onClick={() => setPendingWorktreePath(null)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        }
      >
        <div className="pt-1">
          <WorktreeOpenDescription
            worktreeName={
              pendingWorktreePath?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ||
              pendingWorktreePath ||
              ""
            }
          />
          <Checkbox
            className="mt-4"
            checked={rememberWorktreeOpenChoice}
            disabled={worktreeOpeningChoice !== null}
            onChange={(event) => setRememberWorktreeOpenChoice(event.target.checked)}
          >
            {t("projectLauncher.rememberOpenChoice")}
          </Checkbox>
          {worktreeOpenError ? (
            <div role="alert" className="mt-3 break-words text-sm text-[var(--cs-error)]">
              {worktreeOpenError}
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

function WorktreeOpenDescription({ worktreeName }: { worktreeName: string }) {
  const { t } = useTranslation();
  const runningSessionCount = useAppStore((state) =>
    state.sessions.filter(isSessionTurnRunning).length,
  );
  const dirtyFileCount = useAppStore(
    (state) => Object.values(state.tabsById).filter((tab) => tab.dirty).length,
  );

  if (runningSessionCount === 0 && dirtyFileCount === 0) {
    return (
      <div className="text-sm leading-5 text-[var(--cs-text-secondary)]">
        {t("sidebar.gitBranchWorktreeOpenQuestion", { name: worktreeName })}
      </div>
    );
  }

  const warning =
    runningSessionCount > 0 && dirtyFileCount > 0
      ? t("projectLauncher.currentWindowRunningAndDirtyWarning", {
          sessionCount: runningSessionCount,
          fileCount: dirtyFileCount,
        })
      : runningSessionCount > 0
        ? t("projectLauncher.currentWindowRunningSessionsWarning", { count: runningSessionCount })
        : t("projectLauncher.currentWindowUnsavedFilesWarning", { count: dirtyFileCount });

  return (
    <div className="flex items-center gap-2 text-sm leading-5 text-[var(--cs-warning)]">
      <WarningOutlined className="shrink-0" />
      <span>{warning}</span>
    </div>
  );
}
