import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface PtyEvents {
  "pty-output": { session_id: string; data: string; subscription_id?: string; delivery_id?: number };
  "pty-exit": { session_id: string; code: number | null };
}
type EventName = keyof PtyEvents;
interface WebMessageSource {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

// 每个窗口只有一个接收桥。所有本地视图解析完成后，才向 Rust 返还本条消息的额度。
export function createPtyEventBridge(onEmpty: () => void = () => {}) {
  const id = crypto.randomUUID();
  const handlers: Record<EventName, Set<(payload: PtyEvents[EventName]) => unknown>> = {
    "pty-output": new Set(), "pty-exit": new Set(),
  };
  let disposed = false;
  let ready: Promise<void> | undefined;
  let unlisten: UnlistenFn = () => {};

  const receive = (event: EventName, payload: unknown) => {
    if (disposed || !payload || typeof payload !== "object" || !("session_id" in payload)
      || typeof payload.session_id !== "string") return;
    if (event === "pty-output" ? !("data" in payload) || typeof payload.data !== "string"
      : !("code" in payload) || (payload.code !== null && typeof payload.code !== "number")) return;
    const output = payload as PtyEvents["pty-output"];
    if (event === "pty-output" && output.subscription_id !== id) return;
    const results = [...handlers[event]].map((handler) => {
      try { return Promise.resolve(handler(payload as PtyEvents[EventName])); }
      catch (error) { return Promise.reject(error); }
    });
    const deliveryId = output.delivery_id;
    void Promise.allSettled(results).then(async (settled) => {
      for (const result of settled) {
        if (result.status === "rejected") console.warn("PTY output consumer failed:", result.reason);
      }
      if (!disposed && event === "pty-output" && Number.isSafeInteger(deliveryId) && deliveryId! > 0) {
        await invoke("pty_output_ack", { subscriptionId: id, deliveryId });
      }
    }).catch((error: unknown) => console.warn("Failed to acknowledge PTY output:", error));
  };

  const initialize = async () => {
    const source = typeof window === "undefined" ? undefined
      : (window as Window & { chrome?: { webview?: WebMessageSource } }).chrome?.webview;
    if (source) {
      const listener = ({ data }: { data: unknown }) => {
        if (!data || typeof data !== "object" || !("channel" in data) || data.channel !== "krosna-pty"
          || !("event" in data) || !("payload" in data)) return;
        if (data.event === "pty-output" || data.event === "pty-exit") receive(data.event, data.payload);
      };
      source.addEventListener("message", listener);
      unlisten = () => source.removeEventListener("message", listener);
    } else {
      const listeners = await Promise.allSettled((Object.keys(handlers) as EventName[]).map((event) =>
        listen<PtyEvents[typeof event]>(event, ({ payload }) => receive(event, payload))));
      unlisten = () => listeners.forEach((result) => { if (result.status === "fulfilled") result.value(); });
      const failed = listeners.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    await invoke("pty_output_subscribe", { subscriptionId: id });
  };

  const close = () => {
    if (disposed) return;
    disposed = true;
    unlisten();
    handlers["pty-output"].clear();
    handlers["pty-exit"].clear();
    onEmpty();
    void invoke("pty_output_unsubscribe", { subscriptionId: id })
      .catch((error: unknown) => console.warn("Failed to unsubscribe PTY output:", error));
  };

  return {
    async listen<K extends EventName>(event: K, handler: (event: { payload: PtyEvents[K] }) => unknown): Promise<UnlistenFn> {
      if (disposed) throw new Error("PTY output bridge is closed");
      const wrapped = (payload: PtyEvents[EventName]) => handler({ payload: payload as PtyEvents[K] });
      handlers[event].add(wrapped);
      try { await (ready ??= initialize()); }
      catch (error) { close(); throw error; }
      return () => {
        handlers[event].delete(wrapped);
        if (!handlers["pty-output"].size && !handlers["pty-exit"].size) close();
      };
    },
  };
}

let bridge: ReturnType<typeof createPtyEventBridge> | undefined;
export function listenPtyEvent<K extends EventName>(
  event: K, handler: (event: { payload: PtyEvents[K] }) => unknown,
): Promise<UnlistenFn> {
  bridge ??= createPtyEventBridge(() => { bridge = undefined; });
  return bridge.listen(event, handler);
}
