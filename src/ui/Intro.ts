import * as THREE from 'three';
import { G, groups } from '../core/Physics';
import type { CameraRig } from '../player/CameraRig';
import { h, clamp, IS_TOUCH } from './dom';
import { logoHtml } from './Title';
import type { UiCtx } from './types';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const CLEAR_FILTER = groups(G.ALL, G.WORLD | G.VEHICLE | G.PROP);

/** Gameplay camera framing the rig uses by default (see CameraRig). */
const GAME_PITCH = -0.3;
const GAME_DIST = 4.8;

const T_TURN = 3.7;
const TURN_DUR = 2.4;
const T_ZOOM = 6.15;
const T_DROP = 12.6;
const T_SLAM = 13.05;
const T_END = 15.4;

const CAPTIONS: [number, string][] = [
  [0.9, 'aww look at the kitty…'],
  [6.45, '…what am I looking at?'],
  [8.9, ''],
  [9.9, 'he looks like a Jimothy.'],
  [12.4, ''],
];

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface IntroApi extends UiCtx {
  onIntroDone(skipped: boolean): void;
}

/**
 * The viral moment, recreated: a phone video from behind "a cat", he turns around, zoom, "what am I looking at?",
 * "he looks like a Jimothy.", then the title card slams in. Skippable (Esc / Start / click-hold / touch-hold).
 * Runs with game.state = 'cutscene' (the world simulates, Jimothy is frozen, the camera is overridden).
 */
export class Intro {
  readonly el: HTMLElement;
  running = false;
  private t = 0;
  private facing0 = 0;
  /** Horizontal unit vector from Jimothy toward the phone. */
  private phoneDir = new THREE.Vector3(0, 0, 1);
  private zoom = 1;
  private shake = 0;
  private capIdx = -1;
  private capFull = '';
  private capShown = 0;
  private holdStart = -1;
  private lastNow = 0;
  private fired = new Set<string>();
  private vf: HTMLElement;
  private capEl: HTMLElement;
  private timeEl: HTMLElement;
  private zoomEl: HTMLElement;
  private card: HTMLElement;
  private confetti: HTMLElement;
  private skipEl: HTMLElement;
  private skipRing: SVGCircleElement;
  private frameEl: HTMLElement;
  private onDown = (e: PointerEvent) => {
    if (!this.running) return;
    if (e.button === 0 || e.pointerType !== 'mouse') this.holdStart = performance.now();
  };
  private onUp = () => {
    this.holdStart = -1;
  };

