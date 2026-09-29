import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import { Emote, type EmoteIcon } from './Emote';
import { RaccoonRig, defaultPose, clearPose, type RigPose, type RigSpec } from './RaccoonRig';

/**
 * Base class for gameplay animals (Mom, kits, Danny, crows, waterfront gulls).
 *
 * Animals are *kinematic* bodies in collision group G.ANIMAL driven by simple behaviour code, so they never
 * get stuck, launched into orbit or crushed: every knock is a cartoon tumble (our own little ballistic sim)
 * that ends with them shaking it off. They are registered entities (kind 'animal') so Jimothy can grab, bonk
 * and wash them — each species decides how cute the reaction is.
 */

export type Species = 'mom' | 'kit' | 'danny' | 'crow' | 'gull';

export interface AnimalConfig {
  name: string;
  species: Species;
  position: THREE.Vector3;
  yaw?: number;
  /** Ball collider radius (default) … */
  ball?: number;
  /** … or box half-extents (x = width, y = height, z = length). */
  box?: [number, number, number];
  /** Height of the collider centre above the ground (m). */
  colliderY: number;
  mass: number;
  tags?: string[];
  /** Collision filter (membership is always G.ANIMAL). Must be non-zero so grab/bonk queries find us. */
  filter?: number;
  /** Emote bubble height above the ground (m). */
  emoteY: number;
  emoteSize?: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
const ICONS = new Set(['question', 'exclaim', 'heart', 'note', 'zzz', 'dots', 'dizzy', 'sparkle', 'grumpy']);

/** True if some system subscribed to `name`. */
function hasListener(game: Game, name: string): boolean {
  const map = (game.events as any)?.map as Map<string, Set<unknown>> | undefined;
  return !!map?.get?.(name)?.size;
}
export const UP = new THREE.Vector3(0, 1, 0);
export const WORLD_ONLY = groups(G.ALL, G.WORLD);
export const GRAVITY = 14;

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function dampAngle(a: number, b: number, k: number, dt: number) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-k * dt));
}
export const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

export abstract class Animal {
  readonly game: Game;
  readonly cfg: AnimalConfig;
  readonly name: string;
  readonly species: Species;
  entity!: Entity;
  body!: RAPIER.RigidBody;
  /** Ground-level position (feet). */
  readonly pos = new THREE.Vector3();
  yaw = 0;
  /** Extra visual pitch (climbing behind Jimothy). */
  pitch = 0;
  /** Horizontal speed this frame (m/s), for animation. */
  speed = 0;
  /** Ballistic velocity while airborne. */
  readonly vel = new THREE.Vector3();
  airborne = false;
  swimming = false;
  state = 'idle';
  stateTime = 0;
  alive = true;
  emote!: Emote;
  /** Spin while tumbling (rad/s) and its axis. */
  protected spinRate = 0;
  protected readonly spinAxis = new THREE.Vector3(1, 0, 0);
  /** Accumulated tumble rotation (applied to the visual pivot by subclasses). */
  readonly tumbleQ = new THREE.Quaternion();
  /** Stay put vertically (no ground snapping) — flying crows, carried kits, scripted moments. */
  noGround = false;
  private readonly prevPos = new THREE.Vector3();
  private waterCheck = 0;
  private waterSurface: number | null = null;

  constructor(game: Game, cfg: AnimalConfig) {
    this.game = game;
    this.cfg = cfg;
    this.name = cfg.name;
    this.species = cfg.species;
    this.pos.copy(cfg.position);
    this.prevPos.copy(cfg.position);
    this.yaw = cfg.yaw ?? 0;
  }

