import * as THREE from 'three';
import type { Game } from '../core/Game';
import { h, clamp } from './dom';
import { CHITTERS } from './content';

const _v = new THREE.Vector3();
const _box = new THREE.Box3();
const MAX_DIST = 42;
const MAX_BUBBLES = 8;

interface Bubble {
  el: HTMLElement;
  key: unknown;
  obj?: THREE.Object3D;
  ent?: any;
  pos?: THREE.Vector3;
  offY: number;
  t: number;
  life: number;
  dying: boolean;
}

/**
 * World-anchored speech bubbles.
 * Event 'speech' { entity?, object?, position?, text, duration?, style?: 'shout'|'slop'|'whisper'|'jimothy', speaker?, offsetY? }
 * The bubble follows the entity's object (or body), hides when behind the camera, off-screen or far away.
 */
export class SpeechBubbles {
  readonly el: HTMLElement;
  private list: Bubble[] = [];
  private lastChitter = 0;
  /** Final pass: screen-space centres of the bubbles shown this frame (the guide star steps aside from them). */
  readonly anchors: { x: number; y: number }[] = [];

  constructor(
    private game: Game,
    parent: HTMLElement,
  ) {
    this.el = h('div', { class: 'speech-layer' });
    parent.append(this.el);
    game.events.on('speech', (p: any) => this.say(p));
    game.events.on('chitter', () => {
      const now = performance.now();
      if (now - this.lastChitter < 900) return;
      this.lastChitter = now;
      const player = game.get<any>('player');
      if (player?.model?.root) this.say({ object: player.model.root, text: CHITTERS[Math.floor(Math.random() * CHITTERS.length)], duration: 1.3, style: 'jimothy', offsetY: 0.75 });
    });
  }

  say(p: any) {
    if (!p || p.text == null || p.text === '') return;
    const game = this.game;
    let obj: THREE.Object3D | undefined;
    let ent: any;
    let pos: THREE.Vector3 | undefined;
    let key: unknown = p.key;
    const e = p.entity;
    if (e?.isObject3D) obj = e;
    else if (e) {
      ent = e;
      key ??= e.id ?? e;
      if (e.object?.isObject3D) obj = e.object;
      else if (e.kind === 'player') obj = game.get<any>('player')?.model?.root;
    }
    if (!obj && p.object?.isObject3D) obj = p.object;
    if (!obj && !ent && p.position) {
      pos = new THREE.Vector3(p.position.x ?? 0, p.position.y ?? 0, p.position.z ?? 0);
    }
    if (!obj && !ent && !pos) return;
    key ??= obj ?? pos;

    // One bubble per speaker: replace the old one.
    for (const b of this.list) if (b.key === key && !b.dying) this.kill(b, true);

    let offY = typeof p.offsetY === 'number' ? p.offsetY : 0;
    if (typeof p.offsetY !== 'number') {
      if (obj) {
        try {
          obj.updateWorldMatrix(true, true);
          _box.setFromObject(obj);
          const base = obj.getWorldPosition(_v).y;
          offY = _box.isEmpty() ? 1.9 : clamp(_box.max.y - base + 0.28, 0.45, 6);
        } catch {
          offY = 1.9;
        }
      } else offY = ent?.kind === 'npc' ? 2.0 : 1.2;
    }

    const text = String(p.text);
    const style = typeof p.style === 'string' ? p.style.replace(/[^a-z-]/gi, '') : '';
    // Outer anchor is positioned every frame; the inner bubble owns the pop animations.
    const inner = h('div', { class: `bubble${style ? ` bubble-${style}` : ''}` });
    if (p.speaker) inner.append(h('div', { class: 'bubble-name', text: String(p.speaker) }));
    inner.append(h('div', { class: 'bubble-text', text }));
    const el = h('div', { class: 'bubble-anchor' }, inner);
    el.style.visibility = 'hidden';
    this.el.append(el);
    const life = typeof p.duration === 'number' && p.duration > 0 ? p.duration : clamp(1.8 + text.length * 0.055, 2.2, 7);
    this.list.push({ el, key, obj, ent, pos, offY, t: 0, life, dying: false });
    const alive = this.list.filter((b) => !b.dying);
    for (let i = 0; i < alive.length - MAX_BUBBLES; i++) this.kill(alive[i], true);
  }

  private kill(b: Bubble, fast = false) {
    if (b.dying) return;
    b.dying = true;
    b.el.classList.add('out');
    window.setTimeout(
      () => {
        b.el.remove();
        const i = this.list.indexOf(b);
        if (i >= 0) this.list.splice(i, 1);
      },
      fast ? 160 : 300,
    );
  }

  clear() {
    for (const b of [...this.list]) this.kill(b, true);
  }

  update(dt: number, paused: boolean) {
    this.anchors.length = 0;
    if (!this.list.length) return;
    const cam = this.game.camera;
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (const b of this.list) {
      if (!paused) b.t += dt;
      if (!b.dying && b.t > b.life) this.kill(b);
      if (b.ent && b.ent.alive === false && !b.dying) this.kill(b, true);
      // Resolve anchor
      let ok = false;
      if (b.obj) {
        if (!b.obj.parent && b.obj.type !== 'Scene') {
          if (!b.dying) this.kill(b, true);
        } else {
          b.obj.getWorldPosition(_v);
          ok = true;
        }
      } else if (b.ent?.body) {
        try {
          const t = b.ent.body.translation();
          _v.set(t.x, t.y, t.z);
          ok = true;
        } catch {
          ok = false;
        }
      } else if (b.pos) {
        _v.copy(b.pos);
        ok = true;
      }
      if (!ok) {
        b.el.style.visibility = 'hidden';
        continue;
      }
      _v.y += b.offY;
      const dist = _v.distanceTo(cam.position);
      _v.project(cam);
      const x = (_v.x * 0.5 + 0.5) * W;
      const y = (-_v.y * 0.5 + 0.5) * H;
      const visible = _v.z < 1 && _v.z > -1 && dist < MAX_DIST && x > -120 && x < W + 120 && y > -60 && y < H + 160;
      if (!visible) {
        b.el.style.visibility = 'hidden';
        continue;
      }
      const s = clamp(1.25 - dist / 30, 0.62, 1.05);
      if (!b.dying) this.anchors.push({ x, y: y - 32 * s }); // bubble hangs above its anchor point
      b.el.style.visibility = '';
      b.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      b.el.style.zIndex = String(1000 - Math.round(dist * 10));
    }
  }
}
