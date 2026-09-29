import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { spawnProp } from '../../../entities/Props';

/**
 * Primitive props for the heart quests, used when the items system doesn't provide a kind:
 * the muddy teddy, grapes, crow gifts, Grandma's rocking chair and the knitted hat.
 */

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function m(color: number, rough = 0.75, metal = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const key = `${color}|${rough}|${metal}|${JSON.stringify(extra)}`;
  let mat = matCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
    matCache.set(key, mat);
  }
  return mat;
}
function mesh(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, mat);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}
const sph = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);

// ================================================================================================ teddy

export interface TeddyModel {
  root: THREE.Group;
  mud: THREE.Object3D[];
  fur: THREE.MeshStandardMaterial;
}

/** A kid's teddy bear (~0.42 m). Dirty = darker fur + mud splotches. */
export function buildTeddy(dirty: boolean): TeddyModel {
  const root = new THREE.Group();
  root.name = 'Teddy';
  const fur = new THREE.MeshStandardMaterial({ color: dirty ? 0x6e5238 : 0xa8764a, roughness: 0.95 });
  const light = m(0xe8c9a0, 0.95);
  const dark = m(0x241a14, 0.4);
  const body = mesh(sph(0.13), fur, 0, 0.15, 0);
  body.scale.set(1, 1.12, 0.9);
  root.add(body);
  const belly = mesh(sph(0.085), light, 0, 0.14, 0.06);
  belly.scale.set(1, 1.1, 0.5);
  root.add(belly);
  const head = mesh(sph(0.105), fur, 0, 0.34, 0.01);
  root.add(head);
  for (const sx of [-1, 1]) {
    const ear = mesh(sph(0.04), fur, sx * 0.075, 0.42, -0.005);
    ear.scale.set(1, 1, 0.6);
    root.add(ear);
    const inner = mesh(sph(0.022), light, sx * 0.075, 0.42, 0.015);
    inner.scale.set(1, 1, 0.4);
    root.add(inner);
    root.add(mesh(sph(0.014, 8, 6), dark, sx * 0.037, 0.36, 0.093));
    const arm = mesh(new THREE.CapsuleGeometry(0.035, 0.09, 4, 8), fur, sx * 0.13, 0.19, 0.02);
    arm.rotation.z = sx * 0.9;
    root.add(arm);
    const leg = mesh(sph(0.05), fur, sx * 0.07, 0.045, 0.06);
    leg.scale.set(1, 0.9, 1.25);
    root.add(leg);
    const pad = mesh(sph(0.03, 10, 8), light, sx * 0.07, 0.045, 0.118);
    pad.scale.set(1, 1, 0.35);
    root.add(pad);
  }
  const muzzle = mesh(sph(0.045), light, 0, 0.32, 0.085);
  muzzle.scale.set(1.1, 0.8, 0.8);
  root.add(muzzle);
  root.add(mesh(sph(0.017, 8, 6), dark, 0, 0.335, 0.122));
  // little red bow
  const bow = m(0xd23b4b, 0.6);
  for (const sx of [-1, 1]) {
    const w = mesh(new THREE.ConeGeometry(0.03, 0.05, 6), bow, sx * 0.025, 0.255, 0.075);
    w.rotation.z = sx * -Math.PI / 2;
    root.add(w);
  }
  root.add(mesh(sph(0.014, 8, 6), bow, 0, 0.255, 0.08));
  // mud
  const mud: THREE.Object3D[] = [];
  const mudMat = m(0x3f2c1c, 0.85);
  const spots: [number, number, number, number][] = [
    [0.06, 0.2, 0.1, 0.05],
    [-0.09, 0.1, 0.08, 0.045],
    [0.02, 0.4, 0.07, 0.035],
    [-0.1, 0.3, -0.05, 0.04],
    [0.11, 0.07, -0.02, 0.04],
    [0.0, 0.15, -0.11, 0.055],
    [-0.05, 0.04, 0.1, 0.035],
  ];
  for (const [x, y, z, r] of spots) {
    const s = mesh(sph(r, 10, 8), mudMat, x, y, z);
    s.scale.set(1, 0.7, 0.45);
    s.lookAt(new THREE.Vector3(x * 3, y, z * 3));
    s.castShadow = false;
    s.visible = dirty;
    root.add(s);
    mud.push(s);
  }
  return { root, mud, fur };
}

