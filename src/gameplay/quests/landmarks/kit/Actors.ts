import * as THREE from 'three';
import type { Entity } from '../../../../core/Entities';
import { RAPIER, G, groups } from '../../../../core/Physics';
import { Figure, randomOutfit, type Outfit } from './Figure';
import type { Kit } from './Kit';

/**
 * A character taking part in a landmark event. Either wraps a real NPC from the NPC system
 * (`game.get('npcs')`) or, when that isn't available, a stand-in toy figure with its own kinematic capsule.
 * Events only talk to this interface, so they work the same either way.
 */
export interface ActorOpts {
  /** NPC type, e.g. 'mayor' | 'dean' | 'racer' | 'fishmonger' | 'fan' | 'student'. */
  type: string;
  name: string;
  /** Feet position. */
  position: THREE.Vector3;
  /** Yaw; forward = (sin(yaw), 0, cos(yaw)). */
  facing?: number;
  stationary?: boolean;
  lookAtPlayer?: boolean;
  /** Outfit for the stand-in figure. */
  outfit?: Partial<Outfit>;
  /** Appearance overrides passed to the NPC system (its `Look`), e.g. { topStyle: 'gown', hat: 'mortarboard' }. */
  look?: Record<string, any>;
  /** NPC system: disable automatic reactions (filming, fleeing…) so ceremony actors stay put. */
  passive?: boolean;
  /** Always use the stand-in figure (bespoke costumes). */
  figureOnly?: boolean;
}

export interface Actor {
  readonly name: string;
  readonly type: string;
  /** Feet position (live). */
  readonly position: THREE.Vector3;
  readonly entity?: Entity;
  /** True while ragdolled / knocked over. */
  readonly down: boolean;
  readonly alive: boolean;
  lookAtPlayer: boolean;
  say(text: string, secs?: number, big?: boolean): void;
  expression(e: 'happy' | 'neutral' | 'shock' | 'sad' | 'angry' | string): void;
  /** Face a point or a yaw angle. */
  face(target: THREE.Vector3 | number): void;
  /** Walk/run toward a point at `speed` m/s (persistent until stop()/another moveTo). */
  moveTo(target: THREE.Vector3, speed: number): void;
  stop(): void;
  /** Distance left to the current move target (0 when idle). */
  readonly remaining: number;
  teleport(p: THREE.Vector3, yaw?: number): void;
  ragdoll(impulse?: THREE.Vector3): void;
  cheer(secs?: number): void;
  throwAnim(): void;
  armsUp(v: number): void;
  /** World position of the right hand (for handing over / throwing props). */
  handPos(out?: THREE.Vector3): THREE.Vector3;
  headPos(out?: THREE.Vector3): THREE.Vector3;
  update(dt: number): void;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function angleTo(from: THREE.Vector3, to: THREE.Vector3) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}
function dampAngle(a: number, b: number, k: number, dt: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-k * dt));
}

const HALF_H = 0.55;
const RADIUS = 0.3;
const CENTER_Y = HALF_H + RADIUS; // body center above the feet

// ================================================================== stand-in figure
export class FigureActor implements Actor {
  readonly name: string;
  readonly type: string;
  readonly figure: Figure;
  readonly entity: Entity;
  readonly body: RAPIER.RigidBody;
  readonly position = new THREE.Vector3();
  lookAtPlayer: boolean;
  alive = true;
  private yaw: number;
  private wantYaw: number;
  private target: THREE.Vector3 | null = null;
  private speed = 0;
  private curSpeed = 0;
  private isDown = false;
  private downAt = 0;
  private mouth: THREE.Object3D | undefined;
  private anchorFn = () => (this.alive ? this.headPos(new THREE.Vector3()).add(_a.set(0, 0.45, 0)) : null);

