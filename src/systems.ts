import type { Game } from './core/Game';
import { Environment } from './world/Environment';
import { WaterSystem } from './world/Water';
import { WeatherSystem } from './world/Weather';
import { World } from './world/World';
import { Jimothy } from './player/Jimothy';
import { CameraRig } from './player/CameraRig';
import { ScoreSystem } from './gameplay/Score';
import { ObjectivesSystem } from './gameplay/Objectives';
import { MutatorSystem } from './gameplay/Mutators';
import { UI } from './ui/UI';
import { registerZones } from './world/zones';
import { VehicleSystem } from './entities/vehicles/Vehicles';
import { SlowMoSystem } from './gameplay/SlowMo';
import { DebugStats } from './core/DebugStats';
import { PhotoModeSystem } from './gameplay/PhotoMode';
import { MapSystem } from './gameplay/MapSystem';
import { AudioSystem } from './audio/AudioSystem';
import { FxSystem } from './fx/FX';
import { SouthSystem } from './world/zones/south';
import { ObjectiveContent } from './gameplay/content/ObjectiveContent';
import { MutatorContent } from './gameplay/mutators/MutatorContent';
import { Collectibles } from './gameplay/Collectibles';
import { LandmarkSystem } from './gameplay/quests/landmarks';
import { NpcSystem } from './entities/npc/NpcSystem';
import { TrampolineSystem } from './world/zones/north';
import { SlopSystem } from './gameplay/slop/SlopSystem';

/**
 * Registration order = init order = update order.
 * Add new systems in the marked sections (one line each). Camera after player, UI last.
 */
export function registerSystems(game: Game) {
  // --- core world
  game.add(new Environment());
  game.add(new WaterSystem());
  game.add(new WeatherSystem());
  game.add(new ScoreSystem());
  game.add(new ObjectivesSystem());
  game.add(new MutatorSystem());
  const world = game.add(new World());
  registerZones(world);

  // --- player
  game.add(new Jimothy());
  game.add(new CameraRig());

  // --- gameplay systems (NPCs, vehicles, items, quests, slop, ...)
  game.add(new NpcSystem());
  game.add(new VehicleSystem());
  game.add(new SlowMoSystem());
  game.add(new PhotoModeSystem());
  game.add(new SouthSystem());
  game.add(new ObjectiveContent());
  game.add(new MutatorContent());
  game.add(new Collectibles());
  game.add(new LandmarkSystem());
  game.add(new TrampolineSystem());
  game.add(new SlopSystem());

  // --- presentation (audio, particles, UI) — keep last
  game.add(new AudioSystem());
  game.add(new FxSystem());
  game.add(new UI());
  game.add(new MapSystem());
  game.add(new DebugStats());
}
