/**
 * Voice synthesis building blocks:
 *  - critter():      small-mammal / bird-ish tonal voice (raccoon chitters, trills, squeaks, gulls)
 *  - formantVoice(): Klatt-style cascade formant synthesizer (human "awww", cheers, cartoon screams)
 *  - VOWELS:         formant table (adult male reference values, Peterson & Barney-ish)
 */
import {
  alloc,
  Biquad,
  hann,
  makeRng,
  OnePole,
  Osc,
  pw,
  Reson,
  TAU,
  Wander,
  white,
} from './dsp';

// ---------------------------------------------------------------------------------------------
// Critter voice
// ---------------------------------------------------------------------------------------------

export interface CritterOpts {
  dur: number;
  /** Fundamental frequency (Hz) as a function of time (s). */
  f0: (t: number) => number;
  /** Amplitude envelope 0..1 as a function of time (s). */
  amp: (t: number) => number;
  /** Relative amplitudes of harmonics 1..N. */
  harm?: readonly number[];
  /** 0..1 amplitude-modulation roughness ("rasp"). */
  rasp?: number;
  /** Rasp modulation rate (Hz). */
  raspHz?: number;
  /** 0..1 amount of breathy noise. */
  breath?: number;
  /** Centre / Q of the breath noise band. */
  breathHz?: number;
  breathQ?: number;
  /** Random pitch wobble (fraction of f0). */
  jitter?: number;
  /** Peaking-EQ "formants": [freq, Q, gainDb]. */
  formants?: readonly (readonly [number, number, number])[];
  lowpass?: number;
  highpass?: number;
  seed: number;
}

export function critter(sr: number, o: CritterOpts): Float32Array {
  const r = makeRng(o.seed);
  const out = alloc(sr, o.dur);
  const osc = new Osc(r());
  const harm = o.harm ?? [1, 0.5, 0.28, 0.14, 0.07];
  const wob = new Wander(r);
  const raspW = new Wander(r);
  const raspOsc = new Osc(r());
  const breath = o.breath ?? 0;
  const rasp = o.rasp ?? 0;
  const raspHz = o.raspHz ?? 90;
  const jitter = o.jitter ?? 0.01;
  const nb = new Biquad().bp(o.breathHz ?? 4000, o.breathQ ?? 1.2, sr);
  const eqs = (o.formants ?? []).map(([f, q, g]) => new Biquad().peak(f, q, g, sr));
  const lp = o.lowpass ? new Biquad().lp(o.lowpass, 0.707, sr) : null;
  const hp = new Biquad().hp(o.highpass ?? 200, 0.707, sr);
  const tonal = 1 - breath * 0.6;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const a = o.amp(t);
    const f = o.f0(t) * (1 + jitter * wob.next(45, sr));
    let v = osc.harmonics(f, sr, harm) * tonal;
    if (rasp > 0) {
      // periodic buzz + a little randomness = scratchy vocal roughness
      const m = 0.5 + 0.5 * raspOsc.sine(raspHz * (1 + 0.2 * raspW.next(20, sr)), sr);
      v *= 1 - rasp * m;
    }
    const n = breath > 0 ? nb.process(white(r)) * breath * 2.2 : 0;
    let s = (v + n) * a;
    for (let k = 0; k < eqs.length; k++) s = eqs[k].process(s);
    if (lp) s = lp.process(s);
    out[i] = hp.process(s);
  }
  return out;
}

/** A single short chirp with an up-down pitch arc; building block for chitters and happy chirps. */
export function chirp(
  sr: number,
  seed: number,
  o: { dur: number; fStart: number; fPeak: number; fEnd: number; peakAt?: number; rasp?: number; breath?: number; harm?: readonly number[]; formantHz?: number },
): Float32Array {
  const d = o.dur;
  const pk = o.peakAt ?? 0.35;
  const fStart = o.fStart;
  const fPeak = o.fPeak;
  const fEnd = o.fEnd;
  const f0 = (t: number) => {
    const u = t / d;
    if (u < pk) return fStart * Math.pow(fPeak / fStart, u / pk);
    return fPeak * Math.pow(fEnd / fPeak, Math.min(1, (u - pk) / (1 - pk)));
  };
  return critter(sr, {
    dur: d + 0.004,
    f0,
    amp: (t) => Math.pow(hann(t, d), 0.6),
    harm: o.harm ?? [1, 0.5, 0.26, 0.12, 0.05],
    rasp: o.rasp ?? 0.35,
    raspHz: 140,
    breath: o.breath ?? 0.18,
    breathHz: 4800,
    jitter: 0.015,
    formants: [[o.formantHz ?? 3200, 1.8, 4]],
    highpass: 400,
    seed,
  });
}

// ---------------------------------------------------------------------------------------------
// Formant (human-ish) voice
// ---------------------------------------------------------------------------------------------

