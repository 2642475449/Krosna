import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { AntigravityUsage, CodexRateLimits, QoderUsage } from "@/types";

vi.mock("react-i18next", async () => {
  const { createInstance } = await import("i18next");
  const en = (await import("@/locales/en-US.json")).default;
  const zh = (await import("@/locales/zh-CN.json")).default;
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: zh }, "en-US": { translation: en } },
  });
  return { useTranslation: () => ({ t: i18n.t, i18n }) };
});

import { AgentQuotaCard } from "./AgentQuotaCard";

it("renders Codex quota details, account label, and progress bar", () => {
  const quota: CodexRateLimits = {
    status: "ok",
    updatedAt: Date.now(),
    error: null,
    accountLabel: "demo@example.com",
    accountId: null,
    session: null,
    weekly: { usedPercent: 26, windowMinutes: 10080, resetsAt: null, resetDescription: null },
  };
  const markup = renderToStaticMarkup(
    createElement(AgentQuotaCard, {
      agentId: "codex",
      quota,
      loading: false,
      onRefresh: () => {},
    }),
  );
  expect(markup).toContain("Codex · 可用额度");
  expect(markup).toContain("74% 剩余");
  expect(markup).toContain("demo@example.com");
});

it("renders Antigravity multi-window bars with tone classes", () => {
  const quota: AntigravityUsage = {
    status: "ok",
    updatedAt: Date.now(),
    error: null,
    windows: [
      { id: "g1", scope: "Gemini", window: "session", remainingPercent: 84, resetDescription: null },
      { id: "c1", scope: "Claude and GPT", window: "weekly", remainingPercent: 29, resetDescription: null },
    ],
  };
  const markup = renderToStaticMarkup(
    createElement(AgentQuotaCard, {
      agentId: "antigravity",
      quota,
      loading: false,
      onRefresh: () => {},
    }),
  );
  expect(markup).toContain("Antigravity CLI · 可用额度");
  expect(markup).toContain("84% 剩余");
  expect(markup).toContain("29% 剩余");
  expect(markup).toContain('<progress class="app-agent-quota-progress is-success"');
  expect(markup).toContain('<progress class="app-agent-quota-progress is-warning"');
  expect(markup).not.toContain("app-agent-quota-bar-fill");
});

it("renders Qoder quota buckets and plan/account metadata", () => {
  const quota: QoderUsage = {
    status: "ok",
    updatedAt: Date.now(),
    error: null,
    userType: "Pro",
    accountLabel: "qoder-user",
    totalUsagePercentage: 20,
    expiresAt: null,
    userQuota: { used: 200, total: 1000, cap: 1000, remaining: 800, percentage: 20, available: true, unit: null },
    addOnQuota: null,
    orgResourcePackage: null,
    isQuotaExceeded: false,
    sessionCredits: null,
  };
  const markup = renderToStaticMarkup(
    createElement(AgentQuotaCard, {
      agentId: "qoder",
      quota,
      loading: false,
      onRefresh: () => {},
    }),
  );
  expect(markup).toContain("Qoder CLI · 可用额度");
  expect(markup).toContain("200 / 1,000");
  expect(markup).toContain("Pro");
  expect(markup).toContain("qoder-user");
});

it("renders unavailable fallback when Qoder has no quota buckets", () => {
  const emptyUsage: QoderUsage = {
    status: "unavailable",
    updatedAt: Date.now(),
    error: null,
    userType: null,
    accountLabel: null,
    totalUsagePercentage: null,
    expiresAt: null,
    userQuota: null,
    addOnQuota: null,
    orgResourcePackage: null,
    isQuotaExceeded: null,
    sessionCredits: null,
  };
  const markup = renderToStaticMarkup(
    createElement(AgentQuotaCard, {
      agentId: "qoder",
      quota: emptyUsage,
      loading: false,
      onRefresh: () => {},
    }),
  );
  expect(markup).toContain("暂时无法读取额度");
});
