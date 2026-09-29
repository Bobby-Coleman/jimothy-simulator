import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { G, groups } from '../../core/Physics';
import type { World } from '../../world/World';
import { canvasTexture, fitText, roundRect, SIGN_FONT } from '../quests/landmarks/kit/text';
import { GATES, KICKER, LANES, START, STAIR, TIERS, fmtTime, type GateDef, type MedalId } from './course';

/**
 * Geometry for THE BIG ROLL:
 *  - Hilltop Lanes: a flat-roofed retro bowling alley (static, batched by the StaticBatcher) with a staircase up its
 *    west side, a parapet, a bowling lane painted on the roof, the start pad, a pin arch, a medal board and a kicker
 *    ramp at the south edge that throws Jimothy over the Furry Park viewpoint onto Tumble St.
 *  - Checkpoint gates: visual-only rings (no colliders; passing is a distance test) + number labels + a light beam on
 *    the next one. Hidden unless a race is on, so free play pays nothing for them.
 *  - The Pins: ten giant bowling pins behind the finish line that topple as he rolls through (visual only, reset per
 *    race).
 */

const WORLD_ONLY = groups(G.ALL, G.WORLD);
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

export interface GateVisual {
  def: GateDef;
  center: THREE.Vector3;
  groundY: number;
  yaw: number;
  group: THREE.Group;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  passT: number;
}

export interface PinVisual {
  obj: THREE.Object3D;
  home: THREE.Vector3;
  /** 0 = standing, 1 = down. */
  fall: number;
  falling: boolean;
  axis: THREE.Vector3;
  spin: number;
  slide: THREE.Vector3;
}

export class BigRollBuild {
  readonly root = new THREE.Group();
  gates: GateVisual[] = [];
  pins: PinVisual[] = [];
  beam!: THREE.Mesh;
  startPos = new THREE.Vector3();
  finishArch!: THREE.Group;
  private board!: THREE.Mesh;
  private boardKey = '';
  private matNext!: THREE.MeshBasicMaterial;
  private matTodo!: THREE.MeshBasicMaterial;
  private matDone!: THREE.MeshBasicMaterial;
  private padRing!: THREE.Mesh;

  constructor(
    private game: Game,
    private world: World,
  ) {}

  groundY(x: number, z: number, from = 200) {
    const hit = this.game.physics.raycast(_v.set(x, from, z), DOWN, from + 50, WORLD_ONLY);
    return hit ? hit.point.y : this.world.heightAt(x, z);
  }

  build() {
    this.root.name = 'bigroll';
    this.game.scene.add(this.root);
    this.buildLanes();
    this.buildGates();
    this.buildFinish();
    this.showCourse(false);
  }

