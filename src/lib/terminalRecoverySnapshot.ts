import type { Terminal } from "@xterm/xterm";
import { captureRunnerOutputSnapshot, type RunnerOutputSnapshot } from "./runnerOutputSnapshot";

export const TERMINAL_RECOVERY_MAX_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_ROWS = 5_000;

export class TerminalRecoveryCaptureSizeError extends Error {
  constructor() { super("Terminal recovery screen exceeds size limit"); }
}

/** 只裁剪最旧的 scrollback，绝不截断 VT 字符串或 Unicode 字符。 */
export function captureTerminalRecoverySnapshot(term: Terminal): RunnerOutputSnapshot {
  if (term.cols > 4096 || term.rows > 4096 || term.cols * term.rows > 1024 * 1024) throw new TerminalRecoveryCaptureSizeError();
  let rows = Math.min(MAX_HISTORY_ROWS, Math.floor(TERMINAL_RECOVERY_MAX_BYTES / (term.cols * 32)), Math.max(0, term.buffer.normal.length - term.rows));
  for (;;) {
    try {
      const snapshot = captureRunnerOutputSnapshot(term, rows);
      if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= TERMINAL_RECOVERY_MAX_BYTES) return snapshot;
    } catch (error) {
      // 共享捕获器的 32 MiB 上限也可能先命中；缩小历史后重试，其他错误保留。
      if (!(error instanceof Error) || !error.message.includes("exceeds 32 MiB")) throw error;
      if (rows === 0) throw new TerminalRecoveryCaptureSizeError();
    }
    if (rows === 0) throw new TerminalRecoveryCaptureSizeError();
    rows = Math.floor(rows / 2);
  }
}
