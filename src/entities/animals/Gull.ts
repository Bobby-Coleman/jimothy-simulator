import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G } from '../../core/Physics';
import { Animal, damp, dampAngle, wrapAngle, WORLD_ONLY } from './Animal';
import type { AnimalSystem } from './AnimalSystem';

/**
 * Waterfront seagulls ("Seagulls with attitude", says the sign). A few loaf on the promenade railing and the piers,
 * glaring at Jimothy. Unlike the crows they don't flee: they can be grabbed and thrown, or bonked off their perch.
 * Land one in Salmon Bay and it splashes down, bobs up furious, complains, and flies back to its spot (the
 * "Return From Whence You Came" Instinct; see Animal.checkToss / 'animalSplash'). Always fine. Always offended.
 *
 * Spawned by GullSystem ('gulls') once the waterfront colliders exist.
 */

// ================================================================================================ model

interface GullParts {
  root: THREE.Group;
  pivot: THREE.Group;
  head: THREE.Group;
  wingL: THREE.Group;
  wingR: THREE.Group;
  legs: THREE.Object3D;
}

let mats: { white: THREE.Material; grey: THREE.Material; black: THREE.Material; beak: THREE.Material; red: THREE.Material; leg: THREE.Material; eye: THREE.Material; sphere: THREE.BufferGeometry; box: THREE.BufferGeometry } | null = null;

function shared() {
  if (mats) return mats;
  mats = {
    white: new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.6, name: 'GullWhite' }),
    grey: new THREE.MeshStandardMaterial({ color: 0xa3afbb, roughness: 0.55, name: 'GullGrey' }),
    black: new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.5 }),
    beak: new THREE.MeshStandardMaterial({ color: 0xf2c12e, roughness: 0.4 }),
    red: new THREE.MeshStandardMaterial({ color: 0xd8322a, roughness: 0.4 }),
    leg: new THREE.MeshStandardMaterial({ color: 0xf0a060, roughness: 0.6 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.15 }),
    sphere: new THREE.SphereGeometry(1, 12, 9),
    box: new THREE.BoxGeometry(1, 1, 1),
  };
  return mats;
}

/** Forward is +Z; the root sits at the feet, `pivot` at the body centre (tumbles spin around it). */
function buildGull(): GullParts {
  const S = shared();
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], scale: [number, number, number], rot?: [number, number, number]) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(...pos);
    o.scale.set(...scale);
    if (rot) o.rotation.set(...rot);
    o.castShadow = true;
    return o;
  };
  const root = new THREE.Group();
  root.name = 'Seagull';
  const pivot = new THREE.Group();
  pivot.position.y = 0.2;
  root.add(pivot);
  pivot.add(part(S.sphere, S.white, [0, 0, 0], [0.12, 0.115, 0.22]));
  pivot.add(part(S.sphere, S.grey, [0, 0.055, -0.03], [0.112, 0.065, 0.18]));
  pivot.add(part(S.box, S.black, [0, 0.03, -0.25], [0.1, 0.025, 0.1], [0.25, 0, 0]));
  const head = new THREE.Group();
  head.position.set(0, 0.12, 0.17);
  head.add(part(S.sphere, S.white, [0, 0, 0], [0.085, 0.085, 0.09]));
  head.add(part(S.box, S.beak, [0, -0.012, 0.1], [0.032, 0.03, 0.1]));
  head.add(part(S.box, S.red, [0, -0.028, 0.13], [0.02, 0.012, 0.02]));
  for (const s of [-1, 1]) {
    head.add(part(S.sphere, S.eye, [s * 0.052, 0.02, 0.052], [0.014, 0.014, 0.014]));
    // the attitude: a permanent scowl
    head.add(part(S.box, S.black, [s * 0.047, 0.047, 0.06], [0.05, 0.012, 0.014], [0, 0, s * 0.45]));
  }
  pivot.add(head);
  const wing = (s: number) => {
    const w = new THREE.Group();
    w.position.set(s * 0.095, 0.05, 0.02);
    w.add(part(S.box, S.grey, [s * 0.15, 0, 0], [0.3, 0.02, 0.15]));
    w.add(part(S.box, S.black, [s * 0.34, 0, -0.02], [0.1, 0.021, 0.11]));
    pivot.add(w);
    return w;
  };
  const wingL = wing(1);
  const wingR = wing(-1);
  const legs = new THREE.Group();
  for (const s of [-1, 1]) {
    legs.add(part(S.box, S.leg, [s * 0.04, -0.14, 0.02], [0.016, 0.12, 0.016]));
    legs.add(part(S.box, S.leg, [s * 0.04, -0.195, 0.045], [0.04, 0.01, 0.06]));
  }
  pivot.add(legs);
  root.scale.setScalar(1.1);
  return { root, pivot, head, wingL, wingR, legs };
}

