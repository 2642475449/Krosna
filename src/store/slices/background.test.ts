import { beforeEach, expect, it, vi } from "vitest";
import { completeWorkspaceClose, exitBackgroundApplication, getBackgroundSettings, setBackgroundSettings, acknowledgeWorkspaceExit } from "@/lib/api";
import { chooseWorkspaceClose, requestWorkspaceClose, useBackgroundStore, cancelWorkspaceDocumentClose,
  resolveWorkspaceDocumentClose, prepareWorkspaceExit, cancelPreparedWorkspaceExit,
  getWorkspaceCloseBehavior, saveWorkspaceCloseBehavior, type WorkspaceCloseBehavior } from "./background";
import { useApplicationUpdateStore } from "./applicationUpdate";
import { discardWorkspaceDocuments, flushWorkspaceDocuments } from "@/lib/workspaceClose";
import { flushWorkspaceRecovery } from "./workspaceRecovery";
import { flushTerminalRecovery } from "./terminalRecovery";

vi.mock("./workspaceRecovery", () => ({ flushWorkspaceRecovery: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./terminalRecovery", () => ({ flushTerminalRecovery: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/workspaceClose", () => ({
  flushWorkspaceDocuments: vi.fn().mockResolvedValue([]),
  discardWorkspaceDocuments: vi.fn().mockResolvedValue([]),
  pauseWorkspaceDocumentAutoSave: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/api", () => ({
  completeWorkspaceClose: vi.fn().mockResolvedValue(undefined),
  exitBackgroundApplication: vi.fn().mockResolvedValue(undefined),
  getBackgroundSettings: vi.fn(),
  setBackgroundSettings: vi.fn().mockResolvedValue(undefined),
  acknowledgeWorkspaceExit: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  cancelWorkspaceDocumentClose();
  vi.clearAllMocks();
  useBackgroundStore.setState({ settings: { runInBackground: false, askBeforeClose: true }, ready: false, busy: false, promptOpen: false, remember: true,
    documentPromptOpen: false, documentCloseIntent: "resolve", documentCloseRemember: false, unsavedPaths: [], exitPreparing: false, closePreparing: false, exitPreparationNonce: null });
  vi.mocked(flushWorkspaceDocuments).mockResolvedValue([]);
  vi.mocked(discardWorkspaceDocuments).mockResolvedValue([]);
  vi.mocked(flushWorkspaceRecovery).mockResolvedValue(undefined);
  vi.mocked(flushTerminalRecovery).mockResolvedValue(undefined);
  useApplicationUpdateStore.setState({ phase: "idle" });
  vi.mocked(getBackgroundSettings).mockResolvedValue({ runInBackground: false, askBeforeClose: true });
});

it.each([
  [{ runInBackground: false, askBeforeClose: true }, "ask"],
  [{ runInBackground: true, askBeforeClose: true }, "ask"],
  [{ runInBackground: true, askBeforeClose: false }, "background"],
  [{ runInBackground: false, askBeforeClose: false }, "close"],
] as const)("shows the actual behavior for legacy settings %j", (settings, behavior) => {
  expect(getWorkspaceCloseBehavior(settings)).toBe(behavior);
});

it.each<WorkspaceCloseBehavior>(["ask", "background", "close"])("persists and executes the selected %s behavior", async (behavior) => {
  // 从截图中的双开状态开始，选择一次后保存为明确的单一行为。
  useBackgroundStore.setState({ settings: { runInBackground: true, askBeforeClose: true } });
  await saveWorkspaceCloseBehavior(behavior);
  const settings = useBackgroundStore.getState().settings;
  expect(settings).toEqual({ runInBackground: behavior === "background", askBeforeClose: behavior === "ask" });
  expect(setBackgroundSettings).toHaveBeenCalledWith(settings);
  expect(getWorkspaceCloseBehavior(settings)).toBe(behavior);
  vi.mocked(getBackgroundSettings).mockResolvedValue(settings);
  await requestWorkspaceClose();
  expect(useBackgroundStore.getState().promptOpen).toBe(behavior === "ask");
  if (behavior === "ask") expect(completeWorkspaceClose).not.toHaveBeenCalled();
  else expect(completeWorkspaceClose).toHaveBeenCalledWith(behavior === "background");
});

it("keeps the saved behavior visible when a new choice cannot be saved", async () => {
  const settings = { runInBackground: true, askBeforeClose: false };
  useBackgroundStore.setState({ settings });
  vi.mocked(setBackgroundSettings).mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(saveWorkspaceCloseBehavior("close")).rejects.toThrow("storage unavailable");
  expect(useBackgroundStore.getState()).toMatchObject({ settings, busy: false });
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
});

it("asks on first close without closing the workspace", async () => {
  await requestWorkspaceClose();
  expect(useBackgroundStore.getState().promptOpen).toBe(true);
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
});

it("explicit project close offers direct close without changing background preferences", async () => {
  useBackgroundStore.setState({ settings: { runInBackground: true, askBeforeClose: false } });
  await requestWorkspaceClose(false, true);
  expect(useBackgroundStore.getState()).toMatchObject({ promptOpen: true, remember: false });
  expect(getBackgroundSettings).not.toHaveBeenCalled();
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
  await chooseWorkspaceClose(false);
  expect(completeWorkspaceClose).toHaveBeenCalledWith(false);
  expect(setBackgroundSettings).not.toHaveBeenCalled();
});

it("guards explicit project close during update download", async () => {
  useApplicationUpdateStore.setState({ phase: "downloading" });
  await expect(requestWorkspaceClose(false, true)).rejects.toThrow("application-update-in-progress");
  expect(useBackgroundStore.getState().promptOpen).toBe(false);
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
});

it("remembers the background choice before hiding", async () => {
  await chooseWorkspaceClose(true);
  expect(setBackgroundSettings).toHaveBeenCalledWith({ runInBackground: true, askBeforeClose: false });
  expect(completeWorkspaceClose).toHaveBeenCalledWith(true);
  expect(vi.mocked(setBackgroundSettings).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(completeWorkspaceClose).mock.invocationCallOrder[0]);
});

it("can close just once without changing the preference", async () => {
  useBackgroundStore.setState({ remember: false });
  await chooseWorkspaceClose(false);
  expect(setBackgroundSettings).not.toHaveBeenCalled();
  expect(completeWorkspaceClose).toHaveBeenCalledWith(false);
});

it("reads the shared preference instead of trusting a stale window cache", async () => {
  vi.mocked(getBackgroundSettings).mockResolvedValue({ runInBackground: true, askBeforeClose: false });
  await requestWorkspaceClose();
  expect(completeWorkspaceClose).toHaveBeenCalledWith(true);
  expect(useBackgroundStore.getState().promptOpen).toBe(false);
});

it("honors the saved direct-close preference", async () => {
  vi.mocked(getBackgroundSettings).mockResolvedValue({ runInBackground: false, askBeforeClose: false });
  await requestWorkspaceClose();
  expect(completeWorkspaceClose).toHaveBeenCalledWith(false);
});

it("keeps the window and dialog available when saving fails", async () => {
  useBackgroundStore.setState({ promptOpen: true });
  vi.mocked(setBackgroundSettings).mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(chooseWorkspaceClose(true)).rejects.toThrow("storage unavailable");
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
  expect(useBackgroundStore.getState()).toMatchObject({ busy: false, promptOpen: true });
});

it("explicit tray exit bypasses the background preference", async () => {
  await requestWorkspaceClose(true);
  expect(exitBackgroundApplication).toHaveBeenCalledOnce();
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
});

it("guards exit during update download", async () => {
  useApplicationUpdateStore.setState({ phase: "downloading" });
  await expect(requestWorkspaceClose(true)).rejects.toThrow("application-update-in-progress");
  expect(exitBackgroundApplication).not.toHaveBeenCalled();
});

it("ignores repeated requests while loading the preference", async () => {
  let resolve!: (value: { runInBackground: boolean; askBeforeClose: boolean }) => void;
  vi.mocked(getBackgroundSettings).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const first = requestWorkspaceClose();
  await requestWorkspaceClose();
  expect(getBackgroundSettings).toHaveBeenCalledOnce();
  resolve({ runInBackground: true, askBeforeClose: false });
  await first;
  expect(completeWorkspaceClose).toHaveBeenCalledOnce();
});

it("waits for pending file writes before directly closing a workspace", async () => {
  let finish!: (paths: string[]) => void;
  vi.mocked(flushWorkspaceDocuments).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const closing = chooseWorkspaceClose(false);
  expect(useBackgroundStore.getState().closePreparing).toBe(true);
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
  finish([]);
  await closing;
  expect(useBackgroundStore.getState().closePreparing).toBe(false);
  expect(completeWorkspaceClose).toHaveBeenCalledWith(false);
});

it("blocks direct close on unsaved files and preserves cancel as a real choice", async () => {
  vi.mocked(flushWorkspaceDocuments).mockResolvedValueOnce(["conflict.md"]);
  await chooseWorkspaceClose(false);
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
  expect(setBackgroundSettings).not.toHaveBeenCalled();
  expect(useBackgroundStore.getState()).toMatchObject({ promptOpen: false, documentPromptOpen: true, unsavedPaths: ["conflict.md"] });
  expect(useBackgroundStore.getState().closePreparing).toBe(false);
  cancelWorkspaceDocumentClose();
  expect(useBackgroundStore.getState().documentPromptOpen).toBe(false);
  expect(discardWorkspaceDocuments).not.toHaveBeenCalled();
});

it.each([false, true])("only closes after a successful explicit save/discard decision: discard=%s", async (discard) => {
  vi.mocked(flushWorkspaceDocuments).mockResolvedValueOnce(["draft.md"]);
  await chooseWorkspaceClose(false);
  await resolveWorkspaceDocumentClose(discard);
  expect(completeWorkspaceClose).toHaveBeenCalledWith(false);
  expect(discardWorkspaceDocuments).toHaveBeenCalledTimes(discard ? 1 : 0);
});

it("hiding a workspace keeps its unsaved documents in memory", async () => {
  await chooseWorkspaceClose(true);
  expect(flushWorkspaceDocuments).not.toHaveBeenCalled();
  expect(discardWorkspaceDocuments).not.toHaveBeenCalled();
  expect(completeWorkspaceClose).toHaveBeenCalledWith(true);
});

it("only acknowledges application exit after this workspace saves successfully", async () => {
  await prepareWorkspaceExit("current");
  expect(acknowledgeWorkspaceExit).toHaveBeenCalledWith("current", true);
  expect(useBackgroundStore.getState().exitPreparing).toBe(true);
  cancelPreparedWorkspaceExit("old");
  expect(useBackgroundStore.getState().exitPreparing).toBe(true);
  cancelPreparedWorkspaceExit("current");
  expect(useBackgroundStore.getState().exitPreparing).toBe(false);
});

it("rejects application exit for unsaved files and update downloads", async () => {
  vi.mocked(flushWorkspaceDocuments).mockResolvedValueOnce(["auxiliary.md"]);
  await prepareWorkspaceExit("conflict");
  expect(acknowledgeWorkspaceExit).toHaveBeenCalledWith("conflict", false);
  expect(useBackgroundStore.getState()).toMatchObject({ documentPromptOpen: true, documentCloseIntent: "resolve" });
  useApplicationUpdateStore.setState({ phase: "downloading" });
  await expect(prepareWorkspaceExit("update")).rejects.toThrow("application-update-in-progress");
  expect(acknowledgeWorkspaceExit).toHaveBeenCalledWith("update", false);
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
});

it("does not acknowledge a cancelled preparation after its save finishes", async () => {
  let finish!: (paths: string[]) => void;
  vi.mocked(flushWorkspaceDocuments).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const preparing = prepareWorkspaceExit("cancelled");
  cancelPreparedWorkspaceExit("cancelled");
  finish([]);
  await preparing;
  expect(acknowledgeWorkspaceExit).not.toHaveBeenCalled();
  expect(useBackgroundStore.getState().exitPreparing).toBe(false);
});

it("ignores stale close buttons while a cross-window exit is preparing", async () => {
  useBackgroundStore.setState({ exitPreparing: true, exitPreparationNonce: "pending" });
  await chooseWorkspaceClose(false);
  await chooseWorkspaceClose(true);
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
  expect(flushWorkspaceDocuments).not.toHaveBeenCalled();
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

it("waits for terminal history and then workspace recovery writes before closing", async () => {
  let finishTerminal: () => void = () => {};
  let finishWorkspace: () => void = () => {};
  vi.mocked(flushTerminalRecovery).mockReturnValueOnce(new Promise<void>((resolve) => { finishTerminal = resolve; }));
  vi.mocked(flushWorkspaceRecovery).mockReturnValueOnce(new Promise<void>((resolve) => { finishWorkspace = resolve; }));
  const closing = chooseWorkspaceClose(false);
  await flushMicrotasks();
  expect(flushTerminalRecovery).toHaveBeenCalledOnce();
  expect(flushWorkspaceRecovery).not.toHaveBeenCalled();
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
  finishTerminal(); await flushMicrotasks();
  expect(flushWorkspaceRecovery).toHaveBeenCalledOnce();
  expect(completeWorkspaceClose).not.toHaveBeenCalled();
  finishWorkspace(); await closing;
  expect(completeWorkspaceClose).toHaveBeenCalledWith(false);
});

it.each(["terminal", "workspace"] as const)("blocks direct close when %s recovery cannot be saved", async (kind) => {
  vi.mocked(kind === "terminal" ? flushTerminalRecovery : flushWorkspaceRecovery).mockRejectedValueOnce(new Error("disk full"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(chooseWorkspaceClose(false)).rejects.toThrow("workspace-exit-recovery-save-failed");
    expect(completeWorkspaceClose).not.toHaveBeenCalled();
    expect(setBackgroundSettings).not.toHaveBeenCalled();
    expect(useBackgroundStore.getState()).toMatchObject({ closePreparing: false, busy: false });
  } finally { error.mockRestore(); }
});

it("hides into the background without flushing or restarting live terminal state", async () => {
  await chooseWorkspaceClose(true);
  expect(flushTerminalRecovery).not.toHaveBeenCalled();
  expect(flushWorkspaceRecovery).not.toHaveBeenCalled();
  expect(flushWorkspaceDocuments).not.toHaveBeenCalled();
  expect(completeWorkspaceClose).toHaveBeenCalledWith(true);
});

it("waits for both recovery writes before acknowledging a cross-window exit", async () => {
  let finishTerminal: () => void = () => {};
  let finishWorkspace: () => void = () => {};
  vi.mocked(flushTerminalRecovery).mockReturnValueOnce(new Promise<void>((resolve) => { finishTerminal = resolve; }));
  vi.mocked(flushWorkspaceRecovery).mockReturnValueOnce(new Promise<void>((resolve) => { finishWorkspace = resolve; }));
  const preparing = prepareWorkspaceExit("recovery");
  await flushMicrotasks();
  expect(acknowledgeWorkspaceExit).not.toHaveBeenCalled();
  finishTerminal(); await flushMicrotasks();
  expect(flushWorkspaceRecovery).toHaveBeenCalledOnce();
  expect(acknowledgeWorkspaceExit).not.toHaveBeenCalled();
  finishWorkspace(); await preparing;
  expect(acknowledgeWorkspaceExit).toHaveBeenCalledWith("recovery", true);
});

it.each(["terminal", "workspace"] as const)("rejects cross-window exit when %s recovery fails", async (kind) => {
  vi.mocked(kind === "terminal" ? flushTerminalRecovery : flushWorkspaceRecovery).mockRejectedValueOnce(new Error("disk full"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(prepareWorkspaceExit("failed-recovery")).rejects.toThrow("workspace-exit-recovery-save-failed");
    expect(acknowledgeWorkspaceExit).toHaveBeenCalledWith("failed-recovery", false);
    expect(useBackgroundStore.getState().exitPreparing).toBe(false);
    expect(completeWorkspaceClose).not.toHaveBeenCalled();
  } finally { error.mockRestore(); }
});

it.each(["terminal", "workspace"] as const)("does not acknowledge a cancelled exit nonce after %s recovery finishes", async (kind) => {
  let finish: () => void = () => {};
  vi.mocked(kind === "terminal" ? flushTerminalRecovery : flushWorkspaceRecovery)
    .mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const preparing = prepareWorkspaceExit("cancel-during-recovery");
  await flushMicrotasks();
  cancelPreparedWorkspaceExit("cancel-during-recovery");
  finish(); await preparing;
  expect(acknowledgeWorkspaceExit).not.toHaveBeenCalled();
  expect(useBackgroundStore.getState()).toMatchObject({ exitPreparing: false, exitPreparationNonce: null });
});
