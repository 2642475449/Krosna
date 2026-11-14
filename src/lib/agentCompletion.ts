import type { Session } from "@/types";
import type { AttentionSourceEvent } from "./attention";

type CompletionEvent = Pick<
  AttentionSourceEvent,
  "sessionId" | "source" | "eventType" | "revision" | "createdAt"
>;

/** 完成通知与 agent-status 可能分开送达；新的完成事实也能恢复仍存活的错误会话。 */
export function getAgentCompletionUpdates(
  session: Session | undefined,
  event: CompletionEvent,
): Partial<Session> | null {
  if (
    !session ||
    session.id !== event.sessionId ||
    !session.agentId ||
    (session.agentId !== event.source && `${session.agentId}_hook` !== event.source) ||
    !session.active ||
    session.archived ||
    !["starting", "running", "waiting", "error"].includes(session.status ?? "") ||
    event.eventType !== "assistant_complete" ||
    typeof event.revision !== "number" ||
    !Number.isSafeInteger(event.revision) ||
    event.revision <= (session.statusRevision ?? 0) ||
    !Number.isFinite(event.createdAt) ||
    event.createdAt < Math.max(session.statusUpdatedAt ?? 0, session.lastEventAt ?? 0)
  ) {
    return null;
  }

  return {
    status: "completed",
    statusRevision: event.revision,
    statusUpdatedAt: event.createdAt,
  };
}
