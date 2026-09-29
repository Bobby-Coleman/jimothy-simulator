/**
 * Water & washing: bubbles, splashes, scrubbing, the bubbly wash loop, lapping water, fizzing.
 * Bubbles are damped sines with a rising pitch chirp (Minnaert resonance as the bubble rises).
 */
import {
  ahr,
  alloc,
  Biquad,
  Brown,
  hann,
  makeRng,
  mixInto,
  mixIntoWrapped,
  OnePole,
  Osc,
  perc,
  Pink,
  pwExp,
  ri,
  rr,
  seamlessLoop,
  TAU,
  Wander,
  white,
  type Rng,
} from '../dsp';
import { finish, finishLoop, type Recipe } from '../recipe';

const SR = 44100;

/** One bubble "bloop": damped sine whose pitch rises by `rise` (fraction) over its life. */
export function bubble(sr: number, f0: number, dur: number, rise: number, r: Rng): Float32Array {
  const out = alloc(sr, dur);
  const osc = new Osc(r());
  const tau = dur / 4;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = f0 * (1 + (rise * t) / dur);
    out[i] = osc.sine(f, sr) * Math.min(1, t / 0.0015) * Math.exp(-t / tau);
  }
  return out;
}

/** Short broadband click (e.g. bubble film rupture). */
function click(sr: number, r: Rng, dur = 0.0015, hpHz = 3000): Float32Array {
  const out = alloc(sr, dur + 0.004);
  const hp = new Biquad().hp(hpHz, 0.7, sr);
  for (let i = 0; i < out.length; i++) out[i] = hp.process(white(r)) * Math.exp(-i / sr / (dur / 3));
  return out;
}

/** One brush stroke: band-passed noise with bristly crackle and a hann swell. */
export function scrubStroke(sr: number, d: number, r: Rng): Float32Array {
  const out = alloc(sr, d);
  const bp = new Biquad().bp(rr(r, 2500, 4500), 1.1, sr);
  const hp = new Biquad().hp(1200, 0.7, sr);
  const center = rr(r, 0.35, 0.6);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const u = t / d;
    const env = Math.pow(hann(u < center ? (u / center) * 0.5 : 0.5 + ((u - center) / (1 - center)) * 0.5, 1), 1.2);
    const crackle = r() < 0.05 ? white(r) * 3 : 0;
    out[i] = hp.process(bp.process(white(r)) * 1.4 + crackle * 0.5) * env;
  }
  return out;
}

export const bubble_pop: Recipe = {
  variants: 6,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xb0b0 + v * 4099);
    const out = alloc(sr, 0.22);
    const f0 = rr(r, 600, 1500);
    mixInto(out, click(sr, r), 0, 0.3);
    mixInto(out, bubble(sr, f0, rr(r, 0.05, 0.1), rr(r, 0.8, 1.8), r), 0.002 * sr, 1);
    if (v % 2 === 1) mixInto(out, bubble(sr, f0 * rr(r, 1.4, 1.8), rr(r, 0.03, 0.06), rr(r, 0.8, 1.5), r), rr(r, 0.03, 0.07) * sr, 0.5);
    return finish(out, sr, { target: -14 });
  },
};

/** A giant soap bubble bursting: film snap, low bloop, fizzy spray. */
export const bubble_burst: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xb1b1 + v * 331);
    const out = alloc(sr, 0.7);
    const hp = new Biquad().hp(1200, 0.7, sr);
    const fz = new Biquad().hp(4500, 0.7, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const snap = hp.process(white(r)) * perc(t, 0.0008, 0.004) * 0.9;
      const fizz = fz.process(white(r) + (r() < 0.01 ? white(r) * 4 : 0)) * perc(t - 0.01, 0.01, 0.12) * 0.3;
      out[i] = snap + fizz;
    }
    mixInto(out, bubble(sr, rr(r, 260, 380), 0.14, 1.2, r), 0.004 * sr, 0.8);
    const n = ri(r, 6, 10);
    for (let k = 0; k < n; k++) mixInto(out, bubble(sr, rr(r, 1500, 3500), rr(r, 0.02, 0.04), 1, r), rr(r, 0.03, 0.35) * sr, rr(r, 0.2, 0.4));
    return finish(out, sr);
  },
};

