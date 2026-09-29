import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { G } from '../../core/Physics';
import { Animal, damp, dampAngle, wrapAngle, WORLD_ONLY } from './Animal';

/**
 * Seattle crows. A little flock hangs around the crow tree: hopping, pecking, cawing, taking off when Jimothy
 * charges them. Crow Deals: leave a washed shiny thing by the tree and a crow takes it, flies off, and comes
 * back with a gift that it drops at Jimothy's feet.
 */

// ================================================================================================ model

interface CrowParts {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  jaw: THREE.Object3D;
  wingL: THREE.Group;
  wingR: THREE.Group;
  tail: THREE.Object3D;
  legs: THREE.Group;
  hold: THREE.Group;
}

let shared: {
  feather: THREE.MeshStandardMaterial;
  featherDark: THREE.MeshStandardMaterial;
  beak: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  shine: THREE.MeshBasicMaterial;
  bodyG: THREE.BufferGeometry;
  headG: THREE.BufferGeometry;
  beakG: THREE.BufferGeometry;
  jawG: THREE.BufferGeometry;
  eyeG: THREE.BufferGeometry;
  shineG: THREE.BufferGeometry;
  wingG: THREE.BufferGeometry;
  tailG: THREE.BufferGeometry;
  legG: THREE.BufferGeometry;
  toeG: THREE.BufferGeometry;
} | null = null;

/** A wing: flat tapered blade, root at the origin, extending along +X, trailing edge toward -Z. */
function wingGeometry(): THREE.BufferGeometry {
  // outline in the XZ plane (x out along the wing, z forward)
  const pts: [number, number][] = [
    [0, 0.06],
    [0.12, 0.07],
    [0.24, 0.05],
    [0.33, 0.0],
    [0.36, -0.06],
    [0.3, -0.1],
    [0.26, -0.08],
    [0.22, -0.13],
    [0.17, -0.1],
    [0.12, -0.15],
    [0.06, -0.12],
    [0, -0.1],
  ];
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
  // shape is in XY; rotate so the outline lies in XZ (y = thickness)
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.009, 0);
  g.computeVertexNormals();
  return g;
}

function crowShared() {
  if (shared) return shared;
  const feather = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.42, metalness: 0.18, name: 'CrowFeather' });
  const featherDark = new THREE.MeshStandardMaterial({ color: 0x0e0f13, roughness: 0.5, metalness: 0.12, name: 'CrowFeatherDark' });
  const beak = new THREE.MeshStandardMaterial({ color: 0x24252a, roughness: 0.35, metalness: 0.1 });
  const eye = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.1 });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const bodyG = new THREE.SphereGeometry(1, 14, 10);
  const headG = new THREE.SphereGeometry(1, 12, 9);
  const beakG = new THREE.ConeGeometry(0.028, 0.11, 7);
  beakG.rotateX(Math.PI / 2);
  beakG.translate(0, 0, 0.055);
  const jawG = new THREE.ConeGeometry(0.02, 0.08, 6);
  jawG.rotateX(Math.PI / 2);
  jawG.translate(0, 0, 0.04);
  const eyeG = new THREE.SphereGeometry(0.017, 8, 6);
  const shineG = new THREE.SphereGeometry(0.006, 6, 4);
  const wingG = wingGeometry();
  const tailG = new THREE.CylinderGeometry(0.075, 0.035, 0.2, 7, 1);
  tailG.scale(1, 1, 0.22);
  tailG.rotateX(Math.PI / 2);
  tailG.translate(0, 0, -0.1);
  const legG = new THREE.CylinderGeometry(0.009, 0.008, 0.1, 5);
  legG.translate(0, -0.05, 0);
  const toeG = new THREE.BoxGeometry(0.012, 0.008, 0.05);
  shared = { feather, featherDark, beak, eye, shine, bodyG, headG, beakG, jawG, eyeG, shineG, wingG, tailG, legG, toeG };
  return shared;
}

