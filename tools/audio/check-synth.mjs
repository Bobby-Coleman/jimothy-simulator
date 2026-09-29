#!/usr/bin/env node
/**
 * Renders every procedural sound recipe (src/audio/synth) in plain Node and reports
 * duration / peak / RMS / loudest-50ms RMS, flagging anything silent, clipped, NaN or with a
 * loop-seam click. Exit code 1 if any hard problem is found.
 *
 *   node tools/audio/check-synth.mjs              # table + verdict
 *   node tools/audio/check-synth.mjs --wav        # also write 16-bit WAV previews
 *   node tools/audio/check-synth.mjs --png        # also write spectrogram PNGs (one per recipe)
 *   node tools/audio/check-synth.mjs --only chitter,trill
 *
 * Previews go to tools/_downloads/audio/preview/ (gitignored) so you can listen offline.
 * Requires Node >= 22.18 / 23.6 (TypeScript type stripping + module.registerHooks).
 */
import './lib/ts-hooks.mjs'; // must come first: lets us import the game's .ts modules
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeWav, spectrogramPng } from './lib/audio-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const wantWav = args.includes('--wav');
const wantPng = args.includes('--png');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;
const outDir = path.join(root, 'tools/_downloads/audio/preview');
if (wantWav || wantPng) fs.mkdirSync(outDir, { recursive: true });

const { RECIPES } = await import(pathToFileURL(path.join(root, 'src/audio/synth/recipes/index.ts')).href);

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1).padStart(6) : '  -inf');

function stats(chans, sr) {
  let peak = 0;
  let sum = 0;
  let nan = 0;
  let clip = 0;
  let dc = 0;
  let maxWin = 0;
  const n = chans[0].length;
  const w = Math.floor(sr * 0.05);
  for (const c of chans) {
    for (let i = 0; i < n; i++) {
      const x = c[i];
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a >= 0.999) clip++;
      sum += x * x;
      dc += x;
    }
    for (let i = 0; i + w <= n; i += Math.floor(w / 4)) {
      let s = 0;
      for (let j = i; j < i + w; j++) s += c[j] * c[j];
      maxWin = Math.max(maxWin, Math.sqrt(s / w));
    }
    if (n < w) maxWin = Math.max(maxWin, Math.sqrt(sum / Math.max(1, n)));
  }
  return { dur: n / sr, peak, rms: Math.sqrt(sum / (n * chans.length)), maxWin, nan, clip, dc: dc / (n * chans.length) };
}

/** Loop seam check: jump between last and first sample vs typical sample-to-sample change. */
function seam(c) {
  const n = c.length;
  const diffs = [];
  for (let i = 1; i < n; i += 7) diffs.push(Math.abs(c[i] - c[i - 1]));
  diffs.sort((a, b) => a - b);
  const p99 = diffs[Math.floor(diffs.length * 0.99)] || 1e-9;
  return Math.abs(c[0] - c[n - 1]) / p99;
}

let problems = 0;
let total = 0;
let totalMs = 0;
let totalSamples = 0;
console.log('recipe              v  ch    sr   dur(s)   peak(dB) rms(dB) loud50(dB)  ms   flags');
for (const [name, rec] of Object.entries(RECIPES)) {
  if (only && !only.has(name)) continue;
  const pngRows = [];
  for (let v = 0; v < rec.variants; v++) {
    const t0 = performance.now();
    let data;
    try {
      data = rec.render(v, rec.sr);
    } catch (e) {
      console.log(`${name.padEnd(18)} ${String(v).padStart(2)}  RENDER ERROR: ${e?.stack || e}`);
      problems++;
      continue;
    }
    const ms = performance.now() - t0;
    totalMs += ms;
    total++;
    const chans = Array.isArray(data) ? data : [data];
    totalSamples += chans[0].length * chans.length;
    const s = stats(chans, rec.sr);
    const flags = [];
    if (s.nan) flags.push(`NaN x${s.nan}`);
    if (s.peak < 0.02 || s.maxWin < 0.003) flags.push('SILENT');
    if (s.peak >= 0.999) flags.push(`CLIPPED x${s.clip}`);
    if (Math.abs(s.dc) > 0.02) flags.push(`DC ${s.dc.toFixed(3)}`);
    if (rec.loop) {
      const sj = Math.max(...chans.map(seam));
      if (sj > 3) flags.push(`SEAM x${sj.toFixed(1)}`);
      else flags.push(`loop ok (${sj.toFixed(2)})`);
    }
    if (s.dur > 4) flags.push('LONG');
    const hard = flags.filter((f) => /NaN|SILENT|CLIPPED|SEAM|DC/.test(f));
    if (hard.length) problems++;
    console.log(
      `${name.padEnd(18)} ${String(v).padStart(2)} ${String(chans.length).padStart(3)} ${String(rec.sr).padStart(6)} ${s.dur.toFixed(3).padStart(7)} ${fmt(db(s.peak))}   ${fmt(db(s.rms))}   ${fmt(db(s.maxWin))}  ${ms.toFixed(0).padStart(4)}  ${flags.join(' ')}`,
    );
    if (wantWav) writeWav(path.join(outDir, `${name}_${v}.wav`), chans, rec.sr);
    if (wantPng) pngRows.push({ chans, sr: rec.sr });
  }
  if (wantPng && pngRows.length) spectrogramPng(path.join(outDir, `${name}.png`), pngRows);
}
console.log(
  `\n${total} variations rendered in ${totalMs.toFixed(0)} ms (${((totalSamples * 4) / 1048576).toFixed(1)} MB as Float32). ${problems ? `${problems} PROBLEM(S)` : 'All OK: nothing silent, clipped, NaN or clicky.'}`,
);
if (wantWav || wantPng) console.log(`Previews written to ${path.relative(root, outDir)}`);
process.exit(problems ? 1 : 0);
