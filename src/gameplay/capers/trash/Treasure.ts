import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { spawnProp, destroyProp } from '../../../entities/Props';
import { G, groups } from '../../../core/Physics';
import { spawnItemFlying } from '../../items';
import {
  type CaperFeature, type Part, addObjective, objSet, paintMesh, T, TR, groundY, playerOf, fx, celebrate, rand,
  prompt, toast, nearCamera, Timers, rigOf,
} from '../shared';
import { touchable, removeTouchable, loadState, saveState, showCard, paper } from './common';

/**
 * TREASURE MAP: "X Marks The Trash". Dumpster dives sometimes cough up a torn treasure-map scrap (always on the 2nd,
 * 4th and 6th dive if he's behind). Scraps fly out of the bin like loot and twinkle; touching or grabbing one collects
 * it (a parchment card shows the pieces so far). Three scraps assemble the map: it shows a dotted trail from the den
 * to an X on top of Kite Hill (Gasworks-ish Park), and a big red X with a dirt mound appears there (and on the big
 * map). Dig (bonk the mound, or grab it, four times): a treasure chest rises out of the ground, the lid flips open and
 * shinies spray out (bottle caps, rings, cash) plus the Lost Remote Control of Destiny. Hold the remote and Chitter to
 * change the channel (the time of day).
 *
 * Objective 'xMarksTheTrash'. Events: 'treasureScrap' {count}, 'treasureMap', 'treasureDug'.
 * Test hooks: `capers.byId.get('treasure').giveScraps(3)`, `.visitX()`, `.dig(n)`, `.dropScrap()`.
 */

const NEED = 3;
const DIGS = 4;
const X_AT = new THREE.Vector3(-158, 7.7, 32); // Kite Hill
const DEN = new THREE.Vector3(9, 0, 23.3);

export class TreasureFeature implements CaperFeature {
  readonly id = 'treasure';
  dives = 0;
  scraps = 0;
  dug = false;
  xSpot: THREE.Vector3 | null = null;
  private live: Entity[] = [];
  private marker: THREE.Group | null = null;
  private mound: THREE.Mesh | null = null;
  private moundEnt: Entity | null = null;
  private digs = 0;
  private digCd = 0;
  private chest: THREE.Group | null = null;
  private lid: THREE.Object3D | null = null;
  private chestT = -1;
  private remote: Entity | null = null;
  private remoteCd = 0;
  private timers: Timers;
  private glintT = 0;

  constructor(private game: Game) {
    this.timers = new Timers(game);
  }

  init() {
    const game = this.game;
    game.physics.refreshQueries(); // (zone colliders may not be in the query pipeline yet)
    addObjective(game, {
      id: 'xMarksTheTrash',
      category: 'raccoon',
      points: 2500,
      title: 'X Marks The Trash',
      desc: 'Dumpster dives turn up torn treasure-map scraps. Find 3, follow the map to the X and dig up the treasure.',
    });
    const s = loadState('treasure', { dives: 0, scraps: 0, dug: false });
    this.dives = s.dives;
    this.scraps = Math.min(NEED, s.scraps);
    this.dug = s.dug;
    // where the X goes (a clear patch on top of Kite Hill): found on the first frame of play, once the park's hill
    // collider is in the world (it isn't yet while the capers initialise)
    this.findX();
    game.events.on('dumpsterDive', (e: { entity?: Entity }) => this.onDive(e?.entity));
  }

  private xFound = false;
  private started = false;

  private findX() {
    const game = this.game;
    // (the hill is a heightfield whose normals fail surfaceAt's flatness test, so cast a plain ray; the top is a
    // flat 2.6 m disc with nothing on it)
    const hit = game.physics.raycast(new THREE.Vector3(X_AT.x, 40, X_AT.z), new THREE.Vector3(0, -1, 0), 60, groups(G.ALL, G.WORLD));
    const y = hit ? hit.point.y : groundY(game, X_AT.x, X_AT.z, 40);
    this.xSpot = new THREE.Vector3(X_AT.x, y, X_AT.z);
    this.xFound = y > 3;
  }

