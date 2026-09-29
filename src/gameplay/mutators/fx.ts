import * as THREE from 'three';
import type { Game } from '../../core/Game';

/**
 * Small self-contained FX helpers shared by mutators and collectibles:
 *  - ParticlePool: one-draw-call GPU points with per-particle color/size/alpha/shape
 *    (shapes: circle, square "pixel", sparkle star, heart), simple ballistic motion.
 *  - makeLabelSprite: canvas text sprite ("(generated)", "HOME RUN!" …).
 */

export const Shape = { Circle: 0, Square: 1, Star: 2, Heart: 3 } as const;
export type Shape = (typeof Shape)[keyof typeof Shape];

export interface SpawnOpts {
  gravity?: number;
  /** Size multiplier reached at end of life (1 = constant). */
  grow?: number;
  /** Velocity damping per second. */
  drag?: number;
  shape?: Shape;
  /** Fade in for this fraction of life (0..1). */
  fadeIn?: number;
  alpha?: number;
}

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vShape = aShape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vec2 c = (gl_PointCoord - 0.5) * 2.0;
  c.y = -c.y;
  float a = 1.0;
  if (vShape < 0.5) {
    a = 1.0 - smoothstep(0.45, 1.0, length(c));
  } else if (vShape < 1.5) {
    a = 1.0;
  } else if (vShape < 2.5) {
    // four-point sparkle
    float d = abs(c.x) * abs(c.y);
    a = clamp(1.0 - (d * 18.0 + length(c) * 0.9), 0.0, 1.0);
    a += (1.0 - smoothstep(0.0, 0.35, length(c))) * 0.8;
  } else {
    // heart: (x^2 + y^2 - 1)^3 - x^2 y^3 < 0
    vec2 h = c * 1.25;
    h.y += 0.25;
    float x2 = h.x * h.x;
    float q = x2 + h.y * h.y - 1.0;
    float v = q * q * q - x2 * h.y * h.y * h.y;
    a = 1.0 - smoothstep(-0.08, 0.02, v);
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

const _c = new THREE.Color();

export class ParticlePool {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private shape: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private baseAlpha: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private fadeIn: Float32Array;
  private next = 0;
  private liveCount = 0;

  constructor(
    private game: Game,
    readonly max = 256,
    opts: { additive?: boolean } = {},
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.shape = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'ParticlePool';
    game.scene.add(this.points);
  }

  get alive() {
    return this.liveCount;
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3 | null, color: THREE.ColorRepresentation, size: number, life: number, o: SpawnOpts = {}) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v?.x ?? 0;
    this.vel[i * 3 + 1] = v?.y ?? 0;
    this.vel[i * 3 + 2] = v?.z ?? 0;
    _c.set(color);
    this.col[i * 3] = _c.r;
    this.col[i * 3 + 1] = _c.g;
    this.col[i * 3 + 2] = _c.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.size[i] = size;
    this.baseAlpha[i] = o.alpha ?? 1;
    this.alpha[i] = o.fadeIn ? 0 : (o.alpha ?? 1);
    this.shape[i] = o.shape ?? Shape.Circle;
    this.grow[i] = o.grow ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0;
  }

  update(dt: number) {
    const cam = this.game.camera;
    const h = this.game.renderer?.renderer.domElement.height ?? window.innerHeight;
    this.mat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      live++;
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i]; // 0 → 1
      const fi = this.fadeIn[i];
      const fade = fi > 0 && t < fi ? t / fi : 1 - Math.max(0, (t - 0.55) / 0.45);
      this.alpha[i] = this.life[i] <= 0 ? 0 : this.baseAlpha[i] * fade;
      this.size[i] = this.baseSize[i] * (1 + (this.grow[i] - 1) * t);
    }
    this.liveCount = live;
    const attrs = this.geo.attributes;
    (attrs.position as THREE.BufferAttribute).needsUpdate = true;
    (attrs.aColor as THREE.BufferAttribute).needsUpdate = true;
    (attrs.aSize as THREE.BufferAttribute).needsUpdate = true;
    (attrs.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (attrs.aShape as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** A text sprite drawn on a canvas. `height` is the world height in meters. */
export function makeLabelSprite(
  text: string,
  opts: { height?: number; color?: string; bg?: string; border?: string; font?: string; italic?: boolean } = {},
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontSize = 56;
  const font = `${opts.italic ? 'italic ' : ''}800 ${fontSize}px ${opts.font ?? 'system-ui, "Segoe UI", sans-serif'}`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  const h = fontSize + 34;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    roundRect(ctx, 3, 3, w - 6, h - 6, 22);
    ctx.fill();
    if (opts.border) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = opts.border;
      ctx.stroke();
    }
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!opts.bg) {
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, w / 2, h / 2 + 2);
  }
  ctx.fillStyle = opts.color ?? '#fff';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const s = new THREE.Sprite(mat);
  const height = opts.height ?? 0.3;
  s.scale.set((height * w) / h, height, 1);
  s.renderOrder = 20;
  s.userData.jimAccessory = true;
  return s;
}

export function disposeSprite(s: THREE.Sprite) {
  s.removeFromParent();
  s.material.map?.dispose();
  s.material.dispose();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Soft radial glow texture (cached). */
let glowTex: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** Recursively dispose geometries/materials/textures we created ourselves. */
export function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat as any)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
      mat.dispose();
    }
  });
}

/** Deterministic-ish hash noise in [0,1). */
export function hash01(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
