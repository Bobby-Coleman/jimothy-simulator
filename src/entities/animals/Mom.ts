import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { G } from '../../core/Physics';
import { destroyProp } from '../Props';
import { RaccoonAnimal, wrapAngle, WORLD_ONLY } from './Animal';
import { RIGS, type RigPose } from './RaccoonRig';

/**
 * Mom: a normal-shaped raccoon who lives in the den under the thrift store. She naps through the day,
 * greets Jimothy warmly when he comes home at night, gratefully eats any snack he drops for her and, after
 * the third one, grooms his face with her little paws.
 */

type MomState =
  | 'idle' // awake at the den
  | 'sleep' // daytime nap
  | 'wander' // pottering around the den
  | 'greet' // trotting over to say hi
  | 'fetch' // going to a dropped snack
  | 'eat'
  | 'groom' // grooming Jimothy (cutscene)
  | 'welcome' // a kit came home
  | 'hug'
  | 'recover';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Mom extends RaccoonAnimal {
  readonly home = new THREE.Vector3();
  homeYaw: number;
  private food: Entity | null = null;
  private foodVisual: THREE.Object3D | null = null;
  private onEaten: (() => void) | null = null;
  private groomUntil = 0;
  private groomDone: (() => void) | null = null;
  private wanderTarget = new THREE.Vector3();
  private nextWander = 8 + Math.random() * 10;
  private selfGroom = 0;
  private hugCd = 0;
  private washCd = 0;
  private purrT = 0;
  private lookT = 0;
  private lookYaw = 0;
  private welcomeKit: THREE.Vector3 | null = null;
  /** When set, Mom is busy with a scripted moment and ignores the idle schedule. */
  busy = false;

  constructor(game: Game, pos: THREE.Vector3, yaw = 0) {
    super(
      game,
      {
        name: 'Mom',
        species: 'mom',
        position: pos,
        yaw,
        box: [0.22, 0.26, 0.62],
        colliderY: 0.36,
        mass: 16,
        tags: ['family', 'mom'],
        // Never blocks Jimothy (she lives in a doorway!) and never bulldozes snacks / props around.
        // Grab / bonk / wash still find her: those are queries, not contacts.
        filter: G.NPC | G.RAGDOLL,
        emoteY: 1.05,
        emoteSize: 0.42,
      },
      RIGS.mom,
    );
    this.home.copy(this.pos);
    this.homeYaw = yaw;
    this.entity.data.size = new THREE.Vector3(0.5, 0.8, 1.3);
    this.scootSpot.copy(this.findScootSpot());
    const env = game.get<any>('environment');
    this.setState(env?.isNight ? 'idle' : 'sleep');
  }

  /** Where she shuffles to when Jimothy wants in (the side of the den with more room). */
  readonly scootSpot = new THREE.Vector3();
  /** Currently scooted aside for Jimothy. */
  private scooted = false;
  private scootT = 0;

  private findScootSpot(): THREE.Vector3 {
    const side = new THREE.Vector3(Math.cos(this.homeYaw), 0, -Math.sin(this.homeYaw));
    const back = new THREE.Vector3(-Math.sin(this.homeYaw), 0, -Math.cos(this.homeYaw));
    const from = this.home.clone().setY(this.home.y + 0.3);
    const room = (dir: THREE.Vector3) => this.game.physics.raycast(from, dir, 3, WORLD_ONLY)?.distance ?? 3;
    const left = room(side);
    const right = room(side.clone().negate());
    const best = left >= right ? side : side.clone().negate();
    const free = Math.max(left, right);
    if (free > 1.2) return this.home.clone().addScaledVector(best, Math.min(1.15, free - 0.6));
    // no room sideways: tuck further in
    return this.home.clone().addScaledVector(back, Math.min(0.9, Math.max(0, room(back) - 0.9)));
  }

  /** Her resting spot right now (home, or scooted aside while Jimothy is in the doorway). */
  private get restSpot() {
    return this.scooted ? this.scootSpot : this.home;
  }

  get awake() {
    return this.state !== 'sleep';
  }
  override get keepAwake() {
    return this.airborne || this.isBusy || this.state === 'greet' || this.state === 'welcome';
  }

  get isBusy() {
    return this.busy || this.state === 'fetch' || this.state === 'eat' || this.state === 'groom';
  }

  // ------------------------------------------------------------------------------------------- quest API
  /** Go get a dropped snack and eat it. */
  takeFood(food: Entity, onEaten: () => void) {
    if (this.food) return false;
    this.food = food;
    this.onEaten = onEaten;
    food.data.momClaimed = true;
    if (this.state === 'sleep') {
      this.say('exclaim', 1);
      this.game.sfx('trill', this.pos, 0.6, 1.1);
    }
    this.setState('fetch');
    return true;
  }

  /** Walk up to Jimothy and groom his face for `secs`. */
  groomJimothy(secs: number, onDone: () => void) {
    this.busy = true;
    this.groomUntil = secs;
    this.groomDone = onDone;
    this.setState('groom');
  }

  /** Warm hello when he comes home. */
  greet() {
    if (this.isBusy) return;
    if (this.state === 'sleep') this.say('heart', 1.8);
    this.setState('greet');
  }

  /** A kit arrived: look at it, nuzzle, hearts. */
  welcome(at: THREE.Vector3) {
    if (this.isBusy) {
      this.hearts(3);
      return;
    }
    this.welcomeKit = at.clone();
    this.setState('welcome');
  }

  /** Where kits snuggle up to Mom (i = 0..4): along her flanks, the littlest one by her nose. */
  kitSpot(i: number, out = new THREE.Vector3()) {
    // (x = her left, z = forward) in Mom's frame
    const spots: [number, number][] = [
      [0.48, 0.22],
      [-0.48, 0.22],
      [0.52, -0.36],
      [-0.52, -0.36],
      [0.05, 1.02],
    ];
    const [x, z] = spots[i % spots.length];
    const c = Math.cos(this.homeYaw);
    const s = Math.sin(this.homeYaw);
    out.set(this.home.x + x * c + z * s, this.home.y, this.home.z - x * s + z * c);
    return out;
  }

  /** Just outside the den entrance (in front of Mom's resting spot) — kits come in this way. */
  entrance(out = new THREE.Vector3()) {
    return out.set(this.home.x + Math.sin(this.homeYaw) * 2.0, this.home.y, this.home.z + Math.cos(this.homeYaw) * 2.0);
  }

  // ------------------------------------------------------------------------------------------- behaviour
  protected think(dt: number) {
    const game = this.game;
    const player = this.player;
    const env = game.get<any>('environment');
    const night = !!env?.isNight;
    this.hugCd -= dt;
    this.washCd -= dt;
    const dPlayer = this.distToPlayer();

    // Jimothy in the doorway? Shuffle aside so he can get in; drift back once he's gone for a bit.
    const dHome = player ? Math.hypot(player.position.x - this.home.x, player.position.z - this.home.z) : Infinity;
    if (!this.scooted && dHome < 1.9 && (this.state === 'idle' || this.state === 'sleep')) {
      this.scooted = true;
      this.scootT = 0;
      if (this.state === 'sleep') this.say('dots', 1.2);
    } else if (this.scooted) {
      this.scootT = dHome > 3.2 ? this.scootT + dt : 0;
      if (this.scootT > 4) this.scooted = false;
    }

    switch (this.state) {
      case 'sleep': {
        // sleepwalk to the resting spot (scooting over for Jimothy), then lie down
        const rs = this.restSpot;
        if (Math.hypot(this.pos.x - rs.x, this.pos.z - rs.z) > 0.12) this.walkToward(rs, 1.1, dt, 5, 0.1);
        else this.snapToGround(dt);
        if (Math.floor(game.time / 6) % 3 === 0 && this.emote.showing === '' && dPlayer < 30) this.say('zzz', 2.5);
        if (night) {
          this.setState('idle');
          this.say('exclaim', 0.8);
        } else if (dPlayer < 2.2 && this.stateTime > 3 && this.hugCd < 0) {
          // sleepy hello: one eye open, a little heart, back to sleep
          this.hugCd = 12;
          this.say('heart', 1.5);
          game.sfx('purr', this.pos, 0.35, 1.1);
        }
        break;
      }
      case 'idle': {
        const rs = this.restSpot;
        this.walkToward(rs, 1.4, dt, 5, 0.25);
        if (Math.hypot(this.pos.x - rs.x, this.pos.z - rs.z) < 0.4) {
          if (this.scooted && player) this.turnToward(this.yawTo(player.position), dt, 3);
          else this.turnToward(this.homeYaw, dt, 2);
        }
        if (!night && dPlayer > 6 && this.stateTime > 6) this.setState('sleep');
        this.nextWander -= dt;
        if (this.nextWander <= 0 && dPlayer > 4) {
          this.nextWander = 10 + Math.random() * 14;
          const a = Math.random() * Math.PI * 2;
          const r = 1.2 + Math.random() * 1.8;
          this.wanderTarget.set(this.home.x + Math.cos(a) * r, this.home.y, this.home.z + Math.sin(a) * r);
          this.setState('wander');
        }
        // occasional self-grooming
        if (this.selfGroom <= 0 && Math.random() < dt * 0.06) this.selfGroom = 2.5;
        break;
      }
      case 'wander': {
        const d = this.walkToward(this.wanderTarget, 1.3, dt, 5, 0.2);
        if (d < 0.25 || this.stateTime > 8) this.setState('idle');
        break;
      }
      case 'greet': {
        if (!player) {
          this.setState('idle');
          break;
        }
        const target = _v.copy(player.position);
        const d = this.walkToward(target, 3.2, dt, 8, 1.15);
        if (d <= 1.2 || this.stateTime > 5) {
          this.turnToward(this.yawTo(player.position), dt, 8);
          if (!this.purrT) {
            this.purrT = 1;
            game.sfx('trill', this.pos, 0.8, 1.05);
            this.say('heart', 2);
            this.hearts(6);
          }
        }
        if (this.stateTime > 4.2) {
          this.purrT = 0;
          this.setState('idle');
        }
        break;
      }
      case 'fetch': {
        const f = this.food;
        if (!f || !f.alive || f.data.heldByPlayer) {
          this.food = null;
          this.setState('idle');
          break;
        }
        const t = f.body ? f.body.translation() : f.object?.position;
        if (!t) {
          this.food = null;
          this.setState('idle');
          break;
        }
        const target = _v.set(t.x, 0, t.z);
        // stop with the snack at her mouth (her nose is ~0.8 m ahead of her middle)
        const d = this.walkToward(target, 2.6, dt, 8, 0.72);
        if (d < 0.8 || this.stateTime > 7) this.pickUp(f);
        break;
      }
      case 'eat': {
        this.snapToGround(dt);
        if (this.stateTime > 0.3 && Math.floor(this.stateTime * 2.2) !== Math.floor((this.stateTime - dt) * 2.2)) {
          game.sfx('munch', this.pos, 0.7, 1 + Math.random() * 0.1);
        }
        if (this.stateTime > 2.6) {
          this.finishEating();
        }
        break;
      }
      case 'groom': {
        if (!player) {
          this.endGroom();
          break;
        }
        // stand in front of Jimothy, facing him
        const f = player.forwardVec ? player.forwardVec(_v2) : _v2.set(0, 0, 1);
        const spot = _v.copy(player.position).addScaledVector(f, 1.05);
        spot.y = this.pos.y;
        const d = Math.hypot(spot.x - this.pos.x, spot.z - this.pos.z);
        if (d > 0.1) this.walkToward(spot, 2.4, dt, 9, 0.05);
        else this.snapToGround(dt);
        if (d < 0.5) this.turnToward(this.yawTo(player.position), dt, 10);
        // the grooming clock only runs once she's in front of him (or if she can't get there)
        if (d < 0.6 || this.stateTime > 6) this.groomUntil -= dt;
        this.purrT -= dt;
        if (this.purrT <= 0 && d < 0.6) {
          this.purrT = 1.3;
          game.sfx('purr', this.pos, 0.8, 1);
          if (Math.random() < 0.5) game.sfx('scrub', this.pos, 0.5, 1.3);
          this.hearts(3, 0.1);
        }
        if (this.groomUntil <= 0) this.endGroom();
        break;
      }
      case 'welcome': {
        this.snapToGround(dt);
        if (this.welcomeKit) this.turnToward(this.yawTo(this.welcomeKit), dt, 6);
        if (this.stateTime < dt * 1.5) {
          game.sfx('trill', this.pos, 0.7, 1.15);
          this.say('heart', 2);
        }
        if (this.stateTime > 2.2) {
          this.welcomeKit = null;
          this.setState('idle');
        }
        break;
      }
      case 'hug': {
        this.snapToGround(dt);
        if (player) this.turnToward(this.yawTo(player.position), dt, 8);
        if (this.stateTime > 1.6) this.setState('idle');
        break;
      }
      case 'recover': {
        this.snapToGround(dt);
        if (this.stateTime > 1.4) {
          if (this.stateTime < 1.4 + dt * 1.5) {
            this.say('grumpy', 1);
            game.sfx('hiss', this.pos, 0.35, 1.2);
          }
          if (this.stateTime > 2.6) {
            this.say('heart', 1.4);
            this.setState(this.food ? 'fetch' : 'idle');
          }
        }
        break;
      }
    }
    // look at Jimothy when he's around
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 1.5 + Math.random() * 2.5;
      this.lookYaw = (Math.random() - 0.5) * 1.4;
    }
    if (player && dPlayer < 9 && this.state !== 'sleep') this.lookYaw = wrapAngle(this.lookAngleTo(player.position));
    this.selfGroom = Math.max(0, this.selfGroom - dt);
  }

  private pickUp(f: Entity) {
    const game = this.game;
    // Show the snack in her paws, remove the real prop
    const src = f.object;
    if (src) {
      const vis = src.clone(true);
      vis.traverse((o) => ((o as THREE.Mesh).castShadow = false));
      const box = new THREE.Box3().setFromObject(src);
      const size = box.getSize(_v).length() || 0.3;
      const s = THREE.MathUtils.clamp(0.28 / size, 0.2, 1.2);
      vis.scale.multiplyScalar(s);
      vis.position.set(0, 0, 0);
      vis.quaternion.identity();
      const holder = new THREE.Group();
      holder.add(vis);
      this.foodVisual = holder;
      this.game.scene.add(holder);
    }
    const name = f.name;
    if (game.get<any>('player')?.held?.entity === f) game.get<any>('player').release(false);
    destroyProp(game, f);
    this.food = null;
    this.entity.data.lastSnack = name;
    this.setState('eat');
  }

  private finishEating() {
    const game = this.game;
    this.foodVisual?.removeFromParent();
    this.foodVisual = null;
    game.sfx('happy', this.pos, 0.9, 1.0);
    game.sfx('purr', this.pos, 0.5, 1.1);
    this.say('heart', 2.2);
    this.hearts(8);
    const cb = this.onEaten;
    this.onEaten = null;
    this.setState('idle');
    cb?.();
  }

  private endGroom() {
    this.busy = false;
    const cb = this.groomDone;
    this.groomDone = null;
    this.setState('idle');
    cb?.();
  }

  // ------------------------------------------------------------------------------------------- reactions
  protected handleGrab() {
    if (this.airborne || this.isBusy) return false;
    if (this.hugCd <= 0) {
      this.hugCd = 1.5;
      if (this.state === 'sleep') this.setState('idle');
      this.setState('hug');
      this.say('heart', 1.6);
      this.hearts(6);
      this.game.sfx('trill', this.pos, 0.7, 1.1);
      this.game.score(25, 'Hugged Mom', this.pos.clone());
      this.game.events.emit('momHug', {});
    }
    return false;
  }

  protected handleBonk(impulse: THREE.Vector3) {
    if (this.airborne || this.isBusy) return;
    if (!this.isPlayerBonk()) {
      this.dodge(impulse);
      return;
    }
    const h = _v.set(impulse.x, 0, impulse.z);
    if (h.lengthSq() < 1e-4) h.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    h.normalize().multiplyScalar(1.6);
    this.launch(new THREE.Vector3(h.x, 3.4, h.z), 7);
    this.game.sfx('squeak', this.pos, 0.5, 0.95);
    this.say('exclaim', 0.8);
  }

  protected handleWash() {
    if (this.washCd > 0) return;
    this.washCd = 2;
    const first = !this.entity.data.washed;
    this.entity.data.washed = true;
    this.say(first ? 'Oh! ...thank you, sweetie.' : 'heart', 2);
    this.hearts(6);
    this.game.events.emit('sparkle', { entity: this.entity, position: this.pos.clone() });
    this.game.sfx('trill', this.pos, 0.7, 1.2);
    this.game.score(first ? 80 : 10, first ? 'Washed Mom (She Washed You Back)' : 'Mom Is Very Clean', this.pos.clone());
  }

  protected onLanded() {
    this.recover = 1;
    this.say('dizzy', 1.2);
    this.setState('recover');
  }

  // ------------------------------------------------------------------------------------------- animation
  protected animatePose(dt: number, p: RigPose) {
    const t = this.game.time;
    this.recover = Math.max(0, this.recover - dt * 0.9);
    const moving = this.speed > 0.2;
    p.gait = moving ? 1 : 0;
    p.lookYaw = this.lookYaw;
    p.tailWag = 0.25;
    switch (this.state) {
      case 'sleep':
        if (moving) {
          // sleepy shuffle over to make room
          p.eyes = 0.35;
          p.tailWag = 0.05;
          p.earsBack = 0.3;
          break;
        }
        p.lie = 1;
        p.eyes = this.hugCd > 10 ? 0.5 : 0;
        p.tailWag = 0.05;
        p.lookYaw = 0;
        break;
      case 'idle':
        if (!moving) {
          p.sit = 1;
          if (this.selfGroom > 0) {
            p.groom = 1;
            p.lookPitch = 0.35;
            p.eyes = 0.3;
          }
        }
        break;
      case 'greet':
        p.tailWag = 0.9;
        p.happy = moving ? 0.3 : 1;
        if (!moving) {
          p.stand = 0.35 + 0.1 * Math.sin(t * 6);
          p.tilt = 0.25;
          p.lookPitch = 0.25;
        }
        break;
      case 'eat':
        p.eat = 1;
        p.happy = 0.8;
        p.tailWag = 0.6;
        p.lookYaw = 0;
        break;
      case 'groom': {
        const near = this.distToPlayer() < 1.4;
        if (near && !moving) {
          p.groom = 1;
          p.happy = 0.9;
          p.lookPitch = 0.3;
          p.lookYaw = 0;
          p.tilt = Math.sin(t * 2) * 0.15;
          p.tailWag = 0.8;
        }
        break;
      }
      case 'welcome':
        p.sit = 1;
        p.happy = 1;
        p.lookPitch = 0.45;
        p.tailWag = 0.9;
        p.lookYaw = 0;
        break;
      case 'hug':
        p.stand = 0.5;
        p.happy = 1;
        p.tailWag = 1;
        p.lookYaw = 0;
        p.lookPitch = 0.2;
        break;
      case 'recover':
        p.sit = 1;
        break;
    }
    this.poseRecover(p);
    this.placeFood();
  }

  /** Keep the snack visual in her front paws while eating. */
  private placeFood() {
    const v = this.foodVisual;
    if (!v) return;
    const fl = this.rig.parts.LegFL;
    const fr = this.rig.parts.LegFR;
    const head = this.rig.parts.Head;
    if (fl && fr) {
      this.rig.root.updateMatrixWorld(true);
      fl.getWorldPosition(_v);
      fr.getWorldPosition(_v2);
      _v.add(_v2).multiplyScalar(0.5);
      if (head) {
        head.getWorldPosition(_v2);
        _v.lerp(_v2, 0.55);
      }
      v.position.copy(_v);
      v.position.y -= 0.02;
      v.rotation.set(0.4, this.yaw, 0);
    } else {
      v.position.copy(this.pos).add(_v.set(0, 0.6, 0));
    }
  }

  override dispose() {
    this.foodVisual?.removeFromParent();
    super.dispose();
  }
}
