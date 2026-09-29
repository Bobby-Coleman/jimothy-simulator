import * as THREE from 'three';
import type { Game } from '../../../../core/Game';
import type { World } from '../../../World';
import { mergeColored, T, TR } from './batch';
import { cached, glowTexture } from './textures';
import { glowAtNight, onFrame, Rng } from './util';

/**
 * Street furniture templates. Every template is a list of parts (geometry + material) with its origin at the
 * bottom centre and its "front" facing +Z. They are placed with `placeInstances` (one InstancedMesh per part).
 */

export interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  castShadow?: boolean;
}
export interface Xf {
  x: number;
  y: number;
  z: number;
  ry: number;
  s?: number;
  color?: THREE.ColorRepresentation;
}

// ------------------------------------------------------------------------------------------- shared materials

export function furnMat() {
  return cached('mat:furn', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18 }));
}
export function furnMatMatte() {
  return cached('mat:furnMatte', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
}
export function foliageMat() {
  return cached('mat:foliage', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true }));
}

/** Warm lamp glass: frosted by day, glowing at night (bloom). */
export function lampGlassMat(game: Game) {
  return cached('mat:lampGlass', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffc46b, emissiveIntensity: 0, roughness: 0.3 });
    glowAtNight(game, m, 0.08, 4.2);
    return m;
  });
}

/** Warm window/fairy-light glow material. */
export function warmGlowMat(game: Game) {
  return cached('mat:warmGlow', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb347, emissiveIntensity: 0, roughness: 0.4 });
    glowAtNight(game, m, 0.3, 3.5);
    return m;
  });
}

// ------------------------------------------------------------------------------------------- placement

