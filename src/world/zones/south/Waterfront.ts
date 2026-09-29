import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World, ZoneBuilder } from '../../World';
import type { WaterSystem } from '../../Water';
import { MAP } from '../../terrain';
import { getKit, Batch, tree, bush, bench, rng, canvasTex, fitText, roundRect, FONT_TITLE, FONT_ROUND, FONT_BODY, GEO, type Kit, type V3 } from './kit';
import { lamps, BIRD, perched, flock } from './decor';
import { seawall } from './Locks';
import * as P from './props';

/**
 * S zone — Waterfront + "Pike's Plaice Market": the market arcade with its big neon sign, fish stall with
 * ice beds (the fish-thrower spot), fruit & flower stalls, the Gum Wall in Post Alley (sticky! see SouthSystem),
 * a bronze Jimothy piggy-bank, the waterfront park with kiosks and The Pretty Good Wheel, a plank boardwalk,
 * piers, a marina, a floating dock (with a lost kit hiding under the boardwalk) and the ferry M/V Round Boy.
 */

const AREA = 'Waterfront';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DECK = 0.35;
const BAY_Y = MAP.bayY;
const SEABED = MAP.seabedY;
const WOOD = 0xe0c9a6; // plank tint (texture is lifted in the kit)
const PILE = 0x5a4632;

const M = { x0: -24, x1: 24, z0: 78, z1: 96 }; // market hall
const GUM_X = -30; // gum wall face (faces +x)

export const WaterfrontZone: ZoneBuilder = {
  name: AREA,
  async build(game: Game, world: World) {
    const kit = await getKit(game, world);
    const b = new Batch(kit, 'waterfront');
    const water = game.get<WaterSystem>('water')!;
    world.areas.push({ name: AREA, min: new THREE.Vector2(-54, 66), max: new THREE.Vector2(54, 225) });
    // market + alley get their own names for the HUD
    world.areas.unshift({ name: "Pike's Plaice Market", min: new THREE.Vector2(-47, 66), max: new THREE.Vector2(25, 99) });

    marketHall(kit, b);
    fishStall(kit, b, water);
    fruitStall(kit, b);
    flowerStall(kit, b);
    frontPlaza(kit, b);
    gumWall(kit, b);
    park(kit, b);
    prettyGoodWheel(kit, b);
    boardwalk(kit, b);
    piers(kit, b);
    ferry(kit, b);
    await boats(kit);

    world.poi.set('market', V(0, 0.1, 80));
    world.poi.set('waterfront', V(0, DECK + 0.1, 163));
    world.npcSpawns.push(
      // (spawn points must have open sky above: the NPC spawner raycasts down and would land on the arcade roof)
      { zone: AREA, center: V(0, 0, 84), radius: 7, count: 8, types: ['tourist', 'tourist', 'pedestrian'], path: [V(-20, 0, 76.4), V(-8, 0, 76.4), V(8, 0, 76.4), V(20, 0, 76.4)] },
      { zone: AREA, center: V(15.2, 0, 74.4), radius: 1.2, count: 1, types: ['fishmonger'] },
      { zone: AREA, center: V(-28.7, 0, 103), radius: 0.8, count: 1, types: ['fishmonger'] },
      { zone: AREA, center: V(0, 0, 71), radius: 8, count: 5, types: ['tourist', 'pedestrian'] },
      { zone: AREA, center: V(-27, 0, 88), radius: 2.5, count: 2, types: ['tourist'] },
      { zone: AREA, center: V(0, DECK, 163), radius: 10, count: 6, types: ['tourist', 'pedestrian', 'jogger'], path: [V(-50, DECK, 163.5), V(50, DECK, 163.5)] },
      { zone: AREA, center: V(-18, 0, 125), radius: 11, count: 4, types: ['family', 'pedestrian', 'tourist'] },
    );
    kit.state.ambience.push(
      { pos: V(0, 3, 170), key: 'seagull', radius: 50, every: 6, next: 2, volume: 0.6 },
      { pos: V(0, 2, 88), key: 'crowd_laugh', radius: 22, every: 17, next: 8, volume: 0.25 },
    );
    b.flush();
  },
};

// ------------------------------------------------------------------ helpers

/** Vertical prism along X from a convex polygon in the (z, y) plane. */
function prismX(b: Batch, poly: [number, number][], x0: number, x1: number, color: number, mat: 'brick' | 'flat' | 'concrete' = 'flat') {
  const pos: number[] = [];
  const n = poly.length;
  for (let i = 1; i < n - 1; i++) {
    const t = [poly[0], poly[i], poly[i + 1]];
    for (const [z, y] of t) pos.push(x0, y, z);
    for (const [z, y] of [t[0], t[2], t[1]]) pos.push(x1, y, z);
  }
  for (let i = 0; i < n; i++) {
    const [za, ya] = poly[i];
    const [zc, yc] = poly[(i + 1) % n];
    pos.push(x0, ya, za, x1, yc, zc, x1, ya, za, x0, ya, za, x0, yc, zc, x1, yc, zc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add(g, new THREE.Matrix4(), color, { mat });
}

function awningTex(c1: string, c2: string) {
  return canvasTex(256, 64, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? c2 : c1;
      ctx.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, h - 8, w, 8);
  });
}

// ------------------------------------------------------------------ market hall

function marketHall(kit: Kit, b: Batch) {
  const { x0, x1, z0, z1 } = M;
  const green = 0x1f4d3a;
  const cream = 0xf3e7cf;
  // floor
  b.decal([0, 0.02, (z0 + z1) / 2], [x1 - x0, z1 - z0], 0xf0dcc0, { mat: 'paving' });
  // back wall with two doorways (between the stalls)
  const H = 5.2;
  const wall = (a: number, c: number) => b.box([(a + c) / 2, H / 2, z1 - 0.25], [c - a, H, 0.5], 0xffffff, { mat: 'brick' });
  wall(x0, -9);
  wall(-7, 7);
  wall(9, x1);
  for (const [a, c] of [
    [-9, -7],
    [7, 9],
  ])
    b.box([(a + c) / 2, (2.7 + H) / 2, z1 - 0.25], [c - a, H - 2.7, 0.5], 0xffffff, { mat: 'brick' });
  // side walls (back half)
  for (const x of [x0 + 0.25, x1 - 0.25]) b.box([x, H / 2, (88 + z1) / 2], [0.5, H, z1 - 88], 0xffffff, { mat: 'brick' });
  // cast-iron columns along the open front + a mid row
  for (const x of [-24, -18, -12, -6, 6, 12, 18, 24]) {
    b.cyl([x, (H - 0.3) / 2, z0 + 0.4], 0.22, H - 0.3, green, { seg: 10, collide: true, mat: 'metal' });
    b.box([x, H - 0.25, z0 + 0.4], [0.7, 0.3, 0.7], green, { collide: false, mat: 'metal' });
    b.box([x, 0.15, z0 + 0.4], [0.6, 0.3, 0.6], green, { collide: false, mat: 'metal' });
  }
  // fascia + ridge roof (walkable)
  b.box([0, H + 0.3, z0 + 0.3], [x1 - x0 + 1, 0.9, 0.3], cream, { mat: 'concrete' });
  b.box([0, H - 0.05, (z0 + z1) / 2], [x1 - x0, 0.2, z1 - z0], 0xd9c7a6, { collide: false, shadow: false });
  const ridgeY = 8.2;
  const ridgeZ = (z0 + z1) / 2;
  b.ramp([0, H + 0.75, z0 - 0.6], [0, ridgeY, ridgeZ], x1 - x0 + 1.4, 0x2f6b52, { mat: 'metal', thick: 0.3 });
  b.ramp([0, ridgeY, ridgeZ], [0, H + 0.75, z1 + 0.6], x1 - x0 + 1.4, 0x2f6b52, { mat: 'metal', thick: 0.3 });
  b.box([0, ridgeY + 0.05, ridgeZ], [x1 - x0 + 1.4, 0.25, 0.5], 0x1f4d3a, { mat: 'metal', collide: false });
  // gable ends
  for (const [a, c] of [
    [x0 - 0.4, x0 + 0.1],
    [x1 - 0.1, x1 + 0.4],
  ])
    prismX(
      b,
      [
        [z0, H + 0.6],
        [ridgeZ, ridgeY - 0.1],
        [z1, H + 0.6],
      ],
      a,
      c,
      0xffffff,
      'brick',
    );
  // pendant lights along the arcade
  const lampMat = kit.glowMat(0xffe2a8, 0.5, 3.2, 0xfff4dc);
  const pend = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 12, 8), lampMat, 7);
  for (let i = 0; i < 7; i++) {
    const x = -18 + i * 6;
    b.cyl([x, H - 0.55, 86], 0.02, 1.1, 0x222222, { seg: 4, collide: false, shadow: false });
    b.cyl([x, H - 1.1, 86], 0.34, 0.25, green, { rTop: 0.1, seg: 10, collide: false, mat: 'metal' });
    pend.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, H - 1.28, 86));
  }
  pend.instanceMatrix.needsUpdate = true;
  pend.computeBoundingSphere();
  kit.root.add(pend);

  // THE big neon sign (faces north toward town) + clock
  const neon = canvasTex(2048, 420, (ctx, w, h) => {
    ctx.fillStyle = '#0f1424';
    roundRect(ctx, 4, 4, w - 8, h - 8, 36);
    ctx.fill();
    ctx.strokeStyle = '#f4ead2';
    ctx.lineWidth = 10;
    roundRect(ctx, 22, 22, w - 44, h - 44, 26);
    ctx.stroke();
    const neonText = (t: string, y: number, px: number, col: string, glow: string) => {
      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 38;
      fitText(ctx, t, w / 2, y, w * 0.9, px, FONT_TITLE, { fill: col });
      ctx.shadowBlur = 14;
      fitText(ctx, t, w / 2, y, w * 0.9, px, FONT_TITLE, { fill: col });
      ctx.restore();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `${px}px ${FONT_TITLE}`;
    };
    neonText("PIKE'S PLAICE MARKET", h * 0.4, 205, '#ff4a36', '#ff1d0a');
    neonText('FRESH FISH · FLYING DAILY', h * 0.79, 92, '#63f3ff', '#00c8ff');
  });
  const SW = 17;
  const SH = 3.5;
  const sy = 10.6;
  const sz = z0 + 0.9;
  for (const x of [-7.5, 7.5]) b.box([x, (H + sy) / 2, sz + 0.25], [0.3, sy - H, 0.3], 0x2a2f38, { mat: 'metal' });
  kit.sign(b, { pos: [0, sy, sz], rotY: Math.PI, w: SW, h: SH, tex: neon, frame: 0x2a2f38, depth: 0.3, border: 0.15, emissive: [0.85, 2.8], back: false });
  // clock
  const clock = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#0f1424';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = '#ff1d0a';
    ctx.shadowBlur = 24;
    ctx.strokeStyle = '#ff4a36';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#f4ead2';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * 180, h / 2 + Math.sin(a) * 180, i % 3 ? 7 : 13, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#f4ead2';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 - 70, h / 2 - 90);
    ctx.stroke();
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + 110, h / 2 - 110);
    ctx.stroke();
    fitText(ctx, 'JIMOTHY TIME', w / 2, h * 0.7, w * 0.5, 40, FONT_TITLE, { fill: '#63f3ff', glow: '#00c8ff' });
  });
  b.box([-10.6, (H + 9.3) / 2, sz + 0.25], [0.25, 9.3 - H, 0.25], 0x2a2f38, { mat: 'metal' });
  kit.sign(b, { pos: [-10.6, 9.3, sz], rotY: Math.PI, w: 2.6, h: 2.6, tex: clock, depth: 0.25, emissive: [0.7, 2.4], back: false, collide: false });
  kit.world.poi.set('bobblehead:s8', V(4.5, sy + SH / 2 + 0.35, sz));
  kit.world.poi.set('marketSign', V(0, sy, sz));
}

