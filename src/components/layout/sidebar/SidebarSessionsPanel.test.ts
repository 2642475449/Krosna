import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/types";
import zhCN from "@/locales/zh-CN.json";
import enUS from "@/locales/en-US.json";
import jaJP from "@/locales/ja-JP.json";

const mocks = vi.hoisted(() => ({ language: "zh-CN" }));
vi.mock("@ant-design/icons", () => ({
  CodeOutlined: () => null,
  DownOutlined: () => null,
  HistoryOutlined: () => null,
  InboxOutlined: () => null,
  PushpinOutlined: () => null,
  PushpinFilled: () => null,
}));
vi.mock("antd", () => ({
  Dropdown: ({ children }: { children: ReactNode }) => children,
  Empty: () => null,
  Tooltip: ({ children, title }: { children: ReactNode; title: ReactNode }) =>
    createElement("div", null, children, createElement("div", { "data-tooltip": true }, title)),
}));
vi.mock("@/components/ui/WorkbenchGlyph", () => ({ WorkbenchEmptyArtwork: () => null }));
vi.mock("@/components/AgentActivityIcon", () => ({ AgentActivityIcon: () => null }));
vi.mock("@/components/AgentSessionStatus", () => ({ AgentSessionStatus: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string | number> = {}) => {
      const dictionaries = { "zh-CN": zhCN, "en-US": enUS, "ja-JP": jaJP };
      const dictionary = dictionaries[mocks.language as keyof typeof dictionaries];
      const label = key.split(".").reduce<unknown>((value, part) =>
        (value as Record<string, unknown>)?.[part], dictionary);
      return String(label ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
    },
  }),
}));

import SidebarSessionsPanel from "./SidebarSessionsPanel";

const now = new Date("2026-11-15T12:00:00").getTime();
const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const createdAt = now - 2 * hour;
function session(updates: Partial<Session> = {}): Session {
  return { id: "session", path: "D:/project", name: "Ongoing conversation", createdAt, active: true, ...updates };
}
function render(item: Session, overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(SidebarSessionsPanel, {
    currentProject: { name: "Project", path: item.path },
    sessions: [item], attentionItems: [], activeSessionId: item.id, locale: mocks.language,
    noProjectText: "No project", noSessionsText: "No sessions", archiveSessionText: "Archive",
    pinSessionText: "Pin", unpinSessionText: "Unpin", pinnedSectionText: "Pinned", sessionsSectionText: "Sessions",
    staleSectionText: "Inactive (7d+)", archiveStaleSessionsText: "Archive all inactive sessions",
    pinnedCollapsed: false, sessionsCollapsed: false, staleCollapsed: true, now,
    onTogglePinned: vi.fn(), onToggleSessions: vi.fn(), onToggleStale: vi.fn(), onOpenSession: vi.fn(),
    onArchiveSession: vi.fn(), onArchiveStaleSessions: vi.fn(), onTogglePinSession: vi.fn(), getSessionMenuItems: () => [],
    ...overrides,
  }));
}
function timeLabel(markup: string) {
  return markup.match(/<span class="app-session-time[^\"]*">([^<]*)<\/span>/)?.[1];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.language = "zh-CN";
});
afterEach(() => vi.useRealTimers());

describe("sidebar conversation time", () => {
  it("shows the latest interaction after a two-hour conversation, independently of newer lifecycle events", () => {
    const markup = render(session({ lastActivityAt: now - 5 * minute, lastEventAt: now, statusUpdatedAt: now }));
    expect(timeLabel(markup)).toBe("5 分钟前");
    expect(timeLabel(markup)).not.toContain("创建于");
  });

  it("labels an old session without recorded interaction with concise relative time and creation tooltip", () => {
    const markup = render(session({ lastEventAt: now, statusUpdatedAt: now }));
    expect(timeLabel(markup)).toBe("2 小时前");
    expect(markup).not.toContain("最近对话：");
    expect(markup).toContain(`创建时间：${dayjs(createdAt).format("YYYY-MM-DD HH:mm:ss")}`);
  });

  it("updates relative age when the parent renders again after time advances", () => {
    const item = session({ lastActivityAt: now });
    expect(timeLabel(render(item))).toBe("几秒前");
    vi.advanceTimersByTime(5 * minute);
    expect(timeLabel(render(item))).toBe("5 分钟前");
  });

  it("provides both interaction and creation timestamps in the tooltip", () => {
    const lastActivityAt = now - minute;
    const markup = render(session({ lastActivityAt }));
    expect(markup).toContain(`最近对话：${dayjs(lastActivityAt).format("YYYY-MM-DD HH:mm:ss")}\n创建时间：${dayjs(createdAt).format("YYYY-MM-DD HH:mm:ss")}`);
    expect(markup).toContain('class="whitespace-pre-line"');
  });

  it("uses Japanese relative time with the Japanese time labels", () => {
    mocks.language = "ja-JP";
    expect(timeLabel(render(session({ lastActivityAt: now - 5 * minute })))).toBe("5分前");
  });

  it.each([
    ["zh-CN", zhCN, "最近对话：", "创建时间："],
    ["en-US", enUS, "Last interaction: ", "Created: "],
    ["ja-JP", jaJP, "最終対話：", "作成日時："],
  ] as const)("supplies the tooltip time labels in %s", (language, dictionary, activityLabel, createdLabel) => {
    mocks.language = language;
    for (const key of ["sessionLastActivity", "sessionCreatedAt"] as const) {
      expect(dictionary.sidebar[key]).toContain("{{time}}");
    }
    const createdMarkup = render(session());
    expect(createdMarkup).toContain(createdLabel);
    const markup = render(session({ lastActivityAt: now - minute }));
    expect(markup).toContain(activityLabel);
    expect(markup).toContain(createdLabel);
    expect(markup).not.toContain("sidebar.session");
  });

  it("renders a collapsed stale section with an archive-all button when sessions exceed 7 days of inactivity", () => {
    const staleItem = session({
      id: "stale-1",
      name: "Old Session",
      createdAt: now - 8 * 24 * hour,
      active: false,
      status: "stopped",
    });
    const markup = render(staleItem, { activeSessionId: null, staleCollapsed: true });
    expect(markup).toContain("Inactive (7d+)");
    expect(markup).toContain('aria-label="Archive all inactive sessions"');
    expect(markup).toContain('data-open="false" aria-hidden="true"');
  });
});
