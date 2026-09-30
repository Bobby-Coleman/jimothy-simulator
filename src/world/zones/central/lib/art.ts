import { drawJimothy, fitText, FONT_BODY, FONT_SIGN, FONT_TITLE, roundRect, sparkle, textLines } from './signs';

/**
 * Canvas art for ads, posters and street signs. Every function draws into a (w × h) region.
 * All brands are parody names (see DESIGN.md §5).
 */

type Ctx = CanvasRenderingContext2D;

export function streetBlade(ctx: Ctx, w: number, h: number, name: string) {
  ctx.fillStyle = '#1f6e43';
  roundRect(ctx, 0, 0, w, h, h * 0.18);
  ctx.fill();
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = h * 0.06;
  roundRect(ctx, h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.12);
  ctx.stroke();
  fitText(ctx, name, w / 2, h * 0.54, w - h * 0.5, h * 0.62, FONT_SIGN, { fill: '#fff' });
}

export function busStopSign(ctx: Ctx, w: number, h: number, route: string) {
  ctx.fillStyle = '#f2f2f2';
  roundRect(ctx, 0, 0, w, h, 14);
  ctx.fill();
  ctx.fillStyle = '#e03a3e';
  roundRect(ctx, 8, 8, w - 16, h * 0.36, 10);
  ctx.fill();
  fitText(ctx, 'BUS STOP', w / 2, 8 + h * 0.18, w - 30, h * 0.24, FONT_SIGN, { fill: '#fff' });
  fitText(ctx, route, w / 2, h * 0.62, w - 30, h * 0.2, FONT_SIGN, { fill: '#1d1d1d' });
  drawJimothy(ctx, w / 2, h * 0.84, h * 0.09, { flat: true });
}

export const AD_COUNT = 7;

