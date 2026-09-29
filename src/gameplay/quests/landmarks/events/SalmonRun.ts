import * as THREE from 'three';
import type { Entity } from '../../../../core/Entities';
import { Landmark } from '../Landmark';
import type { Actor } from '../kit/Actors';
import { Crowd } from '../kit/Crowd';
import { Path } from '../kit/Path';
import { cone, local, raceArch, scoreboard } from '../kit/Props';

interface Racer {
  actor: Actor;
  name: string;
  lane: number;
  s: number;
  /** Base speed at the start / at the end of the race (m/s). */
  v0: number;
  v1: number;
  finishedAt: number;
  lastSlap: number;
  idleSpot: THREE.Vector3;
}

const RACERS: { name: string; color: number; v0: number; v1: number; lane: number }[] = [
  { name: 'Sockeye Sam', color: 0xd6453d, v0: 7.0, v1: 5.9, lane: 1.4 },
  { name: 'Coho Cora', color: 0xe88a7a, v0: 6.3, v1: 6.3, lane: -1.4 },
  { name: 'King Kevin', color: 0xb35a4a, v0: 5.7, v1: 6.9, lane: 2.8 },
];
const TRASH_TALK = [
  'You? Race US? Heh. Sure, little guy.',
  'The Salmon Run waits for no raccoon.',
  'We swim upstream for a living. You roll.',
  'Step up to the line if you dare, fuzzball.',
];
const MAX_RACER_SPEED = 8.1; // Jimothy sprints at 8.8 m/s and rolls faster: always winnable

let tailGeo: THREE.BufferGeometry | null = null;
/** Vertical salmon tail fin (thin in X, spreads in Y, points toward -Z). */
function salmonTailGeometry() {
  if (tailGeo) return tailGeo;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-0.2, 0.3);
  s.quadraticCurveTo(0, 0.2, 0.2, 0.3);
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false });
  g.translate(0, 0, -0.0175);
  g.rotateZ(Math.PI / 2);
  g.rotateY(-Math.PI / 2);
  tailGeo = g;
  return g;
}

