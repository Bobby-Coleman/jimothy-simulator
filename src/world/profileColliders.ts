import * as THREE from 'three';
import type { World } from './World';

/**
 * Stepped static colliders that follow the walkable top of a static model (car roofs and hoods, boat decks and
 * cabins…). One bounding box is either too low (Jimothy sinks into the roof / deck) or too high (he floats over the
 * hood / bow). Instead, rays are cast straight down on a small grid in the model's own (yawed) frame; every column
 * becomes a box from the model's bottom up to the first surface it hits, and equal-height neighbours along the long
 * axis are merged, so a car ends up as ~8–15 boxes and a boat as ~20–30.
 *
 * `root` must already be placed in the world (matrixWorld is updated here). Returns the number of boxes created.
 */
export function profileColliders(
  world: World,
  root: THREE.Object3D,
  opts: {
    /** Yaw of the model (the grid is aligned to it). */
    rotY?: number;
    /** Target grid cell (m). */
    cell?: number;
    /** Bottom of the columns (default: the model's lowest vertex). */
    baseY?: number;
    /** Faces steeper than this (normal.y below it) are ignored (masts, sails, poles). */
    minNormalY?: number;
    /** Horizontal inset of the whole grid, per side (m) — keeps the boxes inside rounded silhouettes. */
    inset?: number;
  } = {},
): number {
  const rotY = opts.rotY ?? 0;
  const cell = opts.cell ?? 0.6;
  const minNy = opts.minNormalY ?? 0.25;
  const inset = opts.inset ?? 0.04;
  root.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().makeRotationY(-rotY);
  const toWorld = new THREE.Matrix4().makeRotationY(rotY);
  const meshes: THREE.Mesh[] = [];
  const lb = new THREE.Box3();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || (m as THREE.Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    meshes.push(m);
    for (let i = 0; i < pos.count; i++) lb.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(toLocal));
  });
  if (!meshes.length || lb.isEmpty()) return 0;
  const x0 = lb.min.x + inset,
    x1 = lb.max.x - inset,
    z0 = lb.min.z + inset,
    z1 = lb.max.z - inset;
  if (x1 <= x0 || z1 <= z0) return 0;
  const nx = Math.min(16, Math.max(1, Math.round((x1 - x0) / cell)));
  const nz = Math.min(16, Math.max(1, Math.round((z1 - z0) / cell)));
  const dx = (x1 - x0) / nx,
    dz = (z1 - z0) / nz;
  const base = opts.baseY ?? lb.min.y;
  const rc = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const n = new THREE.Vector3();
  const top: number[][] = [];
  for (let i = 0; i < nx; i++) {
    const col: number[] = [];
    for (let j = 0; j < nz; j++) {
      const o = new THREE.Vector3(x0 + (i + 0.5) * dx, lb.max.y + 1, z0 + (j + 0.5) * dz).applyMatrix4(toWorld);
      rc.set(o, down);
      rc.far = lb.max.y - base + 2;
      let h = NaN;
      for (const hit of rc.intersectObjects(meshes, false)) {
        if (!hit.face) continue;
        n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (Math.abs(n.y) < minNy) continue;
        h = hit.point.y;
        break;
      }
      col.push(h);
    }
    top.push(col);
  }
  // merge runs along the longer axis
  const alongX = x1 - x0 >= z1 - z0;
  const na = alongX ? nx : nz,
    nb = alongX ? nz : nx;
  const da = alongX ? dx : dz,
    db = alongX ? dz : dx;
  const a0 = alongX ? x0 : z0,
    b0 = alongX ? z0 : x0;
  const H = (a: number, b: number) => (alongX ? top[a][b] : top[b][a]);
  let count = 0;
  for (let b = 0; b < nb; b++) {
    let a = 0;
    while (a < na) {
      const h0 = H(a, b);
      if (!(h0 > base + 0.02)) {
        a++;
        continue;
      }
      let e = a + 1;
      let hMax = h0;
      while (e < na) {
        const h = H(e, b);
        if (!(h > base + 0.02) || Math.abs(h - h0) > 0.06) break;
        hMax = Math.max(hMax, h);
        e++;
      }
      const ca = a0 + ((a + e) / 2) * da;
      const cb = b0 + (b + 0.5) * db;
      const lc = alongX ? new THREE.Vector3(ca, 0, cb) : new THREE.Vector3(cb, 0, ca);
      lc.applyMatrix4(toWorld);
      lc.y = (base + hMax) / 2;
      const len = (e - a) * da + 0.01;
      const wid = db + 0.01;
      world.collider(lc, alongX ? new THREE.Vector3(len, hMax - base, wid) : new THREE.Vector3(wid, hMax - base, len), rotY);
      count++;
      a = e;
    }
  }
  return count;
}

const _probeMat = new THREE.MeshBasicMaterial();

/** profileColliders() for a model that is baked into a batch: parts (local geometry) + a placement transform. */
export function profileCollidersFromParts(
  world: World,
  parts: { geo: THREE.BufferGeometry }[],
  xf: { x: number; y: number; z: number; ry: number; s?: number },
  opts: { cell?: number; minNormalY?: number; inset?: number } = {},
): number {
  const g = new THREE.Group();
  g.position.set(xf.x, xf.y, xf.z);
  g.rotation.y = xf.ry;
  g.scale.setScalar(xf.s ?? 1);
  for (const p of parts) g.add(new THREE.Mesh(p.geo, _probeMat));
  return profileColliders(world, g, { ...opts, rotY: xf.ry });
}
