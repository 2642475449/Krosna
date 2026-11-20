// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useAppStore } from "@/store";
import {
  createInitialApplicationUpdateSnapshot,
  useApplicationUpdateStore,
  type ApplicationUpdateSnapshot,
} from "@/store/slices/applicationUpdate";

const mocks = vi.hoisted(() => ({
  openSettingsPage: vi.fn(),
  openExternalUrl: vi.fn(async () => {}),
  checkForApplicationUpdate: vi.fn(async () => ({ status: "up-to-date" as const, currentVersion: "1.8.36" })),
  downloadPendingApplicationUpdate: vi.fn(async () => {}),
  installPendingApplicationUpdate: vi.fn(async () => {}),
  writeClipboardText: vi.fn(async () => {}),
}));

vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("antd")>();
  return {
    ...actual,
    Modal: ({ open, title, footer, children }: { open?: boolean; title?: ReactNode; footer?: ReactNode; children?: ReactNode }) =>
      open ? createElement("div", { "data-modal": "true" }, title, children, footer) : null,
    Progress: ({ percent }: { percent?: number }) =>
      createElement("div", { "data-progress": String(percent ?? 0) }),
    message: { success: vi.fn(), error: vi.fn() },
  };
});

vi.mock("@/lib/applicationUpdater", () => ({
  KROSNA_RELEASES_URL: "https://github.com/2642475449/Krosna/releases/latest",
  checkForApplicationUpdate: mocks.checkForApplicationUpdate,
  downloadPendingApplicationUpdate: mocks.downloadPendingApplicationUpdate,
  installPendingApplicationUpdate: mocks.installPendingApplicationUpdate,
}));

