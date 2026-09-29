import { isShown } from './dom';

/** Directions include the left stick; `dleft`/`dright` are the D-pad buttons only (safe to use during gameplay). */
export type NavKey = 'up' | 'down' | 'left' | 'right' | 'dleft' | 'dright' | 'a' | 'b' | 'start' | 'back';

const BUTTONS: [number, NavKey][] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
  [14, 'dleft'],
  [15, 'dright'],
  [0, 'a'],
  [1, 'b'],
  [9, 'start'],
  [8, 'back'],
];
const DIRS = new Set<NavKey>(['up', 'down', 'left', 'right']);

/**
 * Raw gamepad polling for menu navigation (D-pad / left stick with key-repeat, A, B, Start, Back).
 * Independent of the game's action mapping so menus always feel the same.
 */
export class PadNav {
  private prev = new Set<NavKey>();
  private repeat = new Map<NavKey, number>();

  poll(dt: number): NavKey[] {
    const out: NavKey[] = [];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    const now = new Set<NavKey>();
    if (pad) {
      for (const [i, k] of BUTTONS) {
        const b = pad.buttons[i];
        if (b && (b.pressed || b.value > 0.5)) now.add(k);
      }
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (ay < -0.6) now.add('up');
      if (ay > 0.6) now.add('down');
      if (ax < -0.6) now.add('left');
      if (ax > 0.6) now.add('right');
    }
    for (const k of now) {
      if (!this.prev.has(k)) {
        out.push(k);
        if (DIRS.has(k)) this.repeat.set(k, 0.38);
      } else if (DIRS.has(k)) {
        const r = (this.repeat.get(k) ?? 0.38) - dt;
        if (r <= 0) {
          out.push(k);
          this.repeat.set(k, 0.1);
        } else this.repeat.set(k, r);
      }
    }
    this.prev = now;
    return out;
  }
}

/** Focusable controls inside a container, in DOM order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, [data-nav]')].filter(
    (el) => isShown(el) && !el.closest('[aria-hidden="true"]'),
  );
}

/** Move focus up/down; left/right adjusts sliders or moves within a segmented control. */
export function navigate(root: HTMLElement, dir: NavKey): boolean {
  const els = focusables(root);
  if (!els.length) return false;
  const active = document.activeElement as HTMLElement | null;
  const i = active ? els.indexOf(active) : -1;
  if (dir === 'up' || dir === 'down') {
    const d = dir === 'down' ? 1 : -1;
    const next = i < 0 ? els[d > 0 ? 0 : els.length - 1] : els[(i + d + els.length) % els.length];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
    return true;
  }
  if ((dir === 'left' || dir === 'right') && active && i >= 0) {
    const d = dir === 'right' ? 1 : -1;
    if (active instanceof HTMLInputElement && active.type === 'range') {
      const step = Number(active.step) || 1;
      const v = Math.min(Number(active.max), Math.max(Number(active.min), Number(active.value) + d * step));
      active.value = String(v);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const seg = active.closest('.seg');
    if (seg) {
      const opts = [...seg.querySelectorAll<HTMLElement>('button')];
      const j = opts.indexOf(active);
      const n = opts[Math.min(opts.length - 1, Math.max(0, j + d))];
      n?.focus();
      return true;
    }
  }
  return false;
}

/** Ensure something inside `root` has focus (the preferred element, else the first control). */
export function ensureFocus(root: HTMLElement, preferred?: HTMLElement | null) {
  const active = document.activeElement as HTMLElement | null;
  if (active && root.contains(active) && isShown(active)) return;
  const el = preferred && isShown(preferred) ? preferred : focusables(root)[0];
  el?.focus({ preventScroll: true });
}
