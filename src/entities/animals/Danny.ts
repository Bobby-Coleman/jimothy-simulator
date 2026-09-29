import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { G, groups } from '../../core/Physics';
import { RaccoonAnimal, damp, wrapAngle } from './Animal';
import { RIGS, type RigPose } from './RaccoonRig';

/**
 * Danny: another round, short-spined raccoon, famous for rolling across a lawn. Might be Jimothy's dad.
 * Lounges on his lawn (sits, sunbathes belly-up, lazily rolls about). Chitter at him and he chitters back,
 * then invites Jimothy to roll together.
 */

type DannyState =
  | 'sit'
  | 'sunbathe'
  | 'lazyRoll'
  | 'greet' // heard a chitter
  | 'rollTogether' // waiting for / rolling with Jimothy
  | 'reunion'
  | 'bowled' // got bonked: rolls away like a bowling ball
  | 'recover';

const R = 0.47;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const BACK = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

export class Danny extends RaccoonAnimal {
  /** Centre of where he hangs out (his lawn, or the den when visiting). */
  readonly center = new THREE.Vector3();
  roam = 5;
  readonly lawn = new THREE.Vector3();
  private rollQ = new THREE.Quaternion();
  private rolling = false;
  private target = new THREE.Vector3();
  private nextIdle = 4;
  private chitterAt = -1;
  private circleA = 0;
  private washCd = 0;
  private hugCd = 0;
  private lookYaw = 0;
  private lookT = 0;
  /** Jimothy chittered and Danny invited him to roll (quest reads this). */
  inviting = false;
  private readonly baseFilter = G.PLAYER | G.PROP | G.NPC | G.RAGDOLL;

  constructor(game: Game, pos: THREE.Vector3, yaw = 0) {
    super(
      game,
      {
        name: 'Danny',
        species: 'danny',
        position: pos,
        yaw,
        ball: R,
        colliderY: R,
        mass: 14,
        tags: ['family', 'danny', 'round'],
        filter: G.PLAYER | G.PROP | G.NPC | G.RAGDOLL,
        emoteY: 1.12,
        emoteSize: 0.42,
      },
      RIGS.danny,
    );
    this.center.copy(this.pos);
    this.lawn.copy(this.pos);
    this.entity.data.size = new THREE.Vector3(0.9, 0.9, 0.9);
    this.setState('sit');
  }

  // ------------------------------------------------------------------------------------------- quest API
  /** Jimothy chittered nearby. Returns true if Danny responds. */
  hearChitter() {
    if (this.airborne || this.state === 'reunion' || this.state === 'bowled' || this.state === 'recover') return false;
    if (this.state === 'greet' || this.state === 'rollTogether') return true;
    this.setState('greet');
    this.chitterAt = 0.55;
    this.stopRolling();
    this.say('exclaim', 0.9);
    return true;
  }

  /** Stop inviting (timed out). */
  giveUp() {
    this.inviting = false;
    this.stopRolling();
    this.setState('sit');
    this.say('dots', 1.8);
  }

  /** The big moment: unroll, face Jimothy, happy hops. */
  reunion() {
    this.inviting = false;
    this.stopRolling();
    this.setState('reunion');
  }

  /** Move his hangout (lawn ↔ den visit). */
  relocate(p: THREE.Vector3, roam: number, yaw = this.yaw) {
    this.center.copy(p);
    this.roam = roam;
    this.stopRolling();
    this.place(p, yaw);
    this.setState('sit');
  }

  get isRolling() {
    return this.rolling;
  }
  override get keepAwake() {
    return this.airborne || this.inviting || this.rolling || this.state === 'greet' || this.state === 'reunion' || this.state === 'bowled';
  }

  private startRolling() {
    if (this.rolling) return;
    this.rolling = true;
    this.game.sfx('boing', this.pos, 0.4, 1.1);
  }

  private stopRolling() {
    if (!this.rolling) return;
    this.rolling = false;
  }

  private setPlayerCollisions(on: boolean) {
    const c = this.body?.collider(0);
    if (c) c.setCollisionGroups(groups(G.ANIMAL, on ? this.baseFilter : this.baseFilter & ~G.PLAYER));
  }

