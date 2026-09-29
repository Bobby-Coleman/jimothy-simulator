import * as THREE from 'three';
import type { Game } from '../../../../core/Game';
import type { Entity } from '../../../../core/Entities';
import { spawnProp, destroyProp } from '../../../../entities/Props';
import { mergeColored, normalise, T, TR } from './batch';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cached } from './textures';
import type { AtlasRect, SignAtlas } from './signs';
import { Rng } from './util';

/**
 * Dynamic gameplay props for the central zones. Every prop is a single vertex-coloured mesh where possible
 * (1 draw call each). Swap `spawnTrashCan` for the items agent's nicer version when it lands.
 */

function propMat() {
  return cached('mat:prop', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 }));
}
function propMatSoft() {
  return cached('mat:propSoft', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
}
function propMatShiny() {
  return cached('mat:propShiny', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.55 }));
}

const cyl = (rt: number, rb: number, h: number, seg = 14) => new THREE.CylinderGeometry(rt, rb, h, seg);
const bx = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------------------------------- trash can

function trashCanGeo(style: 'city' | 'metal') {
  return cached(`geo:trash:${style}`, () => {
    if (style === 'metal') {
      const m = 0x7d878f;
      return mergeColored([
        { geo: cyl(0.31, 0.27, 0.92, 16), color: m, matrix: T(0, 0.46, 0) },
        { geo: cyl(0.325, 0.325, 0.04, 16), color: 0x69727a, matrix: T(0, 0.3, 0) },
        { geo: cyl(0.325, 0.325, 0.04, 16), color: 0x69727a, matrix: T(0, 0.7, 0) },
        { geo: cyl(0.34, 0.34, 0.06, 16), color: 0x5c656c, matrix: T(0, 0.95, 0) },
        { geo: new THREE.SphereGeometry(0.33, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), color: 0x6f7880, matrix: T(0, 0.97, 0, 0, 1, 0.3, 1) },
        { geo: bx(0.18, 0.04, 0.04), color: 0x444b51, matrix: T(0, 1.1, 0) },
      ]);
    }
    const g = 0x2f6650;
    const parts: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [
      { geo: cyl(0.32, 0.3, 0.9, 18), color: g, matrix: T(0, 0.47, 0) },
      { geo: cyl(0.34, 0.34, 0.05, 18), color: 0x234d3c, matrix: T(0, 0.04, 0) },
      { geo: cyl(0.345, 0.33, 0.12, 18), color: 0x1f2a26, matrix: T(0, 0.98, 0) },
      { geo: cyl(0.2, 0.2, 0.03, 14), color: 0x0d0f0e, matrix: T(0, 1.045, 0) },
    ];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      parts.push({ geo: bx(0.05, 0.8, 0.03), color: 0x3a7d62, matrix: T(Math.cos(a) * 0.315, 0.48, Math.sin(a) * 0.315, -a + Math.PI / 2) });
    }
    return mergeColored(parts);
  });
}

/** Public trash can: grabbable, tippable, washable. ~9 kg. */
export function spawnTrashCan(game: Game, pos: THREE.Vector3, rotY = 0, style: 'city' | 'metal' = 'city'): Entity {
  return spawnProp(
    game,
    { name: 'Trash Can', object: mesh(trashCanGeo(style), propMat()), shape: 'cylinder', mass: 9, tags: ['grabbable', 'trashcan', 'washable'] },
    pos,
    rotY,
  );
}

// ------------------------------------------------------------------------------------------- cotton candy

function cottonCandyGeo(seed: number) {
  return cached(`geo:cc:${seed % 3}`, () => {
    const r = new Rng(seed % 3 + 40);
    const pinks = seed % 3 === 1 ? [0x9fd8ff, 0xb9e4ff, 0xd6efff] : [0xff9fd2, 0xffb6de, 0xffc9e6];
    const parts: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [
      { geo: cyl(0.014, 0.014, 0.36, 6), color: 0xf2e3c6, matrix: T(0, 0.18, 0) },
      { geo: new THREE.IcosahedronGeometry(0.15, 1), color: pinks[0], matrix: T(0, 0.42, 0, 0, 1, 1.15, 1) },
    ];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push({ geo: new THREE.IcosahedronGeometry(r.range(0.07, 0.1), 1), color: pinks[1 + (i % 2)], matrix: T(Math.cos(a) * 0.1, 0.4 + r.range(-0.07, 0.1), Math.sin(a) * 0.1) });
    }
    return mergeColored(parts);
  });
}

