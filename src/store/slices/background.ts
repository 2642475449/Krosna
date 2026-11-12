import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  completeWorkspaceClose, exitBackgroundApplication, getBackgroundSettings,
  setBackgroundSettings, acknowledgeWorkspaceExit, type BackgroundSettings,
} from "@/lib/api";
import { useApplicationUpdateStore } from "./applicationUpdate";
import { discardWorkspaceDocuments, flushWorkspaceDocuments, pauseWorkspaceDocumentAutoSave } from "@/lib/workspaceClose";
import { flushWorkspaceRecovery } from "./workspaceRecovery";
import { flushTerminalRecovery } from "./terminalRecovery";

export type WorkspaceCloseBehavior = "ask" | "background" | "close";

/** 兼容既有双开关设置；询问开启时，它就是实际生效的关闭行为。 */
export function getWorkspaceCloseBehavior(settings: BackgroundSettings): WorkspaceCloseBehavior {
  return settings.askBeforeClose ? "ask" : settings.runInBackground ? "background" : "close";
}

interface BackgroundState {
  settings: BackgroundSettings;
  ready: boolean;
  busy: boolean;
  promptOpen: boolean;
  remember: boolean;
  documentPromptOpen: boolean;
  documentCloseIntent: "close" | "resolve";
  documentCloseRemember: boolean;
  unsavedPaths: string[];
  exitPreparing: boolean;
  closePreparing: boolean;
  exitPreparationNonce: string | null;
  setSettings: (settings: BackgroundSettings) => void;
  setRemember: (remember: boolean) => void;
  setPromptOpen: (open: boolean) => void;
}

export const useBackgroundStore = create<BackgroundState>()(persist((set) => ({
  settings: { runInBackground: false, askBeforeClose: true },
  ready: false,
  busy: false,
  promptOpen: false,
  remember: true,
  documentPromptOpen: false,
  documentCloseIntent: "resolve",
  documentCloseRemember: false,
  unsavedPaths: [],
  exitPreparing: false,
  closePreparing: false,
  exitPreparationNonce: null,
  setSettings: (settings) => set({ settings, ready: true }),
  setRemember: (remember) => set({ remember }),
  setPromptOpen: (promptOpen) => set({ promptOpen }),
}), {
  name: "krosna-background-settings",
  partialize: ({ settings }) => ({ settings }),
}));

export async function refreshBackgroundSettings(): Promise<BackgroundSettings> {
  const settings = await getBackgroundSettings();
  useBackgroundStore.getState().setSettings(settings);
  return settings;
}

export async function saveBackgroundSettings(settings: BackgroundSettings): Promise<void> {
  useBackgroundStore.setState({ busy: true });
  try {
    await setBackgroundSettings(settings);
    useBackgroundStore.getState().setSettings(settings);
  } finally {
    useBackgroundStore.setState({ busy: false });
  }
}

export async function saveWorkspaceCloseBehavior(behavior: WorkspaceCloseBehavior): Promise<void> {
  await saveBackgroundSettings({
    runInBackground: behavior === "background",
    askBeforeClose: behavior === "ask",
  });
}

// 下载更新时沿用原有关闭保护，避免销毁下载所属窗口。
function checkUpdateGuard(): void {
  const phase = useApplicationUpdateStore.getState().phase;
  if (phase === "downloading" || phase === "installing") throw new Error("application-update-in-progress");
}

let releaseDocumentPause: (() => void) | undefined;
function resumeDocumentAutoSave() {
  releaseDocumentPause?.();
  releaseDocumentPause = undefined;
}

function showDocumentPrompt(intent: "close" | "resolve", paths: string[], remember = false) {
  resumeDocumentAutoSave();
  releaseDocumentPause = pauseWorkspaceDocumentAutoSave();
  useBackgroundStore.setState({ promptOpen: false, documentPromptOpen: true,
    documentCloseIntent: intent, documentCloseRemember: remember, unsavedPaths: paths });
}

export function cancelWorkspaceDocumentClose(): void {
  resumeDocumentAutoSave();
  useBackgroundStore.setState({ documentPromptOpen: false, unsavedPaths: [] });
}

