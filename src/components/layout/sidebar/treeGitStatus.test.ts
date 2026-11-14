import { describe, expect, it } from "vitest";
import {
  buildTreeGitStatusIndex,
  computeVirtualWindow,
  getTreeEntryGitStatus,
  getTreeGitBadge,
} from "./treeGitStatus";

describe("treeGitStatus", () => {
  it("maps file statuses and aggregates highest priority status onto ancestor directories", () => {
    const index = buildTreeGitStatusIndex("D:\\repo", [
      { path: "src/components/Button.tsx", statusType: "untracked", staged: false },
      { path: "src/components/Panel.tsx", statusType: "modified", staged: false },
      { path: "src/App.tsx", statusType: "conflicted", staged: false },
      { path: "README.md", statusType: "added", staged: true },
    ]);

    expect(getTreeEntryGitStatus(index, "D:/repo/src/components/Button.tsx", false)).toBe("untracked");
    expect(getTreeEntryGitStatus(index, "D:/repo/src/components/Panel.tsx", false)).toBe("modified");
    expect(getTreeEntryGitStatus(index, "D:/repo/src/components", true)).toBe("modified");
    expect(getTreeEntryGitStatus(index, "D:/repo/src", true)).toBe("conflicted");
    expect(getTreeEntryGitStatus(index, "D:/repo/README.md", false)).toBe("added");
    expect(getTreeEntryGitStatus(index, "D:/repo/package.json", false)).toBeNull();
  });

  it("maps status types to compact badge labels and tones", () => {
    expect(getTreeGitBadge("modified")).toEqual({ label: "M", tone: "modified" });
    expect(getTreeGitBadge("untracked")).toEqual({ label: "U", tone: "added" });
    expect(getTreeGitBadge("added")).toEqual({ label: "A", tone: "added" });
    expect(getTreeGitBadge("deleted")).toEqual({ label: "D", tone: "deleted" });
    expect(getTreeGitBadge("conflicted")).toEqual({ label: "!", tone: "conflicted" });
  });

  it("virtualizes large lists when viewport height is known and renders all rows in unmeasured environments", () => {
    expect(computeVirtualWindow(50, 0, 400, 24)).toEqual({
      startIndex: 0,
      endIndex: 50,
      paddingTop: 0,
      paddingBottom: 0,
    });

    expect(computeVirtualWindow(500, 0, 0, 24)).toEqual({
      startIndex: 0,
      endIndex: 500,
      paddingTop: 0,
      paddingBottom: 0,
    });

    const win = computeVirtualWindow(500, 480, 240, 24, 5, 80);
    expect(win.startIndex).toBe(15);
    expect(win.endIndex).toBe(35);
    expect(win.paddingTop).toBe(15 * 24);
    expect(win.paddingBottom).toBe((500 - 35) * 24);
  });
});
