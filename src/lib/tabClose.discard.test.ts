import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import type { TabEntity } from "@/store";
import { confirmCloseTab } from "./tabClose";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(), error: vi.fn(), destroy: vi.fn(),
  release: vi.fn(), pause: vi.fn(), discard: vi.fn(), find: vi.fn(),
  state: { content: "edited", savedContent: "original" },
}));
vi.mock("antd", () => ({ Modal: { confirm: mocks.confirm }, message: { error: mocks.error } }));
vi.mock("@/lib/api", () => ({ closePty: vi.fn() }));
vi.mock("@/store", () => ({ useAppStore: { getState: () => ({ currentProject: { path: "D:/repo" } }) } }));
vi.mock("@/lib/fileDocument", () => ({ findFileDocument: mocks.find }));

const tab: TabEntity = {
  id: "file-1", kind: "file", resourceId: "D:/repo/report.md", title: "report.md",
  closable: true, pinned: false, dirty: true, preview: false, createdAt: 1, lastActivatedAt: 1,
};
const t = ((key: string) => key) as TFunction;
function callbacks() {
  return mocks.confirm.mock.calls[0][0] as {
    onOk: () => Promise<void>; onCancel: () => void; afterClose: () => void;
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.state.content = "edited";
  mocks.state.savedContent = "original";
  mocks.confirm.mockReturnValue({ destroy: mocks.destroy });
  mocks.pause.mockReturnValue(mocks.release);
  mocks.discard.mockResolvedValue(undefined);
  mocks.find.mockReturnValue({
    store: { getState: () => mocks.state }, pauseAutoSave: mocks.pause, discardChanges: mocks.discard,
  });
});

describe("file close discard decision", () => {
  it("pauses the existing shared document until discard has completed", async () => {
    let complete!: () => void;
    mocks.discard.mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
    const decision = confirmCloseTab(tab, t);
    expect(mocks.find).toHaveBeenCalledWith("D:/repo", tab.resourceId);
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.pause.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirm.mock.invocationCallOrder[0]);
    const confirming = callbacks().onOk();
    expect(mocks.discard).toHaveBeenCalledOnce();
    expect(mocks.release).not.toHaveBeenCalled();
    complete();
    await confirming;
    expect(await decision).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
    callbacks().afterClose();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("resumes auto-save on cancel without discarding shared changes", async () => {
    const decision = confirmCloseTab(tab, t);
    callbacks().onCancel();
    expect(await decision).toBe(false);
    expect(mocks.discard).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("releases the pause if the modal is closed externally", async () => {
    const decision = confirmCloseTab(tab, t);
    callbacks().afterClose();
    expect(await decision).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("keeps the tab open and releases auto-save when discard fails", async () => {
    mocks.discard.mockRejectedValue(new Error("discard failed"));
    const decision = confirmCloseTab(tab, t);
    await callbacks().onOk();
    expect(await decision).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledWith("Error: discard failed");
  });

  it("releases auto-save when opening the modal throws", async () => {
    mocks.confirm.mockImplementation(() => { throw new Error("modal failed"); });
    expect(await confirmCloseTab(tab, t)).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledWith("Error: modal failed");
  });

  it("uses document dirtiness when the tab indicator has not updated yet", async () => {
    const decision = confirmCloseTab({ ...tab, dirty: false }, t);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    callbacks().onCancel();
    expect(await decision).toBe(false);
  });

  it("does not prompt for a document that has already auto-saved", async () => {
    mocks.state.content = mocks.state.savedContent;
    expect(await confirmCloseTab(tab, t)).toBe(true);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.pause).not.toHaveBeenCalled();
  });
});