export type Formants = readonly [number, number, number];

/** Adult-male reference formants F1-F3 (Hz). Scale by ~1.16 for women, ~1.3 for children. */
export const VOWELS = {
  a: [730, 1090, 2440], // f(a)ther
  aw: [570, 840, 2410], // l(aw) / "awww"
  o: [460, 820, 2600], // g(o)
  oo: [300, 870, 2240], // wh(o)'d
  u: [440, 1020, 2240], // h(oo)d
  e: [480, 2000, 2600], // h(ay)
  eh: [530, 1840, 2480], // h(ea)d
  i: [270, 2290, 3010], // h(ee)d
  ih: [390, 1990, 2550], // h(i)d
  ae: [660, 1720, 2410], // h(a)d
  uh: [640, 1190, 2390], // h(u)d
  er: [490, 1350, 1690], // h(ear)d
  w: [300, 640, 2200], // glide
  y: [260, 2200, 3000], // glide
} as const satisfies Record<string, Formants>;

export type Vowel = keyof typeof VOWELS;

/** Formant trajectory through a list of [time, vowel] keyframes (linear interpolation). */
export function vowelPath(keys: readonly (readonly [number, Vowel])[]): (t: number) => Formants {
  const f1 = pw(keys.map(([t, v]) => [t, VOWELS[v][0]] as const));
  const f2 = pw(keys.map(([t, v]) => [t, VOWELS[v][1]] as const));
  const f3 = pw(keys.map(([t, v]) => [t, VOWELS[v][2]] as const));
  return (t: number) => [f1(t), f2(t), f3(t)];
}

export interface VoiceOpts {
  dur: number;
  f0: (t: number) => number;
  amp: (t: number) => number;
  formants: (t: number) => Formants;
  /** Formant scale: 1 = adult male, ~1.16 female, ~1.3 child. */
  scale?: number;
  /** Constant aspiration (breathiness) 0..1. */
  breath?: number;
  /** Extra time-varying aspiration (e.g. "h" onsets) 0..1. */
  aspiration?: (t: number) => number;
  vibRate?: number;
  vibDepth?: number;
  jitter?: number;
  shimmer?: number;
  /** Formant bandwidth multiplier (bigger = softer / more distant). */
  bw?: number;
  /** Source spectral tilt corner (Hz); lower = darker voice. */
  tiltHz?: number;
  seed: number;
}

export function formantVoice(sr: number, o: VoiceOpts): Float32Array {
  const r = makeRng(o.seed);
  const out = alloc(sr, o.dur);
  const osc = new Osc(r());
  const vibOsc = new Osc(r());
  const tilt = new OnePole().set(o.tiltHz ?? 700, sr);
  const R1 = new Reson();
  const R2 = new Reson();
  const R3 = new Reson();
  const R4 = new Reson();
  const jit = new Wander(r);
  const shim = new Wander(r);
  const sc = o.scale ?? 1;
  const bw = o.bw ?? 1;
  const breath = o.breath ?? 0.06;
  const jitter = o.jitter ?? 0.012;
  const shimmer = o.shimmer ?? 0.08;
  const vibRate = o.vibRate ?? 5;
  const vibDepth = o.vibDepth ?? 0.006;
  const noiseLp = new OnePole().set(6000, sr);
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if ((i & 31) === 0) {
      const f = o.formants(t);
      R1.set(f[0] * sc, 80 * bw, sr);
      R2.set(f[1] * sc, 100 * bw, sr);
      R3.set(f[2] * sc, 150 * bw, sr);
      R4.set(3400 * sc, 250 * bw, sr);
    }
    const a = o.amp(t);
    const f0 = o.f0(t) * (1 + vibDepth * vibOsc.sine(vibRate, sr) + jitter * jit.next(35, sr));
    // glottal-ish source: band-limited saw, tilted
    const g = tilt.lp(osc.saw(f0, sr)) * (1 + shimmer * shim.next(40, sr));
    const aspAmt = breath + (o.aspiration ? o.aspiration(t) : 0);
    const asp = aspAmt > 0 ? noiseLp.lp(white(r)) * aspAmt * 0.6 : 0;
    const x = (g * (1 - Math.min(0.9, aspAmt * 0.5)) + asp) * a;
    let y = R1.process(x);
    y = R2.process(y);
    y = R3.process(y);
    y = R4.process(y);
    out[i] = y - prev; // lip radiation (+6 dB/oct)
    prev = y;
  }
  return out;
}

/** Adds a simple ring modulation (robot voice) in place. mix 0..1. */
export function ringMod(buf: Float32Array, sr: number, hz: number, mix: number): Float32Array {
  const w = (TAU * hz) / sr;
  for (let i = 0; i < buf.length; i++) buf[i] *= 1 - mix + mix * Math.sin(w * i);
  return buf;
}
