import type { Game } from './core/Game';
import { Environment } from './world/Environment';
import { WaterSystem } from './world/Water';
import { World } from './world/World';
import { Jimothy } from './player/Jimothy';
import { CameraRig } from './player/CameraRig';
import { ScoreSystem } from './gameplay/Score';
import { MiniHud } from './ui/MiniHud';
import { registerZones } from './world/zones';

/**
 * Registration order = init order = update order.
 * Add new systems here (one line each). Keep the camera after the player and UI last.
 */
export function registerSystems(game: Game) {
  game.add(new Environment());
  game.add(new WaterSystem());
  const world = game.add(new World());
  registerZones(world);
  game.add(new Jimothy());
  game.add(new CameraRig());
  game.add(new ScoreSystem());
  game.add(new MiniHud());
}
