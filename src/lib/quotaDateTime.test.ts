import { createInstance } from "i18next";
import { expect, test } from "vitest";
import en from "@/locales/en-US.json";
import zh from "@/locales/zh-CN.json";
import ja from "@/locales/ja-JP.json";
import { formatQuotaDateTime, formatQuotaResetTime } from "./quotaDateTime";

test("numeric and ISO quota dates share local, padded, minute-precision formatting", () => {
  const date = new Date(2026, 10, 7, 4, 8, 45);
  expect(formatQuotaDateTime(date.getTime())).toBe("2026-11-07 04:08");
  expect(formatQuotaDateTime(date.toISOString())).toBe("2026-11-07 04:08");
  expect(formatQuotaDateTime(new Date(2027, 0, 1, 0, 0).getTime())).toBe("2027-01-01 00:00");
  expect(formatQuotaDateTime("invalid")).toBeNull();
});

test("all locales preserve the same date format, timestamp precedence and unknown fallback", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en }, zh: { translation: zh }, ja: { translation: ja } } });
  const timestamp = new Date(2026, 10, 7, 4, 8).getTime();
  for (const locale of ["en", "zh", "ja"]) {
    await i18n.changeLanguage(locale);
    expect(formatQuotaResetTime(timestamp, "provider description", i18n.t)).toContain("2026-11-07 04:08");
    expect(formatQuotaResetTime(null, new Date(timestamp).toISOString(), i18n.t)).toContain("2026-11-07 04:08");
    expect(formatQuotaResetTime(null, null, i18n.t)).toBe(i18n.t("statusBar.codexUsage.resetUnknown"));
    expect(formatQuotaResetTime(null, "provider description", i18n.t)).toContain("provider description");
  }
});

test("epoch-zero, pre-2000 sentinel timestamps, and blank descriptions fall back to resetUnknown", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh", resources: { zh: { translation: zh } } });
  const unknown = i18n.t("statusBar.codexUsage.resetUnknown");

  for (const invalid of [
    0,
    -1,
    Number.NaN,
    "",
    "   ",
    "0",
    "1970-01-01T00:00:00Z",
    "1970-01-01T00:00:00.000Z",
    "1970-01-01T00:00:00-08:00",
    "0001-01-01T00:00:00Z",
  ]) {
    expect(formatQuotaDateTime(invalid)).toBeNull();
  }

  expect(formatQuotaResetTime(0, null, i18n.t)).toBe(unknown);
  expect(formatQuotaResetTime(null, "1970-01-01T00:00:00Z", i18n.t)).toBe(unknown);
  expect(formatQuotaResetTime(null, "1970-01-01T00:00:00.000Z", i18n.t)).toBe(unknown);
  expect(formatQuotaResetTime(null, "0001-01-01T00:00:00Z", i18n.t)).toBe(unknown);
  expect(formatQuotaResetTime(null, "0", i18n.t)).toBe(unknown);
  expect(formatQuotaResetTime(null, "   ", i18n.t)).toBe(unknown);
  expect(formatQuotaResetTime(0, "2026-11-26T20:04:00Z", i18n.t)).not.toBe(unknown);
});
