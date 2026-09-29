import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import type { World } from '../../world/World';

/**
 * Traffic: kinematic cars that follow `world.lanes` loops, brake & honk for Jimothy, launch whatever they hit,
 * can be surfed (grab a moving car), and get wrecked (become dynamic) by explosions.
 */

const CAR_MODELS = [
  'sedan', 'sedan', 'taxi', 'suv', 'hatchback-sports', 'van', 'police', 'delivery', 'garbage-truck', 'suv-luxury', 'truck',
];
const SCALE = 1.6;

interface Lane {
  points: THREE.Vector3[];
  cum: number[];
  length: number;
  loop: boolean;
  speed: number;
}

interface Car {
  entity: Entity;
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  wheels: THREE.Object3D[];
  lane: Lane;
  s: number;
  speed: number;
  cruise: number;
  halfLen: number;
  halfWid: number;
  height: number;
  wrecked: boolean;
  wreckedAt: number;
  lastHonk: number;
  velocity: THREE.Vector3;
  model: string;
  prevPos: THREE.Vector3;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class VehicleSystem implements System {
  name = 'vehicles';
  readonly cars: Car[] = [];
  private lanes: Lane[] = [];
  private game!: Game;
  /** Cars per 100 m of lane. */
  density = 1.0;
  maxCars = 22;

  async init(game: Game) {
    this.game = game;
    const world = game.get<World>('world');
    const src = world?.lanes ?? [];
    for (const l of src) {
      if (l.points.length < 2) continue;
      this.lanes.push(this.buildLane(l.points, l.loop, l.speed ?? 11));
    }
    if (!this.lanes.length) {
      // Fallback test loop around the central block (only used if no level builder provided lanes)
      const y = 0.02;
      const r = 57;
      const pts = [new THREE.Vector3(-r, y, -r), new THREE.Vector3(r, y, -r), new THREE.Vector3(r, y, r), new THREE.Vector3(-r, y, r)];
      this.lanes.push(this.buildLane(pts, true, 10));
    }
    game.events.on('explosion', (e: { position: THREE.Vector3; radius?: number; force?: number }) => this.onExplosion(e));

    // Spawn cars spread along lanes
    const jobs: Promise<void>[] = [];
    let total = 0;
    for (const lane of this.lanes) {
      const n = Math.max(1, Math.min(5, Math.floor((lane.length / 100) * this.density)));
      for (let i = 0; i < n && total < this.maxCars; i++, total++) {
        const s = (i / n) * lane.length + Math.random() * 10;
        jobs.push(this.spawnCar(lane, s));
      }
    }
    await Promise.all(jobs);
  }

  private buildLane(points: THREE.Vector3[], loop: boolean, speed: number): Lane {
    const pts = points.map((p) => p.clone());
    const cum = [0];
    const n = loop ? pts.length : pts.length - 1;
    let L = 0;
    for (let i = 0; i < n; i++) {
      L += pts[i].distanceTo(pts[(i + 1) % pts.length]);
      cum.push(L);
    }
    return { points: pts, cum, length: L, loop, speed };
  }

  /** Position + tangent at arclength s. */
  private sample(lane: Lane, s: number, outPos: THREE.Vector3, outDir: THREE.Vector3) {
    const L = lane.length;
    if (lane.loop) s = ((s % L) + L) % L;
    else s = THREE.MathUtils.clamp(s, 0, L);
    let i = 0;
    while (i < lane.cum.length - 2 && lane.cum[i + 1] < s) i++;
    const a = lane.points[i];
    const b = lane.points[(i + 1) % lane.points.length];
    const segLen = lane.cum[i + 1] - lane.cum[i] || 1;
    const t = (s - lane.cum[i]) / segLen;
    outPos.lerpVectors(a, b, t);
    outDir.subVectors(b, a).normalize();
    // Smooth the corners a little by blending toward the next segment's direction near the end
    if (t > 0.85 && (lane.loop || i + 2 < lane.points.length)) {
      const c = lane.points[(i + 2) % lane.points.length];
      const nd = _t.subVectors(c, b).normalize();
      outDir.lerp(nd, (t - 0.85) / 0.15 * 0.5).normalize();
    }
  }

  private async spawnCar(lane: Lane, s: number) {
    const game = this.game;
    const model = CAR_MODELS[Math.floor(Math.random() * CAR_MODELS.length)];
    let obj = await game.assets.tryModel(`assets/models/kenney/car-kit/${model}.glb`);
    const wheels: THREE.Object3D[] = [];
    if (!obj) obj = fallbackCar();
    const inner = obj;
    inner.scale.setScalar(SCALE);
    inner.traverse((o) => {
      if (/wheel/i.test(o.name)) wheels.push(o);
    });
    const holder = new THREE.Group();
    holder.name = 'Car:' + model;
    holder.add(inner);
    game.scene.add(holder);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const halfLen = size.z / 2;
    const halfWid = size.x / 2;

    this.sample(lane, s, _p, _t);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(_p.x, _p.y, _p.z);
    const body = game.physics.world.createRigidBody(desc);
    // lower body + cabin boxes (a bit smaller than the visual so it doesn't look floaty on contact)
    const lower = RAPIER.ColliderDesc.cuboid(halfWid * 0.95, size.y * 0.28, halfLen * 0.97)
      .setTranslation(center.x, size.y * 0.3, center.z)
      .setCollisionGroups(groups(G.VEHICLE))
      .setFriction(0.9);
    const cabin = RAPIER.ColliderDesc.cuboid(halfWid * 0.85, size.y * 0.22, halfLen * 0.55)
      .setTranslation(center.x, size.y * 0.76, center.z - halfLen * 0.05)
      .setCollisionGroups(groups(G.VEHICLE))
      .setFriction(0.9);
    game.physics.world.createCollider(lower, body);
    game.physics.world.createCollider(cabin, body);
    game.physics.link(body, holder);

    const entity = game.entities.create({
      kind: 'vehicle',
      name: prettyName(model),
      body,
      object: holder,
      mass: 1200,
      tags: new Set(['vehicle']),
      data: { velocity: new THREE.Vector3(), size },
    });
    const car: Car = {
      entity,
      body,
      object: holder,
      wheels,
      lane,
      s,
      speed: lane.speed,
      cruise: lane.speed * (0.85 + Math.random() * 0.3),
      halfLen,
      halfWid,
      height: size.y,
      wrecked: false,
      wreckedAt: 0,
      lastHonk: -10,
      velocity: entity.data.velocity,
      model,
      prevPos: _p.clone(),
    };
    entity.onBonk = (g, impulse) => {
      // Bonking a car: it honks at you. Goat-Sim tradition.
      this.honk(car, 0.8);
      g.score(15, 'Bonked A Car');
      return true;
    };
    this.cars.push(car);
  }

  private honk(car: Car, volume = 1) {
    if (this.game.time - car.lastHonk < 2.5) return;
    car.lastHonk = this.game.time;
    this.game.sfx('car_horn', car.object.position, volume, car.model === 'garbage-truck' || car.model === 'delivery' ? 0.8 : 1);
  }

  update(dt: number) {
    const game = this.game;
    const player = game.get<any>('player');
    const ppos: THREE.Vector3 | undefined = player?.position;
    for (const car of this.cars) {
      if (car.wrecked) {
        const t = car.body.translation();
        car.object.position.set(t.x, t.y, t.z);
        const far = !ppos || ppos.distanceTo(car.object.position) > 45;
        if (game.time - car.wreckedAt > 12 && far) this.unwreck(car);
        continue;
      }
      // Target speed: cruise, slow for obstacles ahead
      this.sample(car.lane, car.s, _p, _t);
      const dir = _t.clone();
      let target = car.cruise;
      // Car ahead on same lane
      for (const o of this.cars) {
        if (o === car || o.lane !== car.lane || o.wrecked) continue;
        let gap = o.s - car.s;
        if (car.lane.loop) gap = ((gap % car.lane.length) + car.lane.length) % car.lane.length;
        if (gap > 0 && gap < 14) target = Math.min(target, Math.max(0, (gap - 7) * 1.2));
      }
      // Jimothy / NPCs in front → brake and honk (only if not already very close at speed)
      if (ppos && player.mode !== 'hang') {
        const rel = ppos.clone().sub(_p);
        const ahead = rel.dot(dir);
        const lateral = Math.abs(rel.x * dir.z - rel.z * dir.x);
        if (ahead > car.halfLen && ahead < 16 && lateral < car.halfWid + 0.9 && Math.abs(rel.y) < 3) {
          if (Math.random() < 0.985) target = Math.min(target, Math.max(0, (ahead - car.halfLen - 3) * 0.9));
          if (ahead < 12) this.honk(car);
        }
      }
      const accel = target < car.speed ? 12 : 4;
      car.speed += THREE.MathUtils.clamp(target - car.speed, -accel * dt, accel * dt);
      car.s += car.speed * dt;
      this.sample(car.lane, car.s, _p, _t);
      const yaw = Math.atan2(_t.x, _t.z);
      _q.setFromAxisAngle(UP, yaw);
      car.body.setNextKinematicTranslation({ x: _p.x, y: _p.y, z: _p.z });
      car.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
      car.velocity.copy(_t).multiplyScalar(car.speed);
      // Wheels spin
      const spin = (car.speed * dt) / (0.3 * SCALE);
      for (const w of car.wheels) w.rotation.x += spin;
      // Hit things in front when moving
      if (car.speed > 3.5) this.checkHits(car, _p.clone(), _t.clone());
    }
  }

  private checkHits(car: Car, pos: THREE.Vector3, dir: THREE.Vector3) {
    const game = this.game;
    const front = pos.clone().addScaledVector(dir, car.halfLen + 0.2).add(new THREE.Vector3(0, 0.7, 0));
    const hits = game.physics.overlapSphere(front, 1.1, groups(G.ALL, G.PLAYER | G.NPC | G.PROP | G.RAGDOLL | G.ANIMAL), car.body);
    if (!hits.length) return;
    const handled = new Set<number>();
    for (const c of hits) {
      const e = game.entities.fromCollider(c);
      const key = e ? e.id : -c.handle - 1;
      if (handled.has(key)) continue;
      handled.add(key);
      const v = car.speed;
      if (e?.kind === 'player') {
        const p = game.get<any>('player');
        if (p.mode === 'ragdoll') continue;
        const imp = dir.clone().multiplyScalar(v * 12 * 1.1).add(new THREE.Vector3(0, 12 * (4 + v * 0.35), 0));
        p.ragdoll('car', 2.2, imp);
        game.get<any>('camera')?.shake(0.8);
        game.score(200, 'Hit By A Car (He’s Fine)', p.position.clone());
        game.events.emit('hitByCar', { car: car.entity });
        this.honk(car);
        game.sfx('impact_metal', p.position, 1);
        car.speed *= 0.6;
      } else if (e && (e.kind === 'npc' || e.kind === 'animal' || e.kind === 'slop')) {
        const imp = dir.clone().multiplyScalar(Math.min(e.mass, 80) * v * 0.9).add(new THREE.Vector3(0, Math.min(e.mass, 80) * 5, 0));
        const pt = e.body ? new THREE.Vector3().copy(e.body.translation() as any) : front.clone();
        e.onBonk?.(game, imp, pt);
        game.events.emit('npcHitByCar', { entity: e, car: car.entity });
        this.honk(car);
        car.speed *= 0.75;
      } else {
        const b = c.parent();
        if (b && b.isDynamic()) {
          const m = Math.min(b.mass(), 200);
          const lv = b.linvel();
          const along = lv.x * dir.x + lv.z * dir.z;
          if (along < v) b.applyImpulse({ x: dir.x * m * (v - along) * 1.1, y: m * 2.5, z: dir.z * m * (v - along) * 1.1 }, true);
        }
      }
    }
  }

  private onExplosion(e: { position: THREE.Vector3; radius?: number; force?: number }) {
    const r = (e.radius ?? 7) + 2;
    for (const car of this.cars) {
      if (car.wrecked) continue;
      const d = car.object.position.distanceTo(e.position);
      if (d > r) continue;
      this.wreck(car, e.position, (e.force ?? 1) * (1 - d / r));
    }
  }

  wreck(car: Car, from: THREE.Vector3, strength: number) {
    const game = this.game;
    car.wrecked = true;
    car.wreckedAt = game.time;
    car.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    for (let i = 0; i < car.body.numColliders(); i++) car.body.collider(i).setMass(600);
    const dir = car.object.position.clone().sub(from).setY(0).normalize();
    const m = car.body.mass();
    car.body.applyImpulse({ x: dir.x * m * 7 * strength, y: m * 11 * strength, z: dir.z * m * 7 * strength }, true);
    car.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 6, y: (Math.random() - 0.5) * m * 3, z: (Math.random() - 0.5) * m * 6 }, true);
    car.velocity.set(0, 0, 0);
    game.score(250, 'Car Yeet');
    game.events.emit('carWrecked', { car: car.entity });
  }

  private unwreck(car: Car) {
    car.wrecked = false;
    car.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // respawn at a lane position away from the player
    car.s = Math.random() * car.lane.length;
    car.speed = 0;
    this.sample(car.lane, car.s, _p, _t);
    car.body.setTranslation({ x: _p.x, y: _p.y, z: _p.z }, true);
  }
}

function prettyName(model: string) {
  const map: Record<string, string> = {
    'garbage-truck': 'Garbage Truck',
    'hatchback-sports': 'Tiny Sports Car',
    'suv-luxury': 'Fancy SUV',
    police: 'Police Car',
    delivery: 'Delivery Van',
    taxi: 'Taxi',
    van: 'Van',
    suv: 'SUV',
    truck: 'Pickup Truck',
    sedan: 'Sedan',
  };
  return map[model] ?? 'Car';
}

function fallbackCar(): THREE.Object3D {
  const g = new THREE.Group();
  const color = new THREE.Color().setHSL(Math.random(), 0.55, 0.5);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.1, metalness: 0.5 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 2.6), paint);
  body.position.y = 0.55;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 1.4), glass);
  cabin.position.set(0, 1.0, -0.1);
  g.add(cabin);
  for (const [x, z] of [[0.7, 0.85], [-0.7, 0.85], [0.7, -0.85], [-0.7, -0.85]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 14).rotateZ(Math.PI / 2), tire);
    w.position.set(x, 0.3, z);
    w.name = 'wheel';
    g.add(w);
  }
  return g;
}
