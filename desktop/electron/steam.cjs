'use strict';
// Steamworks via steamworks.js. Everything here is optional: if Steam isn't running, the user doesn't own the app,
// or the native module can't load, the game runs exactly the same, just without achievements and the overlay.
const fs = require('node:fs');

const state = {
  /** SteamAPI initialised (Steam running, app owned / dev app id). */
  available: false,
  appId: 0,
  /** Why Steam isn't available (for the log / status call). */
  error: null,
  overlay: false,
  deck: false,
  language: null,
};

let sw = null;
let client = null;
let log = console;
const failedOnce = new Set();

/** Reads the App ID from steam_appid.txt (first integer in the file). Returns 0 if missing/invalid. */
function readAppId(file) {
  try {
    const m = /\d+/.exec(fs.readFileSync(file, 'utf8'));
    return m ? Number(m[0]) : 0;
  } catch {
    return 0;
  }
}

/** Initialise Steam (call before app 'ready' so the overlay switches can still be applied). */
function init(appId, logger) {
  log = logger || console;
  state.appId = appId;
  if (!appId) {
    state.error = 'no App ID (steam_appid.txt missing)';
    log.warn('[steam]', state.error);
    return state;
  }
  try {
    sw = require('steamworks.js');
  } catch (err) {
    state.error = 'steamworks.js failed to load: ' + (err && err.message);
    log.warn('[steam]', state.error);
    return state;
  }
  try {
    client = sw.init(appId);
    state.available = true;
    state.error = null;
  } catch (err) {
    client = null;
    state.error = String((err && err.message) || err);
    log.info('[steam] not available, running without Steam:', state.error);
    return state;
  }
  try {
    state.deck = !!client.utils.isSteamRunningOnSteamDeck();
  } catch {
    /* older client */
  }
  try {
    state.language = client.apps.currentGameLanguage() || null;
  } catch {
    /* ignore */
  }
  log.info(`[steam] initialised (app ${appId}${state.deck ? ', Steam Deck' : ''}${state.language ? ', ' + state.language : ''})`);
  return state;
}

/** Steam deliberately not used (--no-steam). */
function disable(appId, reason) {
  state.appId = appId;
  state.error = reason;
}

/**
 * Relaunch through Steam if the exe was started directly (release builds with a real App ID only; see README).
 * Returns true when the caller should quit because Steam is relaunching the game.
 */
function restartAppIfNecessary(appId) {
  try {
    if (!sw) sw = require('steamworks.js');
    return !!sw.restartAppIfNecessary(appId);
  } catch (err) {
    log.warn('[steam] restartAppIfNecessary failed:', err && err.message);
    return false;
  }
}

/**
 * Lets the Steam overlay (Shift+Tab, achievement toasts, F12 screenshots) hook Chromium's renderer: appends
 * --in-process-gpu and --disable-direct-composition. Must run before app 'ready'. The game redraws every frame
 * anyway, so steamworks.js's per-frame invalidation timer is not needed (true = disable it).
 */
function enableOverlay() {
  if (!sw || !state.available) return false;
  try {
    sw.electronEnableSteamOverlay(true);
    state.overlay = true;
  } catch (err) {
    log.warn('[steam] overlay hook failed:', err && err.message);
  }
  return state.overlay;
}

function isAchievementUnlocked(apiName) {
  if (!client) return false;
  try {
    return !!client.achievement.isActivated(apiName);
  } catch {
    return false;
  }
}

/** Unlock (and store) an achievement. Returns false if Steam isn't available or the API name doesn't exist. */
function unlockAchievement(apiName) {
  if (!client || typeof apiName !== 'string' || !/^[A-Za-z0-9_]{1,128}$/.test(apiName)) return false;
  try {
    if (client.achievement.isActivated(apiName)) return true;
    const ok = !!client.achievement.activate(apiName);
    if (ok) log.info('[steam] achievement unlocked:', apiName);
    else if (!failedOnce.has(apiName)) {
      failedOnce.add(apiName);
      // Expected under the test app 480 (Spacewar): our achievements only exist on the real App ID.
      log.warn(`[steam] could not unlock "${apiName}" (not defined for app ${state.appId}?)`);
    }
    return ok;
  } catch (err) {
    log.warn('[steam] unlock failed:', apiName, err && err.message);
    return false;
  }
}

/** Open a web page in the Steam overlay browser (used on Steam Deck, where there's no desktop browser in Game Mode). */
function openInOverlay(url) {
  if (!client || !state.overlay) return false;
  try {
    client.overlay.activateToWebPage(url);
    return true;
  } catch {
    return false;
  }
}

function info() {
  return { ...state };
}

module.exports = { readAppId, init, disable, restartAppIfNecessary, enableOverlay, isAchievementUnlocked, unlockAchievement, openInOverlay, info };
