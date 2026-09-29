import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Look } from './Looks';
import type { Expression } from './types';
import { faceMaterial, printMaterial, FACE_PHI, FACE_T0, FACE_TL, type FaceStyle } from './Face';
import { safeColor } from './color';

/**
 * Chunky toy-like humans built from primitives.
 * The whole body is ONE skinned mesh (vertex colors, 11 rigid bones) + a face decal (+ optional shirt print),
 * so a human costs 2–3 draw calls. Bones double as ragdoll segments.
 */

export const BONES = ['pelvis', 'chest', 'head', 'uArmL', 'lArmL', 'uArmR', 'lArmR', 'thighL', 'shinL', 'thighR', 'shinR'] as const;
export type BoneName = (typeof BONES)[number];
export const BONE_PARENT: Record<BoneName, BoneName | null> = {
  pelvis: null,
  chest: 'pelvis',
  head: 'chest',
  uArmL: 'chest',
  lArmL: 'uArmL',
  uArmR: 'chest',
  lArmR: 'uArmR',
  thighL: 'pelvis',
  shinL: 'thighL',
  thighR: 'pelvis',
  shinR: 'thighR',
};
const BI = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;

export interface Dims {
  s: number;
  b: number;
  footH: number;
  footL: number;
  footW: number;
  footZ: number;
  shinLen: number;
  thighLen: number;
  hipY: number;
  hipX: number;
  pelvisW: number;
  pelvisH: number;
  pelvisD: number;
  waistY: number;
  chestH: number;
  chestW: number;
  chestD: number;
  neckY: number;
  shoulderY: number;
  shoulderX: number;
  uArmLen: number;
  lArmLen: number;
  armR: number;
  foreR: number;
  handR: number;
  legR: number;
  shinR: number;
  headR: number;
  /** Head sphere center above the neck joint. */
  headOff: number;
  /** Top of the head (without hats). */
  height: number;
}

export function computeDims(L: Look): Dims {
  const s = L.height;
  const b = L.build;
  const sb = Math.sqrt(b);
  const footH = 0.095 * s;
  const shinLen = 0.39 * s;
  const thighLen = 0.39 * s;
  const hipY = footH + shinLen + thighLen;
  const chestW = 0.45 * s * b;
  const chestH = 0.44 * s;
  const waistY = hipY + 0.09 * s;
  const neckY = waistY + chestH;
  const headR = 0.185 * s * L.headScale;
  const headOff = 0.035 * s + headR * 1.03;
  const armR = 0.071 * s * sb;
  return {
    s,
    b,
    footH,
    footL: 0.3 * s * (0.92 + 0.08 * b),
    footW: 0.145 * s * sb,
    footZ: 0.045 * s,
    shinLen,
    thighLen,
    hipY,
    hipX: 0.105 * s * b,
    pelvisW: 0.38 * s * b,
    pelvisH: 0.22 * s,
    pelvisD: 0.27 * s * b,
    waistY,
    chestH,
    chestW,
    chestD: 0.28 * s * b,
    neckY,
    shoulderY: neckY - 0.075 * s,
    shoulderX: chestW / 2 + armR * 0.95,
    uArmLen: 0.27 * s,
    lArmLen: 0.23 * s,
    armR,
    foreR: 0.063 * s * sb,
    handR: 0.098 * s,
    legR: 0.102 * s * b,
    shinR: 0.086 * s * sb,
    headR,
    headOff,
    height: neckY + headOff + headR * 1.07,
  };
}

/** Bind-pose (model space) positions of every bone. */
export function bindPositions(d: Dims): Record<BoneName, THREE.Vector3> {
  const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  const elbowY = d.shoulderY - d.uArmLen;
  const kneeY = d.hipY - d.thighLen;
  return {
    pelvis: V(0, d.hipY),
    chest: V(0, d.waistY),
    head: V(0, d.neckY),
    uArmL: V(d.shoulderX, d.shoulderY),
    lArmL: V(d.shoulderX, elbowY),
    uArmR: V(-d.shoulderX, d.shoulderY),
    lArmR: V(-d.shoulderX, elbowY),
    thighL: V(d.hipX, d.hipY),
    shinL: V(d.hipX, kneeY),
    thighR: V(-d.hipX, d.hipY),
    shinR: V(-d.hipX, kneeY),
  };
}

// ------------------------------------------------------------------ geometry helpers

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function M(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

function shade(c: number, k: number) {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * k));
  const b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

