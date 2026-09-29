/**
 * AudioSystem — wires the AudioManager into the game (registered as 'audio').
 *
 *  - Unlocks WebAudio on the first user gesture; starts loading sounds at boot (worker-synthesized).
 *  - Listener: camera orientation for panning, Jimothy for distance ("ears" at the player).
 *  - Plays every `game.sfx(key, pos?, volume?, pitch?)` ('sfx' event).
 *  - Player-driven sounds: wash loop, roll loop (∝ speed), paw steps, climbing scrabbles, swim paddles.
 *  - Ambience: water lapping near the bay/ponds/fountains, crows & seagulls, SlopCorp server hum.
 *  - Music: title / day / night / slop (SlopCorp Campus), debounced crossfades.
 *  - Reacts to gameplay events (objective, mutatorUnlocked, comboUp, scoreAdded, cameraFlash,
 *    explosion, npcRagdoll, splash, sparkle, ...) with dedupe so systems that ALSO emit 'sfx' for
 *    the same moment never double-play.
 *  - Volumes: 'audioVolume' {master?, sfx?, music?} events / setVolumes(), persisted in localStorage.
 *  - Never throws: every hook and handler is guarded; no audio = silent game.
 */
import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import { audio, type AudioVolumes, type MusicTrack, type SoundHandle, type SoundOpts } from './AudioManager';

const STORAGE_KEY = 'jimothy.audio';
const SLOP_AREA = 'SlopCorp Campus';

/** Keys that gameplay events trigger and that some systems also emit via game.sfx(): dedupe window (s). */
const DEDUPE: Record<string, number> = {
  objective_complete: 1.5,
  mutator_unlock: 1.5,
  combo_up: 0.3,
  explosion: 0.12,
  camera_shutter: 0.05,
  splash: 0.12,
  splash_big: 0.3,
  sparkle: 0.15,
  trash_can: 0.1,
};

interface PlayerView {
  position: THREE.Vector3;
  speed: number;
  mode: string;
  grounded: boolean;
  washing: boolean;
  climbSpeed?: number;
  model?: { root?: THREE.Object3D };
}
interface WaterVol {
  kind: string;
  center: THREE.Vector3;
  radius?: number;
  halfX: number;
  halfZ: number;
  surfaceY: number;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const rr = (a: number, b: number) => a + Math.random() * (b - a);
const now = () => performance.now() / 1000;
const _p = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Best-effort world position from an event payload ({position} / {entity} / {by} ...). */
function posOf(p: unknown): THREE.Vector3 | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const o = p as Record<string, any>;
  const c = o.position ?? o.pos ?? o.point;
  if (c && typeof c.x === 'number' && typeof c.z === 'number') return _p.set(c.x, c.y ?? 0, c.z);
  const e = o.entity ?? o.by ?? o.npc ?? o.from;
  const obj = e?.object ?? e?.root ?? e?.mesh;
  if (obj && typeof obj.getWorldPosition === 'function') return obj.getWorldPosition(_p);
  const b = e?.body;
  if (b && typeof b.translation === 'function') {
    const t = b.translation();
    return _p.set(t.x, t.y, t.z);
  }
  return undefined;
}

export class AudioSystem implements System {
  name = 'audio';
  /** The AudioManager singleton (handy from the console: jimothy.get('audio').manager.stats()). */
  readonly manager = audio;
  private game!: Game;
  private recent = new Map<string, number>();
  private wash: SoundHandle | null = null;
  private roll: SoundHandle | null = null;
  private waterAmb: SoundHandle | null = null;
  private waterKind = '';
  private hum: SoundHandle | null = null;
  private stepAcc = 0.2;
  private climbAcc = 0;
  private swimAcc = 0;
  private birdTimer = 8;
  private scoreGate = 0;
  private screamGate = 0;
  private ragdollGate = 0;
  private music: MusicTrack | null = null;
  private musicCandidate: MusicTrack | null = null;
  private candidateSince = 0;
  private earsSet = false;
  private gestureEvents = ['pointerdown', 'mousedown', 'keydown', 'touchend', 'click'];

