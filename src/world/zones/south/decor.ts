import * as THREE from 'three';
import { bake, canvasTex, GEO, type Batch, type Kit, type V3 } from './kit';

/** Shared decor: birds (instanced flocks), lamps with fake night light pools, swan boats, kites. */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

const birdMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });

export const BIRD = {
  duck: () =>
    bake([
      { geo: GEO.sphere(12, 8), pos: [0, 0.1, 0], scale: [0.16, 0.12, 0.26], color: 0x8a6a4a },
      { geo: GEO.sphere(10, 8), pos: [0, 0.1, -0.02], scale: [0.165, 0.08, 0.2], color: 0xd8d4cc },
      { geo: GEO.sphere(10, 8), pos: [0, 0.28, 0.2], scale: 0.1, color: 0x1f7a3a },
      { geo: GEO.box, pos: [0, 0.2, 0.18], scale: [0.18, 0.03, 0.05], color: 0xffffff },
      { geo: GEO.box, pos: [0, 0.27, 0.32], scale: [0.07, 0.035, 0.1], color: 0xf2a51a },
      { geo: GEO.box, pos: [0, 0.16, -0.26], rot: [-0.5, 0, 0], scale: [0.1, 0.04, 0.12], color: 0x2a2a2a },
      { geo: GEO.sphere(6, 4), pos: [0.06, 0.31, 0.26], scale: 0.018, color: 0x111111 },
      { geo: GEO.sphere(6, 4), pos: [-0.06, 0.31, 0.26], scale: 0.018, color: 0x111111 },
    ]),
  duckling: () =>
    bake([
      { geo: GEO.sphere(10, 8), pos: [0, 0.07, 0], scale: [0.08, 0.07, 0.11], color: 0xffd84a },
      { geo: GEO.sphere(10, 8), pos: [0, 0.15, 0.08], scale: 0.06, color: 0xffe066 },
      { geo: GEO.box, pos: [0, 0.14, 0.15], scale: [0.04, 0.02, 0.05], color: 0xf28c1a },
      { geo: GEO.sphere(6, 4), pos: [0.035, 0.17, 0.12], scale: 0.012, color: 0x111111 },
      { geo: GEO.sphere(6, 4), pos: [-0.035, 0.17, 0.12], scale: 0.012, color: 0x111111 },
    ]),
  crow: () =>
    bake([
      { geo: GEO.sphere(10, 8), pos: [0, 0.14, 0], scale: [0.1, 0.11, 0.18], color: 0x1b1d24 },
      { geo: GEO.sphere(10, 8), pos: [0, 0.25, 0.13], scale: 0.075, color: 0x22252d },
      { geo: GEO.cyl(0.05, 5), pos: [0, 0.24, 0.23], rot: [Math.PI / 2, 0, 0], scale: [0.03, 0.1, 0.03], color: 0x3a3a3a },
      { geo: GEO.box, pos: [0, 0.14, -0.2], rot: [-0.3, 0, 0], scale: [0.09, 0.02, 0.14], color: 0x15161b },
      { geo: GEO.box, pos: [0.04, 0.02, 0.02], scale: [0.012, 0.06, 0.012], color: 0x333333 },
      { geo: GEO.box, pos: [-0.04, 0.02, 0.02], scale: [0.012, 0.06, 0.012], color: 0x333333 },
      { geo: GEO.sphere(6, 4), pos: [0.045, 0.27, 0.18], scale: 0.014, color: 0xffffff },
      { geo: GEO.sphere(6, 4), pos: [-0.045, 0.27, 0.18], scale: 0.014, color: 0xffffff },
    ]),
  /** Flying crow / gull: body + spread wings (one mesh). */
  flyer: (body: number, wing: number, beak: number) =>
    bake([
      { geo: GEO.sphere(10, 8), pos: [0, 0, 0], scale: [0.11, 0.1, 0.24], color: body },
      { geo: GEO.sphere(8, 6), pos: [0, 0.05, 0.2], scale: 0.08, color: body },
      { geo: GEO.box, pos: [0, 0.04, 0.3], scale: [0.03, 0.03, 0.08], color: beak },
      { geo: GEO.box, pos: [0.32, 0.03, 0], rot: [0, 0, 0.12], scale: [0.5, 0.02, 0.18], color: wing },
      { geo: GEO.box, pos: [-0.32, 0.03, 0], rot: [0, 0, -0.12], scale: [0.5, 0.02, 0.18], color: wing },
      { geo: GEO.box, pos: [0.62, 0.08, -0.02], rot: [0, 0, 0.3], scale: [0.2, 0.02, 0.12], color: 0x222222 },
      { geo: GEO.box, pos: [-0.62, 0.08, -0.02], rot: [0, 0, -0.3], scale: [0.2, 0.02, 0.12], color: 0x222222 },
      { geo: GEO.box, pos: [0, 0, -0.3], scale: [0.14, 0.02, 0.14], color: wing },
    ]),
  gull: () =>
    bake([
      { geo: GEO.sphere(10, 8), pos: [0, 0.16, 0], scale: [0.11, 0.12, 0.22], color: 0xf7f7f4 },
      { geo: GEO.sphere(10, 8), pos: [0, 0.3, 0.14], scale: 0.085, color: 0xffffff },
      { geo: GEO.box, pos: [0, 0.28, 0.26], scale: [0.03, 0.03, 0.1], color: 0xf2c12e },
      { geo: GEO.box, pos: [0.1, 0.19, -0.04], rot: [0.1, 0, 0.2], scale: [0.03, 0.09, 0.3], color: 0x9aa3ad },
      { geo: GEO.box, pos: [-0.1, 0.19, -0.04], rot: [0.1, 0, -0.2], scale: [0.03, 0.09, 0.3], color: 0x9aa3ad },
      { geo: GEO.box, pos: [0, 0.18, -0.24], rot: [-0.2, 0, 0], scale: [0.12, 0.03, 0.12], color: 0x2a2a2a },
      { geo: GEO.box, pos: [0.04, 0.03, 0.02], scale: [0.012, 0.08, 0.012], color: 0xf2a33a },
      { geo: GEO.box, pos: [-0.04, 0.03, 0.02], scale: [0.012, 0.08, 0.012], color: 0xf2a33a },
      { geo: GEO.sphere(6, 4), pos: [0.05, 0.33, 0.19], scale: 0.013, color: 0x111111 },
      { geo: GEO.sphere(6, 4), pos: [-0.05, 0.33, 0.19], scale: 0.013, color: 0x111111 },
    ]),
};

