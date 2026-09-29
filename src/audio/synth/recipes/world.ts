/**
 * World sounds: car horn & engine, explosions, fireworks, Seattle crows & seagulls,
 * short-circuit sparks, SlopCorp server hum, the Wildlife Officer's whistle.
 */
import {
  ahr,
  alloc,
  Biquad,
  Brown,
  drive,
  hann,
  makeRng,
  mixInto,
  mixIntoWrapped,
  Osc,
  perc,
  Pink,
  pw,
  pwExp,
  reverb,
  ri,
  rr,
  seamlessLoop,
  TAU,
  toMono,
  Wander,
  white,
  type Rng,
} from '../dsp';
import { finish, finishLoop, type Recipe } from '../recipe';
import { critter } from '../voice';

const SR = 44100;

/** Car horn: detuned two-tone through a horn resonance. Variants: single, double beep, long angry. */
export const car_horn: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xca40 + v * 5);
    const out = alloc(sr, 1);
    const fa = rr(r, 400, 430);
    const fb = fa * 0.8; // ~major third below
    const beep = (t0: number, d: number) => {
      const s = alloc(sr, d + 0.05);
      const o1 = new Osc(r());
      const o2 = new Osc(r());
      const res = new Biquad().peak(1800, 1, 9, sr);
      const res2 = new Biquad().peak(3000, 2, 5, sr);
      const lp = new Biquad().lp(6000, 0.7, sr);
      for (let i = 0; i < s.length; i++) {
        const t = i / sr;
        const x = o1.saw(fa, sr) + o2.saw(fb, sr);
        s[i] = lp.process(res2.process(res.process(x))) * ahr(t, 0.008, d - 0.03, 0.03);
      }
      mixInto(out, drive(s, 2.5), t0 * sr);
    };
    if (v === 0) beep(0.003, 0.5);
    else if (v === 1) {
      beep(0.003, 0.16);
      beep(0.25, 0.16);
    } else beep(0.003, 0.85);
    return finish(out, sr, { target: -12 });
  },
};

/** Seamless 1 s engine loop at 36 Hz firing rate; vary playbackRate with speed. */
export const car_engine_loop: Recipe = {
  variants: 1,
  sr: 22050,
  loop: true,
  render(v, sr) {
    const r = makeRng(0xe791 + v);
    const L = 1;
    const X = 0.25;
    const N = Math.floor((L + X) * sr);
    const buf = new Float32Array(N);
    const F = 36; // integer Hz -> periodic within the loop
    const pulse = new Osc();
    const saw = new Osc();
    const lp = new Biquad().lp(380, 0.9, sr);
    const ex = new Biquad().lp(180, 2, sr);
    const brown = new Brown();
    const nlp = new Biquad().lp(300, 0.7, sr);
    for (let i = 0; i < N; i++) {
      const p = pulse.square(F, sr, 0.18);
      const s = saw.saw(F * 2, sr);
      const fire = 0.5 + 0.5 * Math.sin(TAU * F * (i / sr));
      const rumble = nlp.process(brown.next(white(r))) * (0.5 + 0.8 * fire);
      buf[i] = ex.process(lp.process(p * 0.8 + s * 0.3)) * 1.5 + rumble * 0.6;
    }
    return finishLoop(seamlessLoop(buf, sr, L, X), sr, -18);
  },
};

/** Punchy cartoon explosion (propane tank, small blasts). */
export const explosion_small: Recipe = {
  variants: 3,
  sr: 32000,
  render(v, sr) {
    const r = makeRng(0xe8b1 + v * 11);
    const dur = rr(r, 1.3, 1.7);
    const out = alloc(sr, dur);
    const sub = new Osc();
    const lp = new Biquad();
    const sweep = pwExp([
      [0, 4000],
      [dur * 0.7, 200],
      [dur, 150],
    ]);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      if ((i & 15) === 0) lp.lp(sweep(t), 0.8, sr);
      out[i] = sub.sine(35 + 55 * Math.exp(-t / 0.1), sr) * perc(t, 0.002, 0.25) * 1.2 + lp.process(white(r)) * perc(t, 0.003, 0.35) * 1.4;
    }
    const n = ri(r, 20, 40);
    const hp = new Biquad().hp(1500, 0.7, sr);
    for (let k = 0; k < n; k++) {
      const t = 0.08 + Math.pow(r(), 1.5) * (dur - 0.3);
      const d = rr(r, 0.001, 0.003);
      const s = alloc(sr, d * 4);
      for (let i = 0; i < s.length; i++) s[i] = hp.process(white(r)) * Math.exp(-i / sr / d);
      mixInto(out, s, t * sr, rr(r, 0.2, 0.6) * (1 - t / dur));
    }
    return finish(drive(out, 3), sr, { target: -10 });
  },
};

