/**
 * Hero 像素宠物的动作帧库。
 *
 * 所有帧均为 16×16、默认朝右（facing = 1）。通过“部件拼装”生成：
 * 头、躯干、手臂、腿分别定义，再按姿态偏移组合，保证角色形象一致，
 * 同时让每个动作拥有真实的肢体变化，而不是整图平移或翻转。
 *
 * 墙面帧约定：角色贴在帧的右侧（第 15 列紧贴墙面），左墙通过镜像获得。
 */

export type PixelPartLayer = readonly [part: readonly string[], x: number, y: number];

export const HERO_FRAME_SIZE = 16;

/**
 * 将多个部件按顺序叠加为一帧，`.` 为透明，后绘制的部件覆盖先绘制的部件。
 */
export function composePixelFrame(
  layers: readonly PixelPartLayer[],
  width = HERO_FRAME_SIZE,
  height = HERO_FRAME_SIZE,
): string[] {
  const grid: string[][] = Array.from({ length: height }, () => Array<string>(width).fill("."));
  for (const [part, offsetX, offsetY] of layers) {
    part.forEach((row, rowIndex) => {
      const y = offsetY + rowIndex;
      if (y < 0 || y >= height) return;
      for (let col = 0; col < row.length; col += 1) {
        const ch = row[col];
        const x = offsetX + col;
        if (ch === "." || x < 0 || x >= width) continue;
        grid[y][x] = ch;
      }
    });
  }
  return grid.map((row) => row.join(""));
}

// ---------- 头部（10×7） ----------
const HEAD_SIDE = [
  "..RRRRRR..",
  ".RRRRWRRR.",
  ".rrrrrrRRR",
  ".HHSSSSSS.",
  ".HSSSSESS.",
  ".HSSSSSSSS",
  "..SSSSSs..",
];
const HEAD_SIDE_BLINK = [
  "..RRRRRR..",
  ".RRRRWRRR.",
  ".rrrrrrRRR",
  ".HHSSSSSS.",
  ".HSSSSsSS.",
  ".HSSSSSSSS",
  "..SSSSSs..",
];
const HEAD_SIDE_SLEEP = [
  "..RRRRRR..",
  ".RRRRWRRR.",
  ".rrrrrrRRR",
  ".HHSSSSSS.",
  ".HSSSssSS.",
  ".HSSSSSSSS",
  "..SSSSSs..",
];
const HEAD_FRONT = [
  "..RRRRRR..",
  ".RRRWWRRR.",
  ".rrrrrrrr.",
  ".HSSSSSSH.",
  ".SSESSESS.",
  ".SSSSSSSS.",
  "..SSssSS..",
];
const HEAD_FRONT_SURPRISE = [
  "..RRRRRR..",
  ".RRRWWRRR.",
  ".rrrrrrrr.",
  ".HSSSSSSH.",
  ".SSESSESS.",
  ".SSSSSSSS.",
  "..SSEESS..",
];
const HEAD_FRONT_HAPPY = [
  "..RRRRRR..",
  ".RRRWWRRR.",
  ".rrrrrrrr.",
  ".HSSSSSSH.",
  ".SSsSSsSS.",
  ".SSSSSSSS.",
  "..SsEEsS..",
];

// ---------- 躯干 ----------
const TORSO_SIDE = [
  ".RRRRR.",
  "RRRBBRR",
  ".RBBYB.",
  ".BBBBB.",
];
const TORSO_FRONT = [
  ".RRRRRR.",
  "RRBRRBRR",
  ".RBYYBR.",
  ".BBBBBB.",
];

// ---------- 手臂 ----------
const ARM_DOWN = ["R", "W"];
const ARM_DOWN_FAR = ["r", "w"];
const ARM_FORWARD = ["RW"];
const ARM_BACK = ["WR"];
const ARM_BACK_FAR = ["wr"];
const ARM_UP = ["W", "R"];
const ARM_REACH = ["W", "R", "R"];
const ARM_REACH_FAR = ["w", "r", "r"];