// ------------------------------------------------------------------ fish stall

function iceTexture() {
  const r = rng(77);
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#eaf6fb';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const x = r() * w;
      const y = r() * h;
      const s = 3 + r() * 10;
      ctx.fillStyle = `rgba(${170 + r() * 60},${210 + r() * 40},255,${0.25 + r() * 0.4})`;
      ctx.fillRect(x, y, s, s * (0.6 + r()));
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(x, y, s * 0.4, 2);
    }
  }, true);
}

function fishStall(kit: Kit, b: Batch, water: WaterSystem) {
  const game = kit.game;
  // counter with white tiles and a blue trim
  b.box([0, 0.47, 91.9], [13.6, 0.94, 1.4], 0xf4f7f8, { mat: 'concrete' });
  b.box([0, 0.9, 91.18], [13.7, 0.12, 0.06], 0x2f7fc1, { collide: false, mat: 'glossy' });
  // sloped ice bed (tilted toward the customers)
  const iceMat = new THREE.MeshStandardMaterial({ map: iceTexture(), roughness: 0.25, metalness: 0.05 });
  const ice = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.2, 2.4), iceMat);
  const slope = 0.2; // front (customer side, -z) lower than the back
  ice.position.set(0, 1.12, 92);
  ice.rotation.x = -slope;
  ice.receiveShadow = true;
  kit.root.add(ice);
  kit.colliderQ([0, 1.12, 92], [13.4, 0.2, 2.4], new THREE.Quaternion().setFromEuler(new THREE.Euler(-slope, 0, 0)));
  const iceY = (z: number) => 1.12 + 0.1 / Math.cos(slope) + (z - 92) * Math.tan(slope);
  // static fish lying on their sides on the ice (vertex-coloured, baked into the batch)
  const kinds: P.FishKind[] = ['salmon', 'cod', 'snapper'];
  const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -slope);
  const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const qYaw = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 13; i++) {
      const kind = kinds[(row + i) % 3];
      const x = -6.1 + i * 1.02 + (row % 2) * 0.3;
      const zz = 91.25 + row * 0.7;
      qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 + (i % 2 ? 0.18 : -0.12));
      const q = qTilt.clone().multiply(qYaw).multiply(qRoll);
      m.compose(new THREE.Vector3(x, iceY(zz) + 0.1, zz), q, new THREE.Vector3(1.05, 1.05, 1.05));
      b.add(P.fishGeometry(kind), m, 0xffffff, { keepColors: true, mat: 'glossy' });
    }
  }
  // lemons & parsley garnish
  for (let i = 0; i < 12; i++) b.sphere([-6 + i * 1.1, iceY(91.0) + 0.05, 90.98], [0.06, 0.05, 0.06], i % 3 ? 0xffe04a : 0x3aa84a, { w: 8, h: 6, shadow: false });
  // a flat steel ledge in front of the ice with a few real (grabbable) fish + crabs on it
  b.box([0, 0.955, 90.85], [13.6, 0.05, 0.75], 0xc9d1d5, { mat: 'metal' });
  for (let i = 0; i < 7; i++) P.fish(game, -5.4 + i * 1.8, 0.985, 90.85, Math.PI / 2 + (i % 2 ? 0.08 : -0.08), kinds[i % 3]);
  P.crab(game, -1.3, 0.985, 90.8, 0.3);
  P.crab(game, 2.7, 0.985, 90.85, -0.4);
  P.crab(game, 6.3, 0.985, 90.8, 1.2);
  // price cards
  const cards = ['WILD KING $24.99', 'COHO $18.99', 'DUNGENESS $12/lb', 'COD $9.99', 'SNAPPER $14.99'];
  cards.forEach((t, i) => {
    const tex = kit.textSign([{ text: t, px: 34, color: '#1b1d24', font: FONT_ROUND }], { w: 0.7, h: 0.3, bg: '#fffdf3', border: '#d64b3a', pxPerM: 220 });
    kit.sign(b, { pos: [-5 + i * 2.5, 1.45, 90.9], rotY: Math.PI - 0.05, w: 0.62, h: 0.26, tex, depth: 0.01, collide: false, back: false });
  });
  // back area: work counter, sink (washable!), hanging scale, ice crates
  b.box([0, 0.45, 95.1], [12, 0.9, 0.8], 0xb7c3c9, { mat: 'metal' });
  b.box([3.5, 0.93, 95.1], [1.4, 0.06, 0.7], 0xdfe6ea, { collide: false, mat: 'metal' });
  water.addBox({ name: 'Fish Stall Sink', kind: 'sink', center: V(3.5, 0.9, 95.1), size: [1.2, 0.3, 0.55] });
  b.cyl([3.5, 1.3, 95.45], 0.03, 0.8, 0xc0c8cc, { seg: 6, collide: false, mat: 'metal' });
  b.pipe([3.5, 1.7, 95.45], [3.5, 1.7, 95.15], 0.03, 0xc0c8cc, { seg: 6, mat: 'metal' });
  b.cyl([-3, 2.4, 93.8], 0.02, 1.2, 0x333333, { seg: 4, collide: false, shadow: false });
  b.cyl([-3, 1.8, 93.8], 0.22, 0.25, 0xd8d8d8, { seg: 12, collide: false, mat: 'metal' });
  b.cyl([-3, 1.6, 93.8], 0.35, 0.05, 0xc8c8c8, { seg: 12, collide: false, mat: 'metal' });
  for (let i = 0; i < 3; i++) b.box([-5.8 + i * 0.9, 0.3 + (i === 1 ? 0.6 : 0), 94.4], [0.8, 0.6, 0.6], 0x3a7fc1, { mat: 'glossy' });
  // stall sign on the back wall
  const t = canvasTex(1280, 360, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f7f2e6');
    g.addColorStop(1, '#e8dfca');
    ctx.fillStyle = g;
    roundRect(ctx, 4, 4, w - 8, h - 8, 30);
    ctx.fill();
    ctx.strokeStyle = '#d64b3a';
    ctx.lineWidth = 12;
    roundRect(ctx, 16, 16, w - 32, h - 32, 22);
    ctx.stroke();
    fitText(ctx, "PIKE'S PLAICE FISH", w / 2, h * 0.38, w * 0.86, 120, FONT_TITLE, { fill: '#d64b3a', stroke: '#fff', strokeW: 8 });
    fitText(ctx, 'World Famous Flying Fish · Please Duck', w / 2, h * 0.72, w * 0.84, 54, FONT_ROUND, { fill: '#1d3557' });
  });
  kit.sign(b, { pos: [0, 3.6, M.z1 - 0.55], rotY: Math.PI, w: 7.5, h: 2.1, tex: t, depth: 0.1, back: false, collide: false });
  // POIs for the Catch of the Day event: fishmonger behind the counter, catch spot in the aisle
  kit.world.poi.set('fishMarket', V(0, 0.1, 94.2));
  kit.world.poi.set('fishCatch', V(0, 0.1, 86));
}

// ------------------------------------------------------------------ fruit & flower stalls

async function fruitModels(kit: Kit) {
  const names = ['banana', 'pineapple', 'watermelon'];
  const objs = await Promise.all(names.map((n) => kit.kenney('food-kit', n)));
  return Object.fromEntries(names.map((n, i) => [n, objs[i]])) as Record<string, THREE.Object3D | null>;
}

