import * as THREE from 'three';
import type { Game } from '../../../../core/Game';
import { terrainHeight } from '../../../terrain';
import { Batch } from './batch';
import { cached, gradedTexture, loadPBR, proceduralAsphalt } from './textures';
import { trimeshFromGeometry } from './util';

/** Road cross-section constants shared by every street built in the central zones. */
export const ROAD = {
  /** Asphalt surface above the terrain. */
  lift: 0.05,
  /** Curb height (sidewalk above asphalt). */
  curb: 0.15,
  /** Avenue carriageway half width. */
  half: 3.75,
  /** Concrete curb band width. */
  curbW: 0.25,
  /** Avenue sidewalk outer edge (distance from the centre line). */
  outer: 6,
  /** Lane centre offset on avenues. */
  lane: 1.875,
};

export const roadY = (x: number, z: number) => terrainHeight(x, z) + ROAD.lift;
export const walkY = (x: number, z: number) => terrainHeight(x, z) + ROAD.lift + ROAD.curb;

export type CellKind = 'asphalt' | 'curb' | 'walk' | 'paver';
export const RAISED: Record<CellKind, boolean> = { asphalt: false, curb: true, walk: true, paver: true };

/** A straight street frame: runs along X (E-W) or along Z (N-S). (s, d) = (along, lateral). */
export interface StreetFrame {
  axis: 'x' | 'z';
  /** Centre line coordinate (z for axis 'x', x for axis 'z'). */
  c: number;
}

export function toWorld(f: StreetFrame, s: number, d: number): [number, number] {
  return f.axis === 'x' ? [s, f.c + d] : [f.c + d, s];
}

/** Sign of the lateral offset of the right-hand lane when driving toward +s. */
export function rightSign(f: StreetFrame) {
  return f.axis === 'x' ? 1 : -1;
}

// ------------------------------------------------------------------------------------------- materials

export interface RoadMats {
  asphalt: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  walk: THREE.MeshStandardMaterial;
  paver: THREE.MeshStandardMaterial;
  marking: THREE.MeshStandardMaterial;
}

export async function roadMaterials(game: Game): Promise<RoadMats> {
  return cached('roadMats', async () => {
    const [asp, walk, paving, slabTex, curbTex, paverTex] = await Promise.all([
      loadPBR(game, 'asphalt'),
      loadPBR(game, 'sidewalk'),
      loadPBR(game, 'paving'),
      gradedTexture('assets/textures/paving/color.jpg', { sat: 0.35, gain: 1.55, contrast: 0.85 }),
      gradedTexture('assets/textures/sidewalk/color.jpg', { sat: 0.2, gain: 1.45, contrast: 0.7 }),
      gradedTexture('assets/textures/sidewalk/color.jpg', { sat: 1.25, gain: 1.12, tint: '#ffe6cf' }),
    ]);
    const asphalt = new THREE.MeshStandardMaterial({
      color: 0x8c9199,
      map: asp.map ?? proceduralAsphalt(),
      normalMap: asp.normalMap,
      roughnessMap: asp.roughnessMap,
      roughness: 0.92,
      metalness: 0,
      normalScale: new THREE.Vector2(0.7, 0.7),
    });
    const curb = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: curbTex ?? walk.map,
      normalMap: walk.normalMap,
      roughness: 0.85,
      normalScale: new THREE.Vector2(0.4, 0.4),
    });
    const walkMat = new THREE.MeshStandardMaterial({
      color: slabTex ? 0xffffff : 0xd9d9d9,
      map: slabTex ?? paving.map ?? walk.map,
      normalMap: paving.normalMap ?? walk.normalMap,
      roughnessMap: paving.roughnessMap,
      roughness: 0.9,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    const paver = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: paverTex ?? walk.map,
      normalMap: walk.normalMap,
      roughnessMap: walk.roughnessMap,
      roughness: 0.9,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    const marking = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    return { asphalt, curb, walk: walkMat, paver, marking };
  });
}

/** World-space UV scale (meters per texture repeat) per surface kind. */
export const UV_SCALE: Record<CellKind, number> = { asphalt: 7, curb: 2.2, walk: 4.2, paver: 3.6 };

// ------------------------------------------------------------------------------------------- mesh building

/** Accumulates raw triangles per kind + one collider soup. */
export class SurfaceBuilder {
  readonly kinds = new Map<CellKind, number[]>();
  readonly col: number[] = [];

  private push(kind: CellKind, pts: THREE.Vector3[], collide = true) {
    let arr = this.kinds.get(kind);
    if (!arr) this.kinds.set(kind, (arr = []));
    for (const p of pts) arr.push(p.x, p.y, p.z);
    if (collide) for (const p of pts) this.col.push(p.x, p.y, p.z);
  }

