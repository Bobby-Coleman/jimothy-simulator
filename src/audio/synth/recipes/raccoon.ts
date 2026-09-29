/**
 * Jimothy's voice. Real raccoons chitter (rapid high chirps), trill/purr (warbling churr),
 * hiss, squeak/squeal, and make happy little chirps. Kits peep.
 */
import { ahr, alloc, Biquad, hann, makeRng, mixInto, Osc, perc, pw, pwExp, ri, rr, TAU, Wander, white } from '../dsp';
import { finish, type Recipe } from '../recipe';
import { chirp, critter } from '../voice';

const SR = 44100;

/** Rapid run of high, raspy chirps ("chchchchirr"). */
export const chitter: Recipe = {
  variants: 6,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xc417 + v * 7919);
    const n = ri(r, 7, 13);
    const rate = rr(r, 11, 16);
    const base = rr(r, 1500, 2200);
    const out = alloc(sr, n / rate + 0.3);
    let t = 0.005;
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1);
      const arc = 1 + 0.22 * Math.sin(Math.PI * u) + rr(r, -0.07, 0.07);
      const f = base * arc;
      const d = rr(r, 0.032, 0.058);
      const c = chirp(sr, r() * 1e9, {
        dur: d,
        fStart: f * rr(r, 0.8, 0.95),
        fPeak: f * rr(r, 1.3, 1.65),
        fEnd: f * rr(r, 0.85, 1.05),
        peakAt: rr(r, 0.25, 0.45),
        rasp: rr(r, 0.3, 0.6),
        breath: rr(r, 0.15, 0.3),
      });
      const amp = (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 1.3))) * rr(r, 0.7, 1);
      mixInto(out, c, t * sr, amp);
      // occasional quick double-chirp
      t += (1 / rate) * (r() < 0.15 ? 0.55 : rr(r, 0.8, 1.2));
    }
    return finish(out, sr);
  },
};

/** Warbling, bird-like trill (fast FM + pulsing amplitude). */
export const trill: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x7121 + v * 104729);
    const dur = rr(r, 0.5, 0.95);
    const f = rr(r, 950, 1500);
    const rate = rr(r, 22, 32);
    const depth = rr(r, 0.07, 0.13);
    const contour = pwExp([
      [0, f * 0.88],
      [dur * rr(r, 0.2, 0.4), f * 1.12],
      [dur, f * rr(r, 0.78, 0.9)],
    ]);
    const ph = r() * TAU;
    const out = critter(sr, {
      dur: dur + 0.02,
      f0: (t) => contour(t) * (1 + depth * Math.sin(TAU * rate * t + ph)),
      amp: (t) =>
        ahr(t, 0.03, Math.max(0.05, dur - 0.16), 0.13) * (0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(TAU * rate * t + ph + 0.6), 1.5)),
      harm: [1, 0.42, 0.2, 0.09],
      rasp: 0.15,
      raspHz: 120,
      breath: 0.12,
      breathHz: 3500,
      jitter: 0.01,
      formants: [[2600, 1.5, 3]],
      highpass: 350,
      seed: r() * 1e9,
    });
    return finish(out, sr);
  },
};

/** Low, rolling churr/purr (contented raccoon). */
export const purr: Recipe = {
  variants: 3,
  sr: 32000,
  render(v, sr) {
    const r = makeRng(0x9022 + v * 15485863);
    const dur = rr(r, 0.7, 1.2);
    const f = rr(r, 260, 380);
    const rate = rr(r, 23, 29);
    const contour = pwExp([
      [0, f * 0.95],
      [dur * 0.5, f * 1.08],
      [dur, f * 0.9],
    ]);
    const out = critter(sr, {
      dur: dur + 0.02,
      f0: contour,
      amp: (t) => ahr(t, 0.06, dur - 0.22, 0.16) * (0.12 + 0.88 * Math.pow(0.5 + 0.5 * Math.sin(TAU * rate * t), 2)),
      harm: [1, 0.75, 0.55, 0.4, 0.28, 0.18, 0.12, 0.08],
      rasp: 0.45,
      raspHz: 55,
      breath: 0.3,
      breathHz: 1400,
      breathQ: 0.8,
      jitter: 0.03,
      formants: [[900, 1.2, 4]],
      lowpass: 3200,
      highpass: 110,
      seed: r() * 1e9,
    });
    return finish(out, sr);
  },
};

