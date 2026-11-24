import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dropdown, message, Modal, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
  BranchesOutlined,
  CheckOutlined,
  DownOutlined,
  EllipsisOutlined,
  HistoryOutlined,
  LoadingOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  gitDiffContent,
  gitAddToGitignore,
  gitInitRepository,
  gitGenerateCommitMessage,
  gitDiscardChanges,
  gitStageFiles,
  gitUnstageFiles,
  openInFileManager,
} from "@/lib/api";
import { revealExplorerPath } from "@/lib/explorer";
import {
  GIT_FILE_HISTORY_OPEN_EVENT,
  takePendingGitFileHistoryOpen,
  type GitFileHistoryOpenDetail,
} from "@/lib/gitGraphEvents";
import { useAppStore } from "@/store";
import { useGitStatus } from "@/hooks/useGitStatus";
import { useGitCommit } from "@/hooks/useGitCommit";
import type { GitFileStatus } from "@/types";
import { getGitOperationLabelKey, isGitOperationInProgress } from "@/lib/gitOperationState";
import { parseGitCommitGenerationError } from "@/lib/gitCommitGenerationError";
import { getAgentDisplayName } from "@/lib/agents";
import {
  resolveEffectiveCommitAgentId,
  useGitCommitGenerationStore,
} from "@/store/slices/gitCommitGenerationSlice";
import { useTranslation } from "react-i18next";
import { GitCommitComposer } from "./GitCommitComposer";
import { GitFileList } from "./GitFileList";
import { GitGraphSection } from "./GitGraphSection";
import { GitBranchPanel } from "./GitBranchPanel";
import { GitRemoteToolbar } from "./GitRemoteToolbar";
import { useGitRemoteStore } from "@/store/slices/gitRemote";
import { GitConflictPanel } from "./GitConflictPanel";

/**
 * 获取全局 Git 刷新控制器
 */
function getGitRefreshController() {
  return (window as unknown as Record<string, unknown>).__gitRefreshController as {
    requestRefresh: () => void;
    refreshNow: () => void;
    markOperationStart: () => string;
    markOperationEnd: (operationId: string) => void;
  } | undefined;
}

interface SidebarGitPanelProps {
  currentProject: { name: string; path: string } | null;
}

function splitGitPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const fileName = parts.pop() ?? normalized;
  return {
    fileName,
    parentPath: parts.join("\\"),
  };
}

function isAbsolutePath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

function resolveProjectFilePath(projectPath: string, filePath: string) {
  if (isAbsolutePath(filePath)) {
    return filePath;
  }

  return `${projectPath.replace(/[\\/]+$/, "")}/${filePath.replace(/^[\\/]+/, "")}`;
}

function getGitOperationPaths(file: GitFileStatus): string[] {
  return Array.from(new Set([file.oldPath, file.path].filter((path): path is string => !!path)));
}

function canOperateOnHunks(file: GitFileStatus) {
  return file.statusType !== "conflicted"
    && file.statusType !== "deleted"
    && file.statusType !== "typechange"
    && file.statusType !== "untracked";
}

