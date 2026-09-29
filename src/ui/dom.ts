/** Tiny DOM helpers for the UI (no framework, no dependencies). */

export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> | null | undefined;

/**
 * Create an element. Special attrs: `class`, `html` (innerHTML), `text`, `style` (object),
 * `on<event>` (listener). `false`/`null` attrs are skipped, `true` becomes an empty attribute.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') setStyle(el, v as Record<string, string>);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

/** Assign inline styles; keys starting with `--` are set as CSS custom properties. */
export function setStyle(el: HTMLElement, styles: Record<string, string | number>) {
  for (const k in styles) {
    const v = String(styles[k]);
    if (k.startsWith('--')) el.style.setProperty(k, v);
    else (el.style as any)[k] = v;
  }
}

export function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Restart a CSS animation class on an element. */
export function replay(el: Element, cls: string) {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** Random element, optionally avoiding one value (no immediate repeats). */
export function pick<T>(arr: readonly T[], avoid?: T): T {
  if (arr.length <= 1) return arr[0];
  let v = arr[Math.floor(Math.random() * arr.length)];
  for (let i = 0; i < 4 && v === avoid; i++) v = arr[Math.floor(Math.random() * arr.length)];
  return v;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Remove an element after its CSS exit animation (or a timeout fallback). */
export function removeAfter(el: Element, ms: number) {
  window.setTimeout(() => el.remove(), ms);
}

/** True when the element is rendered (not display:none, not detached). */
export function isShown(el: HTMLElement) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

/** Automated browser (Playwright/WebDriver)? Used to keep test screenshots clean. */
export const AUTOMATED = typeof navigator !== 'undefined' && !!(navigator as any).webdriver;

/** Coarse pointer = phone/tablet. */
export const IS_TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function nowSec() {
  return performance.now() / 1000;
}