function fruitStall(kit: Kit, b: Batch) {
  const game = kit.game;
  const x0 = -22.5;
  const x1 = -9.5;
  const cx = (x0 + x1) / 2;
  const W = x1 - x0;
  // tiered crates
  const tiers = [
    [91.3, 0.75],
    [92.4, 1.05],
    [93.5, 1.35],
  ];
  for (const [z, h] of tiers) {
    b.box([cx, h / 2, z], [W, h, 1.0], 0xb98552, { mat: 'planks' });
    for (let x = x0 + 1.3; x < x1; x += 2.6) b.box([x, h - 0.1, z - 0.52], [0.05, 0.2, 0.04], 0x7a5230, { collide: false, shadow: false });
  }
  // fruit piles: low-poly instanced spheres (one draw call), plus a few Kenney pineapples/bananas/melons
  {
    const r = rng(55);
    const piles: [number, number, number[], number][] = [
      // tier, section (0 = left half, 1 = right half), colours, radius
      [0, 0, [0xd8262f, 0xe0402a, 0xb81d2a], 0.08],
      [0, 1, [0xff8c1a, 0xff9a2a], 0.08],
      [1, 0, [0xffe04a, 0xfff06a], 0.07],
      [1, 1, [0x6a2a7a, 0x7d3a8f, 0x5a2266], 0.07],
      [2, 0, [0x5fbf3a, 0x7ad04a], 0.065],
      [2, 1, [0xff4f7a, 0xd8262f], 0.055],
    ];
    const list: { x: number; y: number; z: number; s: number; c: number }[] = [];
    for (const [tier, sec, cols, rad] of piles) {
      const [tz, th] = tiers[tier];
      const sx0 = x0 + 0.25 + sec * (W / 2);
      const sx1 = sx0 + W / 2 - 0.5;
      const step = rad * 2.25;
      for (let x = sx0; x < sx1; x += step)
        for (let z = tz - 0.4; z < tz + 0.42; z += step) {
          list.push({ x: x + (r() - 0.5) * 0.02, y: th + rad, z, s: rad, c: cols[Math.floor(r() * cols.length)] });
          if (r() > 0.55) list.push({ x: x + step / 2, y: th + rad * 2.6, z: z + step / 2, s: rad, c: cols[Math.floor(r() * cols.length)] });
        }
    }
    const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.45, flatShading: true }), list.length);
    const mm = new THREE.Matrix4();
    const cc = new THREE.Color();
    list.forEach((f, i) => {
      im.setMatrixAt(i, mm.makeScale(f.s, f.s * 0.95, f.s).setPosition(f.x, f.y, f.z));
      im.setColorAt(i, cc.set(f.c));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    im.receiveShadow = true;
    kit.root.add(im);
  }
  void fruitModels(kit).then((f) => {
    if (f.watermelon) {
      const list: [number, number, number, number, number][] = [];
      for (let i = 0; i < 9; i++) list.push([x0 + 0.6 + i * 1.4, 0, 90.35 + (i % 2) * 0.15, i, 0.75]);
      kit.instances(f.watermelon, list);
    }
    if (f.pineapple) kit.instances(f.pineapple, [0, 1, 2, 3, 4].map((i) => [x0 + 0.5 + i * 0.5, tiers[2][1] + 0.25, tiers[2][0] + 0.52, i, 0.6] as [number, number, number, number, number]), { shadow: false });
    if (f.banana) kit.instances(f.banana, [0, 1, 2, 3, 4, 5].map((i) => [x1 - 0.6 - i * 0.45, tiers[1][1] + 0.3, tiers[1][0] + 0.55, 1.4 + i * 0.2, 0.45] as [number, number, number, number, number]), { shadow: false });
  });
  // grabbable fruit at the front edge
  const kinds: ('apple' | 'orange' | 'banana' | 'pineapple')[] = ['apple', 'orange', 'banana', 'apple', 'orange', 'pineapple'];
  kinds.forEach((k, i) => P.fruit(game, x0 + 1 + i * 2, 0.02, 89.9, k));
  // striped awning
  const aw = new THREE.MeshStandardMaterial({ map: awningTex('#e63946', '#fff4e6'), roughness: 0.8, side: THREE.DoubleSide });
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, 2.2), aw);
  awning.position.set(cx, 3.0, 91.6);
  awning.rotation.x = -Math.PI / 2 + 0.45;
  awning.castShadow = true;
  kit.root.add(awning);
  const s = kit.textSign([{ text: 'PRODUCE', px: 80, color: '#fff', stroke: '#b3261e' }, { text: 'raccoon-tested, raccoon-approved', px: 30, color: '#fff4e6', font: FONT_ROUND }], { w: 4, h: 1, bg: '#2f8f3a', border: '#fff4e6' });
  kit.sign(b, { pos: [cx, 4.1, M.z1 - 0.55], rotY: Math.PI, w: 4, h: 1, tex: s, depth: 0.08, back: false, collide: false });
}

function flowerStall(kit: Kit, b: Batch) {
  const game = kit.game;
  const x0 = 9.5;
  const x1 = 22.5;
  const cx = (x0 + x1) / 2;
  const r = rng(12);
  const cols = [0xff4f7a, 0xffd23a, 0xb36bff, 0xff8c3a, 0xffffff, 0xff5ac8, 0x5a8bff, 0xff3b30];
  const tiers = [
    [91.2, 0.0],
    [92.2, 0.35],
    [93.2, 0.7],
    [94.2, 1.05],
  ];
  for (const [z, h] of tiers) {
    if (h > 0) b.box([cx, h / 2, z], [x1 - x0, h, 1], 0x8a6a45, { mat: 'planks' });
    for (let x = x0 + 0.5; x < x1 - 0.3; x += 0.75) {
      b.cyl([x, h + 0.2, z], 0.2, 0.4, 0xb8c0c4, { rTop: 0.24, seg: 10, collide: false, mat: 'metal' });
      const c1 = cols[Math.floor(r() * cols.length)];
      const c2 = cols[Math.floor(r() * cols.length)];
      for (let k = 0; k < 6; k++) {
        const a = k * 1.1 + r();
        b.blob([x + Math.cos(a) * 0.12, h + 0.62 + r() * 0.12, z + Math.sin(a) * 0.12], 0.075, k % 2 ? c1 : c2, { detail: 0, shadow: false });
      }
      b.blob([x, h + 0.5, z], [0.2, 0.1, 0.2], 0x3a8f3a, { detail: 0, shadow: false });
    }
  }
  kit.collider([cx, 0.6, 92.7], [x1 - x0, 1.2, 4]);
  P.bouquet(game, x0 + 1, 0.02, 90.2, [0xff4f7a, 0xffffff, 0xffd23a]);
  P.bouquet(game, x0 + 3.5, 0.02, 90.3, [0xb36bff, 0xff5ac8, 0xffffff]);
  P.bouquet(game, x0 + 7, 0.02, 90.2, [0xff8c3a, 0xffd23a, 0xff3b30]);
  const aw = new THREE.MeshStandardMaterial({ map: awningTex('#2f7fc1', '#fff4e6'), roughness: 0.8, side: THREE.DoubleSide });
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 0.4, 2.2), aw);
  awning.position.set(cx, 3.0, 91.6);
  awning.rotation.x = -Math.PI / 2 + 0.45;
  awning.castShadow = true;
  kit.root.add(awning);
  const s = kit.textSign([{ text: 'FLOWERS', px: 80, color: '#fff', stroke: '#b3317a' }, { text: 'Bunches $10 · Petals do not wash off', px: 30, color: '#fff4e6', font: FONT_ROUND }], { w: 4, h: 1, bg: '#d6408a', border: '#fff4e6' });
  kit.sign(b, { pos: [cx, 4.1, M.z1 - 0.55], rotY: Math.PI, w: 4, h: 1, tex: s, depth: 0.08, back: false, collide: false });
}

// ------------------------------------------------------------------ front plaza

