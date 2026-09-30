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
  /**
   * Full-screen flashes (fans' camera flashes, `ui.flash()`) and camera shake. Shown inverted in Settings as the
   * accessibility toggle "Reduce flashing & shake". Defaults off when the OS asks for reduced motion.
   */
  flashes: boolean;
  /** "I just want to play": every mutator can be toggled. */
  unlockAll: boolean;
  /** Tracked-goal pill + world waypoint (ui/Guide.ts). */
  showGuide: boolean;
}

const prefersReducedMotion = () => {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const DEFAULT_SETTINGS: Settings = {
  // (sound effects play at twice the slider's level: see SFX_GAIN in audio/AudioManager.ts)
  master: 0.4,
  sfx: 0.4,
  music: 0.4,
  sensitivity: 1,
  invertY: false,
  dayLength: 20,
  freezeTime: false,
  showFps: false,
  showHud: true,
  flashes: !prefersReducedMotion(),
  unlockAll: false,
  showGuide: true,
};

const KEY = 'jimothy.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    // Saved settings hold every value, changed or not: volumes still at the old defaults (80 / 90 / 60 %) were never
    // touched, so they move to the new ones
    if (raw && raw.master === 0.8 && raw.sfx === 0.9 && raw.music === 0.6) {
      delete raw.master;
      delete raw.sfx;
      delete raw.music;
    }
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
let basePadLook: number | null = null;

export function applySettings(game: Game, s: Settings, baseSens: number, changed?: keyof Settings) {
  const all = !changed;
  const inp = game.input;
  if (basePadLook == null) basePadLook = inp.padLookSpeed;
  if (all || changed === 'sensitivity') {
    // One "Look sensitivity" for mouse, gamepad right stick and touch drag (Touch.ts reads it directly).
    inp.mouseSensitivity = baseSens * s.sensitivity;
    inp.padLookSpeed = basePadLook * s.sensitivity;
  }
  if (all || changed === 'invertY') inp.invertY = s.invertY;
  if (all || changed === 'flashes') {
    // "Reduce flashing & shake": swallow camera shake without touching the engine's CameraRig (an own property
    // shadows CameraRig.prototype.shake; deleting it restores the original).
    const rig = game.get<any>('camera');
    if (rig) {
      if (!s.flashes) rig.shake = () => {};
      else if (Object.prototype.hasOwnProperty.call(rig, 'shake')) delete rig.shake;
    }
  }
  const env = game.get<any>('environment');
  if (env) {
    if (all || changed === 'dayLength') env.dayLengthMinutes = s.dayLength;
    if ((all && s.freezeTime) || changed === 'freezeTime') env.frozen = s.freezeTime;
  }
  const muts = game.get<any>('mutators');
  if (muts && ((all && s.unlockAll) || changed === 'unlockAll')) muts.allUnlocked = s.unlockAll;
  if (all || changed === 'master' || changed === 'sfx' || changed === 'music') applyAudio(game, s);
}
