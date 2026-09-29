/**
 * NE — University of Washing (parody of UW), zone center (120, -120).
 *
 *  - Laundry Plaza: a stone terrace with the "Drum-Dryer" laundromat fountain (giant stone soap bars, a washing
 *    machine sculpture, rising bubbles), the founder statue (Ezekiel Lint, holding a sock), bike racks, grand steps.
 *  - Rinse-ier Vista: a cherry-blossom-lined stairway up the hill between two brick halls.
 *  - The Quad: cherry trees, falling petals, collegiate-gothic halls, Suds-allo Library with its tower, and the
 *    graduation stage (POIs gradStage + dean — the HonoraryDegree quest runs the ceremony & spawns the dean).
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
  footprint,
  colliderBox,
  colliderRing,
  addAnimator,
  rng,
  pick,
  poi,
  refreshQueries,
  type MatSet,
} from './kit';
import { gothicHall, type HallInfo } from './gothic';
import { plantTrees, TREE_TOP } from './flora';
import * as P from './props';

const ZONE = 'University of Washing';
const PURPLE = '#4b2a84';
const GOLD = '#e8b923';

// Laundry Plaza terrace
const PX = 120,
  PZ = -86,
  PW = 34,
  PD = 22;

export const UniversityOfWashing: ZoneBuilder = {
  name: ZONE,
  async build(game: Game, world: World) {
    const [mats] = await Promise.all([northMaterials(game), loadFonts()]);
    const water = game.get<WaterSystem>('water')!;
    const b = new Batch(60);
    const r = rng(1861);
    const H = (x: number, z: number) => world.heightAt(x, z);
    world.areas.push({ name: ZONE, min: new THREE.Vector2(60, -200), max: new THREE.Vector2(200, -60) });

    // ============================================================ Laundry Plaza (terrace) + fountain
    const fp = footprint(world, PX, PZ, PW, PD, 0, 1);
    const plazaY = fp.max + 0.12;
    const base = fp.min - 0.5;
    b.box('stone', PX, (base + plazaY) / 2, PZ, PW, plazaY - base, PD, 0xd2c8b4);
    b.box('paving', PX, plazaY + 0.04, PZ, PW - 0.3, 0.08, PD - 0.3, 0xece4d4);
    world.collider(new THREE.Vector3(PX, (base + plazaY + 0.08) / 2, PZ), new THREE.Vector3(PW, plazaY + 0.08 - base, PD));
    const top = plazaY + 0.08;
    // balustrade on the south + side edges (gap for the grand steps)
    const bal = (x0: number, z0: number, x1: number, z1: number) => balustrade(world, b, x0, z0, x1, z1, top);
    bal(PX - PW / 2 + 0.3, PZ + PD / 2 - 0.3, PX - 8.3, PZ + PD / 2 - 0.3);
    bal(PX + 8.3, PZ + PD / 2 - 0.3, PX + PW / 2 - 0.3, PZ + PD / 2 - 0.3);
    bal(PX - PW / 2 + 0.3, PZ + PD / 2 - 0.3, PX - PW / 2 + 0.3, PZ - PD / 2 + 3);
    bal(PX + PW / 2 - 0.3, PZ + PD / 2 - 0.3, PX + PW / 2 - 0.3, PZ - PD / 2 + 3);
    // grand steps down to the avenue side
    grandSteps(game, world, b, PX, PZ + PD / 2, 16, top, 1);

    const fountainTop = buildFountain(game, world, mats, b, water, PX, top, PZ + 0.5);
    poi(world, 'bobblehead:n5', PX, fountainTop + 0.35, PZ + 0.5);
    founderStatue(game, world, b, PX, top, PZ - PD / 2 + 3.2);
    // bike racks with bikes
    for (const s of [-1, 1]) {
      const rx = PX + s * (PW / 2 - 2.2);
      for (let i = 0; i < 2; i++) bikeRack(game, world, mats, b, rx, top, PZ - 4 + i * 7, r);
    }
    // benches + lamps on the plaza
    for (const s of [-1, 1]) {
      for (const dz of [-5, 5]) bench(game, world, b, PX + s * 9.5, top, PZ + dz, s > 0 ? -Math.PI / 2 : Math.PI / 2);
      for (const dz of [-8, 8]) gothicLamp(game, world, b, PX + s * 13.5, top, PZ + dz);
    }

    // ============================================================ entrance sign monument (faces the big intersection)
    entranceSign(game, world, b, 84, -71.5);

    // ============================================================ Rinse-ier Vista: cherry-lined stairs up the hill
    const vistaTopZ = -128;
    vistaStairs(game, world, b, PX, PZ - PD / 2, vistaTopZ, 10, top);
    const cherries: [number, number][] = [];
    for (let z = PZ - PD / 2 - 3; z > vistaTopZ + 1; z -= 6.5) {
      cherries.push([PX - 8.2, z]);
      cherries.push([PX + 8.2, z - 3]);
    }
    for (let z = -74; z > -96; z -= 7) {
      cherries.push([PX - PW / 2 - 4, z]);
      cherries.push([PX + PW / 2 + 4, z - 3]);
    }

    // halls flanking the Vista (face south, long axis along the contour)
    const halls: { info: HallInfo; name: string }[] = [];
    const lint = gothicHall(game, world, b, { x: 90, z: -110, face: 0, w: 24, d: 13, h: 12, floors: 3, seed: 11 });
    halls.push({ info: lint, name: 'LINT HALL' });
    const rinse = gothicHall(game, world, b, { x: 150, z: -110, face: 0, w: 24, d: 13, h: 12, floors: 3, seed: 12, brick: 0xbf6d52 });
    halls.push({ info: rinse, name: 'RINSE HALL' });

    // ============================================================ The Quad (upper campus)
    // the library is dug into the hillside: floor set from the ground in front, not the (much higher) back
    const libFloor = Math.max(H(108, -166), H(120, -166), H(132, -166)) + 0.5;
    const library = gothicHall(game, world, b, { x: 120, z: -174, face: 0, w: 46, d: 12, h: 14, floors: 2, seed: 21, tower: true, bay: 5, brick: 0xc47456, floorY: libFloor });
    halls.push({ info: library, name: 'SUDS-ALLO LIBRARY' });
    const spin = gothicHall(game, world, b, { x: 86, z: -146, face: Math.PI / 2, w: 26, d: 13, h: 12, floors: 3, seed: 31 });
    halls.push({ info: spin, name: 'SPIN HALL' });
    const tumble = gothicHall(game, world, b, { x: 154, z: -146, face: -Math.PI / 2, w: 26, d: 13, h: 12, floors: 3, seed: 32, brick: 0xbd6a4e });
    halls.push({ info: tumble, name: 'TUMBLE DRY HALL' });
    for (const hInfo of halls) hallPlaque(world, b, hInfo.info, hInfo.name);
    if (library.towerTop) poi(world, 'bobblehead:n2', library.towerTop.x, library.towerTop.y + 0.35, library.towerTop.z);
    if (library.towerTop) libraryTowerLadder(world, b, library);

    // quad lawn paths
    const libFootZ = library.stepsEnd.z; // ground in front of the library steps
    const pathCol = 0xe3dccd;
    b.add('paving', ribbon(world, [new THREE.Vector2(PX, vistaTopZ + 0.5), new THREE.Vector2(PX, libFootZ - 1)], -2.2, 2.2, 0.05, { tile: 4, across: 2 }), null, pathCol, { uvTile: 0 });
    b.add('paving', ribbon(world, [new THREE.Vector2(spin.entrance.x, -141), new THREE.Vector2(tumble.entrance.x, -141)], -1.6, 1.6, 0.05, { tile: 4, across: 2 }), null, pathCol, { uvTile: 0 });
    for (const hh of [lint, rinse]) {
      b.add('paving', ribbon(world, [new THREE.Vector2(hh.entrance.x, hh.entrance.z + 0.5), new THREE.Vector2(hh.entrance.x, PZ - PD / 2 - 0.2)], -1.4, 1.4, 0.05, { tile: 4, across: 1 }), null, pathCol, {
        uvTile: 0,
      });
    }
    // cherry trees ringing the quad
    for (let z = -131; z > libFootZ + 3; z -= 7) {
      cherries.push([101.5, z]);
      cherries.push([138.5, z - 2]);
    }
    for (let x = 104; x < 138; x += 7) if (Math.abs(x - PX) > 7) cherries.push([x, -131.5]);

    // ============================================================ graduation stage
    const stageZ = libFootZ + 4.6;
    const stage = gradStage(game, world, mats, b, PX, stageZ);
    // the photogenic cherry tree beside the banner (canopy platform: bobblehead:n8)
    const ctx = PX + 9.3,
      ctz = stageZ - 5.0;
    plantTrees(game, world, mats, 'cherry', [[ctx, ctz]], { seed: 99, scale: [1.3, 1.3], variants: 1 });
    {
      const g = H(ctx, ctz);
      const capY = g + TREE_TOP.cherry * 1.3 - 1.2;
      colliderBox(game, ctx, capY, ctz, 3.2, 0.4, 3.2);
      poi(world, 'bobblehead:n8', ctx, capY + 0.55, ctz);
    }
    // chairs for the audience
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 6; k++) {
        const side = k < 3 ? -1 : 1;
        const x = PX + side * (1.9 + (k % 3) * 0.85);
        const z = stageZ + 5.2 + row * 1.25;
        P.spawnOnGround(game, P.foldingChair(mats, row === 0 ? 0xe8d9ff : 0xf4f1ea), x, z, Math.PI + (r() - 0.5) * 0.1, 0.3, 0.02);
      }
    }
    // diplomas + caps
    for (let i = 0; i < 5; i++) P.spawnDiploma(game, mats, stage.tableX - 0.6 + i * 0.3, stage.top + 0.95, stage.tableZ, Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const x = PX + (r() - 0.5) * 8,
        z = stageZ + 6 + r() * 5;
      P.spawnOnGround(game, P.gradCap(mats), x, z, r() * 6, 0.25);
    }
    P.spawnDiploma(game, mats, PX + 3, H(PX + 3, stageZ + 8.2) + 0.05, stageZ + 8.2, 0.4);

    // ============================================================ trees, petals, lamps
    plantTrees(game, world, mats, 'cherry', cherries, { seed: 7, scale: [1.0, 1.25] });
    petalDecals(world, cherries.concat([[ctx, ctz]]));
    fallingPetals(game, world, new THREE.Vector3(PX, 0, -118), 38, 62);
    const firs: [number, number][] = [];
    for (let x = 64; x <= 182; x += 7 + r() * 3) firs.push([x, -186 - r() * 7]);
    plantTrees(game, world, mats, 'fir', firs, { seed: 71, scale: [0.9, 1.3] });
    plantTrees(game, world, mats, 'maple', [
      [72, -92],
      [168, -92],
      [70, -130],
      [172, -130],
      [74, -160],
      [168, -164],
    ], { seed: 72, scale: [1.0, 1.25] });
    for (const z of [-134, -142, -150]) {
      gothicLamp(game, world, b, PX - 3.2, H(PX - 3.2, z), z);
      gothicLamp(game, world, b, PX + 3.2, H(PX + 3.2, z), z);
    }

    // ============================================================ NPCs (students; the dean is spawned by the HonoraryDegree quest)
    world.npcSpawns.push(
      { zone: ZONE, center: new THREE.Vector3(PX, top, PZ), radius: 12, count: 4, types: ['pedestrian', 'pedestrian', 'fan', 'tourist'] },
      {
        zone: ZONE,
        center: new THREE.Vector3(PX, H(PX, -112), -112),
        radius: 18,
        count: 3,
        types: ['pedestrian', 'jogger'],
        path: [-99, -106, -113, -120, -127].map((z) => new THREE.Vector3(PX + (z % 2 ? 2 : -2), H(PX, z) + 0.3, z)),
      },
      { zone: ZONE, center: new THREE.Vector3(PX, H(PX, -140), -140), radius: 14, count: 5, types: ['pedestrian', 'pedestrian', 'fan', 'kid'] },
    );

    b.build(world.staticRoot, mats);
    refreshQueries(game);
  },
};

// ====================================================================================== pieces

function balustrade(world: World, b: Batch, x0: number, z0: number, x1: number, z1: number, y: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.5) return;
  const ry = Math.atan2(x1 - x0, z1 - z0);
  const mx = (x0 + x1) / 2,
    mz = (z0 + z1) / 2;
  b.box('concrete', mx, y + 0.95, mz, 0.34, 0.14, len, 0xefe8da, ry);
  b.box('concrete', mx, y + 0.1, mz, 0.34, 0.2, len, 0xefe8da, ry);
  const n = Math.floor(len / 0.32);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    b.add('concrete', GEO.cyl8, trs(x0 + (x1 - x0) * t, y + 0.52, z0 + (z1 - z0) * t, 0.16, 0.72, 0.16), 0xefe8da);
  }
  world.collider(new THREE.Vector3(mx, y + 0.5, mz), new THREE.Vector3(0.34, 1.0, len), ry);
}

/** Wide stone steps down from a terrace edge (dir = +1: stepping down toward +z). */
function grandSteps(game: Game, world: World, b: Batch, cx: number, edgeZ: number, width: number, topY: number, dir: 1 | -1) {
  let g = world.heightAt(cx, edgeZ + dir * 4);
  let n = Math.max(2, Math.ceil((topY - g) / 0.18));
  const run = 0.36;
  for (let it = 0; it < 2; it++) {
    g = Math.min(world.heightAt(cx - width / 2, edgeZ + dir * n * run), world.heightAt(cx + width / 2, edgeZ + dir * n * run));
    n = Math.max(2, Math.ceil((topY - g) / 0.18));
  }
  const rise = topY - g;
  const h = rise / n;
  for (let i = 0; i < n - 1; i++) {
    const t = topY - (i + 1) * h;
    const zc = edgeZ + dir * run * (i + 0.5);
    const gy = Math.min(world.heightAt(cx - width / 2, zc), world.heightAt(cx + width / 2, zc));
    b.box('concrete', cx, (t + gy - 0.4) / 2, zc, width, t - gy + 0.4, run + 0.02, 0xe6dfd0);
  }
  // cheek walls + urns
  for (const s of [-1, 1]) {
    const len = (n - 1) * run;
    const zc = edgeZ + (dir * len) / 2;
    const gy = world.heightAt(cx + s * (width / 2 + 0.4), edgeZ + dir * len);
    b.box('stone', cx + s * (width / 2 + 0.4), (topY + gy - 0.4) / 2, zc, 0.8, topY - gy + 0.4, len, 0xcfc5b0);
    // (these cheek walls + urns were visual only: Jimothy walked into them from the lawn and the steps)
    colliderBox(game, cx + s * (width / 2 + 0.4), (topY + gy - 0.4) / 2, zc, 0.8, topY - gy + 0.4, len);
    colliderBox(game, cx + s * (width / 2 + 0.4), topY + 0.45, edgeZ + dir * 0.5, 0.7, 0.9, 0.7);
    b.add('concrete', GEO.cyl, trs(cx + s * (width / 2 + 0.4), topY + 0.45, edgeZ + dir * 0.5, 0.7, 0.9, 0.7), 0xe8e0d0);
    b.add('leaves', GEO.ico, trs(cx + s * (width / 2 + 0.4), topY + 1.1, edgeZ + dir * 0.5, 0.9, 0.7, 0.9), 0xd6457a);
  }
  const len = Math.hypot(n * run, rise);
  const ang = Math.atan2(rise, n * run);
  colliderBox(game, cx, (topY + g) / 2 - 0.15, edgeZ + (dir * n * run) / 2, width, 0.3, len, dir > 0 ? 0 : Math.PI, ang);
}