function crackle(sr: number, r: Rng, out: Float32Array, t0: number, t1: number, count: number, gain: number): void {
  const hp = new Biquad().hp(3000, 0.7, sr);
  for (let k = 0; k < count; k++) {
    const u = Math.pow(r(), 1.4);
    const t = t0 + u * (t1 - t0);
    const d = rr(r, 0.0005, 0.0015);
    const s = alloc(sr, d * 5);
    for (let i = 0; i < s.length; i++) s[i] = hp.process(white(r)) * Math.exp(-i / sr / d);
    mixInto(out, s, t * sr, gain * rr(r, 0.2, 1) * (1 - u * 0.7));
  }
}

/** Firework: rising whistle, boom, crackle tail (stereo, outdoor reverb). */
export const firework: Recipe = {
  variants: 3,
  sr: 32000,
  render(v, sr) {
    const r = makeRng(0xf1e0 + v * 13);
    const whistle = v !== 1;
    const boomAt = whistle ? rr(r, 0.9, 1.1) : 0.02;
    const dur = boomAt + 2;
    const out = alloc(sr, dur);
    if (whistle) {
      const o = new Osc();
      const nb = new Biquad();
      const fA = rr(r, 600, 800);
      const fB = rr(r, 2200, 2800);
      for (let i = 0; i < boomAt * sr; i++) {
        const t = i / sr;
        const f = fA * Math.pow(fB / fA, t / boomAt) * (1 + 0.01 * Math.sin(TAU * 9 * t));
        if ((i & 15) === 0) nb.bp(f, 6, sr);
        out[i] = (o.sine(f, sr) * 0.35 + nb.process(white(r)) * 0.8) * Math.pow(t / boomAt, 0.6) * 0.6;
      }
    }
    const sub = new Osc();
    const lp = new Biquad();
    const sweep = pwExp([
      [0, 3000],
      [0.8, 180],
      [2, 120],
    ]);
    const n0 = Math.floor(boomAt * sr);
    for (let i = n0; i < out.length; i++) {
      const t = (i - n0) / sr;
      if (((i - n0) & 15) === 0) lp.lp(sweep(t), 0.8, sr);
      out[i] += sub.sine(40 + 50 * Math.exp(-t / 0.08), sr) * perc(t, 0.002, 0.2) + lp.process(white(r)) * perc(t, 0.002, 0.25) * 1.2;
    }
    if (v !== 2) crackle(sr, r, out, boomAt + 0.08, dur - 0.1, ri(r, 90, 140), 0.5);
    // mono: fireworks are positional (panned at runtime), so stereo width would only cost memory
    return finish(toMono(reverb(drive(out, 2), sr, { size: 0.85, damp: 0.3, wet: 0.35, tailSec: 1 })), sr, { target: -11 });
  },
};

/** One crow "caw": raspy saw + subharmonic through beak/throat resonances. */
function caw(sr: number, r: Rng, f: number, dur: number): Float32Array {
  const out = alloc(sr, dur + 0.03);
  const o1 = new Osc(r());
  const o2 = new Osc(r());
  const p1 = new Biquad().peak(rr(r, 1100, 1300), 2.5, 12, sr);
  const p2 = new Biquad().peak(rr(r, 2200, 2600), 3, 8, sr);
  const lp = new Biquad().lp(5000, 0.7, sr);
  const hp = new Biquad().hp(300, 0.7, sr);
  const kb = new Biquad().bp(2500, 1.5, sr);
  const w = new Wander(r);
  const pitch = pw([
    [0, 0.9],
    [0.05, 1.05],
    [dur * 0.6, 1],
    [dur, 0.82],
  ]);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const ff = f * pitch(t) * (1 + 0.03 * w.next(60, sr));
    const src = o1.saw(ff, sr) + 0.35 * o2.saw(ff / 2, sr) + white(r) * 0.3;
    const rough = 1 + 0.3 * Math.sin(TAU * 45 * t);
    const env = ahr(t, 0.015, Math.max(0.02, dur - 0.08), 0.06) * rough;
    const k = t < 0.012 ? kb.process(white(r)) * 1.5 * (1 - t / 0.012) : 0;
    out[i] = hp.process(lp.process(p2.process(p1.process(src * env)))) + k;
  }
  return drive(out, 2.5);
}

