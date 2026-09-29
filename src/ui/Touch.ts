import type { Action } from '../core/Input';
import { h } from './dom';
import { ICONS } from './icons';
import type { UiCtx } from './types';

export interface TouchApi extends UiCtx {
  openPause(): void;
  toggleObjectives(): void;
}

const BUTTONS: { a: Action; label: string; cls: string }[] = [
  { a: 'jump', label: 'Jump', cls: 'tb-jump' },
  { a: 'grab', label: 'Grab', cls: 'tb-grab' },
  { a: 'bonk', label: 'Bonk', cls: 'tb-bonk' },
  { a: 'wash', label: 'Wash', cls: 'tb-wash' },
  { a: 'roll', label: 'Roll', cls: 'tb-roll' },
  { a: 'flop', label: 'Flop', cls: 'tb-flop' },
  { a: 'chitter', label: 'Chitter', cls: 'tb-chitter' },
];

/**
 * On-screen controls for phones/tablets: left-side floating joystick (push to the edge = sprint),
 * right-side drag to look, round action buttons, pause + Instincts buttons.
 * Writes to game.input.virtual (move / look / buttons).
 */
export class TouchControls {
  readonly el: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private stickId = -1;
  private ox = 0;
  private oy = 0;
  private lookId = -1;
  private lx = 0;
  private ly = 0;
  private held = new Map<number, { a: Action; el: HTMLElement; frame: number }>();
  private shown = false;

  constructor(
    private api: TouchApi,
    parent: HTMLElement,
  ) {
    this.base = h('div', { class: 'stick-base' });
    this.knob = h('div', { class: 'stick-knob' });
    this.base.append(this.knob);
    const move = h('div', { class: 'touch-move' });
    const look = h('div', { class: 'touch-look' });
    const btns = h('div', { class: 'touch-btns' });
    for (const b of BUTTONS) {
      const el = h('button', { class: `tbtn ${b.cls}`, 'aria-label': b.label }, h('span', { text: b.label }));
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        this.held.set(e.pointerId, { a: b.a, el, frame: this.api.game.frame });
        this.api.game.input.virtual.buttons.add(b.a);
        el.classList.add('down');
      });
      const up = (e: PointerEvent) => this.release(e.pointerId);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      btns.append(el);
    }
    const top = h(
      'div',
      { class: 'touch-top' },
      h('button', { class: 'tbtn-top', 'aria-label': 'Instincts', html: ICONS.list, onclick: () => this.api.toggleObjectives() }),
      // Photo mode (V on keyboard): gameplay/PhotoMode reads the 'camera' action.
      h('button', { class: 'tbtn-top', 'aria-label': 'Photo mode', html: ICONS.camera, onclick: () => this.api.game.input.tap('camera', 150) }),
      h('button', { class: 'tbtn-top', 'aria-label': 'Pause', html: ICONS.pause, onclick: () => this.api.openPause() }),
    );
    // The minimap (gameplay/MapSystem: a body-level canvas below the UI layer) sits inside the joystick zone in
    // landscape, so taps never reached it: a transparent button over it opens the big map.
    const mapBtn = h('button', {
      class: 'touch-map',
      'aria-label': 'Map',
      onclick: () => {
        const map = this.api.game.get<any>('map');
        if (map && this.api.game.state === 'playing') map.toggleBig();
      },
    });
    this.el = h('div', { class: 'touch' }, move, look, this.base, btns, top, mapBtn);
    parent.append(this.el);

    // Joystick (floating: appears where the thumb lands)
    move.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      e.preventDefault();
      move.setPointerCapture?.(e.pointerId);
      this.stickId = e.pointerId;
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.base.style.transform = `translate3d(${this.ox}px, ${this.oy}px, 0)`;
      this.knob.style.transform = 'translate3d(0,0,0)';
      this.base.classList.add('on');
    });
    move.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const max = this.radius();
      let dx = e.clientX - this.ox;
      let dy = e.clientY - this.oy;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx *= max / len;
        dy *= max / len;
      }
      this.knob.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
      const v = this.api.game.input.virtual;
      v.move.set(dx / max, -dy / max);
      if (len / max > 0.93) v.buttons.add('sprint');
      else v.buttons.delete('sprint');
      this.base.classList.toggle('sprint', len / max > 0.93);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      const v = this.api.game.input.virtual;
      v.move.set(0, 0);
      v.buttons.delete('sprint');
      this.base.classList.remove('on', 'sprint');
    };
    move.addEventListener('pointerup', endStick);
    move.addEventListener('pointercancel', endStick);

    // Look (drag anywhere on the right)
    look.addEventListener('pointerdown', (e) => {
      if (this.lookId >= 0) return;
      e.preventDefault();
      look.setPointerCapture?.(e.pointerId);
      this.lookId = e.pointerId;
      this.lx = e.clientX;
      this.ly = e.clientY;
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const s = 0.0062 * this.api.settings.sensitivity;
      const v = this.api.game.input.virtual;
      v.look.x += (e.clientX - this.lx) * s;
      v.look.y += (e.clientY - this.ly) * s * (this.api.settings.invertY ? -1 : 1);
      this.lx = e.clientX;
      this.ly = e.clientY;
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = -1;
    };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);
  }

  private radius() {
    return Math.max(40, Math.min(70, Math.min(window.innerWidth, window.innerHeight) * 0.11));
  }

  private release(id: number) {
    const hb = this.held.get(id);
    if (!hb) return;
    this.held.delete(id);
    hb.el.classList.remove('down');
    const drop = () => {
      for (const o of this.held.values()) if (o.a === hb.a) return;
      this.api.game.input.virtual.buttons.delete(hb.a);
    };
    // A quick tap can start and end between two frames: keep it pressed for one frame so the game sees it.
    if (this.api.game.frame === hb.frame) requestAnimationFrame(drop);
    else drop();
  }

  /** Show/hide; hiding releases everything so nothing gets stuck. */
  setVisible(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.el.classList.toggle('on', on);
    if (!on) {
      const v = this.api.game.input.virtual;
      for (const [, hb] of this.held) {
        v.buttons.delete(hb.a);
        hb.el.classList.remove('down');
      }
      this.held.clear();
      if (this.stickId >= 0) {
        v.move.set(0, 0);
        v.buttons.delete('sprint');
      }
      this.stickId = -1;
      this.lookId = -1;
      this.base.classList.remove('on', 'sprint');
    }
  }
}
