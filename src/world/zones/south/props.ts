import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { spawnProp, destroyProp } from '../../../entities/Props';
import { bakeJimothy, type BakedPart, type JimothyPose } from '../../../player/JimothyBake';
import { bake, GEO } from './kit';

/**
 * Dynamic, grabbable props for the west/south zones. All procedural (vertex-coloured, one mesh each)
 * so they load instantly and share geometry/materials.
 */

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function vmat(key: string, opts: THREE.MeshStandardMaterialParameters = {}) {
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, ...opts });
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Colour a geometry's vertices with fn(x, y, z) → color (returns a new non-shared geometry). */
function painted(src: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => THREE.ColorRepresentation) {
  const g = src.clone();
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.set(fn(pos.getX(i), pos.getY(i), pos.getZ(i)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ------------------------------------------------------------------ trash can

export function trashCan(game: Game, x: number, y: number, z: number, color: THREE.ColorRepresentation = 0x2f6a4a) {
  const key = `can|${new THREE.Color(color).getHexString()}`;
  const geo = cached(key, () =>
    bake([
      { geo: GEO.cyl(1.08, 14), pos: [0, 0.46, 0], scale: [0.3, 0.92, 0.3], color },
      { geo: GEO.cyl(1, 14), pos: [0, 0.2, 0], scale: [0.315, 0.08, 0.315], color: 0x1d2b24 },
      { geo: GEO.cyl(1, 14), pos: [0, 0.72, 0], scale: [0.335, 0.06, 0.335], color: 0x1d2b24 },
      { geo: GEO.cyl(0.85, 14), pos: [0, 0.97, 0], scale: [0.35, 0.1, 0.35], color: 0x243a2e },
      { geo: GEO.box, pos: [0, 1.05, 0], scale: [0.2, 0.05, 0.06], color: 0x1d2b24 },
    ]),
  );
  return spawnProp(
    game,
    { name: 'Trash Can', object: mesh(geo, vmat('metalish', { roughness: 0.45, metalness: 0.35 })), shape: 'cylinder', mass: 9, tags: ['grabbable', 'trashcan', 'washable'] },
    V(x, y, z),
    x * 0.7,
  );
}

// ------------------------------------------------------------------ picnic food

export function sandwich(game: Game, x: number, y: number, z: number, rotY = 0) {
  const geo = cached('sandwich', () =>
    bake([
      { geo: GEO.box, pos: [0, 0.02, 0], scale: [0.2, 0.04, 0.2], color: 0xe8c07a },
      { geo: GEO.box, pos: [0, 0.047, 0], scale: [0.225, 0.014, 0.225], color: 0x5fbf3a },
      { geo: GEO.box, pos: [0, 0.06, 0], scale: [0.19, 0.016, 0.19], color: 0xd84a3a },
      { geo: GEO.box, pos: [0, 0.071, 0], rot: [0, 0.6, 0], scale: [0.17, 0.01, 0.17], color: 0xffcc33 },
      { geo: GEO.box, pos: [0, 0.098, 0], scale: [0.2, 0.045, 0.2], color: 0xe3b36a },
      { geo: GEO.box, pos: [0, 0.121, 0], scale: [0.19, 0.004, 0.19], color: 0xc9914a },
    ]),
  );
  return spawnProp(game, { name: 'Sandwich', object: mesh(geo, vmat('food')), mass: 0.3, tags: ['grabbable', 'food'] }, V(x, y, z), rotY);
}

export function watermelonSlice(game: Game, x: number, y: number, z: number, rotY = 0) {
  const geo = cached('melon', () => {
    // half disc standing on its flat edge: flesh inside, white band, green rind
    const half = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14, 1, false, 0, Math.PI);
    const g = painted(half, (px, py, pz) => {
      const r = Math.hypot(px, pz);
      return r > 0.185 ? 0x2f8f2f : r > 0.165 ? 0xe8f5c8 : 0xf0445a;
    });
    const parts: Parameters<typeof bake>[0] = [{ geo: g, rot: [Math.PI / 2, 0, 0], pos: [0, 0, 0], color: 0xffffff, keepColors: true }];
    for (let i = 0; i < 6; i++) {
      const a = 0.4 + i * 0.45;
      const rr = 0.07 + (i % 2) * 0.05;
      parts.push({ geo: GEO.box, pos: [Math.cos(a) * rr, Math.sin(a) * rr, 0.031], rot: [0, 0, a], scale: [0.022, 0.012, 0.004], color: 0x1a1a1a });
      parts.push({ geo: GEO.box, pos: [Math.cos(a) * rr, Math.sin(a) * rr, -0.031], rot: [0, 0, a], scale: [0.022, 0.012, 0.004], color: 0x1a1a1a });
    }
    return bake(parts);
  });
  return spawnProp(game, { name: 'Watermelon Slice', object: mesh(geo, vmat('food')), mass: 0.4, tags: ['grabbable', 'food'] }, V(x, y, z), rotY);
}

export function cottonCandy(game: Game, x: number, y: number, z: number, color: THREE.ColorRepresentation = 0xff9fd2) {
  const key = `cc|${new THREE.Color(color).getHexString()}`;
  const geo = cached(key, () =>
    bake([
      { geo: GEO.cyl(1, 6), pos: [0, 0.17, 0], scale: [0.015, 0.35, 0.015], color: 0xf2e3c6 },
      { geo: GEO.ico(1), pos: [0, 0.42, 0], scale: [0.16, 0.19, 0.16], color },
      { geo: GEO.ico(1), pos: [0.05, 0.5, 0.03], scale: [0.11, 0.11, 0.11], color },
      { geo: GEO.ico(1), pos: [-0.05, 0.47, -0.04], scale: [0.1, 0.1, 0.1], color },
    ]),
  );
  let ent: Entity | undefined;
  ent = spawnProp(
    game,
    {
      name: 'Cotton Candy',
      object: mesh(geo, vmat('fluff', { roughness: 1 })),
      mass: 0.2,
      tags: ['grabbable', 'food', 'cottoncandy'],
      onWash(g) {
        g.score(250, "Where'd It Go?");
        g.hint('Jimothy washed the cotton candy. It is gone. He stares at his empty hands.', 4);
        g.sfx('sad_trombone');
        g.events.emit('cottonCandyGone', {});
        const p = g.get<any>('player');
        const e = p?.held?.entity ?? ent;
        if (p?.held?.entity) p.release(false);
        if (e) destroyProp(g, e);
      },
    },
    V(x, y, z),
  );
  return ent;
}

export function hotDog(game: Game, x: number, y: number, z: number, rotY = 0) {
  const geo = cached('hotdog', () =>
    bake([
      { geo: GEO.sphere(10, 6), pos: [0, 0.04, 0], scale: [0.2, 0.045, 0.06], color: 0xe6b36a },
      { geo: GEO.sphere(10, 6), pos: [0, 0.07, 0], scale: [0.23, 0.035, 0.035], color: 0xb4452f },
      { geo: GEO.box, pos: [0, 0.103, 0], scale: [0.3, 0.012, 0.018], rot: [0, 0.15, 0], color: 0xffd21f },
    ]),
  );
  return spawnProp(game, { name: 'Hot Dog', object: mesh(geo, vmat('food')), mass: 0.25, tags: ['grabbable', 'food'] }, V(x, y, z), rotY);
}

// ------------------------------------------------------------------ fish & seafood

export type FishKind = 'salmon' | 'cod' | 'snapper';
const FISH_COLORS: Record<FishKind, [number, number, number]> = {
  salmon: [0x3e5566, 0xf0877a, 0xe7edf0],
  cod: [0x6b6f4e, 0xb9b79a, 0xf1efe4],
  snapper: [0xd8322f, 0xf07a6a, 0xffd6c8],
};

export function fishGeometry(kind: FishKind) {
  return cached(`fish|${kind}`, () => {
    const [back, band, belly] = FISH_COLORS[kind];
    const body = new THREE.SphereGeometry(1, 14, 10);
    const pos = body.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const k = z < 0 ? 1 + z * 0.55 : 1 - z * 0.12; // taper to the tail
      pos.setX(i, pos.getX(i) * k);
      pos.setY(i, pos.getY(i) * k);
    }
    body.computeVertexNormals();
    const bodyP = painted(body, (x, y) => (y > 0.3 ? back : y > -0.15 ? band : belly));
    return bake([
      { geo: bodyP, scale: [0.09, 0.12, 0.34], color: 0xffffff, keepColors: true },
      { geo: GEO.cyl(0.02, 4), pos: [0, 0, -0.38], rot: [Math.PI / 2, 0, 0], scale: [0.13, 0.14, 0.13], color: back },
      { geo: GEO.box, pos: [0, 0.13, -0.02], rot: [0.5, 0, 0], scale: [0.012, 0.07, 0.1], color: back },
      { geo: GEO.sphere(8, 6), pos: [0.062, 0.03, 0.22], scale: 0.022, color: 0x111111 },
      { geo: GEO.sphere(8, 6), pos: [-0.062, 0.03, 0.22], scale: 0.022, color: 0x111111 },
    ]);
  });
}

export function fishMaterial() {
  return vmat('fish', { roughness: 0.3, metalness: 0.25 });
}

export function fish(game: Game, x: number, y: number, z: number, rotY = 0, kind: FishKind = 'salmon', extra: Partial<Parameters<typeof spawnProp>[1]> = {}) {
  const names: Record<FishKind, string> = { salmon: 'Salmon', cod: 'Cod', snapper: 'Red Snapper' };
  const obj = mesh(fishGeometry(kind), fishMaterial());
  return spawnProp(
    game,
    {
      name: names[kind],
      object: obj,
      mass: kind === 'salmon' ? 3 : 2,
      shape: 'box',
      size: new THREE.Vector3(0.18, 0.22, 0.72),
      tags: ['grabbable', 'washable', 'fish', 'food'],
      restitution: 0.35,
      data: { buoyancy: 1.6, floatRadius: 0.12 },
      ...extra,
    },
    V(x, y, z),
    rotY,
  );
}

export function crab(game: Game, x: number, y: number, z: number, rotY = 0) {
  const geo = cached('crab', () => {
    const parts: Parameters<typeof bake>[0] = [
      { geo: GEO.sphere(12, 8), pos: [0, 0.06, 0], scale: [0.16, 0.06, 0.12], color: 0xe0522f },
      { geo: GEO.sphere(8, 6), pos: [0.2, 0.07, 0.12], scale: [0.06, 0.04, 0.05], color: 0xd9452a },
      { geo: GEO.sphere(8, 6), pos: [-0.2, 0.07, 0.12], scale: [0.06, 0.04, 0.05], color: 0xd9452a },
      { geo: GEO.sphere(6, 4), pos: [0.04, 0.12, 0.1], scale: 0.018, color: 0x111111 },
      { geo: GEO.sphere(6, 4), pos: [-0.04, 0.12, 0.1], scale: 0.018, color: 0x111111 },
    ];
    for (let i = 0; i < 4; i++) {
      for (const s of [1, -1]) {
        parts.push({ geo: GEO.box, pos: [s * 0.19, 0.04, -0.07 + i * 0.05], rot: [0, s * (0.2 - i * 0.12), s * 0.5], scale: [0.14, 0.018, 0.018], color: 0xc9442a });
      }
    }
    return bake(parts);
  });
  return spawnProp(game, { name: 'Crab', object: mesh(geo, vmat('food')), mass: 1, tags: ['grabbable', 'washable', 'food', 'crab'] }, V(x, y, z), rotY);
}

// ------------------------------------------------------------------ the lost teddy bear

export function teddy(game: Game, x: number, y: number, z: number, rotY = 0) {
  const fur = 0xb07a4a;
  const muzzle = 0xe6c39a;
  const geo = cached('teddy', () =>
    bake([
      { geo: GEO.sphere(12, 10), pos: [0, 0.16, 0], scale: [0.14, 0.16, 0.12], color: fur },
      { geo: GEO.sphere(12, 10), pos: [0, 0.14, 0.09], scale: [0.09, 0.1, 0.05], color: muzzle },
      { geo: GEO.sphere(12, 10), pos: [0, 0.38, 0], scale: [0.12, 0.11, 0.11], color: fur },
      { geo: GEO.sphere(10, 8), pos: [0, 0.35, 0.1], scale: [0.055, 0.045, 0.04], color: muzzle },
      { geo: GEO.sphere(8, 6), pos: [0, 0.37, 0.14], scale: [0.022, 0.016, 0.014], color: 0x2a1a12 },
      { geo: GEO.sphere(8, 6), pos: [0.045, 0.42, 0.095], scale: 0.016, color: 0x111111 },
      { geo: GEO.sphere(8, 6), pos: [-0.045, 0.42, 0.095], scale: 0.016, color: 0x111111 },
      { geo: GEO.sphere(10, 8), pos: [0.09, 0.47, 0], scale: [0.045, 0.045, 0.025], color: fur },
      { geo: GEO.sphere(10, 8), pos: [-0.09, 0.47, 0], scale: [0.045, 0.045, 0.025], color: fur },
      { geo: GEO.sphere(10, 8), pos: [0.15, 0.2, 0.03], rot: [0, 0, 0.6], scale: [0.05, 0.1, 0.05], color: fur },
      { geo: GEO.sphere(10, 8), pos: [-0.15, 0.2, 0.03], rot: [0, 0, -0.6], scale: [0.05, 0.1, 0.05], color: fur },
      { geo: GEO.sphere(10, 8), pos: [0.08, 0.04, 0.08], scale: [0.06, 0.05, 0.09], color: fur },
      { geo: GEO.sphere(10, 8), pos: [-0.08, 0.04, 0.08], scale: [0.06, 0.05, 0.09], color: fur },
      { geo: GEO.box, pos: [0, 0.3, 0.07], rot: [0.2, 0, 0], scale: [0.14, 0.035, 0.05], color: 0x3a7bd5 },
    ]),
  );
  // Muddy until washed: darker, blotchy material. Washing swaps to the clean one.
  const muddy = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, color: 0x6e5a44 });
  const clean = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: 0xffffff });
  const obj = mesh(geo, muddy);
  let ent: Entity | undefined;
  ent = spawnProp(
    game,
    {
      name: 'Muddy Teddy Bear',
      object: obj,
      mass: 0.5,
      tags: ['grabbable', 'washable', 'teddy'],
      data: { muddy: true, buoyancy: 2.5 },
      onWash(g) {
        const e = ent;
        if (obj.material !== clean) {
          obj.material = clean;
          g.score(120, 'Teddy Is Clean Again!');
          g.hint('The teddy bear is clean and fluffy. Somebody must be missing him...', 3.5);
          g.sfx('sparkle');
          if (e) {
            e.name = 'Clean Teddy Bear';
            e.data.muddy = false;
            e.data.washed = true;
            g.events.emit('sparkle', { entity: e });
            g.events.emit('teddyWashed', { entity: e });
          }
        } else {
          g.score(10, 'Extra Clean Teddy');
        }
      },
    },
    V(x, y, z),
    rotY,
  );
  return ent;
}

