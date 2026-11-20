export interface TerminalImeKeyEventLike {
  key: string;
  code: string;
  keyCode: number;
  isComposing?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  getModifierState?: (keyArg: string) => boolean;
  stopPropagation: () => void;
}

export interface TerminalImeCompositionEventLike {
  data?: string | null;
}

export interface TerminalImeInputEventLike {
  data?: string | null;
  inputType?: string;
  isComposing?: boolean;
}

export interface TerminalImeTextareaLike {
  value: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void;
  dispatchEvent: (event: Event) => boolean;
}

export interface TerminalImeHostLike {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void;
}

export interface TerminalImeCompositionControllerOptions {
  host: TerminalImeHostLike;
  textarea: TerminalImeTextareaLike;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  onFallbackCommit: (text: string) => void;
  windowTarget?: {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  };
  documentTarget?: {
    visibilityState?: string;
    activeElement?: unknown;
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
  };
  scheduleTask?: (callback: () => void) => ReturnType<typeof setTimeout>;
  cancelTask?: (handle: ReturnType<typeof setTimeout>) => void;
  createCompositionEndEvent?: () => Event;
}

const MODIFIER_ONLY_KEY_CODES = new Set([16, 17, 18, 20, 91, 92, 93, 144]);
const MODIFIER_ONLY_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock"]);

function hasShortcutModifier(event: TerminalImeKeyEventLike): boolean {
  const altGraph = typeof event.getModifierState === "function" && event.getModifierState("AltGraph");
  return Boolean(event.ctrlKey || event.metaKey || (event.altKey && !altGraph));
}

function isModifierOnlyKey(event: TerminalImeKeyEventLike): boolean {
  return MODIFIER_ONLY_KEY_CODES.has(event.keyCode) || MODIFIER_ONLY_KEYS.has(event.key);
}

/**
 * 判定 keydown 是否应在捕获阶段拦截，避免 xterm `CompositionHelper.keydown`
 * 在用户输入 Space / 选词键 / Enter / Escape 时过早执行 `_finalizeComposition(false)`
 * 而关闭 `.composition-view` 并丢失输入法候选词。
 */
export function shouldInterceptImeKeyDown(event: TerminalImeKeyEventLike, composing: boolean): boolean {
  if (hasShortcutModifier(event) || isModifierOnlyKey(event)) return false;
  if (composing || event.isComposing) return true;
  return false;
}

function appendOrReplaceSuffix(existing: string, incoming: string): string {
  if (!incoming) return existing;
  return existing + incoming;
}

/**
 * 协调 Windows TSF / 讯飞等输入法与 xterm `CompositionHelper` 之间的事件顺序与清理：
 * 1. 组合期内拦截会触发 xterm 提前取消组合的非 229 按键（尤其是选词 `Space` keyCode=32）。
 * 2. 失焦时同步清理 xterm 内部卡死的组合态与 `.composition-view`。
 * 3. 在 `compositionend` 同一轮微后宏任务兜底检查 xterm 是否漏发或误吞提交文本，
 *    确认空闲后再清空累积在 `.xterm-helper-textarea` 中的旧文本，防止坐标越界与延迟。
 */
