/**
 * Shared building kit for the three NORTH zones (Residential Hills, University of Washing, SlopCorp).
 *  - Batch: merges thousands of primitive parts into a few vertex-coloured meshes per material & map chunk.
 *  - Materials (textured, vertex-coloured, night-reactive), canvas signs + fonts, terrain-following ribbons.
 *  - Frame: local coordinate frame for placing parts + colliders of rotated buildings.
 *  - Animators: one cheap per-frame callback list (porch lights, sprinklers, petals, servers…).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../../core/Game';
import type { World } from '../../World';
import { RAPIER, G, groups } from '../../../core/Physics';
import { assetUrl } from '../../../core/Assets';
import { registerSignYaw } from '../../signRegistry';

export const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _l = new THREE.Vector3();
const _ln = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _lnm = new THREE.Matrix3();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
/** instances(): lists up to this long are baked into merged meshes instead of InstancedMeshes (perf). */
const INSTANCE_BAKE_MAX = 24;

// ------------------------------------------------------------------ shared unit geometries
export const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1),
  /** square tapered column: bottom half-width 0.5, top 0.36 (rotated 45° so faces are axis aligned) */
  taper: (() => {
    const g = new THREE.CylinderGeometry(0.36 * Math.SQRT2, 0.5 * Math.SQRT2, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    return g.toNonIndexed();
  })(),
  cone: new THREE.ConeGeometry(0.5, 1, 12, 1),
  cone4: (() => {
    const g = new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4, 1);
    g.rotateY(Math.PI / 4);
    return g.toNonIndexed();
  })(),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  ico: new THREE.IcosahedronGeometry(0.5, 1),
  ico0: new THREE.IcosahedronGeometry(0.5, 0),
  torus: new THREE.TorusGeometry(0.5, 0.08, 8, 28),
  /** Triangular prism: base x∈[-0.5,0.5] at y=0, apex (0,1), extruded z∈[-0.5,0.5]. */
  prism: (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0);
    s.lineTo(0.5, 0);
    s.lineTo(0, 1);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    return g.index ? g.toNonIndexed() : g;
  })(),
  /** Right wedge (ramp): x∈[-0.5,0.5], rises from y=0 at z=+0.5 to y=1 at z=-0.5. */
  wedge: (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0);
    s.lineTo(0.5, 0);
    s.lineTo(-0.5, 1);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    g.rotateY(-Math.PI / 2);
    return g.index ? g.toNonIndexed() : g;
  })(),
  plane: new THREE.PlaneGeometry(1, 1),
};
for (const g of Object.values(GEO)) {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
}

/** Compose a TRS matrix (Euler order YXZ: yaw first, then pitch, then roll). */
export function trs(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0, out = new THREE.Matrix4()) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return out.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// ------------------------------------------------------------------ world-UV tile sizes (meters per texture repeat)
export const TILE: Record<string, number> = {
  siding: 2.1,
  roof: 2.2,
  brick: 1.5,
  stone: 2.8,
  wood: 2.4,
  cedar: 2.4,
  asphalt: 7,
  asphalt2: 7,
  sidewalk: 2.6,
  paving: 4,
  lawn: 3,
  hedge: 1.6,
  gravel: 3,
  concrete: 3,
  redsquare: 2.2,
  tile: 1.2,
  lattice: 0.7,
};
/** Materials that never cast shadows (flat ground decals, glowing stuff). */
const NO_SHADOW = new Set(['asphalt', 'asphalt2', 'marking', 'sidewalk', 'paving', 'lawn', 'decal', 'glow', 'lamp', 'redsquare', 'gravel', 'water']);

interface Acc {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

/**
 * Geometry batcher. Parts are transformed into world space, UV-projected (world/"frame" box mapping so a single
 * tiling texture works on every surface), tinted with vertex colours and merged per (material, map chunk).
 */
export class Batch {
  readonly accs = new Map<string, Acc>();
  /** Optional local frame for UV projection (inverse building matrix) so rotated buildings map nicely. */
  private uvFrame: THREE.Matrix4 | null = null;
  constructor(readonly cell = 60) {}

  setUVFrame(m: THREE.Matrix4 | null) {
    this.uvFrame = m ? m.clone().invert() : null;
  }

