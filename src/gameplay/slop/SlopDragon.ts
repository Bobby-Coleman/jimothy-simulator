import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import type { Jimothy } from '../../player/Jimothy';
import type { CameraRig } from '../../player/CameraRig';
import { makeSlopDepthMaterial, makeSlopMaterial, makeSlopUniforms, type SlopUniforms } from './SlopMaterial';
import { buildDragonGeometry, DP, ellipsoidSideDecal, type DragonModelData } from './SlopGeometry';
import { DRAGON_BICKER, DRAGON_DISMOUNT, DRAGON_RIDE } from './lines';
import { canvasTexture, clamp, pick, rand, say, surfaceY, terrainY, toast, type Timeline } from './util';

type FlightState = 'circle' | 'swoop' | 'landing' | 'landed' | 'takeoff' | 'ride';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * The Slop Dragon: a glitchy AI dragon (seven legs, two heads that disagree, wings that clip through its body,
 * a stock-photo watermark on its side) circling lazily above SlopCorp. It periodically lands on its pad and swoops
 * low past the billboard / data-center roof. Grab it and Jimothy rides it for ~15 s: "the only AI clip that was
 * actually real".
 *
 * Kinematic body, entity.kind = 'vehicle' so Grabby Hands uses player.attachTo() (hang mode). Its colliders are
 * in the ANIMAL group and don't collide with the player (so he can sit on it) or block the camera.
 */
export class SlopDragon {
  readonly entity: Entity;
  readonly body: RAPIER.RigidBody;
  readonly root = new THREE.Group();
  private mesh: THREE.Mesh;
  private u: SlopUniforms;
  private model: DragonModelData;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  private yaw = 0;
  private bank = 0;
  private pitch = 0;
  state: FlightState = 'circle';
  private stateT = 0;
  private path: THREE.Vector3[] = [];
  private pathSpeed = 10;
  private circleAngle = 0;
  private circleAlt = 30;
  private readonly circleR = 36;
  private nextEvent = 0;
  private swoopCount = 0;
  private flap = 0;
  private flapAmp = 1.1;
  private landedUntil = 0;
  private riding = false;
  private rideStart = 0;
  private mounting = false;
  private savedCamDist = 0;
  private route: THREE.Vector3[] = [];
  private speakerA: Entity;
  private speakerB: Entity;
  private talkA = 0;
  private talkB = 0;
  private nextBicker = 0;
  private glitchT = 0;
  private nextGlitch = 0;
  private headLook = [0, 0];
  readonly swoopTargets: THREE.Vector3[] = [];
  rides = 0;

