import { describe, expect, it } from "vitest";
import {
  buildDefaultQuickSearchItems,
  MAX_DEFAULT_QUICK_SEARCH_ITEMS,
} from "./titleBarQuickSearchItems";
import type { FileTreeEntry, GitFileStatus } from "@/types";

const PROJECT_PATH = "D:/3.project/Termflow";

function makeEntry(name: string, kind: "file" | "directory" = "file", ignored = false): FileTreeEntry {
  return {
    name,
    path: `${PROJECT_PATH}/${name}`,
    kind,
    hasChildren: kind === "directory",
    ignored,
  };
}

function makeGitStatus(path: string, statusType: GitFileStatus["statusType"] = "modified"): GitFileStatus {
  return {
    path,
    statusType,
    staged: false,
  };
}

describe("buildDefaultQuickSearchItems", () => {
  it("fills up to 10 items across open tabs, recent history, git statuses, and root fallback", () => {
    const items = buildDefaultQuickSearchItems({
      projectPath: PROJECT_PATH,
      openFileTabs: [
        { resourceId: `${PROJECT_PATH}/src/a.ts`, title: "a.ts", lastActivatedAt: 100 },
        { resourceId: `${PROJECT_PATH}/src/b.ts`, title: "b.ts", lastActivatedAt: 300 },
      ],
      recentFilePaths: [
        `${PROJECT_PATH}\\src\\B.ts`, // duplicate of open tab (different slash & case)
        `${PROJECT_PATH}/src/c.ts`,
        `${PROJECT_PATH}/src/d.ts`,
      ],
      gitStatuses: [
        makeGitStatus("src/deleted.ts", "deleted"),
        makeGitStatus("src/c.ts", "modified"), // duplicate of recent
        makeGitStatus("src/e.ts", "modified"),
        makeGitStatus("src/f.ts", "untracked"),
      ],
      fallbackEntries: [
        makeEntry("src", "directory"),
        makeEntry(".env", "file", true),
        makeEntry("package.json", "file", false),
        makeEntry("README.md", "file", false),
        makeEntry("tsconfig.json", "file", false),
        makeEntry("vite.config.ts", "file", false),
        makeEntry("index.html", "file", false),
      ],
    });

    expect(items).toHaveLength(MAX_DEFAULT_QUICK_SEARCH_ITEMS);
    expect(items.map((item) => item.relativePath)).toEqual([
      "src/b.ts",
      "src/a.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
      "src/f.ts",
      "index.html",
      "package.json",
      "README.md",
      "tsconfig.json",
    ]);
  });

  it("caps open file tabs at 10 when more than 10 tabs are open", () => {
    const openFileTabs = Array.from({ length: 14 }, (_, index) => ({
      resourceId: `${PROJECT_PATH}/src/file-${index}.ts`,
      title: `file-${index}.ts`,
      lastActivatedAt: index + 1,
    }));

    const items = buildDefaultQuickSearchItems({
      projectPath: PROJECT_PATH,
      openFileTabs,
      recentFilePaths: [],
      gitStatuses: [],
      fallbackEntries: [],
    });

    expect(items).toHaveLength(10);
    expect(items[0]?.name).toBe("file-13.ts");
    expect(items[9]?.name).toBe("file-4.ts");
  });

  it("places non-ignored files before ignored files and directories in fallback", () => {
    const items = buildDefaultQuickSearchItems({
      projectPath: PROJECT_PATH,
      openFileTabs: [],
      recentFilePaths: [],
      gitStatuses: [],
      fallbackEntries: [
        makeEntry("dist", "directory", true),
        makeEntry("src", "directory", false),
        makeEntry(".DS_Store", "file", true),
        makeEntry("package.json", "file", false),
      ],
    });

    expect(items.map((item) => item.name)).toEqual([
      "package.json",
      ".DS_Store",
      "src",
      "dist",
    ]);
  });
});
