/** Dynamic props for the north zones: each prop is a single merged, vertex-coloured mesh (1 draw call). */
import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { spawnProp, destroyProp, type PropSpec } from '../../../entities/Props';
import { Batch, GEO, trs, type MatSet } from './kit';

type Part = [geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation];

function mesh(parts: Part[], mat: THREE.Material) {
  const b = new Batch(1e9);
  for (const [g, m, c] of parts) b.add('p', g, m, c, { uvTile: 0 });
  return b.buildSingle(mat);
}

const B = GEO.box;
const C = GEO.cyl;
const S = GEO.sphere;

export function spawn(game: Game, spec: PropSpec, x: number, y: number, z: number, rotY = 0): Entity {
  return spawnProp(game, spec, new THREE.Vector3(x, y, z), rotY);
}

// ------------------------------------------------------------------ Residential props

export function gnome(mats: MatSet, hat = 0xd8342c, shirt = 0x2f6fb5): PropSpec {
  const obj = mesh(
    [
      [C, trs(0, 0.06, 0, 0.3, 0.12, 0.3), 0x6b6f5a],
      [C, trs(0, 0.2, 0, 0.26, 0.2, 0.26), 0x5a3f2b], // boots/pants
      [C, trs(0, 0.38, 0, 0.3, 0.26, 0.28), shirt],
      [S, trs(0, 0.55, 0, 0.2, 0.2, 0.2), 0xf1c7a6], // face
      [GEO.cone, trs(0, 0.47, 0.06, 0.2, 0.26, 0.1, 0, 0.2), 0xf4f1ea], // beard
      [S, trs(0, 0.56, 0.1, 0.06, 0.05, 0.05), 0xe79a88], // nose
      [GEO.cone, trs(0, 0.76, -0.01, 0.23, 0.34, 0.23, 0, -0.12), hat],
    ],
    mats.gloss,
  );
  return { name: 'Garden Gnome', object: obj, shape: 'cylinder', mass: 3, tags: ['grabbable', 'washable', 'gnome'], data: { buoyancy: 0.8 } };
}

/** Seattle wheelie bin: blue recycling, green compost, grey garbage. */
export function wheelieBin(mats: MatSet, kind: 'recycle' | 'compost' | 'garbage'): PropSpec {
  const col = kind === 'recycle' ? 0x2e6fd1 : kind === 'compost' ? 0x3d8b3d : 0x4a4f55;
  const obj = mesh(
    [
      [B, trs(0, 0.5, 0, 0.6, 0.95, 0.7), col],
      [B, trs(0, 1.0, 0.02, 0.64, 0.07, 0.76), col],
      [B, trs(0, 0.97, -0.37, 0.5, 0.06, 0.06), 0x222222],
      [C, trs(-0.26, 0.09, -0.32, 0.18, 0.06, 0.18, 0, 0, Math.PI / 2), 0x1a1a1a],
      [C, trs(0.26, 0.09, -0.32, 0.18, 0.06, 0.18, 0, 0, Math.PI / 2), 0x1a1a1a],
      [B, trs(0, 0.62, 0.352, 0.34, 0.2, 0.01), kind === 'recycle' ? 0xe7f0ff : 0xf0f0e0],
    ],
    mats.gloss,
  );
  const name = kind === 'recycle' ? 'Recycling Bin' : kind === 'compost' ? 'Compost Bin' : 'Garbage Bin';
  return { name, object: obj, mass: 11, tags: ['grabbable', 'trashcan', 'washable'], data: { binKind: kind } };
}

export function mailbox(mats: MatSet, color = 0x2d4a7a): PropSpec {
  const obj = mesh(
    [
      [B, trs(0, 0.55, 0, 0.1, 1.1, 0.1), 0xe8e2d6],
      [B, trs(0, 1.1, 0.05, 0.26, 0.24, 0.46), color],
      [C, trs(0, 1.22, 0.05, 0.26, 0.46, 0.26, 0, Math.PI / 2), color],
      [B, trs(0.15, 1.24, -0.05, 0.02, 0.2, 0.05), 0xd33a2c], // flag
    ],
    mats.gloss,
  );
  return { name: 'Mailbox', object: obj, mass: 7, tags: ['grabbable', 'mailbox'], size: new THREE.Vector3(0.28, 1.35, 0.5) };
}

