import type { PetActionState } from "./pixelPet";

export type PixelSpriteFrame = readonly string[];

export interface PixelPetBehaviorConfig {
  walkSpeedPxPerSec: number;
  runSpeedPxPerSec: number;
  jumpVelocityPxPerSec: number;
  gravityPxPerSec2: number;
  sleepAfterIdleMs: number;
  allowPlatformHop: boolean;
  reactToCodingMood: boolean;
  cheerBubbles: string[];
  workBubbles: string[];
}

export interface PixelPetConfig {
  id: string;
  name: string;
  pixelSize: number;
  submergeRows?: number;
  palette: Record<string, string>;
  frames: Record<PetActionState, string[][]>;
  frameDurationsMs?: Partial<Record<PetActionState, number>>;
  behavior: PixelPetBehaviorConfig;
}

export const DEFAULT_PET_BEHAVIOR: PixelPetBehaviorConfig = {
  walkSpeedPxPerSec: 28,
  runSpeedPxPerSec: 54,
  jumpVelocityPxPerSec: 185,
  gravityPxPerSec2: 720,
  sleepAfterIdleMs: 10_000,
  allowPlatformHop: true,
  reactToCodingMood: true,
  cheerBubbles: ["!", "+1", "★", "GO!", ":)"],
  workBubbles: ["</>", "...", "RUN", "⚡"],
};

const HERO_PALETTE: Record<string, string> = {
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
  K: "#6d4c41",
  k: "#4e342e",
};

const HERO_FRAMES: Record<PetActionState, string[][]> = {
  idle: [
    [
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBR.....",
      "...RRRBRRBRRR...",
      "..WW.RBYBBYBR...",
      "..WW.BBBBBBBB...",
      ".....BBBBBBBB...",
      "....BBBb..bBBB..",
      "....KKK....KKK..",
      "...KKKK....KKKK.",
    ],
    [
      "................",
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBR.....",
      "...RRRBRRBRRR...",
      "..WW.RBYBBYBR...",
      "..WW.BBBBBBBB...",
      ".....BBBb.bBBB..",
      "....KKK....KKK..",
      "...KKKK....KKKK.",
    ],
  ],
  walk: [
    [
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBR.....",
      "...RRRBRRBRRR...",
      "..W..RBYBBYBRW..",
      ".....BBBBBBBB...",
      "....BBBBBBBB....",
      "...BBB....BBB...",
      "..KKK......KKK..",
      "..KKk......KKKK.",
    ],
    [
      "................",
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBR.....",
      "...RRRBRRBRRR...",
      "...WWRBYBBYBR...",
      ".....BBBBBBBB...",
      ".....BBBBBBB....",
      ".....KKK.KKK....",
      ".....KKKKKKK....",
    ],
    [
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBR.....",
      "...RRRBRRBRRR...",
      "....WRBYBBYBRWW.",
      ".....BBBBBBBB...",
      ".....BBBBBBBB...",
      "....BBB..BBB....",
      "....KKK...KKK...",
      "....KKKK..KKk...",
    ],
    [
      "................",
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBR.....",
      "...RRRBRRBRRR...",
      "...WWRBYBBYBR...",
      ".....BBBBBBBB...",
      ".....BBBBBBB....",
      ".....KKK.KKK....",
      ".....KKKKKKK....",
    ],
  ],
  run: [
    [
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "...RRRBRRBR.....",
      "..WW.RBYBBYBRW..",
      ".....BBBBBBBB...",
      "....BBBBBBBB....",
      "...BBB....BBBB..",
      "..KKK......KKK..",
      ".KKk........KKK.",
      "................",
    ],
    [
      "................",
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBRRR...",
      "....WRBYBBYBRWW.",
      ".....BBBBBBBB...",
      ".....BBBBBBB....",
      "....BBB...BBB...",
      "....KKK...KKK...",
      "....KKKK..KKk...",
    ],
  ],
  jump: [
    [
      ".....RRRRRR..WW.",
      "....RRRRWRRR.RR.",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "...RRRBRRBRR....",
      "..WW.RBYBBYBR...",
      ".....BBBBBBBB...",
      "....BBBBBBBB....",
      "...BBB....BBB...",
      "..KKK......KKK..",
      "..KKk......KKk..",
      "................",
    ],
  ],
  celebrate: [
    [
      ".WW..RRRRRR..WW.",
      ".RR.RRRRWRRR.RR.",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBRR....",
      ".....RBYBBYBR...",
      ".....BBBBBBBB...",
      ".....BBBBBBBB...",
      "....BBB....BBB..",
      "...KKK......KKK.",
      "...KKk......KKk.",
      "................",
    ],
  ],
  sleep: [
    [
      "................",
      "................",
      "................",
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSH...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBRRR...",
      "...WWRBYBBYBR...",
      "....BBBBBBBBb...",
      "...KKKK..KKKK...",
      "...kkk....kkk...",
    ],
    [
      "................",
      "................",
      "................",
      "................",
      ".....RRRRRR.....",
      "....RRRRWRRR....",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSH...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "....RRBRRBRRR...",
      "...WWRBYBBYBR...",
      "....BBBBBBBBb...",
      "...KKKK..KKKK...",
    ],
  ],
  alert: [
    [
      ".....RRRRRR..WW.",
      "....RRRRWRRR.RR.",
      "....RRRRRRRRRR..",
      "....HHHHSSSS....",
      "...HHSHHSSSHS...",
      "...HHSHHHSSSE...",
      "...HHHHSSSSHHH..",
      ".....SSSSSSS....",
      "...RRRBRRBRR....",
      "..WW.RBYBBYBR...",
      ".....BBBBBBBB...",
      "....BBBBBBBB....",
      "...BBB....BBB...",
      "..KKK......KKK..",
      "..KKk......KKk..",
      "................",
    ],
  ],
};

