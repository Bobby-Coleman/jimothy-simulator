import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World, ZoneBuilder } from '../../World';
import type { WaterSystem } from '../../Water';
import { RAPIER, G, groups } from '../../../core/Physics';
import { MAP } from '../../terrain';
import { getKit, Batch, tree, bush, bench, picnicTable, rng, canvasTex, fitText, roundRect, FONT_TITLE, FONT_ROUND, GEO, bake, type Kit, type V3 } from './kit';
import { lamps, BIRD, perched, flock, swanBoat, kite } from './decor';
import * as P from './props';

/**
 * W zone — "Gasworks-ish Park": rolling lawn, the park pond (stone rim, reeds, dock, swan boats, ducks),
 * rusty climbable gas-works towers + painted play barn, Kite Hill, playground (slide, swings, seesaw,
 * sandbox, climbing dome), picnic area, crow tree, birdbath, fountain, sad kid's bench, the lost teddy.
 */

const AREA = 'Gasworks-ish Park';
const PX = MAP.pond.x;
const PZ = MAP.pond.z;
const WATER_Y = MAP.pond.waterY;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const deg = (d: number) => (d * Math.PI) / 180;
const onLoop = (a: number, r = 23): [number, number] => [PX + Math.cos(deg(a)) * r, PZ + Math.sin(deg(a)) * r];
/** rotY so that a bench/sign at (x,z) faces the point (tx,tz). */
const faceTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

const KITE_HILL = { x: -158, z: 32, R: 16, H: 7, flat: 2.6 };
const GAS = { x: -152, z: -34 };
const PLAY = { x: -85.5, z: 34.5 };
const PICNIC = { x: -91, z: -25 };
const CROW = { x: -108, z: -38 };
const FOUNTAIN = { x: -82, z: 0 };
const BIRDBATH = { x: -98, z: -12 };
const MUD = { x: -138.6, z: 17.2 };

export const ParkZone: ZoneBuilder = {
  name: AREA,
  async build(game: Game, world: World) {
    const kit = await getKit(game, world);
    const b = new Batch(kit, 'park');
    const water = game.get<WaterSystem>('water')!;

    world.areas.push({ name: AREA, min: new THREE.Vector2(-180, -54), max: new THREE.Vector2(-66, 54) });

    paths(b);
    pond(kit, b, water);
    gasworks(kit, b);
    playBarn(b);
    kiteHill(kit, b);
    playground(kit, b);
    picnic(kit, b);
    crowTree(kit, b);
    fountain(kit, b, water);
    birdbath(kit, b, water);
    furniture(kit, b);
    greenery(b);
    signs(kit, b);

    // The lost teddy, face-down in the mud by the pond
    b.patch(MUD.x, MUD.z, 2.4, 1.7, 0x4a3524, { mat: 'dirt', lift: 0.035, wobble: 0.25, seed: 3 });
    b.patch(MUD.x + 0.4, MUD.z + 0.2, 1.3, 0.9, 0x35261a, { mat: 'flat', lift: 0.045, wobble: 0.3, seed: 5 });
    P.teddy(game, MUD.x - 0.3, world.heightAt(MUD.x - 0.3, MUD.z + 0.3) + 0.02, MUD.z + 0.3, 2.3);
    world.poi.set('teddy', V(MUD.x - 0.3, world.heightAt(MUD.x, MUD.z) + 0.3, MUD.z + 0.3));

    world.poi.set('pond', V(PX, WATER_Y, PZ));
    world.poi.set('park', V(-100, 0.5, 0));

    // NPCs: picnicking families, kids at the playground, pond-loop joggers, kite flyers, strollers
    const loop: THREE.Vector3[] = [];
    for (let i = 0; i < 24; i++) {
      const [x, z] = onLoop((i / 24) * 360);
      loop.push(V(x, 0, z));
    }
    world.npcSpawns.push(
      { zone: AREA, center: V(PICNIC.x, 0, PICNIC.z), radius: 10, count: 5, types: ['family', 'pedestrian'] },
      { zone: AREA, center: V(PLAY.x, 0, PLAY.z), radius: 9, count: 5, types: ['kid', 'kid', 'family'] },
      { zone: AREA, center: V(PX, 0, PZ), radius: 23, count: 3, types: ['jogger'], path: loop },
      { zone: AREA, center: V(-138, 0, 46), radius: 5, count: 2, types: ['family', 'kid'] },
      { zone: AREA, center: V(FOUNTAIN.x, 0, FOUNTAIN.z), radius: 8, count: 3, types: ['pedestrian', 'tourist'] },
      { zone: AREA, center: V(-150, 0, -12), radius: 7, count: 2, types: ['pedestrian', 'tourist'] },
    );

    // Ambience
    kit.state.ambience.push(
      { pos: V(CROW.x, 8, CROW.z), key: 'crow_caw', radius: 35, every: 7, next: 2, volume: 0.6 },
      { pos: V(PX, 0, PZ), key: 'splash', radius: 20, every: 11, next: 5, volume: 0.15 },
    );

    const meshes = b.flush();
    if (game.debug.southStats) console.info(`[south] park: ${meshes.length} meshes, ${Math.round(b.tris / 1000)}k tris`);
  },
};

// ------------------------------------------------------------------ paths

function paths(b: Batch) {
  const gravel = 0xfff1d6;
  const loop: [number, number][] = [];
  for (let i = 0; i < 40; i++) loop.push(onLoop((i / 40) * 360));
  b.path(loop, 3, gravel, { mat: 'gravel', closed: true });
  b.path([[-66.5, 1.5], [-73.5, 1]], 3.4, gravel, { mat: 'gravel' });
  b.path([[-90.5, 1.5], [-97.4, 4.5]], 3, gravel, { mat: 'gravel' });
  b.path([onLoop(-135), [-141, -17]], 2.6, gravel, { mat: 'gravel' });
  b.path([onLoop(135), [-141, 30], [-143.5, 33]], 2.6, gravel, { mat: 'gravel' });
  b.path([onLoop(-45), [-96, -18], [PICNIC.x, PICNIC.z]], 2.6, gravel, { mat: 'gravel' });
  b.path([onLoop(45), [-96.5, 29], [-98, 31]], 2.6, gravel, { mat: 'gravel' });
  b.path([[PICNIC.x, PICNIC.z], [-93, -40], [-95, -53.5]], 2.6, gravel, { mat: 'gravel' });
  b.path([[-86, 45], [-88, 53.5]], 2.6, gravel, { mat: 'gravel' });
  b.path([[-141, -17], [-160, -12], [-170, 4], [-172, 14]], 2.4, gravel, { mat: 'gravel' });
  b.path([onLoop(-90), [PX - 2, -30], [-126, -44]], 2.4, gravel, { mat: 'gravel' });
}

// ------------------------------------------------------------------ pond

