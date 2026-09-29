import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

/** Collision group bits. A collider interacts with another when each one's membership is in the other's filter. */
export const G = {
  WORLD: 1 << 0, // static level geometry
  PROP: 1 << 1, // dynamic props
  PLAYER: 1 << 2,
  NPC: 1 << 3, // walking humans (kinematic-ish capsules)
  RAGDOLL: 1 << 4, // ragdoll limbs
  TRIGGER: 1 << 5, // sensors
  WATER: 1 << 6, // water sensors
  HELD: 1 << 7, // item currently carried by Jimothy
  VEHICLE: 1 << 8,
  DEBRIS: 1 << 9, // tiny particles that only hit the world
  ANIMAL: 1 << 10,
  ALL: 0xffff,
} as const;

/** Build a Rapier InteractionGroups value. */
export function groups(member: number, filter: number = G.ALL): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider: RAPIER.Collider;
}

interface Link {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  /** Visual offset in body-local space. */
  offset?: THREE.Vector3;
}

export interface ContactForceInfo {
  c1: RAPIER.Collider;
  c2: RAPIER.Collider;
  force: number;
  direction: THREE.Vector3;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Physics {
  world!: RAPIER.World;
  eventQueue!: RAPIER.EventQueue;
  readonly gravity = -14;
  private links = new Map<number, Link>();
  private contactHandlers: ((info: ContactForceInfo) => void)[] = [];
  private collisionHandlers: ((c1: RAPIER.Collider, c2: RAPIER.Collider, started: boolean) => void)[] = [];
  /** Accumulated simulation time. */
  time = 0;

  static async create(): Promise<Physics> {
    await RAPIER.init();
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: p.gravity, z: 0 });
    p.eventQueue = new RAPIER.EventQueue(true);
    return p;
  }

  step(dt: number) {
    // Variable timestep, clamped for stability. Two substeps when the frame is long.
    const clamped = Math.min(dt, 1 / 20);
    const steps = clamped > 1 / 45 ? 2 : 1;
    const h = Math.max(clamped / steps, 1 / 400);
    for (let i = 0; i < steps; i++) {
      this.world.timestep = h;
      this.world.step(this.eventQueue);
      this.time += h;
      this.drainEvents();
    }
    this.syncLinks();
  }

  private drainEvents() {
    const world = this.world;
    // Collect first, dispatch after draining: handlers may freely mutate the world.
    const collisions: [number, number, boolean][] = [];
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (this.collisionHandlers.length) collisions.push([h1, h2, started]);
    });
    const forces: { h1: number; h2: number; force: number; dir: THREE.Vector3 }[] = [];
    this.eventQueue.drainContactForceEvents((ev) => {
      if (!this.contactHandlers.length) return;
      const d = ev.maxForceDirection();
      forces.push({ h1: ev.collider1(), h2: ev.collider2(), force: ev.totalForceMagnitude(), dir: new THREE.Vector3(d.x, d.y, d.z) });
    });
    for (const [h1, h2, started] of collisions) {
      const c1 = world.getCollider(h1);
      const c2 = world.getCollider(h2);
      if (!c1 || !c2) continue;
      for (const fn of this.collisionHandlers) {
        try {
          fn(c1, c2, started);
        } catch (err) {
          console.error('[physics] collision handler failed', err);
        }
      }
    }
    for (const f of forces) {
      const c1 = world.getCollider(f.h1);
      const c2 = world.getCollider(f.h2);
      if (!c1 || !c2) continue;
      const info: ContactForceInfo = { c1, c2, force: f.force, direction: f.dir };
      for (const fn of this.contactHandlers) {
        try {
          fn(info);
        } catch (err) {
          console.error('[physics] contact handler failed', err);
        }
      }
    }
  }

  /**
   * Newly created colliders are invisible to scene queries (raycasts) until the next physics step.
   * Call this after building lots of static geometry so later setup code can raycast against it.
   */
  refreshQueries() {
    const dt = this.world.timestep;
    this.world.timestep = 1e-6;
    this.world.step(this.eventQueue);
    this.world.timestep = dt;
  }

  onContactForce(fn: (info: ContactForceInfo) => void) {
    this.contactHandlers.push(fn);
  }

  onCollision(fn: (c1: RAPIER.Collider, c2: RAPIER.Collider, started: boolean) => void) {
    this.collisionHandlers.push(fn);
  }

  /** Make `object` follow `body` every step (object must be a direct child of the scene). */
  link(body: RAPIER.RigidBody, object: THREE.Object3D, offset?: THREE.Vector3) {
    this.links.set(body.handle, { body, object, offset });
    this.syncOne({ body, object, offset });
  }

  unlink(body: RAPIER.RigidBody) {
    this.links.delete(body.handle);
  }

  private syncOne(l: Link) {
    const t = l.body.translation();
    const r = l.body.rotation();
    l.object.quaternion.set(r.x, r.y, r.z, r.w);
    if (l.offset) {
      _v.copy(l.offset).applyQuaternion(l.object.quaternion);
      l.object.position.set(t.x + _v.x, t.y + _v.y, t.z + _v.z);
    } else {
      l.object.position.set(t.x, t.y, t.z);
    }
  }

  private syncLinks() {
    for (const l of this.links.values()) {
      if (l.body.isSleeping()) continue;
      this.syncOne(l);
    }
  }

  /** Create a rigid body with colliders. */
  createBody(
    desc: RAPIER.RigidBodyDesc,
    colliders: RAPIER.ColliderDesc[],
    object?: THREE.Object3D,
    offset?: THREE.Vector3,
  ): RAPIER.RigidBody {
    const body = this.world.createRigidBody(desc);
    for (const cd of colliders) this.world.createCollider(cd, body);
    if (object) this.link(body, object, offset);
    return body;
  }

  /** Convenience: dynamic body at the object's current transform. */
  createDynamic(
    object: THREE.Object3D,
    colliders: RAPIER.ColliderDesc[],
    opts: { linearDamping?: number; angularDamping?: number; ccd?: boolean; sleeping?: boolean; offset?: THREE.Vector3 } = {},
  ): RAPIER.RigidBody {
    object.updateMatrixWorld();
    object.getWorldPosition(_v);
    object.getWorldQuaternion(_q);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(_v.x, _v.y, _v.z)
      .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
      .setLinearDamping(opts.linearDamping ?? 0.05)
      .setAngularDamping(opts.angularDamping ?? 0.2)
      .setCcdEnabled(!!opts.ccd)
      .setSleeping(opts.sleeping ?? false);
    return this.createBody(desc, colliders, object, opts.offset);
  }

  /** Static (fixed) cuboid collider. rotation optional. Returns the collider. */
  staticBox(center: THREE.Vector3, half: THREE.Vector3, rot?: THREE.Quaternion, friction = 0.8): RAPIER.Collider {
    const cd = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(friction)
      .setCollisionGroups(groups(G.WORLD));
    if (rot) cd.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    return this.world.createCollider(cd);
  }

  staticCollider(cd: RAPIER.ColliderDesc): RAPIER.Collider {
    return this.world.createCollider(cd);
  }

  removeBody(body: RAPIER.RigidBody) {
    this.links.delete(body.handle);
    if (this.world.getRigidBody(body.handle)) this.world.removeRigidBody(body);
  }

  removeCollider(c: RAPIER.Collider) {
    if (this.world.getCollider(c.handle)) this.world.removeCollider(c, true);
  }

  /** Raycast returning the first hit with its normal. dir need not be normalised. */
  raycast(
    from: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    filter: number = groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE),
    exclude?: RAPIER.RigidBody,
    predicate?: (c: RAPIER.Collider) => boolean,
  ): RayHit | null {
    _v.copy(dir).normalize();
    // Tiny nudge: rays passing exactly through heightfield grid vertices can miss (degenerate case).
    const ray = new RAPIER.Ray({ x: from.x + 0.00137, y: from.y, z: from.z + 0.00071 }, { x: _v.x, y: _v.y, z: _v.z });
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, filter, undefined, exclude, predicate);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      point: new THREE.Vector3(from.x + _v.x * t, from.y + _v.y * t, from.z + _v.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: t,
      collider: hit.collider,
    };
  }

  /** Sweep a sphere; returns distance travelled to first hit plus the hit normal (on the other shape). */
  sphereCast(
    from: THREE.Vector3,
    dir: THREE.Vector3,
    radius: number,
    maxDist: number,
    filter: number = groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE),
    exclude?: RAPIER.RigidBody,
    predicate?: (c: RAPIER.Collider) => boolean,
  ): { distance: number; normal: THREE.Vector3; point: THREE.Vector3; collider: RAPIER.Collider } | null {
    _v.copy(dir).normalize();
    const hit = this.world.castShape(
      { x: from.x, y: from.y, z: from.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: _v.x, y: _v.y, z: _v.z },
      new RAPIER.Ball(radius),
      0,
      maxDist,
      true,
      undefined,
      filter,
      undefined,
      exclude,
      predicate,
    );
    if (!hit) return null;
    // Empirically (rapier 0.21) normal1 is the surface normal of the hit collider, pointing back toward the cast shape.
    return {
      distance: hit.time_of_impact,
      normal: new THREE.Vector3(hit.normal1.x, hit.normal1.y, hit.normal1.z),
      point: new THREE.Vector3(hit.witness1.x, hit.witness1.y, hit.witness1.z),
      collider: hit.collider,
    };
  }

  private thinCache = new Map<number, boolean>();
  /** True for pole/trunk-like colliders (the camera looks straight through those). */
  isThin(c: RAPIER.Collider): boolean {
    let v = this.thinCache.get(c.handle);
    if (v !== undefined) return v;
    const sh: any = c.shape;
    v = false;
    if (sh?.halfExtents) {
      const e = [sh.halfExtents.x, sh.halfExtents.y, sh.halfExtents.z].sort((a: number, b: number) => a - b);
      v = e[1] < 0.45;
    } else if (typeof sh?.radius === 'number' && !sh?.heights) {
      v = sh.radius < 0.5;
    }
    this.thinCache.set(c.handle, v);
    return v;
  }

  /** All colliders overlapping a sphere. */
  overlapSphere(
    center: THREE.Vector3,
    radius: number,
    filter: number = groups(G.ALL, G.PROP | G.NPC | G.RAGDOLL | G.VEHICLE | G.ANIMAL),
    exclude?: RAPIER.RigidBody,
  ): RAPIER.Collider[] {
    const out: RAPIER.Collider[] = [];
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Ball(radius),
      (c) => {
        out.push(c);
        return true;
      },
      undefined,
      filter,
      undefined,
      exclude,
    );
    return out;
  }
}

/** Helpers to convert between Three and Rapier vectors. */
export const toV3 = (v: { x: number; y: number; z: number }, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
export const toQuat = (q: { x: number; y: number; z: number; w: number }, out = new THREE.Quaternion()) =>
  out.set(q.x, q.y, q.z, q.w);
