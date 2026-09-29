import { assetUrl } from '../../core/Assets';

/**
 * Canvas art for the slop content. The AI images are glossy, over-saturated and subtly wrong (extra eyes, six
 * fingers, garbled text); the "human made" reveals are warm, painterly and round.
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

// ------------------------------------------------------------------ raccoons

/** Front view of a round raccoon centred at (x, y) with body radius r. */
function raccoon(ctx: Ctx, x: number, y: number, r: number, style: 'painted' | 'slop', rand: () => number) {
  const slop = style === 'slop';
  const fur = slop ? '#9b8fb0' : '#8b8178';
  const furDark = slop ? '#5d4f78' : '#6e655d';
  const belly = slop ? '#efe3ff' : '#d9d0c3';
  const mask = slop ? '#1b1030' : '#231e1b';
  const white = slop ? '#ffffff' : '#f3efe7';
  // tail peeking out on the right
  ctx.save();
  ctx.translate(x + r * 0.78, y + r * 0.45);
  ctx.rotate(-0.5);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? (slop ? '#2d1f45' : '#2e2723') : slop ? '#c7b7e2' : '#b6ab9c';
    ellipse(ctx, r * 0.18 * i, -r * 0.05 * i, r * 0.2, r * 0.17);
    ctx.fill();
  }
  ctx.restore();
  // ears
  for (const s of [-1, 1]) {
    ctx.fillStyle = furDark;
    ellipse(ctx, x + s * r * 0.55, y - r * 0.82, r * 0.22, r * 0.2);
    ctx.fill();
    ctx.fillStyle = white;
    ellipse(ctx, x + s * r * 0.55, y - r * 0.8, r * 0.13, r * 0.11);
    ctx.fill();
  }
  // body ball
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.15, x, y, r * 1.05);
  g.addColorStop(0, slop ? '#d6ccef' : '#a39a90');
  g.addColorStop(0.6, fur);
  g.addColorStop(1, furDark);
  ctx.fillStyle = g;
  ellipse(ctx, x, y, r, r * 0.97);
  ctx.fill();
  if (!slop) {
    // painterly fur strokes
    ctx.strokeStyle = 'rgba(60,50,45,0.25)';
    ctx.lineWidth = Math.max(1, r * 0.012);
    for (let i = 0; i < 220; i++) {
      const a = rand() * TAU;
      const d = Math.sqrt(rand()) * r * 0.95;
      const px = x + Math.cos(a) * d;
      const py = y + Math.sin(a) * d;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * r * 0.06, py + Math.sin(a) * r * 0.06 + r * 0.02);
      ctx.stroke();
    }
  }
  // belly
  ctx.fillStyle = belly;
  ellipse(ctx, x, y + r * 0.45, r * 0.55, r * 0.4);
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  // mask band
  ctx.fillStyle = mask;
  ellipse(ctx, x - r * 0.3, y - r * 0.28, r * 0.3, r * 0.17, 0.25);
  ctx.fill();
  ellipse(ctx, x + r * 0.3, y - r * 0.28, r * 0.3, r * 0.17, -0.25);
  ctx.fill();
  ctx.fillRect(x - r * 0.12, y - r * 0.36, r * 0.24, r * 0.12);
  // brows
  ctx.fillStyle = white;
  ellipse(ctx, x - r * 0.3, y - r * 0.5, r * 0.2, r * 0.07, 0.15);
  ctx.fill();
  ellipse(ctx, x + r * 0.3, y - r * 0.5, r * 0.2, r * 0.07, -0.15);
  ctx.fill();
  // eyes
  const eye = (ex: number, ey: number, er: number) => {
    ctx.fillStyle = '#050404';
    ellipse(ctx, ex, ey, er, er);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ellipse(ctx, ex - er * 0.3, ey - er * 0.35, er * 0.3, er * 0.3);
    ctx.fill();
  };
  if (slop) {
    eye(x - r * 0.3, y - r * 0.27, r * 0.11);
    eye(x + r * 0.33, y - r * 0.25, r * 0.08); // mismatched
    eye(x + r * 0.02, y - r * 0.55, r * 0.07); // extra
  } else {
    eye(x - r * 0.3, y - r * 0.28, r * 0.075);
    eye(x + r * 0.3, y - r * 0.28, r * 0.075);
  }
  // muzzle + nose + smile
  ctx.fillStyle = white;
  ellipse(ctx, x + (slop ? r * 0.05 : 0), y - r * 0.06, r * 0.22, r * (slop ? 0.2 : 0.15));
  ctx.fill();
  ctx.fillStyle = '#161212';
  ellipse(ctx, x + (slop ? r * 0.07 : 0), y - r * 0.13, r * 0.07, r * 0.05);
  ctx.fill();
  ctx.strokeStyle = '#161212';
  ctx.lineWidth = Math.max(1.5, r * 0.02);
  ctx.beginPath();
  ctx.arc(x - r * 0.04, y - r * 0.04, r * 0.05, 0.2, Math.PI - 0.2);
  ctx.arc(x + r * 0.06, y - r * 0.04, r * 0.05, 0.2, Math.PI - 0.2);
  ctx.stroke();
  // tiny hands
  const hand = (hx: number, hy: number, fingers: number, up = false) => {
    ctx.fillStyle = mask;
    ellipse(ctx, hx, hy, r * 0.1, r * 0.08);
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.strokeStyle = mask;
    ctx.lineWidth = Math.max(2, r * 0.035);
    for (let f = 0; f < fingers; f++) {
      const a = (up ? -Math.PI / 2 : Math.PI / 2) + (f - (fingers - 1) / 2) * 0.32;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.cos(a) * r * 0.16, hy + Math.sin(a) * r * 0.16);
      ctx.stroke();
    }
  };
  if (slop) {
    hand(x - r * 0.95, y - r * 0.35, 6, true);
    hand(x + r * 0.98, y - r * 0.4, 7, true);
  } else {
    hand(x - r * 0.22, y + r * 0.62, 5);
    hand(x + r * 0.22, y + r * 0.62, 5);
  }
  // feet
  ctx.fillStyle = mask;
  ellipse(ctx, x - r * 0.4, y + r * 0.95, r * 0.14, r * 0.07);
  ctx.fill();
  ellipse(ctx, x + r * 0.4, y + r * 0.95, r * 0.14, r * 0.07);
  ctx.fill();
  if (slop) {
    // a third foot, why not
    ellipse(ctx, x + r * 0.02, y + r * 1.0, r * 0.12, r * 0.06);
    ctx.fill();
    // glossy rim light
    const rim = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    rim.addColorStop(0, 'rgba(255,120,240,0.55)');
    rim.addColorStop(0.5, 'rgba(120,255,255,0.0)');
    rim.addColorStop(1, 'rgba(255,230,90,0.55)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = r * 0.06;
    ellipse(ctx, x, y, r * 1.0, r * 0.97);
    ctx.stroke();
  }
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
  // the "Jimothy", casting spells
  raccoon(ctx, w * 0.3, h * 0.6, h * 0.3, 'slop', r);
  // wizard hat
  ctx.fillStyle = '#3b1e8c';
  ctx.beginPath();
  ctx.moveTo(w * 0.3 - h * 0.2, h * 0.35);
  ctx.lineTo(w * 0.3 + h * 0.2, h * 0.35);
  ctx.lineTo(w * 0.33, h * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffe36e';
  for (let i = 0; i < 6; i++) sparkle(ctx, w * 0.27 + r() * h * 0.2, h * 0.12 + r() * h * 0.2, 6 + r() * 6, '#ffe36e');
  // spells
  lightning(ctx, w * 0.3 - h * 0.28, h * 0.45, h * 0.4, r);
  lightning(ctx, w * 0.3 + h * 0.3, h * 0.42, h * 0.38, r);
  for (let i = 0; i < 40; i++) sparkle(ctx, r() * w, r() * h, 3 + r() * 9, r() < 0.5 ? '#ffffff' : '#9ffcff');
  // headline + garbled copy
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  glossyText(ctx, 'JIMOTHY: REAL & ROUND', w * 0.72, h * 0.62, h * 0.16, w * 0.52);
  ctx.font = `800 ${Math.round(h * 0.06)}px Nunito, system-ui, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Offical Jimothy Summmer 20§6 — Now With Extra Leggs!', w * 0.72, h * 0.73);
  ctx.font = `700 ${Math.round(h * 0.045)}px Nunito, system-ui, sans-serif`;
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
  // Jimothy, as he actually is: round
  raccoon(ctx, w * 0.27, h * 0.56, h * 0.3, 'painted', r);
  // hand lettering
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.save();
  ctx.translate(w * 0.69, h * 0.45);
  ctx.rotate(-0.04);
  ctx.font = `${Math.round(h * 0.25)}px "Luckiest Guy", Impact, sans-serif`;
  ctx.fillStyle = '#3a2a1c';
  ctx.fillText('HUMAN MADE', 4, 6);
  ctx.fillStyle = '#c0392b';
  ctx.fillText('HUMAN MADE', 0, 0);
  ctx.restore();
  ctx.font = `800 ${Math.round(h * 0.075)}px Nunito, Georgia, serif`;
  ctx.fillStyle = '#3a2a1c';
  ctx.fillText('Jimothy, actual size: round.', w * 0.69, h * 0.64);
  ctx.font = `italic 700 ${Math.round(h * 0.05)}px Nunito, Georgia, serif`;
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
  raccoon(ctx, w * 0.5, h * 0.55, w * 0.28, 'slop', r);
  // magic circle
  ctx.strokeStyle = 'rgba(125,249,255,0.8)';
  ctx.lineWidth = 4;
  ellipse(ctx, w * 0.5, h * 0.84, w * 0.42, h * 0.05);
  ctx.stroke();
  lightning(ctx, w * 0.2, h * 0.45, h * 0.25, r);
  lightning(ctx, w * 0.8, h * 0.44, h * 0.25, r);
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
  raccoon(ctx, w * 0.5, h * 0.52, w * 0.3, 'painted', r);
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(w * 0.14)}px "Luckiest Guy", Impact, sans-serif`;
  ctx.fillStyle = '#c0392b';
  ctx.fillText('HUMAN MADE', w * 0.5, h * 0.16);
  ctx.font = `800 ${Math.round(w * 0.055)}px Nunito, Georgia, serif`;
  ctx.fillStyle = '#3a2a1c';
  ctx.fillText('Jimothy casting: nothing. He is a raccoon.', w * 0.5, h * 0.9);
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
