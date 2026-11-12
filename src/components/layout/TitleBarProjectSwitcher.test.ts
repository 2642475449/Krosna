import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({ index: 0, open: vi.fn(), setPending: vi.fn(), cleanups: [] as (() => void)[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = mocks.index++;
    return [index === 7 ? "D:/target" : initial, index === 7 ? mocks.setPending : vi.fn()];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    if (deps[0] === "D:/target") { const cleanup = effect(); if (cleanup) mocks.cleanups.push(cleanup); }
  },
}));
vi.mock("antd", () => ({ Button: "button", Checkbox: "checkbox", Input: "input", Modal: "modal", Popover: "popover", message: {} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/useProjectLauncher", () => ({ useProjectLauncher: () => ({ currentProject: null, recentProjects: [], openProject: mocks.open }) }));
vi.mock("@/store", () => ({ useAppStore: (select: (state: unknown) => unknown) => select({ projectOpenBehavior: "ask", sessions: [], tabsById: {} }) }));
vi.mock("@/store/slices/openProjects", () => ({ useOpenProjectsStore: (select: (state: unknown) => unknown) => select({ windows: [] }) }));
vi.mock("@/store/slices/projectIcons", () => ({ useProjectIconsStore: vi.fn() }));
vi.mock("./ProjectIcon", () => ({ ProjectIcon: "icon" }));
vi.mock("./ProjectIconEditor", () => ({ ProjectIconEditor: "editor" }));
vi.mock("./CloneRepositoryModal", () => ({ default: "clone" }));
vi.mock("@/lib/api", () => ({ createProjectDirectory: vi.fn(), onProjectIconPreferenceUpdated: vi.fn() }));
vi.mock("@/lib/sessions", () => ({ isSessionTurnRunning: () => false }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
import TitleBarProjectSwitcher from "./TitleBarProjectSwitcher";

type Element = ReactElement<{ children?: Element[]; open?: boolean; footer?: Element; onClick?: () => void }>;
let buttons: Element[];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.index = 0;
  vi.stubGlobal("window", new EventTarget());
  const tree = TitleBarProjectSwitcher() as Element;
  const modal = tree.props.children!.find((child) => child.props.open === true)!;
  buttons = modal.props.footer!.props.children!;
});
afterEach(() => { mocks.cleanups.splice(0).forEach((cleanup) => cleanup()); vi.unstubAllGlobals(); });

it.each([0, 1, 2])("leaves Enter available to the focused footer button %s", (index) => {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key: "Enter" });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(mocks.open).not.toHaveBeenCalled();
  // 浏览器原生按钮激活随后只执行焦点按钮自己的 click handler。
  buttons[index].props.onClick!();
  if (index === 2) {
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.setPending).toHaveBeenCalledWith(null);
  } else {
    expect(mocks.open).toHaveBeenCalledWith("D:/target", index === 0 ? "current_window" : "new_window");
  }
});
