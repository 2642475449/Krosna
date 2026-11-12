import { expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { captureTerminalRecoverySnapshot, TERMINAL_RECOVERY_MAX_BYTES, TerminalRecoveryCaptureSizeError } from "./terminalRecoverySnapshot";
import { restoreRunnerOutputSnapshot } from "./runnerOutputSnapshot";

function write(term: Terminal, value: string): Promise<void> { return new Promise((resolve) => term.write(value, resolve)); }

it("retains recent Unicode output while limiting old scrollback without mutating the live terminal", async () => {
  const source = new Terminal({ cols: 20, rows: 3, scrollback: 10_000, allowProposedApi: true });
  const target = new Terminal({ cols: 20, rows: 3, scrollback: 10_000, allowProposedApi: true });
  try {
    await write(source, Array.from({ length: 6_000 }, (_, i) => `${i}: 中文🙂`).join("\r\n"));
    const originalLength = source.buffer.normal.length;
    const saved = captureTerminalRecoverySnapshot(source);
    expect(new TextEncoder().encode(JSON.stringify(saved)).byteLength).toBeLessThanOrEqual(TERMINAL_RECOVERY_MAX_BYTES);
    expect(source.buffer.normal.length).toBe(originalLength);
    await restoreRunnerOutputSnapshot(target, saved);
    expect(target.buffer.normal.length).toBeLessThanOrEqual(5_003);
    expect(target.buffer.active.getLine(target.buffer.active.baseY + target.buffer.active.cursorY)?.translateToString(true)).toBe("5999: 中文🙂");
    expect(target.buffer.normal.getLine(0)?.translateToString(true)).not.toContain("0: 中文");
  } finally { source.dispose(); target.dispose(); }
});

it("classifies unsupported giant screens separately from disk and capture failures", () => {
  const term = { cols: 4096, rows: 4096 } as Terminal;
  expect(() => captureTerminalRecoverySnapshot(term)).toThrow(TerminalRecoveryCaptureSizeError);
});