const CAT_PALETTE: Record<string, string> = {
  O: "#fb8c00",
  o: "#e65100",
  C: "#ffe0b2",
  P: "#f48fb1",
  E: "#1e1b18",
  W: "#fff8e1",
};

const CAT_IDLE_0 = [
  "................",
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  ".O......OOEOOEO.",
  "OO.....OOOOOOOP.",
  "OO....oOOOOOOCC.",
  ".OO..OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "...OO.OO.OO.OO..",
  "...OO.OO.OO.OO..",
  "...WW.WW.WW.WW..",
];

const CAT_IDLE_1 = [
  "................",
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  "..O.....OOEOOEO.",
  ".OO....OOOOOOOP.",
  ".OO...oOOOOOOCC.",
  "..OO.OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "...OO.OO.OO.OO..",
  "...OO.OO.OO.OO..",
  "...WW.WW.WW.WW..",
];

const CAT_WALK_0 = [
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  ".O......OOEOOEO.",
  "OO.....OOOOOOOP.",
  "OO....oOOOOOOCC.",
  ".OO..OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "..OO..OO..OO.OO.",
  ".OO...OO...OO.OO",
  ".WW...WW...WW.WW",
  "................",
];

const CAT_WALK_1 = [
  "................",
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  "..O.....OOEOOEO.",
  ".OO....OOOOOOOP.",
  ".OO...oOOOOOOCC.",
  "..OO.OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "...OO.OO.OO.OO..",
  "....OO.OO.OO.OO.",
  "....WW.WW.WW.WW.",
];

const CAT_WALK_2 = [
  "................",
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  "..O.....OOEOOEO.",
  "..OO...OOOOOOOP.",
  "...OO.oOOOOOOCC.",
  "...OOOOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  "...OO.OO..OO..OO",
  "..OO..OO..OO...O",
  "..WW..WW..WW...W",
  "................",
];

const CAT_JUMP = [
  "................",
  "................",
  ".........O...O..",
  "........OPO.OPO.",
  "........OOOOOOO.",
  "O.......OOEOOEO.",
  "OO.....OOOOOOOP.",
  ".OO...oOOOOOOCC.",
  "..OO.OOOOoOOO...",
  "..OOOOOOOOOOO...",
  "..OOOOCCCCCOO...",
  ".OO.OO....OO..OO",
  "WW..WW....WW..WW",
  "................",
  "................",
  "................",
];

const CAT_SLEEP = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "......O...O.....",
  ".....OPO.OPO....",
  "....OOOOOOOOO...",
  "...OOoOOOOOoOO..",
  "..OOOOOOOOOOOOO.",
  "..OOOOCCCCCOOOO.",
  "...OOOOOOOOOOO..",
  "....WWWWWWWWW...",
];

