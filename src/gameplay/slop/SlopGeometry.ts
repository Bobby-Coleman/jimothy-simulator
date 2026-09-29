import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../core/Game';
import { emptyRig, type SlopRig } from './SlopMaterial';

/**
 * Builds single-mesh "GPU rigged" geometries for slop creatures: every vertex carries its part index (aPart),
 * whether it's an extra/wrong bit (aExtra) and an emissive boost (aGlow), plus a vertex colour.
 */

type ColorFn = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;

export interface PartOpts {
  part: number;
  color: THREE.ColorRepresentation | ColorFn;
  extra?: boolean;
  glow?: number;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
  matrix?: THREE.Matrix4;
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

export class PartGeo {
  private list: THREE.BufferGeometry[] = [];

  add(src: THREE.BufferGeometry, o: PartOpts) {
    const g = new THREE.BufferGeometry();
    const pos = src.getAttribute('position');
    let nrm = src.getAttribute('normal');
    const tmp = src.clone();
    if (!nrm) {
      tmp.computeVertexNormals();
      nrm = tmp.getAttribute('normal');
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    for (let i = 0; i < pos.count; i++) {
      g.getAttribute('position').setXYZ(i, pos.getX(i), pos.getY(i), pos.getZ(i));
      g.getAttribute('normal').setXYZ(i, nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    }
    if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
    else g.setIndex(Array.from({ length: pos.count }, (_, i) => i));
    tmp.dispose();

    let m = o.matrix;
    if (!m) {
      const s = o.scale == null ? [1, 1, 1] : typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] : o.scale;
      m = new THREE.Matrix4().compose(
        new THREE.Vector3(...(o.pos ?? [0, 0, 0])),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot ?? [0, 0, 0]), 'YXZ')),
        new THREE.Vector3(s[0], s[1], s[2]),
      );
    }
    g.applyMatrix4(m);
    this.push(g, o);
  }

  /** Add an already-transformed geometry that has position/normal (+ optional per-vertex colours). */
  push(g: THREE.BufferGeometry, o: PartOpts, vertexColors?: Float32Array) {
    const n = g.getAttribute('position').count;
    const colors = vertexColors ?? new Float32Array(n * 3);
    if (!vertexColors) {
      const P = g.getAttribute('position');
      const N = g.getAttribute('normal');
      for (let i = 0; i < n; i++) {
        if (typeof o.color === 'function') {
          _p.fromBufferAttribute(P, i);
          _n.fromBufferAttribute(N, i);
          _c.copy(o.color(_p, _n));
        } else _c.set(o.color);
        colors[i * 3] = _c.r;
        colors[i * 3 + 1] = _c.g;
        colors[i * 3 + 2] = _c.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(o.part), 1));
    g.setAttribute('aExtra', new THREE.BufferAttribute(new Float32Array(n).fill(o.extra ? 1 : 0), 1));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(o.glow ?? 0), 1));
    for (const k of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'color', 'aPart', 'aExtra', 'aGlow'].includes(k)) g.deleteAttribute(k);
    }
    if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
    this.list.push(g);
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.list, false);
    if (!merged) throw new Error('slop geometry merge failed');
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    for (const g of this.list) g.dispose();
    this.list = [];
    return merged;
  }
}

// =====================================================================================================
// Slopothy
// =====================================================================================================

/** Slopothy part indices (shared with the animation code). */
export const SP = {
  body: 0,
  armL: 1,
  armR: 2,
  legL: 3,
  legR: 4,
  extraLeg1: 5,
  extraLeg2: 6,
  head: 7,
  tail: 8,
  extraTail: 9,
} as const;

export const SLOP_LEGS = [SP.armL, SP.armR, SP.legL, SP.legR, SP.extraLeg1, SP.extraLeg2];

export interface SlopModelData {
  geometry: THREE.BufferGeometry;
  rig: SlopRig;
  /** Lowest point of the model (feet), model space. */
  footY: number;
  /** Model height (m). */
  height: number;
  fromGlb: boolean;
}

