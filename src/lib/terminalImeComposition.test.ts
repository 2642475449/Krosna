import { afterEach, describe, expect, it, vi } from "vitest";
import { installTerminalImeComposition, shouldInterceptImeKeyDown } from "./terminalImeComposition";

function createFakeEventTarget() {
  const listeners = new Map<string, Array<{ listener: EventListenerOrEventListenerObject; capture: boolean }>>();
  return {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
      const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
      const list = listeners.get(type) ?? [];
      list.push({ listener, capture });
      listeners.set(type, list);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
      const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
      const list = listeners.get(type);
      if (!list) return;
      listeners.set(type, list.filter((entry) => !(entry.listener === listener && entry.capture === capture)));
    },
    dispatch(type: string, event: Record<string, unknown>, capture = false) {
      const list = listeners.get(type) ?? [];
      for (const entry of [...list]) {
        if (entry.capture !== capture) continue;
        if (typeof entry.listener === "function") entry.listener(event as unknown as Event);
        else entry.listener.handleEvent(event as unknown as Event);
      }
    },
    listenerCount(type: string) {
      return listeners.get(type)?.length ?? 0;
    },
  };
}

function setup() {
  const host = createFakeEventTarget();
  const taTarget = createFakeEventTarget();
  const windowTarget = createFakeEventTarget();
  const documentTarget = { ...createFakeEventTarget(), visibilityState: "visible" };
  const dispatched: Event[] = [];
  const textarea = {
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    addEventListener: taTarget.addEventListener.bind(taTarget),
    removeEventListener: taTarget.removeEventListener.bind(taTarget),
    dispatchEvent(event: Event) {
      dispatched.push(event);
      taTarget.dispatch(event.type, event as unknown as Record<string, unknown>, false);
      return true;
    },
  };
  const onCompositionStart = vi.fn();
  const onCompositionEnd = vi.fn();
  const onFallbackCommit = vi.fn();
  const controller = installTerminalImeComposition({
    host,
    textarea,
    onCompositionStart,
    onCompositionEnd,
    onFallbackCommit,
    windowTarget,
    documentTarget,
    createCompositionEndEvent: () => ({ type: "compositionend", data: "" }) as unknown as Event,
  });
  return { host, taTarget, windowTarget, documentTarget, textarea, dispatched, onCompositionStart, onCompositionEnd, onFallbackCommit, controller };
}

afterEach(() => vi.useRealTimers());

