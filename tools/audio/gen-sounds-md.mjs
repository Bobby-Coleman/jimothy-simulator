#!/usr/bin/env node
/**
 * Regenerates src/audio/SOUNDS.md from src/audio/soundBank.ts (+ recipe variant counts).
 *   node tools/audio/gen-sounds-md.mjs
 */
import './lib/ts-hooks.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { SOUND_BANK, MUSIC_BANK } = await imp('src/audio/soundBank.ts');
const { RECIPES } = await imp('src/audio/synth/recipes/index.ts');

const PACKS = {
  impact: 'Kenney Impact Sounds',
  rpg: 'Kenney RPG Audio',
  interface: 'Kenney Interface Sounds',
  scifi: 'Kenney Sci-fi Sounds',
  jingles: 'Kenney Music Jingles',
  voice: 'Kenney Voiceover Pack',
};
const CATS = {
  raccoon: "Jimothy's voice (synthesized)",
  player: 'Player movement',
  impact: 'Impacts & destruction',
  water: 'Water & washing',
  cartoon: 'Cartoon & props',
  people: 'People (synthesized formant voices)',
  world: 'World & ambience',
  slop: 'AI slop',
  reward: 'Rewards & jingles',
  ui: 'UI',
};

const rows = new Map();
for (const [key, d] of Object.entries(SOUND_BANK)) {
  const src = [];
  let n = 0;
  if (d.files?.length) {
    const packs = [...new Set(d.files.map((f) => PACKS[f.split('/')[0]] ?? f.split('/')[0]))];
    src.push(`${packs.join(', ')} (${d.files.length})`);
    n += d.files.length;
  }
  if (d.synth) {
    const v = RECIPES[d.synth]?.variants ?? 0;
    src.push(`synth \`${d.synth}\` ×${v}`);
    n += v;
  }
  if (d.process) {
    src.push(`${d.process.files.length} voice lines → \`${d.process.with}\``);
    n += d.process.files.length;
  }
  const notes = [];
  if (d.loop) notes.push('**loop**');
  if (d.ui) notes.push('UI (2D)');
  if (d.max) notes.push(`max ${d.max}`);
  if (d.minGap) notes.push(`gap ${d.minGap}s`);
  if (d.ref || d.maxDist) notes.push(`${d.ref ?? 4}–${d.maxDist ?? 60} m`);
  if (d.pitch && d.pitch !== 1) notes.push(`pitch ${d.pitch}`);
  if (d.duck != null) notes.push('ducks music');
  if (d.layers) notes.push('+ ' + d.layers.map((l) => `\`${l.key}\``).join(', '));
  if (!rows.has(d.cat)) rows.set(d.cat, []);
  rows.get(d.cat).push(`| \`${key}\` | ${d.desc} | ${src.join(' + ')} | ${n} | ${notes.join(', ')} |`);
}

