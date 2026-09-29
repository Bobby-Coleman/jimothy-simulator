import * as THREE from 'three';
import type { Entity } from '../core/Entities';
import type { Objective, ObjectivesSystem } from '../gameplay/Objectives';
import type { WaterSystem, WaterVolume } from '../world/Water';
import { h, esc, fmt } from './dom';
import { ICONS } from './icons';
import { fillTokens } from './glyphs';
import { categoryInfo } from './ObjectivesView';
import type { UiCtx } from './types';

/**
 * The gentle nudge: "Suggested next" Instincts, one tracked goal (HUD pill + world waypoint + big-map ring) and a
 * short contextual onboarding coach for first-time players. Goat-Sim sandbox rules: never blocks, never nags.
 *
 * Suggestions come from a curated early-game order (cotton candy → Mom's snacks → trash → quests → landmarks…),
 * nudged by distance. Targets are resolved live (nearest cotton candy, nearest puddle while holding it, Mom while
 * carrying food, quest/landmark status positions, world POIs). The player can pin any suggestion (or a map icon);
 * otherwise the top suggestion is auto-tracked.
 *
 * API (ui.guide): suggestions, current(), track(id), trackPoi(name, label), untrack(), isTracked(id), entryForPoi(name)
 * Emits 'guideTrack' { id, label } when the tracked goal changes. Persists in localStorage 'jimothy.guide.v1'.
 */

export interface GuideTarget {
  pos: THREE.Vector3;
  label: string;
  /** Map POIs: `pos.y` isn't necessarily where you stand (billboard catwalk…), so only flat distance counts. */
  flat?: boolean;
}

export interface Suggestion {
  id: string;
  title: string;
  /** Short instruction; may contain {action} tokens. */
  how: string;
  category: string;
  progress: string;
  target: GuideTarget | null;
  dist: number | null;
}

interface Env {
  game: UiCtx['game'];
  player: any;
  night: boolean;
  held: Entity | null;
}

interface Def {
  id: string;
  rank: number;
  how?: string;
  place?: string;
  poi?: string;
  quest?: string;
  landmark?: string;
  target?: (e: Env) => GuideTarget | null;
  howFn?: (e: Env) => string | null;
  bonus?: (e: Env) => number;
}

const STORE = 'jimothy.guide.v1';
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function entPos(e: Entity, out: THREE.Vector3): THREE.Vector3 | null {
  try {
    if (e.body) {
      const t = e.body.translation();
      return out.set(t.x, t.y, t.z);
    }
  } catch {
    return null;
  }
  return e.object ? e.object.getWorldPosition(out) : null;
}

