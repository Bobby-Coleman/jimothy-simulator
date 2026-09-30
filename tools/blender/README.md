# tools/blender — procedural raccoons & accessories

Every model in `public/assets/models/{jimothy,jimothy_ball,danny,slopothy,mom,kit,accessories}.glb` is generated
from scratch by the Python scripts in this folder, running inside Blender 5.2 LTS (headless).
No downloaded or third-party geometry/textures: shapes are numpy SDFs + parametric tubes/spheres,
fur patterns are procedural vertex colours (the walking Jimothy's are baked into a texture). Output is deterministic
(fixed seeds).

## Regenerate

```sh
BLENDER="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"

# the walking Jimothy -> public/assets/models/jimothy.glb (~50 s; previews jimothy_views/_face/_posed.png)
"$BLENDER" -b --factory-startup -P tools/blender/build_jimothy.py -- [--no-render] [--tris 13000] [--tex 2048]
#   --calibrate: photo-pose silhouettes (bare skin, skin + shell fur) in reference/frames/calib/ to lay over the
#   side-on reference photo (the photo itself is not in the repo)

# raccoons -> public/assets/models/*.glb  (+ preview PNGs in tools/blender/renders/)
# ('jimothy' builds jimothy_ball.glb: Jimothy rolled up into a ball, his rolling form)
"$BLENDER" -b --factory-startup -P tools/blender/build_raccoons.py -- [--only jimothy,danny,slopothy,mom,kit] [--no-render]

# accessories -> public/assets/models/accessories.glb (its preview render imports jimothy_ball.glb, so build that first)
"$BLENDER" -b --factory-startup -P tools/blender/build_accessories.py -- [--no-render]

# validate: parses the GLB JSON (what three.js sees) + re-imports into Blender, prints node tree,
# pivots, triangle counts, bboxes, materials, COLOR_0 usage; --render renders the re-imported file
"$BLENDER" -b --factory-startup -P tools/blender/validate_glb.py -- [--render] [public/assets/models/jimothy.glb ...]
```

A full rebuild of everything takes ~25 s. No system Python is needed (Blender's bundled Python + numpy).
Previews land in `tools/blender/renders/` (gitignored): `<model>_views.png` (front / 3/4 / side / back),
`<model>_face.png` (close-up), `<model>_glb.png` (render of the re-imported GLB) and
`accessories_on_jimothy.png`.

| file | contents |
|---|---|
| `rlib.py` | shared library: SDF primitives + surface-nets mesher, tubes/lofts/spheres, vectorised noise, a game-space scene graph that becomes Blender objects, vertex painting, materials, GLB export, studio preview renderer |
| `jimothy_anatomy.py` | the real Jimothy's body, fitted to reference footage: skeleton, SDF sculpt, traced face markings, colours, per-vertex shell-fur length (no bpy) |
| `build_jimothy.py` | builds `jimothy.glb` from the anatomy: mesh, UVs + baked texture, fur lengths, rig + skin weights |
| `build_raccoons.py` | round-raccoon builder (Jimothy's rolled-up ball, Danny, Slopothy variants) and quadruped builder (Mom, Kit) |
| `build_accessories.py` | the six mutator cosmetics, authored in Jimothy's Head space |
| `validate_glb.py` | GLB checker (see above) |

## Conventions (all files)

* **glTF / three.js space: +Y up, +Z forward (the way the animal faces), +X = the animal's LEFT, 1 unit = 1 m.**
  L/R suffixes are the animal's own left/right (`EarL`, `HandL`, `LegFL` … are on the +X side).
* Every animatable part is a separate node whose **origin is at its joint** (see tables).
* Rest rotations are **identity** for every node except ears and tail segments, so for most parts you can set
  Euler angles directly. For ears/tails keep the rest quaternion and multiply your offset onto it:
  `node.quaternion.copy(rest).multiply(offset)`.
  * Arms/legs hang along local −Y: `rotation.x > 0` swings the paw backward (−Z), `< 0` forward.
  * Ears: local +Y points up along the ear, local +Z out of the ear's front (the dark inner side); twitch about local X or Z.
  * Tail segments: each extends along its **local −Z** from its pivot, local +Y ≈ up. Wag = rotate about local Y,
    lift = positive rotation about local X (droop = negative). Rest rotations encode the gentle curve.
* The `Head` node's rest rotation is identity; eyes/nose/mouth/ears/brows are its children.
* Multi-material nodes (`EyeL/R`, `ExtraEye*`, `LegL/R`, `ExtraLeg*`, `LegFL…LegBR`, and the GradCap, Sunglasses,
  BubbleHelmet and Crown accessories) load in three.js as a `Group` whose children are the per-material meshes.
  The transform is on the group, so animation works the same.
* Modifiers applied, normals exported, no animations, no UVs (see caveats).

## Jimothy — `jimothy.glb` (14,240 triangles): the real, walking Jimothy

The raccoon himself: a short, arched ("scrunched") spine under a round, domed back, a head that hangs down with
almost no neck (the skull is the top of his head: between the ears there's only fur), long normal raccoon legs, a
very short cottontail-like tail puff and his traced mask. 0.70 m tall at the arch of the back, 0.76 m nose to tail.
**Origin on the ground under him; feet rest on y = 0.** The body is the physical animal only: the game's shell fur
supplies the fluff (see `_FURLEN`, `_FURCOMB`).

* One **skinned** mesh `JimothyBody` (material `Fur`, 13,000 tris): `baseColorTexture` 2048² JPEG (UV islands on the
  head get 2.6× the texel density so the mask is crisp), **no vertex colours**, and two custom attributes:
  * **`_FURLEN`** (float; three.js `_furlen`): shell-fur length as a multiple of Fur.ts's FUR_LENGTH: a long
    under-fluff hanging from the belly and lower flanks (up to ~3), cheek ruffs ~1.4, back and crown 1.0, face
    0.1–0.3, lower legs ~0.2, paws 0.12, soles 0; everything in uneven patches (±30 %) for his rather disorderly coat.
  * **`_FURCOMB`** (vec3, model space; three.js `_furcomb`): the direction the fur lies in, as the lean of the shell
    tips per unit of fur length: back along the body, down on the belly fringe and legs, plus random per-patch leans.
    (Blender's glTF exporter writes custom vector attributes without its Z-up → Y-up conversion, so build_jimothy.py
    stores it in game space.)
* Rigid children of the `Head` bone: `EyeL`/`EyeR` (pivot = eye centre, r = 0.011, material `Eye`; each has an
  `EyeLGlint`/`EyeRGlint` child, `EyeHighlight`) and `Nose` (`Nose`).
* **Every bone's rest rotation is identity** (they point up in Blender with roll 0), so each bone's local axes are the
  model's: +X his left, +Y up, +Z forward. Pose with plain Euler angles: +X rotation pitches a leg's lower end / the
  nose down-and-back (same sense as the ball's limbs).

| bone | parent | joint (model space) |
|---|---|---|
| `Hips` | – | (0, 0.452, −0.187) pelvis |
| `Spine1` → `Spine2` → `Chest` → `Neck` | chain | along the arched spine: (0, .572, −.074), (0, .617, .063), (0, .598, .185), (0, .563, .261) |
| `Head` | Neck | (0, 0.530, 0.262) back of the skull |
| `Jaw` | Head | (0, 0.440, 0.318) hinge (chitter) |
| `EarL`/`EarR` | Head | (±0.084, 0.574, 0.318) ear bases |
| `ScapulaL/R` → `ArmL/R` → `ForearmL/R` → `HandL/R` | Chest | scapula top (±.06, .618, .159), shoulder, elbow, wrist |
| `ThighL/R` → `ShinL/R` → `FootL/R` → `ToesL/R` | Hips | hip (±.096, .435, −.136), knee, ankle, ball of the foot |
| `Tail` | Hips | (0, 0.469, −0.238) sacrum; the puff |

Skin weights come from the anatomy (each vertex belongs softly to its body part, then to the nearest bones), smoothed
over the mesh, 4 influences. The game animates it procedurally (`src/player/JimothyQuad.ts`: two-bone leg IK, gaits,
carrying in a paw / the mouth / hugged while standing).

## Jimothy rolled up — `jimothy_ball.glb` (13,783 triangles): the rolling form

A 0.73 m ball (body ellipsoid radii x 0.365 / y 0.35 / z 0.378) with the face on the front-upper part, no neck,
stubby socked legs, 5-fingered hands and a short, fat 0.26 m ringed tail stub (2 rings + dark tip; the real Jimothy's
tail is a very short puff). (Built by `build_raccoons.py --only jimothy`; the pivot table below predates the short
tail, whose segment pivots are now closer together.)
Origin = centre of the body sphere; feet/hand bottoms at y = −0.42.

| node | parent | pivot (Jimothy space) | notes |
|---|---|---|---|
| `Jimothy` | – | (0, 0, 0) | root empty |
| `Body` | Jimothy | (0, 0, 0) | the ball, `Fur`, 1,452 tris |
| `Head` | Body | **(0, 0, 0)** | face "hood", `Fur`, 4,997 tris; pivot = ball centre (see below) |
| `EyeL` / `EyeR` | Head | (±0.093, 0.126, 0.341) | pivot = eye centre, r = 0.05; `Eye` + `EyeHighlight` |
| `Nose` | Head | (0, 0.034, 0.476) | `Nose` |
| `Mouth` | Head | (0, 0.017, 0.476) | extra: tiny ":3" mouth line, `Nose` material |
| `EarL` / `EarR` | Head | (±0.172, 0.285, 0.082) | pivot = ear base; tilted rest rotation, `Fur` |
| `ArmL` / `ArmR` | Body | (±0.122, −0.200, 0.130) | pivot = shoulder, `Fur` |
| `HandL` / `HandR` | ArmL / ArmR | (±0.128, −0.384, 0.190) | pivot = wrist; palm + 5 fingers, `Paw` |
| `LegL` / `LegR` | Body | (±0.132, −0.180, −0.120) | pivot = hip; leg (`Fur`) + foot with 5 toes (`Paw`) |
| `Tail1` | Body | (0, −0.100, −0.290) | pivot inside the body; chain continues below |
| `Tail2`…`Tail5` | previous segment | (0.001, −0.136, −0.438), (0.007, −0.151, −0.590), (0.023, −0.138, −0.741), (0.054, −0.093, −0.883) | 330 tris each |

**Head pivot = (0, 0, 0), the ball centre.** Jimothy has no neck: the head *is* the front of the ball. The `Head`
mesh is a face-shaped bulge whose rim is tucked ~1 cm under the body surface, with colours that fade into the
body's colours, so at rest the seam is invisible. Because it rotates about the ball's centre, the face and
ears slide around the ball surface and the tucked rim stays buried. Combined head turns of 35° yaw with 15° pitch, and a 16° roll
(cute head-tilt) with 12° yaw, have been render-tested without visible seams. (A pivot nearer the face made the
rim pop out by ~25°.)

## Danny — `danny.glb` (13,704 triangles)

Same construction and node names as Jimothy, root `Danny`, **everything scaled ×1.12** (origin = body centre,
feet at y ≈ −0.47, `Head` pivot still (0, 0, 0)). He is greyer, with a slightly squatter ball, and has two extra
nodes: **`BrowL` / `BrowR`** (children of Head; pivots at (±0.118, 0.200, 0.399); bushy white "old man"
eyebrow clumps drooping over the eyes; `Fur`), so the game can raise or wiggle them.
Other pivots are Jimothy's × 1.12, e.g. eyes (±0.107, 0.134, 0.388), shoulders (±0.137, −0.224, 0.146),
wrists (±0.143, −0.430, 0.213), hips (±0.148, −0.202, −0.134), ears (±0.193, 0.316, 0.092), `Tail1` (0, −0.112, −0.325).

## Slopothy — `slopothy.glb` (14,717 triangles)

Jimothy's base with generative-AI errors. Root `Slopothy`, same node names, and the main material is **`Slop`**
(vertex-coloured like `Fur`, with a slightly lavender "off" palette), so the game can swap in its glitch shader.
Errors:
* 4 eyes of mismatched sizes and heights. `EyeL`/`EyeR` plus `ExtraEye1` (forehead, pivot (0.012, 0.215, 0.314))
  and `ExtraEye2` (left cheek, pivot (−0.183, 0.034, 0.339)), all children of Head.
* 6 legs. `ArmL/R` and `LegL/R` plus `ExtraLeg1` / `ExtraLeg2` (children of Body, hips at (±0.17, −0.15, 0.0),
  6 toes each).
* Hands with 7 fingers.
* `EarL` 1.8× and `EarR` 0.85×.
* A second tail growing out of the head. `ExtraTail1`→`ExtraTail2`→`ExtraTail3` chain; `ExtraTail1` is a child
  of Head with its pivot at (0.04, 0.26, 0.08), same local axes as the main tail.
* Melted, off-centre muzzle with a chin drip, a warped asymmetric mask, a lopsided mouth, and 7 uneven tail rings.
* The Head mesh is asymmetric (it is the only non-mirrored model).

## Mom — `mom.glb` (12,139 triangles)

Normal-shaped adult raccoon: about 0.78 m nose-to-rump (plus a 0.44 m tail), 0.35 m at the shoulder with a hunched rump.
Faces +Z. **Origin at ground level between the feet** (paws touch y = 0).

| node | parent | pivot | notes |
|---|---|---|---|
| `Mom` | – | (0, 0, 0) | root empty |
| `Body` | Mom | (0, 0, 0) | `Fur` |
| `Head` | Body | (0, 0.285, 0.150) | pivot = neck base; mesh includes the neck (buried in the chest) |
| `EyeL/R`, `Nose`, `Mouth` | Head | eyes (±0.035, 0.331, 0.340), nose (0, 0.279, 0.419), mouth (0, 0.271, 0.419) | |
| `EarL/R` | Head | (±0.058, 0.368, 0.262) | tilted rest rotation |
| `LegFL/LegFR` | Body | (±0.070, 0.220, 0.120) | pivot = shoulder; leg (`Fur`) + 5-fingered hand (`Paw`) |
| `LegBL/LegBR` | Body | (±0.080, 0.250, −0.200) | pivot = hip; leg (`Fur`) + plantigrade foot (`Paw`) |
| `Tail1`…`Tail5` | Body → chain | Tail1 (0, 0.300, −0.300) … Tail5 (0.015, 0.169, −0.627) | same axis convention as Jimothy's tail |

## Kit — `kit.glb` (9,018 triangles)

Baby raccoon: about 0.23 m nose-to-rump (plus a short up-curled tail), oversized head (half its length) and huge eyes.
Same node naming as Mom, root `Kit`, origin at ground level: `Head` (0, 0.086, 0.020), eyes (±0.026, 0.119, 0.097),
nose (0, 0.096, 0.123), mouth (0, 0.091, 0.123), ears (±0.037, 0.154, 0.042), `LegFL/FR` (±0.030, 0.060, 0.020),
`LegBL/BR` (±0.034, 0.060, −0.070), `Tail1` (0, 0.075, −0.090) … `Tail5` (0.008, 0.119, −0.173).

## Materials

| material | used by | notes |
|---|---|---|
| `Fur` | bodies, heads, ears, arms, legs (upper), tails, Danny's brows | **vertex colours (COLOR_0) carry the whole pattern**; baseColorFactor = white, roughness 0.92. This is the material the game should add shell fur to |
| `Slop` | Slopothy's equivalent of `Fur` | same setup, different name for the glitch shader |
| `Paw` | hands, feet | vertex-coloured dark grey-black, roughness 0.72 (no fur) |
| `Eye` | eye spheres | near-black, roughness 0.05 (glossy, picks up env/spec highlights); make it emissive for night eyeshine |
| `EyeHighlight` | two tiny catchlight discs baked onto each eye | white, emissive 1.0: the "anime sparkle". Hide these meshes by material name if you only want lit highlights |
| `Nose` | noses, mouths | near-black, roughness 0.3 |

three.js' GLTFLoader turns on `vertexColors` automatically for meshes that have COLOR_0, so final albedo =
white × vertex colour. No material uses `KHR_materials_specular`/physical extensions, so all load as
`MeshStandardMaterial`.

## Accessories — `accessories.glb` (12,448 triangles total)

Six **root-level** nodes, each at the origin with identity transform: `GradCap` (680 tris), `Sunglasses` (1,960),
`BaseballCap` (1,240, teal/navy), `Beanie` (3,652, Grandma's red knit with cream stripe and pompom),
`BubbleHelmet` (3,216, transparent `Glass` dome + metal collar), `Crown` (1,700, gold, deliberately a bit too small).

They are authored in **Jimothy's Head space**. The Head pivot is at **(0, 0, 0) in Jimothy space** (the ball
centre, which is also where Body's origin is), so each accessory's geometry is already where it belongs
relative to the Head node:

```ts
const acc = accessoriesGltf.scene.getObjectByName('Beanie')!.clone();
jimothy.getObjectByName('Head')!.add(acc);   // position/rotation = 0, scale = 1
// Danny is Jimothy x1.12 with the same Head pivot:  acc.scale.setScalar(1.12)
```

Because they are children of Head, they follow head turns. Hats let the ears poke through (cartoon ear holes).
Materials: `CapBlack`, `Tassel` (GradCap); `Frame`, `Lens` (Sunglasses); `CapFabric` (BaseballCap);
`Knit` (Beanie); `Glass` (alphaMode BLEND, alpha 0.13) + `HelmetMetal` (BubbleHelmet); `Gold`, `GemRed`,
`GemBlue` (Crown). `CapBlack`, `Tassel`, `CapFabric` and `Knit` use vertex colours; the rest are plain colours.
For the bubble you may want `material.depthWrite = false` and a later `renderOrder` so the raccoon shows through
cleanly.

## Caveats / notes for the game

* **No UVs.** Drive fur-shell strand noise from object-space position (3D or triplanar noise). Vertex colours
  carry only the large-scale pattern (mask, brows, muzzle, belly bib, dark saddle, sock-coloured legs, tail
  rings). Strand-level grizzle is meant to come from the shell shader.
* The round raccoons' `Head` is an open "hood" surface (its rim is tucked under the body surface), and the
  quadrupeds' neck ends are open inside the body. Don't render a Head on its own or scale it up a lot.
* Limb tubes, tail segments and the head hood intentionally interpenetrate their parents, so joints stay closed
  when rotated. Tail segments have rounded ends that act like ball joints. About 15° of wag per joint (≈60° over the chain) was render-tested.
* The `Mouth` node is an extra (not in the original spec) so it can be hidden or animated independently.
* Triangle budget: Jimothy 13.8k (limit 15k); Danny 13.7k, Slopothy 14.7k, Mom 12.1k, Kit 9.0k, accessories 0.7k–3.7k each.
