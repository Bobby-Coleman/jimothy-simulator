import * as THREE from 'three';
import { RaccoonRig, RIGS, defaultPose, buildCrow, KIT_NAMES, type RigPose } from '../../entities/animals';
import type { ExtrasFeature, ExtrasHost } from './host';
import { BigFireworks, type Pattern } from './Fireworks';
import { FinaleOverlay, esc } from './FinaleOverlay';
import {
  groundY,
  surfaceAt,
  poi,
  playerOf,
  rigOf,
  uiOf,
  fx,
  toast,
  prompt,
  sceneBusy,
  releaseCamera,
  clamp,
  smooth,
  rand,
  pick,
  damp,
  dampAngle,
} from './shared';

/**
 * FINALE — "Jimothy Summer Forever".
 *
 * Unlocks when the heartwarming arc is done: Mom fed & groomed ('mama'), all five kits home ('kits') and the Danny
 * reunion ('danny') — read from the heart-quest system (`heartQuests.quest(id).done`), re-checked on every
 * 'questComplete'. The landmark honours (summer + degree + salmon) are an optional bonus (extra lines & credits).
 * Then, the next time Jimothy is near the den (or right away with `?finale`), once:
 *
 *   fade → "Later that night…" (22:30, clear sky) → the family outside the den: Mom, the five kits, Danny, crows on
 *   the porch roof and circling, Grandma Rosie waving from down the alley, nearby humans stop to watch → big
 *   fireworks over Salmon Bay (incl. a heart and a raccoon face) → short heartfelt + silly dialogue → credits roll
 *   → "JIMOTHY SUMMER NEVER ENDS — keep playing" → back to free play at night. Hold Jump / the pill to skip.
 *
 * Persisted in localStorage 'jimothy.finale.v1'. Replay: chitter at Mom at night → "Watch the fireworks again?" →
 * chitter again. Events: 'finaleStart' { replay }, 'finaleEnd' { replay, skipped }. Score: "Jimothy Summer Forever".
 */

const STORE = 'jimothy.finale.v1';
const ARC = ['mama', 'kits', 'danny'];
const BONUS = ['summer', 'degree', 'salmon'];

type Phase = 'idle' | 'armed' | 'fadeOut' | 'scene' | 'credits' | 'end' | 'fadeIn';
type ShotName = 'establish' | 'reverse' | 'dialog' | 'grandma' | 'credits';

interface Actor {
  kind: 'mom' | 'kit' | 'danny';
  rig: RaccoonRig;
  pos: THREE.Vector3;
  yaw: number;
  home: THREE.Vector3;
  homeYaw: number;
  pose: RigPose;
  hop: number;
  happy: number;
  wave: number;
  speed: number;
  target: THREE.Vector3 | null;
  faceYaw: number | null;
  nuzzle: boolean;
  seed: number;
}

interface DecoCrow {
  parts: ReturnType<typeof buildCrow>;
  base: THREE.Vector3;
  yaw: number;
  fly: { c: THREE.Vector3; r: number; h: number; a: number; w: number } | null;
  flap: number;
  seed: number;
}

interface Stage {
  home: THREE.Vector3;
  yaw: number;
  fwd: THREE.Vector3;
  side: THREE.Vector3;
  center: THREE.Vector3;
  jimothy: THREE.Vector3;
  mom: THREE.Vector3;
  danny: THREE.Vector3;
  kits: THREE.Vector3[];
  grandma: THREE.Vector3;
  bay: THREE.Vector3;
}

interface Line {
  speaker: string;
  lines: string[];
  portrait?: string;
  color?: string;
  shot?: ShotName;
  before?: () => void;
  after?: () => void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Finale implements ExtrasFeature {
  readonly id = 'finale';
  phase: Phase = 'idle';
  done = false;
  plays = 0;
  replay = false;
  skipped = false;
  private t = 0;
  private st = 0;
  private ct = 0;
  private et = 0;
  private checkT = 0;
  private nagT = 0;
  private safeT = 0;
  private forced = false;
  private run = 0;
  private overlay: FinaleOverlay | null = null;
  private fireworks: BigFireworks | null = null;
  private stage: Stage | null = null;
  private actors: Actor[] = [];
  private crows: DecoCrow[] = [];
  private grandma: any = null;
  private watchers: any[] = [];
  private hidden: THREE.Object3D[] = [];
  private saved: { envFrozen: boolean; weatherForced: any; hud: boolean; state: string } | null = null;
  private flags = new Set<string>();
  private fwAcc = 0;
  private fwRate = 0;
  private skipT = 0;
  private skipArmed = false;
  private offerT = 0;
  private offerCd = 0;
  // camera
  private shot: ShotName = 'establish';
  private shotT = 0;
  private blendDur = 0;
  private blendT = 0;
  private readonly blendPos = new THREE.Vector3();
  private readonly blendLook = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private shotFov = 50;
  // Jimothy acting
  private jimHappy = 0;
  private jimLookUp = 0;
  private jimWave = 0;
  private jimChitter = 0;
  private nuzzleT = 0;
  // fireworks light on the scene
  private flash = 0;
  private readonly flashColor = new THREE.Color(1, 1, 1);

  constructor(private host: ExtrasHost) {}

  get game() {
    return this.host.game;
  }

  // ============================================================================================ lifecycle
  init() {
    const game = this.game;
    try {
      const d = JSON.parse(localStorage.getItem(STORE) || '{}');
      this.done = !!d?.done;
      this.plays = Number(d?.plays) || 0;
    } catch {
      /* fresh */
    }
    game.events.on('questComplete', () => (this.checkT = 0.8));
    game.events.on('chitter', (p: any) => this.onChitter(p?.position));
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('finale')) this.forced = true;
  }

