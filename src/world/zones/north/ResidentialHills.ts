/**
 * N — Residential Hills (Queen-Anne-ish), zone center (0, -120).
 *
 *  - Tumble St (x = 0): the long, steep, straight rolling street from the avenue (z≈-66) up to Hilltop Crescent.
 *  - Hilltop Crescent: winding street along the crest; Furry Park viewpoint (raised overlook + bench) above it.
 *  - Four rows of pastel Craftsman houses (two face Tumble St, two face the x=±60 avenues) + four view homes.
 *  - Public stairways ("stepped streets") at x = ±31 between back-to-back backyards.
 *  - Backyards: pools, trampolines, BBQs with propane tanks, gnomes, sprinklers, fences with cats.
 *  - Grandma Rosie's porch (grandmaPorch), Danny's perfect lawn (dannyLawn), radar speed sign.
 */
import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World, ZoneBuilder } from '../../World';
import type { WaterSystem } from '../../Water';
import {
  Batch,
  Frame,
  GEO,
  trs,
  northMaterials,
  loadFonts,
  canvasTexture,
  fitText,
  roundRect,
  signPanel,
  ribbon,
  curbWall,
  smoothPath,
  footprint,
  colliderBox,
  addAnimator,
  rng,
  pick,
  poi,
  refreshQueries,
  groundDecal,
  type MatSet,
} from './kit';
import { buildHouse, SIDING, ROOFS, type HouseInfo, type HouseStyle } from './house';
import { plantTrees, plantBackdrop } from './flora';
import { buildTrampoline } from './Trampolines';
import * as P from './props';

const ZONE = 'Residential Hills';

// ------------------------------------------------------------------ layout constants
const ROAD_HW = 4; // Tumble St half width
const WALK_IN = 4.9; // sidewalk inner edge
const WALK_OUT = 6.6; // sidewalk outer edge / lot line
const LOT_Z0 = -67;
const LOT_Z1 = -143.5;
const LOTS = 5;
const LOT_LEN = (LOT_Z0 - LOT_Z1) / LOTS;
const lotZ = (k: number) => LOT_Z0 - LOT_LEN * (k + 0.5);
const lotSouth = (k: number) => LOT_Z0 - LOT_LEN * k;
const lotNorth = (k: number) => LOT_Z0 - LOT_LEN * (k + 1);
const STAIR_X = 31; // public stairways at x = ±31 (corridor 29..33)
const D = 9.4; // house depth
const W = 8.4; // house width

/** Hilltop Crescent control points (x, z). */
const CRESCENT: [number, number][] = [
  [-54.5, -150.5],
  [-42, -153.5],
  [-24, -150.2],
  [-9, -151.2],
  [0, -151.2],
  [9, -151.2],
  [24, -152.6],
  [40, -149.6],
  [54.5, -151.5],
];

type Row = { face: number; frontX: number; dir: 1 | -1; backX: number; street: 'tumble' | 'avenue' };
const ROWS: Row[] = [
  { face: Math.PI / 2, frontX: -12, dir: 1, backX: -(STAIR_X - 2), street: 'tumble' }, // 0: west of Tumble, faces east
  { face: -Math.PI / 2, frontX: 12, dir: -1, backX: STAIR_X - 2, street: 'tumble' }, // 1: east of Tumble, faces west
  { face: -Math.PI / 2, frontX: -47.8, dir: -1, backX: -(STAIR_X + 2), street: 'avenue' }, // 2: faces the x=-60 avenue
  { face: Math.PI / 2, frontX: 47.8, dir: 1, backX: STAIR_X + 2, street: 'avenue' }, // 3: faces the x=+60 avenue
];

