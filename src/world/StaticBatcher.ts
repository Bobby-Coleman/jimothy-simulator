import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game, System } from '../core/Game';
import type { World } from './World';
import { makeShadowOnly, registerShadowLight } from './shadowOnly';
import { warmShaders } from './shaderWarmup';

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
 *
 * Perf pass additions:
 *  - geometry attributes are normalised to what the material actually reads (position/normal + uv if textured +
 *    color if vertexColors, all de-interleaved Float32, always indexed), so meshes that only differed by a stray
 *    `uv1`/`tangent`/`color` attribute or index-ness now merge
 *  - the material fingerprint also covers polygonOffset/normalScale/blending/… (merging a decal with its base
 *    material would z-fight)
 *  - SHADOWS: every static opaque shadow caster (merged batches AND the singletons zone builders already merged)
 *    is folded into one positions-only, shadow-only proxy per 48 m cell and stops casting itself. The shadow pass
 *    went from ~10–35 batch draws (~150–250k tris) to a handful of small proxies.
 */
const CELL = 120; // zone-aligned (offset 60) — see cellKey()
const PROXY_CELL = 48;

const IDENTITY = new THREE.Matrix4();

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
  return (
    (src ? String(src) : t.source?.uuid ?? t.uuid) +
    `@${t.offset.x},${t.offset.y},${t.repeat.x},${t.repeat.y},${t.rotation},${t.wrapS},${t.wrapT},${t.flipY ? 1 : 0},${t.channel}`
  );
}

const _defaultOBC = THREE.Material.prototype.onBeforeCompile.toString();
function hasCustomShader(m: THREE.Material) {
  return (m as any).isShaderMaterial || (m.onBeforeCompile && m.onBeforeCompile.toString() !== _defaultOBC);
}

function commonKey(s: THREE.Material) {
  return [
    s.transparent ? 't' + s.opacity.toFixed(2) : 'o',
    s.alphaTest.toFixed(2),
    s.side,
    s.shadowSide ?? '-',
    s.blending,
    s.depthWrite ? 'dw' : 'ndw',
    s.depthTest ? 'dt' : 'ndt',
    s.colorWrite ? 'cw' : 'ncw',
    s.polygonOffset ? `po${s.polygonOffsetFactor},${s.polygonOffsetUnits}` : '',
    s.toneMapped ? '' : 'ntm',
    s.premultipliedAlpha ? 'pma' : '',
    s.alphaToCoverage ? 'a2c' : '',
    s.dithering ? 'dith' : '',
    (s as any).wireframe ? 'wf' : '',
    (s as any).fog ? 'fog' : 'nofog',
    (s as any).vertexColors ? 'vc' : '',
    s.clippingPlanes ? 'clip' + s.uuid : '',
  ].join('|');
}

function materialFingerprint(m: THREE.Material): string {
  if (!m.visible) return 'uuid:' + m.uuid;
  if (hasCustomShader(m)) return 'uuid:' + m.uuid;
  if (m.userData && Object.keys(m.userData).length) return 'uuid:' + m.uuid;
  const s = m as THREE.MeshStandardMaterial;
  if ((s as any).isMeshStandardMaterial && !(s as any).isMeshPhysicalMaterial) {
    if (s.emissive && s.emissive.r + s.emissive.g + s.emissive.b > 0.001 && s.emissiveIntensity > 0) return 'uuid:' + m.uuid;
    return [
      'std',
      s.color.getHexString(),
      s.roughness.toFixed(2),
      s.metalness.toFixed(2),
      s.flatShading ? 'flat' : '',
      texKey(s.map),
      texKey(s.normalMap),
      s.normalMap ? `${s.normalScale.x.toFixed(2)},${s.normalScale.y.toFixed(2)},${s.normalMapType}` : '',
      texKey(s.roughnessMap),
      texKey(s.metalnessMap),
      texKey(s.aoMap),
      s.aoMap ? s.aoMapIntensity.toFixed(2) : '',
      texKey(s.alphaMap),
      texKey(s.bumpMap),
      texKey(s.lightMap),
      texKey(s.envMap),
      s.envMapIntensity.toFixed(2),
      commonKey(s),
    ].join('|');
  }
  const b = m as THREE.MeshBasicMaterial;
  if ((b as any).isMeshBasicMaterial || (b as any).isMeshLambertMaterial) {
    // Lambert/Basic signs & decals: emissive lamberts keep their exact material (night-glow systems tweak them)
    const e = (b as any).emissive as THREE.Color | undefined;
    if (e && e.r + e.g + e.b > 0.001) return 'uuid:' + m.uuid;
    return [b.type, b.color.getHexString(), texKey(b.map), texKey(b.alphaMap), texKey((b as any).aoMap), commonKey(b)].join('|');
  }
  return 'uuid:' + m.uuid;
}

