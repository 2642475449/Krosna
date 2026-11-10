// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { useTranslation } from "react-i18next";
import type { CodexRateLimits, UsageQuotaWindow } from "@/types";

vi.mock("react-i18next", async () => {
  const { createInstance } = await import("i18next");
  const en = (await import("@/locales/en-US.json")).default;
  const zh = (await import("@/locales/zh-CN.json")).default;
  const ja = (await import("@/locales/ja-JP.json")).default;
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en }, zh: { translation: zh }, ja: { translation: ja } } });
  return { useTranslation: () => ({ t: i18n.t, i18n }) };
});
import { QuotaDetailsContent, QuotaUsageStatus } from "./QuotaUsageStatus";

const window = (minutes: number, used: number): UsageQuotaWindow => ({ id: String(minutes), usedPercent: used, windowMinutes: minutes, resetsAt: null, resetDescription: null, bucketId: "codex", bucketName: null, label: null });
test.each([
  ["en", "Plan", "Weekly", "Credits balance"],
  ["zh", "套餐", "每周", "Credits 余额"],
  ["ja", "プラン", "週間", "Credits 残高"],
])("%s renders a new plan and actual quota labels without corrupted text", async (locale, plan, period, credits) => {
  const { i18n } = useTranslation();
  try {
    await i18n.changeLanguage(locale);
    const markup = renderToStaticMarkup(createElement(QuotaDetailsContent, { details: {
      planType: "future_premium-v2", quotaWindows: [window(10080, 15)],
      balances: [{ bucketId: "codex", bucketName: null, balance: 0, unlimited: false, hasCredits: false }],
    } }));
    expect(markup).toContain(`${plan} · Future Premium V2`);
    expect(markup).toContain(period);
    expect(markup).toContain(credits);
    expect(markup).toContain("85%");
    expect(markup).toContain(">0<");
    expect(markup).not.toMatch(/\?{2,}/);
  } finally {
    await i18n.changeLanguage("en");
  }
});

test("blank plan identifiers do not render an empty plan row", () => {
  const markup = renderToStaticMarkup(createElement(QuotaDetailsContent, { details: { planType: "   ", quotaWindows: [window(15, 0)] } }));
  expect(markup).not.toContain("Plan");
  expect(markup).toContain("15 minutes");
});
test.each(["pro", "lite", "plus", "free"])("%s plans retain their actual monthly window and uniform reset date", (planType) => {
  const markup = renderToStaticMarkup(createElement(QuotaDetailsContent, { details: {
    planType,
    quotaWindows: [{ ...window(43200, 25), resetsAt: new Date(2027, 0, 1, 4, 8, 45).getTime() }],
  } }));
  expect(markup).toContain(`Plan · ${planType[0].toUpperCase()}${planType.slice(1)}`);
  expect(markup).toContain("30 days");
  expect(markup).toContain("2027-01-01 04:08");
  expect(markup).not.toContain("5 hours");
});
test("a balance-only response renders zero as a known balance without an unavailable warning", () => {
  const markup = renderToStaticMarkup(createElement(QuotaDetailsContent, { details: { balances: [{ bucketId: "codex", bucketName: null, balance: 0, hasCredits: false, unlimited: false }] } }));
  expect(markup).toContain("Credits balance");
  expect(markup).not.toContain("did not report quota");
  expect(markup).toContain(">0<");
});
test("Codex compact rings show both the five-hour and exhausted weekly constraints", () => {
  const limits: CodexRateLimits = { session: null, weekly: null, quotaWindows: [window(300, 5), window(10080, 100)], status: "ok", error: null, updatedAt: Date.now(), accountId: null, accountLabel: null };
  const markup = renderToStaticMarkup(createElement(QuotaUsageStatus, { agentId: "codex", limits, isLoading: false, error: null, onRefresh: () => {} }));
  expect(markup).toContain("5 hours · 95% remaining");
  expect(markup).toContain("Weekly · 0% remaining");
  expect(markup).toContain('stroke-dasharray="95 5"');
  expect(markup).toContain('stroke-dasharray="0 100"');
});
test("a gateway budget with no dollar amounts remains a valid quota window", () => {
  const markup = renderToStaticMarkup(createElement(QuotaDetailsContent, { details: { quotaWindows: [{ ...window(0, 80), label: "monthlySpend" }] } }));
  expect(markup).toContain("Monthly spend limit");
  expect(markup).toContain("20%");
  expect(markup).not.toContain("Estimated spend");
});
test("OpenCode does not advertise one provider's remaining quota as the whole session's quota", () => {
  const markup = renderToStaticMarkup(createElement(QuotaUsageStatus, { agentId: "opencode", limits: { accounts: [{ provider: "opencode-go", status: "ok", error: null, quotaWindows: [window(300, 80)] }], status: "ok", error: null, updatedAt: Date.now() }, isLoading: false, error: null, onRefresh: () => {} }));
  expect(markup).toContain("OpenCode usage");
  expect(markup).not.toContain("20%");
});

test("OpenCode popover opens with Go windows and Zen explanation, and refresh remains clickable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const refresh = vi.fn();
  try {
    await act(async () => root.render(createElement(QuotaUsageStatus, {
      agentId: "opencode", isLoading: false, error: null, onRefresh: refresh,
      limits: { status: "ok", error: null, updatedAt: Date.now(), accounts: [
        { provider: "opencode-go", status: "ok", error: null, quotaWindows: [window(300, 25), { ...window(0, 50), label: "monthly" }] },
        { provider: "opencode", status: "ok", error: null, emptyReason: "consoleQuota" },
      ] },
    })));
    await act(async () => host.querySelector("button")!.click());
    const popup = document.querySelector(".ant-popover");
    expect(popup?.textContent).toContain("OpenCode Go");
    expect(popup?.textContent).toContain("Monthly");
    expect(popup?.textContent).toContain("Check your balance in the OpenCode console");
    const refreshButton = popup?.querySelector('button[title="Refresh"]') as HTMLButtonElement;
    expect(refreshButton).toBeTruthy();
    await act(async () => refreshButton.click());
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

test.each([
  ["free", 15, "15 minutes"], ["plus", 300, "5 hours"], ["pro", 43200, "30 days"],
])("compact %s quota keeps duration, plan and model metadata in descriptions only", (planType, minutes, period) => {
  const limits: CodexRateLimits = {
    session: null, weekly: null, quotaWindows: [{ ...window(minutes, 20), bucketName: "GPT model" }],
    planType, status: "ok", error: null, updatedAt: Date.now(), accountId: null, accountLabel: null,
  };
  const markup = renderToStaticMarkup(createElement(QuotaUsageStatus, { agentId: "codex", limits, isLoading: false, error: null, onRefresh: () => {} }));
  expect(markup).toContain(planType[0].toUpperCase() + planType.slice(1));
  expect(markup).toContain(`GPT model · ${period}`);
  const visibleText = markup.replace(/<[^>]*>/g, "");
  expect(visibleText).not.toContain(period);
  expect(visibleText).toBe("80");
  expect(visibleText).not.toMatch(/Codex|GPT model|Free|Plus|Pro/);
});
