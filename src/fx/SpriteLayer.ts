import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, spriteAtlas } from './atlas';

/** Sprite orientation modes. */
export const MODE = {
  /** Camera-facing quad, rotated in screen space by `rot`. */
  billboard: 0,
  /** Camera-facing quad stretched along its velocity (droplets, sparks, speed lines). */
  stretch: 1,
  /** Flat on the world XZ plane (splash rings, ground shockwaves). */
  flat: 2,
} as const;

/** Size curves */
export const SIZE = { linear: 0, pop: 1, easeOut: 2, pulse: 3 } as const;
/** Alpha curves */
export const ALPHA = { out: 0, inOut: 1, late: 2, flicker: 3, lateFlicker: 4 } as const;

/** One sprite particle. Pooled: never keep references after it dies. */
export class SpriteParticle {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  age = 0;
  life = 1;
  /** Size (world meters, quad height) at start / end. */
  s0 = 0.1;
  s1 = 0.1;
  sc = 0;
  /** Width / height. */
  asp = 1;
  /** MODE.stretch: extra length per m/s of speed. */
  stretch = 0;
  rot = 0;
  spin = 0;
  /** Downward acceleration (m/s²); negative floats up. */
  grav = 0;
  drag = 0;
  floor = -1e9;
  bounce = 0;
  /** Horizontal wobble amplitude (m/s) and frequency. */
  wob = 0;
  wobF = 0;
  ph = 0;
  frame = 0;
  mode = 0;
  r = 1;
  g = 1;
  b = 1;
  a = 1;
  ac = 0;
}

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec2 aScale;
attribute vec4 aColor;
attribute vec4 aParams; // rot, frame, mode, unused
attribute vec3 aDir;
uniform vec2 uCells;
uniform vec2 uFog; // near, far
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
  vec2 q = position.xy;
  float rot = aParams.x;
  float frame = aParams.y;
  float mode = aParams.z;
  vec4 mv;
  if (mode < 0.5) {
    float c = cos(rot), s = sin(rot);
    vec2 o = q * aScale;
    mv = modelViewMatrix * vec4(aCenter, 1.0);
    mv.xy += vec2(o.x * c - o.y * s, o.x * s + o.y * c);
  } else if (mode < 1.5) {
    mv = modelViewMatrix * vec4(aCenter, 1.0);
    vec2 d = (modelViewMatrix * vec4(aDir, 0.0)).xy;
    float len = length(d);
    vec2 ax = len > 1e-5 ? d / len : vec2(1.0, 0.0);
    vec2 ay = vec2(-ax.y, ax.x);
    mv.xy += ax * (q.x * aScale.x) + ay * (q.y * aScale.y);
  } else {
    float c = cos(rot), s = sin(rot);
    vec2 o = q * aScale;
    vec3 off = vec3(o.x * c - o.y * s, 0.0, o.x * s + o.y * c);
    mv = modelViewMatrix * vec4(aCenter + off, 1.0);
  }
  gl_Position = projectionMatrix * mv;
  vec2 cell = vec2(mod(frame, uCells.x), floor(frame / uCells.x));
  vUv = vec2((cell.x + uv.x) / uCells.x, 1.0 - (cell.y + 1.0 - uv.y) / uCells.y);
  vColor = aColor;
  vFog = clamp((-mv.z - uFog.x) / max(uFog.y - uFog.x, 1.0), 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec4 c = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
#ifdef ADDITIVE
  c.a *= 1.0 - vFog;
#else
  c.rgb = mix(c.rgb, uFogColor, vFog * 0.85);
  // keep every channel above the post chain's "black pixel" threshold (see POST_SAFE_GLSL in FX.ts)
  c.rgb = max(c.rgb, vec3((0.085 + 0.218 * (c.r + c.g + c.b) / 3.0) / 1.218));
#endif
  if (c.a < 0.003) discard;
  gl_FragColor = c;
}
`;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * A pool of camera-facing quads rendered with ONE instanced draw call.
 * CPU-simulated (a few thousand particles cost well under a millisecond).
 */
export class SpriteLayer {
  readonly mesh: THREE.Mesh;
  readonly cap: number;
  private parts: SpriteParticle[] = [];
  n = 0;
  private geo: THREE.InstancedBufferGeometry;
  private aCenter: THREE.InstancedBufferAttribute;
  private aScale: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aParams: THREE.InstancedBufferAttribute;
  private aDir: THREE.InstancedBufferAttribute;
  readonly material: THREE.ShaderMaterial;

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    for (let i = 0; i < cap; i++) this.parts.push(new SpriteParticle());
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const mk = (size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aCenter = mk(3);
    this.aScale = mk(2);
    this.aColor = mk(4);
    this.aParams = mk(4);
    this.aDir = mk(3);
    geo.setAttribute('aCenter', this.aCenter);
    geo.setAttribute('aScale', this.aScale);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aParams', this.aParams);
    geo.setAttribute('aDir', this.aDir);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: spriteAtlas() },
        uCells: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
        uFog: { value: new THREE.Vector2(1e5, 2e5) },
        uFogColor: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: '' } : {},
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 12 : 11;
    this.mesh.visible = false;
    this.mesh.name = additive ? 'fx-sprites-add' : 'fx-sprites';
  }

  /** Grab a particle from the pool (reset to defaults), or null if the pool is full. */
  spawn(): SpriteParticle | null {
    if (this.n >= this.cap) return null;
    const p = this.parts[this.n++];
    p.vx = p.vy = p.vz = 0;
    p.age = 0;
    p.life = 1;
    p.s0 = p.s1 = 0.1;
    p.sc = 0;
    p.asp = 1;
    p.stretch = 0;
    p.rot = 0;
    p.spin = 0;
    p.grav = 0;
    p.drag = 0;
    p.floor = -1e9;
    p.bounce = 0;
    p.wob = 0;
    p.wobF = 0;
    p.ph = Math.random() * 6.283;
    p.frame = 0;
    p.mode = 0;
    p.r = p.g = p.b = p.a = 1;
    p.ac = 0;
    return p;
  }

  clear() {
    this.n = 0;
  }

  update(dt: number) {
    const P = this.parts;
    const C = this.aCenter.array as Float32Array;
    const S = this.aScale.array as Float32Array;
    const K = this.aColor.array as Float32Array;
    const R = this.aParams.array as Float32Array;
    const D = this.aDir.array as Float32Array;
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
      // integrate
      p.vy -= p.grav * dt;
      if (p.drag > 0) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
        p.vz *= k;
      }
      let wx = 0;
      let wz = 0;
      if (p.wob > 0) {
        const w = Math.sin(p.age * p.wobF + p.ph) * p.wob;
        wx = w;
        wz = Math.cos(p.age * p.wobF * 0.83 + p.ph) * p.wob;
      }
      p.x += (p.vx + wx) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + wz) * dt;
      if (p.y < p.floor) {
        p.y = p.floor;
        p.vy = -p.vy * p.bounce;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.rot += p.spin * dt;
      // size curve
      let s: number;
      switch (p.sc) {
        case 1: {
          // pop: overshoot in, hold, shrink out
          const a = Math.min(1, t / 0.18);
          const pop = a < 1 ? 1 + 2.2 * Math.pow(a - 1, 3) + 1.2 * Math.pow(a - 1, 2) : 1;
          s = p.s1 * pop * (1 - smoothstep(0.7, 1, t) * 0.85);
          break;
        }
        case 2:
          s = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t));
          break;
        case 3:
          s = (p.s0 + (p.s1 - p.s0) * t) * (0.75 + 0.25 * Math.sin(p.age * 30 + p.ph));
          break;
        default:
          s = p.s0 + (p.s1 - p.s0) * t;
      }
      // alpha curve
      let a: number;
      switch (p.ac) {
        case 1:
          a = Math.min(1, t / 0.12) * (1 - smoothstep(0.55, 1, t));
          break;
        case 2:
          a = 1 - smoothstep(0.7, 1, t);
          break;
        case 3:
          a = (1 - t) * (Math.random() < 0.7 ? 1 : 0.15);
          break;
        case 4:
          a = (1 - smoothstep(0.6, 1, t)) * (t > 0.5 && Math.random() < 0.35 ? 0.1 : 1);
          break;
        default:
          a = 1 - t;
      }
      const i3 = i * 3;
      const i2 = i * 2;
      const i4 = i * 4;
      C[i3] = p.x;
      C[i3 + 1] = p.y;
      C[i3 + 2] = p.z;
      let w = s * p.asp;
      if (p.mode === 1) {
        const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
        w += sp * p.stretch;
      }
      S[i2] = w;
      S[i2 + 1] = s;
      K[i4] = p.r;
      K[i4 + 1] = p.g;
      K[i4 + 2] = p.b;
      K[i4 + 3] = p.a * a;
      R[i4] = p.rot;
      R[i4 + 1] = p.frame;
      R[i4 + 2] = p.mode;
      D[i3] = p.vx;
      D[i3 + 1] = p.vy;
      D[i3 + 2] = p.vz;
      i++;
    }
    const n = this.n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      for (const [attr, size] of [
        [this.aCenter, 3],
        [this.aScale, 2],
        [this.aColor, 4],
        [this.aParams, 4],
        [this.aDir, 3],
      ] as const) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * size);
        attr.needsUpdate = true;
      }
    }
  }

  setFog(near: number, far: number, color: THREE.Color) {
    (this.material.uniforms.uFog.value as THREE.Vector2).set(near, far);
    (this.material.uniforms.uFogColor.value as THREE.Color).copy(color);
  }
}