  private persist() {
    saveState('treasure', { dives: this.dives, scraps: this.scraps, dug: this.dug });
  }

  // --------------------------------------------------------------------------------------------- scraps
  private onDive(bin?: Entity) {
    if (this.scraps >= NEED) return;
    this.dives++;
    this.persist();
    const have = this.scraps + this.live.filter((e) => e.alive).length;
    if (have >= NEED) return;
    const k = this.dives / 2;
    const guaranteed = this.dives % 2 === 0 && k <= NEED && have < k;
    if (!guaranteed && Math.random() > 0.2) return;
    const t = bin?.body?.translation();
    const from = t ? new THREE.Vector3(t.x, t.y + 1.2, t.z) : playerOf(this.game)?.position.clone().setY(playerOf(this.game).position.y + 1);
    if (from) this.timers.after(0.9, () => this.dropScrap(from));
  }

  /** Spawn a scrap popping out at `from` (test hook: drops one next to Jimothy). */
  dropScrap(from?: THREE.Vector3) {
    const game = this.game;
    const pl = playerOf(game);
    const p = from ?? pl?.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    if (!p) return null;
    const e = spawnProp(
      game,
      {
        name: 'Treasure Map Scrap',
        object: scrapObject(),
        mass: 0.05,
        sleeping: false,
        tags: ['grabbable', 'keep', 'paper', 'treasureScrap'],
        data: { grabLabel: 'Grab the map scrap', buoyancy: 2 },
        onGrab: () => {
          this.collect(e);
          return false;
        },
      },
      p,
      rand(0, Math.PI * 2),
    );
    const a = rand(0, Math.PI * 2);
    e.body?.setLinvel({ x: Math.cos(a) * 1.5, y: 4.5, z: Math.sin(a) * 1.5 }, true);
    this.live.push(e);
    fx(game, 'sparkles', p, { count: 14, radius: 0.4, color: 0xffe08a });
    game.sfx('sparkle', p, 0.8, 0.9);
    game.hint('Wait… a torn piece of paper with a dotted line on it? Grab it!', 3);
    return e;
  }

  private collect(e: Entity) {
    const game = this.game;
    if (!e.alive || this.scraps >= NEED) return;
    const t = e.body?.translation();
    const p = t ? new THREE.Vector3(t.x, t.y, t.z) : playerOf(game)?.position.clone();
    this.live = this.live.filter((x) => x !== e);
    destroyProp(game, e);
    this.gotScrap(p);
  }

  private gotScrap(p?: THREE.Vector3) {
    const game = this.game;
    this.scraps = Math.min(NEED, this.scraps + 1);
    this.persist();
    if (p) fx(game, 'sparkles', p, { count: 18, radius: 0.4, color: 0xffe08a });
    game.sfx('coin', p, 0.9, 0.9);
    game.events.emit('treasureScrap', { count: this.scraps });
    if (this.scraps < NEED) {
      game.score(150, 'Map Scrap!', p);
      const n = this.scraps;
      showCard(game, {
        kicker: `Treasure map · scrap ${n}/${NEED}`,
        title: 'A Torn Map Scrap',
        text: n === 1 ? 'A dotted line… to WHAT? More scraps must be in other dumpsters.' : 'Almost! One more scrap and the map is whole.',
        draw: (c, w, h) => drawMap(c, w, h, n),
        secs: 5.5,
      });
      return;
    }
    // assembled!
    game.score(300, 'Treasure Map!', p);
    celebrate(game, 'TREASURE MAP!', 'X marks the trash.', '#d8412f');
    this.placeX(true);
    showCard(game, {
      kicker: 'The map is complete!',
      title: 'X Marks The Trash',
      text: 'From the den, west through the park… to the top of Kite Hill. Dig at the X!',
      draw: (c, w, h) => drawMap(c, w, h, NEED),
      secs: 8,
    });
    toast(game, 'Treasure map assembled', 'An X appeared on top of Kite Hill (Gasworks-ish Park). It is on your map (M) too.', '🗺️');
    game.events.emit('treasureMap', {});
  }

