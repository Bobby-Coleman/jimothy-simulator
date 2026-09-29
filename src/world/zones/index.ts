import type { World } from '../World';
import { CentralRoads } from './central/Roads';
import { OldBallard } from './central/OldBallard';
import { ParkZone } from './south';
import { ResidentialHills } from './north';

/** Register every zone builder (one line each). */
export function registerZones(world: World) {
  world.addZone(CentralRoads);
  world.addZone(OldBallard);
  world.addZone(ParkZone);
  world.addZone(ResidentialHills);
}
