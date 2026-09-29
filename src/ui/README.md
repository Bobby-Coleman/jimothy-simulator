# UI (`src/ui/`)

DOM overlay inside `#ui` (pointer-events only where needed). One system, `UI` (`game.get<UI>('ui')`), registered
last in `src/systems.ts`. Styles: `styles.css` (imported by `UI.ts`). Fonts load from `public/assets/fonts/` via the
FontFace API (`boot.ts`), with system fallbacks.

| File | What |
|---|---|
| `UI.ts` | The system: modes (`title` / `intro` / `play` / `pause`), input routing, public API |
| `Hud.ts` | Score/best, combo + multiplier + draining bar, score popups, combo-end shout, toasts, objective ticker, area banner, hint line, context prompts, stamina & wash rings, camera flash, FPS/debug |
| `Speech.ts` | World-anchored speech bubbles |
| `Dialog.ts` | Quest dialogue box |
| `SlopBot.ts` | SlopBot™ popup assistant |
| `Drawer.ts` + `ObjectivesView.ts` | Tab "Instincts" panel (and the pause-menu page), with a "Suggested next" section + Track buttons |
| `Guide.ts` | Suggested Instincts, the tracked goal (top pill + world waypoint star; the big map/minimap draw it too) and the first-time onboarding coach |
| `MenuHost.ts` + `pages.ts` | Pause menu + title sub-pages (Instincts, Mutators, Settings, Controls, Credits, Reset) |
| `Title.ts` / `Intro.ts` | Title screen (orbit camera, tips) / viral-video intro cutscene |
| `Touch.ts` | Phone/tablet controls (only when `(pointer: coarse)`) |
| `PadNav.ts` | Gamepad + arrow-key menu navigation |
| `settings.ts` | Persisted settings (`localStorage['jimothy.settings.v1']`) |
| `content.ts` | Tips, disclaimer, SlopBot lines, combo shouts, area subtitles |
| `glyphs.ts` / `icons.ts` | Key/button chips per device, inline SVG icons + mascots |

## Public API — `const ui = game.get<any>('ui')`

```ts
ui.toast(title, text?, icon?)          // top-right card. icon: 'paw' 'heart' 'star' 'wand' 'trophy' 'boom' 'slop' 'secret'
                                       //   'camera' 'pin' 'bubbles' 'hand' 'lock' 'info' …, an image URL, or an emoji
ui.banner(text, sub?, kicker?)         // big banner under the top of the screen (area names use kicker 'Now entering')
ui.celebrate(word, sub?, color?)       // big centre shout like the combo-end "STRIKE!"
ui.showDialog({ speaker, lines, portrait?, onDone?, color? }): Promise<void>
                                       // typewriter; click / E / Space / Enter / pad A advance. Freezes Jimothy while open,
                                       // queues if another dialog is up. portrait: 'jimothy' | 'slopbot' | icon name | URL | emoji
                                       // (default: speaker initials). ui.dialog.open / ui.dialog.cur?.speaker / ui.dialog.close()
ui.setPrompt(text | null, ttlSecs?)    // custom context prompt, shown first in the prompt row. Tokens → key chips, e.g.
                                       //   ui.setPrompt('{grab} Give Mom the snack')
ui.hudVisible = false                  // hide all HUD (photo mode). Also respects Settings › Show HUD
ui.hint(text, secs?)                   // same as game.hint
ui.flash(0..1)                         // white screen flash
ui.speech(entityOrObject3D, text, secs?, style?)
ui.openPause(page?) / ui.resume()      // page: 'objectives' | 'mutators' | 'settings' | 'controls' | 'credits'
ui.menuOpen, ui.mode                   // 'title' | 'intro' | 'play' | 'pause'
ui.guide.current()                     // tracked goal { id, title, label, pos } | null (id 'poi:<name>' for map pins)
ui.guide.track(objectiveId) / trackPoi(poiName, label) / untrack() / suggestions (top 3)
ui.releasePointer() / ui.relock()      // free the mouse for a panel without opening the pause menu, and re-capture it
ui.respawnHome() / ui.photoFromMenu()  // pause-menu buttons: resume + press respawn / camera
ui.slopBot.show()                      // force SlopBot (testing); ui.slopBot.schedule(secs)
```

