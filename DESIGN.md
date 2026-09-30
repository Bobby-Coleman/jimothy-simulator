# Jimothy Simulator — Design Bible

> "He's round. He's real. He's washing your phone."

A Goat Simulator–style physics sandbox starring **Jimothy**, the real, round, short-spined wild raccoon
from Seattle's Ballard neighborhood who went viral in July 2026. Browser game: Vite + TypeScript + Three.js + Rapier.

This file is the shared source of truth for everyone (human or agent) working on the game.
Read it fully before writing code or assets.

---

## 1. Tone

* **Unapologetic slapstick** like Goat Simulator: ragdolls, flying pedestrians, explosions, broken physics
  presented proudly as features, absurd score popups ("+250 WASHED A PHONE").
* **Heartwarming** underneath: Jimothy is beloved. The town adores him. He has a mom, possible family,
  crow friends, and he returns lost things. Moments of genuine sweetness between the chaos.
* **Rating: PG.** Cartoon violence only. No blood, no swearing, no alcohol/drug jokes, nothing mean-spirited.
  Jimothy's round shape is *celebrated* ("round boy", "maximum roundness", "no neck and no notes"), **never mocked**.
  His short spine syndrome is not a joke target; he's healthy and happy. He's round, not a literal ball: he has long
  legs and a tiny puff of a tail (§6). "Perfectly spherical" is for fans' hyperbole, the Tuck & Roll ball
  ("aerodynamically a ball") and AI slop getting him wrong.
* **AI slop jokes** (self-aware: this game was built overnight by an AI). Target the *slop*, not people.
  Use fictional parody company names (SlopCorp, PromptFarm), never real AI products/companies.
* Real people: **never name real private individuals.** The woman who first filmed him is "a nice lady with a phone".
* Real organisations/brands get **parody names** (see §5).

## 2. What's real about Jimothy (lore to riff on)

* Wild raccoon living in **Ballard, Seattle**. An unusually short, arched spine gives him a **round, domed back**,
  basically **no neck**, **long legs** for his body length, a **very short tail** and an unusual, high-stepping gait
  (likely short spine syndrome). Experts say he's healthy, no mobility issues or pain.
* July 13 2026: a woman filmed him near the Ballard thrift store. She thought he was **a cat** until he turned around.
  "What am I looking at?" She named him Jimothy because **"he just looked like a Jimothy."**
* 10M+ views in a week. Looks "like a creature out of a video game" / a **cryptid**.
* Seattle City Council declared **"Jimothy Summer"**. University of Washington gave him an **honorary degree**.
  The Mariners held **"Jimothy Night"** (Aug 5) with rookie cards — a **gold-bordered card sold for $20,000+**.
  A Jimothy mascot **won the Salmon Run race** at the ballpark. Murals, tattoos, fan art, bobbleheads
  (proceeds to animal rescue), a search-engine easter egg of him running across the screen, a memecoin (lol).
* **Mostly-AI internet:** almost every viral clip of him *doing things* is AI-generated — him riding dragons,
  casting spells, fighting raid bosses. His real look is so surreal that fakes are hard to spot.
* Nobody owns him — IP lawyers say he's too popular to be owned.
* WA Fish & Wildlife: **please don't approach him**; wild raccoons can carry germs. He's fine on his own.
* Another short-spined raccoon, filmed **rolling across a lawn** in 2025, is sometimes mistaken for him —
  locals wonder if they're **family**. In-game: **"Danny"**, a round raccoon who might be his dad.
* He survived infancy thanks to his **mom's attentive care** → **Mom** lives in the den under the thrift store.

## 3. Core controls

