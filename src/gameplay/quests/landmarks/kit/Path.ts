import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Polyline with arc-length parametrisation (race tracks). */
export class Path {
  readonly pts: THREE.Vector3[];
  readonly cum: number[] = [0];
  readonly length: number;

  constructor(points: THREE.Vector3[]) {
    this.pts = points.map((p) => p.clone());
    let L = 0;
    for (let i = 1; i < this.pts.length; i++) {
      L += Math.hypot(this.pts[i].x - this.pts[i - 1].x, this.pts[i].z - this.pts[i - 1].z);
      this.cum.push(L);
    }
    this.length = L;
  }

  private seg(s: number) {
    let i = 0;
    while (i < this.cum.length - 2 && this.cum[i + 1] < s) i++;
    return i;
  }

  /** Position at arc length s (clamped). */
  at(s: number, out = new THREE.Vector3()) {
    s = THREE.MathUtils.clamp(s, 0, this.length);
    const i = this.seg(s);
    const a = this.pts[i];
    const b = this.pts[Math.min(i + 1, this.pts.length - 1)];
    const len = this.cum[i + 1] - this.cum[i] || 1;
    return out.lerpVectors(a, b, (s - this.cum[i]) / len);
  }

  /** Unit tangent (XZ) at s. */
  dir(s: number, out = new THREE.Vector3()) {
    s = THREE.MathUtils.clamp(s, 0, this.length);
    const i = this.seg(s);
    const a = this.pts[i];
    const b = this.pts[Math.min(i + 1, this.pts.length - 1)];
    out.set(b.x - a.x, 0, b.z - a.z);
    if (out.lengthSq() < 1e-8) out.set(0, 0, 1);
    return out.normalize();
  }

  /** Left-hand normal (XZ) at s: +offset shifts to the left of the running direction. */
  side(s: number, out = new THREE.Vector3()) {
    const d = this.dir(s, out);
    return out.set(d.z, 0, -d.x);
  }

  /**
   * Closest arc length to p, searching only segments overlapping [sMin, sMax].
   * Returns { s, dist } (horizontal distance).
   */
  project(p: THREE.Vector3, sMin = 0, sMax = Infinity): { s: number; dist: number } {
    let best = { s: THREE.MathUtils.clamp(sMin, 0, this.length), dist: Infinity };
    for (let i = 0; i < this.pts.length - 1; i++) {
      if (this.cum[i + 1] < sMin || this.cum[i] > sMax) continue;
      const a = _a.set(this.pts[i].x, 0, this.pts[i].z);
      const b = _b.set(this.pts[i + 1].x, 0, this.pts[i + 1].z);
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1;
      let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
      t = THREE.MathUtils.clamp(t, 0, 1);
      const x = a.x + abx * t;
      const z = a.z + abz * t;
      const d = Math.hypot(p.x - x, p.z - z);
      const s = THREE.MathUtils.clamp(this.cum[i] + Math.sqrt(len2) * t, sMin, sMax);
      if (d < best.dist) best = { s, dist: d };
    }
    return best;
  }

  /** Oval ("stadium") loop: two straights of length `straight` joined by semicircles of radius r. */
  static oval(center: THREE.Vector3, yaw: number, straight: number, r: number, stepDeg = 12): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const push = (lx: number, lz: number) => pts.push(new THREE.Vector3(center.x + lx * c + lz * s, center.y, center.z - lx * s + lz * c));
    const h = straight / 2;
    // start mid-way along the +x straight, heading +z
    push(r, 0);
    push(r, h);
    for (let a = stepDeg; a < 180; a += stepDeg) push(Math.cos((a * Math.PI) / 180) * r, h + Math.sin((a * Math.PI) / 180) * r);
    push(-r, h);
    push(-r, -h);
    for (let a = 180 + stepDeg; a < 360; a += stepDeg) push(Math.cos((a * Math.PI) / 180) * r, -h + Math.sin((a * Math.PI) / 180) * r);
    push(r, -h);
    push(r, 0);
    return pts;
  }

  /**
   * Arc around `center` from `from` to `to` (radius blends between the two), the long way round
   * unless `short`. Includes both endpoints.
   */
  static arc(center: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3, opts: { short?: boolean; stepDeg?: number; dirSign?: 1 | -1 } = {}) {
    const a0 = Math.atan2(from.z - center.z, from.x - center.x);
    let a1 = Math.atan2(to.z - center.z, to.x - center.x);
    const r0 = Math.hypot(from.x - center.x, from.z - center.z);
    const r1 = Math.hypot(to.x - center.x, to.z - center.z);
    let d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 0.05) d = opts.dirSign ? opts.dirSign * Math.PI * 2 : Math.PI * 2; // same point: full lap
    else if (opts.dirSign && Math.sign(d) !== opts.dirSign) d += opts.dirSign * Math.PI * 2;
    else if (!opts.short && !opts.dirSign) d = d > 0 ? d - Math.PI * 2 : d + Math.PI * 2; // long way
    a1 = a0 + d;
    const step = ((opts.stepDeg ?? 10) * Math.PI) / 180;
    const n = Math.max(2, Math.ceil(Math.abs(d) / step));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = a0 + d * t;
      const r = r0 + (r1 - r0) * t;
      pts.push(new THREE.Vector3(center.x + Math.cos(a) * r, from.y + (to.y - from.y) * t, center.z + Math.sin(a) * r));
    }
    pts[0].copy(from);
    pts[pts.length - 1].copy(to);
    return pts;
  }
}
