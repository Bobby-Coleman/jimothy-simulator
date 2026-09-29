import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { RAPIER, G, groups } from '../../core/Physics';
import { BONES, BONE_PARENT, type BoneName, type Dims, type HumanRig } from './HumanModel';

/**
 * Jointed ragdoll (11 dynamic bodies + impulse joints with limits) built from a HumanRig's current pose.
 * Bones keep their hierarchy; while active, bone rotations are derived from the bodies each frame.
 */

export const RAGDOLL_FILTER = G.WORLD | G.PROP | G.PLAYER | G.NPC | G.RAGDOLL | G.VEHICLE | G.HELD | G.ANIMAL;

interface PartSpec {
  offset: THREE.Vector3;
  mass: number;
  make: () => RAPIER.ColliderDesc;
  extra?: () => RAPIER.ColliderDesc;
  ccd?: boolean;
}

type Limits = [number, number, number, number, number, number]; // xmin xmax ymin ymax zmin zmax

const LIMITS: Partial<Record<BoneName, Limits>> = {
  chest: [-0.45, 0.9, -0.5, 0.5, -0.35, 0.35],
  head: [-0.55, 0.7, -0.95, 0.95, -0.45, 0.45],
  uArmL: [-3.1, 1.0, -0.9, 0.9, -0.3, 2.9],
  uArmR: [-3.1, 1.0, -0.9, 0.9, -2.9, 0.3],
  thighL: [-1.9, 0.6, -0.5, 0.5, -0.25, 0.95],
  thighR: [-1.9, 0.6, -0.5, 0.5, -0.95, 0.25],
};
const HINGES: Partial<Record<BoneName, [number, number]>> = {
  lArmL: [-2.5, 0.05],
  lArmR: [-2.5, 0.05],
  shinL: [-0.05, 2.5],
  shinR: [-0.05, 2.5],
};