export const ResidentialHills: ZoneBuilder = {
  name: ZONE,
  async build(game: Game, world: World) {
    const [mats] = await Promise.all([northMaterials(game), loadFonts()]);
    const water = game.get<WaterSystem>('water')!;
    const b = new Batch(60);
    const r = rng(4242);
    const H = (x: number, z: number) => world.heightAt(x, z);

    world.areas.push({ name: ZONE, min: new THREE.Vector2(-60, -200), max: new THREE.Vector2(60, -60) });

    // ================================================================ streets
    const tumble = smoothPath([
      [0, -66.3],
      [0, -151.5],
    ]);
    b.add('asphalt2', ribbon(world, tumble, -ROAD_HW, ROAD_HW, 0.03, { tile: 7, across: 4 }), null, 0xffffff, { uvTile: 0 });
    const walkPts = tumble.filter((p) => p.y > -146.4 && p.y < -66.8);
    const curbPts = tumble.filter((p) => p.y > -147.2);
    for (const s of [-1, 1]) {
      b.add('sidewalk', ribbon(world, walkPts, s < 0 ? -WALK_OUT : WALK_IN, s < 0 ? -WALK_IN : WALK_OUT, 0.07, { tile: 2.6, across: 1 }), null, 0xe6e2da, { uvTile: 0 });
      b.add('concrete', curbWall(world, walkPts, s * WALK_IN, -0.05, 0.07, s < 0 ? 1 : -1), null, 0xcfcac0, { uvTile: 0 });
      b.add('concrete', curbWall(world, walkPts, s * WALK_OUT, -0.05, 0.07, s < 0 ? -1 : 1), null, 0xcfcac0, { uvTile: 0 });
      b.add('concrete', curbWall(world, curbPts, s * ROAD_HW, -0.02, 0.14, s < 0 ? 1 : -1), null, 0xd9d5cc, { uvTile: 0 });
      b.add('concrete', ribbon(world, curbPts, s < 0 ? -ROAD_HW - 0.18 : ROAD_HW, s < 0 ? -ROAD_HW : ROAD_HW + 0.18, 0.14, { tile: 2, across: 1 }), null, 0xd9d5cc, { uvTile: 0 });
    }
    roadText(world, 'ROLL', 0, -140);
    roadText(world, 'SLOW', 0, -76);
    b.add('marking', ribbon(world, [new THREE.Vector2(0, -67.4), new THREE.Vector2(0, -67.95)], -ROAD_HW + 0.35, 0, 0.045, { across: 2 }), null, 0xf4f4f0, { uvTile: 0 });

    const crescent = smoothPath(CRESCENT, 1.5);
    paved = [
      { pts: tumble, half: WALK_OUT },
      { pts: crescent, half: 6.0 },
    ];
    b.add('asphalt', ribbon(world, crescent, -3.6, 3.6, 0.03, { tile: 7, across: 3 }), null, 0xffffff, { uvTile: 0 });
    // The Crescent runs west→east: right-hand normal = +z (south). South sidewalk is split where Tumble St meets it.
    const crescentS = crescent.filter((p) => Math.abs(p.x) > WALK_OUT + 0.3);
    for (const part of splitRuns(crescentS, (a, c) => Math.abs(a.x - c.x) < 3)) {
      b.add('sidewalk', ribbon(world, part, 4.4, 6.0, 0.07, { tile: 2.6, across: 1 }), null, 0xe6e2da, { uvTile: 0 });
      b.add('concrete', curbWall(world, part, 3.6, -0.02, 0.14, -1), null, 0xd9d5cc, { uvTile: 0 });
    }
    b.add('sidewalk', ribbon(world, crescent, -6.0, -4.4, 0.07, { tile: 2.6, across: 1 }), null, 0xe6e2da, { uvTile: 0 });
    b.add('concrete', curbWall(world, crescent, -3.6, -0.02, 0.14, 1), null, 0xd9d5cc, { uvTile: 0 });
    const crescentZ = (x: number) => {
      let best = crescent[0];
      for (const p of crescent) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      return best.y;
    };
    // crosswalk across the Crescent at the top of Tumble St
    for (let i = -3; i <= 3; i++) {
      const x = i * 0.9;
      const z = crescentZ(x);
      b.add('marking', ribbon(world, [new THREE.Vector2(x, z + 3.2), new THREE.Vector2(x, z - 3.2)], -0.25, 0.25, 0.05, { across: 1 }), null, 0xf4f4f0, { uvTile: 0 });
    }

    // ================================================================ houses
    const houses: { info: HouseInfo; row: number; lot: number; backWall: number }[] = [];
    let colorIdx = 3;
    const nextColor = () => SIDING[colorIdx++ % SIDING.length];
    const styles: HouseStyle[] = ['gable', 'bungalow', 'foursquare'];
    const special = { danny: [0, 0], grandma: [1, 3], kit: [1, 2] };

    for (let ri = 0; ri < ROWS.length; ri++) {
      const row = ROWS[ri];
      for (let k = 0; k < LOTS; k++) {
        const isDanny = ri === special.danny[0] && k === special.danny[1];
        const isGrandma = ri === special.grandma[0] && k === special.grandma[1];
        const isKit = ri === special.kit[0] && k === special.kit[1];
        const setback = isDanny ? 5.8 : 0;
        const cx = row.frontX - row.dir * (D / 2 + setback);
        const cz = lotZ(k) + (r() - 0.5) * 1.2;
        const style: HouseStyle = isGrandma || isDanny ? 'bungalow' : styles[(ri * 2 + k) % 3];
        const hw = W + (r() - 0.5) * 0.8;
        const info = buildHouse(game, world, b, {
          x: cx,
          z: cz,
          face: row.face,
          w: hw,
          // Grandma's spot (see grandmasPorch): slot the porch-roof collider above it so NPC ground probes land on the floor
          porchRoofSlotX: isGrandma ? hw / 2 - 1.5 : undefined,
          d: D,
          style,
          siding: isGrandma ? 0xc9b2e6 : isDanny ? 0xa8e2c4 : nextColor(),
          roof: isGrandma ? 0x5b4a6e : pick(r, ROOFS),
          door: isGrandma ? 0xd8465f : undefined,
          seed: 100 + ri * 17 + k * 5,
          porchFrac: isGrandma ? 1 : undefined,
          openPorch: isKit ? (row.dir < 0 ? 1 : -1) : undefined,
          bay: isGrandma ? true : undefined,
          chimney: isGrandma ? true : undefined,
          litChance: isGrandma ? 0.85 : 0.45,
        });
        houses.push({ info, row: ri, lot: k, backWall: cx - (row.dir * D) / 2 });
        // front walk from the sidewalk (or the avenue edge) to the steps
        const sf = info.stepFoot;
        const wx0 = row.street === 'tumble' ? Math.sign(row.frontX) * WALK_OUT : Math.sign(row.frontX) * 53.4;
        b.add('concrete', ribbon(world, [new THREE.Vector2(wx0, sf.z), new THREE.Vector2(sf.x + row.dir * 0.15, sf.z)], -0.65, 0.65, 0.06, { tile: 2.2, across: 1 }), null, 0xd6d1c7, {
          uvTile: 0,
        });
        // mailbox by the walk (not every house has one)
        if (r() < 0.6 || isDanny || isGrandma) {
          const mbx = row.street === 'tumble' ? Math.sign(row.frontX) * (WALK_OUT + 0.45) : Math.sign(row.frontX) * 52.6;
          P.spawnOnGround(game, P.mailbox(mats, pick(r, [0x2d4a7a, 0x222222, 0x8b2f2f, 0x2f6b4a])), mbx, sf.z + 1.1, row.face);
        }
        if (isDanny) dannysLawn(game, world, mats, b, water, info);
        if (isGrandma) grandmasPorch(game, world, mats, b, info);
        if (isKit) {
          const s = row.dir < 0 ? 1 : -1;
          const kp = info.frame.p(info.porch.px + s * (info.porch.w / 2 - 1.1), 0, info.d / 2 + info.porch.d / 2);
          poi(world, 'kit:3', kp.x, H(kp.x, kp.z) + 0.2, kp.z);
        }
      }
    }

    // ---- view homes on the crest (face south onto Hilltop Crescent)
    const topXs = [-44, -26.5, 26.5, 44];
    const topStyles: HouseStyle[] = ['foursquare', 'gable', 'bungalow', 'gable'];
    const top: { info: HouseInfo; x: number; backWall: number }[] = [];
    topXs.forEach((x, i) => {
      const front = crescentZ(x) - 6.0 - 3.3;
      const info = buildHouse(game, world, b, {
        x,
        z: front - D / 2,
        face: 0,
        w: 9,
        d: D,
        style: topStyles[i],
        siding: nextColor(),
        roof: pick(r, ROOFS),
        seed: 900 + i * 31,
        chimney: i === 2 ? true : undefined,
      });
      top.push({ info, x, backWall: front - D });
      const sf = info.stepFoot;
      b.add('concrete', ribbon(world, [new THREE.Vector2(sf.x, crescentZ(sf.x) - 6.0), new THREE.Vector2(sf.x, sf.z - 0.15)], -0.65, 0.65, 0.06, { tile: 2.2, across: 1 }), null, 0xd6d1c7, {
        uvTile: 0,
      });
      const mz = crescentZ(sf.x) - 6.45;
      P.spawnOnGround(game, P.mailbox(mats), sf.x + 1.2, mz, 0);
    });

    // ================================================================ yards, fences, backyard fun
    const fence = new FenceBuilder(game, world, b);
    for (const s of [-1, 1]) {
      fence.line(s * (STAIR_X - 2), LOT_Z0 - 0.5, s * (STAIR_X - 2), LOT_Z1 + 0.5, 1.8, 0xe8d8c8);
      fence.line(s * (STAIR_X + 2), LOT_Z0 - 0.5, s * (STAIR_X + 2), LOT_Z1 + 0.5, 1.8, 0xd6c2ae);
    }
    for (const h of houses) {
      const row = ROWS[h.row];
      const zs = [lotSouth(h.lot)];
      if (h.lot === LOTS - 1) zs.push(LOT_Z1);
      for (const z of zs) fence.line(h.backWall, z, row.backX, z, 1.8, 0xe8d8c8);
      // return fences from the back corners of the house to the lot lines (gate gap on the north side)
      const fx = h.backWall - row.dir * 0.3;
      const hz = h.info.frame.z;
      const hw = h.info.w / 2;
      fence.line(fx, hz + hw, fx, lotSouth(h.lot) - 0.1, 1.8, 0xe8d8c8);
      fence.line(fx, hz - hw, fx, lotNorth(h.lot) + 0.1, 1.8, 0xe8d8c8, 1.1);
    }
    type Feature = 'pool' | 'tramp' | 'bbq' | 'garden';
    const yard: Record<string, Feature> = {
      '0:1': 'tramp',
      '0:2': 'pool',
      '0:3': 'bbq',
      '0:4': 'garden',
      '1:0': 'bbq',
      '1:1': 'pool',
      '1:2': 'tramp',
      '1:4': 'bbq',
      '2:0': 'garden',
      '2:1': 'tramp',
      '2:2': 'bbq',
      '2:3': 'pool',
      '3:1': 'bbq',
      '3:2': 'pool',
      '3:3': 'garden',
      '3:4': 'tramp',
    };
    const rhodos: [number, number][] = [];
    const shrubs: [number, number][] = [];
    for (const h of houses) {
      const row = ROWS[h.row];
      const x0 = h.backWall - row.dir * 0.35,
        x1 = row.backX + row.dir * 0.3;
      const cx = (x0 + x1) / 2;
      const depth = Math.abs(x1 - x0);
      const cz = lotZ(h.lot);
      const feat = yard[`${h.row}:${h.lot}`];
      if (feat === 'pool') buildPool(game, world, mats, b, water, cx, cz, depth - 0.3, LOT_LEN - 4.6, r);
      else if (feat === 'tramp') {
        buildTrampoline(game, world, mats, b, cx, cz + 2.2, Math.min(1.9, depth / 2 - 0.5), pick(r, [0x2f7de1, 0x35b36a, 0xe8559a, 0xf29f1f]));
        P.spawnOnGround(game, P.beachBall(mats), cx + 0.5, cz - 3.6);
      } else if (feat === 'bbq') bbqPatio(game, world, mats, b, cx, cz, row.dir, r);
      else if (feat === 'garden') gardenBeds(game, world, mats, b, cx, cz, depth, r);
      // gnomes & shrubs in front yards
      const fx = row.frontX + row.dir * 2.6;
      if (r() < 0.45) {
        const gz = h.info.frame.z + (r() < 0.5 ? -1 : 1) * (2.2 + r() * 1.5);
        P.spawnOnGround(game, P.gnome(mats, pick(r, [0xd8342c, 0x2f6fb5, 0xe8b923, 0x3d8b3d]), pick(r, [0x2f6fb5, 0x7b3fa0, 0x3d8b3d, 0xd8342c])), fx, gz, row.face + (r() - 0.5));
      }
      // foundation shrubs: at front corners not covered by the porch, and flanking the porch steps
      const list = r() < 0.5 ? rhodos : shrubs;
      const pr = h.info.porch;
      for (const s of [-1, 1]) {
        const lx = s * (h.info.w / 2 - 0.7);
        if (Math.abs(lx - pr.px) > pr.w / 2 + 0.5) {
          const p = h.info.frame.p(lx, 0, h.info.d / 2 + 0.9);
          list.push([p.x, p.z]);
        }
        if (r() < 0.7) {
          const p2 = h.info.frame.p(pr.px + s * 1.9, 0, h.info.d / 2 + pr.d + 0.55);
          (r() < 0.5 ? rhodos : shrubs).push([p2.x, p2.z]);
        }
      }
    }
    plantTrees(game, world, mats, 'rhodo', rhodos, { seed: 51, collider: false, scale: [0.9, 1.3] });
    plantTrees(game, world, mats, 'shrub', shrubs, { seed: 52, collider: false, scale: [0.9, 1.3] });
    // crest houses' backyards (between the back wall and the back fence at z=-178.5)
    const BACK_FENCE = -178.5;
    top.forEach((t, i) => {
      const z0 = t.backWall - 0.35,
        z1 = BACK_FENCE + 0.3;
      const cz = (z0 + z1) / 2;
      const depth = z0 - z1;
      if (i === 0) buildTrampoline(game, world, mats, b, t.x, cz, Math.min(1.9, depth / 2 - 0.4), 0xe8559a);
      else if (i === 1) buildPool(game, world, mats, b, water, t.x, cz, 11, depth - 0.3, r);
      else if (i === 2) bbqPatio(game, world, mats, b, t.x, cz, 1, r);
      else gardenBeds(game, world, mats, b, t.x, cz, 7, r);
      fence.line(t.x - 8.3, t.backWall, t.x - 8.3, BACK_FENCE, 1.8, 0xe8d8c8);
      fence.line(t.x + 8.3, t.backWall, t.x + 8.3, BACK_FENCE, 1.8, 0xe8d8c8);
      fence.line(t.x - 8.3, BACK_FENCE, t.x + 8.3, BACK_FENCE, 1.8, 0xd6c2ae);
    });

    // ---- front hedges on some Tumble St lots (gap for the front walk)
    const hedgeLine = (x: number, za: number, zb: number) => {
      const len = Math.abs(zb - za);
      if (len < 0.8) return;
      const n = Math.max(1, Math.ceil(len / 2.4));
      for (let i = 0; i < n; i++) {
        const z0 = za + ((zb - za) * i) / n,
          z1 = za + ((zb - za) * (i + 1)) / n;
        const g0 = Math.min(H(x, z0), H(x, z1));
        const top = Math.max(H(x, z0), H(x, z1)) + 0.95;
        b.box('hedge', x, (g0 - 0.2 + top) / 2, (z0 + z1) / 2, 0.8, top - g0 + 0.2, Math.abs(z1 - z0) + 0.05, pick(r, [0x4f7a3a, 0x5a8540, 0x46703a]));
        world.collider(new THREE.Vector3(x, (g0 - 0.2 + top) / 2, (z0 + z1) / 2), new THREE.Vector3(0.8, top - g0 + 0.2, Math.abs(z1 - z0)));
      }
    };
    for (const h of houses) {
      const row = ROWS[h.row];
      if (row.street !== 'tumble' || (h.row === special.danny[0] && h.lot === special.danny[1]) || (h.row === 0 && h.lot === 3)) continue;
      if (r() < 0.45) continue;
      const x = Math.sign(row.frontX) * (WALK_OUT + 0.95);
      const walkZ = h.info.stepFoot.z;
      hedgeLine(x, lotSouth(h.lot) - 0.7, walkZ + 1.9);
      hedgeLine(x, walkZ - 1.1, lotNorth(h.lot) + 0.7);
    }

    // ---- bins at the curb on Tumble St (it's garbage day), cones at the bottom (bowling!)
    const binKinds = ['recycle', 'compost', 'garbage'] as const;
    for (const h of houses.filter((q) => ROWS[q.row].street === 'tumble')) {
      if (r() < 0.25) continue;
      const row = ROWS[h.row];
      const x = Math.sign(row.frontX) * (ROAD_HW - 0.55);
      const z0 = h.info.stepFoot.z + 2.0;
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const z = z0 + i * 0.85;
        P.spawnOnGround(game, P.wheelieBin(mats, binKinds[(i + h.lot) % 3]), x, z, row.face + Math.PI);
      }
    }
    for (let rowi = 0; rowi < 4; rowi++) {
      for (let j = 0; j <= rowi; j++) {
        const x = (j - rowi / 2) * 1.0;
        const z = -80 + rowi * 0.9;
        P.spawnOnGround(game, P.trafficCone(mats), x, z, r() * 6);
      }
    }

    // ---- street trees, lamps, poles & wires on Tumble St
    const westTrees: [number, number][] = [];
    const eastTrees: [number, number][] = [];
    for (let z = -72; z > -144; z -= 11.5) {
      westTrees.push([-4.45, z + (r() - 0.5) * 1.5]);
      eastTrees.push([4.45, z - 5 + (r() - 0.5) * 1.5]);
    }
    const allStreetTrees = [...westTrees, ...eastTrees];
    plantTrees(game, world, mats, 'maple', allStreetTrees.filter((_, i) => i % 3 !== 1), { seed: 11, scale: [0.75, 0.95] });
    plantTrees(game, world, mats, 'plum', allStreetTrees.filter((_, i) => i % 3 === 1), { seed: 12, scale: [0.9, 1.1] });
    for (const z of [-78, -100, -122, -144]) streetLamp(world, b, -5.3, z, Math.PI / 2);
    for (const z of [-82, -106, -130]) streetLamp(world, b, 5.3, z, -Math.PI / 2);
    const poles: THREE.Vector3[] = [];
    for (const z of [-70, -94, -118, -142]) poles.push(powerPole(world, b, 4.6, z));
    wires(world, poles);
    const tp = poles[poles.length - 1];
    poi(world, 'bobblehead:n4', tp.x, tp.y + 0.45, tp.z);

    // backdrop forest on the out-of-bounds hillside (whole north edge), conifers on the ridge + yard trees
    plantBackdrop(game, world, mats);
    const ridgeTrees: [number, number][] = [];
    for (let x = -58; x <= 58; x += 5.5 + r() * 3) ridgeTrees.push([x, -184 - r() * 8]);
    plantTrees(game, world, mats, 'fir', ridgeTrees.filter((_, i) => i % 2 === 0), { seed: 21, scale: [0.9, 1.35] });
    plantTrees(game, world, mats, 'cedar', ridgeTrees.filter((_, i) => i % 2 === 1), { seed: 22, scale: [0.9, 1.25] });
    const yardTrees: [number, number][] = [];
    for (const h of houses) {
      if (r() < 0.5 || yard[`${h.row}:${h.lot}`] === 'pool') continue;
      const row = ROWS[h.row];
      yardTrees.push([row.backX + row.dir * 1.3, lotZ(h.lot) - LOT_LEN * 0.36]);
    }
    plantTrees(game, world, mats, 'birch', yardTrees.filter((_, i) => i % 2 === 0), { seed: 31 });
    plantTrees(game, world, mats, 'maple', yardTrees.filter((_, i) => i % 2 === 1), { seed: 32, scale: [0.8, 1] });

    // ================================================================ public stairways (stepped streets)
    for (const s of [-1, 1]) publicStairs(game, world, b, s * STAIR_X, LOT_Z0 + 0.3, crescentZ(s * STAIR_X) + 6.0);

    // ================================================================ Furry Park viewpoint
    furryPark(game, world, mats, b, crescentZ(0));

    // ================================================================ signs & street furniture
    poi(world, 'rollingStreetTop', 0, H(0, -145.5) + 0.6, -145.5);
    poi(world, 'rollingStreetBottom', 0, H(0, -68.5) + 0.6, -68.5);
    streetSign(world, b, -5.5, -146.9, 'TUMBLE ST', 'HILLTOP CRES');
    streetSign(world, b, 5.7, -67.6, 'TUMBLE ST', '');
    warningSign(world, b, 5.6, -137, 0);
    slowSign(world, b, -5.6, -111, Math.PI / 2);
    radarSign(game, world, b, 5.6, -91);
    littleLibrary(world, b, -7.4, -113.6);

    // ================================================================ cats on fences (decorative, tails swish)
    const catSpots: [number, number, number][] = [
      [-(STAIR_X - 2), -92, Math.PI / 2],
      [STAIR_X + 2, -118, -Math.PI / 2],
      [-(STAIR_X + 2), -131, Math.PI / 2],
      [STAIR_X - 2, -76, -Math.PI / 2],
      [-26.5 + 8.3, -172, 0],
    ];
    for (const [x, z, ry] of catSpots) sittingCat(game, world, fence.topAt(x, z), x, z, ry, r);

    // ================================================================ sprinklers on front lawns
    const sprinklers: [number, number][] = [
      [-9.5, lotZ(1) + 3.8],
      [9.5, lotZ(0) - 3.4],
      [-50.6, lotZ(2) + 3.2],
      [50.6, lotZ(1) - 3.2],
      [26.5 - 2.8, crescentZ(26.5) - 7.9],
    ];
    for (const [x, z] of sprinklers) sprinkler(game, world, mats, water, x, z);

    // ================================================================ bobbleheads + NPCs
    const gh = houses.find((h) => h.row === special.grandma[0] && h.lot === special.grandma[1])!.info;
    poi(world, 'bobblehead:n1', gh.ridge.x, gh.ridge.y + 0.35, gh.ridge.z);
    const ct = top[2].info.chimneyTop ?? top[2].info.ridge;
    poi(world, 'bobblehead:n7', ct.x, ct.y + 0.35, ct.z);

    const sidewalkPath = (x: number) => {
      const pts: THREE.Vector3[] = [];
      for (let z = -68; z >= -146; z -= 6) pts.push(new THREE.Vector3(x, H(x, z) + 0.07, z));
      return pts;
    };
    world.npcSpawns.push(
      { zone: ZONE, center: new THREE.Vector3(-5.8, H(-5.8, -100), -100), radius: 30, count: 4, types: ['pedestrian', 'jogger', 'pedestrian'], path: sidewalkPath(-5.8) },
      { zone: ZONE, center: new THREE.Vector3(5.8, H(5.8, -110), -110), radius: 30, count: 3, types: ['pedestrian', 'jogger'], path: sidewalkPath(5.8) },
      {
        zone: ZONE,
        center: new THREE.Vector3(0, H(0, crescentZ(0) - 5), crescentZ(0) - 5),
        radius: 20,
        count: 3,
        types: ['pedestrian', 'jogger'],
        path: crescent.filter((_, i) => i % 5 === 0).map((p) => new THREE.Vector3(p.x, H(p.x, p.y - 5.2) + 0.07, p.y - 5.2)),
      },
      { zone: ZONE, center: new THREE.Vector3(0, H(0, -170), -170), radius: 8, count: 4, types: ['kid', 'kid', 'pedestrian'] },
      {
        zone: ZONE,
        center: new THREE.Vector3(-STAIR_X, H(-STAIR_X, -105), -105),
        radius: 30,
        count: 2,
        types: ['jogger'],
        path: [-68, -90, -110, -130, -144].map((z) => new THREE.Vector3(-STAIR_X, H(-STAIR_X, z) + 0.2, z)),
      },
    );

    b.build(world.staticRoot, mats);
    refreshQueries(game);
  },
};

