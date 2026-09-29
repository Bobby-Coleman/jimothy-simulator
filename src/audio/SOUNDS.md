# Sound keys

> **Generated** from `src/audio/soundBank.ts` by `node tools/audio/gen-sounds-md.mjs` — edit the bank, then regenerate.
> 91 keys. Test them all at **/audio-test.html** (dev server).

## How to play sounds

* Gameplay code: `game.sfx('bonk', position?, volume?, pitch?)` — the AudioSystem (`src/audio/AudioSystem.ts`) plays it,
  positional when a position is given (attenuated from Jimothy, panned from the camera, silent beyond the key's max range).
* Direct: `import { audio } from '../audio/AudioManager'`, then
  `const h = audio.play('roll_loop', { position, volume, pitch, pitchVar, loop, delay })` → handle
  `{ stop(fade?), setVolume(v), setPitch(p), setPosition(v3 | null), playing }` or `null` (not loaded / rate-limited / out of range).
* **Loops** return a handle even before loading finishes (they start when ready): keep it, update it each frame, `stop()` it.
* Each key has several variations (picked at random, never twice in a row) plus random pitch (±`pitchVar`, default 5%).
  Per-key caps (`max`, default 4; oldest cut) and a min gap between plays (default 25 ms) keep physics chaos listenable.
* Music: `audio.playMusic('title' | 'day' | 'night' | 'slop', fadeSec)` / `audio.stopMusic()` — the AudioSystem already
  switches themes automatically (title screen, day/night, SlopCorp Campus).
* Volumes: emit `'audioVolume' { master?, sfx?, music? }` (0..1, persisted) or `jimothy.get('audio').setVolumes(...)`.
* Unknown keys log one warning and play nothing — nothing in the audio code ever throws.

Sources: **Kenney** packs are CC0 recordings (`public/assets/audio/sfx/`, see CREDITS.md); **synth** recipes are our own,
rendered procedurally at load time in a Web Worker (`src/audio/synth/recipes/`); voice lines run through `slopify` become AI-slop speech.

## Jimothy's voice (synthesized)

| key | use | source | var. | notes |
|---|---|---|---|---|
| `chitter` | Jimothy chitters: rapid raspy chirps (taunt, C key). | synth `chitter` ×6 | 6 | max 2, gap 0.1s |
| `trill` | Warbling bird-like trill (curious / content). | synth `trill` ×4 | 4 | max 2 |
| `purr` | Low rolling churr/purr (being groomed by Mom, cozy). | synth `purr` ×3 | 3 | max 2 |
| `hiss` | Cute-grumpy hiss (startled, scolded, cornered). | synth `hiss` ×4 | 4 | max 2 |
| `squeak` | Squeak / "eek!" / squeal (hurt, surprised, launched). | synth `squeak` ×6 | 6 | max 3, gap 0.08s |
| `happy` | Happy rising chirps (got a snack, washed something, reunion). | synth `happy` ×5 | 5 | max 2 |
| `kit_chirp` | Tiny baby-raccoon peeps (lost kits, kits following in a line). | synth `kit_chirp` ×4 | 4 | max 5, gap 0.05s |
| `munch` | Crunchy snack chomps + contented chirp (eating food). | synth `munch` ×3 | 3 | max 2 |

## Player movement

| key | use | source | var. | notes |
|---|---|---|---|---|
| `footstep` | Soft little paw step (default surface). Fire per step. | Kenney Impact Sounds (5) | 5 | max 4, gap 0.05s, 4–25 m, pitch 1.3 |
| `footstep_grass` | Paw step on grass / dirt. | Kenney Impact Sounds (5) | 5 | max 4, gap 0.05s, 4–25 m, pitch 1.25 |
| `footstep_wood` | Paw step on wood (docks, porches, decks). | Kenney Impact Sounds (5) | 5 | max 4, gap 0.05s, 4–25 m, pitch 1.35 |
| `footstep_hard` | Shoe step on pavement (NPC humans). | Kenney Impact Sounds (5) | 5 | max 6, gap 0.03s, 4–25 m, pitch 1.05 |
| `jump` | Cartoon "bwip" jump. | synth `jump` ×4 | 4 | max 2 |
| `land` | Soft thump when landing (volume ∝ fall height). | Kenney Impact Sounds (5) | 5 | max 3, pitch 1.1 |
| `land_heavy` | Heavy body thud (big falls, ragdolls hitting the ground). | Kenney Impact Sounds (5) | 5 | max 4 |
| `roll_loop` | LOOP: Tuck & Roll rumble. Drive setVolume/setPitch from speed. | synth `roll_loop` ×1 | 1 | **loop**, max 2 |
| `climb` | Claws scrabbling on bark/brick/poles while climbing. | synth `climb` ×4 | 4 | max 2 |
| `flop` | Ragdoll "floomp" with a little bounce (Flop). | synth `flop` ×3 | 3 | max 3 |
| `grab` | Grabby Hands: quick snatch / rustle. | Kenney RPG Audio (3) | 3 | max 3, pitch 1.25 |
| `throw` | Short swoosh when throwing something. | synth `throw` ×3 | 3 | max 3 |
| `steal` | "Yoink!" slide whistle (stole a phone / sandwich). | synth `steal` ×3 | 3 | max 2 |
| `bonk` | Hollow cartoon BONK (body slam / headbutt). | synth `bonk` ×5 | 5 | max 4 |
| `whoosh` | Cartoon whoosh (lunges, things flying past, bonk wind-up). | synth `whoosh` ×4 | 4 | max 4 |

## Impacts & destruction

| key | use | source | var. | notes |
|---|---|---|---|---|
| `impact_light` | Light generic knock (small props). | Kenney Impact Sounds (5) | 5 | max 6 |
| `impact_heavy` | Heavy meaty thwack (big props, bowling people over). | Kenney Impact Sounds (5) | 5 | max 6 |
| `impact_body` | Body hit (NPC bowled over / ragdoll collisions). | Kenney Impact Sounds (5) | 5 | max 6 |
| `impact_metal` | Metal clang (cars, poles, bins, signs). | Kenney Impact Sounds (10) | 10 | max 6 |
| `impact_metal_light` | Small metal tink (cans, cutlery, keys). | Kenney Impact Sounds (5) | 5 | max 6 |
| `impact_tin` | Tin rattle (cans, lids). | Kenney Impact Sounds (5) | 5 | max 6 |
| `impact_wood` | Wood knock (crates, benches, fences). | Kenney Impact Sounds (10) | 10 | max 6 |
| `impact_glass` | Glass bump without breaking. | Kenney Impact Sounds (5) | 5 | max 4 |
| `impact_bell` | Resonant bell/pole clang (bonking a lamppost or bell). | Kenney Impact Sounds (5) | 5 | max 3 |
| `trash_can` | Metal trash can clattering over (+ tin rattle layer). | Kenney RPG Audio (3) | 3 | max 3, gap 0.06s, pitch 0.85, + `impact_tin` |
| `glass_break` | Glass smash + tinkling shards. | Kenney Impact Sounds (5) | 5 | max 3, + `glass_shards` |
| `glass_shards` | Tinkling glass fragments (layer of glass_break). | synth `glass_shards` ×3 | 3 | max 3 |
| `explosion` | Big explosion (propane tank, car) + low boom layer. Ducks music. | Kenney Sci-fi Sounds (5) | 5 | max 3, gap 0.08s, 10–160 m, ducks music, + `explosion_low` |
| `explosion_low` | Low sub boom (layer of explosion). | Kenney Sci-fi Sounds (2) | 2 | max 3, 12–180 m |
| `explosion_small` | Punchy cartoon blast (small pops, fireworks misfire, SlopBot popping). | synth `explosion_small` ×3 | 3 | max 3, 8–120 m |

## Water & washing

| key | use | source | var. | notes |
|---|---|---|---|---|
| `splash` | Splash into water (Jimothy / props). | synth `splash` ×4 | 4 | max 4, gap 0.05s |
| `splash_big` | Huge splash (big falls, cannonballs, cars into the bay). | synth `splash_big` ×3 | 3 | max 2, 8–90 m |
| `wash_loop` | LOOP: bubbly washing/scrubbing while holding Wash. | synth `wash_loop` ×1 | 1 | **loop**, max 2 |
| `scrub` | Two or three brisk scrubs (wash progress ticks). | synth `scrub` ×4 | 4 | max 3 |
| `bubble_pop` | Single bubble "plip" (sprinkle several while washing). | synth `bubble_pop` ×6 | 6 | max 8, gap 0.02s |
| `bubble_burst` | Giant soap bubble bursting (washed a soap bar). | synth `bubble_burst` ×3 | 3 | max 2 |
| `fizz` | Sugar fizzing away (cotton candy dissolving; pair with sad_trombone). | synth `fizz` ×3 | 3 | max 2 |
| `water_loop` | LOOP: gentle lapping water (bay, pond; pitch 1.3 for fountains). | synth `water_loop` ×1 | 1 | **loop**, max 3, 6–45 m |

## Cartoon & props

| key | use | source | var. | notes |
|---|---|---|---|---|
| `boing` | Spring "boiiing" (bounces, tuck into a ball). | synth `boing` ×4 | 4 | max 3 |
| `sad_trombone` | "Wah wah wah waaah" (cotton candy washed away). Ducks music. | synth `sad_trombone` ×2 | 2 | max 1, gap 1.5s, ducks music |
| `jingle_sad` | Sad sax "wah wah wah waah" jingle (alt. failure sting). | Kenney Music Jingles (1) | 1 | max 1, ducks music |
| `camera_shutter` | Camera shutter / phone photo (fans filming Jimothy). | synth `camera_shutter` ×4 | 4 | max 6, gap 0.04s |
| `honk` | Clown / bike bulb horn HONK (silly props, mascots). | synth `honk` ×4 | 4 | max 3 |
| `sparkle` | Shiny clean sparkle (item washed, collectible). | synth `sparkle` ×3 | 3 | max 3 |
| `cha_ching` | Cash register "cha-ching" (MONEY LAUNDERING). | synth `cha_ching` ×2 | 2 | max 2 |
| `bat_crack` | Baseball bat crack (Rookie mutator home-run bonk). | synth `bat_crack` ×3 | 3 | max 2 |
| `rummage` | Dumpster diving: crinkly bags, clinks, thumps. | synth `rummage` ×3 | 3 | max 2 |
| `short_circuit` | Sparky short circuit (washed a phone / electronics). | synth `short_circuit` ×3 | 3 | max 2 |
| `creak` | Wooden creak (dumpster lids, old doors, branches). | Kenney RPG Audio (3) | 3 | max 2 |
| `door_open` | Door opening. | Kenney RPG Audio (2) | 2 | max 2 |
| `door_close` | Door closing. | Kenney RPG Audio (4) | 4 | max 2 |
| `coins` | Handful of coins jingling (cash, tip jars). | Kenney RPG Audio (2) | 2 | max 2 |

## People (synthesized formant voices)

| key | use | source | var. | notes |
|---|---|---|---|---|
| `scream` | Cartoon "waaaah!" (PG): man / woman / kid / long falling / yelp. | synth `scream` ×5 | 5 | max 3, gap 0.25s, 4–80 m |
| `crowd_aww` | Crowd "awwww" (fans melt when Jimothy chitters). | synth `crowd_aww` ×3 | 3 | max 2, gap 0.6s, 8–90 m |
| `crowd_ooh` | Impressed crowd "ooooh" (someone got launched). | synth `crowd_ooh` ×2 | 2 | max 2, gap 0.6s, 8–90 m |
| `crowd_cheer` | Crowd cheer: yay / woo / hey + applause + whistles. | synth `crowd_cheer` ×3 | 3 | max 2, gap 0.8s, 10–120 m |
| `crowd_laugh` | Crowd laughing "ha-ha-ha" (slapstick payoff). | synth `crowd_laugh` ×2 | 2 | max 2, gap 0.8s, 8–90 m |
| `officer_whistle` | Wildlife Officer's whistle (please don't approach Jimothy!). | synth `officer_whistle` ×3 | 3 | max 2, gap 0.3s, 4–80 m |