/** Fallback teddy entity: grabbable + washable, tag 'teddy'; washing cleans it (data.washed / data.clean). */
export function spawnFallbackTeddy(game: Game, pos: THREE.Vector3): Entity {
  const t = buildTeddy(true);
  const e = spawnProp(
    game,
    {
      name: 'Muddy Teddy',
      object: t.root,
      shape: 'box',
      mass: 0.8,
      tags: ['grabbable', 'washable', 'teddy', 'toy'],
      sleeping: true,
      data: { dirty: true, itemKind: 'teddy' },
      onWash(g) {
        const first = !e.data.clean;
        e.data.washed = true;
        e.data.clean = true;
        e.data.dirty = false;
        e.name = 'Clean Teddy';
        for (const s of t.mud) s.visible = false;
        t.fur.color.setHex(0xa8764a);
        g.events.emit('sparkle', { entity: e });
        g.sfx('sparkle', undefined, 0.8);
        if (first) {
          g.score(150, 'Washed The Teddy');
          g.hint('Good as new! Bring him back to the kid.', 3.5);
          g.events.emit('teddyWashed', { entity: e });
        } else g.score(10, 'Extra Clean Teddy');
      },
    },
    pos,
    Math.random() * Math.PI * 2,
  );
  e.data.teddyModel = t;
  return e;
}

/** A flat mud splat on the ground (where the teddy fell). */
export function mudPuddle(r = 0.9): THREE.Mesh {
  const g = new THREE.CircleGeometry(r, 20);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const a = Math.atan2(y, x);
    const k = 0.75 + 0.25 * Math.sin(a * 3 + 1) * Math.sin(a * 5);
    pos.setXY(i, x * k, y * k);
  }
  g.rotateX(-Math.PI / 2);
  const mm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.35, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }));
  mm.receiveShadow = true;
  mm.name = 'MudPuddle';
  return mm;
}

// ================================================================================================ grapes

export function buildGrapes(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'Grapes';
  const purple = m(0x6b2d8c, 0.35, 0.05);
  const purple2 = m(0x7d3aa0, 0.35, 0.05);
  const geo = sph(0.034, 10, 8);
  let i = 0;
  for (let row = 0; row < 5; row++) {
    const n = 5 - row;
    const y = 0.02 + row * 0.045;
    const r = 0.012 + (5 - row) * 0.011;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + row * 0.7;
      g.add(mesh(geo, i++ % 3 ? purple : purple2, Math.cos(a) * r, 0.26 - y, Math.sin(a) * r * 0.8));
    }
  }
  const stem = mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.07, 5), m(0x5a7a2a, 0.8), 0, 0.28, 0);
  g.add(stem);
  const leaf = mesh(sph(0.04, 8, 6), m(0x4c8f32, 0.7), 0.03, 0.29, 0);
  leaf.scale.set(1, 0.2, 0.7);
  g.add(leaf);
  return g;
}

export function spawnFallbackGrapes(game: Game, pos: THREE.Vector3): Entity {
  return spawnProp(
    game,
    { name: 'Grapes', object: buildGrapes(), shape: 'box', mass: 0.4, tags: ['grabbable', 'washable', 'food', 'fruit'], sleeping: true, data: { itemKind: 'grapes' } },
    pos,
    Math.random() * Math.PI,
  );
}

/** A cute ceramic bowl (static decoration). */
export function buildBowl(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'GrapeBowl';
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.06 + Math.sin(t * Math.PI * 0.5) * 0.14, t * 0.1));
  }
  const bowl = mesh(new THREE.LatheGeometry(pts, 24), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.3, side: THREE.DoubleSide }));
  g.add(bowl);
  const rim = mesh(new THREE.TorusGeometry(0.2, 0.008, 6, 28), m(0x3b6fd8, 0.4), 0, 0.1, 0);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  return g;
}

// ================================================================================================ crow gifts

export interface GiftDef {
  kind: string;
  name: string;
  tags: string[];
  mass: number;
  build: () => THREE.Object3D;
}