const PART_OF: Record<string, number> = {
  Body: SP.body,
  ArmL: SP.armL,
  HandL: SP.armL,
  ArmR: SP.armR,
  HandR: SP.armR,
  LegL: SP.legL,
  LegR: SP.legR,
  ExtraLeg1: SP.extraLeg1,
  ExtraLeg2: SP.extraLeg2,
  Head: SP.head,
  EarL: SP.head,
  EarR: SP.head,
  EyeL: SP.head,
  EyeR: SP.head,
  Mouth: SP.head,
  Nose: SP.head,
  ExtraEye1: SP.head,
  ExtraEye2: SP.head,
  Tail1: SP.tail,
  Tail2: SP.tail,
  Tail3: SP.tail,
  Tail4: SP.tail,
  Tail5: SP.tail,
  ExtraTail1: SP.extraTail,
  ExtraTail2: SP.extraTail,
  ExtraTail3: SP.extraTail,
};
const PIVOT_NODE: Record<string, number> = {
  ArmL: SP.armL,
  ArmR: SP.armR,
  LegL: SP.legL,
  LegR: SP.legR,
  ExtraLeg1: SP.extraLeg1,
  ExtraLeg2: SP.extraLeg2,
  Head: SP.head,
  Tail1: SP.tail,
  ExtraTail1: SP.extraTail,
};
const EXTRA_NODES = new Set(['ExtraLeg1', 'ExtraLeg2', 'ExtraEye1', 'ExtraEye2', 'ExtraTail1', 'ExtraTail2', 'ExtraTail3']);

let modelPromise: Promise<SlopModelData> | null = null;

/** Load (once) the Slopothy geometry: from slopothy.glb, or a distorted procedural raccoon as a fallback. */
export function loadSlopothyModel(game: Game): Promise<SlopModelData> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const obj = await game.assets.tryModel('assets/models/slopothy.glb');
      if (obj) {
        try {
          return fromGlb(obj);
        } catch (err) {
          console.warn('[slop] slopothy.glb conversion failed, using procedural slop', err);
        }
      }
      return proceduralSlopothy();
    })();
  }
  return modelPromise;
}

function finishModel(geometry: THREE.BufferGeometry, rig: SlopRig, fromGlb: boolean): SlopModelData {
  const bb = geometry.boundingBox!;
  return { geometry, rig, footY: bb.min.y, height: bb.max.y - bb.min.y, fromGlb };
}

function fromGlb(root: THREE.Object3D): SlopModelData {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);
  const rig = emptyRig();
  rig.parents[SP.extraTail] = SP.head;
  root.traverse((o) => {
    const id = PIVOT_NODE[o.name];
    if (id != null) o.getWorldPosition(rig.pivots[id]);
  });
  const pg = new PartGeo();
  let meshes = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let part = -1;
    let extra = false;
    for (let n: THREE.Object3D | null = mesh; n; n = n.parent) {
      if (part < 0 && PART_OF[n.name] != null) part = PART_OF[n.name];
      if (EXTRA_NODES.has(n.name)) extra = true;
    }
    if (part < 0) part = SP.body;
    const src = mesh.geometry as THREE.BufferGeometry;
    const g = new THREE.BufferGeometry();
    // Always de-interleave / de-quantize into plain Float32 attributes so everything merges cleanly.
    const sp = src.getAttribute('position');
    const sn = src.getAttribute('normal');
    const pa = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) {
      pa[i * 3] = sp.getX(i);
      pa[i * 3 + 1] = sp.getY(i);
      pa[i * 3 + 2] = sp.getZ(i);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
    if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
    if (sn) {
      const na = new Float32Array(sn.count * 3);
      for (let i = 0; i < sn.count; i++) {
        na[i * 3] = sn.getX(i);
        na[i * 3 + 1] = sn.getY(i);
        na[i * 3 + 2] = sn.getZ(i);
      }
      g.setAttribute('normal', new THREE.BufferAttribute(na, 3));
    } else g.computeVertexNormals();
    g.applyMatrix4(mesh.matrixWorld);
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const base = mat?.color ? mat.color.clone() : new THREE.Color(1, 1, 1);
    const vc = src.getAttribute('color');
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = vc ? vc.getX(i) : 1;
      const gg = vc ? vc.getY(i) : 1;
      const b = vc ? vc.getZ(i) : 1;
      colors[i * 3] = r * base.r;
      colors[i * 3 + 1] = gg * base.g;
      colors[i * 3 + 2] = b * base.b;
    }
    const em = mat?.emissive;
    const glow = em && (mat.emissiveIntensity ?? 0) > 0 && em.r + em.g + em.b > 0.3 ? 0.9 : 0;
    pg.push(g, { part, color: 0xffffff, extra, glow }, colors);
    meshes++;
  });
  if (!meshes) throw new Error('no meshes');
  return finishModel(pg.build(), rig, true);
}

