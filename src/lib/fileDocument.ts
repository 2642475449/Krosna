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

export function createFileDocument(projectPath: string, path: string) {
  const store = createStore<FileDocumentState>(() => ({
    status: null, loading: true, content: "", savedContent: "", encoding: null,
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
            content, savedContent: content, encoding: file.encoding,
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
        if (status.modifiedAtMs === store.getState().status?.modifiedAtMs) return;
        if (dirty()) store.setState({ conflict: true });
        else await load();
      } catch (error) {
        if (version === generation) store.setState({ error: errorText(error) });
      } finally {
        refreshInFlight = null;
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
          await writeProjectFile(projectPath, path, snapshot.content, snapshot.encoding ?? undefined);
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
          store.setState({ status, encoding: file.encoding, savedContent: snapshot.content, error: null, conflict: false });
          // Explicit overwrite applies only to the conflict the user approved.
          overwrite = false;
        }
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("termflow:git-refresh", {
          detail: { projectPath, path },
        }));
        return true;
      } catch (error) {
        if (version === generation) store.setState({ error: errorText(error) });
        return false;
      } finally {
        store.setState({ saving: false });
        saveInFlight = null;
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
    store, load, refresh, save, pauseAutoSave, discardChanges,
    setContent(content: string) { store.setState({ content }); },
  };
}

const documents = new Map<string, ReturnType<typeof createFileDocument>>();
const leases = new Map<string, { count: number; timer?: ReturnType<typeof setTimeout> }>();
export function findFileDocument(projectPath: string, path: string) {
  return documents.get(fileDocumentKey(projectPath, path));
}
export function getFileDocument(projectPath: string, path: string) {
  const key = fileDocumentKey(projectPath, path);
  let document = documents.get(key);
  if (!document) {
    document = createFileDocument(projectPath, path);
    documents.set(key, document);
  }
  return document;
}

export function retainFileDocument(projectPath: string, path: string) {
  const key = fileDocumentKey(projectPath, path);
  const lease = leases.get(key) ?? { count: 0 };
  clearTimeout(lease.timer);
  lease.count += 1;
  leases.set(key, lease);
  return () => {
    lease.count -= 1;
    if (lease.count) return;
    // Keep a short handoff window when promoting a sidebar tab to the workspace.
    lease.timer = setTimeout(() => {
      const state = documents.get(key)?.store.getState();
      if (lease.count || state?.saving || state?.loading || state?.content !== state?.savedContent) return;
      documents.delete(key);
      leases.delete(key);
    }, 30_000);
  };
}
