import type { Session } from "@/types";
import type { AttentionItem } from "./attention";
import { isAiAgentId } from "./agents";
import { isSessionTurnRunning } from "./sessions";

export type SessionFeedbackState = "starting" | "running" | "waiting" | "permission" | "completed" | "error" | "unknown";
export interface SessionFeedback {
  state: SessionFeedbackState;
  unread?: boolean;
  detail?: string;
  expiresAt?: number;
}

/** One presentation policy for workspace tabs, the sidebar and auxiliary tabs. */
export function getSessionFeedback(session: Session, item?: AttentionItem, now = Date.now()): SessionFeedback | null {
  if (!isAiAgentId(session.agentId ?? "claude")) return null;
  const running = isSessionTurnRunning(session);
  const superseded = running && item && (
    session.statusRevision && item.sourceRevision
      ? session.statusRevision > item.sourceRevision
      : (session.statusUpdatedAt ?? 0) > item.createdAt
  );
  // The runtime also uses "waiting" for an idle prompt. Input/permission
  // indicators require an open attention item, rather than status alone.
  if (item?.disposition === "open" && !superseded) {
    if (item.kind === "permission") return { state: "permission", detail: item.description };
    if (item.kind === "input") return { state: "waiting", detail: item.description };
    if (item.kind === "failure") return { state: "error", detail: item.description };
    if (item.kind === "completion") return { state: "completed", unread: true };
  }
  if (running) return { state: session.status === "starting" ? "starting" : "running" };
  if (session.status === "error") return { state: "error" };
  if (item?.kind === "completion" && item.resolutionReason === "observed-in-foreground") {
    const expiresAt = item.createdAt + 2000;
    if (expiresAt > now) return { state: "completed", expiresAt };
  }
  if (session.active && !session.status) return { state: "unknown" };
  return null;
}
