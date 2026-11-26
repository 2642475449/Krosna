import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Dropdown, Input, message, Modal, Popover, Tooltip, type InputRef } from "antd";
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
  PlusOutlined,
  SearchOutlined,
  SwapOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  gitCreateBranch,
  gitCreateWorktree,
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
 * 悬浮展示分支列表，支持即时筛选、快速创建、切换、删除、合并，
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
  const { branches, loading, error } = useGitBranchesStore(
    (s) => s.entries[projectPath ?? ""] ?? EMPTY_GIT_BRANCHES,
  );
  const refreshBranches = useGitBranchesStore((s) => s.refresh);
  const busy = useGitRemoteStore((s) => !!s.busy[projectPath ?? ""]);
  const blocked = disabled || busy || loading;
  const searchInputRef = useRef<InputRef>(null);
  const optionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [deleteTargetBranch, setDeleteTargetBranch] = useState<string | null>(null);
  const [operatingBranch, setOperatingBranch] = useState<string | null>(null);
  const [openingWorktreePath, setOpeningWorktreePath] = useState<string | null>(null);
  const [pendingWorktreePath, setPendingWorktreePath] = useState<string | null>(null);
  const [rememberWorktreeOpenChoice, setRememberWorktreeOpenChoice] = useState(false);
  const [worktreeOpeningChoice, setWorktreeOpeningChoice] = useState<
    "current_window" | "new_window" | null
  >(null);
  const [worktreeOpenError, setWorktreeOpenError] = useState<string | null>(null);

  const loadBranches = useCallback(async () => {
    if (projectPath) await refreshBranches(projectPath);
  }, [projectPath, refreshBranches]);

  useEffect(() => {
    if (visible && !busy) {
      void loadBranches();
    }
  }, [visible, currentBranch, busy, loadBranches]);

  useEffect(() => {
    if (visible) {
      void setOpenProjectWindows();
      const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    setQuery("");
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
        message.success(t("sidebar.gitBranchWorktreePathCopied"));
      } catch {
        message.error(t("common.copy"));
      }
    },
    [t],
  );

  // 创建分支
  const handleCreateBranch = useCallback(
    async (branchNameToCreate: string) => {
      const trimmed = branchNameToCreate.trim();
      if (!projectPath || !trimmed || disabled || useGitRemoteStore.getState().busy[projectPath]) {
        return;
      }
      useGitRemoteStore.getState().setBusy(projectPath, "branch");
      setCreating(true);
      try {
        await gitCreateBranch(projectPath, trimmed);
        message.success(t("sidebar.gitBranchCreateSuccess"));
        setQuery("");
        await loadBranches();
        await refreshGitStateAndGraph(projectPath, onBranchChanged);
      } catch (e) {
        message.error(
          `${t("sidebar.gitBranchCreateFailed")}: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setCreating(false);
        useGitRemoteStore.getState().setBusy(projectPath, null);
      }
    },
    [projectPath, disabled, loadBranches, onBranchChanged, t],
  );

  // 创建工作树（同时创建对应分支）并引导打开
  const handleCreateWorktree = useCallback(
    async (branchNameToCreate: string) => {
      const trimmed = branchNameToCreate.trim();
      if (!projectPath || !trimmed || disabled || useGitRemoteStore.getState().busy[projectPath]) {
        return;
      }
      useGitRemoteStore.getState().setBusy(projectPath, "branch");
      setCreatingWorktree(true);
      try {
        const createdPath = await gitCreateWorktree(projectPath, trimmed);
        message.success(t("sidebar.gitBranchWorktreeCreateSuccess"));
        setQuery("");
        await loadBranches();
        await refreshGitStateAndGraph(projectPath, onBranchChanged);
        if (createdPath) {
          requestOpenWorktreeProject(createdPath);
        }
      } catch (e) {
        message.error(
          `${t("sidebar.gitBranchWorktreeCreateFailed")}: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setCreatingWorktree(false);
        useGitRemoteStore.getState().setBusy(projectPath, null);
      }
    },
    [projectPath, disabled, loadBranches, onBranchChanged, requestOpenWorktreeProject, t],
  );

  // 切换分支
  const handleSwitchBranch = useCallback(
    async (name: string) => {
      if (!projectPath || disabled || useGitRemoteStore.getState().busy[projectPath]) return;
      useGitRemoteStore.getState().setBusy(projectPath, "branch");
      setOperatingBranch(name);
      try {
        await gitSwitchBranch(projectPath, name);
        message.success(t("sidebar.gitBranchSwitchSuccess", { name }));
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

  // 删除分支
  const handleDeleteBranch = useCallback(
    async (name: string, force = false) => {
      if (!projectPath || disabled || useGitRemoteStore.getState().busy[projectPath]) return;
      useGitRemoteStore.getState().setBusy(projectPath, "branch");
      setOperatingBranch(name);
      try {
        await gitDeleteBranch(projectPath, name, force);
        message.success(t("sidebar.gitBranchDeleteSuccess"));
        await loadBranches();
        await refreshGitStateAndGraph(projectPath, onBranchChanged);
      } catch (e) {
        message.error(
          `${t("sidebar.gitBranchDeleteFailed")}: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        setOperatingBranch(null);
        useGitRemoteStore.getState().setBusy(projectPath, null);
        setDeleteTargetBranch(null);
      }
    },
    [projectPath, disabled, loadBranches, onBranchChanged, t],
  );

  // 合并分支
  const handleMergeBranch = useCallback(
    async (name: string) => {
      if (!projectPath || disabled || useGitRemoteStore.getState().busy[projectPath]) return;
      useGitRemoteStore.getState().setBusy(projectPath, "branch");
      setOperatingBranch(name);
      try {
        const result = await gitMergeBranch(projectPath, name);
        if (result.success) {
          message.success(t("sidebar.gitMergeSuccess"));
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

  // 先关闭 Popover 再打开删除确认弹窗，避免浮层叠层冲突。
  const requestDeleteBranch = useCallback(
    (branchName: string) => {
      onVisibleChange(false);
      window.setTimeout(() => setDeleteTargetBranch(branchName), 0);
    },
    [onVisibleChange],
  );

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

  const trimmedQuery = query.trim();

  const { localBranches, worktreeBranches, remoteBranches, canQuickCreate } = useMemo(
    () => partitionGitBranches(branches, query),
    [branches, query],
  );

  type SelectableItem =
    | { id: string; kind: "create"; name: string }
    | { id: string; kind: "create-worktree"; name: string }
    | { id: string; kind: "local"; branch: GitBranchListItem }
    | { id: string; kind: "worktree"; branch: GitBranchListItem }
    | { id: string; kind: "remote"; branch: GitBranchListItem };

  const selectableItems = useMemo<SelectableItem[]>(() => {
    const items: SelectableItem[] = [];
    if (canQuickCreate) {
      items.push({ id: "git-branch-option-create", kind: "create", name: trimmedQuery });
      items.push({
        id: "git-branch-option-create-worktree",
        kind: "create-worktree",
        name: trimmedQuery,
      });
    }
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
  }, [canQuickCreate, localBranches, remoteBranches, trimmedQuery, worktreeBranches]);

  const itemIndexById = useMemo(() => {
    const map = new Map<string, number>();
    selectableItems.forEach((item, index) => {
      map.set(item.id, index);
    });
    return map;
  }, [selectableItems]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, visible]);

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
      if (item.kind === "create") {
        if (!blocked && !creating && !creatingWorktree) {
          void handleCreateBranch(item.name);
        }
        return;
      }
      if (item.kind === "create-worktree") {
        if (!blocked && !creating && !creatingWorktree) {
          void handleCreateWorktree(item.name);
        }
        return;
      }
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
      creating,
      creatingWorktree,
      handleCreateBranch,
      handleCreateWorktree,
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
      <div className="git-branch-popover-search">
        <Input
          ref={searchInputRef}
          size="small"
          allowClear
          role="combobox"
          aria-expanded={visible}
          aria-controls="git-branch-listbox"
          aria-activedescendant={activeOption?.id}
          value={query}
          prefix={<SearchOutlined className="text-[var(--cs-text-tertiary)]" />}
          placeholder={t("sidebar.gitBranchSearchPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              moveActiveIndex(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              moveActiveIndex(-1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              activateSelectableItem(activeOption);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onVisibleChange(false);
            }
          }}
        />
      </div>

      {canQuickCreate && (
        <div className="shrink-0 border-b border-[var(--cs-overlay-divider)] p-1.5">
          <div
            ref={(el) => {
              optionRefs.current["git-branch-option-create"] = el;
            }}
            id="git-branch-option-create"
            role="option"
            aria-selected={activeOption?.id === "git-branch-option-create"}
            data-highlighted={activeOption?.id === "git-branch-option-create" ? "true" : "false"}
            className="git-branch-row"
            onMouseEnter={() => {
              const idx = itemIndexById.get("git-branch-option-create");
              if (idx !== undefined) setActiveIndex(idx);
            }}
          >
            <button
              type="button"
              className="git-branch-row-main"
              disabled={blocked || creating || creatingWorktree}
              onClick={() => void handleCreateBranch(trimmedQuery)}
            >
              {creating ? (
                <LoadingOutlined className="text-[12px] text-[var(--cs-primary)]" />
              ) : (
                <PlusOutlined className="text-[12px] text-[var(--cs-primary)]" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--cs-primary)]">
                {t("sidebar.gitBranchCreateFromQuery", { name: trimmedQuery })}
              </span>
            </button>
          </div>
          <div
            ref={(el) => {
              optionRefs.current["git-branch-option-create-worktree"] = el;
            }}
            id="git-branch-option-create-worktree"
            role="option"
            aria-selected={activeOption?.id === "git-branch-option-create-worktree"}
            data-highlighted={
              activeOption?.id === "git-branch-option-create-worktree" ? "true" : "false"
            }
            className="git-branch-row"
            onMouseEnter={() => {
              const idx = itemIndexById.get("git-branch-option-create-worktree");
              if (idx !== undefined) setActiveIndex(idx);
            }}
          >
            <button
              type="button"
              className="git-branch-row-main"
              disabled={blocked || creating || creatingWorktree}
              onClick={() => void handleCreateWorktree(trimmedQuery)}
            >
              {creatingWorktree ? (
                <LoadingOutlined className="text-[12px] text-[var(--cs-primary)]" />
              ) : (
                <FolderOutlined className="text-[12px] text-[var(--cs-primary)]" />
              )}
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--cs-primary)]">
                {t("sidebar.gitBranchCreateWorktreeFromQuery", { name: trimmedQuery })}
              </span>
            </button>
          </div>
        </div>
      )}

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
        id="git-branch-listbox"
        role="listbox"
        className="app-project-tree-scroll min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {loading && branches.length === 0 ? (
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
                          {operatingBranch === branch.name ? (
                            <LoadingOutlined className="shrink-0 text-[12px] text-[var(--cs-primary)]" />
                          ) : branch.isCurrent ? (
                            <CheckOutlined className="shrink-0 text-[12px] text-[var(--cs-primary)]" />
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
                        </button>
                        {!branch.isCurrent && (
                          <div className="git-branch-row-actions">
                            <Tooltip title={t("sidebar.gitDeleteBranch")} mouseEnterDelay={0.4}>
                              <Button
                                type="text"
                                size="small"
                                aria-label={t("sidebar.gitDeleteBranch")}
                                icon={<DeleteOutlined className="text-[12px]" />}
                                className="h-5 w-5 min-w-5 p-0 text-[var(--cs-text-tertiary)]"
                                disabled={blocked}
                                loading={operatingBranch === branch.name}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestDeleteBranch(branch.name);
                                }}
                              />
                            </Tooltip>
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
                  {trimmedQuery ? t("sidebar.gitBranchNoMatch") : t("sidebar.gitBranchEmpty")}
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

      <Modal
        centered
        title={t("sidebar.gitDeleteBranch")}
        open={deleteTargetBranch !== null}
        okText={t("common.delete")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
        confirmLoading={operatingBranch === deleteTargetBranch}
        onOk={() => {
          if (deleteTargetBranch) {
            void handleDeleteBranch(deleteTargetBranch, false);
          }
        }}
        onCancel={() => {
          if (operatingBranch) return;
          setDeleteTargetBranch(null);
        }}
      >
        <p>
          {t("sidebar.gitBranchDeleteConfirm", {
            name: deleteTargetBranch ?? "",
          })}
        </p>
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
