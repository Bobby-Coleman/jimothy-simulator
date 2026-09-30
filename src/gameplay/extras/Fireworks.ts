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
        // Jimothy in the sky, in profile mid-stroll: his domed back, the head carried low with the bandit mask and
        // a bright eye, long legs (a front paw lifted and curled) and the little puff of a tail
        for (const g of jimothySparks()) {
          const n = g.always ? g.pts.length : Math.max(1, Math.round(g.pts.length * k));
          flat(n, (i, o) => {
            const p = g.pts[Math.floor((i * g.pts.length) / n)];
            o.set(p[0], p[1], 0);
          }, 20 * s, g.color, 2.8);
        }
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

// ------------------------------------------------------------------------------------------------ Jimothy in sparks

type Pt2 = [number, number];
interface SparkGroup {
  pts: Pt2[];
  color: [number, number, number];
  /** Keep every point at low quality (the eye and nose are only a few sparks). */
  always?: boolean;
}
let sparkGroups: SparkGroup[] | null = null;

/**
 * Jimothy's side profile as spark points (x toward his nose, y up, about ±1), built once. Traced from the shared 2D
 * doodle (fx/jimothyArt, same figure units): the outline of his domed back running straight into his low head (no
 * neck), his legs where they show below the body (a front paw lifted and curled), the ear and the short tail puff
 * where they stick out, the bandit mask round a bright eye, and his nose.
 */
function jimothySparks(): SparkGroup[] {
  if (sparkGroups) return sparkGroups;
  // canvas-style (y down) like the doodle; flipped to y up at the end
  const BODY: Pt2[] = [
    [1.0, -0.075], [0.975, -0.14], [0.93, -0.25], [0.86, -0.39], [0.8, -0.52], [0.72, -0.6], [0.6, -0.7], [0.44, -0.83],
    [0.24, -0.9], [0.0, -0.915], [-0.24, -0.885], [-0.44, -0.79], [-0.6, -0.64], [-0.68, -0.4], [-0.67, -0.12], [-0.62, 0.14],
    [-0.53, 0.32], [-0.37, 0.34], [-0.2, 0.34], [0.1, 0.37], [0.36, 0.31], [0.54, 0.17], [0.65, 0.07], [0.76, 0.0],
    [0.86, -0.025], [0.95, -0.035],
  ];
  const LEGS: Pt2[][] = [
    [[-0.2, 0.08], [-0.12, 0.4], [0.0, 0.5], [0.18, 0.5]],
    [[0.36, 0.04], [0.34, 0.4], [0.4, 0.7], [0.47, 0.86], [0.56, 0.885]],
    [[-0.44, -0.08], [-0.46, 0.34], [-0.64, 0.57], [-0.71, 0.84], [-0.59, 0.9]],
    [[0.55, -0.04], [0.6, 0.28], [0.71, 0.38], [0.7, 0.5], [0.64, 0.55]],
  ];
  const MASK: Pt2[] = [[0.68, -0.43], [0.79, -0.44], [0.87, -0.37], [0.925, -0.26], [0.89, -0.18], [0.8, -0.14], [0.71, -0.14], [0.655, -0.25]];
  const EYE: Pt2 = [0.82, -0.33];
  const STEP = 0.05;
  const body = spline(BODY, true, 8);
  const outside = (p: Pt2) => !insidePoly(p, body);
  const oval = (cx: number, cy: number, rx: number, ry: number, rot: number): Pt2[] => {
    const out: Pt2[] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const x = Math.cos(a) * rx;
      const y = Math.sin(a) * ry;
      out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    return out;
  };
  const legs = LEGS.flatMap((l) => resample(spline(l, false, 8), STEP, false)).filter(outside);
  const ear = resample(oval(0.7, -0.63, 0.085, 0.12, -0.3), STEP * 0.8, true).filter(outside);
  const tail = resample(oval(-0.75, -0.47, 0.19, 0.255, 0.55), STEP, true).filter(outside);
  // the mask as a ring of blue sparks round the eye (filled in, the sparks just add up to a white blob)
  const mask = resample(spline(MASK, true, 6), 0.036, true);
  const up = (list: Pt2[]) => list.map(([x, y]) => [x, -y] as Pt2);
  sparkGroups = [
    { pts: up([...resample(body, STEP, true), ...ear]), color: [2.3, 2.0, 1.55] },
    { pts: up(legs), color: [2.2, 1.7, 1.1] },
    { pts: up(tail), color: [2.5, 1.35, 0.5] },
    { pts: up(mask), color: [0.55, 0.8, 2.6] },
    { pts: up([EYE, EYE, [EYE[0] - 0.006, EYE[1] - 0.006]]), color: [2.9, 2.8, 1.9], always: true },
    { pts: up([[0.99, -0.09], [0.985, -0.084]]), color: [2.7, 0.55, 0.85], always: true },
  ];
  return sparkGroups;
}

/** A Catmull-Rom curve through `pts`, sampled `per` times a segment. */
function spline(pts: Pt2[], closed: boolean, per: number): Pt2[] {
  const n = pts.length;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out: Pt2[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Points every `step` along a polyline. */
function resample(poly: Pt2[], step: number, closed: boolean): Pt2[] {
  const out: Pt2[] = [poly[0]];
  let need = step;
  const m = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < m; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let pos = 0;
    while (len - pos >= need) {
      pos += need;
      need = step;
      const t = pos / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    need -= len - pos;
  }
  if (closed && out.length > 1) {
    const l = out[out.length - 1];
    if (Math.hypot(l[0] - out[0][0], l[1] - out[0][1]) < step * 0.5) out.pop();
  }
  return out;
}

function insidePoly(p: Pt2, poly: Pt2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
