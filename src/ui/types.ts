import type { Game } from '../core/Game';
import type { Device } from './glyphs';
import type { Settings } from './settings';

/** What UI components need from the UI system (avoids circular imports). */
export interface UiCtx {
  readonly game: Game;
  readonly device: Device;
  readonly settings: Settings;
  /** Play a UI sound (non-positional). */
  sfx(key: string, volume?: number, pitch?: number): void;
}

export type UIMode = 'title' | 'intro' | 'play' | 'pause';

export interface DialogOptions {
  speaker: string;
  /** Image URL, a known icon name, 'jimothy', 'slopbot', or a short emoji/text. Default: speaker initials. */
  portrait?: string;
  lines: string[];
  onDone?: () => void;
  /** Accent color for the name tag. */
  color?: string;
}
