#!/usr/bin/env node
/**
 * Kenney (CC0) 3D kit importer.  https://kenney.nl/assets  (every kit below is "Creative Commons CC0").
 *
 *   node tools/import-kenney.mjs                 # import every kit in KITS
 *   node tools/import-kenney.mjs car-kit food-kit
 *   node tools/import-kenney.mjs --no-download   # only use zips already in tools/_downloads/zips
 *
 * For each kit:
 *   1. downloads the zip to tools/_downloads/zips/<slug>.zip and extracts to tools/_downloads/extracted/<slug>/ (gitignored)
 *   2. copies ONLY the .glb models (+ the textures they reference, + Kenney's alternate colour palettes "variation-*.png",
 *      + License.txt) to public/assets/models/kenney/<slug>/   (external textures stay at ./Textures/<file>.png, exactly
 *      where the GLBs expect them)
 *   3. copies per-model preview PNGs to tools/_catalog_previews/<slug>/<model>.png (gitignored, for humans/agents to browse)
 *
 * Material fix-ups (only what a lit Three.js scene needs; geometry/UVs/textures are untouched, BIN chunk is byte-identical):
 *   - KHR_materials_unlit is removed  (retro-urban-kit, blocky-characters ship unlit -> would render as flat MeshBasicMaterial)
 *   - metallicFactor 1 -> 0           (glTF default is 1: nature-kit, retro-urban-kit, blocky-characters would look like dark chrome)
 *
 * After importing run:  node tools/catalog.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DL = path.join(ROOT, 'tools/_downloads');
const OUT_MODELS = path.join(ROOT, 'public/assets/models/kenney');
const OUT_PREVIEWS = path.join(ROOT, 'tools/_catalog_previews');

const K = 'https://kenney.nl/media/pages/assets/';
/** slug -> { zip (url), only?: RegExp (model-name filter), title } */
const KITS = {
  'city-kit-suburban':   { title: 'City Kit (Suburban)',   zip: K + 'city-kit-suburban/2c871b7af2-1745479373/kenney_city-kit-suburban_20.zip' },
  'city-kit-commercial': { title: 'City Kit (Commercial)', zip: K + 'city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip' },
  'city-kit-roads':      { title: 'City Kit (Roads)',      zip: K + 'city-kit-roads/74288c9459-1787042796/kenney_city-kit-roads.zip' },
  'city-kit-industrial': { title: 'City Kit (Industrial)', zip: K + 'city-kit-industrial/0ec35b139d-1788171848/kenney_city-kit-industrial_2.0.zip' },
  'car-kit':             { title: 'Car Kit',               zip: K + 'car-kit/1a312ec241-1775131960/kenney_car-kit.zip' },
  'food-kit':            { title: 'Food Kit',              zip: K + 'food-kit/83086fa91c-1719418518/kenney_food-kit.zip' },
  'furniture-kit':       { title: 'Furniture Kit',         zip: K + 'furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip' },
  'nature-kit':          { title: 'Nature Kit',            zip: K + 'nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip' },
  'watercraft-kit':      { title: 'Watercraft Kit',        zip: K + 'watercraft-kit/a335cfed49-1713519620/kenney_watercraft-pack.zip' },
  'platformer-kit':      { title: 'Platformer Kit',        zip: K + 'platformer-kit/1585cf62b4-1775122253/kenney_platformer-kit.zip' },
  'mini-market':         { title: 'Mini Market',           zip: K + 'mini-market/463f38da51-1729865423/kenney_mini-market.zip' },
  'holiday-kit':         { title: 'Holiday Kit',           zip: K + 'holiday-kit/3976a6496a-1733923970/kenney_holiday-kit.zip' },
  'survival-kit':        { title: 'Survival Kit',          zip: K + 'survival-kit/4065a8185b-1712149243/kenney_survival-kit.zip' },
  'retro-urban-kit':     { title: 'Retro Urban Kit',       zip: K + 'retro-urban-kit/8314d4db22-1738147509/kenney_retro-urban-kit.zip' },
  'pirate-kit':          { title: 'Pirate Kit',            zip: K + 'pirate-kit/e6d4bb1525-1771333093/kenney_pirate-kit.zip' },
  'racing-kit':          { title: 'Racing Kit',            zip: K + 'racing-kit/933b8fd9fd-1677580949/kenney_racing-kit.zip' },
  'blocky-characters':   { title: 'Blocky Characters',     zip: K + 'blocky-characters/8369c0cf30-1749547469/kenney_blocky-characters_20.zip' },
  'mini-characters':     { title: 'Mini Characters',       zip: K + 'mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip' },
  // Medieval kit: we only want the park/market bits (fountains, market stalls, carts, lanterns, hedges, fences, trees, rocks).
  'fantasy-town-kit':    { title: 'Fantasy Town Kit (subset)', zip: K + 'fantasy-town-kit/efe948d309-1754222374/kenney_fantasy-town-kit_2.0.zip',
                           only: /^(fountain|stall|cart|lantern|banner|fence|hedge|rock|tree|pillar|stairs-stone|wheel)/ },
};

