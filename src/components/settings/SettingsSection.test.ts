// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { SettingsDisclosure } from "./SettingsSection";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
});

it("toggles disclosure accordion open state and aria-expanded cleanly", async () => {
  await act(async () => {
    root.render(
      createElement(SettingsDisclosure, {
        title: "高级选项",
        children: createElement("p", null, "明细内容"),
      }),
    );
  });

  const trigger = host.querySelector<HTMLButtonElement>(".app-settings-disclosure__trigger");
  const panel = host.querySelector<HTMLElement>(".app-accordion");
  expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  expect(panel?.dataset.open).toBe("false");
  expect(panel?.getAttribute("aria-hidden")).toBe("true");

  await act(async () => {
    trigger?.click();
  });

  expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  expect(panel?.dataset.open).toBe("true");
  expect(panel?.getAttribute("aria-hidden")).toBe("false");
});
