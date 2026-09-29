import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../../core/Game';
import { RAPIER, G, groups } from '../../../core/Physics';
import { assetUrl } from '../../../core/Assets';
import type { World } from '../../World';
import { southState, type Glow } from './state';

/**
 * Shared building kit for the west/south zones (park, locks, waterfront, stadium).
 *
 *  - Batch: collects lots of static pieces (boxes, cylinders, blobs, custom geometry), bakes them into
 *    world space with vertex colours and world-space UVs, and merges them per material + 40 m cell
 *    → a handful of draw calls per zone.
 *  - Collider helpers (box / rotated box / cylinder / convex hull).
 *  - Canvas-texture signs (parody names, neon), fonts.
 *  - Kenney model helpers (load, scale, instance, recolour).
 */

export type V3 = [number, number, number];
export type MatKey =
  | 'flat'
  | 'glossy'
  | 'metal'
  | 'rust'
  | 'concrete'
  | 'planks'
  | 'brick'
  | 'paving'
  | 'stone'
  | 'sand'
  | 'dirt'
  | 'gravel'
  | 'siding'
  | 'shingles'
  | 'grass'
  | 'window';

const TEX_DIR: Partial<Record<MatKey, string>> = {
  planks: 'planks',
  brick: 'brick',
  paving: 'paving',
  stone: 'mossy_stone',
  sand: 'sand',
  dirt: 'dirt',
  gravel: 'gravel',
  siding: 'siding',
  shingles: 'shingles',
};
/** World-space tile size (m) of each textured material. */
const TILE: Partial<Record<MatKey, number>> = {
  planks: 2.2,
  brick: 2.6,
  paving: 3.2,
  stone: 2.8,
  sand: 3.5,
  dirt: 4,
  gravel: 3.2,
  siding: 2.4,
  shingles: 2.4,
  rust: 3.5,
  concrete: 4,
  grass: 5,
};

const Y = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();

export const rng = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
};

// ------------------------------------------------------------------ canvas helpers

export function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export const FONT_TITLE = '"Luckiest Guy", "Arial Black", Impact, sans-serif';
export const FONT_ROUND = '"Lilita One", "Arial Black", Impact, sans-serif';
export const FONT_BODY = 'Nunito, "Segoe UI", Arial, sans-serif';

/** Draw text centred at (x, y), shrinking the font until it fits maxW. Returns the font px used. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  px: number,
  family = FONT_TITLE,
  opts: { weight?: string; fill?: string; stroke?: string; strokeW?: number; glow?: string; glowBlur?: number; align?: CanvasTextAlign } = {},
) {
  let size = px;
  const w = opts.weight ? opts.weight + ' ' : '';
  ctx.font = `${w}${size}px ${family}`;
  while (ctx.measureText(text).width > maxW && size > 8) {
    size -= 2;
    ctx.font = `${w}${size}px ${family}`;
  }
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  if (opts.glow) {
    ctx.save();
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = opts.glowBlur ?? size * 0.35;
    ctx.fillStyle = opts.fill ?? '#fff';
    ctx.fillText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  if (opts.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = opts.strokeW ?? size * 0.14;
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.fill ?? '#fff';
  ctx.fillText(text, x, y);
  return size;
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

/** Grey grime/noise texture used to break up flat colours (rust, concrete). */
function noiseTexture(kind: 'rust' | 'concrete' | 'grass'): THREE.CanvasTexture {
  const S = 256;
  const r = rng(kind === 'rust' ? 7 : kind === 'grass' ? 13 : 3);
  return canvasTex(
    S,
    S,
    (ctx) => {
      const img = ctx.createImageData(S, S);
      for (let i = 0; i < S * S; i++) {
        const x = i % S;
        const y = (i / S) | 0;
        let v: number;
        if (kind === 'rust') {
          // vertical streaks + blotches
          const streak = Math.sin(x * 0.21 + Math.sin(x * 0.05) * 3) * 0.5 + 0.5;
          v = 0.78 + streak * 0.1 + (r() - 0.5) * 0.18 + Math.sin(x * 0.08 + y * 0.03) * 0.05;
        } else if (kind === 'grass') {
          v = 0.86 + (r() - 0.5) * 0.22 + Math.sin(x * 0.3) * Math.sin(y * 0.27) * 0.04;
        } else {
          v = 0.9 + (r() - 0.5) * 0.12 + Math.sin(x * 0.06 + y * 0.05) * 0.03;
        }
        const c = Math.max(0, Math.min(255, v * 255));
        img.data[i * 4] = c;
        img.data[i * 4 + 1] = c;
        img.data[i * 4 + 2] = c;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (kind === 'rust') {
        // darker drips
        for (let k = 0; k < 60; k++) {
          ctx.fillStyle = `rgba(40,20,10,${0.08 + r() * 0.12})`;
          const x = r() * S;
          ctx.fillRect(x, r() * S * 0.5, 1 + r() * 3, 20 + r() * 90);
        }
      } else if (kind === 'concrete') {
        ctx.strokeStyle = 'rgba(0,0,0,0.10)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, S, S);
      }
    },
    true,
  );
}

// ------------------------------------------------------------------ geometry prep

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const cylCache = new Map<string, THREE.BufferGeometry>();
export function cylGeo(topRatio = 1, seg = 12, open = false): THREE.BufferGeometry {
  const k = `${topRatio}|${seg}|${open}`;
  let g = cylCache.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(topRatio, 1, 1, seg, 1, open);
    cylCache.set(k, g);
  }
  return g;
}
const icoCache = new Map<number, THREE.BufferGeometry>();
function icoGeo(detail: number) {
  let g = icoCache.get(detail);
  if (!g) {
    g = new THREE.IcosahedronGeometry(1, detail);
    icoCache.set(detail, g);
  }
  return g;
}
const sphCache = new Map<string, THREE.BufferGeometry>();
function sphereGeo(w: number, h: number) {
  const k = `${w}|${h}`;
  let g = sphCache.get(k);
  if (!g) {
    g = new THREE.SphereGeometry(1, w, h);
    sphCache.set(k, g);
  }
  return g;
}

