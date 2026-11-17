import { readTerminalClipboard, readTerminalPasteEvent } from "./terminalClipboard";

export interface RemoteClipboardTerminal {
  hasSelection: () => boolean;
  getSelection: () => string;
  paste: (text: string) => void;
  options: { disableStdin?: boolean };
  attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => void;
}

export type RemoteClipboardAction = "copy" | "paste" | "pass";

/** 判断键盘事件在远端终端中应触发复制、粘贴还是透传给 xterm。 */
export function classifyRemoteTerminalKey(
  event: Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  hasSelection: boolean,
): { action: RemoteClipboardAction; allowXterm: boolean } {
  const hasPrimary = (event.ctrlKey || event.metaKey) && !event.altKey;
  const lowerKey = event.key.toLowerCase();

  if (hasPrimary && !event.shiftKey && lowerKey === "c") {
    if (!hasSelection) {
      return { action: "pass", allowXterm: true };
    }
    return {
      action: event.type === "keydown" ? "copy" : "pass",
      allowXterm: false,
    };
  }

  if (hasPrimary && lowerKey === "v") {
    return {
      action: event.type === "keydown" ? "paste" : "pass",
      allowXterm: false,
    };
  }

  return { action: "pass", allowXterm: true };
}

/** 为远端终端绑定 Ctrl+C / Ctrl+V / 原生 paste 支持，防止 Ctrl+V 向 PTY 发送原始 \\x16。 */
export function attachRemoteTerminalClipboard(
  term: RemoteClipboardTerminal,
  container: Pick<HTMLElement, "addEventListener" | "removeEventListener">,
  onError?: (error: unknown) => void,
): () => void {
  let lastPasteAt = 0;

  const pasteText = (text: string) => {
    if (!text || term.options.disableStdin) return;
    term.paste(text);
  };

  const handleCtrlV = async () => {
    if (term.options.disableStdin) return;
    const now = Date.now();
    if (now - lastPasteAt < 150) return;
    lastPasteAt = now;
    try {
      const content = await readTerminalClipboard(navigator.clipboard);
      if (content.kind === "text") {
        pasteText(content.text);
      }
    } catch (error) {
      lastPasteAt = 0;
      onError?.(error);
    }
  };

  const handleNativePaste = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (term.options.disableStdin) return;
    const now = Date.now();
    if (now - lastPasteAt < 150) return;
    lastPasteAt = now;
    try {
      const content = readTerminalPasteEvent(event.clipboardData);
      if (content.kind === "text") {
        pasteText(content.text);
      }
    } catch (error) {
      onError?.(error);
    }
  };

  container.addEventListener("paste", handleNativePaste as EventListener, true);

  term.attachCustomKeyEventHandler((event) => {
    const decision = classifyRemoteTerminalKey(event, term.hasSelection());
    if (decision.action === "copy") {
      event.preventDefault();
      event.stopPropagation();
      void navigator.clipboard.writeText(term.getSelection()).catch((error: unknown) => {
        onError?.(error);
      });
      return false;
    }
    if (decision.action === "paste") {
      event.preventDefault();
      event.stopPropagation();
      void handleCtrlV();
      return false;
    }
    return decision.allowXterm;
  });

  return () => {
    container.removeEventListener("paste", handleNativePaste as EventListener, true);
  };
}
