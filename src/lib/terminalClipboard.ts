export type TerminalClipboardContent =
  | { kind: "text"; text: string }
  | { kind: "image"; blob: Blob }
  | { kind: "empty" };

export const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** 同一次读取中优先截图，避免富剪贴板附带的文本覆盖图片。 */
export async function readTerminalClipboard(
  clipboard: Pick<Clipboard, "read" | "readText">,
): Promise<TerminalClipboardContent> {
  let richReadFailed = false;
  if (clipboard.read) {
    let items: ClipboardItem[] | undefined;
    try {
      items = await clipboard.read();
    } catch {
      // 部分 WebView 只开放文本接口，保留文本粘贴能力。
      richReadFailed = true;
    }
    if (items) {
      for (const item of items) {
        const type = IMAGE_TYPES.find((candidate) => item.types.includes(candidate));
        if (type) return { kind: "image", blob: await item.getType(type) };
      }
      for (const item of items) {
        if (item.types.includes("text/plain")) {
          const text = await (await item.getType("text/plain")).text();
          if (text) return { kind: "text", text };
        }
      }
      if (items.some((item) => item.types.some((type) => type.startsWith("image/")))) {
        throw new Error("terminal.clipboardImageUnsupported");
      }
      return { kind: "empty" };
    }
  }
  const text = await clipboard.readText();
  if (!text && richReadFailed) throw new Error("terminal.clipboardReadFailed");
  return text ? { kind: "text", text } : { kind: "empty" };
}

/** 在原生 paste 事件结束前取出 Blob，兼容 Windows 剪贴板历史粘贴。 */
export function readTerminalPasteEvent(data: DataTransfer): TerminalClipboardContent {
  for (const type of IMAGE_TYPES) {
    const item = Array.from(data.items).find((candidate) => candidate.type === type);
    const blob = item?.getAsFile();
    if (blob) return { kind: "image", blob };
  }
  if (Array.from(data.items).some((item) => item.type.startsWith("image/"))) {
    throw new Error("terminal.clipboardImageUnsupported");
  }
  const text = data.getData("text/plain");
  return text ? { kind: "text", text } : { kind: "empty" };
}

export async function encodeClipboardImage(blob: Blob): Promise<string> {
  if (!IMAGE_TYPES.includes(blob.type)) throw new Error("terminal.clipboardImageUnsupported");
  if (blob.size > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error("terminal.clipboardImageTooLarge");
  if (blob.size === 0) throw new Error("terminal.clipboardEmpty");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

export function formatClipboardImageReference(agentId: string | undefined, path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const quoted = /[\s"'`$;&|<>()]/.test(normalized)
    ? `"${normalized.replace(/"/g, '\\"')}"`
    : normalized;
  const prefix = ["claude", "antigravity", "opencode"].includes(agentId ?? "") ? "@" : "";
  return ` ${prefix}${quoted} `;
}

export function formatTerminalVoicePaste(text: string, bracketedPasteMode: boolean): string {
  // 未开启括号粘贴的 CLI 会将 CR 或 LF 当成回车提交。
  return bracketedPasteMode ? text : text.replace(/\r\n?|\n/g, " ");
}

/** 图片保存期间排队后续输入；在回放前处理粘贴，保证回车与标题捕获顺序一致。 */
export function createTerminalPasteGate(callbacks: {
  input: (data: string) => void;
  paste: (text: string) => void;
  error: (error: unknown) => void;
}) {
  let pending = 0;
  let disposed = false;
  let applyingPaste = false;
  let queue = Promise.resolve();
  const enqueue = (operation: () => Promise<void> | void) => {
    pending += 1;
    const result = queue.then(operation)
      .finally(() => { pending -= 1; });
    queue = result.catch(() => {});
    return result;
  };
  const reportError = (error: unknown) => { if (!disposed) callbacks.error(error); };
  const applyPaste = (text: string) => {
    if (!text) return;
    applyingPaste = true;
    try { callbacks.paste(text); }
    finally { applyingPaste = false; }
  };
  return {
    input(data: string) {
      if (disposed) return;
      if (applyingPaste || pending === 0) callbacks.input(data);
      else void enqueue(() => { if (!disposed) callbacks.input(data); }).catch(reportError);
    },
    paste(prepare: () => Promise<string>) {
      if (disposed) return Promise.resolve();
      // 立即读取剪贴板，保留用户激活权限及每次粘贴的快照。
      const prepared = prepare().then(
        (text) => ({ text, error: undefined }),
        (error: unknown) => ({ text: "", error }),
      );
      return enqueue(async () => {
        const result = await prepared;
        if (disposed) return;
        if (result.error !== undefined) throw result.error;
        applyPaste(result.text);
      }).catch(reportError);
    },
    async pasteText(readAtInsertion: () => string) {
      // 转写已经就绪，普通情况同步交给 xterm。若已有粘贴，轮到它时再验证焦点和会话。
      const insert = () => {
        if (disposed) throw new Error("terminal.clipboardSessionChanged");
        applyPaste(readAtInsertion());
      };
      if (pending === 0) insert();
      else await enqueue(insert);
    },
    dispose() { disposed = true; },
  };
}