function frontPlaza(kit: Kit, b: Batch) {
  const game = kit.game;
  b.decal([-12, 0.02, 72.6], [82, 10.8], 0xe6ddcf, { mat: 'paving' });
  // Bronze "Jimothy the Bronze Ball" piggy bank (parody of the market's famous bronze pig)
  const sx = 0;
  const sz = 72.5;
  b.box([sx, 0.45, sz], [1.9, 0.9, 1.5], 0x8c8378, { mat: 'stone' });
  b.box([sx, 0.93, sz], [2.1, 0.08, 1.7], 0x9f968a, { mat: 'stone', collide: false });
  const fig = P.jimothyFigure();
  const bronze = new THREE.MeshStandardMaterial({ color: 0xb07a3a, metalness: 0.85, roughness: 0.32 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(fig.body, bronze);
  const head = new THREE.Mesh(fig.head, bronze);
  head.position.set(0, 0.95, 0.35);
  head.scale.setScalar(0.7);
  g.add(body, head);
  g.scale.setScalar(1.25);
  g.position.set(sx, 0.97, sz);
  g.rotation.y = Math.PI;
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : 0));
  kit.root.add(g);
  kit.ballCollider([sx, 0.97 + 0.62, sz], 0.62);
  kit.ballCollider([sx, 0.97 + 1.5, sz - 0.4], 0.45);
  const plaque = kit.textSign(
    [
      { text: 'JIMOTHY THE BRONZE BALL', px: 44, color: '#3b2a12' },
      { text: 'Rub for luck. Not for germs. Coins to animal rescue.', px: 24, color: '#3b2a12', font: FONT_ROUND },
    ],
    { w: 1.7, h: 0.5, bg: '#d9b36a', border: '#8a6a2a', pxPerM: 240 },
  );
  kit.sign(b, { pos: [sx, 0.5, sz - 0.76], rotY: Math.PI, w: 1.6, h: 0.44, tex: plaque, depth: 0.02, back: false, collide: false });
  // "Please do not feed the raccoon" municipal sign
  const t = canvasTex(900, 640, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 4, 4, w - 8, h - 8, 30);
    ctx.fill();
    ctx.strokeStyle = '#1f6b3a';
    ctx.lineWidth = 22;
    roundRect(ctx, 20, 20, w - 40, h - 40, 22);
    ctx.stroke();
    ctx.fillStyle = '#1f6b3a';
    ctx.fillRect(20, 20, w - 40, 110);
    fitText(ctx, 'PLEASE', w / 2, 76, w * 0.8, 84, FONT_TITLE, { fill: '#fff' });
    fitText(ctx, 'DO NOT FEED', w / 2, 210, w * 0.84, 100, FONT_TITLE, { fill: '#1b1d24' });
    fitText(ctx, 'THE RACCOON.', w / 2, 315, w * 0.84, 100, FONT_TITLE, { fill: '#1b1d24' });
    fitText(ctx, 'He is round enough.', w / 2, 425, w * 0.8, 62, FONT_ROUND, { fill: '#c62828' });
    fitText(ctx, '(He is perfect.)', w / 2, 520, w * 0.8, 56, FONT_ROUND, { fill: '#1f6b3a' });
  });
  for (const dx of [-0.8, 0.8]) b.cyl([-3.6 + dx, 1.05, 76.3], 0.05, 2.1, 0x5d6770, { seg: 8, collide: true, mat: 'metal' });
  kit.sign(b, { pos: [-3.6, 2.15, 76.3], rotY: Math.PI, w: 1.8, h: 1.28, tex: t, frame: 0x5d6770, depth: 0.05, border: 0.04 });
  // planters & lamps
  const r = rng(4);
  for (const x of [-20, -12, 12, 20]) {
    b.box([x, 0.35, 70.5], [2.4, 0.7, 1.2], 0x8c8378, { mat: 'concrete' });
    for (let k = 0; k < 8; k++) b.blob([x - 0.9 + k * 0.26, 0.8 + r() * 0.1, 70.5 + (r() - 0.5) * 0.6], 0.16, [0xff4f7a, 0xffd23a, 0xb36bff, 0x3a8f3a][k % 4], { detail: 0, shadow: false });
  }
  lamps(kit, b, [
    [-27, 0, 68],
    [-16, 0, 68],
    [-5, 0, 68],
    [5, 0, 68],
    [16, 0, 68],
    [27, 0, 68],
    [38, 0, 68],
    [-27, 0, 100],
    [-27, 0, 88],
  ]);
  P.trashCan(game, -9.5, 0, 69.2, 0x1f4d3a);
  P.trashCan(game, 9.5, 0, 69.2, 0x1f4d3a);
  fishCart(kit, b, 15.2, 72.6, Math.PI, 'SALMON TO GO', 'Wild · Round-tested', '#1d6fa3');
  fishCart(kit, b, -27, 103, Math.PI / 2, 'CRAB SHACK', 'Dungeness · Pinchy', '#d64b3a');
  P.cottonCandy(game, 30, 0.9, 74, 0xff9fd2);
  // a little snack cart east of the market
  b.box([30, 0.6, 74], [1.8, 1.2, 1], 0x2f7fc1, { mat: 'glossy' });
  b.cyl([30, 1.9, 74], 0.04, 1.4, 0xdddddd, { seg: 6, collide: false });
  b.cyl([30, 2.7, 74], 1.2, 0.4, 0xffd23a, { rTop: 0.05, seg: 10, collide: false, mat: 'glossy' });
  const cs = kit.textSign([{ text: 'MINI DONUTS', px: 64, color: '#fff', stroke: '#1d3557' }], { w: 1.7, h: 0.45, bg: '#ff8c3a' });
  kit.sign(b, { pos: [30, 0.75, 73.47], rotY: Math.PI, w: 1.6, h: 0.42, tex: cs, depth: 0.02, collide: false, back: false });
}

/** Open-air fish cart with an umbrella (visual only, so NPC spawns under it work). Faces +z rotated by rotY. */
function fishCart(kit: Kit, b: Batch, x: number, z: number, rotY: number, title: string, sub: string, color: string) {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const L = (lx: number, ly: number, lz: number): V3 => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
  b.box(L(0, 0.5, 0), [2.4, 0.8, 1.1], new THREE.Color(color).getHex(), { rotY, mat: 'glossy' });
  b.box(L(0, 0.94, 0), [2.5, 0.08, 1.2], 0xc9d1d5, { rotY, mat: 'metal' });
  for (const lx of [-0.9, 0.9]) b.geo(GEO.cyl(1, 14), L(lx, 0.28, 0.58), [Math.PI / 2, rotY, 0], [0.28, 0.08, 0.28], 0x2b2f33, {});
  const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const kinds: P.FishKind[] = ['salmon', 'snapper', 'cod', 'salmon'];
  for (let i = 0; i < 4; i++) {
    const p = L(-0.8 + i * 0.53, 1.06, 0.1 - (i % 2) * 0.25);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY + 0.1 * i).multiply(qTilt);
    b.add(P.fishGeometry(kinds[i]), new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(0.8, 0.8, 0.8)), 0xffffff, { keepColors: true, mat: 'glossy', shadow: false });
  }
  b.cyl(L(0.9, 1.6, -0.3), 0.04, 1.3, 0xdddddd, { seg: 6, collide: false });
  b.cyl(L(0.9, 2.35, -0.3), 1.35, 0.35, 0xe63946, { rTop: 0.05, seg: 8, collide: false, mat: 'glossy' });
  const t = kit.textSign([{ text: title, px: 60, color: '#fff', stroke: '#1b1d24' }, { text: sub, px: 28, color: '#fff8f0', font: FONT_ROUND }], { w: 2.3, h: 0.6, bg: color });
  kit.sign(b, { pos: L(0, 0.55, 0.57), rotY, w: 2.2, h: 0.55, tex: t, depth: 0.02, collide: false, back: false });
}

// ------------------------------------------------------------------ the Gum Wall (Post Alley)

function gumTexture() {
  const W = 2048;
  const H = 420;
  const r = rng(2024);
  return canvasTex(W, H, (ctx) => {
    ctx.clearRect(0, 0, W, H);
    const cols = ['#ff4fa3', '#ff77c8', '#59d4ff', '#7cff6b', '#ffe14a', '#b47bff', '#ff8c3a', '#ffffff', '#ff3b5c', '#3bffd1', '#ff9ecf'];
    const dot = (x: number, y: number, rad: number, col: string) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * (0.75 + r() * 0.5), r() * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(x + rad * 0.15, y + rad * 0.2, rad * 0.9, rad * 0.6, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.3, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let i = 0; i < 9500; i++) {
      const y = H * (1 - Math.pow(r(), 1.4)) * 0.98 + 4;
      dot(r() * W, y, 3 + r() * r() * 13, cols[Math.floor(r() * cols.length)]);
    }
    // "JIMOTHY WAS HERE" spelled in gum
    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const mc = mask.getContext('2d')!;
    mc.fillStyle = '#000';
    mc.font = `170px ${FONT_TITLE}`;
    mc.textAlign = 'center';
    mc.textBaseline = 'middle';
    mc.fillText('JIMOTHY WAS HERE', W * 0.42, H * 0.5);
    // heart
    mc.beginPath();
    const hx = W * 0.86;
    const hy = H * 0.45;
    mc.moveTo(hx, hy + 90);
    mc.bezierCurveTo(hx - 140, hy - 20, hx - 60, hy - 120, hx, hy - 50);
    mc.bezierCurveTo(hx + 60, hy - 120, hx + 140, hy - 20, hx, hy + 90);
    mc.fill();
    const data = mc.getImageData(0, 0, W, H).data;
    for (let i = 0; i < 26000; i++) {
      const x = Math.floor(r() * W);
      const y = Math.floor(r() * H);
      if (data[(y * W + x) * 4 + 3] > 128) dot(x, y, 5 + r() * 4, x > W * 0.78 ? '#ff2e4d' : r() > 0.5 ? '#ff4fa3' : '#ff77c8');
    }
  });
}