// ------------------------------------------------------------------ waterfront bits

export function lifebuoy(game: Game, x: number, y: number, z: number, rotY = 0) {
  const geo = cached('buoy', () => {
    const t = new THREE.TorusGeometry(0.34, 0.1, 8, 20);
    return bake([{ geo: painted(t, (px, py) => (Math.floor(((Math.atan2(py, px) + Math.PI) / (Math.PI * 2)) * 8) % 2 ? 0xffffff : 0xe8392f)), color: 0xffffff, keepColors: true }]);
  });
  return spawnProp(
    game,
    { name: 'Lifebuoy', object: mesh(geo, vmat('plastic', { roughness: 0.45 })), mass: 2.5, tags: ['grabbable', 'washable'], shape: 'hull', data: { buoyancy: 5, floatRadius: 0.1 } },
    V(x, y, z),
    rotY,
  );
}

export function crabPot(game: Game, x: number, y: number, z: number, rotY = 0) {
  const geo = cached('crabpot', () => {
    const parts: Parameters<typeof bake>[0] = [];
    const w = 0.8;
    const h = 0.4;
    const frame = 0x3d3d3d;
    // octagon-ish frame as a box cage
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) parts.push({ geo: GEO.box, pos: [(sx * w) / 2, h / 2, (sz * w) / 2], scale: [0.03, h, 0.03], color: frame });
    for (const yy of [0.015, h])
      for (const s of [-1, 1]) {
        parts.push({ geo: GEO.box, pos: [0, yy, (s * w) / 2], scale: [w, 0.03, 0.03], color: frame });
        parts.push({ geo: GEO.box, pos: [(s * w) / 2, yy, 0], scale: [0.03, 0.03, w], color: frame });
      }
    // mesh panels
    for (let i = 1; i < 6; i++) {
      const t = -w / 2 + (i * w) / 6;
      for (const s of [-1, 1]) {
        parts.push({ geo: GEO.box, pos: [t, h / 2, (s * w) / 2], scale: [0.012, h, 0.012], color: 0x777777 });
        parts.push({ geo: GEO.box, pos: [(s * w) / 2, h / 2, t], scale: [0.012, h, 0.012], color: 0x777777 });
        parts.push({ geo: GEO.box, pos: [t, h, 0], scale: [0.012, 0.012, w], color: 0x777777 });
      }
    }
    parts.push({ geo: GEO.box, pos: [0, 0.02, 0], scale: [w, 0.02, w], color: 0x5a5a5a });
    parts.push({ geo: GEO.sphere(10, 8), pos: [0.25, h + 0.12, 0.2], scale: [0.12, 0.16, 0.12], color: 0xffb400 });
    return bake(parts);
  });
  return spawnProp(game, { name: 'Crab Pot', object: mesh(geo, vmat('metalish', { roughness: 0.45, metalness: 0.35 })), mass: 6, tags: ['grabbable', 'washable'], size: new THREE.Vector3(0.82, 0.44, 0.82) }, V(x, y, z), rotY);
}

