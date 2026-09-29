import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World, ZoneBuilder } from '../../World';
import type { WaterSystem } from '../../Water';
import { MAP } from '../../terrain';
import { getKit, Batch, tree, bush, bench, rng, canvasTex, fitText, roundRect, FONT_TITLE, FONT_ROUND, FONT_BODY, GEO, type Kit, type V3 } from './kit';
import { lamps, BIRD, perched } from './decor';
import * as P from './props';

/**
 * SW zone — "The Locks" (Ballard Locks parody): a raised ship canal ("Lake Washing Ship Canal", water +2.4)
 * that steps down to Salmon Bay (-1.3) through two side-by-side lock chambers — the big one is DOWN,
 * the small one is UP — with walkable miter gates, a fish ladder of stepped pools where salmon leap
 * (see SouthSystem), an underwater-ish viewing room, and a botanical garden with a glass greenhouse.
 */

const AREA = 'The Locks';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const TOP = 3.0; // bank / wall / gate top
const CANAL_Y = 2.4; // upper water level
const BAY_Y = MAP.bayY; // -1.3
const SEABED = MAP.seabedY; // -7
const WB: [number, number] = [-144, -138];
const EB: [number, number] = [-122, -116];
const PIER: [number, number] = [-129, -126];
const LARGE: [number, number] = [-138, -129];
const SMALL: [number, number] = [-126, -122];
const Z_N = 80; // north end of the levee
const CANAL_Z0 = 84;
const GATE_UP: [number, number] = [165, 167];
const GATE_LO: [number, number] = [197, 199];
const WALL_END = 204;

const CONCRETE = 0xd2cdc0;
const CONCRETE_DARK = 0xa9a396;
const STEEL = 0x42505a;
const RAIL = 0xf0efe8;

// Fish ladder geometry
const LAD = { x0: -164, x1: -160, n: 9, z0: 161, pitch: 4.1, len: 3.6, l0: 0.8, dl: 0.2, depth: 0.75 };
const poolZ = (i: number) => LAD.z0 - i * LAD.pitch;
const poolL = (i: number) => LAD.l0 + i * LAD.dl;

export const LocksZone: ZoneBuilder = {
  name: AREA,
  async build(game: Game, world: World) {
    const kit = await getKit(game, world);
    const b = new Batch(kit, 'locks');
    const water = game.get<WaterSystem>('water')!;
    world.areas.push({ name: AREA, min: new THREE.Vector2(-180, 66), max: new THREE.Vector2(-66, 210) });

    levee(kit, b, water);
    gates(kit, b);
    railings(b);
    lockmaster(kit, b);
    await boats(kit);
    fishLadder(kit, b, water);
    viewingRoom(kit, b);
    garden(kit, b);
    plazaAndSeawall(kit, b);
    signs(kit, b);
    lawnTrees(b);

    world.poi.set('locks', V(-130, TOP + 0.4, (GATE_UP[0] + GATE_UP[1]) / 2));
    world.poi.set('fishLadder', V(-157.6, 1.4, 146));
    world.poi.set('fishViewingRoom', V(-169, 0.3, 155));

    world.npcSpawns.push(
      { zone: AREA, center: V(-92, 0, 157), radius: 11, count: 5, types: ['tourist', 'tourist', 'pedestrian'] },
      { zone: AREA, center: V(-88, 0, 126), radius: 13, count: 4, types: ['pedestrian', 'family', 'tourist'] },
      { zone: AREA, center: V(-160, 0, 100), radius: 9, count: 2, types: ['pedestrian', 'jogger'] },
      { zone: AREA, center: V(-170, 0, 132), radius: 4, count: 2, types: ['tourist'] },
    );
    kit.state.ambience.push({ pos: V(-130, 2, 185), key: 'seagull', radius: 45, every: 9, next: 3, volume: 0.5 });

    b.flush();
  },
};

// ------------------------------------------------------------------ levee, canal, chambers

