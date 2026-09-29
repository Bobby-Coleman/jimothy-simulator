import * as THREE from 'three';
import type { Game, System } from '../core/Game';

export interface ScoreAdded {
  label: string;
  points: number;
  base: number;
  mult: number;
  combo: number;
  total: number;
  position?: THREE.Vector3;
}

/**
 * Goat-Sim-style scoring: every silly act emits `score`, chained acts within the combo window
 * build a multiplier. Emits `scoreAdded`, `comboUp`, `comboEnd`.
 */
export class ScoreSystem implements System {
  name = 'score';
  total = 0;
  best = 0;
  combo = 0;
  mult = 1;
  comboTimer = 0;
  comboPoints = 0;
  readonly comboWindow = 3.2;
  /** Anti-spam: same label repeated quickly gets diminishing returns. */
  private labelTimes = new Map<string, { t: number; n: number }>();
  private game!: Game;

  init(game: Game) {
    this.game = game;
    try {
      this.best = Number(localStorage.getItem('jimothy.best') || 0);
    } catch {
      /* ignore */
    }
    game.events.on('score', (p) => this.add(p));
  }

  add(p: { points: number; label: string; position?: THREE.Vector3; noCombo?: boolean }) {
    if (!p || !(p.points > 0)) return;
    const now = this.game.time;
    const lt = this.labelTimes.get(p.label);
    let base = p.points;
    if (lt && now - lt.t < 1.5) {
      lt.n++;
      base = Math.max(1, Math.round(base / (1 + lt.n * 0.6)));
    } else {
      this.labelTimes.set(p.label, { t: now, n: 0 });
    }
    if (lt) lt.t = now;

    if (!p.noCombo) {
      if (this.comboTimer > 0) this.combo++;
      else {
        this.combo = 1;
        this.comboPoints = 0;
      }
      this.comboTimer = this.comboWindow;
    }
    const prevMult = this.mult;
    this.mult = Math.min(8, 1 + Math.floor(Math.max(0, this.combo - 1) / 3) * 0.5);
    const awarded = Math.round(base * this.mult);
    this.total += awarded;
    this.comboPoints += awarded;
    if (this.total > this.best) {
      this.best = this.total;
      try {
        localStorage.setItem('jimothy.best', String(this.best));
      } catch {
        /* ignore */
      }
    }
    const ev: ScoreAdded = { label: p.label, points: awarded, base, mult: this.mult, combo: this.combo, total: this.total, position: p.position };
    this.game.events.emit('scoreAdded', ev);
    if (this.mult > prevMult) {
      this.game.events.emit('comboUp', { mult: this.mult, combo: this.combo });
      this.game.sfx('combo_up');
    }
  }

  update(dt: number) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        if (this.combo >= 3) this.game.events.emit('comboEnd', { combo: this.combo, points: this.comboPoints, mult: this.mult });
        this.combo = 0;
        this.mult = 1;
      }
    }
  }
}
