import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import type { Jimothy } from '../../player/Jimothy';
import type { CameraRig } from '../../player/CameraRig';
import { makeSlopDepthMaterial, makeSlopMaterial, makeSlopUniforms, type SlopUniforms } from './SlopMaterial';
import { SLOP_LEGS, SP, type SlopModelData } from './SlopGeometry';
import { FAN_CHEERS, SLOP_BONKED, SLOP_GRABBED, SLOP_IDLE, SLOP_IMITATE, SLOP_SPAWN, SLOP_THROWN, SLOP_WASHED } from './lines';
import { clamp, findClearSpot, findNpcs, pick, rand, say, sayAt, terrainY, waterOf, worldOf, type Timeline } from './util';

export type SlopRole = 'campus' | 'roamer' | 'tiny';
export type ImitateKind = 'jump' | 'roll' | 'chitter' | 'wash' | 'bonk' | 'climb' | 'flop';
export type DissolveReason = 'washed' | 'water' | 'unplug' | 'timeout' | 'cap';

export interface SpawnOpts {
  role: SlopRole;
  scale?: number;
  /** The one "correct-looking" raccoon in a SlopBot batch (no extra limbs, no glitch). It's also AI. */
  correct?: boolean;
  home?: THREE.Vector3;
  /** Pop-in effect + spawn line. */
  announce?: boolean;
}

const BASE_R = 0.36;
const BASE_MASS = 8;
const HOVER = 0.12;
const WALK = 1.7;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const GROUND_FILTER = groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE);
const WALL_FILTER = groups(G.ALL, G.WORLD | G.VEHICLE);

/** Fallback town spots for roaming Slopothys (used if level builders provide no NPC areas). */
const TOWN_SPOTS: [number, number][] = [
  [0, 10],
  [-18, -25],
  [25, 28],
  [-110, 35],
  [-95, -5],
  [105, 5],
  [120, -30],
  [5, -110],
  [30, -95],
  [110, -115],
  [-15, 115],
  [-120, 120],
  [95, 110],
];

let ghostSerial = 0;