export function installTerminalImeComposition(options: TerminalImeCompositionControllerOptions) {
  const scheduleTask = options.scheduleTask ?? ((callback) => setTimeout(callback, 0));
  const cancelTask = options.cancelTask ?? ((handle) => clearTimeout(handle));
  const createCompositionEndEvent = options.createCompositionEndEvent
    ?? (() => new CompositionEvent("compositionend", { bubbles: false, data: "" }));

  let disposed = false;
  let composing = false;
  let suppressAbortEnd = false;
  let lastKeyDownWasProcess = false;
  let lastKeyDownEmitted = false;
  let compositionEmitted = "";
  let latestCompositionData = "";
  let postEndInputText = "";
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let nonComposingInputTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingNonComposingText = "";

  const clearSettleTimer = () => {
    if (settleTimer !== null) {
      cancelTask(settleTimer);
      settleTimer = null;
    }
  };

  const clearNonComposingTimer = () => {
    if (nonComposingInputTimer !== null) {
      cancelTask(nonComposingInputTimer);
      nonComposingInputTimer = null;
    }
  };

  const resetTextareaIfIdle = () => {
    if (disposed || composing) return;
    if (options.textarea.value.length > 0) {
      options.textarea.value = "";
    }
  };

  const notifyXtermData = (data: string) => {
    if (!data) return;
    lastKeyDownEmitted = true;
    pendingNonComposingText = "";
    if (composing || settleTimer !== null) {
      compositionEmitted = appendOrReplaceSuffix(compositionEmitted, data);
    }
  };

  const onCaptureKeyDown = (rawEvent: Event) => {
    const event = rawEvent as unknown as TerminalImeKeyEventLike;
    lastKeyDownEmitted = false;
    lastKeyDownWasProcess = event.keyCode === 229 || event.key === "Process";
    if (shouldInterceptImeKeyDown(event, composing)) {
      // 只阻止事件继续向下传播给 xterm 的捕获监听器，不调用 preventDefault() 以保留原生 TSF 选词。
      event.stopPropagation();
    }
  };

  const onCompositionStart = (rawEvent: Event) => {
    const event = rawEvent as unknown as TerminalImeCompositionEventLike;
    clearSettleTimer();
    clearNonComposingTimer();
    pendingNonComposingText = "";
    composing = true;
    suppressAbortEnd = false;
    compositionEmitted = "";
    postEndInputText = "";
    latestCompositionData = event.data ?? "";
    options.onCompositionStart?.();
  };

  const onCompositionUpdate = (rawEvent: Event) => {
    const event = rawEvent as unknown as TerminalImeCompositionEventLike;
    composing = true;
    if (typeof event.data === "string") {
      latestCompositionData = event.data;
    }
  };

  const onInput = (rawEvent: Event) => {
    const event = rawEvent as unknown as TerminalImeInputEventLike;
    const inputType = event.inputType ?? "";
    const data = typeof event.data === "string" ? event.data : "";

    // 如果浏览器已经发出非组合 insertText 且非 insertCompositionText，清理卡住的本地状态。
    if (!event.isComposing && inputType !== "insertCompositionText" && composing && settleTimer === null) {
      if (data) postEndInputText = appendOrReplaceSuffix(postEndInputText, data);
      return;
    }

    if (!composing && settleTimer !== null) {
      if ((inputType === "insertFromComposition" || inputType === "insertText") && data) {
        postEndInputText = appendOrReplaceSuffix(postEndInputText, data);
      }
      return;
    }

    // 某些 Windows TSF / 失焦恢复场景会跳过 compositionend，直接以 229 keydown + insertText 提交文本。
    if (!composing && settleTimer === null && data && (
      inputType === "insertFromComposition"
      || (inputType === "insertText" && lastKeyDownWasProcess)
    )) {
      pendingNonComposingText = appendOrReplaceSuffix(pendingNonComposingText, data);
      clearNonComposingTimer();
      nonComposingInputTimer = scheduleTask(() => {
        nonComposingInputTimer = null;
        if (disposed || composing) return;
        const text = pendingNonComposingText;
        pendingNonComposingText = "";
        if (text && !lastKeyDownEmitted) {
          options.onFallbackCommit(text);
        }
        resetTextareaIfIdle();
      });
    }
  };

  const onCompositionEnd = (rawEvent: Event) => {
    const event = rawEvent as unknown as TerminalImeCompositionEventLike;
    const aborted = suppressAbortEnd;
    suppressAbortEnd = false;
    composing = false;
    const eventData = typeof event.data === "string" ? event.data : "";
    const expectedText = eventData || postEndInputText;
    if (aborted) {
      clearSettleTimer();
      options.onCompositionEnd?.();
      resetTextareaIfIdle();
      return;
    }

    clearSettleTimer();
    // 在 xterm 之后入队下一轮宏任务校验，先完成兜底提交再恢复终端 PTY 输出。
    settleTimer = scheduleTask(() => {
      settleTimer = null;
      if (disposed || composing) return;
      const finalExpected = expectedText || postEndInputText;
      postEndInputText = "";
      latestCompositionData = "";
      if (finalExpected && !compositionEmitted) {
        options.onFallbackCommit(finalExpected);
      }
      compositionEmitted = "";
      resetTextareaIfIdle();
    });
    options.onCompositionEnd?.();
  };

  const resetOnBlur = () => {
    clearNonComposingTimer();
    pendingNonComposingText = "";
    lastKeyDownWasProcess = false;
    if (composing) {
      clearSettleTimer();
      suppressAbortEnd = true;
      composing = false;
      compositionEmitted = "";
      latestCompositionData = "";
      postEndInputText = "";
      options.textarea.value = "";
      // xterm 自身不监听 blur；主动派发一次空 compositionend 以收起残余 .composition-view。
      options.textarea.dispatchEvent(createCompositionEndEvent());
      return;
    }
    options.onCompositionEnd?.();
    resetTextareaIfIdle();
  };

  const onVisibilityChange = () => {
    if (options.documentTarget?.visibilityState === "hidden") {
      resetOnBlur();
    }
  };

  options.host.addEventListener("keydown", onCaptureKeyDown, true);
  options.textarea.addEventListener("compositionstart", onCompositionStart);
  options.textarea.addEventListener("compositionupdate", onCompositionUpdate);
  options.textarea.addEventListener("compositionend", onCompositionEnd);
  options.textarea.addEventListener("input", onInput);
  options.textarea.addEventListener("blur", resetOnBlur);
  options.windowTarget?.addEventListener("blur", resetOnBlur);
  options.documentTarget?.addEventListener("visibilitychange", onVisibilityChange);

  return {
    notifyXtermData,
    isComposing: () => composing,
    getLatestCompositionData: () => latestCompositionData,
    dispose() {
      if (disposed) return;
      disposed = true;
      composing = false;
      clearSettleTimer();
      clearNonComposingTimer();
      options.host.removeEventListener("keydown", onCaptureKeyDown, true);
      options.textarea.removeEventListener("compositionstart", onCompositionStart);
      options.textarea.removeEventListener("compositionupdate", onCompositionUpdate);
      options.textarea.removeEventListener("compositionend", onCompositionEnd);
      options.textarea.removeEventListener("input", onInput);
      options.textarea.removeEventListener("blur", resetOnBlur);
      options.windowTarget?.removeEventListener("blur", resetOnBlur);
      options.documentTarget?.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
