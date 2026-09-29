import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { RAPIER, G, groups } from '../../core/Physics';
import type { Entity } from '../../core/Entities';
import type { ExtrasFeature, ExtrasHost } from './host';
import {
  T,
  TR,
  paintMesh,
  bulbMat,
  mergeParts,
  drawBoard,
  poi,
  playerOf,
  rigOf,
  sceneBusy,
  releaseCamera,
  prompt,
  celebrate,
  fx,
  clamp,
  smooth,
  damp,
  dampAngle,
  lerp,
  type Part,
} from './shared';

/**
 * THE PRETTY GOOD WHEEL — Express Gondola.
 *
 * The waterfront Ferris wheel is static batched scenery (Waterfront.ts), so the ride is an extra: a rotating
 * "express arm" mounted on the front of the hub (on the bay side, outside the rim) with a gondola at each end
 * (one for Jimothy, one empty counterweight). Hop into the gondola waiting at the bottom → one full loop with a
 * pause at the top for the view over Salmon Bay → dropped off at the bottom. Jump to bail out (not recommended).
 *
 * Jimothy stands on a real kinematic floor (so the controller stays "grounded": no fake falls / flights for the
 * objectives) while the ride steers his velocity along the loop.
 *
 * Events: 'wheelBoard' {}, 'wheelTop' {}, 'wheelRide' { completed } · Score: "Pretty Good View" (+300).
 */

// Waterfront.ts builds the wheel at hub (cx, 16, cz) with R = 13 and POI prettyGoodWheel = (cx, 0.5, cz - 5).
const HUB_Y = 16;
const R = 13;
/** Pin (arm end) → cabin floor top. Floor top sits ~0.46 m up at the bottom = flush with the platform. */
const HANG = 2.54;
const ARM_DZ = 3.0;
const CAB_DZ = 3.7;

const UP_T = 11;
const TOP_T = 3.5;
const WAIT_T = 1.0;
const RIDE_T = WAIT_T + UP_T + TOP_T + UP_T;