/** Cotton candy: pink fluffy sphere on a stick. Washing it makes it dissolve (sad trombone). */
export function spawnCottonCandy(game: Game, pos: THREE.Vector3, seed = 0): Entity {
  return noShadow(spawnProp(
    game,
    {
      name: 'Cotton Candy',
      object: mesh(cottonCandyGeo(seed), propMatSoft()),
      mass: 0.2,
      tags: ['grabbable', 'food', 'cottoncandy'],
      onWash(g) {
        g.score(250, "Where'd It Go?");
        g.hint('Jimothy washed the cotton candy. It is gone. He stares at his empty hands.', 4);
        g.sfx('sad_trombone');
        g.events.emit('cottonCandyGone', {});
        const p = g.get<any>('player');
        const e = p?.held?.entity;
        if (e) {
          p.release(false);
          destroyProp(g, e);
        }
      },
    },
    pos,
  ));
}

// ------------------------------------------------------------------------------------------- food & small stuff

export function spawnHotDog(game: Game, pos: THREE.Vector3, rotY = 0): Entity {
  const geo = cached('geo:hotdog', () =>
    mergeColored([
      { geo: new THREE.CapsuleGeometry(0.045, 0.2, 4, 10), color: 0xd9a35b, matrix: TR(0, 0.045, 0.028, 0, 0, Math.PI / 2) },
      { geo: new THREE.CapsuleGeometry(0.045, 0.2, 4, 10), color: 0xd9a35b, matrix: TR(0, 0.045, -0.028, 0, 0, Math.PI / 2) },
      { geo: new THREE.CapsuleGeometry(0.03, 0.26, 4, 10), color: 0xb5432f, matrix: TR(0, 0.085, 0, 0, 0, Math.PI / 2) },
      { geo: bx(0.22, 0.012, 0.015), color: 0xffd21f, matrix: T(0, 0.118, 0) },
    ]),
  );
  return noShadow(spawnProp(game, { name: 'Hot Dog', object: mesh(geo, propMatSoft()), mass: 0.25, tags: ['grabbable', 'food', 'hotdog', 'washable'] }, pos, rotY));
}

export function spawnCoffeeCup(game: Game, pos: THREE.Vector3, brand: 'starbrews' | 'beanmeup' = 'starbrews'): Entity {
  const geo = cached(`geo:cup:${brand}`, () =>
    mergeColored([
      { geo: cyl(0.045, 0.035, 0.14, 12), color: 0xf7f3ea, matrix: T(0, 0.07, 0) },
      { geo: cyl(0.047, 0.043, 0.05, 12), color: brand === 'starbrews' ? 0x1e7a4f : 0x7a3fb8, matrix: T(0, 0.075, 0) },
      { geo: cyl(0.043, 0.049, 0.025, 12), color: 0xffffff, matrix: T(0, 0.152, 0) },
    ]),
  );
  return noShadow(spawnProp(game, { name: 'Coffee', object: mesh(geo, propMat()), shape: 'cylinder', mass: 0.3, tags: ['grabbable', 'food', 'coffee', 'washable'] }, pos));
}

// ------------------------------------------------------------------------------------------- alley junk

export function spawnDumpster(game: Game, pos: THREE.Vector3, rotY = 0, color = 0x2f6b4a): Entity {
  const geo = cached(`geo:dumpster:${color}`, () => {
    const dark = 0x1b1d1f;
    return mergeColored([
      { geo: bx(1.9, 1.05, 1.15), color, matrix: T(0, 0.68, 0) },
      { geo: bx(1.98, 0.1, 1.22), color, matrix: T(0, 1.2, 0) },
      { geo: bx(0.95, 0.07, 1.2), color: dark, matrix: TR(-0.48, 1.3, 0.02, 0.08, 0, 0) },
      { geo: bx(0.95, 0.07, 1.2), color: dark, matrix: TR(0.48, 1.36, -0.05, 0.25, 0, 0) },
      { geo: bx(2.02, 0.12, 0.08), color: 0x9aa0a6, matrix: T(0, 0.95, 0.6) },
      { geo: bx(0.08, 0.5, 0.25), color, matrix: T(-1.0, 0.8, 0) },
      { geo: bx(0.08, 0.5, 0.25), color, matrix: T(1.0, 0.8, 0) },
      { geo: bx(1.6, 0.08, 0.02), color: 0xf2f2f2, matrix: T(0, 0.75, 0.585) },
      ...[-0.75, 0.75].flatMap((x) =>
        [-0.42, 0.42].map((z) => ({ geo: cyl(0.08, 0.08, 0.06, 10), color: dark, matrix: TR(x, 0.08, z, 0, 0, Math.PI / 2) })),
      ),
    ]);
  });
  return spawnProp(
    game,
    { name: 'Dumpster', object: mesh(geo, propMat()), mass: 180, tags: ['grabbable', 'dumpster'], friction: 0.9, impactThreshold: 4000 },
    pos,
    rotY,
  );
}

