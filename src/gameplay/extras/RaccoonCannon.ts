import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { ExtrasHost, ExtrasFeature } from './host';
import {
  T,
  TR,
  between,
  paintMesh,
  drawBoard,
  surfaceAt,
  groundY,
  poi,
  fx,
  celebrate,
  prompt,
  playerOf,
  rigOf,
  uiOf,
  sceneBusy,
  releaseCamera,
  clearView,
  aboveGround,
  clamp,
  lerp,
  smooth,
  rand,
  damp,
  type Part,
} from './shared';

/**
 * RACCOON CANNONS — a giant circus/T-shirt-cannon parody.
 *
 *  - "Jimothy Night Cannon" on the Tee-Hee Park outfield, aimed over the left-centre wall at the town.
 *  - "Bay Blaster" on the Space Noodle deck, aimed at Salmon Bay (splashdown guaranteed*).
 *
 * Walk into the breech (the low open end resting on the ground) → Jimothy slides up the barrel and peeks out of the
 * muzzle → aim wobble + drumroll → BOOM (confetti + a harmless explosion puff, FX only — no 'explosion' event, so
 * nothing gets hurt) → launched as a ragdoll on a big randomized arc with a chase camera that never loses him.
 *
 * Events: 'cannonLaunch' { cannon, title, position, velocity, speed }
 *         'cannonLand'   { cannon, distance, height, water }
 * Scores: <title> (+500 on launch), "Cannon Flight N m", "Splashdown!".
 */

// barrel-local (axis +Z, pivot at the trunnions)
const BREECH = -1.45;
const MUZZLE = 2.9;
const PIVOT = new THREE.Vector3(0, 1.4, 0.25);

export interface CannonSpec {
  id: string;
  title: string;
  sign: [string, string];
  signColors?: [string, string];
  colors: { barrel: number; stripe: number; carriage: number; wheel: number; inside?: number };
  at: THREE.Vector3;
  heading: number;
  elevation: number;
  speed: [number, number];
  elev: [number, number];
  spread: number;
  scale?: number;
  trail?: number;
  /** Standing sign: root-local x, z and the yaw its face points to (π = toward the breech side) — or null for none. */
  signAt?: [number, number, number] | null;
  crowd?: THREE.Vector3;
  /** Where the flight is "meant" to end up (for hints). */
  target: string;
}

