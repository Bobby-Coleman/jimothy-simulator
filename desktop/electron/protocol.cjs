'use strict';
// app://jimothy/ — serves the Vite build (desktop/app, inside app.asar when packaged) like a static web server.
//
// Why not file://: a privileged standard+secure scheme gives the page a real origin, so fetch(), module scripts and
// workers, FontFace, <audio> streaming (Range requests), WebAssembly and localStorage all behave exactly as on the
// web build. Files are read with fs.promises.readFile, which Electron serves straight out of app.asar.
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'jimothy';
const ORIGIN = `${SCHEME}://${HOST}`;

/** Must run before app 'ready'. */
const PRIVILEGES = {
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2',
  '.hdr': 'application/octet-stream',
  '.exr': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.mp4': 'video/mp4',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Content-Security-Policy for the game page: only its own files. 'wasm-unsafe-eval' is for Rapier's WebAssembly,
 * 'unsafe-inline' styles for index.html's boot <style> and the UI's inline style attributes; data:/blob: for GLB
 * textures, photo-mode snapshots and the audio worker.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

function text(status, body) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** Parse a single "bytes=a-b" range (multi-range requests are answered with the whole file). */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

/** protocol.handle() handler serving `root` (absolute path, may be inside app.asar). */
function createAppHandler(root, log) {
  const base = path.resolve(root);
  return async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return text(400, 'Bad request');
    }
    if (url.host !== HOST) return text(404, 'Not found');
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return text(400, 'Bad request');
    }
    if (rel === '' || rel === '/') rel = '/index.html';
    const file = path.resolve(base, '.' + rel);
    if (!file.startsWith(base + path.sep)) return text(403, 'Forbidden');

    let data;
    try {
      data = await fs.promises.readFile(file);
    } catch (err) {
      if (err && err.code !== 'ENOENT' && err.code !== 'EISDIR') log?.warn('[protocol]', rel, err.message);
      return text(404, 'Not found');
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;

    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const r = parseRange(rangeHeader, data.length);
      if (r === 'invalid') {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${data.length}` } });
      }
      if (r) {
        const chunk = data.subarray(r.start, r.end + 1);
        return new Response(request.method === 'HEAD' ? null : chunk, {
          status: 206,
          headers: { ...headers, 'Content-Range': `bytes ${r.start}-${r.end}/${data.length}`, 'Content-Length': String(chunk.length) },
        });
      }
    }
    headers['Content-Length'] = String(data.length);
    return new Response(request.method === 'HEAD' ? null : data, { status: 200, headers });
  };
}

module.exports = { SCHEME, HOST, ORIGIN, PRIVILEGES, CSP, createAppHandler };
