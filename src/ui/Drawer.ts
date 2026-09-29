import { h } from './dom';
import { ICONS } from './icons';
import { fillTokens } from './glyphs';
import { renderObjectives } from './ObjectivesView';
import type { UiCtx } from './types';

export interface DrawerApi extends UiCtx {
  /** Free the mouse for a UI panel without opening the pause menu. Returns true if it was locked. */
  releasePointer(): boolean;
  /** Re-capture the mouse after the panel closes (needs a user gesture; harmless if refused). */
  relock(): void;
}

/**
 * Quick-glance Instincts (objectives) panel toggled with Tab / View during gameplay.
 * The game keeps running underneath (Goat-Sim style); the mouse wheel scrolls the list while it's open.
 * With mouse & keyboard the cursor is freed while it's open so the "Suggested next" Track buttons can be clicked.
 */
export class ObjectivesDrawer {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private foot: HTMLElement;
  open = false;
  private dirty = true;
  private since = 0;
  private lastDevice = '';
  private freedMouse = false;

  constructor(
    private ctx: DrawerApi,
    parent: HTMLElement,
  ) {
    this.body = h('div', { class: 'drawer-body scroll' });
    this.foot = h('div', { class: 'drawer-foot' });
    this.el = h(
      'aside',
      { class: 'drawer', 'aria-label': 'Instincts' },
      h(
        'div',
        { class: 'drawer-head' },
        h('span', { class: 'drawer-title ol', text: 'Instincts' }),
        h('button', { class: 'drawer-x', 'aria-label': 'Close', html: ICONS.close, onclick: () => this.hide(true) }),
      ),
      this.body,
      this.foot,
    );
    parent.append(this.el);
    const mark = () => (this.dirty = true);
    ctx.game.events.on('objective', mark);
    ctx.game.events.on('objectiveProgress', mark);
    ctx.game.events.on('mutatorUnlocked', mark);
    ctx.game.events.on('guideTrack', mark);
    // Scroll the list with the wheel while open (instead of zooming the camera).
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.open) return;
        this.body.scrollBy({ top: e.deltaY });
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true, passive: false },
    );
  }

  /** Player toggle (Tab / View / touch button). */
  toggle() {
    if (this.open) this.hide(true);
    else this.show();
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.dirty = true;
    this.update(0);
    this.el.classList.add('open');
    this.ctx.sfx('ui_open', 0.6);
    this.freedMouse = this.ctx.device === 'kbm' && this.ctx.releasePointer();
    this.ctx.game.events.emit('objectivesPanel', { open: true });
  }

  /** `byPlayer`: closed by the player (Tab / ×) — re-capture the mouse if opening freed it. */
  hide(byPlayer = false) {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('open');
    this.ctx.sfx('ui_close', 0.5);
    if (this.freedMouse && byPlayer) this.ctx.relock();
    this.freedMouse = false;
    this.ctx.game.events.emit('objectivesPanel', { open: false });
  }

  update(dt: number) {
    if (!this.open) return;
    this.since += dt;
    if (this.dirty && this.since > 0.2) {
      this.dirty = false;
      this.since = 0;
      const top = this.body.scrollTop;
      renderObjectives(this.ctx.game, this.body, { onChange: () => (this.dirty = true) });
      this.body.scrollTop = top;
    }
    if (this.ctx.device !== this.lastDevice) {
      this.lastDevice = this.ctx.device;
      this.foot.innerHTML = fillTokens(this.ctx.device === 'touch' ? 'Swipe to scroll · tap × to close' : '{objectives} close  ·  Wheel scrolls  ·  ★ Track pins a goal', this.ctx.device);
    }
  }
}
