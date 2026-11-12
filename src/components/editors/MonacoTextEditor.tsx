import { registerRichCodeTokens } from "@/lib/monaco";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "@/lib/monacoRuntime";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import MonacoContextMenu from "@/components/editors/MonacoContextMenu";
import {
  disableMonacoCommandPalette,
  getMonacoLanguage,
  getMonacoThemeName,
  getMonacoTypography,
  observeMonacoTheme,
} from "@/lib/monaco";
import { useAppStore } from "@/store";
import { useFileEditorStatusStore } from "@/store/slices/fileEditorStatus";
import { useWorkspaceRecoveryStore } from "@/store/slices/workspaceRecovery";
import type { FileRevealTarget } from "@/lib/fileNavigation";

loader.config({ monaco });

interface MonacoTextEditorProps {
  isActive?: boolean;
  statusTabId?: string;
  filePath: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onSave?: () => void;
  saveEnabled?: boolean;
  /** Receives a 0-1 scroll ratio whenever the editor scrolls. */
  onScroll?: (ratio: number) => void;
  revealTarget?: FileRevealTarget | null;
  focusOnReveal?: boolean;
}

function MonacoTextEditor({
  isActive = true,
  statusTabId,
  filePath,
  value,
  readOnly,
  onChange,
  onSave,
  saveEnabled = false,
  onScroll,
  revealTarget,
  focusOnReveal = true,
}: MonacoTextEditorProps) {
  const lightTheme = useAppStore((s) => s.lightTheme);
  const darkTheme = useAppStore((s) => s.darkTheme);
  const themeCategory = useAppStore((s) => s.themeCategory);
  const editorFontSize = useAppStore((s) => s.editorFontSize);
  const systemPrefersDark = useAppStore((s) => s.systemPrefersDark);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorId = useId();
  // A file can be open in the workspace and auxiliary/search views at once.
  // The React wrapper reuses models by URI and disposes them on unmount,
  // so each editor must own a distinct model even for the same disk file.
  const modelPath = useMemo(() => monaco.Uri.file(filePath)
    .with({ query: `krosna-editor=${encodeURIComponent(editorId)}` }).toString(), [filePath, editorId]);
  const [editedModelPath, setEditedModelPath] = useState<string | null>(null);
  // View state cannot restore undo history. Once edited, keep this model alive
  // until its host closes, including after saving or undoing back to clean text.
  const mounted = isActive || editedModelPath === modelPath || saveEnabled;
  const savedView = useRef<{ path: string; state: monaco.editor.ICodeEditorViewState | null } | null>(null);
  const lastRevealedTarget = useRef<FileRevealTarget | null>(null);
  const statusDisposables = useRef<monaco.IDisposable[]>([]);
  const rememberRecoveryView = () => {
    const editor = editorRef.current;
    if (!editor || !statusTabId || useAppStore.getState().tabsById[statusTabId]?.kind !== "file") return;
    const position = editor.getPosition();
    if (!position) return;
    useWorkspaceRecoveryStore.getState().setEditorView(filePath, {
      lineNumber: position.lineNumber, column: position.column,
      scrollTop: editor.getScrollTop(), scrollLeft: editor.getScrollLeft(),
    });
  };
  useLayoutEffect(() => () => {
    // The React wrapper disposes models in passive cleanup. Capture state first.
    rememberRecoveryView();
    if (editorRef.current) savedView.current = { path: modelPath, state: editorRef.current.saveViewState() };
    editorRef.current = null;
    statusDisposables.current.forEach((disposable) => disposable.dispose());
    statusDisposables.current = [];
    if (statusTabId) useFileEditorStatusStore.getState().removeEditorStatus(statusTabId);
  }, [modelPath, mounted, statusTabId]);
  const onSaveRef = useRef(onSave);
  const saveEnabledRef = useRef(saveEnabled);
  onSaveRef.current = onSave;
  saveEnabledRef.current = saveEnabled;

  const revealLocation = (
    editorInstance: monaco.editor.IStandaloneCodeEditor,
    target: FileRevealTarget
  ) => {
    const endLineNumber = target.endLineNumber ?? target.lineNumber;
    const range = new monaco.Range(
      target.lineNumber,
      target.startColumn,
      endLineNumber,
      endLineNumber === target.lineNumber
        ? Math.max(target.startColumn, target.endColumn)
        : Math.max(1, target.endColumn)
    );
    editorInstance.setSelection(range);
    editorInstance.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
    lastRevealedTarget.current = target;
    if (focusOnReveal) editorInstance.focus();
  };

  const revealLocationAfterLayout = (
    editorInstance: monaco.editor.IStandaloneCodeEditor,
    target: FileRevealTarget
  ) => {
    // Monaco 首次挂载时可能尚未完成布局，导致定位请求被后续的首轮布局覆盖。
    // 下一帧重新布局后再定位，确保搜索预览和文件跳转都落在目标行。
    window.requestAnimationFrame(() => {
      if (editorRef.current !== editorInstance) return;
      editorInstance.layout();
      revealLocation(editorInstance, target);
    });
  };

  useEffect(() => {
    if (editorRef.current && revealTarget) {
      revealLocation(editorRef.current, revealTarget);
    }
  }, [revealTarget, focusOnReveal]);

  const isDark = useMemo(() => {
    if (themeCategory === "system") return systemPrefersDark;
    return themeCategory === "dark";
  }, [themeCategory, lightTheme, darkTheme, systemPrefersDark]);

  const language = useMemo(() => getMonacoLanguage(filePath), [filePath]);
  const theme = useMemo(() => getMonacoThemeName(isDark), [isDark]);
  useEffect(() => {
    const observer = observeMonacoTheme(isDark);
    return () => observer.dispose();
  }, [isDark]);
  const typography = getMonacoTypography(Math.max(13, editorFontSize));

  const handleMount: OnMount = (editor, monaco) => {
    registerRichCodeTokens();
    statusDisposables.current.forEach((disposable) => disposable.dispose());
    statusDisposables.current = [];
    editorRef.current = editor;
    const view = savedView.current?.path === modelPath ? savedView.current.state : null;
    if (view) editor.restoreViewState(view);
    const recovered = useWorkspaceRecoveryStore.getState().editorViews[filePath];
    if (!view && recovered && !revealTarget) {
      editor.setPosition({ lineNumber: recovered.lineNumber, column: recovered.column });
      editor.setScrollPosition({ scrollTop: recovered.scrollTop, scrollLeft: recovered.scrollLeft });
      window.requestAnimationFrame(() => {
        if (editorRef.current !== editor) return;
        editor.setScrollPosition({ scrollTop: recovered.scrollTop, scrollLeft: recovered.scrollLeft });
      });
    }
    if (statusTabId) {
      const updateStatus = () => {
        const model = editor.getModel();
        const position = editor.getPosition();
        if (!model || !position) return;
        const options = model.getOptions();
        const languageId = model.getLanguageId();
        const languageName = monaco.languages.getLanguages().find((entry: monaco.languages.ILanguageExtensionPoint) => entry.id === languageId)?.aliases?.[0] ?? languageId;
        useFileEditorStatusStore.getState().setEditorStatus(statusTabId, {
          line: position.lineNumber, column: position.column, language: languageName,
          eol: model.getEOL() === "\r\n" ? "CRLF" : "LF",
          tabSize: options.tabSize, insertSpaces: options.insertSpaces,
        });
      };
      statusDisposables.current = [
        editor.onDidChangeCursorPosition(updateStatus),
        editor.onDidChangeModel(updateStatus),
        editor.onDidChangeModelContent(updateStatus),
        editor.onDidChangeModelOptions(updateStatus),
        editor.onDidChangeModelLanguage(updateStatus),
        editor.onDidChangeCursorPosition(rememberRecoveryView),
        editor.onDidScrollChange(rememberRecoveryView),
      ];
      updateStatus();
    }
    disableMonacoCommandPalette(editor, monaco);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (saveEnabledRef.current) onSaveRef.current?.();
    });

    if (onScroll) {
      editor.onDidScrollChange((e) => {
        if (!e.scrollTopChanged) return;
        const scrollHeight = e.scrollHeight - editor.getLayoutInfo().height;
        if (scrollHeight <= 0) {
          onScroll(0);
          return;
        }
        onScroll(Math.min(1, Math.max(0, e.scrollTop / scrollHeight)));
      });
    }

    if (revealTarget && (!view || lastRevealedTarget.current !== revealTarget)) {
      revealLocationAfterLayout(editor, revealTarget);
    }
  };

  return (
    <MonacoContextMenu
      filePath={filePath}
      className="flex-1 min-h-0 w-full"
      getEditors={() => (editorRef.current ? [editorRef.current] : [])}
      saveAction={
        onSave
          ? {
              enabled: saveEnabled,
              run: onSave,
            }
          : undefined
      }
    >
      {mounted && <Editor
        key={modelPath}
        height="100%"
        width="100%"
        loading={null}
        path={modelPath}
        saveViewState={false}
        language={language}
        theme={theme}
        value={value}
        onMount={handleMount}
        onChange={(nextValue) => {
          if (!readOnly) setEditedModelPath(modelPath);
          onChange(nextValue ?? "");
        }}
        options={{
          automaticLayout: true,
          // No compiler highlight provider in review mode. Avoid Monaco 0.55's
          // uncaught cancellation when its delayed word highlighter is disposed.
          occurrencesHighlight: "off",
          contextmenu: false,
          minimap: { enabled: false },
          readOnly,
          wordWrap: "off",
          smoothScrolling: true,
          scrollBeyondLastLine: false,
          renderWhitespace: "selection",
          lineNumbers: "on",
          tabSize: 2,
          insertSpaces: true,
          ...typography,
          padding: {
            top: 12,
            bottom: 12,
          },
        }}
      />}
    </MonacoContextMenu>
  );
}

export default MonacoTextEditor;
