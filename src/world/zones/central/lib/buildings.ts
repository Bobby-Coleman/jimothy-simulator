import * as THREE from 'three';
import type { Game } from '../../../../core/Game';
import type { World } from '../../../World';
import { Batch, mergeColored, T, TR } from './batch';
import { fitRect, type AtlasRect, type SignAtlas } from './signs';
import { applyStripeRow, cached, loadPBR, recoloredBrick, stripeMaterial, stripeTexture, windowTexture } from './textures';
import { boxColliderEuler, glowAtNight, Rng } from './util';
import { warmGlowMat } from './furniture';
import { RAPIER } from '../../../../core/Physics';

/**
 * Procedural historic storefront buildings (Old Ballard style): brick body, storefront with display windows,
 * door, transom, sign band, striped awning, upper-floor sash windows with sills/lintels, cornice + parapet,
 * rooftop clutter, alley-side back door / fire escape. All geometry goes into a shared Batch.
 */

export interface BuildingKit {
  game: Game;
  world: World;
  batch: Batch;
  atlas: SignAtlas;
  rng: Rng;
}

export interface StoreSpec {
  name: string;
  /** Along-street extent (world X). */
  x0: number;
  x1: number;
  /** World Z of the facade plane. */
  facadeZ: number;
  /** +1: facade faces +Z (north side of a street). -1: faces -Z. */
  facing: 1 | -1;
  depth: number;
  floors: number;
  groundH?: number;
  floorH?: number;
  wall: string;
  painted?: boolean;
  trim: string;
  /** Accent colour (door, window frames). */
  accent?: string;
  sign?: AtlasRect;
  signGlow?: boolean;
  /** Sign width in meters (default: most of the storefront). */
  signW?: number;
  shopArt?: AtlasRect;
  awning?: [string, string] | null;
  door?: 'center' | 'left' | 'right';
  parapet?: 'flat' | 'stepped';
  yearRect?: AtlasRect;
  fireEscape?: boolean;
  roofStuff?: number;
  flowerBoxes?: boolean;
  litChance?: number;
  /** Skip the storefront (plain ground floor with windows), e.g. for rear/apartment facades. */
  plainGround?: boolean;
  /** Back side details (door, drainpipe). Default true. */
  back?: boolean;
  /** Local X of the alley back door (default random). */
  backDoorX?: number;
  /** Extra ground-floor height offset (sidewalk level). */
  baseY?: number;
}

export interface BuiltStore {
  spec: StoreSpec;
  height: number;
  /** World matrix of the local frame (origin at facade centre, +Z out of the facade). */
  frame: THREE.Matrix4;
  yaw: number;
  width: number;
  /** World position of the front door (at the sidewalk). */
  door: THREE.Vector3;
  roofCenter: THREE.Vector3;
}

// ------------------------------------------------------------------------------------------- materials

export function trimMat() {
  return cached('mat:trim', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 }));
}
export function darkGlassMat() {
  return cached('mat:darkGlass', () => new THREE.MeshStandardMaterial({ color: 0x2b3d4d, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.5 }));
}
export function windowMats(game: Game) {
  return cached('mat:windows', () => {
    const dark = new THREE.MeshStandardMaterial({ map: windowTexture('dark'), roughness: 0.18, metalness: 0.25 });
    const litTex = windowTexture('lit');
    const lit = new THREE.MeshStandardMaterial({ map: litTex, emissiveMap: litTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35 });
    glowAtNight(game, lit, 0.0, 1.35);
    return { dark, lit };
  });
}

/**
 * Shared brick materials (one for raw brick, one for painted brick). The texture is a neutral (near-white)
 * brick pattern; each building's colour comes from vertex colours, so every wall in town is one draw call.
 * (`color` is only used as the fallback base colour when the texture is missing.)
 */
export async function brickMat(game: Game, color: string, painted = false): Promise<THREE.MeshStandardMaterial> {
  return cached(`mat:brick:${painted}`, async () => {
    const pbr = await loadPBR(game, 'brick');
    const map = await recoloredBrick('#f7f3ee', painted ? '#dcd8d2' : '#a9a39a', painted);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: map ?? null,
      normalMap: pbr.normalMap,
      normalScale: new THREE.Vector2(painted ? 0.45 : 0.9, painted ? 0.45 : 0.9),
      roughness: 0.92,
    });
  });
}

