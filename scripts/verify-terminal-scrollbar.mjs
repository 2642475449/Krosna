// Exercises the real React Terminal, xterm DOM, and project CSS for scrollbar visibility and pointer passthrough.
// Usage: node scripts/verify-terminal-scrollbar.mjs [--playwright <path>] [--browser <exe>]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const defaultPlaywright = ".codex-tmp/terminal-render-check/node_modules/playwright-core";
const playwrightArg = option("--playwright", defaultPlaywright);
const { chromium } = require(playwrightArg.startsWith(".") ? path.resolve(root, playwrightArg) : playwrightArg);
const defaultBrowser = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browserPath = option("--browser", defaultBrowser);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const { createServer: createViteServer } = await import("vite");

const noopExports = (names) => names.split(" ").map((name) => `export const ${name} = () => {};`).join("\n");
const mocks = {
  "@xterm/xterm": `
    import { Terminal as RealTerminal } from ${JSON.stringify(require.resolve("@xterm/xterm").replaceAll("\\", "/"))};
    export class Terminal extends RealTerminal {
      constructor(options) { super(options); window.fixture.terminals.push(this); }
    }
  `,
  "@/store": `export const useAppStore = Object.assign(select => select(window.fixture.state), {
    getState: () => window.fixture.state, subscribe: () => () => {},
  });`,
  "@/store/slices/shortcutSlice": `export const useShortcutStore = { getState: () => ({ overrides: {} }) };`,
  "@/hooks/useResumeSession": `export const useResumeSession = () => () => {};`,
  "@/store/slices/sessionTitleSlice": noopExports("setSessionTitlePrompt"),
  "@/lib/auxiliaryDock": noopExports("openAuxiliaryFile openAuxiliaryQuestion"),
  "@/components/SideQuestionComposer": `export const SideQuestionComposer = () => null;`,
  "@/components/terminal/TerminalLinkDialog": `export const TerminalLinkDialog = () => null;`,
  "react-i18next": `const t = key => key; export const useTranslation = () => ({ t });`,
  "antd": `export const Dropdown = ({children}) => children; export const Button = () => null;
    export const Modal = {}; export const message = { error: console.error, warning: console.warn };`,
  "@tauri-apps/api/window": `export const getCurrentWindow = () => ({ onDragDropEvent: async () => () => {} });`,
  "@tauri-apps/api/event": `export const listen = async () => () => {}; export const emit = async () => {};`,
  "@/lib/api": `
    export const listenPtyEvent = async (name, listener) => {
      const listeners = window.fixture.listeners[name] ??= new Set(); listeners.add(listener);
      return () => listeners.delete(listener);
    };
    export const ptyInput = async (id, data) => { window.fixture.inputs.push({ id, data }); };
    export const ptyResize = async (...args) => { window.fixture.resizes.push(args); };
    export const ptyGetSize = async () => null;
    export const inspectAgentClis = async () => [];
    ${noopExports("inferAgentUserResponse inferAgentInterrupt inspectProjectFile resolveTerminalLink openInAssociatedApplication openInFileManager readImagePreview saveTerminalClipboardImage retainClipboardImage openExternalUrl")}
  `,
  "@/store/slices/terminalRecovery": `
    export const registerTerminalRecovery = () => () => {};
    export const loadTerminalRecovery = async () => null;
    export const useTerminalRecoveryStore = { getState: () => ({ setHistorySession() {} }) };
    ${noopExports("markTerminalRecoveryDirty markTerminalRecoveryReady")}
  `,
  "@/store/slices/runnerOutput": `
    export const registerRunnerOutputTerminal = () => () => {};
    export const useRunnerOutputStore = { getState: () => ({ entries: {} }) };
    ${noopExports("failRunnerOutputRestore markRunnerOutputExited markRunnerOutputRestored")}
  `,
};

const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { flushSync } from 'react-dom';
  import Terminal from './src/components/Terminal';
  const noop = () => {};
  const sessions = [{
    id: 'main', name: 'main', path: 'D:/synthetic', agentId: 'codex', active: true,
    status: 'waiting', createdAt: Date.now(),
  }];
  window.fixture = { terminals: [], listeners: {}, inputs: [], resizes: [], state: {
    sessions, projectSessions: {}, terminalExitCodeBySession: {},
    activeTheme: () => 'dark-starry', terminalFontSize: 16, terminalCursorBlink: false,
    terminalScrollback: 5000, terminalRenderer: 'standard',
    activeSessionId: 'main', resourceDragState: null, currentProject: { path: 'D:/synthetic' },
    setResourceDragState: noop, updateSession: noop, openFileTab: noop,
    setTerminalCompletionIntegration: noop,
  } };
  const root = createRoot(document.getElementById('root'));
  flushSync(() => root.render(<section id="main"><Terminal sessionId="main" /></section>));
  window.sendOutput = async (id, data) => {
    await Promise.all([...window.fixture.listeners['pty-output']].map(listener => listener({ payload: { session_id: id, data } })));
  };
