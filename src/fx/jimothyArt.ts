/**
 * Jimothy in 2D: the one doodle of the real Jimothy that signs, murals, flags, ads and cards all share. Drawn from the
 * game model's side profile (itself fitted to the photos): a round, arched back over his short spine, the head
 * carried low with next to no neck, long legs mid-stride with a front paw lifted and curled (his walk), and a short
 * fluffy tail.
 *
 * Figure units: the nose is at x = +1, the tail's tip at x = -1, the back's top at y ≈ -0.91 and the feet at y ≈ +0.9
 * (y down, like the canvas). `drawJimothy(ctx, x, y, r)` fits the figure in the circle (x, y, r), the same box the
 * old round-raccoon doodle used, so callers can swap one for the other.
 */

type Ctx = CanvasRenderingContext2D;
/** x, y in figure units, and how furry the outline is there (0 = smooth). */
type Pt = [number, number, number?];
/** A leg joint: x, y, width. */
type Joint = [number, number, number];

export interface JimothyArtOpts {
  /** Outline colour. */
  outline?: string;
  /** Coat colour (a custom coat recolours the whole figure, e.g. bronze or purple). */
  body?: string;
  /** Mask colour. */
  mask?: string;
  /** A little smile (default on). */
  smile?: boolean;
  sunglasses?: boolean;
  /** Flat colours (no shading or fur strokes): small icons, flags, stencils. */
  flat?: boolean;
  /** 1 = facing right (default), -1 = facing left. */
  facing?: 1 | -1;
}

// ------------------------------------------------------------------------------------------------ the figure

/** His whole silhouette, head included: the back runs straight into the top of his head (no neck). */
const BODY: Pt[] = [
  [1.0, -0.075, 0],
  [0.975, -0.14, 0],
  [0.93, -0.25, 0],
  [0.86, -0.39, 0],
  [0.8, -0.52, 0],
  [0.72, -0.6, 0.1],
  [0.6, -0.7, 0.5],
  [0.44, -0.83, 0.7],
  [0.24, -0.9, 0.7],
  [0.0, -0.915, 0.7],
  [-0.24, -0.885, 0.7],
  [-0.44, -0.79, 0.7],
  [-0.6, -0.64, 0.6],
  [-0.68, -0.4, 0.6],
  [-0.67, -0.12, 0.6],
  [-0.62, 0.14, 0.5],
  [-0.53, 0.32, 0.6],
  [-0.37, 0.34, 0.8],
  [-0.2, 0.34, 1.0],
  [0.1, 0.37, 1.0],
  [0.36, 0.31, 0.9],
  [0.54, 0.17, 0.6],
  [0.65, 0.07, 0.5],
  [0.76, 0.0, 0.3],
  [0.86, -0.025, 0],
  [0.95, -0.035, 0],
];

/** The pale cheek ruff behind the mask, down to the throat. */
const CHEEK: Pt[] = [
  [0.63, -0.3],
  [0.72, -0.2],
  [0.8, -0.1],
  [0.74, 0.0],
  [0.63, 0.03],
  [0.58, -0.12],
];

const MASK: Pt[] = [
  [0.68, -0.43],
  [0.79, -0.44],
  [0.87, -0.37],
  [0.925, -0.26],
  [0.89, -0.18],
  [0.8, -0.14],
  [0.71, -0.14],
  [0.655, -0.25],
];

const BROW: Pt[] = [
  [0.67, -0.49],
  [0.78, -0.51],
  [0.87, -0.44],
  [0.93, -0.3],
  [0.905, -0.3],
  [0.85, -0.39],
  [0.78, -0.45],
  [0.68, -0.445],
];

const MUZZLE: Pt[] = [
  [0.8, -0.14],
  [0.9, -0.19],
  [0.955, -0.16],
  [0.995, -0.09],
  [0.975, -0.045],
  [0.92, -0.025],
  [0.84, -0.03],
  [0.78, -0.08],
];

