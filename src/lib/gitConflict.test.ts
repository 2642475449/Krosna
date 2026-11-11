import { expect, it } from "vitest";
import { hasGitConflictMarkers, parseGitConflictBlocks, resolveGitConflictBlock } from "./gitConflict";

const conflict = "before\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> topic\nafter\n";

it("resolves only the selected block, preserving surrounding text and other conflicts", () => {
  const text = conflict + conflict;
  expect(parseGitConflictBlocks(text)).toHaveLength(2);
  const result = resolveGitConflictBlock(text, 1, "both");
  expect(result).toBe(conflict + "before\na\nb\nafter\n");
  expect(resolveGitConflictBlock(conflict, 0, "ours")).toBe("before\na\nafter\n");
  expect(resolveGitConflictBlock(conflict, 0, "theirs")).toBe("before\nb\nafter\n");
});

it("handles diff3, custom marker widths, CRLF and missing final newline", () => {
  const text = "<<<<<<<<<< HEAD\r\na\r\n|||||||||| base\r\nold\r\n==========\r\nb\r\n>>>>>>>>>> topic";
  expect(parseGitConflictBlocks(text)[0]).toMatchObject({ ours: "a\r\n", theirs: "b\r\n", line: 1 });
  expect(resolveGitConflictBlock(text, 0, "both")).toBe("a\r\nb\r\n");
});

it("keeps malformed blocks intact and blocks orphan markers", () => {
  expect(parseGitConflictBlocks("<<<<<<< HEAD\na\n=======\nb")).toEqual([]);
  expect(resolveGitConflictBlock(conflict, 9, "ours")).toBe(conflict);
  expect(hasGitConflictMarkers("||||||| base\n")).toBe(true);
  expect(hasGitConflictMarkers('const s = "<<<<<<< HEAD";')).toBe(false);
});