**Action tokens** (in hints, toasts' footer, `setPrompt`, tips): `{jump} {sprint} {grab} {bonk} {wash} {roll} {flop}
{chitter} {objectives} {pause} {move} {look} {slowmo} {respawn} {click}` render as keyboard keys, Xbox-style pad
buttons (when `input.usingGamepad`) or touch labels.

**Grab prompt label:** the auto prompt says "Grab <entity.name>". Set `entity.data.grabLabel = 'Steal phone'` to override.

## Events

Consumed: `scoreAdded`, `comboUp`, `comboEnd`, `objective`, `objectiveProgress`, `mutatorUnlocked`, `toast`
`{title, text?, icon?, color?, kicker?, duration?}`, `hint`, `speech`, `cameraFlash`, `chitter`, `photoMode`.

- `speech` `{ entity?, object?, position?, text, duration?, style?, speaker?, offsetY?, key? }` — anchored to
  `entity.object` (or its body, or `object`, or a fixed `position`). Styles: `'shout' | 'slop' | 'whisper' | 'jimothy'`.
  One bubble per `key` (default: the entity); hidden when behind the camera, off-screen or > 42 m away.
- `cameraFlash` `{ position? | entity? | by? }` — flashes if within 6 m of Jimothy (no position → small flash).

Emitted:

| Event | Payload | When |
|---|---|---|
| `uiState` | `{ mode }` | title / intro / play / pause changes (audio can switch music) |
| `pauseMenu` | `{ open }` | pause menu opened/closed |
| `objectivesPanel` | `{ open }` | Tab drawer toggled |
| `introStart` / `introEnd` | `{}` / `{ skipped }` | intro cutscene |
| `areaEnter` | `{ name }` | area banner shown |
| `dialogOpen` / `dialogClose` | `{ speaker }` | dialogue box |
| `slopbotShown` | `{ line }` | SlopBot pops in |
| `slopbotDismissed` | `{ reason: 'no'\|'nope'\|'close'\|'bonk' }` | player sent SlopBot away |
| `slopbotIgnored` | `{}` | SlopBot timed out (player ignored him) |
| `slopbotGenerate` | `{ line }` | player clicked "Generate…" (spawn some slop!) |
| `slopbotBonked` | `{}` | player bonked SlopBot (Bonk key or clicking him) — for "Bonk SlopBot 5×" |
| `audioVolume` | `{ master, sfx, music }` | volume settings applied (also calls `audio.setVolumes`) |
| `settingsChanged` | `{ key, settings }` | a setting changed |
| `guideTrack` | `{ id, label? }` | the tracked goal changed (Track button, map icon, completion) |
| `progressReset` | `{}` | right before the page reloads after "Reset progress" |
| `score` | via `game.score(50, 'Bonked SlopBot')` | bonking SlopBot |

UI sounds use `game.sfx`: `ui_click ui_hover ui_back ui_open ui_close ui_confirm ui_toggle ui_glitch slop_glitch slop_voice
camera_shutter whoosh boing impact_heavy jingle_win trill bonk`.

## Behaviour notes for other systems

- **Game state:** the title sets `game.state = 'title'` (unless `?skipintro`); the intro uses `'cutscene'`; pause uses
  `'paused'` and restores the previous state (`'playing'` or `'cutscene'`). The title keeps Jimothy's model synced
  (the sim is paused) and runs one tiny physics step so he stands on the ground.
- **Input:** Esc/P/Tab are read from `keydown`, gamepad Start/View from the pad directly (fast taps are never lost).
  While a dialog is open, E/Space/Enter/clicks are swallowed (they don't reach gameplay).
  D-pad ←/→ answer SlopBot (unused by the gameplay map). F4 toggles the UI debug readout (F3 = DebugStats).
- **Pointer lock:** losing the lock while playing (Esc, alt-tab) opens the pause menu; resuming re-locks. A small
  "Click to play" prompt shows when playing unlocked on desktop (never in automated browsers). The Instincts drawer
  and the big map free the mouse on purpose (so Track buttons / map icons can be clicked) and re-lock when closed with
  Tab / M / a click. Tab-switching, app-switching or window blur while playing also opens the pause menu.
- **Esc order:** big map → pause menu. Tab / photo mode / map are ignored while a dialogue is open.
- **Guide:** `Guide.ts` has the curated suggestion order (DEFS) — add an entry there for new Instincts that have a place
  to go (POI name, heart-quest id or landmark id, or a live target function). Persisted in `jimothy.guide.v1`.
- **Settings:** `flashes` is shown inverted as Accessibility › "Reduce flashing & shake" (also swallows
  `CameraRig.shake` via an instance override and the intro's camera shake); `showGuide` = Interface › "Goal tracker";
  "Look sensitivity" scales mouse, gamepad right stick and touch drag.
- **Automated browsers** (`navigator.webdriver`): no "Click to play" prompt, no random SlopBot (`?slopbot=5`) and no area banners (`?banners`).
- **Reset progress** clears every `localStorage` key starting with `jimothy.` except `jimothy.settings.v1` and
  `jimothy.quality`, then reloads — keep your saves under that prefix.
- URL params: `?skipintro`, `?debug` (UI state readout), `?slopbot=<secs>` (first SlopBot after N seconds),
  `?banners` (show area banners in automated browsers — they're suppressed there to keep test screenshots clean).

## Testing

`tools/shots/ui/uishot.mjs` (Playwright, does not force `?skipintro`) runs page scripts with `shot()`, `sleep()`,
`key()`, `click()`, `hold()` helpers — see `title.js`, `intro.js`, `menus.js`, `keys.js`, `mobile.js`, `rings.js`
next to it. `tools/shots/ui/vite.nohmr.config.mjs` starts a private dev server on :5191 without HMR so other agents'
saves don't reload the page mid-test.

UX QA scripts (local — `tools/shots/` is gitignored): `tools/shots/ux/ux.mjs` (same helpers + `tap`, `drag` (CDP touch), `blurPage`, `resize`, and
multi-phase scripts split by a `//---RELOAD---` line for persistence tests). Scripts next to it: `first5.js` (new
player: title → intro → coach → guide → drawer → map), `mobile.js` (full touch flow + HUD overlap audit, run with
`--touch --size 390x844` / `844x390`), `menus.js` (settings persistence + reset, 3 phases), `robust.js` (Esc/Tab/M/V
spam, focus loss, dialogs vs menus, resize), `guide.js` (follow the first goal), `dialogs.js`, `keys.js`; `run_all.sh` runs them all. Test against a stable
build: `npx vite build --outDir tools/_downloads/ux_build --emptyOutDir` + `npx vite preview --outDir tools/_downloads/ux_build --port 5196`.