/** Legs, far side first. Joints from the hip / shoulder down to the toes (x, y, width). */
const LEGS: { joints: Joint[]; far: boolean }[] = [
  // far hind: swinging forward, the foot raised
  { far: true, joints: [[-0.2, 0.08, 0.36], [-0.12, 0.4, 0.22], [0.0, 0.5, 0.13], [0.18, 0.5, 0.11]] },
  // far front: planted
  { far: true, joints: [[0.36, 0.04, 0.3], [0.34, 0.4, 0.17], [0.4, 0.7, 0.12], [0.47, 0.86, 0.12], [0.56, 0.885, 0.09]] },
  // near hind: planted; the big thigh is the bottom of his rump
  { far: false, joints: [[-0.44, -0.08, 0.5], [-0.46, 0.34, 0.3], [-0.64, 0.57, 0.15], [-0.71, 0.84, 0.13], [-0.59, 0.9, 0.1]] },
  // near front: lifted, the paw curled under (his walk)
  { far: false, joints: [[0.55, -0.04, 0.32], [0.6, 0.28, 0.18], [0.71, 0.38, 0.125], [0.7, 0.5, 0.115], [0.64, 0.55, 0.08]] },
];

const TAIL = { x: -0.75, y: -0.47, rx: 0.18, ry: 0.245, rot: 0.55 };
const EAR = { x: 0.7, y: -0.63, rx: 0.085, ry: 0.12, rot: -0.3 };
const EYE = { x: 0.82, y: -0.33, r: 0.03 };
const NOSE = { x: 0.983, y: -0.088, rx: 0.036, ry: 0.03 };

/** Short fur strokes on the coat (x, y, length), laid back and down like his fur. */
const COAT_STROKES: [number, number, number][] = [
  [-0.3, -0.58, 0.12],
  [0.18, -0.64, 0.12],
  [-0.48, -0.16, 0.11],
  [-0.06, -0.26, 0.12],
  [0.36, -0.3, 0.11],
  [-0.22, 0.1, 0.11],
  [0.16, 0.12, 0.11],
];

// ------------------------------------------------------------------------------------------------ colour

function parse(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** Mix two colours (t = 0 → a). */
export function mixColor(a: string, b: string, t: number) {
  const A = parse(a);
  const B = parse(b);
  return hex(A.map((v, i) => v + (B[i] - v) * t));
}
const shade = (c: string, k: number) => hex(parse(c).map((v) => v * k));

// ------------------------------------------------------------------------------------------------ geometry

/** Seeded jitter so the fur tufts look drawn, not stamped. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A closed Catmull-Rom curve through `pts`, sampled into a polygon. `fur` (figure units) raises pointed tufts where a
 * point's fur amount is > 0; they lean back and down, like his coat.
 */
function curve(pts: Pt[], samples: number, fur: number, seed: number): [number, number][] {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1];
  const out: [number, number][] = [];
  const rand = rng(seed);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let j = 0; j < samples; j++) {
      const t = j / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      let x = cr(p0[0], p1[0], p2[0], p3[0]);
      let y = cr(p0[1], p1[1], p2[1], p3[1]);
      const f = (p1[2] ?? 0) * (1 - t) + (p2[2] ?? 0) * t;
      if (fur > 0 && f > 0 && k % 2 === 1) {
        // tangent from the curve's derivative
        const dr = (a: number, b: number, c: number, d: number) =>
          0.5 * (-a + c + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2);
        let tx = dr(p0[0], p1[0], p2[0], p3[0]);
        let ty = dr(p0[1], p1[1], p2[1], p3[1]);
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const nx = area > 0 ? ty : -ty;
        const ny = area > 0 ? -tx : tx;
        const a = fur * f * (0.65 + 0.6 * rand());
        x += nx * a - 0.35 * a;
        y += ny * a + 0.3 * a;
      }
      out.push([x, y]);
      k++;
    }
  }
  return out;
}

