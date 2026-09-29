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
  objectives + mutators + collectibles.
