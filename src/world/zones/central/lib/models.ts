import * as THREE from 'three';
import type { Game } from '../../../../core/Game';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normalise } from './batch';
import { cached } from './textures';

export interface MergedModel {
  /** One geometry per material (Kenney kits usually have exactly one 'colormap' material). */
  parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[];
  size: THREE.Vector3;
  min: THREE.Vector3;
}

/**
 * Load a GLB and merge all its meshes per material (node transforms baked in), so it can be instanced
 * with one draw call per material. Returns null if the file is missing.
 */
export function loadMerged(game: Game, path: string): Promise<MergedModel | null> {
  return cached(`merged:${path}`, async () => {
    const root = await game.assets.tryModel(path);
    if (!root) return null;
    root.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.length !== 1) return;
      const g = normalise(m.geometry.clone().applyMatrix4(m.matrixWorld));
      let arr = byMat.get(mats[0]);
      if (!arr) byMat.set(mats[0], (arr = []));
      arr.push(g);
    });
    const parts: MergedModel['parts'] = [];
    for (const [mat, geos] of byMat) {
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geo) parts.push({ geo, mat });
    }
    if (!parts.length) return null;
    const box = new THREE.Box3();
    for (const p of parts) {
      p.geo.computeBoundingBox();
      box.union(p.geo.boundingBox!);
    }
    return { parts, size: box.getSize(new THREE.Vector3()), min: box.min.clone() };
  });
}
