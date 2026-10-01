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
* **Objectives audit**: all 50 Instincts (at the time) achievable through real play (37 verified as-is, 13 fixed, targets rebalanced);
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

## 03:00–03:55 — Second polish wave
* **Game feel** (measured with scripted random approaches): soft aim-assist for grab/bonk/wash — grab success
  82% → 91% (NPCs 100%), wash-near-water 88% → 100%; hit-stop + camera kicks, Tuck & Roll squash/pop, ledge vaults,
  gentle camera auto-follow, zero camera-in-geometry spots on an 18-spot tour; combos reward variety, not spam.
* **Art**: screen-space AO on high, warm split-tone grade, real golden hour, stylised sky with a deep-blue night,
  rim-lit fluffier fur, two-layer water with sky fresnel, softer rain — at ~the same frame cost. README screenshots
  in `docs/screenshots/`.
* **Chaos toys**: 21 hydrants burst into rideable geysers (with washable puddles), 25 parked cars with alarms (the
  bystanders do the Seattle Freeze), Bean Me Up Espresso → Espresso Mode (and a caffeine crash), a tour group at the
  Space Noodle for bowling. +4 Instincts (54 total). All added to the guide and the map.
* Lead: a "Janitor" quietly removes old far-away runtime litter so long sessions don't slow down; two more
  5-minute soak tests (0 errors); cleaned up stray preview servers.
* Final wave started: fresh-eyes playthrough review + fixes, night/golden-hour lighting fixes.

## 03:55–05:10 — Final wave
* **Night & golden-hour lighting**: sunsets have a sun disc and peach glow (no more white blob), dusk no longer goes
  black, the stadium field reads green under the lights (was beige haze), the market and City Hall portico have warm
  lamp pools, balanced low-quality nights, mountains that read at every hour, brighter rim light on Jimothy at night.
* **Fresh-eyes playthrough** (a critic playing the first 15 minutes): praised the writing, Jimothy, and the first-five-
  minutes flow; fixed the guide for rain and heights ("Mom · 9 m down"), a false "Give Mom the snack" prompt on the
  roof, and camera framing for the ceremonies.
* **Final fixes**: heartfelt cutscenes (Mom's grooming, the kits' family portrait, Danny, the finale) now hold toasts,
  popups and combo shouts until they end, and Mom steps out of the den so both faces are in frame; City Hall portico
  night lights; HUD overlap fixes; the "Human Made" secret can't be triggered by accident; the camera respects heavy
  props like dumpsters.
* **Final verification** on a production build: typecheck clean, regression playtest 0 errors, all 52 objective
  scenarios passing, 5-minute random-input soak 0 errors / no NaNs / bounded entity count.

## Numbers
* 23 helper agents + the lead. ~217 TypeScript source files. 9 zones, ~60 NPCs, 54 Instincts, 12 mutators,
  10 golden bobbleheads, 6 heartwarming quests, 6 landmark events, 4 chaos toys, 2 raccoon cannons, 1 finale.
* First load ≈ 13.6 MB, boots in ~6 s; ≤ 500 draw calls at street level on 'high'.
* 05:15 — Lead's last catches: wandering AI-slop creatures were photobombing the finale (a glitchy rainbow blob in
  front of Mom's big line) — heartfelt cutscenes now quietly relocate nearby Slopothys off-camera. Verified the
  finale end-to-end, the live GitHub Pages build (boots in ~6 s, 13.7 MB, 0 errors, minimap OK) and phone portrait
  play (touch controls, auto 'low' quality, 0 errors).

## Morning notes for the human
* Play: https://greenninjada.github.io/jimothy-simulator/ (desktop keyboard/mouse or gamepad; phones work too).
* `QA_OBJECTIVES.md` is a spoiler-marked hint sheet for all 54 Instincts. Finish Mom + the 5 kits + Danny for the
  fireworks finale. "I just want to play" (pause → Mutators) unlocks every mutator.
* Known rough edges: the guide star points in a straight line (it'll happily lead you over a roof); sunsets are
  peachy rather than deep red; rain has no splashes; the Strike objective test is a little flaky in automation
  (the objective itself is easy with the tour group at the Space Noodle).
* `tools/_downloads/` holds ~1.5 GB of regenerable scratch builds/downloads (gitignored) — safe to delete.

## Morning playtest fixes (from the human)
* **Hats vs fur**: shell fur poked through Grandma's beanie (mostly the round body's fur). Hats now hide the head and
  body fur under their footprint, so only the ears poke out; same for the grad cap and the Rookie cap.
