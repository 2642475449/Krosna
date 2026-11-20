import { expect, it } from "vitest";
import { parseReleaseNoteInlines, parseReleaseNotes } from "./updateReleaseNotes";

it("parses release note headings, bullet lists, inline code, bold text, and safe links", () => {
  const markdown = [
    "## 新增与升级",
    "",
    "- 新增 `.krosna/` 配置与 **SSH 远程工作区**",
    "- 支持自动迁移",
    "",
    "[完整变更记录](https://github.com/2642475449/Krosna/compare/v1.8.35...v1.8.36)",
  ].join("\n");

  expect(parseReleaseNotes(markdown)).toEqual([
    {
      kind: "heading",
      level: 2,
      inlines: [{ kind: "text", text: "新增与升级" }],
    },
    {
      kind: "list",
      items: [
        [
          { kind: "text", text: "新增 " },
          { kind: "code", text: ".krosna/" },
          { kind: "text", text: " 配置与 " },
          { kind: "strong", text: "SSH 远程工作区" },
        ],
        [{ kind: "text", text: "支持自动迁移" }],
      ],
    },
    {
      kind: "paragraph",
      inlines: [
        {
          kind: "link",
          label: "完整变更记录",
          url: "https://github.com/2642475449/Krosna/compare/v1.8.35...v1.8.36",
        },
      ],
    },
  ]);
});

it("downgrades non-http markdown links to plain text and preserves balanced-parenthesis URLs", () => {
  expect(parseReleaseNoteInlines("[click](javascript:alert(1))")).toEqual([
    { kind: "text", text: "click" },
  ]);
  expect(parseReleaseNoteInlines("[wiki](https://example.com/path_(v1))")).toEqual([
    { kind: "link", label: "wiki", url: "https://example.com/path_(v1)" },
  ]);
});

it("returns empty array for whitespace-only release notes", () => {
  expect(parseReleaseNotes("   \n\n  ")).toEqual([]);
});
