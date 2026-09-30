import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { World, ZoneBuilder } from '../../World';
import { profileColliders } from '../../profileColliders';
import { drawJimothy } from '../../../fx/jimothyArt';
import { getKit, Batch, tree, bench, rng, canvasTex, fitText, roundRect, FONT_TITLE, FONT_ROUND, FONT_BODY, GEO, bake, type Kit, type V3 } from './kit';
import { lamps } from './decor';
import { addNightRig, multiplyPoolMaterial } from './nightLight';
import { seawall } from './Locks';
import * as P from './props';

/**
 * SE zone — "Tee-Hee Park", home of the Ballard Barnacles, on JIMOTHY NIGHT: a compact ballpark (~52 m lines,
 * 63 m to centre) with a mowed outfield, infield dirt, foul poles, padded outfield wall with parody ads,
 * tiered stands (seats are ONE instanced mesh), dugouts (the gold rookie card hides in one), a big scoreboard,
 * the Salmon Run path along the warning track (start/finish arches + waypoints for the SalmonRun event),
 * light towers that blaze at night, concessions and a giant wobbling Jimothy bobblehead outside the gate.
 */

const AREA = 'Tee-Hee Park';
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const S2 = Math.SQRT1_2;

const H = { x: 122, z: 142 }; // home plate
const FOUL = 52; // foul line length
const CF = 63; // home → centre-field fence
const D3 = { x: -S2, z: -S2 }; // along the 3B line
const N3 = { x: -S2, z: S2 }; // outward (foul side) of the 3B line
const D1 = { x: S2, z: -S2 };
const N1 = { x: S2, z: S2 };
const at = (t: number, d: { x: number; z: number }, s = 0, n?: { x: number; z: number }): [number, number] => [H.x + d.x * t + (n ? n.x * s : 0), H.z + d.z * t + (n ? n.z * s : 0)];

// Outfield fence circle through both foul poles and the CF point
const POLE_L = at(FOUL, D3);
const POLE_R = at(FOUL, D1);
const zCF = H.z - CF;
const zPole = POLE_L[1];
const FC = { x: H.x, z: (zCF * zCF - zPole * zPole - (FOUL * S2) ** 2) / (2 * (zCF - zPole)) };
const FR = FC.z - zCF;
const A_L = Math.atan2(zPole - FC.z, POLE_L[0] - FC.x); // ≈ -161°
const A_R = Math.atan2(zPole - FC.z, POLE_R[0] - FC.x); // ≈ -19°
const TRACK = 3.6;
const onArc = (a: number, r: number): [number, number] => [FC.x + Math.cos(a) * r, FC.z + Math.sin(a) * r];

const MOUND = { x: H.x, z: H.z - 11.2 };
const BASE = 17;

const TEAL = 0x0f8a93;
const NAVY = 0x1d3557;
const WALL_GREEN = 0x1f5f46;

export const StadiumZone: ZoneBuilder = {
  name: AREA,
  async build(game: Game, world: World) {
    const kit = await getKit(game, world);
    const b = new Batch(kit, 'stadium');
    world.areas.push({ name: AREA, min: new THREE.Vector2(66, 66), max: new THREE.Vector2(180, 166) });

    field(kit, b);
    outfieldWall(kit, b);
    salmonRun(kit, b);
    const seats: Seat[] = [];
    stands(kit, b, seats);
    bleachers(kit, b, seats);
    seatMesh(kit, seats);
    dugouts(kit, b);
    scoreboard(kit, b);
    lightTowers(kit, b);
    plaza(kit, b);
    await giantBobblehead(kit, b, 86, 155);
    seawall(kit, b, 66.5, 180);

    world.poi.set('stadiumCenter', V(FC.x, 0, FC.z));
    world.poi.set('pitchersMound', V(MOUND.x, 0.3, MOUND.z));
    world.poi.set('homePlate', V(H.x, 0.1, H.z));
    world.poi.set('teeHeePark', V(92, 0.2, 154));

    const [sx, sz] = onArc(A_L + 0.07, FR - TRACK / 2);
    world.npcSpawns.push(
      { zone: AREA, center: V(92, 0, 154), radius: 9, count: 6, types: ['fan', 'fan', 'pedestrian'] },
      { zone: AREA, center: V(153, 0, 152), radius: 6, count: 4, types: ['fan'] },
      { zone: AREA, center: V(122, 0, 106), radius: 12, count: 3, types: ['fan'] },
      { zone: AREA, center: V(sx, 0, sz), radius: 2.5, count: 3, types: ['racer'] },
    );
    kit.state.ambience.push({ pos: V(122, 3, 125), key: 'crowd_cheer', radius: 70, every: 14, next: 6, volume: 0.35 });
    b.flush();
  },
};

// ------------------------------------------------------------------ the field

function stripeTexture() {
  return canvasTex(
    256,
    256,
    (ctx, w, h) => {
      const c = ['#5fae45', '#4f9c3a'];
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = c[(i + j) % 2];
          ctx.fillRect((i * w) / 2, (j * h) / 2, w / 2, h / 2);
        }
      const r = rng(5);
      for (let k = 0; k < 2500; k++) {
        ctx.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,40,0'},${0.03 + r() * 0.05})`;
        ctx.fillRect(r() * w, r() * h, 2, 2 + r() * 4);
      }
    },
    true,
  );
}