export function baseball(game: Game, x: number, y: number, z: number) {
  const geo = cached('baseball', () =>
    bake([
      { geo: GEO.sphere(12, 10), scale: 0.075, color: 0xf6f3ea },
      { geo: new THREE.TorusGeometry(0.075, 0.006, 4, 16), rot: [0.5, 0, 0.3], color: 0xd23a2f },
    ]),
  );
  return spawnProp(game, { name: 'Baseball', object: mesh(geo, vmat('food')), shape: 'ball', mass: 0.15, restitution: 0.55, tags: ['grabbable', 'washable'] }, V(x, y, z));
}

export function beachBall(game: Game, x: number, y: number, z: number) {
  const geo = cached('beachball', () => {
    const s = new THREE.SphereGeometry(0.4, 16, 12);
    const cols = [0xff4d4d, 0xffffff, 0x3a8dff, 0xffd23a, 0xffffff, 0x3ccf6e];
    return bake([{ geo: painted(s, (px, py, pz) => (Math.abs(py) > 0.37 ? 0xffffff : cols[Math.floor(((Math.atan2(pz, px) + Math.PI) / (Math.PI * 2)) * 6) % 6])), color: 0xffffff, keepColors: true }]);
  });
  return spawnProp(
    game,
    { name: 'Beach Ball', object: mesh(geo, vmat('plastic', { roughness: 0.4 })), shape: 'ball', mass: 0.5, restitution: 0.8, tags: ['grabbable', 'washable'], data: { buoyancy: 4 } },
    V(x, y, z),
  );
}

