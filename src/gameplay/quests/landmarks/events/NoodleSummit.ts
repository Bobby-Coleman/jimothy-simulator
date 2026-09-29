import * as THREE from 'three';
import type { Game } from '../../../../core/Game';
import type { CameraRig } from '../../../../player/CameraRig';
import { RAPIER, G, groups } from '../../../../core/Physics';
import { Landmark } from '../Landmark';
import { bannerTexture } from '../kit/text';
import { signBoard, stdMat } from '../kit/Props';

const SUMMIT_R = 8;
const LEAP_MIN = 20;

/**
 * Top of the Space Noodle (POIs `spaceNoodleBase`, `spaceNoodleTop`).
 * Reaching the top deck → camera swoop + "TOP OF THE NOODLE" ('noodleSummit').
 * Jumping off from there and landing (anywhere, any way) ≥ 20 m lower → "Leap of Faith" ('leapOfFaith' { height }).
 */
export class NoodleSummit extends Landmark {
  readonly id = 'noodle';
  readonly title = 'Top of the Noodle';
  private base = new THREE.Vector3(140, 0, -10);
  private top = new THREE.Vector3(140, 55, -10);
  private summitY = 50;
  private onTop = false;
  private leap: { peak: number; startY: number } | null = null;
  private wasGrounded = true;
  private elevator: Elevator | null = null;
  private swoop = false;

  setup() {
    const k = this.kit;
    const base = k.poi('spaceNoodleBase');
    const top = k.poi('spaceNoodleTop');
    if (top) {
      this.top.copy(top);
      this.base.copy(base ?? new THREE.Vector3(top.x, k.world.heightAt(top.x, top.z), top.z));
    } else {
      const s = base ? base.clone() : k.findClearSpot(148, 28, 11, 70);
      k.reserve(s, 12);
      this.base.copy(s);
      const built = buildFallbackNoodle(this.game, s);
      this.top.copy(built.top);
      this.elevator = built.elevator;
      k.world.poi.set('spaceNoodleBase', this.base.clone());
      k.world.poi.set('spaceNoodleTop', this.top.clone());
    }
    this.summitY = Math.min(this.base.y + 50, this.top.y - 3);
  }

  anchor() {
    return this.top;
  }

  hint() {
    if (this.step === 'leapt') return 'You jumped off the Space Noodle. You are fine. You are a ball.';
    if (this.done) return 'Now take the Leap of Faith: jump off the top and land (it is fine, you are round).';
    return 'Get to the top deck of the Space Noodle, Downtown (east).';
  }

  debugSpot() {
    return { pos: this.top.clone().add(new THREE.Vector3(2, 1.2, 0)), facing: 0 };
  }

  update(dt: number) {
    this.elevator?.update(dt, this.game.time);
    const p = this.player;
    if (!p) return;
    const pos = p.position;
    const dTop = this.flatDist(this.top);
    const up = dTop < SUMMIT_R && pos.y > this.summitY && pos.y < this.top.y + 12;
    if (up && !this.onTop && p.mode !== 'ragdoll') {
      this.onTop = true;
      this.leap = null;
      this.summit();
    }
    if (this.onTop) {
      // leaving the deck by falling = a leap
      if (!p.grounded && p.mode !== 'climb' && pos.y < this.summitY - 2 && !this.leap) {
        this.leap = { peak: pos.y, startY: pos.y };
        this.onTop = false;
      } else if (dTop > 30 || pos.y < this.summitY - 25) {
        this.onTop = false;
      }
    }
    if (this.leap) {
      this.leap.peak = Math.max(this.leap.peak, pos.y);
      if (p.mode === 'climb' || p.mode === 'hang') this.leap = null; // grabbed on: not a leap
      else if ((p.grounded && !this.wasGrounded) || p.mode === 'swim' || (p.grounded && p.velocity.y > -0.5)) {
        const h = this.leap.peak - pos.y;
        this.leap = null;
        if (h >= LEAP_MIN) this.leapOfFaith(h);
      }
    }
    this.wasGrounded = p.grounded;
  }

