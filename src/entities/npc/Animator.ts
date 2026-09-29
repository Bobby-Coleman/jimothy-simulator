import * as THREE from 'three';
import { BONES, type BoneName, type HumanRig } from './HumanModel';

/** Upper-body (sometimes whole-body) poses layered on top of the walk cycle. */
export type Gesture =
  | 'none'
  | 'hold'
  | 'phone'
  | 'film'
  | 'camera'
  | 'selfie'
  | 'panic'
  | 'cheer'
  | 'wave'
  | 'kitty'
  | 'scold'
  | 'shrug'
  | 'baffled'
  | 'fist'
  | 'eat'
  | 'aww'
  | 'point'
  | 'shock'
  | 'dust'
  | 'throw';

export interface AnimInput {
  /** Horizontal speed (m/s). */
  speed: number;
  time: number;
  gesture: Gesture;
  /** Desired head yaw relative to the body, radians (+ = turn left). */
  lookYaw: number;
  lookPitch: number;
  /** Something in the right hand (raises the forearm when not gesturing). */
  holding: boolean;
  /** Extra forward hunch (grandma). */
  hunch: number;
}

// pose channels
const PY = 0, PX = 1, PYAW = 2, PZ = 3, CX = 4, CY = 5, CZ = 6, HX = 7, HY = 8, HZ = 9;
const ULX = 10, ULY = 11, ULZ = 12, LLX = 13, URX = 14, URY = 15, URZ = 16, LRX = 17;
const TLX = 18, TLZ = 19, SLX = 20, TRX = 21, TRZ = 22, SRX = 23;
const N = 24;

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const ease = (t: number) => t * t * (3 - 2 * t);

type GestureFn = (p: Float32Array, t: number, amp: number) => void;

const GESTURES: Record<Exclude<Gesture, 'none'>, GestureFn> = {
  hold(p, t, amp) {
    p[URX] = -0.3 + p[URX] * 0.3;
    p[URZ] = 0.05;
    p[LRX] = -1.25;
  },
  phone(p) {
    p[URX] = -0.45;
    p[URZ] = 0.14;
    p[LRX] = -1.45;
    p[ULX] = -0.42;
    p[ULZ] = -0.2;
    p[LLX] = -1.3;
    p[HX] = 0.38;
  },
  film(p) {
    p[URX] = -1.32;
    p[URZ] = 0.2;
    p[LRX] = -0.5;
    p[ULX] = -0.95;
    p[ULZ] = -0.32;
    p[LLX] = -1.05;
    p[HX] = 0.02;
  },
  camera(p) {
    p[ULX] = -0.95;
    p[ULZ] = -0.42;
    p[LLX] = -1.95;
    p[URX] = -0.95;
    p[URZ] = 0.42;
    p[LRX] = -1.95;
    p[HX] = 0.05;
  },
  selfie(p, t) {
    p[URX] = -2.25;
    p[URZ] = -0.3;
    p[LRX] = -0.25;
    p[ULX] = -0.35;
    p[ULZ] = 0.55;
    p[LLX] = -2.1;
    p[HX] = -0.22;
    p[HZ] = 0.22 + Math.sin(t * 2) * 0.04;
  },
  panic(p, t) {
    p[ULX] = -2.7 + Math.sin(t * 17) * 0.35;
    p[ULZ] = 0.45 + Math.sin(t * 13) * 0.2;
    p[LLX] = -0.5 + Math.sin(t * 19) * 0.3;
    p[URX] = -2.7 + Math.sin(t * 17 + 1.7) * 0.35;
    p[URZ] = -0.45 - Math.sin(t * 13 + 1) * 0.2;
    p[LRX] = -0.5 + Math.sin(t * 19 + 2) * 0.3;
    p[HX] = -0.25;
  },
  cheer(p, t) {
    p[ULX] = -0.2;
    p[ULZ] = 2.55 + Math.sin(t * 10) * 0.15;
    p[LLX] = -0.3;
    p[URX] = -0.2;
    p[URZ] = -2.55 - Math.sin(t * 10) * 0.15;
    p[LRX] = -0.3;
    p[PY] += Math.abs(Math.sin(t * 8)) * 0.07;
    p[HX] = -0.15;
  },
  wave(p, t) {
    p[URX] = -0.25;
    p[URZ] = -2.4;
    p[LRX] = -0.35 + Math.sin(t * 9) * 0.45;
  },
  kitty(p, t) {
    p[TLX] = -1.05;
    p[TRX] = -1.05;
    p[SLX] = 1.75;
    p[SRX] = 1.75;
    p[TLZ] = 0.22;
    p[TRZ] = -0.22;
    p[CX] = 0.55;
    p[HX] = -0.45;
    p[URX] = -1.1 + Math.sin(t * 6) * 0.1;
    p[URZ] = 0.1;
    p[LRX] = -0.25 + Math.sin(t * 6) * 0.3;
    p[ULX] = -0.35;
    p[ULZ] = 0.15;
    p[LLX] = -1.1;
  },
  scold(p, t) {
    p[URX] = -1.45;
    p[URZ] = 0.15 + Math.sin(t * 9) * 0.1;
    p[LRX] = -0.15;
    p[ULX] = 0.25;
    p[ULZ] = 0.55;
    p[LLX] = -1.7;
    p[CX] += 0.08;
    p[HX] = 0.1;
  },
  shrug(p, t) {
    p[ULX] = -0.2;
    p[ULZ] = 0.55;
    p[LLX] = -1.35;
    p[URX] = -0.2;
    p[URZ] = -0.55;
    p[LRX] = -1.35;
    p[HZ] = 0.25;
    p[PY] += Math.max(0, Math.sin(t * 3)) * 0.02;
  },
  baffled(p, t) {
    p[ULX] = -0.35;
    p[ULZ] = 0.2;
    p[LLX] = -1.5 + Math.sin(t * 7) * 0.12;
    p[URX] = -0.35;
    p[URZ] = -0.2;
    p[LRX] = -1.5 + Math.sin(t * 7 + 1) * 0.12;
    p[HX] = 0.45;
    p[HZ] = Math.sin(t * 1.5) * 0.2;
  },
  fist(p, t) {
    p[URX] = -2.3;
    p[URZ] = -0.2;
    p[LRX] = -0.9 + Math.sin(t * 14) * 0.35;
    p[CX] += 0.08;
  },
  eat(p, t) {
    const k = 0.5 + 0.5 * Math.sin(t * 2.2);
    p[URX] = -0.5;
    p[URZ] = 0.32;
    p[LRX] = -1.5 - 0.75 * k;
    p[HX] = -0.05;
  },
  aww(p, t) {
    p[ULX] = -0.55;
    p[ULZ] = -0.32;
    p[LLX] = -1.7;
    p[URX] = -0.55;
    p[URZ] = 0.32;
    p[LRX] = -1.7;
    p[HZ] = 0.22;
    p[CX] += 0.08;
    p[PZ] = Math.sin(t * 2) * 0.04;
  },
  point(p) {
    p[URX] = -1.5;
    p[URZ] = 0.05;
    p[LRX] = -0.05;
  },
  shock(p) {
    p[ULX] = -0.7;
    p[ULZ] = 1.15;
    p[LLX] = -1.6;
    p[URX] = -0.7;
    p[URZ] = -1.15;
    p[LRX] = -1.6;
    p[CX] = -0.18;
    p[HX] = -0.15;
  },
  throw(p, t) {
    // overhand wind-up and release, looping
    const k = (t * 1.6) % 1;
    const swing = k < 0.55 ? -2.7 + k * 0.8 : -2.3 + (k - 0.55) * 5.5;
    p[URX] = Math.min(0.4, swing);
    p[URZ] = -0.25;
    p[LRX] = k < 0.55 ? -1.4 : -0.3;
    p[ULX] = -0.7;
    p[ULZ] = 0.3;
    p[CY] = k < 0.55 ? 0.35 : -0.25;
    p[CX] = 0.1;
  },
  dust(p, t) {
    p[ULX] = -0.35;
    p[ULZ] = -0.25;
    p[LLX] = -1.0 + Math.sin(t * 13) * 0.45;
    p[URX] = -0.35;
    p[URZ] = 0.25;
    p[LRX] = -1.0 + Math.sin(t * 13 + 2) * 0.45;
    p[CX] = 0.3;
    p[HX] = 0.35;
  },
};

