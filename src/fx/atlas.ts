import * as THREE from 'three';

/**
 * Procedural sprite atlas for the particle system (drawn once on a canvas at startup, no files).
 * Shapes are white (so instance colours tint them) with black outlines where a cartoon outline helps
 * readability (stars, hearts, glyphs). 8×4 cells of 128 px.
 */
export const SPR = {
  soft: 0,
  bubble: 1,
  sparkle: 2,
  star: 3,
  heart: 4,
  ring: 5,
  streak: 6,
  drop: 7,
  flash: 8,
  pixel: 9,
  smoke: 10,
  arc: 11,
  bolt: 12,
  dollar: 13,
  question: 14,
  note: 15,
  squiggle: 16,
  exclaim: 17,
  spiral: 18,
  shard: 19,
  petal: 20,
  dot: 21,
  plus: 22,
  zzz: 23,
  twinkle: 24,
  zapBolt: 25,
  burst: 26,
} as const;
export type SpriteName = keyof typeof SPR;

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
const CELL = 128;
const FONT = '"Luckiest Guy", "Arial Black", Impact, sans-serif';

type Ctx = CanvasRenderingContext2D;

function glyph(g: Ctx, text: string, size = 104) {
  g.font = `900 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 12;
  g.strokeStyle = '#000';
  g.strokeText(text, 0, 6);
  g.fillStyle = '#fff';
  g.fillText(text, 0, 6);
}

function starPath(g: Ctx, points: number, outer: number, inner: number, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

const DRAW: Record<SpriteName, (g: Ctx) => void> = {
  soft(g) {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 58);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-64, -64, 128, 128);
  },
  bubble(g) {
    const fill = g.createRadialGradient(0, 0, 20, 0, 0, 54);
    fill.addColorStop(0, 'rgba(255,255,255,0.05)');
    fill.addColorStop(0.8, 'rgba(255,255,255,0.22)');
    fill.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = fill;
    g.beginPath();
    g.arc(0, 0, 54, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath();
    g.ellipse(-20, -22, 13, 7, -0.7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath();
    g.arc(22, 20, 5, 0, Math.PI * 2);
    g.fill();
  },
  sparkle(g) {
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, 30);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(-64, -64, 128, 128);
    g.fillStyle = '#fff';
    for (const [len, w, rot] of [
      [60, 8, 0],
      [60, 8, Math.PI / 2],
      [30, 5, Math.PI / 4],
      [30, 5, -Math.PI / 4],
    ] as const) {
      g.save();
      g.rotate(rot);
      g.beginPath();
      g.moveTo(0, -len);
      g.quadraticCurveTo(w * 0.35, -w * 0.35, w, 0);
      g.quadraticCurveTo(w * 0.35, w * 0.35, 0, len);
      g.quadraticCurveTo(-w * 0.35, w * 0.35, -w, 0);
      g.quadraticCurveTo(-w * 0.35, -w * 0.35, 0, -len);
      g.fill();
      g.restore();
    }
  },
  star(g) {
    starPath(g, 5, 54, 25);
    g.lineJoin = 'round';
    g.lineWidth = 8;
    g.strokeStyle = '#000';
    g.stroke();
    g.fillStyle = '#fff';
    g.fill();
  },
  heart(g) {
    g.beginPath();
    g.moveTo(0, 46);
    g.bezierCurveTo(-8, 38, -54, 12, -54, -16);
    g.bezierCurveTo(-54, -40, -30, -52, -14, -44);
    g.bezierCurveTo(-6, -40, -2, -34, 0, -28);
    g.bezierCurveTo(2, -34, 6, -40, 14, -44);
    g.bezierCurveTo(30, -52, 54, -40, 54, -16);
    g.bezierCurveTo(54, 12, 8, 38, 0, 46);
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 8;
    g.strokeStyle = '#000';
    g.stroke();
    g.fillStyle = '#fff';
    g.fill();
  },
  ring(g) {
    const gr = g.createRadialGradient(0, 0, 34, 0, 0, 58);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.55, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-64, -64, 128, 128);
  },
  streak(g) {
    const gr = g.createLinearGradient(-60, 0, 60, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0.2)');
    g.fillStyle = gr;
    g.filter = 'blur(2px)';
    g.beginPath();
    g.ellipse(0, 0, 58, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.filter = 'none';
  },
  drop(g) {
    g.fillStyle = '#fff';
    g.filter = 'blur(1px)';
    g.beginPath();
    g.moveTo(-58, 0);
    g.quadraticCurveTo(0, -24, 28, -24);
    g.arc(28, 0, 24, -Math.PI / 2, Math.PI / 2);
    g.quadraticCurveTo(0, 24, -58, 0);
    g.fill();
    g.filter = 'none';
  },
  flash(g) {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 62);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(-64, -64, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 8; i++) {
      g.save();
      g.rotate((i / 8) * Math.PI * 2 + 0.2);
      g.beginPath();
      g.moveTo(-3, 0);
      g.lineTo(0, i % 2 ? -44 : -62);
      g.lineTo(3, 0);
      g.fill();
      g.restore();
    }
  },
  pixel(g) {
    g.fillStyle = '#fff';
    g.fillRect(-46, -46, 92, 92);
  },
  smoke(g) {
    for (const [x, y, r] of [
      [0, 4, 40],
      [-20, -12, 30],
      [22, -8, 30],
      [4, -24, 26],
      [-26, 14, 24],
      [26, 18, 24],
    ]) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.7)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(-64, -64, 128, 128);
    }
  },
  arc(g) {
    g.lineCap = 'round';
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a0 = -2.5 + (i / n) * 2.6;
      const a1 = -2.5 + ((i + 1) / n) * 2.6;
      g.strokeStyle = `rgba(255,255,255,${(0.15 + (0.85 * i) / n).toFixed(3)})`;
      g.lineWidth = 3 + (i / n) * 12;
      g.beginPath();
      g.arc(0, 8, 46, a0, a1 + 0.02);
      g.stroke();
    }
  },
  bolt(g) {
    g.lineJoin = 'miter';
    g.lineCap = 'round';
    g.shadowColor = '#fff';
    g.shadowBlur = 12;
    g.strokeStyle = '#fff';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(-8, -58);
    g.lineTo(16, -16);
    g.lineTo(-10, -6);
    g.lineTo(18, 30);
    g.lineTo(-2, 24);
    g.lineTo(10, 58);
    g.stroke();
    g.shadowBlur = 0;
  },
  dollar(g) {
    glyph(g, '$', 110);
  },
  question(g) {
    glyph(g, '?', 110);
  },
  note(g) {
    g.lineJoin = 'round';
    g.lineWidth = 9;
    g.strokeStyle = '#000';
    const path = () => {
      g.beginPath();
      g.ellipse(-14, 32, 21, 15, -0.45, 0, Math.PI * 2);
      g.moveTo(4, 30);
      g.lineTo(4, -48);
      g.lineTo(12, -48);
      g.quadraticCurveTo(40, -30, 30, -4);
      g.quadraticCurveTo(30, -26, 12, -30);
      g.lineTo(12, 30);
      g.closePath();
    };
    path();
    g.stroke();
    g.fillStyle = '#fff';
    path();
    g.fill();
  },
  squiggle(g) {
    g.lineCap = 'round';
    g.strokeStyle = '#fff';
    g.lineWidth = 9;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const y = 54 - (i / 40) * 108;
      const x = Math.sin((i / 40) * Math.PI * 3) * 16;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  },
  exclaim(g) {
    glyph(g, '!', 110);
  },
  spiral(g) {
    g.lineCap = 'round';
    g.strokeStyle = '#fff';
    g.lineWidth = 7;
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const a = t * Math.PI * 5;
      const r = 4 + t * 50;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  },
  shard(g) {
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.moveTo(-30, -52);
    g.lineTo(42, -8);
    g.lineTo(-12, 54);
    g.closePath();
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-30, -52);
    g.lineTo(42, -8);
    g.stroke();
  },
  petal(g) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(0, 0, 26, 54, 0, 0, Math.PI * 2);
    g.fill();
  },
  dot(g) {
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(0, 0, 50, 0, Math.PI * 2);
    g.fill();
  },
  plus(g) {
    g.fillStyle = '#fff';
    g.fillRect(-14, -52, 28, 104);
    g.fillRect(-52, -14, 104, 28);
  },
  zzz(g) {
    glyph(g, 'Z', 100);
  },
  twinkle(g) {
    const path = () => {
      g.beginPath();
      g.moveTo(0, -58);
      g.quadraticCurveTo(9, -9, 58, 0);
      g.quadraticCurveTo(9, 9, 0, 58);
      g.quadraticCurveTo(-9, 9, -58, 0);
      g.quadraticCurveTo(-9, -9, 0, -58);
      g.closePath();
    };
    g.lineJoin = 'round';
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    path();
    g.stroke();
    g.fillStyle = '#fff';
    path();
    g.fill();
  },
  zapBolt(g) {
    const pts = [
      [-4, -60],
      [30, -60],
      [8, -16],
      [34, -16],
      [-22, 60],
      [-6, 4],
      [-30, 4],
    ];
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 8;
    g.strokeStyle = '#000';
    g.stroke();
    g.fillStyle = '#fff';
    g.fill();
  },
  burst(g) {
    g.beginPath();
    const n = 11;
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 50 + ((i * 37) % 9) : 24 + ((i * 13) % 7);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 7;
    g.strokeStyle = '#000';
    g.stroke();
    g.fillStyle = '#fff';
    g.fill();
  },
};

let cached: THREE.CanvasTexture | null = null;

export function spriteAtlas(): THREE.CanvasTexture {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = CELL * ATLAS_COLS;
  c.height = CELL * ATLAS_ROWS;
  const g = c.getContext('2d')!;
  for (const [name, idx] of Object.entries(SPR) as [SpriteName, number][]) {
    const x = (idx % ATLAS_COLS) * CELL;
    const y = Math.floor(idx / ATLAS_COLS) * CELL;
    g.save();
    g.translate(x + CELL / 2, y + CELL / 2);
    g.beginPath();
    g.rect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4);
    g.clip();
    try {
      DRAW[name](g);
    } catch (err) {
      console.warn('[fx] atlas cell failed', name, err);
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