  /** Quad a-b-c-d (in order around the perimeter), oriented so its normal agrees with `want`. */
  quad(kind: CellKind, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, want: THREE.Vector3, collide = true) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) n.subVectors(c, a).cross(new THREE.Vector3().subVectors(d, a));
    if (n.dot(want) < 0) this.push(kind, [a, d, c, a, c, b], collide);
    else this.push(kind, [a, b, c, a, c, d], collide);
  }

  tri(kind: CellKind, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, want: THREE.Vector3, collide = true) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.dot(want) < 0) this.push(kind, [a, c, b], collide);
    else this.push(kind, [a, b, c], collide);
  }

  /** Emit meshes into the batch (per kind) and the collider into physics. */
  finish(game: Game, batch: Batch, mats: RoadMats, opts: { collide?: boolean } = {}) {
    for (const [kind, arr] of this.kinds) {
      if (!arr.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      batch.add(g, mats[kind], { uv: UV_SCALE[kind], castShadow: false });
    }
    if (opts.collide !== false && this.col.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.col, 3));
      trimeshFromGeometry(game, g);
    }
    this.kinds.clear();
    this.col.length = 0;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Build a gridded street run. `classify(s, d)` decides what each cell is (null = no cell).
 * Heights follow the terrain; raised cells get vertical curb faces toward lower neighbours; the outermost
 * lateral cells get a skirt that dips into the terrain.
 */
export function gridRun(
  sb: SurfaceBuilder,
  f: StreetFrame,
  sGrid: number[],
  dGrid: number[],
  classify: (s: number, d: number) => CellKind | null,
  opts: { skirt?: boolean; skirtEnds?: boolean } = {},
) {
  const ns = sGrid.length - 1;
  const nd = dGrid.length - 1;
  const kinds: (CellKind | null)[][] = [];
  for (let i = 0; i < ns; i++) {
    const row: (CellKind | null)[] = [];
    const sm = (sGrid[i] + sGrid[i + 1]) / 2;
    for (let j = 0; j < nd; j++) row.push(classify(sm, (dGrid[j] + dGrid[j + 1]) / 2));
    kinds.push(row);
  }
  const P = (s: number, d: number, raised: boolean, extra = 0) => {
    const [x, z] = toWorld(f, s, d);
    return new THREE.Vector3(x, terrainHeight(x, z) + ROAD.lift + (raised ? ROAD.curb : 0) + extra, z);
  };
  const sDir = f.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const dDir = f.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < ns; i++) {
    const s0 = sGrid[i],
      s1 = sGrid[i + 1];
    for (let j = 0; j < nd; j++) {
      const k = kinds[i][j];
      if (!k) continue;
      const r = RAISED[k];
      const d0 = dGrid[j],
        d1 = dGrid[j + 1];
      sb.quad(k, P(s0, d0, r), P(s1, d0, r), P(s1, d1, r), P(s0, d1, r), UP);
      // lateral neighbour (j+1)
      const kn = j + 1 < nd ? kinds[i][j + 1] : null;
      if (kn && RAISED[kn] !== r) {
        const low = !r;
        // face at d = d1, normal toward the lower cell
        const want = low ? dDir.clone().negate() : dDir.clone();
        sb.quad('curb', P(s0, d1, false), P(s1, d1, false), P(s1, d1, true), P(s0, d1, true), want);
      }
      // along neighbour (i+1)
      const ka = i + 1 < ns ? kinds[i + 1][j] : null;
      if (ka && RAISED[ka] !== r) {
        const low = !r;
        const want = low ? sDir.clone().negate() : sDir.clone();
        sb.quad('curb', P(s1, d0, false), P(s1, d1, false), P(s1, d1, true), P(s1, d0, true), want);
      }
      // skirts
      if (opts.skirt !== false) {
        if (j === 0 || (j > 0 && !kinds[i][j - 1])) {
          sb.quad(r ? 'walk' : 'asphalt', P(s0, d0, r), P(s1, d0, r), P(s1, d0, false, -ROAD.lift - 0.35), P(s0, d0, false, -ROAD.lift - 0.35), dDir.clone().negate(), false);
        }
        if (j === nd - 1 || (j < nd - 1 && !kinds[i][j + 1])) {
          sb.quad(r ? 'walk' : 'asphalt', P(s0, d1, r), P(s1, d1, r), P(s1, d1, false, -ROAD.lift - 0.35), P(s0, d1, false, -ROAD.lift - 0.35), dDir, false);
        }
      }
      if (opts.skirtEnds) {
        if (i === 0) sb.quad(r ? 'walk' : 'asphalt', P(s0, d0, r), P(s0, d1, r), P(s0, d1, false, -0.4), P(s0, d0, false, -0.4), sDir.clone().negate(), false);
        if (i === ns - 1) sb.quad(r ? 'walk' : 'asphalt', P(s1, d0, r), P(s1, d1, r), P(s1, d1, false, -0.4), P(s1, d0, false, -0.4), sDir, false);
      }
    }
  }
}