/**
 * Clone + transform a geometry to world space, keep only position/normal/uv/color, add vertex colours,
 * compute world-space (tri-planar) UVs for textured materials and make sure it's indexed.
 */
function prepGeometry(src: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color, tile: number, uvRot: boolean, keepColors = false) {
  const g = src.clone();
  g.applyMatrix4(m);
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(keepColors && name === 'color')) g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const n = pos.count;
  if (keepColors && g.attributes.color) {
    const src = g.attributes.color as THREE.BufferAttribute;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = src.getX(i) * color.r;
      col[i * 3 + 1] = src.getY(i) * color.g;
      col[i * 3 + 2] = src.getZ(i) * color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  } else {
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = color.r;
      col[i * 3 + 1] = color.g;
      col[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  if (tile > 0) {
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const ax = Math.abs(nor.getX(i));
      const ay = Math.abs(nor.getY(i));
      const az = Math.abs(nor.getZ(i));
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let u: number;
      let v: number;
      if (ay >= ax && ay >= az) {
        u = x;
        v = z;
      } else if (ax >= az) {
        u = z;
        v = y;
      } else {
        u = x;
        v = y;
      }
      if (uvRot) {
        const t = u;
        u = v;
        v = t;
      }
      uv[i * 2] = u / tile;
      uv[i * 2 + 1] = v / tile;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  } else if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!g.index) {
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return g;
}

/**
 * Bake several primitive parts into ONE vertex-coloured geometry (for props / instanced decor).
 * rot is an Euler (YXZ) in radians.
 */
export function bake(
  parts: { geo: THREE.BufferGeometry; pos?: V3; rot?: V3; scale?: V3 | number; color: THREE.ColorRepresentation; keepColors?: boolean }[],
): THREE.BufferGeometry {
  const gs = parts.map((p) => {
    const sc = p.scale ?? 1;
    _q.setFromEuler(_e.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0, 'YXZ'));
    if (typeof sc === 'number') _s.setScalar(sc);
    else _s.set(sc[0], sc[1], sc[2]);
    _m.compose(_p.set(p.pos?.[0] ?? 0, p.pos?.[1] ?? 0, p.pos?.[2] ?? 0), _q, _s);
    return prepGeometry(p.geo, _m, _c.set(p.color), 0, false, !!p.keepColors);
  });
  const merged = mergeGeometries(gs, false)!;
  for (const g of gs) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

export const GEO = {
  box: UNIT_BOX,
  cyl: (top = 1, seg = 12) => cylGeo(top, seg),
  ico: (detail = 1) => icoGeo(detail),
  sphere: (w = 14, h = 10) => sphereGeo(w, h),
};

// ------------------------------------------------------------------ kit

export interface PieceOpts {
  mat?: MatKey;
  shadow?: boolean;
  uvRot?: boolean;
}
export interface BoxOpts extends PieceOpts {
  rotY?: number;
  collide?: boolean;
}

export class Kit {
  readonly mats = new Map<MatKey, THREE.MeshStandardMaterial>();
  private models = new Map<string, Promise<THREE.Object3D | null>>();
  private atlasItems: { canvas: HTMLCanvasElement; geos: THREE.BufferGeometry[] }[] = [];
  /** Everything static the west/south zones build lives under this group (child of world.staticRoot). */
  readonly root = new THREE.Group();
  constructor(
    readonly game: Game,
    readonly world: World,
  ) {
    this.root.name = 'south';
    world.staticRoot.add(this.root);
  }

  get state() {
    return southState(this.game);
  }

  async load() {
    const jobs: Promise<unknown>[] = [this.loadFonts()];
    for (const [key, dir] of Object.entries(TEX_DIR) as [MatKey, string][]) {
      jobs.push(
        Promise.all([
          this.game.assets.tryTexture(`assets/textures/${dir}/color.jpg`),
          this.game.assets.tryTexture(`assets/textures/${dir}/normal.jpg`, { srgb: false }),
        ]).then(([map, normal]) => {
          const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: key === 'planks' ? 0.8 : 0.9, map: map ?? null });
          if (normal) {
            m.normalMap = normal;
            m.normalScale.set(0.7, 0.7);
          }
          // The photo textures are fairly dark/dull: lift them toward the sunny Goat-Sim look.
          const lift: Partial<Record<MatKey, [number, number, number]>> = {
            planks: [1.75, 1.5, 1.25],
            gravel: [1.15, 1.1, 1.0],
            paving: [1.1, 1.1, 1.08],
            brick: [1.15, 1.05, 1.0],
            stone: [1.2, 1.2, 1.15],
            sand: [1.1, 1.05, 0.98],
            siding: [1.05, 1.05, 1.05],
          };
          const l = lift[key];
          if (l) m.color.setRGB(l[0], l[1], l[2]);
          m.name = `south:${key}`;
          this.mats.set(key, m);
        }),
      );
    }
    await Promise.all(jobs);
    const rust = noiseTexture('rust');
    const concrete = noiseTexture('concrete');
    const grass = noiseTexture('grass');
    this.mats.set('flat', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, name: 'south:flat' }));
    this.mats.set('glossy', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, name: 'south:glossy' }));
    this.mats.set('metal', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6, name: 'south:metal' }));
    this.mats.set('rust', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.15, map: rust, name: 'south:rust' }));
    this.mats.set('concrete', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: concrete, name: 'south:concrete' }));
    this.mats.set('grass', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: grass, name: 'south:grass' }));
    // windows: vertex colour = glass tint by day, warm emissive glow at night
    const win = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.1, emissive: 0xffc56e, emissiveIntensity: 0.02, name: 'south:window' });
    this.mats.set('window', win);
    this.glow(win, 0.02, 1.25);
  }

  private async loadFonts() {
    if (typeof FontFace === 'undefined') return;
    const fonts: [string, string][] = [
      ['Luckiest Guy', 'assets/fonts/LuckiestGuy-Regular.ttf'],
      ['Lilita One', 'assets/fonts/LilitaOne-Regular.ttf'],
      ['Nunito', 'assets/fonts/Nunito-VariableFont_wght.ttf'],
    ];
    await Promise.all(
      fonts.map(async ([name, path]) => {
        try {
          const f = new FontFace(name, `url(${assetUrl(path)})`);
          await f.load();
          (document.fonts as any).add(f);
        } catch {
          /* fall back to system fonts */
        }
      }),
    );
  }

  mat(key: MatKey): THREE.MeshStandardMaterial {
    return this.mats.get(key) ?? this.mats.get('flat')!;
  }

  // ---------------------------------------------------------------- colliders
  collider(c: V3, size: V3, rotY = 0) {
    return this.world.collider(new THREE.Vector3(c[0], c[1], c[2]), new THREE.Vector3(size[0], size[1], size[2]), rotY);
  }

  colliderQ(c: V3, size: V3, q: THREE.Quaternion, friction = 0.8) {
    return this.game.physics.staticBox(new THREE.Vector3(c[0], c[1], c[2]), new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2), q, friction);
  }

  cylinderCollider(c: V3, r: number, h: number) {
    const cd = RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(c[0], c[1], c[2]).setFriction(0.8).setCollisionGroups(groups(G.WORLD));
    return this.game.physics.staticCollider(cd);
  }

  ballCollider(c: V3, r: number) {
    const cd = RAPIER.ColliderDesc.ball(r).setTranslation(c[0], c[1], c[2]).setFriction(0.8).setCollisionGroups(groups(G.WORLD));
    return this.game.physics.staticCollider(cd);
  }

  /** Static convex hull from world-space points. */
  hullCollider(points: number[]) {
    let cx = 0,
      cy = 0,
      cz = 0;
    const n = points.length / 3;
    for (let i = 0; i < n; i++) {
      cx += points[i * 3];
      cy += points[i * 3 + 1];
      cz += points[i * 3 + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    const local = new Float32Array(points.length);
    for (let i = 0; i < n; i++) {
      local[i * 3] = points[i * 3] - cx;
      local[i * 3 + 1] = points[i * 3 + 1] - cy;
      local[i * 3 + 2] = points[i * 3 + 2] - cz;
    }
    const cd = RAPIER.ColliderDesc.convexHull(local);
    if (!cd) return null;
    cd.setTranslation(cx, cy, cz).setFriction(0.8).setCollisionGroups(groups(G.WORLD));
    return this.game.physics.staticCollider(cd);
  }

  /**
   * A mesh that uses the terrain's own splat material (grass) so raised ground (mounds, berms, levees)
   * blends seamlessly with the heightfield. `geo` needs positions + index; uv/colour/splat are generated.
   */
  terrainMesh(geo: THREE.BufferGeometry, splat: [number, number, number] = [1, 0, 0]) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const half = 260;
    const uv = new Float32Array(n * 2);
    const col = new Float32Array(n * 3);
    const sp = new Float32Array(n * 3);
    const tA = new THREE.Color(0xcfeeb0);
    const tB = new THREE.Color(0xf4f7c0);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uv[i * 2] = (x + half) / (half * 2);
      uv[i * 2 + 1] = (half - z) / (half * 2);
      const noise = Math.sin(x * 0.13) * Math.sin(z * 0.11) * 0.5 + Math.sin(x * 0.037 + z * 0.041) * 0.5;
      c.copy(tA).lerp(tB, 0.5 + noise * 0.45);
      col.set([c.r, c.g, c.b], i * 3);
      sp.set(splat, i * 3);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(sp, 3));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const mat = (this.world.terrain?.material as THREE.Material | undefined) ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: 0x8fc35a });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = true;
    this.root.add(m);
    return m;
  }

  /**
   * Grass slope (levee / berm / ramp of earth) as a convex prism: `pts` are world-space vertices of the
   * top surface polygon (in order) — the rest drops vertically to y = base. Gets a hull collider.
   */
  earth(top: V3[], base = 0) {
    const n = top.length;
    const pos: number[] = [];
    const idx: number[] = [];
    // top fan (flat-shaded: separate vertices per face is overkill for gentle slopes)
    for (const p of top) pos.push(p[0], p[1], p[2]);
    for (let i = 1; i < n - 1; i++) idx.push(0, i + 1, i);
    // sides down to base where the edge is above base
    for (let i = 0; i < n; i++) {
      const a = top[i];
      const c = top[(i + 1) % n];
      if (a[1] - base < 0.01 && c[1] - base < 0.01) continue;
      const k = pos.length / 3;
      pos.push(a[0], a[1], a[2], c[0], c[1], c[2], c[0], base, c[2], a[0], base, a[2]);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // make sure the top faces up
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    if (nor.getY(0) < 0) {
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      geo.setIndex(idx);
      geo.computeVertexNormals();
    }
    const pts: number[] = [];
    for (const p of top) pts.push(p[0], p[1], p[2], p[0], base - 0.3, p[2]);
    this.hullCollider(pts);
    return this.terrainMesh(geo.toNonIndexed());
  }

  /** Rescale a water volume mesh's UVs so its ripples tile at ~`tile` metres regardless of its size. */
  waterUV(vol: { mesh?: THREE.Mesh; kind: string }, tile = 6) {
    const m = vol.mesh;
    if (!m) return;
    const rep = vol.kind === 'bay' ? 40 : 4;
    const g = m.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + m.position.x) / (tile * rep), (pos.getZ(i) + m.position.z) / (tile * rep));
    uv.needsUpdate = true;
  }

  // ---------------------------------------------------------------- glow (night emissive)
  glow(mat: Glow['mat'], day: number, night: number, prop: Glow['prop'] = 'emissiveIntensity') {
    this.state.glows.push({ mat, day, night, prop });
    return mat;
  }

  /** Emissive material that brightens at night. */
  glowMat(color: THREE.ColorRepresentation, day = 0.4, night = 2.4, base: THREE.ColorRepresentation = color) {
    const m = new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: day, roughness: 0.5 });
    this.glow(m, day, night);
    return m;
  }

  // ---------------------------------------------------------------- models
  model(path: string): Promise<THREE.Object3D | null> {
    let p = this.models.get(path);
    if (!p) {
      p = this.game.assets.tryModel(path);
      this.models.set(path, p);
    }
    // each caller gets its own clone of the loaded template
    return p.then((o) => (o ? o.clone(true) : null));
  }

  kenney(kitName: string, name: string) {
    return this.model(`assets/models/kenney/${kitName}/${name}.glb`);
  }

  /** Swap named materials' colours (clones the materials so other users of the GLB are unaffected). */
  recolor(obj: THREE.Object3D, colors: Record<string, THREE.ColorRepresentation>) {
    const done = new Map<THREE.Material, THREE.Material>();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const swap = (mat: THREE.Material) => {
        const c = colors[mat.name];
        if (c == null) return mat;
        let r = done.get(mat);
        if (!r) {
          r = mat.clone();
          (r as THREE.MeshStandardMaterial).color?.set(c);
          done.set(mat, r);
        }
        return r;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    });
    return obj;
  }

  /**
   * Instanced copies of a (small) model at explicit positions. xforms: [x, y, z, rotY, scale].
   * The template's own transform (incl. scale) is kept as the local matrix.
   */
  instances(template: THREE.Object3D, xforms: [number, number, number, number, number?][], opts: { shadow?: boolean; colors?: THREE.ColorRepresentation[] } = {}) {
    template.updateMatrixWorld(true);
    const group = new THREE.Group();
    template.traverse((o) => {
      const src = o as THREE.Mesh;
      if (!src.isMesh) return;
      const im = new THREE.InstancedMesh(src.geometry, src.material, xforms.length);
      im.castShadow = opts.shadow ?? true;
      im.receiveShadow = true;
      const local = src.matrixWorld.clone();
      xforms.forEach(([x, y, z, ry, sc], i) => {
        _q.setFromAxisAngle(Y, ry);
        _s.setScalar(sc ?? 1);
        _p.set(x, y, z);
        _m.compose(_p, _q, _s).multiply(local);
        im.setMatrixAt(i, _m);
        if (opts.colors) im.setColorAt(i, _c.set(opts.colors[i % opts.colors.length]));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    });
    this.root.add(group);
    return group;
  }

  /** Place a model with its bottom-centre at (x, y, z), uniformly scaled so its largest horizontal size = `size` (or by `scale`). */
  place(obj: THREE.Object3D, x: number, y: number, z: number, rotY = 0, opts: { size?: number; height?: number; scale?: number; shadow?: boolean } = {}) {
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.scale.setScalar(1);
    obj.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(obj);
    const size = bb.getSize(new THREE.Vector3());
    let s = opts.scale ?? 1;
    if (opts.size) s = opts.size / Math.max(size.x, size.z);
    if (opts.height) s = opts.height / size.y;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const inner = new THREE.Group();
    obj.position.set(-cx * s, -bb.min.y * s, -cz * s);
    obj.scale.setScalar(s);
    inner.add(obj);
    inner.position.set(x, y, z);
    inner.rotation.y = rotY;
    inner.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = opts.shadow ?? true;
        m.receiveShadow = true;
      }
    });
    this.root.add(inner);
    inner.updateMatrixWorld(true);
    return { obj: inner, size: size.multiplyScalar(s), scale: s };
  }

  // ---------------------------------------------------------------- signs
  /**
   * A sign face (canvas texture) on a backing board. The face looks along +Z rotated by rotY
   * (rotY = 0 → faces +Z/south, PI → north, PI/2 → east, -PI/2 → west).
   */
  sign(
    b: Batch,
    o: {
      pos: V3;
      rotY?: number;
      w: number;
      h: number;
      tex: THREE.Texture;
      frame?: THREE.ColorRepresentation;
      depth?: number;
      border?: number;
      emissive?: [number, number];
      back?: boolean;
      collide?: boolean;
      transparent?: boolean;
    },
  ) {
    const rotY = o.rotY ?? 0;
    const d = o.depth ?? 0.15;
    const border = o.border ?? 0.08;
    if (o.frame != null) b.box(o.pos, [o.w + border * 2, o.h + border * 2, d], o.frame, { rotY, collide: o.collide ?? true });
    else if (o.collide) this.collider(o.pos, [o.w, o.h, d], rotY);
    // Plain painted signs go into a per-zone texture atlas → one draw call for all of them.
    const cv = (o.tex as THREE.CanvasTexture).image as HTMLCanvasElement | undefined;
    if (!o.emissive && !o.transparent && typeof HTMLCanvasElement !== 'undefined' && cv instanceof HTMLCanvasElement && cv.width <= 2048 && cv.height <= 1024) {
      const m4 = new THREE.Matrix4().compose(new THREE.Vector3(o.pos[0], o.pos[1], o.pos[2]), new THREE.Quaternion().setFromAxisAngle(Y, rotY), new THREE.Vector3(1, 1, 1));
      const geos = [new THREE.PlaneGeometry(o.w, o.h).translate(0, 0, d / 2 + 0.012).applyMatrix4(m4)];
      if (o.back ?? true) geos.push(new THREE.PlaneGeometry(o.w, o.h).translate(0, 0, d / 2 + 0.012).rotateY(Math.PI).applyMatrix4(m4));
      this.atlasItems.push({ canvas: cv, geos });
      o.tex.dispose();
      return null;
    }
    const mat = new THREE.MeshStandardMaterial({ map: o.tex, roughness: 0.6, transparent: !!o.transparent, alphaTest: o.transparent ? 0.02 : 0 });
    if (o.emissive) {
      mat.emissive.set(0xffffff);
      mat.emissiveMap = o.tex;
      mat.emissiveIntensity = o.emissive[0];
      this.glow(mat, o.emissive[0], o.emissive[1]);
    }
    // front (and optionally back) face in ONE mesh
    const front = new THREE.PlaneGeometry(o.w, o.h).translate(0, 0, d / 2 + 0.012);
    let geo: THREE.BufferGeometry = front;
    if (o.back ?? true) {
      const back = new THREE.PlaneGeometry(o.w, o.h).translate(0, 0, d / 2 + 0.012).rotateY(Math.PI);
      geo = mergeGeometries([front, back], false) ?? front;
    }
    const face = new THREE.Mesh(geo, mat);
    face.position.set(o.pos[0], o.pos[1], o.pos[2]);
    face.rotation.y = rotY;
    face.receiveShadow = true;
    face.matrixAutoUpdate = false;
    face.updateMatrix();
    this.root.add(face);
    return face;
  }

  /** Pack all pending sign canvases into 2048² atlas page(s) and emit one merged mesh per page. */
  flushAtlas(name: string) {
    const items = this.atlasItems;
    this.atlasItems = [];
    if (!items.length) return;
    const S = 2048;
    const PAD = 8;
    const order = items.map((_, i) => i).sort((a, c) => items[c].canvas.height - items[a].canvas.height);
    type Page = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; x: number; y: number; rowH: number; geos: THREE.BufferGeometry[] };
    const pages: Page[] = [];
    const newPage = (): Page => {
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#6b6b6b';
      ctx.fillRect(0, 0, S, S);
      const p = { canvas: c, ctx, x: PAD, y: PAD, rowH: 0, geos: [] };
      pages.push(p);
      return p;
    };
    let page = newPage();
    const placed = new Map<HTMLCanvasElement, { page: Page; x0: number; y0: number }>();
    for (const i of order) {
      const it = items[i];
      const w = it.canvas.width;
      const h = it.canvas.height;
      const prev = placed.get(it.canvas);
      if (prev) {
        // same artwork used again → reuse its atlas rect
        for (const g of it.geos) {
          const uv = g.attributes.uv as THREE.BufferAttribute;
          for (let k = 0; k < uv.count; k++) uv.setXY(k, (prev.x0 + uv.getX(k) * w) / S, 1 - (prev.y0 + (1 - uv.getY(k)) * h) / S);
          prev.page.geos.push(g);
        }
        continue;
      }
      if (page.x + w + PAD > S) {
        page.x = PAD;
        page.y += page.rowH + PAD;
        page.rowH = 0;
      }
      if (page.y + h + PAD > S) page = newPage();
      const x0 = page.x;
      const y0 = page.y;
      // edge-extend a few pixels so mip-mapping doesn't bleed the grey background in
      page.ctx.drawImage(it.canvas, 0, 0, w, 1, x0, y0 - 3, w, 3);
      page.ctx.drawImage(it.canvas, 0, h - 1, w, 1, x0, y0 + h, w, 3);
      page.ctx.drawImage(it.canvas, 0, 0, 1, h, x0 - 3, y0, 3, h);
      page.ctx.drawImage(it.canvas, w - 1, 0, 1, h, x0 + w, y0, 3, h);
      page.ctx.drawImage(it.canvas, x0, y0);
      placed.set(it.canvas, { page, x0, y0 });
      page.x += w + PAD;
      page.rowH = Math.max(page.rowH, h);
      for (const g of it.geos) {
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) {
          const u = uv.getX(k);
          const v = uv.getY(k);
          uv.setXY(k, (x0 + u * w) / S, 1 - (y0 + (1 - v) * h) / S);
        }
        page.geos.push(g);
      }
    }
    for (const p of pages) {
      const tex = new THREE.CanvasTexture(p.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const merged = mergeGeometries(p.geos, false);
      for (const g of p.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
      mesh.name = `${name}:signs`;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.root.add(mesh);
    }
  }

  /** Simple painted text sign texture. */
  textSign(
    lines: { text: string; px: number; color?: string; font?: string; stroke?: string }[],
    o: { w: number; h: number; bg: string; border?: string; radius?: number; pxPerM?: number; bg2?: string },
  ) {
    const ppm = o.pxPerM ?? 128;
    const W = Math.min(2048, Math.round(o.w * ppm));
    const H = Math.min(2048, Math.round(o.h * ppm));
    return canvasTex(W, H, (ctx) => {
      if (o.bg2) {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, o.bg);
        g.addColorStop(1, o.bg2);
        ctx.fillStyle = g;
      } else ctx.fillStyle = o.bg;
      ctx.fillRect(0, 0, W, H);
      if (o.border) {
        ctx.strokeStyle = o.border;
        ctx.lineWidth = Math.max(4, H * 0.05);
        roundRect(ctx, ctx.lineWidth, ctx.lineWidth, W - ctx.lineWidth * 2, H - ctx.lineWidth * 2, o.radius ?? H * 0.08);
        ctx.stroke();
      }
      const total = lines.reduce((a, l) => a + l.px * 1.18, 0);
      let y = H / 2 - total / 2;
      for (const l of lines) {
        y += (l.px * 1.18) / 2;
        fitText(ctx, l.text, W / 2, y, W * 0.9, l.px, l.font ?? FONT_TITLE, { fill: l.color ?? '#fff', stroke: l.stroke });
        y += (l.px * 1.18) / 2;
      }
    });
  }
}

