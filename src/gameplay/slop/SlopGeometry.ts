import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../core/Game';
import { JimothyQuad } from '../../player/JimothyQuad';
import { emptyRig, type SlopRig } from './SlopMaterial';

/**
 * Geometry for the slop creatures.
 *  - The Slop Dragon: a single-mesh "GPU rigged" geometry: every vertex carries its part index (aPart), whether it's an
 *    extra/wrong bit (aExtra) and an emissive boost (aGlow), plus a vertex colour (PartGeo).
 *  - The Slopothys: the REAL Jimothy (jimothy.glb, skinned, posed by his own animator) re-rigged with every mistake an
 *    image generator makes with him: a third eye, six legs, four ears, a long ringed tail (see loadSlopothyModel; the
 *    neck, melting face, wrong ears and AI hands are done with bones / the shader in Slopothys.ts).
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
// Slopothy: the real Jimothy (jimothy.glb) with an image generator's mistakes
// =====================================================================================================

/**
 * A Slopothy's optional mistakes (bit flags). The geometry for all of them lives in ONE shared skinned mesh built from
 * the real model; each Slopothy switches its own on (Slopothys.ts), so every variant shares the same buffers.
 */
export const SF = {
  /** A third eye in the middle of the forehead. */
  eye3: 1,
  /** Six legs: a middle pair (copies of his front legs) under the belly. */
  legs: 2,
  /** A second pair of ears behind the first. */
  ears: 4,
  /** A long ringed raccoon tail (the real one is a short puff). */
  tail: 8,
  /** A neck (the real one has virtually none). */
  neck: 16,
  /** The face melts and drips. */
  melt: 32,
  /** Mismatched ears: one huge, one small and on backwards. */
  earMix: 64,
  /** Giant "AI hands" (and feet). */
  paws: 128,
} as const;

/** Per-vertex feature ids (aSlopV.x): the uFeat[] toggle that shows the vertex (0 = always shown). */
export const FEAT = { eye3: 1, legL: 2, legR: 3, earL: 4, earR: 5, tail: 6 } as const;
export const MAX_FEAT = 8;

export interface SlopBoneSpec {
  name: string;
  /** Parent bone (null = the model root). Every rest rotation is identity, like the real rig. */
  parent: string | null;
  /** Rest position relative to the parent. */
  pos: THREE.Vector3;
}

export interface SlopModelData {
  /**
   * The real Jimothy's skinned body + his eyes / nose (as skinned parts) + every optional mistake, in the model frame
   * (feet on y = 0, facing +Z, his left = +X). Attributes: position normal uv skinIndex skinWeight color _furlen
   * _furcomb aSlopV (feature id, face-melt weight, gloss) aGlow aPart aExtra (the slop shader's; 0 here).
   * UV x < -0.5 = untextured (vertex colour only).
   */
  geometry: THREE.BufferGeometry;
  /**
   * The same mesh drawing only the base body + the features in `mask` (bit 1 << FEAT id): its own index buffer over the
   * shared vertex buffers (cached; never dispose these). Unused mistakes then cost nothing to draw.
   */
  geometryFor(mask: number): THREE.BufferGeometry;
  /** Skeleton, parents first: the real rig's bones, then EyeL/EyeR/Nose/Eye3, the middle legs, Ear2L/R, TailX1..7. */
  bones: SlopBoneSpec[];
  boneInverses: THREE.Matrix4[];
  /** His coat texture. */
  coat: THREE.Texture | null;
  /** Where each feature grows from (model frame), indexed by FEAT id. */
  featAnchors: THREE.Vector3[];
  /** The long tail's bones, root first. */
  tailBones: string[];
  /** Unused part rig for the slop shader (everything is part 0). */
  rig: SlopRig;
  /** Generous bounds for culling / bubbles (model frame, any pose). */
  box: THREE.Box3;
  bounds: THREE.Sphere;
}

let modelPromise: Promise<SlopModelData | null> | null = null;

/** Build (once) the Slopothy mesh from the real Jimothy. Resolves null if jimothy.glb can't be loaded. */
export function loadSlopothyModel(game: Game): Promise<SlopModelData | null> {
  if (!modelPromise) {
    modelPromise = buildSlopothy(game).catch((err) => {
      console.warn('[slop] could not build the Slopothy model', err);
      return null;
    });
  }
  return modelPromise;
}

