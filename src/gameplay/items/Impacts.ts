import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups, type ContactForceInfo } from '../../core/Physics';
import { destroyProp } from '../../entities/Props';
import { after, fxOf, entityPos, playerOf, releaseIfHeld, rand } from './shared';

/**
 * 'impacts' system: turns Rapier contact-force events into gameplay.
 *  - calls entity.onImpact(game, other, strength≈Δv m/s) on both sides (throttled)
 *  - emits 'impact' {a, b, strength, position}; plays impact_light/heavy/metal/wood (throttled)
 *  - thrown props (Jimothy's throws): "Direct Hit" / "Long Distance Delivery" / "Yeet!" → 'thrownHit'
 *  - tag `fragile` shatters into short-lived DEBRIS bodies (glass_break) → 'shatter' {entity, position}
 *  - tag `explosive` explodes on a hard hit or after two bonks → explode() below
 *
 * Other systems can blow things up too: `explode(game, position, { radius, force, source, fireworks })`
 * and `shatter(game, entity)` are exported.
 */

interface Hit {
  a?: Entity;
  b?: Entity;
  sa: number;
  sb: number;
  ma: number;
  mb: number;
}

const DYN_FILTER = groups(G.ALL, G.PROP | G.NPC | G.RAGDOLL | G.VEHICLE | G.ANIMAL | G.DEBRIS | G.HELD);
const TARGET_KINDS = new Set(['npc', 'animal', 'vehicle', 'slop']);
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export class ImpactSystem implements System {
  name = 'impacts';
  private game!: Game;
  private hits: Hit[] = [];
  private lastImpact = new Map<number, number>();
  private lastSound = new Map<number, number>();
  private soundTimes: number[] = [];
  private hissHinted = false;

  init(game: Game) {
    this.game = game;
    game.physics.onContactForce((info) => this.onContact(info));
    game.events.on('release', (p) => {
      if (!p?.thrown || !p.entity) return;
      const pl = playerOf(game);
      p.entity.data.yeet = { t: game.time, from: pl?.position?.clone(), scored: false };
    });
    game.events.on('bonk', (p) => this.onBonk(p?.entity));
  }

  // Runs right after a physics substep has been drained (never inside Rapier): only measure & queue.
  private onContact(info: ContactForceInfo) {
    if (this.hits.length > 300) return;
    const game = this.game;
    const h = game.physics.world.timestep || 1 / 60;
    const ba = info.c1.parent();
    const bb = info.c2.parent();
    const ma = ba && ba.isDynamic() ? ba.mass() : Infinity;
    const mb = bb && bb.isDynamic() ? bb.mass() : Infinity;
    const imp = info.force * h;
    const sa = ma === Infinity ? 0 : imp / Math.max(ma, 0.05);
    const sb = mb === Infinity ? 0 : imp / Math.max(mb, 0.05);
    if (Math.max(sa, sb) < 1.2) return;
    const a = game.entities.fromCollider(info.c1);
    const b = game.entities.fromCollider(info.c2);
    if (!a && !b) return;
    this.hits.push({ a, b, sa: Math.min(sa, 60), sb: Math.min(sb, 60), ma, mb });
  }

  postPhysics(dt: number) {
    const hits = this.hits;
    this.hits = [];
    for (const h of hits) {
      try {
        this.handle(h);
      } catch (err) {
        console.error('[impacts] failed', err);
      }
    }
    updateDebris(this.game);
    if (this.lastImpact.size > 500) this.lastImpact.clear();
    if (this.lastSound.size > 500) this.lastSound.clear();
  }

  private handle(h: Hit) {
    const game = this.game;
    const { a, b } = h;
    // Jimothy vs the world: he handles his own landings.
    if ((a?.kind === 'player' && !b) || (b?.kind === 'player' && !a)) return;
    const now = game.time;
    const fire = (e: Entity | undefined, other: Entity | undefined, s: number) => {
      if (!e || !e.alive || s < 1.5) return;
      if (now - (this.lastImpact.get(e.id) ?? -1) < 0.08) return;
      this.lastImpact.set(e.id, now);
      try {
        e.onImpact?.(game, other, s);
      } catch (err) {
        console.error('[impacts] onImpact failed for', e.name, err);
      }
      this.special(e, s);
    };
    fire(a, b, h.sa);
    fire(b, a, h.sb);
    const strength = Math.max(h.sa, h.sb);
    if (strength >= 2) {
      const loud = h.sa >= h.sb ? (a ?? b) : (b ?? a);
      const pos = (loud && entityPos(loud)) || undefined;
      game.events.emit('impact', { a, b, strength, position: pos });
      if (pos) this.sound(loud, strength, h.sa >= h.sb ? h.ma : h.mb, pos);
    }
    this.yeet(a, b, h.sa);
    this.yeet(b, a, h.sb);
  }

  /** Fragile & explosive reactions. */
  private special(e: Entity, s: number) {
    if (e.data.heldByPlayer) return;
    // Ignore the settle right after spawning (a vase placed slightly inside a table shouldn't blow up).
    const born = (e.data.spawnT as number | undefined) ?? 0;
    if (this.game.time - born < 1.0) return;
    if (e.tags.has('fragile') && s > (e.data.shatterAt ?? 6.5)) {
      shatter(this.game, e);
    } else if (e.tags.has('explosive') && !e.data.exploded && !e.data.armed) {
      const thrown = e.data.yeet && this.game.time - e.data.yeet.t < 3;
      if (s > 8.5 || (thrown && s > 4.5)) armExplosive(this.game, e, 0.05);
      else if (s > 4.5) {
        e.data.damage = (e.data.damage ?? 0) + 1;
        if (e.data.damage >= 2) armExplosive(this.game, e, 0.25);
        else this.hiss(e);
      }
    }
  }

  private hiss(e: Entity) {
    const p = entityPos(e);
    if (!p) return;
    fxOf(this.game)?.emit('smoke', p.add(new THREE.Vector3(0, 0.3, 0)), { scale: 0.5, count: 4 });
    this.game.sfx('fizz', p, 0.7);
    if (!this.hissHinted) {
      this.hissHinted = true;
      this.game.hint(`The ${e.name.toLowerCase()} is hissing ominously. One more bonk and… well.`, 3);
    }
  }

  private onBonk(e: Entity | undefined) {
    if (!e?.alive || !e.tags.has('explosive') || e.data.exploded || e.data.armed) return;
    e.data.bonks = (e.data.bonks ?? 0) + 1;
    if (e.data.bonks >= 2) armExplosive(this.game, e, 0.35);
    else this.hiss(e);
  }

  private sound(e: Entity | undefined, strength: number, mass: number, pos: THREE.Vector3) {
    const game = this.game;
    const now = game.time;
    if (e?.data.shattered || e?.data.exploded) return;
    if (pos.distanceToSquared(game.camera.position) > 50 * 50) return;
    this.soundTimes = this.soundTimes.filter((t) => now - t < 0.2);
    if (this.soundTimes.length >= 6) return;
    const key = e ? e.id : -1;
    if (now - (this.lastSound.get(key) ?? -1) < 0.15) return;
    this.lastSound.set(key, now);
    this.soundTimes.push(now);
    const m = e?.mass ?? (Number.isFinite(mass) ? mass : 10);
    const tags = e?.tags;
    const name = e?.name ?? '';
    let key2 = 'impact_light';
    if (tags?.has('metal') || tags?.has('trashcan') || tags?.has('dumpster') || tags?.has('can') || /trash can|metal|lid/i.test(name)) key2 = 'impact_metal';
    else if (tags?.has('wood') || /crate|wood|bench|box|plank/i.test(name)) key2 = 'impact_wood';
    else if (strength > 12 || m > 40) key2 = 'impact_heavy';
    const soft = tags?.has('plush') || tags?.has('cottoncandy') || tags?.has('paper');
    const vol = clamp((strength - 1.5) / 9, 0.12, 1) * (soft ? 0.4 : 1);
    const pitch = clamp(1.3 - Math.log10(m + 1) * 0.35, 0.6, 1.4) * rand(0.92, 1.08);
    game.sfx(key2, pos, vol, pitch);
  }

  /** Thrown-prop scoring (once per throw, within 3 s). */
  private yeet(e: Entity | undefined, other: Entity | undefined, s: number) {
    const y = e?.data.yeet;
    if (!e || !y || y.scored || s < 3) return;
    const game = this.game;
    if (game.time - y.t > 3) {
      e.data.yeet = undefined;
      return;
    }
    const pos = entityPos(e) ?? undefined;
    const dist = y.from && pos ? Math.hypot(pos.x - y.from.x, pos.z - y.from.z) : 0;
    const far = dist > 15;
    if (other && TARGET_KINDS.has(other.kind)) {
      y.scored = true;
      game.score(100, 'Direct Hit', pos);
      if (far) game.score(150, 'Long Distance Delivery', pos);
      game.events.emit('thrownHit', { entity: e, other, distance: dist, strength: s });
    } else if (far && s >= 4) {
      y.scored = true;
      game.score(150, 'Long Distance Delivery', pos);
      game.events.emit('thrownHit', { entity: e, other, distance: dist, strength: s });
    } else if (other && (other.kind === 'prop' || other.kind === 'item') && s >= 4.5) {
      y.scored = true;
      game.score(30, 'Yeet!', pos);
      game.events.emit('thrownHit', { entity: e, other, distance: dist, strength: s });
    }
  }
}

