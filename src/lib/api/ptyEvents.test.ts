import { afterEach, expect, it, vi } from "vitest";
import { createPtyEventBridge } from "./ptyEvents";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function nativeMessages() {
  const listeners = new Set<(event: { data: unknown }) => void>();
  vi.stubGlobal("window", { chrome: { webview: {
    addEventListener: (_: string, listener: (event: { data: unknown }) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: { data: unknown }) => void) => listeners.delete(listener),
  } } });
  return { listeners, send: (data: unknown) => listeners.forEach((listener) => listener({ data })) };
}

it("delivers native output and exit in order without registering eval-backed events", async () => {
  const source = nativeMessages();
  const listenPtyEvent = createPtyEventBridge().listen;
  const received: unknown[] = [];
  const output = await listenPtyEvent("pty-output", ({ payload }) => received.push(payload));
  const exit = await listenPtyEvent("pty-exit", ({ payload }) => received.push(payload));
  const subscription_id = mocks.invoke.mock.calls.find(([command]) => command === "pty_output_subscribe")![1].subscriptionId;
  const payloads = Array.from({ length: 1000 }, (_, index) => ({
    subscription_id, delivery_id: index + 1, session_id: `session-${index % 2}`, data: `${index}:中文😀\u001b[31m\n\"\\`,
  }));
  for (const payload of payloads) source.send({ channel: "krosna-pty", event: "pty-output", payload });
  const ended = { session_id: "session-0", code: null };
  source.send({ channel: "krosna-pty", event: "pty-exit", payload: ended });
  expect(received).toEqual([...payloads, ended]);
  expect(mocks.listen).not.toHaveBeenCalled();
  output(); exit();
  expect(source.listeners.size).toBe(0);
  source.send({ channel: "krosna-pty", event: "pty-output", payload: payloads[0] });
  expect(received).toHaveLength(1001);
});

it("ignores unrelated and malformed WebView messages", async () => {
  const source = nativeMessages();
  const listenPtyEvent = createPtyEventBridge().listen;
  const handler = vi.fn();
  const stopOutput = await listenPtyEvent("pty-output", handler);
  const stopExit = await listenPtyEvent("pty-exit", handler);
  for (const data of [null, "text", {}, { channel: "other", event: "pty-output", payload: { session_id: "s", data: "x" } },
    { channel: "krosna-pty", event: "pty-output", payload: { session_id: "s", data: 1 } },
    { channel: "krosna-pty", event: "pty-exit", payload: { session_id: "s", code: "1" } },
    { channel: "krosna-pty", event: "pty-exit", payload: { code: 0 } }]) source.send(data);
  expect(handler).not.toHaveBeenCalled();
  stopOutput(); stopExit();
});

it("keeps a shared Tauri receiver on platforms without WebView2", async () => {
  vi.stubGlobal("window", {});
  const handler = vi.fn();
  const unlisten = vi.fn();
  mocks.listen.mockResolvedValue(unlisten);
  const bridge = createPtyEventBridge();
  const stop = await bridge.listen("pty-output", handler);
  expect(mocks.listen).toHaveBeenCalledTimes(2);
  expect(mocks.invoke).toHaveBeenCalledWith("pty_output_subscribe", expect.any(Object));
  stop();
  expect(unlisten).toHaveBeenCalledTimes(2);
});

it("acknowledges only after every matching view finishes parsing", async () => {
  const source = nativeMessages();
  const bridge = createPtyEventBridge();
  let finish!: () => void;
  const first = await bridge.listen("pty-output", () => new Promise<void>((resolve) => { finish = resolve; }));
  const second = await bridge.listen("pty-output", vi.fn());
  const subscription_id = mocks.invoke.mock.calls.find(([command]) => command === "pty_output_subscribe")![1].subscriptionId;
  const payload = { subscription_id, delivery_id: 7, session_id: "s", data: "中文" };
  source.send({ channel: "krosna-pty", event: "pty-output", payload });
  await Promise.resolve();
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "pty_output_ack")).toEqual([]);
  finish();
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("pty_output_ack", { subscriptionId: subscription_id, deliveryId: 7 }));
  first(); second();
  expect(source.listeners.size).toBe(0);
});

it("ignores retired subscriptions and releases the backend on last unsubscribe", async () => {
  const source = nativeMessages();
  const bridge = createPtyEventBridge();
  const handler = vi.fn();
  const stop = await bridge.listen("pty-output", handler);
  source.send({ channel: "krosna-pty", event: "pty-output", payload: {
    subscription_id: "retired", delivery_id: 1, session_id: "s", data: "old",
  } });
  expect(handler).not.toHaveBeenCalled();
  stop();
  expect(mocks.invoke).toHaveBeenCalledWith("pty_output_unsubscribe", expect.any(Object));
  expect(source.listeners.size).toBe(0);
});

it("cleans up partially registered fallback listeners exactly once", async () => {
  vi.stubGlobal("window", {});
  const unlisten = vi.fn();
  mocks.listen.mockResolvedValueOnce(unlisten).mockRejectedValueOnce(new Error("listener failed"));
  await expect(createPtyEventBridge().listen("pty-output", vi.fn())).rejects.toThrow("listener failed");
  expect(unlisten).toHaveBeenCalledOnce();
  expect(mocks.invoke.mock.calls.some(([command]) => command === "pty_output_subscribe")).toBe(false);
});

it("removes the native receiver when backend subscription fails", async () => {
  const source = nativeMessages();
  mocks.invoke.mockRejectedValueOnce(new Error("subscription failed"));
  await expect(createPtyEventBridge().listen("pty-output", vi.fn())).rejects.toThrow("subscription failed");
  expect(source.listeners.size).toBe(0);
});

it("a failed consumer cannot permanently consume transport credits", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const source = nativeMessages();
  const stop = await createPtyEventBridge().listen("pty-output", () => { throw new Error("view failed"); });
  try {
    const subscription_id = mocks.invoke.mock.calls.find(([command]) => command === "pty_output_subscribe")![1].subscriptionId;
    source.send({ channel: "krosna-pty", event: "pty-output", payload: { subscription_id, delivery_id: 1, session_id: "s", data: "x" } });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("pty_output_ack", { subscriptionId: subscription_id, deliveryId: 1 }));
  } finally { stop(); warning.mockRestore(); }
});
