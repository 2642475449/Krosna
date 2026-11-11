import { afterEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import type { Session } from "@/types";
import type { AttentionItem } from "@/lib/attention";
import { createAppStore } from "./index";
import { createProjectScopedStorage } from "@/lib/projectScopedStorage";

const NOW = 2_000_000_000_000;
const PROJECT = "D:/workspace/demo";

afterEach(() => vi.useRealTimers());

function session(): Session {
  return {
    id: "session-1",
    path: PROJECT,
    name: "Demo",
    createdAt: NOW - 1000,
    active: true,
    status: "completed",
    agentId: "codex",
  };
}

function attention(kind: AttentionItem["kind"], id: string): AttentionItem {
  return {
    id: `attention:${id}`,
    sourceEventId: id,
    sourceDedupeKey: id,
    sourceRevision: 1,
    projectPath: PROJECT,
    sessionId: "session-1",
    sessionName: "Demo",
    agentId: "codex",
    kind,
    disposition: "open",
    priority: kind === "permission" || kind === "input" ? 1 : kind === "failure" ? 2 : 3,
    title: id,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
  };
}

describe("store persistence v5", () => {
  it("keeps a new session when another window writes stale settings", () => {
    let saved: string | null = null;
    const sharedStorage = createProjectScopedStorage({
      getItem: () => saved,
      setItem: (_name, value) => { saved = value; },
      removeItem: () => { saved = null; },
    });
    const projectWindow = createAppStore(sharedStorage);
    const staleWindow = createAppStore(sharedStorage);

    projectWindow.getState().setCurrentProject({ path: PROJECT, name: "Demo" });
    projectWindow.getState().addSession(session());
    staleWindow.getState().setPinnedCollapsed(true);

    const restored = createAppStore(sharedStorage);
    expect(restored.getState().projectSessions[PROJECT]).toHaveLength(1);
    expect(restored.getState().projectSessions[PROJECT][0].id).toBe("session-1");
  });

  it("migrates v2 state while discarding runtime-only attention", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const persisted = JSON.stringify({
      version: 2,
      state: {
        projectSessions: { [PROJECT]: [session()] },
        projectAttentionItems: {
          [PROJECT]: [attention("permission", "permission"), attention("completion", "done")],
        },
        sessionEvents: [],
        recentProjects: [],
      },
    });
    const storage: StateStorage = {
      getItem: () => persisted,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    const store = createAppStore(storage);

    expect(store.getState().projectAttentionItems[PROJECT]).toHaveLength(1);
    expect(store.getState().projectAttentionItems[PROJECT][0].kind).toBe("completion");
    expect(store.getState().windowMode).toBe("launcher");
  });

  it("writes version 5 with only restart-safe attention data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    let persisted: string | null = null;
    const storage: StateStorage = {
      getItem: () => null,
      setItem: (_name, value) => {
        persisted = value;
      },
      removeItem: vi.fn(),
    };
    const store = createAppStore(storage);

    store.setState({
      projectSessions: { [PROJECT]: [session()] },
      projectAttentionItems: {
        [PROJECT]: [attention("input", "input"), attention("failure", "failure")],
      },
    });

    const parsed = JSON.parse(persisted!);
    expect(parsed.version).toBe(5);
    expect(parsed.state.projectAttentionItems[PROJECT]).toHaveLength(1);
    expect(parsed.state.projectAttentionItems[PROJECT][0].kind).toBe("failure");
  });

  it("avoids storage access for runtime-only actions and no-op updates", () => {
    let saved: string | null = null;
    const backend = {
      getItem: vi.fn(() => saved),
      setItem: vi.fn((_name: string, value: string) => { saved = value; }),
      removeItem: vi.fn(() => { saved = null; }),
    };
    const store = createAppStore(createProjectScopedStorage(backend));
    store.getState().setCurrentProject({ path: PROJECT, name: "Demo" });
    store.getState().addSession(session());
    const before = saved;
    backend.getItem.mockClear();
    backend.setItem.mockClear();

    for (let index = 0; index < 100; index++) {
      store.getState().setGitChangeCount(index);
      store.setState((state) => state);
    }

    expect(store.getState().gitChangeCount).toBe(99);
    expect(saved).toBe(before);
    expect(backend.getItem).not.toHaveBeenCalled();
    expect(backend.setItem).not.toHaveBeenCalled();
  });

  it("does not replay an unchanged store snapshot over another window's updates", () => {
    let saved: string | null = null;
    const backend = {
      getItem: vi.fn(() => saved),
      setItem: vi.fn((_name: string, value: string) => { saved = value; }),
      removeItem: vi.fn(() => { saved = null; }),
    };
    const projectWindow = createAppStore(createProjectScopedStorage(backend));
    const staleWindow = createAppStore(createProjectScopedStorage(backend));
    projectWindow.getState().setCurrentProject({ path: PROJECT, name: "Demo" });
    projectWindow.getState().addSession(session());
    staleWindow.getState().setPinnedCollapsed(true);
    const afterExternalUpdate = saved;
    backend.getItem.mockClear();
    backend.setItem.mockClear();

    projectWindow.getState().setGitChangeCount(5);
    expect(saved).toBe(afterExternalUpdate);
    saved = null;
    projectWindow.setState((state) => state);
    expect(saved).toBeNull();
    expect(backend.getItem).not.toHaveBeenCalled();
    expect(backend.setItem).not.toHaveBeenCalled();
  });

  it("retries a failed persisted action without hiding its error", () => {
    let saved: string | null = null;
    const error = new Error("storage unavailable");
    const setItem = vi.fn((_name: string, value: string) => { saved = value; });
    const store = createAppStore(createProjectScopedStorage({
      getItem: () => saved,
      setItem,
      removeItem: vi.fn(),
    }));
    store.getState().setCurrentProject({ path: PROJECT, name: "Demo" });
    setItem.mockImplementationOnce(() => { throw error; });

    expect(() => store.getState().setPinnedCollapsed(true)).toThrow(error);
    store.getState().setPinnedCollapsed(true);

    expect(JSON.parse(saved!).state.sidebarPinnedCollapsed).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(3);
  });
});
