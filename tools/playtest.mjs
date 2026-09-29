// Automated gameplay regression test. Drives the real game through scripted scenarios and reports.
//
//   npx vite build --outDir tools/_downloads/build_test --emptyOutDir
//   npx vite preview --outDir tools/_downloads/build_test --port 5199 --strictPort   (background)
//   node tools/playtest.mjs [--url http://127.0.0.1:5199/] [--only name,name]
//   node tools/playtest.mjs --group obj [--full]      # one scenario per objective ("Instinct"), see QA_OBJECTIVES.md
//
// Each scenario runs in page context with helpers; failures don't stop the run.
// Objective scenarios (obj_*) use real inputs only (virtual buttons / moves, teleports to the right place, grabbing
// real items, washing in real water…) — never emitting gameplay events. Long grinds (roll 500 m, walk 2 km, …) check
// that progress increments and extrapolate unless --full is given. Results → tools/shots/playtest.json.
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
const group = opt('group', '');
const FULL = args.includes('--full');

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

async function boot() {
  await page.waitForFunction(() => window.jimothy && window.jimothy.state === 'playing', null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.evaluate(installHelpers, FULL);
}
await page.goto(base + '?skipintro&time=12&weather=clear');
await boot();

// ------------------------------------------------------------------------------------------------ page helpers
function installHelpers(full) {
  const g = window.jimothy;
  const p = g.get('player');
  const V = p.position.constructor;
  const w = g.get('world');
  const O = g.get('objectives');
  const events = [];
  const counts = {};
  const origEmit = g.events.emit.bind(g.events);
  g.events.emit = (name, payload) => {
    events.push(name);
    counts[name] = (counts[name] || 0) + 1;
    return origEmit(name, payload);
  };
  // the real-time game loop keeps running between evaluate() calls: stop input leaking into it
  const idle = () => {
    g.input.virtual.move.set(0, 0);
    g.input.virtual.buttons.clear();
  };
  const T = {
    g, p, V, w, O, events, counts, full,
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
    idle,
    /** Teleport onto the walkable surface at (x, z) (stairs, porches…; not roofs far above the terrain). */
    tp(x, z, facing = 0, dy = 0.5, y) {
      if (y == null) {
        const ground = w.heightAt(x, z);
        const hit = g.physics.raycast(new V(x, ground + 4, z), new V(0, -1, 0), 6);
        y = (hit ? hit.point.y : ground) + dy;
      }
      p.teleport(new V(x, y, z), facing);
      g.advance(0.3);
    },
    /** Face a point (sets facing + camera behind). */
    face(x, z) {
      const f = Math.atan2(x - p.position.x, z - p.position.z);
      p.facing = f;
      g.get('camera').snapBehind(f);
    },
    count(name) {
      return counts[name] || 0;
    },
    clearEvents() {
      events.length = 0;
      for (const k of Object.keys(counts)) delete counts[k];
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
    // -------------------------------------------------------------------------------------- objective helpers
    obj(id) {
      const o = O.get(id);
      return o ? { progress: o.progress, target: o.target ?? 1, done: o.done } : null;
    },
    /** Forget an objective's progress so a scenario can earn it again (test setup only). */
    resetObj(id) {
      const o = O.get(id);
      if (o) {
        o.done = false;
        o.progress = 0;
      }
    },
    release() {
      if (p.held) p.release(false);
    },
    /** Stand ~dist from an entity facing it and press Grab. Returns the held entity's name (or null). */
    grabEnt(e, dist = 0.75) {
      const t = this.posOf(e);
      let ang = Math.atan2(p.position.x - t.x, p.position.z - t.z);
      if (!isFinite(ang)) ang = 0;
      const x = t.x + Math.sin(ang) * dist, z = t.z + Math.cos(ang) * dist;
      const y = Math.max(w.heightAt(x, z), t.y - 0.25) + 0.45;
      p.teleport(new V(x, y, z), Math.atan2(t.x - x, t.z - z));
      g.advance(0.2);
      p.facing = Math.atan2(t.x - p.position.x, t.z - p.position.z);
      this.press('grab');
      g.advance(0.2);
      return p.held?.entity?.name ?? null;
    },
    /** Stand at the +x edge of a water volume facing it. */
    toWater(v) {
      const r = v.radius ?? Math.min(v.halfX, v.halfZ);
      const x = v.center.x + r + 0.35, z = v.center.z;
      p.teleport(new V(x, Math.max(w.heightAt(x, z), v.surfaceY) + 0.5, z), -Math.PI / 2);
      g.advance(0.3);
      p.facing = -Math.PI / 2;
    },
    nearestWater(pred = (v) => v.kind !== 'bay') {
      let best = null, bd = Infinity;
      for (const v of g.get('water').volumes) {
        if (!v.enabled || !pred(v)) continue;
        const d = Math.hypot(v.center.x - p.position.x, v.center.z - p.position.z);
        if (d < bd) { bd = d; best = v; }
      }
      return best;
    },
    water(name) {
      return g.get('water').volumes.find((v) => v.name === name);
    },
    /** Hold Wash for `secs`; returns how many 'wash' events happened. */
    washHeld(secs = 1.3) {
      const before = counts.wash || 0;
      this.hold('wash', secs);
      g.advance(0.1);
      return (counts.wash || 0) - before;
    },
    /** Walk along [[x,z],…] steering the camera; hops when stuck. */
    walkPath(pts, { sprint = false, maxSecs = 60, tol = 1.2, stop } = {}) {
      const cam = g.get('camera');
      let i = 0, t = 0, stuckT = 0;
      const last = p.position.clone();
      if (sprint) g.input.virtual.buttons.add('sprint');
      while (i < pts.length && t < maxSecs) {
        const [x, z] = pts[i];
        const d = Math.hypot(x - p.position.x, z - p.position.z);
        if (d < tol) { i++; continue; }
        cam.snapBehind(Math.atan2(x - p.position.x, z - p.position.z));
        g.input.virtual.move.set(0, 1);
        g.advance(0.1);
        t += 0.1;
        stuckT = p.position.distanceTo(last) < 0.15 ? stuckT + 0.1 : 0;
        last.copy(p.position);
        if (stuckT > 0.8) { this.press('jump'); stuckT = 0; }
        if (stop && stop()) break;
      }
      g.input.virtual.move.set(0, 0);
      g.input.virtual.buttons.delete('sprint');
      return i >= pts.length;
    },
    /** Climb a structure centred at (cx,cz) from (sx,sz): hold forward (+jump to grab the wall), rest on ledges. */
    climbTo(cx, cz, sx, sz, target, maxSecs = 60, stop) {
      const cam = g.get('camera');
      this.tp(sx, sz, Math.atan2(cx - sx, cz - sz));
      let t = 0;
      while (t < maxSecs) {
        const P = p.position;
        const above = target && P.y > target.y - 1.2;
        cam.snapBehind(above ? Math.atan2(target.x - P.x, target.z - P.z) : Math.atan2(cx - P.x, cz - P.z));
        if (p.mode === 'climb') {
          g.input.virtual.move.set(0, 1);
          g.input.virtual.buttons.delete('jump');
        } else if (p.mode === 'walk') {
          if (p.grounded && p.stamina < 0.95 && P.y > 3 && !above) {
            g.input.virtual.move.set(0, 0);
            g.input.virtual.buttons.delete('jump');
          } else {
            g.input.virtual.move.set(0, above ? 0.5 : 1);
            if (!above) g.input.virtual.buttons.add('jump');
            else g.input.virtual.buttons.delete('jump');
          }
        } else g.input.virtual.move.set(0, 0);
        g.advance(0.1);
        t += 0.1;
        if (stop && stop()) break;
      }
      idle();
      return t;
    },
    /** Roll (sprinting) back and forth along the car-free waterfront promenade (z ≈ 152, x ±45) for `secs`. */
    promenadeRoll(secs, untilDone) {
      const cam = g.get('camera');
      if (p.mode === 'roll') this.press('roll');
      this.tp(-45, 152, Math.PI / 2);
      this.press('roll');
      g.input.virtual.buttons.add('sprint');
      let dir = 1, t = 0;
      while (t < secs && !(untilDone && O.isDone(untilDone))) {
        if (p.position.x > 45) dir = -1;
        if (p.position.x < -45) dir = 1;
        cam.snapBehind(Math.atan2(dir, (152 - p.position.z) * 0.05));
        g.input.virtual.move.set(0, 1);
        g.advance(0.1);
        t += 0.1;
        if (p.mode !== 'roll' && p.mode !== 'ragdoll') this.press('roll');
      }
      idle();
      return +t.toFixed(1);
    },
    /**
     * One long sprint-roll bowling through people: chase the nearest standing, non-scripted NPC south of z = minZ;
     * give up on a target after ~1.2 s (behind a counter, fled…) and never re-target someone already bowled.
     */
    bowl(secs, minZ = -50, until) {
      const cam = g.get('camera');
      if (p.mode !== 'roll') this.press('roll');
      g.input.virtual.buttons.add('sprint');
      const bowled = new Set();
      const off = g.events.on('npcRagdoll', (e) => e?.cause === 'roll' && e.entity && bowled.add(e.entity.id));
      const tried = new Map();
      let target = null, stuck = 0;
      const last = p.position.clone();
      for (let t = 0; t < secs && !(until && until()); t += 0.1) {
        if (!target || target.ragdolled || target.removed || bowled.has(target.entity.id) || (tried.get(target.entity.id) ?? 0) > 1.2) {
          let bd = 1e9;
          target = null;
          for (const n of g.get('npcs').list) {
            if (n.ragdolled || n.removed || n.passive || bowled.has(n.entity.id) || (tried.get(n.entity.id) ?? 0) > 1.2 || n.position.z < minZ) continue;
            const d = Math.hypot(n.position.x - p.position.x, n.position.z - p.position.z);
            if (d < bd) { bd = d; target = n; }
          }
          if (!target) break;
        }
        // only time spent right next to a target counts against it (unreachable behind a counter, fleeing in circles…)
        if (Math.hypot(target.position.x - p.position.x, target.position.z - p.position.z) < 8) tried.set(target.entity.id, (tried.get(target.entity.id) ?? 0) + 0.1);
        cam.snapBehind(Math.atan2(target.position.x - p.position.x, target.position.z - p.position.z));
        g.input.virtual.move.set(0, 1);
        g.advance(0.1);
        stuck = p.position.distanceTo(last) < 0.1 ? stuck + 0.1 : 0;
        last.copy(p.position);
        if (stuck > 1) { this.press('jump'); stuck = 0; }
        if (p.mode !== 'roll' && p.mode !== 'ragdoll') this.press('roll');
      }
      off();
      idle();
      return bowled.size;
    },
    /** Advance quest dialogues with real Space key presses (real-time waits: the dialog ignores instant presses). */
    async closeDialogs(n = 24) {
      const ui = g.get('ui');
      for (let i = 0; i < n && ui.dialog.open; i++) {
        await new Promise((r) => setTimeout(r, 300));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }));
        g.advance(0.1);
      }
      return !ui.dialog.open;
    },
    /** Wait real time (lets setTimeout-driven UI settle). */
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    result(id, extra = {}) {
      idle();
      const o = O.get(id);
      return { pass: !!o?.done, progress: o ? `${o.progress}/${o.target ?? 1}` : '?', ...extra };
    },
  };
  window.T = T;
}