  add(
    mat: string,
    geo: THREE.BufferGeometry,
    m: THREE.Matrix4 | null,
    color: THREE.ColorRepresentation,
    opts: { uvTile?: number; swap?: boolean; keepColors?: boolean; shade?: (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void } = {},
  ) {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const vcol = opts.keepColors ? (geo.getAttribute('color') as THREE.BufferAttribute | undefined) : undefined;
    const index = geo.index;
    let cx: number, cz: number;
    if (m) {
      cx = m.elements[12];
      cz = m.elements[14];
    } else {
      if (!geo.boundingBox) geo.computeBoundingBox();
      geo.boundingBox!.getCenter(_v);
      cx = _v.x;
      cz = _v.z;
    }
    const key = `${mat}|${Math.floor(cx / this.cell)}|${Math.floor(cz / this.cell)}`;
    let a = this.accs.get(key);
    if (!a) this.accs.set(key, (a = { pos: [], nor: [], uv: [], col: [], idx: [] }));
    const base = a.pos.length / 3;
    if (m) _nm.getNormalMatrix(m);
    const tile = opts.uvTile ?? TILE[mat] ?? 0;
    const frame = this.uvFrame;
    if (frame) _lnm.getNormalMatrix(frame);
    _c.set(color);
    const col = _c.clone();
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      if (m) _v.applyMatrix4(m);
      _n.fromBufferAttribute(nor, i);
      if (m) _n.applyMatrix3(_nm).normalize();
      a.pos.push(_v.x, _v.y, _v.z);
      a.nor.push(_n.x, _n.y, _n.z);
      if (tile > 0) {
        let px = _v.x,
          py = _v.y,
          pz = _v.z,
          nx = _n.x,
          ny = _n.y,
          nz = _n.z;
        if (frame) {
          _l.copy(_v).applyMatrix4(frame);
          _ln.copy(_n).applyMatrix3(_lnm);
          px = _l.x;
          py = _l.y;
          pz = _l.z;
          nx = _ln.x;
          ny = _ln.y;
          nz = _ln.z;
        }
        const ax = Math.abs(nx),
          ay = Math.abs(ny),
          az = Math.abs(nz);
        if (ay >= ax && ay >= az) {
          if (opts.swap) a.uv.push(pz / tile, px / tile);
          else a.uv.push(px / tile, pz / tile);
        } else if (ax >= az) a.uv.push(pz / tile, py / tile);
        else a.uv.push(px / tile, py / tile);
      } else if (uv) a.uv.push(uv.getX(i), uv.getY(i));
      else a.uv.push(0, 0);
      if (opts.shade) {
        col.copy(_c);
        opts.shade(_v, _n, col);
        a.col.push(col.r, col.g, col.b);
      } else if (vcol) a.col.push(_c.r * vcol.getX(i), _c.g * vcol.getY(i), _c.b * vcol.getZ(i));
      else a.col.push(_c.r, _c.g, _c.b);
    }
    if (index) for (let i = 0; i < index.count; i++) a.idx.push(base + index.getX(i));
    else for (let i = 0; i < pos.count; i++) a.idx.push(base + i);
  }

  /** Axis-aligned-ish box by center/size with optional yaw/pitch/roll. */
  box(mat: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, ry = 0, rx = 0, rz = 0) {
    this.add(mat, GEO.box, trs(x, y, z, sx, sy, sz, ry, rx, rz, _m2), color);
  }

