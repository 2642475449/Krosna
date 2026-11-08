import { describe, expect, it } from "vitest";
import { captureMouseShortcut, captureShortcutFromEvent, matchesShortcut, parseShortcut, toTauriShortcut } from "./shortcut";

const eventFor = (key: string, ctrlKey = false) => ({
  key, ctrlKey, altKey: false, metaKey: false, shiftKey: false,
});

describe("single-key voice shortcuts", () => {
  it.each([["F8", "F8"], ["a", "A"], [" ", "Space"], ["Enter", "Enter"]])(
    "captures and matches %s without modifiers",
    (key, expected) => {
      const event = eventFor(key);
      expect(captureShortcutFromEvent(event)).toBe(expected);
      expect(parseShortcut(expected)?.primaryKey).toBe(false);
      expect(toTauriShortcut(expected)).toBe(expected);
      expect(matchesShortcut(event as KeyboardEvent, expected)).toBe(true);
      expect(matchesShortcut(eventFor(key, true) as KeyboardEvent, expected)).toBe(false);
    },
  );

  it("preserves combination shortcuts and waits for a key after a modifier", () => {
    expect(captureShortcutFromEvent(eventFor("Control", true))).toBeNull();
    expect(captureShortcutFromEvent(eventFor("v", true))).toBe("Ctrl+V");
    expect(toTauriShortcut("Ctrl+V")).toBe("CommandOrControl+V");
  });
});


describe("mouse side button shortcuts", () => {
  const mouse = (button: number, extra = {}) => ({ button, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...extra }) as MouseEvent;
  it("captures both side buttons with exact modifiers and rejects ordinary buttons", () => {
    expect(captureMouseShortcut(mouse(3))).toBe("MouseBack");
    expect(captureMouseShortcut(mouse(4, { ctrlKey: true, altKey: true, shiftKey: true }))).toBe("Ctrl+Alt+Shift+MouseForward");
    for (const button of [0, 1, 2]) expect(captureMouseShortcut(mouse(button))).toBeNull();
    expect(matchesShortcut(mouse(3), "MouseBack")).toBe(true);
    expect(matchesShortcut(mouse(4), "MouseBack")).toBe(false);
    expect(matchesShortcut(mouse(3, { ctrlKey: true }), "MouseBack")).toBe(false);
    expect(matchesShortcut(mouse(4, { altKey: true }), "Alt+MouseForward")).toBe(true);
    expect(toTauriShortcut("Ctrl+MouseBack")).toBeNull();
  });
});
