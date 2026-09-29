import type { Game } from '../../core/Game';
import type { SignAtlas } from './shared';
import type { Flight } from './RaccoonCannon';

/** One extras feature (cannons, wheel ride, cats, finale). Every hook is guarded by the ExtrasSystem. */
export interface ExtrasFeature {
  readonly id: string;
  init?(): void | Promise<void>;
  update?(dt: number): void;
  postPhysics?(dt: number): void;
  lateUpdate?(dt: number): void;
}

/** What features get from the ExtrasSystem. */
export interface ExtrasHost {
  readonly game: Game;
  readonly atlas: SignAtlas;
  readonly flight: Flight;
  /** Which activity currently owns Jimothy ('cannon:stadium', 'wheel', 'finale'…), or null. */
  readonly busy: string | null;
  /** Take ownership of the player for an activity. False if something else has it. */
  claim(id: string): boolean;
  release(id: string): void;
}