export function awningMat(a: string, b: string) {
  return cached(`mat:awning:${a}:${b}`, () => new THREE.MeshStandardMaterial({ map: stripeTexture(a, b, 8), roughness: 0.85, side: THREE.DoubleSide }));
}

export function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}

// ------------------------------------------------------------------------------------------- builder

const bx = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export async function buildStore(kit: BuildingKit, s: StoreSpec): Promise<BuiltStore> {
  const { game, world, batch, atlas, rng } = kit;
  const W = s.x1 - s.x0;
  const D = s.depth;
  const gH = s.groundH ?? 4.6;
  const fH = s.floorH ?? 3.6;
  const H = gH + (s.floors - 1) * fH;
  const base = s.baseY ?? 0;
  const yaw = s.facing === 1 ? 0 : Math.PI;
  const cx = (s.x0 + s.x1) / 2;
  const M = T(cx, base, s.facadeZ, yaw);
  const trim = trimMat();
  const trimC = s.trim;
  const accent = s.accent ?? shade(s.trim, 0.5);
  const wallMat = await brickMat(game, s.wall, s.painted);
  const win = windowMats(game);
  const glass = darkGlassMat();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, local: THREE.Matrix4, color?: string | number, shadow = true) =>
    batch.add(geo, mat, { matrix: M.clone().multiply(local), color, castShadow: shadow });
  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, color: string | number, mat: THREE.Material = trim, shadow = true) =>
    add(bx(w, h, d), mat, T(x, y, z), color, shadow);
  const lp = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(M);

  // body (brick, world-space UVs)
  batch.add(bx(W, H, D), wallMat, { matrix: M.clone().multiply(T(0, H / 2, -D / 2)), uv: 2.3, color: s.wall });
  world.collider(lp(0, H / 2, -D / 2), new THREE.Vector3(W, H, D), yaw);
  // roof cap
  addBox(W - 0.1, 0.06, D - 0.1, 0, H + 0.03, -D / 2, '#55565c', trim, false);

  // ---------------------------------------------------------------- ground floor
  const Ws = W - 1.0;
  addBox(0.5, gH, 0.14, -W / 2 + 0.25, gH / 2, 0.07, shade(trimC, 0.95));
  addBox(0.5, gH, 0.14, W / 2 - 0.25, gH / 2, 0.07, shade(trimC, 0.95));
  addBox(W + 0.1, 0.28, 0.3, 0, gH - 0.02, 0.14, trimC);
  if (!s.plainGround) {
    const doorW = 1.25;
    const doorX = s.door === 'left' ? -Ws / 2 + doorW / 2 + 0.4 : s.door === 'right' ? Ws / 2 - doorW / 2 - 0.4 : 0;
    // bulkhead + display glass (shop art), split around the door
    const segs: [number, number][] = [];
    const dl = doorX - doorW / 2 - 0.08,
      dr = doorX + doorW / 2 + 0.08;
    if (dl - -Ws / 2 > 0.4) segs.push([-Ws / 2, dl]);
    if (Ws / 2 - dr > 0.4) segs.push([dr, Ws / 2]);
    const gy0 = 0.6,
      gy1 = 3.0;
    for (const [a, b] of segs) {
      const w = b - a,
        mx = (a + b) / 2;
      addBox(w, gy0, 0.12, mx, gy0 / 2, 0.06, shade(accent, 1.0));
      if (s.shopArt) {
        // window art keeps its aspect (unstretched text); any leftover width is plain glass behind it
        const [qw, qh] = fitRect(s.shopArt, w - 0.1, gy1 - gy0 - 0.05);
        add(new THREE.PlaneGeometry(w - 0.1, gy1 - gy0), glass, T(mx, (gy0 + gy1) / 2, 0.018), undefined, false);
        const q = atlas.quad(s.shopArt, qw, qh);
        add(q, s.shopArt.page.glowMat, T(mx, (gy0 + gy1) / 2, 0.03), undefined, false);
      } else add(new THREE.PlaneGeometry(w - 0.1, gy1 - gy0), glass, T(mx, (gy0 + gy1) / 2, 0.03), undefined, false);
      // mullions + frame (no inner mullions across window art: they'd cut through its lettering)
      addBox(w, 0.08, 0.1, mx, gy1 + 0.04, 0.06, accent);
      const nm = s.shopArt ? 1 : Math.max(1, Math.round(w / 1.6));
      for (let k = 1; k < nm; k++) addBox(0.07, gy1 - gy0, 0.08, a + (w * k) / nm, (gy0 + gy1) / 2, 0.06, accent);
      // transom
      add(new THREE.PlaneGeometry(w - 0.1, 0.42), glass, T(mx, gy1 + 0.33, 0.025), undefined, false);
    }
    // door
    addBox(doorW + 0.2, 2.55, 0.1, doorX, 1.275, 0.03, accent);
    addBox(doorW - 0.1, 2.35, 0.06, doorX, 1.2, 0.07, shade(accent, 1.35));
    add(new THREE.PlaneGeometry(doorW - 0.4, 1.2), glass, T(doorX, 1.65, 0.105), undefined, false);
    addBox(0.06, 0.25, 0.06, doorX + doorW / 2 - 0.2, 1.1, 0.13, '#d8b04a');
    add(new THREE.PlaneGeometry(doorW + 0.1, 0.42), glass, T(doorX, gy1 + 0.33, 0.025), undefined, false);
    // step
    addBox(doorW + 0.4, 0.2, 0.35, doorX, 0.1, 0.18, '#b9b3a8');
    // sign band
    if (s.sign) {
      const aspect = s.sign.w / s.sign.h;
      const sw = Math.min(s.signW ?? Ws - 0.6, Ws - 0.2, 1.0 * aspect);
      const sh = sw / aspect;
      const sy = gy1 + 0.55 + (gH - 0.2 - (gy1 + 0.55)) / 2;
      addBox(sw + 0.16, sh + 0.16, 0.08, 0, sy, 0.05, shade(accent, 0.8));
      add(atlas.quad(s.sign, sw, sh), s.signGlow ? s.sign.page.glowMat : s.sign.page.mat, T(0, sy, 0.095), undefined, false);
    }
    // awning
    if (s.awning) {
      const aw = Ws - 0.2;
      const depth = 1.55,
        drop = 0.75,
        top = gy1 + 0.18;
      const len = Math.hypot(depth, drop);
      const ang = Math.atan2(drop, depth);
      const g = applyStripeRow(bx(aw, 0.035, len), s.awning[0], s.awning[1], aw / 2.4);
      const mat = stripeMaterial();
      add(g, mat, TR(0, top - drop / 2, depth / 2 + 0.02, ang, 0, 0), '#ffffff');
      const val = applyStripeRow(bx(aw, 0.3, 0.03), s.awning[0], s.awning[1], aw / 2.4);
      add(val, mat, T(0, top - drop - 0.15, depth + 0.02), '#e6e6e6');
      // bouncy collider on the outer half only, so climbing the facade isn't blocked
      const outer = lp(0, top - drop * 0.78, depth * 0.78);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, yaw, 0, 'YXZ'));
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      const ac = boxColliderEuler(game, outer, new THREE.Vector3(aw, 0.08, len * 0.45), e.x, e.y, e.z, 0.6);
      ac.setRestitution(0.85);
      ac.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    }
  } else {
    // plain ground floor: windows + central door
    const n = Math.max(1, Math.floor((W - 1.4) / 2.4));
    for (let k = 0; k < n; k++) {
      const x = -W / 2 + 0.7 + ((W - 1.4) * (k + 0.5)) / n;
      if (Math.abs(x) < 1.0 && n > 2) continue;
      windowAt(add, addBox, win, rng, x, 1.1 + 0.95, trimC, s.litChance ?? 0.4);
    }
    addBox(1.3, 2.4, 0.12, 0, 1.2, 0.05, accent);
    add(new THREE.PlaneGeometry(0.8, 1.0), glass, T(0, 1.7, 0.115), undefined, false);
  }

  // ---------------------------------------------------------------- upper floors
  const winW = 1.15;
  const nWin = Math.max(1, Math.floor((W - 1.2) / 2.35));
  for (let f = 1; f < s.floors; f++) {
    const y0 = gH + (f - 1) * fH;
    const cyW = y0 + fH * 0.5;
    for (let k = 0; k < nWin; k++) {
      const x = -W / 2 + 0.6 + ((W - 1.2) * (k + 0.5)) / nWin;
      windowAt(add, addBox, win, rng, x, cyW, trimC, s.litChance ?? 0.45);
      if (s.flowerBoxes && f === 1 && rng.chance(0.7)) flowerBox(add, rng, x, cyW - 1.1);
    }
    // belt course
    if (f < s.floors - 1) addBox(W, 0.12, 0.12, 0, y0 + fH - 0.02, 0.06, shade(trimC, 0.9));
  }

  // ---------------------------------------------------------------- cornice + parapet
  addBox(W + 0.5, 0.42, 0.55, 0, H - 0.05, 0.22, trimC);
  addBox(W + 0.62, 0.12, 0.66, 0, H + 0.2, 0.28, shade(trimC, 1.05));
  const nb = Math.floor(W / 1.2);
  for (let k = 0; k <= nb; k++) addBox(0.16, 0.34, 0.4, -W / 2 + (W * k) / nb, H - 0.42, 0.16, shade(trimC, 0.85));
  const pH = 0.95;
  // parapet: front (brick), sides/back
  batch.add(bx(W, pH, 0.34), wallMat, { matrix: M.clone().multiply(T(0, H + pH / 2, -0.17)), uv: 2.3, color: s.wall });
  batch.add(bx(0.3, 0.7, D - 0.34), wallMat, { matrix: M.clone().multiply(T(-W / 2 + 0.15, H + 0.35, -D / 2 - 0.17)), uv: 2.3, color: s.wall });
  batch.add(bx(0.3, 0.7, D - 0.34), wallMat, { matrix: M.clone().multiply(T(W / 2 - 0.15, H + 0.35, -D / 2 - 0.17)), uv: 2.3, color: s.wall });
  batch.add(bx(W, 0.7, 0.3), wallMat, { matrix: M.clone().multiply(T(0, H + 0.35, -D + 0.15)), uv: 2.3, color: s.wall });
  addBox(W + 0.08, 0.1, 0.44, 0, H + pH + 0.05, -0.17, shade(trimC, 0.95));
  // floor pass: the collider includes the 10 cm coping (0.44 deep) you walk along the parapet on
  world.collider(lp(0, H + (pH + 0.1) / 2, -0.17), new THREE.Vector3(W + 0.08, pH + 0.1, 0.44), yaw);
  world.collider(lp(-W / 2 + 0.15, H + 0.35, -D / 2 - 0.17), new THREE.Vector3(0.3, 0.7, D - 0.34), yaw);
  world.collider(lp(W / 2 - 0.15, H + 0.35, -D / 2 - 0.17), new THREE.Vector3(0.3, 0.7, D - 0.34), yaw);
  world.collider(lp(0, H + 0.35, -D + 0.15), new THREE.Vector3(W, 0.7, 0.3), yaw);
  if (s.parapet === 'stepped') {
    const sw = Math.min(W * 0.45, 5);
    batch.add(bx(sw, 0.8, 0.34), wallMat, { matrix: M.clone().multiply(T(0, H + pH + 0.4, -0.17)), uv: 2.3, color: s.wall });
    addBox(sw + 0.1, 0.1, 0.44, 0, H + pH + 0.85, -0.17, shade(trimC, 0.95));
    world.collider(lp(0, H + pH + 0.45, -0.17), new THREE.Vector3(sw + 0.1, 0.9, 0.44), yaw);
    // year plaques sit clear of the coping / cornice boxes that project in front of them (they covered the digits' bottoms)
    if (s.yearRect) add(atlas.quad(s.yearRect, ...fitRect(s.yearRect, sw * 0.8, 0.5)), s.yearRect.page.mat, T(0, H + pH + 0.47, 0.005), undefined, false);
  } else if (s.yearRect) add(atlas.quad(s.yearRect, ...fitRect(s.yearRect, Math.min(W * 0.5, 3.2), 0.45)), s.yearRect.page.mat, T(0, H + 0.61, 0.005), undefined, false);

  // ---------------------------------------------------------------- roof clutter
  const nRoof = s.roofStuff ?? rng.int(1, 3);
  for (let k = 0; k < nRoof; k++) {
    const rx = rng.range(-W / 2 + 1.6, W / 2 - 1.6);
    const rz = -rng.range(2.2, D - 2.2);
    const kind = rng.int(0, 3);
    if (kind <= 1) {
      addBox(1.3, 0.95, 1.1, rx, H + 0.5, rz, '#aeb4ba');
      add(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 14), trim, T(rx, H + 0.99, rz), '#3f454b');
      world.collider(lp(rx, H + 0.5, rz), new THREE.Vector3(1.3, 0.95, 1.1), yaw);
    } else if (kind === 2) {
      add(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 10), trim, T(rx, H + 0.7, rz), '#8d949b');
      add(new THREE.CylinderGeometry(0.28, 0.2, 0.25, 10), trim, T(rx, H + 1.45, rz), '#6d747b');
    } else {
      addBox(1.6, 0.35, 1.6, rx, H + 0.2, rz, '#e7e2d8');
      add(new THREE.ConeGeometry(1.1, 0.6, 4, 1), glass, T(rx, H + 0.65, rz, Math.PI / 4));
      world.collider(lp(rx, H + 0.3, rz), new THREE.Vector3(1.6, 0.6, 1.6), yaw);
    }
  }

  // ---------------------------------------------------------------- back side (alley)
  if (s.back !== false) {
    const bz = -D;
    // back door with a little lamp
    const bdx = s.backDoorX ?? rng.range(-W / 2 + 1.5, W / 2 - 1.5);
    addBox(1.1, 2.2, 0.08, bdx, 1.1, bz - 0.04, '#5d6d73');
    addBox(0.3, 0.15, 0.2, bdx, 2.55, bz - 0.1, '#333');
    add(new THREE.SphereGeometry(0.1, 8, 6), warmGlowMat(game), T(bdx, 2.45, bz - 0.14), undefined, false);
    // a few back windows
    for (let f = 1; f < s.floors; f++) {
      const y = gH + (f - 1) * fH + fH * 0.5;
      for (const x of [-W / 4, W / 4]) {
        const q = new THREE.PlaneGeometry(winW, 1.8);
        add(q, rng.chance(s.litChance ?? 0.35) ? win.lit : win.dark, T(x, y, bz - 0.02, Math.PI), undefined, false);
        addBox(winW + 0.2, 0.1, 0.16, x, y - 0.95, bz - 0.08, trimC);
      }
    }
    // drainpipe on one back corner
    const px = (rng.chance(0.5) ? -1 : 1) * (W / 2 - 0.35);
    add(new THREE.CylinderGeometry(0.08, 0.08, H + 0.4, 8), trim, T(px, (H + 0.4) / 2, bz - 0.12), '#7a8288');
    add(new THREE.BoxGeometry(0.28, 0.18, 0.3), trim, T(px, H + 0.35, bz - 0.12), '#7a8288');
    world.collider(lp(px, (H + 0.4) / 2, bz - 0.12), new THREE.Vector3(0.2, H + 0.4, 0.2), yaw);
    if (s.fireEscape && s.floors >= 3) fireEscape(kit, add, addBox, lp, yaw, -px * 0.35, bz, gH, fH, s.floors);
  }

  const doorWorld = lp(s.door === 'left' ? -Ws / 2 + 1.0 : s.door === 'right' ? Ws / 2 - 1.0 : 0, 0.2, 0.6);
  return { spec: s, height: H + base, frame: M, yaw, width: W, door: doorWorld, roofCenter: lp(0, H + 0.1, -D / 2) };
}