// ====================================================================================== helpers

/** Split a point list into runs where consecutive points are "close". */
function splitRuns(pts: THREE.Vector2[], close: (a: THREE.Vector2, b: THREE.Vector2) => boolean) {
  const out: THREE.Vector2[][] = [];
  let cur: THREE.Vector2[] = [];
  for (const p of pts) {
    if (cur.length && !close(cur[cur.length - 1], p)) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Wooden privacy fences: stepped ~2.4 m panels following the terrain, one collider per panel. */
class FenceBuilder {
  private tops: { x0: number; z0: number; dx: number; dz: number; len: number; pl: number; heights: number[] }[] = [];
  constructor(
    private game: Game,
    private world: World,
    private b: Batch,
  ) {}
  line(x0: number, z0: number, x1: number, z1: number, h: number, color: number, gapAtEnd = 0) {
    const full = Math.hypot(x1 - x0, z1 - z0);
    const len = full - gapAtEnd;
    if (len < 0.4) return;
    const dx = (x1 - x0) / full,
      dz = (z1 - z0) / full;
    const n = Math.max(1, Math.round(len / 2.4));
    const pl = len / n;
    const ry = Math.atan2(dx, dz);
    const heights: number[] = [];
    const cap = new THREE.Color(color).multiplyScalar(0.85).getHex();
    for (let i = 0; i < n; i++) {
      const cx = x0 + dx * pl * (i + 0.5),
        cz = z0 + dz * pl * (i + 0.5);
      const g = Math.min(this.world.heightAt(x0 + dx * pl * i, z0 + dz * pl * i), this.world.heightAt(x0 + dx * pl * (i + 1), z0 + dz * pl * (i + 1)));
      const gc = this.world.heightAt(cx, cz);
      const y0 = g - 0.25;
      const topY = gc + h;
      heights.push(topY);
      this.b.box('cedar', cx, (y0 + topY) / 2, cz, 0.06, topY - y0, pl, color, ry);
      this.b.box('cedar', cx, topY + 0.04, cz, 0.14, 0.08, pl + 0.02, cap, ry);
      this.b.box('cedar', x0 + dx * pl * i, (y0 + topY + 0.1) / 2, z0 + dz * pl * i, 0.12, topY + 0.1 - y0, 0.12, 0xb8a08a, ry);
      this.world.collider(new THREE.Vector3(cx, (y0 + topY) / 2, cz), new THREE.Vector3(0.1, topY - y0, pl), ry);
    }
    this.tops.push({ x0, z0, dx, dz, len, pl, heights });
  }
  /** Height of the fence top nearest to (x, z). */
  topAt(x: number, z: number) {
    let best = this.world.heightAt(x, z) + 1.8;
    let bd = Infinity;
    for (const t of this.tops) {
      const u = THREE.MathUtils.clamp((x - t.x0) * t.dx + (z - t.z0) * t.dz, 0, t.len);
      const d = Math.hypot(t.x0 + t.dx * u - x, t.z0 + t.dz * u - z);
      if (d < bd) {
        bd = d;
        best = t.heights[Math.min(t.heights.length - 1, Math.floor(u / t.pl))];
      }
    }
    return best;
  }
}

/**
 * Raised backyard pool on a wooden deck (flat even on the hill). sx/sz = deck size.
 * Access steps go up from the highest ground side.
 */
function buildPool(game: Game, world: World, mats: MatSet, b: Batch, water: WaterSystem, cx: number, cz: number, sx: number, sz: number, r: () => number) {
  const pwx = Math.max(2.2, sx - 2.0),
    pwz = Math.max(2.2, sz - 2.2);
  const fp = footprint(world, cx, cz, sx, sz, 0, 0.8);
  const floorY = fp.max + 0.05;
  const surf = floorY + 1.05;
  const deck = surf + 0.14;
  const base = fp.min - 0.3;
  const deckCol = pick(r, [0xf2e6da, 0xe6d6c6, 0xffffff]);
  const fx = (sx - pwx) / 2,
    fz = (sz - pwz) / 2;
  const parts: [number, number, number, number][] = [
    [cx - sx / 2 + fx / 2, cz, fx, sz],
    [cx + sx / 2 - fx / 2, cz, fx, sz],
    [cx, cz - sz / 2 + fz / 2, pwx, fz],
    [cx, cz + sz / 2 - fz / 2, pwx, fz],
  ];
  for (const [x, z, w, l] of parts) {
    b.box('cedar', x, (base + deck) / 2, z, w, deck - base, l, deckCol);
    world.collider(new THREE.Vector3(x, (base + deck) / 2, z), new THREE.Vector3(w, deck - base, l));
  }
  // pool shell: floor + tiled inner walls + white coping
  b.box('tile', cx, floorY - 0.1, cz, pwx, 0.2, pwz, 0x7fd0ee);
  world.collider(new THREE.Vector3(cx, floorY - 0.1, cz), new THREE.Vector3(pwx, 0.2, pwz));
  const wallH = deck - floorY;
  b.box('tile', cx - pwx / 2 + 0.03, floorY + wallH / 2, cz, 0.06, wallH, pwz, 0x9adcf2);
  b.box('tile', cx + pwx / 2 - 0.03, floorY + wallH / 2, cz, 0.06, wallH, pwz, 0x9adcf2);
  b.box('tile', cx, floorY + wallH / 2, cz - pwz / 2 + 0.03, pwx, wallH, 0.06, 0x9adcf2);
  b.box('tile', cx, floorY + wallH / 2, cz + pwz / 2 - 0.03, pwx, wallH, 0.06, 0x9adcf2);
  for (const s of [-1, 1]) {
    b.box('concrete', cx + (s * (pwx + 0.3)) / 2, deck + 0.03, cz, 0.3, 0.08, pwz + 0.6, 0xf1efe8);
    b.box('concrete', cx, deck + 0.03, cz + (s * (pwz + 0.3)) / 2, pwx, 0.08, 0.3, 0xf1efe8);
  }
  water.addBox({ name: 'Backyard Pool', kind: 'pool', center: new THREE.Vector3(cx, surf, cz), size: [pwx - 0.1, 1.0, pwz - 0.1] });
  // ladder
  const lz = cz - pwz / 2 + 0.25;
  for (const s of [-0.3, 0.3]) b.box('metal', cx + s, deck + 0.2, lz, 0.05, 1.3, 0.05, 0xd0d4d8);
  for (let i = 0; i < 3; i++) b.box('metal', cx, deck - 0.2 - i * 0.3, lz + 0.02, 0.6, 0.04, 0.08, 0xd0d4d8);
  // access steps from the highest-ground side: sides = [+x, -x, +z, -z]
  const sides: [number, number, number][] = [
    [1, 0, world.heightAt(cx + sx / 2 + 0.9, cz)],
    [-1, 0, world.heightAt(cx - sx / 2 - 0.9, cz)],
    [0, 1, world.heightAt(cx, cz + sz / 2 + 0.9)],
    [0, -1, world.heightAt(cx, cz - sz / 2 - 0.9)],
  ];
  sides.sort((a, c) => c[2] - a[2]);
  const [ux, uz, g] = sides[0];
  const rise = deck - g;
  const n = Math.max(2, Math.ceil(rise / 0.2));
  const runTot = Math.max(1.4, rise * 1.3);
  const run = runTot / n;
  const edge = ux !== 0 ? sx / 2 : sz / 2;
  for (let i = 0; i < n - 1; i++) {
    const topY = deck - (i + 1) * (rise / n);
    const off = edge + run * (i + 0.5);
    const px = cx + ux * off,
      pz = cz + uz * off;
    const gy = world.heightAt(px, pz);
    if (ux !== 0) b.box('cedar', px, (topY + gy - 0.2) / 2, pz, run + 0.02, topY - gy + 0.2, 1.4, deckCol);
    else b.box('cedar', px, (topY + gy - 0.2) / 2, pz, 1.4, topY - gy + 0.2, run + 0.02, deckCol);
  }
  const len = Math.hypot(runTot, rise);
  const ang = Math.atan2(rise, runTot);
  const mx = cx + ux * (edge + runTot / 2),
    mz = cz + uz * (edge + runTot / 2);
  const yaw = Math.atan2(ux, uz); // local +z points away from the deck (downhill of the steps)
  colliderBox(game, mx, (deck + g) / 2 - 0.12 * Math.cos(ang), mz, 1.4, 0.24, len, yaw, ang);
  // floaties, chairs
  P.spawn(game, P.poolFloat(mats, pick(r, [0xff6fae, 0xffd23f, 0x3fd1ff, 0x7dff8a])), cx + 0.4, surf - 0.1, cz + 0.8);
  if (r() < 0.7) P.spawn(game, P.beachBall(mats), cx - 0.4, surf - 0.2, cz - 1.2);
  const cxC = ux === 0 ? cx + (sx / 2 - fx / 2) : cx;
  const czC = ux === 0 ? cz : cz + (sz / 2 - fz / 2);
  if (fx > 0.7 || fz > 0.7) P.spawn(game, P.lawnChair(mats, pick(r, [0x2f8fd1, 0xf29f1f, 0xe8559a])), cxC, deck + 0.02, czC, ux === 0 ? -Math.PI / 2 : Math.PI);
}

function bbqPatio(game: Game, world: World, mats: MatSet, b: Batch, cx: number, cz: number, dir: number, r: () => number) {
  const y = world.heightAt(cx, cz);
  b.add('concrete', ribbon(world, [new THREE.Vector2(cx, cz + 2.6), new THREE.Vector2(cx, cz - 2.6)], -2.2, 2.2, 0.05, { tile: 2.4, across: 2 }), null, 0xcac4b8, { uvTile: 0 });
  P.spawnOnGround(game, P.gasGrill(mats, pick(r, [0x2b2b2e, 0x8b1e1e, 0x1e3f8b])), cx - 0.4, cz - 1.0, dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0.6);
  P.spawnOnGround(game, P.propaneTank(mats), cx + 0.6, cz - 2.1);
  // patio table + umbrella (static)
  const tx = cx + 0.2,
    tz = cz + 1.3;
  const ty = world.heightAt(tx, tz);
  b.add('metal', GEO.cyl, trs(tx, ty + 0.72, tz, 1.2, 0.05, 1.2), 0xe8e4dc);
  b.add('metal', GEO.cyl8, trs(tx, ty + 0.36, tz, 0.08, 0.72, 0.08), 0x555555);
  b.add('metal', GEO.cyl8, trs(tx, ty + 1.3, tz, 0.05, 2.2, 0.05), 0xdddddd);
  b.add('plain', GEO.cone, trs(tx, ty + 2.3, tz, 2.6, 0.6, 2.6), pick(r, [0xd8342c, 0x2f8fd1, 0x3d8b3d, 0xf29f1f]));
  world.collider(new THREE.Vector3(tx, ty + 0.4, tz), new THREE.Vector3(1.0, 0.8, 1.0));
  P.spawnOnGround(game, P.lawnChair(mats, 0xf4f1ea), tx + 1.0, tz, -Math.PI / 2);
  if (r() < 0.6) P.spawnOnGround(game, P.gnome(mats), cx - 1.6, cz + 2.2, r() * 6);
}

function gardenBeds(game: Game, world: World, mats: MatSet, b: Batch, cx: number, cz: number, depth: number, r: () => number) {
  const w = Math.max(1.6, Math.min(depth - 1.6, 4.5));
  for (let i = -1; i <= 1; i++) {
    const z = cz + i * 3.2;
    const y = Math.max(world.heightAt(cx - w / 2, z), world.heightAt(cx + w / 2, z));
    b.box('wood', cx, y - 0.05, z, w, 0.7, 1.4, 0x8b6a4a);
    world.collider(new THREE.Vector3(cx, y - 0.05, z), new THREE.Vector3(w, 0.7, 1.4));
    b.box('plain', cx, y + 0.31, z, w - 0.2, 0.06, 1.2, 0x4a3526);
    for (let k = 0; k < 6; k++) {
      const px = cx - w / 2 + 0.4 + (k * (w - 0.8)) / 5;
      b.add('leaves', GEO.ico, trs(px, y + 0.5, z + (r() - 0.5) * 0.4, 0.5, 0.42, 0.5, r() * 6), pick(r, [0x4f9a3c, 0x62a845, 0xd8342c, 0xf2c14e]));
    }
  }
  P.spawnOnGround(game, P.gnome(mats, 0x3d8b3d, 0xd8342c), cx + 1.1, cz + 5, r() * 6);
}

let _sprayMat: THREE.MeshBasicMaterial | null = null;
const sprayMat = () =>
  (_sprayMat ??= new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
let _wetMat: THREE.MeshStandardMaterial | null = null;
const wetMat = () =>
  (_wetMat ??= new THREE.MeshStandardMaterial({
    color: 0x2d5a22,
    transparent: true,
    opacity: 0.45,
    roughness: 0.2,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    alphaMap: canvasTexture(64, 64, (ctx, w, h) => {
      const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.75, '#bbbbbb');
      gr.addColorStop(1, '#000000');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h);
    }),
  }));
let _catMat: THREE.MeshStandardMaterial | null = null;
const catMat = () => (_catMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));