/** Flat fan mesh (ground decal) from a centre point through boundary points. */
function fan(center: [number, number], boundary: [number, number][], y: number, uvFn?: (x: number, z: number) => [number, number]) {
  const pos: number[] = [center[0], y, center[1]];
  const uv: number[] = uvFn ? uvFn(center[0], center[1]) : [0, 0];
  for (const [x, z] of boundary) {
    pos.push(x, y, z);
    uv.push(...(uvFn ? uvFn(x, z) : [0, 0]));
  }
  const idx: number[] = [];
  for (let i = 1; i < boundary.length; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if ((g.attributes.normal as THREE.BufferAttribute).getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

function field(kit: Kit, b: Batch) {
  // mowed grass over the whole playing area (fair + foul up to the stands)
  const P0 = at(46, D3, 9, N3);
  const P1 = at(8, D3, 9, N3);
  const P2: [number, number] = [H.x - 6.5, H.z + 11.5];
  const P3: [number, number] = [H.x + 6.5, H.z + 11.5];
  const P4 = at(8, D1, 9, N1);
  const P5 = at(46, D1, 9, N1);
  const outline: [number, number][] = [POLE_R, P5, P4, P3, P2, P1, P0, POLE_L];
  const arc: [number, number][] = [];
  for (let i = 0; i <= 40; i++) arc.push(onArc(A_L + ((A_R - A_L) * i) / 40, FR));
  const boundary = [...outline.slice(0, 7), POLE_L, ...arc];
  const ang = Math.PI / 4;
  const tile = 12;
  const uvFn = (x: number, z: number): [number, number] => [(x * Math.cos(ang) - z * Math.sin(ang)) / tile, (x * Math.sin(ang) + z * Math.cos(ang)) / tile];
  const grassGeo = fan([H.x, H.z - 20], [...boundary, boundary[0]], 0.035, uvFn);
  const grass = new THREE.Mesh(grassGeo, new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.92 }));
  grass.receiveShadow = true;
  kit.root.add(grass);

  // warning track (dirt band inside the fence)
  const DIRT = 0xe0935c;
  b.patch(FC.x, FC.z, FR, FR, 0xc98552, { mat: 'sand', a0: A_L - 0.02, a1: A_R + 0.02, r0: (FR - TRACK) / FR, rings: 1, seg: 44, lift: 0.05 });
  // infield dirt: disc around the mound clipped to (slightly beyond) the foul lines
  const dirt: [number, number][] = [];
  const R = 17.9;
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    let t = R;
    for (const n of [N3, N1]) {
      const nu = n.x * ux + n.z * uz;
      const nm = n.x * (MOUND.x - H.x) + n.z * (MOUND.z - H.z);
      if (nu > 1e-4) t = Math.min(t, (1.4 - nm) / nu);
    }
    dirt.push([MOUND.x + ux * t, MOUND.z + uz * t]);
  }
  b.add(fan([MOUND.x, MOUND.z], dirt, 0.05), new THREE.Matrix4(), DIRT, { mat: 'sand', shadow: false });
  // infield grass diamond
  const D = { x: H.x, z: H.z - (BASE * Math.SQRT2) / 2 };
  const hd = (BASE * Math.SQRT2) / 2 - 2.5;
  b.add(
    fan(
      [D.x, D.z],
      [
        [D.x, D.z - hd],
        [D.x + hd, D.z],
        [D.x, D.z + hd],
        [D.x - hd, D.z],
        [D.x, D.z - hd],
      ],
      0.065,
    ),
    new THREE.Matrix4(),
    0x5aa841,
    { mat: 'grass', shadow: false },
  );
  // home circle, base cutouts, mound
  // (floor pass: dirt circles lowered so their top sits ~flush at 7.5 cm instead of 11.5 cm over the solid ground)
  b.disc([H.x, 0.035, H.z], 4.2, DIRT, { mat: 'sand', seg: 32 });
  const bases: [number, number][] = [at(BASE, D1), [H.x, H.z - BASE * Math.SQRT2], at(BASE, D3)];
  for (const [x, z] of bases) {
    b.disc([x, 0.035, z], 1.5, DIRT, { mat: 'sand', seg: 20 });
    b.box([x, 0.1, z], [0.42, 0.1, 0.42], 0xffffff, { rotY: Math.PI / 4, collide: false });
  }
  b.cyl([MOUND.x, 0.13, MOUND.z], 2.2, 0.26, DIRT, { rTop: 1.4, seg: 24, mat: 'sand', collide: false });
  {
    // polish: the mound was visual-only (Jimothy sank 26 cm into it, the resting baseball dropped through); a convex
    // frustum hull gives it a smooth ramp instead of a step
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push(MOUND.x + Math.cos(a) * 2.2, 0, MOUND.z + Math.sin(a) * 2.2, MOUND.x + Math.cos(a) * 1.4, 0.26, MOUND.z + Math.sin(a) * 1.4);
    }
    kit.hullCollider(pts);
  }
  b.box([MOUND.x, 0.27, MOUND.z], [0.6, 0.04, 0.15], 0xffffff, { collide: false, shadow: false });
  // home plate + chalk: batter's boxes and foul lines
  const hp = new THREE.Shape([new THREE.Vector2(-0.22, 0), new THREE.Vector2(0.22, 0), new THREE.Vector2(0.22, 0.22), new THREE.Vector2(0, 0.44), new THREE.Vector2(-0.22, 0.22)]);
  b.geo(new THREE.ExtrudeGeometry(hp, { depth: 0.03, bevelEnabled: false }), [H.x, 0.1, H.z + 0.22], [Math.PI / 2, 0, 0], 1, 0xffffff, { shadow: false });
  const chalk = (x0: number, z0: number, x1: number, z1: number, w = 0.12) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    b.box([(x0 + x1) / 2, 0.09, (z0 + z1) / 2], [w, 0.02, L], 0xffffff, { rotY: Math.atan2(x1 - x0, z1 - z0), collide: false, shadow: false });
  };
  chalk(H.x, H.z, POLE_L[0], POLE_L[1]);
  chalk(H.x, H.z, POLE_R[0], POLE_R[1]);
  for (const s of [-1, 1]) {
    const bx = H.x + s * 0.95;
    chalk(bx - 0.5, H.z - 0.9, bx - 0.5, H.z + 0.9);
    chalk(bx + 0.5, H.z - 0.9, bx + 0.5, H.z + 0.9);
    chalk(bx - 0.5, H.z - 0.9, bx + 0.5, H.z - 0.9);
    chalk(bx - 0.5, H.z + 0.9, bx + 0.5, H.z + 0.9);
  }
  // backstop net behind home
  const bs = H.z + 10.5;
  // two panels with a gap for the Gate H tunnel behind home (one 18 m net used to seal the entrance off)
  const gap = 2.5;
  for (const x of [-9, -gap, gap, 9]) b.cyl([H.x + x, 3.5, bs], 0.12, 7, 0x2a2f38, { seg: 8, collide: true, mat: 'metal' });
  b.box([H.x, 7, bs], [18.3, 0.2, 0.2], 0x2a2f38, { collide: false, mat: 'metal' });
  const panelW = 9 - gap;
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(panelW, 6.6),
    new THREE.MeshStandardMaterial({
      map: canvasTex(
        128,
        128,
        (ctx) => {
          ctx.clearRect(0, 0, 128, 128);
          ctx.strokeStyle = 'rgba(30,30,30,0.9)';
          ctx.lineWidth = 3;
          for (let i = 0; i <= 128; i += 16) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, 128);
            ctx.moveTo(0, i);
            ctx.lineTo(128, i);
            ctx.stroke();
          }
        },
        true,
      ),
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
      roughness: 0.8,
    }),
  );
  ((net.material as THREE.MeshStandardMaterial).map as THREE.Texture).repeat.set(panelW, 6.6);
  for (const sgn of [-1, 1]) {
    const cx = H.x + sgn * (gap + panelW / 2);
    const panel = sgn < 0 ? net : net.clone();
    panel.position.set(cx, 3.7, bs);
    kit.root.add(panel);
    kit.collider([cx, 3.5, bs], [panelW, 7, 0.2]);
  }
  // a few baseballs lying around (grabbable)
  P.baseball(kit.game, H.x + 1.2, 0.1, H.z - 1.5);
  P.baseball(kit.game, MOUND.x + 0.6, 0.3, MOUND.z);
  P.baseball(kit.game, H.x - 14, 0.05, H.z - 30);
}

// ------------------------------------------------------------------ outfield wall, foul poles, ads

const ADS: [string, string, string, string][] = [
  ['GOODWHEEL THRIFT', 'Pre-loved. Pre-washed (by a raccoon).', '#1f6fb2', '#ffffff'],
  ['BEAN ME UP COFFEE', 'Beam me up a latte', '#6b3e26', '#ffe9c7'],
  ['SLOPCORP', 'This ad was written by AI. Sorry.', '#7b2ff7', '#e9ffea'],
  ['STARBREWS', 'Brewed under the stars. Mostly.', '#0f6b3e', '#ffffff'],
  ['JIMOTHY SUMMER', 'Officially declared. Very round.', '#ff8c1a', '#fff8e1'],
  ['UNIVERSITY OF WASHING', 'Go Huskies! (Go Raccoons!)', '#4b2e83', '#ffd35a'],
  ['PIKE’S PLAICE', 'Fish fly. Prices don’t.', '#d64b3a', '#fff4e6'],
  ['BALLARD BARNACLES', 'Stuck on winning since 1907', '#0f8a93', '#ffffff'],
];

function outfieldWall(kit: Kit, b: Batch) {
  const n = 30;
  const Rw = FR + 0.4;
  const Hw = 3.2;
  for (let i = 0; i < n; i++) {
    const a0 = A_L + ((A_R - A_L) * i) / n;
    const a1 = A_L + ((A_R - A_L) * (i + 1)) / n;
    const am = (a0 + a1) / 2;
    const [x, z] = onArc(am, Rw);
    const len = 2 * Rw * Math.sin((a1 - a0) / 2) + 0.12;
    const rotY = -am + Math.PI / 2; // local x tangent
    b.box([x, Hw / 2, z], [len, Hw, 0.6], WALL_GREEN, { rotY });
    const [tx, tz] = onArc(am, Rw);
    b.box([tx, Hw + 0.06, tz], [len, 0.12, 0.66], 0xffd23a, { rotY }); // floor pass: solid cap (was 12 cm walk-in)
  }
  // ads facing home plate
  ADS.forEach(([t1, t2, bg, fg], i) => {
    // (kept ≥ 9 m of arc from the foul poles, which used to stand in front of the end ads' lettering)
    const margin = 9 / Rw;
    const am = Math.min(A_R - margin, Math.max(A_L + margin, A_L + ((A_R - A_L) * (i + 0.5 + i * 0.35)) / (ADS.length + ADS.length * 0.35)));
    // far enough off the faceted wall that the flat ad's ends are not buried in the neighbouring wall segments
    const [x, z] = onArc(am, Rw - 0.45);
    const tex = kit.textSign([{ text: t1, px: 70, color: fg, stroke: 'rgba(0,0,0,0.35)' }, { text: t2, px: 30, color: fg, font: FONT_ROUND }], { w: 5.2, h: 1.6, bg, pxPerM: 110 });
    kit.sign(b, { pos: [x, 1.7, z], rotY: -am - Math.PI / 2, w: 5.2, h: 1.6, tex, depth: 0.02, collide: false, back: false });
  });
  // foul poles with netting wings
  for (const [px, pz, side] of [
    [POLE_L[0], POLE_L[1], -1],
    [POLE_R[0], POLE_R[1], 1],
  ]) {
    const [ox, oz] = [px + (side < 0 ? -0.6 : 0.6), pz - 0.6];
    b.cyl([ox, 8, oz], 0.2, 16, 0xffd23a, { seg: 10, collide: true, mat: 'glossy' });
    const wing = side < 0 ? 0.6 : -0.6;
    b.box([ox + wing, 10, oz + 0.5], [1.2, 10, 0.05], 0xffd23a, { collide: false, shadow: false, mat: 'glossy' });
  }
}

