import { audio } from '../audio/AudioManager';
import { musicPrefs, type MusicMode } from '../audio/musicPrefs';
import { MUSIC_BANK, type MusicFile, type MusicTrack } from '../audio/soundBank';
import { h } from './dom';
import { ICONS } from './icons';
import type { Settings } from './settings';
import type { UiCtx } from './types';

const FADE = 0.35;
/** Seconds per arrow key / D-pad press on the seek bar. */
const SEEK_STEP = 5;
const PLAYLIST = MUSIC_BANK[musicPrefs.track].files;

const THEME_LABEL: Record<MusicTrack, string> = { title: 'My playlist', day: 'Daytime', night: 'Raccoon hours', slop: 'SlopCorp' };

export interface MusicApi extends UiCtx {
  /** Persist + apply one changed setting (the volume slider writes Settings › Music). */
  commitSettings(key: keyof Settings): void;
}

export interface MusicPlayerOpts {
  /**
   * 'card': the title screen's now-playing sticker (the playlist expands on demand).
   * 'page': the pause menu's Music page (mode toggle "Auto music" / "My playlist", playlist always shown).
   */
  variant: 'card' | 'page';
}

const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const setFill = (input: HTMLInputElement) => {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 1;
  const v = Number(input.value);
  input.style.setProperty('--fill', `${Math.max(0, Math.min(100, ((v - min) / (max - min || 1)) * 100)).toFixed(2)}%`);
};

interface Row {
  li: HTMLElement;
  check: HTMLButtonElement;
  on: boolean | null;
  cur: boolean | null;
}

/**
 * Music player: now-playing (title, author → their OpenGameArt profile, new tab), prev / play-pause / next,
 * a draggable seek bar with elapsed / total time, music volume (= Settings › Music) + mute, shuffle, and the
 * playlist: every track with a checkbox (unchecked = skipped by prev / next / auto-advance; one always stays on)
 * and a clickable name that plays it.
 *
 * It shows / controls whatever theme the AudioSystem wants right now (`musicPrefs.theme`): the playlist on the
 * title screen and in "My playlist" mode, the day / night / slop theme in "Auto music" mode (prev / next then step
 * through that theme; picking a playlist track switches to "My playlist"). Choices persist via musicPrefs.
 */
export class MusicPlayer {
  readonly el: HTMLElement;
  private kickerEl: HTMLElement;
  private titleEl: HTMLElement;
  private byEl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private seek: HTMLInputElement;
  private tNow: HTMLElement;
  private tEnd: HTMLElement;
  private vol: HTMLInputElement;
  private muteBtn: HTMLButtonElement;
  private shuffleBtn: HTMLButtonElement;
  private listBtn: HTMLButtonElement | null = null;
  private list: HTMLElement;
  private rows: Row[] = [];
  private modeBtns: HTMLButtonElement[] = [];
  private note: HTMLElement | null = null;
  private seeking = false;
  private pressShown: boolean | null = null;
  private pressAt = -1e9;
  private expanded: boolean;
  // what the DOM currently shows (update() only touches the DOM on changes)
  private shownFile: MusicFile | null | undefined = undefined;
  private shownPlay: boolean | null = null;
  private shownKicker = '';
  private shownDur = -1;
  private shownVol = -1;
  private shownShuffle: boolean | null = null;
  private shownMode: MusicMode | null = null;
  private shownSec = -1;

