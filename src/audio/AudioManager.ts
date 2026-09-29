/**
 * AudioManager — self-contained WebAudio sound + music player for Jimothy Simulator.
 *
 *  - Sound keys come from ./soundBank.ts (see SOUNDS.md). A key has 1..n variations (CC0 files,
 *    procedural synth recipes rendered in a Web Worker at load time, or processed files).
 *  - Positional sounds: inverse-distance attenuation from the "ears" (listener or a separate
 *    object, e.g. the player), stereo pan from the listener's orientation, distance low-pass,
 *    silent/culled beyond maxDist (~60 m default).
 *  - Per-key concurrency caps + min gap between plays, global voice cap, master limiter:
 *    physics chaos can't turn into ear-rape.
 *  - Music streams through <audio> elements (low memory) with crossfades, playlists and ducking.
 *  - Everything fails soft: no WebAudio, blocked autoplay, missing files, decode errors -> silence
 *    and at most one console warning per problem. Public methods never throw.
 *
 * Only depends on `three` (for Vector3/Object3D) and files in src/audio/.
 */
import * as THREE from 'three';
import { MUSIC_BANK, SOUND_BANK, type MusicTrack, type SoundDef } from './soundBank';
import { PROCESSORS, RECIPES, renderRecipe } from './synth/recipes';

export type { MusicTrack } from './soundBank';

export type SoundOpts = {
  /** Volume multiplier (default 1). */
  volume?: number;
  /** Playback-rate multiplier (default 1; 2 = octave up). */
  pitch?: number;
  /** Random ± fraction applied to pitch (default: the key's pitchVar, usually 0.05). */
  pitchVar?: number;
  /** World position -> positional sound. Omit for 2D (UI-style) playback. */
  position?: THREE.Vector3;
  /** Loop until stopped (default: the key's `loop`). */
  loop?: boolean;
  /** Start delay in seconds. */
  delay?: number;
};

export interface SoundHandle {
  /** Stop (with a short fade, default 0.06 s). Safe to call repeatedly. */
  stop(fadeSec?: number): void;
  /** Set the volume multiplier (e.g. from speed for loops). */
  setVolume(v: number): void;
  /** Set the playback-rate multiplier (smoothed). */
  setPitch(p: number): void;
  /** Move a positional sound (copied). `null` makes it non-positional. */
  setPosition(p: THREE.Vector3 | null): void;
  /** False once stopped / finished. */
  readonly playing: boolean;
}

export interface AudioVolumes {
  master: number;
  sfx: number;
  music: number;
}

interface Variant {
  buffer: AudioBuffer;
  loud: number;
  gain: number;
  fromFile: boolean;
}

type Job =
  | { kind: 'file'; key: string; file: string }
  | { kind: 'process'; key: string; file: string; with: string; seed: number }
  | { kind: 'synth'; key: string; recipe: string; variant: number };

interface MusicPlayer {
  track: MusicTrack;
  el: HTMLAudioElement;
  trim: GainNode;
  fade: GainNode;
  idx: number;
  failed: Set<number>;
  stopping: boolean;
  stopAt: number;
  want: boolean;
  dead: boolean;
}

const MAX_VOICES = 48;
const DEFAULT_MAX = 4;
const DEFAULT_GAP = 0.025;
const DEFAULT_REF = 4;
const DEFAULT_MAXDIST = 60;
const DEFAULT_PITCHVAR = 0.05;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const nowSec = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
const yieldToMain = () => new Promise<void>((r) => setTimeout(r, 0));
const finite = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
/** Accepts THREE.Vector3 or any {x,y,z}; returns a fresh Vector3, or undefined if unusable. */
function toVec(p: unknown): THREE.Vector3 | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const o = p as { x?: unknown; y?: unknown; z?: unknown };
  if (typeof o.x !== 'number' || typeof o.z !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.z)) return undefined;
  return new THREE.Vector3(o.x, finite(o.y, 0), o.z);
}

/** Loudest 50 ms RMS window across channels (used to even out file variations). */
function loudness(b: AudioBuffer): number {
  const w = Math.max(1, Math.floor(b.sampleRate * 0.05));
  const hop = Math.max(1, w >> 2);
  let best = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i += hop) {
      const end = Math.min(d.length, i + w);
      let s = 0;
      for (let j = i; j < end; j++) s += d[j] * d[j];
      best = Math.max(best, Math.sqrt(s / w));
      if (end === d.length) break;
    }
  }
  return best;
}

class Voice implements SoundHandle {
  src: AudioBufferSourceNode | null = null;
  out: GainNode | null = null;
  lp: BiquadFilterNode | null = null;
  pan: StereoPannerNode | null = null;
  pos: THREE.Vector3 | null = null;
  /** Key volume x variant normalization gain. */
  base = 1;
  /** User volume (opts.volume / setVolume). */
  user = 1;
  /** User pitch (opts.pitch / setPitch). */
  rate = 1;
  /** Key base pitch x random variation, fixed at start. */
  pitchMul = 1;
  pitchVar = 0;
  delay = 0;
  endAt = Infinity;
  stopAt = Infinity;
  dynamic = false;
  state: 'waiting' | 'playing' | 'stopping' | 'done' = 'waiting';
  children: { h: SoundHandle; vol: number }[] = [];
  readonly key: string;
  readonly def: SoundDef;
  readonly loop: boolean;
  private mgr: AudioManager;

