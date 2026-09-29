import * as THREE from 'three';
import { assetUrl } from '../../core/Assets';
import type { Expression } from './types';

/**
 * Canvas-drawn cartoon faces (decal on the front of the head) and shirt prints.
 * Textures/materials are cached and shared between NPCs.
 */

export const FONT = "'NpcLilita', 'Arial Black', 'Trebuchet MS', sans-serif";
let fontPromise: Promise<void> | null = null;

/** Load the cartoon font used by prints and speech bubbles (resolves even on failure). */
export function loadNpcFont(): Promise<void> {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    try {
      if (typeof FontFace === 'undefined') return;
      const ff = new FontFace('NpcLilita', `url(${assetUrl('assets/fonts/LilitaOne-Regular.ttf')})`);
      const loaded = await Promise.race([ff.load(), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
      if (loaded) (document.fonts as any).add(loaded);
    } catch {
      /* fall back to system fonts */
    }
  })();
  return fontPromise;
}

// ------------------------------------------------------------------ face layout
// The face decal is a sphere patch: phi ±FACE_PHI around +Z, theta FACE_T0..FACE_T0+FACE_TL (from the top).
export const FACE_PHI = 1.08;
export const FACE_T0 = 0.62;
export const FACE_TL = 1.63;
const FW = 256;
const FH = 192;
/** canvas y of a polar angle theta */
const ty = (theta: number) => ((theta - FACE_T0) / FACE_TL) * FH;
/** canvas x of an azimuth offset from the front (+ = viewer's right) */
const px = (dphi: number) => FW / 2 + (dphi / (2 * FACE_PHI)) * FW;

const EYE_Y = ty(1.43);
const EYE_DX = px(0.34) - FW / 2;
const BROW_Y = ty(1.2);
const MOUTH_Y = ty(1.93);
const CHEEK_Y = ty(1.72);
const CHEEK_DX = px(0.62) - FW / 2;

export interface FaceStyle {
  brow: number;
  lashes: boolean;
  glasses: boolean;
  mustache: number | null;
}

const INK = '#2a1a14';
const LIP = '#5a2320';

function hex(c: number) {
  return '#' + c.toString(16).padStart(6, '0');
}

function drawEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, e: Expression, side: -1 | 1, lashes: boolean) {
  ctx.save();
  let rx = 16;
  let ry = 20;
  let pr = 10.5;
  let pdy = 1;
  if (e === 'shock') {
    rx = 19;
    ry = 24;
    pr = 6;
    pdy = 0;
  } else if (e === 'aww') {
    rx = 18;
    ry = 22;
    pr = 13.5;
    pdy = 2;
  } else if (e === 'sad') {
    pdy = 5;
  } else if (e === 'happy') {
    ry = 19;
  }
  if (e === 'angry') {
    // narrowed: clip with a slanted lid line (lower toward the nose)
    ctx.beginPath();
    const inner = -side; // toward the nose
    ctx.moveTo(cx - 30, cy + 40);
    ctx.lineTo(cx + 30, cy + 40);
    ctx.lineTo(cx + 30, cy - 8 + inner * 9);
    ctx.lineTo(cx - 30, cy - 8 - inner * 9);
    ctx.closePath();
    ctx.clip();
  }
  // white
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // pupil
  ctx.beginPath();
  ctx.arc(cx + side * -1.5, cy + pdy, pr, 0, Math.PI * 2);
  ctx.fillStyle = '#1b120e';
  ctx.fill();
  // highlights
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - 3.5, cy + pdy - pr * 0.45, Math.max(2.2, pr * 0.36), 0, Math.PI * 2);
  ctx.fill();
  if (e === 'aww') {
    ctx.beginPath();
    ctx.arc(cx + 4, cy + pdy + 4, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (e === 'angry') {
    // lid line
    const inner = -side;
    ctx.beginPath();
    ctx.moveTo(cx - 19, cy - 8 - inner * 9 * (19 / 30));
    ctx.lineTo(cx + 19, cy - 8 + inner * 9 * (19 / 30));
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  if (lashes && e !== 'angry') {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const ox = cx + side * rx * 0.75;
    const oy = cy - ry * 0.62;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + side * 8, oy - 6);
    ctx.moveTo(ox - side * 5, oy - 5);
    ctx.lineTo(ox - side * 1, oy - 12);
    ctx.stroke();
  }
}

function drawBrow(ctx: CanvasRenderingContext2D, cx: number, e: Expression, side: -1 | 1, color: string) {
  // side: -1 = viewer-left eye, +1 = viewer-right eye; "inner" end is toward the center
  const innerX = cx - side * 15;
  const outerX = cx + side * 16;
  let innerY = BROW_Y;
  let outerY = BROW_Y - 2;
  let arch = -5;
  if (e === 'shock') {
    innerY -= 10;
    outerY -= 9;
    arch = -9;
  } else if (e === 'angry') {
    innerY += 11;
    outerY -= 5;
    arch = 1;
  } else if (e === 'sad') {
    innerY -= 9;
    outerY += 5;
    arch = -2;
  } else if (e === 'aww') {
    innerY -= 8;
    outerY -= 1;
    arch = -4;
  } else if (e === 'happy') {
    innerY -= 4;
    outerY -= 4;
    arch = -7;
  }
  ctx.beginPath();
  ctx.moveTo(innerX, innerY);
  ctx.quadraticCurveTo((innerX + outerX) / 2, (innerY + outerY) / 2 + arch, outerX, outerY);
  ctx.lineWidth = 7.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawMouth(ctx: CanvasRenderingContext2D, e: Expression) {
  const cx = FW / 2;
  const y = MOUTH_Y;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (e) {
    case 'happy': {
      ctx.beginPath();
      ctx.moveTo(cx - 25, y - 7);
      ctx.quadraticCurveTo(cx, y - 3, cx + 25, y - 7);
      ctx.quadraticCurveTo(cx + 20, y + 22, cx, y + 23);
      ctx.quadraticCurveTo(cx - 20, y + 22, cx - 25, y - 7);
      ctx.closePath();
      ctx.fillStyle = '#6b1f24';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 26, y - 10, 52, 9);
      ctx.beginPath();
      ctx.ellipse(cx, y + 20, 13, 8, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#e8737a';
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      break;
    }
    case 'shock': {
      ctx.beginPath();
      ctx.ellipse(cx, y + 4, 12, 16, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#4a1418';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      ctx.ellipse(cx, y + 17, 9, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#e8737a';
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.ellipse(cx, y + 4, 12, 16, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'aww': {
      // small open "o" smile with a wobble
      ctx.beginPath();
      ctx.moveTo(cx - 13, y);
      ctx.quadraticCurveTo(cx, y + 17, cx + 13, y);
      ctx.quadraticCurveTo(cx, y + 5, cx - 13, y);
      ctx.closePath();
      ctx.fillStyle = '#6b1f24';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      break;
    }
    case 'angry': {
      // gritted teeth
      const w = 40;
      const h = 15;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, y - 4, w, h, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - w / 2 + 2, y + h / 2 - 4);
      ctx.lineTo(cx + w / 2 - 2, y + h / 2 - 4);
      for (let i = 1; i < 5; i++) {
        const x = cx - w / 2 + (w / 5) * i;
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x, y + h - 5);
      }
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    case 'sad': {
      ctx.beginPath();
      ctx.moveTo(cx - 17, y + 9);
      ctx.quadraticCurveTo(cx, y - 7, cx + 17, y + 9);
      ctx.lineWidth = 5;
      ctx.strokeStyle = LIP;
      ctx.stroke();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.moveTo(cx - 16, y);
      ctx.quadraticCurveTo(cx, y + 10, cx + 16, y);
      ctx.lineWidth = 5;
      ctx.strokeStyle = LIP;
      ctx.stroke();
    }
  }
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fillStyle = '#fffbe0';
  ctx.fill();
}

function drawFace(ctx: CanvasRenderingContext2D, style: FaceStyle, e: Expression, clean: boolean) {
  ctx.clearRect(0, 0, FW, FH);
  const lx = FW / 2 - EYE_DX;
  const rx = FW / 2 + EYE_DX;
  if (e === 'aww' || e === 'happy' || clean) {
    ctx.fillStyle = clean ? 'rgba(255,170,180,0.45)' : 'rgba(255,120,140,0.42)';
    for (const x of [FW / 2 - CHEEK_DX, FW / 2 + CHEEK_DX]) {
      ctx.beginPath();
      ctx.ellipse(x, CHEEK_Y, 15, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drawEye(ctx, lx, EYE_Y, e, -1, style.lashes);
  drawEye(ctx, rx, EYE_Y, e, 1, style.lashes);
  const bc = hex(style.brow);
  drawBrow(ctx, lx, e, -1, bc);
  drawBrow(ctx, rx, e, 1, bc);
  if (style.mustache != null) {
    ctx.fillStyle = hex(style.mustache);
    const my = MOUTH_Y - 12;
    ctx.beginPath();
    ctx.ellipse(FW / 2 - 11, my, 14, 7, -0.25, 0, Math.PI * 2);
    ctx.ellipse(FW / 2 + 11, my, 14, 7, 0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  drawMouth(ctx, e);
  if (e === 'sad') {
    ctx.beginPath();
    const x = rx + 10;
    const y = EYE_Y + 26;
    ctx.moveTo(x, y - 9);
    ctx.quadraticCurveTo(x + 7, y + 2, x, y + 5);
    ctx.quadraticCurveTo(x - 7, y + 2, x, y - 9);
    ctx.fillStyle = 'rgba(120,190,255,0.9)';
    ctx.fill();
  }
  if (style.glasses) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1e1e1e';
    ctx.fillStyle = 'rgba(210,235,255,0.22)';
    for (const x of [lx, rx]) {
      ctx.beginPath();
      ctx.roundRect(x - 23, EYE_Y - 22, 46, 42, 12);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(lx + 23, EYE_Y - 6);
    ctx.quadraticCurveTo(FW / 2, EYE_Y - 13, rx - 23, EYE_Y - 6);
    ctx.stroke();
  }
  if (clean) {
    sparkle(ctx, FW / 2 - 70, EYE_Y - 40, 13);
    sparkle(ctx, FW / 2 + 74, EYE_Y - 30, 10);
    sparkle(ctx, FW / 2 + 62, MOUTH_Y + 10, 12);
    sparkle(ctx, FW / 2 - 58, MOUTH_Y + 16, 8);
    // shine streak
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(FW / 2 + 20, BROW_Y - 30);
    ctx.lineTo(FW / 2 + 42, BROW_Y - 36);
    ctx.stroke();
  }
}

const faceCache = new Map<string, THREE.MeshStandardMaterial>();

export function faceMaterial(style: FaceStyle, e: Expression, clean = false): THREE.MeshStandardMaterial {
  const key = `${style.brow}|${style.lashes ? 1 : 0}|${style.glasses ? 1 : 0}|${style.mustache ?? '-'}|${e}|${clean ? 1 : 0}`;
  let m = faceCache.get(key);
  if (m) return m;
  const canvas = document.createElement('canvas');
  canvas.width = FW;
  canvas.height = FH;
  const ctx = canvas.getContext('2d')!;
  drawFace(ctx, style, e, clean);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.04,
    depthWrite: false,
    roughness: 0.55,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.name = 'npcFace:' + key;
  faceCache.set(key, m);
  return m;
}

// ------------------------------------------------------------------ prints

const printCache = new Map<string, THREE.MeshStandardMaterial>();

function roundRaccoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // ears
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.62, cy - r * 0.78, r * 0.27, 0, Math.PI * 2);
    ctx.fillStyle = '#6f6a66';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.62, cy - r * 0.78, r * 0.15, 0, Math.PI * 2);
    ctx.fillStyle = '#e9e1d6';
    ctx.fill();
  }
  // body (he's a ball)
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
  g.addColorStop(0, '#b4aea6');
  g.addColorStop(1, '#7c7670');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#2a2622';
  ctx.stroke();
  // white brows / muzzle
  ctx.fillStyle = '#f3efe8';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.28, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.36, cy - r * 0.34, r * 0.2, r * 0.09, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // bandit mask
  ctx.fillStyle = '#1d1a18';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.34, cy - r * 0.08, r * 0.3, r * 0.19, 0.25, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.34, cy - r * 0.08, r * 0.3, r * 0.19, -0.25, 0, Math.PI * 2);
  ctx.fill();
  // eyes
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.33, cy - r * 0.09, r * 0.085, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  // nose + smile
  ctx.fillStyle = '#1d1a18';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.17, r * 0.1, r * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.12, cy + r * 0.33);
  ctx.quadraticCurveTo(cx, cy + r * 0.42, cx + r * 0.12, cy + r * 0.33);
  ctx.lineWidth = 3;
  ctx.stroke();
  // tiny hands
  ctx.fillStyle = '#2a2622';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.5, cy + r * 0.8, r * 0.14, r * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPrint(kind: 'jimothy' | 'slopcorp', canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (kind === 'jimothy') {
    const W = canvas.width;
    roundRaccoon(ctx, W / 2, 104, 72);
    ctx.font = `64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText('JIMOTHY', W / 2, 218);
    ctx.fillStyle = '#16304f';
    ctx.fillText('JIMOTHY', W / 2, 218);
  } else {
    const W = canvas.width;
    const H = canvas.height;
    // blobby "logo"
    const g = ctx.createLinearGradient(0, 0, 60, 60);
    g.addColorStop(0, '#b06bff');
    g.addColorStop(1, '#ff5fa2');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(36, H / 2, 26, 22, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(29, H / 2 - 4, 4, 0, Math.PI * 2);
    ctx.arc(44, H / 2 - 4, 4, 0, Math.PI * 2);
    ctx.arc(52, H / 2 - 7, 3, 0, Math.PI * 2); // one eye too many (it's AI)
    ctx.fill();
    ctx.font = `46px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SlopCorp', 70, H / 2 + 2);
    ctx.globalAlpha = 1;
    void W;
  }
}

/** Shirt/vest print decal material ('jimothy' fan shirt, 'slopcorp' vest). */
export function printMaterial(kind: 'jimothy' | 'slopcorp'): THREE.MeshStandardMaterial {
  let m = printCache.get(kind);
  if (m) return m;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = kind === 'jimothy' ? 256 : 96;
  drawPrint(kind, canvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.04,
    depthWrite: false,
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  printCache.set(kind, m);
  // Redraw once the cartoon font is available.
  loadNpcFont().then(() => {
    drawPrint(kind, canvas);
    tex.needsUpdate = true;
  });
  return m;
}
