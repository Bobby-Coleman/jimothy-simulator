// Night finale fireworks shots: plays the finale (replay) and grabs frames from its own cinematic camera.
//   node tools/shots/art/finale.mjs [--url http://127.0.0.1:5193/] [--dpr 2] [--out tools/shots/art/finale] [--at 12.4,13.4,15]
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { arg, hideHud } from './lib.mjs';

const base = arg('url', 'http://127.0.0.1:5193/');
const dpr = Number(arg('dpr', '2'));
const outDir = arg('out', 'tools/shots/art/finale');
const at = arg('at', '11.6,12.4,13.4,14.4,15.2,16.2').split(',').map(Number);
const pull = Number(arg('pull', '0'));
const up = Number(arg('up', '0'));
const down = Number(arg('down', '0'));
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('[error] ' + m.text().slice(0, 240));
});
await page.goto(base + '?skipintro&time=22.5&weather=clear&quality=high', { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.jimothy && window.jimothy.state === 'playing' && window.jimothy.get('world'), null, { timeout: 120000 });
await page.waitForTimeout(3000);
await hideHud(page, true);
console.log(
  await page.evaluate(() => {
    const g = window.jimothy;
    const X = g.get('extras');
    const ok = X.finale.start({ replay: true });
    let t = 0;
    while (X.finale.phase !== 'scene' && t < 20) {
      g.advance(1 / 30);
      t += 1 / 30;
    }
    return { ok, phase: X.finale.phase, t };
  }),
);
for (const st of at) {
  const r = await page.evaluate(([st, ARGS]) => {
    const g = window.jimothy;
    const F = g.get('extras').finale;
    const cam = g.get('camera');
    if (window.__origOverride) { cam.override = window.__origOverride; window.__origOverride = null; }
    g.timeScale = 1;
    let t = 0;
    while (F.phase === 'scene' && F['st'] < st && t < 60) {
      g.advance(1 / 30);
      t += 1 / 30;
    }
    g.timeScale = 0;
    const orig = cam.override;
    window.__origOverride = orig;
    if (orig && (ARGS.pull || ARGS.up || ARGS.down)) {
      cam.override = (c, dt) => {
        orig(c, dt);
        const V = c.position.constructor;
        const fwd = new V(0, 0, -1).applyQuaternion(c.quaternion);
        c.position.addScaledVector(fwd, -ARGS.pull);
        c.position.y += ARGS.up;
        const tgt = c.position.clone().addScaledVector(fwd, 10);
        tgt.y -= ARGS.down;
        c.lookAt(tgt);
      };
    }
    g.advance(1 / 60);
    g.advance(1 / 60);
    return { phase: F.phase, st: +F['st'].toFixed(2) };
  }, [st, { pull, up, down }]);
  await page.waitForTimeout(200);
  const file = `${outDir}/finale_${st}.jpg`;
  let q = 86;
  for (;;) {
    await page.screenshot({ path: file, type: 'jpeg', quality: q, scale: 'css' });
    if (fs.statSync(file).size / 1024 <= 250 || q <= 50) break;
    q -= 4;
  }
  console.log(st, JSON.stringify(r), `q=${q}`, Math.round(fs.statSync(file).size / 1024) + 'KB');
}
if (errs.length) console.log(errs.slice(0, 10).join('\n'));
await browser.close();
