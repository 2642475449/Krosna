import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/types";
import {
  getAgentUserResponseBaseline,
  createTerminalAgentUserResponse,
  getAgentTurnInputResponseBaseline,
  isAgentUserResponseBaselineCurrent,
} from "./agentUserResponse";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-a",
    path: "E:/project",
    name: "Agent",
    createdAt: 1,
    agentId: "codex",
    active: true,
    status: "waiting",
    statusRevision: 4,
    lastEventType: "permission_request",
    ...overrides,
  };
}

describe("agent user response baseline", () => {
  it.each(["permission_request", "waiting_input"] as const)(
    "captures a revisioned %s wait",
    (eventType) => {
      expect(getAgentUserResponseBaseline(session({ lastEventType: eventType }))).toEqual({
        revision: 4,
        eventType,
      });
    },
  );

  it("does not infer from an ordinary idle wait", () => {
    expect(getAgentUserResponseBaseline(session({ lastEventType: "session_started" }))).toBeNull();
  });

  it("routes a waiting input as an Agent response only while a checkpoint turn is active", () => {
    expect(getAgentTurnInputResponseBaseline(session({
      checkpointActiveTurnId: "turn-a",
      lastEventType: "waiting_input",
    }))).toEqual({
      revision: 4,
      eventType: "waiting_input",
    });
    expect(getAgentTurnInputResponseBaseline(session({
      checkpointActiveTurnId: null,
      lastEventType: "waiting_input",
    }))).toBeNull();
  });

  it.each([null, undefined, "turn-a"])("recognizes a permission reply with checkpoint %s", (checkpointActiveTurnId) => {
    expect(getAgentTurnInputResponseBaseline(session({ checkpointActiveTurnId }))).toEqual({
      revision: 4, eventType: "permission_request",
    });
  });

  it("rejects a baseline after a provider transition wins the race", () => {
    const baseline = getAgentUserResponseBaseline(session())!;
    expect(isAgentUserResponseBaselineCurrent(session({ statusRevision: 5 }), baseline)).toBe(false);
    expect(isAgentUserResponseBaselineCurrent(session({ status: "running" }), baseline)).toBe(false);
  });
});

describe("terminal selection response", () => {
  it.each(["1", "y", "a", "\x1b[121u"])("reconciles shortcut %j after a successful write and native working status", (key) => {
    const confirm = vi.fn();
    const tracker = createTerminalAgentUserResponse({ getSession: () => session(), confirm });
    const acknowledge = tracker.prepareInput(key);
    acknowledge(true);
    expect(confirm).not.toHaveBeenCalled();
    tracker.observeProgramStatus("app=codex:state=working");
    tracker.observeProgramStatus("app=codex:state=working");
    expect(confirm).toHaveBeenCalledExactlyOnceWith({ revision: 4, eventType: "permission_request" });
  });

  it("handles native output arriving before the PTY write acknowledgement", () => {
    const confirm = vi.fn();
    const tracker = createTerminalAgentUserResponse({ getSession: () => session(), confirm });
    const acknowledge = tracker.prepareInput("1");
    tracker.observeProgramStatus("app=codex:state=working");
    expect(confirm).not.toHaveBeenCalled();
    acknowledge(true);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it.each(["app=codex:state=blocked:kind=permission", "app=codex:state=idle", "app=codex:state=working:parent=child", "app=claude-code:state=working"])(
    "does not treat %s as a completed choice", (status) => {
      const confirm = vi.fn();
      const tracker = createTerminalAgentUserResponse({ getSession: () => session(), confirm });
      tracker.prepareInput("1")(true);
      tracker.observeProgramStatus(status);
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it("cannot clear a newer permission or question", () => {
    let current = session();
    const confirm = vi.fn();
    const tracker = createTerminalAgentUserResponse({ getSession: () => current, confirm });
    tracker.prepareInput("1")(true);
    current = session({ statusRevision: 5, lastEventType: "waiting_input" });
    tracker.observeProgramStatus("app=codex:state=working");
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(["failed-write", "cancel", "dispose", "clear", "no-input", "enter"])("ignores working status after %s", (scenario) => {
    const confirm = vi.fn();
    const tracker = createTerminalAgentUserResponse({ getSession: () => session(), confirm });
    if (scenario !== "no-input") tracker.prepareInput(scenario === "enter" ? "\r" : "1")(scenario !== "failed-write");
    if (scenario === "cancel") tracker.cancel();
    if (scenario === "dispose") tracker.dispose();
    if (scenario === "clear") tracker.observeProgramStatus("state=clear");
    tracker.observeProgramStatus("app=codex:state=working");
    expect(confirm).not.toHaveBeenCalled();
  });
});
