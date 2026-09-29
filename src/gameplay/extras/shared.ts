import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../core/Game';
import { G, groups } from '../../core/Physics';
import type { CameraRig } from '../../player/CameraRig';

/**
 * Small shared toolbox for the extras (cannons, wheel ride, cats, finale): math, merged vertex-coloured geometry
 * (one shared material → one draw call per merged piece), a canvas sign atlas (one texture/material for every
 * sign), ground queries, camera hand-back and defensive accessors for the optional systems (UI, FX, NPCs).
 */

export const WORLD_ONLY = groups(G.ALL, G.WORLD);
export const DOWN = new THREE.Vector3(0, -1, 0);
export const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------------------------------------ math
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const dampAngle = (a: number, b: number, k: number, dt: number) => a + wrapAngle(b - a) * (1 - Math.exp(-k * dt));
export const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

/** Matrix helpers for building merged geometry. */
export const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
export function TR(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  const sc = Array.isArray(s) ? new THREE.Vector3(s[0], s[1], s[2]) : new THREE.Vector3(s, s, s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, sc);
}
/** Matrix that places a unit-Y-axis primitive (cylinder/box) between two points. */
export function between(a: THREE.Vector3, b: THREE.Vector3, sx = 1, sz = 1) {
  const d = b.clone().sub(a);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(sx, len, sz));
}

// ------------------------------------------------------------------------------------------------ colours
/**
 * Post-processing-safe colour (see src/entities/npc/color.ts): the renderer's saturation boost blackens pixels whose
 * weakest channel is far below the average, so lift weak channels a little.
 */
export function safeColor(c: THREE.ColorRepresentation, out = new THREE.Color()): THREE.Color {
  out.set(c);
  for (let i = 0; i < 2; i++) {
    const floor = ((out.r + out.g + out.b) / 3) * 0.26;
    out.r = Math.max(out.r, floor);
    out.g = Math.max(out.g, floor);
    out.b = Math.max(out.b, floor);
  }
  return out;
}

let paint: THREE.MeshStandardMaterial | null = null;
/** THE shared vertex-colour material for every merged extras mesh. */
export function paintMat(): THREE.MeshStandardMaterial {
  if (!paint) paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.12 });
  return paint;
}

let bulbs: THREE.MeshBasicMaterial | null = null;
/** Shared glowing-bulb material (HDR white × vertex colour → blooms). Brighter at night via `setNight`. */
export function bulbMat(): THREE.MeshBasicMaterial {
  if (!bulbs) {
    bulbs = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    bulbs.color.setRGB(1.1, 1.05, 0.9);
  }
  return bulbs;
}

export interface Part {
  g: THREE.BufferGeometry;
  c: THREE.ColorRepresentation;
  m?: THREE.Matrix4;
  /** Flip winding + normals (inside of tubes). */
  inside?: boolean;
}

/** Merge primitives into one non-indexed position/normal/color geometry (temporary inputs are disposed). */
export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  const col = new THREE.Color();
  for (const p of parts) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    p.g.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (p.m) g.applyMatrix4(p.m);
    if (p.inside) flipGeometry(g);
    safeColor(p.c, col);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    list.push(g);
  }
  const merged = mergeGeometries(list, false) ?? new THREE.BufferGeometry();
  for (const g of list) g.dispose();
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/** Reverse triangle winding and normals of a non-indexed geometry (render the inside of a tube). */
function flipGeometry(g: THREE.BufferGeometry) {
  for (const name of ['position', 'normal']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    for (let i = 0; i + 2 < a.count; i += 3) {
      const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1);
      a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
      a.setXYZ(i + 2, x, y, z);
    }
    if (name === 'normal') for (let i = 0; i < a.count; i++) a.setXYZ(i, -a.getX(i), -a.getY(i), -a.getZ(i));
    a.needsUpdate = true;
  }
}

/** A mesh from merged parts with the shared paint material. */
export function paintMesh(parts: Part[], shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(mergeParts(parts), paintMat());
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------------------------------------ sign atlas
type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  draw: Draw;
}

// two 512-px signs side by side per row (+ gutters); WebGL2 is fine with the non-power-of-two width
const ATLAS_W = 1032;
const ATLAS_H = 1024;
export const FONT_DISPLAY = `'Luckiest Guy', 'Lilita One', 'Arial Black', Impact, sans-serif`;
export const FONT_BOLD = `'Lilita One', 'Arial Black', sans-serif`;
export const FONT_BODY = `'Nunito', 'Segoe UI', system-ui, sans-serif`;

