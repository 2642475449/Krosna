import type { Terminal } from "@xterm/xterm";

export interface WebviewMemorySample {
  supported: boolean;
  activeTerminals: number;
  renderer: {
    pid: number;
    workingSetBytes: number;
    privateWorkingSetBytes: number | null;
    privateCommitBytes: number;
    frameCount: number;
  } | null;
  heap: {
    usedSize: number;
    totalSize: number;
    embedderHeapUsedSize: number | null;
    backingStorageSize: number | null;
  } | null;
  dom: {
    documents: number;
    nodes: number;
    jsEventListeners: number;
  } | null;
}

export interface WebviewAllocations {
  pid: number;
  allocations: { category: string; bytes: number }[];
}

export interface MemoryAllocationCapture extends WebviewAllocations {
  at: number;
}

export interface TerminalMemoryCounts {
  mounted: number;
  alternate: number;
  scrollbackRows: number;
}

export const MEMORY_SAMPLE_INTERVAL_MS = 15_000;
export const MEMORY_HISTORY_HOURS = 4;
const MEMORY_HISTORY_MS = MEMORY_HISTORY_HOURS * 60 * 60_000;
const MAX_SAMPLES = MEMORY_HISTORY_MS / MEMORY_SAMPLE_INTERVAL_MS + 1;
export const BYTES_PER_MIB = 1024 * 1024;

export interface MemorySample extends WebviewMemorySample {
  at: number;
  terminals: TerminalMemoryCounts;
  editorModels: number;
  editorCodeUnits: number;
}

const terminals = new Set<Terminal>();
let readEditorModels: (() => readonly { getValueLength(): number }[]) | undefined;

export function registerMemoryDiagnosticTerminal(terminal: Terminal): () => void {
  terminals.add(terminal);
  return () => { terminals.delete(terminal); };
}

export function registerMemoryDiagnosticEditors(reader: () => readonly { getValueLength(): number }[]): void {
  readEditorModels = reader;
}

export function readWorkspaceMemoryCounts(): Pick<MemorySample, "terminals" | "editorModels" | "editorCodeUnits"> {
  const counts = { mounted: terminals.size, alternate: 0, scrollbackRows: 0 };
  for (const terminal of terminals) {
    if (terminal.buffer.active.type === "alternate") counts.alternate++;
    counts.scrollbackRows += Math.max(0, terminal.buffer.normal.length - terminal.rows);
  }
  const editors = readEditorModels?.() ?? [];
  return {
    terminals: counts,
    editorModels: editors.length,
    editorCodeUnits: editors.reduce((total, model) => total + model.getValueLength(), 0),
  };
}

export function appendMemorySample(samples: readonly MemorySample[], sample: MemorySample): MemorySample[] {
  return [...samples, sample].filter((point) => point.at >= sample.at - MEMORY_HISTORY_MS).slice(-MAX_SAMPLES);
}

export const MEMORY_SERIES = [
  { key: "resident", value: (sample: MemorySample) => sample.renderer?.privateWorkingSetBytes ?? null },
  { key: "commit", value: (sample: MemorySample) => sample.renderer?.privateCommitBytes ?? null },
  { key: "heap", value: (sample: MemorySample) => sample.heap?.usedSize ?? null },
] as const;

export function memoryChartScale(samples: readonly MemorySample[]): number {
  const maximum = samples.reduce((peak, sample) => Math.max(peak, ...MEMORY_SERIES.map((series) => series.value(sample) ?? 0)), 0);
  const tick = 64 * BYTES_PER_MIB;
  return Math.max(tick, Math.ceil(maximum / tick) * tick);
}

export function memoryChartPath(
  samples: readonly MemorySample[],
  valueFor: (sample: MemorySample) => number | null,
  width: number,
  height: number,
  scale: number,
): string {
  const start = samples[0]?.at ?? 0;
  const span = Math.max(MEMORY_SAMPLE_INTERVAL_MS, (samples.at(-1)?.at ?? start) - start);
  let previous: MemorySample | undefined;
  return samples.map((sample) => {
    const value = valueFor(sample);
    if (value === null) {
      previous = undefined;
      return "";
    }
    const connect = previous
      && sample.at - previous.at <= MEMORY_SAMPLE_INTERVAL_MS * 2
      && previous.renderer?.pid === sample.renderer?.pid;
    const x = (((sample.at - start) / span) * (width - 4) + 2).toFixed(2);
    const y = ((1 - value / scale) * (height - 4) + 2).toFixed(2);
    previous = sample;
    return connect ? `L${x} ${y}` : `M${x} ${y}h.01`;
  }).join("");
}

export interface MemoryChartGap {
  x: number;
  width: number;
  durationMs: number;
}

export function memoryChartGaps(samples: readonly MemorySample[], width: number): MemoryChartGap[] {
  if (samples.length < 2) return [];
  const start = samples[0].at;
  const span = Math.max(MEMORY_SAMPLE_INTERVAL_MS, samples[samples.length - 1].at - start);
  const gaps: MemoryChartGap[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const durationMs = curr.at - prev.at;
    if (durationMs > MEMORY_SAMPLE_INTERVAL_MS * 2 || prev.renderer?.pid !== curr.renderer?.pid) {
      const prevX = ((prev.at - start) / span) * (width - 4) + 2;
      const currX = ((curr.at - start) / span) * (width - 4) + 2;
      if (currX > prevX) gaps.push({ x: prevX, width: currX - prevX, durationMs });
    }
  }
  return gaps;
}
