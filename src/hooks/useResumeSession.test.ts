import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "@/types";

const mocks = vi.hoisted(() => ({
  session: {} as Session,
  cleanup: vi.fn(),
  close: vi.fn(),
  resolveCodex: vi.fn(),
  spawn: vi.fn(),
  updateSession: vi.fn(),
  clearExit: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("antd", () => ({ message: { error: mocks.messageError } }));
vi.mock("@/lib/api", () => ({
  cleanupSessionProcess: mocks.cleanup,
  closePty: mocks.close,
  spawnPty: mocks.spawn,
  resolveRecentCodexSessionId: mocks.resolveCodex,
}));
vi.mock("@/store", () => {
  const state = () => ({
    defaultTerminalShell: "powershell",
    sessions: [mocks.session],
    updateSession: mocks.updateSession,
    clearTerminalExitCode: mocks.clearExit,
  });
  return { useAppStore: Object.assign((select: (value: ReturnType<typeof state>) => unknown) => select(state()), { getState: state }) };
});

import { useResumeSession } from "./useResumeSession";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { id: "terminal", path: "D:/project", name: "Terminal", createdAt: 1, active: false, agentId: "cmd" };
  mocks.cleanup.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.resolveCodex.mockResolvedValue(null);
  mocks.spawn.mockResolvedValue(undefined);
  mocks.updateSession.mockImplementation((_id: string, updates: Partial<Session>) => Object.assign(mocks.session, updates));
});

it("restarts a live shell in its last directory with its stable session identity", async () => {
  mocks.session = { ...mocks.session, active: true, status: "waiting", terminalWorkingDirectory: "D:/project/subdir" };
  await useResumeSession()(mocks.session.id, { restart: true });
  expect(mocks.close).toHaveBeenCalledWith("terminal");
  expect(mocks.close.mock.invocationCallOrder[0]).toBeLessThan(mocks.spawn.mock.invocationCallOrder[0]);
  expect(mocks.spawn.mock.calls[0][0]).toBe("terminal");
  expect(mocks.spawn.mock.calls[0][9]).toBe("D:/project/subdir");
  expect(mocks.session).toMatchObject({ active: true, status: "waiting", name: "Terminal" });
});

it("ordinary resume leaves a live session untouched", async () => {
  mocks.session.active = true;
  await useResumeSession()(mocks.session.id);
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("restores the exact Codex conversation after stopping its old process", async () => {
  mocks.session = { ...mocks.session, active: true, status: "running", agentId: "codex", hasPromptHistory: true, agentSessionId: "conversation-id" };
  await useResumeSession()(mocks.session.id, { restart: true });
  expect(mocks.resolveCodex).not.toHaveBeenCalled();
  expect(mocks.spawn.mock.calls[0][4]).toContain('resume "conversation-id"');
  expect(mocks.session.agentSessionId).toBe("conversation-id");
});

it("keeps a live Codex process when its original conversation cannot be resolved", async () => {
  mocks.session = { ...mocks.session, active: true, status: "running", statusRevision: 7, agentId: "codex", hasPromptHistory: true };
  mocks.resolveCodex.mockResolvedValue("another-terminal-conversation");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await useResumeSession()(mocks.session.id, { restart: true });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.resolveCodex).not.toHaveBeenCalled();
    expect(mocks.session).toMatchObject({ active: true, status: "running", statusRevision: 7 });
    expect(mocks.messageError).toHaveBeenCalledWith("tabBar.restartSessionRestoreFailed");
  } finally {
    log.mockRestore();
  }
});

it.each(["antigravity", "qoder", "opencode"] as const)("does not guess the previous %s conversation", async (agentId) => {
  mocks.session = { ...mocks.session, active: true, status: "waiting", agentId, hasPromptHistory: true };
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await useResumeSession()(mocks.session.id, { restart: true });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.session).toMatchObject({ active: true, status: "waiting" });
    expect(mocks.messageError).toHaveBeenCalledWith("tabBar.restartSessionRestoreFailed");
  } finally {
    log.mockRestore();
  }
});

it("starts an empty Qoder session without selecting another conversation", async () => {
  mocks.session = { ...mocks.session, active: true, status: "waiting", agentId: "qoder", hasPromptHistory: false };
  await useResumeSession()(mocks.session.id, { restart: true });
  expect(mocks.spawn.mock.calls[0][4]).not.toContain("--continue");
});