/** Nearest live entity with `tag` (optionally filtered) within `maxD` metres of the player. */
function nearestTagged(env: Env, tag: string, maxD: number, ok?: (e: Entity) => boolean): { e: Entity; pos: THREE.Vector3 } | null {
  const p = env.player?.position as THREE.Vector3 | undefined;
  if (!p) return null;
  let best: Entity | null = null;
  let bd = maxD * maxD;
  for (const e of env.game.entities.withTag(tag)) {
    if (e.data?.heldByPlayer || (ok && !ok(e))) continue;
    const q = entPos(e, _w);
    if (!q) continue;
    const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2 + (q.y - p.y) ** 2 * 0.25;
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  if (!best) return null;
  const pos = entPos(best, new THREE.Vector3());
  return pos ? { e: best, pos } : null;
}

const WATER_LABEL: Record<string, string> = {
  puddle: 'Puddle',
  fountain: 'Fountain',
  pond: 'Pond',
  bay: 'Salmon Bay',
  birdbath: 'Birdbath',
  pool: 'Pool',
  sink: 'Sink',
  sprinkler: 'Sprinkler',
  toilet: 'Toilet (ew)',
  ladder: 'Fish ladder',
};

/** Nearest washing water (edge distance), as a target. */
function nearestWater(env: Env): GuideTarget | null {
  const water = env.game.get<WaterSystem>('water');
  const p = env.player?.position as THREE.Vector3 | undefined;
  if (!water || !p) return null;
  let best: WaterVolume | null = null;
  let bd = Infinity;
  const pt = new THREE.Vector3();
  for (const v of water.volumes) {
    if (!v.enabled || v.kind === 'server-coolant') continue;
    let x: number;
    let z: number;
    if (v.radius != null) {
      const dx = p.x - v.center.x;
      const dz = p.z - v.center.z;
      const l = Math.hypot(dx, dz);
      const k = l > v.radius ? (v.radius * 0.8) / l : 0;
      x = v.center.x + dx * k;
      z = v.center.z + dz * k;
    } else {
      x = THREE.MathUtils.clamp(p.x, v.center.x - v.halfX * 0.9, v.center.x + v.halfX * 0.9);
      z = THREE.MathUtils.clamp(p.z, v.center.z - v.halfZ * 0.9, v.center.z + v.halfZ * 0.9);
    }
    const d = Math.hypot(x - p.x, z - p.z) + Math.abs(v.surfaceY - p.y) * 0.5;
    if (d < bd) {
      bd = d;
      best = v;
      pt.set(x, v.surfaceY, z);
    }
  }
  return best ? { pos: pt, label: WATER_LABEL[best.kind] ?? 'Water' } : null;
}

function poiTarget(env: Env, name: string, label: string): GuideTarget | null {
  const p = env.game.get<any>('world')?.poi?.get?.(name) as THREE.Vector3 | undefined;
  return p ? { pos: p.clone(), label, flat: true } : null;
}

/**
 * Seattle rule (Jimothy.ts): while it rains on him the whole city is a sink. The weather hint says "Wash anything!",
 * so don't march the player 12 m to a puddle at the same time: the target is right where he stands.
 */
function rainHere(env: Env): GuideTarget | null {
  return env.game.get<any>('weather')?.rainingOnPlayer ? { pos: env.player.position.clone(), label: 'Wash anywhere (rain)', flat: true } : null;
}

const heldTag = (env: Env, tag: string) => !!env.held?.tags?.has(tag);

/** Quest texts carry keyboard hints like "(Q)": turn them into {action} tokens so pads / touch get their own chips. */
const KEY_TOKENS: Record<string, string> = { Q: 'roll', C: 'chitter', R: 'wash', E: 'grab', F: 'bonk', Z: 'flop', Space: 'jump', Shift: 'sprint', Tab: 'objectives' };
function chipify(text: string): string {
  return text.replace(/\((Q|C|R|E|F|Z|Space|Shift|Tab)\)/g, (_m, k: string) => `{${KEY_TOKENS[k]}}`);
}

/** The curated order. `rank` is roughly "how early in a first session this is fun"; distance nudges it. */
const DEFS: Def[] = [
  {
    id: 'cottonCandy',
    rank: 1,
    place: 'Cotton candy cart',
    poi: 'cottonCandyCart',
    target: (env) => {
      if (heldTag(env, 'cottoncandy')) return rainHere(env) ?? nearestWater(env);
      const n = nearestTagged(env, 'cottoncandy', 160);
      return n ? { pos: n.pos, label: 'Cotton candy' } : poiTarget(env, 'cottonCandyCart', 'Cotton candy cart');
    },
    howFn: (env) =>
      heldTag(env, 'cottoncandy')
        ? rainHere(env)
          ? "It's raining, so the whole city is a sink: hold {wash} right here. What could possibly go wrong?"
          : 'Take it to a puddle and hold {wash} to scrub. What could possibly go wrong?'
        : '{grab} Grab cotton candy from the cart, then hold {wash} in a puddle.',
  },
  {
    id: 'mamasBoy',
    rank: 2,
    place: "Mom's den",
    poi: 'den',
    target: (env) => {
      const den = heartTarget(env, 'mama') ?? poiTarget(env, 'den', 'Mom')?.pos ?? null;
      if (heldTag(env, 'food') && den) return { pos: den, label: 'Mom' };
      // Real snacks, not the cotton candy (that one is for washing) or garbage.
      const n = nearestTagged(env, 'food', 45, (e) => !e.tags.has('trash') && !e.tags.has('cottoncandy') && !e.data?.momClaimed);
      if (n) return { pos: n.pos, label: n.e.name || 'Snack' };
      return poiTarget(env, 'hotDogCart', 'Hot dog cart') ?? (den ? { pos: den, label: 'Mom' } : null);
    },
    howFn: (env) => (heldTag(env, 'food') ? 'Drop the snack next to Mom with {grab}. She is so proud of you.' : 'Mom wants snacks! {grab} Grab food (the hot dog cart is close) and drop it by the den.'),
  },
  {
    id: 'trashTornado',
    rank: 3,
    target: (env) => {
      const n = nearestTagged(env, 'trashcan', 70, (e) => !e.data?.tipped);
      return n ? { pos: n.pos, label: 'Trash can' } : null;
    },
    how: '{bonk} Bonk trash cans over, or roll into them. The bins had it coming.',
  },
  {
    id: 'dumpsterDiver',
    rank: 3.6,
    target: (env) => {
      const n = nearestTagged(env, 'dumpster', 90);
      return n ? { pos: n.pos, label: 'Dumpster' } : null;
    },
    how: '{jump} Jump into a dumpster. Brunch is served.',
  },
  {
    id: 'wash10',
    rank: 5,
    target: (env) => (env.held ? rainHere(env) ?? nearestWater(env) : null),
    howFn: (env) =>
      env.held ? (rainHere(env) ? "It's raining: hold {wash} right here. Anything. Everything." : 'Take it to water and hold {wash}. Puddles count!') : '{grab} Grab anything, then hold {wash} near water.',
  },
  { id: 'awww', rank: 6, how: '{chitter} Chitter at people. Watch them melt.' },
  { id: 'teddyRescue', rank: 7, quest: 'teddy', poi: 'sadKid', place: 'Sad kid' },
  { id: 'familyReunion', rank: 8, quest: 'danny', poi: 'dannyLawn', place: 'Danny' },
  { id: 'kitCollector', rank: 9, quest: 'kits' },
  { id: 'crowDeals', rank: 10, quest: 'crows', poi: 'crowTree', place: 'Crow tree' },
  { id: 'grandmasFavorite', rank: 11, quest: 'grandma', poi: 'grandmaPorch', place: 'Grandma Rosie', bonus: (env) => (env.night ? -7 : 2) },
  { id: 'jimothySummer', rank: 12, landmark: 'summer', poi: 'cityHallPodium', place: 'City Hall' },
  { id: 'spaceNoodle', rank: 13, landmark: 'noodle', poi: 'spaceNoodleBase', place: 'Space Noodle' },
  { id: 'honoraryDegree', rank: 14, landmark: 'degree', poi: 'gradStage', place: 'Graduation stage' },
  { id: 'catchOfTheDay', rank: 15, landmark: 'catch', poi: 'fishMarket', place: "Pike's Plaice" },
  { id: 'salmonRun', rank: 16, landmark: 'salmon', poi: 'salmonRunStart', place: 'Salmon Run start' },
  { id: 'touchGrass', rank: 17, poi: 'serverPlug', place: 'SlopCorp plug', how: "{grab} Grab SlopCorp's giant plug and drag it out. Everyone go outside." },
  { id: 'countToFive', rank: 18, poi: 'slopBillboard', place: 'Six-fingered billboard', how: 'Climb to the billboard catwalk and hold {wash} to wash the slop off. Fingers: fixed.' },
  { id: 'washSlop', rank: 19, poi: 'slopSpawner', place: 'SlopCorp portal', how: 'Slopothys melt in water: hold {wash} next to them, or lure them into puddles.' },
  { id: 'dragonRider', rank: 19.5, poi: 'dragonPad', place: 'Dragon pad', how: 'When the Slop Dragon lands on its pad, {grab} grab it and hold on.' },
  { id: 'rookieCard', rank: 20, landmark: 'rookieCard', poi: 'rookieCard', place: 'Dugout' },
  { id: 'stickySituation', rank: 21, poi: 'gumWall', place: 'Gum Wall', how: 'Get stuck to the Gum Wall. Ew. Ewww.' },
  {
    id: 'bobbleheadCollector',
    rank: 22,
    target: (env) => {
      const c = env.game.get<any>('collectibles');
      const n = c?.nearest?.(env.player.position);
      return n ? { pos: n.position, label: 'Golden bobblehead' } : null;
    },
    how: 'Golden bobbleheads glow and have a light beam. Look up!',
  },
  { id: 'notACat', rank: 23, how: "Wait near people until someone says 'here kitty kitty'. Then turn around." },
  { id: 'cryptid', rank: 24, how: 'Let people film you. Tourists love a blurry cryptid.' },
  // chaos toys
  { id: 'tripleShot', rank: 4.5, poi: 'espressoStand', place: 'Bean Me Up Espresso', how: '{grab} Grab a triple shot at the raccoon-height window. Then another. Then another.' },
  { id: 'hydrantHydraulics', rank: 6.5, poi: 'hydrant', place: 'Fire hydrant', how: '{bonk} Bonk a fire hydrant. Ride the geyser. Wash stuff in the puddle.' },
  { id: 'tourStrike', rank: 13.5, poi: 'tourGroup', place: 'Tour group', how: 'Tuck & Roll {roll} into the tour group at the Space Noodle. Sprint for a PERFECT GAME.' },
  { id: 'carAlarmChoir', rank: 25, poi: 'parkedCars', place: 'Parked cars', how: '{bonk} Set off three car alarms at once on Old Ballard Ave. Nobody will make eye contact.' },
];

/** Big-map POIs that stand for a guide entry even when it has no poi (click-to-track). */
const POI_ALIASES: Record<string, string> = { den: 'mamasBoy', hotDogCart: 'mamasBoy', teddy: 'teddyRescue', dean: 'honoraryDegree', mayor: 'jimothySummer', spaceNoodleTop: 'spaceNoodle', fishCatch: 'catchOfTheDay', teeHeePark: 'salmonRun', stadiumCenter: 'salmonRun' };

function heartTarget(env: Env, id: string): THREE.Vector3 | null {
  try {
    const q = env.game.get<any>('heartQuests')?.quest?.(id);
    const t = q?.target?.();
    return t ? t.clone() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------- coach

interface CoachStep {
  text: string;
  touch?: string;
  done?: (c: Coach) => boolean;
  /** Seconds before moving on regardless. */
  max: number;
  /** Seconds after the previous step (for the delayed extras). */
  delay?: number;
}

const COACH: CoachStep[] = [
  { text: '{move} Waddle  ·  {look} Look around', done: (c) => c.moved > 2.5 || c.moveT > 1.2, max: 14 },
  { text: '{jump} Jump — hold it against walls, trees and poles to climb', done: (c) => c.jumped, max: 9 },
  { text: '{sprint} Sprint  ·  {roll} Tuck & Roll. He is basically a ball.', touch: 'Push the stick all the way to sprint  ·  {roll} Tuck & Roll', done: (c) => c.rolled, max: 9 },
  { text: 'Follow the ★ marker to a suggested Instinct  ·  {objectives} shows them all', max: 6 },
  { text: '{map} Map  ·  {photo} Photo mode  ·  {slowmo} Slow-mo  ·  {respawn} Back to the den', touch: 'Tap the minimap for the big map  ·  {photo} Photo mode  ·  {pause} has "Back to the den"', max: 6, delay: 30 },
  { text: '{chitter} Chitter at fans  ·  {flop} Flop whenever you like. Go be round.', max: 5, delay: 40 },
];

class Coach {
  step = -1;
  moved = 0;
  /** Seconds of stick / WASD input (walking into Mom's den still counts as trying). */
  moveT = 0;
  jumped = false;
  rolled = false;
  private t = 0;
  private wait = 1.0;
  /** This step's hint hasn't been shown yet. */
  private pending = true;
  private shown = '';
  private last = new THREE.Vector3();
  private hasLast = false;

  constructor(private guide: Guide) {}

  start() {
    this.step = 0;
    this.t = 0;
    this.wait = 1.0;
    this.pending = true;
    this.moved = 0;
    this.moveT = 0;
    this.jumped = this.rolled = false;
    this.hasLast = false;
  }

  get active() {
    return this.step >= 0 && this.step < COACH.length;
  }

  update(dt: number) {
    if (!this.active) return;
    const ctx = this.guide.ctx;
    const game = ctx.game;
    const p = game.get<any>('player');
    if (p?.position) {
      if (this.hasLast) this.moved += Math.hypot(p.position.x - this.last.x, p.position.z - this.last.z);
      this.last.copy(p.position);
      this.hasLast = true;
      if (p.mode === 'roll') this.rolled = true;
    }
    if (game.input.pressed('jump')) this.jumped = true;
    if (game.input.move.lengthSq() > 0.2) this.moveT += dt;
    const hud = this.guide.hud;
    const step = COACH[this.step];
    if (this.pending) {
      // Waiting to show this step: after its delay, and only when the hint line is free (quests talk too).
      this.wait -= dt;
      if (this.wait > 0 || (hud.hintLeft > 0 && hud.hintRaw !== this.shown)) return;
      if (step.done?.(this)) {
        this.next();
        return;
      }
      const text = ctx.device === 'touch' && step.touch ? step.touch : step.text;
      this.shown = text;
      hud.hint(text, step.max);
      this.pending = false;
      this.t = 0;
      return;
    }
    this.t += dt;
    const done = step.done ? step.done(this) && this.t > 1.2 : false;
    if (done || this.t > step.max) this.next();
  }

  private next() {
    this.step++;
    const s = COACH[this.step];
    this.wait = s ? (s.delay ?? 0.35) : 0;
    this.pending = true;
    if (this.step === 3) this.guide.announce(true);
  }
}

// ---------------------------------------------------------------------------------------------- guide

export class Guide {
  suggestions: Suggestion[] = [];
  readonly coach: Coach;
  private manual: string | null = null;
  private customPoi: { name: string; label: string } | null = null;
  private resolveT = 0;
  private curKey = '';
  private cur: Suggestion | null = null;
  private customTarget: GuideTarget | null = null;
  private pill: HTMLElement;
  private pillIcon: HTMLElement;
  private pillTitle: HTMLElement;
  private pillDist: HTMLElement;
  private pillArrow: HTMLElement;
  private marker: HTMLElement;
  private markerDist: HTMLElement;
  private shownKey = '';
  private visible = false;
  private announceT = -1;
  private announceWait = 0;
  private stepKey = '';
  private nudgedAt = new Map<string, number>();

  constructor(
    readonly ctx: UiCtx,
    readonly hud: { hint(text: string, secs?: number): void; hintLeft: number; hintRaw: string },
    pillParent: HTMLElement,
    markerParent: HTMLElement,
    private opts: { canShow: () => boolean; canCoach: () => boolean; openPanel: () => void },
  ) {
    this.coach = new Coach(this);
    try {
      const s = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (typeof s.id === 'string') this.manual = s.id;
      if (s.poi && typeof s.poi.name === 'string') this.customPoi = { name: s.poi.name, label: String(s.poi.label ?? s.poi.name) };
    } catch {
      /* fresh */
    }
    this.pillIcon = h('span', { class: 'gp-icon' });
    this.pillTitle = h('span', { class: 'gp-title' });
    this.pillDist = h('span', { class: 'gp-dist' });
    this.pillArrow = h('span', { class: 'gp-arrow', html: '<svg viewBox="0 0 24 24"><path d="M12 2.5l7.5 17-7.5-4.2-7.5 4.2z"/></svg>' });
    this.pill = h('button', { class: 'guide-pill', 'aria-label': 'Tracked Instinct (open Instincts)', onclick: () => this.opts.openPanel() }, this.pillIcon, this.pillTitle, this.pillDist, this.pillArrow);
    this.markerDist = h('span', { class: 'wp-dist' });
    this.marker = h('div', { class: 'waypoint', 'aria-hidden': 'true' }, h('span', { class: 'wp-pin', html: ICONS.star }), h('span', { class: 'wp-arrow' }), this.markerDist);
    pillParent.append(this.pill);
    markerParent.append(this.marker);
    const ev = ctx.game.events;
    const soon = () => (this.resolveT = Math.min(this.resolveT, 0.05));
    ev.on('objective', (o: any) => {
      if (o?.id && (o.id === this.manual || o.id === this.cur?.id)) {
        if (o.id === this.manual) this.setManual(null);
        this.announceSoon(2.2); // after the "Instinct complete!" toast has landed
      }
      soon();
    });
    ev.on('objectiveProgress', soon);
    ev.on('grab', soon);
    ev.on('release', soon);
    ev.on('questProgress', soon);
  }

  // ------------------------------------------------------------------ public API

  /** The goal being tracked right now (manual pin, map POI, or the top suggestion). `pos` is null for goals without a place. */
  current(): { id: string; title: string; label: string; pos: THREE.Vector3 | null; flat?: boolean } | null {
    if (this.customPoi && this.customTarget) return { ...this.customTarget, id: 'poi:' + this.customPoi.name, title: this.customPoi.label };
    const c = this.cur;
    if (!c) return null;
    return { id: c.id, title: c.title, label: c.target?.label ?? '', pos: c.target?.pos ?? null, flat: c.target?.flat };
  }

  isTracked(id: string) {
    return !this.customPoi && this.cur?.id === id;
  }

  get manualId() {
    return this.customPoi ? null : this.manual;
  }

  /** Pin an Instinct (objective id). */
  track(id: string) {
    this.customPoi = null;
    this.setManual(id);
    this.resolve();
    this.announce(false, 'Tracking');
  }

  /** Track a world POI from the big map (uses its Instinct when one matches). */
  trackPoi(name: string, label: string) {
    const entry = this.entryForPoi(name);
    if (entry && !this.isDone(entry)) return this.track(entry);
    this.customPoi = { name, label };
    this.persist();
    this.resolve();
    this.ctx.game.events.emit('guideTrack', { id: 'poi:' + name, label });
    this.hud.hint(`★ Tracking ${label}`, 2.5);
  }

  /** Back to auto-tracking the top suggestion. */
  untrack() {
    this.customPoi = null;
    this.setManual(null);
    this.resolve();
  }

  entryForPoi(name: string): string | null {
    return DEFS.find((d) => d.poi === name)?.id ?? POI_ALIASES[name] ?? null;
  }

  /** Start the first-time contextual hints (after the intro). */
  startCoach() {
    this.coach.start();
  }

  /** Announce the tracked goal on the hint line in `secs` (returning players, after a completed Instinct). */
  announceSoon(secs: number) {
    this.announceT = secs;
    this.announceWait = 0;
  }

  /** Put the tracked goal's instructions on the hint line. */
  announce(first: boolean, lead = first ? 'Try this' : 'Next up') {
    this.resolve();
    const c = this.cur;
    if (!c || !this.ctx.settings.showGuide) return;
    this.hud.hint(`★ ${lead}: ${c.title} — ${c.how}`, 7);
    this.shownKey = '';
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number) {
    if (this.opts.canCoach()) this.coach.update(dt);
    this.resolveT -= dt;
    if (this.resolveT <= 0) this.resolve();
    if (this.announceT > 0) {
      this.announceT -= dt;
      // Wait (up to ~8 s) for the hint line to be free: quests/washing jokes talk first.
      if (this.announceT <= 0) {
        if (this.hud.hintLeft > 0.5 && this.announceWait < 8) {
          this.announceT = 0.5;
          this.announceWait += 0.5;
        } else {
          this.announceWait = 0;
          this.announce(false);
        }
      }
    }
    this.render();
  }

  private isDone(id: string) {
    return !!this.ctx.game.get<ObjectivesSystem>('objectives')?.get(id)?.done;
  }

  private setManual(id: string | null) {
    this.manual = id;
    this.persist();
    this.ctx.game.events.emit('guideTrack', { id });
  }

  private persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ id: this.manual, poi: this.customPoi }));
    } catch {
      /* ignore */
    }
  }

  /** Recompute suggestions + the current target (every ~0.5 s, or immediately after relevant events). */
  resolve() {
    this.resolveT = 0.5;
    const game = this.ctx.game;
    const objs = game.get<ObjectivesSystem>('objectives');
    const player = game.get<any>('player');
    if (!objs || !player?.position) return;
    const env: Env = { game, player, night: !!game.get<any>('environment')?.isNight, held: player.held?.entity ?? null };
    let hearts: any[] = [];
    let marks: any[] = [];
    try {
      hearts = game.get<any>('heartQuests')?.status?.() ?? [];
    } catch {
      hearts = [];
    }
    try {
      marks = game.get<any>('landmarks')?.status?.() ?? [];
    } catch {
      marks = [];
    }
    const out: (Suggestion & { score: number })[] = [];
    for (const d of DEFS) {
      const o = objs.get(d.id);
      if (!o || o.done || o.hidden) continue;
      const s = this.build(d, o, env, hearts, marks);
      if (!s) continue;
      const score = d.rank + (s.dist ?? 160) / 70 + (d.bonus?.(env) ?? 0);
      out.push({ ...s, score });
    }
    out.sort((a, b) => a.score - b.score);
    // Pinned entry (may be further down the list). Dropped only once it's actually done.
    if (this.manual && objs.get(this.manual)?.done) this.manual = null;
    this.suggestions = out.slice(0, 3);
    const pinned = this.manual ? out.find((s) => s.id === this.manual) ?? null : null;
    this.cur = pinned ?? out[0] ?? null;
    if (this.customPoi) {
      const p = game.get<any>('world')?.poi?.get?.(this.customPoi.name) as THREE.Vector3 | undefined;
      this.customTarget = p ? { pos: p.clone(), label: this.customPoi.label, flat: true } : null;
      if (!p) this.customPoi = null;
    }
    const key = this.customPoi ? 'poi:' + this.customPoi.name : this.cur?.id ?? '';
    if (key !== this.curKey) {
      this.curKey = key;
      this.shownKey = '';
      this.stepKey = '';
    }
    // Same goal, new sub-step (e.g. picked up the cotton candy → now find a puddle): say what to do next.
    const c = this.customPoi ? null : this.cur;
    const def = c ? DEFS.find((d) => d.id === c.id) : null;
    if (c && def?.howFn) {
      const sk = c.id + '|' + c.how;
      // Only when something was just picked up (not on every drop), at most every 20 s per goal.
      const now = performance.now();
      if (this.stepKey && sk !== this.stepKey && env.held && now - (this.nudgedAt.get(c.id) ?? -1e9) > 20000 && this.ctx.settings.showGuide && this.hud.hintLeft <= 0.5 && this.opts.canShow()) {
        this.nudgedAt.set(c.id, now);
        this.hud.hint('★ ' + c.how, 4.5);
      }
      this.stepKey = sk;
    }
  }

  private build(d: Def, o: Objective, env: Env, hearts: any[], marks: any[]): Suggestion | null {
    let target: GuideTarget | null = null;
    let how = d.how ?? o.desc;
    try {
      if (d.quest) {
        const q = hearts.find((x) => x.id === d.quest);
        if (q?.done) return null;
        if (q?.position) target = { pos: q.position.clone(), label: d.place ?? q.title };
        if (q?.step) how = chipify(q.step);
      } else if (d.landmark) {
        const m = marks.find((x) => x.id === d.landmark);
        if (m?.done) return null;
        if (m?.position) target = { pos: m.position.clone(), label: d.place ?? m.title };
        if (m?.hint) how = chipify(m.hint);
      }
      if (d.target) target = d.target(env) ?? target;
      if (!target && d.poi) target = poiTarget(env, d.poi, d.place ?? o.title);
      const h2 = d.howFn?.(env);
      if (h2) how = h2;
    } catch {
      /* a quest system hiccup must never break the HUD */
    }
    const p = env.player.position as THREE.Vector3;
    const dist = target ? Math.hypot(target.pos.x - p.x, target.pos.z - p.z) : null;
    const tgt = o.target ?? 1;
    return {
      id: d.id,
      title: o.title,
      how,
      category: o.category,
      progress: tgt > 1 ? `${fmt(Math.min(o.progress, tgt))}/${fmt(tgt)}` : '',
      target,
      dist,
    };
  }

  // ------------------------------------------------------------------ HUD

  private render() {
    const want = this.ctx.settings.showGuide && this.opts.canShow();
    const c = this.current();
    const show = want && !!c;
    if (show !== this.visible) {
      this.visible = show;
      this.pill.classList.toggle('show', show);
      if (!show) this.marker.classList.remove('show');
    }
    if (!show || !c) return;
    const game = this.ctx.game;
    const p = game.get<any>('player');
    if (!p?.position) return;
    const key = c.id + '|' + (this.customPoi ? '' : this.cur?.progress ?? '') + '|' + c.label;
    if (key !== this.shownKey) {
      this.shownKey = key;
      const cat = categoryInfo(this.customPoi ? 'other' : this.cur?.category);
      this.pill.style.setProperty('--cat', this.customPoi ? 'var(--gold)' : cat.color);
      this.pillIcon.innerHTML = this.customPoi ? ICONS.pin : cat.icon;
      const prog = !this.customPoi && this.cur?.progress ? ` <i>${esc(this.cur.progress)}</i>` : '';
      // Sub-target ("Puddle", "Hot Dog", "Trash can") when it differs from the title: tells you the next step.
      const sub = c.label && c.label !== c.title && !this.customPoi ? `<small> · ${esc(c.label)}</small>` : '';
      this.pillTitle.innerHTML = `${esc(c.title)}${prog}${sub}`;
      this.pill.title = c.label || c.title;
      replayIn(this.pill);
    }
    const pos = c.pos;
    this.pill.classList.toggle('nopos', !pos);
    if (!pos) {
      // A goal without a place (e.g. "chitter at 15 people"): the pill still says what it is.
      if (this.pillDist.textContent) this.pillDist.textContent = '';
      this.marker.classList.remove('show');
      return;
    }
    const dist = Math.hypot(pos.x - p.position.x, pos.z - p.position.z);
    // Straight above/below the goal (on the thrift-store roof over Mom's den, at the foot of the Space Noodle, under a
    // rooftop bobblehead) the flat distance said "here!" and hid the star. Say which way instead. Exact targets only:
    // map POIs' heights aren't always where you stand.
    const dy = c.flat ? 0 : pos.y - p.position.y;
    const vert = Math.abs(dy) > 4 && dist < 12;
    const dTxt = vert ? `${Math.round(Math.abs(dy))} m ${dy > 0 ? 'up' : 'down'}` : dist < 3.5 ? 'here!' : `${Math.round(dist)} m`;
    if (this.pillDist.textContent !== dTxt) this.pillDist.textContent = dTxt;
    // Compass arrow relative to the camera (up = straight ahead).
    const rig = game.get<any>('camera');
    const yaw = rig?.yaw ?? 0;
    const fwdA = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
    const tgtA = Math.atan2(pos.x - p.position.x, pos.z - p.position.z);
    let rel = fwdA - tgtA;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    this.pillArrow.style.transform = `rotate(${((rel * 180) / Math.PI).toFixed(1)}deg)`;
    this.placeMarker(pos, vert ? Math.hypot(dist, dy) : dist);
  }

  /** World waypoint: a star over the target, clamped to the screen edge (with an arrow) when off-screen. */
  private placeMarker(pos: THREE.Vector3, dist: number) {
    const game = this.ctx.game;
    const el = this.marker;
    if (dist < 3.5) {
      el.classList.remove('show');
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    _v.copy(pos);
    _v.y += 1.7;
    _v.project(game.camera);
    let x = _v.x;
    let y = _v.y;
    const behind = _v.z > 1;
    if (behind) {
      x = -x;
      y = -y;
      if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05) y = -1;
    }
    const mx = 1 - 46 / (W / 2);
    const myTop = 1 - 70 / (H / 2);
    const myBot = 1 - 120 / (H / 2);
    const on = !behind && Math.abs(x) <= mx && y <= myTop && y >= -myBot;
    let ang = 0;
    if (!on) {
      const my = y > 0 ? myTop : myBot;
      const s = 1 / Math.max(Math.abs(x) / mx, Math.abs(y) / my, 1e-6);
      x *= s;
      y *= s;
      ang = Math.atan2(x, y);
    }
    const px = (x * 0.5 + 0.5) * W;
    const py = (-y * 0.5 + 0.5) * H;
    el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    el.classList.toggle('edge', !on);
    if (!on) el.style.setProperty('--ang', `${((ang * 180) / Math.PI).toFixed(1)}deg`);
    const t = `${Math.round(dist)} m`;
    if (this.markerDist.textContent !== t) this.markerDist.textContent = t;
    // Fade the on-screen star when it's far away and small, so it never hides the view.
    el.style.setProperty('--wp-scale', on ? Math.max(0.7, Math.min(1, 26 / Math.max(dist, 1) + 0.55)).toFixed(2) : '0.9');
    el.classList.add('show');
  }

  /** Suggestion rows for the Instincts panels (tokens already filled for the current device). */
  describe(s: Suggestion): { how: string; where: string } {
    const where = s.target ? `${s.target.label}${s.dist != null ? ` · ${Math.round(s.dist)} m` : ''}` : '';
    return { how: fillTokens(s.how, this.ctx.device), where };
  }
}

function replayIn(el: HTMLElement) {
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}
