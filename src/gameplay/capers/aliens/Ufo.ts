import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { RAPIER, G, groups } from '../../../core/Physics';
import { destroyProp } from '../../../entities/Props';
import {
  type CaperFeature, addObjective, objSet, playerFree, sceneBusy, hudShown, celebrate, toast, prompt, fx, poi,
  playerOf, rigOf, uiOf, surfaceAt, overlapBox, releaseCamera, aboveGround, clamp, lerp, smooth, rand, pick, damp, dampAngle,
} from '../shared';
import { buildSaucer, buildAlien, type SaucerParts, type AlienModel, DISC_R, DISC_Y, DISC_HALF, DISC_BOTTOM, HATCH, RAMP_FOOT, RAMP_LEN, LEG_R } from './models';

/**
 * ALIEN LANDING — "Trash Diplomacy".
 *
 * Every ~8–10 minutes of play (first visit ~4 min in, sooner at night) a chunky toy flying saucer swoops over Ballard
 * and lands on one of four open lawns (the lawn by the Locks, Gasworks-ish Park, the waterfront lawn, the Tee-Hee Park
 * outfield). Three little green aliens waddle down the ramp. They are obsessed with garbage and are certain Jimothy is
 * Earth's leader. Bring them 3 pieces of trash or food (drop or throw them by the ramp): each one is beamed up with a
 * tractor beam. Then they give the Round Leader a gift: a tractor-beam joyride over town, ending on the Space Noodle
 * deck. Ignore them and they leave after ~3 minutes. Stand under the hovering saucer while it lands / leaves to get
 * briefly "abducted" (lifted a few metres, then politely dropped).
 *
 * Map: POI `ufo` (🛸) while it's here; the Guide tracks it on arrival unless the player pinned something.
 * Events: 'ufoArrive' {site}, 'ufoLand' {site}, 'alienTrade' {count, kind}, 'ufoGift' {}, 'ufoJoyride' {done},
 *         'ufoLeave' {}, 'ufoAbduct' {}.
 * Test hooks (`capers.byId.get('ufo')`): arrive(siteIndex?, {fast}), leave(), land() (skip the descent),
 *   giveTrash(n) (spawns n items at the ramp foot), joyride() (start the gift ride now), phase, delivered, sites.
 */

type Phase = 'absent' | 'descend' | 'hover' | 'landing' | 'landed' | 'boarding' | 'liftoff' | 'gift' | 'pickup' | 'ride' | 'drop' | 'zoom';

interface Site {
  name: string;
  /** Rough centre (x, z) — the actual spot is searched around it. */
  x: number;
  z: number;
  /** Resolved ground centre (null = not resolved / nothing clear). */
  at?: THREE.Vector3 | null;
}

const FIRST_ARRIVAL = 240;
const STAY_SECS = 180;
const HOVER_H = 11;
const RIDE_SECS = 22;
const HANG = 3.4;

const INTRO = [
  'TAKE US TO YOUR TRASH LEADER.',
  'THE ROUND ONE. HE IS THE LEADER.',
  'GREETINGS, ROUND LEADER. BRING US THREE (3) TRASH.',
];
const IDLE_LINES = [
  'ON OUR PLANET THIS BANANA PEEL WOULD BE PRICELESS.',
  'WE HAVE TRAVELLED 40 LIGHT YEARS FOR YOUR GARBAGE.',
  'YOUR BINS. THEY ARE SO FULL. SO BEAUTIFUL.',
  'THE ROUND LEADER HAS NO NECK. A SIGN OF GREAT WISDOM.',
  'WE COME IN PEACE. AND FOR SNACKS.',
  'IS HE... WASHING THINGS? FASCINATING.',
  'BLEEP. (THAT MEANS "HELLO".)',
  'PLEASE DO NOT TELL SLOPCORP WE ARE HERE.',
  'ROUND LEADER, YOUR TRASH. WE WISH TO SEE IT.',
];
const CARRY_LINES = ['YES. YES! BRING IT CLOSER.', 'IS THAT... GARBAGE? FOR US?', 'PLACE THE OFFERING BY THE RAMP, ROUND ONE.'];
const THANKS = [
  ['A HALF-EATEN TREASURE!', 'TO THE MOTHERSHIP WITH IT!', 'SCIENCE WILL NEVER RECOVER.'],
  ['ANOTHER ONE! THE LEADER IS GENEROUS.', 'WE WILL NAME A MOON AFTER THIS.', 'ZORP, ARE YOU CRYING? I AM CRYING.'],
  ['THREE!! THE TREATY IS SIGNED!', 'ALL HAIL THE ROUND LEADER!', 'OUR PEOPLE WILL FEAST ON THIS ... OBJECT.'],
];
const BONK_LINES = ['OW. RUDE. EARTH IS RUDE.', 'WAS THAT A GREETING? IT HURT.', 'NOTED. THE LEADER BONKS.', 'BLORP! MY ANTENNAE!'];
const WASH_LINES = ['WHY IS THE LEADER... MOIST?', 'IS THIS A RITUAL? I AM DAMP NOW.', 'HE WASHES US. WE ARE BAFFLED.', 'MY FACE. IT IS CLEAN. WHY.'];
const PET_LINES = ['HEE HEE. THE LEADER PATS US.', 'THIS IS NOT A PROBE. THIS IS NICE.', 'WE WILL ALLOW ONE (1) PAT.'];
const CHITTER_LINES = ['CHRRK-CHRRK!', 'CHRRRK! (WE SPEAK RACCOON.)', 'HE SPEAKS THE ANCIENT TONGUE!', 'CHRK. (THAT WAS RUDE IN OUR LANGUAGE.)'];
const NAMES = ['ZORP', 'GLEEB', 'BLIP'];
const LEAVE_LINES = ['WE MUST GO. THE MOTHERSHIP IS DOUBLE-PARKED.', 'FAREWELL, ROUND LEADER. KEEP EARTH MESSY.'];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

type AlienState = 'inside' | 'walk' | 'idle' | 'tumble';

class Alien {
  model: AlienModel;
  body: RAPIER_T.RigidBody | null = null;
  entity: Entity | null = null;
  pos = new THREE.Vector3();
  yaw = 0;
  state: AlienState = 'inside';
  path: THREE.Vector3[] = [];
  /** Where it stands while mingling. */
  home = new THREE.Vector3();
  /** Called when the path is done (walk). */
  onArrive: (() => void) | null = null;
  t = 0;
  phase = Math.random() * 10;
  bow = 0;
  bowT = 0;
  hop = 0;
  hopV = 0;
  tumbleT = 0;
  tumbleDir = new THREE.Vector3();
  shuffleT = rand(3, 6);
  sayCd = 0;
  visible = false;
  /** Seconds after landing until it steps out (null = not scheduled). */
  outAt: number | undefined = undefined;
  private pendT = 0;
  private pend: (() => void) | null = null;

  /** Run `fn` after `secs` of game time (one pending call per alien). */
  later(secs: number, fn: () => void) {
    if (secs <= 0) {
      this.pend = null;
      fn();
      return;
    }
    this.pendT = secs;
    this.pend = fn;
  }

  constructor(
    readonly ufo: UfoFeature,
    readonly i: number,
  ) {
    this.model = buildAlien(i);
    this.model.root.visible = false;
  }

  get game() {
    return this.ufo.game;
  }

  get name() {
    return NAMES[this.i % NAMES.length];
  }