vi.mock("@/lib/api", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock("@/lib/settingsNavigation", () => ({
  openSettingsPage: mocks.openSettingsPage,
}));

import { ApplicationUpdateModal } from "./ApplicationUpdateModal";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function setUpdateState(patch: Partial<ApplicationUpdateSnapshot>) {
  useApplicationUpdateStore.setState({
    ...createInitialApplicationUpdateSnapshot("1.8.36"),
    ...patch,
  });
}

function findButton(label: string): HTMLButtonElement | undefined {
  const normalizedTarget = label.replace(/\s+/g, "");
  return Array.from(host.querySelectorAll("button")).find((button) => {
    const text = button.textContent ?? "";
    return text.includes(label) || text.replace(/\s+/g, "").includes(normalizedTarget);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeClipboardText },
  });
  await i18n.changeLanguage("zh-CN");
  useAppStore.setState(useAppStore.getInitialState(), true);
  setUpdateState({ modalOpen: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setUpdateState({ modalOpen: false });
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.unstubAllGlobals();
});

it("renders nothing when the update modal is closed", async () => {
  await act(async () => root.render(createElement(ApplicationUpdateModal)));
  expect(host.innerHTML).toBe("");
});

it("keeps raw error details collapsed by default and supports expand, copy, network navigation, manual download, and retry", async () => {
  const rawError = "error sending request for url (https://github.com/2642475449/Krosna/releases/latest/download/latest.json)";
  setUpdateState({
    modalOpen: true,
    phase: "error",
    errorStage: "check",
    error: rawError,
  });

  await act(async () => root.render(createElement(ApplicationUpdateModal)));

  expect(host.textContent).toContain("v1.8.36");
  expect(host.textContent).toContain(i18n.t("updater.checkFailed"));
  expect(host.textContent).toContain(i18n.t("updater.recoveryHint"));
  expect(host.querySelector(".app-update-modal__error-code")).toBeNull();

  expect(findButton(i18n.t("updater.downloadFromMirror"))).toBeUndefined();
  const toggleButton = findButton(i18n.t("updater.showErrorDetails"))!;
  expect(toggleButton).toBeTruthy();
  expect(toggleButton.getAttribute("aria-expanded")).toBe("false");

  await act(async () => toggleButton.click());
  expect(toggleButton.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector(".app-update-modal__error-code")?.textContent).toBe(rawError);

  const copyButton = findButton(i18n.t("updater.copyErrorDetails"))!;
  await act(async () => copyButton.click());
  expect(mocks.writeClipboardText).toHaveBeenCalledWith(rawError);

  const releasesButton = findButton(i18n.t("updater.manualDownload"))!;
  await act(async () => releasesButton.click());
  expect(mocks.openExternalUrl).toHaveBeenCalledWith(
    "https://github.com/2642475449/Krosna/releases/latest",
  );

  const retryButton = findButton(i18n.t("updater.retry"))!;
  await act(async () => retryButton.click());
  expect(mocks.checkForApplicationUpdate).toHaveBeenCalledWith({ manual: true });

  const networkButton = findButton(i18n.t("updater.openNetworkSettings"))!;
  await act(async () => networkButton.click());
  expect(useApplicationUpdateStore.getState().modalOpen).toBe(false);
  expect(mocks.openSettingsPage).toHaveBeenCalledWith("network");
});

it("hides connectivity recovery options on install failure while preserving install retry", async () => {
  setUpdateState({
    modalOpen: true,
    phase: "ready",
    availableVersion: "1.8.37",
    errorStage: "install",
    error: "installer exited with status 1",
  });

  await act(async () => root.render(createElement(ApplicationUpdateModal)));

  expect(host.textContent).toContain(i18n.t("updater.installFailed"));
  expect(host.textContent).toContain(i18n.t("updater.installErrorHint"));
  expect(findButton(i18n.t("updater.openNetworkSettings"))).toBeUndefined();
  expect(findButton(i18n.t("updater.manualDownload"))).toBeUndefined();

  const installButton = findButton(i18n.t("updater.restartAndInstall"))!;
  expect(installButton).toBeTruthy();
  await act(async () => installButton.click());
  expect(mocks.installPendingApplicationUpdate).toHaveBeenCalledTimes(1);
});

it("renders parsed release notes and omits disabled primary action while downloading", async () => {
  setUpdateState({
    modalOpen: true,
    phase: "downloading",
    availableVersion: "1.8.37",
    downloadedBytes: 512,
    totalBytes: 1024,
    percent: 50,
    releaseNotes: "## 新增与升级\n\n- 支持 `proxy` 跳转\n\n[完整变更](https://github.com/2642475449/Krosna/releases)",
  });

  await act(async () => root.render(createElement(ApplicationUpdateModal)));

  expect(host.textContent).toContain(i18n.t("updater.downloadPhase"));
  expect(host.textContent).toContain("50%");
  expect(host.querySelector(".app-update-modal__notes h2")?.textContent).toBe("新增与升级");
  expect(host.querySelector(".app-update-modal__notes code")?.textContent).toBe("proxy");
  expect(findButton(i18n.t("updater.restartAndInstall"))).toBeUndefined();
  expect(findButton(i18n.t("updater.close"))).toBeTruthy();

  const noteLink = findButton("完整变更")!;
  await act(async () => noteLink.click());
  expect(mocks.openExternalUrl).toHaveBeenCalledWith(
    "https://github.com/2642475449/Krosna/releases",
  );
});

it("uses the known version for the domestic installer and rechecks sources on retry", async () => {
  setUpdateState({ modalOpen: true, phase: "error", errorStage: "download", availableVersion: "2.3.4", error: "timeout" });
  await act(async () => root.render(createElement(ApplicationUpdateModal)));
  const installerButton = findButton(i18n.t("updater.downloadFromMirror"))!;
  await act(async () => installerButton.click());
  expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://termflow.jianglan.online/releases/Termflow_2.3.4_x64-setup.exe");
  await act(async () => findButton(i18n.t("updater.retry"))!.click());
  expect(mocks.checkForApplicationUpdate).toHaveBeenCalledWith({ manual: true });
});

it("distinguishes checking the manifests from preparing the download", async () => {
  setUpdateState({ modalOpen: true, phase: "checking" });
  await act(async () => root.render(createElement(ApplicationUpdateModal)));
  expect(host.textContent).toContain(i18n.t("updater.checkingTitle"));
  expect(host.textContent).not.toContain(i18n.t("updater.preparingDownload"));
  await act(async () => setUpdateState({ modalOpen: true, phase: "available" }));
  expect(host.textContent).toContain(i18n.t("updater.preparingDownload"));
});
