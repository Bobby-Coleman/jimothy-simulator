/**
 * Dev page script for /audio-test.html: a button per sound key and music theme, loop toggles,
 * positional/stress tests, and `?autotest` mode (used by tools/audio/check-browser.mjs) which
 * analyses every buffer, plays everything once and exposes the results on window.__audioTest.
 */
import * as THREE from 'three';
import { audio, type SoundHandle } from './AudioManager';
import { MUSIC_BANK, SOUND_BANK, type MusicTrack, type SoundCategory } from './soundBank';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const auto = new URLSearchParams(location.search).has('autotest');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Listener: origin, facing -Z (like an unrotated camera).
const listener = new THREE.Object3D();
audio.setListener(listener);

const CATS: Record<SoundCategory, string> = {
  raccoon: 'Jimothy — synthesized raccoon voice',
  player: 'Player movement',
  impact: 'Impacts & destruction',
  water: 'Water & washing',
  cartoon: 'Cartoon & props',
  people: 'People — synthesized formant voices',
  world: 'World & ambience',
  slop: 'AI slop',
  reward: 'Rewards & jingles',
  ui: 'UI',
};

const loops = new Map<string, SoundHandle>();
const buttons = new Map<string, HTMLButtonElement>();

/** Random point 3..maxDist m from the listener (keys cull sounds beyond their maxDist). */
function randomSpot(maxDist = 30): THREE.Vector3 {
  const a = Math.random() * Math.PI * 2;
  const d = 3 + Math.random() * Math.max(0, maxDist - 3);
  return new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
}

function playKey(key: string, ev?: MouseEvent) {
  void audio.unlock();
  const def = SOUND_BANK[key];
  if (def.loop) {
    const h = loops.get(key);
    if (h && h.playing) {
      h.stop(0.3);
      loops.delete(key);
      buttons.get(key)?.classList.remove('on');
    } else {
      const nh = audio.play(key, ev?.shiftKey ? { position: randomSpot() } : {});
      if (nh) {
        loops.set(key, nh);
        buttons.get(key)?.classList.add('on');
      }
    }
    return;
  }
  audio.play(key, ev?.shiftKey ? { position: randomSpot() } : {});
}

// ---------------------------------------------------------------- build the page
function build() {
  const root = el<HTMLDivElement>('sounds');
  const byCat = new Map<SoundCategory, string[]>();
  for (const k of audio.keys) {
    const c = SOUND_BANK[k].cat;
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(k);
  }
  for (const [cat, keys] of byCat) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h2>${CATS[cat]}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const k of keys) {
      const b = document.createElement('button');
      const def = SOUND_BANK[k];
      b.textContent = (def.loop ? '⟳ ' : '') + k;
      b.title = def.desc;
      b.classList.add('missing');
      b.addEventListener('click', (e) => playKey(k, e));
      grid.appendChild(b);
      buttons.set(k, b);
    }
    sec.appendChild(grid);
    root.appendChild(sec);
  }
  const music = el<HTMLDivElement>('music');
  for (const t of Object.keys(MUSIC_BANK) as MusicTrack[]) {
    const b = document.createElement('button');
    b.textContent = `♪ ${t}`;
    b.title = `${MUSIC_BANK[t].desc}\n` + MUSIC_BANK[t].files.map((f) => `• ${f.title} — ${f.author}`).join('\n');
    b.addEventListener('click', async () => {
      await audio.unlock();
      audio.playMusic(t, 2);
    });
    music.appendChild(b);
  }
  const stop = document.createElement('button');
  stop.textContent = '■ stop music';
  stop.addEventListener('click', () => audio.stopMusic(1.5));
  music.appendChild(stop);

  const sel = el<HTMLSelectElement>('pos-key');
  for (const k of audio.keys) {
    if (SOUND_BANK[k].ui) continue;
    const o = document.createElement('option');
    o.value = o.textContent = k;
    if (k === 'chitter') o.selected = true;
    sel.appendChild(o);
  }
  document.querySelectorAll<HTMLButtonElement>('button[data-pos]').forEach((b) =>
    b.addEventListener('click', () => {
      void audio.unlock();
      const [x, y, z] = b.dataset.pos!.split(',').map(Number);
      const h = audio.play(sel.value, { position: new THREE.Vector3(x, y, z) });
      if (h && SOUND_BANK[sel.value].loop) setTimeout(() => h.stop(0.3), 2500);
    }),
  );
  el('orbit').addEventListener('click', () => {
    void audio.unlock();
    if (orbit) {
      orbit.stop(0.3);
      orbit = null;
      el('orbit').classList.remove('on');
      return;
    }
    orbit = audio.play('car_engine_loop', { position: new THREE.Vector3(8, 0, 0), loop: true });
    if (orbit) el('orbit').classList.add('on');
  });
  el('stress').addEventListener('click', () => void stress());
  el('stopall').addEventListener('click', () => {
    audio.stopAll(0.1);
    loops.clear();
    buttons.forEach((b) => b.classList.remove('on'));
  });
  el('unlock').addEventListener('click', () => void audio.unlock());
  for (const k of ['master', 'sfx', 'music'] as const) {
    el<HTMLInputElement>(`vol-${k}`).addEventListener('input', (e) => audio.setVolumes({ [k]: Number((e.target as HTMLInputElement).value) }));
  }
}

