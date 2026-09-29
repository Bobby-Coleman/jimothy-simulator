import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World, ZoneBuilder } from '../../World';
import type { WaterSystem } from '../../Water';
import { Batch, mergeColored, T, TR } from './lib/batch';
import { ROAD, roadMaterials, SurfaceBuilder, gridRun, makeGrid, Paint, outAndBackLane, walkY, roadY, type CellKind, type StreetFrame } from './lib/roadkit';
import { buildStore, trimMat, darkGlassMat, type BuildingKit, type StoreSpec, type BuiltStore } from './lib/buildings';
import { bench, bikeRack, furnMat, historicLamp, hydrant, lightPools, newsBox, parkingMeter, placeInstances, placeBatched, planter, streetTree, treeGrate, warmGlowMat, type Xf } from './lib/furniture';
import {
  spawnTrashCan,
  spawnCottonCandy,
  spawnHotDog,
  spawnDumpster,
  spawnPallet,
  spawnCardboardBox,
  spawnTrashBag,
  spawnCrate,
  spawnCafeChair,
  spawnCafeTable,
  spawnSandwichBoard,
  spawnCoffeeCup,
} from './lib/props';
import { loadFonts, sharedAtlas, type AtlasRect } from './lib/signs';
import { SHOPS, drawShopSign, drawShopWindow, drawYear, drawPlaque, BOARD_JOKES, drawBoard, drawCartSign, drawHomeSign, drawCommonsSign, drawClockFace, drawParkingSign, drawMarketBanner } from './lib/shopart';
import { muralTexture } from './lib/mural';
import { applyStripeRow, cached, latticeTexture, loadPBR, plaidTexture, stripeMaterial } from './lib/textures';
import { loadMerged } from './lib/models';
import { cylinderCollider, glowAtNight, onFrame, Rng } from './lib/util';
import { BALLARD } from './Roads';

/**
 * C — Old Ballard Ave (spawn zone). Historic brick main street with parody storefronts, the Goodwheel Thrift
 * (origin spot) with Jimothy's den under its back porch, the Jimothy mural on Jimothy Commons, alleys,
 * a parking lot and the Sunday market.
 */

const Z_FACADE = BALLARD.outer; // 9
const DEPTH = 13;
const BACK_S = Z_FACADE + DEPTH; // 22 (south block backs)
const ALLEY_S = { z0: BACK_S, z1: 30 };
const ALLEY_N = { z0: -29, z1: -Z_FACADE - DEPTH }; // -29..-22
const PLAZA = { x0: 18, x1: 32, z0: Z_FACADE, z1: BACK_S };

export const OldBallard: ZoneBuilder = {
  name: 'Old Ballard Ave',
  async build(game: Game, world: World) {
    await loadFonts();
    const mats = await roadMaterials(game);
    const atlas = sharedAtlas(game);
    const batch = new Batch('oldBallard', 120);
    const rng = new Rng(1307);
    const kit: BuildingKit = { game, world, batch, atlas, rng };
    const water = game.get<WaterSystem>('water');

    world.areas.push({ name: 'Old Ballard Ave', min: new THREE.Vector2(-60, -60), max: new THREE.Vector2(60, 60) });

    // ---------------------------------------------------------------- ground surfaces
    buildSurfaces(game, batch, mats);

    // ---------------------------------------------------------------- storefronts
    const signs = new Map<string, AtlasRect>();
    const art = new Map<string, AtlasRect>();
    for (const [k, def] of Object.entries(SHOPS)) {
      signs.set(k, atlas.draw(768, 128, (ctx, w, h) => drawShopSign(ctx, w, h, def)));
      art.set(k, atlas.draw(448, 224, (ctx, w, h) => drawShopWindow(ctx, w, h, def.theme, k.length)));
    }
    const years = ['1889', '1904', '1907', '1911', '1923', 'EST. 1899'].map((y) => atlas.draw(256, 72, (ctx, w, h) => drawYear(ctx, w, h, y)));

    const north = (x0: number, x1: number, key: string, o: Partial<StoreSpec>): StoreSpec => ({
      name: SHOPS[key]?.name ?? key,
      x0,
      x1,
      facadeZ: -Z_FACADE,
      facing: 1,
      depth: DEPTH,
      floors: 2,
      wall: '#b5523b',
      trim: '#f3ead6',
      sign: signs.get(key),
      signGlow: SHOPS[key]?.glow,
      shopArt: art.get(key),
      ...o,
    });
    const south = (x0: number, x1: number, key: string, o: Partial<StoreSpec>): StoreSpec => ({ ...north(x0, x1, key, o), facadeZ: Z_FACADE, facing: -1, ...o });

    const specs: StoreSpec[] = [
      north(-54, -44, 'donuts', { floors: 2, wall: '#d9c49a', awning: ['#2a5d9f', '#ffffff'], yearRect: years[1], parapet: 'stepped', flowerBoxes: true }),
      north(-44, -32, 'grunge', { floors: 4, wall: '#8a3f2c', trim: '#efe2c4', awning: ['#7a2e1c', '#efe2c4'], fireEscape: true, yearRect: years[0], roofStuff: 2 }),
      north(-32, -22, 'beanmeup', { floors: 3, wall: '#4fa3a5', painted: true, awning: ['#3b1f6e', '#9ff7d0'], door: 'left' }),
      north(-22, -8, 'bakery', { floors: 2, wall: '#b5523b', trim: '#fff4e6', awning: ['#ff7eb6', '#ffffff'], parapet: 'stepped', yearRect: years[3], flowerBoxes: true }),
      north(-8, 4, 'ink', { floors: 3, wall: '#3d3a42', painted: true, trim: '#d8b04a', accent: '#1d1d1d', awning: null, litChance: 0.7 }),
      north(4, 16, 'sweater', { floors: 2, wall: '#e0a82e', painted: true, trim: '#fff4e6', awning: ['#d4312b', '#ffffff'], flowerBoxes: true }),
      north(16, 28, 'hardware', { floors: 3, wall: '#9c5a3c', awning: ['#c62f2f', '#ffffff'], yearRect: years[2], parapet: 'stepped', fireEscape: true }),
      north(28, 40, 'lutefisk', { floors: 2, wall: '#8fc6e0', painted: true, trim: '#ffffff', awning: ['#0d3550', '#ffffff'], door: 'right' }),
      north(40, 54, 'starbrews', { floors: 3, wall: '#a8432e', trim: '#e9f3ee', accent: '#1e4d36', awning: ['#1e7a4f', '#ffffff'], yearRect: years[5], parapet: 'stepped' }),
      south(-54, -42, 'viking', { floors: 2, wall: '#7d8a96', painted: true, trim: '#ffffff', awning: ['#4b5560', '#ffd23f'] }),
      south(-42, -30, 'rain', { floors: 3, wall: '#b5523b', awning: ['#274b7a', '#ffffff'], fireEscape: true, yearRect: years[4], parapet: 'stepped' }),
      south(-30, -18, 'pho', { floors: 2, wall: '#d9c49a', trim: '#b3261e', accent: '#6b1410', awning: ['#b3261e', '#ffd23f'] }),
      south(-18, 2, 'suds', { floors: 3, wall: '#6fb7c9', painted: true, trim: '#ffffff', awning: ['#39b8d6', '#ffffff'], fireEscape: true }),
      south(2, 18, 'goodwheel', { floors: 2, wall: '#ece6da', painted: true, trim: '#1b5fae', accent: '#123f75', awning: ['#1b5fae', '#ffffff'], door: 'right', roofStuff: 1, backDoorX: -5.5 }),
      south(32, 44, 'knit', { floors: 3, wall: '#c46b4f', awning: ['#b3264f', '#ffffff'], flowerBoxes: true }),
      south(44, 54, 'books', { floors: 2, wall: '#2f5d4a', painted: true, trim: '#fdf3d7', awning: ['#2f5d4a', '#fdf3d7'], parapet: 'stepped', yearRect: years[3] }),
    ];
    const built = new Map<string, BuiltStore>();
    for (const s of specs) built.set(s.name, await buildStore(kit, s));

    // rear rows (face the avenues)
    await buildStore(kit, { name: 'Ballard Lofts', x0: -4, x1: 24, facadeZ: -54, facing: -1, depth: 20, floors: 4, wall: '#a24a35', trim: '#f3ead6', plainGround: true, yearRect: years[3], parapet: 'stepped', roofStuff: 3, fireEscape: true });
    await buildStore(kit, { name: 'Salmon Bay Ice Co.', x0: 28, x1: 54, facadeZ: -54, facing: -1, depth: 20, floors: 3, wall: '#c9b48a', trim: '#6b4a2e', plainGround: true, yearRect: years[0], roofStuff: 2 });
    await buildStore(kit, { name: 'Ballard Mercantile', x0: -54, x1: -22, facadeZ: 54, facing: 1, depth: 20, floors: 4, wall: '#8a3f2c', trim: '#efe2c4', plainGround: true, parapet: 'stepped', yearRect: years[2], roofStuff: 3, fireEscape: true });
    await buildStore(kit, { name: 'Leary Ice House', x0: 38, x1: 54, facadeZ: 54, facing: 1, depth: 18, floors: 2, wall: '#6fa37a', painted: true, trim: '#ffffff', plainGround: true, roofStuff: 1 });

    // ---------------------------------------------------------------- Goodwheel extras: mural, plaque, porch + den
    const gw = built.get('Goodwheel')!;
    buildMural(game, world, batch, gw);
    buildPlaque(game, world, batch, gw);
    buildPorchAndDen(game, world, batch);

    // ---------------------------------------------------------------- Jimothy Commons plaza
    await buildPlaza(game, world, batch);

    // ---------------------------------------------------------------- alleys, lot, market
    buildAlleyStuff(game, world, batch, water);
    buildMarket(game, world, batch);
    buildParkingLotDecor(game, world, batch);

    // ---------------------------------------------------------------- Ballard Ave street furniture
    buildStreetFurniture(game, world, batch, rng);
    await parkCars(game, world, rng, batch);

    // ---------------------------------------------------------------- lanes, NPCs, POIs
    world.lanes.push({ points: outAndBackLane({ axis: 'x', c: 0 }, -46, 46, BALLARD.lane, 3.2, 0.5, 4), loop: true, speed: 7 });

    const path = (z: number) => {
      const pts: THREE.Vector3[] = [];
      for (let x = -50; x <= 50; x += 10) pts.push(new THREE.Vector3(x, walkY(x, z), z));
      return pts;
    };
    world.npcSpawns.push({ zone: 'Old Ballard Ave', center: new THREE.Vector3(0, walkY(0, -7.4), -7.4), radius: 5, count: 5, types: ['pedestrian', 'tourist', 'fan'], path: path(-7.4) });
    world.npcSpawns.push({ zone: 'Old Ballard Ave', center: new THREE.Vector3(0, walkY(0, 7.4), 7.4), radius: 5, count: 5, types: ['pedestrian', 'fan', 'tourist'], path: path(7.4) });
    world.npcSpawns.push({ zone: 'Old Ballard Ave', center: new THREE.Vector3(25, walkY(25, 15), 15), radius: 4.5, count: 4, types: ['fan', 'tourist'] });
    world.npcSpawns.push({ zone: 'Old Ballard Ave', center: new THREE.Vector3(-30, roadY(-30, -41), -41), radius: 9, count: 5, types: ['pedestrian', 'tourist', 'fan'] });
    world.npcSpawns.push({ zone: 'Old Ballard Ave', center: new THREE.Vector3(8, roadY(8, 42), 42), radius: 8, count: 2, types: ['pedestrian'] });
    world.npcSpawns.push({ zone: 'Old Ballard Ave', center: new THREE.Vector3(-20, roadY(-20, 26), 26), radius: 6, count: 1, types: ['pedestrian'] });

    const poi = (name: string, x: number, y: number, z: number) => world.poi.set(name, new THREE.Vector3(x, y, z));
    poi('spawn', 9.0, roadY(9, 26.6) + 0.45, 26.6);
    poi('den', 9.0, roadY(9, 23.3) + 0.3, 23.3);
    poi('goodwheel', gw.door.x, gw.door.y, gw.door.z);
    poi('mural', 22.5, walkY(22.5, 15.5) + 0.4, 15.5);
    poi('kit:1', 29.6, walkY(29.6, 19.6) + 0.75, 19.6);
    poi('bobblehead:c1', -38, (built.get(SHOPS.grunge.name)?.height ?? 15.4) + 0.35, -15.5);
    poi('bobblehead:c2', 34.6, roadY(34.6, 22.5) + 0.35, 22.5);
    poi('bobblehead:c3', CLOCK.x + 0.3, walkY(CLOCK.x, CLOCK.z) + 5.75, CLOCK.z + 0.3);
    poi('cottonCandyCart', 22.5, walkY(22.5, 12.2), 12.2);
    poi('hotDogCart', 28.8, walkY(28.8, 12.0), 12.0);
    poi('streetClock', CLOCK.x, walkY(CLOCK.x, CLOCK.z), CLOCK.z);
    poi('farmersMarket', -30, roadY(-30, -41), -41);
    poi('parkingLot', 8, roadY(8, 42), 42);

    batch.flush(world.staticRoot);
  },
};