export function propaneTank(mats: MatSet): PropSpec {
  const obj = mesh(
    [
      [C, trs(0, 0.28, 0, 0.3, 0.44, 0.3), 0xf2f2ee],
      [S, trs(0, 0.5, 0, 0.3, 0.14, 0.3), 0xf2f2ee],
      [S, trs(0, 0.06, 0, 0.3, 0.12, 0.3), 0xf2f2ee],
      [C, trs(0, 0.62, 0, 0.2, 0.1, 0.2), 0xd8d8d0],
      [C, trs(0, 0.66, 0, 0.06, 0.06, 0.06), 0x9aa0a6],
      [B, trs(0, 0.3, 0.151, 0.14, 0.1, 0.01), 0xd33a2c],
    ],
    mats.metal,
  );
  return { name: 'Propane Tank', object: obj, shape: 'cylinder', mass: 9, tags: ['grabbable', 'explosive', 'propane'], data: { buoyancy: 0.6 } };
}

export function gasGrill(mats: MatSet, color = 0x2b2b2e): PropSpec {
  const obj = mesh(
    [
      [B, trs(0, 0.42, 0, 0.9, 0.62, 0.55), 0x3a3a3e], // cart
      [B, trs(0, 0.8, 0, 0.95, 0.18, 0.6), color], // firebox
      [C, trs(0, 0.9, 0, 0.6, 0.93, 0.6, Math.PI / 2, 0, Math.PI / 2), color], // lid (half cylinder look)
      [B, trs(0.72, 0.83, 0, 0.5, 0.05, 0.5), 0x9aa0a6], // shelf
      [B, trs(-0.72, 0.83, 0, 0.5, 0.05, 0.5), 0x9aa0a6],
      [B, trs(0, 0.98, 0.33, 0.6, 0.04, 0.04), 0xc0c4c8], // handle
      [C, trs(-0.35, 0.06, -0.2, 0.12, 0.05, 0.12, 0, 0, Math.PI / 2), 0x111111],
      [C, trs(0.35, 0.06, -0.2, 0.12, 0.05, 0.12, 0, 0, Math.PI / 2), 0x111111],
      [B, trs(0, 0.7, 0.29, 0.5, 0.06, 0.02), 0xb8bcc2], // knobs panel
    ],
    mats.metal,
  );
  return { name: 'BBQ Grill', object: obj, mass: 32, tags: ['grabbable', 'grill'], friction: 0.9 };
}

export function yarnBall(mats: MatSet, color: number): PropSpec {
  const obj = mesh(
    [
      [S, trs(0, 0.13, 0, 0.26, 0.26, 0.26), color],
      [GEO.torus, trs(0, 0.13, 0, 0.26, 0.26, 0.26, 0.4, 1.2), color],
      [GEO.torus, trs(0, 0.13, 0, 0.26, 0.26, 0.26, 1.1, 0.3, 0.8), color],
    ],
    mats.plain,
  );
  return { name: 'Ball of Yarn', object: obj, shape: 'ball', mass: 0.3, restitution: 0.4, tags: ['grabbable', 'washable', 'yarn'], data: { buoyancy: 2 } };
}

export function trafficCone(mats: MatSet): PropSpec {
  const obj = mesh(
    [
      [B, trs(0, 0.025, 0, 0.42, 0.05, 0.42), 0xef6a1f],
      [GEO.cone, trs(0, 0.4, 0, 0.3, 0.72, 0.3), 0xef6a1f],
      [C, trs(0, 0.42, 0, 0.19, 0.1, 0.19), 0xf4f4f4],
    ],
    mats.gloss,
  );
  return { name: 'Traffic Cone', object: obj, shape: 'cylinder', mass: 1.5, tags: ['grabbable', 'washable', 'cone'], size: new THREE.Vector3(0.36, 0.76, 0.36) };
}

