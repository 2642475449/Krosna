import { consumeTerminalSubmissionInput, hasTerminalPromptText } from "./terminalSubmission";

/** Observe acknowledged writes in PTY queue order, never speculative keypresses. */
export function createTerminalActivityTracker(onSubmitted: () => void) {
  let draft = "";
  let pendingSequence = "";
  let disposed = false;
  const written = (data: string, pasted = false) => {
    if (disposed) return;
    const capture = consumeTerminalSubmissionInput(
      draft, pasted ? data.replace(/[\r\n]/g, " ") : data, pendingSequence,
    );
    draft = capture.nextValue;
    pendingSequence = capture.pendingSequence;
    if (!pasted && (data === "\r" || data === "\n") && hasTerminalPromptText(capture.submittedText)) {
      onSubmitted();
    }
  };
  return {
    written,
    async write(data: string, send: () => Promise<void>, pasted = false) {
      await send();
      // Rejected writes leave the already acknowledged draft intact.
      written(data, pasted);
    },
    dispose() { disposed = true; draft = ""; pendingSequence = ""; },
  };
}