/** Static perched birds (instanced). xforms: [x, y, z, rotY, scale] */
export function perched(kit: Kit, geo: THREE.BufferGeometry, xforms: [number, number, number, number, number?][]) {
  const im = new THREE.InstancedMesh(geo, birdMat, xforms.length);
  xforms.forEach(([x, y, z, ry, s], i) => {
    _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(Y, ry), _s.setScalar(s ?? 1));
    im.setMatrixAt(i, _m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = true;
  im.computeBoundingSphere();
  kit.root.add(im);
  return im;
}

/** Moving flock: path(i, t, out) → heading. The mesh is added to the scene (not static root). */
export function flock(kit: Kit, geo: THREE.BufferGeometry, count: number, center: THREE.Vector3, range: number, path: (i: number, t: number, out: THREE.Vector3) => number, scale = 1) {
  const im = new THREE.InstancedMesh(geo, birdMat, count);
  im.castShadow = true;
  im.frustumCulled = false;
  im.userData.scale = scale;
  kit.game.scene.add(im);
  const f = { mesh: im, path, count, center, range };
  kit.state.flocks.push(f);
  // initial placement
  updateFlock(f, 0);
  return f;
}

export function updateFlock(f: { mesh: THREE.InstancedMesh; path: (i: number, t: number, out: THREE.Vector3) => number; count: number }, t: number) {
  const s = (f.mesh.userData.scale as number) ?? 1;
  for (let i = 0; i < f.count; i++) {
    const heading = f.path(i, t, _p);
    const bank = f.mesh.userData.bank ?? 0;
    _q.setFromAxisAngle(Y, heading);
    if (bank) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bank));
    _m.compose(_p, _q, _s.setScalar(s));
    f.mesh.setMatrixAt(i, _m);
  }
  f.mesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------------ lamps

let poolTex: THREE.Texture | null = null;
function lightPoolTexture() {
  if (poolTex) return poolTex;
  poolTex = canvasTex(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,220,150,1)');
    g.addColorStop(0.4, 'rgba(255,200,120,0.45)');
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  return poolTex;
}

/**
 * Street/park lamps. Poles go into the batch (with colliders), bulbs are one instanced emissive mesh,
 * and at night an additive "light pool" decal fakes the light on the ground (no real lights).
 * list: [x, y, z]
 */
export function lamps(kit: Kit, b: Batch, list: V3[], o: { style?: 'park' | 'harbor' | 'modern'; pole?: number; height?: number; color?: number } = {}) {
  const style = o.style ?? 'park';
  const pole = o.pole ?? (style === 'harbor' ? 0x24343f : style === 'modern' ? 0x5d6770 : 0x23392c);
  const H = o.height ?? (style === 'modern' ? 5.5 : 3.8);
  const bulbs: [number, number, number][] = [];
  for (const [x, y, z] of list) {
    b.cyl([x, y + 0.2, z], 0.2, 0.4, pole, { seg: 8, collide: false });
    b.cyl([x, y + H / 2, z], 0.07, H, pole, { seg: 8, collide: false });
    kit.collider([x, y + H / 2, z], [0.2, H, 0.2]);
    if (style === 'park') {
      b.cyl([x, y + H + 0.05, z], 0.22, 0.1, pole, { seg: 8, collide: false });
      b.cyl([x, y + H + 0.62, z], 0.12, 0.35, pole, { rTop: 0.34, seg: 8, collide: false });
      b.cyl([x, y + H + 0.84, z], 0.08, 0.12, pole, { seg: 6, collide: false });
      bulbs.push([x, y + H + 0.33, z]);
    } else if (style === 'harbor') {
      b.pipe([x, y + H - 0.1, z], [x + 0.55, y + H + 0.1, z], 0.05, pole, { seg: 6 });
      b.cyl([x + 0.6, y + H + 0.05, z], 0.26, 0.22, pole, { rTop: 0.08, seg: 8, collide: false });
      bulbs.push([x + 0.6, y + H - 0.12, z]);
    } else {
      b.box([x, y + H + 0.05, z + 0.4], [0.3, 0.12, 0.9], pole, { collide: false });
      bulbs.push([x, y + H - 0.03, z + 0.55]);
    }
  }
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: o.color ?? 0xffd58a, emissiveIntensity: 0.3, roughness: 0.3 });
  kit.glow(bulbMat, 0.25, 3.2);
  const bulbGeo = new THREE.SphereGeometry(style === 'park' ? 0.2 : 0.16, 10, 8);
  const im = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbs.length);
  bulbs.forEach(([x, y, z], i) => im.setMatrixAt(i, _m.makeTranslation(x, y, z)));
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  kit.root.add(im);
  // fake light pools on the ground
  const poolMat = new THREE.MeshBasicMaterial({ map: lightPoolTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -4 });
  kit.glow(poolMat, 0, 0.55, 'opacity');
  const pg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(pg, poolMat, bulbs.length);
  list.forEach(([, y], i) => {
    const r = style === 'modern' ? 9 : 7;
    pools.setMatrixAt(i, _m.compose(_p.set(bulbs[i][0], y + 0.06, bulbs[i][2]), _q.identity(), _s.set(r, 1, r)));
  });
  pools.instanceMatrix.needsUpdate = true;
  pools.computeBoundingSphere();
  pools.renderOrder = 1;
  kit.root.add(pools);
  return im;
}