async function finishWorkspaceClose(background: boolean, remember: boolean): Promise<boolean> {
  if (!background) useBackgroundStore.setState({ closePreparing: true });
  try {
    if (!background) {
      const unsaved = await flushWorkspaceDocuments();
      if (unsaved.length) { showDocumentPrompt("close", unsaved, remember); return false; }
      try {
        await flushTerminalRecovery();
        await flushWorkspaceRecovery();
      } catch (error) {
        console.error("Could not save workspace before close", error);
        throw new Error("workspace-exit-recovery-save-failed");
      }
    }
    if (remember) {
      const settings = { runInBackground: background, askBeforeClose: false };
      await setBackgroundSettings(settings);
      useBackgroundStore.getState().setSettings(settings);
    }
    await completeWorkspaceClose(background);
    useBackgroundStore.setState({ promptOpen: false, documentPromptOpen: false, unsavedPaths: [] });
    return true;
  } finally {
    if (!background) useBackgroundStore.setState({ closePreparing: false });
  }
}

export async function resolveWorkspaceDocumentClose(discard = false): Promise<void> {
  const state = useBackgroundStore.getState();
  if (state.busy || state.exitPreparing) return;
  checkUpdateGuard();
  useBackgroundStore.setState({ busy: true });
  resumeDocumentAutoSave();
  try {
    const unsaved = await (discard ? discardWorkspaceDocuments() : flushWorkspaceDocuments());
    if (unsaved.length) { showDocumentPrompt(state.documentCloseIntent, unsaved, state.documentCloseRemember); return; }
    if (state.documentCloseIntent === "close") await finishWorkspaceClose(false, state.documentCloseRemember);
    else cancelWorkspaceDocumentClose();
  } finally { useBackgroundStore.setState({ busy: false }); }
}

/** 每个工作窗口各自保存；ACK 由 Rust 按真实窗口身份和本次 nonce 收集。 */
export async function prepareWorkspaceExit(nonce: string): Promise<void> {
  useBackgroundStore.setState({ exitPreparing: true, exitPreparationNonce: nonce });
  let ready = false;
  try {
    checkUpdateGuard();
    const unsaved = await flushWorkspaceDocuments();
    if (useBackgroundStore.getState().exitPreparationNonce !== nonce) return;
    ready = unsaved.length === 0;
    if (ready) {
      try {
        await flushTerminalRecovery();
        await flushWorkspaceRecovery();
      } catch (error) {
        ready = false;
        console.error("Could not save workspace before exit", error);
        throw new Error("workspace-exit-recovery-save-failed");
      }
    }
    if (!ready) showDocumentPrompt("resolve", unsaved);
  } finally {
    if (useBackgroundStore.getState().exitPreparationNonce === nonce) {
      if (!ready) useBackgroundStore.setState({ exitPreparing: false });
      try { await acknowledgeWorkspaceExit(nonce, ready); }
      catch (error) {
        cancelPreparedWorkspaceExit(nonce);
        throw error;
      }
    }
  }
}

export function cancelPreparedWorkspaceExit(nonce: string): void {
  if (useBackgroundStore.getState().exitPreparationNonce !== nonce) return;
  useBackgroundStore.setState({ exitPreparing: false, exitPreparationNonce: null });
}

export async function requestWorkspaceClose(exitApplication = false, explicitProjectClose = false): Promise<void> {
  const state = useBackgroundStore.getState();
  if (state.busy || state.exitPreparing || state.documentPromptOpen || (state.promptOpen && !exitApplication)) return;
  checkUpdateGuard();
  useBackgroundStore.setState({ busy: true });
  try {
    if (exitApplication) {
      await exitBackgroundApplication();
      return;
    }
    // 任务监控的项目关闭入口始终提供直接关闭选项，不覆盖全局后台偏好。
    if (explicitProjectClose) {
      useBackgroundStore.setState({ promptOpen: true, remember: false });
      return;
    }
    // SQLite 是多窗口设置的权威来源，关闭时不依赖旧窗口缓存。
    const settings = await refreshBackgroundSettings();
    if (settings.askBeforeClose) {
      useBackgroundStore.setState({ promptOpen: true, remember: true });
    } else {
      await finishWorkspaceClose(settings.runInBackground, false);
    }
  } finally {
    useBackgroundStore.setState({ busy: false });
  }
}

export async function chooseWorkspaceClose(background: boolean): Promise<void> {
  const state = useBackgroundStore.getState();
  if (state.busy || state.exitPreparing || state.closePreparing || state.documentPromptOpen) return;
  checkUpdateGuard();
  useBackgroundStore.setState({ busy: true });
  try {
    await finishWorkspaceClose(background, useBackgroundStore.getState().remember);
  } finally {
    useBackgroundStore.setState({ busy: false });
  }
}