// ---------- 腿（11×3，x=2 时覆盖第 2-12 列） ----------
const LEGS_STAND = ["....BB.BB..", "....BB.BB..", "...KKK.KKK."];
const LEGS_PASS = ["....BBBB...", "....BBbB...", "....KKKKK.."];
const LEGS_STRIDE_A = ["...bb..BB..", "..bb....BB.", ".kkk....KKK"];
const LEGS_STRIDE_B = ["...BB..bb..", "..BB....bb.", ".KKK....kkk"];
const LEGS_RUN_A = ["..bb....BB.", ".bb......BB", "kk.......KK"];
const LEGS_RUN_B = ["..BB....bb.", ".BB......bb", "KK.......kk"];
const LEGS_TUCK = ["...BBBBB...", "..KK...KK.."];
const LEGS_CROUCH = ["..BBB.BBB..", "..KKK.KKK.."];
const LEGS_JUMP = ["....BB.BB..", "....BB..BB.", "...KK....KK"];
const LEGS_FALL = ["...BB...BB.", "..BB.....BB", "..KK.....KK"];
const LEGS_BRAKE = ["....BB.BB..", "...BB...BB.", "..KKK...KKK"];
const LEGS_SIT = ["..BBBBBBB..", "..BBBBBBKKK"];

// 墙面腿（11×3，x=5 时覆盖第 5-15 列，脚尖抵住第 15 列墙面）
const LEGS_WALL_A = ["....BBBBBKK", "...bb......", "...kk......"];
const LEGS_WALL_B = ["....BBB....", "....bb.bbkk", "........bkk"];
const LEGS_WALL_PRESS = ["...BBBBBBKK", "...KK....KK"];
const LEGS_WALL_PUSH = ["......BBBBB", "......bbbKK"];

interface BodyPose {
  head?: readonly string[];
  headX?: number;
  torso?: readonly string[];
  torsoX?: number;
  dy?: number;
  legs: readonly string[];
  legsX?: number;
  legsY?: number;
  /** 绘制在身体后方的手臂（远侧） */
  backArms?: readonly PixelPartLayer[];
  /** 绘制在身体前方的手臂（近侧） */
  frontArms?: readonly PixelPartLayer[];
}

function body(pose: BodyPose): string[] {
  const dy = pose.dy ?? 0;
  const head = pose.head ?? HEAD_SIDE;
  const torso = pose.torso ?? TORSO_SIDE;
  const shift = (layers: readonly PixelPartLayer[] | undefined): PixelPartLayer[] =>
    (layers ?? []).map(([part, x, y]) => [part, x, y + dy] as const);
  return composePixelFrame([
    ...shift(pose.backArms),
    [pose.legs, pose.legsX ?? 2, pose.legsY ?? 13],
    [torso, pose.torsoX ?? 5, 9 + dy],
    [head, pose.headX ?? 3, 2 + dy],
    ...shift(pose.frontArms),
  ]);
}

const ARMS_REST_FAR: PixelPartLayer[] = [[ARM_DOWN_FAR, 5, 10]];
const ARMS_REST_NEAR: PixelPartLayer[] = [[ARM_DOWN, 8, 10]];

const FRONT_ARMS_DOWN: PixelPartLayer[] = [
  [ARM_DOWN, 3, 10],
  [ARM_DOWN, 12, 10],
];
const FRONT_ARMS_UP: PixelPartLayer[] = [
  [ARM_UP, 2, 7],
  [ARM_UP, 13, 7],
];

export const HERO_PALETTE: Record<string, string> = {
  R: "#e53935",
  r: "#b71c1c",
  S: "#ffd1a4",
  s: "#e5a97c",
  H: "#5d3a1a",
  E: "#1b1917",
  B: "#1e88e5",
  b: "#1565c0",
  Y: "#fdd835",
  W: "#ffffff",
  w: "#cfd8dc",
  K: "#6d4c41",
  k: "#4e342e",
};