// ============================================================================================ surfaces

function buildSurfaces(game: Game, batch: Batch, mats: Awaited<ReturnType<typeof roadMaterials>>) {
  const sb = new SurfaceBuilder();
  // Old Ballard Ave (E-W at z = 0)
  const f: StreetFrame = { axis: 'x', c: 0 };
  const dGrid = [-9, -8, -7, -5.85, -5.6, -4.45, -3.3, -1.6, 0, 1.6, 3.3, 4.45, 5.6, 5.85, 7, 8, 9];
  gridRun(sb, f, makeGrid(BALLARD.x0, BALLARD.x1, 3), dGrid, (_s, d): CellKind => {
    const ad = Math.abs(d);
    return ad <= BALLARD.half ? 'asphalt' : ad <= BALLARD.half + BALLARD.curbW ? 'curb' : 'paver';
  });
  // alleys + lots (asphalt at road level)
  const flat = (c: number, s0: number, s1: number, half: number, kind: CellKind) =>
    gridRun(sb, { axis: 'x', c }, makeGrid(s0, s1, 4), makeGrid(-half, half, 4), () => kind);
  flat((ALLEY_S.z0 + ALLEY_S.z1) / 2, -54, 54, (ALLEY_S.z1 - ALLEY_S.z0) / 2, 'asphalt');
  flat((ALLEY_N.z0 + ALLEY_N.z1) / 2, -54, 54, (ALLEY_N.z1 - ALLEY_N.z0) / 2, 'asphalt');
  flat(41.5, -18, 34, 11.5, 'asphalt'); // parking lot
  flat(-40.5, -52, -8, 11.5, 'asphalt'); // market lot
  // Jimothy Commons plaza (raised pavers)
  gridRun(sb, { axis: 'x', c: (PLAZA.z0 + PLAZA.z1) / 2 }, makeGrid(PLAZA.x0, PLAZA.x1, 3.5), makeGrid(-(PLAZA.z1 - PLAZA.z0) / 2, (PLAZA.z1 - PLAZA.z0) / 2, 3.25), () => 'paver');
  sb.finish(game, batch, mats);

  // markings
  const p = new Paint();
  const Y = 0xf2c230,
    W = 0xf4f4ef;
  p.strip(f, -46, 22.5, -0.18, -0.07, Y);
  p.strip(f, -46, 22.5, 0.07, 0.18, Y);
  p.strip(f, 27.5, 46, -0.18, -0.07, Y);
  p.strip(f, 27.5, 46, 0.07, 0.18, Y);
  for (const side of [-1, 1]) {
    // parking strip edge line + stall ticks
    p.strip(f, -46, 22, side * 3.3, side * 3.4, W);
    p.strip(f, 28, 46, side * 3.3, side * 3.4, W);
    for (let x = -44; x <= 44; x += 6.5) if (x < 20 || x > 30) p.strip(f, x - 0.06, x + 0.06, side * 3.35, side * 4.6, W, 1);
  }
  p.zebra(f, 22.8, 27.2, 5.4);
  p.zebra(f, -49.8, -46.8, 5.4);
  p.zebra(f, 46.8, 49.8, 5.4);
  // parking lot stalls
  const lot: StreetFrame = { axis: 'x', c: 41.5 };
  for (let x = -14; x <= 30; x += 3) {
    p.strip(lot, x - 0.06, x + 0.06, -10.5, -5.5, W, 2);
    p.strip(lot, x - 0.06, x + 0.06, 5.5, 10.5, W, 2);
  }
  p.finish(batch, mats.marking);
}

