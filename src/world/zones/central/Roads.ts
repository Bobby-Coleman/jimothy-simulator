import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World, ZoneBuilder } from '../../World';
import { terrainHeight } from '../../terrain';
import { Batch, mergeColored, T, TR } from './lib/batch';
import {
  ROAD,
  roadMaterials,
  SurfaceBuilder,
  gridRun,
  makeGrid,
  bulb,
  Paint,
  outAndBackLane,
  rightSign,
  toWorld,
  walkY,
  type CellKind,
  type StreetFrame,
} from './lib/roadkit';
import {
  avenueLamp,
  bench,
  furnMat,
  hydrant,
  lightPools,
  newsBox,
  placeInstances, placeBatched,
  planter,
  streetTree,
  treeGrate,
  bollard,
  type Xf,
} from './lib/furniture';
import { spawnTrashCan } from './lib/props';
import { loadFonts, sharedAtlas } from './lib/signs';
import { AD_COUNT, busStopSign, drawAd, streetBlade } from './lib/art';
import { cached } from './lib/textures';
import { onFrame, Rng } from './lib/util';

/**
 * The central road grid: the four main avenues (x = ±60, z = ±60) across the whole map, with sidewalks, curbs,
 * crosswalks, street furniture, traffic lights and vehicle lanes. Roads in the northern hills follow the terrain.
 */

export interface AvenueDef {
  name: string;
  f: StreetFrame;
  s0: number;
  s1: number;
  /** Crossing avenue positions along s. */
  crosses: number[];
  /** The E-W avenues own the intersection squares; N-S avenues skip them. */
  ownsCrossings: boolean;
  /** T-junction cut in one sidewalk (Old Ballard Ave meets the avenue). */
  tee?: { s: number; side: 1 | -1; half: number };
}

/** Old Ballard Ave cross-section (used by OldBallard.ts and for the T-junction cuts). */
export const BALLARD = { z: 0, half: 5.6, curbW: 0.25, outer: 9.0, lane: 1.6, x0: -54, x1: 54 };

export const AVENUES: AvenueDef[] = [
  { name: 'NW Market St', f: { axis: 'x', c: -60 }, s0: -174, s1: 174, crosses: [-60, 60], ownsCrossings: true },
  { name: 'Leery Way NW', f: { axis: 'x', c: 60 }, s0: -174, s1: 174, crosses: [-60, 60], ownsCrossings: true },
  { name: '24th Ave NW', f: { axis: 'z', c: -60 }, s0: -170, s1: 158, crosses: [-60, 60], ownsCrossings: false, tee: { s: 0, side: 1, half: BALLARD.half } },
  { name: '15th Ave NW', f: { axis: 'z', c: 60 }, s0: -170, s1: 158, crosses: [-60, 60], ownsCrossings: false, tee: { s: 0, side: -1, half: BALLARD.half } },
];

const D_GRID = [-6, -5, -4, -3.75, -2.5, -1.25, 0, 1.25, 2.5, 3.75, 4, 5, 6];
const BULB = { rA: 5.2, rC: 5.45, rO: 6.0 };

/** Traffic signal phase for traffic travelling along `axis` ('x' = E-W avenues). 30 s cycle. */
export function signalState(axis: 'x' | 'z', t: number): 'green' | 'yellow' | 'red' {
  const p = ((t % 30) + 30) % 30;
  if (axis === 'x') return p < 12 ? 'green' : p < 15 ? 'yellow' : 'red';
  return p >= 15 && p < 27 ? 'green' : p >= 27 ? 'yellow' : 'red';
}

function classifier(av: AvenueDef) {
  return (s: number, d: number): CellKind | null => {
    const ad = Math.abs(d);
    for (const c of av.crosses) {
      const as = Math.abs(s - c);
      if (as < ROAD.outer) {
        if (!av.ownsCrossings) return null;
        if (ad <= ROAD.half || as <= ROAD.half) return 'asphalt';
        if (ad <= ROAD.half + ROAD.curbW || as <= ROAD.half + ROAD.curbW) return 'curb';
        return 'walk';
      }
    }
    if (ad <= ROAD.half) return 'asphalt';
    const t = av.tee;
    if (t && Math.sign(d) === t.side) {
      const as = Math.abs(s - t.s);
      if (as <= t.half) return 'asphalt';
      if (as <= t.half + ROAD.curbW) return 'curb';
    }
    if (ad <= ROAD.half + ROAD.curbW) return 'curb';
    return 'walk';
  };
}

