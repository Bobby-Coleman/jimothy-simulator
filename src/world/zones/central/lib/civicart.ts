import { drawRoundRaccoon, fitText, FONT_BODY, FONT_SERIF, FONT_SIGN, FONT_TITLE, roundRect, sparkle, textLines } from './signs';

/** Canvas art for Downtown: City Hall banners, flags, statue plaque, Noodle signage, tower lobby signs. */
type Ctx = CanvasRenderingContext2D;

export function drawFriezeBanner(ctx: Ctx, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#b3261e');
  g.addColorStop(1, '#7a1410');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#f2c14e';
  ctx.lineWidth = h * 0.06;
  ctx.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
  drawRoundRaccoon(ctx, h * 0.62, h / 2, h * 0.32, { sunglasses: true });
  drawRoundRaccoon(ctx, w - h * 0.62, h / 2, h * 0.32, { sunglasses: true });
  fitText(ctx, 'JIMOTHY SUMMER', w * 0.5, h * 0.4, w * 0.7, h * 0.46, FONT_TITLE, { fill: '#ffe14d', stroke: '#4a0a06', strokeW: h * 0.06 });
  fitText(ctx, '— OFFICIAL PROCLAMATION —', w * 0.5, h * 0.78, w * 0.6, h * 0.17, FONT_SERIF, { fill: '#fff4d6', weight: 'bold' });
}

export function drawVerticalBanner(ctx: Ctx, w: number, h: number, i: number) {
  ctx.fillStyle = i % 2 ? '#1b5fae' : '#2f5d4a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w / 2, h * 0.93);
  ctx.lineTo(w, h);
  ctx.fill();
  drawRoundRaccoon(ctx, w / 2, h * 0.3, w * 0.3);
  fitText(ctx, 'JIMOTHY', w / 2, h * 0.58, w * 0.9, w * 0.22, FONT_TITLE, { fill: '#fff' });
  fitText(ctx, 'SUMMER', w / 2, h * 0.68, w * 0.9, w * 0.2, FONT_TITLE, { fill: '#ffe14d' });
  fitText(ctx, '2026', w / 2, h * 0.8, w * 0.7, w * 0.16, FONT_SIGN, { fill: '#fff' });
}

