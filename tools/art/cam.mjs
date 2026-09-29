// Scripted camera shots (README marketing shots + close-up checks).
//   node tools/shots/art/cam.mjs views.json [--url http://127.0.0.1:5193/] [--size 1600x900] [--dpr 2] [--out docs/screenshots]
// views.json: [{ name, time?, weather?, player?: [x, z, facing], cam?: { p, t, fov }, orbit?: { yaw, pitch, dist },
//               js?: "code run with g (after teleport)", after?: "code run right before the shot", adv?: 1.2,
//               hud?: false, freeze?: true, fmt?: 'jpg'|'png', maxKB?: 250 }]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { arg, hideHud } from './lib.mjs';

const views = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = arg('url', 'http://127.0.0.1:5193/');
const [w, h] = arg('size', '1600x900').split('x').map(Number);
const dpr = Number(arg('dpr', '2'));
const outDir = arg('out', 'tools/shots/art/cam');
const quality = arg('quality', 'high');
const only = arg('only', '').split(',').filter(Boolean);
fs.mkdirSync(outDir, { recursive: true });

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
await page.goto(base + `?skipintro&time=13&weather=clear&quality=${quality}`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.jimothy && window.jimothy.state === 'playing' && window.jimothy.get('world'), null, { timeout: 120000 });
await page.waitForTimeout(4000);

for (const v of views) {
  if (only.length && !only.includes(v.name)) continue;
  await hideHud(page, !v.hud);
  const r = await page.evaluate(async (v) => {
    const g = window.jimothy;
    g.timeScale = 1;
    const env = g.get('environment');
    env.frozen = true;
    env.setTime(v.time ?? 13);
    const wx = g.get('weather');
    const kind = v.weather ?? 'clear';
    wx.forced = kind;
    if (wx.kind !== kind) wx.set(kind);
    wx.intensity = kind === 'rain' ? 1 : kind === 'drizzle' ? 0.45 : 0;
    const p = g.get('player');
    const w = g.get('world');
    const V = p.position.constructor;
    if (v.player) p.teleport(new V(v.player[0], (v.player[3] ?? w.heightAt(v.player[0], v.player[1])) + 0.8, v.player[1]), v.player[2] ?? 0);
    const cam = g.get('camera');
    cam.override = null;
    if (v.orbit) {
      cam.yaw = v.orbit.yaw;
      cam.pitch = v.orbit.pitch;
      cam.targetDistance = v.orbit.dist;
    }
    if (v.js) await new Function('g', 'p', 'V', v.js)(g, p, V);
    g.advance(v.adv ?? 1.2);
    if (v.cam) {
      cam.override = (c) => {
        const pp = typeof v.cam.p === 'string' ? new Function('g', 'p', v.cam.p)(g, p) : v.cam.p;
        const tt = typeof v.cam.t === 'string' ? new Function('g', 'p', v.cam.t)(g, p) : v.cam.t;
        c.position.set(pp[0], pp[1], pp[2]);
        c.lookAt(tt[0], tt[1], tt[2]);
        c.fov = v.cam.fov || 55;
        c.updateProjectionMatrix();
      };
    }
    if (v.after) await new Function('g', 'p', 'V', v.after)(g, p, V);
    g.advance(1 / 60);
    g.advance(1 / 60);
    if (v.freeze !== false) g.timeScale = 0;
    g.advance(1 / 60);
    return { perf: g.debug.perf(), pos: p.position.toArray().map((n) => +n.toFixed(2)) };
  }, v);
  await page.waitForTimeout(250);
  const fmt = v.fmt ?? 'jpg';
  const file = `${outDir}/${v.name}.${fmt}`;
  if (fmt === 'png') {
    await page.screenshot({ path: file, scale: 'css' });
  } else {
    const maxKB = v.maxKB ?? 250;
    let q = 86;
    for (;;) {
      await page.screenshot({ path: file, type: 'jpeg', quality: q, scale: 'css' });
      const kb = fs.statSync(file).size / 1024;
      if (kb <= maxKB || q <= 50) break;
      q -= 4;
    }
    console.log(v.name, `q=${q}`, Math.round(fs.statSync(file).size / 1024) + 'KB');
  }
  console.log(v.name, JSON.stringify({ calls: r.perf.drawCalls, tris: r.perf.triangles, pos: r.pos }));
  await page.evaluate(() => {
    window.jimothy.timeScale = 1;
  });
}
const filtered = logs.filter((l) => !/X4122|X3577|cannot be represented|isnan\(\)|toNonIndexed|GPU stall|Automatic fallback|GL_CLOSE_PATH/.test(l));
if (filtered.length) console.log(filtered.slice(0, 30).join('\n'));
await browser.close();