// ============================================================================================ mural & plaque

function buildMural(game: Game, world: World, batch: Batch, gw: BuiltStore) {
  // Goodwheel's east wall (x = 18) faces the plaza.
  const h = gw.height;
  const mat = cached('mat:mural', () => {
    const tex = muralTexture();
    const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.82 });
    glowAtNight(game, m, 0.0, 0.42);
    return m;
  });
  const W = DEPTH - 0.6;
  const H = Math.min(h - 0.9, W / 1.66);
  const g = new THREE.PlaneGeometry(W, H);
  batch.add(g, mat, { matrix: TR(PLAZA.x0 + 0.03, 0.5 + H / 2 + 0.2, (PLAZA.z0 + PLAZA.z1) / 2, 0, Math.PI / 2, 0), castShadow: false });
  // two little spotlights on arms above the mural
  const fm = furnMat();
  for (const dz of [-3.5, 3.5]) {
    const z = (PLAZA.z0 + PLAZA.z1) / 2 + dz;
    batch.add(
      mergeColored([
        { geo: new THREE.BoxGeometry(1.1, 0.07, 0.07), color: 0x2d3035, matrix: T(0.55, 0, 0) },
        { geo: new THREE.CylinderGeometry(0.12, 0.18, 0.35, 10), color: 0x2d3035, matrix: TR(1.1, -0.08, 0, 0, 0, -2.2) },
      ]),
      fm,
      { matrix: T(PLAZA.x0, h - 0.2, z) },
    );
  }
}

