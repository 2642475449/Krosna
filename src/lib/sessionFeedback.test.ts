import { describe, expect, it } from "vitest";
import type { Session } from "@/types";
import type { AttentionItem } from "./attention";
import { getSessionFeedback } from "./sessionFeedback";

const session = (patch: Partial<Session> = {}) => ({ id: "a", path: "D:/repo", agentId: "codex", active: true, status: "completed", ...patch }) as Session;
const item = (patch: Partial<AttentionItem> = {}) => ({ sessionId: "a", kind: "completion", disposition: "open", createdAt: 1000, sourceRevision: 1, ...patch }) as AttentionItem;

describe("session feedback shared across navigation surfaces", () => {
  it.each(["starting", "running"] as const)("shows %s only for a live turn", status => {
    expect(getSessionFeedback(session({ status }))).toEqual({ state: status });
    expect(getSessionFeedback(session({ status, active: false }))).toBeNull();
  });
  it("keeps unread completion until the result is viewed", () => {
    expect(getSessionFeedback(session(), item(), 1000000)).toEqual({ state: "completed", unread: true });
    expect(getSessionFeedback(session(), item({ disposition: "resolved", resolutionReason: "session-opened" }), 1001)).toBeNull();
  });
  it("briefly acknowledges foreground completion without reviving old completions", () => {
    const completion = item({ disposition: "resolved", resolutionReason: "observed-in-foreground" });
    expect(getSessionFeedback(session(), completion, 2000)).toEqual({ state: "completed", expiresAt: 3000 });
    expect(getSessionFeedback(session(), completion, 3000)).toBeNull();
  });
  it.each(["permission", "input", "failure"] as const)("keeps %s after viewing without labelling it completed", kind => {
    const result = getSessionFeedback(session(), item({ kind, seenAt: 2000 }));
    expect(result?.state).toBe(kind === "permission" ? "permission" : kind === "input" ? "waiting" : "error");
  });
  it("ignores an old notification once a newer run starts", () => {
    expect(getSessionFeedback(session({ status: "running", statusRevision: 2 }), item())).toEqual({ state: "running" });
  });
  it("can present a new approval request before the running status catches up", () => {
    expect(getSessionFeedback(session({ status: "running", statusRevision: 1 }), item({ kind: "permission", sourceRevision: 2 }))?.state).toBe("permission");
  });
  it("does not invent agent state for ordinary terminals", () => {
    expect(getSessionFeedback(session({ agentId: "powershell", status: "running" }))).toBeNull();
  });
  it("keeps an idle prompt quiet unless there is an open input or permission request", () => {
    const idle = session({ status: "waiting" });
    expect(getSessionFeedback(idle)).toBeNull();
    expect(getSessionFeedback(idle, item({ kind: "input", disposition: "resolved" }))).toBeNull();
    expect(getSessionFeedback(idle, item({ kind: "input" }))?.state).toBe("waiting");
    expect(getSessionFeedback(idle, item({ kind: "permission" }))?.state).toBe("permission");
  });
  it("distinguishes an unknown live agent from stopped or previously completed work", () => {
    expect(getSessionFeedback(session({ status: undefined }))).toEqual({ state: "unknown" });
    expect(getSessionFeedback(session({ status: "stopped" }))).toBeNull();
    expect(getSessionFeedback(session())).toBeNull();
  });
});
