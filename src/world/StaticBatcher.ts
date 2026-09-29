import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game, System } from '../core/Game';
import type { World } from './World';

/**
 * Draw-call reducer. A couple of seconds after the world is live, merge static meshes under `world.staticRoot`
 * that share an (equivalent) material, per spatial cell, into single meshes.
 *
 * Safety rules (other systems may animate things):
 *  - skip InstancedMesh / SkinnedMesh / morph targets / multi-material / invisible / `userData.noMerge`
 *  - skip meshes that MOVED between the snapshot at world-ready and merge time (they're animated)
 *  - emissive materials (lamps, signs, windows that glow at night) are grouped by exact material object so the
 *    systems that tweak them keep working; plain materials are grouped by a visual fingerprint so identical
 *    Kenney kit materials loaded from different GLBs merge together
 *  - groups of 1 are left alone
 */
const CELL = 80;

function isVisibleChain(o: THREE.Object3D | null): boolean {
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}

function texKey(t: THREE.Texture | null | undefined): string {
  if (!t) return '-';
  const src = (t.source?.data as any)?.currentSrc || (t.source?.data as any)?.src;
  return (src ? String(src) : t.source?.uuid ?? t.uuid) + `@${t.offset.x},${t.offset.y},${t.repeat.x},${t.repeat.y},${t.flipY ? 1 : 0}`;
}

function materialFingerprint(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  if (!(s as any).isMeshStandardMaterial || (s as any).isMeshPhysicalMaterial) return 'uuid:' + m.uuid;
  if (s.emissive && (s.emissive.r + s.emissive.g + s.emissive.b > 0.001) && s.emissiveIntensity > 0) return 'uuid:' + m.uuid;
  if (s.onBeforeCompile && s.onBeforeCompile.toString() !== THREE.Material.prototype.onBeforeCompile.toString()) return 'uuid:' + m.uuid;
  if (s.userData && Object.keys(s.userData).length) return 'uuid:' + m.uuid;
  return [
    'std',
    s.color.getHexString(),
    s.roughness.toFixed(2),
    s.metalness.toFixed(2),
    s.transparent ? 't' + s.opacity.toFixed(2) : 'o',
    s.alphaTest.toFixed(2),
    s.side,
    s.vertexColors ? 'vc' : '',
    s.flatShading ? 'flat' : '',
    texKey(s.map),
    texKey(s.normalMap),
    texKey(s.roughnessMap),
    texKey(s.aoMap),
    texKey(s.alphaMap),
    s.fog ? 'fog' : 'nofog',
    s.depthWrite ? 'dw' : 'ndw',
  ].join('|');
}

function attrSignature(g: THREE.BufferGeometry): string {
  return Object.keys(g.attributes)
    .sort()
    .map((k) => `${k}:${g.attributes[k].itemSize}`)
    .join(',');
}

export class StaticBatcher implements System {
  name = 'batcher';
  private t = 0;
  private snapshot = new Map<THREE.Mesh, THREE.Matrix4>();
  private phase: 'wait' | 'snap' | 'done' = 'wait';
  enabled = true;
  report: Record<string, number> = {};

  lateUpdate(dt: number, game: Game) {
    if (!this.enabled || this.phase === 'done' || game.state === 'boot') return;
    this.t += dt;
    if (this.phase === 'wait' && this.t > 0.5) {
      this.takeSnapshot(game);
      this.phase = 'snap';
    } else if (this.phase === 'snap' && this.t > 3) {
      this.phase = 'done';
      try {
        this.merge(game);
      } catch (err) {
        console.warn('[batcher] merge failed (continuing unbatched)', err);
      }
    }
  }

  private candidates(game: Game): THREE.Mesh[] {
    const world = game.get<World>('world');
    if (!world) return [];
    const out: THREE.Mesh[] = [];
    world.staticRoot.updateMatrixWorld(true);
    world.staticRoot.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if ((m as any).isInstancedMesh || (m as any).isSkinnedMesh || (m as any).isBatchedMesh) return;
      if (m.userData.noMerge || m.userData.furShell) return;
      if (Array.isArray(m.material)) return;
      if (m.morphTargetInfluences && m.morphTargetInfluences.length) return;
      if (!m.geometry?.attributes?.position) return;
      if (m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
      if (!isVisibleChain(m)) return;
      out.push(m);
    });
    return out;
  }

  private takeSnapshot(game: Game) {
    for (const m of this.candidates(game)) this.snapshot.set(m, m.matrixWorld.clone());
  }

  merge(game: Game) {
    const t0 = performance.now();
    const meshes = this.candidates(game).filter((m) => {
      const s = this.snapshot.get(m);
      return s && s.equals(m.matrixWorld);
    });
    const groups = new Map<string, THREE.Mesh[]>();
    const matFor = new Map<string, THREE.Material>();
    const c = new THREE.Vector3();
    for (const m of meshes) {
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      c.copy(m.geometry.boundingSphere!.center).applyMatrix4(m.matrixWorld);
      const cell = `${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
      const fp = materialFingerprint(m.material as THREE.Material);
      const key = `${cell}|${fp}|${attrSignature(m.geometry)}|${m.geometry.index ? 'i' : 'n'}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}`;
      let arr = groups.get(key);
      if (!arr) {
        groups.set(key, (arr = []));
        matFor.set(key, m.material as THREE.Material);
      }
      arr.push(m);
    }
    const out = new THREE.Group();
    out.name = 'static-batched';
    let removed = 0;
    let created = 0;
    for (const [key, arr] of groups) {
      if (arr.length < 2) continue;
      const geos: THREE.BufferGeometry[] = [];
      for (const m of arr) {
        const g = m.geometry.clone();
        // Drop attributes that aren't in the signature-safe set (morph etc. already excluded)
        g.morphAttributes = {};
        g.applyMatrix4(m.matrixWorld);
        geos.push(g);
      }
      let merged: THREE.BufferGeometry | null = null;
      try {
        merged = mergeGeometries(geos, false);
      } catch {
        merged = null;
      }
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const first = arr[0];
      const mesh = new THREE.Mesh(merged, matFor.get(key)!);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
      mesh.name = 'batch';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      out.add(mesh);
      created++;
      for (const m of arr) {
        m.visible = false; // keep the object (others may reference it), just stop drawing it
        m.userData.batched = true;
        removed++;
      }
    }
    game.scene.add(out);
    this.report = { candidates: meshes.length, groups: groups.size, merged: removed, batches: created, ms: Math.round(performance.now() - t0) };
    console.info('[batcher]', this.report);
    // The map captures the world top-down; refresh it now that everything is final
    game.events.emit('worldBatched', this.report);
  }
}