function glowMat(game: Game) {
  return cached('mat:backLamp', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffc46b, emissiveIntensity: 0, roughness: 0.4 });
    glowAtNight(game, m, 0.1, 3.4);
    return m;
  });
}

type AddFn = (geo: THREE.BufferGeometry, mat: THREE.Material, local: THREE.Matrix4, color?: string | number, shadow?: boolean) => THREE.BufferGeometry;
type AddBoxFn = (w: number, h: number, d: number, x: number, y: number, z: number, color: string | number, mat?: THREE.Material, shadow?: boolean) => THREE.BufferGeometry;

function windowAt(add: AddFn, addBox: AddBoxFn, win: { dark: THREE.Material; lit: THREE.Material }, rng: Rng, x: number, cy: number, trimC: string, litChance: number) {
  const w = 1.15,
    h = 1.95;
  add(new THREE.PlaneGeometry(w, h), rng.chance(litChance) ? win.lit : win.dark, T(x, cy, 0.025), undefined, false);
  addBox(w + 0.26, 0.12, 0.2, x, cy - h / 2 - 0.05, 0.1, trimC);
  addBox(w + 0.34, 0.22, 0.12, x, cy + h / 2 + 0.1, 0.06, trimC);
  addBox(w + 0.12, 0.06, 0.05, x, cy + h / 2 + 0.24, 0.03, shade(trimC, 0.85));
}