export function sandBucket(game: Game, x: number, y: number, z: number, color: THREE.ColorRepresentation = 0xff5a3a) {
  const key = `bucket|${new THREE.Color(color).getHexString()}`;
  const geo = cached(key, () =>
    bake([
      { geo: GEO.cyl(1.3, 12), pos: [0, 0.1, 0], scale: [0.1, 0.2, 0.1], color },
      { geo: new THREE.TorusGeometry(0.12, 0.008, 4, 12, Math.PI), pos: [0, 0.2, 0], color: 0xffffff },
    ]),
  );
  return spawnProp(game, { name: 'Sand Bucket', object: mesh(geo, vmat('plastic', { roughness: 0.4 })), shape: 'cylinder', mass: 0.4, tags: ['grabbable', 'washable'] }, V(x, y, z));
}

export function fruit(game: Game, x: number, y: number, z: number, kind: 'apple' | 'orange' | 'banana' | 'pineapple') {
  const geo = cached(`fruit|${kind}`, () => {
    switch (kind) {
      case 'apple':
        return bake([
          { geo: GEO.sphere(12, 10), pos: [0, 0.08, 0], scale: [0.085, 0.08, 0.085], color: 0xd8262f },
          { geo: GEO.box, pos: [0, 0.17, 0], scale: [0.01, 0.04, 0.01], color: 0x5a3a1a },
          { geo: GEO.box, pos: [0.02, 0.17, 0], rot: [0, 0, 0.6], scale: [0.04, 0.01, 0.02], color: 0x3a9a2a },
        ]);
      case 'orange':
        return bake([{ geo: GEO.sphere(12, 10), pos: [0, 0.085, 0], scale: 0.085, color: 0xff8c1a }]);
      case 'banana':
        return bake([{ geo: new THREE.TorusGeometry(0.14, 0.032, 6, 10, Math.PI * 0.7), pos: [0, 0.03, 0], rot: [Math.PI / 2, 0, 0], color: 0xffd93a }]);
      default:
        return bake([
          { geo: GEO.sphere(10, 8), pos: [0, 0.14, 0], scale: [0.1, 0.14, 0.1], color: 0xd9a02a },
          { geo: GEO.cyl(0.1, 6), pos: [0, 0.34, 0], scale: [0.08, 0.14, 0.08], color: 0x2f8f3a },
        ]);
    }
  });
  const names = { apple: 'Apple', orange: 'Orange', banana: 'Banana', pineapple: 'Pineapple' };
  return spawnProp(game, { name: names[kind], object: mesh(geo, vmat('food')), mass: kind === 'pineapple' ? 1.2 : 0.2, tags: ['grabbable', 'food'], shape: kind === 'banana' ? 'box' : 'ball' }, V(x, y, z), x);
}