function levee(kit: Kit, b: Batch, water: WaterSystem) {
  // Banks / chamber walls (one tall box each, from the seabed up — the underground part is hidden)
  const wall = (x: [number, number], z: [number, number], y0 = SEABED) => b.box([(x[0] + x[1]) / 2, (y0 + TOP) / 2, (z[0] + z[1]) / 2], [x[1] - x[0], TOP - y0, z[1] - z[0]], CONCRETE, { mat: 'concrete' });
  wall(WB, [Z_N, WALL_END]);
  wall(EB, [Z_N, WALL_END]);
  wall([WB[0], EB[1]], [Z_N, CANAL_Z0], -0.5);
  wall(PIER, [GATE_UP[0], WALL_END]);
  // coping stones along every water edge (slightly proud, lighter)
  const cope = (x: number, z0: number, z1: number) => b.box([x, TOP + 0.05, (z0 + z1) / 2], [0.5, 0.12, z1 - z0], 0xe8e4da, { mat: 'concrete', collide: false });
  for (const x of [WB[1] - 0.25, EB[0] + 0.25]) cope(x, CANAL_Z0, WALL_END);
  for (const x of [PIER[0] + 0.25, PIER[1] - 0.25]) cope(x, GATE_UP[0], WALL_END);
  b.box([-130, TOP + 0.05, CANAL_Z0 + 0.25], [16, 0.12, 0.5], 0xe8e4da, { mat: 'concrete', collide: false });
  // wet/algae bands on the chamber walls (show the different water levels)
  const band = (x: number, z0: number, z1: number, y0: number, y1: number, facing: 1 | -1) =>
    b.box([x + facing * 0.02, (y0 + y1) / 2, (z0 + z1) / 2], [0.04, y1 - y0, z1 - z0], 0x5d6b52, { collide: false, shadow: false, mat: 'concrete' });
  band(LARGE[0], GATE_UP[1], GATE_LO[0], BAY_Y - 0.3, CANAL_Y + 0.05, 1);
  band(LARGE[1], GATE_UP[1], GATE_LO[0], BAY_Y - 0.3, CANAL_Y + 0.05, -1);
  for (let i = 0; i < 9; i++) {
    // ladders down the chamber walls
    const z = GATE_UP[1] + 3 + i * 3.4;
    if (i % 3) continue;
    for (const [x, f] of [
      [LARGE[0], 1],
      [LARGE[1], -1],
    ] as [number, 1 | -1][]) {
      for (const s of [-0.25, 0.25]) b.box([x + f * 0.12, (BAY_Y - 1 + TOP) / 2, z + s], [0.06, TOP - BAY_Y + 1, 0.06], 0x6d767c, { collide: false, mat: 'metal', shadow: false });
      for (let y = BAY_Y - 0.8; y < TOP; y += 0.4) b.box([x + f * 0.12, y, z], [0.05, 0.05, 0.5], 0x6d767c, { collide: false, mat: 'metal', shadow: false });
    }
  }
  // bollards on the wall tops
  for (let z = CANAL_Z0 + 8; z < WALL_END; z += 9) {
    for (const x of [WB[0] + 1.4, EB[1] - 1.4]) {
      b.cyl([x, TOP + 0.3, z], 0.22, 0.6, 0x2b2f33, { seg: 10, collide: true, mat: 'metal' });
      b.cyl([x, TOP + 0.62, z], 0.3, 0.08, 0x2b2f33, { seg: 10, collide: false, mat: 'metal' });
    }
  }
  // Water: canal (up) + small chamber (up). The big chamber is DOWN at bay level (the bay volume shows through).
  const canal = water.addBox({ name: 'Lake Washing Ship Canal', kind: 'bay', center: V(-130, CANAL_Y, (CANAL_Z0 + GATE_UP[0]) / 2), size: [16, CANAL_Y + 0.05, GATE_UP[0] - CANAL_Z0] });
  kit.waterUV(canal, 7);
  const small = water.addBox({ name: 'Small Lock Chamber', kind: 'bay', center: V((SMALL[0] + SMALL[1]) / 2, CANAL_Y, (GATE_UP[1] + GATE_LO[0]) / 2), size: [SMALL[1] - SMALL[0], CANAL_Y - SEABED, GATE_LO[0] - GATE_UP[1]] });
  kit.waterUV(small, 7);
  // chamber floor-ish: the big chamber shows the seabed through the bay water; nothing to add

  // Grass berms on land so the raised canal reads as a levee (walkable slopes, terrain material)
  const H = TOP;
  const wx = WB[0];
  const ex = EB[1];
  const S = 7; // slope run
  const zS = 151; // berms end here (stairs + vertical quay wall to the south)
  kit.earth([
    [wx - S, 0, Z_N],
    [wx, H, Z_N],
    [wx, H, zS],
    [wx - S, 0, zS],
  ]);
  kit.earth([
    [ex, H, Z_N],
    [ex + S, 0, Z_N],
    [ex + S, 0, zS],
    [ex, H, zS],
  ]);
  kit.earth([
    [wx, H, Z_N],
    [ex, H, Z_N],
    [ex, 0, Z_N - S],
    [wx, 0, Z_N - S],
  ]);
  kit.earth([
    [wx, H, Z_N],
    [wx, 0, Z_N - S],
    [wx - S, 0, Z_N - S],
    [wx - S, 0, Z_N],
  ]);
  kit.earth([
    [ex, H, Z_N],
    [ex + S, 0, Z_N],
    [ex + S, 0, Z_N - S],
    [ex, 0, Z_N - S],
  ]);
  // stairs up to the quays at the south end of the berms
  b.stairs([wx - 8.4, 0, 153], [wx, H, 153], 3.6, CONCRETE, { mat: 'concrete' });
  b.stairs([ex + 8.4, 0, 153], [ex, H, 153], 3.6, CONCRETE, { mat: 'concrete' });
  for (const [x0, x1] of [
    [wx - 8.4, wx],
    [ex, ex + 8.4],
  ]) {
    b.box([(x0 + x1) / 2, 1.1, 151.05], [Math.abs(x1 - x0), 0.08, 0.08], RAIL, { collide: false });
    b.box([(x0 + x1) / 2, 1.1, 154.95], [Math.abs(x1 - x0), 0.08, 0.08], RAIL, { collide: false });
  }
  // lawn-level paving along the quay walls south of the stairs
  b.decal([-148, 0, 160], [8, 11], 0xd8d2c6, { mat: 'paving' });
  b.decal([-112, 0, 160], [8, 11], 0xd8d2c6, { mat: 'paving' });
}

/** Miter gate (two leaves meeting in a V that points upstream = -Z) spanning x0..x1 at z. */
function miterGate(kit: Kit, b: Batch, x0: number, x1: number, z: number, yBottom: number) {
  const w = x1 - x0;
  const hw = w / 2;
  const th = 0.28; // V depth angle
  const e = (hw * Math.tan(th)) / 2;
  const L = hw / Math.cos(th) + 0.3;
  const h = TOP - yBottom;
  const cy = (TOP + yBottom) / 2;
  for (const s of [-1, 1]) {
    const cx = x0 + hw / 2 + (s > 0 ? hw : 0);
    const rotY = s < 0 ? th : -th;
    b.box([cx, cy, z], [L, h, 1.3], STEEL, { rotY, mat: 'metal' });
    // ribs
    for (let y = yBottom + 1; y < TOP - 0.4; y += 1.2) b.box([cx, y, z + (s < 0 ? 1 : 1) * 0], [L, 0.14, 1.42], 0x33404a, { rotY, collide: false, mat: 'metal' });
    // walkway grating & hand rails on top
    b.box([cx, TOP + 0.02, z], [L, 0.06, 1.3], 0x8a9197, { rotY, collide: false, mat: 'metal' });
    for (const side of [-0.62, 0.62]) {
      const ox = -Math.sin(rotY) * side;
      const oz = -Math.cos(rotY) * side;
      b.box([cx + ox, TOP + 1.02, z + oz], [L, 0.07, 0.07], 0xffc629, { rotY, collide: false, mat: 'glossy', shadow: false });
      b.box([cx + ox, TOP + 0.55, z + oz], [L, 0.05, 0.05], 0xffc629, { rotY, collide: false, mat: 'glossy', shadow: false });
      kit.collider([cx + ox, TOP + 0.55, z + oz], [L, 1.05, 0.08], rotY);
      for (let k = -1; k <= 1; k++) {
        const px = cx + ox + Math.cos(rotY) * k * (L / 2 - 0.1);
        const pz = z + oz - Math.sin(rotY) * k * (L / 2 - 0.1);
        b.box([px, TOP + 0.52, pz], [0.07, 1.0, 0.07], 0xffc629, { collide: false, mat: 'glossy', shadow: false });
      }
    }
  }
  void e;
}

function gates(kit: Kit, b: Batch) {
  const zu = (GATE_UP[0] + GATE_UP[1]) / 2;
  const zl = (GATE_LO[0] + GATE_LO[1]) / 2;
  miterGate(kit, b, LARGE[0], LARGE[1], zu, SEABED);
  miterGate(kit, b, SMALL[0], SMALL[1], zu, SEABED);
  miterGate(kit, b, LARGE[0], LARGE[1], zl, SEABED);
  miterGate(kit, b, SMALL[0], SMALL[1], zl, SEABED);
  // gate machinery houses on the walls (little hydraulic huts)
  for (const [x, z] of [
    [WB[0] + 2, zu + 2.6],
    [EB[1] - 2, zu + 2.6],
    [WB[0] + 2, zl + 2.6],
    [EB[1] - 2, zl + 2.6],
  ]) {
    b.box([x, TOP + 0.7, z], [2.2, 1.4, 1.8], 0x5b7f95, { mat: 'metal' });
    b.box([x, TOP + 1.45, z], [2.4, 0.1, 2], 0x2f4656, { collide: false });
    b.box([x + 1.11, TOP + 0.8, z], [0.02, 0.5, 1.2], 0xffc629, { collide: false });
  }
}