  constructor(
    private kit: Kit,
    opts: ActorOpts,
  ) {
    this.name = opts.name;
    this.type = opts.type;
    this.lookAtPlayer = opts.lookAtPlayer ?? true;
    this.figure = new Figure({ ...randomOutfit(), ...(opts.outfit ?? {}) });
    this.mouth = this.figure.head.getObjectByName('mouth');
    this.yaw = this.wantYaw = opts.facing ?? 0;
    this.position.copy(opts.position);
    const game = kit.game;
    game.scene.add(this.figure.root);
    const p = opts.position;
    _q.setFromAxisAngle(UP, this.yaw);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(p.x, p.y + CENTER_Y, p.z)
      .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      .setLinearDamping(0.4)
      .setAngularDamping(1.2);
    const cd = RAPIER.ColliderDesc.capsule(HALF_H, RADIUS)
      .setMass(70)
      .setFriction(0.8)
      .setRestitution(0.1)
      .setCollisionGroups(groups(G.NPC, G.WORLD | G.PROP | G.PLAYER | G.NPC | G.RAGDOLL | G.VEHICLE | G.HELD | G.ANIMAL));
    this.body = game.physics.createBody(desc, [cd], this.figure.root, new THREE.Vector3(0, -CENTER_Y, 0));
    this.entity = game.entities.create({
      kind: 'npc',
      name: opts.name,
      body: this.body,
      object: this.figure.root,
      mass: 70,
      tags: new Set(['npc', 'landmarkActor']),
      data: { actor: this, npcType: opts.type },
      onBonk: (_g, impulse) => {
        this.ragdoll(impulse);
        return true;
      },
    });
  }

  get down() {
    return this.isDown;
  }

  get remaining() {
    if (!this.target) return 0;
    return Math.hypot(this.target.x - this.position.x, this.target.z - this.position.z);
  }

  say(text: string, secs = 2.6, big = false) {
    if (!this.alive) return;
    this.kit.speech(this.figure.root, this.anchorFn, text, secs, big ? 'shout' : undefined, this.entity.id);
    this.figure.talk(Math.min(secs, 1.8));
  }

  expression(e: string) {
    const m = this.mouth;
    if (!m) return;
    if (e === 'happy') m.scale.set(1.6, 1.6, 1);
    else if (e === 'shock') m.scale.set(0.7, 3.2, 1);
    else if (e === 'sad') m.scale.set(0.9, 0.7, 1);
    else m.scale.set(1, 1, 1);
  }

  face(target: THREE.Vector3 | number) {
    this.wantYaw = typeof target === 'number' ? target : angleTo(this.position, target);
  }

  moveTo(target: THREE.Vector3, speed: number) {
    this.target = (this.target ?? new THREE.Vector3()).copy(target);
    this.speed = speed;
  }

  stop() {
    this.target = null;
  }

