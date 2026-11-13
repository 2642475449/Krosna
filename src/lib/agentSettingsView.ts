import type { TFunction } from "i18next";
import { antigravityQuotaLabel, antigravityQuotaPeriodLabel } from "@/lib/antigravityQuota";
import { formatAgentVersion } from "@/lib/agents";
import { compareAgentVersion, type AgentVersionStatus } from "@/lib/agentVersions";
import { hasQuotaData, legacyQuotaDetails, quotaWindowLabel, quotaWindows, remainingQuota } from "@/lib/usageQuota";
import type { AgentCliInfo, AntigravityUsage, ClaudeRateLimits, CodexRateLimits, QoderUsage } from "@/types";
import type { AgentVersionCheck } from "@/store/slices/agentVersions";

export type AgentQuotaPayload = ClaudeRateLimits | CodexRateLimits | AntigravityUsage | QoderUsage | null;

export interface AgentQuotaRingItem {
  key: string;
  label: string;
  descriptionLabel: string;
  remaining: number;
}

export interface AgentQuotaPresentation {
  rings: AgentQuotaRingItem[];
  summaryText: string;
}

export interface AgentVersionPresentation {
  shortVersion: string | null;
  status: AgentVersionStatus | "checking" | "error";
  latestVersion: string | null;
  updatable: boolean;
}

const SEMVER_PATTERN = /(?:^|[\s(v])([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)/;

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

/** 提取用于表格定宽槽位的精简版本号（统一 `v` 前缀，如 `codex-cli 0.167.2` -> `v0.167.2`）。 */
export function formatShortAgentVersion(
  version: string | null | undefined,
  agentName: string,
): string | null {
  const normalized = formatAgentVersion(version, agentName);
  if (!normalized) return null;
  const match = normalized.match(SEMVER_PATTERN);
  if (match?.[1]) return `v${match[1]}`;
  return normalized;
}

/** 汇总表格与浮层所需的精简版本、状态与可更新目标版本。 */
export function getAgentVersionPresentation(
  agent: Pick<AgentCliInfo, "installed" | "version">,
  agentName: string,
  check?: AgentVersionCheck,
): AgentVersionPresentation {
  const shortVersion = agent.installed ? formatShortAgentVersion(agent.version, agentName) : null;
  if (!check || check.status === "checking") {
    return { shortVersion, status: "checking", latestVersion: null, updatable: false };
  }
  if (check.status === "error" || !check.latest) {
    return { shortVersion, status: "error", latestVersion: null, updatable: false };
  }
  const latestNormalized = formatShortAgentVersion(check.latest, agentName) ?? check.latest;
  const status: AgentVersionStatus = agent.installed
    ? compareAgentVersion(agent.version, check.latest)
    : "unknown";
  return {
    shortVersion,
    status,
    latestVersion: latestNormalized,
    updatable: agent.installed && status === "updateAvailable",
  };
}

/** 将各智能体的真实额度响应映射为环形进度条列表与摘要文案。 */
export function getAgentQuotaPresentation(
  agent: Pick<AgentCliInfo, "id" | "installed">,
  quota: AgentQuotaPayload,
  loading: boolean,
  t: TFunction,
): AgentQuotaPresentation {
  if (!agent.installed) {
    return { rings: [], summaryText: t("settings.agents.quota.installFirst") };
  }
  if (agent.id === "opencode" || agent.id === "pi") {
    return { rings: [], summaryText: t("settings.agents.quota.unsupported") };
  }
  if (loading && !quota) {
    return { rings: [], summaryText: t("settings.agents.quota.loading") };
  }

  if (agent.id === "antigravity") {
    const usage = quota as AntigravityUsage | null;
    if (usage?.status !== "ok" || usage.windows.length === 0) {
      return { rings: [], summaryText: t("settings.agents.quota.startSession") };
    }
    const rings = usage.windows.map((window) => ({
      key: window.id,
      label: antigravityQuotaPeriodLabel(window.window, t),
      descriptionLabel: antigravityQuotaLabel(window, t),
      remaining: clampPercent(window.remainingPercent),
    }));
    const summaryText = rings
      .map((ring) => `${ring.descriptionLabel} ${t("settings.agents.quota.remainingPercent", { value: ring.remaining })}`)
      .join(" · ");
    return { rings, summaryText };
  }

  if (agent.id === "qoder") {
    const usage = quota as QoderUsage | null;
    if (usage?.status !== "ok") {
      return { rings: [], summaryText: t("settings.agents.quota.unavailable") };
    }
    const used = usage.totalUsagePercentage ?? usage.userQuota?.percentage ?? null;
    const percent = used == null ? null : clampPercent(100 - used);
    const credits = usage.userQuota?.remaining ?? null;
    if (percent == null && credits == null) {
      return { rings: [], summaryText: t("settings.agents.quota.unavailable") };
    }
    const summaryText = credits != null
      ? t("settings.agents.quota.remainingCredits", { value: formatNumber(credits) })
      : t("settings.agents.quota.remainingPercent", { value: percent ?? 0 });
    const rings = percent == null
      ? []
      : [{
          key: "qoder",
          label: t("settings.agents.details.quota"),
          descriptionLabel: summaryText,
          remaining: percent,
        }];
    return { rings, summaryText };
  }

  const limits = quota as ClaudeRateLimits | CodexRateLimits | null;
  if (limits?.status !== "ok") {
    return {
      rings: [],
      summaryText: t(agent.id === "claude" ? "settings.agents.quota.startSession" : "settings.agents.quota.unavailable"),
    };
  }
  const details = legacyQuotaDetails(limits);
  const windows = quotaWindows(details);
  if (!hasQuotaData(details) || windows.length === 0) {
    return {
      rings: [],
      summaryText: t(agent.id === "claude" ? "settings.agents.quota.startSession" : "settings.agents.quota.unavailable"),
    };
  }
  const rings = windows.map((window) => ({
    key: `${window.bucketId}:${window.id}`,
    label: quotaWindowLabel(window, t, false),
    descriptionLabel: quotaWindowLabel(window, t),
    remaining: remainingQuota(window),
  }));
  const summaryText = rings
    .map((ring) => `${ring.descriptionLabel} · ${t("settings.agents.quota.remainingPercent", { value: ring.remaining })}`)
    .join(" · ");
  return { rings, summaryText };
}

/** 合并额度拉取结果：接口失败或返回非 ok 状态时保留原有有效缓存，避免覆盖已读出的额度。 */
export function mergeAgentQuotaResult<T extends { status: string }>(
  previous: T | null,
  settled: PromiseSettledResult<T | null>,
): T | null {
  if (settled.status !== "fulfilled") {
    return previous;
  }
  const next = settled.value;
  if (next == null) {
    return null;
  }
  if (next.status === "ok") {
    return next;
  }
  return previous?.status === "ok" ? previous : next;
}

/** 判断并发额度请求是否可直接复用，防止非强制请求吞掉后续的 forceRefresh。 */
export function shouldReuseInFlightQuotaRequest(
  inFlight: { forceRefresh: boolean } | null,
  requestedForceRefresh: boolean,
): boolean {
  if (!inFlight) return false;
  return !requestedForceRefresh || inFlight.forceRefresh;
}
