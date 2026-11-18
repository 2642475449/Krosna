import { useEffect, useMemo, useRef, useState } from "react";
import { CopyOutlined, ReloadOutlined, CheckOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Radio, Switch, message } from "antd";
import { useTranslation } from "react-i18next";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsSection } from "./SettingsSection";
import { SettingRow } from "./SettingRow";
import { useAppStore } from "@/store";
import {
  buildPixelPetAiPrompt,
  DEFAULT_PIXEL_PET_CONFIG,
  getPetCapabilities,
  PIXEL_PET_PRESETS,
  type PixelPetConfig,
} from "@/lib/pixelPetConfig";
import {
  createInitialPetSimulation,
  dispatchPetEvent,
  stepPetSimulation,
  triggerPetJump,
  type PetPlatform,
  type PetSimulationState,
  type PetStandardEvent,
} from "@/lib/pixelPet";
import {
  drawPixelPetFrame,
  getPetSpriteFrame,
} from "@/lib/pixelPetSprites";
import {
  getPixelPetPreviewStageLayout,
  getPixelPetThumbnailLayout,
  preparePixelPetPreview,
} from "@/lib/pixelPetPreview";

import { readProjectFile, selectPixelPetExportPath, selectPixelPetJsonFile, writeProjectFile } from "@/lib/api";
import { parsePixelPetFile, pixelPetFileLocation, type PixelPetFileSnapshot } from "@/lib/pixelPetFile";
import { ensurePixelPetFileGuide, exportPixelPetFile } from "@/lib/pixelPetFileIO";

function PixelPresetThumbnail({ config }: { config: PixelPetConfig }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const preview = useMemo(() => preparePixelPetPreview(config), [config]);
  const layout = useMemo(() => getPixelPetThumbnailLayout(preview), [preview]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, layout.width, layout.height);
    const frame = preview.frames.idle[0] ?? preview.frames.walk[0];
    if (frame) {
      drawPixelPetFrame(ctx, frame, layout.x, layout.y, 1, layout.pixelSize, preview.palette);
    }
  }, [preview, layout]);

  return (
    <canvas
      ref={canvasRef}
      width={layout.width}
      height={layout.height}
      className="shrink-0"
      style={{ imageRendering: "pixelated", width: layout.width, height: layout.height }}
    />
  );
}

