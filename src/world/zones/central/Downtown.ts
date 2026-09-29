import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World, ZoneBuilder } from '../../World';
import type { WaterSystem } from '../../Water';
import { Batch, mergeColored, T, TR } from './lib/batch';
import { roadMaterials, SurfaceBuilder, gridRun, makeGrid, walkY, type CellKind } from './lib/roadkit';
import { trimMat, darkGlassMat, windowMats } from './lib/buildings';
import { bench, furnMat, historicLamp, lightPools, placeInstances, placeBatched, planter, streetTree, treeGrate, warmGlowMat, lampGlassMat, bikeRack, type Xf } from './lib/furniture';
import { spawnTrashCan, spawnFoldingChair } from './lib/props';
import { loadFonts, sharedAtlas, type AtlasRect } from './lib/signs';
import { drawFriezeBanner, drawVerticalBanner, drawFlag, FLAG_COUNT, drawStatuePlaque, drawCitySeal, drawNoodleSign, drawCafeSign, drawLobbySign, drawNewsVanLogo } from './lib/civicart';
import { ashlarTexture, cached, towerTexture } from './lib/textures';
import { loadMerged } from './lib/models';
import { cylinderCollider, glowAtNight, onFrame, Rng, trimeshFromGeometry, boxColliderEuler } from './lib/util';
import { terrainHeight } from '../../terrain';
import { RAPIER, G, groups } from '../../../core/Physics';
import { addNightRig } from '../south/nightLight';

/**
 * E — Downtown: the Civic Plaza with its fountain and the bronze Jimothy statue, City Hall (grand steps,
 * columns, podium + microphone, "JIMOTHY SUMMER — Official Proclamation" banner, flags), glass office towers
 * with climbable setbacks, and the Space Noodle: a ~75 m twisty noodle tower with rest ledges every 15 m,
 * a maintenance hatch on its east side and a flying-saucer top deck.
 */

const Z = { x0: 66, x1: 174, z0: -54, z1: 54 };
const PARK = { x0: 128, x1: 174, z0: -54, z1: -22 };
const NOODLE = { x: 150, z: -38 };
const NOODLE_PLAZA = { x0: 139, x1: 161, z0: -49, z1: -27 };
const FOUNTAIN = { x: 82, z: 0, r: 6.2 };
const STATUE = { x: 98, z: 0 };
const CH = { x0: 126, x1: 162, z0: -16, z1: 16, base: 2.0, stepsX0: 115 };

export const Downtown: ZoneBuilder = {
  name: 'Downtown',
  async build(game: Game, world: World) {
    await loadFonts();
    const mats = await roadMaterials(game);
    const batch = new Batch('downtown', 120);
    _game = game;
    const rng = new Rng(4242);
    world.areas.push({ name: 'Downtown', min: new THREE.Vector2(60, -60), max: new THREE.Vector2(180, 60) });

    buildGround(game, batch, mats);
    buildFountain(game, world, batch);
    await buildStatue(game, world, batch);
    buildCityHall(game, world, batch);
    buildCityHallNightLights(game, world, batch);
    buildTowers(game, world, batch, rng);
    buildNoodle(game, world, batch);
    await buildPlazaDecor(game, world, batch, rng);

    // ---------------------------------------------------------------- NPCs
    const y0 = walkY(90, 0);
    world.npcSpawns.push({ zone: 'Downtown', center: new THREE.Vector3(94, y0, 0), radius: 17, count: 8, types: ['pedestrian', 'tourist', 'fan'] });
    world.npcSpawns.push({ zone: 'Downtown', center: new THREE.Vector3(STATUE.x - 2, y0, 6.5), radius: 4, count: 1, types: ['officer'] });
    // a superfan who always hangs around the (only) Wildlife Officer, so 'Please Don't Approach Jimothy' is doable
    // (the random plaza crowd has no fans in ~1 of 5 games)
    world.npcSpawns.push({ zone: 'Downtown', center: new THREE.Vector3(STATUE.x + 3, y0, 8), radius: 4, count: 1, types: ['fan'] });
    world.npcSpawns.push({ zone: 'Downtown', center: new THREE.Vector3(108, y0, 0), radius: 4, count: 3, types: ['fan', 'tourist'] });
    world.npcSpawns.push({ zone: 'Downtown', center: new THREE.Vector3(NOODLE.x - 9, walkY(NOODLE.x - 9, NOODLE.z), NOODLE.z), radius: 8, count: 4, types: ['tourist', 'pedestrian', 'fan'] });
    for (const z of [-24, 24]) {
      const path: THREE.Vector3[] = [];
      for (let x = 70; x <= 170; x += 10) path.push(new THREE.Vector3(x, walkY(x, z), z));
      world.npcSpawns.push({ zone: 'Downtown', center: path[5].clone(), radius: 5, count: 3, types: ['pedestrian', 'jogger', 'tourist'], path });
    }

    batch.flush(world.staticRoot);
  },
};

// ============================================================================================ ground

function buildGround(game: Game, batch: Batch, mats: Awaited<ReturnType<typeof roadMaterials>>) {
  const sb = new SurfaceBuilder();
  const inPark = (x: number, z: number) => x > PARK.x0 && x < PARK.x1 && z > PARK.z0 && z < PARK.z1;
  const classify = (x: number, d: number): CellKind | null => {
    const z = d;
    if (inPark(x, z)) {
      if (x > NOODLE_PLAZA.x0 && x < NOODLE_PLAZA.x1 && z > NOODLE_PLAZA.z0 && z < NOODLE_PLAZA.z1) return 'paver';
      if (Math.abs(z - NOODLE.z) < 1.6 && x < NOODLE.x) return 'paver';
      if (Math.abs(x - NOODLE.x) < 1.6 && z > NOODLE.z) return 'paver';
      return null;
    }
    // warm granite band around the fountain + statue axis
    if (x > 70 && x < 114 && Math.abs(z) < 3.2) return 'paver';
    return 'walk';
  };
  const sBreaks = [PARK.x0, NOODLE_PLAZA.x0, NOODLE_PLAZA.x1, NOODLE.x - 1.6, NOODLE.x + 1.6, 70, 114];
  const dBreaks = [PARK.z0, PARK.z1, NOODLE_PLAZA.z0, NOODLE_PLAZA.z1, NOODLE.z - 1.6, NOODLE.z + 1.6, -3.2, 3.2];
  gridRun(sb, { axis: 'x', c: 0 }, makeGrid(Z.x0, Z.x1, 3, sBreaks), makeGrid(Z.z0, Z.z1, 3, dBreaks), classify, { skirtEnds: true });
  sb.finish(game, batch, mats);
}

// ============================================================================================ fountain

function buildFountain(game: Game, world: World, batch: Batch) {
  const water = game.get<WaterSystem>('water');
  const { x, z } = FOUNTAIN;
  const y = walkY(x, z);
  const stone = stoneMat();
  const rIn = 5.6,
    rOut = FOUNTAIN.r,
    rimH = 0.75;
  // rim as a lathe (inner wall, top, outer wall)
  const rim = new THREE.LatheGeometry(
    [new THREE.Vector2(rIn, 0), new THREE.Vector2(rIn, rimH), new THREE.Vector2(rIn + 0.05, rimH + 0.06), new THREE.Vector2(rOut - 0.05, rimH + 0.06), new THREE.Vector2(rOut, rimH), new THREE.Vector2(rOut + 0.1, 0.1), new THREE.Vector2(rOut + 0.1, 0)].reverse(),
    48,
  );
  batch.add(rim, stone, { matrix: T(x, y, z), uv: 1.6 });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    world.collider(new THREE.Vector3(x + Math.cos(a) * ((rIn + rOut) / 2), y + rimH / 2, z + Math.sin(a) * ((rIn + rOut) / 2)), new THREE.Vector3(1.95, rimH + 0.06, rOut - rIn), -a + Math.PI / 2);
  }
  // blue tiled basin floor
  const tile = trimMat();
  batch.add(new THREE.CircleGeometry(rIn, 40).rotateX(-Math.PI / 2), tile, { matrix: T(x, y + 0.012, z), castShadow: false, color: 0x3fa7c9 });
  if (water) water.addCircle({ name: 'City Hall Fountain', kind: 'fountain', center: new THREE.Vector3(x, y + 0.62, z), radius: rIn - 0.05, depth: 0.62 });
  // tiered centre piece
  const tiers = mergeColored([
    { geo: new THREE.CylinderGeometry(0.75, 0.95, 1.3, 16), color: 0xe9e1d0, matrix: T(0, 0.65, 0) },
    { geo: new THREE.CylinderGeometry(2.3, 1.0, 0.45, 28), color: 0xefe8da, matrix: T(0, 1.5, 0) },
    { geo: new THREE.CylinderGeometry(0.35, 0.45, 1.1, 12), color: 0xe9e1d0, matrix: T(0, 2.25, 0) },
    { geo: new THREE.CylinderGeometry(1.25, 0.5, 0.35, 22), color: 0xefe8da, matrix: T(0, 2.95, 0) },
    { geo: new THREE.CylinderGeometry(0.16, 0.22, 0.7, 10), color: 0xe9e1d0, matrix: T(0, 3.45, 0) },
    { geo: new THREE.SphereGeometry(0.32, 14, 10), color: 0xd9a93c, matrix: T(0, 3.95, 0) },
  ]);
  batch.add(tiers, trimMat(), { matrix: T(x, y, z) });
  cylinderCollider(game, new THREE.Vector3(x, y + 0.65, z), 0.95, 1.3);
  cylinderCollider(game, new THREE.Vector3(x, y + 1.5, z), 2.3, 0.45);
  cylinderCollider(game, new THREE.Vector3(x, y + 2.25, z), 0.45, 1.1);
  cylinderCollider(game, new THREE.Vector3(x, y + 2.95, z), 1.25, 0.35);
  // water in the bowls + falling sheets
  const splash = cached('mat:fountainWater', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.55, roughness: 0.05, emissive: 0x3aa0c8, emissiveIntensity: 0.15, depthWrite: false });
    return m;
  });
  const sheets = mergeColored([
    { geo: new THREE.CylinderGeometry(2.1, 2.1, 0.05, 28), color: 0xffffff, matrix: T(0, 1.7, 0) },
    { geo: new THREE.CylinderGeometry(1.1, 1.1, 0.05, 22), color: 0xffffff, matrix: T(0, 3.1, 0) },
    { geo: new THREE.CylinderGeometry(2.25, 2.3, 1.1, 28, 1, true), color: 0xffffff, matrix: T(0, 1.18, 0) },
    { geo: new THREE.CylinderGeometry(1.2, 1.28, 1.2, 22, 1, true), color: 0xffffff, matrix: T(0, 2.4, 0) },
    { geo: new THREE.CylinderGeometry(0.05, 0.12, 0.9, 8), color: 0xffffff, matrix: T(0, 4.5, 0) },
  ]);
  batch.add(sheets, splash, { matrix: T(x, y, z), castShadow: false });
  world.poi.set('fountainDowntown', new THREE.Vector3(x + rOut + 1.2, y, z));
  // kit:2 is splashing around in the top bowl
  world.poi.set('kit:2', new THREE.Vector3(x + 0.5, y + 3.25, z));
}

