import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { getFileExtension, getFileIcon, getFileIconByName } from "./fileIcon";

function getSvg(fileName: string): string {
  const element = getFileIconByName(fileName).icon as ReactElement<{
    dangerouslySetInnerHTML: { __html: string };
  }>;
  return element.props.dangerouslySetInnerHTML.__html;
}

describe("fileIcon", () => {
  it("embeds the shared type color and unified 16x16 viewBox on all file icons", () => {
    for (const fileName of [
      "README.md",
      "document.pdf",
      "Main.java",
      "index.ts",
      "form.jsp",
      "pom.xml",
      "slides.pptx",
      "vite.config.ts",
      "vitest.config.ts",
    ]) {
      const visual = getFileIconByName(fileName);
      const svg = getSvg(fileName);
      expect(svg).toContain(`<svg color="${visual.color}"`);
      expect(svg).toContain('viewBox="0 0 16 16"');
      expect(svg).not.toContain("<text");
    }
  });

  it("extracts ordinary extensions but not dotfiles", () => {
    expect(getFileExtension("component.TSX")).toBe("tsx");
    expect(getFileExtension(".gitignore")).toBe("");
    expect(getFileExtension("README")).toBe("");
  });

  it("uses dedicated artwork for exact project filenames and config prefixes", () => {
    expect(getSvg("package.json")).not.toBe(getSvg("unknown-file"));
    expect(getSvg(".gitignore")).not.toBe(getSvg("unknown-file"));
    expect(getSvg("vite.config.ts")).not.toBe(getSvg("index.ts"));
    expect(getSvg("vitest.config.ts")).not.toBe(getSvg("index.ts"));
    expect(getSvg("pnpm-lock.yaml")).not.toBe(getSvg("unknown-file"));
  });

  it("uses distinct artwork for common languages", () => {
    expect(getSvg("index.ts")).not.toBe(getSvg("main.py"));
    expect(getSvg("main.py")).not.toBe(getSvg("main.rs"));
    expect(getSvg("index.html")).not.toBe(getSvg("styles.css"));
  });

  it("uses a dedicated vector JSP icon without text elements", () => {
    const element = getFileIconByName("form.JSP").icon as ReactElement<{
      className: string;
      dangerouslySetInnerHTML: { __html: string };
    }>;
    expect(element.props.className).toContain("app-jsp-file-icon");
    expect(element.props.dangerouslySetInnerHTML.__html).not.toContain("<text");
    expect(element.props.dangerouslySetInnerHTML.__html).not.toBe(getSvg("unknown-file"));
  });

  it("uses a clear markup-file glyph for XML", () => {
    const element = getFileIconByName("report.XML").icon as ReactElement<{
      className: string;
      dangerouslySetInnerHTML: { __html: string };
    }>;
    expect(element.props.className).toContain("app-xml-file-icon");
    expect(element.props.dangerouslySetInnerHTML.__html).toContain("<svg");
    expect(element.props.dangerouslySetInnerHTML.__html).not.toBe(getSvg("unknown-file"));
  });

  it("uses a unified Markdown glyph across md, mdx, and markdown", () => {
    const element = getFileIconByName("NOTES.md").icon as ReactElement<{
      className: string;
      dangerouslySetInnerHTML: { __html: string };
    }>;
    expect(element.props.className).toContain("app-markdown-file-icon");
    expect(element.props.dangerouslySetInnerHTML.__html).toContain("<svg");
    expect(getFileIconByName("guide.mdx").color).toBe(getFileIconByName("NOTES.md").color);
    expect(getFileIconByName("manual.markdown").color).toBe(getFileIconByName("NOTES.md").color);
  });

  it("uses a dedicated PowerPoint icon for presentation files", () => {
    const element = getFileIconByName("proposal.PPTX").icon as ReactElement<{
      className: string;
      dangerouslySetInnerHTML: { __html: string };
    }>;
    expect(element.props.className).toContain("app-powerpoint-file-icon");
    expect(element.props.dangerouslySetInnerHTML.__html).toContain("<svg");
    expect(element.props.dangerouslySetInnerHTML.__html).not.toBe(getSvg("unknown-file"));
    expect(getFileIconByName("slides.ppt").color).toBe(getFileIconByName("show.ppsx").color);
  });

  it("uses one clear zipper-file logo for common archive formats", () => {
    const archiveNames = [
      "materials.zip",
      "materials.rar",
      "materials.7z",
      "materials.tar",
      "materials.tar.gz",
      "materials.tar.xz",
      "materials.cab",
    ];
    const archiveSvg = getSvg(archiveNames[0]);

    for (const archiveName of archiveNames) {
      const icon = getFileIconByName(archiveName).icon as ReactElement<{
        className: string;
      }>;
      expect(icon.props.className).toContain("app-archive-file-icon");
      expect(getSvg(archiveName)).toBe(archiveSvg);
      expect(getFileIconByName(archiveName).color).toBe("#b79a2f");
    }

    expect(archiveSvg).toContain('stroke="currentColor"');
    expect(archiveSvg).not.toBe(getSvg("unknown-file"));
  });

  it("distinguishes excluded folders, semantic folders, and default folders", () => {
    const regularA = getFileIcon("design", true);
    const regularB = getFileIcon("experiments", true);
    const src = getFileIcon("src", true);
    const nodeModules = getFileIcon("node_modules", true);
    const dist = getFileIcon("dist", true);
    const expanded = getFileIcon("src", true, true);

    expect(regularA.color).toBe(regularB.color);
    expect(regularA.tone).toBeUndefined();
    expect(src.tone).toBeUndefined();
    expect(src.color).not.toBe(regularA.color);
    expect(nodeModules.color).toBe(dist.color);
    expect(nodeModules.tone).toBe("excluded");
    expect(dist.tone).toBe("excluded");
    expect(nodeModules.color).not.toBe(regularA.color);
    expect(src.icon).not.toEqual(expanded.icon);

    const nestedDir = getFileIcon("react", true, false, "excluded");
    const nestedFile = getFileIcon("index.js", false, false, "excluded");
    expect(nestedDir.color).toBe(nodeModules.color);
    expect(nestedDir.tone).toBe("excluded");
    expect(nestedFile.tone).toBe("excluded");
  });

  it("returns a consistent default icon for unknown files", () => {
    expect(getSvg("unknown.one-extension")).toBe(getSvg("unknown.another-extension"));
  });
});
