// Automated gameplay regression test. Drives the real game through scripted scenarios and reports.
//
//   npx vite build --outDir tools/_downloads/build_test --emptyOutDir
//   npx vite preview --outDir tools/_downloads/build_test --port 5199 --strictPort   (background)
//   node tools/playtest.mjs [--url http://127.0.0.1:5199/] [--only name,name]
//
// Each scenario runs in page context with helpers; failures don't stop the run.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const base = opt('url', 'http://127.0.0.1:5199/');
const only = opt('only', '')
  .split(',')
  .filter(Boolean);

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[error] ' + m.text().slice(0, 300));
});
await page.goto(base + '?skipintro&time=12&weather=clear');
await page.waitForFunction(() => window.jimothy && window.jimothy.state === 'playing', null, { timeout: 120000 });
await page.waitForTimeout(4000);

// Install helpers in the page
await page.evaluate(() => {
  const g = window.jimothy;
  const p = g.get('player');
  const V = p.position.constructor;
  const w = g.get('world');
  const events = [];
  const origEmit = g.events.emit.bind(g.events);
  g.events.emit = (name, payload) => {
    events.push(name);
    return origEmit(name, payload);
  };
  window.T = {
    g, p, V, w, events,
    step: (s) => g.advance(s),
    press(a) {
      g.input.virtual.buttons.add(a);
      g.advance(1 / 60);
      g.input.virtual.buttons.delete(a);
      g.advance(1 / 60);
    },
    hold(a, s) {
      g.input.virtual.buttons.add(a);
      g.advance(s);
      g.input.virtual.buttons.delete(a);
    },
    move(x, y, s) {
      g.input.virtual.move.set(x, y);
      g.advance(s);
      g.input.virtual.move.set(0, 0);
    },
    tp(x, z, facing = 0, dy = 0.6) {
      p.teleport(new V(x, w.heightAt(x, z) + dy, z), facing);
      g.advance(0.3);
    },
    /** Face a point (sets facing + camera behind). */
    face(x, z) {
      const f = Math.atan2(x - p.position.x, z - p.position.z);
      p.facing = f;
      g.get('camera').snapBehind(f);
    },
    count(name) {
      return events.filter((e) => e === name).length;
    },
    clearEvents() {
      events.length = 0;
    },
    nearestEntity(pred, from = p.position) {
      let best = null, bd = Infinity;
      for (const e of g.entities.list) {
        if (!e.alive || !e.object || !pred(e)) continue;
        const pos = e.body ? e.body.translation() : e.object.position;
        const d = Math.hypot(pos.x - from.x, pos.z - from.z);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    },
    posOf(e) {
      const t = e.body ? e.body.translation() : e.object.position;
      return { x: t.x, y: t.y, z: t.z };
    },
    /** Walk up to an entity (teleport 0.75 m in front, facing it). */
    approach(e, dist = 0.8) {
      const t = this.posOf(e);
      const ang = Math.random() * Math.PI * 2;
      const x = t.x + Math.cos(ang) * dist, z = t.z + Math.sin(ang) * dist;
      p.teleport(new V(x, Math.max(w.heightAt(x, z), t.y - 0.3) + 0.5, z), 0);
      g.advance(0.25);
      this.face(t.x, t.z);
      g.advance(0.1);
    },
  };
});

const scenarios = {
  async boot() {
    return page.evaluate(() => ({ systems: T.g.systems.length, areas: T.w.areas.map((a) => a.name), entities: T.g.entities.list.length, npcs: (T.g.get('npcs')?.list || []).length }));
  },
  async walk_jump() {
    return page.evaluate(() => {
      T.tp(5, 30, Math.PI);
      const z0 = T.p.position.z;
      T.move(0, 1, 1);
      const moved = Math.abs(T.p.position.z - z0);
      T.press('jump');
      T.step(0.2);
      const air = !T.p.grounded;
      T.step(1);
      return { moved: +moved.toFixed(2), jumped: air, grounded: T.p.grounded, mode: T.p.mode };
    });
  },
  async wash_cotton_candy() {
    return page.evaluate(() => {
      T.clearEvents();
      const cc = T.nearestEntity((e) => e.tags.has('cottoncandy'));
      if (!cc) return 'no cotton candy';
      T.approach(cc, 0.75);
      T.press('grab');
      T.step(0.3);
      const held = T.p.held?.entity === cc;
      // find nearest water: puddle/fountain
      const water = T.g.get('water');
      let best = null, bd = Infinity;
      for (const v of water.volumes) {
        if (v.kind === 'bay') continue;
        const d = Math.hypot(v.center.x - T.p.position.x, v.center.z - T.p.position.z);
        if (d < bd) { bd = d; best = v; }
      }
      if (best) {
        const r = (best.radius ?? Math.min(best.halfX, best.halfZ)) + 0.6;
        T.p.teleport(new T.V(best.center.x + r, best.surfaceY + 0.5, best.center.z), 0);
        T.step(0.3);
        T.face(best.center.x, best.center.z);
      }
      T.hold('wash', 1.6);
      T.step(0.5);
      return { held, water: best?.name, washed: T.count('wash'), gone: T.count('cottonCandyGone'), alive: cc.alive };
    });
  },
  async bonk_npc() {
    return page.evaluate(() => {
      T.clearEvents();
      const n = T.nearestEntity((e) => e.kind === 'npc');
      if (!n) return 'no npc';
      T.approach(n, 0.9);
      T.press('bonk');
      T.step(1);
      return { npcRagdoll: T.count('npcRagdoll'), bonk: T.count('bonk'), score: T.g.get('score').total };
    });
  },
  async steal() {
    return page.evaluate(() => {
      T.clearEvents();
      const list = T.g.get('npcs')?.list || [];
      const holder = list.find((n) => n.held && n.held.alive);
      if (!holder) return 'no npc holding an item';
      T.approach(holder.entity, 0.8);
      T.press('grab');
      T.step(0.5);
      return { steal: T.count('steal'), held: T.p.held?.entity?.name };
    });
  },
  async dumpster_dive() {
    return page.evaluate(() => {
      T.clearEvents();
      if (T.p.held) T.p.release(false);
      const d = T.nearestEntity((e) => e.tags.has('dumpster'));
      if (!d) return 'no dumpster';
      const t = T.posOf(d);
      T.p.teleport(new T.V(t.x, t.y + 2.5, t.z), 0);
      T.step(2);
      return { dive: T.count('dumpsterDive'), name: d.name };
    });
  },
  async car_hit() {
    return page.evaluate(() => {
      T.clearEvents();
      const v = T.g.get('vehicles');
      const car = v.cars.find((c) => !c.wrecked);
      if (!car) return 'no car';
      const pos = new T.V(), dir = new T.V();
      v.sample(car.lane, car.s + car.halfLen + 3, pos, dir);
      car.speed = 12;
      T.p.teleport(pos.clone().add(new T.V(0, 0.5, 0)), 0);
      for (let i = 0; i < 40 && !T.count('hitByCar'); i++) T.step(0.05);
      return { hit: T.count('hitByCar'), mode: T.p.mode };
    });
  },
  async climb_wall() {
    return page.evaluate(() => {
      // find a tall static wall near spawn by raycasting around
      T.tp(0, 20, 0);
      const y0 = T.p.position.y;
      let climbed = false;
      for (let a = 0; a < 16 && !climbed; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const dir = new T.V(Math.sin(ang), 0, Math.cos(ang));
        const hit = T.g.physics.raycast(T.p.position, dir, 25);
        if (!hit || Math.abs(hit.normal.y) > 0.3) continue;
        const target = hit.point.clone().addScaledVector(dir, -0.8);
        T.p.teleport(new T.V(target.x, T.w.heightAt(target.x, target.z) + 0.5, target.z), ang);
        T.g.get('camera').snapBehind(ang);
        T.step(0.2);
        T.g.input.virtual.move.set(0, 1);
        T.g.input.virtual.buttons.add('jump');
        T.step(0.4);
        T.g.input.virtual.buttons.delete('jump');
        T.step(1.5);
        T.g.input.virtual.move.set(0, 0);
        climbed = T.p.mode === 'climb' || T.p.position.y > y0 + 2;
      }
      const res = { climbed, mode: T.p.mode, rise: +(T.p.position.y - y0).toFixed(2) };
      T.p.setMode('walk');
      return res;
    });
  },
  async roll_bowling() {
    return page.evaluate(() => {
      T.clearEvents();
      T.tp(-110, -5, 0);
      T.press('roll');
      T.g.input.virtual.buttons.add('sprint');
      T.move(0, 1, 2.5);
      T.g.input.virtual.buttons.delete('sprint');
      const res = { mode: T.p.mode, speed: +T.p.speed.toFixed(1), rolled: +T.p.stats.rolled.toFixed(1) };
      T.press('roll');
      T.step(0.5);
      return res;
    });
  },
  async objectives_state() {
    return page.evaluate(() => {
      const o = T.g.get('objectives');
      return { done: o.list.filter((x) => x.done).map((x) => x.id), inProgress: o.list.filter((x) => !x.done && x.progress > 0).map((x) => `${x.id} ${x.progress}/${x.target}`), score: T.g.get('score').total };
    });
  },
};

const results = {};
for (const [name, fn] of Object.entries(scenarios)) {
  if (only.length && !only.includes(name) && name !== 'boot') continue;
  try {
    results[name] = await fn();
  } catch (err) {
    results[name] = 'THREW: ' + err.message.split('\n')[0];
  }
  console.log(name.padEnd(20), JSON.stringify(results[name]));
}
await page.screenshot({ path: 'tools/shots/playtest_end.png' });
console.log('\nerrors:', errors.length);
for (const e of errors.slice(0, 15)) console.log(' ', e);
fs.writeFileSync('tools/shots/playtest.json', JSON.stringify({ results, errors }, null, 2));
await browser.close();