  teleport(p: THREE.Vector3, yaw?: number) {
    if (this.isDown) this.getUp(true);
    this.position.copy(p);
    if (yaw != null) this.yaw = this.wantYaw = yaw;
    _q.setFromAxisAngle(UP, this.yaw);
    this.body.setTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z });
    this.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    this.figure.root.position.copy(p);
    this.figure.root.quaternion.copy(_q);
  }

  ragdoll(impulse?: THREE.Vector3) {
    if (!this.alive) return;
    const game = this.kit.game;
    const b = this.body;
    if (!this.isDown) {
      this.isDown = true;
      this.downAt = game.time;
      b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 6 }, true);
      this.expression('shock');
      game.events.emit('npcRagdoll', { entity: this.entity, cause: 'bonk' });
      game.sfx('scream', this.position, 0.6);
    }
    if (impulse) b.applyImpulse(impulse, true);
    else b.applyImpulse({ x: (Math.random() - 0.5) * 200, y: 260, z: (Math.random() - 0.5) * 200 }, true);
  }

  private getUp(force = false) {
    const b = this.body;
    const t = b.translation();
    const r = b.rotation();
    // keep the heading the body tumbled to (roughly)
    _e.setFromQuaternion(_q.set(r.x, r.y, r.z, r.w), 'YXZ');
    this.yaw = this.wantYaw = _e.y;
    const gy = this.kit.groundY(t.x, t.z, t.y + 1.5, 6);
    this.position.set(t.x, gy, t.z);
    b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    _q.setFromAxisAngle(UP, this.yaw);
    b.setTranslation({ x: t.x, y: gy + CENTER_Y, z: t.z }, true);
    b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    b.setNextKinematicTranslation({ x: t.x, y: gy + CENTER_Y, z: t.z });
    b.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.isDown = false;
    if (!force) this.expression('neutral');
  }

  cheer(secs = 1.6) {
    this.figure.cheer(secs);
  }
  throwAnim() {
    this.figure.throwAnim();
  }
  armsUp(v: number) {
    this.figure.setArmsUp(v);
  }

  handPos(out = new THREE.Vector3()) {
    this.figure.root.updateMatrixWorld(true);
    return this.figure.handR.getWorldPosition(out);
  }

  headPos(out = new THREE.Vector3()) {
    this.figure.root.updateMatrixWorld(true);
    return this.figure.head.getWorldPosition(out).add(_a.set(0, 0.15, 0));
  }

  update(dt: number) {
    if (!this.alive) return;
    const game = this.kit.game;
    const b = this.body;
    if (this.isDown) {
      const t = b.translation();
      this.position.set(t.x, t.y - CENTER_Y, t.z);
      const v = b.linvel();
      const since = game.time - this.downAt;
      if ((since > 2.2 && Math.hypot(v.x, v.y, v.z) < 1.2) || since > 5.5) this.getUp();
      this.figure.animate(dt, 0, true);
      if (t.y < -30) this.getUp(true);
      return;
    }
    // locomotion
    let moving = false;
    if (this.target) {
      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const step = Math.min(d, this.speed * dt);
        const nx = this.position.x + (dx / d) * step;
        const nz = this.position.z + (dz / d) * step;
        const ny = this.kit.groundY(nx, nz, this.position.y + 1.2, 4);
        this.position.set(nx, ny, nz);
        this.wantYaw = Math.atan2(dx, dz);
        this.curSpeed = step / Math.max(dt, 1e-4);
        moving = true;
      } else {
        this.target = null;
      }
    }
    if (!moving) {
      this.curSpeed = 0;
      if (this.lookAtPlayer) {
        const p = this.kit.player?.position;
        if (p && p.distanceToSquared(this.position) < 14 * 14) this.wantYaw = angleTo(this.position, p);
      }
    }
    this.yaw = dampAngle(this.yaw, this.wantYaw, moving ? 12 : 5, dt);
    _q.setFromAxisAngle(UP, this.yaw);
    b.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + CENTER_Y, z: this.position.z });
    b.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    // Visual follows directly too (the physics link skips sleeping bodies)
    this.figure.root.position.copy(this.position);
    this.figure.root.quaternion.copy(_q);
    this.figure.animate(dt, this.curSpeed, false);
  }

  dispose() {
    if (!this.alive) return;
    this.alive = false;
    const game = this.kit.game;
    this.kit.overlay.clearBubbles(this.anchorFn);
    game.entities.remove(this.entity);
    game.physics.removeBody(this.body);
    this.figure.root.removeFromParent();
  }
}

// ================================================================== real NPC wrapper
/**
 * Wraps an NPC from the NPC system. Uses only optional, duck-typed calls so a missing method
 * never throws. Movement is done with `npc.walkTo(target, speed)` when available.
 */
export class NpcActor implements Actor {
  readonly name: string;
  readonly type: string;
  lookAtPlayer: boolean;
  private target: THREE.Vector3 | null = null;
  private lastWalk = new THREE.Vector3(Infinity, 0, 0);
  private _pos = new THREE.Vector3();

  constructor(
    private kit: Kit,
    readonly npc: any,
    opts: ActorOpts,
  ) {
    this.name = opts.name;
    this.type = opts.type;
    this.lookAtPlayer = opts.lookAtPlayer ?? true;
  }

  get alive() {
    const n = this.npc;
    if (n.alive === false || n.removed === true || n.disposed === true) return false;
    if (n.entity && n.entity.alive === false) return false;
    return true;
  }

  get entity(): Entity | undefined {
    return this.npc.entity;
  }

  get position() {
    const n = this.npc;
    if (n.position instanceof THREE.Vector3) return this._pos.copy(n.position);
    const b = n.body ?? n.entity?.body;
    if (b) {
      const t = b.translation();
      return this._pos.set(t.x, t.y, t.z);
    }
    const o: THREE.Object3D | undefined = n.root ?? n.object ?? n.entity?.object;
    if (o) return o.getWorldPosition(this._pos);
    return this._pos;
  }

