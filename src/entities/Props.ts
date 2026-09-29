import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Entity, EntityKind } from '../core/Entities';
import { RAPIER, G, groups } from '../core/Physics';
import { noTinyShadows } from '../world/DetailCuller';

export type ColliderShape = 'box' | 'cylinder' | 'ball' | 'capsule' | 'hull';

export interface PropSpec {
  name: string;
  /** Visual; will be re-centred on its bounding box center. */
  object: THREE.Object3D;
  shape?: ColliderShape;
  /** Full collider size override (defaults to the object's bounding box). */
  size?: THREE.Vector3;
  mass: number;
  tags?: string[];
  kind?: EntityKind;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  ccd?: boolean;
  /** Start asleep (cheap until touched). Default true. */
  sleeping?: boolean;
  /** Group override */
  collisionGroups?: number;
  /** Report contact forces above this threshold (N) to the impact system. Default based on mass. */
  impactThreshold?: number;
  data?: Record<string, any>;
  onWash?: Entity['onWash'];
  onBonk?: Entity['onBonk'];
  onImpact?: Entity['onImpact'];
  onGrab?: Entity['onGrab'];
  onRelease?: Entity['onRelease'];
  update?: Entity['update'];
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

/**
 * Spawn a dynamic physics prop and register it as an entity.
 * position = where the bottom-center of the object should rest (y = ground height).
 */
export function spawnProp(game: Game, spec: PropSpec, position: THREE.Vector3, rotY = 0): Entity {
  const obj = spec.object;
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.updateMatrixWorld(true);
  _box.setFromObject(obj);
  _box.getSize(_size);
  _box.getCenter(_center);
  const size = spec.size ? spec.size.clone() : _size.clone();
  size.x = Math.max(size.x, 0.05);
  size.y = Math.max(size.y, 0.05);
  size.z = Math.max(size.z, 0.05);

  const holder = new THREE.Group();
  holder.name = spec.name;
  obj.position.copy(_center).negate();
  holder.add(obj);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  noTinyShadows(holder, 0.3);

  // Body origin at the bbox center; place so the bottom sits at position.y
  const bottomOffset = spec.size ? size.y / 2 : _center.y - _box.min.y;
  holder.position.set(position.x, position.y + bottomOffset + 0.01, position.z);
  holder.rotation.y = rotY;
  game.scene.add(holder);

  const cd = makeCollider(spec.shape ?? 'box', size, obj);
  cd.setMass(spec.mass)
    .setFriction(spec.friction ?? 0.7)
    .setRestitution(spec.restitution ?? 0.2)
    .setCollisionGroups(spec.collisionGroups ?? groups(G.PROP))
    .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
    .setContactForceEventThreshold(spec.impactThreshold ?? Math.max(60, spec.mass * 60));

  const body = game.physics.createDynamic(holder, [cd], {
    linearDamping: spec.linearDamping ?? 0.05,
    angularDamping: spec.angularDamping ?? 0.25,
    ccd: spec.ccd,
    sleeping: spec.sleeping ?? true,
  });

  const e = game.entities.create({
    kind: spec.kind ?? 'prop',
    name: spec.name,
    object: holder,
    body,
    mass: spec.mass,
    tags: new Set(spec.tags ?? ['grabbable']),
    data: { size, floatRadius: Math.max(size.x, size.y, size.z) / 2, ...(spec.data ?? {}) },
    onWash: spec.onWash,
    onBonk: spec.onBonk,
    onImpact: spec.onImpact,
    onGrab: spec.onGrab,
    onRelease: spec.onRelease,
    update: spec.update,
  });
  return e;
}

function makeCollider(shape: ColliderShape, size: THREE.Vector3, obj: THREE.Object3D): RAPIER.ColliderDesc {
  switch (shape) {
    case 'ball':
      return RAPIER.ColliderDesc.ball(Math.max(size.x, size.y, size.z) / 2);
    case 'cylinder':
      return RAPIER.ColliderDesc.cylinder(size.y / 2, Math.max(size.x, size.z) / 2);
    case 'capsule': {
      const r = Math.max(size.x, size.z) / 2;
      return RAPIER.ColliderDesc.capsule(Math.max(0.01, size.y / 2 - r), r);
    }
    case 'hull': {
      const pts: number[] = [];
      obj.updateMatrixWorld(true);
      const parentInv = new THREE.Matrix4().copy(obj.parent ? obj.parent.matrixWorld : new THREE.Matrix4()).invert();
      const v = new THREE.Vector3();
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.getAttribute('position');
        const step = Math.max(1, Math.floor(pos.count / 200));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(parentInv);
          pts.push(v.x, v.y, v.z);
        }
      });
      const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
      if (hull) return hull;
      return RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
    }
    default:
      return RAPIER.ColliderDesc.roundCuboid(
        Math.max(0.01, size.x / 2 - 0.02),
        Math.max(0.01, size.y / 2 - 0.02),
        Math.max(0.01, size.z / 2 - 0.02),
        0.02,
      );
  }
}

/** Remove a prop entity entirely (visual + body + registry). */
export function destroyProp(game: Game, e: Entity) {
  if (!e.alive) return;
  e.dispose?.(game);
  game.entities.remove(e);
  if (e.body) game.physics.removeBody(e.body);
  e.object?.removeFromParent();
}

// ------------------------------------------------------------------ primitive prop builders

export function mat(color: THREE.ColorRepresentation, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts });
}

export function box(w: number, h: number, d: number, material: THREE.Material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function cylinder(rTop: number, rBottom: number, h: number, material: THREE.Material, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function sphere(r: number, material: THREE.Material, seg = 20) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, Math.floor(seg * 0.7))), material);
  m.castShadow = m.receiveShadow = true;
  return m;
}
