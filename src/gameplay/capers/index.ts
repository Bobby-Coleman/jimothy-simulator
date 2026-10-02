import type { Game, System } from '../../core/Game';
import type { CaperFeature } from './shared';
import { ThroneFeature } from './trash/Throne';
import { BuffetFeature } from './trash/Buffet';
import { TreasureFeature } from './trash/Treasure';
import { GlyphsFeature } from './trash/Glyphs';
import { BoardFeature } from './trash/Board';
import { UfoFeature } from './aliens/Ufo';
import { HeistFeature } from './heist';

/**
 * CAPERS — bigger missions and secrets added after launch, registered as `'capers'` (`game.get<CapersSystem>('capers')`).
 *
 * | Caper | Where | Trigger | Events |
 * |---|---|---|---|
 * | Alien Landing / Trash Diplomacy (`ufo`) | a saucer lands every ~8–10 min (first ~4 min) on the lawn by the Locks, Gasworks-ish Park, the waterfront lawn or the Tee-Hee outfield (POI `ufo`) | drop 3 trash/food items by the ramp → joyride to the Space Noodle | ufoArrive, ufoLand, alienTrade, ufoGift, ufoJoyride, ufoLeave, ufoAbduct |
 * | Trash King's Throne (`throne`) | alley behind the Old Ballard Ave shops, west of the den | drop 10 trash/food items in the ring, sit | throneTribute, throneComplete, trashKingCrowned |
 * | Midnight Buffet (`buffet`) | 6 backyard bins behind the Tumble St houses, Residential Hills (POI `midnightBuffet`) | at night, raid all 6 glowing gourmet bags in one night | buffetRaid, buffetComplete |
 * | Treasure Map (`treasure`) | scraps from dumpster dives; the X on top of Kite Hill (POI `treasureX` once assembled) | 3 scraps → dig the mound → chest + Remote Control of Destiny | treasureScrap, treasureMap, treasureDug, remoteOfDestiny |
 * | Ancient Raccoon Glyphs (`glyphs`, secret) | 7 hidden tablets (rooftop, under the boardwalk, behind the scoreboard, Crow Tree, fish viewing room, data-center roof, Library buttress) | touch all 7 → golden aura + golden stash behind the den | glyphFound, glyphsComplete |
 * | Raccoon Bulletin Board (`board`) | the alley by the den (POI `raccoonBoard`) | hints + progress for the four trash capers | — |
 * | The Shiny Job (`heist`) | Ballard Museum of Extremely Shiny Things, waterfront lawn west of Pike's Plaice (POI `museumHeist`) | sneak in (vent / skylight), lasers, lift the Golden Trash Can Lid → carry it to Mom's den in 75 s | heistAlarm, heistComplete, heistCaught |
 *
 * Each caper registers its own Instincts in init (`addObjective`). Everything is guarded: a failing caper logs and
 * the rest keep running. Test hooks are documented on each caper.
 */
export class CapersSystem implements System {
  name = 'capers';
  game!: Game;
  /** Every caper by id (`capers.byId.get('ufo')`). */
  readonly byId = new Map<string, CaperFeature>();
  private features: CaperFeature[] = [];
  private errors = new Map<string, number>();

  async init(game: Game) {
    this.game = game;
    // --- capers (one line each)
    this.features.push(new ThroneFeature(game));
    this.features.push(new BuffetFeature(game));
    this.features.push(new TreasureFeature(game));
    this.features.push(new GlyphsFeature(game));
    this.features.push(new BoardFeature(game));
    this.features.push(new UfoFeature(game));
    this.features.push(new HeistFeature(game));
    for (const f of this.features) {
      this.byId.set(f.id, f);
      try {
        await f.init?.();
      } catch (err) {
        console.error(`[capers] "${f.id}" failed to init`, err);
      }
    }
  }

  private guard(key: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      const n = (this.errors.get(key) ?? 0) + 1;
      this.errors.set(key, n);
      if (n <= 3) console.error(`[capers] ${key} failed`, err);
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
