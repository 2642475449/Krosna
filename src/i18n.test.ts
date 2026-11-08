import { afterEach, describe, expect, it } from "vitest";
import i18n, { toI18nLanguage } from "./i18n";
import enUS from "./locales/en-US.json";
import jaJP from "./locales/ja-JP.json";
import zhCN from "./locales/zh-CN.json";

function flattenTranslationKeys(
  value: unknown,
  prefix = "",
): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    flattenTranslationKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("translation catalog parity", () => {
  it("keeps every locale on the same key set", () => {
    const expectedKeys = flattenTranslationKeys(zhCN).sort();
    for (const catalog of [enUS, jaJP]) {
      expect(flattenTranslationKeys(catalog).sort()).toEqual(expectedKeys);
    }
  });

  it.each([["zh-CN", zhCN], ["en-US", enUS], ["ja-JP", jaJP]] as const)(
    "%s usage translations contain readable text and preserve interpolation variables",
    (_locale, catalog) => {
      const variables = (value: string) => [...value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
        .map((match) => match[1]).sort();
      for (const section of ["quota", "opencodeUsage"] as const) {
        for (const key of Object.keys(enUS.statusBar[section])) {
          const value = (catalog.statusBar[section] as Record<string, string>)[key];
          const reference = (enUS.statusBar[section] as Record<string, string>)[key];
          expect(value?.trim(), `${section}.${key}`).toBeTruthy();
          expect(value, `${section}.${key}`).not.toMatch(/\?{2,}|\uFFFD/);
          expect(variables(value), `${section}.${key}`).toEqual(variables(reference));
          if (_locale !== "en-US") {
            expect(value, `${section}.${key}`).toMatch(/[\u3040-\u30ff\u3400-\u9fff]/);
          }
        }
      }
    },
  );
});

describe("Japanese translations", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("maps the application language to the Japanese locale", () => {
    expect(toI18nLanguage("ja")).toBe("ja-JP");
  });

  it("uses the Japanese resource without the English override", async () => {
    await i18n.changeLanguage("ja-JP");

    expect(i18n.t("home.overview.heroTitle")).toBe("プロジェクト概要");
    expect(i18n.t("home.overview.title")).toBe("トークン使用量ヒートマップ");
  });
});