/** Railings along every water edge on the wall tops, with gaps where the gates meet the walls. */
function railings(b: Batch) {
  const kit = b.kit;
  const run = (x: number, z0: number, z1: number, gaps: [number, number][]) => {
    let z = z0;
    const segs: [number, number][] = [];
    const sorted = gaps.slice().sort((a, c) => a[0] - c[0]);
    for (const [g0, g1] of sorted) {
      if (g0 > z) segs.push([z, g0]);
      z = Math.max(z, g1);
    }
    if (z < z1) segs.push([z, z1]);
    for (const [a, c] of segs) {
      if (c - a < 0.5) continue;
      const len = c - a;
      const mz = (a + c) / 2;
      b.box([x, TOP + 1.0, mz], [0.08, 0.08, len], RAIL, { collide: false, shadow: false });
      b.box([x, TOP + 0.55, mz], [0.06, 0.06, len], RAIL, { collide: false, shadow: false });
      for (let pz = a + 0.05; pz <= c; pz += 2) b.box([x, TOP + 0.5, pz], [0.08, 1.0, 0.08], RAIL, { collide: false, shadow: false });
      kit.collider([x, TOP + 0.55, mz], [0.1, 1.1, len]);
    }
  };
  const gu = [GATE_UP[0] - 0.3, GATE_UP[1] + 0.3] as [number, number];
  const gl = [GATE_LO[0] - 0.3, GATE_LO[1] + 0.3] as [number, number];
  run(WB[1] - 0.3, CANAL_Z0 + 0.5, WALL_END - 0.3, [gu, gl]);
  run(EB[0] + 0.3, CANAL_Z0 + 0.5, WALL_END - 0.3, [gu, gl]);
  run(PIER[0] + 0.3, GATE_UP[1] + 0.3, WALL_END - 0.3, [gl]);
  run(PIER[1] - 0.3, GATE_UP[1] + 0.3, WALL_END - 0.3, [gl]);
  // south ends of the walls
  for (const [x0, x1] of [WB, EB, PIER]) {
    b.box([(x0 + x1) / 2, TOP + 1.0, WALL_END - 0.2], [x1 - x0, 0.08, 0.08], RAIL, { collide: false });
    kit.collider([(x0 + x1) / 2, TOP + 0.55, WALL_END - 0.2], [x1 - x0, 1.1, 0.1]);
  }
  // outer edges over the water (so tourists don't tumble into the bay... Jimothy can hop it)
  for (const x of [WB[0] + 0.3, EB[1] - 0.3]) {
    b.box([x, TOP + 1.0, (MAP.seawallZ + WALL_END) / 2], [0.08, 0.08, WALL_END - MAP.seawallZ], RAIL, { collide: false });
    for (let pz = MAP.seawallZ; pz <= WALL_END; pz += 2) b.box([x, TOP + 0.5, pz], [0.08, 1.0, 0.08], RAIL, { collide: false });
    kit.collider([x, TOP + 0.55, (MAP.seawallZ + WALL_END) / 2], [0.1, 1.1, WALL_END - MAP.seawallZ]);
  }
}

function lockmaster(kit: Kit, b: Batch) {
  // tiny control booth at the seaward end of the central pier
  const x = (PIER[0] + PIER[1]) / 2;
  const z = 201.8;
  b.box([x, TOP + 1.3, z], [2.6, 2.6, 3.4], 0xf3ead6, { mat: 'concrete' });
  b.box([x, TOP + 2.75, z], [3.0, 0.3, 3.8], 0xb5543a);
  b.box([x, TOP + 1.6, z + 1.72], [2.0, 1.0, 0.05], 0x2b4a66, { collide: false, mat: 'glossy' });
  b.box([x + 1.31, TOP + 1.6, z], [0.05, 1.0, 2.6], 0x2b4a66, { collide: false, mat: 'glossy' });
  b.box([x - 1.31, TOP + 1.6, z], [0.05, 1.0, 2.6], 0x2b4a66, { collide: false, mat: 'glossy' });
  b.box([x, TOP + 1.05, z - 1.72], [1.0, 2.1, 0.05], 0x7a4a2a, { collide: false });
  const t = kit.textSign([{ text: 'LOCKMASTER', px: 60, color: '#fff', stroke: '#1d3b52' }], { w: 2.4, h: 0.5, bg: '#2f6690' });
  kit.sign(b, { pos: [x, TOP + 2.3, z - 1.72], rotY: Math.PI, w: 2.4, h: 0.5, tex: t, depth: 0.04, back: false, collide: false });
  kit.world.poi.set('bobblehead:s4', V(x, TOP + 2.95, z));
  // Light mast on the east wall (bobblehead #6 on the lamp platform at the top)
  const mx = EB[1] - 1.6;
  const mz = 186;
  b.cyl([mx, TOP + 6, mz], 0.18, 12, 0x5d6770, { seg: 10, collide: true, mat: 'metal' });
  b.cyl([mx, TOP + 12.1, mz], 1.2, 0.2, 0x5d6770, { seg: 12, collide: true, mat: 'metal' });
  b.geo(new THREE.TorusGeometry(1.15, 0.04, 5, 20), [mx, TOP + 12.7, mz], [Math.PI / 2, 0, 0], 1, 0xffc629, { mat: 'glossy' });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.box([mx + Math.cos(a) * 1.15, TOP + 12.45, mz + Math.sin(a) * 1.15], [0.05, 0.5, 0.05], 0xffc629, { collide: false });
  }
  const lm = kit.glowMat(0xfff0c0, 0.2, 3);
  const lampHead = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.5), lm);
  lampHead.position.set(mx, TOP + 11.75, mz + 0.4);
  kit.root.add(lampHead);
  kit.world.poi.set('bobblehead:s6', V(mx, TOP + 12.4, mz));
}

async function boats(kit: Kit) {
  const [fishing, speed] = await Promise.all([kit.kenney('watercraft-kit', 'boat-fishing-small'), kit.kenney('watercraft-kit', 'boat-speed-a')]);
  const st = kit.state;
  if (fishing) {
    const x = (LARGE[0] + LARGE[1]) / 2;
    const z = 183;
    const r = kit.place(fishing, x, BAY_Y - 0.55, z, 0.04, { size: 7.4 });
    st.bobbers.push({ obj: r.obj, baseY: BAY_Y - 0.55, amp: 0.06, speed: 1.1, phase: 0, roll: 0.02, baseRotX: 0, baseRotZ: 0 });
    kit.collider([x, BAY_Y + 0.2, z], [r.size.x * 0.85, 1.4, r.size.z * 0.9], 0.04);
    kit.collider([x, BAY_Y + 1.6, z - r.size.z * 0.12], [r.size.x * 0.5, 1.6, r.size.z * 0.3], 0.04);
  }
  if (speed) {
    const x = (SMALL[0] + SMALL[1]) / 2;
    const z = 181;
    const r = kit.place(speed, x, CANAL_Y - 0.35, z, Math.PI + 0.03, { size: 5.2 });
    st.bobbers.push({ obj: r.obj, baseY: CANAL_Y - 0.35, amp: 0.05, speed: 1.4, phase: 1, roll: 0.02, baseRotX: 0, baseRotZ: 0 });
    kit.collider([x, CANAL_Y + 0.15, z], [r.size.x * 0.85, 0.9, r.size.z * 0.9], Math.PI);
  }
}

