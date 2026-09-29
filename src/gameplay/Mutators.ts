import type { Game, System } from '../core/Game';

export interface MutatorDef {
  id: string;
  name: string;
  desc: string;
  /** How to unlock it (shown while locked). */
  unlockHint: string;
  /** Mutators in the same group are mutually exclusive (e.g. 'hat', 'size'). */
  group?: string;
  apply(game: Game, on: boolean): void;
  /** Optional per-frame update while enabled. */
  update?(game: Game, dt: number): void;
}

export interface Mutator extends MutatorDef {
  unlocked: boolean;
  enabled: boolean;
}

const STORE_KEY = 'jimothy.mutators.v1';

/**
 * Goat-Sim-style mutators: unlocked by objectives (ObjectiveDef.reward = mutator id), toggled in the pause menu.
 * Emits 'mutatorUnlocked' { id, name } and 'mutator' { id, enabled }.
 */
export class MutatorSystem implements System {
  name = 'mutators';
  readonly list: Mutator[] = [];
  private byId = new Map<string, Mutator>();
  private saved: Record<string, { u: boolean; e: boolean }> = {};
  private game!: Game;
  /** Set true to unlock everything (dev / "I just want to play" toggle). */
  allUnlocked = false;
  /** Saved-as-enabled mutators, switched back on at the first frame (see register). */
  private pendingEnable: string[] = [];

  init(game: Game) {
    this.game = game;
    try {
      this.saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch {
      this.saved = {};
    }
  }

  register(def: MutatorDef): Mutator {
    const s = this.saved[def.id];
    const m: Mutator = { ...def, unlocked: s?.u ?? false, enabled: false };
    this.list.push(m);
    this.byId.set(m.id, m);
    // Re-enable after load. UX pass: deferred to the first frame (lateUpdate, which also runs on the title screen)
    // instead of a 0 ms timeout, so every system — including the UI, which restores the "I just want to play"
    // unlock-all setting — is initialised; otherwise mutators enabled via unlock-all silently switched off on reload.
    if (s?.e) this.pendingEnable.push(m.id);
    return m;
  }

  get(id: string) {
    return this.byId.get(id);
  }

  unlock(id: string) {
    const m = this.byId.get(id);
    if (!m || m.unlocked) return;
    m.unlocked = true;
    this.save();
    this.game.events.emit('mutatorUnlocked', { id: m.id, name: m.name, desc: m.desc });
    this.game.sfx('mutator_unlock');
  }

  setEnabled(id: string, on: boolean) {
    const m = this.byId.get(id);
    if (!m || (!m.unlocked && !this.allUnlocked) || m.enabled === on) return;
    if (on && m.group) for (const o of this.list) if (o !== m && o.group === m.group && o.enabled) this.setEnabled(o.id, false);
    m.enabled = on;
    try {
      m.apply(this.game, on);
    } catch (err) {
      console.error('[mutators] apply failed', id, err);
    }
    this.save();
    this.game.events.emit('mutator', { id, enabled: on, name: m.name });
  }

  toggle(id: string) {
    const m = this.byId.get(id);
    if (m) this.setEnabled(id, !m.enabled);
  }

  lateUpdate() {
    if (this.pendingEnable.length) {
      const ids = this.pendingEnable.splice(0);
      for (const id of ids) this.setEnabled(id, true); // no-op unless unlocked (or unlock-all is on)
    }
  }

  update(dt: number) {
    for (const m of this.list) if (m.enabled && m.update) m.update(this.game, dt);
  }

  private save() {
    const out: Record<string, { u: boolean; e: boolean }> = {};
    for (const m of this.list) out[m.id] = { u: m.unlocked, e: m.enabled };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch {
      /* ignore */
    }
  }
}
