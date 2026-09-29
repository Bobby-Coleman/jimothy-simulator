import * as THREE from 'three';

/** Chunky display font stack used for all canvas-drawn signs (no external font needed). */
export const SIGN_FONT = '"Arial Black", "Segoe UI Black", Impact, system-ui, sans-serif';

/** Build a CanvasTexture by drawing into a fresh canvas. */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Draw text that shrinks to fit `maxW`. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  size: number,
  opts: { weight?: string; font?: string; color?: string; stroke?: string; strokeW?: number; align?: CanvasTextAlign } = {},
) {
  let s = Math.round(size);
  const font = opts.font ?? SIGN_FONT;
  const weight = opts.weight ?? '900';
  ctx.font = `${weight} ${s}px ${font}`;
  // ink box (display fonts overhang their advance) + outline stroke must fit maxW
  const width = () => {
    const m = ctx.measureText(text);
    return Math.max(m.width, (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? 0)) + (opts.stroke ? (opts.strokeW ?? Math.max(2, s * 0.12)) : 0);
  };
  while (s > 8 && width() > maxW) {
    s -= s > 40 ? 2 : 1;
    ctx.font = `${weight} ${s}px ${font}`;
  }
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  if (opts.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = opts.strokeW ?? Math.max(2, s * 0.12);
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.color ?? '#fff';
  ctx.fillText(text, x, y);
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

/** A simple two-line banner texture: big title + optional subtitle on a coloured field with a border. */
export function bannerTexture(
  title: string,
  sub: string | undefined,
  colors: { bg: string; bg2?: string; fg: string; border?: string; sub?: string },
  w = 1024,
  h = 256,
) {
  return canvasTexture(w, h, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, colors.bg);
    g.addColorStop(1, colors.bg2 ?? colors.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (colors.border) {
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = h * 0.06;
      ctx.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
    }
    if (sub) {
      fitText(ctx, title, w / 2, h * 0.42, w * 0.9, h * 0.42, { color: colors.fg, stroke: 'rgba(0,0,0,0.35)' });
      fitText(ctx, sub, w / 2, h * 0.77, w * 0.86, h * 0.17, { color: colors.sub ?? colors.fg, weight: '800' });
    } else {
      fitText(ctx, title, w / 2, h * 0.52, w * 0.9, h * 0.55, { color: colors.fg, stroke: 'rgba(0,0,0,0.35)' });
    }
  });
}

/** Draw a tiny round raccoon face (used on seals, cards and signs). */
export function drawRaccoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // ears
  ctx.fillStyle = '#6d6259';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.62, cy - r * 0.72, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e9e1d6';
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.62, cy - r * 0.72, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6d6259';
  }
  // round body/head
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r * 1.05);
  g.addColorStop(0, '#9b9087');
  g.addColorStop(1, '#5d534b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // white brows / muzzle
  ctx.fillStyle = '#efe9e0';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.35, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.32, r * 0.62, r * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // bandit mask
  ctx.fillStyle = '#1d1a18';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.33, cy - r * 0.05, r * 0.3, r * 0.19, -0.25, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.33, cy - r * 0.05, r * 0.3, r * 0.19, 0.25, 0, Math.PI * 2);
  ctx.fill();
  // eyes
  ctx.fillStyle = '#fff';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.3, cy - r * 0.07, r * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  // nose
  ctx.fillStyle = '#1d1a18';
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.2, r * 0.11, r * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
}
