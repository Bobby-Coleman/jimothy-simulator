import { h } from './dom';
import { ICONS } from './icons';
import { fillTokens } from './glyphs';
import { renderObjectives } from './ObjectivesView';
import type { UiCtx } from './types';

/**
 * Quick-glance Instincts (objectives) panel toggled with Tab / View during gameplay.
 * The game keeps running underneath (Goat-Sim style); the mouse wheel scrolls the list while it's open.
 */
export class ObjectivesDrawer {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private foot: HTMLElement;
  open = false;
  private dirty = true;
  private since = 0;
  private lastDevice = '';

  constructor(
    private ctx: UiCtx,
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
        h('button', { class: 'drawer-x', 'aria-label': 'Close', html: ICONS.close, onclick: () => this.hide() }),
      ),
      this.body,
      this.foot,
    );
    parent.append(this.el);
    const mark = () => (this.dirty = true);
    ctx.game.events.on('objective', mark);
    ctx.game.events.on('objectiveProgress', mark);
    ctx.game.events.on('mutatorUnlocked', mark);
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

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.dirty = true;
    this.update(0);
    this.el.classList.add('open');
    this.ctx.sfx('ui_open', 0.6);
    this.ctx.game.events.emit('objectivesPanel', { open: true });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('open');
    this.ctx.sfx('ui_close', 0.5);
    this.ctx.game.events.emit('objectivesPanel', { open: false });
  }

  update(dt: number) {
    if (!this.open) return;
    this.since += dt;
    if (this.dirty && this.since > 0.2) {
      this.dirty = false;
      this.since = 0;
      const top = this.body.scrollTop;
      renderObjectives(this.ctx.game, this.body);
      this.body.scrollTop = top;
    }
    if (this.ctx.device !== this.lastDevice) {
      this.lastDevice = this.ctx.device;
      this.foot.innerHTML = fillTokens(this.ctx.device === 'touch' ? 'Swipe to scroll · tap × to close' : '{objectives} close  ·  Wheel scrolls', this.ctx.device);
    }
  }
}