/** Seattle crows: "caw", "caw-caw", "caw-caw-caw". */
export const crow_caw: Recipe = {
  variants: 5,
  sr: 32000,
  render(v, sr) {
    const r = makeRng(0xc30c + v * 3);
    const count = [1, 2, 3, 2, 1][v];
    const f = rr(r, 500, 650) * (v === 3 ? 1.12 : 1);
    const long = v === 4;
    const out = alloc(sr, count * 0.5 + 0.3);
    let t = 0.005;
    for (let k = 0; k < count; k++) {
      const d = long ? rr(r, 0.45, 0.55) : rr(r, 0.22, 0.34);
      mixInto(out, caw(sr, r, f * rr(r, 0.96, 1.04), d), t * sr, k === 0 ? 1 : rr(r, 0.8, 0.95));
      t += d + rr(r, 0.1, 0.2);
    }
    return finish(out, sr);
  },
};

/** Seagulls: "keee-ow", double call, "ha-ha-ha" laugh, long call. */
export const seagull: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x5e6a + v * 9);
    const out = alloc(sr, 2);
    const kyow = (t0: number, f: number, d: number, g: number) => {
      const s = critter(sr, {
        dur: d + 0.02,
        f0: pwExp([
          [0, f * 0.6],
          [d * 0.25, f * 1.2],
          [d, f * 0.72],
        ]),
        amp: (t) => ahr(t, 0.02, d * 0.6, d * 0.35),
        harm: [1, 0.6, 0.35, 0.2, 0.1],
        rasp: 0.25,
        raspHz: 90,
        breath: 0.12,
        breathHz: 3000,
        jitter: 0.02,
        formants: [[2200, 1.5, 5]],
        highpass: 500,
        seed: r() * 1e9,
      });
      mixInto(out, s, t0 * sr, g);
    };
    const laugh = (t0: number, n: number, f: number) => {
      let t = t0;
      for (let k = 0; k < n; k++) {
        const d = rr(r, 0.08, 0.11);
        const s = critter(sr, {
          dur: d + 0.02,
          f0: pwExp([
            [0, f * 1.1],
            [d, f * 0.85],
          ]),
          amp: (tt) => hann(tt, d),
          harm: [1, 0.55, 0.3, 0.15],
          rasp: 0.3,
          raspHz: 80,
          breath: 0.15,
          breathHz: 2800,
          jitter: 0.02,
          highpass: 500,
          seed: r() * 1e9,
        });
        mixInto(out, s, t * sr, 0.8 - k * 0.04);
        t += rr(r, 0.12, 0.15);
        f *= 0.985;
      }
      return t;
    };
    const f = rr(r, 1300, 1700);
    if (v === 0) kyow(0.01, f, rr(r, 0.35, 0.45), 1);
    else if (v === 1) {
      kyow(0.01, f, 0.3, 1);
      kyow(0.42, f * 1.05, 0.34, 0.9);
    } else if (v === 2) laugh(0.01, ri(r, 5, 7), f * 0.9);
    else {
      kyow(0.01, f, 0.42, 1);
      laugh(0.55, ri(r, 4, 6), f * 0.9);
    }
    return finish(out, sr);
  },
};