  spawnBody() {
    const game = this.game;
    if (this.body) return;
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y + 0.48, this.pos.z);
    const cd = RAPIER.ColliderDesc.cuboid(0.24, 0.46, 0.22)
      .setCollisionGroups(groups(G.ANIMAL, G.PLAYER | G.PROP | G.RAGDOLL | G.HELD))
      .setFriction(0.6);
    this.body = game.physics.createBody(desc, [cd]);
    this.entity = game.entities.create({
      kind: 'animal',
      name: 'Little Green Alien',
      body: this.body,
      object: this.model.root,
      mass: 20,
      tags: new Set(['animal', 'alien', 'noclimb']),
      data: { alien: this, grabLabel: 'Pet the alien', size: new THREE.Vector3(0.5, 1, 0.5), floatRadius: 0.4 },
      onGrab: () => {
        this.ufo.onPet(this);
        return false;
      },
      onBonk: () => {
        this.ufo.onBonk(this);
        return true;
      },
      onWash: () => this.ufo.onWash(this),
    });
  }

  removeBody() {
    const game = this.game;
    if (this.entity) {
      game.entities.remove(this.entity);
      this.entity = null;
    }
    if (this.body) {
      game.physics.removeBody(this.body);
      this.body = null;
    }
  }

  show(on: boolean) {
    this.visible = on;
    this.model.root.visible = on;
  }

  say(text: string, secs = 3) {
    if (!this.visible) return;
    this.game.events.emit('speech', { object: this.model.root, offsetY: 1.35, text, duration: secs, key: this, style: 'shout', speaker: this.name });
  }

  walkTo(path: THREE.Vector3[], onArrive: (() => void) | null = null) {
    this.path = path.map((p) => p.clone());
    this.onArrive = onArrive;
    this.state = 'walk';
  }

  tumble(from: THREE.Vector3) {
    this.state = 'tumble';
    this.tumbleT = 0;
    this.tumbleDir.copy(this.pos).sub(from).setY(0);
    if (this.tumbleDir.lengthSq() < 1e-4) this.tumbleDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
    this.tumbleDir.normalize();
    this.hopV = 3.2;
  }

  update(dt: number, player: THREE.Vector3 | null) {
    this.t += dt;
    this.sayCd -= dt;
    if (this.pend) {
      this.pendT -= dt;
      if (this.pendT <= 0) {
        const fn = this.pend;
        this.pend = null;
        fn();
      }
    }
    const m = this.model;
    let moving = false;
    switch (this.state) {
      case 'walk': {
        const target = this.path[0];
        if (!target) {
          this.state = 'idle';
          const cb = this.onArrive;
          this.onArrive = null;
          cb?.();
          break;
        }
        const d = _v.copy(target).sub(this.pos);
        const flat = Math.hypot(d.x, d.z);
        const step = 1.5 * dt;
        if (flat <= step || flat < 0.02) {
          this.pos.copy(target);
          this.path.shift();
        } else {
          this.pos.x += (d.x / flat) * step;
          this.pos.z += (d.z / flat) * step;
          // y follows the segment (ramp) linearly
          this.pos.y += d.y * (step / flat);
          this.yaw = dampAngle(this.yaw, Math.atan2(d.x, d.z), 10, dt);
          moving = true;
        }
        break;
      }
      case 'idle': {
        // face the Round Leader when he's around, else look about
        if (player && player.distanceToSquared(this.pos) < 14 * 14) this.yaw = dampAngle(this.yaw, Math.atan2(player.x - this.pos.x, player.z - this.pos.z), 5, dt);
        this.shuffleT -= dt;
        if (this.shuffleT <= 0) {
          this.shuffleT = rand(4, 8);
          const a = rand(0, Math.PI * 2);
          const r = rand(0.2, 0.9);
          this.walkTo([this.home.clone().add(_v.set(Math.cos(a) * r, 0, Math.sin(a) * r))]);
        }
        break;
      }
      case 'tumble': {
        this.tumbleT += dt;
        const u = this.tumbleT;
        if (u < 0.7) {
          this.pos.addScaledVector(this.tumbleDir, dt * 2.2 * (1 - u / 0.7));
          m.pivot.rotation.x = -smooth(u / 0.7) * Math.PI * 1.5;
        } else if (u < 1.6) {
          m.pivot.rotation.x = -Math.PI * 1.5 + Math.sin((u - 0.7) * 30) * 0.06; // flat on its back, legs kicking
        } else if (u < 2.1) {
          m.pivot.rotation.x = lerp(-Math.PI * 1.5, -Math.PI * 2, smooth((u - 1.6) / 0.5));
          if (u - dt < 1.6) this.hopV = 2.6;
        } else {
          m.pivot.rotation.x = 0;
          this.state = 'idle';
          this.shuffleT = 0.4; // waddle back home
        }
        break;
      }
    }
    // little hops (startled, celebrating)
    this.hopV -= 14 * dt;
    this.hop = Math.max(0, this.hop + this.hopV * dt);
    if (this.hop === 0 && this.hopV < 0) this.hopV = 0;
    // bow
    if (this.bowT > 0) this.bowT -= dt;
    this.bow = damp(this.bow, this.bowT > 0 ? 0.65 : 0, 8, dt);
    // pose: waddle (side rock) while walking, a happy bob while idle
    if (this.state !== 'tumble') {
      const w = moving ? Math.sin(this.t * 11 + this.phase) * 0.2 : Math.sin(this.t * 2.2 + this.phase) * 0.04;
      m.pivot.rotation.z = w;
      m.pivot.rotation.x = this.bow;
    }
    m.root.position.set(this.pos.x, this.pos.y + this.hop + (moving ? Math.abs(Math.sin(this.t * 11 + this.phase)) * 0.05 : 0), this.pos.z);
    m.root.rotation.y = this.yaw;
    // tip glow pulse
    const g = 1 + Math.sin(this.t * 5 + this.phase) * 0.35;
    m.tips.color.setScalar(1).multiplyScalar(g);
    if (this.body) this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + 0.48, z: this.pos.z });
  }
}

export class UfoFeature implements CaperFeature {
  readonly id = 'ufo';
  phase: Phase = 'absent';
  /** Trash beamed up this visit. */
  delivered = 0;
  readonly sites: Site[] = [
    { name: 'the lawn by the Locks', x: -164, z: 98 },
    { name: 'Gasworks-ish Park', x: -172, z: 0 },
    { name: 'the waterfront lawn', x: -43, z: 122.5 },
    { name: 'the Tee-Hee Park outfield', x: 145, z: 106 },
  ];
  site: Site | null = null;
  private lastSite = -1;
  private playT = 0;
  private nextAt = FIRST_ARRIVAL;
  private t = 0;
  private stayT = 0;
  private visits = 0;
  private s: SaucerParts | null = null;
  private aliens: Alien[] = [];
  private landedBody: RAPIER_T.RigidBody | null = null;
  private center = new THREE.Vector3();
  private yaw = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  private wobble = 0;
  private rampOpen = 0;
  private wantRamp = 0;
  private aliensOut = false;
  private met = false;
  private introI = -1;
  private introT = 0;
  private chatT = 6;
  private scanT = 0;
  private beams: { obj: THREE.Object3D; from: THREE.Vector3; t: number; spin: number; scale: number; kind: string }[] = [];
  private boardNext: 'liftoff' | 'gift' = 'liftoff';
  private giftT = 0;
  private chitterCd = 0;
  private firstContact = false;
  // abduction (Jimothy lifted under the hovering saucer) + joyride
  private abductT = -1;
  /** One cartoon abduction on the way down and one on the way up. */
  private abducted = { down: false, up: false };
  private abductFrom = new THREE.Vector3();
  private claimed = false;
  private camFn: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;
  private camLook = new THREE.Vector3();
  private ride: THREE.CatmullRomCurve3 | null = null;
  private rideT = 0;
  private dropAt = new THREE.Vector3();
  private pickFrom = new THREE.Vector3();
  private spin = 0;
  private tracked = false;
  private fast = false;

  constructor(readonly game: Game) {}

