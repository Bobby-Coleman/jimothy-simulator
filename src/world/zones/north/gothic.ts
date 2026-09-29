/**
 * Collegiate-gothic brick halls for the University of Washing: brick walls on a stone base, limestone trim,
 * buttresses, tall pointed-arch windows, steep slate gable roofs, a stone entrance portal, optional central tower.
 */
import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World } from '../../World';
import { Batch, Frame, GEO, footprint, rng, roofCollider, gableCollider } from './kit';

export interface HallOpts {
  x: number;
  z: number;
  /** Facade faces local +Z rotated by this yaw. */
  face: number;
  /** Facade length (local x) and depth (local z). */
  w: number;
  d: number;
  /** Wall height above the floor. */
  h: number;
  floors: number;
  seed: number;
  brick?: number;
  tower?: boolean;
  /** Bay spacing (buttress to buttress). */
  bay?: number;
  /** Extra floor height (e.g. keep a terrace flush). */
  floorY?: number;
}

export interface HallInfo {
  frame: Frame;
  floorY: number;
  top: number;
  ridge: THREE.Vector3;
  towerTop?: THREE.Vector3;
  entrance: THREE.Vector3;
  /** Ground point at the foot of the entrance steps. */
  stepsEnd: THREE.Vector3;
  plaque: { pos: THREE.Vector3; rotY: number };
}

const STONE = 0xe6dcc6;
const SLATE = 0x56616b;

/** Pointed-arch window (glass + limestone surround) on a wall plane in frame-local coords. */
function lancet(f: Frame, b: Batch, lx: number, y: number, lz: number, ry: number, w: number, h: number, lit: boolean) {
  const glass = lit ? 'glassLit' : 'glass';
  const col = 0x93a9bd;
  const arch = w * 0.55;
  // rectangular part + pointed top (a squashed prism)
  f.box(b, glass, lx, y + (h - arch) / 2, lz, w, h - arch, 0.08, col, ry);
  const dir = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry));
  f.geo(b, glass, GEO.prism, lx, y + h - arch, lz, w, arch, 0.08, col, ry);
  // surround: jambs, sill, hood mould (prism outline), mullion + transom
  const o = 0.07;
  const jx = Math.cos(ry),
    jz = -Math.sin(ry);
  for (const s of [-1, 1]) f.box(b, 'concrete', lx + jx * s * (w / 2 + 0.1), y + (h - arch) / 2, lz + jz * s * (w / 2 + 0.1), 0.2, h - arch, 0.18, STONE, ry);
  f.box(b, 'concrete', lx + dir.x * o, y - 0.08, lz + dir.z * o, w + 0.5, 0.16, 0.3, STONE, ry);
  f.geo(b, 'concrete', GEO.prism, lx - dir.x * 0.06, y + h - arch - 0.02, lz - dir.z * 0.06, w + 0.44, arch + 0.28, 0.14, STONE, ry);
  f.box(b, 'concrete', lx + dir.x * 0.05, y + (h - arch) * 0.55, lz + dir.z * 0.05, w, 0.08, 0.1, STONE, ry);
  f.box(b, 'concrete', lx + dir.x * 0.05, y + (h - arch) / 2, lz + dir.z * 0.05, 0.08, h - arch, 0.1, STONE, ry);
}

