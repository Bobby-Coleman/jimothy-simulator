'use strict';
// Jimothy Simulator — Electron main process (Windows desktop / Steam build).
//
// Serves the Vite build of the web game (desktop/app) from app://jimothy/, starts borderless fullscreen, wires up
// Steamworks (steamworks.js; optional) and exposes a tiny bridge to the game through electron/preload.cjs.
// Command-line switches (handy for testing): --windowed, --no-steam, --no-steam-overlay, --user-data-dir=<dir>,
// --dev-server=<url> (unpackaged only: load the Vite dev server with HMR instead of desktop/app).
const { app, BrowserWindow, Menu, ipcMain, protocol, session, shell, dialog, powerSaveBlocker, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createLogger } = require('./log.cjs');
const { ORIGIN, PRIVILEGES, SCHEME, createAppHandler } = require('./protocol.cjs');
const { SaveMirror } = require('./saves.cjs');
const steam = require('./steam.cjs');

const APP_NAME = 'Jimothy Simulator';
/**
 * Release builds with the real App ID may set this to true: if the exe is started outside Steam, it quits and Steam
 * relaunches it (SteamAPI_RestartAppIfNecessary). Off by default so the game also runs without Steam.
 */
const RESTART_THROUGH_STEAM = false;
/** Valve's public test app ("Spacewar"): achievements we unlock don't exist there. */
const TEST_APP_ID = 480;

const ROOT = path.join(__dirname, '..'); // desktop/ (or resources/app.asar when packaged)
const APP_DIR = path.join(ROOT, 'app');
const IS_DEV = !app.isPackaged;
const cli = app.commandLine;
/**
 * Automated tests only (JIMOTHY_TEST=1, set by scripts/test-desktop.mjs): the window is never visible and never takes
 * focus — 1280×720 at the primary screen's corner but fully transparent, click-through, not focusable, no taskbar
 * button, shown inactive — and fullscreen is simulated (state + events only), so a test run never covers the user's
 * screen. Screenshots over the DevTools protocol still capture the rendered page.
 */
const TEST_MODE = process.env.JIMOTHY_TEST === '1';

// ------------------------------------------------------------------ paths & logging (before anything else)

app.setName(APP_NAME);
const userDataArg = cli.getSwitchValue('user-data-dir');
const userData = userDataArg ? path.resolve(userDataArg) : path.join(app.getPath('appData'), APP_NAME);
fs.mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
const log = createLogger(path.join(userData, 'logs'), { echo: IS_DEV });
log.info(`${APP_NAME} ${app.getVersion()} (Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, ${IS_DEV ? 'dev' : 'packaged'})`);
log.info('userData:', userData);

if (!app.requestSingleInstanceLock()) {
  log.info('another instance is already running; exiting');
  app.exit(0);
} else {
  main();
}