// ------------------------------------------------------------------ fish ladder + viewing room

function fishLadder(kit: Kit, b: Batch, water: WaterSystem) {
  const game = kit.game;
  const st = kit.state;
  const cx = (LAD.x0 + LAD.x1) / 2;
  const W = LAD.x1 - LAD.x0;
  const glassPools = 4;
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe8f0, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2f8e9e, transparent: true, opacity: 0.38, roughness: 0.2, depthWrite: false, emissive: 0x0f5560, emissiveIntensity: 0.1 });
  kit.glow(bodyMat, 0.1, 0.7);
  const sheetMat = water.material('ladder').clone();
  sheetMat.opacity = 0.62;
  sheetMat.side = THREE.DoubleSide;
  const sheets = new THREE.Group();
  for (let i = 0; i < LAD.n; i++) {
    const z = poolZ(i);
    const L = poolL(i);
    const F = L - LAD.depth;
    const zs = z + LAD.len / 2; // south end
    const zn = z - LAD.len / 2; // north end
    // floor block
    b.box([cx, F / 2, z], [W, F, LAD.len], CONCRETE_DARK, { mat: 'concrete' });
    // side walls (the west wall of the lowest pools is glass → viewing room)
    const wallTop = L + 0.35;
    const segZ0 = zn - 0.25;
    const segZ1 = zs + 0.25;
    const segLen = segZ1 - segZ0;
    b.box([LAD.x1 + 0.25, wallTop / 2, z], [0.5, wallTop, segLen], CONCRETE, { mat: 'concrete' });
    if (i < glassPools) {
      b.box([LAD.x0 - 0.25, F / 2, z], [0.5, F, segLen], CONCRETE, { mat: 'concrete' });
      b.box([LAD.x0 - 0.25, wallTop - 0.08, z], [0.5, 0.16, segLen], CONCRETE, { mat: 'concrete' });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(LAD.len - 0.1, wallTop - 0.16 - F).rotateY(Math.PI / 2), glassMat);
      g.position.set(LAD.x0 - 0.25, (F + wallTop - 0.16) / 2, z);
      kit.root.add(g);
      kit.collider([LAD.x0 - 0.25, (F + wallTop) / 2, z], [0.5, wallTop - F, LAD.len]);
      // translucent water body visible through the glass
      const body = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, L - F - 0.03, LAD.len - 0.06), bodyMat);
      body.position.set(cx, (F + L) / 2 - 0.015, z);
      body.renderOrder = 1;
      kit.root.add(body);
    } else {
      b.box([LAD.x0 - 0.25, wallTop / 2, z], [0.5, wallTop, segLen], CONCRETE, { mat: 'concrete' });
    }
    // weir to the next pool (holds back the higher pool; water spills over it)
    if (i < LAD.n - 1) {
      const Ln = poolL(i + 1);
      const wz = zn - 0.25;
      b.box([cx, (Ln + 0.03) / 2, wz], [W, Ln + 0.03, 0.5], CONCRETE, { mat: 'concrete' });
      // little waterfall sheet on the downstream face
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, Ln + 0.03 - L + 0.02), sheetMat);
      sh.position.set(cx, (L + Ln + 0.03) / 2, zn - 0.005 + 0.012);
      sheets.add(sh);
    }
    const vol = water.addBox({ name: `Fish Ladder Pool ${i + 1}`, kind: 'ladder', center: V(cx, L, z), size: [W, LAD.depth, LAD.len] });
    kit.waterUV(vol, 2.5);
    st.ladder.pools.push({ center: V(cx, L, z), halfX: W / 2, halfZ: LAD.len / 2, floorY: F });
  }
  kit.root.add(sheets);
  // end walls
  const zS = poolZ(0) + LAD.len / 2;
  const zN = poolZ(LAD.n - 1) - LAD.len / 2;
  b.box([cx, (poolL(0) - 0.02) / 2, zS + 0.25], [W + 1, poolL(0) - 0.02, 0.5], CONCRETE, { mat: 'concrete' });
  b.box([cx, (poolL(LAD.n - 1) + 0.35) / 2, zN - 0.25], [W + 1, poolL(LAD.n - 1) + 0.35, 0.5], CONCRETE, { mat: 'concrete' });
  // feed pipe from the canal (top) — elbow into the ground
  const pl = poolL(LAD.n - 1);
  b.pipe([cx, pl - 0.2, zN - 0.3], [cx, pl - 0.2, zN - 1.6], 0.42, 0x3d5a4a, { collide: true, mat: 'metal' });
  b.sphere([cx, pl - 0.2, zN - 1.6], 0.44, 0x3d5a4a, { mat: 'metal' });
  b.pipe([cx, pl - 0.2, zN - 1.6], [cx, -0.2, zN - 1.6], 0.42, 0x3d5a4a, { collide: true, mat: 'metal' });
  b.geo(new THREE.TorusGeometry(0.62, 0.1, 6, 18), [cx, pl - 0.2, zN - 0.95], [0, 0, 0], 1, 0xd8342a, { mat: 'glossy' });
  // spillway chute from the bottom pool into the bay
  const c0: V3 = [cx, poolL(0) - 0.05, zS + 0.5];
  const c1: V3 = [cx, BAY_Y - 0.3, 172];
  b.ramp(c0, c1, W, CONCRETE_DARK, { mat: 'concrete', thick: 0.4 });
  for (const s of [-1, 1]) b.ramp([c0[0] + s * (W / 2 + 0.2), c0[1] + 0.45, c0[2]], [c1[0] + s * (W / 2 + 0.2), c1[1] + 0.45, c1[2]], 0.4, CONCRETE, { mat: 'concrete', thick: 1.0 });
  const chute = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, Math.hypot(c1[2] - c0[2], c1[1] - c0[1])), sheetMat);
  chute.rotation.x = -Math.PI / 2 + Math.atan2(c0[1] - c1[1], c1[2] - c0[2]);
  chute.position.set(cx, (c0[1] + c1[1]) / 2 + 0.03, (c0[2] + c1[2]) / 2);
  kit.root.add(chute);

  // Viewing walk: a gentle ramp alongside the pools (east side) so people (and raccoons) can peek in
  const wx0 = LAD.x1 + 0.5;
  const wx1 = wx0 + 2.6;
  const wcx = (wx0 + wx1) / 2;
  b.ramp([wcx, 0.12, zS + 1.5], [wcx, poolL(LAD.n - 1) - 0.45, zN + 0.5], wx1 - wx0, 0xd8d2c6, { mat: 'paving', thick: 0.35 });
  b.box([wcx, (poolL(LAD.n - 1) - 0.45) / 2, zN - 1.0], [wx1 - wx0, poolL(LAD.n - 1) - 0.45, 3], CONCRETE, { mat: 'concrete' });
  const rlen = Math.hypot(zS - zN, poolL(LAD.n - 1) - 0.45);
  const rail = new THREE.Vector3(0, poolL(LAD.n - 1) - 0.45 - 0.12, zN + 0.5 - (zS + 1.5)).normalize();
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const z = zS + 1.5 + (zN + 0.5 - (zS + 1.5)) * t;
    const y = 0.12 + (poolL(LAD.n - 1) - 0.45 - 0.12) * t;
    b.box([wx1 - 0.08, y + 0.5, z], [0.07, 1.0, 0.07], RAIL, { collide: false });
  }
  b.pipe([wx1 - 0.08, 0.12 + 1.0, zS + 1.5], [wx1 - 0.08, poolL(LAD.n - 1) - 0.45 + 1.0, zN + 0.5], 0.04, RAIL, { seg: 6 });
  b.kit.colliderQ([wx1 - 0.08, (0.12 + poolL(LAD.n - 1) - 0.45) / 2 + 0.55, (zS + 1.5 + zN + 0.5) / 2], [0.1, 1.1, rlen], new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), rail));

  // Salmon! (the system makes them leap from pool to pool)
  for (let i = 0; i < 6; i++) {
    const p = st.ladder.pools[i];
    const s = P.fish(game, p.center.x + (Math.random() - 0.5) * 2, p.center.y - 0.2, p.center.z + (Math.random() - 0.5) * 1.8, Math.PI + (Math.random() - 0.5), 'salmon', { sleeping: false });
    s.tags.add('salmonRun');
    st.ladder.salmon.push(s);
  }
  st.ladder.spawnAt = V(cx, poolL(0) - 0.15, poolZ(0));
  // decorative salmon "swimming" behind the viewing glass
  const fg = P.fishGeometry('salmon');
  const fm = P.fishMaterial();
  for (let i = 0; i < glassPools; i++) {
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(fg, fm);
      const F = poolL(i) - LAD.depth;
      m.position.set(cx - 0.9 + k * 0.9, F + 0.25 + k * 0.15, poolZ(i) + (k ? 0.8 : -0.6));
      m.rotation.y = Math.PI + (k ? 0.3 : -0.2);
      kit.root.add(m);
      st.swayers.push({ obj: m, axis: 'y', amp: 0.25, speed: 2.2 + k, phase: i * 1.3 + k, base: m.rotation.y });
    }
  }
}

