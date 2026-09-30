import { assetUrl } from '../../core/Assets';
import { drawJimothy } from '../../fx/jimothyArt';

/**
 * Canvas art for the slop content. The AI images are glossy, over-saturated and wrong (an AI's attempt at Jimothy:
 * a giraffe neck, a long ringed tail, six legs, three eyes, six fingers, garbled text); the "human made" reveals are
 * warm paintings of the real, round Jimothy.
 */

let fontsP: Promise<void> | null = null;
/** Load the project's display fonts for canvas text (never blocks more than ~1.5 s). */
export function loadSlopFonts(): Promise<void> {
  if (!fontsP) {
    const load = (async () => {
      if (typeof FontFace === 'undefined') return;
      const list: [string, string, FontFaceDescriptors?][] = [
        ['Lilita One', 'assets/fonts/LilitaOne-Regular.ttf'],
        ['Luckiest Guy', 'assets/fonts/LuckiestGuy-Regular.ttf'],
        ['Nunito', 'assets/fonts/Nunito-VariableFont_wght.ttf', { weight: '200 1000' }],
      ];
      await Promise.all(
        list.map(async ([fam, url, desc]) => {
          try {
            if ((document.fonts as any).check?.(`20px "${fam}"`) && [...(document.fonts as any)].some((f: FontFace) => f.family.replace(/"/g, '') === fam && f.status === 'loaded')) return;
            const ff = new FontFace(fam, `url(${assetUrl(url)})`, desc);
            await ff.load();
            (document.fonts as any).add(ff);
          } catch {
            /* system fonts it is */
          }
        }),
      );
    })();
    fontsP = Promise.race([load, new Promise<void>((r) => setTimeout(r, 1500))]);
  }
  return fontsP;
}

const TAU = Math.PI * 2;
type Ctx = CanvasRenderingContext2D;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
}

// ------------------------------------------------------------------ Jimothys

/**
 * The real Jimothy as a painting (the "human made" reveals): the shared doodle (fx/jimothyArt), then worked over
 * with brush strokes in its own colours, laid back and down like his fur, with a warm brown line. Fits the circle
 * (x, y, r) like the doodle does.
 */
function paintedJimothy(ctx: Ctx, x: number, y: number, r: number, rand: () => number, facing: 1 | -1 = 1) {
  const S = Math.ceil(r * 2.5);
  const c = S / 2;
  const off = document.createElement('canvas');
  off.width = off.height = S;
  const o = off.getContext('2d', { willReadFrequently: true })!;
  drawJimothy(o, c, c, r, { outline: '#3b2a1f', facing });
  const px = o.getImageData(0, 0, S, S).data;
  o.globalCompositeOperation = 'source-atop';
  o.lineCap = 'round';
  // keep his eye (and its glint) crisp
  const ex = c + facing * 0.82 * r;
  const ey = c - 0.33 * r;
  const n = Math.round(2600 * (r / 130) ** 2);
  for (let i = 0; i < n; i++) {
    const sx = c + (rand() * 2 - 1) * r * 1.05;
    const sy = c + (rand() * 2 - 1) * r;
    const k = ((sy | 0) * S + (sx | 0)) * 4;
    if (px[k + 3] < 250 || Math.hypot(sx - ex, sy - ey) < r * 0.08) continue;
    const lum = (px[k] + px[k + 1] + px[k + 2]) / 765;
    // a touch lighter or darker, and warmer, like mixed oil paint
    const v = 0.84 + rand() * 0.32;
    const warm = lum > 0.2 && lum < 0.85 ? 10 : 3;
    const col = [px[k] * v + warm, px[k + 1] * v + warm * 0.4, px[k + 2] * v - warm * 0.3].map((q) => Math.max(0, Math.min(255, q | 0)));
    o.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.4 + rand() * 0.35})`;
    o.lineWidth = r * (0.016 + rand() * 0.024) * (lum < 0.2 || lum > 0.85 ? 0.7 : 1);
    const len = r * (0.045 + rand() * 0.075);
    const a = (facing === 1 ? Math.PI * 0.86 : Math.PI * 0.14) + (rand() - 0.5) * 0.7;
    const dx = Math.cos(a) * len;
    const dy = Math.sin(a) * len;
    o.beginPath();
    o.moveTo(sx, sy);
    o.quadraticCurveTo(sx + dx * 0.5 - dy * 0.25, sy + dy * 0.5 + dx * 0.25 * facing, sx + dx, sy + dy);
    o.stroke();
  }
  // a little light on the top of his back, shadow under the belly (dry-brushed)
  for (let i = 0; i < 70; i++) {
    const top = i < 40;
    const t = rand();
    const sx = c + facing * (-0.55 + t * 1.1) * r;
    const sy = top ? c - (0.8 - Math.abs(t - 0.5) * 0.5) * r + rand() * r * 0.12 : c + (0.2 + rand() * 0.14) * r;
    o.strokeStyle = top ? `rgba(255,248,232,${0.12 + rand() * 0.12})` : `rgba(40,30,24,${0.1 + rand() * 0.12})`;
    o.lineWidth = r * (0.03 + rand() * 0.03);
    o.beginPath();
    o.moveTo(sx, sy);
    o.lineTo(sx - facing * r * (0.08 + rand() * 0.1), sy + r * 0.03);
    o.stroke();
  }
  ctx.drawImage(off, x - c, y - c);
}

export interface SlopJimothyOpts {
  /** 1 = facing right (default), -1 = facing left. */
  facing?: 1 | -1;
  /** Holding a phone up in the six-fingered paw (a selfie). */
  phone?: boolean;
  /** Eyes (default 3). */
  eyes?: number;
  /** Fingers on the raised paw (default 6). */
  fingers?: number;
}

/** Where the slop Jimothy's head and raised paw ended up (canvas units), for hats, spells and props. */
export interface SlopJimothyInfo {
  head: { x: number; y: number; r: number };
  paw: { x: number; y: number };
}

// the slop figure's design units (y down, facing right) and the fit that puts it in the circle (x, y, r)
const SLOP_K = 0.79;
const SLOP_OX = 0.06;
const SLOP_OY = 0.285;
const SLOP_HEAD = { x: 0.56, y: -1.1, rx: 0.35, ry: 0.315 };
const SLOP_PAW = { x: 1.0, y: -0.04 };

/**
 * An AI's attempt at the real Jimothy (the "slop" style). It kept his domed back, his long legs and his mask, then
 * got the rest wrong: a giraffe neck (he has none) holding his head up high and turned to face us, a long ringed
 * tail (his is a puff), six legs, three eyes, a melting mask, a spare ear and a six-fingered paw, all rendered
 * over-smooth, glossy and lavender. Fits the circle (x, y, r) like drawJimothy (the tail and ears reach a bit past).
 */
export function drawSlopJimothy(ctx: Ctx, x: number, y: number, r: number, opts: SlopJimothyOpts = {}): SlopJimothyInfo {
  const f = opts.facing ?? 1;
  const u = r * SLOP_K;
  const lw = Math.max(1.5, r * 0.034) / u;
  const ink = '#2a1245';
  const fur = '#a7a2c8';
  const furDark = '#5a5480';
  const shine = '#f3f0ff';
  const pale = '#f6f2ff';
  const mask = '#1a0f2e';
  const paw = '#170c28';

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(u * f, u);
  ctx.translate(SLOP_OX, SLOP_OY);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const outline = (p: Path2D, width = lw) => {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width;
    ctx.stroke(p);
  };

  // --- the tail it gave him: long, ringed and curling (his real one is a short puff)
  const bez = (t: number, a: number[], b: number[], c: number[], d: number[]) => {
    const m = 1 - t;
    return [m * m * m * a[0] + 3 * m * m * t * b[0] + 3 * m * t * t * c[0] + t * t * t * d[0], m * m * m * a[1] + 3 * m * m * t * b[1] + 3 * m * t * t * c[1] + t * t * t * d[1]];
  };
  const T0 = [-0.6, -0.12];
  const T1 = [-1.04, -0.08];
  const T2 = [-1.24, -0.58];
  const T3 = [-0.97, -0.98];
  const beads: [number, number, number, number][] = [];
  for (let i = 0; i <= 36; i++) {
    const t = i / 36;
    const [bx, by] = bez(t, T0, T1, T2, T3);
    beads.push([bx, by, 0.14 - t * 0.06, Math.min(6, Math.floor(t * 7))]);
  }
  ctx.fillStyle = ink;
  for (const [bx, by, br] of beads) {
    ctx.beginPath();
    ctx.arc(bx, by, br + lw * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = beads.length - 1; i >= 0; i--) {
    const [bx, by, br, band] = beads[i];
    ctx.fillStyle = band % 2 ? '#2d2548' : '#d9d4f2';
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- six legs (it counted wrong): smooth tubes, knees, flat dark paws; far ones darker. The body hides their tops.
  const leg = (pts: number[][], width: number, far: boolean) => {
    const p = new Path2D();
    p.moveTo(pts[0][0], pts[0][1]);
    p.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
    const a = pts[0];
    const b = pts[2];
    const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
    g.addColorStop(0, far ? furDark : fur);
    g.addColorStop(0.55, far ? '#433c68' : '#6f689a');
    g.addColorStop(1, paw);
    ctx.strokeStyle = ink;
    ctx.lineWidth = width + lw * 2;
    ctx.stroke(p);
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.stroke(p);
  };
  const foot = (fx: number, fy: number) => {
    const p = new Path2D();
    p.ellipse(fx + 0.045, fy, 0.095, 0.048, 0, 0, Math.PI * 2);
    ctx.fillStyle = paw;
    ctx.fill(p);
    outline(p, lw * 0.8);
  };
  const LEGS: [number[][], boolean][] = [
    [[[-0.5, 0.2], [-0.8, 0.52], [-0.94, 0.93]], true],
    [[[-0.1, 0.3], [-0.12, 0.64], [-0.24, 0.94]], true],
    [[[0.3, 0.26], [0.5, 0.56], [0.6, 0.93]], true],
    [[[-0.38, 0.26], [-0.58, 0.6], [-0.6, 0.955]], false],
    [[[0.04, 0.32], [0.14, 0.66], [0.1, 0.965]], false],
  ];
  for (const [pts, far] of LEGS) {
    leg(pts, far ? 0.13 : 0.155, far);
    foot(pts[2][0], pts[2][1]);
  }
  // the near front leg, raised to show off the paw (it comes out from behind the chest)
  const P = SLOP_PAW;
  leg([[0.4, 0.26], [0.84, 0.34], [P.x - 0.01, P.y + 0.05]], 0.15, false);

  // --- the body: his dome, but airbrushed smooth
  const body = new Path2D();
  body.moveTo(0.56, 0.25);
  body.bezierCurveTo(0.66, 0.02, 0.6, -0.3, 0.42, -0.45);
  body.bezierCurveTo(0.22, -0.62, -0.1, -0.66, -0.35, -0.56);
  body.bezierCurveTo(-0.62, -0.45, -0.78, -0.18, -0.74, 0.08);
  body.bezierCurveTo(-0.7, 0.32, -0.48, 0.43, -0.2, 0.43);
  body.bezierCurveTo(0.1, 0.44, 0.4, 0.42, 0.56, 0.25);
  body.closePath();
  const bg = ctx.createRadialGradient(-0.12, -0.42, 0.05, -0.05, -0.1, 0.95);
  bg.addColorStop(0, shine);
  bg.addColorStop(0.38, fur);
  bg.addColorStop(1, furDark);
  ctx.fillStyle = bg;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  // gloss: a big specular highlight and an iridescent rim
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(-0.22, -0.43, 0.3, 0.085, -0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(-0.3, -0.44, 0.1, 0.035, -0.25, 0, Math.PI * 2);
  ctx.fill();
  const rim = ctx.createLinearGradient(-0.8, -0.6, 0.6, 0.45);
  rim.addColorStop(0, 'rgba(255,110,235,0.8)');
  rim.addColorStop(0.5, 'rgba(120,255,255,0.15)');
  rim.addColorStop(1, 'rgba(255,225,90,0.75)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 0.1;
  ctx.stroke(body);
  ctx.restore();
  outline(body);

  // --- the neck he doesn't have: up, forward and back again, to a head that turned round to face the camera
  const neck = new Path2D();
  neck.moveTo(0.14, -0.52);
  neck.bezierCurveTo(0.36, -0.68, 0.26, -0.92, 0.36, -1.06);
  neck.lineTo(0.72, -1.02);
  neck.bezierCurveTo(0.64, -0.8, 0.74, -0.5, 0.6, -0.1);
  neck.bezierCurveTo(0.5, -0.2, 0.3, -0.38, 0.14, -0.52);
  neck.closePath();
  const ng = ctx.createLinearGradient(0.25, -0.5, 0.75, -0.6);
  ng.addColorStop(0, furDark);
  ng.addColorStop(0.45, fur);
  ng.addColorStop(1, '#dcd7f5');
  ctx.fillStyle = ng;
  ctx.fill(neck);
  ctx.save();
  ctx.clip(neck);
  ctx.strokeStyle = 'rgba(246,242,255,0.8)';
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(0.66, -0.98);
  ctx.bezierCurveTo(0.6, -0.8, 0.7, -0.5, 0.58, -0.16);
  ctx.stroke();
  ctx.restore();
  // its outline, except where it grows out of the body
  ctx.save();
  const outside = new Path2D();
  outside.rect(-3, -3, 6, 6);
  outside.addPath(body);
  ctx.clip(outside, 'evenodd');
  outline(neck);
  ctx.restore();

  // --- the head: ears (one spare), white brows, the mask melting, three eyes
  const H = SLOP_HEAD;
  const ear = (ex: number, ey: number, er: number) => {
    const p = new Path2D();
    p.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fillStyle = pale;
    ctx.fill(p);
    outline(p);
    ctx.fillStyle = '#3d3560';
    ctx.beginPath();
    ctx.arc(ex, ey + er * 0.12, er * 0.56, 0, Math.PI * 2);
    ctx.fill();
  };
  ear(H.x - 0.25, H.y - 0.24, 0.11);
  ear(H.x + 0.25, H.y - 0.24, 0.11);
  ear(H.x + 0.03, H.y - 0.33, 0.09);
  const head = new Path2D();
  head.ellipse(H.x, H.y, H.rx, H.ry, 0, 0, Math.PI * 2);
  const hg = ctx.createRadialGradient(H.x - 0.11, H.y - 0.15, 0.02, H.x, H.y, 0.4);
  hg.addColorStop(0, shine);
  hg.addColorStop(0.5, fur);
  hg.addColorStop(1, furDark);
  ctx.fillStyle = hg;
  ctx.fill(head);
  ctx.save();
  ctx.clip(head);
  // pale cheeks, white brows
  ctx.fillStyle = pale;
  ctx.beginPath();
  ctx.ellipse(H.x, H.y + 0.23, 0.3, 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(H.x + s * 0.14, H.y - 0.14, 0.13, 0.045, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  // muzzle and nose
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(H.x, H.y + 0.16, 0.13, 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  // the mask, melting: a band across the eyes, running down the cheeks in glossy drips
  ctx.fillStyle = mask;
  ctx.beginPath();
  ctx.moveTo(H.x - 0.36, H.y - 0.09);
  ctx.quadraticCurveTo(H.x, H.y - 0.14, H.x + 0.36, H.y - 0.09);
  ctx.lineTo(H.x + 0.36, H.y + 0.05);
  ctx.quadraticCurveTo(H.x + 0.15, H.y + 0.07, H.x + 0.08, H.y + 0.04);
  ctx.quadraticCurveTo(H.x, H.y + 0.02, H.x - 0.08, H.y + 0.04);
  ctx.quadraticCurveTo(H.x - 0.15, H.y + 0.07, H.x - 0.36, H.y + 0.05);
  ctx.closePath();
  ctx.fill();
  const drips: [number, number, number][] = [
    [-0.26, 0.18, 0.036],
    [-0.16, 0.085, 0.028],
    [0.22, 0.13, 0.034],
  ];
  for (const [dx, len, dw] of drips) {
    const top = H.y + 0.04;
    ctx.fillStyle = mask;
    ctx.beginPath();
    ctx.moveTo(H.x + dx - dw * 1.4, top - 0.01);
    ctx.quadraticCurveTo(H.x + dx - dw, top + 0.02, H.x + dx - dw, top + len);
    ctx.arc(H.x + dx, top + len, dw, Math.PI, 0, true);
    ctx.quadraticCurveTo(H.x + dx + dw, top + 0.02, H.x + dx + dw * 1.4, top - 0.01);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(H.x + dx - dw * 0.35, top + len - dw * 0.1, dw * 0.25, dw * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  outline(head);
  ctx.fillStyle = mask;
  ctx.beginPath();
  ctx.ellipse(H.x, H.y + 0.105, 0.055, 0.037, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(H.x - 0.02, H.y + 0.094, 0.016, 0.01, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = mask;
  ctx.lineWidth = lw * 0.75;
  ctx.beginPath();
  ctx.moveTo(H.x - 0.065, H.y + 0.19);
  ctx.quadraticCurveTo(H.x, H.y + 0.235, H.x + 0.065, H.y + 0.19);
  ctx.stroke();
  // three eyes, no two the same size
  const eye = (ex: number, ey: number, er: number, iris: string) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(ex + er * 0.12, ey + er * 0.1, er * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex - er * 0.2, ey - er * 0.25, er * 0.28, 0, Math.PI * 2);
    ctx.fill();
  };
  eye(H.x - 0.14, H.y - 0.025, 0.072, '#120a1e');
  eye(H.x + 0.155, H.y - 0.03, 0.056, '#120a1e');
  if ((opts.eyes ?? 3) >= 3) eye(H.x + 0.005, H.y - 0.215, 0.052, '#ff2bd6');
  // gloss on the head too
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(H.x - 0.16, H.y - 0.22, 0.08, 0.028, -0.45, 0, Math.PI * 2);
  ctx.fill();

  // --- the raised paw: six fingers (optionally holding up a phone for a selfie)
  if (opts.phone) {
    ctx.save();
    ctx.translate(P.x + 0.02, P.y - 0.16);
    ctx.rotate(0.12);
    ctx.fillStyle = '#10131a';
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw * 0.8;
    ctx.beginPath();
    ctx.roundRect(-0.08, -0.15, 0.16, 0.29, 0.026);
    ctx.fill();
    ctx.stroke();
    const sg = ctx.createLinearGradient(0, -0.13, 0, 0.13);
    sg.addColorStop(0, '#9ffcff');
    sg.addColorStop(1, '#ff7df0');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.roundRect(-0.062, -0.13, 0.124, 0.245, 0.016);
    ctx.fill();
    ctx.restore();
  }
  const palm = new Path2D();
  palm.ellipse(P.x, P.y, 0.075, 0.065, 0, 0, Math.PI * 2);
  ctx.fillStyle = paw;
  ctx.fill(palm);
  const fingers = opts.fingers ?? 6;
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? paw : ink;
    ctx.lineWidth = pass ? 0.03 : 0.03 + lw * 1.4;
    for (let i = 0; i < fingers; i++) {
      const a = -Math.PI / 2 + (i - (fingers - 1) / 2) * 0.3;
      const len = 0.11 + (i % 2) * 0.028;
      ctx.beginPath();
      ctx.moveTo(P.x + Math.cos(a) * 0.04, P.y + Math.sin(a) * 0.04);
      ctx.lineTo(P.x + Math.cos(a) * (0.04 + len), P.y + Math.sin(a) * (0.04 + len));
      ctx.stroke();
    }
    if (!pass) outline(palm);
  }
  ctx.fillStyle = paw;
  ctx.fill(palm);
  ctx.restore();

  return slopJimothyLayout(x, y, r, f);
}

/** Where drawSlopJimothy(x, y, r) puts his head and raised paw, without drawing (to paint spells behind him). */
export function slopJimothyLayout(x: number, y: number, r: number, facing: 1 | -1 = 1): SlopJimothyInfo {
  const u = r * SLOP_K;
  const at = (px: number, py: number) => ({ x: x + facing * u * (px + SLOP_OX), y: y + u * (py + SLOP_OY) });
  const hc = at(SLOP_HEAD.x, SLOP_HEAD.y);
  return { head: { x: hc.x, y: hc.y, r: u * SLOP_HEAD.rx }, paw: at(SLOP_PAW.x, SLOP_PAW.y) };
}

function sparkle(ctx: Ctx, x: number, y: number, s: number, color = '#ffffff') {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
}

function lightning(ctx: Ctx, x: number, y: number, len: number, rand: () => number) {
  ctx.strokeStyle = '#fffb9e';
  ctx.shadowColor = '#7df9ff';
  ctx.shadowBlur = 18;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let px = x;
  let py = y;
  for (let i = 0; i < 7; i++) {
    px += (rand() - 0.5) * len * 0.35;
    py -= len / 7;
    ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function glossyText(ctx: Ctx, text: string, x: number, y: number, size: number, maxW: number) {
  let s = size;
  ctx.font = `${s}px "Luckiest Guy", Impact, sans-serif`;
  while (ctx.measureText(text).width > maxW && s > 10) {
    s -= 2;
    ctx.font = `${s}px "Luckiest Guy", Impact, sans-serif`;
  }
  const g = ctx.createLinearGradient(0, y - s, 0, y + s * 0.2);
  g.addColorStop(0, '#fff8b0');
  g.addColorStop(0.45, '#ffb13b');
  g.addColorStop(0.5, '#ff5fb8');
  g.addColorStop(1, '#8a3cff');
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#2a0f45';
  ctx.lineWidth = s * 0.14;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
}

/** Set the largest `font(size)` (≤ size) at which `text` fits `maxW`; returns that size. */
function fitFont(ctx: Ctx, text: string, maxW: number, size: number, font: (s: number) => string) {
  let s = Math.round(size);
  ctx.font = font(s);
  while (s > 8 && ctx.measureText(text).width > maxW) {
    s -= s > 40 ? 2 : 1;
    ctx.font = font(s);
  }
  return s;
}

/** A starry wizard hat, its brim centred on (x, y), sized for a head of radius hr. */
function wizardHat(ctx: Ctx, x: number, y: number, hr: number) {
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#3b1e8c';
  ctx.strokeStyle = '#2a0f45';
  ctx.lineWidth = Math.max(2, hr * 0.07);
  ctx.beginPath();
  ctx.moveTo(x - hr * 1.05, y);
  ctx.quadraticCurveTo(x - hr * 0.3, y - hr * 1.3, x + hr * 0.55, y - hr * 2.35);
  ctx.quadraticCurveTo(x + hr * 0.2, y - hr * 1.2, x + hr * 1.05, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ellipse(ctx, x, y, hr * 1.4, hr * 0.26);
  ctx.fill();
  ctx.stroke();
  sparkle(ctx, x - hr * 0.15, y - hr * 0.75, hr * 0.26, '#ffe36e');
  sparkle(ctx, x + hr * 0.3, y - hr * 1.45, hr * 0.17, '#ffe36e');
}

// ------------------------------------------------------------------ billboard

/** The AI billboard: "Jimothy Casting Spells" energy, maximum gloss. */
export function drawSlopBillboard(ctx: Ctx, w: number, h: number) {
  const r = rng(77);
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2a0a5e');
  sky.addColorStop(0.45, '#c2338f');
  sky.addColorStop(0.75, '#ff9a3c');
  sky.addColorStop(1, '#ffe07a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // sunburst
  ctx.save();
  ctx.translate(w * 0.36, h * 0.55);
  for (let i = 0; i < 28; i++) {
    ctx.rotate(TAU / 28);
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(255,220,120,0.12)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, -40);
    ctx.lineTo(w, 40);
    ctx.fill();
  }
  ctx.restore();
  // lens flare
  const lf = ctx.createRadialGradient(w * 0.7, h * 0.22, 2, w * 0.7, h * 0.22, h * 0.35);
  lf.addColorStop(0, 'rgba(255,255,255,0.95)');
  lf.addColorStop(0.2, 'rgba(255,240,200,0.4)');
  lf.addColorStop(1, 'rgba(255,200,255,0)');
  ctx.fillStyle = lf;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = `rgba(160,255,255,${0.12 + i * 0.03})`;
    ellipse(ctx, w * 0.7 - i * w * 0.07, h * 0.22 + i * h * 0.1, 10 + i * 6, 10 + i * 6);
    ctx.fill();
  }
  // a dragon silhouette in the back (with too many legs)
  ctx.fillStyle = 'rgba(40,10,70,0.6)';
  ellipse(ctx, w * 0.62, h * 0.4, w * 0.08, h * 0.06, -0.2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w * 0.6, h * 0.36);
  ctx.lineTo(w * 0.48, h * 0.18);
  ctx.lineTo(w * 0.58, h * 0.33);
  ctx.lineTo(w * 0.7, h * 0.14);
  ctx.lineTo(w * 0.66, h * 0.37);
  ctx.fill();
  for (let i = 0; i < 7; i++) ctx.fillRect(w * 0.575 + i * w * 0.013, h * 0.43, 3, h * 0.07);
  // the "Jimothy" (an AI's idea of him: giraffe neck, six legs, three eyes...), casting spells
  // spells, out of the six-fingered paw (painted first, so they come from behind it)
  const J = slopJimothyLayout(w * 0.27, h * 0.5, h * 0.38);
  lightning(ctx, J.paw.x + 4, J.paw.y, h * 0.4, r);
  lightning(ctx, w * 0.27 - h * 0.42, h * 0.5, h * 0.36, r);
  drawSlopJimothy(ctx, w * 0.27, h * 0.5, h * 0.38);
  wizardHat(ctx, J.head.x, J.head.y - J.head.r * 0.55, J.head.r);
  for (let i = 0; i < 6; i++) sparkle(ctx, J.head.x + (r() - 0.5) * J.head.r * 4, J.head.y - J.head.r * (1 + r() * 1.6), 6 + r() * 6, '#ffe36e');
  for (let i = 0; i < 40; i++) sparkle(ctx, r() * w, r() * h, 3 + r() * 9, r() < 0.5 ? '#ffffff' : '#9ffcff');
  // headline + garbled copy
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  glossyText(ctx, 'JIMOTHY: REAL & ROUND', w * 0.72, h * 0.62, h * 0.16, w * 0.52);
  fitFont(ctx, 'Offical Jimothy Summmer 20§6 — Now With Extra Leggs!', w * 0.52, h * 0.06, (s) => `800 ${s}px Nunito, system-ui, sans-serif`);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Offical Jimothy Summmer 20§6 — Now With Extra Leggs!', w * 0.72, h * 0.73);
  fitFont(ctx, '100% autentic raccon • Certainly! Here is a billboard:', w * 0.52, h * 0.045, (s) => `700 ${s}px Nunito, system-ui, sans-serif`);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('100% autentic raccon • Certainly! Here is a billboard:', w * 0.72, h * 0.81);
  // brand bar
  ctx.fillStyle = 'rgba(20,6,40,0.75)';
  ctx.fillRect(0, h * 0.88, w, h * 0.12);
  ctx.font = `${Math.round(h * 0.07)}px "Lilita One", Impact, sans-serif`;
  ctx.fillStyle = '#7df9ff';
  ctx.textAlign = 'left';
  ctx.fillText('SlopCorp ✦ Dreamer', w * 0.02, h * 0.965);
  ctx.textAlign = 'right';
  ctx.font = `700 ${Math.round(h * 0.045)}px Nunito, system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Generated in 0.3s · No raccoons were consulted (please do not wash)', w * 0.98, h * 0.955);
  // compression macroblocks
  for (let i = 0; i < 60; i++) {
    const bx = Math.floor(r() * (w / 16)) * 16;
    const by = Math.floor(r() * (h / 16)) * 16;
    ctx.fillStyle = `rgba(${r() < 0.5 ? 255 : 80},${Math.floor(r() * 255)},255,0.18)`;
    ctx.fillRect(bx, by, 16, 16);
  }
}

/** Painted paper texture background. */
function paper(ctx: Ctx, w: number, h: number, base = '#f4ead7', r = rng(5)) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${150 + r() * 60},${130 + r() * 50},${100 + r() * 40},${0.04 + r() * 0.05})`;
    ellipse(ctx, r() * w, r() * h, 6 + r() * 40, 3 + r() * 16, r() * Math.PI);
    ctx.fill();
  }
}

/** The reveal: a warm, hand-painted portrait of the real (round) Jimothy. */
export function drawHumanBillboard(ctx: Ctx, w: number, h: number) {
  const r = rng(11);
  paper(ctx, w, h, '#f6ecd6', r);
  // soft painted sky + hills
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, 'rgba(140,190,225,0.55)');
  sky.addColorStop(1, 'rgba(250,230,200,0.2)');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.7);
  ctx.fillStyle = 'rgba(120,170,95,0.6)';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.78);
  for (let x = 0; x <= w; x += 20) ctx.lineTo(x, h * 0.74 + Math.sin(x * 0.01) * h * 0.04);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();
  // brush dabs in the grass
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${70 + r() * 50},${120 + r() * 60},${50 + r() * 30},0.35)`;
    ellipse(ctx, r() * w, h * 0.78 + r() * h * 0.22, 4 + r() * 10, 2 + r() * 4, r() * Math.PI);
    ctx.fill();
  }
  // Jimothy, as he actually is: round of back, short of neck and tail, long of leg, mid-stroll
  ctx.fillStyle = 'rgba(52,74,36,0.35)';
  ellipse(ctx, w * 0.255, h * 0.835, h * 0.34, h * 0.035);
  ctx.fill();
  paintedJimothy(ctx, w * 0.25, h * 0.53, h * 0.33, r);
  // hand lettering
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.save();
  ctx.translate(w * 0.69, h * 0.45);
  ctx.rotate(-0.04);
  fitFont(ctx, 'HUMAN MADE', w * 0.52, h * 0.25, (s) => `${s}px "Luckiest Guy", Impact, sans-serif`);
  ctx.fillStyle = '#3a2a1c';
  ctx.fillText('HUMAN MADE', 4, 6);
  ctx.fillStyle = '#c0392b';
  ctx.fillText('HUMAN MADE', 0, 0);
  ctx.restore();
  fitFont(ctx, 'Jimothy, actual size: round.', w * 0.52, h * 0.075, (s) => `800 ${s}px Nunito, Georgia, serif`);
  ctx.fillStyle = '#3a2a1c';
  ctx.fillText('Jimothy, actual size: round.', w * 0.69, h * 0.64);
  fitFont(ctx, 'painted with a brush, by a person, over a weekend', w * 0.52, h * 0.05, (s) => `italic 700 ${s}px Nunito, Georgia, serif`);
  ctx.fillStyle = 'rgba(58,42,28,0.8)';
  ctx.fillText('painted with a brush, by a person, over a weekend', w * 0.69, h * 0.73);
  // little heart + signature scribble
  ctx.fillStyle = '#e25b6a';
  const hx = w * 0.92;
  const hy = h * 0.88;
  ctx.beginPath();
  ctx.moveTo(hx, hy + 14);
  ctx.bezierCurveTo(hx - 30, hy - 8, hx - 12, hy - 28, hx, hy - 12);
  ctx.bezierCurveTo(hx + 12, hy - 28, hx + 30, hy - 8, hx, hy + 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(58,42,28,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.78, h * 0.9);
  for (let i = 0; i < 12; i++) ctx.lineTo(w * 0.78 + i * 8, h * 0.9 + Math.sin(i * 1.7) * 8);
  ctx.stroke();
}

