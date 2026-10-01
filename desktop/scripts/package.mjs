// Packages the Windows x64 build: desktop/dist/win-unpacked/Jimothy Simulator.exe (the SteamPipe content root).
//
//   node scripts/package.mjs      (also `npm run package`; `npm run build:steam` = build:web + icons + package)
//
// Needs desktop/app (npm run build:web) and desktop/build/icon.ico (npm run icons). Uses the Electron version
// installed in desktop/node_modules. No installer: Steam installs the folder as is.
//
// After packaging: Chromium UI locales other than en-US are dropped (the game is English-only), Electron's own
// license files move into LICENSES/ together with the third-party notices of everything the game ships, and the
// Electron fuses are flipped (no ELECTRON_RUN_AS_NODE / NODE_OPTIONS / --inspect; the app only loads from app.asar).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktopDir, '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
const electronVersion = require('electron/package.json').version;
const PRODUCT = pkg.productName;
const distDir = path.join(desktopDir, 'dist');
const outDir = path.join(distDir, 'win-unpacked');
const t0 = Date.now();

// ------------------------------------------------------------------ preflight

const need = [
  [path.join(desktopDir, 'app', 'index.html'), 'npm run build:web'],
  [path.join(desktopDir, 'build', 'icon.ico'), 'npm run icons'],
  [path.join(desktopDir, 'achievements.json'), 'npm run achievements'],
  [path.join(desktopDir, 'steam_appid.txt'), 'create steam_appid.txt with the App ID'],
];
for (const [file, fix] of need) {
  if (!fs.existsSync(file)) {
    console.error(`[package] missing ${path.relative(desktopDir, file)} — run: ${fix}`);
    process.exit(1);
  }
}
const appId = (/\d+/.exec(fs.readFileSync(path.join(desktopDir, 'steam_appid.txt'), 'utf8')) || ['0'])[0];

// ------------------------------------------------------------------ package

// Allowlist of what goes into app.asar (paths relative to desktop/, '/'-separated, leading '/').
const KEEP_DIRS = new Set([
  '',
  '/electron',
  '/app',
  '/build',
  '/node_modules',
  '/node_modules/steamworks.js',
  '/node_modules/steamworks.js/dist',
  '/node_modules/steamworks.js/dist/win64',
]);
const KEEP_FILES = new Set([
  '/package.json',
  '/achievements.json',
  '/steam_appid.txt',
  '/build/icon.ico',
  '/build/icon.png',
  '/node_modules/steamworks.js/package.json',
  '/node_modules/steamworks.js/index.js',
  '/node_modules/steamworks.js/LICENSE',
  '/node_modules/steamworks.js/dist/win64/steam_api64.dll',
  '/node_modules/steamworks.js/dist/win64/steamworksjs.win32-x64-msvc.node',
]);
const KEEP_TREES = ['/electron/', '/app/'];
const ignore = (p) => {
  if (KEEP_DIRS.has(p) || KEEP_FILES.has(p)) return false;
  if (p.endsWith('.map')) return true;
  return !KEEP_TREES.some((t) => p.startsWith(t));
};

const tmpOut = path.join(distDir, '.packager');
fs.rmSync(tmpOut, { recursive: true, force: true });
const [built] = await packager({
  dir: desktopDir,
  out: tmpOut,
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  electronVersion,
  name: PRODUCT,
  executableName: PRODUCT,
  appVersion: pkg.version,
  buildVersion: pkg.version,
  icon: path.join(desktopDir, 'build', 'icon.ico'),
  // steamworks.js loads a native .node + steam_api64.dll: those must be real files on disk.
  asar: { unpack: '*.{node,dll}' },
  prune: false,
  junk: true,
  ignore,
  win32metadata: {
    CompanyName: PRODUCT,
    FileDescription: PRODUCT,
    ProductName: PRODUCT,
    InternalName: PRODUCT,
    OriginalFilename: `${PRODUCT}.exe`,
  },
  quiet: true,
});

fs.rmSync(outDir, { recursive: true, force: true });
fs.renameSync(built, outDir);
fs.rmSync(tmpOut, { recursive: true, force: true });

// ------------------------------------------------------------------ trim

// Chromium UI strings: the game is English-only.
const locales = path.join(outDir, 'locales');
let droppedLocales = 0;
for (const f of fs.readdirSync(locales)) {
  if (f !== 'en-US.pak') {
    fs.rmSync(path.join(locales, f));
    droppedLocales++;
  }
}
// Electron's "version" file only holds the Electron version; easy to mistake for the game's.
fs.rmSync(path.join(outDir, 'version'), { force: true });

// ------------------------------------------------------------------ licenses / notices

const licDir = path.join(outDir, 'LICENSES');
fs.mkdirSync(path.join(licDir, 'fonts'), { recursive: true });
fs.renameSync(path.join(outDir, 'LICENSE'), path.join(licDir, 'Electron-LICENSE.txt'));
fs.renameSync(path.join(outDir, 'LICENSES.chromium.html'), path.join(licDir, 'Chromium-LICENSES.html'));
const fontsDir = path.join(root, 'public', 'assets', 'fonts');
const fontLicenses = fs.readdirSync(fontsDir).filter((f) => /\.txt$/i.test(f));
for (const f of fontLicenses) fs.copyFileSync(path.join(fontsDir, f), path.join(licDir, 'fonts', f));
fs.copyFileSync(path.join(root, 'CREDITS.md'), path.join(licDir, 'CREDITS.md'));