function viewingRoom(kit: Kit, b: Batch) {
  const x0 = -174;
  const x1 = LAD.x0 - 0.5; // shares the ladder's glass wall
  const z0 = 146.4;
  const z1 = 163.4;
  const H = 3.3;
  const stucco = 0xf1e6cc;
  const trim = 0xb5543a;
  b.decal([(x0 + x1) / 2, 0.02, (z0 + z1) / 2], [x1 - x0, z1 - z0], 0x8f6b52, { mat: 'paving' });
  // walls
  b.box([x0 + 0.15, H / 2, (z0 + z1) / 2], [0.3, H, z1 - z0], stucco, { mat: 'concrete' });
  b.box([(x0 + x1) / 2, H / 2, z1 - 0.15], [x1 - x0, H, 0.3], stucco, { mat: 'concrete' });
  // north wall with a door (x -171.5 .. -169)
  const d0 = -171.6;
  const d1 = -169;
  b.box([(x0 + d0) / 2, H / 2, z0 + 0.15], [d0 - x0, H, 0.3], stucco, { mat: 'concrete' });
  b.box([(d1 + x1) / 2, H / 2, z0 + 0.15], [x1 - d1, H, 0.3], stucco, { mat: 'concrete' });
  b.box([(d0 + d1) / 2, H - 0.3, z0 + 0.15], [d1 - d0, 0.6, 0.3], stucco, { mat: 'concrete' });
  // tiled roof slab + trim
  b.box([(x0 + x1) / 2, H + 0.15, (z0 + z1) / 2], [x1 - x0 + 0.6, 0.3, z1 - z0 + 0.6], trim, { mat: 'shingles' });
  b.box([(x0 + x1) / 2, H - 0.12, z0 - 0.02], [x1 - x0 + 0.1, 0.18, 0.06], trim, { collide: false });
  // arched windows on the west wall (fake: dark insets)
  for (let z = z0 + 3; z < z1 - 2; z += 4) b.box([x0 - 0.01, 1.8, z], [0.04, 1.4, 1.2], 0x2b4a66, { collide: false, mat: 'glossy' });
  // benches facing the glass
  for (const z of [150, 154.5, 159]) bench(b, -169.2, 0, z, Math.PI / 2, { wood: 0x9a6a3e, iron: 0x333333 });
  // interior signs
  const t = kit.textSign(
    [
      { text: 'FISH VIEWING ROOM', px: 64, color: '#dff7ff', stroke: '#0b3a4a' },
      { text: 'Salmon count today: LOTS', px: 34, color: '#fff', font: FONT_ROUND },
    ],
    { w: 3.2, h: 0.9, bg: '#12506a', border: '#9fe3ff' },
  );
  kit.sign(b, { pos: [-173.8, 2.3, 155], rotY: Math.PI / 2, w: 3.2, h: 0.9, tex: t, depth: 0.04, back: false, collide: false });
  const t2 = kit.textSign(
    [
      { text: 'PLEASE DO NOT', px: 44, color: '#1b1d24' },
      { text: 'WASH THE SALMON', px: 52, color: '#c62828' },
      { text: '(they are already wet)', px: 28, color: '#333', font: FONT_ROUND },
    ],
    { w: 1.6, h: 1.0, bg: '#fff8e6', border: '#c62828' },
  );
  kit.sign(b, { pos: [-173.8, 1.5, 149.5], rotY: Math.PI / 2, w: 1.6, h: 1.0, tex: t2, depth: 0.04, back: false, collide: false });
  // outside sign above the door
  const t3 = kit.textSign([{ text: 'FISH LADDER · VIEWING ROOM', px: 54, color: '#fff4dc', stroke: '#6b2a18' }], { w: 5.2, h: 0.6, bg: '#b5543a' });
  kit.sign(b, { pos: [(d0 + d1) / 2 + 1, H + 0.65, z0 - 0.1], rotY: Math.PI, w: 5.2, h: 0.6, tex: t3, depth: 0.08, back: false, collide: false });
  // a dim interior light strip
  const lm = kit.glowMat(0xbff4ff, 0.3, 1.8);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, z1 - z0 - 1), lm);
  strip.position.set(-171.5, H - 0.05, (z0 + z1) / 2);
  kit.root.add(strip);
}

// ------------------------------------------------------------------ botanical garden