export function poolFloat(mats: MatSet, color: number): PropSpec {
  const obj = mesh([[GEO.torus, trs(0, 0.12, 0, 1.3, 1.3, 2.2, 0, Math.PI / 2), color]], mats.gloss);
  return { name: 'Pool Floatie', object: obj, mass: 0.6, tags: ['grabbable', 'washable', 'float'], restitution: 0.5, data: { buoyancy: 6, floatRadius: 0.15 } };
}

export function beachBall(mats: MatSet): PropSpec {
  const obj = new THREE.Group();
  const cols = [0xff4d4d, 0xffffff, 0xffd23f, 0xffffff, 0x3fa7ff, 0xffffff];
  cols.forEach((c, i) => {
    const g = new THREE.SphereGeometry(0.35, 12, 10, (i / 6) * Math.PI * 2, Math.PI / 3);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }));
    m.position.y = 0.35;
    obj.add(m);
  });
  return { name: 'Beach Ball', object: obj, shape: 'ball', mass: 0.4, restitution: 0.8, tags: ['grabbable', 'washable'], data: { buoyancy: 5 } };
}

export function lawnChair(mats: MatSet, color: number): PropSpec {
  const obj = mesh(
    [
      [B, trs(0, 0.36, 0, 0.6, 0.06, 0.55), color],
      [B, trs(0, 0.66, -0.3, 0.6, 0.6, 0.06, 0, -0.35), color],
      [B, trs(-0.28, 0.18, 0.2, 0.05, 0.36, 0.05), 0xdddddd],
      [B, trs(0.28, 0.18, 0.2, 0.05, 0.36, 0.05), 0xdddddd],
      [B, trs(-0.28, 0.18, -0.22, 0.05, 0.36, 0.05), 0xdddddd],
      [B, trs(0.28, 0.18, -0.22, 0.05, 0.36, 0.05), 0xdddddd],
      [B, trs(-0.32, 0.5, 0, 0.06, 0.04, 0.55), 0xdddddd],
      [B, trs(0.32, 0.5, 0, 0.06, 0.04, 0.55), 0xdddddd],
    ],
    mats.gloss,
  );
  return { name: 'Lawn Chair', object: obj, mass: 3.5, tags: ['grabbable', 'washable', 'chair'] };
}

// ------------------------------------------------------------------ University props

export function foldingChair(mats: MatSet, color = 0xf4f1ea): PropSpec {
  const obj = mesh(
    [
      [B, trs(0, 0.46, 0.02, 0.44, 0.05, 0.42), color],
      [B, trs(0, 0.78, -0.2, 0.44, 0.3, 0.04, 0, -0.08), color],
      [B, trs(-0.2, 0.44, -0.2, 0.035, 0.9, 0.035, 0, -0.08), 0xb8b8b8],
      [B, trs(0.2, 0.44, -0.2, 0.035, 0.9, 0.035, 0, -0.08), 0xb8b8b8],
      [B, trs(-0.2, 0.23, 0.2, 0.035, 0.46, 0.035, 0, 0.12), 0xb8b8b8],
      [B, trs(0.2, 0.23, 0.2, 0.035, 0.46, 0.035, 0, 0.12), 0xb8b8b8],
    ],
    mats.gloss,
  );
  return { name: 'Folding Chair', object: obj, mass: 4, tags: ['grabbable', 'washable', 'chair'], size: new THREE.Vector3(0.46, 0.95, 0.46) };
}