  constructor(
    private api: MusicApi,
    private opts: MusicPlayerOpts = { variant: 'card' },
  ) {
    const page = opts.variant === 'page';
    this.expanded = page;
    const btn = (label: string, icon: string, fn: () => void, cls = '') =>
      h('button', { class: `mp-btn ${cls}`, 'aria-label': label, title: label, html: icon, onclick: fn });
    this.playBtn = btn('Play music', ICONS.play, () => this.togglePlay(), 'mp-play');
    this.playBtn.addEventListener('pointerdown', () => {
      this.pressShown = this.shownPlay;
      this.pressAt = performance.now();
    });
    this.kickerEl = h('div', { class: 'mp-kicker', text: 'Now playing' });
    this.titleEl = h('div', { class: 'mp-title' });
    this.byEl = h('div', { class: 'mp-by' });

    // seek bar: native range = mouse / touch drag, click-to-seek, keyboard & PadNav (data-nav-step)
    this.seek = h('input', { class: 'mp-range mp-seek', type: 'range', min: 0, max: 1, step: 0.1, value: 0, 'aria-label': 'Seek', 'data-nav-step': SEEK_STEP }) as HTMLInputElement;
    this.tNow = h('span', { class: 'mp-time', text: '0:00' });
    this.tEnd = h('span', { class: 'mp-time', text: '0:00' });
    this.bindSeek();

    // volume (= Settings › Music) + mute
    this.vol = h('input', { class: 'mp-range mp-vol', type: 'range', min: 0, max: 100, step: 5, value: Math.round(api.settings.music * 100), 'aria-label': 'Music volume' }) as HTMLInputElement;
    this.vol.addEventListener('input', () => this.setVolume(Number(this.vol.value) / 100));
    this.muteBtn = btn('Mute music', ICONS.volume, () => this.toggleMute(), 'mp-small');
    this.shuffleBtn = btn('Shuffle', ICONS.shuffle, () => this.toggleShuffle(), 'mp-small mp-shuffle');

    this.list = h('ol', { class: 'mp-list', 'aria-label': 'Playlist' });
    PLAYLIST.forEach((f, i) => this.rows.push(this.buildRow(f, i)));

    const tools = h('div', { class: 'mp-tools' }, this.muteBtn, this.vol, this.shuffleBtn);
    if (!page) {
      this.listBtn = h('button', {
        class: 'mp-listbtn',
        'aria-expanded': 'false',
        html: `${ICONS.list}<span>Playlist</span>${ICONS.chevron}`,
        onclick: () => this.setExpanded(!this.expanded),
      });
      tools.append(this.listBtn);
    }

    const head = h(
      'div',
      { class: 'mp-head' },
      h('div', { class: 'mp-disc', html: ICONS.note }),
      h('div', { class: 'mp-info' }, this.kickerEl, this.titleEl, this.byEl),
      h(
        'div',
        { class: 'mp-ctrls' },
        btn('Previous track', ICONS.prev, () => this.skip(-1)),
        this.playBtn,
        btn('Next track', ICONS.next, () => this.skip(1)),
      ),
    );
    const seekRow = h('div', { class: 'mp-seekrow' }, this.tNow, this.seek, this.tEnd);

    const parts: HTMLElement[] = [];
    if (page) {
      const seg = h('div', { class: 'seg mp-mode', role: 'radiogroup', 'aria-label': 'Music during gameplay' });
      for (const [m, text] of [
        ['auto', 'Auto music'],
        ['playlist', 'My playlist'],
      ] as [MusicMode, string][]) {
        const b = h('button', { class: 'seg-btn', role: 'radio', 'data-mode': m, text, onclick: () => this.pickMode(m) });
        if (m === musicPrefs.mode) b.setAttribute('data-autofocus', '');
        this.modeBtns.push(b);
        seg.append(b);
      }
      this.note = h('p', { class: 'mp-note' });
      parts.push(h('div', { class: 'mp-moderow' }, h('span', { class: 'set-label', text: 'Music during gameplay' }), seg), this.note);
    }
    parts.push(head, seekRow, tools, this.list);
    this.el = h(
      'div',
      { class: `music-player ${page ? 'mp-page' : 'title-music'}`, role: 'group', 'aria-label': 'Music player' },
      ...parts,
    );
    this.setExpanded(this.expanded, false);
    this.update();
  }

  // ------------------------------------------------------------------ state helpers

  /** The theme shown / controlled: what the AudioSystem wants (the playlist until it has decided). */
  private get theme(): MusicTrack {
    return musicPrefs.theme ?? musicPrefs.track;
  }

  private get onTitle() {
    return this.api.game.state === 'title';
  }

  private startPlaying(track: MusicTrack) {
    musicPrefs.userPaused = false;
    // The AudioSystem's gesture listener unlocks audio on this very click; playMusic is remembered until then.
    audio.playMusic(track, FADE);
    if (!audio.unlocked) void audio.unlock();
  }

  // ------------------------------------------------------------------ actions

  private togglePlay() {
    // Decide from what the button showed when it was pressed: this very tap may be unlocking audio, and on touch a
    // frame can run between pointerdown (unlock → the playlist starts) and click (which would then pause it again).
    const showed = performance.now() - this.pressAt < 1500 ? this.pressShown : this.shownPlay;
    this.pressAt = -1e9;
    if (showed) {
      musicPrefs.userPaused = true;
      audio.stopMusic(FADE);
    } else this.startPlaying(this.theme);
    this.api.sfx('ui_toggle');
    this.update();
  }

  private skip(d: 1 | -1) {
    const track = this.theme;
    const info = audio.musicInfo(track);
    // "Previous" restarts the current track first (like every music player), unless it just started.
    let idx = info.index;
    if (!(d < 0 && info.time > 3)) idx = track === musicPrefs.track ? musicPrefs.step(info.index, d) : info.index + d;
    audio.musicSelect(track, idx);
    if (!info.wanted || !audio.unlocked) this.startPlaying(track);
    this.api.sfx('ui_click');
    this.update();
  }