  /** Merge everything into meshes under `parent`. */
  build(parent: THREE.Object3D, mats: Record<string, THREE.Material>) {
    const out: THREE.Mesh[] = [];
    for (const [key, a] of this.accs) {
      if (!a.idx.length) continue;
      const matName = key.split('|')[0];
      const material = mats[matName];
      if (!material) console.warn('[north] missing material', matName);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(a.col, 3));
      const nv = a.pos.length / 3;
      g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(a.idx, 1) : new THREE.Uint16BufferAttribute(a.idx, 1));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material ?? mats.plain);
      mesh.name = `north:${key}`;
      mesh.castShadow = !NO_SHADOW.has(matName);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.accs.clear();
    return out;
  }

  /** Build a single mesh (for props): everything added must use material key `mat`. */
  buildSingle(mat: THREE.Material): THREE.Mesh {
    const all: Acc = { pos: [], nor: [], uv: [], col: [], idx: [] };
    for (const a of this.accs.values()) {
      const base = all.pos.length / 3;
      all.pos.push(...a.pos);
      all.nor.push(...a.nor);
      all.uv.push(...a.uv);
      all.col.push(...a.col);
      for (const i of a.idx) all.idx.push(base + i);
    }
    this.accs.clear();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(all.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(all.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(all.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(all.col, 3));
    g.setIndex(all.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(all.idx, 1) : new THREE.Uint16BufferAttribute(all.idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/**
 * Local coordinate frame (position + yaw) for building rotated structures: parts & colliders in local coords.
 * Local +Z = "front" (the direction the building faces), +X = along the front, +Y up.
 */
export class Frame {
  readonly m = new THREE.Matrix4();
  readonly q = new THREE.Quaternion();
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly rotY: number,
  ) {
    this.q.setFromAxisAngle(UP, rotY);
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1));
  }
  /** Local → world point. */
  p(lx: number, ly: number, lz: number, out = new THREE.Vector3()) {
    return out.set(lx, ly, lz).applyMatrix4(this.m);
  }
  /** Local direction → world. */
  dir(lx: number, ly: number, lz: number, out = new THREE.Vector3()) {
    return out.set(lx, ly, lz).applyQuaternion(this.q);
  }
  /** Matrix for a local part. */
  mat(lx: number, ly: number, lz: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0, out = new THREE.Matrix4()) {
    trs(lx, ly, lz, sx, sy, sz, ry, rx, rz, out);
    return out.premultiply(this.m);
  }
  box(b: Batch, mat: string, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, ry = 0, rx = 0, rz = 0) {
    b.add(mat, GEO.box, this.mat(lx, ly, lz, sx, sy, sz, ry, rx, rz, _m), color);
  }
  geo(b: Batch, mat: string, geo: THREE.BufferGeometry, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, ry = 0, rx = 0, rz = 0) {
    b.add(mat, geo, this.mat(lx, ly, lz, sx, sy, sz, ry, rx, rz, _m), color);
  }
  /** Static box collider in local coords (with optional local pitch/roll). */
  collider(game: Game, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
    const c = this.p(lx, ly, lz);
    _e.set(rx, ry, rz, 'YXZ');
    const lq = new THREE.Quaternion().setFromEuler(_e);
    const q = this.q.clone().multiply(lq);
    return game.physics.staticBox(c, new THREE.Vector3(Math.max(0.02, sx / 2), Math.max(0.02, sy / 2), Math.max(0.02, sz / 2)), q);
  }
}

/**
 * Climbable roof collider: a slab from the wall line up to the ridge (no eave overhang, so a raccoon climbing the
 * wall can mantle straight onto the roof instead of bonking the eaves). `axis` = local axis the slope runs along;
 * side `s` = ±1; `wallPos` = |coordinate| of the wall line; `extent` = size along the other horizontal axis.
 */
export function roofCollider(game: Game, f: Frame, axis: 'x' | 'z', s: number, wallPos: number, wallY: number, ridgeY: number, extent: number, center = 0) {
  const run = Math.abs(wallPos);
  const rise = ridgeY - wallY;
  const th = Math.atan2(rise, run);
  const L = Math.hypot(run, rise) + 0.12;
  const tc = 0.3;
  // floor pass: top face 0.2 m above the rafter line = the top of the 0.2 m roof slabs (it was 0.3, so he floated
  // ~12 cm over every roof)
  const up = tc / 2 - 0.1;
  const mh = (s * run) / 2;
  const my = (wallY + ridgeY) / 2;
  const ch = mh + s * Math.sin(th) * up - s * Math.cos(th) * 0.06;
  const cy = my + Math.cos(th) * up + Math.sin(th) * 0.06;
  if (axis === 'x') f.collider(game, ch, cy, center, L, tc, extent, 0, 0, -s * th);
  else f.collider(game, center, cy, ch, extent, tc, L, 0, s * th, 0);
}

/** Stepped (3-box) collider filling a gable-end triangle so climbers can keep going up the gable wall. */
export function gableCollider(game: Game, f: Frame, axis: 'x' | 'z', s: number, pos: number, baseY: number, width: number, rise: number, thick = 0.3) {
  for (let k = 0; k < 3; k++) {
    const wk = width * (1 - (k + 0.5) / 3);
    const yk = baseY + ((k + 0.5) * rise) / 3;
    if (axis === 'z') f.collider(game, 0, yk, s * pos, wk, rise / 3, thick);
    else f.collider(game, s * pos, yk, 0, thick, rise / 3, wk);
  }
}

/** Static box collider with an arbitrary rotation (Euler YXZ). */
export function colliderBox(game: Game, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  const q = new THREE.Quaternion().setFromEuler(_e);
  return game.physics.staticBox(new THREE.Vector3(x, y, z), new THREE.Vector3(sx / 2, sy / 2, sz / 2), q);
}

/** Static convex-hull collider around world-space points (roofs, pyramids, odd plinths). */
export function colliderHull(game: Game, pts: THREE.Vector3[], friction = 0.8) {
  const arr = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => arr.set([p.x, p.y, p.z], i * 3));
  const cd = RAPIER.ColliderDesc.convexHull(arr);
  if (!cd) return null;
  return game.physics.staticCollider(cd.setFriction(friction).setCollisionGroups(groups(G.WORLD)));
}

/** Static vertical cylinder collider. */
export function colliderCyl(game: Game, x: number, y: number, z: number, radius: number, height: number, friction = 0.8) {
  const cd = RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(x, y, z).setFriction(friction).setCollisionGroups(groups(G.WORLD));
  return game.physics.staticCollider(cd);
}

/** Ring of box colliders (fountain rims, trampoline frames, tanks). */
export function colliderRing(game: Game, x: number, y: number, z: number, radius: number, height: number, thickness: number, segments = 16) {
  const seg = ((2 * Math.PI * radius) / segments) * 1.15;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    colliderBox(game, x + Math.cos(a) * radius, y, z + Math.sin(a) * radius, thickness, height, seg, -a);
  }
}