function gumWall(kit: Kit, b: Batch) {
  // Theatre building whose east face is the Gum Wall
  const bx0 = -46;
  const bx1 = GUM_X;
  const z0 = 78;
  const z1 = 98.5;
  const H = 8;
  b.box([(bx0 + bx1) / 2, H / 2, (z0 + z1) / 2], [bx1 - bx0, H, z1 - z0], 0xffffff, { mat: 'brick' });
  b.box([(bx0 + bx1) / 2, H + 0.2, (z0 + z1) / 2], [bx1 - bx0 + 0.4, 0.4, z1 - z0 + 0.4], 0x5a2e24, { mat: 'concrete' });
  for (let x = bx0 + 2; x < bx1 - 1; x += 3.2) for (const y of [3.4, 6]) b.box([x, y, z0 - 0.02], [1.4, 1.6, 0.06], 0x2b4a66, { collide: false, mat: 'window' });
  for (let z = z0 + 5; z < z1 - 1; z += 4) b.box([GUM_X + 0.02, 6, z], [0.06, 1.6, 1.4], 0x2b4a66, { collide: false, mat: 'window' });
  // theatre marquee (north face)
  const mq = canvasTex(1200, 360, (ctx, w, h) => {
    ctx.fillStyle = '#1b1d24';
    roundRect(ctx, 4, 4, w - 8, h - 8, 20);
    ctx.fill();
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = '#ffd86b';
      ctx.beginPath();
      ctx.arc(20 + (i * (w - 40)) / 39, 20, 8, 0, Math.PI * 2);
      ctx.arc(20 + (i * (w - 40)) / 39, h - 20, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    fitText(ctx, 'MARKET THEATRE', w / 2, h * 0.36, w * 0.86, 110, FONT_TITLE, { fill: '#ffd86b', glow: '#ff9d00' });
    fitText(ctx, "Improv tonight: 'Is It A Cat?'", w / 2, h * 0.7, w * 0.86, 56, FONT_ROUND, { fill: '#fff' });
  });
  kit.sign(b, { pos: [(bx0 + bx1) / 2 + 3, 3.3, z0 - 0.35], rotY: Math.PI, w: 7, h: 2.1, tex: mq, frame: 0x1b1d24, depth: 0.5, emissive: [0.5, 2.2], back: false });
  // the gum itself (alpha-tested plane just in front of the brick)
  const gz0 = 80;
  const gz1 = 97.4;
  const gh = 3.6;
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(gz1 - gz0, gh), new THREE.MeshStandardMaterial({ map: gumTexture(), alphaTest: 0.35, roughness: 0.35, metalness: 0 }));
  gm.position.set(GUM_X + 0.02, 0.1 + gh / 2, (gz0 + gz1) / 2);
  gm.rotation.y = Math.PI / 2;
  gm.receiveShadow = true;
  kit.root.add(gm);
  kit.state.gumWall = { faceX: GUM_X, normal: 1, minZ: gz0 - 0.2, maxZ: gz1 + 0.2, minY: 0, maxY: 0.1 + gh + 0.3 };
  kit.world.poi.set('gumWall', V(GUM_X + 1.2, 0.2, (gz0 + gz1) / 2));
  // Post Alley: cobbles, sign, hanging lamps
  b.decal([-27, 0.02, 85], [6, 30], 0xcfc4b3, { mat: 'paving' });
  const pa = kit.textSign([{ text: 'POST ALLEY', px: 70, color: '#fff' }, { text: '(gum not included) (gum included)', px: 26, color: '#ffe0f0', font: FONT_ROUND }], { w: 2.2, h: 0.7, bg: '#7a1f3d', border: '#ffe0f0' });
  b.box([-24.9, 3.4, 71.5], [0.1, 0.1, 1.2], 0x222222, { collide: false });
  kit.sign(b, { pos: [-24.9, 2.9, 72.4], rotY: Math.PI / 2, w: 1.1, h: 0.36, tex: pa, depth: 0.04, collide: false });
  const warn = kit.textSign(
    [
      { text: 'CAUTION', px: 64, color: '#1b1d24' },
      { text: 'Wall is VERY sticky.', px: 34, color: '#c62828', font: FONT_ROUND },
      { text: 'Round objects may adhere.', px: 28, color: '#1b1d24', font: FONT_ROUND },
    ],
    { w: 1.4, h: 0.9, bg: '#ffd23a', border: '#1b1d24' },
  );
  b.cyl([-25.6, 0.8, 79.2], 0.05, 1.6, 0x333333, { seg: 6, collide: false });
  kit.sign(b, { pos: [-25.6, 1.75, 79.2], rotY: Math.PI, w: 1.4, h: 0.9, tex: warn, frame: 0x1b1d24, depth: 0.04 });
}

// ------------------------------------------------------------------ waterfront park, kiosks, wheel

function park(kit: Kit, b: Batch) {
  const game = kit.game;
  // central promenade from the market's back doors to the boardwalk
  b.decal([0, 0.02, 126.5], [8, 61], 0xe6ddcf, { mat: 'paving' });
  b.decal([-8, 0.02, 99], [34, 6], 0xe6ddcf, { mat: 'paving' });
  b.path(
    [
      [-45, 150],
      [45, 150],
    ],
    4,
    0xe6ddcf,
    { mat: 'paving' },
  );
  b.path(
    [
      [-40, 104],
      [-20, 120],
      [-4, 128],
    ],
    2.6,
    0xfff1d6,
    { mat: 'gravel' },
  );
  const r = rng(8);
  for (const [x, z, s] of [
    [-45, 108, 1.1],
    [-36, 118, 1.0],
    [-47, 128, 1.2],
    [-30, 136, 0.9],
    [-16, 110, 1.0],
    [16, 108, 1.1],
    [22, 120, 0.9],
    [-44, 142, 1.0],
    [48, 106, 1.0],
    [12, 136, 0.9],
  ])
    tree(b, x, 0, z, s, Math.floor(x * 7 + z), { kind: r() > 0.8 ? 'pine' : 'round' });
  for (const [x, z] of [
    [-6, 112],
    [6, 118],
    [-6, 130],
    [6, 138],
  ])
    bench(b, x, 0, z, x < 0 ? Math.PI / 2 : -Math.PI / 2);
  // food kiosks along the promenade path
  const kiosks: [number, string, string, string][] = [
    [-38, 'CHOWDER-ISH', '#1d6fa3', 'Clams · Chowder · Raccoon-sized bowls'],
    [-22, 'FISH & CHIPS', '#e8a33a', 'Now 40% more chip'],
    [22, 'SALT WATER TAFFY', '#d6408a', 'Very sticky. Ask the Gum Wall.'],
    [38, 'ICE CREAM', '#43a0c8', 'Soft serve · One scoop per paw'],
  ];
  kiosks.forEach(([x, name, col, sub]) => {
    const z = 153.8;
    b.box([x, 1.3, z], [3.4, 2.6, 2.4], 0xf6efe0, { mat: 'siding' });
    b.box([x, 2.75, z], [3.9, 0.3, 2.9], new THREE.Color(col).getHex());
    b.box([x, 1.2, z - 1.23], [2.4, 0.9, 0.06], 0x2b2f38, { collide: false, mat: 'glossy' });
    b.box([x, 0.95, z - 1.45], [2.8, 0.08, 0.5], 0xd9c7a6, { collide: false });
    const t = kit.textSign([{ text: name, px: 64, color: '#fff', stroke: '#1b1d24' }, { text: sub, px: 26, color: '#fff', font: FONT_ROUND }], { w: 3.4, h: 0.8, bg: col });
    kit.sign(b, { pos: [x, 3.35, z - 0.9], rotY: Math.PI, w: 3.4, h: 0.8, tex: t, depth: 0.06, collide: false });
  });
  P.hotDog(game, -22.5, 0.99, 152.4, 0.3);
  P.cottonCandy(game, 21.6, 0.99, 152.4, 0x9fd8ff);
  P.cottonCandy(game, 22.4, 0.99, 152.4, 0xff9fd2);
  P.trashCan(game, -30, 0, 151.5, 0x2f5a7a);
  P.trashCan(game, 30, 0, 151.5, 0x2f5a7a);
  P.trashCan(game, -4.5, 0, 101, 0x1f4d3a);
  lamps(kit, b, [
    [-5, 0, 106],
    [5, 0, 116],
    [-5, 0, 126],
    [5, 0, 136],
    [-5, 0, 146],
    [-30, 0, 147.6],
    [30, 0, 147.6],
    [-45, 0, 147.6],
    [45, 0, 147.6],
  ]);
  for (const [x, z] of [
    [-50, 115],
    [-50, 135],
    [50, 150],
    [-12, 147],
    [12, 147],
  ])
    bush(b, x, 0, z, 1.2);
}

function prettyGoodWheel(kit: Kit, b: Batch) {
  const cx = 36;
  const cz = 128;
  const R = 13;
  const hub = 16;
  const white = 0xf7f7f2;
  // platform + A-frame legs on both sides
  b.box([cx, 0.2, cz], [16, 0.4, 9], 0xd9d2c3, { mat: 'concrete' });
  for (const s of [-1, 1]) {
    const z = cz + s * 2.2;
    for (const dx of [-6, 6]) b.pipe([cx + dx, 0.4, z], [cx, hub, z], 0.35, white, { collide: true, mat: 'metal' });
    b.pipe([cx - 4.6, 4, z], [cx + 4.6, 4, z], 0.18, white, { collide: true, mat: 'metal' });
  }
  b.pipe([cx, hub, cz - 2.6], [cx, hub, cz + 2.6], 0.6, 0x9aa3ad, { collide: true, mat: 'metal' });
  // rims (two rings) + spokes, all climbable
  const n = 24;
  for (const s of [-1.1, 1.1]) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const p0: V3 = [cx + Math.cos(a0) * R, hub + Math.sin(a0) * R, cz + s];
      const p1: V3 = [cx + Math.cos(a1) * R, hub + Math.sin(a1) * R, cz + s];
      b.pipe(p0, p1, 0.22, white, { collide: true, seg: 8, mat: 'metal' });
      if (i % 2 === 0) b.pipe([cx, hub, cz + s], p0, 0.09, white, { collide: false, seg: 6, mat: 'metal', shadow: false });
    }
  }
  // gondolas hanging below each other spoke (static — climb up the wheel!)
  const cols = [0x2f7fc1, 0xe63946, 0xffc629, 0x2f8f3a, 0xd6408a, 0x7a5cff];
  const bulbs: V3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    const px = cx + Math.cos(a) * R;
    const py = hub + Math.sin(a) * R;
    b.pipe([px, py, cz - 1.1], [px, py, cz + 1.1], 0.08, 0x9aa3ad, { seg: 6, mat: 'metal' });
    const gy = py - 1.6;
    b.box([px, gy, cz], [2.2, 1.9, 2.0], cols[i % cols.length], { mat: 'glossy' });
    b.box([px, gy + 0.2, cz], [2.25, 0.7, 2.05], 0x2b4a66, { collide: false, mat: 'window' });
    b.box([px, gy + 1.0, cz], [2.4, 0.15, 2.2], white, { collide: false });
    b.cyl([px, gy + 1.3, cz], 0.05, 0.6, 0x9aa3ad, { seg: 5, collide: false });
    bulbs.push([px, py, cz - 1.35], [px, py, cz + 1.35]);
  }
  // light bulbs around the rim (glow at night)
  const bm = kit.glowMat(0xfff0b0, 0.3, 3.5);
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), bm, bulbs.length + 48);
  let k = 0;
  for (const [x, y, z] of bulbs) im.setMatrixAt(k++, new THREE.Matrix4().makeTranslation(x, y, z));
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    im.setMatrixAt(k++, new THREE.Matrix4().makeTranslation(cx + Math.cos(a) * (R + 0.3), hub + Math.sin(a) * (R + 0.3), cz - 1.1));
  }
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  kit.root.add(im);
  const t = kit.textSign([{ text: 'THE PRETTY GOOD WHEEL', px: 66, color: '#fff', stroke: '#1d3557' }, { text: 'It goes around. Eventually.', px: 30, color: '#ffd23a', font: FONT_ROUND }], { w: 5, h: 1, bg: '#1d6fa3', border: '#ffd23a' });
  kit.sign(b, { pos: [cx, 1.7, cz - 4.6], rotY: Math.PI, w: 5, h: 1, tex: t, frame: 0x1d3557 });
  const topA = Math.PI / 2 + 0.13 - (Math.PI * 2) / 12 * 0;
  void topA;
  // bobblehead #9 on the roof of the top-most gondola
  let best = { y: -1, x: 0 };
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    const y = hub + Math.sin(a) * R;
    if (y > best.y) best = { y, x: cx + Math.cos(a) * R };
  }
  kit.world.poi.set('bobblehead:s9', V(best.x, best.y - 1.6 + 1.15, cz));
  kit.world.poi.set('prettyGoodWheel', V(cx, 0.5, cz - 5));
}