/** Cute-but-grumpy hiss. Variants: plain, huff+hiss, hiss with a growl, short spit. */
export const hiss: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x4155 + v * 7727);
    const kind = v % 4;
    const dur = kind === 3 ? rr(r, 0.26, 0.34) : rr(r, 0.5, 0.8);
    const out = alloc(sr, dur + 0.05);
    const bp = new Biquad().bp(rr(r, 3800, 5200), 0.9, sr);
    const hp = new Biquad().hp(1600, 0.7, sr);
    const lp = new Biquad().lp(10000, 0.7, sr);
    const throat = new Biquad().peak(rr(r, 2500, 3200), 3, 6, sr);
    const flutter = new Wander(r);
    const growlOsc = new Osc();
    const growlLp = new Biquad().lp(650, 0.9, sr);
    const growl = kind === 2 ? 0.28 : 0;
    const att = kind === 3 ? 0.006 : rr(r, 0.02, 0.045);
    const env =
      kind === 1
        ? pw([
            [0, 0],
            [0.008, 1],
            [0.055, 0.7],
            [0.085, 0.2],
            [0.16, 0.95],
            [dur - 0.14, 1],
            [dur, 0],
          ])
        : (t: number) => ahr(t, att, Math.max(0.02, dur - att - 0.14), 0.14);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const e = env(t);
      const flut = 1 + 0.18 * flutter.next(16, sr);
      const w = white(r);
      let s = lp.process(hp.process(bp.process(w) * 1.6 + 0.4 * w));
      s = throat.process(s);
      let g = 0;
      if (growl > 0) g = growlLp.process(growlOsc.saw(96 * (1 + 0.05 * Math.sin(TAU * 3 * t)), sr)) * growl * (0.6 + 0.4 * Math.sin(TAU * 28 * t));
      out[i] = (s * flut + g) * e;
    }
    return finish(out, sr);
  },
};

/** Squeaks: short "eek!", double "eek-eek", and a longer squeal. */
export const squeak: Recipe = {
  variants: 6,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x5913 + v * 31337);
    const kind = v % 3;
    const out = alloc(sr, 0.8);
    const one = (t0: number, d: number, f: number, rise: number, vib: number) => {
      const pk = rr(r, 0.2, 0.35);
      const s = critter(sr, {
        dur: d + 0.01,
        f0: (t) => {
          const u = t / d;
          const base = u < pk ? f * Math.pow(rise, u / pk) : f * rise * Math.pow(0.78, Math.min(1, (u - pk) / (1 - pk)));
          return base * (1 + vib * Math.sin(TAU * 13 * t));
        },
        amp: (t) => Math.pow(hann(t, d), 0.5),
        harm: [1, 0.35, 0.14, 0.05],
        rasp: kind === 2 ? 0.35 : 0.12,
        raspHz: 170,
        breath: kind === 2 ? 0.25 : 0.1,
        breathHz: 5500,
        jitter: 0.012,
        formants: [[4200, 1.6, 4]],
        highpass: 600,
        seed: r() * 1e9,
      });
      mixInto(out, s, t0 * sr);
    };
    if (kind === 0) one(0.005, rr(r, 0.09, 0.15), rr(r, 2100, 2800), rr(r, 1.35, 1.6), 0);
    else if (kind === 1) {
      const f = rr(r, 2100, 2600);
      one(0.005, rr(r, 0.07, 0.1), f, rr(r, 1.3, 1.5), 0);
      one(rr(r, 0.12, 0.16), rr(r, 0.08, 0.11), f * rr(r, 1.05, 1.15), rr(r, 1.3, 1.5), 0);
    } else one(0.005, rr(r, 0.3, 0.45), rr(r, 2500, 3000), rr(r, 1.3, 1.5), 0.035);
    return finish(out, sr);
  },
};