  // ------------------------------------------------------------------ Hilltop Lanes
  private buildLanes() {
    const w = this.world;
    const L = LANES;
    const cx = (L.x0 + L.x1) / 2;
    const cz = (L.z0 + L.z1) / 2;
    const W = L.x1 - L.x0;
    const D = L.z1 - L.z0;
    let base = Infinity;
    for (let x = L.x0 - 3; x <= L.x1 + 0.01; x += 2) for (let z = L.z0; z <= L.z1 + 2.5; z += 2) base = Math.min(base, w.heightAt(x, z));
    base -= 0.6;
    const top = L.roofY;
    const H = top - base;
    const teal = w.material(0x2fb3a8, { roughness: 0.75 });
    const cream = w.material(0xfff0d0, { roughness: 0.8 });
    const red = w.material(0xe8483c, { roughness: 0.6 });
    const dark = w.material(0x2a2433, { roughness: 0.7 });
    const trim = w.material(0xffd23f, { roughness: 0.55 });
    const wood = w.material(0xd9a566, { roughness: 0.5 });
    // main block (+ cream upper band, red stripe, trim)
    w.box(new THREE.Vector3(cx, base + H / 2 - 0.4, cz), new THREE.Vector3(W, H - 0.8, D), teal);
    w.box(new THREE.Vector3(cx, top - 0.4, cz), new THREE.Vector3(W + 0.1, 0.8, D + 0.1), cream);
    w.box(new THREE.Vector3(cx, top - 1.6, L.z1 + 0.03), new THREE.Vector3(W + 0.02, 0.35, 0.1), red, { collide: false });
    w.box(new THREE.Vector3(cx, top - 1.6, L.z0 - 0.03), new THREE.Vector3(W + 0.02, 0.35, 0.1), red, { collide: false });
    // front (south): door, windows, awning
    const fz = L.z1 + 0.06;
    const gy = w.heightAt(cx, L.z1 + 0.5);
    w.box(new THREE.Vector3(cx, gy + 1.25, fz), new THREE.Vector3(2.4, 2.5, 0.1), dark, { collide: false });
    w.box(new THREE.Vector3(cx, gy + 2.62, fz + 0.5), new THREE.Vector3(3.6, 0.14, 1.1), red);
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd7ff, emissive: 0xffc46b, emissiveIntensity: 0.55, roughness: 0.2 });
    for (const s of [-1, 1])
      for (let i = 0; i < 2; i++) {
        const wx = cx + s * (2.9 + i * 2.6);
        w.box(new THREE.Vector3(wx, gy + 1.9, fz), new THREE.Vector3(1.8, 1.6, 0.08), glass, { collide: false });
      }
    // Big sign above the door: "HILLTOP LANES"
    const signTex = canvasTexture(1024, 256, (ctx, cw, ch) => {
      const g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, '#ff5f8f');
      g.addColorStop(1, '#c02a5c');
      ctx.fillStyle = g;
      roundRect(ctx, 8, 8, cw - 16, ch - 16, 60);
      ctx.fill();
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#ffd23f';
      ctx.stroke();
      fitText(ctx, 'HILLTOP LANES', cw / 2, ch * 0.42, cw * 0.86, ch * 0.5, { color: '#fff4dc', stroke: '#5a1030', strokeW: 10 });
      fitText(ctx, 'BOWLING · SINCE 1962 · RACCOONS WELCOME*', cw / 2, ch * 0.8, cw * 0.8, ch * 0.13, { color: '#ffd23f', weight: '800' });
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.35, roughness: 0.6 }));
    sign.position.set(cx, top - 3.3, L.z1 + 0.09);
    w.addStatic(sign, { collider: 'none', shadows: false });
    const fine = canvasTexture(512, 96, (ctx, cw, ch) => {
      ctx.fillStyle = '#fff4dc';
      ctx.fillRect(0, 0, cw, ch);
      fitText(ctx, '*as bowling balls', cw / 2, ch / 2, cw * 0.9, ch * 0.5, { color: '#2a2433', weight: '800' });
    });
    const fineSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshStandardMaterial({ map: fine, roughness: 0.8 }));
    fineSign.position.set(cx + 5.2, gy + 3.1, L.z1 + 0.09);
    w.addStatic(fineSign, { collider: 'none', shadows: false });

    // parapets (north, east, west except the stair landing, south except the kicker)
    const ph = 0.7;
    const py = top + ph / 2;
    w.box(new THREE.Vector3(cx, py, L.z0 + 0.15), new THREE.Vector3(W, ph, 0.3), cream);
    w.box(new THREE.Vector3(L.x1 - 0.15, py, cz), new THREE.Vector3(0.3, ph, D), cream);
    const wz0 = STAIR.zTop + 0.2;
    w.box(new THREE.Vector3(L.x0 + 0.15, py, (wz0 + L.z1) / 2), new THREE.Vector3(0.3, ph, L.z1 - wz0), cream);
    for (const s of [-1, 1]) {
      const a = s * (KICKER.hw + 0.35);
      const b = s * (W / 2);
      w.box(new THREE.Vector3(cx + (a + b) / 2, py, L.z1 - 0.15), new THREE.Vector3(Math.abs(b - a), ph, 0.3), cream);
    }

    // the lane painted on the roof: wood strip from the pad to the kicker, with arrows + gutters
    const laneTex = canvasTexture(256, 1024, (ctx, cw, ch) => {
      ctx.fillStyle = '#e2b173';
      ctx.fillRect(0, 0, cw, ch);
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(120,70,20,0.10)' : 'rgba(255,240,210,0.10)';
        ctx.fillRect((i * cw) / 14, 0, cw / 14, ch);
      }
      ctx.fillStyle = '#7a2a1a';
      for (let i = 0; i < 5; i++) {
        const x = cw * (0.2 + i * 0.15);
        const y = ch * (0.55 - Math.abs(i - 2) * 0.05);
        ctx.beginPath();
        ctx.moveTo(x, y + 40);
        ctx.lineTo(x - 14, y + 70);
        ctx.lineTo(x + 14, y + 70);
        ctx.closePath();
        ctx.fill();
      }
      fitText(ctx, 'ROLL', cw / 2, ch * 0.3, cw * 0.8, 90, { color: 'rgba(122,42,26,0.8)' });
    });
    laneTex.wrapS = laneTex.wrapT = THREE.ClampToEdgeWrapping;
    const laneLen = KICKER.zFrom - (START.z - 1.6);
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(KICKER.hw * 2, laneLen).rotateX(-Math.PI / 2).rotateY(Math.PI),
      new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    lane.position.set(START.x, top + 0.02, START.z - 1.6 + laneLen / 2);
    lane.receiveShadow = true;
    w.addStatic(lane, { collider: 'none', shadows: false });
    for (const s of [-1, 1]) w.box(new THREE.Vector3(START.x + s * (KICKER.hw + 0.12), top + 0.05, (START.z - 1.6 + KICKER.zTo) / 2), new THREE.Vector3(0.24, 0.1, KICKER.zTo - START.z + 1.6), dark, { collide: false });

    // kicker: inclined slab, top face from (zFrom, roof) up to (zTo, roof + rise)
    const kLen = KICKER.zTo - KICKER.zFrom;
    const ang = Math.atan2(KICKER.rise, kLen);
    const slab = Math.hypot(kLen, KICKER.rise);
    const th = 0.6;
    const kc = new THREE.Vector3(START.x, top + KICKER.rise / 2, (KICKER.zFrom + KICKER.zTo) / 2);
    // shift down along the slab normal so the top face is the ramp
    _e.set(-ang, 0, 0);
    _q.setFromEuler(_e);
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
    kc.addScaledVector(n, -th / 2);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(KICKER.hw * 2, th, slab), wood);
    kick.position.copy(kc);
    kick.quaternion.copy(_q);
    kick.castShadow = kick.receiveShadow = true;
    w.addStatic(kick, { collider: 'none' });
    this.game.physics.staticBox(kc, new THREE.Vector3(KICKER.hw, th / 2, slab / 2), _q.clone(), 0.9);
    // fill under the kicker (so it reads as solid, and nothing gets stuck beneath it)
    w.box(new THREE.Vector3(START.x, top + KICKER.rise * 0.25, KICKER.zTo - kLen * 0.25), new THREE.Vector3(KICKER.hw * 2 - 0.05, KICKER.rise * 0.5, kLen * 0.5 - 0.3), wood, { collide: false });
    // chevrons on the kicker lip
    const chevTex = canvasTexture(256, 64, (ctx, cw, ch) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#1d1a26' : '#ffd23f';
        ctx.beginPath();
        ctx.moveTo((i * cw) / 8, 0);
        ctx.lineTo(((i + 1) * cw) / 8, 0);
        ctx.lineTo(((i + 0.5) * cw) / 8, ch);
        ctx.fill();
      }
    });
    const lip = new THREE.Mesh(new THREE.PlaneGeometry(KICKER.hw * 2, 0.5), new THREE.MeshStandardMaterial({ map: chevTex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    lip.position.set(START.x, top + KICKER.rise - 0.25, KICKER.zTo + 0.02);
    w.addStatic(lip, { collider: 'none', shadows: false });

    // staircase up the west side (inclined collider + visual steps + outer rail + landing)
    const S = STAIR;
    const sx = (S.x0 + S.x1) / 2;
    const sw = S.x1 - S.x0;
    const yb = w.heightAt(sx, S.zBottom);
    const run = S.zBottom - S.zTop;
    const rise = top - yb;
    const steps = Math.ceil(rise / 0.2);
    const stepD = run / steps;
    const stone = w.material(0xc9c1b4, { roughness: 0.9 });
    for (let i = 0; i < steps; i++) {
      const ty = yb + ((i + 1) * rise) / steps;
      const zc = S.zBottom - (i + 0.5) * stepD;
      const gyi = w.heightAt(sx, zc) - 0.3;
      w.box(new THREE.Vector3(sx, (ty + gyi) / 2, zc), new THREE.Vector3(sw, ty - gyi, stepD + 0.02), stone, { collide: false });
    }
    const sAng = Math.atan2(rise, run);
    const sLen = Math.hypot(run, rise);
    _e.set(sAng, 0, 0); // +z end (south, bottom) goes down
    _q.setFromEuler(_e);
    const sn = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
    const scen = new THREE.Vector3(sx, (yb + top) / 2, (S.zBottom + S.zTop) / 2).addScaledVector(sn, -0.13);
    this.game.physics.staticBox(scen, new THREE.Vector3(sw / 2, 0.12, sLen / 2), _q.clone(), 0.8);
    // landing at the top (roof level), connecting to the roof's north-west corner
    w.box(new THREE.Vector3(sx, top - 0.2, (S.zTop + L.z0) / 2 - 0.1), new THREE.Vector3(sw, 0.4, S.zTop - L.z0 + 0.2), stone);
    // rails: outer (west) along the flight + landing, north end of the landing
    const railM = w.material(0x2b2f2e, { roughness: 0.5, metalness: 0.4 });
    const rail = (a: THREE.Vector3, b: THREE.Vector3) => {
      const len = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), railM);
      m.position.copy(mid).add(new THREE.Vector3(0, 0.95, 0));
      m.lookAt(b.clone().add(new THREE.Vector3(0, 0.95, 0)));
      w.addStatic(m, { collider: 'none' });
      const nPost = Math.max(2, Math.round(len / 1.4));
      for (let i = 0; i <= nPost; i++) {
        const p = a.clone().lerp(b, i / nPost);
        w.box(p.clone().add(new THREE.Vector3(0, 0.48, 0)), new THREE.Vector3(0.06, 0.95, 0.06), railM, { collide: false });
      }
      // collider: a thin wall following the rail
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const pitch = -Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
      _e.set(pitch, yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      this.game.physics.staticBox(mid.clone().add(new THREE.Vector3(0, 0.55, 0)), new THREE.Vector3(0.06, 0.55, len / 2), _q.clone(), 0.5);
    };
    rail(new THREE.Vector3(S.x0 + 0.05, yb, S.zBottom), new THREE.Vector3(S.x0 + 0.05, top, S.zTop));
    rail(new THREE.Vector3(S.x0 + 0.05, top, S.zTop), new THREE.Vector3(S.x0 + 0.05, top, L.z0 - 0.1));
    rail(new THREE.Vector3(S.x0 + 0.05, top, L.z0 - 0.15), new THREE.Vector3(S.x1, top, L.z0 - 0.15));

    // signpost at the foot of the stairs (the way up isn't obvious from Tumble St)
    const postTex = canvasTexture(512, 256, (ctx, cw, ch) => {
      ctx.fillStyle = '#1d1a26';
      roundRect(ctx, 6, 6, cw - 12, ch - 12, 36);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#ffd23f';
      ctx.stroke();
      fitText(ctx, 'THE BIG ROLL', cw / 2, ch * 0.36, cw * 0.84, 72, { color: '#ffd23f' });
      fitText(ctx, '▲ START ON THE ROOF ▲', cw / 2, ch * 0.7, cw * 0.84, 40, { color: '#fff4dc', weight: '800' });
    });
    const sgx = S.x0 - 1.1;
    const sgz = S.zBottom + 0.6;
    const sgy = w.heightAt(sgx, sgz);
    w.box(new THREE.Vector3(sgx, sgy + 0.8, sgz), new THREE.Vector3(0.1, 1.6, 0.1), railM);
    const signPlate = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshStandardMaterial({ map: postTex, roughness: 0.7, side: THREE.DoubleSide }));
    signPlate.position.set(sgx, sgy + 1.85, sgz);
    signPlate.rotation.y = -0.35;
    w.addStatic(signPlate, { collider: 'none', shadows: false });

    // start pad + pin arch + medal board
    const padY = top;
    this.startPos.set(START.x, padY + 0.45, START.z);
    const padTex = canvasTexture(256, 256, (ctx, cw, ch) => {
      ctx.clearRect(0, 0, cw, ch);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, cw * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      fitText(ctx, 'START', cw / 2, ch / 2, cw * 0.62, 64, { color: '#ffd23f', stroke: '#1d1a26', strokeW: 8 });
    });
    this.padRing = new THREE.Mesh(
      new THREE.PlaneGeometry(START.r * 2.1, START.r * 2.1).rotateX(-Math.PI / 2).rotateY(Math.PI),
      new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    this.padRing.position.set(START.x, padY + 0.035, START.z);
    this.padRing.renderOrder = 3;
    this.padRing.userData.noMerge = true;
    this.root.add(this.padRing);

    // the arch: two giant pins as posts and a banner (north face reads THE BIG ROLL for the player starting)
    const archZ = START.z + 1.9;
    for (const s of [-1, 1]) {
      const pin = makePin(2.6);
      pin.position.set(START.x + s * (KICKER.hw + 0.5), padY, archZ);
      w.addStatic(pin, { collider: 'none' });
      w.collider(new THREE.Vector3(pin.position.x, padY + 1.2, archZ), new THREE.Vector3(0.6, 2.4, 0.6));
    }
    const bannerTex = canvasTexture(1024, 200, (ctx, cw, ch) => {
      const g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, '#1d1a26');
      g.addColorStop(1, '#3a2f55');
      ctx.fillStyle = g;
      roundRect(ctx, 4, 4, cw - 8, ch - 8, 40);
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#ffd23f';
      ctx.stroke();
      fitText(ctx, 'THE BIG ROLL', cw / 2, ch * 0.44, cw * 0.84, ch * 0.56, { color: '#ffd23f', stroke: '#000', strokeW: 8 });
      fitText(ctx, 'STAND ON THE PAD · TUCK & ROLL (Q) TO START', cw / 2, ch * 0.82, cw * 0.84, ch * 0.14, { color: '#fff4dc', weight: '800' });
    });
    const bw = KICKER.hw * 2 + 1;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(bw, (bw * 200) / 1024), new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
    banner.position.set(START.x, padY + 2.9, archZ);
    banner.rotation.y = Math.PI; // faces north (toward the player standing on the pad looking south)
    w.addStatic(banner, { collider: 'none', shadows: false });

    // medal board, by the top of the stairs (faces east, toward the pad)
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0.25 }));
    this.board.position.set(L.x0 + 0.5, padY + 1.95, START.z + 2.3);
    this.board.rotation.y = Math.PI / 2;
    this.board.userData.noMerge = true;
    this.root.add(this.board);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 2.7), dark);
    post.position.set(L.x0 + 0.42, padY + 0.35, START.z + 2.3);
    w.addStatic(post, { collider: 'box' });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.8, 2.8), trim);
    frame.position.set(L.x0 + 0.44, padY + 1.95, START.z + 2.3);
    w.addStatic(frame, { collider: 'none' });

    // rooftop decor: a giant pin at the north-east corner and a ball beside it
    const big = makePin(4.2);
    big.position.set(L.x1 - 1.4, padY, L.z0 + 1.4);
    w.addStatic(big, { collider: 'none' });
    w.collider(new THREE.Vector3(L.x1 - 1.4, padY + 2, L.z0 + 1.4), new THREE.Vector3(1, 4, 1));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 14), new THREE.MeshStandardMaterial({ color: 0x3050c8, roughness: 0.2, metalness: 0.2 }));
    ball.position.set(L.x1 - 3.1, padY + 0.9, L.z0 + 1.2);
    w.addStatic(ball, { collider: 'box' });

    this.world.poi.set('bigRollStart', new THREE.Vector3(START.x, padY + 0.3, START.z));
    this.world.poi.set('bigRollStairs', new THREE.Vector3(sx, yb + 0.3, S.zBottom + 0.8));
    void red;
  }

  /** Redraw the medal board (best time + medal). Cheap: only when the text changes. */
  updateBoard(best: number | null, medal: MedalId | null, assistedNote = false) {
    const key = `${best}|${medal}|${assistedNote}`;
    if (key === this.boardKey) return;
    this.boardKey = key;
    const tex = canvasTexture(512, 512, (ctx, cw, ch) => {
      ctx.fillStyle = '#1d1a26';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#2d2939';
      roundRect(ctx, 16, 16, cw - 32, ch - 32, 28);
      ctx.fill();
      fitText(ctx, 'THE BIG ROLL', cw / 2, 62, cw * 0.86, 56, { color: '#ffd23f', stroke: '#000', strokeW: 6 });
      fitText(ctx, 'Roof → Tumble St → Old Ballard → Downtown', cw / 2, 108, cw * 0.86, 22, { color: '#fff4dc', weight: '800' });
      let y = 160;
      for (const t of [...TIERS].reverse()) {
        const got = medal && rankOf(medal) >= rankOf(t.id);
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(70, y + 18, 18, 0, Math.PI * 2);
        ctx.fill();
        if (got) fitText(ctx, '✓', 70, y + 19, 30, 26, { color: '#1d1a26' });
        fitText(ctx, t.name.toUpperCase(), 105, y + 18, 230, 30, { color: '#fff', align: 'left' });
        fitText(ctx, t.id === 'bronze' ? 'FINISH' : `< ${fmtTime(t.time)}`, cw - 48, y + 18, 150, 30, { color: t.color, align: 'right' });
        y += 58;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(40, y + 4, cw - 80, 3);
      fitText(ctx, best != null ? `YOUR BEST  ${fmtTime(best)}` : 'YOUR BEST  --', cw / 2, y + 44, cw * 0.84, 36, { color: '#9ff3ff' });
      fitText(ctx, assistedNote ? 'Speed boosts count for Bronze only' : 'Gates only count while you are a ball', cw / 2, y + 92, cw * 0.84, 22, { color: '#fff4dc', weight: '800' });
    });
    const m = this.board.material as THREE.MeshStandardMaterial;
    m.map?.dispose();
    m.map = tex;
    m.emissiveMap = tex;
    m.needsUpdate = true;
  }

  // ------------------------------------------------------------------ gates
  private buildGates() {
    this.matNext = new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false });
    this.matTodo = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.matDone = new THREE.MeshBasicMaterial({ color: 0x3fcf66, transparent: true, opacity: 0.45, depthWrite: false });
    const ringGeos = new Map<number, THREE.BufferGeometry>();
    const ptsXZ: [number, number][] = [[START.x, START.z], ...GATES.map((g) => [g.x, g.z] as [number, number])];
    GATES.forEach((def, i) => {
      const gy = this.groundY(def.x, def.z, 60);
      const prev = ptsXZ[i];
      const next = ptsXZ[Math.min(ptsXZ.length - 1, i + 2)];
      const yaw = Math.atan2(next[0] - prev[0], next[1] - prev[1]);
      let geo = ringGeos.get(def.r);
      if (!geo) ringGeos.set(def.r, (geo = new THREE.TorusGeometry(def.r, 0.22, 8, 40)));
      const group = new THREE.Group();
      const center = new THREE.Vector3(def.x, gy + def.r - 0.25, def.z);
      group.position.copy(center);
      group.rotation.y = yaw;
      const ring = new THREE.Mesh(geo, this.matTodo);
      ring.userData.noMerge = true;
      group.add(ring);
      const last = i === GATES.length - 1;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(last ? 'FINISH' : `${i + 1} · ${def.name.toUpperCase()}`, last ? '#ff5f8f' : '#1d1a26'), depthWrite: false, toneMapped: false }));
      label.scale.set(5.2, 1.3, 1);
      label.position.set(0, def.r + 1.2, 0);
      group.add(label);
      this.root.add(group);
      this.gates.push({ def, center, groundY: gy, yaw, group, ring, label, passT: 0 });
    });
    // one beam, moved to the next gate
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.9, 70, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.beam.userData.noMerge = true;
    this.root.add(this.beam);
  }

  /** Colour the gates: done < next < todo; the beam stands on the next one. */
  setGateState(next: number) {
    this.gates.forEach((g, i) => {
      g.ring.material = i < next ? this.matDone : i === next ? this.matNext : this.matTodo;
      g.label.visible = i >= next;
      g.ring.scale.setScalar(1);
      // passed gates flash green for a moment, then get out of the camera's way
      g.group.visible = i >= next - 1;
      g.passT = 0;
    });
    const g = this.gates[next];
    this.beam.visible = !!g;
    if (g) this.beam.position.set(g.center.x, g.groundY + 35, g.center.z);
  }

  /** Per-frame: pulse the next gate, sway the pad glow. */
  animate(t: number, next: number, dt = 1 / 60) {
    const g = this.gates[next];
    if (g) g.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.04);
    const prev = this.gates[next - 1];
    if (prev?.group.visible) {
      prev.passT += dt;
      prev.ring.scale.setScalar(1 + prev.passT * 0.8);
      if (prev.passT > 0.6) prev.group.visible = false;
    }
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(t * 4) * 0.06;
  }

  showCourse(on: boolean) {
    for (const g of this.gates) g.group.visible = on;
    this.beam.visible = on;
    this.finishArch.visible = on;
    for (const p of this.pins) p.obj.visible = on;
  }

  // ------------------------------------------------------------------ finish: arch + pins
  private buildFinish() {
    const fin = GATES[GATES.length - 1];
    const prev = GATES[GATES.length - 2];
    const dir = new THREE.Vector3(fin.x - prev.x, 0, fin.z - prev.z).normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const gy = this.groundY(fin.x, fin.z, 60);
    // checkered line + banner on two pin posts (visual only: never blocks free play, and hidden when idle)
    const arch = new THREE.Group();
    const checker = canvasTexture(256, 32, (ctx, w, h) => {
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
          ctx.fillRect(i * 16, j * 16, 16, 16);
        }
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(fin.r * 2, 0.8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.position.y = 0.03;
    arch.add(line);
    arch.position.set(fin.x, gy, fin.z);
    arch.rotation.y = yaw;
    this.root.add(arch);
    this.finishArch = arch;
    // ten pins in a triangle a few metres past the line (head pin first)
    let k = 0;
    for (let row = 0; row < 4; row++) {
      for (let j = 0; j <= row; j++) {
        const lx = (j - row / 2) * 1.5;
        const lz = 3.2 + row * 1.35;
        const p = new THREE.Vector3(fin.x + dir.x * lz + -dir.z * lx, 0, fin.z + dir.z * lz + dir.x * lx);
        p.y = this.groundY(p.x, p.z, 60);
        const obj = makePin(1.35);
        obj.position.copy(p);
        obj.traverse((o) => (o.userData.noMerge = true));
        this.root.add(obj);
        this.pins.push({ obj, home: p.clone(), fall: 0, falling: false, axis: new THREE.Vector3(1, 0, 0), spin: 0, slide: new THREE.Vector3() });
        k++;
      }
    }
    void k;
  }

  resetPins() {
    for (const p of this.pins) {
      p.fall = 0;
      p.falling = false;
      p.obj.position.copy(p.home);
      p.obj.quaternion.identity();
    }
  }

  /** Knock pins near `pos` (moving with `vel`); returns how many started falling this call. */
  knockPins(pos: THREE.Vector3, vel: THREE.Vector3, radius = 1.4) {
    let n = 0;
    for (const p of this.pins) {
      if (p.falling) continue;
      const dx = p.obj.position.x - pos.x;
      const dz = p.obj.position.z - pos.z;
      if (dx * dx + dz * dz > radius * radius || Math.abs(pos.y - p.home.y) > 3) continue;
      this.tip(p, dx, dz, vel);
      n++;
    }
    // chain reaction: falling pins knock their neighbours
    for (const a of this.pins) {
      if (!a.falling || a.fall < 0.35 || a.fall > 0.9) continue;
      for (const b of this.pins) {
        if (b.falling) continue;
        const dx = b.obj.position.x - a.obj.position.x;
        const dz = b.obj.position.z - a.obj.position.z;
        if (dx * dx + dz * dz < 1.75 * 1.75) {
          this.tip(b, dx, dz, a.slide);
          n++;
        }
      }
    }
    return n;
  }

  private tip(p: PinVisual, dx: number, dz: number, vel: THREE.Vector3) {
    p.falling = true;
    const d = new THREE.Vector3(dx + vel.x * 0.08, 0, dz + vel.z * 0.08);
    if (d.lengthSq() < 1e-4) d.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    d.normalize();
    p.axis.set(d.z, 0, -d.x); // rotate so the top falls along d
    p.spin = (Math.random() - 0.5) * 6;
    p.slide.copy(d).multiplyScalar(1.5 + Math.min(12, Math.hypot(vel.x, vel.z)) * 0.25);
  }

  animatePins(dt: number) {
    for (const p of this.pins) {
      if (!p.falling || p.fall >= 1) continue;
      p.fall = Math.min(1, p.fall + dt * 2.6);
      const e = p.fall;
      _q.setFromAxisAngle(p.axis, e * e * (Math.PI / 2) * 0.98);
      p.obj.quaternion.copy(_q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.spin * e));
      p.obj.position.copy(p.home).addScaledVector(p.slide, e * 0.9);
      p.obj.position.y = p.home.y + 0.18 * e;
    }
  }

  get pinsDown() {
    return this.pins.filter((p) => p.falling).length;
  }
}