/** Bus-stop / billboard ads (portrait w:h ≈ 2:3). */
export function drawAd(ctx: Ctx, w: number, h: number, i: number) {
  switch (i % AD_COUNT) {
    case 0: {
      // Jimothy Summer
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffcf4a');
      g.addColorStop(1, '#ff7a59');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let k = 0; k < 12; k++) {
        ctx.save();
        ctx.translate(w / 2, h * 0.45);
        ctx.rotate((k / 12) * Math.PI * 2);
        ctx.fillRect(0, -6, w, 12);
        ctx.restore();
      }
      drawJimothy(ctx, w / 2, h * 0.45, w * 0.26, { sunglasses: true });
      fitText(ctx, 'JIMOTHY', w / 2, h * 0.1, w * 0.9, w * 0.2, FONT_TITLE, { fill: '#fff', stroke: '#b3261e', strokeW: 10 });
      fitText(ctx, 'SUMMER', w / 2, h * 0.2, w * 0.9, w * 0.16, FONT_TITLE, { fill: '#fff', stroke: '#b3261e', strokeW: 8 });
      textLines(ctx, ['Officially proclaimed by the City.', 'Round by nature.'], w / 2, h * 0.84, w * 0.86, w * 0.06, FONT_BODY, '#4a1b0c', 1.25, { weight: '800' });
      break;
    }
    case 1: {
      ctx.fillStyle = '#1b5fae';
      ctx.fillRect(0, 0, w, h);
      goodwheelLogo(ctx, w / 2, h * 0.3, w * 0.22);
      fitText(ctx, 'GOODWHEEL', w / 2, h * 0.56, w * 0.9, w * 0.17, FONT_SIGN, { fill: '#fff' });
      fitText(ctx, 'THRIFT', w / 2, h * 0.66, w * 0.9, w * 0.12, FONT_SIGN, { fill: '#ffd64a' });
      textLines(ctx, ['Pre-loved. Pre-washed.*'], w / 2, h * 0.79, w * 0.9, w * 0.075, FONT_BODY, '#fff', 1.2, { weight: '800' });
      textLines(ctx, ['*by a raccoon'], w / 2, h * 0.9, w * 0.9, w * 0.05, FONT_BODY, '#cfe2ff', 1.2, { weight: '700' });
      break;
    }
    case 2: {
      ctx.fillStyle = '#0f2a4a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1e7a4f';
      ctx.fillRect(0, h * 0.62, w, h * 0.38);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.36, w * 0.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.36, w * 0.19, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d4312b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2 - w * 0.28, h * 0.36, w * 0.2, -0.6, 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w / 2 + w * 0.28, h * 0.36, w * 0.2, Math.PI - 0.6, Math.PI + 0.6);
      ctx.stroke();
      fitText(ctx, 'JIMOTHY NIGHT', w / 2, h * 0.1, w * 0.92, w * 0.13, FONT_TITLE, { fill: '#ffd64a' });
      fitText(ctx, 'BALLARD BARNACLES', w / 2, h * 0.7, w * 0.9, w * 0.085, FONT_SIGN, { fill: '#fff' });
      fitText(ctx, 'TEE-HEE PARK · AUG 5', w / 2, h * 0.8, w * 0.9, w * 0.07, FONT_SIGN, { fill: '#ffd64a' });
      fitText(ctx, 'Free rookie cards!*', w / 2, h * 0.9, w * 0.9, w * 0.055, FONT_BODY, { fill: '#fff', weight: '800' });
      break;
    }
    case 3: {
      // SlopCorp ad (glitchy)
      ctx.fillStyle = '#12131a';
      ctx.fillRect(0, 0, w, h);
      for (let k = 0; k < 14; k++) {
        ctx.fillStyle = `hsla(${(k * 47) % 360},90%,60%,0.25)`;
        ctx.fillRect(0, (k / 14) * h, w, 4 + (k % 3) * 3);
      }
      fitText(ctx, 'SLOPCORP', w / 2, h * 0.12, w * 0.9, w * 0.16, FONT_TITLE, { fill: '#7cf7ff' });
      drawJimothy(ctx, w / 2, h * 0.42, w * 0.2, { body: '#9b7bd6', mask: '#2a1850' });
      // too many eyes
      ctx.fillStyle = '#fff';
      for (const [x, y] of [[0.43, 0.33], [0.58, 0.35], [0.5, 0.3]]) {
        ctx.beginPath();
        ctx.arc(w * x, h * y, w * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
      textLines(ctx, ["We're disrupting", 'raccoons.'], w / 2, h * 0.7, w * 0.9, w * 0.085, FONT_SIGN, '#fff');
      fitText(ctx, 'Certainly! Here is an ad.', w / 2, h * 0.88, w * 0.9, w * 0.05, FONT_BODY, { fill: '#7cf7ff', weight: '700' });
      break;
    }
    case 4: {
      ctx.fillStyle = '#f5f0e1';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2f5d3a';
      ctx.fillRect(0, 0, w, h * 0.22);
      fitText(ctx, 'PLEASE', w / 2, h * 0.08, w * 0.9, w * 0.11, FONT_SIGN, { fill: '#fff' });
      fitText(ctx, "DON'T APPROACH", w / 2, h * 0.17, w * 0.9, w * 0.09, FONT_SIGN, { fill: '#ffd64a' });
      drawJimothy(ctx, w / 2, h * 0.47, w * 0.2);
      fitText(ctx, 'JIMOTHY', w / 2, h * 0.7, w * 0.9, w * 0.14, FONT_TITLE, { fill: '#2f5d3a' });
      textLines(ctx, ["He's fine. He's wild.", "He's washing your phone."], w / 2, h * 0.82, w * 0.88, w * 0.06, FONT_BODY, '#333', 1.2, { weight: '800' });
      fitText(ctx, 'Dept. of Fish & Wiggles', w / 2, h * 0.94, w * 0.9, w * 0.05, FONT_BODY, { fill: '#2f5d3a', weight: '900' });
      break;
    }
    case 5: {
      ctx.fillStyle = '#4b2e83';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b7a57a';
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.12);
      ctx.lineTo(w * 0.85, h * 0.26);
      ctx.lineTo(w * 0.5, h * 0.4);
      ctx.lineTo(w * 0.15, h * 0.26);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(w * 0.47, h * 0.26, w * 0.06, h * 0.08);
      fitText(ctx, 'UNIVERSITY', w / 2, h * 0.52, w * 0.9, w * 0.12, FONT_SIGN, { fill: '#fff' });
      fitText(ctx, 'OF WASHING', w / 2, h * 0.62, w * 0.9, w * 0.12, FONT_SIGN, { fill: '#e8d3a2' });
      textLines(ctx, ['Now accepting', 'raccoons.'], w / 2, h * 0.8, w * 0.9, w * 0.075, FONT_BODY, '#fff', 1.2, { weight: '800' });
      break;
    }
    default: {
      ctx.fillStyle = '#e8f6ff';
      ctx.fillRect(0, 0, w, h);
      // Space Noodle
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(w * 0.47, h * 0.28, w * 0.06, h * 0.5);
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.27, w * 0.24, h * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d9962a';
      ctx.lineWidth = 5;
      for (let k = 0; k < 8; k++) {
        ctx.beginPath();
        ctx.moveTo(w * 0.44, h * (0.3 + k * 0.06));
        ctx.quadraticCurveTo(w * 0.5, h * (0.33 + k * 0.06), w * 0.56, h * (0.3 + k * 0.06));
        ctx.stroke();
      }
      sparkle(ctx, w * 0.25, h * 0.2, w * 0.05, '#f2c14e');
      sparkle(ctx, w * 0.78, h * 0.4, w * 0.04, '#f2c14e');
      fitText(ctx, 'SPACE NOODLE', w / 2, h * 0.09, w * 0.9, w * 0.13, FONT_TITLE, { fill: '#274b7a' });
      textLines(ctx, ['Climb it.', '(Please use the ladder.)'], w / 2, h * 0.87, w * 0.9, w * 0.065, FONT_BODY, '#274b7a', 1.2, { weight: '800' });
    }
  }
}

export function goodwheelLogo(ctx: Ctx, x: number, y: number, r: number, color = '#fff') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = r * 0.14;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2);
    ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
    ctx.lineWidth = r * 0.06;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  // smile
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.05, r * 0.55, 0.35, Math.PI - 0.35);
  ctx.stroke();
  ctx.restore();
}