const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap'];

/** Which attributes the (plain) material actually reads. null = keep the geometry as-is (custom shaders). */
function neededAttrs(mat: THREE.Material, g: THREE.BufferGeometry): string[] | null {
  if (hasCustomShader(mat)) return null;
  const keep = ['position', 'normal'];
  const anyTex = TEX_SLOTS.some((k) => !!(mat as any)[k]);
  if (anyTex) {
    // only uv channel 0 is normalised; exotic channels keep everything
    if (TEX_SLOTS.some((k) => (mat as any)[k] && (mat as any)[k].channel !== 0)) return null;
    keep.push('uv');
  }
  if ((mat as any).vertexColors) {
    if (!g.attributes.color) return null; // would render black unmerged; leave it alone
    keep.push('color');
  }
  return keep;
}

function signatureFor(mat: THREE.Material, g: THREE.BufferGeometry): string | null {
  const need = neededAttrs(mat, g);
  if (!need) {
    return 'raw:' + Object.keys(g.attributes)
      .sort()
      .map((k) => `${k}:${g.attributes[k].itemSize}:${(g.attributes[k] as any).normalized ? 'n' : ''}:${(g.attributes[k] as any).isInterleavedBufferAttribute ? 'i' : ''}:${(g.attributes[k].array as any).constructor.name}`)
      .join(',') + (g.index ? '|i' : '|n');
  }
  return need.map((k) => (k === 'color' ? `color${g.attributes.color.itemSize}` : k)).join(',');
}

/** Plain Float32 copy of any (interleaved / normalised / quantised) attribute. */
function toFloat32(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, itemSize = a.itemSize): THREE.BufferAttribute {
  // fast path: plain Float32 data of the right width → one memcpy (the merge runs mid-game; keep it snappy)
  if (!(a as any).isInterleavedBufferAttribute && !a.normalized && a.itemSize === itemSize && a.array instanceof Float32Array) {
    return new THREE.BufferAttribute((a.array as Float32Array).slice(0, a.count * itemSize), itemSize);
  }
  const n = a.count;
  const out = new Float32Array(n * itemSize);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < itemSize; c++) out[i * itemSize + c] = c < a.itemSize ? a.getComponent(i, c) : 0;
  }
  return new THREE.BufferAttribute(out, itemSize);
}