export const FLAG_COUNT = 4;
export function drawFlag(ctx: Ctx, w: number, h: number, i: number) {
  switch (i % FLAG_COUNT) {
    case 0: {
      // "City of Ballard-ish" flag: green field, round raccoon seal
      ctx.fillStyle = '#1e7a4f';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, h * 0.36, 0, Math.PI * 2);
      ctx.fill();
      drawRoundRaccoon(ctx, w / 2, h / 2 + h * 0.02, h * 0.24, { flat: true });
      break;
    }
    case 1: {
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff7a59';
      ctx.fillRect(0, h * 0.7, w, h * 0.3);
      fitText(ctx, 'JIMOTHY', w / 2, h * 0.3, w * 0.9, h * 0.3, FONT_TITLE, { fill: '#b3261e' });
      fitText(ctx, 'SUMMER', w / 2, h * 0.55, w * 0.9, h * 0.24, FONT_TITLE, { fill: '#b3261e' });
      break;
    }
    case 2: {
      // Pride-in-roundness: concentric circles
      const cols = ['#e8563a', '#ffd23f', '#3cb371', '#2a7de1', '#8f3fbf'];
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      cols.forEach((c, k) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, h * (0.46 - k * 0.08), 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    default: {
      ctx.fillStyle = '#274b7a';
      ctx.fillRect(0, 0, w, h);
      for (let k = 0; k < 9; k++) sparkle(ctx, w * (0.1 + (k % 3) * 0.1), h * (0.15 + Math.floor(k / 3) * 0.15), h * 0.05, '#fff');
      ctx.fillStyle = '#fff';
      for (let k = 0; k < 4; k++) ctx.fillRect(w * 0.42, h * (0.08 + k * 0.23), w * 0.58, h * 0.1);
      drawRoundRaccoon(ctx, w * 0.2, h * 0.75, h * 0.14, { flat: true });
    }
  }
}

export function drawStatuePlaque(ctx: Ctx, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#d9a55a');
  g.addColorStop(1, '#7a4f1c');
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = '#4a2c0c';
  ctx.lineWidth = 8;
  roundRect(ctx, 10, 10, w - 20, h - 20, 10);
  ctx.stroke();
  fitText(ctx, 'JIMOTHY', w / 2, h * 0.26, w * 0.8, h * 0.24, FONT_SERIF, { fill: '#2e1a06', weight: 'bold' });
  textLines(ctx, ['Round. Real. Ours.', 'Resident of Ballard · Honorary Graduate', 'Please do not approach (the real one).'], w / 2, h * 0.64, w * 0.86, h * 0.1, FONT_SERIF, '#2e1a06', 1.3, { weight: 'bold' });
}

export function drawCitySeal(ctx: Ctx, w: number, h: number) {
  const r = Math.min(w, h) / 2;
  ctx.fillStyle = '#d4a017';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, r * 0.98, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f2d4d';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, r * 0.84, 0, Math.PI * 2);
  ctx.fill();
  drawRoundRaccoon(ctx, w / 2, h / 2 + r * 0.05, r * 0.45, { flat: true });
  ctx.fillStyle = '#d4a017';
  ctx.font = `bold ${r * 0.14}px ${FONT_SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText('CITY HALL', w / 2, h / 2 - r * 0.58);
}

export function drawNoodleSign(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#274b7a';
  roundRect(ctx, 0, 0, w, h, h * 0.1);
  ctx.fill();
  ctx.fillStyle = '#f2c14e';
  roundRect(ctx, h * 0.05, h * 0.05, w - h * 0.1, h * 0.3, h * 0.06);
  ctx.fill();
  fitText(ctx, 'SPACE NOODLE', w / 2, h * 0.2, w * 0.9, h * 0.24, FONT_TITLE, { fill: '#274b7a' });
  textLines(ctx, ['Stairs: closed.', 'Elevator: broken.', 'Climbing: at your own risk.', '(Ledges every 15 m. Ladder + rest landings: east side.)'], w / 2, h * 0.68, w * 0.9, h * 0.085, FONT_BODY, '#fff', 1.35, { weight: '800' });
}

export function drawCafeSign(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#f2c14e';
  roundRect(ctx, 0, 0, w, h, h * 0.2);
  ctx.fill();
  fitText(ctx, 'NOODLE TOP CAFÉ', w / 2, h * 0.45, w * 0.9, h * 0.5, FONT_SIGN, { fill: '#274b7a' });
  fitText(ctx, 'spinning slowly since 1962-ish', w / 2, h * 0.8, w * 0.8, h * 0.18, FONT_BODY, { fill: '#274b7a', weight: '800' });
}

export function drawLobbySign(ctx: Ctx, w: number, h: number, name: string) {
  ctx.fillStyle = '#1d2733';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#9fd3ff';
  ctx.fillRect(0, h - 6, w, 6);
  fitText(ctx, name.toUpperCase(), w / 2, h * 0.52, w * 0.9, h * 0.52, FONT_SIGN, { fill: '#e8f4ff' });
}

export function drawNewsVanLogo(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#c62f2f';
  roundRect(ctx, 6, 6, h - 12, h - 12, 12);
  ctx.fill();
  fitText(ctx, '7', h / 2, h / 2 + 4, h * 0.7, h * 0.7, FONT_TITLE, { fill: '#fff' });
  fitText(ctx, 'RACCOON WATCH NEWS', w / 2 + h * 0.4, h * 0.5, w - h * 1.2, h * 0.34, FONT_SIGN, { fill: '#1d1d1d' });
}
