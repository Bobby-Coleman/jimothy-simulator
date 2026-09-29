#!/usr/bin/env node
/**
 * Model catalog generator.
 *
 * Scans public/assets/models/**\/*.glb|gltf and writes public/assets/catalog.json:
 *   [{ path, kit, name, size:[x,y,z], min:[x,y,z], max:[x,y,z], triangles }, ...]
 *
 *  - path      URL path relative to the web root (public/), e.g. "assets/models/kenney/car-kit/sedan.glb".
 *              In the game load it as `${import.meta.env.BASE_URL}${path}`.
 *  - kit       folder name of the pack ("kenney/" prefix dropped): "car-kit", "city-kit-roads", ...
 *              Files sitting directly in models/ (our own Blender exports) get kit "custom".
 *  - name      file name without extension.
 *  - size/min/max  RAW bounding box in the model's own units (Kenney kits are ~1 unit per tile, not metres!),
 *              measured in the default pose with node transforms applied. Meters = raw * whatever scale the game applies.
 *  - triangles total triangle count over the default scene (instanced meshes counted once per node).
 *
 * Usage:  node tools/catalog.mjs [--root public/assets/models] [--out public/assets/catalog.json] [--quiet]
 * Re-run whenever models are added/changed. Safe to run any time; it only writes catalog.json.
 */
import { NodeIO, Logger, getBounds } from '@gltf-transform/core';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const argVal = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const quiet = args.includes('--quiet');
const modelsDir = path.resolve(ROOT, argVal('--root', 'public/assets/models'));
const outFile = path.resolve(ROOT, argVal('--out', 'public/assets/catalog.json'));
const publicDir = path.join(ROOT, 'public');

// Kenney's older kits declare KHR_materials_unlit (and some list KHR_texture_transform); register everything we can so
// reading never fails on a "required extension". The extensions package ships as a dependency of @gltf-transform/functions.
let extensions = [];
try { ({ ALL_EXTENSIONS: extensions } = await import('@gltf-transform/extensions')); } catch { /* fall back to core-only */ }
const io = new NodeIO().registerExtensions(extensions).setLogger(new Logger(Logger.Verbosity.ERROR));

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (/\.(glb|gltf)$/i.test(ent.name)) yield full;
  }
}

function primitiveTriangles(prim) {
  const mode = prim.getMode();
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
  if (mode === 4) return Math.floor(count / 3);              // TRIANGLES
  if (mode === 5 || mode === 6) return Math.max(0, count - 2); // TRIANGLE_STRIP / FAN
  return 0;                                                   // points / lines
}

function countTriangles(scene) {
  let tris = 0;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (mesh) for (const prim of mesh.listPrimitives()) tris += primitiveTriangles(prim);
  });
  return tris;
}

const round = (v) => Math.round(v * 1000) / 1000;
const rows = [];
let failed = 0;

for (const file of walk(modelsDir)) {
  const rel = path.relative(publicDir, file).split(path.sep).join('/');
  const relToModels = path.relative(modelsDir, file).split(path.sep).join('/');
  const parts = relToModels.split('/');
  const name = parts[parts.length - 1].replace(/\.(glb|gltf)$/i, '');
  const dirParts = parts.slice(0, -1);
  if (dirParts[0] === 'kenney') dirParts.shift();
  const kit = dirParts.length ? dirParts.join('/') : 'custom';
  try {
    const doc = await io.read(file);
    const root = doc.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    if (!scene) throw new Error('no scene');
    const { min, max } = getBounds(scene);
    const empty = !Number.isFinite(min[0]);
    const mn = empty ? [0, 0, 0] : min.map(round);
    const mx = empty ? [0, 0, 0] : max.map(round);
    rows.push({
      path: rel,
      kit,
      name,
      size: mx.map((v, i) => round(v - mn[i])),
      min: mn,
      max: mx,
      triangles: countTriangles(scene),
    });
  } catch (err) {
    failed++;
    console.warn(`! skipped ${rel}: ${err.message}`);
  }
}

rows.sort((a, b) => a.path.localeCompare(b.path));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, '[\n' + rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n');

if (!quiet) {
  const kits = new Map();
  for (const r of rows) kits.set(r.kit, (kits.get(r.kit) ?? 0) + 1);
  console.log(`catalog: ${rows.length} models in ${kits.size} kit(s) -> ${path.relative(ROOT, outFile)}${failed ? `  (${failed} skipped)` : ''}`);
  for (const [k, n] of [...kits].sort()) console.log(`  ${k.padEnd(28)} ${n}`);
}
