# Items, bins & impacts

`import { spawnItem, spawnTrashCan, spawnDumpster, explode } from '../gameplay/items';`
(all safe to call from zone builders — they don't need the systems to be initialised yet).

## Bins — use these instead of plain `trashcan` / `dumpster` props

| Helper | What you get |
|---|---|
| `spawnTrashCan(game, bottomPos, rotY?)` | 9 kg galvanised can with a lid. Bonks hit it high so it topples. First tip-over (>60°) → `trashTipped {entity}`, **+40 "Trash Panda!"**, the lid pops off as its own prop, 2–3 random trash/food items spill out. |
| `spawnDumpster(game, bottomPos, rotY?)` | 250 kg hollow green bin, front = local +Z, hinged lid (bonk it open / slam it shut). Jump or fall **inside** → `dumpsterDive {entity}`, **+100 "Dumpster Dive"**, 1–3 weighted loot items pop out (15 s cooldown per dumpster; night = juicier loot, rare golden trophy). |

`bottomPos.y` must be the real surface height (raycast if there's pavement over the terrain).
Plain props tagged `trashcan` still get tip detection + spill, and landing on top of a plain `dumpster`
prop counts as a dive — but the helpers look and play better.

## Items — `spawnItem(game, kind, bottomPos, rotY?) → Entity`

Kinds (lenient names also work: `'rookiecard'`, `'duck'`, `'propane'`…, see `resolveItemKind`):
`cottonCandy cash phone teddy fish soap rubberDuck pizza sandwich coffee iceCream diploma rookieCard
spoon bottleCap key ring marble grapes bananaPeel sodaCan appleCore fishBones takeout newspaper
goldenTrophy vase glassBottle tv glassPane propaneTank gasCan fireworksCrate`

Every item: tags `grabbable washable item` + its own (`food trash shiny fragile explosive teddy fish pizza
diploma rookiecard grapes slippery cash cottoncandy …`), `data.itemKind`. Washing scores a named popup,
emits `itemWashed {kind, entity, count}` and has diminishing returns. Special reactions: cotton candy
vanishes (`cottonCandyGone`, Jimothy stares at his paws), cash → Money Laundering, phone → sparkly then
`shortCircuit`, teddy → clean & fluffy (`data.clean`, `teddyCleaned`), ice cream melts, diploma goes soggy,
rookie card `data.devalued`, shiny things `data.extraShiny` (twinkle; crows), soap lathers & wears out,
duck squeaks, fireworks go damp (fizzle instead of exploding). Banana peels (`slippery`) make Jimothy /
NPCs slip → `slip {entity, peel, impulse}`.

Also exported: `spawnItemFlying`, `tintItem(e, colorOrScale, {roughness, metalness})`, `makeExtraShiny(e)`,
`stareAtHands(game, secs)`, `after(game, secs, fn)`, loot tables + `rollDumpsterLoot` / `rollTrashCanLoot`.
The `'items'` system also has `spawn(kind, pos)`, `spawnTrashCan(pos)`, `spawnDumpster(pos)`, `explode(pos)`.

## Impacts (`'impacts'` system)

Contact-force events → `entity.onImpact(game, other, Δv)`, `impact {a, b, strength, position}`, throttled
`impact_light/heavy/metal/wood` sfx. Thrown props: **Direct Hit** / **Long Distance Delivery** / **Yeet!**
→ `thrownHit {entity, other, distance}`. `fragile` → `shatter(game, e)` (debris + `glass_break`, `shatter` event);
`explosive` → hard hit, thrown-and-landed, or two bonks → `explode(game, pos, {radius, force, source, fireworks})`
(radial impulses, chains, ragdolls Jimothy, camera shake, "Kaboom!", `explosion` event that the FX draw).
Set `data.shatterLabel / shatterPoints / explosionRadius / fireworks` on your own props to customise.
