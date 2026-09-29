# ASSETS.md — asset librarian's guide

Everything here is **CC0 / public domain** (Kenney, Poly Haven) or **OFL / Apache-2.0** (fonts). Sources + licenses: `CREDITS.md`.
Machine-readable index of every model: `public/assets/catalog.json`. **Visual index: `tools/_catalog_previews/<kit>/_sheet-NN.png`** — labeled 3D contact
sheets (30 models each, name + raw size on every cell) plus Kenney's own per-model icons; local only (gitignored). Open the sheets first, then pick from below. `tools/_catalog_previews/_scale_check_*.png` shows a street built with the suggested scales.

```
public/assets/
  models/kenney/<kit>/<model>.glb   1751 models in 20 kits (+ ./Textures/*.png shared palettes, License.txt per kit)
  models/*.glb                      (our own Blender exports go here; the catalog lists them as kit "custom")
  textures/<name>/color|normal|rough.jpg   12 Poly Haven PBR sets, 1k JPG
  hdri/sunny_sky_1k.hdr             sunny sky for reflections / IBL
  fonts/                            Luckiest Guy, Lilita One (display), Nunito variable (UI) + license files
  catalog.json                      [{ path, kit, name, size:[x,y,z], min, max, triangles }]    <- node tools/catalog.mjs
```
Model path = `assets/models/kenney/<kit>/<model>.glb` (relative to `public/`). Sizes below are **raw** W×H×D = x×y×z in the kit's own units.

## 0. Read this first

### Loading — engine helper `game.assets` (`src/core/Assets.ts`, see `AGENTS.md`); paths are relative to the site root, **no leading slash**
```ts
const sedan = await game.assets.model('assets/models/kenney/car-kit/sedan.glb');   // SkeletonUtils clone; geometry + MATERIALS shared; shadows on
sedan.scale.setScalar(1.7);                                                        // raw units -> metres (table below)
const g = await game.assets.gltf('assets/models/kenney/mini-characters/character-male-a.glb');   // cached GLTF: g.animations -> AnimationMixer
const cat = await game.assets.json<CatalogEntry[]>('assets/catalog.json');         // [{ path, kit, name, size, min, max, triangles }]; entry.path is loader-ready
const rep: [number, number] = [roadLen / 3, roadWidth / 3];                        // (surface metres / tile metres, see §3)
const map = await game.assets.texture('assets/textures/asphalt/color.jpg',  { repeat: rep });                 // sRGB albedo
const nor = await game.assets.texture('assets/textures/asphalt/normal.jpg', { srgb: false, repeat: rep });    // linear data maps: srgb:false
```
Catalog `size/min/max` are raw (unscaled) bounds at the default pose — use them to fit physics boxes: `halfExtents = size * scale / 2`;
`min[1]` says how far the model dips below its origin. Because `model()` shares materials, **clone a material before recolouring a single instance**
(`o.material = o.material.clone()`). Every GLB of a kit loads the same `Textures/colormap.png` URL, so the loader/browser cache dedupes it.

### Units: every kit has its OWN scale (raw units are NOT metres and kits do not match each other)
Suggested starting points (game units: 1 = 1 m, door 2.1 m, human 1.75 m, car 4.3 m, Jimothy 0.7 m across):

| kit | suggested scale | sanity check at that scale |
|---|---|---|
| `city-kit-suburban` `-commercial` `-industrial` `-roads` | **×8** (same factor for all four so they mesh) | road tile 8 m; suburban house ≈ 10 m wide / 7 m tall; skyscraper-a 23 m; street light 4.8 m; cone 0.75 m |
| `car-kit` | **×1.7** | sedan 4.3 m long (toy-wide: 2.6 m); garbage truck 5.9 m |
| `furniture-kit` | **×2.1** | doorway 2.1 m; fridge 1.9 m; sofa 2.1 m wide; trashcan 0.9 m |
| `food-kit` | **×0.4** realistic, **×0.6–0.8** readable toy food | pizza Ø 0.34 m (×0.4) / 0.5 m (×0.6); donut Ø 0.10 / 0.15 m |
| `nature-kit` | trees **×4**, bushes **×3**, rocks **×2.5**, flowers/grass/mushrooms **×1.5** | tree_default 6.6 m; boulder 2 m; flower 0.4 m |
| `mini-characters` | **×2.6** | 0.67 → 1.75 m chunky toy humans |
| `blocky-characters` | **×0.65** | 2.7 → 1.75 m |
| `cube-pets` | **×0.4** | cat/dog ≈ 0.6 m |
| `watercraft-kit` | **×2** (houseboats **×3**, ships ×2–3) | speedboat 6.8 m; houseboat 14 m |
| `pirate-kit` | docks/platforms **×1.5**, barrels/crates **×0.45**, palms ×1.5 | dock module 3.8 m; barrel 0.6 m |
| `survival-kit` | **×2.5** | barrel 0.85 m; tent 1.4 m |
| `holiday-kit` | bench **×1.3**, lantern ×1.8, trees **×3.5**, presents/candy canes **×1** | bench 1.5 m wide; lamp post 3.1 m |
| `platformer-kit` | **×1** (props), coins/stars ×1–1.5 | coin 0.4 m; crate 0.5 m |
| `mini-market` | **×2** | shelf 1.7 m; cart 0.8 m |
| `retro-urban-kit` | **×2.5–3** (bench ×2.2) | truck 4.9 m; dumpster 1.8 m |
| `racing-kit` | grandStand/pits/billboard **×8**, tents **×4**, race cars **×3**, flags ×3 | grandstand 8 m; market tent 4 m |
| `fantasy-town-kit` (subset) | stalls **×2**, fountains **×3**, lantern **×2**, trees **×2.5** | stall 2 m wide × 2.5 m; fountain Ø 6 m |

### Pivot, facing, handedness
* glTF: Y-up, right-handed (same as Three.js). Most models: origin **bottom-centre** (`min.y ≈ 0`, x/z centred). Exceptions:
  `nature-kit` sits 0.05 units below the origin; **`furniture-kit` origin = front-left-bottom corner** (extends +x and −z);
  **`racing-kit` is not centred** (origin offset ≈ (−0.35, −1.65) from the tile centre) — re-centre with catalog `min/max`.
* **Vehicles, boats, characters, animals, furniture and buildings (door side) face +Z** — checked by rendering them from +Z: headlights, bows, faces, oven doors all show up there.
  **Exception: `retro-urban-kit` (trucks, bench, dumpsters) faces −Z.** North in the game is −Z, so rotate Y by π to make a +Z-facing model face north.
* Road tiles are 1×1 (curves 2×2, roundabout 3×3), centred, y ≈ 0..0.02.

### Materials (already fixed on import — see `tools/import-kenney.mjs`)
* Palette kits (City kits, car, food, watercraft, pirate, platformer, holiday, survival, mini-*, fantasy-town, cube-pets) share ONE 512² palette
  `Textures/colormap.png` per kit folder (external file next to the GLBs — keep the folder structure). Flat colours: use `NearestFilter` to avoid palette bleeding on mips.
* **Recolour with Kenney's alternate palettes** `Textures/variation-a|b|c.png` (city-kit-suburban a–c, -commercial a–b, -industrial a–c, -roads a,
  mini-market a–b, platformer a, survival a, fantasy-town a). Verified recipe:
  ```ts
  const tex = await game.assets.texture('assets/models/kenney/city-kit-suburban/Textures/variation-b.png');   // sRGB already
  tex.flipY = false; tex.needsUpdate = true;                     // glTF UV convention — without flipY=false the colours are scrambled
  root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.map = tex; } });   // clone: other instances keep theirs
  ```
* `nature-kit`, `furniture-kit`, `racing-kit` have no palette texture, only per-material colours. **nature-kit is pastel teal/peach** — recolour by material
  name: `leafsGreen #70e6d6`, `leafsDark #72d3d5`, `leafsFall #ffc78a`, `grass #73eddd`, `woodBark #f2be9e`, `woodBarkDark`, `woodBirch`, `dirt #f2be9e`,
  `stone #ddf2f5`, `water #d8faff`, `colorRed|Purple|Yellow|Tan`. Example targets: leaves `0x5bbf3f`, grass `0x6fca4a`, bark `0x8a5a3b`, dirt `0xa9744f`, stone `0x9aa3a8`, water `0x3aa6d8`
  (`root.traverse(o => o.isMesh && (o.material = o.material.clone()).color.setHex(PALETTE[o.material.name] ?? …))`).
* **Import fix-ups applied** (geometry/UVs/textures untouched): `retro-urban-kit` + `blocky-characters` shipped `KHR_materials_unlit` (flat, no shadows) → removed;
  `nature-kit`, `retro-urban-kit`, `blocky-characters` had the glTF-default `metallicFactor 1` (dark chrome) → 0; unused `KHR_materials_unlit` declarations stripped from furniture/nature/racing.
* Most palette-kit materials are `doubleSided` — set `material.side = THREE.FrontSide` on solid buildings if fill-rate matters. Glass parts use `alphaMode BLEND`.
* `racing-kit` billboards/flags embed a fictional "TANKCO" texture — replace the material `map` with our own canvas sign.
* `retro-urban-kit` is a **style outlier** (64 px grungy PS1-like textures, use `NearestFilter`): fine for alleys/construction, clashes with the rest.

### Animations & rigs (inside the GLBs; `SkeletonUtils.clone` per instance + one `AnimationMixer` each)
* `mini-characters` (12 skinned people; accessories/wheelchairs static) and `blocky-characters` (18 people, node-animated, no skin): clips
  `static, idle, walk, sprint, jump*, fall*, crouch*, sit, drive, die, pick-up, emote-yes, emote-no, holding-right|left|both, holding-*-shoot,
  attack-melee-right|left, attack-kick-right|left, interact-right|left, wheelchair-*` (*mini-characters only).
* `cube-pets`: `static, idle, walk, run, eat, dance, gesture-positive, gesture-negative`.
* `platformer-kit` (13 animated: the 5 `character-oo*` blobs have the mini-character clip set; chests/levers/buttons/traps have `open, close, toggle*, show, hide`),
  `mini-market` (3), `holiday-kit` (2), `survival-kit` (1), `pirate-kit` (1): `open, close, open-and-close`.

