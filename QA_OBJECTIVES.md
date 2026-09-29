# Instincts QA — can every objective actually be done?

QA pass over all 50 objectives ("Instincts"), 2026-09-29 night, against a production build
(`?skipintro&time=12&weather=clear`). Every objective was attempted with **real inputs** — virtual stick/buttons,
teleports to the right place, grabbing real items, washing in real water, bonking real NPCs, riding real cars/dragons,
real dialogs advanced with key presses. Nothing was completed by emitting gameplay events.

**Result: 50/50 completable. 37 ✅ verified as shipped · 13 ⚠️ fixed in this pass · 0 ❌ blocked.**
(One secret, *Back From The Void*, is only possible thanks to the new raccoon cannons in `src/gameplay/extras` — see
its row.)

Automated: `node tools/playtest.mjs --url http://127.0.0.1:5198/ --group obj` runs one scenario per objective (+ a
feedback check and a save/reload check) in ~4 min; long grinds are checked for progress and extrapolated unless
`--full` is passed (~6 min). Last runs: 52/52 scenarios pass (the propane lob into a crowd is the only flaky one,
so it gets 3 tries). Build + serve first:
`npx vite build --outDir tools/_downloads/qa_build --emptyOutDir` then
`npx vite preview --outDir tools/_downloads/qa_build --port 5198 --strictPort`.

**Legend** ✅ verified (works as shipped) · ⚠️ fixed in this pass · ❌ blocked · 🔒 secret (hidden until done) ·
**Time** = rough time for a player who knows where to go.

## Where things are (map: +X east, +Z south; spawn is the alley behind Goodwheel Thrift, Old Ballard)

