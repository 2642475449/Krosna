// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  app: { openTabs: ["a"], activeSessionId: "a", openTab: vi.fn() },
  shortcuts: { overrides: {}, recordingAction: null },
}));
vi.mock("@/store", () => ({ useAppStore: (select: (value: typeof state.app) => unknown) => select(state.app) }));
vi.mock("@/store/slices/shortcutSlice", () => ({
  useShortcutStore: Object.assign((select: (value: typeof state.shortcuts) => unknown) => select(state.shortcuts), {
    getState: () => state.shortcuts,
  }),
}));
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

it("keeps mouse voice input held across React renders and releases on button-up and unmount", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onVoiceShortcutPress = vi.fn();
  const onVoiceShortcutRelease = vi.fn();
  function Harness() {
    useKeyboardShortcuts({ voiceShortcut: "MouseBack", onVoiceShortcutPress, onVoiceShortcutRelease });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Harness)));
    document.dispatchEvent(new MouseEvent("mousedown", { button: 3 }));
    expect(onVoiceShortcutPress).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(Harness)));
    expect(onVoiceShortcutRelease).not.toHaveBeenCalled();
    document.dispatchEvent(new MouseEvent("mouseup", { button: 3 }));
    expect(onVoiceShortcutRelease).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new MouseEvent("mousedown", { button: 3 }));
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
  expect(onVoiceShortcutRelease).toHaveBeenCalledTimes(2);
});
