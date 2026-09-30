import * as THREE from 'three';
import type { Game } from '../core/Game';
import { JimothyQuad } from './JimothyQuad';
import type { AnimState } from './JimothyModel';

/**
 * Jimothy frozen into static meshes: the real model (`assets/models/jimothy.glb`), posed by his own animator and baked
 * on the CPU, for everything in the world that depicts him (the statue, bobbleheads, figures…). The fur can be
 * "sculpted" into the surface: vertices move out to where his shell fur's tips would be, so a bronze or resin Jimothy
 * keeps his fluffy outline (the bare body underneath is much slimmer).
 *
 * Output is in the model frame: feet on y = 0, facing +Z, his left = +X, metres (he's ~0.6 m tall).
 */

/** Must match Fur.ts's shell length (metres of fur at `_furlen` = 1). */
const FUR_LENGTH = 0.035;
/** Bones that move with his head (a bobblehead's head). */
const HEAD_BONES = ['Head', 'Jaw', 'EarL', 'EarR', 'EyeL', 'EyeR', 'Nose'];

export type JimothyPose =
  /** Standing square, head level (his rest pose). */
  | 'stand'
  /** Mid-stride in his walk, a front paw lifted and curled (the footage / the photos). */
  | 'walk';

export interface BakeOptions {
  pose?: JimothyPose;
  /** With `pose: 'walk'`, the walk-cycle phase (0..1). The default lifts his right front paw, like the photos. */
  phase?: number;
  /** How much of his fur to sculpt: 0 = the bare body, 1 = out to the fur's tips (default 0.85). */
  fur?: number;
  /** Also split the head (skull, jaw, ears, eyes, nose) off into its own parts, e.g. for a bobblehead. */
  splitHead?: boolean;
}

export interface BakedPart {
  name: string;
  geometry: THREE.BufferGeometry;
  /** The model's own material (cloned; free to recolour). */
  material: THREE.MeshStandardMaterial;
  /** Part of his head (with `splitHead`). */
  head: boolean;
}

export interface BakedJimothy {
  parts: BakedPart[];
  /** The head joint in the model frame (a bobblehead's head pivots here). */
  neck: THREE.Vector3;
  /** Bounding box of everything (model frame). */
  box: THREE.Box3;
}

const cache = new Map<string, Promise<BakedJimothy | null>>();

/** Bake Jimothy once per option set (cached; callers get the shared geometry: clone it before editing it). */
export function bakeJimothy(game: Game, opts: BakeOptions = {}): Promise<BakedJimothy | null> {
  const key = JSON.stringify([opts.pose ?? 'walk', opts.phase ?? DEFAULT_PHASE, opts.fur ?? 0.85, !!opts.splitHead]);
  let p = cache.get(key);
  if (!p) {
    p = bake(game, opts).catch((err) => {
      console.warn('[jimothy] bake failed', err);
      return null;
    });
    cache.set(key, p);
  }
  return p;
}

/**
 * Walk phase where his right front paw is up and curled and his left hind foot is kicked back (the pose of the
 * photos, mirrored to his right side facing the viewer's right when seen from his right).
 */
const DEFAULT_PHASE = 0.3;

async function bake(game: Game, opts: BakeOptions): Promise<BakedJimothy | null> {
  const root = await game.assets.tryModel('assets/models/jimothy.glb');
  if (!root || !JimothyQuad.fits(root)) return null;
  const quad = new JimothyQuad(root);
  pose(quad, opts.pose ?? 'walk', opts.phase ?? DEFAULT_PHASE);
  root.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const fur = opts.fur ?? 0.85;
  const headIdx = new Set<number>();
  const parts: BakedPart[] = [];
  const headBones = new Set(HEAD_BONES.map((n) => root.getObjectByName(n)).filter(Boolean) as THREE.Object3D[]);
  const underHead = (o: THREE.Object3D) => {
    for (let q: THREE.Object3D | null = o; q; q = q.parent) if (headBones.has(q)) return true;
    return false;
  };

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.furShell) return;
    const src = mesh.geometry;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const sk = mesh as THREE.SkinnedMesh;
      sk.skeleton.update();
      headIdx.clear();
      sk.skeleton.bones.forEach((b, i) => headBones.has(b) && headIdx.add(i));
      const { whole, head } = skinBake(sk, toModel, fur, opts.splitHead ? headIdx : null);
      parts.push({ name: mesh.name, geometry: whole, material: material.clone(), head: false });
      if (head) parts.push({ name: mesh.name + 'Head', geometry: head, material: material.clone(), head: true });
    } else {
      const g = src.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toModel, mesh.matrixWorld));
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
      parts.push({ name: mesh.name, geometry: g, material: material.clone(), head: !!opts.splitHead && underHead(mesh) });
    }
  });
  const neck = new THREE.Vector3();
  const head = root.getObjectByName('Head');
  if (head) head.getWorldPosition(neck).applyMatrix4(toModel);
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    p.geometry.computeBoundingSphere();
    box.union(p.geometry.boundingBox!);
  }
  return { parts, neck, box };
}