/** Procedural animation for one human rig. */
export class Animator {
  phase = Math.random() * Math.PI * 2;
  private speed = 0;
  private weights = new Map<Exclude<Gesture, 'none'>, number>();
  private base = new Float32Array(N);
  private tmp = new Float32Array(N);
  private headYaw = 0;
  private headPitch = 0;
  private idleSeed = Math.random() * 100;
  // get-up blend
  private getupT = 1;
  private getupDur = 0.8;
  private fromQ: Partial<Record<BoneName, THREE.Quaternion>> = {};
  private fromPelvis = new THREE.Vector3();

  constructor(private rig: HumanRig) {}

  /** Blend from the rig's current (ragdoll) pose into the animated pose over `dur` seconds. */
  startGetup(dur = 0.85) {
    for (const b of BONES) this.fromQ[b] = this.rig.bones[b].quaternion.clone();
    this.fromPelvis.copy(this.rig.bones.pelvis.position);
    this.getupT = 0;
    this.getupDur = dur;
  }

  /** Skip the rest of the get-up blend. */
  finishGetup() {
    this.getupT = 1;
  }

  get gettingUp() {
    return this.getupT < 1;
  }

  update(dt: number, inp: AnimInput) {
    const rig = this.rig;
    const d = rig.dims;
    const p = this.base;
    const t = inp.time;
    p.fill(0);

    this.speed += (inp.speed - this.speed) * Math.min(1, dt * 10);
    const v = this.speed;
    const amp = clamp(v / 1.25, 0, 1);
    const run = clamp((v - 2.1) / 1.6, 0, 1);
    const freq = 0.85 + v * 0.36; // gait cycles per second
    if (v > 0.05) this.phase += dt * freq * Math.PI * 2;
    const ph = this.phase;

    // ---- locomotion base
    const stride = 0.5 + 0.3 * run;
    const knee = 0.55 + 0.8 * run;
    p[TLX] = -Math.sin(ph) * stride * amp;
    p[TRX] = Math.sin(ph) * stride * amp;
    p[SLX] = amp * (0.1 + knee * Math.max(0, Math.cos(ph)));
    p[SRX] = amp * (0.1 + knee * Math.max(0, -Math.cos(ph)));
    const armSwing = (0.32 + 0.45 * run) * amp;
    p[ULX] = Math.sin(ph) * armSwing;
    p[URX] = -Math.sin(ph) * armSwing;
    p[ULZ] = 0.09 + 0.12 * run;
    p[URZ] = -(0.09 + 0.12 * run);
    p[LLX] = -(0.15 + 0.2 * amp + 1.1 * run);
    p[LRX] = -(0.15 + 0.2 * amp + 1.1 * run);
    p[CX] = 0.03 * amp + 0.2 * run + inp.hunch;
    p[CY] = Math.sin(ph) * 0.12 * amp;
    p[PYAW] = -Math.sin(ph) * 0.1 * amp;
    p[PZ] = Math.sin(ph) * 0.035 * amp;
    p[HX] = -p[CX] * 0.7;
    // idle life
    const idle = 1 - amp;
    if (idle > 0.01) {
      const ti = t + this.idleSeed;
      p[CX] += Math.sin(ti * 1.7) * 0.012 * idle;
      p[PZ] += Math.sin(ti * 0.45) * 0.025 * idle;
      p[TLZ] += Math.sin(ti * 0.45) * 0.02 * idle;
      p[TRZ] += Math.sin(ti * 0.45) * 0.02 * idle;
      p[ULZ] += 0.02 * idle;
      p[URZ] -= 0.02 * idle;
    }

    // ---- gestures (smoothly blended)
    let g = inp.gesture;
    if (g === 'none' && inp.holding) g = 'hold';
    if (g !== 'none' && !this.weights.has(g)) this.weights.set(g, 0);
    const k = Math.min(1, dt * 7);
    for (const [name, w0] of this.weights) {
      const target = name === g ? 1 : 0;
      const w = w0 + (target - w0) * k;
      if (w < 0.002 && target === 0) {
        this.weights.delete(name);
        continue;
      }
      this.weights.set(name, w);
      const fn = GESTURES[name];
      if (!fn) {
        this.weights.delete(name);
        continue;
      }
      const q = this.tmp;
      q.set(p);
      fn(q, t, amp);
      for (let i = 0; i < N; i++) p[i] += (q[i] - p[i]) * w;
    }

    // ---- head look (layered on top)
    const ly = clamp(inp.lookYaw, -1.2, 1.2);
    const lp = clamp(inp.lookPitch, -0.6, 0.6);
    this.headYaw += (ly - this.headYaw) * Math.min(1, dt * 6);
    this.headPitch += (lp - this.headPitch) * Math.min(1, dt * 6);
    p[HY] += this.headYaw * 0.75;
    p[CY] += this.headYaw * 0.25;
    p[HX] += this.headPitch;

    // ---- pelvis height from leg geometry (keeps the lower foot on the ground)
    const legH = (tx: number, sx: number) => d.thighLen * Math.cos(tx) + d.shinLen * Math.cos(tx + sx);
    const full = d.thighLen + d.shinLen;
    const drop = Math.min(legH(p[TLX], p[SLX]), legH(p[TRX], p[SRX])) - full;
    const bounce = run * 0.045 * Math.abs(Math.sin(ph * 2));
    p[PY] += drop + bounce;

    // ---- apply
    const B = rig.bones;
    const setR = (bone: THREE.Bone, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ') => {
      _e.set(x, y, z, order);
      bone.quaternion.setFromEuler(_e);
    };
    B.pelvis.position.copy(rig.bindLocal.pelvis);
    B.pelvis.position.y += p[PY];
    setR(B.pelvis, p[PX], p[PYAW], p[PZ], 'YXZ');
    setR(B.chest, p[CX], p[CY], p[CZ], 'YXZ');
    setR(B.head, p[HX], p[HY], p[HZ], 'YXZ');
    setR(B.uArmL, p[ULX], p[ULY], p[ULZ]);
    setR(B.lArmL, p[LLX], 0, 0);
    setR(B.uArmR, p[URX], p[URY], p[URZ]);
    setR(B.lArmR, p[LRX], 0, 0);
    setR(B.thighL, p[TLX], 0, p[TLZ]);
    setR(B.shinL, p[SLX], 0, 0);
    setR(B.thighR, p[TRX], 0, p[TRZ]);
    setR(B.shinR, p[SRX], 0, 0);

    if (this.getupT < 1) {
      this.getupT = Math.min(1, this.getupT + dt / this.getupDur);
      const w = ease(this.getupT);
      for (const b of BONES) {
        const from = this.fromQ[b];
        if (!from) continue;
        _q.copy(B[b].quaternion);
        B[b].quaternion.slerpQuaternions(from, _q, w);
      }
      _v.copy(B.pelvis.position);
      B.pelvis.position.lerpVectors(this.fromPelvis, _v, w);
    }
  }
}
