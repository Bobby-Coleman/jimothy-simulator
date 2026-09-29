import * as THREE from 'three';

/**
 * Little world-space emote bubbles above animals / quest characters ("?", "!", ♥, ♪, Zzz, short text),
 * drawn on canvases once and cached. Plus a tiny pooled heart-burst used only when no FX system
 * listens for the 'hearts' event.
 */

export type EmoteIcon = 'question' | 'exclaim' | 'heart' | 'note' | 'zzz' | 'dots' | 'dizzy' | 'sparkle' | 'grumpy';

interface Tex {
  tex: THREE.CanvasTexture;
  aspect: number;
}

const texCache = new Map<string, Tex>();

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawHeart(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.35);
  ctx.bezierCurveTo(cx - s * 0.1, cy + s * 0.25, cx - s * 0.5, cy + s * 0.05, cx - s * 0.5, cy - s * 0.18);
  ctx.bezierCurveTo(cx - s * 0.5, cy - s * 0.42, cx - s * 0.22, cy - s * 0.52, cx, cy - s * 0.3);
  ctx.bezierCurveTo(cx + s * 0.22, cy - s * 0.52, cx + s * 0.5, cy - s * 0.42, cx + s * 0.5, cy - s * 0.18);
  ctx.bezierCurveTo(cx + s * 0.5, cy + s * 0.05, cx + s * 0.1, cy + s * 0.25, cx, cy + s * 0.35);
  ctx.closePath();
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

const FONT = '"Baloo 2", "Nunito", "Segoe UI", system-ui, sans-serif';

/** Bubble with a tail at the bottom-centre; returns the drawing area. */
function bubble(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const tail = 16;
  const bh = h - tail - 6;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  roundRect(ctx, 6, 8, w - 10, bh, Math.min(34, bh / 2));
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#2b2622';
  ctx.lineWidth = 5;
  roundRect(ctx, 4, 4, w - 10, bh, Math.min(34, bh / 2));
  ctx.fill();
  ctx.stroke();
  // tail
  const cx = w / 2 - 3;
  ctx.beginPath();
  ctx.moveTo(cx - 12, 4 + bh - 3);
  ctx.lineTo(cx, 4 + bh + tail);
  ctx.lineTo(cx + 12, 4 + bh - 3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 12, 4 + bh);
  ctx.lineTo(cx, 4 + bh + tail);
  ctx.lineTo(cx + 12, 4 + bh);
  ctx.stroke();
  return { x: 4, y: 4, w: w - 10, h: bh };
}

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c: HTMLCanvasElement): Tex {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: c.width / c.height };
}

export function iconTexture(icon: EmoteIcon): Tex {
  const key = 'icon:' + icon;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d')!;
  const a = bubble(ctx, 128, 128);
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2 + 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (icon) {
    case 'question':
      ctx.fillStyle = '#3a78e0';
      ctx.font = `900 76px ${FONT}`;
      ctx.fillText('?', cx, cy + 4);
      break;
    case 'exclaim':
      ctx.fillStyle = '#ef5a2c';
      ctx.font = `900 78px ${FONT}`;
      ctx.fillText('!', cx, cy + 4);
      break;
    case 'heart':
      ctx.fillStyle = '#ff4d74';
      drawHeart(ctx, cx, cy + 4, 70);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(cx - 14, cy - 8, 7, 4.5, -0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'note':
      ctx.fillStyle = '#8a4fd1';
      ctx.font = `900 70px "Segoe UI Symbol", ${FONT}`;
      ctx.fillText('♪', cx, cy + 4);
      break;
    case 'zzz':
      ctx.fillStyle = '#5b7fd6';
      ctx.font = `900 34px ${FONT}`;
      ctx.fillText('z', cx - 22, cy + 16);
      ctx.font = `900 44px ${FONT}`;
      ctx.fillText('z', cx - 2, cy + 4);
      ctx.font = `900 56px ${FONT}`;
      ctx.fillText('Z', cx + 20, cy - 10);
      break;
    case 'dots':
      ctx.fillStyle = '#6a625b';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(cx + i * 22, cy + 6, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'dizzy':
      ctx.fillStyle = '#ffc93a';
      ctx.strokeStyle = '#c98a00';
      ctx.lineWidth = 3;
      for (const [dx, dy, r] of [[-22, 8, 16], [4, -12, 20], [26, 12, 14]]) {
        drawStar(ctx, cx + dx, cy + dy, r);
        ctx.fill();
        ctx.stroke();
      }
      break;
    case 'sparkle':
      ctx.fillStyle = '#44c2ff';
      drawStar(ctx, cx - 10, cy + 2, 30);
      ctx.fill();
      ctx.fillStyle = '#ffd24a';
      drawStar(ctx, cx + 26, cy - 16, 13);
      ctx.fill();
      break;
    case 'grumpy':
      ctx.strokeStyle = '#e03c3c';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * 8, cy + 4 + sy * 8);
        ctx.quadraticCurveTo(cx + sx * 22, cy + 4 + sy * 6, cx + sx * 26, cy + 4 + sy * 24);
        ctx.stroke();
      }
      break;
  }
  const t = finish(c);
  texCache.set(key, t);
  return t;
}

