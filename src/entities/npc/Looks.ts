import type { NpcType, HoldingKind } from './types';

export type HairStyle =
  | 'bald'
  | 'buzz'
  | 'short'
  | 'spiky'
  | 'bob'
  | 'long'
  | 'ponytail'
  | 'bun'
  | 'afro'
  | 'curly'
  | 'mohawk'
  | 'sidepart';
export type TopStyle =
  | 'tee'
  | 'longsleeve'
  | 'hoodie'
  | 'jacket'
  | 'tank'
  | 'polo'
  | 'suit'
  | 'uniform'
  | 'cardigan'
  | 'hawaiian'
  | 'gown'
  | 'salmon';
export type BottomStyle = 'pants' | 'shorts' | 'skirt' | 'overalls';
export type HatStyle = 'none' | 'cap' | 'capback' | 'beanie' | 'sunhat' | 'ranger' | 'mortarboard' | 'headband' | 'salmonhood';
export type FacialHair = 'none' | 'mustache' | 'beard';
export type Print = 'none' | 'jimothy' | 'slopcorp';

/** Everything that defines how a human looks. Colors are 0xRRGGBB (sRGB). */
export interface Look {
  /** Overall scale (1 ≈ 1.8 m adult incl. hair). Kids ≈ 0.62. */
  height: number;
  /** Width multiplier (0.9 slim … 1.3 chunky). */
  build: number;
  headScale: number;
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  facialHair: FacialHair;
  top: number;
  topStyle: TopStyle;
  /** Secondary top color (shirt under a jacket, collar, flowers, stripes…). */
  topAccent: number;
  bottom: number;
  bottomStyle: BottomStyle;
  shoes: number;
  /** White soles etc. */
  soles: number;
  socks?: number;
  hat: HatStyle;
  hatColor: number;
  glasses: boolean;
  lashes: boolean;
  print: Print;
  apron?: number;
  sash?: number;
  tie?: number;
  vest?: number;
  badge?: boolean;
  camera?: boolean;
  backpack?: number;
  fannyPack?: number;
  foamFinger?: number;
  boots?: number;
  belt?: number;
}

// ------------------------------------------------------------------ rng

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length) % arr.length];
const range = (r: Rng, a: number, b: number) => a + (b - a) * r();
const chance = (r: Rng, p: number) => r() < p;

// ------------------------------------------------------------------ palettes

export const SKIN = [0xf7dcc8, 0xefc7a8, 0xe0b08b, 0xcf9a70, 0xb57b52, 0x9a6440, 0x7c4d32, 0x5e3a27, 0x4a2e20];
const HAIR_NATURAL = [0x1c1714, 0x2e2119, 0x46301f, 0x6a4428, 0x8f4a25, 0xb8863f, 0xd9b76e, 0x3a2a22];
const HAIR_FUN = [0x3a6fd8, 0xe86aa8, 0x4caf50, 0x8e5bd6, 0xff8a3d];
const HAIR_OLD = [0xb9b9b9, 0xdedede, 0x9d9d9d, 0xeeeeee];
const BRIGHT = [0xe8534a, 0xf2a93b, 0xf5d547, 0x5cb85c, 0x3fa7d6, 0x5b6ee1, 0x9b59b6, 0xe86aa8, 0x2ec4b6, 0xff7f50, 0x20a39e, 0xef476f];
const MUTED = [0x3d5a80, 0x5c6b73, 0x7d8e95, 0x8c5e58, 0x6b705c, 0x2f4858, 0x9a8c98, 0xb56576, 0x355070, 0x7a9e7e];
const RAIN = [0x2a9d8f, 0xe76f51, 0xf4a261, 0x264653, 0x1d3557, 0xe9c46a, 0x457b9d];
const DENIM = [0x3b5b8c, 0x2c4770, 0x4f6fa3, 0x23385a];
const PANTS = [...DENIM, 0x2b2b2b, 0x6b6b6b, 0xa89070, 0x8a7a5c, 0x3e4a3d, 0x5a4636];
const SHOES = [0xf2f2f2, 0x222222, 0x6b4a2f, 0xd9473b, 0x3f5fb5, 0x8a8a8a];
const NEON = [0xc6f432, 0xff4f9a, 0x2de2e6, 0xff9f1c, 0x7b61ff, 0x06d6a0];

// ------------------------------------------------------------------ per-type recipes

export interface TypeInfo {
  display: string;
  /** Article for score popups ("Yeeted a Tourist", "Yeeted the Mayor"). */
  article: string;
  walkSpeed: number;
  runSpeed: number;
  /** Chance per holding kind, remainder = empty hands. */
  holding: [HoldingKind, number][];
}

