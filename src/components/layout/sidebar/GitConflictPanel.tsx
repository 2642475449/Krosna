import { useGitConflictDraftStore } from "@/store/slices/gitConflictDraft";
import { useGitRemoteStore } from "@/store/slices/gitRemote";
import { GitConflictAgentAction } from "@/components/GitConflictAgentAction";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, message, Tooltip } from "antd";
import {
  CheckOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  gitConflictDetail,
  gitResolveConflict,
  gitAbortOperation,
  gitContinueOperation,
} from "@/lib/api";
import type {
  GitConflictDetail,
  GitFileStatus,
  GitRepositoryOperationState,
} from "@/types";
import {
  canAbortGitOperation,
  canContinueGitOperation,
  getGitConflictResolutionLabelKeys,
  getGitOperationLabelKey,
  isGitOperationInProgress,
} from "@/lib/gitOperationState";

interface GitConflictPanelProps {
  /** 当前项目路径 */
  projectPath: string;
  /** 冲突文件列表 */
  conflictFiles: GitFileStatus[];
  /** 冲突所属的 Git 操作状态 */
  operationState: GitRepositoryOperationState;
  /** 操作完成后的回调 */
  onConflictResolved: () => Promise<void>;
  /** 在主工作区打开可编辑的冲突解决器。 */
  onOpenConflictResolver: (filePath: string) => void;
}

/**
 * Git 冲突解决面板
 *
 * 显示冲突文件列表，提供解决冲突的操作按钮。
 */
