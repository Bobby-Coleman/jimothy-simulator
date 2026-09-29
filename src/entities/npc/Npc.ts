import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import { destroyProp } from '../Props';
import { buildHuman, type HumanRig } from './HumanModel';
import { Animator, type Gesture } from './Animator';
import { Ragdoll } from './Ragdoll';
import { randomLook, makeRng, TYPE_INFO, pickHolding, type Look, type Rng } from './Looks';
import { spawnItem, attachItem, detachItem, poseItem } from './Items';
import { line, type LineKey } from './lines';
import type { NpcSystem } from './NpcSystem';
import type { Expression, HoldingKind, InteractHook, NpcSpawnOptions, NpcState, NpcType } from './types';

const UP = new THREE.Vector3(0, 1, 0);
const WALKER_FILTER = G.PLAYER | G.PROP | G.RAGDOLL | G.VEHICLE | G.ANIMAL | G.TRIGGER;
const GROUND_FILTER = groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE);
const OBSTACLE_FILTER = groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE);
const LOS_FILTER = groups(G.ALL, G.WORLD);
const GRAVITY = 14;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function dampAngle(a: number, b: number, k: number, dt: number) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-k * dt));
}

export interface KnockOptions {
  cause: string;
  /** Impulse in N·s spread over the body (a share goes to the part nearest `point`). */
  impulse?: THREE.Vector3;
  point?: THREE.Vector3;
  /** Velocity change added to every part (m/s). */
  dv?: THREE.Vector3;
  /** Credit Jimothy (score popups, STRIKE!). */
  byPlayer?: boolean;
  /** Extra flailing strength (default 1). */
  flail?: number;
  /** The entity that hit us (thrown prop, vehicle, other ragdoll...). */
  by?: Entity;
}

type CustomFn = (npc: Npc, dt: number, game: Game) => void;

/**
 * One chunky human. Walks as a kinematic capsule (group G.NPC) with a procedural animation,
 * turns into a jointed ragdoll (group G.RAGDOLL) when knocked over, and gets back up.
 * Created through `NpcSystem.spawn()`.
 */
export class Npc {
  readonly type: NpcType;
  readonly entity: Entity;
  readonly look: Look;
  readonly rig: HumanRig;
  readonly anim: Animator;
  name: string;
  state: NpcState = 'idle';
  expression: Expression = 'neutral';
  /** Pose chosen by the built-in brain. */
  private act: Gesture = 'none';
  private gestureOverride: Gesture | null = null;
  private overrideUntil = 0;
  private emoteGesture: Gesture | null = null;
  private emoteUntil = 0;
  private lookOverride: 'player' | THREE.Vector3 | null = null;
  private lookOverrideUntil = 0;
  /** Quest hook: return true to consume the interaction (see InteractKind). */
  onInteract?: InteractHook;
  /** Feet position while walking; ground under the pelvis while ragdolled. */
  readonly position = new THREE.Vector3();
  /** Horizontal walking velocity. */
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  passive: boolean;
  stationary: boolean;
  lookAtPlayer: boolean;
  held: Entity | null = null;
  ragdollState: Ragdoll | null = null;
  removed = false;
  /** Tick bookkeeping for the system's LOD. */
  lodAccum = 0;
  visible = true;
  camDist = 0;
  readonly home: { center: THREE.Vector3; radius: number };
  readonly walkSpeed: number;
  readonly runSpeed: number;
  /** Knocked down by Jimothy (for score bonuses when landing). */
  knockByPlayer = false;
  knockedAt = -100;
  lastScolded = -100;
  /** Separation push computed by the system each frame. */
  readonly sep = new THREE.Vector3();
  readonly idx: number;

  private game: Game;
  private sys: NpcSystem;
  private rng: Rng;
  readonly walker: RAPIER.RigidBody;
  readonly walkerCollider: RAPIER.Collider;
  private capsuleCenter: number;
  private feetY = 0;
  private vy = 0;
  private custom: CustomFn | null = null;
  private goal: THREE.Vector3 | null = null;
  private goalSpeed = 1.2;
  private arriveRadius = 0.5;
  private arrived = false;
  private faceTarget: 'player' | THREE.Vector3 | Npc | null = null;
  private yawOverride: number | null = null;
  private stateTime = 0;
  private timer = 0;
  private sub = 0;
  private perceiveTimer = Math.random() * 0.3;
  private noticeCooldown = 0;
  private nextReaction: NpcState = 'watch';
  private lastFilmedEmit = -100;
  private flashTimer = 0;
  private fleeFrom = new THREE.Vector3();
  private said = 0;
  private scoldTarget: Npc | null = null;
  private walkResolve: ((ok: boolean) => void) | null = null;
  private anchored = false;
  private path: THREE.Vector3[] | null = null;
  private pathLoop = false;
  private pathIndex = 0;
  private pathDir = 1;
  private avoidTimer = 0;
  private avoidAngle = 0;
  private avoidCheck = 0;
  private stuckTimer = 0;
  private stuckPos = new THREE.Vector3();
  private cleanUntil = -1;
  private pendingWalk: { goal: THREE.Vector3; speed: number; arrive: number } | null = null;
  private dropped: Entity | null = null;
  private inWaterTime = 0;
  private lastBump = -100;
  private phaseOffset = Math.random() * 10;

  constructor(sys: NpcSystem, game: Game, opts: NpcSpawnOptions, idx: number) {
    this.sys = sys;
    this.game = game;
    this.idx = idx;
    this.type = opts.type;
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = makeRng(seed);
    this.look = randomLook(opts.type, this.rng, opts.outfit);
    const info = TYPE_INFO[opts.type];
    this.name = opts.name ?? info.display;
    this.passive = !!opts.passive;
    this.stationary = !!opts.stationary;
    this.lookAtPlayer = !!opts.lookAtPlayer;
    this.walkSpeed = info.walkSpeed * (0.9 + this.rng() * 0.2);
    this.runSpeed = info.runSpeed * (0.92 + this.rng() * 0.16);
    this.yaw = opts.facing ?? this.rng() * Math.PI * 2;

    this.rig = buildHuman(this.look);
    this.anim = new Animator(this.rig);
    game.scene.add(this.rig.root);

    // placement
    const p = opts.position;
    this.feetY = this.groundAt(p.x, p.z, p.y + 30, 60);
    this.position.set(p.x, this.feetY, p.z);
    this.home = opts.wander
      ? { center: opts.wander.center.clone(), radius: opts.wander.radius }
      : { center: this.position.clone(), radius: this.stationary ? 0 : 10 };
    if (opts.path && opts.path.length >= 2) {
      this.path = opts.path.map((v) => v.clone());
      this.pathLoop = !!opts.pathLoop;
      // start at the nearest point
      let best = 0;
      let bd = Infinity;
      this.path.forEach((v, i) => {
        const d = v.distanceToSquared(this.position);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      this.pathIndex = best;
      this.pathDir = this.rng() < 0.5 ? 1 : -1;
    }

    // kinematic walker capsule
    const d = this.rig.dims;
    const r = Math.max(0.16, Math.min(0.3, d.chestW * 0.58));
    const bottom = 0.04;
    const top = d.height;
    this.capsuleCenter = bottom + (top - bottom) / 2;
    const hh = Math.max(0.05, (top - bottom) / 2 - r);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, this.feetY + this.capsuleCenter, p.z);
    this.walker = game.physics.world.createRigidBody(desc);
    const cd = RAPIER.ColliderDesc.capsule(hh, r)
      .setCollisionGroups(groups(G.NPC, WALKER_FILTER))
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC)
      .setContactForceEventThreshold(250)
      .setFriction(0.5);
    this.walkerCollider = game.physics.world.createCollider(cd, this.walker);

    this.entity = game.entities.create({
      kind: 'npc',
      name: this.name,
      body: this.walker,
      object: this.rig.root,
      mass: opts.type === 'kid' ? 32 : 70,
      tags: new Set(['npc', 'washable', 'human', opts.type]),
      data: { npc: this, type: opts.type, floatRadius: 0.17, buoyancy: 1.35 },
      onBonk: (g, impulse, point) => this.onBonk(impulse, point),
      onGrab: () => this.onGrab(),
      onWash: () => this.washed(),
    });

    this.applyTransform();
    this.rig.root.updateMatrixWorld(true);

    // held item
    const holding: HoldingKind | null = opts.holding === undefined ? pickHolding(opts.type, this.rng) : opts.holding;
    if (holding) this.giveItem(holding);

    this.setState(this.stationary ? 'idle' : this.rng() < 0.5 ? 'idle' : 'wander');
    this.timer = this.rng() * 3;
  }

