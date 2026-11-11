import { expect, it } from "vitest";
import { terminalInputErrorKey } from "./terminalInputError";

it("maps bounded input failures without exposing backend implementation codes", () => {
  expect(terminalInputErrorKey("pty-input-closed")).toBe("terminal.inputClosed");
  expect(terminalInputErrorKey(new Error("pty-input-too-large"))).toBe("terminal.inputTooLarge");
  expect(terminalInputErrorKey("pty-input-queue-full")).toBe("terminal.inputQueueFull");
  expect(terminalInputErrorKey("pty-input-worker-failed")).toBe("terminal.inputFailed");
  expect(terminalInputErrorKey("IO failed")).toBeNull();
});