let _game: Game | null = null;
/** Civic stone (ashlar) — gently 'floodlit' at night via emissive. */
function stoneMat() {
  return cached('mat:stone', () => {
    const tex = ashlarTexture();
    const m = new THREE.MeshStandardMaterial({ map: tex, color: 0xf4efe4, roughness: 0.85, emissive: 0xffd9a0, emissiveMap: tex, emissiveIntensity: 0 });
    if (_game) glowAtNight(_game, m, 0, 0.16);
    return m;
  });
}

// ============================================================================================ statue

async function buildStatue(game: Game, world: World, batch: Batch) {
  const atlas = sharedAtlas(game);
  const { x, z } = STATUE;
  const y = walkY(x, z);
  const stone = stoneMat();
  const PL = { w: 6.4, h: 2.4, d: 3.6 };
  batch.add(new THREE.BoxGeometry(PL.w + 0.8, 0.3, PL.d + 0.8), stone, { matrix: T(x, y + 0.15, z), uv: 1.6 });
  batch.add(new THREE.BoxGeometry(PL.w, PL.h, PL.d), stone, { matrix: T(x, y + 0.3 + PL.h / 2, z), uv: 1.6 });
  batch.add(new THREE.BoxGeometry(PL.w + 0.4, 0.25, PL.d + 0.4), stone, { matrix: T(x, y + 0.3 + PL.h + 0.12, z), uv: 1.6 });
  world.collider(new THREE.Vector3(x, y + 0.15, z), new THREE.Vector3(PL.w + 0.8, 0.3, PL.d + 0.8));
  world.collider(new THREE.Vector3(x, y + 0.3 + (PL.h + 0.25) / 2, z), new THREE.Vector3(PL.w + 0.4, PL.h + 0.25, PL.d + 0.4));
  const top = y + 0.3 + PL.h + 0.25;
  const plaque = atlas.draw(512, 256, (ctx, w, h) => drawStatuePlaque(ctx, w, h));
  const brass = cached('mat:statuePlaque', () => new THREE.MeshStandardMaterial({ map: plaque.page.texture, roughness: 0.35, metalness: 0.6 }));
  batch.add(atlas.quad(plaque, 2.0, 1.0), brass, { matrix: T(x - PL.w / 2 - 0.01, y + 0.3 + PL.h / 2, z, -Math.PI / 2), castShadow: false });

  const bronze = cached('mat:bronze', () => new THREE.MeshStandardMaterial({ color: 0xb4793a, metalness: 0.85, roughness: 0.32, envMapIntensity: 2.2 }));
  const S = 4;
  const model = await loadMerged(game, 'assets/models/jimothy.glb');
  // statue faces west (toward Old Ballard); model forward is +Z
  const yaw = -Math.PI / 2;
  let bodyR = 1.5;
  let headTop = top + 3.2;
  const headXZ = new THREE.Vector3(x, 0, z);
  if (model) {
    const minY = model.min.y;
    const oy = top - minY * S + 0.02;
    // shift so the whole thing (incl. tail) sits over the plinth
    const zc = (model.min.z + model.min.z + model.size.z) / 2;
    const M = T(x, oy, z, yaw, S).multiply(T(0, 0, -zc));
    for (const p of model.parts) batch.add(p.geo, bronze, { matrix: M });
    bodyR = Math.max(model.size.x, 0.8) * S * 0.5;
    headTop = oy + (model.min.y + model.size.y) * S;
    const body = new THREE.Vector3(0, 0, 0).applyMatrix4(M);
    headXZ.set(body.x, 0, body.z);
    // one cylinder as tall as the statue, so things (and bobbleheads) can sit on its head
    cylinderCollider(game, body.clone().setY((top + headTop) / 2), bodyR * 0.95, headTop - top);
  } else {
    // primitive fallback: a bronze ball with ears, mask band and ringed tail
    const parts = mergeColored([
      { geo: new THREE.SphereGeometry(1.5, 24, 18), color: 0xffffff, matrix: T(0, 1.5, 0) },
      { geo: new THREE.SphereGeometry(0.35, 12, 8), color: 0xffffff, matrix: T(0.8, 2.8, 0.4) },
      { geo: new THREE.SphereGeometry(0.35, 12, 8), color: 0xffffff, matrix: T(-0.8, 2.8, 0.4) },
      { geo: new THREE.TorusGeometry(1.35, 0.14, 8, 30, Math.PI), color: 0xcccccc, matrix: TR(0, 1.8, 0.2, 0.2, 0, 0) },
      ...[0, 1, 2, 3, 4].map((k) => ({ geo: new THREE.SphereGeometry(0.45 - k * 0.04, 12, 8), color: k % 2 ? 0x999999 : 0xffffff, matrix: T(0, 0.9 + k * 0.25, -1.4 - k * 0.45) })),
    ]);
    batch.add(parts, bronze, { matrix: T(x, top, z, yaw) });
    cylinderCollider(game, new THREE.Vector3(x, top + 1.5, z), 1.45, 3.0);
    headTop = top + 3.2;
  }
  // little floodlights
  const glow = lampGlassMat(game);
  for (const dz of [-2.4, 2.4]) {
    batch.add(new THREE.CylinderGeometry(0.18, 0.22, 0.25, 10), furnMat(), { matrix: T(x - 4.2, y + 0.12, z + dz), color: 0x2d3035 });
    batch.add(new THREE.CircleGeometry(0.15, 10).rotateX(-Math.PI / 2), glow, { matrix: T(x - 4.2, y + 0.26, z + dz), castShadow: false });
  }
  world.poi.set('jimothyStatue', new THREE.Vector3(x - PL.w / 2 - 2.2, y, z));
  world.poi.set('bobblehead:e3', new THREE.Vector3(headXZ.x, headTop + 0.25, headXZ.z));
}

// ============================================================================================ city hall

