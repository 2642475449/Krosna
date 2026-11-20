import { create } from "zustand";
import { captureWebviewAllocations, sampleWebviewMemory } from "@/lib/api";
import {
  appendMemorySample,
  MEMORY_SAMPLE_INTERVAL_MS,
  readWorkspaceMemoryCounts,
  type MemoryAllocationCapture,
  type MemorySample,
} from "@/lib/memoryDiagnostics";

interface MemoryDiagnosticsState {
  recording: boolean;
  samples: readonly MemorySample[];
  error: boolean;
  captures: readonly MemoryAllocationCapture[];
  captureStatus: "idle" | "capturing" | "error" | "busy";
  setRecording(recording: boolean): void;
  clearSamples(): void;
  capture(): Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let sampling = false;
let generation = 0;

// 采样独立于设置页的挂载，切回终端或编辑器时继续记录。
export const useMemoryDiagnosticsStore = create<MemoryDiagnosticsState>((set, get) => {
  const sample = async () => {
    if (sampling || !get().recording) return;
    sampling = true;
    const started = Date.now();
    const token = generation;
    try {
      const native = await sampleWebviewMemory();
      if (token !== generation) return;
      const point = { at: Date.now(), ...native, ...readWorkspaceMemoryCounts() };
      set((state) => ({
        samples: appendMemorySample(state.samples, point),
        recording: native.supported && state.recording,
        error: false,
      }));
    } catch {
      if (token === generation) set({ error: true });
    } finally {
      sampling = false;
      if (get().recording) {
        const delay = token === generation ? Math.max(0, MEMORY_SAMPLE_INTERVAL_MS - (Date.now() - started)) : 0;
        timer = setTimeout(() => void sample(), delay);
      }
    }
  };
  return {
    recording: false,
    samples: [],
    error: false,
    captures: [],
    captureStatus: "idle",
    setRecording(recording) {
      if (get().recording === recording) return;
      generation++;
      clearTimeout(timer);
      set({ recording, error: false });
      if (recording) void sample();
    },
    clearSamples() {
      set({ samples: [], error: false });
    },
    async capture() {
      if (get().captureStatus === "capturing") return;
      set({ captureStatus: "capturing" });
      try {
        const snapshot = { ...await captureWebviewAllocations(), at: Date.now() };
        set((state) => ({
          captures: [...state.captures, snapshot].slice(-2),
          captureStatus: "idle",
        }));
      } catch (error) {
        set({ captureStatus: error === "MEMORY_CAPTURE_BUSY" ? "busy" : "error" });
      }
    },
  };
});
