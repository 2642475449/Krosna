import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { initializePtyTextLayout } from "./terminalTextLayout";
import { createTerminalOutputFrameGate } from "./terminalOutputFrames";

const write = (terminal: Terminal, data: string) => new Promise<void>((resolve) => terminal.write(data, resolve));

async function writeFrames(terminal: Terminal, frames: string[]) {
  const output: string[] = [];
  const gate = createTerminalOutputFrameGate((data) => output.push(data), { enabled: true });
  frames.forEach((data) => gate.write(data));
  gate.flush();
  gate.dispose();
  for (const data of output) await write(terminal, data);
}

// Reduced from native ConPTY captures; omit shell headers, paths and session identifiers.
const OPENCODE_PROMPT = [
  "\x1b[?2026h\x1b[21;27H\x1b[42X\x1b[38;2;128;128;128m",
  '\nAsk anything… "Fix broken tests"\x1b[?2026l',
];
const CLAUDE_STATUS = [
  "\x1b[?25l\x1b[11;53H1 agent   \x1b[9;3H\x1b[?25h",
  "\x1b[?25l\x1b[11;3H📁\x1b[1CTermflow | 🤖 deepseek-flash    \x1b[1C  \x1b[1C      \x1b[1C \x1b[1C \x1b[1C \x1b[1C     \x1b[12;3H⏵⏵\x1b[1Cbypass\x1b[1Cpermissions\x1b[1Con\x1b[1C(shift+tab\x1b[1Cto\x1b[1Ccycle)\x1b[1C·\x1b[1C←\x1b[1C1\x1b[1Cagent\x1b[9;3H\x1b[?25h",
];

describe("PTY text layout", () => {
  it("keeps OpenCode's positioned LF at the same column through the Windows frame gate", async () => {
    const legacy = new Terminal({ cols: 120, rows: 40, convertEol: true });
    const terminal = new Terminal({ cols: 120, rows: 40, convertEol: true });
    try {
      initializePtyTextLayout(terminal);
      await writeFrames(legacy, OPENCODE_PROMPT);
      await writeFrames(terminal, OPENCODE_PROMPT);
      expect(legacy.buffer.active.getLine(21)?.translateToString(true).indexOf("Ask")).toBe(0);
      expect(terminal.buffer.active.getLine(21)?.translateToString(true).indexOf("Ask")).toBe(26);
      expect(terminal.options.convertEol).toBe(false);
    } finally { legacy.dispose(); terminal.dispose(); }
  });

  it("clears Claude's old agent count instead of leaving nt after the emoji status redraw", async () => {
    const legacy = new Terminal({ cols: 120, rows: 40 });
    const terminal = new Terminal({ cols: 120, rows: 40 });
    try {
      initializePtyTextLayout(terminal);
      await writeFrames(legacy, CLAUDE_STATUS);
      await writeFrames(terminal, CLAUDE_STATUS);
      expect(legacy.buffer.active.getLine(10)?.translateToString(true).trimEnd()).toMatch(/nt$/);
      expect(terminal.buffer.active.getLine(10)?.translateToString(true).trimEnd()).toBe("  📁 Termflow | 🤖 deepseek-flash");
      expect(terminal.buffer.active.getLine(10)?.getCell(2)?.getWidth()).toBe(2);
      expect(terminal.buffer.active.getLine(10)?.getCell(16)?.getWidth()).toBe(2);
    } finally { legacy.dispose(); terminal.dispose(); }
  });

  it.each(["👩‍💻", "👨‍👩‍👧‍👦"])("keeps split ZWJ sequence %s in two cells", async (emoji) => {
    const terminal = new Terminal({ cols: 20, rows: 3 });
    try {
      initializePtyTextLayout(terminal);
      for (const codepoint of emoji) await write(terminal, codepoint);
      await write(terminal, "X中");
      const line = terminal.buffer.active.getLine(0);
      expect(line?.getCell(0)?.getChars()).toBe(emoji);
      expect(line?.getCell(0)?.getWidth()).toBe(2);
      expect(line?.getCell(2)?.getChars()).toBe("X");
      expect(line?.getCell(3)?.getChars()).toBe("中");
      expect(terminal.buffer.active.cursorX).toBe(5);
    } finally { terminal.dispose(); }
  });

  it("preserves CJK, combining marks and CRLF, including after reset", async () => {
    const terminal = new Terminal({ cols: 20, rows: 4 });
    try {
      initializePtyTextLayout(terminal);
      initializePtyTextLayout(terminal);
      await write(terminal, "中文 e\u0301\r\n📁X");
      expect(terminal.buffer.active.getLine(0)?.getCell(5)?.getChars()).toBe("e\u0301");
      expect(terminal.buffer.active.getLine(1)?.getCell(0)?.getWidth()).toBe(2);
      expect(terminal.buffer.active.getLine(1)?.getCell(2)?.getChars()).toBe("X");
      terminal.reset();
      await write(terminal, "🤖X");
      expect(terminal.buffer.active.getLine(0)?.getCell(0)?.getWidth()).toBe(2);
      expect(terminal.buffer.active.cursorX).toBe(3);
      expect(terminal.unicode.activeVersion).toBe("krosna-11-zwj");
    } finally { terminal.dispose(); }
  });

  it("wraps following text after a joined emoji reaches the last column", async () => {
    const terminal = new Terminal({ cols: 8, rows: 3 });
    try {
      initializePtyTextLayout(terminal);
      await write(terminal, "123456👩‍💻X");
      expect(terminal.buffer.active.getLine(0)?.getCell(6)?.getChars()).toBe("👩‍💻");
      expect(terminal.buffer.active.getLine(1)?.getCell(0)?.getChars()).toBe("X");
      expect(terminal.buffer.active.cursorX).toBe(1);
    } finally { terminal.dispose(); }
  });
});