let orbit: SoundHandle | null = null;
let orbitT = 0;
let maxVoices = 0;

async function stress(): Promise<number> {
  await audio.unlock();
  let peak = 0;
  // impact_bell rings for up to ~1.7 s, so 40 hits 30 ms apart would stack ~40 deep without the cap
  for (let i = 0; i < 40; i++) {
    audio.play('impact_bell', { position: new THREE.Vector3((i % 7) - 3, 0, -4), volume: 0.5 });
    audio.play('impact_light', { position: new THREE.Vector3(3 - (i % 7), 0, -4) });
    peak = Math.max(peak, audio.activeCount('impact_bell'));
    await sleep(30);
  }
  return peak;
}

// ---------------------------------------------------------------- per-frame
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  if (orbit) {
    orbitT += dt;
    orbit.setPosition(new THREE.Vector3(Math.cos(orbitT * 0.8) * 8, 0, Math.sin(orbitT * 0.8) * 8));
    orbit.setPitch(1 + 0.3 * Math.sin(orbitT * 1.7));
  }
  audio.update(dt);
  const s = audio.stats();
  maxVoices = Math.max(maxVoices, s.voices);
  el('status').textContent = `ctx: ${s.ctx} · ready ${s.readyKeys}/${s.totalKeys} keys · jobs ${s.progress} · voices ${s.voices} (max ${maxVoices}) · synth worker: ${s.worker} · music: ${s.music ?? '-'}`;
  for (const [k, b] of buttons) {
    if (b.classList.contains('missing') && audio.isReady(k)) {
      b.classList.remove('missing');
      const small = document.createElement('small');
      small.textContent = `×${audio.getBuffers(k).length}`;
      b.appendChild(small);
    }
  }
}, 20);

// ---------------------------------------------------------------- analysis (autotest)
function analyze(b: AudioBuffer) {
  let peak = 0;
  let sum = 0;
  let loud = 0;
  const w = Math.max(1, Math.floor(b.sampleRate * 0.05));
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
    }
    for (let i = 0; i + w <= d.length; i += w >> 2) {
      let s = 0;
      for (let j = i; j < i + w; j++) s += d[j] * d[j];
      loud = Math.max(loud, Math.sqrt(s / w));
    }
    if (d.length < w) loud = Math.max(loud, Math.sqrt(sum / Math.max(1, d.length)));
  }
  const db = (x: number) => +(20 * Math.log10(x + 1e-9)).toFixed(1);
  return { dur: +b.duration.toFixed(3), ch: b.numberOfChannels, sr: b.sampleRate, peakDb: db(peak), rmsDb: db(Math.sqrt(sum / (b.length * b.numberOfChannels))), loudDb: db(loud), nan: !Number.isFinite(sum) };
}

async function analyzeMusic() {
  const out: { track: string; file: string; dur?: number; peakDb?: number; rmsDb?: number; error?: string }[] = [];
  const ctx = new OfflineAudioContext(2, 1, 44100);
  for (const [track, def] of Object.entries(MUSIC_BANK)) {
    for (const f of def.files) {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}assets/audio/music/${f.file}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        const a = analyze(buf);
        out.push({ track, file: f.file, dur: a.dur, peakDb: a.peakDb, rmsDb: +(a.rmsDb + 20 * Math.log10(f.gain)).toFixed(1) });
      } catch (e) {
        out.push({ track, file: f.file, error: String(e) });
      }
    }
  }
  return out;
}