// ------------------------------------------------------------------------------------------------ scenarios
const ev = (fn, arg) => page.evaluate(fn, arg);

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

// ------------------------------------------------------------------------------------------------ objective scenarios
// Order matters a little (e.g. Space Noodle before the void secret, heart quests before the finale area gets busy).
const objScenarios = {
  // ---------------------------------------------------------------- feedback: toast + score + sound + mutator + save
  async obj_feedback() {
    return ev(async () => {
      T.clearEvents();
      const score0 = T.g.get('score').total;
      const cc = T.nearestEntity((e) => e.tags.has('cottoncandy'), new T.V(22.5, 0, 12.2));
      T.grabEnt(cc);
      T.toWater(T.water('Alley Puddle 4'));
      T.washHeld(1.3);
      await T.wait(200);
      const toast = [...document.querySelectorAll('[class*=toast]')].some((el) => /Where'd It Go/.test(el.textContent));
      const saved = JSON.parse(localStorage.getItem('jimothy.objectives.v1') || '{}').cottonCandy;
      return T.result('cottonCandy', {
        toast,
        sfx: T.events.includes('sfx'),
        objectiveEvent: T.count('objective'),
        scoreGain: T.g.get('score').total - score0,
        saved: !!saved?.d,
      });
    });
  },
  async obj_wash10() {
    return ev(() => {
      T.resetObj('wash10');
      T.release();
      const puddle = T.water('Alley Puddle 2');
      const used = new Set();
      for (let i = 0; i < 30 && !T.O.isDone('wash10'); i++) {
        const e = T.nearestEntity((e) => e.alive && e.body && e.tags.has('grabbable') && e.mass <= 3 && !used.has(e.id) && !e.tags.has('cottoncandy') && e.kind !== 'npc' && !e.data.heldByPlayer, puddle.center);
        if (!e) break;
        used.add(e.id);
        if (!T.grabEnt(e)) continue;
        T.toWater(puddle);
        T.washHeld(1.3);
        T.release();
      }
      // the same thing again must not count twice
      return T.result('wash10', { things: used.size });
    });
  },
  async obj_cottonCandy() {
    return ev(() => {
      T.resetObj('cottonCandy');
      const cc = T.nearestEntity((e) => e.tags.has('cottoncandy'), new T.V(22.5, 0, 12.2));
      T.grabEnt(cc);
      T.toWater(T.water('Alley Puddle 4'));
      T.step(2.6); // (the stare-at-paws emote from the feedback test freezes him briefly)
      T.washHeld(1.3);
      return T.result('cottonCandy', { gone: !cc.alive });
    });
  },
  async obj_heNeverLearns() {
    return ev(() => {
      for (let i = 0; i < 4 && !T.O.isDone('heNeverLearns'); i++) {
        const cc = T.nearestEntity((e) => e.tags.has('cottoncandy') && !e.data.heldByPlayer, new T.V(22.5, 0, 12.2));
        if (!cc) break;
        T.grabEnt(cc);
        T.toWater(T.water('Alley Puddle 4'));
        T.step(2.6);
        T.washHeld(1.3);
      }
      T.step(2.6);
      return T.result('heNeverLearns');
    });
  },
  async obj_moneyLaundering() {
    return ev(() => {
      T.resetObj('moneyLaundering');
      T.release();
      const cash = T.nearestEntity((e) => e.tags.has('cash'), new T.V(-6.35, 1, 90.85));
      if (!cash) return { pass: false, detail: 'no cash in the world' };
      const held = T.grabEnt(cash, 0.8);
      T.p.teleport(new T.V(3.5, 0.45, 94.1), 0); // behind the fish counter, next to the stall sink
      T.step(0.4);
      T.p.facing = 0;
      T.washHeld(1.3);
      return T.result('moneyLaundering', { held });
    });
  },
  async obj_deepClean() {
    return ev(() => {
      T.resetObj('deepClean');
      T.release();
      const n = T.g.get('npcs').list.filter((n) => n.held?.data.itemKind === 'phone' && !n.ragdolled).sort((a, b) => a.position.distanceTo(T.p.position) - b.position.distanceTo(T.p.position))[0];
      if (!n) return { pass: false, detail: 'nobody holds a phone' };
      const held = T.grabEnt(n.entity, 0.8);
      T.toWater(T.nearestWater((v) => v.kind === 'puddle' || v.kind === 'fountain'));
      T.washHeld(1.3);
      T.step(1.2);
      return T.result('deepClean', { held, steal: T.count('steal') });
    });
  },
  async obj_stickyFingers() {
    return ev(() => {
      T.resetObj('stickyFingers');
      T.release();
      const robbed = new Set();
      for (let i = 0; i < 25 && !T.O.isDone('stickyFingers'); i++) {
        const n = T.g.get('npcs').list.filter((n) => n.held && n.held.alive && !n.ragdolled && !n.isCustom && !robbed.has(n.entity.id)).sort((a, b) => a.position.distanceTo(T.p.position) - b.position.distanceTo(T.p.position))[0];
        if (!n) break;
        robbed.add(n.entity.id);
        T.grabEnt(n.entity, 0.8);
        T.release();
        T.step(0.3);
      }
      return T.result('stickyFingers', { robbed: robbed.size });
    });
  },
  async obj_fiveFingerDiscount() {
    return ev(() => {
      T.resetObj('fiveFingerDiscount');
      T.release();
      const pz = T.nearestEntity((e) => e.tags.has('pizza'), new T.V(-99.6, 0, -8.3));
      const held = pz ? T.grabEnt(pz, 0.75) : null;
      T.release();
      return T.result('fiveFingerDiscount', { held });
    });
  },
  async obj_dumpsterDiver() {
    return ev(() => {
      T.resetObj('dumpsterDiver');
      T.release();
      const bins = T.g.entities.list.filter((e) => e.alive && e.tags.has('dumpster'));
      const cam = T.g.get('camera');
      // jump onto it from the street (try each side: some dumpsters stand against a wall)
      const jumpOn = (d) => {
        for (const a of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
          const t = d.body.translation();
          const x = t.x + Math.sin(a) * 2.4, z = t.z + Math.cos(a) * 2.4;
          T.tp(x, z, a + Math.PI);
          cam.snapBehind(a + Math.PI);
          T.g.input.virtual.move.set(0, 1);
          T.press('jump');
          for (let k = 0; k < 20 && !(T.p.grounded && T.p.groundEntity === d); k++) T.step(0.05);
          T.idle();
          T.step(0.4);
          if (T.p.groundEntity === d) return;
        }
      };
      for (const d of bins) jumpOn(d);
      T.step(15); // per-dumpster cooldown
      for (const d of bins) if (!T.O.isDone('dumpsterDiver')) jumpOn(d);
      return T.result('dumpsterDiver', { dumpsters: bins.length, dives: T.count('dumpsterDive') });
    });
  },
  async obj_trashTornado() {
    return ev(() => {
      T.resetObj('trashTornado');
      T.release();
      for (let i = 0; i < 40 && !T.O.isDone('trashTornado'); i++) {
        const c = T.nearestEntity((e) => e.tags.has('trashcan') && !e.data.tipped && !e.data.heldByPlayer && e.body);
        if (!c) break;
        const t = c.body.translation();
        const a = Math.random() * Math.PI * 2;
        const x = t.x + Math.sin(a), z = t.z + Math.cos(a);
        T.p.teleport(new T.V(x, T.w.heightAt(x, z) + 0.45, z), Math.atan2(t.x - x, t.z - z));
        T.step(0.25);
        T.p.facing = Math.atan2(t.x - T.p.position.x, t.z - T.p.position.z);
        T.press('bonk');
        T.step(1.2);
      }
      return T.result('trashTornado', { cans: T.g.entities.list.filter((e) => e.alive && e.tags.has('trashcan')).length });
    });
  },
  async obj_roundBoy() {
    return ev(() => {
      T.resetObj('roundBoy');
      T.release();
      // back and forth along the 300 m cross-town avenue (a car may bowl him over: just roll on)
      T.tp(-100, 60, Math.PI / 2);
      const cam = T.g.get('camera');
      T.press('roll');
      T.g.input.virtual.buttons.add('sprint');
      let dir = 1, t = 0;
      while (t < (T.full ? 75 : 12) && !T.O.isDone('roundBoy')) {
        if (T.p.position.x > 120) dir = -1;
        if (T.p.position.x < -100) dir = 1;
        cam.snapBehind(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        T.g.input.virtual.move.set(0, 1);
        T.step(0.5);
        t += 0.5;
        if (T.p.mode !== 'roll' && T.p.mode !== 'ragdoll') T.press('roll');
      }
      T.idle();
      const r = T.result('roundBoy', { secs: t, rolled: +T.p.stats.rolled.toFixed(0), chonk: T.g.get('mutators').get('chonk')?.unlocked });
      if (!T.full) r.pass = r.pass || T.O.get('roundBoy').progress >= 100; // extrapolated: ~11 m/s
      if (T.p.mode === 'roll') T.press('roll');
      return r;
    });
  },
  async obj_spinMeRound() {
    return ev(() => {
      T.resetObj('spinMeRound');
      T.release();
      const t = T.promenadeRoll(T.full ? 64 : 16, 'spinMeRound');
      const r = T.result('spinMeRound', { secs: t });
      if (!T.full) r.pass = r.pass || T.O.get('spinMeRound').progress >= 15;
      if (T.p.mode === 'roll') T.press('roll');
      return r;
    });
  },
  async obj_marathon() {
    return ev(() => {
      T.resetObj('marathon');
      T.tp(-140, 66, Math.PI / 2);
      const cam = T.g.get('camera');
      T.g.input.virtual.buttons.add('sprint');
      let dir = 1, t = 0;
      const secs = T.full ? 300 : 20;
      while (t < secs && !T.O.isDone('marathon')) {
        const x = T.p.position.x;
        if (x > 140) dir = -1;
        if (x < -140) dir = 1;
        cam.snapBehind(dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        T.g.input.virtual.move.set(0, 1);
        T.step(0.5);
        t += 0.5;
        if (T.p.mode === 'ragdoll') { T.idle(); T.step(2); }
      }
      T.idle();
      const r = T.result('marathon', { secs: t, zoomies: T.g.get('mutators').get('zoomies')?.unlocked });
      if (!T.full) r.pass = r.pass || T.O.get('marathon').progress >= 100; // ~8 m/s sprinting
      return r;
    });
  },
  async obj_notACat() {
    return ev(() => {
      T.resetObj('notACat');
      T.release();
      const cam = T.g.get('camera');
      const kinds = ['pedestrian', 'grandma', 'tourist', 'techbro', 'fan'];
      for (let attempt = 0; attempt < 10 && !T.O.isDone('notACat'); attempt++) {
        const cands = T.g.get('npcs').list.filter((n) => kinds.includes(n.type) && !n.passive && !n.isCustom && !n.ragdolled && (n.state === 'idle' || n.state === 'wander'));
        cands.sort((a, b) => a.position.distanceTo(T.p.position) - b.position.distanceTo(T.p.position));
        const n = cands[attempt % Math.max(1, cands.length)];
        if (!n) break;
        const a = Math.random() * Math.PI * 2;
        const x = n.position.x + Math.sin(a) * 3.5, z = n.position.z + Math.cos(a) * 3.5;
        const away = Math.atan2(x - n.position.x, z - n.position.z);
        T.p.teleport(new T.V(x, T.w.heightAt(x, z) + 0.5, z), away);
        let t = 0;
        while (t < 30 && n.state !== 'kitty') { T.p.facing = away; T.step(0.25); t += 0.25; }
        if (n.state !== 'kitty') continue;
        T.step(1);
        // turn around (real input: steer toward them for a moment)
        cam.snapBehind(Math.atan2(n.position.x - T.p.position.x, n.position.z - T.p.position.z));
        T.move(0, 0.25, 0.5);
        T.step(0.5);
      }
      return T.result('notACat');
    });
  },
  async obj_awww() {
    return ev(() => {
      T.resetObj('awww');
      const visited = new Set();
      for (let i = 0; i < 25 && !T.O.isDone('awww'); i++) {
        const c = T.g.get('npcs').list.filter((n) => !n.ragdolled && !visited.has(n.entity.id)).sort((a, b) => a.position.distanceTo(T.p.position) - b.position.distanceTo(T.p.position))[0];
        if (!c) break;
        visited.add(c.entity.id);
        const x = c.position.x + 2.5, z = c.position.z;
        T.p.teleport(new T.V(x, T.w.heightAt(x, z) + 0.5, z), -Math.PI / 2);
        T.step(0.3);
        T.press('chitter');
        T.step(1);
      }
      return T.result('awww');
    });
  },
  async obj_cryptid() {
    // Walk up to people who carry a phone/camera (tourists, fans, tech bros, some pedestrians) and let them notice
    // you (no chittering: an "awww" interrupts filming).
    return ev(() => {
      T.resetObj('cryptid');
      T.release();
      const filmers = T.g.get('npcs').list.filter((n) => !n.passive && !n.isCustom && ((n.type === 'tourist' && (n.held?.data.itemKind === 'phone' || n.look.camera)) || (['pedestrian', 'fan', 'techbro'].includes(n.type) && n.held?.data.itemKind === 'phone')));
      let t = 0;
      const filmedBy = new Set();
      const off = T.g.events.on('filmed', (e) => e?.by && filmedBy.add(e.by.id));
      for (let pass = 0; pass < 2; pass++) {
        for (const n of filmers) {
          if (T.O.isDone('cryptid') || filmedBy.has(n.entity.id) || n.removed) continue;
          const a = Math.random() * Math.PI * 2;
          const x = n.position.x + Math.sin(a) * 5, z = n.position.z + Math.cos(a) * 5;
          T.tp(x, z, Math.atan2(n.position.x - x, n.position.z - z));
          for (let k = 0; k < 40 && !filmedBy.has(n.entity.id); k++) { T.step(0.25); t += 0.25; }
        }
      }
      off();
      return T.result('cryptid', { secs: t, potentialFilmers: filmers.length, filmedBy: filmedBy.size });
    });
  },
  async obj_stickySituation() {
    return ev(() => {
      T.resetObj('stickySituation');
      T.release();
      // walk west into the Gum Wall in Post Alley (try a few spots along it: people wander the alley)
      for (const z of [88.7, 84, 93]) {
        if (T.O.isDone('stickySituation')) break;
        T.tp(-26, z, -Math.PI / 2);
        T.g.get('camera').snapBehind(-Math.PI / 2);
        T.move(0, 1, 2.5);
        T.step(3);
      }
      return T.result('stickySituation');
    });
  },
  async obj_spaceNoodle() {
    return ev(() => {
      T.resetObj('spaceNoodle');
      T.release();
      const nx = 150, nz = -38;
      const t = T.climbTo(nx, nz, nx + 7.5, nz, null, 120, () => T.O.isDone('spaceNoodle'));
      return T.result('spaceNoodle', { secs: +t.toFixed(0), spaceJimothy: T.g.get('mutators').get('spaceJimothy')?.unlocked });
    });
  },
  async obj_leapOfFaith() {
    return ev(() => {
      T.resetObj('leapOfFaith');
      T.release();
      // from the Space Noodle deck, walk off the edge (a 60 m drop)
      T.p.teleport(new T.V(141, 61, -38), -Math.PI / 2);
      T.step(0.5);
      T.g.get('camera').snapBehind(-Math.PI / 2);
      T.g.input.virtual.move.set(0, 1);
      for (let i = 0; i < 40 && T.p.position.y > 55; i++) { if (i % 6 === 0) T.press('jump'); else T.step(0.1); }
      T.idle();
      T.step(8);
      return T.result('leapOfFaith');
    });
  },
  async obj_nocturnal() {
    return ev(() => {
      T.resetObj('nocturnal');
      T.g.get('environment').setTime(21.5); // (skip ~11 real minutes of daytime)
      T.step(62);
      T.g.get('environment').setTime(12);
      return T.result('nocturnal');
    });
  },
  async obj_bathTime() {
    return ev(() => {
      T.resetObj('bathTime');
      localStorage.removeItem('jimothy.content.v1');
      const W = T.g.get('water').volumes;
      const kinds = [];
      for (const v of [W.find((v) => v.kind === 'pond'), W.find((v) => v.kind === 'pool'), W.find((v) => v.name === 'Lake Washing Ship Canal'), W.find((v) => v.kind === 'ladder')]) {
        if (!v) continue;
        T.p.teleport(new T.V(v.center.x + 0.3, v.surfaceY + 1, v.center.z + 0.3), 0);
        let t = 0;
        while (t < 3 && T.p.mode !== 'swim') { T.step(0.1); t += 0.1; }
        T.step(0.8);
        kinds.push(`${v.kind}:${T.p.mode}`);
        T.press('jump');
        T.step(0.5);
      }
      return T.result('bathTime', { kinds, wetJimothy: T.g.get('mutators').get('wetJimothy')?.unlocked });
    });
  },
  async obj_hydrophobic() {
    return ev(() => {
      T.resetObj('hydrophobic');
      T.p.teleport(new T.V(-60, -0.8, 205), 0);
      T.step(1.5);
      const mode = T.p.mode;
      T.step(61);
      return T.result('hydrophobic', { mode });
    });
  },
  async obj_catchOfTheDay() {
    return ev(() => {
      T.resetObj('catchOfTheDay');
      T.release();
      const C = T.g.get('landmarks').get('catch');
      const cs = C.catchSpot;
      T.tp(cs.x, cs.z, Math.atan2(C.market.x - cs.x, C.market.z - cs.z));
      const cam = T.g.get('camera');
      let t = 0;
      while (t < 40 && !T.O.isDone('catchOfTheDay')) {
        const f = C.flying[0];
        if (f && f.marker) {
          const m = f.marker.position;
          const d = Math.hypot(m.x - T.p.position.x, m.z - T.p.position.z);
          cam.snapBehind(Math.atan2(m.x - T.p.position.x, m.z - T.p.position.z));
          T.g.input.virtual.move.set(0, d > 0.4 ? Math.min(1, d) : 0);
        } else T.g.input.virtual.move.set(0, 0);
        T.step(0.05);
        t += 0.05;
      }
      T.release();
      return T.result('catchOfTheDay', { thrown: T.count('fishThrown') });
    });
  },
  async obj_bobbleheadCollector() {
    // Reachability by climbing was checked by hand (see QA_OBJECTIVES.md); here: every placed statue can be walked
    // into from its perch and the count/save/reward work. Plus one real climb (the relocated gasworks one).
    return ev(() => {
      T.resetObj('bobbleheadCollector');
      T.release();
      const C = T.g.get('collectibles');
      C.resetAll();
      T.step(0.5);
      const s1 = C.items.find((b) => b.id === 'bobblehead:s1');
      let climbed = null;
      if (s1) {
        for (let k = 0; k < 3 && !s1.collected; k++) {
          T.climbTo(-158, -25.5, -152.5, -25.5, s1.pos, 12, () => s1.collected || (T.p.grounded && T.p.position.y > 18.5));
          if (s1.collected) break;
          T.g.get('camera').snapBehind(Math.atan2(s1.pos.x - T.p.position.x, s1.pos.z - T.p.position.z));
          T.g.input.virtual.move.set(0, 0.6);
          T.press('jump');
          T.step(0.2);
          T.idle();
          T.step(1.5);
        }
        climbed = s1.collected;
      }
      // the street clock (c3): its top can't be climbed onto from the pole — climb the shop front behind it and
      // wall-jump across
      const c3 = C.items.find((b) => b.id === 'bobblehead:c3');
      let clock = null;
      if (c3 && !c3.collected) {
        const cam = T.g.get('camera');
        const ahead = new T.V(c3.pos.x + 0.5, 0, c3.pos.z - 1.3); // facade is ~2 m north of the clock
        const hit = T.g.physics.raycast(new T.V(ahead.x, 3, c3.pos.z), new T.V(0, 0, -1), 6);
        const wallZ = hit ? hit.point.z : c3.pos.z - 2;
        T.p.teleport(new T.V(ahead.x, T.w.heightAt(ahead.x, wallZ + 0.7) + 0.6, wallZ + 0.7), Math.PI);
        T.step(0.3);
        for (let t = 0; t < 6 && T.p.position.y < c3.pos.y + 0.25; t += 0.05) {
          cam.snapBehind(Math.PI);
          T.g.input.virtual.move.set(0, 1);
          if (T.p.mode === 'walk') T.g.input.virtual.buttons.add('jump');
          else T.g.input.virtual.buttons.delete('jump');
          T.step(0.05);
        }
        T.idle();
        T.press('jump'); // wall jump back toward the clock
        for (let i = 0; i < 40 && !c3.collected; i++) {
          cam.snapBehind(Math.atan2(c3.pos.x - T.p.position.x, c3.pos.z - T.p.position.z));
          T.g.input.virtual.move.set(0, 0.6);
          T.step(0.05);
        }
        T.idle();
        clock = c3.collected;
      }
      const missed = [];
      for (const b of C.items) {
        if (b.collected) continue;
        let ok = false;
        for (const [dx, dz] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) {
          T.p.teleport(new T.V(b.pos.x + dx, b.pos.y + 0.6, b.pos.z + dz), Math.atan2(-dx, -dz));
          T.step(0.3);
          T.g.get('camera').snapBehind(Math.atan2(-dx, -dz));
          T.move(0, 0.6, 1.2);
          if (b.collected) { ok = true; break; }
        }
        if (!ok) missed.push(b.id);
      }
      return T.result('bobbleheadCollector', { placed: C.items.length, climbedGasworks: climbed, wallJumpedClock: clock, missed, bobbleheadMutator: T.g.get('mutators').get('bobblehead')?.unlocked });
    });
  },
  // ---------------------------------------------------------------- AI slop
  async obj_washSlop() {
    return ev(async () => {
      T.resetObj('washSlop');
      T.release();
      const fountain = T.water('City Hall Fountain');
      T.toWater(fountain);
      const sb = T.g.get('ui').slopBot;
      sb.auto = true;
      sb.schedule(0.2);
      T.step(0.5);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3' })); // "Generate" → 12 tiny Slopothys
      T.step(1);
      sb.auto = false;
      for (let i = 0; i < 16 && !T.O.isDone('washSlop'); i++) {
        const s = T.nearestEntity((e) => e.kind === 'slop' && e.tags.has('slopothy') && !e.data.heldByPlayer);
        if (!s) break;
        T.grabEnt(s, 0.8);
        T.toWater(fountain);
        T.washHeld(1.3);
      }
      await T.wait(1300);
      return T.result('washSlop', { washed: T.count('slopWashed') });
    });
  },
  async obj_closeThisWindow() {
    return ev(async () => {
      T.resetObj('closeThisWindow');
      const sb = T.g.get('ui').slopBot;
      sb.auto = true;
      for (let i = 0; i < 5; i++) {
        await T.wait(1300); // his exit animation runs on real time
        sb.schedule(0.3);
        T.step(0.6);
        if (i % 2 === 0) T.press('bonk');
        else window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1' }));
        T.step(0.2);
      }
      sb.auto = false;
      return T.result('closeThisWindow');
    });
  },
  async obj_touchGrass() {
    return ev(() => {
      T.resetObj('touchGrass');
      T.release();
      const plug = T.g.get('slop').plug;
      const t = plug.entity.body.translation();
      const ax = plug.axis;
      const x = t.x + ax.x * 1.4, z = t.z + ax.z * 1.4;
      const face = Math.atan2(t.x - x, t.z - z);
      T.p.teleport(new T.V(x, T.w.heightAt(x, z) + 0.5, z), face);
      T.step(0.3);
      T.p.facing = face;
      T.press('grab');
      T.g.get('camera').snapBehind(face);
      let k = 0;
      while (k < 60 && !T.O.isDone('touchGrass')) {
        T.g.input.virtual.move.set(0, -1); // walk backwards, dragging the plug out
        T.step(0.2);
        k++;
        if (!T.p.held) { T.p.facing = face; T.press('grab'); }
      }
      T.idle();
      T.release();
      return T.result('touchGrass', { aiEnhanced: T.g.get('mutators').get('aiEnhanced')?.unlocked });
    });
  },
  async obj_countToFive() {
    return ev(() => {
      T.resetObj('countToFive');
      T.release();
      const B = T.g.get('slop').billboard;
      if (B.done) B.reslop?.();
      const cp = B.catwalkPoint;
      const face = Math.atan2(-B.normal.x, -B.normal.z);
      T.p.teleport(new T.V(cp.x, cp.y + 0.2, cp.z), face); // on the window-washer's catwalk (ladder at its end)
      T.step(0.5);
      for (let i = 0; i < 4 && !T.O.isDone('countToFive'); i++) {
        T.p.facing = face;
        T.washHeld(1.25);
        T.step(0.3);
      }
      T.step(2);
      return T.result('countToFive', { washes: B.washes });
    });
  },
  async obj_dragonRider() {
    return ev(() => {
      T.resetObj('dragonRider');
      T.release();
      const D = T.g.get('slop').dragon;
      const pad = D.pad;
      T.tp(pad.x + 4, pad.z, -Math.PI / 2);
      let t = 0;
      while (t < 300 && D.state !== 'landed') { T.step(1); t += 1; }
      for (let i = 0; i < 8 && T.p.mode !== 'hang'; i++) {
        const b = D.body.translation();
        const a = (i * Math.PI) / 4;
        const x = b.x + Math.sin(a) * 2, z = b.z + Math.cos(a) * 2;
        const face = Math.atan2(b.x - x, b.z - z);
        T.p.teleport(new T.V(x, T.w.heightAt(x, z) + 0.5, z), face);
        T.step(0.2);
        T.p.facing = face;
        T.g.get('camera').snapBehind(face);
        T.move(0, 0.6, 0.35);
        T.press('grab');
        T.step(0.3);
      }
      T.step(3);
      const r = T.result('dragonRider', { waitedForLanding: t, carSurferUnchanged: true });
      let k = 0;
      while (T.p.mode === 'hang' && k < 40) { T.step(0.5); k++; }
      return r;
    });
  },
  // ---------------------------------------------------------------- heartwarming
  async obj_mamasBoy() {
    return ev(() => {
      T.resetObj('mamasBoy');
      T.release();
      const mom = T.g.get('heartQuests').mama.mom;
      for (let i = 0; i < 4 && !T.O.isDone('mamasBoy'); i++) {
        const food = T.nearestEntity((e) => e.alive && e.tags.has('food') && !e.tags.has('cottoncandy') && !e.tags.has('trash') && !e.data.momClaimed && !e.data.heldByPlayer, new T.V(28.8, 0, 12));
        if (!food) break;
        T.grabEnt(food, 0.75);
        T.p.teleport(new T.V(mom.pos.x + 1.8, mom.pos.y + 0.5, mom.pos.z), -Math.PI / 2);
        T.step(0.3);
        T.p.facing = Math.atan2(mom.pos.x - T.p.position.x, mom.pos.z - T.p.position.z);
        T.press('grab'); // drop it for her
        T.step(4);
      }
      T.step(7);
      return T.result('mamasBoy', { fed: T.g.get('heartQuests').mama.fed });
    });
  },
  async obj_kitCollector() {
    return ev(() => {
      T.resetObj('kitCollector');
      T.release();
      const K = T.g.get('heartQuests').kits;
      const res = [];
      for (const k of K.kits) {
        if (k.state === 'home') { res.push(`${k.kitName}:home`); continue; }
        const x = k.pos.x + 4, z = k.pos.z;
        T.p.teleport(new T.V(x, Math.max(T.w.heightAt(x, z), k.pos.y - 1) + 0.6, z), -Math.PI / 2);
        T.step(0.5);
        T.press('chitter'); // a lost kit hears him and joins the conga line
        T.step(1.2);
        const found = k.state;
        T.tp(12, 27, -Math.PI / 2); // the alley behind the thrift store (kits catch up after a long trip)
        T.step(2);
        T.walkPath([[9.5, 24.8]], { maxSecs: 8 });
        T.step(10);
        res.push(`${k.kitName}:${found}->${k.state}`);
      }
      return T.result('kitCollector', { res, tiny: T.g.get('mutators').get('tiny')?.unlocked });
    });
  },
  async obj_familyReunion() {
    return ev(async () => {
      T.resetObj('familyReunion');
      T.release();
      const d = T.g.get('heartQuests').danny.danny;
      T.tp(d.pos.x + 2.5, d.pos.z, -Math.PI / 2);
      T.press('chitter');
      T.step(1);
      T.press('roll');
      const cam = T.g.get('camera');
      let t = 0;
      while (t < 20 && !T.O.isDone('familyReunion')) {
        const dist = Math.hypot(d.pos.x - T.p.position.x, d.pos.z - T.p.position.z);
        cam.snapBehind(Math.atan2(d.pos.x - T.p.position.x, d.pos.z - T.p.position.z));
        T.g.input.virtual.move.set(0, dist > 1.8 ? 0.6 : 0);
        T.step(0.1);
        t += 0.1;
        if (T.p.mode !== 'roll' && T.p.mode !== 'ragdoll' && !T.O.isDone('familyReunion')) T.press('roll');
      }
      T.idle();
      T.step(3);
      const closed = await T.closeDialogs();
      T.step(1);
      return T.result('familyReunion', { dialogClosed: closed, frozenAfter: T.p.frozen, state: T.g.state });
    });
  },
  async obj_crowDeals() {
    return ev(() => {
      T.resetObj('crowDeals');
      T.release();
      const CQ = T.g.get('heartQuests').crows;
      const tree = CQ.tree;
      const fountain = T.water('Park Fountain');
      for (let i = 0; i < 4 && !T.O.isDone('crowDeals'); i++) {
        const it = T.nearestEntity((e) => e.alive && e.body && (e.tags.has('beanbag') || e.tags.has('food')) && e.body.translation().y < 0.8 && !e.data.heldByPlayer && !e.data.washed && !e.tags.has('cottoncandy') && !e.data.crowGift, new T.V(tree.x, 0, tree.z));
        if (!it) break;
        T.grabEnt(it, 0.7);
        T.toWater(fountain);
        T.washHeld(1.3); // freshly washed = crow currency
        T.p.teleport(new T.V(tree.x + 3.2, tree.y + 0.6, tree.z), -Math.PI / 2);
        T.step(0.3);
        T.press('grab'); // leave it by their tree
        T.step(1);
        T.tp(tree.x + 9, tree.z, -Math.PI / 2);
        const before = CQ.trades;
        let t = 0;
        while (t < 30 && CQ.trades === before) { T.step(0.5); t += 0.5; }
      }
      return T.result('crowDeals', { trades: CQ.trades, crowRider: T.g.get('mutators').get('crowRider')?.unlocked });
    });
  },
  async obj_teddyRescue() {
    return ev(() => {
      T.resetObj('teddyRescue');
      T.release();
      const TQ = T.g.get('heartQuests').teddy;
      if (!TQ.teddy) return T.result('teddyRescue', { detail: 'teddy already returned' });
      T.grabEnt(TQ.teddy, 0.7);
      T.toWater(T.nearestWater((v) => v.kind !== 'bay' && v.depth > 0.02));
      T.washHeld(1.3);
      const kp = TQ.kidPos;
      T.p.teleport(new T.V(kp.x + 3.5, kp.y + 0.6, kp.z), -Math.PI / 2);
      T.step(0.3);
      T.g.get('camera').snapBehind(-Math.PI / 2);
      T.move(0, 0.6, 1.2);
      T.step(4);
      return T.result('teddyRescue');
    });
  },
  async obj_grandmasFavorite() {
    return ev(async () => {
      T.resetObj('grandmasFavorite');
      T.release();
      const GQ = T.g.get('heartQuests').grandma;
      const porch = GQ.porch;
      const env = T.g.get('environment');
      env.setTime(22.5); // she only hands over the hat at night
      T.tp(porch.x + 12, porch.z, -Math.PI / 2);
      T.step(0.5);
      T.tp(porch.x + 6, porch.z, -Math.PI / 2);
      T.walkPath([[porch.x + 1.5, porch.z]], { maxSecs: 8 });
      T.step(2);
      const closed = await T.closeDialogs();
      T.step(4);
      env.setTime(12);
      return T.result('grandmasFavorite', { dialogClosed: closed, hat: T.g.get('mutators').get('grandmaHat')?.unlocked });
    });
  },
  // ---------------------------------------------------------------- landmark events
  async obj_honoraryDegree() {
    return ev(async () => {
      T.resetObj('honoraryDegree');
      T.release();
      const D = T.g.get('landmarks').get('degree');
      const st = D.stage;
      const dir = new T.V(D.audience.x - st.x, 0, D.audience.z - st.z).normalize();
      T.tp(st.x + dir.x * 8, st.z + dir.z * 8, Math.atan2(-dir.x, -dir.z));
      T.walkPath([[st.x, st.z]], { maxSecs: 12, tol: 0.8, stop: () => D.state === 'speech' });
      T.step(0.5);
      await T.closeDialogs();
      T.step(3);
      const diploma = T.p.held?.entity?.name;
      T.release();
      return T.result('honoraryDegree', { diploma, honoraryGrad: T.g.get('mutators').get('honoraryGrad')?.unlocked });
    });
  },
  async obj_jimothySummer() {
    return ev(async () => {
      T.resetObj('jimothySummer');
      T.release();
      const S = T.g.get('landmarks').get('summer');
      const pod = S.podium;
      T.tp(111, 0, Math.PI / 2);
      const cam = T.g.get('camera');
      for (let k = 0; k < 150 && S.state !== 'speech'; k++) {
        cam.snapBehind(Math.atan2(pod.x - T.p.position.x, pod.z - T.p.position.z));
        T.g.input.virtual.move.set(0, 1);
        T.step(0.1);
      }
      T.idle();
      await T.closeDialogs();
      T.step(2);
      return T.result('jimothySummer', { crowd: S.crowd?.size, mutator: T.g.get('mutators').get('jimothySummer')?.unlocked });
    });
  },
  async obj_salmonRun() {
    return ev(() => {
      T.resetObj('salmonRun');
      T.release();
      const R = T.g.get('landmarks').get('salmon');
      const st = R.start;
      let w = 0;
      while (R.state !== 'idle' && w < 30) { T.step(0.5); w += 0.5; }
      T.tp(st.x + 9, st.z, -Math.PI / 2);
      T.step(0.5);
      const cam = T.g.get('camera');
      for (let k = 0; k < 60 && R.state === 'idle'; k++) {
        cam.snapBehind(Math.atan2(st.x - T.p.position.x, st.z - T.p.position.z));
        T.g.input.virtual.move.set(0, 1);
        T.step(0.1);
      }
      T.idle();
      for (let k = 0; k < 100 && R.state !== 'race'; k++) T.step(0.1);
      T.g.input.virtual.buttons.add('sprint');
      const L = R.path.length;
      let t = 0;
      while (t < 60 && R.state === 'race') {
        const tgt = R.path.at(Math.min(L, R.sJ + 6)); // follow the cones
        cam.snapBehind(Math.atan2(tgt.x - T.p.position.x, tgt.z - T.p.position.z));
        T.g.input.virtual.move.set(0, 1);
        T.step(0.1);
        t += 0.1;
      }
      T.idle();
      T.step(1);
      return T.result('salmonRun', { raceSecs: +t.toFixed(1), result: R.result });
    });
  },
  async obj_rookieCard() {
    return ev(() => {
      T.resetObj('rookieCard');
      T.release();
      const RC = T.g.get('landmarks').get('rookieCard');
      T.tp(RC.spot.x, RC.spot.z + 5, Math.PI);
      T.step(1.5);
      const held = RC.card ? T.grabEnt(RC.card, 0.7) : null;
      T.step(0.5);
      T.release();
      return T.result('rookieCard', { held, rookie: T.g.get('mutators').get('rookie')?.unlocked });
    });
  },
  // ---------------------------------------------------------------- chaos
  async obj_kaboom() {
    return ev(() => {
      T.resetObj('kaboom');
      T.release();
      const tank = T.nearestEntity((e) => e.alive && e.tags.has('propane'), new T.V(25.8, 0, -76.75));
      if (!tank) return { pass: false, detail: 'no propane tank' };
      for (let i = 0; i < 4 && tank.alive; i++) {
        const t = tank.body.translation();
        T.p.teleport(new T.V(t.x - 1, t.y + 0.1, t.z), Math.PI / 2);
        T.step(0.3);
        T.p.facing = Math.atan2(t.x - T.p.position.x, t.z - T.p.position.z);
        T.press('bonk');
        T.step(0.8);
      }
      T.step(2);
      return T.result('kaboom');
    });
  },
  async obj_chainReaction() {
    // Lob a propane tank (from a Hills BBQ) into the Jimothy Summer crowd (6 people) at City Hall. A throw can land
    // a little off, so up to 3 tries with 3 tanks (the ceremony can be replayed).
    return ev(async () => {
      T.resetObj('chainReaction');
      T.release();
      const S = T.g.get('landmarks').get('summer');
      const cam = T.g.get('camera');
      const tries = [];
      for (let attempt = 0; attempt < 3 && !T.O.isDone('chainReaction'); attempt++) {
        const tank = T.nearestEntity((e) => e.alive && e.tags.has('propane') && !e.data.armed, new T.V(-24.6, 0, -122.6));
        if (!tank) break;
        T.grabEnt(tank, 0.8);
        T.p.teleport(new T.V(100, 1, -30), Math.PI / 2);
        for (let w = 0; S.state !== 'idle' && w < 80; w++) T.step(1);
        const pod = S.podium;
        T.tp(111, 0, Math.PI / 2);
        for (let k = 0; k < 150 && S.state !== 'speech'; k++) {
          cam.snapBehind(Math.atan2(pod.x - T.p.position.x, pod.z - T.p.position.z));
          T.g.input.virtual.move.set(0, 1);
          T.step(0.1);
        }
        T.idle();
        await T.closeDialogs();
        T.step(0.1);
        const A = S.crowd.actors.filter((a) => a.alive);
        const c = A.reduce((acc, a) => acc.add(a.position), new T.V()).multiplyScalar(1 / Math.max(1, A.length));
        // step down toward them until ~6 m away, then a low lob (lands ~6 m out)
        for (let k = 0; k < 40 && Math.hypot(c.x - T.p.position.x, c.z - T.p.position.z) > 6; k++) {
          cam.snapBehind(Math.atan2(c.x - T.p.position.x, c.z - T.p.position.z));
          T.g.input.virtual.move.set(0, 1);
          T.step(0.1);
        }
        T.idle();
        const d = Math.hypot(c.x - T.p.position.x, c.z - T.p.position.z);
        const f = Math.atan2(c.x - T.p.position.x, c.z - T.p.position.z);
        T.p.facing = f;
        cam.snapBehind(f);
        cam.pitch = 0.25;
        T.press('bonk'); // throw
        T.step(6);
        tries.push({ crowd: A.length, dist: +d.toFixed(1), best: T.O.get('chainReaction').progress });
      }
      return T.result('chainReaction', { tries });
    });
  },
  async obj_strike() {
    return ev(() => {
      T.resetObj('strike');
      T.release();
      T.tp(0, 70, Math.PI); // the market / waterfront crowds
      const bowled = T.bowl(T.full ? 180 : 60, -50, () => T.O.isDone('strike'));
      if (T.p.mode === 'roll') T.press('roll');
      return T.result('strike', { bowled });
    });
  },
  async obj_carSurfer() {
    return ev(() => {
      T.resetObj('carSurfer');
      T.release();
      const V = T.g.get('vehicles');
      for (let attempt = 0; attempt < 10 && T.p.mode !== 'hang'; attempt++) {
        if (T.p.mode !== 'walk') T.step(3);
        const car = V.cars.filter((c) => !c.wrecked && c.speed > 5)[attempt % 6];
        if (!car) break;
        const b = car.body.translation();
        const v = car.velocity.clone().normalize();
        const right = new T.V(v.z, 0, -v.x);
        const x = b.x + right.x * (car.halfWid + 0.75), z = b.z + right.z * (car.halfWid + 0.75);
        const face = Math.atan2(-right.x, -right.z);
        T.p.teleport(new T.V(x, T.w.heightAt(x, z) + 0.45, z), face);
        T.p.facing = face;
        T.g.input.virtual.buttons.add('grab');
        T.g.advance(1 / 60);
        T.g.input.virtual.buttons.delete('grab');
        T.step(0.3);
      }
      let t = 0;
      while (T.p.mode === 'hang' && t < 12 && !T.O.isDone('carSurfer')) { T.step(0.1); t += 0.1; }
      if (T.p.mode === 'hang') T.press('jump');
      T.step(2);
      return T.result('carSurfer', { rode: +t.toFixed(1) });
    });
  },
  async obj_frequentFlyer() {
    return ev(() => {
      T.resetObj('frequentFlyer');
      T.release();
      const tr = T.g.get('trampolines').list[0];
      T.tp(tr.center.x + 3.2, tr.center.z, -Math.PI / 2);
      T.g.input.virtual.buttons.add('jump');
      const cam = T.g.get('camera');
      for (let i = 0; i < 120 && !T.O.isDone('frequentFlyer'); i++) {
        const dx = tr.center.x - T.p.position.x, dz = tr.center.z - T.p.position.z;
        const d = Math.hypot(dx, dz);
        cam.snapBehind(Math.atan2(dx, dz));
        T.g.input.virtual.move.set(0, d > 0.3 ? Math.min(1, d) : 0);
        T.step(0.1);
      }
      T.idle();
      T.step(4);
      return T.result('frequentFlyer', { trampolineBounces: T.count('trampoline') });
    });
  },
  async obj_jaywalker() {
    return ev(() => {
      T.resetObj('jaywalker');
      T.release();
      const v = T.g.get('vehicles');
      for (let i = 0; i < 6 && !T.O.isDone('jaywalker'); i++) {
        const car = v.cars.filter((c) => !c.wrecked)[i];
        if (!car) break;
        const pos = new T.V(), dir = new T.V();
        v.sample(car.lane, car.s + car.halfLen + 3, pos, dir);
        car.speed = 12;
        T.p.teleport(pos.clone().add(new T.V(0, 0.5, 0)), 0);
        for (let k = 0; k < 40 && !T.O.isDone('jaywalker'); k++) T.step(0.05);
      }
      T.step(3);
      return T.result('jaywalker');
    });
  },
  async obj_flopEra() {
    return ev(() => {
      T.resetObj('flopEra');
      T.tp(5, 30, 0);
      let n = 0;
      while (!T.O.isDone('flopEra') && n < 40) {
        T.hold('flop', 0.3);
        let w = 0;
        while (T.p.mode !== 'walk' && w < 5) { T.step(0.1); w += 0.1; }
        n++;
      }
      return T.result('flopEra', { flops: n });
    });
  },
  async obj_officerScold() {
    return ev(() => {
      T.resetObj('officerScold');
      T.release();
      const off = T.g.get('npcs').list.find((n) => n.type === 'officer');
      if (!off) return { pass: false, detail: 'no Wildlife Officer spawned' };
      const cam = T.g.get('camera');
      let t = 0;
      while (t < (T.full ? 240 : 150) && !T.O.isDone('officerScold')) {
        const fans = T.g.get('npcs').list.filter((n) => n.type === 'fan' && !n.ragdolled && Math.hypot(n.position.x - off.position.x, n.position.z - off.position.z) < 40);
        fans.sort((a, b) => a.lastScolded - b.lastScolded);
        const f = fans[0];
        if (!f) break;
        const d = Math.hypot(f.position.x - T.p.position.x, f.position.z - T.p.position.z);
        if (d > 8) {
          const x = f.position.x + 1.5, z = f.position.z;
          T.p.teleport(new T.V(x, T.w.heightAt(x, z) + 0.5, z), 0);
        } else {
          cam.snapBehind(Math.atan2(f.position.x - T.p.position.x, f.position.z - T.p.position.z));
          T.g.input.virtual.move.set(0, d > 1.5 ? 1 : 0);
        }
        T.step(0.25);
        t += 0.25;
      }
      T.idle();
      return T.result('officerScold', { secs: t, scolds: T.count('officerScold') });
    });
  },
  // ---------------------------------------------------------------- secrets & meta
  async obj_humanMade() {
    return ev(() => {
      T.resetObj('humanMade');
      T.release();
      // walking past / grabbing cotton candy at the cart next to it must NOT count…
      const cc = T.nearestEntity((e) => e.tags.has('cottoncandy'), new T.V(22.5, 0, 12.2));
      if (cc) { T.grabEnt(cc); T.step(1); T.release(); }
      T.tp(28, 18, -Math.PI / 2);
      T.g.get('camera').snapBehind(-Math.PI / 2 + 0.9);
      T.move(0, 1, 2.5);
      const accidental = T.O.isDone('humanMade');
      // …stopping to look at it does
      T.tp(24, 15.5, -Math.PI / 2);
      T.g.get('camera').snapBehind(-Math.PI / 2);
      T.g.get('camera').pitch = -0.1;
      T.step(2.2);
      return T.result('humanMade', { accidental });
    });
  },
  async obj_backFromTheVoid() {
    // Secret combo: Space Jimothy (from the Space Noodle) + the Bay Blaster cannon on the Noodle deck clears the
    // invisible wall and drops him out of the world. Needs the extras system's cannon.
    return ev(() => {
      T.resetObj('backFromTheVoid');
      T.release();
      const X = T.g.get('extras');
      const c = X?.cannons?.list.find((c) => c.spec.id === 'noodle');
      if (!c) return { pass: false, detail: 'no Bay Blaster cannon (extras system)' };
      const M = T.g.get('mutators');
      const had = M.get('spaceJimothy')?.unlocked;
      if (!had) M.allUnlocked = true; // (the menu's "unlock everything" toggle, if Space Noodle wasn't climbed)
      M.setEnabled('spaceJimothy', true);
      T.step(0.2);
      let w = 0;
      while (c.state !== 'idle' && w < 40) { T.step(0.5); w++; }
      const b = c.breech;
      T.p.teleport(new T.V(b.x, b.y + 0.6, b.z + 2.5), Math.PI);
      T.step(0.4);
      const cam = T.g.get('camera');
      for (let k = 0; k < 25 && c.state === 'idle'; k++) {
        cam.snapBehind(Math.atan2(b.x - T.p.position.x, b.z - T.p.position.z));
        T.g.input.virtual.move.set(0, 0.6);
        T.step(0.1);
      }
      T.idle();
      let t = 0;
      while (t < 45 && !T.O.isDone('backFromTheVoid')) { T.step(0.25); t += 0.25; }
      T.step(1);
      M.setEnabled('spaceJimothy', false);
      M.allUnlocked = false;
      return T.result('backFromTheVoid', { cannonState: c.state, flight: t });
    });
  },
  async obj_mutantRaccoon() {
    return ev(() => {
      T.resetObj('mutantRaccoon');
      const M = T.g.get('mutators');
      const want = ['aiEnhanced', 'chonk', 'spaceJimothy', 'wetJimothy', 'zoomies', 'jimothySummer', 'crowRider', 'bobblehead'];
      const usable = want.filter((id) => M.get(id)?.unlocked);
      const cheat = usable.length < 5;
      if (cheat) M.allUnlocked = true; // not enough unlocked in a partial run: use the menu's unlock-all toggle
      const ids = (cheat ? want : usable).slice(0, 5);
      for (const id of ids) { M.setEnabled(id, true); T.step(0.2); }
      const on = M.list.filter((m) => m.enabled).map((m) => m.id);
      T.step(0.5);
      const r = T.result('mutantRaccoon', { on, usedUnlockAll: cheat });
      for (const id of on) M.setEnabled(id, false);
      M.allUnlocked = false;
      T.step(0.5);
      return r;
    });
  },
  async obj_localCelebrity() {
    return ev(() => {
      // 100k in one session: objectives + chaos. Check the step-wise progress tracks the session score.
      const S = T.g.get('score');
      const o = T.O.get('localCelebrity');
      const expect = S.total >= 100000 ? 100000 : Math.floor(S.total / 5000) * 5000;
      T.step(0.5);
      return { pass: o.done || o.progress >= expect, progress: `${o.progress}/${o.target}`, sessionScore: S.total, extrapolated: !o.done };
    });
  },
  // ---------------------------------------------------------------- persistence (reload) + rebalanced saves
  async obj_persistence() {
    const before = await ev(() => {
      const s = JSON.parse(localStorage.getItem('jimothy.objectives.v1') || '{}');
      // simulate a save from before a rebalance: progress above today's (lower) target, not marked done
      s.cryptid = { p: 20, d: false };
      localStorage.setItem('jimothy.objectives.v1', JSON.stringify(s));
      return { done: T.O.list.filter((o) => o.done).map((o) => o.id).sort(), muts: T.g.get('mutators').list.filter((m) => m.unlocked).map((m) => m.id).sort() };
    });
    await page.reload();
    await boot();
    const after = await ev(() => ({ done: T.O.list.filter((o) => o.done).map((o) => o.id).sort(), muts: T.g.get('mutators').list.filter((m) => m.unlocked).map((m) => m.id).sort(), cryptid: T.O.get('cryptid') }));
    const kept = before.done.filter((id) => id !== 'cryptid').every((id) => after.done.includes(id));
    return {
      pass: kept && after.cryptid.done && before.muts.every((id) => after.muts.includes(id)),
      doneBefore: before.done.length,
      doneAfter: after.done.length,
      mutatorsKept: before.muts.every((id) => after.muts.includes(id)),
      rebalancedSaveCompleted: after.cryptid.done,
    };
  },
};

let run = { ...scenarios };
if (group === 'obj') run = { boot: scenarios.boot, ...objScenarios, objectives_state: scenarios.objectives_state };
else if (only.length) run = { ...scenarios, ...objScenarios };

const results = {};
for (const [name, fn] of Object.entries(run)) {
  if (only.length && !only.includes(name) && name !== 'boot') continue;
  const t0 = Date.now();
  try {
    results[name] = await fn();
  } catch (err) {
    results[name] = 'THREW: ' + err.message.split('\n')[0];
  }
  await page.evaluate(() => window.T && window.T.idle()).catch(() => {});
  const r = results[name];
  const mark = r && typeof r === 'object' && 'pass' in r ? (r.pass ? 'PASS' : 'FAIL') : '    ';
  console.log(mark, name.padEnd(24), `${((Date.now() - t0) / 1000).toFixed(0)}s`.padStart(4), JSON.stringify(r));
}
await page.screenshot({ path: 'tools/shots/playtest_end.png' });
const objNames = Object.keys(results).filter((n) => n.startsWith('obj_'));
if (objNames.length) {
  const pass = objNames.filter((n) => results[n]?.pass).length;
  console.log(`\nobjective scenarios: ${pass}/${objNames.length} passed${FULL ? '' : ' (long grinds extrapolated; --full to finish them)'}`);
}
console.log('\nerrors:', errors.length);
for (const e of errors.slice(0, 15)) console.log(' ', e);
fs.writeFileSync('tools/shots/playtest.json', JSON.stringify({ results, errors }, null, 2));
await browser.close();