function flowerBox(add: AddFn, rng: Rng, x: number, y: number) {
  const trim = trimMat();
  add(new THREE.BoxGeometry(1.15, 0.26, 0.3), trim, T(x, y, 0.2), '#6b4a2e');
  const colors = ['#ff5d8f', '#ffd23f', '#ff8c42', '#ffffff', '#b36bff', '#ff3b3b'];
  const parts = [];
  for (let i = 0; i < 6; i++) {
    parts.push({ geo: new THREE.IcosahedronGeometry(0.13, 0), color: i % 2 ? '#4f9a3c' : rng.pick(colors), matrix: T(x - 0.45 + i * 0.18, y + 0.2 + rng.range(0, 0.06), 0.2 + rng.range(-0.05, 0.05)) });
  }
  add(mergeColored(parts), trim, new THREE.Matrix4());
}

function fireEscape(
  kit: BuildingKit,
  add: AddFn,
  addBox: AddBoxFn,
  lp: (x: number, y: number, z: number) => THREE.Vector3,
  yaw: number,
  x: number,
  bz: number,
  gH: number,
  fH: number,
  floors: number,
) {
  const c = '#2d3035';
  const col = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) =>
    kit.world.collider(lp(cx, cy, cz), new THREE.Vector3(sx, sy, sz), yaw);
  for (let f = 1; f < floors; f++) {
    const y = gH + (f - 1) * fH;
    const lx = x + (f % 2 ? 1.05 : -1.05);
    addBox(3.2, 0.07, 1.2, x, y + 0.03, bz - 0.62, c);
    addBox(3.2, 0.05, 0.05, x, y + 1.0, bz - 1.2, c);
    addBox(0.05, 1.0, 0.05, x - 1.6, y + 0.5, bz - 1.2, c);
    addBox(0.05, 1.0, 0.05, x + 1.6, y + 0.5, bz - 1.2, c);
    addBox(0.05, 0.05, 1.2, x - 1.6, y + 1.0, bz - 0.62, c);
    addBox(0.05, 0.05, 1.2, x + 1.6, y + 1.0, bz - 0.62, c);
    // platform collider with a hatch gap where the ladder comes up
    const g0 = lx - 0.5,
      g1 = lx + 0.5;
    if (g0 - (x - 1.6) > 0.1) col((x - 1.6 + g0) / 2, y + 0.03, bz - 0.62, g0 - (x - 1.6), 0.1, 1.2);
    if (x + 1.6 - g1 > 0.1) col((g1 + x + 1.6) / 2, y + 0.03, bz - 0.62, x + 1.6 - g1, 0.1, 1.2);
    // ladder up to this level (the bottom one hangs 1.9 m above the alley)
    const y0 = f === 1 ? 1.9 : y - fH + 0.1;
    const len = y + 0.05 - y0;
    addBox(0.04, len, 0.04, lx - 0.24, y0 + len / 2, bz - 1.05, c);
    addBox(0.04, len, 0.04, lx + 0.24, y0 + len / 2, bz - 1.05, c);
    for (let r = 0.2; r < len; r += 0.3) addBox(0.48, 0.03, 0.03, lx, y0 + r, bz - 1.05, c);
    col(lx, y0 + len / 2, bz - 1.02, 0.56, len, 0.1);
  }
}

/** Multiply a geometry's UVs (for tiling stripe textures without cloning them). */
export function scaleUV(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}