/** Sorted unique grid from a regular step plus break lines. */
export function makeGrid(a: number, b: number, step: number, breaks: number[] = []) {
  const out: number[] = [];
  for (let s = a; s < b - 1e-6; s += step) out.push(s);
  out.push(b);
  for (const x of breaks) if (x > a + 1e-3 && x < b - 1e-3) out.push(x);
  out.sort((p, q) => p - q);
  const res: number[] = [];
  for (const x of out) if (!res.length || x - res[res.length - 1] > 0.02) res.push(x);
  return res;
}

/**
 * Half-disc turnaround ("bulb") at the end of a street: asphalt to rA, curb band, sidewalk ring to rO.
 * dir = +1 at the +s end, -1 at the -s end. Also adds seam curb faces where the straight run is narrower.
 */
export function bulb(sb: SurfaceBuilder, f: StreetFrame, sEnd: number, dir: 1 | -1, rA: number, rC: number, rO: number, runHalf: number) {
  const seg = 20;
  const P = (s: number, d: number, raised: boolean, extra = 0) => {
    const [x, z] = toWorld(f, s, d);
    return new THREE.Vector3(x, terrainHeight(x, z) + ROAD.lift + (raised ? ROAD.curb : 0) + extra, z);
  };
  const pt = (r: number, a: number, raised: boolean, extra = 0) => P(sEnd + dir * Math.cos(a) * r, Math.sin(a) * r, raised, extra);
  const center = P(sEnd, 0, false);
  for (let i = 0; i < seg; i++) {
    const a0 = -Math.PI / 2 + (i / seg) * Math.PI;
    const a1 = -Math.PI / 2 + ((i + 1) / seg) * Math.PI;
    // asphalt fan (split into 2 rings for terrain following)
    const mid = rA * 0.5;
    sb.tri('asphalt', center, pt(mid, a0, false), pt(mid, a1, false), UP);
    sb.quad('asphalt', pt(mid, a0, false), pt(rA, a0, false), pt(rA, a1, false), pt(mid, a1, false), UP);
    // curb face (outward normal is toward the centre = lower side)
    const inward = new THREE.Vector3().subVectors(center, pt(rA, (a0 + a1) / 2, false)).setY(0).normalize();
    sb.quad('curb', pt(rA, a0, false), pt(rA, a1, false), pt(rA, a1, true), pt(rA, a0, true), inward);
    sb.quad('curb', pt(rA, a0, true), pt(rC, a0, true), pt(rC, a1, true), pt(rA, a1, true), UP);
    sb.quad('walk', pt(rC, a0, true), pt(rO, a0, true), pt(rO, a1, true), pt(rC, a1, true), UP);
    // outer skirt
    sb.quad('walk', pt(rO, a0, true), pt(rO, a1, true), pt(rO, a1, false, -0.4), pt(rO, a0, false, -0.4), inward.clone().negate(), false);
  }
  // seam faces: the run's raised strips [runHalf, rA] meet bulb asphalt
  const sDir = f.axis === 'x' ? new THREE.Vector3(dir, 0, 0) : new THREE.Vector3(0, 0, dir);
  for (const side of [-1, 1]) {
    const d0 = side * runHalf,
      d1 = side * rA;
    sb.quad('curb', P(sEnd, d0, false), P(sEnd, d1, false), P(sEnd, d1, true), P(sEnd, d0, true), sDir);
  }
}

// ------------------------------------------------------------------------------------------- markings