export function gothicHall(game: Game, world: World, b: Batch, o: HallOpts): HallInfo {
  const r = rng(o.seed);
  const { w, d, h } = o;
  const brick = o.brick ?? 0xc9785a;
  const fp = footprint(world, o.x, o.z, w + 2, d + 3, o.face, 1.5);
  const floorY = o.floorY ?? fp.max + 0.35;
  const f = new Frame(o.x, floorY, o.z, o.face);
  const yb = fp.min - floorY - 0.4;
  b.setUVFrame(f.m);

  // base + walls + trim bands
  f.box(b, 'stone', 0, (yb + 0.9) / 2, 0, w + 0.3, 0.9 - yb, d + 0.3, 0xbfb6a4);
  f.box(b, 'brick', 0, h / 2 + 0.4, 0, w, h - 0.8, d, brick);
  f.box(b, 'concrete', 0, 0.95, 0, w + 0.36, 0.22, d + 0.36, STONE);
  const floorH = (h - 1) / o.floors;
  for (let i = 1; i < o.floors; i++) f.box(b, 'concrete', 0, 0.9 + floorH * i, 0, w + 0.14, 0.16, d + 0.14, STONE);
  f.box(b, 'concrete', 0, h - 0.1, 0, w + 0.5, 0.35, d + 0.5, STONE); // cornice
  f.collider(game, 0, (h + yb) / 2, 0, w, h - yb, d);

  // buttresses + lancet windows in each bay on the long facades; smaller windows on the ends
  const bay = o.bay ?? 4.2;
  const nb = Math.max(2, Math.round(w / bay));
  const bw = w / nb;
  for (const s of [-1, 1]) {
    const lz = (s * d) / 2;
    const ry = s > 0 ? 0 : Math.PI;
    for (let i = 0; i <= nb; i++) {
      const lx = -w / 2 + i * bw;
      f.box(b, 'brick', lx, (h - 1.2) / 2 + 0.2, lz + s * 0.35, 0.7, h - 1.6, 0.7, brick);
      f.geo(b, 'concrete', GEO.wedge, lx, h - 1.5, lz + s * 0.35, 0.78, 0.9, 0.78, STONE, ry);
      f.box(b, 'concrete', lx, 0.6, lz + s * 0.4, 0.86, 1.2, 0.86, STONE);
    }
    for (let i = 0; i < nb; i++) {
      const lx = -w / 2 + (i + 0.5) * bw;
      const isDoor = s > 0 && i === Math.floor(nb / 2) && !o.tower;
      for (let fl = 0; fl < o.floors; fl++) {
        if (isDoor && fl === 0) continue;
        const wh = Math.min(floorH * 0.72, 4.5);
        lancet(f, b, lx, 0.9 + floorH * fl + floorH * 0.14, lz + s * 0.02, ry, Math.min(bw * 0.42, 1.5), wh, r() < 0.4);
      }
    }
  }
  for (const s of [-1, 1]) {
    const lx = (s * w) / 2;
    const ry = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    const n = Math.max(1, Math.round(d / 5));
    for (let i = 0; i < n; i++) {
      const lz = -d / 2 + (i + 0.5) * (d / n);
      for (let fl = 0; fl < o.floors; fl++) lancet(f, b, lx + s * 0.02, 0.9 + floorH * fl + floorH * 0.18, lz, ry, 1.1, Math.min(floorH * 0.62, 3.8), r() < 0.35);
    }
  }

  // steep slate roof (ridge along local x) + stone-coped brick gable ends
  const pitch = 1.0;
  const th = Math.atan(pitch);
  const ov = 0.35;
  const run = d / 2 + ov;
  const Ey = h - ov * pitch;
  const Ry = h + (d / 2) * pitch;
  const L = Math.hypot(run, Ry - Ey) + 0.15;
  const t = 0.25;
  for (const s of [-1, 1]) {
    const midZ = (s * run) / 2;
    const cz = midZ + s * Math.sin(th) * (t / 2) - s * Math.cos(th) * 0.07;
    const cy = (Ey + Ry) / 2 + Math.cos(th) * (t / 2) + Math.sin(th) * 0.07;
    b.add('roof', GEO.box, f.mat(0, cy, cz, w + 0.2, t, L, 0, s * th, 0), SLATE);
    roofCollider(game, f, 'z', s, d / 2, h, Ry, w);
  }
  f.box(b, 'metal', 0, Ry + t * 1.2, 0, w + 0.3, 0.16, 0.3, 0x6f7b72);
  for (const s of [-1, 1]) {
    f.geo(b, 'brick', GEO.prism, (s * w) / 2, h - 0.05, 0, d + 0.2, (d / 2 + 0.1) * pitch, 0.5, brick, Math.PI / 2);
    gableCollider(game, f, 'x', s, w / 2, h - 0.05, d, (d / 2) * pitch, 0.5);
    // coping along the gable edges
    for (const k of [-1, 1]) {
      const len = Math.hypot(d / 2, (d / 2) * pitch) + 0.2;
      f.box(b, 'concrete', (s * w) / 2, h + (d / 4) * pitch + 0.15, (k * d) / 4, 0.62, 0.22, len, STONE, 0, k * th, 0);
    }
    // corner pinnacles
    for (const k of [-1, 1]) {
      f.box(b, 'concrete', (s * w) / 2, h + 0.6, (k * d) / 2, 0.6, 1.2, 0.6, STONE);
      f.geo(b, 'concrete', GEO.cone4, (s * w) / 2, h + 1.9, (k * d) / 2, 0.55, 1.4, 0.55, STONE);
    }
    f.geo(b, 'concrete', GEO.cone4, (s * w) / 2, Ry + 0.9, 0, 0.5, 1.4, 0.5, STONE);
  }
  // dormers on the front slope
  const nd = Math.max(1, Math.floor(nb / 2));
  for (let i = 0; i < nd; i++) {
    const lx = -w / 2 + ((i + 0.5) * w) / nd;
    if (o.tower && Math.abs(lx) < 3) continue;
    const dz = d / 2 - 1.2;
    const dy = h + (d / 2 - dz) * pitch - 0.2;
    f.box(b, 'brick', lx, dy + 0.8, dz - 0.6, 1.8, 1.8, 1.6, brick);
    f.geo(b, 'roof', GEO.prism, lx, dy + 1.7, dz - 0.6, 2.2, 1.0, 2.0, SLATE);
    f.box(b, r() < 0.5 ? 'glassLit' : 'glass', lx, dy + 0.85, dz + 0.22, 0.8, 1.0, 0.06, 0x93a9bd);
  }
  let ridge = f.p(0, Ry + t + 0.1, 0);

  // entrance portal (pointed stone arch, oak doors, steps)
  const doorW = 2.6,
    doorH = 3.4;
  const pz = o.tower ? d / 2 + 1.75 : d / 2 + 0.55;
  f.box(b, 'concrete', 0, 2.3, pz, doorW + 1.6, 4.6, 1.1, STONE);
  f.geo(b, 'concrete', GEO.prism, 0, 4.6, pz, doorW + 1.6, 1.6, 1.1, STONE);
  f.box(b, 'paint', 0, 0.95 + (doorH - 0.6) / 2, pz + 0.3, doorW, doorH - 0.6, 0.6, 0x4a2f1f);
  f.geo(b, 'paint', GEO.prism, 0, 0.95 + doorH - 0.6, pz + 0.3, doorW, 1.0, 0.6, 0x4a2f1f);
  f.box(b, 'metal', 0, 2.2, pz + 0.62, 0.06, 2.4, 0.04, 0x1d1d1d);
  f.collider(game, 0, 2.6, pz, doorW + 1.6, 5.2, 1.1);
  // steps to the door. The flight is sized so it actually meets the ground at its foot (halls sit on hillsides, so
  // the ground keeps falling away downhill — sizing it from the ground next to the door left the bottom floating),
  // every step reaches down to the ground under it, and every step is solid (the old single ramp was narrower than
  // the widening steps, so their sides had no collision).
  const stepW = doorW + 2.4;
  const stepRun = 0.36;
  const z0 = pz + 0.6; // front edge of the landing in front of the door
  const groundUnder = (lz: number, halfW: number) => {
    let m = Infinity;
    for (const lx of [-halfW, 0, halfW]) {
      const p = f.p(lx, 0, lz);
      m = Math.min(m, world.heightAt(p.x, p.z) - floorY);
    }
    return m;
  };
  let nSteps = 1;
  let footG = groundUnder(z0 + stepRun, stepW / 2);
  for (let it = 0; it < 6; it++) {
    nSteps = Math.max(1, Math.ceil((0.95 - footG) / 0.19));
    const g2 = groundUnder(z0 + nSteps * stepRun + 0.2, stepW / 2 + 0.3);
    if (Math.abs(g2 - footG) < 0.02) break;
    footG = g2;
  }
  const rise = (0.95 - footG) / (nSteps + 1);
  for (let i = 0; i < nSteps; i++) {
    const top = 0.95 - (i + 1) * rise;
    const zc = z0 + (i + 0.5) * stepRun;
    const sw = stepW + Math.min(i, 6) * 0.2; // a gentle flare at the top only
    const gy = Math.min(top - 0.1, groundUnder(zc, sw / 2)) - 0.4;
    f.box(b, 'concrete', 0, (top + gy) / 2, zc, sw, top - gy, stepRun + 0.02, 0xd8d0bf);
    f.collider(game, 0, (top + gy) / 2, zc, sw, top - gy, stepRun + 0.02);
  }
  {
    // smooth ramp through the step noses (walking up a staircase of 0.19 m boxes as a ball is bumpy)
    const topY = 0.95 - rise;
    const lastTop = 0.95 - nSteps * rise;
    const len = (nSteps - 1) * stepRun;
    if (len > 0.1) {
      const ang = Math.atan2(topY - lastTop, len);
      f.collider(game, 0, (topY + lastTop) / 2 - 0.12, z0 + stepRun / 2 + len / 2, stepW, 0.24, Math.hypot(len, topY - lastTop) + 0.2, 0, ang, 0);
    }
  }
  // central tower
  let towerTop: THREE.Vector3 | undefined;
  if (o.tower) {
    const tw = 7,
      td = 7;
    const th2 = h + 10;
    f.box(b, 'brick', 0, (th2 + 0.4) / 2, d / 2 - td / 2 + 1.2, tw, th2 - 0.4, td, brick);
    f.box(b, 'concrete', 0, th2, d / 2 - td / 2 + 1.2, tw + 0.6, 0.5, td + 0.6, STONE);
    // rose window + big lancet
    f.geo(b, 'concrete', GEO.cyl, 0, h + 3.2, d / 2 + 1.25, 4.0, 0.25, 4.0, STONE, 0, Math.PI / 2);
    f.geo(b, 'glassLit', GEO.cyl, 0, h + 3.2, d / 2 + 1.34, 3.4, 0.12, 3.4, 0x8a78c9, 0, Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      f.box(b, 'concrete', 0, h + 3.2, d / 2 + 1.44, 0.14, 3.4, 0.08, STONE, 0, 0, a);
    }
    lancet(f, b, 0, 6.2, d / 2 + 1.22, 0, 2.2, h - 7.5, true);
    // crenellated parapet + corner pinnacles
    for (let i = -3; i <= 3; i++) {
      if (i % 2) continue;
      for (const s of [-1, 1]) {
        f.box(b, 'concrete', i, th2 + 0.6, d / 2 - td / 2 + 1.2 + s * (td / 2), 0.9, 0.8, 0.5, STONE);
        f.box(b, 'concrete', s * (tw / 2), th2 + 0.6, d / 2 - td / 2 + 1.2 + i, 0.5, 0.8, 0.9, STONE);
      }
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        f.box(b, 'concrete', sx * (tw / 2), th2 + 1.2, d / 2 - td / 2 + 1.2 + sz * (td / 2), 0.9, 2.4, 0.9, STONE);
        f.geo(b, 'concrete', GEO.cone4, sx * (tw / 2), th2 + 3.6, d / 2 - td / 2 + 1.2 + sz * (td / 2), 0.85, 2.6, 0.85, STONE);
      }
    f.collider(game, 0, (th2 + 0.4) / 2, d / 2 - td / 2 + 1.2, tw, th2 - 0.4, td);
    towerTop = f.p(0, th2 + 0.25, d / 2 - td / 2 + 1.2);
    ridge = towerTop.clone();
  }

  b.setUVFrame(null);
  return {
    frame: f,
    floorY,
    top: h,
    ridge,
    towerTop,
    entrance: f.p(0, 0, pz + 2.4),
    stepsEnd: f.p(0, footG, z0 + nSteps * stepRun + 0.3),
    plaque: { pos: o.tower ? f.p(0, h + 0.4, d / 2 + 1.23) : f.p(0, h - 1.25, d / 2 + 0.07), rotY: o.face },
  };
}