const BOT_PALETTE: Record<string, string> = {
  B: "#8fa9c2",
  H: "#d6e4f0",
  s: "#52697f",
  K: "#111827",
  Y: "#fefce8",
  C: "#92400e",
  F: "#f97316",
};

const BOT_IDLE_0 = [
  "............HH............",
  "............BB............",
  "............BB............",
  ".........HHHBBBBH.........",
  ".......HHBBBBBBBBBs.......",
  "......HHBBBBBBBBBBBs......",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  "....KssYYYYYYKKYYYYYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYYYYKKYYYYYYK....",
  ".....KKKKKKKKKKKKKKKK.....",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  ".....KYYYsYYYsYYYsYYK.....",
  ".....KsssysssysssyssK.....",
  ".....KYYYsYYYsYYYsYYKCCCF.",
  ".....KKKKKKKKKKKKKKKK.....",
  ".......HBBBBBBBBBBs.......",
  ".....HHBBBBBBBBBBBBss.....",
  "....HBBBsBBBBBBBBssBBs....",
  "...HBBBs.BsssssssB.sBBs...",
  "...sBBs..BsBBBBBsB..sBB...",
  "...sBB...BsBBBBsKB..sBB...",
  "....ss...BsssssssB..ss....",
  ".........BBBBBBBBs........",
  ".........sBB..BBs.........",
  ".........sBB..BBs.........",
  ".........sBB..BBs.........",
  "........KKKK..KKKK........",
  ".......KKKKK..KKKKK.......",
];

const BOT_IDLE_1 = [
  "............HH............",
  "............BB............",
  "............BB............",
  ".........HHHBBBBH.........",
  ".......HHBBBBBBBBBs.......",
  "......HHBBBBBBBBBBBs......",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  "....KssYYYYYYKKYYYYYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYYYYKKYYYYYYK....",
  ".....KKKKKKKKKKKKKKKK.....",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  ".....KYYYsYYYsYYYsYYK.....",
  ".....KsssysssysssyssK.....",
  ".....KYYYsYYYsYYYsYYKCCC..",
  ".....KKKKKKKKKKKKKKKK.....",
  ".......HBBBBBBBBBBs.......",
  ".....HHBBBBBBBBBBBBss.....",
  "....HBBBsBBBBBBBBssBBs....",
  "...HBBBs.BsssssssB.sBBs...",
  "...sBBs..BsBBBBBsB..sBB...",
  "...sBB...BsBBBBsKB..sBB...",
  "....ss...BsssssssB..ss....",
  ".........BBBBBBBBs........",
  ".........sBB..BBs.........",
  ".........sBB..BBs.........",
  ".........sBB..BBs.........",
  "........KKKK..KKKK........",
  ".......KKKKK..KKKKK.......",
];

const BOT_WALK_0 = [
  "............HH............",
  "............BB............",
  "............BB............",
  ".........HHHBBBBH.........",
  ".......HHBBBBBBBBBs.......",
  "......HHBBBBBBBBBBBs......",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  "....KssYYYYYYKKYYYYYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYYYYKKYYYYYYK....",
  ".....KKKKKKKKKKKKKKKK.....",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  ".....KYYYsYYYsYYYsYYK.....",
  ".....KsssysssysssyssK.....",
  ".....KYYYsYYYsYYYsYYKCCCF.",
  ".....KKKKKKKKKKKKKKKK.....",
  ".......HBBBBBBBBBBs.......",
  ".....HHBBBBBBBBBBBBss.....",
  "..HHBBBs.BBBBBBBB.sBBBs...",
  ".HHBBs...BsssssssB..sBBs..",
  "..ss.....BsBBBBBsB...ss...",
  ".........BsBBBBsKB........",
  ".........BsssssssB........",
  ".........BBBBBBBBs........",
  "........sBB....BBs........",
  ".......sBB......BBs.......",
  "......sBB........BBs......",
  ".....KKKK........KKKK.....",
  "....KKKKK........KKKKK....",
];