const kits = new WeakMap<Game, Promise<Kit>>();
export function getKit(game: Game, world: World): Promise<Kit> {
  let p = kits.get(game);
  if (!p) {
    p = (async () => {
      const k = new Kit(game, world);
      await k.load();
      return k;
    })();
    kits.set(game, p);
  }
  return p;
}

// ------------------------------------------------------------------ batch

export class Batch {
  private buckets = new Map<string, { mat: MatKey; shadow: boolean; geos: THREE.BufferGeometry[] }>();
  tris = 0;
  constructor(
    readonly kit: Kit,
    readonly name: string,
    readonly cell = 64,
  ) {}

  /** Add any geometry with a local→world matrix. */
  add(src: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, o: PieceOpts & { keepColors?: boolean } = {}) {
    const mat = o.mat ?? 'flat';
    const g = prepGeometry(src, m, _c.set(color), TILE[mat] ?? 0, !!o.uvRot, !!o.keepColors);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const cx = Math.floor((bb.min.x + bb.max.x) / 2 / this.cell);
    const cz = Math.floor((bb.min.z + bb.max.z) / 2 / this.cell);
    const shadow = o.shadow ?? true;
    const key = `${mat}|${shadow ? 1 : 0}|${cx},${cz}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { mat, shadow, geos: [] }));
    b.geos.push(g);
    this.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    return g;
  }

  /** Geometry with position / Euler rotation / scale. */
  geo(src: THREE.BufferGeometry, pos: V3, rot: V3 | THREE.Quaternion, scale: V3 | number, color: THREE.ColorRepresentation, o: PieceOpts & { keepColors?: boolean } = {}) {
    if (rot instanceof THREE.Quaternion) _q.copy(rot);
    else _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'YXZ'));
    if (typeof scale === 'number') _s.setScalar(scale);
    else _s.set(scale[0], scale[1], scale[2]);
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s);
    return this.add(src, _m, color, o);
  }

  box(c: V3, s: V3, color: THREE.ColorRepresentation, o: BoxOpts = {}) {
    _m.compose(_p.set(c[0], c[1], c[2]), _q.setFromAxisAngle(Y, o.rotY ?? 0), _s.set(s[0], s[1], s[2]));
    this.add(UNIT_BOX, _m, color, o);
    if (o.collide !== false) this.kit.collider(c, s, o.rotY ?? 0);
  }

  /** Box with arbitrary Euler rotation (YXZ) and a matching rotated collider. */
  boxR(c: V3, s: V3, rot: V3, color: THREE.ColorRepresentation, o: PieceOpts & { collide?: boolean } = {}) {
    const q = new THREE.Quaternion().setFromEuler(_e.set(rot[0], rot[1], rot[2], 'YXZ'));
    _m.compose(_p.set(c[0], c[1], c[2]), q, _s.set(s[0], s[1], s[2]));
    this.add(UNIT_BOX, _m, color, o);
    if (o.collide !== false) this.kit.colliderQ(c, s, q);
  }

  /**
   * A sloped slab whose TOP surface runs from `a` to `bPt` (centre line), with a matching collider.
   * Used for ramps, gangways, slides, stair ramps.
   */
  ramp(a: V3, bPt: V3, width: number, color: THREE.ColorRepresentation, o: PieceOpts & { thick?: number; collide?: boolean; friction?: number } = {}) {
    const t = o.thick ?? 0.2;
    const dx = bPt[0] - a[0];
    const dy = bPt[1] - a[1];
    const dz = bPt[2] - a[2];
    const horiz = Math.hypot(dx, dz);
    const len = Math.hypot(horiz, dy);
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, horiz);
    const q = new THREE.Quaternion().setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const c: V3 = [(a[0] + bPt[0]) / 2 - (up.x * t) / 2, (a[1] + bPt[1]) / 2 - (up.y * t) / 2, (a[2] + bPt[2]) / 2 - (up.z * t) / 2];
    _m.compose(_p.set(c[0], c[1], c[2]), q, _s.set(width, t, len));
    if (!(o as any).noVisual) this.add(UNIT_BOX, _m, color, o);
    if (o.collide !== false) this.kit.colliderQ(c, [width, t, len], q, o.friction ?? 0.8);
    return { q, center: c, len };
  }

  /**
   * Stairs from `from` (bottom, front edge centre) up to `to` (top, back edge centre). Visual steps with a
   * smooth ramp collider through the nosings (Jimothy is a ball — real steps would stop him).
   */
  stairs(from: V3, to: V3, width: number, color: THREE.ColorRepresentation, o: PieceOpts & { stepH?: number } = {}) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const run = Math.hypot(dx, dz);
    const n = Math.max(2, Math.round(dy / (o.stepH ?? 0.28)));
    const yaw = Math.atan2(dx, dz);
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const top = from[1] + dy * t1;
      const tm = (t0 + t1) / 2;
      this.box([from[0] + dx * tm, (from[1] + top) / 2, from[2] + dz * tm], [width, top - from[1], run / n + 0.01], color, { rotY: yaw, collide: i === n - 1, mat: o.mat, shadow: o.shadow });
    }
    const t = -1 / n;
    const t2 = (n - 1) / n;
    this.ramp([from[0] + dx * t, from[1], from[2] + dz * t], [from[0] + dx * t2, to[1], from[2] + dz * t2], width, color, { noVisual: true, thick: 0.3 } as any);
  }

  /** Vertical cylinder centred at c. collide: true = cylinder collider, 'box' = box collider. */
  cyl(c: V3, r: number, h: number, color: THREE.ColorRepresentation, o: PieceOpts & { rTop?: number; seg?: number; collide?: boolean | 'box'; open?: boolean } = {}) {
    const top = o.rTop != null ? o.rTop / r : 1;
    _m.compose(_p.set(c[0], c[1], c[2]), _q.identity(), _s.set(r, h, r));
    this.add(cylGeo(top, o.seg ?? 12, o.open), _m, color, o);
    if (o.collide === 'box') this.kit.collider(c, [r * 2, h, r * 2]);
    else if (o.collide) this.kit.cylinderCollider(c, Math.max(r, o.rTop ?? 0), h);
  }

  /** Cylinder between two points (pipes, rails, poles, ropes). */
  pipe(a: V3, bPt: V3, r: number, color: THREE.ColorRepresentation, o: PieceOpts & { seg?: number; collide?: boolean } = {}) {
    const va = new THREE.Vector3(a[0], a[1], a[2]);
    const vb = new THREE.Vector3(bPt[0], bPt[1], bPt[2]);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    if (len < 1e-4) return;
    dir.divideScalar(len);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    _m.compose(mid, q, _s.set(r, len, r));
    this.add(cylGeo(1, o.seg ?? 10), _m, color, o);
    if (o.collide) this.kit.colliderQ([mid.x, mid.y, mid.z], [r * 2, len, r * 2], q);
  }

  /** Low-poly blob (icosahedron) with radii. */
  blob(c: V3, r: V3 | number, color: THREE.ColorRepresentation, o: PieceOpts & { detail?: number; rotY?: number } = {}) {
    const s: V3 = typeof r === 'number' ? [r, r, r] : r;
    this.geo(icoGeo(o.detail ?? 1), c, [0, o.rotY ?? 0, 0], s, color, o);
  }

  sphere(c: V3, r: V3 | number, color: THREE.ColorRepresentation, o: PieceOpts & { w?: number; h?: number } = {}) {
    const s: V3 = typeof r === 'number' ? [r, r, r] : r;
    this.geo(sphereGeo(o.w ?? 14, o.h ?? 10), c, [0, 0, 0], s, color, o);
  }

  /** Flat ground decal (thin box, no collider, no shadow) — paths, plazas, field markings. */
  decal(c: V3, s: [number, number], color: THREE.ColorRepresentation, o: { rotY?: number; mat?: MatKey; thick?: number; uvRot?: boolean } = {}) {
    const t = o.thick ?? 0.06;
    this.box([c[0], c[1] + t / 2 - 0.02, c[2]], [s[0], t, s[1]], color, { rotY: o.rotY, mat: o.mat, collide: false, shadow: false, uvRot: o.uvRot });
  }

  /** Polyline ribbon on the ground (paths). y from world.heightAt + lift. */
  path(points: [number, number][], width: number, color: THREE.ColorRepresentation, o: { mat?: MatKey; lift?: number; closed?: boolean } = {}) {
    const world = this.kit.world;
    const pts = points.slice();
    if (o.closed) pts.push(pts[0]);
    const pos: number[] = [];
    const idx: number[] = [];
    const lift = o.lift ?? 0.04;
    // densify
    const dense: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.ceil(L / 2));
      for (let k = 0; k < n; k++) dense.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
    }
    dense.push(pts[pts.length - 1]);
    for (let i = 0; i < dense.length; i++) {
      const [x, z] = dense[i];
      const a = dense[Math.max(0, i - 1)];
      const c = dense[Math.min(dense.length - 1, i + 1)];
      let dx = c[0] - a[0];
      let dz = c[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const nx = -dz * (width / 2);
      const nz = dx * (width / 2);
      pos.push(x + nx, world.heightAt(x + nx, z + nz) + lift, z + nz, x - nx, world.heightAt(x - nx, z - nz) + lift, z - nz);
      if (i > 0) {
        const b0 = (i - 1) * 2;
        const b1 = i * 2;
        idx.push(b0, b1, b0 + 1, b0 + 1, b1, b1 + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // make sure normals point up
    const nor = g.attributes.normal as THREE.BufferAttribute;
    if (nor.getY(0) < 0) {
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = t;
      }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    this.add(g, _m.identity(), color, { mat: o.mat, shadow: false });
  }

  /**
   * Terrain-following ground patch: an (elliptical) disc sector grid with y = heightAt + lift.
   * a0/a1 limit the angle range (radians, default full circle); r0 makes it an annulus.
   */
  patch(cx: number, cz: number, rx: number, rz: number, color: THREE.ColorRepresentation, o: { mat?: MatKey; lift?: number; a0?: number; a1?: number; r0?: number; rings?: number; seg?: number; wobble?: number; seed?: number } = {}) {
    const world = this.kit.world;
    const rings = o.rings ?? 6;
    const seg = o.seg ?? 28;
    const a0 = o.a0 ?? 0;
    const a1 = o.a1 ?? Math.PI * 2;
    const full = o.a0 == null && o.a1 == null;
    const r0 = o.r0 ?? 0;
    const lift = o.lift ?? 0.04;
    const wob = o.wobble ?? 0;
    const pos: number[] = [];
    const idx: number[] = [];
    const cols = full ? seg : seg + 1;
    for (let i = 0; i <= rings; i++) {
      const t = r0 + (1 - r0) * (i / rings);
      for (let j = 0; j < cols; j++) {
        const a = a0 + ((a1 - a0) * j) / seg;
        const w = 1 + (wob ? Math.sin(a * 3 + (o.seed ?? 0)) * wob * 0.6 + Math.sin(a * 5 + 1.7 + (o.seed ?? 0)) * wob * 0.4 : 0) * (i / rings);
        const x = cx + Math.cos(a) * rx * t * w;
        const z = cz + Math.sin(a) * rz * t * w;
        pos.push(x, world.heightAt(x, z) + lift, z);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < seg; j++) {
        const j1 = full ? (j + 1) % seg : j + 1;
        const aa = i * cols + j;
        const bb = i * cols + j1;
        const cc = (i + 1) * cols + j;
        const dd = (i + 1) * cols + j1;
        idx.push(aa, cc, bb, bb, cc, dd);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    if ((g.attributes.normal as THREE.BufferAttribute).getY(Math.min(cols + 1, pos.length / 3 - 1)) < 0) {
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = t;
      }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    this.add(g, _m.identity(), color, { mat: o.mat, shadow: false });
  }

  /** A disc on the ground (plaza, sandbox fill, mud). */
  disc(c: V3, r: number, color: THREE.ColorRepresentation, o: { mat?: MatKey; seg?: number; thick?: number; rx?: number; rz?: number; rotY?: number } = {}) {
    const t = o.thick ?? 0.06;
    this.geo(cylGeo(1, o.seg ?? 28), [c[0], c[1] + t / 2 - 0.02, c[2]], [0, o.rotY ?? 0, 0], [o.rx ?? r, t, o.rz ?? r], color, { mat: o.mat, shadow: false });
  }

  flush() {
    const world = this.kit.world;
    const meshes: THREE.Mesh[] = [];
    for (const [key, b] of this.buckets) {
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) {
        console.warn(`[south] batch ${this.name} merge failed for ${key}`);
        continue;
      }
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, this.kit.mat(b.mat));
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.name = `${this.name}:${key}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.kit.root.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    this.kit.flushAtlas(this.name);
    return meshes;
  }
}