function buildPlaque(game: Game, world: World, batch: Batch, gw: BuiltStore) {
  const atlas = sharedAtlas(game);
  const r = atlas.draw(512, 256, (ctx, w, h) => drawPlaque(ctx, w, h));
  const brass = cached('mat:brassPlaque', () => new THREE.MeshStandardMaterial({ map: r.page.texture, roughness: 0.35, metalness: 0.65 }));
  const q = atlas.quad(r, 1.0, 0.5);
  // on the facade, left of the storefront glass, raccoon eye height-ish
  const M = gw.frame.clone().multiply(T(-gw.width / 2 + 0.85, 1.25, 0.16));
  batch.add(q, brass, { matrix: M, castShadow: false });
  batch.add(new THREE.BoxGeometry(1.08, 0.58, 0.03), trimMat(), { matrix: M.clone().multiply(T(0, 0, -0.02)), color: '#6b4a12', castShadow: false });
  const p = new THREE.Vector3(-gw.width / 2 + 0.85, 0.2, 1.2).applyMatrix4(gw.frame);
  world.poi.set('plaque', p);
  // a painted "the spot" marker on the sidewalk
  const spot = atlas.draw(256, 256, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(255,255,255,0.0)';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b5fae';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${w * 0.13}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('THE SPOT', w / 2, h * 0.3);
    ctx.fillText('NOT A CAT', w / 2, h * 0.82);
    for (const [dx, dy, s] of [[0, 0.02, 0.13], [-0.13, -0.1, 0.05], [-0.04, -0.15, 0.05], [0.06, -0.15, 0.05], [0.14, -0.09, 0.05]]) {
      ctx.beginPath();
      ctx.arc(w / 2 + dx * w, h / 2 + dy * h + h * 0.06, s * w, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const sp = new THREE.Vector3(-gw.width / 2 + 2.2, 0, 1.6).applyMatrix4(gw.frame);
  const decal = atlas.quad(spot, 1.3, 1.3).rotateX(-Math.PI / 2);
  const spotMat = cached('mat:spotDecal', () => new THREE.MeshStandardMaterial({ map: spot.page.texture, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
  batch.add(decal, spotMat, { matrix: T(sp.x, walkY(sp.x, sp.z) + 0.012, sp.z, Math.PI), castShadow: false });
}

// ============================================================================================ porch & den

function buildPorchAndDen(game: Game, world: World, batch: Batch) {
  const trim = trimMat();
  const atlas = sharedAtlas(game);
  const y0 = roadY(9, 24);
  const X0 = 5.5,
    X1 = 12.5,
    Z0 = BACK_S,
    Z1 = BACK_S + 2.6;
  const deckY = y0 + 1.2;
  const wood = 0x9a6b3e,
    woodDark = 0x6e4a2a;
  const planksMat = cached('mat:planks', () => new THREE.MeshStandardMaterial({ color: 0xc9a27a, roughness: 0.85 }));
  void loadPBR(game, 'planks').then((p) => {
    if (p.map) {
      planksMat.map = p.map;
      planksMat.normalMap = p.normalMap;
      planksMat.needsUpdate = true;
    }
  });
  const cx = (X0 + X1) / 2,
    cz = (Z0 + Z1) / 2;
  batch.add(new THREE.BoxGeometry(X1 - X0, 0.14, Z1 - Z0), planksMat, { matrix: T(cx, deckY - 0.07, cz), uv: 2 });
  world.collider(new THREE.Vector3(cx, deckY - 0.07, cz), new THREE.Vector3(X1 - X0, 0.14, Z1 - Z0));
  // posts, rails
  const posts: [number, number][] = [
    [X0 + 0.1, Z1 - 0.1],
    [X1 - 0.1, Z1 - 0.1],
  ];
  for (const [x, z] of posts) {
    batch.add(new THREE.BoxGeometry(0.16, 2.2, 0.16), trim, { matrix: T(x, y0 + 1.1, z), color: wood });
  }
  batch.add(new THREE.BoxGeometry(X1 - X0, 0.08, 0.1), trim, { matrix: T(cx, deckY + 0.95, Z1 - 0.1), color: wood });
  batch.add(new THREE.BoxGeometry(0.1, 0.08, Z1 - Z0), trim, { matrix: T(X0 + 0.1, deckY + 0.95, cz), color: wood });
  for (let x = X0 + 0.4; x < X1 - 0.2; x += 0.35) batch.add(new THREE.BoxGeometry(0.05, 0.9, 0.05), trim, { matrix: T(x, deckY + 0.47, Z1 - 0.1), color: 0xe9e1cf });
  for (let z = Z0 + 0.3; z < Z1 - 0.2; z += 0.35) batch.add(new THREE.BoxGeometry(0.05, 0.9, 0.05), trim, { matrix: T(X0 + 0.1, deckY + 0.47, z), color: 0xe9e1cf });
  world.collider(new THREE.Vector3(cx, deckY + 0.5, Z1 - 0.1), new THREE.Vector3(X1 - X0, 1.0, 0.1));
  world.collider(new THREE.Vector3(X0 + 0.1, deckY + 0.5, cz), new THREE.Vector3(0.1, 1.0, Z1 - Z0));
  // roof over the porch + back door sign
  batch.add(new THREE.BoxGeometry(X1 - X0 + 0.6, 0.12, Z1 - Z0 + 0.4), trim, { matrix: TR(cx, y0 + 3.55, cz + 0.1, 0.12, 0, 0), color: 0x2f5f8f });
  world.collider(new THREE.Vector3(cx, y0 + 3.55, cz + 0.1), new THREE.Vector3(X1 - X0 + 0.6, 0.14, Z1 - Z0 + 0.4));
  const back = atlas.draw(384, 96, (ctx, w, h) =>
    drawShopSignLite(ctx, w, h, 'GOODWHEEL · DONATIONS', '#1b5fae', '#ffffff'),
  );
  batch.add(atlas.quad(back, 2.6, 0.65), back.page.mat, { matrix: T(cx, y0 + 3.0, Z0 + 0.03), castShadow: false });
  // steps down to the alley on the east end
  for (let i = 0; i < 4; i++) {
    const top = deckY - 0.3 * (i + 1);
    const x = X1 + 0.18 + i * 0.32;
    batch.add(new THREE.BoxGeometry(0.34, top - y0 + 0.02, 1.3), planksMat, { matrix: T(x, y0 + (top - y0) / 2, Z1 - 0.75), uv: 2 });
    world.collider(new THREE.Vector3(x, y0 + (top - y0) / 2, Z1 - 0.75), new THREE.Vector3(0.34, top - y0 + 0.02, 1.3));
  }

  // lattice skirt with the den entrance
  const lat = cached('mat:lattice', () => new THREE.MeshStandardMaterial({ map: latticeTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }));
  const HOLE = { x0: 8.4, x1: 9.6, h: 0.95 };
  const skirtH = deckY - 0.14 - y0;
  const latPanel = (xa: number, xb: number, z: number, h: number, yb: number) => {
    const g = new THREE.PlaneGeometry(xb - xa, h);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (xb - xa) / 0.9, uv.getY(i) * h / 0.9);
    batch.add(g, lat, { matrix: T((xa + xb) / 2, yb + h / 2, z), castShadow: true });
  };
  latPanel(X0, HOLE.x0, Z1 - 0.05, skirtH, y0);
  latPanel(HOLE.x1, X1, Z1 - 0.05, skirtH, y0);
  latPanel(HOLE.x0, HOLE.x1, Z1 - 0.05, skirtH - HOLE.h, y0 + HOLE.h);
  world.collider(new THREE.Vector3((X0 + HOLE.x0) / 2, y0 + skirtH / 2, Z1 - 0.05), new THREE.Vector3(HOLE.x0 - X0, skirtH, 0.08));
  world.collider(new THREE.Vector3((HOLE.x1 + X1) / 2, y0 + skirtH / 2, Z1 - 0.05), new THREE.Vector3(X1 - HOLE.x1, skirtH, 0.08));
  // west side panel
  const side = new THREE.PlaneGeometry(Z1 - Z0, skirtH);
  batch.add(side, lat, { matrix: TR(X0, y0 + skirtH / 2, cz, 0, Math.PI / 2, 0) });
  world.collider(new THREE.Vector3(X0, y0 + skirtH / 2, cz), new THREE.Vector3(0.08, skirtH, Z1 - Z0));
  world.collider(new THREE.Vector3(X1, y0 + skirtH / 2, cz), new THREE.Vector3(0.08, skirtH, Z1 - Z0));
  // entrance frame + porch door on the back wall
  batch.add(new THREE.BoxGeometry(0.08, HOLE.h, 0.08), trim, { matrix: T(HOLE.x0, y0 + HOLE.h / 2, Z1 - 0.02), color: woodDark });
  batch.add(new THREE.BoxGeometry(0.08, HOLE.h, 0.08), trim, { matrix: T(HOLE.x1, y0 + HOLE.h / 2, Z1 - 0.02), color: woodDark });
  batch.add(new THREE.BoxGeometry(HOLE.x1 - HOLE.x0 + 0.16, 0.08, 0.08), trim, { matrix: T(9.0, y0 + HOLE.h, Z1 - 0.02), color: woodDark });
  batch.add(new THREE.BoxGeometry(1.2, 2.2, 0.08), trim, { matrix: T(9.0, deckY + 1.1, Z0 + 0.04), color: 0x1b5fae });
  batch.add(new THREE.PlaneGeometry(0.7, 0.8), darkGlassMat(), { matrix: T(9.0, deckY + 1.5, Z0 + 0.085), castShadow: false });
  batch.add(new THREE.SphereGeometry(0.1, 8, 6), warmGlowMat(game), { matrix: T(10.0, deckY + 2.4, Z0 + 0.14), castShadow: false });

  // --- inside the den
  const dirt = trim; // dark soil via vertex colour
  batch.add(new THREE.PlaneGeometry(X1 - X0 - 0.2, Z1 - Z0 - 0.1).rotateX(-Math.PI / 2), dirt, { matrix: T(cx, y0 + 0.012, cz), castShadow: false, color: 0x5a4330 });
  // old blanket (lumpy plaid)
  const blanket = new THREE.BoxGeometry(1.7, 0.1, 1.2, 8, 1, 6);
  const bp = blanket.getAttribute('position') as THREE.BufferAttribute;
  const br = new Rng(55);
  for (let i = 0; i < bp.count; i++) if (bp.getY(i) > 0) bp.setY(i, bp.getY(i) + br.range(0, 0.07) + Math.sin(bp.getX(i) * 4) * 0.03);
  blanket.computeVertexNormals();
  const plaid = cached('mat:plaid', () => new THREE.MeshStandardMaterial({ map: plaidTexture(), roughness: 1 }));
  batch.add(blanket, plaid, { matrix: T(10.9, y0 + 0.06, 23.1, 0.25), castShadow: false });
  // pillow
  batch.add(new THREE.SphereGeometry(0.28, 10, 6).scale(1.2, 0.45, 0.8), trim, { matrix: T(11.5, y0 + 0.2, 22.6), color: 0xf2e6c8 });
  // treasure pile of shiny washed things
  const shiny = cached('mat:treasureGold', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.9 }));
  const plastic = shiny;
  const tr = new Rng(99);
  const px = 6.9,
    pz = 22.9;
  batch.add(new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), dirt, { matrix: T(px, y0, pz), color: 0x5a4330 });
  const golds: any[] = [];
  const plas: any[] = [];
  for (let i = 0; i < 26; i++) {
    const a = tr.range(0, 6.28),
      d = tr.range(0, 0.5);
    const x = Math.cos(a) * d,
      z = Math.sin(a) * d;
    const y = 0.22 * (1 - d / 0.55) + 0.03;
    const k = tr.int(0, 5);
    if (k === 0) golds.push({ geo: new THREE.CylinderGeometry(0.06, 0.06, 0.015, 12), color: 0xf2c14e, matrix: TR(x, y, z, tr.range(-0.5, 0.5), 0, tr.range(-0.5, 0.5)) });
    else if (k === 1) golds.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), color: tr.pick([0xd8d8d8, 0xc0392b]), matrix: TR(x, y, z, tr.range(-0.6, 0.6), 0, 0) });
    else if (k === 2) golds.push({ geo: new THREE.CapsuleGeometry(0.018, 0.2, 3, 6), color: 0xe6e6e6, matrix: TR(x, y, z, 0, tr.range(0, 3), Math.PI / 2) });
    else if (k === 3) plas.push({ geo: new THREE.SphereGeometry(0.04, 8, 6), color: tr.pick([0x5ad1ff, 0xff5d8f, 0x7dff9a, 0xffd23f]), matrix: T(x, y + 0.02, z) });
    else golds.push({ geo: new THREE.TorusGeometry(0.05, 0.015, 6, 12), color: 0xf2c14e, matrix: TR(x, y, z, 1.4, 0, 0) });
  }
  // the crown jewel: a shiny CD and a washed phone and a rubber duck
  golds.push({ geo: new THREE.CylinderGeometry(0.12, 0.12, 0.01, 20), color: 0xe8f0ff, matrix: TR(0.1, 0.28, -0.05, 0.4, 0, 0.2) });
  golds.push({ geo: new THREE.BoxGeometry(0.08, 0.015, 0.16), color: 0x333844, matrix: TR(-0.2, 0.2, 0.1, 0.3, 0.6, 0) });
  plas.push({ geo: new THREE.SphereGeometry(0.07, 10, 8), color: 0xffd21f, matrix: T(0.3, 0.12, 0.25) });
  plas.push({ geo: new THREE.SphereGeometry(0.045, 10, 8), color: 0xffd21f, matrix: T(0.33, 0.21, 0.27) });
  plas.push({ geo: new THREE.ConeGeometry(0.02, 0.05, 6), color: 0xff8c1a, matrix: TR(0.37, 0.2, 0.28, 0, 0, -Math.PI / 2) });
  batch.add(mergeColored(golds), shiny, { matrix: T(px, y0, pz), castShadow: false });
  batch.add(mergeColored(plas), plastic, { matrix: T(px, y0, pz), castShadow: false });
  // Mom's food bowl
  batch.add(
    mergeColored([
      { geo: new THREE.CylinderGeometry(0.2, 0.14, 0.09, 16), color: 0xd8412f },
      { geo: new THREE.CylinderGeometry(0.16, 0.16, 0.02, 16), color: 0x7a4a24, matrix: T(0, 0.04, 0) },
    ]),
    trim,
    { matrix: T(8.4, y0 + 0.05, 22.6) },
  );
  // fairy lights along the deck edge and inside
  const glow = warmGlowMat(game);
  const bulbs: any[] = [];
  for (let x = X0 + 0.2; x <= X1 - 0.2; x += 0.3) {
    const sag = Math.sin(((x - X0) / (X1 - X0)) * Math.PI * 4) * 0.05;
    bulbs.push({ geo: new THREE.SphereGeometry(0.035, 6, 4), color: 0xffffff, matrix: T(x, deckY - 0.22 + sag, Z1 - 0.12) });
    bulbs.push({ geo: new THREE.SphereGeometry(0.03, 6, 4), color: 0xffffff, matrix: T(x, deckY - 0.2 + sag, Z0 + 0.4) });
  }
  batch.add(mergeColored(bulbs), glow, { castShadow: false });
  // HOME sign on a stick by the entrance
  const home = atlas.draw(256, 110, (ctx, w, h) => drawHomeSign(ctx, w, h));
  batch.add(new THREE.BoxGeometry(0.05, 0.9, 0.05), trim, { matrix: T(10.05, y0 + 0.45, Z1 + 0.18), color: woodDark });
  batch.add(atlas.quad(home, 0.7, 0.3), home.page.glowMat, { matrix: TR(10.05, y0 + 0.82, Z1 + 0.22, 0, -0.12, 0.05), castShadow: false });
  // warm light spilling out of the den + under the porch lamp (night)
  lightPools(game, world, [
    { x: 9.0, y: y0, z: Z1 - 1.1, r: 2.2 },
    { x: 9.6, y: y0, z: Z1 + 1.6, r: 2.7 },
  ], batch);
  // welcome mat
  batch.add(new THREE.BoxGeometry(0.9, 0.02, 0.55), trim, { matrix: T(9.0, y0 + 0.01, Z1 + 0.35), color: 0x8a5a2e, castShadow: false });
}