/** True if a sidewalk spot at (s, side) is free of intersections, tee mouths and the ends. */
function sidewalkFree(av: AvenueDef, s: number, side: number, margin = 11) {
  if (s < av.s0 + 7 || s > av.s1 - 7) return false;
  for (const c of av.crosses) if (Math.abs(s - c) < margin) return false;
  if (av.tee && av.tee.side === side && Math.abs(s - av.tee.s) < av.tee.half + 6) return false;
  return true;
}

/** Yaw that turns a template's +Z toward direction (dx, dz). */
const yawTo = (dx: number, dz: number) => Math.atan2(dx, dz);

export const CentralRoads: ZoneBuilder = {
  name: 'Central Roads',
  async build(game: Game, world: World) {
    await loadFonts();
    const mats = await roadMaterials(game);
    const batch = new Batch('roads', 100000); // one chunk: the grid spans the whole map and is visible from everywhere
    const atlas = sharedAtlas(game);
    const paint = new Paint();
    const rng = new Rng(20260713);

    // ---------------------------------------------------------------- surfaces
    for (const av of AVENUES) {
      const breaks: number[] = [];
      for (const c of av.crosses) breaks.push(c - 6, c - 4, c - 3.75, c + 3.75, c + 4, c + 6);
      if (av.tee) {
        const t = av.tee;
        breaks.push(t.s - t.half - ROAD.curbW, t.s - t.half, t.s + t.half, t.s + t.half + ROAD.curbW);
      }
      const sGrid = makeGrid(av.s0, av.s1, 2, breaks);
      const sb = new SurfaceBuilder();
      gridRun(sb, av.f, sGrid, D_GRID, classifier(av));
      bulb(sb, av.f, av.s1, 1, BULB.rA, BULB.rC, BULB.rO, ROAD.half);
      bulb(sb, av.f, av.s0, -1, BULB.rA, BULB.rC, BULB.rO, ROAD.half);
      sb.finish(game, batch, mats);
    }

    // ---------------------------------------------------------------- markings
    const YEL = 0xf2c230;
    const WHT = 0xf4f4ef;
    for (const av of AVENUES) {
      const f = av.f;
      const rs = rightSign(f);
      // pieces between features
      const cuts = [av.s0 + 1.5, ...av.crosses.flatMap((c) => [c - 10.4, c + 10.4]), av.s1 - 1.5].sort((a, b) => a - b);
      for (let i = 0; i < cuts.length; i += 2) {
        const a = cuts[i],
          b = cuts[i + 1];
        if (b - a < 1) continue;
        paint.strip(f, a, b, -0.2, -0.08, YEL);
        paint.strip(f, a, b, 0.08, 0.2, YEL);
        // edge lines, broken at the tee mouth
        for (const side of [-1, 1]) {
          const d0 = side * 3.35,
            d1 = side * 3.47;
          const t = av.tee;
          if (t && t.side === side && t.s > a && t.s < b) {
            paint.strip(f, a, t.s - t.half - 1.5, d0, d1, WHT);
            paint.strip(f, t.s + t.half + 1.5, b, d0, d1, WHT);
          } else paint.strip(f, a, b, d0, d1, WHT);
        }
      }
      for (const c of av.crosses) {
        // zebras on both approaches, stop lines on the right-hand lanes
        paint.zebra(f, c - 9.6, c - 6.6, 3.5);
        paint.zebra(f, c + 6.6, c + 9.6, 3.5);
        paint.strip(f, c - 10.4, c - 10.0, rs * 0.25, rs * 3.5, WHT, 4);
        paint.strip(f, c + 10.0, c + 10.4, -rs * 0.25, -rs * 3.5, WHT, 4);
      }
      if (av.tee) {
        const t = av.tee;
        paint.zebra(f, t.s - t.half - 3.6, t.s - t.half - 0.6, 3.5);
        paint.zebra(f, t.s + t.half + 0.6, t.s + t.half + 3.6, 3.5);
      }
    }
    paint.finish(batch, mats.marking);

    // ---------------------------------------------------------------- street furniture
    const lampXf: Xf[] = [];
    const pools: { x: number; y: number; z: number; r: number }[] = [];
    const hydrantXf: Xf[] = [];
    const benchXf: Xf[] = [];
    const newsXf: Xf[] = [];
    const planterXf: Xf[] = [];
    const treeXf: Xf[][] = [[], [], [], []];
    const grateXf: Xf[] = [];
    const bollardXf: Xf[] = [];
    const trash: { p: THREE.Vector3; ry: number }[] = [];
    const busStops: { av: AvenueDef; s: number; side: 1 | -1 }[] = [];
    const newsColors = [0xd8412f, 0x2c6fbb, 0xf2c230, 0x2f9e5b, 0xf4f4f4];

    for (const av of AVENUES) {
      const f = av.f;
      const L = f.axis === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 };
      const S = f.axis === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
      for (const side of [-1, 1] as const) {
        const occupied: number[] = [];
        const at = (s: number, d: number) => {
          const [x, z] = toWorld(f, s, side * d);
          return { x, z, y: walkY(x, z) };
        };
        const faceRoad = yawTo(-side * L.x, -side * L.z);
        const alongYaw = yawTo(S.x, S.z);
        const free = (s: number, r: number) => occupied.every((o) => Math.abs(o - s) > r);
        // lamps
        for (let s = av.s0 + 10 + (side > 0 ? 13 : 0); s < av.s1 - 8; s += 26) {
          if (!sidewalkFree(av, s, side, 10)) continue;
          const p = at(s, 4.35);
          lampXf.push({ ...p, ry: faceRoad });
          const [lx, lz] = toWorld(f, s, side * (4.35 - 2.35));
          pools.push({ x: lx, y: terrainHeight(lx, lz) + ROAD.lift, z: lz, r: 4.2 });
          occupied.push(s);
        }
        // bus stops (two per avenue side)
        const stopS = side > 0 ? [-118, 24] : [-24, 118];
        for (const s of stopS) {
          if (s < av.s0 + 12 || s > av.s1 - 12 || !sidewalkFree(av, s, side, 14) || !free(s, 3.5)) continue;
          busStops.push({ av, s, side });
          occupied.push(s - 1.5, s, s + 1.5);
        }
        // trash cans
        for (let s = av.s0 + 22 + (side > 0 ? 30 : 0); s < av.s1 - 10; s += 80) {
          if (!sidewalkFree(av, s, side) || !free(s, 2)) continue;
          const p = at(s, 4.75);
          trash.push({ p: new THREE.Vector3(p.x, p.y, p.z), ry: rng.range(0, 6.28) });
          occupied.push(s);
        }
        // hydrants
        for (let s = av.s0 + 35 + (side > 0 ? 30 : 0); s < av.s1 - 10; s += 74) {
          if (!sidewalkFree(av, s, side) || !free(s, 2)) continue;
          hydrantXf.push({ ...at(s, 4.3), ry: faceRoad });
          occupied.push(s);
        }
        // benches
        for (let s = av.s0 + 48 + (side > 0 ? 20 : 0); s < av.s1 - 10; s += 68) {
          if (!sidewalkFree(av, s, side) || !free(s, 2.2)) continue;
          benchXf.push({ ...at(s, 5.45), ry: faceRoad });
          occupied.push(s);
        }
        // planters
        for (let s = av.s0 + 60 + (side > 0 ? 5 : 30); s < av.s1 - 10; s += 64) {
          if (!sidewalkFree(av, s, side) || !free(s, 2.2)) continue;
          planterXf.push({ ...at(s, 5.3), ry: alongYaw });
          occupied.push(s);
        }
        // newspaper boxes near intersections
        for (const c of av.crosses) {
          for (const dir of [-1, 1]) {
            const s0 = c + dir * 13.5;
            if (!sidewalkFree(av, s0, side, 12) || !free(s0, 2.5)) continue;
            for (let k = 0; k < 3; k++) {
              if (rng.chance(0.2)) continue;
              newsXf.push({ ...at(s0 + (k - 1) * 0.62, 5.55), ry: faceRoad, color: rng.pick(newsColors) });
            }
            occupied.push(s0);
          }
        }
        // street trees
        for (let s = av.s0 + 16 + (side > 0 ? 6 : 17); s < av.s1 - 8; s += 23) {
          if (!sidewalkFree(av, s, side, 12) || !free(s, 3.2)) continue;
          const p = at(s, 5.2);
          treeXf[rng.int(0, 2)].push({ ...p, ry: rng.range(0, 6.28), s: rng.range(0.9, 1.12) });
          grateXf.push({ ...p, ry: alongYaw });
          occupied.push(s);
        }
        // bollards at the dead ends
        for (const end of [av.s0, av.s1]) {
          const dir = end === av.s0 ? -1 : 1;
          for (let k = -2; k <= 2; k++) {
            const [x, z] = toWorld(f, end + dir * 5.75, side * 0 + k * 0.9);
            if (side < 0) bollardXf.push({ x, y: walkY(x, z), z, ry: 0 });
          }
        }
      }
    }

    placeBatched(world, batch, avenueLamp(game), lampXf, { collider: new THREE.Vector3(0.28, 8.2, 0.28), name: 'avenueLamps' });
    lightPools(game, world, pools, batch);
    placeBatched(world, batch, hydrant(), hydrantXf, { collider: new THREE.Vector3(0.4, 0.8, 0.4), name: 'hydrants' });
    placeBatched(world, batch, bench(), benchXf, { collider: new THREE.Vector3(1.8, 0.62, 0.55), name: 'benches' });
    placeBatched(world, batch, newsBox(), newsXf, { collider: new THREE.Vector3(0.52, 1.1, 0.46), name: 'newsBoxes' });
    placeBatched(world, batch, planter(1), planterXf, { collider: new THREE.Vector3(1.6, 0.62, 0.8), name: 'planters' });
    treeXf.forEach((xfs, i) => placeBatched(world, batch, streetTree(i), xfs, { collider: new THREE.Vector3(0.36, 3.0, 0.36), name: 'streetTrees' }));
    placeBatched(world, batch, treeGrate(), grateXf, { name: 'treeGrates' });
    placeBatched(world, batch, bollard(), bollardXf, { collider: new THREE.Vector3(0.22, 0.9, 0.22), name: 'bollards' });
    for (const t of trash) spawnTrashCan(game, t.p, t.ry);

    // ---------------------------------------------------------------- bus stops
    const glass = cached(
      'mat:busGlass',
      () => new THREE.MeshStandardMaterial({ color: 0xcfeaf5, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.2, depthWrite: false }),
    );
    const adRects = Array.from({ length: AD_COUNT }, (_, i) => atlas.draw(256, 384, (ctx, w, h) => drawAd(ctx, w, h, i)));
    const busSignRect = atlas.draw(192, 256, (ctx, w, h) => busStopSign(ctx, w, h, 'Route 15 · Ballard'));
    busStops.forEach((b, i) => buildBusStop(game, world, batch, glass, b.av, b.s, b.side, adRects[i % adRects.length], busSignRect));

    // ---------------------------------------------------------------- traffic lights & street signs
    const signalMats = buildSignals(game, batch);
    const bladeRects = new Map<string, ReturnType<typeof atlas.draw>>();
    for (const av of AVENUES) bladeRects.set(av.name, atlas.draw(512, 96, (ctx, w, h) => streetBlade(ctx, w, h, av.name.toUpperCase())));
    for (const x of [-60, 60]) {
      for (const z of [-60, 60]) {
        addSignalsAt(world, batch, signalMats, x, z);
        const ns = AVENUES.find((a) => a.f.axis === 'z' && a.f.c === x)!;
        const ew = AVENUES.find((a) => a.f.axis === 'x' && a.f.c === z)!;
        addStreetSign(world, batch, x + 5.1, z + 5.1, bladeRects.get(ew.name)!, bladeRects.get(ns.name)!);
      }
    }
    // Old Ballard Ave blades at the T-junctions
    const ballardBlade = atlas.draw(512, 96, (ctx, w, h) => streetBlade(ctx, w, h, 'OLD BALLARD AVE NW'));
    const east = AVENUES[3],
      west = AVENUES[2];
    addStreetSign(world, batch, 55.0, -9.6, ballardBlade, bladeRects.get(east.name)!);
    addStreetSign(world, batch, -55.0, 9.6, ballardBlade, bladeRects.get(west.name)!);

    // ---------------------------------------------------------------- lanes (right-hand traffic)
    for (const av of AVENUES) {
      world.lanes.push({ points: outAndBackLane(av.f, av.s0, av.s1, ROAD.lane, 3.4, 0.5, 4), loop: true, speed: 12 });
    }

    // ---------------------------------------------------------------- NPC paths: joggers & walkers on the avenue sidewalks
    for (const av of AVENUES) {
      for (const side of [-1, 1]) {
        const pts: THREE.Vector3[] = [];
        for (let s = av.s0 + 8; s <= av.s1 - 8; s += 12) {
          const [x, z] = toWorld(av.f, s, side * 5.0);
          pts.push(new THREE.Vector3(x, walkY(x, z), z));
        }
        const mid = pts[Math.floor(pts.length / 2)];
        world.npcSpawns.push({ zone: 'Central Roads', center: mid.clone(), radius: 4, count: 2, types: ['jogger', 'pedestrian'], path: pts });
      }
    }

    batch.flush(world.staticRoot);
  },
};