## World & ambience

| key | use | source | var. | notes |
|---|---|---|---|---|
| `car_horn` | Car horn: single, "beep-beep", long angry. | synth `car_horn` ×3 | 3 | max 3, 6–110 m |
| `car_engine_loop` | LOOP: car engine; set pitch ~0.6-2.0 from speed. | synth `car_engine_loop` ×1 | 1 | **loop**, max 8, 5–50 m |
| `crow_caw` | Seattle crows: caw / caw-caw / caw-caw-caw. | synth `crow_caw` ×5 | 5 | max 3, 4–100 m |
| `seagull` | Seagull cries and laughs (waterfront, bay). | synth `seagull` ×4 | 4 | max 3, 4–110 m |
| `firework` | Firework: whistle up, boom, crackle (Jimothy Summer, stadium). | synth `firework` ×3 | 3 | max 4, 15–260 m |
| `server_hum_loop` | LOOP: SlopCorp data-center hum and fans. | synth `server_hum_loop` ×1 | 1 | **loop**, max 2, 6–40 m |

## AI slop

| key | use | source | var. | notes |
|---|---|---|---|---|
| `slop_glitch` | Bitcrushed downward glitch sweep (slop appears / flickers / gets bonked). | synth `slop_glitch` ×5 | 5 | max 4 |
| `dissolve` | Slopothy washed away: uncanny chord pixelates and fizzes out. | synth `dissolve` ×3 | 3 | max 3 |
| `slop_voice` | Slopothy / SlopBot "speech": robot babble and glitched "Congratulations!"/"Correct!" lines. | synth `slop_babble` ×4 + 5 voice lines → `slopify` | 9 | max 2, gap 0.3s |
| `ui_glitch` | Tiny digital glitch tick (SlopBot popups, slop UI). | Kenney Interface Sounds (4) | 4 | UI (2D), max 4 |

