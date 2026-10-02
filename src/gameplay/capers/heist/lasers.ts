import * as THREE from 'three';
import { paintMesh, T, type Part } from '../shared';
import { F, HALL_Z, WALL_TOP, type Museum } from './build';

/**
 * The laser hallway: five stations along local x (doorway A at the west end → doorway B at the east end).
 *   1 HOP      one low beam                         → jump over it
 *   2 LIMBO    a stack of beams from 0.92 m up      → Tuck & Roll under it (walking Jimothy is too tall)
 *   3 BLINK    a full curtain that blinks on/off    → wait for it (it flickers just before coming back)
 *   4 SWEEP    one beam sliding up and down         → under it when high, over it when low
 *   5 SCANNER  a floor-to-ceiling beam sliding across the hallway → slip past on the other side
 * Beams are emissive (bloom), no lights. Hit tests treat Jimothy as a short vertical capsule (a ball while rolling).
 */

type Kind = 'static' | 'blink' | 'sweep' | 'scan';

interface Station {
  kind: Kind;
  x: number;
  heights: number[];
  group: THREE.Group;
  beams: THREE.Object3D[];
  on: boolean;
  /** Current sweep height (local, above floor) / scan z. */
  v: number;
}

const BLINK_ON = 1.5;
const BLINK_OFF = 1.35;
const SWEEP_T = 3.4;
const SCAN_T = 3.0;
const SCAN_TOP = 2.9;

export class LaserHall {
  readonly stations: Station[] = [];
  private core: THREE.MeshBasicMaterial;
  private glow: THREE.MeshBasicMaterial;
  private t = 0;
  /** False while tripped/disarmed: beams still glow but nothing triggers. */
  armed = true;

  constructor(private museum: Museum) {
    this.core = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 0.25, 0.22), toneMapped: false });
    this.glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.08, 0.06), toneMapped: false, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  }

  build() {
    const hops = [0.32];
    const limbo = [0.92, 1.4, 1.9, 2.4, 2.9, 3.4];
    const curtain = [0.3, 0.72, 1.14, 1.56, 1.98, 2.4, 2.82, 3.24];
    this.add('static', -5.0, hops);
    this.add('static', -2.5, limbo);
    this.add('blink', 0.0, curtain);
    this.add('sweep', 2.5, [0]);
    this.add('scan', 5.0, [0]);
    // emitter rails on both hallway walls at each station (+ floor/ceiling rails for the scanner)
    const parts: Part[] = [];
    const [z0, z1] = HALL_Z;
    for (const s of this.stations) {
      if (s.kind === 'scan') {
        parts.push({ g: new THREE.BoxGeometry(0.16, 0.05, z1 - z0), c: 0x1d1f26, m: T(s.x, F + 0.03, (z0 + z1) / 2) });
        parts.push({ g: new THREE.BoxGeometry(0.16, 0.08, z1 - z0), c: 0x1d1f26, m: T(s.x, F + SCAN_TOP + 0.08, (z0 + z1) / 2) });
        continue;
      }
      const top = s.kind === 'sweep' ? 3.0 : Math.max(...s.heights) + 0.15;
      for (const z of [z0 + 0.04, z1 - 0.04]) {
        parts.push({ g: new THREE.BoxGeometry(0.2, top, 0.08), c: 0x1d1f26, m: T(s.x, F + top / 2, z) });
        for (const h of s.kind === 'sweep' ? [] : s.heights) parts.push({ g: new THREE.BoxGeometry(0.12, 0.08, 0.1), c: 0x8a1b1b, m: T(s.x, F + h, z) });
      }
    }
    // a ceiling-bar between the scanner rails, so it doesn't float
    parts.push({ g: new THREE.BoxGeometry(0.1, WALL_TOP - F - SCAN_TOP - 0.1, 0.1), c: 0x1d1f26, m: T(5.0, F + SCAN_TOP + 0.1 + (WALL_TOP - F - SCAN_TOP - 0.1) / 2, HALL_Z[0] + 0.1) });
    this.museum.root.add(paintMesh(parts));
  }

  private beam(len: number, vertical: boolean): THREE.Object3D {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 6), this.core);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 8, 1, true), this.glow);
    c.castShadow = w.castShadow = false;
    g.add(c, w);
    if (!vertical) g.rotation.x = Math.PI / 2;
    return g;
  }

  private add(kind: Kind, x: number, heights: number[]) {
    const [z0, z1] = HALL_Z;
    const group = new THREE.Group();
    const beams: THREE.Object3D[] = [];
    if (kind === 'scan') {
      const b = this.beam(SCAN_TOP, true);
      b.position.set(x, F + SCAN_TOP / 2 + 0.03, (z0 + z1) / 2);
      group.add(b);
      beams.push(b);
    } else {
      for (const h of heights) {
        const b = this.beam(z1 - z0 - 0.1, false);
        b.position.set(x, F + h, (z0 + z1) / 2);
        group.add(b);
        beams.push(b);
      }
    }
    this.museum.root.add(group);
    this.stations.push({ kind, x, heights, group, beams, on: true, v: heights[0] ?? 0 });
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const [z0, z1] = HALL_Z;
    for (const s of this.stations) {
      if (s.kind !== 'blink') s.group.visible = true;
      if (s.kind === 'blink') {
        const ph = t % (BLINK_ON + BLINK_OFF);
        const on = ph < BLINK_ON;
        // warning flicker for the last 0.35 s of the off phase
        const warn = !on && ph > BLINK_ON + BLINK_OFF - 0.35;
        s.on = on;
        s.group.visible = on || (warn && Math.floor(t * 20) % 2 === 0);
      } else if (s.kind === 'sweep') {
        s.v = 0.3 + 2.7 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / SWEEP_T));
        s.beams[0].position.y = F + s.v;
      } else if (s.kind === 'scan') {
        const mid = (z0 + z1) / 2;
        const half = (z1 - z0) / 2 - 0.2;
        s.v = mid + half * Math.sin((t * Math.PI * 2) / SCAN_T);
        s.beams[0].position.z = s.v;
      }
    }
  }

  /**
   * Station index Jimothy (local position `p` = his collider centre) touches, or -1. `rolling` = ball form.
   */
  hit(p: THREE.Vector3, rolling: boolean): number {
    const [z0, z1] = HALL_Z;
    if (p.z < z0 - 0.4 || p.z > z1 + 0.4) return -1;
    const r = rolling ? 0.38 : 0.36;
    const ya = rolling ? p.y : p.y - 0.08;
    const yb = rolling ? p.y : p.y + 0.3;
    for (let i = 0; i < this.stations.length; i++) {
      const s = this.stations[i];
      if (!s.on) continue;
      const dx = Math.abs(p.x - s.x);
      if (dx > r + 0.03) continue;
      if (s.kind === 'scan') {
        if (ya - r > F + SCAN_TOP) continue;
        if (Math.hypot(dx, p.z - s.v) < r + 0.03) return i;
        continue;
      }
      const hs = s.kind === 'sweep' ? [s.v] : s.heights;
      for (const h of hs) {
        const y = F + h;
        const dy = y < ya ? ya - y : y > yb ? y - yb : 0;
        if (Math.hypot(dx, dy) < r + 0.02) return i;
      }
    }
    return -1;
  }

  /** Brighter / dimmer beams (alarm = steady bright). */
  setAlarm(on: boolean) {
    this.glow.opacity = on ? 0.6 : 0.35;
  }
}
