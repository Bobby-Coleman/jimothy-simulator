import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { spawnProp, destroyProp } from '../../entities/Props';
import { drawBoard } from '../extras/shared';
import {
  type ChaosFeature, objSet, addObjective, playerFree, pick, rand, clamp, fx, playerOf, rigOf, uiOf, prompt,
  paintMesh, T, TR, findClearSpot, hudShown, groundY, poi, Timers,
} from './shared';

/**
 * ESPRESSO MODE. "Bean Me Up Espresso" — a tiny drive-thru espresso hut with a raccoon-height service window in the
 * Old Ballard parking lot right behind the den. Grab a Triple-Shot cup off the counter and Jimothy chugs it: 20 s of ESPRESSO MODE —
 * 1.6× speed, a jittery camera, a vibrating raccoon and a caffeine meter. More shots stack time (and jitter); three
 * or more end in a CAFFEINE CRASH. Any other coffee (stolen from a human, found in the trash) can be chugged with
 * Chitter while carrying it.
 *
 * Events: 'espresso' { shots, until }, 'espressoEnd' { shots }. Objective: 'tripleShot' (3 shots in one buzz).
 */

const MODE_SECS = 20;
const EXTRA_SECS = 14;
const MAX_SECS = 40;
const SPEED_MUL = 1.6;
const JUMP_MUL = 1.12;
const AUTO_CHUG = 0.9;

const BARISTA_LINES = [
  'Triple shot for the round boy?',
  'One raccoon-o, extra foam.',
  "It's on the house. Please don't wash the register.",
  'Seattle runs on this. So will you.',
  'Decaf? In THIS city?',
  'Raccoon window is open!',
];
const CHUG_LINES = ['He drank it in one gulp. Respect.', 'Oh no. He found the good stuff.', "That's his third. Somebody call someone."];

const SHOUTS: [string, string][] = [
  ['ESPRESSO MODE', 'Seattle runs on this.'],
  ['DOUBLE SHOT', 'Jimothy can hear colours now.'],
  ['TRIPLE SHOT', 'Jimothy can see through time.'],
  ['QUADRUPLE SHOT', 'Please stop.'],
  ['ESPRESSO ∞', 'He has become the bean.'],
];

const _v = new THREE.Vector3();

export class EspressoFeature implements ChaosFeature {
  readonly id = 'espresso';
  /** Stand front-centre (ground) and facing (unit vector out of the service window). */
  stand: THREE.Vector3 | null = null;
  private front = new THREE.Vector3(0, 0, 1);
  private yaw = 0;
  private slots: THREE.Vector3[] = [];
  private cups: (Entity | null)[] = [];
  private refillAt: number[] = [];
  private barista: any = null;
  private baristaCd = 0;
  private timers: Timers;
  // mode state
  active = false;
  shots = 0;
  until = 0;
  private total = MODE_SECS;
  private heldFor = 0;
  private heldId = -1;
  private whooshT = 0;
  private chitterT = 2;
  private meter: HTMLDivElement | null = null;
  private fill: HTMLDivElement | null = null;
  private label: HTMLDivElement | null = null;
  private cupMats: THREE.Material[] = [];

  constructor(private game: Game) {
    this.timers = new Timers(game);
  }

  init() {
    const game = this.game;
    addObjective(game, {
      id: 'tripleShot',
      category: 'raccoon',
      points: 1000,
      target: 3,
      title: 'Seattle Runs On This',
      desc: 'Chug 3 espressos in one caffeinated buzz. (Bean Me Up Espresso: the drive-thru hut in the parking lot behind the den.)',
    });
    try {
      this.buildStand();
    } catch (err) {
      console.warn('[chaos] espresso stand failed to build', err);
    }
  }

