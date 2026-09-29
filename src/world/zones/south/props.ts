import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { spawnProp, destroyProp } from '../../../entities/Props';
import { bake, GEO, type V3 } from './kit';

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

/** Small raccoon-shaped static bobblehead figure geometry (for statues, decor). */
export function jimothyFigure(): { body: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const body = cached('jimfig-body', () =>
    bake([
      { geo: GEO.sphere(18, 14), pos: [0, 0.5, 0], scale: [0.5, 0.48, 0.5], color: 0x8e8a86 },
      { geo: GEO.sphere(12, 8), pos: [0.22, 0.08, 0.18], scale: [0.11, 0.1, 0.13], color: 0x3a3634 },
      { geo: GEO.sphere(12, 8), pos: [-0.22, 0.08, 0.18], scale: [0.11, 0.1, 0.13], color: 0x3a3634 },
      { geo: GEO.sphere(12, 8), pos: [0.22, 0.08, -0.2], scale: [0.11, 0.1, 0.13], color: 0x3a3634 },
      { geo: GEO.sphere(12, 8), pos: [-0.22, 0.08, -0.2], scale: [0.11, 0.1, 0.13], color: 0x3a3634 },
      // ringed tail
      ...[0, 1, 2, 3, 4, 5].map((i) => ({
        geo: GEO.sphere(10, 8),
        pos: [0, 0.35 + i * 0.05, -0.5 - i * 0.1] as V3,
        scale: [0.13 - i * 0.008, 0.13 - i * 0.008, 0.08] as V3,
        color: i % 2 ? 0x2d2a28 : 0xa7a29c,
      })),
    ]),
  );
  const head = cached('jimfig-head', () =>
    bake([
      { geo: GEO.sphere(20, 16), pos: [0, 0, 0], scale: [0.62, 0.55, 0.58], color: 0x9a9591 },
      // bandit mask
      { geo: GEO.sphere(16, 10), pos: [0, 0.06, 0.4], scale: [0.5, 0.17, 0.25], color: 0x2a2624 },
      { geo: GEO.sphere(12, 10), pos: [0, -0.14, 0.5], scale: [0.24, 0.17, 0.14], color: 0xf1ede6 },
      { geo: GEO.sphere(10, 8), pos: [0, -0.08, 0.64], scale: [0.07, 0.05, 0.05], color: 0x151212 },
      { geo: GEO.sphere(10, 8), pos: [0.19, 0.08, 0.6], scale: 0.07, color: 0xffffff },
      { geo: GEO.sphere(10, 8), pos: [-0.19, 0.08, 0.6], scale: 0.07, color: 0xffffff },
      { geo: GEO.sphere(8, 6), pos: [0.2, 0.08, 0.66], scale: 0.035, color: 0x111111 },
      { geo: GEO.sphere(8, 6), pos: [-0.2, 0.08, 0.66], scale: 0.035, color: 0x111111 },
      { geo: GEO.sphere(10, 8), pos: [0.2, 0.22, 0.44], scale: [0.14, 0.05, 0.08], color: 0xf4f1ea },
      { geo: GEO.sphere(10, 8), pos: [-0.2, 0.22, 0.44], scale: [0.14, 0.05, 0.08], color: 0xf4f1ea },
      { geo: GEO.sphere(12, 8), pos: [0.36, 0.44, 0], scale: [0.16, 0.16, 0.08], color: 0x3a3634 },
      { geo: GEO.sphere(12, 8), pos: [-0.36, 0.44, 0], scale: [0.16, 0.16, 0.08], color: 0x3a3634 },
      { geo: GEO.sphere(12, 8), pos: [0.36, 0.44, 0.02], scale: [0.11, 0.11, 0.07], color: 0xe9e4dc },
      { geo: GEO.sphere(12, 8), pos: [-0.36, 0.44, 0.02], scale: [0.11, 0.11, 0.07], color: 0xe9e4dc },
    ]),
  );
  return { body, head };
}

export function figureMaterial(gold = false) {
  return gold ? vmat('gold', { roughness: 0.25, metalness: 0.85, color: 0xffd36a }) : vmat('figure', { roughness: 0.5 });
}

export type { Entity };
