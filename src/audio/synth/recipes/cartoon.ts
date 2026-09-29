/**
 * Slapstick & cartoon SFX: boing, whooshes, bonk, yoink, sad trombone, camera shutter, clown honk,
 * glass shards, sparkles, cha-ching, claws, rummaging, flops.
 */
import {
  ahr,
  alloc,
  Biquad,
  drive,
  hann,
  makeRng,
  mixInto,
  mtof,
  OnePole,
  Osc,
  panInto,
  perc,
  Pink,
  pw,
  pwExp,
  reverb,
  ri,
  rr,
  TAU,
  toMono,
  white,
  type Rng,
  type Stereo,
} from '../dsp';
import { finish, type Recipe } from '../recipe';

const SR = 44100;

/** FM bell partial (used by sparkle / cha-ching / jingles). */
export function bell(sr: number, f: number, dur: number, r: Rng, o: { ratio?: number; index?: number; tau?: number } = {}): Float32Array {
  const out = alloc(sr, dur);
  const ratio = o.ratio ?? 3.5;
  const index = o.index ?? 2.2;
  const tau = o.tau ?? dur / 4;
  let pc = r();
  let pm = r();
  const dc = f / sr;
  const dm = (f * ratio) / sr;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const idx = index * Math.exp(-t / (tau * 0.6));
    out[i] = Math.sin(TAU * pc + idx * Math.sin(TAU * pm)) * perc(t, 0.002, tau);
    pc += dc;
    pm += dm;
    if (pc >= 1) pc -= 1;
    if (pm >= 1) pm -= 1;
  }
  return out;
}

/** Band-passed noise whoosh with a moving centre frequency. */
function whooshCore(sr: number, r: Rng, dur: number, f: readonly [number, number, number], q: number, peakAt: number, tone = 0.08): Float32Array {
  const out = alloc(sr, dur);
  const bp = new Biquad();
  const body = new Biquad();
  const pink = new Pink();
  const osc = new Osc();
  const centre = pwExp([
    [0, f[0]],
    [dur * peakAt, f[1]],
    [dur, f[2]],
  ]);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const c = centre(t);
    if ((i & 15) === 0) {
      bp.bp(c, q, sr);
      body.lp(c * 0.6, 0.7, sr);
    }
    const u = t / dur;
    const env = u < peakAt ? Math.pow(u / peakAt, 1.6) : Math.pow(1 - (u - peakAt) / (1 - peakAt), 1.3);
    const w = white(r);
    out[i] = (bp.process(w) * 1.4 + body.process(pink.next(white(r))) * 0.35 + osc.sine(c, sr) * tone) * env;
  }
  return out;
}

export const whoosh: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x3005 + v * 97);
    const dur = rr(r, 0.35, 0.6);
    return finish(whooshCore(sr, r, dur, [rr(r, 250, 400), rr(r, 1300, 2200), rr(r, 400, 650)], rr(r, 1.8, 3), rr(r, 0.35, 0.5)), sr);
  },
};

export const throw_: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x7400 + v * 89);
    const dur = rr(r, 0.2, 0.28);
    return finish(whooshCore(sr, r, dur, [rr(r, 600, 800), rr(r, 2200, 3000), rr(r, 1000, 1400)], 3, 0.4, 0.05), sr);
  },
};

/** Spring "boiiing": buzzy jaw-harp-ish tone with a decaying pitch wobble. */
export const boing: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xb017 + v * 61);
    const base = [170, 220, 280, 340][v % 4] * rr(r, 0.95, 1.05);
    const dur = rr(r, 0.6, 0.9);
    const wob = rr(r, 11, 16);
    const out = alloc(sr, dur * 1.9);
    const osc = new Osc();
    const bp = new Biquad();
    const harm = [1, 0.6, 0.45, 0.3, 0.2, 0.12, 0.08];
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = base * (1 + 0.35 * (t / dur)) * (1 + 0.28 * Math.exp(-t / 0.25) * Math.sin(TAU * wob * t));
      if ((i & 15) === 0) bp.bp(f * 4, 3, sr);
      const s = osc.harmonics(f, sr, harm);
      const twang = bp.process(s) * 2.2;
      const pluck = t < 0.004 ? white(r) * (1 - t / 0.004) * 0.6 : 0;
      out[i] = (s * 0.5 + twang + pluck) * perc(t, 0.003, dur * 0.35);
    }
    return finish(out, sr);
  },
};