/** Street centre-lines + half-width to the sidewalk's outer edge (set while building; sprinklers keep off them). */
let paved: { pts: THREE.Vector2[]; half: number }[] = [];
function distToPaved(x: number, z: number) {
  let best = Infinity;
  for (const { pts, half } of paved)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        c = pts[i + 1];
      const dx = c.x - a.x,
        dz = c.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.y + dz * t)) - half);
    }
  return best;
}

/** Lawn sprinkler: shallow 'sprinkler' water volume + rotating spray arcs + a wet patch. */
function sprinkler(game: Game, world: World, mats: MatSet, water: WaterSystem, x0: number, z0: number) {
  const radius = 2.6;
  // Lot layouts vary (porches, steps, lattice, hedges): find the nearest spot to the requested one where the whole
  // spray is on open, fairly flat lawn — several used to sit inside porches or under steps.
  const clear = (x: number, z: number) => {
    if (distToPaved(x, z) < 1.2) return false; // on the lawn, not the street / sidewalk
    const y = world.heightAt(x, z);
    for (let r = 0; r <= radius + 0.2; r += 0.45)
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r,
          pz = z + Math.sin(a) * r;
        if (Math.abs(world.heightAt(px, pz) - y) > 0.45) return false;
        for (const h of [0.15, 0.7, 1.3]) {
          let hit = false;
          game.physics.world.intersectionsWithPoint({ x: px, y: y + h, z: pz }, (c) => {
            if (c.isSensor() || c.shapeType() === 7 /* heightfield */) return true;
            hit = true;
            return false;
          });
          if (hit) return false;
          if (r === 0) break;
        }
      }
    return true;
  };
  refreshQueries(game); // colliders built earlier in this zone must be visible to the clearance test
  let x = x0,
    z = z0;
  search: for (let d = 0; d <= 9; d += 0.75)
    for (let a = 0; a < Math.PI * 2; a += d === 0 ? 7 : Math.PI / Math.max(4, Math.round(d * 3))) {
      const cx = x0 + Math.cos(a) * d,
        cz = z0 + Math.sin(a) * d;
      if (clear(cx, cz)) {
        x = cx;
        z = cz;
        break search;
      }
    }
  const y = world.heightAt(x, z);
  water.addCircle({ name: 'Lawn Sprinkler', kind: 'sprinkler', center: new THREE.Vector3(x, y + 0.08, z), radius, depth: 0.1, visual: false });
  const base = new THREE.Mesh(GEO.cyl, mats.gloss);
  base.scale.set(0.18, 0.12, 0.18);
  base.position.set(x, y + 0.06, z);
  world.staticRoot.add(base);
  const wet = new THREE.Mesh(groundDecal(world, x, z, radius, 0.05, 6), wetMat());
  wet.receiveShadow = true;
  world.staticRoot.add(wet);
  const sb = new Batch(1e9);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const reach = radius * (0.75 + i * 0.1);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      pts.push(new THREE.Vector3(Math.cos(a) * reach * t, 1.4 * 4 * t * (1 - t) * (0.8 + i * 0.1), Math.sin(a) * reach * t));
    }
    sb.add('w', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.035, 5), null, 0xffffff, { uvTile: 0 });
    for (let k = 3; k <= 9; k += 2) sb.add('w', GEO.ico0, trs(pts[k].x, pts[k].y - 0.12, pts[k].z, 0.08, 0.08, 0.08), 0xffffff, { uvTile: 0 });
  }
  const spray = sb.buildSingle(sprayMat());
  spray.castShadow = false;
  spray.position.set(x, y + 0.14, z);
  spray.userData.noMerge = true;
  world.staticRoot.add(spray);
  addAnimator(game, (dt, _t, _n, g) => {
    const p = g.get<any>('player');
    if (p && p.position.distanceToSquared(spray.position) > 90 * 90) return;
    spray.rotation.y += dt * 1.6;
  });
}

