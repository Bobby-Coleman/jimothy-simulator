import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { Jimothy } from '../../player/Jimothy';
import type { World } from '../../world/World';
import type { ObjectivesSystem } from '../Objectives';
import { BigRollBuild } from './BigRollBuild';
import { BigRollHud } from './BigRollHud';
import { GATES, LANES, MEDAL_RANK, START, TIERS, TIME_LIMIT, fmtTime, medalFor, type MedalId, type Tier } from './course';

/**
 * THE BIG ROLL — a bowling-ball race across town (system 'bigRoll').
 *
 * Walk up the stairs on the west side of Hilltop Lanes (top of Tumble St, behind the Furry Park viewpoint), stand on
 * the START pad and Tuck & Roll (Q): 3-2-1-GO, then roll off the kicker, over the viewpoint and through 7 checkpoint
 * rings (Tumble St, Old Ballard's farmers market + back alley, across the avenue into Downtown, the Space Noodle lawn
 * and round City Hall) to the finish line and a set of giant pins. Medals: Bronze (finish inside 2:30), Silver, Gold
 * and a very hard Platinum Pin (see course.ts TIERS; each is an Instinct).
 *
 * Rules (shown on the board and the HUD): gates count only in order and only while he is a ball — unrolling is
 * allowed (the clock keeps running) but he must tuck back in to take the next gate. A later gate reached early says
 * "missed checkpoint". Off course (> 45 m from the route for 6 s), 2:30 on the clock, a cutscene or a dialog cancels.
 * H (respawn) during a race, or up to 25 s after it, puts him back on the roof for a quick retry. Speed boosts
 * (Zoomies, espresso, low gravity) are allowed but cap the medal at Bronze.
 *
 * Saves: localStorage 'jimothy.bigroll.v1' { best, medal, runs, finishes }. Events: 'bigRollStart' {},
 * 'bigRollCheckpoint' { index, name, time }, 'bigRollFinish' { time, medal, assisted, best, pins },
 * 'bigRollCancel' { reason }. Debug: game.get('bigRoll').state / .next / .elapsed / .teleportToStart().
 */

type State = 'idle' | 'countdown' | 'race' | 'done';

const STORE = 'jimothy.bigroll.v1';
const OFF_COURSE_M = 45;
const OFF_COURSE_S = 6;
const RETRY_WINDOW = 25;
const COUNTDOWN = 3;

const OBJ_DEFS = [
  { id: 'bigRoll', category: 'raccoon', points: 2000, title: 'The Big Roll', desc: 'Bowl yourself from the Hilltop Lanes roof across town through every checkpoint. Bronze Pin for finishing.' },
  { id: 'bigRollSilver', category: 'raccoon', points: 2500, title: 'The Big Roll: Silver Pin', desc: 'Finish The Big Roll in under 0:52. Less sightseeing.' },
  { id: 'bigRollGold', category: 'raccoon', points: 3500, title: 'The Big Roll: Gold Pin', desc: 'Finish The Big Roll in under 0:40. Hold sprint and cut the corners.' },
  { id: 'bigRollPlatinum', category: 'raccoon', points: 6000, title: 'The Big Roll: Platinum Pin', desc: 'Finish The Big Roll in under 0:34. A perfect line, no bumps, no cars. Bowling legends only.' },
];

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

interface Save {
  best: number | null;
  medal: MedalId | null;
  runs: number;
  finishes: number;
}

export class BigRollSystem implements System {
  name = 'bigRoll';
  game!: Game;
  build!: BigRollBuild;
  hud: BigRollHud | null = null;
  state: State = 'idle';
  /** Index of the next gate to take. */
  next = 0;
  /** Seconds since GO (race) / final time (done). */
  elapsed = 0;
  assisted = false;
  lastResult: { time: number; medal: MedalId; assisted: boolean; cancelled?: string } | null = null;
  save: Save = { best: null, medal: null, runs: 0, finishes: 0 };
  private stateT = 0;
  private countN = 0;
  private held = false;
  private offT = 0;
  private promptT = 0;
  private padHintAt = -99;
  private warnMsg: string | null = null;
  private warnRed = false;
  private warnUntil = 0;
  private missedAt = -99;
  private hudT = 0;
  private finishPos = new THREE.Vector3();
  private strikeChecked = false;
  private startedAt = 0;
  private endedAt = -999;