/** Rolled diploma with a purple ribbon (0.3 kg). Washing makes it soggy. */
export function diploma(mats: MatSet): PropSpec {
  const obj = mesh(
    [
      [C, trs(0, 0.06, 0, 0.11, 0.42, 0.11, 0, 0, Math.PI / 2), 0xfbf6e6],
      [C, trs(0, 0.06, 0, 0.125, 0.06, 0.125, 0, 0, Math.PI / 2), 0x5b2a86],
      [B, trs(0, 0.02, 0.06, 0.03, 0.08, 0.02, 0, 0.4), 0xe8b923],
    ],
    mats.plain.clone(),
  );
  return {
    name: 'Diploma',
    object: obj,
    shape: 'cylinder',
    mass: 0.3,
    tags: ['grabbable', 'washable', 'diploma'],
    data: { buoyancy: 2 },
  };
}

/** Spawn a diploma whose wash turns it soggy (per-entity closure). */
export function spawnDiploma(game: Game, mats: MatSet, x: number, y: number, z: number, rotY = 0) {
  const e = spawn(game, diploma(mats), x, y, z, rotY);
  e.onWash = (g) => {
    const n = (e.data.soggy = (e.data.soggy ?? 0) + 1);
    if (n === 1) {
      g.score(120, 'Soggy Diploma');
      g.hint('The diploma is now soggy. The ink now reads "Bachelor of Arts in Mm-hmm".', 3.5);
      g.sfx('splash', undefined, 0.4);
      e.object?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const mm = (m.material as THREE.MeshStandardMaterial).clone();
          mm.color.setRGB(0.72, 0.8, 0.95);
          mm.roughness = 0.2;
          m.material = mm;
          m.scale.x *= 1.08;
          m.scale.y *= 0.7;
        }
      });
    } else g.score(10, 'Even Soggier Diploma');
    e.data.washed = true;
    g.events.emit('diplomaWashed', { entity: e });
  };
  return e;
}

export function gradCap(mats: MatSet): PropSpec {
  const obj = mesh(
    [
      [C, trs(0, 0.06, 0, 0.3, 0.12, 0.3), 0x2a1540],
      [B, trs(0, 0.13, 0, 0.44, 0.02, 0.44, Math.PI / 4), 0x2a1540],
      [B, trs(0.12, 0.08, 0.12, 0.02, 0.12, 0.02), 0xe8b923],
    ],
    mats.plain,
  );
  return { name: 'Graduation Cap', object: obj, mass: 0.2, tags: ['grabbable', 'washable', 'hat'], data: { buoyancy: 2 } };
}

export function bicycle(mats: MatSet, color: number): PropSpec {
  const wheel = GEO.torus;
  const obj = mesh(
    [
      [wheel, trs(0, 0.34, 0.55, 0.66, 0.66, 0.66, Math.PI / 2), 0x1b1b1b],
      [wheel, trs(0, 0.34, -0.55, 0.66, 0.66, 0.66, Math.PI / 2), 0x1b1b1b],
      [B, trs(0, 0.55, 0, 0.05, 0.05, 0.95, 0, 0.1), color],
      [B, trs(0, 0.45, -0.25, 0.05, 0.05, 0.6, 0, -0.7), color],
      [B, trs(0, 0.45, 0.28, 0.05, 0.05, 0.6, 0, 0.9), color],
      [B, trs(0, 0.78, -0.3, 0.14, 0.05, 0.26), 0x222222], // saddle
      [B, trs(0, 0.86, 0.45, 0.5, 0.04, 0.04), 0x9aa0a6], // bars
      [B, trs(0, 0.66, 0.48, 0.04, 0.4, 0.04, 0, 0.3), color],
    ],
    mats.metal,
  );
  return { name: 'Bicycle', object: obj, mass: 12, tags: ['grabbable', 'washable', 'bike'], size: new THREE.Vector3(0.12, 0.95, 1.7) };
}

// ------------------------------------------------------------------ SlopCorp props

export function beanbag(mats: MatSet, color: number): PropSpec {
  const obj = mesh(
    [
      [S, trs(0, 0.32, 0, 1.0, 0.62, 1.0), color],
      [S, trs(0, 0.55, -0.25, 0.8, 0.6, 0.45), color],
    ],
    mats.plain,
  );
  return { name: 'Beanbag', object: obj, shape: 'ball', mass: 5, restitution: 0.1, tags: ['grabbable', 'washable', 'beanbag'], size: new THREE.Vector3(0.95, 0.95, 0.95) };
}

