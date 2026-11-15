import type { Session } from "@/types";

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Conversation activity is independent from lifecycle/status event ordering. */
export function getSessionActivityAt(session: Session): number | undefined {
  return isTimestamp(session.lastActivityAt) && session.lastActivityAt >= session.createdAt
    ? session.lastActivityAt
    : undefined;
}

export function getNextSessionActivityAt(session: Session, timestamp: unknown): number | undefined {
  const previous = getSessionActivityAt(session);
  if (!isTimestamp(timestamp) || timestamp < session.createdAt) return previous;
  return Math.max(previous ?? session.createdAt, timestamp);
}

export function getSessionTime(session: Session): { timestamp: number; kind: "activity" | "created" } {
  const activityAt = getSessionActivityAt(session);
  return activityAt === undefined
    ? { timestamp: session.createdAt, kind: "created" }
    : { timestamp: activityAt, kind: "activity" };
}

export const DEFAULT_STALE_SESSION_DAYS = 7;
export const STALE_SESSION_THRESHOLD_MS = DEFAULT_STALE_SESSION_DAYS * 24 * 60 * 60 * 1000;

export function getStaleSessionThresholdMs(days: number): number {
  return Number.isFinite(days) && days > 0 ? days * 24 * 60 * 60 * 1000 : Number.POSITIVE_INFINITY;
}

export function isStaleSession(
  session: Session,
  activeSessionId: string | null,
  now: number = Date.now(),
  thresholdMs: number = STALE_SESSION_THRESHOLD_MS,
): boolean {
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return false;
  if (session.pinned) return false;
  if (activeSessionId !== null && session.id === activeSessionId) return false;
  if (
    session.active &&
    (session.status === "starting" || session.status === "running" || session.status === "waiting")
  ) {
    return false;
  }
  const { timestamp } = getSessionTime(session);
  return now - timestamp >= thresholdMs;
}

function compareSessionsByActivityDesc(a: Session, b: Session): number {
  const timeDiff = getSessionTime(b).timestamp - getSessionTime(a).timestamp;
  if (timeDiff !== 0) return timeDiff;
  return b.createdAt - a.createdAt;
}

export function partitionSidebarSessions(
  sessions: Session[],
  activeSessionId: string | null,
  now: number = Date.now(),
  thresholdMs: number = STALE_SESSION_THRESHOLD_MS,
): {
  pinnedSessions: Session[];
  recentSessions: Session[];
  staleSessions: Session[];
} {
  const pinnedSessions: Session[] = [];
  const recentSessions: Session[] = [];
  const staleSessions: Session[] = [];

  for (const session of sessions) {
    if (session.pinned) {
      pinnedSessions.push(session);
    } else if (isStaleSession(session, activeSessionId, now, thresholdMs)) {
      staleSessions.push(session);
    } else {
      recentSessions.push(session);
    }
  }

  pinnedSessions.sort(compareSessionsByActivityDesc);
  recentSessions.sort(compareSessionsByActivityDesc);
  staleSessions.sort(compareSessionsByActivityDesc);

  return { pinnedSessions, recentSessions, staleSessions };
}