// ================================================================================================ gull

const THROWN_LINES = ['SQUAWK?!', 'Put me DOWN!', 'Unhand me!', 'This is assault. With a raccoon.'];
const SPLASH_LINES = [
  'Whence?! I came from the PARKING LOT!',
  'I live here. That is NOT the point.',
  "I'm telling the pelicans.",
  'Unbelievable. Un. Be. Lievable.',
  'My feathers were DONE today!',
  'Oh, real mature.',
  "I'm fine. I'm FINE. Don't look at me.",
];
const GLARE_LINES = ['...', 'What.', 'You got a problem, pal?', 'Nice fries. Shame if someone took them.'];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _id = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

type GullState = 'perch' | 'held' | 'tossed' | 'dizzy' | 'splash' | 'fly';

export class Gull extends Animal {
  readonly parts: GullParts;
  /** Where it loafs (feet position) and its sulky resting yaw. */
  readonly home = new THREE.Vector3();
  readonly homeYaw: number;
  /** The perch is up on something (railing, bollard): no ground snapping there. */
  private readonly highPerch: boolean;
  private flying = false;
  private flapPh = Math.random() * 10;
  private flapAmt = 0;
  private bank = 0;
  private bodyPitch = 0;
  private headYaw = 0;
  private nextAct = 1 + Math.random() * 2;
  private glareCd = 0;
  private washCd = 0;
  private surfaceY = 0;
  private flyPhase = 0;
  private circleA = 0;
  private splashes = 0;

  constructor(game: Game, home: THREE.Vector3, yaw: number, highPerch: boolean) {
    super(game, {
      name: 'Seagull',
      species: 'gull',
      position: home,
      yaw,
      ball: 0.2,
      colliderY: 0.2,
      mass: 1,
      tags: ['bird', 'seagull'],
      filter: G.WORLD,
      emoteY: 0.62,
      emoteSize: 0.3,
    });
    this.home.copy(home);
    this.homeYaw = yaw;
    this.highPerch = highPerch;
    this.parts = buildGull();
    game.scene.add(this.parts.root);
    this.setupPhysics(this.parts.root);
    this.entity.data.size = new THREE.Vector3(0.3, 0.3, 0.45);
    this.noGround = highPerch;
    this.place(home, yaw, highPerch);
    this.setState('perch');
  }

  override get keepAwake() {
    return this.airborne || this.flying || this.state !== 'perch' || !!this.entity.data.heldByPlayer;
  }

  /** How many times this gull has been returned to the sea (for tests / curiosity). */
  get timesSplashed() {
    return this.splashes;
  }

  squawk(pitch = 1) {
    this.game.sfx('seagull', this.pos, 0.75, pitch * (0.95 + Math.random() * 0.15));
  }

  // ------------------------------------------------------------------------------------------- behaviour
  protected think(dt: number) {
    this.washCd -= dt;
    this.glareCd -= dt;
    // Carried by Jimothy: the player drives the body; we flap and protest.
    if (this.entity.data.heldByPlayer) {
      if (this.state !== 'held') {
        this.setState('held');
        this.flying = false;
        this.squawk(1.15);
        this.say(pick(THROWN_LINES), 1.4);
      }
      return;
    }
    // Just released (the player flips the body to dynamic): take over with a cartoon arc.
    if (this.body && this.body.isDynamic()) {
      const lv = this.body.linvel();
      const v = new THREE.Vector3(lv.x, lv.y, lv.z);
      const hs = Math.hypot(v.x, v.z);
      if (hs > 12) v.multiplyScalar(12 / hs);
      v.y = THREE.MathUtils.clamp(v.y, -2, 9);
      const t = this.body.translation();
      this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      this.pos.set(t.x, t.y - this.cfg.colliderY, t.z);
      this.flying = false;
      this.noGround = false;
      const hard = v.length() > 4;
      this.launch(v, hard ? 12 : 0);
      if (hard) this.squawk(1.3);
      this.setState('tossed');
      return;
    }

    switch (this.state as GullState) {
      case 'perch':
        this.thinkPerch(dt);
        break;
      case 'held':
      case 'tossed':
        // released without a toss (or a tumble that ended without a landing callback)
        this.setState('dizzy');
        break;
      case 'dizzy':
        if (!this.noGround) this.snapToGround(dt, 30);
        if (this.swimming) {
          this.splashDown(null);
          break;
        }
        if (this.stateTime > 1.2) this.takeOff(false);
        break;
      case 'splash': {
        // bob at the surface, fuming
        this.pos.y = this.surfaceY - 0.21 + Math.sin(this.stateTime * 6) * 0.03;
        this.yaw += Math.sin(this.stateTime * 2.2) * dt * 0.8;
        if (this.stateTime > 0.7 && this.stateTime - dt <= 0.7) {
          this.say(pick(SPLASH_LINES), 2.2);
          this.squawk(0.85);
        }
        if (this.stateTime > 2.8) {
          this.game.events.emit('splash', { position: this.pos.clone(), strength: 3 });
          this.takeOff(true);
        }
        break;
      }
      case 'fly':
        this.thinkFly(dt);
        break;
    }
  }

