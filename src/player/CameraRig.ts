import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import { G, groups } from '../core/Physics';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

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

  init(game: Game) {
    this.game = game;
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

    const target = this.follow ? this.follow() : (game.get<any>('player')?.cameraTarget as THREE.Vector3 | undefined);
    if (!target) return;
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
    const hit = game.physics.sphereCast(this.pivot, _dir, 0.22, dist, groups(G.ALL, G.WORLD | G.VEHICLE), player?.body, (c) => !game.physics.isThin(c));
    if (hit) dist = Math.max(0.5, hit.distance - 0.05);
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
    _v.copy(this.pivot);
    cam.lookAt(_v);

    // Speed FOV kick
    const speed = player?.speed ?? 0;
    const fov = this.baseFov + THREE.MathUtils.clamp(speed - 7, 0, 18) * 0.7;
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4));
    // NaN guards: one bad frame must never poison the camera forever
    if (!Number.isFinite(cam.fov)) cam.fov = this.baseFov;
    if (!Number.isFinite(cam.position.x + cam.position.y + cam.position.z)) {
      this.pivot.copy(target);
      cam.position.copy(target).add(_v.set(0, 2, 5));
      cam.lookAt(target);
    }
    if (!Number.isFinite(this.distance)) this.distance = this.targetDistance;
    cam.updateProjectionMatrix();
  }
}