export function bouquet(game: Game, x: number, y: number, z: number, colors: number[]) {
  const key = `bouquet|${colors.join(',')}`;
  const geo = cached(key, () => {
    const parts: Parameters<typeof bake>[0] = [{ geo: GEO.cyl(2.2, 8), pos: [0, 0.15, 0], scale: [0.06, 0.3, 0.06], color: 0xf5efe0 }];
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9;
      const r = i === 0 ? 0 : 0.06;
      parts.push({ geo: GEO.ico(0), pos: [Math.cos(a) * r, 0.34 + (i % 2) * 0.03, Math.sin(a) * r], scale: 0.05, color: colors[i % colors.length] });
    }
    parts.push({ geo: GEO.ico(0), pos: [0.05, 0.3, -0.05], scale: [0.05, 0.02, 0.05], color: 0x3a9a3a });
    return bake(parts);
  });
  return spawnProp(game, { name: 'Flower Bouquet', object: mesh(geo, vmat('food')), mass: 0.3, tags: ['grabbable', 'washable'] }, V(x, y, z), x);
}

/** A little rowboat that floats (buoyancy) and can be dragged / bonked around. `obj` = the boat visual. */
export function dinghy(game: Game, obj: THREE.Object3D, x: number, y: number, z: number, rotY = 0) {
  return spawnProp(
    game,
    {
      name: 'Dinghy',
      object: obj,
      mass: 55,
      tags: ['grabbable', 'boat'],
      friction: 0.6,
      linearDamping: 0.5,
      angularDamping: 2.5,
      sleeping: false,
      data: { buoyancy: 2.8, floatRadius: 0.45 },
    },
    V(x, y, z),
    rotY,
  );
}

