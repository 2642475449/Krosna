import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { Session } from "@/types";

interface TestTab {
  id: string;
  kind: string;
  title: string;
  resourceId: string;
}

interface TestState {
  sessions: Session[];
  tabsById: Record<string, TestTab>;
  panesById: Record<string, { tabIds: string[] }>;
  currentProject: { path: string } | null;
  dragState: null;
  defaultTerminalShell: string;
  setActiveSession: ReturnType<typeof vi.fn>;
  closeTab: ReturnType<typeof vi.fn>;
  splitTab: ReturnType<typeof vi.fn>;
  setDragState: ReturnType<typeof vi.fn>;
  promoteTab: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  state: {} as TestState,
  restart: vi.fn(),
  slots: [] as unknown[],
  cursor: 0,
}));

// 直接调用组件并检查 React 元素树：只模拟 hook 调度，不创建 DOM 或运行浏览器副作用。
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => ({ current: value }),
  useEffect: () => {},
  useState: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.slots)) mocks.slots[index] = initial;
    return [mocks.slots[index], (next: unknown) => {
      mocks.slots[index] = typeof next === "function" ? next(mocks.slots[index]) : next;
    }];
  },
}));
vi.mock("react-dom", () => ({ createPortal: vi.fn() }));
vi.mock("antd", () => ({
  Button: "test-button", Tooltip: "test-tooltip", Dropdown: "test-dropdown", Modal: "test-modal",
  message: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@ant-design/icons", () => Object.fromEntries([
  "CloseOutlined", "ExportOutlined", "LoadingOutlined", "SettingOutlined", "PlusOutlined",
  "FolderOpenFilled", "CopyOutlined", "StopOutlined", "CloseCircleOutlined", "ClockCircleOutlined",
  "ShopOutlined", "ReloadOutlined",
].map((name) => [name, `test-${name}`])));
vi.mock("@/store", () => ({ useAppStore: Object.assign(
  (select: (state: TestState) => unknown) => select(mocks.state),
  { getState: () => mocks.state },
) }));
vi.mock("@/hooks/useResumeSession", () => ({ useResumeSession: () => mocks.restart }));
vi.mock("@/store/slices/shortcutSlice", () => ({ useShortcutStore: () => null }));
vi.mock("@/lib/appShortcuts", () => ({ getAppShortcut: () => null }));
vi.mock("@/lib/api", () => ({
  inspectAgentClis: vi.fn(), openInAssociatedApplication: vi.fn(), openInFileManager: vi.fn(),
}));
vi.mock("@/lib/tabClose", () => ({ closeTabRuntime: vi.fn(), confirmCloseTab: vi.fn() }));
vi.mock("@/lib/fileIcon", () => ({ getFileIconByName: () => ({ color: "", icon: null }) }));
vi.mock("@/lib/scheduledTasks", () => ({ SCHEDULED_TASKS_TAB_ID: "scheduled" }));
vi.mock("@/components/ui/ShortcutHint", () => ({ ShortcutHint: "test-shortcut" }));
vi.mock("@/components/AgentIcon", () => ({ AgentIcon: "test-agent-icon" }));
vi.mock("@/components/AgentActivityIcon", () => ({ AgentActivityIcon: "test-agent-activity" }));
vi.mock("@/components/AgentSessionStatus", () => ({ AgentSessionStatus: "test-agent-status" }));
vi.mock("@/components/ui/TabSelectionIndicator", () => ({ TabSelectionIndicator: "test-selection" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import TabBar from "./TabBar";

interface MenuItem { key?: string; disabled?: boolean }
interface DropdownProps {
  children?: ReactNode;
  open: boolean;
  trigger: string[];
  onOpenChange: (open: boolean) => void;
  menu: { items: MenuItem[]; onClick: (event: { key: string }) => void };
}
interface ModalProps {
  children?: ReactNode;
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

function render() {
  mocks.cursor = 0;
  const tree = TabBar({ paneId: "main", tabIds: mocks.state.panesById.main.tabIds, activeTabId: "agent" });
  const nodes = elements(tree);
  const menus = nodes.filter((node) => node.type === "test-dropdown" &&
    (node.props.trigger as string[]).includes("contextMenu")) as unknown as ReactElement<DropdownProps>[];
  const modal = nodes.find((node) => node.type === "test-modal") as unknown as ReactElement<ModalProps>;
  return { menus, modal };
}

function selectRestart() {
  render().menus[0].props.onOpenChange(true);
  expect(render().menus[0].props.open).toBe(true);
  render().menus[0].props.menu.onClick({ key: "restart" });
  return render();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.slots = [];
  mocks.cursor = 0;
  mocks.restart.mockResolvedValue(undefined);
  mocks.state = {
    sessions: [{ id: "agent", name: "Original name", path: "D:/project", createdAt: 1,
      agentId: "codex", active: true, status: "running" }],
    tabsById: { agent: { id: "agent", kind: "session", title: "Original name", resourceId: "agent" } },
    panesById: { main: { tabIds: ["agent"] } },
    currentProject: { path: "D:/project" }, dragState: null, defaultTerminalShell: "powershell",
    setActiveSession: vi.fn(), closeTab: vi.fn(), splitTab: vi.fn(), setDragState: vi.fn(), promoteTab: vi.fn(),
  };
});

it("offers restart first only on session menus", () => {
  for (const [id, kind] of [["file", "file"], ["diff", "diff"], ["__settings__", "settings"],
    ["scheduled", "scheduled-tasks"], ["market", "skill-market"]]) {
    mocks.state.tabsById[id] = { id, kind, title: id, resourceId: id };
    mocks.state.panesById.main.tabIds.push(id);
  }
  const { menus } = render();
  expect(menus).toHaveLength(6);
  expect(menus[0].props.menu.items[0].key).toBe("restart");
  for (const menu of menus.slice(1)) {
    expect(menu.props.menu.items.some((item) => item.key === "restart")).toBe(false);
  }
});

it("disables restart while starting and guards stale menu clicks", () => {
  mocks.state.sessions[0].status = "starting";
  expect(render().menus[0].props.menu.items[0]).toMatchObject({ key: "restart", disabled: true });
  const result = selectRestart();
  expect(result.modal.props.open).toBe(false);
  expect(mocks.restart).not.toHaveBeenCalled();
});

it("closes the dropdown before showing running-agent confirmation and respects cancel", () => {
  const { menus, modal } = selectRestart();
  expect(menus[0].props.open).toBe(false);
  expect(modal.props.open).toBe(true);
  expect(mocks.restart).not.toHaveBeenCalled();
  modal.props.onCancel();
  expect(render().modal.props.open).toBe(false);
  expect(mocks.restart).not.toHaveBeenCalled();
});

it("restarts the original running session after confirmation without moving its tab", () => {
  selectRestart().modal.props.onOk();
  expect(mocks.restart).toHaveBeenCalledExactlyOnceWith("agent", { restart: true });
  expect(render().modal.props.open).toBe(false);
  expect(mocks.state.sessions[0].name).toBe("Original name");
  expect(mocks.state.panesById.main.tabIds).toEqual(["agent"]);
  expect(mocks.state.closeTab).not.toHaveBeenCalled();
  expect(mocks.state.setActiveSession).not.toHaveBeenCalled();
});

it.each(["waiting", "completed"] as const)("restarts an idle %s agent directly", (status) => {
  mocks.state.sessions[0].status = status;
  const { menus, modal } = selectRestart();
  expect(menus[0].props.open).toBe(false);
  expect(modal.props.open).toBe(false);
  expect(mocks.restart).toHaveBeenCalledExactlyOnceWith("agent", { restart: true });
});

it("restarts an exited session directly", () => {
  mocks.state.sessions[0].active = false;
  mocks.state.sessions[0].status = "stopped";
  expect(selectRestart().modal.props.open).toBe(false);
  expect(mocks.restart).toHaveBeenCalledExactlyOnceWith("agent", { restart: true });
});

it.each(["cmd", "powershell"] as const)("confirms restarting a live %s terminal", (agentId) => {
  mocks.state.sessions[0].agentId = agentId;
  mocks.state.sessions[0].status = "waiting";
  const { modal } = selectRestart();
  expect(modal.props.open).toBe(true);
  expect(elements(modal.props.children)[0].props.children).toBe("tabBar.restartTerminalDescription");
  expect(mocks.restart).not.toHaveBeenCalled();
  modal.props.onOk();
  expect(mocks.restart).toHaveBeenCalledExactlyOnceWith("agent", { restart: true });
});

it.each(["project", "closed", "removed", "starting"] as const)(
  "does not execute a pending restart after its target becomes %s", (change) => {
    const { modal } = selectRestart();
    if (change === "project") mocks.state.currentProject = { path: "D:/other" };
    if (change === "closed") mocks.state.panesById.main.tabIds = [];
    if (change === "removed") mocks.state.sessions = [];
    if (change === "starting") mocks.state.sessions[0].status = "starting";
    // 使用确认框原有回调，验证执行前重新检查最新 store，而非依赖重渲染或 effect。
    modal.props.onOk();
    expect(mocks.restart).not.toHaveBeenCalled();
    expect(render().modal.props.open).toBe(false);
  },
);
