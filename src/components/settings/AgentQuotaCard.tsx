import { LoadingOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { AgentIcon } from "@/components/AgentIcon";
import { QuotaDetailsContent } from "@/components/layout/QuotaUsageStatus";
import { AGENT_DEFINITIONS } from "@/lib/agents";
import { antigravityQuotaLabel } from "@/lib/antigravityQuota";
import { formatQuotaResetTime } from "@/lib/quotaDateTime";
import type { AgentQuotaPayload } from "@/lib/agentSettingsView";
import { legacyQuotaDetails } from "@/lib/usageQuota";
import type {
  AiAgentId,
  AntigravityQuotaWindow,
  AntigravityUsage,
  ClaudeRateLimits,
  CodexRateLimits,
  QoderQuotaBucket,
  QoderUsage,
} from "@/types";

interface AgentQuotaCardProps {
  agentId: AiAgentId;
  quota: AgentQuotaPayload;
  loading: boolean;
  onRefresh: () => void;
}

/** 展示已读取到可用额度的智能体明细卡片（复用状态栏一致的数据结构与主题配色）。 */
export function AgentQuotaCard({ agentId, quota, loading, onRefresh }: AgentQuotaCardProps) {
  const { t, i18n } = useTranslation();
  const definition = AGENT_DEFINITIONS[agentId];
  const updatedAt = quota?.updatedAt ?? 0;
  const statusError = quota?.error ?? null;

  return (
    <div className="app-overlay-surface w-[332px] max-w-[calc(100vw-24px)] overflow-hidden">
      <div className="app-agent-quota-card-head">
        <div className="flex min-w-0 items-center gap-2">
          <AgentIcon agentId={agentId} size={15} />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-[var(--cs-text-primary)]">
              {definition.displayName} · {t("settings.agents.details.quota")}
            </div>
            <div className="text-[10px] text-[var(--cs-text-tertiary)]">
              {updatedAt > 0 ? formatUpdatedAt(updatedAt, t) : t("settings.agents.quota.loading")}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="app-agent-quota-card-refresh"
          disabled={loading}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRefresh();
          }}
        >
          {loading ? <LoadingOutlined className="text-xs" /> : <ReloadOutlined className="text-xs" />}
        </button>
      </div>

      <div className="max-h-[60vh] space-y-3 overflow-y-auto px-3 py-3">
        {agentId === "antigravity" ? (
          <AntigravityQuotaCardBody usage={quota as AntigravityUsage | null} />
        ) : agentId === "qoder" ? (
          <QoderQuotaCardBody usage={quota as QoderUsage | null} language={i18n.language} />
        ) : (
          <LegacyQuotaCardBody agentId={agentId} limits={quota as ClaudeRateLimits | CodexRateLimits | null} />
        )}

        {statusError ? (
          <div className="flex items-start gap-1.5 border-t border-[var(--cs-overlay-divider)] pt-2 text-[11px] text-[var(--cs-text-tertiary)]">
            <WarningOutlined className="mt-0.5 shrink-0 text-[11px]" />
            <span className="min-w-0 flex-1 break-words">{statusError}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LegacyQuotaCardBody({
  agentId,
  limits,
}: {
  agentId: AiAgentId;
  limits: ClaudeRateLimits | CodexRateLimits | null;
}) {
  const { t } = useTranslation();
  const details = legacyQuotaDetails(limits);
  const codexLimits = agentId === "codex" ? (limits as CodexRateLimits | null) : null;
  const resetCredits = codexLimits?.rateLimitResetCredits?.availableCount;

  return (
    <>
      <QuotaDetailsContent details={details} emptyLabel={t("settings.agents.quota.unavailable")} />
      {(resetCredits != null || agentId === "codex") && (
        <div className="space-y-1.5 border-t border-[var(--cs-overlay-divider)] pt-2 text-[11px]">
          {resetCredits != null && (
            <div className="font-medium text-[var(--cs-text-secondary)]">
              {t("statusBar.codexUsage.resetCredits", { count: resetCredits })}
            </div>
          )}
          {agentId === "codex" && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--cs-text-tertiary)]">{t("statusBar.codexUsage.account")}</span>
              <span
                className="min-w-0 truncate text-right text-[var(--cs-text-secondary)]"
                title={codexLimits?.accountLabel ?? undefined}
              >
                {codexLimits?.accountLabel ?? t("statusBar.codexUsage.systemDefault")}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function AntigravityQuotaCardBody({ usage }: { usage: AntigravityUsage | null }) {
  const { t } = useTranslation();
  const windows = usage?.windows ?? [];
  if (windows.length === 0) {
    return <p className="m-0 text-xs text-[var(--cs-text-tertiary)]">{t("settings.agents.quota.unavailable")}</p>;
  }

  return (
    <div className="space-y-3">
      {windows.map((window) => (
        <AntigravityQuotaBar key={window.id} window={window} />
      ))}
    </div>
  );
}

function AntigravityQuotaBar({ window }: { window: AntigravityQuotaWindow }) {
  const { t } = useTranslation();
  const remaining = Math.max(0, Math.min(100, Math.round(window.remainingPercent)));
  const resetLabel = formatQuotaResetTime(null, window.resetDescription, t);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium text-[var(--cs-text-primary)]">{antigravityQuotaLabel(window, t)}</span>
        <span className="tabular-nums text-[var(--cs-text-secondary)]">
          {t("statusBar.codexUsage.remaining", { value: remaining })}
        </span>
      </div>
      <progress
        className={`app-agent-quota-progress ${barToneClass(remaining)}`}
        max={100}
        value={remaining}
        aria-hidden="true"
      />
      <div className="text-[11px] text-[var(--cs-text-tertiary)]">{resetLabel}</div>
    </div>
  );
}

function QoderQuotaCardBody({ usage, language }: { usage: QoderUsage | null; language: string }) {
  const { t } = useTranslation();
  const hasBuckets = Boolean(usage?.userQuota || usage?.addOnQuota || usage?.orgResourcePackage);
  const hasMeta = Boolean(usage?.userType || usage?.accountLabel || usage?.expiresAt);

  if (!hasBuckets && !hasMeta) {
    return <p className="m-0 text-xs text-[var(--cs-text-tertiary)]">{t("settings.agents.quota.unavailable")}</p>;
  }

  return (
    <>
      {hasBuckets ? (
        <>
          {usage?.userQuota ? (
            <QoderQuotaBar label={t("statusBar.qoderUsage.planCredits")} quota={usage.userQuota} />
          ) : null}
          {usage?.addOnQuota ? (
            <QoderQuotaBar label={t("statusBar.qoderUsage.addOnCredits")} quota={usage.addOnQuota} />
          ) : null}
          {usage?.orgResourcePackage ? (
            <QoderQuotaBar label={t("statusBar.qoderUsage.orgCredits")} quota={usage.orgResourcePackage} />
          ) : null}
        </>
      ) : (
        <p className="m-0 text-xs text-[var(--cs-text-tertiary)]">{t("settings.agents.quota.unavailable")}</p>
      )}

      {hasMeta && (
        <div className="space-y-1 border-t border-[var(--cs-overlay-divider)] pt-2 text-[11px]">
          <MetaRow label={t("statusBar.qoderUsage.plan")} value={usage?.userType ?? "—"} />
          <MetaRow label={t("statusBar.qoderUsage.account")} value={usage?.accountLabel ?? "—"} />
          {usage?.expiresAt ? (
            <MetaRow
              label={t("statusBar.qoderUsage.expiresAt")}
              value={new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(usage.expiresAt)}
            />
          ) : null}
        </div>
      )}
    </>
  );
}

function QoderQuotaBar({ label, quota }: { label: string; quota: QoderQuotaBucket }) {
  const { t } = useTranslation();
  const total = quota.total ?? quota.cap;
  const percentage = quota.percentage ?? (total && quota.used != null ? (quota.used / total) * 100 : null);
  const remaining = percentage == null ? null : Math.max(0, Math.min(100, Math.round(100 - percentage)));
  const detail = quota.used != null && total != null
    ? t("statusBar.qoderUsage.usedTotal", { used: formatCreditValue(quota.used), total: formatCreditValue(total) })
    : quota.remaining != null
      ? t("statusBar.qoderUsage.remainingCredits", { value: formatCreditValue(quota.remaining) })
      : "—";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="font-medium text-[var(--cs-text-primary)]">{label}</span>
        <span className="tabular-nums text-[var(--cs-text-secondary)]">{detail}</span>
      </div>
      <progress
        className={`app-agent-quota-progress ${barToneClass(remaining ?? 0)}`}
        max={100}
        value={remaining ?? 0}
        aria-hidden="true"
      />
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--cs-text-tertiary)]">{label}</span>
      <span className="min-w-0 truncate text-right text-[var(--cs-text-secondary)]" title={value}>
        {value}
      </span>
    </div>
  );
}

function barToneClass(remaining: number): string {
  if (remaining <= 15) return "is-error";
  if (remaining <= 35) return "is-warning";
  return "is-success";
}

function formatCreditValue(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatUpdatedAt(updatedAt: number, t: TFunction): string {
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t("statusBar.codexUsage.updatedNow");
  if (minutes < 60) return t("statusBar.codexUsage.updatedMinutes", { minutes });
  return t("statusBar.codexUsage.updatedHours", { hours: Math.floor(minutes / 60) });
}