  init() {
    const game = this.game;
    addObjective(game, {
      id: 'weComeInPeace',
      category: 'chaos',
      points: 1500,
      title: 'We Come In Peace',
      desc: 'Meet the aliens. A flying saucer drops by every 10 minutes or so (more often at night). Watch the sky, and the map for 🛸.',
    });
    addObjective(game, {
      id: 'trashDiplomacy',
      category: 'chaos',
      points: 3000,
      target: 3,
      title: 'Trash Diplomacy',
      desc: 'The aliens think you are Earth\'s leader and want garbage. Drop 3 pieces of trash or food by their ramp in one visit.',
    });
    addObjective(game, {
      id: 'closeEncounter',
      category: 'chaos',
      points: 2500,
      title: 'Close Encounter',
      desc: 'Accept the aliens\' gift: a tractor-beam joyride over Ballard. (Complete Trash Diplomacy first.)',
    });
    addObjective(game, {
      id: 'probedPetted',
      category: 'secret',
      points: 1200,
      hidden: true,
      title: 'Probed? No, Petted',
      desc: 'Pet a little green alien with Grabby Hands. They allowed one (1) pat.',
    });
    game.events.on('chitter', (p: any) => this.onChitter(p?.position));
    game.events.on('washStart', () => this.onWashNear());
  }

  // ============================================================================================== public / tests
  /** Bring the saucer in now (tests: `capers.byId.get('ufo').arrive(2)`). `fast` skips the long swoop. */
  arrive(siteIndex?: number, opts: { fast?: boolean } = {}): boolean {
    if (this.phase !== 'absent') return false;
    const order = siteIndex != null ? [siteIndex] : this.siteOrder();
    for (const i of order) {
      const s = this.sites[i];
      if (!s) continue;
      const at = this.resolveSite(s);
      if (!at || !this.spotFree(at)) continue;
      this.lastSite = i;
      this.begin(s, at, !!opts.fast);
      return true;
    }
    return false;
  }

  /** Skip the descent (tests). */
  land() {
    if (this.phase === 'descend' || this.phase === 'hover' || this.phase === 'landing') {
      this.endAbduct(false);
      this.touchDown();
    }
  }

  /** Send the saucer away (aliens board first if they're out). */
  leave() {
    if (this.phase === 'absent' || this.phase === 'zoom') return;
    if (this.phase === 'landed') return this.startBoarding('liftoff');
    if (this.phase === 'pickup' || this.phase === 'ride' || this.phase === 'drop') return this.finishRide(true);
    if (this.phase === 'descend' || this.phase === 'hover' || this.phase === 'landing') {
      this.endAbduct(true);
      this.startZoom();
      return;
    }
    if (this.phase === 'boarding') return;
    this.startZoom();
  }

  /** Spawn n trash items right at the ramp foot (tests). */
  async giveTrash(n = 3) {
    const items = await import('../../items');
    const kinds = ['bananaPeel', 'sodaCan', 'appleCore', 'pizza', 'fishBones', 'newspaper'];
    const out: Entity[] = [];
    for (let i = 0; i < n; i++) {
      const p = this.local(_v.set((i - (n - 1) / 2) * 0.7, 0.3, RAMP_FOOT.z + 0.6));
      p.y = (surfaceAt(this.game, p.x, p.z, p.y + 3, 6) ?? this.center.y) + 0.02;
      out.push(items.spawnItem(this.game, kinds[i % kinds.length], p, rand(0, 6)));
    }
    return out.length;
  }

  /** Start the gift joyride right now (tests; needs the saucer present). */
  joyride() {
    if (this.phase === 'absent' || this.phase === 'zoom') return false;
    this.removeLanded();
    for (const a of this.aliens) {
      a.removeBody();
      a.show(false);
      a.state = 'inside';
    }
    this.aliensOut = false;
    this.wantRamp = 0;
    this.rampOpen = 0;
    if (this.s) {
      this.s.ramp.visible = false;
      this.s.legs.scale.y = 0.1;
    }
    if (this.s && this.s.root.position.y < this.center.y + HOVER_H - 2) this.s.root.position.y = this.center.y + HOVER_H - 2;
    this.phase = 'gift';
    this.t = 0;
    this.giftT = 0;
    return true;
  }

  /** Where the ramp meets the ground (world), or null. */
  rampFoot() {
    return this.phase === 'absent' ? null : this.local(RAMP_FOOT.clone());
  }

  // ============================================================================================== sites
  private siteOrder(): number[] {
    const p = playerOf(this.game)?.position as THREE.Vector3 | undefined;
    const idx = this.sites.map((_, i) => i).filter((i) => i !== this.lastSite);
    // shuffle, then prefer sites 30–220 m away (visible arrival, reachable)
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    if (p) {
      const score = (i: number) => {
        const s = this.sites[i];
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        return d < 30 ? 2 : d > 220 ? 1 : 0;
      };
      idx.sort((a, b) => score(a) - score(b));
    }
    if (this.lastSite >= 0) idx.push(this.lastSite);
    return idx;
  }

  /** Flat, clear ground for the saucer near a site (cached). */
  private resolveSite(s: Site): THREE.Vector3 | null {
    if (s.at !== undefined) return s.at;
    s.at = null;
    const tries: [number, number][] = [[0, 0]];
    for (let r = 2; r <= 10; r += 2) for (let k = 0; k < 8; k++) tries.push([Math.cos((k / 8) * Math.PI * 2) * r, Math.sin((k / 8) * Math.PI * 2) * r]);
    let best: { p: THREE.Vector3; d: number } | null = null;
    for (const [dx, dz] of tries) {
      const r = this.flatAt(s.x + dx, s.z + dz);
      if (!r) continue;
      if (!best || r.d < best.d - 0.05) best = { p: r.p, d: r.d };
      if (r.d < 0.12) break;
    }
    s.at = best ? best.p : null;
    if (!s.at) console.info(`[capers] ufo: no clear landing spot at ${s.name}`);
    return s.at;
  }

  private flatAt(x: number, z: number): { p: THREE.Vector3; d: number } | null {
    const game = this.game;
    let lo = 1e9;
    let hi = -1e9;
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) {
        if (i * i + j * j > 10) continue;
        const y = surfaceAt(game, x + i * 2, z + j * 2, 80, 120);
        if (y == null) return null;
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    if (hi - lo > 0.9) return null;
    if (game.get<any>('npcs')?.onRoad?.(x, z, 8)) return null;
    const p = new THREE.Vector3(x, (lo + hi) / 2, z);
    if (!this.spotFree(p, hi)) return null;
    return { p, d: hi - lo };
  }

