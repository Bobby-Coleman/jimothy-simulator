import { h, esc } from './dom';
import { ICONS, JIMOTHY_FACE, SLOPBOT_ART, iconFromSpec } from './icons';
import { glyph } from './glyphs';
import type { DialogOptions, UiCtx } from './types';

const CHARS_PER_SEC = 48;

/**
 * Quest dialogue box: speaker name + portrait, typewriter text, advance with click / E / Space / A.
 * Freezes the player while open (restores the previous frozen state afterwards). Queues if busy.
 */
export class DialogBox {
  readonly el: HTMLElement;
  private nameEl: HTMLElement;
  private portraitEl: HTMLElement;
  private textEl: HTMLElement;
  private nextEl: HTMLElement;
  /** The dialog currently showing (read-only for other systems: `ui.dialog.cur?.speaker`). */
  cur: (DialogOptions & { resolve: () => void }) | null = null;
  private queue: (DialogOptions & { resolve: () => void })[] = [];
  private line = 0;
  private chars = 0;
  private full = '';
  private openedAt = 0;
  private prevFrozen = false;
  private lastDevice = '';

  constructor(
    private ctx: UiCtx,
    parent: HTMLElement,
  ) {
    this.nameEl = h('div', { class: 'dlg-name' });
    this.portraitEl = h('div', { class: 'dlg-portrait' });
    this.textEl = h('div', { class: 'dlg-text' });
    this.nextEl = h('div', { class: 'dlg-next' });
    // Input (click / E / Space / Enter / A) is routed here by the UI system via input().
    this.el = h(
      'div',
      { class: 'dlg', role: 'dialog', 'aria-live': 'polite' },
      this.portraitEl,
      h('div', { class: 'dlg-body' }, this.nameEl, this.textEl),
      this.nextEl,
    );
    parent.append(this.el);
  }

  get open() {
    return !!this.cur;
  }

  show(opts: DialogOptions): Promise<void> {
    return new Promise<void>((resolve) => {
      const item = { ...opts, lines: (opts.lines ?? []).filter((l) => l != null).map(String), resolve };
      if (!item.lines.length) item.lines = ['…'];
      if (this.cur) this.queue.push(item);
      else this.start(item);
    });
  }

  private start(item: DialogOptions & { resolve: () => void }) {
    const game = this.ctx.game;
    this.cur = item;
    this.line = 0;
    const player = game.get<any>('player');
    if (player) {
      this.prevFrozen = !!player.frozen;
      player.frozen = true;
    }
    this.nameEl.textContent = item.speaker || '???';
    this.nameEl.style.setProperty('--tag', item.color ?? '#19c2b8');
    this.portraitEl.innerHTML = portraitHtml(item.speaker, item.portrait);
    this.openedAt = performance.now();
    this.el.classList.add('open');
    this.setLine(0);
    game.events.emit('dialogOpen', { speaker: item.speaker });
    this.ctx.sfx('ui_open', 0.6);
  }

  private setLine(i: number) {
    this.line = i;
    this.full = this.cur!.lines[i];
    this.chars = 0;
    this.textEl.textContent = '';
    this.nextEl.classList.remove('ready');
  }

  /** Player input (ignored for a moment after opening so the press that opened it doesn't skip line 1). */
  input() {
    if (!this.cur || performance.now() - this.openedAt < 250) return;
    this.advance();
  }

  /** Skip typing / advance / close. */
  advance() {
    if (!this.cur) return;
    if (this.chars < this.full.length) {
      this.chars = this.full.length;
      this.textEl.textContent = this.full;
      return;
    }
    if (this.line + 1 < this.cur.lines.length) {
      this.setLine(this.line + 1);
      this.ctx.sfx('ui_click', 0.4);
    } else this.close();
  }

  close() {
    const cur = this.cur;
    if (!cur) return;
    this.cur = null;
    this.el.classList.remove('open');
    const game = this.ctx.game;
    const player = game.get<any>('player');
    if (player) player.frozen = this.prevFrozen;
    game.events.emit('dialogClose', { speaker: cur.speaker });
    this.ctx.sfx('ui_close', 0.5);
    try {
      cur.onDone?.();
    } catch (err) {
      console.error('[ui] dialog onDone failed', err);
    }
    cur.resolve();
    const next = this.queue.shift();
    if (next) this.start(next);
  }

  update(dt: number, paused: boolean) {
    if (!this.cur || paused) return;
    if (this.chars < this.full.length) {
      const before = Math.floor(this.chars);
      this.chars = Math.min(this.full.length, this.chars + dt * CHARS_PER_SEC);
      const n = Math.floor(this.chars);
      if (n !== before) this.textEl.textContent = this.full.slice(0, n);
      if (n >= this.full.length) this.nextEl.classList.add('ready');
    } else if (!this.nextEl.classList.contains('ready')) this.nextEl.classList.add('ready');
    const dev = this.ctx.device;
    if (dev !== this.lastDevice) {
      this.lastDevice = dev;
      this.nextEl.innerHTML = `${glyph(dev === 'kbm' ? 'grab' : dev === 'pad' ? 'jump' : 'click', dev)}<span class="dlg-arrow">▼</span>`;
    }
  }
}

function portraitHtml(speaker: string, portrait?: string): string {
  const who = (portrait ?? speaker ?? '').toLowerCase();
  if (who === 'jimothy') return JIMOTHY_FACE;
  if (who === 'slopbot' || who === 'slopbot™') return SLOPBOT_ART;
  if (portrait) {
    if (portrait in ICONS) return `<span class="dlg-icon">${iconFromSpec(portrait)}</span>`;
    if (/[/.](png|svg|jpe?g|webp|gif)$/i.test(portrait) || portrait.startsWith('data:')) return iconFromSpec(portrait);
    return `<span class="dlg-emoji">${esc(portrait.slice(0, 4))}</span>`;
  }
  const initials = (speaker || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return `<span class="dlg-initials">${esc(initials)}</span>`;
}
