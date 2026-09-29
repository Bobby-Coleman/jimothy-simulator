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

/** 'family' in a spawn's types = a mix of parents, kids and grandparents. */
const FAMILY: NpcType[] = ['pedestrian', 'pedestrian', 'kid', 'kid', 'grandma'];
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
  /**
   * Fallback canvas speech bubbles. They are skipped automatically while any other system listens to 'speech'
   * (the UI's bubble layer does); set false to never draw them.
   */
  drawBubbles = true;
  /** Max simultaneous ragdolls; the oldest get up when exceeded. */
  maxRagdolls = 12;
  /** Hard cap for auto-population from world.npcSpawns. */
  maxPopulation = 50;
  minPopulation = 30;
  /** Chance that someone who sees Jimothy from behind tries the "here kitty kitty" gag (global 22 s cooldown). */
  kittyChance = 0.55;
  /** Grandma's Hat mutator is on: humans are extra friendly (refreshed every frame). */
  friendly = false;
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
  private roadSegs: number[] = [];
  private roadBoxes: { minX: number; maxX: number; minZ: number; maxZ: number; from: number; to: number }[] = [];
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
    game.events.on('homeRun', (e: { entity?: Entity; impulse?: THREE.Vector3 }) => this.onHomeRun(e));
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
    this.buildRoadIndex();
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
      const types = (sp.types ?? []).flatMap((t) => (t === 'family' ? FAMILY : [t])).filter((t): t is NpcType => (NPC_TYPES as readonly string[]).includes(t));
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

  /** Index world.lanes (car lanes) so wandering humans prefer sidewalks. */
  private buildRoadIndex() {
    const lanes: { points: THREE.Vector3[]; loop: boolean }[] = this.game.get<any>('world')?.lanes ?? [];
    this.roadSegs = [];
    this.roadBoxes = [];
    for (const l of lanes) {
      const pts = l.points;
      if (!pts || pts.length < 2) continue;
      const from = this.roadSegs.length;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      const n = l.loop ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        this.roadSegs.push(a.x, a.z, b.x, b.z);
        minX = Math.min(minX, a.x, b.x);
        maxX = Math.max(maxX, a.x, b.x);
        minZ = Math.min(minZ, a.z, b.z);
        maxZ = Math.max(maxZ, a.z, b.z);
      }
      this.roadBoxes.push({ minX, maxX, minZ, maxZ, from, to: this.roadSegs.length });
    }
  }

  /** Is (x, z) on a car lane (within `margin` m of a lane centerline)? */
  onRoad(x: number, z: number, margin = 4.3): boolean {
    const m2 = margin * margin;
    const S = this.roadSegs;
    for (const bx of this.roadBoxes) {
      if (x < bx.minX - margin || x > bx.maxX + margin || z < bx.minZ - margin || z > bx.maxZ + margin) continue;
      for (let i = bx.from; i < bx.to; i += 4) {
        const ax = S[i], az = S[i + 1], vx = S[i + 2] - ax, vz = S[i + 3] - az;
        const l2 = vx * vx + vz * vz || 1e-6;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
        const dx = ax + vx * t - x;
        const dz = az + vz * t - z;
        if (dx * dx + dz * dz < m2) return true;
      }
    }
    return false;
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

  /** Does any other system listen to this event? (UI speech layer, FX flashes, ...) */
  private othersListen(name: string) {
    const set = (this.game.events as any).map?.get?.(name);
    return !!set && set.size > 0;
  }

  showBubble(npc: Npc, text: string, secs: number) {
    // The UI renders 'speech' events itself when present; ours are the fallback.
    if (!this.drawBubbles || npc.camDist > 40 || this.othersListen('speech')) return;
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
    if (!this.othersListen('cameraFlash')) this.flashes.flash(pos);
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

  onKnockdown(npc: Npc, cause: string, byPlayer: boolean, by?: Entity) {
    const game = this.game;
    const pos = npc.position.clone();
    pos.y += 1.4;
    // (the audio system screams on 'npcRagdoll')
    game.events.emit('npcRagdoll', { entity: npc.entity, cause, npc, byPlayer, by, position: pos.clone() });
    if (cause !== 'script' && cause !== 'faint' && cause !== 'fall') this.alarm(npc.position, 9, cause, npc);
    if (!byPlayer) return;
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
        this.queueHit(npc, { cause: 'ragdoll', dv: _v.clone(), byPlayer: owner.knockByPlayer, by: owner.entity }, J);
      }
      return;
    }
    const vehicle = e?.kind === 'vehicle' || e?.tags.has('vehicle');
    const thrownByPlayer = !!e && (e.data.heldByPlayer || (typeof e.data.thrownAt === 'number' && game.time - e.data.thrownAt < 4));
    // Kinematic walkers make contact impulses unreliable (pushing/crushing a resting prop gives huge J), so judge
    // by the prop's own motion: a capped speed estimate × mass = how much of a wallop it is.
    const speed = Math.min(pre, 15);
    const momentum = m * speed;
    if (thrownByPlayer) {
      if (J < 4 || speed < 2.5) return;
      if (momentum < 8) {
        npc.ouch(); // a phone to the face: rude, but not a knockdown
        return;
      }
    } else {
      const t = ob.translation();
      const tx = t.x - npc.position.x;
      const tz = t.z - npc.position.z;
      const tl = Math.hypot(tx, tz) || 1;
      const walkingInto = (npc.velocity.x * tx + npc.velocity.z * tz) / tl > 0.2;
      if (walkingInto && vAfter < 6) return;
      const incoming = vAfter > 1 && speed > 4 && momentum > 25 && J > 12;
      const juggernaut = m > 150 && vAfter > 2;
      if (!incoming && !juggernaut) return;
    }
    _v.set(lv.x, 0, lv.z);
    if (_v.lengthSq() < 1e-4) {
      // use the separation direction instead
      const t = ob.translation();
      _v.set(npc.position.x - t.x, 0, npc.position.z - t.z);
    }
    const mag = THREE.MathUtils.clamp((pre * m) / 18, 2.5, vehicle ? 16 : 11);
    _v.normalize().multiplyScalar(mag);
    _v.y = 1.5 + mag * 0.35;
    this.queueHit(npc, { cause: vehicle ? 'vehicle' : 'prop', dv: _v.clone(), byPlayer: thrownByPlayer || (vehicle && !!e?.data.drivenByPlayer), by: e }, J);
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
    this.queueHit(npc, { cause: 'vehicle', dv: _v.clone(), byPlayer: !!e.data.drivenByPlayer, by: e }, sp * 100);
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

  /**
   * Rookie mutator: its bat-bonk handler pushes only entity.body (the chest while ragdolled). Launch the whole
   * person with the velocity it meant to give a full body instead of stretching the torso off.
   */
  private onHomeRun(e: { entity?: Entity; impulse?: THREE.Vector3 }) {
    const npc = this.fromEntity(e?.entity);
    const pl = this.player;
    if (!npc || npc.removed || !pl) return;
    if (!npc.ragdolled) npc.knockDown({ cause: 'bonk', byPlayer: true });
    const rd = npc.ragdollState;
    if (!rd) return;
    const M = Math.min(rd.totalMass, 90);
    const imp = e.impulse ?? _v.set(0, 0, 0);
    const f = pl.forwardVec(_w);
    const k = npc.type === 'kid' ? 0.6 : 1;
    const dv = new THREE.Vector3((imp.x * 1.6 + f.x * M * 4) / M, (Math.max(0, imp.y) * 1.2 + M * 7.5) / M, (imp.z * 1.6 + f.z * M * 4) / M).multiplyScalar(k);
    const base = rd.bodies.pelvis.linvel();
    for (const b of Object.values(rd.bodies)) {
      b.setLinvel({ x: base.x + dv.x, y: Math.max(base.y, 0) + dv.y, z: base.z + dv.z }, true);
      b.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
    }
    rd.restTime = 0;
    rd.flail(1.5);
  }

  private onChitter(e: { position: THREE.Vector3 }) {
    const p = e?.position ?? this.player?.position;
    if (!p) return;
    let count = 0;
    for (const n of this.list) {
      const d = Math.hypot(n.position.x - p.x, n.position.z - p.z);
      // quest hook first (works for passive / scripted NPCs too)
      if (n.onInteract && d < 4 && !n.ragdolled && n.onInteract('chitter') === true) continue;
      if (!n.canReact()) continue;
      if (d > 10 || Math.random() > 0.85) continue;
      n.hearChitter(count < 2 && Math.random() < 0.7);
      count++;
    }
    if (count >= 2) this.sfx('crowd_aww', p, 0.6, 1, 2);
    if (count >= 3) this.game.score(30, 'Crowd Pleaser', p.clone());
  }

  /**
   * Items Jimothy set down this frame. The hand-back check runs at the start of the NEXT npcs update, not inside the
   * 'release' event: many systems release-then-consume an item synchronously (chug the stolen espresso, wash away the
   * cotton candy, Mom eats it, a crow takes it...). Handing it back inside the event gave the owner an entity that was
   * destroyed a line later: he "got it back" AND it was consumed, and grabbing him again touched the freed Rapier
   * body, which poisons the physics world (the whole game froze).
   */
  private pendingReleases: Entity[] = [];

  private onRelease(e: { entity: Entity; thrown: boolean }) {
    const ent = e?.entity;
    const pl = this.player;
    if (!ent) return;
    if (e.thrown) {
      if (pl) this.alarm(pl.position, 7, 'throw');
      return;
    }
    if (ent.data?.consumed || !ent.body || !ent.alive) return;
    if (!this.pendingReleases.includes(ent)) this.pendingReleases.push(ent);
  }

  private flushReleases() {
    if (!this.pendingReleases.length) return;
    const list = this.pendingReleases;
    this.pendingReleases = [];
    for (const ent of list) {
      // consumed / destroyed / picked straight back up / already in someone's hand since: nothing to return
      if (!ent.alive || !ent.body || ent.data?.consumed || ent.data?.heldByPlayer || ent.data?.heldByNpc) continue;
      if (this.player?.held?.entity === ent) continue;
      if (!this.game.physics.world.getRigidBody(ent.body.handle)) continue;
      this.returnItem(ent);
    }
  }

  private returnItem(ent: Entity) {
    const t = ent.body!.translation();
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
    // Grandma's Hat: officers mostly let it slide
    if (this.friendly && Math.random() < 0.75) {
      if (Math.random() < 0.05) {
        const o = this.list.find((n) => n.type === 'officer' && n.canReact() && Math.hypot(n.position.x - pl.position.x, n.position.z - pl.position.z) < 15);
        o?.sayLine('charmed', 2.2);
      }
      return;
    }
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
    this.flushReleases();
    this.friendly =!!game.get<any>('mutators')?.get?.('grandmaHat')?.enabled;
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
    // perf: draw / shadow distance follow the quality preset (a 1.75 m person is ~10 px tall at 120 m)
    const q = game.renderer.quality;
    const visD = q === 'low' ? 75 : q === 'medium' ? 100 : 120;
    const shadowD = q === 'low' ? 18 : q === 'medium' ? 26 : 34;
    for (const n of this.list) {
      const root = n.rig.root;
      _v.copy(root.position);
      if (!n.ragdolled) _v.y += 0.9;
      const d = _v.distanceTo(cp);
      n.camDist = d;
      _sphere.center.copy(_v);
      _sphere.radius = n.ragdolled ? 1.6 : 1.3;
      const vis = d < visD && this.frustum.intersectsSphere(_sphere);
      n.visible = vis;
      root.visible = vis;
      const io = n.held?.object;
      if (io) {
        // held items live at scene level: hide/show them with their person (the detail culler owns its own flag)
        if (!vis) {
          if (io.visible) {
            io.visible = false;
            io.userData.npcHidden = true;
          }
        } else if (io.userData.npcHidden) {
          io.visible = true;
          io.userData.npcHidden = false;
        }
      }
      n.rig.mesh.castShadow = d < shadowD;
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