  private save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ done: this.done, plays: this.plays, at: Date.now() }));
    } catch {
      /* ignore */
    }
  }

  /** Heart arc complete? (Mom fed + groomed, all kits home, Danny reunion.) */
  arcComplete(): boolean {
    const hq = this.game.get<any>('heartQuests');
    if (!hq?.quest) return false;
    try {
      return ARC.every((id) => !!hq.quest(id)?.done);
    } catch {
      return false;
    }
  }

  /** Optional bonus: Jimothy Summer + honorary degree + Salmon Run all done. */
  bonusComplete(): boolean {
    const lm = this.game.get<any>('landmarks');
    try {
      return BONUS.every((id) => !!lm?.get?.(id)?.done);
    } catch {
      return false;
    }
  }

  get active() {
    return this.phase !== 'idle' && this.phase !== 'armed';
  }

  /** Start now (tests / replay). */
  start(opts: { replay?: boolean } = {}): boolean {
    if (this.active) return false;
    if (!this.host.claim('finale')) {
      // a cannon flight / wheel ride owns Jimothy: end it cleanly first
      const sys = this.game.get<any>('extras');
      sys?.abortActivities?.();
      if (!this.host.claim('finale')) return false;
    }
    const ui = uiOf(this.game);
    if (ui?.dialog?.open) ui.dialog.close?.();
    this.replay = !!opts.replay;
    this.skipped = false;
    this.run++;
    this.phase = 'fadeOut';
    this.t = 0;
    this.flags.clear();
    this.skipT = 0;
    this.skipArmed = false;
    if (!this.overlay) this.overlay = new FinaleOverlay();
    this.overlay.show();
    this.overlay.setFade(0);
    this.overlay.setCaption(null);
    this.overlay.showCredits(false);
    this.overlay.showEnd(null);
    this.overlay.setSkip(false);
    if (!this.replay && !this.done) {
      this.done = true;
      this.plays++;
      this.save();
    } else {
      this.plays++;
      this.save();
    }
    return true;
  }

  // ============================================================================================ per frame
  update(dt: number) {
    const game = this.game;
    this.t += dt;
    switch (this.phase) {
      case 'idle':
        this.updateIdle(dt);
        break;
      case 'armed':
        this.updateArmed(dt);
        break;
      case 'fadeOut':
        this.overlay?.setFade(this.t / 1.2);
        if (this.t >= 1.25) {
          try {
            this.setupScene();
            this.phase = 'scene';
            this.st = 0;
          } catch (err) {
            console.error('[extras] finale setup failed', err);
            this.teardown();
            this.phase = 'fadeIn';
            this.t = 0;
          }
        }
        break;
      case 'scene':
        this.updateScene(dt);
        if (this.phase === 'scene') this.updateSkip(dt);
        break;
      case 'credits':
        this.updateCredits(dt);
        if (this.phase === 'credits') this.updateSkip(dt);
        break;
      case 'end':
        this.updateEnd(dt);
        break;
      case 'fadeIn':
        this.overlay?.setFade(1 - this.t / 1.2);
        if (this.t >= 1.2) {
          this.overlay?.hide();
          this.phase = 'idle';
          if (!this.replay && this.plays <= 1) {
            toast(game, 'Jimothy Summer Forever', 'Chitter at Mom at night to watch the fireworks again.', 'heart');
          }
        }
        break;
    }
    if (this.phase === 'scene' || this.phase === 'credits' || this.phase === 'end') this.tickFireworks(dt);
  }

  private updateIdle(dt: number) {
    const game = this.game;
    this.checkT -= dt;
    this.offerCd -= dt;
    this.offerT -= dt;
    if (this.forced) {
      this.forced = false;
      this.phase = 'armed';
      this.safeT = 0;
      this.nagT = 1e9;
      return;
    }
    if (!this.done && this.checkT <= 0) {
      this.checkT = 1;
      if (this.arcComplete()) {
        this.phase = 'armed';
        this.safeT = 0;
        this.nagT = 0;
      }
    }
    // replay offer: near Mom at night
    if (this.done && !this.host.busy) {
      const mom = this.realMom();
      const player = playerOf(game);
      const env = game.get<any>('environment');
      if (mom && player && env?.isNight && !sceneBusy(game)) {
        const d = Math.hypot(player.position.x - mom.pos.x, player.position.z - mom.pos.z);
        if (d < 3.4) prompt(game, this.offerT > 0 ? '{chitter} Yes please! (fireworks)' : '{chitter} Watch the fireworks with Mom');
      }
    }
  }

  private updateArmed(dt: number) {
    const game = this.game;
    const player = playerOf(game);
    if (!player) return;
    const home = this.denPos();
    const d = Math.hypot(player.position.x - home.x, player.position.z - home.z);
    this.nagT -= dt;
    if (this.nagT <= 0) {
      this.nagT = 150;
      if (d > 16) toast(game, 'Jimothy Summer Forever', 'Mom, the kits and Danny are all waiting at the den tonight. Head home!', 'heart');
    }
    const forced = this.nagT > 1e8;
    const safe = !this.host.busy && !sceneBusy(game) && player.mode !== 'ragdoll' && (d < 14 || forced);
    this.safeT = safe ? this.safeT + dt : 0;
    // (a forced `?finale` preview before the arc is done plays as an encore and doesn't unlock anything)
    if (this.safeT > 1.5) this.start({ replay: forced && !this.arcComplete() });
  }

  private onChitter(pos?: THREE.Vector3) {
    if (!pos || this.phase !== 'idle' || !this.done || this.host.busy) return;
    const game = this.game;
    const env = game.get<any>('environment');
    const mom = this.realMom();
    if (!mom || !env?.isNight || sceneBusy(game)) return;
    if (Math.hypot(pos.x - mom.pos.x, pos.z - mom.pos.z) > 3.6) return;
    if (this.offerT > 0) {
      this.offerT = 0;
      mom.say?.('heart', 1.5);
      this.start({ replay: true });
      return;
    }
    if (this.offerCd > 0) return;
    this.offerCd = 2;
    this.offerT = 7;
    try {
      mom.say?.('Watch the fireworks again?', 3.5);
    } catch {
      /* optional */
    }
    game.sfx('trill', mom.pos, 0.7, 1.1);
  }

  // ============================================================================================ stage
  private realMom(): any {
    return this.game.get<any>('heartQuests')?.mama?.mom ?? null;
  }

  private denPos(): THREE.Vector3 {
    const mom = this.realMom();
    if (mom?.home) return mom.home.clone();
    return poi(this.game, 'den', new THREE.Vector3(9, 0.3, 23.3));
  }

  private computeStage(): Stage {
    const game = this.game;
    const mom = this.realMom();
    const home = this.denPos();
    const yaw = typeof mom?.homeYaw === 'number' ? mom.homeYaw : 0;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const g = (p: THREE.Vector3) => {
      p.y = groundY(game, p.x, p.z, home.y + 2.4);
      return p;
    };
    const at = (f: number, s: number) => g(home.clone().addScaledVector(fwd, f).addScaledVector(side, s));
    const center = at(3.6, 0);
    // kits: two in front of Mom, two in front of Danny, the littlest (Button) snuggled next to Jimothy
    const kits: THREE.Vector3[] = [at(4.55, -2.45), at(4.95, -1.7), at(4.6, 1.95), at(5.0, 2.65), at(3.95, 0.78)];
    let grandma = at(1.5, -7.5);
    const npcs = game.get<any>('npcs');
    try {
      const spot = npcs?.findSpot?.(grandma, 1.5);
      if (spot && spot.distanceTo(grandma) < 3) grandma = spot.clone();
    } catch {
      /* optional */
    }
    const bayZ = Math.max(center.z + 165, 190);
    return {
      home,
      yaw,
      fwd,
      side,
      center,
      jimothy: center.clone(),
      mom: at(3.35, -1.3),
      danny: at(3.55, 1.4),
      kits,
      grandma,
      bay: new THREE.Vector3(center.x, -1.2, bayZ),
    };
  }

  private setupScene() {
    const game = this.game;
    const player = playerOf(game);
    const stage = (this.stage = this.computeStage());
    const env = game.get<any>('environment');
    const weather = game.get<any>('weather');
    const ui = uiOf(game);
    this.saved = { envFrozen: !!env?.frozen, weatherForced: weather?.forced ?? null, hud: ui?.hudVisible ?? true, state: game.state };
    // --- world: 22:30, clear skies, clock frozen for the show
    try {
      env?.setTime?.(22.5);
      if (env) env.frozen = true;
      if (weather) {
        weather.forced = 'clear';
        if (weather.kind !== 'clear') weather.set?.('clear');
        weather.intensity = 0;
      }
    } catch {
      /* optional */
    }
    if (ui) ui.hudVisible = false;
    game.state = 'cutscene';
    // --- Jimothy
    if (player) {
      if (player.held) player.release(false);
      if (player.mode !== 'walk') player.setMode?.('walk');
      player.teleport(stage.jimothy.clone().setY(stage.jimothy.y + 0.42), stage.yaw);
      player.frozen = true;
    }
    this.jimHappy = this.jimLookUp = this.jimWave = this.jimChitter = this.nuzzleT = 0;
    // --- the family (stand-in actors; the real animals are hidden for the show)
    this.hideRealFamily();
    this.buildActors(stage);
    this.buildCrows(stage);
    this.spawnGrandma(stage);
    this.gatherWatchers(stage);
    // --- fireworks
    if (!this.fireworks) this.fireworks = new BigFireworks(game);
    this.fireworks.clear();
    this.fireworks.listener = stage.center;
    this.fireworks.onBurst = (c, p) => this.onBurst(c, p);
    this.fwAcc = 0;
    this.fwRate = 0;
    // --- camera + overlay
    this.setShot('establish', 0);
    const rig = rigOf(game);
    if (rig) rig.override = this.camFn;
    this.overlay?.setFade(1);
    this.overlay?.setCaption('Later that night…', this.replay ? 'Jimothy Summer, encore' : 'Jimothy Summer, the last night of the summer');
    this.overlay?.setBars(true);
    game.events.emit('finaleStart', { replay: this.replay });
  }

  private hideRealFamily() {
    this.hidden = [];
    const animals = this.game.get<any>('animals');
    for (const a of animals?.list ?? []) {
      if (!a || !a.alive || (a.species !== 'mom' && a.species !== 'kit' && a.species !== 'danny')) continue;
      const root = a.rig?.root as THREE.Object3D | undefined;
      if (!root || !root.visible) continue;
      root.visible = false;
      root.userData.culled = false;
      this.hidden.push(root);
    }
  }

  private buildActors(stage: Stage) {
    const game = this.game;
    const furOn = (game.renderer as any)?.quality !== 'low';
    const mk = (kind: Actor['kind'], pos: THREE.Vector3, yaw: number): Actor => {
      const spec = kind === 'mom' ? RIGS.mom : kind === 'kit' ? RIGS.kit : RIGS.danny;
      const rig = new RaccoonRig(spec);
      rig.root.position.copy(pos);
      rig.root.rotation.y = yaw;
      game.scene.add(rig.root);
      rig.load(game.assets, furOn).catch(() => {});
      return {
        kind,
        rig,
        pos: pos.clone(),
        yaw,
        home: pos.clone(),
        homeYaw: yaw,
        pose: defaultPose(),
        hop: 0,
        happy: 0,
        wave: 0,
        speed: 0,
        target: null,
        faceYaw: null,
        nuzzle: false,
        seed: Math.random() * 10,
      };
    };
    this.actors = [];
    this.actors.push(mk('mom', stage.mom, stage.yaw + 0.22));
    this.actors.push(mk('danny', stage.danny, stage.yaw - 0.28));
    stage.kits.forEach((p, i) => this.actors.push(mk('kit', p, stage.yaw + (i - 2) * 0.12 + rand(-0.1, 0.1))));
  }

  private buildCrows(stage: Stage) {
    const game = this.game;
    this.crows = [];
    // perched along the porch roof edge behind the family
    for (const s of [-2.4, -1.3, 2.6]) {
      const p = stage.home.clone().addScaledVector(stage.fwd, 1.42).addScaledVector(stage.side, s);
      const y = surfaceAt(game, p.x, p.z, stage.home.y + 7, 9);
      p.y = y != null && y < stage.home.y + 6 ? y - 0.12 : stage.home.y + 3.4;
      this.addCrow(p, stage.yaw + rand(-0.4, 0.4), null);
    }
    // a few circling over the parking lot, silhouetted against the show
    for (let i = 0; i < 4; i++) {
      const c = stage.center.clone().addScaledVector(stage.fwd, 10);
      this.addCrow(c.clone(), 0, { c, r: rand(5, 8.5), h: rand(8, 12), a: (i / 4) * Math.PI * 2, w: rand(0.3, 0.45) * (i % 2 ? 1 : -1) });
    }
  }

  private addCrow(p: THREE.Vector3, yaw: number, fly: DecoCrow['fly']) {
    try {
      const parts = buildCrow();
      parts.root.position.copy(p);
      parts.root.rotation.set(0, yaw, 0, 'YXZ');
      parts.root.scale.setScalar(rand(0.95, 1.1));
      this.game.scene.add(parts.root);
      this.crows.push({ parts, base: p.clone(), yaw, fly, flap: 0, seed: Math.random() * 10 });
    } catch (err) {
      console.warn('[extras] crow failed', err);
    }
  }

  private spawnGrandma(stage: Stage) {
    const npcs = this.game.get<any>('npcs');
    this.grandma = null;
    if (!npcs?.spawn) return;
    try {
      const yaw = Math.atan2(stage.center.x - stage.grandma.x, stage.center.z - stage.grandma.z);
      const g = npcs.spawn({
        type: 'grandma',
        position: stage.grandma.clone(),
        name: 'Grandma Rosie',
        stationary: true,
        passive: true,
        lookAtPlayer: false,
        holding: null,
        facing: yaw,
        seed: 7,
      });
      g.setCustom?.(() => {});
      g.face?.(yaw);
      g.gesture = 'wave';
      g.setExpression?.('happy');
      this.grandma = g;
    } catch (err) {
      console.warn('[extras] grandma spawn failed', err);
    }
  }

  /** Humans nearby stop and watch the show (custom-controlled until the end), none in the shot. */
  private gatherWatchers(stage: Stage) {
    const npcs = this.game.get<any>('npcs');
    this.watchers = [];
    if (!npcs?.near) return;
    const look = stage.bay.clone().setY(40);
    // the reverse / credits shots look from the den toward the bay: keep that view cone clear of people
    const inView = (p: THREE.Vector3) => {
      const dx = p.x - stage.home.x;
      const dz = p.z - stage.home.z;
      const f = dx * stage.fwd.x + dz * stage.fwd.z;
      const s = dx * stage.side.x + dz * stage.side.z;
      return f > 0 && f < 30 && Math.abs(s) < f * 0.95 + 2;
    };
    for (const n of npcs.near(stage.center, 40) as any[]) {
      if (!n || n === this.grandma || n.removed || n.ragdolled || n.isCustom) continue;
      try {
        // keep the stage and the shots clear: step aside to the left/right of the view
        if (n.position.distanceTo(stage.center) < 6 || n.position.distanceTo(stage.grandma) < 1.5 || inView(n.position)) {
          const dx = n.position.x - stage.center.x;
          const dz = n.position.z - stage.center.z;
          const sign = dx * stage.side.x + dz * stage.side.z >= 0 ? 1 : -1;
          const want = stage.center.clone().addScaledVector(stage.side, sign * rand(9, 12)).addScaledVector(stage.fwd, rand(2, 8));
          const spot = npcs.findSpot?.(want, 3);
          if (spot && !inView(spot)) n.teleport?.(spot);
        }
        n.setCustom?.(() => {});
        n.face?.(look);
        this.watchers.push(n);
      } catch {
        /* skip this one */
      }
    }
  }

  // ============================================================================================ scene timeline
  private updateScene(dt: number) {
    const game = this.game;
    const st = (this.st += dt);
    const ov = this.overlay;
    // black + caption, then fade in
    if (st < 1.8) ov?.setFade(1);
    else if (st < 3.3) {
      if (!this.flags.has('capOff')) {
        this.flags.add('capOff');
        ov?.setCaption(null);
        ov?.setSkip(true, 0);
      }
      ov?.setFade(1 - smooth((st - 1.8) / 1.5));
    } else ov?.setFade(0);

    // fireworks
    if (st > 2.4 && !this.flags.has('first')) {
      this.flags.add('first');
      this.launch({ pattern: 'peony', scale: 1.25, x: 0 });
      this.fwRate = 0.8;
    }
    if (st > 8.4) this.fwRate = 1.5;
    this.once('raccoon', st > 10.6, () => this.launch({ pattern: 'raccoon', scale: 1.35, x: 0, height: 74 }));
    this.once('heart1', st > 13.4, () => this.launch({ pattern: 'heart', scale: 1.15, x: -18, height: 66 }));

    // little acting beats
    this.once('kitsCheer', st > 3.6, () => {
      for (const a of this.actors) if (a.kind === 'kit') a.hop = 0.5 + Math.random() * 0.4;
      this.kitChirps(3);
    });
    this.once('chitter', st > 5.0, () => {
      this.jimChitter = 0.8;
      game.sfx('chitter', playerOf(game)?.position, 0.9, 1.05);
    });
    this.once('dannyWave', st > 5.6, () => {
      const d = this.actors.find((a) => a.kind === 'danny');
      if (d) d.wave = 3;
      this.jimWave = 2.4;
    });
    this.once('caw', st > 6.6, () => game.sfx('crow_caw', this.stage?.center, 0.6, 1));

    // shots
    this.once('reverse', st > 8.2, () => this.setShot('reverse', 0));
    this.once('dialog', st > 16.8, () => {
      this.fwRate = 0.55;
      this.setShot('dialog', 0);
      void this.runDialogs(this.run);
    });
  }

  private once(key: string, cond: boolean, fn: () => void) {
    if (!cond || this.flags.has(key)) return;
    this.flags.add(key);
    try {
      fn();
    } catch (err) {
      console.warn('[extras] finale beat failed', key, err);
    }
  }

  private kitChirps(n: number) {
    const game = this.game;
    const kits = this.actors.filter((a) => a.kind === 'kit');
    for (let i = 0; i < n && kits.length; i++) game.sfx('kit_chirp', pick(kits).pos, 0.6, rand(1.1, 1.35));
  }

  // ------------------------------------------------------------------------------------------- dialogue
  private lines(): Line[] {
    const game = this.game;
    const bonus = this.bonusComplete();
    const mom = () => this.actors.find((a) => a.kind === 'mom');
    const out: Line[] = [
      {
        speaker: 'Jimothy',
        portrait: 'jimothy',
        lines: ['Chrrr-chrrr! (Translation: best summer ever.)'],
        before: () => {
          this.jimChitter = 0.8;
          this.jimHappy = 2;
          game.sfx('chitter', playerOf(game)?.position, 0.8, 1.1);
        },
      },
      {
        speaker: 'Mom',
        portrait: '🦝',
        color: '#8d8479',
        lines: ["You're round, and you're mine."],
        before: () => {
          const m = mom();
          const player = playerOf(game);
          if (m && player) {
            // scoot over for a nuzzle
            const to = _v.copy(m.home).sub(player.position).setY(0);
            if (to.lengthSq() < 1e-3) to.set(-1, 0, 0);
            to.normalize();
            const target = player.position.clone().addScaledVector(to, 0.95);
            target.y = m.home.y;
            m.target = target;
            m.nuzzle = true;
            this.nuzzleT = 5;
            game.sfx('purr', m.pos, 0.8, 1);
            fx(game, 'hearts', player.position.clone().setY(player.position.y + 0.6), { count: 10 });
          }
        },
        after: () => {
          const m = mom();
          if (m) {
            m.target = m.home.clone();
            m.nuzzle = false;
          }
          this.nuzzleT = 0;
        },
      },
      {
        speaker: KIT_NAMES[0] ?? 'Pip',
        portrait: 'paw',
        color: '#c8a27a',
        lines: ['AGAIN! Do the heart one AGAIN!'],
        before: () => {
          for (const a of this.actors) if (a.kind === 'kit') a.hop = 0.9;
          this.kitChirps(4);
        },
        after: () => this.launch({ pattern: 'heart', scale: 1.3, x: 0, height: 70 }),
      },
      {
        speaker: 'Danny',
        portrait: '🦝',
        color: '#8b8680',
        lines: ['*proud chitter*', '(He still might be your dad. Nobody has checked. Nobody needs to.)'],
        before: () => {
          const d = this.actors.find((a) => a.kind === 'danny');
          if (d) d.wave = 3.5;
        },
      },
      {
        speaker: 'Grandma Rosie',
        portrait: '🧶',
        color: '#d6408a',
        shot: 'grandma',
        lines: ['GOODNIGHT, JIMOTHY! I KNITTED THE FIREWORKS A LITTLE HAT!'],
        before: () => {
          try {
            this.grandma?.emote?.('cheer', 2.5);
          } catch {
            /* optional */
          }
          this.jimWave = 3;
        },
        after: () => {
          try {
            if (this.grandma) this.grandma.gesture = 'wave';
          } catch {
            /* optional */
          }
        },
      },
    ];
    if (bonus) {
      out.push({
        speaker: 'The Crows',
        portrait: '🐦‍⬛',
        color: '#2d2939',
        lines: ['CAW. (For the record: Dr. Jimothy, honorary graduate, Salmon Run champion, face of Jimothy Summer.)'],
        before: () => game.sfx('crow_caw', this.stage?.center, 0.8, 1),
      });
    }
    out.push({
      speaker: 'Mom',
      portrait: '🦝',
      color: '#8d8479',
      lines: ["Everyone's home. I counted twice."],
      before: () => {
        this.jimHappy = 3;
        const m = mom();
        if (m) m.happy = 3;
      },
    });
    return out;
  }

  private async runDialogs(run: number) {
    const game = this.game;
    const ui = uiOf(game);
    for (const l of this.lines()) {
      if (run !== this.run || this.phase !== 'scene') return;
      this.setShot(l.shot ?? 'dialog', l.shot ? 0 : 0.8);
      try {
        l.before?.();
      } catch (err) {
        console.warn('[extras] finale line failed', err);
      }
      if (ui?.showDialog) {
        try {
          await ui.showDialog({ speaker: l.speaker, lines: l.lines, portrait: l.portrait, color: l.color });
        } catch {
          /* keep going */
        }
      } else {
        // no dialogue UI: captions on the overlay
        for (const text of l.lines) {
          this.overlay?.setCaption(`${l.speaker}: ${text}`);
          await this.wait(Math.min(5, 1.8 + text.length * 0.045), run);
        }
        this.overlay?.setCaption(null);
      }
      if (run !== this.run) return;
      try {
        l.after?.();
      } catch (err) {
        console.warn('[extras] finale line failed', err);
      }
    }
    if (run === this.run && this.phase === 'scene') this.toCredits();
  }

  private wait(secs: number, run: number) {
    const until = this.game.time + secs;
    return new Promise<void>((res) => {
      const tick = () => {
        if (run !== this.run || this.game.time >= until) res();
        else setTimeout(tick, 50);
      };
      tick();
    });
  }

  // ------------------------------------------------------------------------------------------- credits
  private toCredits() {
    this.phase = 'credits';
    this.ct = 0;
    this.setShot('credits', 1.2);
    this.fwRate = 1.1;
    this.overlay?.setCredits(this.creditsHtml());
    this.overlay?.scrollCredits(0);
    this.overlay?.showCredits(true);
  }

  private creditsDur() {
    return this.bonusComplete() ? 44 : 41;
  }

  private updateCredits(dt: number) {
    const dur = this.creditsDur();
    this.ct += dt;
    this.overlay?.scrollCredits(clamp(this.ct / dur, 0, 1));
    // a proper finale barrage near the end
    const end = dur - this.ct;
    if (end < 11 && end > 6) this.fwRate = 4.5;
    else if (end <= 6) this.fwRate = 0.6;
    this.once('bigRaccoon', end < 5.5, () => this.launch({ pattern: 'raccoon', scale: 1.5, x: 0, height: 78 }));
    this.once('finalHearts', end < 4.2, () => {
      this.launch({ pattern: 'heart', scale: 1.1, x: -30, height: 64 });
      this.launch({ pattern: 'heart', scale: 1.1, x: 30, height: 64 });
    });
    if (this.ct >= dur) this.toEnd();
  }

  private toEnd() {
    this.phase = 'end';
    this.et = 0;
    this.fwRate = 0.4;
    this.overlay?.showCredits(false);
    this.overlay?.setSkip(false);
    this.overlay?.showEnd('JIMOTHY SUMMER NEVER ENDS', 'keep playing');
    if (!this.replay && !this.flags.has('scored')) {
      this.flags.add('scored');
      this.game.score(2000, 'Jimothy Summer Forever');
    }
    this.game.sfx('jingle_win', undefined, 0.7);
  }

  private updateEnd(dt: number) {
    this.et += dt;
    if (this.et > 4.4) this.overlay?.setFade((this.et - 4.4) / 0.9);
    if (this.et >= 5.35) {
      this.overlay?.showEnd(null);
      this.teardown();
      this.phase = 'fadeIn';
      this.t = 0;
    }
  }

  private updateSkip(dt: number) {
    const game = this.game;
    const ov = this.overlay;
    if (!ov) return;
    const held = game.input.held('jump') || ov.pointerHold;
    // must let go once first (don't skip because Space was already down when the finale began)
    if (!held) this.skipArmed = true;
    if (held && this.skipArmed && !uiOf(game)?.dialog?.open) this.skipT += dt;
    else this.skipT = Math.max(0, this.skipT - dt * 2);
    ov.setSkip(this.st > 1.8 || this.phase === 'credits', this.skipT / 0.8);
    if (this.skipT >= 0.8) this.skip();
  }

  /** Skip to the end card. */
  skip() {
    if (this.phase !== 'scene' && this.phase !== 'credits') return;
    this.skipped = true;
    this.run++; // cancels the dialogue chain
    const ui = uiOf(this.game);
    try {
      if (ui?.dialog?.open) ui.dialog.close();
    } catch {
      /* optional */
    }
    this.overlay?.setCaption(null);
    this.overlay?.setFade(0);
    this.nuzzleT = 0;
    for (const a of this.actors) {
      a.nuzzle = false;
      a.target = null;
    }
    this.setShot('credits', 0);
    this.toEnd();
  }

  // ------------------------------------------------------------------------------------------- teardown
  private teardown() {
    const game = this.game;
    const player = playerOf(game);
    this.run++;
    // actors & props
    for (const a of this.actors) a.rig.root.removeFromParent();
    this.actors = [];
    for (const c of this.crows) c.parts.root.removeFromParent();
    this.crows = [];
    for (const r of this.hidden) r.visible = true;
    this.hidden = [];
    try {
      this.grandma?.remove?.();
    } catch {
      /* optional */
    }
    this.grandma = null;
    for (const n of this.watchers) {
      try {
        if (!n.removed) n.setCustom?.(null);
      } catch {
        /* skip */
      }
    }
    this.watchers = [];
    this.fireworks?.clear();
    // world / UI / player
    const env = game.get<any>('environment');
    const weather = game.get<any>('weather');
    const ui = uiOf(game);
    const s = this.saved;
    if (s) {
      if (env) env.frozen = s.envFrozen;
      if (weather) weather.forced = s.weatherForced;
      if (ui) ui.hudVisible = s.hud;
    }
    this.saved = null;
    if (game.state === 'cutscene') game.state = 'playing';
    releaseCamera(game, this.camFn);
    const rig = rigOf(game);
    if (rig && player) {
      rig.snapBehind(player.facing);
      rig.pitch = -0.3;
    }
    if (player) player.frozen = false;
    this.overlay?.setBars(false);
    this.overlay?.setSkip(false);
    this.overlay?.showCredits(false);
    this.host.release('finale');
    game.events.emit('finaleEnd', { replay: this.replay, skipped: this.skipped });
  }

  // ============================================================================================ fireworks
  private tickFireworks(dt: number) {
    if (!this.fireworks || !this.stage) return;
    this.fwAcc += dt * this.fwRate;
    while (this.fwAcc >= 1) {
      this.fwAcc -= 1 + rand(-0.35, 0.35);
      this.launch({});
    }
  }

  private launch(o: { pattern?: Pattern; scale?: number; x?: number; height?: number }) {
    const s = this.stage;
    if (!s || !this.fireworks) return;
    const x = s.bay.x + (o.x ?? rand(-48, 48));
    const z = s.bay.z + rand(-16, 18);
    const face = _v2.set(s.center.x - x, 0, s.center.z - z).normalize();
    this.fireworks.launch(x, z, { pattern: o.pattern, scale: o.scale, height: o.height, face });
  }

  private onBurst(color: [number, number, number], p: THREE.Vector3) {
    const s = this.stage;
    if (!s) return;
    const d = p.distanceTo(s.center);
    this.overlay?.pulse(color, clamp(55 / d, 0.07, 0.24));
    // light the family with the burst (hemisphere fill flash, applied in lateUpdate)
    const m = Math.max(color[0], color[1], color[2], 1);
    this.flashColor.setRGB(color[0] / m, color[1] / m, color[2] / m);
    this.flash = Math.max(this.flash, clamp(260 / d, 0.4, 1));
    for (const a of this.actors) {
      if (a.kind === 'kit' && Math.random() < 0.55) a.hop = Math.max(a.hop, 0.45);
      a.happy = Math.max(a.happy, 1.2);
    }
    this.jimHappy = Math.max(this.jimHappy, 0.9);
    if (this.watchers.length && Math.random() < 0.5) {
      const n = pick(this.watchers);
      try {
        if (!n.removed && !n.ragdolled) {
          n.emote?.(Math.random() < 0.6 ? 'cheer' : 'aww', 1.6);
          n.setExpression?.('happy');
        }
      } catch {
        /* optional */
      }
    }
    if (Math.random() < 0.3) this.kitChirps(1);
  }

  // ============================================================================================ camera
  private setShot(name: ShotName, blend: number) {
    if (blend > 0) {
      this.blendPos.copy(this.game.camera.position);
      this.blendLook.copy(this.camLook);
    }
    this.shot = name;
    this.shotT = 0;
    this.blendDur = blend;
    this.blendT = 0;
  }

  private evalShot(name: ShotName, t: number, pos: THREE.Vector3, look: THREE.Vector3): number {
    const s = this.stage!;
    const up = (y: number) => _v.set(0, y, 0);
    switch (name) {
      case 'establish': {
        // crane down from above the parking lot (clear of the parked cars) toward the family and the den
        const k = smooth(t / 7);
        pos.copy(s.center).addScaledVector(s.fwd, 7.5 - 1.5 * k).addScaledVector(s.side, 2.6 - 0.6 * k).add(up(5.5 - 2.2 * k));
        look.copy(s.center).addScaledVector(s.fwd, -0.2).addScaledVector(s.side, -1.4).add(up(0.4));
        return 50;
      }
      case 'reverse': {
        const k = smooth(t / 9);
        pos.copy(s.home).addScaledVector(s.fwd, 1.95).add(up(1.15 + 0.2 * k));
        look.copy(s.bay).add(up(36 + 6 * k));
        return 56;
      }
      case 'dialog': {
        const mid = _v2.copy(s.jimothy).lerp(s.mom, 0.45);
        pos.copy(mid).addScaledVector(s.fwd, 2.9).addScaledVector(s.side, 0.75).add(up(0.95 + Math.sin(t * 0.3) * 0.04));
        look.copy(mid).add(up(0.4));
        return 44;
      }
      case 'grandma': {
        pos.copy(s.center).addScaledVector(s.side, 0.9).addScaledVector(s.fwd, 0.9).add(up(1.05));
        look.copy(s.grandma).add(up(1.25));
        return 40;
      }
      case 'credits': {
        // slow crane up behind the family
        // low, just behind and left of Jimothy: the family's silhouettes bottom-right, the show above, the
        // credits panel on the left
        const k = smooth(t / 30);
        pos.copy(s.home).addScaledVector(s.fwd, 1.9 - 0.15 * k).addScaledVector(s.side, -1.0).add(up(1.0 + 0.25 * k));
        look.copy(s.bay).addScaledVector(s.side, -10).add(up(30 - 2 * k));
        return 58;
      }
    }
    return 50;
  }

  private readonly camFn = (cam: THREE.PerspectiveCamera, dt: number) => {
    if (!this.stage) return;
    const d = Math.min(dt, 0.1);
    if (!this.game.paused) this.shotT += d;
    const pos = _camA;
    const look = _camB;
    this.shotFov = this.evalShot(this.shot, this.shotT, pos, look);
    if (this.blendDur > 0 && this.blendT < this.blendDur) {
      if (!this.game.paused) this.blendT += d;
      const k = smooth(this.blendT / this.blendDur);
      pos.lerpVectors(this.blendPos, pos, k);
      look.lerpVectors(this.blendLook, look, k);
    }
    this.camPos.copy(pos);
    this.camLook.copy(look);
    cam.position.copy(pos);
    cam.lookAt(look);
    cam.fov = damp(cam.fov, this.shotFov, 3, d);
    if (this.shotT < 0.05 && this.blendDur === 0) cam.fov = this.shotFov;
    cam.updateProjectionMatrix();
  };

  // ============================================================================================ acting (after physics)
  postPhysics(dt: number) {
    if (!this.active || !this.stage || dt <= 0) return;
    const game = this.game;
    const env = game.get<any>('environment');
    const night = env?.nightFactor ?? 1;
    const player = playerOf(game);
    const camP = game.camera.position;
    this.jimHappy = Math.max(0, this.jimHappy - dt);
    this.jimWave = Math.max(0, this.jimWave - dt);
    this.jimChitter = Math.max(0, this.jimChitter - dt);
    this.nuzzleT = Math.max(0, this.nuzzleT - dt);
    const t = game.time;
    for (const a of this.actors) {
      // walking (Mom's nuzzle)
      a.speed = 0;
      if (a.target) {
        const dx = a.target.x - a.pos.x;
        const dz = a.target.z - a.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.04) a.target = null;
        else {
          const step = Math.min(dist, 1.1 * dt);
          a.pos.x += (dx / dist) * step;
          a.pos.z += (dz / dist) * step;
          a.speed = step / dt;
          a.faceYaw = Math.atan2(dx, dz);
        }
      } else if (a.nuzzle && player) a.faceYaw = Math.atan2(player.position.x - a.pos.x, player.position.z - a.pos.z);
      else a.faceYaw = null;
      a.yaw = dampAngle(a.yaw, a.faceYaw ?? a.homeYaw, 6, dt);
      a.hop = Math.max(0, a.hop - dt);
      a.happy = Math.max(0, a.happy - dt);
      a.wave = Math.max(0, a.wave - dt);
      const hopY = a.hop > 0 ? Math.abs(Math.sin(a.hop * 14)) * 0.07 : 0;
      a.rig.root.position.set(a.pos.x, a.pos.y + hopY, a.pos.z);
      a.rig.root.rotation.set(0, a.yaw, 0, 'YXZ');
      const p = Object.assign(a.pose, defaultPose());
      const moving = a.speed > 0.05;
      p.gait = moving ? 1 : 0;
      p.happy = clamp(a.happy, 0, 1) * 0.9;
      p.tailWag = 0.45 + clamp(a.happy, 0, 1) * 0.5;
      p.lookPitch = -0.38 + Math.sin(t * 0.7 + a.seed) * 0.05;
      p.lookYaw = Math.sin(t * 0.45 + a.seed) * 0.2;
      if (a.kind === 'mom') {
        if (a.nuzzle && !moving) {
          p.stand = 0.3;
          p.groom = 1;
          p.happy = 1;
          p.lookPitch = 0.15;
          p.lookYaw = 0;
          p.tilt = Math.sin(t * 2) * 0.15;
          p.tailWag = 1;
        } else if (!moving) p.sit = 1;
      } else if (a.kind === 'kit') {
        if (!moving) p.sit = a.hop > 0 ? 0.4 : 1;
        p.tailUp = a.hop > 0 ? 0.8 : 0.2;
        p.lookPitch = -0.5 + Math.sin(t * 0.9 + a.seed) * 0.06;
        p.lookYaw = Math.sin(t * 0.6 + a.seed * 3) * 0.35;
      } else {
        p.wave = a.wave > 0 ? 1 : 0;
        p.lookPitch = -0.25;
      }
      a.rig.night = night;
      a.rig.animate(dt, p, a.speed, t);
      const cd = camP.distanceTo(a.pos);
      a.rig.setDetail(cd < 17 ? 0 : cd < 46 ? 1 : 2);
    }
    this.animateCrows(dt);
    this.actJimothy(dt);
  }

  private animateCrows(dt: number) {
    const t = this.game.time;
    for (const c of this.crows) {
      const P = c.parts;
      if (c.fly) {
        const f = c.fly;
        f.a += f.w * dt;
        const x = f.c.x + Math.cos(f.a) * f.r;
        const z = f.c.z + Math.sin(f.a) * f.r;
        const y = f.c.y + f.h + Math.sin(t * 0.8 + c.seed) * 0.6;
        // heading = tangent of the circle
        const yaw = Math.atan2(-Math.sin(f.a) * Math.sign(f.w), Math.cos(f.a) * Math.sign(f.w));
        P.root.position.set(x, y, z);
        P.root.rotation.set(-0.1, yaw, -0.35 * Math.sign(f.w), 'YXZ');
        const flap = Math.sin(t * 11 + c.seed) * 0.9;
        P.wingL.rotation.set(0, 0, flap, 'YZX');
        P.wingR.rotation.set(0, 0, -flap, 'YZX');
        P.legs.visible = false;
      } else {
        c.flap = Math.max(0, c.flap - dt);
        if (c.flap <= 0 && Math.random() < dt * 0.25) c.flap = 0.9;
        const spread = c.flap > 0 ? 1 : 0;
        const wl = c.flap > 0 ? Math.sin(t * 16) * 0.8 : 0;
        const sweep = (1 - spread) * 1.45;
        P.wingL.rotation.set(0, sweep, wl - (1 - spread) * 0.25, 'YZX');
        P.wingR.rotation.set(0, -sweep, -wl + (1 - spread) * 0.25, 'YZX');
        P.head.rotation.set(-0.35 + Math.sin(t * 1.3 + c.seed) * 0.15, Math.sin(t * 0.7 + c.seed) * 0.5, 0);
        P.root.position.set(c.base.x, c.base.y + (c.flap > 0 ? Math.abs(Math.sin(t * 8)) * 0.05 : 0), c.base.z);
      }
    }
  }

  /** Jimothy's little performance on top of his own animation (the player animates first). */
  private actJimothy(dt: number) {
    const player = playerOf(this.game);
    const s = this.stage;
    if (!player?.model || !s) return;
    const t = this.game.time;
    const mom = this.actors.find((a) => a.kind === 'mom');
    if (this.nuzzleT > 0 && mom) player.facing = Math.atan2(mom.pos.x - player.position.x, mom.pos.z - player.position.z);
    else player.facing = dampAngle(player.facing, s.yaw, 3, dt);
    this.jimLookUp = damp(this.jimLookUp, this.nuzzleT > 0 || this.shot === 'dialog' ? 0.2 : 1, 3, dt);
    const parts = player.model.parts ?? {};
    const head = parts.Head as THREE.Object3D | undefined;
    if (head) {
      // (the real Jimothy can barely lift his head, so the walking model only glances up)
      head.rotateX((player.model.quad ? -0.12 : -0.3) * this.jimLookUp);
      if (this.nuzzleT > 0) head.rotateZ(Math.sin(t * 2.2) * 0.14);
      if (this.jimChitter > 0) head.rotateZ(Math.sin(t * 30) * 0.1 * this.jimChitter);
    }
    const squint = this.nuzzleT > 0 ? 0.2 : this.jimHappy > 0 ? 0.35 : 1;
    if (squint < 1) {
      for (const n of ['EyeL', 'EyeR']) {
        const e = parts[n] as THREE.Object3D | undefined;
        if (e) e.scale.y = Math.min(e.scale.y, squint);
      }
    }
    const mouth = parts.Mouth as THREE.Object3D | undefined;
    if (mouth && this.jimChitter > 0) mouth.scale.y = 1 + Math.abs(Math.sin(t * 34)) * 2 * this.jimChitter;
    if (this.jimWave > 0) {
      const arm = parts.ArmR as THREE.Object3D | undefined;
      const k = Math.min(1, this.jimWave * 2);
      arm?.rotateX((-2.5 + Math.sin(t * 10) * 0.35) * k);
    }
  }

  lateUpdate(dt: number) {
    if (!this.overlay) return;
    if (!this.game.paused) {
      this.overlay.update(dt);
      if (this.fireworks) this.fireworks.update(dt * this.game.timeScale, this.game.camera);
      this.flash = Math.max(0, this.flash - dt * 2.2);
    }
    // Stage lighting: the environment re-sets its lights every frame (it runs first), so this is a per-frame
    // tweak that disappears by itself — a warmer, brighter fill so faces read at night, plus fireworks flashes.
    if (this.stage && (this.phase === 'scene' || this.phase === 'credits' || this.phase === 'end')) {
      const hemi = this.game.get<any>('environment')?.hemi as THREE.HemisphereLight | undefined;
      if (hemi) {
        hemi.intensity *= 1.5;
        hemi.color.lerp(WARM, 0.2);
        if (this.flash > 0) {
          hemi.color.lerp(this.flashColor, Math.min(0.6, this.flash * 0.6));
          hemi.intensity += this.flash * 0.8;
        }
      }
    }
  }

  // ============================================================================================ credits text
  private creditsHtml(): string {
    const bonus = this.bonusComplete();
    const row = (who: string, as: string) => `<p><span class="who">${esc(who)}</span> <span class="as">— ${esc(as)}</span></p>`;
    const h2 = (s: string) => `<h2>${esc(s)}</h2>`;
    const p = (s: string, cls = '') => `<p${cls ? ` class="${cls}"` : ''}>${esc(s)}</p>`;
    return [
      `<h1>JIMOTHY<br>SIMULATOR</h1>`,
      `<p class="lede">A game about Jimothy, a real raccoon who deserves nothing but peace.</p>`,
      h2('STARRING'),
      row('Jimothy', 'Himself (probably)'),
      row('Mom', 'Mom'),
      row(KIT_NAMES.join(', ').replace(/, ([^,]*)$/, ' & $1'), 'The Kits'),
      row('Danny', 'Possibly Dad (unconfirmed, unbothered)'),
      row('The Crows', 'The Crows (paid in shiny things)'),
      row('Grandma Rosie', 'Grandma Rosie (knitted everyone a hat)'),
      row('Actual Cat', 'Actual Cat (declined to comment)'),
      row('The Slopothys', 'Themselves, unfortunately'),
      row('SlopBot™', '[removed at SlopBot’s own request]'),
      bonus ? p('and introducing Dr. Jimothy (Hon.), Salmon Run Champion and the face of Jimothy Summer', 'joke') : '',
      h2('FILMED ON LOCATION IN'),
      p('Ballard-ish, Seattle-ish'),
      h2('SPECIAL THANKS'),
      p('The City of Seattle, for Jimothy Summer'),
      p('The Ballard Barnacles, for Jimothy Night'),
      p('The University of Washing, for the degree'),
      p('A nice lady with a phone'),
      p('Everyone who saw a round raccoon and felt a little better'),
      h2('3D MODELS'),
      p('Kenney — kenney.nl (CC0)'),
      h2('TEXTURES & SKY'),
      p('Poly Haven — polyhaven.com (CC0)'),
      p('Rob Tuytel · Charlotte Baglioni · Dario Barresi · Dimitrios Savva · Greg Zaal · Jarod Guest', 'small'),
      h2('FONTS'),
      p('Luckiest Guy — Astigmatic · Lilita One — Juan Montoreano · Nunito — The Nunito Project'),
      p('via Google Fonts (Apache-2.0 / SIL OFL 1.1)', 'small'),
      h2('SOUND'),
      p('Kenney — Impact, RPG, Interface, Sci-fi, Jingle & Voiceover packs (CC0)'),
      p('Raccoon chitters, crowds and slop noises synthesized from scratch', 'small'),
      h2('MUSIC (CC0, VIA OPENGAMEART)'),
      p('skrjablin · Fupi · HaelDB · omfgdude · qubodup · congusbongus · Of Far Different Nature'),
      h2('MADE BY'),
      p('A team of AI agents, overnight, while a human slept.'),
      p('(He woke up to a raccoon cannon. We regret nothing.)', 'joke'),
      p('No real raccoons were bonked. Several Slopothys were washed.', 'small'),
      `<div class="note"><b>A REAL NOTE</b>Real Jimothy is a wild animal. Admire him from a distance. Never feed wild raccoons.<br>He's fine on his own. He has his mom.</div>`,
      p('An unofficial fan game. Jimothy belongs to nobody, and to all of Seattle.', 'small fin'),
    ].join('');
  }

  // ============================================================================================ misc
  /** Abort everything immediately (tests / errors). */
  abort() {
    if (!this.active) return;
    this.teardown();
    this.overlay?.hide();
    this.phase = 'idle';
  }
}

const _camA = new THREE.Vector3();
const _camB = new THREE.Vector3();
const WARM = new THREE.Color(0xffc49a);