const sphereGeo = (r: number, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const capGeo = (r: number, thetaLen: number, phiStart = 0, phiLen = Math.PI * 2, thetaStart = 0, w = 14, h = 7) =>
  new THREE.SphereGeometry(r, w, h, phiStart, phiLen, thetaStart, thetaLen);
const cylGeo = (rt: number, rb: number, h: number, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
function rboxGeo(w: number, h: number, d: number, r: number, seg = 2) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  g.deleteAttribute('uv');
  return mergeVertices(g, 1e-4);
}

class PartBuilder {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a geometry (consumed) with a flat color, rigidly skinned to `bone`, transformed by `m` (model space). */
  add(geo: THREE.BufferGeometry, color: number, bone: BoneName, m?: THREE.Matrix4) {
    let g = geo;
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.index) g = mergeVertices(g, 1e-4);
    if (m) g.applyMatrix4(m);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const n = pos.count;
    const col = new Float32Array(n * 3);
    safeColor(color, _c);
    for (let i = 0; i < n; i++) {
      // cheap baked "toy AO": undersides a touch darker
      const k = 0.8 + 0.2 * (nor.getY(i) * 0.5 + 0.5);
      col[i * 3] = _c.r * k;
      col[i * 3 + 1] = _c.g * k;
      col[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const bi = BI[bone];
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.parts.push(g);
  }

  /** Tapered cylinder between two heights on a vertical axis at (x, z). */
  vcyl(x: number, z: number, yTop: number, yBot: number, rTop: number, rBot: number, color: number, bone: BoneName, seg = 10) {
    const h = Math.max(0.005, yTop - yBot);
    this.add(cylGeo(rTop, rBot, h, seg), color, bone, M(x, (yTop + yBot) / 2, z));
  }

  /** Capsule/cylinder from a to b (any direction). */
  segment(a: THREE.Vector3, b: THREE.Vector3, r: number, color: number, bone: BoneName, capsule = true) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const g = capsule ? new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, 8) : cylGeo(r, r, len, 8);
    this.add(g, color, bone, _m.compose(mid, q, _s.set(1, 1, 1)));
  }

  merge(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}

/** Rounded torso box whose bottom is narrower than its top. */
function taperedBox(w: number, h: number, d: number, r: number, bottomScale: number) {
  const g = rboxGeo(w, h, d, r);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + h / 2) / h;
    pos.setX(i, pos.getX(i) * (bottomScale + (1 - bottomScale) * t));
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ shared resources

let bodyMat: THREE.MeshStandardMaterial | null = null;
export function bodyMaterial() {
  if (!bodyMat) {
    bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
    bodyMat.name = 'npcBody';
  }
  return bodyMat;
}

let faceGeo: THREE.BufferGeometry | null = null;
function faceGeometry() {
  if (!faceGeo) {
    faceGeo = new THREE.SphereGeometry(1.014, 20, 14, Math.PI / 2 - FACE_PHI, FACE_PHI * 2, FACE_T0, FACE_TL);
  }
  return faceGeo;
}
let planeGeo: THREE.PlaneGeometry | null = null;
const plane = () => (planeGeo ??= new THREE.PlaneGeometry(1, 1));

// ------------------------------------------------------------------ the rig

export interface HumanRig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Bind local position of each bone relative to its parent bone (pelvis: relative to root). */
  bindLocal: Record<BoneName, THREE.Vector3>;
  bindWorld: Record<BoneName, THREE.Vector3>;
  dims: Dims;
  face: THREE.Mesh;
  faceStyle: FaceStyle;
  /** Attachment points at the palms (children of the forearm bones). */
  handR: THREE.Object3D;
  handL: THREE.Object3D;
  setExpression(e: Expression, clean?: boolean): void;
  dispose(): void;
}