  private summit() {
    const k = this.kit;
    const first = !this.done;
    k.banner('TOP OF THE NOODLE', 'Seattle is beautiful. Jimothy is round.', 3.5, 'Space Noodle');
    this.game.sfx('objective_complete', undefined, 0.8);
    this.game.sfx('crowd_ooh', this.top, 0.6);
    k.fx('sparkles', this.player!.position.clone().add(new THREE.Vector3(0, 0.6, 0)), { radius: 1.2, count: 20 });
    this.cameraSwoop();
    this.game.events.emit('noodleSummit', { first });
    if (first) {
      this.game.score(500, 'Top Of The Noodle', this.top.clone());
      this.setStep('summit');
      this.complete();
      k.after(4, () => k.hint('Leap of Faith? Jump off. You are a ball. You will bounce.', 4));
    } else {
      this.game.score(50, 'Noodle Again');
    }
  }

  private leapOfFaith(h: number) {
    const k = this.kit;
    const first = this.step !== 'leapt';
    k.shout('LEAP OF FAITH!', `${h.toFixed(0)} m · Jimothy is fine. He's a ball.`, '#ffd84a');
    this.game.sfx('crowd_cheer', this.player?.position, 0.8);
    this.game.sfx('boing', this.player?.position, 1, 0.7);
    this.game.get<CameraRig>('camera')?.shake(0.8);
    this.game.score(first ? 800 : 150, first ? 'Faith Rewarded' : 'Another Leap Of Faith', this.player?.position.clone());
    this.game.events.emit('leapOfFaith', { height: h });
    if (first) this.setStep('leapt');
  }

  /** Brief orbit around Jimothy with the city spread out below. Any jump/grab press skips it. */
  private cameraSwoop() {
    const rig = this.game.get<CameraRig>('camera');
    const p = this.player;
    if (!rig || !p || rig.override || this.swoop) return;
    this.swoop = true;
    const dur = 3.4;
    const yaw0 = rig.yaw;
    let t = 0;
    p.frozen = true;
    const end = (ang: number, r: number, h: number) => {
      rig.override = null;
      rig.yaw = ang;
      rig.pitch = THREE.MathUtils.clamp(-Math.atan2(h, r), -1.2, 0.3);
      p.frozen = false;
      this.swoop = false;
      this.game.camera.fov = rig.baseFov;
      this.game.camera.updateProjectionMatrix();
    };
    rig.override = (cam, dt) => {
      t += dt;
      const k = Math.min(1, t / dur);
      const e = k * k * (3 - 2 * k);
      const ang = yaw0 + e * Math.PI * 1.5;
      const bell = Math.sin(k * Math.PI);
      const r = 5 + 16 * bell;
      const h = 1.8 + 9 * bell;
      const tgt = p.cameraTarget;
      cam.position.set(tgt.x + Math.sin(ang) * r, tgt.y + h, tgt.z + Math.cos(ang) * r);
      cam.lookAt(tgt);
      cam.fov = rig.baseFov + 14 * bell;
      cam.updateProjectionMatrix();
      const skip = t > 0.4 && (this.game.input.pressed('jump') || this.game.input.pressed('grab'));
      if (k >= 1 || skip || this.game.state === 'title') end(ang, r, h);
    };
  }
}

// ================================================================== fallback tower (only if no POIs)

