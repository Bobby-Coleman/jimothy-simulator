import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G } from '../../core/Physics';
import { RaccoonAnimal, damp, dampAngle, WORLD_ONLY } from './Animal';
import { RIGS, type RigPose } from './RaccoonRig';

/**
 * Lost baby raccoons. They sit whimpering ("?") until Jimothy touches / grabs / chitters at them, then follow
 * him in a conga line (CongaLine below), scatter comically if he flops or rolls, and run to Mom at the den.
 */

export type KitState =
  | 'lost' // whimpering at its spot
  | 'found' // joy hop, then joins the line
  | 'follow' // conga line
  | 'dizzy' // just landed from a scatter / toss
  | 'regroup' // running back to its place in line
  | 'held' // being carried by Jimothy
  | 'toMom' // running home
  | 'home'; // safe at the den with Mom

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const KIT_NAMES = ['Pip', 'Bean', 'Nugget', 'Mochi', 'Button'];

export class Kit extends RaccoonAnimal {
  readonly index: number;
  readonly kitName: string;
  readonly lostSpot = new THREE.Vector3();
  /** Place in the conga line (0 = right behind Jimothy). */
  slot = 0;
  line: CongaLine | null = null;
  /** Where to sit at the den (set by the quest). */
  readonly homeSpot = new THREE.Vector3();
  homeYaw = 0;
  /** Point to look at while at home (Mom). */
  readonly homeLook = new THREE.Vector3();
  /** Quest hooks. */
  onFound: ((k: Kit, how: string) => void) | null = null;
  onArrivedHome: ((k: Kit) => void) | null = null;
  private whimperT = 1 + Math.random() * 2;
  private chirpT = 2 + Math.random() * 4;
  private hopPh = Math.random() * 6;
  private hopY = 0;
  private lookT = 0;
  private lookYaw = 0;
  private thrown = false;
  private playT = Math.random() * 10;
  private washCd = 0;
  private stuckT = 0;
  private dodging = false;
  climbing = false;

  constructor(game: Game, index: number, pos: THREE.Vector3, yaw = Math.random() * Math.PI * 2) {
    super(
      game,
      {
        name: 'Lost Kit',
        species: 'kit',
        position: pos,
        yaw,
        ball: 0.18,
        colliderY: 0.18,
        mass: 1.5,
        tags: ['family', 'kit'],
        filter: G.WORLD,
        emoteY: 0.52,
        emoteSize: 0.34,
      },
      RIGS.kit,
    );
    this.index = index;
    this.kitName = KIT_NAMES[(index - 1) % KIT_NAMES.length];
    this.lostSpot.copy(this.pos);
    this.entity.data.size = new THREE.Vector3(0.34, 0.3, 0.5);
    this.entity.data.kitIndex = index;
    this.setState('lost');
  }

  get isLost() {
    return this.state === 'lost';
  }
  override get keepAwake() {
    return this.airborne || this.isFollowing || this.state === 'toMom' || !!this.entity.data.heldByPlayer;
  }
  get isFollowing() {
    return this.state === 'follow' || this.state === 'regroup' || this.state === 'dizzy' || this.state === 'found' || this.state === 'held';
  }
  get isHome() {
    return this.state === 'home' || this.state === 'toMom';
  }

  /** Found by Jimothy (touch / grab / chitter). */
  find(how: string) {
    if (!this.isLost) return;
    this.entity.name = `Kit (${this.kitName})`;
    this.setState('found');
    this.say('exclaim', 1.2);
    this.game.sfx('kit_chirp', this.pos, 0.9, 1.1);
    this.game.sfx('happy', this.pos, 0.5, 1.7);
    this.hearts(4);
    this.onFound?.(this, how);
  }