// ------------------------------------------------------------------ terrain helpers

/** Min/max terrain height over a (rotated) rectangle. */
export function footprint(world: World, cx: number, cz: number, w: number, d: number, rotY = 0, step = 1) {
  let min = Infinity,
    max = -Infinity;
  const c = Math.cos(rotY),
    s = Math.sin(rotY);
  const nx = Math.max(2, Math.ceil(w / step) + 1);
  const nz = Math.max(2, Math.ceil(d / step) + 1);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const lx = -w / 2 + (w * i) / (nx - 1);
      const lz = -d / 2 + (d * j) / (nz - 1);
      const x = cx + lx * c + lz * s;
      const z = cz - lx * s + lz * c;
      const h = world.heightAt(x, z);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { min, max };
}

/** Min/max terrain over a circle. */
export function footprintCircle(world: World, cx: number, cz: number, r: number) {
  let min = world.heightAt(cx, cz),
    max = min;
  for (let ring = 1; ring <= 3; ring++) {
    const rr = (r * ring) / 3;
    const n = 8 * ring;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = world.heightAt(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { min, max };
}

/** Resample a polyline (XZ) at ~`step` spacing, keeping the corners. */
export function resample(pts: THREE.Vector2[], step: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [pts[0].clone()];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1],
      b = pts[i];
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}

/** Smooth polyline through control points (Catmull-Rom in XZ). */
export function smoothPath(ctrl: [number, number][], step = 1.5): THREE.Vector2[] {
  const curve = new THREE.CatmullRomCurve3(
    ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'centripetal',
  );
  const len = curve.getLength();
  const n = Math.max(2, Math.ceil(len / step));
  return curve.getSpacedPoints(n).map((p) => new THREE.Vector2(p.x, p.z));
}

/**
 * Terrain-conforming ribbon along a path, between signed lateral offsets o0 < o1 (left = negative? no:
 * offsets are along the path's right-hand normal). Returns a world-space geometry with u across / v along.
 */
export function ribbon(
  world: World,
  path: THREE.Vector2[],
  o0: number,
  o1: number,
  lift: number,
  opts: { tile?: number; across?: number; heightFn?: (x: number, z: number) => number } = {},
): THREE.BufferGeometry {
  const tile = opts.tile ?? 4;
  // floor pass: sample the terrain at least every ~2 m (its grid) both along and across. Two-point paths (UW's
  // cross walk, lawn strips…) used to be flat chords that floated up to 0.4 m above (or sank into) the hill.
  const across = Math.max(opts.across ?? 1, Math.ceil(Math.abs(o1 - o0) / 2));
  for (let i = 1; i < path.length; i++) {
    if (path[i].distanceTo(path[i - 1]) > 2.05) {
      path = resample(path, 2);
      break;
    }
  }
  const hf = opts.heightFn ?? ((x: number, z: number) => world.heightAt(x, z));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let s = 0;
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const p = path[i];
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    const tx = b.x - a.x,
      tz = b.y - a.y;
    const tl = Math.hypot(tx, tz) || 1;
    // right-hand normal (in XZ, looking along the path from above: +x east, +z south)
    const rx = -tz / tl,
      rz = tx / tl;
    if (i > 0) s += p.distanceTo(path[i - 1]);
    for (let j = 0; j <= across; j++) {
      const o = o0 + ((o1 - o0) * j) / across;
      const x = p.x + rx * o,
        z = p.y + rz * o;
      pos.push(x, hf(x, z) + lift, z);
      uv.push(o / tile, s / tile);
    }
  }
  const w = across + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * w + j,
        b = a + 1,
        c = a + w,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure it faces up
  const nrm = g.getAttribute('normal');
  let up = 0;
  for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
  if (up < 0) {
    const ix = g.index!;
    for (let i = 0; i < ix.count; i += 3) {
      const t = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, t);
    }
    g.computeVertexNormals();
  }
  return g;
}

/**
 * Static trimesh collider from world-space geometry (e.g. a ribbon()) — raised sidewalks, curbs, paths and pads
 * that stand proud of the terrain, so Jimothy walks ON them instead of sinking to the grass below.
 */
export { trimeshFromGeometry as surfaceCollider } from '../central/lib/util';

