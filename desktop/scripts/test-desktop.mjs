// End-to-end test of the desktop build.
//
//   node scripts/test-desktop.mjs            packaged build (dist/win-unpacked/Jimothy Simulator.exe)
//   node scripts/test-desktop.mjs --dev      unpackaged shell (desktop/node_modules/electron + desktop/)
//   options: --phases <letters> (default ABCD; B and C need A), --audible (don't pass --mute-audio),
//            --keep (keep the temp profile), --out <dir> (screenshots; default tools/shots/desktop/<packaged|dev>)
//
// The game runs in its test mode (JIMOTHY_TEST=1, see electron/main.cjs): the window is transparent, click-through,
// never focused and has no taskbar button, and fullscreen is simulated, so a test run never takes over the screen.
// Uses a throwaway profile (--user-data-dir), so it never touches a real save. Connects over the Chrome DevTools
// Protocol (--remote-debugging-port + playwright-core from the repo root; works with the hardened fuses, which
// disable --inspect). Three launches:
//   A  fresh profile: title (fullscreen by default, music without a click, WASM physics, Steam status, CSP), Play,
//      skip intro, Jimothy moves, fps / memory / CPU, achievement plumbing, settings change, photo save, blocked
//      navigation, pause menu > Quit game (process exits).
//   B  relaunch: the save file (as Steam Cloud would deliver it) wins; progress + settings persisted; the title's
//      Fullscreen button toggles the window (page state follows); window mode remembered; title screen Quit.
//   C  --no-steam --windowed, save file deleted: localStorage itself persisted; runs without Steam; navigation
//      away is blocked; in-game Reset progress isn't undone by the save mirror; window.close() saves and exits.
//   D  (--dev only) F11 / Alt+Enter via main-process key injection, minimise/restore (Playwright's Electron driver
//      needs --inspect, which the packaged build's fuses disable).
// Every launch fails on page errors / console errors (D3D shader-compiler warnings X3577/X4122 are ignored).
import { _electron, chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktopDir, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => (argv.indexOf('--' + n) >= 0 ? argv[argv.indexOf('--' + n) + 1] : d);
const DEV = flag('dev');
/** Which launches to run, in order on one profile (B and C need A's save): e.g. --phases D. */
const PHASES = String(opt('phases', 'ABCD')).toUpperCase();
/** Test mode in the shell: invisible, unfocusable window; fullscreen simulated (electron/main.cjs TEST_MODE). */
const TEST_ENV = { ...process.env, JIMOTHY_TEST: '1' };
const outDir = path.resolve(opt('out', path.join(root, 'tools', 'shots', 'desktop', DEV ? 'dev' : 'packaged')));
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jimothy-desktop-test-'));
const exe = DEV ? path.join(desktopDir, 'node_modules', 'electron', 'dist', 'electron.exe') : path.join(desktopDir, 'dist', 'win-unpacked', 'Jimothy Simulator.exe');
const baseArgs = DEV ? [desktopDir] : [];
if (!fs.existsSync(exe)) {
  console.error('missing', exe, DEV ? '(run: npm run build:web)' : '(run: npm run build:steam)');
  process.exit(1);
}

const IGNORED = /X4122|X3577|cannot be represented accurately|isnan\(\) may not be necessary/;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    if (Date.now() - t0 > ms) throw new Error(`timeout (${ms} ms) waiting for ${label}${last instanceof Error ? ': ' + last.message : ''}`);
    await sleep(200);
  }
}
const freePort = () =>
  new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
    s.on('error', rej);
  });
const killTree = (pid) => {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    /* already gone */
  }
};
const ps = (script) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });

/** Memory (working set) and CPU of the whole process tree over `secs`. */
function procStats(rootPid, secs = 5) {
  const script = `
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CommandLine
function Tree($id) { $id; foreach ($c in ($all | Where-Object { $_.ParentProcessId -eq $id })) { Tree $c.ProcessId } }
$ids = @(Tree ${rootPid})
$a = Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id, CPU
Start-Sleep -Seconds ${secs}
$b = Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id, CPU, WorkingSet64, PrivateMemorySize64
$types = $all | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object { if ($_.CommandLine -match '--type=([\\w-]+)') { $matches[1] } else { 'browser' } }
@{ a = $a; b = $b; types = $types; cores = [Environment]::ProcessorCount } | ConvertTo-Json -Depth 4 -Compress`;
  const j = JSON.parse(ps(script));
  const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  const cpuA = Object.fromEntries(arr(j.a).map((p) => [p.Id, p.CPU || 0]));
  let cpu = 0;
  let ws = 0;
  let priv = 0;
  for (const p of arr(j.b)) {
    cpu += (p.CPU || 0) - (cpuA[p.Id] || 0);
    ws += p.WorkingSet64 || 0;
    priv += p.PrivateMemorySize64 || 0;
  }
  return {
    processes: arr(j.types),
    workingSetMB: Math.round(ws / 1048576),
    privateMB: Math.round(priv / 1048576),
    cpuPercentOfOneCore: Math.round((cpu / secs) * 100),
    cores: j.cores,
  };
}

/** Start the game; resolves once its page has booted to the title screen. */
async function launch(name, extraArgs = []) {
  const port = await freePort();
  const args = [...baseArgs, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...(flag('audible') ? [] : ['--mute-audio']), ...extraArgs];
  const t0 = Date.now();
  const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], env: TEST_ENV });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const run = { name, child, port, output: () => output, exitCode: null, errors: [], warnings: [] };
  run.exited = new Promise((res) =>
    child.on('exit', (code) => {
      run.exitCode = code;
      res(code);
    }),
  );
  run.watchdog = setTimeout(() => {
    console.log(`[${name}] watchdog: killing the game`);
    killTree(child.pid);
  }, 240000);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 60000, 'DevTools endpoint');
  run.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  // Playwright takes over downloads when it attaches; hand them back to the app (its will-download handler).
  const cdp = await run.browser.newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {});
  run.page = await waitFor(() => run.browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('app://jimothy/')), 30000, 'game page');
  run.expected = []; // [regex] errors the test provokes on purpose (each excused once)
  run.page.on('console', (m) => {
    const t = m.text();
    if (IGNORED.test(t)) return;
    const i = m.type() === 'error' ? run.expected.findIndex((re) => re.test(t)) : -1;
    if (i >= 0) {
      run.expected.splice(i, 1);
      return;
    }
    if (m.type() === 'error') run.errors.push(t);
    else if (m.type() === 'warning') run.warnings.push(t);
  });
  run.page.on('pageerror', (e) => run.errors.push('[pageerror] ' + (e.stack || e.message)));
  await run.page.waitForFunction(() => window.jimothy && window.jimothy.state === 'title' && window.jimothy.get('player')?.model, null, { timeout: 120000 });
  run.bootMs = Date.now() - t0;
  await sleep(1500);
  return run;
}

async function finish(run, how) {
  const code = await Promise.race([run.exited, sleep(20000).then(() => 'timeout')]);
  clearTimeout(run.watchdog);
  check(`[${run.name}] game exits cleanly (${how})`, code === 0, `exit code ${code}`);
  if (code === 'timeout') killTree(run.child.pid);
  await run.browser.close().catch(() => {});
  check(`[${run.name}] no page errors`, run.errors.length === 0, run.errors.slice(0, 5).join(' | '));
  if (run.warnings.length) console.log(`      (${run.warnings.length} console warnings: ${run.warnings.slice(0, 3).join(' | ')})`);
}

const shot = async (run, file) => {
  const p = path.join(outDir, file);
  await run.page.screenshot({ path: p });
  console.log('      screenshot', path.relative(root, p));
  return p;
};
const evalPage = (run, fn, arg) => run.page.evaluate(fn, arg);
const saveFile = path.join(profile, 'save', 'jimothy-save.json');
const readSave = () => JSON.parse(fs.readFileSync(saveFile, 'utf8'));
/** Steam API name of the "Not A Cat" Instinct (the one the test completes). */
const NOT_A_CAT = JSON.parse(fs.readFileSync(path.join(desktopDir, 'achievements.json'), 'utf8')).achievements.find((a) => a.objective === 'notACat').apiName;