export const TYPE_INFO: Record<NpcType, TypeInfo> = {
  pedestrian: { display: 'Pedestrian', article: 'a', walkSpeed: 1.3, runSpeed: 4.3, holding: [['phone', 0.3], ['coffee', 0.2], ['sandwich', 0.08], ['icecream', 0.05], ['cottoncandy', 0.04], ['pizza', 0.04]] },
  jogger: { display: 'Jogger', article: 'a', walkSpeed: 3.1, runSpeed: 4.8, holding: [['phone', 0.15]] },
  tourist: { display: 'Tourist', article: 'a', walkSpeed: 1.15, runSpeed: 3.9, holding: [['phone', 0.55], ['icecream', 0.12], ['cottoncandy', 0.1], ['coffee', 0.05]] },
  fan: { display: 'Jimothy Fan', article: 'a', walkSpeed: 1.35, runSpeed: 4.4, holding: [['phone', 0.85]] },
  officer: { display: 'Wildlife Officer', article: 'a', walkSpeed: 1.45, runSpeed: 4.6, holding: [['coffee', 0.2]] },
  fishmonger: { display: 'Fishmonger', article: 'a', walkSpeed: 1.2, runSpeed: 3.9, holding: [] },
  mayor: { display: 'Mayor', article: 'the', walkSpeed: 1.2, runSpeed: 3.8, holding: [['coffee', 0.3]] },
  dean: { display: 'Dean', article: 'the', walkSpeed: 1.05, runSpeed: 3.5, holding: [['coffee', 0.25]] },
  grandma: { display: 'Grandma', article: '', walkSpeed: 0.8, runSpeed: 2.3, holding: [['sandwich', 0.2], ['cottoncandy', 0.1]] },
  kid: { display: 'Kid', article: 'a', walkSpeed: 1.5, runSpeed: 3.8, holding: [['icecream', 0.35], ['cottoncandy', 0.35]] },
  racer: { display: 'Salmon Racer', article: 'a', walkSpeed: 3.3, runSpeed: 5.0, holding: [] },
  techbro: { display: 'Tech Bro', article: 'a', walkSpeed: 1.35, runSpeed: 4.2, holding: [['phone', 0.8], ['coffee', 0.15]] },
};

export function pickHolding(type: NpcType, r: Rng): HoldingKind | null {
  let u = r();
  for (const [k, p] of TYPE_INFO[type].holding) {
    if (u < p) return k;
    u -= p;
  }
  return null;
}

function baseLook(r: Rng): Look {
  const skin = pick(r, SKIN);
  return {
    height: range(r, 0.93, 1.04),
    build: range(r, 0.92, 1.22),
    headScale: range(r, 0.98, 1.08),
    skin,
    hair: chance(r, 0.08) ? pick(r, HAIR_FUN) : pick(r, HAIR_NATURAL),
    hairStyle: pick(r, ['short', 'short', 'buzz', 'spiky', 'bob', 'long', 'ponytail', 'bun', 'afro', 'curly', 'sidepart', 'bald'] as const),
    facialHair: 'none',
    top: pick(r, chance(r, 0.5) ? BRIGHT : MUTED),
    topStyle: pick(r, ['tee', 'tee', 'longsleeve', 'hoodie', 'jacket', 'polo'] as const),
    topAccent: pick(r, [0xf4f1ea, 0x2b2b2b, ...BRIGHT]),
    bottom: pick(r, PANTS),
    bottomStyle: chance(r, 0.18) ? 'shorts' : chance(r, 0.12) ? 'skirt' : 'pants',
    shoes: pick(r, SHOES),
    soles: 0xf0f0f0,
    hat: 'none',
    hatColor: pick(r, [...BRIGHT, ...MUTED]),
    glasses: chance(r, 0.18),
    lashes: chance(r, 0.45),
    print: 'none',
    belt: chance(r, 0.5) ? pick(r, [0x3a2a1e, 0x1e1e1e, 0x6b4a2f]) : undefined,
  };
}

