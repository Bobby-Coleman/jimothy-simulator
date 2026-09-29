import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups, type ContactForceInfo } from '../../core/Physics';
import type { Jimothy } from '../../player/Jimothy';
import { Npc, type KnockOptions } from './Npc';
import { Bubble, Flashes } from './Speech';
import { loadNpcFont } from './Face';
import { TYPE_INFO } from './Looks';
import { NPC_TYPES, type NpcSpawnOptions, type NpcType } from './types';

const DEFAULT_TYPES: NpcType[] = ['pedestrian', 'pedestrian', 'pedestrian', 'tourist', 'tourist', 'fan', 'fan', 'jogger', 'techbro', 'kid', 'grandma'];
const SPOT_FILTER = groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _sphere = new THREE.Sphere();

interface Explosion {
  position: THREE.Vector3;
  radius?: number;
  force?: number;
}

/**
 * The human NPC system: spawning, crowd AI, reactions to Jimothy, ragdolls, stealing, washing.
 * See src/entities/npc/README.md for the API and events.
 */
export class NpcSystem implements System {
  name = 'npcs';
  /** Draw simple canvas speech bubbles. The UI can render its own from 'speech' events and set this false. */
  drawBubbles = true;
  /** Max simultaneous ragdolls; the oldest get up when exceeded. */
  maxRagdolls = 12;
  /** Hard cap for auto-population from world.npcSpawns. */
  maxPopulation = 50;
  minPopulation = 30;
  readonly list: Npc[] = [];
  player: Jimothy | null = null;
  game!: Game;
  private populated = false;
  private walkerMap = new Map<number, Npc>();
  private partMap = new Map<number, Npc>();
  private bubbles = new Map<Npc, Bubble>();
  private bubblePool: Bubble[] = [];
  private flashes!: Flashes;
  private hits = new Map<Npc, KnockOptions & { strength: number }>();
  private explosions: Explosion[] = [];
  private knockTimes: number[] = [];
  private lastStrike = -10;
  private kittyNext = 6;
  private sfxTimes = new Map<string, number>();
  private officerTimer = 0;
  private ambientTimer = 10;
  private nextIdx = 0;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();

  async init(game: Game) {
    this.game = game;
    this.flashes = new Flashes(game.scene);
    await loadNpcFont();
    game.physics.onContactForce((info) => this.onContactForce(info));
    game.physics.onCollision((c1, c2, started) => this.onCollision(c1, c2, started));
    game.events.on('explosion', (e: Explosion) => {
      if (e?.position) this.explosions.push(e);
    });
    game.events.on('chitter', (e: { position: THREE.Vector3 }) => this.onChitter(e));
    game.events.on('release', (e: { entity: Entity; thrown: boolean }) => this.onRelease(e));
  }

  // ================================================================== API

  /** Spawn one human. See NpcSpawnOptions. */
  spawn(opts: NpcSpawnOptions): Npc {
    const npc = new Npc(this, this.game, opts, this.nextIdx++);
    this.list.push(npc);
    this.walkerMap.set(npc.walkerCollider.handle, npc);
    return npc;
  }

  /** The Npc behind an entity (walker capsule or any ragdoll part maps to the same entity). */
  fromEntity(e: Entity | undefined | null): Npc | undefined {
    const n = e?.data?.npc;
    return n instanceof Npc ? n : undefined;
  }

  /** NPCs within `r` meters of `p` (xz distance). */
  near(p: THREE.Vector3, r: number, filter?: (n: Npc) => boolean): Npc[] {
    const out: Npc[] = [];
    const r2 = r * r;
    for (const n of this.list) {
      const dx = n.position.x - p.x;
      const dz = n.position.z - p.z;
      if (dx * dx + dz * dz <= r2 && (!filter || filter(n))) out.push(n);
    }
    return out;
  }

  byType(type: NpcType) {
    return this.list.filter((n) => n.type === type);
  }

