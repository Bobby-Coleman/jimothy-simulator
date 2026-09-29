import type { Game, System } from '../../../core/Game';
import type { ObjectivesSystem } from '../../Objectives';
import { HeartCtx, type HeartQuest, type QuestId, type QuestStatus } from './ctx';
import { MamaQuest } from './MamaQuest';
import { KitsQuest } from './KitsQuest';
import { DannyQuest } from './DannyQuest';
import { CrowQuest } from './CrowQuest';
import { GrandmaQuest } from './GrandmaQuest';
import { TeddyQuest } from './TeddyQuest';

const STORE_KEY = 'jimothy.heart.v1';

/**
 * The heartwarming side of Jimothy Simulator: Mom, the lost kits, Danny, the crows, Grandma Rosie and the
 * sad kid's teddy. Registered as 'heartQuests' (after the 'animals' system).
 *
 * API: `game.get('heartQuests').status()` → [{ id, title, step, done, position }]
 * Events: 'questProgress' {id, text}, 'questComplete' {id, title}, plus each quest's own
 * ('momFed', 'kitRescued', 'dannyReunion', 'crowTrade', 'grandmaVisit', 'teddyReturned', …).
 * Quest state persists in localStorage ('jimothy.heart.v1'); `reset()` clears it.
 */
export class HeartQuestSystem implements System {
  name = 'heartQuests';
  game!: Game;
  ctx!: HeartCtx;
  readonly quests: HeartQuest[] = [];
  mama!: MamaQuest;
  kits!: KitsQuest;
  danny!: DannyQuest;
  crows!: CrowQuest;
  grandma!: GrandmaQuest;
  teddy!: TeddyQuest;
  private ready = false;
  /** Objective ids we registered ourselves (nobody else did) and therefore drive. */
  private owned = new Set<string>();
  private errors = new Map<string, number>();

  async init(game: Game) {
    this.game = game;
    this.ctx = new HeartCtx(game, {
      save: () => this.save(),
      progress: (id, text) => this.progress(id, text),
      complete: (id) => this.complete(id),
    });
    // The items module is optional (another helper builds it): use it for teddy / grapes / gifts if present.
    try {
      const mods = import.meta.glob('../../items/*.ts');
      const key = Object.keys(mods).find((k) => /\/(Items|items|index)\.ts$/.test(k));
      if (key) this.ctx.itemsMod = await mods[key]();
    } catch {
      /* no items module */
    }
    this.mama = new MamaQuest();
    this.kits = new KitsQuest(this.mama);
    this.danny = new DannyQuest(this.mama);
    this.crows = new CrowQuest();
    this.grandma = new GrandmaQuest();
    this.teddy = new TeddyQuest();
    this.quests.push(this.mama, this.kits, this.danny, this.crows, this.grandma, this.teddy);
    this.load();
    if (!game.get('animals')) console.error('[heart] AnimalSystem ("animals") must be registered before heartQuests');
    for (const q of this.quests) {
      try {
        await q.init(this.ctx);
      } catch (err) {
        console.error(`[heart] quest "${q.id}" failed to init`, err);
      }
    }
  }

  // ------------------------------------------------------------------------------------------- public API
  status(): QuestStatus[] {
    return this.quests.map((q) => {
      let step = '';
      let position = null;
      try {
        step = q.step();
        position = q.target?.()?.clone() ?? null;
      } catch {
        /* keep defaults */
      }
      return { id: q.id, title: q.title, step, done: q.done, position };
    });
  }

  quest(id: QuestId) {
    return this.quests.find((q) => q.id === id);
  }

  get doneCount() {
    return this.quests.filter((q) => q.done).length;
  }

  /** Forget all heart-quest progress (takes effect on reload). */
  reset() {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------------------------------- internals
  private progress(id: QuestId, text: string) {
    this.game.events.emit('questProgress', { id, text });
    const q = this.quest(id);
    if (q) this.syncObjective(q);
  }

  private complete(id: QuestId) {
    const q = this.quest(id);
    this.game.events.emit('questComplete', { id, title: q?.title });
    this.game.events.emit('questProgress', { id, text: q?.step() ?? '' });
    if (q) this.syncObjective(q);
    this.save();
  }

  /** Register fallback objectives only when the objective-content system hasn't (ids in either style). */
  private registerObjectives() {
    const obj = this.game.get<ObjectivesSystem>('objectives');
    if (!obj) return;
    for (const q of this.quests) {
      if (q.objective.ids.some((id) => obj.get(id))) continue;
      obj.add(q.objective.def);
      this.owned.add(q.objective.def.id);
      this.syncObjective(q);
    }
  }

  private syncObjective(q: HeartQuest) {
    const id = q.objective.def.id;
    if (!this.owned.has(id)) return;
    const obj = this.game.get<ObjectivesSystem>('objectives');
    if (!obj) return;
    if (q.done) {
      obj.complete(id);
      return;
    }
    const n = q === this.mama ? this.mama.fed : q === this.crows ? this.crows.trades : q === this.kits ? (this.kits.save().rescued?.length ?? 0) : 0;
    if (n > 0) obj.set(id, n);
  }

  save() {
    const data: Record<string, any> = {};
    for (const q of this.quests) {
      try {
        data[q.id] = q.save();
      } catch {
        /* skip */
      }
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  private load() {
    let data: Record<string, any> = {};
    try {
      data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') ?? {};
    } catch {
      data = {};
    }
    for (const q of this.quests) {
      try {
        q.load(data[q.id] ?? {});
      } catch {
        /* fresh */
      }
    }
  }

  private guard(key: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      const n = (this.errors.get(key) ?? 0) + 1;
      this.errors.set(key, n);
      if (n <= 3) console.error(`[heart] ${key} failed`, err);
    }
  }

  // ------------------------------------------------------------------------------------------- system hooks
  update(dt: number) {
    if (!this.ready) {
      this.ready = true;
      // every system is initialised now: NPCs, items, objective content
      for (const q of this.quests) this.guard(`${q.id}.setup`, () => q.setup?.(this.ctx));
      this.guard('objectives', () => this.registerObjectives());
    }
    this.ctx.tick();
    for (const q of this.quests) this.guard(`${q.id}.update`, () => q.update(dt));
  }

  postPhysics(dt: number) {
    for (const q of this.quests) if (q.postPhysics) this.guard(`${q.id}.postPhysics`, () => q.postPhysics!(dt));
  }

  lateUpdate(dt: number) {
    if (!this.ready) return;
    for (const q of this.quests) if (q.lateUpdate) this.guard(`${q.id}.lateUpdate`, () => q.lateUpdate!(dt));
  }
}
