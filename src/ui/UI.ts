import './styles.css';
import type { Game, System } from '../core/Game';
import type { CameraRig } from '../player/CameraRig';
import type { MutatorSystem } from '../gameplay/Mutators';
import { h, AUTOMATED, IS_TOUCH, nowSec } from './dom';
import { Hud } from './Hud';
import { SpeechBubbles } from './Speech';
import { DialogBox } from './Dialog';
import { SlopBot } from './SlopBot';
import { MenuHost } from './MenuHost';
import { pausePages, titlePages, type MenuApi } from './pages';
import { TitleScreen, type TitleApi } from './Title';
import { enterFullscreen, fullscreenSupported, isFullscreen } from './fullscreen';
import { Intro, type IntroApi } from './Intro';
import { TouchControls, type TouchApi } from './Touch';
import { ObjectivesDrawer } from './Drawer';
import { PadNav, navigate, ensureFocus, type NavKey } from './PadNav';
import { loadSettings, saveSettings, applySettings, applyAudio, type Settings } from './settings';
import { areaSubtitle } from './content';
import { Guide } from './Guide';
import { installBootTips, loadFonts } from './boot';
import type { Device } from './glyphs';
import type { DialogOptions, UIMode } from './types';

export type { DialogOptions } from './types';

// Start fonts + loading-screen tips as soon as this module is imported (before systems init).
loadFonts();
installBootTips();

const INTRO_KEY = 'jimothy.introSeen';
/** Pages that are mostly text: arrow keys / d-pad scroll them instead of moving focus. */
const SCROLL_PAGES = new Set(['objectives', 'controls', 'credits']);

/**
 * The whole DOM UI: HUD, title screen, intro cutscene, pause menu, Instincts panel, dialogue box,
 * SlopBot™, speech bubbles, touch controls, pointer-lock prompt. Registered last in systems.ts as 'ui'.
 *
 * Public API (game.get<UI>('ui')): toast, banner, showDialog, setPrompt, hudVisible, hint, flash, celebrate,
 * speech, openPause, resume, menuOpen, mode. See src/ui/README.md.
 */
export class UI implements System, MenuApi, TitleApi, IntroApi, TouchApi {
  name = 'ui';
  game!: Game;
  root!: HTMLElement;
  hud!: Hud;
  speechLayer!: SpeechBubbles;
  dialog!: DialogBox;
  slopBot!: SlopBot;
  pause!: MenuHost;
  titleMenu!: MenuHost;
  title!: TitleScreen;
  intro!: Intro;
  drawer!: ObjectivesDrawer;
  /** Suggested Instincts, tracked goal (HUD pill + waypoint) and the first-time coach. */
  guide!: Guide;
  touch: TouchControls | null = null;
  settings: Settings = loadSettings();
  mode: UIMode = 'play';
  device: Device = IS_TOUCH ? 'touch' : 'kbm';
  readonly isTouch = IS_TOUCH;
  introSeen = false;

  private nav = new PadNav();
  private baseSens = 0.0024;
  private prevState: 'playing' | 'cutscene' = 'playing';
  private pauseIgnoreUntil = 0;
  private intentionalUnlock = false;
  private lockEl!: HTMLElement;
  private unlockedFor = 0;
  private area: string | null = null;
  private areaCandidate: string | null = null;
  private areaStable = 0;
  private areaPoll = 1;
  private areaShownAt = new Map<string, number>();
  private firstFrame = true;
  private sawKeyboard = false;
  private _hudVisible = true;
  private photoMode = false;
  private areaBanners = true;
  private hushOn = false;
  private hushUntil = -1;

