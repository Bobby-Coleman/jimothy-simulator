/** Procedural low-poly trees & shrubs for the north zones (instanced). */
import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World } from '../../World';
import { Batch, GEO, trs, instances, rng, type MatSet } from './kit';

export type TreeKind = 'maple' | 'plum' | 'cherry' | 'fir' | 'cedar' | 'birch' | 'shrub' | 'rhodo';

interface TreeSpec {
  trunkH: number;
  trunkR: number;
  bark: number;
  leaf: number[];
}

const SPECS: Record<TreeKind, TreeSpec> = {
  maple: { trunkH: 3.2, trunkR: 0.22, bark: 0x6b5140, leaf: [0x5f9e3f, 0x76b043, 0x4e8a36, 0x88bf4e] },
  plum: { trunkH: 2.4, trunkR: 0.17, bark: 0x4a3530, leaf: [0x7b2f4b, 0x8e3a58, 0x6a2742, 0x9c4a63] },
  cherry: { trunkH: 2.3, trunkR: 0.2, bark: 0x4d3a33, leaf: [0xf7b2cf, 0xffc9de, 0xf28db8, 0xffe0ec, 0xfad0e1] },
  fir: { trunkH: 2.0, trunkR: 0.28, bark: 0x5a4332, leaf: [0x2f5a3a, 0x376844, 0x284f33] },
  cedar: { trunkH: 1.6, trunkR: 0.3, bark: 0x6a4a36, leaf: [0x3d6b3f, 0x4a7a45, 0x345e37] },
  birch: { trunkH: 3.6, trunkR: 0.16, bark: 0xe9e4da, leaf: [0x8cc152, 0x9fd05f, 0x7db147] },
  shrub: { trunkH: 0.05, trunkR: 0.05, bark: 0x5a4332, leaf: [0x4f8a3c, 0x5f9a45, 0x467d35] },
  rhodo: { trunkH: 0.05, trunkR: 0.05, bark: 0x5a4332, leaf: [0x3f7a3a, 0x4a8440, 0xe0568f, 0xf07ab0] },
};

/** Canopy height (top) above ground for a unit-scale tree of this kind — used for colliders/POIs. */
export const TREE_TOP: Record<TreeKind, number> = { maple: 7.2, plum: 5.2, cherry: 5.6, fir: 13, cedar: 10.5, birch: 8.5, shrub: 1.2, rhodo: 1.6 };

const templateCache = new Map<string, THREE.Group>();

