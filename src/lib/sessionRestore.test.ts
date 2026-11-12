import { expect, it } from "vitest";
import type { Session } from "@/types";
import { buildSessionRestorePlan } from "./sessionRestore";

const session: Session = { id: "stable-session", path: "D:/repo", name: "Task", createdAt: 1, active: false };

it.each(["claude", "pi"] as const)("restores %s by its stable identity without searching recent history", (agentId) => {
  expect(buildSessionRestorePlan({ ...session, agentId, hasPromptHistory: true }))
    .toEqual({ kind: "resume-exact", agentSessionId: session.id, resume: true });
});

it.each(["codex", "antigravity", "qoder", "opencode"] as const)("requires an exact native identity for existing %s conversations", (agentId) => {
  expect(buildSessionRestorePlan({ ...session, agentId, hasPromptHistory: true }).kind).toBe("unavailable");
  expect(buildSessionRestorePlan({ ...session, agentId }).kind).toBe("unavailable");
  expect(buildSessionRestorePlan({ ...session, agentId, agentSessionId: "native-session" }))
    .toEqual({ kind: "resume-exact", agentSessionId: "native-session", resume: true });
});

it.each(["claude", "codex", "pi", "antigravity", "qoder"] as const)("only starts a fresh %s session when its empty history is explicit", (agentId) => {
  expect(buildSessionRestorePlan({ ...session, agentId, hasPromptHistory: false }))
    .toEqual({ kind: "start-empty", agentSessionId: agentId === "pi" ? session.id : null, resume: false });
  expect(buildSessionRestorePlan({ ...session, agentId, hasPromptHistory: false, agentSessionId: "bound-session" }).kind)
    .toBe("resume-exact");
});

it("keeps OpenCode unavailable until its exact native conversation has been bound", () => {
  expect(buildSessionRestorePlan({ ...session, agentId: "opencode", hasPromptHistory: false }).kind).toBe("unavailable");
});

it("preserves legacy Claude identity instead of creating an unrelated conversation", () => {
  expect(buildSessionRestorePlan(session))
    .toEqual({ kind: "resume-exact", agentSessionId: session.id, resume: true });
});

it("does not automatically reopen archived sessions or ephemeral AI sessions", () => {
  for (const candidate of [{ ...session, archived: true }, { ...session, ephemeral: true },
    { ...session, archived: true, agentId: "cmd" as const }]) {
    expect(buildSessionRestorePlan(candidate)).toEqual({ kind: "unavailable", reason: "unsupported-session" });
  }
});

it.each(["cmd", "powershell"] as const)("recreates %s as an empty shell even when its tab is ephemeral", (agentId) => {
  expect(buildSessionRestorePlan({ ...session, agentId, ephemeral: true, hasPromptHistory: true }))
    .toEqual({ kind: "start-empty", agentSessionId: null, resume: false });
});

it("rejects malformed native identities without treating them as empty sessions", () => {
  expect(buildSessionRestorePlan({ ...session, agentId: "codex", hasPromptHistory: false, agentSessionId: 'bad"; command' }).kind)
    .toBe("unavailable");
});
