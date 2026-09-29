import * as THREE from 'three';
import { rand } from './util';

/**
 * Tiny self-contained particle helper for the slop content (server sparks, portal glitter, NFT sparkle).
 * One Points draw call, ballistic particles, additive. The shared FX system handles the fancy stuff
 * ('slopDissolve', 'explosion', ...); this just makes sure SlopCorp can always spark.
 */
export class SlopFx {
  readonly points: THREE.Points;
  private cap: number;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private base: Float32Array;
  private grav: Float32Array;
  private next = 0;
  private live = 0;

  constructor(scene: THREE.Scene, cap = 600) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.base = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    for (let i = 0; i < cap; i++) this.pos[i * 3 + 1] = -9999;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.PointsMaterial({
      size: 0.16,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.name = 'SlopSparks';
    this.points.renderOrder = 5;
    this.points.userData.slopOwned = true;
    scene.add(this.points);
  }

  /** Spray `n` particles from `p`. color: THREE color (HDR values > 1 bloom). */
  burst(p: THREE.Vector3, n: number, color: THREE.ColorRepresentation, speed = 5, up = 3, life = 0.8, gravity = 14, spread = 0.1) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      const a = Math.random() * Math.PI * 2;
      const e = rand(-0.3, 1);
      const s = speed * rand(0.35, 1);
      this.pos[i * 3] = p.x + rand(-spread, spread);
      this.pos[i * 3 + 1] = p.y + rand(-spread, spread);
      this.pos[i * 3 + 2] = p.z + rand(-spread, spread);
      this.vel[i * 3] = Math.cos(a) * Math.cos(e) * s;
      this.vel[i * 3 + 1] = Math.sin(e) * s + up * rand(0.5, 1);
      this.vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * s;
      const k2 = rand(0.7, 1.3);
      this.base[i * 3] = c.r * k2;
      this.base[i * 3 + 1] = c.g * k2;
      this.base[i * 3 + 2] = c.b * k2;
      this.maxLife[i] = life * rand(0.6, 1.2);
      this.life[i] = this.maxLife[i];
      this.grav[i] = gravity;
    }
    this.live = Math.min(this.cap, this.live + n);
  }

  update(dt: number) {
    if (this.live <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -9999;
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      alive++;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-dt * 1.5);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      const flick = Math.random() < 0.15 ? 0.3 : 1;
      this.col[i * 3] = this.base[i * 3] * f * flick;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f * flick;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f * flick;
    }
    this.live = alive;
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('color').needsUpdate = true;
  }
}
