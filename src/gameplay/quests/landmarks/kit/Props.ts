import * as THREE from 'three';
import type { World } from '../../../../world/World';
import { bannerTexture, canvasTexture, drawRaccoon, fitText, roundRect, SIGN_FONT } from './text';

/** Procedural props + fallback set pieces for the landmark events. */

const cache = new Map<string, any>();
function once<T>(key: string, make: () => T): T {
  let v = cache.get(key);
  if (v === undefined) cache.set(key, (v = make()));
  return v as T;
}

export function stdMat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return once(`mat|${color}|${JSON.stringify(opts)}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...opts }));
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

/** World position of a local offset (lx, ly, lz) in a frame at `origin` rotated by `yaw`. */
export function local(origin: THREE.Vector3, yaw: number, lx: number, ly: number, lz: number, out = new THREE.Vector3()) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return out.set(origin.x + lx * c + lz * s, origin.y + ly, origin.z - lx * s + lz * c);
}

// ------------------------------------------------------------------ small props

/** Mortarboard (graduation cap). */
export function gradCap(): THREE.Group {
  const g = new THREE.Group();
  const black = stdMat(0x1b1b22, { roughness: 0.6 });
  const board = mesh(once('capBoard', () => new THREE.BoxGeometry(0.34, 0.025, 0.34)), black, 0, 0.05, 0);
  board.rotation.y = Math.PI / 4;
  g.add(board);
  g.add(mesh(once('capSkull', () => new THREE.CylinderGeometry(0.12, 0.13, 0.08, 12)), black, 0, 0, 0));
  g.add(mesh(once('capTassel', () => new THREE.CylinderGeometry(0.01, 0.01, 0.14, 5)), stdMat(0xf2c14e, { roughness: 0.5 }), 0.14, 0.0, 0.03));
  return g;
}

/** Rolled-up diploma with a ribbon (fallback when the items system has no 'diploma'). */
export function diplomaObject(): THREE.Group {
  const g = new THREE.Group();
  const paper = mesh(once('dipPaper', () => new THREE.CylinderGeometry(0.05, 0.05, 0.36, 14).rotateZ(Math.PI / 2)), stdMat(0xf6efdc, { roughness: 0.9 }));
  paper.name = 'paper';
  g.add(paper);
  const ribbon = mesh(once('dipRibbon', () => new THREE.CylinderGeometry(0.056, 0.056, 0.05, 14).rotateZ(Math.PI / 2)), stdMat(0x7a2ab0, { roughness: 0.5 }));
  g.add(ribbon);
  const seal = mesh(once('dipSeal', () => new THREE.CylinderGeometry(0.03, 0.03, 0.012, 12).rotateX(Math.PI / 2)), stdMat(0xf2c14e, { roughness: 0.3, metalness: 0.7 }), 0, 0, 0.058);
  g.add(seal);
  return g;
}

/** Make a diploma object look soggy (drooped, darker, see-through-ish). */
export function soggify(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const me = o as THREE.Mesh;
    if (!me.isMesh || me.userData.soggy) return;
    me.userData.soggy = true;
    const mat = (me.material as THREE.MeshStandardMaterial).clone();
    mat.color.multiplyScalar(0.78).lerp(new THREE.Color(0x9fb4c0), 0.25);
    mat.roughness = 0.35;
    me.material = mat;
  });
  obj.scale.y *= 0.72;
  obj.rotation.z += 0.18;
}

/** Salmon-ish fish (fallback 'fish' item). Long axis = Z. */
export function fishObject(): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(once('fishBody', () => new THREE.SphereGeometry(1, 16, 10).scale(0.09, 0.11, 0.3)), stdMat(0xc9785f, { roughness: 0.35, metalness: 0.25 }));
  g.add(body);
  const belly = mesh(once('fishBelly', () => new THREE.SphereGeometry(1, 12, 8).scale(0.075, 0.07, 0.25)), stdMat(0xeee2d6, { roughness: 0.4 }), 0, -0.045, 0.01);
  g.add(belly);
  const tail = mesh(once('fishTail', () => new THREE.ConeGeometry(0.1, 0.14, 4).scale(0.25, 1, 1).rotateX(-Math.PI / 2)), stdMat(0x9c4f45, { roughness: 0.5 }), 0, 0, -0.33);
  g.add(tail);
  const eyeM = stdMat(0x111111, { roughness: 0.2 });
  for (const x of [0.07, -0.07]) g.add(mesh(once('fishEye', () => new THREE.SphereGeometry(0.018, 8, 6)), eyeM, x, 0.03, 0.22));
  return g;
}

let cardFront: THREE.CanvasTexture | null = null;
/** Front art of the gold-bordered Jimothy rookie card. */
export function rookieCardTexture() {
  if (cardFront) return cardFront;
  cardFront = canvasTexture(256, 360, (ctx, w, h) => {
    // gold border
    const gold = ctx.createLinearGradient(0, 0, w, h);
    gold.addColorStop(0, '#fff3b0');
    gold.addColorStop(0.35, '#e0a82e');
    gold.addColorStop(0.65, '#ffe27a');
    gold.addColorStop(1, '#b67b12');
    ctx.fillStyle = gold;
    roundRect(ctx, 0, 0, w, h, 18);
    ctx.fill();
    // photo
    const sky = ctx.createLinearGradient(0, 30, 0, 250);
    sky.addColorStop(0, '#6fb7ff');
    sky.addColorStop(1, '#bfe3ff');
    ctx.fillStyle = sky;
    roundRect(ctx, 18, 18, w - 36, 250, 10);
    ctx.fill();
    // ballpark grass
    ctx.fillStyle = '#3f9c4a';
    ctx.fillRect(18, 200, w - 36, 68);
    drawRaccoon(ctx, w / 2, 150, 62);
    // tiny baseball cap
    ctx.fillStyle = '#0c2c56';
    ctx.beginPath();
    ctx.ellipse(w / 2, 98, 44, 20, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(w / 2 - 4, 96, 58, 8);
    // nameplate
    ctx.fillStyle = '#0c2c56';
    roundRect(ctx, 18, 276, w - 36, 66, 10);
    ctx.fill();
    fitText(ctx, 'JIMOTHY', w / 2, 298, w - 60, 30, { color: '#ffe27a' });
    fitText(ctx, 'ROOKIE · BALLARD BARNACLES · 2026', w / 2, 326, w - 60, 13, { color: '#fff', weight: '800' });
    // RC logo
    ctx.fillStyle = '#e8412c';
    ctx.beginPath();
    ctx.arc(w - 44, 44, 22, 0, Math.PI * 2);
    ctx.fill();
    fitText(ctx, 'RC', w - 44, 45, 30, 20, { color: '#fff' });
  });
  return cardFront;
}

/** A graded gold rookie card in a hard plastic slab (fallback 'rookiecard' item). Lies flat, art on +Y. */
export function rookieCardObject(): THREE.Group {
  const g = new THREE.Group();
  const edge = stdMat(0xd9e6ee, { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75 });
  const front = once('cardFrontMat', () => new THREE.MeshStandardMaterial({ map: rookieCardTexture(), roughness: 0.25, metalness: 0.35, emissive: new THREE.Color(0x4a3200), emissiveIntensity: 0.25 }));
  const back = stdMat(0xc98f1c, { roughness: 0.3, metalness: 0.6 });
  const card = mesh(once('cardGeo', () => new THREE.BoxGeometry(0.2, 0.03, 0.28)), [edge, edge, front, back, edge, edge]);
  g.add(card);
  return g;
}

/** Additive glow billboard (for the rookie card / points of interest). */
export function glowSprite(color = 0xffd84a, size = 0.8): THREE.Sprite {
  const tex = once('glowTex', () =>
    canvasTexture(64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }),
  );
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
  sp.scale.setScalar(size);
  return sp;
}

/** Flat pulsing ring used to mark where a thrown fish will land. */
export function landingRing(): THREE.Mesh {
  const m = new THREE.Mesh(
    once('ringGeo', () => new THREE.RingGeometry(0.42, 0.62, 28).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.renderOrder = 2;
  return m;
}

/** A sign board with a texture on its front (+Z) face. */
export function signBoard(w: number, h: number, tex: THREE.Texture, frameColor = 0x2a2320) {
  const g = new THREE.Group();
  const frame = stdMat(frameColor, { roughness: 0.6 });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const board = mesh(new THREE.BoxGeometry(w, h, 0.08), [frame, frame, frame, frame, face, frame]);
  g.add(board);
  return g;
}

/** Update a sign's front texture (e.g. "PROCLAMATION TODAY" → "JIMOTHY SUMMER!"). */
export function setSignTexture(sign: THREE.Object3D, tex: THREE.Texture) {
  sign.traverse((o) => {
    const me = o as THREE.Mesh;
    if (me.isMesh && Array.isArray(me.material) && me.material[4]) {
      const face = me.material[4] as THREE.MeshStandardMaterial;
      face.map?.dispose();
      face.map = tex;
      face.needsUpdate = true;
    }
  });
}

/** Race arch: two posts + banner, plus a checkered line on the ground. Origin = ground center, faces +Z. */
export function raceArch(world: World, origin: THREE.Vector3, yaw: number, title: string, width = 7) {
  const g = new THREE.Group();
  const postM = stdMat(0xe6e6e6, { roughness: 0.5, metalness: 0.3 });
  for (const s of [-1, 1]) {
    const post = mesh(once('archPost', () => new THREE.CylinderGeometry(0.1, 0.12, 3.6, 10)), postM, (s * width) / 2, 1.8, 0);
    g.add(post);
  }
  const tex = bannerTexture(title, 'JIMOTHY NIGHT · TEE-HEE PARK', { bg: '#ff8a65', bg2: '#e0533d', fg: '#fff', border: '#fff' }, 1024, 200);
  const banner = signBoard(width + 0.4, 0.95, tex, 0xffffff);
  banner.position.set(0, 3.3, 0);
  g.add(banner);
  const back = banner.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.09;
  g.add(back);
  const checker = once('checkerTex', () =>
    canvasTexture(256, 32, (ctx, w, h) => {
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
          ctx.fillRect(i * 16, j * 16, 16, 16);
        }
    }),
  );
  const line = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.position.y = 0.03;
  line.receiveShadow = true;
  g.add(line);
  g.position.copy(origin);
  g.rotation.y = yaw;
  world.addStatic(g, { collider: 'none' });
  // colliders for the posts only
  for (const s of [-1, 1]) world.collider(local(origin, yaw, (s * width) / 2, 1.8, 0), new THREE.Vector3(0.24, 3.6, 0.24), yaw);
  return g;
}

/** Traffic cone (visual only) to outline the fallback race track. */
export function cone(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(once('coneGeo', () => new THREE.ConeGeometry(0.16, 0.5, 10)), stdMat(0xff6a1a, { roughness: 0.6 }), 0, 0.27, 0));
  g.add(mesh(once('coneBase', () => new THREE.BoxGeometry(0.36, 0.04, 0.36)), stdMat(0xff6a1a, { roughness: 0.6 }), 0, 0.02, 0));
  return g;
}

// ------------------------------------------------------------------ fallback set pieces

/**
 * Static ramp from `a` (bottom, ground) to `b` (top) — Jimothy is a ball, stairs are his nemesis.
 * width across, thickness of the slab. Mesh + tilted box collider.
 */
export function ramp(world: World, a: THREE.Vector3, b: THREE.Vector3, width: number, material: THREE.Material, thickness = 0.3) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dy = b.y - a.y;
  const run = Math.hypot(dx, dz);
  const len = Math.hypot(run, dy);
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(dy, run);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  // slab top surface passes through a and b: shift the centre down by half the thickness along the slab normal
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const c = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5).addScaledVector(n, -thickness / 2);
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, len), material);
  m.position.copy(c);
  m.quaternion.copy(q);
  m.castShadow = m.receiveShadow = true;
  world.addStatic(m, { collider: 'none' });
  world.game.physics.staticBox(c, new THREE.Vector3(width / 2, thickness / 2, len / 2), q);
  return m;
}

/**
 * University of Washing commencement stage. origin = ground point at the stage center; faces +Z (audience).
 * Returns the stage-top center (where Jimothy stands) and the dean's spot behind the lectern.
 */
export function buildGradStage(world: World, origin: THREE.Vector3, yaw: number) {
  const H = 1.0;
  const wood = stdMat(0x6b4a8f, { roughness: 0.7 });
  const trim = stdMat(0xf2c14e, { roughness: 0.5, metalness: 0.2 });
  world.box(local(origin, yaw, 0, H / 2, 0), new THREE.Vector3(9, H, 5), wood, { rotY: yaw });
  world.box(local(origin, yaw, 0, H + 0.02, 2.45), new THREE.Vector3(9, 0.05, 0.1), trim, { rotY: yaw, collide: false });
  // carpeted ramp up the front (a ball can't do stairs)
  ramp(world, local(origin, yaw, 0, 0.0, 7.0), local(origin, yaw, 0, H, 2.45), 3.2, stdMat(0x8a6aad, { roughness: 0.95 }));
  // lectern
  world.box(local(origin, yaw, 0, H + 0.58, -1.1), new THREE.Vector3(0.9, 1.15, 0.55), stdMat(0x4a2f6b), { rotY: yaw });
  // backdrop
  const tex = bannerTexture('UNIVERSITY OF WASHING', 'COMMENCEMENT · CLASS OF 2026 · "MAY YOUR FUTURE BE SPOTLESS"', { bg: '#4b2e83', bg2: '#35205e', fg: '#f2c14e', border: '#f2c14e' });
  const back = signBoard(8.6, 2.2, tex, 0x35205e);
  back.position.copy(local(origin, yaw, 0, H + 2.4, -2.35));
  back.rotation.y = yaw;
  world.addStatic(back, { collider: 'none' });
  for (const s of [-1, 1]) {
    world.box(local(origin, yaw, s * 4.2, H + 1.6, -2.35), new THREE.Vector3(0.18, 3.2, 0.18), trim, { rotY: yaw });
  }
  return {
    top: local(origin, yaw, 0, H, 0.6),
    dean: local(origin, yaw, 0, H, -1.75),
    audience: local(origin, yaw, 0, 0, 10),
  };
}

/**
 * City Hall proclamation podium (3 tiers + lectern + backdrop). origin = ground center; faces +Z.
 * Returns the podium top (Jimothy's spot), the mayor's spot and the backdrop sign (for re-texturing).
 */
export function buildPodium(world: World, origin: THREE.Vector3, yaw: number) {
  const stone = stdMat(0xd8d2c4, { roughness: 0.85 });
  const tiers: [number, number, number][] = [
    [9, 0.3, 6],
    [7, 0.6, 4.6],
    [5.2, 0.9, 3.4],
  ];
  for (const [w, h, d] of tiers) world.box(local(origin, yaw, 0, h / 2, -(6 - d) / 2), new THREE.Vector3(w, h, d), stone, { rotY: yaw });
  const top = 0.9;
  // red carpet across the top and down a ramp at the front (stairs are hard when you're a sphere)
  const carpet = stdMat(0xb3262b, { roughness: 0.95 });
  world.box(local(origin, yaw, 0, top + 0.015, -1.3), new THREE.Vector3(1.6, 0.03, 3.2), carpet, { rotY: yaw, collide: false });
  ramp(world, local(origin, yaw, 0, 0.0, 5.4), local(origin, yaw, 0, top, 0.3), 2.2, carpet);
  // lectern with the city seal
  world.box(local(origin, yaw, 0, top + 0.6, -2.4), new THREE.Vector3(1.0, 1.2, 0.6), stdMat(0x5b3a22, { roughness: 0.6 }), { rotY: yaw });
  const seal = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1f3d7a';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 10;
    ctx.stroke();
    drawRaccoon(ctx, w / 2, h / 2 + 10, 58);
    fitText(ctx, 'CITY OF BALLARD-ISH', w / 2, 40, 200, 22, { color: '#f2c14e' });
  });
  const sealSign = signBoard(0.7, 0.7, seal, 0x5b3a22);
  sealSign.position.copy(local(origin, yaw, 0, top + 0.72, -2.08));
  sealSign.rotation.y = yaw;
  world.addStatic(sealSign, { collider: 'none' });
  // backdrop on posts
  const tex = bannerTexture('PROCLAMATION TODAY', 'CITY HALL · BALLARD-ISH · PLEASE DO NOT FEED THE HONOREE', { bg: '#1f3d7a', bg2: '#132a57', fg: '#fff', border: '#f2c14e', sub: '#f2c14e' });
  const back = signBoard(7.5, 1.9, tex, 0x132a57);
  back.position.copy(local(origin, yaw, 0, top + 2.6, -3.6));
  back.rotation.y = yaw;
  world.addStatic(back, { collider: 'none' });
  for (const s of [-1, 1]) world.box(local(origin, yaw, s * 3.7, top + 1.8, -3.6), new THREE.Vector3(0.16, 3.6, 0.16), stdMat(0xf2c14e, { metalness: 0.4, roughness: 0.4 }), { rotY: yaw });
  return {
    top: local(origin, yaw, 0, top, -0.6),
    mayor: local(origin, yaw, 0, top, -3.0),
    audience: local(origin, yaw, 0, 0, 10.5),
    backdrop: back,
  };
}

/** Summer backdrop textures. */
export function summerBackdrop(declared: boolean) {
  return declared
    ? bannerTexture('JIMOTHY SUMMER!', 'BY ORDER OF THE MAYOR · SUNGLASSES MANDATORY', { bg: '#ffb627', bg2: '#ff7b2e', fg: '#fff', border: '#fff', sub: '#3a2200' })
    : bannerTexture('PROCLAMATION TODAY', 'CITY HALL · BALLARD-ISH · PLEASE DO NOT FEED THE HONOREE', { bg: '#1f3d7a', bg2: '#132a57', fg: '#fff', border: '#f2c14e', sub: '#f2c14e' });
}

/** Pike's Plaice fish stall. origin = ground center of the counter; customers stand at +Z. */
export function buildFishStall(world: World, origin: THREE.Vector3, yaw: number) {
  world.box(local(origin, yaw, 0, 0.5, 0), new THREE.Vector3(3.4, 1.0, 1.1), stdMat(0x6b7b86, { roughness: 0.5, metalness: 0.3 }), { rotY: yaw });
  world.box(local(origin, yaw, 0, 1.05, 0), new THREE.Vector3(3.2, 0.1, 0.95), stdMat(0xe8f4fb, { roughness: 0.25 }), { rotY: yaw, collide: false });
  // fish on ice (visual)
  for (let i = 0; i < 5; i++) {
    const f = fishObject();
    f.position.copy(local(origin, yaw, -1.2 + i * 0.6, 1.16, (i % 2 ? 0.15 : -0.15)));
    f.rotation.set(0, yaw + Math.PI / 2 + (i % 2 ? 0.2 : -0.2), Math.PI / 2);
    world.addStatic(f, { collider: 'none' });
  }
  // awning
  const stripes = canvasTexture(256, 64, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : '#d8453d';
      ctx.fillRect(i * 32, 0, 32, h);
    }
  });
  const awn = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.08, 2.2), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8 }));
  awn.position.copy(local(origin, yaw, 0, 2.75, -0.2));
  awn.rotation.set(0, yaw, 0);
  awn.rotateX(0.18);
  world.addStatic(awn, { collider: 'none' });
  for (const s of [-1, 1])
    for (const z of [-1.1, 0.7]) world.box(local(origin, yaw, s * 1.9, 1.35, z), new THREE.Vector3(0.1, 2.7, 0.1), stdMat(0x3a3a3a), { rotY: yaw });
  const sign = signBoard(3.4, 0.6, bannerTexture("PIKE'S PLAICE MARKET", 'FISH FLY HERE · CATCH ONE, KEEP ONE', { bg: '#1c5d8a', fg: '#fff', border: '#fff', sub: '#ffd84a' }, 1024, 180), 0x123f5e);
  sign.position.copy(local(origin, yaw, 0, 3.25, 0.85));
  sign.rotation.y = yaw;
  world.addStatic(sign, { collider: 'none' });
  return {
    monger: local(origin, yaw, 0, 0, -1.05),
    catchSpot: local(origin, yaw, 0, 0, 5),
  };
}

/** Little dugout with a bench (the gold card hides under it). origin = ground center; open side +Z. */
export function buildDugout(world: World, origin: THREE.Vector3, yaw: number) {
  const wall = stdMat(0x0c2c56, { roughness: 0.7 });
  world.box(local(origin, yaw, 0, 1.1, -1.0), new THREE.Vector3(6, 2.2, 0.2), wall, { rotY: yaw });
  for (const s of [-1, 1]) world.box(local(origin, yaw, s * 3, 1.1, 0), new THREE.Vector3(0.2, 2.2, 2.2), wall, { rotY: yaw });
  world.box(local(origin, yaw, 0, 2.28, 0), new THREE.Vector3(6.4, 0.16, 2.4), stdMat(0x1f7a54), { rotY: yaw });
  world.box(local(origin, yaw, 0, 0.45, -0.6), new THREE.Vector3(5.2, 0.08, 0.5), stdMat(0x9a6b3e), { rotY: yaw });
  for (const x of [-2.3, 0, 2.3]) world.box(local(origin, yaw, x, 0.21, -0.6), new THREE.Vector3(0.1, 0.42, 0.4), stdMat(0x3a3a3a), { rotY: yaw });
  const sign = signBoard(2.6, 0.5, bannerTexture('BARNACLES DUGOUT', 'NO RACCOONS (EXCEPT ONE)', { bg: '#0c2c56', fg: '#fff', border: '#1f7a54', sub: '#9ee6c2' }, 1024, 200), 0x0c2c56);
  sign.position.copy(local(origin, yaw, 0, 1.75, -0.88));
  sign.rotation.y = yaw;
  world.addStatic(sign, { collider: 'none' });
  return { card: local(origin, yaw, 0.6, 0.02, -0.6) };
}

/** Big stadium-style scoreboard showing a canvas (race standings). Returns a redraw function. */
export function scoreboard(world: World, origin: THREE.Vector3, yaw: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.6 });
  const frame = stdMat(0x1b1b22);
  const board = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.2, 0.25), [frame, frame, frame, frame, face, frame]);
  board.position.copy(local(origin, yaw, 0, 5.2, 0));
  board.rotation.y = yaw;
  board.castShadow = true;
  world.addStatic(board, { collider: 'none' });
  for (const s of [-1, 1]) world.box(local(origin, yaw, s * 2.6, 1.8, -0.05), new THREE.Vector3(0.25, 3.6, 0.25), frame, { rotY: yaw });
  const ctx = canvas.getContext('2d')!;
  const draw = (title: string, rows: string[], highlight = -1) => {
    ctx.fillStyle = '#0b0f18';
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#ff8a65';
    ctx.fillRect(0, 0, 512, 54);
    fitText(ctx, title, 256, 28, 490, 34, { color: '#fff' });
    rows.slice(0, 4).forEach((r, i) => {
      fitText(ctx, r, 24, 82 + i * 46, 470, 30, { color: i === highlight ? '#ffd84a' : '#e6f0ff', align: 'left', font: SIGN_FONT });
    });
    tex.needsUpdate = true;
  };
  draw('JIMOTHY NIGHT', ['SALMON RUN TONIGHT!', 'STEP UP TO THE START LINE', '', 'GO BARNACLES!']);
  return draw;
}
