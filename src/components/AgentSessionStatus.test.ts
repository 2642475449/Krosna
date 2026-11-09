// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "@/types";
import type { AttentionItem } from "@/lib/attention";
import { AgentSessionStatus } from "./AgentSessionStatus";
import { AgentActivityIcon } from "./AgentActivityIcon";

const mocks = vi.hoisted(() => ({
  item: undefined as AttentionItem | undefined,
  markRead: vi.fn(),
}));
vi.mock("@/store", () => ({ useAppStore: Object.assign(
  (select: (state: unknown) => unknown) => select({ projectAttentionItems: { "D:/repo": mocks.item ? [mocks.item] : [] } }),
  { getState: () => ({ markSessionRead: mocks.markRead }) },
) }));
vi.mock("antd", async importOriginal => ({ ...await importOriginal<typeof import("antd")>(), Tooltip: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root;
let host: HTMLDivElement;
const session = { id: "a", path: "D:/repo", agentId: "codex", active: true, status: "completed" } as Session;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.item = undefined;
  mocks.markRead.mockClear();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uses an official Ant Design spinner and a static red Badge dot for errors", async () => {
  await act(async () => root.render(React.createElement(AgentSessionStatus, { session: { ...session, status: "running" } })));
  expect(host.querySelector('[data-icon="loading"]')).not.toBeNull();
  expect(host.querySelector(".anticon-spin")).not.toBeNull();
  await act(async () => root.render(React.createElement(AgentSessionStatus, { session: { ...session, status: "error" } })));
  expect(host.querySelector(".ant-badge-status-dot")).not.toBeNull();
  expect(host.querySelector(".ant-badge-status-dot")?.getAttribute("style")).toContain("--cs-error");
  expect(host.querySelector(".anticon-spin")).toBeNull();
});
it("hides the default waiting dot but shows an explicit input request", async () => {
  const idle = { ...session, status: "waiting" } as Session;
  await act(async () => root.render(React.createElement(AgentSessionStatus, { session: idle })));
  expect(host.querySelector('[data-state="idle"]')).not.toBeNull();
  expect(host.querySelector(".ant-badge-status-dot")).toBeNull();
  mocks.item = { sessionId: "a", kind: "input", disposition: "open", createdAt: 1000 } as AttentionItem;
  await act(async () => root.render(React.createElement(AgentSessionStatus, { session: idle })));
  expect(host.querySelector('[data-state="waiting"]')).not.toBeNull();
  expect(host.querySelector(".ant-badge-status-dot")?.getAttribute("style")).toContain("--cs-warning");
});
it("keeps the brand asset unchanged and removes activity animation hooks", () => {
  for (const status of ["running", "waiting", "error", "completed"] as const) {
    const markup = renderToStaticMarkup(React.createElement(AgentActivityIcon, { agentId: "codex", active: true, status }));
    expect(markup).toContain('src="/agents/codex.svg"');
    expect(markup).not.toContain("agent-activity-icon");
    expect(markup).not.toContain("data-state");
  }
});
it("expires foreground completion after two seconds and reserves the status slot", async () => {
  mocks.item = { sessionId: "a", kind: "completion", disposition: "resolved", resolutionReason: "observed-in-foreground", createdAt: 1000 } as AttentionItem;
  await act(async () => root.render(React.createElement(AgentSessionStatus, { session })));
  expect(host.querySelector(".ant-badge-status-dot")).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(host.querySelector('[data-state="idle"]')).not.toBeNull();
  expect(host.querySelector(".ant-badge-status-dot")).toBeNull();
});
it("does not mark a background result read and observes it on actual foreground focus", async () => {
  mocks.item = { sessionId: "a", kind: "completion", disposition: "open", createdAt: 1000 } as AttentionItem;
  vi.mocked(document.hasFocus).mockReturnValue(false);
  await act(async () => root.render(React.createElement(AgentSessionStatus, { session, visible: true })));
  expect(mocks.markRead).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(host.querySelector('[data-unread="true"]')).not.toBeNull();
  vi.mocked(document.hasFocus).mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(mocks.markRead).toHaveBeenCalledWith("a");
});
it("does not mark a hidden tab read on hover or focus of the window", async () => {
  mocks.item = { sessionId: "a", kind: "completion", disposition: "open", createdAt: 1000 } as AttentionItem;
  await act(async () => root.render(React.createElement(AgentSessionStatus, { session })));
  await act(async () => {
    host.firstElementChild!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.markRead).not.toHaveBeenCalled();
});

it("resolves a completion when its session is viewed even if the notification was already seen", async () => {
  mocks.item = { sessionId: "a", kind: "completion", disposition: "open", seenAt: 500, createdAt: 1000 } as AttentionItem;
  await act(async () => root.render(React.createElement(AgentSessionStatus, { session, visible: true })));
  expect(mocks.markRead).toHaveBeenCalledWith("a");
});
