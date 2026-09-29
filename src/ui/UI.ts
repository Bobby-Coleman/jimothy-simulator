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
import { TitleScreen, toggleFullscreen, type TitleApi } from './Title';
import { Intro, type IntroApi } from './Intro';
import { TouchControls, type TouchApi } from './Touch';
import { ObjectivesDrawer } from './Drawer';
import { PadNav, navigate, ensureFocus, type NavKey } from './PadNav';
import { loadSettings, saveSettings, applySettings, applyAudio, type Settings } from './settings';
import { areaSubtitle, INTRO_HINTS } from './content';
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
  private tutorial: string[] = [];
  private tutorialT = 0;
  private firstFrame = true;
  private sawKeyboard = false;
  private _hudVisible = true;
  private photoMode = false;

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

    applySettings(game, this.settings, this.baseSens);
    this.hudVisible = true;

    // Photo mode (gameplay/PhotoMode.ts) owns Esc while it's active; don't also open the pause menu.
    game.events.on('photoMode', (e: { active?: boolean }) => {
      this.photoMode = !!e?.active;
      if (!this.photoMode) this.pauseIgnoreUntil = nowSec() + 0.3;
      else this.drawer.hide();
    });
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointermove', () => this.root.classList.remove('kbd-nav'), { passive: true });
    window.addEventListener('pointerdown', () => this.root.classList.remove('kbd-nav'), { passive: true });

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
    if (this.mode === 'play' && this.game.state === 'playing') this.drawer.toggle();
  }

  // ================================================================== title / intro

  startGame(playIntro: boolean) {
    if (this.mode !== 'title') return;
    this.titleMenu.close();
    this.title.hide();
    this.requestLock();
    if (IS_TOUCH && !document.fullscreenElement) toggleFullscreen();
    if (playIntro) {
      this.setMode('intro');
      this.intro.start();
    } else this.beginPlay(false);
  }

  openTitlePage(id: string) {
    this.titleMenu.open(id);
    this.sfx('ui_open');
  }

  onIntroDone(skipped: boolean) {
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
    if (tutorial) {
      this.tutorial = [...INTRO_HINTS];
      this.tutorialT = 1.0;
    }
    this.pauseIgnoreUntil = nowSec() + 0.3;
    this.blurUi();
  }

  // ================================================================== settings / progress

  commitSettings() {
    saveSettings(this.settings);
    applySettings(this.game, this.settings, this.baseSens);
    this.hudVisible = this._hudVisible;
    this.game.events.emit('settingsChanged', { ...this.settings });
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

    const inp = game.input;
    const now = nowSec();
    switch (this.mode) {
      case 'title':
        if (inp.pressed('pause') && this.titleMenu.isOpen) this.titleMenu.back();
        this.title.update(dt);
        this.titleMenu.update(dt);
        break;
      case 'intro':
        this.intro.update(dt);
        break;
      case 'pause':
        if (inp.pressed('pause') && now > this.pauseIgnoreUntil) this.pause.back();
        else if (inp.pressed('objectives')) {
          if (this.pause.page === 'objectives') this.pause.back();
          else this.pause.push('objectives');
        }
        this.pause.update(dt);
        break;
      case 'play':
        if (this.photoMode) break;
        if ((game.state === 'playing' || game.state === 'cutscene') && inp.pressed('pause') && now > this.pauseIgnoreUntil) this.openPause();
        else if (game.state === 'playing' && inp.pressed('objectives')) this.drawer.toggle();
        this.updateArea(dt);
        this.updateTutorial(dt);
        break;
    }

    const paused = game.state === 'paused';
    this.hud.update(dt);
    this.speechLayer.update(dt, paused);
    this.dialog.update(dt, paused || this.mode !== 'play');
    this.drawer.update(dt);
    const playing = this.mode === 'play' && game.state === 'playing' && !this.photoMode;
    this.slopBot.update(dt, playing && !this.dialog.open && !this.drawer.open && this._hudVisible && this.settings.showHud);
    this.touch?.setVisible(this.mode === 'play' && game.state === 'playing' && !this.dialog.open);
    this.updateLockPrompt(dt, playing);
  }

  // ================================================================== internals

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
    if (navigate(root, k)) {
      this.root.classList.add('kbd-nav');
      if (k === 'up' || k === 'down') this.sfx('ui_hover', 0.6);
    }
  }

  private handleNav(keys: NavKey[]) {
    if (!keys.length) return;
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
    // In gameplay the d-pad left/right are unused by the Input map: they answer SlopBot.
    if (this.mode === 'play') for (const k of keys) if (k === 'left' || k === 'right') this.slopBot.padInput(k);
  }

  private onKey(e: KeyboardEvent) {
    this.sawKeyboard = true;
    if (e.code === 'F4') {
      // F3 belongs to core/DebugStats; F4 toggles the UI's state/position readout.
      e.preventDefault();
      this.hud.debug = !this.hud.debug;
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
    this.hud.banner(name, areaSubtitle(name), 'Now entering');
    this.game.events.emit('areaEnter', { name });
  }

  private updateTutorial(dt: number) {
    if (!this.tutorial.length || this.game.state !== 'playing') return;
    this.tutorialT -= dt;
    if (this.tutorialT > 0) return;
    this.hud.hint(this.tutorial.shift()!, 3.3);
    this.tutorialT = 3.6;
  }

  private updateLockPrompt(dt: number, playing: boolean) {
    const want = playing && !IS_TOUCH && !AUTOMATED && !this.game.input.pointerLocked && !this.dialog.open;
    this.unlockedFor = want ? this.unlockedFor + dt : 0;
    const show = this.unlockedFor > 0.35;
    if (show !== this.lockEl.classList.contains('show')) this.lockEl.classList.toggle('show', show);
  }
}