  /** Create the kinematic body + entity. Call from the subclass constructor once `visualRoot` exists. */
  protected setupPhysics(visualRoot: THREE.Object3D) {
    const cfg = this.cfg;
    const game = this.game;
    const p = this.pos;
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y + cfg.colliderY, p.z);
    const cd = cfg.box ? RAPIER.ColliderDesc.cuboid(cfg.box[0], cfg.box[1], cfg.box[2]) : RAPIER.ColliderDesc.ball(cfg.ball ?? 0.3);
    cd.setMass(cfg.mass)
      .setFriction(0.6)
      .setRestitution(0.1)
      .setCollisionGroups(groups(G.ANIMAL, cfg.filter ?? G.WORLD));
    this.body = game.physics.createBody(desc, [cd]);
    this.entity = game.entities.create({
      kind: 'animal',
      name: cfg.name,
      body: this.body,
      mass: cfg.mass,
      tags: new Set(['animal', cfg.species, ...(cfg.tags ?? [])]),
      data: { animal: this, species: cfg.species, size: new THREE.Vector3(0.4, 0.34, 0.5), floatRadius: 0.3 },
      onBonk: (_g, impulse, point) => {
        if (this.isPlayerBonk()) this.markToss('bonk');
        this.handleBonk(impulse, point);
        return true;
      },
      onGrab: () => this.handleGrab(),
      onWash: () => this.handleWash(),
      onRelease: (_g, thrown) => {
        if (thrown) this.markToss('throw');
        this.handleRelease(thrown);
      },
    });
    this.emote = new Emote(visualRoot, cfg.emoteY, cfg.emoteSize ?? 0.36);
    this.visualRoot = visualRoot;
    // the model root: the DetailCuller hides far animals through this, the UI anchors bubbles to it
    this.entity.object = visualRoot;
  }

  /**
   * Keep ticking even when far from Jimothy (off on an errand, following him, scripted). Everything else is
   * frozen beyond FREEZE_DIST (no behaviour, no animation) — the DetailCuller hides them anyway.
   */
  get keepAwake(): boolean {
    return this.airborne;
  }

  // ----------------------------------------------------------------------------------------- hooks
  /** Behaviour tick (before physics). */
  protected abstract think(dt: number): void;
  /** Visual sync + animation (after physics). */
  abstract sync(dt: number): void;
  protected abstract handleBonk(impulse: THREE.Vector3, point: THREE.Vector3): void;
  /** Return false to refuse (default: refuse and react). */
  protected handleGrab(): boolean | void | Entity {
    return false;
  }
  protected handleWash(): void {}
  protected handleRelease(_thrown: boolean): void {}
  /** Called when a ballistic tumble finishes on the ground. */
  protected onLanded(_impact: number): void {}

  // ----------------------------------------------------------------------------------------- per-frame
  update(dt: number) {
    if (!this.alive) return;
    this.stateTime += dt;
    this.prevPos.copy(this.pos);
    if (this.airborne) this.updateBallistic(dt);
    else this.think(dt);
    const moved = Math.hypot(this.pos.x - this.prevPos.x, this.pos.z - this.prevPos.z);
    this.speed = dt > 0 ? moved / dt : 0;
    this.pushBody();
    if (this.tossT > -1e8) this.checkToss();
  }

  // ----------------------------------------------------------------------------------------- tossed by Jimothy
  /** When Jimothy last threw us / knocked us flying (game time), and how. */
  private tossT = -1e9;
  private tossHow: 'throw' | 'bonk' = 'throw';
  /** Seconds after a toss in which landing in water still counts as his doing. */
  static readonly TOSS_WINDOW = 5;

  protected markToss(how: 'throw' | 'bonk') {
    this.tossT = this.game.time;
    this.tossHow = how;
  }

  /**
   * A toss by Jimothy that ends in water within TOSS_WINDOW s emits 'animalSplash' { animal, entity, species,
   * water (kind), waterName, how, position } once. "Return From Whence You Came" listens for water 'bay'.
   */
  private checkToss() {
    if (this.entity.data.heldByPlayer) return;
    if (this.game.time - this.tossT > Animal.TOSS_WINDOW) {
      this.tossT = -1e9;
      return;
    }
    const vol = this.game.get<any>('water')?.volumeAt?.(_v.set(this.pos.x, this.pos.y + 0.05, this.pos.z));
    if (!vol) return;
    this.tossT = -1e9;
    this.game.events.emit('animalSplash', {
      animal: this,
      entity: this.entity,
      species: this.species,
      water: vol.kind,
      waterName: vol.name,
      how: this.tossHow,
      position: this.pos.clone(),
    });
  }

  /** Move the kinematic body to follow `pos`/`yaw` (skipped while Jimothy is carrying us). */
  protected pushBody() {
    const b = this.body;
    if (!b || this.entity.data.heldByPlayer || !b.isKinematic()) return;
    _q.setFromAxisAngle(UP, this.yaw);
    b.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.cfg.colliderY, z: this.pos.z });
    b.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  }

  setState(s: string) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
  }

  /** Jump straight to a spot (ground-snapped unless `keepY`). */
  place(p: THREE.Vector3, yaw?: number, keepY = false) {
    this.pos.copy(p);
    if (!keepY) this.pos.y = this.groundAt(p.x, p.z, p.y + 0.6);
    if (yaw != null) this.yaw = yaw;
    this.airborne = false;
    this.vel.set(0, 0, 0);
    this.prevPos.copy(this.pos);
    // move the visual right away too (we may be frozen far from Jimothy and not sync for a while)
    if (this.visualRoot) {
      this.visualRoot.position.copy(this.pos);
      this.visualRoot.rotation.y = this.yaw;
    }
    const b = this.body;
    if (b && !this.entity.data.heldByPlayer) {
      if (!b.isKinematic()) b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      b.setTranslation({ x: this.pos.x, y: this.pos.y + this.cfg.colliderY, z: this.pos.z }, true);
    }
  }

  // ----------------------------------------------------------------------------------------- queries
  get player(): any {
    return this.game.get<any>('player');
  }

  /** Is Jimothy the one bonking us right now? (Cars and other systems call onBonk too.) */
  isPlayerBonk(): boolean {
    const pl = this.player;
    if (!pl) return false;
    const size = pl.sizeMul ?? 1;
    const d = Math.hypot(pl.position.x - this.pos.x, pl.position.z - this.pos.z);
    if (d > 2.4 * Math.max(1, size)) return false;
    const since = this.game.time - ((pl as any).bonkTime ?? -10);
    return since < 0.5 || pl.mode === 'roll' || pl.mode === 'ragdoll' || size > 1.4;
  }

  /** Startled hop out of the way (something that isn't Jimothy bumped us — usually a car). */
  dodge(impulse: THREE.Vector3) {
    if (this.airborne) return;
    const h = _v2.set(impulse.x, 0, impulse.z);
    if (h.lengthSq() < 1e-4) h.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    h.normalize();
    // leap sideways, out of the car's path
    const side = Math.random() < 0.5 ? 1 : -1;
    const v = new THREE.Vector3(-h.z * side * 3.2 + h.x * 1.2, 4.8, h.x * side * 3.2 + h.z * 1.2);
    this.launch(v, 0);
    this.say('exclaim', 0.9);
    this.game.sfx('squeak', this.pos, 0.5, 1.3);
  }

  distToPlayer() {
    const p = this.player?.position as THREE.Vector3 | undefined;
    return p ? Math.hypot(p.x - this.pos.x, p.z - this.pos.z) : Infinity;
  }

  /** Yaw that faces a point. */
  yawTo(p: THREE.Vector3) {
    return Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  /** Signed angle from our facing to a point (for head look). */
  lookAngleTo(p: THREE.Vector3) {
    return wrapAngle(this.yawTo(p) - this.yaw);
  }

  /**
   * Ground (or water surface) height under (x, z), raycasting static world from `fromY` down.
   * The default origin (0.6 m above our feet) is the max step-up, so we never pop onto low decks or
   * roofs we happen to be under (Mom lives under a porch!).
   */
  groundAt(x: number, z: number, fromY = this.pos.y + 0.6): number {
    const hit = this.game.physics.raycast(_v.set(x, fromY, z), DOWN, 12, WORLD_ONLY);
    let y: number;
    if (hit && hit.distance < 0.004) {
      // the ray started inside a solid collider (a building's box, a tree canopy…): can't see the floor from
      // in here, so keep our height instead of "climbing" out through the roof.
      y = Math.min(this.pos.y, fromY);
    } else y = hit ? hit.point.y : (this.game.get<any>('world')?.heightAt?.(x, z) ?? 0);
    // Water: paddle at the surface instead of walking on the bottom
    this.waterCheck -= 1;
    if (this.waterCheck <= 0) {
      this.waterCheck = 6;
      const vol = this.game.get<any>('water')?.volumeAt?.(_v2.set(x, y + 0.05, z));
      this.waterSurface = vol && vol.surfaceY > y + 0.12 ? vol.surfaceY : null;
    }
    this.swimming = this.waterSurface != null;
    if (this.waterSurface != null) y = Math.max(y, this.waterSurface - this.swimDepth);
    return y;
  }

  /** How far below the water surface our feet sit while paddling. */
  protected get swimDepth() {
    return this.cfg.colliderY * 1.2;
  }

  /**
   * Walk toward a point. Turns first, then moves along the facing (slides along walls).
   * Returns the remaining horizontal distance.
   */
  walkToward(target: THREE.Vector3, speed: number, dt: number, turnRate = 8, stopDist = 0.05): number {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopDist) return d;
    const want = Math.atan2(dx, dz);
    this.yaw = dampAngle(this.yaw, want, turnRate, dt);
    const facing = Math.cos(wrapAngle(want - this.yaw));
    const step = Math.min(d - stopDist, speed * dt * THREE.MathUtils.clamp(facing, 0.2, 1));
    const dir = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const r = this.cfg.ball ?? this.cfg.box?.[0] ?? 0.3;
    const hit = this.game.physics.raycast(_v.copy(this.pos).setY(this.pos.y + Math.max(0.12, this.cfg.colliderY)), dir, r + step + 0.05, WORLD_ONLY);
    if (hit && Math.abs(hit.normal.y) < 0.5) {
      // slide along the wall
      const n = hit.normal.setY(0).normalize();
      dir.addScaledVector(n, -dir.dot(n));
      if (dir.lengthSq() < 1e-4) return d;
      dir.normalize();
    }
    this.pos.addScaledVector(dir, step);
    this.snapToGround(dt);
    return d - step;
  }

  /** Smoothly settle onto the ground under us. */
  snapToGround(dt: number, k = 18) {
    if (this.noGround) return;
    const g = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < g || Math.abs(this.pos.y - g) > 1.5) this.pos.y = g;
    else this.pos.y = damp(this.pos.y, g, k, dt);
  }

  turnToward(yaw: number, dt: number, k = 6) {
    this.yaw = dampAngle(this.yaw, yaw, k, dt);
  }

  // ----------------------------------------------------------------------------------------- tumbles
  /** Cartoon launch: ballistic flight + spin, ends with onLanded(). */
  launch(v: THREE.Vector3, spin = 9) {
    this.vel.copy(v);
    this.airborne = true;
    this.spinRate = spin;
    // Spin around the horizontal axis perpendicular to the flight direction (a forward roll), expressed in
    // the visual root's yawed frame (the tumble rotation is applied to a child of the yawed root).
    const c = Math.cos(-this.yaw);
    const s = Math.sin(-this.yaw);
    const lx = v.x * c + v.z * s;
    const lz = -v.x * s + v.z * c;
    this.spinAxis.set(lz, 0, -lx);
    if (this.spinAxis.lengthSq() < 1e-4) this.spinAxis.set(1, 0, 0);
    this.spinAxis.normalize();
  }

  protected updateBallistic(dt: number) {
    this.vel.y -= GRAVITY * dt;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.05) {
      const dir = _v2.set(this.vel.x / hs, 0, this.vel.z / hs);
      const r = this.cfg.ball ?? this.cfg.box?.[0] ?? 0.3;
      const hit = this.game.physics.raycast(_v.copy(this.pos).setY(this.pos.y + this.cfg.colliderY), dir, r + hs * dt + 0.02, WORLD_ONLY);
      if (hit && Math.abs(hit.normal.y) < 0.6) {
        const n = hit.normal.setY(0).normalize();
        const vn = this.vel.x * n.x + this.vel.z * n.z;
        if (vn < 0) {
          this.vel.x -= 1.6 * vn * n.x;
          this.vel.z -= 1.6 * vn * n.z;
        }
      }
    }
    this.pos.addScaledVector(this.vel, dt);
    if (this.spinRate) _q.setFromAxisAngle(this.spinAxis, this.spinRate * dt);
    if (this.spinRate) this.tumbleQ.premultiply(_q);
    // look for the floor just above our current height (catches it as we fall through, never a roof above)
    const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.3);
    if (this.pos.y <= g && this.vel.y <= 0) {
      this.pos.y = g;
      const impact = -this.vel.y;
      if (impact > 3.2) {
        this.vel.set(this.vel.x * 0.55, impact * 0.32, this.vel.z * 0.55);
        this.spinRate *= 0.6;
        this.game.sfx('boing', this.pos, 0.35, 1.5);
      } else {
        this.airborne = false;
        this.vel.set(0, 0, 0);
        this.spinRate = 0;
        this.onLanded(impact);
      }
    }
    if (this.pos.y < -30) {
      // fell out of the world somehow: pop back up where we were
      this.airborne = false;
      this.place(this.prevPos);
    }
  }

  // ----------------------------------------------------------------------------------------- helpers
  /** Emote icon ('heart', 'question', …) as a little bubble sprite, or a short line of text. */
  say(what: EmoteIcon | string, secs = 2) {
    const isIcon = ICONS.has(what);
    if (!isIcon && this.visualRoot && hasListener(this.game, 'speech')) {
      // text goes through the UI's speech bubbles so it matches the humans' bubbles
      this.game.events.emit('speech', { object: this.visualRoot, text: what, duration: secs, offsetY: this.cfg.emoteY, key: this });
      return;
    }
    this.emote?.show(what, secs);
  }

  /** The visual root the emote bubble follows. */
  protected visualRoot: THREE.Object3D | null = null;
  private ceilT = Math.random() * 0.5;

  /** Keep the emote bubble under low ceilings (Mom's den is under a porch). Call every frame; cheap. */
  protected fitEmote(dt: number) {
    this.ceilT -= dt;
    if (this.ceilT > 0 || !this.emote) return;
    this.ceilT = 0.4;
    const from = _v.set(this.pos.x, this.pos.y + 0.3, this.pos.z);
    const hit = this.game.physics.raycast(from, UP, this.cfg.emoteY + 0.4, WORLD_ONLY);
    const room = hit ? hit.distance + 0.3 - 0.42 : this.cfg.emoteY;
    this.emote.height = THREE.MathUtils.clamp(room, this.cfg.emoteY * 0.55, this.cfg.emoteY);
  }

  /** Hearts above us (FX system or fallback). */
  hearts(count = 5, yOff = 0) {
    const sys = this.game.get<any>('animals');
    sys?.hearts?.(_v.copy(this.pos).setY(this.pos.y + this.cfg.emoteY * 0.8 + yOff), count);
  }

  dispose() {
    this.alive = false;
    this.game.entities.remove(this.entity);
    if (this.body) this.game.physics.removeBody(this.body);
    this.emote?.dispose();
  }
}

