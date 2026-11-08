import type { TFunction } from "i18next";

/** Quota dates use local time with a stable, minute-precision display in every view. */
export function formatQuotaDateTime(value: number | string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatQuotaResetTime(
  resetsAt: number | null | undefined,
  description: string | null | undefined,
  t: TFunction,
): string {
  const time = resetsAt != null ? formatQuotaDateTime(resetsAt) : null;
  const fallback = description ? formatQuotaDateTime(description) ?? description : null;
  return time || fallback
    ? t("statusBar.codexUsage.resetsAt", { time: time ?? fallback })
    : t("statusBar.codexUsage.resetUnknown");
}
