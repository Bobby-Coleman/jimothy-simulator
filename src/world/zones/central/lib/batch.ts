import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeShadowOnly } from '../../../shadowOnly';

export interface BatchAddOpts {
  /** Transform applied to (a clone of) the geometry. */
  matrix?: THREE.Matrix4;
  /** Vertex color (materials with vertexColors use it; default white). */
  color?: THREE.ColorRepresentation;
  /** Multiply the geometry's existing vertex colours by this tint (instead of replacing them). */
  tint?: THREE.ColorRepresentation;
  /**
   * UV mode: a number = world-space box projection with that many meters per texture repeat,
   * 'keep' = keep the geometry's own UVs (default).
   */
  uv?: number | 'keep';
  castShadow?: boolean;
  /** Chunk key for culling (defaults to a 120 m grid cell of the geometry center). */
  chunk?: string;
}

interface Bucket {
  mat: THREE.Material;
  geos: THREE.BufferGeometry[];
  castShadow: boolean;
  receiveShadow: boolean;
}

let matSerial = 1;
const matIds = new WeakMap<THREE.Material, number>();
function matId(m: THREE.Material) {
  let id = matIds.get(m);
  if (!id) matIds.set(m, (id = matSerial++));
  return id;
}

const _box = new THREE.Box3();
const _c = new THREE.Vector3();
const _col = new THREE.Color();

/**
 * Collects static geometry per material and merges it into as few meshes as possible
 * (one per material per ~120 m chunk). All geometries are normalised to position/normal/uv/color + index.
 */
export class Batch {
  private buckets = new Map<string, Bucket>();
  constructor(
    public name: string,
    public chunkSize = 120,
  ) {}