// ------------------------------------------------------------------ small shared builders

/** Chunky low-poly deciduous tree: trunk (climbable collider) + 3-5 blob canopy. */
export function tree(b: Batch, x: number, y: number, z: number, s = 1, seed = 1, o: { kind?: 'round' | 'pine' | 'tall'; greens?: number[] } = {}) {
  const r = rng(seed * 9973 + 17);
  const kind = o.kind ?? 'round';
  const bark = [0x6b4a2f, 0x5e4029, 0x75522f][Math.floor(r() * 3)];
  const greens = o.greens ?? [0x3f9a3c, 0x4fab3f, 0x368c38, 0x5db848, 0x2f7f33];
  if (kind === 'pine') {
    const h = 7 * s;
    b.cyl([x, y + h * 0.2, z], 0.28 * s, h * 0.4, bark, { collide: true, seg: 8 });
    for (let k = 0; k < 3; k++) {
      const ry = h * (0.3 + k * 0.2);
      b.cyl([x, y + ry + 1.2 * s, z], (2.2 - k * 0.55) * s, 2.8 * s, greens[(k + seed) % greens.length], { rTop: 0.05, seg: 8 });
    }
    return;
  }
  const th = (kind === 'tall' ? 4.2 : 3) * s;
  b.cyl([x, y + th / 2, z], 0.3 * s, th, bark, { rTop: 0.22 * s, collide: true, seg: 8 });
  const n = 3 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2;
    const d = k === 0 ? 0 : (0.9 + r() * 0.7) * s;
    const rr = (k === 0 ? 2.1 : 1.3 + r() * 0.6) * s * (kind === 'tall' ? 0.85 : 1);
    b.blob([x + Math.cos(a) * d, y + th + (k === 0 ? 1.2 : 0.4 + r() * 1.6) * s, z + Math.sin(a) * d], [rr, rr * (kind === 'tall' ? 1.25 : 0.9), rr], greens[Math.floor(r() * greens.length)], {
      detail: 1,
      rotY: r() * 3,
    });
  }
}

