# Steam store and library art

Every picture here is an in-game render (WebGL, `quality=high`, rendered at 2x and downscaled). The capsules add the
game's own title logo (`logoHtml()` in `src/ui/Title.ts` with its CSS and fonts, the letter wave frozen) over a soft
shadow for contrast; the page background is blurred and darkened. No other text is added.
Rendered from a build of the working tree on 2026-10-01 (HEAD `a240268`). Not part of the web build (`steam/` is outside `public/`).

## Files

| File | Size | What it shows | Where it goes in Steamworks |
|---|---|---|---|
| `header_capsule.png` | 920×430 | Logo top left; Jimothy mid-stride on the Downtown plaza at golden hour, the Space Noodle behind him | Store page › Graphical assets › Header capsule |
| `small_capsule.png` | 462×174 | Mostly logo, over the Downtown sky and skyscraper | Store page › Graphical assets › Small capsule |
| `main_capsule.png` | 1232×706 | Logo top left; Jimothy large, front paw lifted, by the plaza fountain with the Space Noodle and his bronze statue behind | Store page › Graphical assets › Main capsule |
| `vertical_capsule.png` | 748×896 | Logo on top; Jimothy walking at the camera, the Space Noodle beside him, City Hall behind | Store page › Graphical assets › Vertical capsule |
| `page_background.png` | 1438×810 | The waterfront and Salmon Bay from above, blurred and darkened (no text) | Store page › Graphical assets › Page background |
| `screenshot_01.png` | 1920×1080 | Golden hour on the Downtown plaza: Jimothy strolls past his bronze statue, the Space Noodle behind | Store page › Screenshots (1st) |
| `screenshot_02.png` | 1920×1080 | Human bowling on Tumble St: STRIKE! with a 10-hit combo | Screenshots (2nd) |
| `screenshot_03.png` | 1920×1080 | The Big Roll: launched off the Hilltop Lanes roof over town ("GO!", race timer, first checkpoint ring) | Screenshots (3rd) |
| `screenshot_04.png` | 1920×1080 | Finale: the Jimothy firework over Pike's Plaice Market at night | Screenshots (4th) |
| `screenshot_05.png` | 1920×1080 | Washing cotton candy in a puddle on Jimothy Commons: "Where'd It Go?" | Screenshots (5th) |
| `screenshot_06.png` | 1920×1080 | SlopCorp campus: the real Jimothy bonks a crowd of shimmering AI fake Jimothys (Slopothys) under the slop billboard | Screenshots (6th) |
| `screenshot_07.png` | 1920×1080 | Space Jimothy mutator: a low-gravity leap off Kite Hill in his fishbowl helmet, the park and skyline behind | Screenshots (7th) |
| `screenshot_08.png` | 1920×1080 | Leading the five lost kits home in a conga line | Screenshots (8th) |
| `screenshot_09.png` | 1920×1080 | Climbing the Space Noodle's ladder, looking down on City Hall | Screenshots (9th) |
| `screenshot_10.png` | 1920×1080 | Night on Old Ballard Ave, eyes shining, after tipping a trash can | Screenshots (10th) |
| `library_capsule.png` | 600×900 | Logo on top; Jimothy walking at the camera, the Space Noodle beside him | Library assets › Library capsule |
| `library_header.png` | 920×430 | Same image as the header capsule | Library assets › Library header |
| `library_hero.png` | 3840×1240 | No text or logo: sunset on the Downtown plaza looking west to Old Ballard Ave, Jimothy centred in the 860×380 safe area; the lower left is calm plaza floor for the logo | Library assets › Library hero |
| `library_logo.png` | 1280×490 | The logo only, transparent background (place it bottom left on the hero) | Library assets › Library logo |
| `community_icon.jpg` / `.png` | 184×184 | Jimothy's face (the "O" of the logo) on a warm orange gradient | Steamworks settings › Community assets › Community icon (it takes the .jpg) |
| `client_icon.ico` / `client_icon.png` | 32×32 (.ico has 16 + 32) | Jimothy's face, transparent | Steamworks settings › Installation › Client images › Client icon (.ico) |
| `shortcut_icon.ico` / `shortcut_icon.png` | 256×256 (.ico has 16, 32, 48, 256) | Jimothy's face, transparent | Steamworks settings › Installation › Client images › Shortcut icon (.ico) |

Store page and library assets are on the app's Store page and Library assets admin pages; the icon pages' exact names in
Steamworks may differ slightly.

The screenshots show the game's normal HUD (score, combo, tracked goal, minimap, button prompts). Tutorial hints,
coach lines, near-hints, debug readouts and the camera-flash white-out are hidden.

## Re-making them

The scripts are local helpers in `tools/shots/steam/` (gitignored, so they are not in the repo). Steps:

1. Build and serve a private copy of the game:
   `npx vite build --outDir tools/_downloads/build_steam --emptyOutDir`, then
   `npx vite preview --outDir tools/_downloads/build_steam --port 5293 --strictPort --host 127.0.0.1`
   (or point `STEAM_BASE=http://127.0.0.1:5173/` at a running dev server).
2. `node tools/shots/steam/logo.mjs --size 480 --phases 0.85` renders the logo (transparent PNGs in `tools/shots/steam/logo/`).
3. `node tools/shots/steam/keyart.mjs --file tools/shots/steam/keyart_final.mjs --dpr 2 --out tools/shots/steam/renders/final`
   renders the key art. Camera and pose setups are in `keyart_final.mjs`.
4. `node tools/shots/steam/compose.mjs` builds the capsules, library images and page background into `steam/store/`.
   Layouts are in `compose_jobs.mjs`.
5. `node tools/shots/steam/icons.mjs` builds the icons and the `.ico` files.
6. `node tools/shots/steam/screens.mjs` builds the screenshots (setups in `screens_shots.mjs`). Screenshot 04 is the
   finale, which runs in real time and fires random fireworks. All its frames are kept in
   `tools/shots/steam/screens_raw/04_<ms>.png`; change `pick` if another frame looks better.
7. `node tools/shots/steam/verify.mjs` checks every size (read from the PNG headers), the alpha channels and the `.ico` entries.

Contact sheets: `node tools/shots/steam/sheet.mjs --dir steam/store --out tools/shots/steam/overview_capsules.png`
(add `--noup` to see small images at their real size).