function buildCityHall(game: Game, world: World, batch: Batch) {
  const atlas = sharedAtlas(game);
  const y0 = walkY(CH.x0, 0);
  const stone = stoneMat();
  const trim = trimMat();
  const baseTop = y0 + CH.base;
  const cz = (CH.z0 + CH.z1) / 2;
  // stylobate
  batch.add(new THREE.BoxGeometry(CH.x1 - CH.x0, CH.base, CH.z1 - CH.z0), stone, { matrix: T((CH.x0 + CH.x1) / 2, y0 + CH.base / 2, cz), uv: 2.4 });
  world.collider(new THREE.Vector3((CH.x0 + CH.x1) / 2, y0 + CH.base / 2, cz), new THREE.Vector3(CH.x1 - CH.x0, CH.base, CH.z1 - CH.z0));
  // grand steps (10 × 0.2 m) + invisible ramp so walking up is smooth
  const nSteps = 10;
  const stepW = 26;
  for (let k = 0; k < nSteps; k++) {
    const x0 = CH.stepsX0 + k * ((CH.x0 - CH.stepsX0) / nSteps);
    const run = (CH.x0 - CH.stepsX0) / nSteps;
    const h = (CH.base / nSteps) * (k + 1);
    batch.add(new THREE.BoxGeometry(run, h, stepW), stone, { matrix: T(x0 + run / 2, y0 + h / 2, 0), uv: 2.4 });
    world.collider(new THREE.Vector3(x0 + run / 2, y0 + h / 2, 0), new THREE.Vector3(run, h, stepW));
  }
  {
    const len = Math.hypot(CH.x0 - CH.stepsX0, CH.base);
    const ang = Math.atan2(CH.base, CH.x0 - CH.stepsX0);
    const mid = new THREE.Vector3((CH.stepsX0 + CH.x0) / 2, y0 + CH.base / 2 + 0.2 - 0.15 / Math.cos(ang), 0);
    boxColliderEuler(game, mid, new THREE.Vector3(len, 0.3, stepW), 0, 0, ang);
  }
  // cheek walls with planters at both sides of the steps
  for (const s of [-1, 1]) {
    batch.add(new THREE.BoxGeometry(CH.x0 - CH.stepsX0, CH.base + 0.5, 1.2), stone, { matrix: T((CH.stepsX0 + CH.x0) / 2, y0 + (CH.base + 0.5) / 2, s * (stepW / 2 + 0.6)), uv: 2.4 });
    world.collider(new THREE.Vector3((CH.stepsX0 + CH.x0) / 2, y0 + (CH.base + 0.5) / 2, s * (stepW / 2 + 0.6)), new THREE.Vector3(CH.x0 - CH.stepsX0, CH.base + 0.5, 1.2));
  }
  // columns
  const colX = CH.x0 + 2.4;
  const colH = 9;
  const colGeo = mergeColored([
    { geo: new THREE.BoxGeometry(1.4, 0.35, 1.4), color: 0xefe8da, matrix: T(0, 0.175, 0) },
    { geo: new THREE.CylinderGeometry(0.62, 0.66, 0.25, 20), color: 0xefe8da, matrix: T(0, 0.47, 0) },
    { geo: new THREE.CylinderGeometry(0.5, 0.56, colH - 1.1, 16), color: 0xf6f1e6, matrix: T(0, 0.6 + (colH - 1.1) / 2, 0) },
    { geo: new THREE.CylinderGeometry(0.7, 0.52, 0.4, 16), color: 0xefe8da, matrix: T(0, colH - 0.45, 0) },
    { geo: new THREE.BoxGeometry(1.5, 0.3, 1.5), color: 0xefe8da, matrix: T(0, colH - 0.15, 0) },
  ]);
  const zs: number[] = [];
  for (let k = 0; k < 8; k++) zs.push(-10.5 + k * 3);
  for (const cz2 of zs) {
    batch.add(colGeo, trim, { matrix: T(colX, baseTop, cz2) });
    cylinderCollider(game, new THREE.Vector3(colX, baseTop + colH / 2, cz2), 0.6, colH);
  }
  // entablature + frieze banner + pediment
  const entX0 = CH.x0 + 1.2,
    entX1 = CH.x0 + 8.5;
  const entY = baseTop + colH;
  batch.add(new THREE.BoxGeometry(entX1 - entX0, 1.5, 25), stone, { matrix: T((entX0 + entX1) / 2, entY + 0.75, 0), uv: 2.4 });
  world.collider(new THREE.Vector3((entX0 + entX1) / 2, entY + 0.75, 0), new THREE.Vector3(entX1 - entX0, 1.5, 25));
  batch.add(new THREE.BoxGeometry(entX1 - entX0 + 0.4, 0.3, 25.6), trim, { matrix: T((entX0 + entX1) / 2, entY + 1.6, 0), color: 0xefe8da });
  const frieze = atlas.draw(1024, 96, (ctx, w, h) => drawFriezeBanner(ctx, w, h));
  batch.add(atlas.quad(frieze, 17, 1.6), frieze.page.glowMat, { matrix: T(entX0 - 0.03, entY + 0.72, 0, -Math.PI / 2), castShadow: false });
  // pediment (triangular prism)
  const tri = new THREE.Shape();
  tri.moveTo(-12.8, 0);
  tri.lineTo(12.8, 0);
  tri.lineTo(0, 3.6);
  tri.closePath();
  const ped = new THREE.ExtrudeGeometry(tri, { depth: entX1 - entX0, bevelEnabled: false });
  batch.add(ped, stone, { matrix: T(entX0, entY + 1.75, 0, Math.PI / 2), uv: 2.4 });
  boxColliderEuler(game, new THREE.Vector3((entX0 + entX1) / 2, entY + 2.6, 0), new THREE.Vector3(entX1 - entX0, 1.6, 18));
  const seal = atlas.draw(256, 256, (ctx, w, h) => drawCitySeal(ctx, w, h));
  batch.add(atlas.quad(seal, 2.2, 2.2), seal.page.mat, { matrix: T(entX0 - 0.02, entY + 3.0, 0, -Math.PI / 2), castShadow: false });

  // main block
  const mbX0 = CH.x0 + 6,
    mbH = 14;
  const mbCx = (mbX0 + CH.x1) / 2;
  batch.add(new THREE.BoxGeometry(CH.x1 - mbX0, mbH, CH.z1 - CH.z0), stone, { matrix: T(mbCx, baseTop + mbH / 2, cz), uv: 2.4 });
  world.collider(new THREE.Vector3(mbCx, baseTop + mbH / 2, cz), new THREE.Vector3(CH.x1 - mbX0, mbH, CH.z1 - CH.z0));
  batch.add(new THREE.BoxGeometry(CH.x1 - mbX0 + 0.8, 0.6, CH.z1 - CH.z0 + 0.8), trim, { matrix: T(mbCx, baseTop + mbH - 0.1, cz), color: 0xefe8da });
  batch.add(new THREE.BoxGeometry(CH.x1 - mbX0, 1.0, 0.4), stone, { matrix: T(mbCx, baseTop + mbH + 0.5, CH.z0 + 0.2), uv: 2.4 });
  batch.add(new THREE.BoxGeometry(CH.x1 - mbX0, 1.0, 0.4), stone, { matrix: T(mbCx, baseTop + mbH + 0.5, CH.z1 - 0.2), uv: 2.4 });
  batch.add(new THREE.BoxGeometry(0.4, 1.0, CH.z1 - CH.z0), stone, { matrix: T(CH.x1 - 0.2, baseTop + mbH + 0.5, cz), uv: 2.4 });
  batch.add(new THREE.BoxGeometry(0.4, 1.0, CH.z1 - CH.z0), stone, { matrix: T(mbX0 + 0.2, baseTop + mbH + 0.5, cz), uv: 2.4 });
  world.collider(new THREE.Vector3(mbCx, baseTop + mbH + 0.5, CH.z0 + 0.2), new THREE.Vector3(CH.x1 - mbX0, 1, 0.4));
  world.collider(new THREE.Vector3(mbCx, baseTop + mbH + 0.5, CH.z1 - 0.2), new THREE.Vector3(CH.x1 - mbX0, 1, 0.4));
  world.collider(new THREE.Vector3(CH.x1 - 0.2, baseTop + mbH + 0.5, cz), new THREE.Vector3(0.4, 1, CH.z1 - CH.z0));
  world.collider(new THREE.Vector3(mbX0 + 0.2, baseTop + mbH + 0.5, cz), new THREE.Vector3(0.4, 1, CH.z1 - CH.z0));
  batch.add(new THREE.BoxGeometry(CH.x1 - mbX0 - 0.8, 0.05, CH.z1 - CH.z0 - 0.8), trim, { matrix: T(mbCx, baseTop + mbH + 0.03, cz), color: 0x6d6f73, castShadow: false });
  // windows on all sides (two tall rows)
  const win = windowMats(game);
  const glass = darkGlassMat();
  const rw = new Rng(8);
  const winAt = (M: THREE.Matrix4) => {
    batch.add(new THREE.PlaneGeometry(1.5, 3.2), rw.chance(0.45) ? win.lit : win.dark, { matrix: M, castShadow: false });
    batch.add(new THREE.BoxGeometry(1.9, 0.18, 0.25), trim, { matrix: M.clone().multiply(T(0, -1.7, 0.1)), color: 0xefe8da });
    batch.add(new THREE.BoxGeometry(2.0, 0.35, 0.18), trim, { matrix: M.clone().multiply(T(0, 1.8, 0.05)), color: 0xefe8da });
  };
  for (const row of [0, 1]) {
    const wy = baseTop + 3.2 + row * 6;
    for (let x = mbX0 + 3; x < CH.x1 - 2; x += 4) {
      winAt(T(x, wy, CH.z1 + 0.03));
      winAt(T(x, wy, CH.z0 - 0.03, Math.PI));
    }
    for (let z = CH.z0 + 3; z < CH.z1 - 2; z += 4) {
      if (Math.abs(z) < 12.5) {
        if (row === 1 && Math.abs(z) > 2.5) winAt(T(mbX0 - 0.03, wy, z, -Math.PI / 2));
        continue;
      }
      winAt(T(mbX0 - 0.03, wy, z, -Math.PI / 2));
    }
    for (let z = CH.z0 + 3; z < CH.z1 - 2; z += 4) winAt(T(CH.x1 + 0.03, wy, z, Math.PI / 2));
  }
  // bronze doors + fanlight
  batch.add(new THREE.BoxGeometry(0.2, 5.6, 4.4), trim, { matrix: T(mbX0 - 0.05, baseTop + 2.8, 0), color: 0x6b4a1e });
  batch.add(new THREE.BoxGeometry(0.1, 5.2, 0.12), trim, { matrix: T(mbX0 - 0.17, baseTop + 2.6, 0), color: 0x3a2a10 });
  batch.add(new THREE.CircleGeometry(2.1, 20, 0, Math.PI), glass, { matrix: T(mbX0 - 0.03, baseTop + 5.7, 0, -Math.PI / 2), castShadow: false });
  // vertical banners flanking the door
  for (const [i, s] of [[0, -1], [1, 1]] as const) {
    const vb = atlas.draw(160, 448, (ctx, w, h) => drawVerticalBanner(ctx, w, h, i));
    batch.add(atlas.quad(vb, 2.2, 6.2), vb.page.glowMat, { matrix: T(mbX0 - 0.04, baseTop + 7.2, s * 5.2, -Math.PI / 2), castShadow: false });
  }
  // dome: drum, dome, lantern
  const dx = mbCx + 1,
    dz = 0;
  const drumY = baseTop + mbH + 1.0;
  batch.add(new THREE.CylinderGeometry(6, 6, 3.5, 40), stone, { matrix: T(dx, drumY + 1.75, dz), uv: 2.4 });
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    batch.add(new THREE.PlaneGeometry(0.8, 2.2), glass, { matrix: T(dx + Math.cos(a) * 6.02, drumY + 1.75, dz + Math.sin(a) * 6.02, -a + Math.PI / 2), castShadow: false });
  }
  const gold = cached('mat:domeGold', () => glowAtNight(game, new THREE.MeshStandardMaterial({ color: 0xe0b04a, metalness: 0.75, roughness: 0.3, envMapIntensity: 2, emissive: 0xd99a2b, emissiveIntensity: 0 }), 0, 0.3));
  batch.add(new THREE.SphereGeometry(6.2, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), gold, { matrix: T(dx, drumY + 3.5, dz) });
  batch.add(new THREE.TorusGeometry(6.1, 0.18, 8, 48), trim, { matrix: TR(dx, drumY + 3.5, dz, Math.PI / 2, 0, 0), color: 0xefe8da });
  batch.add(
    mergeColored([
      { geo: new THREE.CylinderGeometry(1.1, 1.1, 2.0, 16), color: 0xf6f1e6, matrix: T(0, 1.0, 0) },
      { geo: new THREE.SphereGeometry(1.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), color: 0xe0b04a, matrix: T(0, 2.0, 0) },
      { geo: new THREE.CylinderGeometry(0.06, 0.1, 2.2, 8), color: 0xe0b04a, matrix: T(0, 4.0, 0) },
      { geo: new THREE.SphereGeometry(0.28, 12, 8), color: 0xe0b04a, matrix: T(0, 5.2, 0) },
    ]),
    trim,
    { matrix: T(dx, drumY + 3.5 + 6.0, dz) },
  );
  cylinderCollider(game, new THREE.Vector3(dx, drumY + 1.75, dz), 6, 3.5);
  sphereCollider(game, new THREE.Vector3(dx, drumY + 3.5, dz), 6.2);
  cylinderCollider(game, new THREE.Vector3(dx, drumY + 3.5 + 6.0 + 1.0, dz), 1.1, 2.0);
  world.poi.set('bobblehead:e2', new THREE.Vector3(dx - 2.4, drumY + 3.5 + Math.sqrt(6.2 * 6.2 - 2.4 * 2.4) + 0.3, dz));

  // podium riser, lectern + microphone on the portico
  const px = CH.x0 + 4.6;
  batch.add(new THREE.BoxGeometry(2.6, 0.3, 3.0), trim, { matrix: T(px, baseTop + 0.15, 0), color: 0x8a1c1c });
  world.collider(new THREE.Vector3(px, baseTop + 0.15, 0), new THREE.Vector3(2.6, 0.3, 3.0));
  const lect = mergeColored([
    { geo: new THREE.BoxGeometry(0.7, 1.1, 0.9), color: 0x6b4424, matrix: T(0, 0.55, 0) },
    { geo: new THREE.BoxGeometry(0.85, 0.08, 1.05), color: 0x4a2c14, matrix: TR(0.05, 1.15, 0, 0, 0, 0.25) },
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6), color: 0x222222, matrix: TR(-0.25, 1.4, 0, 0, 0, -0.5) },
    { geo: new THREE.SphereGeometry(0.07, 10, 8), color: 0x1a1a1a, matrix: T(-0.39, 1.63, 0) },
  ]);
  batch.add(lect, trim, { matrix: T(px + 0.35, baseTop + 0.3, 0) });
  world.collider(new THREE.Vector3(px + 0.35, baseTop + 0.3 + 0.55, 0), new THREE.Vector3(0.7, 1.1, 0.9));
  const lseal = atlas.draw(256, 256, (ctx, w, h) => drawCitySeal(ctx, w, h));
  batch.add(atlas.quad(lseal, 0.6, 0.6), lseal.page.mat, { matrix: T(px - 0.01, baseTop + 0.9, 0, -Math.PI / 2), castShadow: false });
  world.poi.set('cityHallPodium', new THREE.Vector3(px - 0.7, baseTop + 0.32, 0));
  world.poi.set('mayor', new THREE.Vector3(px + 1.05, baseTop + 0.32, 0.35));
  world.poi.set('cityHall', new THREE.Vector3(mbX0 - 1.5, baseTop, 0));

  // flags (animated) in front of the steps
  buildFlags(game, world, batch, [
    [CH.stepsX0 - 2.5, -15.5],
    [CH.stepsX0 - 2.5, -11.5],
    [CH.stepsX0 - 2.5, 11.5],
    [CH.stepsX0 - 2.5, 15.5],
  ]);
}