## Rewards & jingles

| key | use | source | var. | notes |
|---|---|---|---|---|
| `coin` | Coin / collectible pickup ("ba-ding"). | synth `coin` ×3 | 3 | max 4, gap 0.04s |
| `score` | Subtle score plink (score popups; pitch up with combo). | synth `score` ×3 | 3 | UI (2D), max 3, gap 0.06s |
| `combo_up` | Rising combo arpeggio (multiplier went up). | synth `combo_up` ×2 | 2 | UI (2D), max 2 |
| `objective_complete` | Triumphant "ta-da-da-DAAA" fanfare. Ducks music. | synth `fanfare` ×2 | 2 | UI (2D), max 1, gap 0.8s, ducks music |
| `mutator_unlock` | Magical rising steel-drum run + sparkles (mutator unlocked). Ducks music. | Kenney Music Jingles (1) | 1 | UI (2D), max 1, ducks music, + `sparkle` |
| `jingle_win` | Short positive jingle (mini success, quest step). | Kenney Music Jingles (4) | 4 | UI (2D), max 1, ducks music |
| `jingle_fail` | Short descending "fail" jingle. | Kenney Music Jingles (2) | 2 | UI (2D), max 1, ducks music |

## UI

| key | use | source | var. | notes |
|---|---|---|---|---|
| `ui_click` | Button click. | Kenney Interface Sounds (2) | 2 | UI (2D) |
| `ui_hover` | Button hover / focus tick. | Kenney Interface Sounds (2) | 2 | UI (2D), gap 0.04s |
| `ui_back` | Back / cancel. | Kenney Interface Sounds (2) | 2 | UI (2D) |
| `ui_open` | Menu / panel open. | Kenney Interface Sounds (1) | 1 | UI (2D) |
| `ui_close` | Menu / panel close. | Kenney Interface Sounds (1) | 1 | UI (2D) |
| `ui_confirm` | Confirm / toggle on / purchase. | Kenney Interface Sounds (1) | 1 | UI (2D) |
| `ui_error` | Not allowed / error. | Kenney Interface Sounds (1) | 1 | UI (2D) |
| `ui_toggle` | Switch / checkbox toggle. | Kenney Interface Sounds (2) | 2 | UI (2D) |

