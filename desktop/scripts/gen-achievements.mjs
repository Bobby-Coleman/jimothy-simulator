// Generates desktop/achievements.json: one Steam achievement per Instinct (objective).
//
//   node scripts/gen-achievements.mjs          (also `npm run achievements`)
//   node scripts/gen-achievements.mjs --check  (exit 1 if achievements.json is missing an objective)
//
// Sources: src/gameplay/content/objectiveDefs.ts (the Instinct list, imported directly; Node strips the types) plus
// objectives that systems register themselves with addObjective(game, { ...literal }) (e.g. src/gameplay/chaos/*).
// Fallback ids that some systems use when the main list is missing (`ids: ['crowDeals', 'crow_deals']`,
// SlopSystem's ALIASES) become `aliases` of the same achievement.
//
// Regenerating is safe: an existing entry keeps its apiName (never rename a published Steam achievement) and its
// `enabled` flag; names/descriptions are refreshed from the game. Objectives that disappeared stay in the file
// with "enabled": false. The shell (electron/main.cjs) maps objective id / alias -> apiName from this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktopDir, '..');
const srcDir = path.join(root, 'src');
const outFile = path.join(desktopDir, 'achievements.json');
const check = process.argv.includes('--check');
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');

// ------------------------------------------------------------------ collect objective definitions

const defsFile = path.join(srcDir, 'gameplay', 'content', 'objectiveDefs.ts');
const { OBJECTIVES } = await import(pathToFileURL(defsFile).href);
const defs = new Map();
const sources = new Map();
for (const d of OBJECTIVES) {
  defs.set(d.id, d);
  sources.set(d.id, rel(defsFile));
}

const tsFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) tsFiles.push(p);
  }
};
walk(srcDir);

/** The balanced {...} starting at text[i] (skips strings and comments). */
function objectLiteralAt(text, i) {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === "'" || c === '"' || c === '`') {
      for (j++; j < text.length && text[j] !== c; j++) if (text[j] === '\\') j++;
    } else if (c === '/' && text[j + 1] === '/') {
      j = text.indexOf('\n', j);
      if (j < 0) return null;
    } else if (c === '/' && text[j + 1] === '*') {
      j = text.indexOf('*/', j) + 1;
      if (j <= 0) return null;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return null;
}

const extraWarnings = [];
const aliasGroups = [];
for (const file of tsFiles) {
  const text = fs.readFileSync(file, 'utf8');
  // addObjective(game, { id: '...', ... })
  for (const m of text.matchAll(/addObjective\(\s*\w+\s*,\s*\{/g)) {
    const lit = objectLiteralAt(text, m.index + m[0].length - 1);
    if (!lit) continue;
    let def;
    try {
      // Plain data literals only (strings / numbers / booleans); anything else fails and is reported.
      def = new Function(`"use strict"; return (${lit});`)();
    } catch (err) {
      extraWarnings.push(`${rel(file)}: could not read an addObjective literal (${err.message})`);
      continue;
    }
    if (def && typeof def.id === 'string' && typeof def.title === 'string' && !defs.has(def.id)) {
      defs.set(def.id, def);
      sources.set(def.id, rel(file));
    }
  }
  // fallback id groups: ids: ['primary', 'alias', ...]
  for (const m of text.matchAll(/ids:\s*\[([^\]]*)\]/g)) {
    const ids = [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
    if (ids.length > 1) aliasGroups.push({ ids, file: rel(file) });
  }
}

const aliasesOf = new Map();
for (const g of aliasGroups) {
  const primaries = g.ids.filter((id) => defs.has(id));
  if (primaries.length !== 1) continue;
  const p = primaries[0];
  const list = aliasesOf.get(p) ?? [];
  for (const id of g.ids) if (id !== p && !defs.has(id) && !list.includes(id)) list.push(id);
  aliasesOf.set(p, list);
}

// ------------------------------------------------------------------ build the table

const apiNameFor = (id) =>
  'JIMOTHY_' +
  id
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

let previous = null;
try {
  previous = JSON.parse(fs.readFileSync(outFile, 'utf8'));
} catch {
  /* first run */
}
const prevById = new Map((previous?.achievements ?? []).map((a) => [a.objective, a]));

const entries = [];
for (const [id, d] of defs) {
  const prev = prevById.get(id);
  entries.push({
    objective: id,
    apiName: prev?.apiName ?? apiNameFor(id),
    displayName: d.title,
    description: d.desc,
    hidden: !!d.hidden,
    category: d.category,
    enabled: prev?.enabled ?? true,
    aliases: aliasesOf.get(id) ?? [],
    source: sources.get(id),
  });
}
for (const [id, prev] of prevById) {
  if (!defs.has(id)) entries.push({ ...prev, enabled: false, note: 'objective no longer in the game' });
}

const apiNames = new Map();
for (const e of entries) {
  if (!/^[A-Z0-9_]{1,128}$/.test(e.apiName)) throw new Error(`bad apiName ${e.apiName}`);
  if (apiNames.has(e.apiName)) throw new Error(`duplicate apiName ${e.apiName} (${apiNames.get(e.apiName)} / ${e.objective})`);
  apiNames.set(e.apiName, e.objective);
}

const out = {
  $comment:
    'Instinct (objective) id -> Steam achievement. Generated by desktop/scripts/gen-achievements.mjs; enter each entry in Steamworks > Stats & Achievements > Achievements (API Name, Display Name, Description, Hidden). Never rename an apiName after the achievement is published.',
  count: entries.filter((e) => e.enabled).length,
  achievements: entries,
};
const json = JSON.stringify(out, null, 2) + '\n';

for (const w of extraWarnings) console.warn('[achievements] warning:', w);
if (check) {
  const missing = [...defs.keys()].filter((id) => !prevById.has(id));
  if (missing.length) {
    console.error(`[achievements] achievements.json is missing ${missing.length} objective(s): ${missing.join(', ')} — run npm run achievements`);
    process.exit(1);
  }
  console.log(`[achievements] OK: ${defs.size} objectives mapped`);
} else {
  fs.writeFileSync(outFile, json);
  const extra = [...sources.values()].filter((s) => s !== rel(defsFile)).length;
  console.log(`[achievements] wrote ${rel(outFile)}: ${entries.length} achievements (${OBJECTIVES.length} from objectiveDefs.ts, ${extra} from addObjective calls), ${[...aliasesOf.values()].flat().length} aliases`);
}
