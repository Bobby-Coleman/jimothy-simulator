import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { Game } from '../../core/Game';
import { RAPIER, G, groups } from '../../core/Physics';
import { surfaceAt, groundY, uiOf, playerOf, fx } from '../extras/shared';

/**
 * Small shared toolbox for the chaos toys (hydrants, car alarms, espresso, tour group). Re-exports the generic helpers
 * from the extras toolbox (math, merged vertex-coloured meshes, UI/FX accessors) and adds a few world queries.
 */
export {
  clamp, lerp, rand, pick, damp, dampAngle, wrapAngle, paintMesh, paintMat, bulbMat, safeColor, T, TR,
  surfaceAt, groundY, poi, uiOf, playerOf, rigOf, fx, toast, celebrate, prompt, speech, sceneBusy,
  roundRect, fitText, FONT_DISPLAY, FONT_BOLD, FONT_BODY, type Part,
} from '../extras/shared';

/** One chaos toy. Every hook is guarded by the ChaosSystem (a failing toy logs and the rest keep running). */
export interface ChaosFeature {
  readonly id: string;
  init?(): void | Promise<void>;
  update?(dt: number): void;
  postPhysics?(dt: number): void;
  lateUpdate?(dt: number): void;
}

export const UP = new THREE.Vector3(0, 1, 0);

/** Static-world collider scan (fixed colliders without a parent body): cuboids only. */
export function scanStaticCuboids(
  game: Game,
  match: (half: { x: number; y: number; z: number }, center: { x: number; y: number; z: number }) => boolean,
): { center: THREE.Vector3; half: THREE.Vector3; yaw: number; handle: number }[] {
  const out: { center: THREE.Vector3; half: THREE.Vector3; yaw: number; handle: number }[] = [];
  try {
    game.physics.world.forEachCollider((c: RAPIER_T.Collider) => {
      if (c.parent()) return;
      const sh: any = c.shape;
      const h = sh?.halfExtents;
      if (!h || sh.heights) return;
      const t = c.translation();
      if (!match(h, t)) return;
      const r = c.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
      out.push({ center: new THREE.Vector3(t.x, t.y, t.z), half: new THREE.Vector3(h.x, h.y, h.z), yaw, handle: c.handle });
    });
  } catch (err) {
    console.warn('[chaos] collider scan failed', err);
  }
  return out;
}

const _q = new THREE.Quaternion();

/**
 * Colliders overlapping an oriented box (yaw only). Never mutate bodies inside the callback — this collects first.
 * `filter` = Rapier interaction groups.
 */
export function overlapBox(game: Game, center: THREE.Vector3, half: THREE.Vector3, yaw: number, filter: number): RAPIER_T.Collider[] {
  const out: RAPIER_T.Collider[] = [];
  _q.setFromAxisAngle(UP, yaw);
  game.physics.world.intersectionsWithShape(
    { x: center.x, y: center.y, z: center.z },
    { x: _q.x, y: _q.y, z: _q.z, w: _q.w },
    new RAPIER.Cuboid(half.x, half.y, half.z),
    (c) => {
      out.push(c);
      return true;
    },
    undefined,
    filter,
  );
  return out;
}

/** True if a box footprint (half extents, yaw) standing on `pos` is free of world geometry / props. */
export function footprintClear(game: Game, pos: THREE.Vector3, half: THREE.Vector3, yaw = 0): boolean {
  const c = new THREE.Vector3(pos.x, pos.y + half.y + 0.12, pos.z);
  return overlapBox(game, c, half, yaw, groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE)).length === 0;
}

/**
 * Find a flat, clear spot near `center` for a footprint (tries rings of candidates). Returns the ground point or null.
 * `avoidRoad` rejects points the NPC system considers road.
 */
export function findClearSpot(
  game: Game,
  center: THREE.Vector3,
  half: THREE.Vector3,
  yaw = 0,
  opts: { maxR?: number; step?: number; avoidRoad?: boolean; fromY?: number } = {},
): THREE.Vector3 | null {
  const maxR = opts.maxR ?? 8;
  const step = opts.step ?? 1;
  const npcs = game.get<any>('npcs');
  for (let r = 0; r <= maxR; r += step) {
    const n = r === 0 ? 1 : Math.max(6, Math.round((Math.PI * 2 * r) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      if (opts.avoidRoad && npcs?.onRoad?.(x, z, 4.6)) continue;
      const from = opts.fromY ?? center.y + 4;
      const y = surfaceAt(game, x, z, from, 10);
      if (y == null || Math.abs(y - center.y) > 1.2) continue;
      // flat enough under the corners?
      let flat = true;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const cx = x + (dx * half.x * Math.cos(yaw) + dz * half.z * Math.sin(yaw)) * 0.9;
        const cz = z + (-dx * half.x * Math.sin(yaw) + dz * half.z * Math.cos(yaw)) * 0.9;
        const cy = surfaceAt(game, cx, cz, y + 1.5, 3);
        if (cy == null || Math.abs(cy - y) > 0.12) {
          flat = false;
          break;
        }
      }
      if (!flat) continue;
      const p = new THREE.Vector3(x, y, z);
      if (footprintClear(game, p, half, yaw)) return p;
    }
  }
  return null;
}

/** Game-time timers (paused with the game). */
export class Timers {
  private list: { at: number; fn: () => void }[] = [];
  constructor(private game: Game) {}
  after(secs: number, fn: () => void) {
    this.list.push({ at: this.game.time + secs, fn });
  }
  tick() {
    const t = this.game.time;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      if (it.at > t) continue;
      this.list.splice(i, 1);
      try {
        it.fn();
      } catch (err) {
        console.warn('[chaos] timer failed', err);
      }
    }
  }
}

/** Add objective progress (no-op if the objectives system or the objective is missing). */
export function objProgress(game: Game, id: string, amount = 1) {
  try {
    game.get<any>('objectives')?.progress?.(id, amount);
  } catch {
    /* optional */
  }
}

export function objSet(game: Game, id: string, value: number) {
  try {
    game.get<any>('objectives')?.set?.(id, value);
  } catch {
    /* optional */
  }
}

/** Register an objective (safe if the system is missing). */
export function addObjective(game: Game, def: Record<string, any>) {
  try {
    game.get<any>('objectives')?.add?.(def);
  } catch (err) {
    console.warn('[chaos] objective add failed', err);
  }
}

/** Is the player free for chaos (not frozen, not in a cannon / wheel / finale)? */
export function playerFree(game: Game): boolean {
  const p = playerOf(game);
  if (!p || p.frozen) return false;
  const busy = game.get<any>('extras')?.busy;
  return !busy;
}

/** Camera-distance check (skip work far away). */
export function nearCamera(game: Game, p: THREE.Vector3, r: number) {
  return p.distanceToSquared(game.camera.position) < r * r;
}

/** HUD should show (play mode, HUD enabled, no photo mode). */
export function hudShown(game: Game): boolean {
  const ui = uiOf(game);
  if (!ui) return game.state === 'playing';
  if (ui.mode !== 'play' || ui.hudVisible === false) return false;
  if (ui.settings && ui.settings.showHud === false) return false;
  if (game.get<any>('photomode')?.active) return false;
  return true;
}

/** Ground under a point, preferring the static surface. */
export function floorY(game: Game, x: number, z: number, fromY: number) {
  return groundY(game, x, z, fromY);
}

export { fx as fxEmit };
