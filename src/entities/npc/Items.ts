import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER } from '../../core/Physics';
import { spawnProp, destroyProp } from '../Props';
import type { HoldingKind } from './types';

/**
 * Items humans carry around: phone, coffee, sandwich, pizza, ice cream, cotton candy.
 * They are real grabbable prop entities. While held by an NPC the body is disabled and the visual is
 * parented to the NPC's hand; Jimothy steals them via the NPC's onGrab (the player then emits 'steal').
 */

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function M(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

class ItemBuilder {
  parts: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, color: number, m?: THREE.Matrix4, emissive = 0) {
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.index) g = mergeVertices(g, 1e-5);
    if (m) g.applyMatrix4(m);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    _c.setHex(color);
    const k = 1 + emissive;
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r * k;
      col[i * 3 + 1] = _c.g * k;
      col[i * 3 + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
  }
  mesh(): THREE.Mesh {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    const mesh = new THREE.Mesh(g, itemMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

let itemMat: THREE.MeshStandardMaterial | null = null;
function itemMaterial() {
  if (!itemMat) itemMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
  return itemMat;
}

const rbox = (w: number, h: number, d: number, r: number) => {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  g.deleteAttribute('uv');
  return mergeVertices(g, 1e-5);
};

/** Model geometry cache (one merged geometry per kind, shared by all copies). */
const geoCache = new Map<HoldingKind, THREE.BufferGeometry>();

function buildModel(kind: HoldingKind): THREE.Mesh {
  const cached = geoCache.get(kind);
  if (cached) {
    const m = new THREE.Mesh(cached, itemMaterial());
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  const B = new ItemBuilder();
  switch (kind) {
    case 'phone':
      B.add(rbox(0.078, 0.155, 0.014, 0.012), 0x1e2126);
      B.add(rbox(0.068, 0.135, 0.004, 0.006), 0x57b8ff, M(0, 0.002, 0.006), 0.6);
      B.add(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 10), 0x0b0b0b, M(-0.02, 0.055, -0.008, Math.PI / 2, 0, 0));
      break;
    case 'coffee':
      B.add(new THREE.CylinderGeometry(0.046, 0.036, 0.13, 14), 0xf5f1e8, M(0, 0.065, 0));
      B.add(new THREE.CylinderGeometry(0.047, 0.042, 0.05, 14), 0x8a5a3c, M(0, 0.06, 0));
      B.add(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 10), 0x2e8b57, M(0, 0.06, 0.044, Math.PI / 2, 0, 0));
      B.add(new THREE.CylinderGeometry(0.049, 0.049, 0.014, 14), 0xf5f1e8, M(0, 0.135, 0));
      B.add(new THREE.SphereGeometry(0.042, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xf5f1e8, M(0, 0.14, 0, 0, 0, 0, 1, 0.35, 1));
      break;
    case 'sandwich': {
      const tri = (h: number, color: number, y: number, s = 1) =>
        B.add(new THREE.CylinderGeometry(0.085 * s, 0.085 * s, h, 3), color, M(0, y, 0, 0, Math.PI / 6, 0));
      tri(0.024, 0xe8c07d, 0.012);
      tri(0.012, 0x6dbb45, 0.029, 1.08);
      tri(0.01, 0xd8402c, 0.039, 1.02);
      tri(0.008, 0xf2c230, 0.047, 1.06);
      tri(0.024, 0xe8c07d, 0.062);
      break;
    }
    case 'pizza':
      B.add(new THREE.CylinderGeometry(0.19, 0.19, 0.025, 24), 0xd89a4a, M(0, 0.0125, 0));
      B.add(new THREE.CylinderGeometry(0.168, 0.168, 0.01, 24), 0xf4c542, M(0, 0.027, 0));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const r = i === 6 ? 0 : 0.1;
        B.add(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 12), 0xb8322b, M(Math.cos(a) * r, 0.033, Math.sin(a) * r));
      }
      break;
    case 'icecream':
      B.add(new THREE.ConeGeometry(0.042, 0.12, 12), 0xd9a15b, M(0, 0.06, 0, Math.PI, 0, 0));
      B.add(new THREE.SphereGeometry(0.047, 12, 9), 0xf5a3c7, M(0, 0.13, 0));
      B.add(new THREE.SphereGeometry(0.042, 12, 9), 0xa8e6c5, M(0.005, 0.195, 0));
      B.add(new THREE.SphereGeometry(0.012, 8, 6), 0xd62839, M(0.005, 0.245, 0));
      break;
    case 'cottoncandy':
      B.add(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), 0xf2e3c6, M(0, 0.15, 0));
      B.add(new THREE.SphereGeometry(0.12, 14, 10), 0xff9fd2, M(0, 0.36, 0, 0, 0, 0, 1, 1.2, 1));
      B.add(new THREE.SphereGeometry(0.07, 10, 8), 0xa6d8ff, M(0.06, 0.43, 0.04));
      break;
  }
  const mesh = B.mesh();
  geoCache.set(kind, mesh.geometry);
  return mesh;
}

interface ItemDef {
  name: string;
  mass: number;
  tags: string[];
  shape?: 'box' | 'cylinder' | 'ball';
  onWash?: (game: Game, e: Entity) => void;
}