/**
 * Polish (night readability): the City Hall portico and the plaza at the foot of its steps were nearly black under the
 * blue moon fill, and Jimothy turned into a silhouette there. Same recipe as Old Ballard's back alleys: warm lamp heads
 * + lit windows join the zone batch's existing furniture / lamp-glass / window / trim materials, and warm light pools
 * join its light-pool batch (additive, night-only) → no extra draw calls.
 * The pools and glow don't light Jimothy himself, so City Hall also gets ONE proximity-gated rig on the shared night
 * PointLight from south/nightLight.ts. That light already exists (stadium / market hall rigs, 120+ m away), so this adds
 * no real-time light and no shader change: it just parks here at night while the player is near City Hall.
 */
function buildCityHallNightLights(game: Game, world: World, batch: Batch) {
  // (same derived dimensions as buildCityHall)
  const y0 = walkY(CH.x0, 0);
  const baseTop = y0 + CH.base; // portico floor
  const mbX0 = CH.x0 + 6; // portico back wall (main block front)
  const soffit = baseTop + 9; // underside of the entablature (portico ceiling)
  const stepW = 26;
  const fm = furnMat();
  const glass = lampGlassMat(game);
  const IRON = 0x1f2d27,
    BRASS = 0xb8923f; // historicLamp's palette
  // hex lantern, origin = centre of the glass: iron/brass frame (furniture batch) + glowing glass (lamp-glass batch)
  const frame = mergeColored([
    { geo: new THREE.ConeGeometry(0.36, 0.3, 6), color: IRON, matrix: T(0, 0.55, 0) },
    { geo: new THREE.CylinderGeometry(0.3, 0.3, 0.06, 6), color: BRASS, matrix: T(0, 0.38, 0) },
    { geo: new THREE.CylinderGeometry(0.2, 0.13, 0.12, 6), color: IRON, matrix: T(0, -0.41, 0) },
    { geo: new THREE.SphereGeometry(0.06, 8, 6), color: BRASS, matrix: T(0, -0.5, 0) },
    ...[0, 1, 2, 3, 4, 5].map((k) => ({ geo: new THREE.BoxGeometry(0.035, 0.72, 0.035), color: IRON, matrix: T(Math.sin((k / 6) * Math.PI * 2) * 0.235, 0, Math.cos((k / 6) * Math.PI * 2) * 0.235) })),
  ]);
  const lantern = new THREE.CylinderGeometry(0.25, 0.2, 0.7, 6);
  // four lanterns hanging on chains from the portico ceiling, between the column pairs
  const hx = CH.x0 + 4.2,
    hy = baseTop + 6.2;
  const chainL = soffit - (hy + 0.7);
  for (const z of [-9, -3, 3, 9]) {
    batch.add(frame, fm, { matrix: T(hx, hy, z) });
    batch.add(lantern, glass, { matrix: T(hx, hy, z), castShadow: false });
    batch.add(new THREE.CylinderGeometry(0.025, 0.025, chainL, 5), fm, { matrix: T(hx, hy + 0.7 + chainL / 2, z), color: IRON });
  }
  // two wall lanterns on brackets flanking the bronze doors
  for (const s of [-1, 1]) {
    const lx = mbX0 - 0.55,
      ly = baseTop + 3.1,
      lz = s * 3.15;
    batch.add(frame, fm, { matrix: T(lx, ly, lz, 0, 0.75) });
    batch.add(lantern, glass, { matrix: T(lx, ly, lz, 0, 0.75), castShadow: false });
    batch.add(
      mergeColored([
        { geo: new THREE.BoxGeometry(0.05, 0.4, 0.22), color: IRON, matrix: T(mbX0 - 0.025, ly + 0.45, lz) },
        { geo: new THREE.BoxGeometry(0.6, 0.06, 0.06), color: IRON, matrix: T(mbX0 - 0.3, ly + 0.555, lz) },
      ]),
      fm,
    );
  }
  // two always-lit tall windows on the portico back wall (same size/trim as the building's other windows)
  const win = windowMats(game);
  const trim = trimMat();
  for (const s of [-1, 1]) {
    const M = T(mbX0 - 0.03, baseTop + 3.2, s * 9, -Math.PI / 2);
    batch.add(new THREE.PlaneGeometry(1.5, 3.2), win.lit, { matrix: M, castShadow: false });
    batch.add(new THREE.BoxGeometry(1.9, 0.18, 0.25), trim, { matrix: M.clone().multiply(T(0, -1.7, 0.1)), color: 0xefe8da });
    batch.add(new THREE.BoxGeometry(2.0, 0.35, 0.18), trim, { matrix: M.clone().multiply(T(0, 1.8, 0.05)), color: 0xefe8da });
  }
  // stair lamps on the cheek-wall newels at the foot of the grand steps (same acorn lamp as the plaza)
  placeBatched(
    world,
    batch,
    historicLamp(game),
    [-1, 1].map((s) => ({ x: CH.stepsX0 + 0.8, y: y0 + CH.base + 0.5, z: s * (stepW / 2 + 0.6), ry: 0 })),
    { collider: new THREE.Vector3(0.3, 4.6, 0.3), name: 'plazaLamps' },
  );
  // warm pools (night only): portico floor under the lanterns, the plaza below the stair lamps, and light spilling down
  // the steps. Pool y = the actual surface (a pool plane below the paving is hidden by it).
  const px = CH.stepsX0 - 1.6;
  lightPools(game, world, [
    ...[-9, -3, 3, 9].map((z) => ({ x: CH.x0 + 3.9, y: baseTop, z, r: 3.0 })),
    ...[-1, 1].map((s) => ({ x: px, y: walkY(px, s * 12.8), z: s * 12.8, r: 4.6 })),
    { x: CH.stepsX0 - 2.4, y: walkY(CH.stepsX0 - 2.4, 0), z: 0, r: 5.0 },
  ], batch);
  // the one real light (see above): warm wash from high up at the entablature's front edge (lights the column fronts
  // AND tops Jimothy from above, so he reads from behind too), on while Jimothy is within ~22 m (off beyond 34 m)
  addNightRig(game, { pos: new THREE.Vector3(CH.x0 + 1, baseTop + 8.3, 0), color: 0xffc58a, intensity: 1.35, distance: 30, decay: 0, radius: 22, fade: 12 });
}