describe("terminal IME composition coordinator", () => {
  it("intercepts Space and candidate keys while composing without blocking shortcut chords or normal Space", () => {
    const stopPropagation = vi.fn();
    expect(shouldInterceptImeKeyDown({ key: " ", code: "Space", keyCode: 32, stopPropagation }, true)).toBe(true);
    expect(shouldInterceptImeKeyDown({ key: "Process", code: "Space", keyCode: 229, stopPropagation }, true)).toBe(true);
    expect(shouldInterceptImeKeyDown({ key: "Enter", code: "Enter", keyCode: 13, stopPropagation }, true)).toBe(true);
    expect(shouldInterceptImeKeyDown({ key: " ", code: "Space", keyCode: 32, isComposing: true, stopPropagation }, false)).toBe(true);
    expect(shouldInterceptImeKeyDown({ key: " ", code: "Space", keyCode: 32, stopPropagation }, false)).toBe(false);
    expect(shouldInterceptImeKeyDown({ key: "c", code: "KeyC", keyCode: 67, ctrlKey: true, stopPropagation }, true)).toBe(false);
    expect(shouldInterceptImeKeyDown({ key: "Shift", code: "ShiftLeft", keyCode: 16, stopPropagation }, true)).toBe(false);
  });

  it("stops capture keydown during active composition so xterm keeps composition view open", () => {
    const { host, taTarget, controller } = setup();
    taTarget.dispatch("compositionstart", { data: "" });
    const stopSpace = vi.fn();
    host.dispatch("keydown", { key: " ", code: "Space", keyCode: 32, stopPropagation: stopSpace }, true);
    expect(stopSpace).toHaveBeenCalledTimes(1);

    taTarget.dispatch("compositionend", { data: "你" });
    const stopNormalSpace = vi.fn();
    host.dispatch("keydown", { key: " ", code: "Space", keyCode: 32, stopPropagation: stopNormalSpace }, true);
    expect(stopNormalSpace).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("recovers Space-confirmed Chinese text if xterm fails to emit it after compositionend and clears stale textarea value", () => {
    vi.useFakeTimers();
    const { taTarget, textarea, onFallbackCommit, onCompositionStart, onCompositionEnd, controller } = setup();
    taTarget.dispatch("compositionstart", { data: "" });
    expect(onCompositionStart).toHaveBeenCalledTimes(1);
    taTarget.dispatch("compositionupdate", { data: "ni" });
    textarea.value = "ni你";
    taTarget.dispatch("compositionend", { data: "你" });
    expect(onCompositionEnd).toHaveBeenCalledTimes(1);
    expect(onFallbackCommit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(onFallbackCommit).toHaveBeenCalledExactlyOnceWith("你");
    expect(textarea.value).toBe("");
    controller.dispose();
  });

  it("does not double-commit when xterm already emitted the composed characters", () => {
    vi.useFakeTimers();
    const { taTarget, textarea, onFallbackCommit, controller } = setup();
    taTarget.dispatch("compositionstart", { data: "" });
    taTarget.dispatch("compositionupdate", { data: "中文" });
    textarea.value = "中文";
    taTarget.dispatch("compositionend", { data: "中文" });
    controller.notifyXtermData("中文");

    vi.advanceTimersByTime(0);
    expect(onFallbackCommit).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");
    controller.dispose();
  });

  it("recovers TSF insertText after keyCode 229 when xterm input handler drops it", () => {
    vi.useFakeTimers();
    const { host, taTarget, textarea, onFallbackCommit, controller } = setup();
    host.dispatch("keydown", { key: "Process", code: "Space", keyCode: 229, isComposing: false, stopPropagation: vi.fn() }, true);
    textarea.value = "好";
    taTarget.dispatch("input", { inputType: "insertText", data: "好", isComposing: false });
    vi.advanceTimersByTime(0);
    expect(onFallbackCommit).toHaveBeenCalledExactlyOnceWith("好");
    expect(textarea.value).toBe("");

    // 普通按键场景下 xterm 同步发送后，不会再次触发兜底提交。
    host.dispatch("keydown", { key: "a", code: "KeyA", keyCode: 65, isComposing: false, stopPropagation: vi.fn() }, true);
    controller.notifyXtermData("a");
    textarea.value = "a";
    taTarget.dispatch("input", { inputType: "insertText", data: "a", isComposing: false });
    vi.advanceTimersByTime(0);
    expect(onFallbackCommit).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("clears stuck composition state and dispatches synthetic compositionend on blur", () => {
    const { taTarget, textarea, dispatched, onCompositionEnd, controller } = setup();
    taTarget.dispatch("compositionstart", { data: "" });
    textarea.value = "ni";
    taTarget.dispatch("blur", {});
    expect(controller.isComposing()).toBe(false);
    expect(textarea.value).toBe("");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe("compositionend");
    expect(onCompositionEnd).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("removes all listeners on dispose", () => {
    const { host, taTarget, windowTarget, documentTarget, controller } = setup();
    expect(host.listenerCount("keydown")).toBe(1);
    expect(taTarget.listenerCount("compositionstart")).toBe(1);
    expect(windowTarget.listenerCount("blur")).toBe(1);
    expect(documentTarget.listenerCount("visibilitychange")).toBe(1);
    controller.dispose();
    expect(host.listenerCount("keydown")).toBe(0);
    expect(taTarget.listenerCount("compositionstart")).toBe(0);
    expect(windowTarget.listenerCount("blur")).toBe(0);
    expect(documentTarget.listenerCount("visibilitychange")).toBe(0);
  });
});