// ------------------------------------------------------------------ Jimothy bobbleheads (the real model, baked)

/**
 * The Jimothy Night giveaway bobblehead (the golden collectibles and Tee-Hee Park's giant one): mid-stride with his
 * right front paw up and curled (his walk), head twice size on its spring, tipped up a little to look at you (he
 * carries it low, nose down).
 */
export const BOBBLEHEAD = { pose: 'walk' as const, phase: 0.27, headScale: 2, headPitch: 0.2 };

/** The real Jimothy split for a bobblehead: his body, and his head on its own pivot (see `jimothyBobble`). */
export interface BobbleParts {
  /** The body (the coat texture's mesh), model frame: feet on y = 0, facing +Z, his left = +X. */
  body: BakedPart[];
  /** Everything that bobbles (skull, ears, jaw, eyes, glints, nose), in the neck frame: the pivot is the origin. */
  head: BakedPart[];
  /** The head's pivot (his head joint) in the model frame. */
  neck: THREE.Vector3;
  /** Bounds of the body (model frame) and of the unscaled head (neck frame). */
  bodyBox: THREE.Box3;
  headBox: THREE.Box3;
  /** His coat texture (the body's `map`), for painted or carved finishes. */
  coat: THREE.Texture | null;
  /**
   * Where a hat goes (neck frame, as posed): its bottom centre on the skull between the ears, pressing the fur down,
   * and its orientation (+Y out of the crown, tipped ~30° forward with his down-turned head; +Z toward his nose).
   * `width` = the cranium between the ears (fur included).
   */
  hat: { pos: THREE.Vector3; quat: THREE.Quaternion; width: number };
}

/**
 * His head at rest (model frame, as measured in JimothyQuad.headAnchors and the 'stand' bake): the head joint, the eye
 * centres, the skin at the crown and the crown's forward tilt. The posed head's own eyes give its rotation from here.
 */
const REST_HEAD = {
  neck: new THREE.Vector3(0, 0.529, 0.262),
  eyeL: new THREE.Vector3(0.037, 0.464, 0.364),
  eyeR: new THREE.Vector3(-0.037, 0.464, 0.364),
  crown: new THREE.Vector3(0, 0.566, 0.34),
  tilt: 0.56,
  width: 0.18,
};