function garden(kit: Kit, b: Batch) {
  const game = kit.game;
  const gx = -88;
  const gravel = 0xfff1d6;
  b.path(
    [
      [gx, 67],
      [gx, 150],
    ],
    3,
    gravel,
    { mat: 'gravel' },
  );
  b.path(
    [
      [-106, 128.5],
      [-68, 128.5],
    ],
    2.6,
    gravel,
    { mat: 'gravel' },
  );
  b.path(
    [
      [-106, 80],
      [-68, 80],
    ],
    2.4,
    gravel,
    { mat: 'gravel' },
  );
  // round beds at the crossing
  b.cyl([gx, 0.18, 128.5], 2.6, 0.36, 0x8a5a33, { seg: 24, mat: 'planks', collide: true });
  b.cyl([gx, 0.37, 128.5], 2.45, 0.04, 0x4a3524, { seg: 24, collide: false });
  // raised flower beds
  const beds: [number, number, number, number][] = [];
  for (const z of [113, 121, 136, 144]) for (const x of [-96.5, -79.5]) beds.push([x, z, 9, 4.5]);
  for (const z of [86, 96, 106]) for (const x of [-101, -75]) beds.push([x, z, 5, 6.5]);
  const cols = [0xff4f7a, 0xffd23a, 0xb36bff, 0xff8c3a, 0xffffff, 0xff5ac8, 0x5a8bff, 0xff3b30];
  const blooms: [number, number, number, number, number][] = [];
  const r = rng(5);
  beds.forEach(([x, z, w, d], bi) => {
    b.box([x, 0.2, z], [w, 0.4, d], 0x8a5a33, { mat: 'planks' });
    b.box([x, 0.41, z], [w - 0.3, 0.04, d - 0.3], 0x4a3524, { collide: false, shadow: false });
    const c1 = cols[bi % cols.length];
    const c2 = cols[(bi * 3 + 2) % cols.length];
    for (let i = 0; i < 44; i++) {
      const fx = x + (r() - 0.5) * (w - 0.7);
      const fz = z + (r() - 0.5) * (d - 0.7);
      blooms.push([fx, 0.55 + r() * 0.3, fz, r() < 0.6 ? c1 : c2, 0.6 + r() * 0.4]);
    }
    for (let i = 0; i < 9; i++) b.blob([x + (r() - 0.5) * (w - 0.9), 0.5, z + (r() - 0.5) * (d - 0.9)], [0.45, 0.2, 0.45], [0x3f8f3a, 0x4a9a3f, 0x357a34][i % 3], { detail: 0, shadow: false });
  });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    blooms.push([gx + Math.cos(a) * (0.8 + r() * 1.4), 0.55 + r() * 0.25, 128.5 + Math.sin(a) * (0.8 + r() * 1.4), cols[i % cols.length], 0.9]);
  }
  flowers(kit, blooms);
  // hedges around the garden (gaps for paths)
  const hedge = (x0: number, z0: number, x1: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    b.box([(x0 + x1) / 2, 0.7, (z0 + z1) / 2], [Math.abs(x1 - x0) > 0.1 ? L : 1.1, 1.4, Math.abs(z1 - z0) > 0.1 ? L : 1.1], 0x2f7a35, { mat: 'grass' });
  };
  hedge(-106.5, 72, -106.5, 78.5);
  hedge(-106.5, 81.5, -106.5, 127);
  hedge(-106.5, 130, -106.5, 148);
  hedge(-68.5, 72, -68.5, 78.5);
  hedge(-68.5, 81.5, -68.5, 127);
  hedge(-68.5, 130, -68.5, 148);
  // rose arch at the north entrance
  for (const s of [-1.6, 1.6]) b.cyl([gx + s, 1.3, 72], 0.1, 2.6, 0xf5f5f5, { seg: 8, collide: true });
  b.geo(new THREE.TorusGeometry(1.6, 0.1, 6, 16, Math.PI), [gx, 2.6, 72], [0, 0, 0], 1, 0xf5f5f5, {});
  for (let i = 0; i < 16; i++) {
    const a = (i / 15) * Math.PI;
    b.blob([gx + Math.cos(a) * 1.6, 2.6 + Math.sin(a) * 1.6, 72 + (r() - 0.5) * 0.3], 0.28, i % 3 ? 0x3f8f3a : 0xff5a8a, { detail: 0 });
  }
  // blossom trees
  tree(b, -100, 0, 118, 1.0, 71, { greens: [0xffa6c9, 0xff8fbf, 0xffc2da] });
  tree(b, -76, 0, 118, 1.0, 72, { greens: [0xffa6c9, 0xff8fbf, 0xffc2da] });
  tree(b, -100, 0, 140, 0.9, 73, { greens: [0xd8452f, 0xe8603a, 0xc2331f] });
  tree(b, -76, 0, 140, 0.9, 74, { greens: [0xd8452f, 0xe8603a, 0xc2331f] });
  tree(b, -101, 0, 74, 1.1, 75);
  tree(b, -75, 0, 74, 1.1, 76);
  for (const [x, z, ry] of [
    [-91.2, 123, Math.PI / 2],
    [-84.8, 123, -Math.PI / 2],
    [-91.2, 134, Math.PI / 2],
    [-84.8, 134, -Math.PI / 2],
  ] as V3[])
    bench(b, x, 0, z, ry);
  P.trashCan(game, -91.4, 0, 126.5);
  P.trashCan(game, -84.6, 0, 131);
  P.bouquet(game, -84.9, 0.46, 134.2, [0xff4f7a, 0xffd23a, 0xffffff]);
  lamps(kit, b, [
    [gx - 2.2, 0, 90],
    [gx + 2.2, 0, 110],
    [gx - 2.2, 0, 125],
    [gx + 2.2, 0, 132],
    [gx - 2.2, 0, 146],
    [-98, 0, 126.6],
    [-78, 0, 130.4],
  ]);
  greenhouse(kit, b, gx, 97);
}

function flowers(kit: Kit, list: [number, number, number, number, number][]) {
  const bloom = new THREE.IcosahedronGeometry(0.13, 0);
  const stem = new THREE.CylinderGeometry(0.018, 0.018, 1, 4).translate(0, -0.5, 0);
  const bm = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const sm = new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.8 });
  const bi = new THREE.InstancedMesh(bloom, bm, list.length);
  const si = new THREE.InstancedMesh(stem, sm, list.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const q = new THREE.Quaternion();
  list.forEach(([x, y, z, col, s], i) => {
    q.setFromEuler(new THREE.Euler(0, x * 3.1 + z, 0));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * 0.8, s));
    bi.setMatrixAt(i, m);
    bi.setColorAt(i, c.set(col));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, y - 0.3, 1));
    si.setMatrixAt(i, m);
  });
  for (const im of [bi, si]) {
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = true;
    im.receiveShadow = true;
    kit.root.add(im);
  }
  if (bi.instanceColor) bi.instanceColor.needsUpdate = true;
}