// ------------------------------------------------------------------ boardwalk, piers, pontoon

function deck(kit: Kit, b: Batch, x0: number, x1: number, z0: number, z1: number, o: { y?: number; fascia?: ('n' | 's' | 'e' | 'w')[]; piles?: boolean; uvRot?: boolean } = {}) {
  const y = o.y ?? DECK;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  b.box([cx, y - 0.1, cz], [x1 - x0, 0.2, z1 - z0], WOOD, { mat: 'planks', uvRot: o.uvRot });
  // thick edge "fascia" colliders so swimmers can climb out
  const fy0 = BAY_Y - 0.6;
  const fh = y - 0.2 - fy0;
  for (const f of o.fascia ?? []) {
    if (f === 'n' || f === 's') {
      const z = f === 'n' ? z0 + 0.15 : z1 - 0.15;
      b.box([cx, fy0 + fh / 2, z], [x1 - x0, fh, 0.3], 0x4a3a2a, { mat: 'planks' });
    } else {
      const x = f === 'w' ? x0 + 0.15 : x1 - 0.15;
      b.box([x, fy0 + fh / 2, cz], [0.3, fh, z1 - z0], 0x4a3a2a, { mat: 'planks' });
    }
  }
  if (o.piles !== false) {
    for (let x = x0 + 0.3; x <= x1 - 0.3 + 0.01; x += Math.max(2, (x1 - x0 - 0.6) / Math.max(1, Math.round((x1 - x0) / 4)))) {
      for (let z = z0 + 0.3; z <= z1 - 0.3 + 0.01; z += Math.max(2, (z1 - z0 - 0.6) / Math.max(1, Math.round((z1 - z0) / 4)))) {
        const edge = Math.abs(x - x0) < 0.5 || Math.abs(x - x1) < 0.5 || Math.abs(z - z0) < 0.5 || Math.abs(z - z1) < 0.5;
        if (!edge) continue;
        const ground = kit.world.heightAt(x, z);
        if (ground > y - 0.5) continue;
        b.cyl([x, (ground + y - 0.2) / 2, z], 0.2, y - 0.2 - ground, PILE, { seg: 8, collide: false, shadow: false });
      }
    }
  }
}

function railingX(b: Batch, x0: number, x1: number, z: number, y = DECK, color = 0x2d4250) {
  const len = x1 - x0;
  if (len < 0.4) return;
  b.box([(x0 + x1) / 2, y + 1.0, z], [len, 0.08, 0.08], color, { collide: false, mat: 'metal', shadow: false });
  b.box([(x0 + x1) / 2, y + 0.55, z], [len, 0.05, 0.05], color, { collide: false, mat: 'metal', shadow: false });
  for (let x = x0 + 0.05; x <= x1; x += 2) b.box([x, y + 0.5, z], [0.07, 1.0, 0.07], color, { collide: false, mat: 'metal', shadow: false });
  b.kit.collider([(x0 + x1) / 2, y + 0.55, z], [len, 1.1, 0.1]);
}

function railingZ(b: Batch, x: number, z0: number, z1: number, y = DECK, color = 0x2d4250) {
  const len = z1 - z0;
  if (len < 0.4) return;
  b.box([x, y + 1.0, (z0 + z1) / 2], [0.08, 0.08, len], color, { collide: false, mat: 'metal', shadow: false });
  b.box([x, y + 0.55, (z0 + z1) / 2], [0.05, 0.05, len], color, { collide: false, mat: 'metal', shadow: false });
  for (let z = z0 + 0.05; z <= z1; z += 2) b.box([x, y + 0.5, z], [0.07, 1.0, 0.07], color, { collide: false, mat: 'metal', shadow: false });
  b.kit.collider([x, y + 0.55, (z0 + z1) / 2], [0.1, 1.1, len]);
}

const BW = { x0: -53.5, x1: 53.5, z0: 157, z1: 171 };
const PIER_A = { x0: -44, x1: -38, z0: BW.z1, z1: 197 };
const TERM = { x0: -7, x1: 7, z0: BW.z1, z1: 181 };
const PONT = { x0: 13, x1: 23, z0: 167.4, z1: 184, y: BAY_Y + 0.42 };
const PIER_C = { x0: 30, x1: 34, z0: BW.z1, z1: 199 };

function boardwalk(kit: Kit, b: Batch) {
  const game = kit.game;
  // seawall below the boardwalk
  seawall(kit, b, BW.x0, BW.x1, { rail: false, top: DECK - 0.25 });
  // main deck, with a gap in the seaward fascia for the pontoon nook
  deck(kit, b, BW.x0, BW.x1, BW.z0, BW.z1, { fascia: [], piles: false });
  const fy0 = BAY_Y - 0.6;
  const fh = DECK - 0.2 - fy0;
  for (const [a, c] of [
    [BW.x0, PONT.x0],
    [PONT.x1, BW.x1],
  ])
    b.box([(a + c) / 2, fy0 + fh / 2, BW.z1 - 0.15], [c - a, fh, 0.3], 0x4a3a2a, { mat: 'planks' });
  // piles along the seaward edge
  for (let x = BW.x0 + 1; x < BW.x1; x += 3.5) {
    if (x > PONT.x0 - 0.5 && x < PONT.x1 + 0.5) continue;
    for (const z of [167.8, BW.z1 - 0.35]) b.cyl([x, (SEABED + DECK - 0.2) / 2, z], 0.2, DECK - 0.2 - SEABED, PILE, { seg: 8, collide: false, shadow: false });
  }
  // ramp up from the park onto the deck
  b.ramp([0, 0.0, BW.z0 - 1.6], [0, DECK, BW.z0], BW.x1 - BW.x0, WOOD, { mat: 'planks', thick: 0.25 });
  // railing along the water, with gaps for piers / gangway
  const gaps: [number, number][] = [
    [PIER_A.x0, PIER_A.x1],
    [TERM.x0, TERM.x1],
    [20.6, 22.6],
    [PIER_C.x0, PIER_C.x1],
  ];
  let x = BW.x0;
  for (const [a, c] of gaps) {
    railingX(b, x, a, BW.z1 - 0.2);
    x = c;
  }
  railingX(b, x, BW.x1, BW.z1 - 0.2);
  // benches facing the water, lamps, lifebuoy posts
  for (const bx of [-48, -32, -20, -12, 12, 26, 42, 50]) bench(b, bx, DECK, 168.2, 0);
  const L: V3[] = [];
  for (let lx = -50; lx <= 50; lx += 12.5) L.push([lx, DECK, BW.z1 - 0.9]);
  lamps(kit, b, L, { style: 'harbor' });
  const ring = new THREE.TorusGeometry(0.34, 0.09, 8, 16);
  const buoyGeo = (() => {
    const pos = ring.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.set(Math.floor(((Math.atan2(pos.getY(i), pos.getX(i)) + Math.PI) / (Math.PI * 2)) * 8) % 2 ? 0xffffff : 0xe8392f);
      col.set([c.r, c.g, c.b], i * 3);
    }
    ring.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return ring;
  })();
  for (const lx of [-26, 6, 36]) {
    b.box([lx, DECK + 0.8, BW.z1 - 0.6], [0.12, 1.6, 0.12], 0x2d4250, { collide: true, mat: 'metal' });
    b.box([lx, DECK + 1.55, BW.z1 - 0.6], [0.7, 0.1, 0.1], 0x2d4250, { collide: false, mat: 'metal' });
    b.geo(buoyGeo, [lx, DECK + 1.1, BW.z1 - 0.52], [0, 0, 0], 1, 0xffffff, { keepColors: true, mat: 'glossy' });
  }
  P.lifebuoy(game, -41, DECK, 186);
  P.lifebuoy(game, 32, DECK, 190);
  P.trashCan(game, -16, DECK, 158.6, 0x2f5a7a);
  P.trashCan(game, 16, DECK, 158.6, 0x2f5a7a);
  // WATERFRONT sign
  const t = kit.textSign([{ text: 'BALLARD-ISH WATERFRONT', px: 70, color: '#fff', stroke: '#0c2a40' }, { text: 'Salmon Bay · Boats · Seagulls with attitude', px: 30, color: '#bfe6ff', font: FONT_ROUND }], { w: 6, h: 1.2, bg: '#1f5f8b', border: '#ffd35a' });
  for (const dx of [-2.6, 2.6]) b.cyl([-20 + dx, 1.4, 156], 0.1, 2.8, 0x173a55, { seg: 8, collide: true });
  kit.sign(b, { pos: [-20, 3.1, 156], rotY: Math.PI, w: 6, h: 1.2, tex: t, frame: 0x173a55 });
  // gulls: perched on piles/railings + a lazy circling flock
  perched(kit, BIRD.gull(), [
    [-47, DECK + 1.05, BW.z1 - 0.2, 0.2, 1.3],
    [-9, DECK + 1.05, BW.z1 - 0.2, 2.9, 1.3],
    [11, DECK + 1.05, BW.z1 - 0.2, -0.6, 1.3],
    [45, DECK + 1.05, BW.z1 - 0.2, 1.9, 1.3],
    [PIER_A.x1 - 0.3, DECK + 1.05, 196.5, 3.5, 1.3],
    [PIER_C.x0 + 0.3, DECK + 1.05, 198.6, 0.5, 1.3],
  ]);
  flock(kit, BIRD.flyer(0xf7f7f4, 0xdfe3e8, 0xf2c12e), 7, V(0, 0, 170), 150, (i, time, out) => {
    const a = time * (0.22 + (i % 3) * 0.05) * (i % 2 ? 1 : -1) + i * 0.9;
    const rr = 16 + (i % 4) * 6;
    out.set(-5 + Math.cos(a) * rr, 13 + (i % 3) * 3 + Math.sin(time * 0.7 + i) * 1.2, 176 + Math.sin(a) * rr * 0.6);
    const s = i % 2 ? 1 : -1;
    return Math.atan2(-Math.sin(a) * rr * s, Math.cos(a) * rr * 0.6 * s);
  });
}

