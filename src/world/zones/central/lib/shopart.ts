import { drawJimothy, fitText, FONT_BODY, FONT_SERIF, FONT_SIGN, FONT_TITLE, roundRect, sparkle, textLines } from './signs';
import { goodwheelLogo } from './art';
import { Rng } from './util';

/**
 * Canvas art for Old Ballard Ave: shop signs, storefront window displays, plaques, sandwich boards.
 * Parody names only.
 */
type Ctx = CanvasRenderingContext2D;

// ------------------------------------------------------------------------------------------- icons

type Icon = (ctx: Ctx, x: number, y: number, s: number) => void;

const icons: Record<string, Icon> = {
  star(ctx, x, y, s) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.42 : s;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.fill();
  },
  cup(ctx, x, y, s) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.6, y - s * 0.5);
    ctx.lineTo(x + s * 0.6, y - s * 0.5);
    ctx.lineTo(x + s * 0.45, y + s * 0.7);
    ctx.lineTo(x - s * 0.45, y + s * 0.7);
    ctx.fill();
    ctx.fillRect(x - s * 0.7, y - s * 0.72, s * 1.4, s * 0.22);
  },
  bean(ctx, x, y, s) {
    ctx.fillStyle = '#6b3e1f';
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.55, s * 0.8, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f5d9a8';
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.3, y - s * 0.55);
    ctx.quadraticCurveTo(x + s * 0.2, y, x + s * 0.3, y + s * 0.55);
    ctx.stroke();
    ctx.fillStyle = 'rgba(160,255,200,0.55)';
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.3);
    ctx.lineTo(x - s * 0.5, y + s);
    ctx.lineTo(x + s * 0.5, y + s);
    ctx.fill();
  },
  record(ctx, x, y, s) {
    ctx.fillStyle = '#151515';
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    for (let r = 0.4; r < 1; r += 0.15) {
      ctx.beginPath();
      ctx.arc(x, y, s * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#e8563a';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
  },
  cupcake(ctx, x, y, s) {
    ctx.fillStyle = '#f7a8c8';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.1, s * 0.62, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#c98a4b';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.6, y - s * 0.1);
    ctx.lineTo(x + s * 0.6, y - s * 0.1);
    ctx.lineTo(x + s * 0.42, y + s * 0.7);
    ctx.lineTo(x - s * 0.42, y + s * 0.7);
    ctx.fill();
    ctx.fillStyle = '#d4312b';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.78, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
  },
  hammer(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.6);
    ctx.fillStyle = '#c98a4b';
    ctx.fillRect(-s * 0.1, -s * 0.3, s * 0.2, s * 1.2);
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(-s * 0.55, -s * 0.6, s * 1.1, s * 0.35);
    ctx.restore();
  },
  donut(ctx, x, y, s) {
    ctx.fillStyle = '#e0a060';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff7eb6';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a5d9f';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
    const r = new Rng(3);
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = r.pick(['#fff', '#ffd23f', '#6fd3ff', '#8f6bff']);
      const a = r.range(0, 6.28),
        d = r.range(0.38, 0.65) * s;
      ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, s * 0.12, s * 0.05);
    }
  },
  fish(ctx, x, y, s) {
    ctx.fillStyle = '#f2f2f2';
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.8, s * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.65, y);
    ctx.lineTo(x + s * 1.15, y - s * 0.4);
    ctx.lineTo(x + s * 1.15, y + s * 0.4);
    ctx.fill();
    ctx.fillStyle = '#123';
    ctx.beginPath();
    ctx.arc(x - s * 0.45, y - s * 0.08, s * 0.08, 0, Math.PI * 2);
    ctx.fill();
  },
  sweater(ctx, x, y, s) {
    ctx.fillStyle = '#d4312b';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, y - s * 0.7);
    ctx.lineTo(x + s * 0.5, y - s * 0.7);
    ctx.lineTo(x + s * 1.0, y - s * 0.2);
    ctx.lineTo(x + s * 0.75, y + s * 0.05);
    ctx.lineTo(x + s * 0.5, y - s * 0.15);
    ctx.lineTo(x + s * 0.5, y + s * 0.8);
    ctx.lineTo(x - s * 0.5, y + s * 0.8);
    ctx.lineTo(x - s * 0.5, y - s * 0.15);
    ctx.lineTo(x - s * 0.75, y + s * 0.05);
    ctx.lineTo(x - s * 1.0, y - s * 0.2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    for (let i = -2; i <= 2; i++) sparkleTiny(ctx, x + i * s * 0.2, y + s * 0.15, s * 0.1);
  },
  viking(ctx, x, y, s) {
    ctx.fillStyle = '#9aa3ab';
    ctx.beginPath();
    ctx.arc(x, y + s * 0.1, s * 0.6, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#f2e6c8';
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + d * s * 0.5, y - s * 0.1);
      ctx.quadraticCurveTo(x + d * s * 1.1, y - s * 0.3, x + d * s * 0.95, y - s * 1.0);
      ctx.quadraticCurveTo(x + d * s * 0.8, y - s * 0.4, x + d * s * 0.35, y - s * 0.35);
      ctx.fill();
    }
    ctx.fillStyle = '#c9a23a';
    ctx.fillRect(x - s * 0.65, y + s * 0.05, s * 1.3, s * 0.18);
  },
  umbrella(ctx, x, y, s) {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.95, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + s * 0.8);
    ctx.arc(x - s * 0.18, y + s * 0.8, s * 0.18, 0, Math.PI);
    ctx.stroke();
  },
  bowl(ctx, x, y, s) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = s * 0.08;
    for (const d of [-0.3, 0, 0.3]) {
      ctx.beginPath();
      ctx.moveTo(x + d * s, y - s * 0.2);
      ctx.bezierCurveTo(x + d * s - s * 0.2, y - s * 0.5, x + d * s + s * 0.2, y - s * 0.7, x + d * s, y - s * 1.0);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.85, 0, Math.PI);
    ctx.fill();
  },
  bubbles(ctx, x, y, s) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = s * 0.08;
    for (const [dx, dy, r] of [[0, 0, 0.55], [0.6, -0.5, 0.35], [-0.55, -0.55, 0.28], [0.2, -0.95, 0.2]]) {
      ctx.beginPath();
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  yarn(ctx, x, y, s) {
    ctx.fillStyle = '#ff7eb6';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c94f86';
    ctx.lineWidth = s * 0.08;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.8, s * 0.3 + Math.abs(i) * 0.1 * s, i * 0.6, 0, Math.PI);
      ctx.stroke();
    }
  },
  book(ctx, x, y, s) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.5);
    ctx.lineTo(x - s * 0.9, y - s * 0.7);
    ctx.lineTo(x - s * 0.9, y + s * 0.6);
    ctx.lineTo(x, y + s * 0.8);
    ctx.lineTo(x + s * 0.9, y + s * 0.6);
    ctx.lineTo(x + s * 0.9, y - s * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8715a';
    ctx.beginPath();
    ctx.ellipse(x + s * 0.45, y, s * 0.3, s * 0.13, -0.2, 0, Math.PI * 2);
    ctx.fill();
  },
  wheel(ctx, x, y, s) {
    goodwheelLogo(ctx, x, y, s * 0.85);
  },
  dagger(ctx, x, y, s) {
    ctx.fillStyle = '#d4312b';
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.8);
    ctx.bezierCurveTo(x - s, y, x - s * 0.6, y - s * 0.9, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.6, y - s * 0.9, x + s, y, x, y + s * 0.8);
    ctx.fill();
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(x - s * 0.06, y - s * 1.0, s * 0.12, s * 1.6);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(x - s * 0.3, y - s * 0.45, s * 0.6, s * 0.1);
  },
};

