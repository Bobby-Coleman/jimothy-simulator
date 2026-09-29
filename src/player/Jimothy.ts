import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import type { Entity } from '../core/Entities';
import { RAPIER, G, groups } from '../core/Physics';
import { JimothyModel, type AnimState } from './JimothyModel';
import type { CameraRig } from './CameraRig';

export type PlayerMode = 'walk' | 'climb' | 'roll' | 'ragdoll' | 'swim' | 'hang';

const R = 0.38;
const MASS = 12;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 8.8;
const SWIM_SPEED = 2.8;
const JUMP_V = 7.8;
const CARRY_MAX_MASS = 14;
const WASH_TIME = 1.15;

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

const GROUND_FILTER = groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE | G.NPC | G.RAGDOLL | G.ANIMAL);
const CLIMB_FILTER = groups(G.ALL, G.WORLD | G.VEHICLE);
const GRAB_FILTER = groups(G.ALL, G.PROP | G.NPC | G.RAGDOLL | G.VEHICLE | G.ANIMAL);
const SIGHT_FILTER = groups(G.ALL, G.WORLD);

// ---- Feel pass: soft aim-assist (see pickTarget) + juice. Ranges are from Jimothy's centre to the target's nearest point.
const DEG = Math.PI / 180;
const GRAB_RANGE = 1.3;
const GRAB_CONE = 52 * DEG; // half-angle: a ~100° cone in front of him
const BONK_RANGE = 2.1;
const BONK_CONE = 45 * DEG;
const WASH_TARGET_RANGE = 1.4;
const WASH_TARGET_CONE = 60 * DEG;
/** Things this close count from (almost) any side: he's touching them. */
const TOUCH_RANGE = 0.55;
/** Water within this of his paws / body counts for washing (puddles are tiny: be generous). */
const WASH_REACH_HAND = 1.0;
const WASH_REACH_BODY = 1.25;

export interface AimTarget {
  entity: Entity;
  collider: RAPIER.Collider;
  /** Nearest point of the target's collider to Jimothy's centre. */
  point: THREE.Vector3;
  dist: number;
  angle: number;
  score: number;
}

function dampAngle(a: number, b: number, k: number, dt: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-k * dt));
}

interface Held {
  entity: Entity;
  kind: 'carry' | 'drag';
  localPoint?: THREE.Vector3;
  prevGroups: number[];
  since: number;
}

export class Jimothy implements System {
  name = 'player';
  game!: Game;
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  entity!: Entity;
  readonly model = new JimothyModel();
  mode: PlayerMode = 'walk';
  /** Visual yaw; model forward (+Z) points along (sin(facing), 0, cos(facing)). */
  facing = Math.PI;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly cameraTarget = new THREE.Vector3();
  speed = 0;
  grounded = false;
  groundNormal = new THREE.Vector3(0, 1, 0);
  groundEntity: Entity | undefined;
  stamina = 1;
  held: Held | null = null;
  washing = false;
  washProgress = 0;
  spawn = new THREE.Vector3(0, 1.5, 0);
  /** Mutator hooks */
  speedMul = 1;
  jumpMul = 1;
  gravityMul = 1;
  sizeMul = 1;
  /** Disable all control (cutscenes). */
  frozen = false;

  readonly stats = { rolled: 0, washed: 0, maxFall: 0, airTime: 0, distance: 0 };

  private lastGrounded = -10;
  private lastJump = -10;
  private jumpBuffer = 0;
  private climbNormal = new THREE.Vector3();
  private climbCooldown = 0;
  private climbSpeed = 0;
  private modeTime = 0;
  private ragdollUntil = 0;
  private bonkTime = -10;
  private bonkHit = new Set<number>();
  private chitterTime = -10;
  private airPeakY = 0;
  private wasGrounded = true;
  private vBefore = new THREE.Vector3();
  private washHintCooldown = 0;
  private hangTarget: { entity: Entity; local: THREE.Vector3 } | null = null;
  // Feel pass state
  /** Aim-assisted bonk target (the lunge homes in on it and it always counts when reached). */
  private bonkTarget: Entity | null = null;
  /** Until this game time the bonk lunge carries (low ground friction) instead of stopping dead. */
  private lungeUntil = -10;
  /** Real time of the last hit-stop (so bowling through a crowd doesn't turn into a slideshow). */
  private lastHitStop = -10;
  /** Seconds since the player last gave input. */
  idleTime = 0;
  /** 0..1, set to 1 in water and dries over time. */
  wetness = 0;

