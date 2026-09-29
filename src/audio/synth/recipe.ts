import { dcBlock, fadeEdges, normalize, type Rendered } from './dsp';

/** A procedural sound: renders variation `v` (0..variants-1) at sample rate `sr`. */
export interface Recipe {
  /** Number of distinct variations. */
  variants: number;
  /** Sample rate to render at (lower = cheaper; AudioBuffers are resampled on playback). */
  sr: number;
  /** Seamless loop (no trimming / fades applied by finish()). */
  loop?: boolean;
  render(v: number, sr: number): Rendered;
}

export interface FinishOpts {
  /** Loudest-50ms-window RMS target in dBFS (default -13). */
  target?: number;
  /** Peak ceiling (default 0.9 ≈ -1 dBFS). */
  peak?: number;
  /** Trim trailing silence (default true). */
  trim?: boolean;
  /** Fade-out length in seconds (default 0.008). */
  fadeOut?: number;
}

/** Standard post-processing for one-shot sounds: DC block, trim tail, de-click edges, loudness normalize. */
export function finish(x: Rendered, sr: number, o: FinishOpts = {}): Rendered {
  let chans = Array.isArray(x) ? [x[0], x[1]] : [x];
  for (const c of chans) dcBlock(c);
  if (o.trim !== false) {
    let end = 0;
    for (const c of chans) {
      let e = c.length - 1;
      while (e > 0 && Math.abs(c[e]) < 0.0006) e--;
      end = Math.max(end, e);
    }
    const n = Math.min(chans[0].length, end + 1 + Math.floor(0.015 * sr));
    if (n < chans[0].length - 8) chans = chans.map((c) => c.slice(0, n));
  }
  for (const c of chans) fadeEdges(c, sr, 0.0008, o.fadeOut ?? 0.008);
  const out: Rendered = chans.length === 2 ? [chans[0], chans[1]] : chans[0];
  return normalize(out, sr, o.target ?? -13, o.peak ?? 0.9);
}

/** Post-processing for loops: remove DC (a constant offset keeps the loop seamless) and normalize. */
export function finishLoop(x: Rendered, sr: number, target = -18): Rendered {
  for (const c of Array.isArray(x) ? x : [x]) {
    let m = 0;
    for (let i = 0; i < c.length; i++) m += c[i];
    m /= Math.max(1, c.length);
    for (let i = 0; i < c.length; i++) c[i] -= m;
  }
  return normalize(x, sr, target, 0.9);
}