  // ================================================================== public API

  get ragdolled() {
    return !!this.ragdollState;
  }

  get alive() {
    return !this.removed;
  }

  /**
   * Upper-body pose ('wave', 'cheer', 'point', 'film', 'phone', 'selfie', 'panic', 'shrug', 'aww', 'scold', 'throw', ...).
   * Setting it overrides the brain: permanently for custom-controlled NPCs, for ~4 s otherwise. 'none' clears it.
   */
  get gesture(): Gesture {
    return this.emoteGesture ?? this.gestureOverride ?? this.act;
  }
  set gesture(g: Gesture) {
    if (g === 'none') {
      this.gestureOverride = null;
      if (this.custom) this.act = 'none';
      return;
    }
    this.gestureOverride = g;
    this.overrideUntil = this.custom ? Infinity : this.game.time + 4;
  }

  /** Play a gesture for `secs` (quests/cutscenes): emote('cheer'), emote('wave', 2), emote('throw'). */
  emote(name: Gesture | string, secs = 1.5) {
    const map: Record<string, Gesture> = { armsUp: 'cheer', celebrate: 'cheer', yay: 'cheer', photo: 'film', scream: 'panic', talk: 'shrug', angry: 'fist' };
    const g = (map[name] ?? name) as Gesture;
    this.emoteGesture = g;
    this.emoteUntil = this.game.time + secs;
  }

  cheer(secs = 1.6) {
    this.emote('cheer', secs);
    this.setExpression('happy');
  }

  /** Stop walking (scripted walkTo) and stay here. */
  stop() {
    this.walkResolve?.(false);
    this.walkResolve = null;
    this.goal = null;
    this.anchored = true;
    this.velocity.set(0, 0, 0);
    if (!this.ragdollState && (this.state === 'walk' || this.state === 'wander')) this.state = this.custom ? 'custom' : 'idle';
  }

  /** Instantly move to `p` (ground-snapped) and optionally face `yaw`. Gets up first if ragdolled. */
  teleport(p: THREE.Vector3, yaw?: number) {
    if (this.ragdollState) this.standUp(true);
    const gy = this.groundAt(p.x, p.z, p.y + 1.5, 6);
    this.position.set(p.x, gy, p.z);
    this.feetY = gy;
    this.vy = 0;
    this.velocity.set(0, 0, 0);
    if (yaw != null) this.yaw = yaw;
    this.walker.setTranslation({ x: p.x, y: gy + this.capsuleCenter, z: p.z }, true);
    this.walker.setNextKinematicTranslation({ x: p.x, y: gy + this.capsuleCenter, z: p.z });
    this.applyTransform();
  }

  /** Turn to a yaw (radians) or toward a point. */
  face(target: number | THREE.Vector3) {
    if (typeof target === 'number') {
      this.yawOverride = target;
      this.yaw = target;
      this.applyTransform();
    } else this.lookAt(target);
  }

  /** World position of the right hand (where held items sit). */
  handPos(out = new THREE.Vector3()) {
    this.rig.root.updateMatrixWorld(true);
    return this.rig.handR.getWorldPosition(out);
  }

  headPos(out = new THREE.Vector3()) {
    return this.headPosition(out);
  }

  /** Say something: emits 'speech' { entity, text, duration } and shows a bubble (unless the UI took over). */
  say(text: string, secs = 2.6) {
    if (this.removed) return;
    this.game.events.emit('speech', { entity: this.entity, text, duration: secs, npc: this });
    this.sys.showBubble(this, text, secs);
  }

  sayLine(key: LineKey, secs?: number) {
    this.say(line(this.type, key), secs);
  }

  setExpression(e: Expression) {
    this.expression = e;
    this.rig.setExpression(e, this.cleanUntil > this.game.time);
  }

  /**
   * Walk to a point. Second arg: a speed in m/s, or { run, arrive, speed }. Resolves true on arrival, false if
   * replaced/stopped/removed. Knockdowns pause the walk; it resumes after getting up. Stays there afterwards.
   */
  walkTo(pos: THREE.Vector3, speedOrOpts?: number | { run?: boolean; arrive?: number; speed?: number }): Promise<boolean> {
    const o = typeof speedOrOpts === 'number' ? { speed: speedOrOpts } : (speedOrOpts ?? {});
    this.walkResolve?.(false);
    this.walkResolve = null;
    if (this.removed) return Promise.resolve(false);
    return new Promise((res) => {
      const goal = pos.clone();
      const speed = o.speed ?? (o.run ? this.runSpeed : this.walkSpeed);
      const arrive = o.arrive ?? 0.45;
      this.anchored = true;
      if (this.ragdollState || this.state === 'getup') {
        this.pendingWalk = { goal, speed, arrive };
      } else {
        this.setState('walk');
        this.goal = goal;
        this.goalSpeed = speed;
        this.arriveRadius = arrive;
        this.arrived = false;
      }
      this.walkResolve = res;
    });
  }

  /** Let the NPC wander again after a scripted walkTo / stop. */
  release() {
    this.anchored = false;
    if (this.state === 'idle' || this.state === 'walk') this.setState('idle');
  }

  /** Turn toward something (or 'player', or null to stop). Temporary (~5 s) unless custom-controlled. */
  lookAt(target: 'player' | THREE.Vector3 | null) {
    if (this.custom) {
      this.faceTarget = target;
      return;
    }
    this.lookOverride = target && target !== 'player' ? target.clone() : target;
    this.lookOverrideUntil = target ? this.game.time + 5 : 0;
  }

  /** Knock over into a ragdoll. `impulse` in N·s (≈ 70 kg body). */
  ragdoll(impulse?: THREE.Vector3, cause = 'script') {
    this.knockDown({ cause, impulse });
  }

  /** Get up from ragdoll now. */
  getUp() {
    if (this.ragdollState) this.standUp();
  }

  /** Scripted control: fn(npc, dt, game) runs every frame instead of the built-in brain. null restores it. */
  setCustom(fn: CustomFn | null) {
    this.custom = fn;
    this.gestureOverride = null;
    this.lookOverride = null;
    if (!fn) this.faceTarget = null;
    if (!this.ragdollState) {
      this.goal = null;
      this.act = 'none';
      this.yawOverride = null;
      this.setState(fn ? 'custom' : 'idle');
    }
  }

  get isCustom() {
    return !!this.custom;
  }

  /** Remove from the world (visual, bodies, held item). */
  remove() {
    if (this.removed) return;
    this.removed = true;
    this.walkResolve?.(false);
    this.walkResolve = null;
    if (this.ragdollState) {
      this.sys.unmapColliders(this.ragdollState.colliders);
      this.ragdollState.destroy();
      this.ragdollState = null;
    }
    if (this.held) destroyProp(this.game, this.held);
    this.held = null;
    this.game.entities.remove(this.entity);
    this.game.physics.removeBody(this.walker);
    this.rig.dispose();
    this.sys.unregister(this);
  }

  /** World position of the head (for bubbles, flashes, look-at). */
  headPosition(out = new THREE.Vector3()) {
    if (this.ragdollState) return this.ragdollState.headPosition(out);
    const d = this.rig.dims;
    return out.set(this.position.x, this.feetY + d.neckY + d.headOff, this.position.z);
  }

