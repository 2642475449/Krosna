// 按 UTF-16 码元计数，暂停字符串的字符载荷最多约 512 KiB。
export const MAX_TERMINAL_IME_BUFFERED_CHARS = 256 * 1024;
export const MAX_TERMINAL_IME_HOLD_MS = 2_000;

/**
 * Keeps terminal output from moving xterm's cursor while an IME owns the
 * textarea. xterm submits the committed text on a zero-delay task after
 * `compositionend`, so output must remain paused for that task as well.
 */
export function createTerminalImeOutputGate(
  write: (data: string) => void,
  schedule: (callback: () => void) => number = (callback) => window.setTimeout(callback, 0),
  cancel: (handle: number) => void = (handle) => window.clearTimeout(handle),
) {
  let isComposing = false;
  let isSettlingComposition = false;
  let bypassComposition = false;
  let disposed = false;
  let pendingOutput = "";
  let flushHandle: number | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;

  const clearHoldTimer = () => {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  };
  const drain = () => {
    clearHoldTimer();
    if (!pendingOutput) return;
    const output = pendingOutput;
    pendingOutput = "";
    write(output);
  };
  const releasePressure = () => {
    if (disposed) return;
    // 超过暂停预算后只放行 PTY 输出，不提交、清空或重写输入法 textarea。
    // 当前组合输入余下阶段保持直通，避免重新排队造成持续内存增长。
    bypassComposition = true;
    drain();
  };

  const flush = () => {
    flushHandle = null;
    if (disposed || isComposing) return;
    isSettlingComposition = false;
    bypassComposition = false;
    drain();
  };

  return {
    getBufferedChars: () => pendingOutput.length,
    compositionStart() {
      if (disposed || isComposing) return;
      if (flushHandle !== null) {
        cancel(flushHandle);
        flushHandle = null;
      }
      isComposing = true;
      isSettlingComposition = false;
      bypassComposition = false;
    },
    compositionEnd() {
      if (disposed || (!isComposing && !isSettlingComposition && !pendingOutput)) return;
      isComposing = false;
      isSettlingComposition = true;
      bypassComposition = false;
      if (flushHandle === null) {
        // Registered after xterm's listener, this runs after xterm has sent
        // the finalized IME text to the PTY.
        flushHandle = schedule(flush);
      }
    },
    write(data: string) {
      if (disposed || !data) return;
      if ((isComposing || isSettlingComposition) && !bypassComposition) {
        if (pendingOutput.length + data.length >= MAX_TERMINAL_IME_BUFFERED_CHARS) {
          releasePressure();
          write(data);
          return;
        }
        pendingOutput += data;
        holdTimer ??= setTimeout(releasePressure, MAX_TERMINAL_IME_HOLD_MS);
        return;
      }
      write(data);
    },
    dispose() {
      disposed = true;
      clearHoldTimer();
      if (flushHandle !== null) {
        cancel(flushHandle);
        flushHandle = null;
      }
      pendingOutput = "";
    },
  };
}