// ------------------------------------------------------------------------------------------- bus stop

function buildBusStop(
  game: Game,
  world: World,
  batch: Batch,
  glass: THREE.Material,
  av: AvenueDef,
  s: number,
  side: 1 | -1,
  ad: ReturnType<ReturnType<typeof sharedAtlas>['draw']>,
  sign: ReturnType<ReturnType<typeof sharedAtlas>['draw']>,
) {
  const f = av.f;
  const atlas = sharedAtlas(game);
  const [x, z] = toWorld(f, s, side * 5.25);
  const y = walkY(x, z);
  const L = f.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  // local +Z faces the road
  const ry = yawTo(-side * L.x, -side * L.z);
  const M = T(x, y, z, ry);
  const metal = 0x2d3a45;
  const fm = furnMat();
  const frame = mergeColored([
    { geo: new THREE.BoxGeometry(3.4, 0.12, 1.55), color: metal, matrix: T(0, 2.45, -0.05) },
    { geo: new THREE.BoxGeometry(3.3, 0.05, 1.45), color: 0x8fb8c9, matrix: T(0, 2.52, -0.05) },
    ...[-1.6, 1.6].flatMap((px) => [
      { geo: new THREE.BoxGeometry(0.08, 2.45, 0.08), color: metal, matrix: T(px, 1.225, -0.7) },
      { geo: new THREE.BoxGeometry(0.08, 2.45, 0.08), color: metal, matrix: T(px, 1.225, 0.6) },
    ]),
    { geo: new THREE.BoxGeometry(2.6, 0.06, 0.42), color: 0xb97a41, matrix: T(0, 0.48, -0.4) },
    { geo: new THREE.BoxGeometry(0.08, 0.46, 0.3), color: metal, matrix: T(-1.1, 0.23, -0.4) },
    { geo: new THREE.BoxGeometry(0.08, 0.46, 0.3), color: metal, matrix: T(1.1, 0.23, -0.4) },
    // ad frame
    { geo: new THREE.BoxGeometry(0.12, 2.0, 1.25), color: metal, matrix: T(1.6, 1.15, -0.05) },
  ]);
  batch.add(frame, fm, { matrix: M });
  const panes = mergeColored([
    { geo: new THREE.BoxGeometry(3.2, 2.1, 0.03), color: 0xffffff, matrix: T(0, 1.2, -0.7) },
    { geo: new THREE.BoxGeometry(0.03, 2.1, 1.2), color: 0xffffff, matrix: T(-1.6, 1.2, -0.05) },
  ]);
  batch.add(panes, glass, { matrix: M, castShadow: false });
  // ad on the outer side panel, both faces
  const q1 = atlas.quad(ad, 1.1, 1.65);
  batch.add(q1, ad.page.glowMat, { matrix: M.clone().multiply(TR(1.67, 1.15, -0.05, 0, Math.PI / 2, 0)) });
  batch.add(q1, ad.page.glowMat, { matrix: M.clone().multiply(TR(1.53, 1.15, -0.05, 0, -Math.PI / 2, 0)) });
  // bus stop sign pole
  const pole = mergeColored([{ geo: new THREE.CylinderGeometry(0.045, 0.05, 2.9, 8), color: 0x6c747d, matrix: T(-2.2, 1.45, 0.75) }]);
  batch.add(pole, fm, { matrix: M });
  const sq = atlas.slab(sign, 0.55, 0.72, 0.03);
  batch.add(sq, sign.page.mat, { matrix: M.clone().multiply(TR(-2.2, 2.55, 0.75, 0, Math.PI / 2, 0)) });
  // colliders: roof, back pane, side pane, ad panel, bench
  const col = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => {
    const p = new THREE.Vector3(lx, ly, lz).applyMatrix4(M);
    world.collider(p, new THREE.Vector3(sx, sy, sz), ry);
  };
  col(0, 2.45, -0.05, 3.4, 0.14, 1.55);
  col(0, 1.2, -0.7, 3.2, 2.2, 0.08);
  col(-1.6, 1.2, -0.05, 0.08, 2.2, 1.3);
  col(1.6, 1.15, -0.05, 0.14, 2.0, 1.25);
  col(0, 0.25, -0.4, 2.6, 0.5, 0.42);
  world.collider(new THREE.Vector3(0, 1.45, 0).applyMatrix4(T(x, y, z, ry).multiply(T(-2.2, 0, 0.75))), new THREE.Vector3(0.12, 2.9, 0.12), ry);
}