  // --------------------------------------------------------------------------------------------- the stand
  private buildStand() {
    const game = this.game;
    const world = game.get<any>('world');
    const half = new THREE.Vector3(1.3, 1.2, 1.25);
    // a proper Seattle drive-thru espresso hut: the Old Ballard parking lot right behind the den (window facing the
    // lot's aisle); fallbacks around the lot
    const lot = poi(game, 'parkingLot', new THREE.Vector3(8, 0.1, 42));
    const cands: [number, number, number][] = [
      [lot.x + 27.5, lot.z - 0.5, -Math.PI / 2],
      [lot.x - 25, lot.z - 0.5, Math.PI / 2],
      [lot.x + 22, lot.z - 0.5, -Math.PI / 2],
      [lot.x - 19, lot.z - 0.5, Math.PI / 2],
      [lot.x, lot.z, Math.PI],
    ];
    let spot: THREE.Vector3 | null = null;
    for (const [x, z, yaw] of cands) {
      const y = groundY(game, x, z, lot.y + 8);
      spot = findClearSpot(game, new THREE.Vector3(x, y, z), half, yaw, { maxR: 3, step: 0.75, avoidRoad: true, fromY: y + 5 });
      if (spot) {
        this.yaw = yaw;
        break;
      }
    }
    if (!spot) {
      console.info('[chaos] no room for the espresso stand; skipped');
      return;
    }
    this.stand = spot;
    this.front.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const root = new THREE.Group();
    root.position.copy(spot);
    root.rotation.y = this.yaw;
    game.scene.add(root);
    // hut: back cabin + low raccoon counter at the front (local +z = front)
    const green = 0x2f6b4f;
    const cream = 0xf3e6c8;
    const wood = 0xb97a41;
    const red = 0xd8412f;
    // local layout (+z = street side): back wall z -1.1..-0.6 | barista floor | raccoon-height counter z 0.1..0.8
    const parts = [
      { g: new THREE.BoxGeometry(2.3, 2.5, 0.5), c: green, m: T(0, 1.25, -0.85) }, // back wall / cabin
      { g: new THREE.BoxGeometry(0.1, 2.5, 1.9), c: green, m: T(-1.1, 1.25, -0.15) }, // side walls
      { g: new THREE.BoxGeometry(0.1, 2.5, 1.9), c: green, m: T(1.1, 1.25, -0.15) },
      { g: new THREE.BoxGeometry(2.1, 0.66, 0.7), c: cream, m: T(0, 0.33, 0.45) }, // counter body
      { g: new THREE.BoxGeometry(2.3, 0.06, 0.84), c: wood, m: T(0, 0.69, 0.45) }, // counter top (raccoon height!)
      { g: new THREE.BoxGeometry(2.5, 0.1, 2.3), c: green, m: T(0, 2.55, 0.05) }, // roof
      { g: new THREE.BoxGeometry(0.55, 0.42, 0.3), c: 0xc9ced6, m: T(-0.5, 1.3, -0.46) }, // espresso machine (back shelf)
      { g: new THREE.BoxGeometry(0.6, 0.08, 0.34), c: red, m: T(-0.5, 1.55, -0.46) },
      { g: new THREE.BoxGeometry(2.1, 0.06, 0.3), c: wood, m: T(0, 1.06, -0.46) }, // back shelf
      { g: new THREE.CylinderGeometry(0.09, 0.09, 0.22, 10), c: 0x6b3f22, m: T(0.45, 1.2, -0.46) }, // bean jars
      { g: new THREE.CylinderGeometry(0.09, 0.09, 0.22, 10), c: 0x6b3f22, m: T(0.72, 1.2, -0.46) },
    ];
    // striped awning over the window
    for (let i = 0; i < 8; i++) {
      parts.push({ g: new THREE.BoxGeometry(2.5 / 8, 0.05, 0.75), c: i % 2 ? cream : red, m: TR(-1.25 + (i + 0.5) * (2.5 / 8), 2.36, 1.28, 0.42, 0, 0) });
    }
    const mesh = paintMesh(parts as any);
    root.add(mesh);
    // sign on the roof (own little canvas: one texture, one draw call)
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 168;
    const paint = () => {
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      drawBoard('BEAN ME UP', 'ESPRESSO · RACCOON WINDOW', '#2f6b4f', '#f3e6c8', '#fff4d8', '#ffd23f')(ctx, c.width, c.height);
    };
    paint();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    try {
      (document as any).fonts?.ready?.then(() => {
        paint();
        tex.needsUpdate = true;
      });
    } catch {
      /* no font API */
    }
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.6, side: THREE.DoubleSide });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.75), signMat);
    sign.position.set(0, 3.0, 0.2);
    root.add(sign);
    // colliders: cabin, counter, roof
    const w = world;
    const toWorld = (lx: number, ly: number, lz: number) =>
      new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(spot);
    w?.collider?.(toWorld(0, 1.25, -0.85), new THREE.Vector3(2.3, 2.5, 0.5), this.yaw);
    w?.collider?.(toWorld(-1.1, 1.25, -0.15), new THREE.Vector3(0.1, 2.5, 1.9), this.yaw);
    w?.collider?.(toWorld(1.1, 1.25, -0.15), new THREE.Vector3(0.1, 2.5, 1.9), this.yaw);
    w?.collider?.(toWorld(0, 0.36, 0.45), new THREE.Vector3(2.3, 0.72, 0.84), this.yaw);
    w?.collider?.(toWorld(0, 2.55, 0.05), new THREE.Vector3(2.5, 0.1, 2.3), this.yaw);
    game.physics.refreshQueries();
    // cups on the counter (reachable from the ground: the counter is raccoon height)
    for (const lx of [-0.7, 0, 0.7]) this.slots.push(toWorld(lx, 0.73, 0.62));
    for (let i = 0; i < this.slots.length; i++) {
      this.cups.push(null);
      this.refillAt.push(0);
      this.spawnCup(i);
    }
    world?.poi?.set('espressoStand', spot.clone().addScaledVector(this.front, 1.8));
    // the barista (a normal human behind the counter; stays put, gets back up)
    try {
      const npcs = game.get<any>('npcs');
      const bp = toWorld(0.35, 0, -0.22);
      if (npcs?.spawn) {
        this.barista = npcs.spawn({
          type: 'pedestrian',
          position: bp,
          name: 'the Barista',
          outfit: { top: 0x2f6b4f, topAccent: 0xf3e6c8 },
          stationary: true,
          passive: true,
          holding: null,
          facing: this.yaw,
          wander: { center: bp, radius: 0.1 },
          seed: 4242,
        });
      }
    } catch (err) {
      console.warn('[chaos] barista spawn failed', err);
    }
  }

  private cupObject(): THREE.Object3D {
    if (!this.cupMats.length) {
      this.cupMats = [
        new THREE.MeshStandardMaterial({ color: 0xf6f1e7, roughness: 0.5 }),
        new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.8 }),
        new THREE.MeshStandardMaterial({ color: 0x2f6b4f, roughness: 0.4 }),
      ];
    }
    const [white, sleeve, lid] = this.cupMats;
    const g = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.058, 0.2, 14), white);
    cup.position.y = 0.1;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.074, 0.066, 0.08, 14), sleeve);
    band.position.y = 0.1;
    band.scale.setScalar(1.04);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.025, 14), lid);
    top.position.y = 0.21;
    g.add(cup, band, top);
    return g;
  }

  private spawnCup(i: number) {
    const game = this.game;
    const slot = this.slots[i];
    if (!slot) return;
    const e = spawnProp(
      game,
      {
        name: 'Triple-Shot Espresso',
        object: this.cupObject(),
        shape: 'cylinder',
        mass: 0.3,
        tags: ['grabbable', 'espresso', 'coffee', 'drink', 'washable'],
        sleeping: true,
        data: { grabLabel: 'Grab the triple shot', espresso: true },
      },
      slot,
      rand(0, Math.PI * 2),
    );
    this.cups[i] = e;
    // cups knocked off the counter stay in the world; keep at most a handful lying around
    this.spawned = this.spawned.filter((c) => c.alive);
    this.spawned.push(e);
    while (this.spawned.length > 9) {
      const old = this.spawned.find((c) => !c.data.heldByPlayer && !this.cups.includes(c));
      if (!old) break;
      this.spawned.splice(this.spawned.indexOf(old), 1);
      destroyProp(game, old);
    }
  }
  private spawned: Entity[] = [];

  // --------------------------------------------------------------------------------------------- chugging
  /** Drink a coffee entity Jimothy carries (tests: `chaos.espresso.chug()` drinks whatever he holds). */
  chug(e?: Entity | null) {
    const game = this.game;
    const pl = playerOf(game);
    if (!pl) return false;
    const ent = e ?? pl.held?.entity;
    if (!ent || !ent.alive || ent.data.consumed || ent.data.heldByNpc) return false;
    const pos = pl.position.clone();
    // consumed BEFORE the release: nobody (the owner it was stolen from, a quest NPC) may be handed it back
    ent.data.consumed = true;
    ent.data.owner = null;
    this.heldId = -1;
    this.heldFor = 0;
    if (pl.held?.entity === ent) pl.release(false);
    try {
      destroyProp(game, ent);
    } catch (err) {
      console.warn('[chaos] cup cleanup failed', err);
    }
    const wasActive = this.active;
    this.shots++;
    if (!this.active) {
      this.active = true;
      pl.speedMul *= SPEED_MUL;
      pl.jumpMul *= JUMP_MUL;
      this.until = game.time + MODE_SECS;
      this.total = MODE_SECS;
    } else {
      this.until = Math.min(game.time + MAX_SECS, this.until + EXTRA_SECS);
      this.total = Math.max(this.total, this.until - game.time);
    }
    const [word, sub] = SHOUTS[Math.min(SHOUTS.length - 1, this.shots - 1)];
    uiOf(game)?.celebrate?.(word, sub, '#c8864a');
    game.sfx('munch', pos, 1, 1.25);
    game.sfx('happy', pos, 0.9, 1.35);
    game.sfx('boing', pos, 0.6, 1.5);
    fx(game, 'sparkles', pos.clone().setY(pos.y + 0.5), { count: 16, color: 0xffc070, radius: 0.5 });
    fx(game, 'whoosh', pos, { dir: new THREE.Vector3(Math.sin(pl.facing), 0, Math.cos(pl.facing)) });
    rigOf(game)?.shake(0.4);
    game.score(wasActive ? 150 + 50 * this.shots : 200, wasActive ? word.charAt(0) + word.slice(1).toLowerCase() : 'Espresso Mode', pos.clone().setY(pos.y + 1));
    objSet(game, 'tripleShot', this.shots);
    game.events.emit('espresso', { shots: this.shots, until: this.until });
    // the barista approves
    const b = this.barista;
    if (b && !b.removed && !b.ragdolled && this.stand && pos.distanceTo(this.stand) < 12) {
      this.timers.after(0.8, () => b.say?.(CHUG_LINES[Math.min(CHUG_LINES.length - 1, this.shots - 1)], 2.6));
    }
    return true;
  }

  private end() {
    const game = this.game;
    const pl = playerOf(game);
    this.active = false;
    if (pl) {
      pl.speedMul /= SPEED_MUL;
      pl.jumpMul /= JUMP_MUL;
      if (Math.abs(pl.speedMul - 1) < 1e-6) pl.speedMul = 1;
      if (Math.abs(pl.jumpMul - 1) < 1e-6) pl.jumpMul = 1;
    }
    const shots = this.shots;
    this.shots = 0;
    if (shots >= 3 && pl && (pl.mode === 'walk' || pl.mode === 'roll') && playerFree(game)) {
      pl.ragdoll('caffeineCrash', 2.2);
      game.sfx('flop', pl.position, 0.9, 0.8);
      game.hint('CAFFEINE CRASH. Jimothy is lying down now. Forever. (Two seconds.)', 3.2);
    } else {
      game.hint('Espresso Mode wore off. Jimothy is merely fast-ish now.', 2.5);
    }
    game.events.emit('espressoEnd', { shots });
  }

  // --------------------------------------------------------------------------------------------- update
  update(dt: number) {
    const game = this.game;
    this.timers.tick();
    const pl = playerOf(game);
    if (!pl) return;
    // carried coffee
    const held: Entity | undefined = pl.held?.kind === 'carry' ? pl.held.entity : undefined;
    if (held && held.alive && held.tags.has('coffee')) {
      if (held.id !== this.heldId) {
        this.heldId = held.id;
        this.heldFor = 0;
      }
      this.heldFor += dt;
      if (held.tags.has('espresso')) {
        if (this.heldFor > AUTO_CHUG && !pl.washing && playerFree(game)) this.chug(held);
      } else if (!held.data?.decaf && playerFree(game)) {
        prompt(game, '{chitter} Chug the coffee', 0.3);
        if (game.input.pressed('chitter')) this.chug(held);
      }
    } else {
      this.heldId = -1;
      this.heldFor = 0;
    }
    // refill the counter
    for (let i = 0; i < this.slots.length; i++) {
      const cup = this.cups[i];
      const gone = !cup || !cup.alive || (cup.body && this.slotDist(cup, i) > 0.6);
      if (!gone) continue;
      if (cup) {
        this.cups[i] = null;
        this.refillAt[i] = game.time + 7;
      } else if (game.time >= this.refillAt[i]) {
        this.spawnCup(i);
        const b = this.barista;
        if (b && !b.removed && !b.ragdolled && Math.random() < 0.5) b.say?.('Order up!', 1.8);
      }
    }
    // the barista chats when Jimothy comes by
    this.baristaCd -= dt;
    const b = this.barista;
    if (b && this.stand && this.baristaCd <= 0 && !b.removed && !b.ragdolled && pl.position.distanceTo(this.stand) < 5.5) {
      this.baristaCd = 11;
      b.say?.(pick(BARISTA_LINES), 2.8);
      b.lookAt?.('player');
    }
    if (!this.active) return;
    // (SlopCorp's plug saves/restores speedMul while Jimothy hauls it: wear off only after he lets go)
    if (game.time >= this.until && !pl.held?.entity?.tags?.has('plug')) {
      this.end();
      return;
    }
    // the jitters
    const k = Math.min(3, this.shots);
    rigOf(game)?.shake(0.012 + 0.006 * k);
    this.whooshT -= dt;
    if (pl.speed > 7 && this.whooshT <= 0) {
      this.whooshT = 0.14;
      const v = pl.velocity as THREE.Vector3;
      fx(game, 'whoosh', pl.position, { dir: _v.copy(v).setY(0).normalize() });
    }
    this.chitterT -= dt;
    if (this.chitterT <= 0) {
      this.chitterT = rand(2.2, 4.5) / k;
      game.sfx('chitter', pl.position, 0.5, 1.45 + 0.1 * k);
    }
  }

  private slotDist(e: Entity, i: number) {
    const t = e.body!.translation();
    const s = this.slots[i];
    return Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z);
  }

  postPhysics() {
    if (!this.active) return;
    const pl = playerOf(this.game);
    const root: THREE.Object3D | undefined = pl?.model?.root;
    if (!root) return;
    // vibrating raccoon (the player re-sets his model position every frame; this is a per-frame offset)
    const a = 0.012 * Math.min(3, this.shots);
    root.position.x += rand(-a, a);
    root.position.y += rand(-a, a) * 0.6;
    root.position.z += rand(-a, a);
  }

  lateUpdate() {
    const show = this.active && hudShown(this.game);
    if (!show) {
      if (this.meter) this.meter.style.display = 'none';
      return;
    }
    this.ensureMeter();
    const left = clamp((this.until - this.game.time) / Math.max(1, this.total), 0, 1);
    this.meter!.style.display = 'block';
    this.fill!.style.width = `${(left * 100).toFixed(1)}%`;
    const j = 1.2 * Math.min(3, this.shots);
    this.meter!.style.transform = `translate(${rand(-j, j).toFixed(1)}px, ${rand(-j, j).toFixed(1)}px) rotate(${rand(-1, 1).toFixed(2)}deg)`;
    const secs = Math.ceil(Math.max(0, this.until - this.game.time));
    const txt = `☕ ${this.shots > 1 ? `${this.shots}× SHOTS` : 'ESPRESSO MODE'} · ${secs}s`;
    if (this.label!.textContent !== txt) this.label!.textContent = txt;
  }

  private ensureMeter() {
    if (this.meter) return;
    const host = document.getElementById('ui') ?? document.body;
    const m = document.createElement('div');
    m.className = 'chaos-espresso-meter';
    m.style.cssText =
      'position:absolute;left:16px;top:140px;width:176px;padding:8px 10px 9px;border-radius:14px;background:rgba(46,26,14,.84);' +
      "color:#fff4d8;font:15px 'Lilita One','Arial Black',sans-serif;letter-spacing:.5px;pointer-events:none;z-index:5;" +
      'box-shadow:0 3px 0 rgba(0,0,0,.35);border:2px solid #c8864a;display:none';
    const label = document.createElement('div');
    label.style.cssText = 'margin-bottom:5px;white-space:nowrap;text-shadow:0 2px 0 rgba(0,0,0,.4)';
    const bar = document.createElement('div');
    bar.style.cssText = 'height:10px;border-radius:6px;background:rgba(255,255,255,.18);overflow:hidden';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:100%;border-radius:6px;background:linear-gradient(90deg,#8a5a3c,#e0a060,#ffd27a)';
    bar.append(fill);
    m.append(label, bar);
    host.append(m);
    this.meter = m;
    this.fill = fill;
    this.label = label;
  }

  /** Debug/test: stand in front of the service window facing the middle cup. */
  visit() {
    const pl = playerOf(this.game);
    if (!pl || !this.stand || !this.slots.length) return false;
    const at = this.slots[1].clone().addScaledVector(this.front, 0.78);
    at.y = groundY(this.game, at.x, at.z, this.stand.y + 2) + 0.45;
    pl.teleport(at, this.yaw + Math.PI);
    return true;
  }
}