export function bush(b: Batch, x: number, y: number, z: number, s = 1, color = 0x3f8f3a) {
  b.blob([x, y + 0.45 * s, z], [0.9 * s, 0.65 * s, 0.9 * s], color, { detail: 1, rotY: x * 0.3 });
}

/** Park/waterfront bench: seat + backrest, faces +Z rotated by rotY. */
export function bench(b: Batch, x: number, y: number, z: number, rotY: number, o: { wood?: number; iron?: number; len?: number } = {}) {
  const len = o.len ?? 2;
  const wood = o.wood ?? 0xb07a45;
  const iron = o.iron ?? 0x2e3a33;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  // local → world: (lx, lz) → (x + lx*c + lz*s, z - lx*s + lz*c)
  const L = (lx: number, ly: number, lz: number): V3 => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  for (const k of [-0.16, 0, 0.16]) b.box(L(0, 0.46, k), [len, 0.06, 0.13], wood, { rotY, collide: false, mat: 'planks' });
  for (const k of [0.62, 0.8]) b.box(L(0, k, -0.27), [len, 0.12, 0.05], wood, { rotY, collide: false, mat: 'planks' });
  for (const lx of [-len / 2 + 0.15, len / 2 - 0.15]) {
    b.box(L(lx, 0.23, 0), [0.08, 0.46, 0.5], iron, { rotY, collide: false });
    b.box(L(lx, 0.62, -0.28), [0.07, 0.5, 0.06], iron, { rotY, collide: false });
  }
  b.kit.collider(L(0, 0.25, 0), [len, 0.5, 0.5], rotY);
  b.kit.collider(L(0, 0.72, -0.28), [len, 0.45, 0.08], rotY);
}

