import { h, pick, esc } from './dom';
import { SLOPBOT_ART } from './icons';
import { keyChip } from './glyphs';
import { SLOPBOT_LINES, type SlopLine } from './content';
import type { UiCtx } from './types';

const FIRST_DELAY = 90;
const INTERVAL = 240;
const AUTO_HIDE = 16;

/**
 * SlopBot™ — an unhelpful Clippy-parody assistant that pops in at the bottom-right every ~4 minutes.
 * Emits 'slopbotShown' { line }, 'slopbotDismissed' { reason: 'no'|'nope'|'close'|'bonk' } (player said no),
 * 'slopbotIgnored' {} (timed out), 'slopbotGenerate' { line } and 'slopbotBonked' {}.
 * Keys while visible: 1 = No, 2 = Absolutely not, 3 = Generate; Bonk (F / RMB / RB) bonks him;
 * gamepad D-pad ← dismisses, D-pad → generates.
 */
export class SlopBot {
  readonly el: HTMLElement;
  private textEl: HTMLElement;
  private btns: HTMLElement;
  private timer = FIRST_DELAY;
  private visibleFor = 0;
  private line: SlopLine | null = null;
  private state: 'hidden' | 'asking' | 'result' | 'leaving' = 'hidden';
  private lastLine: SlopLine | undefined;
  /** Suppress random appearances (automated tests). `show()` still works. */
  auto = true;

  constructor(
    private ctx: UiCtx,
    parent: HTMLElement,
  ) {
    this.textEl = h('div', { class: 'sb-text' });
    this.btns = h('div', { class: 'sb-btns' });
    const bot = h('button', { class: 'sb-bot', 'aria-label': 'Bonk SlopBot', html: SLOPBOT_ART, onclick: () => this.bonk() });
    this.el = h(
      'div',
      { class: 'slopbot', role: 'dialog', 'aria-label': 'SlopBot' },
      h(
        'div',
        { class: 'sb-bubble' },
        h(
          'div',
          { class: 'sb-head' },
          h('span', { class: 'sb-brand', html: 'SlopBot<sup>™</sup> <em>· Enhanced by AI</em>' }),
          h('button', { class: 'sb-x', 'aria-label': 'Close', text: '×', onclick: () => this.dismiss('close') }),
        ),
        this.textEl,
        this.btns,
      ),
      bot,
    );
    parent.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'asking') return;
      if (e.code === 'Digit1' || e.code === 'Numpad1') this.dismiss('no');
      else if (e.code === 'Digit2' || e.code === 'Numpad2') this.dismiss('nope');
      else if (e.code === 'Digit3' || e.code === 'Numpad3') this.generate();
    });
  }

  get visible() {
    return this.state !== 'hidden';
  }

  /** Seconds until the next random appearance. */
  schedule(seconds: number) {
    this.timer = seconds;
  }

  show(line?: SlopLine) {
    if (this.state === 'asking' || this.state === 'result') return;
    this.line = line ?? pick(SLOPBOT_LINES, this.lastLine);
    this.lastLine = this.line;
    this.state = 'asking';
    this.visibleFor = 0;
    this.textEl.textContent = this.line.text;
    this.renderButtons();
    this.el.classList.remove('leave', 'bonked');
    this.el.classList.add('show');
    this.ctx.sfx('ui_glitch', 0.8);
    this.ctx.sfx('slop_glitch', 0.35);
    this.ctx.game.events.emit('slopbotShown', { line: this.line.text });
  }

  private renderButtons() {
    const dev = this.ctx.device;
    const k = (n: string, pad: string) => (dev === 'kbm' ? keyChip(n, 'kbm') : dev === 'pad' ? keyChip(pad, 'pad') : '');
    this.btns.textContent = '';
    this.btns.append(
      h('button', { class: 'sb-btn', html: `${k('1', 'D←')}<span>No</span>`, onclick: () => this.dismiss('no') }),
      h('button', { class: 'sb-btn', html: `${k('2', '')}<span>Absolutely not</span>`, onclick: () => this.dismiss('nope') }),
      h('button', { class: 'sb-btn sb-gen', html: `${k('3', 'D→')}<span>${esc(this.line!.gen)}</span>`, onclick: () => this.generate() }),
    );
  }

  dismiss(reason: 'no' | 'nope' | 'close' | 'timeout' | 'bonk' = 'no') {
    if (this.state !== 'asking' && this.state !== 'result') return;
    const wasAsking = this.state === 'asking';
    this.leave(reason === 'bonk');
    // Only the player's own "no" counts as dismissing him (objectives count these); ignoring him is different.
    if (reason === 'timeout') {
      if (wasAsking) this.ctx.game.events.emit('slopbotIgnored', {});
    } else if (wasAsking || reason === 'bonk') this.ctx.game.events.emit('slopbotDismissed', { reason });
    this.ctx.sfx(reason === 'bonk' ? 'bonk' : 'ui_back', 0.7);
  }

  generate() {
    if (this.state !== 'asking' || !this.line) return;
    this.state = 'result';
    this.visibleFor = AUTO_HIDE - 4.2;
    this.textEl.innerHTML = '';
    this.textEl.append(h('span', { class: 'sb-generating', text: 'Generating' }));
    this.btns.textContent = '';
    const line = this.line;
    window.setTimeout(() => {
      if (this.state === 'result' && this.line === line) this.textEl.textContent = line.result;
    }, 900);
    this.ctx.game.events.emit('slopbotGenerate', { line: line.text });
    this.ctx.sfx('slop_voice', 0.6);
    this.ctx.sfx('ui_confirm', 0.6);
  }

  /** Bonk SlopBot off the screen (Bonk action or clicking him). */
  bonk() {
    if (this.state === 'hidden' || this.state === 'leaving') return;
    this.ctx.game.events.emit('slopbotBonked', {});
    this.ctx.game.score(50, 'Bonked SlopBot');
    this.dismiss('bonk');
  }

  private leave(bonked: boolean) {
    this.state = 'leaving';
    this.el.classList.remove('show');
    this.el.classList.add(bonked ? 'bonked' : 'leave');
    this.timer = INTERVAL * (0.85 + Math.random() * 0.3);
    window.setTimeout(() => {
      if (this.state === 'leaving') {
        this.state = 'hidden';
        this.el.classList.remove('leave', 'bonked');
      }
    }, bonked ? 1100 : 600);
  }

  /** Called every frame. `canRun`: gameplay is active (no menus / cutscenes / dialogs). */
  update(dt: number, canRun: boolean) {
    const inp = this.ctx.game.input;
    if (this.state === 'hidden') {
      if (canRun && this.auto) {
        this.timer -= dt;
        if (this.timer <= 0) this.show();
      }
      return;
    }
    if (!canRun) return;
    this.visibleFor += dt;
    if (this.state === 'asking' && inp.pressed('bonk')) {
      this.bonk();
      return;
    }
    if (this.visibleFor > AUTO_HIDE) this.dismiss('timeout');
  }

  /** Gamepad D-pad left/right while visible. */
  padInput(dir: 'left' | 'right') {
    if (this.state !== 'asking') return false;
    if (dir === 'left') this.dismiss('no');
    else this.generate();
    return true;
  }

  refreshGlyphs() {
    if (this.state === 'asking') this.renderButtons();
  }
}
