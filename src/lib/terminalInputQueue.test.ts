import { describe, expect, it, vi } from "vitest";
import { createTerminalInputQueue, isTerminalEditingInput } from "./terminalInputQueue";

describe("createTerminalInputQueue", () => {
  it("waits for each character write before sending later characters or Enter", async () => {
    const enqueue = createTerminalInputQueue();
    const started: string[] = [];
    const written: string[] = [];
    let finishFirst: () => void = () => undefined;
    const firstWrite = new Promise<void>((resolve) => { finishFirst = resolve; });
    const pending = ["你", "好", "好", "。", "\r"].map((text, index) =>
      enqueue(async () => {
        started.push(text);
        if (index === 0) await firstWrite;
        written.push(text);
      }),
    );
    await Promise.resolve();
    expect(started).toEqual(["你"]);
    expect(written).toEqual([]);
    finishFirst();
    await Promise.all(pending);
    expect(written).toEqual(["你", "好", "好", "。", "\r"]);
  });

  it("reports a failed write and continues with subsequent input", async () => {
    const enqueue = createTerminalInputQueue();
    const failure = new Error("write failed");
    const failed = enqueue(() => { throw failure; });
    const written: string[] = [];
    const next = enqueue(async () => { written.push("后续文字"); });
    await expect(failed).rejects.toBe(failure);
    await next;
    expect(written).toEqual(["后续文字"]);
  });

  it("does not block another terminal while one terminal is waiting", async () => {
    const first = createTerminalInputQueue();
    const second = createTerminalInputQueue();
    let release: () => void = () => undefined;
    const blocked = first(() => new Promise<void>((resolve) => { release = resolve; }));
    let completed = false;
    await second(async () => { completed = true; });
    expect(completed).toBe(true);
    release();
    await blocked;
  });
});

it("groups only adjacent editing input and acknowledges it before paste or Enter", async () => {
  const enqueue = createTerminalInputQueue();
  const events: string[] = [];
  const reportError = vi.fn();
  let finishFirst = () => {};
  const write = async (data: string) => {
    events.push(data);
    if (data === "你") await new Promise<void>((resolve) => { finishFirst = resolve; });
  };
  const key = (data: string) => enqueue.write(data, write, (ok) => events.push(`${data}:${ok}`), reportError);

  const first = key("你");
  await Promise.resolve();
  expect(events).toEqual(["你"]);
  const rest = [key("好"), key("\x7f"), key("\x7f"), key("\x1b[D")];
  const paste = enqueue(async () => { events.push("paste"); });
  const last = key("。");
  const enter = enqueue(async () => { events.push("Enter"); });

  expect(events).toEqual(["你"]);
  finishFirst();
  await Promise.all([first, ...rest, paste, last, enter]);
  expect(events).toEqual([
    "你", "你:true", "好\x7f\x7f\x1b[D",
    "好:true", "\x7f:true", "\x7f:true", "\x1b[D:true",
    "paste", "。", "。:true", "Enter",
  ]);
  expect(reportError).not.toHaveBeenCalled();
});

it("bounds editing batches and reports a failed batch once without blocking later input", async () => {
  const enqueue = createTerminalInputQueue();
  const failure = new Error("write failed");
  const write = vi.fn<(data: string) => Promise<void>>().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  const reportError = vi.fn();
  const acknowledge = vi.fn();
  const half = "文".repeat(512);

  const failed = enqueue.write(half, write, acknowledge, reportError);
  const sameBatch = enqueue.write(half, write, acknowledge, reportError);
  const next = enqueue.write("后", write, acknowledge, reportError);
  expect(sameBatch).toBe(failed);
  await expect(failed).rejects.toBe(failure);
  await next;
  expect(write.mock.calls).toEqual([[half + half], ["后"]]);
  expect(acknowledge.mock.calls).toEqual([[false], [false], [true]]);
  expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
});

it("keeps submissions, interrupts, pasted frames and terminal reports out of editing batches", () => {
  for (const data of ["a", "中文", "😀", "\x08", "\x7f", "\x1b[D", "\x1bOA", "\x1b[3~"]) {
    expect(isTerminalEditingInput(data)).toBe(true);
  }
  for (const data of ["", "\r", "\n", "a\n", "\x03", "\x1b", "\x1b[200~text\x1b[201~", "\x1b[8;5R", "a".repeat(1025)]) {
    expect(isTerminalEditingInput(data)).toBe(false);
  }
});
