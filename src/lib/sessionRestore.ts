import type { Session } from "@/types";

export type SessionRestorePlan =
  | { kind: "resume-exact" | "start-empty"; agentSessionId: string | null; resume: boolean }
  | { kind: "unavailable"; reason: "missing-conversation-id" | "unsupported-session" };

/** 自动恢复只使用绑定的会话身份，不按最近时间或 --continue 猜测对话。 */
export function buildSessionRestorePlan(session: Session): SessionRestorePlan {
  const agentId = session.agentId ?? "claude";
  if (session.archived) return { kind: "unavailable", reason: "unsupported-session" };
  // 普通终端只重新打开 Shell 和工作目录，不恢复原进程或重放历史命令。
  if (agentId === "cmd" || agentId === "powershell") {
    return { kind: "start-empty", agentSessionId: null, resume: false };
  }
  if (session.ephemeral ||
    !["claude", "codex", "pi", "antigravity", "qoder", "opencode"].includes(agentId)) {
    return { kind: "unavailable", reason: "unsupported-session" };
  }

  const nativeId = session.agentSessionId?.trim() || null;
  // 本地持久化可能来自旧版本或损坏数据；不把无效身份拼进 Shell 命令。
  if (nativeId && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(nativeId)) {
    return { kind: "unavailable", reason: "missing-conversation-id" };
  }
  if (agentId === "opencode" && !nativeId) {
    return { kind: "unavailable", reason: "missing-conversation-id" };
  }
  if (!nativeId && session.hasPromptHistory === false) {
    return {
      kind: "start-empty",
      agentSessionId: agentId === "pi" ? session.id : null,
      resume: false,
    };
  }

  const exactId = agentId === "claude" ? session.id : nativeId ?? (agentId === "pi" ? session.id : null);
  if (!exactId || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(exactId)) {
    return { kind: "unavailable", reason: "missing-conversation-id" };
  }
  return { kind: "resume-exact", agentSessionId: exactId, resume: true };
}