/** Terrain-conforming square decal centred on (x, z) with half-size R and UVs 0..1 (use a round texture/alpha). */
export function groundDecal(world: World, x: number, z: number, R: number, lift = 0.05, segs = 6): THREE.BufferGeometry {
  const g = ribbon(world, [new THREE.Vector2(x - R, z), new THREE.Vector2(x + R, z)], -R, R, lift, { tile: 1, across: segs });
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - (x - R)) / (2 * R), (pos.getZ(i) - (z - R)) / (2 * R));
  return g;
}

/** Vertical wall strip along a path at lateral offset o, from terrain+lift0 to terrain+lift1 (curbs, retaining walls). */
export function curbWall(world: World, path: THREE.Vector2[], o: number, lift0: number, lift1: number, facing: 1 | -1, tile = 2): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let s = 0;
  const n = path.length;
  for (let i = 0; i < n; i++) {
    const p = path[i];
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    const tx = b.x - a.x,
      tz = b.y - a.y;
    const tl = Math.hypot(tx, tz) || 1;
    const rx = -tz / tl,
      rz = tx / tl;
    if (i > 0) s += p.distanceTo(path[i - 1]);
    const x = p.x + rx * o,
      z = p.y + rz * o;
    const h = world.heightAt(x, z);
    pos.push(x, h + lift0, z, x, h + lift1, z);
    uv.push(s / tile, lift0 / tile, s / tile, lift1 / tile);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2,
      b = a + 1,
      c = a + 2,
      d = a + 3;
    // facing +1: normal points toward +offset side (right of the path direction)
    if (facing > 0) idx.push(a, c, b, b, c, d);
    else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Signed distance from point to a polyline (XZ), plus the closest segment tangent. */
export function distToPath(path: THREE.Vector2[], x: number, z: number) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i],
      b = path[i + 1];
    const abx = b.x - a.x,
      abz = b.y - a.y;
    const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.y) * abz) / (abx * abx + abz * abz || 1), 0, 1);
    const d = Math.hypot(a.x + abx * t - x, a.y + abz * t - z);
    if (d < best) best = d;
  }
  return best;
}

// ------------------------------------------------------------------ materials

export type MatSet = Record<string, THREE.MeshStandardMaterial>;
const matCache = new WeakMap<Game, Promise<MatSet>>();

/** Shared north-zone materials (textures load once, all vertex-coloured). */
export function northMaterials(game: Game): Promise<MatSet> {
  let p = matCache.get(game);
  if (!p) {
    p = createMaterials(game);
    matCache.set(game, p);
  }
  return p;
}

