'use strict';
// Preload (sandboxed, context-isolated): exposes `window.jimothyDesktop` to the game. The web build never has it,
// so every desktop-only feature in src/ keys off its presence (see src/platform/desktop.ts).
const { contextBridge, ipcRenderer } = require('electron');

const PREFIX = 'jimothy.';

/** One synchronous round trip at startup: window state, Steam status, app info and the save to restore. */
let boot = null;
try {
  boot = ipcRenderer.sendSync('desktop:init');
} catch (err) {
  console.warn('[desktop] init failed', err);
}
boot = boot || { fullscreen: false, steam: { available: false, appId: 0 }, app: {}, save: null };

// ------------------------------------------------------------------ save mirror (electron/saves.cjs)

function jimothyKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

// Runs before any game script: the save file (Steam Cloud) replaces the jimothy.* keys on the first load of a run.
if (boot.save && typeof boot.save === 'object') {
  try {
    for (const k of jimothyKeys()) if (!Object.prototype.hasOwnProperty.call(boot.save, k)) localStorage.removeItem(k);
    for (const k of Object.keys(boot.save)) if (localStorage.getItem(k) !== boot.save[k]) localStorage.setItem(k, boot.save[k]);
  } catch (err) {
    console.warn('[desktop] could not restore the save file', err);
  }
}

let lastSaved = null;
function pushSave(sync) {
  let snap;
  try {
    snap = {};
    for (const k of jimothyKeys().sort()) snap[k] = localStorage.getItem(k);
  } catch {
    return;
  }
  const json = JSON.stringify(snap);
  if (json === lastSaved) return;
  lastSaved = json;
  try {
    if (sync) ipcRenderer.sendSync('save:write-sync', snap);
    else ipcRenderer.send('save:write', snap);
  } catch {
    /* window closing */
  }
}
setInterval(() => pushSave(false), 4000);
window.addEventListener('pagehide', () => pushSave(true));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pushSave(false);
});

// ------------------------------------------------------------------ window state / notices

let fullscreen = !!boot.fullscreen;
const fsListeners = new Set();
ipcRenderer.on('window:fullscreen', (_e, on) => {
  fullscreen = !!on;
  for (const fn of [...fsListeners]) {
    try {
      fn(fullscreen);
    } catch (err) {
      console.warn('[desktop] fullscreen listener failed', err);
    }
  }
});

const noticeListeners = new Set();
const pendingNotices = [];
ipcRenderer.on('desktop:notice', (_e, notice) => {
  if (!noticeListeners.size) {
    pendingNotices.push(notice);
    return;
  }
  for (const fn of [...noticeListeners]) {
    try {
      fn(notice);
    } catch (err) {
      console.warn('[desktop] notice listener failed', err);
    }
  }
});

const steam = boot.steam || {};
const app = boot.app || {};

contextBridge.exposeInMainWorld('jimothyDesktop', {
  platform: String(app.platform || 'win32'),
  version: String(app.version || ''),
  electron: String(app.electron || ''),
  packaged: !!app.packaged,

  /** Save, then close the game (title screen / pause menu Quit button). */
  quit: () => {
    pushSave(true);
    ipcRenderer.send('app:quit');
  },

  isFullscreen: () => fullscreen,
  setFullscreen: (on) => ipcRenderer.send('window:set-fullscreen', !!on),
  toggleFullscreen: () => ipcRenderer.send('window:set-fullscreen', !fullscreen),
  /** Subscribe to window fullscreen changes; returns an unsubscribe function. */
  onFullscreenChange: (fn) => {
    if (typeof fn !== 'function') return () => {};
    fsListeners.add(fn);
    return () => fsListeners.delete(fn);
  },

  /** http(s) links open in the user's browser (or the Steam overlay browser on Steam Deck). */
  openExternal: (url) => ipcRenderer.send('shell:open-external', String(url)),

  /** Short messages from the shell (e.g. "Photo saved to Pictures\Jimothy Simulator"). */
  onNotice: (fn) => {
    if (typeof fn !== 'function') return () => {};
    noticeListeners.add(fn);
    for (const n of pendingNotices.splice(0)) {
      try {
        fn(n);
      } catch {
        /* ignore */
      }
    }
    return () => noticeListeners.delete(fn);
  },

  /** An Instinct (objective) was completed: unlocks its Steam achievement via desktop/achievements.json. */
  objectiveCompleted: (id) => ipcRenderer.send('objective:completed', String(id)),
  /** Every completed Instinct id (on boot): unlocks achievements earned while Steam wasn't running. */
  syncObjectives: (ids) => ipcRenderer.send('objective:sync', Array.isArray(ids) ? ids.slice(0, 2000).map(String) : []),

  steam: {
    available: !!steam.available,
    appId: Number(steam.appId) || 0,
    overlay: !!steam.overlay,
    onDeck: !!steam.deck,
    language: steam.language ? String(steam.language) : null,
    /** Unlock a Steam achievement by API name. Resolves false without Steam / for unknown names (e.g. under app 480). */
    unlockAchievement: (apiName) => ipcRenderer.invoke('steam:unlock', String(apiName)),
    isAchievementUnlocked: (apiName) => ipcRenderer.invoke('steam:is-unlocked', String(apiName)),
    status: () => ipcRenderer.invoke('steam:status'),
  },
});
