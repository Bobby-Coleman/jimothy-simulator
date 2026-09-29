import * as THREE from 'three';
import type { Game } from '../../../../core/Game';

/**
 * DOM overlay owned by the landmark events:
 *  - speech bubbles anchored to 3D points (used for stand-in figures and crowd chants)
 *  - the Salmon Run standings panel
 *  - fallbacks for dialog / banner / toast when the real UI system isn't registered
 * Everything is time-driven from game hooks (not setTimeout) so headless `g.advance()` tests behave.
 */

const CSS = `
.lm-root{position:absolute;inset:0;pointer-events:none;font-family:"Arial Rounded MT Bold","Segoe UI",system-ui,sans-serif;z-index:5}
.lm-bubble{position:absolute;left:0;top:0;transform:translate(-50%,-100%);background:#fffdf6;color:#2a2320;border-radius:14px;
  padding:6px 11px;font-weight:800;font-size:15px;line-height:1.15;max-width:240px;text-align:center;box-shadow:0 3px 0 rgba(0,0,0,.25);
  white-space:pre-wrap;transition:opacity .15s;will-change:transform;transform-origin:50% 100%}
.lm-bubble:after{content:"";position:absolute;left:50%;bottom:-8px;margin-left:-8px;border:8px solid transparent;border-bottom:0;border-top-color:#fffdf6}
.lm-bubble.big{font-size:22px;background:#ffd84a;color:#3a2200;letter-spacing:.5px}
.lm-bubble.big:after{border-top-color:#ffd84a}
.lm-dialog{position:absolute;left:50%;bottom:13%;transform:translateX(-50%);width:min(680px,88vw);background:rgba(20,24,34,.88);color:#fff;
  border-radius:16px;padding:12px 18px 14px;box-shadow:0 6px 0 rgba(0,0,0,.3);border:3px solid #ffd84a;opacity:0;transition:opacity .2s}
.lm-dialog .sp{font-weight:900;color:#ffd84a;font-size:15px;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px}
.lm-dialog .tx{font-size:19px;font-weight:700;line-height:1.3}
.lm-dialog .sk{position:absolute;right:14px;bottom:6px;font-size:11px;opacity:.6}
.lm-banner{position:absolute;left:50%;top:24%;transform:translate(-50%,-50%) scale(.6);text-align:center;opacity:0;transition:opacity .25s,transform .35s cubic-bezier(.2,1.6,.4,1)}
.lm-banner.on{opacity:1;transform:translate(-50%,-50%) scale(1)}
.lm-banner .t{font:900 54px "Arial Black",Impact,system-ui,sans-serif;color:#ffd84a;-webkit-text-stroke:3px #3a2200;text-shadow:0 5px 0 #3a2200,0 0 24px rgba(255,200,60,.6);white-space:nowrap}
.lm-banner .s{font-weight:800;font-size:20px;color:#fff;text-shadow:0 2px 0 #000,0 0 8px #000;margin-top:4px}
.lm-toasts{position:absolute;right:16px;top:70px;display:flex;flex-direction:column;gap:8px;align-items:flex-end}
.lm-toast{background:rgba(20,24,34,.9);border:3px solid #ffd84a;border-radius:14px;color:#fff;padding:8px 14px;min-width:220px;max-width:340px;
  transition:opacity .4s,transform .4s;box-shadow:0 4px 0 rgba(0,0,0,.3)}
.lm-toast .t{font-weight:900;color:#ffd84a}
.lm-toast .x{font-size:14px;opacity:.9}
.lm-race{position:absolute;left:16px;top:150px;background:rgba(20,24,34,.86);border:3px solid #ff8a65;border-radius:14px;
  color:#fff;padding:6px 14px 8px;min-width:250px;display:none;box-shadow:0 4px 0 rgba(0,0,0,.3)}
.lm-race .h{font:900 16px "Arial Black",Impact,system-ui,sans-serif;color:#ff8a65;letter-spacing:1px;display:flex;justify-content:space-between;gap:12px}
.lm-race .r{display:flex;justify-content:space-between;font-weight:800;font-size:15px;gap:14px;padding:1px 0}
.lm-race .r.me{color:#ffd84a}
.lm-race .bar{height:5px;background:rgba(255,255,255,.15);border-radius:3px;margin-top:5px;overflow:hidden}
.lm-race .bar i{display:block;height:100%;background:#ffd84a;width:0}
.lm-gold{position:absolute;inset:0;opacity:0;mix-blend-mode:soft-light;background:linear-gradient(180deg,rgba(255,176,40,.95) 0%,rgba(255,196,90,.7) 45%,rgba(255,214,140,.35) 100%)}
.lm-gold2{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse 90% 60% at 50% 0%,rgba(255,200,80,.35),rgba(255,190,90,0) 70%)}
@media (max-width:640px){.lm-banner .t{font-size:34px}.lm-bubble{font-size:13px}}
`;

