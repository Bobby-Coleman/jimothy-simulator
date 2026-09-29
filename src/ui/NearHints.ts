import type { Game, System } from '../core/Game';
import type { Guide, NearEntry } from './Guide';
import { h, esc } from './dom';
import { ICONS } from './icons';
import { fillTokens } from './glyphs';
import { categoryInfo } from './ObjectivesView';

/**
 * Proximity hints: when Jimothy lingers near the place where an unfinished Instinct happens, its hint appears in a
 * row hanging under the tracked-goal pill (top of the screen), so a stumped player doesn't have to dig through the
 * Instincts menu.
 *
 * Data comes from the Guide (ui/Guide.ts `DEFS[].near` → `guide.nearby()`): spots (POIs, heart-quest positions,
 * live things like hydrants / propane tanks / parked cars) with per-place radii, and the on-site hint text
 * (defaults to the Guide's `how`, so quest steps and progress stay live).
 *
 * Don't nag:
 *  - shows only after ~2 s near (dwell), stays while near (a little hysteresis), fades out on leaving;
 *  - one at a time: the tracked goal when it's in range, else the nearest (distance / radius, then Guide rank);
 *  - never secret / hidden / finished Instincts (the Guide filters them), and only while the pill itself is on screen
 *    (so not in cutscenes, dialogs, menus, the drawer, the big map, photo mode, with the HUD or goal tracker off);
 *  - hidden while the HUD is hushed for a heartfelt cutscene (UI.hush).
 * It never overlaps the toast column: when the row would cover it, the column slides down (CSS `translate`).
 *
 * Test hooks: `g.get('nearHints').state()` → { shown, pending, dwell, text }.
 */

const DWELL = 2.0;
/** Seconds between spot scans (cheap, but no need every frame). */
const SCAN = 0.15;
/** Leaving hysteresis: the shown hint stays until this much further out than its radius. */
const EXIT_PAD = (r: number) => Math.max(4, r * 0.3);

const CSS = `
.gp-hint {
  --cat: var(--gold);
  position: absolute;
  top: calc(100% + 0.35em);
  left: 50%;
  width: max-content;
  max-width: clamp(17em, calc(100vw - 54em), 34em);
  display: flex;
  align-items: flex-start;
  gap: 0.45em;
  padding: 0.4em 0.75em 0.45em 0.45em;
  border-radius: 0.9em;
  border: 0.14em solid var(--ink);
  background: rgba(29, 26, 38, 0.82);
  box-shadow: 0 0.16em 0 rgba(0, 0, 0, 0.35);
  color: var(--cream);
  font-family: var(--f-body);
  font-weight: 800;
  font-size: 0.84em;
  letter-spacing: 0;
  line-height: 1.35;
  text-align: left;
  white-space: normal;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, -0.35em);
  transition: opacity 0.35s, transform 0.35s;
}
.gp-hint.show { opacity: 1; transform: translate(-50%, 0); }
.gp-hint .gph-icon {
  flex: none;
  width: 1.45em;
  height: 1.45em;
  margin-top: 0.05em;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--gold);
  color: var(--ink);
}
.gp-hint .gph-icon svg { width: 100%; height: 100%; fill: currentColor; }
.gp-hint .gph-text { min-width: 0; }
.gp-hint .gph-kicker { display: block; font-family: var(--f-bold); font-weight: 400; letter-spacing: 0.02em; color: var(--cat); }
.jui.is-touch .gp-hint { max-width: min(26em, calc(100vw - 2em)); }
.hud-right { transition: right 0.35s cubic-bezier(0.2, 1.2, 0.4, 1), translate 0.3s ease; }
@media (orientation: portrait) {
  /* the pill is right-aligned under the top buttons, clear of the score / minimap column: so is the hint */
  .jui.is-touch .gp-hint { left: auto; right: 0; transform: translateY(-0.35em); max-width: min(64vw, calc(100vw - 13.5em)); }
  .jui.is-touch .gp-hint.show { transform: none; }
}
@media (orientation: landscape) and (max-height: 520px) {
  .jui.is-touch .gp-hint { max-width: min(24em, calc(100vw - 25em)); font-size: 0.8em; }
}
`;

export class NearHints implements System {
  name = 'nearHints';
  private game!: Game;
  private ui: any;
  private el: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private right: HTMLElement | null = null;
  private scanT = 0;
  private acc = 0;
  private shown: string | null = null;
  private shownHtml = '';
  private pending: string | null = null;
  private dwell = 0;
  private push = 0;
  private pushT = 0;

  init(game: Game) {
    this.game = game;
    this.ui = game.get<any>('ui');
    const guide: Guide | undefined = this.ui?.guide;
    if (!guide?.pillEl) return;
    const style = document.createElement('style');
    style.dataset.owner = 'nearHints';
    style.textContent = CSS;
    document.head.append(style);
    this.textEl = h('span', { class: 'gph-text' });
    this.el = h('span', { class: 'gp-hint', 'aria-live': 'polite' }, h('span', { class: 'gph-icon', html: ICONS.info }), this.textEl);
    guide.pillEl.append(this.el);
    this.right = (this.ui.root as HTMLElement | undefined)?.querySelector('.hud-right') ?? null;
    game.events.on('objective', (o: any) => {
      if (o?.id && o.id === this.shown) this.hide();
      if (o?.id && o.id === this.pending) this.pending = null;
    });
  }

