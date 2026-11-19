import { beforeEach, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkApplicationUpdate, closeApplicationUpdate, downloadApplicationUpdate, installApplicationUpdate } from "./applicationUpdate";

const { download, install, close } = vi.hoisted(() => ({
  download: vi.fn(), install: vi.fn(), close: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({
  Update: class {
    constructor(private metadata: { rid: number }) {}
    download(...args: unknown[]) { return download(this.metadata.rid, ...args); }
    install() { return install(this.metadata.rid); }
    close() { return close(this.metadata.rid); }
  },
}));

const settings = { mode: "disabled", customProxyUrl: "", noProxy: "localhost" } as const;
const metadata = {
  rid: 1, alternate: [2, "mirror"], host: "primary", currentVersion: "1.8.37",
  version: "1.8.38", rawJson: {}, body: "Release notes",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(invoke).mockResolvedValue(metadata);
});

test("passes the application proxy settings directly to the native checker", async () => {
  vi.mocked(invoke).mockResolvedValue(null);
  expect(await checkApplicationUpdate(settings)).toBeNull();
  expect(invoke).toHaveBeenCalledWith("check_application_update", { settings });
});

test("downloads once when the selected mirror succeeds", async () => {
  const update = (await checkApplicationUpdate(settings))!;
  const onEvent = vi.fn();
  await downloadApplicationUpdate(update, onEvent, { timeout: 120_000 });
  expect(download.mock.calls).toEqual([[1, onEvent, { timeout: 120_000 }]]);
  await installApplicationUpdate(update);
  expect(install).toHaveBeenCalledWith(1);
});

test("restarts progress on a failed transfer and installs the verified alternate resource", async () => {
  const update = (await checkApplicationUpdate(settings))!;
  download.mockRejectedValueOnce(new Error("connection reset")).mockResolvedValueOnce(undefined);
  const onEvent = vi.fn();
  await downloadApplicationUpdate(update, onEvent);
  expect(download.mock.calls.map(([rid]) => rid)).toEqual([1, 2]);
  expect(onEvent).toHaveBeenCalledWith({ event: "Started", data: {} });
  await installApplicationUpdate(update);
  expect(install).toHaveBeenCalledWith(2);
  await closeApplicationUpdate(update);
  expect(close.mock.calls).toEqual([[1], [2]]);
});

test("reports each source error and keeps installation unavailable until a retry is verified", async () => {
  const update = (await checkApplicationUpdate(settings))!;
  download.mockRejectedValueOnce("reset").mockRejectedValueOnce("signature mismatch");
  await expect(downloadApplicationUpdate(update, vi.fn())).rejects.toThrow("primary: reset\nmirror: signature mismatch");
  await expect(installApplicationUpdate(update)).rejects.toThrow("No verified update");
  expect(install).not.toHaveBeenCalled();
  await downloadApplicationUpdate(update, vi.fn());
  await installApplicationUpdate(update);
  expect(install).toHaveBeenCalledWith(1);
});