type State = 'idle' | 'boarding' | 'riding' | 'return' | 'cool';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class WheelRide implements ExtrasFeature {
  readonly id = 'wheel';
  cx = 36;
  cz = 128;
  private arm = new THREE.Group();
  private cabins: THREE.Group[] = [];
  private floorBody: RAPIER_T.RigidBody | null = null;
  floorEntity: Entity | null = null;
  /** Rider cabin angle around the hub (−π/2 = bottom). */
  theta = -Math.PI / 2;
  private prevTheta = -Math.PI / 2;
  private omega = 0;
  private sway = [0, 0];
  state: State = 'idle';
  private t = 0;
  private rideT = 0;
  private topDone = false;
  private camFn: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;
  private camPsi = 0.55;
  private camLook = new THREE.Vector3();
  private boardFrom = new THREE.Vector3();
  private ready = false;

  constructor(private host: ExtrasHost) {}

  get game() {
    return this.host.game;
  }

  init() {
    const game = this.game;
    const p = poi(game, 'prettyGoodWheel', new THREE.Vector3(36, 0.5, 123));
    this.cx = p.x;
    this.cz = p.z + 5;
    this.buildVisuals();
    this.buildFloor();
    this.ready = true;
    game.get<any>('world')?.poi?.set('wheelGondola', this.seat(-Math.PI / 2, new THREE.Vector3()));
    this.placeVisuals(0);
  }

  // ------------------------------------------------------------------------------------------- geometry
  pin(theta: number, out: THREE.Vector3) {
    return out.set(this.cx + Math.cos(theta) * R, HUB_Y + Math.sin(theta) * R, this.cz + CAB_DZ);
  }
  /** Cabin floor-top centre. */
  floorTop(theta: number, out: THREE.Vector3) {
    return this.pin(theta, out).setY(HUB_Y + Math.sin(theta) * R - HANG);
  }
  /** Where Jimothy's centre sits. */
  seat(theta: number, out: THREE.Vector3) {
    return this.floorTop(theta, out).add(_v2.set(0, 0.43, 0.12));
  }

  private buildVisuals() {
    const game = this.game;
    const white = 0xf7f7f2;
    const gold = 0xffd23a;
    const teal = 0x19a6b0;
    // --- rotating arm (hub disc + beam through the hub, bulbs)
    this.arm.position.set(this.cx, HUB_Y, this.cz + ARM_DZ);
    const ap: Part[] = [
      { g: new THREE.CylinderGeometry(1.15, 1.15, 0.34, 28).rotateX(Math.PI / 2), c: gold },
      { g: new THREE.CylinderGeometry(0.55, 0.55, 0.5, 20).rotateX(Math.PI / 2), c: teal, m: T(0, 0, 0.1) },
      { g: new THREE.BoxGeometry(R * 2 + 0.6, 0.36, 0.2), c: white },
      { g: new THREE.BoxGeometry(R * 2 - 1, 0.12, 0.26), c: teal },
    ];
    for (const s of [-1, 1]) {
      // pins sticking out toward the cabins
      ap.push({ g: new THREE.CylinderGeometry(0.11, 0.11, CAB_DZ - ARM_DZ + 0.2, 10).rotateX(Math.PI / 2), c: 0x9aa3ad, m: T(s * R, 0, (CAB_DZ - ARM_DZ) / 2) });
      ap.push({ g: new THREE.SphereGeometry(0.22, 12, 8), c: gold, m: T(s * R, 0, 0) });
    }
    const arm = paintMesh(ap);
    this.arm.add(arm);
    const bulbParts: Part[] = [];
    for (let i = -6; i <= 6; i++) {
      if (i === 0) continue;
      bulbParts.push({ g: new THREE.SphereGeometry(0.11, 8, 6), c: i % 2 ? 0xfff0b0 : 0xffc0e0, m: T((i / 6.5) * R, 0.24, 0.05) });
    }
    const bulbs = new THREE.Mesh(mergeParts(bulbParts), bulbMat());
    this.arm.add(bulbs);
    game.scene.add(this.arm);

    // --- two cabins (rider = teal/gold "Raccoon Class", counterweight = red)
    const signR = this.host.atlas.add(512, 160, drawBoard('RACCOON CLASS', 'Express Gondola', '#19a6b0', '#ffd23f'));
    for (let k = 0; k < 2; k++) {
      const body = k === 0 ? teal : 0xe63946;
      const trim = k === 0 ? gold : white;
      const parts: Part[] = [
        // floor + skirt
        { g: new THREE.BoxGeometry(2.0, 0.12, 1.7), c: 0x6e4a2a, m: T(0, -0.06, 0) },
        { g: new THREE.BoxGeometry(2.1, 0.36, 1.8), c: body, m: T(0, -0.3, 0) },
        // back wall (wheel side) + low side walls + low front rail (open view to the bay)
        { g: new THREE.BoxGeometry(2.0, 1.55, 0.1), c: body, m: T(0, 0.78, -0.82) },
        { g: new THREE.BoxGeometry(0.1, 0.6, 1.7), c: body, m: T(-0.97, 0.3, 0) },
        { g: new THREE.BoxGeometry(0.1, 0.6, 1.7), c: body, m: T(0.97, 0.3, 0) },
        { g: new THREE.BoxGeometry(2.0, 0.08, 0.08), c: trim, m: T(0, 0.62, 0.82) },
        // corner posts + roof + hanger
        { g: new THREE.BoxGeometry(2.3, 0.14, 2.0), c: trim, m: T(0, 1.95, 0) },
        { g: new THREE.ConeGeometry(1.35, 0.4, 4).rotateY(Math.PI / 4), c: body, m: TR(0, 2.2, 0, 0, 0, 0, [1.2, 1, 1]) },
        { g: new THREE.CylinderGeometry(0.06, 0.06, HANG - 2.2, 8), c: 0x9aa3ad, m: T(0, 2.2 + (HANG - 2.2) / 2, 0) },
        { g: new THREE.TorusGeometry(0.14, 0.04, 6, 12), c: 0x9aa3ad, m: T(0, HANG, 0) },
      ];
      for (const [x, z] of [[-0.97, -0.82], [0.97, -0.82], [-0.97, 0.82], [0.97, 0.82]]) {
        parts.push({ g: new THREE.BoxGeometry(0.09, 1.9, 0.09), c: trim, m: T(x, 0.95, z) });
      }
      const g = new THREE.Group();
      g.add(paintMesh(parts));
      if (k === 0) {
        const q = this.host.atlas.quad(signR, 1.6, 0.5);
        q.position.set(0, 1.25, -0.76);
        g.add(q);
      }
      const cb: Part[] = [];
      for (let i = 0; i < 5; i++) cb.push({ g: new THREE.SphereGeometry(0.06, 6, 5), c: 0xfff0b0, m: T(-0.9 + i * 0.45, 1.86, 0.95) });
      g.add(new THREE.Mesh(mergeParts(cb), bulbMat()));
      game.scene.add(g);
      this.cabins.push(g);
    }

    // --- signs: at the boarding spot (bay side) and a pointer on the boardwalk side
    const board = this.host.atlas.add(512, 256, drawBoard('EXPRESS GONDOLA', 'Raccoon Class · Hop in!', '#1d6fa3', '#ffd23f'));
    const hint = this.host.atlas.add(512, 256, drawBoard('EXPRESS GONDOLA ⟳', 'Board round the back (bay side)', '#1d6fa3', '#ffd23f'));
    const mk = (region: number, x: number, z: number, rotY: number) => {
      const grp = new THREE.Group();
      grp.position.set(x, 0.4, z);
      grp.rotation.y = rotY;
      grp.add(
        paintMesh([
          { g: new THREE.BoxGeometry(0.1, 1.7, 0.1), c: 0x1d3557, m: T(-0.65, 0.85, 0) },
          { g: new THREE.BoxGeometry(0.1, 1.7, 0.1), c: 0x1d3557, m: T(0.65, 0.85, 0) },
          { g: new THREE.BoxGeometry(1.7, 0.9, 0.05), c: 0x1d3557, m: T(0, 1.45, -0.03) },
        ]),
      );
      const q = this.host.atlas.quad(region, 1.6, 0.8);
      q.position.set(0, 1.45, 0.005);
      grp.add(q);
      game.scene.add(grp);
    };
    mk(board, this.cx - 2.3, this.cz + 4.35, 0);
    mk(hint, this.cx - 3.2, this.cz - 4.65, Math.PI);
  }

  private buildFloor() {
    const game = this.game;
    const p = this.floorTop(this.theta, new THREE.Vector3());
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y - 0.06, p.z);
    const cd = RAPIER.ColliderDesc.cuboid(0.95, 0.06, 0.8).setFriction(1).setCollisionGroups(groups(G.PROP, G.ALL));
    this.floorBody = game.physics.createBody(desc, [cd]);
    this.floorEntity = game.entities.create({
      kind: 'prop',
      name: 'Express Gondola',
      body: this.floorBody,
      mass: 400,
      tags: new Set(['noclimb', 'gondola']),
      data: { velocity: new THREE.Vector3(), gondola: true },
    });
  }

  // ------------------------------------------------------------------------------------------- ride
  private rideAngle(t: number) {
    const a0 = -Math.PI / 2;
    if (t < WAIT_T) return a0;
    if (t < WAIT_T + UP_T) return a0 + Math.PI * smooth((t - WAIT_T) / UP_T);
    if (t < WAIT_T + UP_T + TOP_T) return Math.PI / 2;
    if (t < RIDE_T) return Math.PI / 2 + Math.PI * smooth((t - WAIT_T - UP_T - TOP_T) / UP_T);
    return a0 + Math.PI * 2;
  }

  board(): boolean {
    const game = this.game;
    const player = playerOf(game);
    if (!player || this.state !== 'idle' || !this.host.claim('wheel')) return false;
    if (player.held) player.release(false);
    if (player.mode !== 'walk' && typeof player.setMode === 'function') player.setMode('walk');
    player.frozen = true;
    this.boardFrom.copy(player.position);
    this.state = 'boarding';
    this.t = 0;
    this.rideT = 0;
    this.topDone = false;
    game.sfx('creak', this.pin(this.theta, _v), 0.8, 1.1);
    game.sfx('happy', player.position, 0.6, 1.1);
    game.hint('All aboard the Pretty Good Wheel! (Jump to bail out. Not recommended.)', 3.5);
    game.events.emit('wheelBoard', {});
    this.startCamera();
    return true;
  }

  update(dt: number) {
    if (!this.ready || !this.floorBody) return;
    const game = this.game;
    const player = playerOf(game);
    this.t += dt;
    const safeDt = Math.max(dt, 1 / 240);

    // --- advance the arm
    let next = this.theta;
    if (this.state === 'riding' || this.state === 'return' || this.state === 'boarding') {
      if (this.state !== 'boarding') this.rideT += dt;
      next = this.rideAngle(this.rideT);
    }
    const floorNow = this.floorTop(this.theta, _v).clone();
    const floorNext = this.floorTop(next, _v);
    this.floorBody.setNextKinematicTranslation({ x: floorNext.x, y: floorNext.y - 0.06, z: floorNext.z });
    const vel = this.floorEntity!.data.velocity as THREE.Vector3;
    vel.copy(floorNext).sub(floorNow).divideScalar(safeDt);
    this.prevTheta = this.theta;
    this.theta = next;
    this.omega = (this.theta - this.prevTheta) / safeDt;

    if (!player) return;
    switch (this.state) {
      case 'idle': {
        const seat = this.seat(this.theta, _v);
        const d = Math.hypot(player.position.x - seat.x, player.position.z - seat.z);
        if (d < 5 && !this.host.busy && !sceneBusy(game)) prompt(game, 'Express Gondola: hop in for a Pretty Good View');
        const onFloor = player.groundEntity === this.floorEntity;
        const inside = d < 0.9 && Math.abs(player.position.y - seat.y) < 0.7;
        if ((onFloor || inside) && player.mode === 'walk' && !player.frozen && !this.host.busy && !sceneBusy(game)) this.board();
        break;
      }
      case 'boarding': {
        const u = clamp(this.t / 0.5, 0, 1);
        const target = _v.copy(this.boardFrom).lerp(this.seat(this.theta, _v2), smooth(u));
        this.steer(player, target, safeDt);
        if (u >= 1) {
          this.state = 'riding';
          this.t = 0;
        }
        break;
      }
      case 'riding': {
        this.steer(player, this.seat(this.theta, _v), safeDt);
        player.facing = dampAngle(player.facing, 0, 3, dt); // look out over the bay (+Z)
        if (!this.topDone && this.rideT >= WAIT_T + UP_T) {
          this.topDone = true;
          game.score(300, 'Pretty Good View', player.position.clone());
          celebrate(game, 'PRETTY GOOD VIEW', 'It is, in fact, pretty good.', '#19c2b8');
          game.sfx('jingle_win', undefined, 0.6);
          fx(game, 'sparkles', player.position.clone().setY(player.position.y + 0.5), { radius: 1.2, count: 24 });
          game.events.emit('wheelTop', {});
        }
        if (this.t > 1.2 && game.input.pressed('jump')) {
          this.dismount(false);
          break;
        }
        if (this.rideT >= RIDE_T) this.dismount(true);
        break;
      }
      case 'return':
        if (this.rideT >= RIDE_T) this.finishLoop();
        break;
      case 'cool':
        if (this.t > 4) this.state = 'idle';
        break;
    }
  }

  /** Steer Jimothy's velocity so he ends this step at `target` (no gravity; the floor keeps him grounded). */
  private steer(player: any, target: THREE.Vector3, dt: number) {
    const b = player.body;
    if (!b) return;
    const p = player.position as THREE.Vector3;
    let vx = (target.x - p.x) / dt;
    let vy = (target.y - p.y) / dt;
    let vz = (target.z - p.z) / dt;
    const sp = Math.hypot(vx, vy, vz);
    if (sp > 10) {
      vx *= 10 / sp;
      vy *= 10 / sp;
      vz *= 10 / sp;
    }
    b.setLinvel({ x: vx, y: vy, z: vz }, true);
    b.setGravityScale(0, true);
  }

  private dismount(completed: boolean) {
    const game = this.game;
    const player = playerOf(game);
    const vel = this.floorEntity!.data.velocity as THREE.Vector3;
    if (player?.body) {
      player.frozen = false;
      player.body.setGravityScale(player.gravityMul ?? 1, true);
      if (completed) player.body.setLinvel({ x: 2.6, y: 3.6, z: 0.4 }, true);
      else player.body.setLinvel({ x: vel.x, y: vel.y + 6, z: vel.z + 3.5 }, true);
      if (!completed) game.sfx('jump', player.position, 0.6);
    }
    releaseCamera(game, this.camFn);
    this.camFn = null;
    this.host.release('wheel');
    game.events.emit('wheelRide', { completed });
    if (completed) {
      game.hint('Jimothy rates the Pretty Good Wheel: pretty good.', 2.8);
      this.finishLoop();
    } else {
      game.hint('Jimothy has left the ride early. The staff are "concerned".', 3);
      this.state = 'return';
    }
  }

  private finishLoop() {
    this.theta = -Math.PI / 2;
    this.rideT = 0;
    this.state = 'cool';
    this.t = 0;
  }

  // ------------------------------------------------------------------------------------------- visuals
  postPhysics(dt: number) {
    if (!this.ready) return;
    this.placeVisuals(dt);
  }

  private placeVisuals(dt: number) {
    this.arm.rotation.z = this.theta;
    for (let k = 0; k < 2; k++) {
      const a = this.theta + k * Math.PI;
      const c = this.cabins[k];
      this.floorTop(a, c.position);
      // a little pendulum sway from the arm's angular speed
      this.sway[k] = dt > 0 ? damp(this.sway[k], clamp(-this.omega * 0.35, -0.25, 0.25), 2.5, dt) : 0;
      c.rotation.z = this.sway[k];
    }
    const night = this.game.get<any>('environment')?.nightFactor ?? 0;
    const bm = bulbMat();
    const b = 0.6 + night * 1.8;
    bm.color.setRGB(b * 1.1, b, b * 0.8);
  }

  // ------------------------------------------------------------------------------------------- camera
  private startCamera() {
    const game = this.game;
    const rig = rigOf(game);
    if (!rig) return;
    this.camPsi = 0.55;
    this.camLook.copy(game.camera.position).add(_v.set(0, 0, -1).applyQuaternion(game.camera.quaternion).multiplyScalar(5));
    const seat = new THREE.Vector3();
    const want = new THREE.Vector3();
    const look = new THREE.Vector3();
    const fn = (cam: THREE.PerspectiveCamera, dt: number) => {
      const d = Math.min(dt, 0.1);
      if (game.paused) return;
      this.seat(this.theta, seat);
      // progress around the loop 0..1 → the camera swings from the bay side, around the outside of the wheel,
      // over the top (behind Jimothy, looking out to sea) and down the other side
      const f = clamp((this.theta + Math.PI / 2) / (Math.PI * 2), 0, 1);
      const keys = [0.55, 1.3, Math.PI, Math.PI * 2 - 1.3, Math.PI * 2 - 0.55];
      const i = Math.min(3, Math.floor(f * 4));
      const psi = lerp(keys[i], keys[i + 1], smooth(f * 4 - i));
      this.camPsi = damp(this.camPsi, psi, 2.5, d);
      const s = Math.sin(Math.PI * f);
      const dist = 7.5 + 2.5 * s;
      const h = 1.5 + 3 * s;
      want.set(seat.x + Math.sin(this.camPsi) * dist, seat.y + h, seat.z + Math.cos(this.camPsi) * dist);
      look.copy(seat).lerp(_v.set(seat.x, seat.y - 4, seat.z + 30), 0.18 + 0.3 * s);
      cam.position.lerp(want, 1 - Math.exp(-d * (this.state === 'boarding' ? 2.5 : 4)));
      this.camLook.lerp(look, 1 - Math.exp(-d * 5));
      cam.lookAt(this.camLook);
      cam.fov += (56 - cam.fov) * (1 - Math.exp(-d * 2));
      cam.updateProjectionMatrix();
    };
    this.camFn = fn;
    rig.override = fn;
  }

  /** Abort (finale): drop Jimothy at the bottom, return the camera. */
  abort() {
    if (this.state === 'boarding' || this.state === 'riding') {
      const player = playerOf(this.game);
      if (player) {
        player.frozen = false;
        player.body?.setGravityScale(player.gravityMul ?? 1, true);
      }
      releaseCamera(this.game, this.camFn);
      this.camFn = null;
      this.host.release('wheel');
      this.state = 'return';
    }
  }
}
