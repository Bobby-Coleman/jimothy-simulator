import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { rand, pick } from './shared';

/**
 * Big fireworks for the finale — sized to read from ~200 m away over Salmon Bay (the FX system's rockets are
 * backyard-sized). ONE THREE.Points draw call (additive, HDR colours so the bloom pass makes them glow), CPU-updated
 * particle pool, zero cost while idle. Purely visual: no events, no physics.
 *
 *   const fw = new BigFireworks(game);   fw.launch(x, z, { pattern: 'heart' });   fw.update(dt) each frame
 */

export type Pattern = 'peony' | 'ring' | 'heart' | 'willow' | 'crackle' | 'raccoon';

const MAX = 6000;
const GRAV = 9;

/** Dominant channel HDR (blooms), weak channels kept low so the hue survives the post chain. */
const PALETTE: [number, number, number][] = [
  [2.6, 0.55, 0.7], // red-pink
  [2.4, 1.6, 0.35], // gold
  [0.5, 2.3, 0.9], // green
  [0.55, 1.2, 2.6], // blue
  [2.2, 0.6, 2.2], // magenta
  [0.6, 2.2, 2.4], // teal
  [2.4, 2.2, 1.9], // white-ish
  [2.6, 1.1, 0.3], // orange
];

interface Rocket {
  x: number;
  y: number;
  z: number;
  vy: number;
  burstY: number;
  pattern: Pattern;
  color: [number, number, number];
  color2: [number, number, number];
  scale: number;
  face: THREE.Vector3;
  trailT: number;
}

export class BigFireworks {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  // particle state (struct of arrays)
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private vz = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size0 = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private base = new Float32Array(MAX * 3);
  private flicker = new Uint8Array(MAX);
  private n = 0;
  private rockets: Rocket[] = [];
  private mat: THREE.ShaderMaterial;
  /** Listener hook: a burst happened (colour, position) — the finale uses it for sky-light pulses. */
  onBurst: ((color: [number, number, number], p: THREE.Vector3) => void) | null = null;
  /** Where sounds are heard from (non-positional volume falls off with distance to this point). */
  listener: THREE.Vector3 | null = null;