function SidebarGitPanel({ currentProject }: SidebarGitPanelProps) {
  const { t } = useTranslation();
  const openGitDiffTab = useAppStore((s) => s.openGitDiffTab);
  const openFileTab = useAppStore((s) => s.openFileTab);
  const activeDiffKey = useAppStore((s) => {
    const focusedTabId = s.focusedTabId;
    const diffDocument = focusedTabId ? s.gitDiffDocuments[focusedTabId] : undefined;
    return diffDocument
      ? `${diffDocument.staged ? "staged" : "unstaged"}-${diffDocument.path}`
      : null;
  });
  const gitGraphCollapsed = useAppStore((s) => s.sidebarGitGraphCollapsed);
  const toggleGitGraphCollapsed = useAppStore((s) => s.toggleGitGraphCollapsed);
  const setGitChangeCount = useAppStore((s) => s.setGitChangeCount);
  const setGitSyncCounts = useAppStore((s) => s.setGitSyncCounts);
  const defaultAgentId = useAppStore((s) => s.defaultAgentId);
  const gitCommitMessageProfiles = useAppStore((s) => s.gitCommitMessageProfiles);
  const defaultGitCommitMessageProfileId = useAppStore(
    (s) => s.defaultGitCommitMessageProfileId,
  );
  const diffOpenRequestRef = useRef(0);
  const [fileHistoryPath, setFileHistoryPath] = useState<string | null>(null);

  useEffect(() => {
    setFileHistoryPath(null);
    const projectPath = currentProject?.path;
    if (!projectPath) return;

    const applyRequest = (detail: GitFileHistoryOpenDetail | undefined) => {
      if (!detail || detail.projectPath !== projectPath) return;
      setFileHistoryPath(detail.filePath);
    };
    const handleRequest = (event: Event) => {
      const detail = (event as CustomEvent<GitFileHistoryOpenDetail>).detail;
      applyRequest(detail);
      if (detail?.projectPath === projectPath) {
        takePendingGitFileHistoryOpen(projectPath);
      }
    };

    window.addEventListener(GIT_FILE_HISTORY_OPEN_EVENT, handleRequest as EventListener);
    applyRequest(takePendingGitFileHistoryOpen(projectPath) ?? undefined);
    return () => {
      window.removeEventListener(GIT_FILE_HISTORY_OPEN_EVENT, handleRequest as EventListener);
    };
  }, [currentProject?.path]);

  // 使用 useGitStatus hook 管理 Git 状态
  const {
    isRepo,
    error: statusError,
    loading,
    branchInfo,
    fileStatuses,
    stagedFiles,
    unstagedFiles,
    branchName: rawBranchName,
    hasLocalChanges,
    hasSyncChanges,
    syncChangeCount,
    refresh: loadGitData,
  } = useGitStatus({
    currentProject,
    onStatusChange: useCallback(
      (changeCount: number, ahead: number, behind: number) => {
        setGitChangeCount(changeCount);
        setGitSyncCounts(ahead, behind);
      },
      [setGitChangeCount, setGitSyncCounts]
    ),
  });

  const notifiedStatusErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentProject || !statusError) {
      notifiedStatusErrorRef.current = null;
      return;
    }
    const errorKey = `${currentProject.path}:${statusError}`;
    if (notifiedStatusErrorRef.current === errorKey) return;
    notifiedStatusErrorRef.current = errorKey;
    // 后台轮询持续失败时只提示一次，恢复后再次失败才重新通知。
    message.error({
      key: `git-status-error:${currentProject.path}`,
      title: currentProject.name,
      content: t("sidebar.gitRefreshFailed", { detail: statusError }),
    });
  }, [currentProject?.path, currentProject?.name, statusError, t]);

  // 处理 detached HEAD 状态
  const branchName = rawBranchName || t("sidebar.gitDetached");
  const operationState = branchInfo?.operationState ?? "clean";
  const gitOperationInProgress = isGitOperationInProgress(operationState);
  const gitOperationBlockedReason = t("sidebar.gitOperationInProgress", {
    operation: t(getGitOperationLabelKey(operationState)),
  });

  // 使用 useGitCommit hook 管理提交操作
  const {
    committing,
    commit,
    commitAmend,
    commitAndPush,
    commitAndSync,
    pull,
    pullWithStash,
    push,
    sync: syncChanges,
  } = useGitCommit({
    projectPath: currentProject?.path ?? null,
    expectedBranch: rawBranchName,
    stagedFiles,
    unstagedFiles,
    refresh: loadGitData,
  });

  const remoteReady = useGitRemoteStore((s) => {
    const remote = s.entries[currentProject?.path ?? ""]?.data;
    return !remote?.requiresFetch && !!remote?.upstream && remote.branchName === rawBranchName && !branchInfo?.isDetached;
  });
  const remoteBusy = useGitRemoteStore((s) => !!s.busy[currentProject?.path ?? ""]);

  const gitActionsBlocked = gitOperationInProgress || !!statusError || remoteBusy;
  const gitActionsBlockedReason = statusError
    ? t("sidebar.gitRefreshFailed", { detail: statusError })
    : remoteBusy ? t("sidebar.gitBusy") : gitOperationBlockedReason;

  const gitCommitGenerationConfig = useGitCommitGenerationStore((s) => s.config);
  const currentProjectPath = currentProject?.path ?? "";
  const commitMessageDraft = useGitCommitGenerationStore(
    (s) => (currentProjectPath ? s.draftsByProject[currentProjectPath] ?? "" : ""),
  );
  const generatingCommitMessage = useGitCommitGenerationStore(
    (s) => Boolean(currentProjectPath && s.activeGenerationTokenByProject[currentProjectPath]),
  );
  const setCommitMessageDraft = useGitCommitGenerationStore((s) => s.setDraft);
  const clearCommitMessageDraft = useGitCommitGenerationStore((s) => s.clearDraft);
  const startCommitGeneration = useGitCommitGenerationStore((s) => s.startGeneration);
  const finishCommitGeneration = useGitCommitGenerationStore((s) => s.finishGeneration);
  const failCommitGeneration = useGitCommitGenerationStore((s) => s.failGeneration);
  const currentProjectPathRef = useRef(currentProjectPath);
  currentProjectPathRef.current = currentProjectPath;
  const effectiveCommitAgentId = resolveEffectiveCommitAgentId(
    gitCommitGenerationConfig,
    defaultAgentId,
  );
  const [openingDiffPath, setOpeningDiffPath] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"changes" | "graph">(() =>
    gitGraphCollapsed ? "changes" : "graph",
  );
  const [showBranchPanel, setShowBranchPanel] = useState(false);
  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [changesCollapsed, setChangesCollapsed] = useState(false);
  const [discardConfirmVisible, setDiscardConfirmVisible] = useState(false);
  const [discardConfirmFiles, setDiscardConfirmFiles] = useState<GitFileStatus[]>([]);
  const [discardConfirmTitle, setDiscardConfirmTitle] = useState("");
  const [discardSubmitting, setDiscardSubmitting] = useState(false);
  const [initializingRepository, setInitializingRepository] = useState(false);

  useEffect(() => {
    if (fileHistoryPath) {
      setActiveView("graph");
    }
  }, [fileHistoryPath]);

  const handleSelectView = useCallback(
    (nextView: "changes" | "graph") => {
      setActiveView(nextView);
      const shouldCollapseGraph = nextView !== "graph";
      if (gitGraphCollapsed !== shouldCollapseGraph) {
        toggleGitGraphCollapsed();
      }
    },
    [gitGraphCollapsed, toggleGitGraphCollapsed],
  );

  const canGenerateCommitMessage =
    !generatingCommitMessage &&
    !!effectiveCommitAgentId &&
    !!currentProject &&
    fileStatuses.length > 0;

  const handleInitializeRepository = useCallback(async () => {
    if (!currentProject || initializingRepository) return;

    setInitializingRepository(true);
    try {
      await gitInitRepository(currentProject.path);
      message.success(t("sidebar.gitInitSuccess"));
      await loadGitData();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      message.error(detail && detail !== "[object Object]"
        ? `${t("sidebar.gitInitFailed")}: ${detail}`
        : t("sidebar.gitInitFailed"));
    } finally {
      setInitializingRepository(false);
    }
  }, [currentProject, initializingRepository, loadGitData, t]);
  const changesMenuItems: MenuProps["items"] = [
    {
      key: "discard-all",
      label: t("sidebar.gitDiscardAll"),
      danger: true,
    },
  ];
  const collapsePanelMenuItems: MenuProps["items"] = [
    {
      key: "view-changes",
      label: t("sidebar.gitChangesPanel"),
      icon: activeView === "changes" ? <CheckOutlined /> : <span className="inline-block w-[14px]" />,
    },
    {
      key: "view-graph",
      label: t("sidebar.gitGraphPanel"),
      icon: activeView === "graph" ? <CheckOutlined /> : <span className="inline-block w-[14px]" />,
    },
  ];

  const handleViewDiff = useCallback(
    async (
      filePath: string,
      staged: boolean,
      oldFilePath?: string | null,
      hunkActionsAvailable?: boolean,
      preview = true,
      changeKind?: GitFileStatus["statusType"],
    ) => {
      if (!currentProject) return;
      const requestId = ++diffOpenRequestRef.current;
      setOpeningDiffPath(filePath);
      try {
        const diffDocument = await gitDiffContent(currentProject.path, filePath, staged, oldFilePath);
        if (requestId !== diffOpenRequestRef.current) return;
        if (diffDocument.isBinary && diffDocument.contentKind !== "image") return;
        openGitDiffTab({
          path: diffDocument.filePath,
          oldPath: oldFilePath,
          name: splitGitPath(diffDocument.filePath).fileName,
          staged,
          changeKind,
          hunkActionsAvailable,
          originalContent: diffDocument.originalContent,
          modifiedContent: diffDocument.modifiedContent,
          originalLabel: diffDocument.originalLabel,
          modifiedLabel: diffDocument.modifiedLabel,
          isBinary: diffDocument.isBinary,
          contentKind: diffDocument.contentKind,
          originalImage: diffDocument.originalImage,
          modifiedImage: diffDocument.modifiedImage,
        }, { preview });
      } catch (error) {
        if (requestId !== diffOpenRequestRef.current) return;
        const detail = typeof error === "string" ? error : "";
        message.error(detail ? `打开差异失败: ${detail}` : "打开差异失败");
      } finally {
        if (requestId === diffOpenRequestRef.current) {
          setOpeningDiffPath(null);
        }
      }
    },
    [currentProject, openGitDiffTab]
  );

  const handleDiscard = useCallback(
    (file: GitFileStatus) => {
      if (gitActionsBlocked) {
        message.warning(gitActionsBlockedReason);
        return;
      }
      setDiscardConfirmFiles([file]);
      setDiscardConfirmTitle(t("sidebar.gitDiscardConfirm", { name: file.path }));
      setDiscardConfirmVisible(true);
    },
    [gitActionsBlockedReason, gitActionsBlocked, t]
  );

  const handleOpenFile = useCallback(
    (filePath: string) => {
      if (!currentProject) return;
      openFileTab(resolveProjectFilePath(currentProject.path, filePath), { preview: false });
    },
    [currentProject, openFileTab]
  );

  const handleOpenPathInManager = useCallback(
    async (filePath: string) => {
      if (!currentProject) return;
      try {
        await openInFileManager(resolveProjectFilePath(currentProject.path, filePath));
      } catch {
        message.error(t("common.openInFileManager", { defaultValue: "在文件管理器中打开" }));
      }
    },
    [currentProject, t]
  );

  const handleRevealInExplorer = useCallback(
    (filePath: string) => {
      if (!currentProject) return;
      revealExplorerPath(resolveProjectFilePath(currentProject.path, filePath), "file");
    },
    [currentProject]
  );

  const handleStageFile = useCallback(
    async (file: GitFileStatus) => {
      if (!currentProject || gitActionsBlocked) {
        if (gitActionsBlocked) message.warning(gitActionsBlockedReason);
        return;
      }
      const controller = getGitRefreshController();
      const operationId = controller?.markOperationStart();
      try {
        await gitStageFiles(currentProject!.path, getGitOperationPaths(file));
        await loadGitData();
      } catch {
        message.error(t("sidebar.gitStageFailed"));
        // 失败时回滚：重新加载真实数据
        await loadGitData();
      } finally {
        if (operationId) controller?.markOperationEnd(operationId);
      }
    },
    [currentProject, gitActionsBlockedReason, gitActionsBlocked, loadGitData, t]
  );

  const handleAddToGitignore = useCallback(async (file: GitFileStatus) => {
    if (!currentProject || gitActionsBlocked) {
      if (gitActionsBlocked) message.warning(gitActionsBlockedReason);
      return;
    }
    const controller = getGitRefreshController();
    const operationId = controller?.markOperationStart();
    try {
      const tracked = await gitAddToGitignore(currentProject.path, file.path);
      await loadGitData();
      message.success(t("sidebar.gitIgnoreSuccess"));
      if (tracked) message.info(t("sidebar.gitIgnoreTrackedNotice"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      message.error(t("sidebar.gitIgnoreFailed", { detail }));
    } finally {
      if (operationId) controller?.markOperationEnd(operationId);
    }
  }, [currentProject, gitActionsBlocked, gitActionsBlockedReason, loadGitData, t]);

  const handleUnstageFile = useCallback(
    async (file: GitFileStatus) => {
      if (!currentProject || gitActionsBlocked) {
        if (gitActionsBlocked) message.warning(gitActionsBlockedReason);
        return;
      }
      const controller = getGitRefreshController();
      const operationId = controller?.markOperationStart();
      try {
        await gitUnstageFiles(currentProject!.path, getGitOperationPaths(file));
        await loadGitData();
      } catch {
        message.error(t("sidebar.gitUnstageFailed"));
        // 失败时回滚：重新加载真实数据
        await loadGitData();
      } finally {
        if (operationId) controller?.markOperationEnd(operationId);
      }
    },
    [currentProject, gitActionsBlockedReason, gitActionsBlocked, loadGitData, t]
  );

  const handleStageAll = useCallback(async () => {
    if (!currentProject || unstagedFiles.length === 0 || gitActionsBlocked) {
      if (gitActionsBlocked) message.warning(gitActionsBlockedReason);
      return;
    }
    const controller = getGitRefreshController();
    const operationId = controller?.markOperationStart();
    try {
      const files = Array.from(new Set(unstagedFiles.flatMap(getGitOperationPaths)));
      await gitStageFiles(currentProject.path, files);
      await loadGitData();
    } catch {
      message.error(t("sidebar.gitStageFailed"));
      // 失败时回滚
      await loadGitData();
    } finally {
      if (operationId) controller?.markOperationEnd(operationId);
    }
  }, [currentProject, gitActionsBlockedReason, gitActionsBlocked, unstagedFiles, loadGitData, t]);

  const handleDiscardAll = useCallback(() => {
    if (gitActionsBlocked) {
      message.warning(gitActionsBlockedReason);
      return;
    }
    setDiscardConfirmFiles(unstagedFiles);
    setDiscardConfirmTitle(t("sidebar.gitDiscardAllConfirm"));
    setDiscardConfirmVisible(true);
  }, [gitActionsBlockedReason, gitActionsBlocked, unstagedFiles, t]);

  const handleUnstageAll = useCallback(async () => {
    if (!currentProject || stagedFiles.length === 0 || gitActionsBlocked) {
      if (gitActionsBlocked) message.warning(gitActionsBlockedReason);
      return;
    }
    const controller = getGitRefreshController();
    const operationId = controller?.markOperationStart();
    try {
      const files = Array.from(new Set(stagedFiles.flatMap(getGitOperationPaths)));
      await gitUnstageFiles(currentProject.path, files);
      await loadGitData();
    } catch {
      message.error(t("sidebar.gitUnstageFailed"));
      // 失败时回滚
      await loadGitData();
    } finally {
      if (operationId) controller?.markOperationEnd(operationId);
    }
  }, [currentProject, gitActionsBlockedReason, gitActionsBlocked, stagedFiles, loadGitData, t]);

  const handleChangesMenuClick = useCallback(
    ({ key }: { key: string }) => {
      if (key === "discard-all") {
        handleDiscardAll();
      }
    },
    [handleDiscardAll]
  );

  const buildFileMenu = useCallback(
    (file: GitFileStatus, staged: boolean): MenuProps => {
      const canOpenWorkingTree =
        file.statusType !== "deleted" && file.statusType !== "typechange";
      const items: NonNullable<MenuProps["items"]> = [
        {
          key: "open-diff",
          label: t("sidebar.gitContextOpenChanges", { defaultValue: "打开更改" }),
        },
        {
          key: "open-file",
          label: t("sidebar.gitContextOpenFile", { defaultValue: "打开文件" }),
          disabled: !canOpenWorkingTree,
        },
        { type: "divider" },
        staged
          ? {
              key: "unstage",
              label: t("sidebar.gitUnstage"),
              disabled: gitActionsBlocked,
            }
          : {
              key: "stage",
              label: t("sidebar.gitStage"),
              disabled: gitActionsBlocked,
            },
      ];

      if (!staged) {
        items.push({
          key: "discard",
          label: t("sidebar.gitContextDiscardChanges", { defaultValue: "放弃更改" }),
          danger: true,
          disabled: gitActionsBlocked,
        });
      }

      if (canOpenWorkingTree) {
        items.push({
          key: "add-to-gitignore",
          label: t("sidebar.gitContextAddToGitignore"),
          disabled: gitActionsBlocked,
        });
      }

      items.push(
        { type: "divider" },
        {
          key: "show-in-manager",
          label: t("sidebar.gitContextShowInManager", { defaultValue: "在文件资源管理器中显示" }),
          disabled: !canOpenWorkingTree,
        },
        {
          key: "reveal-in-explorer",
          label: t("sidebar.gitContextRevealInExplorer", { defaultValue: "在资源管理器视图中显示" }),
        }
      );

      return {
        items,
        onClick: ({ key }) => {
          switch (key) {
            case "open-diff":
              void handleViewDiff(
                file.path,
                staged,
                file.oldPath,
                canOperateOnHunks(file),
                true,
                file.statusType,
              );
              break;
            case "open-file":
              handleOpenFile(file.path);
              break;
            case "stage":
              void handleStageFile(file);
              break;
            case "unstage":
              void handleUnstageFile(file);
              break;
            case "discard":
              handleDiscard(file);
              break;
            case "add-to-gitignore":
              void handleAddToGitignore(file);
              break;
            case "show-in-manager":
              void handleOpenPathInManager(file.path);
              break;
            case "reveal-in-explorer":
              handleRevealInExplorer(file.path);
              break;
            default:
              break;
          }
        },
      };
    },
    [
      handleAddToGitignore,
      handleDiscard,
      handleOpenFile,
      handleOpenPathInManager,
      handleRevealInExplorer,
      handleStageFile,
      handleUnstageFile,
      handleViewDiff,
      gitActionsBlocked,
      t,
    ]
  );

  const handleCollapsePanelMenuClick = useCallback(
    ({ key }: { key: string }) => {
      switch (key) {
        case "view-changes":
          setFileHistoryPath(null);
          handleSelectView("changes");
          break;
        case "view-graph":
          handleSelectView("graph");
          break;
        default:
          break;
      }
    },
    [handleSelectView],
  );

  const handleGenerateCommitMessage = useCallback(async (profileId?: string) => {
    if (!currentProject || fileStatuses.length === 0) return;
    const projectPath = currentProject.path;
    const projectName = currentProject.name;
    const agentId = effectiveCommitAgentId;
    if (!agentId) {
      message.warning(t("sidebar.gitGenerateCommitMessageAgentRequired"));
      return;
    }
    const selectedProfile = gitCommitMessageProfiles.find(
      (profile) => profile.id === (profileId ?? defaultGitCommitMessageProfileId),
    ) ?? gitCommitMessageProfiles[0];
    if (!selectedProfile) {
      message.warning(t("sidebar.gitCommitMessageProfileRequired"));
      return;
    }

    const ticket = startCommitGeneration(projectPath);
    if (!ticket) return;

    const requestedModel =
      agentId === "antigravity" ? gitCommitGenerationConfig.model : null;
    const requestedReasoningEffort =
      agentId === "antigravity" ? gitCommitGenerationConfig.reasoningEffort : null;

    try {
      const generatedMessage = await gitGenerateCommitMessage(
        projectPath,
        agentId,
        selectedProfile.instructions,
        {
          model: requestedModel,
          reasoningEffort: requestedReasoningEffort,
        },
      );
      const outcome = finishCommitGeneration(ticket, generatedMessage);
      const isSameProject = currentProjectPathRef.current === projectPath;
      if (outcome === "preserved-user-edit") {
        message.info({
          title: isSameProject ? undefined : projectName,
          content: t("sidebar.gitGenerateCommitMessageDraftPreserved"),
        });
      } else if (outcome === "applied") {
        message.success({
          title: isSameProject ? undefined : projectName,
          content: t("sidebar.gitGenerateCommitMessageSuccessWithProfile", {
            profile: selectedProfile.name,
          }),
        });
      }
    } catch (error) {
      failCommitGeneration(ticket);
      const failure = parseGitCommitGenerationError(error);
      const reason = t(`sidebar.gitGenerationErrors.${failure.code}`, { attempts: failure.attempts });
      const diagnostic = ["processFailed", "invalidInput", "unavailable"].includes(failure.code) ? failure.detail : "";
      const exitCode = failure.code === "processFailed" && failure.exitCode !== null
        ? t("sidebar.gitGenerationExitCode", { code: failure.exitCode }) : "";
      const detail = [
        `${t("sidebar.gitGenerateCommitMessageFailed")}: ${reason}`,
        exitCode,
        diagnostic,
        t("sidebar.gitGenerateCommitMessageRetryHint"),
      ].filter(Boolean).join(" ");
      const isSameProject = currentProjectPathRef.current === projectPath;
      message.error({
        title: isSameProject ? undefined : projectName,
        content: detail,
      });
    }
  }, [
    currentProject,
    defaultGitCommitMessageProfileId,
    effectiveCommitAgentId,
    failCommitGeneration,
    fileStatuses.length,
    finishCommitGeneration,
    gitCommitGenerationConfig.model,
    gitCommitGenerationConfig.reasoningEffort,
    gitCommitMessageProfiles,
    startCommitGeneration,
    t,
  ]);

  const handleDiscardConfirm = useCallback(async () => {
    if (!currentProject || discardConfirmFiles.length === 0) return;
    const controller = getGitRefreshController();
    const operationId = controller?.markOperationStart();
    setDiscardSubmitting(true);
    try {
      const files = Array.from(new Set(discardConfirmFiles.flatMap(getGitOperationPaths)));
      await gitDiscardChanges(currentProject.path, files);
      message.success(t("sidebar.gitDiscardSuccess"));
      setDiscardConfirmVisible(false);
      setDiscardConfirmFiles([]);
      await loadGitData();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      message.error(
        detail && detail !== "[object Object]"
          ? `${t("sidebar.gitDiscardFailed")}: ${detail}`
          : t("sidebar.gitDiscardFailed"),
      );
      // 失败时回滚
      await loadGitData();
    } finally {
      setDiscardSubmitting(false);
      if (operationId) controller?.markOperationEnd(operationId);
    }
  }, [currentProject, discardConfirmFiles, loadGitData, t]);

  // No project
  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4" style={{ color: "var(--cs-text-tertiary)" }}>
        <BranchesOutlined className="text-3xl" />
        <span className="text-sm text-center">{t("sidebar.noProject")}</span>
      </div>
    );
  }

  // Not a git repo
  if (isRepo === false && !statusError && !loading) {
    return (
      <div className="flex h-full flex-col px-5 pt-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--cs-text-primary)]">
            <BranchesOutlined className="text-base" />
            <span>{t("sidebar.gitInitTitle")}</span>
          </div>
          <p className="m-0 text-sm leading-5 text-[var(--cs-text-secondary)]">
            {t("sidebar.gitInitDescription")}
          </p>
          <Button
            type="primary"
            block
            loading={initializingRepository}
            onClick={() => void handleInitializeRepository()}
          >
            {t("sidebar.gitInitAction")}
          </Button>
          <p className="m-0 text-xs leading-5 text-[var(--cs-text-tertiary)]">
            {t("sidebar.gitInitHint")}
          </p>
        </div>
      </div>
    );
  }

  const aheadCount = branchInfo?.ahead ?? 0;
  const behindCount = branchInfo?.behind ?? 0;
  const conflictFiles = unstagedFiles.filter((f) => f.statusType === "conflicted");
  const showConflictPanel =
    !fileHistoryPath && (conflictFiles.length > 0 || operationState !== "clean");
  const effectiveView = fileHistoryPath ? "graph" : activeView;

  return (
    <div className="app-sidebar-panel flex h-full min-h-0 flex-col">
      {/* Workbench Header */}
      <div className="git-workbench-header">
        <GitBranchPanel
          key={currentProject.path}
          disabled={!!statusError || committing || remoteBusy || gitActionsBlocked}
          projectPath={currentProject.path}
          currentBranch={branchName}
          visible={showBranchPanel}
          onVisibleChange={setShowBranchPanel}
          onBranchChanged={loadGitData}
        >
          <Tooltip title={t("sidebar.gitBranchSwitchHint")} mouseEnterDelay={0.4}>
            <button
              type="button"
              className="git-branch-trigger"
              data-open={showBranchPanel ? "true" : "false"}
              aria-expanded={showBranchPanel}
            >
              <BranchesOutlined className="shrink-0 text-[13px] text-[var(--cs-primary)]" />
              <span className="git-branch-trigger-name">{branchName}</span>
              {(aheadCount > 0 || behindCount > 0) && (
                <span className="git-branch-trigger-sync">
                  {aheadCount > 0 ? <span className="text-[var(--cs-success)]">↑{aheadCount}</span> : null}
                  {behindCount > 0 ? <span className="text-[var(--cs-error)]">↓{behindCount}</span> : null}
                </span>
              )}
              <DownOutlined className="git-branch-trigger-chevron shrink-0" />
            </button>
          </Tooltip>
        </GitBranchPanel>

        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip title={statusError || t("sidebar.gitLocalRefresh")} mouseEnterDelay={0.4}>
            <Button
              type="text"
              size="small"
              aria-label={t("sidebar.gitLocalRefresh")}
              icon={loading ? <LoadingOutlined /> : <ReloadOutlined />}
              className={`h-6 w-6 min-w-6 p-0 ${
                statusError ? "text-[var(--cs-error)]" : "text-[var(--cs-text-secondary)]"
              }`}
              onClick={() => void loadGitData()}
              disabled={loading || committing || remoteBusy || gitOperationInProgress}
            />
          </Tooltip>
          <GitRemoteToolbar
            key={`${currentProject.path}:${rawBranchName}`}
            projectPath={currentProject.path}
            branch={branchInfo}
            disabled={loading || !!statusError || committing || gitActionsBlocked}
            refresh={loadGitData}
            menuItems={collapsePanelMenuItems}
            onMenuClick={handleCollapsePanelMenuClick}
          />
        </div>
      </div>

      {/* Segmented View Tabs */}
      <div className="git-view-tabs" role="tablist" aria-label={t("sidebar.gitPanelTitle")}>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === "changes"}
          className="git-view-tab"
          data-active={effectiveView === "changes" ? "true" : "false"}
          onClick={() => {
            setFileHistoryPath(null);
            handleSelectView("changes");
          }}
        >
          <span>{t("sidebar.gitChangesPanel")}</span>
          <span
            className="git-view-tab-badge"
            data-nonzero={fileStatuses.length > 0 ? "true" : "false"}
          >
            {fileStatuses.length}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === "graph"}
          className="git-view-tab"
          data-active={effectiveView === "graph" ? "true" : "false"}
          onClick={() => handleSelectView("graph")}
        >
          <span>{t("sidebar.gitGraphPanel")}</span>
          {fileHistoryPath ? (
            <HistoryOutlined className="text-[11px] text-[var(--cs-primary)]" />
          ) : null}
        </button>
      </div>

      {/* Changes View */}
      {effectiveView === "changes" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {showConflictPanel && (
            <div className="shrink-0 border-b border-[var(--cs-border-sidebar)] px-2 py-2">
              <GitConflictPanel
                projectPath={currentProject.path}
                conflictFiles={conflictFiles}
                operationState={operationState}
                onConflictResolved={loadGitData}
                onOpenConflictResolver={(filePath) => {
                  handleViewDiff(filePath, false, undefined, false, false, "conflicted");
                }}
              />
            </div>
          )}

          <GitCommitComposer
            remoteReady={remoteReady}
            branchName={branchName}
            commitMessage={commitMessageDraft}
            onCommitMessageChange={(value) => {
              if (currentProject) setCommitMessageDraft(currentProject.path, value);
            }}
            onClearCommitMessage={() => {
              if (currentProject) clearCommitMessageDraft(currentProject.path);
            }}
            hasLocalChanges={hasLocalChanges}
            stagedChangeCount={stagedFiles.length}
            unstagedChangeCount={unstagedFiles.length}
            aheadCount={aheadCount}
            behindCount={behindCount}
            hasSyncChanges={hasSyncChanges}
            syncChangeCount={syncChangeCount}
            operationState={operationState}
            committing={committing || remoteBusy || !!statusError}
            canGenerateCommitMessage={canGenerateCommitMessage}
            generateCommitMessageHint={
              effectiveCommitAgentId
                ? `${t("sidebar.gitGenerateCommitMessage")} · ${getAgentDisplayName(effectiveCommitAgentId)}`
                : t("sidebar.gitGenerateCommitMessageAgentRequired")
            }
            generatingCommitMessage={generatingCommitMessage}
            commitMessageProfiles={gitCommitMessageProfiles}
            defaultCommitMessageProfileId={defaultGitCommitMessageProfileId}
            onCommit={commit}
            onCommitAmend={commitAmend}
            onCommitAndPush={commitAndPush}
            onCommitAndSync={commitAndSync}
            onPush={push}
            onPull={pull}
            onPullWithStash={pullWithStash}
            onSyncChanges={syncChanges}
            onGenerateCommitMessage={handleGenerateCommitMessage}
          />

          <div className="app-project-tree-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            <GitFileList
              files={stagedFiles}
              staged={true}
              sectionTitle={t("sidebar.gitStagedSection")}
              actionText={t("sidebar.gitUnstage")}
              collapsed={stagedCollapsed}
              onToggleCollapse={() => setStagedCollapsed(!stagedCollapsed)}
              openingDiffPath={openingDiffPath}
              activeDiffKey={activeDiffKey}
              onViewDiff={handleViewDiff}
              onToggleFile={handleUnstageFile}
              onToggleAll={handleUnstageAll}
              buildFileMenu={buildFileMenu}
              actionsDisabled={gitActionsBlocked}
            />

            <GitFileList
              files={unstagedFiles}
              staged={false}
              sectionTitle={t("sidebar.gitChangesSection")}
              actionText={t("sidebar.gitStage")}
              collapsed={changesCollapsed}
              onToggleCollapse={() => setChangesCollapsed(!changesCollapsed)}
              openingDiffPath={openingDiffPath}
              activeDiffKey={activeDiffKey}
              onViewDiff={handleViewDiff}
              onToggleFile={handleStageFile}
              onToggleAll={handleStageAll}
              buildFileMenu={buildFileMenu}
              actionsDisabled={gitActionsBlocked}
              extraActions={
                <Dropdown
                  trigger={["click"]}
                  menu={{ items: changesMenuItems, onClick: handleChangesMenuClick }}
                >
                  <Button
                    type="text"
                    size="small"
                    aria-label={t("sidebar.moreActions", { defaultValue: "更多操作" })}
                    icon={<EllipsisOutlined />}
                    className="h-5 w-5 min-w-5 p-0 text-[var(--cs-text-secondary)]"
                  />
                </Dropdown>
              }
            />

            {fileStatuses.length === 0 && (
              <div
                className={`flex flex-col items-center justify-center gap-2 py-10 text-[var(--cs-text-tertiary)]${
                  loading && isRepo !== true ? " invisible" : ""
                }`}
              >
                <CheckOutlined className="text-xl" />
                <span className="text-xs">{t("sidebar.gitNoChanges")}</span>
                <Button
                  type="link"
                  size="small"
                  className="text-xs"
                  onClick={() => handleSelectView("graph")}
                >
                  {t("sidebar.gitViewGraph")}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <GitGraphSection
            embeddedTab
            projectPath={currentProject.path}
            collapsed={false}
            onToggleCollapse={toggleGitGraphCollapsed}
            sectionTitle={t("sidebar.gitGraphPanel")}
            refreshText={t("sidebar.gitRefresh")}
            placeholderText={t("sidebar.gitGraphPlaceholder")}
            fileHistoryPath={fileHistoryPath}
            onClearFileHistory={() => setFileHistoryPath(null)}
          />
        </div>
      )}

      {/* Discard confirmation modal */}
      <Modal
        centered
        title={discardConfirmTitle}
        open={discardConfirmVisible}
        okText={t("sidebar.gitDiscardConfirmOk")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
        confirmLoading={discardSubmitting}
        onOk={handleDiscardConfirm}
        onCancel={() => {
          if (discardSubmitting) return;
          setDiscardConfirmVisible(false);
          setDiscardConfirmFiles([]);
        }}
      >
        <p>
          {discardConfirmFiles.some((file) => file.statusType === "untracked")
            ? t("sidebar.gitDiscardIncludesUntracked")
            : discardConfirmFiles.length > 1
              ? t("sidebar.gitDiscardAllConfirm")
              : t("sidebar.gitDiscardConfirm", { name: discardConfirmFiles[0]?.path || "" })}
        </p>
      </Modal>
    </div>
  );
}

export default SidebarGitPanel;