/** Drive his animator to a still pose. */
function pose(quad: JimothyQuad, kind: JimothyPose, phase: number) {
  const s: AnimState = {
    mode: 'walk',
    speed: kind === 'walk' ? 0.65 : 0,
    vy: 0,
    grounded: true,
    carrying: false,
    washing: false,
    flop: false,
    time: 0,
    sinceChitter: 99,
    sinceBonk: 99,
    climbSpeed: 0,
    idleTime: 0,
    turn: 0,
  };
  // no idle glances / sniffs while he poses
  const q = quad as any;
  q.lookT = 1e9;
  q.lookYaw = 0;
  q.sniffT = 1e9;
  const dt = 1 / 60;
  // settle into the gait, then step on until the cycle reaches the phase we want
  for (let i = 0; i < 150; i++) {
    s.time += dt;
    quad.animate(dt, s);
  }
  if (kind === 'walk') {
    for (let i = 0; i < 120; i++) {
      const before = q.phase as number;
      const d = (phase - before + 1) % 1;
      if (d < 0.012 || d > 0.99) break;
      s.time += dt;
      quad.animate(Math.min(dt, d / 1.35), s);
    }
  }
  s.time = 0.4; // mid-breath
  quad.animate(0, s);
}

/**
 * CPU skinning of the posed mesh into a static geometry (model frame). `fur` pushes each vertex out along its normal
 * and comb direction to that fraction of its fur's length. With `headIdx`, triangles mostly weighted to those bones go
 * to a separate `head` geometry.
 */
function skinBake(sk: THREE.SkinnedMesh, toModel: THREE.Matrix4, fur: number, headIdx: Set<number> | null) {
  const g = sk.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
  const si = g.attributes.skinIndex as THREE.BufferAttribute;
  const sw = g.attributes.skinWeight as THREE.BufferAttribute;
  const len = g.getAttribute('_furlen') as THREE.BufferAttribute | undefined;
  const comb = g.getAttribute('_furcomb') as THREE.BufferAttribute | undefined;
  const n = pos.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const headW = new Float32Array(n);
  const bones = sk.skeleton.bones;
  const inv = sk.skeleton.boneInverses;
  const boneM = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inv[i]));
  const M = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const toModelSk = new THREE.Matrix4().multiplyMatrices(toModel, new THREE.Matrix4()); // world → model
  const v = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const c = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (let i = 0; i < n; i++) {
    // blended bone matrix (bind space → world), as in the skinning shader
    M.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let hw = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (!w) continue;
      const bi = si.getComponent(i, k);
      tmp.copy(boneM[bi]).multiplyScalar(w);
      for (let e = 0; e < 16; e++) M.elements[e] += tmp.elements[e];
      if (headIdx?.has(bi)) hw += w;
    }
    headW[i] = hw;
    M.multiply(sk.bindMatrix);
    M.premultiply(sk.bindMatrixInverse.clone().premultiply(sk.matrixWorld));
    M.premultiply(toModelSk);
    nm.getNormalMatrix(M);
    v.fromBufferAttribute(pos, i);
    nn.fromBufferAttribute(nor, i);
    // fur: out along the (bind) normal and the comb, in bind space, before skinning (as the shells do)
    if (fur > 0 && len) {
      const L = len.getX(i) * FUR_LENGTH * fur;
      v.addScaledVector(nn.clone().normalize(), L);
      if (comb) v.addScaledVector(c.fromBufferAttribute(comb, i), L * fur);
    }
    v.applyMatrix4(M);
    nn.applyMatrix3(nm).normalize();
    P.set([v.x, v.y, v.z], i * 3);
    N.set([nn.x, nn.y, nn.z], i * 3);
  }
  const make = (tris: number[] | null) => {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    if (uv) out.setAttribute('uv', uv.clone());
    if (tris) out.setIndex(tris);
    else if (g.index) out.setIndex(g.index.clone());
    return out;
  };
  if (!headIdx || !g.index) return { whole: make(null), head: null };
  const idx = g.index;
  const bodyTris: number[] = [];
  const headTris: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const d = idx.getX(t + 2);
    ((headW[a] + headW[b] + headW[d]) / 3 > 0.5 ? headTris : bodyTris).push(a, b, d);
  }
  return { whole: make(bodyTris), head: make(headTris) };
}