// ------------------------------------------------------------------ explosives
/** Light the fuse: sparks for `fuse` seconds, then boom. */
export function armExplosive(game: Game, e: Entity, fuse = 0.3) {
  if (!e.alive || e.data.armed || e.data.exploded) return;
  e.data.armed = true;
  const p = entityPos(e);
  if (p && fuse > 0.1) {
    fxOf(game)?.emit('zap', p, { duration: fuse, scale: 0.6 });
    game.sfx('fizz', p, 0.9, 1.3);
  }
  after(game, fuse, () => explodeEntity(game, e));
}

/** Blow up an explosive entity right now (removes it). */
export function explodeEntity(game: Game, e: Entity) {
  if (!e.alive || e.data.exploded) return;
  e.data.exploded = true;
  const pos = entityPos(e);
  releaseIfHeld(game, e);
  destroyProp(game, e);
  if (!pos) return;
  if (e.data.fireworks && e.data.damp) {
    fxOf(game)?.emit('fizzle', pos);
    game.sfx('fizz', pos, 1, 0.7);
    game.score(30, 'Damp Squib', pos);
    game.hint('Pfffft. Washed fireworks do not work. Who knew.', 2.5);
    return;
  }
  explode(game, pos, { radius: e.data.explosionRadius ?? 7, source: e, fireworks: !!e.data.fireworks });
}

