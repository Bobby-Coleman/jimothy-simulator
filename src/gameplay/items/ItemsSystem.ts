import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { G, groups } from '../../core/Physics';
import { registry, runTimers, emoteState, playerOf, fxOf, rand } from './shared';
import { checkTrashCan, updateDumpster, dumpsterDive, spawnTrashCan, spawnDumpster } from './Trash';
import { spawnItem, resolveItemKind, ITEM_KINDS } from './Items';
import { explode } from './Impacts';

const NPC_FILTER = groups(G.ALL, G.NPC | G.ANIMAL | G.RAGDOLL);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * 'items' system: runs item timers, trash-can tipping, dumpster lids & dives, banana-peel slips,
 * twinkles on extra-shiny things, and Jimothy's "stares at empty hands" emote.
 *
 * Emits: trashTipped {entity}, dumpsterDive {entity}, dumpsterOpen {entity},
 *        slip {entity, peel, impulse, player?}  (NPC/animal systems: ragdoll on 'slip' if you like —
 *        we also call entity.ragdoll()/data.ragdoll() if present, else onBonk, else apply the impulse).
 */
export class ItemsSystem implements System {
  name = 'items';
  private game!: Game;
  private scanT = 0;
  private glintT = 0;
  private frame = 0;

  init(game: Game) {
    this.game = game;
    this.scan();
    // Landing on top of a plain (non-hollow) dumpster prop counts as a dive.
    game.events.on('land', (p) => {
      const pl = playerOf(game);
      const e: Entity | undefined = pl?.groundEntity;
      if (e?.alive && e.tags.has('dumpster') && !e.data.hollow && (p?.height ?? 0) > 0.6) dumpsterDive(game, e);
    });
  }

  /**
   * Spawn an item by (lenient) kind name at a bottom position; undefined if the kind is unknown.
   * Same as spawnItem() from src/gameplay/items, for code that only has the system handle.
   */
  spawn(kind: string, bottomPos: THREE.Vector3, rotY = 0): Entity | undefined {
    if (!resolveItemKind(kind)) return undefined;
    return spawnItem(this.game, kind, bottomPos, rotY);
  }

  /** Console/test conveniences (same as the module functions). */
  spawnTrashCan(bottomPos: THREE.Vector3, rotY = 0) {
    return spawnTrashCan(this.game, bottomPos, rotY);
  }
  spawnDumpster(bottomPos: THREE.Vector3, rotY = 0) {
    return spawnDumpster(this.game, bottomPos, rotY);
  }
  explode(pos: THREE.Vector3, opts: Parameters<typeof explode>[2] = {}) {
    explode(this.game, pos, opts);
  }
  get kinds() {
    return ITEM_KINDS;
  }

  /** Pick up tagged props spawned by other builders. */
  private scan() {
    const ents = this.game.entities;
    for (const e of ents.withTag('trashcan')) registry.trashCans.add(e);
    for (const e of ents.withTag('slippery')) registry.slippery.add(e);
    for (const e of ents.withTag('dumpster')) if (e.data.dumpster) registry.dumpsters.add(e);
    for (const set of Object.values(registry)) for (const e of set) if (!e.alive) set.delete(e);
  }

