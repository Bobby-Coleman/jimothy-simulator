/**
 * AI-slop sounds: bitcrushed glitch sweeps, the "washed away / pixelated" dissolve, robotic
 * syllable babble, and slopify() which mangles real voice clips into glitchy AI-assistant speech.
 */
import {
  ahr,
  alloc,
  Biquad,
  concat,
  crush,
  decimate,
  hann,
  makeRng,
  mixInto,
  mtof,
  Osc,
  pick,
  ri,
  rr,
  TAU,
  varispeed,
  white,
  type Rng,
} from '../dsp';
import { finish, type Recipe } from '../recipe';
import { formantVoice, ringMod, VOWELS, type Vowel } from '../voice';

const SR = 44100;

/** Repeats short chunks of the buffer in place ("st-st-stutter"). */
function stutter(buf: Float32Array, sr: number, r: Rng, count: number, minMs: number, maxMs: number, from = 0, to = 1): Float32Array {
  for (let k = 0; k < count; k++) {
    const len = Math.floor(rr(r, minMs, maxMs) * 0.001 * sr);
    const start = Math.floor(rr(r, from, to) * (buf.length - len * 4));
    if (start < 0) continue;
    const reps = ri(r, 2, 4);
    const chunk = buf.slice(start, start + len);
    for (let q = 1; q < reps; q++) {
      const o = start + q * len;
      for (let i = 0; i < len && o + i < buf.length; i++) {
        const edge = Math.min(1, i / 32, (len - i) / 32);
        buf[o + i] = chunk[i] * edge + buf[o + i] * (1 - edge) * 0.2;
      }
    }
  }
  return buf;
}

/** Bitcrushed downward sweep with stutters and digital clicks. */
export const slop_glitch: Recipe = {
  variants: 5,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x6117 + v * 7717);
    const dur = rr(r, 0.45, 0.85);
    const out = alloc(sr, dur);
    const o1 = new Osc();
    const o2 = new Osc();
    const f1 = rr(r, 1200, 2400);
    const f2 = rr(r, 50, 90);
    const pwm = rr(r, 0.2, 0.5);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const u = t / dur;
      const f = f1 * Math.pow(f2 / f1, Math.pow(u, 0.8));
      out[i] = (o1.square(f, sr, pwm + 0.2 * Math.sin(TAU * 3 * t)) * 0.6 + o2.saw(f * 1.5, sr) * 0.4) * ahr(t, 0.004, dur - 0.06, 0.05);
    }
    const n = out.length;
    crush(out, (i) => 8 - 5 * (i / n));
    decimate(out, (i) => 1 + 11 * (i / n));
    stutter(out, sr, r, ri(r, 2, 4), 15, 40, 0.1, 0.8);
    for (let k = 0; k < ri(r, 3, 6); k++) {
      const p = Math.floor(rr(r, 0, n - 200));
      for (let i = 0; i < 60; i++) out[p + i] += (r() < 0.5 ? -1 : 1) * 0.7 * (1 - i / 60);
    }
    // random dropouts in the second half
    for (let k = 0; k < ri(r, 1, 3); k++) {
      const p = Math.floor(rr(r, 0.5, 0.9) * n);
      const len = Math.floor(rr(r, 0.005, 0.015) * sr);
      for (let i = 0; i < len && p + i < n; i++) out[p + i] *= 0.05;
    }
    return finish(out, sr, { target: -14 });
  },
};

/** A Slopothy washing away: uncanny detuned chord falls, pixelates, fizzes and drops out. */
export const dissolve: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xd155 + v * 331);
    const dur = rr(r, 1.2, 1.5);
    const out = alloc(sr, dur);
    const root = rr(r, 76, 84);
    const notes = [0, 4, 8, rr(r, 10, 11)].map((s) => mtof(root + s)); // augmented = uncanny
    const oscs = notes.map(() => new Osc(r()));
    const hp = new Biquad().hp(4500, 0.7, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const u = t / dur;
      const fall = Math.pow(2, -1.6 * u * u - 0.4 * u);
      let s = 0;
      for (let k = 0; k < oscs.length; k++) s += oscs[k].square(notes[k] * fall * (1 + 0.004 * k), sr, 0.3 + 0.1 * k) * 0.25;
      const fizzP = 0.004 + 0.02 * u;
      const fz = hp.process(r() < fizzP ? white(r) * 4 : white(r) * 0.05);
      out[i] = (s * (1 - 0.6 * u) + fz * (0.3 + 0.5 * u)) * ahr(t, 0.01, dur * 0.55, dur * 0.43);
    }
    const n = out.length;
    // granular dropouts, more as it goes
    const grain = Math.floor(0.012 * sr);
    for (let g = 0; g * grain < n; g++) {
      const u = (g * grain) / n;
      if (r() < u * 0.7) for (let i = g * grain; i < Math.min(n, (g + 1) * grain); i++) out[i] *= 0.08;
    }
    crush(out, (i) => 10 - 7 * (i / n));
    decimate(out, (i) => 1 + 18 * Math.pow(i / n, 1.5));
    // early digital sparkles
    for (let k = 0; k < 8; k++) {
      const t = rr(r, 0, dur * 0.5);
      const d = 0.012;
      const f = rr(r, 2000, 6000);
      const s = alloc(sr, d);
      const o = new Osc();
      for (let i = 0; i < s.length; i++) s[i] = o.square(f, sr) * hann(i / sr, d);
      mixInto(out, s, t * sr, 0.18);
    }
    return finish(out, sr, { target: -14 });
  },
};

