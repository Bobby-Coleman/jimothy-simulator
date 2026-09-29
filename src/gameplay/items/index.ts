/**
 * Items, bins & impacts — public API.
 *
 *   spawnItem(game, kind, bottomPos, rotY?)       any ItemKind (see Items.ts), returns the Entity
 *   spawnItemFlying(game, kind, center, vel)      same, launched (loot / spills)
 *   spawnTrashCan(game, bottomPos, rotY?)         tip it over → 'trashTipped', "Trash Panda!", spill
 *   spawnDumpster(game, bottomPos, rotY?)         bonk the lid open, jump in → 'dumpsterDive' + loot
 *   explode(game, pos, { radius, force, source, fireworks })   cartoon explosion with physics
 *   shatter(game, entity)                         smash a fragile thing into debris
 *   rollDumpsterLoot(game) / rollTrashCanLoot()   weighted loot tables
 *
 * Systems: ItemsSystem ('items'), ImpactSystem ('impacts') — registered in src/systems.ts.
 */
export { spawnItem, spawnItemFlying, resolveItemKind, stareAtHands, tintItem, makeExtraShiny, itemInfo, ITEM_KINDS, type ItemKind } from './Items';
export { spawnTrashCan, spawnDumpster, dumpsterDive, rollDumpsterLoot, rollTrashCanLoot, TRASH_LOOT, FOOD_LOOT, SHINY_LOOT, RARE_LOOT } from './Trash';
export { explode, explodeEntity, armExplosive, shatter, spawnDebris, ImpactSystem } from './Impacts';
export { ItemsSystem } from './ItemsSystem';
export { after } from './shared';
