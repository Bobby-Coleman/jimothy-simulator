# Jimothy Simulator — overnight devlog

Session start: 2026-09-28 22:57 PT. Budget: 8 hours.

## 22:57 — Kickoff
* Researched Jimothy (went viral July 2026, after the AI's training data): round short-spined wild raccoon from Ballard,
  "Jimothy Summer", UW honorary degree, Mariners "Jimothy Night" + Salmon Run win, $20k gold rookie card,
  and a flood of AI-generated fakes. Wrote `DESIGN.md` around those facts.
* Stack: Vite + TypeScript + Three.js 0.186 + Rapier 0.21 (+ pmndrs postprocessing), same style as the other projects.

## 23:00–23:45 — Engine + helpers
* Core engine: game loop/systems, Rapier physics wrapper, entity registry, input (KB/mouse/gamepad/touch-virtual),
  renderer with bloom/AgX/SMAA, sky + day/night, water volumes (washing + swimming + buoyancy), terrain heightfield.
* Jimothy controller: walk/sprint/jump, **wall climbing** with stamina + wall-jumps + mantling, **Tuck & Roll**
  (he's a ball), **flop** ragdoll, swimming, **Grabby Hands** (carry / drag / steal / hang on cars), **bonk**, **washing**.
  Washing cotton candy makes it vanish ("Where'd It Go?").
* Shell-fur shader so Jimothy is fluffy.
* Traffic: cars from the Kenney car kit follow lane loops, honk, brake for Jimothy, launch him if he's too slow,
  get yeeted by explosions, and can be surfed.
* Headless playtest tool (`tools/shot.mjs`) so helpers can test without a visible browser.
* Public repo + GitHub Pages deploy: https://greenninjada.github.io/jimothy-simulator/
* Helper agents running in parallel: Blender (Jimothy/Mom/kit/Danny/Slopothy/hats), CC0 asset librarian, audio,
  NPC humans + ragdolls, UI/menus/intro, 3 level builders (central / north / south-west), FX + items + trash,
  objectives + mutators + collectibles, heartwarming family quests, AI-slop enemies + SlopCorp, landmark events.

## 23:45–00:10 — Lead work while helpers build
* Asset librarian finished: 20 Kenney kits (1,751 models), 12 Poly Haven texture sets, HDRI, fonts — all CC0/OFL/Apache.
* Fixed a nasty bug: the first animation frame could have a *negative* dt → 0/0 in the walk code → NaN velocity →
  NaN camera FOV → the whole screen turned into flat fog. Plus NaN guards and an HDR sanitize pass before bloom.
* Terrain now blends grass/dirt/sand photo textures (re-tinted to Goat-Sim green) with anti-tiling.
* **Photo mode (V)**: freeze time, orbit, snap → fake viral post ("what am I looking at", "0% AI") + Save button.
* **Seattle weather**: drizzle/rain with GPU rain streaks, overcast sky, wet ground. While it rains outdoors the whole
  city is a sink — Jimothy can wash anything anywhere.
* **Map**: minimap + full map (M) rendered from a top-down capture of the world.
* Slow-mo (T), respawn (H), performance overlay (F3 / `?stats`), instanced fur (130 → 13 draw calls).

## 00:10–00:45 — Integration wave
* Landed from helpers: Blender raccoons (Jimothy/Mom/kit/Danny/Slopothy + hats), full audio (91 sound keys — raccoon
  chitters, washing, crowds and slop glitches are original synthesis; CC0 music themes), the whole UI (title,
  phone-camera intro of the viral moment, HUD, menus, SlopBot, dialogue, touch controls), NPC humans with ragdolls,
  48 objectives + 12 mutators + 10 golden bobbleheads, zones: road grid, Old Ballard (spawn/den), Downtown with the
  Space Noodle, the park, the Locks, the Residential Hills.
* Performance pass: static-geometry batcher, distance culling for small props, no shadows on tiny props,
  quality-scaled shadow box, first-visit auto quality. Spawn view went from ~1,300 to ~780 draw calls while the
  world doubled in size.
* Seattle-summer day cycle (sunrise 5:30, sunset 21:00). The intro plays at 7:42 PM golden hour like the real clip,
  then cuts to "The next morning… Jimothy is internet famous."
* Touch-friendly minimap (tap to open the big map).

## 00:45–01:20 — Everything lands
* All 9 zones done: Old Ballard (spawn + den), Downtown (City Hall, bronze Jimothy statue, 75 m climbable Space Noodle),
  Residential Hills (Tumble St rolling street with a radar speed sign, trampolines, pools, BBQ propane tanks,
  Grandma's porch, Danny's lawn), University of Washing (cherry blossoms, graduation stage), SlopCorp campus
  (six-fingered billboard, data center + giant plug, Prompt Portal, Slop Dragon), Gasworks-ish Park, the Locks with a
  working fish ladder, the Waterfront with Pike's Plaice Market + Gum Wall + ferry "M/V Round Boy", Tee-Hee Park stadium.
* Systems done: 56–58 NPCs with 11-body ragdolls (they film Jimothy, officers scold fans, the "not a cat" gag),
  32 washable item kinds with custom reactions, dumpster diving with loot, explosions, AI-slop "Slopothys",
  the ridable Slop Dragon, unplug-SlopCorp quest, 6 landmark events (degree, proclamation, Salmon Run,
  Catch of the Day, $20k rookie card, Noodle summit), 50 objectives, 12 mutators, 10 golden bobbleheads.
* Fixes: colour grading now after tone mapping (saturated colours were turning black), culler uses world positions,
  heavy-object drag no longer drops instantly (helper found a shared-temp bug in my controller), mantling lands on
  ledges, camera ignores thin poles/trunks, physics queries refreshed after each zone build.
* Automated regression playtest (`tools/playtest.mjs`): walking, jumping, washing cotton candy, bonking/stealing from
  NPCs, dumpster diving, getting hit by a car, climbing, rolling — 0 console errors.
* QA wave started: objectives audit, world polish + performance, first-time-player UX + mobile.

## 01:20–03:00 — QA wave + extras
* **Objectives audit**: all 50 Instincts achievable through real play (37 verified as-is, 13 fixed, targets rebalanced);
  `QA_OBJECTIVES.md` hint sheet; `tools/playtest.mjs --group obj` plays every one (52/52 passing).
* **World polish + performance**: worst street-level draw calls 826 → 486 on high (every spot < 500), shadow pass
  halved, a 5.4 s startup freeze (map capture compiling ~50 shaders) removed, shader warm-up after load, night
  alleys lit, missing colliders fixed, cars/crows/NPCs LOD'd, quality-scaled fog/draw distance.
* **First-time UX + mobile**: reactive onboarding hints, "Suggested next" Instincts with a tracked goal (pill + compass +
  on-screen star + minimap star), clickable labelled map icons, pause-menu "Back to the den"/photo buttons, full touch
  support (scrolling menus, photo-mode buttons, minimap tap), "Reduce flashing & shake" accessibility option,
  focus-loss auto-pause.
* **Fun extras**: raccoon cannons (Tee-Hee Park + "Bay Blaster" on the Space Noodle), a rideable Ferris wheel,
  three unimpressed Actual Cats, and the **"Jimothy Summer Forever" finale** (family at the den, fireworks over the bay
  incl. a raccoon face, credits) once Mom, the kits and Danny are all home.
* Lead: KRCN News ticker, low-ceiling camera (the den!), terrain chunking + capped edge berms + forested side hills +
  distant horizon with the Olympics and a Rainier-ish mountain across the bay, textures 25.5 MB → 3.1 MB
  (first load 34.7 MB → 13.6 MB), single shadow proxy for Jimothy, soak test (6 simulated minutes of random input:
  no errors, no NaNs).
* Second polish wave started: game feel & forgiveness, visual beauty pass + README screenshots, more slapstick toys.