export function buildCrow(): CrowParts {
  const S = crowShared();
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
    const o = new THREE.Mesh(g, m);
    o.castShadow = true;
    o.receiveShadow = false;
    return o;
  };
  const root = new THREE.Group();
  root.name = 'Crow';
  root.rotation.order = 'YXZ';
  const body = new THREE.Group();
  body.position.set(0, 0.2, 0);
  root.add(body);
  const torso = mesh(S.bodyG, S.feather);
  torso.scale.set(0.1, 0.1, 0.18);
  body.add(torso);
  const chest = mesh(S.bodyG, S.feather);
  chest.scale.set(0.085, 0.09, 0.1);
  chest.position.set(0, 0.03, 0.09);
  body.add(chest);
  // head
  const head = new THREE.Group();
  head.position.set(0, 0.09, 0.15);
  body.add(head);
  const skull = mesh(S.headG, S.feather);
  skull.scale.set(0.068, 0.066, 0.078);
  head.add(skull);
  const beak = mesh(S.beakG, S.beak);
  beak.position.set(0, -0.005, 0.055);
  beak.rotation.x = 0.08;
  head.add(beak);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.022, 0.05);
  head.add(jaw);
  jaw.add(mesh(S.jawG, S.beak));
  for (const sx of [-1, 1]) {
    const e = mesh(S.eyeG, S.eye);
    e.position.set(sx * 0.045, 0.018, 0.045);
    head.add(e);
    const sh = new THREE.Mesh(S.shineG, S.shine);
    sh.position.set(sx * 0.052, 0.026, 0.056);
    head.add(sh);
  }
  // beak hold point (carried trinkets)
  const hold = new THREE.Group();
  hold.position.set(0, -0.03, 0.13);
  head.add(hold);
  // wings (pivot at the shoulder)
  const wingL = new THREE.Group();
  wingL.position.set(0.07, 0.04, 0.04);
  body.add(wingL);
  const wl = mesh(S.wingG, S.featherDark);
  wingL.add(wl);
  const wingR = new THREE.Group();
  wingR.position.set(-0.07, 0.04, 0.04);
  body.add(wingR);
  const wr = mesh(S.wingG, S.featherDark);
  wr.scale.x = -1;
  wingR.add(wr);
  // tail
  const tail = mesh(S.tailG, S.featherDark);
  tail.position.set(0, 0.0, -0.15);
  tail.rotation.x = -0.2;
  body.add(tail);
  // legs
  const legs = new THREE.Group();
  legs.position.set(0, 0.11, 0);
  root.add(legs);
  for (const sx of [-1, 1]) {
    const l = mesh(S.legG, S.beak);
    l.position.set(sx * 0.035, 0, 0);
    legs.add(l);
    const toe = mesh(S.toeG, S.beak);
    toe.position.set(sx * 0.035, -0.1, 0.012);
    legs.add(toe);
  }
  return { root, body, head, jaw, wingL, wingR, tail, legs, hold };
}

// ================================================================================================ crow

type CrowState =
  | 'ground'
  | 'perch'
  | 'flee' // startled: circling the tree
  | 'land' // gliding down to a landing spot
  | 'fetch' // flying to an offered trinket
  | 'pickup'
  | 'carry' // flying away with it
  | 'away' // out of sight, shopping for a gift
  | 'return' // bringing the gift to Jimothy
  | 'drop'
  | 'steal' // swooping on someone's fries
  | 'snack'; // eating a stolen fry

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export interface CrowJob {
  item?: Entity;
  onTaken?: (crow: Crow, item: Entity) => THREE.Object3D | null;
  /** Visual of the gift being brought back (built when the crow reappears). */
  giftVisual?: () => THREE.Object3D | null;
  /** Spawn the real gift at `pos`. */
  onDeliver?: (pos: THREE.Vector3) => void;
  /** Steal: current target position (null = gone). */
  victim?: () => THREE.Vector3 | null;
  onSnatch?: () => void;
  onAbort?: () => void;
  away?: THREE.Vector3;
}

export class Crow extends Animal {
  readonly parts: CrowParts;
  flock!: CrowFlock;
  flying = false;
  private flapPh = Math.random() * 6;
  private flapAmt = 0;
  private bank = 0;
  private bodyPitch = 0;
  private peck = 0;
  private caw = 0;
  private preen = 0;
  private headYaw = 0;
  private nextAct = Math.random() * 2;
  readonly target = new THREE.Vector3();
  perch: THREE.Vector3 | null = null;
  job: CrowJob | null = null;
  private carried: THREE.Object3D | null = null;
  private circleA = Math.random() * Math.PI * 2;
  private circleR = 6;
  private circleH = 6;
  private fleeFor = 5;
  private washCd = 0;

