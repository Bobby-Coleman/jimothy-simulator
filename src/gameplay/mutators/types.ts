import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Jimothy } from '../../player/Jimothy';
import type { MutatorDef } from '../Mutators';

/**
 * Per-frame visual modifiers every active mutator can contribute to (reset each frame, then applied to the
 * player's model by MutatorContent after the player's own visual sync).
 */
export interface ModelMods {
  /** Multiplied into the model's base scale. */
  scale: THREE.Vector3;
  /** Added to the model's base position (model-local units). */
  offset: THREE.Vector3;
  /** Extra euler rotation (XYZ) applied to the model. */
  rot: THREE.Vector3;
  /** World-space vertical lift of the whole visual, meters (keeps resized Jimothys on the ground). */
  lift: number;
}

export interface MutatorImpl {
  def: Omit<MutatorDef, 'apply' | 'update'>;
  enable(game: Game): void;
  disable(game: Game): void;
  /** Pre-physics, runs after the player's own update (so velocity tweaks stick). */
  update?(game: Game, dt: number): void;
  /** Post-physics, runs after the player's visual sync + procedural animation. */
  post?(game: Game, dt: number, mods: ModelMods): void;
}

/** The base physics radius of Jimothy's ball collider (src/player/Jimothy.ts `R`). */
export const PLAYER_R = 0.38;

export const getPlayer = (game: Game) => game.get<Jimothy>('player');
