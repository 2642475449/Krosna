import { afterEach, beforeEach, expect, it, vi } from "vitest";

interface HookCell {
  value?: unknown;
  deps?: unknown[];
  cleanup?: () => void;
  set?: (value: unknown) => void;
}

// node 环境保留跨渲染的 Hook 状态和 effect 清理顺序，不依赖 DOM。
const runtime = vi.hoisted(() => ({
  cells: [] as HookCell[],
  cursor: 0,
  effects: [] as { cell: HookCell; effect: () => void | (() => void); deps: unknown[] }[],
}));
vi.mock("react", () => {
  const nextCell = () => runtime.cells[runtime.cursor++] ??= {};
  const same = (left: unknown[] | undefined, right: unknown[]) =>
    left?.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  return {
    useRef: <T>(initial: T) => {
      const cell = nextCell();
      cell.value ??= { current: initial };
      return cell.value as { current: T };
    },
    useState: <T>(initial: T) => {
      const cell = nextCell();
      if (!("value" in cell)) cell.value = initial;
      cell.set ??= (value) => { cell.value = value; };
      return [cell.value as T, cell.set];
    },
    useCallback: <T>(callback: T, deps: unknown[]) => {
      const cell = nextCell();
      if (!same(cell.deps, deps)) { cell.value = callback; cell.deps = deps; }
      return cell.value as T;
    },
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const cell = nextCell();
      if (!same(cell.deps, deps)) runtime.effects.push({ cell, effect, deps });
    },
  };
});
import { useGitRefreshController } from "./useGitRefreshController";

function render(refresh: () => Promise<void>, config = {}) {
  runtime.cursor = 0;
  runtime.effects = [];
  const controller = useGitRefreshController(refresh, config);
  for (const { cell } of runtime.effects) cell.cleanup?.();
  for (const { cell, effect, deps } of runtime.effects) {
    cell.cleanup = effect() || undefined;
    cell.deps = deps;
  }
  return controller;
}

function unmount() {
  for (const cell of runtime.cells) { cell.cleanup?.(); cell.cleanup = undefined; }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  runtime.cells = [];
  runtime.cursor = 0;
  runtime.effects = [];
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("refreshes the new project immediately when switching during the old cooldown", async () => {
  const refreshA = vi.fn(async () => undefined);
  const refreshB = vi.fn(async () => undefined);
  render(refreshA);
  await vi.advanceTimersByTimeAsync(100);
  const controller = render(refreshB);
  await vi.advanceTimersByTimeAsync(0);
  expect(refreshB).toHaveBeenCalledOnce();
  controller.refreshNow();
  await vi.advanceTimersByTimeAsync(5000);
  expect(refreshB).toHaveBeenCalledTimes(2);
});

it("coalesces manual, focus and polling refreshes while a request is still running", async () => {
  const first = deferred();
  const refresh = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
  const controller = render(refresh);
  controller.refreshNow();
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(30000);
  expect(refresh).toHaveBeenCalledOnce();
  first.resolve();
  await vi.advanceTimersByTimeAsync(4999);
  expect(refresh).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("ignores the old project's completion without clearing the new in-flight guard", async () => {
  const first = deferred();
  const second = deferred();
  render(() => first.promise);
  const refreshB = vi.fn(() => second.promise);
  const controller = render(refreshB);
  first.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1); // 只有新项目的轮询，没有旧请求的冷却计时器。
  controller.refreshNow();
  await vi.advanceTimersByTimeAsync(0);
  expect(refreshB).toHaveBeenCalledOnce();
  second.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(2);
});

it("does not create a cooldown timer after an unmounted request completes", async () => {
  const pending = deferred();
  render(() => pending.promise);
  unmount();
  pending.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("ignores refresh callbacks retained by the old project", async () => {
  const refreshA = vi.fn(async () => undefined);
  const refreshB = vi.fn(async () => undefined);
  const oldController = render(refreshA);
  await vi.advanceTimersByTimeAsync(0);
  render(refreshB);
  await vi.advanceTimersByTimeAsync(0);
  oldController.refreshNow();
  oldController.requestRefresh();
  await vi.advanceTimersByTimeAsync(6000);
  expect(refreshA).toHaveBeenCalledOnce();
  expect(refreshB).toHaveBeenCalledOnce();
});

it("waits until every active Git operation finishes before refreshing", async () => {
  const refresh = vi.fn(async () => undefined);
  const controller = render(refresh, { debounceDelay: 10, cooldownDelay: 100 });
  await vi.advanceTimersByTimeAsync(0);
  const first = controller.markOperationStart();
  const second = controller.markOperationStart();
  controller.refreshNow();
  await vi.advanceTimersByTimeAsync(200);
  expect(refresh).toHaveBeenCalledOnce();
  controller.markOperationEnd(first);
  await vi.advanceTimersByTimeAsync(100);
  expect(refresh).toHaveBeenCalledOnce();
  controller.markOperationEnd(second);
  await vi.advanceTimersByTimeAsync(10);
  expect(refresh).toHaveBeenCalledTimes(2);
});