* **Invisible walls**: the invisible map-edge walls were climbable (60 m of air); they're now marked unclimbable. An
  audit of every static collider against the visible geometry also found SlopCorp's cooling towers wrapped in one
  fat cylinder (an invisible wall around the pinched waist); they now use stacked colliders that follow the shape.
* **Slopes**: a 0.5 m/s "keep feet planted" cap stalled Jimothy on inclines (sprinting up 45° gained 3.5 m in 4 s,
  62° was neither walkable nor climbable). He now follows the ground: anything up to ~60° is runnable at normal
  speed along the slope (45° sprint: 21 m in 4 s) and anything steeper is climbable.
* **News-van tripod**: legs were tilted the wrong way (converging at the feet); they now splay out.

## Playtest batch 2 (from the human)
* **Raccoon cannons** can be aimed: ~4 s with a countdown, move to swing/raise the barrel, jump to fire early. A
  dotted trajectory preview (drawn over scenery, constant on-screen size, stops at ground/water/anything solid) and
  a landing marker + range readout; launch power is fixed so the preview is honest (lands within ~1–5 m).
* **Ferry**: the sun-deck stairs sat in a 0.8 m gap Jimothy (0.76 m) wedged in → 1.6 m promenade, wider stairs, a
  landing onto the sun deck and an outer handrail. Brushing a railing mid-stairs no longer auto-climbs it (thin
  rails/poles need jump held; auto-climb needs a head-on push) — he used to vault into the bay.
* **University grand steps**: the stone cheek walls + urns were visual only (walk-through corner) → colliders.
* **Ezekiel Lint's statue**: the raised arm now runs from the shoulder to the sock. **NPC hair** shells render their
  inner side (back hair was invisible from the front). **Fun Fact** sign faces town, clear of the coolant pipe;
  the power plug's cable enters the junction box from the side so "TO DATA CENTER" is readable.
* **Climbing ×¼**: bare walls drain stamina 4× faster (~7 m walking, ~11 m sprinting per bar). A new ladder registry
  (`world.addLadder`) keeps ladders at the old rate: Space Noodle maintenance ladder, SlopCorp billboard ladder,
  new service ladders on the catwalk-free gasworks towers. Bobblehead perches that relied on long wall climbs got
  ladders/ledges (see QA_OBJECTIVES.md).