export function buildHuman(L: Look): HumanRig {
  const d = computeDims(L);
  const B = new PartBuilder();
  const bind = bindPositions(d);
  const s = d.s;
  const skin = L.skin;
  const top = L.top;
  const ts = L.topStyle;
  const longSleeve = ['longsleeve', 'hoodie', 'jacket', 'suit', 'uniform', 'cardigan', 'gown'].includes(ts);
  const sleeveless = ts === 'tank' || ts === 'salmon';
  const kneeY = d.hipY - d.thighLen;
  const elbowY = d.shoulderY - d.uArmLen;
  const wristY = elbowY - d.lArmLen;
  const hc = d.neckY + d.headOff; // head center (model space)
  const hr = d.headR;
  const pantsLegs = L.bottomStyle === 'pants' || L.bottomStyle === 'overalls';

  // ---------------------------------------------------------------- legs
  for (const side of [1, -1] as const) {
    const x = side * d.hipX;
    const thigh: BoneName = side > 0 ? 'thighL' : 'thighR';
    const shin: BoneName = side > 0 ? 'shinL' : 'shinR';
    if (pantsLegs) {
      B.vcyl(x, 0, d.hipY + 0.02 * s, kneeY, d.legR, d.shinR * 1.08, L.bottom, thigh);
      B.add(sphereGeo(d.shinR * 1.08, 10, 7), L.bottom, shin, M(x, kneeY, 0));
    } else if (L.bottomStyle === 'shorts') {
      const mid = d.hipY - d.thighLen * 0.5;
      B.vcyl(x, 0, d.hipY + 0.02 * s, mid, d.legR * 1.08, d.legR * 1.02, L.bottom, thigh);
      B.vcyl(x, 0, mid, kneeY, d.legR * 0.86, d.shinR * 1.0, skin, thigh);
      B.add(sphereGeo(d.shinR * 1.0, 10, 7), skin, shin, M(x, kneeY, 0));
    } else {
      B.vcyl(x, 0, d.hipY, kneeY, d.legR * 0.88, d.shinR * 1.0, skin, thigh);
      B.add(sphereGeo(d.shinR * 1.0, 10, 7), skin, shin, M(x, kneeY, 0));
    }
    // shin
    const shinColor = pantsLegs ? L.bottom : skin;
    if (L.boots != null) {
      const bootTop = d.footH + d.shinLen * 0.55;
      B.vcyl(x, 0, kneeY, bootTop, d.shinR, d.shinR * 0.95, shinColor, shin);
      B.vcyl(x, 0, bootTop, d.footH * 0.6, d.shinR * 1.12, d.shinR * 1.05, L.boots, shin);
    } else {
      B.vcyl(x, 0, kneeY, d.footH * 0.8, d.shinR * (pantsLegs ? 1.05 : 0.95), d.shinR * (pantsLegs ? 0.98 : 0.78), shinColor, shin);
      if (L.socks != null && !pantsLegs) B.vcyl(x, 0, d.footH + 0.09 * s, d.footH * 0.7, d.shinR * 0.86, d.shinR * 0.84, L.socks, shin);
    }
    // big shoe
    B.add(rboxGeo(d.footW, d.footH, d.footL, 0.04 * s), L.boots ?? L.shoes, shin, M(x, d.footH * 0.55, d.footZ));
    B.add(rboxGeo(d.footW * 1.05, 0.026 * s, d.footL * 1.03, 0.011 * s), L.soles, shin, M(x, 0.013 * s, d.footZ));
  }

  // ---------------------------------------------------------------- pelvis
  const pelvisColor = L.bottomStyle === 'skirt' ? L.bottom : L.bottom;
  B.add(rboxGeo(d.pelvisW, d.pelvisH, d.pelvisD, 0.07 * s), pelvisColor, 'pelvis', M(0, d.hipY + 0.03 * s, 0));
  if (L.bottomStyle === 'skirt') {
    B.vcyl(0, 0, d.waistY - 0.01 * s, kneeY + 0.12 * s, d.pelvisW * 0.52, d.pelvisW * 0.74, L.bottom, 'pelvis', 14);
  }
  if (L.belt != null) {
    B.add(rboxGeo(d.pelvisW * 1.03, 0.045 * s, d.pelvisD * 1.05, 0.02 * s), L.belt, 'pelvis', M(0, d.waistY - 0.03 * s, 0));
    B.add(rboxGeo(0.05 * s, 0.035 * s, 0.015 * s, 0.006 * s), 0xd9b64a, 'pelvis', M(0, d.waistY - 0.03 * s, d.pelvisD * 0.53));
  }
  if (L.fannyPack != null) {
    B.add(rboxGeo(0.2 * s, 0.09 * s, 0.075 * s, 0.03 * s), L.fannyPack, 'pelvis', M(0, d.waistY - 0.06 * s, d.pelvisD * 0.5 + 0.03 * s));
  }
  if (ts === 'gown') {
    B.vcyl(0, 0, d.waistY + 0.02 * s, d.footH + d.shinLen * 0.42, d.chestW * 0.56, d.chestW * 0.86, top, 'pelvis', 16);
  }
  if (ts === 'salmon') {
    // tail fin sticking out the back
    B.add(new THREE.ConeGeometry(0.1 * s, 0.26 * s, 8), top, 'pelvis', M(0, d.hipY + 0.06 * s, -d.pelvisD * 0.5 - 0.12 * s, -Math.PI / 2 - 0.35, 0, 0));
    B.add(rboxGeo(0.035 * s, 0.34 * s, 0.17 * s, 0.015 * s), shade(top, 0.9), 'pelvis', M(0, d.hipY + 0.14 * s, -d.pelvisD * 0.5 - 0.28 * s, 0.35, 0, 0));
  }

  // ---------------------------------------------------------------- chest
  const cy = d.waistY + d.chestH / 2;
  const front = d.chestD / 2;
  const torsoColor = top;
  B.add(taperedBox(d.chestW, d.chestH, d.chestD, 0.085 * s, 0.86), torsoColor, 'chest', M(0, cy, 0));
  // neck
  B.vcyl(0, 0, d.neckY + 0.07 * s, d.neckY - 0.04 * s, 0.062 * s, 0.066 * s, skin, 'chest');
  const collar = (c: number) => B.add(new THREE.TorusGeometry(0.075 * s, 0.02 * s, 6, 14), c, 'chest', M(0, d.neckY - 0.004, 0, Math.PI / 2, 0, 0, 1, 1, 0.9));
  switch (ts) {
    case 'tee':
    case 'longsleeve':
    case 'tank':
      collar(shade(top, 0.82));
      break;
    case 'polo':
      collar(L.topAccent);
      for (const yy of [0.06, 0.11]) B.add(sphereGeo(0.01 * s, 6, 4), L.topAccent, 'chest', M(0, d.neckY - yy * s, front + 0.004));
      break;
    case 'hoodie': {
      B.add(sphereGeo(0.13 * s, 12, 8), top, 'chest', M(0, d.neckY - 0.01 * s, -d.chestD * 0.42, 0, 0, 0, 1.35, 0.72, 0.8));
      for (const sx of [-1, 1]) B.segment(new THREE.Vector3(sx * 0.035 * s, d.neckY - 0.03 * s, front + 0.012 * s), new THREE.Vector3(sx * 0.04 * s, d.neckY - 0.15 * s, front + 0.012 * s), 0.008 * s, L.topAccent, 'chest');
      B.add(rboxGeo(d.chestW * 0.6, d.chestH * 0.26, 0.02 * s, 0.01 * s), shade(top, 0.88), 'chest', M(0, d.waistY + d.chestH * 0.2, front + 0.006 * s));
      collar(shade(top, 0.85));
      break;
    }
    case 'jacket':
    case 'cardigan': {
      B.add(rboxGeo(d.chestW * 0.3, d.chestH * 0.94, 0.02 * s, 0.008 * s), L.topAccent, 'chest', M(0, cy, front + 0.002));
      collar(ts === 'jacket' ? shade(top, 0.8) : L.topAccent);
      if (ts === 'cardigan') for (let i = 0; i < 3; i++) B.add(sphereGeo(0.014 * s, 6, 4), 0xf4ead0, 'chest', M(d.chestW * 0.16, d.waistY + d.chestH * (0.25 + i * 0.22), front + 0.012 * s));
      else B.add(rboxGeo(0.012 * s, d.chestH * 0.9, 0.01 * s, 0.004), 0xb0b0b0, 'chest', M(d.chestW * 0.155, cy, front + 0.012 * s));
      break;
    }
    case 'suit': {
      B.add(rboxGeo(d.chestW * 0.26, d.chestH * 0.5, 0.02 * s, 0.008 * s), L.topAccent, 'chest', M(0, d.neckY - d.chestH * 0.25, front + 0.002));
      if (L.tie != null) {
        B.add(rboxGeo(0.05 * s, d.chestH * 0.5, 0.014 * s, 0.006 * s), L.tie, 'chest', M(0, d.neckY - d.chestH * 0.3, front + 0.016 * s));
        B.add(sphereGeo(0.024 * s, 8, 6), L.tie, 'chest', M(0, d.neckY - 0.03 * s, front + 0.02 * s));
      }
      for (const sx of [-1, 1]) B.add(rboxGeo(0.05 * s, d.chestH * 0.42, 0.016 * s, 0.006), shade(top, 0.75), 'chest', M(sx * d.chestW * 0.15, d.neckY - d.chestH * 0.26, front + 0.008 * s, 0, 0, sx * 0.35));
      for (let i = 0; i < 2; i++) B.add(sphereGeo(0.012 * s, 6, 4), 0x111111, 'chest', M(0.045 * s, d.waistY + d.chestH * (0.12 + i * 0.16), front + 0.008 * s));
      collar(L.topAccent);
      break;
    }
    case 'uniform': {
      for (const sx of [-1, 1]) {
        B.add(rboxGeo(0.105 * s, 0.09 * s, 0.018 * s, 0.01 * s), L.topAccent, 'chest', M(sx * d.chestW * 0.24, d.waistY + d.chestH * 0.66, front + 0.006 * s));
        B.add(rboxGeo(0.1 * s, 0.022 * s, 0.075 * s, 0.008 * s), L.topAccent, 'chest', M(sx * d.chestW * 0.4, d.neckY - 0.012 * s, 0));
      }
      if (L.badge) {
        // generic gold shield — deliberately no real agency insignia
        B.add(rboxGeo(0.058 * s, 0.07 * s, 0.014 * s, 0.018 * s), 0xe0b53a, 'chest', M(d.chestW * 0.24, d.waistY + d.chestH * 0.84, front + 0.012 * s));
        B.add(rboxGeo(0.075 * s, 0.02 * s, 0.01 * s, 0.004 * s), 0x1d1d1d, 'chest', M(-d.chestW * 0.24, d.waistY + d.chestH * 0.84, front + 0.01 * s));
      }
      for (let i = 0; i < 3; i++) B.add(sphereGeo(0.012 * s, 6, 4), 0x6b5a3a, 'chest', M(0, d.waistY + d.chestH * (0.18 + i * 0.25), front + 0.006 * s));
      collar(shade(top, 0.85));
      break;
    }
    case 'gown': {
      for (const sx of [-1, 1]) B.add(rboxGeo(d.chestW * 0.13, d.chestH * 1.02, 0.018 * s, 0.008 * s), L.topAccent, 'chest', M(sx * d.chestW * 0.17, cy, front + 0.004 * s));
      B.add(sphereGeo(0.14 * s, 12, 8), L.topAccent, 'chest', M(0, d.neckY - 0.05 * s, -d.chestD * 0.4, 0, 0, 0, 1.4, 0.6, 0.6));
      collar(L.topAccent);
      break;
    }
    case 'hawaiian': {
      collar(L.topAccent);
      const flowers: [number, number, number][] = [
        [-0.3, 0.25, 1], [0.28, 0.4, 1], [-0.05, 0.62, 1], [0.32, 0.8, 1], [-0.33, 0.78, 1], [0.08, 0.2, 1],
        [-0.25, 0.35, -1], [0.22, 0.55, -1], [-0.1, 0.8, -1], [0.3, 0.18, -1], [0.05, 0.45, -1],
      ];
      flowers.forEach(([fx, fy, fz], i) => {
        const c = i % 2 ? L.topAccent : 0xffffff;
        B.add(sphereGeo(0.03 * s, 8, 5), c, 'chest', M(fx * d.chestW, d.waistY + fy * d.chestH, fz * (front + 0.001), 0, 0, 0, 1, 1, 0.3));
      });
      break;
    }
    case 'salmon': {
      B.add(sphereGeo(1, 16, 12), top, 'chest', M(0, cy - 0.01 * s, 0.015 * s, 0, 0, 0, d.chestW * 0.66, d.chestH * 0.7, d.chestD * 0.95));
      B.add(sphereGeo(1, 14, 10), L.topAccent, 'chest', M(0, cy - 0.04 * s, d.chestD * 0.5, 0, 0, 0, d.chestW * 0.46, d.chestH * 0.5, d.chestD * 0.36));
      B.add(rboxGeo(0.028 * s, 0.16 * s, 0.22 * s, 0.012 * s), shade(top, 0.82), 'chest', M(0, d.neckY - 0.01 * s, -d.chestD * 0.62, -0.55, 0, 0));
      for (const sx of [-1, 1]) {
        B.add(sphereGeo(0.06 * s, 8, 6), shade(top, 0.85), 'chest', M(sx * d.chestW * 0.66, cy - 0.06 * s, 0.03 * s, 0, 0, sx * 0.6, 0.35, 1.2, 0.8));
        for (let i = 0; i < 3; i++) B.add(sphereGeo(0.018 * s, 6, 4), 0x9b4a3a, 'chest', M(sx * d.chestW * 0.6, cy + (0.06 - i * 0.06) * s, -d.chestD * 0.25 + i * 0.05 * s, 0, 0, 0, 0.5, 1, 1));
      }
      // race bib
      B.add(rboxGeo(0.15 * s, 0.11 * s, 0.012 * s, 0.006 * s), 0xffffff, 'chest', M(0, cy + 0.02 * s, d.chestD * 0.86, -0.3, 0, 0));
      B.add(rboxGeo(0.07 * s, 0.035 * s, 0.006 * s, 0.003 * s), 0x1d1d1d, 'chest', M(0, cy + 0.025 * s, d.chestD * 0.87 + 0.008 * s, -0.3, 0, 0));
      break;
    }
  }
  if (L.apron != null) {
    B.add(rboxGeo(d.chestW * 0.74, d.chestH * 0.62, 0.02 * s, 0.01 * s), L.apron, 'chest', M(0, d.waistY + d.chestH * 0.33, front + 0.006 * s));
    for (const sx of [-1, 1]) {
      B.add(rboxGeo(0.045 * s, d.chestH * 0.42, 0.012 * s, 0.005), L.apron, 'chest', M(sx * d.chestW * 0.27, d.waistY + d.chestH * 0.8, front + 0.005 * s));
      B.add(rboxGeo(0.045 * s, d.chestH * 0.9, 0.012 * s, 0.005), L.apron, 'chest', M(sx * d.chestW * 0.27, d.waistY + d.chestH * 0.55, -front - 0.005 * s));
      B.add(rboxGeo(0.045 * s, 0.02 * s, d.chestD * 1.02, 0.005), L.apron, 'chest', M(sx * d.chestW * 0.27, d.neckY - 0.012 * s, 0));
    }
  }
  if (L.vest != null) {
    B.add(taperedBox(d.chestW * 1.07, d.chestH * 0.93, d.chestD * 1.15, 0.09 * s, 0.9), L.vest, 'chest', M(0, d.waistY + d.chestH * 0.47, 0));
    for (const yy of [0.33, 0.62]) B.add(rboxGeo(d.chestW * 1.02, 0.018 * s, d.chestD * 1.18, 0.008 * s), shade(L.vest, 1.6), 'chest', M(0, d.waistY + d.chestH * yy, 0));
  }
  if (L.sash != null) {
    const rot = -0.62;
    B.add(rboxGeo(0.085 * s, d.chestH * 1.5, d.chestD * 1.12, 0.012 * s), L.sash, 'chest', M(0, cy, 0, 0, 0, rot));
    B.add(cylGeo(0.036 * s, 0.036 * s, 0.012 * s, 12), 0xf2c94c, 'chest', M(-d.chestW * 0.28, d.waistY + d.chestH * 0.18, front + 0.03 * s, Math.PI / 2, 0, 0));
  }
  if (L.camera) {
    const camY = d.neckY - 0.24 * s;
    const camZ = front + 0.05 * s;
    B.add(rboxGeo(0.12 * s, 0.075 * s, 0.06 * s, 0.012 * s), 0x262626, 'chest', M(0, camY, camZ));
    B.add(cylGeo(0.03 * s, 0.03 * s, 0.05 * s, 12), 0x141414, 'chest', M(0, camY, camZ + 0.05 * s, Math.PI / 2, 0, 0));
    B.add(cylGeo(0.022 * s, 0.022 * s, 0.01 * s, 12), 0x5b86b0, 'chest', M(0, camY, camZ + 0.076 * s, Math.PI / 2, 0, 0));
    for (const sx of [-1, 1]) B.segment(new THREE.Vector3(sx * 0.05 * s, camY + 0.03 * s, camZ), new THREE.Vector3(sx * 0.07 * s, d.neckY - 0.01 * s, 0.03 * s), 0.008 * s, 0x2b2b2b, 'chest', false);
  }
  if (L.backpack != null) {
    B.add(rboxGeo(d.chestW * 0.72, d.chestH * 0.74, 0.15 * s, 0.05 * s), L.backpack, 'chest', M(0, d.waistY + d.chestH * 0.52, -front - 0.07 * s));
    for (const sx of [-1, 1]) B.add(rboxGeo(0.04 * s, d.chestH * 0.62, 0.012 * s, 0.005), shade(L.backpack, 0.7), 'chest', M(sx * d.chestW * 0.27, d.waistY + d.chestH * 0.66, front + 0.004 * s));
  }

  // ---------------------------------------------------------------- arms
  for (const side of [1, -1] as const) {
    const x = side * d.shoulderX;
    const ua: BoneName = side > 0 ? 'uArmL' : 'uArmR';
    const la: BoneName = side > 0 ? 'lArmL' : 'lArmR';
    const sleeve = ts === 'gown' ? top : ts === 'hoodie' || ts === 'jacket' || ts === 'suit' || ts === 'cardigan' || ts === 'uniform' ? top : top;
    const upperColor = sleeveless ? skin : sleeve;
    B.add(sphereGeo(d.armR * 1.25, 10, 8), upperColor, ua, M(x, d.shoulderY, 0));
    if (ts === 'gown') {
      B.vcyl(x, 0, d.shoulderY, elbowY, d.armR * 1.35, d.armR * 1.7, top, ua);
    } else if (longSleeve || sleeveless) {
      B.vcyl(x, 0, d.shoulderY, elbowY, d.armR * 1.08, d.armR * 0.96, upperColor, ua);
    } else {
      const mid = d.shoulderY - d.uArmLen * 0.52;
      B.vcyl(x, 0, d.shoulderY, mid, d.armR * 1.2, d.armR * 1.18, sleeve, ua);
      B.vcyl(x, 0, mid, elbowY, d.armR * 0.9, d.armR * 0.86, skin, ua);
    }
    if (ts === 'uniform') B.add(sphereGeo(0.036 * s, 8, 6), 0x3f6e3a, ua, M(x + side * d.armR * 1.02, d.shoulderY - 0.09 * s, 0, 0, 0, 0, 0.3, 1.1, 1));
    const foreColor = longSleeve ? sleeve : skin;
    B.add(sphereGeo(d.foreR * 1.12, 10, 7), foreColor, la, M(x, elbowY, 0));
    if (ts === 'gown') {
      B.vcyl(x, 0, elbowY, wristY + 0.02 * s, d.foreR * 1.6, d.foreR * 2.4, top, la);
      B.vcyl(x, 0, wristY + 0.05 * s, wristY, d.foreR * 0.9, d.foreR * 0.85, skin, la);
    } else {
      B.vcyl(x, 0, elbowY, wristY, d.foreR, d.foreR * 0.85, foreColor, la);
      if (longSleeve) B.vcyl(x, 0, wristY + 0.035 * s, wristY - 0.005 * s, d.foreR * 1.05, d.foreR * 1.02, shade(sleeve, 0.85), la);
    }
    // big mitten hand + thumb
    const hy = wristY - d.handR * 0.72;
    B.add(sphereGeo(d.handR, 12, 9), skin, la, M(x, hy, 0.005, 0, 0, 0, 0.62, 1.0, 0.86));
    B.add(sphereGeo(d.handR * 0.36, 8, 6), skin, la, M(x - side * d.handR * 0.08, wristY - d.handR * 0.45, d.handR * 0.66));
    if (side > 0 && L.foamFinger != null) {
      B.add(rboxGeo(0.085 * s, 0.17 * s, 0.15 * s, 0.035 * s), L.foamFinger, la, M(x, wristY - 0.1 * s, 0.02 * s));
      B.add(new THREE.CapsuleGeometry(0.032 * s, 0.13 * s, 3, 8), L.foamFinger, la, M(x, wristY - 0.28 * s, 0.05 * s));
    }
  }

  // ---------------------------------------------------------------- head
  B.add(sphereGeo(hr, 18, 14), skin, 'head', M(0, hc, 0, 0, 0, 0, 1, 1.07, 0.98));
  for (const sx of [-1, 1]) B.add(sphereGeo(hr * 0.24, 8, 6), skin, 'head', M(sx * hr * 0.97, hc - hr * 0.08, -hr * 0.04, 0, 0, 0, 0.5, 1, 0.78));
  B.add(sphereGeo(hr * 0.19, 10, 8), shade(skin, 0.94), 'head', M(0, hc - hr * 0.13, hr * 0.97, 0, 0, 0, 0.9, 0.78, 0.72));
  buildHair(B, L, hc, hr, s);
  buildHat(B, L, hc, hr, s);
  if (L.facialHair === 'beard') {
    B.add(capGeo(hr * 1.045, 0.82, Math.PI / 2 - 1.35, 2.7, 1.98, 16, 6), L.hair, 'head', M(0, hc, 0, 0, 0, 0, 1, 1.07, 0.98));
  }
  if (L.vest != null && L.print === 'slopcorp') {
    // AirPods, obviously
    for (const sx of [-1, 1]) B.add(sphereGeo(0.016 * s, 6, 4), 0xffffff, 'head', M(sx * hr * 1.08, hc - hr * 0.12, 0.01));
  }

  const geo = B.merge();

  // ---------------------------------------------------------------- skeleton
  const root = new THREE.Group();
  root.name = 'npc';
  const bones = {} as Record<BoneName, THREE.Bone>;
  const bindLocal = {} as Record<BoneName, THREE.Vector3>;
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONES) {
    const parent = BONE_PARENT[name];
    const local = bind[name].clone();
    if (parent) local.sub(bind[parent]);
    bindLocal[name] = local;
    bones[name].position.copy(local);
    (parent ? bones[parent] : root).add(bones[name]);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(BONES.map((n) => bones[n]));
  const mesh = new THREE.SkinnedMesh(geo, bodyMaterial());
  mesh.frustumCulled = false; // bounds are handled per-NPC by the system
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  mesh.bind(skeleton, new THREE.Matrix4());
  // Pre-seed bounds from the bind pose so Box3.setFromObject (UI bubble anchoring, photo mode…) doesn't run the
  // per-vertex skinned bounds computation.
  geo.computeBoundingBox();
  mesh.boundingBox = geo.boundingBox!.clone();
  mesh.boundingSphere = geo.boundingSphere!.clone();

  // ---------------------------------------------------------------- decals
  const faceStyle: FaceStyle = {
    brow: L.hairStyle === 'bald' && L.hair === L.skin ? 0x3a2a22 : L.hair,
    lashes: L.lashes,
    glasses: L.glasses,
    mustache: L.facialHair === 'mustache' || L.facialHair === 'beard' ? L.hair : null,
  };
  const face = new THREE.Mesh(faceGeometry(), faceMaterial(faceStyle, 'neutral'));
  face.name = 'face';
  face.position.set(0, d.headOff, 0);
  face.scale.set(hr, hr * 1.07, hr * 0.98);
  face.renderOrder = 1;
  bones.head.add(face);

  if (L.print !== 'none') {
    const pm = new THREE.Mesh(plane(), printMaterial(L.print));
    pm.name = 'print';
    if (L.print === 'jimothy') {
      const w = Math.min(d.chestW - 0.17 * s, 0.27 * s);
      pm.scale.set(w, w, 1);
      pm.position.set(0, d.chestH * 0.5, d.chestD / 2 + 0.003);
    } else {
      const w = Math.min(d.chestW * 0.8, 0.3 * s);
      pm.scale.set(w, w * (96 / 256), 1);
      pm.position.set(0, d.chestH * 0.62, d.chestD * 0.575 + 0.003);
    }
    pm.renderOrder = 1;
    bones.chest.add(pm);
  }

  const handR = new THREE.Object3D();
  handR.name = 'handR';
  handR.position.set(0, -(d.lArmLen + d.handR * 0.75), d.handR * 0.2);
  bones.lArmR.add(handR);
  const handL = new THREE.Object3D();
  handL.name = 'handL';
  handL.position.set(0, -(d.lArmLen + d.handR * 0.75), d.handR * 0.2);
  bones.lArmL.add(handL);

  let curExpr: Expression = 'neutral';
  let curClean = false;
  const rig: HumanRig = {
    root,
    mesh,
    bones,
    bindLocal,
    bindWorld: bind,
    dims: d,
    face,
    faceStyle,
    handR,
    handL,
    setExpression(e: Expression, clean = curClean) {
      if (e === curExpr && clean === curClean) return;
      curExpr = e;
      curClean = clean;
      face.material = faceMaterial(faceStyle, e, clean);
    },
    dispose() {
      root.removeFromParent();
      mesh.geometry.dispose();
      mesh.skeleton.dispose();
    },
  };
  return rig;
}

