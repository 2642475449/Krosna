import type { Session } from "@/types";
import { normalizeSessionTitles } from "@/lib/sessionTitles";
import { getNextSessionActivityAt } from "@/lib/sessionActivity";
import type { SessionEventType, SessionRuntimeStatus } from "../types";

export function updateSessionCollection(
  sessions: Session[],
  sessionId: string,
  updates: Partial<Session>
) {
  return sessions.map((session) => {
    if (session.id !== sessionId) return session;
    const next = { ...session, ...updates };
    const activityAt = getNextSessionActivityAt(session, updates.lastActivityAt);
    if (activityAt === undefined) delete next.lastActivityAt;
    else next.lastActivityAt = activityAt;
    return normalizeSessionTitles({
      ...next,
      ...(updates.titleSource === "manual" && updates.name
        ? { manualTitle: updates.name } : {}),
    });
  });
}

export function mapStatusFromEvent(eventType: SessionEventType): SessionRuntimeStatus {
  if (eventType === "session_started" || eventType === "session_resumed") return "waiting";
  if (eventType === "assistant_complete") return "completed";
  if (eventType === "waiting_input" || eventType === "permission_request") return "waiting";
  if (eventType === "process_error" || eventType === "hook_error") return "error";
  if (eventType === "process_exit") return "stopped";
  return "running";
}