function sparkleTiny(ctx: Ctx, x: number, y: number, r: number) {
  sparkle(ctx, x, y, r, ctx.fillStyle as string);
}

// ------------------------------------------------------------------------------------------- shop registry

export interface ShopDef {
  key: string;
  name: string;
  sub?: string;
  bg: string;
  fg: string;
  border: string;
  accent?: string;
  font?: string;
  icon?: keyof typeof icons;
  theme: string;
  glow?: boolean;
}

export const SHOPS: Record<string, ShopDef> = {
  goodwheel: { key: 'goodwheel', name: 'Goodwheel', sub: 'THRIFT STORE · SINCE 1952', bg: '#1b5fae', fg: '#fff', border: '#0d2f57', icon: 'wheel', theme: 'thrift', glow: true },
  starbrews: { key: 'starbrews', name: 'Starbrews', sub: 'COFFEE · EST. SOMETIME', bg: '#1e7a4f', fg: '#fff', border: '#0f3d27', accent: '#e9f3ee', icon: 'star', theme: 'coffee', glow: true },
  beanmeup: { key: 'beanmeup', name: 'Bean Me Up', sub: 'COFFEE · OUT OF THIS WORLD', bg: '#3b1f6e', fg: '#9ff7d0', border: '#150a2e', icon: 'bean', theme: 'coffee2', glow: true, font: FONT_TITLE },
  ink: { key: 'ink', name: 'Ink Different', sub: 'TATTOO · WALK-INS WELCOME', bg: '#141414', fg: '#ff4d4d', border: '#000', accent: '#d8b04a', icon: 'dagger', theme: 'tattoo', glow: true, font: FONT_TITLE },
  grunge: { key: 'grunge', name: 'Grunge & Sons', sub: 'VINYL · TAPES · FLANNEL', bg: '#efe2c4', fg: '#7a2e1c', border: '#3b2a1a', accent: '#7a2e1c', icon: 'record', theme: 'vinyl' },
  bakery: { key: 'bakery', name: 'Ballard Barnacle', sub: 'BAKERY · FRESH DAILY', bg: '#ffd9e6', fg: '#8a2a55', border: '#6b1f40', accent: '#fff', icon: 'cupcake', theme: 'bakery' },
  hardware: { key: 'hardware', name: 'Totally Normal', sub: 'HARDWARE · NOTHING WEIRD HERE', bg: '#c62f2f', fg: '#fff', border: '#5c1010', icon: 'hammer', theme: 'hardware' },
  donuts: { key: 'donuts', name: 'Uff Da Donuts', sub: 'NORDIC · ROUND · DELICIOUS', bg: '#2a5d9f', fg: '#fff', border: '#12305a', accent: '#ffd23f', icon: 'donut', theme: 'donuts', glow: true },
  sweater: { key: 'sweater', name: 'Sweater Weather Co.', sub: 'KNITWEAR · ALL YEAR', bg: '#e0a82e', fg: '#3b2a10', border: '#6b4e14', icon: 'sweater', theme: 'sweater' },
  lutefisk: { key: 'lutefisk', name: 'Lutefisk & Chill', sub: 'NORDIC DELI', bg: '#7cc4e8', fg: '#0d3550', border: '#0d3550', accent: '#fff', icon: 'fish', theme: 'deli' },
  viking: { key: 'viking', name: 'Viking Vacuum', sub: 'REPAIR · WE SUCK (IN A GOOD WAY)', bg: '#4b5560', fg: '#ffd23f', border: '#1f252b', icon: 'viking', theme: 'vacuum' },
  rain: { key: 'rain', name: 'Rain or Shine', sub: 'UMBRELLAS · MOSTLY RAIN', bg: '#274b7a', fg: '#fff', border: '#10233d', accent: '#ffd23f', icon: 'umbrella', theme: 'umbrella' },
  pho: { key: 'pho', name: 'Pho-nomenal', sub: 'NOODLE HOUSE', bg: '#b3261e', fg: '#ffe08a', border: '#4a0f0b', icon: 'bowl', theme: 'noodle', glow: true },
  suds: { key: 'suds', name: "Sudsy's", sub: 'LAUNDROMAT · WE WASH EVERYTHING', bg: '#39b8d6', fg: '#fff', border: '#0f5566', icon: 'bubbles', theme: 'laundry', glow: true },
  knit: { key: 'knit', name: 'Nordic Knit & Purl', sub: 'YARN · NEEDLES · COZY', bg: '#f3efe6', fg: '#b3264f', border: '#5a4a3a', accent: '#b3264f', icon: 'yarn', theme: 'yarn' },
  books: { key: 'books', name: 'Salmon Bay Books', sub: 'NEW · USED · WASHED', bg: '#2f5d4a', fg: '#fdf3d7', border: '#12291f', accent: '#e8715a', icon: 'book', theme: 'books' },
};

