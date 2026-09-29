import * as THREE from 'three';
import type { Game, System } from '../../../core/Game';
import { Kit } from './kit/Kit';
import type { Landmark, LandmarkStatus } from './Landmark';
import { HonoraryDegree } from './events/HonoraryDegree';
import { JimothySummer } from './events/JimothySummer';
import { SalmonRun } from './events/SalmonRun';
import { CatchOfTheDay } from './events/CatchOfTheDay';
import { GoldRookieCard } from './events/GoldRookieCard';
import { NoodleSummit } from './events/NoodleSummit';

const STORE_KEY = 'jimothy.landmarks.v1';

/**
 * Landmark events — parody recreations of the real honours Jimothy got in summer 2026:
 *   degree      Honorary Degree at the University of Washing stage (wash it → "Degree In Soggy")
 *   summer      "Jimothy Summer" proclamation at the City Hall podium
 *   salmon      The Salmon Run at Tee-Hee Park ("Jimothy Night")
 *   catch       Catch of the Day at Pike's Plaice Market
 *   rookieCard  The gold-bordered rookie card hidden in the dugout
 *   noodle      Top of the Space Noodle (+ Leap of Faith)
 *
 * API:  game.get('landmarks').status() → [{ id, title, done, step, hint, position }]
 * Events emitted (payloads):
 *   'questProgress'  { id, title, step, done, hint }   whenever a landmark's step changes
 *   'questComplete'  { id, title }                      first completion of each landmark
 *   'degreeReceived' { first }            'degreeSoggy' {}               (Honorary Degree)
 *   'proclamation'   { first }                                           (Jimothy Summer)
 *   'salmonRunStart' {}  'salmonRunWon' { time, first }  'salmonRunLost' { winner }
 *   'fishThrown' {}  'fishCaught' { count }  'fishReturned' { caught: boolean }
 *   'collectible'    { id: 'rookieCard', kind: 'rookieCard' }  'rookieCardWashed' {}
 *   'noodleSummit'   { first }             'leapOfFaith' { height }
 * Mutators unlocked: honoraryGrad (degree), jimothySummer (summer), rookie (salmon).
 */
export class LandmarkSystem implements System {
  name = 'landmarks';
  game!: Game;
  kit!: Kit;
  readonly list: Landmark[] = [];
  private ready = false;
  private data: Record<string, { done?: boolean; step?: string; saved?: Record<string, any> }> = {};
  private pendingUnlocks = new Set<string>();
  private unlockRetry = 0;
  private errors = new Map<string, number>();

  init(game: Game) {
    this.game = game;
    try {
      this.data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') ?? {};
    } catch {
      this.data = {};
    }
    for (const id of (this.data as any).__pending ?? []) this.pendingUnlocks.add(id);
    this.kit = new Kit(game);
    this.list.push(
      new HonoraryDegree(this),
      new JimothySummer(this),
      new SalmonRun(this),
      new CatchOfTheDay(this),
      new GoldRookieCard(this),
      new NoodleSummit(this),
    );
    for (const lm of this.list) {
      const d = this.data[lm.id];
      if (d) {
        lm.done = !!d.done;
        lm.step = d.step ?? (lm.done ? 'done' : 'todo');
        lm.saved = { ...(d.saved ?? {}) };
      }
    }
  }

  get<T extends Landmark = Landmark>(id: string): T | undefined {
    return this.list.find((l) => l.id === id) as T | undefined;
  }

  /** Every landmark event with its progress, for the objectives / pause UI. */
  status(): LandmarkStatus[] {
    return this.list.map((l) => {
      try {
        return l.status();
      } catch {
        return { id: l.id, title: l.title, done: l.done, step: l.step, hint: '', position: new THREE.Vector3() };
      }
    });
  }

  // ------------------------------------------------------------------ progress
  setStep(lm: Landmark, step: string) {
    if (lm.step === step) return;
    lm.step = step;
    this.save();
    this.game.events.emit('questProgress', { id: lm.id, title: lm.title, step, done: lm.done, hint: lm.hint() });
  }

  complete(lm: Landmark, reward?: string) {
    if (lm.done) return false;
    lm.done = true;
    this.save();
    this.game.events.emit('questComplete', { id: lm.id, title: lm.title });
    this.game.events.emit('questProgress', { id: lm.id, title: lm.title, step: lm.step, done: true, hint: lm.hint() });
    if (reward) this.unlock(reward);
    return true;
  }

  private unlock(id: string) {
    const muts = this.game.get<any>('mutators');
    if (muts?.get?.(id)) muts.unlock(id);
    else {
      this.pendingUnlocks.add(id);
      this.save();
    }
  }

  save() {
    const out: Record<string, any> = {};
    for (const l of this.list) out[l.id] = { done: l.done, step: l.step, saved: l.saved };
    if (this.pendingUnlocks.size) out.__pending = [...this.pendingUnlocks];
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch {
      /* ignore */
    }
  }

  /** Forget all landmark progress (dev / "new game"). */
  reset() {
    for (const l of this.list) {
      l.done = false;
      l.step = 'todo';
      l.saved = {};
    }
    this.pendingUnlocks.clear();
    this.save();
  }

  /** Debug: put Jimothy next to an event's trigger. */
  teleportTo(id: string) {
    const l = this.get(id);
    const p = this.game.get<any>('player');
    if (!l || !p) return false;
    const s = l.debugSpot();
    p.teleport(s.pos.clone(), s.facing);
    return true;
  }

  // ------------------------------------------------------------------ hooks
  private guard(key: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      const n = (this.errors.get(key) ?? 0) + 1;
      this.errors.set(key, n);
      if (n <= 3) console.error(`[landmarks] ${key} failed`, err);
    }
  }

  update(dt: number) {
    if (!this.ready) {
      // Wait for one physics step so scene queries see the static world.
      if (this.game.physics.time <= 0) return;
      this.ready = true;
      for (const l of this.list) this.guard(`${l.id}.setup`, () => l.setup());
    }
    for (const l of this.list) this.guard(`${l.id}.update`, () => l.update(dt));
    this.guard('kit.update', () => this.kit.update(dt));
    if (this.pendingUnlocks.size && (this.unlockRetry -= dt) <= 0) {
      this.unlockRetry = 3;
      const muts = this.game.get<any>('mutators');
      for (const id of [...this.pendingUnlocks]) {
        if (muts?.get?.(id)) {
          muts.unlock(id);
          this.pendingUnlocks.delete(id);
          this.save();
        }
      }
    }
  }

  postPhysics(dt: number) {
    if (!this.ready) return;
    this.guard('kit.postPhysics', () => this.kit.postPhysics());
    for (const l of this.list) if (l.postPhysics) this.guard(`${l.id}.postPhysics`, () => l.postPhysics!(dt));
  }

  lateUpdate(dt: number) {
    if (!this.kit) return;
    this.guard('kit.lateUpdate', () => this.kit.lateUpdate(dt));
  }
}
