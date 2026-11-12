import type { Terminal } from "@xterm/xterm";
import type { Session } from "@/types";
import { restoreRunnerOutputSnapshot, type RunnerOutputSnapshot } from "./runnerOutputSnapshot";

export function shouldRestoreShellHistory(session: Session | undefined): boolean {
  return Boolean(session?.workspaceRestorePending && (session.agentId === "cmd" || session.agentId === "powershell"));
}

/** 仅在新 Shell 进程启动前调用；历史全屏程序的 alternate buffer 不应成为新 Shell 的输入画面。 */
export async function restoreShellTerminalHistory(term: Terminal, snapshot: RunnerOutputSnapshot, signal?: AbortSignal): Promise<void> {
  await restoreRunnerOutputSnapshot(term, snapshot, { signal });
  if (signal?.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const cancel = () => reject(new Error("Shell history restore cancelled"));
    signal?.addEventListener("abort", cancel, { once: true });
    term.write("\x1b[?1049l\x1b[0m\r\n", () => {
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) cancel(); else resolve();
    });
  });
  term.scrollToBottom();
}