const BOT_WALK_1 = [
  "..........................",
  "............HH............",
  "............BB............",
  ".........HHHBBBBH.........",
  ".......HHBBBBBBBBBs.......",
  "......HHBBBBBBBBBBBs......",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  "....KssYYYYYYKKYYYYYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYYYYKKYYYYYYK....",
  ".....KKKKKKKKKKKKKKKK.....",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  ".....KYYYsYYYsYYYsYYK.....",
  ".....KsssysssysssyssK.....",
  ".....KYYYsYYYsYYYsYYKCCC..",
  ".....KKKKKKKKKKKKKKKK.....",
  ".......HBBBBBBBBBBs.......",
  ".....HHBBBBBBBBBBBBss.....",
  "....HBBBsBBBBBBBBssBBs....",
  "...HBBBs.BsssssssB.sBBs...",
  "...sBBs..BsBBBBBsB..sBB...",
  "....ss...BsBBBBsKB..ss....",
  ".........BsssssssB........",
  ".........BBBBBBBBs........",
  "..........BB..BBs.........",
  "..........BB..BBs.........",
  ".........sBB..BBs.........",
  "........KKKK..KKKK........",
  ".......KKKKK..KKKKK.......",
];

const BOT_JUMP = [
  "..ss........HH........ss..",
  "..ss........BB........ss..",
  "...BB.......BB.......BB...",
  "....BB...HHHBBBBH...BB....",
  ".....BBHHBBBBBBBBBsBB.....",
  "......HHBBBBBBBBBBBs......",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  "....KssYYYYYYKKYYYYYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYKYYKKYYYKYYK....",
  "....KssYYYYYYKKYYYYYYK....",
  ".....KKKKKKKKKKKKKKKK.....",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  ".....KYYYsYYYsYYYsYYK.....",
  ".....KsssysssysssyssK.....",
  ".....KYYYsYYYsYYYsYYKCCCF.",
  ".....KKKKKKKKKKKKKKKK.....",
  ".......HBBBBBBBBBBs.......",
  ".......BBBBBBBBBBBs.......",
  "........BsssssssB.........",
  "........BsBBBBBsB.........",
  "........BsBBBBsKB.........",
  "........BsssssssB.........",
  ".........BBBBBBBBs........",
  "........sBB....BBs........",
  ".......KKKK....KKKK.......",
  "......KKKKK....KKKKK......",
  "..........................",
  "..........................",
  "..........................",
];

const BOT_SLEEP = [
  "..........................",
  "..........................",
  "............ss............",
  "............BB............",
  ".........HHHBBBBH.........",
  ".......HHBBBBBBBBBs.......",
  "......HHBBBBBBBBBBBs......",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  "....KssBBBBBBKKBBBBBBK....",
  "....KssssssssKKssssssK....",
  "....KssBBBBBBKKBBBBBBK....",
  ".....KKKKKKKKKKKKKKKK.....",
  "......HBBBBBBBBBBBBs......",
  ".....KKKKKKKKKKKKKKKK.....",
  ".....KYYYsYYYsYYYsYYK.....",
  ".....KsssysssysssyssK.....",
  ".....KYYYsYYYsYYYsYYK.....",
  ".....KKKKKKKKKKKKKKKK.....",
  ".......HBBBBBBBBBBs.......",
  ".....HHBBBBBBBBBBBBss.....",
  "....HBBBsBBBBBBBBssBBs....",
  "...HBBBs.BsssssssB.sBBs...",
  "...sBBs..BsBBBBBsB..sBB...",
  "....ss...BsBBBBsKB..ss....",
  ".........BsssssssB........",
  ".........BBBBBBBBs........",
  ".........sBB..BBs.........",
  ".........sBB..BBs.........",
  "........KKKK..KKKK........",
  ".......KKKKK..KKKKK.......",
  "..........................",
];

const WHALE_PALETTE: Record<string, string> = {
  A: "#bae6fd",
  B: "#38bdf8",
  b: "#0ea5e9",
  L: "#ffffff",
  E: "#0f172a",
  P: "#fda4af",
};

const WHALE_IDLE_0 = [
  "......................",
  "......................",
  ".......AABBBBAA.......",
  ".....ABBBBBBBBBBA.....",
  "....ABBBBBBBBBBEWB....",
  ".A..BBBBBBBBBBBBPB....",
  "bB.ABBBBBBBBBBBBBB....",
  ".bABBBBBLLLLLLLLLA....",
  "..ABBBBLLLLLLLLLA.....",
  "...AAbLLLLLLLLLA......",
  ".....AAAAAAAAA........",
];