function PixelPetPreviewStage({ config }: { config: PixelPetConfig }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const preview = useMemo(() => preparePixelPetPreview(config), [config]);
  const capabilities = useMemo(() => getPetCapabilities(config), [config]);
  const configRef = useRef(preview);
  configRef.current = preview;
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  const simRef = useRef<PetSimulationState>(createInitialPetSimulation(420));
  const widthRef = useRef(420);
  const [liveStatus, setLiveStatus] = useState<{ action: string; clip: string }>({
    action: "idle",
    clip: "idle",
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let layout = getPixelPetPreviewStageLayout(configRef.current, widthRef.current);
    let lastConfig = configRef.current;
    const syncSize = () => {
      const width = Math.max(200, Math.floor(container.getBoundingClientRect().width));
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      widthRef.current = width;
      lastConfig = configRef.current;
      layout = getPixelPetPreviewStageLayout(lastConfig, width);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(layout.height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${layout.height}px`;
      container.style.height = `${layout.height + 2}px`;
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
      if (lastConfig !== activeConfig) syncSize();
      const { spriteWidth, spriteHeight, pixelSize, groundY, topPadding } = layout;

      simRef.current = stepPetSimulation(
        simRef.current,
        dtMs,
        widthRef.current,
        "idle",
        {
          behavior: { ...activeConfig.behavior, allowPlatformHop: false, allowWallClimb: false },
          capabilities: capabilitiesRef.current,
          spriteWidth,
        },
      );

      const sim = simRef.current;
      setLiveStatus((prev) =>
        prev.action === sim.action && prev.clip === sim.clip
          ? prev
          : { action: sim.action, clip: sim.clip },
      );

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, widthRef.current, layout.height);
        // Subtle ground line
        const groundLineY = groundY;
        ctx.fillStyle = "rgba(128, 128, 128, 0.25)";
        ctx.fillRect(12, groundLineY, widthRef.current - 24, 1);

        // Repeated clicks can boost a jump beyond its nominal arc. Keep the
        // complete sprite inside the preview even then, and after a resize.
        const top = Math.max(topPadding, groundLineY - spriteHeight - sim.y);
        const left = Math.max(0, Math.min(widthRef.current - spriteWidth, sim.x));
        const frame = getPetSpriteFrame(sim.clip, sim.clipElapsedMs, activeConfig);
        drawPixelPetFrame(
          ctx,
          frame,
          left,
          top,
          sim.facing,
          pixelSize,
          activeConfig.palette,
        );
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  const triggerAudition = (event: PetStandardEvent) => {
    const platforms: PetPlatform[] = [
      { id: "preview-ground", minX: 12, maxX: Math.max(120, widthRef.current - 12), groundY: 80 },
      { id: "preview-upper", minX: 12, maxX: Math.max(120, widthRef.current - 12), groundY: 36 },
    ];
    simRef.current = dispatchPetEvent(
      simRef.current,
      event,
      widthRef.current,
      {
        platforms,
        behavior: configRef.current.behavior,
        capabilities: capabilitiesRef.current,
      },
    );
  };

  const auditionActions: { event: PetStandardEvent; labelKey: string; disabled?: boolean }[] = [
    { event: "click", labelKey: "settings.pixelPet.audition.jump" },
    { event: "work_start", labelKey: "settings.pixelPet.audition.run" },
    { event: "rest", labelKey: "settings.pixelPet.audition.rest" },
    { event: "wake", labelKey: "settings.pixelPet.audition.wake" },
    { event: "work_complete", labelKey: "settings.pixelPet.audition.celebrate" },
    { event: "work_error", labelKey: "settings.pixelPet.audition.alert" },
    { event: "easter_egg", labelKey: "settings.pixelPet.audition.easterEgg", disabled: !capabilities.easterEgg },
  ];

  const capabilityBadges: { labelKey: string; supported: boolean }[] = [
    { labelKey: "settings.pixelPet.capabilities.run", supported: capabilities.run },
    { labelKey: "settings.pixelPet.capabilities.sleepTransition", supported: capabilities.sleepTransition },
    { labelKey: "settings.pixelPet.capabilities.wallClimb", supported: capabilities.wallClimb },
    { labelKey: "settings.pixelPet.capabilities.easterEgg", supported: capabilities.easterEgg },
  ];

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        onClick={() => {
          simRef.current = triggerPetJump(
            simRef.current,
            configRef.current.behavior,
          );
        }}
        title={t("settings.pixelPet.previewHint")}
        className="relative w-full cursor-pointer overflow-hidden rounded-lg border"
        style={{
          minHeight: 76,
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

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          {auditionActions.map((item) => (
            <Button
              key={item.event}
              size="small"
              disabled={item.disabled}
              onClick={() => triggerAudition(item.event)}
            >
              {t(item.labelKey)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" style={{ color: "var(--cs-text-tertiary)" }}>
          <span>
            {liveStatus.action}/{liveStatus.clip}
          </span>
          {capabilityBadges.map((cap) => (
            <span
              key={cap.labelKey}
              style={{ opacity: cap.supported ? 1 : 0.45 }}
            >
              {cap.supported ? "●" : "○"} {t(cap.labelKey)}
            </span>
          ))}
        </div>
      </div>
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

  const filePath = useAppStore((state) => state.pixelPetFilePath);
  const fileError = useAppStore((state) => state.pixelPetFileError);
  const setFilePath = useAppStore((state) => state.setPixelPetFilePath);
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(pixelPetConfig, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftChangedExternally, setDraftChangedExternally] = useState(false);
  const dirtyRef = useRef(false);
  const baseJsonRef = useRef(jsonDraft);
  const baseSnapshotRef = useRef<PixelPetFileSnapshot | null>(null);
  const operationRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => () => { operationRef.current++; }, []);

  const resetDraft = (config: PixelPetConfig, snapshot: PixelPetFileSnapshot | null) => {
    const json = JSON.stringify(config, null, 2);
    dirtyRef.current = false;
    baseJsonRef.current = json;
    baseSnapshotRef.current = snapshot;
    setJsonDraft(json);
    setJsonError(null);
    setDraftChangedExternally(false);
  };

  useEffect(() => {
    const incoming = JSON.stringify(pixelPetConfig, null, 2);
    const snapshot = useAppStore.getState().pixelPetFileSnapshot;
    if (dirtyRef.current) {
      if (incoming !== baseJsonRef.current || snapshot?.content !== baseSnapshotRef.current?.content) setDraftChangedExternally(true);
      return;
    }
    resetDraft(pixelPetConfig, snapshot);
  }, [pixelPetConfig, filePath]);

  const runOperation = async (task: (isCurrent: () => boolean) => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const token = ++operationRef.current;
    const revision = useAppStore.getState().pixelPetFileRevision;
    const isCurrent = () => token === operationRef.current && useAppStore.getState().pixelPetFileRevision === revision;
    try { await task(isCurrent); }
    catch (error) {
      if (token === operationRef.current) message.error(t("settings.pixelPet.fileOperationFailed", { error: String(error) }));
    } finally {
      busyRef.current = false;
      if (token === operationRef.current) setBusy(false);
    }
  };

  const linkFile = (path: string, config: PixelPetConfig, snapshot: PixelPetFileSnapshot) => {
    setFilePath(path);
    useAppStore.setState({ pixelPetConfig: config, pixelPetFileSnapshot: snapshot });
    resetDraft(config, snapshot);
  };

  const handleSelectPreset = (preset: PixelPetConfig) => {
    const config = { ...preset, pixelSize: pixelPetConfig.pixelSize };
    setFilePath(null);
    setPixelPetConfig(config);
    resetDraft(config, null);
  };

  const handleApplyJson = () => runOperation(async (isCurrent) => {
    let config: PixelPetConfig;
    try { config = parsePixelPetFile(jsonDraft); }
    catch (error) { setJsonError(String(error)); return; }
    let snapshot: PixelPetFileSnapshot | null = null;
    if (filePath) {
      if (!baseSnapshotRef.current) throw new Error(t("settings.pixelPet.fileNotReady"));
      const { directory } = pixelPetFileLocation(filePath);
      await writeProjectFile(directory, filePath, jsonDraft, "utf-8", baseSnapshotRef.current);
      snapshot = { content: jsonDraft, encoding: "utf-8" };
    }
    if (!isCurrent()) return;
    useAppStore.setState({ pixelPetConfig: config, pixelPetFileSnapshot: snapshot, pixelPetFileError: null });
    resetDraft(config, snapshot);
    message.success(t("settings.pixelPet.jsonApplied"));
  });

  const handlePixelSize = (pixelSize: number) => runOperation(async (isCurrent) => {
    const config = { ...pixelPetConfig, pixelSize };
    let snapshot = useAppStore.getState().pixelPetFileSnapshot;
    if (filePath) {
      if (!snapshot) throw new Error(t("settings.pixelPet.fileNotReady"));
      const { directory } = pixelPetFileLocation(filePath);
      const content = JSON.stringify(config, null, 2);
      await writeProjectFile(directory, filePath, content, "utf-8", snapshot);
      snapshot = { content, encoding: "utf-8" };
    }
    if (isCurrent()) useAppStore.setState({ pixelPetConfig: config, pixelPetFileSnapshot: snapshot });
  });

  const exportAndLink = async (isCurrent: () => boolean) => {
    const config = parsePixelPetFile(jsonDraft);
    const safeId = config.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const selected = await selectPixelPetExportPath(`${safeId}-custom.json`);
    if (!selected || !isCurrent()) return null;
    const path = /\.json$/i.test(selected) ? selected : `${selected}.json`;
    const content = JSON.stringify(config, null, 2);
    const snapshot = await exportPixelPetFile(path, content);
    if (!isCurrent()) return null;
    linkFile(path, config, snapshot);
    return { path, config };
  };

  const handleExport = () => runOperation(async (isCurrent) => {
    if (await exportAndLink(isCurrent)) message.success(t("settings.pixelPet.fileExported"));
  });

  const handleLoad = () => runOperation(async (isCurrent) => {
    const path = await selectPixelPetJsonFile();
    if (!path || !isCurrent()) return;
    const { directory } = pixelPetFileLocation(path);
    const snapshot = await readProjectFile(directory, path);
    const config = parsePixelPetFile(snapshot.content);
    if (!isCurrent()) return;
    linkFile(path, config, snapshot);
    message.success(t("settings.pixelPet.fileLoaded"));
  });

  const handleCopyAiPrompt = () => runOperation(async (isCurrent) => {
    let path = filePath;
    let config = pixelPetConfig;
    if (!path) {
      const exported = await exportAndLink(isCurrent);
      if (!exported) return;
      ({ path, config } = exported);
    } else {
      await ensurePixelPetFileGuide(path);
      if (!isCurrent()) return;
    }
    await navigator.clipboard.writeText(buildPixelPetAiPrompt(config, path));
    message.success(t("settings.pixelPet.aiPromptCopied"));
  });

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title={t("settings.pixelPet.title")}
        description={t("settings.pixelPet.description")}
        actions={
          <Button
            icon={<ReloadOutlined />}
            disabled={busy}
            onClick={() => {
              resetPixelPetConfig();
              resetDraft(DEFAULT_PIXEL_PET_CONFIG, null);
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
                  disabled={busy}
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
            disabled={busy}
            value={pixelPetConfig.pixelSize}
            onChange={(e) => void handlePixelSize(e.target.value)}
          >
            <Radio.Button value={1}>1x</Radio.Button>
            <Radio.Button value={2}>2x</Radio.Button>
            <Radio.Button value={3}>3x</Radio.Button>
          </Radio.Group>
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
              loading={busy}
              onClick={() => void handleApplyJson()}
            >
              {t(filePath ? "settings.pixelPet.saveFile" : "settings.pixelPet.applyJson")}
            </Button>
            <Button
              icon={<CopyOutlined />}
              disabled={busy}
              onClick={() => void handleCopyAiPrompt()}
            >
              {t("settings.pixelPet.copyAiPrompt")}
            </Button>
            <Button disabled={busy} onClick={() => void handleExport()}>
              {t("settings.pixelPet.exportFile")}
            </Button>
            <Button disabled={busy} onClick={() => void handleLoad()}>
              {t("settings.pixelPet.loadFile")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                dirtyRef.current = true;
                setJsonDraft(JSON.stringify(DEFAULT_PIXEL_PET_CONFIG, null, 2));
                setJsonError(null);
              }}
            >
              {t("settings.pixelPet.loadDefaultJson")}
            </Button>
          </div>
          {filePath ? (
            <div className="space-y-2">
              <div className="break-all text-[12px]" style={{ color: "var(--cs-text-secondary)" }}>{filePath}</div>
              <Alert type={fileError ? "warning" : "success"} showIcon message={t(fileError ? "settings.pixelPet.fileInvalid" : "settings.pixelPet.fileWatching")} description={fileError || undefined} />
              <Button size="small" disabled={busy} onClick={() => { setFilePath(null); resetDraft(pixelPetConfig, null); }}>{t("settings.pixelPet.unlinkFile")}</Button>
            </div>
          ) : <div className="text-[12px]" style={{ color: "var(--cs-text-tertiary)" }}>{t("settings.pixelPet.exportBeforeAi")}</div>}
          {draftChangedExternally ? <Alert type="warning" showIcon message={t("settings.pixelPet.draftPreserved")} action={<Button size="small" disabled={busy} onClick={() => resetDraft(pixelPetConfig, useAppStore.getState().pixelPetFileSnapshot)}>{t("settings.pixelPet.reloadDraft")}</Button>} /> : null}
          {jsonError ? <Alert type="error" showIcon message={jsonError} /> : null}
          <Input.TextArea
            value={jsonDraft}
            disabled={busy}
            onChange={(e) => {
              dirtyRef.current = e.target.value !== baseJsonRef.current;
              setJsonDraft(e.target.value);
              setJsonError(null);
            }}
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
