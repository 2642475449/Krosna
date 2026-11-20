export interface TerminalOutputSnapshot {
  pendingChars: number;
  bufferedChars: number;
  pendingWrites: number;
  peakPendingChars: number;
  oldestWriteMs: number;
  receivedChars: number;
  parsedChars: number;
  overloaded: boolean;
}

interface OutputMonitorOptions {
  bufferedChars?: () => number;
  onSnapshot: (snapshot: TerminalOutputSnapshot) => void;
  onPressureChange: (snapshot: TerminalOutputSnapshot) => void;
  now?: () => number;
  pendingCharLimit?: number;
  waitLimitMs?: number;
  intervalMs?: number;
}

/** 记录 xterm 真正解析完成前的积压；不丢弃或改写终端数据。 */
export function createTerminalOutputMonitor(options: OutputMonitorOptions) {
  const now = options.now ?? (() => performance.now());
  const pending = new Map<object, { chars: number; startedAt: number }>();
  let pendingChars = 0;
  let peakPendingChars = 0;
  let receivedChars = 0;
  let parsedChars = 0;
  let overloaded = false;
  let disposed = false;

  const snapshot = (): TerminalOutputSnapshot => {
    const bufferedChars = options.bufferedChars?.() ?? 0;
    peakPendingChars = Math.max(peakPendingChars, pendingChars + bufferedChars);
    const first = pending.values().next().value;
    const oldestWriteMs = first ? Math.max(0, now() - first.startedAt) : 0;
    return {
      pendingChars,
      bufferedChars,
      pendingWrites: pending.size,
      peakPendingChars,
      oldestWriteMs,
      receivedChars,
      parsedChars,
      overloaded: pendingChars + bufferedChars >= (options.pendingCharLimit ?? 1024 * 1024)
        || oldestWriteMs >= (options.waitLimitMs ?? 1000),
    };
  };

  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    const current = snapshot();
    options.onSnapshot(current);
    if (current.overloaded !== overloaded) {
      overloaded = current.overloaded;
      options.onPressureChange(current);
    }
    // 终端空闲且背压已解除后停止轮询，直到下次写入重新启动。
    if (pending.size === 0 && current.bufferedChars === 0 && !overloaded && intervalTimer !== null) {
      clearInterval(intervalTimer);
      intervalTimer = null;
    }
  };

  const ensureTimer = () => {
    if (disposed || intervalTimer !== null) return;
    intervalTimer = setInterval(tick, options.intervalMs ?? 1000);
  };

  return {
    write(data: string, writer: (data: string, onParsed: () => void) => void) {
      if (disposed || !data) return;
      ensureTimer();
      const token = {};
      pending.set(token, { chars: data.length, startedAt: now() });
      pendingChars += data.length;
      receivedChars += data.length;
      peakPendingChars = Math.max(peakPendingChars, pendingChars);
      const finish = (parsed: boolean) => {
        if (!pending.delete(token)) return;
        pendingChars -= data.length;
        if (parsed) parsedChars += data.length;
      };
      try {
        writer(data, () => finish(true));
      } catch (error) {
        finish(false);
        throw error;
      }
    },
    snapshot,
    dispose() {
      disposed = true;
      if (intervalTimer !== null) {
        clearInterval(intervalTimer);
        intervalTimer = null;
      }
      pending.clear();
      pendingChars = 0;
    },
  };
}
