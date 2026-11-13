// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App, ConfigProvider } from "antd/es/index.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { message, ToastHost, TOAST_NOTIFICATION_CONFIG } from "./toast";

let host: HTMLDivElement;
let root: Root;
const notices = () => document.querySelectorAll(".ant-notification-notice");

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(ConfigProvider, { theme: { token: { motion: false } } },
      createElement(App, { notification: TOAST_NOTIFICATION_CONFIG }, createElement(ToastHost))));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("keeps one notification on repeated copy feedback and resets its dismissal timer", async () => {
  await act(async () => {
    message.success("已复制启动命令");
    message.success("已复制启动命令");
    message.success("已复制启动命令");
  });
  expect(notices()).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  await act(async () => message.success("已复制启动命令"));
  expect(notices()).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(notices()).toHaveLength(1);
  await act(async () => message.success("已复制启动命令"));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(notices()).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(notices()).toHaveLength(0);
  await act(async () => message.success("已复制启动命令"));
  expect(notices()).toHaveLength(1);
});

it("keeps distinct feedback separate and can show feedback again after manual close", async () => {
  await act(async () => {
    message.success("已复制启动命令");
    message.error("已复制启动命令");
    message.success("已保存");
  });
  expect(notices()).toHaveLength(3);
  await act(async () => {
    document.querySelector<HTMLButtonElement>(".ant-notification-notice-close")?.click();
  });
  expect(notices()).toHaveLength(2);
  await act(async () => message.success("已复制启动命令"));
  expect(notices()).toHaveLength(3);
});

it("preserves explicit-key updates, persistent feedback and destroy behavior", async () => {
  await act(async () => message.info({ key: "task", content: "处理中", duration: 0 }));
  await act(async () => message.success({ key: "task", content: "处理完成", duration: 0 }));
  expect(notices()).toHaveLength(1);
  expect(notices()[0].textContent).toContain("处理完成");
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(notices()).toHaveLength(1);
  await act(async () => message.destroy("task"));
  expect(notices()).toHaveLength(0);
  await act(async () => message.info({ key: "task", content: "处理中", duration: 0 }));
  expect(notices()).toHaveLength(1);
  await act(async () => message.destroy());
  expect(notices()).toHaveLength(0);
});
