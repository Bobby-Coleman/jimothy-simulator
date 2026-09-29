import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Jimothy } from '../../../player/Jimothy';
import type { Kit } from './kit/Kit';
import type { LandmarkSystem } from './LandmarkSystem';

export interface LandmarkStatus {
  id: string;
  title: string;
  done: boolean;
  /** Current step id (e.g. 'todo', 'received', 'soggy'). */
  step: string;
  hint: string;
  /** Where it happens (for map markers / debug teleports). */
  position: THREE.Vector3;
}

/**
 * One landmark event: a small state machine triggered by proximity/interaction.
 * Subclasses call `this.setStep()` on progress and `this.complete()` once (first completion only).
 */
export abstract class Landmark {
  abstract readonly id: string;
  abstract readonly title: string;
  step = 'todo';
  done = false;
  /** Persistent per-landmark data (saved with the landmark). */
  saved: Record<string, any> = {};
  /** Current state-machine state (not persisted). */
  state = 'idle';
  stateTime = 0;

  constructor(protected sys: LandmarkSystem) {}

  get game(): Game {
    return this.sys.game;
  }
  get kit(): Kit {
    return this.sys.kit;
  }
  get player(): Jimothy | undefined {
    return this.game.get<Jimothy>('player');
  }

  /** Called once after the world has been built and physics stepped (so queries work). */
  abstract setup(): void;
  abstract update(dt: number): void;
  postPhysics?(dt: number): void;
  abstract hint(): string;
  abstract anchor(): THREE.Vector3;
  /** Where a debug teleport should put Jimothy to try this event. */
  debugSpot(): { pos: THREE.Vector3; facing?: number } {
    return { pos: this.anchor().clone().add(new THREE.Vector3(0, 1.2, 4)) };
  }

  protected go(state: string) {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
  }

  protected setStep(step: string) {
    this.sys.setStep(this, step);
  }

  /** Mark the landmark complete (fires 'questComplete' + unlocks the reward only the first time). */
  protected complete(reward?: string) {
    this.sys.complete(this, reward);
  }

  protected save() {
    this.sys.save();
  }

  /** Horizontal distance from Jimothy to a point. */
  protected flatDist(p: THREE.Vector3) {
    const pp = this.player?.position;
    if (!pp) return Infinity;
    return Math.hypot(pp.x - p.x, pp.z - p.z);
  }

  status(): LandmarkStatus {
    return { id: this.id, title: this.title, done: this.done, step: this.step, hint: this.hint(), position: this.anchor().clone() };
  }
}