function sphereCollider(game: Game, c: THREE.Vector3, r: number) {
  const cd = RAPIER.ColliderDesc.ball(r).setTranslation(c.x, c.y, c.z).setFriction(0.8).setCollisionGroups(groups(G.WORLD));
  return game.physics.staticCollider(cd);
}

function buildFlags(game: Game, world: World, batch: Batch, spots: [number, number][]) {
  const atlas = sharedAtlas(game);
  const fm = furnMat();
  const rects: AtlasRect[] = [];
  for (let i = 0; i < FLAG_COUNT; i++) rects.push(atlas.draw(256, 160, (ctx, w, h) => drawFlag(ctx, w, h, i)));
  const poleH = 9;
  // one dynamic mesh for all flags; vertices are waved every frame
  const FW = 2.6,
    FH = 1.6,
    NX = 10,
    NY = 3;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const base: { x: number; y: number; z: number; u: number }[] = [];
  spots.forEach(([x, z], i) => {
    const y = walkY(x, z);
    batch.add(
      mergeColored([
        { geo: new THREE.CylinderGeometry(0.06, 0.09, poleH, 10), color: 0xdadfe3, matrix: T(0, poleH / 2, 0) },
        { geo: new THREE.SphereGeometry(0.13, 10, 8), color: 0xe0b04a, matrix: T(0, poleH + 0.1, 0) },
        { geo: new THREE.CylinderGeometry(0.35, 0.45, 0.4, 12), color: 0x9aa0a6, matrix: T(0, 0.2, 0) },
      ]),
      fm,
      { matrix: T(x, y, z) },
    );
    cylinderCollider(game, new THREE.Vector3(x, y + poleH / 2, z), 0.12, poleH);
    const r = rects[i % rects.length];
    const start = pos.length / 3;
    for (let j = 0; j <= NY; j++) {
      for (let k = 0; k <= NX; k++) {
        const u = k / NX,
          v = j / NY;
        // flag extends along -X from the pole (toward the plaza), top at poleH - 0.2
        const px = x - u * FW,
          py = y + poleH - 0.25 - (1 - v) * FH;
        pos.push(px, py, z);
        base.push({ x: px, y: py, z, u });
        uv.push(r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v);
      }
    }
    for (let j = 0; j < NY; j++) {
      for (let k = 0; k < NX; k++) {
        const a = start + j * (NX + 1) + k;
        const b = a + 1,
          c = a + NX + 1,
          d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  const posAttr = new THREE.Float32BufferAttribute(pos, 3);
  g.setAttribute('position', posAttr);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = cached('mat:flags', () => new THREE.MeshStandardMaterial({ map: rects[0].page.texture, side: THREE.DoubleSide, roughness: 0.8 }));
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'flags';
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  // animated every frame: keep it out of world.staticRoot so static-mesh batching never freezes it
  game.scene.add(mesh);
  let acc = 0;
  onFrame(game, (gm, dt) => {
    acc += dt;
    if (acc < 1 / 30) return;
    acc = 0;
    const t = gm.time;
    for (let i = 0; i < base.length; i++) {
      const b = base[i];
      const w = Math.sin(t * 3.2 - b.u * 5 + b.x * 0.3) * 0.28 * b.u;
      posAttr.setXYZ(i, b.x + Math.abs(w) * 0.15, b.y + Math.sin(t * 2.1 - b.u * 3) * 0.05 * b.u, b.z + w);
    }
    posAttr.needsUpdate = true;
    g.computeVertexNormals();
  });
}

// ============================================================================================ towers

interface TowerSpec {
  name: string;
  cx: number;
  cz: number;
  w: number;
  d: number;
  tiers: number[];
  tint: number;
  helipad?: boolean;
  entrance: 'n' | 's' | 'e' | 'w';
}

function towerMat(game: Game) {
  return cached('mat:towerGlass', () => {
    const m = new THREE.MeshStandardMaterial({
      map: towerTexture('color', 5),
      emissiveMap: towerTexture('emissive', 5),
      emissive: 0xffffff,
      emissiveIntensity: 0,
      vertexColors: true,
      roughness: 0.12,
      metalness: 0.55,
      envMapIntensity: 1.8,
    });
    glowAtNight(game, m, 0.0, 0.85);
    return m;
  });
}

function buildTowers(game: Game, world: World, batch: Batch, rng: Rng) {
  const atlas = sharedAtlas(game);
  const specs: TowerSpec[] = [
    { name: 'One Puddle Plaza', cx: 80, cz: -39, w: 20, d: 20, tiers: [16, 14, 10], tint: 0xbfe0f5, entrance: 's' },
    { name: 'Drizzle Tower', cx: 106, cz: -40, w: 18, d: 18, tiers: [18, 16, 12, 8], tint: 0x9fc8e8, helipad: true, entrance: 's' },
    { name: 'The Salmon Building', cx: 80, cz: 39, w: 20, d: 20, tiers: [14, 12], tint: 0xffd6c4, entrance: 'n' },
    { name: 'Umbrella Financial', cx: 106, cz: 40, w: 18, d: 20, tiers: [16, 14, 10], tint: 0xc9f0dc, entrance: 'n' },
    { name: 'Emerald Exchange', cx: 138, cz: 38, w: 20, d: 20, tiers: [12, 10], tint: 0xa8e6c4, entrance: 'n' },
    { name: 'Evergreen Insurance', cx: 163, cz: 36, w: 18, d: 24, tiers: [18, 14], tint: 0xd7e3ff, entrance: 'n' },
  ];
  const glassM = towerMat(game);
  const stone = stoneMat();
  const trim = trimMat();
  const glass = darkGlassMat();
  const blink: THREE.Vector3[] = [];
  for (const s of specs) {
    const y0 = walkY(s.cx, s.cz);
    const baseH = 7;
    // stone podium with lobby glazing
    batch.add(new THREE.BoxGeometry(s.w + 2, baseH, s.d + 2), stone, { matrix: T(s.cx, y0 + baseH / 2, s.cz), uv: 2.4 });
    world.collider(new THREE.Vector3(s.cx, y0 + baseH / 2, s.cz), new THREE.Vector3(s.w + 2, baseH, s.d + 2));
    const face = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[s.entrance];
    const yaw = Math.atan2(face[0], face[1]);
    const half = face[0] !== 0 ? (s.w + 2) / 2 : (s.d + 2) / 2;
    const M = T(s.cx + face[0] * half, y0, s.cz + face[1] * half, yaw);
    batch.add(new THREE.PlaneGeometry(Math.min(s.w, s.d) - 2, 4.2), glass, { matrix: M.clone().multiply(T(0, 2.3, 0.03)), castShadow: false });
    batch.add(new THREE.BoxGeometry(Math.min(s.w, s.d) + 0.5, 0.35, 1.6), trim, { matrix: M.clone().multiply(T(0, 4.7, 0.8)), color: 0x2d3035 });
    const lobby = atlas.draw(512, 96, (ctx, w, h) => drawLobbySign(ctx, w, h, s.name));
    batch.add(atlas.quad(lobby, 7, 1.3), lobby.page.glowMat, { matrix: M.clone().multiply(T(0, 5.8, 0.03)), castShadow: false });
    // glass tiers with setbacks
    let y = y0 + baseH;
    let w = s.w,
      d = s.d;
    s.tiers.forEach((h, i) => {
      batch.add(new THREE.BoxGeometry(w, h, d), glassM, { matrix: T(s.cx, y + h / 2, s.cz), uv: 24, color: s.tint });
      world.collider(new THREE.Vector3(s.cx, y + h / 2, s.cz), new THREE.Vector3(w, h, d));
      // ledge cap (the setback you can rest on)
      batch.add(new THREE.BoxGeometry(w + 0.3, 0.35, d + 0.3), trim, { matrix: T(s.cx, y + h + 0.17, s.cz), color: 0xdfe4e8 });
      y += h;
      if (i < s.tiers.length - 1) {
        w -= 4;
        d -= 4;
      }
    });
    // rooftop: AC units, antenna, maybe a helipad + aircraft light
    for (let k = 0; k < 2; k++) {
      const ax = s.cx + rng.range(-w / 2 + 2, w / 2 - 2),
        az = s.cz + rng.range(-d / 2 + 2, d / 2 - 2);
      batch.add(new THREE.BoxGeometry(2.2, 1.4, 1.8), trim, { matrix: T(ax, y + 0.9, az), color: 0xaeb4ba });
      world.collider(new THREE.Vector3(ax, y + 0.9, az), new THREE.Vector3(2.2, 1.4, 1.8));
    }
    if (s.helipad) {
      const hp = atlas.draw(256, 256, (ctx, W, H) => {
        ctx.fillStyle = '#2d3035';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, W * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${H * 0.5}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', W / 2, H / 2 + 6);
      });
      batch.add(atlas.quad(hp, Math.min(w, d) - 3, Math.min(w, d) - 3).rotateX(-Math.PI / 2), hp.page.mat, { matrix: T(s.cx, y + 0.37, s.cz), castShadow: false });
    }
    batch.add(new THREE.CylinderGeometry(0.08, 0.15, 7, 8), trim, { matrix: T(s.cx + w / 2 - 1.5, y + 3.5, s.cz + d / 2 - 1.5), color: 0x9aa0a6 });
    blink.push(new THREE.Vector3(s.cx + w / 2 - 1.5, y + 7.1, s.cz + d / 2 - 1.5));
  }
  // blinking red aircraft lights (one merged mesh + material toggled)
  const red = cached('mat:aircraftLight', () => new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xff2020, emissiveIntensity: 0 }));
  batch.add(mergeColored(blink.map((p) => ({ geo: new THREE.SphereGeometry(0.22, 10, 8), color: 0xffffff, matrix: T(p.x, p.y, p.z) }))), red, { castShadow: false });
  onFrame(game, (g, _dt, n) => {
    red.emissiveIntensity = (Math.sin(g.realTime * 3.0) > 0.4 ? 1 : 0.05) * (1.2 + n * 3);
  });
}

// ============================================================================================ space noodle

function buildNoodle(game: Game, world: World, batch: Batch) {
  const atlas = sharedAtlas(game);
  const { x: nx, z: nz } = NOODLE;
  const y0 = walkY(nx, nz);
  const trim = trimMat();
const pasta = cached('mat:pasta', () => glowAtNight(game, new THREE.MeshStandardMaterial({ color: 0xf5d98a, roughness: 0.55, metalness: 0.05, emissive: 0xffc96b, emissiveIntensity: 0 }), 0, 0.28));
  const strandMat = cached('mat:pastaStrand', () => glowAtNight(game, new THREE.MeshStandardMaterial({ color: 0xe8b04a, roughness: 0.5, flatShading: true, emissive: 0xffa53a, emissiveIntensity: 0 }), 0, 0.35));
  const red = 0xd4312b;
  // core segments: [y0, y1, r] — each narrower than the one below; the step is a rest ledge
  const segs: [number, number, number][] = [
    [0, 16, 4.3],
    [16, 31, 3.1],
    [31, 46, 2.1],
    [46, 60, 1.4],
  ];
  const DECK = y0 + 60;
  for (const [a, b, r] of segs) {
    const h = b - a;
    batch.add(new THREE.CylinderGeometry(r, r, h, 36), pasta, { matrix: T(nx, y0 + a + h / 2, nz) });
    cylinderCollider(game, new THREE.Vector3(nx, y0 + a + h / 2, nz), r, h, 0.9);
    // three twisting noodle strands per segment (the "rotini" look) — visual only
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * Math.PI * 2 + a * 0.2;
      const turns = 1.25;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) {
        const t = i / 48;
        const ang = a0 + t * turns * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(ang) * (r + 0.05), a + 0.3 + t * (h - 0.6), Math.sin(ang) * (r + 0.05)));
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, Math.min(0.32, r * 0.12), 6, false);
      batch.add(tube, strandMat, { matrix: T(nx, y0, nz) });
    }
    // red ledge ring at the top of every segment but the last
    if (b < 60) batch.add(new THREE.TorusGeometry(r - 0.05, 0.1, 6, 40), trim, { matrix: TR(nx, y0 + b + 0.05, nz, Math.PI / 2, 0, 0), color: red });
    // maintenance ladder on the east side (+X)
    const rails = [] as { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[];
    for (const dz of [-0.28, 0.28]) rails.push({ geo: new THREE.BoxGeometry(0.06, h, 0.06), color: 0x3d434a, matrix: T(r + 0.1, a + h / 2, dz) });
    for (let yy = a + 0.3; yy < b; yy += 0.35) rails.push({ geo: new THREE.BoxGeometry(0.05, 0.04, 0.56), color: 0x3d434a, matrix: T(r + 0.1, yy, 0) });
    batch.add(mergeColored(rails), trim, { matrix: T(nx, y0, nz) });
    world.addLadder(new THREE.Vector3(nx + r - 0.3, y0 + a - 0.6, nz - 0.8), new THREE.Vector3(nx + r + 1.2, y0 + b + 0.8, nz + 0.8));
    // rest landings beside the ladder at mid-height (sidestep onto one while climbing, let go, get your breath back)
    const land: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
    for (const side of [-1, 1]) {
      const ly = a + h * (side < 0 ? 0.42 : 0.62);
      const ang = side * (1.35 / (r + 0.4)); // ~1.35 m of arc beside the ladder line
      const lr = r + 0.55;
      const lx = Math.cos(ang) * lr,
        lz = Math.sin(ang) * lr;
      const yaw = -ang;
      land.push({ geo: new THREE.BoxGeometry(1.1, 0.12, 1.2), color: 0x5b636b, matrix: T(lx, ly, lz, yaw + Math.PI / 2) });
      land.push({ geo: new THREE.BoxGeometry(0.05, 0.5, 1.2), color: red, matrix: T(Math.cos(ang) * (r + 1.08), ly + 0.3, Math.sin(ang) * (r + 1.08), yaw + Math.PI / 2 + Math.PI / 2) });
      world.collider(new THREE.Vector3(nx + lx, y0 + ly, nz + lz), new THREE.Vector3(1.2, 0.14, 1.1), yaw);
    }
    batch.add(mergeColored(land), trim, { matrix: T(nx, y0, nz) });
  }
  // base: plinth + three splayed legs
  batch.add(new THREE.CylinderGeometry(5.6, 6.0, 0.9, 40), stoneMat(), { matrix: T(nx, y0 + 0.45, nz), uv: 2 });
  cylinderCollider(game, new THREE.Vector3(nx, y0 + 0.45, nz), 6.0, 0.9);
  for (const deg of [90, 210, 330]) {
    const a = (deg * Math.PI) / 180;
    const P = (r: number, y: number) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const curve = new THREE.QuadraticBezierCurve3(P(10, 0), P(8.5, 9), P(3.8, 15));
    batch.add(new THREE.TubeGeometry(curve, 24, 0.55, 8, false), strandMat, { matrix: T(nx, y0, nz) });
    batch.add(new THREE.CylinderGeometry(0.9, 1.1, 0.6, 12), stoneMat(), { matrix: T(nx + Math.cos(a) * 10, y0 + 0.3, nz + Math.sin(a) * 10) });
    // leg colliders: oriented boxes along the curve (climbable ramps)
    const n = 5;
    for (let i = 0; i < n; i++) {
      const p0 = curve.getPoint(i / n),
        p1 = curve.getPoint((i + 1) / n);
      const mid = p0.clone().add(p1).multiplyScalar(0.5).add(new THREE.Vector3(nx, y0, nz));
      const dir = p1.clone().sub(p0);
      const len = dir.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      game.physics.staticBox(mid, new THREE.Vector3(0.5, len / 2, 0.5), q);
    }
  }

  // ------------------------------------------------ saucer deck (polar grid with the ladder hatch on +X)
  const deck = saucerGeometry(nx, nz, DECK, { rIn: 1.4, rHatch: 3.6, rOut: 10, thick: 0.6, drop: 1.9, seg: 40, hatchHalf: 2 });
  const deckMat = cached('mat:noodleDeck', () => new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7 }));
  batch.add(deck.top, deckMat, { castShadow: true });
  batch.add(deck.under, cached('mat:noodleUnder', () => new THREE.MeshStandardMaterial({ color: 0xf5d98a, roughness: 0.6 })), { castShadow: true });
  batch.add(deck.rim, trim, { color: 0xe8563a });
  trimeshFromGeometry(game, deck.collider);
  // rim lights
  const glow = warmGlowMat(game);
  const bulbs: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    bulbs.push({ geo: new THREE.SphereGeometry(0.12, 6, 4), color: 0xffffff, matrix: T(nx + Math.cos(a) * 10.08, DECK - 0.3, nz + Math.sin(a) * 10.08) });
  }
  batch.add(mergeColored(bulbs), glow, { castShadow: false });
  // outer railing (r = 9.7)
  const rail: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
  const NR = 40;
  for (let k = 0; k < NR; k++) {
    const a = (k / NR) * Math.PI * 2,
      a2 = ((k + 1) / NR) * Math.PI * 2;
    const p = new THREE.Vector3(nx + Math.cos(a) * 9.7, DECK, nz + Math.sin(a) * 9.7);
    const p2 = new THREE.Vector3(nx + Math.cos(a2) * 9.7, DECK, nz + Math.sin(a2) * 9.7);
    const mid = p.clone().add(p2).multiplyScalar(0.5);
    const len = p.distanceTo(p2);
    const yaw = Math.atan2(p2.x - p.x, p2.z - p.z);
    rail.push({ geo: new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6), color: 0x9aa0a6, matrix: T(p.x, DECK + 0.55, p.z) });
    rail.push({ geo: new THREE.BoxGeometry(0.07, 0.07, len), color: 0xd4312b, matrix: T(mid.x, DECK + 1.1, mid.z, yaw) });
    rail.push({ geo: new THREE.BoxGeometry(0.03, 0.03, len), color: 0x9aa0a6, matrix: T(mid.x, DECK + 0.55, mid.z, yaw) });
    world.collider(new THREE.Vector3(mid.x, DECK + 0.6, mid.z), new THREE.Vector3(0.12, 1.2, len + 0.05), yaw);
  }
  batch.add(mergeColored(rail), furnMat());
  // hatch guard rail (so nobody strolls into the hole... much)
  {
    const hx0 = 1.6,
      hx1 = 3.6;
    const g: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
    for (const s of [-1, 1]) {
      const a = s * 0.39;
      const mid = new THREE.Vector3(Math.cos(a) * ((hx0 + hx1) / 2), 0, Math.sin(a) * ((hx0 + hx1) / 2));
      g.push({ geo: new THREE.BoxGeometry(hx1 - hx0, 0.06, 0.06), color: 0xffd23f, matrix: T(mid.x, 0.9, mid.z, -a + Math.PI / 2 - Math.PI / 2) });
      g.push({ geo: new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6), color: 0xffd23f, matrix: T(Math.cos(a) * hx1, 0.45, Math.sin(a) * hx1) });
    }
    batch.add(mergeColored(g), furnMat(), { matrix: T(nx, DECK, nz) });
  }

  // ------------------------------------------------ restaurant ring (glass wall with a west door) + roof
  const WALL_R = 6,
    WALL_H = 4;
  const glassMat = cached('mat:noodleGlass', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x9fd6ee, transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.3, emissive: 0xffc46b, emissiveIntensity: 0, depthWrite: false, side: THREE.DoubleSide });
    glowAtNight(game, m, 0, 0.9);
    return m;
  });
  const NW = 24;
  const mull: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
  for (let k = 0; k < NW; k++) {
    const a = (k / NW) * Math.PI * 2;
    const a2 = ((k + 1) / NW) * Math.PI * 2;
    const am = (a + a2) / 2;
    const isDoor = Math.abs(Math.atan2(Math.sin(am - Math.PI), Math.cos(am - Math.PI))) < 0.14;
    const p = new THREE.Vector3(Math.cos(a) * WALL_R, 0, Math.sin(a) * WALL_R);
    const p2 = new THREE.Vector3(Math.cos(a2) * WALL_R, 0, Math.sin(a2) * WALL_R);
    const mid = p.clone().add(p2).multiplyScalar(0.5);
    const len = p.distanceTo(p2);
    const yaw = Math.atan2(p2.x - p.x, p2.z - p.z);
    mull.push({ geo: new THREE.BoxGeometry(0.12, WALL_H, 0.12), color: 0xe8e8e8, matrix: T(p.x, WALL_H / 2, p.z) });
    if (isDoor) {
      mull.push({ geo: new THREE.BoxGeometry(0.14, 0.5, len), color: 0xe8e8e8, matrix: T(mid.x, WALL_H - 0.25, mid.z, yaw) });
      continue;
    }
    batch.add(new THREE.PlaneGeometry(len, WALL_H - 0.1), glassMat, { matrix: T(nx + mid.x, DECK + WALL_H / 2, nz + mid.z, yaw + Math.PI / 2), castShadow: false });
    world.collider(new THREE.Vector3(nx + mid.x, DECK + WALL_H / 2, nz + mid.z), new THREE.Vector3(0.2, WALL_H, len + 0.05), yaw);
  }
  batch.add(mergeColored(mull), trim, { matrix: T(nx, DECK, nz) });
  // roof (flush with the wall so you can mantle onto it), cap, spire
  batch.add(new THREE.CylinderGeometry(WALL_R + 0.02, WALL_R + 0.02, 0.5, 40), deckMat, { matrix: T(nx, DECK + WALL_H + 0.25, nz) });
  cylinderCollider(game, new THREE.Vector3(nx, DECK + WALL_H + 0.25, nz), WALL_R, 0.5);
  batch.add(new THREE.CylinderGeometry(2.2, 2.8, 1.4, 24), trim, { matrix: T(nx, DECK + WALL_H + 1.2, nz), color: 0xf5d98a });
  cylinderCollider(game, new THREE.Vector3(nx, DECK + WALL_H + 1.2, nz), 2.8, 1.4);
  batch.add(new THREE.CylinderGeometry(0.06, 0.35, 9, 10), trim, { matrix: T(nx, DECK + WALL_H + 6.4, nz), color: 0xdadfe3 });
  const beacon = cached('mat:noodleBeacon', () => new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff3030, emissiveIntensity: 1 }));
  batch.add(new THREE.SphereGeometry(0.3, 12, 8), beacon, { matrix: T(nx, DECK + WALL_H + 11.0, nz), castShadow: false });
  onFrame(game, (g, _dt, n) => {
    beacon.emissiveIntensity = (Math.sin(g.realTime * 2.2) > 0 ? 1.4 : 0.2) * (1 + n * 2);
  });
  // café interior: tables + counter + sign
  const tables: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.5;
    if (Math.abs(Math.cos(a) - 1) < 0.3) continue;
    const tx = Math.cos(a) * 4.4,
      tz = Math.sin(a) * 4.4;
    tables.push({ geo: new THREE.CylinderGeometry(0.45, 0.45, 0.05, 14), color: 0xffffff, matrix: T(tx, 0.75, tz) });
    tables.push({ geo: new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6), color: 0x333333, matrix: T(tx, 0.375, tz) });
  }
  batch.add(mergeColored(tables), trim, { matrix: T(nx, DECK, nz) });
  const cafe = atlas.draw(512, 128, (ctx, w, h) => drawCafeSign(ctx, w, h));
  batch.add(atlas.quad(cafe, 3.2, 0.8), cafe.page.glowMat, { matrix: T(nx - WALL_R - 0.05, DECK + WALL_H - 0.6, nz, -Math.PI / 2), castShadow: false });
  // entrance sign at the base
  const sign = atlas.draw(512, 320, (ctx, w, h) => drawNoodleSign(ctx, w, h));
  const sx = nx - 8.5,
    sz = nz + 2.8;
  const sy = walkY(sx, sz);
  batch.add(atlas.slab(sign, 3.0, 1.9, 0.08), sign.page.mat, { matrix: T(sx, sy + 1.9, sz, -Math.PI / 2) });
  for (const d of [-1.3, 1.3]) batch.add(new THREE.CylinderGeometry(0.06, 0.06, 2.9, 8), furnMat(), { matrix: T(sx, sy + 1.45, sz + d), color: 0x274b7a });
  world.collider(new THREE.Vector3(sx, sy + 1.6, sz), new THREE.Vector3(0.2, 3.2, 3.0));

  // flower ring around the plinth (kit:2 lives in the fountain; this is just pretty)
  placeBatched(world, batch, planter(3), [0, 1, 2, 3, 4, 5].map((k) => {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const px = nx + Math.cos(a) * 7.4,
      pz = nz + Math.sin(a) * 7.4;
    return { x: px, y: walkY(px, pz), z: pz, ry: -a + Math.PI / 2 };
  }), { collider: new THREE.Vector3(1.6, 0.62, 0.8) });

  world.poi.set('spaceNoodleBase', new THREE.Vector3(nx - 7.0, walkY(nx - 7, nz), nz));
  world.poi.set('spaceNoodleTop', new THREE.Vector3(nx - 8.0, DECK + 0.05, nz));
  world.poi.set('bobblehead:e1', new THREE.Vector3(nx - 4.2, DECK + WALL_H + 0.55, nz + 1.5));
}