function drawShopSignLite(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, bg: string, fg: string) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 5;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  ctx.fillStyle = fg;
  ctx.font = `${h * 0.42}px 'JS-Lilita', 'Arial Black', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2, w * 0.9);
}

// ============================================================================================ plaza

async function buildPlaza(game: Game, world: World, batch: Batch) {
  const atlas = sharedAtlas(game);
  const trim = trimMat();
  const y = walkY(25, 15);
  // cotton candy cart
  const ccx = 22.5,
    ccz = 12.2;
  const ccSign = atlas.draw(384, 128, (ctx, w, h) => drawCartSign(ctx, w, h, 'cotton'));
  cart(batch, world, ccx, y, ccz, 0xfff0f7, 0xff9fd2, '#ff9fd2', '#ffffff', ccSign, atlas);
  // low display stands in front of the carts: raccoon height (the counters are too high for a round boy)
  displayStand(batch, world, ccx, y, ccz + 0.78, 0xff9fd2);
  for (let i = 0; i < 4; i++) spawnCottonCandy(game, new THREE.Vector3(ccx - 0.6 + i * 0.4, y + 0.36, ccz + 0.78), i);
  // hot dog cart
  const hdx = 28.8,
    hdz = 12.0;
  const hdSign = atlas.draw(384, 128, (ctx, w, h) => drawCartSign(ctx, w, h, 'hotdog'));
  cart(batch, world, hdx, y, hdz, 0xcfd6dc, 0x9aa4ad, '#d4312b', '#ffd23f', hdSign, atlas);
  displayStand(batch, world, hdx, y, hdz + 0.78, 0xd4312b);
  for (let i = 0; i < 3; i++) spawnHotDog(game, new THREE.Vector3(hdx - 0.45 + i * 0.45, y + 0.36, hdz + 0.78), 0.1 * i);
  // benches facing the mural
  placeBatched(world, batch, bench(), [
    { x: 23.5, y, z: 17.2, ry: -Math.PI / 2 },
    { x: 23.5, y, z: 20.2, ry: -Math.PI / 2 },
  ], { collider: new THREE.Vector3(1.8, 0.62, 0.55) });
  // kit:1 planter (big raised bed)
  const bed = mergeColored([
    { geo: new THREE.BoxGeometry(2.6, 0.75, 1.8), color: 0x9c5a3c, matrix: T(0, 0.375, 0) },
    { geo: new THREE.BoxGeometry(2.72, 0.08, 1.92), color: 0xc9c1b3, matrix: T(0, 0.78, 0) },
    { geo: new THREE.BoxGeometry(2.4, 0.04, 1.6), color: 0x4b3222, matrix: T(0, 0.76, 0) },
  ]);
  batch.add(bed, trim, { matrix: T(29.6, y, 19.6) });
  world.collider(new THREE.Vector3(29.6, y + 0.4, 19.6), new THREE.Vector3(2.7, 0.8, 1.9));
  const r = new Rng(4);
  const bushes: any[] = [];
  for (let i = 0; i < 7; i++) {
    bushes.push({ geo: new THREE.IcosahedronGeometry(r.range(0.35, 0.5), 1), color: r.pick([0x4f9a3c, 0x5fae45, 0x3f8a36]), matrix: T(r.range(-0.9, 0.9), 1.05 + r.range(0, 0.2), r.range(-0.55, 0.55)) });
  }
  for (let i = 0; i < 14; i++) bushes.push({ geo: new THREE.IcosahedronGeometry(0.08, 0), color: r.pick([0xff6fa8, 0xffd23f, 0xb36bff, 0xffffff]), matrix: T(r.range(-1.1, 1.1), r.range(1.2, 1.5), r.range(-0.7, 0.7)) });
  batch.add(mergeColored(bushes), cached('mat:foliage', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true })), { matrix: T(29.6, y, 19.6) });
  // trees + grates along the east edge
  placeBatched(world, batch, streetTree(2), [{ x: 31.0, y, z: 14.8, ry: 0.4 }], { collider: new THREE.Vector3(0.36, 3, 0.36) });
  placeBatched(world, batch, treeGrate(), [{ x: 31.0, y, z: 14.8, ry: 0 }]);
  placeBatched(world, batch, bikeRack(), [{ x: 19.4, y, z: 10.3, ry: Math.PI / 2 }], { collider: new THREE.Vector3(2.2, 0.9, 0.2) });
  // café set
  spawnCafeTable(game, new THREE.Vector3(26.2, y, 16.2));
  spawnCafeChair(game, new THREE.Vector3(25.5, y, 16.2), Math.PI / 2, 0xd4312b);
  spawnCafeChair(game, new THREE.Vector3(26.9, y, 16.2), -Math.PI / 2, 0xd4312b);
  spawnTrashCan(game, new THREE.Vector3(31.2, y, 10.0));
  spawnTrashCan(game, new THREE.Vector3(18.7, y, 21.0), 1);
  // Jimothy Commons sign on the Knit building's west wall
  const cs = atlas.draw(512, 160, (ctx, w, h) => drawCommonsSign(ctx, w, h));
  batch.add(atlas.quad(cs, 3.2, 1.0), cs.page.glowMat, { matrix: TR(PLAZA.x1 - 0.03, 3.4, 16.5, 0, -Math.PI / 2, 0), castShadow: false });
  // string lights zig-zagging across the plaza
  const glow = warmGlowMat(game);
  const bulbs: any[] = [];
  const wires: any[] = [];
  const topY = 5.2;
  for (let k = 0; k < 5; k++) {
    const za = PLAZA.z0 + 1.2 + k * 2.6,
      zb = za + 1.3;
    const a = new THREE.Vector3(PLAZA.x0 + 0.1, topY, za),
      b = new THREE.Vector3(PLAZA.x1 - 0.1, topY, zb);
    const n = 18;
    let prev = a.clone();
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      p.y -= Math.sin(t * Math.PI) * 1.1;
      bulbs.push({ geo: new THREE.SphereGeometry(0.07, 6, 4), color: 0xffffff, matrix: T(p.x, p.y - 0.08, p.z) });
      const mid = prev.clone().add(p).multiplyScalar(0.5);
      const len = prev.distanceTo(p);
      const wire = new THREE.CylinderGeometry(0.012, 0.012, len, 4);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().sub(prev).normalize());
      wires.push({ geo: wire, color: 0x222222, matrix: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)) });
      prev = p;
    }
  }
  batch.add(mergeColored(bulbs), glow, { castShadow: false });
  batch.add(mergeColored(wires), trim, { castShadow: false });
  lightPools(game, world, [
    { x: 25, y: y - ROAD.curb, z: 13.5, r: 5.5 },
    { x: 25, y: y - ROAD.curb, z: 18.5, r: 5.5 },
  ], batch);
}

/** Low wooden stand in front of a cart (items sit on it at y + 0.35). */
function displayStand(batch: Batch, world: World, x: number, y: number, z: number, accent: number) {
  batch.add(
    mergeColored([
      { geo: new THREE.BoxGeometry(1.7, 0.3, 0.42), color: 0xb98d5a, matrix: T(0, 0.15, 0) },
      { geo: new THREE.BoxGeometry(1.76, 0.05, 0.48), color: accent, matrix: T(0, 0.325, 0) },
    ]),
    trimMat(),
    { matrix: T(x, y, z) },
  );
  world.collider(new THREE.Vector3(x, y + 0.175, z), new THREE.Vector3(1.76, 0.35, 0.48));
}

/** Vendor cart with a striped canopy and a sign. */
function cart(batch: Batch, world: World, x: number, y: number, z: number, body: number, trimC: number, a: string, b: string, sign: AtlasRect, atlas: ReturnType<typeof sharedAtlas>) {
  const trim = trimMat();
  const geo = mergeColored([
    { geo: new THREE.BoxGeometry(1.8, 0.85, 0.9), color: body, matrix: T(0, 0.62, 0) },
    { geo: new THREE.BoxGeometry(1.9, 0.06, 1.0), color: trimC, matrix: T(0, 1.07, 0) },
    ...[-0.7, 0.7].map((dx) => ({ geo: new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), color: 0x2a2a2a, matrix: TR(dx, 0.2, 0.47, Math.PI / 2, 0, 0) })),
    ...[-0.7, 0.7].map((dx) => ({ geo: new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), color: 0x2a2a2a, matrix: TR(dx, 0.2, -0.47, Math.PI / 2, 0, 0) })),
    ...[[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]].map(([dx, dz]) => ({ geo: new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), color: 0xdddddd, matrix: T(dx, 1.72, dz) })),
    { geo: new THREE.BoxGeometry(0.1, 0.05, 1.0), color: 0x6b4a2e, matrix: T(-1.05, 0.9, 0) },
  ]);
  batch.add(geo, trim, { matrix: T(x, y, z) });
  const canopy = applyStripeRow(new THREE.ConeGeometry(1.45, 0.55, 4, 1, true).rotateY(Math.PI / 4), a, b, 2, 8);
  batch.add(canopy, stripeMaterial(), { matrix: T(x, y + 2.62, z, 0, 1, 1, 0.75), color: '#ffffff' });
  batch.add(atlas.quad(sign, 1.5, 0.5), sign.page.glowMat, { matrix: T(x, y + 1.62, z + 0.43), castShadow: false });
  batch.add(atlas.quad(sign, 1.5, 0.5), sign.page.glowMat, { matrix: T(x, y + 1.62, z - 0.43, Math.PI), castShadow: false });
  world.collider(new THREE.Vector3(x, y + 0.55, z), new THREE.Vector3(1.9, 1.1, 1.0));
  world.collider(new THREE.Vector3(x, y + 2.5, z), new THREE.Vector3(2.0, 0.3, 1.5));
}

// ============================================================================================ alleys

function buildAlleyStuff(game: Game, world: World, batch: Batch, water?: WaterSystem) {
  const y = roadY(0, 26);
  // dumpsters
  spawnDumpster(game, new THREE.Vector3(-3.5, y, 23.3), 0, 0x2f6b4a);
  spawnDumpster(game, new THREE.Vector3(34.6, y, 23.75), 0, 0x2c5aa0);
  spawnDumpster(game, new THREE.Vector3(-15, roadY(-15, -23.4), -23.3), Math.PI, 0x2c5aa0);
  spawnDumpster(game, new THREE.Vector3(38, roadY(38, -23.4), -23.3), Math.PI, 0x2f6b4a);
  // trash cans, bags, pallets, boxes, crates
  const cans: [number, number][] = [[-1, 22.7], [0, 22.7], [16.5, 22.7], [-24, 22.8], [42, 22.8]];
  cans.forEach(([x, z], i) => spawnTrashCan(game, new THREE.Vector3(x, y, z), i, 'metal'));
  spawnTrashCan(game, new THREE.Vector3(-13.5, roadY(-13.5, -22.7), -22.7), 0, 'metal');
  spawnTrashCan(game, new THREE.Vector3(12, roadY(12, -22.7), -22.7), 0, 'metal');
  const bags: [number, number][] = [[-2.2, 24.4], [-1.6, 24.8], [17.4, 23.1], [-12.8, -23.9]];
  bags.forEach(([x, z], i) => spawnTrashBag(game, new THREE.Vector3(x, roadY(x, z), z), i));
  spawnPallet(game, new THREE.Vector3(-8, y, 23.0), 0.2);
  spawnPallet(game, new THREE.Vector3(-8, y + 0.16, 23.0), 0.5);
  spawnPallet(game, new THREE.Vector3(25, roadY(25, -23), -23.2), 1.2);
  const boxes: [number, number, number][] = [[20, 22.8, 0.5], [20.6, 23.4, 0.2], [44.5, 23.2, 0.1]];
  boxes.forEach(([x, z, r]) => spawnCardboardBox(game, new THREE.Vector3(x, roadY(x, z), z), r));
  spawnCrate(game, new THREE.Vector3(-30, y, 22.9), 0.3);
  spawnCrate(game, new THREE.Vector3(-30.2, y + 0.63, 22.9), 0.8);
  // puddles: great washing spots
  const puddles: [number, number, number][] = [[-10, 26.5, 1.4], [3.5, 27.8, 1.1], [15.8, 28.0, 1.5], [27, 25.6, 1.2], [-31, 27.2, 1.6], [43, 26.4, 1.0], [-35, -25.6, 1.3], [22, -26.2, 1.1]];
  if (water) {
    puddles.forEach(([x, z, r], i) => water.addCircle({ name: `Alley Puddle ${i + 1}`, kind: 'puddle', center: new THREE.Vector3(x, roadY(x, z) + 0.015, z), radius: r, depth: 0.05 }));
  }
  // fence between the south alley and the parking lot (gap behind Jimothy's den for the car entrance)
  const fm = furnMat();
  const fence = (x0: number, x1: number, z: number) => {
    const parts: any[] = [];
    for (let x = x0; x <= x1 + 0.01; x += 0.25) parts.push({ geo: new THREE.BoxGeometry(0.12, 1.2 + ((x * 4) % 2 ? 0 : 0.08), 0.03), color: ((x * 4) | 0) % 3 ? 0xb5895a : 0xa67c50, matrix: T(x, 0.6, 0) });
    parts.push({ geo: new THREE.BoxGeometry(x1 - x0, 0.08, 0.05), color: 0x8a643c, matrix: T((x0 + x1) / 2, 0.35, -0.03) });
    parts.push({ geo: new THREE.BoxGeometry(x1 - x0, 0.08, 0.05), color: 0x8a643c, matrix: T((x0 + x1) / 2, 0.95, -0.03) });
    batch.add(mergeColored(parts), fm, { matrix: T(0, roadY(0, z), z) });
    world.collider(new THREE.Vector3((x0 + x1) / 2, roadY(0, z) + 0.6, z), new THREE.Vector3(x1 - x0, 1.2, 0.12));
  };
  fence(-18, 2, ALLEY_S.z1 + 0.1);
  fence(17, 34, ALLEY_S.z1 + 0.1);
  // "no parking" sign in the alley
  const atlas = sharedAtlas(game);
  const np = atlas.draw(160, 200, (ctx, w, h) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c62f2f';
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#c62f2f';
    ctx.font = `bold ${h * 0.2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('NO', w / 2, h * 0.3);
    ctx.fillText('PARKING', w / 2, h * 0.52);
    ctx.font = `bold ${h * 0.08}px sans-serif`;
    ctx.fillStyle = '#333';
    ctx.fillText('(raccoons exempt)', w / 2, h * 0.78);
  });
  batch.add(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), fm, { matrix: T(-20, y + 1.3, ALLEY_S.z1 - 0.3), color: 0x6c747d });
  batch.add(atlas.slab(np, 0.45, 0.56, 0.02), np.page.mat, { matrix: T(-20, y + 2.3, ALLEY_S.z1 - 0.3) });
  world.collider(new THREE.Vector3(-20, y + 1.3, ALLEY_S.z1 - 0.3), new THREE.Vector3(0.1, 2.6, 0.1));
  // a utility pole with a transformer at each end of the south alley
  for (const x of [-46, 46]) {
    batch.add(
      mergeColored([
        { geo: new THREE.CylinderGeometry(0.14, 0.18, 9, 8), color: 0x6b4a32, matrix: T(0, 4.5, 0) },
        { geo: new THREE.BoxGeometry(1.8, 0.12, 0.12), color: 0x6b4a32, matrix: T(0, 8.3, 0) },
        { geo: new THREE.CylinderGeometry(0.3, 0.3, 0.7, 10), color: 0x8d949b, matrix: T(0.3, 7.3, 0.25) },
      ]),
      fm,
      { matrix: T(x, y, ALLEY_S.z1 - 0.4) },
    );
    cylinderCollider(game, new THREE.Vector3(x, y + 4.5, ALLEY_S.z1 - 0.4), 0.18, 9);
  }
}