  /** Test hook: collect `n` scraps at once. */
  giveScraps(n = NEED) {
    for (let i = 0; i < n && this.scraps < NEED; i++) this.gotScrap(playerOf(this.game)?.position.clone());
    return this.scraps;
  }

  // --------------------------------------------------------------------------------------------- the X
  private placeX(withMound: boolean) {
    const game = this.game;
    const s = this.xSpot;
    if (!s || this.marker) return;
    const g = new THREE.Group();
    g.position.copy(s);
    const parts: Part[] = [
      { g: new THREE.BoxGeometry(2.6, 0.04, 0.42), c: 0xd8212a, m: TR(0, 0.03, 0, 0, Math.PI / 4, 0) },
      { g: new THREE.BoxGeometry(2.6, 0.04, 0.42), c: 0xd8212a, m: TR(0, 0.035, 0, 0, -Math.PI / 4, 0) },
      // a little flag: "DIG"
      { g: new THREE.CylinderGeometry(0.025, 0.025, 1.3, 6), c: 0x6b4a2a, m: T(1.5, 0.65, -1.1) },
      { g: new THREE.BoxGeometry(0.02, 0.32, 0.5), c: 0xd8212a, m: T(1.5, 1.12, -0.85) },
    ];
    g.add(paintMesh(parts, false));
    game.scene.add(g);
    this.marker = g;
    game.get<any>('world')?.poi?.set('treasureX', s.clone().setY(s.y + 0.2));
    if (!withMound) return;
    const mound = paintMesh([
      { g: new THREE.IcosahedronGeometry(0.75, 1), c: 0x6b4a2a, m: TR(0, 0, 0, 0, 0, 0, [1, 0.45, 1]) },
      { g: new THREE.IcosahedronGeometry(0.3, 0), c: 0x5a3d22, m: T(0.4, 0.18, 0.2) },
      { g: new THREE.IcosahedronGeometry(0.22, 0), c: 0x7a5634, m: T(-0.35, 0.2, -0.25) },
    ]);
    mound.position.set(0, 0.02, 0);
    g.add(mound);
    this.mound = mound;
    this.moundEnt = touchable(game, 'Suspicious Dirt Mound', s.clone().setY(s.y + 0.2), new THREE.Vector3(0.6, 0.2, 0.6), {
      label: 'Dig!',
      tags: ['dig'],
      onBonk: () => this.digOnce(),
      onGrab: () => this.digOnce(),
    });
  }

  private digOnce() {
    const game = this.game;
    if (this.dug || !this.xSpot || this.digCd > 0) return;
    this.digCd = 0.3;
    this.digs++;
    const p = this.xSpot.clone().setY(this.xSpot.y + 0.3);
    fx(game, 'dust', p, { scale: 1.6 });
    fx(game, 'puff', p, { scale: 0.9, color: 0x8a6a45 });
    game.sfx('rummage', p, 0.8, 0.8 + this.digs * 0.08);
    rigOf(game)?.shake(0.12);
    if (this.mound) this.mound.scale.set(1 + this.digs * 0.12, Math.max(0.15, 1 - this.digs * 0.22), 1 + this.digs * 0.12);
    if (this.digs < DIGS) {
      game.score(25, 'Dig!', p);
      return;
    }
    this.unearth();
  }

  /** Test hook: dig `n` times (default: all the way). */
  dig(n = DIGS) {
    for (let i = 0; i < n; i++) {
      this.digCd = 0;
      this.digOnce();
    }
    return this.dug;
  }

