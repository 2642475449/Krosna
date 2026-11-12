import { expect, it } from "vitest";
import { createAppStore } from "@/store";
import { captureWorkspaceRecovery, getWorkspaceRestoreOrder, normalizeWorkspaceRecovery } from "./workspaceRecovery";

function fixture() {
  const store = createAppStore();
  const path = "D:/workspace/recovery";
  store.getState().setCurrentProject({ path, name: "recovery" });
  store.getState().addSession({ id: "one", name: "One", path, createdAt: 1, agentId: "codex", agentSessionId: "exact-id", active: true, status: "running" });
  store.getState().addSession({ id: "shell", name: "Shell", path, createdAt: 2, agentId: "powershell", terminalWorkingDirectory: `${path}/src`, ephemeral: true, active: true });
  store.getState().splitTab("shell", "right", "main", "move");
  const fileId = store.getState().openFileTab(`${path}/src/app.ts`, { preview: false });
  const payload = captureWorkspaceRecovery(store.getState(), { [`${path}/src/app.ts`]: { lineNumber: 25, column: 3, scrollTop: 120, scrollLeft: 0 } })!;
  return { store, path, fileId, payload };
}

it("captures open shell and agent tabs without persisting process availability or running status", () => {
  const { payload } = fixture();
  expect(payload.sessions.map((session) => session.id).sort()).toEqual(["one", "shell"]);
  expect(payload.sessions.every((session) => !session.active)).toBe(true);
  expect(payload.sessions.find((session) => session.id === "one")).toMatchObject({ status: "stopped", agentSessionId: "exact-id" });
  expect(payload.sessions.find((session) => session.id === "shell")?.terminalWorkingDirectory).toContain("/src");
  expect(payload.workspace.layout.root.type).toBe("split");
});

it("retains file tabs and editor position while excluding closed history from the launch queue", () => {
  const { store, path, fileId, payload } = fixture();
  expect(payload.workspace.tabsById[fileId!].kind).toBe("file");
  expect(payload.editorViews[`${path}/src/app.ts`].lineNumber).toBe(25);
  store.getState().closeTab("one");
  const next = captureWorkspaceRecovery(store.getState(), {})!;
  expect(store.getState().sessions.some((session) => session.id === "one")).toBe(true);
  expect(getWorkspaceRestoreOrder(next)).not.toContain("one");
  expect(getWorkspaceRestoreOrder(payload)).toContain("one");
});

it("never accepts a different project's payload or unsupported version", () => {
  const { payload, path } = fixture();
  expect(normalizeWorkspaceRecovery(payload, "D:/other")).toBeNull();
  expect(normalizeWorkspaceRecovery({ ...payload, version: 999 }, path)).toBeNull();
  expect(normalizeWorkspaceRecovery(null, path)).toBeNull();
});

it("degrades a corrupt recursive layout to one pane while retaining valid tabs", () => {
  const { payload, path } = fixture();
  const cycle: Record<string, unknown> = { type: "split", direction: "horizontal", ratio: 0.5 };
  cycle.first = cycle;
  cycle.second = { type: "pane", paneId: "main" };
  const restored = normalizeWorkspaceRecovery({ ...payload, workspace: { ...payload.workspace, layout: { root: cycle } } }, path)!;
  expect(restored.workspace.layout.root).toEqual({ type: "pane", paneId: "main" });
  expect(Object.keys(restored.workspace.tabsById)).toHaveLength(Object.keys(payload.workspace.tabsById).length);
});

it("filters missing session references and transient surfaces without blocking other tabs", () => {
  const { payload, path } = fixture();
  payload.sessions = payload.sessions.filter((session) => session.id !== "one");
  const restored = normalizeWorkspaceRecovery(payload, path)!;
  expect(restored.workspace.tabsById.one).toBeUndefined();
  expect(restored.workspace.tabsById.shell).toBeDefined();
  const invalid = { ...payload, sessions: [...payload.sessions, { id: "aux", path, name: "Aux", createdAt: 1, presentation: "auxiliary", active: true }] };
  expect(normalizeWorkspaceRecovery(invalid, path)?.sessions.map((session) => session.id)).not.toContain("aux");
});

it("prioritizes visible sessions over other open tabs and never queues file tabs", () => {
  const { payload, fileId } = fixture();
  payload.workspace.focusedTabId = "one";
  expect(getWorkspaceRestoreOrder(payload)[0]).toBe("one");
  expect(getWorkspaceRestoreOrder(payload)).not.toContain(fileId);
  expect(new Set(getWorkspaceRestoreOrder(payload)).size).toBe(getWorkspaceRestoreOrder(payload).length);
});

it("does not persist historical diff content as a new working-tree diff", () => {
  const { store } = fixture();
  const id = store.getState().openGitDiffTab({ path: "src/app.ts", name: "app.ts", staged: false, revision: "old-sha",
    originalContent: "old", modifiedContent: "new", originalLabel: "before", modifiedLabel: "after", isBinary: false }, { preview: false })!;
  const payload = captureWorkspaceRecovery(store.getState(), {})!;
  expect(payload.diffs[id]).toBeUndefined();
  expect(payload.workspace.tabsById[id]).toBeUndefined();
});