  /** Make bystanders around `point` react to chaos (flee / film / cheer). */
  alarm(point: THREE.Vector3, radius = 9, cause = 'chaos', except?: Npc) {
    for (const n of this.list) {
      if (n === except || n.ragdolled) continue;
      const d = Math.hypot(n.position.x - point.x, n.position.z - point.z);
      if (d < radius) n.alarm(point, cause);
    }
  }

  /** Remove every NPC (e.g. before a cutscene that wants an empty street). */
  clear() {
    for (const n of [...this.list]) n.remove();
  }

  /** Populate from world.npcSpawns now (normally automatic on the first frame). */
  populate() {
    if (this.populated) return;
    this.populated = true;
    const world = this.game.get<any>('world');
    const spawns: { center: THREE.Vector3; radius: number; count: number; types?: string[]; path?: THREE.Vector3[] }[] = world?.npcSpawns ?? [];
    if (!spawns.length) {
      this.spawnTestCrowd();
      return;
    }
    const requested = spawns.reduce((s, e) => s + Math.max(0, e.count || 0), 0);
    let scale = 1;
    if (requested > this.maxPopulation) scale = this.maxPopulation / requested;
    else if (requested < this.minPopulation && requested > 0) scale = this.minPopulation / requested;
    for (const sp of spawns) {
      if (!(sp.count > 0)) continue;
      const n = Math.max(1, Math.round(sp.count * scale));
      const types = (sp.types ?? []).filter((t): t is NpcType => (NPC_TYPES as readonly string[]).includes(t));
      for (let i = 0; i < n; i++) {
        const type = types.length ? types[Math.floor(Math.random() * types.length)] : DEFAULT_TYPES[Math.floor(Math.random() * DEFAULT_TYPES.length)];
        const at = sp.path?.length ? sp.path[Math.floor(Math.random() * sp.path.length)] : sp.center;
        const pos = this.findSpot(at, sp.path?.length ? 2 : sp.radius);
        if (!pos) continue;
        try {
          this.spawn({ type, position: pos, wander: { center: sp.center.clone(), radius: sp.radius }, path: sp.path, pathLoop: false });
        } catch (err) {
          console.error('[npcs] spawn failed', err);
        }
      }
    }
    // Every busy area deserves a Wildlife Officer.
    if (!this.list.some((n) => n.type === 'officer')) {
      const big = [...spawns].filter((s) => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 3);
      for (const sp of big) {
        const pos = this.findSpot(sp.center, sp.radius);
        if (pos) this.spawn({ type: 'officer', position: pos, wander: { center: sp.center.clone(), radius: Math.max(sp.radius, 15) } });
      }
    }
    console.info(`[npcs] populated ${this.list.length} humans from ${spawns.length} spawn areas`);
  }

  /** Fallback population while zones have no spawn points: ~20 humans near (0,0) and the player spawn. */
  spawnTestCrowd() {
    const world = this.game.get<any>('world');
    const sp: THREE.Vector3 = world?.poi?.get('spawn')?.clone() ?? new THREE.Vector3();
    const areas: [THREE.Vector3, number, NpcType[]][] = [
      [sp, 26, ['officer', 'fan', 'fan', 'fan', 'tourist', 'tourist', 'pedestrian', 'pedestrian', 'pedestrian', 'grandma', 'kid', 'techbro', 'jogger']],
      [new THREE.Vector3(0, 0, 0), 20, ['mayor', 'dean', 'fishmonger', 'racer', 'pedestrian', 'pedestrian', 'tourist']],
    ];
    for (const [c, r, types] of areas) {
      for (const type of types) {
        const pos = this.findSpot(c, r);
        if (pos) this.spawn({ type, position: pos, wander: { center: c.clone(), radius: r } });
      }
    }
    console.info(`[npcs] world.npcSpawns is empty — spawned ${this.list.length} test humans`);
  }

