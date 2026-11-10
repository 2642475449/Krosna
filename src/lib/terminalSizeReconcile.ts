import type { TerminalGridSize } from "./terminalResize";

export interface PtyGridSize extends TerminalGridSize {
  instanceId: number;
}

interface TerminalSizeReconcileOptions {
  isReady: () => boolean;
  measure: () => TerminalGridSize | null;
  getSize: () => Promise<PtyGridSize | null>;
  resize: (size: TerminalGridSize, instanceId: number) => Promise<void>;
  onError: (error: unknown) => void;
}

const RETRY_DELAYS_MS = [32, 64, 128, 256, 512];

function sameGrid(a: TerminalGridSize | null, b: TerminalGridSize): boolean {
  return a?.rows === b.rows && a.cols === b.cols;
}

/** Verify the applied PTY grid; a sent resize alone is not a successful sync. */
export function createTerminalSizeReconciler(options: TerminalSizeReconcileOptions) {
  let generation = 0;
  let disposed = false;
  let running = false;
  let pending = false;
  let attempts = 0;
  let stableSize: PtyGridSize | null = null;
  let stableReads = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const invalidate = () => {
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = false;
    attempts = 0;
    stableSize = null;
    stableReads = 0;
  };

  const run = async (): Promise<void> => {
    if (disposed || running || !pending) return;
    pending = false;
    running = true;
    const requestGeneration = generation;
    const isCurrent = () => !disposed && requestGeneration === generation && options.isReady();
    let retry = false;
    let failure: unknown;
    try {
      if (!isCurrent()) return;
      const target = options.measure();
      if (!target || target.rows < 1 || target.cols < 1) return;
      attempts += 1;
      const actual = await options.getSize();
      if (!isCurrent()) return;
      const latest = options.measure();
      if (!latest) return;
      // A delayed read must never resize a newly revealed layout back to the old grid.
      if (!sameGrid(latest, target)) {
        stableReads = 0;
        retry = true;
        return;
      }
      if (actual && sameGrid(actual, target)) {
        stableReads = sameGrid(stableSize, actual) && stableSize?.instanceId === actual.instanceId
          ? stableReads + 1 : 1;
        stableSize = actual;
        retry = stableReads < 2;
      } else {
        stableReads = 0;
        if (actual && attempts <= RETRY_DELAYS_MS.length) await options.resize(target, actual.instanceId);
        // Also retry when the view mounted before the PTY was created.
        retry = true;
      }
    } catch (error) {
      if (isCurrent()) {
        retry = true;
        failure = error;
      }
    } finally {
      running = false;
      if (pending) {
        void run();
      } else if (retry && isCurrent()) {
        if (attempts <= RETRY_DELAYS_MS.length) {
          timer = setTimeout(() => {
            timer = null;
            pending = true;
            void run();
          }, RETRY_DELAYS_MS[attempts - 1]);
        } else {
          options.onError(failure ?? new Error("PTY grid did not converge after size reconciliation"));
        }
      }
    }
  };

  return {
    request() {
      if (disposed) return;
      invalidate();
      pending = true;
      void run();
    },
    invalidate,
    dispose() {
      disposed = true;
      invalidate();
    },
  };
}
