import { emit, emitTo } from "@tauri-apps/api/event";
import type { AsrPhase } from "@/hooks/useVoiceRecognition";

export interface VoiceOverlayState {
  phase: AsrPhase;
  level: number;
  elapsedMs: number;
  errorMessage: string | null;
  liveText: string;
  shortcutLabel: string;
}

export function sendVoiceOverlayState(state: VoiceOverlayState) {
  return emitTo("voice-overlay", "voice-overlay-state", state);
}

export function publishVoiceWindowState(state: VoiceOverlayState, previousPhase?: AsrPhase) {
  // 项目窗口的麦克风按钮和 Escape 只依赖阶段。音量、计时和字幕由悬浮窗独享。
  const overlayUpdate = sendVoiceOverlayState(state);
  return state.phase === previousPhase
    ? overlayUpdate
    : Promise.all([overlayUpdate, emit("voice-worker-phase", state.phase)]);
}
