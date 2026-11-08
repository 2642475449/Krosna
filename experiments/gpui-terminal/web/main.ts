import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import "./style.css";

interface Packet { session: number; seq: number; read_us: number; data: string }
interface Config { sessions: number; rate: number; interactive: boolean }
const terms: Terminal[] = [];
const pending: Packet[] = [];
let initialized = false;
let acknowledgements = Promise.resolve();
const parsedSamples: { packet: Packet; parse_us: number; byte_count: number }[] = [];
const tails: string[] = [];
const encoder = new TextEncoder();
let painted = 0;
function consume(packet: Packet) {
  const start = performance.now();
  terms[packet.session].write(packet.data, () => {
    const parse_us = (performance.now() - start) * 1000;
    // Return only probe markers, never retransmit the entire PTY payload.
    const text = (tails[packet.session] ?? "") + packet.data;
    const markers = [...text.matchAll(/\x1b\]777;echo=\d+\x07/g)];
    const consumed = markers.length ? markers.at(-1)!.index! + markers.at(-1)![0].length : 0;
    tails[packet.session] = text.slice(consumed).slice(-128);
    const summary = { ...packet, data: markers.map(m => m[0]).join("") };
    const byteCount = encoder.encode(packet.data).length;
    parsedSamples.push({ packet: summary, parse_us, byte_count: byteCount });
  });
}
await listen<Packet>("eval-output", ({ payload }) => {
  if (!initialized) pending.push(payload); else consume(payload);
});
const config = await invoke<Config>("start_workload");
let active = 0;
for (let i = 0; i < config.sessions; i++) {
  const host = document.createElement("div");
  host.className = "terminal";
  host.style.display = i === 0 ? "block" : "none";
  document.querySelector("#terminals")!.append(host);
  const term = new Terminal({ cols: 100, rows: 28, scrollback: 1000, fontFamily: "Cascadia Mono", fontSize: 14, lineHeight: 18 / 14, theme: { background: "#171b22", foreground: "#d8dee9" }, allowProposedApi: true });
  term.open(host);
  try { term.loadAddon(new WebglAddon()); } catch (error) { document.querySelector("#status")!.textContent = `WebGL failed: ${error}`; throw error; }
  term.onData(data => { void invoke("input", { session: i, data }); });
  term.onRender(() => { painted++; });
  const button = document.createElement("button");
  button.textContent = `Session ${i + 1}`;
  button.onclick = () => {
    (terms[active].element!.parentElement!).style.display = "none";
    active = i; host.style.display = "block"; term.focus();
  };
  document.querySelector("#tabs")!.append(button);
  terms.push(term);
}
initialized = true;
pending.splice(0).forEach(consume);
terms[0].focus();
document.querySelector("#status")!.textContent = `xterm.js / WebGL / Tauri | ${config.sessions} sessions | ${config.rate / 1024} KiB/s per PTY | fixed 100x28`;
let previous = performance.now();
function frame(now: number) {
  const gapMs = now - previous;
  const samples = parsedSamples.splice(0);
  const renderCount = painted;
  painted = 0;
  // One return IPC batch per frame, rather than an ACK IPC per PTY chunk.
  acknowledgements = acknowledgements.then(async () => {
    if (samples.length) await invoke("parsed", { samples });
    await invoke("tick", { gapMs, painted: renderCount });
  });
  previous = now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