// ------------------------------------------------------------------ posters

export function drawSpellPoster(ctx: Ctx, w: number, h: number, variant = 0) {
  const r = rng(300 + variant * 17);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1b0b4a');
  g.addColorStop(0.5, '#5b1fa8');
  g.addColorStop(1, '#ff4fa3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) sparkle(ctx, r() * w, r() * h, 2 + r() * 7, r() < 0.5 ? '#ffffff' : '#ffe36e');
  const titles = ['JIMOTHY CASTING SPELLS', 'JIMOTHY VS THE RAID BOSS', 'JIMOTHY RIDES A DRAGON', 'JIMOTHY: THE MOVIE (AI)'];
  // magic circle under his (six) feet
  ctx.strokeStyle = 'rgba(125,249,255,0.8)';
  ctx.lineWidth = 4;
  ellipse(ctx, w * 0.5, h * 0.84, w * 0.42, h * 0.05);
  ctx.stroke();
  const J = slopJimothyLayout(w * 0.47, h * 0.57, w * 0.4);
  lightning(ctx, J.paw.x, J.paw.y, h * 0.26, r);
  lightning(ctx, w * 0.12, h * 0.5, h * 0.25, r);
  drawSlopJimothy(ctx, w * 0.47, h * 0.57, w * 0.4, { fingers: 6 + (variant % 2) });
  if (variant % titles.length === 0) wizardHat(ctx, J.head.x, J.head.y - J.head.r * 0.55, J.head.r * 0.9);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  glossyText(ctx, titles[variant % titles.length], w * 0.5, h * 0.14, w * 0.12, w * 0.92);
  ctx.font = `800 ${Math.round(w * 0.045)}px Nunito, system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('IN THEATRES NEVR • 4K • REAL FOOTAGE', w * 0.5, h * 0.21);
  ctx.font = `700 ${Math.round(w * 0.035)}px Nunito, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('AI GENERATED · SlopCorp Dreamer · do not wash', w * 0.5, h * 0.96);
}

export function drawPosterReal(ctx: Ctx, w: number, h: number) {
  const r = rng(909);
  paper(ctx, w, h, '#fbf6ea', r);
  // a strip of painted grass to stand on
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(${70 + r() * 50},${120 + r() * 60},${50 + r() * 30},0.3)`;
    ellipse(ctx, w * (0.08 + r() * 0.84), h * (0.74 + r() * 0.06), 4 + r() * 9, 2 + r() * 3, r() * Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(52,74,36,0.3)';
  ellipse(ctx, w * 0.51, h * 0.77, w * 0.36, h * 0.02);
  ctx.fill();
  paintedJimothy(ctx, w * 0.5, h * 0.53, w * 0.38, r);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  fitFont(ctx, 'HUMAN MADE', w * 0.9, w * 0.14, (s) => `${s}px "Luckiest Guy", Impact, sans-serif`);
  ctx.fillStyle = '#c0392b';
  ctx.fillText('HUMAN MADE', w * 0.5, h * 0.16);
  const s = fitFont(ctx, 'Jimothy casting: nothing.', w * 0.9, w * 0.065, (px) => `800 ${px}px Nunito, Georgia, serif`);
  ctx.fillStyle = '#3a2a1c';
  ctx.fillText('Jimothy casting: nothing.', w * 0.5, h * 0.87);
  ctx.fillText('He is a raccoon.', w * 0.5, h * 0.87 + s * 1.25);
}

// ------------------------------------------------------------------ signs

export function drawKioskScreen(ctx: Ctx, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0e1a3a');
  g.addColorStop(1, '#3a0e5a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  glossyText(ctx, 'MINT-A-JIMOTHY™', w / 2, h * 0.2, h * 0.13, w * 0.9);
  // a coin
  const cx = w / 2;
  const cy = h * 0.5;
  const cg = ctx.createRadialGradient(cx - 20, cy - 20, 5, cx, cy, h * 0.2);
  cg.addColorStop(0, '#fff6b0');
  cg.addColorStop(1, '#d19a1a');
  ctx.fillStyle = cg;
  ellipse(ctx, cx, cy, h * 0.19, h * 0.19);
  ctx.fill();
  ctx.fillStyle = '#7a5208';
  ctx.font = `${Math.round(h * 0.16)}px "Lilita One", Impact, sans-serif`;
  ctx.fillText('NFT', cx, cy + h * 0.055);
  ctx.font = `800 ${Math.round(h * 0.06)}px Nunito, system-ui, sans-serif`;
  ctx.fillStyle = '#7df9ff';
  ctx.fillText('BONK TO MINT • 0.3 SlopCoin', w / 2, h * 0.8);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `700 ${Math.round(h * 0.04)}px Nunito, system-ui, sans-serif`;
  ctx.fillText('you will own a picture of a coin. legally, probably.', w / 2, h * 0.9);
}

export function drawLabel(ctx: Ctx, w: number, h: number, lines: string[], opts: { bg?: string; fg?: string; accent?: string; font?: string } = {}) {
  ctx.fillStyle = opts.bg ?? '#1c1530';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = opts.accent ?? '#7df9ff';
  ctx.lineWidth = Math.max(4, h * 0.05);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((line, i) => {
    let s = Math.round((h / (n + 0.6)) * (i === 0 ? 0.8 : 0.5));
    ctx.font = i === 0 ? `${s}px "Lilita One", Impact, sans-serif` : `800 ${s}px Nunito, system-ui, sans-serif`;
    while (ctx.measureText(line).width > w * 0.9 && s > 8) {
      s -= 2;
      ctx.font = i === 0 ? `${s}px "Lilita One", Impact, sans-serif` : `800 ${s}px Nunito, system-ui, sans-serif`;
    }
    ctx.fillStyle = i === 0 ? (opts.fg ?? '#ffffff') : (opts.accent ?? '#7df9ff');
    ctx.fillText(line, w / 2, (h * (i + 0.8)) / (n + 0.6));
  });
}

export function drawPadDecal(ctx: Ctx, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#ffd23a';
  ctx.lineWidth = w * 0.04;
  ellipse(ctx, w / 2, h / 2, w * 0.44, h * 0.44);
  ctx.stroke();
  ctx.fillStyle = '#ffd23a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(w * 0.42)}px "Luckiest Guy", Impact, sans-serif`;
  ctx.fillText('D', w / 2, h * 0.5);
  ctx.font = `${Math.round(w * 0.06)}px "Lilita One", Impact, sans-serif`;
  ctx.fillText('DRAGON PARKING', w / 2, h * 0.18);
  ctx.fillText('AI ONLY', w / 2, h * 0.84);
}
