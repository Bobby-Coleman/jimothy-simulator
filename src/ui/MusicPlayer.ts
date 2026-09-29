import { audio } from '../audio/AudioManager';
import type { MusicFile } from '../audio/soundBank';
import { h } from './dom';
import { ICONS } from './icons';
import type { UiCtx } from './types';

const TRACK = 'title' as const;
const FADE = 0.35;

/**
 * Title-screen music player: now-playing card with title, author (→ their OpenGameArt profile, new tab),
 * prev / play-pause / next and a progress line. It drives the AudioManager's 'title' playlist (every game track,
 * upbeat first; auto-advances). The AudioSystem requests that playlist on the title screen and switches to the
 * normal day / night / slop logic as soon as gameplay starts, so the choice only applies on the title.
 */
export class MusicPlayer {
  readonly el: HTMLElement;
  private titleEl: HTMLElement;
  private byEl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private bar: HTMLElement;
  private shown = -1;
  private shownPlay: boolean | null = null;

  constructor(private api: UiCtx) {
    const btn = (label: string, icon: string, fn: () => void, cls = '') =>
      h('button', { class: `mp-btn ${cls}`, 'aria-label': label, title: label, html: icon, onclick: fn });
    this.playBtn = btn('Play music', ICONS.play, () => this.togglePlay(), 'mp-play');
    this.titleEl = h('div', { class: 'mp-title' });
    this.byEl = h('div', { class: 'mp-by' });
    this.bar = h('i');
    this.el = h(
      'div',
      { class: 'title-music', role: 'group', 'aria-label': 'Music player' },
      h('div', { class: 'mp-disc', html: ICONS.note }),
      h('div', { class: 'mp-info' }, h('div', { class: 'mp-kicker', text: 'Now playing' }), this.titleEl, this.byEl),
      h(
        'div',
        { class: 'mp-ctrls' },
        btn('Previous track', ICONS.prev, () => this.skip(-1)),
        this.playBtn,
        btn('Next track', ICONS.next, () => this.skip(1)),
      ),
      h('div', { class: 'mp-progress' }, this.bar),
    );
    this.update();
  }

  /** Playing (or about to play once audio unlocks) as far as the player is concerned. */
  private get intendsToPlay() {
    return audio.musicInfo(TRACK).wanted && audio.unlocked;
  }

  private togglePlay() {
    // Decide from what the button showed: this click may itself be unlocking audio (so the state is mid-change).
    if (this.shownPlay) {
      audio.stopMusic(FADE);
      this.api.sfx('ui_toggle');
    } else {
      // The AudioSystem's gesture listener unlocks audio on this very click; playMusic is remembered until then.
      audio.playMusic(TRACK, FADE);
      if (!audio.unlocked) void audio.unlock();
      this.api.sfx('ui_toggle');
    }
    this.update();
  }

  private skip(d: number) {
    const info = audio.musicInfo(TRACK);
    // "Previous" restarts the current track first (like every music player), unless it just started.
    const idx = d < 0 && info.time > 3 ? info.index : info.index + d;
    audio.musicSelect(TRACK, idx);
    if (!info.wanted || !audio.unlocked) audio.playMusic(TRACK, FADE);
    if (!audio.unlocked) void audio.unlock();
    this.api.sfx('ui_click');
    this.update();
  }

  private renderTrack(f: MusicFile | null) {
    this.titleEl.textContent = f?.title ?? '—';
    this.titleEl.title = f?.title ?? '';
    this.byEl.textContent = '';
    if (!f) return;
    const link = (label: string, url: string) =>
      h('a', { class: 'mp-link', href: url, target: '_blank', rel: 'noopener noreferrer', title: `${label} on OpenGameArt (opens a new tab)`, text: label });
    const [a, b] = f.links ?? [];
    this.byEl.append('by ');
    if (!a) this.byEl.append(f.author);
    else if (!b) this.byEl.append(link(a.label, a.url));
    else this.byEl.append(link(a.label, a.url), ' · edit ', link(b.label, b.url));
  }

  /** Called every frame while the title is visible (cheap: only touches the DOM on changes). */
  update() {
    const info = audio.musicInfo(TRACK);
    if (info.index !== this.shown) {
      this.shown = info.index;
      this.renderTrack(info.file);
    }
    const on = this.intendsToPlay;
    if (on !== this.shownPlay) {
      this.shownPlay = on;
      this.playBtn.innerHTML = on ? ICONS.pause : ICONS.play;
      this.playBtn.setAttribute('aria-label', on ? 'Pause music' : 'Play music');
      this.playBtn.title = on ? 'Pause music' : 'Play music';
    }
    this.el.classList.toggle('playing', info.playing);
    const pct = info.duration > 0 ? Math.min(100, (info.time / info.duration) * 100) : 0;
    this.bar.style.width = `${pct.toFixed(2)}%`;
  }
}