/** Happy, bright rising chirps ("chirp-chirp!"). */
export const happy: Recipe = {
  variants: 5,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x4a99 + v * 5381);
    const n = ri(r, 2, 4);
    const out = alloc(sr, n * 0.17 + 0.25);
    let t = 0.005;
    const base = rr(r, 1250, 1600);
    for (let k = 0; k < n; k++) {
      const last = k === n - 1;
      const d = last ? rr(r, 0.1, 0.15) : rr(r, 0.065, 0.1);
      const f = base * (1 + 0.08 * k) * rr(r, 0.95, 1.05);
      const c = chirp(sr, r() * 1e9, {
        dur: d,
        fStart: f,
        fPeak: f * rr(r, 1.6, 1.9),
        fEnd: f * (last ? rr(r, 1.5, 1.8) : rr(r, 1.2, 1.4)),
        peakAt: last ? 0.75 : 0.6,
        rasp: 0.08,
        breath: 0.06,
        harm: [1, 0.3, 0.1, 0.04],
        formantHz: 3000,
      });
      mixInto(out, c, t * sr, last ? 1 : 0.85);
      t += d + rr(r, 0.035, 0.07);
    }
    return finish(out, sr);
  },
};

/** Tiny high peeps from baby raccoons (kits). */
export const kit_chirp: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x6177 + v * 911);
    const n = ri(r, 1, 3);
    const out = alloc(sr, n * 0.13 + 0.15);
    let t = 0.005;
    for (let k = 0; k < n; k++) {
      const d = rr(r, 0.045, 0.08);
      const f = rr(r, 2900, 3900);
      const c = chirp(sr, r() * 1e9, {
        dur: d,
        fStart: f * 0.9,
        fPeak: f * 1.25,
        fEnd: f * 1.05,
        peakAt: 0.5,
        rasp: 0.05,
        breath: 0.05,
        harm: [1, 0.2, 0.05],
        formantHz: 4500,
      });
      mixInto(out, c, t * sr, rr(r, 0.8, 1));
      t += d + rr(r, 0.04, 0.08);
    }
    return finish(out, sr, { target: -15 });
  },
};

/** Crunchy snack chomps followed by a contented little chirp. */
export const munch: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x3c3c + v * 2027);
    const n = ri(r, 3, 5);
    const out = alloc(sr, n * 0.21 + 0.4);
    let t = 0.01;
    for (let k = 0; k < n; k++) {
      const d = rr(r, 0.05, 0.085);
      const chomp = alloc(sr, d + 0.07);
      const lp = new Biquad().lp(rr(r, 2200, 3500), 0.8, sr);
      const bp = new Biquad().bp(rr(r, 900, 1500), 1.2, sr);
      const thump = new Osc();
      for (let i = 0; i < chomp.length; i++) {
        const tt = i / sr;
        const env = perc(tt, 0.003, d * 0.45);
        const imp = r() < 0.03 ? white(r) * 4 : 0;
        const n1 = lp.process(white(r) * 0.6 + imp);
        const n2 = bp.process(white(r)) * 1.5;
        const th = thump.sine(130 * Math.exp(-tt / 0.03) + 70, sr) * perc(tt, 0.002, 0.03) * 0.8;
        chomp[i] = (n1 + n2) * env * 0.7 + th;
      }
      mixInto(out, chomp, t * sr, rr(r, 0.75, 1));
      t += rr(r, 0.15, 0.2);
    }
    const c = chirp(sr, r() * 1e9, { dur: 0.08, fStart: 1300, fPeak: 2100, fEnd: 1900, peakAt: 0.6, rasp: 0.1, breath: 0.08 });
    mixInto(out, c, (t + 0.03) * sr, 0.35);
    return finish(out, sr);
  },
};