| Action | Keyboard/Mouse | Gamepad |
|---|---|---|
| Move | WASD | Left stick |
| Camera | Mouse (pointer lock) | Right stick |
| Sprint | Shift | L3 / LT |
| Jump / climb | Space (hold against a wall/tree/pole to climb) | A |
| **Grabby Hands** (grab/carry/drag/hang) | Left mouse / E | X / RT |
| **Bonk** (round-boy body slam / headbutt equivalent) | Right mouse / F | RB |
| **Wash** (hold near water while holding something / near an NPC face) | R | Y |
| **Tuck & Roll** (become a ball) | Q (toggle) | B |
| **Flop** (ragdoll) | Z (hold) | LB / D-pad down |
| Chitter (taunt, NPCs go "awww") | C | Up on d-pad |
| Objectives | Tab | Select/Back |
| Pause | Esc / P | Start |
| Photo mode | V | R3 |
| Slow-mo / Respawn / Map | T / H / M | — |

## 4. Mechanics (raccoon-specific, replacing goat-specific ones)

* **Grabby Hands** (replaces the goat's lick): dexterous raccoon hands grab small props (they ride on his back),
  drag big ones (fridges, cars' bumpers, NPC legs), steal held items from humans (phones, coffee, sandwiches), hang
  onto moving cars.
* **Washing** (signature): hold an item near/in water (bay, pond, fountain, puddles, pools, sinks, sprinklers) and scrub.
  Things change when washed:
  * cotton candy → **dissolves**; Jimothy stares at his empty hands. Sad trombone. (+points, objective)
  * cash → "MONEY LAUNDERING" achievement
  * phone → clean & sparkly (and short-circuits)
  * **AI slop things (Slopothys, slop signs) → dissolve/pixelate away**
  * dirty teddy bear → clean (return to sad kid)
  * soap bar → giant bubble burst; fish → clean fish; diploma → soggy; NPC face → they are baffled
* **Tuck & Roll**: with that domed back he's halfway to a ball already. Toggle to tuck his legs in and become one
  (`jimothy_ball.glb`): momentum physics, fast downhill, bowling people over, bounce combos. Canon-adjacent: Danny was
  filmed rolling across a lawn.
* **Climbing**: raccoons climb. Walls, trees, poles, drainpipes, the Space Noodle. Stamina meter.
* **Flop**: ragdoll: he tumbles, long legs flailing. Goat-Sim-style.
* **Bonk**: short lunge + body slam that launches props and NPCs.
* **Dumpster diving**: jump into dumpsters/trash cans to find random items (sometimes rare).
* **Nocturnal**: day/night cycle. At night trash is juicier, Grandma leaves snacks out, eyes glow (eyeshine!).
* **Fans & phones**: NPCs recognise Jimothy, film him (camera flash), shout "JIMOTHY!", ask for selfies.
  The **Wildlife Officer** runs around telling fans "Please don't approach Jimothy!" (protecting HIM from THEM).
* **Score & combos**: every silly act emits a named score popup; chained acts within ~3 s build a combo multiplier.

## 5. The map: "Ballard-ish" (parody Seattle, compressed)

~360 m × 360 m, 3×3 zones of ~120 m, road grid between zones. **+X = east, −Z = north, +Y = up. 1 unit = 1 m.**
Water (Salmon Bay) along the south edge. Hills rise to the north.

```
 NW: SlopCorp AI campus      | N: Residential Hills          | NE: University of Washing
  (data center, billboard,   |  (houses, backyards, pools,   |   (cherry-blossom quad,
   Slopothy spawner, dragon) |   Grandma Rosie, Danny's lawn,|    graduation stage, dean)
                             |   steep rolling street)       |
 W: Gasworks-ish Park + Pond | C: Old Ballard Ave (SPAWN)    | E: Downtown
  (fountain, playground, sad |  (Goodwheel Thrift + den,     |   (City Hall plaza, Jimothy
   kid, crows, picnic)       |   coffee, tattoo, mural, bus) |    statue, Space Noodle)
 SW: The Locks + fish ladder | S: Waterfront + Pike's Plaice | SE: Tee-Hee Park stadium
                             |    Market, Gum Wall, docks    |   (Jimothy Night, Salmon Run)
 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ Salmon Bay ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
```

Parody names: Goodwill → **Goodwheel Thrift**; Space Needle → **Space Noodle**; University of Washington →
**University of Washing**; Mariners → **Ballard Barnacles**; T-Mobile Park → **Tee-Hee Park**;
Pike Place → **Pike's Plaice Market**; Starbucks → **Starbrews** / **Bean Me Up Coffee**; AI company → **SlopCorp**.

## 6. Characters

* **Jimothy** — the real one (`jimothy.glb`, animated by `src/player/JimothyQuad.ts`): a normal-sized raccoon on an
  unusually short, arched spine, so his back is a **round dome**. Virtually **no neck**: the head is carried low at the
  front of the dome, nose pointing down and forward. **Long legs** for his short body, dark toward the paws. A **very
  short**, fluffy tail: a puff with faint rings. A normal raccoon face: black bandit mask, white brows and muzzle,
  round ears with pale rims. Grey-brown coat with a lighter belly fringe that hangs down. His walk is a pace (the legs
  on one side swing together) in which a front paw lifts high and curls. He tucks into a ball to roll
  (`jimothy_ball.glb`, which keeps a short tail). Every rendition of him uses the shared helpers (§9).
* **Mom** — normal-shaped raccoon (longer body), lives in the den. Grooms him. Wants snacks.
* **Danny** — another round raccoon on a lawn in the Hills. Rolls. Might be Dad. Family reunion quest.
* **Kits** — 5 lost baby raccoons around town; follow Jimothy in a line once found; bring them to Mom.
* **Crows** — Seattle crows. Trade: bring shiny washed things, they bring gifts.
* **Humans** — chunky, toy-like, fully ragdollable. Pedestrians, joggers, tourists (film you), fans (Jimothy shirts),
  Wildlife Officer (khaki), fish throwers, Mayor, Dean, Grandma Rosie, Sad Kid, salmon-costume racers, SlopCorp tech bros
  ("We're disrupting raccoons").
* **Slopothys** — AI-generated fake Jimothys: glitchy, shimmering, too many legs/eyes/fingers, melting faces, hover
  slightly, speak slop ("Certainly! Here is a raccoon:", "As a large language raccoon, I cannot wash that.").
  Washing dissolves them. Some ride tiny AI dragons with 7 legs.
* **SlopBot** — a Clippy-like popup assistant that offers unhelpful help. Bonkable.

## 7. Objectives (a.k.a. "Instincts") — examples

Raccoon: Wash 10 things · Wash cotton candy ("Where'd It Go?") · Launder money · Dive into 5 dumpsters ·
Knock over 20 trash cans · Roll 500 m · Bowl over 10 people in one roll ("Strike!") · "Not A Cat" (let someone
say "here kitty kitty", then turn around) · Get filmed by 25 people ("Cryptid Sighting") · Steal 10 things from humans ·
Steal a whole pizza · Climb the Space Noodle · Fall 50 m and survive · Get stuck to the Gum Wall · Catch a thrown fish ·
Win the Salmon Run · Find the gold rookie card · Get your honorary degree (then wash it) · Attend your "Jimothy Summer"
proclamation · Find your mural · Collect 10 golden bobbleheads.
AI slop: Wash away 10 Slopothys · Wash the six-fingered billboard · Unplug SlopCorp ("Touch Grass") · Bonk SlopBot 5× ·
Ride the Slop Dragon.
Heartwarming: Bring Mom 3 snacks · Family Reunion with Danny · Bring all 5 kits home · Trade with crows 3× ·
Return the teddy (washed) to the sad kid · Visit Grandma Rosie at night (she knits you a hat).
Slapstick: Car surf for 10 s · Get launched 30 m up · Ragdoll 10 people at once · Blow up a BBQ propane tank ·
Make the Wildlife Officer scold 10 fans.

## 8. Mutators (unlocked by objectives, toggled in the pause menu)

Honorary Grad (cap & gown, diploma launcher) · Jimothy Summer (sunglasses, eternal sunshine, flowers bloom in your
path) · Rookie (cap & bat: bonk = home-run swing) · AI Enhanced (extra legs, glitch shader — "Enhanced by AI™") ·
Chonk (giant) · Crow Rider (glide with crows) · Wet Jimothy (shrinks when wet… still round) · Space Jimothy
(low gravity, bubble helmet — NASA noticed him) · Grandma's Hat (knitted hat, NPCs extra friendly) · Bobblehead.

## 9. Art direction

Goat Simulator 3 vibe: bright, saturated, sunny stylised-realism; chunky proportions; warm golden sun, soft shadows,
ambient occlusion, bloom, light fog to the horizon, Mount-Rainier-ish silhouette in the distance. Toy-like props.
Jimothy is the most detailed thing on screen (fluffy shell-fur). Humans are chunky toys. Signs are canvas-drawn
with parody names; AI slop signs have garbled text ("BEST ESPRSSO SINCE 20§3").
Every rendition of Jimothy in the world comes from two shared helpers (use them, don't fork them, never draw the old
ball): **`drawJimothy(ctx, x, y, r, opts)`** in `src/fx/jimothyArt.ts`, the 2D side profile mid-stride for signs,
murals, flags and ads (face-on icons draw his real face: mask, brows, muzzle, round pale-rimmed ears); and
**`bakeJimothy(game, opts)`** in `src/player/JimothyBake.ts`, the real model posed by his own animator and frozen into
static meshes for statues, bobbleheads and figures.

## 10. Tech conventions

* **Units** meters, Y-up, right-handed (Three.js default). Jimothy: a **0.38 m** ball collider; the model is ~0.7 m
  tall and ~0.85 m nose to tail. Humans 1.75 m. Cars ~4.3 m long. Trash can ~1 m tall. Doors 2.1 m.
* **Stack**: three, @dimforge/rapier3d-compat, postprocessing. Vite dev server `npm run dev`.
* **Source layout** (`src/`):
  * `core/` engine: `Game.ts`, `Physics.ts`, `Input.ts`, `Assets.ts`, `Events.ts`, `Renderer.ts`
  * `player/` Jimothy controller, model, camera
  * `world/` terrain, roads, water, sky, zones (`world/zones/*.ts`, one file per zone)
  * `entities/` props, NPCs, animals, vehicles, slop
  * `gameplay/` score, objectives, washing, quests, mutators, collectibles
  * `audio/` sound manager + synthesized sounds
  * `ui/` HUD, menus, popups (DOM overlay, CSS in `src/ui/styles.css`)
* **Systems** implement `System` from `src/core/Game.ts` and are registered in `src/systems.ts`.
* **Entities**: every physics object that gameplay cares about is registered with `game.entities` so a collider
  handle maps back to an `Entity` (kind, name, flags like `grabbable`, `washable`, callbacks `onWash`, `onBonk`, …).
* **Events**: `game.events.emit(name, payload)` / `on(name, fn)`. Common: `score`, `wash`, `grab`, `bonk`,
  `npcRagdoll`, `objective`, `mutator`, `trashTipped`, `filmed`.
* **Licensing**: only CC0 (Kenney, Quaternius, Poly Haven, ambientCG, OpenGameArt-CC0) or our own generated assets.
  OFL/Apache fonts are OK. Record every third-party asset in `CREDITS.md`.
* **Public repo**: the game ships publicly on GitHub Pages. No secrets, no real people's names, no trademarked logos.
* Keep it running at 60 fps on a mid-range laptop at "Medium" quality: instancing, merged static geometry,
  sleeping physics bodies, simple colliders (boxes/capsules/balls) over trimeshes.
