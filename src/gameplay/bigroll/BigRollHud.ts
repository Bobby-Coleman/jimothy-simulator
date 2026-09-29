import type { Game } from '../../core/Game';
import { fillTokens } from '../../ui/glyphs';
import { GATES, TIERS, fmtTime, type Tier } from './course';

/**
 * Race HUD for THE BIG ROLL: timer, checkpoint counter, compass arrow + distance to the next gate, the medal you are
 * still on pace for, and a warning row (untucked / missed checkpoint / off course). Lives inside the UI root so it
 * inherits the game's fonts and colours; hidden with the rest of the HUD (photo mode, menus, Settings › Show HUD).
 * While it is up, the goal pill + world waypoint star step aside (body class `bigroll-racing`).
 */
const CSS = `
.br-hud{position:absolute;left:50%;top:calc(0.7em + env(safe-area-inset-top));transform:translateX(-50%);display:none;
  min-width:17em;max-width:92vw;padding:.35em .9em .5em;border-radius:1.1em;border:.16em solid var(--ink,#1d1a26);
  background:var(--ink-soft,rgba(29,26,38,.8));color:#fff;text-align:center;pointer-events:none;z-index:6;
  box-shadow:0 .25em 0 rgba(0,0,0,.3);font-family:var(--f-body,system-ui)}
.br-hud.on{display:block}
.br-top{display:flex;align-items:center;justify-content:space-between;gap:.8em}
.br-title{font-family:var(--f-bold,'Arial Black',sans-serif);color:var(--gold,#ffd23f);letter-spacing:.04em;font-size:.95em}
.br-time{font-family:var(--f-display,'Arial Black',sans-serif);font-size:1.9em;line-height:1;text-shadow:var(--ol);font-variant-numeric:tabular-nums}
.br-mid{display:flex;align-items:center;justify-content:center;gap:.55em;margin-top:.15em;font-weight:800}
.br-cp{font-family:var(--f-bold,sans-serif);font-size:1.05em}
.br-name{opacity:.9}
.br-arrow{width:1.7em;height:1.7em;display:grid;place-items:center;border-radius:50%;background:var(--gold,#ffd23f);border:.12em solid var(--ink,#1d1a26)}
.br-arrow svg{width:70%;height:70%;fill:var(--ink,#1d1a26);transition:transform .08s linear}
.br-dist{font-variant-numeric:tabular-nums;min-width:3.2em;text-align:left}
.br-pace{margin-top:.2em;font-size:.85em;font-weight:800;opacity:.95}
.br-pace b{font-family:var(--f-bold,sans-serif)}
.br-warn{margin-top:.3em;font-weight:900;font-size:.95em;color:#1d1a26;background:var(--gold,#ffd23f);border-radius:.6em;padding:.12em .6em;display:none}
.br-warn.on{display:block;animation:br-blink .8s ease-in-out infinite alternate}
.br-warn.red{background:var(--red,#ff4b4b);color:#fff}
@keyframes br-blink{from{opacity:1}to{opacity:.72}}
body.bigroll-racing .guide-pill,body.bigroll-racing .waypoint{visibility:hidden!important;opacity:0!important}
.hud-off .br-hud{display:none!important}
`;

export interface HudState {
  time: number;
  next: number;
  /** Radians, 0 = straight ahead on screen, + = to the right. */
  bearing: number;
  dist: number;
  pace: Tier;
  assisted: boolean;
  warn: string | null;
  warnRed?: boolean;
}

export class BigRollHud {
  private el: HTMLDivElement;
  private tTime!: HTMLElement;
  private tCp!: HTMLElement;
  private tName!: HTMLElement;
  private tArrow!: SVGElement;
  private tDist!: HTMLElement;
  private tPace!: HTMLElement;
  private tWarn!: HTMLElement;
  private shown = false;
  private lastWarn = '';
  private lastPace = '';
  private lastCp = -1;

  constructor(private game: Game) {
    if (!document.getElementById('bigroll-style')) {
      const st = document.createElement('style');
      st.id = 'bigroll-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const ui = game.get<any>('ui');
    const host: HTMLElement = ui?.root ?? document.getElementById('ui') ?? document.body;
    this.el = document.createElement('div');
    this.el.className = 'br-hud';
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<div class="br-top"><span class="br-title">THE BIG ROLL</span><span class="br-time">0:00.0</span></div>
      <div class="br-mid"><span class="br-cp"></span><span class="br-name"></span><span class="br-arrow"><svg viewBox="0 0 24 24"><path d="M12 2.5l7.5 17-7.5-4.2-7.5 4.2z"/></svg></span><span class="br-dist"></span></div>
      <div class="br-pace"></div><div class="br-warn"></div>`;
    host.appendChild(this.el);
    this.tTime = this.el.querySelector('.br-time')!;
    this.tCp = this.el.querySelector('.br-cp')!;
    this.tName = this.el.querySelector('.br-name')!;
    this.tArrow = this.el.querySelector('.br-arrow svg')!;
    this.tDist = this.el.querySelector('.br-dist')!;
    this.tPace = this.el.querySelector('.br-pace')!;
    this.tWarn = this.el.querySelector('.br-warn')!;
  }

  show(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.el.classList.toggle('on', on);
    document.body.classList.toggle('bigroll-racing', on);
    if (!on) {
      this.lastWarn = '';
      this.lastPace = '';
      this.lastCp = -1;
    }
  }

  get visible() {
    return this.shown;
  }

  render(s: HudState) {
    this.tTime.textContent = fmtTime(s.time);
    const n = GATES.length;
    if (s.next !== this.lastCp) {
      this.lastCp = s.next;
      const last = s.next >= n - 1;
      this.tCp.textContent = last ? 'FINISH' : `CP ${s.next + 1}/${n - 1}`;
      this.tName.textContent = last ? 'The Pins' : GATES[Math.min(n - 1, s.next)]?.name ?? '';
    }
    this.tArrow.style.transform = `rotate(${s.bearing.toFixed(3)}rad)`;
    this.tDist.textContent = `${Math.round(s.dist)} m`;
    const paceKey = `${s.pace.id}|${s.assisted}`;
    if (paceKey !== this.lastPace) {
      this.lastPace = paceKey;
      this.tPace.innerHTML = s.assisted
        ? `Speed boost on: <b style="color:${TIERS[0].color}">Bronze</b> only`
        : s.pace.id === 'bronze'
          ? `Just finish for the <b style="color:${s.pace.color}">Bronze Pin</b>`
          : `On pace for <b style="color:${s.pace.color}">${s.pace.name}</b> (under ${fmtTime(s.pace.time)})`;
    }
    const wk = `${s.warn}|${s.warnRed}`;
    if (wk !== this.lastWarn) {
      this.lastWarn = wk;
      this.tWarn.classList.toggle('on', !!s.warn);
      this.tWarn.classList.toggle('red', !!s.warnRed);
      const device = this.game.input?.usingGamepad ? 'pad' : document.querySelector('.jui.is-touch') ? 'touch' : 'kbm';
      this.tWarn.innerHTML = s.warn ? fillTokens(s.warn, device as any) : '';
    }
  }
}
