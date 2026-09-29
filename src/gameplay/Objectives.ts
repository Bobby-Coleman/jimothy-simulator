import type { Game, System } from '../core/Game';

export type ObjectiveCategory = 'raccoon' | 'slop' | 'heart' | 'chaos' | 'secret';

export interface ObjectiveDef {
  id: string;
  title: string;
  /** Shown in the objectives list; keep it short and funny. */
  desc: string;
  category: ObjectiveCategory;
  points: number;
  /** Progress target (default 1). */
  target?: number;
  /** Hidden until completed (secret objectives). */
  hidden?: boolean;
  /** Mutator id unlocked on completion. */
  reward?: string;
}

export interface Objective extends ObjectiveDef {
  progress: number;
  done: boolean;
  doneAt?: number;
}

const STORE_KEY = 'jimothy.objectives.v1';

/**
 * Objective ("Instinct") registry + progress. Content lives elsewhere (see src/gameplay/content/*);
 * it calls `objectives.add(def)` in init and `objectives.progress(id)` from event handlers.
 * Emits: 'objective' { id, title, points, reward }, 'objectiveProgress' { id, progress, target }.
 */
export class ObjectivesSystem implements System {
  name = 'objectives';
  readonly list: Objective[] = [];
  private byId = new Map<string, Objective>();
  private saved: Record<string, { p: number; d: boolean }> = {};
  private game!: Game;

  init(game: Game) {
    this.game = game;
    try {
      this.saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch {
      this.saved = {};
    }
  }

  add(def: ObjectiveDef): Objective {
    const existing = this.byId.get(def.id);
    if (existing) return existing;
    const s = this.saved[def.id];
    const o: Objective = { target: 1, ...def, progress: s?.p ?? 0, done: s?.d ?? false };
    this.list.push(o);
    this.byId.set(o.id, o);
    return o;
  }

  get(id: string) {
    return this.byId.get(id);
  }

  isDone(id: string) {
    return !!this.byId.get(id)?.done;
  }

  /** Add progress (default +1). Completes automatically when reaching the target. */
  progress(id: string, amount = 1) {
    const o = this.byId.get(id);
    if (!o || o.done) return;
    this.set(id, o.progress + amount);
  }

  /** Set absolute progress (e.g. max height reached). Only ever increases. */
  set(id: string, value: number) {
    const o = this.byId.get(id);
    if (!o || o.done) return;
    const v = Math.min(value, o.target ?? 1);
    if (v <= o.progress) return;
    o.progress = v;
    this.game.events.emit('objectiveProgress', { id, progress: o.progress, target: o.target ?? 1, title: o.title });
    if (o.progress >= (o.target ?? 1)) this.complete(id);
    else this.save();
  }

  complete(id: string) {
    const o = this.byId.get(id);
    if (!o || o.done) return;
    o.done = true;
    o.progress = o.target ?? 1;
    o.doneAt = this.game.time;
    this.save();
    this.game.score(o.points, o.title);
    this.game.sfx('objective_complete');
    this.game.events.emit('objective', { id: o.id, title: o.title, desc: o.desc, points: o.points, reward: o.reward, category: o.category });
    if (o.reward) this.game.get<any>('mutators')?.unlock(o.reward);
  }

  get doneCount() {
    return this.list.filter((o) => o.done).length;
  }

  resetAll() {
    for (const o of this.list) {
      o.done = false;
      o.progress = 0;
    }
    this.save();
  }

  private save() {
    const out: Record<string, { p: number; d: boolean }> = {};
    for (const o of this.list) if (o.progress > 0 || o.done) out[o.id] = { p: o.progress, d: o.done };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch {
      /* ignore */
    }
  }
}