type CannonState = 'idle' | 'load' | 'aim' | 'cool';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Cannon {
  readonly spec: CannonSpec;
  readonly root = new THREE.Group();
  /** Yaw wobble around the carriage heading. */
  private aimGroup = new THREE.Group();
  /** Pitch pivot (trunnions). */
  private pitchGroup = new THREE.Group();
  /** The barrel mesh (slides back on recoil). */
  private barrel!: THREE.Mesh;
  readonly breech = new THREE.Vector3();
  readonly muzzle = new THREE.Vector3();
  state: CannonState = 'idle';
  private t = 0;
  private startPos = new THREE.Vector3();
  private launchSpeed = 30;
  private launchElev = 0.75;
  private launchYaw = 0;
  private drumT = 0;
  private recoil = 0;
  private jolt = 0;
  private camFn: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;
  private camLook = new THREE.Vector3();
  private readonly scale: number;

  constructor(
    private host: ExtrasHost,
    spec: CannonSpec,
  ) {
    this.spec = spec;
    this.scale = spec.scale ?? 1;
    this.build();
  }

  get game(): Game {
    return this.host.game;
  }

  // ---------------------------------------------------------------------------------------------- build
  private build() {
    const s = this.spec;
    const game = this.game;
    const c = s.colors;
    const root = this.root;
    root.name = `cannon:${s.id}`;
    root.position.copy(s.at);
    root.rotation.y = s.heading;
    root.scale.setScalar(this.scale);
    game.scene.add(root);

    // --- carriage: wheels, axle, cheeks, split trail
    const parts: Part[] = [];
    const trail = s.trail ?? 1;
    for (const sx of [-1, 1]) {
      const wx = sx * 1.02;
      parts.push({ g: new THREE.TorusGeometry(0.78, 0.1, 8, 26).rotateY(Math.PI / 2), c: 0x2b2733, m: T(wx, 0.86, 0.25) });
      parts.push({ g: new THREE.TorusGeometry(0.62, 0.05, 6, 24).rotateY(Math.PI / 2), c: c.wheel, m: T(wx, 0.86, 0.25) });
      for (let k = 0; k < 6; k++) parts.push({ g: new THREE.BoxGeometry(0.07, 1.34, 0.07), c: c.wheel, m: TR(wx, 0.86, 0.25, (k * Math.PI) / 6, 0, 0) });
      parts.push({ g: new THREE.CylinderGeometry(0.17, 0.17, 0.3, 14).rotateZ(Math.PI / 2), c: c.stripe, m: T(wx, 0.86, 0.25) });
      // cheek plates holding the trunnions
      parts.push({ g: new THREE.BoxGeometry(0.14, 0.95, 1.15), c: c.carriage, m: T(sx * 0.74, 1.02, 0.25) });
      parts.push({ g: new THREE.BoxGeometry(0.16, 0.08, 1.2), c: c.stripe, m: T(sx * 0.74, 1.5, 0.25) });
      // split trail beams resting on the ground behind (Jimothy walks between them into the breech)
      const a = new THREE.Vector3(sx * 0.6, 0.85, 0.05);
      const b = new THREE.Vector3(sx * 0.5, 0.1, -2.3 * trail);
      parts.push({ g: new THREE.BoxGeometry(0.2, 1, 0.16), c: c.carriage, m: between(a, b) });
      parts.push({ g: new THREE.BoxGeometry(0.3, 0.1, 0.34), c: c.stripe, m: T(b.x, 0.05, b.z) });
    }
    parts.push({ g: new THREE.CylinderGeometry(0.09, 0.09, 2.2, 10).rotateZ(Math.PI / 2), c: 0x3d3a44, m: T(0, 0.86, 0.25) });
    const carriage = paintMesh(parts);
    root.add(carriage);

    // --- barrel (aim → pitch → barrel)
    this.aimGroup.position.copy(PIVOT);
    root.add(this.aimGroup);
    this.aimGroup.add(this.pitchGroup);
    this.pitchGroup.rotation.x = -s.elevation;
    const L = MUZZLE - BREECH;
    const mid = (MUZZLE + BREECH) / 2;
    const bp: Part[] = [
      { g: new THREE.CylinderGeometry(0.62, 0.74, L, 30, 1, true).rotateX(Math.PI / 2), c: c.barrel, m: T(0, 0, mid) },
      { g: new THREE.CylinderGeometry(0.53, 0.64, L, 30, 1, true).rotateX(Math.PI / 2), c: c.inside ?? 0x1c1a22, m: T(0, 0, mid), inside: true },
      { g: new THREE.TorusGeometry(0.6, 0.11, 8, 30), c: c.stripe, m: T(0, 0, MUZZLE) },
      // loading funnel at the breech
      { g: new THREE.CylinderGeometry(0.74, 0.98, 0.42, 30, 1, true).rotateX(Math.PI / 2), c: c.barrel, m: T(0, 0, BREECH - 0.2) },
      { g: new THREE.CylinderGeometry(0.64, 0.9, 0.42, 30, 1, true).rotateX(Math.PI / 2), c: c.inside ?? 0x1c1a22, m: T(0, 0, BREECH - 0.2), inside: true },
      { g: new THREE.TorusGeometry(0.95, 0.07, 6, 30), c: c.stripe, m: T(0, 0, BREECH - 0.41) },
      // trunnions
      { g: new THREE.CylinderGeometry(0.16, 0.16, 1.62, 12).rotateZ(Math.PI / 2), c: c.stripe, m: T(0, 0, 0) },
    ];
    for (const z of [-0.55, 0.55, 1.65]) {
      const r = lerp(0.74, 0.62, (z - BREECH) / L) + 0.02;
      bp.push({ g: new THREE.TorusGeometry(r, 0.05, 6, 30), c: c.stripe, m: T(0, 0, z) });
    }
    // two painted "stars" (little studs) along the top
    for (const z of [-0.05, 1.1]) bp.push({ g: new THREE.SphereGeometry(0.1, 8, 6), c: c.stripe, m: T(0, lerp(0.74, 0.62, (z - BREECH) / L) + 0.02, z) });
    this.barrel = paintMesh(bp);
    this.pitchGroup.add(this.barrel);

    // --- sign
    if (s.signAt !== null) {
      const [sx, sz, sy] = s.signAt ?? [2.2, -1.5, Math.PI];
      const [bg, border] = s.signColors ?? ['#0f8a93', '#ffd23f'];
      const region = this.host.atlas.add(512, 256, drawBoard(s.sign[0], s.sign[1], bg, border));
      const signGroup = new THREE.Group();
      signGroup.position.set(sx, 0, sz);
      signGroup.rotation.y = sy; // π: readable from behind the cannon (where you load it)
      const post = paintMesh([
        { g: new THREE.BoxGeometry(0.12, 1.9, 0.12), c: 0x3d3a44, m: T(-0.8, 0.95, 0.06) },
        { g: new THREE.BoxGeometry(0.12, 1.9, 0.12), c: 0x3d3a44, m: T(0.8, 0.95, 0.06) },
        { g: new THREE.BoxGeometry(2.3, 1.2, 0.06), c: 0x1d1a26, m: T(0, 1.55, 0.02) },
      ]);
      signGroup.add(post);
      const q = this.host.atlas.quad(region, 2.2, 1.1);
      q.position.set(0, 1.55, 0.06);
      signGroup.add(q);
      root.add(signGroup);
      root.updateMatrixWorld(true);
      const c0 = signGroup.localToWorld(new THREE.Vector3(0, 1.1, 0.04));
      this.staticBox(c0, new THREE.Vector3(1.2 * this.scale, 1.1 * this.scale, 0.08 * this.scale));
    }

    // --- colliders: the wheels only (the barrel stays open so Jimothy can get in)
    root.updateMatrixWorld(true);
    for (const sx of [-1, 1]) {
      const wc = root.localToWorld(new THREE.Vector3(sx * 1.02, 0.86, 0.25));
      this.staticBox(wc, new THREE.Vector3(0.13 * this.scale, 0.84 * this.scale, 0.84 * this.scale));
    }
    this.restPoints();
  }

  private staticBox(center: THREE.Vector3, half: THREE.Vector3) {
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spec.heading);
    try {
      this.game.physics.staticBox(center, half, _q);
    } catch (err) {
      console.warn('[extras] cannon collider failed', err);
    }
  }

  /** World-space breech (entry) + muzzle at rest. */
  private restPoints() {
    this.root.updateMatrixWorld(true);
    this.barrel.localToWorld(this.breech.set(0, 0, BREECH - 0.3));
    this.barrel.localToWorld(this.muzzle.set(0, 0, MUZZLE));
  }

  /** Where Jimothy peeks out of the barrel (current barrel pose): his face just pokes out of the muzzle. */
  private insidePoint(out: THREE.Vector3, along = MUZZLE - 0.12) {
    this.root.updateMatrixWorld(true);
    return this.barrel.localToWorld(out.set(0, 0, along));
  }

  /** World direction of the barrel axis (current pose). */
  private axis(out: THREE.Vector3) {
    this.barrel.getWorldQuaternion(_q);
    return out.set(0, 0, 1).applyQuaternion(_q).normalize();
  }

  // ---------------------------------------------------------------------------------------------- trigger
  /** Is Jimothy walking into the breech? */
  wantsLoad(p: THREE.Vector3, r = 1.05 * Math.max(1, this.scale)): boolean {
    const b = this.breech;
    return Math.hypot(p.x - b.x, p.z - b.z) < r && p.y > b.y - 0.9 && p.y < b.y + 1.1;
  }

  distTo(p: THREE.Vector3) {
    return Math.hypot(p.x - this.breech.x, p.z - this.breech.z);
  }

  /** Start the sequence (or a debug launch from anywhere). */
  begin(): boolean {
    const game = this.game;
    const player = playerOf(game);
    if (!player || this.state !== 'idle' || !this.host.claim(`cannon:${this.spec.id}`)) return false;
    if (player.held) player.release(false);
    if (player.mode !== 'walk' && typeof player.setMode === 'function') player.setMode('walk');
    player.frozen = true;
    this.startPos.copy(player.position);
    this.state = 'load';
    this.t = 0;
    const s = this.spec;
    this.launchSpeed = rand(s.speed[0], s.speed[1]);
    this.launchElev = rand(s.elev[0], s.elev[1]);
    this.launchYaw = rand(-s.spread, s.spread);
    game.sfx('boing', this.breech, 0.7, 0.75);
    game.sfx('whoosh', this.breech, 0.5, 0.7);
    game.hint(`Jimothy climbs into the ${s.title}. This seems fine.`, 2.4);
    this.startCamera();
    return true;
  }

  // ---------------------------------------------------------------------------------------------- per frame
  update(dt: number) {
    const game = this.game;
    const player = playerOf(game);
    if (!player) return;
    this.t += dt;
    switch (this.state) {
      case 'idle': {
        const d = this.distTo(player.position);
        if (d < 4 && !this.host.busy && !sceneBusy(game)) prompt(game, `${this.spec.title}: walk into the barrel!`);
        if (d < 2 && !this.host.busy && !player.frozen && !sceneBusy(game) && (player.mode === 'walk' || player.mode === 'roll') && this.wantsLoad(player.position)) this.begin();
        break;
      }
      case 'load': {
        // slide in through the breech, up the barrel, until the round little face pokes out of the muzzle
        const u = clamp(this.t / 0.75, 0, 1);
        const target = _v;
        if (u < 0.35) target.copy(this.startPos).lerp(this.breech, smooth(u / 0.35));
        else this.insidePoint(target, lerp(BREECH - 0.3, MUZZLE - 0.12, smooth((u - 0.35) / 0.65)));
        this.hold(player, target, dt, 14);
        if (u >= 1) {
          this.state = 'aim';
          this.t = 0;
          this.drumT = 0;
          game.sfx('crowd_ooh', this.spec.crowd ?? this.muzzle, 0.7);
          game.hint('Aiming… (Jimothy is having second thoughts)', 2);
        }
        break;
      }
      case 'aim': {
        const dur = 2.1;
        const u = clamp(this.t / dur, 0, 1);
        const k = smooth(u);
        const w = 1 - k;
        const tt = this.t;
        this.aimGroup.rotation.y = (Math.sin(tt * 9.3) * 0.1 + Math.sin(tt * 4.1) * 0.06) * w + this.launchYaw * k;
        this.pitchGroup.rotation.x = -(this.spec.elevation + (Math.sin(tt * 7.7) * 0.07 + Math.sin(tt * 3.3) * 0.04) * w + (this.launchElev - this.spec.elevation) * k);
        this.hold(player, this.insidePoint(_v), dt, 30);
        // drumroll: rapid low taps getting louder
        this.drumT -= dt;
        if (this.drumT <= 0) {
          this.drumT = 0.055 - u * 0.012;
          game.sfx('impact_light', this.muzzle, 0.25 + u * 0.55, rand(0.5, 0.62));
        }
        if (u >= 1) this.fire();
        break;
      }
      case 'cool':
        if (this.t > 3.5) this.state = 'idle';
        break;
    }
  }

  /** Keep Jimothy at `target` (frozen, no gravity) by setting his velocity. */
  private hold(player: any, target: THREE.Vector3, dt: number, k: number) {
    const b = player.body;
    if (!b) return;
    const p = player.position as THREE.Vector3;
    const inv = 1 / Math.max(dt, 1 / 240);
    let vx = (target.x - p.x) * Math.min(inv, k);
    let vy = (target.y - p.y) * Math.min(inv, k);
    let vz = (target.z - p.z) * Math.min(inv, k);
    const sp = Math.hypot(vx, vy, vz);
    if (sp > 12) {
      vx *= 12 / sp;
      vy *= 12 / sp;
      vz *= 12 / sp;
    }
    b.setLinvel({ x: vx, y: vy, z: vz }, true);
    b.setGravityScale(0, true);
    player.facing = this.spec.heading + this.aimGroup.rotation.y;
  }

  /** Visual recoil / jolt settle (after physics so it's smooth). */
  postPhysics(dt: number) {
    if (this.recoil > 0.001 || this.jolt > 0.001) {
      this.recoil = damp(this.recoil, 0, 5, dt);
      this.jolt = damp(this.jolt, 0, 7, dt);
      this.barrel.position.z = -this.recoil;
      const back = _v2.set(Math.sin(this.spec.heading), 0, Math.cos(this.spec.heading)).multiplyScalar(-this.jolt);
      this.root.position.copy(this.spec.at).add(back);
    } else if (this.state === 'idle' || this.state === 'cool') {
      // settle the barrel back to its rest pose after a shot
      this.aimGroup.rotation.y = damp(this.aimGroup.rotation.y, 0, 2, dt);
      this.pitchGroup.rotation.x = damp(this.pitchGroup.rotation.x, -this.spec.elevation, 2, dt);
    }
  }

  // ---------------------------------------------------------------------------------------------- BOOM
  private fire() {
    const game = this.game;
    const player = playerOf(game);
    const dir = this.axis(new THREE.Vector3());
    this.root.updateMatrixWorld(true);
    const muzzle = this.barrel.localToWorld(new THREE.Vector3(0, 0, MUZZLE));
    const from = muzzle.clone().addScaledVector(dir, 0.35 * this.scale);
    const vel = dir.clone().multiplyScalar(this.launchSpeed);

    // BOOM: visuals only (no 'explosion' event → no ragdolled bystanders, no damage)
    fx(game, 'explosion', muzzle, { radius: 2.4 * this.scale });
    fx(game, 'confetti', muzzle.clone().addScaledVector(dir, 0.8), { scale: 1.6, count: 170 });
    fx(game, 'confetti', muzzle, { scale: 1.1, count: 90 });
    fx(game, 'smoke', muzzle, { scale: 1.4 });
    fx(game, 'sparkles', muzzle, { radius: 1.2, count: 20 });
    game.sfx('explosion', muzzle, 0.85, 1.15);
    game.sfx('explosion_small', muzzle, 0.9);
    game.sfx('squeak', from, 0.9, 1.3);
    game.sfx('whoosh', from, 0.8, 0.8);
    if (this.spec.crowd) {
      game.sfx('crowd_cheer', this.spec.crowd, 0.9);
      game.sfx('crowd_ooh', this.spec.crowd, 0.6);
    }
    rigOf(game)?.shake(0.9);
    if (game.camera.position.distanceTo(muzzle) < 30) uiOf(game)?.flash?.(0.28);
    this.recoil = 0.55;
    this.jolt = 0.18;
    celebrate(game, 'BOOM!', this.spec.title, '#ff8a1e');

    const cam = this.camFn;
    this.camFn = null;
    this.state = 'cool';
    this.t = 0;
    if (!player?.body) {
      releaseCamera(game, cam);
      this.host.release(`cannon:${this.spec.id}`);
      return;
    }
    player.frozen = false;
    player.body.setTranslation({ x: from.x, y: from.y, z: from.z }, true);
    player.position.copy(from);
    player.ragdoll('cannon', 1.2);
    player.body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    player.body.setLinearDamping(0.02);
    player.body.setGravityScale(player.gravityMul ?? 1, true);
    game.score(500, this.spec.title, from.clone());
    game.events.emit('cannonLaunch', { cannon: this.spec.id, title: this.spec.title, position: from.clone(), velocity: vel.clone(), speed: this.launchSpeed });
    this.host.flight.begin(this.spec.id, from, vel, cam, `cannon:${this.spec.id}`);
  }

  // ---------------------------------------------------------------------------------------------- camera
  /**
   * Cinematic camera: while loading, glide to a side view of the cannon; when aiming, cut to a low 3/4 front view
   * of the muzzle (Jimothy's worried little face poking out) with a slow push-in.
   */
  private startCamera() {
    const game = this.game;
    const rig = rigOf(game);
    if (!rig) return;
    const s = this.spec;
    const fwd = new THREE.Vector3(Math.sin(s.heading), 0, Math.cos(s.heading));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    // pick the side facing the current camera (less of a swing)
    const toCam = _v.copy(game.camera.position).sub(this.root.position);
    const side = toCam.dot(right) >= 0 ? 1 : -1;
    const mid = this.breech.clone().lerp(this.muzzle, 0.55);
    const sc = this.scale;
    const sideWant = mid.clone().addScaledVector(right, side * 7.5 * sc).addScaledVector(fwd, -1.8 * sc).add(new THREE.Vector3(0, 1.6 * sc, 0));
    clearView(game, mid, sideWant, 2);
    const frontFrom = this.muzzle.clone().addScaledVector(fwd, 6.2 * sc).addScaledVector(right, side * 4.2 * sc).add(new THREE.Vector3(0, -0.6 * sc, 0));
    const frontTo = this.muzzle.clone().addScaledVector(fwd, 4.6 * sc).addScaledVector(right, side * 3.1 * sc).add(new THREE.Vector3(0, -0.35 * sc, 0));
    aboveGround(game, frontFrom, 0.5);
    aboveGround(game, frontTo, 0.5);
    this.camLook.copy(game.camera.position).add(_v2.set(0, 0, -1).applyQuaternion(game.camera.quaternion).multiplyScalar(6));
    let front = false;
    let ft = 0;
    const fn = (cam: THREE.PerspectiveCamera, dt: number) => {
      const d = Math.min(dt, 0.1);
      if (game.paused) return;
      if (this.state === 'aim') {
        const look = this.insidePoint(_v2).add(_v.set(0, 0.15 * sc, 0));
        if (!front) {
          // cut
          front = true;
          ft = 0;
          cam.position.copy(frontFrom);
          this.camLook.copy(look);
        }
        ft += d;
        cam.position.lerpVectors(frontFrom, frontTo, smooth(ft / 2.2));
        this.camLook.lerp(look, 1 - Math.exp(-d * 10));
        cam.lookAt(this.camLook);
        cam.fov += (46 - cam.fov) * (1 - Math.exp(-d * 4));
      } else {
        const look = this.insidePoint(_v2).lerp(mid, 0.35);
        cam.position.lerp(sideWant, 1 - Math.exp(-d * 3.2));
        this.camLook.lerp(look, 1 - Math.exp(-d * 5));
        cam.lookAt(this.camLook);
        cam.fov += (54 - cam.fov) * (1 - Math.exp(-d * 3));
      }
      cam.updateProjectionMatrix();
    };
    this.camFn = fn;
    rig.override = fn;
  }

  /** Abort (finale started, respawn…): give everything back. */
  abort() {
    if (this.state === 'load' || this.state === 'aim') {
      const player = playerOf(this.game);
      if (player) player.frozen = false;
      releaseCamera(this.game, this.camFn);
      this.camFn = null;
      this.host.release(`cannon:${this.spec.id}`);
      this.state = 'cool';
      this.t = 0;
    }
  }
}