export class Slopothy {
  readonly entity: Entity;
  readonly body: RAPIER.RigidBody;
  readonly root = new THREE.Group();
  readonly pivot = new THREE.Group();
  readonly mesh: THREE.Mesh;
  readonly u: SlopUniforms;
  private mat: THREE.MeshStandardMaterial;
  private depthMat: THREE.MeshDepthMaterial;
  private ghostMat: THREE.MeshStandardMaterial | null = null;
  private ghosts: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: number }[] = [];
  private ghostT = -1;
  private phaseFrames = 0;
  private phaseGhost = false;

  role: SlopRole;
  scale: number;
  readonly correct: boolean;
  readonly r: number;
  home: THREE.Vector3;
  homeR = 16;
  readonly bornAt: number;
  readonly pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private desired = new THREE.Vector3();
  facing = Math.random() * Math.PI * 2;
  private grounded = true;
  private lod = 0;
  private aiTimer = 0;
  private stuckT = 0;
  private wallT = 0;
  private idleUntil = 0;
  state: 'wander' | 'idle' | 'follow' | 'stunned' | 'held' | 'imitate' = 'wander';
  private stunUntil = 0;
  followIndex = 0;
  dying = false;
  dieT = 0;
  dead = false;
  /** Why it is dissolving (washed / water / unplug / timeout / cap). */
  reason: DissolveReason | null = null;
  // animation
  private legFreq: number[] = [];
  private legPhase: number[] = [];
  private animPhase = Math.random() * 100;
  private popT = 1;
  private tumble = 0;
  private tumbleV = 0;
  // glitch timers
  private nextGlitch = 0;
  private glitchT = 0;
  private nextBlocky = 0;
  private blockyT = 0;
  private nextPhase = 0;
  private nextHeadSnap = 0;
  private headSnapT = 0;
  // behaviour
  nextTalk = 0;
  cheerCooldown = 0;
  imitateCooldown = 0;
  pendingImitate: { kind: ImitateKind; at: number } | null = null;
  private imitate: { kind: ImitateKind; t: number; dur: number; dir: THREE.Vector3 } | null = null;
  lastPlayerTouch = -100;
  relocateAt = 0;

  constructor(
    private game: Game,
    private mgr: SlopothyManager,
    model: SlopModelData,
    ground: THREE.Vector3,
    opts: SpawnOpts,
  ) {
    this.role = opts.role;
    this.scale = opts.scale ?? (opts.role === 'tiny' ? 0.42 : rand(0.92, 1.1));
    this.correct = !!opts.correct;
    this.r = BASE_R * this.scale;
    this.home = (opts.home ?? ground).clone();
    this.homeR = opts.role === 'campus' ? 22 : 16;
    this.bornAt = game.time;
    const now = game.time;
    this.nextGlitch = now + rand(1, 4);
    this.nextBlocky = now + rand(3, 9);
    this.nextPhase = now + rand(3, 10);
    this.nextHeadSnap = now + rand(6, 18);
    this.nextTalk = now + rand(4, 14);
    this.relocateAt = now + rand(25, 45);
    for (let i = 0; i < 6; i++) {
      // legs out of sync: every leg has its own tempo (the extra legs are especially confused)
      this.legFreq.push(rand(7, 12) * (i >= 4 ? rand(0.6, 1.6) : 1));
      this.legPhase.push(Math.random() * Math.PI * 2);
    }

    // ---- visual
    this.u = makeSlopUniforms(model.rig);
    if (this.correct) {
      this.u.uIri.value = 0;
      this.u.uExtra.value = 0;
    }
    this.mat = makeSlopMaterial(this.u);
    this.depthMat = makeSlopDepthMaterial(this.u);
    this.mesh = new THREE.Mesh(model.geometry, this.mat);
    this.mesh.customDepthMaterial = this.depthMat;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // model origin sits above the ball centre so the feet hover a little above the ground
    this.mesh.position.y = -model.footY - BASE_R + HOVER;
    this.mesh.frustumCulled = true;
    this.pivot.add(this.mesh);
    this.root.add(this.pivot);
    this.root.name = this.role === 'tiny' ? 'TinySlopothy' : 'Slopothy';
    this.root.scale.setScalar(this.scale);
    this.root.userData.slopOwned = true;
    game.scene.add(this.root);

    // ---- physics
    const p = ground.clone().add(new THREE.Vector3(0, this.r + 0.06, 0));
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .lockRotations()
      .setLinearDamping(0.35)
      .setCcdEnabled(true);
    const mass = BASE_MASS * this.scale * this.scale * this.scale;
    const cd = RAPIER.ColliderDesc.ball(this.r)
      .setMass(mass)
      .setFriction(0.5)
      .setRestitution(0.25)
      .setCollisionGroups(groups(G.ANIMAL, G.ALL & ~G.TRIGGER & ~G.WATER & ~G.DEBRIS));
    this.body = game.physics.createBody(desc, [cd]);
    this.pos.copy(p);
    this.root.position.copy(p);
    this.target.copy(p);

    const size = new THREE.Vector3(0.78, 0.84, 0.86).multiplyScalar(this.scale);
    const self = this;
    this.entity = game.entities.create({
      kind: 'slop',
      name: this.correct ? 'Suspiciously Normal Jimothy' : this.role === 'tiny' ? 'Tiny Slopothy' : 'Slopothy',
      body: this.body,
      object: this.root,
      mass,
      tags: new Set(['grabbable', 'washable', 'slop', 'slopothy']),
      data: { size, floatRadius: this.r, buoyancy: 1.2, slopothy: true },
      onWash(g) {
        self.onWash(g);
      },
      onBonk(g, impulse, point) {
        return self.onBonk(g, impulse, point);
      },
      onGrab(g) {
        self.lastPlayerTouch = g.time;
        self.glitch(0.3);
        if (Math.random() < 0.6) mgr.talk(self, pick(SLOP_GRABBED), true);
      },
      onRelease(g, thrown) {
        self.lastPlayerTouch = g.time;
        self.stun(thrown ? 1.6 : 0.6);
        if (thrown) {
          self.tumbleV = rand(-14, 14);
          if (Math.random() < 0.5) mgr.talk(self, pick(SLOP_THROWN), true);
        }
      },
    });

    if (opts.announce) {
      this.popT = 0;
      this.u.uFlash.value = 1.2;
      this.glitch(0.5);
    }
  }

  get alive() {
    return !this.dying && !this.dead;
  }

  // ---------------------------------------------------------------- reactions
  glitch(secs = 0.25) {
    this.glitchT = Math.max(this.glitchT, secs);
  }

  stun(secs: number) {
    this.state = 'stunned';
    this.stunUntil = this.game.time + secs;
    this.imitate = null;
    this.body.setGravityScale(1, true);
  }

  private onWash(game: Game) {
    if (!this.alive) return;
    this.mgr.talkAt(this, pick(SLOP_WASHED));
    this.dissolve('washed');
  }

  private onBonk(game: Game, impulse: THREE.Vector3, _point: THREE.Vector3) {
    if (!this.alive) return true;
    if (!this.entity.data.heldByPlayer) {
      const k = 0.8;
      this.body.applyImpulse({ x: impulse.x * k, y: Math.max(impulse.y * k, this.body.mass() * 3), z: impulse.z * k }, true);
    }
    // cars / explosions call this too: only Jimothy's own bonks score
    const p = this.game.get<Jimothy>('player');
    const byPlayer = !!p && p.position.distanceTo(this.pos) < 2.6 && game.time - this.mgr.lastPlayerBonk < 0.5;
    if (byPlayer) this.lastPlayerTouch = game.time;
    this.scatter();
    this.stun(1.3);
    this.tumbleV = rand(-16, 16);
    game.sfx('slop_glitch', this.pos, 0.7, rand(0.9, 1.2));
    if (Math.random() < 0.45) this.mgr.talk(this, pick(SLOP_BONKED), true);
    if (byPlayer) game.score(this.role === 'tiny' ? 10 : 25, 'Bonked The Slop', this.pos.clone());
    game.events.emit('slopBonked', { entity: this.entity, position: this.pos.clone(), byPlayer });
    return true;
  }

  /** Bonked: splits into flickering duplicates for a second (it's fine). */
  scatter() {
    const game = this.game;
    if (!this.ghostMat) this.ghostMat = makeSlopMaterial(this.u, { ghost: true });
    while (this.ghosts.length < 3) {
      const m = new THREE.Mesh(this.mesh.geometry, this.ghostMat);
      m.name = 'SlopGhost' + ghostSerial++;
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.userData.slopOwned = true;
      m.visible = false;
      game.scene.add(m);
      this.ghosts.push({ mesh: m, vel: new THREE.Vector3(), spin: 0 });
    }
    for (const gh of this.ghosts) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(2.5, 5);
      gh.vel.set(Math.cos(a) * sp, rand(1.5, 3.5), Math.sin(a) * sp);
      gh.spin = rand(-10, 10);
      gh.mesh.position.copy(this.mesh.getWorldPosition(_v));
      gh.mesh.quaternion.copy(this.mesh.getWorldQuaternion(new THREE.Quaternion()));
      gh.mesh.scale.setScalar(this.scale * rand(0.85, 1.15));
    }
    this.ghostT = 0;
    this.glitch(0.6);
    this.u.uFlash.value = Math.max(this.u.uFlash.value, 0.8);
  }

  startImitation(kind: ImitateKind) {
    if (!this.alive || this.entity.data.heldByPlayer) return;
    const player = this.game.get<Jimothy>('player');
    const dir = new THREE.Vector3();
    if (player) dir.copy(player.position).sub(this.pos).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    dir.normalize();
    const dur = { jump: 1.5, roll: 2.2, chitter: 0.8, wash: 2.0, bonk: 0.9, climb: 1.6, flop: 1.7 }[kind];
    this.imitate = { kind, t: 0, dur, dir };
    this.state = 'imitate';
    this.imitateCooldown = this.game.time + rand(4, 7);
    const b = this.body;
    const v = b.linvel();
    switch (kind) {
      case 'jump':
        if (this.grounded) b.setLinvel({ x: v.x * 0.3, y: rand(6.5, 8) * Math.sqrt(this.scale), z: v.z * 0.3 }, true);
        b.setGravityScale(0.45, true);
        this.game.sfx('boing', this.pos, 0.5, rand(1.2, 1.6));
        break;
      case 'roll': {
        const a = Math.random() * Math.PI * 2;
        dir.set(Math.cos(a), 0, Math.sin(a));
        this.game.sfx('boing', this.pos, 0.4, 0.7);
        break;
      }
      case 'chitter':
        this.game.sfx('slop_voice', this.pos, 0.6, rand(1.1, 1.4));
        break;
      case 'bonk':
        this.game.sfx('whoosh', this.pos, 0.5, 1.3);
        break;
      case 'climb':
        b.setGravityScale(0, true);
        break;
      default:
        break;
    }
    this.glitch(0.2);
    if (Math.random() < 0.55) this.mgr.talk(this, pick(SLOP_IMITATE[kind]));
  }

  /** Washed / unplugged / timed out: pixelate away. */
  dissolve(reason: DissolveReason) {
    if (!this.alive) return;
    const game = this.game;
    this.dying = true;
    this.dieT = 0;
    this.reason = reason;
    const player = game.get<Jimothy>('player');
    if (player?.held?.entity === this.entity) player.release(false);
    const pos = this.root.position.clone();
    game.entities.remove(this.entity);
    game.physics.removeBody(this.body);
    for (const g of this.ghosts) g.mesh.visible = false;
    this.mesh.visible = true;
    game.events.emit('slopDissolve', { position: pos, entity: this.entity, reason, scale: this.scale });
    game.sfx('dissolve', pos, this.role === 'tiny' ? 0.5 : 0.85, this.role === 'tiny' ? 1.4 : 1);
    this.mgr.onDissolved(this, reason, pos);
  }

  // ---------------------------------------------------------------- per-frame AI (before physics)
  update(dt: number, player: Jimothy | undefined) {
    if (this.dead) return;
    if (this.dying) return;
    const game = this.game;
    const now = game.time;
    const b = this.body;
    const t = b.translation();
    this.pos.set(t.x, t.y, t.z);
    const pp = player?.position;
    const dP = pp ? this.pos.distanceTo(pp) : 999;
    this.lod = dP < 70 ? 0 : dP < 140 ? 1 : 2;
    const held = !!this.entity.data.heldByPlayer;

    // fell out of the world
    if (t.y < -30) {
      this.dissolve('timeout');
      return;
    }

    // water = washed away (credit Jimothy if he threw / bonked it recently)
    this.aiTimer -= dt;
    if (!held && (this.lod === 0 || this.aiTimer <= 0)) {
      const vol = waterOf(game)?.volumeAt(this.pos);
      if (vol && this.pos.y < vol.surfaceY + this.r * 0.2) {
        const byPlayer = now - this.lastPlayerTouch < 8 || now - (this.entity.data.thrownAt ?? -100) < 8;
        this.mgr.talkAt(this, 'Water?! That was not in my training da—');
        this.dissolve(byPlayer ? 'washed' : 'water');
        return;
      }
    }

    if (held) {
      this.state = 'held';
      this.lastPlayerTouch = now;
      return;
    }
    if (this.state === 'held') this.stun(0.8);

    if (this.lod === 2) {
      // far away: sleep (only the occasional water check above)
      if (this.aiTimer <= 0) this.aiTimer = 1;
      return;
    }
    if (this.lod === 1) {
      if (this.aiTimer > 0) return;
      this.aiTimer = 0.5;
    } else if (this.aiTimer <= 0) this.aiTimer = 0.25;

    // grounded probe
    const hit = game.physics.raycast(this.pos, _down, this.r + 0.18, GROUND_FILTER, b);
    this.grounded = !!hit;

    if (this.pendingImitate && now >= this.pendingImitate.at) {
      const k = this.pendingImitate.kind;
      this.pendingImitate = null;
      if (this.state !== 'stunned') this.startImitation(k);
    }

    const v = b.linvel();
    let speed = 0;
    this.desired.set(0, 0, 0);

    switch (this.state) {
      case 'stunned':
        if (now > this.stunUntil && this.grounded && Math.hypot(v.x, v.z) < 2) {
          this.state = this.role === 'tiny' ? 'follow' : 'wander';
          this.pickTarget();
        }
        return;
      case 'imitate':
        this.updateImitation(dt);
        return;
      case 'follow': {
        if (!pp || dP > 35) {
          this.state = 'wander';
          this.home.copy(this.pos);
          this.pickTarget();
          break;
        }
        // following Jimothy counts as "his" slop: lead them into water to wash them away
        this.lastPlayerTouch = now;
        const f = player!.forwardVec(_w);
        const slot = _v.copy(pp).addScaledVector(f, -(1.3 + this.followIndex * 0.75));
        slot.x += Math.sin(now * 1.3 + this.followIndex) * 0.4;
        this.desired.subVectors(slot, this.pos).setY(0);
        const d = this.desired.length();
        if (d > 0.4) {
          speed = Math.min(7, 1 + d * 1.2);
          this.desired.normalize();
        } else this.desired.set(0, 0, 0);
        break;
      }
      case 'idle':
        if (now > this.idleUntil) {
          this.state = 'wander';
          this.pickTarget();
        }
        break;
      case 'wander':
      default: {
        this.desired.subVectors(this.target, this.pos).setY(0);
        const d = this.desired.length();
        if (d < 0.8) {
          if (Math.random() < 0.45) {
            this.state = 'idle';
            this.idleUntil = now + rand(1.5, 5);
          } else this.pickTarget();
          this.desired.set(0, 0, 0);
        } else {
          this.desired.divideScalar(d);
          speed = WALK * (0.8 + 0.4 * Math.sin(now * 0.7 + this.animPhase));
          // Curious about the player: sometimes shuffle toward him ("are you my prompt?")
          if (pp && dP < 12 && dP > 3 && Math.sin(now * 0.21 + this.animPhase) > 0.6) {
            this.desired.subVectors(pp, this.pos).setY(0).normalize();
          }
        }
        break;
      }
    }

    // wall ahead? steer away / pick a new target
    if (speed > 0.1 && this.lod === 0) {
      this.wallT -= dt;
      if (this.wallT <= 0) {
        this.wallT = 0.2;
        const from = _v.copy(this.pos).add(_w.set(0, 0.05, 0));
        const wall = game.physics.raycast(from, this.desired, this.r + 0.55, WALL_FILTER, b);
        if (wall && Math.abs(wall.normal.y) < 0.5) {
          if (this.state === 'wander') this.pickTarget(wall.normal);
          else this.desired.addScaledVector(wall.normal.setY(0).normalize(), 1.2).normalize();
        }
      }
      const hs = Math.hypot(v.x, v.z);
      if (hs < 0.25) {
        this.stuckT += dt;
        if (this.stuckT > 1.4) {
          this.stuckT = 0;
          if (this.state === 'wander') this.pickTarget();
          if (this.grounded) b.setLinvel({ x: v.x, y: 3.2, z: v.z }, true); // hop over the curb
        }
      } else this.stuckT = 0;
    }

    if (this.grounded) {
      const tx = this.desired.x * speed;
      const tz = this.desired.z * speed;
      const k = 1 - Math.exp(-dt * 8);
      b.setLinvel({ x: v.x + (tx - v.x) * k, y: v.y, z: v.z + (tz - v.z) * k }, true);
    }
  }

  private updateImitation(dt: number) {
    const im = this.imitate;
    const b = this.body;
    if (!im) {
      this.state = 'wander';
      return;
    }
    im.t += dt;
    const v = b.linvel();
    switch (im.kind) {
      case 'roll':
        b.setLinvel({ x: im.dir.x * 4.2, y: v.y, z: im.dir.z * 4.2 }, true);
        break;
      case 'bonk':
        if (im.t < 0.3) b.setLinvel({ x: im.dir.x * 6, y: v.y, z: im.dir.z * 6 }, true);
        else if (im.t < 0.36) {
          b.setLinvel({ x: -im.dir.x * 4, y: 3.5, z: -im.dir.z * 4 }, true);
          this.glitch(0.3);
          this.tumbleV = rand(-10, 10);
          this.game.sfx('bonk', this.pos, 0.5, 1.4);
        }
        break;
      case 'climb':
        if (im.t < 1.2) b.setLinvel({ x: 0, y: 1.3, z: 0 }, true);
        else b.setGravityScale(1, true);
        break;
      case 'wash':
      case 'chitter':
      case 'flop':
        b.setLinvel({ x: v.x * 0.9, y: v.y, z: v.z * 0.9 }, true);
        break;
      default:
        break;
    }
    if (im.t >= im.dur) {
      this.imitate = null;
      b.setGravityScale(1, true);
      this.state = this.role === 'tiny' ? 'follow' : 'wander';
      this.pickTarget();
    }
  }

  private pickTarget(avoidNormal?: THREE.Vector3) {
    const game = this.game;
    const water = waterOf(game);
    for (let i = 0; i < 8; i++) {
      let a = Math.random() * Math.PI * 2;
      if (avoidNormal && i < 5) a = Math.atan2(avoidNormal.z, avoidNormal.x) + rand(-1.1, 1.1);
      const r = avoidNormal ? rand(3, 8) : rand(3, this.homeR);
      const base = avoidNormal ? this.pos : this.home;
      const x = clamp(base.x + Math.cos(a) * r, -170, 170);
      const z = clamp(base.z + Math.sin(a) * r, -170, 155);
      _v.set(x, terrainY(game, x, z), z);
      if (water?.nearWater(_v, 1.5)) continue;
      if (_v.distanceTo(this.home) > this.homeR * 1.4) continue;
      this.target.copy(_v);
      return;
    }
    this.target.copy(this.home);
  }

  relocate(ground: THREE.Vector3) {
    this.body.setTranslation({ x: ground.x, y: ground.y + this.r + 0.08, z: ground.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.home.copy(ground);
    this.pos.copy(ground);
    this.root.position.copy(ground);
    this.target.copy(ground);
    this.popT = 0;
    this.u.uFlash.value = 1;
    this.glitch(0.4);
    this.state = 'wander';
  }

  // ---------------------------------------------------------------- visuals (after physics)
  animate(dt: number, player: Jimothy | undefined, frame: number) {
    if (this.dead) return;
    const game = this.game;
    const now = game.time;
    const u = this.u;

    if (this.dying) {
      this.dieT += dt;
      u.uDissolve.value = Math.min(1, this.dieT / 0.95);
      u.uFlash.value = Math.max(0, 1 - this.dieT * 2);
      u.uGlitch.value = 0.6;
      this.root.position.y += dt * 0.35;
      this.pivot.rotation.y += dt * 2;
      if (this.dieT > 1.05) this.dispose();
      return;
    }

    const t = this.body.translation();
    this.root.position.set(t.x, t.y, t.z);
    const dP = player ? this.root.position.distanceTo(player.position) : 999;
    this.root.visible = dP < 150;
    if (!this.root.visible) return;
    // shadows only up close (tiny ones only right next to Jimothy)
    this.mesh.castShadow = dP < (this.role === 'tiny' ? 14 : 38);
    // far ones animate at a lower rate
    if (dP > 70 && (frame + this.followIndex) % 4 !== 0) return;
    const adt = dP > 70 ? dt * 4 : dt;

    const v = this.body.linvel();
    const hs = Math.hypot(v.x, v.z);
    const held = !!this.entity.data.heldByPlayer;
    const im = this.imitate;

    // facing
    let wantYaw = this.facing;
    if (held && player) wantYaw = player.facing;
    else if (hs > 0.35 && !(im && im.kind === 'roll')) wantYaw = Math.atan2(v.x, v.z);
    else if (player && dP < 9) wantYaw = Math.atan2(player.position.x - t.x, player.position.z - t.z);
    let dy = wantYaw - this.facing;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.facing += dy * (1 - Math.exp(-adt * 7));

    // body pose (waddle, tumble, bad imitations)
    this.animPhase += adt * (2 + hs * 2.4);
    const walkAmp = clamp(hs / 2, 0, 1.3);
    const airborne = !this.grounded && !held && Math.abs(v.y) > 1.5;
    if (airborne || this.state === 'stunned') this.tumble += this.tumbleV * adt;
    else {
      this.tumble += (Math.round(this.tumble / (Math.PI * 2)) * Math.PI * 2 - this.tumble) * (1 - Math.exp(-adt * 8));
      this.tumbleV *= Math.exp(-adt * 3);
    }
    let rx = Math.sin(this.animPhase * 0.5) * 0.05 * walkAmp + this.tumble;
    let ry = this.facing;
    let rz = Math.sin(now * 7.3 + this.animPhase) * 0.13 * walkAmp;
    let lift = Math.sin(now * 2.1 + this.animPhase) * 0.03;
    const legs = SLOP_LEGS;
    let legAmp = 0.12 + 0.7 * walkAmp;
    let legRate = 1;
    let armOverride: number | null = null;
    if (im) {
      switch (im.kind) {
        case 'roll':
          ry += im.t * 17; // rolls around the wrong axis
          rx = 0.9;
          legAmp = 0.05;
          break;
        case 'flop': {
          const k = Math.min(1, im.t * 4) * Math.min(1, (im.dur - im.t) * 4);
          rz = Math.PI * k;
          lift += 0.25 * k;
          legRate = 2.4;
          legAmp = 1.1;
          break;
        }
        case 'wash':
          armOverride = -2.1 + Math.sin(now * 26) * 0.45;
          break;
        case 'climb':
          rx = -1.2;
          legRate = 1.8;
          legAmp = 1.0;
          break;
        case 'jump':
          legAmp = 1.2;
          legRate = 0.4;
          break;
        default:
          break;
      }
    }
    if (held) {
      legAmp = 1.2;
      legRate = 2.2;
      rz = Math.sin(now * 13) * 0.25;
    }
    this.pivot.rotation.set(rx, ry, rz, 'YXZ');
    this.pivot.position.y = lift;

    // legs: every leg keeps its own (wrong) tempo
    for (let i = 0; i < legs.length; i++) {
      const p = legs[i];
      let a = Math.sin(now * this.legFreq[i] * legRate + this.legPhase[i]) * legAmp;
      let roll = 0;
      if (i >= 4) roll = Math.sin(now * 3.1 + i) * 0.45; // extra legs flail sideways
      if (armOverride != null && (p === SP.armL || p === SP.armR)) a = armOverride + (p === SP.armL ? 0.2 : -0.2);
      u.uRot.value[p].set(a, 0, roll);
    }
    // head: tilts, stares, occasionally snaps 90°
    let headTilt = Math.sin(now * 0.9 + this.animPhase) * 0.22;
    let headYaw = Math.sin(now * 0.6 + this.facing) * 0.3;
    if (now > this.nextHeadSnap) {
      this.nextHeadSnap = now + rand(7, 18);
      this.headSnapT = rand(0.25, 0.6);
    }
    if (this.headSnapT > 0) {
      this.headSnapT -= adt;
      headTilt += Math.PI / 2;
    }
    if (im?.kind === 'chitter') headTilt += Math.sin(now * 40) * 0.25;
    u.uRot.value[SP.head].set(im?.kind === 'wash' ? 0.35 : 0, headYaw, headTilt);
    u.uRot.value[SP.tail].set(0.2 + Math.sin(now * 2.3) * 0.15, Math.sin(now * 5.2 + this.animPhase) * 0.55, 0);
    u.uRot.value[SP.extraTail].set(Math.sin(now * 4.1) * 0.3, Math.sin(now * 9.3) * 0.7, 0);

    // spawn pop
    if (this.popT < 1) {
      this.popT = Math.min(1, this.popT + adt * 2.2);
      const s = this.popT < 0.7 ? this.popT / 0.7 * 1.25 : 1.25 - (this.popT - 0.7) / 0.3 * 0.25;
      this.root.scale.setScalar(this.scale * Math.max(0.01, s));
    } else this.root.scale.setScalar(this.scale);

    // glitch pulses (not for the "correct" one... mostly)
    if (!this.correct || Math.random() < 0.002) {
      if (now > this.nextGlitch) {
        this.nextGlitch = now + rand(1.5, 5.5);
        this.glitchT = Math.max(this.glitchT, rand(0.08, 0.3));
      }
      if (now > this.nextBlocky) {
        this.nextBlocky = now + rand(4, 11);
        this.blockyT = rand(0.15, 0.4);
      }
    }
    this.glitchT -= adt;
    this.blockyT -= adt;
    u.uGlitch.value = this.glitchT > 0 ? 1 : 0;
    u.uBlocky.value = this.blockyT > 0 ? 0.75 : 0;
    u.uFlash.value = Math.max(0, u.uFlash.value - adt * 1.6);

    // phasing: vanish for a frame or two, or show a duplicate for a few frames
    if (!this.correct && now > this.nextPhase && this.ghostT < 0) {
      this.nextPhase = now + rand(4, 12);
      this.phaseFrames = Math.floor(rand(1, 4));
      this.phaseGhost = Math.random() < 0.55;
      if (this.phaseGhost) {
        if (!this.ghostMat) this.scatterPrepare();
        const g = this.ghosts[0];
        if (g) {
          this.mesh.getWorldPosition(g.mesh.position);
          const side = _v.set(Math.cos(this.facing), 0, -Math.sin(this.facing)).multiplyScalar(rand(-0.5, 0.5) * this.scale * 1.5);
          g.mesh.position.add(side);
          this.mesh.getWorldQuaternion(g.mesh.quaternion);
          g.mesh.scale.setScalar(this.scale);
        }
      }
    }
    if (this.phaseFrames > 0) {
      this.phaseFrames--;
      if (this.phaseGhost) {
        if (this.ghosts[0]) this.ghosts[0].mesh.visible = this.phaseFrames > 0;
      } else this.mesh.visible = this.phaseFrames <= 0;
    } else if (this.ghostT < 0) this.mesh.visible = true;

    // bonk duplicates
    if (this.ghostT >= 0) {
      this.ghostT += adt;
      const home = this.mesh.getWorldPosition(_v);
      for (const g of this.ghosts) {
        if (this.ghostT < 0.5) {
          g.mesh.position.addScaledVector(g.vel, adt);
          g.vel.multiplyScalar(Math.exp(-adt * 3));
          g.vel.y -= 6 * adt;
        } else {
          g.mesh.position.lerp(home, 1 - Math.exp(-adt * 9));
        }
        g.mesh.rotateY(g.spin * adt);
        g.mesh.visible = Math.random() > 0.3;
      }
      this.mesh.visible = Math.random() > 0.15;
      if (this.ghostT > 1.1) {
        this.ghostT = -1;
        for (const g of this.ghosts) g.mesh.visible = false;
        this.mesh.visible = true;
      }
    }
  }

  private scatterPrepare() {
    this.scatter();
    this.ghostT = -1;
    for (const g of this.ghosts) g.mesh.visible = false;
    this.mesh.visible = true;
    this.glitchT = 0;
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.root.removeFromParent();
    for (const g of this.ghosts) g.mesh.removeFromParent();
    this.mat.dispose();
    this.depthMat.dispose();
    this.ghostMat?.dispose();
    if (this.entity.alive) {
      this.game.entities.remove(this.entity);
      this.game.physics.removeBody(this.body);
    }
  }
}

// =====================================================================================================

/**
 * Owns every Slopothy: spawning (initial roamers, Prompt Portal waves, SlopBot bursts), caps, far-away LOD,
 * bad imitations of Jimothy's moves, slop speech, fans cheering the fakes, and the wash score/events.
 */
export class SlopothyManager {
  readonly list: Slopothy[] = [];
  model: SlopModelData | null = null;
  maxRegular = 16;
  maxTiny = 14;
  washedTotal = 0;
  private recentWashes: number[] = [];
  private lastTalk = -10;
  private cheerTimer = 2;
  private relocateTimer = 15;
  private frame = 0;
  /** Where portal waves come out (set by the system). */
  portal: THREE.Vector3 | null = null;
  campusCenter = new THREE.Vector3(-120, 0, -120);

  constructor(
    private game: Game,
    private timeline: Timeline,
  ) {}

  /** game.time of Jimothy's last bonk (so only his bonks score). */
  lastPlayerBonk = -10;

  init() {
    const g = this.game;
    g.events.on('bonkStart', () => (this.lastPlayerBonk = g.time));
    const imitateOn = (kind: ImitateKind) => () => this.broadcastImitation(kind);
    g.events.on('jump', imitateOn('jump'));
    g.events.on('rollStart', imitateOn('roll'));
    g.events.on('chitter', imitateOn('chitter'));
    g.events.on('washStart', imitateOn('wash'));
    g.events.on('bonkStart', imitateOn('bonk'));
    g.events.on('climbStart', imitateOn('climb'));
    g.events.on('playerRagdoll', (p: { cause?: string }) => {
      if (p?.cause === 'flop') this.broadcastImitation('flop');
    });
    g.events.on('explosion', (e: { position?: THREE.Vector3; radius?: number }) => {
      if (!e?.position) return;
      const r = (e.radius ?? 6) + 2;
      for (const s of this.list) if (s.alive && s.pos.distanceTo(e.position) < r) s.scatter();
    });
  }

  get regularCount() {
    let n = 0;
    for (const s of this.list) if (s.alive && s.role !== 'tiny') n++;
    return n;
  }
  get tinyCount() {
    let n = 0;
    for (const s of this.list) if (s.alive && s.role === 'tiny') n++;
    return n;
  }
  alive(): Slopothy[] {
    return this.list.filter((s) => s.alive);
  }

  /** Spawn one Slopothy standing at `ground`. Returns null if capped or the model isn't ready. */
  spawn(ground: THREE.Vector3, opts: SpawnOpts): Slopothy | null {
    if (!this.model) return null;
    if (opts.role === 'tiny') {
      if (this.tinyCount >= this.maxTiny) {
        const oldest = this.list.filter((s) => s.alive && s.role === 'tiny').sort((a, b) => a.bornAt - b.bornAt)[0];
        oldest?.dissolve('cap');
      }
    } else if (this.regularCount >= this.maxRegular) return null;
    const s = new Slopothy(this.game, this, this.model, ground, opts);
    s.followIndex = this.list.length % 12;
    this.list.push(s);
    if (opts.announce) {
      this.game.sfx('slop_glitch', ground, 0.6, rand(0.9, 1.3));
      if (opts.role !== 'tiny' && Math.random() < 0.7) this.talk(s, pick(SLOP_SPAWN));
    }
    this.game.events.emit('slopSpawned', { entity: s.entity, role: s.role, count: this.regularCount });
    return s;
  }

  /** Called by a Slopothy the moment it starts dissolving. */
  onDissolved(s: Slopothy, reason: DissolveReason, pos: THREE.Vector3) {
    const game = this.game;
    if (reason !== 'washed') return;
    this.washedTotal++;
    const now = game.time;
    this.recentWashes = this.recentWashes.filter((t) => now - t < 5);
    this.recentWashes.push(now);
    const n = this.recentWashes.length;
    game.score(s.role === 'tiny' ? 90 : 160, 'Slop Washed Away', pos);
    if (n >= 2) game.score(70 * n, `Slop Combo x${n}`, pos);
    if (s.correct) {
      game.score(200, 'Plot Twist: Also AI', pos);
      game.hint('Plot twist: the normal-looking one was also AI.', 3);
    }
    game.events.emit('slopWashed', { count: 1, total: this.washedTotal, position: pos, entity: s.entity, tiny: s.role === 'tiny' });
  }

  /** Rate-limited slop speech. `force` skips the global limiter (still needs the player nearby). */
  talk(s: Slopothy, text: string, force = false) {
    const game = this.game;
    const p = game.get<Jimothy>('player');
    if (!p || s.pos.distanceTo(p.position) > 32) return;
    if (!force && game.time - this.lastTalk < 2.2) return;
    this.lastTalk = game.time;
    say(game, s.entity, text, 3.2, 'slop');
    if (Math.random() < 0.5) game.sfx('slop_voice', s.pos, 0.35, rand(0.9, 1.3));
  }

  /** Last words of a Slopothy that is about to dissolve (bubble stays where it was). */
  talkAt(s: Slopothy, text: string) {
    const game = this.game;
    const p = game.get<Jimothy>('player');
    if (!p || s.pos.distanceTo(p.position) > 32) return;
    this.lastTalk = game.time;
    sayAt(game, s.root.position.clone().add(new THREE.Vector3(0, 0.95 * s.scale, 0)), text, 2.6);
  }

  private broadcastImitation(kind: ImitateKind) {
    const p = this.game.get<Jimothy>('player');
    if (!p) return;
    const now = this.game.time;
    const cands = this.list
      .filter((s) => s.alive && !s.entity.data.heldByPlayer && s.state !== 'stunned' && s.state !== 'imitate' && !s.pendingImitate && now > s.imitateCooldown)
      .map((s) => ({ s, d: s.pos.distanceTo(p.position) }))
      .filter((c) => c.d < 16)
      .sort((a, b) => a.d - b.d);
    const n = kind === 'jump' || kind === 'chitter' ? 3 : 2;
    for (let i = 0; i < Math.min(n, cands.length); i++) {
      if (Math.random() < 0.25 && i > 0) continue;
      cands[i].s.pendingImitate = { kind, at: now + rand(0.35, 0.9) + i * 0.25 };
    }
  }

  // ---------------------------------------------------------------- per-frame
  update(dt: number) {
    const game = this.game;
    const player = game.get<Jimothy>('player');
    for (const s of this.list) s.update(dt, player);
    if (!player) return;
    const now = game.time;

    // idle chatter
    for (const s of this.list) {
      if (!s.alive || now < s.nextTalk) continue;
      s.nextTalk = now + rand(9, 22);
      if (s.pos.distanceTo(player.position) < 22) this.talk(s, pick(SLOP_IDLE));
    }

    // fans cheer the fakes (they think it's Jimothy)
    this.cheerTimer -= dt;
    if (this.cheerTimer <= 0) {
      this.cheerTimer = rand(1.2, 2.2);
      const near = this.list.filter((s) => s.alive && now > s.cheerCooldown && s.pos.distanceTo(player.position) < 45);
      if (near.length) {
        const s = pick(near);
        const fans = findNpcs(game, s.pos, 9).filter((e) => {
          const npc = e.data?.npc;
          if (!npc) return true;
          return !(npc.ragdolled || npc.isCustom || npc.removed || npc.passive);
        });
        if (fans.length) {
          s.cheerCooldown = now + rand(10, 18);
          const fan = pick(fans);
          say(game, fan, pick(FAN_CHEERS), 2.8);
          // they think it's Jimothy: turn to it, cheer / hold the phone up for a few seconds
          const npc = fan.data?.npc;
          if (npc) {
            try {
              npc.lookAt?.(s.pos);
              npc.gesture = npc.held?.data?.itemKind === 'phone' ? 'film' : 'cheer';
              npc.setExpression?.('happy');
              this.timeline.later(4, () => {
                if (!npc.removed && !npc.isCustom) npc.lookAt?.(null);
              });
            } catch {
              /* optional NPC hooks */
            }
          }
          game.events.emit('slopCheered', { npc: fan, slop: s.entity, position: s.pos.clone() });
        }
      }
    }

    // roamers that are far away drift back into town near Jimothy ("regenerated elsewhere")
    this.relocateTimer -= dt;
    if (this.relocateTimer <= 0) {
      this.relocateTimer = rand(6, 10);
      const nearCount = this.list.filter((s) => s.alive && s.role !== 'tiny' && s.pos.distanceTo(player.position) < 70).length;
      if (nearCount < 5) {
        const far = this.list.filter((s) => s.alive && s.role === 'roamer' && now > s.relocateAt && s.pos.distanceTo(player.position) > 120);
        if (far.length) {
          const s = pick(far);
          s.relocateAt = now + rand(40, 70);
          const spot = this.spotNear(player.position, 35, 65);
          if (spot) s.relocate(spot);
        }
      }
    }

    // housekeeping
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.dead) this.list.splice(i, 1);
      else if (s.alive && s.role === 'tiny' && now - s.bornAt > 90) {
        if (Math.random() < 0.3) this.talkAt(s, 'Context window exceeded.');
        s.dissolve('timeout');
      }
    }
  }

  animate(dt: number) {
    const player = this.game.get<Jimothy>('player');
    this.frame++;
    for (const s of this.list) s.animate(dt, player, this.frame);
  }

  // ---------------------------------------------------------------- spawning helpers
  /** Open ground 35–65 m from `center`, preferably behind the camera. */
  spotNear(center: THREE.Vector3, rMin: number, rMax: number): THREE.Vector3 | null {
    const cam = this.game.get<CameraRig>('camera');
    for (let i = 0; i < 3; i++) {
      const s = findClearSpot(this.game, center, rMin, rMax, 0.5, 0.5, 1.2, 12);
      if (!s) continue;
      if (cam && i < 2) {
        const f = cam.forward(_v);
        if (_w.subVectors(s, center).normalize().dot(f) > 0.3) continue;
      }
      return s;
    }
    return null;
  }

  /** Candidate town spots for roamers (NPC areas from the level builders, or fallbacks). */
  townSpots(): THREE.Vector3[] {
    const w = worldOf(this.game);
    const out: THREE.Vector3[] = [];
    for (const s of w?.npcSpawns ?? []) out.push(s.center.clone());
    if (out.length < 4) for (const [x, z] of TOWN_SPOTS) out.push(new THREE.Vector3(x, terrainY(this.game, x, z), z));
    return out;
  }

  spawnRoamers(n: number) {
    const spots = this.townSpots().sort(() => Math.random() - 0.5);
    let made = 0;
    for (const c of spots) {
      if (made >= n) break;
      if (c.distanceTo(this.campusCenter) < 40) continue;
      const g = findClearSpot(this.game, c, 0, 14, 0.5, 0.5, 1.2, 16);
      if (!g) continue;
      if (this.spawn(g, { role: 'roamer' })) made++;
    }
    return made;
  }

  spawnCampus(n: number, around: THREE.Vector3, announce = false) {
    let made = 0;
    for (let i = 0; i < n * 3 && made < n; i++) {
      const g = findClearSpot(this.game, around, 1, 9, 0.5, 0.5, 1.2, 10);
      if (!g) continue;
      if (this.spawn(g, { role: 'campus', home: this.campusCenter, announce })) made++;
    }
    return made;
  }

  /** SlopBot: "Generating 12 raccoons… 11 of them are wrong." */
  spawnTinyBurst(center: THREE.Vector3, n = 12) {
    let made = 0;
    const correctIdx = Math.floor(Math.random() * n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
      const r = rand(1.4, 3.2);
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      const ground = new THREE.Vector3(x, Math.max(terrainY(this.game, x, z), center.y - 0.4), z);
      const s = this.spawn(ground, { role: 'tiny', correct: i === correctIdx, announce: true });
      if (s) {
        s.state = 'follow';
        s.followIndex = i;
        made++;
      }
    }
    return made;
  }

  dissolveAll(reason: DissolveReason, stagger = 0.3, filter?: (s: Slopothy) => boolean) {
    const list = this.alive().filter((s) => (filter ? filter(s) : true));
    // nearest to the player first so it's visible
    const p = this.game.get<Jimothy>('player');
    if (p) list.sort((a, b) => a.pos.distanceTo(p.position) - b.pos.distanceTo(p.position));
    list.forEach((s, i) => {
      if (stagger <= 0) s.dissolve(reason);
      else this.timeline.later(i * stagger, () => s.alive && s.dissolve(reason));
    });
    return list.length;
  }
}