  constructor(game: Game, pos: THREE.Vector3, yaw = Math.random() * Math.PI * 2) {
    super(game, {
      name: 'Crow',
      species: 'crow',
      position: pos,
      yaw,
      ball: 0.2,
      colliderY: 0.2,
      mass: 0.5,
      tags: ['crow', 'bird'],
      filter: G.WORLD,
      emoteY: 0.55,
      emoteSize: 0.3,
    });
    this.parts = buildCrow();
    const s = 0.95 + Math.random() * 0.15;
    this.parts.root.scale.setScalar(s);
    game.scene.add(this.parts.root);
    this.setupPhysics(this.parts.root);
    this.parts.root.position.copy(this.pos);
    this.setState('ground');
  }

  get busy() {
    return !!this.job;
  }
  get available() {
    return !this.job && (this.state === 'ground' || this.state === 'perch' || this.state === 'flee' || this.state === 'land');
  }

  // ------------------------------------------------------------------------------------------- commands
  startle(from?: THREE.Vector3) {
    if (this.job || this.state === 'flee') return;
    if (this.state !== 'ground' && this.state !== 'perch' && this.state !== 'land') return;
    this.takeOff();
    this.fleeFor = 4 + Math.random() * 4;
    this.circleR = 4.5 + Math.random() * 3.5;
    this.circleH = 5 + Math.random() * 3;
    const c = this.flock?.tree ?? this.pos;
    this.circleA = Math.atan2(this.pos.z - c.z, this.pos.x - c.x);
    if (from) this.circleA += Math.random() < 0.5 ? 0.6 : -0.6;
    this.setState('flee');
    if (Math.random() < 0.7) this.cawNow();
  }

  cawNow() {
    this.caw = 0.6;
    this.game.sfx('crow_caw', this.pos, 0.8, 0.95 + Math.random() * 0.15);
  }

  /** Accept a trade/steal job. */
  assign(job: CrowJob, kind: 'fetch' | 'steal') {
    this.job = job;
    if (!this.flying) this.takeOff();
    this.setState(kind);
  }

  private takeOff() {
    this.flying = true;
    this.noGround = true;
    this.airborne = false;
    this.vel.set(0, 3.2, 0);
    this.perch = null;
    this.game.sfx('whoosh', this.pos, 0.25, 1.6);
  }

  private endJob(abort = false) {
    const j = this.job;
    this.job = null;
    if (this.carried) {
      this.carried.removeFromParent();
      this.carried = null;
    }
    if (abort) j?.onAbort?.();
  }

  private holdVisual(obj: THREE.Object3D | null) {
    if (this.carried) this.carried.removeFromParent();
    this.carried = null;
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(_v).length() || 0.2;
    const k = THREE.MathUtils.clamp(0.16 / size, 0.05, 2);
    const holder = new THREE.Group();
    obj.position.set(0, 0, 0);
    obj.quaternion.identity();
    obj.updateMatrixWorld(true);
    const c = new THREE.Box3().setFromObject(obj).getCenter(_v2);
    obj.position.copy(c).multiplyScalar(-1);
    holder.add(obj);
    holder.scale.setScalar(k / this.parts.root.scale.x);
    holder.rotation.y = Math.PI / 2;
    obj.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    this.parts.hold.add(holder);
    this.carried = holder;
  }

  // ------------------------------------------------------------------------------------------- flight
  private fly(dt: number, target: THREE.Vector3, speed: number, arrive = 1.5): number {
    const d = _v.copy(target).sub(this.pos);
    const dist = d.length();
    const want = Math.min(speed, dist * (speed / arrive) + 0.4);
    if (dist > 1e-4) d.multiplyScalar(want / dist);
    this.vel.lerp(d, 1 - Math.exp(-dt * 3.2));
    // climb over obstacles ahead
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 1) {
      const hit = this.game.physics.raycast(this.pos, _v2.set(this.vel.x, 0, this.vel.z), Math.min(4, hs * 0.7), WORLD_ONLY);
      if (hit) this.vel.y = Math.max(this.vel.y, 4);
    }
    this.pos.addScaledVector(this.vel, dt);
    // keep above the ground
    const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
    if (this.pos.y < g + 0.05) {
      this.pos.y = g + 0.05;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    if (hs > 0.3) {
      const newYaw = Math.atan2(this.vel.x, this.vel.z);
      const turn = wrapAngle(newYaw - this.yaw);
      this.yaw = dampAngle(this.yaw, newYaw, 5, dt);
      this.bank = damp(this.bank, THREE.MathUtils.clamp(-turn * 2.2, -0.8, 0.8), 5, dt);
    }
    this.bodyPitch = damp(this.bodyPitch, THREE.MathUtils.clamp(-this.vel.y * 0.08, -0.5, 0.5), 5, dt);
    this.flapAmt = damp(this.flapAmt, this.vel.y > -0.6 || speed < 3 ? 1 : 0.25, 6, dt);
    this.flapPh += dt * (this.vel.y > 0.5 ? 20 : 13);
    return dist;
  }

