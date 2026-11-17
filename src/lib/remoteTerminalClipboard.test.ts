import { describe, expect, it, vi } from "vitest";
import { attachRemoteTerminalClipboard, classifyRemoteTerminalKey, type RemoteClipboardTerminal } from "./remoteTerminalClipboard";

function keyEvent(patch: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    type: "keydown",
    key: "v",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...patch,
  } as unknown as KeyboardEvent;
}

describe("remote terminal clipboard", () => {
  it("intercepts Ctrl+V and Ctrl+Shift+V so raw Ctrl+V is never sent to SSH", () => {
    expect(classifyRemoteTerminalKey(keyEvent({ ctrlKey: true, key: "v" }), false)).toEqual({
      action: "paste",
      allowXterm: false,
    });
    expect(classifyRemoteTerminalKey(keyEvent({ ctrlKey: true, shiftKey: true, key: "V" }), false)).toEqual({
      action: "paste",
      allowXterm: false,
    });
    expect(classifyRemoteTerminalKey(keyEvent({ type: "keyup", ctrlKey: true, key: "v" }), false)).toEqual({
      action: "pass",
      allowXterm: false,
    });
    expect(classifyRemoteTerminalKey(keyEvent({ ctrlKey: true, altKey: true, key: "v" }), false)).toEqual({
      action: "pass",
      allowXterm: true,
    });
  });

  it("copies selection on Ctrl+C and passes SIGINT through when nothing is selected", () => {
    expect(classifyRemoteTerminalKey(keyEvent({ ctrlKey: true, key: "c" }), true)).toEqual({
      action: "copy",
      allowXterm: false,
    });
    expect(classifyRemoteTerminalKey(keyEvent({ ctrlKey: true, key: "c" }), false)).toEqual({
      action: "pass",
      allowXterm: true,
    });
  });

  it("pastes clipboard text on native paste event and respects disableStdin", () => {
    const listeners = new Map<string, EventListener>();
    const paste = vi.fn();
    let customHandler: ((event: KeyboardEvent) => boolean) | undefined;
    const term: RemoteClipboardTerminal = {
      hasSelection: () => false,
      getSelection: () => "",
      paste,
      options: { disableStdin: false },
      attachCustomKeyEventHandler: (handler) => {
        customHandler = handler;
      },
    };
    const container = {
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };

    const detach = attachRemoteTerminalClipboard(term, container);
    expect(customHandler).toBeDefined();

    const pasteHandler = listeners.get("paste");
    expect(pasteHandler).toBeDefined();
    pasteHandler?.({
      clipboardData: {
        items: [{ type: "text/plain", getAsFile: () => null }],
        getData: (type: string) => (type === "text/plain" ? "my-secret-password" : ""),
      },
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as ClipboardEvent);
    expect(paste).toHaveBeenCalledWith("my-secret-password");

    term.options.disableStdin = true;
    pasteHandler?.({
      clipboardData: {
        items: [{ type: "text/plain", getAsFile: () => null }],
        getData: () => "ignored",
      },
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as ClipboardEvent);
    expect(paste).toHaveBeenCalledTimes(1);

    detach();
    expect(listeners.size).toBe(0);
  });
});
