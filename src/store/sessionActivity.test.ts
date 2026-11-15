import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/types";
import type { SessionStreamEvent } from "./types";
import { createAppStore } from "./index";

const projectPath = "D:/session-activity";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "activity-session", path: projectPath, name: "Activity session",
    agentId: "codex", createdAt: 100, lastEventAt: 100,
    active: true, status: "running", ...overrides,
  };
}

function createStore(session = createSession(), storage = createMemoryStorage()) {
  const store = createAppStore(storage);
  store.getState().setCurrentProject({ name: "Activity", path: projectPath });
  store.getState().addSession(session);
  return store;
}

function completion(overrides: Partial<SessionStreamEvent> = {}): SessionStreamEvent {
  return {
    id: "completion", sessionId: "activity-session", projectPath,
    sessionName: "Activity session", eventType: "assistant_complete",
    title: "Complete", body: "", severity: "success", source: "codex_hook",
    requiresAttention: false, actionable: false, createdAt: 200,
    ...overrides,
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("persisted conversation activity", () => {
  it("records successful submissions monotonically without advancing the event ordering clock", () => {
    const store = createStore();
    store.getState().updateSession("activity-session", { lastActivityAt: 300, hasPromptHistory: true });
    expect(store.getState().sessions[0]).toMatchObject({
      lastActivityAt: 300, hasPromptHistory: true, lastEventAt: 100,
    });
    store.getState().updateSession("activity-session", { lastActivityAt: 250 });
    expect(store.getState().sessions[0].lastActivityAt).toBe(300);

    // A completion that occurred before the latest user submission can arrive later.
    // Its event clock remains independent from the user activity clock.
    expect(store.getState().pushSessionEvent(completion({ createdAt: 275 }))).toBe("accepted");
    expect(store.getState().sessions[0]).toMatchObject({ lastActivityAt: 300, lastEventAt: 275 });
  });

  it.each(["codex", "codex_hook"])("records a completion from the matching %s source", (source) => {
    const store = createStore();
    expect(store.getState().pushSessionEvent(completion({ source }))).toBe("accepted");
    expect(store.getState().sessions[0].lastActivityAt).toBe(200);
  });

  it.each(["runtime", "claude", "claude_hook", "unknown"])("does not count a completion from %s as conversation activity", (source) => {
    const store = createStore();
    store.getState().pushSessionEvent(completion({ source }));
    expect(store.getState().sessions[0].lastActivityAt).toBeUndefined();
  });

  it.each([
    "session_started", "session_resumed", "process_exit", "process_error", "hook_error",
    "heartbeat_timeout", "terminal_command_complete",
  ] as const)("does not turn %s into a new conversation timestamp", (eventType) => {
    const store = createStore(createSession({ lastActivityAt: 150 }));
    store.getState().pushSessionEvent(completion({ eventType, createdAt: 500 }));
    expect(store.getState().sessions[0].lastActivityAt).toBe(150);
  });

  it("keeps duplicate and out-of-order completions from changing activity", () => {
    const store = createStore();
    const latest = completion({ id: "latest", dedupeKey: "turn-2", createdAt: 300 });
    expect(store.getState().pushSessionEvent(latest)).toBe("accepted");
    expect(store.getState().pushSessionEvent({ ...latest, createdAt: 400 })).toBe("duplicate");
    expect(store.getState().pushSessionEvent(completion({ id: "older", createdAt: 250 }))).toBe("stale");
    expect(store.getState().sessions[0].lastActivityAt).toBe(300);
  });

  it("rejects another project's activity even when its session id collides", () => {
    const store = createStore(createSession({ lastActivityAt: 150 }));
    store.getState().pushSessionEvent(completion({ projectPath: "D:/another-project", createdAt: 500 }));
    expect(store.getState().sessions[0].lastActivityAt).toBe(150);
    expect(store.getState().projectSessions[projectPath][0].lastActivityAt).toBe(150);
  });

  it("does not apply a departed session's submission after switching projects", () => {
    const store = createStore(createSession({ lastActivityAt: 150 }));
    store.getState().setCurrentProject({ name: "Other", path: "D:/other-project" });
    store.getState().addSession(createSession({ id: "other-session", path: "D:/other-project", lastActivityAt: 175 }));
    store.getState().updateSession("activity-session", { lastActivityAt: 500, hasPromptHistory: true });
    expect(store.getState().sessions[0].lastActivityAt).toBe(175);
    expect(store.getState().projectSessions[projectPath][0].lastActivityAt).toBe(150);
  });

  it("preserves the latest of twelve turns across a fresh store rehydration", () => {
    vi.useFakeTimers();
    const openedAt = new Date("2026-11-15T01:00:00Z").getTime();
    vi.setSystemTime(openedAt);
    const storage = createMemoryStorage();
    const store = createStore(createSession({ createdAt: openedAt, lastEventAt: openedAt }), storage);
    let lastReplyAt = openedAt;
    for (let turn = 1; turn <= 12; turn += 1) {
      const submittedAt = openedAt + turn * 10 * 60 * 1000;
      vi.setSystemTime(submittedAt);
      store.getState().updateSession("activity-session", { lastActivityAt: Date.now(), hasPromptHistory: true });
      vi.setSystemTime(submittedAt + 3000);
      lastReplyAt = Date.now();
      expect(store.getState().pushSessionEvent(completion({ id: `reply-${turn}`, createdAt: lastReplyAt }))).toBe("accepted");
    }
    vi.setSystemTime(lastReplyAt + 10_000);
    const restarted = createAppStore(storage);
    restarted.getState().setCurrentProject({ name: "Activity", path: projectPath });
    expect(restarted.getState().sessions[0]).toMatchObject({
      createdAt: openedAt, lastActivityAt: lastReplyAt, active: false,
    });
    expect(Date.now() - restarted.getState().sessions[0].lastActivityAt!).toBe(10_000);
  });
});