/** Collects skinned vertices + triangles into one geometry. */
class SkinBuilder {
  P: number[] = [];
  N: number[] = [];
  UV: number[] = [];
  SI: number[] = [];
  SW: number[] = [];
  C: number[] = [];
  V: number[] = [];
  GL: number[] = [];
  FL: number[] = [];
  FC: number[] = [];
  I: number[] = [];

  get count() {
    return this.P.length / 3;
  }

  vert(p: THREE.Vector3, n: THREE.Vector3, uv: [number, number], si: number[], sw: number[], col: THREE.Color, feat: number, face = 0, gloss = 0, glow = 0, fl = 0, fc?: THREE.Vector3) {
    this.P.push(p.x, p.y, p.z);
    this.N.push(n.x, n.y, n.z);
    this.UV.push(uv[0], uv[1]);
    for (let k = 0; k < 4; k++) {
      this.SI.push(si[k] ?? 0);
      this.SW.push(sw[k] ?? 0);
    }
    this.C.push(col.r, col.g, col.b);
    this.V.push(feat, face, gloss);
    this.GL.push(glow);
    this.FL.push(fl);
    this.FC.push(fc?.x ?? 0, fc?.y ?? 0, fc?.z ?? 0);
    return this.count - 1;
  }

  build() {
    const g = new THREE.BufferGeometry();
    const f32 = (a: number[], n: number) => new THREE.BufferAttribute(new Float32Array(a), n);
    g.setAttribute('position', f32(this.P, 3));
    g.setAttribute('normal', f32(this.N, 3));
    g.setAttribute('uv', f32(this.UV, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(this.SI), 4));
    g.setAttribute('skinWeight', f32(this.SW, 4));
    g.setAttribute('color', f32(this.C, 3));
    g.setAttribute('aSlopV', f32(this.V, 3));
    g.setAttribute('aGlow', f32(this.GL, 1));
    g.setAttribute('_furlen', f32(this.FL, 1));
    g.setAttribute('_furcomb', f32(this.FC, 3));
    // the slop shader's part rig isn't used (skinning does the posing): one shared zero buffer for both
    const zero = new THREE.BufferAttribute(new Float32Array(this.count), 1);
    g.setAttribute('aPart', zero);
    g.setAttribute('aExtra', zero);
    g.setIndex(this.count > 65535 ? new THREE.BufferAttribute(new Uint32Array(this.I), 1) : new THREE.BufferAttribute(new Uint16Array(this.I), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const NO_UV: [number, number] = [-2, -2];
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** How much a point on his face melts (model frame): the muzzle and mask most, fading out up the brow. */
const faceMelt = (p: THREE.Vector3, headW: number) => headW * smooth(0.285, 0.345, p.z) * THREE.MathUtils.clamp((0.545 - p.y) / 0.14, 0, 1);

/** The long tail (model frame), root → tip: a gentle droop that curls back up. */
const TAIL_PTS: [number, number, number][] = [
  [0, 0.478, -0.27],
  [0, 0.462, -0.35],
  [0, 0.442, -0.43],
  [0, 0.428, -0.51],
  [0, 0.424, -0.59],
  [0, 0.432, -0.665],
  [0, 0.452, -0.735],
];

async function buildSlopothy(game: Game): Promise<SlopModelData | null> {
  const src = await game.assets.tryModel('assets/models/jimothy.glb');
  if (!src || !JimothyQuad.fits(src)) return null;
  src.position.set(0, 0, 0);
  src.quaternion.identity();
  src.scale.set(1, 1, 1);
  src.updateMatrixWorld(true);
  let body: THREE.SkinnedMesh | null = null;
  src.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && !body) body = m;
  });
  if (!body) return null;
  const skinned: THREE.SkinnedMesh = body;
  const srcBones = skinned.skeleton.bones;
  const modelPos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const byName = (n: string) => src.getObjectByName(n)!;

  // ---------------------------------------------------------------- skeleton
  const specs: SlopBoneSpec[] = [];
  const index = new Map<string, number>();
  const at = new Map<string, THREE.Vector3>(); // rest positions, model frame
  const addBone = (name: string, parent: string | null, model: THREE.Vector3) => {
    index.set(name, specs.length);
    at.set(name, model.clone());
    const pos = parent ? model.clone().sub(at.get(parent)!) : model.clone();
    specs.push({ name, parent, pos });
    return specs.length - 1;
  };
  for (const b of srcBones) addBone(b.name, (b.parent as THREE.Bone | null)?.isBone ? b.parent!.name : null, modelPos(b));
  const B = (n: string) => index.get(n)!;
  // his eyes and nose are rigid meshes on the Head bone: here they're skinned parts, with bones of their own so the
  // animator's blink (it scales EyeL / EyeR) still works
  const eyeL = byName('EyeL') as THREE.Mesh;
  const eyeR = byName('EyeR') as THREE.Mesh;
  const nose = byName('Nose') as THREE.Mesh;
  addBone('EyeL', 'Head', modelPos(eyeL));
  addBone('EyeR', 'Head', modelPos(eyeR));
  addBone('Nose', 'Head', modelPos(nose));

  // ---------------------------------------------------------------- the real body
  const sb = new SkinBuilder();
  const g = skinned.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const fl = g.getAttribute('_furlen');
  const fc = g.getAttribute('_furcomb');
  const n = pos.count;
  const headSet = new Set(['Head', 'Jaw', 'EarL', 'EarR'].map(B));
  const weightOf = (i: number, set: Set<number>) => {
    let s = 0;
    for (let k = 0; k < 4; k++) if (set.has(si.getComponent(i, k))) s += sw.getComponent(i, k);
    return s;
  };
  const white = new THREE.Color(1, 1, 1);
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const c = new THREE.Vector3();
  const skinOf = (i: number, remap?: (b: number) => number) => {
    const idx: number[] = [];
    const wt: number[] = [];
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(i, k);
      idx.push(remap ? remap(b) : b);
      wt.push(sw.getComponent(i, k));
    }
    return { idx, wt };
  };
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    q.fromBufferAttribute(nor, i);
    if (fc) c.fromBufferAttribute(fc, i);
    else c.set(0, 0, 0);
    const s = skinOf(i);
    sb.vert(p, q, uv ? [uv.getX(i), uv.getY(i)] : NO_UV, s.idx, s.wt, white, 0, faceMelt(p, weightOf(i, headSet)), 0, 0, fl ? fl.getX(i) : 0, c);
  }
  const srcIndex = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i);
  for (const i of srcIndex) sb.I.push(i);

  /** Append a rigid mesh (model frame) bound 100 % to one bone. */
  const rigid = (mesh: THREE.Mesh, bone: number, col: THREE.Color, feat: number, gloss: number, glow: number, xf?: THREE.Matrix4) => {
    const mg = mesh.geometry;
    const mp = mg.getAttribute('position');
    const mn = mg.getAttribute('normal');
    const m = xf ?? mesh.matrixWorld;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = sb.count;
    for (let i = 0; i < mp.count; i++) {
      p.fromBufferAttribute(mp, i).applyMatrix4(m);
      if (mn) q.fromBufferAttribute(mn, i).applyMatrix3(nm).normalize();
      else q.set(0, 0, 1);
      sb.vert(p, q, NO_UV, [bone, 0, 0, 0], [1, 0, 0, 0], col, feat, faceMelt(p, 1), gloss, glow);
    }
    const mi = mg.index ? Array.from(mg.index.array as ArrayLike<number>) : Array.from({ length: mp.count }, (_, i) => i);
    for (const i of mi) sb.I.push(base + i);
  };
  const colOf = (mesh: THREE.Object3D, fallback: number) => {
    const mat = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    return mat?.color ? mat.color.clone() : new THREE.Color(fallback);
  };
  const glintOf = (eye: THREE.Object3D) => eye.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
  for (const [eye, bone] of [
    [eyeL, B('EyeL')],
    [eyeR, B('EyeR')],
  ] as [THREE.Mesh, number][]) {
    rigid(eye, bone, colOf(eye, 0x060505), 0, 1, 0);
    const gl = glintOf(eye);
    if (gl) rigid(gl, bone, new THREE.Color(1, 1, 1), 0, 0.6, 1.1);
  }
  rigid(nose, B('Nose'), colOf(nose, 0x161212), 0, 0.75, 0);
  // everything so far is always drawn; each mistake's triangles follow as one run per FEAT id
  const baseCount = sb.I.length;
  const runs = new Map<number, [number, number]>();
  const run = (feat: number, fn: () => void) => {
    const s0 = sb.I.length;
    fn();
    runs.set(feat, [s0, sb.I.length - s0]);
  };

  // ---------------------------------------------------------------- mistake: a third eye
  run(FEAT.eye3, () => {
    // on the forehead, between and above his eyes: find the skin there
    const probe = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    probe.geometry.setAttribute('position', pos);
    probe.geometry.setIndex(srcIndex);
    const eyeY = at.get('EyeL')!.y;
    const ray = new THREE.Raycaster(new THREE.Vector3(0, eyeY + 0.036, 0.7), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(probe, false)[0];
    const k = 2.1; // (bigger than the real two: the generator is proud of it)
    const r = 0.011 * k;
    const center = hit ? hit.point.clone().add(new THREE.Vector3(0, 0, -r * 0.3)) : new THREE.Vector3(0, eyeY + 0.036, 0.37);
    const b3 = addBone('Eye3', 'Head', center);
    const xf = new THREE.Matrix4().compose(center, new THREE.Quaternion(), new THREE.Vector3(k, k, k));
    rigid(eyeL, b3, colOf(eyeL, 0x060505), FEAT.eye3, 1, 0, xf);
    const gl = glintOf(eyeL);
    if (gl) rigid(gl, b3, new THREE.Color(1, 1, 1), FEAT.eye3, 0.6, 1.3, xf.clone().multiply(gl.matrix));
  });

  // ---------------------------------------------------------------- mistake: six legs (copies of the front legs, mid-body)
  /**
   * Copy the triangles whose corners all belong (≥ minW) to `set`, moved by `d`, bones remapped. The sculpted fur
   * fades out toward the cut (so the open edge stays tucked inside the body instead of flaring out).
   */
  const copyPart = (set: Set<number>, minW: number, d: THREE.Vector3, remap: (b: number) => number, feat: number) => {
    const keep = new Map<number, number>();
    for (let t = 0; t < srcIndex.length; t += 3) {
      const a = srcIndex[t];
      const b = srcIndex[t + 1];
      const e = srcIndex[t + 2];
      if (weightOf(a, set) < minW || weightOf(b, set) < minW || weightOf(e, set) < minW) continue;
      for (const v of [a, b, e]) {
        let o = keep.get(v);
        if (o == null) {
          p.fromBufferAttribute(pos, v).add(d);
          q.fromBufferAttribute(nor, v);
          if (fc) c.fromBufferAttribute(fc, v);
          else c.set(0, 0, 0);
          const s = skinOf(v, remap);
          const fade = THREE.MathUtils.smoothstep(weightOf(v, set), minW, Math.min(1, minW + 0.4));
          o = sb.vert(p, q, uv ? [uv.getX(v), uv.getY(v)] : NO_UV, s.idx, s.wt, white, feat, 0, 0, 0, fl ? fl.getX(v) * fade : 0, c);
          keep.set(v, o);
        }
        sb.I.push(o);
      }
    }
  };
  const anchors = Array.from({ length: MAX_FEAT }, () => new THREE.Vector3());
  anchors[FEAT.eye3].copy(at.get('Eye3')!);
  for (const [s, feat] of [
    ['L', FEAT.legL],
    ['R', FEAT.legR],
  ] as [string, number][]) {
    const arm = at.get('Arm' + s)!;
    const mid = new THREE.Vector3(arm.x * 1.25, arm.y + 0.02, 0.03);
    const mArm = addBone('MidArm' + s, 'Spine2', mid);
    const mFore = addBone('MidForearm' + s, 'MidArm' + s, mid.clone().add(at.get('Forearm' + s)!).sub(arm));
    const mHand = addBone('MidHand' + s, 'MidForearm' + s, mid.clone().add(at.get('Hand' + s)!).sub(arm));
    const map = new Map([
      [B('Arm' + s), mArm],
      [B('Forearm' + s), mFore],
      [B('Hand' + s), mHand],
    ]);
    const spine = B('Spine2');
    run(feat, () => copyPart(new Set(map.keys()), 0.5, mid.clone().sub(arm), (b) => map.get(b) ?? spine, feat));
    anchors[feat].copy(mid);
  }

  // ---------------------------------------------------------------- mistake: a second pair of ears
  for (const [s, sx, feat] of [
    ['L', 1, FEAT.earL],
    ['R', -1, FEAT.earR],
  ] as [string, number, number][]) {
    const ear = at.get('Ear' + s)!;
    const e2 = ear.clone().add(new THREE.Vector3(sx * 0.03, -0.024, -0.06));
    const b2 = addBone('Ear2' + s, 'Head', e2);
    const src2 = B('Ear' + s);
    const head = B('Head');
    run(feat, () => copyPart(new Set([src2]), 0.5, e2.clone().sub(ear), (b) => (b === src2 ? b2 : head), feat));
    anchors[feat].copy(e2);
  }

  // ---------------------------------------------------------------- mistake: a long ringed tail
  const tailBones: string[] = [];
  {
    const pts = TAIL_PTS.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    let parent = 'Tail';
    pts.forEach((pt, i) => {
      const name = 'TailX' + (i + 1);
      addBone(name, parent, pt);
      tailBones.push(name);
      parent = name;
    });
    const tip = pts[pts.length - 1].clone().add(new THREE.Vector3(0, 0.03, -0.05));
    const curve = new THREE.CatmullRomCurve3([...pts, tip], false, 'centripetal');
    const nb = pts.length; // bones sit at curve t = k / nb (the tip segment follows the last one)
    const rows = 46;
    const around = 12;
    const light = new THREE.Color('#aaa39c');
    const dark = new THREE.Color('#2b2522');
    const side = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3();
    const T = new THREE.Vector3();
    const C0 = new THREE.Vector3();
    const base = sb.count;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      curve.getPoint(t, C0);
      curve.getTangent(t, T);
      up.crossVectors(side, T).normalize();
      // fat and bushy, tapering; seven dark rings and a dark tip
      let rad = THREE.MathUtils.lerp(0.068, 0.042, t) * (1 + 0.07 * Math.cos(t * Math.PI * 2 * 7));
      if (t > 0.9) rad *= Math.sqrt(Math.max(0, (1 - t) / 0.1));
      const ring = t > 0.9 || (t > 0.06 && (t * 7.4) % 1 > 0.56);
      const k = Math.min(nb - 1, Math.floor(t * nb));
      const f = THREE.MathUtils.clamp(t * nb - k, 0, 1);
      const b0 = B(tailBones[k]);
      const b1 = B(tailBones[Math.min(nb - 1, k + 1)]);
      for (let j = 0; j <= around; j++) {
        const a = (j / around) * Math.PI * 2;
        q.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
        p.copy(C0).addScaledVector(q, rad);
        sb.vert(p, q, NO_UV, [b0, b1, 0, 0], [1 - f, f, 0, 0], ring ? dark : light, FEAT.tail, 0, 0.15);
      }
    }
    run(FEAT.tail, () => {
      for (let r = 0; r < rows; r++) {
        for (let j = 0; j < around; j++) {
          const A = base + r * (around + 1) + j;
          const Bv = A + around + 1;
          sb.I.push(A, Bv, A + 1, Bv, Bv + 1, A + 1);
        }
      }
    });
    anchors[FEAT.tail].copy(pts[0]);
  }

  // ---------------------------------------------------------------- bind matrices
  const tmp: THREE.Object3D[] = [];
  const tmpRoot = new THREE.Object3D();
  for (const s of specs) {
    const o = new THREE.Object3D();
    o.position.copy(s.pos);
    (s.parent ? tmp[index.get(s.parent)!] : tmpRoot).add(o);
    tmp.push(o);
  }
  tmpRoot.updateMatrixWorld(true);
  const boneInverses = specs.map((s, i) => (i < srcBones.length ? skinned.skeleton.boneInverses[i].clone() : tmp[i].matrixWorld.clone().invert()));

  const geometry = sb.build();
  const box = geometry.boundingBox!.clone().expandByScalar(0.12);
  box.min.y -= 0.1;
  box.max.y += 0.25; // a stretched neck / a sitting-up groom
  const bounds = box.getBoundingSphere(new THREE.Sphere());
  const mat = skinned.material as THREE.MeshStandardMaterial;
  // one index buffer per combination of mistakes actually in use, all over the same vertex buffers
  const fullIndex = geometry.index!.array as Uint16Array | Uint32Array;
  const variants = new Map<number, THREE.BufferGeometry>();
  const geometryFor = (mask: number) => {
    let vg = variants.get(mask);
    if (vg) return vg;
    const parts: [number, number][] = [[0, baseCount]];
    for (const [feat, r] of runs) if (mask & (1 << feat)) parts.push(r);
    const arr = new (fullIndex.constructor as Uint16ArrayConstructor | Uint32ArrayConstructor)(parts.reduce((s, [, c]) => s + c, 0));
    let o = 0;
    for (const [s0, c] of parts) {
      arr.set(fullIndex.subarray(s0, s0 + c), o);
      o += c;
    }
    vg = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(geometry.attributes)) vg.setAttribute(name, a);
    vg.setIndex(new THREE.BufferAttribute(arr, 1));
    vg.boundingBox = geometry.boundingBox!.clone();
    vg.boundingSphere = geometry.boundingSphere!.clone();
    variants.set(mask, vg);
    return vg;
  };
  return {
    geometry,
    geometryFor,
    bones: specs,
    boneInverses,
    coat: mat?.map ?? null,
    featAnchors: anchors,
    tailBones,
    rig: emptyRig(),
    box,
    bounds,
  };
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
