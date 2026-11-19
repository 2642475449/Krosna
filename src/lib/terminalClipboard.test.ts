import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  createTerminalPasteGate,
  encodeClipboardImage,
  formatClipboardImageReference,
  formatTerminalVoicePaste,
  MAX_CLIPBOARD_IMAGE_BYTES,
  readTerminalClipboard,
  readTerminalPasteEvent,
} from "./terminalClipboard";

function clipboardItem(blobs: Record<string, Blob>): ClipboardItem {
  return {
    types: Object.keys(blobs),
    presentationStyle: "unspecified",
    getType: async (type) => blobs[type],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe("terminal clipboard", () => {
  it("原生桥仅将文字交给同源前台窗口中已注册的终端输入框", () => {
    const bridge = readFileSync(
      new URL("../../src-tauri/src/commands/dispatch_voice_input.js", import.meta.url), "utf8",
    );
    const origin = "http://tauri.localhost";
    const speech = "带引号的文字 \"你好\"\n第二行 🐱";
    class Textarea {}
    const paste = vi.fn();
    const terminal = Object.assign(new Textarea(), { krosnaPasteVoiceText: paste });
    const dispatch = (activeElement: object, focused = true, pageOrigin = origin, deadline = Date.now() + 3_000): unknown =>
      runInNewContext(bridge + "(" + [JSON.stringify(origin), JSON.stringify(speech), deadline].join(",") + ")", {
        document: { activeElement, hasFocus: () => focused }, location: { origin: pageOrigin },
        HTMLTextAreaElement: Textarea,
      });
    expect(dispatch(new Textarea())).toBe(false);
    expect(dispatch({ krosnaPasteVoiceText: paste })).toBe(false);
    expect(dispatch(terminal, false)).toBe(false);
    expect(dispatch(terminal, true, "https://external.example")).toBe(false);
    expect(dispatch(terminal, true, origin, Date.now() - 1)).toBeNull();
    expect(dispatch(terminal)).toBe(true);
    expect(paste.mock.calls).toEqual([[speech]]);
  });
  it("prefers the screenshot to text even when text is in an earlier item", async () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const clipboard = {
      read: vi.fn().mockResolvedValue([
        clipboardItem({ "text/plain": new Blob(["source URL"]) }),
        clipboardItem({ "image/png": blob }),
      ]),
      readText: vi.fn(),
    };
    expect(await readTerminalClipboard(clipboard)).toEqual({ kind: "image", blob });
    expect(clipboard.readText).not.toHaveBeenCalled();
  });

  it("falls back to text when rich clipboard reading is unavailable", async () => {
    const clipboard = { read: vi.fn().mockRejectedValue(new Error("permission")), readText: vi.fn().mockResolvedValue("hello") };
    expect(await readTerminalClipboard(clipboard)).toEqual({ kind: "text", text: "hello" });
    clipboard.readText.mockResolvedValue("");
    await expect(readTerminalClipboard(clipboard)).rejects.toThrow("terminal.clipboardReadFailed");
    clipboard.readText.mockRejectedValue(new Error("denied"));
    await expect(readTerminalClipboard(clipboard)).rejects.toThrow("denied");
  });

  it("does not silently downgrade a failed image read to text", async () => {
    const item = clipboardItem({ "image/png": new Blob() });
    item.getType = async () => { throw new Error("image unavailable"); };
    await expect(readTerminalClipboard({ read: async () => [item], readText: async () => "text" }))
      .rejects.toThrow("image unavailable");
  });

  it("reads plain text and recognizes an empty clipboard", async () => {
    expect(await readTerminalClipboard({ read: async () => [], readText: vi.fn() })).toEqual({ kind: "empty" });
    expect(await readTerminalClipboard({
      read: async () => [clipboardItem({ "text/plain": new Blob(["a\nb"]) })], readText: vi.fn(),
    })).toEqual({ kind: "text", text: "a\nb" });
  });

  it("captures native paste image data before reading attached text", () => {
    const blob = new Blob(["image"], { type: "image/png" });
    // node 测试使用最小 DataTransfer 替身，不依赖 DOM。
    const data = { items: [{ type: "image/png", getAsFile: () => blob }], getData: vi.fn() } as unknown as DataTransfer;
    expect(readTerminalPasteEvent(data)).toEqual({ kind: "image", blob });
    expect(data.getData).not.toHaveBeenCalled();
  });

  it("encodes binary payloads without corruption and rejects oversized images before IPC", async () => {
    expect(await encodeClipboardImage(new Blob([new Uint8Array([0, 255, 128])], { type: "image/png" }))).toBe("AP+A");
    await expect(encodeClipboardImage(new Blob([new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1)], { type: "image/png" })))
      .rejects.toThrow("terminal.clipboardImageTooLarge");
    await expect(encodeClipboardImage(new Blob(["svg"], { type: "image/svg+xml" })))
      .rejects.toThrow("terminal.clipboardImageUnsupported");
  });

  it("formats agent-specific references with separators and quoted Windows paths", () => {
    expect(formatClipboardImageReference("antigravity", "C:\\Users\\Test User\\image.png"))
      .toBe(' @"C:/Users/Test User/image.png" ');
    expect(formatClipboardImageReference("claude", "C:\\cache\\image.png")).toBe(" @C:/cache/image.png ");
    expect(formatClipboardImageReference("codex", "C:\\cache\\image.png")).toBe(" C:/cache/image.png ");
    expect(formatClipboardImageReference("qoder", "/tmp/image.png")).toBe(" /tmp/image.png ");
  });

  it("keeps slow screenshot saves before later typing, paste and Enter", async () => {
    const received: string[] = [];
    const first = deferred<string>();
    const second = deferred<string>();
    const gate = createTerminalPasteGate({
      input: (data) => received.push(data),
      paste: (text) => gate.input(`[paste:${text}]`),
      error: vi.fn(),
    });
    gate.input("before");
    const firstPaste = gate.paste(() => first.promise);
    gate.input("question");
    const secondPaste = gate.paste(() => second.promise);
    gate.input("\r");
    second.resolve("second");
    expect(received).toEqual(["before"]);
    first.resolve("first");
    await firstPaste;
    await secondPaste;
    await gate.paste(async () => "");
    expect(received).toEqual(["before", "[paste:first]", "question", "[paste:second]", "\r"]);
  });

  it("reports save errors and allows subsequent input and pastes", async () => {
    const input = vi.fn();
    const error = vi.fn();
    const gate = createTerminalPasteGate({ input, paste: input, error });
    const saving = deferred<string>();
    const paste = gate.paste(() => saving.promise);
    gate.input("after");
    saving.reject(new Error("disk full"));
    await paste;
    await gate.paste(async () => "next");
    expect(error).toHaveBeenCalledWith(new Error("disk full"));
    expect(input.mock.calls).toEqual([["after"], ["next"]]);
  });

  it("一次投递整段语音，仅在启用括号粘贴时保留换行", async () => {
    const speech = "多行\r\n中文\n以及\r🙂".repeat(120);
    const writes: string[] = [];
    const gate = createTerminalPasteGate({
      input: (data) => writes.push(data),
      paste: (text) => gate.input(text),
      error: vi.fn(),
    });
    await gate.pasteText(() => formatTerminalVoicePaste(speech, true));
    await gate.pasteText(() => formatTerminalVoicePaste(speech, false));
    expect(writes).toEqual([speech, "多行 中文 以及 🙂".repeat(120)]);
  });

  it("语音等候剪贴板时重新检查目标，失焦后不写入旧终端", async () => {
    const received = vi.fn();
    const gate = createTerminalPasteGate({ input: received, paste: received, error: vi.fn() });
    const clipboard = deferred<string>();
    const saving = gate.paste(() => clipboard.promise);
    let focused = true;
    const speech = gate.pasteText(() => {
      if (!focused) throw new Error("focus changed");
      return "voice";
    });
    gate.input("\r");
    focused = false;
    clipboard.resolve("image");
    await saving;
    await expect(speech).rejects.toThrow("focus changed");
    await gate.paste(async () => "");
    expect(received.mock.calls).toEqual([["image"], ["\r"]]);
  });

  it("终端卸载时通知排队的语音发送方，避免重放到其他会话", async () => {
    const received = vi.fn();
    const gate = createTerminalPasteGate({ input: received, paste: received, error: vi.fn() });
    const clipboard = deferred<string>();
    void gate.paste(() => clipboard.promise);
    const speech = gate.pasteText(() => "voice");
    gate.dispose();
    clipboard.resolve("image");
    await expect(speech).rejects.toThrow("terminal.clipboardSessionChanged");
    expect(received).not.toHaveBeenCalled();
  });

  it("never writes late clipboard results into a disposed terminal", async () => {
    const input = vi.fn();
    const saving = deferred<string>();
    const gate = createTerminalPasteGate({ input, paste: input, error: vi.fn() });
    const paste = gate.paste(() => saving.promise);
    gate.input("\r");
    gate.dispose();
    saving.resolve("image path");
    await paste;
    expect(input).not.toHaveBeenCalled();
  });
});
