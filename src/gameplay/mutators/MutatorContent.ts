import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { MutatorSystem } from '../Mutators';
import { loadAccessories, accessoryDebug } from './accessories';
import { honoraryGrad, rookie, grandmaHat } from './hats';
import { jimothySummer } from './summer';
import { aiEnhanced } from './ai';
import { chonk, tiny } from './size';
import { crowRider } from './crowRider';
import { spaceJimothy, wetJimothy, bobblehead, zoomies, perfectlySpherical } from './body';
import { updateSharedFx } from './shared';
import { getPlayer, type ModelMods, type MutatorImpl } from './types';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Registers every mutator implementation with the MutatorSystem ('mutators') and drives their per-frame hooks.
 * Registered in the gameplay section (after the player), so:
 *  - update()      runs after Jimothy's controller → velocity tweaks (glide) stick for this physics step
 *  - postPhysics() runs after Jimothy's visual sync/animation → we can layer scale/lift/wobble on top
 * Every mutator fully reverts in disable(); model tweaks are re-derived every frame from the model's base pose.
 */
export class MutatorContent implements System {
  name = 'mutatorContent';
  readonly impls: MutatorImpl[] = [];
  private active = new Set<MutatorImpl>();
  private game!: Game;
  private mods: ModelMods = { scale: new THREE.Vector3(1, 1, 1), offset: new THREE.Vector3(), rot: new THREE.Vector3(), lift: 0 };
  private base = new WeakMap<THREE.Object3D, { pos: THREE.Vector3; scale: THREE.Vector3; quat: THREE.Quaternion }>();
  private touched: THREE.Object3D | null = null;
  private errors = new Map<string, number>();

  init(game: Game) {
    this.game = game;
    loadAccessories(game);
    game.debug.accessories = accessoryDebug;
    this.impls.push(
      honoraryGrad(),
      jimothySummer(),
      rookie(),
      aiEnhanced(),
      chonk(),
      crowRider(),
      spaceJimothy(),
      wetJimothy(),
      grandmaHat(),
      bobblehead(),
      tiny(),
      zoomies(),
      perfectlySpherical(),
    );
    const reg = game.get<MutatorSystem>('mutators');
    if (!reg) return;
    for (const impl of this.impls) {
      if (reg.get(impl.def.id)) continue;
      reg.register({ ...impl.def, apply: (_g, on) => this.setActive(impl, on) });
    }
  }

  isActive(id: string) {
    for (const i of this.active) if (i.def.id === id) return true;
    return false;
  }

  private setActive(impl: MutatorImpl, on: boolean) {
    if (on === this.active.has(impl)) return;
    if (on) {
      this.active.add(impl);
      impl.enable(this.game);
    } else {
      this.active.delete(impl);
      impl.disable(this.game);
    }
  }

  private guard(impl: MutatorImpl, hook: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      const key = impl.def.id + '.' + hook;
      const n = (this.errors.get(key) ?? 0) + 1;
      this.errors.set(key, n);
      if (n <= 2) console.error(`[mutators] ${key} failed`, err);
    }
  }

  update(dt: number) {
    for (const impl of this.active) if (impl.update) this.guard(impl, 'update', () => impl.update!(this.game, dt));
  }

  postPhysics(dt: number) {
    const game = this.game;
    const m = this.mods;
    m.scale.set(1, 1, 1);
    m.offset.set(0, 0, 0);
    m.rot.set(0, 0, 0);
    m.lift = 0;
    for (const impl of this.active) if (impl.post) this.guard(impl, 'post', () => impl.post!(game, dt, m));
    updateSharedFx(game, dt);

    const p = getPlayer(game);
    const child = p?.model.pivot.children[0];
    if (!p || !child) return;
    const any = this.active.size > 0;
    if (!any && this.touched !== child) return;
    let b = this.base.get(child);
    if (!b) {
      b = { pos: child.position.clone(), scale: child.scale.clone(), quat: child.quaternion.clone() };
      this.base.set(child, b);
    }
    child.position.copy(b.pos).add(m.offset);
    child.scale.copy(b.scale).multiply(m.scale);
    child.quaternion.copy(b.quat);
    if (m.rot.x || m.rot.y || m.rot.z) child.quaternion.multiply(_q.setFromEuler(_e.set(m.rot.x, m.rot.y, m.rot.z)));
    if (m.lift) p.model.pivot.position.y += m.lift / Math.max(0.05, p.sizeMul);
    this.touched = any ? child : null;
  }
}