export const HERO_FRAMES = {
  idle: [
    body({ legs: LEGS_STAND, backArms: ARMS_REST_FAR, frontArms: ARMS_REST_NEAR }),
    body({ legs: LEGS_STAND, dy: 1, backArms: ARMS_REST_FAR, frontArms: ARMS_REST_NEAR }),
    body({ legs: LEGS_STAND, backArms: ARMS_REST_FAR, frontArms: ARMS_REST_NEAR }),
    body({ head: HEAD_SIDE_BLINK, legs: LEGS_STAND, backArms: ARMS_REST_FAR, frontArms: ARMS_REST_NEAR }),
    body({ head: HEAD_FRONT, legs: LEGS_STAND, backArms: ARMS_REST_FAR, frontArms: [[ARM_UP, 11, 4]] }),
    body({ legs: LEGS_STAND, backArms: ARMS_REST_FAR, frontArms: [[ARM_FORWARD, 11, 3]] }),
  ],
  walk: [
    body({ legs: LEGS_STRIDE_B, dy: 1, backArms: [[ARM_FORWARD, 10, 10]], frontArms: [[ARM_BACK, 3, 10]] }),
    body({ legs: LEGS_PASS, backArms: ARMS_REST_FAR, frontArms: ARMS_REST_NEAR }),
    body({ legs: LEGS_STRIDE_A, dy: 1, backArms: [[ARM_BACK_FAR, 3, 10]], frontArms: [[ARM_FORWARD, 10, 10]] }),
    body({ legs: LEGS_PASS, backArms: ARMS_REST_FAR, frontArms: ARMS_REST_NEAR }),
  ],
  run: [
    body({ legs: LEGS_RUN_B, dy: 1, headX: 4, torsoX: 6, backArms: [[ARM_FORWARD, 11, 9]], frontArms: [[ARM_BACK, 3, 11]] }),
    body({ legs: LEGS_TUCK, legsY: 12, headX: 4, torsoX: 6, dy: -1, backArms: ARMS_REST_FAR, frontArms: [[ARM_UP, 11, 9]] }),
    body({ legs: LEGS_RUN_A, dy: 1, headX: 4, torsoX: 6, backArms: [[ARM_BACK_FAR, 3, 11]], frontArms: [[ARM_FORWARD, 11, 9]] }),
    body({ legs: LEGS_TUCK, legsY: 12, headX: 4, torsoX: 6, dy: -1, backArms: [[ARM_UP, 11, 9]], frontArms: ARMS_REST_NEAR }),
  ],
  jump: [
    body({ legs: LEGS_JUMP, legsY: 12, dy: -1, backArms: ARMS_REST_FAR, frontArms: [[ARM_REACH, 13, 6]] }),
  ],
  fall: [
    body({ legs: LEGS_FALL, legsY: 12, dy: -1, backArms: [[ARM_UP, 2, 7]], frontArms: [[ARM_UP, 13, 7]] }),
    body({ legs: LEGS_FALL, legsY: 12, dy: -1, backArms: [[ARM_UP, 1, 8]], frontArms: [[ARM_UP, 14, 8]] }),
  ],
  crouch: [
    body({ legs: LEGS_CROUCH, legsY: 14, dy: 2, backArms: [[ARM_BACK_FAR, 3, 10]], frontArms: [[ARM_BACK, 3, 11]] }),
  ],
  land: [
    body({ legs: LEGS_CROUCH, legsY: 14, dy: 2, backArms: [[ARM_BACK_FAR, 2, 11]], frontArms: [[ARM_FORWARD, 11, 11]] }),
    body({ legs: LEGS_STAND, dy: 1, backArms: ARMS_REST_FAR, frontArms: ARMS_REST_NEAR }),
  ],
  turn: [
    body({ head: HEAD_FRONT, torso: TORSO_FRONT, torsoX: 4, legs: LEGS_STAND, legsX: 1, frontArms: FRONT_ARMS_DOWN }),
  ],
  stop: [
    body({ legs: LEGS_BRAKE, headX: 2, torsoX: 4, backArms: [[ARM_FORWARD, 11, 9]], frontArms: [[ARM_UP, 12, 8]] }),
  ],
  edgeLook: [
    body({ legs: LEGS_STAND, backArms: ARMS_REST_FAR, frontArms: [[ARM_FORWARD, 11, 4]] }),
    body({ legs: LEGS_STAND, backArms: ARMS_REST_FAR, frontArms: [[ARM_FORWARD, 11, 5]] }),
    body({ head: HEAD_FRONT, torso: TORSO_FRONT, torsoX: 4, legs: LEGS_STAND, legsX: 1, frontArms: FRONT_ARMS_DOWN }),
  ],
  alert: [
    body({ head: HEAD_FRONT_SURPRISE, torso: TORSO_FRONT, torsoX: 4, legs: LEGS_STAND, legsX: 1, frontArms: FRONT_ARMS_UP }),
    body({ head: HEAD_FRONT_SURPRISE, torso: TORSO_FRONT, torsoX: 4, legs: LEGS_JUMP, legsX: 1, legsY: 12, dy: -1, frontArms: FRONT_ARMS_UP }),
  ],
  celebrate: [
    body({ head: HEAD_FRONT_HAPPY, torso: TORSO_FRONT, torsoX: 4, legs: LEGS_STAND, legsX: 1, frontArms: FRONT_ARMS_UP }),
    body({ head: HEAD_FRONT_HAPPY, torso: TORSO_FRONT, torsoX: 4, legs: LEGS_TUCK, legsX: 1, legsY: 11, dy: -2, frontArms: [[ARM_UP, 2, 6], [ARM_UP, 13, 6]] }),
    body({ legs: LEGS_JUMP, legsY: 12, dy: -1, backArms: ARMS_REST_FAR, frontArms: [[ARM_REACH, 13, 5]] }),
    body({ head: HEAD_FRONT_HAPPY, torso: TORSO_FRONT, torsoX: 4, legs: LEGS_STAND, legsX: 1, frontArms: FRONT_ARMS_DOWN }),
  ],
  sleep: [
    body({ head: HEAD_SIDE_SLEEP, legs: LEGS_SIT, legsY: 14, dy: 3, backArms: [[ARM_DOWN_FAR, 5, 11]], frontArms: [[ARM_FORWARD, 9, 12]] }),
    body({ head: HEAD_SIDE_SLEEP, legs: LEGS_SIT, legsY: 14, dy: 4, backArms: [[ARM_DOWN_FAR, 5, 10]], frontArms: [[ARM_FORWARD, 9, 11]] }),
  ],
  wallGrab: [
    body({ legs: LEGS_STAND, legsX: 3, headX: 4, torsoX: 6, backArms: ARMS_REST_FAR, frontArms: [[ARM_REACH, 13, 6]] }),
    body({ legs: LEGS_WALL_B, legsX: 5, headX: 4, torsoX: 7, dy: -1, backArms: [[ARM_REACH_FAR, 13, 8]], frontArms: [[ARM_REACH, 14, 4]] }),
    body({ legs: LEGS_WALL_A, legsX: 5, headX: 4, torsoX: 7, dy: -1, backArms: [[ARM_REACH_FAR, 14, 7]], frontArms: [[ARM_REACH, 14, 3]] }),
  ],
  climb: [
    body({ legs: LEGS_WALL_B, legsX: 5, headX: 4, torsoX: 7, backArms: [[ARM_REACH_FAR, 14, 8]], frontArms: [[ARM_REACH, 14, 2]] }),
    body({ legs: LEGS_WALL_A, legsX: 5, headX: 4, torsoX: 7, dy: -1, backArms: [[ARM_REACH_FAR, 14, 5]], frontArms: [[ARM_REACH, 14, 4]] }),
    body({ legs: LEGS_WALL_A, legsX: 5, headX: 4, torsoX: 7, backArms: [[ARM_REACH_FAR, 14, 2]], frontArms: [[ARM_REACH, 14, 8]] }),
    body({ legs: LEGS_WALL_B, legsX: 5, headX: 4, torsoX: 7, dy: -1, backArms: [[ARM_REACH_FAR, 14, 4]], frontArms: [[ARM_REACH, 14, 5]] }),
  ],
  wallHang: [
    body({ legs: LEGS_WALL_A, legsX: 5, headX: 4, torsoX: 7, backArms: [[ARM_REACH_FAR, 14, 6]], frontArms: [[ARM_REACH, 14, 4]] }),
    body({ legs: LEGS_WALL_A, legsX: 5, headX: 4, torsoX: 7, dy: 1, backArms: [[ARM_REACH_FAR, 14, 5]], frontArms: [[ARM_REACH, 14, 3]] }),
    body({ head: HEAD_FRONT, legs: LEGS_WALL_A, legsX: 5, headX: 4, torsoX: 7, backArms: [[ARM_REACH_FAR, 14, 6]], frontArms: [[ARM_REACH, 14, 4]] }),
  ],
  wallJump: [
    body({ legs: LEGS_WALL_PRESS, legsX: 5, legsY: 13, headX: 5, torsoX: 8, dy: 1, backArms: [[ARM_REACH_FAR, 14, 6]], frontArms: [[ARM_REACH, 14, 5]] }),
    body({ legs: LEGS_WALL_PUSH, legsX: 5, legsY: 12, headX: 2, torsoX: 5, dy: -1, backArms: [[ARM_UP, 1, 7]], frontArms: [[ARM_BACK, 2, 10]] }),
  ],
} satisfies Record<string, string[][]>;
