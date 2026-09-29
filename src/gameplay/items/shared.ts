import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import type { FxSystem } from '../../fx/FX';
import { G, groups } from '../../core/Physics';

/**
 * Module-level state shared by the item helpers and the 'items' / 'impacts' systems.
 * Spawn helpers can run before those systems initialise (zone builders run inside World.init),
 * so everything they need lives here rather than on a system instance.
 */
export const registry = {
  trashCans: new Set<Entity>(),
  dumpsters: new Set<Entity>(),
  slippery: new Set<Entity>(),
  /** Washed "extra shiny" things that twinkle now and then. */
  shiny: new Set<Entity>(),
};

interface Timer {
  at: number;
  fn: () => void;
}
const timers: Timer[] = [];

/** Run `fn` after `delay` seconds of game time (processed by the 'items' system). */
export function after(game: Game, delay: number, fn: () => void) {
  timers.push({ at: game.time + delay, fn });
}

export function runTimers(game: Game) {
  if (!timers.length) return;
  const now = game.time;
  const due: Timer[] = [];
  for (let i = timers.length - 1; i >= 0; i--) {
    if (timers[i].at <= now) {
      due.push(timers[i]);
      timers.splice(i, 1);
    }
  }
  due.sort((a, b) => a.at - b.at);
  for (const t of due) {
    try {
      t.fn();
    } catch (err) {
      console.error('[items] timer failed', err);
    }
  }
}

/** Player emote override (applied by the 'items' system after the model animates). */
export const emoteState: { kind: 'stare' | null; t0: number; until: number; froze: boolean } = {
  kind: null,
  t0: 0,
  until: 0,
  froze: false,
};

export function fxOf(game: Game): FxSystem | undefined {
  return game.get<FxSystem>('fx');
}

export function playerOf(game: Game): any {
  return game.get<any>('player');
}

/** World-space centre of an entity (body if alive, else its object). */
export function entityPos(e: Entity, out = new THREE.Vector3()): THREE.Vector3 | null {
  if (e.alive && e.body) {
    try {
      const t = e.body.translation();
      return out.set(t.x, t.y, t.z);
    } catch {
      /* body gone */
    }
  }
  if (e.object) return e.object.getWorldPosition(out);
  return null;
}

/**
 * Something meaningful touched this entity (player bonk/grab/throw/contact, thrown prop, NPC, car,
 * animal, explosion). Trash-can tips only score when the can was disturbed recently — so cans that
 * merely settle at startup don't hand out free "Trash Panda!" points.
 */
export function markDisturbed(game: Game, e: Entity | undefined, byPlayer: boolean) {
  if (!e || !e.alive) return;
  e.data.disturbedAt = game.time;
  if (byPlayer) e.data.disturbedByPlayer = true;
}

/** Surface height at (x, z) just below `y + up` (world geometry; flat-ish hits only), else `y`. */
export function surfaceY(game: Game, x: number, y: number, z: number, radius = 0, up = 1.5): number {
  const pts = radius > 0 ? [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]] : [[0, 0]];
  let best = -Infinity;
  for (const [dx, dz] of pts) {
    const hit = game.physics.raycast(new THREE.Vector3(x + dx, y + up, z + dz), new THREE.Vector3(0, -1, 0), up + 2, WORLD_ONLY);
    if (hit && hit.distance > 0.02 && hit.normal.y > 0.6) best = Math.max(best, hit.point.y);
  }
  return best > -Infinity ? best : y;
}
const WORLD_ONLY = groups(G.ALL, G.WORLD);

/** Is the player currently carrying/dragging this entity? */
export function heldByPlayer(game: Game, e: Entity) {
  return playerOf(game)?.held?.entity === e;
}

/** Release the entity if Jimothy is holding it (before destroying it, etc.). */
export function releaseIfHeld(game: Game, e: Entity) {
  const p = playerOf(game);
  if (p?.held?.entity === e) p.release(false);
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Weighted random pick from [value, weight] pairs. */
export function weighted<T>(table: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = Math.random() * total;
  for (const [v, w] of table) {
    r -= w;
    if (r <= 0) return v;
  }
  return table[table.length - 1][0];
}
