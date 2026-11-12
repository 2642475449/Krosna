import { expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { captureRunnerOutputSnapshot } from "./runnerOutputSnapshot";
import { restoreShellTerminalHistory, shouldRestoreShellHistory } from "./terminalShellRecovery";
import type { Session } from "@/types";

function session(agentId: Session["agentId"], workspaceRestorePending = true): Session {
  return { id: "a", name: "task", path: "C:/project", agentId, workspaceRestorePending } as Session;
}
function write(term: Terminal, value: string): Promise<void> { return new Promise((resolve) => term.write(value, resolve)); }

it("restores only explicitly marked cmd and powershell sessions, never agents or regular live shells", () => {
  expect(shouldRestoreShellHistory(session("cmd"))).toBe(true);
  expect(shouldRestoreShellHistory(session("powershell"))).toBe(true);
  for (const id of ["claude", "codex", "pi", "opencode", "qoder", "antigravity"] as const) expect(shouldRestoreShellHistory(session(id))).toBe(false);
  expect(shouldRestoreShellHistory(session("cmd", false))).toBe(false);
  expect(shouldRestoreShellHistory(undefined)).toBe(false);
});

it("preserves old command output in scrollback before a fresh shell prompt without reviving alternate screen modes", async () => {
  const source = new Terminal({ cols: 20, rows: 3, scrollback: 100, allowProposedApi: true });
  const target = new Terminal({ cols: 20, rows: 3, scrollback: 100, allowProposedApi: true });
  try {
    await write(source, "old command\r\nprevious result\r\nOLD PROMPT> \x1b[?1049hOLD TUI\x1b[?2004h");
    const snapshot = captureRunnerOutputSnapshot(source);
    await restoreShellTerminalHistory(target, snapshot);
    expect(target.buffer.active.type).toBe("normal");
    expect(target.modes.bracketedPasteMode).toBe(false);
    await write(target, "NEW PROMPT> ");
    const lines = Array.from({ length: target.buffer.normal.length }, (_, i) => target.buffer.normal.getLine(i)?.translateToString(true));
    expect(lines).toContain("old command"); expect(lines).toContain("previous result");
    expect(lines.some((line) => line?.startsWith("OLD PROMPT>"))).toBe(true);
    expect(lines.some((line) => line?.startsWith("NEW PROMPT>"))).toBe(true);
    expect(lines.join("\n")).not.toContain("OLD TUI");
  } finally { source.dispose(); target.dispose(); }
});