  private thinkPerch(dt: number) {
    if (this.pos.distanceToSquared(this.home) > 0.3 * 0.3) {
      this.takeOff(false);
      return;
    }
    if (this.highPerch) this.pos.copy(this.home);
    else this.snapToGround(dt, 30);
    const pl = this.player;
    const d = this.distToPlayer();
    if (pl && d < 3.2) {
      // glare at the raccoon
      this.turnToward(this.yawTo(pl.position), dt, 4);
      if (this.glareCd <= 0) {
        this.glareCd = 7 + Math.random() * 5;
        if (Math.random() < 0.5) this.say('grumpy', 1.2);
        else this.say(pick(GLARE_LINES), 1.6);
        if (Math.random() < 0.6) this.squawk(1.05);
      }
    } else this.turnToward(this.homeYaw, dt, 1.5);
    this.nextAct -= dt;
    if (this.nextAct <= 0) {
      this.nextAct = 1.5 + Math.random() * 3;
      this.headYaw = (Math.random() - 0.5) * 1.8;
      if (d < 25 && Math.random() < 0.25) this.squawk();
    }
  }

  private takeOff(fromWater: boolean) {
    this.flying = true;
    this.noGround = true;
    this.airborne = false;
    this.vel.set(0, fromWater ? 4.5 : 3.2, 0);
    this.flyPhase = 0;
    this.circleA = Math.atan2(this.pos.z - this.home.z, this.pos.x - this.home.x);
    this.setState('fly');
    this.game.sfx('whoosh', this.pos, 0.25, 1.5);
  }

  /** Flap up, one indignant lap over the water, then back to the perch. */
  private thinkFly(dt: number) {
    const home = this.home;
    if (this.flyPhase === 0) {
      // climb and circle out over the bay for a moment
      this.circleA += dt * 1.1;
      const t = _v2.set(home.x + Math.cos(this.circleA) * 5, home.y + 5, home.z + 4 + Math.sin(this.circleA) * 3);
      this.fly(dt, t, 6);
      if (this.stateTime > 2.2) this.flyPhase = 1;
    } else if (this.flyPhase === 1) {
      const d = this.fly(dt, _v2.copy(home).setY(home.y + 1.4), 6, 2.5);
      if (d < 0.5) this.flyPhase = 2;
    } else {
      const d = this.fly(dt, home, 2.5, 1);
      if (d < 0.12) this.perchDown();
    }
    if (this.stateTime > 18) this.perchDown(); // stuck somewhere: pop home
  }

  private perchDown() {
    this.flying = false;
    this.place(this.home, undefined, this.highPerch);
    this.noGround = this.highPerch;
    this.bank = 0;
    this.bodyPitch = 0;
    this.setState('perch');
    this.game.sfx('whoosh', this.pos, 0.12, 2);
  }

  private fly(dt: number, target: THREE.Vector3, speed: number, arrive = 1.5): number {
    const d = _v.copy(target).sub(this.pos);
    const dist = d.length();
    const want = Math.min(speed, dist * (speed / arrive) + 0.3);
    if (dist > 1e-4) d.multiplyScalar(want / dist);
    this.vel.lerp(d, 1 - Math.exp(-dt * 3.5));
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 1) {
      const hit = this.game.physics.raycast(this.pos, _v2.set(this.vel.x, 0, this.vel.z), Math.min(3, hs * 0.6), WORLD_ONLY);
      if (hit) this.vel.y = Math.max(this.vel.y, 3.5);
    }
    this.pos.addScaledVector(this.vel, dt);
    const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
    if (this.pos.y < g + 0.05 && dist > 0.4) {
      this.pos.y = g + 0.05;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    if (hs > 0.3) {
      const newYaw = Math.atan2(this.vel.x, this.vel.z);
      const turn = wrapAngle(newYaw - this.yaw);
      this.yaw = dampAngle(this.yaw, newYaw, 5, dt);
      this.bank = damp(this.bank, THREE.MathUtils.clamp(-turn * 2, -0.7, 0.7), 5, dt);
    } else if (dist < 1) this.yaw = dampAngle(this.yaw, this.homeYaw, 4, dt);
    this.bodyPitch = damp(this.bodyPitch, THREE.MathUtils.clamp(-this.vel.y * 0.08, -0.5, 0.5), 5, dt);
    this.flapAmt = damp(this.flapAmt, this.vel.y > -0.5 || speed < 3 ? 1 : 0.2, 6, dt);
    this.flapPh += dt * (this.vel.y > 0.5 ? 18 : 11);
    return dist;
  }

