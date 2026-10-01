// Builds the web game (repo root, Vite) into desktop/app/ for the Electron shell.
//
//   node scripts/build-web.mjs            (from desktop/; also `npm run build:web`)
//
// Same Vite config as the GitHub Pages build, which already uses a relative base ('./'): the desktop shell serves
// desktop/app/ from app://jimothy/, so assetUrl() ('./assets/...') and Vite's own chunks resolve there unchanged.
// The root project's node_modules must be installed (`npm ci` in the repo root) — Vite lives there, not here.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktopDir, '..');
const outDir = path.join(desktopDir, 'app');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(viteBin)) {
  console.error('[build-web] Vite not found. Run `npm ci` in the repository root first.');
  process.exit(1);
}

const t0 = Date.now();
const r = spawnSync(process.execPath, [viteBin, 'build', '--outDir', outDir, '--emptyOutDir', '--base', './'], {
  cwd: root,
  stdio: 'inherit',
});
if (r.status !== 0) {
  console.error(`[build-web] vite build failed (exit ${r.status})`);
  process.exit(r.status || 1);
}

// Sanity checks: the shell loads app://jimothy/index.html and everything below it.
const index = path.join(outDir, 'index.html');
if (!fs.existsSync(index)) {
  console.error('[build-web] no index.html in', outDir);
  process.exit(1);
}
const html = fs.readFileSync(index, 'utf8');
if (/(src|href)="\/(?!\/)/.test(html)) {
  console.error('[build-web] index.html has root-absolute URLs; the desktop build needs a relative base');
  process.exit(1);
}

let files = 0;
let bytes = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
};
walk(outDir);
console.log(`[build-web] desktop/app: ${files} files, ${(bytes / 1048576).toFixed(1)} MB (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
