/**
 * The sound bank: every sound key the game can play, and where its audio comes from.
 *
 *  - files:   CC0 recordings under public/assets/audio/sfx/ (Kenney packs, see CREDITS.md)
 *  - synth:   procedural recipes rendered at load time (src/audio/synth/recipes) — our own sounds
 *  - process: files decoded then transformed by a processor (e.g. voice lines -> glitchy AI slop)
 *
 * A key's variations = all its files + all synth variants + all processed files; one is picked at
 * random per play (never the same one twice in a row). src/audio/SOUNDS.md is generated from this
 * table by `node tools/audio/gen-sounds-md.mjs` — keep `desc` short and useful.
 *
 * No imports: this file is also read by the Node tools.
 */

export type SoundCategory = 'raccoon' | 'player' | 'impact' | 'water' | 'cartoon' | 'people' | 'world' | 'slop' | 'reward' | 'ui';

export interface LayerDef {
  /** Another sound key to trigger together with this one. */
  key: string;
  /** Seconds after the main sound. */
  delay?: number;
  /** Volume multiplier (relative to the main sound's volume). */
  volume?: number;
}

export interface SoundDef {
  desc: string;
  cat: SoundCategory;
  /** Files relative to assets/audio/sfx/. */
  files?: string[];
  /** Synth recipe name (all of its variants are used). */
  synth?: string;
  /** Files that are decoded and then transformed by a named processor. */
  process?: { files: string[]; with: string };
  /** Base volume (default 1). */
  volume?: number;
  /** Base playback rate (default 1). */
  pitch?: number;
  /** Default random pitch variation, ± fraction (default 0.05). */
  pitchVar?: number;
  /** Max simultaneous instances of this key (default 4). Oldest is cut when exceeded. */
  max?: number;
  /** Minimum seconds between two plays of this key (default 0.025). */
  minGap?: number;
  /** Loops until stopped. */
  loop?: boolean;
  /** Distance (m) within which a positional sound plays at full volume (default 4). */
  ref?: number;
  /** Beyond this distance (m) a positional sound is silent / culled (default 60). */
  maxDist?: number;
  /** Extra sounds triggered with this one (same position). */
  layers?: LayerDef[];
  /** Duck the music to this gain (0..1) while this sound plays. */
  duck?: number;
  /** UI sound: never positional, not muted by setWorldPaused(). */
  ui?: boolean;
  /** Keep stereo files stereo (default: downmix to mono, which pans better and halves memory). */
  stereo?: boolean;
}