/**
 * Every extras sign lives in ONE canvas texture (one material, one texture upload). Regions are allocated in rows;
 * everything is redrawn once the web fonts finish loading. Glows a little at night (`setNight`).
 */
export class SignAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshStandardMaterial;
  private regions: Region[] = [];
  private cx = 0;
  private cy = 0;
  private rowH = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W;
    this.canvas.height = ATLAS_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      emissiveMap: this.texture,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    try {
      const fonts = (document as any).fonts;
      fonts?.ready?.then(() => this.redraw());
      fonts?.addEventListener?.('loadingdone', () => this.redraw());
    } catch {
      /* no font API */
    }
  }

  /** Allocate a region (pixels) and draw into it. Returns the region index. */
  add(w: number, h: number, draw: Draw): number {
    if (this.cx + w > ATLAS_W) {
      this.cx = 0;
      this.cy += this.rowH + 4;
      this.rowH = 0;
    }
    if (this.cy + h > ATLAS_H) console.warn('[extras] sign atlas full');
    const r: Region = { x: this.cx, y: this.cy, w, h, draw };
    this.cx += w + 4;
    this.rowH = Math.max(this.rowH, h);
    this.regions.push(r);
    this.paint(r);
    this.texture.needsUpdate = true;
    return this.regions.length - 1;
  }

  private paint(r: Region) {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(r.x, r.y, r.w, r.h);
    c.clip();
    c.clearRect(r.x, r.y, r.w, r.h);
    c.translate(r.x, r.y);
    try {
      r.draw(c, r.w, r.h);
    } catch (err) {
      console.warn('[extras] sign draw failed', err);
    }
    c.restore();
  }

  redraw() {
    for (const r of this.regions) this.paint(r);
    this.texture.needsUpdate = true;
  }

  /** A plane (width × height metres, facing +Z) showing region `i`. */
  quad(i: number, w: number, h: number): THREE.Mesh {
    const r = this.regions[i];
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) {
      const u = uv.getX(k);
      const v = uv.getY(k);
      uv.setXY(k, (r.x + u * r.w) / ATLAS_W, 1 - (r.y + (1 - v) * r.h) / ATLAS_H);
    }
    const m = new THREE.Mesh(g, this.material);
    m.castShadow = false;
    m.receiveShadow = true;
    return m;
  }

  setNight(f: number) {
    const v = 0.05 + f * 0.55;
    if (Math.abs(this.material.emissiveIntensity - v) > 0.01) this.material.emissiveIntensity = v;
  }
}

/** Rounded-rectangle path. */
export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Centered text shrunk to fit `maxW`. */
export function fitText(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  px: number,
  font: string,
  o: { fill?: string; stroke?: string; strokeW?: number } = {},
) {
  let size = px;
  c.font = `${size}px ${font}`;
  while (size > 8 && c.measureText(text).width > maxW) {
    size -= 2;
    c.font = `${size}px ${font}`;
  }
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (o.stroke) {
    c.lineJoin = 'round';
    c.lineWidth = o.strokeW ?? size * 0.16;
    c.strokeStyle = o.stroke;
    c.strokeText(text, x, y);
  }
  c.fillStyle = o.fill ?? '#fff';
  c.fillText(text, x, y);
}

/** A standard chunky sign: coloured board, border, title + subtitle. */
export function drawBoard(title: string, sub: string, bg: string, border: string, titleColor = '#fff', subColor = '#ffd23f'): Draw {
  return (c, w, h) => {
    c.fillStyle = border;
    roundRect(c, 2, 2, w - 4, h - 4, h * 0.14);
    c.fill();
    c.fillStyle = bg;
    roundRect(c, 12, 12, w - 24, h - 24, h * 0.1);
    c.fill();
    fitText(c, title, w / 2, h * (sub ? 0.41 : 0.5), w * 0.78, h * 0.32, FONT_DISPLAY, { fill: titleColor, stroke: '#1d1a26', strokeW: h * 0.045 });
    if (sub) fitText(c, sub, w / 2, h * 0.73, w * 0.78, h * 0.15, FONT_BOLD, { fill: subColor });
  };
}

// ------------------------------------------------------------------------------------------------ world queries
const _v = new THREE.Vector3();

/**
 * Top surface (static world) under (x, z), casting down from `fromY`. Returns null if the ray starts inside a
 * solid or finds nothing within `maxDown`.
 */