let md = `# Sound keys

> **Generated** from \`src/audio/soundBank.ts\` by \`node tools/audio/gen-sounds-md.mjs\` — edit the bank, then regenerate.
> ${Object.keys(SOUND_BANK).length} keys. Test them all at **/audio-test.html** (dev server).

## How to play sounds

* Gameplay code: \`game.sfx('bonk', position?, volume?, pitch?)\` — the AudioSystem (\`src/audio/AudioSystem.ts\`) plays it,
  positional when a position is given (attenuated from Jimothy, panned from the camera, silent beyond the key's max range).
* Direct: \`import { audio } from '../audio/AudioManager'\`, then
  \`const h = audio.play('roll_loop', { position, volume, pitch, pitchVar, loop, delay })\` → handle
  \`{ stop(fade?), setVolume(v), setPitch(p), setPosition(v3 | null), playing }\` or \`null\` (not loaded / rate-limited / out of range).
* **Loops** return a handle even before loading finishes (they start when ready): keep it, update it each frame, \`stop()\` it.
* Each key has several variations (picked at random, never twice in a row) plus random pitch (±\`pitchVar\`, default 5%).
  Per-key caps (\`max\`, default 4; oldest cut) and a min gap between plays (default 25 ms) keep physics chaos listenable.
* Music: \`audio.playMusic('title' | 'day' | 'night' | 'slop', fadeSec)\` / \`audio.stopMusic()\` — the AudioSystem already
  switches themes automatically (title screen, day/night, SlopCorp Campus).
* Volumes: emit \`'audioVolume' { master?, sfx?, music? }\` (0..1, persisted) or \`jimothy.get('audio').setVolumes(...)\`.
* Unknown keys log one warning and play nothing — nothing in the audio code ever throws.

Sources: **Kenney** packs are CC0 recordings (\`public/assets/audio/sfx/\`, see CREDITS.md); **synth** recipes are our own,
rendered procedurally at load time in a Web Worker (\`src/audio/synth/recipes/\`); voice lines run through \`slopify\` become AI-slop speech.

`;
for (const [cat, title] of Object.entries(CATS)) {
  const r = rows.get(cat);
  if (!r) continue;
  md += `## ${title}\n\n| key | use | source | var. | notes |\n|---|---|---|---|---|\n${r.join('\n')}\n\n`;
}
md += `## Music themes (\`audio.playMusic(theme)\`)

Streamed from \`public/assets/audio/music/\` (loudness-normalized per file). Playlists play through, then the next track.

| theme | when | tracks (title — author) |
|---|---|---|
`;
const when = { title: 'title screen', day: 'daytime free-roam', night: 'night (Environment.isNight)', slop: 'inside SlopCorp Campus' };
for (const [t, d] of Object.entries(MUSIC_BANK)) {
  md += `| \`${t}\` | ${when[t] ?? ''} — ${d.desc} | ${d.files.map((f) => `${f.title} — ${f.author}`).join('<br>')} |\n`;
}
md += `
All music is **CC0** from OpenGameArt (license verified on each page); details in CREDITS.md.

## Played automatically by the AudioSystem

| trigger | sound |
|---|---|
| any \`'sfx'\` event (\`game.sfx\`) | that key |
| player washing (\`player.washing\`) | \`wash_loop\` (follows Jimothy) |
| player \`mode === 'roll'\` | \`roll_loop\`, volume/pitch ∝ speed, quiet in the air |
| walking on the ground | \`footstep\` / \`footstep_grass\` (park-ish areas) / \`footstep_wood\` (docks), rate ∝ speed |
| climbing / swimming | \`climb\` scrabbles / small paddle \`splash\`es |
| near bay / pond / fountain / pool | \`water_loop\` at the nearest water edge |
| inside SlopCorp Campus | \`server_hum_loop\` + \`slop\` music |
| every 7–16 s | \`crow_caw\` (anywhere, fewer at night) or \`seagull\` (near the bay, daytime) |
| \`objective\` / \`mutatorUnlocked\` / \`comboUp\` | \`objective_complete\` / \`mutator_unlock\` / \`combo_up\` (deduped with game.sfx) |
| \`scoreAdded\` | subtle \`score\` plink (throttled, pitch rises with combo) |
| \`cameraFlash\` / \`filmed\` | \`camera_shutter\` at the photographer |
| \`explosion\` | \`explosion\` |
| \`npcRagdoll\` | cartoon \`scream\` (throttled) or \`whoosh\` |
| \`splash\` | \`splash\` / \`splash_big\` by strength (deduped with the player's own splash sfx) |
| \`sparkle\` / \`trashTipped\` / \`cottonCandyGone\` | \`sparkle\` / \`trash_can\` / \`fizz\` |
| \`wash\` | a few \`bubble_pop\`s |
| \`playerRagdoll\` (flop) / \`playerImpact\` | \`flop\` / \`impact_body\` + \`squeak\` |
| \`climbStart\` / \`hangStart\` | \`climb\` / \`grab\` |
`;
const out = path.join(root, 'src/audio/SOUNDS.md');
fs.writeFileSync(out, md);
console.log(`wrote ${path.relative(root, out)} (${Object.keys(SOUND_BANK).length} keys)`);
