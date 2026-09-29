import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import type { WaterSystem } from '../../world/Water';
import { makeMeltMaterial } from './MeltMaterial';
import { drawHumanBillboard, drawLabel, drawSlopBillboard } from './SlopArt';
import type { SlopFx } from './SlopFx';
import { canvasTexture, markOwned, surfaceY, terrainY, toast, worldOf, type Timeline } from './util';

const UP = new THREE.Vector3(0, 1, 0);

interface Face {
  center: THREE.Vector3;
  quat: THREE.Quaternion;
  w: number;
  h: number;
  depth: number;
  slopTex: THREE.Texture | null;
  ours: boolean;
}

/**
 * "Human Made": the six-fingered AI billboard at SlopCorp. A window-washer's catwalk with buckets of water runs
 * along its bottom edge (ladder at the end). Wash the billboard 3× from the catwalk and the slop melts away,
 * revealing a hand-painted portrait of the real, round Jimothy.
 *
 * Uses the north builder's billboard face if one is found near the `slopBillboard` POI (its art becomes the slop
 * layer); otherwise builds its own billboard.
 */
export class SlopBillboard {
  readonly entity: Entity;
  private mat: THREE.ShaderMaterial;
  private melt = 0;
  private target = 0;
  washes = 0;
  done = false;
  private completing = false;
  readonly face: Face;
  readonly normal = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  /** Middle of the catwalk (standing height) — the dragon swoops past here. */
  readonly catwalkPoint = new THREE.Vector3();
  private lastHintAt = -10;