  constructor(
    private game: Game,
    private timeline: Timeline,
    readonly center: THREE.Vector3,
    readonly pad: THREE.Vector3,
  ) {
    const model = (this.model = buildDragonGeometry());
    this.u = makeSlopUniforms(model.rig, 7.7);
    const mat = makeSlopMaterial(this.u, { side: THREE.DoubleSide, roughness: 0.45, metalness: 0.2 });
    this.mesh = new THREE.Mesh(model.geometry, mat);
    this.mesh.customDepthMaterial = makeSlopDepthMaterial(this.u);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.root.add(this.mesh);
    this.root.name = 'SlopDragon';
    this.addWatermarks();
    // head anchors for speech bubbles
    const ancA = new THREE.Object3D();
    ancA.position.copy(model.headA).add(new THREE.Vector3(0, 0.6, 0));
    const ancB = new THREE.Object3D();
    ancB.position.copy(model.headB).add(new THREE.Vector3(0, 0.6, 0));
    this.root.add(ancA, ancB);
    this.root.traverse((o) => (o.userData.slopOwned = true));
    game.scene.add(this.root);
    this.speakerA = { id: -9001, kind: 'slop', name: 'Slop Dragon (Left Head)', tags: new Set(['slop']), data: {}, alive: true, mass: 0, object: ancA } as Entity;
    this.speakerB = { id: -9002, kind: 'slop', name: 'Slop Dragon (Right Head)', tags: new Set(['slop']), data: {}, alive: true, mass: 0, object: ancB } as Entity;

    // flight setup
    this.circleAlt = this.safeAltitudeRing(center, this.circleR, 14, 26);
    this.circleAngle = Math.random() * Math.PI * 2;
    this.pos.set(center.x + Math.cos(this.circleAngle) * this.circleR, this.circleAlt, center.z + Math.sin(this.circleAngle) * this.circleR);
    this.vel.set(-Math.sin(this.circleAngle), 0, Math.cos(this.circleAngle)).multiplyScalar(10);
    this.nextEvent = game.time + rand(25, 40);
    this.nextBicker = game.time + rand(4, 8);

    // physics: kinematic, ANIMAL group (grabbable, doesn't block the camera or collide with Jimothy)
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y, this.pos.z);
    const filter = groups(G.ANIMAL, G.PROP | G.RAGDOLL);
    const R = model.radii;
    const torso = RAPIER.ColliderDesc.cuboid(R.x, R.y, R.z).setCollisionGroups(filter);
    const legs = RAPIER.ColliderDesc.cuboid(0.85, (model.legReach - R.y) / 2, 1.5)
      .setTranslation(0, -R.y - (model.legReach - R.y) / 2, 0)
      .setCollisionGroups(filter);
    const neck = RAPIER.ColliderDesc.cuboid(1.0, 0.6, 0.8).setTranslation(0, 1.0, 2.7).setCollisionGroups(filter);
    this.body = game.physics.createBody(desc, [torso, legs, neck]);
    const self = this;
    this.entity = game.entities.create({
      kind: 'vehicle',
      name: 'Slop Dragon',
      body: this.body,
      object: this.root,
      mass: 900,
      tags: new Set(['slop', 'dragon', 'rideable', 'noclimb']),
      data: { velocity: this.vel, size: new THREE.Vector3(2 * R.x, 2 * R.y, 2 * R.z), slopDragon: true },
      onBonk(g) {
        self.glitchT = 0.5;
        self.bicker(['Ow.', 'That was the other head.']);
        g.score(40, 'Bonked A Dragon', self.pos.clone());
        return true;
      },
      onWash(g) {
        self.bicker(['Thank you. We feel clean.', 'We are still a dragon, though.']);
        g.score(60, 'Washed A Dragon', self.pos.clone());
        g.hint('The Slop Dragon does not dissolve. Suspicious. Almost as if it were… real.', 3.5);
      },
    });