/** Quick cartoon "bwip" for jumping. */
export const jump: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x1a4b + v * 37);
    const out = alloc(sr, 0.3);
    const osc = new Osc();
    const f0 = rr(r, 230, 300);
    const f1 = f0 * rr(r, 2.4, 3);
    const sw = rr(r, 0.08, 0.13);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const f = f0 * Math.pow(f1 / f0, Math.min(1, t / sw));
      out[i] = osc.sine(f, sr) * 0.8 * perc(t, 0.004, 0.06);
    }
    mixInto(out, whooshCore(sr, r, 0.16, [600, 2200, 1200], 2.5, 0.35, 0), 0, 0.35);
    return finish(out, sr, { target: -15 });
  },
};

/** Hollow cartoon BONK: inharmonic wood-block partials with a pitch drop, click, and a thud. */
export const bonk: Recipe = {
  variants: 5,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xb04c + v * 53);
    const f = rr(r, 320, 520);
    const out = alloc(sr, 0.45);
    const parts = [
      { k: 1, a: 1, tau: rr(r, 0.14, 0.2), osc: new Osc() },
      { k: rr(r, 2.6, 2.9), a: 0.5, tau: 0.07, osc: new Osc() },
      { k: rr(r, 5.1, 5.6), a: 0.25, tau: 0.035, osc: new Osc() },
    ];
    const thud = new Osc();
    const clk = new Biquad().bp(3000, 1, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const drop = 1 - 0.09 * (1 - Math.exp(-t / 0.03));
      let s = 0;
      for (const p of parts) s += p.osc.sine(f * p.k * drop, sr) * p.a * perc(t, 0.0015, p.tau);
      s += clk.process(white(r)) * Math.exp(-t / 0.002) * 1.5;
      s += thud.sine(70 + 60 * Math.exp(-t / 0.02), sr) * perc(t, 0.001, 0.05) * 0.6;
      out[i] = s;
    }
    return finish(drive(out, 1.6), sr);
  },
};

/** Baseball bat crack (Rookie mutator home-run bonk), with a stadium slap-back. */
export const bat_crack: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xba7c + v * 71);
    const out = alloc(sr, 0.6);
    const f = rr(r, 1050, 1400);
    const o1 = new Osc();
    const o2 = new Osc();
    const o3 = new Osc();
    const hp = new Biquad().hp(800, 0.7, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      out[i] =
        hp.process(white(r)) * perc(t, 0.0003, 0.004) * 1.2 +
        o1.sine(f, sr) * perc(t, 0.0005, 0.045) * 0.8 +
        o2.sine(f * 2.43, sr) * perc(t, 0.0005, 0.02) * 0.4 +
        o3.sine(180, sr) * perc(t, 0.001, 0.05) * 0.5;
    }
    const echo = out.slice(0, Math.floor(0.2 * sr));
    const lp = new OnePole().set(2500, sr);
    for (let i = 0; i < echo.length; i++) echo[i] = lp.lp(echo[i]);
    mixInto(out, echo, 0.11 * sr, 0.22);
    return finish(out, sr);
  },
};

