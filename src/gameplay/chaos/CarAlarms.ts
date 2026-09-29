import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../core/Game';
import { G, groups } from '../../core/Physics';
import {
  type ChaosFeature, scanStaticCuboids, overlapBox, objSet, addObjective, playerFree, nearCamera,
  pick, playerOf, uiOf, Timers, fx,
} from './shared';

/**
 * CAR ALARMS. The parked cars of Old Ballard (Ballard Ave parking strips + the parking lot; batched static meshes,
 * found by their static colliders) get alarms: bonk one, land on its roof, roll into it, throw something at it, blow
 * something up next to it or spray it with a hydrant → WEE-OO honking + blinking hazard lights for ~9 s.
 * Nearby Seattleites display the famous Seattle Freeze: they get annoyed, look away and stare at their phones.
 *
 * Events: 'carAlarm' { position, cause, active, byPlayer }. Objective: 'carAlarmChoir' (3 alarms at once).
 */

const ALARM_SECS = 9;
const REARM_SECS = 11;

const FREEZE_LINES = [
  '*avoids eye contact*',
  'Not my car. Not my business.',
  '*stares at phone harder*',
  'Someone should do something. Not me, though.',
  "I'll post about this on the neighborhood forum.",
  '*sighs in Seattle*',
  "We don't talk about the alarm.",
  'Classic Ballard.',
  '*pretends to be a mailbox*',
];

const NOTES = [
  "Someone left a passive-aggressive note on the windshield: \"Some of us work from home.\"",
  'A note appears under the wiper: "Per my last note..."',
  'A sticky note on the windshield: "Please be mindful of the shared soundscape. :)"',
];