// ------------------------------------------------------------------ the Salmon Run (warning track race)

function banner(kit: Kit, b: Batch, a: number, title: string, sub: string, checker: boolean) {
  const [ix, iz] = onArc(a, FR - TRACK - 0.3);
  const [ox, oz] = onArc(a, FR - 0.2);
  const top = 4.6;
  for (const [x, z] of [
    [ix, iz],
    [ox, oz],
  ])
    b.cyl([x, top / 2, z], 0.14, top, 0xff6f61, { seg: 8, collide: true, mat: 'glossy' });
  const cx = (ix + ox) / 2;
  const cz = (iz + oz) / 2;
  // hangs between the two posts (it used to overlap them, so they ran through its face); canvas matches its aspect
  const w = Math.hypot(ox - ix, oz - iz) - 0.3;
  const tex = canvasTex(Math.round((256 * w) / 1.2), 256, (ctx, W, Hh) => {
    if (checker) {
      for (let i = 0; i < 32; i++)
        for (let j = 0; j < 8; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
          ctx.fillRect((i * W) / 32, (j * Hh) / 8, W / 32 + 1, Hh / 8 + 1);
        }
      ctx.fillStyle = 'rgba(255,111,97,0.85)';
      roundRect(ctx, 60, 40, W - 120, Hh - 80, 30);
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, '#ff6f61');
      g.addColorStop(1, '#ff9a76');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, Hh);
    }
    fitText(ctx, title, W / 2, Hh * 0.42, W * 0.8, 110, FONT_TITLE, { fill: '#fff', stroke: '#7a1f1a', strokeW: 10 });
    fitText(ctx, sub, W / 2, Hh * 0.78, W * 0.8, 40, FONT_ROUND, { fill: '#fff8f0' });
  });
  const rotY = -a + Math.PI / 2 + Math.PI / 2;
  kit.sign(b, { pos: [cx, top - 0.6, cz], rotY, w, h: 1.2, tex, depth: 0.05, collide: false });
}

function salmonRun(kit: Kit, b: Batch) {
  const a0 = A_L + 0.06;
  const a1 = A_R - 0.06;
  const rMid = FR - TRACK / 2;
  // salmon-pink lane dashes
  for (let i = 0; i < 60; i++) {
    if (i % 2) continue;
    const a = a0 + ((a1 - a0) * i) / 60;
    const aa = a0 + ((a1 - a0) * (i + 1)) / 60;
    const [x0, z0] = onArc(a, rMid);
    const [x1, z1] = onArc(aa, rMid);
    b.box([(x0 + x1) / 2, 0.075, (z0 + z1) / 2], [0.18, 0.02, Math.hypot(x1 - x0, z1 - z0)], 0xff8f7a, { rotY: Math.atan2(x1 - x0, z1 - z0), collide: false, shadow: false });
  }
  banner(kit, b, a0 - 0.012, 'SALMON RUN · START', 'Swim upstream. Or run. Or roll.', false);
  banner(kit, b, a1 + 0.012, 'FINISH', 'Salmon Run · Jimothy Night', true);
  const [sx, sz] = onArc(a0 + 0.025, rMid);
  const [fx, fz] = onArc(a1 - 0.025, rMid);
  kit.world.poi.set('salmonRunStart', V(sx, 0.1, sz));
  kit.world.poi.set('salmonRunFinish', V(fx, 0.1, fz));
  const n = 14;
  for (let i = 1; i < n; i++) {
    const [x, z] = onArc(a0 + 0.025 + ((a1 - a0 - 0.05) * i) / n, rMid);
    kit.world.poi.set(`salmonRun${i}`, V(x, 0.1, z));
  }
}

// ------------------------------------------------------------------ stands (tiers + instanced seats)

interface Seat {
  x: number;
  y: number;
  z: number;
  rotY: number;
  color: number;
}

const ROWS = 10;
const ROW_D = 0.95;
const ROW_H = 0.45;

/** A straight section of tiered stands whose FRONT edge runs from a to c; rows go back along `back`. */
/** Stadium light-tower masts (outside the stands and beyond the outfield). */
function lightTowerSpots(): [number, number][] {
  return [at(22, D3, 21, N3), at(42, D3, 21, N3), at(22, D1, 21, N1), at(42, D1, 21, N1), onArc(A_L + 0.45, FR + 13), onArc(A_R - 0.45, FR + 13)];
}

function section(kit: Kit, b: Batch, seats: Seat[], a: [number, number], c: [number, number], back: { x: number; z: number }, rows = ROWS, o: { wall?: boolean; accent?: number; banners?: boolean } = {}) {
  const dx = c[0] - a[0];
  const dz = c[1] - a[1];
  const L = Math.hypot(dx, dz);
  const ux = dx / L;
  const uz = dz / L;
  const boxRot = Math.atan2(-uz, ux); // box local x along the section
  const faceY = Math.atan2(-back.x, -back.z); // seats face the field
  const mx = (a[0] + c[0]) / 2;
  const mz = (a[1] + c[1]) / 2;
  const concrete = 0xcfcac0;
  for (let k = 0; k < rows; k++) {
    const d = (k + 0.5) * ROW_D;
    const top = ROW_H * (k + 1);
    const x = mx + back.x * d;
    const z = mz + back.z * d;
    b.box([x, top / 2, z], [L + 1.2, top, ROW_D + 0.02], k % 2 ? concrete : 0xd6d1c7, { rotY: boxRot, mat: 'concrete' });
    for (let s = 0.5; s < L - 0.3; s += 0.62) {
      // aisle every ~10 m
      if (Math.abs(((s + 5) % 10.5) - 5.25) < 0.5) continue;
      const px = a[0] + ux * s + back.x * (d - 0.12);
      const pz = a[1] + uz * s + back.z * (d - 0.12);
      seats.push({ x: px, y: top, z: pz, rotY: faceY, color: k === 4 ? (o.accent ?? NAVY) : TEAL });
    }
  }
  // front padded wall + railing on top of the back wall
  const fwx = mx - back.x * 0.35;
  const fwz = mz - back.z * 0.35;
  b.box([fwx, 0.6, fwz], [L + 1.2, 1.2, 0.4], WALL_GREEN, { rotY: boxRot });
  if (o.wall !== false) {
    const bd = rows * ROW_D + 0.3;
    const top = ROW_H * rows + 2.2;
    b.box([mx + back.x * bd, top / 2, mz + back.z * bd], [L + 1.2, top, 0.6], 0xb9b3a7, { rotY: boxRot, mat: 'concrete' });
    b.box([mx + back.x * bd, top + 0.15, mz + back.z * bd], [L + 1.4, 0.3, 0.8], TEAL, { rotY: boxRot, mat: 'glossy' }); // floor pass: solid cap
    if (o.banners !== false) {
      const tex = bannerTextures();
      const n = Math.max(1, Math.floor(L / 7));
      for (let i = 0; i < n; i++) {
        let s = ((i + 0.5) * L) / n;
        // slide along the wall to clear light-tower masts and the main-gate pillars (plaza(): [97,150], [101,162])
        // standing just outside it: they used to hide two banners
        for (const [tx, tz] of [...lightTowerSpots(), [97, 150], [101, 162]]) {
          const ox = tx - (a[0] + ux * s + back.x * (bd + 0.3));
          const oz = tz - (a[1] + uz * s + back.z * (bd + 0.3));
          const along = ox * ux + oz * uz;
          if (Math.abs(ox * back.x + oz * back.z) < 5 && Math.abs(along) < 2.8) s += (along > 0 ? -1 : 1) * (2.8 - Math.abs(along));
        }
        s = Math.min(L - 0.5, Math.max(0.5, s));
        const bx = a[0] + ux * s + back.x * (bd + 0.3);
        const bz = a[1] + uz * s + back.z * (bd + 0.3);
        kit.sign(b, { pos: [bx, top - 2.3, bz], rotY: Math.atan2(back.x, back.z), w: 2, h: 3.6, tex: tex[i % tex.length], depth: 0.02, collide: false, back: false });
      }
    }
  }
}