/** Ragdoll flop: soft body "floomp" with a small bounce and fur flutter. */
export const flop: Recipe = {
  variants: 3,
  sr: 32000,
  render(v, sr) {
    const r = makeRng(0xf10b + v * 29);
    const out = alloc(sr, 0.6);
    const one = (t0: number, g: number) => {
      const s = alloc(sr, 0.35);
      const lp = new Biquad().lp(rr(r, 600, 900), 0.8, sr);
      const pink = new Pink();
      const osc = new Osc();
      const fl = new Biquad().bp(1500, 1.2, sr);
      for (let i = 0; i < s.length; i++) {
        const t = i / sr;
        s[i] =
          lp.process(pink.next(white(r))) * perc(t, 0.006, 0.1) * 1.5 +
          osc.sine(60 + 40 * Math.exp(-t / 0.04), sr) * perc(t, 0.004, 0.08) * 0.8 +
          fl.process(white(r)) * (0.5 + 0.5 * Math.sin(TAU * 24 * t)) * perc(t, 0.01, 0.12) * 0.3;
      }
      mixInto(out, s, t0 * sr, g);
    };
    one(0, 1);
    one(rr(r, 0.11, 0.16), rr(r, 0.3, 0.5));
    return finish(out, sr);
  },
};

/** "Yoink!" slide-whistle up plus a tiny pluck. */
export const steal: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x5731 + v * 43);
    const dur = rr(r, 0.28, 0.34);
    const out = alloc(sr, dur + 0.2);
    const fA = rr(r, 450, 600);
    const fB = rr(r, 1400, 1800);
    const f = pwExp([
      [0, fA],
      [dur * 0.62, fB],
      [dur, fB * 1.06],
    ]);
    const osc = new Osc();
    const nb = new Biquad();
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const fr = f(t) * (1 + 0.015 * Math.sin(TAU * 7 * t));
      if ((i & 15) === 0) nb.bp(fr, 8, sr);
      const tone = osc.harmonics(fr, sr, [1, 0.18, 0.05]);
      out[i] = (tone + nb.process(white(r)) * 0.9) * ahr(t, 0.02, dur - 0.1, 0.08);
    }
    const pluck = new Osc();
    const p = alloc(sr, 0.12);
    for (let i = 0; i < p.length; i++) p[i] = pluck.sine(fB * 1.5, sr) * perc(i / sr, 0.001, 0.025);
    mixInto(out, p, dur * 0.62 * sr, 0.4);
    return finish(out, sr);
  },
};

/** Claws scrabbling on bark / brick while climbing. */
export const climb: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xc11b + v * 101);
    const n = ri(r, 4, 7);
    const out = alloc(sr, n * 0.1 + 0.15);
    let t = 0.005;
    for (let k = 0; k < n; k++) {
      const d = rr(r, 0.03, 0.06);
      const s = alloc(sr, d);
      const bp = new Biquad().bp(rr(r, 2500, 5000), 1.5, sr);
      for (let i = 0; i < s.length; i++) {
        const grain = r() < 0.12 ? white(r) * 2.5 : white(r) * 0.4;
        s[i] = bp.process(grain) * hann(i / sr, d);
      }
      mixInto(out, s, t * sr, rr(r, 0.6, 1));
      if (r() < 0.35) {
        const tk = alloc(sr, 0.02);
        const o = new Osc();
        const tf = rr(r, 800, 1200);
        for (let i = 0; i < tk.length; i++) tk[i] = o.sine(tf, sr) * perc(i / sr, 0.0005, 0.006);
        mixInto(out, tk, (t + d * 0.3) * sr, 0.35);
      }
      t += rr(r, 0.05, 0.09);
    }
    return finish(out, sr, { target: -15 });
  },
};