function specs(d: Dims): Record<BoneName, PartSpec> {
  const mf = d.s * d.s * (0.6 + 0.4 * d.b);
  const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  const cap = (len: number, r: number) => () => RAPIER.ColliderDesc.capsule(Math.max(0.01, len / 2 - r), r);
  const lArmLen = d.lArmLen + d.handR * 1.4;
  const foreR = d.foreR * 1.15;
  const legR = d.legR * 0.95;
  const arm = (): PartSpec => ({ offset: V(0, -d.uArmLen / 2), mass: 2.2 * mf, make: cap(d.uArmLen, d.armR) });
  const fore = (): PartSpec => ({ offset: V(0, -lArmLen / 2), mass: 1.8 * mf, make: cap(lArmLen, foreR) });
  const thigh = (): PartSpec => ({ offset: V(0, -d.thighLen / 2), mass: 7.5 * mf, make: cap(d.thighLen, legR) });
  const shinLen = d.shinLen + d.footH * 0.3;
  const shin = (): PartSpec => ({
    offset: V(0, -shinLen / 2),
    mass: 4 * mf,
    make: cap(shinLen, d.shinR),
    // shoe box, relative to the shin body center
    extra: () =>
      RAPIER.ColliderDesc.cuboid(d.footW / 2, d.footH / 2, d.footL / 2).setTranslation(0, -(d.shinLen + d.footH / 2) + shinLen / 2 + d.footH * 0.1, d.footZ),
  });
  return {
    pelvis: { offset: V(0, 0.03 * d.s), mass: 11 * mf, make: () => RAPIER.ColliderDesc.cuboid(d.pelvisW * 0.46, d.pelvisH * 0.48, d.pelvisD * 0.46), ccd: true },
    chest: { offset: V(0, d.chestH / 2), mass: 24 * mf, make: () => RAPIER.ColliderDesc.cuboid(d.chestW * 0.46, d.chestH * 0.47, d.chestD * 0.47), ccd: true },
    head: { offset: V(0, d.headOff), mass: 5 * mf, make: () => RAPIER.ColliderDesc.ball(d.headR * 1.02), ccd: true },
    uArmL: arm(),
    uArmR: arm(),
    lArmL: fore(),
    lArmR: fore(),
    thighL: thigh(),
    thighR: thigh(),
    shinL: shin(),
    shinR: shin(),
  };
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const LIMB_BONES: BoneName[] = ['uArmL', 'uArmR', 'lArmL', 'lArmR', 'thighL', 'thighR', 'shinL', 'shinR'];

export class Ragdoll {
  readonly bodies = {} as Record<BoneName, RAPIER.RigidBody>;
  readonly colliders: RAPIER.Collider[] = [];
  readonly joints: RAPIER.ImpulseJoint[] = [];
  readonly offsets = {} as Record<BoneName, THREE.Vector3>;
  readonly masses = {} as Record<BoneName, number>;
  totalMass = 0;
  /** Seconds since creation. */
  age = 0;
  /** Seconds the ragdoll has been (nearly) motionless. */
  restTime = 0;
  /** Highest pelvis height reached above the start. */
  startY = 0;
  maxY = -Infinity;
  private flailTimer = 0;
  alive = true;

  constructor(
    private game: Game,
    private rig: HumanRig,
  ) {}

  /** Create bodies & joints from the rig's current pose. Rig matrices must be up to date. */
  build(linvel: THREE.Vector3, filter = RAGDOLL_FILTER) {
    const game = this.game;
    const world = game.physics.world;
    const rig = this.rig;
    const S = specs(rig.dims);
    rig.root.updateMatrixWorld(true);
    const boneWorldPos = {} as Record<BoneName, THREE.Vector3>;
    for (const name of BONES) {
      const spec = S[name];
      const bone = rig.bones[name];
      const bp = bone.getWorldPosition(new THREE.Vector3());
      const bq = bone.getWorldQuaternion(new THREE.Quaternion());
      boneWorldPos[name] = bp;
      this.offsets[name] = spec.offset.clone();
      _p.copy(spec.offset).applyQuaternion(bq).add(bp);
      const desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(_p.x, _p.y, _p.z)
        .setRotation({ x: bq.x, y: bq.y, z: bq.z, w: bq.w })
        .setLinvel(linvel.x, linvel.y, linvel.z)
        .setLinearDamping(0.06)
        .setAngularDamping(0.5)
        .setCcdEnabled(!!spec.ccd);
      const body = world.createRigidBody(desc);
      const cd = spec.make().setMass(spec.mass).setFriction(0.6).setRestitution(0.08).setCollisionGroups(groups(G.RAGDOLL, filter));
      this.colliders.push(world.createCollider(cd, body));
      if (spec.extra) {
        const ex = spec.extra().setMass(spec.mass * 0.25).setFriction(0.8).setRestitution(0.05).setCollisionGroups(groups(G.RAGDOLL, filter));
        this.colliders.push(world.createCollider(ex, body));
      }
      this.bodies[name] = body;
      this.masses[name] = spec.mass * (spec.extra ? 1.25 : 1);
      this.totalMass += this.masses[name];
    }
    // joints at the child bone origins
    for (const name of BONES) {
      const parent = BONE_PARENT[name];
      if (!parent) continue;
      const b1 = this.bodies[parent];
      const b2 = this.bodies[name];
      const jw = boneWorldPos[name];
      const t1 = b1.translation();
      const r1 = b1.rotation();
      _q.set(r1.x, r1.y, r1.z, r1.w).invert();
      const a1 = _v.set(jw.x - t1.x, jw.y - t1.y, jw.z - t1.z).applyQuaternion(_q);
      const a2 = this.offsets[name].clone().negate();
      const hinge = HINGES[name];
      let joint: RAPIER.ImpulseJoint;
      if (hinge) {
        const jd = RAPIER.JointData.revolute({ x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z }, { x: 1, y: 0, z: 0 });
        joint = world.createImpulseJoint(jd, b1, b2, true);
        (joint as RAPIER.RevoluteImpulseJoint).setLimits(hinge[0], hinge[1]);
      } else {
        const jd = RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z });
        joint = world.createImpulseJoint(jd, b1, b2, true);
        const lim = LIMITS[name];
        const raw = (joint as any).rawSet;
        if (lim && raw?.jointSetLimits) {
          raw.jointSetLimits(joint.handle, RAPIER.JointAxis.AngX, lim[0], lim[1]);
          raw.jointSetLimits(joint.handle, RAPIER.JointAxis.AngY, lim[2], lim[3]);
          raw.jointSetLimits(joint.handle, RAPIER.JointAxis.AngZ, lim[4], lim[5]);
        }
      }
      joint.setContactsEnabled(false);
      this.joints.push(joint);
    }
    const pt = this.bodies.pelvis.translation();
    this.startY = pt.y;
    this.maxY = pt.y;
  }

  /** Spread an impulse over the whole body (a share goes to the part nearest `point`). */
  applyImpulse(impulse: THREE.Vector3, point?: THREE.Vector3, focus = 0.3) {
    let nearest: BoneName | null = null;
    if (point) {
      let best = Infinity;
      for (const name of BONES) {
        const t = this.bodies[name].translation();
        const d = (t.x - point.x) ** 2 + (t.y - point.y) ** 2 + (t.z - point.z) ** 2;
        if (d < best) {
          best = d;
          nearest = name;
        }
      }
    }
    const rest = nearest ? 1 - focus : 1;
    for (const name of BONES) {
      const share = (this.masses[name] / this.totalMass) * rest + (name === nearest ? focus : 0);
      this.bodies[name].applyImpulse({ x: impulse.x * share, y: impulse.y * share, z: impulse.z * share }, true);
    }
  }

  /** Add the same velocity change to every part. */
  addVelocity(dv: THREE.Vector3) {
    for (const name of BONES) {
      const b = this.bodies[name];
      const v = b.linvel();
      b.setLinvel({ x: v.x + dv.x, y: v.y + dv.y, z: v.z + dv.z }, true);
    }
  }

  /** Random limb spins for comedy. */
  flail(strength = 1) {
    for (const name of LIMB_BONES) {
      const m = this.masses[name];
      const k = m * 0.055 * strength;
      this.bodies[name].applyTorqueImpulse({ x: (Math.random() - 0.5) * k, y: (Math.random() - 0.5) * k * 0.4, z: (Math.random() - 0.5) * k }, true);
    }
  }

  pelvisPosition(out = new THREE.Vector3()) {
    const t = this.bodies.pelvis.translation();
    return out.set(t.x, t.y, t.z);
  }

  headPosition(out = new THREE.Vector3()) {
    const t = this.bodies.head.translation();
    return out.set(t.x, t.y, t.z);
  }

  /** Max linear speed of the core parts. */
  coreSpeed() {
    let m = 0;
    for (const n of ['pelvis', 'chest', 'head'] as BoneName[]) {
      const v = this.bodies[n].linvel();
      m = Math.max(m, Math.hypot(v.x, v.y, v.z));
    }
    return m;
  }

  /** Per-frame bookkeeping (flailing, rest timer, max height). */
  step(dt: number, flailing: boolean) {
    this.age += dt;
    const p = this.bodies.pelvis.translation();
    if (p.y > this.maxY) this.maxY = p.y;
    if (flailing) {
      this.flailTimer -= dt;
      if (this.flailTimer <= 0) {
        this.flailTimer = 0.1 + Math.random() * 0.08;
        this.flail(this.age < 0.4 ? 1.4 : 1);
      }
    }
    if (this.coreSpeed() < 0.45) this.restTime += dt;
    else this.restTime = Math.max(0, this.restTime - dt * 2);
  }

  /** Drive the rig's bones from the bodies: root at the pelvis bone origin, rotations from bodies. */
  sync() {
    const rig = this.rig;
    const B = rig.bones;
    const pb = this.bodies.pelvis;
    const t = pb.translation();
    const r = pb.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _p.copy(this.offsets.pelvis).applyQuaternion(_q);
    rig.root.position.set(t.x - _p.x, t.y - _p.y, t.z - _p.z);
    rig.root.quaternion.identity();
    B.pelvis.position.set(0, 0, 0);
    B.pelvis.quaternion.copy(_q);
    for (const name of BONES) {
      const parent = BONE_PARENT[name];
      if (!parent) continue;
      const pr = this.bodies[parent].rotation();
      const cr = this.bodies[name].rotation();
      _q.set(pr.x, pr.y, pr.z, pr.w).invert();
      _q2.set(cr.x, cr.y, cr.z, cr.w);
      B[name].quaternion.multiplyQuaternions(_q, _q2);
      B[name].position.copy(rig.bindLocal[name]);
    }
  }

  /** World transform of a bone's origin (from its body). */
  boneWorld(name: BoneName, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const b = this.bodies[name];
    const t = b.translation();
    const r = b.rotation();
    quat.set(r.x, r.y, r.z, r.w);
    pos.copy(this.offsets[name]).applyQuaternion(quat).negate().add(_v.set(t.x, t.y, t.z));
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    const game = this.game;
    for (const c of this.colliders) game.entities.unbindCollider(c);
    for (const name of BONES) {
      const b = this.bodies[name];
      if (b) game.physics.removeBody(b);
    }
    this.joints.length = 0;
    this.colliders.length = 0;
  }
}
