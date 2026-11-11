import { expect, it, vi } from "vitest";
import { createRunnerLogSearch } from "./runnerLogSearch";
import { EMPTY_RUNNER_LOG_SEARCH } from "@/store/slices/bottomRunner";

function setup() {
  let notify: (result: { resultIndex: number; resultCount: number }) => void = () => {};
  const terminal = { clearSelection: vi.fn(), focus: vi.fn() };
  const dispose = vi.fn();
  const addon = { findNext: vi.fn(() => true), findPrevious: vi.fn(() => true), clearDecorations: vi.fn(),
    onDidChangeResults: (callback: typeof notify) => { notify = callback; return { dispose }; } };
  const options = { pauseFollow: vi.fn(), isVisible: () => true, onResults: vi.fn(),
    decorations: () => ({ matchBorder: "#4263eb", matchOverviewRuler: "#4263eb", activeMatchColorOverviewRuler: "#20242c" }) };
  const search = createRunnerLogSearch(terminal, addon, options);
  return { terminal, addon, options, search, dispose, notify: (index: number, count: number) => notify({ resultIndex: index, resultCount: count }) };
}

it("searches incrementally, pauses follow mode and navigates only explicit requests", () => {
  const test = setup();
  const state = { ...EMPTY_RUNNER_LOG_SEARCH, open: true, query: "错误" };
  test.search.update(state);
  expect(test.options.pauseFollow).toHaveBeenCalledOnce();
  expect(test.addon.findNext).toHaveBeenCalledWith("错误", expect.objectContaining({ incremental: true }));
  test.notify(0, 3);
  expect(test.options.onResults).toHaveBeenCalledWith(0, 3);
  test.search.update({ ...state, resultIndex: 0, resultCount: 3 });
  expect(test.addon.findNext).toHaveBeenCalledOnce();
  test.search.update({ ...state, request: 1, direction: "previous" });
  expect(test.addon.findPrevious).toHaveBeenCalledWith("错误", expect.objectContaining({ incremental: false }));
  test.search.dispose();
});

it("clears all decorations and restores terminal focus on Escape/close", () => {
  const test = setup();
  test.search.update({ ...EMPTY_RUNNER_LOG_SEARCH, open: true, query: "needle" });
  test.search.update({ ...EMPTY_RUNNER_LOG_SEARCH, query: "needle" });
  expect(test.addon.clearDecorations).toHaveBeenCalled();
  expect(test.addon.findNext).toHaveBeenLastCalledWith("");
  expect(test.terminal.clearSelection).toHaveBeenCalledOnce();
  expect(test.terminal.focus).toHaveBeenCalledOnce();
  test.notify(2, 5);
  expect(test.options.onResults).toHaveBeenLastCalledWith(-1, 0);
  test.search.dispose();
  expect(test.dispose).toHaveBeenCalledOnce();
});

it("never steals focus from another tab or window when the search closes", () => {
  const test = setup();
  test.options.isVisible = () => false;
  test.search.update({ ...EMPTY_RUNNER_LOG_SEARCH, open: true, query: "needle" });
  test.search.update(EMPTY_RUNNER_LOG_SEARCH);
  expect(test.terminal.focus).not.toHaveBeenCalled();
  test.search.dispose();
});

it("clears an empty search without pausing live output", () => {
  const test = setup();
  test.search.update({ ...EMPTY_RUNNER_LOG_SEARCH, open: true });
  expect(test.options.pauseFollow).not.toHaveBeenCalled();
  expect(test.options.onResults).toHaveBeenCalledWith(-1, 0);
  test.search.dispose();
});