function stands(kit: Kit, b: Batch, seats: Seat[]) {
  // 3B-side, behind home (split by a tunnel), 1B-side. The corners are open = entrances.
  section(kit, b, seats, at(46, D3, 9, N3), at(8, D3, 9, N3), N3);
  section(kit, b, seats, [H.x - 12.5, H.z + 11.5], [H.x - 2.2, H.z + 11.5], { x: 0, z: 1 });
  section(kit, b, seats, [H.x + 2.2, H.z + 11.5], [H.x + 12.5, H.z + 11.5], { x: 0, z: 1 });
  section(kit, b, seats, at(8, D1, 9, N1), at(46, D1, 9, N1), N1);
  // tunnel behind home plate: side walls + roof slab (walk through from the south)
  const tz0 = H.z + 11.5;
  const tz1 = tz0 + ROWS * ROW_D + 0.6;
  for (const s of [-1, 1]) b.box([H.x + s * 2.1, 1.5, (tz0 + tz1) / 2], [0.3, 3, tz1 - tz0], 0xb9b3a7, { mat: 'concrete' });
  b.box([H.x, 3.1, (tz0 + tz1) / 2], [4.5, 0.25, tz1 - tz0], 0xb9b3a7, { mat: 'concrete' });
  const t = kit.textSign([{ text: 'GATE H · FIELD LEVEL', px: 56, color: '#fff' }], { w: 3.6, h: 0.5, bg: '#0f8a93' });
  kit.sign(b, { pos: [H.x, 2.6, tz1 + 0.05], w: 3.6, h: 0.5, tex: t, depth: 0.04, collide: false, back: false });
  // press box / suites on top of the home section
  const pz = H.z + 11.5 + ROWS * ROW_D + 0.3;
  b.box([H.x, ROW_H * ROWS + 3.8, pz + 0.3], [24, 3.2, 3], 0xeae6de, { mat: 'concrete' });
  b.box([H.x, ROW_H * ROWS + 3.9, pz - 1.22], [23, 1.6, 0.06], 0x23415c, { collide: false, mat: 'window' });
  b.box([H.x, ROW_H * ROWS + 5.5, pz + 0.3], [24.6, 0.3, 3.6], TEAL, { mat: 'glossy' });
  const pb = kit.textSign([{ text: 'TEE-HEE PARK', px: 90, color: '#fff', stroke: '#0b4a50' }, { text: 'Home of the Ballard Barnacles', px: 40, color: '#e9ffff', font: FONT_ROUND }], { w: 8, h: 1.4, bg: '#0f8a93' });
  kit.sign(b, { pos: [H.x, ROW_H * ROWS + 6.5, pz + 0.3], rotY: Math.PI, w: 8, h: 1.4, tex: pb, depth: 0.2, frame: 0x0b4a50 });
}

function bleachers(kit: Kit, b: Batch, seats: Seat[]) {
  const rows = 7;
  for (const [aStart, aEnd] of [
    [A_L + 0.28, A_L + 0.9],
    [A_R - 0.9, A_R - 0.28],
  ]) {
    const segs = 9;
    for (let k = 0; k < rows; k++) {
      const r = FR + 1.4 + (k + 0.5) * ROW_D;
      const top = ROW_H * (k + 1) + 0.6;
      for (let i = 0; i < segs; i++) {
        const a0 = aStart + ((aEnd - aStart) * i) / segs;
        const a1 = aStart + ((aEnd - aStart) * (i + 1)) / segs;
        const am = (a0 + a1) / 2;
        const [x, z] = onArc(am, r);
        const len = 2 * r * Math.sin((a1 - a0) / 2) + 0.15;
        b.box([x, top / 2, z], [len, top, ROW_D + 0.02], k % 2 ? 0xcfcac0 : 0xd6d1c7, { rotY: -am + Math.PI / 2, mat: 'concrete' });
        for (let s = -len / 2 + 0.35; s < len / 2 - 0.2; s += 0.62) {
          const tx = -Math.sin(am);
          const tz = Math.cos(am);
          const [cx, cz] = onArc(am, r - 0.12);
          seats.push({ x: cx + tx * s, y: top, z: cz + tz * s, rotY: Math.atan2(-Math.cos(am), -Math.sin(am)), color: k === 3 ? 0xffd23a : TEAL });
        }
      }
    }
    // back wall
    const rb = FR + 1.4 + rows * ROW_D + 0.3;
    for (let i = 0; i < 9; i++) {
      const a0 = aStart + ((aEnd - aStart) * i) / 9;
      const a1 = aStart + ((aEnd - aStart) * (i + 1)) / 9;
      const am = (a0 + a1) / 2;
      const [x, z] = onArc(am, rb);
      const len = 2 * rb * Math.sin((a1 - a0) / 2) + 0.2;
      b.box([x, (ROW_H * rows + 2.4) / 2, z], [len, ROW_H * rows + 2.4, 0.5], 0xb9b3a7, { rotY: -am + Math.PI / 2, mat: 'concrete' });
    }
  }
}

