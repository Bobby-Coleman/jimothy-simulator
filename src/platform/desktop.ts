import type { Game, System } from '../core/Game';

/**
 * Desktop (Electron / Steam) integration. Completely inert on the web: everything keys off `window.jimothyDesktop`,
 * which only the desktop shell's preload script defines (desktop/electron/preload.cjs; see desktop/README.md).
 */

export interface DesktopSteam {
  /** Steam is running and the Steam API initialised. */
  readonly available: boolean;
  readonly appId: number;
  readonly overlay: boolean;
  readonly onDeck: boolean;
  readonly language: string | null;
  /** Unlock a Steam achievement by API name; false without Steam or for unknown names. */
  unlockAchievement(apiName: string): Promise<boolean>;
  isAchievementUnlocked(apiName: string): Promise<boolean>;
  status(): Promise<unknown>;
}

export interface DesktopNotice {
  title: string;
  text?: string;
}

export interface DesktopBridge {
  readonly platform: string;
  readonly version: string;
  readonly electron: string;
  readonly packaged: boolean;
  /** Save and close the game. */
  quit(): void;
  /** Window fullscreen (borderless), not the web Fullscreen API. */
  isFullscreen(): boolean;
  setFullscreen(on: boolean): void;
  toggleFullscreen(): void;
  onFullscreenChange(fn: (on: boolean) => void): () => void;
  openExternal(url: string): void;
  onNotice(fn: (n: DesktopNotice) => void): () => void;
  /** Instinct completed: the shell unlocks the mapped Steam achievement (desktop/achievements.json). */
  objectiveCompleted(id: string): void;
  /** All completed Instincts, so achievements earned while Steam wasn't running unlock later. */
  syncObjectives(ids: string[]): void;
  readonly steam: DesktopSteam;
}

declare global {
  interface Window {
    jimothyDesktop?: DesktopBridge;
  }
}

/** The desktop shell's bridge, or null in a browser. */
export const desktop: DesktopBridge | null = (typeof window !== 'undefined' && window.jimothyDesktop) || null;

/** "Exit" icon for the desktop Quit buttons (24×24, currentColor, like ui/icons.ts). */
export const QUIT_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10.5 4H6.2A2.2 2.2 0 0 0 4 6.2v11.6A2.2 2.2 0 0 0 6.2 20h4.3M14.5 7.5L19 12l-4.5 4.5M19 12H9.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Registered last in systems.ts as 'desktop'; does nothing on the web. On the desktop build:
 *  - completed Instincts unlock their Steam achievements, and Instincts completed earlier (e.g. while Steam wasn't
 *    running) are synced a few seconds after boot;
 *  - audio starts right away (the shell allows autoplay), so the title music plays without a first click;
 *  - shell notices ("Photo saved") show as toasts.
 */
export class DesktopSystem implements System {
  name = 'desktop';

  init(game: Game) {
    const d = desktop;
    if (!d) return;
    game.events.on('objective', (e: { id?: string }) => {
      if (e?.id) d.objectiveCompleted(e.id);
    });
    window.setTimeout(() => {
      const objectives = game.get<any>('objectives');
      const done: string[] = (objectives?.list ?? []).filter((o: any) => o.done).map((o: any) => String(o.id));
      if (done.length) d.syncObjectives(done);
    }, 4000);
    try {
      void game.get<any>('audio')?.manager?.unlock?.();
    } catch {
      /* audio is optional */
    }
    d.onNotice((n) => {
      // Photo mode hides the HUD (and its toasts): confirm on the photo card's Save button too.
      const save = document.querySelector<HTMLElement>('[data-act="save"]');
      if (save && /photo/i.test(n.title)) {
        save.textContent = /not/i.test(n.title) ? 'Not saved' : 'Saved ✓';
        if (n.text) save.title = n.text;
      }
      game.get<any>('ui')?.toast?.(n.title, n.text, 'camera');
    });
  }
}
