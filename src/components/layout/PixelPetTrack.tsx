import { useEffect, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import {
  createInitialPetSimulation,
  derivePetCodingMood,
  hopPetToPlatform,
  stepPetSimulation,
  togglePetPaused,
  triggerPetJump,
  type PetCodingMood,
  type PetPlatform,
  type PetSimulationState,
} from "@/lib/pixelPet";
import { getPetCapabilities, type PixelPetConfig, type PixelSpriteFrame } from "@/lib/pixelPetConfig";
import {
  drawPixelBubble,
  drawPixelPetFrame,
  getPetRenderedDimensions,
  getPetSpriteFrame,
  type PetDrawBounds,
} from "@/lib/pixelPetSprites";
import { observeWindowActivity } from "@/lib/windowActivity";
import type { Session } from "@/types";

export function collectPetPlatforms(
  viewportWidth: number,
  viewportHeight: number,
  spriteHeight: number,
): PetPlatform[] {
  const platforms: PetPlatform[] = [];

  const statusBarEl = document.querySelector<HTMLElement>('[data-pet-surface="statusbar"]');
  if (statusBarEl) {
    const rect = statusBarEl.getBoundingClientRect();
    if (rect.width >= 100 && rect.top > 40) {
      platforms.push({
        id: "statusbar",
        minX: Math.max(8, Math.round(rect.left + 10)),
        maxX: Math.min(viewportWidth - 8, Math.round(rect.right - 10)),
        groundY: Math.round(rect.top),
      });
    }
  }

  const titleBlankEl = document.querySelector<HTMLElement>('[data-pet-surface="titlebar-blank"]');
  if (titleBlankEl) {
    const rect = titleBlankEl.getBoundingClientRect();
    // The visible workspace edge sits below the titlebar, after its layout
    // padding. Follow that edge instead of leaving the pet above the gap.
    const workspaceEl = document.querySelector<HTMLElement>('[data-pet-surface="workspace"]');
    const workspaceRect = workspaceEl?.getBoundingClientRect();
    const groundY = workspaceEl && workspaceRect && workspaceRect.width > 0
      ? workspaceRect.top + (parseFloat(getComputedStyle(workspaceEl).paddingTop) || 0)
      : rect.bottom;
    if (rect.width >= 96 && groundY >= spriteHeight) {
      platforms.push({
        id: "titlebar-blank",
        minX: Math.round(rect.left + 8),
        maxX: Math.round(rect.right - 8),
        groundY: Math.round(groundY),
      });
    }
  }

  if (platforms.length === 0) {
    platforms.push({
      id: "statusbar",
      minX: 12,
      maxX: Math.max(80, viewportWidth - 12),
      groundY: Math.max(40, viewportHeight - 28),
    });
  }

  return platforms;
}

export function PixelPetTrack() {
  const { t } = useTranslation();
  const visible = useAppStore((state) => state.pixelPetVisible);
  const petConfig = useAppStore((state) => state.pixelPetConfig);

  const configRef = useRef(petConfig);
  configRef.current = petConfig;

  const trackRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitboxRef = useRef<HTMLButtonElement | null>(null);
  const platformsRef = useRef<PetPlatform[]>([]);
  const simRef = useRef<PetSimulationState | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    const canvas = canvasRef.current;
    if (!visible || !track || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 0;
    let active = false;
    let rafId: number | null = null;
    let lastFrame: number | null = null;
    let lastMeasurement = 0;
    let mood: PetCodingMood = "idle";
    let moodSessions: Session[] | undefined;
    let moodSessionId: string | null = null;
    let config = configRef.current;
    let dimensions = getPetRenderedDimensions(config);
    let capabilities = getPetCapabilities(config);
    const painted: PetDrawBounds[] = [];
    let lastPaint: {
      config: PixelPetConfig;
      frame: PixelSpriteFrame;
      sim: PetSimulationState;
      spriteTop: number;
    } | null = null;

    const measure = () => {
      width = Math.max(200, window.innerWidth);
      height = Math.max(120, window.innerHeight);
      const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      const canvasWidth = Math.floor(width * ratio);
      const canvasHeight = Math.floor(height * ratio);
      if (canvas.width !== canvasWidth || canvas.height !== canvasHeight || dpr !== ratio) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.imageSmoothingEnabled = false;
        painted.length = 0;
        lastPaint = null;
        dpr = ratio;
      }
      if (config !== configRef.current) {
        config = configRef.current;
        dimensions = getPetRenderedDimensions(config);
        capabilities = getPetCapabilities(config);
      }
      platformsRef.current = collectPetPlatforms(width, height, dimensions.height);
      lastMeasurement = performance.now();
    };

    const renderFrame = (now: number) => {
      if (!active) return;
      if (now - lastMeasurement >= 500 || config !== configRef.current) measure();
      const { sessions, activeSessionId } = useAppStore.getState();
      if (sessions !== moodSessions || activeSessionId !== moodSessionId) {
        mood = derivePetCodingMood(sessions, activeSessionId);
        moodSessions = sessions;
        moodSessionId = activeSessionId;
      }
      const previous = simRef.current ?? createInitialPetSimulation(width, platformsRef.current);
      const sim = stepPetSimulation(previous, lastFrame === null ? 0 : now - lastFrame, width, mood, {
        platforms: platformsRef.current,
        behavior: config.behavior,
        capabilities,
        spriteWidth: dimensions.width,
      });
      simRef.current = sim;
      lastFrame = now;
      const groundY = sim.groundY > 0 ? sim.groundY : height - 28;
      const submergePx = (config.submergeRows ?? 0) * Math.max(1, Math.round(config.pixelSize || 2));
      const waterline = !sim.climb && submergePx > 0 ? groundY : undefined;
      const spriteTop = groundY - dimensions.height + (sim.climb ? 0 : submergePx) - sim.y;
      const frame = getPetSpriteFrame(sim.clip, sim.clipElapsedMs, config);
      rafId = window.requestAnimationFrame(renderFrame);
      // 空闲时模拟时钟继续推进，同一画面可以沿用上帧像素与命中区域。
      if (lastPaint && lastPaint.config === config && lastPaint.frame === frame
        && lastPaint.spriteTop === spriteTop && lastPaint.sim.x === sim.x
        && lastPaint.sim.facing === sim.facing && lastPaint.sim.groundY === sim.groundY
        && Boolean(lastPaint.sim.climb) === Boolean(sim.climb)
        && lastPaint.sim.bubble?.text === sim.bubble?.text) return;
      lastPaint = { config, frame, sim, spriteTop };

      const hitbox = hitboxRef.current;
      if (hitbox) {
        hitbox.style.width = `${dimensions.width}px`;
        hitbox.style.height = `${dimensions.height}px`;
        hitbox.style.transform = `translate3d(${Math.round(sim.x)}px, ${Math.round(spriteTop)}px, 0)`;
        hitbox.style.visibility = "visible";
      }

      // 先擦除上帧所有绘制区域，保留 1px 余量以覆盖小数 DPR 的边缘。
      for (const rect of painted) {
        ctx.clearRect(rect.x - 1, rect.y - 1, rect.width + 2, rect.height + 2);
      }
      painted.length = 0;
      const spriteBounds = drawPixelPetFrame(
        ctx, frame, sim.x, spriteTop, sim.facing, config.pixelSize, config.palette, waterline,
      );
      painted.push(spriteBounds);
      if (sim.bubble) {
        painted.push(drawPixelBubble(ctx, sim.bubble.text, spriteBounds, config.pixelSize, { width, height }));
      }
    };

    const onResize = () => { if (active) measure(); };
    window.addEventListener("resize", onResize);
    const stopObserving = observeWindowActivity((nextActive) => {
      active = nextActive;
      track.hidden = !active;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = null;
      lastFrame = null;
      if (active) {
        measure();
        rafId = window.requestAnimationFrame(renderFrame);
      }
    });

    return () => {
      active = false;
      track.hidden = true;
      stopObserving();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      simRef.current = null;
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  const handlePetClick = () => {
    if (!simRef.current) return;
    simRef.current = triggerPetJump(
      simRef.current,
      configRef.current.behavior,
    );
  };

  const handlePetDoubleClick = () => {
    const sim = simRef.current;
    if (!sim) return;
    const other = platformsRef.current.find((p) => p.id !== sim.platformId);
    if (other) {
      simRef.current = hopPetToPlatform(sim, other);
    } else {
      simRef.current = triggerPetJump(sim, configRef.current.behavior);
    }
  };

  const handlePetContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (simRef.current) simRef.current = togglePetPaused(simRef.current);
  };

  return (
    <div
      ref={trackRef}
      hidden
      className="pointer-events-none fixed inset-0 z-[35] overflow-hidden select-none"
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none block h-full w-full [image-rendering:pixelated]"
      />
      <button
        ref={hitboxRef}
        type="button"
        onClick={handlePetClick}
        onDoubleClick={handlePetDoubleClick}
        onContextMenu={handlePetContextMenu}
        title={t("statusBar.pixelPet.trackHint")}
        aria-label={t("statusBar.pixelPet.trackHint")}
        className="invisible pointer-events-auto absolute left-0 top-0 cursor-pointer border-0 bg-transparent p-0 focus:outline-none"
      />
    </div>
  );
}

export default PixelPetTrack;