const WHALE_IDLE_1 = [
  ".........A.A..........",
  "..........A...........",
  ".......AABBBBAA.......",
  ".....ABBBBBBBBBBA.....",
  "....ABBBBBBBBBBEWB....",
  ".A..BBBBBBBBBBBBPB....",
  "bB.ABBBBBBBBBBBBBB....",
  ".bABBBBBLLLLLLLLLA....",
  "..ABBBBLLLLLLLLLA.....",
  "...AAbLLLLLLLLLA......",
  ".....AAAAAAAAA........",
];

const WHALE_SWIM_0 = [
  ".........A.A..........",
  "..........A...........",
  ".......AABBBBAA.......",
  ".....ABBBBBBBBBBA.....",
  "....ABBBBBBBBBBEWB....",
  ".A..BBBBBBBBBBBBPB....",
  "bB.ABBBBBBBBBBBBBB....",
  ".bABBBBBLLLLLLLLLA....",
  "..ABBBBLLLLLLLLLA.....",
  "...AAbLLLLLLLLLA......",
  ".....AAAAAAAAA........",
];

const WHALE_SWIM_1 = [
  "........A...A.........",
  ".........A.A..........",
  ".......AABBBBAA.......",
  ".....ABBBBBBBBBBA.....",
  "....ABBBBBBBBBBEWB....",
  "....BBBBBBBBBBBBPB....",
  ".A.ABBBBBBBBBBBBBB....",
  "bBABBBBBLLLLLLLLLA....",
  "..ABBBBLLLLLLLLLA.....",
  "...AAbLLLLLLLLLA......",
  ".....AAAAAAAAA........",
];

const WHALE_JUMP = [
  "........A...A.........",
  ".......A.A.A.A........",
  ".......AABBBBAA.......",
  ".....ABBBBBBBBBBA.....",
  "....ABBBBBBBBBBEWB....",
  ".A..BBBBBBBBBBBBPB....",
  "bB.ABBBBBBBBBBBBBB....",
  ".bABBBBBLLLLLLLLLA....",
  "..ABBBBLLLLLLLLLA.....",
  "...AAbLLLLLLLLLA......",
  ".....AAAAAAAAA........",
];

const WHALE_SLEEP = [
  "......................",
  "......................",
  ".......AABBBBAA.......",
  ".....ABBBBBBBBBBA.....",
  "....ABBBBBBBBBbbbB....",
  ".A..BBBBBBBBBBBBPB....",
  "bB.ABBBBBBBBBBBBBB....",
  ".bABBBBBLLLLLLLLLA....",
  "..ABBBBLLLLLLLLLA.....",
  "...AAbLLLLLLLLLA......",
  ".....AAAAAAAAA........",
];