function splashCore(sr: number, r: Rng, big: boolean): Float32Array {
  const dur = big ? 2.1 : 1.0;
  const out = alloc(sr, dur);
  const lp = new Biquad();
  const spray = new Biquad().hp(3000, 0.7, sr);
  const body = new Osc();
  const sweep = pwExp(
    big
      ? [
          [0, 6000],
          [0.8, 500],
          [dur, 300],
        ]
      : [
          [0, 7000],
          [0.35, 900],
          [dur, 600],
        ],
  );
  const decay = big ? 0.45 : 0.18;
  const sprayDecay = big ? 0.5 : 0.25;
  const thumpF0 = big ? 110 : 160;
  const thumpTau = big ? 0.09 : 0.05;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if ((i & 15) === 0) lp.lp(sweep(t), 0.9, sr);
    const w = white(r);
    const main = lp.process(w) * perc(t, 0.004, decay);
    const sp = spray.process(white(r)) * perc(t, 0.01, sprayDecay) * 0.35;
    const th = body.sine(thumpF0 * Math.exp(-t / 0.06) + 40, sr) * perc(t, 0.002, thumpTau) * (big ? 1 : 0.8);
    out[i] = main + sp + th;
  }
  const drops = big ? ri(r, 32, 45) : ri(r, 12, 22);
  for (let k = 0; k < drops; k++) {
    const t = 0.03 + Math.pow(r(), 1.7) * (big ? 1.6 : 0.7);
    const a = (big ? 0.35 : 0.3) * (1 - t / dur) * rr(r, 0.4, 1);
    mixInto(out, bubble(sr, rr(r, 800, 3200), rr(r, 0.025, 0.07), rr(r, 0.5, 1.5), r), t * sr, a);
  }
  if (big) {
    // water raining back down
    const hp = new Biquad().hp(2000, 0.7, sr);
    for (let k = 0; k < 60; k++) {
      const t = rr(r, 0.4, 1.7);
      const tick = alloc(sr, 0.006);
      for (let i = 0; i < tick.length; i++) tick[i] = hp.process(white(r)) * Math.exp(-i / sr / 0.0015);
      mixInto(out, tick, t * sr, rr(r, 0.05, 0.2) * (1.9 - t));
    }
  }
  return out;
}

export const splash: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    return finish(splashCore(sr, makeRng(0x5a1a + v * 173), false), sr);
  },
};

export const splash_big: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    return finish(splashCore(sr, makeRng(0x5a1b + v * 179), true), sr, { target: -12 });
  },
};

/** Two or three brisk brush strokes with a few bubbles. */
export const scrub: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x5c2b + v * 211);
    const n = ri(r, 2, 3);
    const out = alloc(sr, n * 0.17 + 0.2);
    let t = 0.005;
    for (let k = 0; k < n; k++) {
      const d = rr(r, 0.09, 0.14);
      mixInto(out, scrubStroke(sr, d, r), t * sr, rr(r, 0.8, 1));
      t += d + rr(r, 0.01, 0.04);
    }
    for (let k = 0; k < ri(r, 2, 5); k++) mixInto(out, bubble(sr, rr(r, 700, 2400), rr(r, 0.03, 0.06), rr(r, 0.6, 1.5), r), rr(r, 0, t) * sr, rr(r, 0.2, 0.35));
    return finish(out, sr);
  },
};

/** Seamless ~2.4 s loop: sloshing water bed + streams of bubbles + rhythmic scrubbing. */
export const wash_loop: Recipe = {
  variants: 1,
  sr: SR,
  loop: true,
  render(v, sr) {
    const r = makeRng(0xa5a5 + v * 1223);
    const L = 2.4;
    const X = 0.35;
    const N = Math.floor((L + X) * sr);
    const bed = new Float32Array(N);
    const pink = new Pink();
    const bp = new Biquad();
    const wand = new Wander(r);
    const slosh = new Wander(r);
    for (let i = 0; i < N; i++) {
      const c = 1300 + 700 * wand.next(0.8, sr);
      if ((i & 63) === 0) bp.bp(c, 0.8, sr);
      const s = 0.55 + 0.45 * slosh.next(2.2, sr);
      bed[i] = bp.process(pink.next(white(r))) * s * 1.2;
    }
    const loop = seamlessLoop(bed, sr, L, X);
    const nb = Math.round(L * rr(r, 16, 20));
    for (let k = 0; k < nb; k++) {
      mixIntoWrapped(loop, bubble(sr, rr(r, 500, 2600), rr(r, 0.02, 0.07), rr(r, 0.6, 1.8), r), rr(r, 0, L) * sr, rr(r, 0.15, 0.45));
    }
    for (let k = 0; k < 8; k++) {
      mixIntoWrapped(loop, scrubStroke(sr, rr(r, 0.1, 0.16), r), (k * (L / 8) + rr(r, -0.03, 0.03) + L) * sr, rr(r, 0.25, 0.4));
    }
    return finishLoop(loop, sr, -17);
  },
};

