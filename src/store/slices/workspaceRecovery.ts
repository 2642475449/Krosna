import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getWorkspaceRestoreEnabled, setWorkspaceRestoreEnabled, onWorkspaceRestoreSettingsChanged,
  readWorkspaceRecovery, saveWorkspaceRecovery, gitDiffContent } from "@/lib/api";
import { captureWorkspaceRecovery, normalizeWorkspaceRecovery, getWorkspaceRestoreOrder,
  type WorkspaceRecoveryPayload } from "@/lib/workspaceRecovery";
import { normalizeWorkspace, syncWorkspaceSnapshot } from "../utils/workspace";
import { useAppStore } from "@/store";
import type { WindowProjectContext } from "@/types";
import type { GitDiffDocumentState, WorkspaceRecoveryState } from "../types";

let settingsRevision = 0;

export const useWorkspaceRecoveryStore = create<WorkspaceRecoveryState>()(persist((set) => ({
  enabled: true, settingsReady: false, savingSetting: false, projectPath: null, phase: "idle",
  error: null, restoreQueue: [], editorViews: {},
  setEnabled: async (enabled) => {
    settingsRevision += 1;
    set({ savingSetting: true });
    try {
      await setWorkspaceRestoreEnabled(enabled);
      set({ enabled, settingsReady: true, ...(enabled ? {} : { restoreQueue: [] }) });
    } finally { set({ savingSetting: false }); }
  },
  setEditorView: (path, view) => set((state) => ({ editorViews: { ...state.editorViews, [path]: view } })),
}), {
  name: "krosna-workspace-recovery-settings",
  partialize: ({ enabled }) => ({ enabled }),
}));

let settingsLoad: Promise<void> | undefined;
export function refreshWorkspaceRecoverySettings(): Promise<void> {
  if (settingsLoad) return settingsLoad;
  const revision = settingsRevision;
  settingsLoad = getWorkspaceRestoreEnabled().then((enabled) => {
    if (revision !== settingsRevision) return;
    useWorkspaceRecoveryStore.setState({ enabled, settingsReady: true, ...(enabled ? {} : { restoreQueue: [] }) });
  }).finally(() => { settingsLoad = undefined; });
  return settingsLoad;
}

let generation = 0;
let initializing: { key: string; promise: Promise<void> } | undefined;
let saveTail: Promise<void> = Promise.resolve();
let lastSaved = "";
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** 所有写入按顺序落盘；退出时等待队列，不能仅依赖 WebView 卸载回调。 */
export async function flushWorkspaceRecovery(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const recovery = useWorkspaceRecoveryStore.getState();
  if (recovery.phase !== "ready" || recovery.projectPath !== useAppStore.getState().currentProject?.path) {
    await saveTail;
    return;
  }
  const payload = captureWorkspaceRecovery(useAppStore.getState(), recovery.editorViews);
  if (!payload) return;
  const fingerprint = JSON.stringify({ ...payload, updatedAt: 0 });
  if (fingerprint === lastSaved) { await saveTail; return; }
  const write = saveTail.catch(() => {}).then(async () => {
    await saveWorkspaceRecovery(payload.projectPath, payload);
    lastSaved = fingerprint;
  });
  saveTail = write;
  await write;
}

async function loadDiffs(payload: WorkspaceRecoveryPayload): Promise<Record<string, GitDiffDocumentState>> {
  const documents: Record<string, GitDiffDocumentState> = {};
  for (const [id, descriptor] of Object.entries(payload.diffs)) {
    // 历史提交/冲突审阅不恢复旧全文；普通工作树 Diff 重新查询当前 Git 内容。
    if (descriptor.revision) { delete payload.workspace.tabsById[id]; continue; }
    try {
      const result = await gitDiffContent(payload.projectPath, descriptor.path, descriptor.staged, descriptor.oldPath);
      documents[id] = { ...descriptor, tabId: id,
        originalContent: result.originalContent, modifiedContent: result.modifiedContent,
        originalLabel: result.originalLabel, modifiedLabel: result.modifiedLabel,
        isBinary: result.isBinary, contentKind: result.contentKind,
        originalImage: result.originalImage, modifiedImage: result.modifiedImage };
    } catch (error) {
      console.warn("Could not restore diff tab", id, error);
      delete payload.workspace.tabsById[id];
    }
  }
  return documents;
}