function piers(kit: Kit, b: Batch) {
  const game = kit.game;
  // Pier A: fishing pier with a bait shack at the end
  deck(kit, b, PIER_A.x0, PIER_A.x1, PIER_A.z0, PIER_A.z1, { fascia: ['w', 'e', 's'], uvRot: true });
  railingZ(b, PIER_A.x0 + 0.2, PIER_A.z0, PIER_A.z1 - 0.2);
  railingZ(b, PIER_A.x1 - 0.2, PIER_A.z0, 184);
  railingZ(b, PIER_A.x1 - 0.2, 187, PIER_A.z1 - 0.2);
  railingX(b, PIER_A.x0 + 0.2, PIER_A.x1 - 0.2, PIER_A.z1 - 0.2);
  const sx = (PIER_A.x0 + PIER_A.x1) / 2;
  for (const [dx, dz] of [
    [-2.4, -2.5],
    [2.4, -2.5],
    [-2.4, 2.5],
    [2.4, 2.5],
  ])
    b.cyl([sx + dx, DECK + 1.3, 193 + dz], 0.1, 2.6, 0x6b4a2f, { seg: 6, collide: true });
  b.box([sx, DECK + 2.7, 193], [6, 0.25, 6.5], 0x2f6b8f, { mat: 'metal' });
  const bait = kit.textSign([{ text: 'BAIT & TACKLE', px: 60, color: '#fff', stroke: '#1d3557' }, { text: 'Worms · Hooks · No raccoons past 9pm', px: 26, color: '#ffd23a', font: FONT_ROUND }], { w: 3, h: 0.7, bg: '#1d6fa3' });
  kit.sign(b, { pos: [sx, DECK + 3.2, 189.9], rotY: Math.PI, w: 3, h: 0.7, tex: bait, depth: 0.06, collide: false });
  bench(b, sx, DECK, 195.5, Math.PI);
  // fishing rods leaning on the rail
  for (const dz of [-3, 0, 3]) b.pipe([PIER_A.x0 + 0.35, DECK + 0.1, 188 + dz], [PIER_A.x0 - 1.2, DECK + 2.6, 188 + dz], 0.02, 0x333333, { seg: 4, shadow: false });
  // crab pots (a few grabbable) + a static stack
  for (let i = 0; i < 3; i++) P.crabPot(game, sx - 1.5 + i * 1.2, DECK, 181 + (i % 2) * 1.1, i * 0.4);
  for (let i = 0; i < 4; i++) b.box([sx + 1.8, DECK + 0.25 + i * 0.45, 178 + (i % 2) * 0.1], [0.8, 0.42, 0.8], 0x5a5a5a, { mat: 'metal', collide: i === 0 });
  kit.collider([sx + 1.8, DECK + 0.9, 178], [0.85, 1.8, 0.85]);

  // Ferry terminal pier + waiting room + car ramp
  deck(kit, b, TERM.x0, TERM.x1, TERM.z0, TERM.z1, { fascia: ['w', 'e'], uvRot: true });
  railingZ(b, TERM.x0 + 0.2, TERM.z0, TERM.z1);
  railingZ(b, TERM.x1 - 0.2, TERM.z0, TERM.z1);
  b.ramp([0, DECK, TERM.z1], [0, 1.0, 183.4], 7, 0x9aa3ad, { mat: 'metal', thick: 0.3 });
  const wx = -4.3;
  b.box([wx, DECK + 1.4, 175.5], [5, 2.8, 6], 0xf4efe4, { mat: 'siding' });
  b.box([wx, DECK + 2.95, 175.5], [5.6, 0.3, 6.6], 0x0f6b3e);
  b.box([wx + 2.52, DECK + 1.5, 175.5], [0.06, 1.2, 4.4], 0x2b4a66, { collide: false, mat: 'window' });
  const ft = kit.textSign(
    [
      { text: 'FERRY TERMINAL', px: 60, color: '#fff' },
      { text: 'To Bainbridge-ish Island · Next sailing: whenever', px: 26, color: '#dff7e8', font: FONT_ROUND },
    ],
    { w: 4.6, h: 0.9, bg: '#0f6b3e', border: '#fff' },
  );
  kit.sign(b, { pos: [wx, DECK + 3.5, 172.4], rotY: Math.PI, w: 4.6, h: 0.9, tex: ft, depth: 0.06, collide: false });

  // Floating pontoon + gangway; the nook under the boardwalk hides a lost kit
  const pc = (PONT.x0 + PONT.x1) / 2;
  b.box([pc, PONT.y - 0.3, (PONT.z0 + PONT.z1) / 2], [PONT.x1 - PONT.x0, 0.6, PONT.z1 - PONT.z0], 0xcbb28a, { mat: 'planks' });
  for (const z of [PONT.z0 + 2, (PONT.z0 + PONT.z1) / 2, PONT.z1 - 1]) b.box([pc, PONT.y - 0.72, z], [PONT.x1 - PONT.x0 + 0.1, 0.45, 1.3], 0xf2f2ee, { collide: false, mat: 'glossy' });
  for (const x of [PONT.x0 + 0.3, PONT.x1 - 0.3]) for (const z of [176, 183.6]) b.cyl([x, PONT.y + 0.2, z], 0.12, 0.4, 0x2b2f33, { seg: 8, collide: true, mat: 'metal' });
  b.ramp([21.6, DECK, BW.z1 - 0.1], [21.6, PONT.y, 176.5], 1.4, 0x9aa3ad, { mat: 'metal', thick: 0.15 });
  for (const s of [-0.72, 0.72]) b.pipe([21.6 + s, DECK + 1.0, BW.z1 - 0.1], [21.6 + s, PONT.y + 1.0, 176.5], 0.04, 0xd9dde0, { seg: 5, mat: 'metal' });
  const kitSpot = V(16, PONT.y + 0.15, 168.7);
  kit.world.poi.set('kit:5', kitSpot);
  b.box([14.2, PONT.y + 0.25, 168.2], [0.7, 0.5, 0.6], 0x8a6a45, { mat: 'planks' });
  b.box([14.9, PONT.y + 0.12, 169.4], [0.5, 0.24, 0.8], 0x9aa3ad, { mat: 'metal' });
  const hint = kit.textSign([{ text: 'Did something squeak down here?', px: 30, color: '#333', font: FONT_ROUND }], { w: 1.5, h: 0.3, bg: '#f7efe0', pxPerM: 200 });
  kit.sign(b, { pos: [19, PONT.y + 0.7, 176.3], rotY: Math.PI, w: 1.4, h: 0.28, tex: hint, depth: 0.02, collide: false });
  b.cyl([19, PONT.y + 0.35, 176.3], 0.03, 0.7, 0x5a4632, { seg: 5, collide: false });

  // Pier C marina with finger docks
  deck(kit, b, PIER_C.x0, PIER_C.x1, PIER_C.z0, PIER_C.z1, { fascia: ['w', 'e', 's'], uvRot: true });
  for (const z of [180, 189.5, 198]) {
    deck(kit, b, PIER_C.x1, 46, z - 0.9, z + 0.9, { fascia: ['n', 's', 'e'] });
    b.cyl([46 - 0.3, DECK + 0.3, z], 0.15, 0.6, 0x2b2f33, { seg: 8, collide: true, mat: 'metal' });
  }
  lamps(kit, b, [
    [PIER_A.x1 - 0.8, DECK, 180],
    [PIER_C.x0 + 0.6, DECK, 185],
    [PIER_C.x0 + 0.6, DECK, 196],
    [TERM.x1 - 0.8, DECK, 178],
  ], { style: 'harbor' });
  // dynamic dinghy bobbing by the pontoon (push it around!)
  void kit.kenney('watercraft-kit', 'boat-row-small').then((m) => {
    if (!m) return;
    const holder = new THREE.Group();
    m.scale.setScalar(1.25);
    holder.add(m);
    P.dinghy(game, holder, 9.5, BAY_Y - 0.25, 179, 0.3);
  });
}

