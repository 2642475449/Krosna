import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { QuotaUsageRing } from "./QuotaUsageRing";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, options: { value: number }) => `${options.value}% remaining` }) }));

test.each([
  [0, 0, "--cs-error"], [15, 15, "--cs-error"], [35, 35, "--cs-warning"],
  [96, 96, "--cs-success"], [100, 100, "--cs-success"], [-10, 0, "--cs-error"], [120, 100, "--cs-success"],
])("remaining %s renders an accessible ring at %s", (remaining, value, tone) => {
  const markup = renderToStaticMarkup(createElement(QuotaUsageRing, { label: "5h", remaining }));
  expect(markup).toContain(`aria-label="5h · ${value}% remaining"`);
  expect(markup).toContain(`stroke-dasharray="${value} ${100 - value}"`);
  expect(markup).toContain(tone);
});

test("shows only the value while retaining the model and period in hover and accessible descriptions", () => {
  const markup = renderToStaticMarkup(createElement(QuotaUsageRing, { label: "5h", descriptionLabel: "Gemini · 5h", remaining: 96 }));
  expect(markup.replace(/<[^>]*>/g, "")).toBe("96");
  expect(markup).toContain('title="Gemini · 5h · 96% remaining"');
  expect(markup).toContain('aria-label="Gemini · 5h · 96% remaining"');
});

test("does not replace a missing period with the model name", () => {
  const markup = renderToStaticMarkup(createElement(QuotaUsageRing, { label: "", descriptionLabel: "Argon", remaining: 80 }));
  expect(markup.replace(/<[^>]*>/g, "")).toBe("80");
  expect(markup).toContain('aria-label="Argon · 80% remaining"');
});