  /** No walls / props / cars in the saucer's volume (or over the ramp). */
  private spotFree(p: THREE.Vector3, top = p.y): boolean {
    const f = groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE);
    if (overlapBox(this.game, _v.set(p.x, top + 0.5 + 6, p.z), _v2.set(6.5, 6, 6.5), 0, f).length) return false;
    return true;
  }

  // ============================================================================================== arrival
  private begin(s: Site, at: THREE.Vector3, fast: boolean) {
    const game = this.game;
    if (!this.s) {
      this.s = buildSaucer();
      for (let i = 0; i < 3; i++) this.aliens.push(new Alien(this, i));
    }
    const S = this.s;
    this.site = s;
    this.center.copy(at);
    this.visits++;
    this.delivered = 0;
    this.met = false;
    this.introI = -1;
    this.firstContact = false;
    this.fast = fast;
    this.beams.length = 0;
    this.abducted.down = this.abducted.up = false;
    // face the ramp toward the middle of town (where Jimothy probably comes from)
    this.yaw = Math.atan2(0 - at.x, 30 - at.z);
    S.root.rotation.set(0, this.yaw, 0);
    S.ramp.visible = false;
    S.ramp.scale.z = 0.01;
    S.legs.scale.y = 0.1;
    S.hatch.position.y = DISC_BOTTOM - 0.02;
    this.rampOpen = 0;
    this.wantRamp = 0;
    this.aliensOut = false;
    // swoop in from far away, high up (from the bay side: over the water and in)
    const a = rand(0, Math.PI * 2);
    this.from.set(at.x + Math.cos(a) * 220, at.y + 95, at.z + Math.sin(a) * 220);
    this.to.copy(at).setY(at.y + HOVER_H);
    S.root.position.copy(fast ? this.to : this.from);
    this.prevPos.copy(S.root.position);
    game.scene.add(S.root);
    game.scene.add(S.itemBeam);
    for (const al of this.aliens) {
      game.scene.add(al.model.root);
      al.show(false);
      al.state = 'inside';
      al.model.pivot.rotation.set(0, 0, 0);
    }
    this.phase = 'descend';
    this.t = fast ? 99 : 0;
    game.get<any>('world')?.poi?.set('ufo', at.clone());
    game.events.emit('ufoArrive', { site: s.name });
    // announce
    game.sfx('slop_glitch', undefined, 0.5, 0.6);
    game.sfx('whoosh', undefined, 0.6, 0.5);
    celebrate(game, 'UFO!', 'UNIDENTIFIED FLYING SAUCER OVER BALLARD', '#7dff6a');
    toast(game, 'Unidentified Flying Saucer', `It's landing at ${s.name}. Probably friendly. (🛸 on the map)`, 'star');
    game.hint(`A flying saucer is coming down at ${s.name}!`, 4);
    this.news(['UNIDENTIFIED FLYING SAUCER OVER BALLARD. Residents asked to "please stop waving trash at it."', 'UFO lands in Seattle. Experts: "It is, technically, a flying saucer." Raccoon: interested.']);
    // the Guide points there (unless the player pinned a goal)
    try {
      const guide = uiOf(game)?.guide;
      if (guide && !guide.manual && !guide.customPoi && !this.allDone()) {
        guide.trackPoi('ufo', 'Flying saucer');
        this.tracked = true;
      }
    } catch {
      /* optional */
    }
  }

  private allDone() {
    const o = this.game.get<any>('objectives');
    return !!o && o.isDone('weComeInPeace') && o.isDone('trashDiplomacy') && o.isDone('closeEncounter');
  }

  private news(lines: string[]) {
    try {
      const n = this.game.get<any>('news');
      if (n?.enabled && Array.isArray(n.queue)) n.queue.unshift(pick(lines));
    } catch {
      /* optional */
    }
  }

  // ============================================================================================== per frame
  update(dt: number) {
    const game = this.game;
    if (this.phase === 'absent') {
      if (game.state !== 'playing') return;
      this.playT += dt;
      if (this.playT < this.nextAt) return;
      if (sceneBusy(game) || !playerFree(game) || !this.arrive()) this.nextAt = this.playT + 20;
      return;
    }
    const S = this.s!;
    const player = playerOf(game);
    const pp: THREE.Vector3 | null = player?.position ?? null;
    this.t += dt;
    this.chitterCd -= dt;
    const root = S.root;
    this.prevPos.copy(root.position);

    switch (this.phase) {
      case 'descend': {
        const D = 7;
        const u = clamp(this.t / D, 0, 1);
        const e = 1 - Math.pow(1 - u, 3);
        root.position.lerpVectors(this.from, this.to, e);
        // a lazy S-curve on the way in
        root.position.x += Math.sin(u * Math.PI * 2) * 12 * (1 - u);
        root.position.y += Math.sin(u * Math.PI) * 8 * (1 - u);
        this.wobble = 0.22 * (1 - u) + 0.05;
        if (u >= 1) {
          this.phase = 'hover';
          this.t = 0;
          game.sfx('sparkle', root.position, 0.6, 0.6);
        }
        break;
      }
      case 'hover': {
        root.position.copy(this.to);
        root.position.y += Math.sin(this.t * 2.5) * 0.25;
        this.wobble = 0.06;
        if (this.t > 2.4 && this.abductT < 0) {
          this.phase = 'landing';
          this.t = 0;
        }
        break;
      }
      case 'landing': {
        const u = clamp(this.t / 3, 0, 1);
        root.position.copy(this.to).setY(lerp(this.to.y, this.center.y, smooth(u)));
        S.legs.scale.y = lerp(0.1, 1, smooth(clamp((u - 0.2) / 0.6, 0, 1)));
        this.wobble = 0.06 * (1 - u);
        if (u >= 1) this.touchDown();
        break;
      }
      case 'landed':
        this.updateLanded(dt, pp);
        break;
      case 'boarding': {
        root.position.copy(this.center);
        const allIn = this.aliens.every((a) => a.state === 'inside');
        if (allIn) {
          this.wantRamp = 0;
          if (this.rampOpen <= 0.001) {
            this.removeLanded();
            this.phase = 'liftoff';
            this.t = 0;
            game.sfx('whoosh', root.position, 0.7, 0.6);
            if (this.boardNext === 'gift') game.hint('The saucer lifts off... and swings round toward Jimothy.', 3);
          }
        }
        break;
      }
      case 'liftoff': {
        const u = clamp(this.t / 2.6, 0, 1);
        root.position.copy(this.center).setY(this.center.y + smooth(u) * (HOVER_H + 1));
        root.position.y += Math.sin(this.t * 2.5) * 0.2 * u;
        S.legs.scale.y = lerp(1, 0.1, smooth(clamp(u * 2, 0, 1)));
        this.wobble = 0.08;
        if (u >= 1 && this.abductT < 0) {
          if (this.boardNext === 'gift') {
            this.phase = 'gift';
            this.t = 0;
            this.giftT = 0;
          } else this.startZoom();
        }
        break;
      }
      case 'gift':
        this.updateGift(dt, player);
        break;
      case 'pickup':
      case 'ride':
      case 'drop':
        this.updateRide(dt, player);
        break;
      case 'zoom': {
        const u = this.t / 1.6;
        const dir = _v.copy(this.to).sub(this.from).normalize();
        const sp = 20 + 260 * u * u;
        root.position.addScaledVector(dir, sp * dt);
        this.wobble = 0.03;
        if (u >= 1) this.vanish();
        break;
      }
    }

    // beam: on while hovering / landing / lifting / giving rides
    const beamOn = this.phase === 'hover' || this.phase === 'landing' || (this.phase === 'descend' && this.t > 4) || this.phase === 'liftoff' || this.phase === 'gift' || this.phase === 'pickup' || this.phase === 'ride' || this.phase === 'drop' || this.abductT >= 0;
    const ground = this.phase === 'gift' || this.phase === 'pickup' || this.phase === 'ride' || this.phase === 'drop' ? (pp ? pp.y - 0.4 : this.center.y) : this.center.y;
    const len = Math.max(0.1, root.position.y + DISC_BOTTOM - ground);
    S.beam.visible = beamOn && len > 0.6;
    if (S.beam.visible) {
      S.beam.scale.set(1, len, 1);
      (S.beamMat.map as THREE.Texture).offset.y = (this.t * 0.8) % 1;
      S.beamMat.opacity = 0.42 + Math.sin(this.t * 9) * 0.08;
    }

    // velocity (for the ride camera) + abduction
    if (dt > 0) this.vel.copy(root.position).sub(this.prevPos).divideScalar(dt);
    this.updateAbduct(dt, player);
    this.updateBeams(dt);

    // aliens
    for (const a of this.aliens) if (a.visible) a.update(dt, pp);
  }

  postPhysics(dt: number) {
    if (this.phase === 'absent' || !this.s) return;
    const S = this.s;
    const tt = this.game.time;
    // wobble + spin of the body (visual only)
    S.body.rotation.x = Math.sin(tt * 2.1) * this.wobble;
    S.body.rotation.z = Math.cos(tt * 1.7) * this.wobble;
    // blinking rim lights (chase)
    const blink = Math.floor(tt * 4) % 2 === 0;
    const night = this.game.get<any>('environment')?.nightFactor ?? 0;
    const k = 1 + night * 0.8;
    S.lightsA.color.setRGB(blink ? 2.6 * k : 0.5, blink ? 2.1 * k : 0.4, blink ? 0.6 * k : 0.15);
    S.lightsB.color.setRGB(!blink ? 0.6 * k : 0.15, !blink ? 2.6 * k : 0.5, !blink ? 1.9 * k : 0.4);
    S.pilotGlow.color.setRGB(0.5 * k, (1.4 + Math.sin(tt * 6) * 0.3) * k, 1.1 * k);
    // ramp + hatch
    this.rampOpen = dt > 0 ? damp(this.rampOpen, this.wantRamp, 4, dt) : this.rampOpen;
    if (Math.abs(this.rampOpen - this.wantRamp) < 0.002) this.rampOpen = this.wantRamp;
    const hatchU = clamp(this.rampOpen * 3, 0, 1);
    S.hatch.position.y = DISC_BOTTOM - 0.02 - hatchU * 0.12;
    S.hatch.position.z = HATCH.z - hatchU * 1.0;
    const ru = clamp((this.rampOpen - 0.2) / 0.8, 0, 1);
    S.ramp.visible = ru > 0.01;
    S.ramp.scale.z = Math.max(0.01, ru);
    // Jimothy floating in the beam: a slow somersault-y tumble
    if (this.abductT >= 0 || this.phase === 'pickup' || this.phase === 'ride' || this.phase === 'drop') {
      const pl = playerOf(this.game);
      if (pl?.model?.pivot && pl.frozen) {
        this.spin += dt * 1.4;
        _e.set(Math.sin(this.spin * 1.3) * 0.5, pl.facing, Math.sin(this.spin) * 0.35, 'YXZ');
        pl.model.pivot.quaternion.setFromEuler(_e);
      }
    }
  }

  lateUpdate() {
    if (this.phase !== 'landed' || !this.aliensOut) return;
    // the "drop it here" prompt while carrying an offering nearby
    const game = this.game;
    const pl = playerOf(game);
    const e: Entity | undefined = pl?.held?.entity;
    if (!e || !this.isOffering(e) || !hudShown(game)) return;
    const foot = this.local(_v3.copy(RAMP_FOOT));
    if (Math.hypot(pl.position.x - foot.x, pl.position.z - foot.z) < 6) prompt(game, '{grab} Drop the offering by the ramp', 0.3);
  }

  // ============================================================================================== landed
  private touchDown() {
    const game = this.game;
    const S = this.s!;
    S.root.position.copy(this.center);
    S.legs.scale.y = 1;
    this.phase = 'landed';
    this.t = 0;
    this.stayT = 0;
    this.wobble = 0;
    this.buildLanded();
    game.sfx('land_heavy', this.center, 0.8, 0.7);
    game.sfx('slop_glitch', this.center, 0.4, 1.4);
    fx(game, 'dust', this.center, { scale: 3, radius: 4 });
    rigOf(game)?.shake(0.25);
    this.wantRamp = 1;
    game.events.emit('ufoLand', { site: this.site?.name });
    // aliens come out one by one once the ramp is down
    const hatch = this.local(HATCH.clone());
    const homes = [
      [-1.7, 6.5],
      [0, 7.3],
      [1.7, 6.5],
    ];
    this.aliens.forEach((a, i) => {
      a.home.copy(this.local(_v.set(homes[i][0], 0, homes[i][1])));
      a.home.y = (surfaceAt(game, a.home.x, a.home.z, this.center.y + 3, 6) ?? this.center.y) + 0.02;
      a.pos.copy(hatch);
      a.yaw = this.yaw;
      const delay = (this.fast ? 0.6 : 1.6) + i * 1.1;
      a.state = 'inside';
      a.outAt = delay;
    });
  }

  private updateLanded(dt: number, pp: THREE.Vector3 | null) {
    const game = this.game;
    this.stayT += dt;
    // aliens step out
    const hatch = this.local(_v3.copy(HATCH));
    const foot = this.local(RAMP_FOOT.clone());
    for (const a of this.aliens) {
      if (a.state === 'inside' && a.outAt != null && this.t >= a.outAt && this.rampOpen > 0.9) {
        a.outAt = undefined;
        a.pos.copy(hatch);
        a.show(true);
        a.spawnBody();
        a.walkTo([foot, a.home]);
        game.sfx('boing', hatch, 0.4, 1.6 + a.i * 0.15);
        if (a.i === 2) this.aliensOut = true;
      }
    }
    if (!this.aliensOut) return;
    // meet & greet
    const near = pp && pp.distanceTo(this.center) < 13;
    if (near && !this.met) {
      this.met = true;
      this.introI = 0;
      this.introT = 0;
      objSet(game, 'weComeInPeace', 1);
      game.hint('The aliens want trash! Bring 3 pieces of trash or food and drop them by the ramp.', 5);
    }
    if (this.introI >= 0 && this.introI < INTRO.length) {
      this.introT -= dt;
      if (this.introT <= 0) {
        this.aliens[this.introI % 3].say(INTRO[this.introI], 3.2);
        game.sfx('slop_voice', this.aliens[this.introI % 3].pos, 0.35, 1.9);
        this.introI++;
        this.introT = 2.6;
      }
    } else if (pp && pp.distanceTo(this.center) < 16) {
      this.chatT -= dt;
      if (this.chatT <= 0) {
        this.chatT = rand(6, 9);
        const held: Entity | undefined = playerOf(game)?.held?.entity;
        const a = pick(this.aliens.filter((x) => x.state === 'idle') as Alien[]);
        if (a) {
          a.say(held && this.isOffering(held) ? pick(CARRY_LINES) : pick(IDLE_LINES), 3.4);
          game.sfx('slop_voice', a.pos, 0.3, 1.8 + Math.random() * 0.3);
        }
      }
    }
    // offerings
    this.scanT -= dt;
    if (this.scanT <= 0 && this.delivered < 3) {
      this.scanT = 0.15;
      this.scanOfferings(foot);
    }
    // bored: leave after ~3 minutes (not while beaming / mid-thanks)
    if (this.stayT > STAY_SECS && !this.beams.length && this.delivered < 3) {
      this.aliens[1].say(pick(LEAVE_LINES), 3);
      this.startBoarding('liftoff');
    }
  }

  isOffering(e: Entity) {
    return e.alive && (e.tags.has('trash') || e.tags.has('food')) && !e.tags.has('alien');
  }

  private scanOfferings(foot: THREE.Vector3) {
    const game = this.game;
    const c = this.center;
    const found: Entity[] = [];
    for (const e of game.entities.list) {
      if (e.kind !== 'item' && e.kind !== 'prop') continue;
      if (!e.alive || !e.body || e.data.heldByPlayer || e.data.heldByNpc || e.data.consumed || e.data.ufoBeamed) continue;
      if (!this.isOffering(e)) continue;
      const t = e.body.translation();
      if (Math.abs(t.y - c.y) > 2.6) continue;
      const dFoot = Math.hypot(t.x - foot.x, t.z - foot.z);
      const dC = Math.hypot(t.x - c.x, t.z - c.z);
      if (dFoot < 3.2 || dC < DISC_R - 0.4) found.push(e);
    }
    for (const e of found) {
      if (this.delivered + this.beams.length >= 3) break;
      this.beamUp(e);
    }
  }

  private beamUp(e: Entity) {
    const game = this.game;
    const obj = e.object;
    const kind = String(e.data.itemKind ?? e.name);
    e.data.ufoBeamed = true;
    e.data.consumed = true;
    e.data.owner = null;
    const from = obj ? obj.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3().copy(e.body!.translation() as any);
    try {
      destroyProp(game, e);
    } catch (err) {
      console.warn('[capers] ufo: item cleanup failed', err);
    }
    if (!obj) return;
    game.scene.add(obj);
    obj.position.copy(from);
    this.beams.push({ obj, from, t: 0, spin: rand(4, 7), scale: obj.scale.x, kind });
    game.sfx('sparkle', from, 0.8, 0.7);
    game.sfx('whoosh', from, 0.4, 1.6);
    fx(game, 'sparkles', from, { count: 14, color: 0x9dffb0, radius: 0.5 });
    // everyone turns to watch
    for (const a of this.aliens) if (a.state === 'idle') a.hopV = 2.4;
  }

  private updateBeams(dt: number) {
    const S = this.s!;
    const game = this.game;
    if (!this.beams.length) {
      S.itemBeam.visible = false;
      return;
    }
    const b = this.beams[0];
    b.t += dt;
    const D = 1.8;
    const u = clamp(b.t / D, 0, 1);
    const top = this.local(_v.copy(HATCH)).add(_v2.set(0, 0.2, 0));
    const p = b.obj.position.copy(b.from).lerp(top, smooth(u));
    p.y += Math.sin(u * Math.PI) * 0.6;
    b.obj.rotation.y += b.spin * dt;
    b.obj.rotation.x += b.spin * 0.6 * dt;
    const sc = b.scale * (u > 0.75 ? 1 - (u - 0.75) / 0.25 : 1);
    b.obj.scale.setScalar(Math.max(0.001, sc));
    // the little beam from the hatch down to the item's start
    S.itemBeam.visible = true;
    S.itemBeam.position.copy(top);
    S.itemBeam.scale.set(1, Math.max(0.2, top.y - b.from.y + 0.3), 1);
    if (u >= 1) {
      b.obj.removeFromParent();
      this.beams.shift();
      this.delivered++;
      const n = this.delivered;
      game.score(250, 'Intergalactic Trade', b.from.clone().setY(b.from.y + 1));
      game.sfx('cha_ching', top, 0.7, 1.3);
      fx(game, 'sparkles', top, { count: 22, color: 0xb8ff9d, radius: 1 });
      objSet(game, 'trashDiplomacy', n);
      game.events.emit('alienTrade', { count: n, kind: b.kind });
      const lines = THANKS[Math.min(2, n - 1)];
      this.aliens.forEach((a, i) => {
        if (a.state === 'idle' || a.state === 'walk') {
          a.hopV = 3;
          if (i === n % 3) a.say(lines[i % lines.length], 2.8);
        }
      });
      if (n < 3) game.hint(`The aliens beamed it up! ${n}/3. ${pick(['They seem thrilled.', 'One alien is weeping with joy.', 'Science!'])}`, 3);
      else this.treaty();
    }
  }

  private treaty() {
    const game = this.game;
    celebrate(game, 'TRASH DIPLOMACY', 'A historic treaty between raccoons and space', '#7dff6a');
    game.sfx('jingle_win', undefined, 0.7);
    game.sfx('crowd_cheer', this.center, 0.5, 1.6);
    fx(game, 'confetti', this.local(_v.copy(RAMP_FOOT)).setY(this.center.y + 2), { scale: 1.4, count: 120 });
    for (const a of this.aliens) {
      a.bowT = 1.5;
      a.hopV = 3.4;
    }
    this.aliens[0].say('THE ROUND LEADER HAS BLESSED US.', 3);
    this.aliens[2].later(1.2, () => this.aliens[2].say('RECEIVE OUR GIFT: A RIDE. PLEASE KEEP PAWS INSIDE THE BEAM.', 3.5));
    this.news(['Raccoon signs first-ever trade treaty with outer space. Terms: garbage.', 'Aliens leave Ballard "deeply satisfied" with local trash. Tourism board thrilled.']);
    this.giftT = 0;
    this.startBoarding('gift', 3);
  }

  private startBoarding(next: 'liftoff' | 'gift', delay = 0) {
    this.boardNext = next;
    this.phase = 'boarding';
    this.t = 0;
    const hatch = this.local(HATCH.clone());
    const foot = this.local(RAMP_FOOT.clone());
    this.aliens.forEach((a, i) => {
      a.outAt = undefined;
      if (!a.visible) {
        a.state = 'inside';
        return;
      }
      a.later(delay + i * 0.5, () => {
        if (this.phase !== 'boarding') return;
        a.model.pivot.rotation.set(0, 0, 0);
        a.walkTo([foot, hatch], () => {
          a.removeBody();
          a.show(false);
          a.state = 'inside';
        });
      });
    });
    this.aliensOut = false;
    this.game.sfx('slop_voice', this.center, 0.3, 2.1);
  }

  private buildLanded() {
    const game = this.game;
    if (this.landedBody) return;
    _q.setFromAxisAngle(UP, this.yaw);
    const desc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(this.center.x, this.center.y, this.center.z)
      .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    const wg = groups(G.WORLD);
    const cds: RAPIER_T.ColliderDesc[] = [RAPIER.ColliderDesc.cylinder(DISC_HALF, DISC_R).setTranslation(0, DISC_Y, 0).setCollisionGroups(wg)];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      cds.push(RAPIER.ColliderDesc.cylinder(0.14, 0.45).setTranslation(Math.sin(a) * LEG_R, 0.14, Math.cos(a) * LEG_R).setCollisionGroups(wg));
    }
    const d = RAMP_FOOT.clone().sub(HATCH);
    const mid = HATCH.clone().lerp(RAMP_FOOT, 0.5);
    const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.atan2(-d.y, d.z));
    cds.push(
      RAPIER.ColliderDesc.cuboid(0.75, 0.05, RAMP_LEN / 2)
        .setTranslation(mid.x, mid.y - 0.05, mid.z)
        .setRotation({ x: rq.x, y: rq.y, z: rq.z, w: rq.w })
        .setCollisionGroups(wg)
        .setFriction(1),
    );
    this.landedBody = game.physics.createBody(desc, cds);
    game.physics.refreshQueries();
  }

  private removeLanded() {
    if (!this.landedBody) return;
    this.game.physics.removeBody(this.landedBody);
    this.landedBody = null;
    this.game.physics.refreshQueries();
  }

  /** Saucer-local → world (into `out`). */
  private local(out: THREE.Vector3) {
    return out.applyAxisAngle(UP, this.yaw).add(this.center);
  }

  // ============================================================================================== reactions
  onPet(a: Alien) {
    const game = this.game;
    if (a.sayCd > 0) return;
    a.sayCd = 1.2;
    a.say(pick(PET_LINES), 2.6);
    a.hopV = 2.4;
    game.sfx('squeak', a.pos, 0.6, 1.8);
    fx(game, 'hearts', a.pos.clone().setY(a.pos.y + 1.1), { count: 6 });
    objSet(game, 'probedPetted', 1);
  }

  onBonk(a: Alien) {
    const game = this.game;
    if (a.state === 'tumble' || a.state === 'inside') return;
    const p = playerOf(game)?.position as THREE.Vector3 | undefined;
    a.tumble(p ?? this.center);
    a.say(pick(BONK_LINES), 2.6);
    game.sfx('boing', a.pos, 0.7, 1.5);
    game.sfx('squeak', a.pos, 0.5, 2);
    fx(game, 'bonk', a.pos.clone().setY(a.pos.y + 0.8));
    game.score(60, 'Interplanetary Incident', a.pos.clone().setY(a.pos.y + 1.4));
    // the others are appalled
    for (const o of this.aliens) if (o !== a && o.state === 'idle') o.hopV = 2;
  }

  onWash(a: Alien) {
    const game = this.game;
    if (a.sayCd > 0) return;
    a.sayCd = 1.5;
    a.say(pick(WASH_LINES), 2.8);
    fx(game, 'question', a.pos.clone().setY(a.pos.y + 1.4));
    game.score(80, 'Decontaminated', a.pos.clone().setY(a.pos.y + 1.4));
  }

  private onWashNear() {
    if (this.phase !== 'landed' || !this.aliensOut) return;
    const p = playerOf(this.game)?.position as THREE.Vector3 | undefined;
    if (!p) return;
    for (const a of this.aliens) {
      if (a.state === 'idle' && a.pos.distanceTo(p) < 3 && a.sayCd <= 0) {
        a.sayCd = 3;
        a.say('WHAT IS HE DOING WITH THE WATER?', 2.4);
        break;
      }
    }
  }

  private onChitter(pos?: THREE.Vector3) {
    if (this.phase !== 'landed' || !this.aliensOut || !pos || this.chitterCd > 0) return;
    if (pos.distanceTo(this.center) > 10) return;
    this.chitterCd = 2.5;
    const game = this.game;
    this.aliens.forEach((a, i) => {
      if (a.state !== 'idle' && a.state !== 'walk') return;
      a.bowT = 1.1;
      if (i === 0 || Math.random() < 0.4) a.say(pick(CHITTER_LINES), 2.2);
      game.sfx('chitter', a.pos, 0.6, 1.8 + i * 0.2);
    });
    if (!this.firstContact) {
      this.firstContact = true;
      game.score(100, 'First Contact', this.center.clone().setY(this.center.y + 2));
    }
  }

  // ============================================================================================== abduction (cartoon)
  private updateAbduct(dt: number, player: any) {
    const game = this.game;
    const S = this.s!;
    const root = S.root.position;
    if (this.abductT < 0) {
      const canPhase = this.phase === 'hover' || this.phase === 'liftoff' || (this.phase === 'descend' && this.t > 5);
      const leg = this.phase === 'liftoff' ? 'up' : 'down';
      if (!canPhase || this.abducted[leg] || !player || player.frozen || !playerFree(game) || sceneBusy(game)) return;
      if (player.mode !== 'walk' && player.mode !== 'roll') return;
      const p = player.position as THREE.Vector3;
      const bottom = root.y + DISC_BOTTOM;
      if (Math.hypot(p.x - root.x, p.z - root.z) > 3 || bottom - p.y < 7 || bottom - p.y > 22) return;
      const extras = game.get<any>('extras');
      if (extras && !extras.claim('ufo')) return;
      this.claimed = !!extras;
      if (player.held) player.release(false);
      if (player.mode !== 'walk') player.setMode?.('walk');
      player.frozen = true;
      this.abductFrom.copy(p);
      this.abductT = 0;
      this.abducted[leg] = true;
      game.sfx('sparkle', p, 0.8, 0.5);
      game.sfx('whoosh', p, 0.5, 1.8);
      game.hint('Jimothy is being abducted! (Briefly. Politely.)', 2.5);
      game.events.emit('ufoAbduct', {});
      return;
    }
    this.abductT += dt;
    const u = this.abductT / 2.4;
    if (!player?.body) return this.endAbduct(false);
    const target = _v.copy(this.abductFrom);
    target.x = lerp(this.abductFrom.x, root.x, smooth(Math.min(1, u * 2)));
    target.z = lerp(this.abductFrom.z, root.z, smooth(Math.min(1, u * 2)));
    target.y = this.abductFrom.y + smooth(Math.min(1, u)) * 3.6;
    this.steer(player, target, dt);
    if (u >= 1) this.endAbduct(true);
  }

  private endAbduct(drop: boolean) {
    if (this.abductT < 0) return;
    this.abductT = -1;
    const game = this.game;
    const player = playerOf(game);
    this.freePlayer();
    if (drop && player) {
      player.ragdoll?.('ufo', 1.1);
      game.score(150, 'Briefly Abducted', player.position.clone().setY(player.position.y + 1));
      game.hint(pick(['The aliens put Jimothy back. "WRONG SIZE."', 'Returned to sender. The aliens say "TOO ROUND TO PROBE."', 'Catch and release. Very professional.']), 3);
      game.sfx('boing', player.position, 0.6, 0.9);
    }
  }

  private freePlayer() {
    const game = this.game;
    const player = playerOf(game);
    if (player) {
      player.frozen = false;
      player.body?.setGravityScale(player.gravityMul ?? 1, true);
    }
    if (this.claimed) {
      game.get<any>('extras')?.release('ufo');
      this.claimed = false;
    }
  }

  /** Steer Jimothy's velocity so he ends this step at `target` (no gravity). */
  private steer(player: any, target: THREE.Vector3, dt: number, cap = 60) {
    const b = player.body;
    if (!b) return;
    const p = player.position as THREE.Vector3;
    const inv = 1 / Math.max(dt, 1 / 240);
    let vx = (target.x - p.x) * inv;
    let vy = (target.y - p.y) * inv;
    let vz = (target.z - p.z) * inv;
    const sp = Math.hypot(vx, vy, vz);
    if (sp > cap) {
      vx *= cap / sp;
      vy *= cap / sp;
      vz *= cap / sp;
    }
    b.setLinvel({ x: vx, y: vy, z: vz }, true);
    b.setGravityScale(0, true);
  }

  // ============================================================================================== the gift: a joyride
  private updateGift(dt: number, player: any) {
    const game = this.game;
    const root = this.s!.root.position;
    this.giftT += dt;
    this.wobble = 0.07;
    const p = player?.position as THREE.Vector3 | undefined;
    const avail = !!p && !player.frozen && playerFree(game) && !sceneBusy(game) && (player.mode === 'walk' || player.mode === 'roll' || player.mode === 'swim');
    const far = !p || p.distanceTo(root) > 70;
    if (far || this.giftT > 25) {
      // no one to give a ride to: a souvenir instead
      if (this.giftT > 25 || far) {
        game.score(500, 'Alien Souvenir', p?.clone());
        game.hint('The aliens could not find the Round Leader for his ride. They left a thank-you note in the sky. (+500)', 4);
        this.startZoom();
      }
      return;
    }
    // float over to hover above him
    const want = _v.copy(p).setY(Math.max(p.y, this.center.y) + HOVER_H - 1);
    const d = _v2.copy(want).sub(root);
    const dist = d.length();
    const step = Math.min(dist, 9 * dt);
    if (dist > 0.001) root.addScaledVector(d.normalize(), step);
    root.y += Math.sin(this.t * 2.5) * 0.01;
    const flat = Math.hypot(p.x - root.x, p.z - root.z);
    if (avail) prompt(game, 'Stand still... the aliens are offering you a ride!', 0.3);
    if (avail && flat < 1.6 && this.giftT > 1.2) this.startPickup(player);
  }

  private startPickup(player: any) {
    const game = this.game;
    const extras = game.get<any>('extras');
    if (extras && !extras.claim('ufo')) return;
    this.claimed = !!extras;
    if (player.held) player.release(false);
    if (player.mode !== 'walk') player.setMode?.('walk');
    player.frozen = true;
    this.pickFrom.copy(player.position);
    this.phase = 'pickup';
    this.t = 0;
    game.events.emit('ufoGift', {});
    game.get<any>('world')?.poi?.delete('ufo');
    game.sfx('sparkle', player.position, 0.9, 0.6);
    game.sfx('whoosh', player.position, 0.6, 1.4);
    celebrate(game, 'BEAM ME UP', 'Keep your paws inside the beam', '#7dff6a');
    this.buildRide();
    this.startCamera();
  }

  private buildRide() {
    const game = this.game;
    const start = this.s!.root.position.clone();
    const noodleTop = poi(game, 'spaceNoodleTop', new THREE.Vector3(120, 62, -12));
    const noodleBase = poi(game, 'spaceNoodleBase', new THREE.Vector3(128, 0.5, -12));
    const nc = new THREE.Vector3(noodleTop.x + 8, noodleTop.y, noodleTop.z); // the Noodle's axis
    const den = poi(game, 'den', new THREE.Vector3(0, 0.3, 40));
    this.dropAt.copy(noodleTop).add(new THREE.Vector3(0, 0.45, 0));
    const hoverEnd = new THREE.Vector3(noodleTop.x, noodleTop.y + HANG + 7.5, noodleTop.z);
    const cruise = Math.max(48, noodleTop.y + 14);
    const pts = [
      start,
      start.clone().add(new THREE.Vector3(0, 22, 0)),
      new THREE.Vector3(den.x, cruise, den.z),
      new THREE.Vector3(den.x + 40, cruise + 6, den.z - 50), // over Old Ballard toward the Hills
      new THREE.Vector3(nc.x - 30, cruise + 10, nc.z - 55),
      new THREE.Vector3(nc.x + 45, cruise + 4, nc.z - 30), // a loop round the Space Noodle
      new THREE.Vector3(nc.x + 40, cruise, nc.z + 40),
      new THREE.Vector3(nc.x - 30, cruise + 2, nc.z + 30),
      hoverEnd.clone().add(new THREE.Vector3(-18, 4, 0)),
      hoverEnd,
    ];
    void noodleBase;
    this.ride = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    this.rideT = 0;
  }

  private updateRide(dt: number, player: any) {
    const game = this.game;
    const root = this.s!.root.position;
    if (!player?.body) return this.finishRide(true);
    // something else took over Jimothy (finale…): hand him back safely
    const extras = game.get<any>('extras');
    if (this.claimed && extras && extras.busy !== 'ufo') return this.finishRide(true);
    this.wobble = 0.09;
    if (this.phase === 'pickup') {
      const u = clamp(this.t / 2.2, 0, 1);
      const hang = _v.copy(root).setY(root.y + DISC_BOTTOM - HANG);
      const target = _v2.copy(this.pickFrom).lerp(hang, smooth(u));
      this.steer(player, target, dt);
      if (u >= 1) {
        this.phase = 'ride';
        this.t = 0;
        game.sfx('whoosh', root, 0.8, 0.7);
        game.hint('Wheeee! A tractor-beam tour of Ballard. Courtesy of space.', 3.5);
      }
      return;
    }
    if (this.phase === 'ride') {
      this.rideT = Math.min(1, this.rideT + dt / RIDE_SECS);
      // ease in/out along the arc length
      const u = this.rideT < 0.5 ? 2 * this.rideT * this.rideT : 1 - Math.pow(-2 * this.rideT + 2, 2) / 2;
      this.ride!.getPointAt(u, root);
      this.steer(player, _v.copy(root).setY(root.y + DISC_BOTTOM - HANG), dt, 120);
      player.facing = dampAngle(player.facing, Math.atan2(this.vel.x, this.vel.z), 3, dt);
      if (this.rideT >= 1) {
        this.phase = 'drop';
        this.t = 0;
        this.pickFrom.copy(player.position);
        game.sfx('sparkle', root, 0.7, 0.8);
      }
      return;
    }
    // drop: lower him gently onto the deck
    const u = clamp(this.t / 2.6, 0, 1);
    root.y += Math.sin(this.t * 2.5) * 0.005;
    const target = _v.copy(this.pickFrom).lerp(this.dropAt, smooth(u));
    this.steer(player, target, dt, 20);
    if (u >= 1) this.finishRide(false);
  }

  private finishRide(aborted: boolean) {
    const game = this.game;
    const player = playerOf(game);
    const cam = this.camFn;
    this.camFn = null;
    if (player) {
      // a teleport is not a fall: no 60 m "landing" after the ride
      player.frozen = false;
      if (!aborted || this.phase === 'drop' || this.phase === 'ride') player.teleport(this.dropAt.clone(), player.facing);
      player.body?.setGravityScale(player.gravityMul ?? 1, true);
      player.body?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.freePlayer();
    releaseCamera(game, cam);
    const done = !aborted;
    if (done) {
      objSet(game, 'closeEncounter', 1);
      game.score(400, 'Close Encounter', this.dropAt.clone().setY(this.dropAt.y + 1));
      celebrate(game, 'CLOSE ENCOUNTER', 'Dropped off on the Space Noodle. Five stars.', '#7dff6a');
      game.sfx('jingle_win', undefined, 0.6);
      fx(game, 'sparkles', this.dropAt, { count: 24, radius: 1.2, color: 0x9dffb0 });
      game.hint('The aliens drop Jimothy on the Space Noodle deck and honk goodbye. Honk honk.', 4);
      this.news(['Raccoon seen riding a UFO over Ballard. For once, the footage is NOT AI.', 'UFO drops off local raccoon at the Space Noodle. Elevator operators: "Hey!"']);
    }
    game.events.emit('ufoJoyride', { done });
    this.startZoom();
  }

  private startCamera() {
    const game = this.game;
    const rig = rigOf(game);
    if (!rig) return;
    this.camLook.copy(game.camera.position).add(_v.set(0, 0, -1).applyQuaternion(game.camera.quaternion).multiplyScalar(6));
    const want = new THREE.Vector3();
    const subj = new THREE.Vector3();
    const dir = new THREE.Vector3(0, 0, 1);
    const fn = (cam: THREE.PerspectiveCamera, dt: number) => {
      if (game.paused || !this.s) return;
      const d = Math.min(dt, 0.1);
      const pl = playerOf(game);
      const sp = this.s.root.position;
      subj.copy(sp).setY(sp.y + DISC_BOTTOM);
      if (pl) subj.lerp(pl.position, 0.65);
      // chase from behind the flight direction, a little to the side and above
      const fl = _v3.set(this.vel.x, 0, this.vel.z);
      if (fl.lengthSq() > 4) dir.lerp(fl.normalize(), 1 - Math.exp(-d * 1.5)).normalize();
      const side = _v2.set(dir.z, 0, -dir.x);
      const dist = this.phase === 'ride' ? 10 : 8;
      want.copy(subj).addScaledVector(dir, -dist).addScaledVector(side, 4.5).add(_v.set(0, this.phase === 'ride' ? 3 : 2, 0));
      aboveGround(game, want, 1);
      cam.position.lerp(want, 1 - Math.exp(-d * (this.phase === 'ride' ? 8 : 3)));
      this.camLook.lerp(subj, 1 - Math.exp(-d * 6));
      cam.lookAt(this.camLook);
      cam.fov += (62 - cam.fov) * (1 - Math.exp(-d * 2));
      cam.updateProjectionMatrix();
    };
    this.camFn = fn;
    rig.override = fn;
  }

  // ============================================================================================== leaving
  private startZoom() {
    const game = this.game;
    const S = this.s;
    if (!S) return this.vanish();
    this.removeLanded();
    for (const a of this.aliens) {
      a.removeBody();
      a.show(false);
      a.state = 'inside';
    }
    this.aliensOut = false;
    this.wantRamp = 0;
    this.phase = 'zoom';
    this.t = 0;
    // up and away (toward the far horizon)
    this.from.copy(S.root.position);
    const a = rand(0, Math.PI * 2);
    this.to.copy(this.from).add(_v.set(Math.cos(a) * 100, 70, Math.sin(a) * 100));
    game.sfx('whoosh', S.root.position, 0.9, 2.2);
    game.sfx('slop_glitch', S.root.position, 0.4, 2.2);
    game.get<any>('world')?.poi?.delete('ufo');
  }

  private vanish() {
    const game = this.game;
    this.endAbduct(true);
    if (this.camFn) {
      releaseCamera(game, this.camFn);
      this.camFn = null;
    }
    if (this.claimed) this.freePlayer();
    this.removeLanded();
    for (const b of this.beams) b.obj.removeFromParent();
    this.beams.length = 0;
    for (const a of this.aliens) {
      a.removeBody();
      a.show(false);
      a.state = 'inside';
      a.model.root.removeFromParent();
    }
    if (this.s) {
      this.s.root.removeFromParent();
      this.s.itemBeam.removeFromParent();
      this.s.beam.visible = false;
    }
    game.get<any>('world')?.poi?.delete('ufo');
    if (this.tracked) {
      this.tracked = false;
      try {
        const guide = uiOf(game)?.guide;
        if (guide?.customPoi?.name === 'ufo') guide.untrack();
      } catch {
        /* optional */
      }
    }
    this.phase = 'absent';
    this.site = null;
    const night = (game.get<any>('environment')?.nightFactor ?? 0) > 0.5;
    this.nextAt = this.playT + rand(480, 600) * (night ? 0.6 : 1);
    game.events.emit('ufoLeave', {});
  }
}