/** 用独立分片接管启动恢复；主 store 保持现有运行态初始化语义。 */
export function initializeRecoverableWindowContext(context: WindowProjectContext): Promise<void> {
  const key = `${context.windowLabel}:${context.mode}:${context.projectPath ?? ""}`;
  if (initializing?.key === key) return initializing.promise;
  const current = useAppStore.getState();
  const recovery = useWorkspaceRecoveryStore.getState();
  if (current.windowContextReady && current.windowLabel === context.windowLabel && current.windowMode === context.mode
    && current.currentProject?.path === context.projectPath && recovery.projectPath === context.projectPath && recovery.phase === "ready") {
    return Promise.resolve();
  }
  const token = ++generation;
  const promise = (async () => {
    await flushWorkspaceRecovery();
    if (token !== generation) return;
    const path = context.mode === "project" ? context.projectPath : null;
    const prior = useAppStore.getState();
    // 首次升级时从旧会话标签迁移；以后以独立的 SQLite 工作区记录为准。
    const legacy = path ? normalizeWorkspaceRecovery({ version: 1, projectPath: path, updatedAt: 0,
      sessions: prior.projectSessions[path] ?? [], workspace: prior.projectWorkspaces[path], editorViews: {}, diffs: {} }, path) : null;
    useWorkspaceRecoveryStore.setState({ phase: "loading", projectPath: path ?? null, error: null, restoreQueue: [] });
    let payload: WorkspaceRecoveryPayload | null = null;
    let loadError: unknown;
    try {
      await refreshWorkspaceRecoverySettings();
      if (path) payload = normalizeWorkspaceRecovery(await readWorkspaceRecovery(path), path) ?? legacy;
    } catch (error) { loadError = error; console.error("Could not read workspace recovery", error); }
    if (token !== generation) return;
    const enabled = useWorkspaceRecoveryStore.getState().enabled;
    const documents = payload && enabled && !loadError ? await loadDiffs(payload) : {};
    if (token !== generation) return;
    useAppStore.getState().initializeWindowContext(context);
    if (path && payload) {
      useAppStore.setState((state) => {
        const byId = new Map(state.sessions.map((session) => [session.id, session]));
        // 即使关闭自动恢复，也保留历史 Agent；普通 Shell 只在恢复工作区时重新创建。
        for (const session of payload.sessions) {
          if (enabled || (session.agentId !== "cmd" && session.agentId !== "powershell" && !session.ephemeral)) {
            byId.set(session.id, { ...session, workspaceRestorePending: enabled && !loadError });
          }
        }
        const sessions = [...byId.values()];
        if (!enabled || loadError) return { sessions, projectSessions: { ...state.projectSessions, [path]: sessions } };
        const workspace = normalizeWorkspace(payload.workspace, sessions);
        return { sessions, projectSessions: { ...state.projectSessions, [path]: sessions },
          projectWorkspaces: { ...state.projectWorkspaces, [path]: workspace },
          gitDiffDocuments: documents, ...syncWorkspaceSnapshot(workspace) };
      });
    }
    const restoredPayload = payload && enabled && !loadError ? payload : null;
    lastSaved = "";
    useWorkspaceRecoveryStore.setState({ phase: loadError ? "error" : "ready", projectPath: path ?? null,
      error: loadError ? String(loadError) : null, editorViews: restoredPayload?.editorViews ?? {},
      restoreQueue: restoredPayload ? getWorkspaceRestoreOrder(restoredPayload) : [] });
  })();
  initializing = { key, promise };
  void promise.finally(() => { if (initializing?.promise === promise) initializing = undefined; }).catch(() => {});
  return promise;
}

export function takeWorkspaceRestoreSession(): string | undefined {
  const state = useWorkspaceRecoveryStore.getState();
  if (!state.enabled || state.phase !== "ready") return;
  const [sessionId, ...rest] = state.restoreQueue;
  if (sessionId) useWorkspaceRecoveryStore.setState({ restoreQueue: rest });
  return sessionId;
}

export function startWorkspaceRecoverySync(): () => void {
  const schedule = () => {
    if (saveTimer || useWorkspaceRecoveryStore.getState().phase !== "ready") return;
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      void flushWorkspaceRecovery().catch((error) => {
        console.error("Could not save workspace recovery", error);
        useWorkspaceRecoveryStore.setState({ error: String(error) });
      });
    }, 750);
  };
  const stopApp = useAppStore.subscribe(schedule);
  const stopRecovery = useWorkspaceRecoveryStore.subscribe((state, previous) => {
    if (state.editorViews !== previous.editorViews || state.phase !== previous.phase) schedule();
  });
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const listener = onWorkspaceRestoreSettingsChanged((enabled) => {
    settingsRevision += 1;
    useWorkspaceRecoveryStore.setState({ enabled, settingsReady: true, ...(enabled ? {} : { restoreQueue: [] }) });
  });
  void listener.then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch(console.error);
  schedule();
  return () => { disposed = true; stopApp(); stopRecovery(); clearTimeout(saveTimer); saveTimer = undefined;
    unlisten?.(); unlisten = undefined; };
}