/** Rotation taking the rest head onto a posed head, from each one's eyes and neck. */
function headRotation(eyeL: THREE.Vector3, eyeR: THREE.Vector3, neck: THREE.Vector3) {
  const basis = (l: THREE.Vector3, r: THREE.Vector3, n: THREE.Vector3) => {
    const x = l.clone().sub(r).normalize();
    const f = l.clone().add(r).multiplyScalar(0.5).sub(n);
    const y = f.addScaledVector(x, -f.dot(x)).normalize();
    return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y));
  };
  const rest = basis(REST_HEAD.eyeL, REST_HEAD.eyeR, REST_HEAD.neck);
  const posed = basis(eyeL, eyeR, neck);
  return new THREE.Quaternion().setFromRotationMatrix(posed.multiply(rest.transpose()));
}

const bobbleCache = new Map<string, Promise<BobbleParts | null>>();

/**
 * Jimothy posed and baked (`bakeJimothy`, fur sculpted in) and split at the neck for a bobblehead: scale the head
 * about its pivot and it still meets the body. The openings the split leaves are capped, so a big head is closed
 * where it sits on his (virtually non-existent) neck. Geometry is compacted (the bake's head and body share one
 * vertex array) and cached: shared by every caller, clone it before editing it.
 */
export function jimothyBobble(game: Game, opts: { pose?: JimothyPose; phase?: number; fur?: number } = {}): Promise<BobbleParts | null> {
  const key = JSON.stringify([opts.pose ?? 'stand', opts.phase ?? null, opts.fur ?? null]);
  let p = bobbleCache.get(key);
  if (!p) {
    p = bakeJimothy(game, { pose: opts.pose ?? 'stand', phase: opts.phase, fur: opts.fur, splitHead: true }).then((baked) => {
      if (!baked) return null;
      const neck = baked.neck.clone();
      const toNeck = new THREE.Matrix4().makeTranslation(-neck.x, -neck.y, -neck.z);
      const body: BakedPart[] = [];
      const head: BakedPart[] = [];
      for (const part of baked.parts) {
        let g = compactGeometry(part.geometry);
        // the neck openings: the body's is capped with a low dome (hidden inside the head), the head's flat
        if (part.name === 'JimothyBody') g = capOpenings(g, neck, 0.2, 0.02);
        else if (part.head && part.material.map) g = capOpenings(g, neck, 0.2, -0.01);
        if (part.head) g.applyMatrix4(toNeck);
        g.computeBoundingBox();
        g.computeBoundingSphere();
        (part.head ? head : body).push({ ...part, geometry: g });
      }
      const box = (list: BakedPart[]) => list.reduce((b, q) => b.union(q.geometry.boundingBox!), new THREE.Box3());
      const coat = baked.parts.find((q) => q.name === 'JimothyBody')?.material.map ?? null;
      // the hat: the rest crown carried by the posed head (its eyes give the rotation), lifted onto the sculpted fur
      const eye = (n: string) => head.find((q) => q.name === n)?.geometry.boundingBox!.getCenter(new THREE.Vector3()).add(neck);
      const eyeL = eye('EyeL') ?? REST_HEAD.eyeL.clone();
      const eyeR = eye('EyeR') ?? REST_HEAD.eyeR.clone();
      const rot = headRotation(eyeL, eyeR, neck);
      const up = new THREE.Vector3(0, Math.cos(REST_HEAD.tilt), Math.sin(REST_HEAD.tilt));
      const hatPos = REST_HEAD.crown.clone().addScaledVector(up, 0.02).sub(REST_HEAD.neck).applyQuaternion(rot);
      const hatQuat = rot.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), REST_HEAD.tilt));
      return { body, head, neck, bodyBox: box(body), headBox: box(head), coat, hat: { pos: hatPos, quat: hatQuat, width: REST_HEAD.width } };
    });
    bobbleCache.set(key, p);
  }
  return p;
}