/** Build (cached) a tree template: two meshes (bark + leaves) with vertex colours. */
export function treeTemplate(kind: TreeKind, variant: number, mats: MatSet): THREE.Group {
  const key = `${kind}:${variant}`;
  const hit = templateCache.get(key);
  if (hit) return hit;
  const r = rng(1000 + variant * 97 + kind.length * 13);
  const spec = SPECS[kind];
  const bark = new Batch(1e9);
  const leaves = new Batch(1e9);
  const leafCol = (i: number) => spec.leaf[i % spec.leaf.length];
  const shadeLeaf = (base: number) => {
    const c0 = new THREE.Color(base);
    return (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => {
      c.copy(c0).multiplyScalar(0.78 + 0.3 * Math.max(0, n.y) + (Math.sin(p.x * 13.1 + p.z * 7.7 + p.y * 5.3) * 0.06));
    };
  };
  const trunk = (h: number, rad: number) => {
    bark.add('bark', GEO.cyl8, trs(0, h / 2, 0, rad * 2, h, rad * 2), spec.bark);
  };
  switch (kind) {
    case 'maple':
    case 'birch': {
      const h = spec.trunkH;
      trunk(h + 0.8, spec.trunkR);
      const n = 5 + Math.floor(r() * 3);
      const cy = h + 1.9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r();
        const d = i === 0 ? 0 : 1.1 + r() * 0.7;
        const s = (i === 0 ? 3.4 : 2.2 + r() * 0.9) * (kind === 'birch' ? 0.8 : 1);
        leaves.add('leaves', GEO.ico, trs(Math.cos(a) * d, cy + (i === 0 ? 0.6 : r() * 1.4 - 0.5), Math.sin(a) * d, s, s * 0.85, s, r() * 6), 0xffffff, {
          shade: shadeLeaf(leafCol(i)),
        });
      }
      if (kind === 'birch') {
        // dark bark marks
        for (let i = 0; i < 6; i++) bark.add('bark', GEO.box, trs(0, 0.6 + i * 0.6, 0, spec.trunkR * 2.05, 0.08, spec.trunkR * 1.2, r() * 3), 0x333333);
      }
      break;
    }
    case 'plum': {
      const h = spec.trunkH;
      trunk(h + 0.4, spec.trunkR);
      const n = 5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r();
        const d = i === 0 ? 0 : 0.9 + r() * 0.5;
        const s = i === 0 ? 2.8 : 1.8 + r() * 0.7;
        leaves.add('leaves', GEO.ico, trs(Math.cos(a) * d, h + 1.2 + r() * 0.8, Math.sin(a) * d, s, s * 0.9, s, r() * 6), 0xffffff, { shade: shadeLeaf(leafCol(i)) });
      }
      break;
    }
    case 'cherry': {
      const h = spec.trunkH;
      trunk(h, spec.trunkR);
      // spreading limbs
      const limbs = 4;
      const tips: THREE.Vector3[] = [];
      for (let i = 0; i < limbs; i++) {
        const a = (i / limbs) * Math.PI * 2 + r() * 0.8;
        const len = 2.0 + r() * 0.6;
        const tilt = 0.75 + r() * 0.25;
        const dx = Math.cos(a) * Math.sin(tilt) * len,
          dz = Math.sin(a) * Math.sin(tilt) * len,
          dy = Math.cos(tilt) * len;
        const mid = new THREE.Vector3(dx / 2, h + dy / 2, dz / 2);
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, h, 0), new THREE.Vector3(dx, h + dy, dz), new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
        const mm = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(spec.trunkR * 1.3, len, spec.trunkR * 1.3));
        bark.add('bark', GEO.cyl6, mm, spec.bark);
        tips.push(new THREE.Vector3(dx, h + dy, dz));
      }
      // fluffy blossom clouds at limb tips + a crown
      let i = 0;
      for (const t of tips) {
        for (let k = 0; k < 2; k++) {
          const s = 2.1 + r() * 0.8;
          leaves.add('leaves', GEO.ico, trs(t.x + (r() - 0.5) * 0.9, t.y + 0.3 + r() * 0.5, t.z + (r() - 0.5) * 0.9, s, s * 0.72, s, r() * 6), 0xffffff, {
            shade: shadeLeaf(leafCol(i++)),
          });
        }
      }
      leaves.add('leaves', GEO.ico, trs(0, h + 2.3, 0, 3.4, 2.2, 3.4, r() * 6), 0xffffff, { shade: shadeLeaf(leafCol(1)) });
      break;
    }
    case 'fir':
    case 'cedar': {
      const tall = kind === 'fir' ? 13 : 10.5;
      trunk(spec.trunkH + 1.5, spec.trunkR);
      const tiers = kind === 'fir' ? 6 : 5;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const rad = (kind === 'fir' ? 3.0 : 2.6) * (1 - t * 0.78);
        const y0 = spec.trunkH + t * (tall - spec.trunkH - 1.2);
        const hgt = (tall - spec.trunkH) / tiers + 1.4;
        leaves.add('leaves', GEO.cone, trs(0, y0 + hgt / 2, 0, rad * 2, hgt, rad * 2, r() * 6), 0xffffff, { shade: shadeLeaf(leafCol(i)) });
      }
      break;
    }
    case 'shrub':
    case 'rhodo': {
      const n = 4;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r();
        const d = i === 0 ? 0 : 0.35 + r() * 0.2;
        const s = i === 0 ? 1.3 : 0.9 + r() * 0.3;
        leaves.add('leaves', GEO.ico, trs(Math.cos(a) * d, s * 0.38 + r() * 0.2, Math.sin(a) * d, s, s * 0.8, s, r() * 6), 0xffffff, { shade: shadeLeaf(spec.leaf[i % 2]) });
      }
      if (kind === 'rhodo') {
        // blossoms
        for (let i = 0; i < 9; i++) {
          const a = r() * Math.PI * 2;
          leaves.add('leaves', GEO.ico0, trs(Math.cos(a) * 0.6, 0.55 + r() * 0.5, Math.sin(a) * 0.6, 0.28, 0.28, 0.28, r() * 6), 0xffffff, { shade: shadeLeaf(spec.leaf[2 + (i % 2)]) });
        }
      }
      break;
    }
  }
  // one mesh per template (bark + leaves share the flat-shaded vertex-colour material) = 1 draw call per variant
  for (const [k, a] of bark.accs) leaves.accs.set('bark:' + k, a);
  const g = new THREE.Group();
  g.add(leaves.buildSingle(mats.leaves));
  templateCache.set(key, g);
  return g;
}

