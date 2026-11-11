import { expect, it, vi } from "vitest";
import { handleRunnerLogShortcut } from "./runnerLogShortcuts";

function setup(key: string, modifiers: Partial<KeyboardEvent> = {}, selected = false) {
  const event = { key, type: "keydown", ctrlKey: false, metaKey: false, shiftKey: false,
    altKey: false, isComposing: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...modifiers };
  const terminal = { selectAll: vi.fn(), hasSelection: () => selected, clearSelection: vi.fn(),
    scrollToTop: vi.fn(), scrollToBottom: vi.fn(), scrollPages: vi.fn() };
  const actions = { copy: vi.fn(), paste: vi.fn(), clear: vi.fn(), find: vi.fn(), autoScroll: vi.fn() };
  return { event, terminal, actions, handle: () => handleRunnerLogShortcut(event, terminal, actions) };
}

it.each([{ ctrlKey: true }, { metaKey: true }])("selects all logs and consumes the browser/PTY key with %o", (modifier) => {
  const test = setup("a", modifier);
  expect(test.handle()).toBe(true);
  expect(test.terminal.selectAll).toHaveBeenCalledOnce();
  expect(test.event.preventDefault).toHaveBeenCalledOnce();
  expect(test.event.stopPropagation).toHaveBeenCalledOnce();
});

it("copies selected text but preserves Ctrl+C interrupt without a selection", () => {
  const selected = setup("c", { ctrlKey: true }, true);
  expect(selected.handle()).toBe(true);
  expect(selected.actions.copy).toHaveBeenCalledOnce();
  const empty = setup("c", { ctrlKey: true });
  expect(empty.handle()).toBe(false);
  expect(empty.event.preventDefault).not.toHaveBeenCalled();
});

it.each(["c", "v"])("supports explicit Ctrl+Shift+%s without sending a control character", (key) => {
  const test = setup(key, { ctrlKey: true, shiftKey: true });
  expect(test.handle()).toBe(true);
  expect(key === "c" ? test.actions.copy : test.actions.paste).toHaveBeenCalledOnce();
});

it.each(["l", "k"])("clears output with Ctrl+%s instead of editing the process input", (key) => {
  const test = setup(key, { ctrlKey: true });
  expect(test.handle()).toBe(true);
  expect(test.actions.clear).toHaveBeenCalledOnce();
});

it("scrolls to the first or latest log and updates follow mode", () => {
  const top = setup("Home", { ctrlKey: true });
  expect(top.handle()).toBe(true);
  expect(top.actions.autoScroll).toHaveBeenCalledWith(false);
  expect(top.terminal.scrollToTop).toHaveBeenCalledOnce();
  const bottom = setup("End", { ctrlKey: true });
  expect(bottom.handle()).toBe(true);
  expect(bottom.actions.autoScroll).toHaveBeenCalledWith(true);
  expect(bottom.terminal.scrollToBottom).toHaveBeenCalledOnce();
});

it.each([["PageUp", -1], ["PageDown", 1]] as const)("scrolls %s locally and pauses follow mode", (key, direction) => {
  const test = setup(key);
  expect(test.handle()).toBe(true);
  expect(test.actions.autoScroll).toHaveBeenCalledWith(false);
  expect(test.terminal.scrollPages).toHaveBeenCalledWith(direction);
});

it("clears selection on Escape and otherwise leaves Escape to the process", () => {
  const test = setup("Escape", {}, true);
  expect(test.handle()).toBe(true);
  expect(test.terminal.clearSelection).toHaveBeenCalledOnce();
  expect(setup("Escape").handle()).toBe(false);
});

it("consumes keyup without repeating an action", () => {
  const test = setup("a", { ctrlKey: true, type: "keyup" });
  expect(test.handle()).toBe(true);
  expect(test.terminal.selectAll).not.toHaveBeenCalled();
});

it("leaves composition, Alt shortcuts and ordinary typing to xterm", () => {
  expect(setup("a", { ctrlKey: true, isComposing: true }).handle()).toBe(false);
  expect(setup("a", { ctrlKey: true, altKey: true }).handle()).toBe(false);
  expect(setup("a").handle()).toBe(false);
});

it("opens local log search with Ctrl+F or Cmd+F", () => {
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    const test = setup("f", modifier);
    expect(test.handle()).toBe(true);
    expect(test.actions.find).toHaveBeenCalledOnce();
  }
  expect(setup("f", { ctrlKey: true, shiftKey: true }).handle()).toBe(false);
});