  constructor(mgr: AudioManager, key: string, def: SoundDef, loop: boolean) {
    this.mgr = mgr;
    this.key = key;
    this.def = def;
    this.loop = loop;
  }
  get playing() {
    return this.state === 'waiting' || this.state === 'playing';
  }
  stop(fadeSec = 0.06) {
    try {
      this.mgr._stopVoice(this, fadeSec);
      for (const c of this.children) c.h.stop(fadeSec);
    } catch {
      /* never throw */
    }
  }
  setVolume(v: number) {
    if (!Number.isFinite(v)) return;
    this.user = Math.max(0, v);
    try {
      this.mgr._applyGain(this, false);
      for (const c of this.children) c.h.setVolume(this.user * c.vol);
    } catch {
      /* never throw */
    }
  }
  setPitch(p: number) {
    if (!Number.isFinite(p) || p <= 0) return;
    this.rate = p;
    try {
      const ctx = this.mgr.ctx;
      if (this.src && ctx) this.src.playbackRate.setTargetAtTime(clamp(this.pitchMul * p, 0.05, 8), ctx.currentTime, 0.06);
    } catch {
      /* never throw */
    }
  }
  setPosition(p: THREE.Vector3 | null) {
    const v = toVec(p);
    if (v) {
      (this.pos ??= new THREE.Vector3()).copy(v);
      this.dynamic = true;
    } else if (!p) this.pos = null;
    try {
      this.mgr._applyGain(this, false);
    } catch {
      /* never throw */
    }
  }
}

