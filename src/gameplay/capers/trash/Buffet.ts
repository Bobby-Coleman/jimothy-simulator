import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { spawnItemFlying } from '../../items';
import {
  type CaperFeature, type Part, addObjective, objSet, paintMesh, T, TR, findClearSpot, groundY, playerOf, fx, celebrate, rand, pick,
  hudShown, nearCamera, Timers,
} from '../shared';
import { touchable } from './common';

/**
 * MIDNIGHT BUFFET. Six backyard garbage carts in the Residential Hills (the yards behind the Tumble St houses, by the
 * back fences). At night a glowing "gourmet" garbage bag (gold bow, a little star, stink lines and sparkles) sits next
 * to each one. Raid it (bonk it, grab it, or land on it): it bursts into 1–2 fancy snacks and a "Gourmet Garbage!"
 * popup. Raid all six in ONE night for the Instinct; the count resets each night. A small HUD pill counts while you're
 * in the Hills at night. By day the bins smell "ordinary" (a hint says come back after dark), and the Raccoon
 * Bulletin Board by the den advertises it.
 *
 * Objective 'midnightBuffet' (target 6, in one night). Events: 'buffetRaid' {index, count}, 'buffetComplete'.
 * Test hooks: `capers.byId.get('buffet').startNight()`, `.visit(i)`, `.raid(i)`, `.raidAll()`.
 */

const N = 6;
const LOT_Z0 = -67;
const LOT_LEN = (-67 - -143.5) / 5;
const lotZ = (k: number) => LOT_Z0 - LOT_LEN * (k + 0.5);
// [backX, dir, lot] — just inside the back fence of a Tumble St house's yard (pools at 0:2 and 1:1 are skipped)
const YARDS: [number, number, number][] = [
  [-29, 1, 1],
  [-29, 1, 3],
  [-29, 1, 4],
  [29, -1, 0],
  [29, -1, 2],
  [29, -1, 4],
];
const FOODS = ['pizza', 'sandwich', 'iceCream', 'grapes', 'fish', 'takeout', 'coffee'];
const RAID_WORDS = ['Gourmet Garbage!', 'Haute Cuisine!', 'Chef’s Kiss!', 'Five-Star Trash!', 'Bin Appétit!', 'Michelin Star Garbage!'];

interface Bag {
  pos: THREE.Vector3;
  bag: THREE.Group;
  ent: Entity | null;
  raided: boolean;
  sparkT: number;
  stinkT: number;
}

