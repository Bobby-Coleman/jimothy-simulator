import type { Game, System } from '../core/Game';

/** Goat-Sim-style slow motion toggle (T / R3-less). Eases the game's timeScale. */
export class SlowMoSystem implements System {
  name = 'slowmo';
  active = false;
  private target = 1;

  update(_dt: number, game: Game) {
    if (game.input.pressed('slowmo')) {
      this.active = !this.active;
      this.target = this.active ? 0.3 : 1;
      game.hint(this.active ? 'Slow-mo: ON. Savor it.' : 'Slow-mo: off.', 1.2);
      game.sfx(this.active ? 'whoosh' : 'whoosh', undefined, 0.5, this.active ? 0.6 : 1.3);
      game.events.emit('slowmo', { active: this.active });
    }
  }

  lateUpdate(dt: number, game: Game) {
    if (game.state !== 'playing' && game.state !== 'cutscene') return;
    if (game.get<any>('photomode')?.active) return;
    const k = 1 - Math.exp(-dt * 6);
    game.timeScale += (this.target - game.timeScale) * k;
    if (Math.abs(game.timeScale - this.target) < 0.005) game.timeScale = this.target;
  }
}
