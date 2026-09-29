import type { Game, System } from './Game';

/**
 * First-visit auto quality: if the game averages under ~42 fps during early play, step the preset down
 * (high → medium → low) and remember it. Never runs if the player (or a previous session) saved a choice.
 */
export class AutoQuality implements System {
  name = 'autoquality';
  private samples: number[] = [];
  private warm = 0;
  private done = false;

  init(game: Game) {
    this.done = game.renderer.qualityWasSaved || new URLSearchParams(location.search).has('quality');
  }

  lateUpdate(dt: number, game: Game) {
    if (this.done || game.state !== 'playing' || document.hidden) return;
    this.warm += dt;
    if (this.warm < 4) return;
    this.samples.push(dt);
    if (this.samples.length < 300) return;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = [];
    const fps = 1 / avg;
    const q = game.renderer.quality;
    if (fps < 42 && q !== 'low') {
      const next = q === 'high' ? 'medium' : 'low';
      game.renderer.setQuality(next, true);
      game.hint(`Lowered graphics to ${next} so Jimothy stays smooth. (Change it in Settings.)`, 4);
      this.warm = 0;
      if (next === 'low') this.done = true;
    } else {
      if (q !== 'low') game.renderer.setQuality(q, true); // remember that this device is fine
      this.done = true;
    }
  }
}
