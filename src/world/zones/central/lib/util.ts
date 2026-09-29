import * as THREE from 'three';
import type { Game, System } from '../../../../core/Game';
import { RAPIER, G, groups } from '../../../../core/Physics';

/** Small deterministic PRNG so the level layout is identical on every load. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    // mulberry32
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  chance(p: number) {
    return this.next() < p;
  }
}

type FrameFn = (game: Game, dt: number, night: number) => void;

/**
 * One tiny system that runs registered per-frame callbacks (night glow, traffic lights, flags…).
 * Uses lateUpdate so it also runs while paused / on the title screen.
 */
class CentralFx implements System {
  name = 'central-fx';
  readonly fns: FrameFn[] = [];
  lateUpdate(dt: number, game: Game) {
    const env = game.get<any>('environment');
    const night = typeof env?.nightFactor === 'number' ? env.nightFactor : 0;
    for (const fn of this.fns) {
      try {
        fn(game, dt, night);
      } catch (err) {
        console.error('[central-fx]', err);
      }
    }
  }
}

export function onFrame(game: Game, fn: FrameFn) {
  let fx = game.get<CentralFx>('central-fx');
  if (!fx) fx = game.add(new CentralFx());
  fx.fns.push(fn);
  // apply once immediately so the first rendered frame is right
  const env = game.get<any>('environment');
  fn(game, 0, typeof env?.nightFactor === 'number' ? env.nightFactor : 0);
}

/** Emissive "glows at night" material helper: intensity = day + night * k. */
export function glowAtNight(game: Game, mat: THREE.MeshStandardMaterial, day: number, night: number) {
  onFrame(game, (_g, _dt, n) => {
    mat.emissiveIntensity = day + (night - day) * n;
  });
  return mat;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Static oriented box collider with full rotation (world.collider only supports yaw). */
export function boxColliderEuler(game: Game, center: THREE.Vector3, size: THREE.Vector3, rx = 0, ry = 0, rz = 0, friction = 0.8) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return game.physics.staticBox(center, size.clone().multiplyScalar(0.5), _q, friction);
}

/** Static cylinder collider (vertical axis). */
export function cylinderCollider(game: Game, center: THREE.Vector3, radius: number, height: number, friction = 0.8) {
  const cd = RAPIER.ColliderDesc.cylinder(height / 2, radius)
    .setTranslation(center.x, center.y, center.z)
    .setFriction(friction)
    .setCollisionGroups(groups(G.WORLD));
  return game.physics.staticCollider(cd);
}

/** Trimesh collider from world-space geometry (positions already in world space). */
export function trimeshFromGeometry(game: Game, geo: THREE.BufferGeometry, friction = 0.85) {
  const pos = geo.getAttribute('position');
  const verts = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    verts[i * 3] = pos.getX(i);
    verts[i * 3 + 1] = pos.getY(i);
    verts[i * 3 + 2] = pos.getZ(i);
  }
  let idx: Uint32Array;
  if (geo.index) idx = new Uint32Array(geo.index.array as ArrayLike<number>);
  else {
    idx = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) idx[i] = i;
  }
  const flags = (RAPIER as any).TriMeshFlags?.FIX_INTERNAL_EDGES;
  let cd: RAPIER.ColliderDesc | null = null;
  try {
    cd = flags != null ? RAPIER.ColliderDesc.trimesh(verts, idx, flags) : RAPIER.ColliderDesc.trimesh(verts, idx);
  } catch {
    cd = null;
  }
  if (!cd) cd = RAPIER.ColliderDesc.trimesh(verts, idx);
  cd.setFriction(friction).setCollisionGroups(groups(G.WORLD));
  return game.physics.staticCollider(cd);
}

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Rotate (x, z) by yaw around the origin (three.js Y rotation). */
export function rotXZ(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, -x * s + z * c];
}

/** Matrix for a local frame at (x, y, z) rotated by yaw. */
export function frame(x: number, y: number, z: number, yaw = 0, scale = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(scale, scale, scale),
  );
}