// ------------------------------------------------------------------ hair & hats

function buildHair(B: PartBuilder, L: Look, hc: number, hr: number, s: number) {
  const hair = L.hair;
  const style = L.hairStyle;
  // Hats hide most hair: keep a short base so there's no bald ring under brims.
  const hatty = L.hat === 'ranger' || L.hat === 'sunhat' || L.hat === 'beanie' || L.hat === 'salmonhood' || L.hat === 'mortarboard';
  const shortCap = (r = 1.06, tl = 1.35, tilt = -0.3) => B.add(capGeo(hr * r, tl), hair, 'head', M(0, hc, 0, tilt, 0, 0, 1, 1.07, 0.98));
  const backSides = (r: number, tl: number, gap: number) =>
    B.add(capGeo(hr * r, tl, Math.PI / 2 + gap, Math.PI * 2 - gap * 2), hair, 'head', M(0, hc, 0, 0, 0, 0, 1, 1.07, 0.98));
  if (hatty && style !== 'long' && style !== 'bun' && style !== 'ponytail') {
    if (style !== 'bald') backSides(1.05, 1.75, 1.2);
    return;
  }
  switch (style) {
    case 'bald':
      B.add(capGeo(hr * 1.035, 0.5, Math.PI / 2 + 1.25, Math.PI * 2 - 2.5, 1.3, 14, 4), hair, 'head', M(0, hc, 0, 0, 0, 0, 1, 1.07, 0.98));
      break;
    case 'buzz':
      shortCap(1.025, 1.4, -0.25);
      break;
    case 'short':
      shortCap();
      break;
    case 'sidepart':
      shortCap();
      B.add(sphereGeo(hr * 0.55, 10, 7), hair, 'head', M(hr * 0.28, hc + hr * 0.82, hr * 0.28, 0.2, 0, -0.3, 1.2, 0.5, 1.1));
      break;
    case 'spiky':
      shortCap();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const tilt = 0.55;
        const dir = new THREE.Vector3(Math.sin(a) * Math.sin(tilt), Math.cos(tilt), Math.cos(a) * Math.sin(tilt) - 0.25).normalize();
        const base = dir.clone().multiplyScalar(hr * 0.95).add(new THREE.Vector3(0, hc, 0));
        const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
        B.add(new THREE.ConeGeometry(0.04 * s, 0.1 * s, 6), hair, 'head', _m.compose(base.addScaledVector(dir, 0.04 * s), q, _s.set(1, 1, 1)));
      }
      break;
    case 'bob':
    case 'long':
      B.add(capGeo(hr * 1.1, 1.0), hair, 'head', M(0, hc, 0, -0.1, 0, 0, 1, 1.07, 0.98));
      backSides(1.11, 1.95, 0.95);
      if (style === 'long') B.add(rboxGeo(hr * 1.8, hr * 1.5, hr * 0.45, hr * 0.2), hair, 'head', M(0, hc - hr * 0.95, -hr * 0.6));
      break;
    case 'ponytail': {
      if (!hatty) shortCap(1.05, 1.35, -0.25);
      else backSides(1.05, 1.75, 1.2);
      const a = new THREE.Vector3(0, hc + hr * 0.25, -hr * 1.02);
      const b = new THREE.Vector3(0, hc - hr * 0.75, -hr * 1.45);
      B.segment(a, b, hr * 0.24, hair, 'head');
      B.add(sphereGeo(hr * 0.17, 8, 6), 0xe8534a, 'head', M(0, hc + hr * 0.2, -hr * 1.03));
      break;
    }
    case 'bun':
      if (!hatty) shortCap(1.04, 1.4, -0.2);
      else backSides(1.05, 1.75, 1.2);
      B.add(sphereGeo(hr * 0.42, 12, 9), hair, 'head', M(0, hc + hr * 0.75, -hr * 0.62));
      break;
    case 'afro':
      B.add(capGeo(hr * 1.42, 0.75), hair, 'head', M(0, hc + hr * 0.2, -hr * 0.12));
      B.add(capGeo(hr * 1.42, 2.25, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, 16, 9), hair, 'head', M(0, hc + hr * 0.2, -hr * 0.12));
      break;
    case 'curly':
      shortCap(1.05, 1.35, -0.3);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.3;
        const t = i % 2 ? 0.55 : 1.0;
        const dir = new THREE.Vector3(Math.sin(a) * Math.sin(t), Math.cos(t), Math.cos(a) * Math.sin(t) - (Math.cos(a) > 0.3 ? 0.5 : 0)).normalize();
        B.add(sphereGeo(hr * 0.27, 8, 6), hair, 'head', M(dir.x * hr * 1.0, hc + dir.y * hr * 1.07, dir.z * hr * 0.98));
      }
      break;
    case 'mohawk':
      B.add(rboxGeo(hr * 0.3, hr * 0.6, hr * 1.75, hr * 0.12), hair, 'head', M(0, hc + hr * 0.92, -hr * 0.08));
      break;
  }
}