/** Picnic table with attached benches (static). */
export function picnicTable(b: Batch, x: number, y: number, z: number, rotY: number, wood = 0xa5703f) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const L = (lx: number, ly: number, lz: number): V3 => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  b.box(L(0, 0.76, 0), [2.2, 0.07, 0.95], wood, { rotY, mat: 'planks', collide: false });
  for (const lz of [-0.72, 0.72]) b.box(L(0, 0.45, lz), [2.2, 0.06, 0.32], wood, { rotY, mat: 'planks', collide: false });
  for (const lx of [-0.8, 0.8]) {
    b.boxR(L(lx, 0.38, 0.28), [0.08, 0.85, 0.08], [0.55, rotY, 0], 0x7b5230, { collide: false });
    b.boxR(L(lx, 0.38, -0.28), [0.08, 0.85, 0.08], [-0.55, rotY, 0], 0x7b5230, { collide: false });
    b.box(L(lx, 0.42, 0), [0.08, 0.06, 1.75], 0x7b5230, { rotY, collide: false });
  }
  b.kit.collider(L(0, 0.76, 0), [2.2, 0.1, 0.95], rotY);
  b.kit.collider(L(0, 0.24, 0), [1.8, 0.48, 0.6], rotY);
  for (const lz of [-0.72, 0.72]) b.kit.collider(L(0, 0.24, lz), [2.2, 0.48, 0.32], rotY);
}
