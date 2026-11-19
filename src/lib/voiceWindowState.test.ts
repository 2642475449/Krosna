import { beforeEach, expect, it, vi } from "vitest";
import { emit, emitTo } from "@tauri-apps/api/event";
import { publishVoiceWindowState, sendVoiceOverlayState, type VoiceOverlayState } from "./voiceWindowState";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  emitTo: vi.fn().mockResolvedValue(undefined),
}));

const recording: VoiceOverlayState = {
  phase: "recording",
  level: 0.2,
  elapsedMs: 200,
  errorMessage: null,
  liveText: "一",
  shortcutLabel: "Alt+V",
};

beforeEach(() => vi.clearAllMocks());

it("录音中持续更新悬浮窗时，项目只接收阶段切换", async () => {
  const next = { ...recording, elapsedMs: 400, level: 0.8, liveText: "一句话" };
  await publishVoiceWindowState(recording, "requesting_permission");
  await publishVoiceWindowState(next, "recording");
  await publishVoiceWindowState({ ...next, phase: "transcribing" }, "recording");
  expect(vi.mocked(emit).mock.calls).toEqual([
    ["voice-worker-phase", "recording"],
    ["voice-worker-phase", "transcribing"],
  ]);
  expect(emitTo).toHaveBeenCalledTimes(3);
  expect(emitTo).toHaveBeenNthCalledWith(2, "voice-overlay", "voice-overlay-state", next);
});

it("悬浮窗就绪后能单独补发带错误的完整状态", async () => {
  const error: VoiceOverlayState = { ...recording, phase: "error", errorMessage: "录音失败" };
  await sendVoiceOverlayState(error);
  expect(emitTo).toHaveBeenCalledWith("voice-overlay", "voice-overlay-state", error);
  expect(emit).not.toHaveBeenCalled();
});
