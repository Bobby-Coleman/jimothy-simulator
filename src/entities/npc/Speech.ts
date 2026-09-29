import * as THREE from 'three';
import { FONT } from './Face';

/**
 * Simple canvas-sprite speech bubbles (the UI agent may render its own from the 'speech' event and
 * turn these off with `game.get('npcs').drawBubbles = false`) and camera-flash sprites.
 */

const BW = 512;
const BH = 160;

export class Bubble {
  readonly sprite: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private tex: THREE.CanvasTexture;
  private mat: THREE.SpriteMaterial;
  life = 0;
  duration = 0;
  aspect = 3;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = BW;
    this.canvas.height = BH;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  show(text: string, duration: number, shout: boolean) {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, BW, BH);
    let size = shout ? 50 : 44;
    ctx.font = `${size}px ${FONT}`;
    let w = ctx.measureText(text).width;
    const maxW = BW - 60;
    if (w > maxW) {
      size = Math.max(24, Math.floor(size * (maxW / w)));
      ctx.font = `${size}px ${FONT}`;
      w = ctx.measureText(text).width;
    }
    const bw = Math.min(BW - 8, w + 52);
    const bh = size + 40;
    const x = (BW - bw) / 2;
    const y = 6;
    ctx.fillStyle = shout ? '#fff4c2' : '#ffffff';
    ctx.strokeStyle = '#1d2230';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(x, y, bw, bh, 26);
    ctx.moveTo(BW / 2 - 18, y + bh - 2);
    ctx.lineTo(BW / 2, y + bh + 30);
    ctx.lineTo(BW / 2 + 16, y + bh - 2);
    ctx.fill();
    ctx.stroke();
    // cover the stroke seam inside the tail
    ctx.fillRect(BW / 2 - 14, y + bh - 8, 28, 9);
    ctx.fillStyle = '#1d2230';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, BW / 2, y + bh / 2 + 2);
    this.tex.needsUpdate = true;
    this.life = 0;
    this.duration = duration;
    this.sprite.visible = true;
    this.aspect = BW / BH;
  }

  /** Returns false when finished. */
  update(dt: number, pos: THREE.Vector3, camDist: number): boolean {
    this.life += dt;
    if (this.life >= this.duration) {
      this.sprite.visible = false;
      return false;
    }
    const pop = Math.min(1, this.life / 0.12);
    const fade = Math.min(1, (this.duration - this.life) / 0.3);
    const h = THREE.MathUtils.clamp(0.3 + camDist * 0.028, 0.34, 1.1) * (0.6 + 0.4 * pop);
    this.sprite.scale.set(h * this.aspect, h, 1);
    this.sprite.position.copy(pos);
    this.mat.opacity = fade;
    return true;
  }

  hide() {
    this.sprite.visible = false;
    this.life = this.duration;
  }

  dispose() {
    this.sprite.removeFromParent();
    this.tex.dispose();
    this.mat.dispose();
  }
}

let flashTex: THREE.CanvasTexture | null = null;
function flashTexture() {
  if (flashTex) return flashTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,250,230,0.9)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  // star spikes
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(32, 2);
  ctx.lineTo(32, 62);
  ctx.moveTo(2, 32);
  ctx.lineTo(62, 32);
  ctx.stroke();
  flashTex = new THREE.CanvasTexture(c);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}

/** Pool of additive flash sprites. */
export class Flashes {
  private items: { s: THREE.Sprite; t: number }[] = [];
  constructor(private scene: THREE.Scene, n = 8) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: flashTexture(), color: new THREE.Color(3, 3, 2.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 11;
      scene.add(s);
      this.items.push({ s, t: 1 });
    }
  }
  flash(pos: THREE.Vector3) {
    let best = this.items[0];
    for (const it of this.items) if (it.t > best.t) best = it;
    best.t = 0;
    best.s.position.copy(pos);
    best.s.visible = true;
  }
  update(dt: number) {
    for (const it of this.items) {
      if (!it.s.visible) continue;
      it.t += dt;
      const k = it.t / 0.16;
      if (k >= 1) {
        it.s.visible = false;
        continue;
      }
      const size = 0.35 + k * 0.9;
      it.s.scale.set(size, size, 1);
      (it.s.material as THREE.SpriteMaterial).opacity = 1 - k;
    }
  }
}