function streetLamp(world: World, b: Batch, x: number, z: number, ry: number) {
  const y = world.heightAt(x, z);
  b.add('metal', GEO.cyl8, trs(x, y + 2.6, z, 0.14, 5.2, 0.14), 0x2f3a35);
  b.add('metal', GEO.cyl8, trs(x, y + 0.3, z, 0.3, 0.6, 0.3), 0x2f3a35);
  const f = new Frame(x, y, z, ry);
  f.box(b, 'metal', 0, 5.15, 0.5, 0.08, 0.08, 1.1, 0x2f3a35);
  f.geo(b, 'metal', GEO.cone, 0, 5.05, 1.0, 0.6, 0.3, 0.6, 0x2f3a35);
  f.box(b, 'lamp', 0, 4.88, 1.0, 0.36, 0.08, 0.36, 0xfff0c8);
  world.collider(new THREE.Vector3(x, y + 2.6, z), new THREE.Vector3(0.22, 5.2, 0.22));
}

function powerPole(world: World, b: Batch, x: number, z: number) {
  const y = world.heightAt(x, z);
  const h = 9.5;
  b.add('bark', GEO.cyl8, trs(x, y + h / 2, z, 0.34, h, 0.34), 0x6b5140);
  b.box('wood', x, y + h - 0.6, z, 2.4, 0.16, 0.16, 0x5a4332);
  for (const s of [-1, 0, 1]) b.add('plain', GEO.cyl8, trs(x + s * 1.0, y + h - 0.45, z, 0.1, 0.18, 0.1), 0x6fa37a);
  b.add('metal', GEO.cyl8, trs(x - 0.35, y + h - 1.6, z, 0.5, 0.8, 0.5), 0x8a9096);
  world.collider(new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(0.36, h, 0.36));
  world.collider(new THREE.Vector3(x, y + h - 0.6, z), new THREE.Vector3(2.4, 0.16, 0.16));
  return new THREE.Vector3(x, y + h, z);
}

/** Sagging overhead wires between pole tops. */
function wires(world: World, poles: THREE.Vector3[]) {
  const pts: number[] = [];
  for (let i = 0; i < poles.length - 1; i++) {
    const a = poles[i],
      c = poles[i + 1];
    for (const s of [-1, 0, 1]) {
      const N = 12;
      for (let k = 0; k < N; k++) {
        for (const t of [k / N, (k + 1) / N]) {
          const sag = 4 * t * (1 - t) * 0.7;
          pts.push(a.x + s + (c.x - a.x) * t, a.y - 0.38 + (c.y - a.y) * t - sag, a.z + (c.z - a.z) * t);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  world.staticRoot.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1c1c1c })));
}

/** Concrete public stairway with pipe railings following the hill: flights + landings, ramp colliders. */
function publicStairs(game: Game, world: World, b: Batch, x: number, zBottom: number, zTop: number) {
  const SW = 2.2;
  const flight = 6.5;
  const landing = 1.6;
  let z = zBottom;
  const col = 0xc9c4ba;
  let lamp = 0;
  while (z > zTop + 0.5) {
    const z0 = z,
      z1 = Math.max(zTop, z - flight);
    const y0 = world.heightAt(x, z0) + 0.1;
    const y1 = world.heightAt(x, z1) + 0.12;
    const rise = y1 - y0;
    const runLen = z0 - z1;
    const n = Math.max(1, Math.round(Math.abs(rise) / 0.17));
    const stepRun = runLen / n;
    for (let i = 0; i < n; i++) {
      const topY = y0 + (rise * (i + 1)) / n;
      const zc = z0 - stepRun * (i + 0.5);
      const g = world.heightAt(x, zc);
      b.box('concrete', x, (topY + g - 0.4) / 2, zc, SW, topY - g + 0.4, stepRun + 0.01, col);
    }
    const len = Math.hypot(runLen, rise);
    const ang = Math.atan2(rise, runLen);
    colliderBox(game, x, (y0 + y1) / 2 - 0.16, (z0 + z1) / 2, SW, 0.3, len + 0.05, 0, ang);
    for (const s of [-1, 1]) {
      b.add('metal', GEO.cyl8, trs(x + (s * SW) / 2, (y0 + y1) / 2 + 0.9, (z0 + z1) / 2, 0.06, len, 0.06, 0, ang - Math.PI / 2), 0x3b4a45);
      b.add('metal', GEO.cyl8, trs(x + (s * SW) / 2, y0 + 0.45, z0, 0.07, 0.95, 0.07), 0x3b4a45);
      b.add('metal', GEO.cyl8, trs(x + (s * SW) / 2, y1 + 0.45, z1, 0.07, 0.95, 0.07), 0x3b4a45);
    }
    if (lamp++ % 3 === 1) streetLamp(world, b, x - SW / 2 - 0.35, (z0 + z1) / 2, Math.PI / 2);
    z = z1;
    if (z > zTop + 0.5) {
      const zl = z - landing;
      const yl = Math.max(world.heightAt(x, z), world.heightAt(x, zl)) + 0.12;
      const gm = world.heightAt(x, z - landing / 2);
      b.box('concrete', x, (yl + gm - 0.4) / 2, z - landing / 2, SW + 0.4, yl - gm + 0.4, landing, 0xd3cec4);
      colliderBox(game, x, yl - 0.15, z - landing / 2, SW + 0.4, 0.3, landing);
      z = zl;
    }
  }
}

