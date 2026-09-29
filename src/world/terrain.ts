/**
 * Pure terrain/map constants shared by every world builder.
 * +X = east, -Z = north, +Y = up. Map playable area is roughly [-180, 180] on X and Z.
 */
export const MAP = {
  /** Half size of the playable map. */
  half: 180,
  /** Terrain mesh/collider half size (a bit bigger than the playable map). */
  terrainHalf: 260,
  /** Terrain grid resolution in meters. */
  cell: 2,
  /** Seawall line: water (Salmon Bay) is south of this (z greater). */
  seawallZ: 166,
  bayY: -1.3,
  seabedY: -7,
  /** Zone size (3×3 grid of zones). */
  zone: 120,
  /** Main avenues (x or z coords of road centerlines) between zones. */
  roads: [-60, 60],
  roadWidth: 12,
  /** Park pond. */
  pond: { x: -120, z: 10, r: 15, depth: 2.2, waterY: -0.35 },
};

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth01 = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

/** Zone centers: [col, row] with col -1..1 (W..E), row -1..1 (N..S). */
export function zoneCenter(col: number, row: number): { x: number; z: number } {
  return { x: col * MAP.zone, z: row * MAP.zone };
}

/** Ground height at (x, z). Deterministic, cheap. */
export function terrainHeight(x: number, z: number): number {
  let h = 0;
  // North: residential hills rise from z = -55 to z = -175 (+16 m), then keep rising gently
  const hill = smooth01((-58 - z) / 110);
  h += hill * 15 + Math.max(0, -175 - z) * 0.35;
  h += hill * (Math.sin(x * 0.031) * 1.2 + Math.sin(x * 0.07 + 1.3) * 0.5);
  // East/West map edges: gentle berms so the world feels bounded
  const edge = Math.max(Math.abs(x) - 188, 0);
  // (capped: uncapped they rose ~100 m at the terrain edge and read as a giant green wall)
  h += Math.min(edge * edge * 0.02, 26);
  // South: drop into Salmon Bay past the seawall
  if (z > MAP.seawallZ - 1) {
    const s = smooth01((z - (MAP.seawallZ - 1)) / 5);
    h = h * (1 - s) + MAP.seabedY * s;
  }
  // Park pond depression
  const p = MAP.pond;
  const dp = Math.hypot(x - p.x, z - p.z);
  if (dp < p.r + 6) {
    const k = smooth01((p.r + 5 - dp) / 8);
    let d = k * p.depth;
    // The little sandy beach (south-west shore, the gap in the rim stones at ~100°..140°): a long, eased shelf instead
    // of the 8 m drop. It meets the pond surface right at the water disc's edge (r + 1.5; the old slope dipped
    // below the surface ~1.5 m outside the disc, a dry step at the waterline) and eases down to the bed over ~14 m.
    const bw = pondBeachWeight(x - p.x, z - p.z);
    if (bw > 0) {
      const u = clamp01((p.r + 6 - dp) / 14);
      const s = u * u * (3 - 2 * u);
      d = d * (1 - bw) + Math.pow(s, 1.35) * p.depth * bw;
    }
    h -= d;
  }
  return h;
}

/** 0..1: how much (dx, dz) from the pond centre is on the pond's sandy beach (full 110°..130°, fading out by 99°/141°). */
function pondBeachWeight(dx: number, dz: number): number {
  const deg = (Math.atan2(dz, dx) * 180) / Math.PI;
  return smooth01((deg - 99) / 11) * smooth01((141 - deg) / 11);
}

/** True if (x, z) is on one of the main avenue road strips (flat & driveable). */
export function onMainRoad(x: number, z: number): boolean {
  const w = MAP.roadWidth / 2;
  for (const r of MAP.roads) {
    if (Math.abs(x - r) < w || Math.abs(z - r) < w) return Math.abs(x) < MAP.half && Math.abs(z) < MAP.seawallZ;
  }
  return false;
}