  constructor(
    private game: Game,
    private fx: SlopFx,
    private timeline: Timeline,
    poiPos: THREE.Vector3,
    poiFound: boolean,
    campusCenter: THREE.Vector3,
  ) {
    const found = poiFound ? findBillboardFace(game, poiPos) : null;
    this.face = found ?? this.buildOwn(poiPos, campusCenter);
    const f = this.face;
    this.normal.set(0, 0, 1).applyQuaternion(f.quat);
    this.right.set(1, 0, 0).applyQuaternion(f.quat);

    // ---- the washable image layer
    const slopTex = f.slopTex ?? canvasTexture(1024, 448, drawSlopBillboard);
    const realTex = canvasTexture(1024, 448, drawHumanBillboard);
    this.mat = makeMeltMaterial(slopTex, realTex, 0.95);
    const overlay = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.h), this.mat);
    overlay.position.copy(f.center).addScaledVector(this.normal, f.depth / 2 + 0.025);
    overlay.quaternion.copy(f.quat);
    overlay.name = 'SlopBillboardImage';
    overlay.renderOrder = 1;
    markOwned(overlay);
    game.scene.add(overlay);

    // ---- catwalk + buckets
    const bottom = f.center.clone();
    bottom.y -= f.h / 2;
    const catwalkY = this.ensureCatwalk(bottom);
    this.catwalkPoint.copy(bottom).addScaledVector(this.normal, 0.7);
    this.catwalkPoint.y = catwalkY + 0.4;
    this.addBuckets(bottom, catwalkY);

    // ---- wash sensor (PROP group so Jimothy's wash/bonk overlap finds it)
    const sensorCenter = f.center.clone().addScaledVector(this.normal, f.depth / 2 + 0.45);
    sensorCenter.y -= 0.3;
    const body = game.physics.createBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(sensorCenter.x, sensorCenter.y, sensorCenter.z)
        .setRotation({ x: f.quat.x, y: f.quat.y, z: f.quat.z, w: f.quat.w }),
      [RAPIER.ColliderDesc.cuboid(f.w / 2, f.h / 2 + 0.3, 0.45).setSensor(true).setCollisionGroups(groups(G.PROP, G.PLAYER))],
    );
    const self = this;
    this.entity = game.entities.create({
      kind: 'static',
      name: 'AI Billboard',
      body,
      object: overlay,
      mass: 5000,
      tags: new Set(['slop', 'billboard']),
      data: { slopBillboard: true },
      onWash(g) {
        self.wash(g);
      },
      onBonk(g) {
        if (g.time - self.lastHintAt > 4) {
          self.lastHintAt = g.time;
          g.hint(self.done ? 'That billboard is human made now. Be gentle.' : 'The billboard ignores the bonk. It needs a WASH (there are buckets on the catwalk).', 3);
        }
        return true;
      },
    });
  }

  // ---------------------------------------------------------------- structure
  private buildOwn(poiPos: THREE.Vector3, campus: THREE.Vector3): Face {
    const game = this.game;
    const world = worldOf(game)!;
    const base = poiPos.clone();
    base.y = terrainY(game, base.x, base.z);
    // face the town (and the campus plaza) so it's seen from the road
    const toward = new THREE.Vector3(0 - base.x, 0, 0 - base.z).normalize().add(new THREE.Vector3(campus.x - base.x, 0, campus.z - base.z).normalize()).normalize();
    const yaw = Math.atan2(toward.x, toward.z);
    const quat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const W = 12;
    const H = 5.25;
    const lift = 6.6;
    const steel = world.material(0x4a4e57, { roughness: 0.5, metalness: 0.6 });
    const backMat = world.material(0x2b2f36, { roughness: 0.7 });
    const L = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyQuaternion(quat).add(base);
    // posts (climbable)
    for (const sx of [-3.8, 3.8]) {
      world.box(L(sx, (lift + H) / 2, -0.45), new THREE.Vector3(0.45, lift + H, 0.45), steel, { rotY: yaw });
    }
    // cross braces
    world.box(L(0, lift * 0.55, -0.45), new THREE.Vector3(7.6, 0.25, 0.2), steel, { rotY: yaw, collide: false });
    // back panel
    const center = L(0, lift + H / 2, 0);
    world.box(center, new THREE.Vector3(W + 0.4, H + 0.4, 0.3), backMat, { rotY: yaw });
    // top light bar (glows)
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0xfff1c9), emissiveIntensity: 1.2 });
    for (const sx of [-4, 0, 4]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.45), lampMat);
      lamp.position.copy(L(sx, lift + H + 0.35, 0.45));
      lamp.quaternion.copy(quat);
      world.staticRoot.add(markOwned(lamp));
    }
    // a little SlopCorp tag under the face
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.5),
      new THREE.MeshStandardMaterial({ map: canvasTexture(512, 86, (c, w, h) => drawLabel(c, w, h, ['SLOPCORP OUTDOOR · AI BILLBOARD #4'])) }),
    );
    tag.position.copy(L(0, lift - 0.35, 0.17));
    tag.quaternion.copy(quat);
    world.staticRoot.add(markOwned(tag));
    return { center, quat, w: W, h: H, depth: 0.3, slopTex: null, ours: true };
  }

  /** Make sure there's something to stand on in front of the face bottom; returns its top Y. */
  private ensureCatwalk(bottom: THREE.Vector3): number {
    const game = this.game;
    const world = worldOf(game)!;
    const f = this.face;
    const probe = bottom.clone().addScaledVector(this.normal, f.depth / 2 + 0.6);
    const top = surfaceY(game, probe.x, probe.z, bottom.y + 0.2);
    if (top > bottom.y - 1.3 && top < bottom.y + 0.3) return top; // builder already made one
    const y = bottom.y - 0.35;
    const yaw = new THREE.Euler().setFromQuaternion(f.quat, 'YXZ').y;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const L = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(bottom.x, 0, bottom.z));
    const grate = world.material(0x6d737c, { roughness: 0.55, metalness: 0.55 });
    const rail = world.material(0xf2c230, { roughness: 0.5, metalness: 0.3 });
    const d0 = f.depth / 2;
    const cw = f.w + 0.6;
    // floor
    world.box(L(0, y - 0.06, d0 + 0.6), new THREE.Vector3(cw, 0.12, 1.2), grate, { rotY: yaw, name: 'SlopCatwalk' });
    // front rail (visual) + low collider so you don't just roll off
    world.box(L(0, y + 0.95, d0 + 1.17), new THREE.Vector3(cw, 0.07, 0.07), rail, { rotY: yaw, collide: false });
    world.box(L(0, y + 0.5, d0 + 1.17), new THREE.Vector3(cw, 0.05, 0.05), rail, { rotY: yaw, collide: false });
    world.collider(L(0, y + 0.45, d0 + 1.18), new THREE.Vector3(cw, 0.9, 0.08), yaw);
    for (let i = 0; i <= 6; i++) {
      const lx = -cw / 2 + (i / 6) * cw;
      world.box(L(lx, y + 0.48, d0 + 1.17), new THREE.Vector3(0.07, 0.95, 0.07), rail, { rotY: yaw, collide: false });
    }
    // left side rail; right side is open (ladder)
    world.box(L(-cw / 2, y + 0.95, d0 + 0.6), new THREE.Vector3(0.07, 0.07, 1.2), rail, { rotY: yaw, collide: false });
    world.collider(L(-cw / 2, y + 0.45, d0 + 0.6), new THREE.Vector3(0.08, 0.9, 1.2), yaw);
    // ladder at the right end, down to the ground (climb it!)
    const lx = cw / 2 + 0.12;
    const lz = d0 + 0.6;
    const lp = L(lx, 0, lz);
    const gy = terrainY(game, lp.x, lp.z);
    const lh = y - gy + 0.02;
    world.box(L(lx, gy + lh / 2, lz), new THREE.Vector3(0.12, lh, 0.8), world.material(0xd0a41f, { roughness: 0.5, metalness: 0.4 }), { rotY: yaw, name: 'SlopLadder' });
    const rungMat = world.material(0x8a8f97, { metalness: 0.6, roughness: 0.4 });
    for (let yy = gy + 0.3; yy < y; yy += 0.35) {
      world.box(L(lx + 0.09, yy, lz), new THREE.Vector3(0.05, 0.05, 0.7), rungMat, { rotY: yaw, collide: false, castShadow: false });
    }
    // sign at the foot of the ladder
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.75),
      new THREE.MeshStandardMaterial({ map: canvasTexture(384, 192, (c, w, h) => drawLabel(c, w, h, ['WINDOW WASHERS ONLY', 'buckets provided ↑'], { bg: '#f2c230', fg: '#1c1530', accent: '#1c1530' })) }),
    );
    sign.position.copy(L(lx + 0.8, gy + 1.3, lz + 0.2));
    sign.quaternion.copy(q);
    world.staticRoot.add(markOwned(sign));
    world.collider(L(lx + 0.8, gy + 0.65, lz + 0.15), new THREE.Vector3(0.1, 1.3, 0.1), yaw);
    return y;
  }

  private addBuckets(bottom: THREE.Vector3, catwalkY: number) {
    const game = this.game;
    const world = worldOf(game)!;
    const water = game.get<WaterSystem>('water');
    const f = this.face;
    const bucketMat = world.material(0x3a7bd5, { roughness: 0.5 });
    const handleMat = world.material(0xb0b4bb, { roughness: 0.4, metalness: 0.7 });
    for (const t of [-0.34, 0, 0.34]) {
      const p = bottom.clone().addScaledVector(this.right, t * f.w).addScaledVector(this.normal, f.depth / 2 + 0.75);
      p.y = catwalkY;
      const g = new THREE.Group();
      const pail = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.21, 0.36, 18, 1, true), bucketMat);
      pail.position.y = 0.18;
      (pail.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      const floor = new THREE.Mesh(new THREE.CircleGeometry(0.21, 18).rotateX(-Math.PI / 2), bucketMat);
      floor.position.y = 0.01;
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.012, 6, 20, Math.PI), handleMat);
      handle.position.y = 0.36;
      handle.rotation.y = Math.PI / 2;
      // squeegee leaning in the bucket
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), handleMat);
      stick.position.set(0.08, 0.45, 0);
      stick.rotation.z = -0.35;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.04), world.material(0x222222));
      blade.position.set(0.2, 0.8, 0);
      blade.rotation.z = -0.35;
      g.add(pail, floor, handle, stick, blade);
      g.position.copy(p);
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      world.staticRoot.add(markOwned(g));
      world.collider(p.clone().add(new THREE.Vector3(0, 0.17, 0)), new THREE.Vector3(0.44, 0.34, 0.44));
      water?.addCircle({ name: 'Window-Washer Bucket', kind: 'sink', center: p.clone().add(new THREE.Vector3(0, 0.31, 0)), radius: 0.22, depth: 0.2 });
    }
  }

  // ---------------------------------------------------------------- washing
  private wash(game: Game) {
    const pos = this.catwalkPoint.clone();
    if (this.done || this.completing) {
      game.score(10, 'Admired Real Art', pos);
      if (game.time - this.lastHintAt > 4) {
        this.lastHintAt = game.time;
        game.hint('It’s already human made. It’s perfect as it is.', 2.5);
      }
      return;
    }
    this.washes++;
    this.target = Math.min(1, this.target + 0.345);
    game.sfx('scrub', pos, 1);
    game.sfx('fizz', pos, 0.6);
    game.sfx('slop_glitch', pos, 0.4, 0.8);
    this.drips();
    if (this.target >= 1) {
      this.completing = true;
      this.timeline.later(1.6, () => this.complete());
    } else {
      game.score(60, 'Scrubbed The Slop', pos);
      game.hint(`The AI image is melting! Keep scrubbing… (${this.washes}/3)`, 2.5);
    }
  }

  private complete() {
    const game = this.game;
    this.done = true;
    this.completing = false;
    const pos = this.catwalkPoint.clone();
    game.score(800, 'Human Made', pos);
    toast(game, 'HUMAN MADE', 'The slop melted away. Underneath: a real painting of a real, round raccoon.', '🖌️');
    game.sfx('jingle_win');
    game.sfx('crowd_cheer', pos, 0.6);
    for (let i = 0; i < 6; i++) {
      const p = this.face.center.clone().addScaledVector(this.right, (i / 5 - 0.5) * this.face.w).addScaledVector(this.normal, 0.4);
      this.fx.burst(p, 18, i % 2 ? 0xffd23a : 0xff7ab8, 5, 3, 1.2, 9, 0.5);
    }
    game.events.emit('billboardWashed', { position: pos, washes: this.washes });
  }

  private drips() {
    // water droplets along the current melt front
    const f = this.face;
    const y = f.center.y + f.h / 2 - this.target * f.h;
    for (let i = 0; i < 10; i++) {
      const p = f.center.clone().addScaledVector(this.right, (Math.random() - 0.5) * f.w).addScaledVector(this.normal, f.depth / 2 + 0.1);
      p.y = y;
      this.fx.burst(p, 4, 0x7fd8ff, 0.8, -0.5, 0.9, 12, 0.1);
    }
  }

  /** SlopCorp "pivots": the billboard is regenerated (for the sandbox; the objective stays done). */
  reslop() {
    if (!this.done && this.target === 0) return;
    this.done = false;
    this.completing = false;
    this.target = 0;
    this.washes = 0;
  }

  update(dt: number) {
    const u = this.mat.uniforms;
    u.uTime.value = this.game.time;
    const k = this.target > this.melt ? 0.45 : 0.25;
    this.melt += THREE.MathUtils.clamp(this.target - this.melt, -k * dt, k * dt);
    u.uMelt.value = this.melt;
    // the AI layer glitches now and then
    u.uGlitch.value = !this.done && Math.sin(this.game.time * 1.7) > 0.93 ? 1 : 0;
  }
}