export function scooter(mats: MatSet): PropSpec {
  const obj = mesh(
    [
      [B, trs(0, 0.1, 0, 0.16, 0.05, 0.8), 0x1f1f24],
      [C, trs(0, 0.08, 0.4, 0.16, 0.05, 0.16, 0, 0, Math.PI / 2), 0x111111],
      [C, trs(0, 0.08, -0.4, 0.16, 0.05, 0.16, 0, 0, Math.PI / 2), 0x111111],
      [B, trs(0, 0.55, 0.38, 0.04, 0.9, 0.04, 0, 0.15), 0x39e6a0],
      [B, trs(0, 0.98, 0.45, 0.46, 0.04, 0.04), 0x1f1f24],
    ],
    mats.gloss,
  );
  return { name: 'E-Scooter', object: obj, mass: 10, tags: ['grabbable', 'washable', 'scooter'], size: new THREE.Vector3(0.48, 1.0, 0.9) };
}

export function laptop(mats: MatSet): PropSpec {
  const obj = mesh(
    [
      [B, trs(0, 0.012, 0, 0.34, 0.02, 0.24), 0xb8bec6],
      [B, trs(0, 0.13, -0.12, 0.34, 0.24, 0.015, 0, -0.25), 0xb8bec6],
      [B, trs(0, 0.13, -0.11, 0.3, 0.2, 0.006, 0, -0.25), 0x39c9ff],
    ],
    mats.gloss,
  );
  return { name: 'Laptop', object: obj, mass: 1.6, tags: ['grabbable', 'washable', 'electronic', 'shiny'] };
}

/** Garbled AI-slop A-frame sign. Washing dissolves it. */
export function slopSign(mats: MatSet, tex: THREE.Texture): PropSpec {
  const g = new THREE.Group();
  const board = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  const frame = mats.gloss;
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.9, 0.03), [frame, frame, frame, frame, board, frame]);
  a.position.set(0, 0.47, 0.14);
  a.rotation.x = -0.28;
  const b = a.clone();
  b.position.z = -0.14;
  b.rotation.x = 0.28;
  b.rotation.y = Math.PI;
  g.add(a, b);
  return {
    name: 'Slop Sign',
    object: g,
    mass: 3,
    tags: ['grabbable', 'washable', 'slop'],
    size: new THREE.Vector3(0.64, 0.92, 0.5),
  };
}

/** Spawn a slop sign that dissolves when washed. */
export function spawnSlopSign(game: Game, mats: MatSet, tex: THREE.Texture, x: number, y: number, z: number, rotY = 0) {
  const e = spawn(game, slopSign(mats, tex), x, y, z, rotY);
  e.onWash = (g) => {
    g.score(200, 'Slop Sign Dissolved');
    g.sfx('dissolve', e.object?.position);
    g.events.emit('slopWashed', { entity: e, kind: 'sign' });
    const p = g.get<any>('player');
    if (p?.held?.entity === e) p.release(false);
    destroyProp(g, e);
  };
  return e;
}

/** Spawn a laptop that short-circuits when washed. */
export function spawnLaptop(game: Game, mats: MatSet, x: number, y: number, z: number, rotY = 0) {
  const e = spawn(game, laptop(mats), x, y, z, rotY);
  e.onWash = (g) => {
    const n = (e.data.washCount = (e.data.washCount ?? 0) + 1);
    if (n === 1) {
      g.score(150, 'Laptop Laundered');
      g.hint('The laptop is sparkling clean. It will now only generate bubbles.', 3);
      g.sfx('short_circuit', e.object?.position);
      g.events.emit('sparkle', { entity: e });
    } else g.score(10, 'Laptop Still Clean');
    e.data.washed = true;
  };
  return e;
}
