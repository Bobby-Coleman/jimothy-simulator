import type { World } from '../World';
import { CentralRoads } from './central/Roads';
import { OldBallard } from './central/OldBallard';
import { Downtown } from './central/Downtown';
import { ParkZone, LocksZone, WaterfrontZone, StadiumZone } from './south';
import { ResidentialHills, UniversityOfWashing } from './north';

/** Register every zone builder (one line each). */
export function registerZones(world: World) {
  world.addZone(CentralRoads);
  world.addZone(OldBallard);
  world.addZone(Downtown);
  world.addZone(ParkZone);
  world.addZone(LocksZone);
  world.addZone(WaterfrontZone);
  world.addZone(StadiumZone);
  world.addZone(ResidentialHills);
  world.addZone(UniversityOfWashing);
}
