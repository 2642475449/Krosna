import { LoadingOutlined, ReloadOutlined, RightOutlined, WarningOutlined } from "@ant-design/icons";
import { Popover } from "antd";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatQuotaDateTime, formatQuotaResetTime } from "@/lib/quotaDateTime";
import { QuotaUsageRing } from "./QuotaUsageRing";
import { AgentIcon } from "@/components/AgentIcon";
import type { ClaudeRateLimits, CodexRateLimits, CodexRateLimitWindow, CodexRateLimitResetCredit, OpenCodeUsage, UsageQuotaDetails } from "@/types";
import { hasQuotaData, legacyQuotaDetails, quotaPlanLabel, quotaWindowLabel, quotaWindows, remainingQuota } from "@/lib/usageQuota";

export function QuotaUsageStatus({
  agentId,
  limits,
  isLoading,
  error,
  onRefresh,
}: {
  agentId: "claude" | "codex" | "opencode";
  limits: ClaudeRateLimits | CodexRateLimits | OpenCodeUsage | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [resetCreditsExpanded, setResetCreditsExpanded] = useState(false);
  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setClock((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  const translationRoot = `statusBar.${agentId === "claude" ? "claudeUsage" : agentId === "opencode" ? "opencodeUsage" : "codexUsage"}`;
  const codexLimits = agentId === "codex" ? limits as CodexRateLimits | null : null;
  const openCode = agentId === "opencode" ? limits as OpenCodeUsage | null : null;
  const details = legacyQuotaDetails(agentId === "opencode" ? null : limits as ClaudeRateLimits | CodexRateLimits | null);
  const windows = quotaWindows(details);
  const hasData = openCode ? openCode.accounts.some(hasQuotaData) : hasQuotaData(details) || Boolean(codexLimits?.rateLimitResetCredits);
  const statusError = error ?? (agentId === "opencode" && limits?.error ? t(`statusBar.quota.${limits.error}`, { defaultValue: limits.error }) : limits?.error);
  const resetCredits = codexLimits?.rateLimitResetCredits?.availableCount;
  const resetCreditDetails = codexLimits?.rateLimitResetCredits;
  // 各周期同时展示，避免只显示最紧额度而隐藏五小时或周额度。
  const compactWindows = agentId === "opencode" ? [] : windows;
  const planLabel = quotaPlanLabel(details.planType);
  const summary = [planLabel, t(`${translationRoot}.title`), ...compactWindows.map((window) =>
    `${quotaWindowLabel(window, t)} · ${t("statusBar.codexUsage.remaining", { value: remainingQuota(window) })}`,
  )].filter(Boolean).join(" · ");
  const stale = hasData && (Boolean(statusError) || Boolean(limits?.updatedAt && Date.now() - limits.updatedAt > 10 * 60_000));

  const popoverContent = (
    <div
      className="app-overlay-surface w-[340px] max-w-[calc(100vw-24px)] overflow-hidden"
    >
      <div
        className="flex items-center justify-between gap-3 px-3 py-2"
        style={{ borderBottom: "1px solid color-mix(in srgb, var(--cs-border-sidebar) 82%, transparent)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <AgentIcon agentId={agentId} size={15} />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium" style={{ color: "var(--cs-text-primary)" }}>
              {t(`${translationRoot}.title`)}
            </div>
            <div className="text-[10px]" style={{ color: "var(--cs-text-tertiary)" }}>
              {statusError && hasData ? `${t("statusBar.usage.stale")} · ` : ""}
              {limits?.updatedAt ? formatUpdatedAt(limits.updatedAt, t) : t(`${translationRoot}.pending`)}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] transition-colors"
          style={{
            color: "var(--cs-text-tertiary)",
            background: "transparent",
            border: "0",
            cursor: isLoading ? "wait" : "pointer",
          }}
          disabled={isLoading}
          title={t("common.refresh")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRefresh();
          }}
        >
          {isLoading ? <LoadingOutlined style={{ fontSize: 12 }} /> : <ReloadOutlined style={{ fontSize: 12 }} />}
        </button>
      </div>

      <div className="max-h-[65vh] space-y-3 overflow-y-auto px-3 py-3">
        {agentId === "opencode" ? (
          <>
            <p className="text-[11px]" style={{ color: "var(--cs-text-tertiary)" }}>{t("statusBar.opencodeUsage.accountsHint")}</p>
            {openCode?.accounts.map((account) => (
              <section key={account.provider} className="space-y-2 border-b pb-3" style={{ borderColor: "var(--cs-border-sidebar)" }}>
                <div className="text-[12px] font-medium">{providerName(account.provider)}</div>
                <QuotaDetailsContent details={account} emptyLabel={account.error ? t(`statusBar.quota.${account.error}`, { defaultValue: account.error }) : undefined} />
                {account.error && hasQuotaData(account) && <p role="status" className="text-[11px]" style={{ color: "var(--cs-warning)" }}>{t(`statusBar.quota.${account.error}`, { defaultValue: account.error })}</p>}
              </section>
            ))}
            {!openCode?.accounts.length && <p className="text-[12px]">{t(isLoading ? "statusBar.quota.loading" : "statusBar.opencodeUsage.unavailable")}</p>}
          </>
        ) : (
          <QuotaDetailsContent details={details} emptyLabel={statusError ?? (isLoading ? t("statusBar.quota.loading") : agentId === "claude" ? t("statusBar.claudeUsage.unavailable") : undefined)} />
        )}
        {agentId === "opencode" && statusError && <p role="status" className="text-[11px]" style={{ color: "var(--cs-warning)" }}>{statusError}</p>}

        {(resetCredits != null || agentId === "codex" || (statusError && hasData)) ? (
          <div
            className="space-y-1.5 border-t pt-2 text-[11px]"
            style={{ borderColor: "color-mix(in srgb, var(--cs-border-sidebar) 76%, transparent)" }}
          >
            {resetCredits != null ? (
              <CodexResetCreditList
                count={resetCredits}
                credits={resetCreditDetails?.credits ?? []}
                fallbackExpiresAt={resetCreditDetails?.nextExpiresAt ?? null}
                expanded={resetCreditsExpanded}
                onToggle={() => setResetCreditsExpanded((expanded) => !expanded)}
              />
            ) : null}

            {agentId === "codex" ? (
              <div className="flex items-center justify-between gap-3">
                <span style={{ color: "var(--cs-text-tertiary)" }}>{t("statusBar.codexUsage.account")}</span>
                <span
                  className="min-w-0 truncate text-right"
                  style={{ color: "var(--cs-text-secondary)" }}
                  title={codexLimits?.accountLabel ?? undefined}
                >
                  {codexLimits?.accountLabel ?? t("statusBar.codexUsage.systemDefault")}
                </span>
              </div>
            ) : null}

            {statusError && hasData ? (
              <div className="flex items-start gap-1.5" style={{ color: "var(--cs-text-tertiary)" }}>
                <WarningOutlined style={{ fontSize: 11, marginTop: 2 }} />
                <span className="min-w-0 max-h-[96px] flex-1 overflow-y-auto whitespace-pre-wrap break-all">
                  {statusError}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <Popover
      trigger={["click"]}
      placement="topLeft"
      content={popoverContent}
      onOpenChange={(open) => {
        if (!open) setResetCreditsExpanded(false);
      }}
      arrow={false}

      styles={{ container: { padding: 0, background: "transparent", boxShadow: "none", border: 0 } }}
      getPopupContainer={() => document.body}
    >
      <button
        type="button"
        className="flex h-7 shrink-0 items-center justify-start gap-2 rounded-[5px] px-2 text-left text-[13px] font-medium leading-none transition-colors"
        style={{
          background: "transparent",
          border: "0",
          color: hasData ? "var(--cs-text-secondary)" : "var(--cs-text-tertiary)",
          cursor: "pointer",
        }}
        title={summary}
        aria-label={summary}
      >
        <AgentIcon agentId={agentId} size={15} />
        {compactWindows.map((window) => <QuotaUsageRing key={`${window.bucketId}:${window.id}`}
          label={quotaWindowLabel(window, t, false)} descriptionLabel={quotaWindowLabel(window, t)} remaining={remainingQuota(window)} />)}
        {(stale || details.limitReached || openCode?.status === "error") && <WarningOutlined aria-label={t("statusBar.quota.attention")} style={{ color: "var(--cs-warning)", fontSize: 12 }} />}
        {compactWindows.length === 0 && <span className="truncate tabular-nums">{t(`${translationRoot}.title`)}</span>}

      </button>
    </Popover>
  );
}

function CodexUsageWindowRow({
  label,
  window,
}: {
  label: string;
  window: CodexRateLimitWindow;
}) {
  const { t } = useTranslation();
  const remaining = remainingPercent(window);
  const resetLabel = formatResetLabel(window, t);
  const barColor = codexUsageBarColor(remaining);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium" style={{ color: "var(--cs-text-primary)" }}>
          {label}
        </span>
        <span className="tabular-nums" style={{ color: "var(--cs-text-secondary)" }}>
          {t("statusBar.codexUsage.remaining", { value: remaining })}
        </span>
      </div>
      <div
        className="h-[6px] overflow-hidden rounded-full"
        style={{ background: "color-mix(in srgb, var(--cs-text-tertiary) 24%, transparent)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${remaining}%`,
            background: barColor,
            boxShadow: `0 0 5px color-mix(in srgb, ${barColor} 55%, transparent)`,
          }}
        />
      </div>
      <div className="text-[11px]" style={{ color: "var(--cs-text-tertiary)" }}>
        {resetLabel}
      </div>
    </div>
  );
}

function CodexResetCreditList({
  count,
  credits,
  fallbackExpiresAt,
  expanded,
  onToggle,
}: {
  count: number;
  credits: CodexRateLimitResetCredit[];
  fallbackExpiresAt: number | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const hasExpiryDetails = credits.length > 0 || fallbackExpiresAt != null;
  const sortedCredits = [...credits].sort((left, right) => {
    if (left.expiresAt == null) return 1;
    if (right.expiresAt == null) return -1;
    return left.expiresAt - right.expiresAt;
  });
  const formatExpiry = (expiresAt: number) => formatQuotaDateTime(expiresAt) ?? t("statusBar.codexUsage.resetUnknown");

  return (
    <div className="space-y-1">
      {hasExpiryDetails ? (
        <button
          type="button"
          aria-expanded={expanded}
          className="flex w-full items-center justify-between gap-2 rounded-sm px-1 py-0.5 text-left font-medium text-[var(--cs-text-secondary)] hover:bg-[var(--cs-bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cs-text-secondary)]"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <span>{t("statusBar.codexUsage.resetCredits", { count })}</span>
          <RightOutlined aria-hidden="true" className={`shrink-0 text-[10px] transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      ) : (
        <div className="font-medium text-[var(--cs-text-secondary)]">
          {t("statusBar.codexUsage.resetCredits", { count })}
        </div>
      )}
      <div className="app-accordion" data-open={expanded && (sortedCredits.length > 0 || fallbackExpiresAt != null) ? "true" : "false"} aria-hidden={!expanded}>
        <div className="app-accordion__inner">
          {sortedCredits.length > 0 ? (
            <div className="space-y-0.5 border-l border-[var(--cs-border-sidebar)] pl-2 text-[var(--cs-text-tertiary)]">
              {sortedCredits.map((credit, index) => (
                <div key={`${credit.expiresAt ?? "unknown"}-${index}`} className="tabular-nums">
                  {credit.expiresAt == null
                    ? t("statusBar.codexUsage.resetCreditExpiryUnknown", { index: index + 1 })
                    : t("statusBar.codexUsage.resetCreditExpiresAt", {
                      index: index + 1,
                      time: formatExpiry(credit.expiresAt),
                    })}
                </div>
              ))}
            </div>
          ) : fallbackExpiresAt != null ? (
            <div className="text-[var(--cs-text-tertiary)]">
              {t("statusBar.codexUsage.resetCreditNextExpiresAt", { time: formatExpiry(fallbackExpiresAt) })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function remainingPercent(window: CodexRateLimitWindow): number { return remainingQuota(window); }

function providerName(provider: string): string {
  return ({ "opencode-go": "OpenCode Go", opencode: "OpenCode Zen / Console", openai: "ChatGPT / Codex", anthropic: "Claude" } as Record<string, string>)[provider] ?? provider;
}

export function QuotaDetailsContent({ details, emptyLabel }: { details: UsageQuotaDetails; emptyLabel?: string }) {
  const { t } = useTranslation();
  const windows = quotaWindows(details);
  const planLabel = quotaPlanLabel(details.planType);
  return <div className="space-y-3">
    {planLabel && <div className="text-[11px]" style={{ color: "var(--cs-text-secondary)" }}>{t("statusBar.quota.plan")} · {planLabel}</div>}
    {details.limitReached && <div role="status" className="text-[11px]" style={{ color: "var(--cs-warning)" }}>{t(details.limitReached.endsWith("credits_depleted") ? "statusBar.quota.creditsDepleted" : "statusBar.quota.limitReached")}</div>}
    {windows.map((window) => <div key={window.id}>
      <CodexUsageWindowRow label={quotaWindowLabel(window, t)} window={window} />
      {(window.usedAmount != null || window.limitAmount != null) && <div className="mt-1 text-[11px]" style={{ color: "var(--cs-text-tertiary)" }}>
        {t("statusBar.quota.estimatedSpend", { used: window.usedAmount?.toLocaleString() ?? "?", limit: window.limitAmount?.toLocaleString() ?? "?", currency: window.currency ?? "" })}
      </div>}
    </div>)}
    {details.balances?.map((balance) => <div key={balance.bucketId} className="flex justify-between gap-2 text-[12px]">
      <span>{balance.bucketName ? `${balance.bucketName} · ` : ""}{t("statusBar.quota.credits")}</span>
      <span>{balance.unlimited ? t("statusBar.quota.unlimited") : balance.balance != null ? balance.balance.toLocaleString() : t(balance.hasCredits === true ? "statusBar.quota.balanceAvailable" : balance.hasCredits === false ? "statusBar.quota.noCredits" : "statusBar.quota.balanceUnknown")}</span>
    </div>)}
    {!hasQuotaData(details) && <p className="text-[12px]" style={{ color: "var(--cs-text-tertiary)" }}>
      {emptyLabel ?? t(`statusBar.quota.${details.emptyReason ?? "noQuota"}`, { defaultValue: t("statusBar.quota.noQuota") })}
    </p>}
  </div>;
}

function formatResetLabel(
  window: CodexRateLimitWindow,
  t: TFunction,
): string {
  return formatQuotaResetTime(window.resetsAt, window.resetDescription, t);
}

function formatUpdatedAt(updatedAt: number, t: TFunction): string {
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return t("statusBar.codexUsage.updatedNow");
  }
  if (minutes < 60) {
    return t("statusBar.codexUsage.updatedMinutes", { minutes });
  }
  const hours = Math.floor(minutes / 60);
  return t("statusBar.codexUsage.updatedHours", { hours });
}

function codexUsageBarColor(remaining: number): string {
  if (remaining <= 15) return "var(--cs-error)";
  if (remaining <= 35) return "var(--cs-warning)";
  return "var(--cs-success)";
}