    game.events.on('hangStart', (p: { entity?: Entity }) => {
      if (p?.entity === this.entity && !this.mounting) this.mount();
    });
    game.events.on('grabMiss', () => this.tryGrabAssist());
    game.events.on('serverUnplugged', () => {
      this.timeline.later(4, () => this.bicker(['The servers are down.', 'And yet… we fly. Suspicious.']));
    });
    this.buildRoute();
    this.sync();
  }

  // ---------------------------------------------------------------- setup helpers
  private addWatermarks() {
    const tex = canvasTexture(1024, 384, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.16);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeStyle = 'rgba(40,20,60,0.55)';
      ctx.lineWidth = 3;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 118px "Luckiest Guy", Impact, sans-serif';
      ctx.strokeText('SlopStock', 0, -40);
      ctx.fillText('SlopStock', 0, -40);
      ctx.font = '700 38px Nunito, system-ui, sans-serif';
      ctx.fillText('PREVIEW · AI GENERATED · NOT REAL', 0, 50);
      ctx.font = '700 28px Nunito, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText('© SlopCorp Dreamer v0.3 — do not ride', 0, 100);
      ctx.restore();
      // classic diagonal stock-photo lattice
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      for (let i = -h; i < w; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, h);
        ctx.lineTo(i + h, 0);
        ctx.stroke();
      }
    });
    const m = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    for (const side of [1, -1] as const) {
      const g = ellipsoidSideDecal(this.model.radii, side, [-1.5, 1.5], 0.62, 1.02);
      const d = new THREE.Mesh(g, m);
      d.renderOrder = 4;
      d.castShadow = false;
      this.root.add(d);
    }
  }

  /** Highest static surface around a ring / along a segment + clearance. */
  private safeAltitudeRing(c: THREE.Vector3, r: number, clearance: number, minAbove: number) {
    let top = terrainY(this.game, c.x, c.z) + minAbove;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      for (const rr of [r * 0.6, r, r * 1.3]) {
        const x = c.x + Math.cos(a) * rr;
        const z = c.z + Math.sin(a) * rr;
        top = Math.max(top, surfaceY(this.game, x, z, 220) + clearance);
      }
    }
    return top;
  }

  private safeAltitudeSegment(a: THREE.Vector3, b: THREE.Vector3, clearance: number) {
    let top = -Infinity;
    for (let i = 0; i <= 12; i++) {
      _v.lerpVectors(a, b, i / 12);
      for (const [dx, dz] of [
        [0, 0],
        [6, 0],
        [-6, 0],
        [0, 6],
        [0, -6],
      ]) {
        top = Math.max(top, surfaceY(this.game, _v.x + dx, _v.z + dz, 220) + clearance);
      }
    }
    return top;
  }

  private buildRoute() {
    const C = this.center;
    const P = this.pad;
    const pts: [number, number][] = [
      [C.x + 60, C.z - 25],
      [C.x + 92, C.z + 38],
      [C.x + 22, C.z + 76],
      [C.x - 24, C.z + 22],
    ];
    const route: THREE.Vector3[] = [new THREE.Vector3(P.x, P.y + 14, P.z)];
    for (const [x, z] of pts) route.push(new THREE.Vector3(clamp(x, -165, 165), 0, clamp(z, -165, 150)));
    route.push(new THREE.Vector3(P.x + 10, 0, P.z + 10));
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      const alt = Math.max(this.safeAltitudeSegment(a, b, 13), terrainY(this.game, b.x, b.z) + 24);
      b.y = alt;
      if (i === 1) a.y = Math.max(a.y, this.safeAltitudeSegment(a, a, 6));
    }
    this.route = route;
  }

  // ---------------------------------------------------------------- behaviour
  private setState(s: FlightState) {
    this.state = s;
    this.stateT = 0;
  }

  /** Low pass along a target (billboard catwalk / data-center roof) so Jimothy can jump on. */
  startSwoop(target?: THREE.Vector3) {
    const t = target ?? (this.swoopTargets.length ? pick(this.swoopTargets) : null);
    if (!t || this.riding) return;
    const dir = new THREE.Vector3(t.x - this.pos.x, 0, t.z - this.pos.z).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const pass = t.clone().add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(side, 1.2);
    const approach = pass.clone().addScaledVector(dir, -22).add(new THREE.Vector3(0, 7, 0));
    const exit = pass.clone().addScaledVector(dir, 24).add(new THREE.Vector3(0, 10, 0));
    const back = new THREE.Vector3(this.center.x, this.circleAlt, this.center.z);
    this.path = [approach, pass, exit, back];
    this.pathSpeed = 11;
    this.setState('swoop');
    this.swoopCount++;
  }

  startLanding() {
    if (this.riding && this.state === 'landing') return;
    const P = this.pad;
    const above = new THREE.Vector3(P.x, Math.max(this.pos.y, P.y + 16), P.z);
    this.path = [above, new THREE.Vector3(P.x, P.y + this.model.legReach + 0.05, P.z)];
    this.pathSpeed = this.riding ? 20 : 10;
    this.setState('landing');
  }

  private mount() {
    const player = this.game.get<Jimothy>('player');
    if (!player) return;
    this.mounting = true;
    try {
      player.attachTo(this.entity, this.saddleWorld(new THREE.Vector3()));
    } finally {
      this.mounting = false;
    }
    if (this.riding) return;
    this.riding = true;
    this.rideStart = this.game.time;
    this.rides++;
    const cam = this.game.get<CameraRig>('camera');
    if (cam) {
      this.savedCamDist = cam.targetDistance;
      cam.targetDistance = Math.max(cam.targetDistance, 9);
    }
    // off we go
    this.path = this.route.map((p) => p.clone());
    if (this.state === 'landed' || this.state === 'landing' || this.pos.y < this.pad.y + 6) {
      this.path.unshift(new THREE.Vector3(this.pos.x, this.pos.y + 10, this.pos.z));
    }
    this.pathSpeed = 26;
    this.setState('ride');
    const game = this.game;
    game.events.emit('rodeSlopDragon', { entity: this.entity, rides: this.rides });
    if (this.rides === 1) {
      game.score(1500, 'Hallucination', player.position.clone());
      toast(game, 'Hallucination', 'You rode the Slop Dragon: the only AI clip that was actually real.', '🐉');
    } else game.score(300, 'Another Hallucination', player.position.clone());
    game.sfx('whoosh', this.pos, 1, 0.6);
    game.sfx('crowd_ooh', this.pos, 0.5);
    this.timeline.later(2.5, () => this.riding && this.bicker([pick(DRAGON_RIDE), pick(DRAGON_RIDE)]));
    this.timeline.later(9, () => this.riding && this.bicker(['Are we real?', 'This clip is real. Nobody will believe it.']));
  }

  private endRide(completed: boolean) {
    if (!this.riding) return;
    this.riding = false;
    const cam = this.game.get<CameraRig>('camera');
    if (cam && this.savedCamDist) cam.targetDistance = this.savedCamDist;
    const player = this.game.get<Jimothy>('player');
    if (completed && player && player.mode === 'hang') {
      player.setMode('walk');
      const side = _v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(3.5);
      player.body.setLinvel({ x: side.x, y: 5.5, z: side.z }, true);
      this.game.score(250, 'Stuck The Landing', player.position.clone());
    }
    this.bicker([pick(DRAGON_DISMOUNT), completed ? 'Please rate your hallucination.' : 'Come back! We had seven legs of fun!']);
    this.game.events.emit('slopDragonDismount', { completed });
  }

  /** Grabby Hands missed? If the dragon is right there, let Jimothy hop on anyway (big creature, tiny hands). */
  private tryGrabAssist() {
    if (this.riding) return;
    const player = this.game.get<Jimothy>('player');
    if (!player || (player.mode !== 'walk' && player.mode !== 'climb' && player.mode !== 'swim')) return;
    const local = this.worldToLocal(player.position.clone());
    const R = this.model.radii;
    const dx = Math.max(0, Math.abs(local.x) - R.x);
    const dy = Math.max(0, local.y > 0 ? local.y - R.y - 0.6 : -local.y - this.model.legReach);
    const dz = Math.max(0, Math.abs(local.z - 0.3) - R.z - 1.2);
    if (Math.hypot(dx, dy, dz) < 2.6) player.attachTo(this.entity, this.saddleWorld(new THREE.Vector3()));
  }

  private worldToLocal(p: THREE.Vector3) {
    _q.copy(this.root.quaternion).invert();
    return p.sub(this.pos).applyQuaternion(_q);
  }

  saddleWorld(out: THREE.Vector3) {
    return out.copy(this.model.saddle).applyQuaternion(this.root.quaternion).add(this.pos);
  }

  bicker(pair?: [string, string]) {
    const p = pair ?? pick(DRAGON_BICKER);
    const player = this.game.get<Jimothy>('player');
    if (!player || player.position.distanceTo(this.pos) > 70) return;
    const game = this.game;
    game.events.emit('speech', { entity: this.speakerA, text: p[0], duration: 2.8, style: 'slop', speaker: 'Left Head' });
    this.talkA = 1.6;
    game.sfx('slop_voice', this.pos, 0.5, 0.7);
    this.timeline.later(1.8, () => {
      game.events.emit('speech', { entity: this.speakerB, text: p[1], duration: 3, style: 'slop', speaker: 'Right Head' });
      this.talkB = 1.8;
      game.sfx('slop_voice', this.pos, 0.5, 0.85);
    });
  }

  // ---------------------------------------------------------------- per-frame
  update(dt: number) {
    const game = this.game;
    const now = game.time;
    this.stateT += dt;
    const player = game.get<Jimothy>('player');

    if (this.riding) {
      if (!player || player.mode !== 'hang') this.endRide(false);
      else if (now - this.rideStart > 40) this.startLanding();
    }

    switch (this.state) {
      case 'circle': {
        this.circleAngle += (10 / this.circleR) * dt;
        const a = this.circleAngle + 0.5;
        const carrot = _v.set(this.center.x + Math.cos(a) * this.circleR, this.circleAlt + Math.sin(now * 0.3) * 2, this.center.z + Math.sin(a) * this.circleR);
        this.steer(carrot, 10, dt, 1.1);
        if (now > this.nextEvent) {
          this.nextEvent = now + rand(35, 55);
          if (this.swoopCount % 2 === 1 || !this.swoopTargets.length) this.startLanding();
          else this.startSwoop();
        }
        break;
      }
      case 'swoop':
      case 'ride':
      case 'takeoff':
        this.followPath(dt, false);
        break;
      case 'landing':
        this.followPath(dt, true);
        break;
      case 'landed': {
        this.vel.multiplyScalar(Math.exp(-dt * 6));
        if (now > this.landedUntil && !this.riding) {
          this.path = [new THREE.Vector3(this.pos.x, this.pad.y + 14, this.pos.z), new THREE.Vector3(this.center.x, this.circleAlt, this.center.z)];
          this.pathSpeed = 9;
          this.setState('takeoff');
          game.sfx('whoosh', this.pos, 0.8, 0.5);
        }
        break;
      }
    }

    // keep the angle in sync so circling resumes smoothly
    if (this.state !== 'circle') this.circleAngle = Math.atan2(this.pos.z - this.center.z, this.pos.x - this.center.x) - 0.2;

    // heads bicker every so often
    if (now > this.nextBicker) {
      this.nextBicker = now + rand(9, 16);
      this.bicker();
    }

    this.sync();
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.body.setNextKinematicRotation({ x: this.root.quaternion.x, y: this.root.quaternion.y, z: this.root.quaternion.z, w: this.root.quaternion.w });
  }

  private steer(target: THREE.Vector3, speed: number, dt: number, turn: number, arrive = false) {
    const to = _v.copy(target).sub(this.pos);
    const d = to.length();
    const sp = arrive ? Math.min(speed, d * 1.1) : speed;
    if (d > 1e-4) to.multiplyScalar(sp / d);
    else to.set(0, 0, 0);
    this.vel.lerp(to, 1 - Math.exp(-dt * turn));
    this.pos.addScaledVector(this.vel, dt);
    return d;
  }

  private followPath(dt: number, arriveLast: boolean) {
    const t = this.path[0];
    if (!t) {
      this.onPathDone();
      return;
    }
    const last = this.path.length === 1;
    const arrive = arriveLast && last;
    const d = this.steer(t, this.pathSpeed, dt, arrive ? 3 : this.state === 'ride' ? 1.6 : 1.3, arrive);
    if ((arrive && d < 0.25) || (!arrive && d < 4.5)) {
      this.path.shift();
      if (!this.path.length) this.onPathDone();
    }
  }

  private onPathDone() {
    const game = this.game;
    switch (this.state) {
      case 'swoop':
      case 'takeoff':
        this.setState('circle');
        break;
      case 'ride':
        this.startLanding();
        break;
      case 'landing':
        this.setState('landed');
        this.vel.set(0, 0, 0);
        this.landedUntil = game.time + (this.riding ? 25 : rand(22, 32));
        game.sfx('land', this.pos, 1, 0.5);
        game.get<CameraRig>('camera')?.shake(0.3);
        if (this.riding) this.endRide(true);
        else this.timeline.later(1.2, () => this.bicker(['We have landed. Ride us, small round one.', 'Please do not ride us. Unless?']));
        break;
      default:
        this.setState('circle');
    }
  }

  /** Orientation + visuals from the current motion. */
  private sync() {
    const dt = this.game.dt || 1 / 60;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 1.2) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      let dy = want - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const rate = dy * (1 - Math.exp(-dt * 3));
      this.yaw += rate;
      this.bank += (clamp((-rate / dt) * 0.45, -0.65, 0.65) - this.bank) * (1 - Math.exp(-dt * 3));
    } else this.bank *= Math.exp(-dt * 3);
    const wantPitch = hs > 1 ? clamp(-Math.atan2(this.vel.y, hs) * 0.6, -0.5, 0.5) : 0;
    this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-dt * 3));
    _e.set(this.pitch, this.yaw, this.bank, 'YXZ');
    this.root.quaternion.setFromEuler(_e);
    this.root.position.copy(this.pos);
    this.animate(dt);
  }

  private animate(dt: number) {
    const now = this.game.time;
    const u = this.u;
    const grounded = this.state === 'landed';
    // wings: big out-of-sync flaps that clip through the body on the downstroke
    const flying = !grounded;
    const flapRate = this.state === 'landing' || this.state === 'takeoff' ? 2.2 : this.state === 'ride' ? 1.6 : 1.15;
    this.flap += dt * Math.PI * 2 * flapRate;
    this.flapAmp += ((flying ? 1.2 : 0.12) - this.flapAmp) * (1 - Math.exp(-dt * 3));
    const fold = flying ? 0 : 1.25;
    const wl = Math.sin(this.flap) * this.flapAmp + fold;
    const wr = Math.sin(this.flap * 1.07 + 0.5) * this.flapAmp + fold;
    u.uRot.value[DP.wingL].set(0, flying ? 0 : 0.5, wl);
    u.uRot.value[DP.wingR].set(0, flying ? 0 : -0.5, -wr);
    // heads that disagree: they look different ways, sometimes turn to argue
    const argue = this.talkA > 0 || this.talkB > 0;
    this.talkA -= dt;
    this.talkB -= dt;
    const lookA = argue ? -0.55 : Math.sin(now * 0.37) * 0.6 + 0.2;
    const lookB = argue ? 0.55 : Math.sin(now * 0.29 + 2) * 0.6 - 0.2;
    this.headLook[0] += (lookA - this.headLook[0]) * (1 - Math.exp(-dt * 3));
    this.headLook[1] += (lookB - this.headLook[1]) * (1 - Math.exp(-dt * 3));
    u.uRot.value[DP.neckA].set(Math.sin(now * 0.8) * 0.12 + (grounded ? 0.25 : 0), this.headLook[0], Math.sin(now * 0.5) * 0.1);
    u.uRot.value[DP.neckB].set(Math.sin(now * 0.7 + 1) * 0.12 + (grounded ? 0.3 : 0), this.headLook[1], Math.sin(now * 0.6 + 2) * 0.12);
    u.uRot.value[DP.jawA].set(this.talkA > 0 ? Math.abs(Math.sin(now * 17)) * 0.45 : 0.05, 0, 0);
    u.uRot.value[DP.jawB].set(this.talkB > 0 ? Math.abs(Math.sin(now * 15)) * 0.45 : 0.05, 0, 0);
    // tail
    u.uRot.value[DP.tail].set(Math.sin(now * 1.1) * 0.15 + (grounded ? 0.2 : -0.05), Math.sin(now * 1.5) * 0.45, 0);
    // seven legs: dangle & paddle in the air, stand (badly) when landed
    for (let i = 0; i < 7; i++) {
      const p = DP.leg0 + i;
      if (grounded) u.uRot.value[p].set(Math.sin(now * 0.8 + i) * 0.06, 0, 0);
      else u.uRot.value[p].set(0.5 + Math.sin(now * (3 + i * 0.7) + i * 1.3) * 0.5, 0, Math.sin(now * 2 + i) * 0.2);
    }
    // glitches
    if (now > this.nextGlitch) {
      this.nextGlitch = now + rand(2, 6);
      this.glitchT = rand(0.1, 0.35);
    }
    this.glitchT -= dt;
    u.uGlitch.value = this.glitchT > 0 ? 0.7 : 0;
    u.uBlocky.value = this.glitchT > 0.25 ? 0.5 : 0;
    this.mesh.visible = !(this.glitchT > 0 && Math.random() < 0.08);
  }

  /** Force a landing right now (for testing / cutscenes). */
  landNow() {
    const P = this.pad;
    this.pos.set(P.x, P.y + this.model.legReach + 0.05, P.z);
    this.vel.set(0, 0, 0);
    this.path = [];
    this.setState('landed');
    this.landedUntil = this.game.time + 30;
    this.sync();
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
  }
}