function pond(kit: Kit, b: Batch, water: WaterSystem) {
  const world = kit.world;
  const r = rng(42);
  // Rim of rounded stones (hides the water disc edge, climbable from the water)
  const stoneCols = [0x8d8a82, 0x9a948a, 0x7f7b73, 0xa39d91];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const d = (a * 180) / Math.PI;
    if (d > 102 && d < 138) continue; // little sandy beach
    const rr = 16.95 + (r() - 0.5) * 0.35;
    const x = PX + Math.cos(a) * rr;
    const z = PZ + Math.sin(a) * rr;
    const top = -0.2 + r() * 0.12;
    const bot = world.heightAt(x, z) - 0.4;
    b.blob([x, (top + bot) / 2, z], [0.72 + r() * 0.3, (top - bot) / 2 + 0.04, 0.55 + r() * 0.25], stoneCols[i % 4], { detail: 0, rotY: -a + r(), mat: 'stone' });
  }
  for (let i = 0; i < 48; i++) {
    const a = ((i + 0.5) / 48) * Math.PI * 2;
    const d = (a * 180) / Math.PI;
    if (d > 104 && d < 136) continue;
    kit.collider([PX + Math.cos(a) * 16.95, -0.62, PZ + Math.sin(a) * 16.95], [2.45, 0.9, 0.95], -a + Math.PI / 2);
  }
  // Beach: sand fan into the water
  b.patch(PX, PZ, 21, 21, 0xe8d7a6, { mat: 'sand', a0: deg(100), a1: deg(140), r0: 0.62, rings: 5, seg: 10, lift: 0.03 });

  // Reeds & cattails
  const reedCols = [0x5f8f3a, 0x6f9c3f, 0x86a04a, 0x4f7f34];
  for (const ca of [38, 72, 148, 178, 214, 252, 318, 345]) {
    const [cx, cz] = onLoop(ca, 16.3);
    for (let k = 0; k < 14; k++) {
      const x = cx + (r() - 0.5) * 3;
      const z = cz + (r() - 0.5) * 3;
      const base = Math.max(world.heightAt(x, z), -1.0);
      const h = WATER_Y - base + 0.7 + r() * 0.9;
      b.cyl([x, base + h / 2, z], 0.035, h, reedCols[k % 4], { rTop: 0.004, seg: 5, collide: false });
      if (k % 3 === 0) b.cyl([x, base + h * 0.82, z], 0.055, 0.28, 0x6b4226, { seg: 6, collide: false });
    }
  }
  // Lily pads
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const rr = 5 + r() * 9.5;
    const x = PX + Math.cos(a) * rr;
    const z = PZ + Math.sin(a) * rr;
    if (x > PX + 7 && Math.abs(z - 18) < 3.5) continue; // keep the dock clear
    const s = 0.35 + r() * 0.25;
    b.geo(GEO.cyl(1, 12), [x, WATER_Y + 0.02, z], [0, r() * 6, 0], [s, 0.02, s], 0x3f8f3a, { shadow: false });
    if (i % 4 === 0) b.blob([x + 0.1, WATER_Y + 0.08, z], [0.1, 0.07, 0.1], 0xff8fc4, { detail: 0 });
  }

  // Little wooden dock on the east shore
  const dz = 18;
  b.box([-104, 0.25, dz], [12, 0.2, 2.6], 0xc49060, { mat: 'planks', collide: false });
  kit.collider([-104, -0.3, dz], [12, 1.3, 2.6]);
  b.ramp([-96.6, 0.02, dz], [-98.2, 0.35, dz], 2.6, 0xc49060, { mat: 'planks' });
  for (const x of [-98.6, -102.2, -105.8, -109.6]) {
    for (const z of [dz - 1.4, dz + 1.4]) {
      const g = world.heightAt(x, z);
      b.cyl([x, (g + 0.8) / 2, z], 0.13, 0.8 - g, 0x6b4a2f, { seg: 8, collide: false });
      kit.cylinderCollider([x, 0.6, z], 0.13, 0.5);
    }
  }
  b.box([-109.7, 0.25, dz], [0.3, 0.3, 2.9], 0x6b4a2f, { collide: false });
  // Swan boats (bobbing decor with static colliders)
  const boats: [number, number, number, number, 'swan' | 'duck'][] = [
    [-106.6, 21.4, 0.1, 0xffffff, 'swan'],
    [-102.8, 21.5, -0.15, 0xffe14a, 'duck'],
    [-107.2, 14.6, 3.05, 0xffffff, 'swan'],
    [-121, 1.5, 1.1, 0xff9ac8, 'swan'],
  ];
  for (const [x, z, ry, col, head] of boats) {
    const m = swanBoat(col, head);
    m.position.set(x, WATER_Y, z);
    m.rotation.y = ry;
    world.staticRoot.add(m);
    kit.state.bobbers.push({ obj: m, baseY: WATER_Y - 0.05, amp: 0.05, speed: 1.3 + r() * 0.5, phase: r() * 6, roll: 0.03, baseRotX: 0, baseRotZ: 0 });
    kit.collider([x, WATER_Y - 0.15, z], [1.6, 0.5, 2.6], ry);
  }
  // Ducks: a mama duck leading ducklings in a slow circle, plus a few freelancers
  const duckC = V(PX - 1, WATER_Y - 0.02, PZ - 1);
  const RAD = 8.5;
  const W = 0.11;
  flock(kit, BIRD.duck(), 4, V(PX, 0, PZ), 90, (i, t, out) => {
    if (i === 0) {
      const a = t * W;
      out.set(duckC.x + Math.cos(a) * RAD, duckC.y + Math.sin(t * 2.1) * 0.015, duckC.z + Math.sin(a) * RAD);
      return Math.atan2(-Math.sin(a), Math.cos(a));
    }
    const cx = [0, PX - 7, PX + 6, PX + 1][i];
    const cz = [0, PZ + 6, PZ + 7, PZ - 10][i];
    const a = t * (0.18 + i * 0.05) * (i % 2 ? 1 : -1) + i * 2;
    const rr = 2 + i * 0.6;
    out.set(cx + Math.cos(a) * rr, duckC.y + Math.sin(t * 1.7 + i) * 0.015, cz + Math.sin(a) * rr);
    const s = i % 2 ? 1 : -1;
    return Math.atan2(-Math.sin(a) * s, Math.cos(a) * s);
  });
  flock(kit, BIRD.duckling(), 5, V(PX, 0, PZ), 90, (i, t, out) => {
    const a = t * W - (i + 1) * 0.085;
    const wob = Math.sin(t * 3 + i) * 0.12;
    out.set(duckC.x + Math.cos(a) * (RAD + wob), duckC.y + Math.sin(t * 3.3 + i) * 0.012, duckC.z + Math.sin(a) * (RAD + wob));
    return Math.atan2(-Math.sin(a), Math.cos(a));
  });
}

// ------------------------------------------------------------------ gas works towers

const RUST = [0x8e4f2e, 0x9c5a33, 0x7a4128, 0xa0643a];
const IRON = 0x3b3230;