/** A raccoon (Mom / kit / Danny): Animal + RaccoonRig + pose handling. */
export abstract class RaccoonAnimal extends Animal {
  readonly rig: RaccoonRig;
  readonly pose: RigPose = defaultPose();
  /** Target orientation of the rig pivot when not tumbling (e.g. Danny on his back / rolling). */
  readonly pivotTarget = new THREE.Quaternion();
  /** 0..1 while recovering from a tumble (shake-off). */
  protected recover = 0;

  constructor(game: Game, cfg: AnimalConfig, spec: RigSpec) {
    super(game, cfg);
    this.rig = new RaccoonRig(spec);
    game.scene.add(this.rig.root);
    this.setupPhysics(this.rig.root);
    const furOn = (game.renderer as any)?.quality !== 'low';
    this.rig.load(game.assets, furOn).catch(() => {});
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }

  /** Subclasses fill `this.pose` here (it is cleared to defaults first). */
  protected abstract animatePose(dt: number, p: RigPose): void;

  sync(dt: number) {
    const game = this.game;
    const root = this.rig.root;
    if (this.entity.data.heldByPlayer && this.body) {
      // Being carried: follow the body the player moves around
      const t = this.body.translation();
      this.pos.set(t.x, t.y - this.cfg.colliderY, t.z);
      const player = this.player;
      if (player) this.yaw = dampAngle(this.yaw, player.facing ?? this.yaw, 10, dt);
    }
    root.position.copy(this.pos);
    root.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // pivot: tumbles spin freely, otherwise ease back to the pivot target
    if (this.airborne) {
      this.rig.pivot.quaternion.copy(this.tumbleQ);
    } else {
      this.tumbleQ.slerp(this.pivotTarget, 1 - Math.exp(-dt * 9));
      this.rig.pivot.quaternion.copy(this.tumbleQ);
    }
    // Level of detail from the camera distance (with a little hysteresis)
    const camD = game.camera.position.distanceTo(this.pos);
    const cur = this.rig.detailLevel;
    const lvl = camD < (cur === 0 ? 17 : 15) ? 0 : camD < (cur === 2 ? 42 : 46) ? 1 : 2;
    this.rig.setDetail(lvl as 0 | 1 | 2);
    this.fitEmote(dt);
    this.emote.update(dt, game.time);
    // Far away: animate at a quarter rate (the pose barely reads at that size)
    this.animAcc += dt;
    if (camD > 45 && (game.frame + this.lodPhase) % 4 !== 0) return;
    const adt = Math.min(this.animAcc, 0.25);
    this.animAcc = 0;
    clearPose(this.pose);
    if (this.airborne) {
      this.pose.flail = 1;
      this.pose.tuck = 0.3;
      this.pose.earsBack = 1;
      this.pose.eyes = 0.3;
    }
    this.animatePose(adt, this.pose);
    this.rig.night = game.get<any>('environment')?.nightFactor ?? 0;
    this.rig.animate(adt, this.pose, this.speed, game.time);
  }

  private animAcc = 0;
  private readonly lodPhase = Math.floor(Math.random() * 4);

  /** Standard "shake it off" after a tumble: flail → shake → back to normal. */
  protected poseRecover(p: RigPose) {
    if (this.recover > 0) {
      p.shake = Math.min(1, this.recover * 1.6);
      p.earsBack = 0.3;
    }
  }

  override dispose() {
    super.dispose();
    this.rig.root.removeFromParent();
  }
}