/** Dumpster diving: crinkly bags, bottle clinks, soft thumps. */
export const rummage: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x2a3e + v * 107);
    const dur = rr(r, 1.1, 1.4);
    const out = alloc(sr, dur + 0.2);
    const crinkles = ri(r, 15, 25);
    for (let k = 0; k < crinkles; k++) {
      const d = rr(r, 0.03, 0.08);
      const s = alloc(sr, d);
      const hp = new Biquad().hp(rr(r, 1800, 3000), 0.7, sr);
      const dens = rr(r, 0.03, 0.08);
      for (let i = 0; i < s.length; i++) s[i] = hp.process(r() < dens ? white(r) * 3 : white(r) * 0.15) * hann(i / sr, d);
      mixInto(out, s, rr(r, 0, dur - d) * sr, rr(r, 0.4, 1));
    }
    for (let k = 0; k < ri(r, 2, 4); k++) {
      const f = rr(r, 2000, 3800);
      const s = alloc(sr, 0.25);
      const a = new Osc();
      const b = new Osc();
      for (let i = 0; i < s.length; i++) {
        const t = i / sr;
        s[i] = (a.sine(f, sr) + 0.5 * b.sine(f * 2.7, sr)) * perc(t, 0.0005, 0.05);
      }
      mixInto(out, s, rr(r, 0.05, dur - 0.2) * sr, rr(r, 0.25, 0.45));
    }
    for (let k = 0; k < ri(r, 2, 3); k++) {
      const s = alloc(sr, 0.15);
      const lp = new Biquad().lp(260, 0.8, sr);
      for (let i = 0; i < s.length; i++) s[i] = lp.process(white(r)) * perc(i / sr, 0.004, 0.04) * 3;
      mixInto(out, s, rr(r, 0, dur - 0.15) * sr, rr(r, 0.5, 0.9));
    }
    return finish(out, sr);
  },
};

/** "Wah wah wah waaah" — plunger-muted trombone, descending semitones, wobbly last note. */
export const sad_trombone: Recipe = {
  variants: 2,
  sr: 32000,
  render(v, sr) {
    const r = makeRng(0x5ad0 + v * 7);
    const start = v === 0 ? 55 : 58; // G3 or Bb3
    const notes = [start, start - 1, start - 2, start - 3];
    const durs = [0.34, 0.34, 0.34, 1.55];
    const total = durs.reduce((a, b) => a + b, 0) + 0.12 + 0.5;
    const out = alloc(sr, total);
    let t0 = 0.02;
    for (let n = 0; n < 4; n++) {
      const last = n === 3;
      const d = durs[n];
      const f = mtof(notes[n]);
      const s = alloc(sr, d + 0.3);
      const o1 = new Osc(r());
      const o2 = new Osc(r());
      const lp = new Biquad();
      const breath = new Biquad().bp(1200, 0.8, sr);
      const rel = last ? 0.3 : 0.06;
      for (let i = 0; i < s.length; i++) {
        const t = i / sr;
        const scoop = 1 - 0.06 * Math.exp(-t / 0.03);
        let vib = 0;
        let cutoff: number;
        if (!last) {
          cutoff = t < 0.1 ? 300 + (1500 * t) / 0.1 : Math.max(600, 1800 - (t - 0.1) * 3500);
        } else {
          const depth = Math.min(1, Math.max(0, (t - 0.25) / 0.35));
          vib = 0.022 * depth * Math.sin(TAU * 5.3 * t);
          const wah = 0.5 + 0.5 * Math.sin(TAU * 5.3 * t - 1.2);
          cutoff = t < 0.12 ? 300 + (1400 * t) / 0.12 : 700 + (1100 * depth + 500 * (1 - depth)) * wah;
          if (t > d - 0.45) vib -= 0.05 * ((t - (d - 0.45)) / 0.45); // final droop
        }
        if ((i & 15) === 0) lp.lp(cutoff, 2.2, sr);
        const fr = f * scoop * (1 + vib);
        const src = o1.saw(fr, sr) * 0.7 + o2.saw(fr * 1.003, sr) * 0.3;
        const env = ahr(t, 0.025, d - 0.06, rel);
        s[i] = (lp.process(src) + breath.process(white(r)) * 0.04) * env;
      }
      mixInto(out, s, t0 * sr);
      t0 += d + 0.035;
    }
    const st: Stereo = reverb(drive(out, 1.3), sr, { size: 0.55, damp: 0.5, wet: 0.18, tailSec: 0.5 });
    return finish(st, sr, { target: -12 });
  },
};