function greenhouse(kit: Kit, b: Batch, cx: number, cz: number) {
  const W = 10; // x
  const L = 18; // z
  const H = 3.6;
  const R = 6.4; // ridge
  const x0 = cx - W / 2;
  const x1 = cx + W / 2;
  const z0 = cz - L / 2;
  const z1 = cz + L / 2;
  const white = 0xf7f7f2;
  b.decal([cx, 0.02, cz], [W, L], 0xc9c2b2, { mat: 'paving' });
  b.box([cx, 0.2, cz], [W + 0.3, 0.4, L + 0.3], 0xe0dbcf, { mat: 'concrete', collide: false });
  kit.collider([cx - W / 2, 0.2, cz], [0.3, 0.4, L]);
  kit.collider([cx + W / 2, 0.2, cz], [0.3, 0.4, L]);
  const glass = new THREE.MeshStandardMaterial({ color: 0xd8f3ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2 });
  const glassGeo: THREE.BufferGeometry[] = [];
  const pane = (w: number, h: number, pos: V3, rot: V3) => {
    const g = new THREE.PlaneGeometry(w, h);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')), new THREE.Vector3(1, 1, 1)));
    glassGeo.push(g);
  };
  const wallH = H - 0.4;
  // long walls (x0, x1) — glass with white mullions
  for (const x of [x0, x1]) {
    pane(L, wallH, [x, 0.4 + wallH / 2, cz], [0, Math.PI / 2, 0]);
    kit.collider([x, 0.4 + wallH / 2, cz], [0.12, wallH, L]);
    for (let z = z0; z <= z1 + 0.01; z += 1.5) b.box([x, 0.4 + wallH / 2, z], [0.12, wallH, 0.1], white, { collide: false });
    b.box([x, 0.4 + 1.2, cz], [0.14, 0.08, L], white, { collide: false });
    b.box([x, H, cz], [0.18, 0.12, L], white, { collide: false });
  }
  // gable ends with a door opening (2.2 x 2.7)
  const dw = 2.2;
  const dh = 2.7;
  for (const z of [z0, z1]) {
    const sw = (W - dw) / 2;
    for (const s of [-1, 1]) {
      pane(sw, wallH, [cx + s * (dw / 2 + sw / 2), 0.4 + wallH / 2, z], [0, 0, 0]);
      kit.collider([cx + s * (dw / 2 + sw / 2), 0.4 + wallH / 2, z], [sw, wallH, 0.12]);
    }
    pane(dw, H - dh, [cx, (dh + H) / 2, z], [0, 0, 0]);
    // triangle gable
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([x0, H, z, x1, H, z, cx, R, z], 3));
    tri.computeVertexNormals();
    glassGeo.push(tri);
    for (const x of [cx - dw / 2, cx + dw / 2]) b.box([x, dh / 2, z], [0.12, dh, 0.14], white, { collide: false });
    b.box([cx, dh, z], [dw, 0.12, 0.14], white, { collide: false });
    for (let x = x0; x <= x1 + 0.01; x += 1.25) if (Math.abs(x - cx) > dw / 2) b.box([x, 0.4 + wallH / 2, z], [0.1, wallH, 0.12], white, { collide: false });
    b.pipe([x0, H, z], [cx, R, z], 0.08, white, { seg: 6 });
    b.pipe([x1, H, z], [cx, R, z], 0.08, white, { seg: 6 });
  }
  // roof: two glass slopes + rafters + ridge
  const slope = Math.atan2(R - H, W / 2);
  const sl = Math.hypot(R - H, W / 2);
  for (const s of [-1, 1]) {
    const mx = cx + (s * W) / 4;
    const my = (H + R) / 2;
    pane(sl, L, [mx, my, cz], [-Math.PI / 2, 0, -s * slope]);
    b.kit.colliderQ([mx, my, cz], [sl, 0.12, L], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * slope)));
    for (let z = z0; z <= z1 + 0.01; z += 1.5) b.pipe([cx + (s * W) / 2, H, z], [cx, R, z], 0.05, white, { seg: 5 });
  }
  b.box([cx, R + 0.08, cz], [0.3, 0.18, L + 0.4], white, { collide: true });
  kit.world.poi.set('bobblehead:s5', V(cx, R + 0.4, cz));
  const gm = new THREE.Mesh(mergeGlass(glassGeo), glass);
  gm.renderOrder = 3;
  kit.root.add(gm);
  // inside: palms, pots, a bench and a little pond
  const r = rng(3);
  for (let i = 0; i < 8; i++) {
    const px = cx + (i % 2 ? 3 : -3);
    const pz = z0 + 2.5 + Math.floor(i / 2) * 4.2;
    b.cyl([px, 0.75, pz], 0.45, 0.7, 0xc0633a, { rTop: 0.55, seg: 10, collide: true });
    b.cyl([px, 1.12, pz], 0.5, 0.05, 0x4a3524, { seg: 10, collide: false });
    if (i % 3 === 0) {
      // palm
      b.cyl([px, 2.2, pz], 0.12, 2.4, 0x8a6a45, { rTop: 0.08, seg: 6, collide: false });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        b.boxR([px + Math.cos(a) * 0.8, 3.35, pz + Math.sin(a) * 0.8], [1.8, 0.05, 0.45], [0, -a, -0.35], 0x3a9a3c, { collide: false });
      }
    } else {
      b.blob([px, 1.6, pz], [0.8, 0.9, 0.8], [0x2f8f3a, 0x46a64a, 0x2a7a35][i % 3], { detail: 1 });
      for (let k = 0; k < 4; k++) b.blob([px + (r() - 0.5), 1.8 + r() * 0.6, pz + (r() - 0.5)], 0.16, [0xff4f7a, 0xffd23a, 0xff8c3a, 0xb36bff][(i + k) % 4], { detail: 0 });
    }
  }
  bench(b, cx - 1.6, 0.4, cz, Math.PI / 2);
  const t = kit.textSign([{ text: 'GLASS HOUSE', px: 60, color: '#1f5e2f' }, { text: 'Humid. Like a raccoon hug.', px: 26, color: '#335', font: FONT_ROUND }], { w: 2.4, h: 0.8, bg: '#f7fff2', border: '#1f5e2f' });
  kit.sign(b, { pos: [cx, dh + 0.55, z0 - 0.12], rotY: Math.PI, w: 2.1, h: 0.7, tex: t, depth: 0.04, back: false, collide: false });
  kit.world.poi.set('greenhouse', V(cx, 0.5, cz));
}

