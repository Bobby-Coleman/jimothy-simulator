import * as THREE from 'three';
import type { AnimState } from './JimothyModel';

/**
 * Procedural animation for the walking (four-legged) Jimothy: `assets/models/jimothy.glb`.
 *
 * The rig's bones all have IDENTITY rest rotations, so every bone's local axes are the model's (+X his left, +Y up,
 * +Z forward) and a pose is plain rotations: +X pitches a leg's lower end / the nose DOWN-and-back, like the round
 * model. Legs are placed with planar two-bone IK (knees bend forward, elbows backward); feet and hands are kept flat
 * on the ground in stance.
 *
 * Gaits here are a first pass (walk → trot → bound with speed); the walk cycle measured from the footage replaces them.
 */

type LegKey = 'HL' | 'HR' | 'FL' | 'FR';

interface Gait {
  duty: number;
  off: Record<LegKey, number>;
  lift: number;
}

const GAITS: Record<'walk' | 'trot' | 'bound', Gait> = {
  walk: { duty: 0.66, off: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, lift: 0.06 },
  trot: { duty: 0.48, off: { HL: 0, FR: 0.02, HR: 0.5, FL: 0.52 }, lift: 0.08 },
  bound: { duty: 0.36, off: { HL: 0, HR: 0.07, FL: 0.5, FR: 0.57 }, lift: 0.1 },
};

interface Leg {
  key: LegKey;
  hind: boolean;
  sx: number;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
  toe: THREE.Object3D | null;
  l1: number;
  l2: number;
  phi1: number;
  phi2: number;
  bend: number;
  rest: THREE.Vector3;
  target: THREE.Vector3;
  want: THREE.Vector3;
  endPitch: number;
  toePitch: number;
  abduct: number;
}

const clamp = THREE.MathUtils.clamp;
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const s01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = THREE.MathUtils.lerp;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);

const REQUIRED = ['Hips', 'Spine1', 'Spine2', 'Chest', 'Neck', 'Head', 'Jaw', 'EarL', 'EarR', 'Tail'] as const;

export class JimothyQuad {
  readonly bones: Record<string, THREE.Object3D> = {};
  readonly legs: Leg[] = [];
  /** The armature node (model frame: feet on y = 0 at rest). */
  readonly arm: THREE.Object3D;
  skinned: THREE.SkinnedMesh | null = null;
  private restPos = new Map<THREE.Object3D, THREE.Vector3>();
  private armInv = new THREE.Matrix4();
  private cur: Record<string, number> = {};
  private phase = 0;
  private swayPhase = 0;
  private blinkT = 2;
  private earT = 0;
  private earSide = 1;
  private sniffT = 6;
  private lookYaw = 0;
  private lookT = 0;
  swipeT = 9;
  swipeSide = 1;
  reachT = 9;
  /**
   * "Stare at his empty paws" emote weight (0..1) + head shake: he sits up and holds his front paws up in front of his
   * face. Set every frame by the emote (ItemsSystem); consumed (reset) by the next animate().
   */
  stareW = 0;
  stareShake = 0;

  static fits(root: THREE.Object3D) {
    return REQUIRED.every((n) => !!root.getObjectByName(n)) && !!root.getObjectByName('ThighL') && !!root.getObjectByName('ArmL');
  }

