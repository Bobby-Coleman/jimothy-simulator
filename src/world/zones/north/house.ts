/**
 * Procedural Seattle Craftsman houses: pastel lap siding, wide-eaved gable roofs with knee braces, tapered
 * porch columns on river-rock piers, bay windows, chimneys, lattice porch skirts. Houses on slopes get a
 * foundation down to the lowest ground point (daylight basement vibes). Everything merges into a Batch.
 */
import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World } from '../../World';
import { Batch, Frame, GEO, footprint, rng, pick, roofCollider, gableCollider, colliderHull } from './kit';

export type HouseStyle = 'gable' | 'bungalow' | 'foursquare';

export interface HouseOpts {
  /** Body center (world XZ). */
  x: number;
  z: number;
  /** Yaw: the front (porch side) faces local +Z rotated by this. */
  face: number;
  w?: number;
  d?: number;
  style?: HouseStyle;
  siding: number;
  trim?: number;
  roof?: number;
  door?: number;
  gable?: number;
  seed: number;
  /** Porch width fraction of the house width (0.55..1). */
  porchFrac?: number;
  bay?: boolean;
  chimney?: boolean;
  /** Leave the porch underside open (lattice with a gap on the +x or -x side) — for kit hiding spots. */
  openPorch?: 1 | -1;
  /** Local x where the porch-roof collider gets a thin slot (lets top-down ground probes reach the porch floor). */
  porchRoofSlotX?: number;
  litChance?: number;
  foundation?: 'stone' | 'concrete' | 'brick';
}

export interface HouseInfo {
  frame: Frame;
  floorY: number;
  wallTop: number;
  w: number;
  d: number;
  /** World point at the foot of the front steps (for the front walk). */
  stepFoot: THREE.Vector3;
  /** Porch floor center (world) and its local extents. */
  porch: { center: THREE.Vector3; w: number; d: number; px: number };
  /** Highest walkable roof point (ridge, world). */
  ridge: THREE.Vector3;
  /** Top of the chimney cap (world), if the house has one. */
  chimneyTop?: THREE.Vector3;
  door: THREE.Vector3;
  /** Local z of the back wall. */
  back: number;
}

const WIN_H = 1.55;