export class BuffetFeature implements CaperFeature {
  readonly id = 'buffet';
  readonly bags: Bag[] = [];
  private night = false;
  private raidedTonight = 0;
  private timers: Timers;
  private pill: HTMLDivElement | null = null;
  private dayHintCd = 0;
  private nightHintShown = false;
  private glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.6), toneMapped: false });
  private haloMat = new THREE.MeshBasicMaterial({ map: haloTexture(), color: new THREE.Color(1.6, 1.15, 0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  private t = 0;

  constructor(private game: Game) {
    this.timers = new Timers(game);
  }

  init() {
    const game = this.game;
    game.physics.refreshQueries(); // (zone colliders may not be in the query pipeline yet)
    addObjective(game, {
      id: 'midnightBuffet',
      category: 'raccoon',
      points: 2000,
      target: N,
      title: 'Midnight Buffet',
      desc: 'At night, glowing gourmet garbage bags appear by the backyard bins in the Residential Hills. Raid all 6 in one night.',
    });
    try {
      this.build();
    } catch (err) {
      console.warn('[capers] buffet failed to build', err);
    }
  }

  private build() {
    const game = this.game;
    const world = game.get<any>('world');
    const half = new THREE.Vector3(1.0, 0.6, 0.6);
    const binParts = (): Part[] => [
      { g: new THREE.BoxGeometry(0.62, 0.92, 0.66), c: 0x2f6b4a, m: T(0, 0.5, 0) },
      { g: new THREE.BoxGeometry(0.68, 0.06, 0.74), c: 0x24543a, m: TR(0, 0.98, 0.02, -0.05, 0, 0) },
      { g: new THREE.BoxGeometry(0.66, 0.08, 0.06), c: 0x1d3f2c, m: T(0, 0.9, -0.36) },
      { g: new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10), c: 0x222222, m: TR(-0.28, 0.08, -0.3, 0, 0, Math.PI / 2) },
      { g: new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10), c: 0x222222, m: TR(0.28, 0.08, -0.3, 0, 0, Math.PI / 2) },
    ];
    const allBins: Part[] = [];
    for (const [backX, dir, lot] of YARDS) {
      const x = backX + dir * 1.25;
      const z = lotZ(lot) + 5.4;
      const y = groundY(game, x, z, 40);
      const spot = findClearSpot(game, new THREE.Vector3(x, y, z), half, 0, { maxR: 2.5, step: 0.5, fromY: y + 4 }) ?? new THREE.Vector3(x, y, z);
      // the bin (merged into one mesh for all six) + its collider; the bag sits on its south side
      const yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2; // lid hinge toward the fence
      const binAt = spot.clone().add(new THREE.Vector3(-dir * 0.55, 0, 0));
      const m = new THREE.Matrix4().compose(binAt, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
      for (const p of binParts()) allBins.push({ ...p, m: m.clone().multiply(p.m ?? new THREE.Matrix4()) });
      world?.collider?.(binAt.clone().setY(binAt.y + 0.5), new THREE.Vector3(0.66, 1.0, 0.66), yaw);
      const bagPos = spot.clone().add(new THREE.Vector3(dir * 0.4, 0, 0));
      const bag = this.bagObject();
      bag.position.copy(bagPos);
      bag.rotation.y = rand(0, Math.PI * 2);
      bag.visible = false;
      game.scene.add(bag);
      this.bags.push({ pos: bagPos, bag, ent: null, raided: false, sparkT: rand(0, 1), stinkT: rand(0, 3) });
    }
    game.scene.add(paintMesh(allBins));
    game.physics.refreshQueries();
    world?.poi?.set('midnightBuffet', new THREE.Vector3(0, groundY(game, 0, -105, 40) + 0.2, -105));
  }

  /** A plump bag with a glowing gold bow and a little "gourmet" star above it. */
  private bagObject() {
    const g = new THREE.Group();
    const body = paintMesh([
      { g: new THREE.IcosahedronGeometry(0.4, 1), c: 0x3a2f4a, m: TR(0, 0.35, 0, 0, 0, 0, [1, 0.88, 1]) },
      { g: new THREE.ConeGeometry(0.11, 0.2, 7), c: 0x3a2f4a, m: T(0, 0.76, 0) },
      { g: new THREE.IcosahedronGeometry(0.14, 0), c: 0x4a3f5a, m: T(0.24, 0.52, 0.2) },
    ]);
    g.add(body);
    // a soft golden pool of light on the ground (additive) so the bag reads from across the yard at night
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.95, 24), this.haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.04;
    halo.renderOrder = 2;
    g.add(halo);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.028, 6, 12), this.glowMat);
    bow.position.y = 0.7;
    bow.rotation.x = Math.PI / 2;
    g.add(bow);
    for (const s of [-1, 1]) {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 5, 10), this.glowMat);
      loop.position.set(s * 0.09, 0.77, 0);
      loop.rotation.set(0, 0, s * 0.6);
      g.add(loop);
    }
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), this.glowMat);
    star.position.y = 1.25;
    star.name = 'star';
    g.add(star);
    return g;
  }

  private setNight(on: boolean) {
    const game = this.game;
    this.night = on;
    for (let i = 0; i < this.bags.length; i++) {
      const b = this.bags[i];
      if (on) {
        b.raided = false;
        b.bag.visible = true;
        b.bag.scale.setScalar(1);
        if (!b.ent) {
          b.ent = touchable(game, 'Gourmet Garbage', b.pos.clone().add(new THREE.Vector3(0, 0.36, 0)), new THREE.Vector3(0.36, 0.36, 0.36), {
            label: 'Raid the gourmet garbage',
            tags: ['buffet'],
            onBonk: () => this.raid(i),
            onGrab: () => this.raid(i),
          });
        }
        b.ent.body?.collider(0)?.setEnabled(true);
      } else {
        b.bag.visible = false;
        b.ent?.body?.collider(0)?.setEnabled(false);
      }
    }
    if (on) this.raidedTonight = 0;
    else if (this.raidedTonight > 0 && this.raidedTonight < N) game.hint(`Sunrise! The Midnight Buffet is closed (${this.raidedTonight}/${N}). Try again tomorrow night.`, 4);
  }

  raid(i: number) {
    const game = this.game;
    const b = this.bags[i];
    if (!b || b.raided || !this.night) return false;
    b.raided = true;
    b.ent?.body?.collider(0)?.setEnabled(false);
    this.raidedTonight++;
    const p = b.pos.clone().setY(b.pos.y + 0.5);
    fx(game, 'trash', p, { scale: 0.8 });
    fx(game, 'sparkles', p, { count: 22, radius: 0.5, color: 0xffd36a });
    fx(game, 'stink', p, { duration: 2.5 });
    game.sfx('rummage', p, 1, 1.15);
    game.sfx('happy', p, 0.7, 1.2);
    // pop the bag
    const t0 = game.time;
    const pop = () => {
      const k = (game.time - t0) / 0.25;
      if (k >= 1) {
        b.bag.visible = false;
        return;
      }
      b.bag.scale.set(1 + k * 0.5, 1 - k * 0.8, 1 + k * 0.5);
      this.timers.after(0, pop);
    };
    pop();
    const n = Math.random() < 0.5 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      this.timers.after(0.15 + k * 0.25, () => {
        const a = rand(0, Math.PI * 2);
        try {
          spawnItemFlying(game, pick(FOODS), p.clone().setY(p.y + 0.3), new THREE.Vector3(Math.cos(a) * 1.8, 4.8, Math.sin(a) * 1.8));
        } catch (err) {
          console.warn('[capers] buffet loot', err);
        }
      });
    }
    game.score(200, this.raidedTonight === 1 ? RAID_WORDS[0] : pick(RAID_WORDS), p.clone().setY(p.y + 0.8));
    objSet(game, 'midnightBuffet', this.raidedTonight);
    game.events.emit('buffetRaid', { index: i, count: this.raidedTonight });
    if (this.raidedTonight >= N) {
      celebrate(game, 'MIDNIGHT BUFFET', 'All six courses. Compliments to the bins.', '#ffd36a');
      game.events.emit('buffetComplete', {});
    } else if (this.raidedTonight === 1) {
      game.hint(`Gourmet Garbage! ${N - 1} more glowing bags in the Hills backyards before sunrise.`, 3.5);
    }
    return true;
  }

  // --------------------------------------------------------------------------------------------- hooks
  /** Test hook: jump the clock to 22:30. */
  startNight() {
    const env = this.game.get<any>('environment');
    if (env) env.timeOfDay = 22.5;
    this.update(0);
    return this.night;
  }

  visit(i = 0) {
    const b = this.bags[i];
    const pl = playerOf(this.game);
    if (!b || !pl) return false;
    const toward = new THREE.Vector3(Math.sign(-b.pos.x), 0, 0);
    pl.teleport(b.pos.clone().addScaledVector(toward, 1.6).setY(b.pos.y + 0.5), Math.atan2(-toward.x, -toward.z));
    return true;
  }

  raidAll() {
    let n = 0;
    for (let i = 0; i < this.bags.length; i++) if (this.raid(i)) n++;
    return n;
  }

  // --------------------------------------------------------------------------------------------- per frame
  update(dt: number) {
    const game = this.game;
    this.timers.tick();
    this.t += dt;
    const env = game.get<any>('environment');
    const night = !!env?.isNight;
    if (night !== this.night) this.setNight(night);
    const pl = playerOf(game);
    if (!pl) return;
    const pp = pl.position as THREE.Vector3;
    const inHills = pp.z < -60 && pp.z > -200 && Math.abs(pp.x) < 62;
    this.dayHintCd -= dt;
    if (!night) {
      if (inHills && this.dayHintCd <= 0) {
        for (const b of this.bags) {
          if (b.pos.distanceToSquared(pp) < 9) {
            this.dayHintCd = 90;
            game.hint('This bin smells… ordinary. Come back after dark: the Midnight Buffet opens at night.', 4);
            break;
          }
        }
      }
      return;
    }
    if (inHills && !this.nightHintShown && this.raidedTonight === 0) {
      this.nightHintShown = true;
      game.hint('Something smells GOURMET in the backyards tonight… (Midnight Buffet: 6 glowing bags)', 4.5);
    }
    for (let i = 0; i < this.bags.length; i++) {
      const b = this.bags[i];
      if (b.raided) continue;
      const d2 = b.pos.distanceToSquared(pp);
      if (d2 > 60 * 60) continue;
      const star = b.bag.getObjectByName('star');
      if (star) {
        star.rotation.y = this.t * 2;
        star.position.y = 1.25 + Math.sin(this.t * 2.4 + i) * 0.08;
      }
      if (!nearCamera(game, b.pos, 45)) continue;
      b.sparkT -= dt;
      if (b.sparkT <= 0) {
        b.sparkT = rand(0.35, 0.7);
        fx(game, 'glint', b.pos.clone().add(new THREE.Vector3(rand(-0.35, 0.35), rand(0.3, 0.9), rand(-0.35, 0.35))), {});
      }
      b.stinkT -= dt;
      if (b.stinkT <= 0) {
        b.stinkT = 3;
        fx(game, 'stink', b.pos.clone().setY(b.pos.y + 0.7), { duration: 3, scale: 0.7 });
      }
      // landing on a bag counts as a dive
      if (d2 < 1.2 && pl.velocity && pl.velocity.y < -1) {
        const dx = pp.x - b.pos.x;
        const dz = pp.z - b.pos.z;
        if (dx * dx + dz * dz < 0.5 * 0.5 && pp.y > b.pos.y + 0.6 && pp.y < b.pos.y + 1.4) this.raid(i);
      }
    }
  }

  lateUpdate() {
    const show = this.night && hudShown(this.game) && (this.raidedTonight > 0 || this.inHills());
    if (!show) {
      if (this.pill) this.pill.style.display = 'none';
      return;
    }
    if (!this.pill) {
      const el = document.createElement('div');
      el.className = 'capers-buffet-pill';
      el.style.cssText =
        'position:absolute;left:16px;top:196px;padding:7px 12px;border-radius:14px;background:rgba(24,20,48,.84);color:#ffe7a8;' +
        "font:15px 'Lilita One','Arial Black',sans-serif;letter-spacing:.5px;pointer-events:none;z-index:5;border:2px solid #ffd36a;" +
        'box-shadow:0 3px 0 rgba(0,0,0,.35);white-space:nowrap';
      (document.getElementById('ui') ?? document.body).append(el);
      this.pill = el;
    }
    this.pill.style.display = 'block';
    const txt = `🌙 Midnight Buffet · ${this.raidedTonight}/${N}`;
    if (this.pill.textContent !== txt) this.pill.textContent = txt;
  }

  private inHills() {
    const pp = playerOf(this.game)?.position as THREE.Vector3 | undefined;
    return !!pp && pp.z < -60 && pp.z > -200 && Math.abs(pp.x) < 62;
  }
}

/** Radial falloff texture for the ground halo. */
function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