  init(game: Game) {
    this.game = game;
    try {
      this.loadVolumes();
      audio.setListener(game.camera);
      if (typeof window !== 'undefined') for (const ev of this.gestureEvents) window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
      void audio.load(); // decoding + synthesis run off the main thread; fine to start at boot

      const on = (name: string, fn: (p: any) => void) =>
        game.events.on(name, (p) => {
          try {
            fn(p);
          } catch (e) {
            console.warn(`[audio] handler for "${name}" failed`, e);
          }
        });
      on('sfx', (p) => this.onSfx(p));
      on('audioVolume', (p) => this.setVolumes(p ?? {}));
      on('objective', () => this.once('objective_complete'));
      on('mutatorUnlocked', () => this.once('mutator_unlock'));
      on('comboUp', (p) => this.once('combo_up', { pitch: clamp(1 + ((p?.mult ?? 1.5) - 1.5) * 0.09, 1, 1.6) }));
      on('scoreAdded', (p) => {
        const t = now();
        if (t - this.scoreGate < 0.13 || p?.silent) return;
        this.scoreGate = t;
        audio.play('score', { volume: 0.55, pitch: 1 + Math.min(0.5, (p?.combo ?? 0) * 0.025) });
      });
      on('cameraFlash', (p) => this.once('camera_shutter', { position: posOf(p), volume: 0.8 }));
      on('filmed', (p) => this.once('camera_shutter', { position: posOf(p), volume: 0.8 }));
      on('explosion', (p) => this.once('explosion', { position: posOf(p), volume: clamp(p?.strength ?? 1, 0.4, 1) }));
      on('npcRagdoll', (p) => this.onNpcRagdoll(p));
      on('splash', (p) => {
        const s = Number(p?.strength ?? 0);
        const pos = posOf(p);
        if (s > 11) this.once('splash_big', { position: pos, volume: clamp(s / 20, 0.5, 1) });
        else if (s > 0) this.once('splash', { position: pos, volume: clamp(s / 10, 0.25, 1) });
      });
      on('sparkle', (p) => this.once('sparkle', { position: posOf(p), volume: 0.7 }));
      on('trashTipped', (p) => this.once('trash_can', { position: posOf(p) }));
      on('cottonCandyGone', () => audio.play('fizz', { volume: 0.9 }));
      on('wash', () => {
        const pl = this.player();
        if (pl) for (let i = 0; i < 3; i++) audio.play('bubble_pop', { position: pl.position, volume: 0.5, delay: i * 0.07 });
      });
      on('playerRagdoll', (p) => {
        const pl = this.player();
        if (pl && p?.cause === 'flop') audio.play('flop', { position: pl.position });
      });
      on('playerImpact', (p) => {
        const pl = this.player();
        if (!pl) return;
        audio.play('impact_body', { position: pl.position, volume: clamp((p?.strength ?? 15) / 30, 0.4, 1) });
        audio.play('squeak', { position: pl.position, volume: 0.7, delay: 0.05 });
      });
      on('climbStart', () => {
        const pl = this.player();
        if (pl) audio.play('climb', { position: pl.position, volume: 0.7 });
      });
      on('hangStart', () => {
        const pl = this.player();
        if (pl) audio.play('grab', { position: pl.position });
      });
    } catch (e) {
      console.warn('[audio] AudioSystem init failed; running silent', e);
    }
  }

