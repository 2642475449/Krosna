import { useTranslation } from "react-i18next";

/** 状态栏仅显示剩余额度圆环和数值，周期等含义保留在悬停提示与无障碍描述中。 */
export function QuotaUsageRing({ label, descriptionLabel = label, remaining }: { label: string; descriptionLabel?: string; remaining: number }) {
  const { t } = useTranslation();
  const value = Math.max(0, Math.min(100, Math.round(remaining)));
  const description = `${descriptionLabel} · ${t("statusBar.codexUsage.remaining", { value })}`;
  const tone = value <= 15 ? "text-[var(--cs-error)]" : value <= 35 ? "text-[var(--cs-warning)]" : "text-[var(--cs-success)]";
  return (
    <span className="app-quota-ring inline-flex shrink-0 items-center whitespace-nowrap" title={description}>
      <svg role="img" aria-label={description} viewBox="0 0 28 28" className={`app-quota-ring-svg h-7 w-7 shrink-0 ${tone}`}>
        <circle cx="14" cy="14" r="11" fill="none" stroke="var(--cs-border-sidebar)" strokeWidth="2.5" />
        <circle cx="14" cy="14" r="11" fill="none" stroke="currentColor" strokeWidth="2.5"
          className="app-quota-ring-progress"
          pathLength="100" strokeDasharray={`${value} ${100 - value}`} transform="rotate(-90 14 14)" />
        <text x="14" y="14" dy=".35em" textAnchor="middle" fill="var(--cs-text-secondary)" className="text-[9px] font-medium tabular-nums">{value}</text>
      </svg>
    </span>
  );
}
