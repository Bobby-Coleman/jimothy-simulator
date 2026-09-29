/**
 * DOM layer for the finale: fade-to-black, caption, letterbox bars, fireworks sky-light pulses, the credits roll,
 * the end card and a hold-to-skip pill. Lives in #ui next to the game UI at z-index 40 (above the HUD, below the
 * dialogue box (44), the Instincts drawer and the pause menu), with its own injected styles (`jx-` prefix).
 */

const CSS = `
.jx-finale { position: absolute; inset: 0; pointer-events: none; z-index: 40; overflow: hidden; color: #fff;
  font-family: 'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif; }
.jx-finale[hidden] { display: none; }
.jx-fade { position: absolute; inset: 0; background: #04060b; opacity: 0; }
.jx-tint { position: absolute; inset: 0; opacity: 0; mix-blend-mode: screen;
  background: radial-gradient(ellipse 90% 70% at 50% 8%, var(--tc, #ff8a1e) 0%, rgba(0,0,0,0) 72%); }
.jx-bar { position: absolute; left: 0; right: 0; height: 10.5vh; background: #000; transition: transform 1.1s cubic-bezier(.3,.8,.3,1); }
.jx-bar.top { top: 0; transform: translateY(-101%); }
.jx-bar.bot { bottom: 0; transform: translateY(101%); }
.jx-finale.bars .jx-bar { transform: none; }
.jx-caption { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); text-align: center; opacity: 0;
  transition: opacity 1s ease; font-family: 'Lilita One', 'Arial Black', sans-serif; letter-spacing: .06em;
  font-size: clamp(22px, 4.2vmin, 46px); text-shadow: 0 2px 14px rgba(0,0,0,.9); }
.jx-caption small { display: block; margin-top: .5em; font-family: 'Nunito', sans-serif; font-weight: 700; letter-spacing: .02em;
  font-size: .5em; opacity: .75; }
.jx-caption.on { opacity: 1; }
.jx-credits { position: absolute; top: 0; bottom: 0; left: 0; width: min(600px, 94vw); overflow: hidden; opacity: 0;
  transition: opacity 1.4s ease;
  background: linear-gradient(90deg, rgba(4,7,14,.86) 0%, rgba(4,7,14,.66) 62%, rgba(4,7,14,0) 100%);
  -webkit-mask-image: linear-gradient(transparent 0, #000 16%, #000 84%, transparent 100%);
  mask-image: linear-gradient(transparent 0, #000 16%, #000 84%, transparent 100%); }
.jx-credits.on { opacity: 1; }
.jx-roll { position: absolute; left: 0; right: 0; top: 0; padding: 0 8% 0 7%; text-align: center; will-change: transform; }
.jx-roll h1 { margin: 0; font-family: 'Luckiest Guy', 'Lilita One', 'Arial Black', sans-serif; font-weight: 400;
  font-size: clamp(38px, 7vmin, 76px); line-height: 1; color: #ffd23f; letter-spacing: .02em;
  text-shadow: 0 .06em 0 #1d1a26, 0 .12em .3em rgba(0,0,0,.6); }
.jx-roll .lede { margin: .9em auto 0; max-width: 26em; font-size: clamp(15px, 2.3vmin, 22px); font-weight: 800; line-height: 1.35; }
.jx-roll h2 { margin: 2.4em 0 .55em; font-family: 'Lilita One', 'Arial Black', sans-serif; font-weight: 400;
  font-size: clamp(14px, 2.1vmin, 21px); letter-spacing: .16em; color: #19c2b8; }
.jx-roll p { margin: .28em 0; font-size: clamp(13px, 2vmin, 19px); line-height: 1.38; font-weight: 700; }
.jx-roll p .who { color: #fff4dc; }
.jx-roll p .as { opacity: .72; font-weight: 600; }
.jx-roll p.small { font-size: clamp(11px, 1.6vmin, 15px); opacity: .78; font-weight: 600; }
.jx-roll .joke { font-style: italic; opacity: .86; }
.jx-roll .note { margin: 2.6em auto 0; max-width: 24em; padding: .9em 1.1em; border-radius: 16px;
  border: 2px solid rgba(255,210,63,.65); background: rgba(255,210,63,.08); }
.jx-roll .note b { display: block; font-family: 'Lilita One', sans-serif; font-weight: 400; letter-spacing: .08em; color: #ffd23f; margin-bottom: .3em; }
.jx-roll .fin { margin-top: 3em; opacity: .7; }
.jx-end { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; opacity: 0; transition: opacity 1.1s ease; padding: 0 5vw;
  background: radial-gradient(ellipse at center, rgba(4,6,11,.62) 0%, rgba(4,6,11,.25) 60%, rgba(4,6,11,0) 100%); }
.jx-end.on { opacity: 1; }
.jx-end .big { font-family: 'Luckiest Guy', 'Lilita One', 'Arial Black', Impact, sans-serif; font-weight: 400; line-height: 1.02;
  font-size: clamp(34px, 8.4vmin, 104px); color: #ffd23f; letter-spacing: .01em; transform: scale(.86);
  transition: transform 1.4s cubic-bezier(.2,1.5,.35,1);
  text-shadow: 0 .05em 0 #1d1a26, .04em .04em 0 #1d1a26, -.04em .04em 0 #1d1a26, 0 .1em .45em rgba(0,0,0,.55); }
.jx-end.on .big { transform: scale(1); }
.jx-end .sub { margin-top: .7em; font-family: 'Lilita One', 'Arial Black', sans-serif; letter-spacing: .12em;
  font-size: clamp(15px, 3vmin, 32px); text-shadow: 0 2px 10px rgba(0,0,0,.8); }
.jx-skip { position: absolute; right: 18px; bottom: calc(10.5vh + 14px); display: flex; align-items: center; gap: .55em;
  padding: .45em .95em .45em .55em; border-radius: 999px; background: rgba(0,0,0,.5); border: 1px solid rgba(255,255,255,.18);
  font-family: 'Lilita One', 'Arial Black', sans-serif; font-size: 14px; letter-spacing: .04em; opacity: 0;
  transition: opacity .6s ease; pointer-events: auto; cursor: pointer; user-select: none; touch-action: none; }
.jx-skip.on { opacity: .9; }
.jx-skip svg { width: 22px; height: 22px; transform: rotate(-90deg); }
.jx-skip circle { fill: none; stroke-width: 3.2; }
.jx-skip .bg { stroke: rgba(255,255,255,.25); }
.jx-skip .fg { stroke: #ffd23f; stroke-dasharray: 100; stroke-dashoffset: 100; stroke-linecap: round; }
`;

