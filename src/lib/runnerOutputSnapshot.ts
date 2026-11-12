import type { Terminal } from "@xterm/xterm";
import { SerializeAddon } from "@xterm/addon-serialize";

export interface RunnerOutputSnapshot {
  version: 1;
  data: string;
  cols: number;
  rows: number;
  viewportY: number;
  scrollback?: number;
  selection?: {
    startColumn: number;
    startRow: number;
    endColumn: number;
    endRow: number;
  } | null;
}

const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_VISIBLE_CELLS = 1024 * 1024;
const MAX_SCROLLBACK = 50_000;
const WRITE_CHUNK_CHARS = 64 * 1024;
const DISPOSE_CHECK_MS = 25;

function isCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateSnapshot(snapshot: RunnerOutputSnapshot): void {
  if (!snapshot || snapshot.version !== 1 || typeof snapshot.data !== "string"
    || !Number.isInteger(snapshot.cols) || snapshot.cols < 2 || snapshot.cols > MAX_DIMENSION
    || !Number.isInteger(snapshot.rows) || snapshot.rows < 1 || snapshot.rows > MAX_DIMENSION
    || snapshot.cols * snapshot.rows > MAX_VISIBLE_CELLS || !isCoordinate(snapshot.viewportY)
    || (snapshot.scrollback !== undefined && (!isCoordinate(snapshot.scrollback) || snapshot.scrollback > MAX_SCROLLBACK))) {
    throw new Error("Invalid runner output snapshot");
  }
  const selection = snapshot.selection;
  if (selection != null && (!isCoordinate(selection.startColumn) || selection.startColumn >= snapshot.cols
    || !isCoordinate(selection.endColumn) || selection.endColumn > snapshot.cols
    || !isCoordinate(selection.startRow) || !isCoordinate(selection.endRow)
    || selection.endRow < selection.startRow
    || (selection.startRow === selection.endRow && selection.endColumn < selection.startColumn)
    || !Number.isSafeInteger((selection.endRow - selection.startRow) * snapshot.cols
      + selection.endColumn - selection.startColumn))) {
    throw new Error("Invalid runner output snapshot selection");
  }
  // JSON 转义、选区等元数据也计入预算；不能只检查原始 VT 字符串。
  if (snapshot.data.length > MAX_SNAPSHOT_BYTES
    || new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new Error("Runner output snapshot exceeds 32 MiB");
  }
}

/** 调用方必须先等待帧保护、IME 和 xterm 解析队列全部排空。 */
export function captureRunnerOutputSnapshot(term: Terminal, maxScrollbackRows?: number): RunnerOutputSnapshot {
  const addon = new SerializeAddon();
  try {
    term.loadAddon(addon);
    const selection = term.getSelectionPosition();
    const scrollback = maxScrollbackRows === undefined ? undefined : Math.max(0, Math.floor(maxScrollbackRows));
    const offset = scrollback === undefined ? 0 : Math.max(0, term.buffer.normal.length - term.rows - scrollback);
    const snapshot: RunnerOutputSnapshot = {
      version: 1,
      data: addon.serialize({ excludeModes: true, excludeAltBuffer: false, ...(scrollback === undefined ? {} : { scrollback }) }),
      cols: term.cols,
      rows: term.rows,
      viewportY: Math.max(0, term.buffer.active.viewportY - (term.buffer.active.type === "normal" ? offset : 0)),
      scrollback: term.options.scrollback ?? 0,
      selection: selection && (term.buffer.active.type !== "normal" || selection.start.y >= offset) ? {
        startColumn: selection.start.x,
        startRow: selection.start.y - (term.buffer.active.type === "normal" ? offset : 0),
        endColumn: selection.end.x,
        endRow: selection.end.y - (term.buffer.active.type === "normal" ? offset : 0),
      } : null,
    };
    validateSnapshot(snapshot);
    return snapshot;
  } finally {
    addon.dispose();
  }
}

interface RestoreOptions {
  isDisposed?: () => boolean;
  signal?: AbortSignal;
}

function cancellationError(): Error {
  const error = new Error("Runner output snapshot restore cancelled");
  error.name = "AbortError";
  return error;
}

function checkCancelled(options: RestoreOptions): void {
  if (options.signal?.aborted || options.isDisposed?.()) throw cancellationError();
}

function writeParsed(term: Terminal, data: string, options: RestoreOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const finish = (failed: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (failed) reject(error);
      else resolve();
    };
    const onAbort = () => finish(true, cancellationError());
    const check = () => {
      try { checkCancelled(options); }
      catch (error) { finish(true, error); }
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.isDisposed) timer = setInterval(check, DISPOSE_CHECK_MS);
    check();
    if (settled) return;
    try { term.write(data, () => { check(); finish(false); }); }
    catch (error) { finish(true, error); }
  });
}

/** 调用方负责恢复期间屏蔽 OSC 副作用、PTY 输入和实时输出竞争。 */
export async function restoreRunnerOutputSnapshot(
  term: Terminal,
  snapshot: RunnerOutputSnapshot,
  options: RestoreOptions = {},
): Promise<void> {
  // 完整校验先于 resize/reset；坏快照不能破坏当前终端。
  validateSnapshot(snapshot);
  checkCancelled(options);
  // 用户可能在归档后调小设置，先恢复旧容量，避免回放时静默截断历史。
  if (snapshot.scrollback !== undefined && snapshot.scrollback > (term.options.scrollback ?? 0)) {
    term.options.scrollback = snapshot.scrollback;
  }
  term.resize(snapshot.cols, snapshot.rows);
  term.reset();
  for (let start = 0; start < snapshot.data.length;) {
    checkCancelled(options);
    let end = Math.min(start + WRITE_CHUNK_CHARS, snapshot.data.length);
    // write 是字符串分块，避免在高/低代理项之间切断 Unicode 字符。
    const last = snapshot.data.charCodeAt(end - 1);
    if (end < snapshot.data.length && last >= 0xd800 && last <= 0xdbff
      && snapshot.data.charCodeAt(end) >= 0xdc00 && snapshot.data.charCodeAt(end) <= 0xdfff) end -= 1;
    await writeParsed(term, snapshot.data.slice(start, end), options);
    start = end;
  }
  checkCancelled(options);
  term.scrollToLine(snapshot.viewportY);
  if (snapshot.selection) {
    const { startColumn, startRow, endColumn, endRow } = snapshot.selection;
    term.select(startColumn, startRow, (endRow - startRow) * snapshot.cols + endColumn - startColumn);
  }
}