/** Wide stairs following the hill from (x, z0) north to z1, with landings; ramp colliders. */
function vistaStairs(game: Game, world: World, b: Batch, x: number, z0: number, z1: number, width: number, startY: number) {
  let z = z0;
  let y0 = startY;
  const flight = 5.5;
  const landing = 2.4;
  while (z > z1 + 0.5) {
    const za = z,
      zb = Math.max(z1, z - flight);
    const yb = Math.max(world.heightAt(x - width / 2, zb), world.heightAt(x + width / 2, zb), world.heightAt(x, zb)) + 0.12;
    const rise = yb - y0;
    const runLen = za - zb;
    const n = Math.max(1, Math.round(Math.abs(rise) / 0.17));
    for (let i = 0; i < n; i++) {
      const t = y0 + (rise * (i + 1)) / n;
      const zc = za - (runLen / n) * (i + 0.5);
      const gy = Math.min(world.heightAt(x - width / 2, zc), world.heightAt(x + width / 2, zc));
      b.box('concrete', x, (t + gy - 0.4) / 2, zc, width, t - gy + 0.4, runLen / n + 0.01, 0xe6dfd0);
    }
    const len = Math.hypot(runLen, rise);
    const ang = Math.atan2(rise, runLen);
    // floor pass: going uphill the ramp ran through the steps' back corners, so every nosing stood up to one riser
    // (~0.17 m) proud of it and Jimothy walked "inside" the stairs. Shift it one tread downhill so it runs through
    // the nosings instead, and cap the top tread (which the shifted ramp no longer covers).
    const sh = rise > 0 ? runLen / n : 0;
    colliderBox(game, x, (y0 + yb) / 2 - 0.16, (za + zb) / 2 + sh, width, 0.3, len + 0.05, 0, ang);
    if (sh > 0) colliderBox(game, x, yb - 0.15, zb + sh / 2, width, 0.3, sh + 0.02);
    for (const s of [-1, 1]) {
      b.add('metal', GEO.cyl8, trs(x + (s * width) / 2 - s * 0.2, (y0 + yb) / 2 + 0.9, (za + zb) / 2, 0.07, len, 0.07, 0, ang - Math.PI / 2), 0x2b2f2e);
    }
    z = zb;
    y0 = yb;
    if (z > z1 + 0.5) {
      const zl = Math.max(z1, z - landing);
      const gy = Math.min(world.heightAt(x - width / 2, (z + zl) / 2), world.heightAt(x + width / 2, (z + zl) / 2));
      const ly = Math.max(y0, world.heightAt(x, zl) + 0.12);
      b.box('paving', x, (ly + gy - 0.4) / 2, (z + zl) / 2, width, ly - gy + 0.4, z - zl, 0xe3dccd);
      colliderBox(game, x, ly - 0.15, (z + zl) / 2, width, 0.3, z - zl);
      y0 = ly;
      z = zl;
    }
  }
}