function gasworks(kit: Kit, b: Batch) {
  const towers = [
    { x: -148, z: -32, r: 3.2, h: 24, ring: 12.5, col: RUST[0] },
    { x: -158.5, z: -39.5, r: 3.0, h: 20, ring: 9.5, col: RUST[1] },
    { x: -158, z: -25.5, r: 2.6, h: 17, ring: 0, col: RUST[2] },
    { x: -138.5, z: -41, r: 1.9, h: 14, ring: 0, col: RUST[3] },
    { x: -167, z: -33, r: 1.15, h: 21, ring: 0, col: RUST[1] },
  ];
  const r = rng(7);
  for (const t of towers) {
    const base = 0.5;
    b.cyl([t.x, 0.25, t.z], t.r + 0.9, 0.5, 0xb9b4aa, { mat: 'concrete', seg: 20, collide: true });
    b.cyl([t.x, base + t.h / 2, t.z], t.r, t.h, t.col, { seg: 22, mat: 'rust', collide: true });
    for (let y = base + 2.4; y < base + t.h - 0.5; y += 3.2) b.cyl([t.x, y, t.z], t.r + 0.09, 0.28, 0x5e3322, { seg: 22, mat: 'rust', collide: false });
    // conical cap + little top deck
    const capH = Math.min(1.6, t.r * 0.5);
    const top = base + t.h;
    b.cyl([t.x, top + capH / 2, t.z], t.r, capH, 0x6a3a26, { rTop: t.r * 0.38, seg: 22, mat: 'rust', collide: false });
    const pts: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pts.push(t.x + Math.cos(a) * t.r, top, t.z + Math.sin(a) * t.r, t.x + Math.cos(a) * t.r * 0.38, top + capH, t.z + Math.sin(a) * t.r * 0.38);
    }
    kit.hullCollider(pts);
    b.cyl([t.x, top + capH + 0.1, t.z], t.r * 0.42, 0.2, IRON, { seg: 16, collide: true, mat: 'metal' });
    // red warning light on top
    warningLights.push([t.x, top + capH + 0.45, t.z]);
    b.cyl([t.x, top + capH + 0.3, t.z], 0.05, 0.3, IRON, { seg: 6, collide: false });
    // vertical pipes hugging the tower (climbable)
    const na = t.r > 2 ? 2 : 1;
    for (let k = 0; k < na; k++) {
      const a = r() * Math.PI * 2;
      const pr = t.r > 2 ? 0.32 : 0.22;
      const px = t.x + Math.cos(a) * (t.r + pr + 0.08);
      const pz = t.z + Math.sin(a) * (t.r + pr + 0.08);
      b.cyl([px, base + (t.h - 1.5) / 2, pz], pr, t.h - 1.5, 0x5a3526, { seg: 10, mat: 'rust', collide: true });
      for (let y = 2; y < t.h - 2; y += 4) b.cyl([px, base + y, pz], pr + 0.07, 0.2, 0x3e2519, { seg: 10, collide: false });
    }
    // ladder (visual; the tower itself is climbable)
    const la = Math.atan2(-34 - t.z, -120 - t.x);
    const lx = Math.cos(la);
    const lz = Math.sin(la);
    const tx = -lz;
    const tz = lx;
    const lr = t.r + 0.25;
    for (const s of [-0.28, 0.28]) b.cyl([t.x + lx * lr + tx * s, base + t.h / 2, t.z + lz * lr + tz * s], 0.035, t.h, IRON, { seg: 6, collide: false });
    for (let y = 0.6; y < t.h; y += 0.45)
      b.pipe([t.x + lx * lr - tx * 0.28, base + y, t.z + lz * lr - tz * 0.28], [t.x + lx * lr + tx * 0.28, base + y, t.z + lz * lr + tz * 0.28], 0.025, IRON, { seg: 5 });
    // catwalk ring
    if (t.ring) catwalk(kit, b, t.x, base + t.ring, t.z, t.r, 1.5);
  }
  // Connecting pipes (walkable!)
  const T = towers;
  const link = (i: number, j: number, y: number, pr: number, col = 0x7d4630) => b.pipe([T[i].x, y, T[i].z], [T[j].x, y, T[j].z], pr, col, { seg: 12, collide: true, mat: 'rust' });
  link(0, 1, 15.5, 0.6);
  link(0, 2, 9.2, 0.65);
  link(0, 3, 11, 0.55);
  link(1, 2, 13.5, 0.5);
  link(1, 4, 7.5, 0.45);
  link(2, 4, 16.5, 0.4, 0x6a3a26);
  // pipes diving to the ground + valve boxes
  for (const [x, z, y] of [
    [-150, -22, 6],
    [-140, -30, 7],
    [-165, -44, 5],
  ] as V3[]) {
    const t = towers.reduce((a, c) => (Math.hypot(c.x - x, c.z - z) < Math.hypot(a.x - x, a.z - z) ? c : a));
    b.pipe([t.x, y, t.z], [x, 1.2, z], 0.4, 0x6a3a26, { seg: 10, collide: true, mat: 'rust' });
    b.box([x, 0.8, z], [1.6, 1.6, 1.6], 0x4a3a33, { mat: 'rust' });
    b.geo(new THREE.TorusGeometry(0.45, 0.07, 6, 16), [x, 1.9, z], [Math.PI / 2, 0, 0], 1, 0xd8342a, { mat: 'glossy' });
    b.cyl([x, 1.7, z], 0.06, 0.3, 0x333333, { seg: 6, collide: false });
  }
  // A horizontal tank lying on cradles
  b.geo(GEO.cyl(1, 18), [-143, 2.1, -20.5], [0, 0.4, Math.PI / 2], [1.5, 7, 1.5], 0x8a4c2c, { mat: 'rust' });
  kit.colliderQ([-143, 2.1, -20.5], [7, 3, 3], new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.4, 0)));
  for (const s of [-2.2, 2.2]) b.box([-143 + Math.cos(0.4) * s, 0.5, -20.5 - Math.sin(0.4) * s], [0.6, 1, 2.6], 0x55504a, { rotY: 0.4, mat: 'concrete' });
  // warning lights (glow at night)
  const wl = kit.glowMat(0xff2a1a, 0.5, 4);
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.18, 8, 6), wl, warningLights.length);
  warningLights.forEach(([x, y, z], i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z)));
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  kit.world.staticRoot.add(im);
  warningLights.length = 0;
  // Bobblehead #1: top of the tallest tower
  const tb = towers[0];
  kit.world.poi.set('bobblehead:s1', V(tb.x, 0.5 + tb.h + Math.min(1.6, tb.r * 0.5) + 0.25, tb.z));
  kit.world.poi.set('gasworks', V(-145, 0.5, -24));
}
const warningLights: V3[] = [];

function catwalk(kit: Kit, b: Batch, x: number, y: number, z: number, r: number, w: number) {
  const prof = [new THREE.Vector2(r, 0), new THREE.Vector2(r + w, 0), new THREE.Vector2(r + w, 0.16), new THREE.Vector2(r, 0.16), new THREE.Vector2(r, 0)];
  b.geo(new THREE.LatheGeometry(prof, 28), [x, y - 0.16, z], [0, 0, 0], 1, 0x4a4541, { mat: 'metal' });
  b.geo(new THREE.TorusGeometry(r + w - 0.05, 0.04, 5, 36), [x, y + 0.95, z], [Math.PI / 2, 0, 0], 1, 0x3a3533, { mat: 'metal' });
  b.geo(new THREE.TorusGeometry(r + w - 0.05, 0.03, 5, 36), [x, y + 0.5, z], [Math.PI / 2, 0, 0], 1, 0x3a3533, { mat: 'metal' });
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const cr = r + w / 2;
    const seg = ((Math.PI * 2 * cr) / n) * 1.12;
    kit.collider([x + Math.cos(a) * cr, y - 0.08, z + Math.sin(a) * cr], [seg, 0.16, w], -a + Math.PI / 2);
    kit.collider([x + Math.cos(a) * (r + w), y + 0.5, z + Math.sin(a) * (r + w)], [((Math.PI * 2 * (r + w)) / n) * 1.1, 1, 0.08], -a + Math.PI / 2);
    b.cyl([x + Math.cos(a) * (r + w - 0.05), y + 0.48, z + Math.sin(a) * (r + w - 0.05)], 0.035, 0.96, 0x3a3533, { seg: 5, collide: false });
    // struts under the catwalk
    if (i % 3 === 0) b.pipe([x + Math.cos(a) * (r + w - 0.1), y - 0.16, z + Math.sin(a) * (r + w - 0.1)], [x + Math.cos(a) * r, y - 1.6, z + Math.sin(a) * r], 0.05, 0x3a3533, { seg: 5 });
  }
}

function playBarn(b: Batch) {
  const cx = -134;
  const cz = -45.5;
  const colX = [-141.5, -136.2, -130.8, -126.5];
  for (const x of colX) for (const z of [cz - 4.6, cz + 4.6]) b.cyl([x, 2.1, z], 0.18, 4.2, 0x8a2a22, { seg: 8, collide: true, mat: 'metal' });
  // pitched roof (two slabs) — walkable
  b.boxR([cx, 4.55, cz - 2.7], [16.8, 0.25, 5.8], [0.2, 0, 0], 0xc0392b, { mat: 'metal' });
  b.boxR([cx, 4.55, cz + 2.7], [16.8, 0.25, 5.8], [-0.2, 0, 0], 0xc0392b, { mat: 'metal' });
  b.box([cx, 5.1, cz], [16.9, 0.25, 0.5], 0x8a2a22, { mat: 'metal' });
  for (const x of colX) b.box([x, 4.15, cz], [0.2, 0.25, 9.6], 0x8a2a22, { collide: false, mat: 'metal' });
  // painted machinery (all climbable)
  b.box([-138.5, 1.1, cz], [3, 2.2, 2.2], 0xe53935, { mat: 'glossy' });
  for (const s of [-1.2, 1.2]) {
    b.geo(GEO.cyl(1, 20), [-138.5, 1.2, cz + s], [Math.PI / 2, 0, 0], [1.05, 0.25, 1.05], 0xfdd835, { mat: 'glossy' });
    b.geo(GEO.cyl(1, 12), [-138.5, 1.2, cz + s * 1.1], [Math.PI / 2, 0, 0], [0.25, 0.3, 0.25], 0x1e88e5, { mat: 'glossy' });
  }
  b.geo(GEO.cyl(1, 18), [-131.5, 1.1, cz + 2], [0, 0, Math.PI / 2], [0.9, 4, 0.9], 0x1e88e5, { mat: 'glossy' });
  b.kit.collider([-131.5, 1.1, cz + 2], [4, 1.8, 1.8]);
  b.box([-130, 0.9, cz - 2.2], [2, 1.8, 1.6], 0x43a047, { mat: 'glossy' });
  b.pipe([-138.5, 2.2, cz], [-135, 3.4, cz], 0.3, 0x43a047, { mat: 'glossy', collide: true });
  b.pipe([-135, 3.4, cz], [-131.5, 2, cz + 2], 0.3, 0x43a047, { mat: 'glossy', collide: true });
  b.pipe([-130, 1.8, cz - 2.2], [-133, 3.2, cz - 2.8], 0.25, 0xfdd835, { mat: 'glossy', collide: true });
  b.geo(new THREE.TorusGeometry(0.8, 0.14, 8, 18), [-127.8, 1.9, cz], [0, Math.PI / 2, 0], 1, 0xff7043, { mat: 'glossy' });
  b.cyl([-127.8, 0.55, cz], 0.12, 1.1, 0x333333, { seg: 8 });
  b.decal([cx, 0, cz], [16, 9.8], 0x9b8f80, { mat: 'concrete' });
  b.kit.world.poi.set('bobblehead:s3', V(cx, 5.45, cz));
}