  private unearth() {
    const game = this.game;
    const s = this.xSpot!;
    this.dug = true;
    this.persist();
    removeTouchable(game, this.moundEnt);
    this.moundEnt = null;
    if (this.mound) this.mound.scale.set(1.6, 0.12, 1.6);
    // the chest rises out of the hole
    const chest = new THREE.Group();
    chest.add(
      paintMesh([
        { g: new THREE.BoxGeometry(0.9, 0.5, 0.6), c: 0x7a4a24, m: T(0, 0.25, 0) },
        { g: new THREE.BoxGeometry(0.94, 0.08, 0.64), c: 0xd9a53a, m: T(0, 0.06, 0) },
        { g: new THREE.BoxGeometry(0.08, 0.52, 0.64), c: 0xd9a53a, m: T(-0.3, 0.25, 0) },
        { g: new THREE.BoxGeometry(0.08, 0.52, 0.64), c: 0xd9a53a, m: T(0.3, 0.25, 0) },
        { g: new THREE.BoxGeometry(0.14, 0.16, 0.04), c: 0xd9a53a, m: T(0, 0.44, 0.31) },
      ]),
    );
    const lid = new THREE.Group();
    lid.position.set(0, 0.5, -0.3);
    lid.add(
      paintMesh([
        { g: new THREE.BoxGeometry(0.92, 0.16, 0.62), c: 0x7a4a24, m: T(0, 0.08, 0.3) },
        { g: new THREE.BoxGeometry(0.94, 0.06, 0.64), c: 0x8a5a2c, m: T(0, 0.18, 0.3) },
        { g: new THREE.BoxGeometry(0.08, 0.2, 0.66), c: 0xd9a53a, m: T(-0.3, 0.1, 0.3) },
        { g: new THREE.BoxGeometry(0.08, 0.2, 0.66), c: 0xd9a53a, m: T(0.3, 0.1, 0.3) },
      ]),
    );
    chest.add(lid);
    // inner glow
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 0.7), toneMapped: false }));
    glow.position.y = 0.47;
    chest.add(glow);
    chest.position.copy(s).setY(s.y - 0.6);
    chest.rotation.y = 0.3;
    game.scene.add(chest);
    this.chest = chest;
    this.lid = lid;
    this.chestT = 0;
    game.sfx('creak', s, 1, 0.8);
    fx(game, 'dust', s.clone().setY(s.y + 0.2), { scale: 2.2 });
    rigOf(game)?.shake(0.35);
    game.hint('THUNK. Something wooden down there… it’s rising!', 2.5);
  }

  private openChest() {
    const game = this.game;
    const s = this.xSpot!;
    game.get<any>('world')?.collider?.(s.clone().setY(s.y + 0.25), new THREE.Vector3(0.9, 0.5, 0.6), 0.3);
    game.physics.refreshQueries();
    const top = s.clone().setY(s.y + 0.9);
    fx(game, 'sparkles', top, { count: 50, radius: 0.8, color: 0xffd36a });
    fx(game, 'confetti', top.clone().setY(top.y + 1), { count: 40, radius: 1 });
    game.sfx('jingle_win');
    game.sfx('coins', s, 1);
    celebrate(game, 'TREASURE!', 'One raccoon’s trash is… this raccoon’s treasure.', '#ffd36a');
    const loot = ['bottleCap', 'bottleCap', 'bottleCap', 'ring', 'ring', 'cash', 'cash'];
    loot.forEach((kind, i) => {
      this.timers.after(0.12 * i, () => {
        const a = rand(0, Math.PI * 2);
        try {
          spawnItemFlying(game, kind, top.clone(), new THREE.Vector3(Math.cos(a) * rand(1.5, 2.6), rand(4, 6), Math.sin(a) * rand(1.5, 2.6)));
        } catch (err) {
          console.warn('[capers] treasure loot', err);
        }
      });
    });
    this.timers.after(1.0, () => this.spawnRemote(top));
    game.score(500, 'Buried Treasure!', top);
    objSet(game, 'xMarksTheTrash', 1);
    game.events.emit('treasureDug', {});
  }

  private spawnRemote(at: THREE.Vector3) {
    const game = this.game;
    const e = spawnProp(
      game,
      {
        name: 'Lost Remote Control of Destiny',
        object: remoteObject(),
        mass: 0.2,
        sleeping: false,
        tags: ['grabbable', 'washable', 'shiny', 'keep', 'collectible', 'remote', 'electronic'],
        data: { grabLabel: 'Grab the Remote Control of Destiny', buoyancy: 1.2 },
        onWash: (g) => {
          g.score(200, 'Washed The Remote (Destiny Unchanged)', at);
          g.hint('The buttons are sticky no longer. Destiny is sparkling clean.', 3);
        },
      },
      at,
      0,
    );
    e.body?.setLinvel({ x: 0.6, y: 5.5, z: 1.2 }, true);
    e.body?.setAngvel({ x: 4, y: 6, z: 2 }, true);
    this.remote = e;
    this.timers.after(1.2, () => game.hint('The LOST REMOTE CONTROL OF DESTINY! Grab it, then {chitter} Chitter to change the channel…', 5));
  }

  private changeChannel() {
    const game = this.game;
    const env = game.get<any>('environment');
    if (!env) return;
    const t = env.timeOfDay as number;
    const next = t >= 5 && t < 12 ? 13 : t >= 12 && t < 18.5 ? 19.6 : t >= 18.5 && t < 21.5 ? 23 : 7;
    env.timeOfDay = next;
    const names: Record<number, string> = { 13: 'Afternoon', 19.6: 'Golden Hour', 23: 'Late Night', 7: 'Morning' };
    celebrate(game, 'CHANNEL CHANGED', `Now showing: ${names[next] ?? 'Something'}`, '#19c2b8');
    const pl = playerOf(game);
    game.sfx('short_circuit', pl?.position, 0.6, 1.5);
    game.sfx('ui_click', undefined, 1);
    fx(game, 'zap', pl?.position.clone().setY(pl.position.y + 0.5) ?? new THREE.Vector3(), {});
    game.events.emit('remoteOfDestiny', { time: next });
  }

  /** Test hook: stand next to the X. */
  visitX() {
    const pl = playerOf(this.game);
    if (!pl || !this.xSpot) return false;
    pl.teleport(this.xSpot.clone().add(new THREE.Vector3(0, 0.6, 2.0)), Math.PI);
    return true;
  }

  // --------------------------------------------------------------------------------------------- per frame
  update(dt: number) {
    const game = this.game;
    this.timers.tick();
    this.digCd -= dt;
    this.remoteCd -= dt;
    const pl = playerOf(game);
    if (!pl) return;
    if (!this.started && game.state === 'playing') {
      this.started = true;
      if (!this.xFound) this.findX();
      if (this.scraps >= NEED) this.placeX(!this.dug);
    }
    // scraps: twinkle, auto-collect on touch
    if (this.live.length) {
      this.glintT -= dt;
      for (const e of this.live) {
        if (!e.alive || !e.body) continue;
        const t = e.body.translation();
        const dx = t.x - pl.position.x,
          dy = t.y - pl.position.y,
          dz = t.z - pl.position.z;
        if (dx * dx + dy * dy + dz * dz < 0.8 * 0.8) {
          this.timers.after(0, () => this.collect(e));
          continue;
        }
        if (this.glintT <= 0) fx(game, 'glint', new THREE.Vector3(t.x, t.y + 0.2, t.z), {});
      }
      if (this.glintT <= 0) this.glintT = 0.5;
      this.live = this.live.filter((e) => e.alive);
    }
    // the X: prompt + a pulse of sparkle so it's findable
    if (this.moundEnt && this.xSpot) {
      const d = pl.position.distanceTo(this.xSpot);
      if (d < 2.2) prompt(game, '{bonk} / {grab} Dig!', 0.3);
      if (nearCamera(game, this.xSpot, 50)) {
        this.glintT -= dt;
        if (this.glintT <= 0) {
          this.glintT = 0.6;
          fx(game, 'glint', this.xSpot.clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0.5, rand(-0.5, 0.5))), {});
        }
      }
    }
    // the chest rising and opening
    if (this.chest && this.chestT >= 0 && this.xSpot) {
      this.chestT += dt;
      const k = Math.min(1, this.chestT / 0.9);
      this.chest.position.y = this.xSpot.y - 0.6 + 0.62 * (1 - (1 - k) * (1 - k));
      if (this.lid) this.lid.rotation.x = -Math.min(1.9, Math.max(0, (this.chestT - 1.0) / 0.4) * 1.9);
      if (this.chestT > 1.2) {
        this.chestT = -1;
        this.openChest();
      }
    }
    // the remote
    const held = pl.held?.kind === 'carry' ? pl.held.entity : null;
    if (held && held === this.remote && held.alive) {
      prompt(game, '{chitter} Change the channel', 0.3);
      if (this.remoteCd <= 0 && game.input.pressed('chitter')) {
        this.remoteCd = 1;
        this.changeChannel();
      }
    } else if (held?.tags?.has('remote') && held.alive) {
      this.remote = held;
    }
  }
}