// ------------------------------------------------------------------------------------------- traffic signals

type SignalMats = Record<'x' | 'z', Record<'red' | 'yellow' | 'green', THREE.MeshStandardMaterial>>;

function buildSignals(game: Game, _batch: Batch): SignalMats {
  const make = (base: number, glow: number) =>
    new THREE.MeshStandardMaterial({ color: base, emissive: glow, emissiveIntensity: 0.05, roughness: 0.3 });
  const mats: SignalMats = {
    x: { red: make(0x5a1010, 0xff2a1a), yellow: make(0x5a4a10, 0xffb21a), green: make(0x0f4a22, 0x2aff7a) },
    z: { red: make(0x5a1010, 0xff2a1a), yellow: make(0x5a4a10, 0xffb21a), green: make(0x0f4a22, 0x2aff7a) },
  };
  onFrame(game, (g) => {
    for (const axis of ['x', 'z'] as const) {
      const st = signalState(axis, g.time);
      for (const c of ['red', 'yellow', 'green'] as const) mats[axis][c].emissiveIntensity = st === c ? 3.2 : 0.04;
    }
  });
  return mats;
}

/**
 * Four mast-arm signals at the intersection (x, z), one per approach, on the far-right corner.
 * Template frame: lamps face local +Z (toward approaching traffic), the arm reaches along local -X (over the lanes).
 */
