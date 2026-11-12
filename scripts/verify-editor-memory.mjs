// npm install --prefix .codex-tmp/terminal-render-check --no-save --package-lock=false playwright-core
// node scripts/verify-editor-memory.mjs --playwright .codex-tmp/terminal-render-check/node_modules/playwright-core --browser "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
// Uses a temporary browser profile and synthetic content. No production WebView or project files are read.
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const require = createRequire(import.meta.url);
const playwright = option("--playwright", "playwright-core");
const { chromium } = require(playwright.startsWith(".") ? path.resolve(root, playwright) : playwright);
const output = path.resolve(root, option("--output", ".codex-tmp/editor-memory-results"));
const server = await createServer({
  configFile: false, root, plugins: [react()], cacheDir: path.join(root, "node_modules/.vite-editor-memory-probe"),
  resolve: { alias: [
    { find: "@", replacement: path.join(root, "src") },
    { find: /^antd$/, replacement: path.join(root, "src/lib/antd.ts") },
  ] },
  optimizeDeps: { entries: ["scripts/editor-memory-probe.html"] },
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
const errors = [], workers = [], nativeCalls = [], samples = [];
let failure;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: option("--browser", undefined), headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 700 } });
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  page.on("worker", (worker) => workers.push(worker.url()));
  await page.exposeFunction("recordNativeCall", (command) => nativeCalls.push(command));
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = { invoke: async (command) => {
      await window.recordNativeCall(command);
      if (command === "inspect_agent_clis") return [];
      throw new Error(`Unexpected native IPC in isolated fixture: ${command}`);
    } };
  });
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}/scripts/editor-memory-probe.html`);
  const waitModels = (count) => page.waitForFunction((expected) => window.editorMemoryProbe?.snapshot().models === expected, count);
  const sample = async (label) => { const value = await page.evaluate(() => window.editorMemoryProbe.snapshot()); samples.push({ label, ...value }); return value; };
  const setActive = (left, right, diff) => page.evaluate((active) => window.editorMemoryProbe.setActive(active), { left, right, diff });
  await waitModels(3); // One text model and the diff's two models; no hidden HTML model.
  await page.evaluate(() => window.editorMemoryProbe.position());
  await page.evaluate(() => window.editorMemoryProbe.diffPosition());
  const positioned = await sample("visible-text-and-diff");
  await setActive(false, false, false);
  await waitModels(0);
  await sample("all-pristine-hidden");
  await setActive(false, false, true);
  await waitModels(2);
  await page.waitForFunction(() => window.editorMemoryProbe.snapshot().diff.position.lineNumber === 90);
  const restoredDiff = await sample("diff-restored");
  assert.deepEqual(restoredDiff.diff.position, positioned.diff.position);
  assert(Math.abs(restoredDiff.diff.scrollTop - positioned.diff.scrollTop) < 3, "Diff scroll position was not restored");
  for (let cycle = 0; cycle < 5; cycle++) {
    await setActive(false, false, false); await waitModels(0);
    await setActive(false, false, true); await waitModels(2);
    await page.evaluate(() => window.editorMemoryProbe.diffPosition());
  }
  await sample("rapid-diff-switches");
  await setActive(true, true, false);
  await waitModels(2);
  await page.waitForFunction(() => window.editorMemoryProbe.snapshot().left.position.lineNumber === 80);
  const restored = await sample("two-visible-panes");
  assert.notEqual(restored.left.model, positioned.left.model);
  assert.deepEqual(restored.left.position, positioned.left.position);
  assert(Math.abs(restored.left.scrollTop - positioned.left.scrollTop) < 3, "Scroll position was not restored");
  await page.evaluate(() => window.editorMemoryProbe.edit());
  await page.waitForFunction(() => window.editorMemoryProbe.snapshot().left.value.startsWith("// edit\n"));
  const edited = await sample("edited");
  await setActive(false, false, false);
  await waitModels(1);
  await sample("edited-model-retained");
  await setActive(true, false, false);
  await waitModels(1);
  assert.equal((await sample("edited-restored")).left.model, edited.left.model);
  await page.evaluate(() => window.editorMemoryProbe.undo());
  await page.waitForFunction(() => window.editorMemoryProbe.snapshot().left.value.startsWith("const value0"));
  await sample("undo-after-switch");
  const tokens = await page.evaluate(() => window.editorMemoryProbe.tokens());
  assert(tokens.some((token) => token.includes("keyword")), "TypeScript highlighting was lost");
  assert.equal(await page.evaluate(() => window.editorMemoryProbe.json()), true, "JSON diagnostics were lost");
  assert(workers.some((url) => url.includes("json.worker")), "JSON worker was not exercised");
  assert(!workers.some((url) => /(?:ts|html|css)\.worker/.test(url)), "A compiler language worker started");
  await page.evaluate(() => window.editorMemoryProbe.close());
  await waitModels(0);
  await sample("closed");
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error);
  process.exitCode = 1;
} finally {
  await mkdir(output, { recursive: true });
  // Report positions, identities and counts; the content is synthetic, but need not be duplicated.
  const report = { passed: !failure, failure, browser: browser ? await browser.version() : null,
    environment: "isolated headless browser; not packaged Tauri WebView2", workers, nativeCalls, errors,
    samples: samples.map(({ left, ...sample }) => ({ ...sample, left: left && { ...left, value: undefined } })),
  };
  await writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser?.close();
  await server.close();
}
