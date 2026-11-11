import { registerRichCodeTokens } from "@/lib/monaco";
import { CheckOutlined, CopyOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { Editor, loader } from "@monaco-editor/react";
import { Alert, Button, Empty, Modal, Spin, message } from "antd";
import * as monaco from "@/lib/monacoRuntime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { gitConflictDetail, gitResolveConflict } from "@/lib/api";
import { getGitConflictResolutionLabelKeys, getGitOperationLabelKey } from "@/lib/gitOperationState";
import { requestGitStatusRefresh } from "@/lib/gitStatusEvents";
import { getMonacoLanguage, getMonacoThemeName, getMonacoTypography, observeMonacoTheme } from "@/lib/monaco";
import { useAppStore } from "@/store";
import { hasGitConflictMarkers, parseGitConflictBlocks, resolveGitConflictBlock } from "@/lib/gitConflict";
import { useGitConflictDraftStore } from "@/store/slices/gitConflictDraft";
import { useGitRemoteStore } from "@/store/slices/gitRemote";
import { useGitStatusStore } from "@/store/slices/gitStatus";

loader.config({ monaco });
registerRichCodeTokens();

type ConflictSource = "base" | "ours" | "theirs";

interface GitConflictTabViewProps {
  projectPath: string;
  filePath: string;
  isBinary: boolean;
}

interface ConflictSourcePaneProps {
  title: string;
  content: string | null;
  language: string;
  theme: string;
  typography: ReturnType<typeof getMonacoTypography>;
  actionLabel?: string;
  deleteActionLabel?: string;
  disabled: boolean;
  onUse?: () => void;
  onAcceptDeletion?: () => void;
  unavailableLabel: string;
}

function ConflictSourcePane({
  title,
  content,
  language,
  theme,
  typography,
  actionLabel,
  deleteActionLabel,
  disabled,
  onUse,
  onAcceptDeletion,
  unavailableLabel,
}: ConflictSourcePaneProps) {
  const isDeletion = content === null;

  return (
    <section className="flex min-h-0 flex-col bg-[var(--cs-bg-app)]">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--cs-border-sidebar)] px-3">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--cs-text-primary)]">{title}</span>
        {isDeletion && onAcceptDeletion && deleteActionLabel ? (
          <Button size="small" danger disabled={disabled} onClick={onAcceptDeletion}>{deleteActionLabel}</Button>
        ) : onUse && actionLabel ? (
          <Button size="small" icon={<CopyOutlined />} disabled={disabled} onClick={onUse}>{actionLabel}</Button>
        ) : null}
      </div>
      {isDeletion ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={unavailableLabel} />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language={language}
            theme={theme}
            value={content}
            options={{
              readOnly: true,
              contextmenu: false,
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              renderWhitespace: "selection",
              wordWrap: "off",
              ...typography,
            }}
          />
        </div>
      )}
    </section>
  );
}

