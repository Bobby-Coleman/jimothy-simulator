import { roundRect, fitText, FONT_DISPLAY, FONT_BOLD, FONT_BODY } from '../shared';

/** Canvas art for the museum (signs, plaques and the two masterpieces). All parody, all PG. */
type Ctx = CanvasRenderingContext2D;

function frame(c: Ctx, w: number, h: number, inner: string) {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f6d36b');
  g.addColorStop(0.5, '#b8862a');
  g.addColorStop(1, '#f2c75a');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#6b4a14';
  c.fillRect(16, 16, w - 32, h - 32);
  c.fillStyle = inner;
  c.fillRect(22, 22, w - 44, h - 44);
}

/** "Mona Lisa of Trash": a mysteriously smiling garbage bag, sfumato and all. */
export function drawMona(c: Ctx, w: number, h: number) {
  frame(c, w, h, '#5d6b45');
  // hazy landscape
  const sky = c.createLinearGradient(0, 22, 0, h * 0.6);
  sky.addColorStop(0, '#9fb08a');
  sky.addColorStop(1, '#5d6b45');
  c.fillStyle = sky;
  c.fillRect(22, 22, w - 44, h * 0.55);
  c.fillStyle = '#7b8a66';
  c.beginPath();
  c.moveTo(22, h * 0.45);
  c.quadraticCurveTo(w * 0.3, h * 0.33, w * 0.5, h * 0.42);
  c.quadraticCurveTo(w * 0.75, h * 0.5, w - 22, h * 0.38);
  c.lineTo(w - 22, h * 0.6);
  c.lineTo(22, h * 0.6);
  c.fill();
  // the bag
  const cx = w / 2;
  const by = h * 0.62;
  c.fillStyle = '#2b2d33';
  c.beginPath();
  c.ellipse(cx, by + 20, w * 0.3, h * 0.3, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(cx, by - h * 0.17, w * 0.2, h * 0.17, 0, 0, Math.PI * 2);
  c.fill();
  // the twist tie "hair"
  c.fillStyle = '#e8c33a';
  c.fillRect(cx - 18, by - h * 0.36, 36, 10);
  c.fillStyle = '#2b2d33';
  c.beginPath();
  c.moveTo(cx - 26, by - h * 0.36);
  c.lineTo(cx, by - h * 0.44);
  c.lineTo(cx + 26, by - h * 0.36);
  c.fill();
  // shine
  c.fillStyle = 'rgba(255,255,255,0.16)';
  c.beginPath();
  c.ellipse(cx - w * 0.1, by - h * 0.2, 10, 22, -0.4, 0, Math.PI * 2);
  c.fill();
  // eyes looking at you, wherever you stand
  c.fillStyle = '#f4efe2';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + s * 20, by - h * 0.17, 9, 6, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#1b1b1b';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.arc(cx + s * 20 + 3, by - h * 0.17, 3.5, 0, Math.PI * 2);
    c.fill();
  }
  // THE smile
  c.strokeStyle = '#d9c9a8';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(cx - 14, by - h * 0.1);
  c.quadraticCurveTo(cx + 2, by - h * 0.085, cx + 16, by - h * 0.115);
  c.stroke();
  // folded "hands" (a banana peel)
  c.fillStyle = '#e6cf4f';
  c.beginPath();
  c.ellipse(cx, by + h * 0.12, 30, 9, 0.15, 0, Math.PI * 2);
  c.fill();
  // varnish
  c.fillStyle = 'rgba(120,90,30,0.18)';
  c.fillRect(22, 22, w - 44, h - 44);
}