/** The Drum-Dryer Fountain: laundromat-themed, soap-bar sculptures, a washing machine spouting water, bubbles. */
function buildFountain(game: Game, world: World, mats: MatSet, b: Batch, water: WaterSystem, cx: number, y: number, cz: number) {
  const R = 6.2;
  const rimH = 0.65;
  const depth = 0.55;
  // basin: floor, rim ring (merged cylinder-ish segments), inner tile
  b.add('tile', GEO.cyl, trs(cx, y + 0.02, cz, R * 2, 0.04, R * 2), 0x7fc6e6);
  const segs = 28;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const len = ((2 * Math.PI * (R + 0.3)) / segs) * 1.08;
    b.box('stone', cx + Math.cos(a) * (R + 0.3), y + rimH / 2, cz + Math.sin(a) * (R + 0.3), 0.6, rimH, len, 0xe2d9c6, -a);
    b.box('concrete', cx + Math.cos(a) * (R + 0.3), y + rimH + 0.05, cz + Math.sin(a) * (R + 0.3), 0.8, 0.1, len + 0.02, 0xf2ece0, -a);
  }
  // floor pass: the ring collider now includes the 10 cm coping (0.8 m wide) you walk along the rim on
  colliderRing(game, cx, y + (rimH + 0.1) / 2, cz, R + 0.3, rimH + 0.1, 0.8, 24);
  water.addCircle({ name: 'Drum-Dryer Fountain', kind: 'fountain', center: new THREE.Vector3(cx, y + rimH - 0.12, cz), radius: R, depth });
  // centerpiece: a giant stone front-loading washing machine on a plinth
  const my = y + 0.3;
  b.box('concrete', cx, my, cz, 3.2, 0.6, 3.2, 0xd8d0c0);
  b.box('stone', cx, my + 0.3 + 1.5, cz, 2.8, 3.0, 2.6, 0xeae4d8);
  b.box('concrete', cx, my + 0.3 + 3.0 + 0.08, cz, 2.9, 0.16, 2.7, 0xf6f2ea);
  b.box('metal', cx - 0.8, my + 0.3 + 2.75, cz + 1.31, 0.9, 0.22, 0.04, 0x9aa3ad); // control panel
  for (let i = 0; i < 3; i++) b.add('metal', GEO.cyl8, trs(cx + 0.4 + i * 0.3, my + 0.3 + 2.75, cz + 1.33, 0.14, 0.05, 0.14, 0, Math.PI / 2), 0x6f7b85);
  // porthole
  const ph = my + 0.3 + 1.35;
  b.add('metal', new THREE.TorusGeometry(0.85, 0.16, 10, 28), trs(cx, ph, cz + 1.32, 1, 1, 1), 0xc5ccd3, { uvTile: 0 });
  b.add('glass', GEO.cyl, trs(cx, ph, cz + 1.3, 1.7, 0.06, 1.7, 0, Math.PI / 2), 0x6fb8d6);
  colliderBox(game, cx, my + 1.8, cz, 2.8, 3.6, 2.6);
  const topY = my + 0.3 + 3.16;
  // "suds" jets from the top
  const jetMat = new THREE.MeshBasicMaterial({ color: 0xe8f7ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  const jb = new Batch(1e9);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      pts.push(new THREE.Vector3(Math.cos(a) * 3.6 * t, 2.2 * 4 * t * (1 - t) - 3.1 * t * t, Math.sin(a) * 3.6 * t));
    }
    jb.add('w', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.06, 6), null, 0xffffff, { uvTile: 0 });
  }
  const jets = jb.buildSingle(jetMat);
  jets.castShadow = false;
  jets.position.set(cx, topY, cz);
  jets.userData.noMerge = true;
  world.staticRoot.add(jets);
  // giant soap bars around the basin (bonus: climbable, and a stepping stone up to the machine)
  const soap = [0xf7b6cf, 0xa8dcf2, 0xb8ecc8, 0xfbe39a, 0xd9c4f2];
  const soapTex = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'SOAP', w / 2, h / 2, w - 30, 90, "'Luckiest Guy', sans-serif");
  });
  const soapMat = new THREE.MeshStandardMaterial({ map: soapTex, vertexColors: true, roughness: 0.35 });
  const sb = new Batch(1e9);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.6;
    const rr = R - 1.6;
    const x = Math.cos(a) * rr,
      z = Math.sin(a) * rr;
    const tilt = 0.35 + (i % 2) * 0.2;
    const geo = new THREE.BoxGeometry(2.2, 1.1, 1.4);
    sb.add('s', geo, trs(x, 0.7, z, 1, 1, 1, -a + Math.PI / 2, 0, tilt * (i % 2 ? 1 : -1)), soap[i], { uvTile: 0 });
    colliderBox(game, cx + x, y + 0.7, cz + z, 2.0, 1.0, 1.3, -a + Math.PI / 2, 0, tilt * (i % 2 ? 1 : -1));
  }
  const soaps = sb.buildSingle(soapMat);
  soaps.position.set(cx, y, cz);
  world.staticRoot.add(soaps);
  // bubbles drifting up
  const nb = 26;
  const bubMat = new THREE.MeshStandardMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, emissive: 0x9fd8ff, emissiveIntensity: 0.25, depthWrite: false });
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 8), bubMat, nb);
  bubbles.frustumCulled = false;
  bubbles.castShadow = false;
  bubbles.userData.noMerge = true;
  world.staticRoot.add(bubbles);
  const seeds = Array.from({ length: nb }, (_, i) => ({ a: Math.random() * Math.PI * 2, r: 1.5 + Math.random() * (R - 2), t: Math.random() * 6, s: 0.15 + Math.random() * 0.35 }));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const center = new THREE.Vector3(cx, y, cz);
  addAnimator(game, (dt, t, _n, g) => {
    const p = g.get<any>('player');
    if (p && p.position.distanceToSquared(center) > 110 * 110) return;
    jets.rotation.y += dt * 0.25;
    seeds.forEach((s, i) => {
      s.t += dt;
      const life = (s.t % 6) / 6;
      const yy = y + 0.6 + life * 7.5;
      const wob = Math.sin(t * 2 + i) * 0.3;
      v.set(cx + Math.cos(s.a + life) * s.r + wob, yy, cz + Math.sin(s.a + life) * s.r);
      const k = s.s * (life < 0.9 ? 1 : (1 - life) * 10);
      sc.setScalar(Math.max(0.001, k));
      m4.compose(v, q, sc);
      bubbles.setMatrixAt(i, m4);
    });
    bubbles.instanceMatrix.needsUpdate = true;
  });
  return topY;
}