  // ------------------------------------------------------------------------------------------- behaviour
  protected think(dt: number) {
    const game = this.game;
    const player = this.player;
    this.washCd -= dt;
    this.hugCd -= dt;
    const dPlayer = this.distToPlayer();
    let rollSpeed = 0;

    switch (this.state as DannyState) {
      case 'sit': {
        this.snapToGround(dt);
        this.nextIdle -= dt;
        if (this.nextIdle <= 0) this.pickIdle();
        break;
      }
      case 'sunbathe': {
        this.snapToGround(dt);
        this.nextIdle -= dt;
        if (this.nextIdle <= 0 || (dPlayer < 2 && this.stateTime > 2)) {
          this.nextIdle = 5 + Math.random() * 5;
          this.setState('sit');
        }
        break;
      }
      case 'lazyRoll': {
        this.startRolling();
        const d = this.walkToward(this.target, 1.5, dt, 3, 0.1);
        rollSpeed = this.speed;
        if (d < 0.2 || this.stateTime > 9) {
          this.stopRolling();
          this.nextIdle = 4 + Math.random() * 5;
          this.setState('sit');
        }
        break;
      }
      case 'greet': {
        this.snapToGround(dt);
        if (player) this.turnToward(this.yawTo(player.position), dt, 8);
        if (this.chitterAt > 0) {
          this.chitterAt -= dt;
          if (this.chitterAt <= 0) {
            game.sfx('chitter', this.pos, 1, 0.82);
            this.say('note', 1.4);
            this.rig.chirp();
          }
        }
        if (this.stateTime > 2.1) {
          this.say('Roll with me?', 2.6);
          this.inviting = true;
          this.circleA = Math.atan2(this.pos.z - this.center.z, this.pos.x - this.center.x);
          this.setState('rollTogether');
        }
        break;
      }
      case 'rollTogether': {
        this.startRolling();
        this.setPlayerCollisions(false);
        const pr = player?.position as THREE.Vector3 | undefined;
        const playerRolling = player?.mode === 'roll';
        if (pr && playerRolling && dPlayer < 10 && Math.hypot(pr.x - this.center.x, pr.z - this.center.z) < 16) {
          // roll alongside him, side by side
          const pv = player.velocity as THREE.Vector3;
          const sp = Math.hypot(pv.x, pv.z);
          const fx = sp > 0.5 ? pv.x / sp : Math.sin(this.yaw);
          const fz = sp > 0.5 ? pv.z / sp : Math.cos(this.yaw);
          // pick the side he's already on
          const side = Math.sign((this.pos.x - pr.x) * fz - (this.pos.z - pr.z) * fx) || 1;
          this.target.set(pr.x + fz * 1.5 * side + fx * 0.6, 0, pr.z - fx * 1.5 * side + fz * 0.6);
          this.walkToward(this.target, Math.max(2.4, Math.min(12, sp + 2)), dt, 7, 0.05);
          this.circleA = Math.atan2(this.pos.z - this.center.z, this.pos.x - this.center.x);
        } else {
          // lazy circles around the lawn, waiting for him
          const r = Math.min(3.2, this.roam);
          this.circleA += (2.4 / r) * dt;
          this.target.set(this.center.x + Math.cos(this.circleA) * r, 0, this.center.z + Math.sin(this.circleA) * r);
          this.walkToward(this.target, 3.2, dt, 6, 0.05);
        }
        rollSpeed = this.speed;
        break;
      }
      case 'reunion': {
        this.setPlayerCollisions(true);
        this.snapToGround(dt);
        if (player) this.turnToward(this.yawTo(player.position), dt, 8);
        const k = Math.floor(this.stateTime / 0.55);
        const prevK = Math.floor((this.stateTime - dt) / 0.55);
        if (k !== prevK && k < 4) {
          game.sfx(k % 2 ? 'happy' : 'chitter', this.pos, 0.9, 0.85);
          this.hearts(4);
        }
        if (this.stateTime > 5.5) {
          this.nextIdle = 6;
          this.setState('sit');
        }
        break;
      }
      case 'bowled': {
        // decelerating roll after a bonk
        const hs = Math.hypot(this.vel.x, this.vel.z);
        const decel = Math.max(0, hs - 5 * dt);
        if (hs > 0.01) {
          this.vel.x *= decel / hs;
          this.vel.z *= decel / hs;
        }
        _v.copy(this.pos).addScaledVector(this.vel, dt);
        this.walkToward(_v, hs, dt, 30, 0);
        rollSpeed = this.speed;
        if (hs < 0.3 || this.stateTime > 4) {
          this.vel.set(0, 0, 0);
          this.stopRolling();
          this.recover = 1;
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        this.setPlayerCollisions(true);
        this.snapToGround(dt);
        if (this.stateTime > 1.3 && this.stateTime - dt <= 1.3) {
          game.sfx('chitter', this.pos, 0.7, 0.9);
          this.say('note', 1.2);
        }
        if (this.stateTime > 2.2) {
          this.nextIdle = 3;
          this.setState('sit');
        }
        break;
      }
    }

    // roll visuals: forward roll about the (yawed) local X axis
    if (this.rolling && rollSpeed > 0.01) {
      _q.setFromAxisAngle(X, (rollSpeed * dt) / R);
      this.rollQ.premultiply(_q);
    }
    // wander back if he somehow strays too far from his hangout
    if (!this.rolling && this.state === 'sit' && Math.hypot(this.pos.x - this.center.x, this.pos.z - this.center.z) > this.roam + 4) {
      this.target.copy(this.center);
      this.setState('lazyRoll');
    }
    // look around / at Jimothy
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 1.5 + Math.random() * 2.5;
      this.lookYaw = (Math.random() - 0.5) * 1.2;
    }
    if (player && dPlayer < 7) this.lookYaw = wrapAngle(this.lookAngleTo(player.position));
  }

