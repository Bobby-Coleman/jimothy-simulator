import type { World } from '../World';
import { DevPlayground } from './DevPlayground';

/** Register every zone builder (one line each). */
export function registerZones(world: World) {
  world.addZone(DevPlayground);
}
