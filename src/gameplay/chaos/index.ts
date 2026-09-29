import type { Game, System } from '../../core/Game';
import type { ChaosFeature } from './shared';
import { HydrantFeature } from './Hydrants';
import { CarAlarmFeature } from './CarAlarms';
import { EspressoFeature } from './Espresso';
import { TourGroupFeature } from './TourGroup';

/**
 * CHAOS TOYS — emergent slapstick scattered around town, registered as `'chaos'` (`game.get<ChaosSystem>('chaos')`).
 *
 * | Toy | Where | Trigger | Events |
 * |---|---|---|---|
 * | Hydrant geysers (all 21 fire hydrants) | avenue sidewalks; 3 on Ballard Ave by spawn (POI `hydrant`) | bonk / roll into / hit with anything fast / explosion | `hydrantBurst`, `hydrantWash` |
 * | Car alarms (25 parked cars) | Ballard Ave parking strips + the Old Ballard parking lot (POI `parkedCars`) | bonk / land on the roof / roll into / thrown props / explosions / hydrant spray | `carAlarm` |
 * | Bean Me Up Espresso → Espresso Mode | Old Ballard parking lot behind the den (POI `espressoStand`) | grab a Triple-Shot cup (auto-chug); Chitter to chug any other coffee | `espresso`, `espressoEnd` |
 * | Walking-tour bowling | foot of the Space Noodle (POI `tourGroup`) | Tuck & Roll into the 8 tourists + guide (4+ down; all = PERFECT GAME) | `tourStrike` |
 *
 * Objectives: hydrantHydraulics, carAlarmChoir, tripleShot, tourStrike. Everything is guarded: a failing toy logs and
 * the rest keep running. Test hooks: `chaos.hydrants.burst(i)` / `.visit(i)`, `chaos.carAlarms.trigger(i)` / `.visit(i)`,
 * `chaos.espresso.visit()` / `.chug()`, `chaos.tour.lineUp(dist)`.
 */
export class ChaosSystem implements System {
  name = 'chaos';
  game!: Game;
  hydrants!: HydrantFeature;
  carAlarms!: CarAlarmFeature;
  espresso!: EspressoFeature;
  tour!: TourGroupFeature;
  private features: ChaosFeature[] = [];
  private errors = new Map<string, number>();

  async init(game: Game) {
    this.game = game;
    this.hydrants = new HydrantFeature(game);
    this.carAlarms = new CarAlarmFeature(game);
    this.espresso = new EspressoFeature(game);
    this.tour = new TourGroupFeature(game);
    this.features = [this.hydrants, this.carAlarms, this.espresso, this.tour];
    for (const f of this.features) {
      try {
        await f.init?.();
      } catch (err) {
        console.error(`[chaos] "${f.id}" failed to init`, err);
      }
    }
  }

  private guard(key: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      const n = (this.errors.get(key) ?? 0) + 1;
      this.errors.set(key, n);
      if (n <= 3) console.error(`[chaos] ${key} failed`, err);
    }
  }

  update(dt: number) {
    for (const f of this.features) if (f.update) this.guard(`${f.id}.update`, () => f.update!(dt));
  }

  postPhysics(dt: number) {
    for (const f of this.features) if (f.postPhysics) this.guard(`${f.id}.postPhysics`, () => f.postPhysics!(dt));
  }

  lateUpdate(dt: number) {
    for (const f of this.features) if (f.lateUpdate) this.guard(`${f.id}.lateUpdate`, () => f.lateUpdate!(dt));
  }
}
