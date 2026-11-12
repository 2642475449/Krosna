import type { Session } from "@/types";
import { parseTerminalProgramStatus } from "./terminalAgentInterrupt";

export type AgentUserResponseEventType = "permission_request" | "waiting_input";

export interface AgentUserResponseBaseline {
  revision: number;
  eventType: AgentUserResponseEventType;
}

export function getAgentUserResponseBaseline(
  session: Session | undefined,
): AgentUserResponseBaseline | null {
  if (
    session?.status !== "waiting" ||
    session.statusRevision === undefined ||
    (session.lastEventType !== "permission_request" && session.lastEventType !== "waiting_input")
  ) {
    return null;
  }
  return {
    revision: session.statusRevision,
    eventType: session.lastEventType,
  };
}

/**
 * 权限选择始终属于现有请求，不依赖检查点是否启用或恢复。
 * Provider 在普通提示符上也可能保留 waiting_input；此时没有活动检查点，
 * 下一次提交必须作为新回合建立 baseline。
 */
export function getAgentTurnInputResponseBaseline(
  session: Session | undefined,
): AgentUserResponseBaseline | null {
  if (session?.lastEventType !== "permission_request" && !session?.checkpointActiveTurnId) return null;
  return getAgentUserResponseBaseline(session);
}

/** 快捷键可能直接完成选择；写入成功且根 CLI 报告恢复运行后，才补齐回复状态。 */
export function createTerminalAgentUserResponse(options: {
  getSession: () => Session | undefined;
  confirm: (baseline: AgentUserResponseBaseline) => void;
}) {
  type Pending = { baseline: AgentUserResponseBaseline; written: boolean; working: boolean };
  let pending: Pending | null = null;
  let disposed = false;
  const cancel = () => { pending = null; };
  const settle = (candidate: Pending) => {
    if (pending !== candidate || !candidate.written || !candidate.working) return;
    cancel();
    if (!disposed && isAgentUserResponseBaselineCurrent(options.getSession(), candidate.baseline)) {
      options.confirm(candidate.baseline);
    }
  };
  return {
    prepareInput(data: string) {
      cancel();
      const session = options.getSession();
      const baseline = getAgentUserResponseBaseline(session);
      // 回车由提交分流处理；普通按键不能单独证明用户已经完成选择。
      if (disposed || !session?.active || !baseline || data === "\r" || data === "\n") return () => {};
      const candidate: Pending = { baseline, written: false, working: false };
      pending = candidate;
      return (written: boolean) => {
        if (pending !== candidate) return;
        if (!written) cancel();
        else { candidate.written = true; settle(candidate); }
      };
    },
    observeProgramStatus(data: string) {
      if (data === "state=clear") { cancel(); return; }
      const state = parseTerminalProgramStatus(data, options.getSession()?.agentId);
      if (!pending || state !== "working") return;
      pending.working = true;
      settle(pending);
    },
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}

export function isAgentUserResponseBaselineCurrent(
  session: Session | undefined,
  baseline: AgentUserResponseBaseline,
): boolean {
  return (
    session?.status === "waiting" &&
    session.statusRevision === baseline.revision &&
    session.lastEventType === baseline.eventType
  );
}
