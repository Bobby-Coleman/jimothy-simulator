import type { Game, System } from '../../core/Game';
import type { ExtrasFeature, ExtrasHost } from './host';
import { SignAtlas } from './shared';
import { CannonFeature, Flight } from './RaccoonCannon';
import { WheelRide } from './WheelRide';
import { CatFeature } from './Cats';
import { Finale } from './Finale';

/**
 * EXTRAS — fun bits and the finale, registered as `'extras'` (`game.get<ExtrasSystem>('extras')`).
 *
 * | Feature | Where | Trigger | Events |
 * |---|---|---|---|
 * | Jimothy Night Cannon | Tee-Hee Park outfield (POI `cannon:stadium`) | walk into the breech | `cannonLaunch`, `cannonLand` |
 * | Bay Blaster | Space Noodle deck, aimed at Salmon Bay (`cannon:noodle`) | walk into the breech | same |
 * | Pretty Good Wheel express gondola | bay side of the waterfront wheel (`wheelGondola`) | hop into the gondola | `wheelBoard`, `wheelTop`, `wheelRide` |
 * | Actual Cats (×3) | den alley fence, fish stall counter, stadium ticket booth (`cat:*`) | chitter near one / try to grab, bonk, wash | `catMet`, `catDeclined` |
 * | Finale "Jimothy Summer Forever" | the den, at night | heart arc done (mama + kits + danny) and Jimothy near the den; `?finale` | `finaleStart`, `finaleEnd` |
 *
 * Only one activity owns Jimothy at a time (`busy`). Everything is guarded: a failing feature logs and the rest keep
 * running. Test hooks: `extras.cannons.launch('stadium'|'noodle')`, `extras.wheel.board()`, `extras.cats.visit(i)`,
 * `extras.finale.start({ replay })`, `extras.finale.skip()`.
 */
export class ExtrasSystem implements System, ExtrasHost {
  name = 'extras';
  game!: Game;
  atlas!: SignAtlas;
  flight!: Flight;
  busy: string | null = null;
  cannons!: CannonFeature;
  wheel!: WheelRide;
  cats!: CatFeature;
  finale!: Finale;
  private features: ExtrasFeature[] = [];
  private errors = new Map<string, number>();

  async init(game: Game) {
    this.game = game;
    this.atlas = new SignAtlas();
    this.flight = new Flight(this);
    this.cannons = new CannonFeature(this);
    this.wheel = new WheelRide(this);
    this.cats = new CatFeature(this);
    this.finale = new Finale(this);
    this.features = [this.cannons, this.wheel, this.cats, this.finale];
    for (const f of this.features) {
      try {
        await f.init?.();
      } catch (err) {
        console.error(`[extras] "${f.id}" failed to init`, err);
      }
    }
  }

  claim(id: string): boolean {
    if (this.busy && this.busy !== id) return false;
    this.busy = id;
    return true;
  }

  release(id: string) {
    if (this.busy === id) this.busy = null;
  }

  /** End any cannon / wheel activity right now (the finale wants the stage). */
  abortActivities() {
    this.guard('cannons.abort', () => this.cannons.abort());
    this.guard('wheel.abort', () => this.wheel.abort());
    if (this.busy && this.busy !== 'finale') this.busy = null;
  }

  private guard(key: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      const n = (this.errors.get(key) ?? 0) + 1;
      this.errors.set(key, n);
      if (n <= 3) console.error(`[extras] ${key} failed`, err);
    }
  }

  update(dt: number) {
    for (const f of this.features) if (f.update) this.guard(`${f.id}.update`, () => f.update!(dt));
    const night = this.game.get<any>('environment')?.nightFactor ?? 0;
    this.atlas?.setNight(night);
  }

  postPhysics(dt: number) {
    for (const f of this.features) if (f.postPhysics) this.guard(`${f.id}.postPhysics`, () => f.postPhysics!(dt));
  }

  lateUpdate(dt: number) {
    for (const f of this.features) if (f.lateUpdate) this.guard(`${f.id}.lateUpdate`, () => f.lateUpdate!(dt));
  }
}
