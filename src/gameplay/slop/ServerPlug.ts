import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import type { Jimothy } from '../../player/Jimothy';
import type { CameraRig } from '../../player/CameraRig';
import { drawLabel } from './SlopArt';
import type { SlopFx } from './SlopFx';
import { canvasTexture, markOwned, rand, terrainY, worldOf } from './util';

const UP = new THREE.Vector3(0, 1, 0);
const PRONG = 3.1; // enterprise-grade prongs: 3 m long, for reliability
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * "Touch Grass": SlopCorp's giant power plug. It sits in a transformer-sized socket; grab it (it's heavy, so
 * Jimothy drags it) and pull it ~3 m out along its enormous prongs. It resists, sparks and creaks. When the prong
 * tips clear the socket it's UNPLUGGED (callback), the plug flops free on its cable. Later SlopCorp "pivots" and
 * plugs it back in (replug()).
 */
export class ServerPlug {
  readonly entity: Entity;
  readonly body: RAPIER.RigidBody;
  private plugObj = new THREE.Group();
  private prongs: THREE.Mesh[] = [];
  private cable: THREE.Mesh;
  private cableMat: THREE.MeshStandardMaterial;
  private lastCableAt = new THREE.Vector3(1e9, 0, 0);
  private beacon: THREE.Mesh;
  private beaconMat: THREE.MeshStandardMaterial;
  private beaconLight: THREE.PointLight;
  readonly seatPos = new THREE.Vector3();
  readonly seatQuat = new THREE.Quaternion();
  readonly axis = new THREE.Vector3();
  readonly socketMouth = new THREE.Vector3();
  readonly anchor = new THREE.Vector3();
  seated = true;
  private pulledOut = 0;
  private sparkT = 0;
  private creakT = 0;
  private hintT = 0;
  private slowed = false;
  private savedSpeedMul = 1;
  alarm = false;
  private prongsCollide = false;
  private readonly maxCable = 17;

