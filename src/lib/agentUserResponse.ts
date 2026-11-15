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

/** 权限菜单可由回车确认；等待输入的回车也可能只是空提交或编辑换行。 */
export function getAgentSubmitResponseBaseline(
  session: Session | undefined,
): AgentUserResponseBaseline | null {
  const baseline = getAgentUserResponseBaseline(session);
  return baseline?.eventType === "permission_request" ? baseline : null;
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
      // 权限回车由提交流程确认；提问回车仍须等待根 CLI 实际恢复运行。
      const submitting = data === "\r" || data === "\n";
      if (disposed || !session?.active || !baseline
        || (submitting && baseline.eventType === "permission_request")) return () => {};
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