  /** Scatter away from a point (Jimothy flopped / rolled). */
  scatter(from: THREE.Vector3) {
    if (!(this.state === 'follow' || this.state === 'regroup' || this.state === 'found')) return;
    const dir = _v.set(this.pos.x - from.x, 0, this.pos.z - from.z);
    if (dir.lengthSq() < 0.01) dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.4);
    const sp = 2.2 + Math.random() * 2;
    this.launch(new THREE.Vector3(dir.x * sp, 3.6 + Math.random() * 1.8, dir.z * sp), 9 + Math.random() * 6);
    this.setState('dizzy');
    this.game.sfx('squeak', this.pos, 0.55, 1.5 + Math.random() * 0.3);
    this.say('exclaim', 0.9);
  }

  /** Send home to Mom (optionally through `via`, e.g. the den entrance, when the way in isn't straight). */
  goHome(spot: THREE.Vector3, yaw: number, look: THREE.Vector3, via?: THREE.Vector3) {
    this.homeSpot.copy(spot);
    this.homeYaw = yaw;
    this.homeLook.copy(look);
    this.via = via ? via.clone() : null;
    this.progressT = 0;
    this.bestD = Infinity;
    if (this.entity.data.heldByPlayer) this.player?.release(false);
    this.line?.remove(this);
    this.entity.name = `Kit (${this.kitName})`;
    this.setState('toMom');
  }

  private via: THREE.Vector3 | null = null;
  private progressT = 0;
  private bestD = Infinity;

  /** Clear straight path (static world) from us to p? */
  private canSee(p: THREE.Vector3) {
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 0.2, this.pos.z);
    const dir = new THREE.Vector3(p.x - from.x, 0, p.z - from.z);
    const len = dir.length();
    if (len < 0.05) return true;
    return !this.game.physics.raycast(from, dir, len, WORLD_ONLY);
  }

  /** Instantly at home (restored from a save). */
  settleHome(spot: THREE.Vector3, yaw: number, look: THREE.Vector3) {
    this.homeSpot.copy(spot);
    this.homeYaw = yaw;
    this.homeLook.copy(look);
    this.line?.remove(this);
    this.entity.name = `Kit (${this.kitName})`;
    this.place(spot, yaw);
    this.setState('home');
  }

  // ------------------------------------------------------------------------------------------- behaviour
  protected think(dt: number) {
    const game = this.game;
    const player = this.player;
    this.washCd -= dt;

    // Carried by Jimothy? The player drives the body; we just ride along.
    if (this.entity.data.heldByPlayer) {
      if (this.state !== 'held') {
        this.setState('held');
        this.say('heart', 1.5);
        game.sfx('kit_chirp', this.pos, 0.7, 1.2);
      }
      return;
    }
    // Just released (the player flips the body back to dynamic): take over with a cartoon arc
    if (this.body && this.body.isDynamic()) {
      const lv = this.body.linvel();
      const v = new THREE.Vector3(lv.x, lv.y, lv.z);
      const hs = Math.hypot(v.x, v.z);
      if (hs > 5) v.multiplyScalar(5 / hs);
      v.y = THREE.MathUtils.clamp(v.y, 1.5, 6.5);
      const t = this.body.translation();
      this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      this.pos.set(t.x, t.y - this.cfg.colliderY, t.z);
      this.launch(v, this.thrown ? 11 : 0);
      if (this.thrown) {
        this.say('Wheee!', 1.4);
        game.sfx('kit_chirp', this.pos, 0.9, 1.35);
      }
      this.setState('dizzy');
      return;
    }

    switch (this.state) {
      case 'lost':
        this.thinkLost(dt);
        break;
      case 'found':
        this.snapToGround(dt);
        if (player) this.turnToward(this.yawTo(player.position), dt, 8);
        if (this.stateTime > 0.9) this.setState(this.line ? 'regroup' : 'follow');
        break;
      case 'dizzy':
        this.snapToGround(dt);
        if (this.stateTime > 0.9) {
          this.setState(this.line ? 'regroup' : this.homeSpot.lengthSq() > 0 ? 'toMom' : 'follow');
          if (this.thrown) this.hearts(3);
          this.thrown = false;
        }
        break;
      case 'regroup':
        this.thinkRegroup(dt);
        break;
      case 'follow':
        this.thinkFollow(dt);
        break;
      case 'held':
        // released without flipping to dynamic (e.g. the grab was a drag): continue following
        this.setState(this.line ? 'regroup' : 'follow');
        break;
      case 'toMom': {
        // go round through the entrance if the way in isn't straight
        if (this.via && (this.canSee(this.homeSpot) || Math.hypot(this.pos.x - this.via.x, this.pos.z - this.via.z) < 0.35)) this.via = null;
        const goal = this.via ?? this.homeSpot;
        const d = this.walkToward(goal, 4.2, dt, 10, 0.05);
        this.hopPh += dt * 13;
        // stuck on something? hop the rest of the way (with a little sparkle)
        const dh = Math.hypot(this.pos.x - this.homeSpot.x, this.pos.z - this.homeSpot.z);
        if (dh < this.bestD - 0.05) {
          this.bestD = dh;
          this.progressT = 0;
        } else this.progressT += dt;
        const arrived = !this.via && d < 0.12;
        if (arrived || this.progressT > 2.5 || this.stateTime > 12) {
          if (!arrived) {
            this.game.events.emit('sparkle', { position: this.pos.clone() });
            this.place(this.homeSpot, this.homeYaw);
          }
          this.setState('home');
          this.onArrivedHome?.(this);
        }
        break;
      }
      case 'home':
        this.thinkHome(dt);
        break;
    }
  }

  private thinkLost(dt: number) {
    const game = this.game;
    this.snapToGround(dt);
    const d = this.distToPlayer();
    this.whimperT -= dt * (d < 14 ? 1.6 : 1);
    if (this.whimperT <= 0) {
      this.whimperT = 2.6 + Math.random() * 2.4;
      if (d < 70) {
        this.say('question', 2.2);
        game.sfx('squeak', this.pos, 0.4, 1.7 + Math.random() * 0.25);
        if (Math.random() < 0.6) game.sfx('kit_chirp', this.pos, 0.55, 0.9);
      }
    }
    // look around for Mom; toward Jimothy when he's near
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 1 + Math.random() * 2;
      this.lookYaw = (Math.random() - 0.5) * 2;
    }
    if (d < 10 && this.player) this.lookYaw = THREE.MathUtils.clamp(this.lookAngleTo(this.player.position), -1.2, 1.2);
    // touch (same level — a kit on a roof isn't found from the street below)
    if (d < 1.15 && this.player && Math.abs(this.player.position.y - 0.38 - this.pos.y) < 1.2) this.find('touch');
  }

  private linePoint(out: THREE.Vector3) {
    if (!this.line) return null;
    return this.line.slotPoint(this.slot, out);
  }

  private thinkFollow(dt: number) {
    const target = this.linePoint(_v);
    if (!target) {
      this.snapToGround(dt);
      return;
    }
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dh = Math.hypot(dx, dz);
    const dy = target.y - this.pos.y;
    // Too far behind (Jimothy teleported / rode a car / fell): poof, catch up
    if (dh > 25 || Math.abs(dy) > 12) {
      this.catchUp(target);
      return;
    }
    const maxSp = 11;
    const sp = Math.min(maxSp, dh * 7 + 0.5);
    const step = Math.min(dh, sp * dt);
    if (dh > 0.002) {
      const want = Math.atan2(dx, dz);
      this.yaw = dampAngle(this.yaw, want, dh > 0.05 ? 14 : 3, dt);
      this.pos.x += (dx / dh) * step;
      this.pos.z += (dz / dh) * step;
    }
    // Height: follow the trail (jumps, climbs) but never sink into the ground
    const g = this.groundAt(this.pos.x, this.pos.z, Math.max(this.pos.y, target.y) + 1.0);
    this.climbing = dy > 0.6 && dh < 1.2;
    const ty = Math.max(target.y, g);
    this.pos.y = damp(this.pos.y, ty, this.climbing ? 8 : 16, dt);
    if (this.pos.y < g) this.pos.y = g;
    // Stuck behind something for a long time → catch up
    this.stuckT = dh > 3 ? this.stuckT + dt : 0;
    if (this.stuckT > 4) this.catchUp(target);
    this.hopPh += step * 9;
  }

  private thinkRegroup(dt: number) {
    const target = this.linePoint(_v);
    if (!target) {
      this.setState('follow');
      return;
    }
    const d = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    if (d > 25) {
      this.catchUp(target);
      return;
    }
    this.walkToward(target, 6.5, dt, 12, 0.02);
    this.hopPh += dt * 16;
    if (d < 0.55 || this.stateTime > 6) this.setState('follow');
  }

  private catchUp(target: THREE.Vector3) {
    this.game.events.emit('sparkle', { position: this.pos.clone() });
    this.place(_v2.copy(target), undefined, true);
    this.pos.y = Math.max(target.y, this.groundAt(target.x, target.z, target.y + 1.2));
    this.game.events.emit('sparkle', { position: this.pos.clone() });
    this.game.sfx('kit_chirp', this.pos, 0.5, 1.3);
    this.stuckT = 0;
    this.setState('follow');
  }

  private thinkHome(dt: number) {
    const env = this.game.get<any>('environment');
    const night = !!env?.isNight;
    this.playT += dt;
    if (night) {
      // playtime: little hops in a circle around the home spot, chasing each other
      const a = this.playT * 0.9 + this.index * ((Math.PI * 2) / 5);
      const r = 0.24 + 0.14 * Math.sin(this.playT * 0.7 + this.index);
      const target = _v.set(this.homeSpot.x + Math.cos(a) * r, this.homeSpot.y, this.homeSpot.z + Math.sin(a) * r);
      this.walkToward(target, 1.6, dt, 10, 0.02);
      this.hopPh += dt * 10;
    } else {
      // nap time: back to the spot next to Mom
      const d = this.walkToward(this.homeSpot, 1.4, dt, 8, 0.05);
      if (d < 0.1) this.turnToward(this.homeYaw, dt, 3);
    }
    this.chirpT -= dt;
    if (this.chirpT <= 0) {
      this.chirpT = 4 + Math.random() * 6;
      if (night && this.distToPlayer() < 20) this.game.sfx('kit_chirp', this.pos, 0.35, 1.2);
    }
  }

  // ------------------------------------------------------------------------------------------- reactions
  protected handleGrab(): boolean | void | Entity {
    if (this.airborne || this.state === 'toMom') return false;
    if (this.isLost) this.find('grab');
    // Become dynamic so Grabby Hands carries us (the player makes held things kinematic itself)
    if (this.body && !this.body.isDynamic()) {
      const t = this.body.translation();
      this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      this.body.setTranslation(t, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.thrown = false;
    return true;
  }

  protected handleRelease(thrown: boolean) {
    this.thrown = thrown;
  }

  protected handleBonk(impulse: THREE.Vector3) {
    if (!this.isPlayerBonk()) {
      // a car (or some other chaos): hop out of the way, never "found" by it
      if (!this.entity.data.heldByPlayer && this.state !== 'toMom') {
        this.dodging = true;
        this.dodge(impulse);
      }
      return;
    }
    if (this.airborne || this.state === 'home' || this.state === 'toMom') {
      if (this.state === 'home') {
        this.say('heart', 1.2);
        this.game.sfx('kit_chirp', this.pos, 0.6, 1.3);
      }
      return;
    }
    if (this.isLost) this.find('bonk');
    const h = _v.set(impulse.x, 0, impulse.z);
    if (h.lengthSq() < 1e-4) h.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    h.normalize().multiplyScalar(2.2);
    this.launch(new THREE.Vector3(h.x, 3.2, h.z), 10);
    this.setState('dizzy');
    this.game.sfx('kit_chirp', this.pos, 0.8, 1.45);
    this.say('Hee hee!', 1.2);
  }

  protected handleWash() {
    if (this.washCd > 0) return;
    this.washCd = 1.2;
    const n = (this.entity.data.washCount = (this.entity.data.washCount ?? 0) + 1);
    this.entity.data.washed = true;
    this.say(n === 1 ? 'Squeaky clean!' : 'heart', 1.6);
    this.hearts(5);
    this.game.events.emit('sparkle', { entity: this.entity, position: this.pos.clone() });
    this.game.sfx('kit_chirp', this.pos, 0.8, 1.25);
    this.game.score(n === 1 ? 60 : 10, n === 1 ? 'Bath Time For Baby' : 'Extra Bubbly Baby', this.pos.clone());
  }

  protected onLanded() {
    if (this.dodging) {
      this.dodging = false;
      if (this.state === 'lost') this.lostSpot.copy(this.pos);
      return;
    }
    this.recover = 1;
    this.say(this.thrown ? 'heart' : 'dizzy', 0.9);
  }

  // ------------------------------------------------------------------------------------------- animation
  protected animatePose(dt: number, p: RigPose) {
    const game = this.game;
    const t = game.time;
    this.recover = Math.max(0, this.recover - dt * 1.4);
    p.tailWag = 0.5;
    const player = this.player;
    const moving = this.speed > 0.25;
    // visual hop while moving
    const hopAmt = moving && !this.airborne ? Math.min(1, this.speed / 2) : 0;
    const targetHop = hopAmt * Math.abs(Math.sin(this.hopPh)) * 0.1;
    this.hopY = damp(this.hopY, targetHop, 25, dt);
    this.rig.pivot.position.y = this.rig.spec.centerY * this.rig.spec.scale + this.hopY;

    switch (this.state) {
      case 'lost': {
        p.sit = 1;
        p.lookYaw = this.lookYaw;
        p.lookPitch = -0.15;
        p.earsBack = 0.45;
        p.tailUp = -0.4;
        p.tailWag = 0.1;
        // shivery little whimper
        p.tilt = Math.sin(t * 2.3 + this.index) * 0.15;
        p.shake = 0.08;
        break;
      }
      case 'found':
        p.stand = 0.6 + 0.4 * Math.abs(Math.sin(this.stateTime * 9));
        p.happy = 1;
        p.tailWag = 1;
        p.tailUp = 0.6;
        this.rig.pivot.position.y += Math.abs(Math.sin(this.stateTime * 9)) * 0.12;
        break;
      case 'held':
        p.flail = 0.25;
        p.happy = 0.8;
        p.tailWag = 1;
        p.lookPitch = 0.2;
        break;
      case 'home': {
        const env = game.get<any>('environment');
        if (env?.isNight) {
          p.hop = moving ? 1 : 0;
          p.happy = 0.5;
          p.tailWag = 0.9;
          p.tailUp = 0.5;
          if (!moving) p.sit = 1;
        } else {
          p.lie = 1;
          p.eyes = 0;
          p.tailWag = 0.05;
          if (Math.floor(t / 7 + this.index) % 5 === 0 && this.emote.showing === '') this.say('zzz', 2);
        }
        if (player && this.distToPlayer() < 3 && env?.isNight) p.lookYaw = this.lookAngleTo(player.position);
        break;
      }
      default: {
        if (moving) {
          p.hop = 1;
          p.tailUp = 0.3;
          p.happy = 0.3;
          if (this.swimming) {
            p.hop = 0;
            p.paddle = 1;
          }
        } else {
          p.sit = 1;
          p.tailWag = 0.8;
          p.happy = 0.2;
          if (player) {
            p.lookYaw = this.lookAngleTo(player.position);
            p.lookPitch = -0.25;
          }
        }
        // climbing up after Jimothy: tilt nose-up
        this.pitch = damp(this.pitch, this.climbing ? -1.1 : 0, 10, dt);
      }
    }
    if (this.state !== 'follow' && this.state !== 'regroup') this.pitch = damp(this.pitch, 0, 10, dt);
    this.poseRecover(p);
  }
}

// ================================================================================================ conga line

/**
 * Breadcrumb trail of Jimothy's footsteps; kit i sits at arc-length gap0 + i * gap behind him, so the kits
 * follow his exact path (over benches, through puddles, up walls) like ducklings.
 */
export class CongaLine {
  readonly game: Game;
  readonly members: Kit[] = [];
  /** Trail points, newest first (ground-level: player centre minus radius). */
  private pts: THREE.Vector3[] = [];
  private cum: number[] = [];
  spacing = 0.12;
  gap0 = 1.0;
  gap = 0.78;
  private lastFacing = 0;

  constructor(game: Game) {
    this.game = game;
  }

  add(k: Kit) {
    if (this.members.includes(k)) return;
    this.members.push(k);
    k.line = this;
    this.reslot();
  }

  remove(k: Kit) {
    const i = this.members.indexOf(k);
    if (i >= 0) this.members.splice(i, 1);
    if (k.line === this) k.line = null;
    this.reslot();
  }

  private reslot() {
    this.members.forEach((m, i) => (m.slot = i));
  }

  private foot(out: THREE.Vector3) {
    const p = this.game.get<any>('player');
    if (!p) return null;
    const r = 0.38 * (p.sizeMul ?? 1);
    return out.set(p.position.x, p.position.y - r, p.position.z);
  }

  get length() {
    return this.cum.length ? this.cum[this.cum.length - 1] : 0;
  }

  update() {
    const p = this.game.get<any>('player');
    const f = this.foot(_v);
    if (!p || !f) return;
    this.lastFacing = p.facing ?? this.lastFacing;
    const head = this.pts[0];
    if (!head) {
      this.reset();
      return;
    }
    const dh = Math.hypot(f.x - head.x, f.z - head.z);
    if (dh > 8 || Math.abs(f.y - head.y) > 8) {
      // teleported: start a fresh trail behind him
      this.reset();
      return;
    }
    if (dh >= this.spacing) {
      this.pts.unshift(f.clone());
      // recompute cumulative lengths (short arrays; cheap)
      this.recompute();
    }
    const maxLen = this.gap0 + this.gap * Math.max(1, this.members.length) + 3;
    while (this.pts.length > 2 && this.cum[this.cum.length - 2] > maxLen) {
      this.pts.pop();
      this.cum.pop();
    }
  }

  private recompute() {
    const c = this.cum;
    c.length = this.pts.length;
    c[0] = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      c[i] = c[i - 1] + Math.hypot(a.x - b.x, a.z - b.z);
    }
  }

  /** Fill the trail with a straight line behind Jimothy (after a teleport / on creation). */
  reset() {
    const f = this.foot(_v2);
    if (!f) return;
    const fx = -Math.sin(this.lastFacing);
    const fz = -Math.cos(this.lastFacing);
    this.pts = [];
    const n = Math.ceil((this.gap0 + this.gap * 6 + 2) / this.spacing);
    for (let i = 0; i < n; i++) {
      const x = f.x + fx * i * this.spacing;
      const z = f.z + fz * i * this.spacing;
      const world = this.game.get<any>('world');
      // keep the fake trail on the ground behind him
      let y = f.y;
      const gy = world?.heightAt?.(x, z);
      if (typeof gy === 'number' && Math.abs(gy - f.y) < 1.2) y = Math.max(f.y - 0.5, gy);
      this.pts.push(new THREE.Vector3(x, y, z));
    }
    this.recompute();
  }

  /** Point on the trail at arc distance s behind Jimothy. */
  sample(s: number, out: THREE.Vector3): THREE.Vector3 | null {
    const pts = this.pts;
    if (!pts.length) return null;
    const c = this.cum;
    if (s <= 0) return out.copy(pts[0]);
    for (let i = 1; i < pts.length; i++) {
      if (c[i] >= s) {
        const seg = c[i] - c[i - 1];
        const k = seg > 1e-6 ? (s - c[i - 1]) / seg : 0;
        return out.copy(pts[i - 1]).lerp(pts[i], k);
      }
    }
    // beyond the recorded trail: extend straight back from the tail end
    const last = pts[pts.length - 1];
    const prev = pts[Math.max(0, pts.length - 2)];
    const extra = s - c[c.length - 1];
    const dx = last.x - prev.x;
    const dz = last.z - prev.z;
    const dl = Math.hypot(dx, dz) || 1;
    return out.set(last.x + (dx / dl) * extra, last.y, last.z + (dz / dl) * extra);
  }

  slotPoint(slot: number, out: THREE.Vector3) {
    return this.sample(this.gap0 + slot * this.gap, out);
  }

  /** Everyone jumps away from `from` (Jimothy flopped / started rolling). */
  scatter(from: THREE.Vector3) {
    for (const k of this.members) k.scatter(from);
  }
}