## Playtest batch 3 (from the human)
* **Pause menu → Fullscreen / Exit fullscreen** (hidden where the browser can't; falls back to a "try F11" label).
* **Title-screen music player** instead of a fixed title track: every in-game track, with title, author and a link
  to the author's OpenGameArt profile; prev / play-pause / next, auto-advance. Credits page lists them all too.
* **NPC phones ×2** (they read as specks at street distance).
* **SlopCorp billboard, rebuilt**: an invisible 153 kg wash sensor filled the old catwalk — the ground check and the
  camera both hit it (Jimothy was never "grounded" up there → constant climbing; camera jammed at 0.2 m). Now: a
  1.85 m catwalk with a water gutter, thin unclimbable rails, a service-mast ladder that actually reaches it, and
  signposted washing. Engine fix so it can't recur: raycasts and sphere casts ignore sensors.
* **City Hall geometry pass**: the pediment's collider was a flat slab (he sank 1.8 m into the ridge) → convex hull
  of the drawn prism; roof cornice, portico cornice, dome, lantern, drum plinth, column bases/capitals and doors got
  colliders that match their visuals (probe mismatches 3,940 → 270, remainder intentional).
* **Proximity hints**: linger ~2 s near where an unfinished Instinct happens and its hint appears under the goal
  pill (36 of 54 Instincts; never secrets, never during cutscenes/menus).
* Standing still on a sloped roof no longer creeps downhill.

## Playtest batch 4 (from the human)
* Cannon aiming has no visible tracer any more (aim by eye); proximity hints stay quiet while he's in a cannon.
* Tee-Hee Park: the backstop net sealed the Gate H tunnel behind home plate → two panels with a gap.
* Lawn sprinklers now place themselves: nearest spot to the requested one where the whole spray is clear of
  colliders, on fairly flat lawn and off the street/sidewalk (several sat inside porches or under steps).
* University hall entrance steps (shared gothic builder): sized to meet the ground downhill instead of floating,
  every step reaches the ground and has a collider (only a narrow central ramp was solid before).
* **Music player v2**: playlist with checkboxes (unchecked tracks are skipped), draggable seek bar, volume + mute
  (synced with Settings), shuffle, and a pause-menu Music page with an "Auto music" / "My playlist" toggle. Choices
  persist across visits.

## Playtest batch 5 (from the human)
* **Signs**: a registry + head-on screenshot tour of ~300 sign faces. Shared text fitting measures real ink width
  with a safe margin, sign textures keep their aspect, posts stand clear of faces; dozens of signs moved out from
  behind columns, trees, lamps, kiosks and walls (incl. the Jimothy Night bobblehead sign in the plinth).
* **Walk-through floors**: a whole-map visible-vs-solid probe; sink-in area 5,482 m² → 917 m² (tower setbacks,
  HQ ledges, seawall cap, greenhouse, sidewalks, roofs, cars/boats via stepped profile colliders).
* **Espresso freeze**: chittering a stolen coffee both handed it back (release → owner took it) and drank it; the
  NPC then held a destroyed item and the next grab poisoned the physics world. Give-backs are deferred, dead items
  are refused everywhere, and a throwing physics step can no longer stall the game loop.
* **Intro** films Jimothy from 90° to the side, so Mom isn't in the background. **Pond beach** is a gentler eased
  slope, and wading out of shallow water stands him up cleanly.
* **Fewer ladders**: City Hall, Noodle roof, grunge shop, UW library, gasworks and Grandma's trellis ladders removed.
  Routes are stamina puzzles now (rest ledges, stepped piers, a valve pipe, the donut shop roof); careful play
  succeeds, a naive walking climb fails. Coves/lips fixed so climbers don't snag under cornices and eaves; fire
  escapes land you on their platforms.

## Playtest batch 6 (from the human)
* **Return From Whence You Came**: three scowling, grabbable seagulls by the bay (promenade railing, Pier A,
  a marina bollard). Throw or bonk one into the bay → splash, an indignant (original) complaint, a lap, home.
  Mom/kits/Danny don't count and their quests are safe.
* **THE BIG ROLL**: a rooftop bowling-ball race from Hilltop Lanes (new retro alley at the top of Tumble St):
  kicker jump, 7 checkpoints through town, finish by bowling ten giant pins by City Hall. Bronze (finish) /
  Silver < 0:52 / Gold < 0:40 / Platinum Pin < 0:34 — the scripted ideal line's best is 32.9 s. Boosts cap at Bronze.
* Crow's nest: rope ladder removed (trunk + branch climb).
* Music: "A respectable amount of Bounce" removed (file, playlist, credits). Checking/unchecking a track switches
  to "My playlist"; the title screen starts on a random checked track; a pause is remembered across visits.
  Old saves are migrated (the playlist indices shifted).

## The real Jimothy (from the human's reference footage)
* **New body**: Jimothy is no longer a ball. `jimothy.glb` is the real animal: a short, arched ("scrunched") spine,
  a head that hangs down with almost no neck (he can barely lift it), long normal raccoon legs, a very short
  cottontail-like tail puff and his mask traced from video frames. Fitted in Blender to a side-on photo (skeleton
  first, then the physical body; fur is NOT modelled) and approved from renders before building the game model.
* **Game model**: one skinned mesh (13k tris) with a 2048² baked texture (crisp mask), rigid eyes/nose, 26 bones with
  identity rest rotations, and a per-vertex `_FURLEN` attribute: shell fur is long under the belly and on the cheeks,
  very short on the face, short on the legs. Fur.ts now furs skinned meshes (instanced SkinnedMesh shells).
* **Rolling**: tucking into a roll swaps to the round model (`jimothy_ball.glb`, now with a short fat tail) behind
  the existing squash/dust "whoomp"; he pops back out as himself.
* **Animation** (`JimothyQuad.ts`): two-bone IK legs, walk → trot → bound with speed (a first pass; the walk cycle
  measured from the footage comes next), jumping, swimming (dog-paddle), climbing, hanging, ragdoll, washing, bonk,
  chitter (jaw), sniffing the ground when idle, and sitting up to stare at his empty paws.
* **Carrying**: everything rides on his back, as before (a paw / mouth / standing-hug version was tried and reverted
  at the human's request). The ride height follows the body: his arched back is lower than the ball's top.
* **Hats and glasses** refit to the new head (tilted with it; the fur under hats is clipped on the skinned mesh).

## Jimothy's walk, from the footage
* **Gait timed frame by frame** from the news clip (the side-on lawn run, 5.0–6.6 s, plus the overhead deck camera
  for left vs right): a 0.8 s cycle at his ~0.55 m/s stroll. It is a **pace-like lateral walk**: the two legs on one
  side swing almost together (the front lifts ~0.07 s before its hind and lands just after it), then the other side,
  so he rocks from one side pair to the other. A short back on long legs is exactly the build that paces (it keeps a
  hind foot from striking the front foot on its own side), and it matches the still where one side's legs are planted
  and the other side's are both in the air. Hind feet stay down ~70 % of the cycle, fronts ~58 %: each front paw rises
  to chest height and reaches well past his nose before planting; each hind foot pushes far back on its toes (heel
  up), kicks up high behind, then swings under his belly. The body sways and rolls onto the supporting pair.
  (From 3 to 4.9 s in the clip he isn't walking: the camera and he both stay put while he shifts his feet and does
  one long, slow forward reach before setting off.)
* Faster: the same gait with quicker steps and less time on the ground; sprinting blends into a gallop.
* **Turning**: the spine curves into the turn, the head leads it, and he leans in at speed.
* **Slopes**: the walking body tilts with the ground (up to ~35°) so all four feet stand on hills and roofs.
* **Idle**: besides looking around and sniffing, after a few seconds he sits up and washes his face with both paws
  (the ball model's face wash, now as the real raccoon move).
* Carried things ride low on his back; when dropped or thrown they're lifted clear of his round collider first (else
  the physics shoved them away: a regression from the lower ride height that broke feeding Mom and crow trades).

## Jimothy's shape and coat, round 2 (from the human)
* **No body above his head**: the neck used to run over the top of his skull, a 5 cm hump between the ears that
  read as a big forehead. The neck now comes down from the withers into the back of the skull; the skull is the top
  of his head, and the crown has a proper coat of fur instead (his ears stand up out of it, as in the photos).
* **A round back**: the back was a narrow ridge along the spine sitting on the wider ribs and belly (a bell-shaped
  cross-section, with a drop on either side of the spine). It's now one dome swept along the same spine line (the
  approved side profile is unchanged): rounded on top, widest low down.
* **Belly fur that hangs down**: a long, straggly under-fluff from the belly down the lower flanks (up to ~10 cm),
  combed downward, a little lighter, denser toward its ends so it reads as a hanging fringe.
* **A disorderly coat**: fur length varies in random patches (±30 %), a new per-vertex comb direction lays the fur
  back along the body with random per-patch leans, and ~4 cm tufts end at slightly different lengths. Long fur gets
  more shells so its layers don't gap.
* **Stroll key**: hold X to walk at his real, filmed pace (0.65 m/s); on a gamepad, tilt the stick gently.
* **Animation**: planted feet pivot on the ball of the foot / the palm as the heel lifts (they used to slide back),
  he runs lower and quicker with brief airborne moments at walking speed (a running pace), and his feet step in
  place when he turns on the spot.

## Volume, climbing stamina, title pose (from the human)
* **Volume**: master, music and sound effects default to 40 %, and sound effects play at twice their slider level (not
  the music). Players whose volumes were still the old untouched defaults move to the new ones; customised volumes stay.
* **Climbing stamina pays for distance, not time**: a full bar climbs ~11 m of bare wall whether you sprint (2.75 s) or
  not (~4 s); hanging still barely tires him (~1 % a second). Route hints no longer say you must sprint-climb.
* **Title screen**: Jimothy stands and idles (breathing, glancing about, now and then washing his face) instead of
  freezing mid-jump: the paused simulation never ran his ground check, and his idle motion ran on the stopped game clock.

## Ears that grow out of his head (from the human)
* **Connected ears**: the ears stood on the fur above a skull that stopped short of them, so from the front you could
  see daylight between head and ear. The skull is now a little higher and broader, with the muscle on either side
  filling up under each ear, and each ear grows out of a rounded root blended into the skull, so the fur runs
  unbroken from the crown up the back of the ear.
* **Placed from the photos**: the ears sit a touch lower and closer together, lean ~25° outward and tip slightly
  forward (they leaned back before), matching the adult photos (the side photo's ear lines up with the model's when
  overlaid). Hats and the hat fur-clip were re-fitted to the raised skull.

## Every other Jimothy, redone as the real one (from the human)
The player model became the real Jimothy a few rounds ago; everything else that depicted him was still the old ball
with a long ringed tail. Now it all shows the real one (the rolling form, and signs about rolling, stay a ball).
* **Two shared helpers**, so every rendition matches the model:
  * `src/fx/jimothyArt.ts` `drawJimothy()`: the one 2D doodle of him, fitted to the model and the photos: a domed
    back, the head low at the front with no neck, long legs mid-stride with a front paw curled up, a tiny tail puff.
    Every sign, flag, banner, bus-stop ad, shop window, plaque, the mural and the fan T-shirts use it.
  * `src/player/JimothyBake.ts` `bakeJimothy()`: the real model posed by his own animator and frozen into static
    meshes (fur optionally sculpted into the surface, head split off for bobbleheads), for the 3D ones.
* **3D:** the Downtown statue is now a bronze of him mid-stride with his fur and mask carved in (climbable; the
  bobblehead sits on his head). The golden bobbleheads and the stadium's giant one (in a Barnacles jersey and cap)
  are the real Jimothy with a big nodding head. "Round Form #7" is an abstract bronze of him on four long legs. The
  bronze piggy bank at the market is his current rolling ball (short tail now). The Golden Garbage Trophy has a tiny
  gold Jimothy peeking out.
* **Slopothys** are now built from the real model, walking his real gait in mid-air, each with an AI's mistakes: six
  legs, a long neck, a long ringed tail, a third eye, a melting face, extra or wrong ears, giant hands.
  "Suspiciously Normal Jimothy" looks exactly like him (it hovers 3 cm up and casts no shadow). `slopothy.glb` is gone.
* **2D art:** the SlopCorp billboard and posters show an AI getting him wrong (giraffe neck, six legs, a long ringed
  tail); washing reveals a hand-painted real Jimothy. The finale's raccoon firework draws his walking silhouette in
  sparks. The logo's "O", the dialog portraits and the favicon are his real face. Rookie card, cash, newspaper photo,
  stadium banners and the scoreboard's pixel art are all the real him.
* **One of Mom's kits takes after him:** Nugget has his domed back, low head, long legs and tiny tail puff
  (`kit_jimothy.glb`, `tools/blender/build_kit_jimothy.py`), in the kit quest and the finale.
* **Mutators on the new body:** AI Enhanced grows copies of his real legs and a forehead eye and shimmers all over;
  Bobblehead grows his head over his shoulders; Wet Jimothy's fur flattens (it never did before); the Zoomies tail
  helicopter swells his puff; the Rookie carries his bat in his mouth; the crows grip his back; the finale's wave is a
  sit-up-and-wave; the cannon tucks him into a ball with his face peeking out of the muzzle.
* **Text:** only lines his real body contradicts changed ("Tiny Legs, Big Journey" → "Legs For Days", "tiny arms",
  "basically a sphere"…). He's still famously round, so the round jokes stay. DESIGN.md's character sheet and
  AGENTS.md's player-model notes describe the real Jimothy. README screenshots retaken.

## Furry Park tidy-up
* The two picnic tables had been inside Hilltop Lanes since the Big Roll's bowling alley was built on their lawn.
  They now stand on the lawns either side of the viewpoint, in the shade. The two maples behind the viewpoint moved
  too: one's crown poked through the alley's roof staircase and the other brushed its east wall.

## Perfectly Spherical (from the human)
* **The round raccoon at half the volume**: his rolling ball (`jimothy_ball.glb`) was about twice the real Jimothy's
  size; the game now shows it at half the volume (79 % in each direction). It sits lower so it still meets the
  ground (and hugs walls when climbing), and it spins about its own centre a little faster than the physics ball,
  so it rolls without slipping. Carried things ride lower on it to match. The physics ball is unchanged.
* **New mutator, Perfectly Spherical**, unlocked by finishing The Big Roll: be the round raccoon all the time, the
  way the fan art draws him, waddling, climbing, swimming and washing your face on stubby legs. Saves that had
  already finished The Big Roll get it on their next load.