/** Give an NPC racer a tail fin on its pelvis bone so it reads as a salmon from behind (the view while chasing). */
function addTailFin(actor: Actor, color: number) {
  const rig = (actor as any).npc?.rig;
  const pelvis: THREE.Object3D | undefined = rig?.bones?.pelvis;
  const d = rig?.dims;
  if (!pelvis || !d) return;
  const c = new THREE.Color(color).multiplyScalar(0.8);
  const fin = new THREE.Mesh(salmonTailGeometry(), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
  fin.castShadow = true;
  fin.position.set(0, -0.02 * d.s, -(d.pelvisD ?? 0.2) * 0.62);
  fin.rotation.x = -0.35;
  fin.scale.setScalar(d.s ?? 1);
  pelvis.add(fin);
}
const FAN_LINES = ['GO JIMOTHY!', 'RUN, ROUND BOY, RUN!', 'SALMON RUN!', 'BARNACLES!', 'Is he rolling?!'];

/**
 * The Salmon Run @ Tee-Hee Park, "Jimothy Night" (POIs `salmonRunStart`, `salmonRunFinish`, optional
 * `salmonRun1..N` waypoints / `stadiumCenter`). idle → intro → countdown 3-2-1-GO → race → won/lost → reset.
 * Racers rubber-band so a sprinting or rolling Jimothy can always win; bonking them is legal (Goat Sim rules).
 */
export class SalmonRun extends Landmark {
  readonly id = 'salmon';
  readonly title = 'The Salmon Run';
  path!: Path;
  private start = new THREE.Vector3(120, 0, 120);
  private finish = new THREE.Vector3(120, 0, 120);
  private racers: Racer[] = [];
  private crowd!: Crowd;
  private sJ = 0;
  private raceStart = 0;
  private offCourseT = 0;
  private armed = true;
  private talkT = 2;
  private hudT = 0;
  private countdownN = 0;
  private result: 'won' | 'lost' | null = null;
  private board: ((title: string, rows: string[], hl?: number) => void) | null = null;

  setup() {
    this.crowd = new Crowd(this.kit);
    const k = this.kit;
    const start = k.poi('salmonRunStart');
    const finish = k.poi('salmonRunFinish');
    let pts: THREE.Vector3[];
    if (start && finish) {
      const way: THREE.Vector3[] = [];
      for (let i = 1; i < 40; i++) {
        const w = k.poi(`salmonRun${i}`);
        if (!w) break;
        way.push(w);
      }
      const center = k.poi('stadiumCenter') ?? k.poi('fieldCenter') ?? k.poi('pitchersMound');
      if (way.length) pts = [start, ...way, finish];
      else if (center) pts = Path.arc(center, start, finish, { stepDeg: 8 });
      else if (start.distanceTo(finish) < 20) {
        // loop start/finish without a known centre: oval next to the line
        const dir = Math.atan2(120 - start.x, 120 - start.z);
        const c = local(start, dir, -19, 0, 0);
        pts = Path.oval(c, dir, 40, 19);
      } else {
        const mid = start.clone().add(finish).multiplyScalar(0.5);
        const d = new THREE.Vector3().subVectors(finish, start);
        const n = new THREE.Vector3(d.z, 0, -d.x).normalize();
        // bulge toward the stadium zone centre side so we stay inside
        const toC = new THREE.Vector3(120 - mid.x, 0, 120 - mid.z);
        if (n.dot(toC) < 0) n.negate();
        const bulge = d.length() * 0.3;
        pts = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          pts.push(new THREE.Vector3().lerpVectors(start, finish, t).addScaledVector(n, Math.sin(t * Math.PI) * bulge));
        }
      }
      this.start.copy(start);
      this.finish.copy(finish);
    } else {
      // Fallback: ~200 m oval near the stadium zone.
      const spot = k.findClearSpot(118, 112, 24, 70);
      k.reserve(spot, 30);
      const yaw = 0;
      pts = Path.oval(spot, yaw, 40, 19);
      this.start.copy(pts[0]);
      this.finish.copy(pts[pts.length - 1]);
      const s0 = new Path(pts);
      // arches, cones, scoreboard
      const dir0 = s0.dir(0);
      const archYaw = Math.atan2(dir0.x, dir0.z);
      raceArch(k.world, k.onGround(this.start, 2, 6), archYaw, 'START · FINISH', 7);
      for (let s = 10; s < s0.length - 5; s += 10) {
        for (const side of [-1, 1]) {
          const p = s0.at(s).addScaledVector(s0.side(s), side * 3.8);
          const g = k.onGround(p, 2, 6);
          const c = cone();
          c.position.copy(g);
          k.world.addStatic(c, { collider: 'none' });
        }
      }
      const sbSpot = local(spot, yaw, 0, 0, 0);
      this.board = scoreboard(k.world, k.onGround(sbSpot, 2, 6), Math.atan2(this.start.x - sbSpot.x, this.start.z - sbSpot.z));
      k.world.poi.set('salmonRunStart', this.start.clone());
      k.world.poi.set('salmonRunFinish', this.finish.clone());
    }
    // Ground every waypoint (stadium floors may not be the terrain).
    const grounded = pts.map((p) => k.onGround(p, 3, 8));
    this.path = new Path(grounded);
    this.start.copy(grounded[0]);
    this.finish.copy(grounded[grounded.length - 1]);
    this.game.events.on('bonk', (p: { entity?: Entity }) => this.onBonk(p?.entity));
  }

  anchor() {
    return this.start;
  }

  hint() {
    if (this.done) return this.saved.best ? `Champion! Best time ${Number(this.saved.best).toFixed(1)} s. Beat it?` : 'Salmon Run champion.';
    return 'Step onto the Salmon Run start line at Tee-Hee Park (south-east). Sprint (Shift) or roll (Q) to win.';
  }

  debugSpot() {
    const d = this.path ? this.path.dir(0) : new THREE.Vector3(0, 0, 1);
    return { pos: this.start.clone().addScaledVector(d, -5).add(new THREE.Vector3(0, 1.2, 0)), facing: Math.atan2(d.x, d.z) };
  }

  // ------------------------------------------------------------------ racers
  private idleSpot(i: number) {
    const s = 0;
    const side = this.path.side(s);
    const back = this.path.dir(s).negate();
    return this.kit.onGround(this.start.clone().addScaledVector(side, -4.5 - i * 1.3).addScaledVector(back, 1.5 + (i % 2)), 2, 6);
  }

  private ensureRacers() {
    if (this.racers.length && this.racers.every((r) => r.actor.alive)) return;
    for (const r of this.racers) this.kit.removeActor(r.actor);
    this.racers = RACERS.map((def, i) => {
      const spot = this.idleSpot(i);
      const actor = this.kit.spawnActor({
        type: 'racer',
        name: def.name,
        position: spot,
        facing: Math.atan2(this.start.x - spot.x, this.start.z - spot.z),
        outfit: { salmon: def.color, shirt: def.color, pants: 0x2d3a55, shoes: 0xffffff },
        look: { topStyle: 'salmon', hat: 'salmonhood', top: def.color, hatColor: def.color },
        passive: true,
      });
      addTailFin(actor, def.color);
      return { actor, name: def.name, lane: def.lane, s: 0, v0: def.v0, v1: def.v1, finishedAt: 0, lastSlap: -10, idleSpot: spot };
    });
  }

  private despawnRacers() {
    for (const r of this.racers) this.kit.removeActor(r.actor);
    this.racers = [];
  }

  private onBonk(e: Entity | undefined) {
    if (!e) return;
    const r = this.racers.find((x) => x.actor.entity === e);
    if (!r) return;
    if (this.game.time - r.lastSlap < 2.5) return;
    r.lastSlap = this.game.time;
    this.game.score(this.state === 'race' ? 75 : 25, this.state === 'race' ? 'Salmon Slapped' : 'Pre-Race Bonk', r.actor.position.clone());
    this.kit.after(0.4, () => r.actor.alive && r.actor.say(['FISHY FOUL!', 'REF?!', 'Unsportsmanlike!', 'My fins!'][Math.floor(Math.random() * 4)], 2));
  }

  // ------------------------------------------------------------------ state machine
  update(dt: number) {
    this.stateTime += dt;
    const d = this.flatDist(this.start);
    const near = d < 80 || (this.state !== 'idle' && this.state !== 'reset');
    if (near) this.ensureRacers();
    else if (this.racers.length && d > 120) this.despawnRacers();

    switch (this.state) {
      case 'idle':
        this.updateIdle(dt, d);
        break;
      case 'intro':
        if (d > 14) return this.cancel('Race cancelled. The salmon return to their stretches.');
        if (this.stateTime > 1.8) {
          this.go('countdown');
          this.countdownN = 4;
        }
        break;
      case 'countdown': {
        const n = 3 - Math.floor(this.stateTime);
        if (n !== this.countdownN) {
          this.countdownN = n;
          if (n > 0) {
            this.kit.shout(String(n), n === 3 ? 'On your marks…' : n === 2 ? 'Get set…' : 'Fins ready…', '#ff8a65');
            this.game.sfx('score', undefined, 0.8, 0.8);
          } else {
            this.kit.shout('GO!', 'Sprint (Shift) or roll (Q)!', '#7cf07a');
            this.game.sfx('officer_whistle', this.start, 1);
            this.game.sfx('crowd_cheer', this.start, 0.8);
            this.beginRace();
          }
        }
        break;
      }
      case 'race':
        this.updateRace(dt);
        break;
      case 'finished':
        this.updateRacersAfter(dt);
        if (this.stateTime > 6) {
          this.kit.overlay.race(null);
          this.crowd.disperse(6);
          for (const r of this.racers) r.actor.moveTo(r.idleSpot, 2.2);
          this.go('reset');
        }
        break;
      case 'reset':
        if (this.stateTime > 4) this.go('idle');
        break;
    }
  }

  private updateIdle(dt: number, d: number) {
    if (!this.armed && d > 6) this.armed = true;
    if (d < 22 && this.racers.length) {
      this.talkT -= dt;
      if (this.talkT <= 0) {
        this.talkT = 7;
        const r = this.racers[Math.floor(Math.random() * this.racers.length)];
        r.actor.say(TRASH_TALK[Math.floor(Math.random() * TRASH_TALK.length)], 3);
        r.actor.cheer(1);
      }
    }
    if (this.armed && d < 3.5 && this.player && this.player.mode !== 'ragdoll' && Math.abs(this.player.position.y - this.start.y) < 3) this.beginIntro();
  }

  private beginIntro() {
    const k = this.kit;
    const p = this.player!;
    this.armed = false;
    this.result = null;
    this.go('intro');
    this.ensureRacers();
    const dir = this.path.dir(0);
    const yaw = Math.atan2(dir.x, dir.z);
    // Jimothy takes his mark (lane 0), racers line up beside him
    p.teleport(this.start.clone().addScaledVector(dir, -1).add(new THREE.Vector3(0, 0.6, 0)), yaw);
    p.frozen = true;
    for (const r of this.racers) {
      const spot = k.onGround(this.start.clone().addScaledVector(dir, -1).addScaledVector(this.path.side(0), r.lane), 2, 6);
      r.actor.teleport(spot, yaw);
      r.actor.stop();
      r.s = 0;
      r.finishedAt = 0;
    }
    this.sJ = 0;
    // fans at the finish
    const fin = this.finish.clone();
    const out = this.path.side(this.path.length).multiplyScalar(-6);
    this.crowd.gather({ center: fin.clone().add(out), faceTo: fin, count: 4, radius: 2.5, type: 'fan', names: ['Barnacles Fan', 'Superfan', 'Fan', 'Season Ticket Holder'], outfit: { jimothyTee: true, shirt: 0x0c2c56, hat: 'cap', hatColor: 0x0c2c56 }, look: { print: 'jimothy' }, from: 0 });
    k.banner('THE SALMON RUN', 'First to the finish wins!', 1.8, 'Jimothy Night at Tee-Hee Park');
    this.game.sfx('crowd_cheer', this.start, 0.9);
    this.racers[0]?.actor.say('May the best fish win.', 2.2);
    this.setStep(this.done ? this.step : 'racing');
  }

  private beginRace() {
    this.go('race');
    this.raceStart = this.game.time;
    this.offCourseT = 0;
    if (this.player) this.player.frozen = false;
    this.game.events.emit('salmonRunStart', {});
  }

  private cancel(msg: string) {
    if (this.player) this.player.frozen = false;
    this.kit.hint(msg, 3);
    this.kit.overlay.race(null);
    this.crowd.disperse(4);
    for (const r of this.racers) r.actor.moveTo(r.idleSpot, 2.2);
    this.go('reset');
  }

  private racerSpeed(r: Racer) {
    const L = this.path.length;
    const t = THREE.MathUtils.clamp(r.s / L, 0, 1);
    const base = r.v0 + (r.v1 - r.v0) * t;
    const lead = this.sJ - r.s; // >0: Jimothy ahead
    const k = THREE.MathUtils.clamp(1 + lead * 0.02, 0.8, 1.2);
    // tiny personality wobble
    const wob = 1 + Math.sin(this.game.time * 1.7 + r.lane * 3) * 0.04;
    return Math.min(MAX_RACER_SPEED, base * k * wob);
  }

  private stepRacer(r: Racer, dt: number, v: number) {
    const a = r.actor;
    if (!a.alive || a.down) return;
    const L = this.path.length;
    const pr = this.path.project(a.position, Math.max(0, r.s - 6), r.s + 12);
    r.s = Math.max(r.s, pr.s);
    const ahead = Math.min(L + 3, r.s + Math.max(1.5, v * 0.45));
    const lane = r.lane * THREE.MathUtils.clamp((L - r.s) / 12, 0.15, 1); // merge toward the line at the end
    const target = this.path.at(Math.min(ahead, L)).addScaledVector(this.path.side(Math.min(ahead, L)), lane);
    if (ahead > L) target.addScaledVector(this.path.dir(L), ahead - L);
    a.moveTo(target, v);
  }

  private updateRace(dt: number) {
    const p = this.player;
    if (!p) return;
    const L = this.path.length;
    const t = this.game.time - this.raceStart;
    // Jimothy's progress (windowed so shortcuts across the infield only gain a little)
    const pr = this.path.project(p.position, Math.max(0, this.sJ - 10), this.sJ + 22);
    if (pr.dist < 16) this.sJ = Math.max(this.sJ, pr.s);
    const nearest = this.path.project(p.position);
    this.offCourseT = nearest.dist > 45 ? this.offCourseT + dt : 0;
    if (this.offCourseT > 4) return this.cancel('Jimothy has left the race. The salmon are confused.');
    if (t > 150) return this.cancel('The Salmon Run timed out. Everyone went for hot dogs.');

    for (const r of this.racers) {
      if (r.finishedAt) {
        r.actor.stop();
        continue;
      }
      this.stepRacer(r, dt, this.racerSpeed(r));
      if (r.s >= L - 0.8) {
        r.finishedAt = t;
        r.actor.cheer(2);
        if (!this.result) this.lose(r);
      }
    }
    const jimDone = this.sJ >= L - 2.5 && p.position.distanceTo(this.finish) < 7;
    if (jimDone && !this.result) this.win(t);

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.12;
      this.renderStandings(t);
    }
  }

  private updateRacersAfter(dt: number) {
    const L = this.path.length;
    for (const r of this.racers) {
      if (r.finishedAt) continue;
      this.stepRacer(r, dt, 5.5);
      if (r.s >= L - 0.8) {
        r.finishedAt = this.game.time - this.raceStart;
        r.actor.stop();
      }
    }
  }

  private standings() {
    const L = this.path.length;
    const rows: { name: string; me: boolean; s: number; fin: number }[] = [
      { name: 'Jimothy', me: true, s: this.sJ, fin: this.result === 'won' ? Number(this.saved.last ?? 0) : 0 },
      ...this.racers.map((r) => ({ name: r.name, me: false, s: r.s, fin: r.finishedAt })),
    ];
    rows.sort((a, b) => {
      if (a.fin && b.fin) return a.fin - b.fin;
      if (a.fin) return -1;
      if (b.fin) return 1;
      return b.s - a.s;
    });
    return rows.map((r) => ({ name: r.name, me: r.me, note: r.fin ? `${r.fin.toFixed(1)}s` : `${Math.max(0, L - r.s).toFixed(0)} m` }));
  }

  private renderStandings(t: number) {
    const rows = this.standings();
    this.kit.overlay.race({ title: 'SALMON RUN', time: t, rows, progress: this.sJ / this.path.length });
    if (this.board) this.board('SALMON RUN', rows.map((r, i) => `${i + 1}. ${r.name.toUpperCase()}  ${r.note}`), rows.findIndex((r) => r.me));
  }

  private win(t: number) {
    const k = this.kit;
    this.result = 'won';
    this.saved.last = t;
    const first = !this.done;
    if (!this.saved.best || t < this.saved.best) this.saved.best = t;
    this.go('finished');
    this.renderStandings(t);
    k.banner('JIMOTHY WINS THE SALMON RUN!', `${t.toFixed(1)} s · The crowd goes wild`, 4, 'Jimothy Night');
    k.fx('confetti', this.finish.clone().add(new THREE.Vector3(0, 1.5, 0)), { count: 150, scale: 1.3 });
    k.fx('fireworks', this.finish.clone().add(new THREE.Vector3(0, 10, 0)), { count: 8 });
    this.game.sfx('crowd_cheer', this.finish, 1);
    this.game.sfx('firework', this.finish, 0.8);
    this.game.sfx('jingle_win', undefined, 0.8);
    this.crowd.cheer(FAN_LINES, 3, 2.4);
    for (const r of this.racers) {
      r.actor.expression('sad');
      r.actor.say(['Rematch!', 'Next year, raccoon.', 'He ROLLED! Is that legal?', 'Upstream was easier.'][Math.floor(Math.random() * 4)], 2.8);
    }
    this.game.events.emit('salmonRunWon', { time: t, first });
    if (first) {
      this.game.score(800, 'Salmon Run Champion', this.finish.clone());
      this.setStep('won');
      this.complete('rookie');
    } else {
      this.game.score(120, 'Salmon Run Repeat Champ', this.finish.clone());
      this.save();
    }
  }

  private lose(r: Racer) {
    const k = this.kit;
    this.result = 'lost';
    this.go('finished');
    k.banner('The salmon remain undefeated.', 'For now. Step on the start line to try again.', 3.5, 'Salmon Run');
    this.game.sfx('jingle_fail', undefined, 0.8);
    this.game.sfx('crowd_aww', this.finish, 0.7);
    r.actor.say('SALMON SUPREMACY!', 2.8, true);
    this.game.events.emit('salmonRunLost', { winner: r.name });
    this.renderStandings(this.game.time - this.raceStart);
    if (!this.done) this.setStep('lost');
  }
}