// ============================================================================================ market & parking

function buildMarket(game: Game, world: World, batch: Batch) {
  const trim = trimMat();
  const atlas = sharedAtlas(game);
  const tops = ['#e8563a', '#2a7de1', '#ffd23f', '#3cb371', '#ff7eb6', '#f3efe6'];
  const r = new Rng(21);
  const stalls: [number, number][] = [[-46, -46], [-38, -46], [-30, -46], [-22, -46], [-42, -36], [-26, -36]];
  const produce = cached('mat:foliage', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true }));
  stalls.forEach(([x, z], i) => {
    const y = roadY(x, z);
    const col = tops[i % tops.length];
    const parts: any[] = [];
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) parts.push({ geo: new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), color: 0xcccccc, matrix: T(dx, 1.2, dz) });
    parts.push({ geo: new THREE.BoxGeometry(2.6, 0.08, 1.0), color: 0xf3efe6, matrix: T(0, 0.85, 0.6) });
    for (const dx of [-1.1, 1.1]) parts.push({ geo: new THREE.BoxGeometry(0.06, 0.85, 0.9), color: 0xbbbbbb, matrix: T(dx, 0.42, 0.6) });
    batch.add(mergeColored(parts), trim, { matrix: T(x, y, z) });
    batch.add(new THREE.ConeGeometry(2.1, 0.8, 4, 1).rotateY(Math.PI / 4), trim, { matrix: T(x, y + 2.8, z), color: col });
    const tc = world.collider(new THREE.Vector3(x, y + 2.55, z), new THREE.Vector3(2.9, 0.25, 2.9));
    tc.setRestitution(0.9);
    world.collider(new THREE.Vector3(x, y + 0.45, z + 0.6), new THREE.Vector3(2.6, 0.9, 1.0));
    // produce boxes
    const fruit: any[] = [];
    for (let b = 0; b < 3; b++) {
      const bx = -0.8 + b * 0.8;
      fruit.push({ geo: new THREE.BoxGeometry(0.62, 0.16, 0.45), color: 0xb98d5a, matrix: T(bx, 0.97, 0.6) });
      const fc = r.pick([0xd4312b, 0xff8c1a, 0xffd23f, 0x5fae45, 0x8f3fbf, 0xff5d8f]);
      for (let k = 0; k < 8; k++) fruit.push({ geo: new THREE.IcosahedronGeometry(0.07, 0), color: fc, matrix: T(bx + r.range(-0.24, 0.24), 1.08, 0.6 + r.range(-0.16, 0.16)) });
    }
    batch.add(mergeColored(fruit), produce, { matrix: T(x, y, z) });
    if (i % 2 === 0) spawnCrate(game, new THREE.Vector3(x + 1.9, y, z + 0.9), r.range(0, 1));
  });
  // banner at the lot entrance (from the north alley)
  const banner = atlas.draw(768, 128, (ctx, w, h) => drawMarketBanner(ctx, w, h));
  const bx = -30,
    bz = -30.2;
  const y = roadY(bx, bz);
  batch.add(atlas.slab(banner, 7.5, 1.25, 0.04), banner.page.mat, { matrix: T(bx, y + 3.6, bz) });
  for (const dx of [-3.9, 3.9]) {
    batch.add(new THREE.CylinderGeometry(0.07, 0.07, 4.3, 8), trim, { matrix: T(bx + dx, y + 2.15, bz), color: 0x2f5d4a });
    cylinderCollider(game, new THREE.Vector3(bx + dx, y + 2.15, bz), 0.1, 4.3);
  }
}

