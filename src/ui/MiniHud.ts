import type { Game, System } from '../core/Game';
import type { ScoreAdded, ScoreSystem } from '../gameplay/Score';

/**
 * Minimal developer HUD (score, popups, hints, debug line).
 * The real HUD in src/ui/ replaces this; it's kept tiny on purpose.
 */
export class MiniHud implements System {
  name = 'minihud';
  private root!: HTMLDivElement;
  private scoreEl!: HTMLDivElement;
  private popups!: HTMLDivElement;
  private hintEl!: HTMLDivElement;
  private debugEl!: HTMLDivElement;
  private hintTimer = 0;
  private game!: Game;

  init(game: Game) {
    this.game = game;
    const ui = document.getElementById('ui')!;
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;font:700 18px system-ui,sans-serif;color:#fff;text-shadow:0 2px 0 #000,0 0 6px #000';
    ui.appendChild(this.root);
    this.scoreEl = this.el('position:absolute;left:18px;top:14px;font-size:26px');
    this.popups = this.el('position:absolute;left:50%;bottom:22%;transform:translateX(-50%);display:flex;flex-direction:column-reverse;align-items:center;gap:4px');
    this.hintEl = this.el('position:absolute;left:50%;bottom:8%;transform:translateX(-50%);font-size:17px;max-width:70vw;text-align:center;opacity:0;transition:opacity .2s');
    this.debugEl = this.el('position:absolute;right:12px;top:10px;font:600 12px monospace;opacity:.75;text-align:right;white-space:pre');
    game.events.on('scoreAdded', (e: ScoreAdded) => this.popup(e));
    game.events.on('hint', (h: { text: string; duration?: number }) => {
      this.hintEl.textContent = h.text;
      this.hintEl.style.opacity = '1';
      this.hintTimer = h.duration ?? 2.5;
    });
  }

  private el(css: string) {
    const d = document.createElement('div');
    d.style.cssText = css;
    this.root.appendChild(d);
    return d;
  }

  private popup(e: ScoreAdded) {
    const d = document.createElement('div');
    d.textContent = `${e.label.toUpperCase()}  +${e.points}${e.mult > 1 ? `  x${e.mult}` : ''}`;
    d.style.cssText = 'font-size:22px;transition:opacity .6s,transform .6s;';
    this.popups.appendChild(d);
    setTimeout(() => {
      d.style.opacity = '0';
      d.style.transform = 'translateY(-20px)';
    }, 1800);
    setTimeout(() => d.remove(), 2500);
    while (this.popups.children.length > 6) this.popups.firstChild?.remove();
  }

  lateUpdate(dt: number, game: Game) {
    const s = game.get<ScoreSystem>('score');
    if (s) this.scoreEl.textContent = `${s.total.toLocaleString()}${s.combo >= 2 ? `   combo ${s.combo}  x${s.mult}` : ''}`;
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.style.opacity = '0';
    }
    const p = game.get<any>('player');
    if (p && game.frame % 10 === 0) {
      const pos = p.position;
      this.debugEl.textContent = `${game.fps.toFixed(0)} fps\n${p.mode}${p.grounded ? ' ground' : ''}\n${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
    }
  }
}