function founderStatue(game: Game, world: World, b: Batch, x: number, y: number, z: number) {
  const f = new Frame(x, y, z, 0);
  f.box(b, 'stone', 0, 1.0, 0, 2.2, 2.0, 2.2, 0xd8cfbd);
  f.box(b, 'concrete', 0, 2.08, 0, 2.5, 0.16, 2.5, 0xeee7d8);
  f.box(b, 'concrete', 0, 0.1, 0, 2.6, 0.2, 2.6, 0xeee7d8);
  f.collider(game, 0, 1.1, 0, 2.3, 2.2, 2.3);
  const bronze = 0x5f7d6a; // weathered bronze-green
  const by = 2.16;
  // legs, coat, arms, head, top hat, and a sock held aloft
  for (const s of [-1, 1]) f.geo(b, 'metal', GEO.cyl8, s * 0.2, by + 0.55, 0, 0.26, 1.1, 0.26, bronze);
  f.geo(b, 'metal', GEO.cone, 0, by + 1.35, 0, 1.05, 1.6, 0.8, bronze);
  f.geo(b, 'metal', GEO.cyl8, 0, by + 1.95, 0, 0.62, 0.9, 0.5, bronze);
  f.geo(b, 'metal', GEO.sphere, 0, by + 2.6, 0.02, 0.44, 0.5, 0.44, bronze);
  f.geo(b, 'metal', GEO.cyl8, 0, by + 3.0, 0.02, 0.36, 0.5, 0.36, bronze);
  f.geo(b, 'metal', GEO.cyl, 0, by + 2.78, 0.02, 0.62, 0.05, 0.62, bronze);
  f.geo(b, 'metal', GEO.cyl8, -0.4, by + 1.85, 0.05, 0.16, 0.8, 0.16, bronze, 0, 0, -0.35);
  // raised arm: from the right shoulder up and out to the hand holding the sock (was tilted the wrong way,
  // slanting from beside his hip in toward his head)
  f.geo(b, 'metal', GEO.cyl8, 0.59, by + 2.53, 0.17, 0.16, 0.92, 0.16, bronze, 0, 0, -0.81);
  // the sock
  f.box(b, 'metal', 0.95, by + 3.05, 0.2, 0.22, 0.55, 0.2, bronze, 0, 0, 0.3);
  f.box(b, 'metal', 0.84, by + 2.78, 0.35, 0.22, 0.2, 0.36, bronze, 0, 0, 0.3);
  f.collider(game, 0, by + 1.5, 0, 1.0, 3.0, 0.8);
  // plaque
  const tex = canvasTexture(512, 192, (ctx, w, h) => {
    ctx.fillStyle = '#6b5a3a';
    roundRect(ctx, 0, 0, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = '#d9c38a';
    ctx.lineWidth = 6;
    roundRect(ctx, 8, 8, w - 16, h - 16, 8);
    ctx.stroke();
    ctx.fillStyle = '#f3e3b0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'EZEKIEL LINT', w / 2, h * 0.3, w - 40, 54, "'Lilita One', serif");
    fitText(ctx, 'FOUNDER · 1861', w / 2, h * 0.55, w - 40, 30, "'Nunito', sans-serif", '800');
    fitText(ctx, '"Where does the other one go?"', w / 2, h * 0.78, w - 40, 28, "'Nunito', sans-serif", 'italic 700');
  });
  const pp = f.p(0, 1.15, 1.12);
  signPanel(world, tex, pp.x, pp.y, pp.z, 1.6, 0.6, 0, { back: 0x6b5a3a, depth: 0.04, collide: false, batch: b });
}

function bikeRack(game: Game, world: World, mats: MatSet, b: Batch, x: number, y: number, z: number, r: () => number) {
  const f = new Frame(x, y, z, Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const lx = -2 + i;
    b.add('metal', new THREE.TorusGeometry(0.42, 0.035, 6, 14, Math.PI), f.mat(lx, 0.02, 0, 1, 1.4, 1, Math.PI / 2), 0x9aa3ad, { uvTile: 0 });
  }
  f.box(b, 'metal', 0, 0.02, 0, 5, 0.04, 0.12, 0x6f7b85);
  f.collider(game, 0, 0.3, 0, 5, 0.6, 0.2);
  // parked bikes (static decoration) + one loose bike to knock over
  const cols = [0x4b2a84, 0xe8b923, 0xd8342c, 0x2f8fd1, 0x3d8b3d];
  for (let i = 0; i < 4; i++) {
    if (r() < 0.35) continue;
    const lx = -1.5 + i;
    const bike = P.bicycle(mats, pick(r, cols));
    const obj = bike.object as THREE.Mesh;
    const m = f.mat(lx, 0.02, 0.35, 1, 1, 1, Math.PI / 2 + (r() - 0.5) * 0.1);
    obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox!;
    m.multiply(new THREE.Matrix4().makeTranslation(0, -bb.min.y, 0));
    b.add('metal', obj.geometry, m, 0xffffff, { uvTile: 0, keepColors: true });
  }
  const p = f.p(3.2, 0, 0.6);
  P.spawn(game, P.bicycle(mats, pick(r, cols)), p.x, y + 0.02, p.z, r() * 6);
}

function bench(game: Game, world: World, b: Batch, x: number, y: number, z: number, ry: number) {
  const f = new Frame(x, y, z, ry);
  f.box(b, 'wood', 0, 0.45, 0, 2.0, 0.08, 0.5, 0x7b5234);
  f.box(b, 'wood', 0, 0.78, -0.24, 2.0, 0.34, 0.06, 0x7b5234, 0, -0.12);
  for (const s of [-1, 1]) f.box(b, 'metal', s * 0.85, 0.24, 0, 0.08, 0.48, 0.5, 0x2b2f2e);
  f.collider(game, 0, 0.3, 0, 2.0, 0.6, 0.5);
}

function gothicLamp(game: Game, world: World, b: Batch, x: number, y: number, z: number) {
  b.add('metal', GEO.cyl8, trs(x, y + 0.25, z, 0.4, 0.5, 0.4), 0x2a2d33);
  b.add('metal', GEO.cyl8, trs(x, y + 2.0, z, 0.13, 3.6, 0.13), 0x2a2d33);
  b.box('lamp', x, y + 3.95, z, 0.34, 0.5, 0.34, 0xfff0c8);
  b.add('metal', GEO.cone4, trs(x, y + 4.4, z, 0.55, 0.45, 0.55), 0x2a2d33);
  world.collider(new THREE.Vector3(x, y + 2.2, z), new THREE.Vector3(0.25, 4.4, 0.25));
}

/**
 * Maintenance ladder up the library tower (bobblehead n2 sits on the tower roof, ~25 m up). Bare walls tire Jimothy
 * 4× faster than ladders, so the tower gets a steeplejack's iron ladder on its west face, in the nook where the tower
 * stands proud of the facade, ground to crenel gap. Tower dims mirror gothicHall's (7×7, top at h + 10, centre
 * d/2 − 3.5 + 1.2 = 3.7 local, h = 14, d = 12). Rails/rungs are thin visual boxes; the tower wall is the climb face.
 */
function libraryTowerLadder(world: World, b: Batch, lib: HallInfo) {
  const f = lib.frame;
  const th2 = lib.top + 10;
  const wx = -3.5; // tower west face (local x)
  const lz = 6.62; // proud of the facade line (6, so he clears the eave) and short of the corner pinnacle (7.2)
  const base = f.p(wx, 0, lz);
  const gy = world.heightAt(base.x, base.z) - lib.floorY;
  const IRON = 0xa3acb0; // galvanised: reads against the red brick from the quad
  const rx = wx - 0.1;
  const y0 = gy - 0.1;
  const y1 = th2 + 1.1; // rails poke above the parapet as grab handles
  for (const dz of [-0.26, 0.26]) {
    f.box(b, 'metal', rx, (y0 + y1) / 2, lz + dz, 0.11, y1 - y0, 0.11, IRON);
    // hooked grab-rail over the top
    f.box(b, 'metal', wx + 0.05, y1, lz + dz, 0.4, 0.11, 0.11, IRON);
  }
  for (let y = gy + 0.35; y < th2 + 0.2; y += 0.35) f.box(b, 'metal', rx, y, lz, 0.08, 0.07, 0.52, IRON);
  // stand-off brackets bolting it to the brick every few metres
  for (let y = gy + 1.5; y < th2; y += 3.2)
    for (const dz of [-0.26, 0.26]) f.box(b, 'metal', wx - 0.05, y, lz + dz, 0.12, 0.1, 0.1, IRON);
  // ladder volume: where his body is while climbing (wall face out to ~1.2 m, ±0.8 m along the wall, full height)
  const a = f.p(wx - 1.3, gy - 0.3, lz - 0.8);
  const c = f.p(wx + 0.3, th2 + 1.5, lz + 0.8);
  world.addLadder(new THREE.Vector3(Math.min(a.x, c.x), a.y, Math.min(a.z, c.z)), new THREE.Vector3(Math.max(a.x, c.x), c.y, Math.max(a.z, c.z)));
}

function hallPlaque(world: World, b: Batch, h: HallInfo, name: string) {
  const PW = Math.min(7.5, name.length * 0.42);
  // canvas aspect = plaque aspect (it used to be a fixed 1024×160, stretching the letters)
  const tex = canvasTexture(Math.min(2048, Math.round((160 * PW) / 0.9)), 160, (ctx, w, hh) => {
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(0, 0, w, hh);
    ctx.strokeStyle = '#b9ab8e';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, w - 12, hh - 12);
    ctx.fillStyle = '#5a4a36';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    fitText(ctx, name.split('').join(' '), w / 2, hh / 2 + 4, w - 60, 88, "'Lilita One', serif");
    ctx.restore();
  });
  const p = h.plaque.pos.clone();
  // Halls without a tower have buttresses along the facade (0.7 m proud, one right behind the plaque's middle):
  // mount the plaque across the buttress fronts instead of on the wall between them, where they hid its lettering.
  if (!h.towerTop) p.add(new THREE.Vector3(Math.sin(h.plaque.rotY), 0, Math.cos(h.plaque.rotY)).multiplyScalar(0.73));
  signPanel(world, tex, p.x, p.y, p.z, PW, 0.9, h.plaque.rotY, { back: 0xe6dcc6, depth: 0.08, collide: false, batch: b });
}