/** World-space clone ready for merging (normalised attributes, indexed). */
function prepForMerge(m: THREE.Mesh): THREE.BufferGeometry {
  const src = m.geometry;
  const mat = m.material as THREE.Material;
  const need = neededAttrs(mat, src);
  let g: THREE.BufferGeometry;
  if (!need) {
    g = src.clone();
  } else {
    g = new THREE.BufferGeometry();
    const n = src.attributes.position.count;
    g.setAttribute('position', toFloat32(src.attributes.position, 3));
    if (src.attributes.normal) g.setAttribute('normal', toFloat32(src.attributes.normal, 3));
    if (need.includes('uv')) g.setAttribute('uv', src.attributes.uv ? toFloat32(src.attributes.uv, 2) : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (need.includes('color')) g.setAttribute('color', toFloat32(src.attributes.color));
    if (src.index) g.setIndex(src.index.clone());
    else {
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
  }
  g.morphAttributes = {};
  g.applyMatrix4(m.matrixWorld);
  return g;
}

/**
 * Split a (positions-only) geometry into pieces by the XZ cell of each triangle's centroid (world space).
 * Returns cell key → indexed geometry with only the vertices that piece uses.
 */
function splitByCell(g: THREE.BufferGeometry, matrix: THREE.Matrix4, cell: number): Map<string, THREE.BufferGeometry> {
  const pos = g.attributes.position;
  const n = pos.count;
  // world-space positions (typed-array fast paths: this runs mid-game on ~250k triangles)
  let wp: Float32Array;
  const plain = !(pos as any).isInterleavedBufferAttribute && !pos.normalized && pos.itemSize === 3 && pos.array instanceof Float32Array;
  if (plain && matrix.equals(IDENTITY)) wp = pos.array as Float32Array;
  else if (plain) {
    wp = (pos.array as Float32Array).slice(0, n * 3);
    new THREE.BufferAttribute(wp, 3).applyMatrix4(matrix);
  } else {
    wp = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      wp[i * 3] = v.x;
      wp[i * 3 + 1] = v.y;
      wp[i * 3 + 2] = v.z;
    }
  }
  const idx = g.index;
  const ia = idx ? (idx.array as ArrayLike<number>) : null;
  const triCount = (idx ? idx.count : n) / 3;
  const vi = ia ? (k: number) => ia[k] : (k: number) => k;
  // numeric cell keys (a template string per triangle was most of the cost)
  const buckets = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const a = vi(t * 3), b = vi(t * 3 + 1), c = vi(t * 3 + 2);
    const cx = (wp[a * 3] + wp[b * 3] + wp[c * 3]) / 3;
    const cz = (wp[a * 3 + 2] + wp[b * 3 + 2] + wp[c * 3 + 2]) / 3;
    const key = (Math.floor(cx / cell) + 512) * 1024 + (Math.floor(cz / cell) + 512);
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, (arr = []));
    arr.push(t);
  }
  const remap = new Int32Array(n).fill(-1);
  const out = new Map<string, THREE.BufferGeometry>();
  for (const [nkey, tris] of buckets) {
    const key = `${Math.floor(nkey / 1024) - 512},${(nkey % 1024) - 512}`;
    const verts: number[] = [];
    const inds: number[] = [];
    const touched: number[] = [];
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const s = vi(t * 3 + k);
        if (remap[s] < 0) {
          remap[s] = verts.length / 3;
          verts.push(wp[s * 3], wp[s * 3 + 1], wp[s * 3 + 2]);
          touched.push(s);
        }
        inds.push(remap[s]);
      }
    }
    for (const s of touched) remap[s] = -1;
    const piece = new THREE.BufferGeometry();
    piece.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    piece.setIndex(new THREE.BufferAttribute(new Uint32Array(inds), 1));
    out.set(key, piece);
  }
  return out;
}

/** Depth-pass side three.js would use for this material (PCF shadows). */
function depthSide(mat: THREE.Material): THREE.Side {
  if (mat.shadowSide != null) return mat.shadowSide;
  return mat.side === THREE.FrontSide ? THREE.BackSide : mat.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide;
}

/** Can this mesh's shadow be drawn by a positions-only proxy? (opaque, no alpha cut-outs, no custom depth) */
function proxyable(m: THREE.Mesh): boolean {
  if (!m.castShadow || Array.isArray(m.material)) return false;
  if (m.customDepthMaterial || m.customDistanceMaterial) return false;
  const mat = m.material as THREE.Material & { alphaMap?: THREE.Texture | null; map?: THREE.Texture | null };
  if (!mat.visible || mat.transparent || mat.alphaTest > 0 || mat.alphaMap) return false;
  if (hasCustomShader(mat)) return false; // might displace vertices in the depth pass too
  if (m.geometry.drawRange.count !== Infinity || m.geometry.drawRange.start !== 0) return false;
  return true;
}

export class StaticBatcher implements System {
  name = 'batcher';
  private t = 0;
  private snapshot = new Map<THREE.Mesh, THREE.Matrix4>();
  private phase: 'wait' | 'snap' | 'done' = 'wait';
  enabled = true;
  report: Record<string, number> = {};

