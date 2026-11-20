import { expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import {
  appendMemorySample,
  BYTES_PER_MIB,
  MEMORY_HISTORY_HOURS,
  memoryChartGaps,
  memoryChartPath,
  memoryChartScale,
  readWorkspaceMemoryCounts,
  registerMemoryDiagnosticTerminal,
  type MemorySample,
} from "./memoryDiagnostics";

function sample(at: number, pid: number, resident: number | null): MemorySample {
  return {
    at, supported: true, heap: null, dom: null,
    renderer: { pid, workingSetBytes: 500, privateWorkingSetBytes: resident, privateCommitBytes: 600, frameCount: 1 },
    terminals: { mounted: 0, alternate: 0, scrollbackRows: 0 },
    editorModels: 0, editorCodeUnits: 0,
  };
}

it("keeps a bounded recording and expires old samples by time", () => {
  const newest = sample(MEMORY_HISTORY_HOURS * 3_600_000 + 1, 1, 400);
  expect(appendMemorySample([sample(0, 1, 100), sample(1, 1, 200)], newest))
    .toEqual([sample(1, 1, 200), newest]);
  expect(appendMemorySample(Array.from({ length: 2_000 }, () => newest), newest))
    .toHaveLength(961);
});

it("leaves gaps for missing counters, pauses and changed renderer processes", () => {
  const points = [
    sample(0, 1, 100), sample(15_000, 1, 300), sample(30_000, 1, null),
    sample(45_000, 1, 500), sample(60_000, 2, 600), sample(105_000, 2, 400),
  ];
  const path = memoryChartPath(points, (point) => point.renderer?.privateWorkingSetBytes ?? null, 720, 140, 600);
  expect(path.match(/M/g)).toHaveLength(4);
  expect(path.match(/L/g)).toHaveLength(1);
  expect(memoryChartScale(points)).toBe(64 * BYTES_PER_MIB);
});

it("counts hidden terminal buffers without reading terminal text and stops on disposal", async () => {
  const terminal = new Terminal({ cols: 20, rows: 3, scrollback: 20, allowProposedApi: true });
  const release = registerMemoryDiagnosticTerminal(terminal);
  try {
    await new Promise<void>((resolve) => terminal.write("1\r\n2\r\n3\r\n4\r\n5\x1b[?1049h", resolve));
    expect(readWorkspaceMemoryCounts().terminals).toEqual({ mounted: 1, alternate: 1, scrollbackRows: 2 });
  } finally {
    release();
    terminal.dispose();
  }
  expect(readWorkspaceMemoryCounts().terminals).toEqual({ mounted: 0, alternate: 0, scrollbackRows: 0 });
});

it("detects pause and process-change gaps for the trend chart", () => {
  expect(memoryChartGaps([sample(0, 1, 100)], 720)).toEqual([]);
  const gaps = memoryChartGaps([
    sample(0, 1, 100),
    sample(15_000, 1, 200),
    sample(120_000, 1, 300),
  ], 720);
  expect(gaps).toHaveLength(1);
  expect(gaps[0].durationMs).toBe(105_000);
  expect(gaps[0].width).toBeGreaterThan(0);
});