// ------------------------------------------------------------------ kite hill

function hillH(r: number) {
  const { R, H, flat } = KITE_HILL;
  if (r >= R) return 0;
  const u = Math.max(0, (r - flat) / (R - flat));
  const k = 1 - u * u;
  return H * k * k;
}

function kiteHill(kit: Kit, b: Batch) {
  const { x: cx, z: cz, R, H } = KITE_HILL;
  const game = kit.game;
  // Heightfield collider (exactly matches the mesh)
  const n = 28;
  const size = R * 2;
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const x = -R + (j / n) * size;
      const z = -R + (i / n) * size;
      heights[j * (n + 1) + i] = hillH(Math.hypot(x, z));
    }
  const cd = RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size }).setTranslation(cx, 0, cz).setFriction(0.9).setCollisionGroups(groups(G.WORLD));
  game.physics.staticCollider(cd);
  // Mesh: radial grid that shares the terrain's own (splat-textured) material, so it blends in:
  // same uv mapping as the terrain plane, same macro tint colours, 100% grass splat.
  const rings = 22;
  const seg = 44;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const splat: number[] = [];
  const idx: number[] = [];
  const half = MAP.terrainHalf;
  const tA = new THREE.Color(0xcfeeb0);
  const tB = new THREE.Color(0xf4f7c0);
  const c = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const rr = (i / rings) * R;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const h = hillH(rr) + (i === rings ? 0 : 0.012);
      pos.push(x, h, z);
      const noise = Math.sin(x * 0.13) * Math.sin(z * 0.11) * 0.5 + Math.sin(x * 0.037 + z * 0.041) * 0.5;
      c.copy(tA).lerp(tB, 0.5 + noise * 0.45);
      col.push(c.r, c.g, c.b);
      uv.push((x + half) / (half * 2), (half - z) / (half * 2));
      splat.push(1, 0, 0);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      const a = i * seg + j;
      const bb = i * seg + j1;
      const cc = (i + 1) * seg + j;
      const d = (i + 1) * seg + j1;
      idx.push(a, bb, cc, bb, d, cc);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('splat', new THREE.Float32BufferAttribute(splat, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  if ((geo.attributes.normal as THREE.BufferAttribute).getY(seg * 5) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  const terrainMat = kit.world.terrain?.material as THREE.Material | undefined;
  const mesh = new THREE.Mesh(geo, terrainMat ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: 0x8fc35a }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  kit.world.staticRoot.add(mesh);

  // Sundial mosaic on top
  b.geo(GEO.cyl(1, 32), [cx, H + 0.03, cz], [0, 0, 0], [2.4, 0.08, 2.4], 0xd8cfc0, { mat: 'paving', shadow: false });
  const mos = [0xe53935, 0xfdd835, 0x1e88e5, 0x43a047, 0xff7043, 0x8e24aa];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box([cx + Math.cos(a) * 1.8, H + 0.08, cz + Math.sin(a) * 1.8], [0.5, 0.04, 0.3], mos[i % mos.length], { rotY: -a, collide: false, shadow: false });
  }
  b.boxR([cx, H + 0.6, cz], [0.08, 1.2, 1.3], [0, 0, 0.5], 0xb8862f, { mat: 'metal' });
  // Kites on strings, anchored at stakes around the base
  const kites: [number, number, V3, [number, number]][] = [
    [cx + 10, cz + 14, [-6, 20, -10], [0xff3b30, 0xffd60a]],
    [cx + 16, cz + 4, [-10, 17, 3], [0x34c759, 0x0a84ff]],
    [cx + 4, cz + 17, [3, 23, -14], [0xbf5af2, 0xff9f0a]],
    [cx + 13, cz - 8, [-4, 18, 9], [0x0a84ff, 0xff375f]],
  ];
  for (const [ax, az, off, cols] of kites) {
    const k = kite(cols, off, 1.4);
    k.position.set(ax, kit.world.heightAt(ax, az) + 0.8, az);
    kit.world.staticRoot.add(k);
    b.cyl([ax, 0.4, az], 0.05, 0.8, 0x7a5a3a, { seg: 5, collide: false });
    kit.state.swayers.push({ obj: k, axis: 'z', amp: 0.05, speed: 0.7 + Math.random() * 0.4, phase: Math.random() * 6, base: 0 });
    kit.state.swayers.push({ obj: k, axis: 'x', amp: 0.04, speed: 0.5 + Math.random() * 0.3, phase: Math.random() * 6, base: 0 });
  }
  kit.world.poi.set('kiteHill', V(cx, H + 0.5, cz));
}

// ------------------------------------------------------------------ playground

function playground(kit: Kit, b: Batch) {
  const game = kit.game;
  const world = kit.world;
  const { x: cx, z: cz } = PLAY;
  b.patch(cx, cz, 12.2, 9.4, 0xf2c98c, { mat: 'sand', lift: 0.035, seg: 36 });
  // rubber edge
  b.patch(cx, cz, 12.6, 9.8, 0x2f7fc1, { lift: 0.03, r0: 0.965, rings: 1, seg: 36 });

  // --- slide tower
  const sx = -78.5;
  const sz = 29.5;
  const cols = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047];
  for (const [dx, dz, i] of [
    [-0.8, -0.8, 0],
    [0.8, -0.8, 1],
    [-0.8, 0.8, 2],
    [0.8, 0.8, 3],
  ]) {
    b.cyl([sx + dx, 1.8, sz + dz], 0.09, 3.6, cols[i], { seg: 8, collide: true, mat: 'glossy' });
  }
  b.box([sx, 2.12, sz], [1.8, 0.15, 1.8], 0x1e88e5, { mat: 'glossy' });
  b.box([sx, 2.6, sz - 0.88], [1.7, 0.8, 0.06], 0xfdd835, { mat: 'glossy' });
  b.box([sx, 2.6, sz + 0.88], [1.7, 0.8, 0.06], 0xfdd835, { mat: 'glossy' });
  b.geo(GEO.cyl(0.02, 4), [sx, 4.15, sz], [0, Math.PI / 4, 0], [1.5, 1.1, 1.5], 0xe53935, { mat: 'glossy' });
  kit.collider([sx, 3.7, sz], [1.8, 0.2, 1.8]);
  // ladder (east)
  for (const s of [-0.35, 0.35]) b.cyl([sx + 0.95, 1.05, sz + s], 0.05, 2.1, 0x43a047, { seg: 6, collide: false });
  for (let y = 0.35; y < 2.1; y += 0.35) b.pipe([sx + 0.95, y, sz - 0.35], [sx + 0.95, y, sz + 0.35], 0.03, 0xfdd835, { seg: 5 });
  kit.collider([sx + 0.95, 1.05, sz], [0.1, 2.1, 0.8]);
  // slide chute heading west
  b.ramp([sx - 0.9, 2.2, sz], [sx - 5.2, 0.25, sz], 0.95, 0xfdd835, { mat: 'glossy', thick: 0.12, friction: 0.1 });
  for (const s of [-0.5, 0.5]) b.ramp([sx - 0.9, 2.42, sz + s], [sx - 5.2, 0.47, sz + s], 0.06, 0xff9800, { mat: 'glossy', thick: 0.28 });
  b.box([sx - 5.6, 0.15, sz], [0.9, 0.3, 1], 0xfdd835, { mat: 'glossy' });

  // --- swings (A-frame + swaying seats)
  const wz = 29.5;
  for (const x of [-95.5, -88.5]) {
    b.boxR([x, 1.55, wz - 0.6], [0.12, 3.3, 0.12], [0.36, 0, 0], 0xe53935, { mat: 'glossy' });
    b.boxR([x, 1.55, wz + 0.6], [0.12, 3.3, 0.12], [-0.36, 0, 0], 0xe53935, { mat: 'glossy' });
  }
  b.pipe([-95.6, 3.15, wz], [-88.4, 3.15, wz], 0.08, 0xfdd835, { mat: 'glossy', collide: true });
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
  const seatCols = [0x1e88e5, 0x43a047, 0xff7043];
  [-94, -92, -90].forEach((x, i) => {
    const g = new THREE.Group();
    g.position.set(x, 3.1, wz);
    for (const s of [-0.24, 0.24]) {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.45, 4), chainMat);
      ch.position.set(s, -1.225, 0);
      g.add(ch);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.26), new THREE.MeshStandardMaterial({ color: seatCols[i], roughness: 0.5 }));
    seat.position.y = -2.47;
    seat.castShadow = true;
    g.add(seat);
    world.staticRoot.add(g);
    kit.state.swayers.push({ obj: g, axis: 'x', amp: 0.12 + i * 0.1, speed: 1.95, phase: i * 1.7, base: 0 });
  });

  // --- seesaw (real physics: revolute joint)
  seesaw(kit, b, -85.5, 40.5);

  // --- sandbox
  const bx = -92;
  const bz = 38.3;
  for (const [dx, dz, w, d] of [
    [0, -2.2, 4.7, 0.3],
    [0, 2.2, 4.7, 0.3],
    [-2.2, 0, 0.3, 4.1],
    [2.2, 0, 0.3, 4.1],
  ]) {
    b.box([bx + dx, 0.17, bz + dz], [w, 0.34, d], 0xb07a45, { mat: 'planks' });
  }
  b.box([bx, 0.1, bz], [4.1, 0.2, 4.1], 0xf0dcaa, { mat: 'sand' });
  // sand castle
  b.cyl([bx + 0.8, 0.35, bz - 0.6], 0.5, 0.3, 0xe6cf98, { seg: 10, mat: 'sand', collide: false });
  for (const [dx, dz] of [
    [0.45, -0.25],
    [1.15, -0.25],
    [0.45, -0.95],
    [1.15, -0.95],
  ]) {
    b.cyl([bx + dx, 0.62, bz + dz], 0.13, 0.3, 0xe6cf98, { seg: 8, mat: 'sand', collide: false });
    b.cyl([bx + dx, 0.84, bz + dz], 0.14, 0.16, 0xe6cf98, { rTop: 0.01, seg: 8, mat: 'sand', collide: false });
  }
  P.sandBucket(game, bx - 0.9, 0.2, bz + 0.8, 0xff5a3a);
  P.sandBucket(game, bx - 1.3, 0.2, bz - 0.9, 0x3a8dff);
  P.beachBall(game, bx + 3.5, 0, bz + 2.8);

  // --- climbing dome (geodesic bars, convex-hull collider)
  climbingDome(kit, b, -78.5, 39.5, 2.7);

  // --- spring rider duck
  const rx = -82;
  const rz = 26.5;
  for (let i = 0; i < 5; i++) b.geo(new THREE.TorusGeometry(0.16, 0.035, 6, 12), [rx, 0.1 + i * 0.1, rz], [Math.PI / 2, 0, 0], 1, 0x9aa0a6, { mat: 'metal' });
  b.blob([rx, 0.75, rz], [0.35, 0.3, 0.5], 0xffd23a, { detail: 1, mat: 'glossy' });
  b.blob([rx, 1.1, rz + 0.35], 0.22, 0xffd23a, { detail: 1, mat: 'glossy' });
  b.box([rx, 1.08, rz + 0.6], [0.16, 0.06, 0.16], 0xff7a1a, { collide: false, mat: 'glossy' });
  kit.collider([rx, 0.55, rz], [0.6, 1.1, 0.9]);

  // --- benches for the grown-ups, and the sad kid's bench a little apart
  bench(b, -99.8, 0, 30, Math.PI / 2);
  bench(b, -99.8, 0, 38, Math.PI / 2);
  bench(b, -84, 0, 46.4, Math.PI);
  const sk = { x: -71.6, z: 33.5 };
  bench(b, sk.x, 0, sk.z, -Math.PI / 2, { wood: 0x8f6a45 });
  world.poi.set('sadKid', V(sk.x - 0.15, 0.45, sk.z));
  world.poi.set('playground', V(cx, 0.5, cz));
  P.trashCan(game, sk.x, 0, sk.z + 1.8);
  P.trashCan(game, -99.8, 0, 34);
}