async function createMaterials(game: Game): Promise<MatSet> {
  const A = game.assets;
  const tex = (name: string) => A.tryTexture(`assets/textures/${name}/color.jpg`);
  const nrm = (name: string) => A.tryTexture(`assets/textures/${name}/normal.jpg`, { srgb: false });
  const [siding, shingles, brick, brickN, stone, planks, asphalt, asphaltN, sidewalk, paving, grass, gravel] = await Promise.all([
    tex('siding'),
    tex('shingles'),
    tex('brick'),
    nrm('brick'),
    tex('mossy_stone'),
    tex('planks'),
    tex('asphalt'),
    nrm('asphalt'),
    tex('sidewalk'),
    tex('paving'),
    tex('grass'),
    tex('gravel'),
  ]);
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...p });
  const hedgeTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7f8f6f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const l = 45 + Math.random() * 55;
      ctx.fillStyle = `hsl(${95 + Math.random() * 30}, ${30 + Math.random() * 25}%, ${l}%)`;
      const x = Math.random() * w,
        y = Math.random() * h,
        r = 3 + Math.random() * 7;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  hedgeTex.wrapS = hedgeTex.wrapT = THREE.RepeatWrapping;
  const poolTex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c9d6dc';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo((i * w) / 4, 0);
      ctx.lineTo((i * w) / 4, h);
      ctx.moveTo(0, (i * h) / 4);
      ctx.lineTo(w, (i * h) / 4);
      ctx.stroke();
    }
  });
  poolTex.wrapS = poolTex.wrapT = THREE.RepeatWrapping;
  const latticeTex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 14;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * w, 0);
      ctx.lineTo(i * w + w, h);
      ctx.moveTo(i * w + w, 0);
      ctx.lineTo(i * w, h);
      ctx.moveTo(i * w + w / 2, 0);
      ctx.lineTo(i * w + w / 2 + w, h);
      ctx.moveTo(i * w + w / 2 + w, 0);
      ctx.lineTo(i * w + w / 2, h);
      ctx.stroke();
    }
  });
  latticeTex.wrapS = latticeTex.wrapT = THREE.RepeatWrapping;

  const m: MatSet = {
    plain: std({ roughness: 0.8 }),
    gloss: std({ roughness: 0.35 }),
    metal: std({ roughness: 0.35, metalness: 0.75 }),
    trim: std({ roughness: 0.6 }),
    siding: std({ map: siding, roughness: 0.8 }),
    roof: std({ map: shingles, roughness: 0.9 }),
    brick: std({ map: brick, normalMap: brickN ?? undefined, roughness: 0.9 }),
    stone: std({ map: stone, roughness: 0.95 }),
    wood: std({ map: planks, roughness: 0.8 }),
    asphalt: std({ map: asphalt, normalMap: asphaltN ?? undefined, roughness: 0.95 }),
    sidewalk: std({ map: sidewalk, roughness: 0.9 }),
    paving: std({ map: paving, roughness: 0.9 }),
    redsquare: std({ map: brick, roughness: 0.9 }),
    lawn: std({ map: grass, roughness: 1 }),
    gravel: std({ map: gravel, roughness: 1 }),
    concrete: std({ map: sidewalk, roughness: 0.95 }),
    hedge: std({ map: hedgeTex, roughness: 1 }),
    leaves: std({ roughness: 0.9, flatShading: true }),
    bark: std({ roughness: 1 }),
    tile: std({ map: poolTex, roughness: 0.3 }),
    lattice: std({ map: latticeTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }),
    paint: std({ roughness: 0.7 }),
    decal: std({ roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    glass: std({ roughness: 0.08, metalness: 0.4, envMapIntensity: 2 }),
    glassLit: std({ roughness: 0.1, metalness: 0.3, emissive: new THREE.Color(0xffc56b), emissiveIntensity: 0 }),
    lamp: std({ roughness: 0.4, emissive: new THREE.Color(0xffe2a8), emissiveIntensity: 0.2 }),
    glow: std({ roughness: 0.5, emissive: new THREE.Color(0xffffff), emissiveIntensity: 1.6 }),
    towerGlass: std({ roughness: 0.05, metalness: 0.7, envMapIntensity: 3 }),
  };
  for (const k of ['siding', 'roof', 'brick', 'stone', 'wood', 'asphalt', 'sidewalk', 'paving', 'redsquare', 'lawn', 'gravel', 'concrete', 'hedge', 'tile']) {
    const mm = m[k];
    if (mm.map) mm.map.wrapS = mm.map.wrapT = THREE.RepeatWrapping;
  }
  // polygon offset for ground ribbons so they never z-fight with the terrain
  for (const k of ['asphalt', 'sidewalk', 'paving', 'redsquare', 'lawn', 'gravel']) {
    m[k].polygonOffset = true;
    m[k].polygonOffsetFactor = -1;
    m[k].polygonOffsetUnits = -2;
  }
  m.decal.vertexColors = true;
  // light cedar boards (fences, decks) — the planks texture is dark walnut, so paint our own
  const cedarTex = canvasTexture(256, 256, (ctx, w, h) => {
    const boards = 8;
    const bw = w / boards;
    for (let i = 0; i < boards; i++) {
      const l = 58 + Math.random() * 12;
      ctx.fillStyle = `hsl(${26 + Math.random() * 8}, ${45 + Math.random() * 12}%, ${l}%)`;
      ctx.fillRect(i * bw, 0, bw, h);
      // grain
      for (let k = 0; k < 14; k++) {
        ctx.strokeStyle = `hsla(${22 + Math.random() * 8}, 45%, ${l - 12 - Math.random() * 10}%, 0.35)`;
        ctx.lineWidth = 1 + Math.random() * 1.5;
        const x = i * bw + 3 + Math.random() * (bw - 6);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + (Math.random() - 0.5) * 6, h * 0.33, x + (Math.random() - 0.5) * 6, h * 0.66, x + (Math.random() - 0.5) * 4, h);
        ctx.stroke();
      }
      // knots
      for (let k = 0; k < 2; k++) {
        ctx.fillStyle = `hsla(20, 45%, ${l - 25}%, 0.5)`;
        ctx.beginPath();
        ctx.ellipse(i * bw + bw / 2 + (Math.random() - 0.5) * bw * 0.4, Math.random() * h, 2.5, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(60,35,20,0.55)';
      ctx.fillRect(i * bw, 0, 2, h);
    }
  });
  cedarTex.wrapS = cedarTex.wrapT = THREE.RepeatWrapping;
  m.cedar = std({ map: cedarTex, roughness: 0.85 });
  // a second asphalt that always wins over the first where roads overlap (junctions)
  m.asphalt2 = m.asphalt.clone();
  m.asphalt2.polygonOffsetFactor = -2;
  m.asphalt2.polygonOffsetUnits = -6;
  m.marking = std({ roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10 });

  // Night: windows & lamps glow (tied to environment.nightFactor)
  addAnimator(game, (_dt, _t, night) => {
    m.glassLit.emissiveIntensity = night * 1.25;
    m.lamp.emissiveIntensity = 0.15 + night * 3.2;
  });
  return m;
}

// ------------------------------------------------------------------ animators (single cheap per-frame hook)

type AnimFn = (dt: number, t: number, night: number, game: Game) => void;
const animState = new WeakMap<Game, AnimFn[]>();

/** Register a per-frame callback (runs while the game is not paused). `night` = environment.nightFactor. */
export function addAnimator(game: Game, fn: AnimFn) {
  let list = animState.get(game);
  if (!list) {
    list = [];
    animState.set(game, list);
    const fns = list;
    game.entities.create({
      kind: 'static',
      name: 'North Ambience',
      update(g, dt) {
        const env = g.get<any>('environment');
        const night = env?.nightFactor ?? 0;
        for (const f of fns) f(dt, g.time, night, g);
      },
    });
  }
  list.push(fn);
}

// ------------------------------------------------------------------ canvas signs & fonts

let fontsP: Promise<void> | null = null;
/** Load the project's display fonts for canvas text (Lilita One, Luckiest Guy, Nunito). */
export function loadFonts(): Promise<void> {
  if (!fontsP) {
    fontsP = (async () => {
      if (typeof FontFace === 'undefined') return;
      const list: [string, string, FontFaceDescriptors?][] = [
        ['Lilita One', 'assets/fonts/LilitaOne-Regular.ttf'],
        ['Luckiest Guy', 'assets/fonts/LuckiestGuy-Regular.ttf'],
        ['Nunito', 'assets/fonts/Nunito-VariableFont_wght.ttf', { weight: '200 1000' }],
      ];
      await Promise.all(
        list.map(async ([fam, url, desc]) => {
          try {
            const ff = new FontFace(fam, `url(${assetUrl(url)})`, desc);
            await ff.load();
            (document.fonts as any).add(ff);
          } catch {
            /* fall back to system fonts */
          }
        }),
      );
    })();
  }
  return fontsP;
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Draw text that shrinks to fit `maxW`. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string, weight = '') {
  let s = Math.round(size);
  do {
    ctx.font = `${weight} ${s}px ${font}`.trim();
    // ink box, not just the advance: display fonts overhang it
    const m = ctx.measureText(text);
    if (Math.max(m.width, (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? 0)) <= maxW) break;
    s -= s > 40 ? 2 : 1;
  } while (s > 8);
  ctx.fillText(text, x, y);
  return s;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * A flat sign panel (canvas texture on the front). The panel faces local +Z of the given yaw.
 * Default: a single-material front plane (1 draw call) + a backing slab merged into `opts.batch` (or its own mesh).
 * `asBox`: one BoxGeometry with 6 materials (front = index 4) — used where other systems look for a box face.
 * `emissive` makes it glow; `lit` brightens it at night. Returns the front mesh.
 */
export function signPanel(
  world: World,
  tex: THREE.Texture,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  rotY: number,
  opts: {
    emissive?: number;
    back?: THREE.ColorRepresentation;
    depth?: number;
    collide?: boolean;
    tilt?: number;
    lit?: boolean;
    game?: Game;
    batch?: Batch;
    asBox?: boolean;
    name?: string;
    doubleSided?: boolean;
    /** Push the board this far along its facing, e.g. post radius + depth / 2 to sit in front of a post. */
    standoff?: number;
  } = {},
): THREE.Mesh {
  const depth = opts.depth ?? 0.08;
  const front = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  if (opts.emissive || opts.lit) {
    front.emissive = new THREE.Color(0xffffff);
    front.emissiveMap = tex;
    front.emissiveIntensity = opts.emissive ?? 0;
  }
  const rot = new THREE.Euler(opts.tilt ?? 0, rotY, 0, 'YXZ');
  const quat = new THREE.Quaternion().setFromEuler(rot);
  const center = new THREE.Vector3(x, y, z);
  // mount the board in front of a post at (x, z) instead of skewering it: shift it forward by `standoff`
  if (opts.standoff) center.add(new THREE.Vector3(0, 0, opts.standoff).applyQuaternion(quat));
  {
    const im = tex.image as { width?: number; height?: number } | undefined;
    const fo = center.clone().add(new THREE.Vector3(0, 0, depth / 2).applyQuaternion(quat));
    registerSignYaw(opts.name ?? 'north.signPanel', fo.toArray(), rotY, w, h, im?.width && im.height ? im.width / im.height : undefined, opts.tilt ?? 0);
  }
  let mesh: THREE.Mesh;
  if (opts.asBox) {
    const side = world.material(opts.back ?? 0x55585e, { roughness: 0.7 });
    mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), [side, side, side, side, front, side]);
    mesh.position.copy(center);
    mesh.quaternion.copy(quat);
  } else {
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), front);
    mesh.position.copy(center).add(new THREE.Vector3(0, 0, depth / 2 + 0.004).applyQuaternion(quat));
    mesh.quaternion.copy(quat);
    const backM = new THREE.Matrix4().compose(center, quat, new THREE.Vector3(w + 0.02, h + 0.02, depth));
    if (opts.batch) opts.batch.add('plain', GEO.box, backM, opts.back ?? 0x55585e, { uvTile: 0 });
    else {
      const back = new THREE.Mesh(GEO.box, world.material(opts.back ?? 0x55585e, { roughness: 0.7 }));
      back.matrixAutoUpdate = false;
      back.matrix.copy(backM);
      back.castShadow = true;
      back.receiveShadow = true;
      world.staticRoot.add(back);
    }
    if (opts.doubleSided) {
      const m2 = new THREE.Mesh(mesh.geometry, front);
      m2.position.copy(center).add(new THREE.Vector3(0, 0, -depth / 2 - 0.004).applyQuaternion(quat));
      m2.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
      m2.receiveShadow = true;
      world.staticRoot.add(m2);
    }
  }
  if (opts.name) mesh.name = opts.name;
  mesh.castShadow = !!opts.asBox;
  mesh.receiveShadow = true;
  world.staticRoot.add(mesh);
  if (opts.collide !== false) world.game.physics.staticBox(center.clone(), new THREE.Vector3(w / 2, h / 2, Math.max(0.05, depth / 2)), quat);
  if (opts.lit && opts.game) {
    const base = opts.emissive ?? 0;
    addAnimator(opts.game, (_dt, _t, night) => {
      front.emissiveIntensity = base + night * 0.9;
    });
  }
  return mesh;
}

