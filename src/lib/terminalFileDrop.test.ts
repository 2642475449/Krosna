import { describe, expect, it } from "vitest";
import { buildAgentFileReferencePrompt as build, type AgentFileDropEntry } from "./terminalFileDrop";

const files = (...paths: string[]): AgentFileDropEntry[] => paths.map((path) => ({ path, kind: "file" }));

describe("terminal file drop references", () => {
  it("keeps mixed video, document, archive and image files in order", () => {
    expect(build({ agentId: "antigravity", entries: files(
      "D:/work/录屏.mp4", "D:/work/notes.pdf", "D:/work/source.zip", "D:/work/screen.png",
    ) })).toBe("@D:/work/录屏.mp4 @D:/work/notes.pdf @D:/work/source.zip @D:/work/screen.png");
  });

  it("quotes paths with spaces and preserves all absolute paths", () => {
    expect(build({ agentId: "claude", entries: files(
      "D:/work/my file.md", "C:/User Files/video.mp4",
    ) })).toBe('@"D:/work/my file.md" @"C:/User Files/video.mp4"');
  });

  it("keeps absolute paths for files inside and outside the project", () => {
    expect(build({ agentId: "codex", entries: files("D:/work/a.pdf", "D:/workspace/a.pdf") }))
      .toBe("D:/work/a.pdf D:/workspace/a.pdf");
  });

  it("normalizes Windows separators while preserving the full path and case", () => {
    expect(build({ agentId: "codex", entries: files("d:\\Work\\a.mp4") }))
      .toBe("d:/Work/a.mp4");
  });

  it("preserves UNC paths", () => {
    expect(build({ agentId: "codex", entries: files("\\\\server\\share\\a.pdf") }))
      .toBe("//server/share/a.pdf");
  });

  it("uses literal PowerShell strings for apostrophes and expressions", () => {
    expect(build({ agentId: "powershell", entries: files("D:\\it's $(whoami).mp4") }))
      .toBe("'D:\\it''s $(whoami).mp4'");
  });

  it("quotes CMD paths containing spaces and command separators", () => {
    expect(build({ agentId: "cmd", entries: files("D:\\video & notes\\a.mp4") }))
      .toBe('"D:\\video & notes\\a.mp4"');
  });

  it("retains directory semantics and removes terminal control characters", () => {
    expect(build({ agentId: "codex", entries: [
      { path: "D:/work/docs", kind: "directory" }, ...files("D:/work/a\r\n\x1b.pdf", ""),
    ] })).toBe('D:/work/docs (directory) "D:/work/a   .pdf"');
  });

  it("keeps the project root as an absolute directory reference", () => {
    expect(build({ agentId: "codex", entries: [
      { path: "D:/work", kind: "directory" },
    ] })).toBe("D:/work (directory)");
  });

  it("preserves POSIX absolute file and directory paths", () => {
    expect(build({ agentId: "opencode", entries: [
      ...files("/home/user/work/a.ts"), { path: "/home/user/work/docs", kind: "directory" },
    ] })).toBe("@/home/user/work/a.ts @/home/user/work/docs");
  });

  it("preserves absolute filesystem roots", () => {
    expect(build({ agentId: "codex", entries: [
      { path: "C:\\", kind: "directory" }, { path: "/", kind: "directory" },
    ] })).toBe("C:/ (directory) / (directory)");
  });
});
