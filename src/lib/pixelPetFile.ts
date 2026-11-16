import { parsePixelPetConfigJson, type PixelPetConfig } from "./pixelPetConfig";

export interface PixelPetFileSnapshot { content: string; encoding: string }

/** Use the selected file's parent as the scope of the existing local file API. */
export function pixelPetFileLocation(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (!/^(?:[a-zA-Z]:\/|\/)/.test(normalized) || index < 0 || index === normalized.length - 1) throw new Error("Expected an absolute file path.");
  return { directory: normalized.slice(0, index + 1), name: normalized.slice(index + 1) };
}

/** Reject incomplete grids instead of silently dropping them during an external save. */
export function parsePixelPetFile(content: string): PixelPetConfig {
  const result = parsePixelPetConfigJson(content.replace(/^\uFEFF/, ""));
  if (!result.ok) throw new Error(result.error);
  const raw = JSON.parse(content.replace(/^\uFEFF/, ""));
  for (const group of [raw.frames, raw.clips]) {
    if (group == null) continue;
    if (typeof group !== "object" || Array.isArray(group)) throw new Error("frames/clips must be objects.");
    for (const [key, frames] of Object.entries(group)) {
      if (!Array.isArray(frames) || frames.length === 0) throw new Error(`${key}: expected at least one frame.`);
      for (const frame of frames) {
        if (!Array.isArray(frame) || frame.length < 1 || frame.length > 32) throw new Error(`${key}: invalid frame height (1–32).`);
        const width = typeof frame[0] === "string" ? frame[0].length : 0;
        if (width < 1 || width > 32 || frame.some((row) => typeof row !== "string" || row.length !== width)) {
          throw new Error(`${key}: frame rows must have equal widths (1–32).`);
        }
        for (const row of frame) for (const char of row) {
          if (char !== "." && !Object.prototype.hasOwnProperty.call(result.config.palette, char)) throw new Error(`${key}: missing palette color ${char}.`);
        }
      }
    }
  }
  return result.config;
}

/** Poll serially so slow reads cannot accumulate. Cleanup rejects all late results. */
export function watchPixelPetFile(options: {
  read: () => Promise<PixelPetFileSnapshot>;
  onLoad: (config: PixelPetConfig, snapshot: PixelPetFileSnapshot) => void;
  onError: (error: string | null) => void;
  intervalMs?: number;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previousContent: string | undefined;
  let previousEncoding: string | undefined;
  async function poll() {
    try {
      const snapshot = await options.read();
      if (stopped) return;
      if (snapshot.content !== previousContent || snapshot.encoding !== previousEncoding) {
        const config = parsePixelPetFile(snapshot.content);
        options.onLoad(config, snapshot);
        previousContent = snapshot.content;
        previousEncoding = snapshot.encoding;
      }
      options.onError(null);
    } catch (error) {
      if (!stopped) options.onError(String(error));
    } finally {
      if (!stopped) timer = setTimeout(poll, options.intervalMs ?? 1000);
    }
  }
  void poll();
  return () => { stopped = true; clearTimeout(timer); };
}

export function buildPixelPetFileGuide(): string {
  return `# Krosna 像素角色 JSON / Pixel pet format

直接编辑配套 JSON 文件并保存；Krosna 约每秒读取一次，校验通过后自动刷新。
文件暂时不完整或无效时，保留上一次正常角色。请勿修改应用源码。
可改造当前角色，也可创建全新角色；新建到其他路径后，需在设置中加载新文件。

- UTF-8 JSON 对象。id（字符串，最多32字符）、name（最多48字符）、pixelSize（整数1–4）。新角色使用新的 id。
- palette：单字符到十六进制颜色的映射，例如 {"K":"#172033"}。点号 . 固定为透明，不要给 . 配色。
- frames：动作到帧数组的映射。每帧是字符串数组，每个字符是一像素；每帧1–32行、每行1–32字符，行宽一致，所有非点字符必须定义在 palette。
- 建议所有动作使用同一画布尺寸并对齐脚底，以免动画跳动；不强制16×16。
- frames.idle 或 frames.walk 至少一个包含有效帧。可用动作：idle、walk、run、jump、sleep、celebrate、alert。未提供的动作会复用 idle/walk，丰富动画需自行绘制。
- clips（可选）：过渡动画，结构同 frames。支持上述动作及 fall、crouch、land、turn、stop、edgeLook、wallGrab、climb、wallHang、wallJump。
- frameDurationsMs（可选）：动作/clip 名到单帧时长（毫秒）的映射。
- frameTimingsMs（可选）：clip 名到逐帧时长数组（每项40–10000毫秒，最多128项）。
- submergeRows（可选，0–12）：向下隐藏的像素行数，普通陆地角色省略。
- behavior（可选，缺失字段使用默认值）：walkSpeedPxPerSec（8–140）、runSpeedPxPerSec（12–220）、jumpVelocityPxPerSec（60–360）、gravityPxPerSec2（200–1600）、sleepAfterIdleMs（2000–120000）。
- behavior 布尔开关：allowPlatformHop、allowWallClimb、reactToCodingMood、enableRandomEvents。攀墙需要 wallGrab 和 climb 动画；随机事件仅在符合角色设计时开启。
- behavior.cheerBubbles / workBubbles：短文字数组，每项最多12字符。

最小结构示例（实际角色请绘制完整造型和动作）：
{"id":"custom","name":"My pet","pixelSize":2,"palette":{"K":"#172033"},"frames":{"idle":[[".KK.","KKKK",".KK."]]},"behavior":{"allowWallClimb":false,"enableRandomEvents":false}}

改造时保留用户未要求修改的内容；保存纯 JSON，不要加 Markdown 围栏或解释文字。
`;
}
