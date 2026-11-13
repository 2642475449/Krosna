import { expect, it } from "vitest";
import type { TFunction } from "i18next";
import {
  formatShortAgentVersion,
  getAgentQuotaPresentation,
  getAgentVersionPresentation,
  mergeAgentQuotaResult,
  shouldReuseInFlightQuotaRequest,
} from "./agentSettingsView";

const translations: Record<string, string> = {
  "settings.agents.quota.installFirst": "安装并登录后显示额度",
  "settings.agents.quota.unsupported": "暂不支持读取额度",
  "settings.agents.quota.loading": "正在读取额度…",
  "settings.agents.quota.startSession": "启动一次会话后显示额度",
  "settings.agents.quota.unavailable": "暂时无法读取额度",
  "settings.agents.quota.gemini": "Gemini",
  "settings.agents.quota.claudeGpt": "Claude/GPT",
  "settings.agents.quota.sessionShort": "5小时",
  "settings.agents.quota.weeklyShort": "每周",
  "settings.agents.details.quota": "可用额度",
  "statusBar.quota.weekly": "每周",
  "statusBar.quota.hours": "{{value}} 小时",
};

const mockT = ((key: string, params?: Record<string, unknown>) => {
  if (key === "settings.agents.quota.remainingPercent") return `剩余 ${params?.value}%`;
  if (key === "settings.agents.quota.remainingCredits") return `剩余 ${params?.value}`;
  if (key === "statusBar.quota.hours") return `${params?.value} 小时`;
  return translations[key] ?? key;
}) as unknown as TFunction;

it("normalizes CLI version strings into compact v-prefixed versions", () => {
  expect(formatShortAgentVersion("codex-cli 0.167.2", "Codex")).toBe("v0.167.2");
  expect(formatShortAgentVersion("2.1.312", "Claude Code")).toBe("v2.1.312");
  expect(formatShortAgentVersion("v1.5.6", "Antigravity CLI")).toBe("v1.5.6");
  expect(formatShortAgentVersion(null, "Pi")).toBeNull();
});

it("computes version presentation states for updatable, upToDate, and uninstalled agents", () => {
  expect(
    getAgentVersionPresentation(
      { installed: true, version: "codex-cli 0.167.1" },
      "Codex",
      { status: "success", latest: "0.167.2" },
    ),
  ).toEqual({
    shortVersion: "v0.167.1",
    status: "updateAvailable",
    latestVersion: "v0.167.2",
    updatable: true,
  });

  expect(
    getAgentVersionPresentation(
      { installed: true, version: "2.1.322" },
      "Claude Code",
      { status: "success", latest: "2.1.322" },
    ),
  ).toEqual({
    shortVersion: "v2.1.322",
    status: "upToDate",
    latestVersion: "v2.1.322",
    updatable: false,
  });

  expect(
    getAgentVersionPresentation(
      { installed: false, version: null },
      "Qoder CLI",
      { status: "success", latest: "1.1.88" },
    ),
  ).toEqual({
    shortVersion: null,
    status: "unknown",
    latestVersion: "v1.1.88",
    updatable: false,
  });
});

it("maps codex and antigravity quotas to circular ring items and keeps fallback reasons", () => {
  const codex = getAgentQuotaPresentation(
    { id: "codex", installed: true },
    {
      status: "ok",
      updatedAt: 1,
      error: null,
      session: { usedPercent: 6, windowMinutes: 300, resetsAt: null, resetDescription: null },
      weekly: { usedPercent: 24, windowMinutes: 10080, resetsAt: null, resetDescription: null },
    },
    false,
    mockT,
  );
  expect(codex.rings).toHaveLength(2);
  expect(codex.rings.map((ring) => ring.remaining)).toEqual([94, 76]);

  const antigravity = getAgentQuotaPresentation(
    { id: "antigravity", installed: true },
    {
      status: "ok",
      updatedAt: 1,
      error: null,
      windows: [
        { id: "g1", scope: "Gemini", window: "session", remainingPercent: 84, resetDescription: null },
        { id: "c1", scope: "Claude and GPT", window: "weekly", remainingPercent: 29, resetDescription: null },
      ],
    },
    false,
    mockT,
  );
  expect(antigravity.rings.map((ring) => ring.remaining)).toEqual([84, 29]);

  const claudePending = getAgentQuotaPresentation(
    { id: "claude", installed: true },
    null,
    false,
    mockT,
  );
  expect(claudePending.rings).toEqual([]);
  expect(claudePending.summaryText).toBe("启动一次会话后显示额度");

  const uninstalled = getAgentQuotaPresentation(
    { id: "qoder", installed: false },
    null,
    false,
    mockT,
  );
  expect(uninstalled.rings).toEqual([]);
  expect(uninstalled.summaryText).toBe("安装并登录后显示额度");
});

it("preserves cached ok quotas when subsequent fetches fail or return unavailable", () => {
  type SampleQuota = {
    status: "ok" | "unavailable" | "error";
    updatedAt: number;
    error: string | null;
    session: null;
    weekly: null;
  };
  const cached: SampleQuota = { status: "ok", updatedAt: 100, error: null, session: null, weekly: null };
  expect(
    mergeAgentQuotaResult<SampleQuota>(cached, {
      status: "fulfilled",
      value: { status: "unavailable", updatedAt: 200, error: "timeout", session: null, weekly: null },
    }),
  ).toBe(cached);
  expect(
    mergeAgentQuotaResult<SampleQuota>(cached, {
      status: "rejected",
      reason: new Error("ipc failed"),
    }),
  ).toBe(cached);

  const fresh: SampleQuota = { status: "ok", updatedAt: 300, error: null, session: null, weekly: null };
  expect(mergeAgentQuotaResult<SampleQuota>(cached, { status: "fulfilled", value: fresh })).toBe(fresh);
});

it("does not swallow forceRefresh when a passive quota request is already in flight", () => {
  expect(shouldReuseInFlightQuotaRequest(null, false)).toBe(false);
  expect(shouldReuseInFlightQuotaRequest({ forceRefresh: false }, false)).toBe(true);
  expect(shouldReuseInFlightQuotaRequest({ forceRefresh: false }, true)).toBe(false);
  expect(shouldReuseInFlightQuotaRequest({ forceRefresh: true }, true)).toBe(true);
});