function pathOf(poly: [number, number][]) {
  const p = new Path2D();
  poly.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

/** A leg's outline: the joint chain thickened by each joint's width, with rounded ends. */
function legOutline(joints: Joint[]): Pt[] {
  const L: Pt[] = [];
  const R: Pt[] = [];
  const n = joints.length;
  const dir = (i: number) => {
    const a = joints[Math.max(0, i - 1)];
    const b = joints[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  for (let i = 0; i < n; i++) {
    const [x, y, w] = joints[i];
    const [dx, dy] = dir(i);
    L.push([x - dy * w * 0.5, y + dx * w * 0.5]);
    R.push([x + dy * w * 0.5, y - dx * w * 0.5]);
  }
  const [ex, ey, ew] = joints[n - 1];
  const [edx, edy] = dir(n - 1);
  const [sx, sy, sw] = joints[0];
  const [sdx, sdy] = dir(0);
  return [...L, [ex + edx * ew * 0.45, ey + edy * ew * 0.45], ...R.reverse(), [sx - sdx * sw * 0.4, sy - sdy * sw * 0.4]];
}

function ellipsePath(e: { x: number; y: number; rx: number; ry: number; rot: number }, grow = 0) {
  const p = new Path2D();
  p.ellipse(e.x, e.y, e.rx + grow, e.ry + grow, e.rot, 0, Math.PI * 2);
  return p;
}

/** A fluffy ellipse (the tail): its rim broken into tufts. */
function fluffyEllipse(e: { x: number; y: number; rx: number; ry: number; rot: number }, fur: number, seed: number) {
  const pts: Pt[] = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.cos(a) * e.rx;
    const y = Math.sin(a) * e.ry;
    pts.push([e.x + x * Math.cos(e.rot) - y * Math.sin(e.rot), e.y + x * Math.sin(e.rot) + y * Math.cos(e.rot), 1]);
  }
  return curve(pts, 5, fur * 1.4, seed);
}

// ------------------------------------------------------------------------------------------------ drawing

/**
 * The canonical Jimothy doodle. (x, y) = the centre of the circle he fits in, r = its radius (the same box the old
 * round-raccoon doodle used).
 */
export function drawJimothy(ctx: Ctx, x: number, y: number, r: number, o: JimothyArtOpts = {}) {
  const custom = !!o.body;
  const body = o.body ?? '#8e8b88';
  const mask = o.mask ?? '#1b1b1f';
  const line = o.outline ?? '#161616';
  const light = custom ? mixColor(body, '#fff4e0', 0.6) : '#f4efe6';
  const legDark = custom ? shade(body, 0.5) : '#3b3631';
  const paw = custom ? shade(body, 0.34) : '#211d1a';
  const tailCol = custom ? mixColor(body, light, 0.15) : '#9a8f80';
  const earIn = custom ? shade(body, 0.45) : '#45434a';
  const cheek = custom ? mixColor(body, light, 0.25) : '#aaa6a0';
  const tiny = r < 22;
  const flat = !!o.flat || tiny;
  const lwPx = Math.max(1.4, r * 0.045);
  const lw = lwPx / r; // in figure units
  const fur = tiny ? 0 : 0.026;
  const samples = tiny ? 3 : r < 60 ? 4 : 6;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(r * (o.facing ?? 1), r);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const fillStroke = (p: Path2D, fill: string | CanvasGradient, width = lw) => {
    ctx.fillStyle = fill;
    ctx.fill(p);
    ctx.strokeStyle = line;
    ctx.lineWidth = width;
    ctx.stroke(p);
  };
  const legPaint = (j: Joint[], far: boolean) => {
    const top = far ? shade(body, 0.8) : body;
    if (flat && tiny) return far ? shade(legDark, 0.85) : legDark;
    const a = j[0];
    const b = j[j.length - 1];
    const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
    g.addColorStop(0, top);
    g.addColorStop(0.4, top);
    g.addColorStop(0.7, far ? shade(legDark, 0.85) : legDark);
    g.addColorStop(1, paw);
    return g;
  };

  // legs (far side first), then the tail: all tucked under the body's fur
  for (const leg of LEGS) fillStroke(pathOf(curve(legOutline(leg.joints), samples, 0, 1)), legPaint(leg.joints, leg.far));
  const tail = pathOf(fluffyEllipse(TAIL, fur, 7));
  let tailFill: string | CanvasGradient = tailCol;
  if (!flat) {
    const g = ctx.createLinearGradient(TAIL.x - 0.15, TAIL.y - 0.2, TAIL.x + 0.15, TAIL.y + 0.2);
    g.addColorStop(0, mixColor(tailCol, '#ffffff', 0.12));
    g.addColorStop(1, shade(tailCol, 0.82));
    tailFill = g;
  }
  fillStroke(tail, tailFill);
  if (!tiny) {
    // faint rings across the tail
    ctx.save();
    ctx.clip(tail);
    ctx.strokeStyle = shade(tailCol, 0.72);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 0.05;
    for (const k of [-0.06, 0.07]) {
      ctx.beginPath();
      ctx.ellipse(TAIL.x + Math.cos(TAIL.rot + Math.PI / 2) * k * 1.3, TAIL.y + Math.sin(TAIL.rot + Math.PI / 2) * k * 1.3, 0.2, 0.05, TAIL.rot, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // the ear pokes up from the top of his head (the body covers its base), then the body, head and all
  fillStroke(ellipsePath(EAR), light);
  ctx.fillStyle = earIn;
  ctx.fill(ellipsePath({ ...EAR, x: EAR.x + 0.012, y: EAR.y + 0.018, rx: EAR.rx * 0.6, ry: EAR.ry * 0.66 }));
  const bodyPath = pathOf(curve(BODY, samples, fur, 11));
  let bodyFill: string | CanvasGradient = body;
  if (!flat) {
    const g = ctx.createLinearGradient(0, -0.92, 0.1, 0.36);
    g.addColorStop(0, shade(body, 0.84));
    g.addColorStop(0.45, body);
    g.addColorStop(1, mixColor(body, '#d8d3cc', 0.45));
    bodyFill = g;
  }
  fillStroke(bodyPath, bodyFill, lw * 1.25);

  ctx.save();
  ctx.clip(bodyPath);
  if (!flat && r >= 34) {
    // a few fur marks, laid back and down like his coat
    ctx.strokeStyle = shade(body, 0.7);
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = lw * 0.7;
    for (const [sx, sy, l] of COAT_STROKES) {
      ctx.beginPath();
      ctx.moveTo(sx + l * 0.45, sy - l * 0.3);
      ctx.quadraticCurveTo(sx + l * 0.05, sy - l * 0.12, sx - l * 0.2, sy + l * 0.35);
      ctx.moveTo(sx + l * 0.05, sy - l * 0.3);
      ctx.quadraticCurveTo(sx - l * 0.3, sy - l * 0.1, sx - l * 0.55, sy + l * 0.25);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // face: pale cheek ruff, white brow and muzzle, the mask
  ctx.fillStyle = cheek;
  ctx.fill(pathOf(curve(CHEEK, samples, 0, 3)));
  ctx.fillStyle = light;
  ctx.fill(pathOf(curve(BROW, samples, 0, 4)));
  ctx.fillStyle = mask;
  ctx.fill(pathOf(curve(MASK, samples, 0, 5)));
  ctx.fillStyle = light;
  ctx.fill(pathOf(curve(MUZZLE, samples, 0, 6)));
  ctx.restore();
  // re-draw the outline over the face patches' edges
  ctx.strokeStyle = line;
  ctx.lineWidth = lw * 1.25;
  ctx.stroke(bodyPath);

  if (o.sunglasses) {
    // cool shades in profile: a big dark lens with a light frame (it has to show against the mask), arm to the ear
    const lx = EYE.x + 0.02;
    const ly = EYE.y + 0.005;
    ctx.strokeStyle = '#9aa0ab';
    ctx.lineWidth = lw * 1.2;
    ctx.beginPath();
    ctx.moveTo(lx - 0.09, ly - 0.03);
    ctx.lineTo(0.64, -0.45);
    ctx.stroke();
    ctx.fillStyle = '#0d0f14';
    ctx.beginPath();
    ctx.ellipse(lx, ly, 0.105, 0.072, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9aa0ab';
    ctx.lineWidth = lw;
    ctx.stroke();
    if (!tiny) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      ctx.moveTo(lx - 0.05, ly - 0.02);
      ctx.lineTo(lx + 0.01, ly - 0.045);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#0a0a0c';
    ctx.beginPath();
    ctx.arc(EYE.x, EYE.y, EYE.r, 0, Math.PI * 2);
    ctx.fill();
    if (!tiny) {
      ctx.strokeStyle = 'rgba(120,120,132,0.6)';
      ctx.lineWidth = lw * 0.45;
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(EYE.x - 0.009, EYE.y - 0.011, Math.max(EYE.r * 0.38, 0.6 / r), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1a1414';
  ctx.beginPath();
  ctx.ellipse(NOSE.x, NOSE.y, NOSE.rx, NOSE.ry, 0.3, 0, Math.PI * 2);
  ctx.fill();
  if (o.smile !== false && !tiny) {
    ctx.strokeStyle = '#1a1414';
    ctx.lineWidth = lw * 0.75;
    ctx.beginPath();
    ctx.moveTo(0.965, -0.045);
    ctx.quadraticCurveTo(0.93, -0.012, 0.885, -0.04);
    ctx.stroke();
  }
  ctx.restore();
}
