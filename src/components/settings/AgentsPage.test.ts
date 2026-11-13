// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  AgentCliInfo,
  AgentPermissionDefaults,
  AntigravityUsage,
  ClaudeRateLimits,
  CodexRateLimits,
  QoderUsage,
} from "@/types";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mocks = vi.hoisted(() => ({
  inspectAgentClis: vi.fn<() => Promise<AgentCliInfo[]>>(),
  getClaudeRateLimits: vi.fn<(options?: { forceRefresh?: boolean }) => Promise<ClaudeRateLimits>>(),
  getCodexRateLimits: vi.fn<(options?: { forceRefresh?: boolean }) => Promise<CodexRateLimits>>(),
  getAntigravityUsage: vi.fn<(options?: { forceRefresh?: boolean }) => Promise<AntigravityUsage>>(),
  getQoderUsage: vi.fn<(options?: { forceRefresh?: boolean }) => Promise<QoderUsage>>(),
  checkAgentLatestVersion: vi.fn<() => Promise<string>>(),
  ensureAgentStatusHook: vi.fn(),
  msgSuccess: vi.fn(),
  msgError: vi.fn(),
  storeState: {
    defaultAgentId: "claude" as const,
    setDefaultAgentId: vi.fn(),
    agentPermissionDefaults: {} as AgentPermissionDefaults,
    setAllAgentPermissionDefaults: vi.fn(),
    setAgentPermissionDefaults: vi.fn(),
    sessions: [] as unknown[],
    activeSessionId: null as string | null,
  },
}));

vi.mock("react-i18next", async () => {
  const { createInstance } = await import("i18next");
  const en = (await import("@/locales/en-US.json")).default;
  const zh = (await import("@/locales/zh-CN.json")).default;
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: zh }, "en-US": { translation: en } },
  });
  return { useTranslation: () => ({ t: i18n.t, i18n }) };
});

vi.mock("antd", () => ({
  Button: ({
    children,
    icon,
    onClick,
    disabled,
    className,
    type: _type,
    size: _size,
    loading: _loading,
    ...rest
  }: {
    children?: ReactNode;
    icon?: ReactNode;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    className?: string;
    type?: string;
    size?: string;
    loading?: boolean;
    [key: string]: unknown;
  }) => createElement("button", { type: "button", className, disabled, onClick, ...rest }, icon, children),
  Popover: ({ children }: { children?: ReactNode }) => createElement("div", { className: "mock-popover" }, children),
  Select: ({
    value,
    options = [],
    onChange,
    className,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    options?: Array<{ value: string; label?: ReactNode }>;
    onChange?: (val: string) => void;
    className?: string;
    "aria-label"?: string;
  }) =>
    createElement(
      "select",
      {
        className,
        "aria-label": ariaLabel,
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange?.(event.target.value),
      },
      options.map((opt) =>
        createElement("option", { key: opt.value, value: opt.value }, String(opt.value)),
      ),
    ),
  Spin: () => null,
  Switch: ({
    checked,
    onChange,
    className,
    "aria-label": ariaLabel,
  }: {
    checked?: boolean;
    onChange?: (val: boolean) => void;
    className?: string;
    "aria-label"?: string;
  }) =>
    createElement("input", {
      type: "checkbox",
      className,
      "aria-label": ariaLabel,
      checked: Boolean(checked),
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.checked),
    }),
  Tag: ({ children }: { children?: ReactNode }) => createElement("span", null, children),
  message: { success: mocks.msgSuccess, error: mocks.msgError, warning: vi.fn() },
}));

vi.mock("@/lib/api", () => ({
  inspectAgentClis: mocks.inspectAgentClis,
  getClaudeRateLimits: mocks.getClaudeRateLimits,
  getCodexRateLimits: mocks.getCodexRateLimits,
  getAntigravityUsage: mocks.getAntigravityUsage,
  getQoderUsage: mocks.getQoderUsage,
  checkAgentLatestVersion: mocks.checkAgentLatestVersion,
  ensureAgentStatusHook: mocks.ensureAgentStatusHook,
}));

vi.mock("@/store", () => ({
  useAppStore: <T,>(selector: (state: typeof mocks.storeState) => T): T => selector(mocks.storeState),
}));

import { AgentsPage } from "./AgentsPage";

let host: HTMLDivElement;
let root: Root;

const DEFAULT_INSPECTIONS: AgentCliInfo[] = [
  { id: "claude", name: "Claude Code", command: "claude", installed: true, version: "2.1.312", executablePath: "C:\\bin\\claude.exe", checkedAt: 100, error: null },
  { id: "codex", name: "Codex", command: "codex", installed: true, version: "codex-cli 0.167.2", executablePath: "C:\\bin\\codex.exe", checkedAt: 100, error: null },
  { id: "qoder", name: "Qoder CLI", command: "qodercli", installed: false, version: null, executablePath: null, checkedAt: 100, error: null },
];