  get down() {
    const n = this.npc;
    return !!(n.ragdolled ?? n.isRagdoll ?? n.down ?? (n.state === 'ragdoll' || n.mode === 'ragdoll'));
  }

  get remaining() {
    if (!this.target) return 0;
    const p = this.position;
    return Math.hypot(this.target.x - p.x, this.target.z - p.z);
  }

  say(text: string, secs = 2.6, big = false) {
    const ent = this.npc.entity;
    if (big && ent && this.kit.hasListeners('speech')) {
      // chants: the UI's shouty bubble style
      this.kit.game.events.emit('speech', { entity: ent, text, duration: secs, style: 'shout', key: ent.id });
      this.npc.setExpression?.('happy');
    } else if (typeof this.npc.say === 'function') this.npc.say(text, secs);
    else this.kit.overlay.bubble(() => (this.alive ? this.headPos() : null), text, secs, { big });
  }
  expression(e: string) {
    this.npc.setExpression?.(e);
  }
  face(target: THREE.Vector3 | number) {
    const n = this.npc;
    if (typeof target === 'number') {
      if (typeof n.face === 'function') n.face(target);
      else if (typeof n.lookAt === 'function') n.lookAt(this.position.clone().add(new THREE.Vector3(Math.sin(target), 0, Math.cos(target))));
    } else if (typeof n.lookAt === 'function') n.lookAt(target);
    else if (typeof n.face === 'function') n.face(target);
  }
  moveTo(target: THREE.Vector3, speed: number) {
    this.target = (this.target ?? new THREE.Vector3()).copy(target);
    if (this.lastWalk.distanceToSquared(target) > 0.04) {
      this.lastWalk.copy(target);
      this.npc.walkTo?.(target.clone(), speed);
    }
  }
  stop() {
    this.target = null;
    this.lastWalk.set(Infinity, 0, 0);
    this.npc.stop?.();
  }
  teleport(p: THREE.Vector3, yaw?: number) {
    const n = this.npc;
    if (typeof n.teleport === 'function') n.teleport(p.clone(), yaw);
    else {
      const b = n.body ?? n.entity?.body;
      b?.setTranslation({ x: p.x, y: p.y + CENTER_Y, z: p.z }, true);
    }
    if (yaw != null) this.face(yaw);
  }
  ragdoll(impulse?: THREE.Vector3) {
    this.npc.ragdoll?.(impulse);
  }
  cheer(secs = 1.6) {
    const n = this.npc;
    if (typeof n.cheer === 'function') n.cheer(secs);
    else if (typeof n.emote === 'function') n.emote('cheer', secs);
    else n.setExpression?.('happy');
  }
  /** (Only gestures the NPC animator actually has: cheer, wave, point, shrug, panic, aww, …) */
  throwAnim() {
    this.npc.emote?.('point', 0.8);
  }
  armsUp(v: number) {
    if (v > 0.5) this.npc.emote?.('cheer', 3.5);
  }
  handPos(out = new THREE.Vector3()) {
    const n = this.npc;
    if (typeof n.handPos === 'function') return n.handPos(out);
    const p = this.position;
    const yaw = typeof n.yaw === 'number' ? n.yaw : typeof n.facing === 'number' ? n.facing : 0;
    return out.set(p.x + Math.sin(yaw) * 0.35, p.y + 1.25, p.z + Math.cos(yaw) * 0.35);
  }
  headPos(out = new THREE.Vector3()) {
    const n = this.npc;
    if (typeof n.headPos === 'function') return n.headPos(out);
    return out.copy(this.position).add(_a.set(0, 1.85, 0));
  }
  update(_dt: number) {
    if (this.target && this.remaining < 0.35) this.target = null;
  }
  dispose() {
    const n = this.npc;
    const npcs = this.kit.npcs;
    if (typeof n.remove === 'function') n.remove();
    else if (typeof n.dispose === 'function') n.dispose();
    else if (typeof npcs?.remove === 'function') npcs.remove(n);
    else if (typeof npcs?.despawn === 'function') npcs.despawn(n);
  }
}