function mergeGlass(gs: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  for (const g of gs) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.attributes.position;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

// ------------------------------------------------------------------ plaza, seawall, signs, trees

function plazaAndSeawall(kit: Kit, b: Batch) {
  const game = kit.game;
  // Locks plaza (east of the lock, facing the water)
  b.decal([-90, 0, 158], [44, 15], 0xe2dccf, { mat: 'paving' });
  seawall(kit, b, -180, WB[0]);
  seawall(kit, b, EB[1], -66.5);
  for (const x of [-106, -98, -82, -74]) bench(b, x, 0, 163.2, 0);
  lamps(
    kit,
    b,
    [
      [-110, 0, 163.8],
      [-100, 0, 163.8],
      [-90, 0, 163.8],
      [-80, 0, 163.8],
      [-70, 0, 163.8],
      [-150, 0, 163.8],
      [-172, 0, 163.8],
      [-156, 0, 140],
      [-156, 0, 128],
      [WB[0] + 1.2, TOP, 175],
      [EB[1] - 1.2, TOP, 175],
      [WB[0] + 1.2, TOP, 195],
      [EB[1] - 1.2, TOP, 140],
      [WB[0] + 1.2, TOP, 120],
      [EB[1] - 1.2, TOP, 100],
    ],
    { style: 'harbor' },
  );
  // coin-op binoculars
  for (const x of [-94, -86]) {
    b.cyl([x, 0.6, 164.2], 0.08, 1.2, 0x2f6b8f, { seg: 8, collide: true, mat: 'glossy' });
    b.box([x, 1.3, 164.2], [0.5, 0.3, 0.35], 0x2f6b8f, { collide: false, mat: 'glossy' });
    for (const s of [-0.1, 0.1]) b.geo(GEO.cyl(1, 8), [x + s, 1.32, 164.45], [Math.PI / 2, 0, 0], [0.08, 0.2, 0.08], 0x1d2b33, {});
  }
  P.trashCan(game, -102, 0, 161, 0x2f5a7a);
  P.trashCan(game, -78, 0, 161, 0x2f5a7a);
  P.lifebuoy(game, -113.5, TOP + 0.1, 170);
  perched(kit, BIRD.gull(), [
    [-117.5, TOP + 0.1, 172, 1.2, 1.3],
    [-142.5, TOP + 0.1, 190, -0.5, 1.3],
    [-127.5, TOP + 0.1, 199.5, 2.5, 1.3],
    [-96, 1.25, 165.9, 3.1, 1.2],
  ]);
}

/** Concrete seawall face (climbable from the water) with a railing, x0..x1 along z = seawall. */
export function seawall(kit: Kit, b: Batch, x0: number, x1: number, o: { rail?: boolean; top?: number } = {}) {
  const z = MAP.seawallZ - 0.1;
  const top = o.top ?? 0.35;
  b.box([(x0 + x1) / 2, (top + MAP.seabedY) / 2, z], [x1 - x0, top - MAP.seabedY, 1.0], 0xcfc9bb, { mat: 'concrete' });
  b.box([(x0 + x1) / 2, top + 0.06, z - 0.05], [x1 - x0, 0.12, 1.2], 0xe8e4da, { mat: 'concrete', collide: false });
  if (o.rail === false) return;
  const len = x1 - x0;
  b.box([(x0 + x1) / 2, top + 1.0, z + 0.35], [len, 0.08, 0.08], 0x2d4250, { collide: false, mat: 'metal' });
  b.box([(x0 + x1) / 2, top + 0.55, z + 0.35], [len, 0.05, 0.05], 0x2d4250, { collide: false, mat: 'metal' });
  for (let x = x0 + 0.1; x <= x1; x += 2) b.box([x, top + 0.5, z + 0.35], [0.07, 1.0, 0.07], 0x2d4250, { collide: false, mat: 'metal' });
  kit.collider([(x0 + x1) / 2, top + 0.55, z + 0.35], [len, 1.1, 0.1]);
}

function signs(kit: Kit, b: Batch) {
  // Big "THE LOCKS" sign on the plaza, facing east/north toward visitors
  const tex = canvasTex(1024, 420, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1f5f8b');
    g.addColorStop(1, '#154466');
    ctx.fillStyle = g;
    roundRect(ctx, 6, 6, w - 12, h - 12, 44);
    ctx.fill();
    ctx.strokeStyle = '#ffd35a';
    ctx.lineWidth = 12;
    roundRect(ctx, 22, 22, w - 44, h - 44, 32);
    ctx.stroke();
    fitText(ctx, 'THE LOCKS', w / 2, h * 0.36, w * 0.8, 170, FONT_TITLE, { fill: '#fff', stroke: '#0c2a40', strokeW: 14 });
    fitText(ctx, "Ballard's Favorite Water Elevator", w / 2, h * 0.64, w * 0.84, 52, FONT_ROUND, { fill: '#ffd35a' });
    fitText(ctx, 'Boats go up. Boats go down. Salmon go up the ladder.', w / 2, h * 0.82, w * 0.84, 32, FONT_BODY, { fill: '#dfefff', weight: '800' });
  });
  for (const dx of [-2.4, 2.4]) b.cyl([-106 + dx, 1.3, 151.5], 0.15, 2.6, 0x173a55, { seg: 8, collide: true });
  kit.sign(b, { pos: [-106, 3.0, 151.5], rotY: Math.PI, w: 5.4, h: 2.2, tex, frame: 0x173a55 });
  // canal sign on the levee
  const t2 = kit.textSign(
    [
      { text: 'LAKE WASHING', px: 70, color: '#fff', stroke: '#0c2a40' },
      { text: 'SHIP CANAL', px: 48, color: '#bfe6ff' },
      { text: 'No washing in the Lake Washing. (Ok, a little.)', px: 24, color: '#fff', font: FONT_ROUND },
    ],
    { w: 3.2, h: 1.4, bg: '#2a6f97', border: '#bfe6ff' },
  );
  b.cyl([EB[1] - 1.5, TOP + 0.9, 110], 0.08, 1.8, 0x173a55, { seg: 6, collide: false });
  kit.sign(b, { pos: [EB[1] - 1.5, TOP + 2.2, 110], rotY: -Math.PI / 2, w: 3.2, h: 1.4, tex: t2, frame: 0x173a55 });
  // gate warning
  const t3 = kit.textSign(
    [
      { text: 'KEEP OFF THE GATES', px: 46, color: '#1b1d24' },
      { text: 'Jimothy, this means you.', px: 30, color: '#c62828', font: FONT_ROUND },
    ],
    { w: 2, h: 0.75, bg: '#ffd23a', border: '#1b1d24' },
  );
  for (const x of [WB[0] + 2.8, EB[1] - 2.8]) {
    b.cyl([x, TOP + 0.6, 163.2], 0.05, 1.2, 0x333333, { seg: 6, collide: false });
    kit.sign(b, { pos: [x, TOP + 1.35, 163.2], w: 2, h: 0.75, tex: t3, frame: 0x1b1d24 });
  }
  // garden sign
  const t4 = kit.textSign(
    [
      { text: 'BOTANICAL GARDEN', px: 64, color: '#fff7e0', stroke: '#1f4d29' },
      { text: 'Please do not wash the roses.', px: 30, color: '#fff', font: FONT_ROUND },
    ],
    { w: 3.2, h: 1.0, bg: '#2f6b3a', border: '#f2d98c' },
  );
  for (const dx of [-1.5, 1.5]) b.cyl([-88 + dx + 5.5, 0.9, 69], 0.08, 1.8, 0x3b2a20, { seg: 6, collide: false });
  kit.sign(b, { pos: [-82.5, 1.9, 69], rotY: Math.PI, w: 3.2, h: 1.0, tex: t4, frame: 0x3b2a20 });
}

function lawnTrees(b: Batch) {
  const r = rng(31);
  const spots: [number, number][] = [
    [-172, 72],
    [-164, 76],
    [-176, 84],
    [-168, 90],
    [-158, 84],
    [-176, 100],
    [-170, 110],
    [-176, 120],
    [-156, 70],
    [-112, 70],
    [-104, 68],
    [-176, 138],
  ];
  spots.forEach(([x, z], i) => tree(b, x + (r() - 0.5) * 2, 0, z + (r() - 0.5) * 2, 0.9 + r() * 0.4, 200 + i, { kind: i % 4 === 3 ? 'pine' : 'round' }));
  for (const [x, z] of [
    [-153, 118],
    [-153, 106],
    [-153, 94],
    [-107, 118],
    [-107, 100],
  ])
    bush(b, x, 0, z, 1.1);
}
