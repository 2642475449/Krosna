import { createStore } from "zustand/vanilla";
import {
  inspectProjectFile, readProjectFile, readProjectImage, readProjectPdf, writeProjectFile,
} from "@/lib/api";
import { stripAnsiEscapeSequences } from "@/lib/textContent";

type FileStatus = Awaited<ReturnType<typeof inspectProjectFile>>;
export interface FileDocumentState {
  status: FileStatus | null;
  loading: boolean;
  content: string;
  savedContent: string;
  savedDiskContent: string;
  encoding: string | null;
  imageSrc: string | null;
  pdfData: Uint8Array | null;
  error: string | null;
  conflict: boolean;
  saving: boolean;
  autoSavePaused: boolean;
}

// Both hosts subscribe to the same document, including edits that are not saved yet.
export function fileDocumentKey(projectPath: string, path: string) {
  const normalize = (value: string) => {
    const windows = /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\");
    const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
    return windows ? normalized.toLowerCase() : normalized;
  };
  return JSON.stringify([normalize(projectPath), normalize(path)]);
}

export function createFileDocument(projectPath: string, path: string, onActivityComplete?: () => void) {
  const store = createStore<FileDocumentState>(() => ({
    status: null, loading: true, content: "", savedContent: "", savedDiskContent: "", encoding: null,
    imageSrc: null, pdfData: null, error: null, conflict: false, saving: false, autoSavePaused: false,
  }));
  let loadInFlight: Promise<void> | null = null;
  let saveInFlight: Promise<boolean> | null = null;
  let refreshInFlight: Promise<void> | null = null;
  let generation = 0;
  let autoSavePauses = 0;
  const dirty = () => store.getState().content !== store.getState().savedContent;
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

  function load(discardChanges = false): Promise<void> {
    if (loadInFlight) return loadInFlight;
    if (store.getState().saving || (dirty() && !discardChanges)) return Promise.resolve();
    const version = ++generation;
    const previous = store.getState();
    // Refresh in place: keep the preview mounted and preserve its scroll position.
    store.setState({ loading: previous.status === null, error: null });
    loadInFlight = (async () => {
      try {
        const status = await inspectProjectFile(projectPath, path);
        let patch: Partial<FileDocumentState> = { status, conflict: false };
        if (status.kind === "text") {
          const file = await readProjectFile(projectPath, path);
          const content = stripAnsiEscapeSequences(file.content);
          patch = {
            ...patch,
            status: { ...status, readOnly: file.readOnly, sizeBytes: file.sizeBytes, largeFile: file.largeFile, modifiedAtMs: file.modifiedAtMs ?? status.modifiedAtMs },
            content, savedContent: content, savedDiskContent: file.content, encoding: file.encoding,
          };
        } else if (status.kind === "image") {
          patch.imageSrc = (await readProjectImage(projectPath, path)).dataUrl;
        } else if (status.kind === "pdf") {
          patch.pdfData = await readProjectPdf(projectPath, path);
        }
        // A user may have typed while the disk read was in flight.
        if (version === generation && store.getState().content === previous.content) store.setState(patch);
      } catch (error) {
        if (version === generation) store.setState({ error: errorText(error) });
      } finally {
        store.setState({ loading: false });
        loadInFlight = null;
        onActivityComplete?.();
      }
    })();
    return loadInFlight;
  }

  function refresh(): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    if (loadInFlight || store.getState().saving) return Promise.resolve();
    const version = generation;
    refreshInFlight = (async () => {
      try {
        const status = await inspectProjectFile(projectPath, path);
        if (version !== generation || store.getState().saving) return;
        const previousStatus = store.getState().status;
        if (status.modifiedAtMs === previousStatus?.modifiedAtMs && status.sizeBytes === previousStatus?.sizeBytes) return;
        if (dirty()) store.setState({ conflict: true });
        else await load();
      } catch (error) {
        if (version === generation) store.setState({ error: errorText(error) });
      } finally {
        refreshInFlight = null;
        onActivityComplete?.();
      }
    })();
    return refreshInFlight;
  }

  function save(overwrite = false): Promise<boolean> {
    if (store.getState().autoSavePaused) return Promise.resolve(false);
    if (saveInFlight) return saveInFlight;
    if (!dirty()) return Promise.resolve(true);
    if (store.getState().status?.readOnly || store.getState().status?.kind !== "text") return Promise.resolve(false);
    const version = ++generation;
    store.setState({ saving: true });
    saveInFlight = (async () => {
      try {
        while (dirty()) {
          if (version !== generation || store.getState().autoSavePaused) return false;
          const snapshot = store.getState();
          const before = await inspectProjectFile(projectPath, path);
          if (version !== generation || store.getState().autoSavePaused) return false;
          if (before.readOnly) throw new Error("File is read-only");
          if (!overwrite && (snapshot.conflict || before.modifiedAtMs !== snapshot.status?.modifiedAtMs)) {
            store.setState({ conflict: true });
            return false;
          }
          const expected = overwrite
            ? await readProjectFile(projectPath, path)
            : { content: snapshot.savedDiskContent, encoding: snapshot.encoding ?? "utf-8" };
          if (version !== generation || store.getState().autoSavePaused) return false;
          await writeProjectFile(projectPath, path, snapshot.content, snapshot.encoding ?? undefined,
            { content: expected.content, encoding: expected.encoding });
          if (version !== generation) return false;
          // Pair the saved snapshot with metadata from the same content read.
          // A separate post-write inspect can accidentally adopt an external edit's version.
          const file = await readProjectFile(projectPath, path);
          if (version !== generation) return false;
          if (stripAnsiEscapeSequences(file.content) !== snapshot.content) {
            store.setState({ conflict: true });
            return false;
          }
          const status = {
            ...before, readOnly: file.readOnly, sizeBytes: file.sizeBytes,
            largeFile: file.largeFile, modifiedAtMs: file.modifiedAtMs,
          };
          store.setState({ status, encoding: file.encoding, savedContent: snapshot.content,
            savedDiskContent: file.content, error: null, conflict: false });
          // Explicit overwrite applies only to the conflict the user approved.
          overwrite = false;
        }
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("krosna:git-refresh", {
          detail: { projectPath, path },
        }));
        return true;
      } catch (error) {
        if (version === generation) {
          if (errorText(error) === "file-write-conflict") store.setState({ conflict: true, error: null });
          else store.setState({ error: errorText(error) });
        }
        return false;
      } finally {
        store.setState({ saving: false });
        saveInFlight = null;
        onActivityComplete?.();
      }
    })();
    return saveInFlight;
  }

  function pauseAutoSave() {
    autoSavePauses += 1;
    store.setState({ autoSavePaused: true });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      autoSavePauses -= 1;
      store.setState({ autoSavePaused: autoSavePauses > 0 });
    };
  }

  async function discardChanges() {
    const resume = pauseAutoSave();
    ++generation;
    // Clear edits synchronously so unmount cleanup and other hosts cannot save them.
    store.setState((state) => ({ content: state.savedContent, conflict: false, error: null }));
    try {
      // Writes already sent to the OS cannot be cancelled. Stop their drain loop
      // and read the actual disk state after they settle.
      await Promise.all([saveInFlight, loadInFlight]);
      await load(true);
    } finally {
      resume();
    }
  }

  return {
    projectPath, path,
    store, load, refresh, save, pauseAutoSave, discardChanges,
    isBusy: () => Boolean(loadInFlight || saveInFlight || refreshInFlight),
    setContent(content: string) { store.setState({ content }); },
  };
}

