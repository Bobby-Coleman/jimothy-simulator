/**
 * Tiny offline DSP toolkit used to synthesize Jimothy Simulator's sound effects.
 *
 * Everything renders into plain Float32Arrays (mono, or [L, R] pairs) so the exact same code runs
 * in the browser (turned into AudioBuffers by AudioManager) and in Node (tools/audio/check-synth.mjs).
 *
 * Rules for this folder: no imports from the rest of the game, no DOM/WebAudio APIs, and only
 * "erasable" TypeScript syntax (no enums / namespaces / parameter properties) so Node can run it
 * directly with type stripping.
 */

export const TAU = Math.PI * 2;

export type Mono = Float32Array;
export type Stereo = [Float32Array, Float32Array];
export type Rendered = Mono | Stereo;
export type Rng = () => number;

// ---------------------------------------------------------------------------------------------
// Random numbers (seeded, deterministic)
// ---------------------------------------------------------------------------------------------

/** mulberry32 PRNG: fast, deterministic, good enough for audio. */
export function makeRng(seed: number): Rng {
  let a = (seed * 2654435761) >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [a, b). */
export const rr = (r: Rng, a: number, b: number): number => a + (b - a) * r();
/** Uniform int in [a, b] (inclusive). */
export const ri = (r: Rng, a: number, b: number): number => Math.min(b, Math.floor(a + (b - a + 1) * r()));
export const pick = <T>(r: Rng, arr: readonly T[]): T => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
export const chance = (r: Rng, p: number): boolean => r() < p;
/** Approximately normal (sum of 3 uniforms), mean 0, sd ~1. */
export const gauss = (r: Rng): number => (r() + r() + r() - 1.5) * 2;

// ---------------------------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------------------------

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(1e-12, g));
/** Exponential interpolation between two positive values. */
export const expLerp = (a: number, b: number, t: number): number => a * Math.pow(b / a, clamp(t, 0, 1));

export function alloc(sr: number, sec: number): Float32Array {
  return new Float32Array(Math.max(1, Math.ceil(sr * sec)));
}

// ---------------------------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------------------------

export type EnvPoint = readonly [number, number];

/** Piecewise-linear envelope from [time, value] points (sorted by time). Holds the end values. */
export function pw(points: readonly EnvPoint[]): (t: number) => number {
  const n = points.length;
  return (t: number) => {
    if (n === 0) return 0;
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < n; i++) {
      const p1 = points[i];
      if (t <= p1[0]) {
        const p0 = points[i - 1];
        const span = p1[0] - p0[0];
        return span <= 0 ? p1[1] : p0[1] + ((p1[1] - p0[1]) * (t - p0[0])) / span;
      }
    }
    return points[n - 1][1];
  };
}

/** Like pw() but interpolates exponentially (for frequencies). All values must be > 0. */
export function pwExp(points: readonly EnvPoint[]): (t: number) => number {
  const logPts = points.map(([t, v]) => [t, Math.log(Math.max(1e-6, v))] as const);
  const f = pw(logPts);
  return (t: number) => Math.exp(f(t));
}

/** Percussive envelope: linear attack, exponential decay (tau seconds). */
export function perc(t: number, attack: number, tau: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / tau);
}

/** Attack / hold / release envelope with raised-cosine edges. */
export function ahr(t: number, attack: number, hold: number, release: number): number {
  if (t < 0) return 0;
  if (t < attack) return 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
  if (t < attack + hold) return 1;
  const r = t - attack - hold;
  if (r < release) return 0.5 + 0.5 * Math.cos((Math.PI * r) / release);
  return 0;
}

/** Smooth bell over [0, dur] (Hann window). */
export function hann(t: number, dur: number): number {
  if (t <= 0 || t >= dur) return 0;
  return 0.5 - 0.5 * Math.cos((TAU * t) / dur);
}

// ---------------------------------------------------------------------------------------------
// Oscillators
// ---------------------------------------------------------------------------------------------

