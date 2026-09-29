import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import { G, groups } from '../core/Physics';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dir2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Third-person orbit camera with collision, zoom, shake and speed FOV kick. */
export class CameraRig implements System {
  name = 'camera';
  yaw = 0;
  pitch = -0.3;
  distance = 4.8;
  targetDistance = 4.8;
  minDistance = 1.6;
  maxDistance = 16;
  readonly pivot = new THREE.Vector3();
  private pivotInit = false;
  private shakeAmt = 0;
  private shakeT = 0;
  baseFov = 62;
  /** When set, the camera is driven externally (cutscenes). */
  override: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;
  private ceilT = 0;
  private ceilY = Infinity;
  /** Target to follow; defaults to the player. */
  follow: (() => THREE.Vector3) | null = null;
  private game!: Game;
  /**
   * Feel: gently swing the camera behind Jimothy while he runs/rolls forward and the player hasn't touched the camera
   * for a moment. Subtle on purpose; set false to disable.
   */
  autoFollow = true;
  /** Seconds since the last manual camera input (mouse / right stick / touch drag). */
  private lookIdle = 0;
  // Feel: directional camera kick (spring) + FOV punch, layered on top of the follow camera.
  private kickX = new THREE.Vector3();
  private kickV = new THREE.Vector3();
  private fovPunch = 0;
  private fovSmooth = NaN;

  init(game: Game) {
    this.game = game;
  }

  /**
   * True when the "Reduce flashing & shake" setting is on: ui/settings.ts swallows shake() by shadowing it with an
   * own property on this instance, so kicks / FOV punches follow the same switch.
   */
  get motionReduced() {
    return this.shake !== CameraRig.prototype.shake;
  }

  /** Feel: a short punch of the camera (bonks, impacts). `dir` = world direction to shove it (default: down). */
  kick(amount: number, dir?: THREE.Vector3) {
    if (this.motionReduced || !(amount > 0)) return;
    const a = Math.min(1, amount);
    if (dir && dir.lengthSq() > 1e-6) this.kickV.addScaledVector(_v.copy(dir).normalize(), a * 2.6);
    else this.kickV.y -= a * 2.2;
    this.fovPunch = Math.min(8, this.fovPunch + a * 3.5);
  }

  /** Feel: brief field-of-view "whoomp" in degrees (negative zooms in). */
  punchFov(deg: number) {
    if (this.motionReduced) return;
    this.fovPunch = THREE.MathUtils.clamp(this.fovPunch + deg, -8, 8);
  }

