// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalHistoryView } from "./TerminalHistoryView";

const fixture = vi.hoisted(() => ({
  snapshot: { cols: 100, rows: 10 },
  fontSize: 14,
  fit: vi.fn(),
  hasSelection: vi.fn(),
  restore: vi.fn<() => Promise<void>>(),
  registerKeys: vi.fn<(handler: (event: KeyboardEvent) => boolean) => void>(),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {};
    hasSelection = fixture.hasSelection;
    attachCustomKeyEventHandler = fixture.registerKeys;
    open(target: HTMLElement) { target.append(document.createElement("textarea")); }
    loadAddon() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = fixture.fit; } }));
vi.mock("@/lib/terminalTextLayout", () => ({ initializePtyTextLayout: vi.fn() }));
vi.mock("@/lib/terminalScrollbar", () => ({ attachTerminalScrollbar: () => () => {} }));
vi.mock("@/lib/memoryDiagnostics", () => ({ registerMemoryDiagnosticTerminal: () => () => {} }));
vi.mock("@/lib/runnerOutputSnapshot", () => ({ restoreRunnerOutputSnapshot: fixture.restore }));
vi.mock("@/store", () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ terminalFontSize: fixture.fontSize, activeTheme: () => "dark-starry" }),
}));
vi.mock("@/store/slices/terminalRecovery", () => ({
  terminalRecoveryKey: () => "session", retainTerminalRecovery: () => () => {},
  loadTerminalRecovery: async () => {}, useTerminalRecoveryStore: (select: (state: unknown) => unknown) =>
    select({ entries: { session: { snapshot: fixture.snapshot } } }),
}));
vi.mock("react-i18next", async (original) => ({
  ...await original<typeof import("react-i18next")>(), useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root;
const onResume = vi.fn();
const render = () => act(async () => root.render(createElement(TerminalHistoryView, {
  session: { id: "id", path: "/repo", name: "History", createdAt: 0, active: false, agentId: "powershell" },
  onResume,
})));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.fontSize = 14;
  fixture.restore.mockResolvedValue(undefined);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("holds the snapshot grid until all replay writes have finished, including font changes", async () => {
  let finish!: () => void;
  fixture.restore.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([new DOMRect()] as unknown as DOMRectList);
  await render();
  fixture.fontSize = 16;
  await render();
  expect(fixture.restore).toHaveBeenCalledTimes(1);
  expect(fixture.fit).not.toHaveBeenCalled();

  await act(async () => finish());
  expect(fixture.fit).toHaveBeenCalledTimes(1);
  fixture.fontSize = 18;
  await render();
  expect(fixture.fit).toHaveBeenCalledTimes(2);
});

it("keeps focus on the history and passes the selected text copy shortcut to the browser", async () => {
  fixture.hasSelection.mockReturnValue(true);
  await render();
  const textarea = document.querySelector("textarea")!;
  textarea.focus();
  await act(async () => textarea.click());
  expect(document.activeElement).toBe(textarea);
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  expect(textarea.dispatchEvent(enter)).toBe(true);
  expect(onResume).not.toHaveBeenCalled();

  const handleKey = fixture.registerKeys.mock.calls[0][0];
  const copy = new KeyboardEvent("keydown", { key: "c", ctrlKey: true });
  expect(handleKey(copy)).toBe(false);
  fixture.hasSelection.mockReturnValue(false);
  expect(handleKey(copy)).toBe(true);
  await act(async () => textarea.click());
  expect(document.activeElement).toBe(textarea);
});
