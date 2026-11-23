import { PersistentSettingsSync } from "@/lib/persistentSettingsSync";
import type { PersistentSettings } from "@/types";
import { applyPersistentSettingsToStore, getPersistentSettingsSnapshot, useAppStore } from "@/store";
import { useShortcutStore } from "./shortcutSlice";
import { useAuxiliaryDockStore } from "../auxiliaryDock";
import { useGitCommitGenerationStore } from "./gitCommitGenerationSlice";
import { useOnboardingStore } from "./onboardingSlice";

// 每个 WebView 各自持有落库基线，让防抖保存和安装更新前的保存共用同一队列。
export const persistentSettingsSync = new PersistentSettingsSync<PersistentSettings>();

export function getRuntimePersistentSettingsSnapshot(): PersistentSettings {
  return {
    ...getPersistentSettingsSnapshot(),
    pixelPetSettings: {
      visible: useAppStore.getState().pixelPetVisible,
      config: useAppStore.getState().pixelPetConfig,
      filePath: useAppStore.getState().pixelPetFilePath,
    },
    keyboardShortcuts: useShortcutStore.getState().overrides,
    auxiliaryDockWidths: useAuxiliaryDockStore.getState().widths,
    gitCommitGenerationConfig: useGitCommitGenerationStore.getState().config,
    onboardingCompleted: useOnboardingStore.getState().onboardingCompleted,
  };
}

export function applyRuntimePersistentSettings(settings: PersistentSettings): void {
  applyPersistentSettingsToStore(settings);
  if (typeof settings.onboardingCompleted === "boolean") {
    useOnboardingStore.getState().hydrateOnboardingCompleted(settings.onboardingCompleted);
  }
  if (settings.gitCommitGenerationConfig !== undefined) {
    useGitCommitGenerationStore
      .getState()
      .setPersistedConfig(settings.gitCommitGenerationConfig);
  }
  const pet = settings.pixelPetSettings;
  // 老版本数据库没有此字段，保留 localStorage 中的角色供首次全局保存迁移。
  if (!pet) return;
  const current = useAppStore.getState();
  const fileChanged = current.pixelPetFilePath !== pet.filePath;
  useAppStore.setState({
    pixelPetVisible: pet.visible,
    pixelPetConfig: pet.config,
    pixelPetFilePath: pet.filePath,
    ...(fileChanged ? {
      pixelPetFileRevision: current.pixelPetFileRevision + 1,
      pixelPetFileSnapshot: null,
      pixelPetFileError: null,
    } : {}),
  });
}