function bottleCap() {
  const g = new THREE.Group();
  const gold = m(0xffc53d, 0.22, 1);
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.047, 0.016, 18), gold));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const c = mesh(new THREE.BoxGeometry(0.012, 0.018, 0.008), gold, Math.cos(a) * 0.048, 0, Math.sin(a) * 0.048);
    c.rotation.y = -a;
    g.add(c);
  }
  const star = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 5), m(0xd8322e, 0.4), 0, 0.009, 0);
  g.add(star);
  return g;
}

function keyModel() {
  const g = new THREE.Group();
  const brass = m(0xd6a53c, 0.28, 1);
  const bow = mesh(new THREE.TorusGeometry(0.024, 0.008, 8, 16), brass, 0, 0, -0.05);
  bow.rotation.x = Math.PI / 2;
  g.add(bow);
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.01, 0.09), brass, 0, 0, 0.02));
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.022, 0.012), brass, 0, -0.012, 0.055));
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.016, 0.01), brass, 0, -0.009, 0.035));
  return g;
}

function cashModel() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#86b97a';
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = '#3f6e3a';
  ctx.lineWidth = 5;
  ctx.strokeRect(5, 5, 118, 54);
  ctx.fillStyle = '#2f5a2c';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$1', 64, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const bill = mesh(new THREE.BoxGeometry(0.16, 0.004, 0.075), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  bill.rotation.z = 0.08;
  const g = new THREE.Group();
  g.add(bill);
  return g;
}

function fryModel() {
  const g = new THREE.Group();
  const fry = mesh(new THREE.BoxGeometry(0.024, 0.024, 0.13), m(0xf2c14e, 0.6));
  fry.rotation.y = 0.3;
  g.add(fry);
  return g;
}

function marbleModel() {
  const g = new THREE.Group();
  g.add(mesh(sph(0.032, 16, 12), m(0x3aa7ff, 0.05, 0.1, { emissive: 0x0b3a66, emissiveIntensity: 0.4 })));
  const swirl = mesh(sph(0.02, 10, 8), m(0xffffff, 0.1), 0.004, 0.005, 0.004);
  swirl.scale.set(1, 0.3, 1);
  g.add(swirl);
  return g;
}

function earringModel() {
  const g = new THREE.Group();
  const ring = mesh(new THREE.TorusGeometry(0.026, 0.005, 8, 20), m(0xffcf4a, 0.2, 1));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.add(mesh(new THREE.OctahedronGeometry(0.014), m(0xe23a6a, 0.1, 0.2, { emissive: 0x5a0a20, emissiveIntensity: 0.5 }), 0, 0, 0.03));
  return g;
}

function pennyModel() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 18), m(0xc4703c, 0.3, 1)));
  return g;
}

export const GIFTS: GiftDef[] = [
  { kind: 'bottlecap', name: 'Golden Bottle Cap', tags: ['grabbable', 'washable', 'shiny'], mass: 0.05, build: bottleCap },
  { kind: 'key', name: 'Mystery Key', tags: ['grabbable', 'washable', 'shiny'], mass: 0.05, build: keyModel },
  { kind: 'cash', name: 'Crumpled Dollar', tags: ['grabbable', 'washable', 'cash'], mass: 0.02, build: cashModel },
  { kind: 'fries', name: 'Single French Fry', tags: ['grabbable', 'food'], mass: 0.02, build: fryModel },
  { kind: 'marble', name: 'Shiny Marble', tags: ['grabbable', 'washable', 'shiny'], mass: 0.05, build: marbleModel },
  { kind: 'earring', name: 'Lost Earring', tags: ['grabbable', 'washable', 'shiny'], mass: 0.02, build: earringModel },
  { kind: 'penny', name: 'Lucky Penny', tags: ['grabbable', 'washable', 'shiny'], mass: 0.02, build: pennyModel },
];