  /** Play playlist track `i` (switches gameplay to "My playlist"). */
  private playTrack(i: number) {
    if (!this.onTitle) musicPrefs.setMode('playlist');
    musicPrefs.theme = musicPrefs.track;
    audio.musicSelect(musicPrefs.track, i);
    this.startPlaying(musicPrefs.track);
    this.api.sfx('ui_click');
    this.update();
  }

  private toggleCheck(i: number) {
    const on = !musicPrefs.checked[i];
    if (!musicPrefs.setChecked(i, on)) {
      this.api.sfx('ui_error');
      const r = this.rows[i];
      r.li.classList.remove('mp-nope');
      void r.li.offsetWidth;
      r.li.classList.add('mp-nope');
      return;
    }
    this.api.sfx('ui_toggle');
    this.update();
  }

  private toggleShuffle() {
    musicPrefs.setShuffle(!musicPrefs.shuffle);
    this.api.sfx('ui_toggle');
    this.update();
  }

  private pickMode(m: MusicMode) {
    if (m !== musicPrefs.mode) {
      musicPrefs.setMode(m);
      if (!audio.unlocked) void audio.unlock();
    }
    this.api.sfx('ui_toggle');
    this.update();
  }

  private setVolume(v: number) {
    const s = this.api.settings;
    s.music = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
    this.api.commitSettings('music');
    this.update();
  }

  private toggleMute() {
    const s = this.api.settings;
    if (s.music > 0) {
      musicPrefs.setUnmuteVolume(s.music);
      this.setVolume(0);
    } else this.setVolume(musicPrefs.unmuteVolume || 0.6);
    this.api.sfx('ui_toggle');
  }

  private setExpanded(on: boolean, sound = true) {
    this.expanded = on;
    this.el?.classList.toggle('expanded', on);
    if (this.listBtn) {
      this.listBtn.setAttribute('aria-expanded', String(on));
      this.listBtn.title = on ? 'Hide playlist' : 'Show playlist';
    }
    if (sound) this.api.sfx(on ? 'ui_open' : 'ui_close');
    if (on && sound) requestAnimationFrame(() => this.list.querySelector<HTMLElement>('.mp-row.cur .mp-name')?.scrollIntoView({ block: 'nearest' }));
  }

