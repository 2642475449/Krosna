// Exercises the real React Terminal and xterm renderers with synthetic PTY events.
// Desktop services are stubbed; this does not access user terminals or clipboard.
// node scripts/verify-terminal-theme.mjs --playwright .codex-tmp/terminal-render-check/node_modules/playwright-core --browser "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const playwrightPath = option("--playwright", "playwright-core");
const { chromium } = require(playwrightPath.startsWith(".") ? path.resolve(root, playwrightPath) : playwrightPath);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const sharp = require("sharp");
const output = path.resolve(root, option("--output", ".codex-tmp/terminal-theme-results"));
const terminalSource = option("--terminal-source", undefined);
await mkdir(output, { recursive: true });

const noopExports = (names) => names.split(" ").map(name => `export const ${name} = () => {};`).join("\n");
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
    ${noopExports("inferAgentUserResponse inferAgentInterrupt inspectProjectFile resolveTerminalLink openInAssociatedApplication readImagePreview saveTerminalClipboardImage retainClipboardImage openExternalUrl")}
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
  import { getTerminalTheme } from './src/lib/terminalTheme';
  const noop = () => {};
  const sessions = ['main', 'hidden', 'runner'].map(id => ({
    id, name: id, path: 'D:/synthetic', agentId: 'codex', active: true,
    status: 'waiting', createdAt: Date.now(),
  }));
  window.fixture = { terminals: [], listeners: {}, inputs: [], resizes: [], state: {
    sessions, projectSessions: {}, terminalExitCodeBySession: {},
    activeTheme: () => window.fixture.theme, terminalFontSize: 16, terminalCursorBlink: false,
    terminalScrollback: 5000, terminalRenderer: new URLSearchParams(location.search).get('renderer'),
    activeSessionId: null, resourceDragState: null, currentProject: { path: 'D:/synthetic' },
    setResourceDragState: noop, updateSession: noop, openFileTab: noop,
    setTerminalCompletionIntegration: noop,
  }, theme: 'light-glass', revealed: false };
  const runnerOptions = { autoScroll: false, wordWrap: true,
    onAutoScrollChange: noop, onReady: noop, onCommandComplete: noop };
  const root = createRoot(document.getElementById('root'));
  window.renderFixture = () => flushSync(() => root.render(<>
    <section id="main"><Terminal sessionId="main" /></section>
    <section id="hidden" style={{display: window.fixture.revealed ? 'flex' : 'none'}}><Terminal sessionId="hidden" /></section>
    <section id="runner"><Terminal sessionId="runner" runnerOptions={runnerOptions} /></section>
  </>));
  window.setTheme = theme => {
    window.fixture.theme = theme;
    document.documentElement.dataset.theme = theme;
    window.renderFixture();
  };
  window.sendOutput = async (id, data) => {
    await Promise.all([...window.fixture.listeners['pty-output']].map(listener => listener({ payload: { session_id: id, data } })));
  };
  window.themeColors = theme => getTerminalTheme(theme).theme;
  window.renderFixture();