function buildParkingLotDecor(game: Game, world: World, batch: Batch) {
  const atlas = sharedAtlas(game);
  const fm = furnMat();
  const sign = atlas.draw(320, 200, (ctx, w, h) => drawParkingSign(ctx, w, h));
  const x = 33,
    z = 31.2;
  const y = roadY(x, z);
  batch.add(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), fm, { matrix: T(x, y + 1.3, z), color: 0x6c747d });
  batch.add(atlas.slab(sign, 1.2, 0.75, 0.03), sign.page.mat, { matrix: T(x, y + 2.35, z, Math.PI) });
  world.collider(new THREE.Vector3(x, y + 1.3, z), new THREE.Vector3(0.12, 2.6, 0.12));
  // parking lot lamps
  const lamps: Xf[] = [
    { x: -6, y: roadY(-6, 41.5), z: 41.5, ry: 0 },
    { x: 20, y: roadY(20, 41.5), z: 41.5, ry: Math.PI },
  ];
  placeBatched(world, batch, historicLamp(game), lamps, { collider: new THREE.Vector3(0.3, 4.6, 0.3) });
  lightPools(game, world, lamps.map((l) => ({ x: l.x, y: l.y, z: l.z, r: 6 })), batch);
}

// ============================================================================================ street furniture

const CLOCK = { x: -3, z: -7.3 };