/** Electrical short circuit (washing a phone): crackling sparks, mains buzz, little pop. */
export const short_circuit: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x5c1c + v * 7);
    const dur = rr(r, 0.6, 0.8);
    const out = alloc(sr, dur + 0.2);
    const o = new Osc();
    const lp = new Biquad().lp(3000, 0.7, sr);
    let gate = 1;
    let next = 0;
    for (let i = 0; i < dur * sr; i++) {
      const t = i / sr;
      if (t >= next) {
        gate = r() < 0.6 ? rr(r, 0.4, 1) : 0;
        next = t + rr(r, 0.01, 0.04);
      }
      out[i] = lp.process(o.saw(120, sr)) * gate * 0.35 * (1 - t / dur);
    }
    const bp = new Biquad().bp(4000, 0.8, sr);
    const n = ri(r, 35, 55);
    for (let k = 0; k < n; k++) {
      const t = Math.pow(r(), 1.3) * dur;
      const d = rr(r, 0.0005, 0.002);
      const s = alloc(sr, d * 5);
      for (let i = 0; i < s.length; i++) s[i] = bp.process(white(r)) * Math.exp(-i / sr / d) * 3;
      mixInto(out, s, t * sr, rr(r, 0.3, 1));
    }
    const pop = alloc(sr, 0.12);
    const po = new Osc();
    const plp = new Biquad().lp(1200, 0.7, sr);
    for (let i = 0; i < pop.length; i++) {
      const t = i / sr;
      pop[i] = plp.process(white(r)) * perc(t, 0.001, 0.02) + po.sine(80 + 120 * Math.exp(-t / 0.02), sr) * perc(t, 0.001, 0.04) * 0.8;
    }
    mixInto(out, pop, dur * sr, 0.8);
    return finish(out, sr);
  },
};

/** Seamless 3 s loop: SlopCorp data-center hum, fans, and occasional computer chirps. */
export const server_hum_loop: Recipe = {
  variants: 1,
  sr: 22050,
  loop: true,
  render(v, sr) {
    const r = makeRng(0x5e7e + v);
    const L = 3;
    const X = 0.5;
    const N = Math.floor((L + X) * sr);
    const buf = new Float32Array(N);
    const pink = new Pink();
    const lp = new Biquad().lp(1800, 0.7, sr);
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const hum = Math.sin(TAU * 60 * t) * 0.5 + Math.sin(TAU * 120 * t) * 0.3 + Math.sin(TAU * 180 * t) * 0.12;
      const fan = lp.process(pink.next(white(r))) * (0.85 + 0.15 * Math.sin(TAU * 7 * t));
      buf[i] = hum * 0.35 + fan * 0.8;
    }
    const loop = seamlessLoop(buf, sr, L, X);
    for (let k = 0; k < 3; k++) {
      const d = rr(r, 0.02, 0.06);
      const s = alloc(sr, d);
      const o = new Osc();
      const f = rr(r, 1000, 3000);
      for (let i = 0; i < s.length; i++) s[i] = o.square(f, sr) * hann(i / sr, d) * 0.12;
      mixIntoWrapped(loop, s, rr(r, 0, L) * sr);
    }
    return finishLoop(loop, sr, -22);
  },
};

/** Wildlife Officer's pea whistle: "tweeeet!", "tweet-tweet", triple. */
export const officer_whistle: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x0ff1 + v * 3);
    const out = alloc(sr, 1);
    const f = rr(r, 2700, 3300);
    const blast = (t0: number, d: number) => {
      const s = alloc(sr, d + 0.03);
      const o = new Osc();
      const nb = new Biquad().bp(f, 5, sr);
      const rate = rr(r, 25, 35);
      for (let i = 0; i < s.length; i++) {
        const t = i / sr;
        const pea = Math.sin(TAU * rate * t);
        s[i] = (o.harmonics(f * (1 + 0.04 * pea), sr, [1, 0.15, 0.05]) * (0.7 + 0.3 * pea) + nb.process(white(r)) * 0.9) * ahr(t, 0.01, d - 0.04, 0.03);
      }
      mixInto(out, s, t0 * sr);
    };
    if (v === 0) blast(0.003, 0.6);
    else if (v === 1) {
      blast(0.003, 0.18);
      blast(0.26, 0.18);
    } else for (let k = 0; k < 3; k++) blast(0.003 + k * 0.2, 0.13);
    return finish(out, sr, { target: -14 });
  },
};