async function flushMicrotasks(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();

  mocks.inspectAgentClis.mockResolvedValue(DEFAULT_INSPECTIONS);
  mocks.checkAgentLatestVersion.mockResolvedValue("2.1.312");
  mocks.ensureAgentStatusHook.mockResolvedValue({ agent: "codex", configured: false, configPath: null, detail: null });
  mocks.getClaudeRateLimits.mockResolvedValue({
    status: "unavailable",
    updatedAt: 10,
    error: null,
    session: null,
    weekly: null,
  });
  mocks.getCodexRateLimits.mockResolvedValue({
    status: "ok",
    updatedAt: 10,
    error: null,
    accountLabel: "user@example.com",
    accountId: null,
    session: { usedPercent: 10, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: { usedPercent: 25, windowMinutes: 10080, resetsAt: null, resetDescription: null },
  });
  mocks.getAntigravityUsage.mockResolvedValue({ status: "unavailable", updatedAt: 10, error: null, windows: [] });
  mocks.getQoderUsage.mockResolvedValue({
    status: "unavailable",
    updatedAt: 10,
    error: null,
    userType: null,
    accountLabel: null,
    totalUsagePercentage: null,
    expiresAt: null,
    userQuota: null,
    addOnQuota: null,
    orgResourcePackage: null,
    isQuotaExceeded: null,
    sessionCredits: null,
  });

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

it("manages trigger ARIA attributes, portal popover mounting, Select-open Escape guard, and focus restoration", async () => {
  await act(async () => {
    root.render(createElement(AgentsPage));
  });
  await flushMicrotasks();

  const claudeNameBtn = Array.from(host.querySelectorAll<HTMLButtonElement>(".app-agent-name-btn"))
    .find((btn) => btn.getAttribute("aria-controls") === "app-agent-popover-claude");
  expect(claudeNameBtn).toBeTruthy();
  expect(claudeNameBtn?.getAttribute("aria-expanded")).toBe("false");

  const claudeActionBtns = Array.from(
    host.querySelectorAll<HTMLButtonElement>('[aria-controls="app-agent-popover-claude"]'),
  );
  expect(claudeActionBtns.length).toBeGreaterThanOrEqual(2);
  for (const btn of claudeActionBtns) {
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  }

  // 点击名称触发按钮，浮层应挂载至 document.body，而非受限行容器内
  await act(async () => {
    claudeNameBtn?.click();
  });

  const popover = document.body.querySelector<HTMLElement>("#app-agent-popover-claude[role='dialog']");
  expect(popover).not.toBeNull();
  expect(host.contains(popover)).toBe(false);
  expect(popover?.classList.contains("app-ledger-popover")).toBe(true);
  for (const btn of claudeActionBtns) {
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  }

  // 当 AntD Select 下拉处于展开态（.ant-select-open）时按 Escape，不应直接关掉整张浮层
  const fakeOpenSelect = document.createElement("div");
  fakeOpenSelect.className = "ant-select-open";
  popover?.append(fakeOpenSelect);

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(document.body.querySelector("#app-agent-popover-claude")).not.toBeNull();

  // 收起 Select 后按 Escape，应关闭浮层并把焦点恢复到触发按钮
  fakeOpenSelect.remove();
  const rafCallbacks: FrameRequestCallback[] = [];
  const origRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  }) as typeof window.requestAnimationFrame;

  try {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.body.querySelector("#app-agent-popover-claude")).toBeNull();
    expect(claudeNameBtn?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      for (const cb of rafCallbacks) cb(0);
    });
    expect(document.activeElement).toBe(claudeNameBtn);
  } finally {
    window.requestAnimationFrame = origRaf;
  }
});

it("runs forceRefresh alongside an in-flight passive refresh and preserves ok quota cache on unavailable fetches", async () => {
  const passiveCodex = createDeferred<CodexRateLimits>();
  const forcedCodex = createDeferred<CodexRateLimits>();
  let codexCalls = 0;
  mocks.getCodexRateLimits.mockImplementation((options?: { forceRefresh?: boolean }) => {
    codexCalls += 1;
    if (codexCalls === 1) return passiveCodex.promise;
    if (options?.forceRefresh) return forcedCodex.promise;
    return Promise.resolve({
      status: "unavailable",
      updatedAt: 999,
      error: "transient timeout",
      accountLabel: null,
      accountId: null,
      session: null,
      weekly: null,
    });
  });

  await act(async () => {
    root.render(createElement(AgentsPage));
  });
  await flushMicrotasks();
  expect(codexCalls).toBe(1);

  // 被动刷新尚未返回时用户手动点击刷新，不得被并发去重吞掉
  const refreshBtn = host.querySelector<HTMLButtonElement>(".app-settings-page-header__actions button");
  expect(refreshBtn).toBeTruthy();

  await act(async () => {
    refreshBtn?.click();
  });
  expect(codexCalls).toBe(2);
  expect(mocks.getCodexRateLimits).toHaveBeenLastCalledWith({ forceRefresh: true });

  // 先完成较早的被动请求，再完成强制刷新请求，最终保留有效额度
  passiveCodex.resolve({
    status: "unavailable",
    updatedAt: 100,
    error: "stale",
    accountLabel: null,
    accountId: null,
    session: null,
    weekly: null,
  });
  forcedCodex.resolve({
    status: "ok",
    updatedAt: 200,
    error: null,
    accountLabel: "fresh@example.com",
    accountId: null,
    session: { usedPercent: 20, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: { usedPercent: 40, windowMinutes: 10080, resetsAt: null, resetDescription: null },
  });
  await flushMicrotasks();

  const codexRow = Array.from(host.querySelectorAll<HTMLElement>(".app-agent-row")).find((row) =>
    row.textContent?.includes("Codex"),
  );
  expect(codexRow?.querySelectorAll(".app-quota-ring").length).toBe(2);
  expect(mocks.msgSuccess).toHaveBeenCalledTimes(1);

  // 后续刷新若返回 unavailable，不应覆盖掉先前成功缓存的 Codex 额度环
  mocks.getCodexRateLimits.mockResolvedValueOnce({
    status: "unavailable",
    updatedAt: 300,
    error: "network glitch",
    accountLabel: null,
    accountId: null,
    session: null,
    weekly: null,
  });

  await act(async () => {
    refreshBtn?.click();
  });
  await flushMicrotasks();

  expect(codexRow?.querySelectorAll(".app-quota-ring").length).toBe(2);
});
