import * as THREE from 'three';

/**
 * Shadow-only meshes (perf).
 *
 * Merged "shadow proxy" meshes used to be drawn in the colour pass too (with colorWrite/depthWrite off): no pixels,
 * but the GPU still transformed every vertex — ~250k wasted triangles per frame at street level.
 *
 * Three.js has no "cast shadow but don't render" flag, and layers don't help (the shadow pass tests layers against
 * the MAIN camera). But both passes cull through `object.intersectsFrustum(frustum)`, and every light shadow owns
 * its own Frustum object (`LightShadow.getFrustum()`). So a shadow-only mesh answers "no" to every frustum except
 * the registered shadow frusta.
 */
const shadowFrusta = new Set<THREE.Frustum>();

/** Let shadow-only meshes render into this light's shadow map (call once per shadow-casting light, e.g. the sun). */
export function registerShadowLight(light: THREE.Light & { shadow?: THREE.LightShadow }) {
  const f = light.shadow?.getFrustum?.();
  if (f) shadowFrusta.add(f);
}

function shadowOnlyIntersects(this: THREE.Mesh, frustum: THREE.Frustum) {
  return shadowFrusta.has(frustum) && frustum.intersectsObject(this);
}

/** Make `mesh` render only into registered shadow maps (never the colour pass). */
export function makeShadowOnly<T extends THREE.Mesh>(mesh: T): T {
  mesh.frustumCulled = true;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  (mesh as any).intersectsFrustum = shadowOnlyIntersects;
  mesh.userData.shadowOnly = true;
  mesh.userData.noMerge = true; // the StaticBatcher must not fold it into a visible batch
  return mesh;
}

const _mats: Partial<Record<THREE.Side, THREE.MeshBasicMaterial>> = {};
/** Shared material for shadow-only proxies (never drawn in colour; `side` matters for the depth pass). */
export function shadowOnlyMaterial(side: THREE.Side = THREE.FrontSide) {
  let m = _mats[side];
  if (!m) {
    m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side });
    m.name = 'shadowOnly';
    _mats[side] = m;
  }
  return m;
}
