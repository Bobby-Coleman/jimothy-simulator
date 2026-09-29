/**
 * Human-ish sounds via formant synthesis: cartoon "waaah!" screams (PG) and crowd reactions
 * (awww, ooooh, cheers with applause, laughter). Crowds are stereo with a touch of reverb.
 */
import {
  ahr,
  alloc,
  Biquad,
  drive,
  hann,
  makeRng,
  mixInto,
  panInto,
  pick,
  pw,
  reverb,
  ri,
  rr,
  toMono,
  white,
  type Rng,
  type Stereo,
} from '../dsp';
import { finish, type Recipe } from '../recipe';
import { formantVoice, vowelPath, type Vowel } from '../voice';

const CROWD_SR = 22050;

interface Person {
  f0: number;
  scale: number;
}

function person(r: Rng, excited = 1): Person {
  const u = r();
  if (u < 0.45) return { f0: rr(r, 100, 150) * excited, scale: rr(r, 0.97, 1.05) };
  if (u < 0.88) return { f0: rr(r, 185, 260) * excited, scale: rr(r, 1.12, 1.2) };
  return { f0: rr(r, 260, 330) * excited, scale: rr(r, 1.25, 1.35) };
}

function withReverb(st: Stereo, sr: number, wet = 0.3, size = 0.6): Stereo {
  const w = reverb(toMono(st), sr, { size, damp: 0.5, wet, dry: 0, tailSec: 0.7 });
  const n = Math.max(st[0].length, w[0].length);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  L.set(st[0]);
  R.set(st[1]);
  mixInto(L, w[0], 0);
  mixInto(R, w[1], 0);
  return [L, R];
}

/** Cartoon scream "waaaah!" — man, woman, kid, long falling (launched), short yelp. */
export const scream: Recipe = {
  variants: 5,
  sr: 32000,
  render(v, sr) {
    const r = makeRng(0x5c3e + v * 31);
    const kinds = [
      { f: rr(r, 300, 360), scale: 1.0, dur: rr(r, 1.0, 1.2), mode: 'normal' },
      { f: rr(r, 560, 660), scale: 1.17, dur: rr(r, 1.0, 1.25), mode: 'normal' },
      { f: rr(r, 680, 780), scale: 1.3, dur: rr(r, 0.9, 1.1), mode: 'normal' },
      { f: rr(r, 420, 520), scale: 1.1, dur: 1.6, mode: 'falling' },
      { f: rr(r, 380, 480), scale: 1.08, dur: 0.42, mode: 'yelp' },
    ] as const;
    const k = kinds[v % kinds.length];
    const d = k.dur;
    const contour =
      k.mode === 'falling'
        ? (t: number) => Math.pow(0.35, Math.min(1, t / d))
        : k.mode === 'yelp'
          ? pw([
              [0, 0.8],
              [0.06, 1.05],
              [d, 0.75],
            ])
          : pw([
              [0, 0.78],
              [0.1, 1],
              [d - 0.35, 0.97],
              [d, 0.6],
            ]);
    const s = formantVoice(sr, {
      dur: d + 0.05,
      f0: (t) => k.f * contour(t),
      amp: (t) => ahr(t, 0.03, Math.max(0.05, d - 0.33), k.mode === 'yelp' ? 0.12 : 0.3),
      formants: vowelPath([
        [0, 'w'],
        [0.09, 'a'],
        [Math.max(0.1, d - 0.2), 'a'],
        [d, 'aw'],
      ]),
      scale: k.scale,
      breath: 0.12,
      vibRate: 7.5,
      vibDepth: k.mode === 'yelp' ? 0.005 : 0.03,
      jitter: 0.02,
      shimmer: 0.12,
      tiltHz: 900,
      seed: r() * 1e9,
    });
    return finish(drive(s, 1.5), sr, { target: -12 });
  },
};