/** Git 冲突专用标签页：同时展示共同祖先、双方版本和可编辑的最终结果。 */
export function GitConflictTabView({ projectPath, filePath, isBinary }: GitConflictTabViewProps) {
  const { t } = useTranslation();
  const lightTheme = useAppStore((state) => state.lightTheme);
  const darkTheme = useAppStore((state) => state.darkTheme);
  const themeCategory = useAppStore((state) => state.themeCategory);
  const editorFontSize = useAppStore((state) => state.editorFontSize);
  const systemPrefersDark = useAppStore((state) => state.systemPrefersDark);
  const operationState = useGitStatusStore((state) => state.entries[projectPath]?.branchInfo?.operationState ?? "clean");
  const draftKey = JSON.stringify([projectPath, filePath]);
  const draft = useGitConflictDraftStore(state => state.drafts[draftKey]);
  const { setDraft, clearDraft } = useGitConflictDraftStore.getState();
  const detail = draft?.detail;
  const result = draft?.result ?? "";
  const initialResult = draft?.initialResult ?? "";
  const setResult = useCallback((value: string) => useGitConflictDraftStore.getState().setResult(draftKey, value), [draftKey]);
  const [modal, modalContextHolder] = Modal.useModal();
  const loadRequestRef = useRef(0);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const [blockIndex, setBlockIndex] = useState(0);
  const blocks = useMemo(() => parseGitConflictBlocks(result), [result]);
  const currentBlock = Math.min(blockIndex, Math.max(0, blocks.length - 1));
  const blockDecorations = useMemo<monaco.editor.IModelDeltaDecoration[]>(() => {
    const block = blocks[currentBlock];
    return block ? [{ range: new monaco.Range(block.line, 1, block.line + result.slice(block.start, block.end).replace(/\r?\n$/, "").split("\n").length - 1, 1),
      options: { isWholeLine: true, className: "app-git-conflict-current", linesDecorationsClassName: "app-git-conflict-gutter" } }] : [];
  }, [blocks, currentBlock, result]);
  useEffect(() => { decorationsRef.current?.set(blockDecorations); }, [blockDecorations]);
  const remoteOperationBusy = useGitRemoteStore(state => Boolean(state.busy[projectPath]));
  const conflictBusy = useGitConflictDraftStore(state => Boolean(state.busy[projectPath]));
  const remoteBusy = remoteOperationBusy || conflictBusy;
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  const isDark = useMemo(() => {
    if (themeCategory === "system") return systemPrefersDark;
    return themeCategory === "dark";
  }, [darkTheme, lightTheme, systemPrefersDark, themeCategory]);
  const language = useMemo(() => getMonacoLanguage(filePath), [filePath]);
  const theme = useMemo(() => getMonacoThemeName(isDark), [isDark]);
  useEffect(() => {
    const observer = observeMonacoTheme(isDark);
    return () => observer.dispose();
  }, [isDark]);
  const typography = useMemo(() => getMonacoTypography(Math.max(13, editorFontSize)), [editorFontSize]);
  const resolutionLabels = getGitConflictResolutionLabelKeys(operationState);
  const oursLabel = t(resolutionLabels.ours);
  const theirsLabel = t(resolutionLabels.theirs);
  const operationLabel = t(getGitOperationLabelKey(operationState));
  const hasMarkers = hasGitConflictMarkers(result);

  const loadDetail = useCallback(async () => {
    const request = ++loadRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const nextDetail = await gitConflictDetail(projectPath, filePath);
      if (request !== loadRequestRef.current) return;

      if (!nextDetail.hasConflict) {
        clearDraft(draftKey);
        setResolved(true);
        return;
      }
      setStale(false);
      setDraft(draftKey, nextDetail);
      setBlockIndex(0);
      setResolved(false);
    } catch (reason) {
      if (request === loadRequestRef.current) setLoadError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === loadRequestRef.current) setLoading(false);
    }
  }, [filePath, projectPath, draftKey, clearDraft, setDraft]);

  useEffect(() => {
    setResolved(false);
    if (useGitConflictDraftStore.getState().drafts[draftKey]) setLoading(false);
    else void loadDetail();
    return () => { loadRequestRef.current++; };
  }, [draftKey, loadDetail]);

  const confirmReplacement = (action: () => void) => {
    modal.confirm({
      title: t("sidebar.gitConflictDiscardTitle"),
      content: t("sidebar.gitConflictDiscardDescription"),
      okText: t("sidebar.gitConflictDiscard"), cancelText: t("common.cancel"),
      okButtonProps: { danger: true }, onOk: action,
    });
  };
  const requestReload = () => {
    if (result !== initialResult) confirmReplacement(() => void loadDetail());
    else void loadDetail();
  };
  const reportResolveError = (reason: unknown) => {
    const error = reason instanceof Error ? reason.message : String(reason);
    if (error.includes("git-conflict-stale")) setStale(true);
    message.error(error.includes("git-conflict-stale") ? t("sidebar.gitConflictStale")
      : error.includes("git-conflict-busy") ? t("sidebar.gitConflictBusy")
      : `${t("sidebar.gitConflictResolverResolveFailed")}: ${error}`);
  };
  const navigateBlock = (index: number) => {
    setBlockIndex(index);
    const block = blocks[index];
    if (block) { editorRef.current?.revealLineInCenter(block.line); editorRef.current?.setPosition({ lineNumber: block.line, column: 1 }); }
  };
  const acceptBlock = (choice: "ours" | "theirs" | "both") => {
    const next = resolveGitConflictBlock(result, currentBlock, choice);
    const editor = editorRef.current;
    const model = editor?.getModel();
    const block = blocks[currentBlock];
    if (editor && model && block && model.getValue() === result) {
      const start = model.getPositionAt(block.start);
      const end = model.getPositionAt(block.end);
      const replacement = choice === "both" ? block.ours + block.theirs : block[choice];
      editor.pushUndoStop();
      editor.executeEdits("git-conflict", [{ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: replacement }]);
      editor.pushUndoStop();
    }
    setResult(next);
    const remaining = parseGitConflictBlocks(next);
    const nextBlock = remaining[Math.min(currentBlock, remaining.length - 1)];
    if (nextBlock) editor?.revealLineInCenter(nextBlock.line);
    editor?.focus();
  };

  const handleResolveAsDeletedSide = useCallback(async (resolution: "ours" | "theirs") => {
    if (useGitRemoteStore.getState().busy[projectPath]
      || !useGitConflictDraftStore.getState().setOperationBusy(projectPath, true)) return;
    setResolving(true);
    try {
      await gitResolveConflict(projectPath, filePath, resolution, undefined, detail?.revision);
      clearDraft(draftKey);
      setResolved(true);
      requestGitStatusRefresh(projectPath);
      message.success(t("sidebar.gitConflictResolverStageSuccess"));
    } catch (reason) {
      reportResolveError(reason);
    } finally {
      useGitConflictDraftStore.getState().setOperationBusy(projectPath, false);
      setResolving(false);
    }
  }, [filePath, projectPath, t, detail?.revision, clearDraft, draftKey]);

  const handleStageResult = useCallback(async () => {
    if (hasMarkers) return;
    if (useGitRemoteStore.getState().busy[projectPath]
      || !useGitConflictDraftStore.getState().setOperationBusy(projectPath, true)) return;
    setResolving(true);
    try {
      await gitResolveConflict(projectPath, filePath, "edited", result, detail?.revision);
      clearDraft(draftKey);
      setResolved(true);
      requestGitStatusRefresh(projectPath);
      message.success(t("sidebar.gitConflictResolverStageSuccess"));
    } catch (reason) {
      reportResolveError(reason);
    } finally {
      useGitConflictDraftStore.getState().setOperationBusy(projectPath, false);
      setResolving(false);
    }
  }, [filePath, hasMarkers, projectPath, result, t, detail?.revision, clearDraft, draftKey]);

  if (loading) return <div className="flex h-full items-center justify-center"><Spin /></div>;

  if (loadError && !detail) {
    return <div className="p-4"><Alert type="error" showIcon title={t("sidebar.gitConflictResolverLoadFailed")} description={loadError} action={<Button size="small" icon={<ReloadOutlined />} onClick={requestReload}>{t("sidebar.gitConflictResolverReload")}</Button>} /></div>;
  }

  if (resolved || !detail?.hasConflict) {
    return <div className="p-4"><Alert type="success" showIcon title={t("sidebar.gitConflictResolverResolved")} description={t("sidebar.gitConflictResolverResolvedDescription", { operation: operationLabel })} action={<Button size="small" icon={<ReloadOutlined />} onClick={requestReload}>{t("sidebar.gitConflictResolverReload")}</Button>} /></div>;
  }

  if (isBinary) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        <Alert type="warning" showIcon title={t("sidebar.gitConflictResolverBinary")} description={t("sidebar.gitConflictResolverBinaryDescription")} />
        <div className="flex flex-wrap gap-2">
          <Button type="primary" disabled={remoteBusy || resolving || stale} loading={resolving} onClick={() => void handleResolveAsDeletedSide("ours")}>{oursLabel}</Button>
          <Button disabled={remoteBusy || resolving || stale} loading={resolving} onClick={() => void handleResolveAsDeletedSide("theirs")}>{theirsLabel}</Button>
        </div>
      </div>
    );
  }

  const sourcePanes: Array<{ source: ConflictSource; title: string; content: string | null; actionLabel?: string; deleteActionLabel?: string }> = [
    { source: "base", title: t("sidebar.gitConflictResolverBase"), content: detail.baseContent },
    { source: "ours", title: oursLabel, content: detail.oursContent, actionLabel: t("sidebar.gitConflictReplaceResult"), deleteActionLabel: t("sidebar.gitConflictResolverAcceptDeletion", { version: oursLabel }) },
    { source: "theirs", title: theirsLabel, content: detail.theirsContent, actionLabel: t("sidebar.gitConflictReplaceResult"), deleteActionLabel: t("sidebar.gitConflictResolverAcceptDeletion", { version: theirsLabel }) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--cs-bg-app)]">
      {modalContextHolder}
      {stale ? <Alert type="warning" showIcon title={t("sidebar.gitConflictStale")} /> : null}
      {loadError ? <Alert type="error" showIcon title={loadError} /> : null}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--cs-border-sidebar)] px-3 py-2">
        <div className="min-w-0 flex-1 basis-full xl:basis-auto">
          <div className="flex items-center gap-2">
            <WarningOutlined className="text-[var(--cs-warning)]" />
            <h1 className="m-0 truncate text-sm font-semibold text-[var(--cs-text-primary)]">{t("sidebar.gitConflictResolverTitle")}</h1>
          </div>
          <p className="m-0 mt-1 truncate text-xs text-[var(--cs-text-tertiary)]" title={filePath}>{filePath}</p>
        </div>
        <Button icon={<ReloadOutlined />} disabled={resolving || remoteBusy} onClick={requestReload}>{t("sidebar.gitConflictResolverReload")}</Button>
        <Button type="primary" icon={<CheckOutlined />} danger={hasMarkers} disabled={hasMarkers || stale || resolving || remoteBusy} loading={resolving} onClick={() => void handleStageResult()}>{t("sidebar.gitConflictResolverStage")}</Button>
      </div>

      <div className="shrink-0 border-b border-[var(--cs-border-sidebar)] px-3 py-2">
        <Alert type={hasMarkers ? "warning" : "info"} showIcon title={hasMarkers ? t("sidebar.gitConflictResolverMarkersRemain") : t("sidebar.gitConflictResolverIntro")} description={hasMarkers ? t("sidebar.gitConflictResolverMarkersRemainDescription") : t("sidebar.gitConflictResolverIntroDescription")} />
      </div>

      <div className="grid min-h-[220px] flex-1 grid-cols-1 gap-px overflow-hidden bg-[var(--cs-border-sidebar)] lg:grid-cols-3">
        {sourcePanes.map((pane) => (
          <ConflictSourcePane
            key={pane.source}
            title={pane.title}
            content={pane.content}
            language={language}
            theme={theme}
            typography={typography}
            actionLabel={pane.actionLabel}
            deleteActionLabel={pane.deleteActionLabel}
            disabled={resolving || remoteBusy}
            unavailableLabel={t("sidebar.gitConflictResolverDeleted")}
            onUse={pane.source === "base" || pane.content === null ? undefined : () => confirmReplacement(() => setResult(pane.content ?? ""))}
            onAcceptDeletion={pane.source === "base" || pane.content !== null ? undefined : () => void handleResolveAsDeletedSide(pane.source as "ours" | "theirs")}
          />
        ))}
      </div>

      <section className="flex min-h-[260px] flex-[1.15] flex-col border-t border-[var(--cs-border-sidebar)] bg-[var(--cs-bg-app)]">
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--cs-border-sidebar)] px-3">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--cs-text-primary)]">{t("sidebar.gitConflictResolverResult")}</span>
          {blocks.length > 0 ? <div className="flex flex-wrap items-center gap-1 py-1" aria-label={t("sidebar.gitConflictBlocks")}>
            <span className="text-xs text-[var(--cs-text-secondary)]" aria-live="polite">{t("sidebar.gitConflictBlockPosition", { current: currentBlock + 1, total: blocks.length })}</span>
            <Button size="small" disabled={currentBlock === 0} onClick={() => navigateBlock(currentBlock - 1)}>{t("sidebar.gitConflictPrevious")}</Button>
            <Button size="small" disabled={currentBlock + 1 >= blocks.length} onClick={() => navigateBlock(currentBlock + 1)}>{t("sidebar.gitConflictNext")}</Button>
            <Button size="small" disabled={resolving || remoteBusy} onClick={() => acceptBlock("ours")}>{oursLabel}</Button>
            <Button size="small" disabled={resolving || remoteBusy} onClick={() => acceptBlock("theirs")}>{theirsLabel}</Button>
            <Button size="small" disabled={resolving || remoteBusy} onClick={() => acceptBlock("both")}>{t("sidebar.gitConflictAcceptBoth")}</Button>
          </div> : null}
          <Button size="small" disabled={resolving || remoteBusy || result === initialResult} onClick={() => confirmReplacement(() => setResult(initialResult))}>{t("sidebar.gitConflictResolverReset")}</Button>
        </div>
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language={language}
            theme={theme}
            value={result}
            onMount={(editor) => { editorRef.current = editor; decorationsRef.current = editor.createDecorationsCollection(blockDecorations); }}
            onChange={(value) => setResult(value ?? "")}
            options={{ readOnly: resolving || remoteBusy, contextmenu: false, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, smoothScrolling: true, renderWhitespace: "selection", wordWrap: "off", ...typography }}
          />
        </div>
      </section>
    </div>
  );
}