export function textTexture(text: string): Tex {
  const key = 'text:' + text;
  const hit = texCache.get(key);
  if (hit) return hit;
  const measure = makeCanvas(8, 8).getContext('2d')!;
  measure.font = `800 40px ${FONT}`;
  // wrap into at most 3 lines of ~22 chars
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (next.length > 22 && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  const width = Math.min(620, Math.max(120, ...lines.map((l) => measure.measureText(l).width + 56)));
  const height = 34 + lines.length * 46 + 26;
  const c = makeCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = c.getContext('2d')!;
  const a = bubble(ctx, c.width, c.height);
  ctx.fillStyle = '#2b2622';
  ctx.font = `800 40px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const top = a.y + a.h / 2 - ((lines.length - 1) * 46) / 2 + 2;
  lines.forEach((l, i) => ctx.fillText(l, a.x + a.w / 2, top + i * 46));
  const t = finish(c);
  texCache.set(key, t);
  // Text textures are one-offs; keep the cache from growing without bound
  if (texCache.size > 120) {
    for (const k of texCache.keys()) {
      if (k.startsWith('text:') && k !== key) {
        texCache.get(k)?.tex.dispose();
        texCache.delete(k);
        break;
      }
    }
  }
  return t;
}

/** A single bubble slot that follows an anchor object. */
export class Emote {
  readonly sprite: THREE.Sprite;
  private mat: THREE.SpriteMaterial;
  private timer = 0;
  private dur = 0;
  private baseH = 0.36;
  private kind = '';
  /** Height above the anchor's origin (world metres). */
  height: number;

  constructor(anchor: THREE.Object3D, height: number, size = 0.36) {
    this.height = height;
    this.baseH = size;
    this.mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false, opacity: 0 });
    this.mat.color.setScalar(1.12);
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 20;
    this.sprite.visible = false;
    this.sprite.position.y = height;
    this.sprite.raycast = () => {};
    anchor.add(this.sprite);
  }

  /** Show an icon or a short text for `secs` (Infinity = until hidden / replaced). */
  show(what: EmoteIcon | string, secs = 2, opts: { size?: number } = {}) {
    const isIcon = ['question', 'exclaim', 'heart', 'note', 'zzz', 'dots', 'dizzy', 'sparkle', 'grumpy'].includes(what);
    const t = isIcon ? iconTexture(what as EmoteIcon) : textTexture(what);
    const restart = this.kind !== what || this.timer <= 0;
    this.kind = what;
    this.mat.map = t.tex;
    this.mat.needsUpdate = true;
    const h = opts.size ?? (isIcon ? this.baseH : this.baseH * 0.62);
    // text bubbles: height scales with line count (aspect ~ texture)
    const texH = isIcon ? 1 : (t.tex.image as HTMLCanvasElement).height / 106;
    this.sprite.userData.h = h * texH;
    this.sprite.userData.w = h * texH * t.aspect;
    this.dur = secs;
    this.timer = secs;
    if (restart) this.sprite.userData.age = 0;
    this.sprite.visible = true;
  }

  hide() {
    this.timer = Math.min(this.timer, 0.25);
  }

  get showing() {
    return this.timer > 0 ? this.kind : '';
  }

  update(dt: number, time: number) {
    if (this.timer <= 0 && !this.sprite.visible) return;
    this.timer -= dt;
    const age = (this.sprite.userData.age = (this.sprite.userData.age ?? 0) + dt);
    const pop = age < 0.22 ? THREE.MathUtils.smoothstep(age / 0.22, 0, 1) * 1.15 : 1 + Math.max(0, 0.15 - (age - 0.22) * 0.8);
    const fade = this.timer <= 0 ? 0 : Math.min(1, this.timer / 0.25, age / 0.1);
    this.mat.opacity = fade;
    const s = Math.max(0.001, pop);
    this.sprite.scale.set((this.sprite.userData.w ?? 0.36) * s, (this.sprite.userData.h ?? 0.36) * s, 1);
    this.sprite.position.y = this.height + Math.sin(time * 3.2) * 0.03;
    if (this.timer <= 0) {
      this.sprite.visible = false;
      this.kind = '';
    }
  }

  dispose() {
    this.sprite.removeFromParent();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------------------------------------ heart burst

let heartTex: THREE.CanvasTexture | null = null;
function plainHeartTexture() {
  if (heartTex) return heartTex;
  const c = makeCanvas(64, 64);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ff5c86';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  drawHeart(ctx, 32, 34, 54);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(22, 24, 5, 3.2, -0.6, 0, Math.PI * 2);
  ctx.fill();
  heartTex = new THREE.CanvasTexture(c);
  heartTex.colorSpace = THREE.SRGBColorSpace;
  return heartTex;
}

interface HeartP {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
}

/** Pooled floating hearts (fallback when the FX system isn't listening for 'hearts'). */
export class HeartBurst {
  private pool: HeartP[] = [];
  private live: HeartP[] = [];
  private group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.group.name = 'heartBurst';
    scene.add(this.group);
  }

  spawn(pos: THREE.Vector3, count = 6, spread = 0.5) {
    for (let i = 0; i < count; i++) {
      let p = this.pool.pop();
      if (!p) {
        const mat = new THREE.SpriteMaterial({ map: plainHeartTexture(), transparent: true, depthWrite: false, fog: false });
        mat.color.setScalar(1.15);
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 21;
        sprite.raycast = () => {};
        p = { sprite, vel: new THREE.Vector3(), age: 0, life: 1, size: 0.2 };
      }
      p.sprite.position.set(pos.x + (Math.random() - 0.5) * spread, pos.y + Math.random() * 0.2, pos.z + (Math.random() - 0.5) * spread);
      p.vel.set((Math.random() - 0.5) * 0.8, 0.9 + Math.random() * 0.9, (Math.random() - 0.5) * 0.8);
      p.age = -i * 0.06;
      p.life = 1.1 + Math.random() * 0.6;
      p.size = 0.14 + Math.random() * 0.12;
      p.sprite.visible = false;
      this.group.add(p.sprite);
      this.live.push(p);
    }
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      if (p.age < 0) continue;
      p.sprite.visible = true;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-dt * 1.2));
      p.sprite.position.x += Math.sin(p.age * 7 + i) * dt * 0.25;
      const k = p.age / p.life;
      const s = p.size * (k < 0.15 ? k / 0.15 * 1.2 : 1.2 - (k - 0.15) * 0.3);
      p.sprite.scale.setScalar(Math.max(0.001, s));
      (p.sprite.material as THREE.SpriteMaterial).opacity = k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
      if (k >= 1) {
        p.sprite.removeFromParent();
        this.live.splice(i, 1);
        this.pool.push(p);
      }
    }
  }
}