export class AudioManager {
  /** Every sound key in the bank. */
  readonly keys: string[] = Object.keys(SOUND_BANK);
  /** Music track names. */
  readonly tracks = Object.keys(MUSIC_BANK) as MusicTrack[];
  /** The AudioContext (null until unlock(), or if WebAudio is unavailable). */
  ctx: AudioContext | null = null;
  /** Loading progress (jobs = files + synth variations). */
  readonly progress = { done: 0, total: 0 };
  /** How many times each key actually started playing (debug / tests). */
  readonly playCounts = new Map<string, number>();

  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private worldBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private decoder: BaseAudioContext | null = null;
  private variants = new Map<string, Variant[]>();
  private voices: Voice[] = [];
  private lastPlay = new Map<string, number>();
  private lastVariant = new Map<string, number>();
  private warned = new Set<string>();
  private loadPromise: Promise<void> | null = null;
  private progressCbs: ((done: number, total: number) => void)[] = [];
  private synthQueue: Extract<Job, { kind: 'synth' }>[] = [];
  private worker: Worker | null = null;
  private workerBroken = false;
  private reqId = 0;
  private pending = new Map<number, { resolve: (r: { chans: Float32Array[]; sr: number }) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  private volumes: AudioVolumes = { master: 0.9, sfx: 1, music: 0.6 };
  private muted = false;
  private worldPaused = false;
  private baseUrl: string | null = null;

  private listener: THREE.Object3D | null = null;
  private ears: THREE.Object3D | null = null;
  private hasListener = false;
  private lPos = new THREE.Vector3();
  private lRight = new THREE.Vector3(1, 0, 0);
  private lFwd = new THREE.Vector3(0, 0, -1);
  private earPos = new THREE.Vector3();

  private music = new Map<MusicTrack, MusicPlayer>();
  private currentTrack: MusicTrack | null = null;
  private wantedTrack: MusicTrack | null = null;
  private wantedFade = 2;
  /** Playlist index a theme's player starts at when it's created (musicSelect before unlock). */
  private startIdx = new Map<MusicTrack, number>();
  private hiddenPaused: MusicPlayer[] = [];

  // ------------------------------------------------------------------------------ lifecycle

  /**
   * Call from a user gesture (click / key / touch). Creates or resumes the AudioContext, starts
   * loading, and starts any music requested earlier. Safe to call on every gesture.
   */
  async unlock(): Promise<void> {
    try {
      if (!this.createContext()) return;
      const ctx = this.ctx!;
      if (ctx.state === 'suspended' && !(typeof document !== 'undefined' && document.hidden)) {
        await Promise.race([ctx.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
      }
      this.silentTick();
      void this.load();
      if (this.wantedTrack) this.playMusic(this.wantedTrack, Math.min(this.wantedFade, 1.5));
      else for (const p of this.music.values()) if (p.want && p.el.paused) this.playElement(p);
    } catch (e) {
      this.warnOnce('unlock', '[audio] unlock failed; running silent', e);
    }
  }

  /** True once the AudioContext is running (a user gesture happened). */
  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /**
   * Preloads every sound in the bank: fetches + decodes CC0 files and renders the synth recipes
   * (in a Web Worker when possible). Works before unlock(). Idempotent; resolves when done
   * (individual failures are skipped). Optional progress callback.
   */
  load(onProgress?: (done: number, total: number) => void): Promise<void> {
    try {
      if (onProgress) this.progressCbs.push(onProgress);
      if (!this.loadPromise) this.loadPromise = this.loadAll().catch((e) => this.warnOnce('load', '[audio] loading failed', e));
      return this.loadPromise;
    } catch (e) {
      this.warnOnce('load', '[audio] loading failed', e);
      return Promise.resolve();
    }
  }

  /** Is at least one variation of `key` ready to play? */
  isReady(key: string): boolean {
    return (this.variants.get(key)?.length ?? 0) > 0;
  }

  /** Decoded/synthesized buffers of a key (for tools / the test page). */
  getBuffers(key: string): AudioBuffer[] {
    return (this.variants.get(key) ?? []).map((v) => v.buffer);
  }

  /** Override where assets/audio/ lives (default: Vite BASE_URL). */
  setBaseUrl(url: string) {
    this.baseUrl = url.endsWith('/') ? url : url + '/';
  }

  /**
   * The camera (or any Object3D) whose orientation pans positional sounds. Optionally a second
   * object (e.g. the player) that distance attenuation is measured from; defaults to `obj`.
   */
  setListener(obj: THREE.Object3D | null, distanceFrom?: THREE.Object3D | null): void {
    this.listener = obj;
    this.ears = distanceFrom ?? null;
    this.syncListener();
  }

  /** Call every frame: syncs the listener, moves positional loops, starts deferred loops, music housekeeping. */
  update(dt: number): void {
    try {
      this.syncListener();
      const ctx = this.ctx;
      const t = ctx ? ctx.currentTime : 0;
      for (let i = this.voices.length - 1; i >= 0; i--) {
        const v = this.voices[i];
        if (!v) continue;
        try {
          if (v.state === 'waiting') this.tryStart(v);
          else if (v.state === 'playing') {
            if (v.pos && v.dynamic) this._applyGain(v, false);
            if (!v.loop && ctx && t > v.endAt + 0.5) this.release(v); // lost onended safety net
          } else if (v.state === 'stopping') {
            if (ctx && t > v.stopAt + 0.5) this.release(v);
          } else this.release(v);
        } catch (e) {
          this.warnOnce('voice:' + v.key, `[audio] voice "${v.key}" failed; dropping it`, e);
          this.release(v);
        }
      }
      this.updateMusic();
    } catch (e) {
      this.warnOnce('update', '[audio] update failed', e);
    }
    void dt;
  }

  // ------------------------------------------------------------------------------ playback

  /**
   * Plays a sound key. Returns a handle (stop/setVolume/setPitch/setPosition) or null if it
   * can't/shouldn't play right now (not unlocked, not loaded yet, rate-limited, too far away).
   * Unknown keys warn once. Loops are returned even before loading finishes and start when ready.
   */
  play(key: string, opts: SoundOpts = {}): SoundHandle | null {
    try {
      return this.playInternal(key, opts, 0);
    } catch (e) {
      this.warnOnce('play:' + key, `[audio] play("${key}") failed`, e);
      return null;
    }
  }

  /** Stops every sound effect (not music). */
  stopAll(fadeSec = 0.1): void {
    for (const v of [...this.voices]) v.stop(fadeSec);
  }

  /** Mute/unmute world sounds (e.g. while the game is paused). UI sounds and music continue. */
  setWorldPaused(paused: boolean): void {
    if (paused === this.worldPaused) return;
    this.worldPaused = paused;
    this.ramp(this.worldBus, paused ? 0 : 1, 0.08);
  }

  setVolumes(v: Partial<AudioVolumes>): void {
    try {
      for (const k of ['master', 'sfx', 'music'] as const) {
        const x = v[k];
        if (typeof x === 'number' && Number.isFinite(x)) this.volumes[k] = clamp(x, 0, 1);
      }
      this.applyVolumes();
    } catch (e) {
      this.warnOnce('volumes', '[audio] setVolumes failed', e);
    }
  }

  getVolumes(): AudioVolumes {
    return { ...this.volumes };
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  // ------------------------------------------------------------------------------ music

  /** Crossfades to a music theme (no-op if it's already playing). Remembered until unlocked. */
  playMusic(track: MusicTrack, fadeSec = 2): void {
    try {
      if (!MUSIC_BANK[track]) {
        this.warnOnce('music:' + track, `[audio] unknown music track "${track}"`);
        return;
      }
      this.wantedTrack = track;
      this.wantedFade = fadeSec;
      const ctx = this.ctx;
      if (!ctx || !this.musicBus) return; // starts on unlock()
      const cur = this.music.get(track);
      if (this.currentTrack === track && cur && !cur.stopping && !cur.dead) {
        if (cur.el.paused && ctx.state === 'running') this.playElement(cur);
        return;
      }
      for (const p of this.music.values()) if (p.track !== track && (p.want || p.stopping)) this.fadeOutPlayer(p, fadeSec);
      const p = cur ?? this.createPlayer(track);
      this.currentTrack = track;
      if (!p || p.dead) return;
      p.stopping = false;
      p.want = true;
      const t = ctx.currentTime;
      const g = p.fade.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(MUSIC_BANK[track].volume, t + Math.max(0.05, fadeSec));
      this.playElement(p);
    } catch (e) {
      this.warnOnce('playMusic', '[audio] playMusic failed', e);
    }
  }

  /** Fades out whatever music is playing. */
  stopMusic(fadeSec = 1.5): void {
    try {
      this.wantedTrack = null;
      this.currentTrack = null;
      for (const p of this.music.values()) if (p.want || p.stopping) this.fadeOutPlayer(p, fadeSec);
    } catch (e) {
      this.warnOnce('stopMusic', '[audio] stopMusic failed', e);
    }
  }

  /** The music theme currently playing / requested. */
  get musicTrack(): MusicTrack | null {
    return this.wantedTrack;
  }

  /**
   * Playlist state of a theme (the title-screen music player reads this every frame).
   * `wanted`: requested (plays as soon as audio is unlocked); `playing`: audibly playing right now.
   */
  musicInfo(track: MusicTrack) {
    const def = MUSIC_BANK[track];
    const p = this.music.get(track);
    const index = p ? p.idx : (this.startIdx.get(track) ?? 0);
    const wanted = this.wantedTrack === track;
    return {
      index,
      count: def?.files.length ?? 0,
      file: def?.files[index] ?? null,
      wanted,
      playing: wanted && !!p && p.want && !p.dead && !p.el.paused && this.unlocked,
      time: p ? p.el.currentTime || 0 : 0,
      duration: p && Number.isFinite(p.el.duration) ? p.el.duration : 0,
    };
  }

  /**
   * Jump a theme's playlist to file `index` (wraps). Restarts that file if it's the current one. Keeps playing
   * if the theme is playing; otherwise just cues it (also works before the player exists / audio is unlocked).
   */
  musicSelect(track: MusicTrack, index: number): void {
    try {
      const def = MUSIC_BANK[track];
      if (!def || !def.files.length) return;
      const n = def.files.length;
      const idx = ((Math.round(index) % n) + n) % n;
      this.startIdx.set(track, idx);
      const p = this.music.get(track);
      if (!p || p.dead) return;
      p.failed.delete(idx);
      this.setMusicFile(p, idx);
      if (p.want && !p.stopping && this.unlocked) this.playElement(p);
    } catch (e) {
      this.warnOnce('musicSelect', '[audio] musicSelect failed', e);
    }
  }

  /** Temporarily lowers the music to `gain` (0..1) for `sec` seconds (jingles, explosions). */
  duckMusic(gain: number, sec: number): void {
    const ctx = this.ctx;
    const d = this.duckGain;
    if (!ctx || !d) return;
    try {
      const t = ctx.currentTime;
      d.gain.cancelScheduledValues(t);
      d.gain.setTargetAtTime(clamp(gain, 0, 1), t, 0.05);
      d.gain.setTargetAtTime(1, t + Math.max(0.1, sec), 0.45);
    } catch {
      /* ignore */
    }
  }

  /** Number of sounds currently playing (optionally of one key; fading-out voices excluded). */
  activeCount(key?: string): number {
    let n = 0;
    for (const v of this.voices) if (v.state === 'playing' && (!key || v.key === key)) n++;
    return n;
  }

  /** Debug: state of each music player (<audio> element). */
  musicDebug() {
    return [...this.music.values()].map((p) => ({
      track: p.track,
      file: MUSIC_BANK[p.track].files[p.idx]?.file,
      want: p.want,
      paused: p.el.paused,
      time: +p.el.currentTime.toFixed(2),
      readyState: p.el.readyState,
      error: p.el.error?.code ?? null,
      fade: +p.fade.gain.value.toFixed(3),
      dead: p.dead,
    }));
  }

  /** Debug snapshot. */
  stats() {
    return {
      ctx: this.ctx?.state ?? 'none',
      voices: this.voices.filter((v) => v.state === 'playing' || v.state === 'stopping').length,
      waiting: this.voices.filter((v) => v.state === 'waiting').length,
      readyKeys: this.keys.filter((k) => this.isReady(k)).length,
      totalKeys: this.keys.length,
      progress: `${this.progress.done}/${this.progress.total}`,
      music: this.wantedTrack,
      worker: this.worker ? 'yes' : this.workerBroken ? 'fallback (main thread)' : 'not started',
    };
  }

  // ============================================================================== internals

  private playInternal(key: string, opts: SoundOpts, depth: number): Voice | null {
    const def = SOUND_BANK[key];
    if (!def) {
      this.warnOnce('unknown:' + key, `[audio] unknown sound key "${key}" (see src/audio/SOUNDS.md)`);
      return null;
    }
    const loop = opts.loop ?? def.loop ?? false;
    const ctx = this.ctx;
    if (!loop && (!ctx || ctx.state === 'closed')) return null;
    const delay = Math.max(0, finite(opts.delay, 0));
    const at = nowSec() + delay; // when it will actually sound
    if (!loop && Math.abs(at - (this.lastPlay.get(key) ?? -1e9)) < (def.minGap ?? DEFAULT_GAP)) return null;
    const position = def.ui ? undefined : toVec(opts.position);
    if (position && !loop && this.hasListener && position.distanceTo(this.earPos) > (def.maxDist ?? DEFAULT_MAXDIST)) return null;
    const ready = this.isReady(key);
    if (!ready) {
      this.prioritize(key);
      if (!this.loadPromise && typeof window !== 'undefined') void this.load();
      if (!loop) return null;
    }
    this.lastPlay.set(key, at);

    // per-key cap: cut the oldest (voices are in start order)
    const max = def.max ?? DEFAULT_MAX;
    const live = this.voices.filter((v) => v.key === key && v.playing);
    for (let i = 0; i <= live.length - max; i++) this._stopVoice(live[i], 0.03);
    // global cap: cut the oldest one-shot
    if (this.voices.length >= MAX_VOICES) {
      const victim = this.voices.find((v) => !v.loop && v.playing);
      if (victim) this._stopVoice(victim, 0.03);
    }

    const voice = new Voice(this, key, def, loop);
    voice.user = Math.max(0, finite(opts.volume, 1));
    voice.rate = clamp(finite(opts.pitch, 1), 0.05, 8);
    voice.pitchVar = clamp(finite(opts.pitchVar, def.pitchVar ?? DEFAULT_PITCHVAR), 0, 0.9);
    voice.delay = delay;
    if (position) voice.pos = position;
    this.voices.push(voice);
    if (ready) this.tryStart(voice);

    if (def.layers && depth < 2) {
      for (const L of def.layers) {
        const h = this.playInternal(L.key, { ...opts, loop: false, volume: voice.user * (L.volume ?? 1), delay: voice.delay + (L.delay ?? 0) }, depth + 1);
        if (h) voice.children.push({ h, vol: L.volume ?? 1 });
      }
    }
    if (def.duck != null && voice.state === 'playing') {
      const dur = voice.endAt === Infinity ? 2 : voice.endAt - (ctx?.currentTime ?? 0);
      this.duckMusic(def.duck, dur);
    }
    return voice;
  }

  private tryStart(voice: Voice): void {
    const ctx = this.ctx;
    const vars = this.variants.get(voice.key);
    if (!ctx || ctx.state === 'closed' || !vars || vars.length === 0 || !this.worldBus || !this.uiBus) return;
    const idx = this.pickVariant(voice.key, vars.length);
    const variant = vars[idx];
    const def = voice.def;
    const src = ctx.createBufferSource();
    src.buffer = variant.buffer;
    src.loop = voice.loop;
    voice.pitchMul = (def.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * voice.pitchVar);
    const rate = clamp(voice.pitchMul * voice.rate, 0.05, 8);
    src.playbackRate.value = rate;
    const out = ctx.createGain();
    out.gain.value = 0;
    src.connect(out);
    let tail: AudioNode = out;
    if (voice.pos || voice.dynamic) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 20000;
      lp.Q.value = 0.5;
      tail.connect(lp);
      tail = lp;
      voice.lp = lp;
      if (typeof ctx.createStereoPanner === 'function') {
        const pan = ctx.createStereoPanner();
        tail.connect(pan);
        tail = pan;
        voice.pan = pan;
      }
    }
    tail.connect(def.ui ? this.uiBus : this.worldBus);
    voice.src = src;
    voice.out = out;
    voice.base = (def.volume ?? 1) * variant.gain;
    voice.state = 'playing';
    this._applyGain(voice, true);
    const when = ctx.currentTime + voice.delay;
    const offset = voice.loop ? Math.random() * variant.buffer.duration : 0;
    src.start(when, offset);
    this.playCounts.set(voice.key, (this.playCounts.get(voice.key) ?? 0) + 1);
    voice.endAt = voice.loop ? Infinity : when + variant.buffer.duration / rate;
    if (!voice.loop && variant.buffer.duration / rate > 1.2) voice.dynamic = true;
    src.onended = () => this.release(voice);
  }

  private pickVariant(key: string, n: number): number {
    if (n <= 1) return 0;
    const last = this.lastVariant.get(key) ?? -1;
    let i = Math.floor(Math.random() * n);
    if (i === last) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.lastVariant.set(key, i);
    return i;
  }

  /** @internal */
  _applyGain(voice: Voice, immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !voice.out || voice.state !== 'playing') return; // stopping voices keep their fade-out
    let g = voice.base * voice.user;
    const t = ctx.currentTime;
    if (voice.pos && this.hasListener) {
      const def = voice.def;
      const ref = def.ref ?? DEFAULT_REF;
      const maxD = def.maxDist ?? DEFAULT_MAXDIST;
      const d = voice.pos.distanceTo(this.earPos);
      let a = ref / (ref + Math.max(0, d - ref));
      a *= 1 - smoothstep(maxD * 0.7, maxD, d);
      _v.subVectors(voice.pos, this.lPos);
      const x = _v.dot(this.lRight);
      const z = _v.dot(this.lFwd);
      const h = Math.sqrt(x * x + z * z);
      const pan = h > 1e-3 ? (x / h) * Math.min(1, h / 2) * 0.85 : 0;
      let cutoff = 18000 * Math.pow(1 - 0.8 * clamp(d / maxD, 0, 1), 1.5) + 800;
      if (z < -1) {
        a *= 0.85;
        cutoff *= 0.75;
      }
      g *= a;
      if (immediate) {
        if (voice.pan) voice.pan.pan.value = pan;
        if (voice.lp) voice.lp.frequency.value = cutoff;
      } else {
        voice.pan?.pan.setTargetAtTime(pan, t, 0.05);
        voice.lp?.frequency.setTargetAtTime(cutoff, t, 0.05);
      }
    } else if (!immediate) {
      voice.pan?.pan.setTargetAtTime(0, t, 0.05);
      voice.lp?.frequency.setTargetAtTime(20000, t, 0.05);
    }
    if (!Number.isFinite(g)) g = 0;
    if (immediate) voice.out.gain.value = g;
    else voice.out.gain.setTargetAtTime(g, t, 0.04);
  }

  /** @internal */
  _stopVoice(voice: Voice, fade: number): void {
    if (voice.state === 'done' || voice.state === 'stopping') return;
    const ctx = this.ctx;
    if (voice.state !== 'playing' || !ctx || !voice.src || !voice.out) {
      this.release(voice);
      return;
    }
    voice.state = 'stopping';
    const t = ctx.currentTime;
    const f = Math.max(0.005, fade);
    voice.stopAt = t + f;
    try {
      const g = voice.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + f);
      voice.src.stop(t + f + 0.01);
    } catch {
      this.release(voice);
    }
  }

  private release(voice: Voice): void {
    voice.state = 'done';
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
    try {
      if (voice.src) voice.src.onended = null;
      voice.src?.disconnect();
      voice.out?.disconnect();
      voice.lp?.disconnect();
      voice.pan?.disconnect();
    } catch {
      /* ignore */
    }
    voice.src = null;
  }

  private syncListener(): void {
    const l = this.listener;
    if (!l) {
      this.hasListener = false;
      return;
    }
    l.getWorldPosition(this.lPos);
    l.getWorldQuaternion(_q);
    this.lRight.set(1, 0, 0).applyQuaternion(_q);
    this.lFwd.set(0, 0, -1).applyQuaternion(_q);
    if (this.ears) this.ears.getWorldPosition(this.earPos);
    else this.earPos.copy(this.lPos);
    this.hasListener = true;
  }

  // ------------------------------------------------------------------------------ context & buses

  private createContext(): boolean {
    if (this.ctx) return this.ctx.state !== 'closed';
    if (typeof window === 'undefined') return false;
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      this.warnOnce('noaudio', '[audio] WebAudio not supported; running silent');
      return false;
    }
    const ctx = new AC({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    const sfx = ctx.createGain();
    const world = ctx.createGain();
    const ui = ctx.createGain();
    const music = ctx.createGain();
    const duck = ctx.createGain();
    world.connect(sfx);
    ui.connect(sfx);
    sfx.connect(master);
    music.connect(duck);
    duck.connect(master);
    this.ctx = ctx;
    this.master = master;
    this.sfxBus = sfx;
    this.worldBus = world;
    this.uiBus = ui;
    this.musicBus = music;
    this.duckGain = duck;
    world.gain.value = this.worldPaused ? 0 : 1;
    this.applyVolumes(true);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    return true;
  }

  private onVisibility = () => {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (document.hidden) {
        this.hiddenPaused = [];
        for (const p of this.music.values()) {
          if (!p.el.paused) {
            p.el.pause();
            this.hiddenPaused.push(p);
          }
        }
        void ctx.suspend().catch(() => undefined);
      } else {
        void ctx.resume().catch(() => undefined);
        for (const p of this.hiddenPaused) if (p.want) this.playElement(p);
        this.hiddenPaused = [];
      }
    } catch {
      /* ignore */
    }
  };

  private silentTick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start();
    } catch {
      /* ignore */
    }
  }

  private applyVolumes(immediate = false): void {
    this.ramp(this.master, this.muted ? 0 : this.volumes.master, immediate ? 0 : 0.03);
    this.ramp(this.sfxBus, this.volumes.sfx, immediate ? 0 : 0.03);
    this.ramp(this.musicBus, this.volumes.music, immediate ? 0 : 0.03);
  }

  private ramp(node: GainNode | null, value: number, tau: number): void {
    const ctx = this.ctx;
    if (!node || !ctx) return;
    try {
      if (tau <= 0) node.gain.value = value;
      else {
        node.gain.cancelScheduledValues(ctx.currentTime);
        node.gain.setTargetAtTime(value, ctx.currentTime, tau);
      }
    } catch {
      /* ignore */
    }
  }

  private url(rel: string): string {
    let base = this.baseUrl;
    if (base == null) {
      const b = import.meta.env?.BASE_URL;
      base = typeof b === 'string' && b ? b : './';
      if (!base.endsWith('/')) base += '/';
    }
    return `${base}assets/audio/${rel}`;
  }

  // ------------------------------------------------------------------------------ music internals

  private createPlayer(track: MusicTrack): MusicPlayer | null {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || typeof Audio === 'undefined') return null;
    const def = MUSIC_BANK[track];
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    el.loop = def.files.length === 1;
    const trim = ctx.createGain();
    const fade = ctx.createGain();
    fade.gain.value = 0;
    const p: MusicPlayer = { track, el, trim, fade, idx: 0, failed: new Set(), stopping: false, stopAt: 0, want: false, dead: false };
    try {
      const node = ctx.createMediaElementSource(el);
      node.connect(trim);
      trim.connect(fade);
      fade.connect(this.musicBus);
    } catch (e) {
      this.warnOnce('mediaelement', '[audio] MediaElementSource unavailable; music disabled', e);
      p.dead = true;
    }
    el.addEventListener('ended', () => this.advancePlaylist(p));
    el.addEventListener('error', () => {
      p.failed.add(p.idx);
      if (p.failed.size >= def.files.length) {
        p.dead = true;
        this.warnOnce('musicfail:' + track, `[audio] music "${track}" failed to load; skipping`);
      } else this.advancePlaylist(p);
    });
    this.setMusicFile(p, Math.min(def.files.length - 1, this.startIdx.get(track) ?? 0));
    this.music.set(track, p);
    return p;
  }

  private setMusicFile(p: MusicPlayer, idx: number): void {
    const def = MUSIC_BANK[p.track];
    p.idx = idx;
    const f = def.files[idx];
    p.trim.gain.value = f.gain;
    p.el.loop = def.files.length === 1;
    p.el.src = this.url('music/' + f.file);
  }

  private advancePlaylist(p: MusicPlayer): void {
    const n = MUSIC_BANK[p.track].files.length;
    if (p.dead) return;
    let next = p.idx;
    for (let k = 0; k < n; k++) {
      next = (next + 1) % n;
      if (!p.failed.has(next)) break;
    }
    this.setMusicFile(p, next);
    if (p.want && !p.stopping) this.playElement(p);
  }

  private playElement(p: MusicPlayer): void {
    if (p.dead) return;
    try {
      const pr = p.el.play();
      if (pr && typeof pr.catch === 'function') {
        pr.catch((err: unknown) => {
          const name = (err as { name?: string })?.name;
          if (name !== 'AbortError' && name !== 'NotAllowedError') this.warnOnce('musicplay', '[audio] music play() failed', err);
        });
      }
    } catch (e) {
      this.warnOnce('musicplay', '[audio] music play() failed', e);
    }
  }

  private fadeOutPlayer(p: MusicPlayer, sec: number): void {
    const ctx = this.ctx;
    p.want = false;
    if (!ctx) return;
    const t = ctx.currentTime;
    const g = p.fade.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + Math.max(0.05, sec));
    p.stopping = true;
    p.stopAt = t + Math.max(0.05, sec);
  }

  private updateMusic(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const p of this.music.values()) {
      if (p.stopping && ctx.currentTime >= p.stopAt) {
        p.stopping = false;
        try {
          p.el.pause();
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ------------------------------------------------------------------------------ loading

  private async loadAll(): Promise<void> {
    if (typeof window === 'undefined') return;
    const files: Job[] = [];
    const synths: Extract<Job, { kind: 'synth' }>[] = [];
    for (const [key, def] of Object.entries(SOUND_BANK)) {
      for (const f of def.files ?? []) files.push({ kind: 'file', key, file: f });
      if (def.synth) {
        const rec = RECIPES[def.synth];
        if (rec) for (let v = 0; v < rec.variants; v++) synths.push({ kind: 'synth', key, recipe: def.synth, variant: v });
        else this.warnOnce('recipe:' + def.synth, `[audio] missing synth recipe "${def.synth}"`);
      }
      if (def.process) def.process.files.forEach((f, i) => files.push({ kind: 'process', key, file: f, with: def.process!.with, seed: 0x5eed + i * 101 }));
    }
    this.progress.total = files.length + synths.length;
    this.synthQueue = synths;
    await Promise.all([this.runPool(files, 6), this.runSynth()]);
  }

  private bump(): void {
    this.progress.done++;
    for (const cb of this.progressCbs) {
      try {
        cb(this.progress.done, this.progress.total);
      } catch {
        /* ignore */
      }
    }
  }

  private async runPool(jobs: Job[], n: number): Promise<void> {
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const j = jobs[i++];
        try {
          await this.loadFile(j);
        } catch (e) {
          // one warning total (e.g. a browser without Ogg Vorbis would otherwise warn per file)
          this.warnOnce('file-load', `[audio] could not load some sound files (first: ${'file' in j ? j.file : j.key}); those variations are skipped`, e);
        }
        this.bump();
      }
    };
    await Promise.all(Array.from({ length: n }, worker));
  }

  private async loadFile(j: Job): Promise<void> {
    if (j.kind === 'synth') return;
    const res = await fetch(this.url('sfx/' + j.file));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const decoded = await this.decode(await res.arrayBuffer());
    if (j.kind === 'process') {
      const proc = PROCESSORS[j.with];
      if (!proc) throw new Error(`unknown processor ${j.with}`);
      const chans: Float32Array[] = [];
      for (let c = 0; c < decoded.numberOfChannels; c++) chans.push(decoded.getChannelData(c));
      const out = proc(chans, decoded.sampleRate, j.seed);
      this.addVariant(j.key, this.makeBuffer([out], decoded.sampleRate), false);
      return;
    }
    const def = SOUND_BANK[j.key];
    this.addVariant(j.key, def.stereo || decoded.numberOfChannels === 1 ? decoded : this.downmix(decoded), true);
  }

  private decode(ab: ArrayBuffer): Promise<AudioBuffer> {
    const c = this.ctx ?? this.getDecoder();
    if (!c) return Promise.reject(new Error('no audio context for decoding'));
    return new Promise<AudioBuffer>((resolve, reject) => {
      try {
        const p = c.decodeAudioData(ab, resolve, reject);
        if (p && typeof p.catch === 'function') p.catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  private getDecoder(): BaseAudioContext | null {
    if (this.decoder) return this.decoder;
    try {
      const OAC: typeof OfflineAudioContext | undefined =
        window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      if (!OAC) return null;
      this.decoder = new OAC(1, 1, 44100);
    } catch {
      this.decoder = null;
    }
    return this.decoder;
  }

  private makeBuffer(chans: Float32Array[], sr: number): AudioBuffer {
    const len = Math.max(1, chans[0]?.length ?? 1);
    let b: AudioBuffer;
    try {
      b = new AudioBuffer({ length: len, numberOfChannels: chans.length, sampleRate: sr });
    } catch {
      const c = this.ctx ?? this.getDecoder();
      if (!c) throw new Error('cannot create AudioBuffer');
      b = c.createBuffer(chans.length, len, sr);
    }
    chans.forEach((d, i) => b.getChannelData(i).set(d));
    return b;
  }

  private downmix(b: AudioBuffer): AudioBuffer {
    const n = b.length;
    const mono = new Float32Array(n);
    const k = 1 / b.numberOfChannels;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] * k;
    }
    return this.makeBuffer([mono], b.sampleRate);
  }

  private addVariant(key: string, buffer: AudioBuffer, fromFile: boolean): void {
    let list = this.variants.get(key);
    if (!list) this.variants.set(key, (list = []));
    list.push({ buffer, loud: fromFile ? loudness(buffer) : 0, gain: 1, fromFile });
    // Even out recorded variations so one quiet take doesn't stick out.
    const files = list.filter((v) => v.fromFile && v.loud > 1e-5);
    if (files.length > 1) {
      const sorted = files.map((v) => v.loud).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      for (const v of files) v.gain = clamp(median / v.loud, 0.4, 2.5);
    }
  }

  // ------------------------------------------------------------------------------ synth rendering

  private prioritize(key: string): void {
    if (!this.synthQueue.length) return;
    const mine = this.synthQueue.filter((j) => j.key === key);
    if (!mine.length) return;
    this.synthQueue = [...mine, ...this.synthQueue.filter((j) => j.key !== key)];
  }

  private async runSynth(): Promise<void> {
    const lanes = this.getWorker() ? 3 : 1;
    const lane = async () => {
      for (;;) {
        const j = this.synthQueue.shift();
        if (!j) return;
        try {
          const r = await this.renderSynth(j.recipe, j.variant);
          this.addVariant(j.key, this.makeBuffer(r.chans, r.sr), false);
        } catch (e) {
          this.warnOnce('synth:' + j.recipe, `[audio] synth "${j.recipe}" failed`, e);
        }
        this.bump();
      }
    };
    await Promise.all(Array.from({ length: lanes }, lane));
  }

  private getWorker(): Worker | null {
    if (this.worker || this.workerBroken) return this.worker;
    try {
      if (typeof Worker === 'undefined') throw new Error('no Worker');
      const w = new Worker(new URL('./synth/synthWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent) => {
        const m = e.data as { id: number; ok: boolean; chans?: Float32Array[]; sr?: number; error?: string };
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.ok && m.chans && m.sr) p.resolve({ chans: m.chans, sr: m.sr });
        else p.reject(new Error(m.error ?? 'worker render failed'));
      };
      w.onerror = (e) => {
        e.preventDefault?.();
        this.breakWorker();
      };
      this.worker = w;
    } catch {
      this.workerBroken = true;
    }
    return this.worker;
  }

  private breakWorker(): void {
    this.workerBroken = true;
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('worker unavailable'));
    }
    this.pending.clear();
  }

  private renderSynth(recipe: string, variant: number): Promise<{ chans: Float32Array[]; sr: number }> {
    const w = this.getWorker();
    if (!w) return this.renderMain(recipe, variant);
    return new Promise<{ chans: Float32Array[]; sr: number }>((resolve, reject) => {
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('worker timeout'));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      w.postMessage({ id, recipe, variant });
    }).catch(() => this.renderMain(recipe, variant));
  }

  private async renderMain(recipe: string, variant: number): Promise<{ chans: Float32Array[]; sr: number }> {
    await yieldToMain();
    const { data, sr } = renderRecipe(recipe, variant);
    return { chans: Array.isArray(data) ? data : [data], sr };
  }

  private warnOnce(id: string, msg: string, err?: unknown): void {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    if (err !== undefined) console.warn(msg, err);
    else console.warn(msg);
  }
}

/** The game-wide AudioManager instance. */
export const audio = new AudioManager();