  constructor(
    private game: Game,
    private fx: SlopFx,
    socketGround: THREE.Vector3,
    faceDir: THREE.Vector3,
    private onUnplug: () => void,
  ) {
    const world = worldOf(game)!;
    const yaw = Math.atan2(faceDir.x, faceDir.z);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const base = socketGround.clone();
    base.y = terrainY(game, base.x, base.z);
    const L = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(base);
    this.axis.set(0, 0, 1).applyQuaternion(q);

    // ---- the transformer / socket block
    const TW = 2.8;
    const TH = 3.0;
    const TD = 3.8;
    const bodyMat = world.material(0x3c4a5c, { roughness: 0.6, metalness: 0.35 });
    const faceMat = world.material(0xe9e6df, { roughness: 0.5 });
    const slotMat = world.material(0x0b0b0e, { roughness: 0.9 });
    world.box(L(0, TH / 2, -TD / 2), new THREE.Vector3(TW, TH, TD), bodyMat, { rotY: yaw, name: 'SlopTransformer' });
    // cooling fins
    for (let i = 0; i < 6; i++) {
      for (const sx of [-1, 1]) {
        world.box(L(sx * (TW / 2 + 0.06), TH * 0.5, -0.5 - i * 0.55), new THREE.Vector3(0.12, TH * 0.75, 0.08), bodyMat, { rotY: yaw, collide: false, castShadow: false });
      }
    }
    // outlet plate + slots
    const plateY = 0.86; // low enough for tiny raccoon hands
    world.box(L(0, plateY + 0.12, 0.03), new THREE.Vector3(1.5, 1.55, 0.06), faceMat, { rotY: yaw, collide: false });
    for (const sx of [-0.28, 0.28]) world.box(L(sx, plateY - 0.08, 0.065), new THREE.Vector3(0.16, 0.42, 0.02), slotMat, { rotY: yaw, collide: false, castShadow: false });
    world.box(L(0, plateY + 0.36, 0.065), new THREE.Vector3(0.22, 0.22, 0.02), slotMat, { rotY: yaw, collide: false, castShadow: false });
    // label + warning stripes
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.75),
      new THREE.MeshStandardMaterial({
        map: canvasTexture(768, 222, (c, w, h) => drawLabel(c, w, h, ['SLOPCORP MAIN POWER', 'DO NOT UNPLUG · seriously · this runs ALL the slop'], { bg: '#1c1530', accent: '#ffd23a' })),
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.25,
      }),
    );
    label.material.emissiveMap = label.material.map;
    label.position.copy(L(0, TH - 0.5, 0.02));
    label.quaternion.copy(q);
    world.staticRoot.add(markOwned(label));
    const stripes = canvasTexture(256, 32, (c, w, h) => {
      for (let i = -2; i < 20; i++) {
        c.fillStyle = i % 2 ? '#ffd23a' : '#1a1a1a';
        c.beginPath();
        c.moveTo(i * 16, h);
        c.lineTo(i * 16 + 16, h);
        c.lineTo(i * 16 + 32, 0);
        c.lineTo(i * 16 + 16, 0);
        c.fill();
      }
    });
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(TW, 0.3), new THREE.MeshStandardMaterial({ map: stripes }));
    stripe.position.copy(L(0, 0.2, 0.02));
    stripe.quaternion.copy(q);
    world.staticRoot.add(markOwned(stripe));

    // alarm beacon on top (dark until SLOP GENERATION HALTED)
    this.beaconMat = new THREE.MeshStandardMaterial({ color: 0x661111, emissive: new THREE.Color(0xff2a2a), emissiveIntensity: 0, roughness: 0.3 });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.4, 14), this.beaconMat);
    this.beacon.position.copy(L(0, TH + 0.2, -0.6));
    this.beacon.userData.noMerge = true; // it spins + flashes (keep it out of the static batcher)
    world.staticRoot.add(markOwned(this.beacon));
    this.beaconLight = new THREE.PointLight(0xff2020, 0, 14, 2);
    this.beaconLight.position.copy(this.beacon.position).add(new THREE.Vector3(0, 0.4, 0));
    game.scene.add(this.beaconLight);

    // junction box = cable anchor ("TO DATA CENTER")
    const jb = L(TW / 2 + 1.2, 0.55, 0.9);
    world.box(jb, new THREE.Vector3(0.9, 1.1, 0.7), world.material(0x55606e, { roughness: 0.6, metalness: 0.4 }), { rotY: yaw });
    const jl = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.3),
      new THREE.MeshStandardMaterial({ map: canvasTexture(256, 96, (c, w, h) => drawLabel(c, w, h, ['TO DATA CENTER →'], { bg: '#ffd23a', fg: '#1c1530', accent: '#1c1530' })) }),
    );
    jl.position.copy(L(TW / 2 + 1.2, 0.8, 1.26));
    jl.quaternion.copy(q);
    world.staticRoot.add(markOwned(jl));
    this.anchor.copy(L(TW / 2 + 1.2, 0.9, 1.3));

    // ---- the plug
    const plugMat = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.55, metalness: 0.1 });
    const prongMat = new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.2, metalness: 1.0 });
    const PW = 1.25;
    const PH = 1.0;
    const PD = 0.95;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, PD), plugMat);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(PW * 0.8, PH * 0.8, 0.5), plugMat);
    grip.position.z = PD / 2 + 0.2;
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.5, 12).rotateX(Math.PI / 2), plugMat);
    boot.position.z = PD / 2 + 0.6;
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(PW * 0.9, 0.34),
      new THREE.MeshStandardMaterial({ map: canvasTexture(384, 128, (c, w, h) => drawLabel(c, w, h, ['SLOPCORP', '250,000 V · 3 m PRONGS'], { bg: '#23252b', accent: '#7df9ff' })) }),
    );
    logo.position.set(0, PH / 2 + 0.001, 0);
    logo.rotation.x = -Math.PI / 2;
    this.plugObj.add(shell, grip, boot, logo);
    for (const sx of [-0.28, 0.28]) {
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, PRONG), prongMat);
      prong.position.set(sx, -0.08, -PD / 2 - PRONG / 2);
      this.prongs.push(prong);
      this.plugObj.add(prong);
    }
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, PRONG * 0.9, 10).rotateX(Math.PI / 2), prongMat);
    ground.position.set(0, 0.36, -PD / 2 - PRONG * 0.45);
    this.plugObj.add(ground);
    this.plugObj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    markOwned(this.plugObj);
    this.plugObj.name = 'SlopCorpPlug';
    game.scene.add(this.plugObj);

    this.seatQuat.copy(q);
    this.seatPos.copy(L(0, plateY, PD / 2 + 0.07));
    this.socketMouth.copy(L(0, plateY, 0.1));
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.seatPos.x, this.seatPos.y, this.seatPos.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.6)
      .setAngularDamping(0.8)
      .setGravityScale(0)
      .setCcdEnabled(true);
    const cd = RAPIER.ColliderDesc.cuboid(PW / 2, PH / 2, PD / 2 + 0.25)
      .setTranslation(0, 0, 0.25)
      .setMass(45)
      .setFriction(0.8)
      .setCollisionGroups(groups(G.PROP));
    this.body = game.physics.createBody(desc, [cd], this.plugObj);
    this.body.lockRotations(true, true);
    const self = this;
    this.entity = game.entities.create({
      kind: 'prop',
      name: 'Giant Power Plug',
      body: this.body,
      object: this.plugObj,
      mass: 45,
      tags: new Set(['grabbable', 'slop', 'plug', 'noclimb']),
      data: { size: new THREE.Vector3(PW, PH, PD), serverPlug: true },
      onGrab(g) {
        if (self.seated) g.hint('PULL! Drag the plug straight out — 3 m of enterprise-grade prong!', 3);
      },
      onBonk(g) {
        if (self.seated) {
          g.hint('Bonking won’t unplug it. GRAB it and drag it out!', 2.5);
          self.fx.burst(self.socketMouth, 12, 0x9ff3ff, 4, 2, 0.4);
          g.sfx('short_circuit', self.socketMouth, 0.4);
          return true;
        }
      },
    });

    // ---- cable
    this.cableMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7 });
    this.cable = new THREE.Mesh(new THREE.BufferGeometry(), this.cableMat);
    this.cable.castShadow = true;
    this.cable.name = 'SlopCorpCable';
    markOwned(this.cable);
    game.scene.add(this.cable);
    this.updateCable(true);
  }

  get pluggedIn() {
    return this.seated;
  }

  /** Plug position along the socket axis (0 = fully in). */
  private axial(p: THREE.Vector3) {
    return _v.copy(p).sub(this.seatPos).dot(this.axis);
  }

  update(dt: number) {
    const game = this.game;
    const b = this.body;
    const player = game.get<Jimothy>('player');
    const dragging = player?.held?.entity === this.entity;
    if (this.seated) {
      const t = b.translation();
      const s = this.axial(_v.set(t.x, t.y, t.z));
      this.pulledOut = s;
      // resistance: the socket wants its plug back
      const v = b.linvel();
      const va = v.x * this.axis.x + v.y * this.axis.y + v.z * this.axis.z;
      const F = -(dragging ? 260 : 520) * s - 90 * va;
      b.applyImpulse({ x: this.axis.x * F * dt, y: this.axis.y * F * dt, z: this.axis.z * F * dt }, true);
      // slow Jimothy down while he hauls it
      if (dragging && !this.slowed && player) {
        this.slowed = true;
        this.savedSpeedMul = player.speedMul;
        player.speedMul = this.savedSpeedMul * 0.6;
      }
      if (s > 0.12) {
        this.sparkT -= dt;
        if (this.sparkT <= 0) {
          this.sparkT = rand(0.05, 0.18);
          this.fx.burst(this.socketMouth, 6 + Math.floor(s * 4), Math.random() < 0.5 ? 0xbff8ff : 0xffe066, 4 + s, 2, 0.45);
          if (Math.random() < 0.3) game.sfx('short_circuit', this.socketMouth, 0.25 + s * 0.12);
        }
        this.creakT -= dt;
        if (dragging && this.creakT <= 0) {
          this.creakT = rand(0.7, 1.3);
          game.sfx('creak', this.seatPos, 0.6, 0.7);
          game.get<CameraRig>('camera')?.shake(0.08 + s * 0.03);
        }
        this.hintT -= dt;
        if (dragging && this.hintT <= 0) {
          this.hintT = 1.2;
          game.hint(`Unplugging SlopCorp… ${Math.min(99, Math.round((s / PRONG) * 100))}%`, 1.3);
        }
      }
    }
    if (!dragging && this.slowed && player) {
      this.slowed = false;
      player.speedMul = this.savedSpeedMul;
    }
    if (!this.seated) {
      // tethered by its cable
      const t = b.translation();
      const d = _v.set(t.x, t.y, t.z).sub(this.anchor);
      const len = d.length();
      if (len > this.maxCable) {
        d.normalize();
        const over = len - this.maxCable;
        const v = b.linvel();
        const vo = v.x * d.x + v.y * d.y + v.z * d.z;
        const J = -(over * 900 + Math.max(0, vo) * 60) * dt;
        b.applyImpulse({ x: d.x * J, y: d.y * J, z: d.z * J }, true);
      }
    }
    // alarm beacon
    if (this.alarm) {
      const k = Math.sin(game.time * 12) > 0 ? 1 : 0.1;
      this.beaconMat.emissiveIntensity = 3.5 * k;
      this.beaconLight.intensity = 6 * k;
      this.beacon.rotation.y += dt * 8;
    }
  }

  /** After the physics step: keep the plug on its prongs' rail while it's in the socket. */
  postPhysics() {
    const b = this.body;
    if (this.seated) {
      const t = b.translation();
      let s = this.axial(_v.set(t.x, t.y, t.z));
      if (s >= PRONG - 0.05) {
        this.popOut();
        return;
      }
      s = Math.max(0, s);
      const p = _v.copy(this.seatPos).addScaledVector(this.axis, s);
      b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      b.setRotation({ x: this.seatQuat.x, y: this.seatQuat.y, z: this.seatQuat.z, w: this.seatQuat.w }, true);
      const v = b.linvel();
      let va = v.x * this.axis.x + v.y * this.axis.y + v.z * this.axis.z;
      if (s <= 0 && va < 0) va = 0;
      b.setLinvel({ x: this.axis.x * va, y: this.axis.y * va, z: this.axis.z * va }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.plugObj.position.copy(p);
      this.plugObj.quaternion.copy(this.seatQuat);
    }
    this.updateCable(false);
  }

  private popOut() {
    const game = this.game;
    const b = this.body;
    this.seated = false;
    this.pulledOut = PRONG;
    b.setGravityScale(1, true);
    b.lockRotations(false, true);
    if (!this.prongsCollide) {
      this.prongsCollide = true;
      for (const sx of [-0.28, 0.28]) {
        const cd = RAPIER.ColliderDesc.cuboid(0.065, 0.18, PRONG / 2)
          .setTranslation(sx, -0.08, -0.475 - PRONG / 2)
          .setMass(2)
          .setCollisionGroups(groups(G.PROP));
        const c = game.physics.world.createCollider(cd, b);
        game.entities.bindCollider(c, this.entity);
      }
    }
    const v = b.linvel();
    b.setLinvel({ x: v.x + this.axis.x * 2, y: 3, z: v.z + this.axis.z * 2 }, true);
    b.setAngvel({ x: rand(-1.5, 1.5), y: rand(-1, 1), z: rand(-1.5, 1.5) }, true);
    this.fx.burst(this.socketMouth, 140, 0xbff8ff, 9, 4, 1.1, 14, 0.4);
    this.fx.burst(this.socketMouth, 60, 0xffc040, 7, 5, 1.3, 14, 0.4);
    game.sfx('short_circuit', this.socketMouth, 1);
    game.sfx('impact_metal', this.socketMouth, 0.9, 0.7);
    game.get<CameraRig>('camera')?.shake(0.6);
    this.onUnplug();
  }

  /** Debug / scripted: yank it all the way out right now. */
  forceUnplug() {
    if (!this.seated) return;
    const p = this.seatPos.clone().addScaledVector(this.axis, PRONG);
    this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
    this.plugObj.position.copy(p);
    this.popOut();
  }

  /** SlopCorp pivots: the plug is shoved back into its socket. */
  replug() {
    const game = this.game;
    const player = game.get<Jimothy>('player');
    if (player?.held?.entity === this.entity) player.release(false);
    const b = this.body;
    this.seated = true;
    b.setGravityScale(0, true);
    b.lockRotations(true, true);
    b.setTranslation({ x: this.seatPos.x, y: this.seatPos.y, z: this.seatPos.z }, true);
    b.setRotation({ x: this.seatQuat.x, y: this.seatQuat.y, z: this.seatQuat.z, w: this.seatQuat.w }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.plugObj.position.copy(this.seatPos);
    this.plugObj.quaternion.copy(this.seatQuat);
    this.fx.burst(this.socketMouth, 50, 0x9ff3ff, 6, 3, 0.8);
    game.sfx('slop_glitch', this.socketMouth, 0.8, 0.8);
    game.sfx('impact_metal', this.socketMouth, 0.7, 1.1);
    this.setAlarm(false);
  }

  setAlarm(on: boolean) {
    this.alarm = on;
    if (!on) {
      this.beaconMat.emissiveIntensity = 0;
      this.beaconLight.intensity = 0;
    }
  }

  private updateCable(force: boolean) {
    const t = this.body.translation();
    const p = _v.set(t.x, t.y, t.z);
    if (!force && p.distanceToSquared(this.lastCableAt) < 0.0009) return;
    this.lastCableAt.copy(p);
    const r = this.body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    const back = new THREE.Vector3(0, 0, 0.95 / 2 + 0.85).applyQuaternion(_q).add(p);
    const a = this.anchor;
    const len = a.distanceTo(back);
    const slack = Math.max(0.4, this.maxCable * 0.55 - len * 0.5);
    const pts: THREE.Vector3[] = [];
    const ground = (x: number, z: number) => terrainY(this.game, x, z) + 0.08;
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const q = new THREE.Vector3().lerpVectors(a, back, k);
      q.y -= Math.sin(k * Math.PI) * slack;
      q.y = Math.max(q.y, ground(q.x, q.z));
      pts.push(q);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const old = this.cable.geometry;
    this.cable.geometry = new THREE.TubeGeometry(curve, 28, 0.09, 6, false);
    old.dispose();
  }

  get progress() {
    return this.seated ? this.pulledOut / PRONG : 1;
  }
}

/**
 * Finds emissive meshes / lights around the data center and switches them off (and back on). Materials are
 * cloned per mesh so lights elsewhere in town that share the material stay on.
 */
export class PowerDimmer {
  private saved: { mesh: THREE.Mesh; orig: THREE.Material | THREE.Material[] }[] = [];
  private lights: { light: THREE.Light; intensity: number }[] = [];
  off = false;

  constructor(
    private game: Game,
    private center: THREE.Vector3,
    private radius: number,
  ) {}

  switchOff() {
    if (this.off) return 0;
    this.off = true;
    const c = this.center;
    const r = this.radius;
    const sph = new THREE.Sphere();
    let n = 0;
    this.game.scene.traverse((o) => {
      if (o.userData.slopOwned) return;
      const light = o as THREE.Light;
      if ((light as any).isPointLight || (light as any).isSpotLight) {
        const p = o.getWorldPosition(new THREE.Vector3());
        if (p.distanceTo(c) < r && light.intensity > 0) {
          this.lights.push({ light, intensity: light.intensity });
          light.intensity = 0;
        }
        return;
      }
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (!mats.some((mm) => isGlowing(mm))) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      sph.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
      if (sph.center.distanceTo(c) > r + Math.min(sph.radius, 25)) return;
      const clones = mats.map((mm) => {
        if (!isGlowing(mm)) return mm;
        const cl = (mm as THREE.MeshStandardMaterial).clone();
        cl.emissiveIntensity = 0;
        return cl;
      });
      this.saved.push({ mesh: m, orig: m.material });
      m.material = Array.isArray(m.material) ? clones : clones[0];
      n++;
    });
    return n;
  }

  switchOn() {
    if (!this.off) return;
    this.off = false;
    for (const s of this.saved) {
      const cur = Array.isArray(s.mesh.material) ? s.mesh.material : [s.mesh.material];
      s.mesh.material = s.orig;
      for (const m of cur) if (!(Array.isArray(s.orig) ? s.orig.includes(m) : s.orig === m)) m.dispose();
    }
    this.saved = [];
    for (const l of this.lights) l.light.intensity = l.intensity;
    this.lights = [];
  }
}

function isGlowing(m: THREE.Material) {
  const s = m as THREE.MeshStandardMaterial;
  return !!s && !!s.emissive && s.emissiveIntensity > 0.05 && s.emissive.r + s.emissive.g + s.emissive.b > 0.15;
}