  /** Set and persist volumes (0..1). Also reachable via the 'audioVolume' event. */
  setVolumes(v: Partial<AudioVolumes>) {
    try {
      audio.setVolumes(v);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(audio.getVolumes()));
    } catch {
      /* storage may be unavailable */
    }
  }

  getVolumes(): AudioVolumes {
    return audio.getVolumes();
  }

  lateUpdate(dt: number, game: Game) {
    try {
      const p = this.player();
      if (p && !this.earsSet && p.model?.root) {
        audio.setListener(game.camera, p.model.root);
        this.earsSet = true;
      }
      audio.setWorldPaused(game.state === 'paused');
      const live = game.state === 'playing' || game.state === 'cutscene';
      if (p) this.playerSounds(dt, p, live && !game.paused);
      else this.stopPlayerLoops();
      if (p) this.ambience(dt, p, live && !game.paused);
      this.updateMusic(p);
      audio.update(dt);
    } catch (e) {
      console.warn('[audio] lateUpdate failed', e);
    }
  }

  // ------------------------------------------------------------------------------ helpers

  private onGesture = () => {
    if (audio.unlocked) return;
    void audio.unlock();
  };

  private player(): PlayerView | undefined {
    return this.game?.get('player') as unknown as PlayerView | undefined;
  }

  private play(key: string, opts?: SoundOpts): SoundHandle | null {
    this.recent.set(key, now());
    return audio.play(key, opts);
  }

  /** Play unless the same key already played within its dedupe window. */
  private once(key: string, opts?: SoundOpts): SoundHandle | null {
    const win = DEDUPE[key] ?? 0.1;
    if (now() - (this.recent.get(key) ?? -1e9) < win) return null;
    return this.play(key, opts);
  }

  private onSfx(p: any) {
    if (!p || typeof p.key !== 'string') return;
    const opts: SoundOpts = {};
    if (p.position && typeof p.position.x === 'number') opts.position = p.position;
    if (typeof p.volume === 'number') opts.volume = p.volume;
    if (typeof p.pitch === 'number') opts.pitch = p.pitch;
    if (DEDUPE[p.key] != null) this.once(p.key, opts);
    else this.play(p.key, opts);
  }

  private onNpcRagdoll(p: any) {
    const t = now();
    if (t - this.ragdollGate < 0.15) return;
    this.ragdollGate = t;
    const pos = posOf(p);
    if (t - this.screamGate > 1.2 && Math.random() < 0.55) {
      this.screamGate = t;
      audio.play('scream', { position: pos, volume: 0.8, delay: 0.05 });
    } else audio.play('whoosh', { position: pos, volume: 0.45 });
  }

  // ------------------------------------------------------------------------------ player-driven

  private stopPlayerLoops() {
    this.wash?.stop(0.25);
    this.wash = null;
    this.roll?.stop(0.2);
    this.roll = null;
  }

  private playerSounds(dt: number, p: PlayerView, live: boolean) {
    const pos = p.position;
    // washing: bubbly loop while Wash is held at water
    if (live && p.washing) {
      if (!this.wash || !this.wash.playing) this.wash = audio.play('wash_loop', { position: pos, volume: 0.9 });
      else this.wash.setPosition(pos);
    } else if (this.wash) {
      this.wash.stop(0.25);
      this.wash = null;
    }
    // tuck & roll: rumble ∝ speed, quiet in the air
    if (live && p.mode === 'roll') {
      const vol = clamp(p.speed / 7, 0.05, 1) * (p.grounded ? 1 : 0.15);
      const pitch = 0.55 + clamp(p.speed / 9, 0, 1.3);
      if (!this.roll || !this.roll.playing) this.roll = audio.play('roll_loop', { position: pos, volume: vol, pitch });
      else {
        this.roll.setVolume(vol);
        this.roll.setPitch(pitch);
        this.roll.setPosition(pos);
      }
    } else if (this.roll) {
      this.roll.stop(0.2);
      this.roll = null;
    }
    if (!live) return;
    // paw steps: quick raccoon pitter-patter, faster with speed
    if (p.mode === 'walk' && p.grounded && p.speed > 0.5) {
      this.stepAcc += dt;
      const interval = clamp(0.34 - p.speed * 0.028, 0.11, 0.34);
      if (this.stepAcc >= interval) {
        this.stepAcc = 0;
        audio.play(this.stepKey(p), { position: pos, volume: clamp(0.35 + p.speed * 0.08, 0.3, 0.9) });
      }
    } else this.stepAcc = 0.2;
    // climbing: claw scrabbles while moving on a wall
    if (p.mode === 'climb') {
      const moving = Math.abs(p.climbSpeed ?? p.speed) > 0.2;
      this.climbAcc += moving ? dt : 0;
      if (this.climbAcc > 0.38) {
        this.climbAcc = 0;
        audio.play('climb', { position: pos, volume: 0.55 });
      }
    } else this.climbAcc = 0;
    // swimming: little paddle splashes
    if (p.mode === 'swim' && p.speed > 0.5) {
      this.swimAcc += dt;
      if (this.swimAcc > 0.55) {
        this.swimAcc = 0;
        audio.play('splash', { position: pos, volume: 0.18, pitch: 1.35 });
      }
    } else this.swimAcc = 0;
  }

  private stepKey(p: PlayerView): string {
    const area = this.area(p);
    if (area && /park|hill|quad|lawn|garden/i.test(area)) return 'footstep_grass';
    if (area && /dock|pier|waterfront/i.test(area)) return 'footstep_wood';
    return 'footstep';
  }

  private area(p: PlayerView): string | null {
    const world = this.game.get('world') as unknown as { areaAt?(x: number, z: number): string | null } | undefined;
    try {
      return world?.areaAt?.(p.position.x, p.position.z) ?? null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------------------ ambience

  private ambience(dt: number, p: PlayerView, live: boolean) {
    const pos = p.position;
    // water lapping near the bay / ponds / fountains / pools
    const water = this.game.get('water') as unknown as { nearWater?(p: THREE.Vector3, r: number): WaterVol | null } | undefined;
    let vol: WaterVol | null = null;
    try {
      vol = live ? (water?.nearWater?.(pos, 18) ?? null) : null;
    } catch {
      vol = null;
    }
    if (vol && /bay|pond|fountain|pool/.test(vol.kind)) {
      // nearest point on the water surface
      if (vol.radius != null) {
        _w.set(pos.x - vol.center.x, 0, pos.z - vol.center.z);
        const d = _w.length();
        if (d > vol.radius) _w.multiplyScalar(vol.radius / d);
        _w.add(vol.center).setY(vol.surfaceY);
      } else _w.set(clamp(pos.x, vol.center.x - vol.halfX, vol.center.x + vol.halfX), vol.surfaceY, clamp(pos.z, vol.center.z - vol.halfZ, vol.center.z + vol.halfZ));
      const loud = vol.kind === 'bay' ? 1 : vol.kind === 'fountain' ? 0.8 : 0.6;
      if (!this.waterAmb || !this.waterAmb.playing || this.waterKind !== vol.kind) {
        this.waterAmb?.stop(0.8);
        this.waterAmb = audio.play('water_loop', { position: _w, volume: loud, pitch: vol.kind === 'fountain' ? 1.35 : vol.kind === 'bay' ? 0.85 : 1 });
        this.waterKind = vol.kind;
      } else this.waterAmb.setPosition(_w);
    } else if (this.waterAmb) {
      this.waterAmb.stop(1);
      this.waterAmb = null;
    }

    // SlopCorp data-center hum
    const inSlop = live && this.area(p) === SLOP_AREA && !(this.game as any).get?.('slop')?.unplugged;
    if (inSlop && (!this.hum || !this.hum.playing)) this.hum = audio.play('server_hum_loop', { volume: 0.35 });
    else if (!inSlop && this.hum) {
      this.hum.stop(1.5);
      this.hum = null;
    }

    // birds: Seattle crows everywhere by day (a few at night), gulls near the bay
    if (!live) return;
    this.birdTimer -= dt;
    if (this.birdTimer > 0) return;
    const area = this.area(p) ?? '';
    const env = this.game.get('environment') as unknown as { isNight?: boolean } | undefined;
    const night = !!env?.isNight;
    this.birdTimer = rr(7, 16) * (/park/i.test(area) ? 0.6 : 1) * (night ? 2 : 1);
    let nearBay = false;
    try {
      nearBay = water?.nearWater?.(pos, 45)?.kind === 'bay';
    } catch {
      nearBay = false;
    }
    let key: string | null = null;
    if (nearBay && !night && Math.random() < 0.65) key = 'seagull';
    else if (!night || Math.random() < 0.25) key = 'crow_caw';
    if (!key) return;
    const a = Math.random() * Math.PI * 2;
    const d = rr(16, 40);
    _w.set(pos.x + Math.cos(a) * d, pos.y + rr(6, 14), pos.z + Math.sin(a) * d);
    audio.play(key, { position: _w, volume: rr(0.45, 0.8) });
  }

  // ------------------------------------------------------------------------------ music

  private updateMusic(p: PlayerView | undefined) {
    const g = this.game;
    let want: MusicTrack;
    // 'title' is the title-screen music player's playlist: requested once here; the player widget
    // (src/ui/MusicPlayer.ts) then picks tracks / pauses it directly. Gameplay hands back to day/night/slop.
    if (g.state === 'title') want = 'title';
    else if (p && this.area(p) === SLOP_AREA) want = 'slop';
    else {
      const env = g.get('environment') as unknown as { isNight?: boolean } | undefined;
      want = env?.isNight ? 'night' : 'day';
    }
    const t = now();
    if (want !== this.musicCandidate) {
      this.musicCandidate = want;
      this.candidateSince = t;
    }
    // debounce area/time flapping, but switch immediately from the title screen / at start
    const settle = this.music == null || this.music === 'title' || want === 'title' ? 0 : 1.5;
    if (want !== this.music && t - this.candidateSince >= settle) {
      const fade = this.music === 'title' || want === 'title' ? 1.5 : want === 'slop' || this.music === 'slop' ? 2 : 4;
      audio.playMusic(want, fade);
      this.music = want;
    }
  }

  // ------------------------------------------------------------------------------ settings

  private loadVolumes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) audio.setVolumes(JSON.parse(raw) as Partial<AudioVolumes>);
    } catch {
      /* ignore */
    }
  }
}
