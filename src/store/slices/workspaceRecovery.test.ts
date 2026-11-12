import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "@/store";
import type { Session, WindowProjectContext } from "@/types";
import type { ProjectWorkspace } from "@/store/types";
import type { WorkspaceRecoveryPayload } from "@/lib/workspaceRecovery";
import { createDefaultWorkspace, createSessionTab } from "../utils/workspace";
import {
  flushWorkspaceRecovery,
  initializeRecoverableWindowContext,
  refreshWorkspaceRecoverySettings,
  startWorkspaceRecoverySync,
  takeWorkspaceRestoreSession,
  useWorkspaceRecoveryStore,
} from "./workspaceRecovery";

const mocks = vi.hoisted(() => ({
  readSetting: vi.fn(),
  writeSetting: vi.fn(),
  readWorkspace: vi.fn(),
  saveWorkspace: vi.fn(),
  diff: vi.fn(),
  spawn: vi.fn(),
  stop: vi.fn(),
  listener: undefined as ((enabled: boolean) => void) | undefined,
}));

vi.mock("@/lib/api", () => ({
  getWorkspaceRestoreEnabled: (...args: unknown[]) => mocks.readSetting(...args),
  setWorkspaceRestoreEnabled: (...args: unknown[]) => mocks.writeSetting(...args),
  readWorkspaceRecovery: (...args: unknown[]) => mocks.readWorkspace(...args),
  saveWorkspaceRecovery: (...args: unknown[]) => mocks.saveWorkspace(...args),
  gitDiffContent: (...args: unknown[]) => mocks.diff(...args),
  spawnPty: (...args: unknown[]) => mocks.spawn(...args),
  onWorkspaceRestoreSettingsChanged: async (listener: (enabled: boolean) => void) => {
    mocks.listener = listener;
    return mocks.stop;
  },
}));

const PROJECT = "D:/workspace/recovery";
let stopSync: (() => void) | undefined;

function context(projectPath = PROJECT): WindowProjectContext {
  return { windowLabel: "main", mode: "project", projectPath, projectName: "recovery" };
}

function session(id: string, path = PROJECT, overrides: Partial<Session> = {}): Session {
  return { id, path, name: id, createdAt: 100, active: true, status: "running", agentId: "codex", ...overrides };
}