| Place | Where |
|---|---|
| Mom's den, hot dog + cotton candy carts, the mural | Old Ballard: den in the alley behind Goodwheel Thrift (spawn); carts + mural in the *Jimothy Commons* plaza just east of it |
| Dumpsters | Old Ballard back alleys (2 on each side of Ballard Ave) |
| Pike's Plaice fish stall, Gum Wall | Waterfront (south-centre): fish stall in the market arcade; Gum Wall = Post Alley on the market's west side |
| City Hall (podium, Wildlife Officer, fountain, Jimothy statue), Space Noodle | Downtown (east) |
| Tee-Hee Park (Salmon Run, dugout, Jimothy Night Cannon) | south-east stadium |
| Gasworks-ish Park (pond, crow tree, sad kid, picnic blanket, gasworks towers) | west |
| Residential Hills (Danny's lawn, Grandma Rosie, backyard pools/trampolines/BBQ propane tanks) | north-centre |
| University of Washing (graduation stage, library tower) | north-east |
| SlopCorp campus (server plug, billboard catwalk, dragon pad, Prompt Portal) | north-west |

## The list

### Raccoon Instincts

| # | Instinct | Status | How to do it | Time | Notes |
|---|---|---|---|---|---|
| 1 | **Squeaky Clean Machine** — wash 10 things | ⚠️ | Grab anything (E / LMB), hold Wash (R) next to water: puddles, fountains, the pond, the bay, sinks, sprinklers — or anywhere while it rains. NPC faces, Slopothys and the billboard count too. | 2 min | Re-washing the same item counted every time (10 scrubs of one sock = done). Now 10 *different* things. |
| 2 | **Where'd It Go?** — wash cotton candy | ✅ | Cotton candy cart in the Commons plaza (next to spawn), wash it in the alley puddles. Also carried by kids/tourists and on the park cart. | 30 s | Its reward popup was shaved by the score anti-spam (see *Feedback*); fixed. |
| 3 | **Money Laundering** — wash cash | ⚠️ | A wad of cash lies on the Pike's Plaice fish counter (west end of the ice display); wash it in the stall sink behind the counter (or any water). | 2 min | There was **no cash in the world** except ~1 % dumpster loot and a random crow gift → added the wad. |
| 4 | **Water Resistant\*** — wash a phone | ✅ | Grab a person holding a phone (fans, tourists, tech bros) → you steal it → wash it. | 1 min | |
| 5 | **Dumpster Diver** — dumpster diving ×5 | ⚠️ | Jump onto a dumpster (or drop in from above). Each dumpster pays out once per 15 s. | 1–2 min | Needed 5 *different* dumpsters but town only has 4 → counts dives now. Jumping onto one from the street "fell" only 0.1 m and didn't count (needed 0.6 m) → any real landing counts. |
| 6 | **Trash Panda Tornado** — tip 20 trash cans | ⚠️ | Bonk (F / RMB) or roll into cans. 85 cans in town; cans you knock into other cans count. | 3–5 min | Cars and pedestrians tip ~1 can a minute somewhere in town and those counted, so it finished itself after ~30 min of play → only cans Jimothy touched (or that tip within 15 m of him) count now. |
| 7 | **Round Boy** — roll 500 m | ✅ | Tuck & Roll (Q), hold Sprint. Cumulative. The long cross-town avenues are fastest (mind the cars); the waterfront promenade is car-free. | 45 s rolling | Unlocks **Chonk**. |
| 8 | **Not A Cat** — let someone say "here kitty kitty", turn around | ✅ | Stand with your back to a pedestrian/tourist/fan/tech bro 2–6 m away; when they call "here kitty kitty" and tiptoe closer, turn to face them. | 1–3 min | Global 22 s cooldown + a dice roll, so it can take a few tries. |
| 9 | **Cryptid Sighting** — get filmed by 12 different people | ⚠️ | Walk up to people with phones/cameras (tourists, fans, tech bros, some pedestrians) and let them notice you. Don't chitter at them — an "awww" interrupts filming. | 5–10 min | Target was 25 but only ~17–25 people with phones/cameras exist per game, spread over the whole map → 12. Counts accumulate across sessions. |
| 10 | **Five-Finger Discount** — steal a whole pizza | ⚠️ | A whole pizza sits on the picnic blanket in Gasworks-ish Park (by the basket). Pedestrians sometimes carry one — stealing that works too. | 1 min | Pizzas only appeared by luck (4 % of pedestrians, rare bin spill) → added the picnic pizza. |
| 11 | **Sticky Fingers** — steal 10 things from humans | ⚠️ | Grab people holding phones, coffee, ice cream, cotton candy, sandwiches. | 3–5 min | Steal → give back ("Returned It!") → steal again counted 10 times in 20 s → now 10 *different* items. |
| 12 | **Sticky Situation** — get stuck to the Gum Wall | ✅ | Walk into the Gum Wall (Post Alley, west side of the market). | 10 s | |
| 13 | **Climb the Space Noodle** | ✅ | Downtown. Use the maintenance ladder on the east side (ladders barely tire him; bare walls tire him 4× faster) and rest on the landings/red ledges (stamina refills on your feet). Completes near the top deck. | 30 s | Unlocks **Space Jimothy**. |
| 14 | **Nocturnal** — 60 s out at night | ✅ | Just keep playing: night is 21:24–05:00 and a 24 h day takes 20 real minutes, so night falls ~10 min after the 9:30 start. | auto | |
| 15 | **Bath Time** — swim in 4 kinds of water | ✅ | Kinds deep enough to swim: bay/canal, park pond, fountains (City Hall, the park, UW — jump in beside the centrepiece), backyard pools (Hills), fish-ladder pools (Locks), SlopCorp server coolant. Puddles/sinks/sprinklers are too shallow. | 5 min | Unlocks **Wet Jimothy**. |
| 16 | **Tiny Legs, Big Journey** — walk 2 km | ✅ | Walking/sprinting on foot (not rolling), cumulative. | 4 min sprinting | Unlocks **Zoomies**. |
| 17 | **Catch of the Day** | ✅ | Pike's Plaice fish stall: stand in the aisle, the fishmonger lobs a fish every ~8 s; walk under the ring with empty paws (or grab it mid-air). | 30 s | |
| 18 | **Bobblehead Collector** — 10 golden bobbleheads | ⚠️ | Follow the light beams (standing near one shows a route hint). Bare walls tire Jimothy after ~7 m of climbing (~11 m sprinting, hold Shift); standing on a ledge refills stamina in ~2 s. Spots: grunge-shop roof (Old Ballard: sprint-climb the east end of the donut shop next door, rest on its roof, climb the Grunge & Sons side wall; or from the first fire-escape landing at the back), alley by the east dumpster, **top of the street clock** (climb the shop front behind it and wall-jump across), Space Noodle restaurant roof (up the Noodle's east ladder, rest on the deck, climb the 4.5 m of glass just north of the west door), City Hall dome (up the grand steps, climb the stepped pier at a front corner of the portico, rest on its ledge, sprint up the rest and pull up onto the pediment, rest, walk up it and hop the parapet; hop onto the drum plinth, rest, sprint up the drum and dome), the Jimothy statue's head (City Hall plaza), Grandma Rosie's roof ridge (climb her back wall, ~5 m, and walk up the shingles; the porch roof bonks your head), UW library tower (sprint-climb the brick buttress in the nook west of the tower, rest on its stone top, climb onto the slates, walk up beside the tower, climb its last ~5 m), crow's nest in the crow tree (jump for the rope ladder dangling from the nest), top of a gasworks tower (sprint-climb the fat valve pipe standing against its east-northeast side, rest on its top, climb the last ~7.5 m). | 20–30 min | The gasworks one sat on the tallest tower, whose catwalk blocks climbers from below (unreachable) → moved to the neighbouring tower without a catwalk. Climbing nerf (bare walls ≈ 7 m): helper ladders were added, then most were taken out again for challenge (kept: crow's-nest rope ladder, Space Noodle ladder, SlopCorp billboard mast ladder). Ladder-free routes, scripted from the ground with real stamina (careful = rest + sprint, naive = one straight climb at walking pace): Grunge 9.7 s, lowest stamina 21% (naive: donut front tops out 1 m short; front of the Grunge 8 m short; no rest on the donut roof: 0.4 m short); City Hall 19.7 s, 9% (naive: pier 1.6 m short, south facade 7.7 m short walking, 4.4 m short sprinting); UW library 13.8 s, 19% (naive: buttress 1.3 m short, facade 6 m short); gasworks 9.6 s, 8% (naive: riser 1.5 m short, east face 8 m short, no rest on the riser: 4 m short); Rosie back wall 1.9 s of climbing, 38%; Noodle glass 1.7 s, 44%. Unlocks **Bobblehead**. |

### Slop Patrol

| # | Instinct | Status | How to do it | Time | Notes |
|---|---|---|---|---|---|
| 19 | **Wash Away The Slop** — 10 Slopothys | ✅ | Grab a Slopothy and wash it, bonk/throw it into water, or wash it where it stands next to water. Say **"Generate"** (3) to SlopBot for 12 tiny ones around you. Washing SlopCorp's slop signs also counts. | 3 min | Description now mentions the slop signs (they always counted). |
| 20 | **Touch Grass** — unplug SlopCorp | ✅ | SlopCorp campus: grab the giant plug (it's heavy — you drag it) and walk backwards. | 1 min | Unlocks **AI Enhanced**. Reward popup was shaved by anti-spam (see *Feedback*); fixed. |
| 21 | **Don't Show This Again** — dismiss SlopBot ×5 | ✅ | SlopBot pops in ~90 s into a session and then every ~4 min: press 1/2/× or Bonk him. Ignoring him doesn't count. | ~18 min of play | Timer-gated by design. |
| 22 | **Count To Five** — wash the six-fingered billboard | ✅ | SlopCorp billboard: at the uphill (+x, east-ish) end, jump onto the yellow ladder on the grey service mast (sign on it) and hold forward (~2.5 s, ladder rate) — he mantles onto the catwalk landing. Anywhere on the catwalk, face the billboard and hold Wash 3× (water in the gutter along the face's foot; buckets hang off the rail). Check: walking the catwalk never auto-climbs the rails/face, camera stays ~5 m back. | 1 min | |
| 23 | **Seven-Legged Steed** — ride the Slop Dragon | ✅ | Wait at the dragon pad (SlopCorp) until it lands, then grab it. | 0–3 min | Doesn't count as car surfing (checked). |

### Heartwarming

| # | Instinct | Status | How to do it | Time | Notes |
|---|---|---|---|---|---|
| 24 | **Mama's Boy** — bring Mom 3 snacks | ✅ | Grab food (the hot dog cart is 20 m from the den), carry it to Mom at the den, drop it (E) near her. ×3. | 1 min | |
| 25 | **Family Reunion** — Danny | ✅ | Danny's lawn in the Hills: chitter (C) at him, then Tuck & Roll within 3 m of him for 5 s. Advance the little dialog (Space/E/click). | 1 min | Description now says "…and roll with him". |
| 26 | **Kit Collector** — bring all 5 kits home | ✅ | Kits whimper at: Commons plaza, City Hall fountain, the Hills, UW, a waterfront dock. Touch or chitter → they follow in a conga line → walk back to the den. They catch up if you get far ahead (don't roll/flop: the line scatters). | 10 min | Unlocks **Tiny**. |
| 27 | **Crow Deals** — trade with the crows ×3 | ✅ | Leave something shiny **or freshly washed** (wash anything first) by the crow tree in Gasworks park, step back; a crow swaps it for a gift. | 1 min each | Description now mentions washed things. Unlocks **Crow Rider**. |
| 28 | **Teddy Rescue** | ✅ | The muddy teddy lies in Gasworks park; wash it and carry it to the crying kid. | 2 min | |
| 29 | **Grandma's Favorite** | ✅ | Grandma Rosie's porch (Hills) **at night**; walk up to her, advance the dialog. By day she says "come back tonight". | 1 min at night | Unlocks + equips **Grandma's Hat**. |
| 30 | **Honorary Degree** | ✅ | University of Washing: walk onto the graduation stage, advance the dean's speech. | 1 min | Unlocks **Honorary Grad**. Washing the diploma afterwards is a bonus gag. |
| 31 | **Jimothy Summer** | ✅ | City Hall: walk up the steps to the podium, advance the mayor's speech. | 1 min | Unlocks **Jimothy Summer**. |
| 32 | **Salmon Run** | ✅ | Tee-Hee Park: step onto the start line, wait for GO, sprint (or roll) along the cones. Won in ~10 s sprinting. | 1 min | Unlocks **Rookie** too (see bugs). |
| 33 | **Rookie Card** | ✅ | Glowing gold card in the dugout at Tee-Hee Park — grab it. (Washing it "devalues" it, for fun.) | 30 s | Unlocks **Rookie**. |
| 34 | **Awww** — chitter at 15 different humans | ✅ | Chitter (C) within ~6 m of people. | 3 min | |
| 35 | **Local Celebrity** — 100,000 points | ✅ | Score 100k **in one session** (the score isn't saved). The QA run hit 127k in one sitting of objective hunting; objectives alone are worth ~90k, combos multiply. | ~1 h | |

### Glorious Chaos

| # | Instinct | Status | How to do it | Time | Notes |
|---|---|---|---|---|---|
| 36 | **Strike!** — bowl over 5 people in one roll | ✅ | Stay in roll mode and bowl through people; one roll can last as long as you like (the market/waterfront crowds are best). | 1–2 min | Slow rolls knock people down without a "bonk", now those count too. |
| 37 | **Chain Reaction** — ragdoll 5 people within 5 s | ⚠️ | Carry a propane tank from a Hills backyard BBQ to a crowd — the Jimothy Summer ceremony crowd at City Hall (6 people) or the graduation crowd (5) — and throw it (Bonk while carrying) into them. | 5 min | Was 10 people: the whole town has ~60 people spread over 360×360 m (never 10 in one place). Also explosion knockdowns didn't count at all (NPCs report them as cause *impact*, not by the player). Now 5, counting explosions; traffic accidents, falls and anything > 30 m away don't count (they used to creep it up while idling). |
| 38 | **Kaboom** — blow something up | ✅ | Bonk a propane tank (Hills BBQs) twice, or throw it. | 30 s | |
| 39 | **Car Surfer** — hang onto a moving car 10 s | ✅ | Stand beside a road and grab the side of a passing car; Jump/E to let go. | 1 min | |
| 40 | **Leap of Faith** — fall 25 m and walk it off | ⚠️ | Jump off the Space Noodle, a tall roof, or out of the Slop Dragon / a cannon flight. | 1 min after the Noodle | Falls were measured from the highest point **while climbing**, so climbing *down* a 25 m wall counted, and respawning (H) mid-fall "landed" a 60 m drop at spawn → now measured from where he lets go. |
| 41 | **Frequent Flyer** — get launched 8 m up | ⚠️ | Bounce on a backyard trampoline **holding Jump** ("Mega Boing"), or ride a raccoon cannon. | 1 min | Was 30 m: impossible without mutators (trampoline ~9 m, explosions ~4 m), and teleports/respawns counted as launches → 8 m, progress shown live while bouncing, teleports ignored. |
| 42 | **Look Both Ways** — get bonked by a car | ✅ | Stand in the road. He's fine. | 10 s | |
| 43 | **Flop Era** — ragdoll 25 times | ✅ | Flop (Z) 25 times; any ragdoll counts. | 20 s | |
| 44 | **Please Don't Approach Jimothy** — the officer scolds 10 fans | ⚠️ | City Hall plaza (Downtown): stay right next to Jimothy fans (≤ 3 m) while the Wildlife Officer is nearby; each fan can be scolded again 12 s later. | 2–3 min | There is exactly one officer (City Hall) and in ~1 game in 5 no fan spawned near him → added one superfan who hangs around the officer. |
| 44a | **Return From Whence You Came** — throw an animal into the ocean (new) | ✅ | Waterfront: three seagulls with attitude loaf on the promenade railing (x ≈ -16), on Pier A by the gap in its east railing, and on a marina bollard off Pier C. Grab one (E), face the bay and throw it (Bonk while carrying), or just bonk it off its perch. It splashes down, complains, and flies back to its spot. | 30 s | Counts any animal Jimothy threw or knocked flying that lands in Salmon Bay (water kind `bay`, incl. the ship canal) within 5 s; the pond and fountains don't. Mom, the kits and Danny don't count (a thrown kit just paddles back into the conga line; a hint says so). Crows and cats can't be grabbed. Scripted: grab + throw from the promenade, bonks from all three perches, throw through the Pier A gap; a gentle drop on the deck doesn't count. `obj_whenceYouCame` in `--group obj`. |

### Secrets 🔒

| # | Instinct | Status | How to do it | Notes |
|---|---|---|---|---|
| 45 | 🔒 **Human Made** — admire the mural | ⚠️ | Stand still in the Commons plaza looking at the Jimothy mural (west wall) for a moment — or take a photo of it in photo mode (V). | Completed by just grabbing cotton candy at the cart 3 m away → now needs actually looking at it. |
| 46 | 🔒 **Hydrophobic?** — swim 60 s | ✅ | Swim a total of 60 s. | |
| 47 | 🔒 **He Never Learns** — wash cotton candy ×3 | ✅ | Wash three cotton candies. | |
| 48 | 🔒 **Back From The Void** — fall out of the world | ✅* | Enable **Space Jimothy** (climb the Noodle), then take the **Bay Blaster** cannon on the Space Noodle deck: at 30 % gravity the arc clears the invisible sea wall and he falls off the edge of the world. | *Only possible via the new cannon (`src/gameplay/extras`): the map is walled to 90 m and the ground has no holes. If the cannon changes, this goes back to ❌. |
| 49 | 🔒 **You Spin Me Right Round** — roll 60 s non-stop | ✅ | Roll for a minute without stopping (stalls < 2.5 s are forgiven). Avoid roads (a car hit ends the roll) and the stadium (the cannon eats rolling raccoons). | |
| 50 | 🔒 **Mutant Raccoon** — 5 mutators at once | ✅ | Pause › Mutators. Hats and sizes are exclusive, so e.g. Chonk + AI Enhanced + Space Jimothy + Wet Jimothy + Zoomies (all from raccoon/slop Instincts). | |

## Mutators and what unlocks them

| Mutator | Unlocked by | Mutator | Unlocked by |
|---|---|---|---|
| Chonk | Round Boy | Crow Rider | Crow Deals |
| Space Jimothy | Climb the Space Noodle | Grandma's Hat | Grandma's Favorite |
| Wet Jimothy | Bath Time | Honorary Grad | Honorary Degree |
| Zoomies | Tiny Legs, Big Journey | Jimothy Summer | Jimothy Summer |
| Bobblehead | Bobblehead Collector | Rookie | Rookie Card (and, currently, winning the Salmon Run) |
| AI Enhanced | Touch Grass | Tiny | Kit Collector |

All 12 were unlocked by playing during the QA runs (the "Mutator unlocked!" toast + `mutator_unlock` sound were checked
on AI Enhanced; every reward goes through the same path).

## Feedback & saving (checked)

* **Toast** ("Instinct complete!" / "Secret Instinct found!"), **score**, **fanfare** (`objective_complete`) and, for
  rewarded ones, the **mutator toast + sound** all fire on completion.
* ⚠️ **Score:** the reward popup used the objective's title as its label; for *Where'd It Go?*, *Money Laundering*,
  *Not A Cat* and *Touch Grass* the act that completes them scores a popup with the **same** label a moment earlier,
  so the score system's same-label anti-spam cut the reward (Touch Grass paid 3,125 instead of 5,000). The reward
  popup is now labelled "Instinct: …" and always pays in full.
* **Saving:** progress persists in `localStorage['jimothy.objectives.v1']` (plus `jimothy.content.v1` for Bath Time's
  water kinds, `jimothy.collectibles.v1` for bobbleheads, and the heart/landmark quests' own saves). Verified across a
  page reload: every completed Instinct and unlocked mutator survived.
* ⚠️ **Rebalanced targets:** a save made before a target was lowered (e.g. 20/25 filmed, target now 12) would have been
  stuck forever (progress never goes down, so it never "reaches" the new target). Such saves now complete on the first
  frame of play (checked with a reload).
* Nothing completes at startup or by idling at spawn (checked on a fresh profile). The only one that completes just
  by playing long enough is Nocturnal; SlopBot ×5 is timer-gated but still needs you to dismiss him.

## Code changes in this pass

| File | Why |
|---|---|
| `src/gameplay/content/ObjectiveContent.ts` | wash10 / stickyFingers count distinct things; dumpsterDiver counts dives; trash tips and chain-reaction ragdolls must be Jimothy's doing (by him or near him — no more progress from traffic across town); Chain Reaction counts explosion knockdowns; Strike also counts roll knockdowns; launch tracking rewritten (live progress, teleport-proof); Human Made needs you to look at the mural (or photograph it); saves above a lowered target complete on load; header table updated |
| `src/gameplay/content/objectiveDefs.ts` | targets: Cryptid 25→12, Chain Reaction 10→5, Frequent Flyer 30→8 m; descriptions for Dumpster Diver, Wash Away The Slop, Family Reunion, Crow Deals, Chain Reaction, Frequent Flyer |
| `src/gameplay/Objectives.ts` | reward popup label "Instinct: …" so the score anti-spam can't shave it |
| `src/player/Jimothy.ts` | fall height ("land" event) is measured from where he lets go of walls/cars/water, and a respawn/teleport is never a fall |
| `src/gameplay/items/ItemsSystem.ts` | jumping onto a (plain) dumpster from the street counts as a dive (landing threshold 0.6 → 0.05 m) |
| `src/world/zones/south/Park.ts` | gasworks bobblehead moved to the catwalk-free tower; whole pizza on the picnic blanket |
| `src/world/zones/south/Waterfront.ts` | wad of cash on the fish counter |
| `src/world/zones/central/Downtown.ts` | one fan spawn next to the Wildlife Officer |
| `tools/playtest.mjs` | `--group obj [--full]`: one scenario per objective + feedback + save/reload/rebalance checks |

## Bugs noticed in systems I didn't touch

* `src/gameplay/quests/heart/ctx.ts` `clearAngle()`: the `THREE.Raycaster` has no `.camera`, so every heart cutscene
  (Danny, Grandma…) spams `THREE.Sprite: "Raycaster.camera" needs to be set…` (21 console errors per QA run). Fix:
  `rc.camera = this.game.camera` after creating it.
* `src/gameplay/quests/landmarks/events/SalmonRun.ts` `win()` calls `this.complete('rookie')`, unlocking the Rookie
  mutator for the Salmon Run, while the Instinct list and the mutator's unlock hint say the Rookie Card unlocks it.
  Suggest `this.complete()` (the objectives system already hands out rewards) — or change the hint/reward.
* `src/entities/npc/Npc.ts` `onBonk()`: explosions reach NPCs through `onBonk` (items `explode()`), but
  `isPlayerBonk()` only looks at Jimothy's distance/bonk time, so propane/fireworks knockdowns are cause `impact` with
  `byPlayer: false` → no "Launched …" score, and `NpcSystem.processExplosion` never gets to knock them down itself.
  (Chain Reaction works around it.)
* `src/gameplay/extras/RaccoonCannon.ts`: the Bay Blaster (scale 0.72) only loads when approached from some sides —
  from the north Jimothy stalls 1.13 m from the breech while `wantsLoad()` needs ≤ 1.05 m.
