// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GitCommitMessageProfile } from "@/types";
import { createDefaultGitCommitMessageProfiles } from "@/lib/gitCommitMessageProfiles";

const mocks = vi.hoisted(() => ({
  msgSuccess: vi.fn(),
  msgError: vi.fn(),
  setGitAutoFetch: vi.fn(),
  setGitCommitMessageProfiles: vi.fn<(profiles: GitCommitMessageProfile[], defaultId: string) => void>(),
  storeState: {
    gitAutoFetch: true,
    gitAutoFetchIntervalMinutes: 5,
    setGitAutoFetch: vi.fn(),
    gitCommitMessageProfiles: [] as GitCommitMessageProfile[],
    defaultGitCommitMessageProfileId: "balanced",
    setGitCommitMessageProfiles: vi.fn(),
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

vi.mock("antd", () => {
  const InputComponent = ({
    value,
    onChange,
    maxLength,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    maxLength?: number;
    placeholder?: string;
    "aria-label"?: string;
  }) =>
    createElement("input", {
      type: "text",
      value: value ?? "",
      maxLength,
      placeholder,
      "aria-label": ariaLabel,
      onChange,
    });

  const TextArea = ({
    value,
    onChange,
    rows,
    maxLength,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
    rows?: number;
    maxLength?: number;
    placeholder?: string;
    "aria-label"?: string;
  }) =>
    createElement("textarea", {
      value: value ?? "",
      rows,
      maxLength,
      placeholder,
      "aria-label": ariaLabel,
      onChange,
    });

  return {
    Button: ({
      children,
      icon,
      onClick,
      disabled,
      className,
      danger: _danger,
      type: _type,
      size: _size,
      ...rest
    }: {
      children?: ReactNode;
      icon?: ReactNode;
      onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
      disabled?: boolean;
      className?: string;
      danger?: boolean;
      type?: string;
      size?: string;
      [key: string]: unknown;
    }) => createElement("button", { type: "button", className, disabled, onClick, ...rest }, icon, children),
    Input: Object.assign(InputComponent, { TextArea }),
    Modal: ({
      open,
      title,
      okText,
      cancelText,
      onOk,
      onCancel,
      children,
    }: {
      open?: boolean;
      title?: ReactNode;
      okText?: ReactNode;
      cancelText?: ReactNode;
      onOk?: () => void;
      onCancel?: () => void;
      children?: ReactNode;
    }) =>
      open
        ? createElement(
            "div",
            { className: "ant-modal-root" },
            createElement(
              "div",
              { className: "ant-modal-wrap", role: "dialog" },
              createElement("div", { className: "ant-modal-title" }, title),
              createElement("div", { className: "ant-modal-body" }, children),
              createElement(
                "div",
                { className: "ant-modal-footer" },
                createElement("button", { type: "button", className: "mock-modal-cancel", onClick: onCancel }, cancelText),
                createElement("button", { type: "button", className: "mock-modal-ok", onClick: onOk }, okText),
              ),
            ),
          )
        : null,
    Select: ({
      value,
      options = [],
      onChange,
      className,
      disabled,
      "aria-label": ariaLabel,
    }: {
      value?: string | number;
      options?: Array<{ value: string | number; label?: ReactNode }>;
      onChange?: (val: string | number) => void;
      className?: string;
      disabled?: boolean;
      "aria-label"?: string;
    }) =>
      createElement(
        "select",
        {
          className,
          disabled,
          "aria-label": ariaLabel,
          value: String(value ?? ""),
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
            const raw = event.target.value;
            const matched = options.find((opt) => String(opt.value) === raw);
            onChange?.(matched ? matched.value : raw);
          },
        },
        options.map((opt) =>
          createElement("option", { key: String(opt.value), value: String(opt.value) }, String(opt.label ?? opt.value)),
        ),
      ),
    Switch: ({
      checked,
      onChange,
      "aria-label": ariaLabel,
    }: {
      checked?: boolean;
      onChange?: (val: boolean) => void;
      "aria-label"?: string;
    }) =>
      createElement("input", {
        type: "checkbox",
        "aria-label": ariaLabel,
        checked: Boolean(checked),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.checked),
      }),
    Tooltip: ({ children }: { children?: ReactNode }) => children,
    message: { success: mocks.msgSuccess, error: mocks.msgError, warning: vi.fn() },
  };
});

vi.mock("@/store", () => ({
  useAppStore: <T,>(selector: (state: typeof mocks.storeState) => T): T => selector(mocks.storeState),
}));

import { GitSettingsPage } from "./GitSettingsPage";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();

  mocks.setGitCommitMessageProfiles.mockImplementation((profiles, defaultId) => {
    mocks.storeState.gitCommitMessageProfiles = profiles;
    mocks.storeState.defaultGitCommitMessageProfileId = defaultId;
  });
  mocks.storeState.gitAutoFetch = true;
  mocks.storeState.gitAutoFetchIntervalMinutes = 5;
  mocks.storeState.setGitAutoFetch = mocks.setGitAutoFetch;
  mocks.storeState.gitCommitMessageProfiles = [
    ...createDefaultGitCommitMessageProfiles(),
    {
      id: "custom-long",
      name: "A".repeat(80),
      instructions: "自定义提交规则指令",
    },
  ];
  mocks.storeState.defaultGitCommitMessageProfileId = "balanced";
  mocks.storeState.setGitCommitMessageProfiles = mocks.setGitCommitMessageProfiles;

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

it("avoids cross-page agent class coupling and edits/saves a profile through the portal popover", async () => {
  await act(async () => {
    root.render(createElement(GitSettingsPage));
  });

  // 确认已解除对 .app-agent-* 样式类的跨页耦合
  expect(host.querySelector('[class*="app-agent-"]')).toBeNull();
  expect(host.querySelector(".app-ledger-prefs.app-git-prefs")).not.toBeNull();
  expect(host.querySelector(".app-ledger-default-pill")).not.toBeNull();
  expect(host.querySelector(".app-ledger-footnote")).not.toBeNull();

  const conciseTriggers = Array.from(
    host.querySelectorAll<HTMLButtonElement>('[aria-controls="app-git-popover-concise"]'),
  );
  expect(conciseTriggers).toHaveLength(2);
  for (const btn of conciseTriggers) {
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  }

  await act(async () => {
    conciseTriggers[0]?.click();
  });

  const popover = document.body.querySelector<HTMLElement>("#app-git-popover-concise[role='dialog']");
  expect(popover).not.toBeNull();
  expect(host.contains(popover)).toBe(false);
  for (const btn of conciseTriggers) {
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  }

  const textarea = popover?.querySelector("textarea");
  expect(textarea).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(textarea, "只输出一行中文摘要标题");
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    textarea?.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const saveBtn = Array.from(popover?.querySelectorAll<HTMLButtonElement>(".app-git-popover-foot button") ?? []).find(
    (btn) => btn.textContent?.trim() === "保存",
  );
  expect(saveBtn).toBeTruthy();

  await act(async () => {
    saveBtn?.click();
  });

  expect(mocks.setGitCommitMessageProfiles).toHaveBeenCalledTimes(1);
  const updated = mocks.storeState.gitCommitMessageProfiles.find((p) => p.id === "concise");
  expect(updated?.instructions).toBe("只输出一行中文摘要标题");
  expect(document.body.querySelector("#app-git-popover-concise")).toBeNull();
});

it("keeps the edit popover open on Escape and Modal clicks while delete Modal is open", async () => {
  await act(async () => {
    root.render(createElement(GitSettingsPage));
  });

  const customEditBtn = host.querySelector<HTMLButtonElement>(
    '.app-git-action-edit[aria-controls="app-git-popover-custom-long"]',
  );
  expect(customEditBtn).toBeTruthy();

  await act(async () => {
    customEditBtn?.click();
  });
  expect(document.body.querySelector("#app-git-popover-custom-long")).not.toBeNull();

  // 打开删除确认 Modal（从账本行删除按钮触发）
  const customRow = customEditBtn?.closest(".app-git-row");
  const deleteRowBtn = customRow?.querySelector<HTMLButtonElement>(".app-git-action-delete");
  expect(deleteRowBtn?.disabled).toBe(false);

  await act(async () => {
    deleteRowBtn?.click();
  });

  const modalWrap = host.querySelector<HTMLElement>(".ant-modal-wrap");
  expect(modalWrap).not.toBeNull();

  // Modal 打开期间按 Escape 或点击 Modal 内部，不得误关闭底层编辑浮层
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    modalWrap?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });

  expect(document.body.querySelector("#app-git-popover-custom-long")).not.toBeNull();

  // 点击取消关闭 Modal（文本来自 common.cancel 翻译键，不再硬编码 fallback）
  const cancelBtn = modalWrap?.querySelector<HTMLButtonElement>(".mock-modal-cancel");
  expect(cancelBtn?.textContent).toBe("取消");
  await act(async () => {
    cancelBtn?.click();
  });
  expect(host.querySelector(".ant-modal-wrap")).toBeNull();
  expect(document.body.querySelector("#app-git-popover-custom-long")).not.toBeNull();
});