## Music themes (`audio.playMusic(theme)`)

Streamed from `public/assets/audio/music/` (loudness-normalized per file). Playlists play through, then the next track.

| theme | when | tracks (title — author) |
|---|---|---|
| `title` | title screen — The music player playlist: every track, upbeat first. Title screen, and gameplay in "My playlist" mode (checked tracks, optional shuffle: musicPrefs.ts). | Wacky Workings — Fupi<br>Banana Track — skrjablin<br>Trouble in the Garden — HaelDB<br>Wacky Wobblings — Fupi<br>A respectable amount of Bounce — Some Weirdo<br>Dialup Song — Fupi<br>Ai Contact — Of Far Different Nature<br>Chill lofi inspired (loop edit) — omfgdude, loop edit by qubodup<br>Napping on a Cloud — congusbongus |
| `day` | daytime free-roam — Daytime free-roam: jaunty, silly, a little dumb. | Banana Track — skrjablin<br>Wacky Workings — Fupi<br>Trouble in the Garden — HaelDB<br>Wacky Wobblings — Fupi |
| `night` | night (Environment.isNight) — Night: chill lo-fi / sleepy chiptune (raccoon hours). | Chill lofi inspired (loop edit) — omfgdude, loop edit by qubodup<br>Napping on a Cloud — congusbongus |
| `slop` | inside SlopCorp Campus — SlopCorp campus: glitchy talking-synth wubs and dial-up modem jams. | Ai Contact — Of Far Different Nature<br>Dialup Song — Fupi |