  async init(game: Game) {
    this.game = game;
    const sp = game.get<any>("world")?.poi?.get("spawn");
    if (sp) this.spawn.copy(sp);
    const p = this.spawn;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .lockRotations()
      .setLinearDamping(0)
      .setAngularDamping(0.3)
      .setCcdEnabled(true);
    const cd = RAPIER.ColliderDesc.ball(R)
      .setMass(MASS)
      .setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0)
      .setCollisionGroups(groups(G.PLAYER, G.ALL & ~G.HELD & ~G.TRIGGER & ~G.WATER & ~G.DEBRIS))
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(2000);
    this.body = game.physics.createBody(desc, [cd]);
    this.collider = this.body.collider(0);
    this.entity = game.entities.create({ kind: 'player', name: 'Jimothy', body: this.body, mass: MASS });
    this.entity.tags.add('player');
    game.scene.add(this.model.root);
    this.position.copy(p);
    // Load the real model in the background; the placeholder is used until it arrives.
    this.model.load(game.assets).then((ok) => {
      if (ok) console.info('[player] jimothy.glb loaded');
    });
  }

  // ---------------------------------------------------------------- helpers
  get forward() {
    return _c.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }
  forwardVec(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  private wishDir(out: THREE.Vector3) {
    const rig = this.game.get<CameraRig>('camera');
    const inp = this.game.input;
    if (!rig || this.frozen) return out.set(0, 0, 0);
    const f = rig.forward(_a);
    const r = rig.right(_b);
    out.set(0, 0, 0).addScaledVector(r, inp.move.x).addScaledVector(f, inp.move.y);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  /**
   * Feel pass: soft aim-assist. The best entity whose nearest point is within `range` of Jimothy's centre and inside a
   * ±`cone` wedge around his facing (anything he's touching counts from almost any side), scored by distance + angle
   * (+ optional `bias`, lower = better), with line of sight so he never grabs through walls.
   */
  pickTarget(range: number, cone: number, accept: (e: Entity) => boolean, bias?: (e: Entity) => number): AimTarget | null {
    const game = this.game;
    const p = this.position;
    const fx = Math.sin(this.facing);
    const fz = Math.cos(this.facing);
    const cols = game.physics.overlapSphere(p, range + 0.05, GRAB_FILTER, this.body);
    let best: AimTarget | null = null;
    const pt = new THREE.Vector3();
    for (const c of cols) {
      const e = game.entities.fromCollider(c);
      if (!e || !e.alive || !e.body || e === this.entity || !accept(e)) continue;
      let proj: { point: { x: number; y: number; z: number } } | null = null;
      try {
        proj = c.projectPoint({ x: p.x, y: p.y, z: p.z }, true);
      } catch {
        proj = null;
      }
      if (proj) pt.set(proj.point.x, proj.point.y, proj.point.z);
      else {
        const t = c.translation();
        pt.set(t.x, t.y, t.z);
      }
      const dy = pt.y - p.y;
      if (dy > 1.15 || dy < -1.0) continue; // out of paw reach vertically (he can reach down off a step / bench)
      const dx = pt.x - p.x;
      const dz = pt.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range) continue;
      // (nearest point basically at / inside him: he's touching it, direction doesn't matter)
      const angle = dist > 0.08 ? Math.acos(THREE.MathUtils.clamp((dx * fx + dz * fz) / dist, -1, 1)) : 0;
      if (angle > (dist < TOUCH_RANGE ? 105 * DEG : cone)) continue;
      // Score like the old grab (paws → the thing's centre, so a small item beats the big table it sits on or the
      // crow next to it) plus an angle term (what he's facing wins); nearest-point distance only gates the reach.
      const t = e.body.translation();
      const hc = Math.hypot(t.x - (p.x + fx * 0.5), (t.y - p.y) * 0.7, t.z - (p.z + fz * 0.5));
      const score = hc / range + (angle / cone) * 0.45 + (bias ? bias(e) : 0);
      if (best && score >= best.score) continue;
      if (dist > 0.65 && !this.canSee(pt, t)) continue; // beyond the old paw reach: no grabbing through walls
      best = { entity: e, collider: c, point: pt.clone(), dist, angle, score };
    }
    return best;
  }

  /**
   * Line of sight for aim-assist: clear if either his body → the nearest point, or his head → the thing's centre is
   * unobstructed by level geometry (so an item lying on a counter above his middle still counts).
   */
  private canSee(nearest: THREE.Vector3, center: { x: number; y: number; z: number }) {
    const game = this.game;
    const p = this.position;
    const notThin = (col: RAPIER.Collider) => !game.physics.isThin(col);
    const d1 = _c.copy(nearest).sub(p);
    if (!game.physics.raycast(p, d1, Math.max(0, d1.length() - 0.06), SIGHT_FILTER, this.body, notThin)) return true;
    const head = new THREE.Vector3(p.x, p.y + 0.45 * this.sizeMul, p.z);
    const d2 = _c.set(center.x - head.x, center.y - head.y, center.z - head.z);
    return !game.physics.raycast(head, d2, Math.max(0, d2.length() - 0.12), SIGHT_FILTER, this.body, notThin);
  }

  /** Snap-turn to face a world point (aim-assist). */
  private faceToward(pt: THREE.Vector3) {
    const dx = pt.x - this.position.x;
    const dz = pt.z - this.position.z;
    if (dx * dx + dz * dz > 0.0004) this.facing = Math.atan2(dx, dz);
  }

  /**
   * Feel pass: freeze-frame + camera punch for a hit. `strength` 0..1. Rate-limited so bowling through a crowd or a
   * run of trash cans stays smooth; the camera part respects "Reduce flashing & shake" (CameraRig.kick).
   */
  private feelHit(strength: number, dir?: THREE.Vector3) {
    const game = this.game;
    const s = THREE.MathUtils.clamp(strength, 0, 1);
    game.get<CameraRig>('camera')?.kick?.(0.25 + s * 0.5, dir);
    if (game.realTime - this.lastHitStop < 0.3) return;
    this.lastHitStop = game.realTime;
    (game as any).hitStop?.(0.04 + s * 0.03, 0.06);
  }

  /** Particle helper (FxSystem.emit), no-op when FX isn't there. */
  private fx(kind: string, pos: THREE.Vector3, opts?: Record<string, unknown>) {
    try {
      this.game.get<any>('fx')?.emit?.(kind, pos, opts);
    } catch {
      /* purely cosmetic */
    }
  }

  private feetPoint(out = new THREE.Vector3()) {
    return out.copy(this.position).setY(this.position.y - R * 0.9 * this.sizeMul);
  }

  private setGroupsHeld(e: Entity, held: boolean, prev?: number[]) {
    const b = e.body!;
    const out: number[] = [];
    for (let i = 0; i < b.numColliders(); i++) {
      const c = b.collider(i);
      out.push(c.collisionGroups());
      if (held) c.setCollisionGroups(groups(G.HELD, G.WORLD | G.PROP | G.NPC | G.VEHICLE | G.RAGDOLL | G.ANIMAL));
      else if (prev) c.setCollisionGroups(prev[i] ?? groups(G.PROP));
    }
    return out;
  }

  private checkGround() {
    const p = this.position;
    const hit = this.game.physics.sphereCast(p, _a.set(0, -1, 0), R * 0.85, 0.22, GROUND_FILTER, this.body);
    const wasGrounded = this.grounded;
    this.grounded = false;
    this.groundEntity = undefined;
    if (hit && hit.normal.y > 0.45 && hit.distance < R * 0.15 + 0.12) {
      this.grounded = true;
      this.groundNormal.copy(hit.normal);
      this.lastGrounded = this.game.time;
      this.groundEntity = this.game.entities.fromCollider(hit.collider);
    }
    if (!wasGrounded && this.grounded) this.onLand();
    if (!this.grounded) {
      // Climbing / hanging / swimming isn't falling: a fall is measured from where he lets go.
      const held = this.mode === 'climb' || this.mode === 'hang' || this.mode === 'swim';
      this.airPeakY = held ? p.y : Math.max(this.airPeakY, p.y);
      this.stats.airTime += this.game.dt;
    } else {
      this.airPeakY = p.y;
    }
  }

  private onLand() {
    const fall = this.airPeakY - this.position.y;
    if (fall > this.stats.maxFall) this.stats.maxFall = fall;
    this.game.events.emit('land', { height: fall });
    this.model.squash(Math.min(0.45, 0.08 + fall * 0.05));
    if (fall > 1.2) this.game.sfx('land', this.position, Math.min(1, fall / 6));
    // Feel pass: small hops get a puff too (FX does its own dust ring above 1.5 m); big drops thump the camera
    if (fall > 0.55 && fall <= 1.5 && this.mode === 'walk') this.fx('dust', this.feetPoint(new THREE.Vector3()), { scale: 0.4 + fall * 0.2 });
    if (fall > 3) this.game.get<CameraRig>('camera')?.kick?.(Math.min(0.8, fall * 0.06));
    this.airPeakY = this.position.y;
  }

  // ---------------------------------------------------------------- mode switches
  setMode(m: PlayerMode) {
    if (this.mode === m) return;
    const prev = this.mode;
    this.mode = m;
    this.modeTime = 0;
    const b = this.body;
    const c = this.collider;
    // reset to defaults
    b.setGravityScale(this.gravityMul, true);
    if (m === 'roll' || m === 'ragdoll') {
      b.setEnabledRotations(true, true, true, true);
      if (prev !== 'roll' && prev !== 'ragdoll') {
        _q.setFromAxisAngle(UP, this.facing);
        b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
      }
      c.setFriction(m === 'roll' ? 1.6 : 0.7);
      c.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
      c.setRestitution(m === 'roll' ? 0.3 : 0.45);
      b.setAngularDamping(m === 'roll' ? 0.35 : 2.2);
      b.setLinearDamping(m === 'roll' ? 0.05 : 0.25);
    } else {
      b.setEnabledRotations(false, false, false, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      c.setFriction(0);
      c.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      c.setRestitution(0);
      b.setLinearDamping(0);
    }
    if (m === 'climb' || m === 'swim' || m === 'hang') b.setGravityScale(0, true);
    this.game.events.emit('playerMode', { mode: m, prev });
  }

  ragdoll(cause: string, duration = 1.6, impulse?: THREE.Vector3) {
    if (this.mode === 'ragdoll') {
      this.ragdollUntil = Math.max(this.ragdollUntil, this.game.time + duration);
    } else {
      if (this.held) this.release(false);
      this.setMode('ragdoll');
      this.ragdollUntil = this.game.time + duration;
      this.body.setAngvel({ x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 14 }, true);
      this.game.events.emit('playerRagdoll', { cause });
    }
    if (impulse) this.body.applyImpulse(impulse, true);
  }

  respawn(at?: THREE.Vector3) {
    const p = at ?? this.spawn;
    if (this.held) this.release(false);
    this.setMode('walk');
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.position.copy(p);
    this.airPeakY = p.y; // a teleport is not a fall (else respawning mid-air "lands" a 60 m drop)
  }

  /** Move Jimothy (cutscenes, quests, tests). Unlike respawn(), he keeps holding what he carries. */
  teleport(p: THREE.Vector3, facing?: number) {
    const keep = this.held && this.held.kind === 'carry' ? this.held : null;
    if (keep) this.held = null;
    this.respawn(p);
    if (keep) this.held = keep;
    if (facing != null) {
      this.facing = facing;
      this.game.get<CameraRig>('camera')?.snapBehind(facing);
    }
  }

  // ---------------------------------------------------------------- main update
  update(dt: number) {
    const game = this.game;
    const inp = game.input;
    const t = this.body.translation();
    this.position.set(t.x, t.y, t.z);
    this.modeTime += dt;
    this.climbCooldown -= dt;
    this.washHintCooldown -= dt;

    // Fell out of the world
    if (t.y < -40 || Math.abs(t.x) > 900 || Math.abs(t.z) > 900) {
      this.respawn();
      game.hint('Jimothy has returned from the void. He does not want to talk about it.', 3);
      return;
    }

    this.checkGround();
    const frozen = this.frozen;

    if (!frozen) {
      if (inp.pressed('roll')) {
        if (this.mode === 'roll') this.exitRoll();
        else if (this.mode === 'walk' || this.mode === 'climb') {
          if (this.held) this.release(false);
          this.setMode('roll');
          game.sfx('boing', this.position, 0.5, 1.4);
          this.rollWhoomp(true);
          game.events.emit('rollStart', {});
        }
      }
      if (inp.held('flop') && this.mode !== 'ragdoll') this.ragdoll('flop', 0.4);
      if (inp.pressed('respawn')) {
        this.respawn();
        game.hint('Jimothy has been gently returned to his den.', 2);
        game.events.emit('respawn', {});
      }
      if (inp.pressed('chitter')) {
        this.chitterTime = game.time;
        game.sfx('chitter', this.position);
        game.events.emit('chitter', { position: this.position.clone() });
      }
    }

    switch (this.mode) {
      case 'walk':
        this.updateWalk(dt);
        break;
      case 'climb':
        this.updateClimb(dt);
        break;
      case 'roll':
        this.updateRoll(dt);
        break;
      case 'ragdoll':
        this.updateRagdoll(dt);
        break;
      case 'swim':
        this.updateSwim(dt);
        break;
      case 'hang':
        this.updateHang(dt);
        break;
    }

    if (!frozen && (this.mode === 'walk' || this.mode === 'swim' || this.mode === 'climb')) {
      if (inp.pressed('grab')) {
        if (this.held) this.release(false);
        else this.tryGrab();
      }
      if (inp.pressed('bonk')) this.doBonk();
    }
    if (!frozen && this.mode === 'roll' && inp.pressed('bonk')) this.doBonk();
    this.updateBonk();
    this.updateWash(dt);
    this.updateHeld(dt);

    // stamina regen
    if (this.mode !== 'climb' && (this.grounded || this.mode === 'swim')) this.stamina = Math.min(1, this.stamina + dt * 0.5);

    const v = this.body.linvel();
    this.vBefore.set(v.x, v.y, v.z);
  }

  private updateWalk(dt: number) {
    const game = this.game;
    const inp = game.input;
    const wish = this.wishDir(new THREE.Vector3());
    const sprint = inp.held('sprint');
    const max = (sprint ? SPRINT_SPEED : WALK_SPEED) * this.speedMul;
    const v = this.body.linvel();
    let vx = v.x;
    let vz = v.z;
    let vy = v.y;
    // Ride moving platforms (cars, boats): desired velocity is relative to what we stand on
    const plat = this.grounded ? (this.groundEntity?.data?.velocity as THREE.Vector3 | undefined) : undefined;
    // Uphill: aim for the same speed *along* the incline as on flat ground (the vertical part is added below)
    let slopeK = 1;
    if (this.grounded && !plat) {
      const n = this.groundNormal;
      const hn = Math.hypot(n.x, n.z);
      const into = hn > 0.02 ? -(n.x * wish.x + n.z * wish.z) / hn : 0;
      if (into > 0) slopeK = THREE.MathUtils.lerp(1, Math.max(0.45, n.y), Math.min(1, into));
    }
    const tx = wish.x * max * slopeK + (plat?.x ?? 0);
    const tz = wish.z * max * slopeK + (plat?.z ?? 0);
    let accel = this.grounded ? (wish.lengthSq() > 0.01 ? 42 : 34) : 11;
    // Feel pass: turning back against your momentum bites harder (snappier reversals, no ice-skating)
    if (this.grounded && wish.lengthSq() > 0.01 && wish.x * (vx - (plat?.x ?? 0)) + wish.z * (vz - (plat?.z ?? 0)) < 0) accel *= 1.45;
    // Feel pass: an aim-assisted bonk lunge at something a bit farther away carries for a moment instead of stopping dead
    if (game.time < this.lungeUntil) accel = Math.min(accel, 10);
    const dx = tx - vx;
    const dz = tz - vz;
    const dl = Math.hypot(dx, dz);
    const step = accel * dt;
    if (dl <= step || dl < 1e-6) {
      vx = tx;
      vz = tz;
    } else {
      vx += (dx / dl) * step;
      vz += (dz / dl) * step;
    }

    // Jump (with buffer + coyote time)
    if (inp.pressed('jump') && !this.frozen) this.jumpBuffer = 0.15;
    this.jumpBuffer -= dt;
    const canJump = this.grounded || game.time - this.lastGrounded < 0.14;
    if (this.jumpBuffer > 0 && canJump && game.time - this.lastJump > 0.28) {
      vy = JUMP_V * this.jumpMul;
      this.jumpBuffer = 0;
      this.lastJump = game.time;
      this.grounded = false;
      game.sfx('jump', this.position, 0.6);
      game.events.emit('jump', {});
      this.model.squash(-0.22);
    } else if (this.grounded && game.time - this.lastJump > 0.3) {
      // Follow the ground up inclines: walking into a slope needs matching upward speed (a flat 0.5 m/s cap used to
      // stall him on anything steep, so 45° hills were harder than climbing a wall). Everything walkable (up to ~63°,
      // see checkGround) can be run up; steeper faces are climbable. Otherwise keep feet planted over bumps/crests.
      const n = this.groundNormal;
      const up = plat ? 0 : -(n.x * vx + n.z * vz) / Math.max(0.45, n.y);
      // (rate-limited so the edge of a step/ramp, whose normal looks very steep for one frame, can't launch him)
      if (up > 0.05) vy = Math.min(up, 12, Math.max(vy, 0) + 40 * dt);
      else if (vy > 0) vy = Math.min(vy, 0.5);
    }

    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    this.body.setGravityScale((vy < 0 ? 1.8 : 1.25) * this.gravityMul, true);

    if (wish.lengthSq() > 0.01) this.facing = dampAngle(this.facing, Math.atan2(wish.x, wish.z), 13, dt);

    // Start climbing: pushing into a wall while airborne, or holding jump against it
    if (!this.frozen && this.climbCooldown <= 0 && wish.lengthSq() > 0.2 && (!this.grounded || inp.held('jump'))) {
      const dir = _a.copy(wish).normalize();
      // Feel pass: a little more reach so pressing into a wall at an angle + jump reliably grabs on
      const hit = game.physics.raycast(this.position, dir, R + 0.36, CLIMB_FILTER, this.body, this.climbable);
      // thin things (railings, poles) only get climbed on purpose (holding jump): brushing a handrail mid-stairs
      // used to auto-climb it and vault him over into the bay
      // …and without jump, only when heading fairly straight into the wall (not glancing along a railing)
      const onPurpose = !!hit && (inp.held('jump') || (!game.physics.isThin(hit.collider) && -(dir.x * hit.normal.x + dir.z * hit.normal.z) > 0.7));
      if (hit && onPurpose && Math.abs(hit.normal.y) < 0.5 && !game.entities.fromCollider(hit.collider)?.tags.has('noclimb')) {
        // Feel pass: a low wall / ledge he can almost reach: vault straight onto it instead of climbing 20 cm
        if (!this.tryVault(hit.point, hit.normal)) this.enterClimb(hit.normal);
      }
    }

    // Water?
    const water = game.get<any>('water');
    const vol = water?.volumeAt?.(this.position);
    if (vol && this.position.y < vol.surfaceY - 0.12) {
      this.setMode('swim');
      if (v.y < -4) game.sfx('splash', this.position, Math.min(1, -v.y / 12));
      game.events.emit('splash', { position: this.position.clone(), strength: -v.y, volume: vol });
    }
  }

  /**
   * Feel pass: ledge vault. If the wall he's pressing into has a walkable top no higher than ~0.75 m above his centre,
   * pop him up and over it (a mantle) instead of starting a climb. Returns true if he vaulted.
   */
  private tryVault(wallPoint: THREE.Vector3, normal: THREE.Vector3) {
    const game = this.game;
    const n = _b.copy(normal).setY(0);
    if (n.lengthSq() < 1e-4) return false;
    n.normalize();
    const from = new THREE.Vector3(wallPoint.x - n.x * 0.32, this.position.y + 0.95 * this.sizeMul, wallPoint.z - n.z * 0.32);
    // the space above the ledge must be free (not a taller wall with a lip)
    if (game.physics.overlapSphere(from, 0.2, groups(G.ALL, G.WORLD | G.VEHICLE), this.body).length) return false;
    const down = game.physics.raycast(from, _c.set(0, -1, 0), 1.6 * this.sizeMul, CLIMB_FILTER, this.body);
    if (!down || down.normal.y < 0.7) return false;
    const rise = down.point.y - this.position.y; // ledge top relative to his centre
    if (rise > 0.75 * this.sizeMul || rise < -0.25 * this.sizeMul) return false;
    const g = -game.physics.gravity * 1.25 * this.gravityMul;
    const need = Math.max(0.2, down.point.y + R * this.sizeMul + 0.12 - this.position.y);
    const vy = Math.min(9, Math.sqrt(2 * g * need));
    this.body.setLinvel({ x: -n.x * 3.4, y: Math.max(this.body.linvel().y, vy), z: -n.z * 3.4 }, true);
    this.climbCooldown = 0.45;
    this.jumpBuffer = 0;
    this.lastJump = game.time;
    this.model.squash(-0.18);
    game.events.emit('mantle', {});
    return true;
  }

  /** Raycast predicate: invisible map-boundary walls can't be climbed. */
  private climbable = (c: { handle: number }) => !this.game.physics.noClimb.has(c.handle);

  private enterClimb(normal: THREE.Vector3) {
    if (this.stamina < 0.08) {
      this.game.hint('Jimothy is too tired to climb. Rest a sec.', 1.5);
      this.climbCooldown = 1;
      return;
    }
    this.climbNormal.copy(normal).setY(0).normalize();
    if (this.held && this.held.kind === 'drag') this.release(false);
    this.setMode('climb');
    this.game.events.emit('climbStart', {});
  }

  private updateClimb(dt: number) {
    const game = this.game;
    const inp = game.input;
    const into = _a.copy(this.climbNormal).negate();
    const hit = game.physics.raycast(this.position, into, R + 0.55, CLIMB_FILTER, this.body, this.climbable);
    this.facing = Math.atan2(into.x, into.z);
    if (!hit || Math.abs(hit.normal.y) > 0.65) {
      // Ran out of wall: mantle over the top if climbing upward
      // (longer cooldown after a mantle so holding forward lands on the ledge instead of re-grabbing)
      let mantled = false;
      if (inp.move.y > 0.1) {
        this.body.setLinvel({ x: into.x * 4.2, y: 4.8, z: into.z * 4.2 }, true);
        this.game.events.emit('mantle', {});
        mantled = true;
      }
      this.climbCooldown = mantled ? 0.7 : 0.25;
      this.setMode('walk');
      return;
    }
    const n = _b.copy(hit.normal).setY(0).normalize();
    this.climbNormal.lerp(n, 0.35).normalize();
    const right = new THREE.Vector3().crossVectors(into, UP).normalize();
    const speed = (inp.held('sprint') ? 3.9 : 2.7) * this.speedMul;
    const upV = inp.move.y * speed;
    const sideV = inp.move.x * speed * 0.8;
    const stick = hit.distance > R + 0.04 ? 2.5 : 0.6;
    this.climbSpeed = Math.hypot(upV, sideV);
    this.body.setLinvel(
      {
        x: right.x * sideV + into.x * stick,
        y: upV,
        z: right.z * sideV + into.z * stick,
      },
      true,
    );
    // A full stamina bar climbs a bare wall for ~2.75 s (~7 m, ~11 m sprinting); ladders are 4× gentler (11 s)
    const onLadder = !!game.get<any>('world')?.onLadder?.(this.position);
    this.stamina -= dt / (onLadder ? 11 : 2.75);
    if (this.stamina <= 0) {
      this.game.hint('Jimothy’s tiny arms give out. (Ladders are much easier.)', 2.2);
      this.climbCooldown = 1.2;
      this.setMode('walk');
      return;
    }
    if (inp.pressed('jump') && !this.frozen) {
      // wall jump
      const n2 = this.climbNormal;
      this.body.setLinvel({ x: n2.x * 5.5, y: 7, z: n2.z * 5.5 }, true);
      this.facing = Math.atan2(n2.x, n2.z);
      this.climbCooldown = 0.35;
      this.lastJump = game.time;
      game.sfx('jump', this.position, 0.6, 1.2);
      this.setMode('walk');
      return;
    }
    if (this.grounded && inp.move.y < -0.1) {
      this.climbCooldown = 0.4;
      this.setMode('walk');
    }
  }

  private exitRoll() {
    const v = this.body.linvel();
    if (Math.hypot(v.x, v.z) > 0.5) this.facing = Math.atan2(v.x, v.z);
    this.setMode('walk');
    this.body.setLinvel({ x: v.x * 0.7, y: Math.max(v.y, 2.5), z: v.z * 0.7 }, true);
    this.rollWhoomp(false);
  }

  /** Feel pass: Tuck & Roll "whoomp": squash into a ball / pop back out, a dust ring, a soft FOV punch. */
  private rollWhoomp(start: boolean) {
    const game = this.game;
    this.model.squash(start ? 0.42 : -0.3);
    game.sfx('whoosh', this.position, start ? 0.4 : 0.3, start ? 0.65 : 0.95);
    if (!start) game.sfx('boing', this.position, 0.35, 0.85);
    if (this.grounded) this.fx('dust', this.feetPoint(new THREE.Vector3()), { scale: start ? 0.75 : 0.6 });
    game.get<CameraRig>('camera')?.punchFov?.(start ? 3.5 : -2);
  }

  private updateRoll(dt: number) {
    const game = this.game;
    const inp = game.input;
    const wish = this.wishDir(new THREE.Vector3());
    const sprint = inp.held('sprint');
    const maxV = (sprint ? 17 : 11) * this.speedMul;
    const w = this.body.angvel();
    if (wish.lengthSq() > 0.01) {
      // Target spin: ω = (up × v) / R
      const tw = _a.crossVectors(UP, wish).multiplyScalar(maxV / R);
      const dx = tw.x - w.x;
      const dz = tw.z - w.z;
      const dl = Math.hypot(dx, dz);
      const step = (sprint ? 90 : 60) * dt;
      const k = dl > step ? step / dl : 1;
      this.body.setAngvel({ x: w.x + dx * k, y: w.y * 0.95, z: w.z + dz * k }, true);
      this.body.applyImpulse({ x: wish.x * MASS * (this.grounded ? 5 : 3) * dt, y: 0, z: wish.z * MASS * (this.grounded ? 5 : 3) * dt }, true);
    }
    if (inp.pressed('jump') && this.grounded && game.time - this.lastJump > 0.3 && !this.frozen) {
      this.body.applyImpulse({ x: 0, y: MASS * 7.2 * this.jumpMul, z: 0 }, true);
      this.lastJump = game.time;
      game.sfx('boing', this.position, 0.6);
    }
    this.body.setGravityScale(1.3 * this.gravityMul, true);
    const v = this.body.linvel();
    const hs = Math.hypot(v.x, v.z);
    if (this.grounded) this.stats.rolled += hs * dt;
    if (hs > 0.5) this.facing = Math.atan2(v.x, v.z);

    const water = game.get<any>('water');
    const vol = water?.volumeAt?.(this.position);
    if (vol && this.position.y < vol.surfaceY - 0.1) {
      // Balls float! Gentle buoyancy while rolling in water
      this.body.applyImpulse({ x: 0, y: MASS * (18 + (vol.surfaceY - this.position.y) * 30) * dt, z: 0 }, true);
      this.body.setLinvel({ x: v.x * 0.985, y: v.y * 0.95, z: v.z * 0.985 }, true);
    }
  }

  private updateRagdoll(dt: number) {
    const game = this.game;
    const inp = game.input;
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    // Wiggle a bit when trying to move
    const wish = this.wishDir(new THREE.Vector3());
    if (wish.lengthSq() > 0.01 && this.grounded) this.body.applyImpulse({ x: wish.x * 10 * dt, y: 0, z: wish.z * 10 * dt }, true);
    const water = game.get<any>('water');
    const vol = water?.volumeAt?.(this.position);
    if (vol && this.position.y < vol.surfaceY) {
      this.body.applyImpulse({ x: 0, y: MASS * (16 + (vol.surfaceY - this.position.y) * 35) * dt, z: 0 }, true);
      this.body.setLinvel({ x: v.x * 0.97, y: v.y * 0.92, z: v.z * 0.97 }, true);
    }
    const wantsUp = !inp.held('flop') && game.time > this.ragdollUntil;
    if (wantsUp && (speed < 1.8 || this.modeTime > 3.5) && (this.grounded || vol || this.modeTime > 3.5)) {
      this.getUp();
    }
  }

  private getUp() {
    const v = this.body.linvel();
    this.setMode('walk');
    this.body.setLinvel({ x: v.x * 0.3, y: 3.2, z: v.z * 0.3 }, true);
    this.game.events.emit('getUp', {});
  }

  private updateSwim(dt: number) {
    const game = this.game;
    const inp = game.input;
    const water = game.get<any>('water');
    const vol = water?.volumeAt?.(this.position);
    if (!vol || this.position.y > vol.surfaceY + 0.05) {
      this.setMode('walk');
      return;
    }
    const wish = this.wishDir(new THREE.Vector3());
    const max = (inp.held('sprint') ? SWIM_SPEED * 1.6 : SWIM_SPEED) * this.speedMul;
    const v = this.body.linvel();
    const k = 1 - Math.exp(-dt * 4);
    const vx = v.x + (wish.x * max - v.x) * k;
    const vz = v.z + (wish.z * max - v.z) * k;
    const targetY = vol.surfaceY - 0.16 + Math.sin(game.time * 3) * 0.03;
    let vy = THREE.MathUtils.clamp((targetY - this.position.y) * 5, -3, 3);
    if (inp.pressed('jump') && !this.frozen) {
      vy = 6.5;
      this.lastJump = game.time;
      game.sfx('splash', this.position, 0.4);
      this.setMode('walk');
      this.body.setGravityScale(1.25 * this.gravityMul, true);
    }
    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    if (wish.lengthSq() > 0.01) this.facing = dampAngle(this.facing, Math.atan2(wish.x, wish.z), 6, dt);
    // Climb out onto edges
    if (wish.lengthSq() > 0.2 && this.climbCooldown <= 0) {
      const hit = game.physics.raycast(this.position, _a.copy(wish).normalize(), R + 0.25, CLIMB_FILTER, this.body);
      if (hit && Math.abs(hit.normal.y) < 0.5) {
        this.setMode('walk');
        this.body.setLinvel({ x: wish.x * 2.5, y: 6, z: wish.z * 2.5 }, true);
        this.climbCooldown = 0.3;
      }
    }
  }

  /** Hanging onto a moving thing (car surfing). */
  attachTo(entity: Entity, worldPoint: THREE.Vector3) {
    if (!entity.body) return;
    const b = entity.body;
    const t = b.translation();
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w).invert();
    const local = worldPoint.clone().sub(_a.set(t.x, t.y, t.z)).applyQuaternion(_q);
    this.hangTarget = { entity, local };
    this.setMode('hang');
    this.game.events.emit('hangStart', { entity });
  }

  private updateHang(dt: number) {
    const inp = this.game.input;
    const h = this.hangTarget;
    if (!h || !h.entity.alive || !h.entity.body) {
      this.setMode('walk');
      return;
    }
    const b = h.entity.body;
    const t = b.translation();
    const r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const target = _a.copy(h.local).applyQuaternion(_q).add(_b.set(t.x, t.y, t.z));
    const lv = b.linvel();
    const k = 12;
    this.body.setLinvel(
      {
        x: lv.x + (target.x - this.position.x) * k,
        y: lv.y + (target.y - this.position.y) * k,
        z: lv.z + (target.z - this.position.z) * k,
      },
      true,
    );
    const carYaw = new THREE.Euler().setFromQuaternion(_q, 'YXZ').y;
    this.facing = dampAngle(this.facing, carYaw, 5, dt);
    this.game.events.emit('hanging', { entity: h.entity, dt, speed: Math.hypot(lv.x, lv.z) });
    if ((inp.pressed('jump') || inp.pressed('grab')) && !this.frozen) {
      this.hangTarget = null;
      this.setMode('walk');
      this.body.setLinvel({ x: lv.x, y: 6, z: lv.z }, true);
      this.lastJump = this.game.time;
    }
  }

  // ---------------------------------------------------------------- grab / carry / drag
  private handPoint(out = new THREE.Vector3()) {
    const f = this.forwardVec(_b);
    // (don't touch _a here: updateHeld keeps the drag point in _a while calling this)
    out.copy(this.position).addScaledVector(f, 0.5);
    out.y += 0.02;
    return out;
  }

  tryGrab() {
    const game = this.game;
    // Feel pass: soft aim-assist: best grabbable in a ~100° cone within ~1.3 m, then snap-turn to it.
    const canGrab = (e: Entity) => !e.data.heldByPlayer && (e.tags.has('grabbable') || e.kind === 'npc' || e.kind === 'vehicle' || e.kind === 'animal' || e.kind === 'slop');
    const pick =
      this.pickTarget(GRAB_RANGE, GRAB_CONE, canGrab, (e) => (e.tags.has('grabbable') ? -0.12 : 0)) ?? // small carryables win ties
      this.pawSpherePick(canGrab); // safety net: anything the pre-assist grab could reach still works
    const best = pick?.entity;
    if (!pick || !best || !best.body) {
      this.whiff();
      game.events.emit('grabMiss', {});
      return;
    }
    if (pick.dist > 0.12) this.faceToward(pick.point);
    const hand = this.handPoint(new THREE.Vector3());
    // Grip point for drags / hanging: on the thing's surface (pulled a hair toward Jimothy), or his paws if closer.
    const grip = pick.point.clone();
    if (grip.distanceToSquared(this.position) > 1e-4) grip.addScaledVector(_c.copy(this.position).sub(grip).normalize(), 0.05);
    const bestCol: RAPIER.Collider | undefined = pick.collider;
    let target: Entity = best;
    const res = best.onGrab?.(game);
    if (res === false) return;
    if (res && typeof res === 'object' && 'kind' in res) {
      // stole something
      target = res as Entity;
      game.events.emit('steal', { entity: target, from: best });
      game.sfx('steal', this.position);
    }
    if (!target.body) return;
    this.model.reach();
    if (target.body.isKinematic() && target.kind === 'vehicle') {
      this.attachTo(target, hand.distanceTo(grip) < 0.62 ? hand : grip);
      return;
    }
    if (target.mass <= CARRY_MAX_MASS && (target.body.isDynamic() || target !== best)) {
      this.held = { entity: target, kind: 'carry', prevGroups: this.setGroupsHeld(target, true), since: game.time };
      target.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      target.data.heldByPlayer = true;
    } else {
      const b = target.body;
      const t = b.translation();
      const r = b.rotation();
      const pt = bestCol ? (hand.distanceTo(grip) < 0.62 ? hand : grip) : new THREE.Vector3(t.x, t.y, t.z);
      _q.set(r.x, r.y, r.z, r.w).invert();
      const local = pt.clone().sub(_a.set(t.x, t.y, t.z)).applyQuaternion(_q);
      this.held = { entity: target, kind: 'drag', localPoint: local, prevGroups: [], since: game.time };
      target.data.draggedByPlayer = true;
    }
    game.sfx('grab', this.position);
    game.events.emit('grab', { entity: target });
  }

  /** The original (pre-assist) grab query: a 0.62 m sphere at his paws, nearest centre wins, carryables preferred. */
  private pawSpherePick(accept: (e: Entity) => boolean): AimTarget | null {
    const game = this.game;
    const hand = this.handPoint(new THREE.Vector3());
    let best: AimTarget | null = null;
    for (const c of game.physics.overlapSphere(hand, 0.62, GRAB_FILTER, this.body)) {
      const e = game.entities.fromCollider(c);
      if (!e || !e.alive || !e.body || !accept(e)) continue;
      const t = e.body.translation();
      const d = hand.distanceToSquared(_a.set(t.x, t.y, t.z)) * (e.tags.has('grabbable') ? 0.6 : 1);
      if (!best || d < best.score) best = { entity: e, collider: c, point: hand.clone(), dist: 0, angle: 0, score: d };
    }
    return best;
  }

  /** Feel pass: a readable grab miss: a quick paw swipe at the air + a tiny whoosh (no score, no penalty). */
  private whiff() {
    this.model.swipe();
    this.game.sfx('whoosh', this.position, 0.28, 1.9);
    this.fx('whoosh', this.handPoint(new THREE.Vector3()), { dir: this.forwardVec(new THREE.Vector3()), scale: 0.6 });
  }

  release(thrown: boolean) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    const e = h.entity;
    const game = this.game;
    if (!e.alive || !e.body || !game.physics.world.getRigidBody(e.body.handle)) return;
    if (h.kind === 'carry') {
      e.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      this.setGroupsHeld(e, false, h.prevGroups);
      const v = this.body.linvel();
      const f = this.forwardVec(_b);
      if (thrown) {
        const cam = game.get<CameraRig>('camera');
        const lift = cam ? THREE.MathUtils.clamp(-cam.pitch * 0.8 + 0.35, 0.15, 1.0) : 0.4;
        e.body.setLinvel({ x: v.x * 0.5 + f.x * 11, y: v.y * 0.3 + 11 * lift, z: v.z * 0.5 + f.z * 11 }, true);
        e.body.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 12, z: (Math.random() - 0.5) * 12 }, true);
        game.sfx('throw', this.position);
      } else {
        e.body.setLinvel({ x: v.x + f.x * 1.2, y: Math.max(v.y, 0) + 1, z: v.z + f.z * 1.2 }, true);
      }
      e.data.heldByPlayer = false;
      e.data.thrownAt = game.time;
    } else {
      e.data.draggedByPlayer = false;
    }
    e.onRelease?.(game, thrown);
    game.events.emit('release', { entity: e, thrown });
  }

  private updateHeld(dt: number) {
    const h = this.held;
    if (!h) return;
    const e = h.entity;
    const game = this.game;
    if (!e.alive || !e.body || !game.physics.world.getRigidBody(e.body.handle)) {
      this.held = null;
      return;
    }
    if (this.mode === 'roll' || this.mode === 'ragdoll') {
      this.release(false);
      return;
    }
    const f = this.forwardVec(_b);
    if (h.kind === 'carry') {
      const size = (e.data.size as THREE.Vector3 | undefined) ?? _c.set(0.3, 0.3, 0.3);
      let target: THREE.Vector3;
      if (this.washing) {
        target = _a.copy(this.position).addScaledVector(f, 0.52).add(_c.set(0, -0.12 + Math.sin(game.time * 24) * 0.04, 0));
      } else {
        target = _a.copy(this.position).add(_c.set(0, 0.42 + size.y * 0.5, 0)).addScaledVector(f, 0.06);
      }
      if (this.mode === 'climb') target.addScaledVector(this.climbNormal, 0.3);
      _q.setFromAxisAngle(UP, this.facing + Math.sin(game.time * 3) * 0.08);
      e.body.setNextKinematicTranslation({ x: target.x, y: target.y, z: target.z });
      e.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    } else if (h.localPoint) {
      const b = e.body;
      const t = b.translation();
      const r = b.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const wp = _a.copy(h.localPoint).applyQuaternion(_q).add(_c.set(t.x, t.y, t.z));
      const hand = this.handPoint(new THREE.Vector3());
      const d = hand.clone().sub(wp);
      const dist = d.length();
      if (dist > 2.6) {
        this.release(false);
        game.hint('Lost grip!', 1);
        return;
      }
      if (b.isKinematic()) {
        if (e.kind === 'vehicle') this.attachTo(e, wp.clone());
        else this.release(false);
        return;
      }
      const pv = b.velocityAtPoint({ x: wp.x, y: wp.y, z: wp.z });
      const v = this.body.linvel();
      const mEff = Math.min(b.mass(), 160);
      const F = d.multiplyScalar(60 * mEff).sub(_c.set(pv.x - v.x, pv.y - v.y, pv.z - v.z).multiplyScalar(9 * mEff));
      const maxF = 5200;
      if (F.length() > maxF) F.setLength(maxF);
      b.applyImpulseAtPoint({ x: F.x * dt, y: F.y * dt, z: F.z * dt }, { x: wp.x, y: wp.y, z: wp.z }, true);
      // reaction: heavy things tug Jimothy around a little
      const react = Math.min(1, b.mass() / 400) * 0.1;
      this.body.applyImpulse({ x: -F.x * dt * react, y: 0, z: -F.z * dt * react }, true);
    }
  }

  // ---------------------------------------------------------------- bonk
  private doBonk() {
    const game = this.game;
    if (this.held && this.held.kind === 'carry') {
      this.release(true);
      return;
    }
    if (game.time - this.bonkTime < 0.45) return;
    this.bonkTime = game.time;
    this.bonkHit.clear();
    // Feel pass: aim-assist the lunge at the best bonkable thing in front and home in on it.
    this.bonkTarget = null;
    let reach = 0;
    if (this.mode === 'walk' || this.mode === 'swim') {
      const pick = this.pickTarget(BONK_RANGE, BONK_CONE, (e) => !e.data.heldByPlayer && e.kind !== 'player' && (!!e.body?.isDynamic() || !!e.onBonk || e.kind === 'npc'));
      if (pick) {
        this.bonkTarget = pick.entity;
        if (pick.dist > 0.1) this.faceToward(pick.point);
        reach = pick.dist;
      }
    }
    const f = this.forwardVec(_b);
    const v = this.body.linvel();
    if (this.mode === 'walk') {
      // a farther target gets a slightly longer lunge; the lunge carries for a moment instead of stopping dead
      const lunge = 7.5 + THREE.MathUtils.clamp(reach - 0.9, 0, 1.2) * 2.2;
      this.lungeUntil = reach > 0.95 ? game.time + 0.16 : -10;
      this.body.setLinvel({ x: v.x * 0.3 + f.x * lunge, y: this.grounded ? 2.6 : v.y, z: v.z * 0.3 + f.z * lunge }, true);
    } else if (this.mode === 'roll') {
      this.body.applyImpulse({ x: f.x * MASS * 7, y: MASS * 1.5, z: f.z * MASS * 7 }, true);
    } else if (this.mode === 'swim') {
      this.body.setLinvel({ x: f.x * 5, y: v.y, z: f.z * 5 }, true);
    }
    game.sfx('whoosh', this.position, 0.7);
    game.events.emit('bonkStart', {});
  }

  private updateBonk() {
    const game = this.game;
    const since = game.time - this.bonkTime;
    const rolling = this.mode === 'roll';
    // Rolling fast counts as a continuous bonk (bowling!)
    const rollBonk = rolling && this.speed > 6;
    if (since > 0.32 && !rollBonk) return;
    // Feel pass: keep the lunge pointed at the aim-assist target while it closes in
    const tgt = since <= 0.32 && !rolling ? this.bonkTarget : null;
    if (tgt && (!tgt.alive || !tgt.body || this.bonkHit.has(tgt.id))) this.bonkTarget = null;
    else if (tgt?.body) {
      const t = tgt.body.translation();
      const want = Math.atan2(t.x - this.position.x, t.z - this.position.z);
      this.facing = dampAngle(this.facing, want, 18, game.dt);
      if (this.mode === 'walk' && game.time < this.lungeUntil) {
        const v = this.body.linvel();
        const sp = Math.hypot(v.x, v.z);
        if (sp > 1) this.body.setLinvel({ x: Math.sin(this.facing) * sp, y: v.y, z: Math.cos(this.facing) * sp }, true);
      }
    }
    const f = this.forwardVec(_b);
    const center = _a.copy(this.position).addScaledVector(f, rolling ? 0.2 : 0.42);
    const cols = game.physics.overlapSphere(center, rolling ? 0.55 : 0.58, GRAB_FILTER, this.body);
    // ...and the target itself always counts once he's reached it (even if the sphere is a hair off)
    if (this.bonkTarget?.body && since <= 0.32 && !rolling && !this.bonkHit.has(this.bonkTarget.id)) {
      const b = this.bonkTarget.body;
      for (let i = 0; i < b.numColliders(); i++) {
        const c = b.collider(i);
        const pr = c.projectPoint({ x: this.position.x, y: this.position.y, z: this.position.z }, true);
        if (pr && Math.hypot(pr.point.x - this.position.x, pr.point.z - this.position.z) < R + 0.42 && Math.abs(pr.point.y - this.position.y) < 1.1) {
          if (!cols.includes(c)) cols.push(c);
          break;
        }
      }
    }
    let first = true;
    for (const c of cols) {
      const e = game.entities.fromCollider(c);
      const key = e ? e.id : -c.handle - 1;
      if (this.bonkHit.has(key)) continue;
      if (e?.data.heldByPlayer) continue;
      this.bonkHit.add(key);
      if (rollBonk && since > 0.32) {
        // allow re-hitting the same thing after a while when bowling
        setTimeout(() => this.bonkHit.delete(key), 600);
      }
      const b = c.parent();
      const mass = e?.mass ?? b?.mass() ?? 10;
      const power = rolling ? Math.max(6, this.speed * 0.9) : 9.5;
      const dir = new THREE.Vector3(f.x, 0.55, f.z).normalize();
      const impulse = dir.multiplyScalar(Math.min(mass, 90) * power);
      const pt = b ? b.translation() : center;
      const point = new THREE.Vector3(pt.x, pt.y, pt.z);
      const handled = e?.onBonk?.(game, impulse, point) === true;
      if (!handled && b && b.isDynamic()) b.applyImpulseAtPoint(impulse, { x: point.x, y: point.y + 0.05, z: point.z }, true);
      game.events.emit('bonk', { entity: e, impulse, rolling });
      game.sfx(mass > 40 ? 'impact_heavy' : 'bonk', point);
      game.get<CameraRig>('camera')?.shake(0.25);
      // Feel pass: freeze-frame + camera punch. Bonks always; while bowling only people / heavy stuff (rate-limited).
      if (first && (!rolling || e?.kind === 'npc' || mass > 40)) {
        first = false;
        const heavy = e?.kind === 'npc' || mass > 40;
        this.feelHit(rolling ? 0.35 : heavy ? 0.9 : 0.45, _c.set(f.x, 0, f.z));
      }
      if (e && e === this.bonkTarget) this.bonkTarget = null;
    }
  }

  // ---------------------------------------------------------------- wash
  private updateWash(dt: number) {
    const game = this.game;
    const inp = game.input;
    const allowed = (this.mode === 'walk' || this.mode === 'swim') && !this.frozen;
    const want = allowed && inp.held('wash');
    if (!want) {
      if (this.washing) game.events.emit('washStop', {});
      this.washing = false;
      this.washProgress = 0;
      return;
    }
    const water = game.get<any>('water');
    const hand = this.handPoint(new THREE.Vector3()).add(_a.set(0, -0.2, 0));
    // Feel pass: be generous: water near his paws OR anywhere within a step of his body (puddles are tiny)
    const handVol = this.mode === 'swim' ? null : water?.nearWater?.(hand, WASH_REACH_HAND);
    let vol =
      this.mode === 'swim' ? water?.volumeAt?.(this.position) : (handVol ?? water?.nearWater?.(this.feetPoint(new THREE.Vector3()), WASH_REACH_BODY));
    // Seattle rule: when it rains on you, the whole city is a sink
    if (!vol && game.get<any>('weather')?.rainingOnPlayer) vol = { kind: 'rain', name: 'Rain', surfaceY: this.position.y - 0.3 };
    if (!vol) {
      if (this.washing) game.events.emit('washStop', {});
      this.washing = false;
      this.washProgress = 0;
      if (inp.pressed('wash') && this.washHintCooldown <= 0) {
        this.washHintCooldown = 2.5;
        game.hint('Jimothy needs water to wash things! Try a puddle, fountain, pond, sprinkler or the bay.', 3);
      }
      return;
    }
    if (!this.washing) {
      // Feel pass: turn to what he's about to wash (a face / slop in front); if his paws don't reach the water he
      // found (it's beside / behind him), turn to the water itself. Never turn when the paws are already in reach.
      const front = this.held && this.held.kind === 'carry' ? null : this.pickWashTarget();
      if (front) {
        if (front.dist > 0.12) this.faceToward(front.point);
      } else if (!handVol && vol.center && this.mode === 'walk') this.faceToward(this.nearestWaterPoint(vol, _c));
      game.events.emit('washStart', { volume: vol });
    }
    this.washing = true;
    this.washProgress += dt / WASH_TIME;
    game.events.emit('washing', { position: hand, dt, volume: vol });
    if (this.washProgress >= 1) {
      this.washProgress = 0;
      this.completeWash(vol);
    }
  }

  private completeWash(vol: any) {
    const game = this.game;
    this.stats.washed++;
    if (this.held && this.held.kind === 'carry') {
      const e = this.held.entity;
      if (e.onWash) e.onWash(game);
      else defaultWash(game, e);
      game.events.emit('wash', { entity: e, kind: 'item', water: vol?.kind });
      return;
    }
    // Wash whatever is in front of us (NPC faces, slop, washable props): aim-assisted, like grabbing
    const pick = this.pickWashTarget();
    if (pick) {
      const e = pick.entity;
      if (e.onWash) e.onWash(game);
      else defaultWash(game, e);
      game.events.emit('wash', { entity: e, kind: e.kind, water: vol?.kind });
      return;
    }
    // (legacy fallback: anything washable right at his paws, e.g. things without a body-shaped collider)
    const hand = this.handPoint(new THREE.Vector3());
    const cols = game.physics.overlapSphere(hand, 0.75, GRAB_FILTER, this.body);
    for (const c of cols) {
      const e = game.entities.fromCollider(c);
      if (!e || !e.alive || e.data.heldByPlayer) continue;
      if (e.onWash || e.tags.has('washable')) {
        if (e.onWash) e.onWash(game);
        else defaultWash(game, e);
        game.events.emit('wash', { entity: e, kind: e.kind, water: vol?.kind });
        return;
      }
    }
    game.events.emit('wash', { kind: 'hands', water: vol?.kind });
    game.score(5, 'Hand Hygiene');
  }

  /** Feel pass: the washable thing in front of him (faces, slop, props), aim-assisted. Specials (onWash) win ties. */
  private pickWashTarget() {
    return this.pickTarget(
      WASH_TARGET_RANGE,
      WASH_TARGET_CONE,
      (e) => !e.data.heldByPlayer && (!!e.onWash || e.tags.has('washable')),
      (e) => (e.onWash ? -0.1 : 0),
    );
  }

  /** Nearest point of a water volume's surface edge to Jimothy (for turning toward it). */
  private nearestWaterPoint(v: any, out: THREE.Vector3) {
    const p = this.position;
    const c = v.center as THREE.Vector3;
    if (v.radius != null) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const l = Math.hypot(dx, dz) || 1;
      const r = Math.min(l, v.radius);
      return out.set(c.x + (dx / l) * r, v.surfaceY ?? p.y, c.z + (dz / l) * r);
    }
    const hx = v.halfX ?? 0;
    const hz = v.halfZ ?? 0;
    return out.set(THREE.MathUtils.clamp(p.x, c.x - hx, c.x + hx), v.surfaceY ?? p.y, THREE.MathUtils.clamp(p.z, c.z - hz, c.z + hz));
  }

  // ---------------------------------------------------------------- post physics
  postPhysics(dt: number) {
    const game = this.game;
    const t = this.body.translation();
    const v = this.body.linvel();
    if (!Number.isFinite(t.x + t.y + t.z + v.x + v.y + v.z)) {
      console.warn("[player] NaN physics state; respawning");
      this.respawn();
      return;
    }
    this.position.set(t.x, t.y, t.z);
    this.velocity.set(v.x, v.y, v.z);
    this.speed = Math.hypot(v.x, v.z);
    if (this.grounded && this.mode === 'walk') this.stats.distance += this.speed * dt;

    // Big sudden velocity change = got hit hard (car, explosion, fall)
    const dv = this.velocity.distanceTo(this.vBefore);
    if (dv > 15 && (this.mode === 'walk' || this.mode === 'climb' || this.mode === 'swim' || this.mode === 'hang')) {
      this.ragdoll('impact', 1.4);
      game.get<CameraRig>('camera')?.shake(0.6);
      // Feel pass: big hit = freeze-frame + camera shove along the hit
      this.feelHit(1, _c.copy(this.velocity).sub(this.vBefore).setY(0));
      game.events.emit('playerImpact', { strength: dv });
    }

    // Visual transform
    const root = this.model.root;
    root.position.set(t.x, t.y, t.z);
    root.scale.setScalar(this.sizeMul);
    const pivot = this.model.pivot;
    if (this.mode === 'roll' || this.mode === 'ragdoll') {
      const r = this.body.rotation();
      pivot.quaternion.set(r.x, r.y, r.z, r.w);
      pivot.position.set(0, 0, 0);
    } else if (this.mode === 'climb') {
      // Belly to the wall, head up
      const n = this.climbNormal;
      const zAxis = UP;
      const yAxis = _a.copy(n);
      const xAxis = _b.crossVectors(yAxis, zAxis).normalize();
      _m.makeBasis(xAxis, yAxis, zAxis);
      _q.setFromRotationMatrix(_m);
      pivot.quaternion.slerp(_q, 1 - Math.exp(-dt * 14));
      pivot.position.set(0, 0, 0);
    } else {
      _q.setFromAxisAngle(UP, this.facing);
      if (this.mode === 'hang') {
        const tilt = new THREE.Quaternion().setFromAxisAngle(_a.set(1, 0, 0), -0.9);
        _q.multiply(tilt);
      }
      pivot.quaternion.slerp(_q, 1 - Math.exp(-dt * 20));
      pivot.position.set(0, this.mode === 'swim' ? -0.05 : 0.02, 0);
    }

    const inp = game.input;
    if (inp.move.lengthSq() > 0.01 || inp.held('jump') || inp.held('grab') || inp.held('bonk') || inp.held('wash') || this.speed > 0.5 || this.mode !== 'walk') this.idleTime = 0;
    else this.idleTime += dt;
    if (this.mode === 'swim') this.wetness = 1;
    else this.wetness = Math.max(0, this.wetness - dt / 14);
    this.model.setWetness(this.wetness);
    const anim: AnimState = {
      mode: this.mode,
      speed: this.mode === 'climb' ? this.climbSpeed : this.speed,
      vy: v.y,
      grounded: this.grounded,
      carrying: !!this.held && this.held.kind === 'carry',
      washing: this.washing,
      flop: this.mode === 'ragdoll',
      time: game.time,
      sinceChitter: game.time - this.chitterTime,
      sinceBonk: game.time - this.bonkTime,
      climbSpeed: this.climbSpeed,
      idleTime: this.idleTime,
      night: game.get<any>('environment')?.nightFactor ?? 0,
    };
    this.model.animate(dt, anim);

    this.cameraTarget.set(t.x, t.y + 0.75 * this.sizeMul, t.z);
  }
}

export function defaultWash(game: Game, e: Entity) {
  const n = (e.data.washCount = (e.data.washCount ?? 0) + 1);
  if (n === 1) game.score(60, `Washed ${e.name}`);
  else if (n < 4) game.score(15, `Washed ${e.name} Again`);
  else game.score(5, `${e.name} Is Very Clean Now`);
  e.data.washed = true;
  game.events.emit('sparkle', { entity: e });
}
