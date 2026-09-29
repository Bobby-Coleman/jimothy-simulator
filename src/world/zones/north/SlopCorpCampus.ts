/**
 * NW — SlopCorp AI campus (satire of AI slop; fictional company), zone center (-120, -120).
 *
 *  - SlopCorp HQ: stacked, twisted glass blocks with the "Generating The Future™ (Results Not Guaranteed)" sign.
 *  - The giant six-fingered AI billboard (POI slopBillboard): a BoxGeometry face named "SlopBillboard" whose canvas
 *    art the slop system turns into its washable "slop layer" (it also adds the window-washer catwalk + buckets).
 *  - Data Center 7 on the hilltop (POI dataCenter): walk in through the roll-up door — rows of glowing racks,
 *    humming cooling towers outside, a glowing coolant tank, and a comically huge power cord running to the
 *    plug site (POI serverPlug — the slop system builds the transformer socket + plug there).
 *  - Prompt Portal pad (POI slopSpawner — the slop system builds the ring; this is the glowing pad + bollards).
 *  - Posters, garbled slop signs (washable), beanbags, scooters, laptops, tech-bro spawns.
 *  - The Ideation Lawn is left open on purpose (the Slop Dragon's pad gets placed around the campus).
 */
import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World, ZoneBuilder } from '../../World';
import type { WaterSystem } from '../../Water';
import {
  Batch,
  Frame,
  GEO,
  trs,
  northMaterials,
  loadFonts,
  canvasTexture,
  fitText,
  roundRect,
  signPanel,
  ribbon,
  footprint,
  footprintCircle,
  colliderBox,
  colliderRing,
  colliderCyl,
  addAnimator,
  rng,
  pick,
  poi,
  refreshQueries,
  type MatSet,
} from './kit';
import { plantTrees } from './flora';
import * as P from './props';

const ZONE = 'SlopCorp Campus';

// key spots
const HQ = { x: -100, z: -96, w: 30, d: 20 };
const DC = { x: -148, z: -160, w: 40, d: 22, h: 9 };
const PLUG = { x: -117, z: -150 };
const TANK = { x: -106, z: -168, r: 6.5 };
const BILL = { x: -120, z: -128 };
const PORTAL = { x: -130, z: -80 };

export const SlopCorpCampus: ZoneBuilder = {
  name: ZONE,
  async build(game: Game, world: World) {
    const [mats] = await Promise.all([northMaterials(game), loadFonts()]);
    const water = game.get<WaterSystem>('water')!;
    const b = new Batch(60);
    const r = rng(404);
    const H = (x: number, z: number) => world.heightAt(x, z);
    world.areas.push({ name: ZONE, min: new THREE.Vector2(-200, -200), max: new THREE.Vector2(-60, -60) });
    const glass = curtainMaterials(game);

    // ============================================================ HQ
    const hqTop = buildHQ(game, world, b, glass);
    poi(world, 'bobblehead:n6', hqTop.x, hqTop.y + 0.35, hqTop.z);
    hqPlaza(game, world, mats, b, r);

    // ============================================================ Prompt Portal pad (ring built by the slop system)
    portalPad(game, world, b, PORTAL.x, PORTAL.z);
    poi(world, 'slopSpawner', PORTAL.x, H(PORTAL.x, PORTAL.z), PORTAL.z);

    // ============================================================ billboard
    const bb = buildBillboard(game, world, b);
    poi(world, 'slopBillboard', BILL.x, H(BILL.x, BILL.z), BILL.z);
    poi(world, 'bobblehead:n3', bb.top.x, bb.top.y + 0.35, bb.top.z);

    // ============================================================ data center, cooling towers, coolant tank, cord
    const dc = buildDataCenter(game, world, mats, b);
    poi(world, 'dataCenter', DC.x, dc.floor, DC.z);
    const towerTop = coolingTowers(game, world, b, DC.x - DC.w / 2 - 7, DC.z);
    poi(world, 'bobblehead:n9', towerTop.x, towerTop.y + 0.35, towerTop.z);
    coolantTank(game, world, b, water, TANK.x, TANK.z, TANK.r);
    poi(world, 'serverPlug', PLUG.x, H(PLUG.x, PLUG.z), PLUG.z);
    giantCord(world, new THREE.Vector3(DC.x + DC.w / 2 + 0.3, dc.floor + 2.2, DC.z + 3), PLUG, new THREE.Vector3(DC.x, 0, DC.z));
    securityFence(game, world, b);

    // ============================================================ trees ("AI-generated" ones too)
    const firs: [number, number][] = [];
    for (let z = -70; z > -196; z -= 6 + r() * 3) firs.push([-186 - r() * 6, z]);
    for (let x = -176; x < -64; x += 7 + r() * 3) firs.push([x, -186 - r() * 6]);
    plantTrees(game, world, mats, 'fir', firs, { seed: 81, scale: [0.9, 1.3] });
    aiTrees(game, world, b, [
      [-160, -112],
      [-112, -118],
      [-150, -128],
      [-86, -118],
      [-160, -92],
    ]);
    plantTrees(game, world, mats, 'birch', [
      [-80, -76],
      [-120, -74],
      [-138, -96],
      [-88, -132],
    ], { seed: 83 });

    // ============================================================ NPCs: tech bros
    world.npcSpawns.push(
      { zone: ZONE, center: new THREE.Vector3(-100, H(-100, -78), -78), radius: 12, count: 5, types: ['techbro', 'techbro', 'techbro', 'pedestrian'] },
      { zone: ZONE, center: new THREE.Vector3(PORTAL.x, H(PORTAL.x, PORTAL.z + 6), PORTAL.z + 6), radius: 7, count: 2, types: ['techbro'] },
      { zone: ZONE, center: new THREE.Vector3(DC.x, H(DC.x, DC.z + DC.d / 2 + 8), DC.z + DC.d / 2 + 8), radius: 9, count: 3, types: ['techbro', 'techbro', 'jogger'] },
    );

    b.build(world.staticRoot, mats);
    refreshQueries(game);
  },
};

// ====================================================================================== materials

interface CurtainMats {
  glass: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
}

