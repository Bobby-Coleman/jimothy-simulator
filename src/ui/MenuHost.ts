import { h } from './dom';
import { ICONS } from './icons';
import { ensureFocus } from './PadNav';

export interface PageDef {
  title: string;
  build(host: MenuHost): HTMLElement;
  /** Extra class on the panel (e.g. 'wide'). */
  cls?: string;
  /** Hide the back button (root pages that have their own buttons). */
  noBack?: boolean;
  /** Called every frame while the page is visible. */
  update?(dt: number): void;
}

/**
 * A modal panel that shows one page at a time with a back stack.
 * Used by the pause menu (root: 'pause') and by the title screen (settings / controls / credits).
 */
export class MenuHost {
  readonly el: HTMLElement;
  private panel: HTMLElement;
  private titleEl: HTMLElement;
  private backBtn: HTMLButtonElement;
  private body: HTMLElement;
  private stack: string[] = [];
  private current: PageDef | null = null;
  /** Called when the user backs out of the last page. */
  onExit: (() => void) | null = null;
  /** UI sound hook. */
  onSound: ((key: string) => void) | null = null;

  constructor(
    parent: HTMLElement,
    private pages: Record<string, PageDef>,
    cls = '',
  ) {
    this.titleEl = h('h2', { class: 'menu-title ol' });
    this.backBtn = h('button', { class: 'menu-back', 'aria-label': 'Back', html: `${ICONS.back}<span>Back</span>`, onclick: () => this.back() });
    this.body = h('div', { class: 'menu-body' });
    this.panel = h('div', { class: 'menu-panel', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'menu-head' }, this.backBtn, this.titleEl), this.body);
    this.el = h('div', { class: `menu-overlay ${cls}` }, this.panel);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.back();
    });
    parent.append(this.el);
  }

  get isOpen() {
    return this.stack.length > 0;
  }

  get page() {
    return this.stack[this.stack.length - 1] ?? null;
  }

  open(id: string) {
    this.stack = [id];
    this.render();
    this.el.classList.add('open');
  }

  push(id: string) {
    if (!this.isOpen) return this.open(id);
    this.stack.push(id);
    this.onSound?.('ui_click');
    this.render();
  }

  /** Replace the current page (no new history entry). */
  replace(id: string) {
    if (!this.isOpen) return this.open(id);
    this.stack[this.stack.length - 1] = id;
    this.render();
  }

  back() {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.onSound?.('ui_back');
      this.render();
      return;
    }
    if (this.onExit) this.onExit();
    else this.close();
  }

  close() {
    this.stack = [];
    this.current = null;
    this.el.classList.remove('open');
    const a = document.activeElement as HTMLElement | null;
    if (a && this.el.contains(a)) a.blur();
  }

  /** Rebuild the current page (e.g. after data changed). Keeps scroll position. */
  refresh() {
    if (!this.isOpen) return;
    const scroller = this.body.querySelector<HTMLElement>('.scroll');
    const top = scroller?.scrollTop ?? 0;
    this.render(false);
    const s2 = this.body.querySelector<HTMLElement>('.scroll');
    if (s2) s2.scrollTop = top;
  }

  private render(focus = true) {
    const id = this.page;
    const def = id ? this.pages[id] : null;
    this.current = def;
    this.body.textContent = '';
    if (!def) return;
    this.titleEl.textContent = def.title;
    this.panel.className = `menu-panel page-${id}${def.cls ? ' ' + def.cls : ''}`;
    this.backBtn.style.display = def.noBack && this.stack.length === 1 ? 'none' : '';
    this.body.append(def.build(this));
    if (focus) {
      const a = document.activeElement as HTMLElement | null;
      if (a && !this.el.contains(a)) a.blur();
      requestAnimationFrame(() => ensureFocus(this.body, this.body.querySelector<HTMLElement>('[data-autofocus]')));
    }
  }

  /** The element that pad/keyboard navigation should move within. */
  get navRoot(): HTMLElement {
    return this.panel;
  }

  update(dt: number) {
    this.current?.update?.(dt);
  }

  /** Scroll the page's scroll area (gamepad right stick / d-pad on list pages). */
  scrollBy(dy: number) {
    this.body.querySelector<HTMLElement>('.scroll')?.scrollBy({ top: dy });
  }
}
