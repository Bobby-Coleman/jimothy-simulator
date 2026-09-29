import * as THREE from 'three';

/** One instanced-mesh particle (cartoon puff, fire blob, confetti piece, debris chunk, glitch cube). */
export class MeshParticle {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  age = 0;
  life = 1;
  /** Uniform scale at start / end, multiplied by the base dimensions sx/sy/sz. */
  s0 = 1;
  s1 = 1;
  /** 0 linear, 1 puff (grow fast, shrink to 0 at the end), 2 ease-out, 3 shrink late */
  sc = 0;
  sx = 1;
  sy = 1;
  sz = 1;
  /** rotation axis (unit), angle and angular speed */
  ax = 0;
  ay = 1;
  az = 0;
  ang = 0;
  spin = 0;
  grav = 0;
  drag = 0;
  floor = -1e9;
  bounce = 0;
  /** colour lerps c0 → c1 over life (linear; >1 allowed for glowing layers) */
  r0 = 1;
  g0 = 1;
  b0 = 1;
  r1 = 1;
  g1 = 1;
  b1 = 1;
  /** Snap displayed position to this grid (glitchy slop cubes). 0 = off. */
  quant = 0;
  /** Probability per frame of blinking out (glitch flicker). */
  flicker = 0;
  /** Optional flutter (confetti): horizontal sway amplitude. */
  flutter = 0;
  ph = 0;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Pooled InstancedMesh particles — one draw call per layer. */
export class MeshLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly cap: number;
  private parts: MeshParticle[] = [];
  n = 0;
  private colors: THREE.InstancedBufferAttribute;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, cap: number, name: string) {
    this.cap = cap;
    for (let i = 0; i < cap; i++) this.parts.push(new MeshParticle());
    this.mesh = new THREE.InstancedMesh(geometry, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colors;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    this.mesh.name = name;
  }

  spawn(): MeshParticle | null {
    if (this.n >= this.cap) return null;
    const p = this.parts[this.n++];
    p.vx = p.vy = p.vz = 0;
    p.age = 0;
    p.life = 1;
    p.s0 = p.s1 = 1;
    p.sc = 0;
    p.sx = p.sy = p.sz = 1;
    // random axis
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const k = Math.sqrt(1 - u * u);
    p.ax = k * Math.cos(th);
    p.ay = u;
    p.az = k * Math.sin(th);
    p.ang = Math.random() * Math.PI * 2;
    p.spin = 0;
    p.grav = 0;
    p.drag = 0;
    p.floor = -1e9;
    p.bounce = 0;
    p.r0 = p.g0 = p.b0 = p.r1 = p.g1 = p.b1 = 1;
    p.quant = 0;
    p.flicker = 0;
    p.flutter = 0;
    p.ph = Math.random() * 6.283;
    return p;
  }

  /** Set both colour ends. */
  static color(p: MeshParticle, c0: THREE.Color, c1: THREE.Color = c0, k0 = 1, k1 = k0) {
    p.r0 = c0.r * k0;
    p.g0 = c0.g * k0;
    p.b0 = c0.b * k0;
    p.r1 = c1.r * k1;
    p.g1 = c1.g * k1;
    p.b1 = c1.b * k1;
  }

  clear() {
    this.n = 0;
  }

  update(dt: number) {
    const P = this.parts;
    const col = this.colors.array as Float32Array;
    const mesh = this.mesh;
    let i = 0;
    while (i < this.n) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.n--;
        P[i] = P[this.n];
        P[this.n] = p;
        continue;
      }
      const t = p.age / p.life;
      p.vy -= p.grav * dt;
      if (p.drag > 0) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.vz *= k;
      }
      let fx = 0;
      let fz = 0;
      if (p.flutter > 0) {
        fx = Math.sin(p.age * 7 + p.ph) * p.flutter;
        fz = Math.cos(p.age * 5.3 + p.ph) * p.flutter;
      }
      p.x += (p.vx + fx) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + fz) * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        if (p.vy < 0) p.vy = -p.vy * p.bounce;
        p.vx *= 0.55;
        p.vz *= 0.55;
        p.spin *= 0.6;
      }
      p.ang += p.spin * dt;
      let s: number;
      switch (p.sc) {
        case 1: {
          const grow = 1 - Math.pow(1 - Math.min(1, t / 0.22), 3);
          s = (p.s0 + (p.s1 - p.s0) * grow) * (1 - smoothstep(0.45, 1, t));
          break;
        }
        case 2:
          s = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t));
          break;
        case 3:
          s = (p.s0 + (p.s1 - p.s0) * t) * (1 - smoothstep(0.75, 1, t));
          break;
        default:
          s = p.s0 + (p.s1 - p.s0) * t;
      }
      if (p.flicker > 0 && Math.random() < p.flicker) s = 0;
      let px = p.x;
      let py = p.y;
      let pz = p.z;
      if (p.quant > 0) {
        const q = p.quant;
        px = Math.round(px / q) * q;
        py = Math.round(py / q) * q;
        pz = Math.round(pz / q) * q;
      }
      _p.set(px, py, pz);
      _s.set(p.sx * s, p.sy * s, p.sz * s);
      _q.setFromAxisAngle(_ax.set(p.ax, p.ay, p.az), p.ang);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      const i3 = i * 3;
      col[i3] = p.r0 + (p.r1 - p.r0) * t;
      col[i3 + 1] = p.g0 + (p.g1 - p.g0) * t;
      col[i3 + 2] = p.b0 + (p.b1 - p.b0) * t;
      i++;
    }
    const n = this.n;
    mesh.count = n;
    mesh.visible = n > 0;
    if (n > 0) {
      const im = mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, n * 16);
      im.needsUpdate = true;
      this.colors.clearUpdateRanges();
      this.colors.addUpdateRange(0, n * 3);
      this.colors.needsUpdate = true;
    }
  }
}