function curtainMaterials(game: Game): CurtainMats {
  const pane = (lit: boolean) =>
    canvasTexture(256, 256, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#7fb6d8');
      g.addColorStop(1, '#3f7fae');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const n = 4;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          if (lit) {
            const on = Math.random() < 0.45;
            ctx.fillStyle = on ? `rgba(255,${220 + Math.random() * 30},${150 + Math.random() * 60},1)` : 'rgba(10,20,40,1)';
            ctx.fillRect((i * w) / n + 4, (j * h) / n + 4, w / n - 8, h / n - 8);
          } else {
            ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`;
            ctx.fillRect((i * w) / n + 4, (j * h) / n + 4, w / n - 8, h / n - 8);
          }
        }
      if (!lit) {
        ctx.strokeStyle = '#e8eef2';
        ctx.lineWidth = 6;
        for (let i = 0; i <= n; i++) {
          ctx.beginPath();
          ctx.moveTo((i * w) / n, 0);
          ctx.lineTo((i * w) / n, h);
          ctx.moveTo(0, (i * h) / n);
          ctx.lineTo(w, (i * h) / n);
          ctx.stroke();
        }
      }
    });
  const map = pane(false);
  const emap = pane(true);
  for (const t of [map, emap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const glass = new THREE.MeshStandardMaterial({ map, emissiveMap: emap, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.05, roughness: 0.12, metalness: 0.55, envMapIntensity: 2.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.5, metalness: 0.5 });
  addAnimator(game, (_dt, _t, night) => {
    glass.emissiveIntensity = 0.05 + night * 1.1;
  });
  return { glass, dark };
}

/** Box with world-space UVs (1 tile = 3.6 m, one storey) for curtain walls. */
function glassBlock(world: World, mat: THREE.Material, cx: number, y0: number, cz: number, w: number, h: number, d: number, ry: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const T = 3.6;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nor.getX(i)),
      ny = Math.abs(nor.getY(i));
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    if (ny > 0.5) uv.setXY(i, x / T, z / T);
    else if (nx > 0.5) uv.setXY(i, z / T, (y + h / 2) / T);
    else uv.setXY(i, x / T, (y + h / 2) / T);
  }
  const m = new THREE.Mesh(g, mat);
  m.position.set(cx, y0 + h / 2, cz);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  world.staticRoot.add(m);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
  world.game.physics.staticBox(m.position.clone(), new THREE.Vector3(w / 2, h / 2, d / 2), q);
  return m;
}

// ====================================================================================== HQ

function buildHQ(game: Game, world: World, b: Batch, m: CurtainMats) {
  const fp = footprint(world, HQ.x, HQ.z, HQ.w, HQ.d, 0, 1.5);
  const base = fp.min - 0.4;
  const t1 = fp.max + 9;
  // glass lobby block down to the (downhill) street level, a thin concrete base band, two twisted upper blocks
  glassBlock(world, m.glass, HQ.x, base, HQ.z, HQ.w, t1 - base, HQ.d, 0);
  b.box('concrete', HQ.x, base + 0.45, HQ.z, HQ.w + 0.3, 0.9, HQ.d + 0.3, 0xd9dde2);
  b.box('metal', HQ.x, t1 + 0.25, HQ.z, HQ.w + 0.8, 0.5, HQ.d + 0.8, 0xe6eaee);
  const t2 = t1 + 9;
  glassBlock(world, m.glass, HQ.x - 2, t1 + 0.5, HQ.z + 1, 22, t2 - t1 - 0.5, 15, 0.16);
  b.box('metal', HQ.x - 2, t2 + 0.25, HQ.z + 1, 22.8, 0.5, 15.8, 0xe6eaee, 0.16);
  const t3 = t2 + 8;
  glassBlock(world, m.glass, HQ.x + 1.5, t2 + 0.5, HQ.z - 0.5, 17, t3 - t2 - 0.5, 12, -0.14);
  b.box('metal', HQ.x + 1.5, t3 + 0.25, HQ.z - 0.5, 17.8, 0.5, 12.8, 0xe6eaee, -0.14);
  // roof garden + helipad ring on the top block
  const f3 = new Frame(HQ.x + 1.5, t3 + 0.5, HQ.z - 0.5, -0.14);
  f3.geo(b, 'paint', GEO.cyl, 3, 0.02, 1, 7, 0.04, 7, 0x2f3540);
  f3.geo(b, 'marking', GEO.torus, 3, 0.05, 1, 5.4, 5.4, 0.8, 0xf4c21d, 0, Math.PI / 2);
  f3.box(b, 'marking', 3, 0.06, 1, 0.6, 0.02, 3.0, 0xf4c21d);
  f3.box(b, 'marking', 2.2, 0.06, 1, 0.6, 0.02, 3.0, 0xf4c21d);
  f3.box(b, 'marking', 3.8, 0.06, 1, 0.6, 0.02, 3.0, 0xf4c21d);
  f3.box(b, 'marking', 3, 0.06, 1, 1.6, 0.02, 0.5, 0xf4c21d);
  for (const [lx, lz] of [
    [-5.5, -3.5],
    [-5.5, 3.5],
  ]) {
    f3.box(b, 'wood', lx, 0.35, lz, 3.2, 0.7, 2.2, 0x8b6a4a);
    f3.geo(b, 'leaves', GEO.ico, lx, 1.0, lz, 2.4, 1.1, 1.6, 0x5fae4a);
    // polish: solid planters — bobblehead n6 sits on this bush, 1.6 m above a raccoon standing on the roof
    // (pickup reach is ~1.3 m); now Jimothy can hop onto the planter and grab it.
    const pc = f3.p(lx, 0.35, lz);
    colliderBox(game, pc.x, pc.y, pc.z, 3.2, 0.7, 2.2, -0.14);
  }
  // antenna mast with a blinking light
  f3.geo(b, 'metal', GEO.cyl8, -6.5, 3.0, 4.5, 0.2, 6, 0.2, 0xcfd6dc);
  f3.box(b, 'glow', -6.5, 6.1, 4.5, 0.3, 0.3, 0.3, 0xff3030);
  // rooftop "SlopCorp" letters (big glowing sign on the top block, facing the city)
  const logo = canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#7df9ff');
    g.addColorStop(0.5, '#c77dff');
    g.addColorStop(1, '#ff7df0');
    ctx.fillStyle = g;
    fitText(ctx, 'SlopCorp', w / 2, h / 2 + 8, w - 60, 210, "'Luckiest Guy', sans-serif");
  });
  const lm = new THREE.MeshStandardMaterial({ map: logo, emissiveMap: logo, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.9, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, roughness: 0.4 });
  const logoMesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), lm);
  const lp = f3.p(0, 2.6, 6.0 + 0.2);
  logoMesh.position.copy(lp);
  logoMesh.rotation.y = -0.14;
  world.staticRoot.add(logoMesh);
  f3.box(b, 'metal', 0, 0.9, 6.05, 15, 0.12, 0.12, 0x9aa3ad);
  for (const lx of [-6, -2, 2, 6]) f3.box(b, 'metal', lx, 0.75, 6.05, 0.1, 1.5, 0.1, 0x9aa3ad);
  // entrance canopy + tagline sign on the lobby (south face)
  const fz = HQ.z + HQ.d / 2;
  const g0 = Math.max(H3(world, HQ.x - 5, fz + 2), H3(world, HQ.x + 5, fz + 2));
  b.box('metal', HQ.x, g0 + 4.2, fz + 2.2, 12, 0.3, 4.4, 0xe6eaee);
  for (const s of [-1, 1]) b.add('metal', GEO.cyl8, trs(HQ.x + s * 5.5, g0 + 2.1, fz + 4, 0.25, 4.2, 0.25), 0xcfd6dc);
  colliderBox(game, HQ.x, g0 + 4.2, fz + 2.2, 12, 0.3, 4.4);
  const tag = canvasTexture(2048, 256, (ctx, w, h) => {
    ctx.fillStyle = '#10131a';
    roundRect(ctx, 0, 0, w, h, 30);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const gr = ctx.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#7df9ff');
    gr.addColorStop(1, '#ff7df0');
    ctx.fillStyle = gr;
    fitText(ctx, 'SlopCorp — Generating The Future™', w / 2, h * 0.38, w - 100, 120, "'Lilita One', sans-serif");
    ctx.fillStyle = '#c9d2dc';
    fitText(ctx, '(Results Not Guaranteed)', w / 2, h * 0.78, w - 300, 60, "'Nunito', sans-serif", 'italic 800');
  });
  signPanel(world, tag, HQ.x, g0 + 5.6, fz + 0.35, 14, 1.75, 0, { back: 0x10131a, depth: 0.12, collide: false, lit: true, emissive: 0.35, game, batch: b });
  // revolving door + lobby floor band
  b.add('glass', GEO.cyl, trs(HQ.x, g0 + 1.4, fz + 0.2, 3.2, 2.8, 3.2), 0x9fc7e0);
  b.add('metal', GEO.cyl, trs(HQ.x, g0 + 2.85, fz + 0.2, 3.4, 0.12, 3.4), 0xcfd6dc);
  // posters on the lobby glass
  const posters = [
    ['MOVE FAST AND', 'GENERATE THINGS'],
    ['NOW WITH', '40% MORE FINGERS'],
    ['HALLUCINATIONS ARE', 'JUST CREATIVE FACTS'],
    ['SCALE IS ALL YOU NEED', '(PLEASE INVEST)'],
  ];
  posters.forEach(([a, c], i) => {
    const px = HQ.x - 12 + i * 3.3 + (i >= 2 ? 11 : 0);
    const pt = posterTex(a, c, i);
    signPanel(world, pt, px, g0 + 2.1, fz + 0.08, 2.4, 3.2, 0, { back: 0x10131a, depth: 0.04, collide: false, batch: b });
  });
  return f3.p(-5.5, 1.1, 3.5);
}

function H3(world: World, x: number, z: number) {
  return world.heightAt(x, z);
}

function posterTex(a: string, c: string, i: number) {
  const cols = [
    ['#ff7df0', '#2a0f3d'],
    ['#7df9ff', '#0f2a3d'],
    ['#ffd23a', '#3d2a0f'],
    ['#9dff7d', '#153d0f'],
  ][i % 4];
  return canvasTexture(384, 512, (ctx, w, h) => {
    ctx.fillStyle = cols[1];
    ctx.fillRect(0, 0, w, h);
    // melty AI swirl
    for (let k = 0; k < 18; k++) {
      ctx.fillStyle = `hsla(${(k * 37 + i * 60) % 360}, 90%, 60%, 0.25)`;
      ctx.beginPath();
      ctx.ellipse(w / 2 + Math.sin(k) * 90, h * 0.35 + Math.cos(k * 1.3) * 60, 60 + k * 3, 30 + k * 2, k, 0, Math.PI * 2);
      ctx.fill();
    }
    // a hand with six fingers
    ctx.fillStyle = '#f1c7a6';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.38, 60, 70, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let f = 0; f < 6; f++) {
      const a2 = -Math.PI * 0.85 + (f / 5) * Math.PI * 0.7;
      ctx.save();
      ctx.translate(w / 2 + Math.cos(a2) * 55, h * 0.38 + Math.sin(a2) * 60);
      ctx.rotate(a2 + Math.PI / 2);
      roundRect(ctx, -11, -70, 22, 72, 11);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = cols[0];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, a, w / 2, h * 0.72, w - 30, 44, "'Lilita One', sans-serif");
    fitText(ctx, c, w / 2, h * 0.84, w - 30, 44, "'Lilita One', sans-serif");
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    fitText(ctx, 'SlopCorp™', w / 2, h * 0.95, w - 60, 22, "'Nunito', sans-serif", '800');
  });
}

function hqPlaza(game: Game, world: World, mats: MatSet, b: Batch, r: () => number) {
  // paved forecourt following the slope, between the HQ and the avenue
  const fz = HQ.z + HQ.d / 2;
  const path = [new THREE.Vector2(HQ.x - 20, fz + 7), new THREE.Vector2(HQ.x + 18, fz + 7)];
  b.add('paving', ribbon(world, path, -7, 7, 0.05, { tile: 4, across: 6 }), null, 0xe2e6ea, { uvTile: 0 });
  // outdoor "synergy zone": standing desks with laptops, beanbags, scooters
  for (let i = 0; i < 4; i++) {
    const x = HQ.x - 14 + i * 3.2,
      z = fz + 9.5;
    const y = world.heightAt(x, z);
    b.box('metal', x, y + 1.05, z, 1.6, 0.06, 0.8, 0xf2f4f6);
    b.box('metal', x, y + 0.52, z, 0.12, 1.04, 0.5, 0x3a4048);
    world.collider(new THREE.Vector3(x, y + 0.55, z), new THREE.Vector3(1.6, 1.1, 0.8));
    if (i % 2 === 0) P.spawnLaptop(game, mats, x, y + 1.1, z, Math.PI + (r() - 0.5) * 0.4);
  }
  const bagCols = [0xff7df0, 0x7df9ff, 0xffd23a, 0x9dff7d, 0xc77dff];
  for (let i = 0; i < 5; i++) {
    const x = HQ.x + 4 + i * 2.2 + (r() - 0.5),
      z = fz + 8.5 + (r() - 0.5) * 2;
    P.spawnOnGround(game, P.beanbag(mats, bagCols[i]), x, z, r() * 6, 0.45);
  }
  for (let i = 0; i < 3; i++) {
    const x = HQ.x + 16 + i * 0.9,
      z = fz + 3.2;
    P.spawnOnGround(game, P.scooter(mats), x, z, Math.PI / 2 + (r() - 0.5) * 0.2, 0.4);
  }
  // garbled slop signs (washable, they dissolve)
  const garble = ['BEST ESPRSSO SINCE 20§3', 'FREE WFI · NO RACOONS', 'OPNE 25 HOURS', 'THIS WAY ↑↓ →'];
  garble.forEach((t, i) => {
    const tex = canvasTexture(256, 384, (ctx, w, h) => {
      ctx.fillStyle = '#10131a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `hsl(${(i * 70 + 180) % 360}, 90%, 65%)`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const words = t.split(' ');
      words.forEach((wd, k) => fitText(ctx, wd, w / 2, (h * (k + 1)) / (words.length + 1), w - 24, 58, "'Lilita One', sans-serif"));
      // glitch bars
      for (let k = 0; k < 6; k++) {
        ctx.fillStyle = `hsla(${Math.random() * 360}, 90%, 60%, 0.35)`;
        ctx.fillRect(0, Math.random() * h, w, 4 + Math.random() * 8);
      }
    });
    const x = HQ.x - 18 + i * 9,
      z = fz + 13;
    P.spawnSlopSign(game, mats, tex, x, world.heightAt(x, z) + 0.05, z, (r() - 0.5) * 0.6);
  });
  // benches + planters with neon "AI trees"
  for (const dx of [-8, 8]) {
    const x = HQ.x + dx,
      z = fz + 5;
    const y = world.heightAt(x, z);
    b.box('concrete', x, y + 0.25, z, 3.2, 0.5, 1.0, 0xd9dde2);
    world.collider(new THREE.Vector3(x, y + 0.25, z), new THREE.Vector3(3.2, 0.5, 1.0));
  }
}

// ====================================================================================== portal pad

function portalPad(game: Game, world: World, b: Batch, x: number, z: number) {
  const tex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2,
      cy = h / 2;
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = i % 2 ? '#7df9ff' : '#c77dff';
      ctx.lineWidth = 10 - i;
      ctx.beginPath();
      ctx.arc(cx, cy, 240 - i * 38, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(125,249,255,0.18)';
    ctx.beginPath();
    ctx.arc(cx, cy, 245, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(cx, cy);
    const words = 'PROMPT PORTAL · STAND BACK · MAY GENERATE RACCOONS · ';
    const chars = words.split('');
    chars.forEach((ch, i) => {
      ctx.save();
      ctx.rotate((i / chars.length) * Math.PI * 2);
      ctx.font = "26px 'Lilita One', sans-serif";
      ctx.fillText(ch, 0, -205);
      ctx.restore();
    });
    ctx.restore();
  });
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.6, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const R = 5.2;
  const g = ribbon(world, [new THREE.Vector2(x - R, z), new THREE.Vector2(x + R, z)], -R, R, 0.06, { tile: 1, across: 8 });
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - (x - R)) / (2 * R), (pos.getZ(i) - (z - R)) / (2 * R));
  const pad = new THREE.Mesh(g, mat);
  pad.receiveShadow = true;
  pad.userData.noMerge = true;
  world.staticRoot.add(pad);
  // glowing bollards around the pad
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const bx = x + Math.cos(a) * (R + 0.6),
      bz = z + Math.sin(a) * (R + 0.6);
    const y = world.heightAt(bx, bz);
    b.add('metal', GEO.cyl8, trs(bx, y + 0.45, bz, 0.26, 0.9, 0.26), 0x2c3440);
    b.add('glow', GEO.cyl8, trs(bx, y + 0.95, bz, 0.22, 0.12, 0.22), 0x7df9ff);
    world.collider(new THREE.Vector3(bx, y + 0.5, bz), new THREE.Vector3(0.3, 1.0, 0.3));
  }
  addAnimator(game, (_dt, t) => {
    mat.emissiveIntensity = 0.45 + Math.sin(t * 2.2) * 0.2;
  });
}

// ====================================================================================== billboard

/** Obviously-AI-generated Jimothy (the slop layer the slop system melts away when washed). */
function drawAIJimothy(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // melting psychedelic sky
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#ff7df0');
  g.addColorStop(0.35, '#7d5cff');
  g.addColorStop(0.7, '#2bd6ff');
  g.addColorStop(1, '#ffd23a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    const x = (i / 26) * w + Math.sin(i * 7) * 20;
    const len = 60 + ((i * 53) % 200);
    const dg = ctx.createLinearGradient(0, h * 0.62, 0, h * 0.62 + len);
    dg.addColorStop(0, 'rgba(255,210,58,0.9)');
    dg.addColorStop(1, 'rgba(255,210,58,0)');
    ctx.fillStyle = dg;
    roundRect(ctx, x, h * 0.6, 22 + (i % 3) * 8, len, 11);
    ctx.fill();
  }
  // sun with too many rays + a rainbow that goes nowhere
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 6;
  for (let i = 0; i < 23; i++) {
    const a = (i / 23) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.85 + Math.cos(a) * 70, h * 0.2 + Math.sin(a) * 70);
    ctx.lineTo(w * 0.85 + Math.cos(a) * 120, h * 0.2 + Math.sin(a) * 120);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff3a0';
  ctx.beginPath();
  ctx.arc(w * 0.85, h * 0.2, 62, 0, Math.PI * 2);
  ctx.fill();
  const rb = ['#ff4d4d', '#ffae3d', '#ffe23d', '#4dff88', '#4dc3ff', '#9b6bff'];
  rb.forEach((c, i) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(w * 0.2, h * 1.05, 330 - i * 16, Math.PI * 1.05, Math.PI * 1.62);
    ctx.stroke();
  });
  // the "raccoon": round body, three eyes, a melting mask, six fingers per hand
  const cx = w * 0.46,
    cy = h * 0.55;
  ctx.fillStyle = '#8f8f99';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 250, 215, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6d6d77';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * 150, cy - 185, 56, 64, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#f1efe9';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 40, 120, 90, 0, 0, Math.PI * 2);
  ctx.fill();
  // melting mask
  ctx.fillStyle = '#1b1b22';
  roundRect(ctx, cx - 190, cy - 85, 380, 80, 40);
  ctx.fill();
  for (let i = 0; i < 7; i++) {
    roundRect(ctx, cx - 170 + i * 55, cy - 20, 18, 30 + ((i * 37) % 70), 9);
    ctx.fill();
  }
  // three eyes
  for (const ex of [-95, 0, 95]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + ex, cy - 45, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ex === 0 ? '#ff2bd6' : '#111';
    ctx.beginPath();
    ctx.arc(cx + ex + 4, cy - 42, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#2a2a30';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 20, 26, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  // hands with SIX fingers, one holding a phone
  for (const s of [-1, 1]) {
    const hx = cx + s * 250,
      hy = cy + 90;
    ctx.fillStyle = '#2e2e36';
    ctx.beginPath();
    ctx.ellipse(hx, hy, 58, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let f = 0; f < 6; f++) {
      const a = -Math.PI / 2 + (f - 2.5) * 0.36;
      ctx.save();
      ctx.translate(hx + Math.cos(a) * 45, hy + Math.sin(a) * 45);
      ctx.rotate(a + Math.PI / 2);
      roundRect(ctx, -9, -58, 18, 60, 9);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = '#10131a';
  roundRect(ctx, cx + 215, cy - 30, 70, 120, 12);
  ctx.fill();
  ctx.fillStyle = '#7df9ff';
  roundRect(ctx, cx + 222, cy - 22, 56, 100, 8);
  ctx.fill();
  // sparkles
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) {
    const x = (i * 197) % w,
      y = (i * 131) % (h * 0.55);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-3, -12, 6, 24);
    ctx.fillRect(-12, -3, 24, 6);
    ctx.restore();
  }
  // garbled headline
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1b0f3d';
  ctx.lineWidth = 12;
  const lines = [
    ['JIMOTHYY THE RACCON', 90],
    ['— HE ROUNDED —', 64],
    ['4K ULTRA REALISTIC TRENDING', 50],
  ] as const;
  lines.forEach(([t, s], i) => {
    ctx.font = `${s}px 'Luckiest Guy', sans-serif`;
    const y = h * 0.14 + i * (s + 18);
    ctx.save();
    ctx.translate(40, y);
    ctx.rotate(-0.03 + i * 0.025);
    ctx.strokeText(t, 0, 0);
    ctx.fillText(t, 0, 0);
    ctx.restore();
  });
  ctx.font = "30px 'Nunito', sans-serif";
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('SlopCorp ImageGen v0.3 · generated in 0.2 s · 11 fingers verified', 40, h - 34);
}

function buildBillboard(game: Game, world: World, b: Batch) {
  const toward = new THREE.Vector3(-BILL.x, 0, -BILL.z).normalize();
  const yaw = Math.atan2(toward.x, toward.z);
  const g = world.heightAt(BILL.x, BILL.z);
  const W = 18,
    Hh = 7.9;
  const bottom = 9; // frame-local height of the face bottom (the frame origin already sits on the ground)
  const f = new Frame(BILL.x, g, BILL.z, yaw);
  // two big steel columns + truss + service ladder
  for (const s of [-1, 1]) {
    f.geo(b, 'metal', GEO.cyl8, s * 5, bottom / 2 + 0.5, -0.7, 0.8, bottom + 1, 0.8, 0x9aa3ad);
    f.collider(game, s * 5, bottom / 2 + 0.5, -0.7, 0.8, bottom + 1, 0.8);
    f.box(b, 'concrete', s * 5, 0.3, -0.7, 1.6, 0.6, 1.6, 0xc9ccd0);
  }
  for (let i = 0; i < 4; i++) f.box(b, 'metal', 0, bottom - 0.9 - i * 2.1, -0.7, 10, 0.14, 0.14, 0x8a929a, 0, 0, i % 2 ? 0.35 : -0.35);
  f.box(b, 'metal', 0, bottom + Hh / 2, -0.75, W + 0.4, Hh + 0.4, 0.3, 0x6f7780);
  // the face: a BoxGeometry (front = material index 4) named "SlopBillboard" — the slop system hooks into it
  const tex = canvasTexture(2048, 896, drawAIJimothy);
  const faceCenter = f.p(0, bottom + Hh / 2, -0.2);
  const face = signPanel(world, tex, faceCenter.x, faceCenter.y, faceCenter.z, W, Hh, yaw, { asBox: true, depth: 0.7, back: 0x3a4048, lit: true, game, name: 'SlopBillboard' });
  face.userData.noMerge = true;
  // floodlights on the truss, well below the window-washer catwalk the slop system adds at the bottom edge
  for (let i = -2; i <= 2; i++) {
    f.box(b, 'metal', i * 3.8, bottom - 2.2, -0.1, 0.08, 0.08, 1.2, 0x2b2f36);
    f.box(b, 'lamp', i * 3.8, bottom - 2.05, 0.45, 0.6, 0.18, 0.4, 0xfff4d0, 0, -0.9);
  }
  // service ladder up the left column
  for (let k = 0; k < Math.floor(bottom / 0.4); k++) f.box(b, 'metal', -5, 0.5 + k * 0.4, -0.2, 0.6, 0.05, 0.05, 0xcfd6dc);
  return { top: f.p(0, bottom + Hh + 0.2, -0.3) };
}

// ====================================================================================== data center

function buildDataCenter(game: Game, world: World, mats: MatSet, b: Batch) {
  const { x, z, w, d, h } = DC;
  const fp = footprint(world, x, z, w + 4, d + 4, 0, 1.5);
  const floor = fp.max + 0.3;
  const base = fp.min - 0.5;
  const f = new Frame(x, floor, z, 0);
  const T = 0.5;
  const panel = 0xb9c1c9;
  // floor slab + plinth
  f.box(b, 'concrete', 0, (base - floor) / 2, 0, w + 1, floor - base, d + 1, 0xbfc5cb);
  f.box(b, 'paint', 0, 0.02, 0, w - 2 * T, 0.04, d - 2 * T, 0x7c8792);
  f.collider(game, 0, (base - floor) / 2, 0, w + 1, floor - base, d + 1);
  // walls (south wall has the big roll-up door opening)
  const door = 5.2,
    doorH = 4.6;
  const wall = (lx: number, lz: number, sx: number, sz: number, sy = h, y0 = 0) => {
    f.box(b, 'metal', lx, y0 + sy / 2, lz, sx, sy, sz, panel);
    f.collider(game, lx, y0 + sy / 2, lz, sx, sy, sz);
  };
  wall(0, -d / 2 + T / 2, w, T);
  wall(-w / 2 + T / 2, 0, T, d);
  wall(w / 2 - T / 2, 0, T, d);
  const sideLen = (w - door) / 2;
  wall(-w / 2 + sideLen / 2, d / 2 - T / 2, sideLen, T);
  wall(w / 2 - sideLen / 2, d / 2 - T / 2, sideLen, T);
  wall(0, d / 2 - T / 2, door, T, h - doorH, doorH);
  // vertical panel ribs + a lit stripe band outside
  for (let i = 0; i <= 12; i++) {
    const lx = -w / 2 + (i * w) / 12;
    f.box(b, 'metal', lx, h / 2, d / 2 + 0.05, 0.18, h, 0.12, 0x9aa3ad);
    f.box(b, 'metal', lx, h / 2, -d / 2 - 0.05, 0.18, h, 0.12, 0x9aa3ad);
  }
  f.box(b, 'glow', 0, h - 0.6, d / 2 + 0.1, w - 0.4, 0.14, 0.05, 0x39e6ff);
  // roof + rooftop HVAC
  f.box(b, 'metal', 0, h + 0.2, 0, w + 0.4, 0.4, d + 0.4, 0x8d959d);
  f.collider(game, 0, h + 0.2, 0, w + 0.4, 0.4, d + 0.4);
  for (let i = 0; i < 4; i++) {
    const lx = -w / 2 + 6 + i * 9;
    f.box(b, 'metal', lx, h + 1.2, -3, 4, 1.6, 3, 0xcfd6dc);
    f.geo(b, 'metal', GEO.cyl, lx, h + 2.05, -3, 2.4, 0.1, 2.4, 0x3a4048);
    f.collider(game, lx, h + 1.2, -3, 4, 1.6, 3);
  }
  // roll-up door (half open) + ramp
  f.box(b, 'metal', 0, doorH - 0.35, d / 2 - 0.1, door, 0.7, 0.2, 0xd9dde2);
  const gFront = (() => {
    const p = f.p(0, 0, d / 2 + 3);
    return world.heightAt(p.x, p.z) - floor;
  })();
  if (gFront < -0.05) {
    const len = Math.hypot(3.5, -gFront);
    const ang = Math.atan2(-gFront, 3.5);
    b.add('concrete', GEO.wedge, f.mat(0, gFront - 0.02, d / 2 + 1.75, door + 1, -gFront + 0.02, 3.5), 0xc9ccd0);
    f.collider(game, 0, gFront / 2 - 0.15, d / 2 + 1.75, door + 1, 0.3, len, 0, ang, 0);
  }
  // interior: rows of server racks with LED strips, cold-aisle tiles, ceiling light panels
  const rowsZ = [-7, -3.2, 1.2, 5];
  const rackW = 0.9,
    rackH = 2.4,
    rackD = 1.2;
  const leds = new Batch(1e9);
  for (const rz of rowsZ) {
    for (let i = 0; i < 16; i++) {
      const lx = -10.2 + i * (rackW + 0.12) + (i >= 8 ? 5 : 0);
      f.box(b, 'metal', lx, rackH / 2, rz, rackW, rackH, rackD, 0x1f252c);
      for (let k = 0; k < 7; k++) {
        const on = Math.random();
        leds.add('l', GEO.box, trs(lx - 0.25 + ((k * 7) % 5) * 0.12, 0.35 + k * 0.29, rz + rackD / 2 + 0.01, 0.06, 0.04, 0.02), on < 0.6 ? 0x39e6ff : on < 0.85 ? 0x3a7bff : 0x5cff7d, { uvTile: 0 });
        leds.add('l', GEO.box, trs(lx + 0.2, 0.35 + k * 0.29, rz - rackD / 2 - 0.01, 0.3, 0.02, 0.02), 0x39e6ff, { uvTile: 0 });
      }
    }
    f.collider(game, -10.2 + 3.5 * (rackW + 0.12), rackH / 2, rz, 8 * (rackW + 0.12), rackH, rackD);
    f.collider(game, -10.2 + 11.5 * (rackW + 0.12) + 5, rackH / 2, rz, 8 * (rackW + 0.12), rackH, rackD);
  }
  const ledMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.4 });
  const ledMesh = leds.buildSingle(ledMat);
  ledMesh.castShadow = false;
  const lp = f.p(0, 0, 0);
  ledMesh.position.copy(lp);
  world.staticRoot.add(ledMesh);
  // emissive only works through the emissive color, not vertex colours: tint via a shader hook
  ledMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;');
  };
  for (let i = 0; i < 6; i++) f.box(b, 'glow', -w / 2 + 4 + i * 6.4, h - 0.1, 0, 3.2, 0.06, 1.2, 0xeaf6ff);
  // cold-aisle floor tiles
  for (const rz of [-5.1, -1, 3.1]) f.box(b, 'paint', 0, 0.05, rz, w - 4, 0.02, 1.8, 0x9fb3c4);
  // big wall signs
  const sign = canvasTexture(1536, 256, (ctx, ww, hh) => {
    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, 0, ww, hh);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7df9ff';
    fitText(ctx, 'SLOPCORP DATA CENTER 7', ww / 2, hh * 0.38, ww - 80, 110, "'Lilita One', sans-serif");
    ctx.fillStyle = '#ff7df0';
    fitText(ctx, '● TRAINING RUN IN PROGRESS — DO NOT UNPLUG ●', ww / 2, hh * 0.78, ww - 120, 52, "'Nunito', sans-serif", '900');
  });
  const sp = f.p(0, h - 2.2, d / 2 + 0.3);
  signPanel(world, sign, sp.x, sp.y, sp.z, 13, 2.2, 0, { back: 0x10131a, depth: 0.1, collide: false, lit: true, emissive: 0.3, game, batch: b });
  const inside = canvasTexture(1024, 384, (ctx, ww, hh) => {
    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(0, 0, ww, hh);
    ctx.fillStyle = '#10131a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'THIS FACILITY GENERATES', ww / 2, hh * 0.25, ww - 60, 64, "'Lilita One', sans-serif");
    fitText(ctx, '1,000,000 RACCOON PICTURES', ww / 2, hh * 0.5, ww - 60, 70, "'Lilita One', sans-serif");
    ctx.fillStyle = '#c0306b';
    fitText(ctx, 'PER HOUR · 3 OF THEM HAVE THE RIGHT NUMBER OF LEGS', ww / 2, hh * 0.78, ww - 60, 34, "'Nunito', sans-serif", '900');
  });
  const ip = f.p(0, 4.2, -d / 2 + T + 0.08);
  signPanel(world, inside, ip.x, ip.y, ip.z, 8, 3, 0, { back: 0xf4f6f8, depth: 0.04, collide: false, batch: b });
  // LED shimmer (cheap: pulse the emissive intensity)
  addAnimator(game, (_dt, t) => {
    ledMat.emissiveIntensity = 1.3 + Math.sin(t * 7.3) * 0.25 + Math.sin(t * 13.1) * 0.15;
  });
  return { floor };
}

function coolingTowers(game: Game, world: World, b: Batch, x: number, zc: number) {
  // hyperboloid-ish lathe towers with spinning fans on top + steam
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(3.2 - Math.sin(t * Math.PI) * 0.9 - t * 0.4, t * 9));
  }
  const lathe = new THREE.LatheGeometry(pts, 20);
  let topPos = new THREE.Vector3();
  const fans: THREE.Mesh[] = [];
  const fanGeo = new THREE.BoxGeometry(4.6, 0.08, 0.5);
  const fanMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.5, metalness: 0.6 });
  const steam = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 1, depthWrite: false });
  const puffs: { m: THREE.Mesh; base: THREE.Vector3; ph: number }[] = [];
  [-9, 0, 9].forEach((dz, i) => {
    const z = zc + dz;
    const g = Math.min(world.heightAt(x - 3, z), world.heightAt(x + 3, z)) - 0.3;
    b.add('concrete', lathe, trs(x, g, z), 0xdfe3e7, { uvTile: 0 });
    colliderCyl(game, x, g + 4.5, z, 2.9, 9);
    // fan deck + grille + a spinning fan
    b.add('metal', GEO.cyl, trs(x, g + 9.05, z, 5.0, 0.1, 5.0), 0x5b636b);
    colliderCyl(game, x, g + 9.05, z, 2.5, 0.1);
    b.add('metal', GEO.cyl8, trs(x, g + 9.55, z, 0.45, 0.9, 0.45), 0x3a4048);
    const fan = new THREE.Mesh(fanGeo, fanMat);
    fan.position.set(x, g + 10.05, z);
    fan.castShadow = true;
    fan.userData.noMerge = true;
    world.staticRoot.add(fan);
    const fan2 = fan.clone();
    fan2.rotation.y = Math.PI / 2;
    fan.add(fan2);
    fan2.position.set(0, 0, 0);
    fans.push(fan);
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(GEO.ico, steam);
      m.castShadow = false;
      m.userData.noMerge = true;
      world.staticRoot.add(m);
      puffs.push({ m, base: new THREE.Vector3(x, g + 9.4, z), ph: k / 3 + i * 0.17 });
    }
    if (i === 1) topPos = new THREE.Vector3(x + 1.6, g + 9.1, z);
  });
  const center = new THREE.Vector3(x, 0, zc);
  addAnimator(game, (dt, t, _n, gm) => {
    const p = gm.get<any>('player');
    if (p && Math.hypot(p.position.x - center.x, p.position.z - center.z) > 140) return;
    for (const f of fans) f.rotation.y += dt * 6;
    for (const pf of puffs) {
      const k = (t * 0.18 + pf.ph) % 1;
      pf.m.position.set(pf.base.x + k * 2.5, pf.base.y + k * 6, pf.base.z + Math.sin(t + pf.ph * 6) * 0.5);
      pf.m.scale.setScalar(1.5 + k * 3.5);
      (pf.m.material as THREE.MeshStandardMaterial).opacity = 0.35;
      pf.m.visible = k < 0.95;
    }
  });
  return topPos;
}

function coolantTank(game: Game, world: World, b: Batch, water: WaterSystem, x: number, z: number, R: number) {
  const fp = footprintCircle(world, x, z, R + 0.8);
  const floorY = fp.max + 0.1;
  const rimTop = floorY + 1.5;
  const segs = 26;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const len = ((2 * Math.PI * (R + 0.35)) / segs) * 1.08;
    const px = x + Math.cos(a) * (R + 0.35),
      pz = z + Math.sin(a) * (R + 0.35);
    b.box('concrete', px, (fp.min - 0.4 + rimTop) / 2, pz, 0.7, rimTop - fp.min + 0.4, len, 0xc9ccd0, -a);
    b.box('glow', px, rimTop + 0.05, pz, 0.74, 0.08, len + 0.02, 0x39e6ff, -a);
  }
  colliderRing(game, x, (fp.min - 0.4 + rimTop) / 2, z, R + 0.35, rimTop - fp.min + 0.4, 0.7, 22);
  b.add('tile', GEO.cyl, trs(x, floorY - 0.05, z, R * 2, 0.1, R * 2), 0x2d6f86);
  colliderCyl(game, x, floorY - 0.05, z, R, 0.1);
  water.addCircle({ name: 'Server Coolant', kind: 'server-coolant', center: new THREE.Vector3(x, rimTop - 0.25, z), radius: R, depth: 1.3 });
  // a ladder/steps up the rim on the side facing the plug site
  const a = Math.atan2(PLUG.z - z, PLUG.x - x);
  const lx = x + Math.cos(a) * (R + 1.4),
    lz = z + Math.sin(a) * (R + 1.4);
  const g = world.heightAt(lx, lz);
  const rise = rimTop - g;
  const n = Math.max(2, Math.ceil(rise / 0.2));
  for (let i = 0; i < n - 1; i++) {
    const t = rimTop - (i + 1) * (rise / n);
    const d = R + 0.7 + (i + 0.5) * (2.2 / n);
    b.box('metal', x + Math.cos(a) * d, (t + g - 0.2) / 2, z + Math.sin(a) * d, 2.2 / n + 0.02, t - g + 0.2, 1.4, 0x9aa3ad, -a);
  }
  colliderBox(game, x + Math.cos(a) * (R + 1.8), (rimTop + g) / 2 - 0.12, z + Math.sin(a) * (R + 1.8), 1.4, 0.24, Math.hypot(2.2, rise), Math.PI / 2 - a, Math.atan2(rise, 2.2));
  // pipes to the data center
  const pipeTo = new THREE.Vector3(DC.x + DC.w / 2, 0, DC.z - 4);
  const p0 = new THREE.Vector3(x - R - 0.4, rimTop - 0.6, z);
  const p1 = new THREE.Vector3(pipeTo.x + 0.4, world.heightAt(pipeTo.x, pipeTo.z) + 1.5, pipeTo.z);
  const mid = p0.clone().lerp(p1, 0.5);
  mid.y = Math.max(p0.y, p1.y) + 1.5;
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p0, mid, p1]), 24, 0.35, 10);
  b.add('metal', tube, null, 0x7c8792, { uvTile: 0 });
  // the joke sign
  const tex = canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#f4f6f8';
    roundRect(ctx, 0, 0, w, h, 24);
    ctx.fill();
    ctx.fillStyle = '#10131a';
    roundRect(ctx, 0, 0, w, 110, 24);
    ctx.fill();
    ctx.fillRect(0, 60, w, 50);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7df9ff';
    fitText(ctx, 'FUN FACT!', w / 2, 58, w - 80, 70, "'Lilita One', sans-serif");
    ctx.fillStyle = '#10131a';
    const lines = ['This data center uses', '5 MILLION GALLONS', 'of water a day to generate', 'pictures of raccoons.'];
    lines.forEach((l, i) => fitText(ctx, l, w / 2, 170 + i * 78, w - 90, i === 1 ? 84 : 58, "'Lilita One', sans-serif"));
    ctx.fillStyle = '#c0306b';
    fitText(ctx, '(please do not drink the coolant)', w / 2, h - 30, w - 200, 30, "'Nunito', sans-serif", 'italic 800');
  });
  const sa = a + 0.9;
  const sx = x + Math.cos(sa) * (R + 2.2),
    sz = z + Math.sin(sa) * (R + 2.2);
  const sy = world.heightAt(sx, sz);
  const yaw = Math.atan2(Math.cos(sa), Math.sin(sa));
  signPanel(world, tex, sx, sy + 1.9, sz, 2.8, 1.4, yaw, { back: 0xf4f6f8, depth: 0.06, batch: b });
  for (const s of [-1, 1]) b.add('metal', GEO.cyl8, trs(sx + Math.cos(yaw) * s * 1.2, sy + 0.6, sz - Math.sin(yaw) * s * 1.2, 0.08, 1.2, 0.08), 0x6f7780);
}

/** A comically huge power cord from the data center wall to the plug site. */
function giantCord(world: World, from: THREE.Vector3, plug: { x: number; z: number }, dc: THREE.Vector3) {
  // aim at the slop system's junction box (next to the socket, on its right-hand side facing away from the DC)
  const face = new THREE.Vector3(plug.x - dc.x, 0, plug.z - dc.z).normalize();
  const yaw = Math.atan2(face.x, face.z);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const end = new THREE.Vector3(plug.x, 0, plug.z).addScaledVector(right, 2.6).addScaledVector(face, 0.2);
  end.y = world.heightAt(end.x, end.z) + 0.35;
  // route around the transformer block (it extends ~3.8 m from the socket back toward the data center)
  const way = (r: number, f: number) => {
    const p = new THREE.Vector3(plug.x, 0, plug.z).addScaledVector(right, r).addScaledVector(face, f);
    p.y = world.heightAt(p.x, p.z) + 0.42;
    return p;
  };
  const mid0 = from.clone().lerp(way(7, -6), 0.5);
  mid0.x += 1.5;
  mid0.y = world.heightAt(mid0.x, mid0.z) + 0.42;
  const pts: THREE.Vector3[] = [from.clone(), mid0, way(7, -6), way(5, -1.5), end];
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.42, 12);
  const m = new THREE.Mesh(tube, world.material(0x1c1f24, { roughness: 0.55 }));
  m.castShadow = true;
  m.receiveShadow = true;
  world.staticRoot.add(m);
  // the cord is a low obstacle you can hop onto
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      c = pts[i + 1];
    const len = a.distanceTo(c);
    const mid = a.clone().lerp(c, 0.5);
    const ry = Math.atan2(c.x - a.x, c.z - a.z);
    world.collider(mid, new THREE.Vector3(0.7, 0.7, len), ry);
  }
}

function securityFence(game: Game, world: World, b: Batch) {
  // chain-link-ish fence along the south of the data center compound (gap in front of the door)
  const z = DC.z + DC.d / 2 + 13;
  const segs: [number, number][] = [
    [DC.x - DC.w / 2 - 12, DC.x - 5],
    [DC.x + 5, DC.x + DC.w / 2 + 4],
  ];
  for (const [x0, x1] of segs) {
    for (let x = x0; x < x1 - 0.1; x += 3) {
      const xe = Math.min(x1, x + 3);
      const g0 = world.heightAt(x, z),
        g1 = world.heightAt(xe, z);
      const gy = Math.min(g0, g1);
      b.add('metal', GEO.cyl8, trs(x, gy + 1.1, z, 0.08, 2.2, 0.08), 0x8a929a);
      b.box('lattice', (x + xe) / 2, gy + 1.05, z, xe - x, 2.0, 0.03, 0xaab2ba);
      b.box('metal', (x + xe) / 2, gy + 2.15, z, xe - x, 0.05, 0.05, 0x8a929a);
      world.collider(new THREE.Vector3((x + xe) / 2, gy + 1.1, z), new THREE.Vector3(xe - x, 2.2, 0.1));
    }
  }
  const tex = canvasTexture(768, 384, (ctx, w, h) => {
    ctx.fillStyle = '#ffd23a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#10131a';
    ctx.fillRect(12, 12, w - 24, h - 24);
    ctx.fillStyle = '#ffd23a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'RESTRICTED AREA', w / 2, h * 0.28, w - 80, 70, "'Lilita One', sans-serif");
    ctx.fillStyle = '#ffffff';
    fitText(ctx, 'Authorized Prompt Engineers Only', w / 2, h * 0.55, w - 80, 44, "'Nunito', sans-serif", '900');
    fitText(ctx, 'raccoons: absolutely not (come in)', w / 2, h * 0.78, w - 110, 34, "'Nunito', sans-serif", 'italic 800');
  });
  const sx = DC.x + 7,
    sy = world.heightAt(sx, z);
  signPanel(world, tex, sx, sy + 1.3, z + 0.1, 1.6, 0.8, 0, { back: 0x10131a, depth: 0.04, collide: false, batch: b });
}

/** "AI-generated trees": too-perfect cubes and spheres in neon colours on chrome trunks. */
function aiTrees(game: Game, world: World, b: Batch, list: [number, number][]) {
  const cols = [0xff7df0, 0x7df9ff, 0xc77dff, 0x9dff7d, 0xffd23a];
  list.forEach(([x, z], i) => {
    const y = world.heightAt(x, z);
    b.add('metal', GEO.cyl8, trs(x, y + 1.6, z, 0.36, 3.2, 0.36), 0xdfe6ec);
    const c = cols[i % cols.length];
    if (i % 2) b.add('gloss', GEO.box, trs(x, y + 4.4, z, 3.2, 3.2, 3.2, 0.6, 0.6, 0.3), c);
    else b.add('gloss', GEO.sphere, trs(x, y + 4.4, z, 3.6, 3.6, 3.6), c);
    b.add('gloss', GEO.cone, trs(x + 1.3, y + 3.2, z, 0.8, 1.2, 0.8, 0, 0, 2.2), c); // an extra branch, for realism
    world.collider(new THREE.Vector3(x, y + 1.6, z), new THREE.Vector3(0.5, 3.2, 0.5));
  });
}