function seatMesh(kit: Kit, seats: Seat[]) {
  const geo = bake([
    { geo: GEO.box, pos: [0, 0.22, 0], scale: [0.48, 0.07, 0.42], color: 0xffffff },
    { geo: GEO.box, pos: [0, 0.48, -0.19], scale: [0.48, 0.5, 0.06], color: 0xffffff },
  ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
  const im = new THREE.InstancedMesh(geo, mat, seats.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);
  seats.forEach((s, i) => {
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(Y, s.rotY), new THREE.Vector3(1, 1, 1));
    im.setMatrixAt(i, m);
    im.setColorAt(i, c.set(s.color));
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = false;
  im.receiveShadow = true;
  kit.root.add(im);
}

// ------------------------------------------------------------------ dugouts (+ the gold rookie card)

function dugouts(kit: Kit, b: Batch) {
  for (const [d, n, name] of [
    [D3, N3, 'VISITORS'],
    [D1, N1, 'BARNACLES'],
  ] as const) {
    const t0 = 9;
    const t1 = 19;
    const s0 = 4.4;
    const s1 = 8.0;
    const rotY = Math.atan2(-d.z, d.x);
    const mid = at((t0 + t1) / 2, d, (s0 + s1) / 2, n);
    const L = t1 - t0;
    const Wd = s1 - s0;
    const place = (t: number, s: number): [number, number] => at(t, d, s, n);
    // floor, back wall, end walls, roof, front rail
    b.box([mid[0], 0.04, mid[1]], [L, 0.08, Wd], 0x6d6a66, { rotY, collide: false, mat: 'concrete' });
    const bw = place((t0 + t1) / 2, s1 - 0.15);
    b.box([bw[0], 1.25, bw[1]], [L, 2.5, 0.3], NAVY, { rotY, mat: 'concrete' });
    for (const t of [t0, t1]) {
      const e = place(t, (s0 + s1) / 2);
      b.box([e[0], 1.25, e[1]], [0.3, 2.5, Wd], NAVY, { rotY, mat: 'concrete' });
    }
    b.box([mid[0], 2.6, mid[1]], [L + 0.4, 0.2, Wd + 0.3], TEAL, { rotY, mat: 'glossy' });
    const fr = place((t0 + t1) / 2 + 1, s0 + 0.1);
    b.box([fr[0], 1.0, fr[1]], [L - 2, 0.08, 0.08], 0xdddddd, { rotY, collide: false, mat: 'metal' });
    kit.collider([fr[0], 0.55, fr[1]], [L - 2, 1.1, 0.1], rotY);
    // bench, bat rack, helmets, cooler
    const bn = place((t0 + t1) / 2, s1 - 0.7);
    b.box([bn[0], 0.45, bn[1]], [L - 1.2, 0.08, 0.5], 0xb07a45, { rotY, collide: false, mat: 'planks' });
    kit.collider([bn[0], 0.45, bn[1]], [L - 1.2, 0.1, 0.5], rotY);
    for (let i = 0; i < 6; i++) {
      const lp = place(t0 + 1.2 + i * 1.6, s1 - 0.7);
      b.box([lp[0], 0.22, lp[1]], [0.08, 0.44, 0.4], 0x333333, { rotY, collide: false, shadow: false });
    }
    for (let i = 0; i < 6; i++) {
      const bp = place(t1 - 1 - i * 0.18, s1 - 0.22);
      b.pipe([bp[0], 0.1, bp[1]], [bp[0], 1.0, bp[1] + 0.02], 0.035, 0xc49a6c, { seg: 5, shadow: false });
    }
    for (let i = 0; i < 4; i++) {
      const hp = place(t0 + 2 + i * 0.5, s1 - 0.7);
      b.sphere([hp[0], 0.6, hp[1]], [0.16, 0.13, 0.16], name === 'BARNACLES' ? TEAL : 0xc62828, { w: 10, h: 6, mat: 'glossy', shadow: false });
    }
    const cp = place(t1 - 0.8, s0 + 0.8);
    b.cyl([cp[0], 0.35, cp[1]], 0.28, 0.7, 0xff7a1a, { seg: 12, collide: true, mat: 'glossy' });
    b.cyl([cp[0], 0.75, cp[1]], 0.3, 0.1, 0xffffff, { seg: 12, collide: false });
    const sign = kit.textSign([{ text: name, px: 70, color: '#fff' }], { w: 3, h: 0.5, bg: name === 'BARNACLES' ? '#0f8a93' : '#c62828' });
    const sp = place((t0 + t1) / 2, s0 - 0.05);
    kit.sign(b, { pos: [sp[0], 2.25, sp[1]], rotY: Math.atan2(-n.x, -n.z), w: 3, h: 0.5, tex: sign, depth: 0.04, collide: false, back: false });
    if (name === 'BARNACLES') {
      // the legendary gold rookie card hides in the far corner of the home dugout, behind the helmets
      const card = place(t0 + 0.6, s1 - 0.45);
      kit.world.poi.set('rookieCard', V(card[0], 0.1, card[1]));
      b.box([card[0], 0.12, card[1]], [0.5, 0.24, 0.35], 0xd9c08a, { rotY, collide: false });
    }
  }
}

// ------------------------------------------------------------------ scoreboard

/**
 * Jimothy in scoreboard lights, side on and facing right like the town's doodle (fx/jimothyArt): the round, domed back
 * running straight into his head (no neck), the ear with its pale rim, white brow over the black mask (eye glint),
 * white muzzle, black nose; long legs mid-stride, dark toward the paws, the near front paw lifted and curled; a short
 * tail puff with a faint ring.
 */
const PIXEL_JIMOTHY = [
  '.........GGGGG........',
  '.......GGGGGGGGG..WW..',
  '.....GGGGGGGGGGGGGWI..',
  '..TT.GGGGGGGGGGGGGGG..',
  '.TTtGGGGGGGGGGGGGGWWW.',
  'TTtTGGGGGGGGGGGGGKKKK.',
  'TtTTGGGGGGGGGGGGGKKEKK',
  '.TTTGGGGGGGGGGGGCCKKKK',
  '..T.GGGGGGGGGGGGCCWWWK',
  '....GGGGGGGGGGGGCCWW..',
  '....GGGGGGGGGGGGGC....',
  '.....GGGGGGGGGGGGG....',
  '.....GGGGGGGGGGG.GG...',
  '.....GGGGGGGGGG...DD..',
  '....DD...DD...DD..DD..',
  '....DD....DDD.DD.PP...',
  '...DD..........DD.....',
  '...DD..........DD.....',
  '...PPP..........PPP...',
];
// (the board glows: the coat is kept a mid grey so the white brow and muzzle still stand out, and the mask a dark grey
// rather than black, so it reads as his mask and not as a hole in his face)
const PIXEL_COLORS: Record<string, string> = {
  G: '#827d77', // coat
  W: '#f4f1ea', // brow, muzzle, ear rim
  C: '#aea9a2', // pale cheek ruff
  T: '#a0957f', // tail puff
  t: '#6a6254', // its faint ring
  D: '#57504b', // legs, darker toward the paws
  P: '#3a3531', // paws
  K: '#35302d', // mask, nose
  E: '#ffffff', // eye glint
  I: '#4d4b52', // inside the ear
};

/** The scoreboard's face (2048 × 860 canvas): JIMOTHY NIGHT, the pixel Jimothy, the line score. */
export function drawScoreboard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#0b0f18';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0f8a93';
  ctx.fillRect(0, 0, w, 120);
  fitText(ctx, 'TEE-HEE PARK', w / 2, 62, w * 0.6, 92, FONT_TITLE, { fill: '#fff' });
  // JIMOTHY NIGHT
  fitText(ctx, 'JIMOTHY NIGHT', w * 0.62, 250, w * 0.66, 190, FONT_TITLE, { fill: '#ffd23a', glow: '#ff9d00', glowBlur: 30 });
  fitText(ctx, 'AUG 5 · BOBBLEHEAD GIVEAWAY · ROOKIE CARDS', w * 0.62, 370, w * 0.66, 50, FONT_ROUND, { fill: '#e9ffff' });
  // pixel Jimothy (the lamp grid between the header and the line score, left of the title)
  const px = 17;
  PIXEL_JIMOTHY.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '.') return;
      ctx.fillStyle = PIXEL_COLORS[ch];
      ctx.fillRect(62 + i * px, 138 + j * px, px - 2, px - 2);
    }),
  );
  // line score
  ctx.font = `64px ${FONT_TITLE}`;
  const rows = [
    ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'R'],
    ['VISITORS', '0', '1', '0', '0', '2', '0', '0', '-', '-', '3'],
    ['BARNACLES', '1', '0', '0', '3', '0', '1', '0', '-', '-', '5'],
  ];
  rows.forEach((r, j) =>
    r.forEach((cell, i) => {
      ctx.fillStyle = j === 0 ? '#9fe3ff' : i === 10 ? '#ffd23a' : '#ffffff';
      ctx.textAlign = i === 0 ? 'left' : 'center';
      ctx.fillText(cell, i === 0 ? 70 : 520 + i * 118, 520 + j * 90);
    }),
  );
  ctx.fillStyle = '#ff6f61';
  ctx.textAlign = 'left';
  ctx.font = `52px ${FONT_TITLE}`;
  ctx.fillText('BALLS 2   STRIKES 1   OUTS 2', 70, 800);
  ctx.fillStyle = '#7cff6b';
  ctx.textAlign = 'right';
  ctx.fillText('ROUND BOY CAM ●', w - 70, 800);
}