function furryPark(game: Game, world: World, mats: MatSet, b: Batch, zCres: number) {
  const zs = zCres - 6.2; // park south edge
  const ox = 0,
    oz = zs - 5.5;
  const ow = 13,
    od = 7;
  const fp = footprint(world, ox, oz, ow, od, 0, 1);
  const top = fp.max + 2.0;
  const base = fp.min - 0.4;
  b.box('stone', ox, (base + top) / 2, oz, ow, top - base, od, 0xc3bcae);
  b.box('paving', ox, top + 0.04, oz, ow - 0.2, 0.08, od - 0.2, 0xd8d2c6);
  world.collider(new THREE.Vector3(ox, (base + top) / 2, oz), new THREE.Vector3(ow, top - base, od));
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    b.box('metal', (x0 + x1) / 2, top + 1.0, (z0 + z1) / 2, 0.07, 0.07, len, 0x2b2f2e, ry);
    b.box('metal', (x0 + x1) / 2, top + 0.55, (z0 + z1) / 2, 0.05, 0.05, len, 0x2b2f2e, ry);
    const n = Math.max(1, Math.round(len / 1.2));
    for (let i = 0; i <= n; i++) b.box('metal', x0 + ((x1 - x0) * i) / n, top + 0.5, z0 + ((z1 - z0) * i) / n, 0.06, 1.0, 0.06, 0x2b2f2e);
    world.collider(new THREE.Vector3((x0 + x1) / 2, top + 0.55, (z0 + z1) / 2), new THREE.Vector3(0.12, 1.1, len), ry);
  };
  const e = ow / 2 - 0.2;
  const sN = oz - od / 2 + 0.2,
    sS = oz + od / 2 - 0.2;
  rail(-e, sS, e, sS);
  rail(-e, sN, e, sN);
  const stairZ = oz - od / 2 + 1.5;
  for (const s of [-1, 1]) {
    const g = world.heightAt(ox + s * (ow / 2 + 1.7), stairZ);
    const rise = top - g;
    const runTot = Math.max(2.4, rise * 1.5);
    const n = Math.max(2, Math.ceil(rise / 0.18));
    const run = runTot / n;
    for (let i = 0; i < n - 1; i++) {
      const ty = top - (i + 1) * (rise / n);
      const xc = ox + s * (ow / 2 + run * (i + 0.5));
      const gy = world.heightAt(xc, stairZ);
      b.box('stone', xc, (ty + gy - 0.3) / 2, stairZ, run + 0.02, ty - gy + 0.3, 2.2, 0xcac3b6);
    }
    const len = Math.hypot(runTot, rise);
    const ang = Math.atan2(rise, runTot);
    colliderBox(game, ox + s * (ow / 2 + runTot / 2), (top + g) / 2 - 0.12, stairZ, 2.2, 0.24, len, s > 0 ? Math.PI / 2 : -Math.PI / 2, ang);
    rail(s * e, sS, s * e, stairZ + 1.25);
  }
  // bench facing south (the view down Tumble St to Old Ballard and the bay)
  const bz = oz + 1.6;
  const f = new Frame(ox, top, bz, 0);
  f.box(b, 'wood', 0, 0.45, 0, 2.2, 0.08, 0.5, 0x8b5e3c);
  f.box(b, 'wood', 0, 0.8, -0.26, 2.2, 0.4, 0.06, 0x8b5e3c, 0, -0.15);
  for (const s of [-1, 1]) f.box(b, 'metal', s * 0.95, 0.25, 0, 0.08, 0.5, 0.5, 0x2b2f2e);
  f.collider(game, 0, 0.3, 0, 2.2, 0.6, 0.5);
  poi(world, 'viewpoint', ox, top + 0.9, bz);
  // coin-op binoculars
  const bx = ox + 4.2,
    bzz = oz + od / 2 - 0.9;
  b.add('metal', GEO.cyl8, trs(bx, top + 0.6, bzz, 0.14, 1.2, 0.14), 0x3b6f9a);
  b.box('metal', bx, top + 1.3, bzz, 0.5, 0.3, 0.35, 0x3b6f9a);
  for (const s of [-1, 1]) b.add('metal', GEO.cyl8, trs(bx + s * 0.13, top + 1.32, bzz + 0.22, 0.14, 0.2, 0.14, 0, Math.PI / 2), 0x222222);
  world.collider(new THREE.Vector3(bx, top + 0.7, bzz), new THREE.Vector3(0.5, 1.4, 0.4));
  // park sign
  const tex = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#5b3d25';
    roundRect(ctx, 0, 0, w, h, 26);
    ctx.fill();
    ctx.strokeStyle = '#e8d5a8';
    ctx.lineWidth = 8;
    roundRect(ctx, 12, 12, w - 24, h - 24, 18);
    ctx.stroke();
    ctx.fillStyle = '#f6e7c1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'FURRY PARK', w / 2, h * 0.38, w - 60, 92, "'Lilita One', sans-serif");
    fitText(ctx, 'Viewpoint  •  Est. Jimothy Summer 2026', w / 2, h * 0.72, w - 70, 30, "'Nunito', sans-serif", '800');
  });
  const sy = world.heightAt(ox - 9.5, zs - 0.9);
  signPanel(world, tex, ox - 9.5, sy + 1.2, zs - 0.9, 2.4, 1.2, 0, { back: 0x4a3220, depth: 0.12, batch: b });
  b.box('wood', ox - 10.6, sy + 0.6, zs - 0.9, 0.14, 1.2, 0.14, 0x4a3220);
  b.box('wood', ox - 8.4, sy + 0.6, zs - 0.9, 0.14, 1.2, 0.14, 0x4a3220);
  // "Round Form #7" bronze sculpture of a very round raccoon
  const sx = ox + 9,
    sz = oz - 6.5;
  const g = world.heightAt(sx, sz);
  b.box('stone', sx, g + 0.5, sz, 1.6, 1.0, 1.6, 0xd6d0c4);
  world.collider(new THREE.Vector3(sx, g + 0.5, sz), new THREE.Vector3(1.6, 1.0, 1.6));
  const bronze = 0x9c6b3a;
  b.add('metal', GEO.sphere, trs(sx, g + 1.75, sz, 1.6, 1.5, 1.7), bronze);
  for (const s of [-1, 1]) b.add('metal', GEO.sphere, trs(sx + s * 0.45, g + 2.45, sz + 0.35, 0.34, 0.34, 0.2), bronze);
  b.add('metal', GEO.cyl8, trs(sx, g + 1.4, sz - 0.9, 0.36, 0.9, 0.36, 0, 1.1), bronze);
  colliderBox(game, sx, g + 1.75, sz, 1.4, 1.4, 1.5);
  // picnic tables, trees around the lawn
  for (const [px, pz] of [
    [-7, zs - 14],
    [6, zs - 15.5],
  ]) {
    const py = world.heightAt(px, pz);
    b.box('wood', px, py + 0.75, pz, 2.0, 0.08, 0.9, 0x9b6b43);
    for (const s of [-1, 1]) b.box('wood', px, py + 0.45, pz + s * 0.75, 2.0, 0.06, 0.32, 0x9b6b43);
    for (const s of [-1, 1]) b.box('wood', px + s * 0.8, py + 0.37, pz, 0.08, 0.74, 1.6, 0x7b5535);
    world.collider(new THREE.Vector3(px, py + 0.4, pz), new THREE.Vector3(2.0, 0.8, 1.8));
  }
  plantTrees(game, world, mats, 'maple', [
    [-12.8, zs - 4],
    [12.8, zs - 3.5],
    [-11.5, zs - 18],
    [11, zs - 19],
  ], { seed: 41, scale: [1.05, 1.25] });
  plantTrees(game, world, mats, 'rhodo', [
    [-3.5, zs - 1.1],
    [3.5, zs - 1.1],
    [-14, zs - 10],
    [14, zs - 10],
  ], { seed: 42, collider: false });
}