/** Copy of an indexed geometry with only the vertices its triangles use (position / normal / uv). */
function compactGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal', 'uv'].filter((n) => src.getAttribute(n));
  const idx = src.index;
  if (!idx) {
    for (const n of names) out.setAttribute(n, (src.getAttribute(n) as THREE.BufferAttribute).clone());
    return out;
  }
  const count = src.getAttribute('position').count;
  const remap = new Int32Array(count).fill(-1);
  const index = new Uint32Array(idx.count);
  let used = 0;
  for (let i = 0; i < idx.count; i++) {
    const v = idx.getX(i);
    if (remap[v] < 0) remap[v] = used++;
    index[i] = remap[v];
  }
  for (const n of names) {
    const a = src.getAttribute(n) as THREE.BufferAttribute;
    const k = a.itemSize;
    const arr = new Float32Array(used * k);
    for (let v = 0; v < count; v++) if (remap[v] >= 0) for (let c = 0; c < k; c++) arr[remap[v] * k + c] = a.getComponent(v, c);
    out.setAttribute(n, new THREE.BufferAttribute(arr, k));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/**
 * Close the holes in a mesh (loops of boundary edges, welded by position) whose centre is within `radius` of `near`:
 * a fan from a new centre vertex, pushed `bulge` metres out of the mesh (negative = into it). The fan reuses the rim's
 * vertices, so the cap shades like a rounded continuation of the skin.
 */
function capOpenings(g: THREE.BufferGeometry, near: THREE.Vector3, radius: number, bulge: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const idx = g.index;
  if (!idx) return g;
  const n = pos.count;
  // weld: canonical vertex per position (UV seams split vertices)
  const canon = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    const c = seen.get(k);
    canon[i] = c ?? i;
    if (c === undefined) seen.set(k, i);
  }
  const uses = new Map<string, number>();
  const dir = new Map<string, [number, number]>();
  for (let t = 0; t < idx.count; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx.getX(t + e);
      const b = idx.getX(t + ((e + 1) % 3));
      const ca = canon[a];
      const cb = canon[b];
      const k = ca < cb ? ca + '_' + cb : cb + '_' + ca;
      uses.set(k, (uses.get(k) ?? 0) + 1);
      dir.set(k, [a, b]);
    }
  }
  // boundary edges (used once) keyed by their start (canonical), in the winding of their triangle
  const next = new Map<number, [number, number]>();
  for (const [k, u] of uses) {
    if (u !== 1) continue;
    const e = dir.get(k)!;
    next.set(canon[e[0]], e);
  }
  const loops: number[][] = [];
  const done = new Set<number>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const loop: number[] = [];
    let cur = start;
    while (!done.has(cur)) {
      done.add(cur);
      const e = next.get(cur);
      if (!e) break;
      loop.push(e[0]);
      cur = canon[e[1]];
    }
    if (cur === start && loop.length >= 3) loops.push(loop);
  }
  const P: number[] = Array.from(pos.array as Float32Array).slice(0, n * 3);
  const N: number[] = nor ? Array.from(nor.array as Float32Array).slice(0, n * 3) : [];
  const U: number[] = uv ? Array.from(uv.array as Float32Array).slice(0, n * 2) : [];
  const I: number[] = Array.from(idx.array as ArrayLike<number>);
  const c = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const loop of loops) {
    c.set(0, 0, 0);
    let u0 = 0;
    let u1 = 0;
    for (const v of loop) {
      c.x += pos.getX(v);
      c.y += pos.getY(v);
      c.z += pos.getZ(v);
      if (uv) {
        u0 += uv.getX(v);
        u1 += uv.getY(v);
      }
    }
    c.divideScalar(loop.length);
    if (c.distanceTo(near) > radius) continue;
    // Newell normal of the loop in its edge order; the cap runs the other way round, so it faces -nrm (out of the mesh)
    nrm.set(0, 0, 0);
    for (let i = 0; i < loop.length; i++) {
      a.fromBufferAttribute(pos, loop[i]);
      b.fromBufferAttribute(pos, loop[(i + 1) % loop.length]);
      nrm.x += (a.y - b.y) * (a.z + b.z);
      nrm.y += (a.z - b.z) * (a.x + b.x);
      nrm.z += (a.x - b.x) * (a.y + b.y);
    }
    nrm.normalize().negate();
    const ci = P.length / 3;
    P.push(c.x + nrm.x * bulge, c.y + nrm.y * bulge, c.z + nrm.z * bulge);
    if (nor) N.push(nrm.x, nrm.y, nrm.z);
    if (uv) U.push(u0 / loop.length, u1 / loop.length);
    for (let i = 0; i < loop.length; i++) I.push(loop[(i + 1) % loop.length], loop[i], ci);
  }
  if (P.length === n * 3) return g;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (nor) out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  out.setIndex(I);
  return out;
}

export type { Entity };