/**
 * A cartoon (PG) explosion: radial impulses on everything dynamic in range (collected first, then
 * applied), chains other explosives, shatters fragile things, ragdolls a nearby Jimothy, camera shake,
 * "Kaboom!" and an 'explosion' {position, radius, force, source, fireworks} event (FX draws it).
 */
export function explode(
  game: Game,
  pos: THREE.Vector3,
  opts: { radius?: number; force?: number; source?: Entity; fireworks?: boolean; label?: string; points?: number } = {},
) {
  const radius = opts.radius ?? 7;
  const force = opts.force ?? 1;
  const cols = game.physics.overlapSphere(pos, radius, DYN_FILTER);
  const seen = new Set<number>();
  const targets: { e?: Entity; body: RAPIER.RigidBody }[] = [];
  for (const c of cols) {
    const b = c.parent();
    if (!b || seen.has(b.handle)) continue;
    seen.add(b.handle);
    targets.push({ e: game.entities.fromCollider(c), body: b });
  }
  const dir = new THREE.Vector3();
  for (const { e, body } of targets) {
    if (e && (!e.alive || e === opts.source || e.kind === 'player')) continue;
    if (!game.physics.world.getRigidBody(body.handle)) continue;
    const t = body.translation();
    dir.set(t.x - pos.x, t.y - pos.y, t.z - pos.z);
    const d = dir.length();
    const fall = clamp(1 - d / radius, 0.15, 1);
    if (d > 1e-3) dir.divideScalar(d);
    else dir.set(0, 1, 0);
    dir.y += 0.6;
    dir.normalize();
    const m = e?.mass ?? body.mass();
    const imp = dir.clone().multiplyScalar(Math.min(m, 80) * 15 * fall * force);
    const point = new THREE.Vector3(t.x + rand(-0.1, 0.1), t.y + 0.1, t.z + rand(-0.1, 0.1));
    if (e?.tags.has('explosive') && !e.data.exploded) {
      if (!e.data.armed) {
        e.data.armed = true;
        after(game, 0.12 + d * 0.04, () => explodeEntity(game, e));
      }
      continue;
    }
    if (e?.tags.has('fragile') && !e.data.shattered && !e.data.heldByPlayer) {
      shatter(game, e, imp.clone().divideScalar(Math.max(m, 0.1)));
      continue;
    }
    if (e && TARGET_KINDS.has(e.kind)) {
      const handled = e.onBonk?.(game, imp, point) === true;
      if (!handled && body.isDynamic()) body.applyImpulseAtPoint(imp, point, true);
      continue;
    }
    if (e?.data.heldByPlayer) continue;
    if (body.isDynamic()) body.applyImpulseAtPoint(imp, point, true);
  }
  // Jimothy
  const pl = playerOf(game);
  if (pl) {
    const d = pl.position.distanceTo(pos);
    if (d < radius) {
      const fall = clamp(1 - d / radius, 0.2, 1);
      dir.copy(pl.position).sub(pos);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      dir.y += 0.8;
      dir.normalize();
      const imp = dir.multiplyScalar(12 * 17 * fall * force);
      if (d < radius * 0.85) pl.ragdoll('explosion', 2, imp);
      else pl.body?.applyImpulse(imp, true);
    }
  }
  const dc = game.camera.position.distanceTo(pos);
  game.get<any>('camera')?.shake(clamp(1.3 - dc / 22, 0.15, 1.1));
  game.score(opts.points ?? (opts.fireworks ? 250 : 200), opts.label ?? (opts.fireworks ? 'Fireworks Show!' : 'Kaboom!'), pos.clone());
  game.sfx('explosion_small', pos, 1);
  game.events.emit('explosion', { position: pos.clone(), radius, force, source: opts.source, fireworks: !!opts.fireworks });
  if (opts.fireworks) {
    fxOf(game)?.emit('fireworks', pos, { count: 10, duration: 1.6 });
    for (let i = 0; i < 4; i++) after(game, 0.4 + i * 0.35, () => game.sfx('firework', pos, 0.7, rand(0.8, 1.2)));
  }
}

