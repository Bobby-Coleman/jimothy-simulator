import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from './Game';

export type EntityKind =
  | 'player'
  | 'prop'
  | 'item'
  | 'npc'
  | 'animal'
  | 'vehicle'
  | 'slop'
  | 'collectible'
  | 'static'
  | 'trigger';

/**
 * Well-known tags:
 *  grabbable  – can be picked up / dragged with Grabby Hands
 *  washable   – reacts to being washed (default: sparkles + points)
 *  trashcan / dumpster / food / shiny / fragile / explosive / climbable / sticky / npc / fish / cash
 */
export interface Entity {
  id: number;
  kind: EntityKind;
  /** Display name used in score popups, e.g. "Trash Can". */
  name: string;
  tags: Set<string>;
  object?: THREE.Object3D;
  body?: RAPIER.RigidBody;
  /** Approximate mass in kg (physics mass may differ). */
  mass: number;
  /** Arbitrary per-entity state. */
  data: Record<string, any>;
  alive: boolean;

  /** Called when Jimothy finishes washing this entity. */
  onWash?(game: Game): void;
  /** Called when bonked. Return true to suppress the default impulse. */
  onBonk?(game: Game, impulse: THREE.Vector3, point: THREE.Vector3): boolean | void;
  /** Called on significant physics impacts (force already normalised by mass ≈ Δv). */
  onImpact?(game: Game, other: Entity | undefined, strength: number): void;
  /** Return false to refuse a grab, or another Entity to grab that instead (e.g. stealing an NPC's phone). */
  onGrab?(game: Game): boolean | void | Entity;
  onRelease?(game: Game, thrown: boolean): void;
  /** Called every frame while registered, if present (use sparingly). */
  update?(game: Game, dt: number): void;
  dispose?(game: Game): void;
}

export class EntityRegistry {
  private nextId = 1;
  readonly list: Entity[] = [];
  private byCollider = new Map<number, Entity>();
  private handlesOf = new Map<number, number[]>();
  private updatables = new Set<Entity>();
  /** Game time, updated by Game each frame; stamped on new entities as data.bornAt (cleanup of runtime litter). */
  now = 0;
  /** Set once the world is live; entities created after this are "runtime spawned" (loot, spills, gifts...). */
  worldReady = false;

  create(init: Partial<Entity> & { kind: EntityKind; name: string }): Entity {
    const e: Entity = {
      id: this.nextId++,
      tags: new Set(),
      mass: 1,
      data: {},
      alive: true,
      ...init,
    } as Entity;
    if (init.tags instanceof Set) e.tags = init.tags;
    this.list.push(e);
    if (e.data.bornAt === undefined) e.data.bornAt = this.now;
    if (this.worldReady && e.data.runtime === undefined) e.data.runtime = true;
    if (e.update) this.updatables.add(e);
    if (e.body) this.bindBody(e.body, e);
    return e;
  }

  bindCollider(collider: RAPIER.Collider, e: Entity) {
    this.byCollider.set(collider.handle, e);
    let hs = this.handlesOf.get(e.id);
    if (!hs) this.handlesOf.set(e.id, (hs = []));
    if (!hs.includes(collider.handle)) hs.push(collider.handle);
  }

  bindBody(body: RAPIER.RigidBody, e: Entity) {
    e.body = body;
    for (let i = 0; i < body.numColliders(); i++) this.bindCollider(body.collider(i), e);
  }

  unbindCollider(collider: RAPIER.Collider) {
    const e = this.byCollider.get(collider.handle);
    this.byCollider.delete(collider.handle);
    if (e) {
      const hs = this.handlesOf.get(e.id);
      if (hs) this.handlesOf.set(e.id, hs.filter((h) => h !== collider.handle));
    }
  }

  fromCollider(c: RAPIER.Collider | number | null | undefined): Entity | undefined {
    if (c == null) return undefined;
    return this.byCollider.get(typeof c === 'number' ? c : c.handle);
  }

  setUpdatable(e: Entity, on: boolean) {
    if (on) this.updatables.add(e);
    else this.updatables.delete(e);
  }

  update(game: Game, dt: number) {
    for (const e of this.updatables) {
      if (!e.alive) continue;
      try {
        e.update?.(game, dt);
      } catch (err) {
        console.error('[entities] update failed for', e.name, err);
        this.updatables.delete(e);
      }
    }
  }

  withTag(tag: string): Entity[] {
    return this.list.filter((e) => e.alive && e.tags.has(tag));
  }

  ofKind(kind: EntityKind): Entity[] {
    return this.list.filter((e) => e.alive && e.kind === kind);
  }

  remove(e: Entity) {
    e.alive = false;
    this.updatables.delete(e);
    // Never touch e.body here: it may already have been removed from the physics world.
    for (const h of this.handlesOf.get(e.id) ?? []) if (this.byCollider.get(h) === e) this.byCollider.delete(h);
    this.handlesOf.delete(e.id);
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
  }
}