function scoreboard(kit: Kit, b: Batch) {
  const [cx, cz] = onArc(-Math.PI / 2, FR + 6.5);
  const W = 24;
  const Hb = 10;
  const y0 = 6.5;
  for (const dx of [-7, 7]) b.box([cx + dx, y0 / 2, cz], [1.2, y0, 1.2], 0x2a2f38, { mat: 'metal' });
  b.box([cx, y0 + Hb / 2, cz + 0.3], [W + 0.6, Hb + 0.6, 1.4], 0x1b1f28, { mat: 'metal' });
  b.box([cx, y0 + Hb + 0.4, cz + 0.3], [W + 1, 0.4, 1.8], TEAL, { mat: 'glossy' });
  const tex = canvasTex(2048, 860, drawScoreboard);
  kit.sign(b, { pos: [cx, y0 + Hb / 2, cz + 0.3], rotY: 0, w: W, h: Hb, tex, depth: 1.42, emissive: [0.9, 2.4], back: false, collide: false });
  kit.world.poi.set('bobblehead:s10', V(cx, y0 + Hb + 0.7, cz + 0.3));
  kit.world.poi.set('scoreboard', V(cx, 0.2, cz - 4));
}

// ------------------------------------------------------------------ light towers (glow at night)

function lightTowers(kit: Kit, b: Batch) {
  const bulbTex = canvasTex(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 4; j++) {
        const g = ctx.createRadialGradient(16 + i * 32, 16 + j * 32, 2, 16 + i * 32, 16 + j * 32, 14);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.6, '#fff3c4');
        g.addColorStop(1, '#8a8a80');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(16 + i * 32, 16 + j * 32, 13, 0, Math.PI * 2);
        ctx.fill();
      }
  });
  const panelMat = new THREE.MeshStandardMaterial({ map: bulbTex, emissive: 0xffffff, emissiveMap: bulbTex, emissiveIntensity: 0.15, roughness: 0.4 });
  kit.glow(panelMat, 0.15, 3.2);
  // polish: beams fade out toward the ground (vertex alpha) — before, standing on the field put the camera inside
  // six overlapping double-sided additive cones and the whole night view turned into a beige haze.
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff4d0, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true });
  kit.glow(beamMat, 0, 0.018, 'opacity'); // lighting pass: 0.03 → 0.018, the cones still read but no longer haze the view
  const target = new THREE.Vector3(FC.x, 0, FC.z + 8);
  const spots = lightTowerSpots();
  const Ht = 24;
  spots.forEach(([x, z], i) => {
    b.cyl([x, Ht / 2, z], 0.35, Ht, 0x5d6770, { rTop: 0.25, seg: 10, collide: true, mat: 'metal' });
    for (let y = 3; y < Ht - 2; y += 3) b.cyl([x, y, z], 0.42, 0.15, 0x3a4048, { seg: 10, collide: false, shadow: false });
    const yaw = Math.atan2(target.x - x, target.z - z);
    const head = new THREE.Group();
    head.position.set(x, Ht + 1.6, z);
    head.rotation.y = yaw;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.6, 0.5), new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6 }));
    frame.rotation.x = 0.35;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), panelMat);
    panel.position.set(0, 0.09, 0.26);
    panel.rotation.x = 0.35;
    head.add(frame, panel);
    // light beam (visible at night)
    const aim = new THREE.Vector3(target.x + (i % 2 ? 6 : -6), 0, target.z + (i < 2 ? -6 : 6));
    const from = new THREE.Vector3(x, Ht + 1.6, z);
    const len = from.distanceTo(aim);
    const beamGeo = new THREE.CylinderGeometry(1.6, 9, len, 20, 1, true);
    const bp = beamGeo.attributes.position;
    const bcol = new Float32Array(bp.count * 4);
    for (let k = 0; k < bp.count; k++) bcol.set([1, 1, 1, bp.getY(k) > 0 ? 1 : 0], k * 4); // +Y = at the lamp
    beamGeo.setAttribute('color', new THREE.BufferAttribute(bcol, 4));
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.copy(from).add(aim).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim.clone().sub(from).normalize());
    beam.renderOrder = 5;
    kit.root.add(head, beam);
    b.box([x, Ht, z], [2, 0.3, 2], 0x3a4048, { collide: true, mat: 'metal' });
  });
  // bobblehead #11 on the catwalk of the first 3B-side light tower
  const [lx, lz] = spots[0];
  kit.world.poi.set('bobblehead:s11', V(lx, Ht + 0.45, lz));
  // soft field glow at night (fake light pool). Lighting pass: it was ADDITIVE warm white over the whole field, which on
  // a dark night field painted grass, dirt and lines the same flat beige. Now it multiplies what's there (grass stays
  // green, lines stay white) — it's what makes the field read as lit from across the bay.
  const poolMat = multiplyPoolMaterial(0xfff4e6);
  kit.glow(poolMat, 0, 0.7, 'opacity');
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(95, 95).rotateX(-Math.PI / 2), poolMat);
  pool.position.set(FC.x, 0.12, FC.z + 6);
  pool.renderOrder = 4;
  kit.root.add(pool);
  // …and up close a real (shared, shadowless) light high over the infield lights the field, stands and Jimothy.
  // Only on at night within ~80 m of the field (see nightLight.ts).
  addNightRig(kit.game, { pos: V(FC.x, 40, FC.z + 2), color: 0xf6f4ee, intensity: 1.45, distance: 85, decay: 0, radius: 55, fade: 25 });
}

// ------------------------------------------------------------------ plaza: gate, concessions, giant bobblehead