/** Collects road paint quads (vertex coloured) following the terrain. */
export class Paint {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  private c = new THREE.Color();
  /** Strip from (s0..s1) × (d0..d1) in frame f, subdivided along s. */
  strip(f: StreetFrame, s0: number, s1: number, d0: number, d1: number, color: THREE.ColorRepresentation, step = 3, yOff = 0.012) {
    const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
    this.c.set(color);
    const P = (s: number, d: number) => {
      const [x, z] = toWorld(f, s, d);
      return [x, terrainHeight(x, z) + ROAD.lift + yOff, z];
    };
    for (let i = 0; i < n; i++) {
      const a = s0 + ((s1 - s0) * i) / n;
      const b = s0 + ((s1 - s0) * (i + 1)) / n;
      const p = [P(a, d0), P(b, d0), P(b, d1), P(a, d1)];
      // orient up
      const ux = p[1][0] - p[0][0],
        uz = p[1][2] - p[0][2];
      const vx = p[2][0] - p[0][0],
        vz = p[2][2] - p[0][2];
      const ny = uz * vx - ux * vz;
      const order = ny >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const k of order) {
        this.pos.push(p[k][0], p[k][1], p[k][2]);
        this.col.push(this.c.r, this.c.g, this.c.b);
      }
    }
  }
  /** Dashed strip. */
  dashed(f: StreetFrame, s0: number, s1: number, d0: number, d1: number, color: THREE.ColorRepresentation, dash = 3, gap = 4) {
    const dir = Math.sign(s1 - s0) || 1;
    for (let s = s0; (s1 - s) * dir > 0.1; s += dir * (dash + gap)) {
      const e = dir > 0 ? Math.min(s + dash, s1) : Math.max(s - dash, s1);
      this.strip(f, s, e, d0, d1, color, dash);
    }
  }
  /** Zebra crosswalk across the carriageway at s ∈ [sa, sb], bars along s. */
  zebra(f: StreetFrame, sa: number, sb: number, half: number, color: THREE.ColorRepresentation = 0xf4f4f0) {
    const bar = 0.5,
      gap = 0.45;
    const n = Math.floor((half * 2 + gap) / (bar + gap));
    const start = -((n * (bar + gap) - gap) / 2);
    for (let i = 0; i < n; i++) {
      const d0 = start + i * (bar + gap);
      this.strip(f, sa, sb, d0, d0 + bar, color, 4);
    }
  }
  finish(batch: Batch, mat: THREE.Material) {
    if (!this.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    batch.add(g, mat, { castShadow: false });
    this.pos.length = 0;
    this.col.length = 0;
  }
}

// ------------------------------------------------------------------------------------------- lanes

/** Catmull-Rom resample of key points (x, z) → Vector3 with y = road surface. */
export function smoothPath(keys: [number, number][], step = 1.5, closed = false): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(
    keys.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    closed,
    'centripetal',
  );
  const len = curve.getLength();
  const n = Math.max(2, Math.ceil(len / step));
  const pts = curve.getSpacedPoints(n);
  if (closed) pts.pop();
  return pts.map((p) => new THREE.Vector3(p.x, roadY(p.x, p.z), p.z));
}

/**
 * Out-and-back loop along a straight street with lollipop U-turns at both ends (right-hand traffic).
 * uCenterOff: how far past sEnd (toward the end) the U-turn circle centre sits; uR: circle radius.
 */
export function outAndBackLane(f: StreetFrame, s0: number, s1: number, laneOff: number, uR: number, uCenterOff: number, step = 4): THREE.Vector3[] {
  const rs = rightSign(f);
  const keysFor = (sEnd: number, dir: 1 | -1): [number, number][] => {
    // arriving heading dir·s on the right side (d = dir·rs·laneOff), leaving on the other side
    const dIn = dir * rs * laneOff;
    const k: [number, number][] = [];
    const sd: [number, number][] = [
      [sEnd - dir * 14, dIn],
      [sEnd - dir * 7, dIn * 1.12],
      [sEnd - dir * 2.5, Math.sign(dIn) * (uR * 0.85)],
    ];
    const cs = sEnd + dir * uCenterOff;
    const m = 9;
    for (let i = 0; i <= m; i++) {
      const t = i / m;
      const phi = Math.PI / 2 - Math.PI * t; // +90° → -90°
      sd.push([cs + dir * Math.cos(phi) * uR, Math.sign(dIn) * Math.sin(phi) * uR]);
    }
    sd.push([sEnd - dir * 2.5, -Math.sign(dIn) * (uR * 0.85)], [sEnd - dir * 7, -dIn * 1.12], [sEnd - dir * 14, -dIn]);
    for (const [s, d] of sd) k.push(toWorld(f, s, d));
    return k;
  };
  const endA = keysFor(s1, 1); // at +s end
  const endB = keysFor(s0, -1); // at -s end
  const pts: THREE.Vector3[] = [];
  const addStraight = (sa: number, sb: number, d: number) => {
    const n = Math.max(1, Math.ceil(Math.abs(sb - sa) / step));
    for (let i = 1; i < n; i++) {
      const s = sa + ((sb - sa) * i) / n;
      const [x, z] = toWorld(f, s, d);
      pts.push(new THREE.Vector3(x, roadY(x, z), z));
    }
  };
  // +s direction on the right side
  const dPlus = rs * laneOff;
  addStraight(s0 + 14, s1 - 14, dPlus);
  pts.push(...smoothPath(endA, 1.2));
  addStraight(s1 - 14, s0 + 14, -dPlus);
  pts.push(...smoothPath(endB, 1.2));
  return dedupe(pts);
}

function dedupe(pts: THREE.Vector3[]) {
  const out: THREE.Vector3[] = [];
  for (const p of pts) if (!out.length || out[out.length - 1].distanceToSquared(p) > 0.04) out.push(p);
  if (out.length > 2 && out[0].distanceToSquared(out[out.length - 1]) < 0.04) out.pop();
  return out;
}
