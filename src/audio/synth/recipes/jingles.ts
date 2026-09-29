/**
 * Reward sounds: coin, score blip, combo arpeggio, and a triumphant brass fanfare.
 */
import {
  ahr,
  alloc,
  Biquad,
  drive,
  makeRng,
  mixInto,
  mtof,
  Osc,
  panInto,
  perc,
  reverb,
  rr,
  TAU,
  toMono,
  white,
  type Rng,
  type Stereo,
} from '../dsp';
import { finish, type Recipe } from '../recipe';
import { bell } from './cartoon';

const SR = 44100;

function blip(sr: number, f: number, dur: number, tau: number, shape: 'square' | 'tri' | 'sine', r: Rng): Float32Array {
  const out = alloc(sr, dur);
  const o = new Osc(r());
  const o2 = new Osc(r());
  const lp = new Biquad().lp(6000, 0.7, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const x = shape === 'square' ? o.square(f, sr, 0.5) * 0.5 : shape === 'tri' ? o.tri(f, sr) * 0.8 + o2.sine(f * 2, sr) * 0.15 : o.sine(f, sr);
    out[i] = lp.process(x) * perc(t, 0.002, tau);
  }
  return out;
}

/** Coin pickup: classic two-note "ba-ding", a triangle variant, and an FM "bling". */
export const coin: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xc014 + v);
    const out = alloc(sr, 0.6);
    if (v === 2) {
      mixInto(out, bell(sr, 1760, 0.5, r, { ratio: 2, index: 1.5, tau: 0.12 }), 0, 0.7);
      mixInto(out, bell(sr, 2637, 0.5, r, { ratio: 2, index: 1.2, tau: 0.14 }), 0.05 * sr, 0.6);
    } else {
      const shape = v === 0 ? 'square' : 'tri';
      mixInto(out, blip(sr, v === 0 ? 988 : 880, 0.08, 0.05, shape, r), 0);
      mixInto(out, blip(sr, 1319, 0.5, 0.12, shape, r), 0.07 * sr);
    }
    return finish(out, sr, { target: -15 });
  },
};

/** Soft bright score "plink" (fires a lot; pitch it up with combos). */
export const score: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x5c0e + v);
    const out = alloc(sr, 0.4);
    const root = 88; // E6
    const interval = [7, 5, 12][v];
    mixInto(out, blip(sr, mtof(root), 0.1, 0.035, 'tri', r), 0, 0.8);
    mixInto(out, blip(sr, mtof(root + interval), 0.3, 0.07, 'tri', r), 0.045 * sr, 1);
    return finish(out, sr, { target: -17 });
  },
};

/** Rising combo arpeggio with a shimmer. */
export const combo_up: Recipe = {
  variants: 2,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xc0b0 + v);
    const out: Stereo = [alloc(sr, 0.8), alloc(sr, 0.8)];
    const steps = v === 0 ? [0, 4, 7, 12] : [0, 5, 9, 12];
    const root = 84; // C6
    for (let k = 0; k < steps.length; k++) {
      const last = k === steps.length - 1;
      const s = blip(sr, mtof(root + steps[k]), last ? 0.5 : 0.12, last ? 0.14 : 0.04, 'square', r);
      panInto(out, s, k * 0.042 * sr, -0.3 + 0.2 * k, last ? 0.9 : 0.7);
    }
    const sh = bell(sr, mtof(root + 24), 0.5, r, { ratio: 3.5, index: 1, tau: 0.12 });
    panInto(out, sh, 3 * 0.042 * sr, 0.3, 0.25);
    const wet = reverb(toMono(out), sr, { size: 0.5, wet: 0.25, dry: 0, tailSec: 0.3 });
    for (let c = 0; c < 2; c++) mixInto(out[c], wet[c], 0);
    return finish(out, sr, { target: -15 });
  },
};