// ------------------------------------------------------------------------------------------------ models / drawings
function scrapObject(): THREE.Object3D {
  const g = new THREE.Group();
  const m = paintMesh([
    { g: new THREE.BoxGeometry(0.34, 0.015, 0.26), c: 0xe9d3a3, m: TR(0, 0, 0, 0, 0, 0.04) },
    { g: new THREE.BoxGeometry(0.12, 0.016, 0.1), c: 0xd8c08c, m: TR(0.13, 0.001, 0.09, 0, 0.5, 0) },
    { g: new THREE.BoxGeometry(0.06, 0.02, 0.015), c: 0xd8212a, m: TR(-0.08, 0.004, -0.02, 0, 0.3, 0) },
    { g: new THREE.BoxGeometry(0.06, 0.02, 0.015), c: 0xd8212a, m: TR(0.01, 0.004, 0.0, 0, 0.1, 0) },
    { g: new THREE.BoxGeometry(0.06, 0.02, 0.015), c: 0xd8212a, m: TR(0.09, 0.004, 0.03, 0, -0.2, 0) },
    { g: new THREE.BoxGeometry(0.07, 0.02, 0.018), c: 0x2a1d12, m: TR(-0.12, 0.004, 0.06, 0, 0.785, 0) },
    { g: new THREE.BoxGeometry(0.07, 0.02, 0.018), c: 0x2a1d12, m: TR(-0.12, 0.004, 0.06, 0, -0.785, 0) },
  ]);
  m.scale.setScalar(1.35);
  g.add(m);
  return g;
}