function plaza(kit: Kit, b: Batch) {
  const game = kit.game;
  b.patch(92, 152, 22, 13, 0xe6ddcf, { mat: 'paving', lift: 0.03, seg: 36 });
  b.patch(152, 152, 16, 10, 0xe6ddcf, { mat: 'paving', lift: 0.03, seg: 30 });
  // Main gate arch across the open 3B/home corner
  const g0: [number, number] = [97, 150];
  const g1: [number, number] = [101, 162];
  for (const [x, z] of [g0, g1]) {
    b.box([x, 3.2, z], [1.4, 6.4, 1.4], 0xb9b3a7, { mat: 'concrete' });
    b.box([x, 6.6, z], [1.7, 0.4, 1.7], TEAL, { mat: 'glossy' });
  }
  const gx = (g0[0] + g1[0]) / 2;
  const gz = (g0[1] + g1[1]) / 2;
  const gw = Math.hypot(g1[0] - g0[0], g1[1] - g0[1]);
  const gRot = Math.atan2(g1[1] - g0[1], g1[0] - g0[0]);
  b.box([gx, 5.8, gz], [gw + 1.4, 1.6, 0.6], 0xb9b3a7, { rotY: -gRot, mat: 'concrete' });
  // fits between the two (axis-aligned, so diagonally wider) pillars, which used to cover both ends of it;
  // canvas aspect = board aspect so the lettering is not stretched
  const gsw = gw - 1.7;
  const gt = canvasTex(Math.round((220 * gsw) / 1.5), 220, (ctx, w, h) => {
    ctx.fillStyle = '#0f8a93';
    ctx.fillRect(0, 0, w, h);
    // two columns with a gutter between them (the title used to run into the subtitle column)
    fitText(ctx, 'TEE-HEE PARK', w * 0.28, h * 0.5, w * 0.46, 150, FONT_TITLE, { fill: '#fff', stroke: '#0b4a50', strokeW: 12 });
    fitText(ctx, 'HOME OF THE BALLARD BARNACLES', w * 0.76, h * 0.34, w * 0.4, 56, FONT_ROUND, { fill: '#ffd23a' });
    fitText(ctx, 'TONIGHT: JIMOTHY NIGHT', w * 0.76, h * 0.7, w * 0.4, 56, FONT_ROUND, { fill: '#fff' });
  });
  const faceRot = -gRot; // readable from the plaza (outside)
  kit.sign(b, { pos: [gx, 5.8, gz], rotY: faceRot, w: gsw, h: 1.5, tex: gt, depth: 0.62, emissive: [0.35, 1.6] });
  // ticket booth + turnstiles
  b.box([87, 1.3, 147.5], [3, 2.6, 2.4], 0xf6efe0, { mat: 'siding' });
  b.box([87, 2.75, 147.5], [3.4, 0.3, 2.8], TEAL, { mat: 'glossy' });
  const tk = kit.textSign([{ text: 'TICKETS', px: 64, color: '#fff' }, { text: 'Raccoons free · always', px: 30, color: '#ffd23a', font: FONT_ROUND }], { w: 2.6, h: 0.7, bg: '#1d3557' });
  kit.sign(b, { pos: [87 + 1.52, 1.9, 147.5], rotY: Math.PI / 2, w: 2.2, h: 0.6, tex: tk, depth: 0.04, collide: false, back: false });
  // concession stands
  const stand = (x: number, z: number, rotY: number, name: string, sub: string, bg: string, roof: number) => {
    b.box([x, 1.35, z], [4.2, 2.7, 2.8], 0xf6efe0, { rotY, mat: 'siding' });
    b.box([x, 2.85, z], [4.8, 0.3, 3.4], roof, { rotY, mat: 'glossy' });
    const fx = Math.sin(rotY);
    const fz = Math.cos(rotY);
    b.box([x + fx * 1.42, 1.25, z + fz * 1.42], [3.2, 1.0, 0.05], 0x2b2f38, { rotY, collide: false, mat: 'glossy' });
    b.box([x + fx * 1.65, 0.95, z + fz * 1.65], [3.6, 0.08, 0.5], 0xd9c7a6, { rotY, collide: true }); // polish: solid counter (food used to drop through)
    const t = kit.textSign([{ text: name, px: 64, color: '#fff', stroke: '#1b1d24' }, { text: sub, px: 28, color: '#fff', font: FONT_ROUND }], { w: 4, h: 0.9, bg });
    kit.sign(b, { pos: [x + fx * 1.45, 3.5, z + fz * 1.45], rotY, w: 4, h: 0.9, tex: t, depth: 0.06, collide: false });
    return [x + fx * 1.65, z + fz * 1.65] as [number, number];
  };
  const hd = stand(75.5, 146, Math.PI / 2, 'DOGGONE DOGS', 'Hot dogs · Mustard · Regret', '#c62828', 0xffd23a);
  for (let i = 0; i < 3; i++) P.hotDog(game, hd[0] - 0.8 + i * 0.6, 0.99, hd[1] - 0.4 + i * 0.3, 0.9);
  const cc = stand(79, 162.6, Math.PI, 'SPUN SUGAR', 'Cotton candy · Do NOT wash it', '#d6408a', 0x9fd8ff);
  P.cottonCandy(game, cc[0] - 0.6, 0.99, cc[1] - 0.2, 0xff9fd2);
  P.cottonCandy(game, cc[0], 0.99, cc[1], 0x9fd8ff);
  P.cottonCandy(game, cc[0] + 0.6, 0.99, cc[1] + 0.2, 0xc9a0ff);
  const mr = stand(152, 158, Math.PI + 0.6, 'BARNACLES MERCH', 'Jimothy rookie cards SOLD OUT', '#0f8a93', 0x1d3557);
  void mr;
  const hd2 = stand(160, 146, -Math.PI / 2 - 0.3, 'GARLIC FRIES', 'Legally a vegetable', '#e8a33a', 0xc62828);
  P.hotDog(game, hd2[0], 0.99, hd2[1], 0);
  for (const [x, z] of [
    [81, 151],
    [93, 160],
    [147, 150],
    [158, 154],
  ])
    P.trashCan(game, x, 0, z, NAVY);
  for (const [x, z, r] of [
    [91, 158.5, Math.PI],
    [80, 152, Math.PI / 2],
  ] as V3[])
    bench(b, x, 0, z, r);
  lamps(kit, b, [
    [78, 0, 152],
    [90, 0, 162],
    [96, 0, 147],
    [146, 0, 158],
    [160, 0, 158],
  ]);
  for (const [x, z] of [
    [72, 132],
    [70, 145],
    [172, 140],
    [176, 128],
    [70, 90],
    [175, 95],
    [175, 112],
  ])
    tree(b, x, 0, z, 1.0, Math.floor(x + z));
}

/** Model metres → metres for the World's Largest Bobblehead (he stands ~6.5 m tall on his plinth, cap included). */
const GIANT = 6;
/**
 * The Barnacles jersey painted on his torso (his model frame, metres): fur behind its back edge and below its hem, a
 * white hem, and his number on both flanks (centre z/y, size w/h).
 */
const JERSEY = { back: -0.2, hem: 0.35, trim: 0.024, num: { z: -0.015, y: 0.49, w: 0.25, h: 0.19 } };

/** His jersey number: 00. (Round.) */
function jerseyNumber() {
  return canvasTex(256, 192, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    fitText(ctx, '00', w / 2, h * 0.54, w * 0.92, 190, FONT_TITLE, { fill: '#f4f1e6', stroke: '#1d3557', strokeW: 14 });
  });
}

/**
 * Painted resin: his own coat under a glossy clear coat, the fur carved by the coat as a bump. With `jersey`, a teal
 * Barnacles jersey (white hem, 00 on the flanks) is painted over his torso, by position in his model frame: the
 * geometry must stay in that frame (place the mesh, don't bake the placement in).
 */
function resinMaterial(coat: THREE.Texture | null, jersey: boolean) {
  const m = new THREE.MeshPhysicalMaterial({ map: coat, color: 0xe4e4e4, roughness: 0.5, clearcoat: 0.55, clearcoatRoughness: 0.3 });
  if (coat) {
    m.bumpMap = coat;
    m.bumpScale = 1;
  }
  m.name = jersey ? 'giantBobblehead:jersey' : 'giantBobblehead:resin';
  if (!jersey) return m;
  const num = { value: jerseyNumber() };
  const J = JERSEY;
  const f = (v: number) => v.toFixed(3);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uJerseyNum = num;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFigPos;\nvarying vec3 vFigNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFigPos = position;\nvFigNormal = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFigPos;\nvarying vec3 vFigNormal;\nuniform sampler2D uJerseyNum;').replace(
      '#include <map_fragment>',
      /* glsl */ `#include <map_fragment>
      {
        // how far inside the jersey's back edge and hem this is (negative: bare fur)
        float inside = min( vFigPos.z - (${f(J.back)}), vFigPos.y - (${f(J.hem)}) );
        float cloth = smoothstep( -0.003, 0.003, inside );
        float hemBand = 1.0 - smoothstep( ${f(J.trim - 0.003)}, ${f(J.trim + 0.003)}, inside );
        float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        vec3 paint = mix( vec3( 0.006, 0.26, 0.29 ), vec3( 0.86 ), hemBand ) * ( 0.8 + 0.7 * lum );
        // the number, projected across each flank so it reads left to right from either side
        vec2 nuv = vec2( ( vFigPos.z - (${f(J.num.z)}) ) / ${f(J.num.w)}, ( vFigPos.y - (${f(J.num.y)}) ) / ${f(J.num.h)} );
        nuv.x = vFigPos.x > 0.0 ? 0.5 - nuv.x : 0.5 + nuv.x;
        nuv.y += 0.5;
        if ( nuv.x > 0.0 && nuv.x < 1.0 && nuv.y > 0.0 && nuv.y < 1.0 ) {
          vec4 n = texture2D( uJerseyNum, nuv );
          paint = mix( paint, n.rgb, n.a * smoothstep( 0.45, 0.75, abs( normalize( vFigNormal ).x ) ) );
        }
        diffuseColor.rgb = mix( diffuseColor.rgb, paint, cloth );
      }`,
    );
  };
  m.customProgramCacheKey = () => 'giantBobbleheadJersey';
  return m;
}