### Articulated parts (named child nodes — `obj.getObjectByName(...)`; pivots already sit at the hinge/axle)
* **`car-kit`**: `body`, `wheel-front-left|right`, `wheel-back-left|right` (axle = local X: spin `rotation.x`, steer the front pair with `rotation.y`); extras `door-left|right` (ambulance),
  `door` (delivery), `grill` (firetruck, police), `arm` + `trash` (garbage-truck), `character` (karts). `racing-kit` race cars: `body`, `wheelBackLeft|Right`, `wheelFrontLeft|Right`.
* **`city-kit-roads/dumpster`**: `lid-left`, `lid-right` (swing them open for dumpster diving). **`city-kit-industrial/windmill*`**: `blades` (spin around local X).
* **Doors / drawers / lids**: `furniture-kit` `doorway`→`door`, `bathroomCabinet`→`door`, `desk`→`drawer`, `cabinetTelevisionDoors`→`doorLeft|Right` …; `mini-market`
  `wall-door-rotate` / `fence-door-rotate` → `door-left|right`; `holiday-kit` `present-*`→`lid`, `cabin-door-rotate`→`door`; chests (`pirate-kit`, `platformer-kit`, `survival-kit`) → `lid`;
  `platformer-kit` `door-rotate`→`door`, `lever`→`handle`, `button-*`→`button`, `spring`→`platform`, `trap-spikes`→`spikes`.
* **Boats**: `watercraft-kit/boat-fan`→`fan`, `boat-sail-*`→`sail`, `boat-row-*`→`paddles`, ships → `sail-a|b`, `flag-a|b|c` (same in `pirate-kit/ship-*`, `mast`), `ship-cargo-*` → `cargo-a|b|c`.
* **Loose parts to knock apart**: `mini-market` shelves (`bag` / `carton` / `bottle` nodes), `food-kit` burgers (`bun-top`, `patty`, `cheese` …), cakes (`slice` ×6), cheese (`wedge` ×8), `furniture-kit` beds (`cover`, `pillow*`).
* **Water / glass planes**: a child node literally named `(%ignore)` is the BLEND water plane of every `fantasy-town-kit/fountain-*` (y = 0.14 raw) and the glass pane of `mini-market/wall-window`.
* `nature-kit` GLBs carry an unused `tmpParent` node (Kenney exporter quirk: strict validators flag `SCENE_NON_ROOT_NODE`; harmless in Three.js — all other kits validate with 0 errors). `blocky-characters`: `root → leg-left|right, torso, arm-left|right, head`; `cube-pets`: `root → body, leg-*, tail, wing-*`.

### Budgets (triangles per model, avg / max)
`city-kit-suburban` 751/2062 · `city-kit-commercial` 1090/5246 · `city-kit-industrial` 956/2422 · `city-kit-roads` 180/1636 · `car-kit` 1305/3124 · `food-kit` 173/1376 · `furniture-kit` 191/992 · `nature-kit` 110/720 · `watercraft-kit` 468/2796 · `pirate-kit` 434/2282 · `platformer-kit` 164/1096 · `holiday-kit` 287/1150 · `survival-kit` 158/758 · `mini-market` 295/892 · `mini-characters` 506/1040 · `blocky-characters` 72/72 · `cube-pets` 639/951 · `racing-kit` 220/1430 · `fantasy-town-kit` 250/1628 · `retro-urban-kit` 29/124.
Everything is low-poly (cars ≈ 2 k, houses 0.7–1.8 k, props < 0.3 k): instance repeated props (`InstancedMesh`), merge static scenery.

---

## 1. Quick picks by game need
Format: *kit*: `model` W×H×D (raw kit units). Where a bullet names no kit, the section's kit applies.