function addSignalsAt(world: World, batch: Batch, mats: SignalMats, cx: number, cz: number) {
  const fm = furnMat();
  const approaches: { h: THREE.Vector3; axis: 'x' | 'z' }[] = [
    { h: new THREE.Vector3(1, 0, 0), axis: 'x' },
    { h: new THREE.Vector3(-1, 0, 0), axis: 'x' },
    { h: new THREE.Vector3(0, 0, 1), axis: 'z' },
    { h: new THREE.Vector3(0, 0, -1), axis: 'z' },
  ];
  const pole = cached('geo:signalPole', () =>
    mergeColored([
      { geo: new THREE.CylinderGeometry(0.2, 0.24, 0.5, 10), color: 0x3d434a, matrix: T(0, 0.25, 0) },
      { geo: new THREE.CylinderGeometry(0.11, 0.14, 6.2, 10), color: 0x56606a, matrix: T(0, 3.35, 0) },
      { geo: new THREE.BoxGeometry(4.4, 0.12, 0.12), color: 0x56606a, matrix: T(-2.2, 6.0, 0) },
      { geo: new THREE.BoxGeometry(2.0, 0.07, 0.07), color: 0x56606a, matrix: TR(-1.0, 5.55, 0, 0, 0, -0.42) },
      { geo: new THREE.BoxGeometry(0.42, 1.15, 0.32), color: 0xe8b923, matrix: T(-3.25, 5.3, 0) },
      { geo: new THREE.BoxGeometry(0.62, 1.35, 0.04), color: 0x1d1d1d, matrix: T(-3.25, 5.3, -0.18) },
      ...[0.36, 0, -0.36].map((dy) => ({ geo: new THREE.BoxGeometry(0.34, 0.05, 0.2), color: 0x1d1d1d, matrix: T(-3.25, 5.3 + dy + 0.15, 0.26) })),
      { geo: new THREE.BoxGeometry(0.14, 0.2, 0.1), color: 0xe8b923, matrix: T(0, 1.1, 0.13) },
    ]),
  );
  const lamp = (dy: number) => new THREE.CylinderGeometry(0.12, 0.12, 0.05, 14).rotateX(Math.PI / 2).translate(-3.25, 5.3 + dy, 0.17);
  const lampGeo = cached('geo:signalLamps', () => ({ red: lamp(0.36), yellow: lamp(0), green: lamp(-0.36) }));
  for (const ap of approaches) {
    const r = new THREE.Vector3(-ap.h.z, 0, ap.h.x); // right-hand side for heading h
    const px = cx + ap.h.x * 5.1 + r.x * 5.1;
    const pz = cz + ap.h.z * 5.1 + r.z * 5.1;
    const py = walkY(px, pz);
    const M = T(px, py, pz, Math.atan2(-ap.h.x, -ap.h.z));
    batch.add(pole, fm, { matrix: M, chunk: 'signals' });
    for (const c of ['red', 'yellow', 'green'] as const) batch.add(lampGeo[c], mats[ap.axis][c], { matrix: M, castShadow: false, chunk: 'signals' });
    world.collider(new THREE.Vector3(px, py + 3.2, pz), new THREE.Vector3(0.3, 6.4, 0.3));
  }
}

