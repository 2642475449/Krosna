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
vi.mock("@/hooks/useResumeSession", () => ({ useResumeSession: () => vi.fn() }));
vi.mock("@/lib/api", () => ({ openInAssociatedApplication: vi.fn(), openInFileManager: vi.fn(), inspectAgentClis: vi.fn() }));
vi.mock("@/components/ui/TabSelectionIndicator", () => ({ TabSelectionIndicator: () => null }));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
import TabBar from "./TabBar";

let root: Root;
let host: HTMLDivElement;
let availableWidth: number;
let resizeCallbacks: Array<() => void>;
const tab = { id: "file", kind: "file", title: "index.ts", resourceId: "D:/project/index.ts", dirty: true };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  availableWidth = 1000;
  resizeCallbacks = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resizeCallbacks.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("app-tabbar-tabs")
      ? availableWidth - (this.parentElement?.querySelector(".app-tabbar-overflow-control") ? 32 : 0) : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.dataset.tabId ? 96 : this.classList.contains("app-tabbar-overflow-control") ? 32 : 0;
  });
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function overflowFixture() {
  const tabs = ["first", "middle", "last"].map(id => ({
    id, kind: "file", title: `完整文件标题-${id}.ts`, resourceId: `D:/project/${id}.ts`, dirty: id === "first",
  }));
  mocks.state.tabsById = Object.fromEntries(tabs.map(tab => [tab.id, tab]));
  mocks.state.panesById = { main: { tabIds: tabs.map(tab => tab.id) }, other: { tabIds: ["unrelated"] } };
  availableWidth = 240;
  return tabs.map(tab => tab.id);
}

it("lists full titles for overflowed tabs and activates the selected tab in its own pane", async () => {
  const tabIds = overflowFixture();
  await act(async () => root.render(React.createElement(TabBar, { paneId: "main", tabIds, activeTabId: "last" })));
  const button = host.querySelector<HTMLButtonElement>('[aria-label="tabBar.allTabs"]')!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  const entries = Array.from(document.body.querySelectorAll<HTMLElement>(".app-tabbar-overflow-menu .ant-dropdown-menu-item"));
  expect(entries.map(entry => entry.textContent)).toEqual([
    "完整文件标题-first.ts *", "完整文件标题-middle.ts", "完整文件标题-last.ts",
  ]);
  expect(entries[2].classList.contains("ant-dropdown-menu-item-selected")).toBe(true);
  await act(async () => entries[0].click());
  expect(mocks.activate).toHaveBeenCalledExactlyOnceWith("first", "main");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(mocks.close).not.toHaveBeenCalled();
});

it("removes overflow controls when tabs fit without the control and restores them on narrowing", async () => {
  const tabIds = overflowFixture();
  await act(async () => root.render(React.createElement(TabBar, { paneId: "main", tabIds, activeTabId: "last" })));
  expect(host.querySelector('[aria-label="tabBar.allTabs"]')).not.toBeNull();
  // 300px fits three 96px tabs once the 32px control is removed.
  availableWidth = 300;
  await act(async () => [...resizeCallbacks].forEach(callback => callback()));
  expect(host.querySelector('[aria-label="tabBar.allTabs"]')).toBeNull();
  availableWidth = 240;
  await act(async () => [...resizeCallbacks].forEach(callback => callback()));
  expect(host.querySelector('[aria-label="tabBar.allTabs"]')).not.toBeNull();
  await act(async () => root.render(React.createElement(TabBar, { paneId: "main", tabIds: ["first"], activeTabId: "first" })));
  expect(host.querySelector('[aria-label="tabBar.allTabs"]')).toBeNull();
});

it("ignores a menu selection after its tab has left the pane", async () => {
  const tabIds = overflowFixture();
  await act(async () => root.render(React.createElement(TabBar, { paneId: "main", tabIds, activeTabId: "last" })));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="tabBar.allTabs"]')!.click());
  const first = document.body.querySelector<HTMLElement>(".app-tabbar-overflow-menu .ant-dropdown-menu-item")!;
  mocks.state.panesById = { main: { tabIds: ["middle", "last"] } };
  await act(async () => first.click());
  expect(mocks.activate).not.toHaveBeenCalled();
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
it("closes all other tabs together without waiting sequentially for each runtime teardown", async () => {
  const s1 = { id: "s1", kind: "session", title: "Session 1", resourceId: "s1" };
  const s2 = { id: "s2", kind: "session", title: "Session 2", resourceId: "s2" };
  const keep = { id: "keep", kind: "session", title: "Keep", resourceId: "keep" };
  mocks.state.sessions = [
    { id: "s1", name: "Session 1", path: "D:/project", agentId: "codex", active: true, status: "running" },
    { id: "s2", name: "Session 2", path: "D:/project", agentId: "codex", active: true, status: "running" },
    { id: "keep", name: "Keep", path: "D:/project", agentId: "codex", active: true, status: "running" },
  ];
  mocks.state.tabsById = { s1, s2, keep };
  mocks.state.panesById = { main: { tabIds: ["s1", "keep", "s2"] } };
  let resolveTeardown!: () => void;
  mocks.runtime.mockImplementation(() => new Promise<void>((resolve) => { resolveTeardown = resolve; }));

  await act(async () => root.render(React.createElement(TabBar, { paneId: "main", tabIds: ["s1", "keep", "s2"], activeTabId: "keep" })));
  const keepTab = host.querySelectorAll(".tab-item")[1]!;
  await act(async () => {
    keepTab.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const closeOthersItem = Array.from(document.body.querySelectorAll(".ant-dropdown-menu-item"))
    .find((el) => el.textContent?.includes("tabBar.closeOtherTabs")) as HTMLElement | undefined;
  expect(closeOthersItem).toBeDefined();
  await act(async () => {
    closeOthersItem!.click();
  });

  expect(mocks.close.mock.calls).toEqual([["s1", "main"], ["s2", "main"]]);
  expect(mocks.runtime.mock.calls).toEqual([[s1], [s2]]);
  resolveTeardown();
});

