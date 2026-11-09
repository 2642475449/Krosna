// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(), runtime: vi.fn(), close: vi.fn(), activate: vi.fn(), drag: vi.fn(),
  state: {} as Record<string, unknown>,
}));
vi.mock("@/store", () => ({ useAppStore: Object.assign(
  (select: (state: typeof mocks.state) => unknown) => select(mocks.state), { getState: () => mocks.state },
) }));
vi.mock("@/lib/tabClose", () => ({ confirmCloseTab: mocks.confirm, closeTabRuntime: mocks.runtime }));
vi.mock("@/lib/api", () => ({ openInAssociatedApplication: vi.fn(), openInFileManager: vi.fn(), inspectAgentClis: vi.fn() }));
vi.mock("@/components/ui/TabSelectionIndicator", () => ({ TabSelectionIndicator: () => null }));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
import TabBar from "./TabBar";

let root: Root;
let host: HTMLDivElement;
const tab = { id: "file", kind: "file", title: "index.ts", resourceId: "D:/project/index.ts", dirty: true };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
  mocks.runtime.mockResolvedValue(undefined);
  mocks.state = {
    sessions: [], tabsById: { file: tab }, panesById: { main: { tabIds: ["file"] } },
    dragState: null, currentProject: null, agentPermissionDefaults: {},
    setActiveSession: mocks.activate, closeTab: mocks.close, splitTab: vi.fn(), setDragState: mocks.drag, promoteTab: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function middleClick(selector = ".tab-item") {
  await act(async () => root.render(React.createElement(TabBar, { paneId: "main", tabIds: ["file"], activeTabId: null })));
  const target = host.querySelector(selector)!;
  const down = new MouseEvent("mousedown", { button: 1, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { button: 1, bubbles: true, cancelable: true }));
    target.dispatchEvent(down);
    target.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
  });
  expect(down.defaultPrevented).toBe(true);
}

it("places the agent status in the trailing close slot after the title", async () => {
  const session = { id: "agent", name: "Agent task", path: "D:/project", agentId: "codex", active: true, status: "running" };
  mocks.state.sessions = [session];
  mocks.state.tabsById = { agent: { id: "agent", kind: "session", title: session.name, resourceId: session.id } };
  await act(async () => root.render(React.createElement(TabBar, { paneId: "main", tabIds: [session.id], activeTabId: null })));
  const logo = host.querySelector('.tab-item img[src="/agents/codex.svg"]')!;
  const status = host.querySelector(".tab-item .app-agent-session-status")!;
  const title = host.querySelector(".tab-item .app-tabbar-title")!;
  expect(logo.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(title.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(status.closest(".app-tabbar-action")).toBe(host.querySelector(".tab-close-btn")?.parentElement);
  expect(host.querySelectorAll(".app-agent-session-status")).toHaveLength(1);
});
it("closes a running agent from the shared slot through confirmation without activating the tab", async () => {
  const session = { id: "agent", name: "Agent task", path: "D:/project", agentId: "codex", active: true, status: "running" };
  const agentTab = { id: session.id, kind: "session", title: session.name, resourceId: session.id };
  mocks.state.sessions = [session];
  mocks.state.tabsById = { agent: agentTab };
  mocks.state.panesById = { main: { tabIds: [session.id] } };
  await act(async () => root.render(React.createElement(TabBar, { paneId: "main", tabIds: [session.id], activeTabId: null })));
  const close = host.querySelector<HTMLButtonElement>(".tab-close-btn")!;
  expect(close.getAttribute("aria-label")).toBe("tabBar.closeTab");
  await act(async () => {
    close.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
    close.click();
  });
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(agentTab, expect.any(Function));
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith(session.id, "main");
  expect(mocks.runtime).toHaveBeenCalledExactlyOnceWith(agentTab);
  expect(mocks.activate).not.toHaveBeenCalled();
  expect(mocks.drag).not.toHaveBeenCalled();
});
it("middle closes an inactive tab once through the existing confirmation without activating or dragging", async () => {
  await middleClick(".tab-close-btn");
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(tab, expect.any(Function));
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith("file", "main");
  expect(mocks.runtime).toHaveBeenCalledExactlyOnceWith(tab);
  expect(mocks.activate).not.toHaveBeenCalled();
  expect(mocks.drag).not.toHaveBeenCalled();
});
it("respects a cancelled dirty-file confirmation", async () => {
  mocks.confirm.mockResolvedValue(false);
  await middleClick();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.runtime).not.toHaveBeenCalled();
});
it("does not dispose a tab runtime still open in another pane", async () => {
  mocks.state.panesById = { main: { tabIds: ["file"] }, other: { tabIds: ["file"] } };
  await middleClick();
  expect(mocks.close).toHaveBeenCalledExactlyOnceWith("file", "main");
  expect(mocks.runtime).not.toHaveBeenCalled();
});
