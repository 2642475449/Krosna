import { describe, expect, it } from "vitest";
import type { Session } from "@/types";
import {
  getNextSessionActivityAt,
  getSessionActivityAt,
  getSessionTime,
  isStaleSession,
  partitionSidebarSessions,
  STALE_SESSION_THRESHOLD_MS,
} from "./sessionActivity";
import { toPersistedSession } from "./sessions";

const session: Session = { id: "activity", path: "D:/project", name: "Activity", createdAt: 100, active: true };

describe("conversation time semantics", () => {
  it("uses activity independently of more recent startup/status/exit timestamps", () => {
    expect(getSessionTime({ ...session, lastActivityAt: 200, lastEventAt: 900, statusUpdatedAt: 1000 }))
      .toEqual({ timestamp: 200, kind: "activity" });
  });

  it("labels legacy records as creation time when their activity cannot be established", () => {
    expect(getSessionTime({ ...session, lastEventAt: 900, statusUpdatedAt: 1000, lastEventType: "session_resumed" }))
      .toEqual({ timestamp: 100, kind: "created" });
  });

  it.each([NaN, Infinity, -1, 50, null, "200"])("ignores invalid or pre-creation activity %j", (value) => {
    const corrupted = { ...session, lastActivityAt: value } as Session;
    expect(getSessionActivityAt(corrupted)).toBeUndefined();
    expect(getSessionTime(corrupted)).toEqual({ timestamp: 100, kind: "created" });
    expect(toPersistedSession(corrupted).lastActivityAt).toBeUndefined();
    expect(getNextSessionActivityAt({ ...session, lastActivityAt: 250 }, value)).toBe(250);
  });

  it("preserves epoch timestamps and refuses to roll back valid activity", () => {
    expect(getSessionTime({ ...session, createdAt: 0, lastActivityAt: 0 }))
      .toEqual({ timestamp: 0, kind: "activity" });
    expect(getNextSessionActivityAt({ ...session, lastActivityAt: 250 }, 200)).toBe(250);
    expect(getNextSessionActivityAt({ ...session, lastActivityAt: 250 }, 300)).toBe(300);
  });
});

describe("stale session partitioning", () => {
  const now = 20 * 24 * 60 * 60 * 1000;
  const oldTime = now - STALE_SESSION_THRESHOLD_MS - 1000;
  const recentTime = now - STALE_SESSION_THRESHOLD_MS + 60_000;

  it("marks unpinned inactive sessions at or beyond 7 days as stale", () => {
    expect(isStaleSession({ ...session, id: "old", createdAt: oldTime, active: false }, null, now)).toBe(true);
    expect(isStaleSession({ ...session, id: "exact", createdAt: now - STALE_SESSION_THRESHOLD_MS, active: false }, null, now)).toBe(true);
    expect(isStaleSession({ ...session, id: "recent", createdAt: oldTime, lastActivityAt: recentTime, active: false }, null, now)).toBe(false);
  });

  it("keeps pinned, active, and live running/waiting/starting sessions out of stale", () => {
    expect(isStaleSession({ ...session, id: "pinned", pinned: true, createdAt: oldTime, active: false }, null, now)).toBe(false);
    expect(isStaleSession({ ...session, id: "focused", createdAt: oldTime, active: false }, "focused", now)).toBe(false);
    expect(isStaleSession({ ...session, id: "running", createdAt: oldTime, active: true, status: "running" }, null, now)).toBe(false);
    expect(isStaleSession({ ...session, id: "waiting", createdAt: oldTime, active: true, status: "waiting" }, null, now)).toBe(false);
    expect(isStaleSession({ ...session, id: "starting", createdAt: oldTime, active: true, status: "starting" }, null, now)).toBe(false);
    expect(isStaleSession({ ...session, id: "persisted-waiting", createdAt: oldTime, active: false, status: "waiting" }, null, now)).toBe(true);
  });

  it("partitions sessions into pinned, recent, and stale groups sorted by latest time descending", () => {
    const pinned = { ...session, id: "p", pinned: true, createdAt: oldTime, active: false };
    const recent = { ...session, id: "r", createdAt: recentTime, active: false };
    const stale = { ...session, id: "s", createdAt: oldTime, active: false, status: "completed" as const };
    const oldCreatedRecentlyActive = {
      ...session,
      id: "revived",
      createdAt: oldTime - 1000,
      lastActivityAt: now - 1000,
      active: false,
    };

    const result = partitionSidebarSessions([pinned, recent, stale, oldCreatedRecentlyActive], null, now);
    expect(result.pinnedSessions.map((s) => s.id)).toEqual(["p"]);
    expect(result.recentSessions.map((s) => s.id)).toEqual(["revived", "r"]);
    expect(result.staleSessions.map((s) => s.id)).toEqual(["s"]);
  });
});