// ------------------------------------------------------------------ fragile things
const _box = new THREE.Box3();
const _s = new THREE.Vector3();

function debrisMaterial(e: Entity): THREE.Material | null {
  let best: THREE.Material | null = null;
  let bestR = -1;
  const glass = e.tags.has('glass');
  e.object?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    let r = (m.geometry.boundingSphere?.radius ?? 0) * m.getWorldScale(_s).x;
    if (glass && (mat as THREE.MeshStandardMaterial).transparent) r += 100;
    if (r > bestR) {
      bestR = r;
      best = mat;
    }
  });
  return best;
}

/** Smash a fragile entity into a few debris pieces (removes it). */
export function shatter(game: Game, e: Entity, vel?: THREE.Vector3) {
  if (!e.alive || e.data.shattered) return;
  e.data.shattered = true;
  const pos = entityPos(e);
  if (!pos) return;
  let size = e.data.size as THREE.Vector3 | undefined;
  if (!size && e.object) size = _box.setFromObject(e.object).getSize(new THREE.Vector3());
  size = size ?? new THREE.Vector3(0.3, 0.3, 0.3);
  const lv = e.body?.linvel();
  const v = vel ?? (lv ? new THREE.Vector3(lv.x, lv.y, lv.z) : new THREE.Vector3());
  const mat = debrisMaterial(e) ?? new THREE.MeshStandardMaterial({ color: 0xcccccc });
  releaseIfHeld(game, e);
  destroyProp(game, e);
  const vol = size.x * size.y * size.z;
  spawnDebris(game, pos, size, mat, v, clamp(Math.round(4 + vol * 30), 4, 8));
  const fx = fxOf(game);
  const sc = clamp(Math.max(size.x, size.y, size.z) / 0.4, 0.7, 2);
  fx?.emit('shatter', pos, { scale: sc, color: e.data.shatterColor ?? 0xcff0ff });
  if (e.tags.has('electronic')) {
    fx?.emit('zap', pos, { duration: 0.5 });
    game.sfx('short_circuit', pos, 0.8);
  }
  game.sfx('glass_break', pos, 0.9, rand(0.9, 1.1));
  game.score(e.data.shatterPoints ?? 50, e.data.shatterLabel ?? `Smashed The ${e.name}`, pos);
  game.events.emit('shatter', { entity: e, position: pos });
}

