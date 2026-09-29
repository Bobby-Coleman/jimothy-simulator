import * as THREE from 'three';
import type { Game } from '../../../../core/Game';
import { assetUrl } from '../../../../core/Assets';
import { cached, canvasTexture } from './textures';
import { onFrame } from './util';
import { tagSign } from '../../../signRegistry';

// ------------------------------------------------------------------------------------------- fonts

export const FONT_TITLE = `'JS-Luckiest', 'Arial Black', Impact, sans-serif`;
export const FONT_SIGN = `'JS-Lilita', 'Arial Black', Impact, sans-serif`;
export const FONT_BODY = `'JS-Nunito', 'Trebuchet MS', Arial, sans-serif`;
export const FONT_SERIF = `Georgia, 'Times New Roman', serif`;

/** Load our OFL/Apache fonts under private family names (safe to call many times). */
export function loadFonts(): Promise<void> {
  return cached('fonts', () => {
    const list: [string, string, string?][] = [
      ['JS-Luckiest', 'assets/fonts/LuckiestGuy-Regular.ttf'],
      ['JS-Lilita', 'assets/fonts/LilitaOne-Regular.ttf'],
      ['JS-Nunito', 'assets/fonts/Nunito-VariableFont_wght.ttf', '200 1000'],
    ];
    const jobs = list.map(async ([family, path, weight]) => {
      try {
        const f = new FontFace(family, `url(${assetUrl(path)})`, weight ? { weight } : {});
        const loaded = await f.load();
        (document.fonts as any).add(loaded);
      } catch {
        /* fall back to system fonts */
      }
    });
    const timeout = new Promise<void>((r) => setTimeout(r, 4000));
    return Promise.race([Promise.all(jobs).then(() => undefined), timeout]);
  });
}

// ------------------------------------------------------------------------------------------- atlas

export interface AtlasRect {
  page: AtlasPage;
  x: number;
  y: number;
  w: number;
  h: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export class AtlasPage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  x = 0;
  y = 0;
  rowH = 0;
  /** Plain (unlit) sign material. */
  readonly mat: THREE.MeshStandardMaterial;
  /** Backlit/neon sign material that glows at night (emissive = texture). */
  readonly glowMat: THREE.MeshStandardMaterial;
  constructor(public size: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = canvasTexture(this.canvas, { repeat: false });
    this.texture.generateMipmaps = true;
    this.mat = new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.55, metalness: 0.05 });
    this.glowMat = new THREE.MeshStandardMaterial({
      map: this.texture,
      emissiveMap: this.texture,
      emissive: 0xffffff,
      emissiveIntensity: 0.0,
      roughness: 0.45,
    });
  }
}

/**
 * A shelf-packed canvas atlas for all the little signs, so hundreds of signs cost a couple of draw calls.
 * Draw with `atlas.draw(w, h, (ctx, w, h) => …)`; build geometry with `atlas.quad(rect, width, height)`.
 */
export class SignAtlas {
  readonly pages: AtlasPage[] = [];
  pad = 6;
  constructor(public size = 2048) {}

  private alloc(w: number, h: number): AtlasRect {
    w = Math.ceil(w);
    h = Math.ceil(h);
    let page = this.pages[this.pages.length - 1];
    if (!page) this.pages.push((page = new AtlasPage(this.size)));
    const p = this.pad;
    if (page.x + w + p > page.size) {
      page.x = 0;
      page.y += page.rowH + p;
      page.rowH = 0;
    }
    if (page.y + h + p > page.size) {
      this.pages.push((page = new AtlasPage(this.size)));
    }
    const x = page.x + p / 2;
    const y = page.y + p / 2;
    page.x += w + p;
    page.rowH = Math.max(page.rowH, h);
    const S = page.size;
    // inset UVs by half a pixel to avoid bleeding
    return { page, x, y, w, h, u0: (x + 0.5) / S, u1: (x + w - 0.5) / S, v0: 1 - (y + h - 0.5) / S, v1: 1 - (y + 0.5) / S };
  }

  /** Allocate a w×h pixel region and draw into it (ctx is translated & clipped to the region). */
  draw(w: number, h: number, fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): AtlasRect {
    const r = this.alloc(w, h);
    const ctx = r.page.ctx;
    ctx.save();
    // extend the edge colour into the padding a little
    ctx.translate(r.x, r.y);
    ctx.beginPath();
    ctx.rect(0, 0, r.w, r.h);
    ctx.clip();
    try {
      fn(ctx, r.w, r.h);
    } catch (err) {
      console.error('[atlas] draw failed', err);
    }
    ctx.restore();
    r.page.texture.needsUpdate = true;
    return r;
  }

