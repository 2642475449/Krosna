import type { ReactNode } from "react";
import { themeIcons } from "seti-file-icons";

const resolveSetiIcon = themeIcons({
  blue: "#4f8fb3",
  grey: "#64748b",
  "grey-light": "#8391a5",
  green: "#70a83b",
  orange: "#c87532",
  pink: "#d65b86",
  purple: "#8b6bb1",
  red: "#c65353",
  white: "#64748b",
  yellow: "#b79a2f",
  ignore: "#94a3b8",
});

const folderColor = "var(--cs-folder-icon, var(--cs-text-secondary))";
const excludedFolderColor = "#c87532";
const excludedFolderNames = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".parcel-cache",
  ".vite",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
]);
const archiveIconColor = "#b79a2f";
const archiveExtensions = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "gzip",
  "bz",
  "bz2",
  "xz",
  "lz",
  "lz4",
  "zst",
  "tgz",
  "tbz",
  "tbz2",
  "txz",
  "cab",
]);
const markdownIconSvg = `
  <svg viewBox="0 0 32 32" focusable="false">
    <path d="M2.5 8h4l4 5.1 4-5.1h4v16h-4V14l-4 5-4-5v10h-4V8zm20.5 0h4v9h3.5L25 24l-5.5-7H23V8z"/>
  </svg>
`;
const jspIconSvg = `
  <svg viewBox="0 0 32 32" focusable="false">
    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 3h14l6 6v20H6V3zm14 0v7h6"/>
    <text x="8" y="23" fill="currentColor" font-family="Arial, sans-serif" font-size="8" font-weight="700">JSP</text>
  </svg>
`;
const xmlIconSvg = `
  <svg viewBox="0 0 32 32" focusable="false">
    <path d="M6 3h14l6 6v20H6V3zm2 2v22h16V11h-6V5H8zm12 1.4V9h2.6L20 6.4z"/>
    <path d="m13 15.2-4 3.3 4 3.3v-2.4l-1.2-.9 1.2-.9v-2.4zm6 0v2.4l1.2.9-1.2.9v2.4l4-3.3-4-3.3zm-2.7-.5-2.4 7.6h1.8l2.4-7.6h-1.8z"/>
  </svg>
`;
const powerpointIconSvg = `
  <svg viewBox="0 0 32 32" focusable="false">
    <path d="M11 4h14a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H11V4z" opacity=".72"/>
    <path d="M16 8a8 8 0 1 1 0 16V8zm2 2.3v5.2h5.2A6 6 0 0 0 18 10.3z" opacity=".45"/>
    <path d="M4 8.5 18 6v20L4 23.5v-15z"/>
    <path fill="white" d="M8 12h4.3c2.4 0 3.8 1.2 3.8 3.4 0 2.3-1.5 3.6-4 3.6h-1.5v3H8V12zm2.6 2.1v2.8H12c1 0 1.5-.5 1.5-1.4 0-1-.5-1.4-1.5-1.4h-1.4z"/>
  </svg>
`;
const folderIconSvg = `
  <svg viewBox="0 0 16 16" focusable="false">
    <path fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M2 4.25A1.25 1.25 0 0 1 3.25 3h2.64c.38 0 .74.17.98.47l.66.83c.14.18.36.28.59.28h4.63A1.25 1.25 0 0 1 14 5.83v5.92A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75v-7.5z"/>
  </svg>
`;
const folderOpenIconSvg = `
  <svg viewBox="0 0 16 16" focusable="false">
    <path fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M2 4.25A1.25 1.25 0 0 1 3.25 3h2.54c.38 0 .74.17.98.47l.63.79c.14.18.36.28.59.28h3.76c.69 0 1.25.56 1.25 1.25v.96H4.45c-.55 0-1.04.35-1.22.87L2 11.2V4.25z"/>
    <path fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M3.23 7.62A1.25 1.25 0 0 1 4.42 6.75h9.28c.58 0 .99.57.81 1.12l-1.36 4.26a1.25 1.25 0 0 1-1.19.87H2.85c-.57 0-.98-.55-.82-1.1l1.2-4.28z"/>
  </svg>
`;
const archiveIconSvg = `
  <svg viewBox="0 0 32 32" focusable="false">
    <path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 3h14l6 6v20H6V3zm14 0v7h6"/>
    <path d="M14 11h4v2h-4zm0 4h4v2h-4zm0 4h4v2h-4zm0 4h4v2h-4z"/>
    <path d="M13 25h6v2h-6z"/>
  </svg>
`;

export type FolderTone = "excluded";

export interface FileIconInfo {
  icon: ReactNode;
  color: string;
  tone?: FolderTone;
}

export function getFileExtension(name: string): string {
  const normalizedName = name.trim().toLowerCase();
  const lastDotIndex = normalizedName.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === normalizedName.length - 1) return "";
  return normalizedName.slice(lastDotIndex + 1);
}

function createFileIcon(svg: string, color: string, className = ""): FileIconInfo {
  return {
    icon: (
      <span
        className={`app-seti-file-icon ${className}`.trim()}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: svg.replace(/<svg\b/, `<svg color="${color}"`) }}
      />
    ),
    color,
  };
}

export function getFileIconByName(fileName: string): FileIconInfo {
  const normalizedName = fileName.trim().toLowerCase();
  const extension = getFileExtension(normalizedName);
  if (extension === "jsp") {
    return createFileIcon(jspIconSvg, "#c65353", "app-jsp-file-icon");
  }
  if (extension === "xml") {
    return createFileIcon(xmlIconSvg, "#c87532", "app-xml-file-icon");
  }
  if (["ppt", "pptx", "pps", "ppsx"].includes(extension)) {
    return createFileIcon(powerpointIconSvg, "#d24726", "app-powerpoint-file-icon");
  }
  if (["md", "mdx", "markdown"].includes(extension)) {
    return createFileIcon(markdownIconSvg, "#4f9f5f", "app-markdown-file-icon");
  }
  if (archiveExtensions.has(extension)) {
    return createFileIcon(archiveIconSvg, archiveIconColor, "app-archive-file-icon");
  }
  const visual = resolveSetiIcon(normalizedName);
  return createFileIcon(visual.svg, visual.color);
}

export function getFileIcon(
  fileName: string,
  isDir = false,
  isExpanded = false,
  inheritedTone?: FolderTone
): FileIconInfo {
  if (!isDir) {
    const fileVisual = getFileIconByName(fileName);
    return inheritedTone ? { ...fileVisual, tone: inheritedTone } : fileVisual;
  }
  const normalizedName = fileName.trim().toLowerCase();
  const isExcluded = excludedFolderNames.has(normalizedName) || inheritedTone === "excluded";
  const color = isExcluded ? excludedFolderColor : folderColor;
  const svg = isExpanded ? folderOpenIconSvg : folderIconSvg;
  return {
    icon: (
      <span
        className="app-folder-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    ),
    color,
    tone: isExcluded ? "excluded" : undefined,
  };
}
