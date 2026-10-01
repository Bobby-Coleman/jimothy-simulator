'use strict';
// Save mirror for Steam Cloud.
//
// The game keeps all progress and settings in localStorage under "jimothy.*" keys (same code as the web build).
// Chromium stores localStorage as a LevelDB folder, which is a poor fit for cloud sync, so the desktop shell mirrors
// those keys into ONE small JSON file:  <userData>/save/jimothy-save.json  (Steam Auto-Cloud syncs that folder).
//
//   * First page load of each run: the preload asks for the file and, if it exists, replaces the jimothy.* keys
//     with its contents (the file may have just been downloaded by Steam Cloud from another PC).
//   * While playing: the preload sends a snapshot whenever the keys change (polled every few seconds) and
//     synchronously when the page unloads (Quit button, Alt+F4, window close).
//   * No file yet (first run): localStorage is kept as is and the file is created from it.
const fs = require('node:fs');
const path = require('node:path');

const FORMAT = 1;
const MAX_BYTES = 8 * 1024 * 1024;
const PREFIX = 'jimothy.';

class SaveMirror {
  constructor(dir, log, meta = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'jimothy-save.json');
    this.log = log;
    this.meta = meta;
    this.restoreServed = false;
    this.last = null;
  }

  /** The saved key/values for the first page load of this run (null afterwards, or when there is no valid file). */
  takeRestore() {
    if (this.restoreServed) return null;
    this.restoreServed = true;
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') this.log.warn('[save] read failed:', err.message);
      return null;
    }
    try {
      const obj = JSON.parse(raw);
      const data = sanitize(obj && obj.data);
      if (!data) throw new Error('unexpected format');
      this.last = canonical(data);
      this.log.info(`[save] restored ${Object.keys(data).length} keys from ${this.file}`);
      return data;
    } catch (err) {
      // Keep the unreadable file for inspection; the game continues with what localStorage has.
      const bad = this.file.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
      try {
        fs.renameSync(this.file, bad);
      } catch {
        /* ignore */
      }
      this.log.warn('[save] ignoring unreadable save file:', err.message, '->', bad);
      return null;
    }
  }

  /** Write a snapshot ({key: value} of every jimothy.* key) if it changed. Atomic (temp file + rename). */
  write(snapshot) {
    const data = sanitize(snapshot);
    if (!data) return false;
    const json = canonical(data);
    if (json === this.last) return true;
    if (json.length > MAX_BYTES) {
      this.log.warn('[save] snapshot too large, not written:', json.length);
      return false;
    }
    const body = JSON.stringify({ format: FORMAT, game: 'Jimothy Simulator', savedAt: new Date().toISOString(), ...this.meta, data: JSON.parse(json) }, null, 1);
    const tmp = this.file + '.tmp';
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, this.file);
      this.last = json;
      return true;
    } catch (err) {
      this.log.warn('[save] write failed:', err.message);
      return false;
    }
  }
}

/** Only string values under the jimothy. prefix; anything else is dropped. Returns null for non-objects. */
function sanitize(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out = {};
  for (const k of Object.keys(obj)) {
    if (k.startsWith(PREFIX) && typeof obj[k] === 'string') out[k] = obj[k];
  }
  return out;
}

/** Stable JSON (sorted keys) so unchanged snapshots compare equal. */
function canonical(data) {
  const o = {};
  for (const k of Object.keys(data).sort()) o[k] = data[k];
  return JSON.stringify(o);
}

module.exports = { SaveMirror, PREFIX };