/**
 * Plant instanced trees. Each entry: [x, z, y?] (y defaults to the terrain).
 * Adds a climbable trunk collider per tree (except shrubs).
 */
export function plantTrees(
  game: Game,
  world: World,
  mats: MatSet,
  kind: TreeKind,
  list: ([number, number] | [number, number, number])[],
  opts: { seed?: number; scale?: [number, number]; collider?: boolean; variants?: number; castShadow?: boolean } = {},
) {
  if (!list.length) return;
  const r = rng(opts.seed ?? 7);
  const variants = opts.variants ?? 2;
  const [s0, s1] = opts.scale ?? [0.85, 1.15];
  const buckets: [number, number, number, number, number][][] = [];
  for (let v = 0; v < variants; v++) buckets.push([]);
  for (const e of list) {
    const x = e[0],
      z = e[1];
    const y = e.length > 2 ? (e as [number, number, number])[2] : world.heightAt(x, z);
    const sc = s0 + r() * (s1 - s0);
    const v = Math.floor(r() * variants);
    buckets[v].push([x, y - 0.05, z, r() * Math.PI * 2, sc]);
    if (opts.collider !== false && kind !== 'shrub' && kind !== 'rhodo') {
      const spec = SPECS[kind];
      const h = (spec.trunkH + 0.6) * sc;
      world.collider(new THREE.Vector3(x, y + h / 2, z), new THREE.Vector3(spec.trunkR * 2.4 * sc, h, spec.trunkR * 2.4 * sc));
    }
  }
  buckets.forEach((b, v) => {
    if (b.length) {
      const g = instances(world, treeTemplate(kind, v, mats), b, { castShadow: opts.castShadow });
      if (opts.castShadow === false) g.traverse((o) => (o.userData.noMerge = true));
    }
  });
}

/**
 * Forest on the out-of-bounds hillside north of the map (and the NW/NE corner berms) so the rising terrain
 * reads as wooded hills instead of a bare green wall. No colliders (it's beyond the invisible wall), no shadows.
 */
export function plantBackdrop(game: Game, world: World, mats: MatSet) {
  const r = rng(2026);
  const firs: [number, number][] = [];
  const cedars: [number, number][] = [];
  const add = (x: number, z: number) => (r() < 0.62 ? firs : cedars).push([x + (r() - 0.5) * 5, z + (r() - 0.5) * 5]);
  for (let z = -201; z > -262; z -= 7.5) for (let x = -262; x <= 262; x += 7.5) add(x, z);
  for (const s of [-1, 1])
    for (let z = -60; z > -201; z -= 8) for (let x = 203; x <= 262; x += 8) add(s * x, z);
  plantTrees(game, world, mats, 'fir', firs, { seed: 301, scale: [1.0, 1.8], collider: false, castShadow: false });
  plantTrees(game, world, mats, 'cedar', cedars, { seed: 302, scale: [1.0, 1.7], collider: false, castShadow: false });
}