export function GitConflictPanel({
  projectPath,
  conflictFiles,
  operationState,
  onConflictResolved,
  onOpenConflictResolver,
}: GitConflictPanelProps) {
  const { t } = useTranslation();
  const conflictBusy = useGitConflictDraftStore(state => Boolean(state.busy[projectPath]));
  const remoteBusy = useGitRemoteStore(state => Boolean(state.busy[projectPath]));
  const beginOperation = useCallback(() => !useGitRemoteStore.getState().busy[projectPath]
    && useGitConflictDraftStore.getState().setOperationBusy(projectPath, true), [projectPath]);
  const [operating, setOperating] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [conflictDetail, setConflictDetail] =
    useState<GitConflictDetail | null>(null);
  const detailRequest = useRef(0);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const operationLabel = t(getGitOperationLabelKey(operationState));
  const abortLabel = t("sidebar.gitAbortOperation", { operation: operationLabel });
  const abortSupported = canAbortGitOperation(operationState);
  const continueLabel = t("sidebar.gitContinueOperation", { operation: operationLabel });
  const continueSupported = canContinueGitOperation(operationState);
  const hasConflicts = conflictFiles.length > 0;
  const conflictResolutionLabels = getGitConflictResolutionLabelKeys(operationState);

  // 加载冲突详情
  const loadConflictDetail = useCallback(
    async (filePath: string) => {
      const request = ++detailRequest.current;
      setConflictDetail(null);
      setLoadingDetail(true);
      try {
        const detail = await gitConflictDetail(projectPath, filePath);
        if (request === detailRequest.current) setConflictDetail(detail);
      } catch (e) {
        message.error(
          `${t("sidebar.gitConflictResolverLoadFailed")}: ${e instanceof Error ? e.message : String(e)}`
        );
      } finally {
        if (request === detailRequest.current) setLoadingDetail(false);
      }
    },
    [projectPath, t]
  );

  useEffect(() => {
    if (selectedFile) {
      void loadConflictDetail(selectedFile);
    } else {
      detailRequest.current++;
      setConflictDetail(null);
    }
  }, [selectedFile, loadConflictDetail]);

  // 解决冲突
  const handleResolve = useCallback(
    async (filePath: string, resolution: "ours" | "theirs" | "edited") => {
      if (operating || !conflictDetail || conflictDetail.filePath !== filePath) return;
      if (!beginOperation()) return;
      setOperating(filePath);
      try {
        await gitResolveConflict(projectPath, filePath, resolution, undefined, conflictDetail.revision);
        message.success(t("sidebar.gitResolveSuccess"));
        setSelectedFile(null);
        await onConflictResolved();
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        message.error(error.includes("git-conflict-stale") ? t("sidebar.gitConflictStale")
          : error.includes("git-conflict-busy") ? t("sidebar.gitConflictBusy") : `${t("sidebar.gitResolveFailed")}: ${error}`);
        if (error.includes("git-conflict-stale")) await loadConflictDetail(filePath);
      } finally {
        useGitConflictDraftStore.getState().setOperationBusy(projectPath, false);
        setOperating(null);
      }
    },
    [projectPath, onConflictResolved, t, conflictDetail, operating, beginOperation, loadConflictDetail]
  );

  // 根据仓库当前状态中止合并、变基、拣选或还原操作。
  const handleAbortOperation = useCallback(async () => {
    if (!beginOperation()) return;
    setOperating("abort");
    try {
      await gitAbortOperation(projectPath);
      message.success(t("sidebar.gitAbortOperationSuccess", { operation: operationLabel }));
      setSelectedFile(null);
      await onConflictResolved();
    } catch (e) {
      message.error(
        `${t("sidebar.gitAbortOperationFailed", { operation: operationLabel })}: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      useGitConflictDraftStore.getState().setOperationBusy(projectPath, false);
      setOperating(null);
    }
  }, [operationLabel, projectPath, onConflictResolved, t, beginOperation]);

  const handleContinueOperation = useCallback(async () => {
    if (!beginOperation()) return;
    setOperating("continue");
    try {
      await gitContinueOperation(projectPath);
      message.success(t("sidebar.gitContinueOperationSuccess", { operation: operationLabel }));
      setSelectedFile(null);
      await onConflictResolved();
    } catch (e) {
      message.error(
        `${t("sidebar.gitContinueOperationFailed", { operation: operationLabel })}: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      useGitConflictDraftStore.getState().setOperationBusy(projectPath, false);
      setOperating(null);
    }
  }, [operationLabel, projectPath, onConflictResolved, t, beginOperation]);

  if (!hasConflicts && !isGitOperationInProgress(operationState)) {
    return null;
  }

  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{
        border: "1px solid rgba(220, 38, 38, 0.3)",
        background: "rgba(220, 38, 38, 0.06)",
      }}
    >
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between px-2 py-1.5"
        style={{
          background: "rgba(220, 38, 38, 0.1)",
          borderBottom: "1px solid rgba(220, 38, 38, 0.2)",
        }}
      >
        <div className="flex items-center gap-1.5">
          <CloseCircleOutlined style={{ fontSize: 14, color: "var(--cs-error)" }} />
          <span
            className="text-[12px] font-semibold"
            style={{ color: "var(--cs-error)" }}
          >
            {hasConflicts
              ? t("sidebar.gitConflictDetected")
              : continueSupported
                ? t("sidebar.gitOperationReadyToContinue", { operation: operationLabel })
                : t("sidebar.gitOperationRequiresTerminal")}
          </span>
          {hasConflicts && (
            <span
              className="text-[10px] px-1 rounded-sm"
              style={{ background: "color-mix(in srgb, var(--cs-error) 15%, transparent)", color: "var(--cs-error)" }}
            >
              {conflictFiles.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip
            title={
              continueSupported && !hasConflicts
                ? continueLabel
                : hasConflicts
                  ? t("sidebar.gitResolveAllConflictsBeforeContinue")
                  : t("sidebar.gitOperationRequiresTerminal")
            }
            mouseEnterDelay={0.4}
          >
            <Button
              type="text"
              size="small"
              loading={operating === "continue"}
              disabled={!continueSupported || hasConflicts || operating !== null || conflictBusy || remoteBusy}
              style={{
                fontSize: 11,
                color: "var(--cs-success)",
                height: 22,
                padding: "0 6px",
              }}
              onClick={() => void handleContinueOperation()}
            >
              {continueLabel}
            </Button>
          </Tooltip>
          <Tooltip
            title={abortSupported ? abortLabel : t("sidebar.gitOperationRequiresTerminal")}
            mouseEnterDelay={0.4}
          >
            <Button
              type="text"
              size="small"
              loading={operating === "abort"}
              disabled={!abortSupported || operating !== null || conflictBusy || remoteBusy}
              style={{
                fontSize: 11,
                color: "var(--cs-error)",
                height: 22,
                padding: "0 6px",
              }}
              onClick={() => void handleAbortOperation()}
            >
              {abortLabel}
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-2 py-1.5"><GitConflictAgentAction projectPath={projectPath} disabled={operating !== null || conflictBusy || remoteBusy} /></div>
      {/* 冲突文件列表 */}
      {hasConflicts && <div className="px-1 py-1">
        {conflictFiles.map((file) => {
          const isSelected = selectedFile === file.path;
          const isOperating = operating === file.path;
          const fileName = file.path.split(/[/\\]/).pop() ?? file.path;

          return (
            <div key={file.path}>
              <div
                className="group flex items-center gap-1.5 px-2 cursor-pointer rounded-[4px]"
                style={{
                  height: 26,
                  background: isSelected
                    ? "rgba(220, 38, 38, 0.08)"
                    : "transparent",
                }}
                onClick={() => { setSelectedFile(file.path); onOpenConflictResolver(file.path); }}
              >
                <CloseCircleOutlined
                  style={{ fontSize: 12, color: "#9333ea" }}
                />
                <span
                  className="flex-1 truncate text-[12px]"
                  style={{ color: "var(--cs-text-primary)" }}
                >
                  {fileName}
                </span>
                <span className={"shrink-0 text-[10px] text-[var(--cs-text-secondary)]"}>
                  {t("sidebar.gitConflictResolverOpen")}
                </span>
                {isOperating && (
                  <LoadingOutlined
                    style={{ fontSize: 12, color: "var(--cs-text-tertiary)" }}
                  />
                )}
              </div>

              {/* 解决冲突的操作按钮 */}
              {isSelected && !isOperating && (
                <div className="flex flex-col gap-1 px-2 py-1.5">
                  {loadingDetail ? (
                    <div
                      className="flex items-center gap-1 py-1"
                      style={{ color: "var(--cs-text-tertiary)" }}
                    >
                      <LoadingOutlined style={{ fontSize: 11 }} />
                      <span className="text-[11px]">{t("common.loading")}</span>
                    </div>
                  ) : conflictDetail?.filePath === file.path ? (
                    <>
                      <div className="flex gap-1">
                        <Button
                          disabled={conflictBusy || remoteBusy}
                          size="small"
                          style={{
                            flex: 1,
                            fontSize: 11,
                            height: 26,
                            borderColor: "rgba(22, 163, 74, 0.3)",
                            color: "var(--cs-success)",
                          }}
                          onClick={() => void handleResolve(file.path, "ours")}
                        >
                          <CheckOutlined style={{ fontSize: 10 }} />
                          {t(conflictResolutionLabels.ours)}
                        </Button>
                        <Button
                          disabled={conflictBusy || remoteBusy}
                          size="small"
                          style={{
                            flex: 1,
                            fontSize: 11,
                            height: 26,
                            borderColor: "rgba(37, 99, 235, 0.3)",
                            color: "#2563eb",
                          }}
                          onClick={() =>
                            void handleResolve(file.path, "theirs")
                          }
                        >
                          <SwapOutlined style={{ fontSize: 10 }} />
                          {t(conflictResolutionLabels.theirs)}
                        </Button>
                      </div>
                      <Button
                        disabled={conflictBusy || remoteBusy}
                        size="small"
                        block
                        style={{
                          fontSize: 11,
                          height: 26,
                          borderColor: "rgba(107, 114, 128, 0.3)",
                          color: "var(--cs-text-secondary)",
                        }}
                        onClick={() =>
                          void handleResolve(file.path, "edited")
                        }
                      >
                        {t("sidebar.gitResolveEdited")}
                      </Button>

                      {/* 冲突内容预览 */}
                      {conflictDetail?.mergedContent && (
                        <div
                          className="mt-1 rounded-[4px] px-2 py-1 text-[10px] leading-[14px] overflow-auto"
                          style={{
                            maxHeight: 80,
                            background: "rgba(0, 0, 0, 0.05)",
                            color: "var(--cs-text-secondary)",
                            fontFamily: "var(--font-mono)",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {conflictDetail.mergedContent
                            .split("\n")
                            .slice(0, 10)
                            .join("\n")}
                          {conflictDetail.mergedContent.split("\n").length >
                            10 && "\n..."}
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
      }
    </div>
  );
}