  /** A plane (facing +Z, centred) of width×height meters mapped to `r`. */
  quad(r: AtlasRect, width: number, height: number): THREE.BufferGeometry {
    const g = new THREE.PlaneGeometry(width, height);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v);
    }
    return tagSign(g, 'atlas.quad', width, height, r.w / r.h);
  }

  /** Box whose ±Z faces show the atlas region (sides use the region's edge). */
  slab(r: AtlasRect, width: number, height: number, depth: number, bothSides = true): THREE.BufferGeometry {
    const g = new THREE.BoxGeometry(width, height, depth);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const nz = nor.getZ(i);
      // (BoxGeometry lays out the back face so text reads correctly from behind.)
      if (Math.abs(nz) < 0.5) {
        // edges: sample a thin strip at the left border
        uv.setXY(i, r.u0 + 0.002, r.v0 + (r.v1 - r.v0) * v);
        continue;
      }
      if (nz < -0.5 && !bothSides) {
        uv.setXY(i, r.u0 + 0.002, r.v0 + 0.002);
        continue;
      }
      uv.setXY(i, r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v);
    }
    return tagSign(g, 'atlas.slab', width, height, r.w / r.h, 16);
  }
}

/** The one atlas shared by all central zones (signs, ads, plaques). Glow pages brighten at night. */
export function sharedAtlas(game: Game): SignAtlas {
  return cached('atlas:shared', () => {
    const atlas = new SignAtlas(2048);
    onFrame(game, (_g, _dt, n) => {
      for (const p of atlas.pages) p.glowMat.emissiveIntensity = 0.04 + n * 1.25;
    });
    return atlas;
  });
}

/**
 * Largest [width, height] (meters) with the atlas rect's aspect that fits in maxW × maxH —
 * use it for a sign face so its text is never stretched.
 */
export function fitRect(r: { w: number; h: number }, maxW: number, maxH: number): [number, number] {
  const a = r.w / r.h;
  return maxW / maxH > a ? [maxH * a, maxH] : [maxW, maxW / a];
}

// ------------------------------------------------------------------------------------------- drawing helpers

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Rendered width of `text` in the current font: the larger of the advance and the glyphs' ink box. */
export function inkWidth(ctx: CanvasRenderingContext2D, text: string) {
  const m = ctx.measureText(text);
  return Math.max(m.width, (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? 0));
}

/** Fit text into maxWidth by shrinking the font size. Returns the used size. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  size: number,
  font: string,
  opts: { fill?: string; stroke?: string; strokeW?: number; shadow?: string; align?: CanvasTextAlign; weight?: string } = {},
) {
  let s = Math.round(size);
  ctx.font = `${opts.weight ?? ''} ${s}px ${font}`;
  // measure the ink (display fonts overhang their advance) plus the outline stroke / drop shadow
  const extra = (px: number) => (opts.stroke ? (opts.strokeW ?? px * 0.18) : 0) + (opts.shadow ? px * 0.06 : 0);
  while (inkWidth(ctx, text) + extra(s) > maxW && s > 8) {
    s -= s > 40 ? 2 : 1;
    ctx.font = `${opts.weight ?? ''} ${s}px ${font}`;
  }
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  if (opts.shadow) {
    ctx.fillStyle = opts.shadow;
    ctx.fillText(text, x + s * 0.06, y + s * 0.08);
  }
  if (opts.stroke) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.strokeW ?? s * 0.18;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.fill ?? '#fff';
  ctx.fillText(text, x, y);
  return s;
}

/** Multi-line centred text block. */
export function textLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  cx: number,
  cy: number,
  maxW: number,
  size: number,
  font: string,
  fill: string,
  lineH = 1.18,
  opts: { stroke?: string; weight?: string } = {},
) {
  const total = lines.length * size * lineH;
  let y = cy - total / 2 + (size * lineH) / 2;
  for (const l of lines) {
    fitText(ctx, l, cx, y, maxW, size, font, { fill, stroke: opts.stroke, weight: opts.weight });
    y += size * lineH;
  }
}

/** Common shop sign: painted board with border, big name, optional small subtitle. */
export function drawBoardSign(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  o: { text: string; sub?: string; bg: string; fg: string; border?: string; font?: string; accent?: string; icon?: (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => void },
) {
  ctx.fillStyle = o.border ?? '#1d1d1d';
  roundRect(ctx, 0, 0, w, h, h * 0.12);
  ctx.fill();
  ctx.fillStyle = o.bg;
  roundRect(ctx, h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14, h * 0.09);
  ctx.fill();
  if (o.accent) {
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = h * 0.03;
    roundRect(ctx, h * 0.13, h * 0.13, w - h * 0.26, h - h * 0.26, h * 0.07);
    ctx.stroke();
  }
  let x0 = w / 2;
  let maxW = w - h * 0.5;
  if (o.icon) {
    o.icon(ctx, h * 0.62, h / 2, h * 0.36);
    x0 = w / 2 + h * 0.4;
    maxW = w - h * 1.4;
  }
  if (o.sub) {
    fitText(ctx, o.text, x0, h * 0.42, maxW, h * 0.46, o.font ?? FONT_SIGN, { fill: o.fg, shadow: 'rgba(0,0,0,0.35)' });
    fitText(ctx, o.sub, x0, h * 0.77, maxW, h * 0.17, FONT_BODY, { fill: o.fg, weight: '800' });
  } else {
    fitText(ctx, o.text, x0, h * 0.53, maxW, h * 0.58, o.font ?? FONT_SIGN, { fill: o.fg, shadow: 'rgba(0,0,0,0.35)' });
  }
}

/** Four-point sparkle star. */
export function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color = '#fff') {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.12, y - r * 0.12, x + r, y);
  ctx.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.12, y + r * 0.12, x - r, y);
  ctx.quadraticCurveTo(x - r * 0.12, y - r * 0.12, x, y - r);
  ctx.fill();
}