  /** Give the NPC an item in the right hand (replaces the current one). */
  giveItem(kind: HoldingKind) {
    if (this.held) destroyProp(this.game, this.held);
    this.rig.root.updateMatrixWorld(true);
    const hp = this.rig.handR.getWorldPosition(new THREE.Vector3());
    const item = spawnItem(this.game, kind, hp);
    item.data.owner = this;
    attachItem(this.game, item, this.rig.handR);
    this.held = item;
    return item;
  }

  // ================================================================== state helpers

  private setState(s: NpcState) {
    if (this.state === 'walk' && s !== 'walk' && this.walkResolve) {
      const r = this.walkResolve;
      this.walkResolve = null;
      r(false);
    }
    this.state = s;
    this.stateTime = 0;
    this.sub = 0;
    this.said = 0;
    this.yawOverride = null;
    if (s !== 'walk') this.arrived = false;
    switch (s) {
      case 'idle':
        this.goal = null;
        this.act = 'none';
        this.faceTarget = null;
        this.timer = 1 + this.rng() * 4;
        if (this.type === 'jogger' || this.type === 'racer') this.timer = 0.2 + this.rng();
        break;
      case 'wander':
        this.pickWanderGoal();
        this.act = 'none';
        this.faceTarget = null;
        break;
      default:
        break;
    }
  }

  private busy() {
    return this.custom != null || this.passive || this.ragdollState != null || (this.state !== 'idle' && this.state !== 'wander');
  }

  /** Can react to ambient stuff (chitter / chaos). */
  canReact() {
    return !this.removed && !this.custom && !this.passive && !this.ragdollState && this.state !== 'getup' && this.state !== 'faint' && this.state !== 'walk';
  }

  private pickWanderGoal() {
    if (this.path) {
      const n = this.path.length;
      if (this.pathLoop) this.pathIndex = (this.pathIndex + this.pathDir + n) % n;
      else {
        let ni = this.pathIndex + this.pathDir;
        if (ni < 0 || ni >= n) {
          this.pathDir *= -1;
          ni = this.pathIndex + this.pathDir;
        }
        this.pathIndex = THREE.MathUtils.clamp(ni, 0, n - 1);
      }
      const t = this.path[this.pathIndex];
      this.goal = new THREE.Vector3(t.x + (this.rng() - 0.5) * 1.2, t.y, t.z + (this.rng() - 0.5) * 1.2);
    } else {
      const c = this.home.center;
      const r = this.home.radius;
      let gx = c.x;
      let gz = c.z;
      for (let i = 0; i < 8; i++) {
        const a = this.rng() * Math.PI * 2;
        const rr = Math.sqrt(this.rng()) * r;
        gx = c.x + Math.cos(a) * rr;
        gz = c.z + Math.sin(a) * rr;
        const gy = this.groundAt(gx, gz, this.feetY + 2, 6);
        if (!this.deepWaterAt(gx, gz, gy) && Math.abs(gy - this.feetY) < 6 && (i > 5 || !this.sys.onRoad(gx, gz))) break;
      }
      this.goal = new THREE.Vector3(gx, 0, gz);
    }
    const jog = this.type === 'jogger' || this.type === 'racer';
    this.goalSpeed = jog ? this.walkSpeed : this.walkSpeed;
    this.arriveRadius = jog ? 1.2 : 0.6;
    this.arrived = false;
    this.stuckTimer = 0;
    this.stuckPos.copy(this.position);
  }

  private resumeWalk() {
    const pw = this.pendingWalk;
    this.pendingWalk = null;
    if (!pw) return;
    const res = this.walkResolve;
    this.setState('walk');
    this.walkResolve = res;
    this.goal = pw.goal;
    this.goalSpeed = pw.speed;
    this.arriveRadius = pw.arrive;
    this.arrived = false;
  }

  // ================================================================== update (walker)

  update(dt: number) {
    if (this.removed || this.ragdollState) return;
    const game = this.game;
    this.stateTime += dt;
    this.timer -= dt;
    if (this.gestureOverride && game.time > this.overrideUntil) this.gestureOverride = null;
    if (this.emoteGesture && game.time > this.emoteUntil) this.emoteGesture = null;
    if (this.lookOverride && game.time > this.lookOverrideUntil) this.lookOverride = null;
    if (this.state === 'getup' && !this.anim.gettingUp && this.pendingWalk && this.sub === 0) this.resumeWalk();
    if (this.custom) {
      try {
        this.custom(this, dt, game);
      } catch (err) {
        console.error('[npcs] custom control failed for', this.name, err);
        this.custom = null;
      }
      if (this.state === 'getup' && !this.anim.gettingUp) {
        if (this.pendingWalk) this.resumeWalk();
        else this.state = 'custom';
      }
    } else if (this.state !== 'walk') {
      this.think(dt);
    }
    if (this.removed || this.ragdollState) return;
    this.locomote(dt);
    if (this.state === 'walk' && this.arrived) {
      const r = this.walkResolve;
      this.walkResolve = null;
      this.goal = null;
      this.state = this.custom ? 'custom' : 'idle';
      this.timer = 2;
      r?.(true);
    }
    if (this.cleanUntil > 0 && game.time > this.cleanUntil) {
      this.cleanUntil = -1;
      this.rig.setExpression(this.expression, false);
    }
  }

  /** Animation + held item pose (only called for visible NPCs). */
  animate(dt: number) {
    if (this.ragdollState) return;
    const game = this.game;
    let lookYaw = 0;
    let lookPitch = 0;
    const target = this.lookTarget(_c);
    if (target) {
      const dx = target.x - this.position.x;
      const dz = target.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      const rel = wrapAngle(Math.atan2(dx, dz) - this.yaw);
      if (Math.abs(rel) < 2.0) {
        lookYaw = rel;
        const eyeY = this.feetY + this.rig.dims.neckY + this.rig.dims.headOff;
        lookPitch = -Math.atan2(target.y - eyeY, Math.max(0.5, dist)) * 0.8;
      }
    }
    this.anim.update(dt, {
      speed: this.velocity.length(),
      time: game.time + this.phaseOffset,
      gesture: this.gesture,
      lookYaw,
      lookPitch,
      holding: !!this.held,
      hunch: this.type === 'grandma' ? 0.2 : 0,
    });
    if (this.held) this.orientHeldItem();
  }

  private lookTarget(out: THREE.Vector3): THREE.Vector3 | null {
    const ft = this.lookOverride ?? this.faceTarget;
    const pl = this.sys.player;
    if (ft === 'player' || (!ft && this.lookAtPlayer && pl && this.position.distanceToSquared(pl.position) < 144)) {
      if (!pl) return null;
      return out.copy(pl.position);
    }
    if (ft instanceof Npc) return ft.headPosition(out);
    if (ft) return out.copy(ft);
    return null;
  }

  /** Pose the held item (a scene-level object) at the right hand, kept upright / screen toward the face. */
  private orientHeldItem() {
    const item = this.held!;
    if (!item.object) return;
    const kind = item.data.itemKind as HoldingKind;
    this.rig.root.updateMatrixWorld(true);
    let pitch = 0;
    let turn = 0;
    if (kind === 'phone') {
      turn = Math.PI; // screen toward the NPC
      const g = this.gesture;
      if (g === 'film') pitch = -0.05;
      else if (g === 'selfie') {
        pitch = 0.45;
        turn = 0;
      } else if (g === 'phone') pitch = -0.95;
      else pitch = -0.7;
    }
    _e.set(pitch, this.yaw + turn, 0, 'YXZ');
    _q2.setFromEuler(_e);
    poseItem(item, this.rig.handR, _q2);
  }

  // ================================================================== brain