/** Seamless 6 s loop of gentle lapping water (bay / pond / fountain basin). */
export const water_loop: Recipe = {
  variants: 1,
  sr: 32000,
  loop: true,
  render(v, sr) {
    const r = makeRng(0x3a7e + v * 997);
    const L = 6;
    const X = 0.8;
    const N = Math.floor((L + X) * sr);
    const bed = new Float32Array(N);
    const pink = new Pink();
    const lp = new Biquad().lp(900, 0.7, sr);
    const hp = new Biquad().hp(90, 0.7, sr);
    const w = new Wander(r);
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const swell = 0.55 + 0.25 * Math.sin((TAU * t) / 3) + 0.2 * w.next(0.7, sr);
      bed[i] = hp.process(lp.process(pink.next(white(r)))) * swell;
    }
    const loop = seamlessLoop(bed, sr, L, X);
    for (let k = 0; k < 4; k++) {
      const d = rr(r, 0.35, 0.6);
      const lap = alloc(sr, d);
      const bpf = new Biquad().bp(rr(r, 500, 1000), 1, sr);
      for (let i = 0; i < lap.length; i++) lap[i] = bpf.process(white(r)) * hann(i / sr, d) * 1.6;
      const t0 = k * 1.5 + rr(r, 0, 0.5);
      mixIntoWrapped(loop, lap, t0 * sr, rr(r, 0.5, 0.9));
      for (let b = 0; b < ri(r, 1, 3); b++) mixIntoWrapped(loop, bubble(sr, rr(r, 600, 1600), rr(r, 0.03, 0.06), 1, r), (t0 + d * 0.6 + rr(r, 0, 0.3)) * sr, rr(r, 0.1, 0.2));
    }
    return finishLoop(loop, sr, -21);
  },
};

/** Sugar dissolving: dense fizzy crackle that thins out (cotton candy meets water). */
export const fizz: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xf122 + v * 419);
    const dur = rr(r, 0.9, 1.2);
    const out = alloc(sr, dur);
    const hp = new Biquad().hp(4000, 0.7, sr);
    const hiss = new Biquad().hp(5500, 0.7, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const density = 0.012 * Math.exp(-t / (dur * 0.45)) + 0.001;
      const imp = r() < density ? white(r) * 5 : 0;
      out[i] = (hp.process(imp) + hiss.process(white(r)) * 0.12) * ahr(t, 0.03, dur * 0.45, dur * 0.5);
    }
    for (let k = 0; k < 6; k++) mixInto(out, bubble(sr, rr(r, 2000, 4000), rr(r, 0.015, 0.03), 1, r), rr(r, 0, dur * 0.6) * sr, rr(r, 0.1, 0.2));
    return finish(out, sr, { target: -16 });
  },
};

/** Seamless 2 s loop for Tuck & Roll: fur-on-ground rumble with a per-revolution swish + pebble ticks. */
export const roll_loop: Recipe = {
  variants: 1,
  sr: 32000,
  loop: true,
  render(v, sr) {
    const r = makeRng(0x7011 + v * 13);
    const L = 2;
    const X = 0.3;
    const N = Math.floor((L + X) * sr);
    const bed = new Float32Array(N);
    const brown = new Brown();
    const pink = new Pink();
    const lp = new Biquad().lp(240, 0.8, sr);
    const bp = new Biquad().bp(1300, 0.8, sr);
    const hp = new OnePole().set(35, sr);
    const rot = 2.5; // revolutions per second at playbackRate 1 (5 per loop -> periodic)
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      const ph = TAU * rot * t;
      const rumble = lp.process(brown.next(white(r))) * (0.7 + 0.3 * Math.sin(ph)) * 1.6;
      const swish = bp.process(pink.next(white(r))) * Math.pow(0.5 + 0.5 * Math.sin(ph + 1), 2) * 0.9;
      bed[i] = hp.hp(rumble + swish);
    }
    const loop = seamlessLoop(bed, sr, L, X);
    for (let k = 0; k < 12; k++) {
      const tick = alloc(sr, 0.004);
      const thp = new Biquad().hp(2500, 0.7, sr);
      for (let i = 0; i < tick.length; i++) tick[i] = thp.process(white(r)) * Math.exp(-i / sr / 0.0008);
      mixIntoWrapped(loop, tick, rr(r, 0, L) * sr, rr(r, 0.05, 0.25));
    }
    return finishLoop(loop, sr, -17);
  },
};