`;

const compiled = await build({
  stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, outfile: "fixture.js", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@": path.join(root, "src") },
  plugins: [{
    name: "desktop-service-stubs",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => (args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: mocks[args.path], loader: "js", resolveDir: root }));
    },
  }],
});

const js = compiled.outputFiles.find((file) => file.path.endsWith(".js")).text;
const xtermCss = compiled.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
const viteServer = await createViteServer({
  root,
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});
const cssResult = await viteServer.transformRequest("/src/styles/global.css?direct");
await viteServer.close();
const fullCss = xtermCss + "\n" + (cssResult?.code ?? "");

const html = `<!doctype html><html data-theme="dark-starry"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css">
<style>html,body{margin:0;height:100%}#root{display:flex;height:400px}section{display:flex;width:800px;height:400px}section>div{flex:1;min-width:0}</style>
<body><div id="root"></div><script src="/fixture.js"></script></body></html>`;

const server = createServer((req, res) => {
  const content = req.url === "/fixture.js" ? ["text/javascript", js]
    : req.url === "/fixture.css" ? ["text/css", fullCss] : ["text/html", html];
  res.setHeader("Content-Type", content[0]);
  res.end(content[1]);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 450 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.fixture?.listeners["pty-output"]?.size === 1);
  await page.waitForTimeout(350);

  const inspectScrollbar = () => page.evaluate(() => {
    const surface = document.querySelector(".app-terminal-surface");
    const bar = surface.querySelector(".xterm-scrollable-element > .xterm-scrollbar.xterm-vertical");
    const slider = bar.querySelector(".xterm-slider");
    const barRect = bar.getBoundingClientRect();
    const sliderRect = slider.getBoundingClientRect();
    const centerX = sliderRect.width > 0 ? sliderRect.left + sliderRect.width / 2 : barRect.left + barRect.width / 2;
    const centerY = sliderRect.height > 0 ? sliderRect.top + sliderRect.height / 2 : barRect.top + barRect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    const term = window.fixture.terminals[0];
    return {
      needed: surface.dataset.scrollbarNeeded ?? null,
      active: surface.dataset.scrollbarActive ?? null,
      opacity: getComputedStyle(bar).opacity,
      pointerEvents: getComputedStyle(bar).pointerEvents,
      sliderWidth: sliderRect.width,
      sliderActive: slider.classList.contains("xterm-active"),
      hitClass: hit ? hit.className : null,
      hitIsScrollbar: Boolean(hit && (hit.closest(".xterm-scrollbar") || hit === bar || hit === slider)),
      baseY: term.buffer.active.baseY,
      viewportY: term.buffer.active.viewportY,
      centerX,
      centerY,
      barRect: { left: barRect.left, top: barRect.top, width: barRect.width, height: barRect.height },
    };
  });

  // 1. Short output: wheel, hover, drag must keep scrollbar hidden and pointer-transparent.
  await page.evaluate(() => window.sendOutput("main", "Short line 1\r\nShort line 2\r\n"));
  await page.waitForTimeout(100);
  await page.mouse.move(200, 200);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(50);
  let state = await inspectScrollbar();
  assert.equal(state.baseY, 0, "short output baseY should be 0");
  assert.equal(state.needed, null, "short output should not set data-scrollbar-needed");
  assert.equal(state.opacity, "0", "short output scrollbar must remain hidden after wheel");
  assert.equal(state.hitIsScrollbar, false, "short output pointer must pass through scrollbar");

  await page.mouse.move(state.centerX, state.centerY);
  await page.waitForTimeout(50);
  state = await inspectScrollbar();
  assert.equal(state.opacity, "0", "short output scrollbar must remain hidden on hover");
  assert.equal(state.hitIsScrollbar, false, "short output hover must pass through scrollbar");

  await page.mouse.down();
  await page.mouse.move(state.centerX, Math.max(10, state.centerY - 80));
  state = await inspectScrollbar();
  assert.equal(state.sliderActive, false, "short output drag must not activate slider");
  assert.equal(state.viewportY, 0, "short output viewportY must stay 0");
  await page.mouse.up();

  // 2. Alternate buffer: still hidden and pointer-transparent.
  await page.evaluate(() => window.sendOutput("main", "\x1b[?1049hAlt screen line\r\n"));
  await page.waitForTimeout(100);
  await page.mouse.move(200, 200);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(50);
  state = await inspectScrollbar();
  assert.equal(state.needed, null, "alternate buffer must not set data-scrollbar-needed");
  assert.equal(state.opacity, "0", "alternate buffer scrollbar must remain hidden");
  assert.equal(state.hitIsScrollbar, false, "alternate buffer pointer must pass through");

  // Exit alternate buffer, then emit multi-screen history.
  await page.evaluate(async () => {
    await window.sendOutput("main", "\x1b[?1049l");
    const lines = Array.from({ length: 120 }, (_, i) => `Line ${i} terminal scrollback check`).join("\r\n");
    await window.sendOutput("main", lines);
  });
  await page.waitForTimeout(150);

  // 3. Long output: wheel reveals 4px slider, fades out after ~700ms.
  await page.mouse.move(200, 200);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(200);
  state = await inspectScrollbar();
  assert.equal(state.needed, "true", "long output should set data-scrollbar-needed=true");
  assert.equal(state.active, "true", "wheel should set data-scrollbar-active=true");
  assert.equal(state.opacity, "1", "long output scrollbar should be visible on wheel");
  assert.equal(state.sliderWidth, 6, "default slider width should be 6px");

  await page.waitForTimeout(750);
  state = await inspectScrollbar();
  assert.equal(state.active, null, "data-scrollbar-active should clear after 700ms");
  assert.equal(state.opacity, "0", "scrollbar should fade out when idle in terminal body");

  // Hover rail -> 6px, drag up even horizontally outside rail -> viewportY decreases and stays visible.
  await page.mouse.move(state.centerX, state.centerY);
  await page.waitForTimeout(200);
  state = await inspectScrollbar();
  assert.equal(state.opacity, "1", "hovering rail should reveal scrollbar");
  assert.equal(state.sliderWidth, 8, "hovering rail should expand slider to 8px");
  assert.equal(state.hitIsScrollbar, true, "long output pointer should hit scrollbar");

  const viewportBeforeDrag = state.viewportY;
  await page.mouse.down();
  await page.mouse.move(state.centerX - 80, state.barRect.top + 8);
  await page.waitForTimeout(100);
  state = await inspectScrollbar();
  assert.equal(state.sliderActive, true, "dragging slider should keep xterm-active");
  assert.equal(state.opacity, "1", "dragging outside rail horizontally must keep scrollbar visible");
  assert.ok(state.viewportY < viewportBeforeDrag, `dragging up should decrease viewportY (${state.viewportY} < ${viewportBeforeDrag})`);
  assert.equal(state.viewportY, 0, "dragging to top should reach viewportY=0");

  // Drag back down from top (viewportY=0).
  await page.mouse.move(state.centerX - 80, state.barRect.top + state.barRect.height - 8);
  await page.waitForTimeout(100);
  state = await inspectScrollbar();
  assert.ok(state.viewportY > 0, `dragging back down from top should increase viewportY (${state.viewportY})`);
  await page.mouse.up();

  // 4. Enter alternate buffer (hidden) -> exit back to normal buffer with history (immediately draggable).
  await page.evaluate(() => window.sendOutput("main", "\x1b[?1049h"));
  await page.waitForTimeout(100);
  state = await inspectScrollbar();
  assert.equal(state.needed, null, "entering alternate buffer clears data-scrollbar-needed");
  await page.evaluate(() => window.sendOutput("main", "\x1b[?1049l"));
  await page.waitForTimeout(100);
  state = await inspectScrollbar();
  assert.equal(state.needed, "true", "leaving alternate buffer restores data-scrollbar-needed");

  // Clear history -> restores pointer passthrough.
  await page.evaluate(() => window.fixture.terminals[0].clear());
  await page.waitForTimeout(100);
  state = await inspectScrollbar();
  assert.equal(state.baseY, 0, "clear() should reset baseY to 0");
  assert.equal(state.needed, null, "clear() should remove data-scrollbar-needed");
  assert.equal(state.opacity, "0", "clear() should hide scrollbar");
  assert.equal(state.hitIsScrollbar, false, "clear() should restore pointer passthrough");

  assert.deepEqual(errors, [], `unexpected page errors: ${errors.join("; ")}`);
  console.log("PASS: terminal scrollbar regression checks passed.");
} finally {
  await browser?.close();
  server.close();
}