  init(game: Game) {
    this.game = game;
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (s && typeof s === 'object') this.save = { ...this.save, ...s };
    } catch {
      /* fresh */
    }
    // (defs live in objectiveDefs.ts; these are a fallback if that list ever loses them)
    const objs = game.get<ObjectivesSystem>('objectives');
    for (const d of OBJ_DEFS) objs?.add(d as any);
    const world = game.get<World>('world')!;
    this.build = new BigRollBuild(game, world);
    this.build.build();
    game.physics.refreshQueries?.();
    this.build.updateBoard(this.save.best, this.save.medal);
    const last = GATES[GATES.length - 1];
    this.finishPos.set(last.x, this.build.gates[GATES.length - 1].groundY, last.z);
    game.events.on('respawn', () => this.onRespawn());
  }

  get player() {
    return this.game.get<Jimothy>('player');
  }

  get racing() {
    return this.state === 'race' || this.state === 'countdown';
  }

  /** Put Jimothy on the roof next to the start pad (debug / retry). */
  teleportToStart() {
    const p = this.player;
    if (!p) return;
    p.teleport(new THREE.Vector3(START.x, LANES.roofY + 0.5, START.z - 0.2), START.facing);
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const p = this.player;
    if (!p) return;
    if (!this.hud && this.game.get<any>('ui')?.root) this.hud = new BigRollHud(this.game);
    this.stateT += dt;
    switch (this.state) {
      case 'idle':
        this.updateIdle(p);
        break;
      case 'countdown':
        this.updateCountdown(p);
        break;
      case 'race':
        this.updateRace(p, dt);
        break;
      case 'done':
        this.knock(p);
        if (!this.strikeChecked && this.stateT > 1.8 && this.lastResult && !this.lastResult.cancelled) this.checkStrike();
        if (this.stateT > 1.5 && this.onPad(p)) {
          // back on the pad already (walked up again, or a cancelled start): a new race can begin
          this.build.showCourse(false);
          this.state = 'idle';
          this.stateT = 0;
        } else if (this.stateT > 9 && !this.nearFinish(p)) {
          this.build.showCourse(false);
          this.state = 'idle';
          this.stateT = 0;
        } else if (this.stateT > RETRY_WINDOW) {
          this.build.showCourse(false);
          this.state = 'idle';
          this.stateT = 0;
        }
        break;
    }
    if (this.state !== 'idle') this.build.animatePins(dt);
  }

  postPhysics() {
    // hold him on the pad through the countdown (after the physics step so nothing drifts him off)
    if (this.state === 'countdown' && this.held) this.pin();
  }

  lateUpdate() {
    const on = this.state === 'race' || this.state === 'countdown';
    const ui = this.game.get<any>('ui');
    const hudOk = !!ui && ui.mode === 'play' && ui.hudVisible !== false && this.game.state !== 'cutscene';
    this.hud?.show(on && hudOk);
  }

  private onPad(p: Jimothy) {
    const d = Math.hypot(p.position.x - START.x, p.position.z - START.z);
    return d < START.r && Math.abs(p.position.y - (LANES.roofY + 0.4)) < 1.2;
  }

  private nearFinish(p: Jimothy) {
    return Math.hypot(p.position.x - this.finishPos.x, p.position.z - this.finishPos.z) < 25;
  }

  private busy(): boolean {
    const g = this.game;
    if (g.state !== 'playing') return true;
    const ui = g.get<any>('ui');
    if (ui && (ui.mode !== 'play' || ui.dialog?.open)) return true;
    if (g.get<any>('camera')?.override) return true;
    if (g.get<any>('heartQuests')?.ctx?.inCutscene) return true;
    return false;
  }

  private updateIdle(p: Jimothy) {
    if (!this.onPad(p) || this.busy()) return;
    if (p.mode === 'roll') return this.beginCountdown(p);
    if (p.mode !== 'walk') return;
    const ui = this.game.get<any>('ui');
    this.promptT -= this.game.dt;
    if (this.promptT <= 0) {
      this.promptT = 0.2;
      ui?.setPrompt?.('{roll} Tuck & Roll to start THE BIG ROLL', 0.35);
    }
    if (this.game.time - this.padHintAt > 25) {
      this.padHintAt = this.game.time;
      const best = this.save.best != null ? ` Your best: ${fmtTime(this.save.best)}.` : '';
      this.game.hint(`THE BIG ROLL: 7 checkpoints to the pins by City Hall. Gates only count while you're a ball.${best} Platinum: under ${fmtTime(TIERS[3].time)}.`, 6);
    }
  }

  // ------------------------------------------------------------------ countdown
  private beginCountdown(p: Jimothy) {
    this.state = 'countdown';
    this.stateT = 0;
    this.countN = COUNTDOWN + 1;
    this.next = 0;
    this.elapsed = 0;
    this.assisted = false;
    this.offT = 0;
    this.warnMsg = null;
    this.lastResult = null;
    this.strikeChecked = false;
    this.build.resetPins();
    this.build.showCourse(true);
    this.build.setGateState(0);
    this.save.runs++;
    this.persist();
    p.frozen = true;
    this.held = true;
    this.pin();
    this.game.get<any>('camera')?.snapBehind?.(START.facing);
    this.game.get<any>('ui')?.banner?.('THE BIG ROLL', '7 checkpoints · then bowl the pins', 'Hilltop Lanes');
    this.game.sfx('crowd_ooh', undefined, 0.5);
    this.renderHud(p);
  }

  private pin() {
    const p = this.player;
    if (!p) return;
    p.body.setTranslation({ x: START.x, y: LANES.roofY + 0.4, z: START.z }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private release() {
    const p = this.player;
    if (this.held && p) p.frozen = false;
    this.held = false;
  }

  private updateCountdown(p: Jimothy) {
    if (this.busy()) return this.cancel('A cutscene rolled in. Race cancelled.', 'busy');
    if (p.mode !== 'roll') return this.cancel('Untucked on the start line. Race cancelled.', 'untucked');
    const n = COUNTDOWN - Math.floor(this.stateT);
    if (n !== this.countN) {
      this.countN = n;
      const ui = this.game.get<any>('ui');
      if (n > 0) {
        ui?.celebrate?.(String(n), n === 3 ? 'Tucked…' : n === 2 ? 'Aim for the ramp…' : 'Hold sprint!', '#ffd23f');
        this.game.sfx('score', undefined, 0.8, 0.7 + (3 - n) * 0.08);
      } else {
        ui?.celebrate?.('GO!', 'Hold sprint for max speed!', '#3fcf66');
        this.game.sfx('officer_whistle', undefined, 0.9);
        this.game.sfx('whoosh', undefined, 0.5, 0.8);
        this.startRace();
      }
    }
    this.renderHud(p);
  }

  private startRace() {
    this.release();
    this.state = 'race';
    this.stateT = 0;
    this.startedAt = this.game.time;
    this.game.events.emit('bigRollStart', {});
  }

  // ------------------------------------------------------------------ race
  private updateRace(p: Jimothy, dt: number) {
    const t = (this.elapsed = this.game.time - this.startedAt);
    if (this.busy()) return this.cancel('Something important came up (a cutscene). Race cancelled.', 'busy');
    if (t > TIME_LIMIT) return this.cancel(`${fmtTime(TIME_LIMIT)} and still rolling? The lanes are closed. Race cancelled.`, 'timeout');
    if (p.speedMul > 1.001 || p.gravityMul < 0.999 || p.jumpMul > 1.001) this.assisted = true;
    const rolling = p.mode === 'roll';
    const P = p.position;
    // gates
    const g = this.build.gates[this.next];
    if (g && rolling && this.inGate(P, this.next)) this.passGate(p, t);
    else if (rolling) {
      for (let k = this.next + 1; k < this.build.gates.length; k++) {
        if (this.inGate(P, k) && this.game.time - this.missedAt > 4) {
          this.missedAt = this.game.time;
          this.flashWarn(`Missed checkpoint ${this.next + 1}! Go back for ${GATES[this.next].name}: follow the beam.`, true, 4);
          this.game.sfx('ui_error', undefined, 0.7);
          break;
        }
      }
    }
    if (this.state !== 'race') return; // finished
    // off course: far from the segment between the last gate taken and the next one
    const a = this.next === 0 ? { x: START.x, z: START.z } : GATES[this.next - 1];
    const b = GATES[this.next];
    const off = distToSeg(P.x, P.z, a.x, a.z, b.x, b.z);
    this.offT = off > OFF_COURSE_M ? this.offT + dt : 0;
    if (this.offT > OFF_COURSE_S) return this.cancel('Jimothy wandered off the lanes. Race cancelled. (H: back to the roof)', 'offcourse');
    this.knock(p);
    this.build.animate(this.game.time, this.next, dt);
    this.renderHud(p);
  }

  private inGate(P: THREE.Vector3, k: number) {
    const g = this.build.gates[k];
    const dx = P.x - g.def.x;
    const dz = P.z - g.def.z;
    if (dx * dx + dz * dz > (g.def.r + 0.6) ** 2) return false;
    return P.y > g.groundY - 2 && P.y < g.groundY + g.def.r * 2 + 8;
  }

  private passGate(p: Jimothy, t: number) {
    const i = this.next;
    const def = GATES[i];
    this.next++;
    this.missedAt = -99;
    this.game.events.emit('bigRollCheckpoint', { index: i, name: def.name, time: t });
    if (this.next >= GATES.length) return this.finish(p, t);
    this.build.setGateState(this.next);
    this.game.sfx('coin', undefined, 0.8, 1 + i * 0.05);
    this.game.sfx('combo_up', undefined, 0.4, 1 + i * 0.04);
    this.game.get<any>('fx')?.emit?.('sparkles', this.build.gates[i].center.clone(), { count: 24, scale: 2 });
    let quip = def.quip;
    if (def.name === 'Speed Trap') {
      const mph = Math.round(p.speed * 2.237);
      quip = `Radar says ${mph} mph. The ticket is in the mail. Raccoons do not open mail.`;
    }
    this.game.hint(`Checkpoint ${i + 1}/${GATES.length - 1} · ${fmtTime(t)}${quip ? ` · ${quip}` : ''}`, 2.4);
  }

  private flashWarn(msg: string, red: boolean, secs: number) {
    this.warnMsg = msg;
    this.warnRed = red;
    this.warnUntil = this.game.time + secs;
  }

  private renderHud(p: Jimothy) {
    if (!this.hud) return;
    this.hudT -= this.game.dt;
    if (this.hudT > 0 && this.state === 'race') return;
    this.hudT = 1 / 20;
    const g = this.build.gates[Math.min(this.next, this.build.gates.length - 1)];
    const cam = this.game.get<any>('camera');
    let bearing = 0;
    const dx = g.center.x - p.position.x;
    const dz = g.center.z - p.position.z;
    if (cam?.forward) {
      cam.forward(_f);
      cam.right(_r);
      bearing = Math.atan2(dx * _r.x + dz * _r.z, dx * _f.x + dz * _f.z);
    }
    const t = this.state === 'race' ? this.elapsed : 0;
    let warn: string | null = null;
    let red = false;
    if (this.warnMsg && this.game.time < this.warnUntil) {
      warn = this.warnMsg;
      red = this.warnRed;
    } else if (this.state === 'race' && p.mode !== 'roll') {
      warn = 'UNTUCKED! {roll} Tuck & Roll: gates only count for bowling balls';
    } else if (this.state === 'race' && this.offT > 0) {
      warn = `Off course! Head for the beam (${Math.max(0, OFF_COURSE_S - this.offT).toFixed(0)} s)`;
      red = true;
    }
    this.hud.render({ time: t, next: this.next, bearing, dist: Math.hypot(dx, dz), pace: this.pace(t), assisted: this.assisted, warn, warnRed: red });
  }

  /** The best medal still reachable at time t. */
  private pace(t: number): Tier {
    if (this.assisted) return TIERS[0];
    let best = TIERS[0];
    for (const tier of TIERS) if (t < tier.time) best = tier;
    return best;
  }

  private knock(p: Jimothy) {
    if (Math.hypot(p.position.x - this.finishPos.x, p.position.z - this.finishPos.z) > 16) return;
    const v = p.body.linvel();
    const n = this.build.knockPins(p.position, _v.set(v.x, v.y, v.z), 1.3 * Math.max(1, p.sizeMul ?? 1));
    if (n > 0) {
      this.game.sfx('impact_wood', p.position, Math.min(1, 0.5 + n * 0.15), 0.9 + Math.random() * 0.3);
      this.game.get<any>('camera')?.shake?.(0.15);
    }
  }

  private checkStrike() {
    this.strikeChecked = true;
    const down = this.build.pinsDown;
    const ui = this.game.get<any>('ui');
    if (down >= 10) {
      ui?.celebrate?.('STRIKE!', 'All ten pins. He is the ball.', '#ff5f8f');
      this.game.score(500, 'Big Roll Strike', this.finishPos.clone());
      this.game.sfx('crowd_cheer', this.finishPos, 0.9);
      this.game.sfx('firework', this.finishPos, 0.6);
      this.game.get<any>('fx')?.emit?.('fireworks', this.finishPos.clone().add(new THREE.Vector3(0, 9, 0)), { count: 6 });
    } else if (down > 0) {
      this.game.score(down * 30, `${down} Pin${down > 1 ? 's' : ''}`, this.finishPos.clone());
    }
    if (this.lastResult) this.game.events.emit('bigRollPins', { pins: down });
  }

  // ------------------------------------------------------------------ outcomes
  private finish(p: Jimothy, t: number) {
    const assisted = this.assisted;
    const tier = medalFor(t, assisted);
    const prevBest = this.save.best;
    const newBest = !assisted && (prevBest == null || t < prevBest);
    if (newBest) this.save.best = t;
    const prevMedal = this.save.medal;
    if (!prevMedal || MEDAL_RANK[tier.id] > MEDAL_RANK[prevMedal]) this.save.medal = tier.id;
    this.save.finishes++;
    this.persist();
    this.lastResult = { time: t, medal: tier.id, assisted };
    this.endedAt = this.game.time;
    this.state = 'done';
    this.stateT = 0;
    this.elapsed = t;
    this.build.setGateState(GATES.length);
    this.build.updateBoard(this.save.best, this.save.medal);
    const objs = this.game.get<ObjectivesSystem>('objectives');
    for (const tr of TIERS) if (MEDAL_RANK[tr.id] <= MEDAL_RANK[tier.id]) objs?.complete(tr.objective);
    const ui = this.game.get<any>('ui');
    const sub = `${fmtTime(t)}${newBest ? ' · NEW BEST!' : prevBest != null && !assisted ? ` · best ${fmtTime(Math.min(prevBest, t))}` : ''}${assisted ? ' · boosted run: Bronze only' : ''}`;
    const nextTier = TIERS.find((x) => MEDAL_RANK[x.id] === MEDAL_RANK[tier.id] + 1);
    ui?.banner?.(`${tier.name.toUpperCase()}!`, sub, 'THE BIG ROLL');
    const tip = assisted
      ? 'Speed boosts (Zoomies, espresso, low gravity) cap the medal at Bronze.'
      : nextTier
        ? `${nextTier.name}: under ${fmtTime(nextTier.time)}. H: back to the roof for another go.`
        : 'PLATINUM. You are the ball. The ball is you. H: go again.';
    this.game.hint(tip, 6);
    this.game.score(150 * MEDAL_RANK[tier.id], `Big Roll ${fmtTime(t)}`, this.finishPos.clone());
    this.game.sfx('jingle_win', undefined, 0.8);
    this.game.sfx('crowd_cheer', this.finishPos, 0.8);
    this.game.get<any>('fx')?.emit?.('confetti', this.finishPos.clone().add(new THREE.Vector3(0, 2, 0)), { count: 140, scale: 1.4 });
    this.game.events.emit('bigRollFinish', { time: t, medal: tier.id, assisted, best: this.save.best, newBest });
    this.hud?.show(false);
  }

  private cancel(msg: string, reason: string) {
    this.release();
    const wasRace = this.state === 'race';
    this.lastResult = { time: this.elapsed, medal: 'bronze', assisted: this.assisted, cancelled: reason };
    this.endedAt = this.game.time;
    this.state = 'done';
    this.stateT = 0;
    this.build.showCourse(false);
    this.hud?.show(false);
    this.game.hint(msg, 4);
    if (wasRace) this.game.sfx('sad_trombone', undefined, 0.6);
    this.game.events.emit('bigRollCancel', { reason });
  }

  private onRespawn() {
    const quick = this.racing || this.game.time - this.endedAt < RETRY_WINDOW;
    if (!quick) return;
    if (this.racing) {
      this.release();
      this.game.events.emit('bigRollCancel', { reason: 'restart' });
    }
    this.state = 'idle';
    this.stateT = 0;
    this.build.showCourse(false);
    this.hud?.show(false);
    this.teleportToStart();
    this.padHintAt = this.game.time; // the retry hint below replaces the pad hint
    this.game.hint('Back on the Hilltop Lanes roof. Step on the pad and {roll} Tuck & Roll to go again.', 3.5);
  }

  private persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.save));
    } catch {
      /* ignore */
    }
  }

  /** Forget records (tests). */
  resetRecords() {
    this.save = { best: null, medal: null, runs: 0, finishes: 0 };
    this.persist();
    this.build.updateBoard(null, null);
  }
}

function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const L = vx * vx + vz * vz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L)) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}