/** Saucer deck as a polar grid: top, sloped underside, rim, hatch walls, plus a matching collider soup. */
function saucerGeometry(cx: number, cz: number, yTop: number, o: { rIn: number; rHatch: number; rOut: number; thick: number; drop: number; seg: number; hatchHalf: number }) {
  const top: number[] = [];
  const under: number[] = [];
  const rim: number[] = [];
  const radii = [o.rIn, o.rHatch, (o.rHatch + o.rOut) / 2, o.rOut];
  const yb = (r: number) => yTop - o.thick - ((o.rOut - r) / (o.rOut - o.rIn)) * o.drop;
  const P = (a: number, r: number, y: number) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  const isHatch = (i: number, j: number) => j === 0 && (i <= o.hatchHalf || i >= o.seg - o.hatchHalf);
  const quad = (arr: number[], a: number[], b: number[], c: number[], d: number[], up: boolean) => {
    // (a, b, c, d) around the perimeter; choose winding so the normal faces up (or down)
    const n = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]); // -(cross).y sign test
    const ccw = n < 0;
    const ord = ccw === up ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const p of ord) arr.push(p[0], p[1], p[2]);
  };
  const wall = (arr: number[], p0: number[], p1: number[], q0: number[], q1: number[]) => {
    // vertical quad p0-p1 (top) q0-q1 (bottom); double-sided by emitting both windings
    for (const p of [p0, p1, q1, p0, q1, q0, p0, q1, p1, p0, q0, q1]) arr.push(p[0], p[1], p[2]);
  };
  for (let i = 0; i < o.seg; i++) {
    const a0 = ((i - 0.5) / o.seg) * Math.PI * 2;
    const a1 = ((i + 0.5) / o.seg) * Math.PI * 2;
    for (let j = 0; j < radii.length - 1; j++) {
      if (isHatch(i, j)) continue;
      const r0 = radii[j],
        r1 = radii[j + 1];
      quad(top, P(a0, r0, yTop), P(a1, r0, yTop), P(a1, r1, yTop), P(a0, r1, yTop), true);
      quad(under, P(a0, r0, yb(r0)), P(a1, r0, yb(r0)), P(a1, r1, yb(r1)), P(a0, r1, yb(r1)), false);
      // hatch walls
      if (j === 1 && isHatch(i, 0)) wall(rim, P(a0, r0, yTop), P(a1, r0, yTop), P(a0, r0, yb(r0)), P(a1, r0, yb(r0)));
      if (j === 0 && (isHatch((i + 1) % o.seg, 0) || isHatch((i - 1 + o.seg) % o.seg, 0))) {
        const aa = isHatch((i + 1) % o.seg, 0) ? a1 : a0;
        wall(rim, P(aa, r0, yTop), P(aa, r1, yTop), P(aa, r0, yb(r0)), P(aa, r1, yb(r1)));
      }
    }
    // outer rim band
    wall(rim, P(a0, o.rOut, yTop), P(a1, o.rOut, yTop), P(a0, o.rOut, yb(o.rOut)), P(a1, o.rOut, yb(o.rOut)));
  }
  const mk = (arr: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  };
  const collider = mk([...top, ...under, ...rim]);
  return { top: mk(top), under: mk(under), rim: mk(rim), collider };
}