`;
const compiled = await build({
  stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, outfile: "fixture.js", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@": path.join(root, "src") },
  plugins: [{ name: "desktop-service-stubs", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js", resolveDir: root }));
    if (terminalSource) builder.onLoad({ filter: /[\\/]src[\\/]components[\\/]Terminal\.tsx$/ }, async () => ({
      contents: await readFile(path.resolve(root, terminalSource), "utf8"), loader: "tsx", resolveDir: path.join(root, "src/components"),
    }));
  } }],
});
const js = compiled.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = compiled.outputFiles.find(file => file.path.endsWith(".css")).text;
const themes = await readFile(path.join(root, "src/styles/themes.css"), "utf8");
const html = `<!doctype html><html data-theme="light-glass"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css">
<style>body{margin:0}#root{display:flex;gap:8px}section{display:flex;width:800px;height:400px}section>div{display:flex;flex:1;min-width:0}.app-terminal-surface{flex:1;min-width:0}</style>
<body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((req, res) => {
  const content = req.url === "/fixture.js" ? ["text/javascript", js]
    : req.url === "/fixture.css" ? ["text/css", themes + css] : ["text/html", html];
  res.setHeader("Content-Type", content[0]); res.end(content[1]);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: option("--browser", undefined), headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const results = [];
  for (const renderer of ["standard", "webgl"]) {
    const page = await browser.newPage({ viewport: { width: 2450, height: 460 } });
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    const captures = {};
    await page.exposeFunction("captureTheme", async name => {
      const buffer = await page.locator("#main").screenshot({ path: path.join(output, `${renderer}-${name}.png`) });
      const metadata = await sharp(buffer).metadata();
      // xterm animates scrollbar hover colors; compare only the text viewport.
      captures[name] = await sharp(buffer).extract({ left: 0, top: 0, width: metadata.width - 20, height: metadata.height }).ensureAlpha().raw().toBuffer();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?renderer=${renderer}`);
    await page.waitForFunction(() => window.fixture?.listeners['pty-output']?.size === 3);
    // Wait for the initial layout timers before testing without resize events.
    await page.waitForTimeout(350);
    const result = await page.evaluate(async () => {
      const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame); };
      const original = [...window.fixture.terminals];
      const history = Array.from({length: 70}, (_, i) => 'History ' + i + ' 中文 ABCDE 12345').join('\r\n');
      for (const id of ['main', 'hidden', 'runner']) await window.sendOutput(id, history);
      await settle();
      original[0].scrollToLine(5);
      original[0].select(0, 6, 12);
      const buffer = term => Array.from({length: term.buffer.active.length}, (_, i) => term.buffer.active.getLine(i).translateToString(true)).join('\n');
      const before = original.map(buffer);
      const viewport = original[0].buffer.active.viewportY;
      const selection = original[0].getSelection();
      const textarea = original[0].textarea;
      textarea.value = '尚未提交的输入';
      const sizes = original.map(term => [term.cols, term.rows]);
      const canvases = original.map(term => term.element.querySelector('canvas'));
      await settle(); await window.captureTheme('before');
      let sameInstances = true, contentPreserved = true, selectionPreserved = true, viewportPreserved = true, inputPreserved = true, sizePreserved = true;
      const themeNames = ['dark-starry', 'light-warm', 'dark-mocha', 'light-glass'];
      const palettes = [];
      for (const theme of [...themeNames, ...themeNames, ...themeNames]) {
        window.setTheme(theme); await settle();
        sameInstances &&= window.fixture.terminals.length === 3 && original.every((term, i) => term === window.fixture.terminals[i] && term.element.querySelector('canvas') === canvases[i]);
        if (!sameInstances) {
          await window.captureTheme('after');
          return { sameInstances: false, createdTerminals: window.fixture.terminals.length, themeChanges: palettes.length + 1 };
        }
        contentPreserved &&= original.every((term, i) => buffer(term) === before[i]);
        selectionPreserved &&= original[0].getSelection() === selection && selection.length > 0;
        viewportPreserved &&= original[0].buffer.active.viewportY === viewport;
        inputPreserved &&= original[0].textarea === textarea && textarea.value === '尚未提交的输入';
        sizePreserved &&= original.every((term, i) => term.cols === sizes[i][0] && term.rows === sizes[i][1]);
        palettes.push(original.every(term => term.options.theme.background === window.themeColors(theme).background));
      }
      await window.captureTheme('after');
      // A composition in progress must keep queued output when the palette changes.
      textarea.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}));
      void window.sendOutput('main', '\r\nOutput queued during IME');
      window.setTheme('dark-starry'); await settle();
      const imeHeld = !buffer(original[0]).includes('Output queued during IME');
      textarea.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true}));
      await new Promise(resolve => setTimeout(resolve, 50)); await settle();
      const imeDelivered = buffer(original[0]).includes('Output queued during IME');
      for (const id of ['main', 'hidden', 'runner']) await window.sendOutput(id, '\r\nLive after theme change');
      window.fixture.revealed = true; window.renderFixture(); await settle();
      const liveOutput = original.every(term => buffer(term).includes('Live after theme change'));
      original[0].clearSelection(); original[0].scrollToBottom(); await settle();
      original[0].input('z', true); await settle();
      const inputDeliveredOnce = window.fixture.inputs.filter(input => input.id === 'main' && input.data === 'z').length === 1;
      const webglActive = original.map(term => Boolean(term._core._renderService._renderer.value._gl));
      return { sameInstances, contentPreserved, selectionPreserved, viewportPreserved, inputPreserved, sizePreserved,
        palettesUpdated: palettes.every(Boolean), imeHeld, imeDelivered, liveOutput, inputDeliveredOnce, webglActive,
        outputListeners: window.fixture.listeners['pty-output'].size, themeChanges: palettes.length + 1 };
    });
    assert.equal(captures.before.length, captures.after.length);
    let differentChannels = 0;
    for (let i = 0; i < captures.before.length; i++) if (captures.before[i] !== captures.after[i]) differentChannels++;
    const pixelDifference = differentChannels / captures.before.length;
    await page.screenshot({ path: path.join(output, `${renderer}.png`) });
    const check = { renderer, ...result, pixelDifference, errors };
    results.push(check);
    await writeFile(path.join(output, "result.json"), JSON.stringify(results, null, 2));
    for (const [name, value] of Object.entries(result)) if (typeof value === "boolean") assert.equal(value, true, `${renderer}: ${name}`);
    assert.equal(result.outputListeners, 3, `${renderer}: duplicate/missing PTY listeners`);
    assert.ok(pixelDifference < 0.001, `${renderer}: screen pixels changed after returning to the original theme (${pixelDifference})`);
    assert.equal(result.webglActive.every(Boolean), renderer === "webgl", `${renderer}: renderer was not exercised`);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(JSON.stringify({ browser: await browser.version(), environment: "Headless Edge; desktop services stubbed, not desktop WebView2", results }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
