import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dropdown, Input, message, Modal, Popover, Tooltip, type InputRef } from "antd";
import type { MenuProps } from "antd";
import {
  BranchesOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  MergeOutlined,
  PlusOutlined,
  SearchOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  gitCreateBranch,
  gitSwitchBranch,
  gitDeleteBranch,
  gitMergeBranch,
  openInFileManager,
} from "@/lib/api";
import { refreshGitStateAndGraph } from "@/lib/gitGraphEvents";
import { EMPTY_GIT_BRANCHES, useGitBranchesStore } from "@/store/slices/gitBranches";
import { useGitRemoteStore } from "@/store/slices/gitRemote";
import type { GitBranchListItem } from "@/types";

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
  children,
}: GitBranchPanelProps) {
  const { t } = useTranslation();
  const { branches, loading, error } = useGitBranchesStore(
    (s) => s.entries[projectPath ?? ""] ?? EMPTY_GIT_BRANCHES,
  );
  const refreshBranches = useGitBranchesStore((s) => s.refresh);
  const busy = useGitRemoteStore((s) => !!s.busy[projectPath ?? ""]);
  const blocked = disabled || busy || loading;
  const searchInputRef = useRef<InputRef>(null);

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTargetBranch, setDeleteTargetBranch] = useState<string | null>(null);
  const [operatingBranch, setOperatingBranch] = useState<string | null>(null);
  const [expandedWorktreeBranch, setExpandedWorktreeBranch] = useState<string | null>(null);

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
      const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    setQuery("");
    setExpandedWorktreeBranch(null);
  }, [visible]);

  const handleOpenWorktree = useCallback(
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
          key: "open-worktree",
          label: t("sidebar.gitBranchOpenWorktree"),
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
                  item.key === "open-worktree" || item.key === "copy-worktree"
                    ? false
                    : blocked,
              }
            : item,
        ),
        onClick: ({ key }) => {
          switch (key) {
            case "open-worktree":
              if (worktreePath) void handleOpenWorktree(worktreePath);
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
      handleOpenWorktree,
      handleSwitchBranch,
      requestDeleteBranch,
      t,
    ],
  );

  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  const { localBranches, remoteBranches, canQuickCreate } = useMemo(() => {
    const locals = branches.filter(
      (b) => !b.isRemote && (!normalizedQuery || b.name.toLowerCase().includes(normalizedQuery)),
    );
    const remotes = branches.filter(
      (b) => b.isRemote && (!normalizedQuery || b.name.toLowerCase().includes(normalizedQuery)),
    );
    const hasExactLocal =
      trimmedQuery.length > 0 &&
      branches.some((b) => !b.isRemote && b.name.toLowerCase() === normalizedQuery);
    return {
      localBranches: locals,
      remoteBranches: remotes,
      canQuickCreate: trimmedQuery.length > 0 && !hasExactLocal && !/\s/.test(trimmedQuery),
    };
  }, [branches, normalizedQuery, trimmedQuery]);

  const popoverContent = (
    <div className="app-overlay-surface git-branch-popover-card">
      <div className="git-branch-popover-search">
        <Input
          ref={searchInputRef}
          size="small"
          allowClear
          value={query}
          prefix={<SearchOutlined className="text-[var(--cs-text-tertiary)]" />}
          placeholder={t("sidebar.gitBranchSearchPlaceholder")}
          onChange={(e) => setQuery(e.target.value)}
          onPressEnter={() => {
            if (canQuickCreate && !blocked && !creating) {
              void handleCreateBranch(trimmedQuery);
            }
          }}
        />
      </div>

      {canQuickCreate && (
        <div className="shrink-0 border-b border-[var(--cs-overlay-divider)] p-1.5">
          <button
            type="button"
            className="git-branch-row w-full text-left"
            disabled={blocked || creating}
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

      <div className="app-project-tree-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
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
                  const worktreePath = branch.worktreePath ?? null;
                  const worktreeExpanded = expandedWorktreeBranch === branch.name;
                  return (
                    <div key={branch.name}>
                      <Dropdown trigger={["contextMenu"]} menu={buildBranchMenu(branch)}>
                        <div
                          className="git-branch-row group"
                          data-current={branch.isCurrent ? "true" : "false"}
                          data-worktree={worktreePath ? "true" : "false"}
                          onClick={() => {
                            if (worktreePath) {
                              setExpandedWorktreeBranch((prev) =>
                                prev === branch.name ? null : branch.name,
                              );
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
                          {operatingBranch === branch.name ? (
                            <LoadingOutlined className="shrink-0 text-[11px] text-[var(--cs-primary)]" />
                          ) : branch.isCurrent ? (
                            <CheckOutlined className="shrink-0 text-[11px] text-[var(--cs-primary)]" />
                          ) : null}
                          {worktreePath && (
                            <Tooltip
                              title={t("sidebar.gitBranchWorktreeOccupied", { path: worktreePath })}
                              mouseEnterDelay={0.3}
                            >
                              <span className="git-branch-worktree-tag">
                                <FolderOpenOutlined className="text-[10px]" />
                                <span>{t("sidebar.gitBranchWorktreeTag")}</span>
                              </span>
                            </Tooltip>
                          )}
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
                          {!branch.isCurrent && !worktreePath && (
                            <div className="hidden items-center gap-0.5 group-hover:flex">
                              <Tooltip title={t("sidebar.gitDeleteBranch")} mouseEnterDelay={0.4}>
                                <Button
                                  type="text"
                                  size="small"
                                  aria-label={t("sidebar.gitDeleteBranch")}
                                  icon={<DeleteOutlined />}
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

                      {worktreePath && worktreeExpanded && (
                        <div className="git-branch-worktree-actions">
                          <div className="git-branch-worktree-path">{worktreePath}</div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="small"
                              type="primary"
                              icon={<FolderOpenOutlined />}
                              onClick={() => void handleOpenWorktree(worktreePath)}
                            >
                              {t("sidebar.gitBranchOpenWorktree")}
                            </Button>
                            <Button
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => void handleCopyWorktreePath(worktreePath)}
                            >
                              {t("common.copy")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {remoteBranches.length > 0 && (
              <div className="mt-1">
                <div className="git-branch-section-label">
                  <span>{t("sidebar.gitRemoteBranches")}</span>
                  <span className="git-branch-section-count">{remoteBranches.length}</span>
                </div>
                {remoteBranches.map((branch) => {
                  const canCheckout = !blocked && !isRemoteHeadBranch(branch.name);
                  return (
                    <Dropdown
                      key={branch.name}
                      trigger={["contextMenu"]}
                      menu={buildBranchMenu(branch)}
                      disabled={!canCheckout}
                    >
                      <div
                        className="git-branch-row"
                        data-disabled={canCheckout ? "false" : "true"}
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
                          <LoadingOutlined className="shrink-0 text-[11px] text-[var(--cs-text-tertiary)]" />
                        ) : null}
                      </div>
                    </Dropdown>
                  );
                })}
              </div>
            )}

            {localBranches.length === 0 && remoteBranches.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-[var(--cs-text-tertiary)]">
                <BranchesOutlined className="text-lg" />
                <span className="text-xs">
                  {trimmedQuery ? t("sidebar.gitBranchNoMatch") : t("sidebar.gitNoChanges")}
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
        placement="bottomLeft"
        arrow={false}
        open={visible}
        onOpenChange={onVisibleChange}
        classNames={{ root: "git-branch-popover-overlay" }}
        content={popoverContent}
      >
        {children}
      </Popover>

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