function payload(projectPath = PROJECT): WorkspaceRecoveryPayload {
  const sessions = [session("first", projectPath), session("second", projectPath),
    session("focused", projectPath), session("shell", projectPath, { agentId: "powershell", ephemeral: true })];
  const workspace: ProjectWorkspace = {
    tabsById: Object.fromEntries(sessions.map((item) => [item.id, createSessionTab(item)])),
    panesById: {
      main: { id: "main", tabIds: ["first", "shell"], activeTabId: "shell", history: ["first", "shell"] },
      right: { id: "right", tabIds: ["second", "focused"], activeTabId: "second", history: ["focused", "second"] },
    },
    layout: { root: { type: "split", direction: "horizontal", ratio: 0.55,
      first: { type: "pane", paneId: "main" }, second: { type: "pane", paneId: "right" } } },
    activePaneId: "right", focusedTabId: "focused",
  };
  return { version: 1, projectPath, updatedAt: 100, sessions, workspace, editorViews: {}, diffs: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listener = undefined;
  mocks.readSetting.mockResolvedValue(true);
  mocks.writeSetting.mockResolvedValue(undefined);
  mocks.readWorkspace.mockResolvedValue(null);
  mocks.saveWorkspace.mockResolvedValue(undefined);
  useAppStore.setState(useAppStore.getInitialState(), true);
  useWorkspaceRecoveryStore.setState(useWorkspaceRecoveryStore.getInitialState(), true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  stopSync?.();
  stopSync = undefined;
  await Promise.resolve();
  vi.restoreAllMocks();
});

it("enables recovery by default and loads the persisted setting through the real recovery store", async () => {
  expect(useWorkspaceRecoveryStore.getState().enabled).toBe(true);
  expect(useWorkspaceRecoveryStore.getState().settingsReady).toBe(false);
  mocks.readSetting.mockResolvedValue(false);
  await refreshWorkspaceRecoverySettings();
  expect(useWorkspaceRecoveryStore.getState()).toMatchObject({ enabled: false, settingsReady: true });
});

it("keeps the previous setting when saving fails and clears the saving flag", async () => {
  mocks.writeSetting.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(useWorkspaceRecoveryStore.getState().setEnabled(false)).rejects.toThrow("database unavailable");
  expect(useWorkspaceRecoveryStore.getState()).toMatchObject({ enabled: true, savingSetting: false });
  await useWorkspaceRecoveryStore.getState().setEnabled(false);
  expect(mocks.writeSetting).toHaveBeenLastCalledWith(false);
  expect(useWorkspaceRecoveryStore.getState()).toMatchObject({ enabled: false, settingsReady: true });
});

it("applies another window's setting event and removes pending restore work when disabled", async () => {
  useWorkspaceRecoveryStore.setState({ restoreQueue: ["pending"] });
  stopSync = startWorkspaceRecoverySync();
  mocks.listener?.(false);
  expect(useWorkspaceRecoveryStore.getState()).toMatchObject({ enabled: false, settingsReady: true, restoreQueue: [] });
  mocks.listener?.(true);
  expect(useWorkspaceRecoveryStore.getState().enabled).toBe(true);
  stopSync();
  stopSync = undefined;
  await Promise.resolve();
  expect(mocks.stop).toHaveBeenCalledOnce();
});

it("preserves a newer cross-window setting event when an earlier settings read finishes late", async () => {
  let completeRead!: (enabled: boolean) => void;
  mocks.readSetting.mockImplementationOnce(() => new Promise<boolean>((resolve) => { completeRead = resolve; }));
  stopSync = startWorkspaceRecoverySync();
  const loading = refreshWorkspaceRecoverySettings();
  mocks.listener?.(false);
  completeRead(true);
  await loading;
  expect(useWorkspaceRecoveryStore.getState()).toMatchObject({ enabled: false, settingsReady: true });
});

it("restores session tabs and split layout, queues focus then visible panes, and never spawns a process itself", async () => {
  const saved = payload();
  mocks.readWorkspace.mockResolvedValue(saved);
  await initializeRecoverableWindowContext(context());
  const state = useAppStore.getState();
  expect(state.currentProject?.path).toBe(PROJECT);
  expect(state.layout).toEqual(saved.workspace.layout);
  expect(state.panesById.main.tabIds).toEqual(["first", "shell"]);
  expect(state.panesById.right.tabIds).toEqual(["second", "focused"]);
  expect(state.focusedTabId).toBe("focused");
  expect(state.sessions.find((item) => item.id === "shell")).toMatchObject({ agentId: "powershell", active: false, ephemeral: true });
  expect(state.sessions.every((item) => !item.active && item.status === "stopped")).toBe(true);
  expect(useWorkspaceRecoveryStore.getState().restoreQueue).toEqual(["focused", "shell", "second", "first"]);
  expect(Array.from({ length: 5 }, () => takeWorkspaceRestoreSession())).toEqual(["focused", "shell", "second", "first", undefined]);
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("keeps Agent history but restores an empty workspace when automatic recovery is disabled", async () => {
  const existing = session("existing", PROJECT, { active: false, status: "completed" });
  useAppStore.setState({ projectSessions: { [PROJECT]: [existing] } });
  mocks.readSetting.mockResolvedValue(false);
  mocks.readWorkspace.mockResolvedValue(payload());
  await initializeRecoverableWindowContext(context());
  const state = useAppStore.getState();
  expect(state.sessions.map((item) => item.id)).toEqual(["existing", "first", "second", "focused"]);
  expect(state.tabsById).toEqual({});
  expect(state.layout).toEqual(createDefaultWorkspace().layout);
  expect(useWorkspaceRecoveryStore.getState()).toMatchObject({ enabled: false, phase: "ready", restoreQueue: [] });
  expect(takeWorkspaceRestoreSession()).toBeUndefined();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("does not erase a user's new layout or reload the snapshot when the same window context initializes again", async () => {
  mocks.readWorkspace.mockResolvedValue(payload());
  await initializeRecoverableWindowContext(context());
  useAppStore.getState().setWorkspaceSplitRatio([], 0.7);
  const fileId = useAppStore.getState().openFileTab(`${PROJECT}/new.ts`, { preview: false });
  const before = useAppStore.getState().projectWorkspaces[PROJECT];
  await initializeRecoverableWindowContext(context());
  expect(useAppStore.getState().projectWorkspaces[PROJECT]).toEqual(before);
  expect(fileId).toBeTruthy();
  expect(useAppStore.getState().tabsById[fileId!]).toMatchObject({ kind: "file" });
  expect(mocks.readWorkspace).toHaveBeenCalledOnce();
});

it("rejects a snapshot belonging to another project without importing its tabs or sessions", async () => {
  const foreign = "D:/workspace/foreign";
  mocks.readWorkspace.mockResolvedValue(payload(foreign));
  await initializeRecoverableWindowContext(context());
  expect(mocks.readWorkspace).toHaveBeenCalledWith(PROJECT);
  expect(useAppStore.getState().currentProject?.path).toBe(PROJECT);
  expect(useAppStore.getState().sessions).toEqual([]);
  expect(useAppStore.getState().tabsById).toEqual({});
  expect(useWorkspaceRecoveryStore.getState().restoreQueue).toEqual([]);
});

it("ignores a late recovery load after another project has already initialized", async () => {
  const other = "D:/workspace/other";
  let completeOld!: (saved: WorkspaceRecoveryPayload) => void;
  mocks.readWorkspace.mockImplementationOnce(() => new Promise<WorkspaceRecoveryPayload>((resolve) => { completeOld = resolve; }))
    .mockResolvedValueOnce(payload(other));
  const oldInitialization = initializeRecoverableWindowContext(context());
  await vi.waitFor(() => expect(mocks.readWorkspace).toHaveBeenCalledTimes(1));
  await initializeRecoverableWindowContext(context(other));
  completeOld(payload());
  await oldInitialization;
  expect(useAppStore.getState().currentProject?.path).toBe(other);
  expect(useAppStore.getState().sessions.every((item) => item.path === other)).toBe(true);
  expect(useWorkspaceRecoveryStore.getState()).toMatchObject({ projectPath: other, phase: "ready" });
});

it("blocks saving an empty startup workspace after a recovery read fails", async () => {
  mocks.readWorkspace.mockRejectedValueOnce(new Error("disk read failed"));
  await initializeRecoverableWindowContext(context());
  expect(useWorkspaceRecoveryStore.getState()).toMatchObject({ phase: "error", error: "Error: disk read failed" });
  await flushWorkspaceRecovery();
  expect(mocks.saveWorkspace).not.toHaveBeenCalled();
});

it("serializes saves so the newest layout is written after the pending older snapshot", async () => {
  mocks.readWorkspace.mockResolvedValue(payload());
  await initializeRecoverableWindowContext(context());
  let completeFirst!: () => void;
  mocks.saveWorkspace.mockImplementationOnce(() => new Promise<void>((resolve) => { completeFirst = resolve; }));
  const first = flushWorkspaceRecovery();
  await vi.waitFor(() => expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1));
  useAppStore.getState().setWorkspaceSplitRatio([], 0.7);
  const second = flushWorkspaceRecovery();
  useAppStore.getState().setWorkspaceSplitRatio([], 0.8);
  const newest = flushWorkspaceRecovery();
  expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);
  completeFirst();
  await Promise.all([first, second, newest]);
  expect(mocks.saveWorkspace.mock.calls.map(([, saved]) => (saved as WorkspaceRecoveryPayload).workspace.layout.root)).toEqual([
    { ...payload().workspace.layout.root, ratio: 0.55 },
    { ...payload().workspace.layout.root, ratio: 0.7 },
    { ...payload().workspace.layout.root, ratio: 0.8 },
  ]);
  expect(mocks.saveWorkspace.mock.calls.every(([project]) => project === PROJECT)).toBe(true);
  await flushWorkspaceRecovery();
  expect(mocks.saveWorkspace).toHaveBeenCalledTimes(3);
});
