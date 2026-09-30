import * as THREE from 'three';
import { drawJimothy, mixColor, type JimothyArtOpts } from '../../../../fx/jimothyArt';

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

/**
 * The real Jimothy for seals, cards and signs: the shared side-profile doodle (fx/jimothyArt: domed back, head
 * carried low, long legs mid-stride), fitted in the circle (cx, cy, r). `cap` puts a ball cap of that colour on him.
 */
export function drawJimothyFigure(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, opts: JimothyArtOpts & { cap?: string } = {}) {
  drawJimothy(ctx, cx, cy, r, opts);
  if (opts.cap) ballCap(ctx, cx, cy, r, opts.cap, opts.facing ?? 1);
}

/**
 * A ball cap on his head, in the doodle's figure units (nose at x = +1, y down): his head is carried low and tipped
 * forward, so the cap sits on his crown tipped with it, the bill out over his face and his ear poking out behind.
 */
function ballCap(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, facing: 1 | -1) {
  const lw = Math.max(1.4, r * 0.045) / r;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(r * facing, r);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#161616';
  ctx.lineWidth = lw;
  ctx.save();
  ctx.translate(0.72, -0.585);
  ctx.rotate(0.45);
  // the bill
  ctx.fillStyle = mixColor(color, '#000000', 0.25);
  ctx.beginPath();
  ctx.ellipse(0.26, 0.02, 0.2, 0.048, 0.04, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // the crown, with a seam and a button
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.22, 0.2, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = mixColor(color, '#ffffff', 0.3);
  ctx.lineWidth = lw * 0.6;
  ctx.beginPath();
  ctx.moveTo(-0.015, -0.19);
  ctx.quadraticCurveTo(-0.085, -0.1, -0.075, -0.012);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#161616';
  ctx.lineWidth = lw * 0.7;
  ctx.beginPath();
  ctx.ellipse(0, -0.205, 0.04, 0.024, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const m = ctx.getTransform();
  ctx.restore();
  // his ear pokes out through the back of the cap (pale rim, dark inside)
  ctx.lineWidth = lw;
  ctx.fillStyle = '#f4efe6';
  ctx.beginPath();
  ctx.ellipse(0.615, -0.765, 0.075, 0.105, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#45434a';
  ctx.beginPath();
  ctx.ellipse(0.624, -0.752, 0.045, 0.068, -0.45, 0, Math.PI * 2);
  ctx.fill();
  // the team letter on the front panel (drawn unscaled: tiny fonts under a big scale render badly)
  const p = m.transformPoint(new DOMPoint(0.09, -0.09));
  const mirrored = m.a * m.d - m.b * m.c < 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(p.x, p.y);
  ctx.rotate(mirrored ? Math.atan2(-m.b, -m.a) : Math.atan2(m.b, m.a));
  ctx.font = `900 ${Math.max(6, r * 0.13)}px ${SIGN_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('B', 0, 0);
  ctx.restore();
}