// ============================================================================================ plaza decor

async function buildPlazaDecor(game: Game, world: World, batch: Batch, rng: Rng) {
  const atlas = sharedAtlas(game);
  const y = walkY(90, 0);
  // lamps around the plaza
  const lamps: Xf[] = [];
  for (const z of [-20.5, 20.5]) for (let x = 72; x <= 114; x += 10.5) lamps.push({ x, y: walkY(x, z), z, ry: 0 });
  for (const [x, z] of [[74, -8], [74, 8], [104, -9], [104, 9], [140, -20], [156, -20], [140, 20], [156, 20]] as [number, number][]) lamps.push({ x, y: walkY(x, z), z, ry: 0 });
  placeBatched(world, batch, historicLamp(game), lamps, { collider: new THREE.Vector3(0.3, 4.6, 0.3), name: 'plazaLamps' });
  // polish (night readability): pools sit ON the plaza paving (walkY). At walkY - 0.15 (road level, copied from the
  // avenue lamps) they were buried 12 cm under Downtown's raised paving and never showed → the plaza read nearly black.
  lightPools(game, world, lamps.map((l) => ({ x: l.x, y: l.y, z: l.z, r: 5 })), batch);
  // trees in grates along the plaza edges + around city hall
  const trees: Xf[][] = [[], [], []];
  const grates: Xf[] = [];
  for (const z of [-17.5, 17.5]) for (let x = 77; x <= 112; x += 10.5) {
    trees[rng.int(0, 2)].push({ x, y: walkY(x, z), z, ry: rng.range(0, 6), s: rng.range(0.95, 1.15) });
    grates.push({ x, y: walkY(x, z), z, ry: 0 });
  }
  for (const [x, z] of [[166, -10], [166, 10], [145, -19.5], [155, -19.5]] as [number, number][]) {
    trees[rng.int(0, 2)].push({ x, y: walkY(x, z), z, ry: rng.range(0, 6), s: 1.1 });
    grates.push({ x, y: walkY(x, z), z, ry: 0 });
  }
  // park trees (on grass)
  for (let k = 0; k < 14; k++) {
    const x = rng.range(PARK.x0 + 3, PARK.x1 - 4),
      z = rng.range(PARK.z0 + 3, PARK.z1 - 3);
    if (x > NOODLE_PLAZA.x0 - 2 && x < NOODLE_PLAZA.x1 + 2 && z > NOODLE_PLAZA.z0 - 2 && z < NOODLE_PLAZA.z1 + 2) continue;
    if (Math.abs(z - NOODLE.z) < 3 || Math.abs(x - NOODLE.x) < 3) continue;
    trees[rng.int(0, 2)].push({ x, y: terrainHeight(x, z), z, ry: rng.range(0, 6), s: rng.range(1.0, 1.35) });
  }
  trees.forEach((t, i) => placeBatched(world, batch, streetTree(i), t, { collider: new THREE.Vector3(0.36, 3, 0.36), name: 'downtownTrees' }));
  placeBatched(world, batch, treeGrate(), grates);
  placeBatched(world, batch, bench(), [
    { x: 88, y, z: -14.5, ry: 0 },
    { x: 100, y, z: -14.5, ry: 0 },
    { x: 88, y, z: 14.5, ry: Math.PI },
    { x: 100, y, z: 14.5, ry: Math.PI },
    { x: 134, y: walkY(134, -34), z: -34, ry: Math.PI / 2 },
    { x: 150, y: walkY(150, -25), z: -25, ry: Math.PI },
  ], { collider: new THREE.Vector3(1.8, 0.62, 0.55) });
  placeBatched(world, batch, planter(4), [
    { x: 70, y, z: -4.5, ry: Math.PI / 2 },
    { x: 70, y, z: 4.5, ry: Math.PI / 2 },
    { x: 112, y, z: -18.5, ry: 0 },
    { x: 112, y, z: 18.5, ry: 0 },
  ], { collider: new THREE.Vector3(1.6, 0.62, 0.8) });
  placeBatched(world, batch, bikeRack(), [{ x: 120, y, z: 19.5, ry: 0 }], { collider: new THREE.Vector3(2.2, 0.9, 0.2) });
  // polish: (136,-26) was on the grass at sidewalk height (floated 20 cm) → moved onto the paved plaza edge
  for (const [x, z] of [[76, -12], [76, 12], [113, -6.5], [139.5, -28.6], [160, 24]] as [number, number][]) spawnTrashCan(game, new THREE.Vector3(x, walkY(x, z), z), rng.range(0, 6));
  // press rows facing the podium
  for (let row = 0; row < 2; row++) for (let k = 0; k < 7; k++) {
    const x = 106 + row * 1.25,
      z = -4.2 + k * 1.4;
    spawnFoldingChair(game, new THREE.Vector3(x, walkY(x, z), z), Math.PI / 2 + rng.range(-0.08, 0.08));
  }
  // balloon arch at the foot of the steps
  const balloons: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
  const cols = [0xff5d8f, 0xffd23f, 0x5ad1ff, 0x7dff9a, 0xb36bff, 0xff8c42];
  const ax = CH.stepsX0 - 1.2;
  for (let k = 0; k <= 36; k++) {
    const t = (k / 36) * Math.PI;
    for (let s = 0; s < 2; s++) {
      const r = 5.6 + s * 0.35;
      balloons.push({ geo: new THREE.SphereGeometry(0.34, 10, 8), color: cols[(k + s) % cols.length], matrix: T(ax + (s ? 0.2 : -0.2), y + Math.sin(t) * r, Math.cos(t) * r, 0, 1, 1.15, 1) });
    }
  }
  batch.add(mergeColored(balloons), cached('mat:balloons', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.05 })), { castShadow: true });
  // bunting over the plaza (triangle pennants on strings between lamp posts)
  const pennants: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.16, 0, 0, 0.16, 0, 0, 0, -0.34, 0], 3));
  tri.computeVertexNormals();
  for (let x = 72; x <= 114; x += 10.5) {
    if (x > 110) continue;
    for (let k = 0; k <= 56; k++) {
      const t = k / 56;
      const p = new THREE.Vector3().lerpVectors(new THREE.Vector3(x, y + 6.4, -20.5), new THREE.Vector3(x, y + 6.4, 20.5), t);
      p.y -= Math.sin(t * Math.PI) * 0.9;
      pennants.push({ geo: tri, color: cols[k % cols.length], matrix: T(p.x, p.y, p.z, Math.PI / 2) });
    }
  }
  batch.add(mergeColored(pennants), cached('mat:pennants', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })), { castShadow: false });
  // news van + camera tripod
  const van = await loadMerged(game, 'assets/models/kenney/car-kit/delivery.glb');
  const vx = 119,
    vz = -18.5;
  if (van) {
    placeBatched(world, batch, van.parts.map((p) => ({ geo: p.geo, mat: p.mat })), [{ x: vx, y: walkY(vx, vz), z: vz, ry: Math.PI / 2, s: 1.45 }], { name: 'newsVan' });
    const sz = van.size.clone().multiplyScalar(1.45);
    world.collider(new THREE.Vector3(vx, walkY(vx, vz) + sz.y * 0.4, vz), new THREE.Vector3(sz.z * 0.95, sz.y * 0.8, sz.x * 0.95));
    const logo = atlas.draw(512, 96, (ctx, w, h) => drawNewsVanLogo(ctx, w, h));
    batch.add(atlas.quad(logo, 3.0, 0.56), logo.page.mat, { matrix: T(vx, walkY(vx, vz) + 1.35, vz + sz.x / 2 + 0.02), castShadow: false });
    batch.add(
      mergeColored([
        { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6), color: 0x9aa0a6, matrix: T(0, 0.3, 0) },
        { geo: new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), color: 0xf2f2f2, matrix: TR(0, 0.75, 0, -1.9, 0, 0) },
      ]),
      furnMat(),
      { matrix: T(vx + 0.5, walkY(vx, vz) + sz.y, vz) },
    );
  }
  const tripod = mergeColored([
    ...[0, 1, 2].map((k) => ({ geo: new THREE.CylinderGeometry(0.02, 0.025, 1.6, 5), color: 0x222222, matrix: TR(Math.cos(k * 2.1) * 0.3, 0.75, Math.sin(k * 2.1) * 0.3, -Math.sin(k * 2.1) * 0.35, 0, Math.cos(k * 2.1) * 0.35) })),
    { geo: new THREE.BoxGeometry(0.55, 0.35, 0.3), color: 0x2d3035, matrix: T(0, 1.65, 0) },
    { geo: new THREE.CylinderGeometry(0.1, 0.12, 0.3, 10), color: 0x111111, matrix: TR(0.4, 1.65, 0, 0, 0, Math.PI / 2) },
    { geo: new THREE.BoxGeometry(0.2, 0.12, 0.2), color: 0xc62f2f, matrix: T(-0.15, 1.88, 0) },
  ]);
  batch.add(tripod, furnMat(), { matrix: T(114.5, walkY(114.5, -8), -8, 0.25) });
  world.collider(new THREE.Vector3(114.5, walkY(114.5, -8) + 0.9, -8), new THREE.Vector3(0.7, 1.8, 0.7));
  world.poi.set('newsVan', new THREE.Vector3(vx - 3, walkY(vx - 3, vz), vz));
}
