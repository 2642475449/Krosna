const INPUT_ERROR_KEYS = {
  "pty-input-closed": "terminal.inputClosed",
  "pty-input-too-large": "terminal.inputTooLarge",
  "pty-input-queue-full": "terminal.inputQueueFull",
  "pty-input-worker-failed": "terminal.inputFailed",
} as const;

/** 只映射后端稳定错误码；普通 IO 错误仍由原有调用方处理。 */
export function terminalInputErrorKey(error: unknown): string | null {
  const code = (error instanceof Error ? error.message : String(error)).trim();
  return Object.prototype.hasOwnProperty.call(INPUT_ERROR_KEYS, code)
    ? INPUT_ERROR_KEYS[code as keyof typeof INPUT_ERROR_KEYS] : null;
}