/** A distorted procedural raccoon with the same part layout (used if the GLB is missing). */
function proceduralSlopothy(): SlopModelData {
  const rig = emptyRig();
  rig.parents[SP.extraTail] = SP.head;
  const pg = new PartGeo();
  const fur = new THREE.Color('#8a7c86');
  const belly = new THREE.Color('#eadfe8');
  const mask = '#1e1523';
  const white = '#f8f0fa';
  const paw = '#2e2632';
  const furFn: ColorFn = (_p, n) => _c.copy(fur).lerp(belly, THREE.MathUtils.clamp(-n.y * 0.8 + 0.1, 0, 1));
  const S = (r: number, w = 18, h = 12) => new THREE.SphereGeometry(r, w, h);
  pg.add(S(0.36, 22, 16), { part: SP.body, color: furFn, scale: [1.06, 0.94, 1.1] });
  // head
  rig.pivots[SP.head].set(0, 0.06, 0.2);
  pg.add(S(0.2), { part: SP.head, color: furFn, pos: [0.01, 0.1, 0.27], scale: [1.15, 0.95, 1] });
  pg.add(S(0.12), { part: SP.head, color: mask, pos: [0.02, 0.13, 0.4], scale: [1.8, 0.55, 0.7] });
  pg.add(S(0.08), { part: SP.head, color: white, pos: [0.04, 0.05, 0.43], scale: [1.1, 0.8, 1.2] }); // melted muzzle
  pg.add(S(0.05), { part: SP.head, color: white, pos: [-0.02, -0.03, 0.43], scale: [0.8, 1.6, 0.8] }); // chin drip
  pg.add(S(0.028), { part: SP.head, color: '#161212', pos: [0.05, 0.08, 0.52] });
  pg.add(S(0.045), { part: SP.head, color: '#060505', pos: [0.1, 0.15, 0.45] });
  pg.add(S(0.034), { part: SP.head, color: '#060505', pos: [-0.08, 0.19, 0.45] });
  pg.add(S(0.012), { part: SP.head, color: '#ffffff', pos: [0.115, 0.17, 0.49], glow: 0.9 });
  pg.add(S(0.03), { part: SP.head, color: '#060505', pos: [0.01, 0.29, 0.4], extra: true });
  pg.add(S(0.025), { part: SP.head, color: '#060505', pos: [-0.2, 0.05, 0.4], extra: true });
  pg.add(S(0.07), { part: SP.head, color: furFn, pos: [0.17, 0.3, 0.22], scale: [1.6, 1.4, 0.5] });
  pg.add(S(0.06), { part: SP.head, color: furFn, pos: [-0.13, 0.27, 0.22], scale: [0.9, 1.1, 0.45] });
  // legs (+ extra legs), each a capsule with a 6-toed paw
  const legs: [number, number, number, number, boolean][] = [
    [SP.armL, 0.15, -0.2, 0.17, false],
    [SP.armR, -0.15, -0.2, 0.17, false],
    [SP.legL, 0.17, -0.22, -0.14, false],
    [SP.legR, -0.17, -0.22, -0.14, false],
    [SP.extraLeg1, 0.2, -0.18, 0.0, true],
    [SP.extraLeg2, -0.21, -0.19, 0.02, true],
  ];
  for (const [part, x, y, z, extra] of legs) {
    rig.pivots[part].set(x, y, z);
    pg.add(new THREE.CapsuleGeometry(0.055, 0.1, 4, 10), { part, extra, color: furFn, pos: [x, y - 0.08, z] });
    pg.add(S(0.06, 12, 8), { part, extra, color: paw, pos: [x, y - 0.19, z + 0.02], scale: [1.2, 0.55, 1.4] });
    for (let f = 0; f < 6; f++) {
      pg.add(S(0.014, 6, 4), { part, extra, color: paw, pos: [x - 0.05 + f * 0.02, y - 0.2, z + 0.09] });
    }
  }
  // tail
  rig.pivots[SP.tail].set(0, 0.0, -0.3);
  for (let i = 0; i < 7; i++) {
    pg.add(S(0.075 - i * 0.004, 12, 8), { part: SP.tail, color: i % 2 ? '#2f2434' : '#b6a3ae', pos: [0.02 * i, 0.02 + i * 0.015, -0.32 - i * 0.09], scale: [1, 1, 1.3] });
  }
  // extra tail growing out of the head
  rig.pivots[SP.extraTail].set(0.04, 0.3, 0.2);
  for (let i = 0; i < 4; i++) {
    pg.add(S(0.05 - i * 0.006, 10, 7), { part: SP.extraTail, extra: true, color: i % 2 ? '#2f2434' : '#b6a3ae', pos: [0.04 - i * 0.02, 0.33 + i * 0.07, 0.18 - i * 0.03] });
  }
  return finishModel(pg.build(), rig, false);
}