  /** Random free standing spot inside a circle (null if nothing suitable). */
  findSpot(center: THREE.Vector3, radius: number, tries = 14): THREE.Vector3 | null {
    const world = this.game.get<any>('world');
    const water = this.game.get<any>('water');
    const ph = this.game.physics;
    let fallback: THREE.Vector3 | null = null;
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      const terrain = world?.heightAt?.(x, z) ?? 0;
      const top = Math.max(terrain, center.y) + 40;
      const hit = ph.raycast(_v.set(x, top, z), _w.set(0, -1, 0), 80, SPOT_FILTER);
      const y = hit ? hit.point.y : terrain;
      if (hit && hit.normal.y < 0.7) continue;
      const vol = water?.volumeAt?.(_v.set(x, y + 0.1, z));
      if (vol && vol.surfaceY - y > 0.4) continue;
      // body-sized free space?
      const blocked = ph.world.intersectionWithShape(
        { x, y: y + 0.95, z },
        { x: 0, y: 0, z: 0, w: 1 },
        new RAPIER.Capsule(0.6, 0.3),
        undefined,
        SPOT_FILTER,
      );
      if (blocked) continue;
      const p = new THREE.Vector3(x, y, z);
      if (y - terrain > 1.5) {
        fallback ??= p; // roofs/platforms only if nothing else
        continue;
      }
      return p;
    }
    return fallback;
  }

  // ================================================================== internals used by Npc

  showBubble(npc: Npc, text: string, secs: number) {
    if (!this.drawBubbles || npc.camDist > 40) return;
    let b = this.bubbles.get(npc);
    if (!b) {
      b = this.bubblePool.pop() ?? new Bubble();
      this.game.scene.add(b.sprite);
      this.bubbles.set(npc, b);
    }
    const shout = /!/.test(text) && text.replace(/[^A-Za-z]/g, '').length > 1 && text === text.toUpperCase();
    b.show(text, secs, shout);
    // keep it readable: at most 8 bubbles, drop the farthest
    if (this.bubbles.size > 8) {
      let far: Npc | null = null;
      for (const n of this.bubbles.keys()) if (!far || n.camDist > far.camDist) far = n;
      if (far) this.releaseBubble(far);
    }
  }

  private releaseBubble(npc: Npc) {
    const b = this.bubbles.get(npc);
    if (!b) return;
    this.bubbles.delete(npc);
    b.hide();
    b.sprite.removeFromParent();
    if (this.bubblePool.length < 12) this.bubblePool.push(b);
    else b.dispose();
  }

  flash(pos: THREE.Vector3) {
    this.flashes.flash(pos);
  }

  /** Rate-limited sfx. */
  sfx(key: string, pos?: THREE.Vector3, volume?: number, pitch?: number, minGap = 0.25) {
    const t = this.game.time;
    const last = this.sfxTimes.get(key) ?? -10;
    if (t - last < minGap) return;
    this.sfxTimes.set(key, t);
    this.game.sfx(key, pos?.clone(), volume, pitch);
  }

  scream(pos: THREE.Vector3) {
    this.sfx('scream', pos, 0.55, 0.9 + Math.random() * 0.3, 0.35);
  }

  kittyReady() {
    return this.game.time >= this.kittyNext;
  }

  useKitty() {
    this.kittyNext = this.game.time + 22;
  }

  mapColliders(cs: RAPIER.Collider[], npc: Npc) {
    for (const c of cs) this.partMap.set(c.handle, npc);
  }

  unmapColliders(cs: RAPIER.Collider[]) {
    for (const c of cs) this.partMap.delete(c.handle);
  }

  unregister(npc: Npc) {
    const i = this.list.indexOf(npc);
    if (i >= 0) this.list.splice(i, 1);
    this.walkerMap.delete(npc.walkerCollider.handle);
    this.hits.delete(npc);
    this.releaseBubble(npc);
  }

  /** Ragdoll cap: the oldest (not being dragged) get up. */
  makeRoomForRagdoll(except: Npc) {
    const active = this.list.filter((n) => n.ragdolled && n !== except);
    if (active.length < this.maxRagdolls) return;
    active.sort((a, b) => a.knockedAt - b.knockedAt);
    let excess = active.length - this.maxRagdolls + 1;
    for (const n of active) {
      if (excess <= 0) break;
      if (n.entity.data.draggedByPlayer) continue;
      n.getUp();
      excess--;
    }
  }

  onKnockdown(npc: Npc, cause: string, byPlayer: boolean) {
    const game = this.game;
    game.events.emit('npcRagdoll', { entity: npc.entity, cause, npc });
    const pos = npc.position.clone();
    pos.y += 1.4;
    if (cause !== 'faint' && cause !== 'script') this.scream(npc.position);
    if (cause !== 'script' && cause !== 'faint' && cause !== 'fall') this.alarm(npc.position, 9, cause, npc);
    if (!byPlayer) {
      if (cause === 'vehicle') game.score(40, 'Look Both Ways!', pos);
      return;
    }
    const info = TYPE_INFO[npc.type];
    const who = npc.name !== info.display ? npc.name : `${info.article ? info.article + ' ' : ''}${info.display}`;
    let pts = 75;
    let label = `Yeeted ${who}`;
    switch (cause) {
      case 'roll':
        pts = 100;
        label = 'Human Bowling';
        break;
      case 'bonk':
        if (npc.type === 'kid') label = 'Tiny Tumble';
        else if (npc.type === 'grandma') label = 'Sorry, Grandma!';
        break;
      case 'prop':
        pts = 100;
        label = 'Direct Hit!';
        break;
      case 'player':
        pts = 120;
        label = 'Raccoon Cannonball';
        break;
      case 'ragdoll':
        pts = 90;
        label = 'Human Dominoes';
        break;
      case 'explosion':
        pts = 80;
        label = `Launched ${who}`;
        break;
      case 'grab':
        pts = 40;
        label = 'Grabby Hands';
        break;
      default:
        pts = 50;
        label = 'Knockdown';
    }
    game.score(pts, label, pos);
    if (cause === 'bonk' && Math.random() < 0.3) this.sfx('crowd_ooh', pos, 0.45, 1, 3);
    if (cause === 'grab') return;
    const t = game.time;
    this.knockTimes = this.knockTimes.filter((x) => t - x <= 1);
    this.knockTimes.push(t);
    if (this.knockTimes.length >= 3 && t - this.lastStrike > 1.5) {
      this.lastStrike = t;
      game.score(500, 'STRIKE!', pos);
      game.events.emit('strike', { count: this.knockTimes.length, position: pos });
      this.sfx('crowd_cheer', pos, 0.7, 1, 1);
    }
  }

  // ================================================================== physics & events

  private queueHit(npc: Npc, o: KnockOptions, strength: number) {
    if (npc.ragdolled || npc.removed) return;
    const prev = this.hits.get(npc);
    if (!prev || prev.strength < strength) this.hits.set(npc, { ...o, strength });
  }

  private onContactForce(info: ContactForceInfo) {
    const n1 = this.walkerMap.get(info.c1.handle);
    const n2 = this.walkerMap.get(info.c2.handle);
    if (n1) this.walkerContact(n1, info.c2, info.force);
    if (n2) this.walkerContact(n2, info.c1, info.force);
  }

  private walkerContact(npc: Npc, other: RAPIER.Collider, force: number) {
    if (npc.ragdolled || npc.removed) return;
    const ob = other.parent();
    if (!ob) return;
    const game = this.game;
    const e = game.entities.fromCollider(other);
    const pl = this.player;
    if (e && e.kind === 'player' && pl) {
      if (pl.mode === 'roll' && pl.speed > 4.5) {
        _v.copy(pl.velocity).setY(0);
        const sp = _v.length();
        _v.normalize().multiplyScalar(Math.max(4, sp * 0.85));
        _v.y = 2.5 + sp * 0.15;
        this.queueHit(npc, { cause: 'roll', dv: _v.clone(), byPlayer: true }, 50 + sp);
      } else if (pl.mode === 'ragdoll' && pl.velocity.length() > 6.5) {
        _v.copy(pl.velocity);
        const sp = _v.length();
        _v.normalize().multiplyScalar(sp * 0.6);
        _v.y = Math.max(_v.y, 2);
        this.queueHit(npc, { cause: 'player', dv: _v.clone(), byPlayer: true }, 40 + sp);
      } else if (pl.mode === 'walk' && pl.speed > 1.5) {
        npc.bumped();
      }
      return;
    }
    if (!ob.isDynamic()) return;
    const h = game.physics.world.timestep || 1 / 60;
    const J = force * h;
    const m = Math.max(0.05, ob.mass());
    const lv = ob.linvel();
    const vAfter = Math.hypot(lv.x, lv.y, lv.z);
    const pre = vAfter + J / m;
    const owner = this.partMap.get(other.handle);
    if (owner) {
      // a flying human hits a standing one
      if (owner !== npc && pre > 4.5 && J > 6) {
        _v.set(lv.x, 0, lv.z);
        const sp = Math.max(3, Math.min(9, pre * 0.6));
        if (_v.lengthSq() > 1e-4) _v.normalize().multiplyScalar(sp);
        _v.y = 2;
        this.queueHit(npc, { cause: 'ragdoll', dv: _v.clone(), byPlayer: owner.knockByPlayer }, J);
      }
      return;
    }
    const heavy = J > 160;
    if (!((J > 10 && pre > 4) || heavy)) return;
    const vehicle = e?.kind === 'vehicle' || e?.tags.has('vehicle');
    const thrownByPlayer = !!e && (e.data.heldByPlayer || (typeof e.data.thrownAt === 'number' && game.time - e.data.thrownAt < 4));
    _v.set(lv.x, 0, lv.z);
    if (_v.lengthSq() < 1e-4) {
      // use the separation direction instead
      const t = ob.translation();
      _v.set(npc.position.x - t.x, 0, npc.position.z - t.z);
    }
    const mag = THREE.MathUtils.clamp((pre * m) / 18, 2.5, vehicle ? 16 : 11);
    _v.normalize().multiplyScalar(mag);
    _v.y = 1.5 + mag * 0.35;
    this.queueHit(npc, { cause: vehicle ? 'vehicle' : 'prop', dv: _v.clone(), byPlayer: thrownByPlayer || (vehicle && !!e?.data.drivenByPlayer) }, J);
  }

  private onCollision(c1: RAPIER.Collider, c2: RAPIER.Collider, started: boolean) {
    if (!started) return;
    const n1 = this.walkerMap.get(c1.handle);
    const n2 = this.walkerMap.get(c2.handle);
    if (n1) this.walkerTouch(n1, c2);
    if (n2) this.walkerTouch(n2, c1);
  }

  /** Kinematic vehicles don't produce contact forces with kinematic walkers — catch them here. */
  private walkerTouch(npc: Npc, other: RAPIER.Collider) {
    if (npc.ragdolled) return;
    const b = other.parent();
    if (!b || !b.isKinematic()) return;
    const e = this.game.entities.fromCollider(other);
    if (!e || (e.kind !== 'vehicle' && !e.tags.has('vehicle'))) return;
    const lv = b.linvel();
    const sp = Math.hypot(lv.x, lv.z);
    if (sp < 2) return;
    _v.set(lv.x, 0, lv.z).multiplyScalar(1.1);
    _v.y = 2 + sp * 0.25;
    this.queueHit(npc, { cause: 'vehicle', dv: _v.clone(), byPlayer: !!e.data.drivenByPlayer }, sp * 100);
  }

  private processExplosion(ex: Explosion) {
    const R = ex.radius ?? 6;
    const F = ex.force ?? 600;
    const p = ex.position;
    for (const n of [...this.list]) {
      const c = n.ragdolled ? n.ragdollState!.pelvisPosition(_v) : _v.set(n.position.x, n.position.y + 1, n.position.z);
      const d = c.distanceTo(p);
      if (d < R) {
        const fall = 1 - d / R;
        const mag = THREE.MathUtils.clamp(F / 35, 6, 24) * (0.35 + 0.65 * fall);
        const dir = _w.subVectors(c, p);
        if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
        dir.normalize();
        dir.y = Math.max(dir.y, 0) + 0.8;
        dir.normalize().multiplyScalar(mag);
        n.knockDown({ cause: 'explosion', dv: dir.clone(), byPlayer: true, flail: 1.6 });
      } else if (d < R * 3 + 8) n.alarm(p, 'explosion');
    }
  }

  private onChitter(e: { position: THREE.Vector3 }) {
    const p = e?.position ?? this.player?.position;
    if (!p) return;
    let count = 0;
    for (const n of this.list) {
      if (!n.canReact()) continue;
      const d = Math.hypot(n.position.x - p.x, n.position.z - p.z);
      if (d > 10 || Math.random() > 0.85) continue;
      n.hearChitter(count < 2 && Math.random() < 0.7);
      count++;
    }
    if (count >= 2) this.sfx('crowd_aww', p, 0.6, 1, 2);
    if (count >= 3) this.game.score(30, 'Crowd Pleaser', p.clone());
  }

  private onRelease(e: { entity: Entity; thrown: boolean }) {
    const ent = e?.entity;
    const pl = this.player;
    if (!ent) return;
    if (e.thrown) {
      if (pl) this.alarm(pl.position, 7, 'throw');
      return;
    }
    if (!ent.body || !ent.alive) return;
    const t = ent.body.translation();
    const owner = ent.data?.owner;
    if (owner instanceof Npc && !owner.removed && !owner.ragdolled && !owner.held) {
      if (Math.hypot(owner.position.x - t.x, owner.position.z - t.z) < 2.6 && owner.receiveItem(ent)) {
        this.game.score(150, 'Returned It!', owner.headPosition(new THREE.Vector3()));
        this.game.events.emit('itemReturned', { entity: ent, to: owner.entity, npc: owner });
        return;
      }
    }
    for (const n of this.list) {
      if (!n.onInteract || n.ragdolled) continue;
      if (Math.hypot(n.position.x - t.x, n.position.z - t.z) < 2.2 && n.onInteract('give', ent) === true) break;
    }
  }

  private computeSeparation() {
    const L = this.list;
    for (const a of L) a.sep.set(0, 0, 0);
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.ragdolled || a.camDist > 140) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.ragdolled || b.camDist > 140) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const minD = 0.4 * (a.rig.dims.s + b.rig.dims.s) + 0.05;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || Math.abs(b.position.y - a.position.y) > 1.5) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (minD - d) / minD;
        const ux = d2 > 1e-6 ? dx / d : Math.random() - 0.5;
        const uz = d2 > 1e-6 ? dz / d : Math.random() - 0.5;
        a.sep.x -= ux * push;
        a.sep.z -= uz * push;
        b.sep.x += ux * push;
        b.sep.z += uz * push;
      }
    }
    const pl = this.player;
    if (pl) {
      for (const a of L) {
        if (a.ragdolled) continue;
        const dx = a.position.x - pl.position.x;
        const dz = a.position.z - pl.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.9 * 0.9 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          a.sep.x += (dx / d) * (0.9 - d) * 1.5;
          a.sep.z += (dz / d) * (0.9 - d) * 1.5;
        }
      }
    }
  }

  private officerScan() {
    const pl = this.player;
    if (!pl) return;
    const pp = pl.position;
    const t = this.game.time;
    const fans = this.list.filter(
      (n) =>
        n.type !== 'officer' &&
        (n.type === 'fan' || n.state === 'selfie' || n.state === 'kitty') &&
        n.canReact() &&
        t - n.lastScolded > 12 &&
        Math.hypot(n.position.x - pp.x, n.position.z - pp.z) < 3,
    );
    if (!fans.length) return;
    for (const o of this.list) {
      if (o.type !== 'officer' || !o.canReact() || o.passive || o.isCustom) continue;
      if (o.state !== 'idle' && o.state !== 'wander' && o.state !== 'watch') continue;
      const i = fans.findIndex((f) => Math.hypot(f.position.x - o.position.x, f.position.z - o.position.z) < 45);
      if (i < 0) continue;
      o.startScold(fans[i]);
      fans.splice(i, 1);
      if (!fans.length) break;
    }
  }

  // ================================================================== system hooks

  update(dt: number, game: Game) {
    if (!this.populated) return;
    this.player = game.get<Jimothy>('player') ?? null;
    this.computeSeparation();
    this.officerTimer -= dt;
    if (this.officerTimer <= 0) {
      this.officerTimer = 0.4;
      this.officerScan();
    }
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 10 + Math.random() * 15;
      const cands = this.list.filter((n) => n.visible && n.camDist < 22 && (n.state === 'idle' || n.state === 'wander') && !n.passive && !n.isCustom);
      if (cands.length) cands[Math.floor(Math.random() * cands.length)].sayLine('ambient', 2.6);
    }
    for (const n of this.list) {
      if (n.ragdolled || n.removed) continue;
      if (n.camDist > 140) continue; // hidden & frozen
      if (n.camDist > 70) {
        n.lodAccum += dt;
        if ((game.frame + n.idx) % 5 !== 0) continue;
        const acc = Math.min(n.lodAccum, 0.25);
        n.lodAccum = 0;
        n.update(acc);
        if (n.visible && !n.ragdolled) n.animate(acc);
        continue;
      }
      n.lodAccum = 0;
      n.update(dt);
      if (n.visible && !n.ragdolled && !n.removed) n.animate(dt);
    }
  }

  postPhysics(dt: number) {
    if (!this.populated) return;
    if (this.explosions.length) {
      const ex = this.explosions.splice(0);
      for (const e of ex) this.processExplosion(e);
    }
    if (this.hits.size) {
      const hits = [...this.hits];
      this.hits.clear();
      for (const [npc, o] of hits) if (!npc.removed) npc.knockDown(o);
    }
    for (const n of [...this.list]) if (n.ragdolled && !n.removed) n.ragdollStep(dt, n.visible);
  }

  lateUpdate(dt: number, game: Game) {
    if (!this.populated && game.state !== 'boot') this.populate();
    const cam = game.camera;
    cam.updateMatrixWorld();
    this.projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const cp = cam.position;
    for (const n of this.list) {
      const root = n.rig.root;
      _v.copy(root.position);
      if (!n.ragdolled) _v.y += 0.9;
      const d = _v.distanceTo(cp);
      n.camDist = d;
      _sphere.center.copy(_v);
      _sphere.radius = n.ragdolled ? 1.6 : 1.3;
      const vis = d < 140 && this.frustum.intersectsSphere(_sphere);
      n.visible = vis;
      root.visible = vis;
      n.rig.mesh.castShadow = d < 45;
    }
    // bubbles
    for (const [npc, b] of this.bubbles) {
      if (npc.removed || !this.drawBubbles) {
        this.releaseBubble(npc);
        continue;
      }
      const head = npc.headPosition(_w);
      head.y += npc.rig.dims.headR * 1.3 + 0.3;
      if (!b.update(game.paused ? 0 : dt, head, npc.camDist)) this.releaseBubble(npc);
    }
    this.flashes.update(dt);
  }
}