function shutterClick(sr: number, r: Rng, pingHz: number, g = 1): Float32Array {
  const out = alloc(sr, 0.04);
  const hp = new Biquad().hp(1500, 0.7, sr);
  const ping = new Osc();
  const knock = new Osc();
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = (hp.process(white(r)) * perc(t, 0.0003, 0.0015) * 1.2 + ping.sine(pingHz, sr) * perc(t, 0.0005, 0.008) * 0.5 + knock.sine(180, sr) * perc(t, 0.0005, 0.01) * 0.6) * g;
  }
  return out;
}

/** Camera shutters (fans filming): DSLR, phone fake-shutter, click+whirr, burst mode. */
export const camera_shutter: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xca3e + v * 17);
    const out = alloc(sr, 0.45);
    const p1 = rr(r, 2600, 4200);
    const p2 = rr(r, 2200, 3600);
    const kind = v % 4;
    if (kind === 0) {
      mixInto(out, shutterClick(sr, r, p1), 0);
      mixInto(out, shutterClick(sr, r, p2, 0.8), rr(r, 0.07, 0.1) * sr);
    } else if (kind === 1) {
      mixInto(out, shutterClick(sr, r, p1 * 1.2, 0.8), 0);
      mixInto(out, shutterClick(sr, r, p2 * 1.2, 0.7), 0.05 * sr);
      const tk = new Osc();
      const s = alloc(sr, 0.03);
      for (let i = 0; i < s.length; i++) s[i] = tk.square(1800, sr, 0.5) * perc(i / sr, 0.0005, 0.004) * 0.15;
      mixInto(out, s, 0.1 * sr);
    } else if (kind === 2) {
      mixInto(out, shutterClick(sr, r, p1), 0);
      const w = alloc(sr, 0.16);
      const o = new Osc();
      const bp = new Biquad().bp(1200, 2, sr);
      for (let i = 0; i < w.length; i++) w[i] = bp.process(o.saw(70 + 15 * Math.sin((TAU * i) / sr / 0.16), sr)) * ahr(i / sr, 0.01, 0.12, 0.02);
      mixInto(out, w, 0.06 * sr, 0.35);
      mixInto(out, shutterClick(sr, r, p2, 0.6), 0.23 * sr);
    } else {
      for (let k = 0; k < 3; k++) mixInto(out, shutterClick(sr, r, p1 * rr(r, 0.95, 1.05), 0.9), k * 0.09 * sr);
    }
    return finish(out, sr, { target: -15 });
  },
};

/** Clown / bike bulb horn "HONK" (single or double). */
export const honk: Recipe = {
  variants: 4,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x40a4 + v * 19);
    const out = alloc(sr, 0.8);
    const f = rr(r, 360, 460);
    const one = (t0: number, d: number, ff: number) => {
      const s = alloc(sr, d + 0.02);
      const o = new Osc();
      const f1 = new Biquad().peak(1100, 3, 10, sr);
      const f2 = new Biquad().peak(2400, 4, 6, sr);
      const lp = new Biquad().lp(5000, 0.7, sr);
      const pitch = pw([
        [0, 0.8],
        [0.03, 1.02],
        [d * 0.7, 1],
        [d, 0.93],
      ]);
      for (let i = 0; i < s.length; i++) {
        const t = i / sr;
        const x = o.square(ff * pitch(t), sr, 0.35);
        s[i] = lp.process(f2.process(f1.process(x))) * ahr(t, 0.01, d - 0.06, 0.05);
      }
      mixInto(out, drive(s, 2), t0 * sr);
    };
    if (v % 2 === 0) one(0.003, rr(r, 0.26, 0.32), f);
    else {
      one(0.003, 0.19, f);
      one(0.28, 0.21, f * rr(r, 0.97, 1.03));
    }
    return finish(out, sr);
  },
};