  init(game: Game) {
    // Shadow-only proxies (ours and the central builder's) render into the sun's shadow map only.
    const sun = game.get<any>('environment')?.sun as THREE.DirectionalLight | undefined;
    if (sun) registerShadowLight(sun);
  }

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
      if (m.userData.noMerge || m.userData.furShell || m.userData.shadowOnly) return;
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
    const world = game.get<World>('world')!;
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
      const cell = `${Math.floor((c.x + 60) / CELL)},${Math.floor((c.z + 60) / CELL)}`;
      const mat = m.material as THREE.Material;
      const sig = signatureFor(mat, m.geometry);
      if (!sig) continue;
      // shadow casting is handled by proxies for opaque materials, so it no longer splits those groups
      const cast = m.castShadow && !proxyable(m) ? 1 : 0;
      const key = `${cell}|${materialFingerprint(mat)}|${sig}|${cast}${m.receiveShadow ? 1 : 0}|${m.renderOrder}`;
      let arr = groups.get(key);
      if (!arr) {
        groups.set(key, (arr = []));
        matFor.set(key, mat);
      }
      arr.push(m);
    }
    const out = new THREE.Group();
    out.name = 'static-batched';
    let removed = 0;
    let created = 0;
    // shadow proxy buckets: cell|depthSide → world-space position geometries
    const proxyGeos = new Map<string, { side: THREE.Side; geos: THREE.BufferGeometry[] }>();
    const addProxy = (m: THREE.Mesh) => {
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      c.copy(m.geometry.boundingSphere!.center).applyMatrix4(m.matrixWorld);
      const side = depthSide(m.material as THREE.Material);
      const key = `${Math.floor(c.x / PROXY_CELL)},${Math.floor(c.z / PROXY_CELL)}|${side}`;
      let b = proxyGeos.get(key);
      if (!b) proxyGeos.set(key, (b = { side, geos: [] }));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', toFloat32(m.geometry.attributes.position, 3));
      if (m.geometry.index) g.setIndex(m.geometry.index.clone());
      else {
        const n = m.geometry.attributes.position.count;
        const idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      g.applyMatrix4(m.matrixWorld);
      b.geos.push(g);
    };
    let proxied = 0;
    // Zone builders' own shadow proxies (central lib/batch.ts: one per 120 m chunk, up to ~110k tris each) are
    // re-cut into our 48 m cells, so the shadow pass only draws the triangles near Jimothy.
    let recut = 0;
    const tRecut0 = performance.now();
    world.staticRoot.traverse((o) => {
      const p = o as THREE.Mesh;
      if (!p.isMesh || !p.userData.shadowOnly || !p.visible || Array.isArray(p.material)) return;
      const g = p.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      if (tris < 3000 || g.boundingSphere!.radius < PROXY_CELL * 0.75) return;
      const side = depthSide(p.material as THREE.Material);
      for (const [cell, piece] of splitByCell(g, p.matrixWorld, PROXY_CELL)) {
        const key = cell + '|' + side;
        let b = proxyGeos.get(key);
        if (!b) proxyGeos.set(key, (b = { side, geos: [] }));
        b.geos.push(piece);
      }
      p.visible = false;
      recut++;
    });
    const tRecut = performance.now() - tRecut0;
    for (const [key, arr] of groups) {
      if (arr.length < 2) {
        // Singletons stay as they are, but their shadow can still move into a proxy
        const m = arr[0];
        if (proxyable(m)) {
          addProxy(m);
          m.castShadow = false;
          proxied++;
        }
        continue;
      }
      const geos: THREE.BufferGeometry[] = [];
      for (const m of arr) geos.push(prepForMerge(m));
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
      const shadowByProxy = arr.some((m) => m.castShadow) && proxyable(first);
      mesh.castShadow = first.castShadow && !shadowByProxy;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
      mesh.name = 'batch';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      out.add(mesh);
      created++;
      for (const m of arr) {
        if (shadowByProxy && m.castShadow) {
          addProxy(m);
          proxied++;
        }
        m.visible = false; // keep the object (others may reference it), just stop drawing it
        m.userData.batched = true;
        removed++;
      }
    }
    const tProxy0 = performance.now();
    // Build the shadow-only proxies
    let proxies = 0;
    const proxyMats = new Map<THREE.Side, THREE.MeshBasicMaterial>();
    for (const [key, b] of proxyGeos) {
      let merged: THREE.BufferGeometry | null = null;
      try {
        merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
      } catch {
        merged = null;
      }
      if (merged !== b.geos[0]) for (const g of b.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      let mat = proxyMats.get(b.side);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        mat.shadowSide = b.side; // the depth pass uses exactly the side the original materials would have used
        mat.name = 'shadowProxy';
        proxyMats.set(b.side, mat);
      }
      const proxy = makeShadowOnly(new THREE.Mesh(merged, mat));
      proxy.name = 'shadowProxy:' + key;
      proxy.matrixAutoUpdate = false;
      out.add(proxy);
      proxies++;
    }
    const tProxy = performance.now() - tProxy0;
    game.scene.add(out);
    this.report = {
      candidates: meshes.length,
      groups: groups.size,
      merged: removed,
      batches: created,
      shadowProxied: proxied,
      shadowProxies: proxies,
      proxiesRecut: recut,
      ms: Math.round(performance.now() - t0),
      msRecut: Math.round(tRecut),
      msProxies: Math.round(tProxy),
    };
    console.info('[batcher]', this.report);
    // The map captures the world top-down; refresh it now that everything is final
    game.events.emit('worldBatched', this.report);
    // …and compile every remaining shader in the background so new areas don't hitch when they come into view
    warmShaders(game);
  }
}