interface Bubble {
  el: HTMLDivElement;
  anchor: () => THREE.Vector3 | null | undefined;
  life: number;
  maxDist: number;
}

const _v = new THREE.Vector3();

export class Overlay {
  readonly root: HTMLDivElement;
  private bubbles: Bubble[] = [];
  private dialogEl: HTMLDivElement;
  private dialogState: { speaker: string; lines: string[]; i: number; t: number; onDone?: () => void } | null = null;
  private bannerEl: HTMLDivElement;
  private bannerT = 0;
  private toasts: HTMLDivElement;
  private toastList: { el: HTMLDivElement; t: number }[] = [];
  private raceEl: HTMLDivElement;
  private goldEl: HTMLDivElement;
  private gold2El: HTMLDivElement;

  constructor(private game: Game) {
    if (!document.getElementById('lm-style')) {
      const st = document.createElement('style');
      st.id = 'lm-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const host = document.getElementById('ui') ?? document.body;
    this.root = document.createElement('div');
    this.root.className = 'lm-root';
    host.appendChild(this.root);
    this.goldEl = this.div('lm-gold');
    this.gold2El = this.div('lm-gold2');
    this.dialogEl = this.div('lm-dialog');
    this.bannerEl = this.div('lm-banner');
    this.toasts = this.div('lm-toasts');
    this.raceEl = this.div('lm-race');
  }

  private div(cls: string, parent: HTMLElement = this.root) {
    const d = document.createElement('div');
    d.className = cls;
    parent.appendChild(d);
    return d;
  }

  // ------------------------------------------------------------------ speech bubbles
  bubble(anchor: () => THREE.Vector3 | null | undefined, text: string, secs = 2.6, opts: { big?: boolean; maxDist?: number } = {}) {
    const el = this.div('lm-bubble' + (opts.big ? ' big' : ''));
    el.textContent = text;
    el.style.opacity = '0';
    const b: Bubble = { el, anchor, life: secs, maxDist: opts.maxDist ?? 55 };
    this.bubbles.push(b);
    if (this.bubbles.length > 14) this.removeBubble(this.bubbles[0]);
    return b;
  }

  /** Remove bubbles attached to an anchor fn owner (pass the same anchor function). */
  clearBubbles(anchor?: () => THREE.Vector3 | null | undefined) {
    for (const b of [...this.bubbles]) if (!anchor || b.anchor === anchor) this.removeBubble(b);
  }

  private removeBubble(b: Bubble) {
    b.el.remove();
    const i = this.bubbles.indexOf(b);
    if (i >= 0) this.bubbles.splice(i, 1);
  }

  // ------------------------------------------------------------------ fallback dialog
  dialog(speaker: string, lines: string[], onDone?: () => void) {
    if (this.dialogState) this.dialogState.onDone?.();
    this.dialogState = { speaker, lines, i: 0, t: 0, onDone };
    this.renderDialog();
    this.dialogEl.style.opacity = '1';
  }

  get dialogOpen() {
    return !!this.dialogState;
  }

  closeDialog() {
    const d = this.dialogState;
    this.dialogState = null;
    this.dialogEl.style.opacity = '0';
    d?.onDone?.();
  }

  private renderDialog() {
    const d = this.dialogState;
    if (!d) return;
    this.dialogEl.innerHTML = '';
    const sp = this.div('sp', this.dialogEl);
    sp.textContent = d.speaker;
    const tx = this.div('tx', this.dialogEl);
    tx.textContent = d.lines[d.i] ?? '';
    const sk = this.div('sk', this.dialogEl);
    sk.textContent = `${d.i + 1}/${d.lines.length}  ·  Space: next`;
  }

  // ------------------------------------------------------------------ fallback banner / toast
  banner(title: string, sub?: string, secs = 3) {
    this.bannerEl.innerHTML = '';
    const t = this.div('t', this.bannerEl);
    t.textContent = title;
    if (sub) this.div('s', this.bannerEl).textContent = sub;
    this.bannerEl.classList.remove('on');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('on');
    this.bannerT = secs;
  }

  toast(title: string, text?: string) {
    const el = this.div('lm-toast', this.toasts);
    this.div('t', el).textContent = title;
    if (text) this.div('x', el).textContent = text;
    this.toastList.push({ el, t: 4.5 });
    while (this.toastList.length > 4) this.toastList.shift()!.el.remove();
  }

  // ------------------------------------------------------------------ race panel
  race(data: { title: string; time: number; rows: { name: string; me?: boolean; note?: string }[]; progress: number } | null) {
    if (!data) {
      this.raceEl.style.display = 'none';
      return;
    }
    this.raceEl.style.display = 'block';
    const ord = ['1st', '2nd', '3rd', '4th', '5th'];
    const rows = data.rows
      .map((r, i) => `<div class="r${r.me ? ' me' : ''}"><span>${ord[i] ?? i + 1 + 'th'}  ${esc(r.name)}</span><span>${esc(r.note ?? '')}</span></div>`)
      .join('');
    this.raceEl.innerHTML = `<div class="h"><span>${esc(data.title)}</span><span>${data.time.toFixed(1)}s</span></div>${rows}<div class="bar"><i style="width:${Math.round(
      THREE.MathUtils.clamp(data.progress, 0, 1) * 100,
    )}%"></i></div>`;
  }

  /** Warm golden-hour wash over the screen (0..1), strongest at the top where the sky is. */
  setGold(w: number) {
    const o = w > 0.001 ? w.toFixed(3) : '0';
    this.goldEl.style.opacity = o;
    this.gold2El.style.opacity = o;
  }

  // ------------------------------------------------------------------ ticking
  /** Game-time tick (dialog auto-advance). */
  update(dt: number) {
    const d = this.dialogState;
    if (d) {
      d.t += dt;
      const line = d.lines[d.i] ?? '';
      const dur = 1.3 + line.length * 0.038;
      if (d.t > dur || (d.t > 0.25 && this.game.input.pressed('jump'))) {
        d.i++;
        d.t = 0;
        if (d.i >= d.lines.length) this.closeDialog();
        else this.renderDialog();
      }
    }
  }

  /** Real-time tick (bubble projection, banner/toast lifetimes). */
  lateUpdate(dt: number) {
    const cam = this.game.camera;
    const canvas = this.game.renderer?.domElement;
    const W = canvas?.clientWidth || window.innerWidth;
    const H = canvas?.clientHeight || window.innerHeight;
    for (const b of [...this.bubbles]) {
      b.life -= dt;
      const a = b.anchor();
      if (b.life <= 0 || !a) {
        this.removeBubble(b);
        continue;
      }
      const dist = cam.position.distanceTo(a);
      _v.copy(a).project(cam);
      const visible = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2 && dist < b.maxDist;
      if (!visible) {
        b.el.style.opacity = '0';
        continue;
      }
      const x = (_v.x * 0.5 + 0.5) * W;
      const y = (-_v.y * 0.5 + 0.5) * H;
      const s = THREE.MathUtils.clamp(14 / Math.max(dist, 1), 0.55, 1.15);
      b.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
      b.el.style.opacity = b.life < 0.3 ? String(b.life / 0.3) : '1';
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.bannerEl.classList.remove('on');
    }
    for (const t of [...this.toastList]) {
      t.t -= dt;
      if (t.t < 0.5) t.el.style.opacity = String(Math.max(0, t.t / 0.5));
      if (t.t <= 0) {
        t.el.remove();
        this.toastList.splice(this.toastList.indexOf(t), 1);
      }
    }
  }
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