  add(geo: THREE.BufferGeometry, mat: THREE.Material, opts: BatchAddOpts = {}) {
    let g = geo.clone();
    if (opts.matrix) g.applyMatrix4(opts.matrix);
    g = normalise(g);
    if (typeof opts.uv === 'number') worldUV(g, opts.uv);
    const col = _col.set(opts.color ?? 0xffffff);
    const colors = g.getAttribute('color') as THREE.BufferAttribute;
    if (opts.color != null || !(g.userData.hadColor as boolean)) {
      for (let i = 0; i < colors.count; i++) colors.setXYZ(i, col.r, col.g, col.b);
    }
    if (opts.tint != null) {
      const t = new THREE.Color(opts.tint);
      for (let i = 0; i < colors.count; i++) colors.setXYZ(i, colors.getX(i) * t.r, colors.getY(i) * t.g, colors.getZ(i) * t.b);
    }
    let chunk = opts.chunk;
    if (chunk == null) {
      g.computeBoundingBox();
      g.boundingBox!.getCenter(_c);
      // offset by half a zone so every 120 m zone (centred on multiples of 120) is exactly one chunk
      chunk = Number.isFinite(this.chunkSize)
        ? `${Math.floor((_c.x + 60) / this.chunkSize)},${Math.floor((_c.z + 60) / this.chunkSize)}`
        : 'all';
    }
    const cast = opts.castShadow ?? true;
    const key = `${matId(mat)}|${chunk}|${cast ? 1 : 0}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { mat, geos: [], castShadow: cast, receiveShadow: true }));
    b.geos.push(g);
    return g;
  }

  /** Axis-aligned-ish box (optionally yawed) given center + size. */
  box(center: THREE.Vector3, size: THREE.Vector3, mat: THREE.Material, opts: BatchAddOpts & { rotY?: number } = {}) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const m = new THREE.Matrix4().compose(
      center,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotY ?? 0),
      new THREE.Vector3(1, 1, 1),
    );
    if (opts.matrix) m.premultiply(opts.matrix);
    return this.add(geo, mat, { ...opts, matrix: m });
  }

  /**
   * Merge many copies of a multi-part template (see furniture.ts) into the batch — cheaper than an
   * InstancedMesh per part because everything collapses into the zone's per-material meshes.
   */
  addInstances(
    parts: { geo: THREE.BufferGeometry; mat: THREE.Material; castShadow?: boolean }[],
    xfs: { x: number; y: number; z: number; ry: number; s?: number; color?: THREE.ColorRepresentation }[],
    opts: { castShadow?: boolean; chunk?: string } = {},
  ) {
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const x of xfs) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x.x, x.y, x.z), q.setFromAxisAngle(up, x.ry), new THREE.Vector3().setScalar(x.s ?? 1));
      for (const p of parts) {
        this.add(p.geo, p.mat, { matrix: m, tint: x.color, castShadow: opts.castShadow ?? p.castShadow ?? true, chunk: opts.chunk });
      }
    }
  }

  get empty() {
    return this.buckets.size === 0;
  }

  /** Merge and add everything to `parent`. Returns created meshes. */
  flush(parent: THREE.Object3D, opts: { shadowProxy?: boolean } = {}): THREE.Mesh[] {
    // With shadowProxy (default), every shadow-casting bucket of a chunk is also merged (positions only) into one
    // invisible proxy mesh that casts the chunk's shadows in a single draw call; the visible meshes stop casting.
    const out: THREE.Mesh[] = [];
    const useProxy = opts.shadowProxy !== false;
    const proxies = new Map<string, THREE.BufferGeometry[]>();
    for (const [key, b] of this.buckets) {
      if (!b.geos.length) continue;
      const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
      if (!merged) {
        console.warn('[batch] merge failed for', this.name);
        continue;
      }
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.name = this.name;
      const proxyable = useProxy && b.castShadow && !(b.mat as THREE.MeshStandardMaterial).alphaTest && !b.mat.transparent;
      if (proxyable) {
        const chunk = key.split('|')[1];
        let arr = proxies.get(chunk);
        if (!arr) proxies.set(chunk, (arr = []));
        const pg = new THREE.BufferGeometry();
        pg.setAttribute('position', merged.getAttribute('position'));
        pg.setIndex(merged.getIndex());
        arr.push(pg);
      }
      mesh.castShadow = b.castShadow && !proxyable;
      mesh.receiveShadow = b.receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
      for (const g of b.geos) if (g !== merged) g.dispose();
    }
    for (const [chunk, geos] of proxies) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const proxy = new THREE.Mesh(merged, shadowProxyMaterial());
      proxy.name = this.name + ':shadow:' + chunk;
      proxy.castShadow = true;
      proxy.receiveShadow = false;
      proxy.matrixAutoUpdate = false;
      proxy.renderOrder = -10;
      // perf: only ever drawn by the sun's shadow pass (was also vertex-processed in the colour pass: ~200k tris/frame)
      makeShadowOnly(proxy);
      parent.add(proxy);
    }
    this.buckets.clear();
    return out;
  }
}

/** Make a geometry mergeable with every other: indexed, with position/normal/uv/color only. */
export function normalise(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const hadColor = !!g.getAttribute('color');
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  const n = g.getAttribute('position').count;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const c = g.getAttribute('color');
  if (!c || c.itemSize !== 3) {
    const arr = new Float32Array(n * 3).fill(1);
    if (c && c.itemSize === 4) for (let i = 0; i < n; i++) arr.set([c.getX(i), c.getY(i), c.getZ(i)], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  } else if (!(c.array instanceof Float32Array)) {
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.getX(i), c.getY(i), c.getZ(i)], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  // uv must be float32 itemSize 2
  const uv = g.getAttribute('uv');
  if (!(uv.array instanceof Float32Array) || uv.itemSize !== 2) {
    const arr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) arr.set([uv.getX(i), uv.getY(i)], i * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  }
  if (!g.index) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  } else if (!(g.index.array instanceof Uint32Array)) {
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array as ArrayLike<number>), 1));
  }
  g.groups = [];
  g.userData.hadColor = hadColor;
  return g;
}

/** World-space box-projected UVs: floors use (x, z), walls use (x|z, y). */
export function worldUV(g: THREE.BufferGeometry, metersPerRepeat: number) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const k = 1 / metersPerRepeat;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    if (ay >= ax && ay >= az) uv.setXY(i, x * k, -z * k);
    else if (ax >= az) uv.setXY(i, (nx > 0 ? -z : z) * k, y * k);
    else uv.setXY(i, (nz > 0 ? x : -x) * k, y * k);
  }
  uv.needsUpdate = true;
}

/** Merge a list of (geometry, color, matrix) into one vertex-colored geometry (for props/templates). */
export function mergeColored(parts: { geo: THREE.BufferGeometry; color: THREE.ColorRepresentation; matrix?: THREE.Matrix4 }[]) {
  const geos = parts.map((p) => {
    let g = p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    g = normalise(g);
    const col = _col.set(p.color);
    const c = g.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, col.r, col.g, col.b);
    return g;
  });
  const merged = mergeGeometries(geos, false)!;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Translation(+yaw, +uniform scale) matrix shorthand. */
export function T(x: number, y: number, z: number, rotY = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Translation + full euler rotation. */
export function TR(x: number, y: number, z: number, rx: number, ry: number, rz: number, s = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(s, s, s),
  );
}

export function boundsOf(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  return _box.copy(g.boundingBox!);
}

let _proxyMat: THREE.MeshBasicMaterial | null = null;
/** Draws nothing in the colour pass (early-z rejected, no depth write) but casts shadows. */
export function shadowProxyMaterial() {
  if (!_proxyMat) {
    _proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    _proxyMat.name = 'shadowProxy';
  }
  return _proxyMat;
}
