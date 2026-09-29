import type { Game } from './core/Game';
import { Environment } from './world/Environment';
import { WaterSystem } from './world/Water';
import { WeatherSystem } from './world/Weather';
import { World } from './world/World';
import { Horizon } from './world/Horizon';
import { Jimothy } from './player/Jimothy';
import { CameraRig } from './player/CameraRig';
import { ScoreSystem } from './gameplay/Score';
import { ObjectivesSystem } from './gameplay/Objectives';
import { MutatorSystem } from './gameplay/Mutators';
import { UI } from './ui/UI';
import { NearHints } from './ui/NearHints';
import { registerZones } from './world/zones';
import { VehicleSystem } from './entities/vehicles/Vehicles';
import { SlowMoSystem } from './gameplay/SlowMo';
import { DebugStats } from './core/DebugStats';
import { PhotoModeSystem } from './gameplay/PhotoMode';
import { MapSystem } from './gameplay/MapSystem';
import { NewsTicker } from './ui/NewsTicker';
import { Janitor } from './gameplay/Janitor';
import { CutsceneTidy } from './gameplay/CutsceneTidy';
import { StaticBatcher } from './world/StaticBatcher';
import { DetailCuller } from './world/DetailCuller';
import { AutoQuality } from './core/AutoQuality';
import { AudioSystem } from './audio/AudioSystem';
import { FxSystem } from './fx/FX';
import { ItemsSystem, ImpactSystem } from './gameplay/items';
import { SouthSystem } from './world/zones/south';
import { ObjectiveContent } from './gameplay/content/ObjectiveContent';
import { MutatorContent } from './gameplay/mutators/MutatorContent';
import { Collectibles } from './gameplay/Collectibles';
import { LandmarkSystem } from './gameplay/quests/landmarks';
import { NpcSystem } from './entities/npc/NpcSystem';
import { TrampolineSystem } from './world/zones/north';
import { SlopSystem } from './gameplay/slop/SlopSystem';
import { AnimalSystem } from './entities/animals';
import { HeartQuestSystem } from './gameplay/quests/heart';
import { ExtrasSystem } from './gameplay/extras';
import { ChaosSystem } from './gameplay/chaos';

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
  game.add(new Horizon());
  registerZones(world);

  // --- player
  game.add(new Jimothy());
  game.add(new CameraRig());

  // --- gameplay systems (NPCs, vehicles, items, quests, slop, ...)
  game.add(new NpcSystem());
  game.add(new VehicleSystem());
  game.add(new SlowMoSystem());
  game.add(new Janitor());
  game.add(new CutsceneTidy());
  game.add(new PhotoModeSystem());
  game.add(new SouthSystem());
  game.add(new ObjectiveContent());
  game.add(new MutatorContent());
  game.add(new Collectibles());
  game.add(new LandmarkSystem());
  game.add(new TrampolineSystem());
  game.add(new SlopSystem());
  game.add(new AnimalSystem());
  game.add(new HeartQuestSystem());
  game.add(new ItemsSystem());
  game.add(new ImpactSystem());
  game.add(new ExtrasSystem());
  game.add(new ChaosSystem());

  // --- presentation (audio, particles, UI) — keep last
  game.add(new AudioSystem());
  game.add(new FxSystem());
  game.add(new UI());
  game.add(new NearHints());
  game.add(new MapSystem());
  game.add(new NewsTicker());
  game.add(new DebugStats());
  game.add(new StaticBatcher());
  game.add(new DetailCuller());
  game.add(new AutoQuality());
}