function seesaw(kit: Kit, b: Batch, x: number, z: number) {
  const game = kit.game;
  const y = kit.world.heightAt(x, z);
  b.box([x, y + 0.2, z], [0.3, 0.4, 0.55], 0xfdd835, { mat: 'glossy' });
  b.boxR([x, y + 0.36, z], [0.36, 0.36, 0.5], [0, 0, Math.PI / 4], 0xfdd835, { mat: 'glossy', collide: false });
  const pivotY = y + 0.62;
  const group = new THREE.Group();
  const plank = new THREE.Mesh(
    bake([
      { geo: GEO.box, scale: [4.2, 0.1, 0.34], color: 0x1e88e5 },
      { geo: GEO.box, pos: [1.75, 0.08, 0], scale: [0.45, 0.06, 0.36], color: 0xe53935 },
      { geo: GEO.box, pos: [-1.75, 0.08, 0], scale: [0.45, 0.06, 0.36], color: 0xe53935 },
      { geo: GEO.box, pos: [1.45, 0.3, 0], scale: [0.05, 0.4, 0.05], color: 0x43a047 },
      { geo: GEO.box, pos: [-1.45, 0.3, 0], scale: [0.05, 0.4, 0.05], color: 0x43a047 },
      { geo: GEO.box, pos: [1.45, 0.5, 0], scale: [0.05, 0.05, 0.4], color: 0x43a047 },
      { geo: GEO.box, pos: [-1.45, 0.5, 0], scale: [0.05, 0.05, 0.4], color: 0x43a047 },
    ]),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }),
  );
  plank.castShadow = plank.receiveShadow = true;
  group.add(plank);
  group.position.set(x, pivotY, z);
  group.rotation.z = -0.24;
  game.scene.add(group);
  const anchor = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, pivotY, z));
  const cd = RAPIER.ColliderDesc.cuboid(2.1, 0.05, 0.17).setMass(22).setFriction(0.9).setCollisionGroups(groups(G.PROP));
  const body = game.physics.createDynamic(group, [cd], { angularDamping: 0.6, linearDamping: 0.2, sleeping: true });
  const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  const joint = game.physics.world.createImpulseJoint(jd, anchor, body, true) as RAPIER.RevoluteImpulseJoint;
  joint.setLimits(-0.25, 0.25);
  game.entities.create({
    kind: 'prop',
    name: 'Seesaw',
    body,
    object: group,
    mass: 22,
    tags: new Set(['seesaw']),
    onBonk(g, impulse) {
      // push down the end nearest to Jimothy → the other end catapults up
      const p = g.get<any>('player')?.position as THREE.Vector3 | undefined;
      const t = body.translation();
      const r = body.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const side = p ? Math.sign((p.x - t.x) * axis.x + (p.z - t.z) * axis.z) || 1 : 1;
      const end = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(axis, 1.9 * side);
      body.applyImpulseAtPoint({ x: 0, y: -Math.max(40, impulse.length() * 0.6), z: 0 }, { x: end.x, y: end.y, z: end.z }, true);
      g.score(40, 'Seesaw Slam', end);
      return true;
    },
  });
}