export const PIXEL_PET_PRESETS: PixelPetConfig[] = [
  {
    id: "hero",
    name: "Red Cap Hero",
    pixelSize: 2,
    palette: HERO_PALETTE,
    frames: HERO_FRAMES,
    frameDurationsMs: {
      idle: 520,
      walk: 145,
      run: 95,
      jump: 200,
      sleep: 650,
      celebrate: 200,
      alert: 220,
    },
    behavior: { ...DEFAULT_PET_BEHAVIOR },
  },
  {
    id: "cat",
    name: "Pixel Ginger Cat",
    pixelSize: 2,
    palette: CAT_PALETTE,
    frames: {
      idle: [CAT_IDLE_0, CAT_IDLE_1],
      walk: [CAT_WALK_0, CAT_WALK_1, CAT_WALK_2, CAT_WALK_1],
      run: [CAT_WALK_0, CAT_WALK_2],
      jump: [CAT_JUMP],
      celebrate: [CAT_JUMP],
      sleep: [CAT_SLEEP],
      alert: [CAT_IDLE_0],
    },
    frameDurationsMs: {
      idle: 550,
      walk: 145,
      run: 95,
    },
    behavior: {
      ...DEFAULT_PET_BEHAVIOR,
      walkSpeedPxPerSec: 24,
      runSpeedPxPerSec: 58,
      cheerBubbles: ["Meow", "♥", "★", "~"],
      workBubbles: ["purr", "</>", "🐾"],
    },
  },
  {
    id: "bot",
    name: "Bender",
    pixelSize: 1,
    palette: { ...BOT_PALETTE, y: "#94a3b8" },
    frames: {
      idle: [BOT_IDLE_0, BOT_IDLE_1],
      walk: [BOT_WALK_0, BOT_WALK_1],
      run: [BOT_WALK_0, BOT_WALK_1],
      jump: [BOT_JUMP],
      celebrate: [BOT_JUMP],
      sleep: [BOT_SLEEP],
      alert: [BOT_JUMP],
    },
    frameDurationsMs: {
      walk: 155,
      run: 95,
    },
    behavior: {
      ...DEFAULT_PET_BEHAVIOR,
      walkSpeedPxPerSec: 30,
      runSpeedPxPerSec: 60,
      cheerBubbles: ["BITE", "40%", "HA!", "COOL"],
      workBubbles: ["BEER", "101", "⚡"],
    },
  },
  {
    id: "whale",
    name: "Pixel AA Cream Whale",
    pixelSize: 2,
    submergeRows: 2,
    palette: { ...WHALE_PALETTE, W: "#ffffff" },
    frames: {
      idle: [WHALE_IDLE_0, WHALE_IDLE_1],
      walk: [WHALE_SWIM_0, WHALE_SWIM_1],
      run: [WHALE_SWIM_0, WHALE_SWIM_1],
      jump: [WHALE_JUMP],
      celebrate: [WHALE_JUMP],
      sleep: [WHALE_SLEEP],
      alert: [WHALE_JUMP],
    },
    frameDurationsMs: {
      idle: 700,
      walk: 280,
      run: 140,
    },
    behavior: {
      ...DEFAULT_PET_BEHAVIOR,
      walkSpeedPxPerSec: 26,
      runSpeedPxPerSec: 52,
      cheerBubbles: ["~", "♥", "★", "oO", ":3"],
      workBubbles: ["oO", "~~~", "</>", "💧"],
    },
  },
];

export const DEFAULT_PIXEL_PET_CONFIG: PixelPetConfig =
  PIXEL_PET_PRESETS.find((preset) => preset.id === "whale") ?? PIXEL_PET_PRESETS[0];

const ACTION_KEYS: PetActionState[] = [
  "idle",
  "walk",
  "run",
  "jump",
  "sleep",
  "celebrate",
  "alert",
];

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function sanitizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const filtered = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 12));
  return filtered.length > 0 ? filtered : [...fallback];
}

function isValidFrame(frame: unknown): frame is string[] {
  return (
    Array.isArray(frame)
    && frame.length > 0
    && frame.length <= 32
    && frame.every((row) => typeof row === "string" && row.length > 0 && row.length <= 32)
  );
}

/**
 * Parse and validate a user or AI-generated PixelPetConfig JSON string.
 */