it("clones an 80-char profile with unique bounded name and focuses the cloned portal popover", async () => {
  await act(async () => {
    root.render(createElement(GitSettingsPage));
  });

  const customTrigger = host.querySelector<HTMLButtonElement>(
    '.app-git-name-btn[aria-controls="app-git-popover-custom-long"]',
  );
  await act(async () => {
    customTrigger?.click();
  });

  const popover = document.body.querySelector<HTMLElement>("#app-git-popover-custom-long");
  const cloneBtn = Array.from(popover?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((btn) =>
    btn.textContent?.includes("克隆"),
  );
  expect(cloneBtn).toBeTruthy();

  await act(async () => {
    cloneBtn?.click();
  });

  // 重新渲染以同步模拟 store 中新增的克隆项
  await act(async () => {
    root.render(createElement(GitSettingsPage));
  });

  expect(mocks.storeState.gitCommitMessageProfiles).toHaveLength(5);
  const cloned = mocks.storeState.gitCommitMessageProfiles[4];
  expect(cloned.name).not.toBe("A".repeat(80));
  expect(cloned.name.length).toBeLessThanOrEqual(80);
  expect(cloned.name).toContain("副本");
  expect(document.body.querySelector(`#app-git-popover-${cloned.id}[role='dialog']`)).not.toBeNull();
});