export function placeInstances(
  world: World,
  parts: Part[],
  xfs: Xf[],
  opts: { collider?: THREE.Vector3; colliderYOffset?: number; name?: string } = {},
) {
  if (!xfs.length) return [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const out: THREE.InstancedMesh[] = [];
  const anyColor = xfs.some((x) => x.color != null);
  for (const part of parts) {
    const im = new THREE.InstancedMesh(part.geo, part.mat, xfs.length);
    im.name = opts.name ?? 'furniture';
    im.castShadow = part.castShadow ?? true;
    im.receiveShadow = true;
    const col = new THREE.Color();
    xfs.forEach((x, i) => {
      q.setFromAxisAngle(up, x.ry);
      s.setScalar(x.s ?? 1);
      p.set(x.x, x.y, x.z);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
      if (anyColor) im.setColorAt(i, col.set(x.color ?? 0xffffff));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    world.staticRoot.add(im);
    out.push(im);
  }
  if (opts.collider) {
    for (const x of xfs) {
      const sz = opts.collider.clone().multiplyScalar(x.s ?? 1);
      world.collider(new THREE.Vector3(x.x, x.y + (opts.colliderYOffset ?? 0) + sz.y / 2, x.z), sz, x.ry);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------- geometry helpers

const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const bx = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const sph = (r: number, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h);

// ------------------------------------------------------------------------------------------- templates

/** Modern cobra-head street light, arm reaching toward +Z (the road). ~8 m tall. */
export function avenueLamp(game: Game): Part[] {
  return cached('tpl:avenueLamp', () => {
    const pole = 0x6c747d;
    const dark = 0x3d434a;
    const body = mergeColored([
      { geo: cyl(0.2, 0.24, 0.55), color: dark, matrix: T(0, 0.275, 0) },
      { geo: cyl(0.085, 0.12, 7.6), color: pole, matrix: T(0, 0.55 + 3.8, 0) },
      { geo: bx(0.1, 0.1, 2.3), color: pole, matrix: TR(0, 8.0, 1.05, -0.12, 0, 0) },
      { geo: cyl(0.1, 0.1, 0.25), color: pole, matrix: T(0, 8.1, 0) },
      { geo: bx(0.46, 0.2, 0.95), color: 0x8a939c, matrix: TR(0, 8.2, 2.35, -0.08, 0, 0) },
      { geo: bx(0.5, 0.06, 1.0), color: dark, matrix: TR(0, 8.31, 2.35, -0.08, 0, 0) },
    ]);
    const glass = mergeColored([{ geo: bx(0.38, 0.05, 0.72), color: 0xffffff, matrix: TR(0, 8.08, 2.37, -0.08, 0, 0) }]);
    return [
      { geo: body, mat: furnMat() },
      { geo: glass, mat: lampGlassMat(game), castShadow: false },
    ];
  });
}

/** Historic acorn lamp post (Old Ballard). ~4.6 m. */
export function historicLamp(game: Game): Part[] {
  return cached('tpl:historicLamp', () => {
    const iron = 0x1f2d27;
    const brass = 0xb8923f;
    const body = mergeColored([
      { geo: cyl(0.2, 0.26, 0.5, 8), color: iron, matrix: T(0, 0.25, 0) },
      { geo: cyl(0.13, 0.2, 0.6, 8), color: iron, matrix: T(0, 0.8, 0) },
      { geo: cyl(0.075, 0.09, 2.9, 10), color: iron, matrix: T(0, 1.1 + 1.45, 0) },
      { geo: cyl(0.14, 0.1, 0.2, 10), color: brass, matrix: T(0, 4.05, 0) },
      { geo: cyl(0.22, 0.14, 0.16, 12), color: iron, matrix: T(0, 4.2, 0) },
      // cross arms with two small side globes' caps
      { geo: bx(1.3, 0.07, 0.07), color: iron, matrix: T(0, 3.6, 0) },
      { geo: new THREE.ConeGeometry(0.2, 0.28, 12), color: iron, matrix: T(0, 4.95, 0) },
      { geo: sph(0.05), color: brass, matrix: T(0, 5.12, 0) },
      { geo: new THREE.ConeGeometry(0.14, 0.2, 10), color: iron, matrix: T(0.65, 3.98, 0) },
      { geo: new THREE.ConeGeometry(0.14, 0.2, 10), color: iron, matrix: T(-0.65, 3.98, 0) },
    ]);
    const glass = mergeColored([
      { geo: sph(0.26, 14, 10), color: 0xffffff, matrix: T(0, 4.55, 0, 0, 1, 1.25, 1) },
      { geo: sph(0.17, 12, 8), color: 0xffffff, matrix: T(0.65, 3.72, 0, 0, 1, 1.2, 1) },
      { geo: sph(0.17, 12, 8), color: 0xffffff, matrix: T(-0.65, 3.72, 0, 0, 1, 1.2, 1) },
    ]);
    return [
      { geo: body, mat: furnMat() },
      { geo: glass, mat: lampGlassMat(game), castShadow: false },
    ];
  });
}

/** Chunky yellow Seattle-ish fire hydrant (~0.8 m). */
export function hydrant(): Part[] {
  return cached('tpl:hydrant', () => {
    const y = 0xf2c230;
    const r = 0xd8412f;
    const geo = mergeColored([
      { geo: cyl(0.2, 0.22, 0.07, 14), color: y, matrix: T(0, 0.035, 0) },
      { geo: cyl(0.15, 0.16, 0.55, 14), color: y, matrix: T(0, 0.34, 0) },
      { geo: cyl(0.19, 0.19, 0.06, 14), color: y, matrix: T(0, 0.62, 0) },
      { geo: new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), color: r, matrix: T(0, 0.64, 0) },
      { geo: cyl(0.04, 0.05, 0.08, 6), color: r, matrix: T(0, 0.82, 0) },
      { geo: cyl(0.06, 0.06, 0.34, 10), color: y, matrix: TR(0, 0.45, 0, 0, 0, Math.PI / 2) },
      { geo: cyl(0.075, 0.075, 0.05, 10), color: r, matrix: TR(0.18, 0.45, 0, 0, 0, Math.PI / 2) },
      { geo: cyl(0.075, 0.075, 0.05, 10), color: r, matrix: TR(-0.18, 0.45, 0, 0, 0, Math.PI / 2) },
      { geo: cyl(0.09, 0.09, 0.14, 10), color: y, matrix: TR(0, 0.42, 0.13, Math.PI / 2, 0, 0) },
      { geo: cyl(0.1, 0.1, 0.05, 10), color: r, matrix: TR(0, 0.42, 0.21, Math.PI / 2, 0, 0) },
    ]);
    return [{ geo, mat: furnMat() }];
  });
}

/** Park bench, seat facing +Z. 1.8 m wide. */
export function bench(): Part[] {
  return cached('tpl:bench', () => {
    const wood = 0xb97a41;
    const metal = 0x28473a;
    const parts: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
    for (let i = 0; i < 3; i++) parts.push({ geo: bx(1.8, 0.045, 0.13), color: wood, matrix: T(0, 0.46, 0.14 - i * 0.15) });
    for (let i = 0; i < 2; i++) parts.push({ geo: bx(1.8, 0.13, 0.04), color: wood, matrix: TR(0, 0.66 + i * 0.17, -0.2 - i * 0.03, -0.2, 0, 0) });
    for (const x of [-0.8, 0.8]) {
      parts.push({ geo: bx(0.06, 0.46, 0.5), color: metal, matrix: T(x, 0.23, -0.02) });
      parts.push({ geo: bx(0.06, 0.5, 0.06), color: metal, matrix: TR(x, 0.7, -0.24, -0.2, 0, 0) });
      parts.push({ geo: bx(0.07, 0.05, 0.45), color: metal, matrix: T(x, 0.66, 0.0) });
    }
    return [{ geo: mergeColored(parts), mat: furnMat() }];
  });
}

/** Newspaper vending box on a pedestal (tinted per instance). */
export function newsBox(): Part[] {
  return cached('tpl:newsBox', () => {
    const geo = mergeColored([
      { geo: bx(0.1, 0.3, 0.1), color: 0x3a3a3a, matrix: T(0, 0.15, 0) },
      { geo: bx(0.46, 0.04, 0.4), color: 0x3a3a3a, matrix: T(0, 0.31, 0) },
      { geo: bx(0.5, 0.72, 0.44), color: 0xffffff, matrix: T(0, 0.69, 0) },
      { geo: bx(0.52, 0.06, 0.46), color: 0xffffff, matrix: T(0, 1.07, 0) },
      { geo: bx(0.36, 0.3, 0.02), color: 0x1d242c, matrix: T(0, 0.8, 0.225) },
      { geo: bx(0.34, 0.2, 0.01), color: 0xe8e2d0, matrix: T(0, 0.78, 0.232) },
      { geo: bx(0.1, 0.05, 0.02), color: 0xc9c9c9, matrix: T(0.14, 0.52, 0.225) },
    ]);
    return [{ geo, mat: furnMat() }];
  });
}

/** Concrete planter with bushes & flowers. 1.6 × 0.6 × 0.8 m. */
export function planter(seed = 1): Part[] {
  return cached(`tpl:planter:${seed}`, () => {
    const r = new Rng(seed * 31 + 5);
    const box = mergeColored([
      { geo: bx(1.6, 0.55, 0.8), color: 0xc9c1b3, matrix: T(0, 0.275, 0) },
      { geo: bx(1.66, 0.06, 0.86), color: 0xb3ab9d, matrix: T(0, 0.58, 0) },
      { geo: bx(1.45, 0.04, 0.65), color: 0x4b3222, matrix: T(0, 0.58, 0) },
    ]);
    const leaves: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.IcosahedronGeometry(r.range(0.24, 0.34), 0);
      leaves.push({ geo: g, color: r.pick([0x4f9a3c, 0x5fae45, 0x3f8a36]), matrix: T(-0.55 + i * 0.37, 0.72 + r.range(0, 0.08), r.range(-0.1, 0.1)) });
    }
    for (let i = 0; i < 7; i++) {
      leaves.push({ geo: new THREE.IcosahedronGeometry(0.07, 0), color: r.pick([0xff6fa8, 0xffd23f, 0xff8c42, 0xffffff, 0xb36bff]), matrix: T(r.range(-0.7, 0.7), r.range(0.82, 0.98), r.range(-0.3, 0.3)) });
    }
    return [
      { geo: box, mat: furnMatMatte() },
      { geo: mergeColored(leaves), mat: foliageMat() },
    ];
  });
}

/** Parking meter (~1.35 m). */
export function parkingMeter(): Part[] {
  return cached('tpl:meter', () => {
    const geo = mergeColored([
      { geo: cyl(0.045, 0.05, 1.05, 8), color: 0x4a4f55, matrix: T(0, 0.525, 0) },
      { geo: bx(0.2, 0.3, 0.15), color: 0x9aa4ad, matrix: T(0, 1.18, 0) },
      { geo: new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), color: 0x9aa4ad, matrix: T(0, 1.33, 0, 0, 1, 0.8, 0.75) },
      { geo: bx(0.13, 0.1, 0.02), color: 0x223344, matrix: T(0, 1.24, 0.076) },
      { geo: bx(0.05, 0.06, 0.02), color: 0x2f7d32, matrix: T(0, 1.1, 0.076) },
    ]);
    return [{ geo, mat: furnMat() }];
  });
}

/** Bike rack: 3 inverted-U hoops along X. */
export function bikeRack(): Part[] {
  return cached('tpl:bikeRack', () => {
    const steel = 0xc0c6cc;
    const parts: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.75;
      parts.push({ geo: new THREE.TorusGeometry(0.32, 0.03, 6, 12, Math.PI), color: steel, matrix: T(x, 0.62, 0, Math.PI / 2) });
      parts.push({ geo: cyl(0.03, 0.03, 0.62, 6), color: steel, matrix: T(x, 0.31, 0.32) });
      parts.push({ geo: cyl(0.03, 0.03, 0.62, 6), color: steel, matrix: T(x, 0.31, -0.32) });
    }
    return [{ geo: mergeColored(parts), mat: furnMat() }];
  });
}

/** Short bollard with a reflective band. */
export function bollard(): Part[] {
  return cached('tpl:bollard', () => {
    const geo = mergeColored([
      { geo: cyl(0.1, 0.11, 0.85, 10), color: 0x3b4046, matrix: T(0, 0.425, 0) },
      { geo: cyl(0.105, 0.105, 0.08, 10), color: 0xf2c230, matrix: T(0, 0.7, 0) },
      { geo: new THREE.SphereGeometry(0.1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), color: 0x3b4046, matrix: T(0, 0.85, 0) },
    ]);
    return [{ geo, mat: furnMat() }];
  });
}

/** Stylised street tree (trunk + chunky flat-shaded canopy). variant 0..3. ~5.5 m tall. */
export function streetTree(variant = 0): Part[] {
  return cached(`tpl:tree:${variant}`, () => {
    const r = new Rng(100 + variant * 17);
    const greens = [
      [0x4f9a3c, 0x5fae45, 0x6cbf4f],
      [0x3f8a36, 0x4c9b3f, 0x5aa843],
      [0x6aa84f, 0x86b85a, 0x9cc85e],
      [0x8fb13c, 0xa8c04a, 0xd4b13a],
    ][variant % 4];
    const trunk = mergeColored([
      { geo: cyl(0.13, 0.19, 2.9, 7), color: 0x6b4a32, matrix: T(0, 1.45, 0) },
      { geo: cyl(0.06, 0.09, 1.2, 5), color: 0x6b4a32, matrix: TR(0.35, 2.7, 0, 0, 0, -0.6) },
      { geo: cyl(0.06, 0.09, 1.1, 5), color: 0x6b4a32, matrix: TR(-0.3, 2.8, 0.1, 0, 0, 0.55) },
    ]);
    const blobs: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
    const n = 5 + (variant % 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r.range(0, 0.5);
      const rad = i === 0 ? 0 : r.range(0.7, 1.05);
      const size = i === 0 ? r.range(1.35, 1.55) : r.range(0.85, 1.15);
      blobs.push({
        geo: new THREE.IcosahedronGeometry(size, 1),
        color: greens[i % 3],
        matrix: T(Math.cos(a) * rad, (i === 0 ? 4.2 : r.range(3.4, 4.5)), Math.sin(a) * rad, 0, 1, r.range(0.8, 0.95), 1),
      });
    }
    return [
      { geo: trunk, mat: furnMatMatte() },
      { geo: jiggle(mergeColored(blobs), 0.12, variant), mat: foliageMat() },
    ];
  });
}

/** Randomly displace vertices a little (merged vertices move together) for organic blobs. */
function jiggle(g: THREE.BufferGeometry, amt: number, seed: number) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const r = new Rng(seed + 999);
  const map = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = map.get(key);
    if (!d) map.set(key, (d = [r.range(-amt, amt), r.range(-amt, amt), r.range(-amt, amt)]));
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** Tree grate (dark square) — flat, no shadow. */
export function treeGrate(): Part[] {
  return cached('tpl:treeGrate', () => [
    {
      geo: mergeColored([
        { geo: bx(1.3, 0.03, 1.3), color: 0x2c2a27, matrix: T(0, 0.015, 0) },
        { geo: bx(1.0, 0.035, 1.0), color: 0x4a3a2a, matrix: T(0, 0.018, 0) },
      ]),
      mat: furnMatMatte(),
      castShadow: false,
    },
  ]);
}

/** Additive light pool decals under lamps; opacity follows night. */
export function lightPools(game: Game, world: World, spots: { x: number; y: number; z: number; r: number }[], batch?: import('./batch').Batch) {
  if (!spots.length) return;
  const mat = cached('mat:lightPool', () => {
    const m = new THREE.MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      color: 0xffd9a0,
    });
    onFrame(game, (_g, _dt, n) => {
      m.opacity = Math.max(0, n - 0.15) * 0.42;
      m.visible = n > 0.18;
    });
    return m;
  });
  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const xfs: Xf[] = spots.map((s) => ({ x: s.x, y: s.y + 0.03, z: s.z, ry: 0, s: s.r }));
  if (batch) {
    batch.addInstances([{ geo, mat, castShadow: false }], xfs, { castShadow: false });
    return;
  }
  const [im] = placeInstances(world, [{ geo, mat, castShadow: false }], xfs, { name: 'lightPools' });
  if (im) {
    im.receiveShadow = false;
    im.renderOrder = 3;
  }
}

/**
 * Preferred placement: merge the template copies into the zone's Batch (no extra draw calls) + box colliders.
 */
export function placeBatched(
  world: World,
  batch: import('./batch').Batch,
  parts: Part[],
  xfs: Xf[],
  opts: { collider?: THREE.Vector3; colliderYOffset?: number; castShadow?: boolean; name?: string } = {},
) {
  if (!xfs.length) return;
  batch.addInstances(parts, xfs, { castShadow: opts.castShadow });
  if (opts.collider) {
    for (const x of xfs) {
      const sz = opts.collider.clone().multiplyScalar(x.s ?? 1);
      world.collider(new THREE.Vector3(x.x, x.y + (opts.colliderYOffset ?? 0) + sz.y / 2, x.z), sz, x.ry);
    }
  }
}