function blep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** Phase-accumulating oscillator; call one waveform method per sample with the current frequency. */
export class Osc {
  phase: number;
  constructor(phase = 0) {
    this.phase = phase;
  }
  private adv(f: number, sr: number) {
    this.phase += f / sr;
    if (this.phase >= 1 || this.phase < 0) this.phase -= Math.floor(this.phase);
  }
  sine(f: number, sr: number): number {
    const v = Math.sin(TAU * this.phase);
    this.adv(f, sr);
    return v;
  }
  /** Band-limited sawtooth (PolyBLEP). */
  saw(f: number, sr: number): number {
    const dt = Math.abs(f) / sr;
    const v = 2 * this.phase - 1 - blep(this.phase, dt);
    this.adv(f, sr);
    return v;
  }
  /** Band-limited pulse/square (PolyBLEP). */
  square(f: number, sr: number, width = 0.5): number {
    const dt = Math.abs(f) / sr;
    let v = this.phase < width ? 1 : -1;
    v += blep(this.phase, dt);
    let p2 = this.phase - width;
    if (p2 < 0) p2 += 1;
    v -= blep(p2, dt);
    this.adv(f, sr);
    return v;
  }
  /** Naive triangle (fine for the low/mid frequencies we use it at). */
  tri(f: number, sr: number): number {
    const v = 4 * Math.abs(this.phase - 0.5) - 1;
    this.adv(f, sr);
    return v;
  }
  /** Sum of harmonics with given amplitudes, skipping partials above ~0.45*sr. */
  harmonics(f: number, sr: number, amps: readonly number[]): number {
    const lim = 0.45 * sr;
    let v = 0;
    const base = TAU * this.phase;
    for (let k = 0; k < amps.length; k++) {
      const fk = f * (k + 1);
      if (fk >= lim) break;
      v += amps[k] * Math.sin(base * (k + 1));
    }
    this.adv(f, sr);
    return v;
  }
}

// ---------------------------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------------------------

export const white = (r: Rng): number => r() * 2 - 1;

/** Pink noise (Paul Kellet's refined filter). Feed it white noise. */
export class Pink {
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;
  next(w: number): number {
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const p = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return p * 0.11;
  }
}

/** Brown(ian) noise. Feed it white noise. */
export class Brown {
  private last = 0;
  next(w: number): number {
    this.last = (this.last + 0.02 * w) / 1.02;
    return this.last * 3.5;
  }
}

/** Smoothly varying random value (interpolated random steps at `rate` Hz), range [-1, 1]. */
export class Wander {
  private a: number;
  private b: number;
  private t = 0;
  private r: Rng;
  constructor(r: Rng) {
    this.r = r;
    this.a = r() * 2 - 1;
    this.b = r() * 2 - 1;
  }
  next(rate: number, sr: number): number {
    this.t += rate / sr;
    if (this.t >= 1) {
      this.t -= Math.floor(this.t);
      this.a = this.b;
      this.b = this.r() * 2 - 1;
    }
    const s = this.t * this.t * (3 - 2 * this.t);
    return this.a + (this.b - this.a) * s;
  }
}

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

