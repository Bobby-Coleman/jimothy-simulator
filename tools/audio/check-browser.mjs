#!/usr/bin/env node
/**
 * End-to-end audio check in headless Chrome: loads /audio-test.html?autotest, which unlocks the
 * AudioManager, loads every sound (files + worker-synthesized), analyses all buffers
 * (duration / peak / RMS), plays every key, stress-tests the concurrency caps and plays each
 * music theme. Fails (exit 1) on console errors, page errors, failed requests or reported problems.
 *
 *   node tools/audio/check-browser.mjs                         # starts its own Vite on :5190
 *   node tools/audio/check-browser.mjs --url http://127.0.0.1:5173   # reuse a running dev server
 *   node tools/audio/check-browser.mjs --verbose               # per-key table
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright-core');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const urlIdx = args.indexOf('--url');
let base = urlIdx >= 0 ? args[urlIdx + 1].replace(/\/$/, '') : null;
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let server = null;
if (!base) {
  const { createServer } = await import('vite');
  for (const port of [5190, 5191, 5192, 5193]) {
    try {
      server = await createServer({
        root,
        logLevel: 'error',
        cacheDir: path.join(root, 'node_modules/.vite-audio-check'), // don't disturb the shared dev server's cache
        server: { port, strictPort: true, host: '127.0.0.1', hmr: false },
      });
      await server.listen();
      base = `http://127.0.0.1:${port}`;
      break;
    } catch (e) {
      await server?.close().catch(() => {});
      server = null;
      if (!/port|EADDRINUSE|in use/i.test(String(e?.message ?? e))) throw e;
    }
  }
  if (!base) throw new Error('no free port for the Vite check server');
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();
const consoleErrors = [];
const consoleWarnings = [];
const failedRequests = [];
page.on('console', (m) => {
  const t = m.type();
  const where = m.location()?.url ? ` [${m.location().url}]` : '';
  if (t === 'error') consoleErrors.push(m.text() + where);
  else if (t === 'warning') consoleWarnings.push(m.text() + where);
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  const err = r.failure()?.errorText ?? '';
  // <audio> streams get their range requests aborted when paused / switched: expected, not an error.
  if (err.includes('ERR_ABORTED') && r.url().includes('/assets/audio/music/')) return;
  failedRequests.push(`${r.url()} (${err})`);
});
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.url()} -> HTTP ${r.status()}`);
});

let result = null;
let exitCode = 0;
try {
  const t0 = Date.now();
  await page.goto(`${base}/audio-test.html?autotest`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__audioTest?.done === true, null, { timeout: 180000, polling: 250 });
  result = await page.evaluate(() => window.__audioTest);
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  if (result.fatal) throw new Error(`autotest crashed: ${result.fatal}`);

  const variants = result.keys.reduce((a, k) => a + k.n, 0);
  console.log(`audio-test (${base}) finished in ${wall}s`);
  console.log(`  context: ${result.stats.ctx}, synth worker: ${result.stats.worker}, load time: ${result.loadMs} ms`);
  console.log(`  keys ready: ${result.stats.readyKeys}/${result.stats.totalKeys} (${variants} variations), played ${result.played}`);
  console.log(`  stress: peak ${result.stress.peakVoices} simultaneous impact_bell voices (cap ${result.stress.perKeyMax})`);
  for (const m of result.music) {
    const p = m.players.find((x) => x.track === m.track);
    console.log(`  music ${m.track.padEnd(5)}: ${p ? `${p.file} t=${p.time}s paused=${p.paused} readyState=${p.readyState} fade=${p.fade}` : 'no player'}`);
  }
  for (const f of result.musicFiles) {
    console.log(`  music file ${f.file.padEnd(28)} ${f.error ? 'ERROR ' + f.error : `${String(f.dur).padStart(7)} s  peak ${f.peakDb} dB  rms(after gain) ${f.rmsDb} dB`}`);
  }
  if (verbose) {
    console.log('\n  key                  n   duration(s)     peak(dB)  loud50(dB)');
    for (const k of result.keys) {
      const d = k.vs.map((v) => v.dur);
      console.log(
        `  ${k.key.padEnd(20)} ${String(k.n).padStart(2)}   ${Math.min(...d).toFixed(2)}-${Math.max(...d).toFixed(2)}`.padEnd(44) +
          `${Math.max(...k.vs.map((v) => v.peakDb)).toFixed(1).padStart(6)}   ${Math.max(...k.vs.map((v) => v.loudDb)).toFixed(1).padStart(6)}`,
      );
    }
  }
  // Warnings we expect from the test itself (unknown-key probe).
  const unexpectedWarnings = consoleWarnings.filter((w) => !w.includes('this_key_does_not_exist'));
  const expectedWarned = consoleWarnings.filter((w) => w.includes('this_key_does_not_exist')).length;
  console.log(`  unknown-key probe: warned ${expectedWarned}x for 2 calls (expected 1)`);
  if (expectedWarned !== 1) result.problems.push(`unknown key warned ${expectedWarned} times (expected exactly once)`);
  if (result.problems.length) {
    console.log(`\nPROBLEMS (${result.problems.length}):`);
    for (const p of result.problems) console.log('  - ' + p);
    exitCode = 1;
  }
  if (unexpectedWarnings.length) {
    console.log(`\nConsole warnings (${unexpectedWarnings.length}):`);
    for (const w of unexpectedWarnings) console.log('  - ' + w.slice(0, 300));
  }
  if (consoleErrors.length || failedRequests.length) {
    console.log(`\nConsole errors (${consoleErrors.length}) / failed requests (${failedRequests.length}):`);
    for (const e of [...consoleErrors, ...failedRequests]) console.log('  - ' + e.slice(0, 300));
    exitCode = 1;
  }
  console.log(exitCode ? '\nFAIL' : '\nPASS: no console errors, every key loaded and played, caps held, music streamed.');
} catch (e) {
  console.error('check-browser failed:', e?.stack ?? e);
  for (const x of [...consoleErrors, ...failedRequests]) console.error('  - ' + x.slice(0, 300));
  exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  await server?.close().catch(() => {});
}
process.exit(exitCode);
