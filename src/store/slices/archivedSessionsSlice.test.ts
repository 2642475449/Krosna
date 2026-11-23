import { expect, it, vi } from "vitest";
import { createProjectScopedStorage } from "@/lib/projectScopedStorage";
import { createAppStore } from "@/store";
import type { Session } from "@/types";

const PROJECT_A = "D:/fixture/a";
const PROJECT_B = "D:/fixture/b";

function archived(projectPath: string, id: string): Session {
  return {
    id, path: projectPath, name: id, createdAt: 1, archivedAt: 2,
    archived: true, active: false, agentId: "codex",
  };
}

function fixture(projectSessions: Record<string, Session[]> = { [PROJECT_A]: [], [PROJECT_B]: [] }, archivedB: unknown[] = [
  archived(PROJECT_B, "b"), archived(PROJECT_B, "unselected"),
]) {
  let saved = JSON.stringify({
    version: 5,
    state: {
      projectArchivedSessions: {
        [PROJECT_A]: [archived(PROJECT_A, "a")],
        [PROJECT_B]: archivedB,
      },
      projectSessions,
      recentProjects: [],
    },
  });
  const backend = {
    getItem: vi.fn(() => saved),
    setItem: vi.fn((_key: string, value: string) => { saved = value; }),
    removeItem: vi.fn(),
  };
  const window = (projectPath?: string) => {
    const store = createAppStore(createProjectScopedStorage(backend));
    if (projectPath) store.getState().setCurrentProject({ path: projectPath, name: projectPath });
    return store;
  };
  return { backend, window };
}

it("restores a cross-project selection with one storage write and updates the current project's sessions", async () => {
  const { backend, window } = fixture();
  const store = window(PROJECT_A);
  const activeBefore = { ...archived(PROJECT_A, "live"), archived: false, active: true };
  store.getState().addSession(activeBefore);
  backend.setItem.mockClear();

  const targets = [{ projectPath: PROJECT_A, sessionId: "a" }, { projectPath: PROJECT_B, sessionId: "b" }];
  await expect(store.getState().restoreArchivedSessions([...targets, targets[0]])).resolves.toBe(2);
  expect(backend.setItem).toHaveBeenCalledTimes(1);
  expect(store.getState().sessions).toEqual([
    expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "live", active: true }),
  ]);

  const reloaded = window().getState();
  expect(reloaded.projectSessions[PROJECT_B]).toEqual([expect.objectContaining({ id: "b" })]);
  expect(reloaded.projectSessions[PROJECT_B][0]).not.toHaveProperty("archived");
  expect(reloaded.projectArchivedSessions[PROJECT_A]).toEqual([]);
  expect(reloaded.projectArchivedSessions[PROJECT_B].map(({ id }) => id)).toEqual(["unselected"]);
});

it("deletes only confirmed archive IDs and preserves a newer archive from another window", async () => {
  const { backend, window } = fixture();
  const store = window(PROJECT_A);
  const other = window(PROJECT_B);
  const visible = Object.entries(store.getState().projectArchivedSessions)
    .flatMap(([projectPath, rows]) => rows.map(({ id }) => ({ projectPath, sessionId: id })));
  other.getState().addSession({ ...archived(PROJECT_B, "later"), archived: false });
  other.getState().archiveSession("later");
  backend.setItem.mockClear();

  await expect(store.getState().removeArchivedSessions(visible)).resolves.toBe(3);
  expect(backend.setItem).toHaveBeenCalledTimes(1);
  expect(window().getState().projectArchivedSessions[PROJECT_B].map(({ id }) => id)).toEqual(["later"]);

  // 设置变更与无关会话变更都不能把另一个窗口仍看得到的旧归档写回来。
  other.getState().setPinnedCollapsed(true);
  other.getState().addSession({ ...archived(PROJECT_B, "another"), archived: false });
  other.getState().archiveSession("another");
  const reloaded = window().getState();
  expect(reloaded.projectArchivedSessions[PROJECT_A]).toEqual([]);
  expect(reloaded.projectArchivedSessions[PROJECT_B].map(({ id }) => id)).toEqual(["another", "later"]);
});

it("does not recreate a stale archive that another window already removed", async () => {
  const { backend, window } = fixture();
  const current = window(PROJECT_A);
  const other = window(PROJECT_B);
  const target = { projectPath: PROJECT_B, sessionId: "b" };
  await other.getState().removeArchivedSessions([target]);
  backend.setItem.mockClear();

  await expect(current.getState().restoreArchivedSessions([target])).resolves.toBe(0);
  expect(backend.setItem).not.toHaveBeenCalled();
  expect(current.getState().projectArchivedSessions[PROJECT_B].map(({ id }) => id)).toEqual(["unselected"]);
  expect(window().getState().projectSessions[PROJECT_B]).toEqual([]);
});

it("preserves another window's first restore when the stale window had no active group", async () => {
  const { window } = fixture({ [PROJECT_A]: [] });
  const other = window();
  const current = window(PROJECT_A);
  await expect(current.getState().restoreArchivedSessions([{ projectPath: PROJECT_B, sessionId: "b" }])).resolves.toBe(1);

  other.getState().setCurrentProject({ path: PROJECT_B, name: "B" });
  other.getState().setPinnedCollapsed(true);
  const reloaded = window().getState();
  expect(reloaded.projectSessions[PROJECT_B].map(({ id }) => id)).toEqual(["b"]);
  expect(reloaded.projectArchivedSessions[PROJECT_B].map(({ id }) => id)).toEqual(["unselected"]);
});

it("normalizes a legacy archive before restoring it and tolerates malformed neighbors", async () => {
  const { window } = fixture({}, [{ id: "legacy", agentId: "retired" }, null]);
  const store = window(PROJECT_A);
  await expect(store.getState().restoreArchivedSessions([{ projectPath: PROJECT_B, sessionId: "legacy" }])).resolves.toBe(1);

  expect(window().getState().projectSessions[PROJECT_B]).toEqual([
    expect.objectContaining({ id: "legacy", name: "legacy", path: PROJECT_B, active: false, status: "stopped" }),
  ]);
  expect(window().getState().projectSessions[PROJECT_B][0].agentId).toBeUndefined();
});

it("can archive a restored session again without leaving an active duplicate", async () => {
  const { window } = fixture();
  const store = window(PROJECT_B);
  await expect(store.getState().restoreArchivedSessions([{ projectPath: PROJECT_B, sessionId: "b" }])).resolves.toBe(1);
  store.getState().archiveSession("b");

  const reloaded = window().getState();
  expect(reloaded.projectSessions[PROJECT_B]).toEqual([]);
  expect(reloaded.projectArchivedSessions[PROJECT_B].map(({ id }) => id)).toEqual(["b", "unselected"]);
});

it("rejects a write failure without changing the local archive or active session list", async () => {
  const { backend, window } = fixture();
  const store = window(PROJECT_A);
  const target = { projectPath: PROJECT_B, sessionId: "b" };
  const writeError = new Error("storage unavailable");
  backend.setItem.mockImplementationOnce(() => { throw writeError; });

  const before = store.getState();
  await expect(store.getState().restoreArchivedSessions([target])).rejects.toBe(writeError);
  expect(store.getState()).toBe(before);
  await expect(store.getState().restoreArchivedSessions([target])).resolves.toBe(1);
  expect(window().getState().projectSessions[PROJECT_B].map(({ id }) => id)).toEqual(["b"]);
});