/** RBJ-cookbook biquad, transposed direct form II. Coefficients can be updated per sample. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  private static w(f: number, sr: number): number {
    return (TAU * clamp(f, 5, sr * 0.49)) / sr;
  }
  lp(f: number, q: number, sr: number): this {
    const w = Biquad.w(f, sr);
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    this.b0 = (1 - cs) / 2 / a0;
    this.b1 = (1 - cs) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }
  hp(f: number, q: number, sr: number): this {
    const w = Biquad.w(f, sr);
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    this.b0 = (1 + cs) / 2 / a0;
    this.b1 = -(1 + cs) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }
  /** Band-pass with 0 dB peak gain. */
  bp(f: number, q: number, sr: number): this {
    const w = Biquad.w(f, sr);
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    this.b0 = al / a0;
    this.b1 = 0;
    this.b2 = -al / a0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - al) / a0;
    return this;
  }
  /** Peaking EQ. */
  peak(f: number, q: number, gainDb: number, sr: number): this {
    const w = Biquad.w(f, sr);
    const cs = Math.cos(w);
    const A = Math.pow(10, gainDb / 40);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al / A;
    this.b0 = (1 + al * A) / a0;
    this.b1 = (-2 * cs) / a0;
    this.b2 = (1 - al * A) / a0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - al / A) / a0;
    return this;
  }
  highShelf(f: number, gainDb: number, sr: number): this {
    const w = Biquad.w(f, sr);
    const cs = Math.cos(w);
    const A = Math.pow(10, gainDb / 40);
    const al = (Math.sin(w) / 2) * Math.SQRT2;
    const sq = 2 * Math.sqrt(A) * al;
    const a0 = A + 1 - (A - 1) * cs + sq;
    this.b0 = (A * (A + 1 + (A - 1) * cs + sq)) / a0;
    this.b1 = (-2 * A * (A - 1 + (A + 1) * cs)) / a0;
    this.b2 = (A * (A + 1 + (A - 1) * cs - sq)) / a0;
    this.a1 = (2 * (A - 1 - (A + 1) * cs)) / a0;
    this.a2 = (A + 1 - (A - 1) * cs - sq) / a0;
    return this;
  }
  lowShelf(f: number, gainDb: number, sr: number): this {
    const w = Biquad.w(f, sr);
    const cs = Math.cos(w);
    const A = Math.pow(10, gainDb / 40);
    const al = (Math.sin(w) / 2) * Math.SQRT2;
    const sq = 2 * Math.sqrt(A) * al;
    const a0 = A + 1 + (A - 1) * cs + sq;
    this.b0 = (A * (A + 1 - (A - 1) * cs + sq)) / a0;
    this.b1 = (2 * A * (A - 1 - (A + 1) * cs)) / a0;
    this.b2 = (A * (A + 1 - (A - 1) * cs - sq)) / a0;
    this.a1 = (-2 * (A - 1 + (A + 1) * cs)) / a0;
    this.a2 = (A + 1 + (A - 1) * cs - sq) / a0;
    return this;
  }
  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset(): this {
    this.z1 = this.z2 = 0;
    return this;
  }
}