/** Heuristic: the builder's billboard face = the largest box-shaped mesh with a texture on its +Z side near the POI. */
function findBillboardFace(game: Game, poiPos: THREE.Vector3): Face | null {
  const world = worldOf(game);
  if (!world) return null;
  let best: Face | null = null;
  let bestScore = 0;
  const wp = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  const ws = new THREE.Vector3();
  world.staticRoot.updateMatrixWorld(true);
  world.staticRoot.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.slopOwned) return;
    const g = m.geometry as THREE.BufferGeometry & { parameters?: { width: number; height: number; depth: number } };
    if (g.type !== 'BoxGeometry' || !g.parameters) return;
    m.matrixWorld.decompose(wp, wq, ws);
    const w = g.parameters.width * ws.x;
    const h = g.parameters.height * ws.y;
    const d = g.parameters.depth * ws.z;
    const area = w * h;
    if (area < 14 || d > 1.2 || h > w * 1.2) return;
    if (wp.distanceTo(poiPos) > 30) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const front = (mats[4] ?? mats[0]) as THREE.MeshStandardMaterial;
    if (!front || !front.map) return;
    const score = area * (/billboard/i.test(m.name) ? 3 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = { center: wp.clone(), quat: wq.clone(), w, h, depth: d, slopTex: front.map, ours: false };
    }
  });
  return best;
}