/** A Ballard Barnacles cap for his head, in the hat frame (bottom centre at the origin, +Y up out of the crown, +Z forward). */
function barnaclesCap(width: number) {
  const r = (width / 2) * 1.1;
  // crown: a half-ellipsoid (depth/height relative to r), pulled a little down over the skull
  const cz = 1.08;
  const cy = 0.86;
  const sink = r * 0.1;
  const g = new THREE.Group();
  g.name = 'BarnaclesCap';
  const cloth = bake([
    { geo: new THREE.SphereGeometry(1, 30, 12, 0, Math.PI * 2, 0, Math.PI / 2), scale: [r, r * cy, r * cz], pos: [0, -sink, 0], color: NAVY },
    { geo: GEO.sphere(10, 8), scale: r * 0.09, pos: [0, r * cy - sink, 0], color: TEAL },
    { geo: new THREE.CylinderGeometry(1, 1, 1, 28, 1, false, -Math.PI / 2, Math.PI), scale: [r * 1.02, r * 0.08, r * 0.98], pos: [0, -sink * 0.4, r * 0.42], rot: [0.12, 0, 0], color: TEAL },
  ]);
  const capMesh = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }));
  const logo = canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4f1e6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0f8a93';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
    ctx.fill();
    fitText(ctx, 'B', w / 2, h * 0.53, w * 0.6, 150, FONT_TITLE, { fill: '#f4f1e6', stroke: '#0b4a50', strokeW: 8 });
  });
  const patch = new THREE.Mesh(new THREE.CircleGeometry(r * 0.32, 28), new THREE.MeshStandardMaterial({ map: logo, roughness: 0.7 }));
  // on the front of the crown, square to its surface there
  const th = 0.6;
  const n = new THREE.Vector2(Math.cos(th) / cz, Math.sin(th) / cy).normalize(); // (z, y)
  patch.position.set(0, r * cy * Math.sin(th) - sink + n.y * r * 0.03, r * cz * Math.cos(th) + n.x * r * 0.03);
  patch.rotation.x = -Math.atan2(n.y, n.x);
  patch.userData.cullDist = 120; // (small, but it's the cap's logo)
  g.add(capMesh, patch);
  return g;
}

/**
 * JIMOTHY NIGHT's "World's Largest Bobblehead*" outside the main gate: the giveaway bobblehead (the real Jimothy, mid-
 * stride with a paw up, big head on a spring) in painted resin, in a Barnacles cap and jersey, on a stone plinth.
 * Climbable: stepped colliders follow his back, head and cap (bobblehead s12 sits on the cap).
 */
async function giantBobblehead(kit: Kit, b: Batch, x: number, z: number) {
  const top = 1.5;
  const PR = 3.1;
  b.cyl([x, 0.7, z], PR - 0.2, 1.4, 0x8c8378, { seg: 28, mat: 'stone', collide: true });
  b.cyl([x, 1.45, z], PR, 0.12, 0xb9b3a7, { seg: 28, mat: 'stone', collide: true }); // floor pass: solid plinth cap
  const yaw = -Math.PI / 2 + 0.35; // greets fans arriving from the west
  const parts = await P.jimothyBobble(kit.game, P.BOBBLEHEAD);
  let crown = V(x, top + 0.1, z);
  if (parts) {
    const bb = parts.bodyBox;
    const fig = new THREE.Group();
    fig.name = 'GiantBobblehead';
    fig.position.set(x, top, z);
    fig.rotation.y = yaw;
    fig.scale.setScalar(GIANT);
    // his feet centred on the plinth
    const model = new THREE.Group();
    model.position.set(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
    fig.add(model);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const o = new THREE.Mesh(g, m);
      o.castShadow = o.receiveShadow = true;
      return o;
    };
    const jersey = resinMaterial(parts.coat, true);
    for (const p of parts.body) model.add(mesh(p.geometry, jersey));
    // the head: big, tipped up to look at the fans, on a wobbling spring at his neck
    const neck = new THREE.Group();
    neck.position.copy(parts.neck);
    neck.rotation.x = -P.BOBBLEHEAD.headPitch;
    neck.scale.setScalar(P.BOBBLEHEAD.headScale);
    const wobble = new THREE.Group();
    neck.add(wobble);
    model.add(neck);
    const headResin = resinMaterial(parts.coat, false);
    for (const p of parts.head) {
      const o = mesh(p.geometry, p.material.map ? headResin : p.material);
      // eyes, glints, nose: tiny parts the DetailCuller would drop at 30 m, leaving a blank face on a 6 m statue
      if (!p.material.map) o.userData.cullDist = 90;
      wobble.add(o);
    }
    const cap = barnaclesCap(parts.hat.width);
    cap.position.copy(parts.hat.pos);
    cap.quaternion.copy(parts.hat.quat);
    cap.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true) : 0));
    wobble.add(cap);
    kit.root.add(fig);
    kit.state.wobblers.push({ obj: wobble, amp: 0.05, speed: 2.3 });
    // climbable: stepped boxes up his legs, back and head (the wobble is small), and the cap's own dome as a hull,
    // so a raccoon (or bobblehead s12) can stand on its crown
    fig.updateMatrixWorld(true);
    profileColliders(kit.world, fig, { rotY: yaw, cell: 0.42, inset: 0.05 });
    const pts: number[] = [];
    const v = new THREE.Vector3();
    crown.y = -Infinity;
    cap.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        pts.push(v.x, v.y, v.z);
        if (v.y > crown.y) crown.copy(v);
      }
    });
    kit.hullCollider(pts);
  } else {
    console.warn('[stadium] giant bobblehead: no baked Jimothy (plinth only)');
  }
  const t = kit.textSign(
    [
      { text: 'JIMOTHY NIGHT', px: 60, color: '#ffd23a', stroke: '#1d3557' },
      { text: 'Aug 5 · World’s Largest Bobblehead*', px: 26, color: '#fff', font: FONT_ROUND },
      { text: '*citation needed', px: 22, color: '#cfe', font: FONT_BODY },
    ],
    { w: 2.4, h: 1, bg: '#0f8a93', border: '#ffd23a' },
  );
  // Free-standing on two posts in front of the plinth (off to his right, clear of the big head), facing the fans
  // arriving from the west.
  const sy = yaw;
  const fx = Math.sin(sy),
    fz = Math.cos(sy);
  const px = x + fx * (PR + 1.2) - fz * 1.6,
    pz = z + fz * (PR + 1.2) + fx * 1.6;
  for (const s of [-0.8, 0.8]) b.cyl([px + Math.cos(sy) * s - fx * 0.06, 0.72, pz - Math.sin(sy) * s - fz * 0.06], 0.045, 1.44, 0x1d3557, { seg: 6, collide: false });
  kit.sign(b, { pos: [px, 1.05, pz], rotY: sy, w: 1.92, h: 0.8, tex: t, depth: 0.03, collide: false, back: false });
  kit.world.poi.set('bobblehead:s12', V(crown.x, crown.y + 0.35, crown.z));
  kit.world.poi.set('giantBobblehead', V(x + 3.5, 0.2, z + 3.5));
}

const STAND_BANNERS: { bg: string; fg: string; lines: string[]; jimothy?: 1 | -1 }[] = [
  { bg: '#0f8a93', fg: '#ffd23a', lines: ['JIMOTHY', 'NIGHT', 'AUG 5'], jimothy: 1 },
  { bg: '#1d3557', fg: '#ffffff', lines: ['GO', 'BARN-', 'ACLES!', '★★★'] },
  // faces the other way, so the two Jimothys on a wall walk toward each other
  { bg: '#ff8c1a', fg: '#fff8e1', lines: ['ROUND', 'BOY', 'FOREVER'], jimothy: -1 },
];

/** One of the vertical stand banners (256 × 460 canvas): JIMOTHY NIGHT and ROUND BOY FOREVER carry the real Jimothy. */
export function drawStandBanner(ctx: CanvasRenderingContext2D, w: number, h: number, kind: number) {
  const s = STAND_BANNERS[kind % STAND_BANNERS.length];
  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(0, 0, w, 18);
  ctx.fillRect(0, h - 18, w, 18);
  if (s.jimothy) {
    // mid-stride, a paw up, on a pale medallion so the grey coat reads on the team colours
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.arc(w / 2, 128, 104, 0, Math.PI * 2);
    ctx.fill();
    drawJimothy(ctx, w / 2, 131, 90, { facing: s.jimothy });
  }
  s.lines.forEach((t, i) => fitText(ctx, t, w / 2, (s.jimothy ? 276 : 120) + i * 66, w * 0.86, 62, FONT_TITLE, { fill: s.fg, stroke: 'rgba(0,0,0,0.3)', strokeW: 6 }));
}

let _banners: THREE.Texture[] | null = null;
/** Vertical JIMOTHY NIGHT / Barnacles banners for the outside of the stands (shared artwork → one atlas rect each). */
function bannerTextures() {
  if (_banners) return _banners;
  _banners = STAND_BANNERS.map((_, i) => canvasTex(256, 460, (ctx, w, h) => drawStandBanner(ctx, w, h, i)));
  return _banners;
}