  private bindSeek() {
    const s = this.seek;
    const commit = () => {
      audio.musicSeek(this.theme, Number(s.value));
      this.shownSec = -1;
    };
    // While dragging, the bar only moves the thumb + time label; the seek happens on release (no stutter).
    s.addEventListener('pointerdown', () => {
      this.seeking = true;
      const up = () => {
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        if (!this.seeking) return;
        this.seeking = false;
        commit();
      };
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
    });
    s.addEventListener('input', () => {
      setFill(s);
      this.tNow.textContent = fmtTime(Number(s.value));
      if (!this.seeking) commit(); // keyboard / PadNav
    });
    s.addEventListener('change', () => {
      this.seeking = false;
      commit();
    });
    s.addEventListener('keydown', (e) => {
      const d = e.code === 'ArrowRight' || e.code === 'ArrowUp' ? 1 : e.code === 'ArrowLeft' || e.code === 'ArrowDown' ? -1 : 0;
      if (!d || e.code === 'ArrowUp' || e.code === 'ArrowDown') return; // up / down move focus (UI.onKey)
      e.preventDefault();
      s.value = String(Math.max(0, Math.min(Number(s.max), Number(s.value) + d * SEEK_STEP)));
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  private buildRow(f: MusicFile, i: number): Row {
    const check = h('button', {
      class: 'mp-check',
      role: 'checkbox',
      'aria-checked': 'true',
      'aria-label': `Include ${f.title}`,
      title: 'Include in the playlist',
      html: ICONS.check,
      onclick: () => this.toggleCheck(i),
    });
    const name = h('button', { class: 'mp-name', title: `Play ${f.title}`, text: f.title, onclick: () => this.playTrack(i) });
    const by = h('span', { class: 'mp-row-by' });
    this.authorInto(by, f);
    const li = h('li', { class: 'mp-row' }, check, h('div', { class: 'mp-row-main' }, name, by), h('span', { class: 'mp-eq', 'aria-hidden': 'true', html: ICONS.note }));
    this.list.append(li);
    return { li, check, on: null, cur: null };
  }

  private authorInto(el: HTMLElement, f: MusicFile) {
    const link = (label: string, url: string) =>
      h('a', { class: 'mp-link', href: url, target: '_blank', rel: 'noopener noreferrer', title: `${label} on OpenGameArt (opens a new tab)`, text: label });
    const [a, b] = f.links ?? [];
    el.append('by ');
    if (!a) el.append(f.author);
    else if (!b) el.append(link(a.label, a.url));
    else el.append(link(a.label, a.url), ' · edit ', link(b.label, b.url));
  }

  private renderTrack(f: MusicFile | null) {
    this.titleEl.textContent = f?.title ?? '—';
    this.titleEl.title = f?.title ?? '';
    this.byEl.textContent = '';
    if (f) this.authorInto(this.byEl, f);
  }

  // ------------------------------------------------------------------ per frame

  /** Called every frame while visible (cheap: only touches the DOM on changes). */
  update() {
    const track = this.theme;
    const info = audio.musicInfo(track);
    if (info.file !== this.shownFile) {
      this.shownFile = info.file;
      this.renderTrack(info.file);
    }
    const on = info.wanted && audio.unlocked;
    if (on !== this.shownPlay) {
      this.shownPlay = on;
      this.playBtn.innerHTML = on ? ICONS.pause : ICONS.play;
      const l = on ? 'Pause music' : 'Play music';
      this.playBtn.setAttribute('aria-label', l);
      this.playBtn.title = l;
    }
    const kicker = `${on ? 'Now playing' : 'Paused'}${track === musicPrefs.track || this.onTitle ? '' : ` · Auto: ${THEME_LABEL[track]}`}`;
    if (kicker !== this.shownKicker) this.kickerEl.textContent = this.shownKicker = kicker;
    this.el.classList.toggle('playing', info.playing);

    // seek bar
    const dur = info.duration;
    if (dur !== this.shownDur) {
      this.shownDur = dur;
      this.seek.max = String(dur > 0 ? dur : 1);
      this.seek.disabled = !(dur > 0);
      this.tEnd.textContent = dur > 0 ? fmtTime(dur) : '–:––';
      this.shownSec = -1;
    }
    if (!this.seeking) {
      // (while dragging, the thumb + label follow the pointer instead)
      this.seek.value = String(Math.min(info.time, dur || 0));
      setFill(this.seek);
      const sec = Math.floor(info.time);
      if (sec !== this.shownSec) {
        this.shownSec = sec;
        this.tNow.textContent = fmtTime(sec);
      }
    }

    // volume
    const vol = Math.round(this.api.settings.music * 100);
    if (vol !== this.shownVol) {
      this.shownVol = vol;
      if (Number(this.vol.value) !== vol) this.vol.value = String(vol);
      setFill(this.vol);
      const muted = vol <= 0;
      this.muteBtn.innerHTML = muted ? ICONS.mute : ICONS.volume;
      const l = muted ? 'Unmute music' : 'Mute music';
      this.muteBtn.setAttribute('aria-label', l);
      this.muteBtn.title = l;
      this.muteBtn.classList.toggle('on', muted);
      this.vol.setAttribute('aria-valuetext', `${vol}%`);
    }
    if (musicPrefs.shuffle !== this.shownShuffle) {
      this.shownShuffle = musicPrefs.shuffle;
      this.shuffleBtn.classList.toggle('on', musicPrefs.shuffle);
      this.shuffleBtn.setAttribute('aria-pressed', String(musicPrefs.shuffle));
      this.shuffleBtn.title = musicPrefs.shuffle ? 'Shuffle: on' : 'Shuffle: off';
    }

    // mode toggle (pause menu)
    if (this.modeBtns.length && musicPrefs.mode !== this.shownMode) {
      this.shownMode = musicPrefs.mode;
      for (const b of this.modeBtns) {
        const sel = b.dataset.mode === musicPrefs.mode;
        b.classList.toggle('on', sel);
        b.setAttribute('aria-checked', String(sel));
      }
      if (this.note)
        this.note.textContent =
          musicPrefs.mode === 'auto'
            ? 'The soundtrack follows Jimothy: jaunty by day, lo-fi at night, glitchy at SlopCorp. Pick a track below to switch to your playlist.'
            : 'Your checked tracks play everywhere, in order or shuffled. Unchecked tracks are skipped.';
    }

    // playlist rows
    const curFile = info.file?.file;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      const onRow = musicPrefs.checked[i];
      if (onRow !== r.on) {
        r.on = onRow;
        r.li.classList.toggle('off', !onRow);
        r.check.setAttribute('aria-checked', String(onRow));
      }
      const cur = PLAYLIST[i].file === curFile;
      if (cur !== r.cur) {
        r.cur = cur;
        r.li.classList.toggle('cur', cur);
        if (cur) r.li.setAttribute('aria-current', 'true');
        else r.li.removeAttribute('aria-current');
      }
    }
  }
}