  constructor(
    private api: IntroApi,
    parent: HTMLElement,
  ) {
    this.capEl = h('span');
    this.timeEl = h('b', { text: '00:00:03' });
    this.zoomEl = h('div', { class: 'vf-zoom', text: '1×' });
    this.frameEl = h(
      'div',
      { class: 'vf-frame' },
      h('div', { class: 'vf-black' }),
      h(
        'div',
        { class: 'vf-top' },
        h('span', { class: 'vf-rec' }, h('i'), 'REC ', this.timeEl),
        h('span', {
          class: 'vf-batt',
          html: '<svg viewBox="0 0 28 14"><rect x="1" y="1" width="22" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="24" y="4.5" width="3" height="5" rx="1" fill="currentColor"/><rect x="3.5" y="3.5" width="4" height="7" rx="1" fill="#ff5a4e"/></svg> 12%',
        }),
      ),
      h('div', { class: 'vf-date', text: 'JUL 13 2026 · 7:42 PM' }),
      h('div', { class: 'vf-corners' }, h('i'), h('i'), h('i'), h('i')),
      h('div', { class: 'vf-focus' }),
      h('div', { class: 'vf-caption' }, this.capEl),
      h('div', { class: 'vf-bottom' }, this.zoomEl, h('span', { class: 'vf-mode', text: 'VIDEO' }), h('span', { class: 'vf-shutter' }, h('i'))),
    );
    this.vf = h('div', { class: 'vf' }, h('div', { class: 'vf-side' }), this.frameEl, h('div', { class: 'vf-side' }));
    this.card = h('div', { class: 'intro-card', html: logoHtml('logo-card') });
    this.confetti = h('div', { class: 'intro-confetti' });
    this.skipEl = h('div', { class: 'intro-skip' });
    this.skipEl.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" class="ring-bg"/><circle cx="12" cy="12" r="9" class="ring-fg" pathLength="100"/></svg><span>${IS_TOUCH ? 'Hold anywhere to skip' : 'Hold to skip · Esc'}</span>`;
    this.skipRing = this.skipEl.querySelector('.ring-fg') as SVGCircleElement;
    this.el = h('div', { class: 'intro' }, this.vf, this.card, this.confetti, this.skipEl);
    parent.append(this.el);
    window.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onUp, true);
    window.addEventListener('blur', this.onUp);
  }

  start() {
    const game = this.api.game;
    const p = game.get<any>('player');
    const rig = game.get<CameraRig>('camera');
    if (!p || !rig) {
      this.api.onIntroDone(true);
      return;
    }
    this.running = true;
    this.t = 0;
    this.lastNow = performance.now();
    this.zoom = 1;
    this.shake = 0;
    this.capIdx = -1;
    this.capFull = '';
    this.capShown = 0;
    this.capEl.textContent = '';
    this.holdStart = -1;
    this.fired.clear();
    this.confetti.textContent = '';
    game.state = 'cutscene';
    p.frozen = true;
    this.chooseFacing(p);
    p.facing = this.facing0;
    this.el.className = 'intro on';
    this.vf.className = 'vf';
    this.card.className = 'intro-card';
    rig.override = (cam, dt) => this.camera(cam, dt);
    game.events.emit('introStart', {});
  }

  /** Pick a facing so the phone (behind Jimothy) and the final gameplay camera aren't inside a wall. */
  private chooseFacing(p: any) {
    const game = this.api.game;
    const from = _a.copy(p.position);
    from.y += 0.6;
    let best = p.facing ?? 0;
    for (let i = 0; i < 8; i++) {
      const f = (p.facing ?? 0) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 4);
      const dir = _b.set(-Math.sin(f), 0, -Math.cos(f));
      let clear = true;
      try {
        const d1 = _c.copy(dir).multiplyScalar(2.5).addScaledVector(UP, 0.55);
        if (game.physics.raycast(from, d1, d1.length() + 0.3, CLEAR_FILTER, p.body)) clear = false;
        const d2 = _c.copy(dir).multiplyScalar(GAME_DIST).addScaledVector(UP, 1.1);
        if (clear && game.physics.raycast(from, d2, d2.length(), CLEAR_FILTER, p.body)) clear = false;
      } catch {
        clear = true;
      }
      if (clear) {
        best = f;
        break;
      }
    }
    this.facing0 = best;
    this.phoneDir.set(-Math.sin(best), 0, -Math.cos(best));
  }

  skip() {
    if (!this.running) return;
    this.finish(true);
  }

  private fire(key: string, at: number, fn: () => void) {
    if (this.t >= at && !this.fired.has(key)) {
      this.fired.add(key);
      fn();
    }
  }

  update(_frameDt: number) {
    if (!this.running) return;
    const game = this.api.game;
    const p = game.get<any>('player');
    // Wall-clock timeline (frame dt is clamped by the engine, which would slow the intro on slow machines).
    const now = performance.now();
    const dt = Math.min(0.5, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.t += dt;
    const t = this.t;

    // --- skip input (Esc / Start are routed here by the UI; this handles click/touch-and-hold)
    if (this.holdStart >= 0) {
      const held = (performance.now() - this.holdStart) / 1000;
      this.skipEl.classList.add('holding');
      this.skipRing.style.strokeDashoffset = String(100 - clamp(held / 0.7, 0, 1) * 100);
      if (held > 0.7) {
        this.skip();
        return;
      }
    } else if (this.skipEl.classList.contains('holding')) {
      this.skipEl.classList.remove('holding');
      this.skipRing.style.strokeDashoffset = '100';
    }

    // --- timeline
    this.fire('rec', 0.35, () => {
      this.el.classList.add('rec');
      this.api.sfx('camera_shutter', 0.5);
    });
    this.fire('zoom', T_ZOOM, () => {
      this.shake = 1;
      this.frameEl.classList.add('shake');
      this.zoomEl.classList.add('zoomed');
      this.api.sfx('whoosh', 0.8, 0.7);
      this.api.sfx('boing', 0.5, 0.6);
    });
    this.fire('trill', 10.05, () => {
      if (p?.position) game.sfx('trill', p.position, 0.9);
    });
    this.fire('drop', T_DROP, () => {
      this.vf.classList.add('drop');
      this.el.classList.add('dropped');
      this.api.sfx('whoosh', 0.7, 1.2);
    });
    this.fire('slam', T_SLAM, () => {
      this.card.classList.add('slam');
      this.shake = 0.8;
      this.burstConfetti();
      this.api.sfx('boing', 1);
      this.api.sfx('impact_heavy', 0.6);
      this.api.sfx('jingle_win', 0.6);
    });
    this.fire('cardOut', T_END - 0.45, () => this.card.classList.add('out'));

    // Captions (typed out)
    let ci = -1;
    for (let i = 0; i < CAPTIONS.length; i++) if (t >= CAPTIONS[i][0]) ci = i;
    if (ci !== this.capIdx) {
      this.capIdx = ci;
      this.capFull = ci >= 0 ? CAPTIONS[ci][1] : '';
      this.capShown = 0;
      this.capEl.textContent = '';
      this.capEl.parentElement!.classList.toggle('empty', !this.capFull);
    }
    if (this.capShown < this.capFull.length) {
      const before = Math.floor(this.capShown);
      this.capShown = Math.min(this.capFull.length, this.capShown + dt * 20);
      if (Math.floor(this.capShown) !== before) this.capEl.textContent = this.capFull.slice(0, Math.floor(this.capShown));
    }
    const secs = 3 + Math.floor(t);
    this.timeEl.textContent = `00:00:${String(secs).padStart(2, '0')}`;

    // Jimothy slowly turns around
    if (p) {
      const k = ease(clamp((t - T_TURN) / TURN_DUR, 0, 1));
      p.facing = this.facing0 + Math.PI * k;
      p.frozen = true;
    }
    // Zoom
    const zTarget = t >= T_ZOOM && t < T_DROP ? 1.85 : 1;
    this.zoom += (zTarget - this.zoom) * (1 - Math.exp(-dt * (t >= T_ZOOM && t < T_ZOOM + 0.6 ? 14 : 3)));
    this.zoomEl.textContent = `${this.zoom.toFixed(1)}×`;
    this.shake *= Math.exp(-dt * 3.2);

    if (t >= T_END) this.finish(false);
  }

  private burstConfetti() {
    const colors = ['#ff8a1e', '#19c2b8', '#ffd23f', '#ff5f8f', '#fff3d6', '#9d6bff'];
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 45;
      const el = h('i', {
        style: {
          '--x': `${(Math.cos(a) * d).toFixed(1)}vmin`,
          '--y': `${(Math.sin(a) * d * 0.8 - 12).toFixed(1)}vmin`,
          '--r': `${Math.round(Math.random() * 720 - 360)}deg`,
          '--c': colors[i % colors.length],
          '--d': `${(0.9 + Math.random() * 0.8).toFixed(2)}s`,
        },
      });
      this.confetti.append(el);
    }
  }

  /** Phone POV → blends into the gameplay framing after the title card slam. */
  private camera(cam: THREE.PerspectiveCamera, _dt: number) {
    const game = this.api.game;
    const p = game.get<any>('player');
    const rig = game.get<CameraRig>('camera');
    if (!p?.position) return;
    const t = this.t;
    const J = p.position as THREE.Vector3;
    // Phone: ~1.5 m up, 2.5 m behind, a little handheld wobble
    const phone = _a.copy(J).addScaledVector(this.phoneDir, 2.5);
    phone.y += 1.12;
    phone.x += Math.sin(t * 1.1) * 0.022 + Math.sin(t * 2.7) * 0.008;
    phone.y += Math.sin(t * 1.6 + 1) * 0.018;
    phone.z += Math.sin(t * 0.9 + 2) * 0.02;
    const phoneLook = _b.copy(J);
    phoneLook.y += 0.08;
    // Gameplay framing (matches CameraRig with yaw from phoneDir, pitch -0.3, distance 4.8)
    const gameLook = _c.copy(J);
    gameLook.y += 0.75 * (p.sizeMul ?? 1);
    const gx = gameLook.x + this.phoneDir.x * Math.cos(GAME_PITCH) * GAME_DIST;
    const gy = gameLook.y - Math.sin(GAME_PITCH) * GAME_DIST;
    const gz = gameLook.z + this.phoneDir.z * Math.cos(GAME_PITCH) * GAME_DIST;
    const k = smooth(T_SLAM - 0.2, T_END - 0.1, t);
    cam.position.set(phone.x + (gx - phone.x) * k, phone.y + (gy - phone.y) * k, phone.z + (gz - phone.z) * k);
    const look = phoneLook.lerp(gameLook, k);
    if (this.shake > 0.01 && this.api.settings.flashes) {
      const s = this.shake * this.shake * 0.06;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      look.x += (Math.random() - 0.5) * s * 0.5;
    }
    cam.lookAt(look);
    if (k < 1) cam.rotateZ(Math.sin(t * 0.8) * 0.012 * (1 - k));
    const baseFov = rig?.baseFov ?? 62;
    const fov = (50 / this.zoom) * (1 - k) + baseFov * k;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  private finish(skipped: boolean) {
    const game = this.api.game;
    const p = game.get<any>('player');
    const rig = game.get<CameraRig>('camera');
    this.running = false;
    this.holdStart = -1;
    if (p) p.facing = this.facing0 + Math.PI;
    if (rig) {
      rig.override = null;
      rig.yaw = Math.atan2(this.phoneDir.x, this.phoneDir.z);
      rig.pitch = GAME_PITCH;
      rig.targetDistance = GAME_DIST;
      rig.distance = GAME_DIST;
      game.camera.fov = rig.baseFov;
      game.camera.updateProjectionMatrix();
    }
    this.el.classList.add('closing');
    window.setTimeout(() => {
      if (!this.running) this.el.className = 'intro';
    }, skipped ? 350 : 500);
    game.events.emit('introEnd', { skipped });
    this.api.onIntroDone(skipped);
  }
}