  private landAt(p: THREE.Vector3) {
    this.target.copy(p);
    this.setState('land');
  }

  private touchDown() {
    this.flying = false;
    this.noGround = false;
    this.vel.set(0, 0, 0);
    this.bank = 0;
    this.pos.y = this.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
  }

  // ------------------------------------------------------------------------------------------- behaviour
  protected think(dt: number) {
    const game = this.game;
    this.washCd -= dt;
    this.caw = Math.max(0, this.caw - dt);
    this.peck = Math.max(0, this.peck - dt);
    this.preen = Math.max(0, this.preen - dt);
    const tree = this.flock?.tree ?? this.pos;
    const j = this.job;

    switch (this.state as CrowState) {
      case 'ground': {
        if (this.flying) this.touchDown();
        this.snapToGround(dt, 30);
        this.nextAct -= dt;
        if (this.nextAct <= 0) {
          this.nextAct = 0.6 + Math.random() * 1.8;
          const r = Math.random();
          if (r < 0.4) {
            // hop somewhere nearby, staying around the tree
            const a = Math.random() * Math.PI * 2;
            const t = _v.set(this.pos.x + Math.cos(a) * 0.5, 0, this.pos.z + Math.sin(a) * 0.5);
            const fromTree = Math.hypot(t.x - tree.x, t.z - tree.z);
            if (fromTree > 7) t.set(this.pos.x + (tree.x - this.pos.x) * 0.15, 0, this.pos.z + (tree.z - this.pos.z) * 0.15);
            this.yaw = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
            this.launch(new THREE.Vector3((t.x - this.pos.x) * 2.4, 2.4, (t.z - this.pos.z) * 2.4), 0);
          } else if (r < 0.75) this.peck = 0.45;
          else if (r < 0.88) this.preen = 1.2;
          else this.headYaw = (Math.random() - 0.5) * 2;
        }
        break;
      }
      case 'perch': {
        if (this.perch) this.pos.copy(this.perch);
        this.nextAct -= dt;
        if (this.nextAct <= 0) {
          this.nextAct = 1 + Math.random() * 3;
          if (Math.random() < 0.5) this.headYaw = (Math.random() - 0.5) * 2.4;
          else this.preen = 1;
        }
        break;
      }
      case 'flee': {
        this.circleA += (5 / this.circleR) * dt;
        const t = _v2.set(tree.x + Math.cos(this.circleA) * this.circleR, tree.y + this.circleH, tree.z + Math.sin(this.circleA) * this.circleR);
        this.fly(dt, t, 6.5, 2);
        if (this.stateTime > this.fleeFor) {
          const spot = this.flock?.landingSpot(this);
          if (spot) this.landAt(spot);
          else this.stateTime = this.fleeFor - 2;
        }
        break;
      }
      case 'land': {
        const above = _v2.copy(this.target).setY(this.target.y + Math.max(0, Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) - 0.5) * 0.6);
        const d = this.fly(dt, above, 5, 2.2);
        if (d < 0.25 || this.stateTime > 10) {
          if (this.perch) {
            this.pos.copy(this.perch);
            this.flying = false;
            this.vel.set(0, 0, 0);
            this.setState('perch');
          } else {
            this.touchDown();
            this.setState('ground');
          }
          this.game.sfx('whoosh', this.pos, 0.15, 2);
        }
        break;
      }
      case 'fetch': {
        const item = j?.item;
        if (!item || !item.alive || item.data.heldByPlayer) {
          this.endJob(true);
          this.startle();
          break;
        }
        const t = item.body ? item.body.translation() : item.object!.position;
        const tp = _v2.set(t.x, t.y + 0.15, t.z);
        const d = this.fly(dt, tp, 6, 2);
        if (d < 0.35) {
          this.touchDown();
          this.setState('pickup');
        } else if (this.stateTime > 12) {
          this.endJob(true);
          this.startle();
        }
        break;
      }
      case 'pickup': {
        this.snapToGround(dt, 30);
        this.peck = 0.3;
        if (this.stateTime > 0.5) {
          const item = j?.item;
          if (!item || !item.alive || item.data.heldByPlayer) {
            this.endJob(true);
            this.startle();
            break;
          }
          const vis = j?.onTaken?.(this, item) ?? null;
          this.holdVisual(vis);
          this.cawNow();
          this.takeOff();
          const a = Math.random() * Math.PI * 2;
          j!.away = new THREE.Vector3(tree.x + Math.cos(a) * 42, tree.y + 16, tree.z + Math.sin(a) * 42);
          this.setState('carry');
        }
        break;
      }
      case 'carry': {
        const d = this.fly(dt, j?.away ?? _v2.set(tree.x, tree.y + 20, tree.z), 9, 3);
        if (d < 3 || this.stateTime > 5) {
          this.parts.root.visible = false;
          this.holdVisual(null);
          this.setState('away');
        }
        break;
      }
      case 'away': {
        if (this.stateTime > 3 + (this.flock ? this.flock.awayTime : 2)) {
          this.parts.root.visible = true;
          this.holdVisual(j?.giftVisual?.() ?? null);
          this.setState('return');
          this.cawNow();
        }
        break;
      }
      case 'return': {
        const p = this.player?.position as THREE.Vector3 | undefined;
        if (!p) {
          this.endJob(true);
          this.setState('flee');
          break;
        }
        const hover = _v2.set(p.x, p.y + 1.9, p.z);
        const d = this.fly(dt, hover, 10, 3);
        if (d < 0.8 || this.stateTime > 20) this.setState('drop');
        break;
      }
      case 'drop': {
        const p = this.player?.position as THREE.Vector3 | undefined;
        if (p) {
          const f = this.player.forwardVec ? this.player.forwardVec(_v) : _v.set(0, 0, 1);
          this.fly(dt, _v2.set(p.x + f.x * 0.9, p.y + 1.7, p.z + f.z * 0.9), 4, 1);
        } else this.fly(dt, this.pos, 1);
        if (this.stateTime > 0.7) {
          const dropAt = this.parts.hold.getWorldPosition(new THREE.Vector3());
          this.holdVisual(null);
          j?.onDeliver?.(dropAt);
          this.endJob(false);
          this.cawNow();
          this.say('heart', 1.2);
          this.startle();
          this.fleeFor = 2.5;
        }
        break;
      }
      case 'steal': {
        const v = j?.victim?.();
        if (!v) {
          this.endJob(true);
          this.startle();
          break;
        }
        const d = this.fly(dt, _v2.set(v.x, v.y + 0.3, v.z), 7.5, 2);
        if (d < 0.5) {
          j?.onSnatch?.();
          this.holdVisual(frenchFryVisual());
          this.cawNow();
          this.job = null;
          const spot = this.flock?.landingSpot(this, false);
          this.landAt(spot ?? _v.copy(tree));
          this.snackAfterLanding = true;
        } else if (this.stateTime > 14) {
          this.endJob(true);
          this.startle();
        }
        break;
      }
      case 'snack': {
        this.snapToGround(dt, 30);
        this.peck = 0.3;
        if (this.stateTime > 2.5) {
          this.holdVisual(null);
          this.setState('ground');
        }
        break;
      }
    }
    if (this.state === 'ground' && this.snackAfterLanding) {
      this.snackAfterLanding = false;
      this.setState('snack');
    }
  }

  private snackAfterLanding = false;

  // ------------------------------------------------------------------------------------------- reactions
  protected handleGrab() {
    this.startle(this.player?.position);
    if (Math.random() < 0.5) this.say('grumpy', 1);
    return false;
  }

  protected handleBonk() {
    this.startle(this.player?.position);
    this.game.events.emit('sparkle', { position: this.pos.clone().setY(this.pos.y + 0.3) });
  }

  protected handleWash() {
    if (this.washCd > 0) return;
    this.washCd = 2;
    this.preen = 1.5;
    this.say('heart', 1.3);
    this.hearts(3);
    this.cawNow();
    this.game.score(40, 'Gave A Crow A Bath', this.pos.clone());
  }

  protected onLanded() {
    // ground hop finished
  }

  // ------------------------------------------------------------------------------------------- visuals
  sync(dt: number) {
    const P = this.parts;
    const t = this.game.time;
    P.root.position.copy(this.pos);
    const flying = this.flying;
    P.root.rotation.set(flying ? this.bodyPitch : 0, this.yaw, flying ? this.bank : 0, 'YXZ');
    // wings
    let wl: number;
    let spread: number;
    if (flying) {
      const f = Math.sin(this.flapPh) * 0.95 * this.flapAmt + (1 - this.flapAmt) * 0.1;
      wl = f;
      spread = 1;
    } else if (this.airborne) {
      wl = Math.sin(t * 30) * 0.6;
      spread = 0.6;
    } else {
      wl = this.preen > 0 ? Math.sin(t * 9) * 0.25 + 0.2 : 0;
      spread = this.preen > 0 ? 0.25 : 0;
    }
    // folded: swept back along the body; spread: straight out
    const sweep = (1 - spread) * 1.45;
    P.wingL.rotation.set(0, -sweep, wl - (1 - spread) * 0.25, 'YZX');
    P.wingR.rotation.set(0, sweep, -wl + (1 - spread) * 0.25, 'YZX');
    // head: peck / caw / look
    const peckK = this.peck > 0 ? Math.sin((1 - this.peck / 0.45) * Math.PI) : 0;
    const cawK = this.caw > 0 ? Math.sin((this.caw / 0.6) * Math.PI) : 0;
    P.head.rotation.set(peckK * 0.9 - cawK * 0.5, flying ? 0 : this.headYaw * 0.6, 0);
    P.jaw.rotation.x = cawK * 0.5;
    P.body.rotation.x = flying ? 0 : peckK * 0.35;
    P.legs.visible = !flying || this.vel.y < -1;
    P.tail.rotation.x = -0.2 + (flying ? 0.15 : Math.sin(t * 3 + this.flapPh) * 0.05);
    this.headYaw *= Math.exp(-dt * 0.3);
    this.emote.update(dt, t);
  }

  override dispose() {
    super.dispose();
    this.parts.root.removeFromParent();
  }
}

