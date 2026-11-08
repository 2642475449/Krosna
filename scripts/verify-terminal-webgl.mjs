// Browser pixel regression for xterm's shared WebGL atlas. This never opens a
// user terminal or reads clipboard/session data. Run with a local playwright-core:
// npm install --prefix .codex-tmp/terminal-render-check --no-save --package-lock=false playwright-core
// node scripts/verify-terminal-webgl.mjs --playwright .codex-tmp/terminal-render-check/node_modules/playwright-core --browser "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
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
const output = path.resolve(root, option("--output", ".codex-tmp/terminal-webgl-results"));
const deviceScaleFactor = Number(option("--dpr", "1"));
const theme = option("--theme", "dark") === "light"
  ? { background: "#ffffff", foreground: "#333333" }
  : { background: "#171b22", foreground: "#d8dee9" };
await mkdir(output, { recursive: true });
const versions = Object.fromEntries(await Promise.all(["@xterm/xterm", "@xterm/addon-webgl"].map(async name => [name, JSON.parse(await readFile(require.resolve(`${name}/package.json`), "utf8")).version])));

const fixture = `
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
const terms = [], addons = [];
const options = { cols: 80, rows: 24, fontSize: 16, fontFamily: 'monospace', cursorBlink: false, cursorStyle: 'bar', allowProposedApi: true, scrollback: 1000, theme: ${JSON.stringify(theme)} };
let atlasRemovalEvents = 0;
for (let i = 0; i < 2; i++) {
  const term = new Terminal(options);
  term.open(document.getElementById('t' + i));
  const addon = new WebglAddon(${versions["@xterm/addon-webgl"] === "0.19.0" ? "true" : "{ preserveDrawingBuffer: true }"});
  term.loadAddon(addon); terms.push(term); addons.push(addon);
  addon.onRemoveTextureAtlasCanvas(() => atlasRemovalEvents++);
}
const settle = async () => { for (let i=0;i<4;i++) await new Promise(requestAnimationFrame); };
const write = async (index, data) => { await new Promise(resolve => terms[index].write(data, resolve)); await settle(); };
function rowPixels(index) {
  const renderer = terms[index]._core._renderService._renderer.value;
  const canvas = renderer._canvas;
  const gl = canvas.getContext('webgl2');
  const height = Math.ceil(renderer.dimensions.device.cell.height);
  const pixels = new Uint8Array(canvas.width * height * 4);
  gl.readPixels(0, canvas.height - height, canvas.width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return [...pixels];
}
function difference(a, b) { if (a.length !== b.length) return 1; let n=0; for(let i=0;i<a.length;i++) if(a[i]!==b[i])n++; return n/a.length; }
const header = 'Shared header ABCDE 12345 中文字形缓存测试';
window.runRegression = async () => {
  await write(1, header + '\\r\\n');
  const rendererA = terms[0]._core._renderService._renderer.value;
  const rendererB = terms[1]._core._renderService._renderer.value;
  const shared = rendererA._charAtlas === rendererB._charAtlas;
  if (!shared) throw new Error('Fixture did not create a shared atlas');
  await window.capture('reference');
  const reference = rowPixels(1);
  const background = ${JSON.stringify([0,1,2].map(i => Number.parseInt(theme.background.slice(1 + i*2,3 + i*2),16)))};
  if (!reference.some((v, i) => i%4 !== 3 && Math.abs(v-background[i%4]) > 8)) throw new Error('Empty framebuffer reference; canvas=' + rendererB._canvas.width + 'x' + rendererB._canvas.height + '; cell=' + rendererB.dimensions.device.cell.height);
  addons[0].clearTextureAtlas();
  let flood = '\\x1b[2;1H';
  for (let i=0;i<23*78;i++) flood += '\\x1b[38;5;' + (16+i%200) + 'm' + String.fromCharCode(33+i%90);
  await write(0, flood + '\\x1b[0m');
  await write(1, '\\x1b[24;1Hx');
  const afterClear = difference(reference, rowPixels(1));
  const bufferUnchanged = terms[1].buffer.active.getLine(0).translateToString(true) === header;
  await window.capture('after-shared-clear');

  // A clean reference, then stress both shared owners with distinct CJK glyphs
  // and selection-color variants, leaving terminal B's first row unchanged.
  for (const term of terms) term.resize(81, 24);
  for (const term of terms) term.resize(80, 24);
  await settle();
  const churnReference = rowPixels(1);
  // Force page merges at a small cap so the test exercises layout invalidation
  // without depending on the GPU's texture-unit limit or a huge glyph corpus.
  rendererA._charAtlas.constructor.maxAtlasPages = 4;
  for (let batch=0;batch<20;batch++) {
    let text = '\\x1b[2;1H';
    for(let i=0;i<300;i++) text += '\\x1b[38;5;' + (16+i%200) + 'm' + String.fromCharCode(0x4e00+batch*300+i);
    await write(0, text + '\\x1b[0m');
    terms[0].select(0, 1, 100);
    terms[0].clearSelection();
    await write(1, '\\x1b[24;1H' + (batch%10));
  }
  const afterGlyphChurn = difference(churnReference, rowPixels(1));
  terms[1].select(0, 0, 30); await settle();
  terms[1].clearSelection(); await settle();
  const afterSelection = difference(churnReference, rowPixels(1));
  await window.capture('after-churn-and-selection');
  document.getElementById('t1').style.display='none'; await settle();
  document.getElementById('t1').style.display='block';
  terms[1].refresh(0,23); await settle();
  const afterReveal = difference(churnReference, rowPixels(1));
  addons[1].dispose(); await settle();
  const replacement = new WebglAddon(${versions["@xterm/addon-webgl"] === "0.19.0" ? "true" : "{ preserveDrawingBuffer: true }"});
  terms[1].loadAddon(replacement); terms[1].refresh(0,23); await settle();
  const afterReattach = difference(churnReference, rowPixels(1));
  return { shared, bufferUnchanged, afterClear, afterGlyphChurn, afterSelection, afterReveal,
    afterReattach, atlasRemovalEvents, atlasPages: rendererA._charAtlas.pages.length,
    pass: bufferUnchanged && atlasRemovalEvents > 0 && [afterClear,afterGlyphChurn,afterSelection,afterReveal,afterReattach].every(x => x < 0.001) };
};
window.fixtureReady = true;
`;
const compiled = await build({ stdin: { contents: fixture, resolveDir: root, sourcefile: "terminal-webgl-fixture.js" }, bundle: true, write: false, format: "iife", platform: "browser", target: "es2022" });
const js = compiled.outputFiles[0].text;
const css = await readFile(require.resolve("@xterm/xterm/css/xterm.css"), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/xterm.css"><style>body{margin:0;background:#171b22;color:#d8dee9}main{display:flex;gap:12px;padding:12px}.term{width:810px;height:480px}</style></head><body><main><div class="term" id="t0"></div><div class="term" id="t1"></div></main><script src="/fixture.js"></script></body></html>`;
const server = createServer((req, res) => {
  const content = req.url === "/fixture.js" ? ["text/javascript", js] : req.url === "/xterm.css" ? ["text/css", css] : ["text/html", html];
  res.setHeader("Content-Type", content[0]); res.end(content[1]);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  // Use actual Chromium scaling rather than CDP device emulation: emulation
  // can report a different DPR from ResizeObserver's devicePixelContentBoxSize.
  browser = await chromium.launch({ executablePath: option("--browser", undefined), headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", `--force-device-scale-factor=${deviceScaleFactor}`, "--window-size=1700,540"] });
  const page = await browser.newPage({ viewport: null });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.exposeFunction("capture", name => page.screenshot({ path: path.join(output, `${name}.png`) }).then(() => undefined));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.fixtureReady === true);
  const result = await page.evaluate(() => window.runRegression());
  const report = { versions, browser: await browser.version(), deviceScaleFactor, theme, renderer: "headless Edge / ANGLE SwiftShader; not desktop WebView2", ...result, errors };
  await writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!result.pass || errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