export function spawnPallet(game: Game, pos: THREE.Vector3, rotY = 0): Entity {
  const geo = cached('geo:pallet', () => {
    const w = 0xb58a55;
    const parts: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [];
    for (let i = 0; i < 5; i++) parts.push({ geo: bx(1.2, 0.025, 0.16), color: i % 2 ? w : 0xa47a48, matrix: T(0, 0.14, -0.4 + i * 0.2) });
    for (const x of [-0.55, 0, 0.55]) parts.push({ geo: bx(0.1, 0.1, 1.0), color: 0x96703f, matrix: T(x, 0.075, 0) });
    for (let i = 0; i < 3; i++) parts.push({ geo: bx(1.2, 0.025, 0.14), color: w, matrix: T(0, 0.0125, -0.4 + i * 0.4) });
    return mergeColored(parts);
  });
  return spawnProp(game, { name: 'Pallet', object: mesh(geo, propMatSoft()), mass: 14, tags: ['grabbable', 'washable'] }, pos, rotY);
}

export function spawnCardboardBox(game: Game, pos: THREE.Vector3, rotY = 0, s = 0.55): Entity {
  const geo = cached(`geo:cbox:${s}`, () =>
    mergeColored([
      { geo: bx(s, s * 0.8, s), color: 0xb98d5a, matrix: T(0, s * 0.4, 0) },
      { geo: bx(s * 0.18, s * 0.805, s * 1.005), color: 0xd8c39a, matrix: T(0, s * 0.4, 0) },
    ]),
  );
  return noShadow(spawnProp(game, { name: 'Cardboard Box', object: mesh(geo, propMatSoft()), mass: 2, tags: ['grabbable', 'washable'] }, pos, rotY));
}

export function spawnTrashBag(game: Game, pos: THREE.Vector3, seed = 0): Entity {
  const geo = cached(`geo:bag:${seed % 2}`, () => {
    const g = new THREE.IcosahedronGeometry(0.3, 1);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const r = new Rng(seed % 2 + 3);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = y > 0.15 ? 0.7 : 1;
      p.setXYZ(i, p.getX(i) * k * r.range(0.95, 1.05), y * 0.85, p.getZ(i) * k * r.range(0.95, 1.05));
    }
    return mergeColored([
      { geo: g, color: seed % 3 === 2 ? 0x3a5f8a : 0x202124, matrix: T(0, 0.26, 0) },
      { geo: new THREE.ConeGeometry(0.08, 0.14, 6), color: seed % 3 === 2 ? 0x3a5f8a : 0x202124, matrix: T(0, 0.58, 0) },
    ]);
  });
  return noShadow(spawnProp(game, { name: 'Trash Bag', object: mesh(geo, propMatShiny()), shape: 'ball', mass: 3, tags: ['grabbable', 'washable', 'trash'] }, pos));
}

export function spawnCrate(game: Game, pos: THREE.Vector3, rotY = 0): Entity {
  const geo = cached('geo:crate', () => {
    const parts: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [{ geo: bx(0.62, 0.62, 0.62), color: 0xc49a5c, matrix: T(0, 0.31, 0) }];
    for (const z of [-0.315, 0.315]) {
      parts.push({ geo: bx(0.64, 0.08, 0.02), color: 0x9a7240, matrix: T(0, 0.08, z) });
      parts.push({ geo: bx(0.64, 0.08, 0.02), color: 0x9a7240, matrix: T(0, 0.54, z) });
      parts.push({ geo: bx(0.08, 0.64, 0.02), color: 0x9a7240, matrix: TR(0, 0.31, z, 0, 0, 0.75) });
    }
    return mergeColored(parts);
  });
  return spawnProp(game, { name: 'Crate', object: mesh(geo, propMatSoft()), mass: 7, tags: ['grabbable', 'washable'] }, pos, rotY);
}

// ------------------------------------------------------------------------------------------- café furniture

export function spawnCafeChair(game: Game, pos: THREE.Vector3, rotY = 0, color = 0x2f6b5a): Entity {
  const geo = cached(`geo:chair:${color}`, () => {
    const parts: { geo: THREE.BufferGeometry; color: number; matrix: THREE.Matrix4 }[] = [
      { geo: cyl(0.21, 0.21, 0.04, 14), color, matrix: T(0, 0.46, 0) },
      { geo: bx(0.4, 0.3, 0.03), color, matrix: TR(0, 0.72, -0.2, -0.12, 0, 0) },
    ];
    for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) {
      parts.push({ geo: cyl(0.015, 0.015, 0.46, 5), color: 0x222222, matrix: T(x, 0.23, z) });
    }
    parts.push({ geo: cyl(0.015, 0.015, 0.3, 5), color: 0x222222, matrix: T(-0.17, 0.62, -0.19) });
    parts.push({ geo: cyl(0.015, 0.015, 0.3, 5), color: 0x222222, matrix: T(0.17, 0.62, -0.19) });
    return mergeColored(parts);
  });
  return noShadow(spawnProp(game, { name: 'Chair', object: mesh(geo, propMat()), mass: 4, tags: ['grabbable', 'washable'] }, pos, rotY));
}

