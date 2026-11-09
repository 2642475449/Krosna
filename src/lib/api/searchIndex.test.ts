import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: apiMocks.invoke,
}));

import {
  clearSearchIndexCache,
  deleteProjectIndex,
  getSearchIndexStorageStatus,
  getSearchIndexStatus,
  rebuildProjectIndex,
  setProjectIndexEnabled,
  setSearchIndexStorage,
} from "./index";

describe("search index API", () => {
  beforeEach(() => {
    apiMocks.invoke.mockReset();
  });

  it("loads status for the selected project", async () => {
    const status = {
      projectPath: "E:/projects/Krosna",
      enabled: false,
      state: "disabled",
      backend: "scan",
    };
    apiMocks.invoke.mockResolvedValue(status);

    await expect(getSearchIndexStatus("E:/projects/Krosna")).resolves.toEqual(status);
    expect(apiMocks.invoke).toHaveBeenCalledWith("get_search_index_status", {
      projectPath: "E:/projects/Krosna",
    });
  });

  it("persists the requested project override", async () => {
    apiMocks.invoke.mockResolvedValue({
      projectPath: "E:/projects/Krosna",
      enabled: true,
      state: "preflight",
      backend: "scan",
    });

    await setProjectIndexEnabled("E:/projects/Krosna", true);

    expect(apiMocks.invoke).toHaveBeenCalledWith("set_project_index_enabled", {
      projectPath: "E:/projects/Krosna",
      enabled: true,
    });
  });

  it("requests a full rebuild for the selected project", async () => {
    apiMocks.invoke.mockResolvedValue({
      projectPath: "E:/projects/Krosna",
      enabled: true,
      state: "preflight",
      backend: "scan",
    });

    await rebuildProjectIndex("E:/projects/Krosna");

    expect(apiMocks.invoke).toHaveBeenCalledWith("rebuild_project_index", {
      projectPath: "E:/projects/Krosna",
    });
  });

  it("deletes the selected project's index", async () => {
    apiMocks.invoke.mockResolvedValue({
      projectPath: "E:/projects/Krosna",
      enabled: false,
      state: "disabled",
      backend: "scan",
    });

    await deleteProjectIndex("E:/projects/Krosna");

    expect(apiMocks.invoke).toHaveBeenCalledWith("delete_project_index", {
      projectPath: "E:/projects/Krosna",
    });
  });

  it("loads and updates global index cache storage", async () => {
    const storage = {
      cacheRoot: "D:/Krosna Search Index",
      quotaBytes: 5 * 1024 ** 3,
      usedBytes: 123,
      projectCount: 2,
    };
    apiMocks.invoke.mockResolvedValue(storage);

    await expect(getSearchIndexStorageStatus()).resolves.toEqual(storage);
    expect(apiMocks.invoke).toHaveBeenLastCalledWith("get_search_index_storage_status");

    await expect(setSearchIndexStorage("D:/Krosna Search Index", storage.quotaBytes)).resolves.toEqual(storage);
    expect(apiMocks.invoke).toHaveBeenLastCalledWith("set_search_index_storage", {
      cacheRoot: "D:/Krosna Search Index",
      quotaBytes: storage.quotaBytes,
    });
  });

  it("clears all cached indexes", async () => {
    apiMocks.invoke.mockResolvedValue({
      cacheRoot: "C:/cache/search-index",
      quotaBytes: 5 * 1024 ** 3,
      usedBytes: 0,
      projectCount: 0,
    });

    await clearSearchIndexCache();

    expect(apiMocks.invoke).toHaveBeenCalledWith("clear_search_index_cache");
  });
});