/** Glass fragments tinkling down (layered under glass_break). */
export const glass_shards: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x91a5 + v * 23);
    const out = alloc(sr, 1);
    const hp = new Biquad().hp(2500, 0.7, sr);
    for (let i = 0; i < 0.08 * sr; i++) out[i] += hp.process(white(r)) * perc(i / sr, 0.0005, 0.03) * 0.6;
    const n = ri(r, 25, 40);
    for (let k = 0; k < n; k++) {
      const t = Math.pow(r(), 1.8) * 0.7;
      const f = rr(r, 2500, 9000);
      const tau = rr(r, 0.02, 0.08);
      const s = alloc(sr, tau * 5);
      const a = new Osc(r());
      const b = new Osc(r());
      for (let i = 0; i < s.length; i++) s[i] = (a.sine(f, sr) + 0.4 * b.sine(f * 2.3, sr)) * perc(i / sr, 0.0003, tau);
      mixInto(out, s, t * sr, rr(r, 0.1, 0.35) * (1 - t));
    }
    return finish(out, sr);
  },
};

/** Clean-and-shiny sparkle: ascending bell arpeggio + glitter (stereo). */
export const sparkle: Recipe = {
  variants: 3,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0x59a7 + v * 31);
    const out: Stereo = [alloc(sr, 1.1), alloc(sr, 1.1)];
    const roots = [84, 86, 81]; // C6, D6, A5
    const steps = [0, 4, 7, 12, 16];
    for (let k = 0; k < steps.length; k++) {
      const b = bell(sr, mtof(roots[v % 3] + steps[k]), 0.6, r, { ratio: 3.5, index: 1.4, tau: 0.18 });
      panInto(out, b, (0.012 + k * 0.045) * sr, -0.6 + (1.2 * k) / (steps.length - 1), 0.5);
    }
    for (let k = 0; k < 22; k++) {
      const f = rr(r, 5000, 10000);
      const s = alloc(sr, 0.08);
      const o = new Osc(r());
      for (let i = 0; i < s.length; i++) s[i] = o.sine(f, sr) * perc(i / sr, 0.0005, 0.015);
      panInto(out, s, rr(r, 0, 0.7) * sr, rr(r, -0.9, 0.9), rr(r, 0.1, 0.3));
    }
    const wet = reverb(toMono(out), sr, { size: 0.6, wet: 0.35, dry: 0, tailSec: 0.4 });
    for (let c = 0; c < 2; c++) mixInto(out[c], wet[c], 0, 1);
    return finish(out, sr, { target: -15 });
  },
};

/** Cash register "cha-ching" (Money Laundering!). */
export const cha_ching: Recipe = {
  variants: 2,
  sr: SR,
  render(v, sr) {
    const r = makeRng(0xc4a0 + v * 3);
    const out = alloc(sr, 1.2);
    const bp = new Biquad().bp(2500, 0.8, sr);
    const clickOsc = new Osc();
    for (let i = 0; i < 0.07 * sr; i++) {
      const t = i / sr;
      out[i] += bp.process(white(r)) * perc(t, 0.001, 0.02) * 1.2 + clickOsc.square(700, sr) * perc(t, 0.0005, 0.004) * 0.3;
    }
    const b1 = bell(sr, v === 0 ? 2093 : 2349, 1, r, { ratio: 2.76, index: 1.2, tau: 0.3 });
    const b2 = bell(sr, v === 0 ? 2637 : 2960, 1, r, { ratio: 2.76, index: 1.2, tau: 0.25 });
    mixInto(out, b1, 0.08 * sr, 0.7);
    mixInto(out, b2, 0.085 * sr, 0.55);
    for (let k = 0; k < 5; k++) {
      const s = bell(sr, rr(r, 3000, 5000), 0.1, r, { ratio: 1.9, index: 0.8, tau: 0.02 });
      mixInto(out, s, rr(r, 0.12, 0.35) * sr, 0.15);
    }
    return finish(out, sr);
  },
};
