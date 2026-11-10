import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  sessions: [
    { id: "codex-1", agentId: "codex", active: true },
    { id: "claude-1", agentId: "claude", active: true },
    { id: "gemini-1", agentId: "antigravity", active: true },
    { id: "qoder-1", agentId: "qoder", active: false },
    { id: "opencode-1", agentId: "opencode", active: true },
  ],
  activeSessionId: "codex-1", defaultAgentId: "codex", gitCloneTasks: [],
  focusedTabId: null, tabsById: {}, currentProject: null,
}));
vi.mock("@/store", () => ({ useAppStore: (select: (state: typeof fixture) => unknown) => select(fixture) }));
vi.mock("@/hooks/useProjectLauncher", () => ({ useProjectLauncher: () => ({ openProject: vi.fn() }) }));
vi.mock("@/hooks/useAgentUsage", () => ({ useAgentUsage: () => ({ value: null, loading: false, error: null, refresh: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./WorkbenchFeedback", () => ({ WorkbenchFeedback: ({ children }: { children: ReactNode }) => children }));
vi.mock("./FileStatusBar", () => ({ FileStatusPath: () => null, FileStatusDetails: () => null }));
import StatusBar, { AntigravityUsageStatus } from "./StatusBar";

beforeEach(() => {
  fixture.activeSessionId = "codex-1";
  for (const session of fixture.sessions) session.active = session.agentId !== "qoder";
});

test.each(["codex", "claude", "antigravity", "qoder", "opencode"])("status bar only displays the selected %s session's quota", (agentId) => {
  const selected = fixture.sessions.find((session) => session.agentId === agentId)!;
  selected.active = true;
  fixture.activeSessionId = selected.id;
  const markup = renderToStaticMarkup(createElement(StatusBar));
  for (const agent of ["codex", "claude", "antigravity", "qoder", "opencode"]) {
    if (agent === agentId) expect(markup).toContain(`statusBar.${agent}Usage.title`);
    else expect(markup).not.toContain(`statusBar.${agent}Usage.title`);
  }
});

test.each(["qoder-1", "terminal-1"])("does not fall back to other open agents for selected session %s", (sessionId) => {
  fixture.activeSessionId = sessionId;
  const markup = renderToStaticMarkup(createElement(StatusBar));
  for (const agent of ["codex", "claude", "antigravity", "qoder", "opencode"]) {
    expect(markup).not.toContain(`statusBar.${agent}Usage.title`);
  }
});

test("no usage is displayed when all sessions are inactive", () => {
  for (const session of fixture.sessions) session.active = false;
  const markup = renderToStaticMarkup(createElement(StatusBar));
  for (const agent of ["codex", "claude", "antigravity", "qoder", "opencode"]) {
    expect(markup).not.toContain(`statusBar.${agent}Usage.title`);
  }
});

test("all Antigravity model groups and all returned periods appear in the status bar", () => {
  const windows = [
    { id: "gemini-session", scope: "Gemini", window: "session", remainingPercent: 96, resetDescription: null },
    { id: "gemini-week", scope: "Gemini", window: "weekly", remainingPercent: 98, resetDescription: null },
    { id: "gemini-month", scope: "Gemini", window: "monthly", remainingPercent: 70, resetDescription: null },
    { id: "claude-gpt", scope: "Claude and GPT", window: "session", remainingPercent: 42, resetDescription: null },
    { id: "argon", scope: "Argon", window: "quota", remainingPercent: 12, resetDescription: null },
    { id: "future-model", scope: "Gemini 4", window: "4 hours", remainingPercent: 85, resetDescription: null },
  ];
  const markup = renderToStaticMarkup(createElement(AntigravityUsageStatus, {
    usage: { windows, status: "ok", updatedAt: Date.now(), error: null },
    isLoading: false, error: null, onRefresh: () => {},
  }));
  expect(markup.match(/class="app-quota-ring /g)).toHaveLength(windows.length);
  expect(markup).toContain("settings.agents.quota.claudeGpt");
  expect(markup).toContain("settings.agents.quota.argon");
  expect(markup).toContain("Gemini 4 · 4 hours");
  expect(markup).toContain("monthly");
  const visibleText = markup.replace(/<[^>]*>/g, "");
  expect(visibleText).not.toMatch(/Gemini|Claude|GPT|Argon|claudeGpt|argon/);
  expect(visibleText).toContain("4 hours");
  expect(visibleText).toContain("96");
  expect(visibleText).toContain("42");
});
