import { useEffect, useRef, useState } from "react";
import { CopyOutlined, ReloadOutlined, CheckOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Radio, Slider, Switch, message } from "antd";
import { useTranslation } from "react-i18next";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsSection } from "./SettingsSection";
import { SettingRow } from "./SettingRow";
import { useAppStore } from "@/store";
import {
  buildPixelPetAiPrompt,
  DEFAULT_PIXEL_PET_CONFIG,
  parsePixelPetConfigJson,
  PIXEL_PET_PRESETS,
  type PixelPetBehaviorConfig,
  type PixelPetConfig,
} from "@/lib/pixelPetConfig";
import {
  createInitialPetSimulation,
  stepPetSimulation,
  triggerPetJump,
  type PetSimulationState,
} from "@/lib/pixelPet";
import {
  drawPixelBubble,
  drawPixelPetFrame,
  getPetRenderedDimensions,
  getPetSpriteFrame,
} from "@/lib/pixelPetSprites";

function PixelPresetThumbnail({ config }: { config: PixelPetConfig }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 44, 32);
    const frame = config.frames.idle[0] ?? config.frames.walk[0];
    if (frame) {
      const cols = frame[0]?.length ?? 16;
      const rows = frame.length;
      const pixelSize = cols > 20 || rows > 20 ? 1 : 2;
      const offsetX = Math.max(0, Math.floor((44 - cols * pixelSize) / 2));
      const offsetY = Math.max(0, Math.floor((32 - rows * pixelSize) / 2));
      drawPixelPetFrame(ctx, frame, offsetX, offsetY, 1, pixelSize, config.palette);
    }
  }, [config]);

  return (
    <canvas
      ref={canvasRef}
      width={44}
      height={32}
      className="h-8 w-11 shrink-0"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

function PixelPetPreviewStage({ config }: { config: PixelPetConfig }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const simRef = useRef<PetSimulationState>(createInitialPetSimulation(420));
  const widthRef = useRef(420);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const stageHeight = 76;
    const syncSize = () => {
      const width = Math.max(200, Math.floor(container.getBoundingClientRect().width));
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      widthRef.current = width;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(stageHeight * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${stageHeight}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
      }
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(container);

    let rafId = 0;
    let lastTs = performance.now();

    const tick = (now: number) => {
      const dtMs = now - lastTs;
      lastTs = now;
      const activeConfig = configRef.current;
      const { width: spriteWidth, height: spriteHeight } = getPetRenderedDimensions(activeConfig);

      simRef.current = stepPetSimulation(
        simRef.current,
        dtMs,
        widthRef.current,
        "idle",
        {
          behavior: { ...activeConfig.behavior, allowPlatformHop: false },
          spriteWidth,
        },
      );

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, widthRef.current, stageHeight);
        // Subtle ground line
        const groundLineY = stageHeight - 14;
        ctx.fillStyle = "rgba(128, 128, 128, 0.25)";
        ctx.fillRect(12, groundLineY, widthRef.current - 24, 1);

        const sim = simRef.current;
        const submergePx =
          (activeConfig.submergeRows ?? 0) * Math.max(1, Math.round(activeConfig.pixelSize || 2));
        const top = groundLineY - spriteHeight + submergePx - sim.y;
        const frame = getPetSpriteFrame(sim.action, sim.animElapsedMs, activeConfig);
        drawPixelPetFrame(
          ctx,
          frame,
          sim.x,
          top,
          sim.facing,
          activeConfig.pixelSize,
          activeConfig.palette,
          submergePx > 0 ? groundLineY : undefined,
        );
        if (sim.bubble) {
          drawPixelBubble(ctx, sim.bubble.text, sim.x + spriteWidth / 2, top);
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onClick={() => {
        simRef.current = triggerPetJump(
          simRef.current,
          undefined,
          Math.random,
          configRef.current.behavior,
        );
      }}
      title={t("settings.pixelPet.previewHint")}
      className="relative h-[76px] w-full cursor-pointer overflow-hidden rounded-lg border"
      style={{
        borderColor: "var(--cs-border-sidebar)",
        background: "color-mix(in srgb, var(--cs-bg-card) 75%, transparent)",
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" style={{ imageRendering: "pixelated" }} />
      <span
        className="pointer-events-none absolute right-2.5 top-2 text-[11px]"
        style={{ color: "var(--cs-text-tertiary)" }}
      >
        {t("settings.pixelPet.previewHint")}
      </span>
    </div>
  );
}

export function PixelPetSettingsPage() {
  const { t } = useTranslation();
  const pixelPetVisible = useAppStore((state) => state.pixelPetVisible);
  const setPixelPetVisible = useAppStore((state) => state.setPixelPetVisible);
  const pixelPetConfig = useAppStore((state) => state.pixelPetConfig);
  const setPixelPetConfig = useAppStore((state) => state.setPixelPetConfig);
  const resetPixelPetConfig = useAppStore((state) => state.resetPixelPetConfig);

  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(pixelPetConfig, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    setJsonDraft(JSON.stringify(pixelPetConfig, null, 2));
    setJsonError(null);
  }, [pixelPetConfig]);

  const updateBehavior = <K extends keyof PixelPetBehaviorConfig>(
    key: K,
    value: PixelPetBehaviorConfig[K],
  ) => {
    setPixelPetConfig({
      ...pixelPetConfig,
      behavior: {
        ...pixelPetConfig.behavior,
        [key]: value,
      },
    });
  };

  const handleSelectPreset = (preset: PixelPetConfig) => {
    setPixelPetConfig({
      ...preset,
      pixelSize: pixelPetConfig.pixelSize,
      behavior: {
        ...preset.behavior,
        allowPlatformHop: pixelPetConfig.behavior.allowPlatformHop,
        reactToCodingMood: pixelPetConfig.behavior.reactToCodingMood,
      },
    });
  };

  const handleApplyJson = () => {
    const result = parsePixelPetConfigJson(jsonDraft);
    if (!result.ok) {
      setJsonError(result.error);
      return;
    }
    setJsonError(null);
    setPixelPetConfig(result.config);
    message.success(t("settings.pixelPet.jsonApplied"));
  };

  const handleCopyAiPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildPixelPetAiPrompt(pixelPetConfig));
      message.success(t("settings.pixelPet.aiPromptCopied"));
    } catch {
      message.error(t("common.copyFailed"));
    }
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("settings.pixelPet.title")}
        description={t("settings.pixelPet.description")}
        actions={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              resetPixelPetConfig();
              message.success(t("settings.pixelPet.resetDone"));
            }}
          >
            {t("settings.pixelPet.resetDefault")}
          </Button>
        }
      />

      <PixelPetPreviewStage config={pixelPetConfig} />

      <SettingsSection title={t("settings.pixelPet.appearanceSection")}>
        <SettingRow
          label={t("settings.pixelPet.enabled")}
          description={t("settings.pixelPet.enabledDesc")}
        >
          <Switch checked={pixelPetVisible} onChange={setPixelPetVisible} />
        </SettingRow>

        <div className="space-y-2 py-2">
          <div>
            <div className="text-[13px] font-medium" style={{ color: "var(--cs-text-primary)" }}>
              {t("settings.pixelPet.preset")}
            </div>
            <div className="text-[12px]" style={{ color: "var(--cs-text-tertiary)" }}>
              {t("settings.pixelPet.presetDesc")}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {PIXEL_PET_PRESETS.map((preset) => {
              const selected = pixelPetConfig.id === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
                  style={{
                    borderColor: selected ? "var(--cs-primary)" : "var(--cs-border-sidebar)",
                    background: selected
                      ? "color-mix(in srgb, var(--cs-primary) 10%, transparent)"
                      : "transparent",
                  }}
                >
                  <PixelPresetThumbnail config={preset} />
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[13px] font-medium"
                      style={{ color: "var(--cs-text-primary)" }}
                    >
                      {t(`settings.pixelPet.presets.${preset.id}`, { defaultValue: preset.name })}
                    </div>
                    <div
                      className="text-[11px]"
                      style={{ color: "var(--cs-text-tertiary)" }}
                    >
                      {(preset.frames.idle[0]?.[0]?.length ?? 16)}×{(preset.frames.idle[0]?.length ?? 16)} Pixel
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <SettingRow
          label={t("settings.pixelPet.pixelSize")}
          description={t("settings.pixelPet.pixelSizeDesc")}
        >
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            value={pixelPetConfig.pixelSize}
            onChange={(e) => setPixelPetConfig({ ...pixelPetConfig, pixelSize: e.target.value })}
          >
            <Radio.Button value={1}>1x</Radio.Button>
            <Radio.Button value={2}>2x</Radio.Button>
            <Radio.Button value={3}>3x</Radio.Button>
          </Radio.Group>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("settings.pixelPet.behaviorSection")}>
        <SettingRow
          label={t("settings.pixelPet.walkSpeed")}
          description={`${pixelPetConfig.behavior.walkSpeedPxPerSec} px/s`}
        >
          <div className="w-48">
            <Slider
              min={10}
              max={90}
              value={pixelPetConfig.behavior.walkSpeedPxPerSec}
              onChange={(v) => updateBehavior("walkSpeedPxPerSec", v)}
            />
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.pixelPet.runSpeed")}
          description={`${pixelPetConfig.behavior.runSpeedPxPerSec} px/s`}
        >
          <div className="w-48">
            <Slider
              min={20}
              max={150}
              value={pixelPetConfig.behavior.runSpeedPxPerSec}
              onChange={(v) => updateBehavior("runSpeedPxPerSec", v)}
            />
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.pixelPet.jumpVelocity")}
          description={`${pixelPetConfig.behavior.jumpVelocityPxPerSec} px/s`}
        >
          <div className="w-48">
            <Slider
              min={90}
              max={300}
              value={pixelPetConfig.behavior.jumpVelocityPxPerSec}
              onChange={(v) => updateBehavior("jumpVelocityPxPerSec", v)}
            />
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.pixelPet.sleepAfterIdle")}
          description={`${Math.round(pixelPetConfig.behavior.sleepAfterIdleMs / 1000)}s`}
        >
          <div className="w-48">
            <Slider
              min={3}
              max={30}
              value={Math.round(pixelPetConfig.behavior.sleepAfterIdleMs / 1000)}
              onChange={(v) => updateBehavior("sleepAfterIdleMs", v * 1000)}
            />
          </div>
        </SettingRow>

        <SettingRow
          label={t("settings.pixelPet.allowPlatformHop")}
          description={t("settings.pixelPet.allowPlatformHopDesc")}
        >
          <Switch
            checked={pixelPetConfig.behavior.allowPlatformHop}
            onChange={(checked) => updateBehavior("allowPlatformHop", checked)}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.pixelPet.reactToCodingMood")}
          description={t("settings.pixelPet.reactToCodingMoodDesc")}
        >
          <Switch
            checked={pixelPetConfig.behavior.reactToCodingMood}
            onChange={(checked) => updateBehavior("reactToCodingMood", checked)}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title={t("settings.pixelPet.jsonSection")}
        description={t("settings.pixelPet.jsonSectionDesc")}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={handleApplyJson}
            >
              {t("settings.pixelPet.applyJson")}
            </Button>
            <Button
              icon={<CopyOutlined />}
              onClick={() => void handleCopyAiPrompt()}
            >
              {t("settings.pixelPet.copyAiPrompt")}
            </Button>
            <Button
              onClick={() => {
                setJsonDraft(JSON.stringify(DEFAULT_PIXEL_PET_CONFIG, null, 2));
                setJsonError(null);
              }}
            >
              {t("settings.pixelPet.loadDefaultJson")}
            </Button>
          </div>
          {jsonError ? <Alert type="error" showIcon message={jsonError} /> : null}
          <Input.TextArea
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
            rows={12}
            spellCheck={false}
            className="font-mono text-[12px]"
          />
        </div>
      </SettingsSection>
    </div>
  );
}
export default PixelPetSettingsPage;
