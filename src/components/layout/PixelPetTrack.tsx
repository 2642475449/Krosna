import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import {
  createInitialPetSimulation,
  derivePetCodingMood,
  hopPetToPlatform,
  PET_SPRITE_LOGICAL_SIZE,
  stepPetSimulation,
  togglePetPaused,
  triggerPetJump,
  type PetPlatform,
  type PetSimulationState,
} from "@/lib/pixelPet";
import {
  drawPixelBubble,
  drawPixelPetFrame,
  getPetRenderedDimensions,
  getPetSpriteFrame,
} from "@/lib/pixelPetSprites";

function collectPetPlatforms(
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
    if (rect.width >= 96 && rect.bottom >= spriteHeight) {
      platforms.push({
        id: "titlebar-blank",
        minX: Math.round(rect.left + 8),
        maxX: Math.round(rect.right - 8),
        groundY: Math.round(rect.bottom),
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
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);

  const codingMood = useMemo(
    () => derivePetCodingMood(sessions, activeSessionId),
    [sessions, activeSessionId],
  );
  const moodRef = useRef(codingMood);
  moodRef.current = codingMood;

  const configRef = useRef(petConfig);
  configRef.current = petConfig;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitboxRef = useRef<HTMLButtonElement | null>(null);
  const viewportRef = useRef({ width: 1280, height: 800 });
  const platformsRef = useRef<PetPlatform[]>([]);
  const simRef = useRef<PetSimulationState>(createInitialPetSimulation(1280));

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncViewport = () => {
      const vw = Math.max(200, window.innerWidth);
      const vh = Math.max(120, window.innerHeight);
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      const { height: spriteHeight } = getPetRenderedDimensions(configRef.current);
      viewportRef.current = { width: vw, height: vh };
      platformsRef.current = collectPetPlatforms(vw, vh, spriteHeight);

      canvas.width = Math.floor(vw * dpr);
      canvas.height = Math.floor(vh * dpr);
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
      }
    };

    syncViewport();
    simRef.current = createInitialPetSimulation(viewportRef.current.width, platformsRef.current);

    window.addEventListener("resize", syncViewport);
    const surfaceSyncTimer = window.setInterval(() => {
      const { height: spriteHeight } = getPetRenderedDimensions(configRef.current);
      platformsRef.current = collectPetPlatforms(
        viewportRef.current.width,
        viewportRef.current.height,
        spriteHeight,
      );
    }, 500);

    let rafId = 0;
    let lastTimestamp = performance.now();

    const renderFrame = (now: number) => {
      const dtMs = now - lastTimestamp;
      lastTimestamp = now;

      if (document.visibilityState !== "hidden") {
        const { width, height } = viewportRef.current;
        const activeConfig = configRef.current;
        const { width: spriteWidth, height: spriteHeight } = getPetRenderedDimensions(activeConfig);

        simRef.current = stepPetSimulation(
          simRef.current,
          dtMs,
          width,
          moodRef.current,
          {
            platforms: platformsRef.current,
            behavior: activeConfig.behavior,
            spriteWidth,
          },
        );

        const sim = simRef.current;
        const groundY = sim.groundY > 0 ? sim.groundY : height - 28;
        const submergePx =
          (activeConfig.submergeRows ?? 0) * Math.max(1, Math.round(activeConfig.pixelSize || 2));
        const spriteTop = groundY - spriteHeight + submergePx - sim.y;

        if (hitboxRef.current) {
          hitboxRef.current.style.width = `${spriteWidth}px`;
          hitboxRef.current.style.height = `${spriteHeight}px`;
          hitboxRef.current.style.transform = `translate3d(${Math.round(sim.x)}px, ${Math.round(spriteTop)}px, 0)`;
        }

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, width, height);
          const frame = getPetSpriteFrame(sim.action, sim.animElapsedMs, activeConfig);
          drawPixelPetFrame(
            ctx,
            frame,
            sim.x,
            spriteTop,
            sim.facing,
            activeConfig.pixelSize,
            activeConfig.palette,
            submergePx > 0 ? groundY : undefined,
          );

          if (sim.bubble) {
            drawPixelBubble(
              ctx,
              sim.bubble.text,
              sim.x + spriteWidth / 2,
              spriteTop,
            );
          }
        }
      }

      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", syncViewport);
      window.clearInterval(surfaceSyncTimer);
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  const handlePetClick = () => {
    simRef.current = triggerPetJump(
      simRef.current,
      undefined,
      Math.random,
      configRef.current.behavior,
    );
  };

  const handlePetDoubleClick = () => {
    const platforms = platformsRef.current;
    const other = platforms.find((p) => p.id !== simRef.current.platformId);
    if (other) {
      simRef.current = hopPetToPlatform(simRef.current, other);
    } else {
      simRef.current = triggerPetJump(
        simRef.current,
        "★",
        Math.random,
        configRef.current.behavior,
      );
    }
  };

  const handlePetContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    simRef.current = togglePetPaused(simRef.current);
  };

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[35] overflow-hidden select-none"
      aria-hidden="false"
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none block h-full w-full"
        style={{ imageRendering: "pixelated" }}
      />
      <button
        ref={hitboxRef}
        type="button"
        onClick={handlePetClick}
        onDoubleClick={handlePetDoubleClick}
        onContextMenu={handlePetContextMenu}
        title={t("statusBar.pixelPet.trackHint")}
        aria-label={t("statusBar.pixelPet.trackHint")}
        style={{ width: PET_SPRITE_LOGICAL_SIZE, height: PET_SPRITE_LOGICAL_SIZE }}
        className="pointer-events-auto absolute left-0 top-0 cursor-pointer border-0 bg-transparent p-0 focus:outline-none"
      />
    </div>
  );
}

export default PixelPetTrack;