/** One-pole low-pass (6 dB/oct). */
export class OnePole {
  private y = 0;
  private a = 1;
  set(f: number, sr: number): this {
    this.a = 1 - Math.exp((-TAU * clamp(f, 1, sr * 0.49)) / sr);
    return this;
  }
  lp(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
  hp(x: number): number {
    this.y += this.a * (x - this.y);
    return x - this.y;
  }
}

/** Klatt-style 2-pole resonator (unity gain at DC) used for formants. */
export class Reson {
  private a = 1;
  private b = 0;
  private c = 0;
  private y1 = 0;
  private y2 = 0;
  set(f: number, bw: number, sr: number): this {
    const T = 1 / sr;
    const ff = clamp(f, 20, sr * 0.47);
    this.c = -Math.exp(-TAU * bw * T);
    this.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(TAU * ff * T);
    this.a = 1 - this.b - this.c;
    return this;
  }
  process(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** DC blocker. */
export class DCBlock {
  private x1 = 0;
  private y1 = 0;
  process(x: number): number {
    const y = x - this.x1 + 0.995 * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }
}

// ---------------------------------------------------------------------------------------------
// Buffer utilities & effects
// ---------------------------------------------------------------------------------------------

/** Adds `src * gain` into `dst` starting at sample `offset` (clipped to dst length). */
export function mixInto(dst: Float32Array, src: Float32Array, offset: number, gain = 1): void {
  const o = Math.round(offset);
  const start = Math.max(0, -o);
  const end = Math.min(src.length, dst.length - o);
  for (let i = start; i < end; i++) dst[i + o] += src[i] * gain;
}

/** Adds src into dst at offset, wrapping around the end (for seamless loops). */
export function mixIntoWrapped(dst: Float32Array, src: Float32Array, offset: number, gain = 1): void {
  const n = dst.length;
  let j = ((Math.round(offset) % n) + n) % n;
  for (let i = 0; i < src.length; i++) {
    dst[j] += src[i] * gain;
    if (++j >= n) j = 0;
  }
}

export function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rmsOf(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
}

/** Loudest RMS over sliding windows (a crude "momentary loudness"). */
export function maxWindowRms(buf: Float32Array, sr: number, winSec = 0.05): number {
  const w = Math.max(1, Math.floor(sr * winSec));
  const hop = Math.max(1, Math.floor(w / 4));
  let best = 0;
  for (let i = 0; i < buf.length; i += hop) {
    const end = Math.min(buf.length, i + w);
    let s = 0;
    for (let j = i; j < end; j++) s += buf[j] * buf[j];
    const r = Math.sqrt(s / w);
    if (r > best) best = r;
    if (end === buf.length) break;
  }
  return best;
}

export function scale(buf: Float32Array, g: number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/**
 * Loudness-normalizes a sound: scales so its loudest 50 ms window hits `targetDb` (RMS dBFS),
 * but never lets the peak exceed `peakMax`. Works on mono or stereo (linked gain).
 */
export function normalize(out: Rendered, sr: number, targetDb = -13, peakMax = 0.9): Rendered {
  const chans = Array.isArray(out) ? out : [out];
  let loud = 0;
  let peak = 0;
  for (const c of chans) {
    loud = Math.max(loud, maxWindowRms(c, sr));
    peak = Math.max(peak, peakOf(c));
  }
  if (peak < 1e-9) return out;
  let g = dbToGain(targetDb) / Math.max(1e-9, loud);
  if (peak * g > peakMax) g = peakMax / peak;
  for (const c of chans) scale(c, g);
  return out;
}

/** Linear fade in/out at the edges (seconds). Prevents clicks. */
export function fadeEdges(buf: Float32Array, sr: number, inSec: number, outSec: number): Float32Array {
  const ni = Math.min(buf.length, Math.floor(inSec * sr));
  for (let i = 0; i < ni; i++) buf[i] *= i / ni;
  const no = Math.min(buf.length, Math.floor(outSec * sr));
  for (let i = 0; i < no; i++) buf[buf.length - 1 - i] *= i / no;
  return buf;
}

/** Soft saturation, normalized so that |x|=1 maps to 1. */
export function drive(buf: Float32Array, amount: number): Float32Array {
  const k = Math.max(0.01, amount);
  const n = Math.tanh(k);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(k * buf[i]) / n;
  return buf;
}

/** Quantize amplitude to `bits` (can vary over time via a function of the sample index). */
export function crush(buf: Float32Array, bits: number | ((i: number) => number)): Float32Array {
  for (let i = 0; i < buf.length; i++) {
    const b = typeof bits === 'number' ? bits : bits(i);
    const q = Math.pow(2, Math.max(1, b) - 1);
    buf[i] = Math.round(buf[i] * q) / q;
  }
  return buf;
}

/** Sample-and-hold decimation by a (possibly time-varying, fractional) factor >= 1. */
export function decimate(buf: Float32Array, factor: number | ((i: number) => number)): Float32Array {
  let acc = 0;
  let held = 0;
  for (let i = 0; i < buf.length; i++) {
    const f = typeof factor === 'number' ? factor : factor(i);
    acc += 1;
    if (acc >= f || i === 0) {
      acc -= Math.max(1, f);
      if (acc < 0) acc = 0;
      held = buf[i];
    }
    buf[i] = held;
  }
  return buf;
}

/** Trims trailing near-silence (keeps a short tail) to save memory. */
export function trimTail(buf: Float32Array, sr: number, thresh = 0.0008, keepSec = 0.02): Float32Array {
  let end = buf.length - 1;
  while (end > 0 && Math.abs(buf[end]) < thresh) end--;
  const n = Math.min(buf.length, end + 1 + Math.floor(keepSec * sr));
  if (n >= buf.length - 8) return buf;
  const out = buf.slice(0, n);
  fadeEdges(out, sr, 0, Math.min(keepSec, n / sr));
  return out;
}

/** Remove DC offset in place. */
export function dcBlock(buf: Float32Array): Float32Array {
  const d = new DCBlock();
  for (let i = 0; i < buf.length; i++) buf[i] = d.process(buf[i]);
  return buf;
}

/**
 * Compact Freeverb-style reverb. Mono in → stereo out (dry + wet).
 * size ~0.5..0.95 (decay), damp 0..1, wet 0..1, width 0..1.
 */
export function reverb(
  input: Float32Array,
  sr: number,
  opts: { size?: number; damp?: number; wet?: number; dry?: number; tailSec?: number; width?: number } = {},
): Stereo {
  const size = opts.size ?? 0.7;
  const damp = opts.damp ?? 0.4;
  const wet = opts.wet ?? 0.25;
  const dry = opts.dry ?? 1;
  const width = opts.width ?? 1;
  const tail = Math.floor((opts.tailSec ?? 0.8) * sr);
  const n = input.length + tail;
  const k = sr / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491];
  const apT = [556, 441, 341];
  const spread = 23;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  const run = (off: number, out: Float32Array) => {
    const combs = combT.map((d) => ({ buf: new Float32Array(Math.max(1, Math.floor((d + off) * k))), i: 0, store: 0 }));
    const aps = apT.map((d) => ({ buf: new Float32Array(Math.max(1, Math.floor((d + off) * k))), i: 0 }));
    const fb = 0.7 + 0.28 * clamp(size, 0, 1);
    for (let s = 0; s < n; s++) {
      const x = (s < input.length ? input[s] : 0) * 0.08;
      let acc = 0;
      for (const c of combs) {
        const y = c.buf[c.i];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.i] = x + c.store * fb;
        if (++c.i >= c.buf.length) c.i = 0;
        acc += y;
      }
      for (const a of aps) {
        const b = a.buf[a.i];
        const y = -acc + b;
        a.buf[a.i] = acc + b * 0.5;
        if (++a.i >= a.buf.length) a.i = 0;
        acc = y;
      }
      out[s] = acc;
    }
  };
  run(0, outL);
  run(spread, outR);
  const w1 = wet * (width / 2 + 0.5);
  const w2 = wet * ((1 - width) / 2);
  for (let s = 0; s < n; s++) {
    const d = s < input.length ? input[s] * dry : 0;
    const l = outL[s];
    const r = outR[s];
    outL[s] = d + l * w1 + r * w2;
    outR[s] = d + r * w1 + l * w2;
  }
  return [outL, outR];
}

/**
 * Makes a seamlessly looping buffer of `loopSec` from a renderer that produces at least
 * loopSec + xfadeSec of continuous sound: the overhang is equal-power crossfaded onto the start.
 */
export function seamlessLoop(rendered: Float32Array, sr: number, loopSec: number, xfadeSec: number): Float32Array {
  const L = Math.floor(loopSec * sr);
  const X = Math.min(Math.floor(xfadeSec * sr), rendered.length - L);
  const out = rendered.slice(0, L);
  for (let i = 0; i < X; i++) {
    const t = i / X;
    const a = Math.sin(t * Math.PI * 0.5); // fade in of the original start
    const b = Math.cos(t * Math.PI * 0.5); // fade out of the overhang
    out[i] = rendered[i] * a + rendered[L + i] * b;
  }
  return out;
}

/** Stereo helper: pans a mono buffer into an existing stereo pair (equal power, pan -1..1). */
export function panInto(dst: Stereo, src: Float32Array, offset: number, pan: number, gain = 1): void {
  const p = (clamp(pan, -1, 1) + 1) * 0.25 * Math.PI;
  mixInto(dst[0], src, offset, gain * Math.cos(p));
  mixInto(dst[1], src, offset, gain * Math.sin(p));
}

/** Converts a stereo pair to mono (average). */
export function toMono(x: Rendered): Float32Array {
  if (!Array.isArray(x)) return x;
  const [l, r] = x;
  const out = new Float32Array(Math.max(l.length, r.length));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * ((l[i] ?? 0) + (r[i] ?? 0));
  return out;
}

/** Concatenates mono buffers. */
export function concat(parts: Float32Array[]): Float32Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Resamples by a time-varying playback rate (linear interpolation). rate(i) at output sample i. */
export function varispeed(src: Float32Array, rate: (outIndex: number) => number, maxLen?: number): Float32Array {
  const cap = maxLen ?? src.length * 4;
  const out = new Float32Array(cap);
  let pos = 0;
  let i = 0;
  while (i < cap && pos < src.length - 1) {
    const j = Math.floor(pos);
    const f = pos - j;
    out[i] = src[j] * (1 - f) + src[j + 1] * f;
    pos += Math.max(0.05, rate(i));
    i++;
  }
  return out.slice(0, i);
}
