/**
 * Registry of every procedural sound recipe, by name. The sound bank (../../soundBank.ts)
 * refers to these names. Rendering is deterministic: (name, variant) always gives the same audio.
 */
import type { Rendered } from '../dsp';
import type { Recipe } from '../recipe';
import * as cartoon from './cartoon';
import * as jingles from './jingles';
import * as people from './people';
import * as raccoon from './raccoon';
import * as slop from './slop';
import * as water from './water';
import * as world from './world';

export const RECIPES: Record<string, Recipe> = {
  // raccoon voice
  chitter: raccoon.chitter,
  trill: raccoon.trill,
  purr: raccoon.purr,
  hiss: raccoon.hiss,
  squeak: raccoon.squeak,
  happy: raccoon.happy,
  kit_chirp: raccoon.kit_chirp,
  munch: raccoon.munch,
  // water & washing
  bubble_pop: water.bubble_pop,
  bubble_burst: water.bubble_burst,
  splash: water.splash,
  splash_big: water.splash_big,
  scrub: water.scrub,
  wash_loop: water.wash_loop,
  water_loop: water.water_loop,
  fizz: water.fizz,
  roll_loop: water.roll_loop,
  // cartoon / slapstick
  whoosh: cartoon.whoosh,
  throw: cartoon.throw_,
  boing: cartoon.boing,
  jump: cartoon.jump,
  bonk: cartoon.bonk,
  bat_crack: cartoon.bat_crack,
  flop: cartoon.flop,
  steal: cartoon.steal,
  climb: cartoon.climb,
  rummage: cartoon.rummage,
  sad_trombone: cartoon.sad_trombone,
  camera_shutter: cartoon.camera_shutter,
  honk: cartoon.honk,
  glass_shards: cartoon.glass_shards,
  sparkle: cartoon.sparkle,
  cha_ching: cartoon.cha_ching,
  // world
  car_horn: world.car_horn,
  car_engine_loop: world.car_engine_loop,
  explosion_small: world.explosion_small,
  firework: world.firework,
  crow_caw: world.crow_caw,
  seagull: world.seagull,
  short_circuit: world.short_circuit,
  server_hum_loop: world.server_hum_loop,
  officer_whistle: world.officer_whistle,
  // people
  scream: people.scream,
  crowd_aww: people.crowd_aww,
  crowd_ooh: people.crowd_ooh,
  crowd_cheer: people.crowd_cheer,
  crowd_laugh: people.crowd_laugh,
  // AI slop
  slop_glitch: slop.slop_glitch,
  dissolve: slop.dissolve,
  slop_babble: slop.slop_babble,
  // rewards
  coin: jingles.coin,
  score: jingles.score,
  combo_up: jingles.combo_up,
  fanfare: jingles.fanfare,
};

/** Named processors that transform decoded audio files (e.g. voice lines -> AI slop voice). */
export const PROCESSORS: Record<string, (channels: Float32Array[], sr: number, seed: number) => Float32Array> = {
  slopify: slop.slopify,
};

export function hasRecipe(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECIPES, name);
}

/** Renders one variation of a recipe. Throws on unknown names (callers catch). */
export function renderRecipe(name: string, variant: number): { data: Rendered; sr: number; loop: boolean } {
  const rec = RECIPES[name];
  if (!rec) throw new Error(`unknown synth recipe "${name}"`);
  const v = ((variant % rec.variants) + rec.variants) % rec.variants;
  return { data: rec.render(v, rec.sr), sr: rec.sr, loop: !!rec.loop };
}