export function drawShopSign(ctx: Ctx, w: number, h: number, d: ShopDef) {
  ctx.fillStyle = d.border;
  roundRect(ctx, 0, 0, w, h, h * 0.14);
  ctx.fill();
  ctx.fillStyle = d.bg;
  roundRect(ctx, h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14, h * 0.1);
  ctx.fill();
  // subtle panel shading
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = g;
  roundRect(ctx, h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14, h * 0.1);
  ctx.fill();
  if (d.accent) {
    ctx.strokeStyle = d.accent;
    ctx.lineWidth = h * 0.03;
    roundRect(ctx, h * 0.13, h * 0.13, w - h * 0.26, h - h * 0.26, h * 0.07);
    ctx.stroke();
  }
  let x0 = w / 2;
  let maxW = w - h * 0.5;
  if (d.icon) {
    icons[d.icon](ctx, h * 0.62, h * 0.52, h * 0.3);
    x0 = w / 2 + h * 0.42;
    maxW = w - h * 1.45;
  }
  fitText(ctx, d.name, x0, h * 0.42, maxW, h * 0.48, d.font ?? FONT_SIGN, { fill: d.fg, shadow: 'rgba(0,0,0,0.35)' });
  if (d.sub) fitText(ctx, d.sub, x0, h * 0.78, maxW, h * 0.16, FONT_BODY, { fill: d.fg, weight: '900' });
}

// ------------------------------------------------------------------------------------------- window displays