// =====================================================================================================
// Slop Dragon
// =====================================================================================================

export const DP = {
  body: 0,
  neckA: 1,
  neckB: 2,
  wingL: 3,
  wingR: 4,
  tail: 5,
  leg0: 6, // 6..12: seven legs (yes, seven)
  jawA: 13,
  jawB: 14,
} as const;

export interface DragonModelData {
  geometry: THREE.BufferGeometry;
  rig: SlopRig;
  /** Local anchor points. */
  saddle: THREE.Vector3;
  headA: THREE.Vector3;
  headB: THREE.Vector3;
  /** Body ellipsoid radii (for the watermark decal). */
  radii: THREE.Vector3;
  /** Distance from body centre down to the feet when standing. */
  legReach: number;
}

export function buildDragonGeometry(): DragonModelData {
  const rig = emptyRig();
  const pg = new PartGeo();
  const R = new THREE.Vector3(0.95, 0.85, 2.3);
  const top = new THREE.Color('#6b3fa0');
  const top2 = new THREE.Color('#2bb5a8');
  const bellyC = new THREE.Color('#f1c6e8');
  const scale = new THREE.Color('#3b2a6e');
  const bodyFn: ColorFn = (p, n) => {
    _c.copy(top).lerp(top2, THREE.MathUtils.clamp(0.5 + p.z * 0.25, 0, 1));
    return _c.lerp(bellyC, THREE.MathUtils.clamp(-n.y * 1.2 - 0.1, 0, 1));
  };
  // ---- body (part 0)
  pg.add(new THREE.SphereGeometry(1, 30, 20), { part: DP.body, color: bodyFn, scale: [R.x, R.y, R.z] });
  // spine spikes: one is upside-down, one is a tiny traffic cone (the AI was not sure)
  for (let i = 0; i < 7; i++) {
    const z = 1.6 - i * 0.55;
    const h = 0.45 - Math.abs(i - 3) * 0.05;
    const flip = i === 4;
    pg.add(new THREE.ConeGeometry(0.16, h, 6), {
      part: DP.body,
      color: i === 2 ? '#ff7a1a' : '#e0438f',
      pos: [0, R.y * Math.sqrt(Math.max(0, 1 - (z / R.z) ** 2)) + (flip ? 0.1 : h * 0.4), z],
      rot: [flip ? Math.PI : -0.35, 0, 0],
    });
  }
  // belly scale plates (slightly misaligned)
  for (let i = 0; i < 6; i++) {
    const z = 1.3 - i * 0.5;
    pg.add(new THREE.BoxGeometry(0.9, 0.08, 0.36), { part: DP.body, color: '#f7d7ef', pos: [0.05 * Math.sin(i * 2.1), -R.y * Math.sqrt(Math.max(0, 1 - (z / R.z) ** 2)) - 0.01, z], rot: [0, 0.1 * Math.sin(i * 3.3), 0.08 * Math.cos(i)] });
  }
  // ---- two necks + heads that disagree
  const heads: [number, number, number, string, string, number][] = [
    // part, jawPart, side, color, eye colour, eye count
    [DP.neckA, DP.jawA, 1, '#35c29a', '#fff36b', 2],
    [DP.neckB, DP.jawB, -1, '#b04fd6', '#6bf6ff', 3],
  ];
  const headPos: THREE.Vector3[] = [];
  for (const [part, jaw, side, col, eyeCol, eyes] of heads) {
    const base = new THREE.Vector3(0.42 * side, 0.3, 1.95);
    rig.pivots[part].copy(base);
    // neck: 5 overlapping segments rising forward and slightly outward
    const neckEnd = new THREE.Vector3(0.9 * side, 1.55, 3.05);
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const p = base.clone().lerp(neckEnd, t);
      p.y += Math.sin(t * Math.PI) * 0.25;
      pg.add(new THREE.SphereGeometry(0.34 - t * 0.12, 14, 10), { part, color: col, pos: [p.x, p.y, p.z], scale: [1, 1, 1.25] });
    }
    // head
    const h = neckEnd.clone().add(new THREE.Vector3(0.05 * side, 0.18, 0.25));
    headPos.push(h.clone());
    pg.add(new THREE.SphereGeometry(0.36, 16, 12), { part, color: col, pos: [h.x, h.y, h.z], scale: [0.95, 0.8, 1.2] });
    // snout
    pg.add(new THREE.BoxGeometry(0.42, 0.24, 0.6), { part, color: col, pos: [h.x, h.y - 0.05, h.z + 0.45], rot: [0.1, 0, 0] });
    pg.add(new THREE.SphereGeometry(0.05, 8, 6), { part, color: '#1a1020', pos: [h.x + 0.1, h.y + 0.05, h.z + 0.75] });
    pg.add(new THREE.SphereGeometry(0.05, 8, 6), { part, color: '#1a1020', pos: [h.x - 0.1, h.y + 0.05, h.z + 0.75] });
    // horns (head B has one horn on backwards)
    pg.add(new THREE.ConeGeometry(0.08, 0.5, 6), { part, color: '#fff2c9', pos: [h.x + 0.17, h.y + 0.35, h.z - 0.12], rot: [-0.6, 0, -0.3] });
    pg.add(new THREE.ConeGeometry(0.08, 0.5, 6), { part, color: '#fff2c9', pos: [h.x - 0.17, h.y + 0.35, h.z - (side < 0 ? -0.2 : 0.12)], rot: [side < 0 ? 0.7 : -0.6, 0, 0.3] });
    // eyes (glowing)
    for (let e = 0; e < eyes; e++) {
      const ex = eyes === 2 ? (e ? -0.2 : 0.2) : (e - 1) * 0.18;
      const ey = eyes === 3 && e === 1 ? 0.22 : 0.12;
      pg.add(new THREE.SphereGeometry(0.075, 10, 8), { part, color: eyeCol, glow: 2.2, extra: e === 2, pos: [h.x + ex, h.y + ey, h.z + 0.2] });
      pg.add(new THREE.SphereGeometry(0.035, 8, 6), { part, color: '#120818', pos: [h.x + ex * 1.05, h.y + ey, h.z + 0.27] });
    }
    // jaw (own part, parented to the neck so it opens when talking)
    const jp = new THREE.Vector3(h.x, h.y - 0.2, h.z + 0.1);
    rig.pivots[jaw].copy(jp);
    rig.parents[jaw] = part;
    pg.add(new THREE.BoxGeometry(0.36, 0.1, 0.55), { part: jaw, color: '#f1c6e8', pos: [jp.x, jp.y, jp.z + 0.35] });
    for (let k = 0; k < 4; k++) {
      pg.add(new THREE.ConeGeometry(0.03, 0.09, 4), { part: jaw, color: '#ffffff', pos: [jp.x - 0.12 + k * 0.08, jp.y + 0.08, jp.z + 0.52], rot: [0, 0, 0] });
    }
  }
  // ---- wings (clip straight through the body on the downstroke; that's a feature)
  const wingGeo = (side: number) => {
    const g = new THREE.BufferGeometry();
    // fan membrane from the shoulder; span 4.6, chord 2.4, scalloped trailing edge
    const pts: number[] = [];
    const tips = [
      [4.6, 0.5, 0.3],
      [4.0, 0.2, -0.9],
      [3.0, 0.0, -1.7],
      [1.9, -0.1, -2.2],
      [0.6, -0.1, -1.9],
    ];
    const s = [0, 0, 0];
    const lead = [
      [1.6, 0.7, 0.55],
      [3.2, 0.8, 0.5],
    ];
    const ring = [s, lead[0], lead[1], ...tips];
    for (let i = 1; i < ring.length - 1; i++) {
      const a = ring[0];
      const b = ring[i];
      const c = ring[i + 1];
      pts.push(a[0] * side, a[1], a[2], b[0] * side, b[1], b[2], c[0] * side, c[1], c[2]);
      // scallop: pull the midpoint of the trailing edge in
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.computeVertexNormals();
    return g;
  };
  for (const [part, side] of [
    [DP.wingL, 1],
    [DP.wingR, -1],
  ] as [number, number][]) {
    const sh = new THREE.Vector3(0.7 * side, 0.55, 0.7);
    rig.pivots[part].copy(sh);
    const wg = wingGeo(side);
    wg.translate(sh.x, sh.y, sh.z);
    const membrane: ColorFn = (p) => _c.set('#ff5fb8').lerp(new THREE.Color('#39e6ff'), THREE.MathUtils.clamp(Math.abs(p.x) / 5, 0, 1));
    pg.add(wg, { part, color: membrane });
    // bones along the leading edge + fingers
    const bone = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const len = a.distanceTo(b);
      const cg = new THREE.CylinderGeometry(r * 0.7, r, len, 6);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      pg.add(cg, { part, color: '#4a2a7a', matrix: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)) });
    };
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x * side + sh.x, y + sh.y, z + sh.z);
    bone(P(0, 0, 0), P(1.6, 0.7, 0.55), 0.09);
    bone(P(1.6, 0.7, 0.55), P(3.2, 0.8, 0.5), 0.07);
    bone(P(3.2, 0.8, 0.5), P(4.6, 0.5, 0.3), 0.05);
    for (const t of [
      [4.0, 0.2, -0.9],
      [3.0, 0.0, -1.7],
      [1.9, -0.1, -2.2],
    ]) {
      bone(P(3.2, 0.8, 0.5), P(t[0], t[1], t[2]), 0.035);
    }
    // wing claw with 6 fingers
    for (let f = 0; f < 6; f++) {
      pg.add(new THREE.ConeGeometry(0.03, 0.2, 4), { part, color: '#fff2c9', pos: [P(3.2, 0.8, 0.5).x + (f - 2.5) * 0.05 * side, P(3.2, 0.8, 0.5).y + 0.12, P(3.2, 0.8, 0.5).z + 0.05] });
    }
  }
  // ---- tail, ending in a mouse-cursor arrow
  const tb = new THREE.Vector3(0, 0.15, -2.05);
  rig.pivots[DP.tail].copy(tb);
  let tp = tb.clone();
  for (let i = 0; i < 9; i++) {
    const r = 0.36 - i * 0.035;
    tp = tp.clone().add(new THREE.Vector3(Math.sin(i * 0.6) * 0.12, -0.05 + i * 0.02, -0.38));
    pg.add(new THREE.SphereGeometry(r, 12, 8), { part: DP.tail, color: i % 2 ? scale : '#6b3fa0', pos: [tp.x, tp.y, tp.z], scale: [1, 0.9, 1.3] });
  }
  {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0, -0.9);
    s.lineTo(0.22, -0.68);
    s.lineTo(0.38, -1.02);
    s.lineTo(0.5, -0.96);
    s.lineTo(0.34, -0.62);
    s.lineTo(0.64, -0.62);
    s.closePath();
    const cg = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false });
    cg.translate(-0.25, 0.5, -0.04);
    cg.rotateX(-Math.PI / 2);
    pg.add(cg, { part: DP.tail, color: '#ffffff', glow: 0.5, pos: [tp.x, tp.y, tp.z - 0.25], rot: [0, Math.PI, 0], scale: 1.1 });
  }
  // ---- seven legs (4 left, 3 right, one on backwards)
  const legSpots: [number, number, boolean][] = [
    [1, 1.35, false],
    [1, 0.45, false],
    [1, -0.45, false],
    [1, -1.3, true],
    [-1, 1.1, false],
    [-1, 0.0, false],
    [-1, -1.05, false],
  ];
  let legReach = 0;
  legSpots.forEach(([side, z, backwards], i) => {
    const part = DP.leg0 + i;
    const hip = new THREE.Vector3(0.55 * side, -0.55, z);
    rig.pivots[part].copy(hip);
    const thighEnd = hip.clone().add(new THREE.Vector3(0.18 * side, -0.55, backwards ? -0.2 : 0.18));
    const foot = thighEnd.clone().add(new THREE.Vector3(0.02 * side, -0.62, backwards ? 0.12 : -0.14));
    const seg = (a: THREE.Vector3, b: THREE.Vector3, r: number, col: string) => {
      const len = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      pg.add(new THREE.CylinderGeometry(r * 0.8, r, len, 8), { part, color: col, matrix: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)) });
      pg.add(new THREE.SphereGeometry(r, 8, 6), { part, color: col, pos: [b.x, b.y, b.z] });
    };
    seg(hip, thighEnd, 0.2, '#5a3894');
    seg(thighEnd, foot, 0.13, '#472c7a');
    pg.add(new THREE.SphereGeometry(0.18, 10, 6), { part, color: '#2a1a44', pos: [foot.x, foot.y - 0.06, foot.z + (backwards ? -0.12 : 0.12)], scale: [1, 0.45, 1.5] });
    for (let c = 0; c < 3; c++) {
      pg.add(new THREE.ConeGeometry(0.035, 0.16, 4), {
        part,
        color: '#fff2c9',
        pos: [foot.x + (c - 1) * 0.1, foot.y - 0.08, foot.z + (backwards ? -0.32 : 0.32)],
        rot: [backwards ? -Math.PI / 2 : Math.PI / 2, 0, 0],
      });
    }
    legReach = Math.max(legReach, -(foot.y - 0.14));
  });
  const geometry = pg.build();
  return {
    geometry,
    rig,
    saddle: new THREE.Vector3(0, R.y + 0.22, 1.3),
    headA: headPos[0],
    headB: headPos[1],
    radii: R,
    legReach,
  };
}

/** Grid mesh hugging the side of an ellipsoid (for the dragon's stock-photo watermark). */
export function ellipsoidSideDecal(radii: THREE.Vector3, side: 1 | -1, zRange: [number, number], thetaRange: number, lift = 1.015) {
  const nu = 24;
  const nv = 10;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const z = THREE.MathUtils.lerp(zRange[0], zRange[1], u);
      const th = (v - 0.5) * 2 * thetaRange;
      const s = Math.sqrt(Math.max(0.02, 1 - (z / radii.z) ** 2));
      const x = radii.x * Math.cos(th) * s * lift * side;
      const y = radii.y * Math.sin(th) * s * lift;
      pos.push(x, y, z);
      uv.push(side > 0 ? 1 - u : u, v);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      if (side > 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