All music is **CC0** from OpenGameArt (license verified on each page); details in CREDITS.md.

## Played automatically by the AudioSystem

| trigger | sound |
|---|---|
| any `'sfx'` event (`game.sfx`) | that key |
| player washing (`player.washing`) | `wash_loop` (follows Jimothy) |
| player `mode === 'roll'` | `roll_loop`, volume/pitch ∝ speed, quiet in the air |
| walking on the ground | `footstep` / `footstep_grass` (park-ish areas) / `footstep_wood` (docks), rate ∝ speed |
| climbing / swimming | `climb` scrabbles / small paddle `splash`es |
| near bay / pond / fountain / pool | `water_loop` at the nearest water edge |
| inside SlopCorp Campus | `server_hum_loop` + `slop` music |
| every 7–16 s | `crow_caw` (anywhere, fewer at night) or `seagull` (near the bay, daytime) |
| `objective` / `mutatorUnlocked` / `comboUp` | `objective_complete` / `mutator_unlock` / `combo_up` (deduped with game.sfx) |
| `scoreAdded` | subtle `score` plink (throttled, pitch rises with combo) |
| `cameraFlash` / `filmed` | `camera_shutter` at the photographer |
| `explosion` | `explosion` |
| `npcRagdoll` | cartoon `scream` (throttled) or `whoosh` |
| `splash` | `splash` / `splash_big` by strength (deduped with the player's own splash sfx) |
| `sparkle` / `trashTipped` / `cottonCandyGone` | `sparkle` / `trash_can` / `fizz` |
| `wash` | a few `bubble_pop`s |
| `playerRagdoll` (flop) / `playerImpact` | `flop` / `impact_body` + `squeak` |
| `climbStart` / `hangStart` | `climb` / `grab` |