/** "The Starry Night Bin": swirly sky over a lone trash can. */
export function drawStarry(c: Ctx, w: number, h: number) {
  frame(c, w, h, '#1f3a78');
  c.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const y = 30 + (i / 26) * h * 0.6;
    c.strokeStyle = i % 3 === 0 ? '#5f86d6' : i % 3 === 1 ? '#2e56a8' : '#8fb0f0';
    c.lineWidth = 5;
    c.beginPath();
    for (let x = 22; x <= w - 22; x += 6) {
      const yy = y + Math.sin(x * 0.05 + i) * 6;
      if (x === 22) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    }
    c.stroke();
  }
  // swirls + stars
  c.strokeStyle = '#cfe0ff';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(w * 0.45, h * 0.3, 26, 0, Math.PI * 1.6);
  c.stroke();
  for (const [x, y, r] of [[0.2, 0.18, 14], [0.75, 0.2, 18], [0.6, 0.45, 11], [0.3, 0.5, 10], [0.85, 0.42, 9]] as const) {
    c.fillStyle = '#ffe36a';
    c.beginPath();
    c.arc(w * x, h * y, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,240,170,0.6)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(w * x, h * y, r + 6, 0, Math.PI * 2);
    c.stroke();
  }
  // the hills + trash can
  c.fillStyle = '#16264d';
  c.beginPath();
  c.moveTo(22, h * 0.78);
  c.quadraticCurveTo(w * 0.5, h * 0.62, w - 22, h * 0.76);
  c.lineTo(w - 22, h - 22);
  c.lineTo(22, h - 22);
  c.fill();
  c.fillStyle = '#8b97a8';
  c.fillRect(w * 0.6, h * 0.62, w * 0.16, h * 0.2);
  c.fillStyle = '#6d7888';
  c.fillRect(w * 0.585, h * 0.6, w * 0.19, 8);
  c.fillStyle = '#ffe36a';
  c.fillRect(w * 0.665, h * 0.565, 12, 10);
}

/** Small museum plaque: title + two lines of small print. */
export function plaque(title: string, line1: string, line2 = '') {
  return (c: Ctx, w: number, h: number) => {
    c.fillStyle = '#c9a24a';
    roundRect(c, 2, 2, w - 4, h - 4, 10);
    c.fill();
    c.fillStyle = '#20232b';
    roundRect(c, 10, 10, w - 20, h - 20, 7);
    c.fill();
    fitText(c, title, w / 2, h * 0.3, w * 0.86, h * 0.24, FONT_BOLD, { fill: '#f6d36b' });
    fitText(c, line1, w / 2, h * 0.58, w * 0.88, h * 0.15, FONT_BODY, { fill: '#e9e2cf' });
    if (line2) fitText(c, line2, w / 2, h * 0.79, w * 0.88, h * 0.14, FONT_BODY, { fill: '#b9b2a0' });
  };
}

/** Red-on-white notice taped to the front doors. */
export function closedSign(c: Ctx, w: number, h: number) {
  c.fillStyle = '#fbf6ea';
  roundRect(c, 4, 4, w - 8, h - 8, 14);
  c.fill();
  c.strokeStyle = '#c8322a';
  c.lineWidth = 10;
  roundRect(c, 14, 14, w - 28, h - 28, 10);
  c.stroke();
  fitText(c, 'CLOSED FOR GALA', w / 2, h * 0.36, w * 0.82, h * 0.26, FONT_DISPLAY, { fill: '#c8322a' });
  fitText(c, 'Doors locked. Absolutely no raccoons.', w / 2, h * 0.62, w * 0.82, h * 0.12, FONT_BOLD, { fill: '#33302a' });
  fitText(c, '(this means you, round boy)', w / 2, h * 0.79, w * 0.8, h * 0.1, FONT_BODY, { fill: '#6b655a' });
}

/** Tall gala banner hung between the columns. */
export function banner(lines: string[], bg: string) {
  return (c: Ctx, w: number, h: number) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#f6d36b';
    c.fillRect(0, 0, w, 10);
    c.fillRect(0, h - 10, w, 10);
    const step = (h - 40) / lines.length;
    lines.forEach((l, i) => fitText(c, l, w / 2, 26 + step * (i + 0.5), w * 0.84, Math.min(step * 0.7, 54), FONT_DISPLAY, { fill: i % 2 ? '#f6d36b' : '#fff7e0' }));
  };
}

/** Tiny HUD-free hazard sign for the laser hallway. */
export function hazardSign(title: string, sub: string) {
  return (c: Ctx, w: number, h: number) => {
    c.fillStyle = '#1d1a26';
    roundRect(c, 2, 2, w - 4, h - 4, 12);
    c.fill();
    c.fillStyle = '#ffd23f';
    for (let x = -h; x < w; x += 36) {
      c.beginPath();
      c.moveTo(x, h);
      c.lineTo(x + 18, h);
      c.lineTo(x + 18 + h * 0.18, h - h * 0.18);
      c.lineTo(x + h * 0.18, h - h * 0.18);
      c.fill();
    }
    fitText(c, title, w / 2, h * 0.34, w * 0.86, h * 0.3, FONT_DISPLAY, { fill: '#ff5a4a', stroke: '#000', strokeW: 4 });
    fitText(c, sub, w / 2, h * 0.62, w * 0.86, h * 0.14, FONT_BOLD, { fill: '#fff4d8' });
  };
}
