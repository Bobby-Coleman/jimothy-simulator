/**
 * THE BIG ROLL — course data. Pure constants (no THREE), shared by the system, the builder and the HUD.
 *
 * Map: +X east, -Z north. The start is the roof of Hilltop Lanes (a retro bowling alley built by BigRollBuild.ts on the
 * lawn behind the Furry Park viewpoint, top of the Residential Hills). A kicker ramp on the roof launches Jimothy over
 * the viewpoint onto Tumble St; the course then rolls down the hill, through Old Ballard's farmers market and back
 * alley, across the avenue into Downtown, round the Space Noodle lawn and City Hall, and finishes at a set of giant
 * pins on the boulevard south of City Hall.
 */

/** Hilltop Lanes footprint (x0..x1, z0..z1) and roof height (absolute y). */
export const LANES = { x0: -8, x1: 8, z0: -179, z1: -169, roofY: 24 };

/** West-side staircase: x range, bottom z (ground) → top z (roof level). */
export const STAIR = { x0: -10.7, x1: -8.1, zBottom: -166.9, zTop: -177.4 };

/** Start pad on the roof (centre, radius). The race heads south (+z). */
export const START = { x: 0, z: -177.2, r: 1.9, facing: 0 };

/** Kicker ramp on the roof's south edge: x half-width, z from (roof level) → to (lip), lip rise. */
export const KICKER = { hw: 3.4, zFrom: -172.8, zTo: -169.15, rise: 1.25 };

export interface GateDef {
  /** Short label shown on the HUD and above the gate. */
  name: string;
  x: number;
  z: number;
  /** Ring radius = pass radius (m). */
  r: number;
  /** Quip on passing it. */
  quip: string;
}

/** Checkpoints in order; the last one is the finish line. */
export const GATES: GateDef[] = [
  { name: 'Air Mail', x: 0, z: -137, r: 5.5, quip: 'Stuck the landing. Sort of.' },
  { name: 'Speed Trap', x: 0, z: -96, r: 5, quip: '' }, // quip = the radar reading (see BigRoll.ts)
  { name: 'Farmers Market', x: -26, z: -41, r: 4.5, quip: 'Excuse me. Pardon me. Round coming through.' },
  { name: 'Back Alley', x: 18, z: -29, r: 4.5, quip: 'Smells like home.' },
  { name: 'Jaywalk', x: 64, z: -27, r: 5, quip: 'Look both ways! (He did not.)' },
  { name: 'Noodle Lawn', x: 148, z: -25, r: 5, quip: 'The tourists are filming. Tuck in your tummy. Oh wait.' },
  { name: 'City Hall Lap', x: 173, z: -2, r: 5, quip: 'Rolling past democracy at 40 mph.' },
  { name: 'The Pins', x: 104, z: 21, r: 5.5, quip: '' },
];

export type MedalId = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface Tier {
  id: MedalId;
  name: string;
  /** Finish time needed (s). Bronze = any finish inside the time limit. */
  time: number;
  color: string;
  objective: string;
}

/** Hard time limit: the lanes close (race cancelled). Finishing inside it = Bronze. */
export const TIME_LIMIT = 150;

/**
 * Medal times. Tuned against a scripted ideal line (tools/playtest.mjs `obj_bigRoll`, see QA_OBJECTIVES.md): the best
 * scripted run was 32.9 s (typical 33-34 s; the best splits of several runs add up to ~31.5 s), so Platinum (34 s)
 * needs the sprint roll held the whole way, a clean kicker launch, tight lines round every corner and no car, pole
 * or tourist in the way. Gold is ~20 % slower than that line, Silver ~60 %.
 */
export const TIERS: Tier[] = [
  { id: 'bronze', name: 'Bronze Pin', time: TIME_LIMIT, color: '#d08a4e', objective: 'bigRoll' },
  { id: 'silver', name: 'Silver Pin', time: 52, color: '#c9d3de', objective: 'bigRollSilver' },
  { id: 'gold', name: 'Gold Pin', time: 40, color: '#ffd23f', objective: 'bigRollGold' },
  { id: 'platinum', name: 'Platinum Pin', time: 34, color: '#9ff3ff', objective: 'bigRollPlatinum' },
];

export const MEDAL_RANK: Record<MedalId, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 };

/** Best medal for a finish time (clean run), or bronze only for assisted runs. */
export function medalFor(time: number, assisted: boolean): Tier {
  if (assisted) return TIERS[0];
  let best = TIERS[0];
  for (const t of TIERS) if (time <= t.time) best = t;
  return best;
}

export function fmtTime(t: number) {
  if (!isFinite(t)) return '--:--.-';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
