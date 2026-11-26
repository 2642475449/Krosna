import type { TFunction } from "i18next";

/** 早于 2000-01-01 UTC 的时间视为未初始化占位值（如 Protobuf 默认 1970-01-01T00:00:00Z 或 0001-01-01）。 */
const MIN_VALID_QUOTA_TIMESTAMP_MS = Date.UTC(2000, 0, 1);

function parseQuotaTimestampMs(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Quota dates use local time with a stable, minute-precision display in every view. */
export function formatQuotaDateTime(value: number | string): string | null {
  const ms = parseQuotaTimestampMs(value);
  if (ms == null || ms < MIN_VALID_QUOTA_TIMESTAMP_MS) return null;
  const date = new Date(ms);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatQuotaResetTime(
  resetsAt: number | null | undefined,
  description: string | null | undefined,
  t: TFunction,
): string {
  const time = resetsAt != null ? formatQuotaDateTime(resetsAt) : null;
  if (time) {
    return t("statusBar.codexUsage.resetsAt", { time });
  }
  const trimmedDescription = description?.trim() ?? "";
  if (trimmedDescription) {
    const parsedMs = parseQuotaTimestampMs(trimmedDescription);
    if (parsedMs != null) {
      const formatted = formatQuotaDateTime(parsedMs);
      if (formatted) {
        return t("statusBar.codexUsage.resetsAt", { time: formatted });
      }
      // 可解析但属于 epoch-0 / 占位时间戳时，回退为未知而非原样展示原始 ISO 字符串。
      return t("statusBar.codexUsage.resetUnknown");
    }
    return t("statusBar.codexUsage.resetsAt", { time: trimmedDescription });
  }
  return t("statusBar.codexUsage.resetUnknown");
}
