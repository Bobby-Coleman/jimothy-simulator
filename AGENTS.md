# Engineering guide (for every helper agent)

Read `DESIGN.md` first (vision, tone, lore, map). This file is how to build on the engine without stepping on others.

## Running & testing
* A Vite dev server is **already running at http://127.0.0.1:5173** (HMR — just save files). Don't start another on 5173.
  If it's not reachable, start your own on another port: `npx vite --port 51xx --strictPort` (background).
* **Headless playtests/screenshots** (uses installed Chrome with GPU):
  ```
  node tools/shot.mjs --url "http://127.0.0.1:5173/?spawn=0,0&time=12" --out tools/shots/<you>/x.png \
       --js "g.get('player').teleport(...); g.advance(1.5); return g.get('score').total"
  ```
  `g` is the Game. Look at the PNG with the Read tool. `--js-file f.js` for longer scripts. The script prints console
  errors/warnings — **fix every error your code causes**. (D3D "X4122/X3577" shader warnings are harmless noise.)
* Simulation is deterministic-ish via `g.advance(seconds)` (steps at 60 Hz, independent of rAF).
  Simulate input: `g.input.virtual.move.set(x, y)` (y = forward), `g.input.virtual.buttons.add('jump')` then
  `g.advance(1/60)` then `.delete('jump')` for a press. Actions: jump sprint grab bonk wash roll flop chitter objectives pause.
* URL params: `?skipintro` (shot.mjs adds it), `?spawn=x,z`, `?time=21.5`, `?quality=low|medium|high`.
* Typecheck: `npx tsc --noEmit -p .` must stay clean for your files.

## Rules
* **Do not run git** (the lead commits). **Only edit files you own** (listed in your brief). Shared registration files
  (`src/systems.ts`, `src/world/zones/index.ts`) — add your lines with small Edit calls; if an edit fails because
  someone else changed the file, re-read and retry.
* Don't edit `src/core/*`, `src/player/*`, `src/world/World.ts|Water.ts|Environment.ts|terrain.ts` — if you need an
  engine change, make the smallest additive change only if truly blocking and **say so in your final report**;
  otherwise describe the change you need in the report.
* Assets: only CC0 / our own. Record third-party assets in `CREDITS.md`. Keep things light (it ships on GitHub Pages).
* PG, no real private people, parody brand names (see DESIGN.md §1, §5).
* Performance: prefer instancing/merged geometry for repeated static stuff, box/cylinder/ball colliders, props that
  start asleep (`spawnProp` does), few real-time lights (use emissive + bloom instead).

## Core API cheat-sheet
```ts
import type { Game, System } from '../core/Game';      // game.scene, camera, physics, input, assets, events, entities
game.add(system) / game.get<T>('name')                   // systems: 'environment' 'water' 'world' 'player' 'camera' 'score' ...
game.score(points, label, pos?)   game.hint(text, secs?)   game.sfx(key, pos?, volume?, pitch?)
game.events.on/emit(name, payload)                       // see src/core/Events.ts for common events
game.time (scaled seconds), game.dt, game.paused, game.state ('title'|'playing'|'paused'|'cutscene')

// Physics (Rapier 0.21) — src/core/Physics.ts
import { RAPIER, G, groups } from '../core/Physics';
game.physics.world, createBody(desc, colliderDescs, object3d?), createDynamic(obj, colliders, opts), link(body, obj)
raycast(from, dir, max, filter?, excludeBody?), sphereCast(...), overlapSphere(center, r, filter?), staticBox(center, half, quat?)
onContactForce(fn), onCollision(fn), removeBody(body)
// Collision groups: G.WORLD PROP PLAYER NPC RAGDOLL TRIGGER WATER HELD VEHICLE DEBRIS ANIMAL; groups(member, filter)
// !! NEVER create/modify/remove bodies inside a Rapier query callback — collect, then act after it returns.
// !! Remove an entity from game.entities BEFORE removing its body (destroyProp does this correctly).

// Entities — src/core/Entities.ts
game.entities.create({ kind, name, body, object, mass, tags: new Set([...]), data, onWash, onBonk, onImpact, onGrab, onRelease, update })
game.entities.fromCollider(collider)  // map physics hits back to gameplay entities
// tags: grabbable washable trashcan dumpster food shiny fragile explosive noclimb npc cash fish cottoncandy ...
// onGrab may return another Entity to hand Jimothy instead (stealing an NPC's phone).

// Props — src/entities/Props.ts
spawnProp(game, { name, object, shape: 'box'|'cylinder'|'ball'|'capsule'|'hull', mass, tags, onWash, ... }, bottomPos, rotY)
destroyProp(game, entity);  helpers: mat(color), box(w,h,d,mat), cylinder(...), sphere(...)

// World — src/world/World.ts  (game.get<World>('world'))
world.heightAt(x, z); world.box(center, size, material, {rotY}); world.collider(center, size, rotY)
world.addStatic(obj, { collider: 'box'|'trimesh'|'none' }); world.instanced(template, [[x,z,rotY,scale],...], { collider: size })
world.material(color, opts) (cached); world.poi (Map name → Vector3); world.areas; world.npcSpawns; world.lanes
// Terrain constants/height: src/world/terrain.ts (MAP, terrainHeight, zoneCenter)

// Water — src/world/Water.ts  (game.get<WaterSystem>('water'))
water.addBox({ name, kind, center /*surface center*/, size: [w, depth, l] }), water.addCircle({ name, kind, center, radius, depth })
water.volumeAt(p), water.nearWater(p, r)   // kinds: bay pond fountain puddle pool sink sprinkler birdbath toilet ...

// Player — src/player/Jimothy.ts (game.get<Jimothy>('player'))
player.position, velocity, speed, facing, mode ('walk'|'climb'|'roll'|'ragdoll'|'swim'|'hang'), grounded, held?.entity,
player.ragdoll(cause, secs, impulse?), teleport(pos, facing?), release(thrown), frozen, speedMul/jumpMul/gravityMul/sizeMul,
player.model (JimothyModel: root, pivot, parts: Body/Head/EarL/…/Tail5, headPivot for hats), player.stats
game.get<CameraRig>('camera').shake(amount), .override (cutscene camera fn), .yaw/.pitch
```

## Asset locations
* Kenney CC0 kits: `public/assets/models/kenney/<kit>/...glb` — see `ASSETS.md` and `public/assets/catalog.json`
  (raw sizes; Kenney units are small — scale to meters). Load with `await game.assets.model('assets/models/…glb')`.
* Our Blender models: `public/assets/models/{jimothy,mom,kit,danny,slopothy,accessories}.glb` (see `tools/blender/README.md`).
* Textures: `public/assets/textures/<name>/{color,normal,rough}.jpg`. Fonts: `public/assets/fonts/`. Audio keys: `src/audio/SOUNDS.md`.
* Asset paths passed to loaders are relative (no leading slash): `'assets/models/kenney/…'`.
