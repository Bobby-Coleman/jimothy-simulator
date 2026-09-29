// Monkey/soak test: random inputs + teleports for N simulated minutes; reports errors, NaNs, softlocks.
//   node tools/soak.mjs [--url http://127.0.0.1:5199/] [--minutes 6] [--seed 1]
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const base = opt('url', 'http://127.0.0.1:5199/');
const minutes = Number(opt('minutes', '6'));
const seed = Number(opt('seed', '1'));

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')));
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /NaN|respawn|failed/i.test(m.text()))) errors.push(`[${m.type()}] ` + m.text().slice(0, 300)); });
await page.goto(base + `?skipintro&time=10&weather=clear`);
await page.waitForFunction(() => window.jimothy && window.jimothy.state === 'playing', null, { timeout: 120000 });
await page.waitForTimeout(4000);

const chunks = Math.round(minutes * 6); // 10 s chunks
let report = [];
for (let c = 0; c < chunks; c++) {
  const r = await page.evaluate(({ c, seed }) => {
    const g = window.jimothy; const p = g.get('player'); const V = p.position.constructor; const w = g.get('world');
    let s = (seed * 9301 + c * 49297) % 233280;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const acts = ['jump', 'grab', 'bonk', 'wash', 'roll', 'flop', 'chitter', 'sprint'];
    // every 3rd chunk teleport somewhere random on the map (sometimes to a POI)
    if (c % 3 === 0) {
      const pois = [...w.poi.values()];
      const target = rnd() < 0.5 && pois.length ? pois[Math.floor(rnd() * pois.length)] : new V((rnd() * 2 - 1) * 170, 0, (rnd() * 2 - 1) * 160);
      p.teleport(new V(target.x, w.heightAt(target.x, target.z) + 2, target.z), rnd() * 6.28);
    }
    if (rnd() < 0.08) g.get('environment').setTime(rnd() * 24);
    if (rnd() < 0.05) { const m = g.get('mutators'); m.allUnlocked = true; const list = m.list; const mm = list[Math.floor(rnd() * list.length)]; m.toggle(mm.id); }
    const t0 = performance.now();
    let nan = 0, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < 40; i++) { // 40 × 0.25 s = 10 s
      g.input.virtual.move.set(rnd() * 2 - 1, rnd() * 2 - 0.6);
      g.input.virtual.look.set((rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.1);
      const a = acts[Math.floor(rnd() * acts.length)];
      const hold = rnd() < 0.3;
      g.input.virtual.buttons.add(a);
      g.advance(hold ? 0.25 : 1 / 60);
      g.input.virtual.buttons.delete(a);
      if (!hold) g.advance(0.25 - 1 / 60);
      const q = p.position;
      if (!Number.isFinite(q.x + q.y + q.z)) nan++;
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
      // close any dialog that popped up so the monkey doesn't stall
      const ui = g.get('ui'); if (ui?.dialog?.open) ui.dialog.close?.();
      if (g.state === 'paused') ui?.resume?.();
    }
    g.input.virtual.move.set(0, 0);
    return { c, ms: Math.round(performance.now() - t0), mode: p.mode, state: g.state, nan, minY: +minY.toFixed(1), maxY: +maxY.toFixed(1), score: g.get('score').total, fps: Math.round(g.fps), entities: g.entities.list.length, bodies: g.physics.world.bodies.len() };
  }, { c, seed });
  report.push(r);
  if (c % 6 === 5 || r.nan) console.log(JSON.stringify(r));
}
await page.screenshot({ path: 'tools/shots/soak_end.png' });
const o = await page.evaluate(() => window.jimothy.get('objectives').list.filter((x) => x.done).map((x) => x.id));
console.log('objectives done during soak:', o.length, o.join(','));
console.log('errors:', errors.length);
for (const e of [...new Set(errors)].slice(0, 20)) console.log(' ', e);
await browser.close();