function renderReport(rows: { key: string; n: number; vs: ReturnType<typeof analyze>[] }[]) {
  el('report-section').hidden = false;
  const tr = rows
    .map((r) => {
      const bad = r.n === 0 || r.vs.some((v) => v.peakDb < -40 || v.nan);
      const durs = r.vs.map((v) => v.dur);
      return `<tr class="${bad ? 'bad' : ''}"><td>${r.key}</td><td>${r.n}</td><td>${Math.min(...durs).toFixed(2)}–${Math.max(...durs).toFixed(2)} s</td><td>${Math.max(...r.vs.map((v) => v.peakDb))} dB</td><td>${Math.max(...r.vs.map((v) => v.loudDb))} dB</td><td>${[...new Set(r.vs.map((v) => `${v.ch}ch@${v.sr}`))].join(' ')}</td></tr>`;
    })
    .join('');
  el('report').innerHTML = `<table><tr><th>key</th><th>variants</th><th>duration</th><th>max peak</th><th>max loud(50ms)</th><th>format</th></tr>${tr}</table>`;
}

async function autotest() {
  const t0 = performance.now();
  await audio.unlock();
  await audio.load();
  const loadMs = Math.round(performance.now() - t0);
  const rows = audio.keys.map((key) => {
    const bufs = audio.getBuffers(key);
    return { key, n: bufs.length, vs: bufs.map(analyze) };
  });
  renderReport(rows);
  const problems: string[] = [];
  for (const r of rows) {
    if (r.n === 0) problems.push(`${r.key}: no variants loaded`);
    r.vs.forEach((v, i) => {
      if (v.nan) problems.push(`${r.key}#${i}: NaN`);
      if (v.peakDb < -40 || v.loudDb < -55) problems.push(`${r.key}#${i}: (near) silent (peak ${v.peakDb} dB)`);
      if (v.peakDb > 3) problems.push(`${r.key}#${i}: hot peak ${v.peakDb} dB`);
    });
  }

  // play every key once (half of them positional), loops briefly
  let played = 0;
  for (const [i, key] of audio.keys.entries()) {
    const def = SOUND_BANK[key];
    const opts = i % 2 ? { position: randomSpot(Math.min(30, (def.maxDist ?? 60) * 0.8)) } : {};
    let h = audio.play(key, opts);
    if (!h) {
      // may be legitimately rate-limited (e.g. just triggered as another key's layer): retry once
      await sleep(Math.max(150, (def.minGap ?? 0) * 1000 + 50));
      h = audio.play(key, opts);
    }
    if (h) played++;
    else problems.push(`${key}: play() returned null after load`);
    if (h && def.loop) setTimeout(() => h.stop(0.2), 300);
    await sleep(35);
  }
  // unknown keys must warn (once) but never throw
  audio.play('this_key_does_not_exist');
  audio.play('this_key_does_not_exist');
  // setters on handles never throw
  const h = audio.play('roll_loop', { position: new THREE.Vector3(2, 0, -2) });
  h?.setPitch(1.5);
  h?.setVolume(0.3);
  h?.setPosition(new THREE.Vector3(-4, 0, -1));
  await sleep(200);
  h?.stop();
  h?.stop();

  const stressPeak = await stress();
  const perKeyMax = SOUND_BANK.impact_bell.max ?? 4;
  if (stressPeak > perKeyMax) problems.push(`concurrency cap exceeded: ${stressPeak} > ${perKeyMax}`);

  // music: each theme for a moment
  const music: unknown[] = [];
  for (const t of Object.keys(MUSIC_BANK) as MusicTrack[]) {
    audio.playMusic(t, 0.3);
    await sleep(1400);
    music.push({ track: t, players: audio.musicDebug() });
  }
  audio.stopMusic(0.3);
  await sleep(500);
  const musicFiles = await analyzeMusic();
  for (const m of musicFiles) if (m.error) problems.push(`music ${m.file}: ${m.error}`);
  for (const m of music as { track: string; players: ReturnType<typeof audio.musicDebug> }[]) {
    const p = m.players.find((x) => x.track === m.track);
    if (!p || p.error != null || p.dead) problems.push(`music ${m.track}: not playing (${JSON.stringify(p)})`);
    else if (p.time <= 0) problems.push(`music ${m.track}: currentTime did not advance`);
  }

  const result = {
    done: true,
    loadMs,
    stats: audio.stats(),
    keys: rows.map((r) => ({ key: r.key, n: r.n, vs: r.vs })),
    played,
    stress: { peakVoices: stressPeak, perKeyMax },
    music,
    musicFiles,
    problems,
  };
  (window as unknown as { __audioTest: unknown }).__audioTest = result;
  console.info(`[audio-test] done: ${rows.length} keys, ${played} played, ${problems.length} problem(s), load ${loadMs} ms`);
}

build();
void audio.load();
if (auto) void autotest().catch((e) => ((window as unknown as { __audioTest: unknown }).__audioTest = { done: true, fatal: String(e?.stack ?? e) }));