  /** Into the drink: splash, sink a little, bob up furious. */
  private splashDown(vol: { surfaceY: number } | null) {
    const surf = vol?.surfaceY ?? this.game.get<any>('water')?.volumeAt?.(_v.set(this.pos.x, this.pos.y + 0.05, this.pos.z))?.surfaceY ?? this.pos.y;
    const strength = Math.max(6, Math.abs(this.vel.y) + 2);
    this.airborne = false;
    this.flying = false;
    this.noGround = true;
    this.vel.set(0, 0, 0);
    this.spinRate = 0;
    this.surfaceY = surf;
    this.pos.y = surf - 0.3;
    this.splashes++;
    this.setState('splash');
    this.game.events.emit('splash', { position: new THREE.Vector3(this.pos.x, surf, this.pos.z), strength });
    this.say('dizzy', 0.7);
  }

  /**
   * Ballistic flight with two cartoon tweaks: flapping clears low rails and deck edges instead of bouncing off them
   * (throws from the promenade go over the railing), and water is a splash-down instead of a skip off the surface.
   */
  protected override updateBallistic(dt: number) {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.05) {
      const dir = _v2.set(this.vel.x / hs, 0, this.vel.z / hs);
      const r = this.cfg.ball ?? 0.2;
      const from = _v.copy(this.pos).setY(this.pos.y + this.cfg.colliderY);
      const hit = this.game.physics.raycast(from, dir, r + hs * dt + 0.02, WORLD_ONLY);
      if (hit && Math.abs(hit.normal.y) < 0.6) {
        // the obstacle's top just past its face (rails are only 10 cm thick, so probe close in first)
        let topY = -Infinity;
        for (const k of [0.03, 0.08, 0.16]) {
          const probe = new THREE.Vector3(hit.point.x + dir.x * k, from.y + 0.9, hit.point.z + dir.z * k);
          const top = this.game.physics.raycast(probe, DOWN, 1.6, WORLD_ONLY);
          if (top && top.distance > 0.01 && top.point.y > hit.point.y) topY = Math.max(topY, top.point.y);
        }
        if (topY > this.pos.y && topY - this.pos.y < 0.95) {
          this.pos.y = topY + 0.02;
          this.vel.y = Math.max(this.vel.y, 2.5);
        }
      }
    }
    super.updateBallistic(dt);
    if (!this.alive || this.state === 'splash') return;
    const vol = this.game.get<any>('water')?.volumeAt?.(_v.set(this.pos.x, this.pos.y + 0.05, this.pos.z));
    if (vol && this.pos.y <= vol.surfaceY + 0.05) this.splashDown(vol);
  }

  // ------------------------------------------------------------------------------------------- reactions
  protected handleGrab(): boolean | void | Entity {
    if (this.flying || this.airborne) {
      this.say('grumpy', 0.8);
      return false;
    }
    // Become dynamic so Grabby Hands carries us (the player makes held things kinematic itself)
    if (this.body && !this.body.isDynamic()) {
      const t = this.body.translation();
      this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      this.body.setTranslation(t, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    return true;
  }

  protected handleBonk(impulse: THREE.Vector3) {
    if (this.flying || this.airborne || this.entity.data.heldByPlayer) return;
    if (!this.isPlayerBonk()) {
      // a car or some other chaos: flap off in a huff
      this.squawk(1.2);
      this.takeOff(false);
      return;
    }
    // knocked flying
    const h = _v.set(impulse.x, 0, impulse.z);
    if (h.lengthSq() < 1e-4) h.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    h.normalize().multiplyScalar(6);
    this.noGround = false;
    this.launch(new THREE.Vector3(h.x, 6.5, h.z), 12);
    this.setState('tossed');
    this.squawk(1.35);
    this.say(pick(THROWN_LINES), 1.2);
  }

  protected handleWash() {
    if (this.washCd > 0) return;
    this.washCd = 2;
    this.say('heart', 1.3);
    this.hearts(3);
    this.squawk(1.2);
    this.game.score(40, 'Gave A Gull A Bath', this.pos.clone());
  }

  protected onLanded() {
    if (this.swimming) return this.splashDown(null);
    this.say('dizzy', 1);
    this.squawk(0.9);
    this.setState('dizzy');
  }

  // ------------------------------------------------------------------------------------------- visuals
  sync(dt: number) {
    const P = this.parts;
    const t = this.game.time;
    if (this.entity.data.heldByPlayer && this.body) {
      const b = this.body.translation();
      this.pos.set(b.x, b.y - this.cfg.colliderY, b.z);
      const pl = this.player;
      if (pl) this.yaw = dampAngle(this.yaw, pl.facing ?? this.yaw, 10, dt);
    }
    P.root.position.copy(this.pos);
    const flying = this.flying;
    P.root.rotation.set(flying ? this.bodyPitch : 0, this.yaw, flying ? this.bank : 0, 'YXZ');
    if (this.airborne) P.pivot.quaternion.copy(this.tumbleQ);
    else {
      this.tumbleQ.slerp(_id, 1 - Math.exp(-dt * 9));
      P.pivot.quaternion.copy(this.tumbleQ);
    }
    // wings: folded / flapping / frantic
    let flap = 0;
    let spread = 0;
    const held = !!this.entity.data.heldByPlayer;
    if (flying) {
      flap = Math.sin(this.flapPh) * 0.9 * this.flapAmt + (1 - this.flapAmt) * 0.1;
      spread = 1;
    } else if (this.airborne || held) {
      flap = Math.sin(t * 30) * 0.7;
      spread = 0.85;
    } else if (this.state === 'splash') {
      flap = Math.sin(t * 16) * 0.35;
      spread = 0.45;
    }
    const sweep = (1 - spread) * 1.45;
    P.wingL.rotation.set(0, sweep, flap - (1 - spread) * 0.2, 'YZX');
    P.wingR.rotation.set(0, -sweep, -flap + (1 - spread) * 0.2, 'YZX');
    // head: look around / furious shake while bobbing
    const shake = this.state === 'splash' ? Math.sin(t * 22) * 0.35 : 0;
    P.head.rotation.set(0, (flying ? 0 : this.headYaw * 0.6) + shake, 0);
    this.headYaw *= Math.exp(-dt * 0.4);
    P.legs.visible = (!flying || this.vel.y < -1) && this.state !== 'splash';
    this.emote.update(dt, t);
  }

  override dispose() {
    super.dispose();
    this.parts.root.removeFromParent();
  }
}

// ================================================================================================ spawner

interface GullSpot {
  x: number;
  z: number;
  yaw: number;
  /** Stand on whatever is up there (railing top, bollard) rather than the deck. */
  high: boolean;
}

/**
 * The waterfront gulls (see Waterfront.ts for the geometry): one on the promenade railing, one on Pier A by the
 * gap in its east railing, one on a marina bollard off Pier C. Each is a throw (or a bonk) away from the bay.
 */
const SPOTS: GullSpot[] = [
  { x: -16, z: 170.8, yaw: Math.PI, high: true },
  { x: -38.75, z: 185.5, yaw: -Math.PI / 2, high: false },
  { x: 45.7, z: 189.5, yaw: -Math.PI / 2, high: true },
];

export class GullSystem implements System {
  name = 'gulls';
  readonly list: Gull[] = [];
  private game!: Game;
  private tries = 0;
  private spawned = false;

  init(game: Game) {
    this.game = game;
  }

  update() {
    if (this.spawned) return;
    const animals = this.game.get<AnimalSystem>('animals');
    if (!animals || this.tries++ % 15 !== 0) return;
    const spots: [GullSpot, number][] = [];
    for (const s of SPOTS) {
      const hit = this.game.physics.raycast(_v.set(s.x, 4, s.z), DOWN, 6, WORLD_ONLY);
      if (hit) spots.push([s, hit.point.y]);
    }
    // wait for the waterfront colliders (give up waiting after a while and use what we found)
    if (spots.length < SPOTS.length && this.tries < 600) return;
    this.spawned = true;
    for (const [s, y] of spots) {
      try {
        const g = animals.add(new Gull(this.game, new THREE.Vector3(s.x, y, s.z), s.yaw, s.high));
        this.list.push(g);
      } catch (err) {
        console.error('[gulls] spawn failed', err);
      }
    }
  }
}