const DEFS: Record<HoldingKind, ItemDef> = {
  phone: {
    name: 'Phone',
    mass: 0.2,
    tags: ['grabbable', 'phone', 'shiny', 'washable'],
    onWash(game, e) {
      const n = (e.data.washCount = (e.data.washCount ?? 0) + 1);
      game.events.emit('sparkle', { entity: e });
      game.sfx('short_circuit', e.object?.position);
      if (n === 1) game.score(250, 'Washed A Phone');
      else game.score(20, 'Phone Is Extra Clean');
      e.data.washed = true;
      e.data.shortCircuited = true;
    },
  },
  coffee: {
    name: 'Coffee',
    mass: 0.35,
    tags: ['grabbable', 'coffee', 'drink', 'washable'],
    shape: 'cylinder',
    onWash(game, e) {
      game.events.emit('sparkle', { entity: e });
      game.score(e.data.washed ? 10 : 70, e.data.washed ? 'Very Watered-Down Coffee' : 'Iced Coffee Now');
      e.data.washed = true;
    },
  },
  sandwich: {
    name: 'Sandwich',
    mass: 0.3,
    tags: ['grabbable', 'food', 'sandwich', 'washable'],
    onWash(game, e) {
      game.events.emit('sparkle', { entity: e });
      game.score(e.data.washed ? 10 : 60, e.data.washed ? 'Soup Now' : 'Soggy Sandwich');
      e.data.washed = true;
    },
  },
  pizza: { name: 'Pizza', mass: 0.8, tags: ['grabbable', 'food', 'pizza', 'washable'], shape: 'cylinder' },
  icecream: { name: 'Ice Cream', mass: 0.2, tags: ['grabbable', 'food', 'icecream', 'washable'] },
  cottoncandy: {
    name: 'Cotton Candy',
    mass: 0.15,
    tags: ['grabbable', 'food', 'cottoncandy', 'washable'],
    onWash(game, e) {
      // Canon: raccoons wash cotton candy and it dissolves. Jimothy stares at his empty hands.
      game.score(250, "Where'd It Go?");
      game.hint('Jimothy washed the cotton candy. It is gone. He stares at his empty hands.', 4);
      game.sfx('sad_trombone');
      game.events.emit('cottonCandyGone', { entity: e });
      const p = game.get<any>('player');
      if (p?.held?.entity === e) p.release(false);
      destroyProp(game, e);
    },
  },
};

/** Spawn an item entity (dynamic prop). */
export function spawnItem(game: Game, kind: HoldingKind, pos: THREE.Vector3): Entity {
  const def = DEFS[kind];
  const e = spawnProp(
    game,
    {
      name: def.name,
      object: buildModel(kind),
      shape: def.shape ?? 'box',
      mass: def.mass,
      tags: def.tags,
      ccd: true,
      sleeping: false,
      restitution: 0.25,
      data: { itemKind: kind, buoyancy: 2.2 },
      onWash: def.onWash ? (g) => def.onWash!(g, e) : undefined,
    },
    pos,
  );
  return e;
}

/** Holding pose per kind: local offset from the palm + orientation (applied in world space by the NPC). */
export const GRIP: Record<HoldingKind, { offset: THREE.Vector3 }> = {
  phone: { offset: new THREE.Vector3(0, -0.02, 0.02) },
  coffee: { offset: new THREE.Vector3(0, -0.01, 0.03) },
  sandwich: { offset: new THREE.Vector3(0, -0.01, 0.03) },
  pizza: { offset: new THREE.Vector3(0, -0.03, 0.06) },
  icecream: { offset: new THREE.Vector3(0, 0.0, 0.03) },
  cottoncandy: { offset: new THREE.Vector3(0, -0.02, 0.03) },
};

/** Put an item entity into an NPC hand: disable physics, parent the visual to `hand`. */
export function attachItem(game: Game, item: Entity, hand: THREE.Object3D) {
  const body = item.body;
  const obj = item.object;
  if (!body || !obj) return;
  game.physics.unlink(body);
  body.setLinvel({ x: 0, y: 0, z: 0 }, false);
  body.setAngvel({ x: 0, y: 0, z: 0 }, false);
  body.setEnabled(false);
  hand.add(obj);
  const kind = item.data.itemKind as HoldingKind;
  obj.position.copy(GRIP[kind]?.offset ?? new THREE.Vector3());
  obj.quaternion.identity();
  item.data.heldByNpc = true;
}

/** Release an item from an NPC hand at its current world transform, with an initial velocity. */
export function detachItem(game: Game, item: Entity, velocity?: THREE.Vector3, spin = 0) {
  const body = item.body;
  const obj = item.object;
  item.data.heldByNpc = false;
  if (!body || !obj || !item.alive) return;
  obj.updateMatrixWorld(true);
  const p = obj.getWorldPosition(new THREE.Vector3());
  const q = obj.getWorldQuaternion(new THREE.Quaternion());
  game.scene.attach(obj);
  obj.position.copy(p);
  obj.quaternion.copy(q);
  body.setEnabled(true);
  body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
  body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
  body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
  const v = velocity ?? new THREE.Vector3();
  body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
  body.setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin }, true);
  game.physics.link(body, obj);
}

export function itemName(kind: HoldingKind) {
  return DEFS[kind].name;
}
