import * as THREE from 'three';
import { drawJimothy, FONT_BODY, FONT_TITLE, sparkle, fitText } from './signs';
import { canvas, canvasTexture, cached } from './textures';
import { Rng } from './util';

/**
 * The Jimothy mural: the real Jimothy mid-stride (drawJimothy), sparkles and "JIMOTHY SUMMER" lettering,
 * painted over a Seattle sunset (mountain, Space Noodle, bay). Drawn once on a 2048×1232 canvas.
 */
export function muralTexture(): THREE.Texture {
  return cached('tex:mural', () => {
    const W = 2048,
      H = 1232;
    const { c, ctx } = canvas(W, H);
    const r = new Rng(713);
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#3e8ede');
    sky.addColorStop(0.45, '#8fd3f0');
    sky.addColorStop(0.7, '#ffd36b');
    sky.addColorStop(1, '#ff8a5c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // sunburst behind the raccoon
    const cx = W * 0.5,
      cy = H * 0.47;
    const R0 = 300;
    for (let i = 0; i < 28; i++) {
      const a0 = (i / 28) * Math.PI * 2;
      const a1 = a0 + Math.PI / 28;
      ctx.fillStyle = i % 2 ? 'rgba(255,240,170,0.45)' : 'rgba(255,200,90,0.25)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * 1600, cy + Math.sin(a0) * 1600);
      ctx.lineTo(cx + Math.cos(a1) * 1600, cy + Math.sin(a1) * 1600);
      ctx.fill();
    }
    // mountain (left)
    ctx.fillStyle = '#6f7fb8';
    ctx.beginPath();
    ctx.moveTo(-50, H * 0.84);
    ctx.lineTo(W * 0.18, H * 0.5);
    ctx.lineTo(W * 0.24, H * 0.54);
    ctx.lineTo(W * 0.44, H * 0.86);
    ctx.fill();
    ctx.fillStyle = '#f7fbff';
    ctx.beginPath();
    ctx.moveTo(W * 0.13, H * 0.585);
    ctx.lineTo(W * 0.18, H * 0.5);
    ctx.lineTo(W * 0.24, H * 0.54);
    ctx.lineTo(W * 0.275, H * 0.6);
    ctx.lineTo(W * 0.24, H * 0.585);
    ctx.lineTo(W * 0.2, H * 0.61);
    ctx.lineTo(W * 0.17, H * 0.58);
    ctx.fill();
    // city silhouette + Space Noodle (right)
    ctx.fillStyle = '#34476e';
    let x = W * 0.58;
    while (x < W) {
      const bw = r.range(60, 130),
        bh = r.range(120, 300);
      ctx.fillRect(x, H * 0.86 - bh, bw, bh);
      x += bw + r.range(4, 20);
    }
    const nx = W * 0.82;
    ctx.fillStyle = '#2a3a5c';
    ctx.fillRect(nx - 14, H * 0.3, 28, H * 0.56);
    ctx.beginPath();
    ctx.ellipse(nx, H * 0.3, 130, 32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(nx - 5, H * 0.15, 10, H * 0.15);
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 9;
    for (let k = 0; k < 9; k++) {
      ctx.beginPath();
      ctx.moveTo(nx - 22, H * (0.36 + k * 0.055));
      ctx.quadraticCurveTo(nx, H * (0.39 + k * 0.055), nx + 22, H * (0.36 + k * 0.055));
      ctx.stroke();
    }
    // bay
    const sea = ctx.createLinearGradient(0, H * 0.84, 0, H);
    sea.addColorStop(0, '#2b7fb0');
    sea.addColorStop(1, '#1d4f7a');
    ctx.fillStyle = sea;
    ctx.fillRect(0, H * 0.84, W, H * 0.16);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 6;
    for (let k = 0; k < 16; k++) {
      const wx = r.range(0, W),
        wy = r.range(H * 0.88, H * 0.98);
      ctx.beginPath();
      ctx.arc(wx, wy, 26, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    // the round boy
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx + 20, cy + R0 + 30, R0 * 0.9, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    drawJimothy(ctx, cx, cy, R0, { outline: '#1b1b22' });
    // sparkles
    for (let k = 0; k < 26; k++) {
      const a = r.range(0, Math.PI * 2),
        d = r.range(R0 + 70, 900);
      const sx = cx + Math.cos(a) * d,
        sy = cy + Math.sin(a) * d * 0.62;
      if (sy < 60 || sy > H - 40) continue;
      sparkle(ctx, sx, sy, r.range(16, 44), r.pick(['#ffffff', '#fff3a0', '#ffe0f4']));
    }
    // lettering
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowOffsetX = 10;
    ctx.shadowOffsetY = 14;
    arcText(ctx, 'JIMOTHY', cx, 1465, 1300, 190, '#ffe14d', '#b3261e', 26, -0.42, 0.42);
    ctx.restore();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowOffsetX = 8;
    ctx.shadowOffsetY = 10;
    fitText(ctx, 'SUMMER', cx, cy + R0 + 125, 900, 170, FONT_TITLE, { fill: '#ff5d8f', stroke: '#5a1030', strokeW: 24 });
    ctx.restore();
    // ribbon
    ctx.fillStyle = '#b3261e';
    ctx.beginPath();
    ctx.moveTo(W * 0.3, H * 0.93);
    ctx.lineTo(W * 0.7, H * 0.93);
    ctx.lineTo(W * 0.68, H * 0.975);
    ctx.lineTo(W * 0.7, H * 1.02);
    ctx.lineTo(W * 0.3, H * 1.02);
    ctx.lineTo(W * 0.32, H * 0.975);
    ctx.fill();
    fitText(ctx, "HE'S ROUND.  HE'S REAL.  HE'S OURS.  ·  2026", W / 2, H * 0.972, W * 0.36, 44, FONT_BODY, { fill: '#fff', weight: '900' });
    // painted-on-brick texture: faint mortar lines + brush grain
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = '#000';
    const course = 26;
    for (let y = 0; y < H; y += course) {
      ctx.fillRect(0, y, W, 3);
      const off = (y / course) % 2 ? 0 : 55;
      for (let bx = off; bx < W; bx += 110) ctx.fillRect(bx, y, 3, course);
    }
    ctx.globalAlpha = 0.05;
    for (let k = 0; k < 3000; k++) {
      ctx.fillStyle = r.chance(0.5) ? '#fff' : '#000';
      ctx.fillRect(r.range(0, W), r.range(0, H), r.range(2, 9), r.range(1, 3));
    }
    ctx.globalAlpha = 1;
    // artist tag
    fitText(ctx, 'painted with love by the neighbors', W - 330, H - 30, 600, 30, FONT_BODY, { fill: 'rgba(255,255,255,0.85)', weight: '800' });
    const t = canvasTexture(c, { repeat: false });
    t.generateMipmaps = true;
    return t;
  });
}

/** Text along a circular arc centred at (cx, cy) with radius R, spanning angles a0..a1 (0 = up). */
function arcText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, R: number, size: number, fill: string, stroke: string, strokeW: number, a0: number, a1: number) {
  ctx.font = `${size}px ${FONT_TITLE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * (i + 0.5)) / n;
    ctx.save();
    ctx.translate(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
    ctx.rotate(a);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeW;
    ctx.strokeText(text[i], 0, 0);
    ctx.fillStyle = fill;
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }
}
