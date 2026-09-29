import type { Game } from '../core/Game';

/** Player-facing settings, persisted in localStorage (quality is persisted by the Renderer itself). */
export interface Settings {
  master: number;
  sfx: number;
  music: number;
  /** Multiplier on the default mouse / touch-look sensitivity. */
  sensitivity: number;
  invertY: boolean;
  /** Real minutes per in-game day. */
  dayLength: number;
  freezeTime: boolean;
  showFps: boolean;
  showHud: boolean;
  /** Camera-flash overlay when fans take photos. */
  flashes: boolean;
  /** "I just want to play": every mutator can be toggled. */
  unlockAll: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  sfx: 0.9,
  music: 0.6,
  sensitivity: 1,
  invertY: false,
  dayLength: 20,
  freezeTime: false,
  showFps: false,
  showHud: true,
  flashes: true,
  unlockAll: false,
};

const KEY = 'jimothy.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const s = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (raw && typeof raw[k] === typeof DEFAULT_SETTINGS[k]) (s as any)[k] = raw[k];
    }
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. */
  }
}

/** Push volumes to the audio system (if present) and broadcast them for anyone else listening. */
export function applyAudio(game: Game, s: Settings) {
  const v = { master: s.master, sfx: s.sfx, music: s.music };
  try {
    game.get<any>('audio')?.setVolumes?.(v);
  } catch (err) {
    console.warn('[ui] audio.setVolumes failed', err);
  }
  game.events.emit('audioVolume', v);
}

/**
 * Apply settings that live in other systems. `baseSens` = the Input's default mouse sensitivity.
 * `changed`: only apply that setting (so e.g. a volume change never un-freezes time a mutator froze).
 * Without it (startup) everything is applied, but "off" states that other systems may own
 * (frozen time, unlock-all) are left alone.
 */
export function applySettings(game: Game, s: Settings, baseSens: number, changed?: keyof Settings) {
  const all = !changed;
  const inp = game.input;
  if (all || changed === 'sensitivity') inp.mouseSensitivity = baseSens * s.sensitivity;
  if (all || changed === 'invertY') inp.invertY = s.invertY;
  const env = game.get<any>('environment');
  if (env) {
    if (all || changed === 'dayLength') env.dayLengthMinutes = s.dayLength;
    if ((all && s.freezeTime) || changed === 'freezeTime') env.frozen = s.freezeTime;
  }
  const muts = game.get<any>('mutators');
  if (muts && ((all && s.unlockAll) || changed === 'unlockAll')) muts.allUnlocked = s.unlockAll;
  if (all || changed === 'master' || changed === 'sfx' || changed === 'music') applyAudio(game, s);
}
