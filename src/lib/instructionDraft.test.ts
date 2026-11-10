import { expect, it } from "vitest";
import { mergeSavedInstructionDraft } from "./instructionDraft";

it("preserves edits made while an instruction save is pending", async () => {
  let finish!: (content: string) => void;
  const pending = new Promise<string>((resolve) => { finish = resolve; });
  const submitted = "first edit";
  let draft = submitted;
  const saving = pending.then((saved) => { draft = mergeSavedInstructionDraft(draft, submitted, saved); });
  draft = "newer edit";
  finish(submitted);
  await saving;
  expect(draft).toBe("newer edit");
});

it("accepts normalized saved content when the draft has not changed", () => {
  expect(mergeSavedInstructionDraft("draft", "draft", "draft\n")).toBe("draft\n");
  expect(mergeSavedInstructionDraft("", "submitted", "submitted\n")).toBe("");
});
