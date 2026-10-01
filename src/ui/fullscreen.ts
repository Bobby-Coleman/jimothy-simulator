/**
 * Fullscreen helpers (standard API with the webkit-prefixed fallback for older Safari / iPadOS).
 * iPhone Safari has no element fullscreen at all: `fullscreenSupported()` is false there and the
 * buttons hide themselves.
 * Desktop build (Electron): every helper drives the borderless game window through the shell's bridge instead.
 */
import { desktop } from '../platform/desktop';

type FsDoc = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: (opts?: unknown) => Promise<void> | void };

const doc = () => (typeof document !== 'undefined' ? (document as FsDoc) : null);

export function fullscreenSupported(): boolean {
  if (desktop) return true;
  const d = doc();
  if (!d) return false;
  const el = d.documentElement as FsEl;
  if (typeof el.requestFullscreen === 'function' && d.fullscreenEnabled !== false) return true;
  return typeof el.webkitRequestFullscreen === 'function' && d.webkitFullscreenEnabled !== false;
}

export function isFullscreen(): boolean {
  if (desktop) return desktop.isFullscreen();
  const d = doc();
  return !!(d && (d.fullscreenElement || d.webkitFullscreenElement));
}

/** Enter fullscreen (must run inside a user gesture). Resolves true on success, false if refused. */
export async function enterFullscreen(): Promise<boolean> {
  if (desktop) {
    desktop.setFullscreen(true);
    return true;
  }
  const d = doc();
  if (!d || isFullscreen()) return isFullscreen();
  const el = d.documentElement as FsEl;
  try {
    if (typeof el.requestFullscreen === 'function') await el.requestFullscreen({ navigationUI: 'hide' });
    else if (typeof el.webkitRequestFullscreen === 'function') await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<boolean> {
  if (desktop) {
    desktop.setFullscreen(false);
    return true;
  }
  const d = doc();
  if (!d || !isFullscreen()) return true;
  try {
    if (typeof d.exitFullscreen === 'function' && d.fullscreenElement) await d.exitFullscreen();
    else if (typeof d.webkitExitFullscreen === 'function') await d.webkitExitFullscreen();
    return true;
  } catch {
    return false;
  }
}

/** Toggle; resolves to whether the requested change happened. */
export function toggleFullscreen(): Promise<boolean> {
  return isFullscreen() ? exitFullscreen() : enterFullscreen();
}

const renders = new WeakMap<HTMLElement, (on: boolean) => void>();
let listening = false;

/**
 * Keep a fullscreen button in sync: `render(on)` runs now and on every fullscreenchange while the button is in
 * the document (menu pages are rebuilt often, so buttons are found by attribute instead of holding listeners).
 * Hides the button when fullscreen is unavailable (e.g. iPhone Safari).
 */
export function bindFullscreenButton(btn: HTMLElement, render: (on: boolean) => void) {
  btn.setAttribute('data-fs-toggle', '');
  if (!fullscreenSupported()) btn.style.display = 'none';
  renders.set(btn, render);
  render(isFullscreen());
  if (!listening && doc()) {
    listening = true;
    onFullscreenChange((on) => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-fs-toggle]')) renders.get(el)?.(on);
    });
  }
}

/** Subscribe to fullscreen changes (both event names). Returns an unsubscribe function. */
export function onFullscreenChange(fn: (on: boolean) => void): () => void {
  if (desktop) return desktop.onFullscreenChange(fn);
  const d = doc();
  if (!d) return () => {};
  const cb = () => fn(isFullscreen());
  d.addEventListener('fullscreenchange', cb);
  d.addEventListener('webkitfullscreenchange', cb);
  return () => {
    d.removeEventListener('fullscreenchange', cb);
    d.removeEventListener('webkitfullscreenchange', cb);
  };
}