const readLicense = (dir, names) => {
  for (const n of names) {
    const f = path.join(dir, n);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  }
  throw new Error('no license file in ' + dir);
};
const rootModules = path.join(root, 'node_modules');
const modVersion = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
const viteLicense = readLicense(path.join(rootModules, 'vite'), ['LICENSE.md', 'LICENSE']).split(/\n#+ Licenses of bundled dependencies/i)[0].trim();
const notices = [
  {
    name: 'three.js',
    license: 'MIT',
    use: '3D rendering (bundled in the game code)',
    version: modVersion(path.join(rootModules, 'three')),
    text: readLicense(path.join(rootModules, 'three'), ['LICENSE']),
  },
  {
    name: 'Rapier (@dimforge/rapier3d-compat)',
    license: 'Apache-2.0',
    use: 'physics engine, WebAssembly (bundled in the game code)',
    version: modVersion(path.join(rootModules, '@dimforge', 'rapier3d-compat')),
    text: readLicense(path.join(rootModules, '@dimforge', 'rapier3d-compat'), ['LICENSE', 'LICENSE.md', 'LICENSE.txt']),
  },
  {
    name: 'postprocessing',
    license: 'Zlib',
    use: 'post-processing effects (bundled in the game code)',
    version: modVersion(path.join(rootModules, 'postprocessing')),
    text: readLicense(path.join(rootModules, 'postprocessing'), ['LICENSE.md', 'LICENSE']),
  },
  {
    name: 'Vite',
    license: 'MIT',
    use: 'build tool; its module-preload helper is part of the game code',
    version: modVersion(path.join(rootModules, 'vite')),
    text: viteLicense,
  },
  {
    name: 'Rolldown',
    license: 'MIT',
    use: 'bundler; its runtime helper is part of the game code',
    version: modVersion(path.join(rootModules, 'rolldown')),
    text: readLicense(path.join(rootModules, 'rolldown'), ['LICENSE', 'LICENSE.md']),
  },
  {
    name: 'steamworks.js',
    license: 'MIT',
    use: 'Steamworks bindings (resources/app.asar.unpacked/node_modules/steamworks.js)',
    version: modVersion(path.join(desktopDir, 'node_modules', 'steamworks.js')),
    text: readLicense(path.join(desktopDir, 'node_modules', 'steamworks.js'), ['LICENSE']),
  },
  {
    name: 'Electron',
    license: 'MIT',
    use: 'desktop runtime (Jimothy Simulator.exe and the files next to it)',
    version: electronVersion,
    text: 'See LICENSES/Electron-LICENSE.txt. Chromium and the other components bundled with Electron: LICENSES/Chromium-LICENSES.html.',
  },
];
const fontNotes = fontLicenses.map((f) => `                                        ${f}`).join('\n');
const header = `Jimothy Simulator ${pkg.version} - third-party notices
${'='.repeat(60)}

Jimothy Simulator is an unofficial fan game. This build contains the third-party software and assets listed below,
each under its own license. Full texts follow; more in this folder:

  - LICENSES/Electron-LICENSE.txt     Electron (MIT)
  - LICENSES/Chromium-LICENSES.html   Chromium and everything else bundled with Electron
  - LICENSES/fonts/                   the game's fonts (Luckiest Guy: Apache-2.0; Lilita One, Nunito: SIL OFL 1.1)
${fontNotes}
  - LICENSES/CREDITS.md               every 3D model, texture, sound and music track and its source
                                      (Kenney, Poly Haven, OpenGameArt: CC0) plus the game's own assets

steam_api64.dll (resources/app.asar.unpacked/node_modules/steamworks.js/dist/win64) is the Steamworks API
redistributable, (c) Valve Corporation, distributed under the Steamworks SDK Access Agreement.
`;
const body = notices
  .map((n) => `\n${'-'.repeat(78)}\n${n.name} ${n.version} (${n.license}) - ${n.use}\n${'-'.repeat(78)}\n\n${n.text}\n`)
  .join('');
fs.writeFileSync(path.join(licDir, 'third_party_notices.txt'), (header + body).replace(/\r?\n/g, '\r\n'));

// ------------------------------------------------------------------ fuses

const exe = path.join(outDir, `${PRODUCT}.exe`);
await flipFuses(exe, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
});

// ------------------------------------------------------------------ summary

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
const iconInfo = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(desktopDir, 'build', 'icon-source.json'), 'utf8'));
  } catch {
    return null;
  }
})();
fs.writeFileSync(
  path.join(distDir, 'build-info.json'),
  JSON.stringify(
    { product: PRODUCT, version: pkg.version, electron: electronVersion, steamAppId: Number(appId), builtAt: new Date().toISOString(), files, bytes, icon: iconInfo },
    null,
    2,
  ) + '\n',
);
console.log(`[package] ${path.relative(desktopDir, exe)}`);
console.log(`[package] ${files} files, ${(bytes / 1048576).toFixed(1)} MB (dropped ${droppedLocales} locales), Electron ${electronVersion}, Steam App ID ${appId}${appId === '480' ? ' (test app: set the real one in steam_appid.txt)' : ''}`);
if (iconInfo?.placeholder) console.log('[package] icon: PLACEHOLDER from public/favicon.svg (add steam/store/shortcut_icon.ico and rebuild)');
console.log(`[package] done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