// ------------------------------------------------------------------ debris (short-lived DEBRIS-group bodies)
interface Debris {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  until: number;
  scale: THREE.Vector3;
}
const debris: Debris[] = [];
const MAX_DEBRIS = 48;
let debrisGeo: THREE.BufferGeometry | null = null;

function removeDebris(game: Game, d: Debris) {
  game.physics.removeBody(d.body);
  d.mesh.removeFromParent();
}

export function spawnDebris(game: Game, pos: THREE.Vector3, size: THREE.Vector3, mat: THREE.Material, vel: THREE.Vector3, n: number) {
  if (!debrisGeo) debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const sx = clamp(size.x * rand(0.25, 0.5), 0.03, 0.35);
    const sy = clamp(size.y * rand(0.12, 0.3), 0.02, 0.18);
    const sz = clamp(size.z * rand(0.25, 0.5), 0.03, 0.35);
    const mesh = new THREE.Mesh(debrisGeo, mat);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(pos.x + rand(-0.4, 0.4) * size.x, pos.y + rand(-0.3, 0.3) * size.y, pos.z + rand(-0.4, 0.4) * size.z);
    mesh.rotation.set(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28));
    mesh.castShadow = true;
    game.scene.add(mesh);
    const cd = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setDensity(250)
      .setFriction(0.6)
      .setRestitution(0.3)
      .setCollisionGroups(groups(G.DEBRIS, G.WORLD));
    const body = game.physics.createDynamic(mesh, [cd], { linearDamping: 0.1, angularDamping: 0.3, sleeping: false });
    const a = Math.random() * Math.PI * 2;
    const sp = rand(1.2, 3.2);
    body.setLinvel({ x: vel.x * 0.5 + Math.cos(a) * sp, y: Math.max(0, vel.y * 0.3) + rand(1, 3), z: vel.z * 0.5 + Math.sin(a) * sp }, true);
    body.setAngvel({ x: rand(-12, 12), y: rand(-12, 12), z: rand(-12, 12) }, true);
    debris.push({ body, mesh, until: game.time + rand(2.5, 4), scale: mesh.scale.clone() });
  }
  while (debris.length > MAX_DEBRIS) removeDebris(game, debris.shift()!);
}

function updateDebris(game: Game) {
  const now = game.time;
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    if (now < d.until) continue;
    const k = 1 - (now - d.until) / 0.4;
    if (k <= 0) {
      removeDebris(game, d);
      debris.splice(i, 1);
    } else d.mesh.scale.copy(d.scale).multiplyScalar(k);
  }
}