function climbingDome(kit: Kit, b: Batch, x: number, z: number, R: number) {
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const pos = ico.attributes.position;
  const verts: THREE.Vector3[] = [];
  const key = (v: THREE.Vector3) => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  const vmap = new Map<string, number>();
  const tri: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const k = key(v);
    let id = vmap.get(k);
    if (id == null) {
      id = verts.length;
      verts.push(v);
      vmap.set(k, id);
    }
    tri.push(id);
  }
  const edges = new Set<string>();
  const cols = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047];
  let n = 0;
  for (let i = 0; i < tri.length; i += 3) {
    for (const [a, c] of [
      [tri[i], tri[i + 1]],
      [tri[i + 1], tri[i + 2]],
      [tri[i + 2], tri[i]],
    ]) {
      const k = a < c ? `${a}-${c}` : `${c}-${a}`;
      if (edges.has(k)) continue;
      edges.add(k);
      const va = verts[a];
      const vc = verts[c];
      if (va.y < -0.05 || vc.y < -0.05) continue;
      b.pipe([x + va.x * R, va.y * R, z + va.z * R], [x + vc.x * R, vc.y * R, z + vc.z * R], 0.045, cols[n++ % 4], { seg: 6, mat: 'glossy' });
    }
  }
  for (const v of verts) if (v.y > -0.05) b.sphere([x + v.x * R, v.y * R, z + v.z * R], 0.07, 0x333333, { w: 6, h: 4 });
  const pts: number[] = [];
  for (const v of verts) if (v.y > -0.05) pts.push(x + v.x * R, Math.max(0, v.y * R), z + v.z * R);
  kit.hullCollider(pts);
}

// ------------------------------------------------------------------ picnic area, crow tree, fountain, birdbath

function picnic(kit: Kit, b: Batch) {
  const game = kit.game;
  const tables: [number, number, number][] = [
    [-96, -21.5, 0.25],
    [-87.5, -19.5, -0.3],
    [-94.5, -30.5, 0.5],
    [-85.5, -28.5, 0.05],
  ];
  tables.forEach(([x, z, ry], i) => {
    picnicTable(b, x, 0, z, ry);
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
    const top = 0.8;
    let [px, pz] = at(-0.55, 0.1);
    P.sandwich(game, px, top, pz, ry + 0.3);
    [px, pz] = at(0.35, -0.15);
    P.watermelonSlice(game, px, top, pz, ry + 1.2);
    if (i % 2 === 0) {
      [px, pz] = at(0.75, 0.2);
      P.watermelonSlice(game, px, top, pz, ry - 0.4);
    } else {
      [px, pz] = at(0.7, 0.15);
      P.sandwich(game, px, top, pz, ry);
    }
    // checkered tablecloth
    b.box([x, 0.805, z], [1.3, 0.012, 0.9], 0xffffff, { rotY: ry, collide: false, shadow: false, mat: 'flat' });
  });
  // cloth texture overlay (red gingham) as separate planes
  const ging = canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(214,40,40,0.55)';
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(i * 16, 0, 8, 128);
      ctx.fillRect(0, i * 16, 128, 8);
    }
  });
  const clothMat = new THREE.MeshStandardMaterial({ map: ging, roughness: 0.9 });
  for (const [x, z, ry] of tables) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.9).rotateX(-Math.PI / 2), clothMat);
    m.position.set(x, 0.814, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    kit.world.staticRoot.add(m);
  }
  // picnic blanket on the lawn with a basket
  const blanket = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2).rotateX(-Math.PI / 2), clothMat);
  blanket.position.set(-100.5, 0.03, -9);
  blanket.rotation.y = 0.4;
  blanket.receiveShadow = true;
  kit.world.staticRoot.add(blanket);
  b.box([-100.1, 0.2, -9.4], [0.6, 0.36, 0.42], 0xa0692f, { rotY: 0.4, mat: 'planks' });
  b.geo(new THREE.TorusGeometry(0.22, 0.03, 5, 12, Math.PI), [-100.1, 0.38, -9.4], [0, 0.4, 0], 1, 0x7a4f22, {});
  P.sandwich(game, -101.2, 0.04, -8.6, 0.8);
  P.cottonCandy(game, -100.8, 0.04, -9.9, 0x9fd8ff);

  // Cotton candy cart
  const cx = -80.5;
  const cz = -18.5;
  b.box([cx, 0.75, cz], [2.2, 0.9, 1.1], 0xff8fc4, { mat: 'glossy' });
  b.box([cx, 1.23, cz], [2.3, 0.06, 1.2], 0xffffff, { collide: false });
  for (const s of [-0.8, 0.8]) b.geo(GEO.cyl(1, 14), [cx + s, 0.35, cz + 0.58], [Math.PI / 2, 0, 0], [0.32, 0.08, 0.32], 0x333333, {});
  b.cyl([cx, 2.1, cz], 0.04, 1.8, 0xdddddd, { seg: 6, collide: false });
  b.cyl([cx, 3.0, cz], 1.4, 0.5, 0x7ec8ff, { rTop: 0.05, seg: 10, collide: false, mat: 'glossy' });
  const sgn = kit.textSign([{ text: 'COTTON CANDY', px: 70, color: '#ff4fa3', stroke: '#fff' }, { text: 'washes off easy!*', px: 34, color: '#555', font: FONT_ROUND }], { w: 2, h: 0.7, bg: '#fff7fb', border: '#ff8fc4' });
  kit.sign(b, { pos: [cx, 0.8, cz + 0.57], w: 1.9, h: 0.62, tex: sgn, depth: 0.02, collide: false });
  P.cottonCandy(game, cx - 0.6, 1.27, cz - 0.1, 0xff9fd2);
  P.cottonCandy(game, cx, 1.27, cz - 0.15, 0x9fd8ff);
  P.cottonCandy(game, cx + 0.6, 1.27, cz - 0.1, 0xc9a0ff);
  P.trashCan(game, -90, 0, -15);
  P.trashCan(game, -99.5, 0, -26.5);
  P.trashCan(game, -83, 0, -33);
  kit.world.poi.set('picnic', V(-91, 0.5, -25));
}

