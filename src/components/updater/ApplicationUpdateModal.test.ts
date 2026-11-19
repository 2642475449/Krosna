import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { openExternalUrl } from "@/lib/api";
import { checkForApplicationUpdate } from "@/lib/applicationUpdater";
import zhCN from "@/locales/zh-CN.json";
import {
  createInitialApplicationUpdateSnapshot,
  type ApplicationUpdateSnapshot,
} from "@/store/slices/applicationUpdate";
import { ApplicationUpdateModal } from "./ApplicationUpdateModal";

let snapshot: ApplicationUpdateSnapshot;
const buttons = new Map<ReactNode, () => void>();

vi.mock("@/store", () => ({ useAppStore: {} }));
vi.mock("@/lib/api", () => ({ openExternalUrl: vi.fn() }));
vi.mock("@/lib/applicationUpdater", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/applicationUpdater")>(),
  checkForApplicationUpdate: vi.fn(),
}));
vi.mock("@/store/slices/applicationUpdate", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/store/slices/applicationUpdate")>(),
  useApplicationUpdateStore: (select?: (state: ApplicationUpdateSnapshot) => unknown) =>
    select ? select(snapshot) : snapshot,
}));
vi.mock("antd", () => ({
  Modal: ({ open, children, okText, onOk }: { open: boolean; children: ReactNode; okText: ReactNode; onOk: () => void }) => {
    if (!open) return null;
    buttons.set(okText, onOk);
    return children;
  },
  Alert: ({ title, description }: { title: ReactNode; description?: ReactNode }) =>
    createElement("div", null, title, description),
  Button: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => {
    buttons.set(children, onClick);
    return createElement("button", null, children);
  },
}));

beforeEach(() => {
  snapshot = { ...createInitialApplicationUpdateSnapshot("1.0.0"), modalOpen: true };
  buttons.clear();
  vi.clearAllMocks();
});

it("labels manifest lookup separately from preparing a download", () => {
  snapshot.phase = "checking";
  const checking = renderToStaticMarkup(createElement(ApplicationUpdateModal));
  expect(checking).toContain(zhCN.settings.quickMenu.checkingForUpdate);
  expect(checking).not.toContain(zhCN.updater.preparingDownload);
  snapshot.phase = "available";
  expect(renderToStaticMarkup(createElement(ApplicationUpdateModal))).toContain(zhCN.updater.preparingDownload);
});

it("preserves the actual check error when no installer version is known", () => {
  Object.assign(snapshot, { phase: "error", errorStage: "check", error: "invalid manifest" });
  const html = renderToStaticMarkup(createElement(ApplicationUpdateModal));
  expect(html).toContain("invalid manifest");
  expect(html).not.toContain("均无法连接");
  expect(buttons.has(zhCN.updater.downloadFromMirror)).toBe(false);
  expect(buttons.has(zhCN.updater.manualDownload)).toBe(true);
});

it("opens the versioned installer on the domestic server after a download fails", () => {
  Object.assign(snapshot, { phase: "error", errorStage: "download", error: "timeout", availableVersion: "2.3.4" });
  renderToStaticMarkup(createElement(ApplicationUpdateModal));
  buttons.get(zhCN.updater.downloadFromMirror)?.();
  expect(openExternalUrl).toHaveBeenCalledWith("https://termflow.jianglan.online/releases/Termflow_2.3.4_x64-setup.exe");
});

it("re-checks after a failed download so retry uses the current proxy and available sources", () => {
  Object.assign(snapshot, { phase: "error", errorStage: "download", error: "timeout", availableVersion: "2.3.4" });
  renderToStaticMarkup(createElement(ApplicationUpdateModal));
  buttons.get(zhCN.updater.retry)?.();
  expect(checkForApplicationUpdate).toHaveBeenCalledWith({ manual: true });
});