// street name sign: a pole with two perpendicular blades
function addStreetSign(
  world: World,
  batch: Batch,
  x: number,
  z: number,
  bladeA: ReturnType<ReturnType<typeof sharedAtlas>['draw']>,
  bladeB: ReturnType<ReturnType<typeof sharedAtlas>['draw']>,
) {
  const y = walkY(x, z);
  const fm = furnMat();
  batch.add(mergeColored([{ geo: new THREE.CylinderGeometry(0.05, 0.06, 3.4, 8), color: 0x56606a, matrix: T(0, 1.7, 0) }]), fm, { matrix: T(x, y, z) });
  const a = new THREE.BoxGeometry(1.6, 0.3, 0.03);
  const b = new THREE.BoxGeometry(1.6, 0.3, 0.03);
  mapBox(a, bladeA);
  mapBox(b, bladeB);
  batch.add(a, bladeA.page.mat, { matrix: T(x, y + 3.2, z, 0) });
  batch.add(b, bladeB.page.mat, { matrix: T(x, y + 3.52, z, Math.PI / 2) });
  world.collider(new THREE.Vector3(x, y + 1.7, z), new THREE.Vector3(0.12, 3.4, 0.12));
}

function mapBox(g: THREE.BufferGeometry, r: { u0: number; u1: number; v0: number; v1: number }) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(nor.getZ(i)) < 0.5) uv.setXY(i, r.u0 + 0.004, r.v0 + 0.02);
    else uv.setXY(i, r.u0 + (r.u1 - r.u0) * uv.getX(i), r.v0 + (r.v1 - r.v0) * uv.getY(i));
  }
}
