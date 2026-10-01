# Jimothy Simulator: Windows desktop / Steam build

The web game (repo root, Vite + Three.js + Rapier) wrapped in **Electron 44** for Steam, with **Steamworks** through
[steamworks.js](https://github.com/ceifa/steamworks.js). Everything desktop-specific lives in this folder, with its own
`package.json` and `node_modules`: the root `npm ci && npm run build` (GitHub Pages CI) never installs Electron.

```
desktop/
  electron/main.cjs        main process: window, app:// protocol, IPC, Steam, saves, photo downloads
  electron/preload.cjs     window.jimothyDesktop bridge (sandboxed, context-isolated)
  electron/protocol.cjs    app://jimothy/ static file server (MIME types, Range requests, CSP)
  electron/steam.cjs       steamworks.js wrapper; everything optional
  electron/saves.cjs       save mirror for Steam Cloud (one JSON file)
  electron/log.cjs         %APPDATA%\Jimothy Simulator\logs\desktop.log
  achievements.json        Instinct (objective) id -> Steam achievement (generated, committed)
  steam_appid.txt          the Steam App ID (480 = Valve's test app "Spacewar" until the real one exists)
  steam/app_build.vdf      SteamPipe app build script (template)
  steam/depot_build.vdf    SteamPipe depot build script (template)
  scripts/                 build-web, make-icons (+ rasterize.cjs), package, gen-achievements, test-desktop
  app/      (generated)    the Vite build of the game
  build/    (generated)    icon.ico / icon.png
  dist/     (generated)    win-unpacked/ = the Steam content root; build-info.json
```

## Build

Needs Node 24 (same as CI) on Windows.

```bat
npm ci                 :: in the repo root (Vite, three.js, ... and playwright-core for the tests)
cd desktop
npm ci                 :: Electron, @electron/packager, @electron/fuses, steamworks.js
npm run build:steam    :: build:web + icons + package
```

Result: **`desktop/dist/win-unpacked/Jimothy Simulator.exe`**, an unpacked Windows x64 folder (no installer: Steam
installs the folder). Electron's runtime is downloaded on first use and cached in `%LOCALAPPDATA%\electron\Cache`.

| Step | Script | What it does |
|---|---|---|
| `npm run build:web` | scripts/build-web.mjs | `vite build --outDir desktop/app --base ./` from the repo root (same config as the Pages build). |
| `npm run icons` | scripts/make-icons.mjs | `build/icon.ico` from `steam/store/shortcut_icon.ico`, else `steam/store/shortcut_icon.png`, else a **placeholder** made from `public/favicon.svg`. |
| `npm run package` | scripts/package.mjs | @electron/packager → `dist/win-unpacked`; app.asar (only `electron/`, `app/`, the icon, `achievements.json`, `steam_appid.txt`, steamworks.js' Windows binaries); drops non-English Chromium locales; writes `LICENSES/`; flips Electron fuses. |
| `npm run achievements` | scripts/gen-achievements.mjs | Regenerates `achievements.json` (see below). |

Size: about **400 MB** on disk in 25 files (the Electron runtime is ~320 MB of it, `resources/app.asar` 78 MB),
**~170 MB compressed**, which is roughly what Steam downloads.

Bump `"version"` in `desktop/package.json` for each release (it goes into the exe's file version and the save file).
The exe's "Company" field is a placeholder (`win32metadata` in scripts/package.mjs): set the developer name there.

## Run and test locally

```bat
npm start                 :: Electron on desktop/app (run build:web first; `npm run dev` does both)
npm start -- --dev-server=http://127.0.0.1:5173   :: Electron on the Vite dev server, with HMR
npm test                  :: end-to-end test of the packaged exe   (screenshots: tools/shots/desktop/packaged)
npm run test:dev          :: same against the unpackaged shell, plus F11 / Alt+Enter (tools/shots/desktop/dev)
```

The tests (scripts/test-desktop.mjs) use a throwaway profile (`--user-data-dir`), mute audio, and drive the game over
the Chrome DevTools Protocol with playwright-core from the repo root. They set `JIMOTHY_TEST=1`, the shell's test mode:
the window is fully transparent, click-through, never focused and has no taskbar button, and fullscreen is simulated
(state and events only), so a run never takes over the screen (screenshots still capture the page, 1280×720).
`--phases D` (etc.) runs single launches. They launch the game three times and check: title
screen, fullscreen by default, music playing without a click, Rapier/WASM, CSP, Steam status, Play → intro → walking,
frame rate, memory/CPU, the achievement bridge, every Instinct mapped to an achievement, photo saving, pause menu Quit,
save file, persistence across restarts (including a save file arriving from Steam Cloud), the Fullscreen button,
remembered window mode, running without Steam, blocked navigation, Reset progress, Alt+F4-style close, and that no
process is left (`--dev` adds F11 / Alt+Enter and minimise). One test photo is saved to `Pictures\Jimothy Simulator`
and deleted again. Real fullscreen (borderless, covering the monitor) was verified by hand-run tests before the test
mode existed; after changing window code, check it once by running the game normally.

Command-line switches (also usable as Steam launch options):

| Switch | Effect |
|---|---|
| `--windowed` | start in a window (F11 / Alt+Enter / the menus' Fullscreen button toggle; the choice is remembered) |
| `--no-steam` | don't initialise Steam at all |
| `--no-steam-overlay` | Steam API on, but without the overlay's GPU switches (`--in-process-gpu`, `--disable-direct-composition`) |
| `--user-data-dir=<dir>` | use another profile folder (tests) |
| `--dev-server=<url>` | unpackaged only: load the Vite dev server instead of `desktop/app` |

Chromium switches work too (`--mute-audio`, `--disable-gpu`, `--use-angle=gl`, …). DevTools are only available in
the unpackaged shell (Ctrl+Shift+I / F12).

## How the shell works

* **app://jimothy/**: `desktop/app` is served through a privileged `standard`/`secure` scheme (fetch, CORS, streaming,
  V8 code cache), not `file://`, so module scripts, the audio worker, FontFace, `<audio>` Range requests, WebAssembly
  and localStorage behave exactly as on the web. Responses carry a strict Content-Security-Policy (own files only;
  `'wasm-unsafe-eval'` for Rapier).
* **Window**: borderless fullscreen by default (remembered, like the windowed size/position), title
  "Jimothy Simulator", no menu, background throttling off, display kept awake while focused (gamepad play),
  autoplay allowed, discrete GPU preferred, Windows media keys/overlay disabled for the game's music.
* **Bridge**: `electron/preload.cjs` exposes `window.jimothyDesktop` (quit, fullscreen, external links, notices,
  achievements). The game detects the desktop build only through it (`src/platform/desktop.ts`), so the web build is
  unchanged: no Quit buttons, web Fullscreen API.
* **Game-side changes** (all inert in a browser): `src/platform/desktop.ts` (bridge types + the `desktop` system:
  Instinct → achievement, achievement catch-up, title music without a click, "Photo saved" notices),
  `src/systems.ts` (registers it), `src/ui/fullscreen.ts` (window fullscreen through the bridge),
  `src/ui/Title.ts` (Quit on the title screen), `src/ui/pages.ts` (Quit game in the pause menu).
* **Links** (credits, music player) open in the default browser (on Steam Deck: the Steam overlay browser); the game
  window can't navigate away or open windows.
* **Photo mode** "Save photo" goes straight to `Pictures\Jimothy Simulator\` (no dialog); the card says "Saved ✓".
* **Hardening**: context isolation + sandboxed renderer, no Node in the page, IPC only accepted from the game page,
  permissions limited to pointer lock / fullscreen / keyboard lock / clipboard write, single instance, Electron fuses
  (no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, app only loads from `app.asar`).
* **Crashes**: a crashed renderer is reloaded (twice, then an error box). Renderer errors/warnings, GPU info and
  Steam status go to `%APPDATA%\Jimothy Simulator\logs\desktop.log` (previous run: `desktop.old.log`): ask players for it.

## Steam App ID

**One-line change:** put the real App ID in `desktop/steam_appid.txt` (now `480`), then `npm run build:steam`. The ID
is packed inside app.asar and passed to `SteamAPI_Init`, so no loose `steam_appid.txt` ships next to the exe (keep it
that way: Valve recommends against shipping one, it disables `SteamAPI_RestartAppIfNecessary`).

* Under 480 the Steam API, overlay hook and stats work, but our achievements don't exist there, so unlocks return
  false (logged once each). Steam shows you as "playing Spacewar" while the game runs.
* Without Steam (not running / not owned / steamworks fails to load) the game runs normally without achievements.
* Optional, release only: set `RESTART_THROUGH_STEAM = true` in `electron/main.cjs` to make an exe started outside
  Steam relaunch through Steam (`SteamAPI_RestartAppIfNecessary`; never for 480). It's off so the exe also runs
  without Steam.

## Achievements

`achievements.json` maps every Instinct to a Steam achievement (59 now). Generate it with `npm run achievements`:
it reads `src/gameplay/content/objectiveDefs.ts` plus Instincts that systems register themselves
(`addObjective(game, {...})` in src/gameplay/chaos), and adds fallback ids (`crow_deals`, `touch_grass`, …) as
`aliases`. Regenerating keeps existing `apiName`s and `enabled` flags and refreshes names/descriptions; Instincts that
were removed stay in the file with `"enabled": false`. `npm run achievements -- --check` fails if one is missing.
`npm test` also checks that every Instinct the running game registers has a mapping.

Entry: `{ objective, apiName: "JIMOTHY_<ID>", displayName, description, hidden, category, enabled, aliases }`.

In Steamworks (**App Admin > Stats & Achievements > Achievements**), per entry: *API Name* = `apiName`,
*Display Name* = `displayName`, *Description* = `description`, *Hidden* = `hidden` (the 6 secret Instincts), *Set by*
= Client, plus two 64×64 icons (achieved / unachieved). Then **Publish** (App Admin > Publish). Never rename a
published API name.

How unlocking works: the game emits `objective` → `src/platform/desktop.ts` → `objective:completed` IPC →
`electron/main.cjs` looks the id up → steamworks.js `achievement.activate()` (SetAchievement + StoreStats). A few
seconds after boot the game also sends all completed Instincts, so achievements earned while Steam wasn't running
(or before the real App ID) unlock later. Game code can also unlock one directly with
`window.jimothyDesktop.steam.unlockAchievement(apiName)` (resolves true/false). To retest unlocks on your own account,
the Steam client console (`steam://open/console`) has `achievement_clear <appid> <API_NAME>` and
`reset_all_stats <appid>`.

## Saves and Steam Cloud

Progress and settings are the game's own `localStorage` keys (`jimothy.*`), stored by Chromium under the profile:

```
%APPDATA%\Jimothy Simulator\            (userData)
  Local Storage\leveldb\                Chromium's localStorage (LevelDB) — not for cloud sync
  save\jimothy-save.json                the save mirror below — sync THIS
  logs\desktop.log, window-state.json, Chromium caches
```

A LevelDB folder syncs badly, so the shell mirrors every `jimothy.*` key into one small file,
`save\jimothy-save.json`: written atomically whenever the keys change (checked every 4 s) and when the game quits or
the window closes. On the first page load of a run the file, if present, replaces the `jimothy.*` keys, so a save
that Steam Cloud downloaded from another PC wins. (In-game "Reset progress" is mirrored too.)

**Steamworks > App Admin > Steam Cloud** (Auto-Cloud, no code needed):

* Byte quota per user: 1 MB (the file is a few KB); number of files per user: 5.
* Root path: Root **`WinAppDataRoaming`**, Subdirectory **`Jimothy Simulator/save`**, Pattern **`jimothy-save.json`**,
  OS **Windows**, not recursive.
* Steam Deck / Proton runs the Windows build, so the same Windows root applies (the file lives in the Proton prefix).
  A future native Linux build would need a root override for its own path (`~/.config/Jimothy Simulator/save`).

## Steamworks settings checklist

* **Installation > General**: install folder `Jimothy Simulator`; launch option: executable **`Jimothy Simulator.exe`**,
  launch type *Launch (Default)*, OS **Windows**, CPU architecture **64-bit only**, no arguments. Optional second
  launch option "Windowed" with arguments `--windowed`.
* **SteamPipe > Depots**: one depot, OS Windows, 64-bit, all languages. Put its ID in the VDFs.
* **Steam Cloud**: as above. **Achievements**: as above.
* **Steam Input**: the game reads controllers through the browser Gamepad API (XInput layout). Opting in to Steam
  Input for PlayStation / Switch / generic pads (default config "Gamepad") makes them all look like an Xbox pad.
* **Steam Overlay**: works when the game is started by Steam (Shift+Tab, achievement toasts, F12 screenshots); the
  shell enables steamworks.js' Electron overlay hook when the Steam API initialised. To try it before the real App ID
  exists: add `Jimothy Simulator.exe` to Steam as a non-Steam game and launch it from Steam.
* System requirements / store text: see `steam/LAUNCH.md`.

## Uploading (SteamPipe)

1. Get steamcmd (Steamworks SDK: `tools\ContentBuilder\builder\steamcmd.exe`, or Valve's standalone download).
2. In `desktop/steam/app_build.vdf` replace `APP_ID` and `DEPOT_ID`; in `depot_build.vdf` replace `DEPOT_ID`.
3. `npm run build:steam` and `npm test`.
4. Upload (you log in yourself; the password and Steam Guard code are typed interactively — never store credentials
   in this repo, scripts or CI):

   ```bat
   steamcmd +login <your_steam_username> +run_app_build "%CD%\steam\app_build.vdf" +quit
   ```

   Content root: `desktop/dist/win-unpacked`; logs: `desktop/dist/steampipe-output`. `"Preview" "1"` does a dry run.
5. `"SetLive"` is empty on purpose: in Steamworks (**SteamPipe > Builds**) set the new build live on a password beta
   branch first, install it through Steam and test (achievements, overlay, cloud), then set it live on `default`.

The uploading account needs the app's "Edit App Metadata" and "Publish App Changes To Steam" permissions.

## Steam Deck / Proton (not tested yet)

* The Windows build runs through Proton (try Proton Experimental first). Things to check: the game window appears
  (not black), 1280×800 layout and text size, controls through Steam Input, the Steam keyboard is never needed,
  Quit returns to Game Mode, saves sync.
* If the window stays black or blank under Proton, try launch options one at a time: `--no-sandbox`,
  `--disable-gpu-sandbox`, `--use-angle=vulkan`, `--disable-gpu` (software rendering, slow). Report what works in
  `desktop.log` terms (GPU line).
* The game shows touch controls when Chromium reports a coarse primary pointer (`src/ui/dom.ts` `IS_TOUCH`); check
  that the Deck's touchscreen doesn't switch the HUD to touch mode while a gamepad is used.
* External links open in the Steam overlay browser on the Deck (`isSteamRunningOnSteamDeck`).
* A native Linux build later is possible (Electron and steamworks.js support linux-x64): package with
  `platform: 'linux'`, add a Linux depot and a Cloud root override.

## Licenses

`dist/win-unpacked/LICENSES/` ships with the game: `third_party_notices.txt` (three.js MIT, Rapier Apache-2.0,
postprocessing Zlib, Vite/Rolldown runtime helpers MIT, steamworks.js MIT, the Steamworks API redistributable),
`Electron-LICENSE.txt` and `Chromium-LICENSES.html` (Electron's own), the font licenses (`fonts/`: Luckiest Guy
Apache-2.0, Lilita One and Nunito SIL OFL) and `CREDITS.md` (every model, texture, sound and music source; CC0).
Regenerated by `npm run package`. Add any new runtime dependency there (scripts/package.mjs `notices`).
