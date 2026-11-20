const MAX_INTERACTIVE_BATCH_CHARS = 1024;

export function isTerminalEditingInput(data: string): boolean {
  return data.length <= MAX_INTERACTIVE_BATCH_CHARS
    && /^(?:[^\x00-\x1f\x7f]+|[\x08\x7f]|\x1b(?:\[[A-DFH]|\[3~|O[A-DFH]))$/u.test(data);
}

/** 同一终端保持写入顺序，积压的短编辑输入共用一次写入确认。 */
export function createTerminalInputQueue() {
  type Write = (data: string) => Promise<void>;
  type Acknowledge = (written: boolean) => void;
  type Batch = { data: string; write: Write; acknowledgements: Acknowledge[]; result: Promise<void> };
  let tail: Promise<void> = Promise.resolve();
  let pending: Batch | undefined;

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    pending = undefined;
    const result = tail.then(operation);
    // 单次失败由调用方处理，不阻塞后续输入，也不留下未处理的队列拒绝。
    tail = result.catch(() => undefined);
    return result;
  };

  return Object.assign(enqueue, {
    write(data: string, write: Write, acknowledge: Acknowledge, onError: (error: unknown) => void) {
      if (pending?.write === write && pending.data.length + data.length <= MAX_INTERACTIVE_BATCH_CHARS) {
        pending.data += data;
        pending.acknowledgements.push(acknowledge);
        return pending.result;
      }

      const result = enqueue(async () => {
        if (pending === batch) pending = undefined;
        try {
          await batch.write(batch.data);
        } catch (error) {
          for (const done of batch.acknowledgements) done(false);
          throw error;
        }
        for (const done of batch.acknowledgements) done(true);
      });
      const batch: Batch = { data, write, acknowledgements: [acknowledge], result };
      pending = batch;
      void result.catch(onError);
      return result;
    },
  });
}
