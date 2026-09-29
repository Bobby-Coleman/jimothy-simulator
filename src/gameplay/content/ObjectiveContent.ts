import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import type { ObjectivesSystem } from '../Objectives';
import type { MutatorSystem } from '../Mutators';
import type { ScoreSystem } from '../Score';
import type { Jimothy } from '../../player/Jimothy';
import type { World } from '../../world/World';
import type { WaterSystem } from '../../world/Water';
import type { Environment } from '../../world/Environment';
import { OBJECTIVES } from './objectiveDefs';

/**
 * Registers every objective and progresses them from gameplay events / polled player state.
 *
 * Trigger table (event payloads are read defensively; other systems may omit fields):
 *   wash10              'wash' (kind != 'hands')                     cottonCandy     'cottonCandyGone' | wash/itemWashed of cotton candy
 *   moneyLaundering     wash/itemWashed of cash                      deepClean       wash/itemWashed of a phone
 *   dumpsterDiver       'dumpsterDive' ×5 (unique dumpsters)         trashTornado    'trashTipped' ×20
 *   roundBoy            player.stats.rolled (cumulative, 500 m)      notACat         'notACat'
 *   cryptid             'filmed' {by} ×25 unique people              fiveFingerDisc. 'steal'/'grab' of a pizza
 *   stickyFingers       'steal' ×10                                  stickySituation 'gumWall'
 *   spaceNoodle         y > 60 near POI spaceNoodleTop               nocturnal       environment.isNight for 60 s
 *   bathTime            swim in 4 water kinds (persisted set)        marathon        player.stats.distance 2 km
 *   catchOfTheDay       'fishCaught'                                 bobbleheadColl. 'collectible' {kind:'bobblehead'}
 *   washSlop            'slopDissolve' | 'slopWashed' ×10            touchGrass      'serverUnplugged'
 *   closeThisWindow     'slopbotDismissed' ×5                        mamasBoy        'momSnack' ×3 | questComplete /mom/
 *   familyReunion       'dannyReunion'                               kitCollector    'kitRescued' ×5
 *   crowDeals           'crowTrade' ×3                               teddyRescue     'teddyReturned'
 *   grandmasFavorite    'grandmaVisit'                               honoraryDegree  'degreeReceived'
 *   jimothySummer       'proclamation'                               salmonRun       'salmonRunWon'
 *   rookieCard          'collectible' {kind:'rookieCard'} | grab of the card
 *   awww                'chitter' near 15 unique NPCs                localCelebrity  score total 100k
 *   strike              'bonk' {rolling} on 5 NPCs in one roll       chainReaction   'npcRagdoll' ×10 in 5 s
 *   kaboom              'explosion'                                  carSurfer       'hanging' while moving, 10 s
 *   leapOfFaith         'land' {height ≥ 25}                         frequentFlyer   30 m rise while airborne
 *   jaywalker           'hitByCar' | playerRagdoll cause car         flopEra         'playerRagdoll' ×25
 *   officerScold        'officerScold' ×10
 *   secrets: humanMade (near POI *mural* | 'muralFound'), hydrophobic (swim 60 s), heNeverLearns (cotton candy ×3),
 *            backFromTheVoid (fall out of the world), spinMeRound (roll 60 s non-stop), mutantRaccoon (5 mutators on)
 * Also: 'questComplete' {id} completes an objective with that id (or a matching alias).
 */

const STORE_KEY = 'jimothy.content.v1';

interface Store {
  bathKinds: string[];
}

const QUEST_ALIASES: [RegExp, string][] = [
  [/noodle/i, 'spaceNoodle'],
  [/^catch|fish/i, 'catchOfTheDay'],
  [/dragon/i, 'dragonRider'],
  [/billboard/i, 'countToFive'],
  [/danny|reunion/i, 'familyReunion'],
  [/kit/i, 'kitCollector'],
  [/mom|mama|snack/i, 'mamasBoy'],
  [/teddy/i, 'teddyRescue'],
  [/grandma|rosie/i, 'grandmasFavorite'],
  [/degree|graduat/i, 'honoraryDegree'],
  [/proclamation|summer/i, 'jimothySummer'],
  [/salmon/i, 'salmonRun'],
  [/crow/i, 'crowDeals'],
  [/rookie|card/i, 'rookieCard'],
  [/slopcorp|server|unplug|touch.?grass/i, 'touchGrass'],
  [/mural/i, 'humanMade'],
];