const documents = new Map<string, ReturnType<typeof createFileDocument>>();
// 包括辅助栏与暂时没有挂载视图的草稿，关闭时不能只检查主工作区标签。
export function getUnsavedFileDocuments() {
  return [...documents.values()].filter((document) => {
    const state = document.store.getState();
    return state.saving || state.content !== state.savedContent;
  }).map((document) => ({ projectPath: document.projectPath, path: document.path, document }));
}
interface FileDocumentLease {
  count: number;
  expiresAt?: number;
  timer?: ReturnType<typeof setTimeout>;
  unsubscribe?: () => void;
}
const leases = new Map<string, FileDocumentLease>();
const FILE_DOCUMENT_HANDOFF_MS = 30_000;

function stopDocumentCleanup(lease: FileDocumentLease) {
  clearTimeout(lease.timer);
  lease.timer = undefined;
  lease.unsubscribe?.();
  lease.unsubscribe = undefined;
}

function reconsiderDocumentCleanup(key: string, lease: FileDocumentLease) {
  if (leases.get(key) !== lease || lease.count > 0 || lease.expiresAt === undefined) return;
  const document = documents.get(key);
  const remaining = lease.expiresAt - Date.now();
  if (remaining > 0) {
    if (lease.timer === undefined) lease.timer = setTimeout(() => {
      lease.timer = undefined;
      reconsiderDocumentCleanup(key, lease);
    }, remaining);
    return;
  }
  const state = document?.store.getState();
  // 忙碌和未保存草稿由状态订阅、异步完成回调再次检查，不轮询，也不丢弃编辑。
  if (document?.isBusy() || state?.saving || state?.loading || state?.content !== state?.savedContent) return;
  stopDocumentCleanup(lease);
  documents.delete(key);
  leases.delete(key);
}
export function findFileDocument(projectPath: string, path: string) {
  return documents.get(fileDocumentKey(projectPath, path));
}
export function getFileDocument(projectPath: string, path: string) {
  const key = fileDocumentKey(projectPath, path);
  let document = documents.get(key);
  if (!document) {
    document = createFileDocument(projectPath, path, () => {
      const lease = leases.get(key);
      if (lease) reconsiderDocumentCleanup(key, lease);
    });
    documents.set(key, document);
  }
  return document;
}

export function retainFileDocument(projectPath: string, path: string) {
  const key = fileDocumentKey(projectPath, path);
  const lease: FileDocumentLease = leases.get(key) ?? { count: 0 };
  stopDocumentCleanup(lease);
  lease.expiresAt = undefined;
  lease.count += 1;
  leases.set(key, lease);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lease.count -= 1;
    if (lease.count) return;
    // 主区/辅助区交接时保留短暂缓存；过期后仍忙的文档在结束时继续回收。
    lease.expiresAt = Date.now() + FILE_DOCUMENT_HANDOFF_MS;
    lease.unsubscribe = documents.get(key)?.store.subscribe(() => reconsiderDocumentCleanup(key, lease));
    reconsiderDocumentCleanup(key, lease);
  };
}