interface ParkedCar {
  i: number;
  center: THREE.Vector3;
  half: THREE.Vector3;
  yaw: number;
  cos: number;
  sin: number;
  top: number;
  alarmT0: number;
  alarmUntil: number;
  rearmAt: number;
  hornT: number;
  hornPhase: number;
  byPlayer: boolean;
  lights: THREE.Mesh | null;
  noted: boolean;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class CarAlarmFeature implements ChaosFeature {
  readonly id = 'carAlarms';
  readonly cars: ParkedCar[] = [];
  private timers: Timers;
  private bonkWindow = 0;
  private frame = 0;
  private lastChoir = -100;
  private notes = 0;
  private lightMat: THREE.MeshBasicMaterial | null = null;

  constructor(private game: Game) {
    this.timers = new Timers(game);
  }

  init() {
    const game = this.game;
    addObjective(game, {
      id: 'carAlarmChoir',
      category: 'chaos',
      points: 1200,
      target: 3,
      title: 'Car Alarm Choir',
      desc: 'Have 3 parked-car alarms going at once in Old Ballard. Nobody will make eye contact.',
    });
    // parked car colliders: ~2 × 1.5 × 4 m boxes, standing on the street (Old Ballard only)
    const found = scanStaticCuboids(
      game,
      (h, c) =>
        h.y > 0.5 && h.y < 0.95 && h.x > 0.8 && h.x < 1.15 && h.z > 1.6 && h.z < 2.2 && Math.abs(c.x) < 62 && Math.abs(c.z) < 62 && c.y < 3,
    );
    for (const f of found) {
      this.cars.push({
        i: this.cars.length,
        center: f.center,
        half: f.half,
        yaw: f.yaw,
        cos: Math.cos(f.yaw),
        sin: Math.sin(f.yaw),
        top: f.center.y + f.half.y,
        alarmT0: -100,
        alarmUntil: -100,
        rearmAt: 0,
        hornT: 0,
        hornPhase: 0,
        byPlayer: false,
        lights: null,
        noted: false,
      });
    }
    if (this.cars.length) game.get<any>('world')?.poi?.set('parkedCars', this.cars[0].center.clone());
    game.events.on('bonkStart', () => (this.bonkWindow = 0.36));
    game.events.on('land', (e: any) => this.onLand(e));
    game.events.on('explosion', (e: any) => this.onExplosion(e));
    game.events.on('hydrantBurst', (e: any) => this.onHydrant(e));
    console.info(`[chaos] ${this.cars.length} parked cars alarmed`);
  }

  /** Distance from p to the car's box (0 inside). */
  private boxDist(c: ParkedCar, p: THREE.Vector3, pad = 0) {
    const dx = p.x - c.center.x;
    const dz = p.z - c.center.z;
    // world → car local (rotation by -yaw about Y)
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    const ly = p.y - c.center.y;
    const ex = Math.max(0, Math.abs(lx) - c.half.x - pad);
    const ey = Math.max(0, Math.abs(ly) - c.half.y - pad);
    const ez = Math.max(0, Math.abs(lz) - c.half.z - pad);
    return Math.hypot(ex, ey, ez);
  }

  private footprint(c: ParkedCar, p: THREE.Vector3, pad = 0) {
    const dx = p.x - c.center.x;
    const dz = p.z - c.center.z;
    const lx = dx * c.cos - dz * c.sin;
    const lz = dx * c.sin + dz * c.cos;
    return Math.abs(lx) < c.half.x + pad && Math.abs(lz) < c.half.z + pad;
  }

  get activeCount() {
    const t = this.game.time;
    let n = 0;
    for (const c of this.cars) if (c.alarmUntil > t) n++;
    return n;
  }

  /** Set off car i (tests: `chaos.carAlarms.trigger(0)`). */
  trigger(car: ParkedCar | number, cause = 'script', byPlayer = true) {
    const game = this.game;
    const c = typeof car === 'number' ? this.cars[car] : car;
    if (!c) return false;
    const t = game.time;
    if (c.alarmUntil > t) {
      // already screaming: a fresh hit keeps it going a bit longer
      c.alarmUntil = Math.min(c.alarmT0 + ALARM_SECS * 1.6, Math.max(c.alarmUntil, t + 4));
      return false;
    }
    if (t < c.rearmAt) return false;
    c.alarmT0 = t;
    c.alarmUntil = t + ALARM_SECS;
    c.rearmAt = t + REARM_SECS;
    c.hornT = 0;
    c.hornPhase = 0;
    c.byPlayer = byPlayer;
    this.ensureLights(c);
    const top = _v.copy(c.center).setY(c.top + 0.6);
    game.sfx('impact_metal', top, 0.6);
    fx(game, 'exclaim', top.clone().setY(top.y + 0.6));
    const active = this.activeCount;
    if (byPlayer) {
      game.score(120, 'Car Alarm', top.clone());
      objSet(game, 'carAlarmChoir', active);
    }
    if (active >= 3 && t - this.lastChoir > 10) {
      this.lastChoir = t;
      if (byPlayer) game.score(500, 'Car Alarm Choir', top.clone().setY(top.y + 1));
      uiOf(game)?.celebrate?.('ALARM CHOIR!', `${active} cars. Zero eye contact.`, '#ffb020');
      game.sfx('crowd_laugh', top, 0.5);
    }
    game.events.emit('carAlarm', { position: c.center.clone(), cause, active, byPlayer, index: c.i });
    this.timers.after(0.7 + Math.random() * 0.5, () => this.freeze(c));
    return true;
  }

  /** The Seattle Freeze: annoyed, but no eye contact. */
  private freeze(c: ParkedCar) {
    const npcs = this.game.get<any>('npcs');
    if (!npcs?.near) return;
    const list: any[] = npcs.near(c.center, 16, (n: any) => !n.ragdolled && !n.removed && !n.isCustom && !n.passive);
    list.sort((a, b) => a.position.distanceToSquared(c.center) - b.position.distanceToSquared(c.center));
    let talkers = 0;
    for (const n of list.slice(0, 4)) {
      try {
        const away = _w.copy(n.position).sub(c.center).setY(0);
        if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
        away.normalize().multiplyScalar(6).add(n.position);
        n.lookAt(away.clone());
        n.setExpression('angry');
        n.emote('phone', 3.5);
        if (talkers < 2 && Math.random() < 0.8) {
          talkers++;
          const line = pick(FREEZE_LINES);
          this.timers.after(talkers * 0.7, () => {
            if (!n.removed && !n.ragdolled) n.say(line, 2.8);
          });
        }
      } catch {
        /* optional */
      }
    }
  }

  private ensureLights(c: ParkedCar) {
    if (c.lights) {
      c.lights.visible = true;
      return;
    }
    if (!this.lightMat) {
      this.lightMat = new THREE.MeshBasicMaterial({ toneMapped: false });
      this.lightMat.color.setRGB(3.2, 1.7, 0.35);
    }
    const hx = c.half.x / 0.95 - 0.14;
    const hz = c.half.z / 0.96 + 0.015;
    const y = c.half.y * 0.2;
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.26, 0.13, 0.07);
        g.translate(sx * hx, y, sz * hz);
        parts.push(g);
        // a little side marker too
        const s = new THREE.BoxGeometry(0.05, 0.1, 0.18);
        s.translate(sx * (c.half.x / 0.95 + 0.01), y, sz * (hz - 0.25));
        parts.push(s);
      }
    }
    const geo = mergeGeometries(parts, false) ?? new THREE.BoxGeometry(0.1, 0.1, 0.1);
    for (const p of parts) p.dispose();
    const m = new THREE.Mesh(geo, this.lightMat);
    m.position.copy(c.center);
    m.rotation.y = c.yaw;
    m.castShadow = false;
    m.receiveShadow = false;
    this.game.scene.add(m);
    c.lights = m;
  }

  // --------------------------------------------------------------------------------------------- triggers
  private onLand(e: any) {
    const game = this.game;
    const pl = playerOf(game);
    if (!pl?.position || !playerFree(game)) return;
    const p: THREE.Vector3 = pl.position;
    for (const c of this.cars) {
      if (!this.footprint(c, p, 0.25)) continue;
      if (p.y - 0.38 < c.top - 0.35 || p.y - 0.38 > c.top + 0.6) continue;
      this.trigger(c, (e?.height ?? 0) > 2 ? 'stomp' : 'land', true);
      break;
    }
  }

  private onExplosion(e: any) {
    const p: THREE.Vector3 | undefined = e?.position;
    if (!p) return;
    const r = (e.radius ?? 6) * 1.8 + 2;
    for (const c of this.cars) {
      const d = c.center.distanceTo(p);
      if (d < r) this.timers.after(0.1 + d * 0.06 + Math.random() * 0.2, () => this.trigger(c, 'explosion', true));
    }
  }

  private onHydrant(e: any) {
    const p: THREE.Vector3 | undefined = e?.position;
    if (!p) return;
    for (const c of this.cars) {
      if (this.boxDist(c, p) < 4.5) this.timers.after(0.5 + Math.random() * 0.4, () => this.trigger(c, 'hydrant', !!e.byPlayer));
    }
  }

  update(dt: number) {
    const game = this.game;
    this.timers.tick();
    if (!this.cars.length) return;
    const pl = playerOf(game);
    this.bonkWindow -= dt;
    if (pl?.position && playerFree(game)) {
      const p: THREE.Vector3 = pl.position;
      const bonking = this.bonkWindow > 0;
      const rolling = pl.mode === 'roll' && pl.speed > 4.5;
      const flying = pl.mode === 'ragdoll' && pl.velocity?.length?.() > 6.5;
      if (bonking || rolling || flying) {
        const probe = _v.copy(p);
        if (bonking) probe.addScaledVector(_w.set(Math.sin(pl.facing), 0, Math.cos(pl.facing)), 0.42);
        for (const c of this.cars) {
          if (Math.abs(p.x - c.center.x) > 6 || Math.abs(p.z - c.center.z) > 6) continue;
          if (this.boxDist(c, probe) > (bonking ? 0.62 : 0.5)) continue;
          if (this.trigger(c, bonking ? 'bonk' : rolling ? 'roll' : 'player', true) && bonking) this.bonkWindow = 0;
          break;
        }
      }
    }
    // thrown props / flying humans hitting parked cars
    this.frame++;
    if (this.frame % 5 === 0) {
      const filter = groups(G.ALL, G.PROP | G.RAGDOLL);
      for (const c of this.cars) {
        if (c.alarmUntil > game.time || game.time < c.rearmAt || !nearCamera(game, c.center, 70)) continue;
        const cols = overlapBox(game, c.center, _w.copy(c.half).addScalar(0.2), c.yaw, filter);
        for (const col of cols) {
          const b = col.parent();
          if (!b || !b.isDynamic()) continue;
          const e = game.entities.fromCollider(col);
          if (e?.data?.heldByPlayer) continue;
          const lv = b.linvel();
          if (Math.hypot(lv.x, lv.y, lv.z) < 4) continue;
          this.trigger(c, e?.kind === 'npc' ? 'ragdoll' : 'prop', !!pl?.position && pl.position.distanceTo(c.center) < 35);
          break;
        }
      }
    }
    // alarms: honk + blink
    const t = game.time;
    for (const c of this.cars) {
      if (!c.lights) continue;
      if (c.alarmUntil <= t) {
        if (c.lights.visible) {
          c.lights.visible = false;
          if (c.byPlayer && !c.noted && this.notes < 3 && Math.random() < 0.6) {
            c.noted = true;
            game.hint(NOTES[this.notes++ % NOTES.length], 3.5);
          }
        }
        continue;
      }
      const age = t - c.alarmT0;
      c.lights.visible = Math.floor(age * 5) % 2 === 0;
      c.hornT -= dt;
      if (c.hornT <= 0) {
        c.hornT = 0.5;
        c.hornPhase ^= 1;
        game.sfx('car_horn', c.center, 0.42, c.hornPhase ? 1.32 : 0.98);
      }
    }
  }

  /** Debug/test: teleport next to car i (facing its side). */
  visit(i = 0) {
    const c = this.cars[i];
    const pl = playerOf(this.game);
    if (!c || !pl) return false;
    // stand beside the car on its local +x side (sidewalk or lane)
    const side = new THREE.Vector3(c.cos, 0, -c.sin);
    const at = c.center.clone().addScaledVector(side, c.half.x + 0.9);
    at.y = c.center.y - c.half.y + 0.5;
    pl.teleport(at, Math.atan2(c.center.x - at.x, c.center.z - at.z));
    return true;
  }
}