function entityText(e: any): string {
  if (!e) return '';
  return `${e.name ?? ''} ${e.data?.kind ?? ''} ${e.data?.item ?? ''} ${e.data?.itemKind ?? ''}`;
}

function isThing(e: Entity | undefined | null, re: RegExp, ...tags: string[]) {
  if (!e) return false;
  for (const t of tags) if (e.tags?.has(t)) return true;
  return re.test(entityText(e));
}

const isNpc = (e: Entity | undefined | null) => !!e && (e.kind === 'npc' || e.tags?.has('npc'));

function entityPos(e: Entity, out: THREE.Vector3) {
  const t = e.body?.translation();
  if (t) return out.set(t.x, t.y, t.z);
  if (e.object) return e.object.getWorldPosition(out);
  return null;
}

export class ObjectiveContent implements System {
  name = 'objectiveContent';
  private game!: Game;
  private obj?: ObjectivesSystem;
  private store: Store = { bathKinds: [] };
  private seen = new Map<string, Set<string | number>>();
  private acc = new Map<string, number>();
  private lastRolled = -1;
  private lastWalked = -1;
  private rollHits = new Set<number>();
  private ragdolls: { t: number; id: number | string }[] = [];
  private fly = { takeoffY: 0, peak: 0, airborne: false };
  private spin = 0;
  private recentTrash = new Map<number, number>();
  private slopKeys = new Map<string | number, number>();
  private pollT = 0;
  private lastCandy = -10;
  private scanT = 0;
  private murals: THREE.Vector3[] = [];
  private noodle: THREE.Vector3 | null | undefined = undefined;

  init(game: Game) {
    this.game = game;
    this.obj = game.get<ObjectivesSystem>('objectives');
    if (!this.obj) return;
    for (const def of OBJECTIVES) this.obj.add(def);
    this.load();
    const bath = this.obj.get('bathTime');
    if (bath && !bath.done && bath.progress === 0) this.store.bathKinds = [];
    this.wire();
  }

  // ------------------------------------------------------------------ helpers
  private has(id: string) {
    const o = this.obj?.get(id);
    return !!o && !o.done;
  }
  private add(id: string, n = 1) {
    this.obj?.progress(id, n);
  }
  private set(id: string, v: number) {
    this.obj?.set(id, v);
  }
  private done(id: string) {
    this.obj?.complete(id);
  }
  /** True the first time `key` is seen for objective `id` this session. */
  private uniq(id: string, key: string | number) {
    let s = this.seen.get(id);
    if (!s) this.seen.set(id, (s = new Set()));
    if (s.has(key)) return false;
    s.add(key);
    return true;
  }
  /** Accumulate a continuous quantity; progress is reported in `step` increments (and on completion). */
  private accum(id: string, delta: number, step: number) {
    const o = this.obj?.get(id);
    if (!o || o.done || !(delta > 0)) return;
    const a = (this.acc.get(id) ?? o.progress) + delta;
    this.acc.set(id, a);
    const target = o.target ?? 1;
    const q = a >= target ? target : Math.floor(a / step) * step;
    if (q > o.progress) this.obj!.set(id, q);
  }
  private keyOf(p: any, fallback: string) {
    return p?.id ?? p?.entity?.id ?? p?.by?.id ?? p?.kit?.id ?? `${fallback}@${this.game.time.toFixed(2)}`;
  }

