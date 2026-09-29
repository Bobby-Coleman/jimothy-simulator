#!/usr/bin/env node
/**
 * Fetches the CC0 audio this game uses and copies exactly the files referenced by
 * src/audio/soundBank.ts into public/assets/audio/{sfx,music}/.
 *
 *   node tools/audio/fetch-assets.mjs            # download what's missing, copy, report size
 *   node tools/audio/fetch-assets.mjs --prune    # also delete unreferenced files in public/assets/audio
 *
 * Sources (all CC0, licenses verified on the pages; see CREDITS.md):
 *   Kenney audio packs  https://kenney.nl/assets/<slug>  ("License: Creative Commons CC0")
 *   OpenGameArt tracks  https://opengameart.org/content/<slug>  ("License(s): CC0")
 * Downloads are cached in tools/_downloads/audio/ (gitignored).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dl = path.join(root, 'tools/_downloads/audio');
const pub = path.join(root, 'public/assets/audio');
const prune = process.argv.includes('--prune');
fs.mkdirSync(dl, { recursive: true });

const { SOUND_BANK, MUSIC_BANK } = await import(pathToFileURL(path.join(root, 'src/audio/soundBank.ts')).href);

/** Bank folder prefix -> Kenney pack slug + how to find the file inside the extracted zip. */
const KENNEY = {
  impact: { slug: 'impact-sounds', map: (f) => `Audio/${f}` },
  rpg: { slug: 'rpg-audio', map: (f) => `Audio/${f}` },
  interface: { slug: 'interface-sounds', map: (f) => `Audio/${f}` },
  scifi: { slug: 'sci-fi-sounds', map: (f) => `Audio/${f}` },
  jingles: {
    slug: 'music-jingles',
    map: (f) => {
      const dir = { NES: '8-Bit jingles', SAX: 'Sax jingles', STEEL: 'Steel jingles', PIZZI: 'Pizzicato jingles', HIT: 'Hit jingles' }[f.match(/jingles_([A-Z]+)\d/)[1]];
      return `Audio/${dir}/${f}`;
    },
  },
  voice: { slug: 'voiceover-pack', map: (f) => (f.startsWith('male_') ? `Male/${f.slice(5)}` : `Female/${f.slice(7)}`) },
};

/** OpenGameArt music: bank file name -> page + direct file URL. */
const OGA = {
  'banana_track.ogg': ['banana-track', 'banana_track.ogg'],
  'wacky_workings.ogg': ['wacky-workings', 'wackyworkings_0.ogg'],
  'trouble_in_the_garden.ogg': ['trouble-in-the-garden', 'trouble%20in%20the%20garden.ogg'],
  'wacky_wobblings.ogg': ['wacky-wobblings', 'wackywobblings.ogg'],
  'chill_lofi_loop.ogg': ['chill-lofi-inspired-loop-edit', 'chilllofir-loop.ogg'],
  'napping_on_a_cloud.ogg': ['napping-on-a-cloud', 'napping_on_a_cloud.ogg'],
  'ai_contact.mp3': ['ai-contact', 'Of%20Far%20Different%20Nature%20-%20Ai%20Contact%20%28CC0%29_0.mp3'],
  'dialup_song.ogg': ['dialup-song', 'dialup_song_0.ogg'],
};

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (jimothy-simulator asset fetch)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  downloaded ${path.basename(dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
}

async function ensureKenney(slug) {
  const dir = path.join(dl, `kenney_${slug}`);
  if (fs.existsSync(dir)) return dir;
  const zip = path.join(dl, `kenney_${slug}.zip`);
  if (!fs.existsSync(zip)) {
    const page = await (await fetch(`https://kenney.nl/assets/${slug}`)).text();
    if (!page.includes('creativecommons.org/publicdomain/zero/1.0')) throw new Error(`kenney ${slug}: CC0 notice not found on page`);
    const url = page.match(new RegExp(`https://kenney\\.nl/media/pages/assets/${slug}/[^'"]+\\.zip`))?.[0];
    if (!url) throw new Error(`kenney ${slug}: zip link not found`);
    await download(url, zip);
  }
  fs.mkdirSync(dir, { recursive: true });
  try {
    execFileSync('tar', ['-xf', zip, '-C', dir]); // bsdtar (Windows 10+, macOS) reads zip
  } catch {
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  }
  return dir;
}

const wanted = new Map(); // dest (relative to public/assets/audio) -> source abs path (or async getter)
for (const def of Object.values(SOUND_BANK)) {
  for (const f of [...(def.files ?? []), ...(def.process?.files ?? [])]) {
    const [prefix, ...rest] = f.split('/');
    const k = KENNEY[prefix];
    if (!k) throw new Error(`no source mapping for sfx/${f}`);
    wanted.set(`sfx/${f}`, async () => path.join(await ensureKenney(k.slug), k.map(rest.join('/'))));
  }
}
for (const def of Object.values(MUSIC_BANK)) {
  for (const m of def.files) {
    const src = OGA[m.file];
    if (!src) throw new Error(`no source mapping for music/${m.file}`);
    wanted.set(`music/${m.file}`, async () => {
      const p = path.join(dl, 'oga', m.file);
      if (!fs.existsSync(p)) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        await download(`https://opengameart.org/sites/default/files/${src[1]}`, p);
      }
      return p;
    });
  }
}

let copied = 0;
for (const [dest, getSrc] of wanted) {
  const src = await getSrc();
  const out = path.join(pub, dest);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (!fs.existsSync(out) || fs.statSync(out).size !== fs.statSync(src).size) {
    fs.copyFileSync(src, out);
    copied++;
  }
}

// Report (and optionally prune) what's in public/assets/audio
const all = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else all.push(p);
  }
};
if (fs.existsSync(pub)) walk(pub);
let bytes = 0;
const stale = [];
for (const p of all) {
  const rel = path.relative(pub, p).split(path.sep).join('/');
  if (!wanted.has(rel)) stale.push(rel);
  else bytes += fs.statSync(p).size;
}
if (stale.length) {
  console.log(`${stale.length} unreferenced file(s) in public/assets/audio${prune ? ' (deleted)' : ' (use --prune to delete)'}:`);
  for (const s of stale) {
    console.log('  ' + s);
    if (prune) fs.unlinkSync(path.join(pub, s));
  }
}
const sfxBytes = [...wanted.keys()].filter((k) => k.startsWith('sfx/')).reduce((a, k) => a + fs.statSync(path.join(pub, k)).size, 0);
console.log(`${wanted.size} referenced files (${copied} copied): sfx ${(sfxBytes / 1048576).toFixed(2)} MB + music ${((bytes - sfxBytes) / 1048576).toFixed(2)} MB = ${(bytes / 1048576).toFixed(2)} MB`);
if (bytes > 25 * 1048576) console.warn('WARNING: audio exceeds the ~25 MB budget');
