import * as THREE from 'three';

/**
 * The AI-slop look: an onBeforeCompile'd MeshStandardMaterial (so it is lit, fogged and shadowed like everything
 * else) with
 *  - oil-slick iridescence (fresnel + blocky object-space rainbow bands, cycling over time),
 *  - JPEG-ish "compression artifacts" (8×8 screen macroblocks that posterize / channel-swap, faint block edges),
 *  - occasional vertex jitter (horizontal slice tearing) and vertex snapping ("low bitrate" blockiness),
 *  - per-part rigid rotations done on the GPU (legs / head / tails / wings): one draw call per creature,
 *  - a voxel "pixelate away" dissolve with glowing edges.
 *
 * Geometry must carry the attributes aPart (part index), aExtra (1 = extra limb/eye, hidden when uExtra = 0) and
 * aGlow (emissive boost), plus vertex colours. See SlopGeometry.ts.
 */

export const MAX_PARTS = 16;

/** One shared time uniform for every slop material (updated once per frame by the slop system). */
export const slopTime = { value: 0 };

export interface SlopRig {
  /** Part pivots in model space (MAX_PARTS). */
  pivots: THREE.Vector3[];
  /** Parent part index or -1 (one level of hierarchy is supported). */
  parents: Float32Array;
}

export interface SlopUniforms {
  uTime: { value: number };
  uGlitch: { value: number };
  uBlocky: { value: number };
  uSeed: { value: number };
  uDissolve: { value: number };
  uIri: { value: number };
  uExtra: { value: number };
  uFlash: { value: number };
  uRot: { value: THREE.Vector3[] };
  uPivot: { value: THREE.Vector3[] };
  uParent: { value: Float32Array };
  [k: string]: { value: any };
}

export function emptyRig(): SlopRig {
  return {
    pivots: Array.from({ length: MAX_PARTS }, () => new THREE.Vector3()),
    parents: new Float32Array(MAX_PARTS).fill(-1),
  };
}

export function makeSlopUniforms(rig: SlopRig, seed = Math.random() * 100): SlopUniforms {
  return {
    uTime: slopTime,
    uGlitch: { value: 0 },
    uBlocky: { value: 0 },
    uSeed: { value: seed },
    uDissolve: { value: 0 },
    uIri: { value: 1 },
    uExtra: { value: 1 },
    uFlash: { value: 0 },
    uRot: { value: Array.from({ length: MAX_PARTS }, () => new THREE.Vector3()) },
    uPivot: { value: rig.pivots },
    uParent: { value: rig.parents },
  };
}

const VERT_PARS = /* glsl */ `
attribute float aPart;
attribute float aExtra;
attribute float aGlow;
uniform float uTime;
uniform float uGlitch;
uniform float uBlocky;
uniform float uSeed;
uniform float uDissolve;
uniform float uExtra;
uniform vec3 uRot[${MAX_PARTS}];
uniform vec3 uPivot[${MAX_PARTS}];
uniform float uParent[${MAX_PARTS}];
varying vec3 vSlopObj;
varying float vSlopGlow;
float slopH1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
mat3 slopRotM(vec3 e) {
  float cx = cos(e.x), sx = sin(e.x);
  float cy = cos(e.y), sy = sin(e.y);
  float cz = cos(e.z), sz = sin(e.z);
  mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  return ry * rx * rz;
}
vec3 slopPose(vec3 p) {
  int sp = int(aPart + 0.5);
  vec3 pv = uPivot[sp];
  if (aExtra > 0.5) p = mix(pv, p, uExtra);
  p = slopRotM(uRot[sp]) * (p - pv) + pv;
  float par = uParent[sp];
  if (par > -0.5) {
    int pi = int(par + 0.5);
    vec3 pp = uPivot[pi];
    p = slopRotM(uRot[pi]) * (p - pp) + pp;
  }
  return p;
}
vec3 slopPoseN(vec3 n) {
  int sp = int(aPart + 0.5);
  n = slopRotM(uRot[sp]) * n;
  float par = uParent[sp];
  if (par > -0.5) n = slopRotM(uRot[int(par + 0.5)]) * n;
  return n;
}
vec3 slopGlitch(vec3 p) {
  if (uGlitch > 0.001) {
    float gt = floor(uTime * 24.0);
    float slice = floor(p.y * 14.0);
    float hs = slopH1(slice * 1.37 + gt * 7.13 + uSeed * 3.1);
    p.x += (hs - 0.5) * 0.45 * uGlitch * step(0.62, hs);
    p.z += (slopH1(slice * 2.1 + gt + 5.7) - 0.5) * 0.14 * uGlitch * step(0.7, hs);
    p += (vec3(slopH1(p.x * 91.0 + gt), slopH1(p.y * 57.0 + gt), slopH1(p.z * 33.0 + gt)) - 0.5) * 0.02 * uGlitch;
  }
  if (uBlocky > 0.001) p = mix(p, floor(p * 9.0 + 0.5) / 9.0, uBlocky);
  if (uDissolve > 0.001) {
    float hb = slopH1(dot(floor(p * 18.0), vec3(1.0, 57.0, 113.0)) + uSeed);
    p.y += uDissolve * uDissolve * (0.25 + hb * 0.9);
    p.xz *= 1.0 + uDissolve * 0.4 * hb;
  }
  return p;
}
`;

const FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uDissolve;
uniform float uIri;
uniform float uFlash;
uniform float uGlitch;
varying vec3 vSlopObj;
varying float vSlopGlow;
float slopH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float slopH3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
`;

const FRAG_DISCARD = /* glsl */ `
if (uDissolve > 0.0) {
  float slopDv = slopH3(floor(vSlopObj * 18.0) + uSeed);
  if (slopDv < uDissolve) discard;
}
`;

const FRAG_COLOR = /* glsl */ `
{
  vec3 sV = normalize(vViewPosition);
  float fres = 1.0 - clamp(abs(dot(normal, sV)), 0.0, 1.0);
  fres *= fres;
  vec3 q = floor(vSlopObj * 22.0) / 22.0;
  float band = fres * 1.8 + dot(q, vec3(1.9, 2.7, 1.3)) + uTime * 0.25 + uSeed * 0.37;
  vec3 rainbow = 0.5 + 0.5 * cos(6.2831853 * (band + vec3(0.0, 0.33, 0.67)));
  // oil-slick: faint in the middle, strong at grazing angles; a slow shimmer band sweeps across now and then
  float sweep = smoothstep(0.85, 1.0, sin(vSlopObj.y * 6.0 - uTime * 2.3 + uSeed) * 0.5 + 0.5);
  float iri = uIri * clamp(0.1 + 0.62 * fres + 0.35 * sweep, 0.0, 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.5 + rainbow * 0.6, iri);
  totalEmissiveRadiance += rainbow * uIri * (fres * 0.35 + sweep * 0.12);
  // "compression artifacts": 8x8 screen-space macroblocks
  vec2 blk = floor(gl_FragCoord.xy / 8.0);
  float hb = slopH2(blk + floor(uTime * 7.0) * 0.731 + uSeed);
  float art = step(1.0 - 0.07 * uIri - 0.3 * uGlitch, hb);
  vec3 poster = floor(diffuseColor.rgb * 5.0 + 0.5) / 5.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, poster.gbr * 1.15, art * 0.85);
  vec2 bf = fract(gl_FragCoord.xy / 8.0);
  float edge = max(step(bf.x, 0.126), step(bf.y, 0.126));
  diffuseColor.rgb *= 1.0 - edge * 0.07 * uIri;
  totalEmissiveRadiance += diffuseColor.rgb * vSlopGlow * 1.4;
  totalEmissiveRadiance += rainbow * uFlash * 1.6;
  if (uDissolve > 0.0) {
    float dv = slopH3(floor(vSlopObj * 18.0) + uSeed);
    totalEmissiveRadiance += vec3(0.5, 1.4, 1.8) * step(dv, uDissolve + 0.14) * 2.2;
  }
#ifdef SLOP_GHOST
  diffuseColor.rgb = rainbow * 0.5;
  totalEmissiveRadiance = rainbow * 0.9;
  if (mod(gl_FragCoord.y, 3.0) < 1.0) discard;
#endif
}
`;

function injectVertex(shader: { vertexShader: string }) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\nobjectNormal = slopPoseN(objectNormal);`)
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\ntransformed = slopPose(transformed);\nvSlopObj = transformed;\nvSlopGlow = aGlow;\ntransformed = slopGlitch(transformed);`,
    );
}

export interface SlopMaterialOptions {
  ghost?: boolean;
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
}

/** Lit slop material. `u` is shared with the creature's depth / ghost materials. */
export function makeSlopMaterial(u: SlopUniforms, opts: SlopMaterialOptions = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.12,
    side: opts.side ?? THREE.FrontSide,
  });
  m.name = opts.ghost ? 'SlopGhost' : 'SlopSkin';
  if (opts.ghost) {
    m.transparent = true;
    m.opacity = 0.55;
    m.blending = THREE.AdditiveBlending;
    m.depthWrite = false;
    m.defines = { SLOP_GHOST: '' };
  }
  m.onBeforeCompile = (shader) => {
    for (const k of Object.keys(u)) shader.uniforms[k] = u[k];
    injectVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_DISCARD}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_COLOR}`);
  };
  const key = `slop-v1-${opts.ghost ? 'g' : 's'}-${opts.side ?? THREE.FrontSide}`;
  m.customProgramCacheKey = () => key;
  return m;
}

/** Shadow-casting depth material that follows the GPU pose / glitch / dissolve. */
export function makeSlopDepthMaterial(u: SlopUniforms): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = (shader) => {
    for (const k of Object.keys(u)) shader.uniforms[k] = u[k];
    injectVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_DISCARD}`);
  };
  m.customProgramCacheKey = () => 'slop-depth-v1';
  return m;
}