export function parsePixelPetConfigJson(
  rawJson: string,
): { ok: true; config: PixelPetConfig } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "Config must be a JSON object." };
  }

  const record = parsed as Record<string, unknown>;
  const rawPalette = record.palette;
  if (!rawPalette || typeof rawPalette !== "object" || Array.isArray(rawPalette)) {
    return { ok: false, error: "Missing palette object." };
  }

  const palette: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawPalette as Record<string, unknown>)) {
    if (key.length === 1 && typeof val === "string" && val.trim().length > 0) {
      palette[key] = val.trim();
    }
  }
  if (Object.keys(palette).length === 0) {
    return { ok: false, error: "Palette must define at least one single-character color entry." };
  }

  const rawFrames = record.frames;
  if (!rawFrames || typeof rawFrames !== "object" || Array.isArray(rawFrames)) {
    return { ok: false, error: "Missing frames object." };
  }

  const frameMap = rawFrames as Record<string, unknown>;
  const rawIdle = Array.isArray(frameMap.idle) ? frameMap.idle.filter(isValidFrame) : [];
  const rawWalk = Array.isArray(frameMap.walk) ? frameMap.walk.filter(isValidFrame) : [];
  if (rawIdle.length === 0 && rawWalk.length === 0) {
    return { ok: false, error: "frames.idle or frames.walk must contain at least one pixel grid." };
  }

  const fallbackIdle = rawIdle.length > 0 ? rawIdle : rawWalk;
  const fallbackWalk = rawWalk.length > 0 ? rawWalk : fallbackIdle;

  const frames = {} as Record<PetActionState, string[][]>;
  for (const action of ACTION_KEYS) {
    const candidate = frameMap[action];
    const valid = Array.isArray(candidate) ? candidate.filter(isValidFrame) : [];
    if (valid.length > 0) {
      frames[action] = valid;
    } else if (action === "walk" || action === "run") {
      frames[action] = fallbackWalk;
    } else {
      frames[action] = fallbackIdle;
    }
  }

  const rawBehavior =
    record.behavior && typeof record.behavior === "object" && !Array.isArray(record.behavior)
      ? (record.behavior as Record<string, unknown>)
      : {};

  const behavior: PixelPetBehaviorConfig = {
    walkSpeedPxPerSec: clampNumber(
      rawBehavior.walkSpeedPxPerSec,
      DEFAULT_PET_BEHAVIOR.walkSpeedPxPerSec,
      8,
      140,
    ),
    runSpeedPxPerSec: clampNumber(
      rawBehavior.runSpeedPxPerSec,
      DEFAULT_PET_BEHAVIOR.runSpeedPxPerSec,
      12,
      220,
    ),
    jumpVelocityPxPerSec: clampNumber(
      rawBehavior.jumpVelocityPxPerSec,
      DEFAULT_PET_BEHAVIOR.jumpVelocityPxPerSec,
      60,
      360,
    ),
    gravityPxPerSec2: clampNumber(
      rawBehavior.gravityPxPerSec2,
      DEFAULT_PET_BEHAVIOR.gravityPxPerSec2,
      200,
      1600,
    ),
    sleepAfterIdleMs: clampNumber(
      rawBehavior.sleepAfterIdleMs,
      DEFAULT_PET_BEHAVIOR.sleepAfterIdleMs,
      2000,
      120_000,
    ),
    allowPlatformHop:
      typeof rawBehavior.allowPlatformHop === "boolean"
        ? rawBehavior.allowPlatformHop
        : DEFAULT_PET_BEHAVIOR.allowPlatformHop,
    reactToCodingMood:
      typeof rawBehavior.reactToCodingMood === "boolean"
        ? rawBehavior.reactToCodingMood
        : DEFAULT_PET_BEHAVIOR.reactToCodingMood,
    cheerBubbles: sanitizeStringArray(rawBehavior.cheerBubbles, DEFAULT_PET_BEHAVIOR.cheerBubbles),
    workBubbles: sanitizeStringArray(rawBehavior.workBubbles, DEFAULT_PET_BEHAVIOR.workBubbles),
  };

  const config: PixelPetConfig = {
    id:
      typeof record.id === "string" && record.id.trim().length > 0
        ? record.id.trim().slice(0, 32)
        : "custom",
    name:
      typeof record.name === "string" && record.name.trim().length > 0
        ? record.name.trim().slice(0, 48)
        : "Custom Pixel Pet",
    pixelSize: Math.round(clampNumber(record.pixelSize, 2, 1, 4)),
    submergeRows:
      typeof record.submergeRows === "number"
        ? Math.round(clampNumber(record.submergeRows, 0, 0, 12))
        : undefined,
    palette,
    frames,
    frameDurationsMs:
      record.frameDurationsMs && typeof record.frameDurationsMs === "object"
        ? (record.frameDurationsMs as Partial<Record<PetActionState, number>>)
        : undefined,
    behavior,
  };

  return { ok: true, config };
}

/**
 * Generate a prompt template users can give to any AI to design new pixel pets & behavior JSON.
 */
export function buildPixelPetAiPrompt(baseConfig: PixelPetConfig): string {
  return [
    "Design a new 16x16 pixel-art pet configuration in pure JSON for Krosna.",
    "Rules:",
    "1. Keep it strictly pixel art using ASCII character grids in `frames` (16 rows of 16 characters, `.` = transparent).",
    "2. Define every non-dot character in `palette` as a hex color.",
    "3. Tune `behavior` (`walkSpeedPxPerSec`, `runSpeedPxPerSec`, `jumpVelocityPxPerSec`, `sleepAfterIdleMs`, `cheerBubbles`, `workBubbles`) to match the character's personality.",
    "4. Return ONLY valid JSON matching this schema:",
    JSON.stringify(baseConfig, null, 2),
  ].join("\n\n");
}
