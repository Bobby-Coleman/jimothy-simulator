'use strict';
// Tiny file logger for the desktop shell. A packaged GUI app has no console, so problems players report can be
// diagnosed from %APPDATA%\Jimothy Simulator\logs\desktop.log (previous session: desktop.old.log).
const fs = require('node:fs');
const path = require('node:path');

function createLogger(dir, { echo = false } = {}) {
  let file = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'desktop.log');
    if (fs.existsSync(file)) fs.renameSync(file, path.join(dir, 'desktop.old.log'));
  } catch {
    file = null;
  }
  let lines = 0;
  const write = (level, args) => {
    const msg = args
      .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : safeJson(a)))
      .join(' ');
    const line = `${new Date().toISOString()} [${level}] ${msg}`;
    if (echo) (level === 'error' ? console.error : console.log)(line);
    // Cap the file so a renderer spamming warnings can't fill the disk.
    if (!file || lines > 5000) return;
    lines++;
    try {
      fs.appendFileSync(file, line + '\n');
    } catch {
      /* disk full / read-only: logging is best effort */
    }
  };
  return {
    file,
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
  };
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

module.exports = { createLogger };