function entranceSign(game: Game, world: World, b: Batch, x: number, z: number) {
  const face = Math.atan2(60 - x, -60 - z); // toward the big intersection
  const W = 16;
  let maxG = -Infinity,
    minG = Infinity;
  const f0 = new Frame(x, 0, z, face);
  for (let i = -W / 2; i <= W / 2; i += 1) {
    const p = f0.p(i, 0, 0);
    const g = world.heightAt(p.x, p.z);
    maxG = Math.max(maxG, g);
    minG = Math.min(minG, g);
  }
  const f = new Frame(x, maxG, z, face);
  const yb = minG - maxG - 0.4;
  f.box(b, 'brick', 0, (yb + 2.4) / 2, 0, W, 2.4 - yb, 1.0, 0xc9785a);
  f.box(b, 'concrete', 0, 2.5, 0, W + 0.4, 0.22, 1.3, 0xe6dcc6);
  for (const s of [-1, 1]) {
    f.box(b, 'brick', s * (W / 2 + 0.6), (yb + 3.2) / 2, 0, 1.2, 3.2 - yb, 1.2, 0xc27052);
    f.geo(b, 'concrete', GEO.cone4, s * (W / 2 + 0.6), 3.8, 0, 1.3, 1.2, 1.3, 0xe6dcc6);
    f.box(b, 'concrete', s * (W / 2 + 0.6), 3.25, 0, 1.4, 0.14, 1.4, 0xe6dcc6);
  }
  f.collider(game, 0, (yb + 2.6) / 2, 0, W + 2.4, 2.6 - yb, 1.2);
  const tex = canvasTexture(2048, 320, (ctx, w, h) => {
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b9ab8e';
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    // crest: a shield with a sock and bubbles
    const cx = 170,
      cy = h / 2;
    ctx.fillStyle = PURPLE;
    ctx.beginPath();
    ctx.moveTo(cx - 90, cy - 110);
    ctx.lineTo(cx + 90, cy - 110);
    ctx.lineTo(cx + 90, cy + 10);
    ctx.quadraticCurveTo(cx + 80, cy + 90, cx, cy + 130);
    ctx.quadraticCurveTo(cx - 80, cy + 90, cx - 90, cy + 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.fillRect(cx - 18, cy - 70, 34, 90);
    ctx.beginPath();
    ctx.ellipse(cx + 8, cy + 30, 40, 26, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    for (const [bx, by, br] of [
      [cx - 50, cy - 60, 16],
      [cx + 52, cy - 40, 12],
      [cx + 40, cy - 80, 9],
    ]) {
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = PURPLE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'UNIVERSITY OF WASHING', w / 2 + 110, h * 0.4, w - 420, 150, "'Lilita One', serif");
    ctx.fillStyle = '#8a6a1a';
    fitText(ctx, 'EST. 1861   ·   LUX SIT LAUNDRY', w / 2 + 110, h * 0.78, w - 520, 64, "'Nunito', sans-serif", '900');
  });
  const pp = f.p(0, 1.35, 0.52);
  // face width = canvas aspect × height (it was W - 1.2 = 14.8 m wide, stretching the lettering ~20 %)
  signPanel(world, tex, pp.x, pp.y, pp.z, 1.9 * (2048 / 320), 1.9, face, { back: 0xe6dcc6, depth: 0.06, collide: false, lit: true, game, batch: b });
  // flower bed in front
  const fb = f.p(0, 0, 1.6);
  b.add('leaves', GEO.box, f.mat(0, maxG - f.y + 0.2, 1.6, W, 0.35, 1.4), 0x3f7a3a);
  const rr = rng(5);
  for (let i = 0; i < 26; i++) {
    const lx = -W / 2 + 0.4 + (i / 25) * (W - 0.8);
    b.add('leaves', GEO.ico0, f.mat(lx, 0.5, 1.6 + (rr() - 0.5) * 0.8, 0.35, 0.3, 0.35), pick(rr, [0xd6457a, 0x7b3fa0, 0xe8b923, 0xffffff]));
  }
  void fb;
}

/** Graduation stage with podium, banner, balloon arches, diploma table. Returns key heights for props. */
function gradStage(game: Game, world: World, mats: MatSet, b: Batch, x: number, z: number) {
  const SW = 16,
    SD = 7;
  const fp = footprint(world, x, z, SW, SD, 0, 1);
  const top = fp.max + 1.3;
  const f = new Frame(x, top, z, 0);
  const yb = fp.min - top - 0.2;
  // deck + skirt (purple, with gold trim); kit hideout under the stage (gap in the back-left skirt)
  f.box(b, 'cedar', 0, -0.1, 0, SW, 0.2, SD, 0xd9cbb8);
  f.collider(game, 0, -0.1, 0, SW, 0.2, SD);
  const skirt = 0x4b2a84;
  f.box(b, 'plain', 0, (yb - 0.2) / 2, SD / 2 - 0.05, SW, -yb - 0.2, 0.1, skirt);
  f.collider(game, 0, (yb - 0.2) / 2, SD / 2 - 0.05, SW, -yb - 0.2, 0.12);
  for (const s of [-1, 1]) {
    f.box(b, 'plain', (s * SW) / 2 - s * 0.05, (yb - 0.2) / 2, 0, 0.1, -yb - 0.2, SD, skirt);
    f.collider(game, (s * SW) / 2 - s * 0.05, (yb - 0.2) / 2, 0, 0.12, -yb - 0.2, SD);
  }
  // back skirt with an opening on the left (kit:4 hides under here)
  const gap0 = -SW / 2 + 1.6,
    gap1 = gap0 + 1.3;
  f.box(b, 'plain', (-SW / 2 + gap0) / 2, (yb - 0.2) / 2, -SD / 2 + 0.05, gap0 + SW / 2, -yb - 0.2, 0.1, skirt);
  f.box(b, 'plain', (gap1 + SW / 2) / 2, (yb - 0.2) / 2, -SD / 2 + 0.05, SW / 2 - gap1, -yb - 0.2, 0.1, skirt);
  f.collider(game, (-SW / 2 + gap0) / 2, (yb - 0.2) / 2, -SD / 2 + 0.05, gap0 + SW / 2, -yb - 0.2, 0.12);
  f.collider(game, (gap1 + SW / 2) / 2, (yb - 0.2) / 2, -SD / 2 + 0.05, SW / 2 - gap1, -yb - 0.2, 0.12);
  f.box(b, 'trim', 0, -0.25, SD / 2 + 0.01, SW + 0.05, 0.12, 0.05, 0xe8b923);
  const kp = f.p((gap0 + gap1) / 2 + 0.3, 0, -SD / 2 + 1.4);
  poi(world, 'kit:4', kp.x, world.heightAt(kp.x, kp.z) + 0.2, kp.z);
  // front steps (centered) — wide & shallow for the ceremony walk
  const fz = SD / 2;
  const footP = f.p(0, 0, fz + 2.2);
  const gl = world.heightAt(footP.x, footP.z) - top;
  const n = Math.max(2, Math.ceil(-gl / 0.2));
  const run = 0.4;
  for (let i = 0; i < n - 1; i++) {
    const t = -((i + 1) * -gl) / n;
    f.box(b, 'cedar', 0, (t + gl - 0.3) / 2, fz + run * (i + 0.5), 2.6, t - gl + 0.3, run + 0.02, 0xd9cbb8);
  }
  {
    const rise = -gl;
    const len = Math.hypot(n * run, rise);
    const ang = Math.atan2(rise, n * run);
    f.collider(game, 0, -rise / 2 - 0.12, fz + (n * run) / 2, 2.6, 0.24, len, 0, ang, 0);
  }
  // podium (front-left of center) — the dean stands behind it
  const podX = 0,
    podZ = -0.5;
  f.box(b, 'wood', podX, 0.6, podZ, 1.0, 1.2, 0.7, 0x6b4428);
  f.box(b, 'wood', podX, 1.25, podZ + 0.05, 1.15, 0.12, 0.85, 0x7b5234, 0, 0.25);
  f.collider(game, podX, 0.65, podZ, 1.0, 1.3, 0.7);
  const crest = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = PURPLE;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'U', w / 2, h * 0.42, w - 40, 150, "'Lilita One', serif");
    fitText(ctx, 'of WASHING', w / 2, h * 0.82, w - 30, 36, "'Nunito', sans-serif", '900');
  });
  const cp = f.p(podX, 0.62, podZ + 0.36);
  signPanel(world, crest, cp.x, cp.y, cp.z, 0.7, 0.7, 0, { collide: false, depth: 0.02, batch: b, back: 0x4b2a84 });
  poi(world, 'gradStage', ...(f.p(0, 0.05, 1.3).toArray() as [number, number, number]));
  poi(world, 'dean', ...(f.p(podX, 0.05, podZ - 0.85).toArray() as [number, number, number]));
  // diploma table
  const tX = 3.6,
    tZ = -0.8;
  f.box(b, 'plain', tX, 0.4, tZ, 2.2, 0.8, 0.8, 0x4b2a84);
  f.box(b, 'trim', tX, 0.82, tZ, 2.3, 0.06, 0.9, 0xf4f1ea);
  f.collider(game, tX, 0.42, tZ, 2.2, 0.84, 0.8);
  const tp = f.p(tX, 0, tZ);
  // banner frame + banner
  const BW = 13,
    BH = 3.2;
  const bz = -SD / 2 + 0.35;
  for (const s of [-1, 1]) {
    f.box(b, 'metal', (s * BW) / 2, (BH + 1.4) / 2, bz, 0.22, BH + 1.4, 0.22, 0x2b2f36);
    f.collider(game, (s * BW) / 2, (BH + 1.4) / 2, bz, 0.25, BH + 1.4, 0.25);
  }
  f.box(b, 'metal', 0, BH + 1.45, bz, BW + 0.4, 0.2, 0.22, 0x2b2f36);
  f.collider(game, 0, BH + 1.45, bz, BW + 0.4, 0.25, 0.4);
  const banner = canvasTexture(2048, 512, (ctx, w, h) => {
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#5a33a0');
    grd.addColorStop(1, '#3b1f6b');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 16;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = GOLD;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'CONGRATULATIONS CLASS OF 2026', w / 2, h * 0.3, w - 120, 150, "'Lilita One', serif");
    ctx.fillStyle = '#ffffff';
    fitText(ctx, '+ HONORARY GRADUATE: JIMOTHY', w / 2, h * 0.66, w - 160, 120, "'Luckiest Guy', sans-serif");
    // little raccoon faces
    for (const sx of [120, w - 120]) {
      ctx.fillStyle = '#9a9aa2';
      ctx.beginPath();
      ctx.arc(sx, h * 0.5, 60, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillRect(sx - 52, h * 0.5 - 22, 104, 30);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(sx - 22, h * 0.5 - 8, 8, 0, Math.PI * 2);
      ctx.arc(sx + 22, h * 0.5 - 8, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const bp = f.p(0, 1.4 + BH / 2, bz + 0.14);
  signPanel(world, banner, bp.x, bp.y, bp.z, BW - 0.3, BH, 0, { back: 0x3b1f6b, depth: 0.06, collide: true, lit: true, game, batch: b });
  // balloon arches (purple & gold)
  const bb = new Batch(1e9);
  for (const s of [-1, 1]) {
    const ax = (s * SW) / 2 + s * 0.2;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a = Math.PI * t;
      const bx = ax + Math.cos(a) * 1.2 * s * 0,
        by = 0.3 + Math.sin(a) * 3.2,
        bzz = SD / 2 - 3.0 + Math.cos(a) * 2.6;
      bb.add('b', GEO.sphere, f.mat(bx, by, bzz, 0.5, 0.58, 0.5), i % 2 ? 0x5a33a0 : 0xe8b923, { uvTile: 0 });
    }
  }
  const balloons = bb.buildSingle(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1 }));
  world.staticRoot.add(balloons);
  // stage lights (just glowing cans on the frame)
  for (let i = -2; i <= 2; i++) f.geo(b, 'lamp', GEO.cyl8, i * 2.6, BH + 1.2, bz + 0.3, 0.32, 0.3, 0.32, 0xfff4d0, 0, 0.8);
  return { top, tableX: tp.x, tableZ: tp.z };
}

