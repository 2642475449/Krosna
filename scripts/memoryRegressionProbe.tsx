// 仅由隔离诊断宿主加载：临时 profile、合成正文，不接触实际项目和生产设置。
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../src/store";
import { createDefaultWorkspace } from "../src/store/utils/workspace";
import { MonacoDiffEditor } from "../src/components/editors/MonacoDiffEditor";
import * as monaco from "../src/lib/monacoRuntime";
import { listenPtyEvent } from "../src/lib/api/ptyEvents";
import { createTerminalOutputAcknowledgements } from "../src/lib/terminalOutputAcknowledgements";
import { createTerminalOutputFrameGate } from "../src/lib/terminalOutputFrames";
import { createTerminalImeOutputGate } from "../src/lib/terminalImeOutput";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const project = "C:/synthetic-memory-regression";
useAppStore.setState({ currentProject: { path: project, name: "synthetic" }, projectWorkspaces: { [project]: createDefaultWorkspace() } });
const root = createRoot(document.getElementById("diff")!);
const results: unknown[] = [];
let phase = "ready";
let received = 0;
let parsed = 0;
function sample(label: string) {
  const value = { label, documents: Object.keys(useAppStore.getState().gitDiffDocuments).length,
    tabs: useAppStore.getState().openTabs.length, models: monaco.editor.getModels().length,
    received, parsed,
    heap: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize };
  results.push(value);
  return value;
}
function body(seed: number) {
  const bytes = new Uint8Array(256 * 1024);
  let value = seed + 1;
  for (let i = 0; i < bytes.length; i++) {
    value = (Math.imul(value, 1664525) + 1013904223) | 0;
    bytes[i] = i % 100 === 99 ? 10 : 32 + ((value >>> 0) % 90);
  }
  return new TextDecoder().decode(bytes);
}
async function previews(count = 100) {
  phase = "previews";
  for (let index = 0; index < count; index++) {
    const id = useAppStore.getState().openGitDiffTab({ path: `file-${index}.txt`, name: `file-${index}.txt`,
      staged: false, originalContent: body(index * 2), modifiedContent: body(index * 2 + 1),
      originalLabel: "before", modifiedLabel: "after", isBinary: false }, { preview: true })!;
    const value = useAppStore.getState().gitDiffDocuments[id];
    flushSync(() => root.render(<MonacoDiffEditor key={id} original={value.originalContent} modified={value.modifiedContent}
      language="plaintext" options={{ readOnly: true, automaticLayout: false, maxComputationTime: 20 }} />));
    await delay(20);
  }
  phase = "previews-done";
  return sample(phase);
}
function closeDiffs() {
  flushSync(() => root.render(null));
  for (const id of useAppStore.getState().openTabs) useAppStore.getState().closeTab(id);
  phase = "diffs-closed";
  return sample(phase);
}
async function output() {
  phase = "output";
  received = 0; parsed = 0;
  const terminal = new Terminal({ cols: 160, rows: 40, scrollback: 5000 });
  terminal.open(document.getElementById("terminal")!);
  const ack = createTerminalOutputAcknowledgements({ buffered: () => frame.getPendingWriteChars() + ime.getBufferedChars() > 0,
    afterParsed: (done) => terminal.write("", done) });
  const ime = createTerminalImeOutputGate((text) => { terminal.write(text); ack.schedule(); });
  const frame = createTerminalOutputFrameGate((text) => ime.write(text), { enabled: true });
  const stop = await listenPtyEvent("pty-output", ({ payload }) => {
    received += payload.data.length;
    return ack.track(() => frame.write(payload.data)).then(() => { parsed += payload.data.length; });
  });
  const stopExit = await listenPtyEvent("pty-exit", () => frame.flush());
  const bytes = await invoke<number>("probe_output");
  while (parsed !== bytes) await delay(20);
  sample("output-parsed");
  frame.dispose(); ime.dispose(); ack.dispose(); terminal.dispose(); stop(); stopExit();
  document.getElementById("terminal")!.replaceChildren();
  const pending = await invoke("probe_pending");
  phase = "output-closed";
  return { ...sample(phase), pending };
}
Object.assign(window, { memoryRegression: { previews, closeDiffs, output, sample,
  pending: () => invoke("probe_pending"),
  state: () => ({ phase, results, received, parsed }), models: () => monaco.editor.getModels().length } });
sample("ready");