const BABBLE_VOWELS: Vowel[] = ['a', 'e', 'i', 'o', 'oo', 'eh', 'ae', 'uh', 'er'];

/** Robotic "AI assistant" syllable babble: monotone formant voice, ring-mod, crushed, stuttered. */
export const slop_babble: Recipe = {
  variants: 4,
  sr: 32000,
  render(v, sr) {
    const r = makeRng(0xbab1 + v * 991);
    const n = ri(r, 5, 9);
    const f0 = rr(r, 105, 140);
    const parts: Float32Array[] = [];
    for (let k = 0; k < n; k++) {
      const d = rr(r, 0.09, 0.16);
      const vw = VOWELS[pick(r, BABBLE_VOWELS)];
      const step = pick(r, [0, 0, 0, 2, -2, 5, 7]);
      const syl = formantVoice(sr, {
        dur: d,
        f0: () => f0 * Math.pow(2, step / 12),
        amp: (t) => ahr(t, 0.012, d - 0.03, 0.018),
        formants: () => vw,
        aspiration: (t) => (t < 0.018 ? 1.2 : 0),
        scale: 1.05,
        breath: 0.03,
        vibDepth: 0,
        jitter: 0,
        shimmer: 0,
        tiltHz: 1200,
        seed: r() * 1e9,
      });
      // consonant burst
      const bp = new Biquad().bp(rr(r, 2000, 5000), 1.5, sr);
      for (let i = 0; i < Math.min(syl.length, 0.015 * sr); i++) syl[i] += bp.process(white(r)) * 0.25 * (1 - i / (0.015 * sr));
      parts.push(syl, new Float32Array(Math.floor(rr(r, 0.01, 0.04) * sr)));
    }
    let out = concat(parts);
    ringMod(out, sr, rr(r, 55, 85), 0.45);
    stutter(out, sr, r, 1, 50, 90, 0.2, 0.7);
    crush(out, 6);
    decimate(out, 2.5);
    out = concat([out, new Float32Array(Math.floor(0.05 * sr))]);
    return finish(out, sr, { target: -13 });
  },
};

/**
 * Mangles a decoded voice clip into glitchy "AI slop" speech: stutter, pitch warble, ring
 * modulation, bitcrush and sample-rate reduction. Used on Kenney voice-over lines at load time.
 */
export function slopify(channels: Float32Array[], sr: number, seed: number): Float32Array {
  const r = makeRng(seed);
  const n = channels[0]?.length ?? 0;
  let mono = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
  // trim silence
  let a = 0;
  let b = n - 1;
  while (a < n && Math.abs(mono[a]) < 0.01) a++;
  while (b > a && Math.abs(mono[b]) < 0.01) b--;
  mono = mono.slice(Math.max(0, a - Math.floor(0.01 * sr)), Math.min(n, b + Math.floor(0.05 * sr)));
  if (mono.length < 64) return mono;
  const base = rr(r, 0.82, 1.12);
  const wob = rr(r, 3, 6);
  const warped = varispeed(mono, (i) => base * (1 + 0.1 * Math.sin((TAU * wob * i) / sr) + (Math.floor((i / sr) * 8) % 3 === 0 ? 0.06 : 0)));
  const st = concat([warped, new Float32Array(Math.floor(0.15 * sr))]);
  stutter(st, sr, r, ri(r, 1, 2), 60, 90, 0.05, 0.45);
  ringMod(st, sr, rr(r, 50, 90), 0.4);
  crush(st, rr(r, 5, 6.5));
  decimate(st, rr(r, 2.5, 4));
  // glitchy tail: repeat the last 40 ms, decaying
  const len = Math.floor(0.04 * sr);
  const endAt = warped.length;
  if (endAt > len) {
    const chunk = st.slice(endAt - len, endAt);
    for (let q = 1; q <= 3; q++) mixInto(st, chunk, endAt - len + q * len, Math.pow(0.5, q));
  }
  return finish(st, sr, { target: -13 }) as Float32Array;
}