export function buildHouse(game: Game, world: World, b: Batch, o: HouseOpts): HouseInfo {
  const r = rng(o.seed);
  const style = o.style ?? 'gable';
  const w = o.w ?? 8.4;
  const d = o.d ?? 9.6;
  const trim = o.trim ?? 0xf6f2e8;
  const roofC = o.roof ?? 0x4d4f57;
  const doorC = o.door ?? pick(r, [0xb03a2e, 0x2f6f73, 0x2d3f6b, 0xd9a21b, 0x7a4a2a, 0x3f7a4f]);
  const gableC = o.gable ?? new THREE.Color(o.siding).offsetHSL(0, -0.05, -0.1).getHex();
  const lit = o.litChance ?? 0.45;
  const pd = 2.5;
  const pw = Math.min(w, Math.max(4.2, w * (o.porchFrac ?? (style === 'bungalow' ? 1 : 0.62))));
  const px = pw >= w - 0.01 ? 0 : (w - pw) / 2 * (r() < 0.5 ? -1 : 1);
  const doorU = px + (pw >= w - 0.01 ? w * 0.18 : 0) * (r() < 0.5 ? -1 : 1);

  // --- ground & floor level
  const tmp = new Frame(o.x, 0, o.z, o.face);
  const pc = tmp.p(0, 0, pd / 2 + 1);
  const fp = footprint(world, pc.x, pc.z, w + 0.6, d + pd + 2.6, o.face, 0.8);
  const floorY = fp.max + 0.45;
  const f = new Frame(o.x, floorY, o.z, o.face);
  const yb = fp.min - floorY - 0.35; // local foundation bottom
  const wallTop = style === 'bungalow' ? 3.35 : 5.7;
  b.setUVFrame(f.m);

  // --- foundation + walls
  const fMat = o.foundation ?? pick(r, ['stone', 'concrete', 'concrete', 'brick'] as const);
  const fCol = fMat === 'stone' ? 0xb9b2a4 : fMat === 'brick' ? 0xb86a4e : 0xa8a298;
  f.box(b, fMat, 0, (yb + 0.1) / 2, 0, w + 0.16, 0.1 - yb, d + 0.16, fCol);
  f.box(b, 'siding', 0, wallTop / 2, 0, w, wallTop, d, o.siding);
  // water table / belt course / corner boards
  f.box(b, 'trim', 0, 0.12, 0, w + 0.1, 0.22, d + 0.1, trim);
  if (style !== 'bungalow') f.box(b, 'trim', 0, 3.0, 0, w + 0.1, 0.2, d + 0.1, trim);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) f.box(b, 'trim', (sx * w) / 2, wallTop / 2, (sz * d) / 2, 0.18, wallTop, 0.18, trim);
  f.collider(game, 0, (wallTop + yb) / 2, 0, w, wallTop - yb, d);

  // --- window / face helpers
  type Face = 'F' | 'B' | 'L' | 'R';
  const place = (face: Face, u: number, y: number, out: number): [number, number, number, number] => {
    switch (face) {
      case 'F':
        return [u, y, d / 2 + out, 0];
      case 'B':
        return [-u, y, -d / 2 - out, Math.PI];
      case 'L':
        return [-w / 2 - out, y, u, -Math.PI / 2];
      case 'R':
        return [w / 2 + out, y, -u, Math.PI / 2];
    }
  };
  const part = (mat: string, face: Face, u: number, y: number, out: number, sx: number, sy: number, sz: number, col: number) => {
    const [lx, ly, lz, ry] = place(face, u, y, out);
    f.box(b, mat, lx, ly, lz, sx, sy, sz, col, ry);
  };
  const win = (face: Face, u: number, y: number, ww = 1.05, wh = WIN_H, faceOut = 0) => {
    const glass = r() < lit ? 'glassLit' : 'glass';
    part(glass, face, u, y, faceOut + 0.0, ww, wh, 0.06, 0x9fb7c9);
    part('trim', face, u, y + wh / 2 + 0.08, faceOut + 0.04, ww + 0.34, 0.16, 0.1, trim);
    part('trim', face, u, y - wh / 2 - 0.05, faceOut + 0.06, ww + 0.26, 0.09, 0.17, trim);
    part('trim', face, u - ww / 2 - 0.06, y, faceOut + 0.03, 0.12, wh, 0.08, trim);
    part('trim', face, u + ww / 2 + 0.06, y, faceOut + 0.03, 0.12, wh, 0.08, trim);
    part('trim', face, u, y - wh * 0.12, faceOut + 0.04, ww, 0.06, 0.08, trim);
    part('trim', face, u - ww / 6, y + wh * 0.2, faceOut + 0.04, 0.045, wh * 0.52, 0.07, trim);
    part('trim', face, u + ww / 6, y + wh * 0.2, faceOut + 0.04, 0.045, wh * 0.52, 0.07, trim);
  };

  // --- door + porch light
  part('trim', 'F', doorU, 1.1, 0.02, 1.36, 2.36, 0.1, trim);
  part('paint', 'F', doorU, 1.05, 0.06, 1.0, 2.1, 0.08, doorC);
  for (const k of [-1, 0, 1]) part('glassLit', 'F', doorU + k * 0.27, 1.72, 0.1, 0.2, 0.3, 0.04, 0xa9bfcf);
  part('trim', 'F', doorU + 0.28, 1.05, 0.12, 0.06, 0.06, 0.06, 0xc9a646); // knob
  const lampU = doorU + (doorU > 0 ? -0.95 : 0.95);
  part('lamp', 'F', lampU, 2.0, 0.14, 0.2, 0.3, 0.2, 0xffe9b8);
  part('trim', 'F', lampU, 2.2, 0.14, 0.26, 0.08, 0.26, 0x2a2a2a);
  part('trim', 'F', lampU, 1.83, 0.14, 0.22, 0.05, 0.22, 0x2a2a2a);

  // --- windows
  const frontSlots = [-w / 2 + 1.35, w / 2 - 1.35].filter((u) => Math.abs(u - doorU) > 1.4);
  for (const u of frontSlots) win('F', u, 1.55);
  if (style !== 'bungalow') {
    const up = [-w / 2 + 1.6, w / 2 - 1.6];
    for (const u of up) win('F', u, 4.62, 1.0, 1.2);
  }
  const bay = o.bay ?? r() < 0.5;
  const baySide: Face = r() < 0.5 ? 'L' : 'R';
  for (const face of ['L', 'R', 'B'] as Face[]) {
    const len = face === 'B' ? w : d;
    const n = len > 9 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len * (i + 0.5)) / n;
      if (!(bay && face === baySide && Math.abs(u) < 1.6)) win(face, u, 1.55, 0.95);
      if (style !== 'bungalow') win(face, u, 4.55, 0.95, 1.3);
    }
  }
  // bay window: a box bay with three windows and its own little roof
  if (bay) {
    const out = 0.75,
      bw = 2.6;
    const [lx, , lz, ry] = place(baySide, 0, 0, out / 2);
    f.box(b, 'siding', lx, 1.3, lz, bw, 2.3, out, o.siding, ry);
    f.box(b, fMat, lx, (yb + 0.2) / 2, lz, bw + 0.04, 0.2 - yb, out + 0.04, fCol, ry);
    f.box(b, 'trim', lx, 0.25, lz, bw + 0.1, 0.2, out + 0.1, trim, ry);
    const [rx2, , rz2] = place(baySide, 0, 0, out / 2 + 0.05);
    f.box(b, 'roof', rx2, 2.6, rz2, bw + 0.3, 0.16, out + 0.35, roofC, ry);
    win(baySide, 0, 1.4, 1.5, 1.5, out);
    // side panes
    const sideGlass = r() < lit ? 'glassLit' : 'glass';
    for (const s of [-1, 1]) {
      const [gx, , gz] = place(baySide, (s * bw) / 2, 0, out / 2);
      f.box(b, sideGlass, gx, 1.4, gz, 0.07, 1.4, out * 0.6, 0xa9bfcf, ry);
    }
    f.collider(game, lx, (yb + 2.65) / 2, lz, bw, 2.65 - yb, out, ry); // down to the ground: no overhang to get stuck under
  }

  // --- chimney
  const chimney = o.chimney ?? r() < 0.6;
  let chimTop = 0;
  let chimneyTop: THREE.Vector3 | undefined;
  if (chimney) {
    const side = baySide === 'L' ? 1 : -1;
    const cz = -d / 4;
    const top =
      wallTop + (style === 'bungalow' ? d * 0.36 + 1.2 : style === 'foursquare' ? 0.55 * (Math.min(w, d) / 2 + 0.6) + 0.2 : (w / 2) * 0.62 + 0.9);
    chimTop = top;
    const cxl = side * (w / 2 + 0.36);
    chimneyTop = f.p(cxl, top + 0.12, cz);
    f.box(b, 'brick', cxl, (yb + top) / 2, cz, 0.72, top - yb, 1.0, 0xb2573f);
    f.box(b, 'trim', cxl, top + 0.06, cz, 0.84, 0.12, 1.12, 0x8d8a84);
    f.collider(game, cxl, (yb + top) / 2, cz, 0.72, top - yb, 1.0);
  }

  // --- roofs
  let ridge = new THREE.Vector3();
  if (style === 'foursquare') {
    // hipped "Seattle box" roof: a square-ish pyramid with a little front dormer
    const pitch = 0.55;
    const ov = 0.6;
    const bx = w + 2 * ov,
      bz = d + 2 * ov;
    const Ey = wallTop - ov * pitch;
    const rise = pitch * (Math.min(w, d) / 2 + ov);
    f.geo(b, 'roof', GEO.cone4, 0, Ey + rise / 2, 0, bx, rise, bz, roofC);
    ridge = f.p(0, Ey + rise + 0.05, 0);
    // soffit band + rafter tails all around
    f.box(b, 'trim', 0, wallTop - 0.05, 0, w + 0.12, 0.18, d + 0.12, trim);
    // collider: the pyramid itself, trimmed to the wall footprint (no eave overhang, so a wall climb still mantles
    // straight on). Floor pass: it used to be 4 inclined slabs, each as wide as 70% of the wall, which stood up to
    // 0.6 m proud of the neighbouring hip faces (Jimothy floated over a quarter of every hip roof).
    const roofH = (x: number, z: number) => Ey + rise * (1 - Math.max((2 * Math.abs(x)) / bx, (2 * Math.abs(z)) / bz));
    const hull: THREE.Vector3[] = [f.p(0, Ey + rise, 0)];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const cx = (sx * w) / 2,
          cz = (sz * d) / 2;
        hull.push(f.p(cx, roofH(cx, cz), cz), f.p(cx, wallTop - 0.4, cz));
        // where the hip lines leave the footprint
        const hx = ((bx / bz) * d) / 2;
        if (hx < w / 2) hull.push(f.p(sx * hx, roofH(sx * hx, cz), cz));
        const hz = ((bz / bx) * w) / 2;
        if (hz < d / 2) hull.push(f.p(cx, roofH(cx, sz * hz), sz * hz));
      }
    if (!colliderHull(game, hull)) {
      for (const s of [-1, 1]) {
        roofCollider(game, f, 'z', s, d / 2, Ey + rise * (1 - d / bz), Ey + rise, w * 0.7);
        roofCollider(game, f, 'x', s, w / 2, Ey + rise * (1 - w / bx), Ey + rise, d * 0.7);
      }
    }
    // front dormer with a tiny hip
    const dy = Ey + rise * 0.3;
    const dzF = d / 2 - 0.3;
    f.box(b, 'siding', 0, dy + 0.55, dzF - 0.9, 2.4, 1.3, 1.8, gableC);
    f.geo(b, 'roof', GEO.cone4, 0, dy + 1.45, dzF - 0.8, 3.0, 0.6, 2.4, roofC);
    const dglass = r() < lit ? 'glassLit' : 'glass';
    f.box(b, dglass, -0.5, dy + 0.6, dzF + 0.02, 0.7, 0.7, 0.05, 0xa9bfcf);
    f.box(b, dglass, 0.5, dy + 0.6, dzF + 0.02, 0.7, 0.7, 0.05, 0xa9bfcf);
    f.box(b, 'trim', 0, dy + 0.6, dzF + 0.04, 0.12, 0.8, 0.06, trim);
    f.collider(game, 0, dy + 0.7, dzF - 0.9, 2.4, 1.6, 1.8);
  } else if (style === 'gable') {
    const pitch = 0.62;
    const ov = 0.6,
      rake = 0.55,
      t = 0.2;
    const th = Math.atan(pitch);
    const Ey = wallTop - ov * pitch;
    const Ry = wallTop + (w / 2) * pitch;
    const run = w / 2 + ov;
    const L = Math.hypot(run, Ry - Ey) + 0.12;
    const zLen = d + 2 * rake;
    for (const s of [-1, 1]) {
      // s = -1 left slab (x<0) rotates +th, s = +1 right slab rotates -th
      const midX = (s * run) / 2;
      const midY = (Ey + Ry) / 2;
      const nx = s * Math.sin(th),
        ny = Math.cos(th);
      const cx = midX + nx * (t / 2) - s * Math.cos(th) * 0.06;
      const cy = midY + ny * (t / 2) + Math.sin(th) * 0.06;
      b.add('roof', GEO.box, f.mat(cx, cy, 0, L, t, zLen, 0, 0, -s * th), roofC, { swap: true });
      roofCollider(game, f, 'x', s, w / 2, wallTop, Ry, d);
      // rafter tails
      for (let zz = -d / 2 + 0.3; zz <= d / 2 - 0.2; zz += 0.75)
        f.box(b, 'trim', s * (w / 2 + ov * 0.6), Ey + ov * 0.4 * pitch - 0.05, zz, ov * 0.9, 0.09, 0.07, trim, 0, 0, -s * th);
    }
    f.box(b, 'roof', 0, Ry + t / Math.cos(th) - 0.02, 0, 0.34, 0.14, zLen + 0.04, new THREE.Color(roofC).multiplyScalar(0.8).getHex());
    f.collider(game, 0, Ry + t / Math.cos(th) - 0.02, 0, 0.34, 0.14, d); // floor pass: solid ridge cap
    ridge = f.p(0, Ry + t + 0.1, 0);
    // gable ends (front & back) + vents + knee braces
    for (const s of [-1, 1]) {
      f.geo(b, 'siding', GEO.prism, 0, wallTop, (s * d) / 2, w, (w / 2) * pitch, 0.16, gableC);
      gableCollider(game, f, 'z', s, d / 2, wallTop, w, (w / 2) * pitch);
      f.box(b, 'trim', 0, wallTop + (w / 2) * pitch * 0.45, (s * d) / 2 + s * 0.09, 0.7, 0.5, 0.06, trim);
      f.box(b, 'trim', 0, wallTop + 0.08, (s * d) / 2 + s * 0.05, w + 0.1, 0.16, 0.1, trim);
      for (const k of [-1, 1]) f.box(b, 'trim', k * (w / 2 - 0.35), wallTop - 0.1, (s * d) / 2 + s * rake * 0.45, 0.1, 0.8, 0.1, trim, 0, s * Math.PI * 0.25);
      if (style === 'gable') {
        // attic window in the gable
        const attic = r() < lit ? 'glassLit' : 'glass';
        const gy = wallTop + (w / 2) * pitch * 0.22;
        f.box(b, attic, -0.55, gy, (s * d) / 2 + s * 0.08, 0.5, 0.55, 0.05, 0xa9bfcf);
        f.box(b, attic, 0.55, gy, (s * d) / 2 + s * 0.08, 0.5, 0.55, 0.05, 0xa9bfcf);
      }
    }
  } else {
    // bungalow: side-gable (ridge along local x), steeper, with a big front shed dormer
    const pitch = 0.72;
    const ov = 0.6,
      rake = 0.5,
      t = 0.2;
    const th = Math.atan(pitch);
    const Ey = wallTop - ov * pitch;
    const Ry = wallTop + (d / 2) * pitch;
    const run = d / 2 + ov;
    const L = Math.hypot(run, Ry - Ey) + 0.12;
    const xLen = w + 2 * rake;
    for (const s of [-1, 1]) {
      const midZ = (s * run) / 2;
      const midY = (Ey + Ry) / 2;
      const nz = s * Math.sin(th),
        ny = Math.cos(th);
      const cz = midZ + nz * (t / 2) - s * Math.cos(th) * 0.06;
      const cy = midY + ny * (t / 2) + Math.sin(th) * 0.06;
      b.add('roof', GEO.box, f.mat(0, cy, cz, xLen, t, L, 0, s * th, 0), roofC);
      roofCollider(game, f, 'z', s, d / 2, wallTop, Ry, w);
      for (let xx = -w / 2 + 0.3; xx <= w / 2 - 0.2; xx += 0.75)
        f.box(b, 'trim', xx, Ey + ov * 0.4 * pitch - 0.05, s * (d / 2 + ov * 0.6), 0.07, 0.09, ov * 0.9, trim, 0, s * th, 0);
    }
    f.box(b, 'roof', 0, Ry + t / Math.cos(th) - 0.02, 0, xLen + 0.04, 0.14, 0.34, new THREE.Color(roofC).multiplyScalar(0.8).getHex());
    f.collider(game, 0, Ry + t / Math.cos(th) - 0.02, 0, w, 0.14, 0.34); // floor pass: solid ridge cap
    ridge = f.p(0, Ry + t + 0.1, 0);
    for (const s of [-1, 1]) {
      f.geo(b, 'siding', GEO.prism, (s * w) / 2, wallTop, 0, d, (d / 2) * pitch, 0.16, gableC, Math.PI / 2);
      gableCollider(game, f, 'x', s, w / 2, wallTop, d, (d / 2) * pitch);
      f.box(b, 'trim', (s * w) / 2 + s * 0.05, wallTop + 0.08, 0, 0.1, 0.16, d + 0.1, trim);
      const face: Face = s < 0 ? 'L' : 'R';
      // attic windows in the side gables (the "half" story)
      win(face, -0.8, wallTop + 1.25, 0.8, 1.1);
      win(face, 0.8, wallTop + 1.25, 0.8, 1.1);
      for (const k of [-1, 1]) f.box(b, 'trim', (s * w) / 2 + s * rake * 0.45, wallTop - 0.1, k * (d / 2 - 0.35), 0.1, 0.8, 0.1, trim, 0, 0, -s * Math.PI * 0.25);
    }
    // front shed dormer
    const dw = Math.min(w * 0.55, 4.6);
    const dz0 = d / 2 - 0.9; // dormer front wall z
    const dFloor = wallTop + (d / 2 - dz0) * pitch - 0.3;
    const dh = 1.7;
    const dDepth = dz0 - 0.2;
    f.box(b, 'siding', 0, dFloor + dh / 2, dz0 - dDepth / 2, dw, dh, dDepth, gableC);
    f.box(b, 'roof', 0, dFloor + dh + 0.1, dz0 - dDepth / 2 + 0.25, dw + 0.5, 0.16, dDepth + 0.7, roofC, 0, 0.12);
    f.collider(game, 0, dFloor + dh / 2 + 0.1, dz0 - dDepth / 2, dw, dh + 0.3, dDepth);
    const nWin = dw > 4 ? 3 : 2;
    for (let i = 0; i < nWin; i++) {
      const u = -dw / 2 + (dw * (i + 0.5)) / nWin;
      const glass = r() < lit ? 'glassLit' : 'glass';
      f.box(b, glass, u, dFloor + dh * 0.52, dz0 + 0.02, 0.8, 0.95, 0.06, 0xa9bfcf);
      f.box(b, 'trim', u, dFloor + dh * 0.52 + 0.55, dz0 + 0.05, 1.05, 0.12, 0.08, trim);
      f.box(b, 'trim', u, dFloor + dh * 0.52 - 0.52, dz0 + 0.06, 1.0, 0.08, 0.14, trim);
    }
  }
  // --- porch
  const porchTop = style === 'bungalow' ? 2.55 : 2.7;
  const pz0 = d / 2;
  const pzc = pz0 + pd / 2;
  const deckCol = pick(r, [0xb4c0cc, 0xffffff, 0xd8d0c0, 0xc0ccc0]);
  f.box(b, 'cedar', px, -0.1, pzc, pw, 0.2, pd, deckCol);
  // skirt (lattice) under the porch
  const skirtH = -yb - 0.2;
  if (skirtH > 0.05) {
    const sy = (yb - 0.2) / 2;
    if (!o.openPorch) f.box(b, 'plain', px, sy, pzc, pw - 0.3, skirtH, pd - 0.3, 0x2b2f2a); // dark interior
    f.box(b, 'lattice', px, sy, pz0 + pd - 0.04, pw - 0.1, skirtH, 0.03, trim);
    for (const s of [-1, 1]) {
      if (o.openPorch === s) continue;
      f.box(b, 'lattice', px + (s * (pw - 0.1)) / 2, sy, pzc, 0.03, skirtH, pd - 0.1, trim);
    }
  }
  // piers + tapered columns + beam
  const pierH = 1.0;
  const pierXs = [px - pw / 2 + 0.32, px + pw / 2 - 0.32];
  if (pw > 6.5) pierXs.push(px + (doorU > px ? -1 : 1) * pw * 0.12);
  for (const cx of pierXs) {
    const cz = pz0 + pd - 0.32;
    f.box(b, 'stone', cx, (yb + pierH) / 2, cz, 0.62, pierH - yb, 0.62, 0xc4bcae);
    f.box(b, 'trim', cx, pierH + 0.05, cz, 0.7, 0.1, 0.7, 0xa39d92);
    f.geo(b, 'trim', GEO.taper, cx, (pierH + porchTop) / 2 + 0.05, cz, 0.44, porchTop - pierH, 0.44, trim);
    f.collider(game, cx, (yb + porchTop) / 2, cz, 0.5, porchTop - yb, 0.5);
  }
  f.box(b, 'trim', px, porchTop + 0.15, pz0 + pd - 0.32, pw + 0.2, 0.3, 0.3, trim);
  // porch roof
  if (style === 'bungalow') {
    // shed roof tucked under the main eave
    const slope = 0.28;
    const len = pd + 0.55;
    const ang = Math.atan(slope);
    b.add('roof', GEO.box, f.mat(px, porchTop + 0.42, pz0 + len / 2 - 0.05, pw + 0.5, 0.16, len / Math.cos(ang), 0, ang, 0), roofC);
    // collider stops at the column line (no overhang) so you can climb a column and mantle onto the roof
    const x0 = px - pw / 2,
      x1 = px + pw / 2;
    const slot = o.porchRoofSlotX;
    const segs: [number, number][] = slot !== undefined && slot > x0 + 0.3 && slot < x1 - 0.3 ? [[x0, slot - 0.16], [slot + 0.16, x1]] : [[x0, x1]];
    const lc = pd - 0.3;
    const yc = porchTop + 0.42 + (len / 2 - 0.05 - lc / 2) * Math.tan(ang);
    for (const [a, c] of segs) f.collider(game, (a + c) / 2, yc, pz0 + lc / 2, c - a, 0.3, lc / Math.cos(ang), 0, ang, 0);
  } else {
    // low front gable over the porch
    const pitch = 0.26;
    const th = Math.atan(pitch);
    const half = pw / 2 + 0.35;
    const baseY = porchTop + 0.3;
    const zl = pd + 0.5;
    for (const s of [-1, 1]) {
      const L = half / Math.cos(th) + 0.1;
      const cx = px + (s * half) / 2;
      const cy = baseY + (half * pitch) / 2 + 0.1;
      b.add('roof', GEO.box, f.mat(cx, cy, pz0 + zl / 2 - 0.1, L, 0.16, zl, 0, 0, -s * th), roofC, { swap: true });
      // collider only over the columns' footprint (no side/front overhang), so a column climb mantles onto it
      const hc = pw / 2;
      const zc = pd - 0.25;
      f.collider(game, px + (s * hc) / 2, baseY + (half - hc / 2) * pitch + 0.1, pz0 + zc / 2, hc / Math.cos(th) + 0.1, 0.25, zc, 0, 0, -s * th);
    }
    f.geo(b, 'siding', GEO.prism, px, baseY, pz0 + pd - 0.25, half * 2 - 0.1, half * pitch - 0.02, 0.14, gableC);
    f.box(b, 'trim', px, baseY + half * pitch * 0.4, pz0 + pd - 0.16, 0.5, 0.35, 0.05, trim);
    for (const k of [-1, 1]) f.box(b, 'trim', px + k * (pw / 2 - 0.1), baseY - 0.05, pz0 + pd + 0.1, 0.1, 0.6, 0.1, trim, 0, Math.PI * 0.25);
  }
  // porch floor collider(s)
  if (o.openPorch) {
    f.collider(game, px, -0.1, pzc, pw, 0.2, pd);
    // lattice walls (front + the closed side) so the hideout has exactly one way in
    if (skirtH > 0.05) {
      f.collider(game, px, (yb - 0.2) / 2, pz0 + pd - 0.04, pw, skirtH, 0.1);
      f.collider(game, px - (o.openPorch * (pw - 0.1)) / 2, (yb - 0.2) / 2, pzc, 0.1, skirtH, pd);
    }
  } else {
    f.collider(game, px, (yb - 0.0) / 2, pzc, pw, -yb, pd);
  }
  // railings (front, both sides of the steps, and porch sides)
  const stairW = 1.7;
  const railSeg = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.3) return;
    const ry = Math.atan2(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2,
      mz = (z0 + z1) / 2;
    f.box(b, 'trim', mx, 0.92, mz, 0.1, 0.08, len, trim, ry);
    f.box(b, 'trim', mx, 0.14, mz, 0.08, 0.06, len, trim, ry);
    const n = Math.floor(len / 0.2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      f.box(b, 'trim', x0 + (x1 - x0) * t, 0.53, z0 + (z1 - z0) * t, 0.045, 0.76, 0.045, trim, ry);
    }
    f.collider(game, mx, 0.5, mz, 0.12, 1.0, len, ry);
  };
  const fz = pz0 + pd - 0.32;
  railSeg(pierXs[0] + 0.3, fz, px - stairW / 2, fz);
  railSeg(px + stairW / 2, fz, pierXs[1] - 0.3, fz);
  for (const s of [-1, 1]) {
    const sxl = s < 0 ? pierXs[0] : pierXs[1];
    railSeg(sxl, pz0 + 0.15, sxl, fz - 0.3);
  }
  // front steps down to the ground: n risers, n-1 treads, a ramp collider along the nosing line
  const run = 0.32;
  let stepFoot = f.p(px, 0, pz0 + pd + 0.3);
  {
    let gl = world.heightAt(stepFoot.x, stepFoot.z) - floorY;
    let n = Math.max(1, Math.ceil(-gl / 0.19));
    for (let it = 0; it < 2; it++) {
      const foot = f.p(px, 0, pz0 + pd + n * run);
      gl = Math.min(-0.05, world.heightAt(foot.x, foot.z) - floorY);
      n = Math.max(1, Math.ceil(-gl / 0.19));
    }
    const rise = -gl;
    const h = rise / n;
    const stepCol = pick(r, [0xe2ddd2, 0xd9c4a6, 0xe8e3d8]);
    const bot = gl - 0.3;
    for (let i = 0; i < n - 1; i++) {
      const top = -(i + 1) * h;
      f.box(b, i === 0 ? 'cedar' : 'concrete', px, (top + bot) / 2, pz0 + pd + run * (i + 0.5), stairW, top - bot, run + 0.02, stepCol);
    }
    // low stepped cheek blocks flanking the top two treads (Craftsman-ish), not full-height walls
    for (let i = 0; i < Math.min(2, n - 1); i++) {
      const top = -(i + 1) * h + 0.32;
      for (const s of [-1, 1]) f.box(b, fMat, px + s * (stairW / 2 + 0.14), (top + bot) / 2, pz0 + pd + run * (i + 0.5), 0.28, top - bot, run + 0.02, fCol);
    }
    const len = Math.hypot(n * run, rise);
    const ang = Math.atan2(rise, n * run);
    f.collider(game, px, -rise / 2 - 0.12 * Math.cos(ang), pz0 + pd + (n * run) / 2 - 0.12 * Math.sin(ang), stairW, 0.24, len + 0.1, 0, ang, 0);
    stepFoot = f.p(px, 0, pz0 + pd + n * run + 0.2);
    stepFoot.y = world.heightAt(stepFoot.x, stepFoot.z);
  }

  b.setUVFrame(null);
  return {
    frame: f,
    floorY,
    wallTop,
    w,
    d,
    stepFoot,
    porch: { center: f.p(px, 0, pzc), w: pw, d: pd, px },
    ridge,
    chimneyTop,
    door: f.p(doorU, 0, d / 2 + 0.3),
    back: -d / 2,
  };
}

/** Pastel Craftsman palette. */
export const SIDING = [
  0xa9c7a1, 0x9fc6e3, 0xf1d98c, 0xf2b9b4, 0xc6b3e3, 0xa9e0c6, 0xf6c49b, 0xaec7ea, 0xeee0bd, 0x9ed7c9, 0xf3a89c, 0xabb5ee, 0x6f9468,
  0x5f7f9d, 0xb85c4e, 0xe8c26a,
];
export const ROOFS = [0x4a4b52, 0x5a4a40, 0x3f5648, 0x55606e, 0x6e4b3b, 0x3d4250, 0x7a6a5a];
