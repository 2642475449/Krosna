import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ShortcutOverrides } from "@/constants/shortcuts";

const mocks = vi.hoisted(() => ({
  cleanups: [] as (() => void)[],
  app: { openTabs: ["a", "b"], activeSessionId: "a", openTab: vi.fn() },
  shortcuts: { overrides: {} as ShortcutOverrides, recordingAction: null as string | null },
}));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => { mocks.cleanups.push(effect()); },
}));
vi.mock("@/store", () => ({ useAppStore: (select: (state: typeof mocks.app) => unknown) => select(mocks.app) }));
vi.mock("@/store/slices/shortcutSlice", () => ({
  useShortcutStore: Object.assign((select: (state: typeof mocks.shortcuts) => unknown) => select(mocks.shortcuts), {
    getState: () => mocks.shortcuts,
  }),
}));
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

function press(key: string, modifiers = {}) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: false, ...modifiers });
  document.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", class {});
  mocks.shortcuts.overrides = {};
  mocks.shortcuts.recordingAction = null;
});
afterEach(() => {
  mocks.cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

it("uses a replacement binding, disables the old key, and ignores key repeat", () => {
  mocks.shortcuts.overrides = { newSession: "Ctrl+Alt+N" };
  const onNewSession = vi.fn();
  useKeyboardShortcuts({ onNewSession });
  expect(press("n").defaultPrevented).toBe(false);
  expect(press("n", { altKey: true }).defaultPrevented).toBe(true);
  press("n", { altKey: true, repeat: true });
  expect(onNewSession).toHaveBeenCalledTimes(1);
});

it("does not dispatch disabled bindings or execute actions during recording and composition", () => {
  mocks.shortcuts.overrides = { closeTab: "" };
  const onRequestCloseTab = vi.fn();
  const onNewSession = vi.fn();
  useKeyboardShortcuts({ onRequestCloseTab, onNewSession });
  press("w");
  press("n", { isComposing: true });
  mocks.shortcuts.recordingAction = "newSession";
  press("n");
  expect(onRequestCloseTab).not.toHaveBeenCalled();
  expect(onNewSession).not.toHaveBeenCalled();
});

it("keeps tab navigation and settings actions working with custom function keys", () => {
  mocks.shortcuts.overrides = { nextTab: "F6", openSettings: "F7" };
  useKeyboardShortcuts({});
  press("F6", { ctrlKey: false });
  expect(mocks.app.openTab).toHaveBeenLastCalledWith("b");
  press("F7", { ctrlKey: false });
  expect(mocks.app.openTab).toHaveBeenLastCalledWith("__settings__");
});

it("toggles the bottom runner using the default binding without repeating", () => {
  const onToggleBottomRunner = vi.fn();
  useKeyboardShortcuts({ onToggleBottomRunner });
  expect(press("j").defaultPrevented).toBe(true);
  press("j", { repeat: true });
  expect(onToggleBottomRunner).toHaveBeenCalledTimes(1);
});
it("uses a customized bottom runner binding", () => {
  mocks.shortcuts.overrides = { toggleBottomRunner: "Alt+F12" };
  const onToggleBottomRunner = vi.fn();
  useKeyboardShortcuts({ onToggleBottomRunner });
  press("j");
  press("F12", { ctrlKey: false, altKey: true });
  expect(onToggleBottomRunner).toHaveBeenCalledTimes(1);
});


function mouse(type: string, button: number, modifiers = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { button, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers });
  document.dispatchEvent(event);
  return event;
}

it("dispatches side button actions with exact modifiers and blocks browser navigation", () => {
  mocks.shortcuts.overrides = { newSession: "Ctrl+MouseBack", nextTab: "MouseForward" };
  const onNewSession = vi.fn();
  useKeyboardShortcuts({ onNewSession });
  expect(mouse("mousedown", 3).defaultPrevented).toBe(false);
  expect(mouse("mousedown", 3, { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(onNewSession).toHaveBeenCalledTimes(1);
  mouse("mousedown", 4);
  expect(mocks.app.openTab).toHaveBeenCalledWith("b");
  expect(mouse("mouseup", 4).defaultPrevented).toBe(true);
  expect(mouse("auxclick", 4).defaultPrevented).toBe(true);
  mocks.shortcuts.recordingAction = "newSession";
  mouse("mousedown", 3, { ctrlKey: true });
  expect(onNewSession).toHaveBeenCalledTimes(1);
});

it("holds mouse voice input until the matching button or modifier is released", () => {
  const onVoiceShortcutPress = vi.fn();
  const onVoiceShortcutRelease = vi.fn();
  useKeyboardShortcuts({ voiceShortcut: "Ctrl+MouseBack", onVoiceShortcutPress, onVoiceShortcutRelease });
  mouse("mousedown", 3, { ctrlKey: true });
  mouse("mouseup", 4);
  expect(onVoiceShortcutPress).toHaveBeenCalledTimes(1);
  expect(onVoiceShortcutRelease).not.toHaveBeenCalled();
  mouse("mouseup", 3);
  expect(onVoiceShortcutRelease).toHaveBeenCalledTimes(1);
  mouse("mousedown", 3, { ctrlKey: true });
  const up = new Event("keyup", { cancelable: true });
  Object.assign(up, { key: "Control" });
  document.dispatchEvent(up);
  expect(onVoiceShortcutRelease).toHaveBeenCalledTimes(2);
  mouse("mousedown", 3, { ctrlKey: true });
  window.dispatchEvent(new Event("blur"));
  expect(onVoiceShortcutRelease).toHaveBeenCalledTimes(3);
});

it.each(["input", "textarea", "select", "monaco", "contenteditable"])(
  "starts mouse voice input over %s without filtering it as keyboard text input",
  (area) => {
    class EditableTarget {
      tagName = ["monaco", "contenteditable"].includes(area) ? "DIV" : area.toUpperCase();
      isContentEditable = area === "contenteditable";
      closest(selector: string) { return area === "monaco" && selector === ".monaco-editor" ? this : null; }
    }
    vi.stubGlobal("HTMLElement", EditableTarget);
    const onVoiceShortcutPress = vi.fn();
    const onVoiceShortcutRelease = vi.fn();
    useKeyboardShortcuts({ voiceShortcut: "MouseBack", onVoiceShortcutPress, onVoiceShortcutRelease });
    const down = new Event("mousedown", { cancelable: true });
    Object.assign(down, { button: 3, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
    Object.defineProperty(down, "target", { value: new EditableTarget() });
    document.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(onVoiceShortcutPress).toHaveBeenCalledTimes(1);
    mouse("mouseup", 3);
    expect(onVoiceShortcutRelease).toHaveBeenCalledTimes(1);
  },
);