  private load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (Array.isArray(s.bathKinds)) this.store.bathKinds = s.bathKinds.filter((k: unknown) => typeof k === 'string');
    } catch {
      /* ignore */
    }
  }
  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.store));
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------------ events
  private wire() {
    const ev = this.game.events;
    const on = (name: string, fn: (p: any) => void) => ev.on(name, (p) => fn(p ?? {}));

    on('wash', (p) => {
      if (p.kind === 'hands') return;
      this.add('wash10');
      const e: Entity | undefined = p.entity;
      if (isThing(e, /cotton ?candy/i, 'cottoncandy')) this.cottonCandy(e);
      if (isThing(e, /\bcash\b|money|dollar|\bbills?\b|wallet/i, 'cash', 'money')) this.done('moneyLaundering');
      if (isThing(e, /phone/i, 'phone')) this.done('deepClean');
    });
    on('itemWashed', (p) => {
      const k = `${p.kind ?? ''} ${entityText(p.entity)}`;
      if (/cotton ?candy/i.test(k)) this.cottonCandy(p.entity);
      if (/cash|money|dollar/i.test(k)) this.done('moneyLaundering');
      if (/phone/i.test(k)) this.done('deepClean');
    });
    on('cottonCandyGone', (p) => this.cottonCandy(p.entity));
    on('dumpsterDive', (p) => {
      if (this.uniq('dumpsterDiver', this.keyOf(p, 'dive'))) this.add('dumpsterDiver');
    });
    on('trashTipped', (p) => {
      const id: number | undefined = p.entity?.id;
      if (id != null) {
        const last = this.recentTrash.get(id) ?? -99;
        this.recentTrash.set(id, this.game.time);
        if (this.game.time - last < 4) return;
      }
      this.add('trashTornado');
    });
    on('notACat', () => this.done('notACat'));
    on('filmed', (p) => {
      if (this.uniq('cryptid', p.by?.id ?? p.entity?.id ?? this.keyOf(p, 'film'))) this.add('cryptid');
    });
    on('steal', (p) => {
      this.add('stickyFingers');
      if (isThing(p.entity, /pizza/i, 'pizza')) this.done('fiveFingerDiscount');
    });
    on('grab', (p) => {
      const e: Entity | undefined = p.entity;
      if (isThing(e, /pizza/i, 'pizza')) this.done('fiveFingerDiscount');
      if (isThing(e, /rookie ?card/i, 'rookieCard', 'rookiecard')) this.done('rookieCard');
    });
    on('gumWall', () => this.done('stickySituation'));
    on('fishCaught', () => this.done('catchOfTheDay'));
    on('collectible', (p) => {
      const kind = String(p.kind ?? '');
      if (/bobble/i.test(kind)) {
        const c = this.game.get<any>('collectibles');
        const n = typeof p.count === 'number' ? p.count : (c?.collectedCount ?? 0);
        if (n > 0) this.set('bobbleheadCollector', n);
        else this.add('bobbleheadCollector');
      }
      if (/rookie|card/i.test(kind) || /rookie/i.test(String(p.id ?? ''))) this.done('rookieCard');
    });

    // slop
    const slop = (p: any) => this.slop(p.entity?.id ?? p.id ?? this.keyOf(p, 'slop'));
    on('slopDissolve', (p) => {
      if (p.reason && p.reason !== 'washed') return; // timeouts / caps / stray water don't count
      slop(p);
    });
    on('slopWashed', slop);
    on('serverUnplugged', () => this.done('touchGrass'));
    on('slopbotDismissed', () => this.add('closeThisWindow'));
    on('rodeSlopDragon', () => this.done('dragonRider'));
    on('billboardWashed', () => this.done('countToFive'));

    // heart
    on('momSnack', () => this.add('mamasBoy'));
    on('dannyReunion', () => this.done('familyReunion'));
    on('dannyHug', () => this.done('familyReunion'));
    on('noodleSummit', () => this.done('spaceNoodle'));
    on('leapOfFaith', (p) => this.set('leapOfFaith', Math.floor(Math.min(25, Number(p.height) || 0))));
    on('kitRescued', (p) => {
      if (typeof p.count === 'number') this.set('kitCollector', p.count);
      else if (this.uniq('kitCollector', this.keyOf(p, 'kit'))) this.add('kitCollector');
    });
    on('crowTrade', () => this.add('crowDeals'));
    on('teddyReturned', () => this.done('teddyRescue'));
    on('grandmaVisit', () => this.done('grandmasFavorite'));
    on('degreeReceived', () => this.done('honoraryDegree'));
    on('proclamation', () => this.done('jimothySummer'));
    on('salmonRunWon', () => this.done('salmonRun'));
    on('muralFound', () => this.done('humanMade'));
    on('muralVisited', () => this.done('humanMade'));
    on('questComplete', (p) => {
      const id = String(p.id ?? '');
      if (!id) return;
      if (this.obj?.get(id)) {
        this.done(id);
        return;
      }
      for (const [re, oid] of QUEST_ALIASES) if (re.test(id)) return this.done(oid);
    });
    on('chitter', (p) => {
      const pos: THREE.Vector3 | undefined = p.position ?? this.game.get<Jimothy>('player')?.position;
      if (!pos || !this.has('awww')) return;
      const v = new THREE.Vector3();
      for (const e of this.game.entities.list) {
        if (!e.alive || !isNpc(e)) continue;
        const ep = entityPos(e, v);
        if (!ep || ep.distanceToSquared(pos) > 36) continue;
        if (this.uniq('awww', e.id)) this.add('awww');
      }
    });

    // chaos
    on('bonk', (p) => {
      const pl = this.game.get<Jimothy>('player');
      if (!p.rolling || p.source === 'chonk' || !isNpc(p.entity) || pl?.mode !== 'roll') return;
      this.rollHits.add(p.entity.id);
      this.set('strike', this.rollHits.size);
    });
    on('rollStart', () => this.rollHits.clear());
    on('playerMode', (p) => {
      if (p.prev === 'roll' && p.mode !== 'roll') this.rollHits.clear();
    });
    on('npcRagdoll', (p) => {
      const t = this.game.time;
      this.ragdolls.push({ t, id: p.entity?.id ?? `r${t}` });
      while (this.ragdolls.length && t - this.ragdolls[0].t > 5) this.ragdolls.shift();
      this.set('chainReaction', new Set(this.ragdolls.map((r) => r.id)).size);
    });
    on('explosion', () => this.done('kaboom'));
    on('hanging', (p) => {
      const pl = this.game.get<Jimothy>('player');
      const speed = Math.max(Number(p.speed) || 0, pl?.speed ?? 0);
      if (speed > 1.5) this.accum('carSurfer', Number(p.dt) || this.game.dt, 1);
    });
    on('land', (p) => {
      const h = Number(p.height) || 0;
      if (h >= 3) this.set('leapOfFaith', Math.floor(Math.min(h, 25)));
      this.finishFlight();
    });
    on('hitByCar', () => this.done('jaywalker'));
    on('playerRagdoll', (p) => {
      this.add('flopEra');
      if (/car|vehicle|bus|truck|traffic/i.test(String(p.cause ?? ''))) this.done('jaywalker');
    });
    on('officerScold', () => this.add('officerScold'));

    // meta / secrets
    on('mutator', () => {
      const n = this.game.get<MutatorSystem>('mutators')?.list.filter((m) => m.enabled).length ?? 0;
      if (n >= 5) this.done('mutantRaccoon');
    });
    on('hint', (p) => {
      if (/returned from the void/i.test(String(p.text ?? ''))) this.done('backFromTheVoid');
    });
  }

  private cottonCandy(_e?: Entity) {
    // one wash can arrive as wash + cottonCandyGone + itemWashed: count each dissolving once
    if (this.game.time - this.lastCandy < 1) return;
    this.lastCandy = this.game.time;
    this.done('cottonCandy');
    this.add('heNeverLearns');
  }

  private slop(key: string | number) {
    const now = this.game.time;
    const last = this.slopKeys.get(key);
    this.slopKeys.set(key, now);
    if (last != null && (typeof key === 'number' || now - last < 0.5)) return;
    this.add('washSlop');
  }

  private finishFlight() {
    if (this.fly.airborne && this.fly.peak >= 4) this.set('frequentFlyer', Math.floor(Math.min(this.fly.peak, 30)));
    this.fly.airborne = false;
    this.fly.peak = 0;
  }

  // ------------------------------------------------------------------ polling
  update(dt: number, game: Game) {
    if (!this.obj) return;
    const p = game.get<Jimothy>('player');
    if (!p) return;

    // cumulative distances (stats reset every session; objective progress is the persistent total)
    const rolled = p.stats.rolled;
    if (this.lastRolled >= 0 && rolled > this.lastRolled) this.accum('roundBoy', rolled - this.lastRolled, 10);
    this.lastRolled = rolled;
    const walked = p.stats.distance;
    if (this.lastWalked >= 0 && walked > this.lastWalked) this.accum('marathon', walked - this.lastWalked, 25);
    this.lastWalked = walked;

    // launches: height gained since leaving the ground (climbing/swimming/hanging reset the reference)
    const air = !p.grounded && (p.mode === 'walk' || p.mode === 'roll' || p.mode === 'ragdoll');
    if (!air) {
      if (this.fly.airborne) this.finishFlight();
      this.fly.takeoffY = p.position.y;
    } else {
      this.fly.airborne = true;
      this.fly.peak = Math.max(this.fly.peak, p.position.y - this.fly.takeoffY);
      if (this.fly.peak >= 30) this.set('frequentFlyer', 30);
    }

    // swimming
    if (p.mode === 'swim') {
      this.accum('hydrophobic', dt, 5);
      const kind = game.get<WaterSystem>('water')?.volumeAt(p.position)?.kind;
      if (kind && !this.store.bathKinds.includes(kind)) {
        this.store.bathKinds.push(kind);
        this.save();
        this.set('bathTime', this.store.bathKinds.length);
        if (this.has('bathTime')) game.hint(`Bath Time: ${this.store.bathKinds.length}/4 kinds of water (${kind})`, 2);
      }
    }

    // non-stop rolling
    if (p.mode === 'roll' && p.speed > 1) {
      this.spin += dt;
      const s = Math.floor(this.spin / 5) * 5;
      if (s > 0) this.set('spinMeRound', Math.min(60, s));
    } else this.spin = 0;

    // night owl
    if (game.get<Environment>('environment')?.isNight && game.state === 'playing') this.accum('nocturnal', dt, 5);

    // out of bounds (the player respawns at y < -40 in the same frame, so catch the fall on the way down)
    if (p.position.y < -25) this.done('backFromTheVoid');

    // throttled checks
    this.pollT -= dt;
    if (this.pollT > 0) return;
    this.pollT = 0.25;
    this.scanT -= 0.25;
    if (this.scanT <= 0) {
      this.scanT = 4; // quest systems may add POIs after init
      this.scanPois(game.get<World>('world'));
    }
    if (this.has('spaceNoodle')) {
      const top = this.noodle;
      const pos = p.position;
      if (top) {
        if (Math.hypot(pos.x - top.x, pos.z - top.z) < 18 && pos.y > Math.min(60, top.y - 4)) this.done('spaceNoodle');
      } else if (pos.y > 60 && (p.grounded || p.mode === 'climb')) this.done('spaceNoodle');
    }
    if (this.has('humanMade')) for (const m of this.murals) if (m.distanceToSquared(p.position) < 30) this.done('humanMade');
    const total = game.get<ScoreSystem>('score')?.total ?? 0;
    if (total > 0) this.set('localCelebrity', total >= 100000 ? 100000 : Math.floor(total / 5000) * 5000);
    const coll = game.get<any>('collectibles');
    if (coll && typeof coll.collectedCount === 'number' && coll.collectedCount > 0) this.set('bobbleheadCollector', coll.collectedCount);
  }

  private scanPois(world: World | undefined) {
    this.noodle = null;
    this.murals = [];
    if (!world) return;
    const direct = world.poi.get('spaceNoodleTop');
    for (const [k, v] of world.poi) {
      if (!direct && /space.?noodle/i.test(k) && (!this.noodle || v.y > this.noodle.y)) this.noodle = v;
      if (/mural/i.test(k)) this.murals.push(v);
    }
    if (direct) this.noodle = direct;
  }
}