it("serializes restart requests from separate hook consumers", async () => {
  mocks.session = { ...mocks.session, active: true, status: "waiting" };
  let releaseClose: () => void = () => {};
  mocks.close.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseClose = resolve; }));
  const first = useResumeSession()(mocks.session.id, { restart: true });
  // Hook 事件可能将 starting 改成 waiting，跨组件锁仍需阻止第二次启动。
  mocks.session.status = "waiting";
  await useResumeSession()(mocks.session.id, { restart: true });
  expect(mocks.close).toHaveBeenCalledOnce();
  releaseClose();
  await first;
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it("does not revive a process that exits while closing fails", async () => {
  mocks.session = { ...mocks.session, active: true, status: "running", agentId: "codex", agentSessionId: "conversation-id", hasPromptHistory: true };
  let failClose: (error: Error) => void = () => {};
  mocks.close.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failClose = reject; }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const restart = useResumeSession()(mocks.session.id, { restart: true });
    mocks.session.active = false;
    failClose(new Error("close failed"));
    await restart;
    expect(mocks.session).toMatchObject({ active: false, status: "error" });
    expect(mocks.spawn).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it("preserves a newer status event when closing fails", async () => {
  mocks.session = { ...mocks.session, active: true, status: "running", agentId: "codex", agentSessionId: "conversation-id", hasPromptHistory: true };
  mocks.close.mockImplementationOnce(async () => {
    Object.assign(mocks.session, { status: "completed", statusRevision: 12 });
    throw new Error("close failed");
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await useResumeSession()(mocks.session.id, { restart: true });
    expect(mocks.session).toMatchObject({ active: true, status: "completed", statusRevision: 12 });
  } finally {
    log.mockRestore();
  }
});

it("restarts empty Codex without consulting another terminal's recent conversation", async () => {
  mocks.session = { ...mocks.session, active: true, status: "waiting", agentId: "codex", hasPromptHistory: false };
  mocks.resolveCodex.mockResolvedValue("another-terminal-conversation");
  await useResumeSession()(mocks.session.id, { restart: true });
  expect(mocks.resolveCodex).not.toHaveBeenCalled();
  expect(mocks.spawn.mock.calls[0][4]).not.toContain("resume");
  expect(mocks.spawn.mock.calls[0][4]).not.toContain("another-terminal-conversation");
});

it("preserves the existing recent-conversation fallback for ordinary resume", async () => {
  mocks.session = { ...mocks.session, active: false, agentId: "codex", hasPromptHistory: true };
  mocks.resolveCodex.mockResolvedValue("legacy-conversation");
  await useResumeSession()(mocks.session.id);
  expect(mocks.resolveCodex).toHaveBeenCalledWith("D:/project", 1);
  expect(mocks.spawn.mock.calls[0][4]).toContain('resume "legacy-conversation"');
  expect(mocks.close).not.toHaveBeenCalled();
});

it("restarts Pi with the stable session ID when no external ID is bound", async () => {
  mocks.session = { ...mocks.session, active: true, status: "waiting", agentId: "pi", hasPromptHistory: true };
  await useResumeSession()(mocks.session.id, { restart: true });
  expect(mocks.spawn.mock.calls[0][4]).toContain('--session-id "terminal"');
  expect(mocks.session.agentSessionId).toBe("terminal");
});

it("restarts Qoder with its exact conversation and permission mode", async () => {
  mocks.session = { ...mocks.session, active: true, status: "waiting", agentId: "qoder", hasPromptHistory: true,
    agentSessionId: "qoder-conversation", qoderPermissionMode: "bypass_permissions" };
  await useResumeSession()(mocks.session.id, { restart: true });
  expect(mocks.spawn.mock.calls[0][4]).toContain('--resume "qoder-conversation"');
  expect(mocks.spawn.mock.calls[0][4]).toContain("--permission-mode bypass_permissions");
});

it("refuses to restart a session that is already starting", async () => {
  mocks.session.status = "starting";
  await useResumeSession()(mocks.session.id, { restart: true });
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("keeps the session stopped and retryable when replacement startup fails", async () => {
  mocks.session = { ...mocks.session, active: true, status: "waiting" };
  mocks.spawn.mockRejectedValueOnce(new Error("replacement failed"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await useResumeSession()(mocks.session.id, { restart: true });
    expect(mocks.session).toMatchObject({ active: false, status: "error" });
    expect(mocks.clearExit).not.toHaveBeenCalled();
    await useResumeSession()(mocks.session.id, { restart: true });
    expect(mocks.session).toMatchObject({ active: true, status: "waiting" });
  } finally {
    log.mockRestore();
  }
});

it.each(["cmd", "powershell"] as const)("restarts %s as the same shell without launching an agent", async (shell) => {
  mocks.session.agentId = shell;
  await useResumeSession()(mocks.session.id);
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(mocks.spawn.mock.calls[0][4]).toBe("");
  expect(mocks.spawn.mock.calls[0][6]).toBe(shell);
  expect(mocks.session.active).toBe(true);
  expect(mocks.clearExit).toHaveBeenCalledWith("terminal");
});

it("keeps the retained exit state when restarting fails", async () => {
  mocks.spawn.mockRejectedValueOnce(new Error("spawn failed"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await useResumeSession()(mocks.session.id);
    expect(mocks.session).toMatchObject({ active: false, status: "error" });
    expect(mocks.clearExit).not.toHaveBeenCalled();
    expect(mocks.messageError).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