// ------------------------------------------------------------------ the ferry

function ferry(kit: Kit, b: Batch) {
  const zA = 183.2; // north end (at the terminal)
  const zB = 219;
  const L = zB - zA;
  const zc = (zA + zB) / 2;
  const W = 11;
  const hw = W / 2;
  const car = 1.0; // car deck floor
  const pass = 4.0; // passenger deck floor
  const sun = 7.0; // sun deck
  const white = 0xf8f8f4;
  const green = 0x0f6b3e;
  const glass = 0x23415c;
  // hull
  b.box([0, (-2.8 + car) / 2, zc], [W, car + 2.8, L - 4], white, { mat: 'glossy' });
  for (const [z, sgn] of [
    [zA + 2, -1],
    [zB - 2, 1],
  ]) {
    b.geo(new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, sgn < 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI), [0, (-2.8 + car) / 2, z], [0, 0, 0], [hw, car + 2.8, 2], white, { mat: 'glossy' });
    b.kit.collider([0, (-2.8 + car) / 2, z + sgn * 1], [W * 0.8, car + 2.8, 2]);
  }
  b.box([0, BAY_Y - 0.9, zc], [W + 0.05, 1.4, L - 4], 0x7a2a22, { collide: false, shadow: false });
  b.box([0, 0.45, zc], [W + 0.08, 0.45, L - 4.1], green, { collide: false, mat: 'glossy' });
  // car deck: parapets, posts, overhead band
  for (const s of [-1, 1]) {
    const x = s * (hw - 0.15);
    b.box([x, car + 0.5, zc], [0.3, 1.0, L - 4], white, { mat: 'glossy' });
    b.box([x, pass - 0.35, zc], [0.3, 0.7, L - 4], white, { mat: 'glossy' });
    for (let z = zA + 2.5; z <= zB - 2.5; z += 3) b.box([x, (car + pass) / 2, z], [0.3, pass - car, 0.3], white, { mat: 'glossy' });
    b.box([s * (hw + 0.02), car + 1.45, zc], [0.06, 0.25, L - 4.2], green, { collide: false, mat: 'glossy' });
  }
  // passenger deck floor (car deck ceiling) with a stairwell hole on the west side
  const holeZ0 = 195;
  const holeZ1 = 199.5;
  const fl = (z0: number, z1: number, x0 = -hw, x1 = hw) => b.box([(x0 + x1) / 2, pass - 0.12, (z0 + z1) / 2], [x1 - x0, 0.24, z1 - z0], 0xd8d8d0, { mat: 'concrete' });
  fl(zA + 0.6, holeZ0);
  fl(holeZ1, zB - 0.6);
  fl(holeZ0, holeZ1, -hw + 1.6, hw);
  b.stairs([-hw + 0.95, car, holeZ0 - 5.5], [-hw + 0.95, pass, holeZ1 - 0.3], 1.3, 0x9aa3ad, { mat: 'metal' });
  // passenger cabin
  const cz0 = zA + 4;
  const cz1 = zB - 4;
  const cw = hw - 0.9;
  b.box([0, (pass + sun) / 2, (cz0 + cz1) / 2], [cw * 2, sun - pass, cz1 - cz0], white, { mat: 'glossy' });
  for (const s of [-1, 1]) {
    b.box([s * (cw + 0.02), pass + 1.65, (cz0 + cz1) / 2], [0.06, 1.1, cz1 - cz0 - 1], glass, { collide: false, mat: 'window' });
    b.box([s * (cw + 0.03), sun - 0.3, (cz0 + cz1) / 2], [0.06, 0.35, cz1 - cz0], green, { collide: false, mat: 'glossy' });
  }
  for (const z of [cz0 - 0.02, cz1 + 0.02]) {
    b.box([0, pass + 1.65, z], [cw * 1.6, 1.1, 0.06], glass, { collide: false, mat: 'window' });
    b.box([-cw + 1.2, pass + 1.05, z], [1.0, 2.1, 0.07], 0x5a6570, { collide: false });
  }
  // promenade railings on the passenger deck
  for (const s of [-1, 1]) railingZ(b, s * (hw - 0.12), zA + 0.8, zB - 0.8, pass, 0xe8e8e0);
  railingX(b, -hw + 0.2, hw - 0.2, zA + 0.7, pass, 0xe8e8e0);
  railingX(b, -hw + 0.2, hw - 0.2, zB - 0.7, pass, 0xe8e8e0);
  // sun deck (cabin roof) + stairs up from the promenade
  b.box([0, sun + 0.1, (cz0 + cz1) / 2], [cw * 2 + 0.3, 0.2, cz1 - cz0 + 0.3], 0xd8d8d0, { mat: 'concrete' });
  b.stairs([hw - 0.5, pass, cz1 - 6.2], [hw - 0.5, sun + 0.2, cz1 - 0.6], 0.9, 0x9aa3ad, { mat: 'metal' });
  for (const s of [-1, 1]) railingZ(b, s * (cw + 0.05), cz0 + 0.3, s > 0 ? cz1 - 6.5 : cz1 - 0.3, sun + 0.2, 0xe8e8e0);
  // wheelhouses at both ends + funnel + radar + lifeboats
  for (const z of [cz0 + 2.2, cz1 - 2.2]) {
    b.box([0, sun + 1.2, z], [5.6, 2.0, 3.4], white, { mat: 'glossy' });
    b.box([0, sun + 1.5, z + (z < zc ? -1.72 : 1.72)], [5.2, 0.9, 0.06], glass, { collide: false, mat: 'window' });
    for (const s of [-1, 1]) b.box([s * 2.82, sun + 1.5, z], [0.06, 0.9, 3.0], glass, { collide: false, mat: 'window' });
    b.box([0, sun + 2.3, z], [6, 0.25, 3.8], green, { mat: 'glossy' });
    b.cyl([0, sun + 3.1, z], 0.06, 1.4, 0x333333, { seg: 5, collide: false });
    b.box([0, sun + 3.7, z], [1.6, 0.12, 0.2], 0x333333, { collide: false });
  }
  b.cyl([0, sun + 2.2, zc], 1.2, 4.4, white, { seg: 16, collide: true, mat: 'glossy' });
  b.cyl([0, sun + 3.1, zc], 1.23, 0.8, green, { seg: 16, collide: false, mat: 'glossy' });
  b.cyl([0, sun + 4.2, zc], 1.24, 0.4, 0x1b1d24, { seg: 16, collide: false });
  for (const s of [-1, 1])
    for (const z of [zc - 6, zc + 6]) {
      b.geo(GEO.sphere(12, 8), [s * (cw - 0.6), sun + 0.75, z], [0, 0, 0], [0.7, 0.5, 2.0], 0xff7a1a, { mat: 'glossy' });
    }
  // name boards on the hull sides
  const name = canvasTex(1024, 200, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    fitText(ctx, 'M/V ROUND BOY', w / 2, h * 0.42, w * 0.92, 130, FONT_TITLE, { fill: '#0f6b3e' });
    fitText(ctx, 'BALLARD-ISH FERRIES', w / 2, h * 0.86, w * 0.6, 40, FONT_ROUND, { fill: '#0f6b3e' });
  });
  for (const s of [-1, 1]) kit.sign(b, { pos: [s * (hw + 0.05), -0.1, zc], rotY: (s * Math.PI) / 2, w: 8, h: 1.56, tex: name, depth: 0.01, transparent: true, back: false, collide: false });
  // cars parked on the car deck
  void Promise.all([kit.kenney('car-kit', 'sedan'), kit.kenney('car-kit', 'van'), kit.kenney('car-kit', 'taxi')]).then((cars) => {
    const spots: [number, number][] = [
      [2.4, 190],
      [-1.6, 204],
      [2.4, 210],
    ];
    cars.forEach((c, i) => {
      if (!c) return;
      const [x, z] = spots[i];
      const r = kit.place(c, x, car, z, i === 1 ? 0 : Math.PI, { scale: 1.45 });
      kit.collider([x, car + r.size.y / 2, z], [r.size.x * 0.9, r.size.y, r.size.z * 0.9]);
    });
  });
  kit.world.poi.set('ferry', V(0, car + 0.3, 200));
  kit.world.poi.set('bobblehead:s7', V(0, sun + 2.65, cz1 - 2.2));
}

async function boats(kit: Kit) {
  const st = kit.state;
  const place = async (kind: string, x: number, z: number, rotY: number, size: number, sink: number, hullH: number) => {
    const m = await kit.kenney('watercraft-kit', kind);
    if (!m) return;
    const r = kit.place(m, x, BAY_Y - sink, z, rotY, { size });
    st.bobbers.push({ obj: r.obj, baseY: BAY_Y - sink, amp: 0.05 + Math.random() * 0.04, speed: 0.9 + Math.random() * 0.6, phase: Math.random() * 6, roll: 0.025, baseRotX: 0, baseRotZ: 0 });
    kit.collider([x, BAY_Y - sink + hullH / 2, z], [r.size.x * 0.85, hullH, r.size.z * 0.9], rotY);
  };
  await Promise.all([
    place('boat-sail-a', 40, 184.8, Math.PI / 2, 8.5, 0.5, 1.4),
    place('boat-sail-b', 40.5, 194, -Math.PI / 2, 8.8, 0.5, 1.4),
    place('boat-speed-d', 40, 175.2, Math.PI / 2, 6, 0.35, 1.2),
    place('boat-fishing-small', -49, 186, 0.05, 7.8, 0.55, 1.6),
    place('boat-tug-a', -16, 196, 0.2, 8.5, 0.6, 2.2),
    place('boat-speed-g', 49, 189.5, -Math.PI / 2, 5.5, 0.35, 1.1),
  ]);
}