const args = process.argv.slice(2);
const noDownload = args.includes('--no-download');
const wanted = args.filter((a) => !a.startsWith('--'));
const slugs = wanted.length ? wanted : Object.keys(KITS);

// ---------------------------------------------------------------- helpers
const exists = (p) => fs.existsSync(p);
const mkdir = (p) => fs.mkdirSync(p, { recursive: true });
const ci = (dir, name) => (exists(dir) ? fs.readdirSync(dir).find((n) => n.toLowerCase() === name.toLowerCase()) : undefined);

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'JimothySimulator-asset-fetch/1.0' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  mkdir(path.dirname(dest));
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function extract(zip, dest) {
  mkdir(dest);
  const attempts = [
    ['unzip', ['-q', '-o', zip, '-d', dest]],
    ['tar', ['-xf', zip, '-C', dest]], // bsdtar on Windows 10+/macOS reads zips
    ['powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${dest}'`]],
  ];
  for (const [cmd, a] of attempts) {
    const r = spawnSync(cmd, a, { stdio: 'ignore' });
    if (r.status === 0) return;
  }
  throw new Error(`could not extract ${zip} (need unzip, bsdtar or PowerShell)`);
}

/** Rewrite the JSON chunk of a .glb, leaving every other byte as-is. */
function patchGlb(buf, fn) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const rest = buf.subarray(20 + jsonLen);
  const changed = fn(json);
  if (!changed) return buf;
  let s = Buffer.from(JSON.stringify(json), 'utf8');
  s = Buffer.concat([s, Buffer.alloc((4 - (s.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + s.length + rest.length, 8);
  head.writeUInt32LE(s.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, s, rest]);
}

/** Make Kenney materials behave in a lit PBR scene. Returns true if anything changed. */
function litFix(json) {
  let changed = false;
  for (const m of json.materials ?? []) {
    if (m.extensions?.KHR_materials_unlit) {
      delete m.extensions.KHR_materials_unlit;
      if (!Object.keys(m.extensions).length) delete m.extensions;
      changed = true;
    }
    const p = (m.pbrMetallicRoughness ??= {});
    if ((p.metallicFactor ?? 1) === 1) { p.metallicFactor = 0; changed = true; }
  }
  const stillUsed = (json.materials ?? []).some((m) => m.extensions?.KHR_materials_unlit);
  if (!stillUsed) {
    for (const key of ['extensionsUsed', 'extensionsRequired']) {
      if (json[key]?.includes('KHR_materials_unlit')) {
        json[key] = json[key].filter((e) => e !== 'KHR_materials_unlit');
        if (!json[key].length) delete json[key];
        changed = true;
      }
    }
  }
  return changed;
}

const imageUris = (json) => (json.images ?? []).map((i) => i.uri).filter((u) => u && !u.startsWith('data:'));
function readGlbJson(buf) { return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))); }

// ---------------------------------------------------------------- per-kit import
async function importKit(slug) {
  const kit = KITS[slug];
  if (!kit) throw new Error(`unknown kit "${slug}"`);
  const zip = path.join(DL, 'zips', `${slug}.zip`);
  const src = path.join(DL, 'extracted', slug);
  if (!exists(src)) {
    if (!exists(zip)) {
      if (noDownload) throw new Error(`${zip} missing (--no-download)`);
      console.log(`  downloading ${kit.zip}`);
      await download(kit.zip, zip);
    }
    extract(zip, src);
  }

  const modelsRoot = path.join(src, 'Models');
  const glbDirName = fs.readdirSync(modelsRoot).find((n) => /^(glb format|gltf format)$/i.test(n));
  if (!glbDirName) throw new Error(`${slug}: no "GLB format"/"GLTF format" folder`);
  const glbDir = path.join(modelsRoot, glbDirName);
  const dstDir = path.join(OUT_MODELS, slug);
  const prevDst = path.join(OUT_PREVIEWS, slug);
  mkdir(dstDir);
  mkdir(prevDst);

  const models = fs.readdirSync(glbDir).filter((f) => /\.glb$/i.test(f)).filter((f) => !kit.only || kit.only.test(f));
  const textures = new Set();
  let bytes = 0, patched = 0;
  for (const f of models) {
    let buf = fs.readFileSync(path.join(glbDir, f));
    const fixed = patchGlb(buf, litFix);
    if (fixed !== buf) { patched++; buf = fixed; }
    for (const u of imageUris(readGlbJson(buf))) textures.add(u);
    fs.writeFileSync(path.join(dstDir, f), buf);
    bytes += buf.length;
  }

  // Textures referenced by the GLBs (uri is relative to the .glb, e.g. "Textures/colormap.png").
  for (const uri of textures) {
    const from = path.join(glbDir, uri);
    if (!exists(from)) { console.warn(`  ! ${slug}: referenced texture missing: ${uri}`); continue; }
    mkdir(path.dirname(path.join(dstDir, uri)));
    fs.copyFileSync(from, path.join(dstDir, uri));
    bytes += fs.statSync(from).size;
  }
  // Kenney's alternate colour palettes (same UV layout as colormap.png) -> Textures/variation-*.png
  const varDir = path.join(modelsRoot, 'Textures');
  if (exists(varDir) && textures.has('Textures/colormap.png')) {
    for (const f of fs.readdirSync(varDir).filter((n) => /\.png$/i.test(n))) {
      mkdir(path.join(dstDir, 'Textures'));
      fs.copyFileSync(path.join(varDir, f), path.join(dstDir, 'Textures', f));
      bytes += fs.statSync(path.join(varDir, f)).size;
    }
  }
  const lic = ci(src, 'License.txt');
  if (lic) fs.copyFileSync(path.join(src, lic), path.join(dstDir, 'License.txt'));

  // Previews (gitignored): new-style kits have Previews/<name>.png, older ones Isometric/<name>_NE.png
  const names = models.map((f) => f.replace(/\.glb$/i, ''));
  const prevDir = ci(src, 'Previews');
  const isoDir = ci(src, 'Isometric');
  let previews = 0;
  for (const n of names) {
    const cand = [prevDir && path.join(src, prevDir, `${n}.png`), isoDir && path.join(src, isoDir, `${n}_NE.png`), isoDir && path.join(src, isoDir, `${n}_E.png`)].filter(Boolean);
    const hit = cand.find(exists);
    if (hit) { fs.copyFileSync(hit, path.join(prevDst, `${n}.png`)); previews++; }
  }
  for (const f of fs.readdirSync(src).filter((n) => /^preview.*\.png$/i.test(n))) {
    const tag = f.replace(/\.png$/i, '').replace(/^preview/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    fs.copyFileSync(path.join(src, f), path.join(prevDst, `_overview${tag ? '-' + tag : ''}.png`));
  }

  console.log(`  ${slug.padEnd(22)} ${String(models.length).padStart(3)} models, ${textures.size} tex, ${previews} previews, ${patched} material-fixed, ${(bytes / 1048576).toFixed(2)} MB`);
  return bytes;
}

let total = 0;
console.log(`Importing ${slugs.length} Kenney kit(s) -> ${path.relative(ROOT, OUT_MODELS)}`);
for (const s of slugs) total += await importKit(s);
console.log(`done: ${(total / 1048576).toFixed(1)} MB written. Now run: node tools/catalog.mjs`);