/** Sympathetic crowd "awwww" (Jimothy is adorable). */
export const crowd_aww: Recipe = {
  variants: 3,
  sr: CROWD_SR,
  render(v, sr) {
    const r = makeRng(0xa3a3 + v * 101);
    const n = ri(r, 16, 22);
    const out: Stereo = [alloc(sr, 1.8), alloc(sr, 1.8)];
    for (let k = 0; k < n; k++) {
      const p = person(r);
      const d = rr(r, 0.9, 1.35);
      const peak = rr(r, 1.12, 1.25);
      const end = rr(r, 0.78, 0.86);
      const contour = pw([
        [0, peak * 0.95],
        [0.12, peak],
        [d, end],
      ]);
      const att = rr(r, 0.08, 0.15);
      const s = formantVoice(sr, {
        dur: d,
        f0: (t) => p.f0 * contour(t),
        amp: (t) => ahr(t, att, Math.max(0.05, d - att - 0.3), 0.3),
        formants: vowelPath([
          [0, 'a'],
          [d * 0.3, 'aw'],
          [d, 'aw'],
        ]),
        scale: p.scale,
        breath: 0.1,
        vibRate: rr(r, 4.5, 6),
        vibDepth: 0.012,
        jitter: 0.015,
        bw: 1.2,
        seed: r() * 1e9,
      });
      panInto(out, s, rr(r, 0, 0.18) * sr, rr(r, -0.8, 0.8), rr(r, 0.6, 1));
    }
    return finish(withReverb(out, sr, 0.25), sr, { target: -14 });
  },
};

/** Impressed crowd "ooooOOOh" (someone just got launched). */
export const crowd_ooh: Recipe = {
  variants: 2,
  sr: CROWD_SR,
  render(v, sr) {
    const r = makeRng(0x0a0a + v * 103);
    const n = ri(r, 16, 22);
    const out: Stereo = [alloc(sr, 2), alloc(sr, 2)];
    for (let k = 0; k < n; k++) {
      const p = person(r);
      const d = rr(r, 1.0, 1.45);
      const contour = pw([
        [0, 0.9],
        [d * rr(r, 0.35, 0.5), rr(r, 1.12, 1.22)],
        [d, rr(r, 0.82, 0.9)],
      ]);
      const s = formantVoice(sr, {
        dur: d,
        f0: (t) => p.f0 * contour(t),
        amp: (t) => ahr(t, 0.15, Math.max(0.05, d - 0.5), 0.35),
        formants: vowelPath([
          [0, 'oo'],
          [d * 0.5, 'o'],
          [d, 'oo'],
        ]),
        scale: p.scale,
        breath: 0.1,
        vibRate: rr(r, 4.5, 6),
        vibDepth: 0.012,
        jitter: 0.015,
        bw: 1.2,
        seed: r() * 1e9,
      });
      panInto(out, s, rr(r, 0, 0.2) * sr, rr(r, -0.8, 0.8), rr(r, 0.6, 1));
    }
    return finish(withReverb(out, sr, 0.25), sr, { target: -14 });
  },
};

type Word = 'yay' | 'woo' | 'hey' | 'yeah';

function cheerWord(sr: number, r: Rng, p: Person, w: Word): Float32Array {
  const d = rr(r, 0.35, 0.8);
  let path: (t: number) => readonly [number, number, number];
  let contour: (t: number) => number;
  let asp: ((t: number) => number) | undefined;
  const vp = (keys: [number, Vowel][]) => vowelPath(keys);
  switch (w) {
    case 'yay':
      path = vp([
        [0, 'y'],
        [0.06, 'eh'],
        [d * 0.6, 'e'],
        [d, 'ih'],
      ]);
      contour = pw([
        [0, 1],
        [d * 0.3, 1.3],
        [d, 1.1],
      ]);
      break;
    case 'woo':
      path = vp([
        [0, 'w'],
        [0.08, 'oo'],
        [d, 'oo'],
      ]);
      contour = pw([
        [0, 0.9],
        [d * 0.6, 1.5],
        [d, 1.35],
      ]);
      break;
    case 'hey':
      path = vp([
        [0, 'eh'],
        [d, 'e'],
      ]);
      contour = pw([
        [0, 1.25],
        [d, 1],
      ]);
      asp = (t) => (t < 0.05 ? 1.2 : 0);
      break;
    default:
      path = vp([
        [0, 'y'],
        [0.07, 'eh'],
        [d * 0.5, 'ae'],
        [d, 'ae'],
      ]);
      contour = pw([
        [0, 1.1],
        [d * 0.3, 1.25],
        [d, 0.95],
      ]);
  }
  return formantVoice(sr, {
    dur: d,
    f0: (t) => p.f0 * contour(t),
    amp: (t) => ahr(t, 0.03, Math.max(0.05, d - 0.2), 0.17),
    formants: path,
    aspiration: asp,
    scale: p.scale,
    breath: 0.12,
    vibRate: 6,
    vibDepth: 0.01,
    jitter: 0.02,
    tiltHz: 900,
    seed: r() * 1e9,
  });
}

