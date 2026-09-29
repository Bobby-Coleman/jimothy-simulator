# Human NPCs (`src/entities/npc`)

Chunky toy-like humans that wander Ballard, gawk at Jimothy, film him, get yeeted, float, get back up and
complain about it. System name: **`npcs`** (`game.get<NpcSystem>('npcs')`).

| File | What |
|---|---|
| `NpcSystem.ts` | the System: population, LOD/culling, physics & event hooks, knockdown scoring, officer logic |
| `Npc.ts` | one human: brain (state machine), kinematic walker, reactions, public API |
| `HumanModel.ts` | procedural model: ONE skinned mesh per human (vertex colors, 11 rigid bones) + face decal (+ shirt print) |
| `Looks.ts` | per-type outfits / random appearance (`randomLook`), `TYPE_INFO` (display names, speeds, what they carry) |
| `Face.ts` | canvas faces (6 expressions + "freshly washed" sparkle variant) and shirt prints (JIMOTHY fan tee, SlopCorp vest) |
| `Animator.ts` | procedural walk/run/idle + blended gestures + get-up blend |
| `Ragdoll.ts` | 11-body jointed ragdoll (spherical + revolute joints with limits) |
| `Items.ts` | held items (phone, coffee, sandwich, pizza, ice cream, cotton candy) as real grabbable props |
| `Speech.ts` | fallback canvas bubbles + camera-flash sprites (only used when the UI / FX don't handle the events) |
| `lines.ts` | dialogue (PG, affectionate) |

## Population
On the first frame the system spawns from `world.npcSpawns` (scaled to 30–50 people; `types` may contain any
`NpcType` or `'family'` = parents/kids/grandma). At least one Wildlife Officer is added if no spawn asked for one.
If `npcSpawns` is empty, ~20 test humans appear near (0,0) and the player spawn. Spawning later works any time:

```ts
const npcs = game.get<NpcSystem>('npcs')!;
const dean = npcs.spawn({
  type: 'dean',                       // pedestrian jogger tourist fan officer fishmonger mayor dean grandma kid racer techbro
  position: new THREE.Vector3(x, y, z), // feet; snapped to the floor just below
  name: 'Dean Soapington',            // used in popups ("Yeeted Dean Soapington")
  outfit: { top: 0x3b1f6b, hat: 'mortarboard' },   // Partial<Look> overrides
  wander: { center, radius },         // default: 10 m around the spawn
  path: [p0, p1, p2], pathLoop: false, // stroll along a polyline instead
  stationary: true,                   // stays put, walks back to the spot after getting knocked over
  lookAtPlayer: true,
  holding: 'phone',                   // 'phone'|'coffee'|'sandwich'|'pizza'|'icecream'|'cottoncandy'|null (default: random per type)
  facing: Math.PI,                    // yaw, 0 = +Z
  passive: true,                      // no automatic reactions (notice/film/selfie/flee/kitty); physics still apply
  seed: 42,                           // deterministic look
});
```

## `Npc` API
```ts
npc.entity            // Entity (kind 'npc', tags: npc washable human <type>). entity.data.npc === npc.
npc.type, npc.name, npc.state, npc.expression, npc.position (feet), npc.yaw, npc.held (item Entity | null)
npc.ragdolled, npc.alive, npc.removed, npc.isCustom, npc.rig (model), npc.look

npc.say(text, secs = 2.6)            // emits 'speech' {entity, text, duration, npc}
npc.setExpression('neutral'|'happy'|'shock'|'aww'|'angry'|'sad')
npc.walkTo(pos, speed?|{run, arrive, speed}) → Promise<boolean>   // true on arrival; pauses during knockdowns
npc.stop(); npc.release()            // stop & stay / go back to wandering
npc.lookAt(pos | 'player' | null); npc.face(yaw | pos)
npc.gesture = 'wave'                 // pose override: wave cheer point film phone camera selfie panic shrug aww scold
                                     // fist eat shock dust baffled kitty throw hold ('none' clears; ~4 s unless custom)
npc.emote('cheer', secs); npc.cheer(secs)
npc.ragdoll(impulse?, cause = 'script')   // impulse in N·s for a ~70 kg body, e.g. (0, 500, 300)
npc.knockDown({ cause, impulse?, point?, dv?, byPlayer?, flail?, by? })   // full control
npc.getUp()
npc.teleport(pos, yaw?)
npc.giveItem('pizza')                // spawn & hold an item
npc.setCustom((npc, dt, game) => { ... } | null)   // scripted control instead of the brain (walkTo/say/gesture still work)
npc.onInteract = (kind, item?) => boolean|void     // 'chitter' (≤4 m) | 'grab' | 'give' (item dropped ≤2.2 m) | 'wash'
                                                   // return true to consume (no ragdoll/steal/wash score)
npc.handPos(out), npc.headPos(out)
npc.remove()
```

System helpers: `spawn`, `fromEntity(e)`, `near(pos, r, filter?)`, `byType(t)`, `alarm(point, radius, cause)` (make
bystanders flee/film), `clear()`, `populate()`, `findSpot(center, r)`, `onRoad(x, z)`.
Knobs: `drawBubbles`, `maxRagdolls` (12), `maxPopulation`/`minPopulation`, `kittyChance` (0.55), `friendly` (auto).

## What they do
* **Notice** Jimothy within 9 m (fans 12 m, needs line of sight): pedestrians "aww"/"Is that JIMOTHY?!", tourists &
  techbros film, fans film or run up for **selfies** (they stand with their back to him, phone up). Joggers, racers and
  officers shout a line and keep going.
* **Filming**: camera flashes → `'cameraFlash' {position, by}`; `'filmed' {by}` at most once per person per 20 s.
* **Wildlife Officer** patrols; when a fan / selfie-taker gets within 3 m of Jimothy an officer (≤45 m) hurries over,
  scolds ("Please don't approach Jimothy!") → `'officerScold' {fan, officer}`; the fan apologises and backs off.
* **Not a cat**: someone who sees Jimothy from behind (≤6 m) goes "Here kitty kitty…" and sneaks up; if he turns to face
  them within ~4 s (+3 s second chance) they shriek "WHAT AM I LOOKING AT?!" and faint → `'notACat' {npc, entity}`,
  `score(300, 'Not A Cat')`. Global 22 s cooldown.
* **Chaos** (knockdowns, explosions, thrown props nearby) → bystanders flee screaming (PG), tourists film it, kids cheer,
  officers point. **Chitter** → nearby people "Awww!".
* **Stealing**: grabbing someone who holds an item hands Jimothy the item (the player emits `'steal'`); they yell "HEY!"
  and chase for ~5 s. Drop it next to its owner → "You brought it back!" (+150 `Returned It!`, `'itemReturned'`).
  Knocked-down people drop their item and walk back to pick it up (or chase you if you took it).
* **Grabbing** an empty-handed person ragdolls them and Jimothy drags them around (the NPC entity's `body` is the chest
  ragdoll body while ragdolled, so the player's drag code just works — no bogus `'steal'`).
* **Washing** a face → sparkly clean face, baffled pose, "…thank you?", `score(80, 'Free Face Wash')`, `'npcWashed'`.
* **Grandma's Hat** mutator: more awws + `'hearts'`, far less fleeing, officers mostly let it slide.
* **Rookie** mutator `'homeRun'` → the whole ragdoll is launched (not just the torso).

## Ragdolls
Causes: `bonk`, `roll` (bowling), `prop` (thrown/flying things), `vehicle` (kinematic cars via collision events, dynamic
ones via contact forces, and the vehicle system's `onBonk` calls), `player` (a flying Jimothy), `ragdoll` (flying humans
hitting others — dominoes), `explosion`, `grab`, `fall` (dropped more than ~1.5 m), `faint`, `script`.
Bodies: pelvis, chest, head, upper/lower arms, thighs, shins(+shoes); group `G.RAGDOLL`, floats in water (the water
system reads `entity.data.floatRadius/buoyancy`). They flail while airborne, get up after resting ~2.5 s (kids 1.2 s,
max 14 s), with a blended stand-up animation. Max 12 at once (oldest get up). Floating > 10 s → they swim home
(respawn at a dry spot near home).

Scores (Jimothy-caused only): Human Bowling, Yeeted a Tourist / the Mayor…, Tiny Tumble (kids), Sorry, Grandma!,
Direct Hit!, Raccoon Cannonball, Human Dominoes, Launched a …, Grabby Hands, Air Juggle, Frequent Flyer / Orbit Achieved
(big air), **STRIKE!** (3+ knockdowns within 1 s → also `'strike' {count}`).

## Events
Emitted: `speech`, `npcRagdoll {entity, cause, byPlayer, by?, npc, position}`, `npcGetUp {entity}`, `filmed {by}`,
`cameraFlash {position, by}`, `officerScold {fan, officer}`, `notACat {npc, entity}`, `strike {count}`,
`npcWashed {entity}`, `itemReturned {entity, to}`, `sparkle {entity}`, `hearts {position}`, `cottonCandyGone`, `sfx`.
Consumed: `explosion {position, radius, force}` (Δv ≈ clamp(force/35, 6, 24) m/s × falloff), `chitter`, `release`,
`homeRun`, physics contact-force & collision events.

## Performance
~0.5 ms/frame for 56 people (brain + locomotion + animation); +1.7 ms physics with 12 ragdolls. Each human is
2–3 draw calls (skinned body, face decal, optional print, held item). > 70 m from the camera: updated at ~12 Hz;
> 140 m: hidden & frozen. Per-NPC frustum culling; shadows only within 45 m.

## Notes for other agents
* The renderer's HueSaturationEffect turns very saturated colors black (channels go negative); `color.ts#safeColor`
  lifts weak channels. Use it (or avoid pure primaries) for vertex colors elsewhere too.
* Held items live at scene level (not parented to the hand) because the engine's DetailCuller reads `obj.position`.