export function spawnCafeTable(game: Game, pos: THREE.Vector3, rotY = 0): Entity {
  const geo = cached('geo:table', () =>
    mergeColored([
      { geo: cyl(0.36, 0.36, 0.04, 18), color: 0xeae3d2, matrix: T(0, 0.74, 0) },
      { geo: cyl(0.03, 0.03, 0.72, 8), color: 0x2a2a2a, matrix: T(0, 0.36, 0) },
      { geo: cyl(0.22, 0.24, 0.04, 14), color: 0x2a2a2a, matrix: T(0, 0.02, 0) },
    ]),
  );
  return spawnProp(game, { name: 'Café Table', object: mesh(geo, propMat()), mass: 10, tags: ['grabbable', 'washable'] }, pos, rotY);
}

/** Folding chair (press rows at City Hall). */
export function spawnFoldingChair(game: Game, pos: THREE.Vector3, rotY = 0): Entity {
  const geo = cached('geo:fchair', () =>
    mergeColored([
      { geo: bx(0.42, 0.04, 0.4), color: 0x2b3e66, matrix: T(0, 0.46, 0) },
      { geo: bx(0.42, 0.28, 0.03), color: 0x2b3e66, matrix: TR(0, 0.75, -0.2, -0.1, 0, 0) },
      { geo: bx(0.03, 0.9, 0.03), color: 0x9aa0a6, matrix: TR(-0.19, 0.45, 0, 0.35, 0, 0) },
      { geo: bx(0.03, 0.9, 0.03), color: 0x9aa0a6, matrix: TR(0.19, 0.45, 0, 0.35, 0, 0) },
      { geo: bx(0.03, 0.62, 0.03), color: 0x9aa0a6, matrix: TR(-0.19, 0.3, 0, -0.45, 0, 0) },
      { geo: bx(0.03, 0.62, 0.03), color: 0x9aa0a6, matrix: TR(0.19, 0.3, 0, -0.45, 0, 0) },
    ]),
  );
  return noShadow(spawnProp(game, { name: 'Folding Chair', object: mesh(geo, propMat()), mass: 3.5, tags: ['grabbable', 'washable'] }, pos, rotY));
}

// ------------------------------------------------------------------------------------------- signs

/** A-frame sandwich board showing an atlas region on both faces (single mesh, atlas material). */
export function spawnSandwichBoard(game: Game, atlas: SignAtlas, rect: AtlasRect, pos: THREE.Vector3, rotY = 0): Entity {
  const geo = cached(`geo:sb:${rect.u0.toFixed(4)}:${rect.v0.toFixed(4)}`, () => {
    // frame boxes sample the board's wooden border colour inside the atlas rect
    const fu = rect.u0 + (rect.u1 - rect.u0) * 0.02;
    const fv = rect.v0 + (rect.v1 - rect.v0) * 0.5;
    const frameParts = [
      T(0, 0.96, 0).multiply(new THREE.Matrix4().makeScale(0.66, 0.04, 0.04)),
      TR(-0.31, 0.49, 0.14, 0.28, 0, 0).multiply(new THREE.Matrix4().makeScale(0.04, 1.0, 0.04)),
      TR(0.31, 0.49, 0.14, 0.28, 0, 0).multiply(new THREE.Matrix4().makeScale(0.04, 1.0, 0.04)),
      TR(-0.31, 0.49, -0.14, -0.28, 0, 0).multiply(new THREE.Matrix4().makeScale(0.04, 1.0, 0.04)),
      TR(0.31, 0.49, -0.14, -0.28, 0, 0).multiply(new THREE.Matrix4().makeScale(0.04, 1.0, 0.04)),
    ].map((m) => {
      const g = new THREE.BoxGeometry(1, 1, 1).applyMatrix4(m);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, fu, fv);
      return g;
    });
    const f1 = atlas.quad(rect, 0.58, 0.82).applyMatrix4(TR(0, 0.5, 0.155, -0.28, 0, 0));
    const f2 = atlas.quad(rect, 0.58, 0.82).applyMatrix4(TR(0, 0.5, -0.155, 0.28, Math.PI, 0));
    return mergeGeometries([...frameParts, f1, f2].map((g) => normalise(g)), false)!;
  });
  return noShadow(spawnProp(game, { name: 'Sandwich Board', object: mesh(geo, rect.page.mat), mass: 6, tags: ['grabbable', 'washable'], size: new THREE.Vector3(0.66, 1.0, 0.5) }, pos, rotY));
}

/** Small props skip the shadow pass (they are many; the lead asked for cheap frames). */
function noShadow(e: Entity): Entity {
  e.object?.traverse((o) => {
    (o as THREE.Mesh).castShadow = false;
  });
  return e;
}
