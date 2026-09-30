import * as THREE from 'three';
import { G, groups } from '../core/Physics';
import type { CameraRig } from '../player/CameraRig';
import { h, esc } from './dom';
import { ICONS, JIMOTHY_FACE } from './icons';
import { fillTokens } from './glyphs';
import { DISCLAIMER, TAGLINE, tipSequence } from './content';
import { MusicPlayer, type MusicApi } from './MusicPlayer';
import { bindFullscreenButton, toggleFullscreen } from './fullscreen';

export { toggleFullscreen } from './fullscreen';

const UP = new THREE.Vector3(0, 1, 0);
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _l = new THREE.Vector3();
const CAM_FILTER = groups(G.ALL, G.WORLD | G.VEHICLE);

/** The chunky "JIMOTHY SIMULATOR" logo (Jimothy's face is the O). */
export function logoHtml(extra = '') {
  const top = [...'JIMOTHY']
    .map((c, i) => (c === 'O' ? `<span class="l logo-o" style="--i:${i}">${JIMOTHY_FACE}</span>` : `<span class="l" style="--i:${i}">${c}</span>`))
    .join('');
  const bottom = [...'SIMULATOR'].map((c, i) => `<span class="l" style="--i:${i + 7}">${c}</span>`).join('');
  return `<div class="logo ${extra}" role="img" aria-label="Jimothy Simulator"><div class="logo-top">${top}</div><div class="logo-bottom">${bottom}</div></div>`;
}

export interface TitleApi extends MusicApi {
  startGame(playIntro: boolean): void;
  openTitlePage(id: string): void;
  readonly introSeen: boolean;
  readonly isTouch: boolean;
}

/**
 * Title screen: logo, tagline, menu, disclaimer, rotating (mostly terrible) tips,
 * with a slow orbiting camera around Jimothy in the background.
 */
export class TitleScreen {
  readonly el: HTMLElement;
  visible = false;
  private tipEl: HTMLElement;
  private tips = tipSequence();
  private tipIdx = 0;
  private tipT = 0;
  private playBtn: HTMLButtonElement;
  private replayBtn: HTMLButtonElement;
  private orbitA = Math.random() * Math.PI * 2;
  private settled = false;
  /** Now-playing card (the playlist: prev / play-pause / next, seek, volume, expandable track list). */
  readonly music: MusicPlayer;

  constructor(
    private api: TitleApi,
    parent: HTMLElement,
  ) {
    this.playBtn = h('button', { class: 'btn btn-primary btn-play', html: `<span class="btn-icon">${ICONS.play}</span><span>Play</span>`, onclick: () => this.play(false) });
    this.replayBtn = h('button', { class: 'btn btn-small', html: `<span class="btn-icon">${ICONS.camera}</span><span>Replay intro</span>`, onclick: () => this.play(true) });
    const small = (label: string, iconSvg: string, id: string) =>
      h('button', { class: 'btn btn-small', html: `<span class="btn-icon">${iconSvg}</span><span>${esc(label)}</span>`, onclick: () => api.openTitlePage(id) });
    const fsBtn = h('button', {
      class: 'btn btn-small btn-icon-only',
      'aria-label': 'Fullscreen',
      title: 'Fullscreen',
      html: `<span class="btn-icon">${ICONS.fullscreen}</span>`,
      onclick: () => void toggleFullscreen(),
    });
    bindFullscreenButton(fsBtn, (on) => {
      const label = on ? 'Exit fullscreen' : 'Fullscreen';
      fsBtn.setAttribute('aria-label', label);
      fsBtn.title = label;
      fsBtn.innerHTML = `<span class="btn-icon">${on ? ICONS.fullscreenExit : ICONS.fullscreen}</span>`;
    });
    this.music = new MusicPlayer(api);
    this.tipEl = h('div', { class: 'title-tip-text' });
    this.el = h(
      'div',
      { class: 'title' },
      h('div', { class: 'title-shade' }),
      h(
        'div',
        { class: 'title-main' },
        h('div', { class: 'title-logo', html: logoHtml('logo-title') }),
        h('div', { class: 'title-tagline ol', text: TAGLINE }),
        h(
          'div',
          { class: 'title-menu' },
          this.playBtn,
          h('div', { class: 'title-row' }, this.replayBtn, small('Settings', ICONS.gear, 'settings'), small('Controls', ICONS.keyboard, 'controls'), small('Credits', ICONS.star, 'credits'), fsBtn),
        ),
      ),
      this.music.el,
      h('div', { class: 'title-disclaimer' }, h('b', { text: 'Disclaimer' }), h('p', { text: DISCLAIMER })),
      h('div', { class: 'title-tip' }, h('span', { class: 'title-tip-badge', text: 'TIP' }), this.tipEl),
      h('div', { class: 'title-version', text: 'v0.1 · early access to a raccoon' }),
      h('div', { class: 'title-rotate', text: 'Rotate your phone for maximum roundness ↻' }),
    );
    parent.append(this.el);
    this.showTip(0);
  }