  update(dt: number) {
    const game = this.game;
    this.frame++;
    runTimers(game);
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 2;
      this.scan();
    }
    for (const e of registry.trashCans) {
      if (!e.alive) registry.trashCans.delete(e);
      else checkTrashCan(game, e);
    }
    for (const e of registry.dumpsters) {
      if (!e.alive) registry.dumpsters.delete(e);
      else updateDumpster(game, e, dt);
    }
    this.updateSlippery();
    this.updateGlints(dt);
  }

  // ------------------------------------------------------------------ banana peels
  private updateSlippery() {
    const game = this.game;
    const pl = playerOf(game);
    for (const peel of registry.slippery) {
      if (!peel.alive || !peel.body) {
        registry.slippery.delete(peel);
        continue;
      }
      if (peel.data.heldByPlayer || game.time < (peel.data.slipCooldown ?? 0)) continue;
      const t = peel.body.translation();
      if (pl && pl.mode === 'walk' && pl.grounded && pl.speed > 2.2) {
        const dx = pl.position.x - t.x;
        const dz = pl.position.z - t.z;
        const dy = pl.position.y - t.y;
        if (dx * dx + dz * dz < 0.42 * 0.42 && dy > -0.15 && dy < 0.75) {
          this.slipPlayer(peel, pl);
          continue;
        }
      }
      if ((this.frame + peel.id) % 3 !== 0) continue;
      const cols = game.physics.overlapSphere(_v.set(t.x, t.y + 0.3, t.z), 0.32, NPC_FILTER);
      for (const c of cols) {
        const e = game.entities.fromCollider(c);
        if (!e || !e.alive || e === peel || (e.kind !== 'npc' && e.kind !== 'animal')) continue;
        if (game.time < (e.data.slipCooldown ?? 0)) continue;
        const v = c.parent()?.linvel();
        if (!v || Math.hypot(v.x, v.z) < 0.6) continue;
        this.slipOther(peel, e, new THREE.Vector3(v.x, 0, v.z));
        break;
      }
    }
  }

  private slipPlayer(peel: Entity, pl: any) {
    const game = this.game;
    const f = pl.forwardVec(new THREE.Vector3());
    const k = peel.data.extraSlippery ? 1.35 : 1;
    const imp = new THREE.Vector3(f.x * pl.speed * 5 * k, 12 * 5.5 * k, f.z * pl.speed * 5 * k);
    pl.ragdoll('slip', 1.4, imp);
    peel.data.slipCooldown = game.time + 1.2;
    peel.body?.applyImpulse({ x: -f.x * 0.25, y: 0.2, z: -f.z * 0.25 }, true);
    const p = pl.position.clone();
    game.score(60, 'Banana Slip', p);
    game.sfx('boing', p, 0.8, 0.8);
    game.sfx('flop', p, 0.7);
    fxOf(game)?.emit('slip', p);
    game.events.emit('slip', { entity: pl.entity, peel, impulse: imp, player: true });
  }

  private slipOther(peel: Entity, e: Entity, vel: THREE.Vector3) {
    const game = this.game;
    const dir = vel.lengthSq() > 1e-4 ? vel.normalize() : new THREE.Vector3(1, 0, 0);
    const k = peel.data.extraSlippery ? 1.35 : 1;
    const m = Math.min(e.mass || 70, 120);
    const imp = new THREE.Vector3(dir.x * m * 1.5 * k, m * 5 * k, dir.z * m * 1.5 * k);
    const t = e.body?.translation();
    const point = t ? new THREE.Vector3(t.x, t.y, t.z) : new THREE.Vector3();
    e.data.slipCooldown = game.time + 2.5;
    peel.data.slipCooldown = game.time + 1;
    game.events.emit('slip', { entity: e, peel, impulse: imp });
    const anyE = e as any;
    if (typeof anyE.ragdoll === 'function') anyE.ragdoll('slip', 2, imp);
    else if (typeof e.data.ragdoll === 'function') e.data.ragdoll('slip', 2, imp);
    else if (e.body?.isDynamic()) e.body.applyImpulse(imp, true);
    else e.onBonk?.(game, imp, point);
    peel.body?.applyImpulse({ x: -dir.x * 0.25, y: 0.2, z: -dir.z * 0.25 }, true);
    game.score(120, "Banana'd!", point);
    game.sfx('boing', point, 0.8, 0.7);
    fxOf(game)?.emit('slip', point.add(_v.set(0, 0.8, 0)));
  }

  // ------------------------------------------------------------------ twinkles on washed shiny things
  private updateGlints(dt: number) {
    this.glintT -= dt;
    if (this.glintT > 0 || registry.shiny.size === 0) return;
    this.glintT = 0.25;
    const fx = fxOf(this.game);
    const cam = this.game.camera.position;
    for (const e of registry.shiny) {
      if (!e.alive || !e.body) {
        registry.shiny.delete(e);
        continue;
      }
      if (Math.random() > 0.3) continue;
      const t = e.body.translation();
      if ((t.x - cam.x) ** 2 + (t.z - cam.z) ** 2 > 30 * 30) continue;
      const r = (e.data.floatRadius as number) ?? 0.1;
      fx?.emit('glint', _v.set(t.x + rand(-r, r), t.y + rand(0, r) + 0.05, t.z + rand(-r, r)), { scale: 0.8 });
    }
  }

  // ------------------------------------------------------------------ emote (after the model animates)
  postPhysics() {
    const s = emoteState;
    if (!s.kind) return;
    const game = this.game;
    const pl = playerOf(game);
    const now = game.time;
    if (!pl || now >= s.until || pl.mode !== 'walk') {
      if (pl && s.froze) pl.frozen = false;
      s.kind = null;
      s.froze = false;
      return;
    }
    const parts = pl.model?.parts;
    if (!parts) return;
    const t = now - s.t0;
    const w = Math.min(1, t / 0.25) * Math.min(1, (s.until - now) / 0.35);
    const shake = t > 1.2 ? Math.sin(t * 9) * 0.22 * w : 0;
    const add = (part: THREE.Object3D | undefined, x: number, y: number, z: number) => {
      if (!part) return;
      _e.set(x, y, z, 'XYZ');
      part.quaternion.multiply(_q.setFromEuler(_e));
    };
    add(parts.ArmL, -1.45 * w, 0, 0.25 * w);
    add(parts.ArmR, -1.45 * w, 0, -0.25 * w);
    add(parts.HandL, -0.9 * w, 0, 0);
    add(parts.HandR, -0.9 * w, 0, 0);
    add(parts.Head, 0.5 * w, shake, 0);
  }
}