function remoteObject(): THREE.Object3D {
  const g = new THREE.Group();
  const parts: Part[] = [
    { g: new THREE.BoxGeometry(0.09, 0.035, 0.26), c: 0x1d1a26 },
    { g: new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10), c: 0xd8212a, m: T(0, 0.022, -0.08) },
  ];
  const cols = [0x35b36a, 0xffcf2e, 0x2f7de1, 0xe8559a];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) parts.push({ g: new THREE.BoxGeometry(0.018, 0.01, 0.018), c: cols[(r + c) % 4], m: T(-0.025 + c * 0.025, 0.021, -0.02 + r * 0.03) });
  g.add(paintMesh(parts));
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.4, 0.4), toneMapped: false }));
  tip.position.set(0, 0.006, -0.133);
  g.add(tip);
  return g;
}

/** The treasure map (pieces 1..3 revealed left to right), world-ish layout: bay south, park west, X on Kite Hill. */
export function drawMap(c: CanvasRenderingContext2D, w: number, h: number, pieces: number) {
  paper(c, w, h);
  const mx = (x: number) => ((x + 190) / 380) * w;
  const mz = (z: number) => ((z + 120) / 300) * h;
  c.save();
  // bay
  c.fillStyle = '#8fb8c9';
  c.fillRect(0, mz(172), w, h - mz(172));
  c.strokeStyle = '#5b8aa0';
  c.lineWidth = 3;
  for (let i = 0; i < 9; i++) {
    c.beginPath();
    const x = 30 + i * 70;
    c.arc(x, mz(190), 10, Math.PI * 1.1, Math.PI * 1.9);
    c.stroke();
  }
  // roads
  c.strokeStyle = 'rgba(90,60,30,.55)';
  c.lineWidth = 6;
  for (const x of [-63, 63]) {
    c.beginPath();
    c.moveTo(mx(x), 0);
    c.lineTo(mx(x), mz(172));
    c.stroke();
  }
  for (const z of [-63, 63]) {
    c.beginPath();
    c.moveTo(0, mz(z));
    c.lineTo(w, mz(z));
    c.stroke();
  }
  // pond, stadium, noodle
  c.fillStyle = '#8fb8c9';
  c.beginPath();
  c.ellipse(mx(-120), mz(10), 26, 20, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#3a2614';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(mx(122), mz(80));
  c.lineTo(mx(150), mz(110));
  c.lineTo(mx(122), mz(140));
  c.lineTo(mx(94), mz(110));
  c.closePath();
  c.stroke();
  c.beginPath();
  c.moveTo(mx(143), mz(-38));
  c.lineTo(mx(143), mz(-38) - 40);
  c.stroke();
  c.beginPath();
  c.ellipse(mx(143), mz(-38) - 40, 12, 5, 0, 0, Math.PI * 2);
  c.stroke();
  // Kite Hill bumps
  c.fillStyle = 'rgba(80,120,50,.45)';
  c.beginPath();
  c.ellipse(mx(-158), mz(32), 44, 26, 0, 0, Math.PI * 2);
  c.fill();
  // the den (little house)
  const dx = mx(DEN.x),
    dz = mz(DEN.z);
  c.fillStyle = '#6b4a2a';
  c.fillRect(dx - 12, dz - 6, 24, 18);
  c.beginPath();
  c.moveTo(dx - 16, dz - 6);
  c.lineTo(dx, dz - 20);
  c.lineTo(dx + 16, dz - 6);
  c.fill();
  // dotted trail den → X
  c.strokeStyle = '#d8212a';
  c.lineWidth = 5;
  c.setLineDash([10, 9]);
  c.beginPath();
  c.moveTo(dx, dz + 10);
  c.bezierCurveTo(mx(-30), mz(70), mx(-90), mz(-30), mx(-150), mz(28));
  c.stroke();
  c.setLineDash([]);
  // X
  const xx = mx(-158),
    xz = mz(32);
  c.lineWidth = 9;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(xx - 15, xz - 15);
  c.lineTo(xx + 15, xz + 15);
  c.moveTo(xx + 15, xz - 15);
  c.lineTo(xx - 15, xz + 15);
  c.stroke();
  c.fillStyle = '#3a2614';
  c.font = "bold 30px 'Luckiest Guy', 'Arial Black', sans-serif";
  c.textAlign = 'center';
  c.fillText('KITE HILL', xx + 10, xz + 52);
  c.font = "bold 24px 'Luckiest Guy', 'Arial Black', sans-serif";
  c.fillText('DEN', dx, dz + 40);
  // compass
  c.fillStyle = '#3a2614';
  c.font = "bold 22px 'Luckiest Guy', 'Arial Black', sans-serif";
  c.fillText('N', w - 40, 34);
  c.beginPath();
  c.moveTo(w - 40, 42);
  c.lineTo(w - 48, 74);
  c.lineTo(w - 40, 66);
  c.lineTo(w - 32, 74);
  c.closePath();
  c.fill();
  c.restore();
  // torn: hide the missing pieces (3 vertical strips, revealed from the den side west… order: middle, right, left)
  const order = [1, 2, 0];
  const shown = new Set(order.slice(0, Math.max(0, Math.min(3, pieces))));
  for (let i = 0; i < 3; i++) {
    if (shown.has(i)) continue;
    const x0 = (w / 3) * i;
    const x1 = (w / 3) * (i + 1);
    c.fillStyle = '#4a3220';
    c.beginPath();
    c.moveTo(x0 + (i > 0 ? 0 : -2), -2);
    for (let y = 0; y <= h; y += 20) c.lineTo(x0 + (i > 0 ? Math.sin(y * 0.7) * 8 : 0), y);
    c.lineTo(x0, h + 2);
    c.lineTo(x1, h + 2);
    for (let y = h; y >= 0; y -= 20) c.lineTo(x1 + (i < 2 ? Math.sin(y * 0.9) * 8 : 0), y);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,240,200,.35)';
    c.font = "bold 70px 'Luckiest Guy', 'Arial Black', sans-serif";
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('?', (x0 + x1) / 2, h / 2);
  }
}