  private pickIdle() {
    const r = Math.random();
    if (r < 0.35) {
      this.nextIdle = 8 + Math.random() * 7;
      this.setState('sunbathe');
      this.game.sfx('purr', this.pos, 0.4, 0.8);
    } else if (r < 0.75 && this.roam > 1.5) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * this.roam;
      this.target.set(this.center.x + Math.cos(a) * rr, 0, this.center.z + Math.sin(a) * rr);
      this.setState('lazyRoll');
    } else {
      this.nextIdle = 5 + Math.random() * 5;
      this.setState('sit');
      this.stateTime = 0;
    }
  }

  // ------------------------------------------------------------------------------------------- reactions
  protected handleGrab() {
    if (this.airborne || this.hugCd > 0) return false;
    this.hugCd = 1.5;
    this.say('heart', 1.5);
    this.hearts(6);
    this.game.sfx('happy', this.pos, 0.8, 0.8);
    this.game.score(25, 'Round Hug', this.pos.clone());
    this.game.events.emit('dannyHug', {});
    return false;
  }

  protected handleBonk(impulse: THREE.Vector3) {
    if (this.airborne || this.state === 'reunion') return;
    const h = _v.set(impulse.x, 0, impulse.z);
    if (h.lengthSq() < 1e-4) h.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    h.normalize();
    this.yaw = Math.atan2(h.x, h.z);
    this.vel.set(h.x * 7, 0, h.z * 7);
    this.inviting = false;
    this.startRolling();
    this.setPlayerCollisions(false);
    this.setState('bowled');
    this.game.sfx('boing', this.pos, 0.7, 0.8);
    this.say('Wheee!', 1.2);
  }

  protected handleWash() {
    if (this.washCd > 0) return;
    this.washCd = 2;
    const first = !this.entity.data.washed;
    this.entity.data.washed = true;
    this.say(first ? 'Fresh!' : 'heart', 1.6);
    this.hearts(5);
    this.game.events.emit('sparkle', { entity: this.entity, position: this.pos.clone() });
    this.game.sfx('chitter', this.pos, 0.8, 0.85);
    this.game.score(first ? 70 : 10, first ? 'Washed Danny' : 'Danny Is Squeaky', this.pos.clone());
  }

  protected onLanded() {
    this.recover = 1;
    this.setState('recover');
  }

  // ------------------------------------------------------------------------------------------- animation
  protected animatePose(dt: number, p: RigPose) {
    const t = this.game.time;
    this.recover = Math.max(0, this.recover - dt * 0.9);
    p.lookYaw = this.lookYaw;
    p.tailWag = 0.3;
    // Pivot: rolling ball / belly-up / upright
    if (this.rolling) {
      p.tuck = 1;
      p.eyes = 0.2;
      p.happy = 1;
      this.rig.pivot.quaternion.copy(this.rollQ);
      this.tumbleQ.copy(this.rollQ);
    } else {
      this.rollQ.slerp(this.state === 'sunbathe' ? BACK : this.pivotTarget.identity(), 1 - Math.exp(-dt * 5));
      if (this.state === 'sunbathe') {
        this.rig.pivot.quaternion.copy(this.rollQ);
        this.tumbleQ.copy(this.rollQ);
      } else if (!this.airborne) {
        // ease the ball upright again after rolling
        this.tumbleQ.copy(this.rollQ);
        this.rig.pivot.quaternion.copy(this.rollQ);
      }
    }
    switch (this.state as DannyState) {
      case 'sit':
        if (Math.floor(t / 9 + 0.3) % 4 === 0) {
          p.groom = 1;
          p.lookPitch = 0.2;
        }
        break;
      case 'sunbathe':
        p.lie = 1;
        p.eyes = 0.05;
        p.happy = 1;
        p.lookYaw = 0;
        break;
      case 'greet':
        p.lookPitch = -0.1;
        p.tilt = Math.sin(this.stateTime * 8) * 0.12;
        p.happy = this.stateTime > 0.6 ? 0.6 : 0;
        this.rig.pivot.position.y = R + Math.max(0, Math.sin(this.stateTime * 9)) * 0.1 * (this.stateTime < 0.8 ? 1 : 0);
        break;
      case 'reunion': {
        p.happy = 1;
        p.wave = this.stateTime > 2.2 ? 1 : 0;
        p.tailWag = 1;
        p.lookYaw = 0;
        const hop = this.stateTime < 2.2 ? Math.abs(Math.sin(this.stateTime * 5.7)) * 0.22 : 0;
        this.rig.pivot.position.y = R + hop;
        break;
      }
      default:
        this.rig.pivot.position.y = damp(this.rig.pivot.position.y, R, 12, dt);
    }
    if (this.state !== 'greet' && this.state !== 'reunion') this.rig.pivot.position.y = damp(this.rig.pivot.position.y, R, 12, dt);
    this.poseRecover(p);
  }
}
