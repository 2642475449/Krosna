/** 帧保护和 IME 都排空后插入解析屏障；额度只在屏障前的输出全部解析后释放。 */
export function createTerminalOutputAcknowledgements(options: {
  buffered: () => boolean;
  afterParsed: (done: () => void) => void;
}) {
  const pending = new Set<() => void>();
  const parsing = new Set<Set<() => void>>();
  let scheduled = false;
  let disposed = false;
  const settle = (batch: Set<() => void>) => {
    for (const done of batch) done();
    batch.clear();
    parsing.delete(batch);
  };
  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed || options.buffered() || !pending.size) return;
      const batch = new Set(pending);
      pending.clear();
      parsing.add(batch);
      try { options.afterParsed(() => settle(batch)); }
      catch (error) { settle(batch); console.warn("Terminal output barrier failed:", error); }
    });
  };
  return {
    track(write: () => void): Promise<void> {
      if (disposed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        pending.add(resolve);
        try { write(); schedule(); }
        catch (error) { pending.delete(resolve); reject(error); }
      });
    },
    schedule,
    dispose() {
      disposed = true;
      settle(pending);
      for (const batch of parsing) settle(batch);
    },
  };
}
