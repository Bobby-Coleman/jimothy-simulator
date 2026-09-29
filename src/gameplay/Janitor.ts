import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import type { Entity } from '../core/Entities';
import { destroyProp } from '../entities/Props';

/**
 * Seattle Public Utilities, raccoon division. Long sessions spawn a lot of loose stuff at runtime (dumpster loot,
 * spilled trash, crow gifts, diplomas, fireworks debris…). Once there are more than `cap` runtime-spawned loose
 * props/items, quietly remove the oldest ones that are far from Jimothy, out of view, untouched and unimportant.
 */
const KEEP_TAGS = ['teddy', 'rookiecard', 'quest', 'keep', 'diplomaQuest', 'collectible'];
const _v = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();

export class Janitor implements System {
  name = 'janitor';
  cap = 110;
  private t = 0;
  removed = 0;

  lateUpdate(dt: number, game: Game) {
    if (!game.entities.worldReady && game.state === 'playing') game.entities.worldReady = true;
    if (game.state !== 'playing') return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 5;
    const p = game.get<any>('player');
    if (!p) return;
    const loose: Entity[] = [];
    for (const e of game.entities.list) {
      if (!e.alive || !e.data.runtime || !e.body || !e.object) continue;
      if (e.kind !== 'prop' && e.kind !== 'item') continue;
      loose.push(e);
    }
    if (loose.length <= this.cap) return;
    // Candidates: oldest first, far away, not held/dragged, not important, not on screen
    _m.multiplyMatrices(game.camera.projectionMatrix, game.camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_m);
    const now = game.time;
    const candidates = loose
      .filter((e) => {
        if (e.data.heldByPlayer || e.data.draggedByPlayer || e.data.heldBy || e.data.npcHeld) return false;
        if (!e.body!.isDynamic()) return false; // held by an NPC / animated / scripted
        if (KEEP_TAGS.some((t) => e.tags.has(t))) return false;
        if (now - (e.data.bornAt ?? 0) < 45) return false;
        const t = e.body!.translation();
        _v.set(t.x, t.y, t.z);
        if (_v.distanceTo(p.position) < 35) return false;
        if (_frustum.containsPoint(_v) && _v.distanceTo(game.camera.position) < 90) return false;
        return true;
      })
      .sort((a, b) => (a.data.bornAt ?? 0) - (b.data.bornAt ?? 0));
    let excess = loose.length - this.cap;
    for (const e of candidates) {
      if (excess <= 0) break;
      try {
        destroyProp(game, e);
        this.removed++;
        excess--;
      } catch (err) {
        console.warn('[janitor] failed to remove', e.name, err);
      }
    }
  }
}