function buildStreetFurniture(game: Game, world: World, batch: Batch, rng: Rng) {
  const atlas = sharedAtlas(game);
  const lampXf: Xf[] = [];
  const pools: { x: number; y: number; z: number; r: number }[] = [];
  const treeXf: Xf[][] = [[], [], [], []];
  const grates: Xf[] = [];
  const meters: Xf[] = [];
  for (const side of [-1, 1]) {
    const z = side * 6.35;
    for (let x = -47; x <= 47; x += 14) {
      if (side > 0 && x > 20 && x < 30) continue;
      const y = walkY(x, z);
      lampXf.push({ x, y, z, ry: 0 });
      pools.push({ x, y: y - 0.13, z: side * 5.2, r: 4.2 });
    }
    for (let x = -40; x <= 40; x += 14) {
      if (side > 0 && x > 16 && x < 34) continue;
      if (side < 0 && Math.abs(x - CLOCK.x) < 3) continue;
      const tz = side * 6.7;
      const y = walkY(x, tz);
      treeXf[rng.int(0, 2)].push({ x, y, z: tz, ry: rng.range(0, 6.28), s: rng.range(0.85, 1.0) });
      grates.push({ x, y, z: tz, ry: 0 });
    }
    for (let x = -44 + 3.25; x <= 44; x += 6.5) {
      if (x > 19 && x < 31) continue;
      if (rng.chance(0.3)) continue;
      const mz = side * 5.98;
      meters.push({ x, y: walkY(x, mz), z: mz, ry: side > 0 ? Math.PI : 0 });
    }
  }
  placeBatched(world, batch, historicLamp(game), lampXf, { collider: new THREE.Vector3(0.3, 4.6, 0.3), name: 'historicLamps' });
  lightPools(game, world, pools, batch);
  treeXf.forEach((xf, i) => placeBatched(world, batch, streetTree(i), xf, { collider: new THREE.Vector3(0.36, 3, 0.36) }));
  placeBatched(world, batch, treeGrate(), grates);
  placeBatched(world, batch, parkingMeter(), meters, { collider: new THREE.Vector3(0.2, 1.35, 0.2) });
  placeBatched(world, batch, hydrant(), [
    { x: -36.5, y: walkY(-36.5, -6.1), z: -6.1, ry: 0 },
    { x: 11.5, y: walkY(11.5, 6.1), z: 6.1, ry: Math.PI },
    { x: 37.5, y: walkY(37.5, -6.1), z: -6.1, ry: 0 },
  ], { collider: new THREE.Vector3(0.4, 0.8, 0.4) });
  placeBatched(world, batch, bench(), [
    { x: -27, y: walkY(-27, -8.4), z: -8.4, ry: 0 },
    { x: 9, y: walkY(9, -8.4), z: -8.4, ry: 0 },
    { x: -36, y: walkY(-36, 8.4), z: 8.4, ry: Math.PI },
    { x: 38, y: walkY(38, 8.4), z: 8.4, ry: Math.PI },
  ], { collider: new THREE.Vector3(1.8, 0.62, 0.55) });
  placeBatched(world, batch, bikeRack(), [
    { x: -12, y: walkY(-12, -8.2), z: -8.2, ry: 0 },
    { x: 46.5, y: walkY(46.5, 8.2), z: 8.2, ry: 0 },
  ], { collider: new THREE.Vector3(2.2, 0.9, 0.2) });
  const newsColors = [0xd8412f, 0x2c6fbb, 0xf2c230, 0x2f9e5b];
  placeBatched(world, batch, newsBox(), [
    { x: -50.5, y: walkY(-50.5, -8.4), z: -8.4, ry: 0, color: newsColors[0] },
    { x: -49.9, y: walkY(-49.9, -8.4), z: -8.4, ry: 0, color: newsColors[1] },
    { x: 49.5, y: walkY(49.5, 8.4), z: 8.4, ry: Math.PI, color: newsColors[2] },
    { x: 50.1, y: walkY(50.1, 8.4), z: 8.4, ry: Math.PI, color: newsColors[3] },
  ], { collider: new THREE.Vector3(0.52, 1.1, 0.46) });
  placeBatched(world, batch, planter(2), [
    { x: -45, y: walkY(-45, 8.3), z: 8.3, ry: 0 },
    { x: 1, y: walkY(1, -8.3), z: -8.3, ry: 0 },
  ], { collider: new THREE.Vector3(1.6, 0.62, 0.8) });
  // trash cans (physics)
  const cans: [number, number][] = [[-40, -6.4], [-10, -6.4], [44, -6.4], [-33, 6.4], [36, 6.4]];
  for (const [x, z] of cans) spawnTrashCan(game, new THREE.Vector3(x, walkY(x, z), z), rng.range(0, 6));
  // sandwich boards outside shops
  const boards = BOARD_JOKES.map((l, i) => atlas.draw(200, 280, (ctx, w, h) => drawBoard(ctx, w, h, l, i)));
  const spots: [number, number, number][] = [[46, -7.6, 0.2], [-27.5, -7.6, -0.1], [-15, -7.6, 0.15], [-24, 7.6, Math.PI + 0.1], [5.5, 7.6, Math.PI - 0.2], [-8, 7.6, Math.PI]];
  spots.forEach(([x, z, r], i) => spawnSandwichBoard(game, atlas, boards[i % boards.length], new THREE.Vector3(x, walkY(x, z), z), r));
  // café tables outside Starbrews & Bean Me Up
  for (const [x, z] of [[48, -7.9], [-29, -7.9]] as [number, number][]) {
    const y = walkY(x, z);
    spawnCafeTable(game, new THREE.Vector3(x, y, z));
    spawnCafeChair(game, new THREE.Vector3(x - 0.75, y, z), Math.PI / 2);
    spawnCafeChair(game, new THREE.Vector3(x + 0.75, y, z), -Math.PI / 2);
    spawnCoffeeCup(game, new THREE.Vector3(x + 0.12, y + 0.78, z), x > 0 ? 'starbrews' : 'beanmeup');
  }
  // the Ballard street clock (bobblehead on top)
  const cy = walkY(CLOCK.x, CLOCK.z);
  const iron = 0x1f2d27;
  batch.add(
    mergeColored([
      { geo: new THREE.CylinderGeometry(0.32, 0.4, 0.6, 8), color: iron, matrix: T(0, 0.3, 0) },
      { geo: new THREE.CylinderGeometry(0.14, 0.18, 3.6, 10), color: iron, matrix: T(0, 2.4, 0) },
      { geo: new THREE.CylinderGeometry(0.3, 0.2, 0.3, 10), color: 0xb8923f, matrix: T(0, 4.3, 0) },
      { geo: new THREE.BoxGeometry(1.0, 1.0, 1.0), color: iron, matrix: T(0, 4.95, 0) },
      { geo: new THREE.BoxGeometry(1.12, 0.1, 1.12), color: 0xb8923f, matrix: T(0, 5.5, 0) },
      { geo: new THREE.ConeGeometry(0.2, 0.35, 8), color: iron, matrix: T(0, 5.95, 0) },
    ]),
    furnMat(),
    { matrix: T(CLOCK.x, cy, CLOCK.z) },
  );
  const face = atlas.draw(192, 192, (ctx, w, h) => drawClockFace(ctx, w, h));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    batch.add(atlas.quad(face, 0.86, 0.86), face.page.glowMat, { matrix: T(CLOCK.x + Math.sin(a) * 0.505, cy + 4.95, CLOCK.z + Math.cos(a) * 0.505, a), castShadow: false });
  }
  cylinderCollider(game, new THREE.Vector3(CLOCK.x, cy + 2.4, CLOCK.z), 0.2, 4.8);
  world.collider(new THREE.Vector3(CLOCK.x, cy + 5.0, CLOCK.z), new THREE.Vector3(1.12, 1.1, 1.12));
}

// ============================================================================================ parked cars

const CAR_MODELS = ['sedan', 'taxi', 'suv', 'hatchback-sports', 'van', 'suv-luxury', 'sedan-sports', 'truck'];
const CAR_SCALE = 1.45;

async function parkCars(game: Game, world: World, rng: Rng, batch: Batch) {
  const spots: { x: number; z: number; ry: number }[] = [];
  // Ballard Ave parking strips (cars face the direction of travel)
  for (const x of [-40.5, -34, -21, -14.5, -1.5, 5, 11.5, 36.5]) if (rng.chance(0.85)) spots.push({ x, z: -4.45, ry: -Math.PI / 2 });
  for (const x of [-37.5, -31, -18, -11.5, -5, 8, 14.5, 36]) if (rng.chance(0.85)) spots.push({ x, z: 4.45, ry: Math.PI / 2 });
  // parking lot stalls (nose in)
  for (const x of [-12.5, -9.5, -3.5, 20.5, 26.5, 29.5]) if (rng.chance(0.8)) spots.push({ x, z: 33.4, ry: 0 });
  for (const x of [-9.5, -0.5, 8.5, 14.5, 23.5, 29.5]) if (rng.chance(0.8)) spots.push({ x, z: 49.6, ry: Math.PI });
  const byModel = new Map<string, Xf[]>();
  for (const s of spots) {
    const m = rng.pick(CAR_MODELS);
    let arr = byModel.get(m);
    if (!arr) byModel.set(m, (arr = []));
    arr.push({ x: s.x, y: roadY(s.x, s.z), z: s.z, ry: s.ry, s: CAR_SCALE });
  }
  // every car-kit model shares one colormap layout, so all parked cars use the first model's material
  let carMat: THREE.Material | null = null;
  for (const [m, xfs] of byModel) {
    const model = await loadMerged(game, `assets/models/kenney/car-kit/${m}.glb`);
    if (!model) continue;
    carMat ??= model.parts[0].mat;
    const mat = carMat;
    placeBatched(world, batch, model.parts.map((p) => ({ geo: p.geo, mat })), xfs);
    const size = model.size.clone().multiplyScalar(CAR_SCALE);
    for (const x of xfs) {
      world.collider(new THREE.Vector3(x.x, x.y + size.y * 0.38, x.z), new THREE.Vector3(size.x * 0.95, size.y * 0.76, size.z * 0.96), x.ry);
    }
  }
}

