import type { Game } from './core/Game';
import { Environment } from './world/Environment';
import { WaterSystem } from './world/Water';
import { World } from './world/World';
import { Jimothy } from './player/Jimothy';
import { CameraRig } from './player/CameraRig';
import { ScoreSystem } from './gameplay/Score';
import { ObjectivesSystem } from './gameplay/Objectives';
import { MutatorSystem } from './gameplay/Mutators';
import { MiniHud } from './ui/MiniHud';
import { registerZones } from './world/zones';

/**
 * Registration order = init order = update order.
 * Add new systems in the marked sections (one line each). Camera after player, UI last.
 */
export function registerSystems(game: Game) {
  // --- core world
  game.add(new Environment());
  game.add(new WaterSystem());
  game.add(new ScoreSystem());
  game.add(new ObjectivesSystem());
  game.add(new MutatorSystem());
  const world = game.add(new World());
  registerZones(world);

  // --- player
  game.add(new Jimothy());
  game.add(new CameraRig());

  // --- gameplay systems (NPCs, vehicles, items, quests, slop, ...)

  // --- presentation (audio, particles, UI) — keep last
  game.add(new MiniHud());
}
