// Builds the Windows icon for the exe / window: desktop/build/icon.ico (+ icon.png, 256 px).
//
//   node scripts/make-icons.mjs        (also part of `npm run build:steam`)
//
// Source, first match wins:
//   1. steam/store/shortcut_icon.ico  — used as is (the Steam shortcut icon; multi-size .ico)
//   2. steam/store/shortcut_icon.png  — rasterised to 16…256 px and packed into an .ico
//   3. public/favicon.svg             — PLACEHOLDER (the web favicon) until the store art exists
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktopDir, '..');
const buildDir = path.join(desktopDir, 'build');
const require = createRequire(import.meta.url);
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const candidates = [
  { file: path.join(root, 'steam', 'store', 'shortcut_icon.ico'), placeholder: false },
  { file: path.join(root, 'steam', 'store', 'shortcut_icon.png'), placeholder: false },
  { file: path.join(root, 'public', 'favicon.svg'), placeholder: true },
];
const src = candidates.find((c) => fs.existsSync(c.file));
if (!src) {
  console.error('[icons] no icon source found');
  process.exit(1);
}
fs.mkdirSync(buildDir, { recursive: true });
const rel = path.relative(root, src.file).replace(/\\/g, '/');

/** Multi-size .ico with PNG-compressed images (Windows Vista+). */
function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const e = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e);
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1);
    dir.writeUInt8(0, e + 2);
    dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(img.png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

if (src.file.endsWith('.ico')) {
  fs.copyFileSync(src.file, path.join(buildDir, 'icon.ico'));
  fs.rmSync(path.join(buildDir, 'icon.png'), { force: true });
} else {
  const electronExe = require('electron');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jimothy-icons-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jimothy-rasterize-'));
  const r = spawnSync(electronExe, [path.join(desktopDir, 'scripts', 'rasterize.cjs'), src.file, tmp, SIZES.join(',')], {
    stdio: 'inherit',
    timeout: 120000,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', JIMOTHY_RASTER_PROFILE: profile },
  });
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (r.status !== 0) {
    console.error('[icons] rasterising failed');
    process.exit(1);
  }
  const images = SIZES.map((size) => ({ size, png: fs.readFileSync(path.join(tmp, `${size}.png`)) }));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), makeIco(images));
  fs.copyFileSync(path.join(tmp, '256.png'), path.join(buildDir, 'icon.png'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
fs.writeFileSync(path.join(buildDir, 'icon-source.json'), JSON.stringify({ source: rel, placeholder: src.placeholder }, null, 1) + '\n');
console.log(`[icons] build/icon.ico from ${rel}${src.placeholder ? ' (PLACEHOLDER: add steam/store/shortcut_icon.ico or .png and rebuild)' : ''}`);
