import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import type { World } from '../../world/World';
import type { WaterSystem } from '../../world/Water';

/** Game-time scheduled callbacks (pause with the game, work with g.advance()). */
export class Timeline {
  private timers: { at: number; fn: () => void }[] = [];
  constructor(private game: Game) {}
  later(secs: number, fn: () => void) {
    this.timers.push({ at: this.game.time + secs, fn });
  }
  run() {
    if (!this.timers.length) return;
    const now = this.game.time;
    const due = this.timers.filter((t) => t.at <= now);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.at > now);
    for (const t of due) {
      try {
        t.fn();
      } catch (err) {
        console.error('[slop] timer failed', err);
      }
    }
  }
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
export const clamp = THREE.MathUtils.clamp;

/** Speech bubble over an entity (rendered by the UI if it listens to 'speech'). */
export function say(game: Game, entity: Entity | undefined, text: string, duration = 3.2) {
  if (!entity || !entity.alive) return;
  game.events.emit('speech', { entity, text, duration });
}

/** Big announcement banner. */
export function toast(game: Game, title: string, text?: string, icon = 'slop') {
  game.events.emit('toast', { title, text, icon });
}

export function worldOf(game: Game) {
  return game.get<World>('world');
}

export function waterOf(game: Game) {
  return game.get<WaterSystem>('water');
}

export function terrainY(game: Game, x: number, z: number) {
  return worldOf(game)?.heightAt(x, z) ?? 0;
}

const _down = new THREE.Vector3(0, -1, 0);

/** Top surface (static world only) under (x, z), searching down from `fromY`. */
export function surfaceY(game: Game, x: number, z: number, fromY?: number): number {
  const ty = terrainY(game, x, z);
  const top = fromY ?? ty + 60;
  const hit = game.physics.raycast(new THREE.Vector3(x, top, z), _down, top - ty + 2, groups(G.ALL, G.WORLD));
  return hit ? hit.point.y : ty;
}

/** A named POI from the level builders, or a fallback (y snapped to the terrain). */
export function poi(game: Game, name: string, fx: number, fz: number): { pos: THREE.Vector3; found: boolean } {
  const p = worldOf(game)?.poi.get(name);
  if (p) return { pos: p.clone(), found: true };
  return { pos: new THREE.Vector3(fx, terrainY(game, fx, fz), fz), found: false };
}

/** True if a box (full size) standing on `ground` is free of world / props / vehicles. */
export function isClear(game: Game, ground: THREE.Vector3, halfX: number, halfZ: number, height: number, rotY = 0): boolean {
  let blocked = false;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
  // Bottom lifted 0.5 m so gently sloped terrain / curbs under the box don't count.
  game.physics.world.intersectionsWithShape(
    { x: ground.x, y: ground.y + height / 2 + 0.5, z: ground.z },
    { x: q.x, y: q.y, z: q.z, w: q.w },
    new RAPIER.Cuboid(halfX, height / 2, halfZ),
    () => {
      blocked = true;
      return false;
    },
    undefined,
    groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE),
  );
  return !blocked;
}

/** Is there water at / near this ground point? */
export function wetAt(game: Game, p: THREE.Vector3, r = 0.6) {
  return !!waterOf(game)?.nearWater(p, r);
}

/**
 * Random clear spot on open ground (not a roof, not water) in a ring around `center`.
 * Returns the ground point or null.
 */
export function findClearSpot(
  game: Game,
  center: THREE.Vector3,
  rMin: number,
  rMax: number,
  halfX: number,
  halfZ: number,
  height: number,
  tries = 40,
  avoid: THREE.Vector3[] = [],
  avoidR = 0,
): THREE.Vector3 | null {
  for (let i = 0; i < tries; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(rMin, rMax);
    const x = center.x + Math.cos(a) * r;
    const z = center.z + Math.sin(a) * r;
    if (Math.abs(x) > 172 || z < -172 || z > 150) continue;
    const ty = terrainY(game, x, z);
    const sy = surfaceY(game, x, z);
    if (Math.abs(sy - ty) > 0.35) continue; // roof / platform / inside a building
    const g = new THREE.Vector3(x, sy, z);
    if (avoid.some((v) => v.distanceTo(g) < avoidR)) continue;
    if (wetAt(game, g, Math.max(halfX, halfZ) + 1)) continue;
    // flat enough?
    const d = Math.max(halfX, halfZ);
    const hs = [terrainY(game, x + d, z), terrainY(game, x - d, z), terrainY(game, x, z + d), terrainY(game, x, z - d)];
    if (Math.max(...hs) - Math.min(...hs) > 1.2) continue;
    if (!isClear(game, g, halfX, halfZ, height)) continue;
    return g;
  }
  return null;
}

/** Canvas texture helper (sRGB, mipmapped). */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Mark objects we own so scene scans (e.g. data-center light dimming) skip them. */
export function markOwned(o: THREE.Object3D) {
  o.traverse((c) => (c.userData.slopOwned = true));
  return o;
}

/** Find NPC entities (optionally of a type) near a point. Works with whatever the NPC system exposes. */
export function findNpcs(game: Game, near?: THREE.Vector3, radius = Infinity, type?: string): Entity[] {
  const out: Entity[] = [];
  const r2 = radius * radius;
  for (const e of game.entities.list) {
    if (!e.alive || e.kind !== 'npc' || !e.body) continue;
    if (type && !npcIsType(e, type)) continue;
    if (near) {
      const t = e.body.translation();
      const dx = t.x - near.x;
      const dy = t.y - near.y;
      const dz = t.z - near.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
    }
    out.push(e);
  }
  return out;
}

export function npcIsType(e: Entity, type: string) {
  const d = e.data ?? {};
  const t = String(d.type ?? d.npcType ?? d.role ?? d.kind ?? '').toLowerCase();
  if (t === type.toLowerCase()) return true;
  if (e.tags.has(type)) return true;
  return false;
}

export function entityPos(e: Entity, out = new THREE.Vector3()) {
  if (e.body) {
    const t = e.body.translation();
    return out.set(t.x, t.y, t.z);
  }
  if (e.object) return e.object.getWorldPosition(out);
  return out.set(0, 0, 0);
}

/** Draw text that auto-shrinks to fit a width. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string) {
  let s = size;
  ctx.font = `${font.replace('{s}', String(s))}`;
  while (ctx.measureText(text).width > maxW && s > 8) {
    s -= 2;
    ctx.font = `${font.replace('{s}', String(s))}`;
  }
  ctx.fillText(text, x, y);
  return s;
}