/** A single golden french fry (crow snacks / gifts). */
export function frenchFryVisual() {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.022, 0.022, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.6 }),
  );
  return m;
}

// ================================================================================================ flock

export class CrowFlock {
  readonly game: Game;
  readonly crows: Crow[] = [];
  readonly tree = new THREE.Vector3();
  readonly perches: THREE.Vector3[] = [];
  /** Extra seconds a trading crow spends "shopping" out of sight. */
  awayTime = 1.5;
  private cawT = 3;

  constructor(game: Game, tree: THREE.Vector3, count = 6) {
    this.game = game;
    this.tree.copy(tree);
    this.findPerches();
    for (let i = 0; i < count; i++) {
      const perch = i < Math.min(2, this.perches.length) ? this.perches[i] : null;
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const r = 2 + Math.random() * 3.5;
      const p = perch ? perch.clone() : new THREE.Vector3(tree.x + Math.cos(a) * r, tree.y, tree.z + Math.sin(a) * r);
      const c = new Crow(game, p);
      c.flock = this;
      if (perch) {
        c.perch = perch;
        c.noGround = true;
        c.place(perch, undefined, true);
        c.setState('perch');
      } else c.place(p);
      this.crows.push(c);
    }
  }

  /** Look for tree-top spots to perch on (raycast the static scenery from above). */
  private findPerches() {
    try {
      const world = this.game.get<any>('world');
      const root = world?.staticRoot as THREE.Object3D | undefined;
      if (!root) return;
      const rc = new THREE.Raycaster();
      const near: THREE.Object3D[] = [];
      // only test objects whose bounds are near the tree
      const box = new THREE.Box3();
      const probe = new THREE.Box3(
        new THREE.Vector3(this.tree.x - 4, this.tree.y - 1, this.tree.z - 4),
        new THREE.Vector3(this.tree.x + 4, this.tree.y + 16, this.tree.z + 4),
      );
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || (m as any).isInstancedMesh) return;
        box.setFromObject(m);
        if (box.intersectsBox(probe)) near.push(m);
      });
      for (const o of root.children) {
        o.traverse((c) => {
          if ((c as any).isInstancedMesh) near.push(c);
        });
      }
      const offs = [
        [0.6, 0.3],
        [-0.5, -0.6],
        [0.2, -0.9],
        [-0.8, 0.5],
      ];
      for (const [dx, dz] of offs) {
        rc.set(new THREE.Vector3(this.tree.x + dx, this.tree.y + 20, this.tree.z + dz), new THREE.Vector3(0, -1, 0));
        rc.far = 20;
        const hits = rc.intersectObjects(near, false);
        const h = hits[0];
        if (h && h.point.y > this.tree.y + 2.5 && h.point.y < this.tree.y + 14) this.perches.push(h.point.clone());
        if (this.perches.length >= 2) break;
      }
    } catch {
      /* no perches, all crows on the ground */
    }
  }

  /** Somewhere to land: a free tree-top perch now and then, else a ground spot around the tree away from Jimothy. */
  landingSpot(crow?: Crow, allowPerch = true): THREE.Vector3 | null {
    if (crow) crow.perch = null;
    if (crow && allowPerch && Math.random() < 0.45) {
      const free = this.perches.find((pp) => !this.crows.some((o) => o !== crow && o.perch === pp));
      if (free) {
        crow.perch = free;
        return free.clone();
      }
    }
    const p = this.game.get<any>('player')?.position as THREE.Vector3 | undefined;
    if (p && Math.hypot(p.x - this.tree.x, p.z - this.tree.z) < 2.5) return null;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.8 + Math.random() * 4.5;
      const s = new THREE.Vector3(this.tree.x + Math.cos(a) * r, this.tree.y, this.tree.z + Math.sin(a) * r);
      if (!p || Math.hypot(p.x - s.x, p.z - s.z) > 4.5) {
        const world = this.game.get<any>('world');
        const hit = this.game.physics.raycast(_v.set(s.x, this.tree.y + 6, s.z), new THREE.Vector3(0, -1, 0), 14, WORLD_ONLY);
        s.y = hit ? hit.point.y : (world?.heightAt?.(s.x, s.z) ?? this.tree.y);
        return s;
      }
    }
    return null;
  }

  /** Nearest free crow to a point. */
  freeCrow(near: THREE.Vector3): Crow | null {
    let best: Crow | null = null;
    let bd = Infinity;
    for (const c of this.crows) {
      if (!c.available) continue;
      const d = c.pos.distanceToSquared(near);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  get trading() {
    return this.crows.some((c) => c.job && c.job.item);
  }

  update(dt: number) {
    const player = this.game.get<any>('player');
    const pp = player?.position as THREE.Vector3 | undefined;
    if (pp) {
      const v = player.velocity as THREE.Vector3;
      const rolling = player.mode === 'roll' || player.mode === 'ragdoll';
      for (const c of this.crows) {
        if (c.state !== 'ground' && c.state !== 'perch') continue;
        const dx = c.pos.x - pp.x;
        const dz = c.pos.z - pp.z;
        const d = Math.hypot(dx, dz);
        const dy = Math.abs(c.pos.y - pp.y);
        if (dy > 2.5) continue;
        const toward = d > 0.01 ? (v.x * dx + v.z * dz) / d : 0;
        const charging = toward > 3.2 && d < 4.2;
        if (charging || (rolling && d < 4.5) || d < 1.1) {
          c.startle(pp);
          // the rest of the flock nearby goes too
          for (const o of this.crows) if (o !== c && o.state === 'ground' && o.pos.distanceTo(c.pos) < 3.5 && Math.random() < 0.8) o.startle(pp);
        }
      }
    }
    // ambient caws
    this.cawT -= dt;
    if (this.cawT <= 0) {
      this.cawT = 3.5 + Math.random() * 6;
      const vis = this.crows.filter((c) => c.parts.root.visible && (!pp || c.pos.distanceTo(pp) < 70));
      const c = vis[Math.floor(Math.random() * vis.length)];
      if (c) c.cawNow();
    }
  }
}