function rankOf(m: MedalId) {
  return { bronze: 1, silver: 2, gold: 3, platinum: 4 }[m];
}

function labelTexture(text: string, bg: string) {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = bg;
    roundRect(ctx, 6, 10, w - 12, h - 20, 40);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#ffd23f';
    ctx.stroke();
    fitText(ctx, text, w / 2, h / 2 + 2, w * 0.86, 58, { color: '#fff4dc', font: SIGN_FONT });
  });
}

let pinGeo: THREE.LatheGeometry | null = null;
let pinMats: THREE.Material[] | null = null;
/** A bowling pin `h` metres tall (origin at its base). Shared geometry/materials. */
export function makePin(h: number): THREE.Group {
  if (!pinGeo) {
    // profile (radius, height) for a 1 m pin
    const prof: [number, number][] = [
      [0.0, 0.0], [0.1, 0.0], [0.13, 0.05], [0.17, 0.2], [0.18, 0.3], [0.165, 0.42], [0.12, 0.55], [0.075, 0.64],
      [0.07, 0.7], [0.085, 0.8], [0.095, 0.87], [0.085, 0.94], [0.055, 0.985], [0.0, 1.0],
    ];
    pinGeo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 18);
    const tex = canvasTexture(64, 256, (ctx, w, hh) => {
      ctx.fillStyle = '#fbfaf5';
      ctx.fillRect(0, 0, w, hh);
      ctx.fillStyle = '#e8483c';
      // lathe v runs along the profile points (bottom → top): neck stripes at ~ v 0.6..0.7
      ctx.fillRect(0, hh * (1 - 0.625), w, hh * 0.03);
      ctx.fillRect(0, hh * (1 - 0.575), w, hh * 0.03);
    });
    pinMats = [new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 })];
  }
  const g = new THREE.Group();
  const m = new THREE.Mesh(pinGeo, pinMats![0]);
  m.scale.setScalar(h);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return g;
}