  init(game: Game) {
    this.game = game;
    this.baseSens = game.input.mouseSensitivity;
    try {
      this.introSeen = localStorage.getItem(INTRO_KEY) === '1';
    } catch {
      /* ignore */
    }
    const host = document.getElementById('ui') ?? document.body;
    this.root = h('div', { class: 'jui' });
    if (IS_TOUCH) this.root.classList.add('is-touch');
    host.append(this.root);

    this.speechLayer = new SpeechBubbles(game, this.root);
    this.hud = new Hud(this, this.root);
    if (IS_TOUCH) this.touch = new TouchControls(this, this.root);
    this.dialog = new DialogBox(this, this.root);
    this.slopBot = new SlopBot(this, this.root);
    this.drawer = new ObjectivesDrawer(this, this.root);
    // Pill on the root (above the touch layer so it can be tapped); waypoint inside the HUD layer.
    this.guide = new Guide(this, this.hud, this.root, this.hud.el, {
      canShow: () =>
        this.mode === 'play' &&
        this.game.state === 'playing' &&
        !this.photoMode &&
        !this.dialog.open &&
        !this.drawer.open &&
        !this.mapOpen &&
        !this.hud.bannerShowing &&
        this._hudVisible &&
        this.settings.showHud,
      canCoach: () => this.mode === 'play' && this.game.state === 'playing' && !this.photoMode && !this.dialog.open,
      openPanel: () => this.toggleObjectives(),
      // final pass: the "Next up…" announcement waits for a heartfelt cutscene to end (see hush)
      hushed: () => this.hud.isHushed,
      bubbles: () => this.speechLayer.anchors,
    });
    // final pass: the top-right progress ticker skips the Instinct the goal pill is already showing
    this.hud.isPillGoal = (id) => this.guide.pillShows(id);
    this.lockEl = h('button', {
      class: 'lockprompt',
      html: `<span class="kc kc-mouse kc-mouse-l"><i></i></span><span><b>Click to play</b><small>Esc pauses · Tab shows Instincts</small></span>`,
      onclick: () => this.requestLock(),
    });
    this.root.append(this.lockEl);
    this.pause = new MenuHost(this.root, pausePages(this), 'pause-overlay');
    this.pause.onExit = () => this.resume();
    this.pause.onSound = (k) => this.sfx(k);
    this.titleMenu = new MenuHost(this.root, titlePages(this), 'title-overlay');
    this.titleMenu.onExit = () => {
      this.titleMenu.close();
      this.sfx('ui_back');
      this.title.focusDefault();
    };
    this.titleMenu.onSound = (k) => this.sfx(k);
    this.title = new TitleScreen(this, this.root);
    this.intro = new Intro(this, this.root);

    const q = new URLSearchParams(location.search);
    if (AUTOMATED && !q.has('slopbot')) this.slopBot.auto = false;
    if (q.has('slopbot')) this.slopBot.schedule(Number(q.get('slopbot')) || 5);
    if (q.has('debug')) this.hud.debug = true;
    // Area banners are cosmetic; keep other agents' automated screenshots clean unless asked for.
    this.areaBanners = !AUTOMATED || q.has('banners');

    applySettings(game, this.settings, this.baseSens);
    this.hudVisible = true;
    this.root.classList.toggle('calm', !this.settings.flashes);

    // Photo mode (gameplay/PhotoMode.ts) owns Esc while it's active; don't also open the pause menu.
    game.events.on('photoMode', (e: { active?: boolean }) => {
      this.photoMode = !!e?.active;
      if (!this.photoMode) this.pauseIgnoreUntil = nowSec() + 0.3;
      else this.drawer.hide();
      this.root.classList.toggle('photo', this.photoMode);
    });
    // Switching tabs / apps or alt-tabbing pauses (pointer-lock loss already does on desktop; this covers touch,
    // gamepad and unlocked play). Photo mode keeps its own state (saving a photo can blur the window).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause();
    });
    window.addEventListener('blur', () => this.autoPause());
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    // Capture phase: runs before core/Input's window listener, so keys the UI consumes (dialog advance) never
    // reach gameplay. Esc/P/Tab are read here (not via input.pressed) so fast taps aren't lost between frames.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    window.addEventListener('pointerdown', (e) => this.onPointerDown(e), true);
    window.addEventListener('pointermove', () => this.root.classList.remove('kbd-nav'), { passive: true });

    if (!q.has('skipintro')) {
      this.setMode('title');
      this.title.show();
    } else this.setMode('play');
  }

  // ================================================================== public API

  /** Big announcement card (top-right). `icon`: icon name (paw, heart, star, wand, trophy…), image URL or emoji. */
  toast(title: string, text?: string, icon?: string) {
    this.game.events.emit('toast', { title, text, icon });
  }

  /** Big centered-top banner (area names, proclamations). */
  banner(text: string, sub?: string, kicker = '') {
    this.hud.banner(text, sub, kicker);
  }

  /** Quest dialogue: typewriter lines, advance with click / E / Space / A. Freezes Jimothy while open. */
  showDialog(opts: DialogOptions): Promise<void> {
    return this.dialog.show(opts);
  }

  /** Custom context prompt, e.g. setPrompt('{grab} Give Mom the snack'). null clears. Optional auto-clear seconds. */
  setPrompt(text: string | null, ttl?: number) {
    this.hud.setPrompt(text, ttl);
  }

  /** Hide/show every HUD element (photo mode). Menus still work. Also respects Settings › Show HUD. */
  get hudVisible() {
    return this._hudVisible;
  }
  set hudVisible(v: boolean) {
    this._hudVisible = v;
    this.root?.classList.toggle('hud-off', !(v && this.settings.showHud));
  }

  hint(text: string, duration = 2.5) {
    this.game.hint(text, duration);
  }

  /** White screen flash (0..1). */
  flash(strength = 0.3) {
    this.hud.flash(strength);
  }

  /** Big center shout, like the combo-end "STRIKE!". */
  celebrate(word: string, sub?: string, color?: string) {
    this.hud.celebrate(word, sub, color);
  }

  /**
   * Final pass: hold HUD notifications (toasts, score popups, combo shouts, progress ticker, the guide's "Next up"
   * hint) and replay them afterwards, so they don't trample a heartfelt moment. Automatic while
   * game.state === 'cutscene' (heart-quest close-ups via HeartCtx.cutscene, the finale). `hush(secs)` also holds
   * them for `secs` of game time — for moments whose rewards land just *before* the camera cuts in (Mom's 3rd snack
   * completes "Mama's Boy" 0.7 s before her grooming close-up). `hush(true)` holds until `hush(false)`.
   */
  hush(on: boolean | number) {
    if (on === true) this.hushOn = true;
    else if (on === false) {
      this.hushOn = false;
      this.hushUntil = -1;
    } else if (on > 0) this.hushUntil = Math.max(this.hushUntil, this.game.time + on);
    this.syncHush();
  }

  private syncHush() {
    const st = this.game.state;
    if (st === 'paused') return; // pausing mid-cutscene must not flush the held notifications behind the menu
    this.hud.setHushed(this.hushOn || this.game.time < this.hushUntil || st === 'cutscene');
  }

  /** Speech bubble above an entity / Object3D / position. */
  speech(entity: unknown, text: string, duration?: number, style?: string) {
    this.game.events.emit('speech', { entity, text, duration, style });
  }

  /** True while a full-screen menu (title / pause) is up. */
  get menuOpen() {
    return this.mode === 'title' || this.mode === 'pause' || this.titleMenu.isOpen;
  }

  sfx(key: string, volume?: number, pitch?: number) {
    this.game.sfx(key, undefined, volume, pitch);
  }

  // ================================================================== pause / resume

  openPause(page?: string) {
    const g = this.game;
    if (this.mode !== 'play' || (g.state !== 'playing' && g.state !== 'cutscene')) return;
    this.prevState = g.state === 'cutscene' ? 'cutscene' : 'playing';
    this.closeMap();
    g.state = 'paused';
    this.setMode('pause');
    this.drawer.hide();
    this.pauseIgnoreUntil = nowSec() + 0.25;
    if (document.pointerLockElement) {
      this.intentionalUnlock = true;
      g.input.exitPointerLock();
    }
    this.pause.open('pause');
    if (page) this.pause.push(page);
    this.sfx('ui_open');
    g.events.emit('pauseMenu', { open: true });
  }

  /** Pause-menu "Back to the den" (same as H): resume, then press the respawn action for a moment. */
  respawnHome() {
    this.resume();
    this.game.input.tap('respawn', 150);
  }

  /** Pause-menu "Photo mode" (same as V / the touch camera button). */
  photoFromMenu() {
    this.resume();
    this.game.input.tap('camera', 150);
  }

  /** Free the mouse for a UI panel (Instincts drawer, big map) without opening the pause menu. */
  releasePointer(): boolean {
    if (!document.pointerLockElement) return false;
    this.intentionalUnlock = true;
    this.game.input.exitPointerLock();
    return true;
  }

  /** Re-capture the mouse after such a panel closes (needs a user gesture; harmless if the browser refuses). */
  relock() {
    if (this.mode === 'play' && this.game.state === 'playing' && !this.photoMode) this.requestLock();
  }

  /** The big map (gameplay/MapSystem) is open. */
  get mapOpen(): boolean {
    return !!this.game.get<any>('map')?.bigOpen;
  }

  private closeMap() {
    const map = this.game.get<any>('map');
    if (map?.bigOpen) map.toggleBig();
  }

  /** Focus lost / tab hidden while playing: open the pause menu. */
  private autoPause() {
    if (this.mode === 'play' && !this.photoMode && (this.game.state === 'playing' || this.game.state === 'cutscene')) this.openPause();
  }

  resume() {
    if (this.mode !== 'pause') return;
    this.pause.close();
    this.game.state = this.prevState;
    this.setMode('play');
    this.blurUi();
    this.requestLock();
    this.pauseIgnoreUntil = nowSec() + 0.2;
    this.sfx('ui_close');
    this.game.events.emit('pauseMenu', { open: false });
  }

  toggleObjectives() {
    if (this.mode !== 'play' || this.game.state !== 'playing' || this.photoMode || (this.dialog.open && !this.drawer.open)) return;
    this.closeMap();
    this.drawer.toggle();
  }

  // ================================================================== title / intro

  startGame(playIntro: boolean) {
    if (this.mode !== 'title') return;
    this.titleMenu.close();
    this.title.hide();
    this.requestLock();
    if (IS_TOUCH && fullscreenSupported() && !isFullscreen()) void enterFullscreen();
    if (playIntro) {
      this.setMode('intro');
      this.intro.start();
    } else this.beginPlay(false);
  }

  openTitlePage(id: string) {
    this.titleMenu.open(id);
    this.sfx('ui_open');
  }

  /** IntroApi: the first suggested goal, so the intro's final camera sweep looks that way. */
  introGoal() {
    this.guide.resolve();
    return this.guide.current()?.pos ?? null;
  }

  onIntroDone(_skipped: boolean) {
    const first = !this.introSeen;
    this.introSeen = true;
    try {
      localStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* ignore */
    }
    this.beginPlay(first);
  }

  private beginPlay(tutorial: boolean) {
    const g = this.game;
    const rig = g.get<CameraRig>('camera');
    const p = g.get<any>('player');
    if (this.mode === 'title' && rig) {
      rig.override = null;
      if (p) rig.snapBehind(p.facing);
      g.camera.fov = rig.baseFov;
      g.camera.updateProjectionMatrix();
    }
    g.state = 'playing';
    if (p) p.frozen = false;
    this.setMode('play');
    this.area = null;
    this.areaCandidate = null;
    this.areaPoll = 0.8;
    // First time: contextual control hints, then a nudge toward the first suggested Instinct (ui/Guide.ts).
    // Returning players just get a reminder of what's tracked.
    if (tutorial) this.guide.startCoach();
    else this.guide.announceSoon(2.5);
    this.pauseIgnoreUntil = nowSec() + 0.3;
    this.blurUi();
  }

  // ================================================================== settings / progress

  /** Persist settings and apply the one that changed. */
  commitSettings(key: keyof Settings) {
    saveSettings(this.settings);
    applySettings(this.game, this.settings, this.baseSens, key);
    this.hudVisible = this._hudVisible;
    this.root.classList.toggle('calm', !this.settings.flashes);
    this.game.events.emit('settingsChanged', { key, settings: { ...this.settings } });
  }

  /** Forget objectives, mutators, best score, quest/collectible progress (every `jimothy.*` key except settings/quality). */
  resetProgress() {
    const muts = this.game.get<MutatorSystem>('mutators');
    try {
      if (muts) for (const m of muts.list) if (m.enabled) muts.setEnabled(m.id, false);
      this.game.get<any>('objectives')?.resetAll?.();
    } catch (err) {
      console.warn('[ui] reset: could not reset systems cleanly', err);
    }
    try {
      const keep = new Set(['jimothy.settings.v1', 'jimothy.quality']);
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('jimothy.') && !keep.has(k)) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    this.game.events.emit('progressReset', {});
    location.reload();
  }

  // ================================================================== frame

  lateUpdate(dt: number, game: Game) {
    // Camera moved this frame (rig lateUpdate ran before us): refresh its matrices so projections don't lag.
    game.camera.updateMatrixWorld();
    if (this.firstFrame) {
      this.firstFrame = false;
      applyAudio(game, this.settings);
    }
    this.updateDevice();
    if (this.root.dataset.state !== game.state) this.root.dataset.state = game.state;

    this.handleNav(this.nav.poll(dt));

    switch (this.mode) {
      case 'title':
        this.title.update(dt);
        this.titleMenu.update(dt);
        break;
      case 'intro':
        this.intro.update(dt);
        break;
      case 'pause':
        this.pause.update(dt);
        break;
      case 'play':
        if (this.photoMode) break;
        this.updateArea(dt);
        break;
    }

    const paused = game.state === 'paused';
    this.syncHush();
    this.hud.update(dt);
    this.speechLayer.update(dt, paused);
    this.dialog.update(dt, paused || this.mode !== 'play');
    this.drawer.update(dt);
    this.guide.update(dt);
    const mapOpen = this.mapOpen;
    if (mapOpen !== this.root.classList.contains('map-open')) this.root.classList.toggle('map-open', mapOpen);
    const playing = this.mode === 'play' && game.state === 'playing' && !this.photoMode;
    this.slopBot.update(dt, playing && !this.dialog.open && !this.drawer.open && this._hudVisible && this.settings.showHud);
    // In photo mode only the look-drag area stays (CSS .jui.photo) so touch players can orbit the camera.
    this.touch?.setVisible(this.mode === 'play' && game.state === 'playing' && !this.dialog.open && !this.mapOpen);
    this.updateLockPrompt(dt, playing);
  }

  // ================================================================== internals

  /** A dialogue is up and taking input (not behind the pause menu). */
  private get dialogLive() {
    const st = this.game.state;
    return this.mode === 'play' && this.dialog.open && (st === 'playing' || st === 'cutscene');
  }

  private setMode(m: UIMode) {
    this.mode = m;
    this.root.dataset.mode = m;
    if (m !== 'play') this.drawer?.hide();
    this.game.events.emit('uiState', { mode: m });
  }

  private requestLock() {
    if (!IS_TOUCH) this.game.input.requestPointerLock();
  }

  private blurUi() {
    const a = document.activeElement as HTMLElement | null;
    if (a && this.root.contains(a)) a.blur();
  }

  private updateDevice() {
    const inp = this.game.input;
    const dev: Device = inp.usingGamepad ? 'pad' : IS_TOUCH && !this.sawKeyboard ? 'touch' : 'kbm';
    if (dev !== this.device) {
      this.device = dev;
      this.root.dataset.device = dev;
      this.slopBot.refreshGlyphs();
    } else if (this.root.dataset.device !== dev) this.root.dataset.device = dev;
  }

  private onLockChange() {
    const locked = !!document.pointerLockElement;
    if (locked) {
      this.intentionalUnlock = false;
      return;
    }
    if (this.intentionalUnlock) {
      this.intentionalUnlock = false;
      return;
    }
    // The browser released the lock (Esc, alt-tab…): open the pause menu / skip the intro.
    // (Ignored right after a skip/resume so one Esc press can't both skip the intro and pause.)
    if (nowSec() < this.pauseIgnoreUntil) return;
    if (this.mode === 'intro') this.intro.skip();
    else if (this.mode === 'play' && !this.photoMode && (this.game.state === 'playing' || this.game.state === 'cutscene')) {
      this.openPause();
      this.pauseIgnoreUntil = nowSec() + 0.35;
    }
  }

  private activeMenuRoot(): HTMLElement | null {
    if (this.mode === 'pause') return this.pause.navRoot;
    if (this.mode === 'title') return this.titleMenu.isOpen ? this.titleMenu.navRoot : this.title.el;
    return null;
  }

  private activeHost(): MenuHost | null {
    if (this.mode === 'pause') return this.pause;
    if (this.mode === 'title' && this.titleMenu.isOpen) return this.titleMenu;
    return null;
  }

  private moveFocus(root: HTMLElement, k: NavKey) {
    const host = this.activeHost();
    if (host && (k === 'up' || k === 'down') && SCROLL_PAGES.has(host.page ?? '')) {
      host.scrollBy(k === 'down' ? 90 : -90);
      return;
    }
    // Instincts page: ←/→ (D-pad / arrows) hop between the "Suggested next" Track buttons; A / Enter presses.
    if (host?.page === 'objectives' && (k === 'left' || k === 'right')) {
      const tracks = [...root.querySelectorAll<HTMLElement>('.sugg-track')];
      if (tracks.length) {
        const i = tracks.indexOf(document.activeElement as HTMLElement);
        const next = i < 0 ? tracks[0] : tracks[(i + (k === 'right' ? 1 : -1) + tracks.length) % tracks.length];
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
        this.root.classList.add('kbd-nav');
        this.sfx('ui_hover', 0.6);
      }
      return;
    }
    if (navigate(root, k)) {
      this.root.classList.add('kbd-nav');
      if (k === 'up' || k === 'down') this.sfx('ui_hover', 0.6);
    }
  }

  /**
   * "Pause" command (Esc / P / gamepad Start). `fromPad`: Start resumes straight from any pause page,
   * while Esc steps back one page.
   */
  private cmdPause(fromPad: boolean) {
    const g = this.game;
    const now = nowSec();
    switch (this.mode) {
      case 'title':
        if (this.titleMenu.isOpen) this.titleMenu.back();
        else if (fromPad) this.startGame(!this.introSeen);
        break;
      case 'intro':
        this.intro.skip();
        break;
      case 'pause':
        if (now < this.pauseIgnoreUntil) break;
        if (fromPad) this.resume();
        else this.pause.back();
        break;
      case 'play':
        if (this.photoMode || now < this.pauseIgnoreUntil) break;
        // Esc closes the big map first (it sits above the whole UI), then pauses. (The Instincts drawer simply
        // hides behind the pause menu.)
        if (this.mapOpen) {
          this.closeMap();
          break;
        }
        if (g.state === 'playing' || g.state === 'cutscene') this.openPause();
        break;
    }
  }

  /** "Objectives" command (Tab / gamepad View). */
  private cmdObjectives() {
    if (this.mode === 'play') this.toggleObjectives();
    else if (this.mode === 'pause') {
      if (this.pause.page === 'objectives') this.pause.back();
      else this.pause.push('objectives');
    }
  }

  private handleNav(keys: NavKey[]) {
    if (!keys.length) return;
    for (const k of keys) {
      if (k === 'start') this.cmdPause(true);
      else if (k === 'back') this.cmdObjectives();
    }
    const root = this.activeMenuRoot();
    if (root) {
      for (const k of keys) {
        if (k === 'up' || k === 'down' || k === 'left' || k === 'right') this.moveFocus(root, k);
        else if (k === 'a') {
          const a = document.activeElement as HTMLElement | null;
          if (a && root.contains(a) && a !== document.body) a.click();
          else ensureFocus(root);
          this.root.classList.add('kbd-nav');
        } else if (k === 'b') {
          if (this.mode === 'pause') this.pause.back();
          else if (this.titleMenu.isOpen) this.titleMenu.back();
        }
      }
      return;
    }
    if (this.mode !== 'play') return;
    for (const k of keys) {
      // A advances dialogue (the frozen player ignores the matching 'jump' press).
      if (k === 'a' && this.dialogLive) this.dialog.input();
      // D-pad left/right are unused by the gameplay Input map: they answer SlopBot.
      else if (k === 'dleft' || k === 'dright') this.slopBot.padInput(k === 'dleft' ? 'left' : 'right');
    }
  }

  private onKey(e: KeyboardEvent) {
    this.sawKeyboard = true;
    if (e.code === 'F4') {
      // F3 belongs to core/DebugStats; F4 toggles the UI's state/position readout.
      e.preventDefault();
      this.hud.debug = !this.hud.debug;
      return;
    }
    if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyP')) {
      this.cmdPause(false);
      return; // not consumed: PhotoMode reads Esc through input.pressed('pause')
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      if (!e.repeat) this.cmdObjectives();
      return; // not consumed: Collectibles shows its compass while Tab is held
    }
    // Dialogue: E / Space / Enter advance, and are swallowed so they don't also grab/jump in gameplay.
    if (this.dialogLive && (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.dialog.input();
      return;
    }
    const root = this.activeMenuRoot();
    if (!root) return;
    const map: Record<string, NavKey> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const k = map[e.code];
    if (!k) return;
    const active = document.activeElement;
    if ((k === 'left' || k === 'right') && active instanceof HTMLInputElement && active.type === 'range') {
      this.root.classList.add('kbd-nav');
      return; // native slider keys
    }
    e.preventDefault();
    this.moveFocus(root, k);
  }

  /** Clicks/taps advance an open dialogue (and are swallowed so they don't also grab in gameplay). */
  private onPointerDown(e: PointerEvent) {
    this.root.classList.remove('kbd-nav');
    if (!this.dialogLive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); // also suppresses the compatibility mousedown the Input would read as 'grab'
    e.stopPropagation();
    this.dialog.input();
  }

  private updateArea(dt: number) {
    if (this.game.state !== 'playing') return;
    this.areaPoll -= dt;
    if (this.areaPoll > 0) return;
    this.areaPoll = 0.5;
    const p = this.game.get<any>('player');
    const world = this.game.get<any>('world');
    if (!p?.position || !world?.areaAt) return;
    const name = (world.areaAt(p.position.x, p.position.z) as string | null) ?? null;
    if (name !== this.areaCandidate) {
      this.areaCandidate = name;
      this.areaStable = 0;
      return;
    }
    this.areaStable += 0.5;
    if (!name || name === this.area || this.areaStable < 0.5) return;
    this.area = name;
    const now = nowSec();
    if (now - (this.areaShownAt.get(name) ?? -1e9) < 25) return;
    this.areaShownAt.set(name, now);
    if (this.areaBanners) this.hud.banner(name, areaSubtitle(name), 'Now entering');
    this.game.events.emit('areaEnter', { name });
  }

  private updateLockPrompt(dt: number, playing: boolean) {
    // Not while a panel freed the mouse on purpose (Instincts drawer, big map).
    const want = playing && !IS_TOUCH && !AUTOMATED && this.device !== 'pad' && !this.game.input.pointerLocked && !this.dialog.open && !this.drawer.open && !this.mapOpen;
    this.unlockedFor = want ? this.unlockedFor + dt : 0;
    const show = this.unlockedFor > 0.35;
    if (show !== this.lockEl.classList.contains('show')) this.lockEl.classList.toggle('show', show);
  }
}