function main() {
  // ---------------------------------------------------------------- Steam (before 'ready': overlay needs GPU switches)
  const appId = steam.readAppId(path.join(ROOT, 'steam_appid.txt'));
  if (!cli.hasSwitch('no-steam')) {
    if (RESTART_THROUGH_STEAM && !IS_DEV && appId && appId !== TEST_APP_ID && steam.restartAppIfNecessary(appId)) {
      log.info('[steam] relaunching through Steam');
      app.exit(0);
      return;
    }
    steam.init(appId, log);
    if (steam.info().available && !cli.hasSwitch('no-steam-overlay')) steam.enableOverlay();
  } else {
    steam.disable(appId, 'disabled (--no-steam)');
    log.info('[steam] disabled (--no-steam)');
  }
  const achievements = loadAchievements(path.join(ROOT, 'achievements.json'));

  // ---------------------------------------------------------------- Chromium switches
  // Desktop players expect the title music without clicking first.
  cli.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  // Hybrid-GPU laptops: render on the discrete GPU.
  cli.appendSwitch('force_high_performance_gpu');
  // No Windows media overlay / media keys hijacking the game's music <audio> elements. (Test mode: an off-screen
  // window counts as occluded and would be throttled to a few fps, so occlusion tracking is off there.)
  cli.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService' + (TEST_MODE ? ',CalculateNativeWinOcclusion' : ''));
  if (TEST_MODE) cli.appendSwitch('disable-backgrounding-occluded-windows');

  protocol.registerSchemesAsPrivileged([PRIVILEGES]);
  if (process.platform === 'win32') app.setAppUserModelId('JimothySimulator.Game');

  const saves = new SaveMirror(path.join(userData, 'save'), log, { version: app.getVersion() });
  const devServer = IS_DEV ? cli.getSwitchValue('dev-server') : '';
  const startUrl = devServer || `${ORIGIN}/index.html`;
  const allowedOrigin = devServer ? new URL(devServer).origin : ORIGIN;

  let win = null;
  let quitting = false;
  let crashes = 0;
  let wakeLock = -1;

  // ---------------------------------------------------------------- fullscreen (simulated in TEST_MODE)
  let simFull = false;
  const isFull = () => (TEST_MODE ? simFull : !!win && !win.isDestroyed() && win.isFullScreen());
  const sendFs = (on) => {
    if (win && !win.isDestroyed()) win.webContents.send('window:fullscreen', !!on);
  };
  const setFull = (on) => {
    if (!win || win.isDestroyed()) return;
    if (!TEST_MODE) win.setFullScreen(!!on);
    else if (simFull !== !!on) {
      simFull = !!on;
      sendFs(simFull);
    }
  };

  // ---------------------------------------------------------------- window
  const stateFile = path.join(userData, 'window-state.json');
  const loadWindowState = () => {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {};
    } catch {
      return {};
    }
  };
  const saveWindowState = () => {
    if (!win || win.isDestroyed()) return;
    try {
      const full = isFull();
      const prev = loadWindowState();
      const bounds = TEST_MODE || full || win.isMinimized() || win.isMaximized() ? prev.bounds : win.getNormalBounds();
      fs.writeFileSync(stateFile, JSON.stringify({ fullscreen: full, maximized: win.isMaximized(), bounds }));
    } catch (err) {
      log.warn('could not save window state', err.message);
    }
  };

  function createWindow() {
    const st = loadWindowState();
    const wantFull = cli.hasSwitch('windowed') ? false : st.fullscreen !== false;
    simFull = TEST_MODE && wantFull;
    const fullscreen = !TEST_MODE && wantFull;
    let b = st.bounds && st.bounds.width >= 640 && st.bounds.height >= 360 ? st.bounds : null;
    if (TEST_MODE) {
      // Invisible but on a real screen (an off-screen window gets no vsync and crawls at a few fps).
      const wa = screen.getPrimaryDisplay().workArea;
      b = { x: wa.x, y: wa.y, width: 1280, height: 720 };
    }
    // Forget a windowed position that is no longer on any screen (monitor unplugged / resolution changed).
    const onScreen = (r) =>
      screen.getAllDisplays().some(({ workArea: a }) => r.x < a.x + a.width - 64 && r.x + r.width > a.x + 64 && r.y < a.y + a.height - 64 && r.y + r.height > a.y + 32);
    if (b && !TEST_MODE && !onScreen(b)) b = { width: Math.min(b.width, 1600), height: Math.min(b.height, 900) };
    const icon = [path.join(ROOT, 'build', 'icon.ico'), path.join(ROOT, 'build', 'icon.png')].find((p) => fs.existsSync(p));
    win = new BrowserWindow({
      title: APP_NAME,
      width: b ? b.width : 1600,
      height: b ? b.height : 900,
      x: b && b.x !== undefined ? b.x : undefined,
      y: b && b.y !== undefined ? b.y : undefined,
      useContentSize: TEST_MODE,
      minWidth: 800,
      minHeight: 450,
      fullscreen,
      fullscreenable: true,
      focusable: !TEST_MODE,
      skipTaskbar: TEST_MODE,
      // (only in test mode: any opacity option makes it a layered window on Windows)
      ...(TEST_MODE ? { opacity: 0 } : {}),
      show: false,
      backgroundColor: '#0e1520',
      autoHideMenuBar: true,
      icon,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        devTools: IS_DEV,
        spellcheck: false,
        enableWebSQL: false,
        navigateOnDragDrop: false,
      },
    });
    win.removeMenu();
    if (!fullscreen && st.maximized && !TEST_MODE) win.maximize();
    // Test mode: fully transparent, click-through, never focused, no taskbar button.
    if (TEST_MODE) win.setIgnoreMouseEvents(true);
    win.once('ready-to-show', () => {
      if (TEST_MODE) {
        win.showInactive();
        return;
      }
      win.show();
      win.focus();
    });
    // Keep "Jimothy Simulator" as the window title whatever the page sets.
    win.on('page-title-updated', (e) => e.preventDefault());

    // On Windows these fire *before* the window's fullscreen flag flips (isFullScreen() is still the old value),
    // so send the new state explicitly, then re-read it once the resize has settled.
    win.on('enter-full-screen', () => sendFs(true));
    win.on('leave-full-screen', () => sendFs(false));
    let fsResync = null;
    win.on('resize', () => {
      clearTimeout(fsResync);
      fsResync = setTimeout(() => win && !win.isDestroyed() && sendFs(isFull()), 200);
    });
    win.on('close', saveWindowState);

    // Keep the display awake while the game has focus (gamepad input doesn't count as activity on Windows).
    win.on('focus', () => {
      if (wakeLock < 0) wakeLock = powerSaveBlocker.start('prevent-display-sleep');
    });
    win.on('blur', () => {
      if (wakeLock >= 0) powerSaveBlocker.stop(wakeLock);
      wakeLock = -1;
    });
    // Minimised: Chromium stops drawing frames, but with background throttling off the page still counts as visible,
    // so the game's own "tab hidden → suspend audio" never runs. Mute it here instead.
    win.on('minimize', () => win.webContents.setAudioMuted(true));
    win.on('restore', () => win.webContents.setAudioMuted(false));

    const wc = win.webContents;
    // F11 / Alt+Enter: toggle fullscreen (also the Fullscreen button in the menus, through the bridge).
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key;
      if (key === 'F11' || (input.alt && (key === 'Enter' || input.code === 'Enter' || input.code === 'NumpadEnter'))) {
        e.preventDefault();
        if (!input.isAutoRepeat) setFull(!isFull());
      } else if (IS_DEV && ((input.control && input.shift && key.toLowerCase() === 'i') || key === 'F12')) {
        e.preventDefault();
        wc.toggleDevTools();
      }
    });

    // Links: never navigate the game window away; http(s) opens in the user's browser.
    wc.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
    const guard = (e, legacyUrl) => {
      const url = String(e.url || legacyUrl || '');
      let origin = '';
      try {
        origin = new URL(url).origin;
      } catch {
        /* invalid */
      }
      if (origin === allowedOrigin || url.startsWith(ORIGIN + '/')) return;
      e.preventDefault();
      openExternal(url);
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('will-attach-webview', (e) => e.preventDefault());

    // Renderer problems go to the log file (players can send desktop.log).
    wc.on('console-message', (details) => {
      if (details.level === 'error' || details.level === 'warning') {
        log[details.level === 'error' ? 'error' : 'warn'](`[page] ${details.message} (${details.sourceId}:${details.lineNumber})`);
      }
    });
    wc.on('render-process-gone', (_e, d) => {
      log.error('[page] renderer gone:', d.reason, d.exitCode);
      if (quitting || d.reason === 'clean-exit') return;
      crashes++;
      if (crashes <= 2) {
        setTimeout(() => win && !win.isDestroyed() && wc.reload(), 500);
      } else {
        dialog.showErrorBox(APP_NAME, `The game crashed (${d.reason}). Details are in:\n${log.file || userData}`);
        app.quit();
      }
    });
    wc.on('did-fail-load', (_e, code, desc, url) => log.error('[page] failed to load', url, code, desc));
    wc.on('unresponsive', () => log.warn('[page] unresponsive'));
    wc.on('responsive', () => log.info('[page] responsive again'));
    // GPU details once the GPU process is up (helps with "black screen" / slow-PC reports).
    wc.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const info = await app.getGPUInfo('basic');
          const devices = (info && info.gpuDevice) || [];
          const gpu = devices.find((d) => d.active) || devices[0] || {};
          const hex = (n) => (typeof n === 'number' ? '0x' + n.toString(16) : n);
          log.info('GPU:', JSON.stringify({ vendor: hex(gpu.vendorId), device: hex(gpu.deviceId), driver: gpu.driverVersion, gpus: devices.length, features: app.getGPUFeatureStatus() }));
        } catch (err) {
          log.warn('GPU info unavailable', err && err.message);
        }
      }, 3000);
    });

    win.loadURL(startUrl);
  }

  function openExternal(url) {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      return;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'mailto:') {
      log.warn('blocked external URL', u.protocol);
      return;
    }
    // Steam Deck (Game Mode) has no desktop browser: use the overlay's web browser instead.
    if (steam.info().deck && u.protocol !== 'mailto:' && steam.openInOverlay(u.href)) return;
    shell.openExternal(u.href).catch((err) => log.warn('openExternal failed', err.message));
  }

  function notice(title, text) {
    if (win && !win.isDestroyed()) win.webContents.send('desktop:notice', { title, text });
  }

  // ---------------------------------------------------------------- IPC (only from our own page)
  const fromGame = (e) => {
    try {
      const url = e.senderFrame && e.senderFrame.url;
      return !!url && (url.startsWith(ORIGIN + '/') || new URL(url).origin === allowedOrigin);
    } catch {
      return false;
    }
  };

  ipcMain.on('desktop:init', (e) => {
    if (!fromGame(e)) {
      e.returnValue = null;
      return;
    }
    e.returnValue = {
      fullscreen: isFull(),
      steam: steam.info(),
      app: { platform: process.platform, version: app.getVersion(), electron: process.versions.electron, packaged: !IS_DEV },
      save: saves.takeRestore(),
    };
  });
  ipcMain.on('save:write', (e, snap) => {
    if (fromGame(e)) saves.write(snap);
  });
  ipcMain.on('save:write-sync', (e, snap) => {
    e.returnValue = fromGame(e) ? saves.write(snap) : false;
  });
  ipcMain.on('app:quit', (e) => {
    if (!fromGame(e)) return;
    log.info('quit requested by the game');
    app.quit();
  });
  ipcMain.on('window:set-fullscreen', (e, on) => {
    if (fromGame(e)) setFull(!!on);
  });
  ipcMain.on('shell:open-external', (e, url) => {
    if (fromGame(e)) openExternal(url);
  });
  ipcMain.on('objective:completed', (e, id) => {
    if (!fromGame(e)) return;
    const api = achievements.get(String(id));
    if (api) steam.unlockAchievement(api);
  });
  ipcMain.on('objective:sync', (e, ids) => {
    if (!fromGame(e) || !Array.isArray(ids) || !steam.info().available) return;
    let n = 0;
    for (const id of ids) {
      const api = achievements.get(String(id));
      if (api && !steam.isAchievementUnlocked(api) && steam.unlockAchievement(api)) n++;
    }
    if (n) log.info(`[steam] caught up ${n} achievement(s) from saved progress`);
  });
  ipcMain.handle('steam:unlock', (e, apiName) => (fromGame(e) ? steam.unlockAchievement(String(apiName)) : false));
  ipcMain.handle('steam:is-unlocked', (e, apiName) => (fromGame(e) ? steam.isAchievementUnlocked(String(apiName)) : false));
  ipcMain.handle('steam:status', (e) => (fromGame(e) ? { ...steam.info(), achievementsMapped: achievements.size } : null));

  // ---------------------------------------------------------------- app lifecycle
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, createAppHandler(APP_DIR, log));
    const ses = session.defaultSession;
    const allowed = new Set(['pointerLock', 'fullscreen', 'automatic-fullscreen', 'keyboardLock', 'clipboard-sanitized-write', 'screen-wake-lock', 'persistent-storage']);
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
    // Photo mode's "Save photo" (a download link): straight into Pictures\Jimothy Simulator, no dialog.
    ses.on('will-download', (e, item) => {
      const src = item.getURL();
      const okSource = src.startsWith('data:image/') || src.startsWith('blob:' + ORIGIN) || src.startsWith(ORIGIN + '/');
      if (!okSource || !/^image\//.test(item.getMimeType() || 'image/')) {
        e.preventDefault();
        log.warn('blocked download', src.slice(0, 60));
        return;
      }
      try {
        const dir = path.join(app.getPath('pictures'), APP_NAME);
        fs.mkdirSync(dir, { recursive: true });
        const name = (item.getFilename() || `jimothy-${Date.now()}.jpg`).replace(/[^\w.-]+/g, '_');
        let target = path.join(dir, name);
        for (let i = 2; fs.existsSync(target) && i < 1000; i++) target = path.join(dir, name.replace(/(\.\w+)?$/, `-${i}$1`));
        item.setSavePath(target);
        item.once('done', (_ev, st) => {
          if (st === 'completed') notice('Photo saved', `Pictures\\${APP_NAME}\\${path.basename(target)}`);
          else notice('Photo not saved', `Download ${st}`);
        });
      } catch (err) {
        log.warn('photo save failed', err.message);
        e.preventDefault();
      }
    });
    // No application menu at all: no hidden Ctrl+R / Ctrl+W / zoom accelerators from Electron's default menu.
    Menu.setApplicationMenu(null);
    createWindow();
  });

  app.on('child-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit') log.warn('[process] gone:', d.type, d.reason, d.exitCode);
  });
  app.on('before-quit', () => {
    quitting = true;
    saveWindowState();
    try {
      session.defaultSession.flushStorageData();
    } catch {
      /* ignore */
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => log.info('bye'));

  if (appId === TEST_APP_ID && steam.info().available) {
    log.info('[steam] running as test app 480 (Spacewar): achievement unlocks will fail until the real App ID is set');
  }
}

/** desktop/achievements.json → Map(objective id → Steam achievement API name). */
function loadAchievements(file) {
  const map = new Map();
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const a of json.achievements || []) {
      if (a && typeof a.objective === 'string' && typeof a.apiName === 'string' && a.enabled !== false) {
        map.set(a.objective, a.apiName);
        for (const alias of a.aliases || []) if (typeof alias === 'string') map.set(alias, a.apiName);
      }
    }
    log.info(`[steam] ${map.size} objective → achievement mappings`);
  } catch (err) {
    log.warn('[steam] achievements.json not loaded:', err.message);
  }
  return map;
}