  show() {
    const game = this.api.game;
    this.visible = true;
    game.state = 'title';
    this.replayBtn.style.display = this.api.introSeen ? '' : 'none';
    this.el.classList.add('open');
    const rig = game.get<CameraRig>('camera');
    if (rig) rig.override = (cam, dt) => this.orbit(cam, dt);
    requestAnimationFrame(() => this.playBtn.focus({ preventScroll: true }));
  }

  hide() {
    this.visible = false;
    this.el.classList.remove('open');
    const a = document.activeElement as HTMLElement | null;
    if (a && this.el.contains(a)) a.blur();
  }

  focusDefault() {
    this.playBtn.focus({ preventScroll: true });
  }

  private play(forceIntro: boolean) {
    this.api.sfx('ui_confirm');
    this.api.startGame(forceIntro || !this.api.introSeen);
  }

  private showTip(i: number) {
    this.tipIdx = i % this.tips.length;
    this.tipEl.innerHTML = fillTokens(this.tips[this.tipIdx], this.api.device);
    this.tipEl.classList.remove('in');
    void this.tipEl.offsetWidth;
    this.tipEl.classList.add('in');
  }

  update(dt: number) {
    if (!this.visible) return;
    this.tipT += dt;
    if (this.tipT > 5.2) {
      this.tipT = 0;
      this.showTip(this.tipIdx + 1);
    }
    this.music.update();
    this.syncPlayer(dt);
  }

  /**
   * The simulation is paused on the title (game.state = 'title'), so place Jimothy on the ground once
   * and keep his model synced/animated ourselves.
   */
  private syncPlayer(dt: number) {
    const game = this.api.game;
    const p = game.get<any>('player');
    if (!p?.position) return;
    if (!this.settled) {
      this.settled = true;
      try {
        // One tiny physics step builds the broad-phase so raycasts work before the first real frame.
        game.physics.step(1 / 400);
        const from = _t.copy(p.position);
        from.y += 0.5;
        const hit = game.physics.raycast(from, _d.set(0, -1, 0), 8, groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE), p.body);
        const terrain = game.get<any>('world')?.heightAt?.(p.position.x, p.position.z);
        const ground = hit ? hit.point.y : typeof terrain === 'number' ? terrain : null;
        const r = 0.38 * (p.sizeMul ?? 1);
        if (ground != null && p.position.y - r - ground > 0.05) p.teleport?.(_l.set(p.position.x, ground + r + 0.01, p.position.z));
      } catch (err) {
        console.warn('[ui] title: could not settle Jimothy', err);
      }
      // (his own ground check doesn't run while the simulation is paused: without this he'd strike his mid-jump
      // pose on the title instead of standing about)
      p.grounded = true;
    }
    try {
      p.postPhysics?.(dt);
    } catch {
      /* model not ready yet */
    }
  }

  /** Slow orbit around Jimothy; he sits on the right third on wide screens (logo on the left). */
  private orbit(cam: THREE.PerspectiveCamera, dt: number) {
    const game = this.api.game;
    const p = game.get<any>('player');
    if (!p?.position) return;
    this.orbitA += dt * 0.11;
    const target = _t.copy(p.position);
    target.y += 0.12;
    const R = 3.4;
    _d.set(Math.sin(this.orbitA), 0.34, Math.cos(this.orbitA)).normalize();
    let dist = R;
    try {
      const hit = game.physics.sphereCast(target, _d, 0.25, R, CAM_FILTER, p.body);
      if (hit) dist = Math.max(1.1, hit.distance - 0.05);
    } catch {
      /* ignore */
    }
    cam.position.copy(target).addScaledVector(_d, dist);
    const ground = game.get<any>('world')?.heightAt?.(cam.position.x, cam.position.z);
    if (typeof ground === 'number' && cam.position.y < ground + 0.3) cam.position.y = ground + 0.3;
    const aspect = cam.aspect;
    const off = aspect > 1.2 ? Math.min(1.25, (aspect - 1) * 1.3) * (dist / R) : 0;
    _r.copy(_d).negate().cross(UP).normalize();
    _l.copy(target).addScaledVector(_r, -off);
    _l.y += aspect > 1.2 ? 0.05 : -0.35;
    cam.lookAt(_l);
    if (cam.fov !== 48) {
      cam.fov = 48;
      cam.updateProjectionMatrix();
    }
  }
}