// ------------------------------------------------------------------ boats & kites

/** Swan / duck pedal boat (group, origin at waterline centre, faces +Z). */
export function swanBoat(color: number, head: 'swan' | 'duck' = 'swan'): THREE.Mesh {
  const white = color;
  const neck = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.3, 0.9), new THREE.Vector3(0, 0.75, 1.15), new THREE.Vector3(0, 1.25, 1.05), new THREE.Vector3(0, 1.45, 1.2)]),
    12,
    0.13,
    8,
  );
  const parts: Parameters<typeof bake>[0] = [
    { geo: GEO.sphere(16, 10), pos: [0, 0.05, 0], scale: [0.85, 0.42, 1.35], color: white },
    { geo: GEO.box, pos: [0, 0.35, -0.1], scale: [1.2, 0.12, 1.6], color: 0x3a8fd8 },
    { geo: GEO.box, pos: [0, 0.62, -0.45], scale: [1.1, 0.5, 0.12], color: 0x3a8fd8 },
    { geo: GEO.box, pos: [0, 0.45, -0.25], scale: [1.05, 0.1, 0.5], color: 0xfafafa },
    { geo: GEO.cyl(1, 10), pos: [0, 0.45, 0.45], rot: [0, 0, Math.PI / 2], scale: [0.25, 0.9, 0.25], color: 0x555555 },
  ];
  if (head === 'swan') {
    parts.push({ geo: neck, color: white });
    parts.push({ geo: GEO.sphere(10, 8), pos: [0, 1.48, 1.22], scale: [0.16, 0.15, 0.2], color: white });
    parts.push({ geo: GEO.cyl(0.2, 6), pos: [0, 1.45, 1.45], rot: [Math.PI / 2, 0, 0], scale: [0.07, 0.22, 0.07], color: 0xf28c1a });
    parts.push({ geo: GEO.sphere(6, 4), pos: [0.12, 1.53, 1.3], scale: 0.03, color: 0x111111 });
    parts.push({ geo: GEO.sphere(6, 4), pos: [-0.12, 1.53, 1.3], scale: 0.03, color: 0x111111 });
    parts.push({ geo: GEO.sphere(10, 8), pos: [0.55, 0.45, -0.1], rot: [0.2, 0.3, 0.6], scale: [0.14, 0.35, 0.7], color: white });
    parts.push({ geo: GEO.sphere(10, 8), pos: [-0.55, 0.45, -0.1], rot: [0.2, -0.3, -0.6], scale: [0.14, 0.35, 0.7], color: white });
  } else {
    parts.push({ geo: GEO.sphere(12, 10), pos: [0, 0.95, 1.0], scale: 0.42, color: white });
    parts.push({ geo: GEO.box, pos: [0, 0.88, 1.45], scale: [0.4, 0.1, 0.35], color: 0xf28c1a });
    parts.push({ geo: GEO.sphere(6, 4), pos: [0.2, 1.08, 1.33], scale: 0.05, color: 0x111111 });
    parts.push({ geo: GEO.sphere(6, 4), pos: [-0.2, 1.08, 1.33], scale: 0.05, color: 0x111111 });
  }
  const m = new THREE.Mesh(bake(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Diamond kite on a string. Returns the pivot group (origin = string anchor). */
export function kite(colors: [number, number], offset: V3, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const [a, c] = colors;
  const shape = new THREE.BufferGeometry();
  const w = 0.9 * scale;
  const h = 1.3 * scale;
  shape.setAttribute('position', new THREE.Float32BufferAttribute([0, h * 0.6, 0, -w / 2, 0, 0, 0, -h * 0.4, 0, 0, h * 0.6, 0, 0, -h * 0.4, 0, w / 2, 0, 0], 3));
  shape.computeVertexNormals();
  const kg = bake([
    { geo: shape, color: a },
    { geo: GEO.box, pos: [0, 0.1 * scale, 0.01], scale: [0.02, h, 0.02], color: 0x5a3a1a },
    { geo: GEO.box, pos: [0, 0, 0.01], scale: [w, 0.02, 0.02], color: 0x5a3a1a },
    ...[0, 1, 2, 3].map((i) => ({ geo: GEO.box, pos: [0, (-h * 0.4 - 0.35 - i * 0.35) * 1, 0] as V3, rot: [0, 0, 0.5] as V3, scale: [0.18 * scale, 0.08 * scale, 0.02] as V3, color: i % 2 ? a : c })),
  ]);
  const km = new THREE.Mesh(kg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }));
  km.castShadow = true;
  km.position.set(offset[0], offset[1], offset[2]);
  km.lookAt(new THREE.Vector3(0, 0, 0));
  km.rotateY(Math.PI);
  g.add(km);
  // string
  const len = Math.hypot(offset[0], offset[1], offset[2]);
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 4), new THREE.MeshBasicMaterial({ color: 0xf5f5f5 }));
  str.position.set(offset[0] / 2, offset[1] / 2, offset[2] / 2);
  str.quaternion.setFromUnitVectors(Y, new THREE.Vector3(offset[0], offset[1], offset[2]).normalize());
  g.add(str);
  return g;
}
