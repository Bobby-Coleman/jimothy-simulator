import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { G, groups } from '../../core/Physics';
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
 *   wash10              'wash' (kind != 'hands') ×10 unique things   cottonCandy     'cottonCandyGone' | wash/itemWashed of cotton candy
 *   moneyLaundering     wash/itemWashed of cash                      deepClean       wash/itemWashed of a phone
 *   dumpsterDiver       'dumpsterDive' ×5 (items: 15 s cooldown/bin) trashTornado    'trashTipped' ×20 (by/near Jimothy)
 *   roundBoy            player.stats.rolled (cumulative, 500 m)      notACat         'notACat'
 *   cryptid             'filmed' {by} ×12 unique people              fiveFingerDisc. 'steal'/'grab' of a pizza
 *   stickyFingers       'steal' ×10 unique items                     stickySituation 'gumWall'
 *   spaceNoodle         'noodleSummit' | y > 56 near POI spaceNoodleTop     nocturnal   environment.isNight for 60 s
 *   bathTime            swim in 4 water kinds (persisted set)        marathon        player.stats.distance 2 km
 *   catchOfTheDay       'fishCaught'                                 bobbleheadColl. 'collectible' {kind:'bobblehead'} ×10
 *   washSlop            'slopDissolve' {reason:'washed'} | 'slopWashed' ×10 (deduped per entity)
 *   touchGrass          'serverUnplugged'                            closeThisWindow 'slopbotDismissed' ×5
 *   countToFive         'billboardWashed'                            dragonRider     'rodeSlopDragon'
 *   mamasBoy            'momSnack' {count} ×3                        familyReunion   'dannyReunion' | 'dannyHug'
 *   kitCollector        'kitRescued' {count} ×5                      crowDeals       'crowTrade' {count} ×3
 *   teddyRescue         'teddyReturned'                              grandmasFavorite 'grandmaVisit'
 *   honoraryDegree      'degreeReceived'                             jimothySummer   'proclamation'
 *   salmonRun           'salmonRunWon'                               rookieCard      'collectible' {kind:'rookieCard'} | grab
 *   awww                'chitter' near 15 unique NPCs                localCelebrity  score total 100k
 *   strike              'bonk' {rolling} | 'npcRagdoll' {cause:'roll'} on 5 NPCs in one roll
 *   chainReaction       'npcRagdoll' (byPlayer, or ≤ 30 m and not traffic/falls) ×5 unique in 5 s
 *   kaboom              'explosion'                                  carSurfer       'hanging' while moving, 10 s
 *   leapOfFaith         'land' | 'leapOfFaith' {height ≥ 25}         frequentFlyer   8 m rise while airborne (live; teleports reset)
 *   jaywalker           'hitByCar' | playerRagdoll cause car         flopEra         'playerRagdoll' ×25
 *   officerScold        'officerScold' ×10
 *   secrets: humanMade (stand still near a POI *mural* looking at the wall 1.5 s | photo of it | 'muralFound'),
 *            hydrophobic (swim 60 s), heNeverLearns (cotton candy ×3), backFromTheVoid (fall out of the world),
 *            spinMeRound (roll 60 s non-stop), mutantRaccoon (5 mutators on)
 * Saved progress that already meets a (rebalanced) target completes on the first frame.
 * Also: 'questComplete' {id} completes the objective with that id, or one matched by QUEST_ALIASES
 * (landmark quests: noodle/catch/degree/summer/salmon/rookieCard; heart quests: mama/kits/crows/danny/teddy/grandma).
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
  private lastPos = new THREE.Vector3();
  private hasLastPos = false;
  private admire = 0;
  private migrated = false;
  private spin = 0;
  private spinStall = 0;
  private recentTrash = new Map<number, number>();
  private slopKeys = new Map<string | number, number>();
  private pollT = 0;
  private lastCandy = -10;
  private scanT = 0;
  /** Mural POIs + the point on the painted wall to look at (found once per scan). */
  private murals: { pos: THREE.Vector3; look: THREE.Vector3; found: boolean; normal: THREE.Vector3 | null }[] = [];
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
  private nearPlayer(e: Entity | undefined, r: number) {
    const pl = this.game.get<Jimothy>('player');
    const v = e ? entityPos(e, new THREE.Vector3()) : null;
    return !!pl && !!v && v.distanceTo(pl.position) < r;
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
      const e: Entity | undefined = p.entity;
      // "10 things": scrubbing the same thing again doesn't count twice
      if (e?.id == null || this.uniq('wash10', e.id)) this.add('wash10');
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
    // Every scoring dive counts (the items system already allows one per dumpster per 15 s). There are only a
    // handful of dumpsters in town, so "5 different dumpsters" was impossible.
    on('dumpsterDive', () => this.add('dumpsterDiver'));
    on('trashTipped', (p) => {
      // Jimothy's doing only: traffic and pedestrians knock over ~1 can a minute somewhere in town, which would
      // finish this on its own in half an hour. (Chain tips next to him still count.)
      if (!p.entity?.data?.disturbedByPlayer && !this.nearPlayer(p.entity, 15)) return;
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
      // 10 different things: stealing the same phone back after returning it doesn't count again
      const id = p.entity?.id;
      if (id == null || this.uniq('stickyFingers', id)) this.add('stickyFingers');
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
    const counted = (id: string) => (p: any) => (typeof p.count === 'number' ? this.set(id, p.count) : this.add(id));
    on('momSnack', counted('mamasBoy'));
    on('dannyReunion', () => this.done('familyReunion'));
    on('dannyHug', () => this.done('familyReunion'));
    on('noodleSummit', () => this.done('spaceNoodle'));
    on('leapOfFaith', (p) => this.set('leapOfFaith', Math.floor(Math.min(25, Number(p.height) || 0))));
    on('kitRescued', (p) => {
      if (typeof p.count === 'number') this.set('kitCollector', p.count);
      else if (this.uniq('kitCollector', this.keyOf(p, 'kit'))) this.add('kitCollector');
    });
    on('crowTrade', counted('crowDeals'));
    on('teddyReturned', () => this.done('teddyRescue'));
    on('grandmaVisit', () => this.done('grandmasFavorite'));
    on('degreeReceived', () => this.done('honoraryDegree'));
    on('proclamation', () => this.done('jimothySummer'));
    on('salmonRunWon', () => this.done('salmonRun'));
    on('muralFound', () => this.done('humanMade'));
    on('muralVisited', () => this.done('humanMade'));
    // a photo (photo mode) of the mural counts as admiring it
    on('photoTaken', () => {
      if (!this.has('humanMade')) return;
      const cam = this.game.camera;
      const dir = cam.getWorldDirection(new THREE.Vector3());
      for (const m of this.murals) {
        const to = m.look.clone().sub(cam.position);
        const d = to.length();
        // final-pass fix: only counts from the plaza side (not from behind / up against the wall)
        if (m.normal && -(to.x * m.normal.x + to.z * m.normal.z) < 1) continue;
        if (d < 25 && to.divideScalar(d || 1).dot(dir) > 0.5) return this.done('humanMade');
      }
    });
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
      // bowled over by a rolling Jimothy (slow rolls knock people down without a 'bonk' event)
      if (p.cause === 'roll' && p.entity?.id != null && this.game.get<Jimothy>('player')?.mode === 'roll') {
        this.rollHits.add(p.entity.id);
        this.set('strike', this.rollHits.size);
      }
      // Jimothy's chaos only: traffic/falls across town aren't his chain reaction. (byPlayer alone isn't enough:
      // explosion knockdowns arrive via Npc.onBonk as cause 'impact' with byPlayer false, landmark crowds omit it.)
      if (p.byPlayer !== true && (/vehicle|fall|faint|script/.test(String(p.cause ?? '')) || !this.nearPlayer(p.entity, 30))) return;
      const t = this.game.time;
      this.ragdolls.push({ t, id: p.entity?.id ?? `r${t}` });
      while (this.ragdolls.length && t - this.ragdolls[0].t > 5) this.ragdolls.shift();
      this.set('chainReaction', new Set(this.ragdolls.map((r) => r.id)).size);
    });
    on('explosion', () => this.done('kaboom'));
    on('hanging', (p) => {
      // Riding the Slop Dragon isn't car surfing
      const ent = p?.entity;
      if (ent && (ent.tags?.has?.('dragon') || ent.data?.slopDragon || ent.kind !== 'vehicle')) return;
      const pl = this.game.get<Jimothy>('player');
      const speed = Math.max(Number(p.speed) || 0, pl?.speed ?? 0);
      if (speed > 1.5) this.accum('carSurfer', Number(p.dt) || this.game.dt, 1);
    });
    on('land', (p) => {
      // fall height from the player controller (measured from where he let go of walls/cars, see Jimothy.checkGround)
      const h = Number(p.height) || 0;
      if (h >= 3) this.set('leapOfFaith', Math.floor(Math.min(h, 25)));
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

  /** Launch height: rise above the take-off point while airborne (progress updates live, e.g. while bouncing). */
  private trackFlight(p: Jimothy, dt: number) {
    const pos = p.position;
    // Teleports (respawn, quest cutscenes, debug) are neither launches nor falls: restart from here.
    const expected = p.velocity.length() * dt + 1.5;
    if (this.hasLastPos && pos.distanceTo(this.lastPos) > Math.max(5, expected * 2)) {
      this.fly.airborne = false;
      this.fly.peak = 0;
      this.fly.takeoffY = pos.y;
    }
    this.lastPos.copy(pos);
    this.hasLastPos = true;
    const air = !p.grounded && (p.mode === 'walk' || p.mode === 'roll' || p.mode === 'ragdoll');
    if (!air) {
      this.fly.airborne = false;
      this.fly.peak = 0;
      this.fly.takeoffY = pos.y;
      return;
    }
    this.fly.airborne = true;
    const rise = pos.y - this.fly.takeoffY;
    if (rise > this.fly.peak + 0.2) {
      this.fly.peak = rise;
      if (rise >= 3) this.set('frequentFlyer', Math.floor(rise)); // (a plain jump is ~2.5 m)
    }
  }

  // ------------------------------------------------------------------ polling
  update(dt: number, game: Game) {
    if (!this.obj) return;
    const p = game.get<Jimothy>('player');
    if (!p) return;
    if (!this.migrated && game.state === 'playing') {
      // Targets get rebalanced between versions: a save that already meets the new target completes now
      // (ObjectivesSystem.set() never lowers progress, so it would otherwise be stuck at e.g. 20/15 forever).
      this.migrated = true;
      for (const o of this.obj.list) if (!o.done && o.progress >= (o.target ?? 1)) this.obj.complete(o.id);
    }

    // cumulative distances (stats reset every session; objective progress is the persistent total)
    const rolled = p.stats.rolled;
    if (this.lastRolled >= 0 && rolled > this.lastRolled) this.accum('roundBoy', rolled - this.lastRolled, 25);
    this.lastRolled = rolled;
    const walked = p.stats.distance;
    if (this.lastWalked >= 0 && walked > this.lastWalked) this.accum('marathon', walked - this.lastWalked, 100);
    this.lastWalked = walked;

    // launches: height gained since leaving the ground (climbing/swimming/hanging reset the reference)
    this.trackFlight(p, dt);

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

    // non-stop rolling (bumps/stalls shorter than 2.5 s are forgiven)
    if (p.mode === 'roll') {
      this.spinStall = p.speed < 0.6 ? this.spinStall + dt : 0;
      if (this.spinStall > 2.5) this.spin = 0;
      else this.spin += dt;
      const s = Math.floor(this.spin / 5) * 5;
      if (s > 0) this.set('spinMeRound', Math.min(60, s));
    } else {
      this.spin = 0;
      this.spinStall = 0;
    }

    // night owl
    if (game.get<Environment>('environment')?.isNight && game.state === 'playing') this.accum('nocturnal', dt, 10);

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
    // "Admire" the mural: stand still near it looking at the painted wall for ~2 s (walking past doesn't count).
    // Final-pass fix (playtest: it fired while climbing the wall right next to the mural): must be on the ground
    // (walk mode + grounded — never climbing/hanging), out on the plaza side 1.5–13 m in front of the painted wall and
    // roughly in line with it (the mural is ~12 m wide), with both Jimothy and the camera facing it.
    if (this.has('humanMade') && this.murals.length) {
      const cam = game.camera;
      const dir = cam.getWorldDirection(new THREE.Vector3());
      const still = p.speed < 0.8 && p.mode === 'walk' && p.grounded;
      const fx = Math.sin(p.facing);
      const fz = Math.cos(p.facing);
      let looking = false;
      for (const m of this.murals) {
        if (m.normal) {
          const ox = p.position.x - m.look.x;
          const oz = p.position.z - m.look.z;
          const front = ox * m.normal.x + oz * m.normal.z; // metres out from the wall (plaza side > 0)
          const side = Math.abs(ox * m.normal.z - oz * m.normal.x); // along the wall, from the mural's centre
          if (front < 1.5 || front > 13 || side > 7.5) continue;
          if (-(fx * m.normal.x + fz * m.normal.z) < 0.35) continue; // Jimothy turned (roughly) towards it
        } else if (m.look.distanceTo(p.position) > 9) continue;
        const to = m.look.clone().sub(cam.position).normalize();
        if (to.dot(dir) > 0.8) looking = true;
      }
      this.admire = looking && still ? this.admire + 0.25 : 0;
      if (this.admire >= 2) this.done('humanMade');
    }
    const total = game.get<ScoreSystem>('score')?.total ?? 0;
    if (total > 0) this.set('localCelebrity', total >= 100000 ? 100000 : Math.floor(total / 5000) * 5000);
    const coll = game.get<any>('collectibles');
    if (coll && typeof coll.collectedCount === 'number' && coll.collectedCount > 0) this.set('bobbleheadCollector', coll.collectedCount);
  }

  private scanPois(world: World | undefined) {
    this.noodle = null;
    if (!world) return;
    const direct = world.poi.get('spaceNoodleTop');
    const murals: THREE.Vector3[] = [];
    for (const [k, v] of world.poi) {
      if (!direct && /space.?noodle/i.test(k) && (!this.noodle || v.y > this.noodle.y)) this.noodle = v;
      if (/mural/i.test(k)) murals.push(v);
    }
    if (direct) this.noodle = direct;
    // keep already-resolved murals (the wall raycast only needs doing once per POI)
    this.murals = murals.map((v) => this.murals.find((m) => m.found && m.pos.equals(v)) ?? this.muralWall(v));
  }

  /** The painted wall behind a mural POI (nearest vertical surface within 8 m), else the POI itself. */
  private muralWall(poi: THREE.Vector3) {
    const from = poi.clone().add(new THREE.Vector3(0, 1, 0));
    let best: THREE.Vector3 | null = null;
    let normal: THREE.Vector3 | null = null; // the painted wall's outward (plaza-side) horizontal normal
    let bestD = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const hit = this.game.physics.raycast(from, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), 8, groups(G.ALL, G.WORLD));
      if (hit && Math.abs(hit.normal.y) < 0.3 && hit.distance < bestD) {
        bestD = hit.distance;
        best = hit.point.clone();
        normal = new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize();
      }
    }
    const look = best ? best.add(new THREE.Vector3(0, 0.8, 0)) : poi.clone().add(new THREE.Vector3(0, 1.5, 0));
    return { pos: poi.clone(), look, found: !!best, normal };
  }
}