function crowTree(kit: Kit, b: Batch) {
  const { x, z } = CROW;
  const bark = 0x4f3a2a;
  b.cyl([x, 3.2, z], 1.15, 6.4, bark, { rTop: 0.8, seg: 12, collide: true });
  // roots
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    b.pipe([x + Math.cos(a) * 0.6, 0.6, z + Math.sin(a) * 0.6], [x + Math.cos(a) * 2.2, -0.1, z + Math.sin(a) * 2.2], 0.28, bark, { seg: 6 });
  }
  // big walkable branches
  const branches: [V3, V3, number][] = [
    [[x, 5.4, z], [x + 5.5, 8.6, z + 1.5], 0.42],
    [[x, 5.8, z], [x - 4.8, 9.2, z - 2.2], 0.4],
    [[x, 6.2, z], [x + 1, 10.6, z - 5], 0.36],
    [[x, 6.0, z], [x - 1.5, 9.6, z + 4.6], 0.36],
    [[x, 6.3, z], [x + 0.3, 12, z + 0.2], 0.5],
  ];
  for (const [a, c, r] of branches) b.pipe(a, c, r, bark, { seg: 8, collide: true });
  const greens = [0x2f6f32, 0x357a36, 0x3f8a3c, 0x2a6530];
  const rr = rng(11);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const d = i === 10 ? 0 : 3.5 + rr() * 2;
    const r = 2.6 + rr() * 1.4;
    b.blob([x + Math.cos(a) * d, 10.5 + rr() * 3 + (i === 10 ? 2.2 : 0), z + Math.sin(a) * d], [r, r * 0.8, r], greens[i % 4], { detail: 1, rotY: a });
  }
  // crow's nest on the big branch (bobblehead #2)
  const nx = x + 5.5;
  const nz = z + 1.5;
  b.geo(new THREE.TorusGeometry(0.75, 0.3, 6, 14), [nx, 8.9, nz], [Math.PI / 2, 0, 0], 1, 0x6b4f33, {});
  b.geo(GEO.cyl(1, 12), [nx, 8.75, nz], [0, 0, 0], [0.8, 0.2, 0.8], 0x5a4029, {});
  kit.collider([nx, 8.72, nz], [1.6, 0.25, 1.6]);
  kit.world.poi.set('bobblehead:s2', V(nx, 9.1, nz));
  // crows perched on branches and loitering below
  perched(kit, BIRD.crow(), [
    [x + 3.2, 7.55, z + 0.9, 1.2, 1.2],
    [x + 4.4, 8.25, z + 1.2, 1.4, 1.2],
    [x - 3.1, 8.2, z - 1.4, -1.3, 1.2],
    [x + 0.6, 9.5, z - 3.3, 3.0, 1.2],
    [x - 1.0, 8.6, z + 3.2, 0.2, 1.2],
    [x + 2.5, 0, z + 3.5, 2.2, 1.3],
    [x + 3.4, 0, z + 2.6, 2.9, 1.3],
    [x - 2.6, 0, z + 3.1, 0.6, 1.3],
  ]);
  // a couple circling the canopy
  flock(kit, BIRD.flyer(0x1b1d24, 0x22252d, 0x3a3a3a), 3, V(x, 0, z), 120, (i, t, out) => {
    const a = t * (0.5 + i * 0.12) + i * 2.1;
    const r = 8 + i * 2;
    out.set(x + Math.cos(a) * r, 15 + i * 1.5 + Math.sin(t * 0.8 + i) * 1, z + Math.sin(a) * r);
    return Math.atan2(-Math.sin(a), Math.cos(a));
  });
  // "don't feed the crows" sign
  const t = kit.textSign(
    [
      { text: 'CROW TREE', px: 64, color: '#fff', stroke: '#1b1d24' },
      { text: 'Please do not feed the crows.', px: 30, color: '#1b1d24', font: FONT_ROUND },
      { text: 'They will remember you.', px: 30, color: '#1b1d24', font: FONT_ROUND },
    ],
    { w: 1.8, h: 1.1, bg: '#e8f0d8', border: '#2f4a2a' },
  );
  const sx = x + 4.2;
  const sz = z + 4.6;
  b.cyl([sx, 0.7, sz], 0.05, 1.4, 0x3d2b1f, { seg: 6, collide: false });
  kit.sign(b, { pos: [sx, 1.55, sz], rotY: faceTo(sx, sz, -92, -20), w: 1.8, h: 1.1, tex: t, frame: 0x3d2b1f, back: false });
  kit.world.poi.set('crowTree', V(x + 2.4, 0.3, z + 2.2));
}

function fountain(kit: Kit, b: Batch, water: WaterSystem) {
  const { x, z } = FOUNTAIN;
  b.patch(x, z, 9, 9, 0xd9d2c3, { mat: 'paving', lift: 0.03, seg: 40, rings: 3 });
  const prof = [new THREE.Vector2(3.0, 0), new THREE.Vector2(3.5, 0), new THREE.Vector2(3.5, 0.62), new THREE.Vector2(3.3, 0.7), new THREE.Vector2(3.0, 0.62), new THREE.Vector2(3.0, 0.1)];
  b.geo(new THREE.LatheGeometry(prof, 40), [x, 0, z], [0, 0, 0], 1, 0xcfc6b4, { mat: 'stone' });
  b.geo(GEO.cyl(1, 32), [x, 0.08, z], [0, 0, 0], [3.05, 0.1, 3.05], 0x4a90b8, { shadow: false });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    kit.collider([x + Math.cos(a) * 3.25, 0.35, z + Math.sin(a) * 3.25], [1.1, 0.7, 0.5], -a + Math.PI / 2);
  }
  // tiered centrepiece
  b.cyl([x, 0.8, z], 0.35, 1.5, 0xcfc6b4, { mat: 'stone', seg: 12, collide: true });
  b.geo(new THREE.LatheGeometry([new THREE.Vector2(0.3, 0), new THREE.Vector2(1.3, 0.25), new THREE.Vector2(1.35, 0.45), new THREE.Vector2(1.2, 0.45), new THREE.Vector2(0.3, 0.2)], 24), [x, 1.45, z], [0, 0, 0], 1, 0xcfc6b4, { mat: 'stone' });
  kit.cylinderCollider([x, 1.7, z], 1.3, 0.4);
  b.cyl([x, 2.2, z], 0.12, 0.7, 0xb08d57, { mat: 'metal', seg: 8, collide: false });
  water.addCircle({ name: 'Park Fountain', kind: 'fountain', center: V(x, 0.52, z), radius: 3.0, depth: 0.45 });
  water.addCircle({ name: 'Park Fountain Bowl', kind: 'fountain', center: V(x, 1.86, z), radius: 1.18, depth: 0.2 });
  // spray: translucent column + droplets
  const sprayMat = water.material('fountain').clone();
  sprayMat.opacity = 0.55;
  const spray = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, 1.5, 10, 1, true), sprayMat);
  spray.position.set(x, 3.25, z);
  kit.world.staticRoot.add(spray);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), sprayMat);
  cap.position.set(x, 3.95, z);
  cap.scale.set(1.3, 0.6, 1.3);
  kit.world.staticRoot.add(cap);
  kit.state.spinners.push({ obj: spray, axis: 'y', speed: 2 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bx = x + Math.cos(a) * 6;
    const bz = z + Math.sin(a) * 6;
    bench(b, bx, 0, bz, faceTo(bx, bz, x, z));
  }
  kit.world.poi.set('parkFountain', V(x, 0.6, z));
}

function birdbath(kit: Kit, b: Batch, water: WaterSystem) {
  const { x, z } = BIRDBATH;
  b.cyl([x, 0.08, z], 0.45, 0.16, 0xbdb5a6, { mat: 'stone', seg: 12, collide: false });
  b.cyl([x, 0.5, z], 0.14, 0.8, 0xbdb5a6, { rTop: 0.1, mat: 'stone', seg: 10, collide: false });
  b.geo(new THREE.LatheGeometry([new THREE.Vector2(0.08, 0), new THREE.Vector2(0.62, 0.1), new THREE.Vector2(0.66, 0.2), new THREE.Vector2(0.55, 0.18), new THREE.Vector2(0.05, 0.1)], 20), [x, 0.85, z], [0, 0, 0], 1, 0xbdb5a6, { mat: 'stone' });
  kit.collider([x, 0.52, z], [0.5, 1.04, 0.5]);
  water.addCircle({ name: 'Birdbath', kind: 'birdbath', center: V(x, 1.02, z), radius: 0.52, depth: 0.12 });
  // flower ring
  const cols = [0xff5a8a, 0xffd23a, 0xb36bff, 0xff8c3a];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    b.blob([x + Math.cos(a) * 1.3, 0.28, z + Math.sin(a) * 1.3], 0.16, cols[i % 4], { detail: 0 });
    b.blob([x + Math.cos(a + 0.2) * 1.45, 0.14, z + Math.sin(a + 0.2) * 1.45], [0.25, 0.15, 0.25], 0x3f8f3a, { detail: 0 });
  }
  perched(kit, BIRD.crow(), [[x + 0.45, 1.02, z + 0.2, 2.2, 0.9]]);
  kit.world.poi.set('birdbath', V(x, 1.1, z));
}

// ------------------------------------------------------------------ benches, lamps, trash cans around the pond

