import type { Game } from '../../core/Game';
import { ParticlePool } from './fx';

interface SharedFx {
  /** Normal-blended particles (dust, drips, hearts). */
  puffs: ParticlePool;
  /** Additive particles (sparkles, glitch pixels, glows). */
  glow: ParticlePool;
}

const pools = new WeakMap<Game, SharedFx>();

/** Lazily created particle pools shared by all mutators (updated by MutatorContent). */
export function sharedFx(game: Game): SharedFx {
  let f = pools.get(game);
  if (!f) {
    f = { puffs: new ParticlePool(game, 384), glow: new ParticlePool(game, 320, { additive: true }) };
    pools.set(game, f);
  }
  return f;
}

export function updateSharedFx(game: Game, dt: number) {
  const f = pools.get(game);
  if (!f) return;
  f.puffs.update(dt);
  f.glow.update(dt);
}
