// 隔离宿主启动后运行：node scripts/run-memory-regression.mjs <新的报告文件路径>
// 仅连接本机诊断端口，不连接生产窗口；自然回落和强制 GC 分开记录。
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const reportPath = process.argv[2];
const natural = process.argv.includes("--natural");
if (!reportPath) throw new Error("Provide a new JSON report path");
const pages = await (await fetch("http://127.0.0.1:9224/json/list")).json();
const page = pages.find((p) => p.url === "http://127.0.0.1:1431/scripts/memory-regression-probe.html");
assert(page, "Isolated diagnostic page not found");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const requests = new Map();
const errors = [];
const samples = [];
socket.onclose = () => {
  for (const request of requests.values()) request.reject(new Error("Diagnostic host closed"));
  requests.clear();
};
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = requests.get(message.id);
    requests.delete(message.id);
    if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
    else request?.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(new Error("Diagnostic host is not connected")); return; }
    const id = ++sequence;
    const timeout = setTimeout(() => { requests.delete(id); reject(new Error(`${method} timed out`)); }, 90_000);
    requests.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function sample(label, gc = false) {
  if (gc) await send("HeapProfiler.collectGarbage");
  const snapshot = await evaluate(`window.memoryRegression.sample(${JSON.stringify(label)})`);
  const dom = await send("Memory.getDOMCounters");
  const result = { at: new Date().toISOString(), gc, ...snapshot, dom };
  samples.push(result);
  console.log(JSON.stringify(result));
  return result;
}
let failure;
try {
  await send("Runtime.enable");
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate("Boolean(window.memoryRegression)")) break;
    await delay(500);
  }
  assert(await evaluate("Boolean(window.memoryRegression)"), "Fixture failed to load");
  await evaluate("window.memoryRegression.previews(1)");
  await evaluate("window.memoryRegression.closeDiffs()");
  await delay(1500);
  await sample("warm-baseline", true);
  for (let cycle = 1; cycle <= 3; cycle++) {
    const preview = await evaluate("window.memoryRegression.previews()");
    assert.equal(preview.documents, 1); assert.equal(preview.tabs, 1); assert.equal(preview.models, 2);
    await sample(`preview-${cycle}-loaded`);
    const closed = await evaluate("window.memoryRegression.closeDiffs()");
    assert.equal(closed.documents, 0); assert.equal(closed.tabs, 0); assert.equal(closed.models, 0);
    await delay(2000);
    await sample(`preview-${cycle}-closed-natural`);
    if (!natural) await sample(`preview-${cycle}-closed-gc`, true);
  }
  for (let cycle = 1; cycle <= 3; cycle++) {
    let done = false;
    let maxPending = 0;
    const output = evaluate("window.memoryRegression.output()").finally(() => { done = true; });
    while (!done) {
      await delay(250);
      const [bytes, messages] = await evaluate("window.memoryRegression.pending()");
      maxPending = Math.max(maxPending, bytes);
      assert(bytes <= 256 * 1024 && messages <= 128, "Transport exceeded its window budget");
    }
    const closed = await output;
    assert.equal(closed.received, 64 * 1024 * 1024); assert.equal(closed.parsed, closed.received);
    assert.deepEqual(closed.pending, [0, 0]);
    samples.push({ at: new Date().toISOString(), ...closed, label: `output-${cycle}-delivery`, maxPending });
    await delay(3000);
    await sample(`output-${cycle}-closed-natural`);
    if (!natural) await sample(`output-${cycle}-closed-gc`, true);
  }
  if (natural) {
    for (let elapsed = 15; elapsed <= 30; elapsed += 15) {
      await delay(15_000);
      await sample(`all-closed-idle-${elapsed}s`);
    }
    await sample("all-closed-final-gc", true);
  }
  assert.deepEqual(errors, [], "WebView emitted uncaught exceptions");
} catch (error) {
  failure = String(error);
  console.error(failure);
} finally {
  await writeFile(reportPath, JSON.stringify({ passed: !failure, failure, samples, errors }, null, 2), { flag: "wx" });
  socket.close();
}
if (failure) process.exitCode = 1;