export function surfaceAt(game: Game, x: number, z: number, fromY: number, maxDown = 40): number | null {
  const hit = game.physics.raycast(_v.set(x, fromY, z), DOWN, maxDown, WORLD_ONLY);
  if (!hit || hit.distance < 0.01 || hit.normal.y < 0.55) return null;
  return hit.point.y;
}

/** Ground height with fallbacks (static surface → terrain). */
export function groundY(game: Game, x: number, z: number, fromY = 60): number {
  const s = surfaceAt(game, x, z, fromY, fromY + 60);
  if (s != null) return s;
  return game.get<any>('world')?.heightAt?.(x, z) ?? 0;
}

/** A POI (clone) or the fallback. */
export function poi(game: Game, name: string, fallback: THREE.Vector3): THREE.Vector3 {
  const p = game.get<any>('world')?.poi?.get(name) as THREE.Vector3 | undefined;
  return p && Number.isFinite(p.x + p.y + p.z) ? p.clone() : fallback.clone();
}

// ------------------------------------------------------------------------------------------------ systems (optional)
export const uiOf = (game: Game): any => game.get<any>('ui');
export const playerOf = (game: Game): any => game.get<any>('player');
export const rigOf = (game: Game) => game.get<CameraRig>('camera');

/** FX system emit (no-op if missing). */
export function fx(game: Game, kind: string, pos: THREE.Vector3, opts: Record<string, any> = {}) {
  try {
    game.get<any>('fx')?.emit?.(kind, pos, opts);
  } catch {
    /* optional */
  }
}

export function toast(game: Game, title: string, text?: string, icon = 'star') {
  const ui = uiOf(game);
  if (ui?.toast) ui.toast(title, text, icon);
  else game.events.emit('toast', { title, text, icon });
}

export function celebrate(game: Game, word: string, sub?: string, color?: string) {
  try {
    uiOf(game)?.celebrate?.(word, sub, color);
  } catch {
    /* optional */
  }
}

export function prompt(game: Game, text: string | null, ttl = 0.3) {
  try {
    uiOf(game)?.setPrompt?.(text, ttl);
  } catch {
    /* optional */
  }
}

/** Speech bubble anchored to an object / position (UI speech layer). */
export function speech(
  game: Game,
  target: { object?: THREE.Object3D; position?: THREE.Vector3; entity?: any; offsetY?: number },
  text: string,
  secs = 2.5,
  key?: unknown,
  style?: string,
) {
  game.events.emit('speech', { ...target, text, duration: secs, key, style });
}

/** True when a dialog / menu / other cutscene owns the player or the camera. */
export function sceneBusy(game: Game): boolean {
  const ui = uiOf(game);
  if (game.state !== 'playing') return true;
  if (ui && (ui.mode !== 'play' || ui.dialog?.open || ui.menuOpen)) return true;
  if (rigOf(game)?.override) return true;
  if (game.get<any>('heartQuests')?.ctx?.inCutscene) return true;
  return false;
}

/**
 * Give the camera back to the orbit rig without a jump in direction (yaw/pitch taken from where the camera is now).
 * Only clears the override if it is still ours.
 */
export function releaseCamera(game: Game, fn: unknown) {
  const rig = rigOf(game);
  if (!rig || rig.override !== fn) return;
  rig.override = null;
  const target = playerOf(game)?.cameraTarget as THREE.Vector3 | undefined;
  if (!target) return;
  const dir = _v.copy(game.camera.position).sub(target);
  const len = dir.length();
  if (len > 0.01) {
    dir.divideScalar(len);
    rig.yaw = Math.atan2(dir.x, dir.z);
    rig.pitch = clamp(-Math.asin(clamp(dir.y, -1, 1)), -1.35, 0.75);
  }
  rig.pivot.copy(target);
}

/** Keep a desired camera point in front of walls between it and the subject. */
export function clearView(game: Game, subject: THREE.Vector3, want: THREE.Vector3, minDist = 1.2) {
  const dir = _v.copy(want).sub(subject);
  const len = dir.length();
  if (len < 0.3) return want;
  const hit = game.physics.sphereCast(subject, dir, 0.2, len, groups(G.ALL, G.WORLD | G.VEHICLE), undefined, (c) => !game.physics.isThin(c));
  if (hit) want.copy(subject).addScaledVector(dir.normalize(), Math.max(minDist, hit.distance - 0.1));
  return want;
}

/** Never let a camera sink below the ground. */
export function aboveGround(game: Game, p: THREE.Vector3, margin = 0.4) {
  const g = game.get<any>('world')?.heightAt?.(p.x, p.z);
  if (typeof g === 'number' && p.y < g + margin) p.y = g + margin;
  return p;
}