  /** Test hook. */
  state() {
    return { shown: this.shown, pending: this.pending, dwell: +this.dwell.toFixed(2), text: this.textEl?.textContent ?? '' };
  }

  lateUpdate(dt: number) {
    if (!this.el) return;
    const ui = this.ui;
    const guide: Guide = ui.guide;
    const can = guide.pillVisible && !ui.hud?.isHushed && this.game.state === 'playing' && ui.settings?.showGuide !== false;
    if (!can) {
      if (this.shown) this.hide();
      this.pending = null;
      this.dwell = 0;
      this.setPush(0);
      return;
    }
    this.acc += dt;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = SCAN;
      this.scan(guide, this.acc);
      this.acc = 0;
    }
    this.pushT -= dt;
    if (this.pushT <= 0) {
      this.pushT = 0.3;
      this.avoidToasts();
    }
  }

  private scan(guide: Guide, dt: number) {
    const p = this.game.get<any>('player')?.position;
    if (!p) return;
    const list = guide.nearby();
    const trackedId = guide.current()?.id ?? null;
    let best: NearEntry | null = null;
    let bestScore = Infinity;
    let shownEntry: NearEntry | null = null;
    let shownStays = false;
    for (const e of list) {
      let norm = Infinity;
      let placeNorm = Infinity;
      let stay = false;
      for (const s of e.spots) {
        if (s.up != null && Math.abs(s.pos.y - p.y) > s.up) continue;
        const d = Math.hypot(s.pos.x - p.x, s.pos.z - p.z);
        norm = Math.min(norm, d / s.r);
        if (!s.live) placeNorm = Math.min(placeNorm, d / s.r);
        if (d <= s.r + EXIT_PAD(s.r)) stay = true;
      }
      if (e.id === this.shown) {
        shownEntry = e;
        shownStays = stay;
      }
      if (norm > 1) continue;
      // Tracked goal first (at its own places), then the nearest relative to its radius; Guide rank breaks near-ties.
      // Only near its live target (a passing kid with cotton candy, grapes on Grandma's porch) it doesn't outrank a
      // real place: that one is what the player is standing at.
      const tracked = e.id === trackedId;
      const score = (tracked && placeNorm <= 1 ? -10 : 0) + (placeNorm <= 1 ? placeNorm : norm + 0.6) + e.rank * 0.004;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    // Keep the current hint while still near, unless the tracked goal came into range.
    if (this.shown && (!shownEntry || !shownStays)) this.hide();
    const want = best && (!this.shown || (best.id !== this.shown && bestScore < -5)) ? best : null;
    if (want) {
      if (this.pending === want.id) this.dwell += dt;
      else {
        this.pending = want.id;
        this.dwell = 0;
      }
      if (this.dwell >= DWELL) {
        this.pending = null;
        this.dwell = 0;
        this.show(want, trackedId);
      }
    } else {
      this.pending = null;
      this.dwell = 0;
    }
    if (this.shown && shownEntry && shownStays) this.render(shownEntry, trackedId);
  }

  private show(e: NearEntry, trackedId: string | null) {
    this.shown = e.id;
    this.render(e, trackedId);
    this.el!.classList.add('show');
    this.pushT = 0; // re-check the toast column right away
  }

  private render(e: NearEntry, trackedId: string | null) {
    const cat = categoryInfo(e.category);
    const kicker = e.id === trackedId ? '' : `<b class="gph-kicker">Nearby · ${esc(e.title)}</b>`;
    const html = kicker + fillTokens(e.hint, this.ui.device);
    if (html === this.shownHtml) return;
    this.shownHtml = html;
    this.el!.style.setProperty('--cat', cat.color);
    this.textEl!.innerHTML = html;
    this.pushT = 0;
  }

  private hide() {
    this.shown = null;
    this.el?.classList.remove('show');
    this.setPush(0);
  }

  /** Slide the toast column down while the hint row would cover it (phones mostly; narrow desktop windows). */
  private avoidToasts() {
    if (!this.el || !this.right) return;
    if (!this.shown) return this.setPush(0);
    const a = this.el.getBoundingClientRect();
    const b = this.right.getBoundingClientRect();
    // un-pushed position (the slide may still be animating: subtract where it is right now)
    const cur = parseFloat((getComputedStyle(this.right).translate || '').split(' ')[1] ?? '0') || 0;
    const top = b.top - cur;
    const overlapX = a.right > b.left && a.left < b.right;
    const need = overlapX && a.bottom + 6 > top ? Math.ceil(a.bottom + 6 - top) : 0;
    this.setPush(need);
  }

  private setPush(px: number) {
    if (!this.right || Math.abs(px - this.push) < 2) return;
    this.push = px;
    this.right.style.translate = px ? `0 ${px}px` : '';
  }
}