  /** Flat forward direction the camera is looking (for camera-relative movement). */
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  right(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  shake(amount: number) {
    this.shakeAmt = Math.min(1.2, this.shakeAmt + amount);
  }

  snapBehind(facing: number) {
    this.yaw = facing + Math.PI;
    this.lookIdle = 0; // a deliberate camera placement: auto-follow waits before easing in again
  }

  lateUpdate(dt: number, game: Game) {
    const cam = game.camera;
    if (this.override) {
      this.override(cam, dt);
      return;
    }
    const inp = game.input;
    if (!game.paused) {
      this.yaw -= inp.look.x;
      this.pitch -= inp.look.y;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 0.75);
      if (inp.wheel) this.targetDistance = THREE.MathUtils.clamp(this.targetDistance * (1 + inp.wheel * 0.12), this.minDistance, this.maxDistance);
    }
    this.lookIdle = Math.abs(inp.look.x) + Math.abs(inp.look.y) > 1e-5 ? 0 : this.lookIdle + dt;

    const target = this.follow ? this.follow() : (game.get<any>('player')?.cameraTarget as THREE.Vector3 | undefined);
    if (!target) return;
    this.updateAutoFollow(dt, game);
    if (!this.pivotInit) {
      this.pivot.copy(target);
      this.pivotInit = true;
    }
    // Follow with slight lag (more lag vertically so jumps feel bouncy)
    const kxz = 1 - Math.exp(-dt * 14);
    const ky = 1 - Math.exp(-dt * 8);
    this.pivot.x += (target.x - this.pivot.x) * kxz;
    this.pivot.z += (target.z - this.pivot.z) * kxz;
    this.pivot.y += (target.y - this.pivot.y) * ky;
    if (this.pivot.distanceToSquared(target) > 100) this.pivot.copy(target);

    const player = game.get<any>('player');
    // Low ceilings (the den under Mom's porch, decks, tunnels): keep the pivot under the ceiling and flatten the
    // camera so it looks along the gap instead of jamming into the boards above.
    let pitch = this.pitch;
    if (!this.follow && player?.position) {
      this.ceilT -= dt;
      if (this.ceilT <= 0) {
        this.ceilT = 0.1;
        const up = game.physics.raycast(player.position, _v.set(0, 1, 0), 2.4, groups(G.ALL, G.WORLD), player.body, (c) => !game.physics.isThin(c));
        this.ceilY = up ? up.point.y : Infinity;
      }
      if (Number.isFinite(this.ceilY)) {
        const maxPivot = this.ceilY - 0.3;
        if (this.pivot.y > maxPivot) this.pivot.y = Math.max(player.position.y, maxPivot);
        const maxRise = this.ceilY - 0.25 - this.pivot.y;
        const d = Math.max(0.5, this.targetDistance);
        if (-Math.sin(pitch) * d > maxRise) pitch = -Math.asin(THREE.MathUtils.clamp(maxRise / d, -0.4, 1));
      }
    }

    _dir.set(Math.sin(this.yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    // Collision: pull the camera in front of walls
    let dist = this.targetDistance;
    // Ignore thin things (lamp posts, poles, trunks) so the camera doesn't pump in and out on busy streets
    const camFilter = groups(G.ALL, G.WORLD | G.VEHICLE);
    const notThin = (c: any) => !game.physics.isThin(c);
    const hit = game.physics.sphereCast(this.pivot, _dir, 0.22, dist, camFilter, player?.body, notThin);
    if (hit) dist = Math.max(0.5, hit.distance - 0.05);
    // Feel pass: back to a wall (the camera would sit inside it at its 0.5 m minimum): swing up over his head instead
    if (hit && hit.distance < 1.0) {
      const up = (1 - hit.distance / 1.0) * 0.85;
      _dir2.copy(_dir).lerp(_up, up).normalize();
      const hit2 = game.physics.sphereCast(this.pivot, _dir2, 0.22, this.targetDistance, camFilter, player?.body, notThin);
      const d2 = hit2 ? hit2.distance - 0.05 : this.targetDistance;
      if (d2 > dist + 0.05) {
        _dir.copy(_dir2);
        dist = Math.max(0.5, d2);
      } else if (hit.distance < 0.55) dist = Math.max(0.2, hit.distance - 0.05);
    }
    // Zoom out smoothly, snap in quickly
    this.distance = dist < this.distance ? dist : this.distance + (dist - this.distance) * (1 - Math.exp(-dt * 3));

    cam.position.copy(this.pivot).addScaledVector(_dir, this.distance);
    // Never go below the ground right under the camera
    const ground = game.get<any>('world')?.heightAt?.(cam.position.x, cam.position.z);
    if (typeof ground === 'number' && cam.position.y < ground + 0.3) cam.position.y = ground + 0.3;

    // Shake
    if (this.shakeAmt > 0.001) {
      this.shakeT += dt * 38;
      const s = this.shakeAmt * this.shakeAmt * 0.25;
      cam.position.x += Math.sin(this.shakeT * 1.1) * s;
      cam.position.y += Math.sin(this.shakeT * 1.7 + 1) * s;
      cam.position.z += Math.sin(this.shakeT * 1.3 + 2) * s;
      this.shakeAmt *= Math.exp(-dt * 5);
    }
    // Feel: kick spring (slightly under-damped so a bonk "thunks" and settles within ~0.25 s)
    if (this.kickX.lengthSq() > 1e-8 || this.kickV.lengthSq() > 1e-8) {
      const h = Math.min(dt, 1 / 30);
      this.kickV.addScaledVector(this.kickX, -260 * h).multiplyScalar(Math.exp(-h * 16));
      this.kickX.addScaledVector(this.kickV, h);
      if (this.kickX.length() > 0.35) this.kickX.setLength(0.35);
      cam.position.add(this.kickX);
    }
    _v.copy(this.pivot);
    cam.lookAt(_v);

    // Speed FOV kick (+ feel punch, decays fast)
    const speed = player?.speed ?? 0;
    const fov = this.baseFov + THREE.MathUtils.clamp(speed - 7, 0, 18) * 0.7;
    if (!Number.isFinite(this.fovSmooth)) this.fovSmooth = Number.isFinite(cam.fov) ? cam.fov : this.baseFov;
    this.fovSmooth += (fov - this.fovSmooth) * (1 - Math.exp(-dt * 4));
    this.fovPunch *= Math.exp(-dt * 9);
    if (Math.abs(this.fovPunch) < 0.01) this.fovPunch = 0;
    cam.fov = this.fovSmooth + this.fovPunch;
    // NaN guards: one bad frame must never poison the camera forever
    if (!Number.isFinite(cam.fov)) {
      cam.fov = this.fovSmooth = this.baseFov;
      this.fovPunch = 0;
    }
    if (!Number.isFinite(this.kickX.x + this.kickX.y + this.kickX.z + this.kickV.x + this.kickV.y + this.kickV.z)) {
      this.kickX.set(0, 0, 0);
      this.kickV.set(0, 0, 0);
    }
    if (!Number.isFinite(cam.position.x + cam.position.y + cam.position.z)) {
      this.pivot.copy(target);
      cam.position.copy(target).add(_v.set(0, 2, 5));
      cam.lookAt(target);
    }
    if (!Number.isFinite(this.distance)) this.distance = this.targetDistance;
    cam.updateProjectionMatrix();
  }

  /**
   * Feel: subtle auto-follow. After ~1.2 s without manual camera input, while Jimothy moves forward-ish (or rolls on
   * his own momentum), ease the yaw toward "behind his motion". Never while climbing/hanging/ragdolling, never when
   * running at the camera, and strafing doesn't swing it (so camera-relative steering stays predictable).
   */
  private updateAutoFollow(dt: number, game: Game) {
    if (!this.autoFollow || this.follow || game.paused || game.state !== 'playing') return;
    const player = game.get<any>('player');
    if (!player || player.frozen || this.lookIdle < 1.2) return;
    const mode = player.mode as string;
    if (mode !== 'walk' && mode !== 'roll' && mode !== 'swim') return;
    const v = player.velocity as THREE.Vector3;
    const sp = Math.hypot(v.x, v.z);
    if (!(sp > 2.5)) return;
    const mv = game.input.move;
    const weight = mv.lengthSq() < 0.01 ? (mode === 'roll' ? 1 : 0) : THREE.MathUtils.clamp(mv.y, 0, 1);
    if (weight <= 0) return;
    let d = Math.atan2(v.x, v.z) + Math.PI - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 2.3) return;
    const rate = 1.1 * weight * Math.min(1, (sp - 2.5) / 6) * Math.min(1, (this.lookIdle - 1.2) / 0.8);
    this.yaw += d * (1 - Math.exp(-dt * rate));
  }
}