  private think(dt: number) {
    const game = this.game;
    const pl = this.sys.player;
    const pp = pl?.position;
    const dp = pp ? Math.hypot(pp.x - this.position.x, pp.z - this.position.z) : Infinity;
    switch (this.state) {
      case 'custom':
        this.setState('idle');
        break;
      case 'idle': {
        this.goal = null;
        if (this.stationary || this.anchored) {
          const hc = this.home.center;
          if (this.stationary && !this.anchored && Math.hypot(hc.x - this.position.x, hc.z - this.position.z) > 1.2) {
            this.goal = hc.clone();
            this.goalSpeed = this.walkSpeed;
            this.arriveRadius = 0.4;
          }
          if (this.lookAtPlayer && dp < 12) this.faceTarget = 'player';
        } else if (this.timer <= 0) {
          this.setState('wander');
          break;
        }
        // idle fidgets
        if (this.act === 'none' || this.act === 'phone' || this.act === 'eat') {
          const k = this.held?.data.itemKind as HoldingKind | undefined;
          if (k === 'phone' && this.stateTime > 0.8) this.act = 'phone';
          else if (k && k !== 'pizza' && k !== 'phone' && Math.sin(game.time * 0.5 + this.idx) > 0.75) this.act = 'eat';
          else if (this.act === 'eat') this.act = 'none';
        }
        break;
      }
      case 'wander': {
        if (this.arrived || !this.goal) {
          this.setState('idle');
          break;
        }
        this.act = this.held?.data.itemKind === 'phone' && this.type === 'techbro' ? 'phone' : 'none';
        this.goalSpeed = this.walkSpeed;
        break;
      }
      case 'notice': {
        this.faceTarget = 'player';
        this.goal = null;
        if (this.timer <= 0) this.beginReaction(this.nextReaction);
        break;
      }
      case 'watch': {
        this.faceTarget = 'player';
        this.goal = null;
        if (this.type === 'kid' && dp > 2.2 && dp < 10 && this.sub === 0) {
          this.goal = pp!.clone();
          this.goalSpeed = this.runSpeed * 0.6;
          this.arriveRadius = 2.0;
        }
        if (this.timer <= 0 || dp > 16) this.finishReaction();
        break;
      }
      case 'film': {
        this.faceTarget = 'player';
        this.act = this.held?.data.itemKind === 'phone' ? 'film' : this.look.camera ? 'camera' : 'film';
        if (dp > 9 && pp) {
          this.goal = pp.clone();
          this.goalSpeed = this.walkSpeed;
          this.arriveRadius = 6;
        } else this.goal = null;
        this.flashTimer -= dt;
        if (this.flashTimer <= 0 && dp < 18 && this.facingDot(pp) > 0.6) {
          this.flashTimer = 0.7 + this.rng() * 1.6;
          this.snapPhoto();
        }
        if (this.timer <= 0 || dp > 22) this.finishReaction();
        break;
      }
      case 'selfie': {
        if (!pp) {
          this.finishReaction();
          break;
        }
        if (this.sub === 0) {
          _a.set(this.position.x - pp.x, 0, this.position.z - pp.z);
          if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0);
          _a.normalize();
          // spread selfie-takers in an arc around Jimothy instead of queueing on one side
          _a.applyAxisAngle(UP, ((this.idx % 5) - 2) * 0.55);
          this.goal = _b.copy(pp).addScaledVector(_a, 1.45).clone();
          this.goalSpeed = this.runSpeed * 0.7;
          this.arriveRadius = 0.35;
          this.act = 'none';
          this.faceTarget = null;
          if (this.arrived || (dp < 1.9 && this.stateTime > 0.5) || this.stateTime > 7) {
            this.sub = 1;
            this.timer = 2.8;
            this.goal = null;
            this.flashTimer = 0.9;
            this.sayLine('selfie');
          }
        } else {
          this.goal = null;
          this.yawOverride = Math.atan2(this.position.x - pp.x, this.position.z - pp.z);
          this.act = 'selfie';
          this.setExpression('happy');
          this.flashTimer -= dt;
          if (this.flashTimer <= 0) {
            this.flashTimer = 1.1;
            this.snapPhoto();
          }
          if (this.timer <= 0) {
            this.yawOverride = null;
            this.finishReaction();
          }
        }
        break;
      }
      case 'flee': {
        _a.set(this.position.x - this.fleeFrom.x, 0, this.position.z - this.fleeFrom.z);
        if (_a.lengthSq() < 1e-4) _a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        _a.normalize();
        this.goal = _b.copy(this.position).addScaledVector(_a, 6).clone();
        this.goalSpeed = this.runSpeed;
        this.arriveRadius = 0.5;
        this.act = 'panic';
        this.faceTarget = null;
        if (this.timer <= 0) {
          this.setExpression(this.type === 'kid' ? 'happy' : 'sad');
          this.setState('idle');
          this.timer = 1.5;
        }
        break;
      }
      case 'chase': {
        if (!pp) {
          this.setState('idle');
          break;
        }
        this.goal = pp.clone();
        this.goalSpeed = this.runSpeed * 0.9;
        this.arriveRadius = 1.1;
        this.act = 'fist';
        this.faceTarget = 'player';
        if (dp < 1.5 && !(this.said & 1)) {
          this.said |= 1;
          this.sayLine('caught', 2);
        }
        if (this.timer <= 0) {
          this.sayLine('giveUp');
          this.setExpression('sad');
          this.setState('idle');
          this.noticeCooldown = game.time + 12;
        }
        break;
      }
      case 'kitty':
        this.thinkKitty(dt, dp);
        break;
      case 'faint': {
        this.goal = null;
        this.act = 'shock';
        this.faceTarget = 'player';
        if (this.timer <= 0) {
          _a.set(-Math.sin(this.yaw), 0.4, -Math.cos(this.yaw));
          this.knockDown({ cause: 'faint', dv: _a.multiplyScalar(2.2), flail: 0.2 });
        }
        break;
      }
      case 'scold':
        this.thinkScold(dt);
        break;
      case 'retreat': {
        if (pp) {
          _a.set(this.position.x - pp.x, 0, this.position.z - pp.z).normalize();
          this.goal = _b.copy(this.position).addScaledVector(_a, 4).clone();
          this.goalSpeed = this.walkSpeed;
        }
        this.act = 'none';
        if (this.timer <= 0) this.setState('idle');
        break;
      }
      case 'baffled': {
        this.goal = null;
        this.act = 'baffled';
        this.faceTarget = null;
        if (this.timer <= 0) {
          this.setExpression('neutral');
          this.setState('idle');
        }
        break;
      }
      case 'fetch': {
        const it = this.dropped;
        if (!it || !it.alive || it.data.heldByPlayer || it.data.heldByNpc || !it.body) {
          if (it && it.alive && it.data.heldByPlayer) this.startChase();
          else this.setState('idle');
          break;
        }
        const t = it.body.translation();
        this.goal = _a.set(t.x, t.y, t.z).clone();
        this.goalSpeed = this.walkSpeed * 1.2;
        this.arriveRadius = 0.75;
        if (Math.hypot(t.x - this.position.x, t.z - this.position.z) < 0.9 && Math.abs(t.y - this.feetY) < 1.6) {
          attachItem(this.game, it, this.rig.handR);
          this.held = it;
          this.dropped = null;
          this.sayLine('fetch', 1.8);
          this.setExpression('happy');
          this.setState('idle');
        } else if (this.stateTime > 10) this.setState('idle');
        break;
      }
      case 'getup': {
        this.goal = null;
        if (this.sub === 0 && !this.anim.gettingUp) {
          this.sub = 1;
          this.timer = 1.3;
          this.act = this.type === 'kid' ? 'cheer' : 'dust';
          this.sayLine('getup', 2.4);
        }
        if (this.sub === 1 && this.timer <= 0) {
          this.act = 'none';
          const it = this.dropped;
          if (it && it.alive && !it.data.heldByNpc && it.body) {
            const t = it.body.translation();
            const far = Math.hypot(t.x - this.position.x, t.z - this.position.z) > 9;
            if (it.data.heldByPlayer) {
              this.startChase();
              break;
            } else if (!far) {
              this.setState('fetch');
              break;
            }
          }
          this.dropped = null;
          this.setState('idle');
          if (this.stationary || this.anchored) this.timer = 1;
        }
        break;
      }
      default:
        break;
    }