let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.dataset.jx = 'finale';
  s.textContent = CSS;
  document.head.append(s);
}

function el(cls: string, parent?: HTMLElement, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  parent?.append(d);
  return d;
}

export class FinaleOverlay {
  readonly root: HTMLDivElement;
  private fade: HTMLDivElement;
  private tint: HTMLDivElement;
  private caption: HTMLDivElement;
  private credits: HTMLDivElement;
  private roll: HTMLDivElement;
  private end: HTMLDivElement;
  private skipEl: HTMLDivElement;
  private ring: SVGCircleElement;
  private tintA = 0;
  /** Pointer is holding the skip pill (touch / mouse). */
  pointerHold = false;

  constructor() {
    injectStyle();
    this.root = el('jx-finale');
    this.root.hidden = true;
    this.fade = el('jx-fade', this.root);
    this.tint = el('jx-tint', this.root);
    el('jx-bar top', this.root);
    el('jx-bar bot', this.root);
    this.caption = el('jx-caption', this.root);
    this.credits = el('jx-credits', this.root);
    this.roll = el('jx-roll', this.credits);
    this.end = el('jx-end', this.root);
    this.skipEl = el(
      'jx-skip',
      this.root,
      `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" class="bg" pathLength="100"/><circle cx="12" cy="12" r="9" class="fg" pathLength="100"/></svg><span>Hold <b>Space</b> / tap-hold to skip</span>`,
    );
    this.ring = this.skipEl.querySelector('.fg') as SVGCircleElement;
    const down = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.pointerHold = true;
    };
    const up = () => (this.pointerHold = false);
    this.skipEl.addEventListener('pointerdown', down);
    this.skipEl.addEventListener('pointerup', up);
    this.skipEl.addEventListener('pointerleave', up);
    this.skipEl.addEventListener('pointercancel', up);
    (document.getElementById('ui') ?? document.body).append(this.root);
  }

  show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
    this.pointerHold = false;
  }

  setFade(a: number) {
    this.fade.style.opacity = String(Math.max(0, Math.min(1, a)));
  }

  setBars(on: boolean) {
    this.root.classList.toggle('bars', on);
  }

  setCaption(text: string | null, sub = '') {
    if (text) {
      this.caption.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
      this.caption.classList.add('on');
    } else this.caption.classList.remove('on');
  }

  /** Fireworks light washing over the scene. rgb 0..~3 (HDR), strength 0..1. */
  pulse(rgb: [number, number, number], strength: number) {
    const m = Math.max(rgb[0], rgb[1], rgb[2], 1);
    const c = rgb.map((v) => Math.round(Math.min(255, (v / m) * 255)));
    this.tint.style.setProperty('--tc', `rgb(${c[0]},${c[1]},${c[2]})`);
    this.tintA = Math.min(0.5, Math.max(this.tintA, strength));
  }

  setCredits(html: string) {
    this.roll.innerHTML = html;
  }

  showCredits(on: boolean) {
    this.credits.classList.toggle('on', on);
  }

  /** Scroll position 0..1 (0 = first line just below the bottom, 1 = last line gone past the top). Returns the roll height. */
  scrollCredits(u: number) {
    const h = this.credits.clientHeight || window.innerHeight;
    const rh = this.roll.scrollHeight || 2000;
    const y = h - u * (rh + h);
    this.roll.style.transform = `translateY(${y.toFixed(1)}px)`;
    return rh;
  }

  showEnd(big: string | null, sub = '') {
    if (big) {
      this.end.innerHTML = `<div class="big">${esc(big)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`;
      // restart the pop-in
      this.end.classList.remove('on');
      void this.end.offsetWidth;
      this.end.classList.add('on');
    } else this.end.classList.remove('on');
  }

  setSkip(visible: boolean, progress = 0, label?: string) {
    this.skipEl.classList.toggle('on', visible);
    this.ring.style.strokeDashoffset = String(100 - Math.max(0, Math.min(1, progress)) * 100);
    if (label) {
      const span = this.skipEl.querySelector('span');
      if (span && span.innerHTML !== label) span.innerHTML = label;
    }
  }

  update(dt: number) {
    if (this.tintA > 0.001) {
      this.tintA *= Math.exp(-dt * 3.2);
      this.tint.style.opacity = this.tintA.toFixed(3);
    } else if (this.tint.style.opacity !== '0') this.tint.style.opacity = '0';
  }

  dispose() {
    this.root.remove();
  }
}

export function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}