function furniture(kit: Kit, b: Batch) {
  const game = kit.game;
  for (const a of [-100, -20, 72, 98, 168, 200, 250, 300]) {
    const [x, z] = onLoop(a, 25.3);
    bench(b, x, 0, z, faceTo(x, z, PX, PZ));
  }
  for (const a of [-20, 98, 200, 300]) {
    const [x, z] = onLoop(a + 3.2, 25.4);
    P.trashCan(game, x, 0, z);
  }
  const L: V3[] = [];
  for (const a of [-80, -30, 10, 60, 115, 150, 185, 225, 275, 325]) {
    const [x, z] = onLoop(a, 25);
    L.push([x, 0, z]);
  }
  L.push([-70, 0, -1.2], [-75, 0, 4], [-89, 0, 4], [-89, 0, -4], [-75, 0, -4], [-93, 0, -35], [-94.5, 0, -46], [-98, 0, 28], [-73, 0, 38], [-86.5, 0, 47], [-140, 0, -14], [-160, 0, -9.5], [-140.5, 0, 34.5]);
  lamps(kit, b, L, { style: 'park' });
}

// ------------------------------------------------------------------ trees & bushes

function greenery(b: Batch) {
  const r = rng(99);
  const excl: [number, number, number][] = [
    [PX, PZ, 26.5],
    [GAS.x, GAS.z, 21],
    [-134, -46, 11],
    [KITE_HILL.x, KITE_HILL.z, KITE_HILL.R + 1.5],
    [PLAY.x, PLAY.z, 15.5],
    [PICNIC.x, PICNIC.z, 11],
    [CROW.x, CROW.z, 10],
    [FOUNTAIN.x, FOUNTAIN.z, 10.5],
    [BIRDBATH.x, BIRDBATH.z, 3.5],
    [-80.5, -18.5, 3.5],
    [-100.5, -9, 3],
    [-143, -20.5, 5],
  ];
  const segs: [number, number, number, number][] = [
    [-66, 1.5, -97, 5],
    [-141, -17, -160, -12],
    [-160, -12, -172, 14],
    [PICNIC.x, PICNIC.z, -95, -54],
    [-86, 45, -88, 54],
    [-120, -13, -126, -44],
    [-141, 30, -143.5, 33],
  ];
  const nearSeg = (x: number, z: number, d: number) =>
    segs.some(([x0, z0, x1, z1]) => {
      const vx = x1 - x0;
      const vz = z1 - z0;
      const t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / (vx * vx + vz * vz)));
      return Math.hypot(x - (x0 + vx * t), z - (z0 + vz * t)) < d;
    });
  let seed = 1;
  for (let gx = -176; gx <= -70; gx += 10.5) {
    for (let gz = -50; gz <= 50; gz += 10.5) {
      const x = gx + (r() - 0.5) * 7;
      const z = gz + (r() - 0.5) * 7;
      if (x > -70 || x < -177 || z < -51 || z > 51) continue;
      if (excl.some(([ex, ez, er]) => Math.hypot(x - ex, z - ez) < er)) continue;
      if (nearSeg(x, z, 3.2)) continue;
      if (r() < 0.22) continue;
      const kind = r() < 0.18 ? 'pine' : r() < 0.3 ? 'tall' : 'round';
      tree(b, x, 0, z, 0.9 + r() * 0.45, seed++, { kind });
      if (r() < 0.45) bush(b, x + 2 + r(), 0, z + (r() - 0.5) * 3, 0.9 + r() * 0.6, [0x3f8f3a, 0x4a9a3f, 0x357a34][seed % 3]);
    }
  }
  // flowering bushes along the east edge by the road
  for (let z = -46; z <= 46; z += 7) if (Math.abs(z) > 6) bush(b, -69.5, 0, z, 1.1, [0x3f8f3a, 0x4a9a3f][Math.abs(z) % 2]);
}

// ------------------------------------------------------------------ signs

function signs(kit: Kit, b: Batch) {
  // Park entrance sign (faces east, toward the avenue)
  const tex = canvasTex(1024, 360, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2f6b3a');
    g.addColorStop(1, '#1f4d29');
    ctx.fillStyle = g;
    roundRect(ctx, 6, 6, w - 12, h - 12, 40);
    ctx.fill();
    ctx.strokeStyle = '#f2d98c';
    ctx.lineWidth = 10;
    roundRect(ctx, 20, 20, w - 40, h - 40, 30);
    ctx.stroke();
    fitText(ctx, 'GASWORKS-ISH PARK', w / 2, h * 0.42, w * 0.86, 130, FONT_TITLE, { fill: '#fff4cf', stroke: '#173a1f', strokeW: 12 });
    fitText(ctx, 'Kites · Ducks · Rusty Towers · Round Boys Welcome', w / 2, h * 0.76, w * 0.84, 44, FONT_ROUND, { fill: '#f2d98c' });
  });
  const sx = -68.8;
  const sz = 7.5;
  for (const dz of [-2.3, 2.3]) b.cyl([sx, 1.1, sz + dz], 0.14, 2.2, 0x5a3d26, { seg: 8, collide: true });
  kit.sign(b, { pos: [sx, 2.3, sz], rotY: Math.PI / 2, w: 5, h: 1.75, tex, frame: 0x5a3d26, back: true });
  // Gas works plaque
  const t2 = kit.textSign(
    [
      { text: 'THE GAS WORKS', px: 60, color: '#ffd9a0', stroke: '#3b1f12' },
      { text: 'Made gas from coal 1906–1956.', px: 28, color: '#fff', font: FONT_ROUND },
      { text: 'Now they mostly make vibes.', px: 28, color: '#fff', font: FONT_ROUND },
      { text: 'Climbing is (not) recommended.', px: 28, color: '#ffb36b', font: FONT_ROUND },
    ],
    { w: 2.2, h: 1.4, bg: '#5a3322', border: '#b8753f' },
  );
  b.cyl([-141.5, 0.65, -15.2], 0.06, 1.3, 0x3b2a20, { seg: 6, collide: false });
  kit.sign(b, { pos: [-141.5, 1.6, -15.2], rotY: faceTo(-141.5, -15.2, -120, 0), w: 2.2, h: 1.4, tex: t2, frame: 0x3b2a20 });
  // Kite hill
  const t3 = kit.textSign(
    [
      { text: 'KITE HILL', px: 70, color: '#fff', stroke: '#1e5aa8' },
      { text: 'Kites ✓   Picnics ✓   Rolling down ✓✓✓', px: 26, color: '#1e3a5f', font: FONT_ROUND },
    ],
    { w: 2.2, h: 1, bg: '#dff1ff', border: '#1e5aa8' },
  );
  b.cyl([-141.5, 0.6, 36.5], 0.06, 1.2, 0x3b2a20, { seg: 6, collide: false });
  kit.sign(b, { pos: [-141.5, 1.45, 36.5], rotY: Math.PI / 2, w: 2.2, h: 1, tex: t3, frame: 0x3b2a20 });
  // Playground
  const t4 = kit.textSign(
    [
      { text: 'PLAYGROUND', px: 64, color: '#ffe14a', stroke: '#b3261e' },
      { text: 'Ages 2–12 and one (1) round raccoon', px: 26, color: '#fff', font: FONT_ROUND },
    ],
    { w: 2.4, h: 0.9, bg: '#1e88e5', border: '#ffe14a' },
  );
  for (const dz of [-1.1, 1.1]) b.cyl([-98.6, 0.9, 23 + dz], 0.06, 1.8, 0xe53935, { seg: 6, collide: false });
  kit.sign(b, { pos: [-98.6, 1.7, 23], rotY: faceTo(-98.6, 23, -110, 18), w: 2.4, h: 0.9, tex: t4, frame: 0xe53935, collide: false });
  // Swan boats
  const t5 = kit.textSign(
    [
      { text: 'SWAN BOATS', px: 60, color: '#fff', stroke: '#1d4f7a' },
      { text: '$2 or one (1) shiny object', px: 30, color: '#1d4f7a', font: FONT_ROUND },
    ],
    { w: 1.8, h: 0.8, bg: '#bfe3ff', border: '#1d4f7a' },
  );
  b.cyl([-97.2, 0.7, 20.2], 0.05, 1.4, 0x5a3d26, { seg: 6, collide: false });
  kit.sign(b, { pos: [-97.2, 1.45, 20.2], rotY: Math.PI / 2, w: 1.8, h: 0.8, tex: t5, frame: 0x5a3d26 });
}
