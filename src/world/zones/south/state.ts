import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';

/**
 * Runtime state shared between the south/west zone builders (which fill it while the world builds)
 * and SouthSystem (which animates it every frame). Keyed per Game so a fresh game gets fresh state.
 */

export interface Glow {
  mat: THREE.Material & { emissiveIntensity?: number; opacity: number };
  day: number;
  night: number;
  /** Which property to drive (default emissiveIntensity). */
  prop?: 'emissiveIntensity' | 'opacity';
}

/** Gentle up/down + roll bobbing for floating decor (boats, ducks, buoys). */
export interface Bobber {
  obj: THREE.Object3D;
  baseY: number;
  amp: number;
  speed: number;
  phase: number;
  roll: number;
  baseRotX: number;
  baseRotZ: number;
}

/** Things that swing/sway around a local axis (swings, kites, flags). */
export interface Swayer {
  obj: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  amp: number;
  speed: number;
  phase: number;
  base: number;
}

export interface Spinner {
  obj: THREE.Object3D;
  axis: 'x' | 'y' | 'z';
  speed: number;
}

/** An instanced flock of decorative birds moving on simple parametric paths. */
export interface Flock {
  mesh: THREE.InstancedMesh;
  /** Per-bird path function: writes position + heading into out; t = game time. */
  path: (i: number, t: number, out: THREE.Vector3) => number;
  count: number;
  /** Optional per-bird flap (wing mesh scale) — handled by a second instanced mesh. */
  wings?: THREE.InstancedMesh;
  flap?: number;
  /** Only animate when the player is within this distance of `center`. */
  center: THREE.Vector3;
  range: number;
}

export interface LadderPool {
  center: THREE.Vector3; // water surface center
  halfX: number;
  halfZ: number;
  floorY: number;
}

export interface GumWall {
  /** Wall face plane: x = faceX, facing +x (normal +1) or -x (normal -1). */
  faceX: number;
  normal: 1 | -1;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface SouthState {
  glows: Glow[];
  bobbers: Bobber[];
  swayers: Swayer[];
  spinners: Spinner[];
  flocks: Flock[];
  ladder: { pools: LadderPool[]; salmon: Entity[]; lastLeap: number; spawnAt: THREE.Vector3 | null };
  gumWall: GumWall | null;
  /** Bobblehead statue head (wobbles). */
  wobblers: { obj: THREE.Object3D; amp: number; speed: number }[];
  /** Ambient sound emitters (seagulls, crows, crowd) — played occasionally when the player is near. */
  ambience: { pos: THREE.Vector3; key: string; radius: number; every: number; next: number; volume: number }[];
}

const states = new WeakMap<Game, SouthState>();

export function southState(game: Game): SouthState {
  let s = states.get(game);
  if (!s) {
    s = {
      glows: [],
      bobbers: [],
      swayers: [],
      spinners: [],
      flocks: [],
      ladder: { pools: [], salmon: [], lastLeap: 0, spawnAt: null },
      gumWall: null,
      wobblers: [],
      ambience: [],
    };
    states.set(game, s);
  }
  return s;
}