/** Pink petal carpets under the cherry trees (terrain-conforming, merged into one mesh). */
function petalDecals(world: World, spots: [number, number][]) {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.pow(Math.random(), 0.7) * (w / 2 - 6);
      const x = w / 2 + Math.cos(a) * rr,
        y = h / 2 + Math.sin(a) * rr;
      ctx.fillStyle = `hsla(${335 + Math.random() * 20}, 80%, ${78 + Math.random() * 14}%, ${0.55 + Math.random() * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + Math.random() * 2, 2 + Math.random() * 1.5, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const b = new Batch(1e9);
  for (const [x, z] of spots) {
    const R = 3.2;
    const g = ribbon(world, [new THREE.Vector2(x - R, z), new THREE.Vector2(x + R, z)], -R, R, 0.06, { tile: 1, across: 5 });
    // remap uvs to 0..1 over the square
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - (x - R)) / (2 * R), (pos.getZ(i) - (z - R)) / (2 * R));
    b.add('p', g, null, 0xffffff, { uvTile: 0 });
  }
  const mesh = b.buildSingle(mat);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  world.staticRoot.add(mesh);
}

/** Falling cherry petals around the campus (CPU-updated points, only when the player is near). */
function fallingPetals(game: Game, world: World, center: THREE.Vector3, rx: number, rz: number) {
  const N = 420;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 2);
  const tex = canvasTexture(32, 32, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffd1e3';
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.42, h * 0.26, 0.6, 0, Math.PI * 2);
    ctx.fill();
  });
  const reset = (i: number, anywhere: boolean) => {
    const x = center.x + (Math.random() * 2 - 1) * rx;
    const z = center.z + (Math.random() * 2 - 1) * rz;
    const g = world.heightAt(x, z);
    pos[i * 3] = x;
    pos[i * 3 + 1] = g + (anywhere ? Math.random() * 7 : 6 + Math.random() * 2);
    pos[i * 3 + 2] = z;
    vel[i * 2] = 0.3 + Math.random() * 0.5;
    vel[i * 2 + 1] = Math.random() * 10;
  };
  for (let i = 0; i < N; i++) reset(i, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, size: 0.22, sizeAttenuation: true, transparent: true, depthWrite: false, alphaTest: 0.2, color: 0xffffff }));
  pts.frustumCulled = false;
  pts.userData.noMerge = true;
  world.staticRoot.add(pts);
  const attr = geo.getAttribute('position') as THREE.BufferAttribute;
  addAnimator(game, (dt, t, _n, g) => {
    const p = g.get<any>('player');
    const far = !p || Math.abs(p.position.x - center.x) > rx + 70 || Math.abs(p.position.z - center.z) > rz + 70;
    pts.visible = !far;
    if (far) return;
    for (let i = 0; i < N; i++) {
      const k = i * 3;
      pos[k + 1] -= vel[i * 2] * dt;
      const ph = vel[i * 2 + 1];
      pos[k] += Math.sin(t * 1.3 + ph) * 0.6 * dt + 0.25 * dt;
      pos[k + 2] += Math.cos(t * 1.1 + ph) * 0.5 * dt;
      if (pos[k + 1] < world.heightAt(pos[k], pos[k + 2])) reset(i, false);
    }
    attr.needsUpdate = true;
  });
}
