import type { ReactNode } from "react";

export type FolderTone = "excluded";

export interface FileIconInfo {
  icon: ReactNode;
  color: string;
  tone?: FolderTone;
}

interface IconVisual {
  svg: string;
  color: string;
  className?: string;
}

const DEFAULT_FILE_COLOR = "#64748b";
const DEFAULT_FOLDER_COLOR = "var(--cs-folder-icon, #64748b)";
const EXCLUDED_FOLDER_COLOR = "#d97706";

const EXCLUDED_FOLDER_NAMES = new Set([
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

function iconSvg(body: string): string {
  return `<svg viewBox="0 0 16 16" fill="none" focusable="false">${body}</svg>`;
}

function createFolderSvg(isExpanded: boolean, badge = ""): string {
  if (isExpanded) {
    return `<svg viewBox="0 0 16 16" fill="none" focusable="false"><path fill="currentColor" fill-opacity="0.10" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" d="M2 4.2A1.2 1.2 0 0 1 3.2 3h2.55c.35 0 .68.16.9.43l.58.72c.14.17.34.27.56.27h4.26c.66 0 1.2.54 1.2 1.2v.93H4.3c-.56 0-1.05.36-1.22.9L2 10.95V4.2z"/><path fill="currentColor" fill-opacity="0.20" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" d="M3.15 7.42a1.15 1.15 0 0 1 1.1-.82h9.45c.56 0 .96.54.78 1.07l-1.28 4.18a1.2 1.2 0 0 1-1.15.85H2.85c-.55 0-.95-.53-.79-1.06l1.09-4.22z"/>${badge}</svg>`;
  }
  return `<svg viewBox="0 0 16 16" fill="none" focusable="false"><path fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round" d="M2 4.2A1.2 1.2 0 0 1 3.2 3h2.65c.35 0 .68.16.9.43l.62.77c.14.17.34.27.56.27H12.8A1.2 1.2 0 0 1 14 5.67v6.13A1.2 1.2 0 0 1 12.8 13H3.2A1.2 1.2 0 0 1 2 11.8V4.2z"/>${badge}</svg>`;
}

// ---------------------------------------------------------------------------
// JetBrains New UI 轻量双色风 16×16 文件图标
// ---------------------------------------------------------------------------
const SVG_GIT = iconSvg(
  `<path d="M5.5 3.5v9M5.5 6.5c2 0 4.5-.5 4.5-3M5.5 9.5c2 0 4.5.5 4.5 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="5.5" cy="3.5" r="1.35" fill="var(--cs-bg-sidebar, #ffffff)" stroke="currentColor" stroke-width="1.25"/><circle cx="10" cy="3.5" r="1.35" fill="var(--cs-bg-sidebar, #ffffff)" stroke="currentColor" stroke-width="1.25"/><circle cx="5.5" cy="12.5" r="1.35" fill="var(--cs-bg-sidebar, #ffffff)" stroke="currentColor" stroke-width="1.25"/><circle cx="10" cy="12" r="1.35" fill="var(--cs-bg-sidebar, #ffffff)" stroke="currentColor" stroke-width="1.25"/>`,
);
const SVG_MARKDOWN = iconSvg(
  `<rect x="2" y="2.5" width="12" height="11" rx="2" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.15"/><path d="M4.2 10.2V5.8l1.6 2 1.6-2v4.4M10.8 5.8v4.2m0 0l-1.1-1.1m1.1 1.1l1.1-1.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_HTML = iconSvg(
  `<path d="M5.5 4.5L2.2 8l3.3 3.5M10.5 4.5L13.8 8l-3.3 3.5M9 3.8L7 12.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_XML = iconSvg(
  `<path d="M5.2 4.6 2 8l3.2 3.4M10.8 4.6 14 8l-3.2 3.4M8.8 4.2 7.2 11.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_CSS = iconSvg(
  `<path d="M4.2 6h8.2M3.6 10h8.2M6.8 3.2 5.2 12.8M10.8 3.2 9.2 12.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
);
const SVG_JSON = iconSvg(
  `<path d="M6.2 3.2c-1 0-1.5.6-1.5 1.5v1.6c0 .6-.3 1-.9 1.2v.4c.6.2.9.6.9 1.2v1.6c0 .9.5 1.5 1.5 1.5M9.8 3.2c1 0 1.5.6 1.5 1.5v1.6c0 .6.3 1 .9 1.2v.4c-.6.2-.9.6-.9 1.2v1.6c0 .9-.5 1.5-1.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
);
const SVG_PNPM = iconSvg(
  `<path d="M3.5 2.5h6.2l2.8 2.8v8.2a.8.8 0 0 1-.8.8H4.3a.8.8 0 0 1-.8-.8V2.5z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.15"/><path d="M6 7.2L8 9.4l2-2.2M8 9.4v2.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_YAML = iconSvg(
  `<path d="M3.5 4.2 8 8.8l4.5-4.6M8 8.8v4.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_TOML = iconSvg(
  `<path d="M4.2 3.8H2.8v8.4h1.4M11.8 3.8h1.4v8.4h-1.4" stroke="#64748b" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.6 5.4h4.8M8 5.4v5.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
);
const SVG_TS = iconSvg(
  `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.15"/><path d="M4.6 6.4h3.2M6.2 6.4v4.4M11.3 6.8c-.35-.25-.7-.4-1.15-.4-.6 0-1 .3-1 .78 0 1.05 2.25.7 2.25 1.95 0 .6-.5 1-1.2 1-.55 0-1-.2-1.4-.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
);
const SVG_JS = iconSvg(
  `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.15"/><path d="M6.8 6.4v3.1c0 .9-.55 1.45-1.4 1.45-.5 0-.9-.15-1.2-.45M11.4 6.8c-.35-.25-.7-.4-1.15-.4-.6 0-1 .3-1 .78 0 1.05 2.25.7 2.25 1.95 0 .6-.5 1-1.2 1-.55 0-1-.2-1.4-.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
);
const SVG_REACT = iconSvg(
  `<circle cx="8" cy="8" r="1.4" fill="currentColor"/><ellipse cx="8" cy="8" rx="6" ry="2.3" stroke="currentColor" stroke-width="1.15"/><ellipse cx="8" cy="8" rx="6" ry="2.3" transform="rotate(60 8 8)" stroke="currentColor" stroke-width="1.15"/><ellipse cx="8" cy="8" rx="6" ry="2.3" transform="rotate(120 8 8)" stroke="currentColor" stroke-width="1.15"/>`,
);
const SVG_VUE = iconSvg(
  `<path d="M2 3.2h2.5L8 9.2l3.5-6H14L8 13.4 2 3.2z" fill="#41b883" fill-opacity="0.18" stroke="#41b883" stroke-width="1.15" stroke-linejoin="round"/><path d="M4.8 3.2L8 8.7l3.2-5.5" stroke="#35495e" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_VITE = iconSvg(
  `<path d="M13.5 3.3L8 13.3 2.5 3.3l5.5 1 5.5-1z" fill="#7c5dfa" fill-opacity="0.14" stroke="#7c5dfa" stroke-width="1.15" stroke-linejoin="round"/><path d="M8.8 4.4L6.6 8.3h1.8l-.5 2.7 2.3-3.7H8.4l.4-2.9z" fill="#f5b82e"/>`,
);
const SVG_VITEST = iconSvg(
  `<path d="M3.2 4.2L8 12.6l4.8-8.4" stroke="#5fa022" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.6 2.8L7.6 6.2h1.6l-.8 2.8 2.6-3.6H9.2l.4-2.6z" fill="#f5b82e"/>`,
);
const SVG_LICENSE = iconSvg(
  `<path d="M3.8 2.5h6l2.4 2.4v8.6a.8.8 0 0 1-.8.8H4.6a.8.8 0 0 1-.8-.8V2.5z" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.15"/><path d="M5.8 6.5h4.4M5.8 8.8h4.4M5.8 11.1h2.6" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>`,
);
const SVG_RUST = iconSvg(
  `<circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><path d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M3.9 3.9l1.15 1.15M10.95 10.95l1.15 1.15M12.1 3.9l-1.15 1.15M5.05 10.95 3.9 12.1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>`,
);
const SVG_PYTHON = iconSvg(
  `<path fill="#3776ab" d="M7.9 2C5.2 2 5.4 3.2 5.4 3.2v1.25h2.6v.4H4.3S2.5 4.65 2.5 7.3s1.55 2.55 1.55 2.55h.95V8.6s-.05-1.55 1.5-1.55h2.6s1.45.02 1.45-1.4V3.35S10.8 2 7.9 2zM6.45 2.8a.48.48 0 1 1 0 .96.48.48 0 0 1 0-.96z"/><path fill="#ffd343" d="M8.1 14c2.7 0 2.5-1.2 2.5-1.2v-1.25H8v-.4h3.7s1.8.2 1.8-2.45-1.55-2.55-1.55-2.55H11v1.25s.05 1.55-1.5 1.55H6.9s-1.45-.02-1.45 1.4v2.3S5.2 14 8.1 14zm1.45-.8a.48.48 0 1 1 0-.96.48.48 0 0 1 0 .96z"/>`,
);
const SVG_GO = iconSvg(
  `<path d="M2.5 8h3.4M2.5 5.4h4.6M2.5 10.6h4.1M11.3 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
);
const SVG_JAVA = iconSvg(
  `<path d="M4.2 7.6h6.4v1.8a3.2 3.2 0 0 1-6.4 0V7.6zM10.6 8.1h1a1.2 1.2 0 0 1 0 2.4h-1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.7 3.2c-.5.9.5 1.5 0 2.4M8.4 3.2c-.5.9.5 1.5 0 2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 13.6h8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>`,
);
const SVG_JSP = iconSvg(
  `<path d="M4.2 5.4v4.1a1.45 1.45 0 0 1-1.45 1.45M8 5.55c-.7 0-1.25.4-1.25 1.05 0 1.2 2.3.95 2.3 2.35 0 .75-.6 1.25-1.35 1.25-.55 0-1.05-.22-1.4-.55M10.9 10.7V5.4h1.45a1.35 1.35 0 0 1 0 2.7H10.9" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_C_FAMILY = iconSvg(
  `<path d="M8.7 5.2a3.3 3.3 0 1 0 0 5.6M10.6 8h2.8M12 6.6v2.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
);
const SVG_SHELL = iconSvg(
  `<path d="M3.2 4.8 7 8 3.2 11.2M8.2 11.2h4.6" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_SQL = iconSvg(
  `<ellipse cx="8" cy="4.2" rx="4.6" ry="1.6" stroke="currentColor" stroke-width="1.35"/><path d="M3.4 4.2v7.6c0 .9 2.05 1.6 4.6 1.6s4.6-.7 4.6-1.6V4.2M3.4 8c0 .9 2.05 1.6 4.6 1.6s4.6-.7 4.6-1.6" stroke="currentColor" stroke-width="1.35"/>`,
);
const SVG_IMAGE = iconSvg(
  `<rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.8" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.3"/><circle cx="5.7" cy="6" r="1.15" fill="currentColor"/><path d="M3.4 11.7 6.5 8.2l2 2 1.6-1.8 2.5 3.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_AUDIO = iconSvg(
  `<path d="M6.2 11.2V4.1l6-1.2v7.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4.7" cy="11.6" r="1.65" fill="currentColor"/><circle cx="10.7" cy="10.4" r="1.65" fill="currentColor"/>`,
);
const SVG_VIDEO = iconSvg(
  `<rect x="2" y="3.2" width="12" height="9.6" rx="2" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/><path d="M6.6 5.7 10.6 8l-4 2.3V5.7z" fill="currentColor"/>`,
);
const SVG_PDF = iconSvg(
  `<path fill="currentColor" d="M3.2 2.2h6.3l3.3 3.3v8.3a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V2.2z"/><path fill="#ffffff" fill-opacity="0.35" d="M9.5 2.2v3.3h3.3z"/><path d="M5.2 11.4V7.6h1.6a1.1 1.1 0 0 1 0 2.2H5.2" stroke="#ffffff" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_PPT = iconSvg(
  `<circle cx="8.2" cy="8" r="5.2" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.35"/><path d="M8.2 2.8V8h5.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_WORD = iconSvg(
  `<path d="M2.6 4.2 4.9 11.8 8 5.6l3.1 6.2 2.3-7.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const SVG_SHEET = iconSvg(
  `<rect x="2.4" y="3" width="11.2" height="10" rx="1.6" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.3"/><path d="M6.6 3v10M2.4 6.5h11.2M2.4 9.8h11.2" stroke="currentColor" stroke-width="1.2"/>`,
);
const SVG_ARCHIVE = iconSvg(
  `<rect x="3" y="2.4" width="10" height="11.2" rx="1.6" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.3"/><path d="M8 3v7.2M6.7 4.4H8M8 5.9h1.3M6.7 7.4H8M8 8.9h1.3M6.7 10.7h2.6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>`,
);
const SVG_ENV = iconSvg(
  `<path d="M4.2 3.8v8.4M8 3.8v8.4M11.8 3.8v8.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="4.2" cy="6.2" r="1.3" fill="currentColor"/><circle cx="8" cy="9.8" r="1.3" fill="currentColor"/><circle cx="11.8" cy="6.2" r="1.3" fill="currentColor"/>`,
);
const SVG_LOCK = iconSvg(
  `<rect x="3.5" y="7" width="9" height="6.2" rx="1.4" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="1.3"/><path d="M5.4 7V5.3a2.6 2.6 0 0 1 5.2 0V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
);
const SVG_DOCKER = iconSvg(
  `<path fill="currentColor" d="M2.2 8.8h11.6c-.35 2.7-2.2 4.2-5.8 4.2-3.5 0-5.4-1.5-5.8-4.2zm2.1-2.8h2v1.8h-2zm2.6 0h2v1.8h-2zm2.6 0h2v1.8h-2zm-2.6-2.4h2v1.8h-2z"/>`,
);
const SVG_TEXT_DOC = iconSvg(
  `<path d="M3.6 2.4h5.9l3 3v8.2a.9.9 0 0 1-.9.9H4.5a.9.9 0 0 1-.9-.9V2.4z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M9.5 2.4v3h3" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M5.6 7.8h4.8M5.6 10.2h3.4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>`,
);
const SVG_DEFAULT_FILE = iconSvg(
  `<path d="M3.6 2.4h5.9l3 3v8.2a.9.9 0 0 1-.9.9H4.5a.9.9 0 0 1-.9-.9V2.4z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M9.5 2.4v3h3" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>`,
);

const COLOR_TS = "#3178c6";
const COLOR_JS = "#eab308";
const COLOR_REACT = "#0ea5e9";
const COLOR_MD = "#3b82f6";
const COLOR_HTML = "#ea580c";
const COLOR_XML = "#c87532";
const COLOR_CSS = "#2563eb";
const COLOR_JSON = "#d97706";
const COLOR_YAML = "#e11d48";
const COLOR_TOML = "#0d9488";
const COLOR_GIT = "#f4511e";
const COLOR_RUST = "#c2410c";
const COLOR_PYTHON = "#3776ab";
const COLOR_GO = "#0891b2";
const COLOR_JAVA = "#c65353";
const COLOR_SHELL = "#0d9488";
const COLOR_IMAGE = "#059669";
const COLOR_AUDIO = "#7c3aed";
const COLOR_VIDEO = "#db2777";
const COLOR_PDF = "#dc2626";
const COLOR_PPT = "#d24726";
const COLOR_WORD = "#2563eb";
const COLOR_SHEET = "#16a34a";
const COLOR_ARCHIVE = "#b79a2f";
const COLOR_LICENSE = "#eab308";

const EXACT_FILE_MAP: Record<string, IconVisual> = {
  ".gitignore": { svg: SVG_GIT, color: "#64748b", className: "app-gitignore-file-icon" },
  ".gitattributes": { svg: SVG_GIT, color: COLOR_GIT },
  ".gitmodules": { svg: SVG_GIT, color: COLOR_GIT },
  ".dockerignore": { svg: SVG_DOCKER, color: "#0284c7" },
  "dockerfile": { svg: SVG_DOCKER, color: "#0284c7" },
  "docker-compose.yml": { svg: SVG_DOCKER, color: "#0284c7" },
  "docker-compose.yaml": { svg: SVG_DOCKER, color: "#0284c7" },
  "package.json": { svg: SVG_JSON, color: COLOR_JSON },
  "package-lock.json": { svg: SVG_LOCK, color: COLOR_JSON },
  "pnpm-lock.yaml": { svg: SVG_PNPM, color: "#d94862", className: "app-yaml-file-icon" },
  "pnpm-workspace.yaml": { svg: SVG_PNPM, color: "#d94862", className: "app-yaml-file-icon" },
  "tsconfig.json": { svg: SVG_TS, color: COLOR_TS },
  "jsconfig.json": { svg: SVG_JS, color: COLOR_JS },
  "cargo.toml": { svg: SVG_RUST, color: COLOR_RUST },
  "cargo.lock": { svg: SVG_LOCK, color: COLOR_RUST },
  "license": { svg: SVG_LICENSE, color: COLOR_LICENSE },
  "license.md": { svg: SVG_LICENSE, color: COLOR_LICENSE },
  "license.txt": { svg: SVG_LICENSE, color: COLOR_LICENSE },
  "copying": { svg: SVG_LICENSE, color: COLOR_LICENSE },
  "readme": { svg: SVG_MARKDOWN, color: COLOR_MD, className: "app-markdown-file-icon" },
};

const EXTENSION_MAP: Record<string, IconVisual> = {
  // TypeScript / JavaScript
  ts: { svg: SVG_TS, color: COLOR_TS },
  mts: { svg: SVG_TS, color: COLOR_TS },
  cts: { svg: SVG_TS, color: COLOR_TS },
  tsx: { svg: SVG_REACT, color: COLOR_REACT },
  js: { svg: SVG_JS, color: COLOR_JS },
  mjs: { svg: SVG_JS, color: COLOR_JS },
  cjs: { svg: SVG_JS, color: COLOR_JS },
  jsx: { svg: SVG_REACT, color: COLOR_REACT },

  // Web & Frameworks
  html: { svg: SVG_HTML, color: COLOR_HTML },
  htm: { svg: SVG_HTML, color: COLOR_HTML },
  css: { svg: SVG_CSS, color: COLOR_CSS },
  scss: { svg: SVG_CSS, color: "#db2777" },
  sass: { svg: SVG_CSS, color: "#db2777" },
  less: { svg: SVG_CSS, color: "#1d4ed8" },
  vue: { svg: SVG_VUE, color: "#41b883" },
  svelte: { svg: SVG_HTML, color: "#ea580c" },
  astro: { svg: SVG_VITE, color: "#7c3aed" },

  // Data & Config
  json: { svg: SVG_JSON, color: COLOR_JSON },
  jsonc: { svg: SVG_JSON, color: COLOR_JSON },
  json5: { svg: SVG_JSON, color: COLOR_JSON },
  yml: { svg: SVG_YAML, color: COLOR_YAML, className: "app-yaml-file-icon" },
  yaml: { svg: SVG_YAML, color: COLOR_YAML, className: "app-yaml-file-icon" },
  toml: { svg: SVG_TOML, color: COLOR_TOML },
  xml: { svg: SVG_XML, color: COLOR_XML, className: "app-xml-file-icon" },
  svg: { svg: SVG_IMAGE, color: "#d97706" },
  csv: { svg: SVG_SHEET, color: COLOR_SHEET },
  ini: { svg: SVG_TOML, color: DEFAULT_FILE_COLOR },
  conf: { svg: SVG_TOML, color: DEFAULT_FILE_COLOR },
  env: { svg: SVG_ENV, color: "#ca8a04" },
  lock: { svg: SVG_LOCK, color: DEFAULT_FILE_COLOR },
  log: { svg: SVG_TEXT_DOC, color: DEFAULT_FILE_COLOR },

  // Docs & Office
  md: { svg: SVG_MARKDOWN, color: COLOR_MD, className: "app-markdown-file-icon" },
  mdx: { svg: SVG_MARKDOWN, color: COLOR_MD, className: "app-markdown-file-icon" },
  markdown: { svg: SVG_MARKDOWN, color: COLOR_MD, className: "app-markdown-file-icon" },
  txt: { svg: SVG_TEXT_DOC, color: DEFAULT_FILE_COLOR },
  pdf: { svg: SVG_PDF, color: COLOR_PDF },
  doc: { svg: SVG_WORD, color: COLOR_WORD },
  docx: { svg: SVG_WORD, color: COLOR_WORD },
  ppt: { svg: SVG_PPT, color: COLOR_PPT, className: "app-powerpoint-file-icon" },
  pptx: { svg: SVG_PPT, color: COLOR_PPT, className: "app-powerpoint-file-icon" },
  pps: { svg: SVG_PPT, color: COLOR_PPT, className: "app-powerpoint-file-icon" },
  ppsx: { svg: SVG_PPT, color: COLOR_PPT, className: "app-powerpoint-file-icon" },
  xls: { svg: SVG_SHEET, color: COLOR_SHEET },
  xlsx: { svg: SVG_SHEET, color: COLOR_SHEET },

  // Backend & Systems
  rs: { svg: SVG_RUST, color: COLOR_RUST },
  py: { svg: SVG_PYTHON, color: COLOR_PYTHON },
  pyw: { svg: SVG_PYTHON, color: COLOR_PYTHON },
  go: { svg: SVG_GO, color: COLOR_GO },
  java: { svg: SVG_JAVA, color: COLOR_JAVA },
  jsp: { svg: SVG_JSP, color: COLOR_JAVA, className: "app-jsp-file-icon" },
  kt: { svg: SVG_JAVA, color: "#7c3aed" },
  kts: { svg: SVG_JAVA, color: "#7c3aed" },
  c: { svg: SVG_C_FAMILY, color: COLOR_TS },
  h: { svg: SVG_C_FAMILY, color: "#7c3aed" },
  cpp: { svg: SVG_C_FAMILY, color: COLOR_TS },
  hpp: { svg: SVG_C_FAMILY, color: "#7c3aed" },
  cc: { svg: SVG_C_FAMILY, color: COLOR_TS },
  cs: { svg: SVG_C_FAMILY, color: "#16a34a" },
  rb: { svg: SVG_YAML, color: "#dc2626" },
  php: { svg: SVG_XML, color: "#6366f1" },
  swift: { svg: SVG_HTML, color: "#ea580c" },
  dart: { svg: SVG_GO, color: "#0284c7" },
  lua: { svg: SVG_JS, color: "#2563eb" },
  sql: { svg: SVG_SQL, color: "#0284c7" },
  graphql: { svg: SVG_REACT, color: "#db2777" },
  gql: { svg: SVG_REACT, color: "#db2777" },

  // Shell & Scripts
  sh: { svg: SVG_SHELL, color: COLOR_SHELL },
  bash: { svg: SVG_SHELL, color: COLOR_SHELL },
  zsh: { svg: SVG_SHELL, color: COLOR_SHELL },
  fish: { svg: SVG_SHELL, color: COLOR_SHELL },
  ps1: { svg: SVG_SHELL, color: COLOR_TS },
  psm1: { svg: SVG_SHELL, color: COLOR_TS },
  bat: { svg: SVG_SHELL, color: "#ca8a04" },
  cmd: { svg: SVG_SHELL, color: "#ca8a04" },

  // Media & Fonts
  png: { svg: SVG_IMAGE, color: COLOR_IMAGE },
  jpg: { svg: SVG_IMAGE, color: COLOR_IMAGE },
  jpeg: { svg: SVG_IMAGE, color: COLOR_IMAGE },
  gif: { svg: SVG_IMAGE, color: COLOR_IMAGE },
  webp: { svg: SVG_IMAGE, color: COLOR_IMAGE },
  ico: { svg: SVG_IMAGE, color: COLOR_IMAGE },
  bmp: { svg: SVG_IMAGE, color: COLOR_IMAGE },
  avif: { svg: SVG_IMAGE, color: COLOR_IMAGE },
  mp3: { svg: SVG_AUDIO, color: COLOR_AUDIO },
  wav: { svg: SVG_AUDIO, color: COLOR_AUDIO },
  ogg: { svg: SVG_AUDIO, color: COLOR_AUDIO },
  flac: { svg: SVG_AUDIO, color: COLOR_AUDIO },
  mp4: { svg: SVG_VIDEO, color: COLOR_VIDEO },
  webm: { svg: SVG_VIDEO, color: COLOR_VIDEO },
  mov: { svg: SVG_VIDEO, color: COLOR_VIDEO },
  woff: { svg: SVG_TEXT_DOC, color: "#64748b" },
  woff2: { svg: SVG_TEXT_DOC, color: "#64748b" },
  ttf: { svg: SVG_TEXT_DOC, color: "#64748b" },
  otf: { svg: SVG_TEXT_DOC, color: "#64748b" },

  // Archives
  zip: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  rar: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  "7z": { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  tar: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  gz: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  gzip: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  bz: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  bz2: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  xz: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  lz: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  lz4: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  zst: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  tgz: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  tbz: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  tbz2: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  txz: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
  cab: { svg: SVG_ARCHIVE, color: COLOR_ARCHIVE, className: "app-archive-file-icon" },
};

interface FolderStyle {
  color: string;
  badge?: string;
}

const FOLDER_STYLE_MAP: Record<string, FolderStyle> = {
  src: {
    color: "#0ea5e9",
    badge: `<path d="M9.6 9.3l-1 .9 1 .9M12.2 9.3l1 .9-1 .9" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  docs: {
    color: "#3b82f6",
    badge: `<path d="M9.4 9.2h3.4M9.4 10.9h2.2" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>`,
  },
  scripts: {
    color: "#14b8a6",
    badge: `<path d="M9.2 9.1l1.2 1-1.2 1M11.1 11.1h1.6" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  public: { color: "#10b981" },
  assets: { color: "#10b981" },
  images: { color: "#10b981" },
  test: { color: "#65a30d" },
  tests: { color: "#65a30d" },
  ".github": {
    color: "#6366f1",
    badge: `<circle cx="11.4" cy="10.2" r="2.1" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.1"/>`,
  },
  ".krosna": {
    color: "#8b5cf6",
    badge: `<circle cx="11.4" cy="10.1" r="1.35" fill="currentColor"/>`,
  },
  ".vscode": { color: "#2563eb" },
};

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

function resolvePrefixVisual(normalizedName: string): IconVisual | null {
  if (normalizedName.startsWith("vite.config.")) {
    return { svg: SVG_VITE, color: "#646cff" };
  }
  if (normalizedName.startsWith("vitest.config.")) {
    return { svg: SVG_VITEST, color: "#729b1b" };
  }
  if (normalizedName.startsWith("tsconfig.") && normalizedName.endsWith(".json")) {
    return { svg: SVG_TS, color: COLOR_TS };
  }
  if (normalizedName === ".env" || normalizedName.startsWith(".env.")) {
    return { svg: SVG_ENV, color: "#ca8a04" };
  }
  if (normalizedName.startsWith("eslint.config.") || normalizedName.startsWith(".eslintrc")) {
    return { svg: SVG_JS, color: "#6366f1" };
  }
  if (normalizedName.startsWith("prettier.config.") || normalizedName.startsWith(".prettierrc")) {
    return { svg: SVG_JSON, color: "#0ea5e9" };
  }
  return null;
}

export function isMarkdownFile(path: string): boolean {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  const fileName = normalizedPath.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return extension === "md" || extension === "markdown";
}

export function getFileIconByName(fileName: string): FileIconInfo {
  const normalizedName = fileName.trim().toLowerCase();

  const exactVisual = EXACT_FILE_MAP[normalizedName];
  if (exactVisual) {
    return createFileIcon(exactVisual.svg, exactVisual.color, exactVisual.className);
  }

  const prefixVisual = resolvePrefixVisual(normalizedName);
  if (prefixVisual) {
    return createFileIcon(prefixVisual.svg, prefixVisual.color, prefixVisual.className);
  }

  const extension = getFileExtension(normalizedName);
  const extVisual = EXTENSION_MAP[extension];
  if (extVisual) {
    return createFileIcon(extVisual.svg, extVisual.color, extVisual.className);
  }

  return createFileIcon(SVG_DEFAULT_FILE, DEFAULT_FILE_COLOR);
}

export function getFileIcon(
  fileName: string,
  isDir = false,
  isExpanded = false,
  inheritedTone?: FolderTone,
): FileIconInfo {
  if (!isDir) {
    const fileVisual = getFileIconByName(fileName);
    return inheritedTone ? { ...fileVisual, tone: inheritedTone } : fileVisual;
  }

  const normalizedName = fileName.trim().toLowerCase();
  const isExcluded = EXCLUDED_FOLDER_NAMES.has(normalizedName) || inheritedTone === "excluded";
  const semanticStyle = isExcluded ? undefined : FOLDER_STYLE_MAP[normalizedName];
  const color = isExcluded ? EXCLUDED_FOLDER_COLOR : (semanticStyle?.color ?? DEFAULT_FOLDER_COLOR);
  const svg = createFolderSvg(isExpanded, isExpanded ? undefined : semanticStyle?.badge);

  return {
    icon: (
      <span
        className="app-folder-icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: svg.replace(/<svg\b/, `<svg color="${color}"`) }}
      />
    ),
    color,
    tone: isExcluded ? "excluded" : undefined,
  };
}