// ------------------------------------------------------------------ instancing with explicit positions

/**
 * Instanced static copies of a template (merged per material) at explicit positions [x, y, z, rotY, scale].
 * Returns the group. Colliders are up to the caller.
 */
export function instances(world: World, template: THREE.Object3D, list: [number, number, number, number, number][], opts: { castShadow?: boolean } = {}) {
  const meshes: THREE.Mesh[] = [];
  template.updateMatrixWorld(true);
  template.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });
  const group = new THREE.Group();
  // perf: short lists are baked into plain merged meshes — the StaticBatcher then folds them into the zone's
  // same-material batches. One InstancedMesh per template part for 1–3 trees cost ~30 extra draw calls in the Hills.
  if (list.length <= INSTANCE_BAKE_MAX && meshes.every((m) => !Array.isArray(m.material))) {
    for (const src of meshes) {
      const local = src.matrixWorld.clone();
      const geos = list.map(([x, y, z, ry, sc]) => {
        _q.setFromAxisAngle(UP, ry);
        _s.setScalar(sc);
        _p.set(x, y, z);
        _m.compose(_p, _q, _s).multiply(local);
        return src.geometry.clone().applyMatrix4(_m);
      });
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      if (merged !== geos[0]) for (const g of geos) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, src.material);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    world.staticRoot.add(group);
    return group;
  }
  for (const src of meshes) {
    const im = new THREE.InstancedMesh(src.geometry, src.material, list.length);
    im.castShadow = opts.castShadow ?? true;
    im.receiveShadow = true;
    const local = src.matrixWorld.clone();
    list.forEach(([x, y, z, ry, sc], i) => {
      _q.setFromAxisAngle(UP, ry);
      _s.setScalar(sc);
      _p.set(x, y, z);
      _m.compose(_p, _q, _s).multiply(local);
      im.setMatrixAt(i, _m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    group.add(im);
  }
  world.staticRoot.add(group);
  return group;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

/**
 * Rapier only rebuilds its scene-query structure during a step, so raycasts/overlaps that other systems make in
 * their init() (before the first frame — e.g. snapping quest props onto my porches, finding a clear spot for the
 * slop dragon pad) can't see the colliders created while building the world. A tiny empty step refreshes it:
 * no events are collected, sleeping bodies stay asleep, nothing visibly moves.
 */
export function refreshQueries(game: Game) {
  const w = game.physics.world;
  const dt = w.timestep;
  w.timestep = 1e-6;
  w.step();
  w.timestep = dt;
}

/** Put a POI (clone) into the world registry. */
export function poi(world: World, name: string, x: number, y: number, z: number) {
  world.poi.set(name, new THREE.Vector3(x, y, z));
}