/** Random appearance for a type, with optional overrides. */
export function randomLook(type: NpcType, r: Rng, override?: Partial<Look>): Look {
  const L = baseLook(r);
  const masc = !L.lashes;
  if (masc && chance(r, 0.22)) L.facialHair = chance(r, 0.5) ? 'beard' : 'mustache';
  if (masc && L.hairStyle === 'bun' && chance(r, 0.5)) L.hairStyle = 'short';
  switch (type) {
    case 'pedestrian': {
      if (chance(r, 0.3)) {
        // Seattle rain-jacket crowd
        L.topStyle = 'jacket';
        L.top = pick(r, RAIN);
        L.topAccent = pick(r, [0xf4f1ea, 0x2b2b2b, 0x7d8e95]);
      }
      if (chance(r, 0.22)) L.hat = 'beanie';
      else if (chance(r, 0.12)) L.hat = 'cap';
      if (chance(r, 0.15)) L.backpack = pick(r, MUTED);
      break;
    }
    case 'jogger': {
      L.build = range(r, 0.88, 1.02);
      L.topStyle = pick(r, ['tank', 'tee'] as const);
      L.top = pick(r, NEON);
      L.bottomStyle = 'shorts';
      L.bottom = pick(r, [0x222222, 0x2c3e50, 0x444444, 0x1d3557]);
      L.shoes = pick(r, NEON);
      L.socks = 0xf5f5f5;
      L.hat = chance(r, 0.6) ? 'headband' : 'none';
      L.hatColor = pick(r, NEON);
      if (L.hairStyle === 'long' || L.hairStyle === 'bob') L.hairStyle = 'ponytail';
      L.glasses = false;
      L.belt = undefined;
      break;
    }
    case 'tourist': {
      L.topStyle = 'hawaiian';
      L.top = pick(r, [0x2ec4b6, 0xff7f50, 0x3fa7d6, 0xf5d547, 0xe86aa8, 0x5cb85c]);
      L.topAccent = pick(r, [0xffffff, 0xff4f9a, 0xf5d547, 0xe8534a]);
      L.bottomStyle = 'shorts';
      L.bottom = pick(r, [0xc8b48a, 0xa89070, 0xd8c8a0, 0x8a9a6a]);
      L.shoes = pick(r, [0x7a5230, 0x6b4a2f, 0x9a7a52]);
      L.soles = 0x4a3220;
      L.socks = 0xffffff;
      L.hat = 'sunhat';
      L.hatColor = pick(r, [0xf1e3b8, 0xe9d8a6, 0xffffff, 0xd9c28e]);
      L.camera = chance(r, 0.75);
      L.fannyPack = chance(r, 0.4) ? pick(r, BRIGHT) : undefined;
      L.backpack = !L.fannyPack && chance(r, 0.4) ? pick(r, BRIGHT) : undefined;
      L.glasses = chance(r, 0.35);
      L.build = range(r, 1.0, 1.3);
      break;
    }
    case 'fan': {
      L.topStyle = 'tee';
      L.top = pick(r, [0xffffff, 0xf4f1ea, 0x2ec4b6, 0x20a39e, 0xf5d547, 0xc9d6df]);
      L.print = 'jimothy';
      L.bottomStyle = chance(r, 0.25) ? 'shorts' : 'pants';
      L.bottom = pick(r, DENIM);
      L.hat = chance(r, 0.5) ? pick(r, ['cap', 'capback'] as const) : 'none';
      L.hatColor = pick(r, [0x0c2c56, 0x005c5c, 0x20a39e, 0x1d3557]);
      L.foamFinger = chance(r, 0.4) ? pick(r, [0x20a39e, 0xf5d547, 0x0c2c56]) : undefined;
      break;
    }
    case 'officer': {
      L.topStyle = 'uniform';
      L.top = 0xc8b27d;
      L.topAccent = 0x8f7a4e;
      L.bottomStyle = 'pants';
      L.bottom = 0x4a5a3a;
      L.shoes = 0x4a3222;
      L.soles = 0x2a1a12;
      L.hat = 'ranger';
      L.hatColor = 0xa98752;
      L.badge = true;
      L.belt = 0x2a1f16;
      L.glasses = chance(r, 0.15);
      if (L.hairStyle === 'afro' || L.hairStyle === 'long') L.hairStyle = 'short';
      break;
    }
    case 'fishmonger': {
      L.topStyle = chance(r, 0.5) ? 'tee' : 'longsleeve';
      L.top = pick(r, [0xf4f1ea, 0x8a9ba8, 0x3d5a80]);
      L.bottomStyle = 'overalls';
      L.bottom = 0xf07a24;
      L.apron = 0xf07a24;
      L.boots = 0x1e1e1e;
      L.shoes = 0x1e1e1e;
      L.soles = 0x111111;
      L.hat = chance(r, 0.5) ? 'beanie' : 'none';
      L.hatColor = pick(r, [0x1d3557, 0x2b2b2b, 0x9b2226]);
      L.build = range(r, 1.05, 1.3);
      if (masc && chance(r, 0.4)) L.facialHair = 'beard';
      L.belt = undefined;
      break;
    }
    case 'mayor': {
      L.topStyle = 'suit';
      L.top = 0x1f2d4d;
      L.topAccent = 0xffffff;
      L.tie = 0xc0392b;
      L.sash = 0xd4a017;
      L.bottomStyle = 'pants';
      L.bottom = 0x1f2d4d;
      L.shoes = 0x151515;
      L.soles = 0x151515;
      L.hair = pick(r, [0x9d9d9d, 0x46301f, 0xb9b9b9]);
      L.hairStyle = pick(r, ['sidepart', 'short', 'bob'] as const);
      L.build = range(r, 1.05, 1.25);
      L.belt = undefined;
      break;
    }
    case 'dean': {
      L.topStyle = 'gown';
      L.top = 0x3b1f6b;
      L.topAccent = 0xd4a52a;
      L.bottomStyle = 'pants';
      L.bottom = 0x2b2b2b;
      L.shoes = 0x151515;
      L.soles = 0x151515;
      L.hat = 'mortarboard';
      L.hatColor = 0x222222;
      L.glasses = true;
      L.hair = pick(r, HAIR_OLD);
      L.hairStyle = pick(r, ['short', 'bald', 'bob'] as const);
      if (masc) L.facialHair = pick(r, ['beard', 'mustache', 'none'] as const);
      L.belt = undefined;
      break;
    }
    case 'grandma': {
      L.height = range(r, 0.86, 0.93);
      L.build = range(r, 1.1, 1.3);
      L.lashes = true;
      L.facialHair = 'none';
      L.topStyle = 'cardigan';
      L.top = pick(r, [0xc3a6d6, 0xf2b5c4, 0x9fc5e8, 0xb5d6a7, 0xe8c07d]);
      L.topAccent = pick(r, [0xffffff, 0xf4f1ea, 0xfbe3e8]);
      L.bottomStyle = 'skirt';
      L.bottom = pick(r, [0x6b5b95, 0x5c6b73, 0x8c5e58, 0x3d5a80]);
      L.shoes = pick(r, [0x6b4a2f, 0x2b2b2b, 0x8a6a4a]);
      L.soles = 0x3a2a1e;
      L.hair = pick(r, HAIR_OLD);
      L.hairStyle = 'bun';
      L.glasses = true;
      L.hat = 'none';
      L.belt = undefined;
      break;
    }
    case 'kid': {
      L.height = range(r, 0.58, 0.66);
      L.build = range(r, 0.95, 1.15);
      L.headScale = range(r, 1.32, 1.42);
      L.facialHair = 'none';
      L.topStyle = pick(r, ['tee', 'tee', 'hoodie'] as const);
      L.top = pick(r, BRIGHT);
      L.bottomStyle = chance(r, 0.6) ? 'shorts' : 'pants';
      L.bottom = pick(r, [...DENIM, 0xe8534a, 0x5cb85c]);
      L.shoes = pick(r, BRIGHT);
      L.hat = chance(r, 0.35) ? 'capback' : 'none';
      L.hatColor = pick(r, BRIGHT);
      L.glasses = chance(r, 0.1);
      L.belt = undefined;
      break;
    }
    case 'racer': {
      L.topStyle = 'salmon';
      L.top = 0xf08a6c;
      L.topAccent = 0xfde2d6;
      L.bottomStyle = 'shorts';
      L.bottom = 0x2b2b2b;
      L.shoes = pick(r, NEON);
      L.socks = 0xffffff;
      L.hat = 'salmonhood';
      L.hatColor = 0xf08a6c;
      L.build = range(r, 0.95, 1.1);
      L.glasses = false;
      L.belt = undefined;
      break;
    }
    case 'techbro': {
      L.lashes = chance(r, 0.25);
      L.topStyle = 'hoodie';
      L.top = pick(r, [0x8d8d8d, 0x6e7479, 0x2b2b2b, 0x3a3f4b]);
      L.topAccent = 0xffffff;
      L.vest = pick(r, [0x1a1a1a, 0x23324a, 0x2f3b2f]);
      L.print = 'slopcorp';
      L.bottomStyle = 'pants';
      L.bottom = pick(r, [0xb8a582, 0x2b2b2b, 0x6b6b6b]);
      L.shoes = 0xfafafa;
      L.soles = 0xffffff;
      L.hairStyle = pick(r, ['sidepart', 'short', 'bun', 'buzz'] as const);
      L.glasses = chance(r, 0.35);
      L.hat = 'none';
      L.build = range(r, 0.92, 1.08);
      L.belt = undefined;
      break;
    }
  }
  if (override) Object.assign(L, override);
  return L;
}
