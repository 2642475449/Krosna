// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCopyFeedback } from "./useCopyFeedback";

let host: HTMLDivElement;
let root: Root;

function Harness({ resetMs }: { resetMs?: number }) {
  const { copiedKey, isCopied, markCopied } = useCopyFeedback(resetMs);
  return createElement(
    "div",
    null,
    createElement("span", { "data-testid": "state" }, `${copiedKey ?? "idle"}:${isCopied("a")}:${isCopied("b")}`),
    createElement("button", { type: "button", id: "copy-a", onClick: () => markCopied("a") }, "a"),
    createElement("button", { type: "button", id: "copy-b", onClick: () => markCopied("b") }, "b"),
  );
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
});

it("marks copied key temporarily and resets previous timer when switching keys", async () => {
  await act(async () => {
    root.render(createElement(Harness, { resetMs: 1200 }));
  });

  const readState = () => host.querySelector('[data-testid="state"]')?.textContent;
  expect(readState()).toBe("idle:false:false");

  await act(async () => {
    host.querySelector<HTMLButtonElement>("#copy-a")?.click();
  });
  expect(readState()).toBe("a:true:false");

  await act(async () => {
    vi.advanceTimersByTime(800);
    host.querySelector<HTMLButtonElement>("#copy-b")?.click();
  });
  expect(readState()).toBe("b:false:true");

  // 第一个定时器的剩余 400ms 到点时不得提前清空第二个复制态
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(readState()).toBe("b:false:true");

  await act(async () => {
    vi.advanceTimersByTime(700);
  });
  expect(readState()).toBe("idle:false:false");
});
