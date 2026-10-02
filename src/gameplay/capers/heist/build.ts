import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { Game } from '../../../core/Game';
import { RAPIER, G, groups } from '../../../core/Physics';
import { paintMesh, paintMat, T, TR, between, SignAtlas, drawBoard, fitText, FONT_BOLD, type Part } from '../shared';
import { drawMona, drawStarry, plaque, closedSign, banner, hazardSign } from './art';

/**
 * The Ballard Museum of Extremely Shiny Things: geometry, colliders and signs. Everything is authored in a local
 * frame (+z = front / the steps, x = width, metres, y = 0 at the ground) and placed with `origin` + `yaw`.
 *
 *   local z  9.0 … 10.0   steps            (portico floor at F, columns at z = 8.4)
 *            1.1 … 6.85   LOBBY            (front doors x ±1.2, guard desk, dino, bottle cap under the skylight)
 *           -2.2 … 0.9    LASER HALLWAY    (doorway A at the west end x -8.6…-7.0, doorway B at the east end x 7…8.6)
 *           -6.85 … -2.4  VAULT            (the pedestal at (0, -4.6), loot plinths along the back wall)
 *
 * Walls/roof colliders are cut into ≤ 0.8 m strips: the engine treats those as "thin" (physics.isThin), so the
 * third-person camera never collides with them (it would pump in and out in these narrow rooms). Instead the walls
 * between the camera and Jimothy fade out and the roof hides while he's inside (HeistFeature.lateUpdate).
 */

export const F = 0.3; // floor top
export const WALL_TOP = 4.5;
export const ROOF_T = 0.25;
export const HALF_W = 10;
export const HALF_D = 7;
export const WALL_A_Z = 1.0;
export const WALL_B_Z = -2.3;
export const DOOR_A: [number, number] = [-8.6, -7.0];
export const DOOR_B: [number, number] = [7.0, 8.6];
export const FRONT_DOOR: [number, number] = [-1.2, 1.2];
export const VENT_Z: [number, number] = [3.5, 4.5];
export const VENT_H = 0.98;
export const SKY_X: [number, number] = [4.4, 6.0];
export const SKY_Z: [number, number] = [3.0, 4.6];
export const PEDESTAL = new THREE.Vector3(0, F + 1.0, -4.6); // top centre
export const HALL_Z: [number, number] = [WALL_B_Z + 0.125, WALL_A_Z - 0.125];
export const GUARD_POST = new THREE.Vector3(-3.4, F, 2.75);
export const DESK = new THREE.Vector3(-3.4, F, 3.55);
/** Exhibit loot spots (local, bottom of the item) + item kind. */
export const LOOT: [number, number, number, string][] = [
  [-8.0, F + 0.62, -6.1, 'goldenTrophy'],
  [-5.6, F + 0.62, -6.1, 'ring'],
  [-3.2, F + 0.62, -6.1, 'marble'],
  [3.2, F + 0.62, -6.1, 'key'],
  [5.6, F + 0.62, -6.1, 'bottleCap'],
  [8.0, F + 0.62, -6.1, 'vase'],
  [8.6, F + 0.62, 6.0, 'ring'],
  [-8.6, F + 0.62, 6.2, 'marble'],
];

const STONE = 0xe8dfca;
const STONE_DARK = 0xcfc3a6;
const ROOF = 0x8a8f99;
const WAINSCOT = 0x5a3b2a;
const LOBBY_WALL = 0x8c2f3a;
const HALL_WALL = 0x2c3346;
const VAULT_WALL = 0x24504a;
const GOLD = 0xe5b53a;
const BRASS = 0xc9a24a;
const VELVET = 0xb3203a;

export interface WallVis {
  id: string;
  mesh: THREE.Mesh;
  glow: THREE.Mesh | null;
  mat: THREE.MeshStandardMaterial;
  /** Local XZ segment (wall centre line). */
  a: THREE.Vector2;
  b: THREE.Vector2;
  opacity: number;
  /** Things mounted on this wall that hide with it (facade banners, doors). */
  extras: THREE.Object3D[];
}

interface Hole {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export class Museum {
  readonly root = new THREE.Group();
  readonly roof = new THREE.Group();
  readonly walls: WallVis[] = [];
  readonly glowMat: THREE.MeshBasicMaterial;
  readonly beaconMat: THREE.MeshBasicMaterial;
  readonly haloMat: THREE.MeshBasicMaterial;
  readonly extAtlas = new SignAtlas();
  readonly intAtlas = new SignAtlas();
  doorL!: THREE.Object3D;
  doorR!: THREE.Object3D;
  doorCollider: RAPIER_T.Collider | null = null;
  doorOpen = 0;
  private colliders = 0;