export function spawnFallbackGift(game: Game, def: GiftDef, pos: THREE.Vector3): Entity {
  const obj = def.build();
  obj.scale.setScalar(1.6); // readable next to a 0.8 m raccoon
  const holder = new THREE.Group();
  holder.add(obj);
  return spawnProp(
    game,
    {
      name: def.name,
      object: holder,
      shape: 'box',
      mass: def.mass * 4,
      tags: def.tags,
      sleeping: false,
      ccd: true,
      restitution: 0.3,
      data: { itemKind: def.kind, crowGift: true },
    },
    pos,
    Math.random() * Math.PI * 2,
  );
}

// ================================================================================================ porch

export interface RockingChair {
  root: THREE.Group;
  /** Rocks around this node (child of root). */
  rocker: THREE.Group;
  /** Seat point (child of rocker) — where Grandma's hips go. */
  seat: THREE.Object3D;
}

export function buildRockingChair(): RockingChair {
  const root = new THREE.Group();
  root.name = 'RockingChair';
  const rocker = new THREE.Group();
  root.add(rocker);
  const wood = m(0x8a5a36, 0.7);
  const woodDark = m(0x6b4428, 0.75);
  // rockers: arcs under the legs (curve in the YZ plane, lowest point at y = 0.025)
  const arcPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = -0.42 + (i / 12) * 0.84;
    arcPts.push(new THREE.Vector3(0, 0.025 + 1.1 - Math.cos(a) * 1.1, Math.sin(a) * 1.1));
  }
  const arcGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), 16, 0.025, 6, false);
  for (const sx of [-1, 1]) {
    const arc = mesh(arcGeo, woodDark, sx * 0.24, 0, 0);
    rocker.add(arc);
    for (const z of [-0.2, 0.22]) rocker.add(mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), wood, sx * 0.24, 0.24, z));
    // arm rests
    rocker.add(mesh(new THREE.BoxGeometry(0.07, 0.04, 0.5), wood, sx * 0.26, 0.66, 0.02));
    rocker.add(mesh(new THREE.BoxGeometry(0.04, 0.24, 0.04), wood, sx * 0.26, 0.54, 0.22));
  }
  rocker.add(mesh(new THREE.BoxGeometry(0.56, 0.06, 0.5), wood, 0, 0.45, 0));
  // back
  const back = new THREE.Group();
  back.position.set(0, 0.45, -0.24);
  back.rotation.x = -0.22;
  rocker.add(back);
  for (const sx of [-1, 1]) back.add(mesh(new THREE.BoxGeometry(0.05, 0.75, 0.05), wood, sx * 0.25, 0.38, 0));
  for (let i = 0; i < 5; i++) back.add(mesh(new THREE.BoxGeometry(0.035, 0.6, 0.02), wood, -0.16 + i * 0.08, 0.36, 0));
  back.add(mesh(new THREE.BoxGeometry(0.58, 0.07, 0.05), wood, 0, 0.74, 0));
  // cushion + a crocheted blanket over the back
  rocker.add(mesh(new THREE.BoxGeometry(0.5, 0.05, 0.45), m(0xc94f6d, 0.9), 0, 0.5, 0.01));
  const blanket = mesh(new THREE.BoxGeometry(0.52, 0.4, 0.03), m(0xf2c14e, 0.95), 0, 0.5, -0.02);
  back.add(blanket);
  const seat = new THREE.Object3D();
  seat.position.set(0, 0.5, 0.02);
  rocker.add(seat);
  return { root, rocker, seat };
}

/** Knitted beanie with a pompom (fallback Grandma's Hat for Jimothy). */
export function buildKnittedHat(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'GrandmaHat';
  const geo = new THREE.SphereGeometry(0.17, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const red = new THREE.Color(0xd8425a);
  const cream = new THREE.Color(0xf6ead2);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const c = Math.floor(y / 0.035) % 2 ? cream : red;
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const knit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const dome = mesh(geo, knit);
  dome.scale.set(1, 0.85, 1);
  g.add(dome);
  const brim = mesh(new THREE.TorusGeometry(0.165, 0.035, 8, 26), m(0xd8425a, 1));
  brim.rotation.x = Math.PI / 2;
  brim.position.y = 0.01;
  g.add(brim);
  const pom = mesh(new THREE.IcosahedronGeometry(0.055, 1), m(0xf6ead2, 1), 0, 0.155, 0);
  g.add(pom);
  return g;
}