/** Kinematic elevator platform that shuttles between the ground and the deck. */
class Elevator {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  private y: number;
  private phase: 'waitBottom' | 'up' | 'waitTop' | 'down' = 'waitBottom';
  private t = 0;
  constructor(
    game: Game,
    private x: number,
    private z: number,
    private y0: number,
    private y1: number,
  ) {
    this.y = y0;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 3), stdMat(0xf2c14e, { metalness: 0.5, roughness: 0.4 }));
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    game.scene.add(this.mesh);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y0 - 0.15, z);
    const cd = RAPIER.ColliderDesc.cuboid(1.5, 0.15, 1.5).setFriction(1).setCollisionGroups(groups(G.WORLD));
    this.body = game.physics.createBody(desc, [cd], this.mesh);
  }
  update(dt: number, _time: number) {
    const speed = 3.2;
    this.t += dt;
    switch (this.phase) {
      case 'waitBottom':
        if (this.t > 3) (this.phase = 'up'), (this.t = 0);
        break;
      case 'up':
        this.y = Math.min(this.y1, this.y + speed * dt);
        if (this.y >= this.y1) (this.phase = 'waitTop'), (this.t = 0);
        break;
      case 'waitTop':
        if (this.t > 4) (this.phase = 'down'), (this.t = 0);
        break;
      case 'down':
        this.y = Math.max(this.y0, this.y - speed * dt);
        if (this.y <= this.y0) (this.phase = 'waitBottom'), (this.t = 0);
        break;
    }
    this.body.setNextKinematicTranslation({ x: this.x, y: this.y - 0.15, z: this.z });
    this.mesh.position.set(this.x, this.y - 0.15, this.z);
  }
}

function buildFallbackNoodle(game: Game, base: THREE.Vector3) {
  const world = game.get<any>('world');
  const H = 62;
  const g = base.y;
  const white = stdMat(0xe9ecef, { roughness: 0.5, metalness: 0.2 });
  const gold = stdMat(0xf2a33a, { roughness: 0.45, metalness: 0.3 });
  // column
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, H, 20), white);
  col.position.set(base.x, g + H / 2, base.z);
  world.addStatic(col, { collider: 'none' });
  game.physics.staticCollider(RAPIER.ColliderDesc.cylinder(H / 2, 1.5).setTranslation(base.x, g + H / 2, base.z).setCollisionGroups(groups(G.WORLD)));
  // three splayed legs (visual)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 30, 10), white);
    leg.position.set(base.x + Math.cos(a) * 3.2, g + 14, base.z + Math.sin(a) * 3.2);
    leg.lookAt(base.x, g + 30, base.z);
    leg.rotateX(Math.PI / 2);
    world.addStatic(leg, { collider: 'none' });
  }
  // saucer deck
  const deckTop = g + H;
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 5.5, 2.2, 36), gold);
  deck.position.set(base.x, deckTop - 1.1, base.z);
  world.addStatic(deck, { collider: 'none' });
  game.physics.staticCollider(RAPIER.ColliderDesc.cylinder(1.1, 7.2).setTranslation(base.x, deckTop - 1.1, base.z).setCollisionGroups(groups(G.WORLD)).setFriction(0.9));
  const halo = new THREE.Mesh(new THREE.TorusGeometry(8.2, 0.25, 8, 48), white);
  halo.rotation.x = Math.PI / 2;
  halo.position.set(base.x, deckTop + 0.6, base.z);
  world.addStatic(halo, { collider: 'none' });
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 7, 12), white);
  spire.position.set(base.x, deckTop + 3.5, base.z);
  world.addStatic(spire, { collider: 'none' });
  game.physics.staticCollider(RAPIER.ColliderDesc.cylinder(3.5, 0.35).setTranslation(base.x, deckTop + 3.5, base.z).setCollisionGroups(groups(G.WORLD)));
  // elevator shaft just outside the deck, with a bridge onto it
  const ex = base.x + 9.2;
  const ez = base.z;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 2.4), gold);
  bridge.position.set(base.x + 7.15, deckTop - 0.15, base.z);
  world.addStatic(bridge, { collider: 'box' });
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, deckTop - g + 1, 0.2), white);
    rail.position.set(ex + 1.7, g + (deckTop - g + 1) / 2, ez + s * 1.7);
    world.addStatic(rail, { collider: 'none' });
  }
  const sign = signBoard(3.2, 0.9, bannerTexture('NOODLE EXPRESS', 'ELEVATOR · RACCOONS RIDE FREE', { bg: '#1f3d7a', fg: '#fff', border: '#f2a33a', sub: '#f2c14e' }, 1024, 256));
  sign.position.set(ex, g + 3.4, ez - 2.2);
  world.addStatic(sign, { collider: 'none' });
  const elevator = new Elevator(game, ex, ez, g + 0.15, deckTop);
  return { top: new THREE.Vector3(base.x, deckTop, base.z), elevator };
}