  constructor(
    private game: Game,
    readonly origin: THREE.Vector3,
    readonly yaw: number,
  ) {
    this.root.position.copy(origin);
    this.root.rotation.y = yaw;
    this.root.name = 'heist-museum';
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.2, 0.95), toneMapped: false });
    this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.08, 0.08), toneMapped: false });
    this.haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.35, 0.8), toneMapped: false, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.extAtlas.material.emissiveIntensity = 0.08;
    this.intAtlas.material.emissiveIntensity = 0.32;
  }

  // ------------------------------------------------------------------------------------------- frames
  toWorld(x: number, y: number, z: number, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyAxisAngle(_up, this.yaw).add(this.origin);
  }
  toLocal(p: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(p).sub(this.origin).applyAxisAngle(_up, -this.yaw);
  }
  /** World yaw for a local yaw. */
  wyaw(localYaw: number) {
    return localYaw + this.yaw;
  }

  /** A static world collider: local centre + full size (yaw follows the building). */
  col(x: number, y: number, z: number, w: number, h: number, d: number): RAPIER_T.Collider {
    this.colliders++;
    _q.setFromAxisAngle(_up, this.yaw);
    return this.game.physics.staticBox(this.toWorld(x, y, z), new THREE.Vector3(w / 2, h / 2, d / 2), _q);
  }

  /** Thin cylinder collider (columns, posts, the drainpipe). */
  colCyl(x: number, y0: number, z: number, r: number, h: number) {
    this.colliders++;
    const p = this.toWorld(x, y0 + h / 2, z);
    const cd = RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(p.x, p.y, p.z).setCollisionGroups(groups(G.WORLD)).setFriction(0.8);
    return this.game.physics.world.createCollider(cd);
  }

  // ------------------------------------------------------------------------------------------- build
  build() {
    const game = this.game;
    game.scene.add(this.root);
    this.buildBase();
    this.buildWalls();
    this.buildRoof();
    this.buildFacade();
    this.buildDoors();
    this.buildLobby();
    this.buildHall();
    this.buildVault();
    game.physics.refreshQueries();
  }

  private buildBase() {
    const parts: Part[] = [];
    // floor slab (+ portico) and steps
    parts.push({ g: new THREE.BoxGeometry(20.6, F, 16.6), c: STONE_DARK, m: T(0, F / 2, 1.0) });
    parts.push({ g: new THREE.BoxGeometry(14, 0.2, 0.55), c: STONE_DARK, m: T(0, 0.1, 9.55) });
    parts.push({ g: new THREE.BoxGeometry(15, 0.1, 0.5), c: STONE_DARK, m: T(0, 0.05, 10.05) });
    // interior floors: lobby checker, hallway dark, vault teal stone + a red carpet runner
    parts.push({ g: new THREE.BoxGeometry(19.7, 0.02, 5.7), c: 0xe9e3d6, m: T(0, F + 0.01, 3.98) });
    for (let ix = 0; ix < 10; ix++)
      for (let iz = 0; iz < 3; iz++)
        if ((ix + iz) % 2 === 0) parts.push({ g: new THREE.BoxGeometry(1.97, 0.022, 1.9), c: 0x6f6a63, m: T(-8.86 + ix * 1.97, F + 0.012, 1.08 + 0.95 + iz * 1.9) });
    parts.push({ g: new THREE.BoxGeometry(2.0, 0.026, 5.6), c: VELVET, m: T(0, F + 0.014, 4.0) });
    parts.push({ g: new THREE.BoxGeometry(19.7, 0.02, 3.0), c: 0x3a3f4d, m: T(0, F + 0.01, -0.65) });
    parts.push({ g: new THREE.BoxGeometry(19.7, 0.02, 4.4), c: 0x3d5f58, m: T(0, F + 0.01, -4.63) });
    parts.push({ g: new THREE.BoxGeometry(3.4, 0.026, 3.4), c: 0x2a4743, m: T(0, F + 0.016, -4.6) });
    const mesh = paintMesh(parts);
    mesh.castShadow = false;
    this.root.add(mesh);
    this.col(0, F / 2, 1.0, 20.6, F, 16.6);
    this.col(0, 0.1, 9.55, 14, 0.2, 0.55);
    this.col(0, 0.05, 10.05, 15, 0.1, 0.5);
  }

  /**
   * One wall: visual (fades as one mesh), interior paneling on the given sides and the strip colliders.
   * `axis` 'x' = runs along local x at z = `at`; 'z' = runs along local z at x = `at`.
   */
  private wall(
    id: string,
    axis: 'x' | 'z',
    at: number,
    a0: number,
    a1: number,
    thick: number,
    holes: Hole[],
    sides: { sign: 1 | -1; upper: number | ((a: number) => number) }[],
    outer = STONE,
  ) {
    const parts: Part[] = [];
    const glow: Part[] = [];
    const y0 = 0;
    const y1 = WALL_TOP;
    const cuts = new Set<number>([a0, a1]);
    for (const h of holes) {
      cuts.add(h.a0);
      cuts.add(h.a1);
    }
    // side walls change colour per room
    if (axis === 'z') for (const z of [WALL_A_Z, WALL_B_Z]) if (z > a0 && z < a1) cuts.add(z);
    const xs = [...cuts].sort((p, q) => p - q);
    const place = (a: number, y: number, n: number) => (axis === 'x' ? new THREE.Vector3(a, y, at + n) : new THREE.Vector3(at + n, y, a));
    const boxG = (len: number, h: number, th: number) => (axis === 'x' ? new THREE.BoxGeometry(len, h, th) : new THREE.BoxGeometry(th, h, len));
    for (let i = 0; i < xs.length - 1; i++) {
      const b0 = xs[i];
      const b1 = xs[i + 1];
      if (b1 - b0 < 0.01) continue;
      const hole = holes.find((h) => h.a0 <= b0 + 1e-3 && h.a1 >= b1 - 1e-3);
      const pieces: [number, number][] = hole ? [[y0, hole.y0], [hole.y1, y1]] : [[y0, y1]];
      const len = b1 - b0;
      const mid = (b0 + b1) / 2;
      for (const [p0, p1] of pieces) {
        if (p1 - p0 < 0.01) continue;
        const h = p1 - p0;
        const c = place(mid, (p0 + p1) / 2, 0);
        parts.push({ g: boxG(len, h, thick), c: outer, m: T(c.x, c.y, c.z) });
        // strip colliders (≤ 0.8 m wide → "thin" for the camera)
        const n = Math.max(1, Math.ceil(len / 0.8 - 1e-6));
        const sw = len / n;
        for (let k = 0; k < n; k++) {
          const sa = b0 + sw * (k + 0.5);
          const cc = place(sa, (p0 + p1) / 2, 0);
          if (axis === 'x') this.col(cc.x, cc.y, cc.z, sw, h, thick);
          else this.col(cc.x, cc.y, cc.z, thick, h, sw);
        }
        // interior paneling (wainscot + paint), only above the floor
        for (const s of sides) {
          const n2 = s.sign * (thick / 2 + 0.012);
          const lo0 = Math.max(p0, F);
          const lo1 = Math.min(p1, F + 1.0);
          if (lo1 - lo0 > 0.01) {
            const q = place(mid, (lo0 + lo1) / 2, n2);
            parts.push({ g: boxG(len, lo1 - lo0, 0.024), c: WAINSCOT, m: T(q.x, q.y, q.z) });
          }
          const up0 = Math.max(p0, F + 1.0);
          const up1 = Math.min(p1, WALL_TOP - 0.3);
          if (up1 - up0 > 0.01) {
            const q = place(mid, (up0 + up1) / 2, n2);
            parts.push({ g: boxG(len, up1 - up0, 0.024), c: typeof s.upper === 'function' ? s.upper(mid) : s.upper, m: T(q.x, q.y, q.z) });
          }
          // brass rail + cove light
          if (p0 <= F + 1.0 && p1 >= F + 1.06) {
            const q = place(mid, F + 1.03, n2 * 1.25);
            parts.push({ g: boxG(len, 0.06, 0.04), c: BRASS, m: T(q.x, q.y, q.z) });
          }
          if (p1 >= WALL_TOP - 0.05) {
            const q = place(mid, WALL_TOP - 0.22, s.sign * (thick / 2 + 0.05));
            glow.push({ g: boxG(len, 0.08, 0.05), c: 0xffffff, m: T(q.x, q.y, q.z) });
          }
        }
      }
    }
    const mat = paintMat().clone();
    const mesh = new THREE.Mesh(paintMesh(parts).geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `heist-wall-${id}`;
    this.root.add(mesh);
    let gm: THREE.Mesh | null = null;
    if (glow.length) {
      gm = new THREE.Mesh(paintMesh(glow, false).geometry, this.glowMat);
      gm.castShadow = false;
      this.root.add(gm);
    }
    const a = axis === 'x' ? new THREE.Vector2(a0, at) : new THREE.Vector2(at, a0);
    const b = axis === 'x' ? new THREE.Vector2(a1, at) : new THREE.Vector2(at, a1);
    this.walls.push({ id, mesh, glow: gm, mat, a, b, opacity: 1, extras: [] });
  }

  private buildWalls() {
    const t = 0.3;
    const W = HALF_W;
    const D = HALF_D;
    // front (doors), back, sides (the vent on the -x side)
    this.wall('front', 'x', D, -W - t / 2, W + t / 2, t, [{ a0: FRONT_DOOR[0], a1: FRONT_DOOR[1], y0: F, y1: F + 2.9 }], [{ sign: -1, upper: LOBBY_WALL }]);
    this.wall('back', 'x', -D, -W - t / 2, W + t / 2, t, [], [{ sign: 1, upper: VAULT_WALL }]);
    const room = (z: number) => (z > WALL_A_Z ? LOBBY_WALL : z > WALL_B_Z ? HALL_WALL : VAULT_WALL);
    this.wall('west', 'z', -W, -D + t / 2, D - t / 2, t, [{ a0: VENT_Z[0], a1: VENT_Z[1], y0: F, y1: F + VENT_H }], [{ sign: 1, upper: room }]);
    this.wall('east', 'z', W, -D + t / 2, D - t / 2, t, [], [{ sign: -1, upper: room }]);
    // interior walls with doorways
    this.wall('A', 'x', WALL_A_Z, -W + t / 2, W - t / 2, 0.25, [{ a0: DOOR_A[0], a1: DOOR_A[1], y0: 0, y1: F + 2.6 }], [{ sign: 1, upper: LOBBY_WALL }, { sign: -1, upper: HALL_WALL }]);
    this.wall('B', 'x', WALL_B_Z, -W + t / 2, W - t / 2, 0.25, [{ a0: DOOR_B[0], a1: DOOR_B[1], y0: 0, y1: F + 2.6 }], [{ sign: 1, upper: HALL_WALL }, { sign: -1, upper: VAULT_WALL }]);
    // the vent: a little louvred hood around the opening (outside) + a duct lip
    const parts: Part[] = [];
    const vz = (VENT_Z[0] + VENT_Z[1]) / 2;
    const vw = VENT_Z[1] - VENT_Z[0];
    parts.push({ g: new THREE.BoxGeometry(0.5, 0.08, vw + 0.3), c: 0x9aa1aa, m: T(-W - 0.33, F + VENT_H + 0.04, vz) });
    for (const s of [-1, 1]) parts.push({ g: new THREE.BoxGeometry(0.5, VENT_H + 0.08, 0.1), c: 0x9aa1aa, m: T(-W - 0.33, F + VENT_H / 2, vz + s * (vw / 2 + 0.1)) });
    parts.push({ g: new THREE.BoxGeometry(0.62, F, vw + 0.3), c: 0x9aa1aa, m: T(-W - 0.4, F / 2, vz) });
    // a milk crate step by the vent (raccoon infrastructure)
    parts.push({ g: new THREE.BoxGeometry(0.5, 0.16, 0.6), c: 0x2f6fb0, m: T(-W - 1.0, 0.08, vz) });
    const m = paintMesh(parts);
    this.root.add(m);
    this.col(-W - 0.4, F / 2, vz, 0.62, F, vw + 0.3);
    this.col(-W - 1.0, 0.08, vz, 0.5, 0.16, 0.6);
    for (const s of [-1, 1]) this.col(-W - 0.33, F + VENT_H / 2, vz + s * (vw / 2 + 0.1), 0.5, VENT_H, 0.1);
  }

  private buildRoof() {
    const parts: Part[] = [];
    const W = HALF_W + 0.3;
    const z0 = -HALF_D - 0.3;
    const z1 = 9.0;
    const y = WALL_TOP + ROOF_T / 2;
    // slab with the skylight hole (4 boxes around it), cornice, parapet lip
    const hx0 = SKY_X[0];
    const hx1 = SKY_X[1];
    const hz0 = SKY_Z[0];
    const hz1 = SKY_Z[1];
    const slab = (xa: number, xb: number, za: number, zb: number) => {
      if (xb - xa < 0.01 || zb - za < 0.01) return;
      parts.push({ g: new THREE.BoxGeometry(xb - xa, ROOF_T, zb - za), c: ROOF, m: T((xa + xb) / 2, y, (za + zb) / 2) });
    };
    slab(-W, hx0, z0, z1);
    slab(hx1, W, z0, z1);
    slab(hx0, hx1, z0, hz0);
    slab(hx0, hx1, hz1, z1);
    parts.push({ g: new THREE.BoxGeometry(2 * W + 0.4, 0.3, 0.4), c: STONE, m: T(0, WALL_TOP - 0.1, z1) });
    parts.push({ g: new THREE.BoxGeometry(2 * W + 0.4, 0.3, 0.4), c: STONE, m: T(0, WALL_TOP - 0.1, z0) });
    for (const s of [-1, 1]) parts.push({ g: new THREE.BoxGeometry(0.4, 0.3, z1 - z0 + 0.4), c: STONE, m: T(s * W, WALL_TOP - 0.1, (z0 + z1) / 2) });
    // skylight: curb + a propped-open glass pane (hinged on the north edge)
    const cx = (hx0 + hx1) / 2;
    const cz = (hz0 + hz1) / 2;
    for (const s of [-1, 1]) {
      parts.push({ g: new THREE.BoxGeometry(hx1 - hx0 + 0.2, 0.16, 0.1), c: 0x6d737c, m: T(cx, y + 0.2, cz + s * ((hz1 - hz0) / 2 + 0.05)) });
      parts.push({ g: new THREE.BoxGeometry(0.1, 0.16, hz1 - hz0), c: 0x6d737c, m: T(cx + s * ((hx1 - hx0) / 2 + 0.05), y + 0.2, cz) });
    }
    parts.push({ g: new THREE.BoxGeometry(hx1 - hx0, 0.04, hz1 - hz0), c: 0xb8dcef, m: TR(cx, y + 0.75, hz0 - 0.05, -1.05, 0, 0) });
    // HVAC box + vent stack, because every roof has them
    parts.push({ g: new THREE.BoxGeometry(2.2, 1.0, 1.6), c: 0xa9afb7, m: T(-5, y + 0.6, -3.5) });
    parts.push({ g: new THREE.CylinderGeometry(0.5, 0.5, 0.08, 16), c: 0x6d737c, m: T(-5, y + 1.14, -3.5) });
    const mesh = paintMesh(parts);
    this.roof.add(mesh);
    this.root.add(this.roof);
    // strip colliders (thin for the camera); the skylight hole stays open
    const yC = WALL_TOP + ROOF_T / 2;
    for (let x = -W; x < W - 1e-3; x += 0.8) {
      const xa = x;
      const xb = Math.min(W, x + 0.8);
      const mid = (xa + xb) / 2;
      const inHole = mid > hx0 && mid < hx1;
      const spans: [number, number][] = inHole ? [[z0, hz0], [hz1, z1]] : [[z0, z1]];
      for (const [za, zb] of spans) this.col(mid, yC, (za + zb) / 2, xb - xa, ROOF_T, zb - za);
    }
    this.col(-5, yC + 0.6, -3.5, 2.2, 1.0, 1.6);
  }

  private buildFacade() {
    const parts: Part[] = [];
    const cols: Part[] = [];
    // portico columns + plinths + capitals (own mesh: they hide with the front wall when the camera is behind them)
    for (const x of [-7.5, -4.5, -1.8, 1.8, 4.5, 7.5]) {
      cols.push({ g: new THREE.CylinderGeometry(0.3, 0.34, WALL_TOP - F - 0.4, 14), c: 0xf3ecdc, m: T(x, F + 0.2 + (WALL_TOP - F - 0.4) / 2, 8.4) });
      cols.push({ g: new THREE.BoxGeometry(0.85, 0.2, 0.85), c: STONE, m: T(x, F + 0.1, 8.4) });
      cols.push({ g: new THREE.BoxGeometry(0.85, 0.2, 0.85), c: STONE, m: T(x, WALL_TOP - 0.1, 8.4) });
      this.colCyl(x, F, 8.4, 0.34, WALL_TOP - F);
    }
    // pediment (triangular gable) above the frieze
    const tri = new THREE.Shape();
    tri.moveTo(-10.5, 0);
    tri.lineTo(10.5, 0);
    tri.lineTo(0, 2.1);
    tri.closePath();
    const ped = new THREE.ExtrudeGeometry(tri, { depth: 0.6, bevelEnabled: false });
    parts.push({ g: ped, c: STONE, m: T(0, WALL_TOP + ROOF_T, 8.4) });
    // frieze band + gold trim
    parts.push({ g: new THREE.BoxGeometry(21, 0.12, 0.66), c: GOLD, m: T(0, WALL_TOP + ROOF_T + 0.06, 8.72) });
    // drainpipe on the east corner (+x side), to the roof
    const pipeX = HALF_W + 0.28;
    const pipeZ = 5.6;
    parts.push({ g: new THREE.CylinderGeometry(0.09, 0.09, WALL_TOP + 0.1, 10), c: 0x6f7a6a, m: T(pipeX, (WALL_TOP + 0.1) / 2, pipeZ) });
    parts.push({ g: new THREE.BoxGeometry(0.4, 0.14, 0.3), c: 0x6f7a6a, m: T(pipeX - 0.12, WALL_TOP + 0.05, pipeZ) });
    for (let yy = 0.6; yy < WALL_TOP; yy += 1.1) parts.push({ g: new THREE.BoxGeometry(0.3, 0.06, 0.08), c: 0x4b5348, m: T(pipeX - 0.12, yy, pipeZ) });
    parts.push({ g: new THREE.BoxGeometry(0.3, 0.1, 0.3), c: 0x6f7a6a, m: T(pipeX + 0.08, 0.05, pipeZ) });
    this.colCyl(pipeX, 0, pipeZ, 0.1, WALL_TOP + 0.1);
    const mesh = paintMesh(parts);
    this.root.add(mesh);
    const colMesh = paintMesh(cols);
    this.root.add(colMesh);
    this.walls.find((w) => w.id === 'front')?.extras.push(colMesh);
    // the big sign on the pediment
    const main = this.extAtlas.add(1024, 220, drawBoard('BALLARD MUSEUM', 'OF EXTREMELY SHINY THINGS', '#24504a', '#e5b53a', '#fff7e0', '#f6d36b'));
    const sign = this.extAtlas.quad(main, 6.4, 1.375);
    sign.position.set(0, WALL_TOP + ROOF_T + 0.75, 9.04);
    this.root.add(sign);
    // gala banners on the facade (between the outer columns)
    const b1 = this.extAtlas.add(240, 520, banner(['GALA', 'TONIGHT', '★', 'BLACK', 'TIE'], '#7a1f2e'));
    const b2 = this.extAtlas.add(240, 520, banner(['NOW', 'SHOWING', '★', 'THE', 'GOLDEN', 'TRASH', 'CAN LID'], '#24504a'));
    const front = this.walls.find((w) => w.id === 'front');
    for (const [i, x] of [[b1, -6.0], [b2, -3.1], [b1, 3.1], [b2, 6.0]] as const) {
      const q = this.extAtlas.quad(i, 1.1, 2.4);
      q.position.set(x, F + 2.5, HALF_D + 0.17);
      this.root.add(q);
      front?.extras.push(q);
    }
    // little "STAFF ONLY: VENT" stencil, because raccoons can read
    const vent = this.extAtlas.add(256, 110, (c, w, h) => {
      c.fillStyle = '#4a4f57';
      c.fillRect(0, 0, w, h);
      fitText(c, 'VENT · DO NOT ENTER', w / 2, h * 0.32, w * 0.9, h * 0.36, FONT_BOLD, { fill: '#e9e2cf' });
      fitText(c, '(this means raccoons)', w / 2, h * 0.72, w * 0.9, h * 0.3, FONT_BOLD, { fill: '#ffd23f' });
    });
    const vq = this.extAtlas.quad(vent, 1.2, 0.52);
    vq.rotation.y = -Math.PI / 2;
    vq.position.set(-HALF_W - 0.16, F + VENT_H + 0.55, (VENT_Z[0] + VENT_Z[1]) / 2);
    this.root.add(vq);
  }

  private buildDoors() {
    const mk = () => {
      const parts: Part[] = [
        { g: new THREE.BoxGeometry(1.2, 2.9, 0.1), c: 0x2b2f38, m: T(0, 1.45, 0) },
        { g: new THREE.BoxGeometry(0.06, 1.8, 0.14), c: BRASS, m: T(0.45, 1.3, 0) },
      ];
      const frame = paintMesh(parts);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.11), new THREE.MeshStandardMaterial({ color: 0x9fc6d8, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.55 }));
      glass.position.set(0, 1.5, 0);
      const g = new THREE.Group();
      g.add(frame, glass);
      return g;
    };
    this.doorL = mk();
    this.doorR = mk();
    this.doorL.position.set(-0.6, F, HALF_D);
    this.doorR.position.set(0.6, F, HALF_D);
    this.doorR.scale.x = -1;
    this.root.add(this.doorL, this.doorR);
    this.walls.find((w) => w.id === 'front')?.extras.push(this.doorL, this.doorR);
    const cs = this.extAtlas.add(512, 256, closedSign);
    const s = this.extAtlas.quad(cs, 1.6, 0.8);
    s.position.set(0.6, 1.5, 0.1);
    this.doorL.add(s);
    this.closeDoors();
  }

  closeDoors() {
    if (this.doorCollider) return;
    this.doorCollider = this.col(0, F + 1.45, HALF_D, 2.4, 2.9, 0.2);
    this.game.physics.refreshQueries();
  }
  openDoors() {
    if (!this.doorCollider) return;
    this.game.physics.world.removeCollider(this.doorCollider, false);
    this.doorCollider = null;
    this.game.physics.refreshQueries();
  }
  /** Slide the door panels toward `open` (0 shut … 1 open). */
  animateDoors(dt: number) {
    const want = this.doorCollider ? 0 : 1;
    if (Math.abs(this.doorOpen - want) < 1e-3) return;
    this.doorOpen += Math.sign(want - this.doorOpen) * Math.min(Math.abs(want - this.doorOpen), dt * 2.2);
    this.doorL.position.x = -0.6 - this.doorOpen * 1.1;
    this.doorR.position.x = 0.6 + this.doorOpen * 1.1;
  }

  private buildLobby() {
    const parts: Part[] = [];
    // guard desk (the guard stands behind it, facing the doors... in theory)
    const d = DESK;
    parts.push({ g: new THREE.BoxGeometry(2.2, 1.05, 0.7), c: 0x6b4a2f, m: T(d.x, F + 0.525, d.z) });
    parts.push({ g: new THREE.BoxGeometry(2.3, 0.06, 0.8), c: 0x3a2a1c, m: T(d.x, F + 1.08, d.z) });
    parts.push({ g: new THREE.BoxGeometry(0.6, 0.42, 0.06), c: 0x1d1d22, m: TR(d.x - 0.5, F + 1.32, d.z - 0.05, -0.15, Math.PI, 0) });
    parts.push({ g: new THREE.CylinderGeometry(0.05, 0.045, 0.12, 10), c: 0xf2f2f2, m: T(d.x + 0.6, F + 1.17, d.z - 0.1) });
    parts.push({ g: new THREE.BoxGeometry(0.34, 0.07, 0.34), c: 0xf3a6c8, m: T(d.x + 0.15, F + 1.145, d.z - 0.05) }); // donut box
    this.col(d.x, F + 0.55, d.z, 2.3, 1.1, 0.8);
    // Soda-Can-osaurus (a sauropod made of giant soda cans), on a low stage with velvet ropes
    const dz = new THREE.Vector3(2.4, F, 3.6);
    parts.push({ g: new THREE.BoxGeometry(3.6, 0.22, 1.7), c: 0x3a3f4d, m: T(dz.x, F + 0.11, dz.z) });
    this.col(dz.x, F + 0.11, dz.z, 3.6, 0.22, 1.7);
    const canCols = [0xd23a32, 0xc9ced6, 0x2f6fb0, 0x3aa35a, 0xe8b33a];
    let ci = 0;
    const can = (x: number, y: number, z: number, rx = 0, rz = 0) => {
      parts.push({ g: new THREE.CylinderGeometry(0.09, 0.09, 0.24, 8), c: canCols[ci++ % canCols.length], m: TR(dz.x + x, F + 0.22 + y, dz.z + z, rx, 0, rz) });
    };
    for (const [lx, lz] of [[-0.6, -0.3], [-0.6, 0.3], [0.5, -0.3], [0.5, 0.3]]) for (let k = 0; k < 3; k++) can(lx, 0.12 + k * 0.24, lz);
    for (let ix = -4; ix <= 4; ix++) for (let iz = -1; iz <= 1; iz++) {
      const hgt = 0.82 + Math.cos(ix * 0.32) * 0.18 - Math.abs(iz) * 0.06;
      can(ix * 0.18, hgt, iz * 0.2, 0, Math.PI / 2);
      if (Math.abs(ix) < 3) can(ix * 0.18, hgt + 0.18, iz * 0.17, 0, Math.PI / 2);
    }
    for (let k = 0; k < 6; k++) can(-0.85 - k * 0.12, 1.05 + k * 0.2, 0, 0, -0.5); // neck
    can(-1.62, 2.18, 0, 0, Math.PI / 2);
    can(-1.82, 2.16, 0, 0, Math.PI / 2); // head
    for (let k = 0; k < 6; k++) can(0.88 + k * 0.17, 0.85 - k * 0.11, 0, 0, Math.PI / 2 + 0.4); // tail
    this.col(dz.x - 0.3, F + 1.0, dz.z, 2.4, 1.6, 0.8);
    // velvet rope posts around the dino
    const posts: [number, number][] = [[-1.9, -1.0], [0, -1.0], [1.9, -1.0], [-1.9, 1.0], [0, 1.0], [1.9, 1.0]];
    this.ropes(parts, dz, posts, [[0, 1], [1, 2], [3, 4], [4, 5], [0, 3], [2, 5]]);
    // the Giant Golden Bottle Cap on a plinth under the skylight (a soft landing… -ish)
    const bc = new THREE.Vector3((SKY_X[0] + SKY_X[1]) / 2, F, (SKY_Z[0] + SKY_Z[1]) / 2);
    parts.push({ g: new THREE.BoxGeometry(1.5, 0.9, 1.5), c: 0xf3ecdc, m: T(bc.x, F + 0.45, bc.z) });
    parts.push({ g: new THREE.CylinderGeometry(0.66, 0.66, 0.18, 21), c: GOLD, m: T(bc.x, F + 0.99, bc.z) });
    for (let k = 0; k < 21; k++) {
      const a = (k / 21) * Math.PI * 2;
      parts.push({ g: new THREE.BoxGeometry(0.08, 0.2, 0.1), c: 0xd9a52f, m: TR(bc.x + Math.cos(a) * 0.67, F + 0.99, bc.z + Math.sin(a) * 0.67, 0, -a, 0) });
    }
    this.col(bc.x, F + 0.54, bc.z, 1.5, 1.08, 1.5);
    // loot plinths in the lobby corners
    for (const [x, y, z] of LOOT) if (z > 1) this.plinth(parts, x, z, y - F);
    // alarm beacons (lobby, hallway, vault, outside over the door)
    const beacons: THREE.Vector3[] = [new THREE.Vector3(-9.6, F + 3.4, 6.0), new THREE.Vector3(9.6, F + 3.4, 2.0), new THREE.Vector3(0, F + 3.4, WALL_A_Z - 0.2), new THREE.Vector3(0, F + 3.4, -6.6), new THREE.Vector3(0, F + 3.25, HALF_D + 0.2)];
    const bp: Part[] = [];
    for (const b of beacons) bp.push({ g: new THREE.SphereGeometry(0.15, 12, 8), c: 0xffffff, m: T(b.x, b.y, b.z) });
    const bm = new THREE.Mesh(paintMesh(bp, false).geometry, this.beaconMat);
    this.root.add(bm);
    this.root.add(paintMesh(parts));
    // paintings + plaques
    const mona = this.intAtlas.add(256, 320, drawMona);
    const starry = this.intAtlas.add(256, 320, drawStarry);
    const pm = this.intAtlas.add(256, 110, plaque('MONA LISA OF TRASH', 'Artist unknown. Bag: Hefty-ish.', 'Her smile follows you.'));
    const ps = this.intAtlas.add(256, 110, plaque('THE STARRY NIGHT BIN', 'Oil on lid, 1889-ish.', 'Painted from a dumpster.'));
    const pd = this.intAtlas.add(256, 110, plaque('SODA-CAN-OSAURUS', '312 cans. 0 refunds.', 'Do not recycle the exhibit.'));
    const pb = this.intAtlas.add(256, 110, plaque('THE GIANT BOTTLE CAP', 'Twist-off. Allegedly.', 'Gift of a very large soda.'));
    const hang = (i: number, w: number, h: number, x: number, y: number, z: number, ry = 0) => {
      const q = this.intAtlas.quad(i, w, h);
      q.position.set(x, y, z);
      q.rotation.y = ry;
      this.root.add(q);
    };
    hang(mona, 1.3, 1.62, -1.2, F + 2.1, WALL_A_Z + 0.15);
    hang(pm, 0.8, 0.34, -1.2, F + 1.05, WALL_A_Z + 0.15);
    hang(starry, 1.3, 1.62, 5.6, F + 2.1, WALL_A_Z + 0.15);
    hang(ps, 0.8, 0.34, 5.6, F + 1.05, WALL_A_Z + 0.15);
    hang(pd, 0.8, 0.34, dz.x + 1.3, F + 0.4, dz.z + 0.86);
    hang(pb, 0.8, 0.34, bc.x, F + 0.5, bc.z + 0.77);
    const sec = this.intAtlas.add(256, 110, plaque('SECURITY', 'Please wake guard', 'for assistance.'));
    hang(sec, 0.9, 0.38, d.x, F + 0.6, d.z + 0.36);
  }

  /** Velvet ropes: brass posts (thin colliders) + sagging red ropes (no collision). */
  private ropes(parts: Part[], o: THREE.Vector3, posts: [number, number][], links: [number, number][]) {
    for (const [x, z] of posts) {
      parts.push({ g: new THREE.CylinderGeometry(0.035, 0.05, 0.9, 8), c: BRASS, m: T(o.x + x, F + 0.45, o.z + z) });
      parts.push({ g: new THREE.SphereGeometry(0.06, 8, 6), c: BRASS, m: T(o.x + x, F + 0.92, o.z + z) });
      parts.push({ g: new THREE.CylinderGeometry(0.16, 0.18, 0.04, 12), c: BRASS, m: T(o.x + x, F + 0.02, o.z + z) });
      this.colCyl(o.x + x, F, o.z + z, 0.05, 0.9);
    }
    for (const [i, j] of links) {
      const a = new THREE.Vector3(o.x + posts[i][0], F + 0.82, o.z + posts[i][1]);
      const b = new THREE.Vector3(o.x + posts[j][0], F + 0.82, o.z + posts[j][1]);
      const m = a.clone().lerp(b, 0.5);
      m.y -= 0.16;
      parts.push({ g: new THREE.CylinderGeometry(0.022, 0.022, 1, 6), c: VELVET, m: between(a, m) });
      parts.push({ g: new THREE.CylinderGeometry(0.022, 0.022, 1, 6), c: VELVET, m: between(m, b) });
    }
  }

  private plinth(parts: Part[], x: number, z: number, h: number) {
    parts.push({ g: new THREE.BoxGeometry(0.62, h, 0.62), c: 0xf3ecdc, m: T(x, F + h / 2, z) });
    parts.push({ g: new THREE.BoxGeometry(0.7, 0.05, 0.7), c: BRASS, m: T(x, F + h + 0.0, z) });
    parts.push({ g: new THREE.BoxGeometry(0.42, 0.05, 0.42), c: VELVET, m: T(x, F + h + 0.035, z) });
    this.col(x, F + h / 2, z, 0.62, h, 0.62);
  }

  private buildHall() {
    const sign = this.intAtlas.add(512, 200, hazardSign('LASER HALLWAY', 'Hop · Limbo · Wait · Dodge'));
    const q = this.intAtlas.quad(sign, 1.8, 0.7);
    q.position.set(-8.5 + 0.9 + 0.2, F + 3.0, WALL_A_Z - 0.14);
    q.rotation.y = Math.PI;
    this.root.add(q);
    const v = this.intAtlas.add(512, 200, hazardSign('VAULT', 'Authorized raccoons only'));
    const q2 = this.intAtlas.quad(v, 1.6, 0.62);
    q2.position.set((DOOR_B[0] + DOOR_B[1]) / 2, F + 3.0, WALL_B_Z + 0.14);
    this.root.add(q2);
  }

  private buildVault() {
    const parts: Part[] = [];
    const p = PEDESTAL;
    // pedestal: stepped marble column
    parts.push({ g: new THREE.BoxGeometry(1.3, 0.16, 1.3), c: 0xf3ecdc, m: T(p.x, F + 0.08, p.z) });
    parts.push({ g: new THREE.BoxGeometry(0.9, p.y - F - 0.22, 0.9), c: 0xeae2d0, m: T(p.x, F + 0.16 + (p.y - F - 0.22) / 2, p.z) });
    parts.push({ g: new THREE.BoxGeometry(1.1, 0.06, 1.1), c: GOLD, m: T(p.x, p.y - 0.03, p.z) });
    this.col(p.x, (F + p.y) / 2, p.z, 0.95, p.y - F, 0.95);
    // velvet ropes around the pedestal (a gap at the front, toward doorway B)
    const posts: [number, number][] = [[-1.6, -1.4], [0, -1.4], [1.6, -1.4], [-1.6, 1.4], [1.6, 1.4], [-1.6, 0], [1.6, 0]];
    this.ropes(parts, new THREE.Vector3(p.x, F, p.z), posts, [[0, 1], [1, 2], [0, 5], [5, 3], [2, 6], [6, 4]]);
    // loot plinths along the back wall
    for (const [x, y, z] of LOOT) if (z < -2) this.plinth(parts, x, z, y - F);
    const plq = this.intAtlas.add(512, 200, plaque('THE GOLDEN TRASH CAN LID', 'c. 1987. Solid-ish gold. Priceless.', 'DO NOT TOUCH. Pressure-sensitive pedestal.'));
    const q = this.intAtlas.quad(plq, 1.2, 0.47);
    q.position.set(p.x, F + 0.62, p.z + 0.47);
    this.root.add(q);
    this.root.add(paintMesh(parts));
    // a shaft of "spotlight" over the pedestal + halo on the floor
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.8, WALL_TOP - p.y, 20, 1, true), this.haloMat);
    cone.position.set(p.x, p.y + (WALL_TOP - p.y) / 2, p.z);
    cone.castShadow = false;
    this.root.add(cone);
  }

  get colliderCount() {
    return this.colliders;
  }
}