/**
 * The canonical round raccoon doodle (used on the mural, tattoo flash, flags, ads…).
 * (x, y) = centre of the ball, r = ball radius.
 */
export function drawRoundRaccoon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  o: { outline?: string; body?: string; mask?: string; smile?: boolean; sunglasses?: boolean; flat?: boolean } = {},
) {
  const body = o.body ?? '#8e8b88';
  const mask = o.mask ?? '#1b1b1f';
  const line = o.outline ?? '#161616';
  const lw = Math.max(2, r * 0.05);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // tail (ringed) behind, peeking out to the right
  ctx.save();
  ctx.translate(x + r * 0.78, y + r * 0.35);
  ctx.rotate(-0.5);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? mask : '#b9b3ab';
    ctx.beginPath();
    ctx.ellipse(r * 0.18 * i, -r * 0.03 * i * i * 0.3, r * 0.2, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // ears
  for (const s of [-1, 1]) {
    ctx.fillStyle = body;
    ctx.strokeStyle = line;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.ellipse(x + s * r * 0.55, y - r * 0.78, r * 0.2, r * 0.22, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f2ece2';
    ctx.beginPath();
    ctx.ellipse(x + s * r * 0.55, y - r * 0.78, r * 0.1, r * 0.12, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // ball body
  if (o.flat) ctx.fillStyle = body;
  else {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
    g.addColorStop(0, '#c9c4bd');
    g.addColorStop(0.55, body);
    g.addColorStop(1, '#55504c');
    ctx.fillStyle = g;
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = lw * 1.4;
  ctx.strokeStyle = line;
  ctx.stroke();
  // fluffy fur tufts on the outline
  ctx.fillStyle = body;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    if (a > Math.PI * 1.15 && a < Math.PI * 1.85) continue;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.99, y + Math.sin(a) * r * 0.99, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  // white brows + muzzle
  ctx.fillStyle = '#f4efe6';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.28, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + s * r * 0.34, y - r * 0.4, r * 0.24, r * 0.1, s * -0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  // bandit mask
  ctx.fillStyle = mask;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.86, y - r * 0.2);
  ctx.quadraticCurveTo(x - r * 0.45, y - r * 0.38, x, y - r * 0.12);
  ctx.quadraticCurveTo(x + r * 0.45, y - r * 0.38, x + r * 0.86, y - r * 0.2);
  ctx.quadraticCurveTo(x + r * 0.7, y + r * 0.12, x + r * 0.28, y + r * 0.06);
  ctx.quadraticCurveTo(x, y + r * 0.02, x - r * 0.28, y + r * 0.06);
  ctx.quadraticCurveTo(x - r * 0.7, y + r * 0.12, x - r * 0.86, y - r * 0.2);
  ctx.fill();
  if (o.sunglasses) {
    ctx.fillStyle = '#111';
    for (const s of [-1, 1]) {
      roundRect(ctx, x + s * r * 0.36 - r * 0.2, y - r * 0.25, r * 0.4, r * 0.24, r * 0.08);
      ctx.fill();
    }
    ctx.fillRect(x - r * 0.18, y - r * 0.2, r * 0.36, r * 0.05);
  } else {
    // eyes with shine
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#0a0a0c';
      ctx.beginPath();
      ctx.arc(x + s * r * 0.34, y - r * 0.12, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x + s * r * 0.34 - r * 0.04, y - r * 0.16, r * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // nose + smile
  ctx.fillStyle = '#1a1414';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.17, r * 0.09, r * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  if (o.smile !== false) {
    ctx.strokeStyle = '#1a1414';
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(x - r * 0.07, y + r * 0.26, r * 0.07, 0.1, Math.PI - 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.07, y + r * 0.26, r * 0.07, 0.3, Math.PI - 0.1);
    ctx.stroke();
  }
  // tiny hands
  ctx.fillStyle = '#2a2624';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + s * r * 0.3, y + r * 0.78, r * 0.13, r * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