function buildHat(B: PartBuilder, L: Look, hc: number, hr: number, s: number) {
  const c = L.hatColor;
  switch (L.hat) {
    case 'cap':
    case 'capback': {
      const back = L.hat === 'capback' ? Math.PI : 0;
      const m = new THREE.Matrix4().makeRotationY(back);
      const place = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
        new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().makeTranslation(0, hc, 0), m).multiply(M(x, y - hc, z, rx, ry, rz, sx, sy, sz).clone());
      B.add(capGeo(hr * 1.1, 1.3), c, 'head', place(0, hc + hr * 0.02, 0, -0.12, 0, 0, 1, 1.07, 0.98));
      B.add(cylGeo(hr * 0.78, hr * 0.78, 0.02 * s, 16), shade(c, 0.85), 'head', place(0, hc + hr * 0.4, hr * 0.92, 0.12, 0, 0, 1, 1, 1.2));
      B.add(sphereGeo(hr * 0.1, 6, 4), shade(c, 0.8), 'head', place(0, hc + hr * 1.16, 0));
      break;
    }
    case 'beanie':
      B.add(capGeo(hr * 1.13, 1.45), c, 'head', M(0, hc, 0, -0.1, 0, 0, 1, 1.07, 0.98));
      B.vcyl(0, -hr * 0.02, hc + hr * 0.35, hc + hr * 0.02, hr * 1.1, hr * 1.12, shade(c, 0.85), 'head', 16);
      B.add(sphereGeo(hr * 0.3, 10, 7), shade(c, 1.2), 'head', M(0, hc + hr * 1.28, -hr * 0.08));
      break;
    case 'sunhat':
      B.vcyl(0, 0, hc + hr * 1.12, hc + hr * 0.4, hr * 0.95, hr * 1.1, c, 'head', 16);
      B.add(cylGeo(hr * 2.0, hr * 2.05, 0.02 * s, 22), c, 'head', M(0, hc + hr * 0.42, 0));
      B.vcyl(0, 0, hc + hr * 0.62, hc + hr * 0.46, hr * 1.1, hr * 1.12, 0xe8534a, 'head', 16);
      break;
    case 'ranger':
      // "campaign" hat: flat wide brim + pinched 4-sided crown
      B.add(cylGeo(hr * 2.05, hr * 2.05, 0.022 * s, 24), c, 'head', M(0, hc + hr * 0.46, 0));
      B.add(cylGeo(hr * 0.5, hr * 1.02, hr * 0.95, 4), c, 'head', M(0, hc + hr * 0.98, 0, 0, Math.PI / 4, 0));
      B.vcyl(0, 0, hc + hr * 0.66, hc + hr * 0.48, hr * 1.04, hr * 1.06, 0x5a3d22, 'head', 16);
      break;
    case 'mortarboard':
      B.add(capGeo(hr * 1.09, 1.3), c, 'head', M(0, hc, 0, -0.1, 0, 0, 1, 1.07, 0.98));
      B.add(rboxGeo(hr * 2.5, 0.028 * s, hr * 2.5, 0.006), c, 'head', M(0, hc + hr * 1.12, 0, 0, 0.08, 0));
      B.add(cylGeo(0.018 * s, 0.018 * s, 0.015 * s, 8), 0xe0b53a, 'head', M(0, hc + hr * 1.12 + 0.02 * s, 0));
      B.segment(new THREE.Vector3(hr * 1.15, hc + hr * 1.1, hr * 0.2), new THREE.Vector3(hr * 1.2, hc + hr * 0.55, hr * 0.25), 0.012 * s, 0xe0b53a, 'head', false);
      break;
    case 'headband':
      B.vcyl(0, -hr * 0.03, hc + hr * 0.52, hc + hr * 0.3, hr * 1.02, hr * 1.04, c, 'head', 16);
      break;
    case 'salmonhood': {
      B.add(capGeo(hr * 1.14, 1.62), c, 'head', M(0, hc, 0, -0.38, 0, 0, 1, 1.07, 0.98));
      for (const sx of [-1, 1]) {
        B.add(sphereGeo(hr * 0.21, 10, 8), 0xffffff, 'head', M(sx * hr * 0.72, hc + hr * 0.78, hr * 0.28));
        B.add(sphereGeo(hr * 0.12, 8, 6), 0x111111, 'head', M(sx * hr * 0.84, hc + hr * 0.82, hr * 0.36));
      }
      B.add(new THREE.TorusGeometry(hr * 0.2, 0.022 * s, 6, 12), 0xd9534f, 'head', M(0, hc + hr * 1.15, hr * 0.45, -0.9, 0, 0));
      break;
    }
  }
}