/** Crowd cheer: "yay / woo / hey / yeah!" voices, applause and a whistle or two. */
export const crowd_cheer: Recipe = {
  variants: 3,
  sr: CROWD_SR,
  render(v, sr) {
    const r = makeRng(0xc4ee + v * 107);
    const dur = 2.3;
    const out: Stereo = [alloc(sr, dur), alloc(sr, dur)];
    const n = ri(r, 20, 26);
    const words: Word[] = ['yay', 'woo', 'hey', 'yeah'];
    for (let k = 0; k < n; k++) {
      const p = person(r, rr(r, 1.3, 1.6));
      const w = pick(r, words);
      const pan = rr(r, -0.85, 0.85);
      const g = rr(r, 0.5, 1);
      let t = rr(r, 0, 0.35);
      const reps = r() < 0.35 ? 2 : 1;
      for (let q = 0; q < reps; q++) {
        const s = cheerWord(sr, r, p, w);
        panInto(out, s, t * sr, pan, g);
        t += s.length / sr + rr(r, 0.05, 0.2);
      }
    }
    // applause
    const claps = Math.floor(rr(r, 38, 50) * 1.9);
    for (let k = 0; k < claps; k++) {
      const t = rr(r, 0.05, 1.95);
      const d = rr(r, 0.008, 0.015);
      const s = alloc(sr, d * 3);
      const bp = new Biquad().bp(rr(r, 900, 2500), 1.2, sr);
      for (let i = 0; i < s.length; i++) s[i] = bp.process(white(r)) * Math.exp(-i / sr / (d / 2)) * 2.5;
      const env = ahr(t, 0.1, 1.2, 0.65);
      panInto(out, s, t * sr, rr(r, -0.9, 0.9), rr(r, 0.2, 0.5) * env);
    }
    // a whistle or two
    for (let k = 0; k < ri(r, 1, 2); k++) {
      const t0 = rr(r, 0.2, 0.8);
      const d = rr(r, 0.45, 0.6);
      const s = alloc(sr, d);
      const fa = rr(r, 1700, 2000);
      const fb = fa * 1.45;
      let ph = 0;
      for (let i = 0; i < s.length; i++) {
        const t = i / sr;
        const u = t / d;
        const f = u < 0.45 ? fa + (fb - fa) * (u / 0.45) : fb - (fb - fa) * 0.8 * ((u - 0.45) / 0.55);
        ph += f / sr;
        s[i] = Math.sin(2 * Math.PI * ph) * hann(t, d);
      }
      panInto(out, s, t0 * sr, rr(r, -0.6, 0.6), 0.12);
    }
    return finish(withReverb(out, sr, 0.3, 0.7), sr, { target: -13 });
  },
};

/** Crowd laughing "ha-ha-ha" (someone got bonked). */
export const crowd_laugh: Recipe = {
  variants: 2,
  sr: CROWD_SR,
  render(v, sr) {
    const r = makeRng(0x1a6f + v * 109);
    const out: Stereo = [alloc(sr, 2.2), alloc(sr, 2.2)];
    const n = ri(r, 12, 16);
    const vowels: Vowel[] = ['a', 'ae', 'uh'];
    for (let k = 0; k < n; k++) {
      const p = person(r, rr(r, 1.1, 1.35));
      const rate = rr(r, 4.5, 6);
      const nsyl = ri(r, 4, 7);
      const d = nsyl / rate + 0.1;
      const vw = pick(r, vowels);
      const fall = rr(r, 0.93, 0.97);
      const s = formantVoice(sr, {
        dur: d,
        f0: (t) => {
          const ph = (t * rate) % 1;
          return p.f0 * 1.25 * Math.pow(fall, Math.floor(t * rate)) * (1 + 0.08 * (1 - ph));
        },
        amp: (t) => {
          const kk = Math.floor(t * rate);
          if (kk >= nsyl) return 0;
          const ph = (t * rate) % 1;
          const syl = ph < 0.22 ? ph / 0.22 : Math.max(0, 1 - (ph - 0.22) / 0.55);
          return syl * (1 - 0.08 * kk);
        },
        aspiration: (t) => ((t * rate) % 1 < 0.2 ? 0.9 : 0.05),
        formants: vowelPath([[0, vw]]),
        scale: p.scale,
        breath: 0.1,
        vibDepth: 0,
        jitter: 0.02,
        seed: r() * 1e9,
      });
      panInto(out, s, rr(r, 0, 0.45) * sr, rr(r, -0.85, 0.85), rr(r, 0.5, 1));
    }
    return finish(withReverb(out, sr, 0.25), sr, { target: -14 });
  },
};
