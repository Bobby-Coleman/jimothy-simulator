/**
 * The player's music choices (the music player in src/ui/MusicPlayer.ts), persisted in
 * localStorage['jimothy.music.v1']:
 *
 *  - mode:    'auto'     = the AudioSystem picks day / night / slop themes by situation (default);
 *             'playlist' = the 'title' playlist (every track, the player's picks) also plays during gameplay.
 *             The title screen always plays the playlist.
 *  - checked: which playlist tracks are in rotation (index = MUSIC_BANK.title.files index; at least one stays on).
 *             Next / previous / auto-advance skip unchecked tracks.
 *  - shuffle: random order among the checked tracks (previous walks back through what played).
 *  - last:    the last playlist track.
 *  - paused:  the player paused the music (remembered across visits: the title screen stays quiet until they press
 *             play). Otherwise the title screen starts on a random checked track.
 *  Checking / unchecking a track switches the mode to 'playlist' (the player is curating: they want their picks).
 *
 *  Save format v2: the playlist lost "A respectable amount of Bounce" (old index 4); v1 index-based saves are
 *  migrated on load.
 *
 * Plus runtime-only state: `theme` (the music theme the AudioSystem currently wants, resolved from the mode) and
 * `userPaused` (the player pressed pause: the AudioSystem doesn't start new themes until they press play).
 */
import { audio } from './AudioManager';
import { MUSIC_BANK, type MusicTrack } from './soundBank';

export type MusicMode = 'auto' | 'playlist';

const KEY = 'jimothy.music.v1';
const PLAYLIST: MusicTrack = 'title';

class MusicPrefs {
  mode: MusicMode = 'auto';
  readonly count = MUSIC_BANK[PLAYLIST].files.length;
  checked: boolean[] = new Array(this.count).fill(true);
  shuffle = false;
  last = 0;
  /** Music volume before the player's mute button zeroed it (restored on unmute). */
  unmuteVolume = 0.6;
  /** The theme the AudioSystem wants right now (the player shows / seeks this one). Set every frame. */
  theme: MusicTrack | null = null;
  /** The player paused the music: don't auto-start themes until it presses play (or switches mode). Persisted. */
  private paused = false;
  get userPaused() {
    return this.paused;
  }
  set userPaused(v: boolean) {
    if (v === this.paused) return;
    this.paused = v;
    this.save();
  }
  /** Shuffle history (for "previous"). */
  private history: number[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
    audio.setMusicPicker(PLAYLIST, (cur, dir) => this.step(cur, dir));
    // The title screen opens on a random checked track (it autoplays once the browser allows audio, unless paused)
    const on = this.checked.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    const start = on.length ? on[Math.floor(Math.random() * on.length)] : 0;
    audio.musicSelect(PLAYLIST, start);
  }

  /** The playlist's theme key in the AudioManager. */
  get track(): MusicTrack {
    return PLAYLIST;
  }

  get checkedCount() {
    return this.checked.filter(Boolean).length;
  }

  /** Next (dir 1) / previous (dir -1) playlist index after `cur`, skipping unchecked tracks. */
  step(cur: number, dir: 1 | -1): number {
    const n = this.count;
    const on = this.checked.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    if (!on.length) return cur;
    if (this.shuffle) {
      if (dir < 0) {
        while (this.history.length) {
          const h = this.history.pop()!;
          if (h !== cur && this.checked[h]) return h;
        }
      }
      const pool = on.filter((i) => i !== cur);
      if (!pool.length) return on[0];
      if (dir > 0) {
        this.history.push(cur);
        if (this.history.length > 50) this.history.shift();
      }
      return pool[Math.floor(Math.random() * pool.length)];
    }
    let i = cur;
    for (let k = 0; k < n; k++) {
      i = (((i + dir) % n) + n) % n;
      if (this.checked[i]) return i;
    }
    return cur;
  }

  /** Include / exclude a track. Refuses to uncheck the last checked one (returns false). */
  setChecked(i: number, on: boolean): boolean {
    if (i < 0 || i >= this.count) return false;
    if (!on && this.checked[i] && this.checkedCount <= 1) return false;
    this.checked[i] = on;
    // curating the playlist = "my playlist" (keeps a user pause as it is)
    this.mode = 'playlist';
    this.save();
    return true;
  }

  setShuffle(on: boolean) {
    this.shuffle = on;
    this.history = [];
    this.save();
  }

  /** Switch auto themes ↔ my playlist. The AudioSystem crossfades on its next frame; clears a user pause. */
  setMode(m: MusicMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.userPaused = false;
    this.save();
  }

  /** Remember the playlist position (called by the AudioSystem when the playlist's track changes). */
  noteTrack(i: number) {
    if (i === this.last || i < 0 || i >= this.count) return;
    this.last = i;
    this.save();
  }

  setUnmuteVolume(v: number) {
    if (!(v > 0)) return;
    this.unmuteVolume = v;
    this.save();
  }

  /** Called after any persisted change (the UI re-renders open players). */
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
      if (raw.mode === 'auto' || raw.mode === 'playlist') this.mode = raw.mode;
      let savedChecked = Array.isArray(raw.checked) ? (raw.checked as unknown[]).slice() : null;
      let savedLast = typeof raw.last === 'number' ? raw.last : -1;
      if (raw.v !== 2) {
        // v1 saves indexed the old 9-track list, which had "A respectable amount of Bounce" at index 4
        if (savedChecked && savedChecked.length === 9) savedChecked.splice(4, 1);
        if (savedLast === 4) savedLast = 0;
        else if (savedLast > 4) savedLast -= 1;
      }
      if (savedChecked) {
        const c = this.checked.map((_, i) => savedChecked![i] !== false);
        if (c.some(Boolean)) this.checked = c;
      }
      if (typeof raw.shuffle === 'boolean') this.shuffle = raw.shuffle;
      if (savedLast >= 0 && savedLast < this.count) this.last = Math.floor(savedLast);
      if (typeof raw.paused === 'boolean') this.paused = raw.paused;
      if (typeof raw.unmute === 'number' && raw.unmute > 0 && raw.unmute <= 1) this.unmuteVolume = raw.unmute;
    } catch {
      /* private mode / bad JSON: defaults */
    }
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 2, mode: this.mode, checked: this.checked, shuffle: this.shuffle, last: this.last, unmute: this.unmuteVolume, paused: this.paused }));
    } catch {
      /* storage unavailable */
    }
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }
}

export const musicPrefs = new MusicPrefs();
