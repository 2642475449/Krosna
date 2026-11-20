import { expect, it, vi } from "vitest";
import type { WebviewMemorySample } from "@/lib/memoryDiagnostics";
import { useMemoryDiagnosticsStore } from "./memoryDiagnostics";

const mock = vi.hoisted(() => ({ sample: vi.fn() }));
vi.mock("@/lib/api", () => ({ sampleWebviewMemory: mock.sample, captureWebviewAllocations: vi.fn() }));

it("records without a mounted view and discards in-flight samples when paused", async () => {
  vi.useFakeTimers();
  let completePrevious = (_sample: WebviewMemorySample) => {};
  const previous = new Promise<WebviewMemorySample>((resolve) => { completePrevious = resolve; });
  const native: WebviewMemorySample = { supported: true, renderer: null, dom: null, heap: null };
  mock.sample.mockReturnValueOnce(previous).mockResolvedValue(native);
  try {
    useMemoryDiagnosticsStore.getState().setRecording(true);
    useMemoryDiagnosticsStore.getState().setRecording(false);
    completePrevious(native);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(useMemoryDiagnosticsStore.getState().samples).toHaveLength(0);

    useMemoryDiagnosticsStore.getState().setRecording(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(useMemoryDiagnosticsStore.getState().samples).toHaveLength(2);
    useMemoryDiagnosticsStore.getState().setRecording(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(useMemoryDiagnosticsStore.getState().samples).toHaveLength(2);

    useMemoryDiagnosticsStore.getState().clearSamples();
    expect(useMemoryDiagnosticsStore.getState().samples).toHaveLength(0);
  } finally {
    useMemoryDiagnosticsStore.getState().setRecording(false);
    vi.useRealTimers();
  }
});
