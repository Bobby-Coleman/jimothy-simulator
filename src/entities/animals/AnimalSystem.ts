import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { Animal, Species } from './Animal';
import { HeartBurst } from './Emote';

/** True if some system subscribed to `name` (lets us fall back to our own FX when nobody listens). */
export function hasListener(game: Game, name: string): boolean {
  const map = (game.events as any)?.map as Map<string, Set<unknown>> | undefined;
  return !!map?.get?.(name)?.size;
}

/**
 * Owns every gameplay animal: ticks behaviour before physics and syncs visuals after it.
 * Quests spawn animals with `game.get<AnimalSystem>('animals').add(new Kit(...))`.
 */
export class AnimalSystem implements System {
  name = 'animals';
  readonly list: Animal[] = [];
  private game!: Game;
  private heartFx: HeartBurst | null = null;

  init(game: Game) {
    this.game = game;
    this.heartFx = new HeartBurst(game.scene);
  }

  add<T extends Animal>(a: T): T {
    this.list.push(a);
    return a;
  }

  remove(a: Animal) {
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
    a.dispose();
  }

  ofSpecies(s: Species) {
    return this.list.filter((a) => a.species === s && a.alive);
  }

  nearest(p: THREE.Vector3, filter?: (a: Animal) => boolean): Animal | null {
    let best: Animal | null = null;
    let bd = Infinity;
    for (const a of this.list) {
      if (!a.alive || (filter && !filter(a))) continue;
      const d = a.pos.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /** Floating hearts: emits the FX event, and draws our own if no FX system is listening. */
  hearts(position: THREE.Vector3, count = 5) {
    const p = position.clone();
    this.game.events.emit('hearts', { position: p, count });
    if (!hasListener(this.game, 'hearts')) this.heartFx?.spawn(p, count);
  }

  /** Animals farther than this from Jimothy (and not busy) are frozen: no behaviour, no animation. */
  freezeDist = 85;
  private frozen = new Set<Animal>();

  update(dt: number) {
    const p = this.game.get<any>('player')?.position as THREE.Vector3 | undefined;
    const fd2 = this.freezeDist * this.freezeDist;
    for (const a of this.list) {
      if (p && !a.keepAwake && a.pos.distanceToSquared(p) > fd2) {
        this.frozen.add(a);
        continue;
      }
      this.frozen.delete(a);
      try {
        a.update(dt);
      } catch (err) {
        console.error('[animals] update failed for', a.name, err);
      }
    }
  }

  /** Is this animal currently frozen by distance? */
  isFrozen(a: Animal) {
    return this.frozen.has(a);
  }

  postPhysics(dt: number) {
    for (const a of this.list) {
      if (!a.alive || this.frozen.has(a)) continue;
      try {
        a.sync(dt);
      } catch (err) {
        console.error('[animals] sync failed for', a.name, err);
      }
    }
    this.heartFx?.update(dt);
  }
}