/** Brassy note: detuned saws with a filter "blat", scoop and late vibrato. */
function brass(sr: number, midi: number, dur: number, r: Rng, bright = 1): Float32Array {
  const f = mtof(midi);
  const out = alloc(sr, dur + 0.2);
  const a = new Osc(r());
  const b = new Osc(r());
  const c = new Osc(r());
  const lp = new Biquad();
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const scoop = 1 - 0.018 * Math.exp(-t / 0.035);
    const vib = t > 0.25 ? 0.006 * Math.min(1, (t - 0.25) / 0.3) * Math.sin(TAU * 5.5 * t) : 0;
    const fr = f * scoop * (1 + vib);
    const env = ahr(t, 0.02, Math.max(0.01, dur - 0.08), 0.15);
    const cutoff = (600 + 3400 * Math.exp(-t / 0.08) + 1200 * env) * bright;
    if ((i & 15) === 0) lp.lp(cutoff, 1.1, sr);
    const x = a.saw(fr * 1.0023, sr) + b.saw(fr * 0.9977, sr) + 0.3 * c.square(fr, sr, 0.5);
    out[i] = lp.process(x) * env * 0.35;
  }
  return out;
}

/** Triumphant "ta-da-da-DAAA" fanfare with timpani, cymbal and sparkles (objective complete). */
export const fanfare: Recipe = {
  variants: 2,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xfa4f + v * 5);
    const out: Stereo = [alloc(sr, 2.6), alloc(sr, 2.6)];
    // melody (time, midi, dur)
    const mel: [number, number, number][] =
      v === 0
        ? [
            [0, 67, 0.11],
            [0.13, 72, 0.11],
            [0.26, 76, 0.11],
            [0.39, 79, 1.35],
          ]
        : [
            [0, 72, 0.1],
            [0.12, 72, 0.1],
            [0.24, 72, 0.1],
            [0.37, 77, 1.35],
          ];
    const chord = v === 0 ? [48, 55, 60, 64, 67] : [53, 57, 60, 65, 69];
    const hit = mel[3][0];
    for (const [t, m, d] of mel) panInto(out, brass(sr, m, d, r, 1.1), t * sr, 0.1, 0.9);
    chord.forEach((m, i) => panInto(out, brass(sr, m, 1.3, r, 0.8), (hit + 0.005 * i) * sr, -0.6 + 0.3 * i, 0.45));
    // timpani
    const tp = alloc(sr, 0.8);
    const to = new Osc();
    const tn = new Biquad().lp(400, 0.7, sr);
    const tf = mtof(chord[0] - 12);
    for (let i = 0; i < tp.length; i++) {
      const t = i / sr;
      tp[i] = to.sine(tf * (1 + 0.05 * Math.exp(-t / 0.03)), sr) * perc(t, 0.003, 0.35) + tn.process(white(r)) * perc(t, 0.001, 0.03) * 0.8;
    }
    panInto(out, tp, hit * sr, 0, 0.9);
    // crash cymbal
    const cr = alloc(sr, 1.6);
    const hp = new Biquad().hp(4500, 0.7, sr);
    for (let i = 0; i < cr.length; i++) cr[i] = hp.process(white(r)) * perc(i / sr, 0.002, 0.45) * 0.35;
    panInto(out, cr, hit * sr, 0.35, 0.8);
    // sparkles
    for (let k = 0; k < 7; k++) {
      const b = bell(sr, mtof(91 + [0, 4, 7, 12, 16, 19, 24][k]), 0.4, r, { ratio: 3.5, index: 1, tau: 0.12 });
      panInto(out, b, (hit + 0.1 + k * 0.05) * sr, rr(r, -0.8, 0.8), 0.18);
    }
    const wet = reverb(toMono(out), sr, { size: 0.75, damp: 0.4, wet: 0.22, dry: 0, tailSec: 0.8 });
    const L = new Float32Array(Math.max(out[0].length, wet[0].length));
    const R = new Float32Array(L.length);
    L.set(out[0]);
    R.set(out[1]);
    mixInto(L, wet[0], 0);
    mixInto(R, wet[1], 0);
    drive(L, 1.2);
    drive(R, 1.2);
    return finish([L, R], sr, { target: -11 });
  },
};