function interior(ctx: Ctx, w: number, h: number, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // back wall / floor split
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  // pendant lights
  for (let i = 0; i < 3; i++) {
    const x = w * (0.2 + i * 0.3);
    ctx.strokeStyle = 'rgba(40,30,20,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h * 0.12);
    ctx.stroke();
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath();
    ctx.arc(x, h * 0.14, h * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
}

function glassSheen(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.moveTo(w * 0.05, 0);
  ctx.lineTo(w * 0.22, 0);
  ctx.lineTo(w * 0.02, h);
  ctx.lineTo(0, h);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w * 0.6, 0);
  ctx.lineTo(w * 0.66, 0);
  ctx.lineTo(w * 0.5, h);
  ctx.lineTo(w * 0.44, h);
  ctx.fill();
}

function goldLetters(ctx: Ctx, text: string, w: number, y: number, size: number) {
  fitText(ctx, text, w / 2, y, w * 0.8, size, FONT_SERIF, { fill: '#e8c25a', stroke: 'rgba(60,30,0,0.6)', strokeW: 3, weight: 'bold' });
}

function openSign(ctx: Ctx, x: number, y: number, s: number) {
  ctx.fillStyle = 'rgba(20,10,30,0.8)';
  roundRect(ctx, x - s, y - s * 0.4, s * 2, s * 0.8, s * 0.2);
  ctx.fill();
  ctx.strokeStyle = '#ff5d8f';
  ctx.lineWidth = 3;
  roundRect(ctx, x - s + 3, y - s * 0.4 + 3, s * 2 - 6, s * 0.8 - 6, s * 0.18);
  ctx.stroke();
  fitText(ctx, 'OPEN', x, y + 1, s * 1.7, s * 0.55, FONT_SIGN, { fill: '#7cf7ff' });
}

export function drawShopWindow(ctx: Ctx, w: number, h: number, theme: string, seed = 1) {
  const r = new Rng(seed * 97 + theme.length);
  switch (theme) {
    case 'thrift': {
      interior(ctx, w, h, '#fff1d6', '#f2c98a');
      // clothes racks with colourful garments
      for (let k = 0; k < 2; k++) {
        const x0 = w * (0.05 + k * 0.5),
          x1 = x0 + w * 0.4,
          y = h * 0.34;
        ctx.fillStyle = '#777';
        ctx.fillRect(x0, y, x1 - x0, 4);
        for (let x = x0 + 8; x < x1 - 8; x += 13) {
          ctx.fillStyle = r.pick(['#e8563a', '#2a7de1', '#ffd23f', '#3cb371', '#b36bff', '#ff7eb6', '#ffffff', '#2d2d2d']);
          roundRect(ctx, x - 6, y + 4, 13, h * 0.3 + r.range(-8, 10), 3);
          ctx.fill();
        }
      }
      // mannequin in a raccoon sweater
      ctx.fillStyle = '#e9dcc6';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.3, h * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8e8b88';
      roundRect(ctx, w * 0.45, h * 0.37, w * 0.1, h * 0.28, 8);
      ctx.fill();
      drawJimothy(ctx, w * 0.5, h * 0.48, h * 0.05, { flat: true });
      ctx.fillStyle = '#d4312b';
      roundRect(ctx, w * 0.72, h * 0.72, w * 0.2, h * 0.16, 6);
      ctx.fill();
      fitText(ctx, '50% OFF', w * 0.82, h * 0.8, w * 0.18, h * 0.1, FONT_SIGN, { fill: '#fff' });
      goldLetters(ctx, 'WE ♥ JIMOTHY', w, h * 0.12, h * 0.1);
      break;
    }
    case 'coffee':
    case 'coffee2': {
      const alt = theme === 'coffee2';
      interior(ctx, w, h, alt ? '#e6d5ff' : '#fbe7c6', alt ? '#9d7ad6' : '#d7a86e');
      // chalkboard menu
      ctx.fillStyle = '#26302b';
      roundRect(ctx, w * 0.56, h * 0.08, w * 0.38, h * 0.42, 6);
      ctx.fill();
      textLines(ctx, alt ? ['GALAXY LATTE', 'ROUND FOAM', 'BLACK HOLE BREW'] : ['JIMOTHY LATTE $5', '(round foam art)', 'DRIP · MOCHA'], w * 0.75, h * 0.29, w * 0.34, h * 0.07, FONT_BODY, '#f5f1e6', 1.25, { weight: '800' });
      // counter + espresso machine
      ctx.fillStyle = alt ? '#4a2a7a' : '#6b4226';
      ctx.fillRect(0, h * 0.58, w * 0.6, h * 0.22);
      ctx.fillStyle = '#c9c9c9';
      roundRect(ctx, w * 0.08, h * 0.4, w * 0.18, h * 0.18, 5);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.fillRect(w * 0.12, h * 0.5, w * 0.03, h * 0.06);
      ctx.fillRect(w * 0.19, h * 0.5, w * 0.03, h * 0.06);
      // cups
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(w * (0.32 + i * 0.06), h * 0.5, w * 0.04, h * 0.08);
        ctx.fillStyle = alt ? '#9ff7d0' : '#1e7a4f';
        ctx.fillRect(w * (0.32 + i * 0.06), h * 0.53, w * 0.04, h * 0.025);
      }
      openSign(ctx, w * 0.25, h * 0.2, h * 0.11);
      break;
    }
    case 'tattoo': {
      interior(ctx, w, h, '#2b2230', '#141016');
      // flash sheets
      const sheets = 4;
      for (let i = 0; i < sheets; i++) {
        const x = w * (0.06 + i * 0.235),
          y = h * 0.14;
        ctx.fillStyle = '#f3ead6';
        ctx.fillRect(x, y, w * 0.2, h * 0.52);
        ctx.strokeStyle = '#b39a6a';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w * 0.2, h * 0.52);
        const cx = x + w * 0.1,
          cy = y + h * 0.26;
        if (i === 1 || i === 3) {
          drawJimothy(ctx, cx, cy, h * 0.12, { outline: '#111' });
          fitText(ctx, i === 1 ? 'ROUND' : 'MOM', cx, y + h * 0.46, w * 0.18, h * 0.06, FONT_TITLE, { fill: '#c62f2f' });
        } else if (i === 0) {
          icons.dagger(ctx, cx, cy, h * 0.14);
        } else {
          ctx.fillStyle = '#c62f2f';
          ctx.beginPath();
          ctx.arc(cx, cy, h * 0.1, 0, Math.PI * 2);
          ctx.fill();
          sparkle(ctx, cx, cy, h * 0.08, '#ffd23f');
        }
      }
      ctx.fillStyle = '#ff4d4d';
      fitText(ctx, 'FLASH · $80', w / 2, h * 0.82, w * 0.6, h * 0.1, FONT_SIGN, { fill: '#ff4d4d', shadow: '#000' });
      break;
    }
    case 'vinyl': {
      interior(ctx, w, h, '#f3dcb3', '#b9855a');
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < 6; i++) {
          const x = w * (0.04 + i * 0.16),
            y = h * (0.1 + row * 0.33);
          ctx.fillStyle = r.pick(['#e8563a', '#1d1d1d', '#2a7de1', '#ffd23f', '#7a2e1c', '#3cb371', '#ff7eb6']);
          ctx.fillRect(x, y, w * 0.13, w * 0.13);
          if (r.chance(0.5)) icons.record(ctx, x + w * 0.065, y + w * 0.065, w * 0.045);
          else drawJimothy(ctx, x + w * 0.065, y + w * 0.07, w * 0.035, { flat: true });
        }
      }
      fitText(ctx, 'NOW PLAYING: THE ROUND BOYS', w / 2, h * 0.85, w * 0.9, h * 0.08, FONT_SIGN, { fill: '#7a2e1c' });
      break;
    }
    case 'bakery': {
      interior(ctx, w, h, '#fff3e3', '#f5c9a8');
      for (let s = 0; s < 3; s++) {
        const y = h * (0.28 + s * 0.2);
        ctx.fillStyle = '#e9dcc6';
        ctx.fillRect(w * 0.04, y + h * 0.08, w * 0.92, 5);
        for (let i = 0; i < 7; i++) {
          const x = w * (0.08 + i * 0.13);
          if (s === 0) icons.cupcake(ctx, x, y, h * 0.06);
          else if (s === 1) {
            ctx.fillStyle = '#d99a4e';
            ctx.beginPath();
            ctx.ellipse(x, y + h * 0.04, h * 0.07, h * 0.04, 0, 0, Math.PI * 2);
            ctx.fill();
          } else icons.donut(ctx, x, y + h * 0.03, h * 0.05);
        }
      }
      goldLetters(ctx, 'BARNACLE BUNS · BAKED DAILY', w, h * 0.12, h * 0.08);
      break;
    }
    case 'hardware': {
      interior(ctx, w, h, '#e8eef2', '#b8c4cc');
      // pegboard
      ctx.fillStyle = '#c9a36b';
      ctx.fillRect(w * 0.05, h * 0.08, w * 0.55, h * 0.5);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let x = 0; x < 12; x++) for (let y = 0; y < 8; y++) ctx.fillRect(w * 0.07 + x * w * 0.045, h * 0.1 + y * h * 0.06, 2, 2);
      icons.hammer(ctx, w * 0.18, h * 0.3, h * 0.12);
      ctx.fillStyle = '#555';
      ctx.fillRect(w * 0.33, h * 0.16, w * 0.03, h * 0.3);
      ctx.fillStyle = '#d4312b';
      ctx.fillRect(w * 0.42, h * 0.16, w * 0.12, h * 0.05);
      // paint cans
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = r.pick(['#d4312b', '#2a7de1', '#ffd23f', '#3cb371', '#fff']);
        ctx.fillRect(w * (0.64 + (i % 3) * 0.1), h * (0.6 - Math.floor(i / 3) * 0.16), w * 0.08, h * 0.14);
      }
      textLines(ctx, ['NO RACCOONS WERE', 'HARMED. PROBABLY.'], w * 0.32, h * 0.76, w * 0.6, h * 0.08, FONT_SIGN, '#5c1010', 1.1);
      break;
    }
    case 'donuts': {
      interior(ctx, w, h, '#e3f0ff', '#9cc3ef');
      for (let s = 0; s < 3; s++) for (let i = 0; i < 6; i++) icons.donut(ctx, w * (0.1 + i * 0.15), h * (0.25 + s * 0.2), h * 0.065);
      goldLetters(ctx, 'THE ROUND ONES ARE BEST', w, h * 0.87, h * 0.08);
      break;
    }
    case 'sweater': {
      interior(ctx, w, h, '#fff4dc', '#e3c07a');
      for (let i = 0; i < 4; i++) icons.sweater(ctx, w * (0.14 + i * 0.24), h * 0.42, h * 0.18);
      goldLetters(ctx, 'IT IS ALWAYS SWEATER WEATHER', w, h * 0.85, h * 0.08);
      break;
    }
    case 'deli': {
      interior(ctx, w, h, '#eaf7ff', '#b4dcef');
      ctx.fillStyle = '#fff';
      ctx.fillRect(w * 0.05, h * 0.52, w * 0.9, h * 0.26);
      for (let i = 0; i < 6; i++) icons.fish(ctx, w * (0.12 + i * 0.14), h * 0.62, h * 0.06);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = r.pick(['#f2c14e', '#e8715a', '#9fd3b8']);
        roundRect(ctx, w * (0.08 + i * 0.11), h * 0.2, w * 0.07, h * 0.16, 4);
        ctx.fill();
      }
      goldLetters(ctx, 'LUTEFISK: AN ACQUIRED TASTE', w, h * 0.46, h * 0.07);
      break;
    }
    case 'vacuum': {
      interior(ctx, w, h, '#eceff1', '#b0bec5');
      for (let i = 0; i < 5; i++) {
        const x = w * (0.1 + i * 0.19);
        ctx.fillStyle = r.pick(['#d4312b', '#2a7de1', '#ffd23f', '#6d6d6d']);
        roundRect(ctx, x - w * 0.05, h * 0.5, w * 0.1, h * 0.25, 8);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, h * 0.5);
        ctx.lineTo(x + w * 0.03, h * 0.2);
        ctx.stroke();
      }
      icons.viking(ctx, w * 0.5, h * 0.22, h * 0.1);
      break;
    }
    case 'umbrella': {
      interior(ctx, w, h, '#e7f0fb', '#a6bfdc');
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.globalAlpha = 0.95;
        const col = r.pick(['#ffd23f', '#e8563a', '#2a7de1', '#3cb371', '#ff7eb6']);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(w * (0.12 + i * 0.19), h * 0.45 + (i % 2) * h * 0.08, h * 0.16, Math.PI, 0);
        ctx.fill();
        ctx.restore();
      }
      goldLetters(ctx, 'FORECAST: YES', w, h * 0.84, h * 0.09);
      break;
    }
    case 'noodle': {
      interior(ctx, w, h, '#ffe2b0', '#e88a4a');
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#d4312b';
        ctx.beginPath();
        ctx.ellipse(w * (0.14 + i * 0.24), h * 0.2, h * 0.06, h * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 3; i++) icons.bowl(ctx, w * (0.2 + i * 0.3), h * 0.65, h * 0.1);
      goldLetters(ctx, 'SLURP RESPONSIBLY', w, h * 0.88, h * 0.08);
      break;
    }
    case 'laundry': {
      interior(ctx, w, h, '#e8fbff', '#9fdcea');
      for (let i = 0; i < 5; i++) {
        const x = w * (0.1 + i * 0.19),
          y = h * 0.5;
        ctx.fillStyle = '#f7f7f7';
        roundRect(ctx, x - w * 0.08, y - h * 0.25, w * 0.16, h * 0.5, 6);
        ctx.fill();
        ctx.fillStyle = '#6b7a85';
        ctx.beginPath();
        ctx.arc(x, y, h * 0.13, 0, Math.PI * 2);
        ctx.fill();
        if (i === 2) drawJimothy(ctx, x, y, h * 0.09, { flat: true });
        else {
          ctx.fillStyle = 'rgba(160,220,255,0.8)';
          ctx.beginPath();
          ctx.arc(x, y, h * 0.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      goldLetters(ctx, 'WE WASH EVERYTHING (SO DOES HE)', w, h * 0.12, h * 0.075);
      break;
    }
    case 'yarn': {
      interior(ctx, w, h, '#fff6ee', '#f0cdb8');
      for (let s = 0; s < 2; s++) for (let i = 0; i < 7; i++) {
        ctx.fillStyle = r.pick(['#ff7eb6', '#ffd23f', '#2a7de1', '#3cb371', '#b36bff', '#e8563a', '#fff']);
        ctx.beginPath();
        ctx.arc(w * (0.08 + i * 0.14), h * (0.35 + s * 0.28), h * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      goldLetters(ctx, 'KNIT A HAT FOR JIMOTHY', w, h * 0.12, h * 0.08);
      break;
    }
    case 'books':
    default: {
      interior(ctx, w, h, '#fbf0d8', '#caa77a');
      for (let s = 0; s < 3; s++) {
        let x = w * 0.04;
        const y = h * (0.12 + s * 0.22);
        while (x < w * 0.62) {
          const bw = r.range(8, 16);
          ctx.fillStyle = r.pick(['#2f5d4a', '#e8715a', '#274b7a', '#f2c14e', '#7a2e1c', '#6b4e9b']);
          ctx.fillRect(x, y, bw, h * 0.18);
          x += bw + 1;
        }
        ctx.fillStyle = '#6b4a2e';
        ctx.fillRect(w * 0.03, y + h * 0.18, w * 0.62, 4);
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(w * 0.7, h * 0.2, w * 0.24, h * 0.5);
      textLines(ctx, ['STAFF PICK:', '"ROUND"', 'by J. Raccoon'], w * 0.82, h * 0.45, w * 0.22, h * 0.07, FONT_BODY, '#2f5d4a', 1.2, { weight: '900' });
    }
  }
  glassSheen(ctx, w, h);
}

// ------------------------------------------------------------------------------------------- misc signage

export function drawYear(ctx: Ctx, w: number, h: number, text: string) {
  ctx.fillStyle = '#e9e0cc';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#a89a7c';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  fitText(ctx, text, w / 2, h / 2 + 2, w * 0.9, h * 0.62, FONT_SERIF, { fill: '#5b4a33', weight: 'bold' });
}

export function drawPlaque(ctx: Ctx, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f3d27a');
  g.addColorStop(0.5, '#c8962e');
  g.addColorStop(1, '#8a611a');
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = '#6b4a12';
  ctx.lineWidth = 8;
  roundRect(ctx, 10, 10, w - 20, h - 20, 12);
  ctx.stroke();
  for (const [x, y] of [[26, 26], [w - 26, 26], [26, h - 26], [w - 26, h - 26]]) {
    ctx.fillStyle = '#6b4a12';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  drawJimothy(ctx, w * 0.14, h * 0.5, h * 0.2, { body: '#7a5520', mask: '#3a2508', outline: '#3a2508', flat: true });
  textLines(ctx, ['On this spot, July 13 2026,', 'a nice lady thought', 'Jimothy was a cat.'], w * 0.58, h * 0.46, w * 0.78, h * 0.13, FONT_SERIF, '#3a2508', 1.22, { weight: 'bold' });
  fitText(ctx, '— He was not a cat. —', w * 0.58, h * 0.84, w * 0.6, h * 0.08, FONT_SERIF, { fill: '#4a3210', weight: 'italic bold' });
}

export const BOARD_JOKES: string[][] = [
  ['TODAY:', 'COFFEE', 'TOMORROW:', 'ALSO COFFEE'],
  ['RACCOONS', 'WELCOME*', '', '*not really'],
  ['OUR BUNS', 'ARE AS ROUND', 'AS JIMOTHY', '(almost)'],
  ['FREE WIFI', 'password:', 'pleasedont', 'approachjimothy'],
  ['HOT DOGS $3', 'ROUND ONES', '$4', 'no raccoons'],
  ['WASH YOUR', 'HANDS', 'like Jimothy', 'does'],
];

export function drawBoard(ctx: Ctx, w: number, h: number, lines: string[], i: number) {
  ctx.fillStyle = '#6b4a2e';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#20282a';
  ctx.fillRect(w * 0.06, h * 0.05, w * 0.88, h * 0.9);
  const colors = ['#fff', '#ffd23f', '#9ff7d0', '#ff9fd2'];
  const size = h * 0.11;
  let y = h * 0.2;
  lines.forEach((l, k) => {
    if (l) fitText(ctx, l, w / 2, y, w * 0.8, k === 3 && l.startsWith('*') ? size * 0.6 : size, FONT_SIGN, { fill: colors[(k + i) % colors.length] });
    y += h * 0.19;
  });
  sparkle(ctx, w * 0.2, h * 0.9, h * 0.035, '#ffd23f');
  sparkle(ctx, w * 0.8, h * 0.88, h * 0.03, '#fff');
}

export function drawCartSign(ctx: Ctx, w: number, h: number, kind: 'cotton' | 'hotdog') {
  if (kind === 'cotton') {
    ctx.fillStyle = '#ff9fd2';
    roundRect(ctx, 0, 0, w, h, h * 0.2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    roundRect(ctx, h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.15);
    ctx.fill();
    fitText(ctx, 'COTTON CANDY', w / 2, h * 0.42, w * 0.86, h * 0.36, FONT_TITLE, { fill: '#ff4fa0' });
    fitText(ctx, 'DO NOT WASH', w / 2, h * 0.76, w * 0.8, h * 0.2, FONT_BODY, { fill: '#9b2d66', weight: '900' });
  } else {
    ctx.fillStyle = '#d4312b';
    roundRect(ctx, 0, 0, w, h, h * 0.2);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    roundRect(ctx, h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.15);
    ctx.fill();
    fitText(ctx, 'HOT DOGS', w / 2, h * 0.42, w * 0.86, h * 0.4, FONT_TITLE, { fill: '#b3261e' });
    fitText(ctx, 'ROUND ONES EXTRA', w / 2, h * 0.76, w * 0.8, h * 0.2, FONT_BODY, { fill: '#6b1410', weight: '900' });
  }
}

export function drawHomeSign(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#9a6b3e';
  roundRect(ctx, 0, 0, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = '#6b4424';
  ctx.lineWidth = 4;
  for (let y = h * 0.33; y < h; y += h * 0.33) {
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(w - 4, y);
    ctx.stroke();
  }
  fitText(ctx, 'HOME', w * 0.44, h * 0.55, w * 0.7, h * 0.62, FONT_TITLE, { fill: '#fff4d6', stroke: '#4a2c12', strokeW: 6 });
  ctx.fillStyle = '#ff4f6d';
  ctx.beginPath();
  const x = w * 0.87,
    y = h * 0.5,
    s = h * 0.2;
  ctx.moveTo(x, y + s);
  ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.6, y - s * 1.4, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s);
  ctx.fill();
}

export function drawCommonsSign(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#2f5d4a';
  roundRect(ctx, 0, 0, w, h, h * 0.2);
  ctx.fill();
  ctx.strokeStyle = '#e8c25a';
  ctx.lineWidth = 6;
  roundRect(ctx, 8, 8, w - 16, h - 16, h * 0.16);
  ctx.stroke();
  drawJimothy(ctx, h * 0.5, h * 0.5, h * 0.31, { flat: true });
  // lettering starts just past his nose (his tail is a short puff on the left), inside the gold border
  const tx0 = h * 0.94,
    tx1 = w - 26;
  fitText(ctx, 'JIMOTHY COMMONS', (tx0 + tx1) / 2, h * 0.42, tx1 - tx0, h * 0.34, FONT_SIGN, { fill: '#fdf3d7' });
  fitText(ctx, 'A public plaza. Please do not approach the raccoon.', (tx0 + tx1) / 2, h * 0.74, tx1 - tx0, h * 0.13, FONT_BODY, { fill: '#e8c25a', weight: '800' });
}

export function drawClockFace(ctx: Ctx, w: number, h: number) {
  const x = w / 2,
    y = h / 2,
    r = w * 0.46;
  ctx.fillStyle = '#1f2d27';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fbf6e9';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b8923f';
  ctx.lineWidth = w * 0.04;
  ctx.stroke();
  ctx.fillStyle = '#222';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, w * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }
  // hands: always 10:10 (it's always coffee time)
  ctx.strokeStyle = '#222';
  ctx.lineCap = 'round';
  ctx.lineWidth = w * 0.035;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - r * 0.35, y - r * 0.28);
  ctx.stroke();
  ctx.lineWidth = w * 0.025;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + r * 0.5, y - r * 0.42);
  ctx.stroke();
  fitText(ctx, 'BALLARD', x, y + r * 0.45, r, w * 0.07, FONT_SERIF, { fill: '#5b4a33', weight: 'bold' });
}

export function drawParkingSign(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#fff';
  roundRect(ctx, 0, 0, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = '#1b5fae';
  ctx.lineWidth = 10;
  roundRect(ctx, 8, 8, w - 16, h - 16, 12);
  ctx.stroke();
  ctx.fillStyle = '#1b5fae';
  fitText(ctx, 'P', w * 0.2, h * 0.48, w * 0.3, h * 0.6, FONT_SIGN, { fill: '#1b5fae' });
  textLines(ctx, ['CUSTOMER', 'PARKING ONLY'], w * 0.62, h * 0.36, w * 0.6, h * 0.14, FONT_SIGN, '#1d1d1d', 1.15);
  fitText(ctx, 'Violators will be washed.', w * 0.6, h * 0.78, w * 0.66, h * 0.09, FONT_BODY, { fill: '#c62f2f', weight: '900' });
}

export function drawMarketBanner(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#f3efe6';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e8563a';
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + 20, h * 0.8);
    ctx.lineTo(x + 40, h);
    ctx.fill();
  }
  fitText(ctx, 'BALLARD SUNDAY MARKET', w / 2, h * 0.42, w * 0.9, h * 0.44, FONT_SIGN, { fill: '#2f5d4a' });
}