// ================================================================================================= flight tracker

/**
 * Follows a launched Jimothy: keeps him ragdolled while airborne (the controller would otherwise "get up" mid-air
 * after 3.5 s and kill his momentum), a chase camera that stays behind the flight path, a comet trail, splash
 * detection, and the landing score.
 */
export class Flight {
  active = false;
  private cannon = '';
  private claimId = '';
  private t = 0;
  private landed = false;
  private landedT = 0;
  private water = false;
  private start = new THREE.Vector3();
  private maxY = 0;
  private trailT = 0;
  private camFn: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;
  private dir = new THREE.Vector3(0, 0, 1);
  private look = new THREE.Vector3();

  constructor(private host: ExtrasHost) {}

  get game() {
    return this.host.game;
  }

  begin(cannon: string, from: THREE.Vector3, vel: THREE.Vector3, prevCam: unknown, claimId: string) {
    const game = this.game;
    this.active = true;
    this.cannon = cannon;
    this.claimId = claimId;
    this.t = 0;
    this.landed = false;
    this.water = false;
    this.start.copy(from);
    this.maxY = from.y;
    this.trailT = 0;
    this.dir.set(vel.x, 0, vel.z);
    if (this.dir.lengthSq() < 1e-4) this.dir.set(0, 0, 1);
    this.dir.normalize();
    this.look.copy(from);
    const rig = rigOf(game);
    const player = playerOf(game);
    const want = new THREE.Vector3();
    const side = new THREE.Vector3();
    const fn = (cam: THREE.PerspectiveCamera, dt: number) => {
      const d = Math.min(dt, 0.1);
      if (game.paused) return;
      const p = player.position as THREE.Vector3;
      const v = player.velocity as THREE.Vector3;
      const hs = Math.hypot(v.x, v.z);
      if (hs > 2 && !this.landed) this.dir.lerp(_v.set(v.x / hs, 0, v.z / hs), 1 - Math.exp(-d * 2)).normalize();
      side.set(this.dir.z, 0, -this.dir.x);
      // behind and a little above/beside the flight path; closer once he's down
      const back = this.landed ? 6.5 : 9.5;
      const up = this.landed ? 2.6 : 3.2 + clamp(v.y * 0.05, -1, 1.5);
      want.copy(p).addScaledVector(this.dir, -back).addScaledVector(side, 2.2).add(_v2.set(0, up, 0));
      clearView(game, p, want, 1.5);
      aboveGround(game, want, 0.6);
      // follow harder the faster he goes, so the Bay Blaster (50 m/s) doesn't leave the camera behind
      const sp = Math.hypot(v.x, v.y, v.z);
      cam.position.lerp(want, 1 - Math.exp(-d * (this.landed ? 2.5 : 4.2 + Math.min(8, sp * 0.14))));
      this.look.lerp(p, 1 - Math.exp(-d * 12));
      cam.lookAt(this.look);
      const fov = this.landed ? 58 : 70;
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-d * 3));
      cam.updateProjectionMatrix();
    };
    // keep the loading camera's view as the starting point (no jump)
    void prevCam;
    this.camFn = fn;
    if (rig) rig.override = fn;
  }

  update(dt: number) {
    if (!this.active) return;
    const game = this.game;
    const player = playerOf(game);
    if (!player) return this.end();
    this.t += dt;
    const p = player.position as THREE.Vector3;
    this.maxY = Math.max(this.maxY, p.y);

    if (!this.landed) {
      // stay a ragdoll for the whole flight (the controller gets up after 3.5 s otherwise)
      if (player.mode === 'ragdoll') player.ragdoll('cannon', 0.45);
      else if (this.t > 0.3) return this.end(); // respawned / something took over
      // comet trail
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.07;
        fx(game, 'sparkles', p, { radius: 0.35, count: 3 });
        if (Math.random() < 0.5) fx(game, 'puff', p, { scale: 0.7 });
      }
      const vol = game.get<any>('water')?.volumeAt?.(p);
      if (vol && this.t > 0.25) {
        this.water = true;
        game.events.emit('splash', { position: p.clone(), strength: 22, volume: vol });
        fx(game, 'splash', p, { strength: 22 });
        this.land();
      } else if (this.t > 0.35 && player.grounded) {
        this.land();
      }
    } else if (this.t - this.landedT > 1.6) {
      this.end();
    }
    if (this.t > 14) this.end();
  }

  private land() {
    const game = this.game;
    const player = playerOf(game);
    this.landed = true;
    this.landedT = this.t;
    const p = player.position as THREE.Vector3;
    const dist = Math.hypot(p.x - this.start.x, p.z - this.start.z);
    const height = Math.max(0, this.maxY - this.start.y);
    if (dist > 4) game.score(clamp(Math.round(dist * 5), 50, 1500), `Cannon Flight ${Math.round(dist)} m`, p.clone());
    if (this.water) {
      game.score(250, 'Splashdown!', p.clone());
      celebrate(game, 'SPLASHDOWN!', `${Math.round(dist)} m into Salmon Bay`, '#3fa7ff');
    } else if (!this.water) {
      fx(game, 'dust', p.clone().setY(p.y - 0.3), { scale: 1.8 });
      rigOf(game)?.shake(0.4);
    }
    game.events.emit('cannonLand', { cannon: this.cannon, distance: dist, height, water: this.water, position: p.clone() });
  }

  end() {
    if (!this.active) return;
    this.active = false;
    releaseCamera(this.game, this.camFn);
    this.camFn = null;
    this.host.release(this.claimId);
  }
}