    if (!this.passive && !this.custom) {
      this.perceiveTimer -= dt;
      if (this.perceiveTimer <= 0) {
        this.perceiveTimer = 0.25 + this.rng() * 0.12;
        this.perceive(dp);
      }
    }
  }

  private facingDot(p?: THREE.Vector3) {
    if (!p) return 0;
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    const l = Math.hypot(dx, dz) || 1;
    return (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / l;
  }

  private perceive(dp: number) {
    const game = this.game;
    if (this.state !== 'idle' && this.state !== 'wander') return;
    if (game.time < this.noticeCooldown) return;
    const pl = this.sys.player;
    if (!pl || pl.mode === 'ragdoll') return;
    const radius = this.type === 'fan' ? 12 : 9;
    if (dp > radius) return;
    if (!this.canSee(pl.position)) return;
    this.noticeCooldown = game.time + 18 + this.rng() * 14;

    // "Not a cat" — someone sees him from behind
    const f = pl.facing;
    _a.set(this.position.x - pl.position.x, 0, this.position.z - pl.position.z).normalize();
    const facingDot = Math.sin(f) * _a.x + Math.cos(f) * _a.z;
    const kittyTypes: NpcType[] = ['pedestrian', 'grandma', 'tourist', 'techbro', 'fan'];
    if (kittyTypes.includes(this.type) && dp < 6 && dp > 1.8 && facingDot < -0.35 && this.sys.kittyReady() && this.rng() < this.sys.kittyChance) {
      this.startKitty();
      return;
    }

    const has = this.held?.data.itemKind as HoldingKind | undefined;
    let next: NpcState = 'watch';
    switch (this.type) {
      case 'pedestrian':
        next = has === 'phone' && this.rng() < 0.65 ? 'film' : 'watch';
        break;
      case 'tourist':
        next = has === 'phone' || this.look.camera ? 'film' : 'watch';
        break;
      case 'fan':
        next = has === 'phone' ? (this.rng() < 0.55 ? 'selfie' : 'film') : 'watch';
        break;
      case 'techbro':
        next = has === 'phone' ? 'film' : 'watch';
        break;
      case 'jogger':
      case 'racer':
      case 'officer':
        // shout-out without stopping
        if (this.rng() < 0.6) this.sayLine('notice', 2);
        this.faceTarget = null;
        return;
      default:
        next = 'watch';
    }
    this.nextReaction = next;
    this.setState('notice');
    this.timer = 0.7 + this.rng() * 0.5;
    this.setExpression(this.type === 'fan' || this.type === 'kid' ? 'happy' : this.rng() < 0.5 ? 'aww' : 'shock');
    this.sayLine('notice', 2.2);
  }

  private canSee(p: THREE.Vector3) {
    const head = this.headPosition(_b);
    _a.copy(p).sub(head);
    const dist = _a.length();
    if (dist < 0.5) return true;
    const hit = this.game.physics.raycast(head, _a, dist - 0.3, LOS_FILTER);
    return !hit;
  }

  private beginReaction(next: NpcState) {
    const pl = this.sys.player;
    this.setState(next);
    switch (next) {
      case 'watch':
        this.timer = 2.5 + this.rng() * 3;
        this.act = this.type === 'kid' || this.type === 'fan' ? 'cheer' : this.type === 'mayor' || this.type === 'dean' || this.type === 'fishmonger' ? 'wave' : 'aww';
        this.setExpression(this.type === 'kid' || this.type === 'fan' ? 'happy' : 'aww');
        if (this.act === 'aww' && this.rng() < 0.35) this.game.sfx('crowd_aww', this.position, 0.35);
        break;
      case 'film':
        this.timer = 4 + this.rng() * 4;
        this.flashTimer = 0.4 + this.rng() * 0.6;
        this.setExpression('happy');
        if (this.rng() < 0.5) this.sayLine('film', 2.2);
        break;
      case 'selfie':
        this.setExpression('happy');
        break;
      default:
        break;
    }
    void pl;
  }

  private finishReaction() {
    this.setExpression('neutral');
    this.setState(this.stationary || this.anchored ? 'idle' : this.rng() < 0.6 ? 'wander' : 'idle');
  }

  private snapPhoto() {
    const game = this.game;
    const pos = new THREE.Vector3();
    if (this.held?.object && this.held.data.itemKind === 'phone') {
      this.held.object.getWorldPosition(pos);
    } else {
      this.headPosition(pos);
      pos.x += Math.sin(this.yaw) * 0.25;
      pos.z += Math.cos(this.yaw) * 0.25;
    }
    this.sys.flash(pos);
    game.events.emit('cameraFlash', { position: pos, by: this.entity, npc: this });
    if (game.time - this.lastFilmedEmit >= 20) {
      this.lastFilmedEmit = game.time;
      game.events.emit('filmed', { by: this.entity, npc: this, position: pos.clone() });
    }
  }

  // ------------------------------------------------------------------ not a cat
  private startKitty() {
    this.setState('kitty');
    this.timer = 4.2;
    this.setExpression('happy');
    this.sayLine('kitty', 3);
    this.sys.useKitty();
  }

  private thinkKitty(dt: number, dp: number) {
    const pl = this.sys.player;
    if (!pl) {
      this.setState('idle');
      return;
    }
    const pp = pl.position;
    this.faceTarget = 'player';
    this.act = 'kitty';
    _a.set(this.position.x - pp.x, 0, this.position.z - pp.z);
    if (_a.lengthSq() < 1e-4) _a.set(0, 0, 1);
    _a.normalize();
    if (dp > 2.0) {
      this.goal = _b.copy(pp).addScaledVector(_a, 1.7).clone();
      this.goalSpeed = 0.7;
      this.arriveRadius = 0.3;
    } else this.goal = null;
    const f = pl.facing;
    const dot = Math.sin(f) * _a.x + Math.cos(f) * _a.z;
    if (dot > 0.45 && dp < 7 && pl.mode !== 'roll') {
      this.notACat();
      return;
    }
    if (this.timer <= 0) {
      if (this.sub === 0) {
        this.sub = 1;
        this.timer = 3;
        this.sayLine('kitty2', 2.5);
      } else {
        this.sayLine('kittyGiveUp', 2);
        this.setExpression('neutral');
        this.setState('idle');
      }
    }
    if (dp > 10) this.setState('idle');
  }

  private notACat() {
    const game = this.game;
    this.setState('faint');
    this.timer = 0.75;
    this.goal = null;
    this.setExpression('shock');
    this.sayLine('notACat', 2.5);
    this.sys.scream(this.position);
    game.events.emit('notACat', { npc: this, entity: this.entity, position: this.position.clone() });
    game.score(300, 'Not A Cat', this.headPosition(new THREE.Vector3()));
  }

  // ------------------------------------------------------------------ officer
  startScold(fan: Npc) {
    this.setState('scold');
    this.scoldTarget = fan;
    this.timer = 9;
    this.setExpression('angry');
    fan.lastScolded = this.game.time;
  }

  private thinkScold(dt: number) {
    const fan = this.scoldTarget;
    if (!fan || fan.removed) {
      this.setState('idle');
      return;
    }
    if (this.sub === 0) {
      this.goal = fan.position.clone();
      this.goalSpeed = this.runSpeed * 0.85;
      this.arriveRadius = 1.5;
      this.act = 'point';
      this.faceTarget = fan;
      const d = Math.hypot(fan.position.x - this.position.x, fan.position.z - this.position.z);
      if (d < 1.9) {
        this.sub = 1;
        this.timer = 2.4;
        this.goal = null;
        this.sayLine('scold', 2.6);
        this.game.sfx('officer_whistle', this.position, 0.7);
        this.game.events.emit('officerScold', { fan: fan.entity, officer: this.entity, npc: fan, position: fan.position.clone() });
        fan.scoldedBy(this);
      } else if (this.timer <= 0 || fan.ragdolled) {
        this.setExpression('neutral');
        this.setState('idle');
      }
    } else {
      this.act = 'scold';
      this.faceTarget = fan;
      if (this.timer <= 0) {
        this.setExpression('neutral');
        this.scoldTarget = null;
        this.setState('wander');
      }
    }
  }

  scoldedBy(officer: Npc) {
    if (!this.canReact()) return;
    this.setState('retreat');
    this.timer = 3.5;
    this.faceTarget = officer;
    this.setExpression('sad');
    this.sayLine('scolded', 2.2);
    this.noticeCooldown = this.game.time + 20;
  }

  // ------------------------------------------------------------------ reactions from the system
  /** Jimothy chittered nearby. */
  hearChitter(sayIt: boolean) {
    if (!this.canReact() || this.state === 'flee' || this.state === 'chase' || this.state === 'scold') return;
    this.setState('watch');
    this.timer = 2.2 + this.rng() * 1.5;
    this.act = 'aww';
    this.setExpression('aww');
    if (sayIt) this.sayLine('chitter', 2);
  }

  /** Something alarming happened at `from`. */
  alarm(from: THREE.Vector3, cause: string) {
    if (!this.canReact() || this.state === 'scold') return;
    const r = this.rng();
    if (this.type === 'officer') {
      if (this.state !== 'watch') {
        this.setState('watch');
        this.timer = 2;
        this.act = 'point';
        this.setExpression('angry');
        if (r < 0.5) this.sayLine('flee', 2);
      }
      return;
    }
    if ((this.type === 'tourist' || this.type === 'techbro') && r < 0.4 && this.held?.data.itemKind === 'phone') {
      this.setState('film');
      this.timer = 3 + this.rng() * 2;
      this.flashTimer = 0.3;
      this.setExpression('shock');
      if (this.rng() < 0.6) this.sayLine('chaosFilm', 2);
      return;
    }
    if (this.type === 'kid' && r < 0.6) {
      this.setState('watch');
      this.timer = 2.5;
      this.act = 'cheer';
      this.setExpression('happy');
      return;
    }
    if (cause === 'throw' && r < 0.5) return;
    this.startFlee(from, 2.5 + this.rng() * 2.5, r < 0.5);
  }

  startFlee(from: THREE.Vector3, secs = 3.5, shout = true) {
    const already = this.state === 'flee';
    this.setState('flee');
    this.fleeFrom.copy(from);
    this.timer = secs;
    this.setExpression('shock');
    if (!already) {
      if (shout) this.sayLine('flee', 1.8);
      if (this.rng() < 0.6) this.sys.scream(this.position);
    }
  }

  startChase() {
    this.setState('chase');
    this.timer = 4.5 + this.rng() * 2;
    this.setExpression('angry');
    this.sayLine('stolen', 2);
  }

  bumped() {
    const game = this.game;
    if (game.time - this.lastBump < 4 || !this.canReact()) return;
    this.lastBump = game.time;
    if (this.state === 'idle' || this.state === 'wander') {
      this.setState('watch');
      this.timer = 1.6;
      this.act = 'shrug';
      this.setExpression(this.rng() < 0.5 ? 'happy' : 'shock');
    }
    if (this.rng() < 0.7) this.sayLine('bump', 1.8);
  }

  /** Jimothy dropped our item next to us. */
  receiveItem(item: Entity) {
    if (this.held || this.ragdollState || this.removed) return false;
    attachItem(this.game, item, this.rig.handR);
    this.held = item;
    this.dropped = null;
    if (this.canReact()) {
      this.setState('watch');
      this.timer = 2.5;
      this.act = 'cheer';
    }
    this.setExpression('happy');
    this.sayLine('returned', 2.4);
    return true;
  }

  /** Called when Jimothy washes our face (entity.onWash). */
  washed() {
    const game = this.game;
    if (this.onInteract?.('wash') === true) return;
    this.cleanUntil = game.time + 25;
    this.rig.setExpression(this.ragdollState ? 'shock' : 'neutral', true);
    this.expression = this.ragdollState ? 'shock' : 'neutral';
    if (!this.ragdollState && !this.custom && this.state !== 'walk') {
      this.setState('baffled');
      this.timer = 3;
    }
    this.sayLine('washed', 2.6);
    game.events.emit('sparkle', { entity: this.entity, position: this.headPosition(new THREE.Vector3()) });
    game.events.emit('npcWashed', { entity: this.entity, npc: this });
    game.score(80, 'Free Face Wash', this.headPosition(new THREE.Vector3()));
  }

  // ------------------------------------------------------------------ physics hooks
  /** Is Jimothy the one bonking us right now? (Cars and other systems call onBonk too.) */
  private isPlayerBonk() {
    const pl = this.sys.player;
    if (!pl) return false;
    const size = pl.sizeMul ?? 1;
    const d = Math.hypot(pl.position.x - this.position.x, pl.position.z - this.position.z);
    if (d > 2.2 * Math.max(1, size) + (this.ragdollState ? 1.5 : 0)) return false;
    const since = this.game.time - ((pl as any).bonkTime ?? -10);
    return since < 0.5 || pl.mode === 'roll' || size > 1.4;
  }

  private nearVehicle() {
    for (const e of this.game.entities.list) {
      if (e.kind !== 'vehicle' || !e.body || !e.alive) continue;
      const t = e.body.translation();
      if (Math.hypot(t.x - this.position.x, t.z - this.position.z) < 7) return true;
    }
    return false;
  }

  private onBonk(impulse: THREE.Vector3, point: THREE.Vector3): boolean {
    const pl = this.sys.player;
    const byPlayer = this.isPlayerBonk();
    const rolling = byPlayer && pl?.mode === 'roll';
    const cause = byPlayer ? (rolling ? 'roll' : 'bonk') : this.nearVehicle() ? 'vehicle' : 'impact';
    const kid = this.type === 'kid';
    if (this.ragdollState) {
      const rd = this.ragdollState;
      const pelvis = rd.pelvisPosition(_a);
      const ground = this.groundAt(pelvis.x, pelvis.z, pelvis.y + 0.5);
      const airborne = pelvis.y - ground > 1.2;
      _b.copy(impulse).multiplyScalar((kid ? 0.5 : 1) * 1.1);
      if (byPlayer) _b.y += rd.totalMass * 2.5;
      rd.applyImpulse(_b, point, 0.2);
      rd.restTime = 0;
      if (byPlayer) {
        this.knockByPlayer = true;
        if (airborne) this.game.score(150, 'Air Juggle', pelvis.clone());
        this.game.events.emit('npcRagdoll', { entity: this.entity, cause: 'juggle', npc: this, position: pelvis.clone() });
      }
      return true;
    }
    // Launch! Bonks are exaggerated for comedy (kids get a gentle tumble).
    const k = kid ? 0.55 : byPlayer ? 1.3 : 1;
    _b.copy(impulse).multiplyScalar(k);
    _b.y = Math.max(_b.y, impulse.length() * 0.35 * k);
    this.knockDown({ cause, impulse: _b.clone(), point, byPlayer });
    return true;
  }

  private onGrab(): boolean | Entity {
    const game = this.game;
    if (this.onInteract?.('grab') === true) return false;
    if (this.ragdollState) return true; // drag the body (entity.body is the chest while ragdolled)
    if (this.held) {
      const item = this.held;
      this.held = null;
      detachItem(game, item);
      item.data.owner = this;
      this.dropped = item;
      if (!this.custom && !this.passive) this.startChase();
      else {
        this.setExpression('angry');
        this.sayLine('stolen', 2);
      }
      return item;
    }
    // Empty hands: grab them and drag them around (Goat-Sim lick equivalent).
    const pl = this.sys.player;
    _a.set(0, 1.2, 0);
    if (pl) _a.add(_b.copy(pl.position).sub(this.position).setY(0).normalize().multiplyScalar(1.5));
    this.knockDown({ cause: 'grab', dv: _a.clone(), byPlayer: true, flail: 0.6 });
    this.sayLine('grabbed', 2);
    return true;
  }

  // ------------------------------------------------------------------ ragdoll
  knockDown(o: KnockOptions) {
    if (this.removed) return;
    const game = this.game;
    if (this.ragdollState) {
      if (o.impulse) this.ragdollState.applyImpulse(o.impulse, o.point);
      if (o.dv) this.ragdollState.addVelocity(o.dv);
      this.ragdollState.restTime = 0;
      return;
    }
    this.sys.makeRoomForRagdoll(this);
    // a scripted walk pauses and resumes after getting up
    if (this.state === 'walk' && this.goal && this.walkResolve) {
      this.pendingWalk = { goal: this.goal.clone(), speed: this.goalSpeed, arrive: this.arriveRadius };
    }
    // drop whatever we're holding
    if (this.held) {
      const it = this.held;
      this.held = null;
      const v = _c.copy(this.velocity).add(_a.set((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3));
      if (o.dv) v.addScaledVector(o.dv, 0.7);
      if (o.impulse) v.addScaledVector(o.impulse, 0.7 / 70);
      detachItem(game, it, v, 10);
      it.data.owner = this;
      this.dropped = it;
    }
    this.walkerCollider.setEnabled(false);
    // make sure bone matrices reflect the current pose
    this.applyTransform();
    this.rig.root.updateMatrixWorld(true);
    const rd = new Ragdoll(game, this.rig);
    rd.build(_c.set(this.velocity.x, this.vy, this.velocity.z));
    this.ragdollState = rd;
    for (const c of rd.colliders) game.entities.bindCollider(c, this.entity);
    this.sys.mapColliders(rd.colliders, this);
    this.entity.body = rd.bodies.chest;
    if (o.impulse) rd.applyImpulse(o.impulse, o.point);
    if (o.dv) rd.addVelocity(o.dv);
    rd.flail(o.flail ?? 1);
    this.state = 'ragdoll';
    this.stateTime = 0;
    this.goal = null;
    this.act = 'none';
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.inWaterTime = 0;
    this.knockByPlayer = !!o.byPlayer;
    this.knockedAt = game.time;
    this.setExpression(o.cause === 'faint' ? 'shock' : this.type === 'kid' ? 'happy' : 'shock');
    this.sys.onKnockdown(this, o.cause, !!o.byPlayer, o.by);
  }

  /** Called by the system after the physics step while ragdolled. */
  ragdollStep(dt: number, visible: boolean) {
    const rd = this.ragdollState!;
    const game = this.game;
    const pelvis = rd.pelvisPosition(_a);
    const ground = game.get<any>('world')?.heightAt?.(pelvis.x, pelvis.z) ?? 0;
    const air = pelvis.y - ground;
    rd.step(dt, rd.age < 1.5 && rd.coreSpeed() > 1.2 && air > 0.35);
    if (visible || rd.age < 0.1) rd.sync();
    else {
      // keep the root roughly in place for culling
      this.rig.root.position.copy(pelvis);
    }
    this.position.set(pelvis.x, Math.min(pelvis.y, ground + 0.2), pelvis.z);
    this.stateTime += dt;
    const dragged = !!this.entity.data.draggedByPlayer;
    if (dragged) rd.restTime = 0;
    // floating?
    const water = game.get<any>('water');
    const vol = water?.volumeAt?.(pelvis);
    if (vol && vol.depth > 0.8) {
      this.inWaterTime += dt;
      rd.restTime = 0;
      if (this.inWaterTime > 10 && !dragged) {
        this.respawnHome();
        return;
      }
    } else this.inWaterTime = 0;
    if (pelvis.y < -40) {
      this.respawnHome();
      return;
    }
    const restNeeded = this.type === 'kid' ? 1.2 : 2.5;
    if (!dragged && (rd.restTime > restNeeded || rd.age > 14)) this.standUp();
  }

  private standUp(instant = false) {
    const rd = this.ragdollState;
    if (!rd) return;
    const game = this.game;
    rd.sync();
    const pw = new THREE.Vector3();
    const pq = new THREE.Quaternion();
    rd.boneWorld('pelvis', pw, pq);
    // facing: chest forward, or head direction when lying on the back/front
    const cr = rd.bodies.chest.rotation();
    _q.set(cr.x, cr.y, cr.z, cr.w);
    const fwd = _a.set(0, 0, 1).applyQuaternion(_q);
    let yaw: number;
    if (Math.abs(fwd.y) < 0.75) yaw = Math.atan2(fwd.x, fwd.z);
    else {
      const up = _b.set(0, 1, 0).applyQuaternion(_q);
      yaw = Math.atan2(up.x, up.z);
    }
    const x = pw.x;
    const z = pw.z;
    const gy = this.groundAt(x, z, pw.y + 0.6, 3);
    if (this.deepWaterAt(x, z, gy)) {
      this.respawnHome();
      return;
    }
    // bonus for big air
    const height = rd.maxY - rd.startY;
    if (this.knockByPlayer && height > 6) game.score(height > 15 ? 300 : 150, height > 15 ? 'Orbit Achieved' : 'Frequent Flyer', pw.clone());
    // tear down the ragdoll
    this.sys.unmapColliders(rd.colliders);
    rd.destroy();
    this.ragdollState = null;
    this.entity.body = this.walker;
    this.entity.data.draggedByPlayer = false;
    // re-root the skeleton at the feet, keep the lying pose for the blend
    const root = this.rig.root;
    this.yaw = yaw;
    this.feetY = gy;
    this.position.set(x, gy, z);
    root.position.set(x, gy, z);
    _q.setFromAxisAngle(UP, yaw);
    root.quaternion.copy(_q);
    const inv = _q2.copy(_q).invert();
    this.rig.bones.pelvis.position.copy(pw).sub(root.position).applyQuaternion(inv);
    this.rig.bones.pelvis.quaternion.copy(inv).multiply(pq);
    this.anim.startGetup(instant ? 0.01 : this.type === 'kid' ? 0.5 : 0.85);
    this.walker.setTranslation({ x, y: gy + this.capsuleCenter, z }, true);
    this.walker.setNextKinematicTranslation({ x, y: gy + this.capsuleCenter, z });
    this.walkerCollider.setEnabled(true);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.state = 'getup';
    this.stateTime = 0;
    this.sub = 0;
    this.timer = 1;
    this.act = 'none';
    this.faceTarget = null;
    this.setExpression(this.type === 'kid' ? 'happy' : this.rng() < 0.6 ? 'angry' : 'sad');
    if (this.custom) this.state = 'getup';
    game.events.emit('npcGetUp', { entity: this.entity, npc: this });
  }

  /** Teleport home & stand (fell out of the world / floated away). */
  respawnHome() {
    const rd = this.ragdollState;
    if (rd) {
      this.sys.unmapColliders(rd.colliders);
      rd.destroy();
      this.ragdollState = null;
      this.entity.body = this.walker;
      this.entity.data.draggedByPlayer = false;
    }
    const c = this.home.center;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * this.home.radius * 0.5;
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    const gy = this.groundAt(x, z, c.y + 20, 40);
    this.position.set(x, gy, z);
    this.feetY = gy;
    this.walker.setTranslation({ x, y: gy + this.capsuleCenter, z }, true);
    this.walker.setNextKinematicTranslation({ x, y: gy + this.capsuleCenter, z });
    this.walkerCollider.setEnabled(true);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    // reset pose instantly
    const B = this.rig.bones;
    B.pelvis.position.copy(this.rig.bindLocal.pelvis);
    for (const b of Object.values(B)) b.quaternion.identity();
    this.state = 'idle';
    this.setState(this.custom ? 'custom' : 'idle');
    this.setExpression('neutral');
    this.applyTransform();
  }

  // ================================================================== locomotion

  groundAt(x: number, z: number, fromY: number, maxDown = 3.2): number {
    const hit = this.game.physics.raycast(_c.set(x, fromY, z), _a.set(0, -1, 0), maxDown, GROUND_FILTER);
    if (hit) return hit.point.y;
    const w = this.game.get<any>('world');
    return w?.heightAt ? w.heightAt(x, z) : 0;
  }

  deepWaterAt(x: number, z: number, groundY: number) {
    const water = this.game.get<any>('water');
    if (!water?.volumeAt) return false;
    const vol = water.volumeAt(_c.set(x, groundY + 0.1, z));
    return !!vol && vol.surfaceY - groundY > 0.55;
  }

  private approaching() {
    return this.state === 'selfie' || this.state === 'kitty' || this.state === 'chase' || this.state === 'scold' || this.state === 'walk' || this.state === 'fetch';
  }

  private locomote(dt: number) {
    const game = this.game;
    const s = this.rig.dims.s;
    // --- desired direction
    const desired = _a.set(0, 0, 0);
    let speed = 0;
    if (this.goal) {
      const dx = this.goal.x - this.position.x;
      const dz = this.goal.z - this.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= this.arriveRadius) {
        this.arrived = true;
      } else {
        this.arrived = false;
        desired.set(dx / dist, 0, dz / dist);
        speed = this.goalSpeed * Math.min(1, 0.35 + (dist - this.arriveRadius) / 0.8);
      }
    }
    // separation from other walkers & personal space around Jimothy
    if (this.sep.lengthSq() > 1e-6) {
      desired.multiplyScalar(Math.max(speed, 0.001));
      desired.addScaledVector(this.sep, 1.2);
      speed = Math.min(Math.max(speed, desired.length()), Math.max(this.goalSpeed, 1));
      if (desired.lengthSq() > 1e-6) desired.normalize();
    }
    // --- obstacle avoidance
    if (speed > 0.05) {
      this.avoidCheck -= dt;
      if (this.avoidCheck <= 0) {
        this.avoidCheck = 0.12 + Math.random() * 0.06;
        this.checkObstacles(desired, speed);
      }
      if (this.avoidTimer > 0) {
        this.avoidTimer -= dt;
        const a = this.avoidAngle;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const x = desired.x * c + desired.z * sn;
        const z = -desired.x * sn + desired.z * c;
        desired.set(x, 0, z);
      }
    }
    // --- velocity
    const tvx = desired.x * speed;
    const tvz = desired.z * speed;
    const accel = speed > 2.2 ? 10 : 6;
    const dvx = tvx - this.velocity.x;
    const dvz = tvz - this.velocity.z;
    const dl = Math.hypot(dvx, dvz);
    const step = accel * dt;
    if (dl <= step) this.velocity.set(tvx, 0, tvz);
    else this.velocity.set(this.velocity.x + (dvx / dl) * step, 0, this.velocity.z + (dvz / dl) * step);

    // --- move & ground
    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;
    const moving = this.velocity.lengthSq() > 1e-4;
    let gy = moving ? this.groundAt(nx, nz, this.feetY + 1.0, 4) : this.feetY;
    if (!moving && this.vy === 0 && game.frame % 30 === this.idx % 30) gy = this.groundAt(nx, nz, this.feetY + 1.0, 4);
    const maxStep = 0.5 * Math.max(0.7, s);
    if (moving && (gy - this.feetY > maxStep || this.deepWaterAt(nx, nz, gy))) {
      // blocked: stay, turn away next check
      nx = this.position.x;
      nz = this.position.z;
      gy = this.feetY;
      this.velocity.multiplyScalar(0.2);
      this.avoidTimer = 0;
      this.avoidCheck = 0;
      if (this.state === 'wander' && this.stuckTimer > 0.6) this.pickWanderGoal();
    }
    this.position.x = nx;
    this.position.z = nz;
    if (this.feetY > gy + 0.03 || this.vy > 0) {
      this.vy -= GRAVITY * 1.3 * dt;
      this.feetY += this.vy * dt;
      if (this.feetY <= gy) {
        if (this.vy < -7.5) {
          this.feetY = gy;
          this.position.y = gy;
          this.applyTransform();
          this.knockDown({ cause: 'fall', dv: new THREE.Vector3(0, -this.vy * 0.2, 0) });
          return;
        }
        this.feetY = gy;
        this.vy = 0;
      }
    } else {
      this.feetY += (gy - this.feetY) * Math.min(1, dt * 16);
      this.vy = 0;
    }
    this.position.y = this.feetY;

    // --- facing
    let want: number | null = null;
    if (this.yawOverride != null) want = this.yawOverride;
    else if (this.velocity.lengthSq() > 0.09) want = Math.atan2(this.velocity.x, this.velocity.z);
    else {
      const t = this.lookTarget(_b);
      if (t && (this.faceTarget || this.state === 'idle')) want = Math.atan2(t.x - this.position.x, t.z - this.position.z);
    }
    if (want != null) this.yaw = dampAngle(this.yaw, want, this.velocity.lengthSq() > 0.09 ? 8 : 5, dt);

    // --- stuck detection
    if (speed > 0.2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 1.6) {
        if (this.stuckPos.distanceToSquared(this.position) < 0.3 * 0.3) {
          if (this.state === 'wander') this.pickWanderGoal();
          else if (this.state === 'flee') {
            this.fleeFrom.set(this.position.x + (Math.random() - 0.5) * 4, 0, this.position.z + (Math.random() - 0.5) * 4);
          } else if (this.state === 'walk') {
            this.avoidAngle = (Math.random() < 0.5 ? -1 : 1) * 1.3;
            this.avoidTimer = 0.8;
          } else if (this.state !== 'selfie' && this.state !== 'kitty') this.goal = null;
        }
        this.stuckTimer = 0;
        this.stuckPos.copy(this.position);
      }
    } else {
      this.stuckTimer = 0;
      this.stuckPos.copy(this.position);
    }

    this.walker.setNextKinematicTranslation({ x: this.position.x, y: this.feetY + this.capsuleCenter, z: this.position.z });
    this.applyTransform();
  }

  private checkObstacles(dir: THREE.Vector3, speed: number) {
    if (dir.lengthSq() < 1e-6) return;
    const s = this.rig.dims.s;
    const from = _b.set(this.position.x, this.feetY + 0.55 * s, this.position.z);
    const len = 0.5 + speed * 0.45;
    const blocked = (a: number) => {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const dx = dir.x * c + dir.z * sn;
      const dz = -dir.x * sn + dir.z * c;
      const hit = this.game.physics.raycast(from, _c.set(dx, 0, dz), len, OBSTACLE_FILTER);
      if (hit && Math.abs(hit.normal.y) < 0.6) return true;
      // ledge / deep water probe
      const px = this.position.x + dx * 0.9;
      const pz = this.position.z + dz * 0.9;
      const gy = this.groundAt(px, pz, this.feetY + 0.9, 3);
      if (this.feetY - gy > 1.1 || this.deepWaterAt(px, pz, gy)) return true;
      // Jimothy is in the way (don't trample the star unless we're heading to him)
      const pl = this.sys.player;
      if (pl && !this.approaching()) {
        const jx = pl.position.x - this.position.x;
        const jz = pl.position.z - this.position.z;
        const along = jx * dx + jz * dz;
        if (along > 0 && along < len + 0.4 && Math.abs(jx * dz - jz * dx) < 0.65) return true;
      }
      return false;
    };
    if (this.avoidTimer > 0 && !blocked(this.avoidAngle)) return;
    if (!blocked(0)) {
      this.avoidTimer = 0;
      return;
    }
    const pref = this.idx % 2 ? 1 : -1;
    for (const a of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const ang = a * pref;
      if (!blocked(ang)) {
        this.avoidAngle = ang;
        this.avoidTimer = 0.7;
        return;
      }
    }
    this.avoidAngle = Math.PI;
    this.avoidTimer = 0.9;
  }

  applyTransform() {
    if (this.ragdollState) return;
    const root = this.rig.root;
    root.position.set(this.position.x, this.feetY, this.position.z);
    root.quaternion.setFromAxisAngle(UP, this.yaw);
  }
}