function dannysLawn(game: Game, world: World, mats: MatSet, b: Batch, water: WaterSystem, info: HouseInfo) {
  // the perfect lawn: between the sidewalk (x=-6.6) and Danny's porch steps, split around the front walk
  const x0 = -WALK_OUT - 0.35,
    x1 = info.stepFoot.x - 0.3;
  const zc = info.frame.z;
  const zS = zc + 6.8,
    zN = zc - 6.8;
  const walkZ = info.stepFoot.z;
  const stripes = canvasTexture(256, 256, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#56cc3f' : '#3dae30';
      ctx.fillRect(0, (i * h) / 8, w, h / 8);
    }
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = `rgba(${20 + Math.random() * 60},${120 + Math.random() * 90},${20 + Math.random() * 40},0.35)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 3);
    }
  });
  stripes.wrapS = stripes.wrapT = THREE.RepeatWrapping;
  const lawnMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.9 });
  // path runs east (x1 → x0); right-hand normal = +z
  const path = [new THREE.Vector2(x1, zc), new THREE.Vector2(x0, zc)];
  for (const [a, c] of [
    [zN - zc, walkZ - 0.72 - zc],
    [walkZ + 0.72 - zc, zS - zc],
  ]) {
    if (c - a < 0.5) continue;
    const lawn = new THREE.Mesh(ribbon(world, path, a, c, 0.04, { tile: 8, across: Math.ceil((c - a) / 1.2) }), lawnMat);
    lawn.receiveShadow = true;
    world.staticRoot.add(lawn);
  }
  // brick edging
  for (const x of [x0, x1]) b.add('brick', ribbon(world, [new THREE.Vector2(x, zS), new THREE.Vector2(x, zN)], -0.12, 0.12, 0.1, { tile: 1.2, across: 1 }), null, 0xc9765a, { uvTile: 0 });
  for (const z of [zS, zN]) b.add('brick', ribbon(world, [new THREE.Vector2(x1, z), new THREE.Vector2(x0, z)], -0.12, 0.12, 0.1, { tile: 1.2, across: 1 }), null, 0xc9765a, { uvTile: 0 });
  const cx = (x0 + x1) / 2;
  const pz = walkZ > zc ? zc - 3 : zc + 3;
  poi(world, 'dannyLawn', cx, world.heightAt(cx, pz) + 0.4, pz);
  const tex = canvasTexture(512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 0, 0, w, h, 20);
    ctx.fill();
    ctx.strokeStyle = '#1f7a35';
    ctx.lineWidth = 16;
    roundRect(ctx, 14, 14, w - 28, h - 28, 14);
    ctx.stroke();
    ctx.fillStyle = '#1b1b1b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'PLEASE', w / 2, h * 0.24, w - 80, 62, "'Lilita One', sans-serif");
    fitText(ctx, 'KEEP OFF', w / 2, h * 0.45, w - 80, 78, "'Lilita One', sans-serif");
    fitText(ctx, 'THE GRASS', w / 2, h * 0.67, w - 80, 78, "'Lilita One', sans-serif");
    ctx.fillStyle = '#1f7a35';
    fitText(ctx, '(rolling is fine)', w / 2, h * 0.86, w - 120, 30, "'Nunito', sans-serif", '800');
  });
  const sx = x0 - 0.15,
    sz = zS - 1.4;
  const sy = world.heightAt(sx, sz);
  signPanel(world, tex, sx, sy + 0.95, sz, 1.0, 0.62, Math.PI / 2, { back: 0xffffff, depth: 0.04, collide: false, batch: b });
  b.box('wood', sx, sy + 0.4, sz, 0.06, 0.8, 0.06, 0x7a5c40);
  sprinkler(game, world, mats, water, cx + 0.8, pz + (pz > zc ? 1.5 : -1.5));
}

function grandmasPorch(game: Game, world: World, mats: MatSet, b: Batch, info: HouseInfo) {
  const f = info.frame;
  const pz = info.d / 2 + info.porch.d / 2;
  const px = info.porch.px;
  const left = px - info.porch.w / 2;
  const right = px + info.porch.w / 2;
  // Grandma's rocking chair + night-time snack bowl are placed by the heart quest at POI grandmaPorch:
  // keep that end of the porch clear and put the POI on the floor, closer to the house wall than to the railing
  // (the quest turns the chair away from the nearest wall).
  const gp = f.p(right - 1.5, 0.02, info.d / 2 + 0.8);
  poi(world, 'grandmaPorch', gp.x, gp.y, gp.z);
  // a little wall lantern + wind chime by her spot
  f.box(b, 'lamp', right - 1.5, 2.05, info.d / 2 + 0.1, 0.18, 0.26, 0.14, 0xffe9b8);
  for (let i = 0; i < 4; i++) f.geo(b, 'metal', GEO.cyl8, right - 0.7 + (i - 1.5) * 0.08, 2.05 - (i % 2) * 0.12, info.d / 2 + 2.0, 0.025, 0.4, 0.025, 0xc9d3dd);
  // knitting basket + yarn balls
  const kx = left + 0.9;
  f.geo(b, 'wood', GEO.cyl, kx + 0.4, 0.2, pz + 0.6, 0.55, 0.4, 0.55, 0xb08050);
  f.geo(b, 'plain', GEO.sphere, kx + 0.3, 0.38, pz + 0.6, 0.24, 0.24, 0.24, 0x7fb3e0);
  f.geo(b, 'plain', GEO.sphere, kx + 0.52, 0.4, pz + 0.55, 0.24, 0.24, 0.24, 0xf2a3c0);
  f.box(b, 'metal', kx + 0.45, 0.5, pz + 0.65, 0.02, 0.02, 0.5, 0xd0d0d0, 0.6, 0.3);
  f.collider(game, kx + 0.4, 0.2, pz + 0.6, 0.55, 0.4, 0.55);
  [0xe0457b, 0xf2c14e, 0x6bc4a6].forEach((c, i) => {
    const p = f.p(kx + 1.1 + i * 0.35, 0, pz + 0.75);
    P.spawn(game, P.yarnBall(mats, c), p.x, info.floorY + 0.02, p.z);
  });
  // welcome mat
  const mat = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#9b6b3c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#6b4424';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#3b2412';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'WELCOME', w / 2, h * 0.38, w - 30, 40, "'Lilita One', sans-serif");
    fitText(ctx, 'raccoons', w / 2, h * 0.72, w - 60, 30, "'Nunito', sans-serif", '800');
  });
  const doorLocal = info.door.clone().applyMatrix4(f.m.clone().invert());
  const mp = f.p(doorLocal.x, 0.02, info.d / 2 + 0.55);
  const matMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.6).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: mat, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  matMesh.position.copy(mp);
  matMesh.rotation.y = f.rotY;
  world.staticRoot.add(matMesh);
  // flower pots
  for (const s of [-1, 1]) {
    const x = px + s * (info.porch.w / 2 - 0.5);
    f.geo(b, 'plain', GEO.cyl, x, 0.2, info.d / 2 + info.porch.d - 0.75, 0.45, 0.4, 0.45, 0xb8643c);
    f.geo(b, 'leaves', GEO.ico, x, 0.6, info.d / 2 + info.porch.d - 0.75, 0.6, 0.5, 0.6, 0xe0568f);
  }
  roseTrellis(game, world, b, info, left);
  void pz;
}

/**
 * Grandma Rosie's rose trellis on the porch's end: the easy way onto the porch roof (and from there up the shingles to
 * the ridge bobblehead). Climbing the house wall under the porch roof just bonks his head, and bare walls tire him 4×
 * faster than ladders, so the trellis is a ladder volume.
 */
function roseTrellis(game: Game, world: World, b: Batch, info: HouseInfo, left: number) {
  const f = info.frame;
  const x = left - 0.1; // just outside the porch end; the porch-roof collider starts at `left`, so he mantles onto it
  const z0 = info.d / 2 + 0.12, // the whole porch end, so there is no gap to climb up into under the roof
    z1 = info.d / 2 + info.porch.d - 0.35; // up to the column line (where the porch-roof collider ends)
  const zc = (z0 + z1) / 2,
    zw = z1 - z0;
  // local ground under the trellis (houses sit on slopes)
  let gy = 0;
  for (const z of [z0, zc, z1]) {
    const p = f.p(x, 0, z);
    gy = Math.min(gy, world.heightAt(p.x, p.z) - info.floorY);
  }
  const top = 2.78; // just under the porch-roof surface at the front, so the top of the climb mantles onto it
  const h = top - gy;
  const white = 0xf6f2e8;
  for (let i = 0; i < 4; i++) f.box(b, 'trim', x, gy + h / 2, z0 + 0.05 + (i * (zw - 0.1)) / 3, 0.07, h, 0.07, white);
  for (let y = gy + 0.35; y < top; y += 0.42) f.box(b, 'trim', x, y, zc, 0.06, 0.06, zw, white);
  f.box(b, 'trim', x, top + 0.04, zc, 0.12, 0.08, zw + 0.2, white);
  // climbing roses: leafy clumps with fat pink/red blooms, spilling over the top onto the porch roof
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 22; k++) {
    const y = gy + 0.3 + r() * (h - 0.1);
    const z = z0 + 0.1 + r() * (zw - 0.2);
    f.geo(b, 'leaves', GEO.ico, x - 0.08, y, z, 0.42, 0.36, 0.42, k % 3 ? 0x4f9a3c : 0x3f8a34);
    f.geo(b, 'plain', GEO.ico, x - 0.2, y + 0.08, z + 0.1, 0.2, 0.2, 0.2, r() < 0.5 ? 0xff5d8f : 0xe0304f);
  }
  for (let k = 0; k < 4; k++) {
    const z = z0 + 0.35 + k * 0.62;
    f.geo(b, 'leaves', GEO.ico, x + 0.1, top + 0.12, z, 0.45, 0.3, 0.4, 0x4f9a3c);
    f.geo(b, 'plain', GEO.ico, x + 0.05, top + 0.28, z + 0.08, 0.2, 0.18, 0.2, k % 2 ? 0xff5d8f : 0xe0304f);
  }
  f.collider(game, x, gy + h / 2, zc, 0.1, h, zw);
  // ladder volume: his body while climbing it (from the lattice out to ~1.2 m), from the ground to just above the roof
  const a = f.p(x - 1.3, gy - 0.5, z0 - 0.3);
  const c = f.p(x + 0.3, top + 1.0, z1 + 0.3);
  world.addLadder(a.clone().min(c), a.clone().max(c));
}

// ------------------------------------------------------------------ signs

function streetSign(world: World, b: Batch, x: number, z: number, a: string, c: string) {
  const y = world.heightAt(x, z);
  b.add('metal', GEO.cyl8, trs(x, y + 1.6, z, 0.08, 3.2, 0.08), 0x6d767a);
  world.collider(new THREE.Vector3(x, y + 1.6, z), new THREE.Vector3(0.12, 3.2, 0.12));
  const mk = (text: string) =>
    canvasTexture(512, 112, (ctx, w, h) => {
      ctx.fillStyle = '#1f6b3a';
      roundRect(ctx, 0, 0, w, h, 14);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5;
      roundRect(ctx, 7, 7, w - 14, h - 14, 10);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, text, w / 2, h / 2 + 3, w - 40, 70, "'Lilita One', sans-serif");
    });
  const ta = mk(a);
  signPanel(world, ta, x, y + 3.05, z, 1.6, 0.35, Math.PI / 2, { back: 0x1f6b3a, depth: 0.04, collide: false, batch: b, doubleSided: true });
  if (c) {
    const tc = mk(c);
    signPanel(world, tc, x, y + 2.68, z, 1.6, 0.35, 0, { back: 0x1f6b3a, depth: 0.04, collide: false, batch: b, doubleSided: true });
  }
}

function drawRollingRaccoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.55, cy - r * 0.85, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#f2c230';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.35, cy - r * 0.15, r * 0.16, r * 0.12, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.35, cy - r * 0.15, r * 0.16, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = r * 0.12;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.3, cy - r * 0.5 + i * r * 0.5);
    ctx.lineTo(cx - r * 1.9, cy - r * 0.5 + i * r * 0.5);
    ctx.stroke();
  }
}

/** Yellow diamond "21% GRADE" with a rolling raccoon, facing north (read by those about to roll down). */
function warningSign(world: World, b: Batch, x: number, z: number, ry: number) {
  const y = world.heightAt(x, z);
  b.add('metal', GEO.cyl8, trs(x, y + 1.2, z, 0.07, 2.4, 0.07), 0x6d767a);
  world.collider(new THREE.Vector3(x, y + 1.2, z), new THREE.Vector3(0.1, 2.4, 0.1));
  const tex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6d767a';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#111';
    roundRect(ctx, -176, -176, 352, 352, 30);
    ctx.fill();
    ctx.fillStyle = '#f7c21d';
    roundRect(ctx, -166, -166, 332, 332, 24);
    ctx.fill();
    ctx.restore();
    drawRollingRaccoon(ctx, w / 2 + 24, h / 2 - 34, 62);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    fitText(ctx, '21% GRADE', w / 2, h / 2 + 96, 230, 48, "'Lilita One', sans-serif");
  });
  signPanel(world, tex, x, y + 2.35, z, 1.2, 1.2, Math.PI + ry, { back: 0x6d767a, depth: 0.03, collide: false, batch: b });
}

function slowSign(world: World, b: Batch, x: number, z: number, ry: number) {
  const y = world.heightAt(x, z);
  b.add('metal', GEO.cyl8, trs(x, y + 1.1, z, 0.07, 2.2, 0.07), 0x6d767a);
  const tex = canvasTexture(512, 400, (ctx, w, h) => {
    ctx.fillStyle = '#f7c21d';
    roundRect(ctx, 0, 0, w, h, 26);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 12;
    roundRect(ctx, 12, 12, w - 24, h - 24, 18);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'SLOW', w / 2, h * 0.24, w - 80, 96, "'Lilita One', sans-serif");
    fitText(ctx, 'ROUND BOYS', w / 2, h * 0.52, w - 70, 70, "'Lilita One', sans-serif");
    fitText(ctx, 'AT PLAY', w / 2, h * 0.76, w - 90, 70, "'Lilita One', sans-serif");
  });
  signPanel(world, tex, x, y + 2.3, z, 1.05, 0.82, ry, { back: 0x6d767a, depth: 0.03, collide: false, batch: b });
}

/** Radar speed sign: shows Jimothy's speed as he rolls down Tumble St (faces uphill). */
function radarSign(game: Game, world: World, b: Batch, x: number, z: number) {
  const y = world.heightAt(x, z);
  b.add('metal', GEO.cyl8, trs(x, y + 1.5, z, 0.1, 3.0, 0.1), 0x6d767a);
  world.collider(new THREE.Vector3(x, y + 1.5, z), new THREE.Vector3(0.14, 3.0, 0.14));
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  let shown = -1;
  const draw = (mph: number) => {
    const w = canvas.width,
      h = canvas.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'YOUR SPEED', w / 2, 34, w - 20, 38, "'Lilita One', sans-serif");
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(16, 64, w - 32, 150);
    const fast = mph > 25;
    ctx.fillStyle = fast ? '#ff3b2f' : '#ffb21d';
    ctx.font = "120px 'Luckiest Guy', sans-serif";
    ctx.fillText(mph > 0 ? String(mph) : '--', w / 2, 150);
    ctx.fillStyle = fast ? '#d0201a' : '#111';
    fitText(ctx, fast ? 'SLOW DOWN,' : 'SPEED LIMIT', w / 2, 248, w - 20, 30, "'Lilita One', sans-serif");
    fitText(ctx, fast ? 'ROUND BOY' : '25 (raccoons: 20)', w / 2, 284, w - 20, 30, "'Lilita One', sans-serif");
    tex.needsUpdate = true;
  };
  draw(0);
  const mesh = signPanel(world, tex, x, y + 2.6, z, 0.9, 1.12, Math.PI, { back: 0x333333, depth: 0.1, collide: false, batch: b });
  const front = mesh.material as THREE.MeshStandardMaterial;
  front.emissive = new THREE.Color(0xffffff);
  front.emissiveMap = tex;
  front.emissiveIntensity = 0.35;
  let acc = 0;
  let lastTicket = -99;
  addAnimator(game, (dt, t, _n, g) => {
    acc += dt;
    if (acc < 0.12) return;
    acc = 0;
    const p = g.get<any>('player');
    if (!p) return;
    const dz = p.position.z - z;
    const near = Math.abs(p.position.x) < 8 && dz < -1 && dz > -45; // uphill of the sign, approaching
    const v = p.velocity as THREE.Vector3;
    const mph = near && v.z > 0.5 ? Math.round(v.length() * 2.237) : 0;
    if (mph !== shown) {
      shown = mph;
      draw(mph);
    }
    if (mph > 35 && t - lastTicket > 12) {
      lastTicket = t;
      g.score(150, `Speeding Ticket: ${mph} MPH`);
      g.events.emit('speedTrap', { mph });
    }
  });
}

function littleLibrary(world: World, b: Batch, x: number, z: number) {
  const y = world.heightAt(x, z);
  b.box('wood', x, y + 0.6, z, 0.12, 1.2, 0.12, 0x7a5c40);
  b.box('paint', x, y + 1.45, z, 0.7, 0.55, 0.5, 0xd8465f);
  b.add('roof', GEO.prism, trs(x, y + 1.72, z, 0.85, 0.35, 0.62, Math.PI / 2), 0x3f5648);
  b.box('glass', x + 0.26, y + 1.45, z, 0.02, 0.4, 0.38, 0x9fb7c9);
  const rr = rng(77);
  for (let i = 0; i < 4; i++) b.box('plain', x + 0.1, y + 1.33, z - 0.15 + i * 0.09, 0.3, 0.26, 0.07, pick(rr, [0x2d4a7a, 0xf2c14e, 0x3d8b3d, 0xd8342c]));
  world.collider(new THREE.Vector3(x, y + 0.9, z), new THREE.Vector3(0.7, 1.8, 0.5));
  const tex = canvasTexture(256, 96, (ctx, w, h) => {
    ctx.fillStyle = '#f6efe0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5b2a2a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'LITTLE FREE LIBRARY', w / 2, h * 0.36, w - 16, 30, "'Lilita One', sans-serif");
    fitText(ctx, 'take a book • wash a book', w / 2, h * 0.74, w - 20, 22, "'Nunito', sans-serif", '800');
  });
  signPanel(world, tex, x + 0.02, y + 1.82, z, 0.62, 0.23, Math.PI / 2, { collide: false, depth: 0.02, batch: b });
}

/** Road paint ("ROLL", "SLOW"), readable by someone heading downhill (south). */
function roadText(world: World, text: string, x: number, z: number) {
  const tex = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.scale(1, 1.6);
    fitText(ctx, text, w / 2, h / 2 / 1.6, w - 20, 150, "'Lilita One', sans-serif");
    ctx.restore();
  });
  const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 });
  const geo = ribbon(world, [new THREE.Vector2(x, z + 2.2), new THREE.Vector2(x, z - 2.2)], -2.4, 2.4, 0.05, { tile: 1, across: 4 });
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = (x + 2.4 - pos.getX(i)) / 4.8;
    const v = (pos.getZ(i) - (z - 2.2)) / 4.4;
    uv.setXY(i, u, v);
  }
  const mesh = new THREE.Mesh(geo, m);
  mesh.receiveShadow = true;
  world.staticRoot.add(mesh);
}

/** Decorative cat loafing on a fence top; its tail swishes. */
function sittingCat(game: Game, world: World, topY: number, x: number, z: number, ry: number, r: () => number) {
  const col = pick(r, [0xe08a3a, 0x2a2a2a, 0x9a9a9a, 0xf1e6d6, 0x6b4f3a]);
  const cb = new Batch(1e9);
  cb.add('p', GEO.sphere, trs(0, 0.2, 0, 0.36, 0.34, 0.5), col);
  cb.add('p', GEO.sphere, trs(0, 0.42, 0.18, 0.26, 0.24, 0.24), col);
  for (const s of [-1, 1]) {
    cb.add('p', GEO.cone4, trs(s * 0.08, 0.57, 0.18, 0.08, 0.12, 0.06), col);
    cb.add('p', GEO.sphere, trs(s * 0.06, 0.45, 0.29, 0.04, 0.045, 0.02), 0x9fd66b);
  }
  cb.add('p', GEO.sphere, trs(0, 0.4, 0.31, 0.03, 0.025, 0.02), 0xe79a88);
  const g = new THREE.Group();
  g.add(cb.buildSingle(catMat()));
  const tb = new Batch(1e9);
  tb.add('t', new THREE.CylinderGeometry(0.03, 0.04, 0.45, 6).translate(0, -0.22, 0), null, col, { uvTile: 0 });
  const tail = tb.buildSingle(catMat());
  tail.position.set(0, 0.2, -0.22);
  g.add(tail);
  g.position.set(x, topY + 0.05, z);
  g.rotation.y = ry;
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  tail.userData.noMerge = true;
  world.staticRoot.add(g);
  const phase = r() * 10;
  addAnimator(game, (_dt, t) => {
    tail.rotation.z = Math.sin(t * 2.2 + phase) * 0.5;
    tail.rotation.x = 0.35 + Math.sin(t * 1.3 + phase) * 0.1;
  });
}