// ================================================================================================= feature

/** Both cannons + the shared flight tracker. */
export class CannonFeature implements ExtrasFeature {
  readonly id = 'cannons';
  readonly list: Cannon[] = [];

  constructor(private host: ExtrasHost) {}

  get game() {
    return this.host.game;
  }

  init() {
    const game = this.game;
    // --- Tee-Hee Park: shallow left-centre field, aimed over the LF/CF wall toward Downtown
    const center = poi(game, 'stadiumCenter', new THREE.Vector3(122, 0, 118));
    const home = poi(game, 'homePlate', new THREE.Vector3(122, 0.1, 142));
    // aim NW-ish: between the left-field light tower and the scoreboard (both would be a rude stop)
    const heading = -2.62;
    const along = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    // 14 m from second base toward the aim, a bit toward home so the breech faces the infield
    const at = center.clone().addScaledVector(along, 12.5);
    at.y = surfaceAt(game, at.x, at.z, 8) ?? groundY(game, at.x, at.z, 8);
    try {
      this.list.push(
        new Cannon(this.host, {
          id: 'stadium',
          title: 'Jimothy Night Cannon',
          sign: ['JIMOTHY NIGHT CANNON', 'Raccoons only · Helmet not included'],
          signColors: ['#0f8a93', '#ffd23f'],
          colors: { barrel: 0x13a3ad, stripe: 0xffd23a, carriage: 0x1d3557, wheel: 0xffd23a },
          at,
          heading,
          elevation: 0.74,
          speed: [25, 35],
          elev: [0.68, 0.86],
          spread: 0.09,
          scale: 1,
          signAt: [2.3, -1.6, Math.PI],
          crowd: home.clone().setY(4).lerp(center, 0.3),
          target: 'Downtown',
        }),
      );
    } catch (err) {
      console.error('[extras] stadium cannon failed', err);
    }

    // --- Space Noodle deck: the Bay Blaster, pointed at Salmon Bay (south)
    try {
      const top = poi(game, 'spaceNoodleTop', new THREE.Vector3(142, 60.05, -38));
      const base = poi(game, 'spaceNoodleBase', new THREE.Vector3(143, 0, -38));
      // the noodle's axis: top POI is 8 m west of it, base POI 7 m west
      const nx = top.x + 8;
      const nz = top.z;
      void base;
      const deckFrom = top.y + 3;
      const r = 7.6;
      const ax = nx;
      const az = nz + r;
      const deckY = surfaceAt(game, ax, az, deckFrom, 8) ?? top.y - 0.05;
      if (deckY > 20) {
        this.list.push(
          new Cannon(this.host, {
            id: 'noodle',
            title: 'Bay Blaster',
            sign: ['BAY BLASTER', 'Aim: Salmon Bay · Splash guaranteed*'],
            signColors: ['#d4312b', '#ffffff'],
            colors: { barrel: 0xe8e2d6, stripe: 0xd4312b, carriage: 0xd4312b, wheel: 0xf5d98a },
            at: new THREE.Vector3(ax, deckY, az),
            heading: 0,
            elevation: 0.45,
            speed: [48, 54],
            elev: [0.4, 0.5],
            spread: 0.1,
            scale: 0.72,
            trail: 0.7,
            // beside the west wheel near the railing, parallel to the deck walkway, facing the restaurant
            signAt: [-2.35, 1.3, Math.PI],
            target: 'Salmon Bay',
          }),
        );
      }
    } catch (err) {
      console.error('[extras] noodle cannon failed', err);
    }
    for (const c of this.list) game.get<any>('world')?.poi?.set(`cannon:${c.spec.id}`, c.breech.clone());
  }

  update(dt: number) {
    for (const c of this.list) c.update(dt);
    this.host.flight.update(dt);
  }

  postPhysics(dt: number) {
    for (const c of this.list) c.postPhysics(dt);
  }

  get(id: string) {
    return this.list.find((c) => c.spec.id === id);
  }

  /** Debug/test: teleport next to a cannon's breech and fire it. */
  launch(id = 'stadium') {
    const c = this.get(id);
    const player = playerOf(this.game);
    if (!c || !player) return false;
    player.teleport(c.breech.clone().add(new THREE.Vector3(0, 0.45, 0)), c.spec.heading);
    return c.begin();
  }

  abort() {
    for (const c of this.list) c.abort();
    this.host.flight.end();
  }
}