let photoCleanup = null;
const summary = { build: DEV ? 'dev' : 'packaged', exe: path.relative(root, exe) };
try {
  // ================================================================ A: fresh profile
  if (PHASES.includes('A')) {
    const run = await launch('A');
    summary.bootToTitleMs = run.bootMs;
    run.expected.push(/Executing inline script violates the following Content Security Policy/);
    const info = await evalPage(run, async () => {
      const g = window.jimothy;
      const d = window.jimothyDesktop;
      // CSP: an injected inline script must not run (DevTools' own evaluate is exempt from CSP, so test this way).
      let violation = '';
      document.addEventListener('securitypolicyviolation', (e) => (violation = e.violatedDirective), { once: true });
      const s = document.createElement('script');
      s.textContent = 'window.__inlineRan = true';
      document.head.append(s);
      await new Promise((r) => setTimeout(r, 100));
      const cspBlocksInline = !window.__inlineRan && !!violation;
      const hit = g.physics.raycast(g.get('player').position.clone().setY(80), { x: 0, y: -1, z: 0 }, 200);
      return {
        bridge: !!d,
        packaged: d?.packaged,
        title: document.title,
        fullscreen: d?.isFullscreen(),
        viewport: [innerWidth, innerHeight],
        screen: [screen.width, screen.height],
        audio: g.get('audio')?.manager?.ctx?.state ?? null,
        rapierRay: !!hit,
        steam: d ? await d.steam.status() : null,
        quitOnTitle: [...document.querySelectorAll('.title-row button')].some((b) => /quit/i.test(b.textContent || '')),
        cspBlocksInline,
        violation,
        origin: location.origin,
      };
    });
    console.log('      ', JSON.stringify(info));
    check('[A] desktop bridge present', info.bridge && info.packaged === !DEV);
    check('[A] served from app://jimothy', info.origin === 'app://jimothy', info.origin);
    check('[A] window title', info.title === 'Jimothy Simulator');
    check('[A] starts in fullscreen mode (simulated in test mode)', info.fullscreen === true, `page viewport ${info.viewport}`);
    check('[A] audio running without a click (autoplay policy)', info.audio === 'running', String(info.audio));
    check('[A] Rapier WASM physics works (raycast hits the ground)', info.rapierRay);
    check('[A] Content-Security-Policy enforced (inline script blocked)', info.cspBlocksInline, info.violation);
    check('[A] Quit button on the title screen', info.quitOnTitle);
    summary.steam = info.steam;
    check('[A] Steam status reported', info.steam && typeof info.steam.available === 'boolean', info.steam?.available ? `app ${info.steam.appId}, overlay ${info.steam.overlay}` : String(info.steam?.error));
    await shot(run, 'A1_title.png');

    // Play → (first time) intro → Esc skips it
    await run.page.click('.btn-play');
    await sleep(1500);
    const mode = await evalPage(run, () => window.jimothy.get('ui').mode);
    if (mode === 'intro') {
      await shot(run, 'A2_intro.png');
      await run.page.keyboard.press('Escape');
    }
    await waitFor(() => evalPage(run, () => window.jimothy.state === 'playing' && window.jimothy.get('ui').mode === 'play'), 20000, 'gameplay');
    check('[A] Play starts the game', true, `intro shown: ${mode === 'intro'}`);
    await sleep(1500);

    // Walk / sprint forward for 2.5 s of real time
    const before = await evalPage(run, () => window.jimothy.get('player').position.toArray());
    await evalPage(run, () => {
      const v = window.jimothy.input.virtual;
      v.move.set(0, 1);
      v.buttons.add('sprint');
    });
    await sleep(2500);
    const after = await evalPage(run, () => {
      const g = window.jimothy;
      g.input.virtual.move.set(0, 0);
      g.input.virtual.buttons.delete('sprint');
      return g.get('player').position.toArray();
    });
    const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
    check('[A] Jimothy moves (input → physics → render)', moved > 2, `${moved.toFixed(1)} m in 2.5 s`);
    await shot(run, 'A3_gameplay.png');

    // Frame rate (game's own counter, sampled for ~6 s) + process tree memory / CPU
    const fpsSamples = [];
    for (let i = 0; i < 12; i++) {
      fpsSamples.push(await evalPage(run, () => window.jimothy.fps));
      await sleep(500);
    }
    const fpsAvg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
    const quality = await evalPage(run, () => window.jimothy.renderer.quality);
    const stats = procStats(run.child.pid, 5);
    summary.fps = { avg: Math.round(fpsAvg), min: Math.round(Math.min(...fpsSamples)), quality };
    summary.process = stats;
    check('[A] frame rate ≥ 50 fps (vsync-limited)', fpsAvg >= 50, `avg ${fpsAvg.toFixed(1)}, min ${Math.min(...fpsSamples).toFixed(1)} (quality ${quality})`);
    check('[A] memory / CPU sane', stats.workingSetMB < 2500, `${stats.workingSetMB} MB working set, ${stats.cpuPercentOfOneCore}% of one core (${stats.cores} cores), processes: ${stats.processes.join(', ')}`);

    // Achievement plumbing: complete an Instinct (→ 'objective' event → main → steam), and the direct bridge call
    const ach = await evalPage(
      run,
      async (api) => {
        const g = window.jimothy;
        g.get('objectives').complete('notACat');
        const s = window.jimothyDesktop.steam;
        return { api, direct: await s.unlockAchievement(api), isUnlocked: await s.isAchievementUnlocked(api) };
      },
      NOT_A_CAT,
    );
    check('[A] achievement bridge answers (false is expected under test app 480)', typeof ach.direct === 'boolean', JSON.stringify(ach));
    const objIds = await evalPage(run, () => window.jimothy.get('objectives').list.map((o) => o.id));
    const table = JSON.parse(fs.readFileSync(path.join(desktopDir, 'achievements.json'), 'utf8')).achievements;
    const mapped = new Set(table.flatMap((a) => [a.objective, ...(a.aliases || [])]));
    const unmapped = objIds.filter((id) => !mapped.has(id));
    check('[A] every Instinct in the game has a Steam achievement mapping', unmapped.length === 0, `${objIds.length} Instincts${unmapped.length ? '; unmapped: ' + unmapped.join(', ') : ''}`);

    // Settings change (persists via localStorage + the save mirror)
    await evalPage(run, () => {
      const ui = window.jimothy.get('ui');
      ui.settings.master = 0.55;
      ui.commitSettings('master');
      ui.settings.showFps = true;
      ui.commitSettings('showFps');
    });

    // Photo mode → Save photo → Pictures\Jimothy Simulator (then the test deletes its photo again)
    const picturesDir = ps('[Environment]::GetFolderPath("MyPictures")').trim();
    const photoDir = path.join(picturesDir, 'Jimothy Simulator');
    const photoDirExisted = fs.existsSync(photoDir);
    const beforePhotos = new Set(photoDirExisted ? fs.readdirSync(photoDir) : []);
    await evalPage(run, () => {
      const pm = window.jimothy.get('photomode');
      pm.enter();
    });
    await sleep(600);
    await evalPage(run, () => window.jimothy.get('photomode').snap());
    await sleep(800);
    await shot(run, 'A4_photo.png');
    // (a DOM click: Playwright's click would wait for a "navigation" that a download never finishes)
    await evalPage(run, () => document.querySelector('[data-act="save"]').click());
    const newPhoto = await waitFor(() => fs.existsSync(photoDir) && fs.readdirSync(photoDir).find((f) => !beforePhotos.has(f) && f.endsWith('.jpg')), 10000, 'saved photo').catch(() => null);
    const confirmed = await waitFor(() => evalPage(run, () => document.querySelector('[data-act="save"]')?.textContent?.includes('Saved')), 5000, 'photo confirmation').catch(() => false);
    if (confirmed) await shot(run, 'A4b_photo_saved.png');
    check('[A] photo saved to Pictures\\Jimothy Simulator (no dialog), confirmed on the card', !!newPhoto && confirmed, newPhoto ? `${newPhoto} (${fs.statSync(path.join(photoDir, newPhoto)).size} bytes)` : 'no file');
    photoCleanup = () => {
      if (newPhoto) fs.rmSync(path.join(photoDir, newPhoto), { force: true });
      if (!photoDirExisted && fs.existsSync(photoDir) && fs.readdirSync(photoDir).length === 0) fs.rmdirSync(photoDir);
    };
    await evalPage(run, () => {
      document.querySelector('[data-act="close"]')?.click();
      window.jimothy.get('photomode').exit();
    });
    await sleep(500);

    // Pause menu (Esc) → Quit game
    await run.page.keyboard.press('Escape');
    await sleep(700);
    let paused = await evalPage(run, () => window.jimothy.get('ui').mode === 'pause');
    if (!paused) {
      await evalPage(run, () => window.jimothy.get('ui').openPause());
      await sleep(500);
      paused = await evalPage(run, () => window.jimothy.get('ui').mode === 'pause');
    }
    check('[A] Esc opens the pause menu', paused);
    await shot(run, 'A5_pause.png');
    const quitBtn = run.page.locator('.pause-small button', { hasText: 'Quit game' });
    check('[A] Quit game button in the pause menu', (await quitBtn.count()) === 1);
    await quitBtn.click();
    await finish(run, 'pause menu > Quit game');

    let save = null;
    try {
      save = readSave();
    } catch {
      /* missing */
    }
    const settingsA = save && JSON.parse(save.data['jimothy.settings.v1'] || '{}');
    const objA = save && JSON.parse(save.data['jimothy.objectives.v1'] || '{}');
    check('[A] save file written on quit (Steam Cloud mirror)', !!save && settingsA.master === 0.55 && objA.notACat?.d === true, save ? `${Object.keys(save.data).length} keys` : 'missing');
    const logText = fs.readFileSync(path.join(profile, 'logs', 'desktop.log'), 'utf8');
    check('[A] desktop.log written', logText.includes('quit requested by the game'));
    const gpuLine = logText.split('\n').find((l) => l.includes('GPU: {'));
    let gpu = null;
    try {
      gpu = JSON.parse(gpuLine.slice(gpuLine.indexOf('{')));
    } catch {
      /* missing */
    }
    summary.gpu = gpu;
    check('[A] hardware-accelerated WebGL (GPU feature status)', gpu && /^enabled/.test(gpu.features?.webgl ?? '') && /^enabled/.test(gpu.features?.gpu_compositing ?? ''), gpu ? `webgl ${gpu.features.webgl}, compositing ${gpu.features.gpu_compositing}, GPU ${gpu.vendor}:${gpu.device}` : 'no GPU line');
    summary.logExcerpt = logText.split('\n').filter((l) => /\[steam\]|\[save\]/.test(l)).slice(0, 8);
  }

  // ================================================================ B: relaunch; the save file wins (needs A)
  if (PHASES.includes('B')) {
    // Simulate Steam Cloud delivering a newer save: change a value only in the file.
    const save = readSave();
    const s = JSON.parse(save.data['jimothy.settings.v1']);
    s.master = 0.65;
    save.data['jimothy.settings.v1'] = JSON.stringify(s);
    fs.writeFileSync(saveFile, JSON.stringify(save));

    const run = await launch('B');
    const st = await evalPage(run, () => {
      const g = window.jimothy;
      const ui = g.get('ui');
      return {
        master: ui.settings.master,
        showFps: ui.settings.showFps,
        notACat: g.get('objectives').isDone('notACat'),
        introSeen: ui.introSeen,
        fullscreen: window.jimothyDesktop.isFullscreen(),
      };
    });
    check('[B] progress persisted across restart (Instinct done, intro seen)', st.notACat && st.introSeen, JSON.stringify(st));
    check('[B] settings persisted; save file (cloud copy) wins over the local copy', st.master === 0.65 && st.showFps === true, `master ${st.master}`);
    check('[B] still fullscreen (remembered)', st.fullscreen);
    await shot(run, 'B1_title_again.png');

    // The title screen's Fullscreen button (ui/fullscreen.ts → bridge → BrowserWindow): off, on, off again. The
    // page's state must follow the real window. (F11 / Alt+Enter are main-process shortcuts that DevTools input
    // can't reach; the --dev run covers them.)
    const windowed = () => evalPage(run, () => !window.jimothyDesktop.isFullscreen());
    const full = () => evalPage(run, () => window.jimothyDesktop.isFullscreen());
    const fsBtn = run.page.locator('.title-row .btn-icon-only');
    await fsBtn.click();
    const off = await waitFor(windowed, 5000, 'button → windowed').catch(() => false);
    await sleep(800);
    await shot(run, 'B2_windowed.png');
    await fsBtn.click();
    const on = await waitFor(full, 5000, 'button → fullscreen').catch(() => false);
    await sleep(500);
    await fsBtn.click();
    const off2 = await waitFor(windowed, 5000, 'button → windowed again').catch(() => false);
    const label = await fsBtn.getAttribute('aria-label');
    check('[B] Fullscreen button toggles the window; page state follows', off && on && off2 && label === 'Fullscreen', `off ${off}, on ${on}, off ${off2}, button "${label}"`);
    await sleep(500);

    // Instincts completed earlier are synced to Steam a few seconds after boot (under app 480 the unlock fails, but
    // the attempt is logged).
    if (summary.steam?.available) {
      const synced = await waitFor(() => fs.readFileSync(path.join(profile, 'logs', 'desktop.log'), 'utf8').includes(NOT_A_CAT), 10000, 'achievement sync').catch(() => false);
      check('[B] completed Instincts re-synced to Steam on boot', synced);
    }

    const q = run.page.locator('.title-row button', { hasText: 'Quit' });
    await q.click();
    await finish(run, 'title screen Quit');
    const ws = JSON.parse(fs.readFileSync(path.join(profile, 'window-state.json'), 'utf8'));
    check('[B] window mode remembered (windowed after toggling off)', ws.fullscreen === false, JSON.stringify(ws));
  }

  // ================================================================ C: no Steam, windowed, no save file (needs A)
  if (PHASES.includes('C')) {
    fs.rmSync(saveFile, { force: true });
    const run = await launch('C', ['--no-steam', '--windowed']);
    const st = await evalPage(run, async (api) => {
      const g = window.jimothy;
      const d = window.jimothyDesktop;
      return {
        steam: d.steam.available,
        unlock: await d.steam.unlockAchievement(api),
        master: g.get('ui').settings.master,
        notACat: g.get('objectives').isDone('notACat'),
        fullscreen: d.isFullscreen(),
        viewport: [innerWidth, innerHeight],
      };
    }, NOT_A_CAT);
    check('[C] runs without Steam (graceful)', st.steam === false && st.unlock === false, JSON.stringify(st));
    check('[C] localStorage itself persisted (save file deleted)', st.master === 0.65 && st.notACat);
    check('[C] --windowed starts in a window', st.fullscreen === false);
    await shot(run, 'C1_no_steam_windowed.png');
    await run.page.click('.btn-play');
    await sleep(1200);
    await waitFor(() => evalPage(run, () => window.jimothy.state === 'playing'), 15000, 'gameplay (C)');
    // Navigation away from the game is blocked; window.open never opens a window. (Last: a cancelled navigation
    // leaves Playwright waiting for it on later clicks.)
    const nav = await evalPage(run, async () => {
      const w = window.open('ftp://example.invalid/');
      try {
        location.assign('ftp://example.invalid/');
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 800));
      return { opened: !!w, href: location.href, state: window.jimothy.state };
    });
    const pagesNow = run.browser.contexts().flatMap((c) => c.pages()).length;
    check('[C] external navigation blocked (no new window, game keeps running)', !nav.opened && nav.href.startsWith('app://jimothy/') && pagesNow === 1, JSON.stringify(nav));

    // In-game "Reset progress" (clears the keys, then reloads): the save mirror must not bring the progress back.
    await evalPage(run, () => window.jimothy.get('ui').resetProgress());
    await sleep(1000);
    await run.page.waitForFunction(() => window.jimothy && window.jimothy.state === 'title' && window.jimothy.get('player')?.model, null, { timeout: 120000 });
    const afterReset = await evalPage(run, () => ({ notACat: window.jimothy.get('objectives').isDone('notACat'), master: window.jimothy.get('ui').settings.master }));
    check('[C] Reset progress sticks after its reload (settings kept)', afterReset.notACat === false && afterReset.master === 0.65, JSON.stringify(afterReset));

    await evalPage(run, () => window.close());
    await finish(run, 'window closed (like Alt+F4)');
    let saveC = null;
    try {
      saveC = readSave();
    } catch {
      /* missing */
    }
    const objC = saveC && JSON.parse(saveC.data['jimothy.objectives.v1'] || '{}');
    check('[C] window close writes the save file (with the reset progress)', !!saveC && !objC?.notACat?.d, saveC ? `${Object.keys(saveC.data).length} keys` : 'missing');
  }

  // ================================================================ D (--dev only): F11 / Alt+Enter
  // Main-process key injection (webContents.sendInputEvent) goes through before-input-event like real keys; it
  // needs Playwright's Electron driver, i.e. --inspect, which the packaged build's fuses disable.
  if (DEV && PHASES.includes('D')) {
    const app = await _electron.launch({ executablePath: exe, args: [...baseArgs, `--user-data-dir=${profile}`, '--mute-audio', '--no-steam'], env: TEST_ENV, timeout: 60000 });
    const watchdog = setTimeout(() => killTree(app.process().pid), 120000);
    try {
      const page = await app.firstWindow();
      await page.waitForFunction(() => window.jimothy && window.jimothy.state === 'title', null, { timeout: 90000 });
      const key = (keyCode, modifiers = []) =>
        app.evaluate(({ BrowserWindow }, [k, m]) => {
          const wc = BrowserWindow.getAllWindows()[0].webContents;
          wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m });
          wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m });
        }, [keyCode, modifiers]);
      // (Test mode simulates fullscreen: the page state toggles while the real window stays invisible.)
      const state = async () => ({
        page: await page.evaluate(() => window.jimothyDesktop.isFullscreen()),
        window: await app.evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows()[0];
          return { fullscreen: w.isFullScreen(), opacity: w.getOpacity(), focusable: w.isFocusable(), focused: w.isFocused() };
        }),
      });
      await page.evaluate(() => {
        window.__keys = [];
        addEventListener('keydown', (e) => window.__keys.push(e.code), true);
      });
      const s0 = await state();
      await key('F11');
      await sleep(1200);
      const s1 = await state();
      await key('Enter', ['alt']);
      await sleep(1200);
      const s2 = await state();
      const seen = await page.evaluate(() => window.__keys);
      check('[D] F11 and Alt+Enter toggle fullscreen (page state follows); keys not passed to the game', s1.page !== s0.page && s2.page === s0.page && !seen.includes('F11') && !seen.includes('Enter'), JSON.stringify({ s0: s0.page, s1: s1.page, s2: s2.page, seen }));
      const ws = [s0, s1, s2].map((s) => s.window);
      check('[D] test window stays invisible: transparent, unfocusable, never focused or fullscreen', ws.every((w) => w.opacity === 0 && !w.focusable && !w.focused && !w.fullscreen), JSON.stringify(ws[0]));

      // Minimised: no frames drawn and the game muted; restored: drawing and audible again.
      const frames = async () => ({
        ...(await page.evaluate(async () => {
          const f0 = window.jimothy.frame;
          await new Promise((r) => setTimeout(r, 1000));
          return { frames: window.jimothy.frame - f0 };
        })),
        muted: await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isAudioMuted()),
      });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
      await sleep(1200);
      const min = await frames();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
      await sleep(1200);
      const back = await frames();
      check('[D] minimised: no rendering, muted; restored: rendering, unmuted', min.frames < 5 && min.muted && back.frames > 30 && !back.muted, JSON.stringify({ min, back }));
      await page.evaluate(() => window.jimothyDesktop.quit());
      const code = await Promise.race([new Promise((r) => app.process().once('exit', r)), sleep(15000).then(() => 'timeout')]);
      check('[D] quits cleanly', code !== 'timeout', String(code));
    } finally {
      clearTimeout(watchdog);
      await app.close().catch(() => {});
    }
  }
} catch (err) {
  check('test run', false, err.stack || err.message);
} finally {
  try {
    photoCleanup?.();
  } catch {
    /* ignore */
  }
  // Nothing of ours may survive the test: processes of this exe that use this test's profile.
  const leftovers = ps(
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe.replace(/'/g, "''")}' -and $_.CommandLine -like '*${path.basename(profile)}*' } | Select-Object -ExpandProperty ProcessId`,
  )
    .split(/\s+/)
    .filter(Boolean);
  for (const pid of leftovers) killTree(pid);
  check('no game processes left running', leftovers.length === 0, leftovers.length ? `killed ${leftovers.join(', ')}` : '');
  if (!flag('keep')) fs.rmSync(profile, { recursive: true, force: true });
  else console.log('profile kept:', profile);
}

const failed = results.filter((r) => !r.ok);
summary.passed = results.length - failed.length;
summary.failed = failed.length;
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ summary, results }, null, 2));
console.log(`\n${failed.length ? 'FAILED' : 'ALL PASSED'}: ${summary.passed}/${results.length} checks — ${path.relative(root, path.join(outDir, 'report.json'))}`);
process.exit(failed.length ? 1 : 0);