  constructor(private game: Game) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 1.5, 220.0);
          vColor = color;
          vAlpha = alpha;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          float core = smoothstep(1.0, 0.0, r);
          float a = core * core * vAlpha;
          gl_FragColor = vec4(vColor * a + vec3(a * a * 0.6), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    game.scene.add(this.points);
  }

  get busy() {
    return this.n > 0 || this.rockets.length > 0;
  }

  /**
   * Launch a rocket from the water at (x, z) bursting at `height` m.
   * `face` = direction the flat patterns (heart / ring / raccoon) face (toward the audience).
   */
  launch(x: number, z: number, o: { height?: number; pattern?: Pattern; scale?: number; color?: [number, number, number]; face?: THREE.Vector3; y0?: number } = {}) {
    if (this.rockets.length > 24) return;
    const color = o.color ?? pick(PALETTE);
    const y0 = o.y0 ?? -1.2;
    this.rockets.push({
      x,
      y: y0,
      z,
      vy: rand(52, 60),
      burstY: o.height ?? rand(55, 90),
      pattern: o.pattern ?? pick<Pattern>(['peony', 'peony', 'ring', 'willow', 'crackle']),
      color,
      color2: Math.random() < 0.5 ? pick(PALETTE) : color,
      scale: o.scale ?? rand(0.9, 1.25),
      face: (o.face ?? new THREE.Vector3(0, 0, -1)).clone().normalize(),
      trailT: 0,
    });
    this.points.visible = true;
    // "whistle up, boom, crackle" — heard from across the water, so a bit quieter
    const d = this.listener ? Math.hypot(this.listener.x - x, this.listener.z - z) : 150;
    const vol = Math.max(0.18, Math.min(0.75, 70 / Math.max(40, d)));
    this.game.sfx('firework', undefined, vol, rand(0.8, 1.1));
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: [number, number, number], size: number, life: number, drag: number, grav: number, flick = 0) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.base[i * 3] = c[0];
    this.base[i * 3 + 1] = c[1];
    this.base[i * 3 + 2] = c[2];
    this.size0[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.flicker[i] = flick;
  }

  private burst(r: Rocket) {
    const { x, y, z, scale: s } = r;
    const c1 = r.color;
    const c2 = r.color2;
    const q = this.game.renderer?.quality;
    const k = q === 'low' ? 0.5 : q === 'medium' ? 0.8 : 1;
    const dir = new THREE.Vector3();
    // flash
    this.spawn(x, y, z, 0, 0, 0, [c1[0] * 1.6 + 1, c1[1] * 1.6 + 1, c1[2] * 1.6 + 1], 26 * s, 0.35, 0, 0);
    const flat = (n: number, fn: (i: number, out: THREE.Vector3) => void, speed: number, c: [number, number, number], life: number) => {
      // pattern drawn in the plane facing r.face
      const f = r.face;
      const right = new THREE.Vector3(f.z, 0, -f.x).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < n; i++) {
        fn(i, dir);
        const vx = (right.x * dir.x + up.x * dir.y) * speed;
        const vy = (right.y * dir.x + up.y * dir.y) * speed;
        const vz = (right.z * dir.x + up.z * dir.y) * speed;
        this.spawn(x, y, z, vx, vy, vz, c, rand(1.9, 2.6) * s, life * rand(0.9, 1.1), 1.4, GRAV * 0.25);
      }
    };
    switch (r.pattern) {
      case 'peony': {
        const n = Math.round(170 * k);
        for (let i = 0; i < n; i++) {
          randDir(dir);
          const sp = rand(19, 24) * s;
          this.spawn(x, y, z, dir.x * sp, dir.y * sp, dir.z * sp, i % 3 === 0 ? c2 : c1, rand(2.0, 2.8) * s, rand(1.8, 2.6), 1.35, GRAV * 0.4);
        }
        break;
      }
      case 'ring': {
        const n = Math.round(120 * k);
        flat(n, (i, o) => o.set(Math.cos((i / n) * Math.PI * 2), Math.sin((i / n) * Math.PI * 2), 0), 22 * s, c1, 2.2);
        for (let i = 0; i < 30 * k; i++) {
          randDir(dir);
          this.spawn(x, y, z, dir.x * 6, dir.y * 6, dir.z * 6, c2, 1.4 * s, 1.6, 1.8, GRAV * 0.3);
        }
        break;
      }
      case 'heart': {
        const n = Math.round(150 * k);
        flat(
          n,
          (i, o) => {
            const t = (i / n) * Math.PI * 2;
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
            o.set(hx / 17, hy / 17 + 0.15, 0);
          },
          23 * s,
          [2.7, 0.45, 0.75],
          2.6,
        );
        break;
      }
      case 'raccoon': {
        // a round face, two round ears and a bandit mask with two bright eyes — Jimothy in the sky
        const n = Math.round(110 * k);
        const face: [number, number, number] = [1.9, 1.8, 1.7];
        const mask: [number, number, number] = [0.9, 0.95, 1.4];
        flat(n, (i, o) => o.set(Math.cos((i / n) * Math.PI * 2), Math.sin((i / n) * Math.PI * 2), 0), 20 * s, face, 2.8);
        for (const ex of [-0.62, 0.62]) {
          const m = Math.round(24 * k);
          flat(m, (i, o) => o.set(ex + Math.cos((i / m) * Math.PI * 2) * 0.28, 0.95 + Math.sin((i / m) * Math.PI * 2) * 0.28, 0), 20 * s, face, 2.8);
        }
        const mm = Math.round(40 * k);
        flat(mm, (i, o) => o.set(-0.75 + (i / mm) * 1.5, 0.12 + Math.sin((i / mm) * Math.PI) * -0.12, 0), 20 * s, mask, 2.8);
        for (const ex of [-0.33, 0.33]) {
          const m = Math.round(10 * k);
          flat(m, (i, o) => o.set(ex + Math.cos((i / m) * Math.PI * 2) * 0.07, 0.15 + Math.sin((i / m) * Math.PI * 2) * 0.07, 0), 20 * s, [2.8, 2.6, 1.2], 2.8);
        }
        const nose = Math.round(8 * k);
        flat(nose, (i, o) => o.set(Math.cos((i / nose) * Math.PI * 2) * 0.06, -0.3 + Math.sin((i / nose) * Math.PI * 2) * 0.05, 0), 20 * s, [1, 0.9, 1], 2.8);
        break;
      }
      case 'willow': {
        const n = Math.round(130 * k);
        const gold: [number, number, number] = [2.4, 1.5, 0.45];
        for (let i = 0; i < n; i++) {
          randDir(dir);
          const sp = rand(12, 16) * s;
          this.spawn(x, y, z, dir.x * sp, dir.y * sp + 2, dir.z * sp, gold, rand(1.3, 1.8) * s, rand(3.2, 4.2), 0.9, GRAV * 0.7);
        }
        break;
      }
      case 'crackle': {
        const n = Math.round(150 * k);
        for (let i = 0; i < n; i++) {
          randDir(dir);
          const sp = rand(8, 20) * s;
          this.spawn(x, y, z, dir.x * sp, dir.y * sp, dir.z * sp, [2.2, 2.1, 1.8], rand(1.1, 1.6) * s, rand(1.3, 2.2), 1.6, GRAV * 0.35, 1);
        }
        break;
      }
    }
    const p = new THREE.Vector3(x, y, z);
    this.onBurst?.(c1, p);
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    if (!this.points.visible) return;
    if (dt <= 0) return;
    // rockets: rise with a sparkling trail, burst at the top
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.vy = Math.max(12, r.vy - GRAV * 0.6 * dt);
      r.y += r.vy * dt;
      r.x += Math.sin(r.y * 0.3) * 0.02;
      r.trailT -= dt;
      if (r.trailT <= 0) {
        r.trailT = 0.03;
        this.spawn(r.x, r.y, r.z, rand(-0.6, 0.6), -2, rand(-0.6, 0.6), [2.2, 1.6, 0.9], 1.0, 0.55, 2, GRAV * 0.2);
      }
      if (r.y >= r.burstY) {
        this.rockets.splice(i, 1);
        this.burst(r);
      }
    }
    // particles
    const t = this.game.time;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= dr;
      this.vy[i] = this.vy[i] * dr - this.grav[i] * dt;
      this.vz[i] *= dr;
      this.pos[i * 3] += this.vx[i] * dt;
      this.pos[i * 3 + 1] += this.vy[i] * dt;
      this.pos[i * 3 + 2] += this.vz[i] * dt;
      const u = this.life[i] / this.maxLife[i]; // 1 → 0
      let a = u < 0.35 ? u / 0.35 : 1;
      if (this.flicker[i] && u < 0.7) a *= Math.sin(t * 40 + i) > 0 ? 1 : 0.15;
      // cool toward warm orange as they die
      const w = 1 - u;
      this.col[i * 3] = this.base[i * 3] * (1 - w * 0.2) + w * 0.5;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * (1 - w * 0.45);
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * (1 - w * 0.7);
      this.alpha[i] = a;
      this.size[i] = this.size0[i] * (0.55 + 0.45 * u);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    if (this.n > 0) {
      for (const name of ['position', 'color', 'size', 'alpha']) {
        const attr = this.geo.getAttribute(name) as THREE.BufferAttribute;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, this.n * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
    // pixels per metre at distance 1: drawing-buffer height / (2 tan(fov/2))
    const h = this.game.renderer?.renderer?.domElement?.height ?? 720;
    this.mat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    if (this.n === 0 && this.rockets.length === 0) this.points.visible = false;
  }

  /** Swap-remove particle i. */
  private kill(i: number) {
    const last = --this.n;
    if (i === last) return;
    this.pos[i * 3] = this.pos[last * 3];
    this.pos[i * 3 + 1] = this.pos[last * 3 + 1];
    this.pos[i * 3 + 2] = this.pos[last * 3 + 2];
    this.base[i * 3] = this.base[last * 3];
    this.base[i * 3 + 1] = this.base[last * 3 + 1];
    this.base[i * 3 + 2] = this.base[last * 3 + 2];
    this.col[i * 3] = this.col[last * 3];
    this.col[i * 3 + 1] = this.col[last * 3 + 1];
    this.col[i * 3 + 2] = this.col[last * 3 + 2];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.vz[i] = this.vz[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size0[i] = this.size0[last];
    this.size[i] = this.size[last];
    this.alpha[i] = this.alpha[last];
    this.drag[i] = this.drag[last];
    this.grav[i] = this.grav[last];
    this.flicker[i] = this.flicker[last];
  }

  clear() {
    this.n = 0;
    this.rockets.length = 0;
    this.geo.setDrawRange(0, 0);
    this.points.visible = false;
  }

  dispose() {
    this.clear();
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

function randDir(out: THREE.Vector3) {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), u, s * Math.sin(a));
}