### Buildings
* **Houses (N hills, Grandma Rosie, Danny's lawn)** — *city-kit-suburban*: 21 models `building-type-a` … `building-type-u` (W 0.92–1.83, H 0.74–1.24, D 0.89–1.43); green roofs (recolour via `variation-a|b|c`).
* **Shop fronts (Old Ballard Ave: Goodwheel Thrift, coffee, tattoo)** — *city-kit-commercial*: 14 models `building-a` … `building-n` (W 0.84–2.32, H 0.89–3.15, D 0.90–1.82); dark ground-floor band = shopfront (add canvas signs). Add-ons: `detail-awning` 0.40×0.40×0.15, `detail-awning-wide` 0.80×0.40×0.15, `detail-overhang` 0.50×0.40×0.20, `detail-parasol-a` 0.35×0.45×0.40.
* **Downtown towers / University** — *city-kit-commercial*: `building-skyscraper-a` 1.36×2.88×1.36, `building-skyscraper-b` 1.36×4.48×1.36, `building-skyscraper-d` 1.28×5.47×1.39, `building-m` 1.24×3.15×1.24, `building-n` 2.32×2.48×1.82; cheap distant filler `low-detail-building-*` (16 models `low-detail-building-a` … `low-detail-building-wide-b` (W 0.50–1.00, H 0.70–2.25, D 0.50)).
* **SlopCorp campus / data-center vibes** — *city-kit-industrial*: `building-a` 2.08×1.47×1.24, `building-d` 0.88×1.42×1.42, `building-o` 0.88×0.92×1.24, `building-q` 2.14×0.88×1.77, `chimney-large` 1.08×1.70×1.08, `detail-tank-large` 1.51×0.96×1.65, `water-tower` 0.85×2.14×0.83, `windmill` 0.60×2.31×1.13, `solar-panel-landscape-group` 1.51×0.26×0.90; all 20 models `building-a` … `building-t` (W 0.88–2.48, H 0.71–1.93, D 0.91–2.11).
* **Interior shells** — *furniture-kit*: `wall` 1.00×1.29×0.05, `wallDoorway` 1.00×1.29×0.09, `wallWindow` 1.00×1.29×0.09, `wallCorner` 0.55×1.29×0.55, `floorFull` 1.00×0.05×1.00, `doorway` 0.49×1.01×0.11; *mini-market*: `wall` 1.00×1.00×0.60, `wall-window` 1.00×1.00×0.60, `wall-door-rotate` 1.00×1.00×0.60, `floor` 1.00×0.03×1.00, `column` 0.73×1.00×0.73.
* **Log cabin (Grandma's / den variant)** — *holiday-kit*: `cabin-wall` 1.00×1.00×0.30, `cabin-door-rotate` 1.00×1.00×0.40, `cabin-window-a` 1.00×1.00×0.55, `cabin-roof` 1.28×1.42×1.40, `cabin-roof-chimney` 1.28×1.42×1.40, `cabin-corner-logs` 0.35×1.00×0.35, `floor-wood` 1.00×0.07×1.00.
* **Grungy sheds / alley walls / scaffolding (style outlier)** — `retro-urban-kit/wall-a*`, `wall-b*`, `roof-metal-*`, `scaffolding-*` (1×1×1 modules).
* For custom procedural buildings use the PBR textures (§3): `brick`, `siding`, `shingles`, `paving`.

### Roads, sidewalks, crosswalks — *city-kit-roads* (×8; 1 tile = 1×1)
* How the tiles read (checked top-down): every straight/bend tile is a 2-lane roadway with a **thin lavender kerb strip on both outer edges** (≈0.8 m at ×8 — not a real sidewalk); add wide
  sidewalks with `tile-low` (1×1 pavement) or your own `sidewalk`-textured meshes. `*-path` junctions carry zebra crossings on every arm, `road-crossing` is a mid-block zebra, `*-line` adds
  painted stop lines, `road-square` is a kerb-ringed plaza/parking tile, `road-end`/`-end-round` are dead ends, `road-side-entry|exit` cut kerb openings. `variation-a` = darker asphalt + red corner kerbs.
* Straight: `road-straight` 1.00×0.02×1.00, `road-straight-half` 0.50×0.02×1.00, `road-side` 1.00×0.02×1.31, `road-end` 1.00×0.02×1.00, `road-square` 1.00×0.02×1.00
* Junctions: `road-crossroad` 1.00×0.02×1.00, `road-crossroad-path` 1.00×0.02×1.00, `road-intersection` 1.00×0.02×1.00, `road-intersection-path` 1.00×0.02×1.00, `road-split` 1.00×0.02×2.00, `road-roundabout` 3.00×0.02×3.00
* Corners: `road-bend` 1.00×0.02×1.00, `road-bend-sidewalk` 1.00×0.02×1.00, `road-curve` 2.00×0.02×2.00, `road-curve-pavement` 2.00×0.02×2.00, `road-curve-intersection` 2.00×0.02×2.00
* **Crosswalk**: `road-crossing` 1.00×0.02×1.00, `road-crossroad-line` 1.00×0.02×1.00; driveways: `road-driveway-single` 1.00×0.02×1.00, `road-driveway-double` 1.00×0.02×1.00
* Hills / bridges: `road-slant` 1.00×0.27×1.00, `road-slant-high` 1.00×0.52×1.00, `road-slant-curve` 2.00×0.52×1.00, `road-bridge` 1.00×0.52×1.00, `bridge-pillar` 0.10×0.50×0.10
* Sidewalk / plaza fill: `tile-low` 1.00×0.02×1.00, `tile-high` 1.00×0.25×1.00, `tile-slant` 1.00×0.27×1.00. (`*-barrier` variants are just kerb walls.)
* Terrain-following / custom roads: use the `asphalt` + `sidewalk` PBR textures (§3) on generated meshes instead.

### Street furniture
* **Street lights**: `light-square` 0.05×0.60×0.24, `light-square-double` 0.05×0.60×0.42, `light-curved` 0.05×0.68×0.23, `light-curved-double` 0.05×0.68×0.40; *holiday-kit*: `lantern` 0.53×1.74×0.45, `lantern-hanging` 0.43×0.67×0.42; *fantasy-town-kit*: `lantern` 0.22×1.56×0.22; *retro-urban-kit*: `detail-light-single` 0.09×0.96×0.26, `detail-light-double` 0.09×0.96×0.44.
* **Traffic lights / signs**: *city-kit-roads*: `traffic-light` 0.12×0.52×0.09, `traffic-light-hanging` 0.12×0.51×0.29, `road-sign-stop` 0.08×0.49×0.14, `road-sign-street` 0.20×0.47×0.20, `road-sign-warning` 0.08×0.50×0.15, `sign-highway` 0.13×0.71×1.00.
* **Utility poles & wires**: *city-kit-roads*: `electricity-pole` 0.58×0.53×0.21, `electricity-pole-single` 0.08×0.53×0.21, `electricity-side` 0.56×0.53×0.43, `electricity-wires` 0.51×0.07×0.18.
* **Dumpsters**: *city-kit-roads*: `dumpster` 0.28×0.21×0.37; *retro-urban-kit*: `detail-dumpster-closed` 0.60×0.55×0.45, `detail-dumpster-open` 0.60×0.55×0.48. **Trash can** (tippable, ×2.1 → 0.9 m): *furniture-kit*: `trashcan` 0.21×0.43×0.23; also *survival-kit*: `barrel` 0.24×0.34×0.24, `bucket` 0.14×0.19×0.14, `box-large` 0.25×0.25×0.50.
* **Cones / barriers**: *city-kit-roads*: `construction-cone` 0.08×0.09×0.08, `construction-barrier` 0.14×0.13×0.22, `construction-fence` 0.08×0.18×0.38, `construction-light` 0.08×0.23×0.08; *car-kit*: `cone` 0.48×0.59×0.48, `cone-flat` 0.48×0.28×0.48; *racing-kit*: `barrierWall` 1.00×0.13×0.12, `pylon` 0.12×0.13×0.12; *retro-urban-kit*: `detail-barrier-type-a` 0.43×0.40×0.13, `detail-barrier-strong-type-b` 0.66×0.33×0.25.
* **Park benches**: *holiday-kit*: `bench` 1.12×0.73×0.63, `bench-short` 0.62×0.73×0.63; *retro-urban-kit*: `detail-bench` 0.60×0.41×0.32; *furniture-kit*: `bench` 0.40×0.47×0.20, `benchCushion` 0.40×0.46×0.20. Picnic/café tables: compose `table` 0.84×0.33×0.45, `tableRound` 0.69×0.37×0.80, `tableCloth` 0.84×0.33×0.45 + benches.
* **Yard/park fences & hedges**: *city-kit-suburban*: `fence` 0.48×0.27×0.08, `fence-low` 1.28×0.17×0.84, `fence-2x2` 0.88×0.27×0.84, `fence-3x3` 1.28×0.27×1.24; *fantasy-town-kit*: `fence` 0.07×0.38×1.00, `fence-gate` 0.07×0.38×1.00, `hedge` 0.25×0.25×1.00, `hedge-large` 0.40×0.60×1.00, `hedge-curved` 1.00×0.25×1.00; *platformer-kit*: `fence-straight` 1.00×0.40×0.14, `hedge` 1.00×0.40×0.30.
* **Parasols**: *city-kit-commercial*: `detail-parasol-a` 0.35×0.45×0.40, `detail-parasol-b` 0.35×0.45×0.40. **Paths**: *city-kit-suburban*: `path-long` 0.20×0.01×0.40, `path-stones-long` 0.14×0.01×0.40, `path-stones-messy` 0.16×0.01×0.36, `driveway-long` 0.36×0.01×0.40; *nature-kit*: `path_stone` 1.00×0.05×0.58, `path_wood` 1.00×0.05×0.51, `ground_pathStraight` 1.00×0.05×1.00.

### Vehicles — *car-kit* (×1.7, face +Z)
`sedan` 1.50×1.30×2.55, `taxi` 1.50×1.50×2.75, `van` 1.50×1.35×2.75, `suv` 1.50×1.30×2.70, `truck` 1.50×1.30×2.95, `delivery` 1.50×1.65×3.25, `garbage-truck` 1.60×1.60×3.45, `police` 1.50×1.30×3.10, `ambulance` 1.50×1.80×3.25, `firetruck` 1.50×1.70×3.40, `tractor` 1.34×1.60×2.20 — full list in §2. Loose wheels `wheel-default` 0.40×0.60×0.60, `wheel-truck` 0.35×0.60×0.60 and `debris-*` bits for crashes/car-surfing.
Also: *retro-urban-kit*: `truck-green` 0.83×1.01×1.64, `truck-grey` 0.83×1.01×1.64; *racing-kit*: `raceCarRed` 0.73×0.40×1.35, `raceCarGreen` 0.73×0.40×1.35; `holiday-kit` toy train (`train-locomotive`, `train-wagon`, `trainset-rail-*`). **Bus: none** (§6).

### Waterfront (Salmon Bay, docks, Pike's Plaice Market)
* **Houseboats (×3)**: *watercraft-kit*: `boat-house-a` 2.68×2.17×4.64, `boat-house-b` 2.68×2.20×5.55, `boat-house-c` 2.68×3.00×5.15, `boat-house-d` 2.68×3.44×4.64.
* **Boats (×2)**: *watercraft-kit*: `boat-fishing-small` 1.78×2.60×3.87, `boat-tug-a` 1.78×2.24×3.47, `boat-tow-a` 2.88×3.33×6.12, `boat-sail-a` 1.78×4.74×3.77, `boat-sail-b` 1.78×4.48×4.07, `boat-speed-a` 1.78×1.50×3.37, `boat-speed-j` 1.78×1.25×4.27, `boat-row-small` 2.75×0.85×2.37, `boat-fan` 1.78×2.19×2.87; *nature-kit*: `canoe` 0.30×0.18×1.15, `canoe_paddle` 0.08×0.04×0.59.
* **Ships**: *watercraft-kit*: `ship-cargo-a` 3.92×3.38×10.55, `ship-large` 4.80×9.96×13.10, `ship-ocean-liner` 4.76×8.93×21.28; *pirate-kit*: `ship-pirate-large` 4.80×9.96×13.10, `ship-wreck` 4.80×9.96×10.60.
* **Docks / piers / ramps**: *pirate-kit*: `structure-platform-dock` 2.50×1.31×2.51, `structure-platform-dock-small` 1.90×1.31×2.51, `structure-platform` 2.50×0.93×2.51, `platform-planks` 1.89×0.43×2.70, `structure-roof` 3.08×3.40×3.23; *watercraft-kit*: `ramp` 2.73×1.14×2.81, `ramp-wide` 5.14×1.14×2.81. Or build planks with the `planks` texture.
* **Buoys, cargo, Salmon-Run finish gate**: *watercraft-kit*: `buoy` 0.93×1.84×0.93, `buoy-flag` 0.93×2.72×1.29, `cargo-container-a` 1.38×1.10×2.76, `cargo-pile-a` 2.54×1.20×2.75, `gate-finish` 6.20×4.65×1.20, `gate` 6.20×4.65×1.20, `arrow` 2.00×0.60×3.00.
* **Dock props**: *pirate-kit*: `barrel` 1.34×1.23×1.34, `crate` 1.08×0.77×1.31, `crate-bottles` 1.08×1.06×1.31, `chest` 1.27×1.15×1.27, `bottle` 0.36×0.89×0.36, `flag-pennant` 1.76×2.10×0.40; bridges *nature-kit*: `bridge_wood` 1.04×0.40×1.04, `bridge_stone` 1.04×0.40×1.04; pond *nature-kit*: `lily_large` 0.27×0.10×0.31, `lily_small` 0.19×0.04×0.22.
* **Market stalls (Pike's Plaice)**: *fantasy-town-kit*: `stall-red` 1.00×1.24×1.00, `stall-green` 1.00×1.24×1.00, `stall` 0.65×0.37×1.00, `stall-bench` 0.26×0.23×0.94, `cart` 0.89×0.54×1.34, `cart-high` 0.89×0.86×1.39, `banner-red` 0.05×0.84×0.50; tents *racing-kit*: `tent` 1.00×0.70×1.00, `tentLong` 2.00×0.70×1.00, `tentClosed` 1.00×0.70×1.00, *survival-kit*: `tent` 0.56×0.49×0.56.
* **Fish / crab (washable, throwable)**: *food-kit*: `fish` 0.20×0.32×0.62, `fish-bones` 0.31×0.07×0.64, `mussel` 0.09×0.04×0.16; *survival-kit*: `fish` 0.20×0.11×0.07, `fish-large` 0.31×0.16×0.10 (the orange `fish` reads as a salmon); *cube-pets*: `animal-fish` 1.88×1.63×1.26, `animal-crab` 2.34×1.43×1.35.

### Vegetation & nature (*nature-kit* unless noted; pastel palette — recolour, §0)
* **Trees**: `tree_default` 0.76×1.71×0.65, `tree_oak` 0.64×1.23×0.74, `tree_fat` 0.76×1.15×0.65, `tree_tall` 0.40×1.69×0.46, `tree_small` 0.35×1.11×0.41, `tree_thin` 0.68×1.49×0.62, `tree_cone` 0.53×1.43×0.53, `tree_detailed` 0.85×1.33×0.76, `tree_pineTallD` 0.48×2.08×0.55, `tree_pineRoundA` 0.62×1.37×0.71, `tree_palm` 0.94×1.51×1.01; `*_fall` = autumn colours, `*_dark` = darker. Recolour a round tree pink for **cherry blossoms**.
  Other trees: *city-kit-suburban*: `tree-large` 0.21×0.77×0.24, `tree-small` 0.21×0.57×0.24; *fantasy-town-kit*: `tree` 1.02×2.41×1.02, `tree-high-round` 1.02×2.75×1.02; *survival-kit*: `tree` 0.55×1.41×0.53, `tree-autumn` 0.55×1.41×0.53; *retro-urban-kit*: `tree-park-large` 1.04×1.46×1.04.
* **Bushes, grass, flowers, mushrooms**: `plant_bush` 0.40×0.24×0.40, `plant_bushDetailed` 0.60×0.36×0.60, `grass` 0.38×0.25×0.39, `grass_large` 0.41×0.25×0.41, `grass_leafs` 0.23×0.14×0.26, `flower_redA` 0.16×0.29×0.18, `flower_yellowA` 0.16×0.19×0.18, `flower_purpleA` 0.16×0.24×0.18, `mushroom_red` 0.17×0.20×0.20, `mushroom_redGroup` 0.27×0.25×0.25; *platformer-kit*: `flowers` 0.78×0.14×0.79, `flowers-tall` 0.55×0.46×0.62, `mushrooms` 0.52×0.29×0.51; planters *city-kit-suburban*: `planter` 0.40×0.18×0.30, *nature-kit*: `pot_large` 0.56×0.20×0.49, *furniture-kit*: `pottedPlant` 0.21×0.65×0.24.
* **Rocks / boulders**: `nature-kit` `rock_large*` (6 models `rock_largeA` … `rock_largeF` (W 0.77–1.10, H 0.26–0.57, D 0.90–1.03)), `rock_small*` (9 models `rock_smallA` … `rock_smallI` (W 0.35–0.59, H 0.12–0.41, D 0.31–0.69)), `rock_tall*` (10 models `rock_tallA` … `rock_tallJ` (W 0.42–0.98, H 0.44–1.00, D 0.44–0.77)); `stone_*` = same shapes in a grey palette. Also *fantasy-town-kit*: `rock-large` 1.67×1.16×1.55, `rock-wide` 1.09×1.02×1.57; *pirate-kit*: `rocks-a` 5.11×2.90×4.39, `rocks-sand-a` 5.11×3.21×4.39.
* **Logs, stumps, camp**: *nature-kit*: `log` 0.23×0.17×0.71, `log_large` 1.00×0.42×0.55, `log_stack` 0.42×0.35×0.71, `stump_old` 0.36×0.27×0.37, `stump_round` 0.32×0.21×0.37, `campfire_stones` 0.54×0.08×0.52, `tent_smallOpen` 0.55×0.56×0.67, `sign` 0.30×0.41×0.07.
* **Statues / monuments (Jimothy statue base)**: *nature-kit*: `statue_column` 0.30×1.00×0.30, `statue_obelisk` 0.31×0.88×0.31, `statue_block` 0.40×0.40×0.40, `statue_head` 0.73×1.00×0.55, `statue_ring` 0.60×0.80×0.40.
* **Fountains (Gasworks-ish park, City Hall plaza)**: *fantasy-town-kit*: `fountain-round` 2.00×0.28×2.00, `fountain-round-detail` 2.00×0.48×2.00, `fountain-square` 2.00×0.46×2.00, `fountain-square-detail` 2.00×0.48×2.00, `fountain-corner` 1.00×0.28×1.00, `fountain-edge` 1.00×0.28×1.00 — the light-blue plane is the water (washing spot).
* **Cliffs / walls / steps**: `nature-kit/cliff_*` (56 models `cliff_block_rock` … `cliff_waterfallTop_stone` (W 0.17–1.27, H 0.25–1.00, D 0.17–1.27); `_rock` brown, `_stone` grey); *fantasy-town-kit*: `stairs-stone` 1.02×1.00×0.50, `stairs-stone-handrail` 1.02×1.45×0.50.

### Food — *food-kit* (×0.4–0.8): pizza, donut, ice cream, fish, sandwich, coffee …
* **Whole pizza / box**: `pizza` 0.84×0.04×0.84, `pizza-box` 0.94×0.88×0.95, `pizza-cutter` 0.54×0.06×0.25 (steal-a-whole-pizza).
* **Sweets**: `donut` 0.25×0.09×0.28, `donut-chocolate` 0.25×0.09×0.28, `donut-sprinkles` 0.25×0.10×0.28, `cupcake` 0.36×0.42×0.31, `muffin` 0.30×0.25×0.26, `cake` 0.64×0.27×0.64, `cake-birthday` 0.64×0.36×0.64, `pie` 0.95×0.15×0.95, `cookie` 0.22×0.05×0.19, `waffle` 0.32×0.04×0.32, `pancakes` 0.44×0.12×0.50, `candy-bar` 0.29×0.07×0.07, `lollypop` 0.04×0.38×0.19, `popsicle` 0.08×0.49×0.18.
* **Ice cream**: `ice-cream` 0.24×0.46×0.27, `ice-cream-cne` 0.18×0.30×0.21, `ice-cream-cup` 0.20×0.18×0.23, `ice-cream-scoop-chocolate` 0.24×0.17×0.27, `ice-cream-scoop-mint` 0.24×0.17×0.27, `sundae` 0.22×0.67×0.26 (`cne` = cone, sic). **No cotton candy** (§6): `lollypop` stick + a pink sphere is the fastest stand-in.
* **Meals**: `burger` 0.40×0.29×0.40, `burger-double` 0.40×0.36×0.40, `hot-dog` 0.59×0.15×0.20, `corn-dog` 0.60×0.09×0.11, `fries` 0.18×0.40×0.27, `taco` 0.43×0.26×0.11, `sandwich` 0.43×0.17×0.43, `sub` 0.28×0.22×0.68, `salad` 0.50×0.27×0.58, `bacon` 0.13×0.03×0.52, `croissant` 0.35×0.19×0.48, `bread` 0.44×0.04×0.37, `turkey` 0.93×0.38×0.68, `whole-ham` 0.38×0.44×0.64, `styrofoam` 1.26×0.82×0.76.
* **Fish & seafood**: `fish` 0.20×0.32×0.62, `fish-bones` 0.31×0.07×0.64, `mussel` 0.09×0.04×0.16, `maki-salmon` 0.12×0.07×0.10, `sushi-salmon` 0.11×0.09×0.20.
* **Coffee & drinks**: `cup-coffee` 0.22×0.14×0.29, `cup` 0.23×0.20×0.29, `mug` 0.34×0.27×0.29, `frappe` 0.25×0.50×0.25, `soda-can` 0.22×0.35×0.22, `soda-bottle` 0.18×0.58×0.16, `soda` 0.25×0.43×0.25, `can` 0.30×0.32×0.30, `carton` 0.23×0.59×0.23, `wine-red` 0.19×0.70×0.17, `glass` 0.16×0.28×0.18.
* **Fruit / veg / kitchenware**: `apple` 0.20×0.19×0.20, `banana` 0.14×0.20×0.63, `orange` 0.17×0.17×0.17, `strawberry` 0.12×0.18×0.12, `watermelon` 0.46×0.48×0.46, `pineapple` 0.24×0.47×0.24, `pumpkin` 0.42×0.23×0.42, `corn` 0.34×0.32×0.30, `carrot` 0.34×0.72×0.34, `bag` 0.22×0.60×0.41, `barrel` 0.76×0.68×0.68, `plate` 0.89×0.09×0.89, `bowl` 0.50×0.21×0.58, `pot` 0.66×0.36×0.82, `frying-pan` 0.66×0.12×1.02.  All 200: `tools/_catalog_previews/food-kit/_sheet-01..07.png`.

### Furniture & appliances — *furniture-kit* (×2.1, **corner origin**)
* **Sinks**: `bathroomSink` 0.34×0.56×0.29, `bathroomSinkSquare` 0.43×0.58×0.30, `bathroomCabinetDrawer` 0.43×0.47×0.32, `kitchenSink` 0.43×0.49×0.45. **Fridges**: `kitchenFridge` 0.43×0.92×0.29, `kitchenFridgeLarge` 0.52×0.92×0.41, `kitchenFridgeSmall` 0.43×0.60×0.29, `kitchenFridgeBuiltIn` 0.43×0.87×0.45.
* **Kitchen**: `kitchenStove` 0.43×0.45×0.45, `kitchenCabinet` 0.43×0.45×0.45, `kitchenBar` 0.43×0.42×0.21, `kitchenMicrowave` 0.29×0.18×0.23, `kitchenCoffeeMachine` 0.19×0.18×0.24, `toaster` 0.19×0.13×0.10, `hoodLarge` 0.43×0.37×0.28.
* **Couches / chairs**: `loungeSofa` 0.98×0.46×0.41, `loungeSofaLong` 0.98×0.46×0.82, `loungeSofaCorner` 0.98×0.46×0.98, `loungeSofaOttoman` 0.44×0.23×0.45, `loungeDesignSofa` 1.12×0.40×0.41, `loungeChair` 0.49×0.46×0.41, `loungeChairRelax` 0.49×0.63×0.68, `chair` 0.20×0.47×0.20, `chairDesk` 0.34×0.61×0.31, `stoolBar` 0.27×0.43×0.23.
* **Tables / storage**: `table` 0.84×0.33×0.45, `tableRound` 0.69×0.37×0.80, `tableCoffee` 0.66×0.23×0.40, `desk` 0.73×0.38×0.39, `sideTable` 0.53×0.38×0.22, `bookcaseClosed` 0.40×0.85×0.25, `bookcaseOpen` 0.40×0.88×0.25, `cabinetTelevision` 0.80×0.31×0.25, `coatRackStanding` 0.27×0.77×0.27.
* **Beds / bath / laundry**: `bedSingle` 0.57×0.38×1.13, `bedDouble` 0.96×0.38×1.13, `bedBunk` 0.57×0.85×1.09, `bathtub` 1.19×0.42×0.56, `toilet` 0.31×0.45×0.48, `shower` 0.56×1.09×0.58, `washer` 0.39×0.47×0.39, `dryer` 0.39×0.47×0.38.
* **Electronics / decor**: `televisionVintage` 0.41×0.27×0.27, `televisionModern` 0.68×0.46×0.13, `radio` 0.32×0.23×0.10, `speaker` 0.15×0.64×0.15, `laptop` 0.26×0.16×0.24, `computerScreen` 0.39×0.29×0.10, `lampRoundFloor` 0.15×0.86×0.18, `rugRound` 0.92×0.01×0.92, `rugDoormat` 0.43×0.01×0.24, `pillow` 0.23×0.22×0.09, `books` 0.15×0.10×0.09, `cardboardBoxClosed` 0.21×0.28×0.21, `cardboardBoxOpen` 0.37×0.28×0.21, `stairs` 1.82×1.34×0.79; `bear` is a wall-mounted trophy head, **not** a teddy.
* **Shop interior (Goodwheel Thrift-ish)** — *mini-market*: `shelf-boxes` 0.80×0.85×0.70, `shelf-bags` 0.80×0.86×0.70, `shelf-end` 0.80×1.05×0.40, `freezer` 0.80×0.35×0.60, `freezers-standing` 1.00×0.90×0.50, `cash-register` 0.85×0.59×0.85, `shopping-cart` 0.30×0.39×0.48, `shopping-basket` 0.35×0.25×0.35, `bottle-return` 0.45×1.09×0.48, `display-bread` 0.70×0.50×0.60, `display-fruit` 0.60×0.52×0.60.

### People & animals
* **Chunky toy humans** — *mini-characters*: 12 models `character-female-a` … `character-male-f` (W 0.77–1.10, H 0.66–0.79, D 0.34–0.53). `character-male-c` is a police officer (cap + badge → Wildlife Officer, tint khaki), `male-d` in a suit, `female-a` carries a blue crutch (hence wider). Accessories: `aid-sunglasses` 0.33×0.10×0.18, `aid-glasses` 0.33×0.10×0.18, `aid-cane` 0.10×0.32×0.23, `aid-mask` 0.34×0.20×0.21, `wheelchair` 0.50×0.49×0.58, `wheelchair-power` 0.48×0.57×0.51.
* **Blocky humans** — *blocky-characters* `character-a … r` (all 1.60×2.70×0.80), identified from the sheet: a bearded man, b red-shirt man, c gamer-shirt man, d crash-test dummy, e woman, f green-shirt man, g/h grey robots (SlopBots), i old man with glasses (Dean/Mayor), j police officer, k vest man, l zombie, m adventurer, n geisha-style woman, o orc, p pirate (eye patch), q suit + red tie (tech bro/Mayor), r ninja.
* **Animals** — *cube-pets* (×0.4): `animal-cat` 1.25×1.71×1.81, `animal-dog` 1.26×1.58×1.50, `animal-crab` 2.34×1.43×1.35, `animal-fish` 1.88×1.63×1.26, `animal-bunny` 1.25×2.01×1.33, `animal-fox` 1.25×1.69×2.31, `animal-beaver` 1.25×1.50×1.84, `animal-penguin` 2.19×1.59×1.35, `animal-parrot` 2.20×1.68×1.90, `animal-chick` 2.20×1.59×1.35, `animal-bee` 1.33×2.00×1.29, `animal-pig` 1.25×1.58×1.46 — `animal-cat` = the "Not A Cat" quest, `animal-fish` a salmon stand-in, `animal-parrot`/`chick` tinted dark → crows/gulls.
* **Kart drivers / blobs**: *car-kit*: `kart-oobi` 0.97×1.33×1.43, `kart-oodi` 0.97×1.33×1.43, `kart-ooli` 0.97×1.33×1.43, `kart-oopi` 0.97×1.33×1.43, `kart-oozi` 0.97×1.33×1.43; *platformer-kit*: `character-oobi` 0.87×0.91×0.60 (cute "Oo" aliens — good AI-slop-adjacent weirdness).

### Collectibles, toys, props, stadium
* **Collectibles / pickups**: *platformer-kit*: `coin-gold` 0.40×0.40×0.17, `coin-silver` 0.40×0.40×0.17, `star` 0.36×0.36×0.24, `heart` 0.41×0.38×0.12, `key` 0.38×0.22×0.07, `jewel` 0.33×0.37×0.29, `chest` 0.50×0.45×0.50, `crate` 0.50×0.50×0.50, `barrel` 0.52×0.48×0.52, `flag` 0.42×0.90×0.11, `spring` 0.75×0.47×0.75, `bomb` 0.49×0.54×0.49; gifts *holiday-kit*: `present-a-cube` 0.45×0.57×0.45, `present-b-round` 0.55×0.47×0.55, `present-a-rectangle` 0.65×0.42×0.45, `candy-cane-red` 0.30×0.45×0.10, `wreath` 0.67×0.76×0.26, `nutcracker` 0.55×1.08×0.35, `gingerbread-man` 0.34×0.38×0.08, `sock-red` 0.31×0.62×0.20, `reindeer` 0.63×1.12×1.07.
* **Stadium (Tee-Hee Park) / festival dressing**: *racing-kit*: `grandStand` 1.00×0.90×1.00, `grandStandCovered` 1.00×1.19×1.02, `grandStandAwning` 1.00×1.39×1.00, `grandStandRound` 1.64×0.90×1.64, `grandStandCoveredRound` 1.64×1.19×1.64, `pitsGarage` 1.00×0.70×1.09, `overhead` 1.26×0.67×0.19, `overheadRound` 1.87×0.93×0.33, `lightPostLarge` 0.38×0.80×0.10, `billboard` 1.00×1.00×0.48, `billboardLow` 1.00×0.69×0.48, `bannerTowerRed` 0.39×1.25×0.39, `flagCheckers` 0.20×1.25×0.04, `flagRed` 0.20×1.25×0.04, `fenceStraight` 1.00×0.50×0.03, `camera_exclusive` 0.11×0.41×0.26, `radarEquipment` 0.59×0.54×0.41.
* **Camp / workshop props**: *survival-kit*: `campfire-pit` 0.28×0.11×0.27, `bedroll` 0.31×0.13×0.61, `barrel` 0.24×0.34×0.24, `bucket` 0.14×0.19×0.14, `box` 0.25×0.25×0.25, `chest` 0.26×0.26×0.27, `signpost` 0.21×0.46×0.04, `workbench` 0.33×0.29×0.30, `tool-axe` 0.11×0.26×0.03, `tool-shovel` 0.07×0.29×0.03, `structure` 0.50×0.50×0.50, `structure-roof` 0.54×0.66×0.55.
* **Industrial**: *city-kit-industrial*: `shipping-container-a` 0.37×0.35×0.82, `shipping-container-b` 0.37×0.35×0.82, `shipping-container-c` 0.37×0.35×0.82, `detail-tank` 0.85×0.41×0.52; *retro-urban-kit*: `pallet` 1.00×0.15×1.00, `pallet-small` 0.50×0.15×0.57, `planks` 1.13×0.10×0.57, `detail-block` 0.50×0.50×0.50.

---

## 2. Kit-by-kit reference
Folder: `public/assets/models/kenney/<kit>/` — file = `<model>.glb`. Only the most useful models are listed (sizes are raw W×H×D); the contact sheets show everything.

### `city-kit-suburban` — houses & yard bits  (40 models, avg 751 tris)
Folder `assets/models/kenney/city-kit-suburban/` · scale ×8; palettes `variation-a|b|c`.
* Houses: 21 models `building-type-a` … `building-type-u` (W 0.92–1.83, H 0.74–1.24, D 0.89–1.43)
* Yards: `fence` 0.48×0.27×0.08, `fence-low` 1.28×0.17×0.84, `fence-1x2` 0.88×0.27×0.44, `fence-1x3` 1.28×0.27×0.44, `fence-1x4` 1.68×0.27×0.44, `fence-2x2` 0.88×0.27×0.84, `fence-2x3` 1.28×0.27×0.84, `fence-3x2` 0.88×0.27×1.24, `fence-3x3` 1.28×0.27×1.24, `driveway-long` 0.36×0.01×0.40, `driveway-short` 0.36×0.01×0.20, `path-long` 0.20×0.01×0.40, `path-short` 0.20×0.01×0.20, `path-stones-long` 0.14×0.01×0.40, `path-stones-messy` 0.16×0.01×0.36, `path-stones-short` 0.14×0.01×0.20, `planter` 0.40×0.18×0.30, `tree-large` 0.21×0.77×0.24, `tree-small` 0.21×0.57×0.24

### `city-kit-commercial` — shops, apartments, skyscrapers  (41 models, avg 1090 tris)
Folder `assets/models/kenney/city-kit-commercial/` · scale ×8; palettes `variation-a|b`.
* Low/mid-rise: 14 models `building-a` … `building-n` (W 0.84–2.32, H 0.89–3.15, D 0.90–1.82)
* Towers: `building-skyscraper-a` 1.36×2.88×1.36, `building-skyscraper-b` 1.36×4.48×1.36, `building-skyscraper-c` 1.28×4.08×1.39, `building-skyscraper-d` 1.28×5.47×1.39, `building-skyscraper-e` 1.29×4.08×1.24
* Details: `detail-awning` 0.40×0.40×0.15, `detail-awning-wide` 0.80×0.40×0.15, `detail-overhang` 0.50×0.40×0.20, `detail-overhang-wide` 1.00×0.40×0.20, `detail-parasol-a` 0.35×0.45×0.40, `detail-parasol-b` 0.35×0.45×0.40
* Distant filler (very cheap): 16 models `low-detail-building-a` … `low-detail-building-wide-b` (W 0.50–1.00, H 0.70–2.25, D 0.50)

### `city-kit-industrial` — factories, chimneys, tanks, containers, solar/wind  (37 models, avg 956 tris)
Folder `assets/models/kenney/city-kit-industrial/` · scale ×8; palettes `variation-a|b|c`.
* Buildings: 20 models `building-a` … `building-t` (W 0.88–2.48, H 0.71–1.93, D 0.91–2.11)
* Details: `chimney-basic` 0.20×1.00×0.20, `chimney-large` 1.08×1.70×1.08, `chimney-medium` 0.45×1.93×0.45, `chimney-small` 0.30×0.75×0.30, `detail-tank` 0.85×0.41×0.52, `detail-tank-large` 1.51×0.96×1.65, `shipping-container-a` 0.37×0.35×0.82, `shipping-container-b` 0.37×0.35×0.82, `shipping-container-c` 0.37×0.35×0.82, `water-tower` 0.85×2.14×0.83, `windmill` 0.60×2.31×1.13, `windmill-low` 0.60×1.79×1.13, `solar-panel-flat` 0.42×0.06×0.71, `solar-panel-landscape` 0.71×0.26×0.40, `solar-panel-landscape-group` 1.51×0.26×0.90, `solar-panel-portrait` 0.42×0.41×0.65, `solar-panel-portrait-group` 0.92×0.41×1.25

### `city-kit-roads` — road tiles, lights, signs, utility poles  (95 models, avg 180 tris)
Folder `assets/models/kenney/city-kit-roads/` · scale ×8; tile = 1×1 (`*-curve` 2×2, `roundabout` 3×3); palette `variation-a`.
* Tiles: `road-straight` 1.00×0.02×1.00, `road-straight-half` 0.50×0.02×1.00, `road-crossing` 1.00×0.02×1.00, `road-crossroad` 1.00×0.02×1.00, `road-crossroad-path` 1.00×0.02×1.00, `road-intersection` 1.00×0.02×1.00, `road-intersection-path` 1.00×0.02×1.00, `road-bend` 1.00×0.02×1.00, `road-curve` 2.00×0.02×2.00, `road-roundabout` 3.00×0.02×3.00, `road-end` 1.00×0.02×1.00, `road-end-round` 1.00×0.02×1.00, `road-side` 1.00×0.02×1.31, `road-split` 1.00×0.02×2.00, `road-driveway-single` 1.00×0.02×1.00, `road-driveway-double` 1.00×0.02×1.00, `road-slant` 1.00×0.27×1.00, `road-slant-high` 1.00×0.52×1.00, `road-bridge` 1.00×0.52×1.00, `tile-low` 1.00×0.02×1.00, `tile-high` 1.00×0.25×1.00
* Furniture: `light-square` 0.05×0.60×0.24, `light-curved` 0.05×0.68×0.23, `light-curved-double` 0.05×0.68×0.40, `traffic-light` 0.12×0.52×0.09, `traffic-light-hanging` 0.12×0.51×0.29, `road-sign-stop` 0.08×0.49×0.14, `road-sign-street` 0.20×0.47×0.20, `road-sign-warning` 0.08×0.50×0.15, `sign-highway` 0.13×0.71×1.00, `electricity-pole` 0.58×0.53×0.21, `electricity-wires` 0.51×0.07×0.18, `dumpster` 0.28×0.21×0.37, `construction-cone` 0.08×0.09×0.08, `construction-barrier` 0.14×0.13×0.22, `construction-fence` 0.08×0.18×0.38, `construction-light` 0.08×0.23×0.08, `bridge-pillar` 0.10×0.50×0.10

### `car-kit` — vehicles  (50 models, avg 1305 tris)
Folder `assets/models/kenney/car-kit/` · scale ×1.7; front = +Z; each car = `body` + 4 named wheel nodes (see §0 "Articulated parts"); the `wheel-*` models are extra spares.
* `sedan` 1.50×1.30×2.55, `sedan-sports` 1.30×1.10×2.55, `hatchback-sports` 1.30×1.10×2.85, `suv` 1.50×1.30×2.70, `suv-luxury` 1.50×1.30×2.85, `taxi` 1.50×1.50×2.75, `van` 1.50×1.35×2.75, `truck` 1.50×1.30×2.95, `truck-flat` 1.50×1.30×2.75, `delivery` 1.50×1.65×3.25, `delivery-flat` 1.50×1.35×3.25, `garbage-truck` 1.60×1.60×3.45, `police` 1.50×1.30×3.10, `ambulance` 1.50×1.80×3.25, `firetruck` 1.50×1.70×3.40, `tractor` 1.34×1.60×2.20, `tractor-police` 1.34×1.70×2.30, `tractor-shovel` 1.66×1.51×2.47, `race` 1.30×0.73×2.56, `race-future` 1.20×0.83×2.66
* Extras: karts `kart-oobi|oodi|ooli|oopi|oozi`, `box`, `cone`, `cone-flat`, `wheel-*` (7), `debris-*` (door, bumper, tire, plate, spoiler, bolt, nut).

### `food-kit` — food & kitchenware  (200 models, avg 173 tris)
Folder `assets/models/kenney/food-kit/` · scale ×0.4 (real) … ×0.8 (readable); origin bottom-centre.
* Highlights: `pizza` 0.84×0.04×0.84, `pizza-box` 0.94×0.88×0.95, `donut` 0.25×0.09×0.28, `ice-cream` 0.24×0.46×0.27, `sundae` 0.22×0.67×0.26, `cupcake` 0.36×0.42×0.31, `cake` 0.64×0.27×0.64, `burger` 0.40×0.29×0.40, `hot-dog` 0.59×0.15×0.20, `fries` 0.18×0.40×0.27, `taco` 0.43×0.26×0.11, `sandwich` 0.43×0.17×0.43, `fish` 0.20×0.32×0.62, `fish-bones` 0.31×0.07×0.64, `cup-coffee` 0.22×0.14×0.29, `soda-can` 0.22×0.35×0.22, `apple` 0.20×0.19×0.20, `banana` 0.14×0.20×0.63, `croissant` 0.35×0.19×0.48, `lollypop` 0.04×0.38×0.19, `turkey` 0.93×0.38×0.68

### `furniture-kit` — home furniture & appliances  (140 models, avg 191 tris)
Folder `assets/models/kenney/furniture-kit/` · scale ×2.1; **origin = front-left-bottom corner** (extends +x, −z).
* `kitchenSink` 0.43×0.49×0.45, `bathroomSink` 0.34×0.56×0.29, `kitchenFridge` 0.43×0.92×0.29, `kitchenStove` 0.43×0.45×0.45, `loungeSofa` 0.98×0.46×0.41, `loungeSofaLong` 0.98×0.46×0.82, `loungeChair` 0.49×0.46×0.41, `table` 0.84×0.33×0.45, `tableRound` 0.69×0.37×0.80, `desk` 0.73×0.38×0.39, `bedDouble` 0.96×0.38×1.13, `bookcaseClosed` 0.40×0.85×0.25, `televisionVintage` 0.41×0.27×0.27, `trashcan` 0.21×0.43×0.23, `pottedPlant` 0.21×0.65×0.24, `bathtub` 1.19×0.42×0.56, `toilet` 0.31×0.45×0.48, `washer` 0.39×0.47×0.39, `cardboardBoxClosed` 0.21×0.28×0.21, `lampRoundFloor` 0.15×0.86×0.18, `rugRound` 0.92×0.01×0.92, `doorway` 0.49×1.01×0.11, `wall` 1.00×1.29×0.05, `floorFull` 1.00×0.05×1.00

### `nature-kit` — trees, plants, rocks, terrain pieces  (329 models, avg 110 tris)
Folder `assets/models/kenney/nature-kit/` · pastel teal/peach palette (recolour, §0); origin ≈ ground (−0.05); trees ×4, bushes ×3, rocks ×2.5, flora ×1.5.
* Trees (+ `_fall`/`_dark` variants): `tree_default` 0.76×1.71×0.65, `tree_oak` 0.64×1.23×0.74, `tree_tall` 0.40×1.69×0.46, `tree_small` 0.35×1.11×0.41, `tree_pineTallD` 0.48×2.08×0.55, `tree_pineRoundA` 0.62×1.37×0.71, `tree_palm` 0.94×1.51×1.01, `tree_blocks` 0.60×1.19×0.60, `tree_detailed` 0.85×1.33×0.76
* Small stuff: `plant_bush` 0.40×0.24×0.40, `grass` 0.38×0.25×0.39, `grass_large` 0.41×0.25×0.41, `flower_redA` 0.16×0.29×0.18, `flower_yellowA` 0.16×0.19×0.18, `flower_purpleA` 0.16×0.24×0.18, `mushroom_redGroup` 0.27×0.25×0.25, `lily_large` 0.27×0.10×0.31, `log` 0.23×0.17×0.71, `stump_old` 0.36×0.27×0.37, `campfire_logs` 0.29×0.06×0.29, `canoe` 0.30×0.18×1.15, `canoe_paddle` 0.08×0.04×0.59, `sign` 0.30×0.41×0.07
* Rocks: `rock_largeA` 0.78×0.26×1.02, `rock_largeD` 1.07×0.57×1.03, `rock_smallA` 0.36×0.19×0.36, `rock_smallG` 0.59×0.24×0.69, `rock_tallA` 0.98×1.00×0.68, `rock_tallH` 0.57×0.71×0.66, `stone_largeA` 0.78×0.26×1.02, `stone_tallA` 0.98×1.00×0.68
* Terrain/tile families (1×1): `ground_grass`, `ground_path*`, `ground_river*`, `cliff_*` (rock + stone), `bridge_*`, `platform_*`, `crops_*`, `fence_*`, `statue_*`, `tent_*`, `campfire_*`.

### `watercraft-kit` — boats, ships, buoys, cargo  (46 models, avg 468 tris)
Folder `assets/models/kenney/watercraft-kit/` · scale ×2 (houseboats ×3); bow = +Z; origin bottom-centre at the waterline (buoys dip to −0.3).
* `boat-house-a` 2.68×2.17×4.64, `boat-house-b` 2.68×2.20×5.55, `boat-house-c` 2.68×3.00×5.15, `boat-house-d` 2.68×3.44×4.64, `boat-fishing-small` 1.78×2.60×3.87, `boat-sail-a` 1.78×4.74×3.77, `boat-speed-a` 1.78×1.50×3.37, `boat-speed-d` 2.00×1.20×3.87, `boat-tug-a` 1.78×2.24×3.47, `boat-tow-a` 2.88×3.33×6.12, `boat-row-small` 2.75×0.85×2.37, `boat-fan` 1.78×2.19×2.87, `ship-cargo-a` 3.92×3.38×10.55, `ship-large` 4.80×9.96×13.10, `ship-ocean-liner` 4.76×8.93×21.28, `buoy` 0.93×1.84×0.93, `buoy-flag` 0.93×2.72×1.29, `cargo-container-a` 1.38×1.10×2.76, `cargo-pile-a` 2.54×1.20×2.75, `gate` 6.20×4.65×1.20, `gate-finish` 6.20×4.65×1.20, `ramp` 2.73×1.14×2.81

### `pirate-kit` — docks, ships, barrels, palms, rocks, castle  (72 models, avg 434 tris)
Folder `assets/models/kenney/pirate-kit/` · scale ×1.5 for structures, ×0.45 for barrels/crates.
* Docks: `structure-platform-dock` 2.50×1.31×2.51, `structure-platform-dock-small` 1.90×1.31×2.51, `structure-platform` 2.50×0.93×2.51, `platform` 2.50×0.23×2.51, `platform-planks` 1.89×0.43×2.70, `structure` 2.50×2.20×2.50, `structure-roof` 3.08×3.40×3.23, `structure-fence` 2.50×2.20×2.50
* Props: `barrel` 1.34×1.23×1.34, `crate` 1.08×0.77×1.31, `crate-bottles` 1.08×1.06×1.31, `chest` 1.27×1.15×1.27, `bottle` 0.36×0.89×0.36, `cannon` 1.40×1.05×1.93, `cannon-ball` 0.64×0.67×0.55, `flag-pirate` 1.34×2.10×0.40, `mast` 4.39×7.86×1.74, `tool-paddle` 0.66×2.35×0.21, `tool-shovel` 0.66×2.35×0.28, `hole` 2.86×0.35×2.70
* Scenery: `palm-straight` 2.49×4.21×2.49, `palm-bend` 2.88×4.25×3.22, `rocks-a` 5.11×2.90×4.39, `rocks-sand-a` 5.11×3.21×4.39, `patch-sand` 7.74×0.25×6.04, `patch-grass` 5.27×0.25×4.11, `grass` 0.52×0.31×0.54; ships `ship-pirate-*`, `ship-ghost`, `ship-wreck`, `ship-small|medium|large`; castle `castle-*` and `tower-*` (skip).

### `platformer-kit` — collectibles, blocks, hazards  (153 models, avg 164 tris)
Folder `assets/models/kenney/platformer-kit/` · scale ×1; `block-grass-*`/`block-snow-*` are terrain blocks (skip).
* `coin-gold` 0.40×0.40×0.17, `coin-silver` 0.40×0.40×0.17, `coin-bronze` 0.40×0.40×0.17, `star` 0.36×0.36×0.24, `heart` 0.41×0.38×0.12, `key` 0.38×0.22×0.07, `jewel` 0.33×0.37×0.29, `chest` 0.50×0.45×0.50, `crate` 0.50×0.50×0.50, `crate-item` 0.50×0.50×0.50, `barrel` 0.52×0.48×0.52, `flag` 0.42×0.90×0.11, `sign` 0.48×0.60×0.13, `spring` 0.75×0.47×0.75, `bomb` 0.49×0.54×0.49, `saw` 0.79×0.79×0.30, `lever` 0.60×0.64×0.45, `ladder` 0.50×1.00×0.10, `pipe` 1.00×0.56×1.00, `button-round` 0.58×0.18×0.50, `flowers` 0.78×0.14×0.79, `mushrooms` 0.52×0.29×0.51, `tree` 1.09×1.93×1.11, `tree-pine` 0.95×2.00×0.95, `hedge` 1.00×0.40×0.30, `fence-low-straight` 1.00×0.30×0.20, `character-oobi` 0.87×0.91×0.60

### `mini-market` — supermarket interior  (20 models, avg 295 tris)
Folder `assets/models/kenney/mini-market/` · scale ×2; modular wall/floor pieces + shelves. NOT market stalls (see `fantasy-town-kit/stall*`, `racing-kit/tent*`); palettes `variation-a|b`.
* `shelf-boxes` 0.80×0.85×0.70, `shelf-bags` 0.80×0.86×0.70, `shelf-end` 0.80×1.05×0.40, `freezer` 0.80×0.35×0.60, `freezers-standing` 1.00×0.90×0.50, `cash-register` 0.85×0.59×0.85, `shopping-cart` 0.30×0.39×0.48, `shopping-basket` 0.35×0.25×0.35, `bottle-return` 0.45×1.09×0.48, `display-bread` 0.70×0.50×0.60, `display-fruit` 0.60×0.52×0.60, `character-employee` 0.78×0.72×0.40, `wall` 1.00×1.00×0.60, `wall-window` 1.00×1.00×0.60, `wall-door-rotate` 1.00×1.00×0.60, `floor` 1.00×0.03×1.00, `column` 0.73×1.00×0.73, `fence` 0.57×0.38×0.15

### `holiday-kit` — park benches, street lamp, cabin, presents, snow, toy train  (99 models, avg 287 tris)
Folder `assets/models/kenney/holiday-kit/` · bench ×1.3, lantern ×1.8, trees ×3.5, props ×1.
* `bench` 1.12×0.73×0.63, `bench-short` 0.62×0.73×0.63, `lantern` 0.53×1.74×0.45, `lantern-hanging` 0.43×0.67×0.42, `present-a-cube` 0.45×0.57×0.45, `present-a-round` 0.55×0.57×0.55, `present-b-rectangle` 0.65×0.47×0.45, `candy-cane-red` 0.30×0.45×0.10, `wreath` 0.67×0.76×0.26, `nutcracker` 0.55×1.08×0.35, `snowman` 1.10×1.06×0.69, `snowman-hat` 1.08×1.36×0.69, `sled` 0.63×0.38×1.00, `sock-red` 0.31×0.62×0.20, `lights-colored` 1.01×0.32×0.06, `reindeer` 0.63×1.12×1.07, `tree` 1.19×1.92×1.19, `tree-decorated` 1.19×2.29×1.19, `gingerbread-man` 0.34×0.38×0.08, `gingerbread-woman` 0.34×0.40×0.12, `snow-pile` 0.99×0.20×1.11, `rocks-medium` 1.98×0.88×1.72, `train-locomotive` 0.67×0.43×0.27, `train-wagon` 0.72×0.31×0.21, `trainset-rail-straight` 0.50×0.01×0.20, `festivus-pole` 0.50×1.40×0.50
* Log-cabin modules (≈1×1×0.3): `cabin-wall`, `cabin-door-rotate`, `cabin-window-a|b|c|large`, `cabin-corner*`, `cabin-roof*` (+ `-snow`), `cabin-fence`, `floor-wood`, `floor-stone`.

### `survival-kit` — camp props, tools, huts  (80 models, avg 158 tris)
Folder `assets/models/kenney/survival-kit/` · scale ×2.5 (tiny raw units).
* `tent` 0.56×0.49×0.56, `tent-canvas` 0.56×0.49×0.56, `campfire-pit` 0.28×0.11×0.27, `campfire-stand` 0.41×0.28×0.12, `bedroll` 0.31×0.13×0.61, `barrel` 0.24×0.34×0.24, `bucket` 0.14×0.19×0.14, `box` 0.25×0.25×0.25, `box-large` 0.25×0.25×0.50, `chest` 0.26×0.26×0.27, `fish` 0.20×0.11×0.07, `fish-large` 0.31×0.16×0.10, `bottle` 0.05×0.15×0.06, `signpost` 0.21×0.46×0.04, `workbench` 0.33×0.29×0.30, `tool-axe` 0.11×0.26×0.03, `tool-hammer` 0.09×0.15×0.04, `tool-shovel` 0.07×0.29×0.03, `resource-wood` 0.21×0.06×0.09, `resource-stone` 0.17×0.11×0.14, `rock-a` 0.56×0.39×0.62, `rock-flat` 1.79×0.20×1.45, `tree` 0.55×1.41×0.53, `tree-autumn` 0.55×1.41×0.53, `grass` 0.23×0.14×0.26, `patch-grass` 1.20×0.00×1.20, `fence` 0.50×0.52×0.04, `structure` 0.50×0.50×0.50, `structure-roof` 0.54×0.66×0.55, `floor` 0.50×0.05×0.50

### `racing-kit` — stadium/festival dressing, race track  (112 models, avg 220 tris)
Folder `assets/models/kenney/racing-kit/` · colours only (no palette texture; billboards/flags embed a fictional "TANKCO" ad); **not centred** — re-centre with catalog min/max.
* `grandStand` 1.00×0.90×1.00, `grandStandCovered` 1.00×1.19×1.02, `grandStandAwning` 1.00×1.39×1.00, `grandStandRound` 1.64×0.90×1.64, `tent` 1.00×0.70×1.00, `tentLong` 2.00×0.70×1.00, `tentClosed` 1.00×0.70×1.00, `tentRoof` 0.56×0.63×0.99, `billboard` 1.00×1.00×0.48, `billboardLow` 1.00×0.69×0.48, `bannerTowerRed` 0.39×1.25×0.39, `flagCheckers` 0.20×1.25×0.04, `flagRed` 0.20×1.25×0.04, `flagGreen` 0.20×1.25×0.04, `fenceStraight` 1.00×0.50×0.03, `fenceCurved` 1.00×0.82×0.32, `barrierWall` 1.00×0.13×0.12, `lightPostLarge` 0.38×0.80×0.10, `lightPostModern` 0.05×0.78×0.18, `pitsGarage` 1.00×0.70×1.09, `pitsOffice` 1.00×0.51×1.04, `overhead` 1.26×0.67×0.19, `overheadRound` 1.87×0.93×0.33, `camera_exclusive` 0.11×0.41×0.26, `radarEquipment` 0.59×0.54×0.41, `raceCarRed` 0.73×0.40×1.35, `treeLarge` 0.36×1.51×0.41, `pylon` 0.12×0.13×0.12
* Track pieces `road*` (56) are race-track asphalt — skip.

### `fantasy-town-kit` — market stalls, fountains, hedges, lantern (45 of the 167 medieval pieces)  (45 models, avg 250 tris)
Folder `assets/models/kenney/fantasy-town-kit/` · stalls ×2, fountains ×3, lantern ×2, trees ×2.5; palette `variation-a`. Walls/roofs omitted on purpose (edit the `only` filter in `tools/import-kenney.mjs` for more).
* Market: `stall-red` 1.00×1.24×1.00, `stall-green` 1.00×1.24×1.00, `stall` 0.65×0.37×1.00, `stall-bench` 0.26×0.23×0.94, `stall-stool` 0.26×0.23×0.26, `cart` 0.89×0.54×1.34, `cart-high` 0.89×0.86×1.39, `banner-red` 0.05×0.84×0.50, `banner-green` 0.05×0.84×0.50, `wheel` 0.24×0.48×0.47
* Fountains: `fountain-round` 2.00×0.28×2.00, `fountain-round-detail` 2.00×0.48×2.00, `fountain-square` 2.00×0.46×2.00, `fountain-square-detail` 2.00×0.48×2.00 (+ `fountain-corner*`, `-edge`, `-curved`, `-center` pieces)
* Garden: `hedge` 0.25×0.25×1.00, `hedge-large` 0.40×0.60×1.00, `hedge-curved` 1.00×0.25×1.00, `fence` 0.07×0.38×1.00, `fence-gate` 0.07×0.38×1.00, `lantern` 0.22×1.56×0.22, `pillar-stone` 0.16×1.00×0.16, `rock-large` 1.67×1.16×1.55, `stairs-stone` 1.02×1.00×0.50, `tree` 1.02×2.41×1.02, `tree-high` 1.02×2.97×1.02

### `retro-urban-kit` — grungy modular city bits (style outlier)  (124 models, avg 29 tris)
Folder `assets/models/kenney/retro-urban-kit/` · scale ×2.5–3; 64 px textures → `NearestFilter`; lit-fixed on import.
* `detail-bench` 0.60×0.41×0.32, `detail-dumpster-closed` 0.60×0.55×0.45, `detail-dumpster-open` 0.60×0.55×0.48, `detail-barrier-type-a` 0.43×0.40×0.13, `detail-barrier-strong-type-a` 0.66×0.33×0.25, `detail-light-single` 0.09×0.96×0.26, `detail-light-traffic` 0.16×1.04×0.58, `pallet` 1.00×0.15×1.00, `planks` 1.13×0.10×0.57, `truck-green` 0.83×1.01×1.64, `truck-grey` 0.83×1.01×1.64, `truck-flat` 0.83×1.01×1.64, `tree-park-large` 1.04×1.46×1.04, `wall-a` 1.00×1.00×1.00, `wall-a-door` 1.00×1.00×1.00, `wall-a-window` 1.00×1.00×1.00, `wall-a-garage` 1.00×1.00×1.00, `wall-b` 1.00×1.00×1.00, `roof-metal-type-a` 1.14×0.50×1.00, `scaffolding-structure` 1.00×1.00×1.00, `road-asphalt-straight` 1.00×0.05×2.00, `road-dirt-straight` 1.00×0.05×2.00, `grass` 1.00×0.00×1.00, `cliff-side` 1.00×1.00×1.00

### `mini-characters` — chunky toy humans + mobility aids (skinned, animated)  (26 models, avg 506 tris)
Folder `assets/models/kenney/mini-characters/` · scale ×2.6; face +Z; `SkeletonUtils.clone`; clips in §0.
* People: 12 models `character-female-a` … `character-male-f` (W 0.77–1.10, H 0.66–0.79, D 0.34–0.53)
* Accessories: `aid-sunglasses` 0.33×0.10×0.18, `aid-glasses` 0.33×0.10×0.18, `aid-cane` 0.10×0.32×0.23, `aid-crutch` 0.20×0.31×0.19, `aid-mask` 0.34×0.20×0.21, `aid-defibrillator-red` 0.23×0.29×0.14, `wheelchair` 0.50×0.49×0.58, `wheelchair-deluxe` 0.58×0.49×0.59, `wheelchair-power` 0.48×0.57×0.51

### `blocky-characters` — blocky humans (animated)  (18 models, avg 72 tris)
Folder `assets/models/kenney/blocky-characters/` · scale ×0.65 (2.7 → 1.75 m); per-character 1024² textures (`NearestFilter`); node-animated, no skin.
* People: 18 models `character-a` … `character-r` (W 1.60, H 2.70, D 0.80)

### `cube-pets` — cube animals (animated)  (24 models, avg 639 tris)
Folder `assets/models/kenney/cube-pets/` · scale ×0.4; clips `idle, walk, run, eat, dance, gesture-positive|negative`.
* Animals: 24 models `animal-beaver` … `animal-tiger` (W 1.25–2.34, H 1.43–2.01, D 1.26–2.31) — beaver, bee, bunny, cat, caterpillar, chick, cow, crab, deer, dog, elephant, fish, fox, giraffe, hog, koala, lion, monkey, panda, parrot, penguin, pig, polar, tiger.

---

## 3. PBR textures (Poly Haven, CC0, 1k JPG) — `public/assets/textures/<name>/{color,normal,rough}.jpg`
`color` = sRGB albedo · `normal` = **OpenGL (Y+)** tangent-space (Three.js default, no flip) · `rough` = linear roughness (G channel). All seamless.
`texture.repeat = surface size in metres / real-world tile`.

| name | Poly Haven asset | real-world tile | use it for / notes |
|---|---|---|---|
| `asphalt` | [Asphalt 02](https://polyhaven.com/a/asphalt_02) — Rob Tuytel | 3 × 3 m | roads (dark grey, few cracks). Lane paint = separate decal/canvas |
| `sidewalk` | [Concrete Pavement 02](https://polyhaven.com/a/concrete_pavement_02) — Charlotte Baglioni | 1.8 × 1.8 m | concrete sidewalks (subtle slab grid, warm grey) |
| `paving` | [Large Square Pattern 01](https://polyhaven.com/a/large_square_pattern_01) — Rob Tuytel | 3 × 3 m | plaza paving slabs (City Hall plaza, UW quad, Locks walkway) |
| `grass` | [Leafy Grass](https://polyhaven.com/a/leafy_grass) — Charlotte Baglioni | 2 × 2 m | lawn/park ground — olive; **multiply `material.color` by a saturated green (e.g. `0xa8e070`)** for the sunny look |
| `brick` | [Red Brick](https://polyhaven.com/a/red_brick) — Rob Tuytel | 1.4 × 1.4 m | brick walls (bright red-orange); tint for variety |
| `planks` | [Weathered Planks](https://polyhaven.com/a/weathered_planks) — Dario Barresi, Dimitrios Savva | 2 × 2 m | dock / boardwalk / deck (dark weathered planks, grain runs along V) |
| `siding` | [Brown Planks 05](https://polyhaven.com/a/brown_planks_05) — Rob Tuytel | 1 × 1 m | painted wooden clapboard for houses (light grey-beige: **tint** it teal/blue/yellow/pink via `material.color`) |
| `shingles` | [Roof Slates 02](https://polyhaven.com/a/roof_slates_02) — Rob Tuytel | 3 × 3 m | roof shingles / cedar shakes (mid-light grey-tan, tintable) |
| `dirt` | [Brown Mud Dry](https://polyhaven.com/a/brown_mud_dry) — Rob Tuytel | 1.3 × 1.3 m | garden beds, dirt paths, dumpster-diving alley ground (brown, pebbly) |
| `gravel` | [Gravel Ground 01](https://polyhaven.com/a/gravel_ground_01) — Rob Tuytel | 3 × 3 m | gravel paths / park trails / driveways (pale beige) |
| `sand` | [Dense Sand](https://polyhaven.com/a/dense_sand) — Dimitrios Savva | 1.8 × 1.8 m | beach strip along Salmon Bay, sandbox |
| `mossy_stone` | [Mossy Rock](https://polyhaven.com/a/mossy_rock) — Rob Tuytel | 3 × 3 m | boulders, pond edges, Locks walls (lichen/moss rock face; big UV scale or triplanar) |

```ts
const rep: [number, number] = [roadLen / 3, roadWidth / 3];                          // surface metres / tile metres (asphalt tile = 3 m)
const [map, normalMap, roughnessMap] = await Promise.all([
  game.assets.texture('assets/textures/asphalt/color.jpg',  { repeat: rep }),             // sRGB albedo (RepeatWrapping + anisotropy set by Assets)
  game.assets.texture('assets/textures/asphalt/normal.jpg', { srgb: false, repeat: rep }), // linear data maps
  game.assets.texture('assets/textures/asphalt/rough.jpg',  { srgb: false, repeat: rep }),
]);
const mat = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, roughness: 1, metalness: 0 });
```
Preview of all sets on spheres under the HDRI: `tools/_catalog_previews/_textures/materials.png`. (`shingles` roughness is ≈ flat white in Poly Haven's data; that is normal.)

## 4. HDRI — `public/assets/hdri/sunny_sky_1k.hdr`
[Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) by Greg Zaal & Jarod Guest — CC0, 1024×512 Radiance HDR, pure sky (no ground clutter), midday, partly cloudy.
Use as `scene.environment` (PMREM) for reflections/IBL; keep the game's own sky + fog as the visible background.
The sun in the image is at **elevation 47.9°**; unit direction toward it (Three.js Y-up, `EquirectangularReflectionMapping`, no rotation) is **(0.554, 0.742, 0.378)** —
put the `DirectionalLight` there (`light.position.set(0.554, 0.742, 0.378).multiplyScalar(200)`) so shadows agree with reflections (east-south-east in this world: +X east, −Z north).
```ts
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { assetUrl } from './core/Assets';
const hdr = await new RGBELoader().loadAsync(assetUrl('assets/hdri/sunny_sky_1k.hdr'));
scene.environment = new THREE.PMREMGenerator(renderer).fromEquirectangular(hdr).texture;
```

## 5. Fonts — `public/assets/fonts/`
| file | role | license file |
|---|---|---|
| `LuckiestGuy-Regular.ttf` | **display** (titles, score popups; chunky comic caps, Latin only) | Apache-2.0 — `LICENSE-LuckiestGuy-Apache-2.0.txt` |
| `LilitaOne-Regular.ttf` | alt display (rounder, friendlier; Latin + Latin-ext) | OFL-1.1 — `OFL-LilitaOne.txt` (Reserved Font Name: do not rename/modify the font) |
| `Nunito-VariableFont_wght.ttf` | **UI/body**, weights 200–1000 in one file | OFL-1.1 — `OFL-Nunito.txt` |
```css
@font-face { font-family: 'Luckiest Guy'; src: url('/assets/fonts/LuckiestGuy-Regular.ttf') format('truetype'); font-display: swap; }
@font-face { font-family: 'Lilita One';   src: url('/assets/fonts/LilitaOne-Regular.ttf')   format('truetype'); font-display: swap; }
@font-face { font-family: 'Nunito';       src: url('/assets/fonts/Nunito-VariableFont_wght.ttf') format('truetype'); font-weight: 200 1000; font-display: swap; }
```
(Vite prefixes `base` to absolute `/assets/…` URLs in CSS. For canvas-drawn signs call `await document.fonts.load('32px "Luckiest Guy"')` before drawing.)

---

## 6. NOT available — we build these ourselves (Blender agent / procedural)
* **City:** fire hydrant · **bus** + bus-stop shelter · mailbox · phone booth · bicycle/scooter · park playground (swings, slide, seesaw, climber, trampoline) ·
  picnic table (compose from furniture table + benches) · BBQ grill / **propane tank** (industrial `detail-tank` is a horizontal tank, not a bottle) · pool ·
  gum wall · Salmon-Run costumes · Ballard-Locks gates & **fish ladder** · pilings for docks (deck pieces exist: pirate-kit docks).
* **Landmarks:** **Space Noodle** · City Hall · Jimothy statue/mural · graduation stage/cap/gown/diploma · UW-style gothic buildings ·
  SlopCorp data center (server racks, cooling), six-fingered billboard, AI dragon, SlopBot, Slopothys · Goodwheel Thrift & Bean-Me-Up signage (canvas textures).
* **Characters/animals:** Jimothy, Mom, Danny, kits (raccoons — all custom) · crows, seagulls, ducks · salmon (stand-ins: `survival-kit/fish`, `cube-pets/animal-fish`, `food-kit/fish`) ·
  teddy bear (`furniture-kit/bear` is a wall trophy) · Wildlife Officer (retint `mini-characters/character-male-c`).
* **Items:** **cotton candy** · golden rookie card · golden bobbleheads · baseball bat/cap · money/bills (`platformer-kit/coin-gold` works for coins) · Mount-Rainier silhouette, terrain, water, sky (procedural).
* **Downloaded but not imported** (in `tools/_downloads/extracted/`, gitignored): Kenney graveyard-kit, toy-car-kit, space-kit, mini-forest, mini-skate, minigolf-kit, building-kit, modular-buildings,
  3d-road-tiles, and the FBX-only animated-characters-* (Protagonists/Retro/Survivors). More CC0 3D kits: <https://kenney.nl/assets/category:3D>.

## 7. Tools
* `node tools/catalog.mjs` — rebuild `public/assets/catalog.json` (indexes every `public/assets/models/**/*.glb|gltf`; our own models appear as kit `custom`). Uses the `@gltf-transform/core` + `functions` devDependencies.
* `node tools/import-kenney.mjs [kit …]` — download → extract → copy GLBs + textures + license (+ the lit/metalness fix-ups). Add kits/filters in its `KITS` table, then re-run `tools/catalog.mjs`.
* Local-only QA helpers (headless Chrome + Three.js, in the gitignored `tools/_downloads/scripts/`): `node tools/_downloads/scripts/render_sheets.mjs [kit …]` rebuilds the contact sheets
  (also works for our own models: `… render_sheets.mjs custom`), `render_orient.mjs` (view models from any direction), `render_variants.mjs` (palette swaps), `render_materials.mjs`, `render_scale_check.mjs`.
