import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppStore } from "@/store";
import { createTerminalActivityTracker } from "./terminalActivity";
import { createTerminalInputQueue } from "./terminalInputQueue";
import { getSessionTime } from "./sessionActivity";

const projectPath = "D:/terminal-activity";
function setup() {
  const store = createAppStore();
  store.getState().setCurrentProject({ path: projectPath, name: "Activity" });
  store.getState().addSession({ id: "agent", name: "Agent", path: projectPath, agentId: "codex", active: true, createdAt: 100 });
  const tracker = createTerminalActivityTracker(() => {
    store.getState().updateSession("agent", { lastActivityAt: Date.now(), hasPromptHistory: true });
  });
  return { store, tracker, queue: createTerminalInputQueue() };
}
afterEach(() => vi.useRealTimers());

describe("queued terminal writes and persisted conversation time", () => {
  it("waits for queued PTY writes before making a submission visible to the store", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { store, tracker, queue } = setup();
    let acknowledge!: () => void;
    const writeGate = new Promise<void>((resolve) => { acknowledge = resolve; });
    const text = queue(() => tracker.write("hello", () => writeGate));
    const enter = queue(() => tracker.write("\r", () => Promise.resolve()));
    await Promise.resolve();
    expect(store.getState().sessions[0].lastActivityAt).toBeUndefined();
    vi.setSystemTime(2000);
    acknowledge();
    await Promise.all([text, enter]);
    expect(getSessionTime(store.getState().sessions[0])).toEqual({ timestamp: 2000, kind: "activity" });
  });

  it("does not treat a queued application clear followed by an empty Enter as a message", async () => {
    const { store, tracker, queue } = setup();
    const writes = ["draft", "\x15", "\r"].map((data) =>
      queue(() => tracker.write(data, () => Promise.resolve())));
    await Promise.all(writes);
    expect(store.getState().sessions[0].lastActivityAt).toBeUndefined();
    expect(getSessionTime(store.getState().sessions[0])).toEqual({ timestamp: 100, kind: "created" });
  });

  it("keeps the queue usable after a rejection without counting the rejected submission", async () => {
    const { store, tracker, queue } = setup();
    await queue(() => tracker.write("hello", () => Promise.resolve()));
    await expect(queue(() => tracker.write("\r", () => Promise.reject(new Error("input rejected")))))
      .rejects.toThrow("input rejected");
    expect(store.getState().sessions[0].lastActivityAt).toBeUndefined();
    await queue(() => tracker.write("\r", () => Promise.resolve()));
    expect(store.getState().sessions[0].hasPromptHistory).toBe(true);
    expect(getSessionTime(store.getState().sessions[0]).kind).toBe("activity");
  });
});