/** 'impact/impactWood_heavy_' + 000..004 + '.ogg' */
const seq = (stem: string, from: number, to: number, pad = 3, ext = '.ogg'): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${stem}${String(from + i).padStart(pad, '0')}${ext}`);

export const SOUND_BANK: Record<string, SoundDef> = {
  // ------------------------------------------------------------------ Jimothy's voice (synth)
  chitter: { cat: 'raccoon', desc: 'Jimothy chitters: rapid raspy chirps (taunt, C key).', synth: 'chitter', volume: 0.9, pitchVar: 0.06, max: 2, minGap: 0.1 },
  trill: { cat: 'raccoon', desc: 'Warbling bird-like trill (curious / content).', synth: 'trill', volume: 0.8, max: 2 },
  purr: { cat: 'raccoon', desc: 'Low rolling churr/purr (being groomed by Mom, cozy).', synth: 'purr', volume: 0.85, max: 2 },
  hiss: { cat: 'raccoon', desc: 'Cute-grumpy hiss (startled, scolded, cornered).', synth: 'hiss', volume: 0.75, max: 2 },
  squeak: { cat: 'raccoon', desc: 'Squeak / "eek!" / squeal (hurt, surprised, launched).', synth: 'squeak', volume: 0.75, max: 3, minGap: 0.08 },
  happy: { cat: 'raccoon', desc: 'Happy rising chirps (got a snack, washed something, reunion).', synth: 'happy', volume: 0.8, max: 2 },
  kit_chirp: { cat: 'raccoon', desc: 'Tiny baby-raccoon peeps (lost kits, kits following in a line).', synth: 'kit_chirp', volume: 0.7, max: 5, minGap: 0.05 },
  munch: { cat: 'raccoon', desc: 'Crunchy snack chomps + contented chirp (eating food).', synth: 'munch', volume: 0.8, max: 2 },

  // ------------------------------------------------------------------ player movement
  footstep: { cat: 'player', desc: 'Soft little paw step (default surface). Fire per step.', files: seq('impact/footstep_carpet_', 0, 4), volume: 0.35, pitch: 1.3, pitchVar: 0.08, max: 4, minGap: 0.05, maxDist: 25 },
  footstep_grass: { cat: 'player', desc: 'Paw step on grass / dirt.', files: seq('impact/footstep_grass_', 0, 4), volume: 0.45, pitch: 1.25, pitchVar: 0.08, max: 4, minGap: 0.05, maxDist: 25 },
  footstep_wood: { cat: 'player', desc: 'Paw step on wood (docks, porches, decks).', files: seq('impact/footstep_wood_', 0, 4), volume: 0.35, pitch: 1.35, pitchVar: 0.08, max: 4, minGap: 0.05, maxDist: 25 },
  footstep_hard: { cat: 'player', desc: 'Shoe step on pavement (NPC humans).', files: seq('impact/footstep_concrete_', 0, 4), volume: 0.3, pitch: 1.05, pitchVar: 0.08, max: 6, minGap: 0.03, maxDist: 25 },
  jump: { cat: 'player', desc: 'Cartoon "bwip" jump.', synth: 'jump', volume: 0.5, max: 2 },
  land: { cat: 'player', desc: 'Soft thump when landing (volume ∝ fall height).', files: seq('impact/impactSoft_medium_', 0, 4), volume: 0.6, pitch: 1.1, max: 3 },
  land_heavy: { cat: 'player', desc: 'Heavy body thud (big falls, ragdolls hitting the ground).', files: seq('impact/impactSoft_heavy_', 0, 4), volume: 0.8, max: 4 },
  roll_loop: { cat: 'player', desc: 'LOOP: Tuck & Roll rumble. Drive setVolume/setPitch from speed.', synth: 'roll_loop', loop: true, volume: 0.7, pitchVar: 0, max: 2 },
  climb: { cat: 'player', desc: 'Claws scrabbling on bark/brick/poles while climbing.', synth: 'climb', volume: 0.6, max: 2 },
  flop: { cat: 'player', desc: 'Ragdoll "floomp" with a little bounce (Flop).', synth: 'flop', volume: 0.75, max: 3 },
  grab: { cat: 'player', desc: 'Grabby Hands: quick snatch / rustle.', files: ['rpg/cloth1.ogg', 'rpg/cloth2.ogg', 'rpg/cloth3.ogg'], volume: 0.6, pitch: 1.25, max: 3 },
  throw: { cat: 'player', desc: 'Short swoosh when throwing something.', synth: 'throw', volume: 0.7, max: 3 },
  steal: { cat: 'player', desc: '"Yoink!" slide whistle (stole a phone / sandwich).', synth: 'steal', volume: 0.8, max: 2 },
  bonk: { cat: 'player', desc: 'Hollow cartoon BONK (body slam / headbutt).', synth: 'bonk', volume: 0.9, max: 4 },
  whoosh: { cat: 'player', desc: 'Cartoon whoosh (lunges, things flying past, bonk wind-up).', synth: 'whoosh', volume: 0.6, max: 4 },

  // ------------------------------------------------------------------ impacts (Kenney)
  impact_light: { cat: 'impact', desc: 'Light generic knock (small props).', files: seq('impact/impactGeneric_light_', 0, 4), volume: 0.6, pitchVar: 0.1, max: 6 },
  impact_heavy: { cat: 'impact', desc: 'Heavy meaty thwack (big props, bowling people over).', files: seq('impact/impactPunch_heavy_', 0, 4), volume: 0.85, pitchVar: 0.08, max: 6 },
  impact_body: { cat: 'impact', desc: 'Body hit (NPC bowled over / ragdoll collisions).', files: seq('impact/impactPunch_medium_', 0, 4), volume: 0.75, pitchVar: 0.1, max: 6 },
  impact_metal: { cat: 'impact', desc: 'Metal clang (cars, poles, bins, signs).', files: [...seq('impact/impactMetal_medium_', 0, 4), ...seq('impact/impactMetal_heavy_', 0, 4)], volume: 0.7, pitchVar: 0.1, max: 6 },
  impact_metal_light: { cat: 'impact', desc: 'Small metal tink (cans, cutlery, keys).', files: seq('impact/impactMetal_light_', 0, 4), volume: 0.6, pitchVar: 0.1, max: 6 },
  impact_tin: { cat: 'impact', desc: 'Tin rattle (cans, lids).', files: seq('impact/impactTin_medium_', 0, 4), volume: 0.6, pitchVar: 0.1, max: 6 },
  impact_wood: { cat: 'impact', desc: 'Wood knock (crates, benches, fences).', files: [...seq('impact/impactWood_medium_', 0, 4), ...seq('impact/impactWood_heavy_', 0, 4)], volume: 0.7, pitchVar: 0.1, max: 6 },
  impact_glass: { cat: 'impact', desc: 'Glass bump without breaking.', files: seq('impact/impactGlass_light_', 0, 4), volume: 0.6, pitchVar: 0.08, max: 4 },
  impact_bell: { cat: 'impact', desc: 'Resonant bell/pole clang (bonking a lamppost or bell).', files: seq('impact/impactBell_heavy_', 0, 4), volume: 0.55, pitchVar: 0.06, max: 3 },
  trash_can: { cat: 'impact', desc: 'Metal trash can clattering over (+ tin rattle layer).', files: ['rpg/metalPot1.ogg', 'rpg/metalPot2.ogg', 'rpg/metalPot3.ogg'], volume: 0.8, pitch: 0.85, pitchVar: 0.08, max: 3, minGap: 0.06, layers: [{ key: 'impact_tin', delay: 0.09, volume: 0.6 }] },
  glass_break: { cat: 'impact', desc: 'Glass smash + tinkling shards.', files: seq('impact/impactGlass_heavy_', 0, 4), volume: 0.8, max: 3, layers: [{ key: 'glass_shards', delay: 0.02, volume: 0.7 }] },
  glass_shards: { cat: 'impact', desc: 'Tinkling glass fragments (layer of glass_break).', synth: 'glass_shards', volume: 0.7, max: 3 },
  explosion: { cat: 'impact', desc: 'Big explosion (propane tank, car) + low boom layer. Ducks music.', files: seq('scifi/explosionCrunch_', 0, 4), volume: 1, pitchVar: 0.06, max: 3, minGap: 0.08, ref: 10, maxDist: 160, duck: 0.55, layers: [{ key: 'explosion_low', volume: 0.9 }] },
  explosion_low: { cat: 'impact', desc: 'Low sub boom (layer of explosion).', files: seq('scifi/lowFrequency_explosion_', 0, 1), volume: 0.9, max: 3, ref: 12, maxDist: 180 },
  explosion_small: { cat: 'impact', desc: 'Punchy cartoon blast (small pops, fireworks misfire, SlopBot popping).', synth: 'explosion_small', volume: 0.9, max: 3, ref: 8, maxDist: 120 },

  // ------------------------------------------------------------------ water & washing (synth)
  splash: { cat: 'water', desc: 'Splash into water (Jimothy / props).', synth: 'splash', volume: 0.8, max: 4, minGap: 0.05 },
  splash_big: { cat: 'water', desc: 'Huge splash (big falls, cannonballs, cars into the bay).', synth: 'splash_big', volume: 1, max: 2, ref: 8, maxDist: 90 },
  wash_loop: { cat: 'water', desc: 'LOOP: bubbly washing/scrubbing while holding Wash.', synth: 'wash_loop', loop: true, volume: 0.7, pitchVar: 0, max: 2 },
  scrub: { cat: 'water', desc: 'Two or three brisk scrubs (wash progress ticks).', synth: 'scrub', volume: 0.7, max: 3 },
  bubble_pop: { cat: 'water', desc: 'Single bubble "plip" (sprinkle several while washing).', synth: 'bubble_pop', volume: 0.6, pitchVar: 0.15, max: 8, minGap: 0.02 },
  bubble_burst: { cat: 'water', desc: 'Giant soap bubble bursting (washed a soap bar).', synth: 'bubble_burst', volume: 0.8, max: 2 },
  fizz: { cat: 'water', desc: 'Sugar fizzing away (cotton candy dissolving; pair with sad_trombone).', synth: 'fizz', volume: 0.85, max: 2 },
  water_loop: { cat: 'water', desc: 'LOOP: gentle lapping water (bay, pond; pitch 1.3 for fountains).', synth: 'water_loop', loop: true, volume: 0.5, pitchVar: 0, max: 3, ref: 6, maxDist: 45 },

  // ------------------------------------------------------------------ cartoon
  boing: { cat: 'cartoon', desc: 'Spring "boiiing" (bounces, tuck into a ball).', synth: 'boing', volume: 0.7, max: 3 },
  sad_trombone: { cat: 'cartoon', desc: '"Wah wah wah waaah" (cotton candy washed away). Ducks music.', synth: 'sad_trombone', volume: 0.8, pitchVar: 0, max: 1, minGap: 1.5, duck: 0.45 },
  jingle_sad: { cat: 'cartoon', desc: 'Sad sax "wah wah wah waah" jingle (alt. failure sting).', files: ['jingles/jingles_SAX07.ogg'], volume: 0.8, pitchVar: 0, max: 1, stereo: true, duck: 0.5 },
  camera_shutter: { cat: 'cartoon', desc: 'Camera shutter / phone photo (fans filming Jimothy).', synth: 'camera_shutter', volume: 0.7, pitchVar: 0.08, max: 6, minGap: 0.04 },
  honk: { cat: 'cartoon', desc: 'Clown / bike bulb horn HONK (silly props, mascots).', synth: 'honk', volume: 0.8, max: 3 },
  sparkle: { cat: 'cartoon', desc: 'Shiny clean sparkle (item washed, collectible).', synth: 'sparkle', volume: 0.6, pitchVar: 0.03, max: 3 },
  cha_ching: { cat: 'cartoon', desc: 'Cash register "cha-ching" (MONEY LAUNDERING).', synth: 'cha_ching', volume: 0.8, pitchVar: 0, max: 2 },
  bat_crack: { cat: 'cartoon', desc: 'Baseball bat crack (Rookie mutator home-run bonk).', synth: 'bat_crack', volume: 1, max: 2 },
  rummage: { cat: 'cartoon', desc: 'Dumpster diving: crinkly bags, clinks, thumps.', synth: 'rummage', volume: 0.75, max: 2 },
  short_circuit: { cat: 'cartoon', desc: 'Sparky short circuit (washed a phone / electronics).', synth: 'short_circuit', volume: 0.8, max: 2 },
  creak: { cat: 'cartoon', desc: 'Wooden creak (dumpster lids, old doors, branches).', files: ['rpg/creak1.ogg', 'rpg/creak2.ogg', 'rpg/creak3.ogg'], volume: 0.6, max: 2 },
  door_open: { cat: 'cartoon', desc: 'Door opening.', files: ['rpg/doorOpen_1.ogg', 'rpg/doorOpen_2.ogg'], volume: 0.7, max: 2 },
  door_close: { cat: 'cartoon', desc: 'Door closing.', files: ['rpg/doorClose_1.ogg', 'rpg/doorClose_2.ogg', 'rpg/doorClose_3.ogg', 'rpg/doorClose_4.ogg'], volume: 0.7, max: 2 },
  coins: { cat: 'cartoon', desc: 'Handful of coins jingling (cash, tip jars).', files: ['rpg/handleCoins.ogg', 'rpg/handleCoins2.ogg'], volume: 0.7, max: 2 },

  // ------------------------------------------------------------------ people (synth formant voices)
  scream: { cat: 'people', desc: 'Cartoon "waaaah!" (PG): man / woman / kid / long falling / yelp.', synth: 'scream', volume: 0.75, max: 3, minGap: 0.25, maxDist: 80 },
  crowd_aww: { cat: 'people', desc: 'Crowd "awwww" (fans melt when Jimothy chitters).', synth: 'crowd_aww', volume: 0.8, pitchVar: 0.04, max: 2, minGap: 0.6, ref: 8, maxDist: 90 },
  crowd_ooh: { cat: 'people', desc: 'Impressed crowd "ooooh" (someone got launched).', synth: 'crowd_ooh', volume: 0.8, pitchVar: 0.04, max: 2, minGap: 0.6, ref: 8, maxDist: 90 },
  crowd_cheer: { cat: 'people', desc: 'Crowd cheer: yay / woo / hey + applause + whistles.', synth: 'crowd_cheer', volume: 0.9, pitchVar: 0.03, max: 2, minGap: 0.8, ref: 10, maxDist: 120 },
  crowd_laugh: { cat: 'people', desc: 'Crowd laughing "ha-ha-ha" (slapstick payoff).', synth: 'crowd_laugh', volume: 0.8, pitchVar: 0.04, max: 2, minGap: 0.8, ref: 8, maxDist: 90 },
  officer_whistle: { cat: 'people', desc: "Wildlife Officer's whistle (please don't approach Jimothy!).", synth: 'officer_whistle', volume: 0.8, pitchVar: 0.02, max: 2, minGap: 0.3, maxDist: 80 },

  // ------------------------------------------------------------------ world
  car_horn: { cat: 'world', desc: 'Car horn: single, "beep-beep", long angry.', synth: 'car_horn', volume: 0.9, pitchVar: 0.04, max: 3, ref: 6, maxDist: 110 },
  car_engine_loop: { cat: 'world', desc: 'LOOP: car engine; set pitch ~0.6-2.0 from speed.', synth: 'car_engine_loop', loop: true, volume: 0.6, pitchVar: 0.1, max: 8, ref: 5, maxDist: 50 },
  crow_caw: { cat: 'world', desc: 'Seattle crows: caw / caw-caw / caw-caw-caw.', synth: 'crow_caw', volume: 0.7, pitchVar: 0.05, max: 3, maxDist: 100 },
  seagull: { cat: 'world', desc: 'Seagull cries and laughs (waterfront, bay).', synth: 'seagull', volume: 0.7, pitchVar: 0.05, max: 3, maxDist: 110 },
  firework: { cat: 'world', desc: 'Firework: whistle up, boom, crackle (Jimothy Summer, stadium).', synth: 'firework', volume: 1, pitchVar: 0.05, max: 4, ref: 15, maxDist: 260 },
  server_hum_loop: { cat: 'world', desc: 'LOOP: SlopCorp data-center hum and fans.', synth: 'server_hum_loop', loop: true, volume: 0.6, pitchVar: 0, max: 2, ref: 6, maxDist: 40 },

  // ------------------------------------------------------------------ AI slop
  slop_glitch: { cat: 'slop', desc: 'Bitcrushed downward glitch sweep (slop appears / flickers / gets bonked).', synth: 'slop_glitch', volume: 0.7, pitchVar: 0.08, max: 4 },
  dissolve: { cat: 'slop', desc: 'Slopothy washed away: uncanny chord pixelates and fizzes out.', synth: 'dissolve', volume: 0.8, pitchVar: 0.04, max: 3 },
  slop_voice: {
    cat: 'slop',
    desc: 'Slopothy / SlopBot "speech": robot babble and glitched "Congratulations!"/"Correct!" lines.',
    synth: 'slop_babble',
    process: { files: ['voice/male_congratulations.ogg', 'voice/female_congratulations.ogg', 'voice/male_correct.ogg', 'voice/female_correct.ogg', 'voice/male_power_up.ogg'], with: 'slopify' },
    volume: 0.8,
    pitchVar: 0.04,
    max: 2,
    minGap: 0.3,
  },
  ui_glitch: { cat: 'slop', desc: 'Tiny digital glitch tick (SlopBot popups, slop UI).', files: seq('interface/glitch_', 1, 4), volume: 0.5, pitchVar: 0.1, ui: true, max: 4 },

  // ------------------------------------------------------------------ rewards
  coin: { cat: 'reward', desc: 'Coin / collectible pickup ("ba-ding").', synth: 'coin', volume: 0.6, pitchVar: 0.02, max: 4, minGap: 0.04 },
  score: { cat: 'reward', desc: 'Subtle score plink (score popups; pitch up with combo).', synth: 'score', volume: 0.4, pitchVar: 0.02, max: 3, minGap: 0.06, ui: true },
  combo_up: { cat: 'reward', desc: 'Rising combo arpeggio (multiplier went up).', synth: 'combo_up', volume: 0.6, pitchVar: 0, max: 2, ui: true },
  objective_complete: { cat: 'reward', desc: 'Triumphant "ta-da-da-DAAA" fanfare. Ducks music.', synth: 'fanfare', volume: 0.9, pitchVar: 0, max: 1, minGap: 0.8, duck: 0.3, ui: true },
  mutator_unlock: { cat: 'reward', desc: 'Magical rising steel-drum run + sparkles (mutator unlocked). Ducks music.', files: ['jingles/jingles_STEEL02.ogg'], volume: 0.8, pitchVar: 0, max: 1, stereo: true, duck: 0.4, ui: true, layers: [{ key: 'sparkle', delay: 0.12, volume: 0.6 }] },
  jingle_win: { cat: 'reward', desc: 'Short positive jingle (mini success, quest step).', files: ['jingles/jingles_NES12.ogg', 'jingles/jingles_SAX02.ogg', 'jingles/jingles_STEEL10.ogg', 'jingles/jingles_PIZZI10.ogg'], volume: 0.7, pitchVar: 0, max: 1, stereo: true, duck: 0.5, ui: true },
  jingle_fail: { cat: 'reward', desc: 'Short descending "fail" jingle.', files: ['jingles/jingles_PIZZI01.ogg', 'jingles/jingles_STEEL01.ogg'], volume: 0.7, pitchVar: 0, max: 1, stereo: true, duck: 0.5, ui: true },

  // ------------------------------------------------------------------ UI (Kenney Interface Sounds)
  ui_click: { cat: 'ui', desc: 'Button click.', files: ['interface/select_001.ogg', 'interface/select_002.ogg'], volume: 0.5, pitchVar: 0.02, ui: true },
  ui_hover: { cat: 'ui', desc: 'Button hover / focus tick.', files: ['interface/tick_001.ogg', 'interface/tick_002.ogg'], volume: 0.3, pitchVar: 0.04, ui: true, minGap: 0.04 },
  ui_back: { cat: 'ui', desc: 'Back / cancel.', files: ['interface/back_002.ogg', 'interface/back_004.ogg'], volume: 0.5, pitchVar: 0.02, ui: true },
  ui_open: { cat: 'ui', desc: 'Menu / panel open.', files: ['interface/open_001.ogg'], volume: 0.5, pitchVar: 0.02, ui: true },
  ui_close: { cat: 'ui', desc: 'Menu / panel close.', files: ['interface/close_001.ogg'], volume: 0.5, pitchVar: 0.02, ui: true },
  ui_confirm: { cat: 'ui', desc: 'Confirm / toggle on / purchase.', files: ['interface/confirmation_001.ogg'], volume: 0.5, pitchVar: 0, ui: true },
  ui_error: { cat: 'ui', desc: 'Not allowed / error.', files: ['interface/error_008.ogg'], volume: 0.5, pitchVar: 0, ui: true },
  ui_toggle: { cat: 'ui', desc: 'Switch / checkbox toggle.', files: ['interface/toggle_001.ogg', 'interface/toggle_002.ogg'], volume: 0.5, pitchVar: 0.02, ui: true },
};

export type MusicTrack = 'day' | 'night' | 'slop' | 'title';

/** A link shown next to a track's author (title music player, credits). */
export interface MusicLink {
  label: string;
  url: string;
}

export interface MusicFile {
  /** Relative to assets/audio/music/. */
  file: string;
  /** Loudness normalization gain (measured: gated RMS -> ~-20 dBFS, peak-limited). */
  gain: number;
  title: string;
  author: string;
  /** The track's OpenGameArt page. */
  page?: string;
  /** Author profile link(s); the first is the main one. */
  links?: MusicLink[];
}

export interface MusicDef {
  desc: string;
  /** Playlist: plays through, then the next (a single file loops). */
  files: MusicFile[];
  /** Theme volume multiplier. */
  volume: number;
}

const OGA = 'https://opengameart.org';
const oga = (slug: string) => `${OGA}/content/${slug}`;
const user = (label: string, name: string): MusicLink => ({ label, url: `${OGA}/users/${name}` });

/** Every music file the game ships (CREDITS.md). Author links are the "Author" field of each OGA page. */
const T = {
  bounce: { file: 'respectable_bounce.ogg', gain: 2.3, title: 'A respectable amount of Bounce', author: 'Some Weirdo', page: oga('a-respectable-amount-of-bounce'), links: [user('Some Weirdo', 'some-weirdo')] },
  banana: { file: 'banana_track.ogg', gain: 0.59, title: 'Banana Track', author: 'skrjablin', page: oga('banana-track'), links: [user('skrjablin', 'skrjablin')] },
  workings: { file: 'wacky_workings.ogg', gain: 0.76, title: 'Wacky Workings', author: 'Fupi', page: oga('wacky-workings'), links: [user('Fupi', 'fupi')] },
  garden: { file: 'trouble_in_the_garden.ogg', gain: 2.1, title: 'Trouble in the Garden', author: 'HaelDB', page: oga('trouble-in-the-garden'), links: [user('HaelDB', 'haeldb')] },
  wobblings: { file: 'wacky_wobblings.ogg', gain: 0.72, title: 'Wacky Wobblings', author: 'Fupi', page: oga('wacky-wobblings'), links: [user('Fupi', 'fupi')] },
  lofi: {
    file: 'chill_lofi_loop.ogg',
    gain: 0.72,
    title: 'Chill lofi inspired (loop edit)',
    author: 'omfgdude, loop edit by qubodup',
    page: oga('chill-lofi-inspired-loop-edit'),
    links: [user('omfgdude', 'omfgdude'), user('qubodup', 'qubodup')],
  },
  napping: { file: 'napping_on_a_cloud.ogg', gain: 0.4, title: 'Napping on a Cloud', author: 'congusbongus', page: oga('napping-on-a-cloud'), links: [user('congusbongus', 'congusbongus')] },
  aiContact: { file: 'ai_contact.mp3', gain: 0.31, title: 'Ai Contact', author: 'Of Far Different Nature', page: oga('ai-contact'), links: [user('Of Far Different Nature', 'of-far-different-nature')] },
  dialup: { file: 'dialup_song.ogg', gain: 0.61, title: 'Dialup Song', author: 'Fupi', page: oga('dialup-song'), links: [user('Fupi', 'fupi')] },
} satisfies Record<string, MusicFile>;

/** The same file with a theme volume folded into its gain (so the title playlist matches in-game loudness). */
const at = (f: MusicFile, volume: number): MusicFile => ({ ...f, gain: +(f.gain * volume).toFixed(3) });

export const MUSIC_BANK: Record<MusicTrack, MusicDef> = {
  title: {
    desc: 'Title screen music player: every track, upbeat first (the player picks; prev / play-pause / next).',
    volume: 1,
    files: [T.workings, T.banana, T.garden, T.wobblings, T.bounce, at(T.dialup, 0.9), at(T.aiContact, 0.9), at(T.lofi, 0.85), at(T.napping, 0.85)],
  },
  day: {
    desc: 'Daytime free-roam: jaunty, silly, a little dumb.',
    volume: 1,
    files: [T.banana, T.workings, T.garden, T.wobblings],
  },
  night: {
    desc: 'Night: chill lo-fi / sleepy chiptune (raccoon hours).',
    volume: 0.85,
    files: [T.lofi, T.napping],
  },
  slop: {
    desc: 'SlopCorp campus: glitchy talking-synth wubs and dial-up modem jams.',
    volume: 0.9,
    files: [T.aiContact, T.dialup],
  },
};

/** Every distinct music file, in title-playlist order (credits). */
export const MUSIC_FILES: MusicFile[] = [T.workings, T.banana, T.garden, T.wobblings, T.bounce, T.dialup, T.aiContact, T.lofi, T.napping];