  constructor(root: THREE.Object3D) {
    const hips = root.getObjectByName('Hips')!;
    this.arm = hips.parent!;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && !o.userData.furShell && !this.skinned) this.skinned = o as THREE.SkinnedMesh;
    });
    for (const n of [...REQUIRED, 'EyeL', 'EyeR', 'Nose']) {
      const o = root.getObjectByName(n);
      if (o) this.bones[n] = o;
    }
    for (const s of ['L', 'R']) for (const n of ['Scapula', 'Arm', 'Forearm', 'Hand', 'Thigh', 'Shin', 'Foot', 'Toes']) this.bones[n + s] = root.getObjectByName(n + s)!;
    for (const o of Object.values(this.bones)) this.restPos.set(o, o.position.clone());
    const modelPos = (o: THREE.Object3D) => {
      const p = o.position.clone();
      for (let q = o.parent; q && q !== this.arm; q = q.parent) p.add(q.position);
      return p;
    };
    const mk = (key: LegKey, hind: boolean, sx: number): Leg => {
      const s = sx > 0 ? 'L' : 'R';
      const upper = this.bones[(hind ? 'Thigh' : 'Arm') + s];
      const lower = this.bones[(hind ? 'Shin' : 'Forearm') + s];
      const end = this.bones[(hind ? 'Foot' : 'Hand') + s];
      const a = modelPos(upper);
      const b = modelPos(lower);
      const c = modelPos(end);
      const u1 = b.clone().sub(a);
      const u2 = c.clone().sub(b);
      return {
        key,
        hind,
        sx,
        upper,
        lower,
        end,
        toe: hind ? this.bones['Toes' + s] : null,
        l1: Math.hypot(u1.y, u1.z),
        l2: Math.hypot(u2.y, u2.z),
        phi1: Math.atan2(u1.z, u1.y),
        phi2: Math.atan2(u2.z, u2.y),
        bend: hind ? 1 : -1,
        rest: c.clone(),
        target: c.clone(),
        want: c.clone(),
        endPitch: 0,
        toePitch: 0,
        abduct: 0,
      };
    };
    this.legs.push(mk('HL', true, 1), mk('HR', true, -1), mk('FL', false, 1), mk('FR', false, -1));
  }

  /**
   * Where head-worn things go, in the Head bone's frame (= model axes, origin at the head joint). Hats sit on the crown
   * tilted forward with his down-turned head; glasses sit on the face plane, which looks 15° below horizontal.
   * (Measured from the anatomy in tools/blender/jimothy_anatomy.py.)
   */
  headAnchors() {
    const b = this.bones;
    const head = new THREE.Vector3();
    for (let o: THREE.Object3D | null = b.Head; o && o !== this.arm; o = o.parent) head.add(this.restPos.get(o) ?? o.position);
    const local = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).sub(head);
    const eyeL = b.EyeL?.position.clone() ?? local(0.037, 0.47, 0.367);
    const eyeR = b.EyeR?.position.clone() ?? local(-0.037, 0.47, 0.367);
    // The top of his head between the ears is where the neck's hump runs over his down-turned head: skin surface at
    // (0, 0.62, 0.335) in the model, facing 32° forward of straight up (measured on the anatomy's SDF).
    const tilt = 0.56;
    const dir = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
    const top = local(0, 0.62, 0.335);
    return {
      /** On top of the fur there. */
      crown: top.clone().addScaledVector(dir, 0.015),
      /** A hat's bottom-centre: just into the fur, so the hat hugs his head. */
      hatBase: top.clone().addScaledVector(dir, -0.012),
      eyeMid: eyeL.clone().add(eyeR).multiplyScalar(0.5),
      eyeSep: eyeL.distanceTo(eyeR),
      eyeR: 0.011,
      earMid: b.EarL.position.clone().add(b.EarR.position).multiplyScalar(0.5),
      center: local(0, 0.5, 0.33),
      radius: 0.205,
      /** Size of the round head's accessories that fits this head (cap / beanie radii are 0.13 / 0.155 × scale). */
      scale: 0.6,
      /** Hat width (cranium between the ears, plus fur). */
      hatWidth: 0.18,
      tilt,
      faceTilt: (15 * Math.PI) / 180,
    };
  }

  /** Part map for code shared with the round model (accessories, emotes, cutscenes). */
  parts() {
    const b = this.bones;
    return {
      Body: b.Spine2,
      Head: b.Head,
      EyeL: b.EyeL,
      EyeR: b.EyeR,
      Nose: b.Nose,
      EarL: b.EarL,
      EarR: b.EarR,
      ArmL: b.ArmL,
      ArmR: b.ArmR,
      HandL: b.HandL,
      HandR: b.HandR,
      LegL: b.ThighL,
      LegR: b.ThighR,
      Tail1: b.Tail,
    } as Record<string, THREE.Object3D | undefined>;
  }

  private sm(key: string, target: number, k: number, dt: number) {
    const v = damp(this.cur[key] ?? target, target, k, dt);
    this.cur[key] = v;
    return v;
  }

  private rot(o: THREE.Object3D | undefined, x: number, y = 0, z = 0) {
    if (!o) return;
    _e.set(x, y, z, 'YXZ');
    o.quaternion.setFromEuler(_e);
  }

  animate(dt: number, s: AnimState) {
    const t = s.time;
    const b = this.bones;
    const mode = s.mode;
    const moving = s.speed > 0.3;

    // ---------------------------------------------------------------- gait timing
    const gspeed = mode === 'climb' ? s.climbSpeed * 1.6 : s.speed;
    const stride = clamp(0.28 + 0.13 * gspeed, 0.3, 1.45);
    const freq = mode === 'swim' ? 1.9 : mode === 'climb' ? clamp(gspeed / 0.5, 1.2, 4) : clamp(gspeed / stride, 0, 6.2);
    if ((moving && (mode === 'walk' || mode === 'climb')) || mode === 'swim') this.phase = (this.phase + dt * freq) % 1;
    this.swayPhase += dt;
    const ph = this.phase;
    // gait weights by speed
    const wBound = s01((gspeed - 5.6) / 1.4);
    const wTrot = s01((gspeed - 1.6) / 1.2) * (1 - wBound);
    const wWalk = 1 - wTrot - wBound;
    const amt = moving ? 1 : 0;

    // ---------------------------------------------------------------- body pose (targets)
    let hipsY = 0;
    let hipsZ = 0;
    let hipsPitch = 0;
    let hipsRoll = 0;
    let hipsYaw = 0;
    let flex = 0; // + arches the back (spine), - extends
    let chestPitch = 0;
    let headPitch = 0;
    let headYaw = 0;
    let headTilt = 0;
    let jaw = 0;
    let tailLift = 0;
    let tailWag = 0;
    let earBack = 0;
    let breathe = Math.sin(t * 2.6) * 0.012;

    // idle behaviour: look around, now and then sniff the ground
    this.lookT -= dt;
    if (this.lookT < 0) {
      this.lookT = 1.4 + Math.random() * 2.8;
      this.lookYaw = (Math.random() - 0.5) * 1.1;
    }
    const idle = mode === 'walk' && !moving && s.grounded && !s.carrying && !s.washing;
    if (idle) {
      headYaw = this.lookYaw;
      headPitch = Math.sin(t * 0.5) * 0.05;
      this.sniffT -= dt;
      if (this.sniffT < 0) {
        headPitch = 0.45;
        headYaw *= 0.3;
        if (this.sniffT < -1.6) this.sniffT = 4 + Math.random() * 6;
      }
      tailWag = Math.sin(t * 1.3) * 0.12;
    }

    // ---------------------------------------------------------------- legs (targets in the model frame)
    const L = this.legs;
    for (const leg of L) {
      leg.want.copy(leg.rest);
      leg.endPitch = 0;
      leg.toePitch = 0;
      leg.abduct = 0;
    }
    const step = (leg: Leg, g: Gait, lift: number, strideLen: number) => {
      const p = (ph + g.off[leg.key]) % 1;
      const A = strideLen * g.duty * 0.5;
      let dz: number;
      let dy = 0;
      let pitch = 0;
      if (p < g.duty) {
        const u = p / g.duty;
        dz = A * (1 - 2 * u);
        pitch = s01((u - 0.7) / 0.3) * (leg.hind ? 0.55 : 0.45); // heel / wrist lifts before toe-off
        dy = pitch * 0.03;
      } else {
        const w = (p - g.duty) / (1 - g.duty);
        dz = -A + 2 * A * s01(w);
        dy = lift * Math.sin(Math.PI * w);
        pitch = Math.sin(Math.PI * Math.min(1, w * 1.3)) * (leg.hind ? 0.7 : 1.3);
      }
      return { dz, dy, pitch };
    };
    const walkLegs = (strideLen: number, liftK: number, zBias: number, only?: (l: Leg) => boolean) => {
      for (const leg of L) {
        if (only && !only(leg)) continue;
        let dz = 0;
        let dy = 0;
        let pitch = 0;
        for (const [g, w] of [
          [GAITS.walk, wWalk],
          [GAITS.trot, wTrot],
          [GAITS.bound, wBound],
        ] as [Gait, number][]) {
          if (w <= 0.001) continue;
          const r = step(leg, g, g.lift * liftK, strideLen);
          dz += r.dz * w;
          dy += r.dy * w;
          pitch += r.pitch * w;
        }
        leg.want.z += (dz + zBias) * amt;
        leg.want.y += dy * amt;
        leg.endPitch = pitch * amt;
      }
    };

    switch (mode) {
      case 'walk':
        if (!s.grounded) {
          // airborne: front paws reach forward, hind legs trail, then brace for landing when falling
          const fall = clamp(-s.vy / 6, 0, 1);
          for (const leg of L) {
            if (leg.hind) {
              leg.want.z -= lerp(0.13, 0.02, fall);
              leg.want.y += lerp(0.12, 0.04, fall);
              leg.endPitch = lerp(0.9, 0.2, fall);
            } else {
              leg.want.z += lerp(0.12, 0.05, fall);
              leg.want.y += lerp(0.14, 0.03, fall);
              leg.endPitch = lerp(1.1, 0.2, fall);
            }
          }
          hipsPitch = clamp(-s.vy * 0.03, -0.18, 0.2);
          flex = -0.12 * (1 - fall);
          tailLift = 0.35;
          earBack = 0.35;
        } else {
          if (moving) {
            const bob = wWalk * 0.008 + wTrot * 0.014 + wBound * 0.03;
            hipsY = -Math.abs(Math.sin(ph * Math.PI * 2 * (wBound > 0.5 ? 1 : 2))) * bob;
            hipsRoll = Math.sin(ph * Math.PI * 2) * 0.03 * wWalk;
            flex = wBound * Math.sin(ph * Math.PI * 2 + 0.6) * 0.16;
            hipsPitch = wBound * Math.sin(ph * Math.PI * 2 + 2.2) * 0.07 + 0.02 * wTrot;
            headPitch = -0.08 * wBound + Math.sin(ph * Math.PI * 4) * 0.025;
            tailLift = 0.1 + 0.2 * wBound;
            tailWag = Math.sin(ph * Math.PI * 2) * 0.18;
          }
          walkLegs(stride, 1, 0.02 * wTrot + 0.05 * wBound);
        }
        break;
      case 'swim': {
        // dog-paddle: front paws circle, hind legs kick; head up
        for (const leg of L) {
          const o = leg.key === 'FL' || leg.key === 'HR' ? 0 : Math.PI;
          const a = ph * Math.PI * 2 + o;
          if (leg.hind) {
            leg.want.z += -0.06 + Math.cos(a) * 0.07;
            leg.want.y += 0.1 + Math.sin(a) * 0.05;
            leg.endPitch = 0.6 + Math.sin(a) * 0.3;
          } else {
            leg.want.z += 0.05 + Math.cos(a) * 0.08;
            leg.want.y += 0.14 + Math.sin(a) * 0.07;
            leg.endPitch = 0.9 + Math.cos(a) * 0.4;
          }
        }
        hipsPitch = -0.12;
        headPitch = -0.12;
        tailLift = 0.3;
        tailWag = Math.sin(t * 3) * 0.2;
        break;
      }
      case 'climb':
        // belly to the wall (model +Z = up the wall): legs splayed, climbing steps
        hipsY = -0.04;
        walkLegs(0.42, 0.9, 0.0);
        for (const leg of L) leg.abduct = leg.sx * 0.32;
        headPitch = -0.12;
        tailLift = -0.2;
        break;
      case 'hang':
        for (const leg of L) {
          if (leg.hind) {
            leg.want.z -= 0.02 + Math.sin(t * 2.2 + leg.sx) * 0.04;
            leg.want.y += 0.02;
            leg.endPitch = 0.7;
          } else {
            leg.want.set(leg.sx * 0.07, 0.72, 0.36);
            leg.endPitch = -1.2;
          }
        }
        flex = -0.1;
        headPitch = -0.12;
        tailLift = -0.4;
        break;
      case 'ragdoll':
      case 'roll':
        for (const leg of L) {
          const k = leg.hind ? 1 : 1.3;
          leg.want.z += Math.sin(t * (13 + leg.sx * 2) + (leg.hind ? 0 : 1.7)) * 0.1 * k;
          leg.want.y += 0.08 + Math.sin(t * (11 + leg.sx * 3) + 0.5) * 0.08;
          leg.endPitch = Math.sin(t * 9 + leg.sx) * 0.8;
          leg.abduct = leg.sx * (0.3 + Math.sin(t * 7 + leg.sx) * 0.2);
        }
        flex = Math.sin(t * 5) * 0.2;
        headTilt = Math.sin(t * 9) * 0.3;
        headPitch = Math.sin(t * 6) * 0.3;
        tailWag = Math.sin(t * 12) * 0.5;
        earBack = 0.6;
        break;
    }

    // ---------------------------------------------------------------- overlays: washing, bonk, grabs, chitter
    if (s.washing) {
      // crouch, head down, both front paws scrubbing in front of the chest
      hipsY -= 0.03;
      headPitch = 0.35;
      headYaw = 0;
      const w = Math.sin(t * 24);
      for (const leg of L) {
        if (leg.hind) continue;
        leg.want.set(leg.sx * 0.045, 0.24 + w * 0.025 * leg.sx, 0.45 + w * 0.03 * leg.sx);
        leg.endPitch = -0.9;
      }
    }
    if (s.sinceBonk < 0.35 && mode !== 'roll') {
      const u = 1 - s.sinceBonk / 0.35;
      headPitch += 0.55 * u;
      hipsPitch += 0.12 * u;
      hipsZ += 0.05 * u;
      earBack = Math.max(earBack, u);
    }
    this.swipeT += dt;
    this.reachT += dt;
    if (this.swipeT < 0.32 && mode !== 'roll' && mode !== 'ragdoll') {
      const u = this.swipeT / 0.32;
      const out = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
      const leg = this.swipeSide > 0 ? L[2] : L[3];
      leg.want.lerp(_v.set(leg.sx * 0.06, 0.34, 0.42), out);
      leg.endPitch = lerp(leg.endPitch, -0.6, out);
      hipsPitch += 0.08 * out;
      hipsRoll += 0.06 * out * this.swipeSide;
    }
    if (this.reachT < 0.2 && !s.carrying && mode !== 'roll' && mode !== 'ragdoll') {
      headPitch += 0.25;
      hipsZ += 0.03;
    }
    const stare = this.sm('stare', this.stareW, 8, dt);
    if (stare > 0.001) {
      // sit up on his haunches, head bowed over the (empty) paws
      hipsPitch = lerp(hipsPitch, -0.95, stare);
      hipsZ += 0.04 * stare;
      hipsY -= 0.11 * stare;
      flex = lerp(flex, -0.1, stare);
      headPitch = lerp(headPitch, 0.4, stare);
      headYaw = lerp(headYaw, this.stareShake, stare);
      for (const leg of L) if (leg.hind) leg.want.z += 0.06 * stare;
    }
    this.stareW = 0;
    if (s.sinceChitter < 0.8) {
      const u = 1 - s.sinceChitter / 0.8;
      jaw = Math.max(jaw, Math.abs(Math.sin(s.sinceChitter * 34)) * 0.28 * u);
      headTilt += Math.sin(s.sinceChitter * 30) * 0.12 * u;
      headPitch -= 0.08 * u;
    }

    // ---------------------------------------------------------------- apply the body
    const k = 9;
    hipsY = this.sm('hipsY', hipsY, 14, dt);
    hipsZ = this.sm('hipsZ', hipsZ, 8, dt);
    hipsPitch = this.sm('hipsPitch', hipsPitch, 10, dt);
    hipsRoll = this.sm('hipsRoll', hipsRoll, k, dt);
    hipsYaw = this.sm('hipsYaw', hipsYaw, k, dt);
    flex = this.sm('flex', flex, 12, dt);
    chestPitch = this.sm('chestPitch', chestPitch, k, dt);
    // he can hardly lift his head: nose-up is limited to a few degrees past his natural pose
    headPitch = this.sm('headPitch', clamp(headPitch, -0.2, 0.75), 6, dt);
    headYaw = this.sm('headYaw', clamp(headYaw, -0.75, 0.75), 5, dt);
    headTilt = this.sm('headTilt', headTilt, 10, dt);
    jaw = this.sm('jaw', clamp(jaw, 0, 0.3), 30, dt);
    tailLift = this.sm('tailLift', tailLift, 6, dt);
    tailWag = this.sm('tailWag', tailWag, 10, dt);
    earBack = this.sm('earBack', earBack, 10, dt);

    const hp = this.restPos.get(b.Hips)!;
    b.Hips.position.set(hp.x, hp.y + hipsY, hp.z + hipsZ);
    _e.set(hipsPitch, hipsYaw, hipsRoll, 'ZYX');
    b.Hips.quaternion.setFromEuler(_e);
    this.rot(b.Spine1, flex * 0.5 + breathe);
    this.rot(b.Spine2, flex * 0.35 - breathe);
    this.rot(b.Chest, chestPitch - flex * 0.2);
    this.rot(b.Neck, headPitch * 0.3, headYaw * 0.35, 0);
    this.rot(b.Head, headPitch * 0.7, headYaw * 0.65, headTilt);
    this.rot(b.Jaw, jaw);
    this.rot(b.Tail, -tailLift, tailWag, 0);
    // ears: occasional twitch, flattened when bonking / flying
    this.earT -= dt;
    if (this.earT < -Math.random() * 6 - 1.5) {
      this.earT = 0.25;
      this.earSide = Math.random() < 0.5 ? 1 : -1;
    }
    const tw = this.earT > 0 ? Math.sin(this.earT * 40) * 0.3 : 0;
    this.rot(b.EarL, earBack * 0.7 + (this.earSide > 0 ? tw : 0), 0, -earBack * 0.3);
    this.rot(b.EarR, earBack * 0.7 + (this.earSide < 0 ? tw : 0), 0, earBack * 0.3);
    // blink
    this.blinkT -= dt;
    let eyeY = 1;
    if (this.blinkT < 0) {
      eyeY = 0.1;
      if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 4;
    }
    if (mode === 'ragdoll') eyeY = 0.25 + Math.abs(Math.sin(t * 3)) * 0.3;
    for (const n of ['EyeL', 'EyeR']) b[n]?.scale.set(1, eyeY, 1);
    // shoulder blades ride with the front legs
    for (const leg of L) {
      if (leg.hind) continue;
      const scap = b[leg.sx > 0 ? 'ScapulaL' : 'ScapulaR'];
      const swing = clamp((leg.want.z - leg.rest.z) / 0.25, -1, 1) * 0.25;
      this.rot(scap, -swing * 0.6, 0, 0);
    }

    // ---------------------------------------------------------------- apply the legs (IK)
    this.arm.updateWorldMatrix(true, true);
    this.armInv.copy(this.arm.matrixWorld).invert();
    if (stare > 0.001) {
      // paws held up in front of his face, palms up (chest frame: -Y faces forward once he sits up)
      _m.copy(this.armInv).multiply(b.Chest.matrixWorld);
      for (const leg of L) {
        if (leg.hind) continue;
        leg.want.lerp(_v.set(leg.sx * 0.05, -0.2, 0.02).applyMatrix4(_m), stare);
        leg.endPitch = lerp(leg.endPitch, -1.6, stare);
      }
    }
    const kLeg = mode === 'ragdoll' ? 14 : 40;
    for (const leg of L) {
      leg.target.lerp(leg.want, 1 - Math.exp(-kLeg * dt));
      const endPitch = this.sm('ep' + leg.key, leg.endPitch, 24, dt);
      const abd = this.sm('ab' + leg.key, leg.abduct, 10, dt);
      this.solveLeg(leg, endPitch, abd);
    }
  }

  private solveLeg(leg: Leg, endPitch: number, abduct: number) {
    const parent = leg.upper.parent!;
    _m.copy(this.armInv).multiply(parent.matrixWorld);
    _m.decompose(_v2, _qp, _s);
    _mi.copy(_m).invert();
    const tl = _v.copy(leg.target).applyMatrix4(_mi);
    const p0 = leg.upper.position;
    const dy = tl.y - p0.y;
    const dz = tl.z - p0.z;
    const Lraw = Math.hypot(dy, dz);
    const Lc = clamp(Lraw, Math.abs(leg.l1 - leg.l2) + 1e-4, leg.l1 + leg.l2 - 1e-4);
    const phid = Math.atan2(dz, dy);
    const a = Math.acos(clamp((leg.l1 * leg.l1 + Lc * Lc - leg.l2 * leg.l2) / (2 * leg.l1 * Lc), -1, 1));
    const phi1 = phid - leg.bend * a;
    const ky = p0.y + Math.cos(phi1) * leg.l1;
    const kz = p0.z + Math.sin(phi1) * leg.l1;
    const ey = p0.y + Math.cos(phid) * Lc;
    const ez = p0.z + Math.sin(phid) * Lc;
    const phi2 = Math.atan2(ez - kz, ey - ky);
    const th1 = wrap(phi1 - leg.phi1);
    const th2 = wrap(phi2 - leg.phi2 - th1);
    _e.set(th1, 0, abduct, 'ZYX');
    leg.upper.quaternion.setFromEuler(_e);
    leg.lower.quaternion.setFromAxisAngle(X, th2);
    // end (foot / hand): flat on the ground (rest orientation) turned by endPitch, in the model frame
    _q.copy(_qp).multiply(leg.upper.quaternion).multiply(leg.lower.quaternion).invert();
    _q2.setFromAxisAngle(X, endPitch);
    leg.end.quaternion.copy(_q).multiply(_q2);
    if (leg.toe) leg.toe.quaternion.setFromAxisAngle(X, -endPitch * 0.6);
  }
}
