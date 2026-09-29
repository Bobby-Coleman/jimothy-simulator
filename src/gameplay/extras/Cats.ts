import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import { RAPIER, G, groups } from '../../core/Physics';
import type { Entity } from '../../core/Entities';
import type { ExtrasFeature, ExtrasHost } from './host';
import { surfaceAt, groundY, poi, playerOf, speech, pick, rand, dampAngle } from './shared';

/**
 * ACTUAL CATS. Canon: the lady who filmed Jimothy thought he was a cat until he turned around. So the town has a few
 * real cats now, and they are deeply unimpressed by the round boy.
 *
 *  - Mister Whiskers on the alley fence behind the den (Old Ballard)
 *  - Sardine on the fish stall's back counter (Pike's Plaice Market)
 *  - Judge Biscuit on the Tee-Hee Park ticket booth roof
 *
 * Kenney cube-pets cat (CC0), merged into 2 draw calls per cat (body + flicking tail). Chitter near one → it turns,
 * puffs up and hisses back; a nearby human goes "Oh cool, a real cat". Grabbing / bonking / washing: "The cat
 * declines." Emits 'catMet' { entity, name, first, count } and 'catDeclined' { entity, name, action }.
 */

const MODEL = 'assets/models/kenney/cube-pets/animal-cat.glb';
const SCALE = 0.38;

interface Spot {
  id: string;
  name: string;
  /** Resolve the perch (feet position) + resting yaw. */
  place: (host: ExtrasHost) => { pos: THREE.Vector3; yaw: number } | null;
  tint?: [number, number, number];
}

const NPC_LINES = [
  'Oh cool, a real cat.',
  'Wait. THAT one is a cat?',
  'Huh. So that\'s what a normal cat looks like.',
  'Finally, a cat-shaped cat.',
  'The cat is also unimpressed by me, if it helps.',
  'Okay but which one is the cat now?',
];

const DECLINE: Record<string, string[]> = {
  grab: ['The cat declines.', 'The cat declines. Firmly.', 'The cat declines to be carried by a raccoon.'],
  bonk: ['The cat declines. (It was not bonked. It chose not to be.)', 'The cat declines. Bonks are for dogs.', 'The cat declines.'],
  wash: ['The cat declines. Violently.', 'The cat declines. It washes itself, thank you.', 'The cat declines.'],
};

const SPOTS: Spot[] = [
  {
    id: 'fence',
    name: 'Mister Whiskers',
    place: (h) => {
      const g = h.game;
      const den = poi(g, 'den', new THREE.Vector3(9, 0.3, 23.3));
      // alley fence between the south alley and the parking lot (x 17..34, z = 30.1, 1.2 m tall)
      for (const [x, z] of [
        [25.5, 30.1],
        [21.5, 30.1],
        [29.5, 30.1],
      ]) {
        const y = surfaceAt(g, x, z, den.y + 3.5, 6);
        if (y != null && y > den.y + 0.7 && y < den.y + 2.2) return { pos: new THREE.Vector3(x, y, z), yaw: 0.35 };
      }
      return null;
    },
  },
  {
    id: 'market',
    name: 'Sardine',
    tint: [1.25, 1.02, 0.8],
    place: (h) => {
      const g = h.game;
      const m = poi(g, 'fishMarket', new THREE.Vector3(0, 0.1, 94.2));
      // the fish stall's steel work counter behind the ice display (top ≈ 0.9 m)
      for (const [dx, dz] of [
        [-4.4, 0.9],
        [-2.6, 0.9],
        [4.6, 0.9],
      ]) {
        const x = m.x + dx;
        const z = m.z + dz;
        const y = surfaceAt(g, x, z, m.y + 2.4, 4);
        if (y != null && y > m.y + 0.5 && y < m.y + 1.6) return { pos: new THREE.Vector3(x, y, z), yaw: -2.6 };
      }
      return null;
    },
  },
  {
    id: 'booth',
    name: 'Judge Biscuit',
    tint: [0.62, 0.6, 0.66],
    place: (h) => {
      const g = h.game;
      const park = poi(g, 'teeHeePark', new THREE.Vector3(92, 0.2, 154));
      // ticket booth by the main gate (roof top ≈ 2.9 m)
      for (const [x, z] of [
        [park.x - 4.6, park.z - 6.5],
        [park.x - 5.4, park.z - 6.5],
      ]) {
        const y = surfaceAt(g, x, z, park.y + 6, 8);
        if (y != null && y > park.y + 2 && y < park.y + 4) return { pos: new THREE.Vector3(x, y, z), yaw: 0.9 };
      }
      return null;
    },
  },
];

const _v = new THREE.Vector3();

class Cat {
  readonly root = new THREE.Group();
  readonly inner = new THREE.Group();
  readonly tailPivot = new THREE.Group();
  entity!: Entity;
  body!: RAPIER_T.RigidBody;
  readonly name: string;
  readonly home: THREE.Vector3;
  readonly restYaw: number;
  yaw: number;
  private targetYaw: number;
  private attentionT = 0;
  private puff = 0;
  private hop = 0;
  private hopV = 0;
  private flickT = 1;
  private flick = 0;
  private breatheT = Math.random() * 10;
  private glanceT = 4 + Math.random() * 6;
  met = false;
  declines = 0;
  private hissCd = 0;

  constructor(
    private host: ExtrasHost,
    name: string,
    pos: THREE.Vector3,
    yaw: number,
    bodyGeo: THREE.BufferGeometry,
    tailGeo: THREE.BufferGeometry,
    tailMatrix: THREE.Matrix4,
    mat: THREE.Material,
  ) {
    this.name = name;
    this.home = pos.clone();
    this.restYaw = yaw;
    this.yaw = yaw;
    this.targetYaw = yaw;
    const game = host.game;
    this.root.position.copy(pos);
    this.root.rotation.y = yaw;
    this.root.add(this.inner);
    this.inner.scale.setScalar(SCALE);
    const body = new THREE.Mesh(bodyGeo, mat);
    body.castShadow = true;
    body.receiveShadow = true;
    this.inner.add(body);
    tailMatrix.decompose(this.tailPivot.position, this.tailPivot.quaternion, this.tailPivot.scale);
    const tail = new THREE.Mesh(tailGeo, mat);
    tail.castShadow = true;
    this.tailPivot.add(tail);
    this.inner.add(this.tailPivot);
    game.scene.add(this.root);

    // a fixed body so Grabby Hands / bonks / washes find the cat (and Jimothy can't walk through it)
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 0.3, pos.z);
    const cd = RAPIER.ColliderDesc.cuboid(0.22, 0.28, 0.24)
      .setCollisionGroups(groups(G.ANIMAL, G.PLAYER | G.PROP | G.RAGDOLL | G.HELD))
      .setFriction(0.6);
    this.body = game.physics.createBody(desc, [cd]);
    this.entity = game.entities.create({
      kind: 'animal',
      name: 'Actual Cat',
      body: this.body,
      object: this.root,
      mass: 4,
      tags: new Set(['animal', 'cat', 'noclimb']),
      data: { cat: this, catName: name, grabLabel: 'Pet the cat (it will decline)', size: new THREE.Vector3(0.5, 0.6, 0.5), floatRadius: 0.3 },
      onGrab: () => {
        this.decline('grab');
        return false;
      },
      onBonk: (_g, _imp, _pt) => {
        const p = playerOf(game)?.position as THREE.Vector3 | undefined;
        if (p && p.distanceTo(this.home) < 3) this.decline('bonk');
        return true;
      },
      onWash: () => this.decline('wash'),
    });
  }

  get game() {
    return this.host.game;
  }

  /** Look at (and hiss at) Jimothy. */
  hiss(from: THREE.Vector3) {
    const game = this.game;
    this.targetYaw = Math.atan2(from.x - this.home.x, from.z - this.home.z);
    this.attentionT = 3.2;
    this.puff = 1;
    this.hopV = 2.2;
    if (this.hissCd <= 0) {
      this.hissCd = 0.8;
      game.sfx('hiss', this.home, 0.9, rand(1.25, 1.45));
    }
    speech(game, { object: this.root, offsetY: 0.9 }, pick(['HSSSSS!', 'Hsss.', '*unimpressed hiss*', 'Mrrrow. No.']), 1.8, this, 'shout');
  }

  decline(action: 'grab' | 'bonk' | 'wash') {
    const game = this.game;
    const p = playerOf(game)?.position as THREE.Vector3 | undefined;
    this.declines++;
    if (p) this.hiss(p);
    game.hint(pick(DECLINE[action]), 2.2);
    game.events.emit('catDeclined', { entity: this.entity, name: this.name, action });
    // after enough nonsense the cat turns its back on you
    if (this.declines % 3 === 0 && p) {
      this.targetYaw = Math.atan2(this.home.x - p.x, this.home.z - p.z);
      this.attentionT = 5;
    }
  }

  update(dt: number, playerPos: THREE.Vector3 | undefined) {
    const game = this.game;
    this.hissCd -= dt;
    this.attentionT -= dt;
    // idle: facing its chosen direction, the occasional disdainful glance at Jimothy
    this.glanceT -= dt;
    if (this.attentionT <= 0) {
      this.targetYaw = this.restYaw;
      if (this.glanceT <= 0 && playerPos && playerPos.distanceTo(this.home) < 8) {
        this.glanceT = 5 + Math.random() * 7;
        this.targetYaw = Math.atan2(playerPos.x - this.home.x, playerPos.z - this.home.z);
        this.attentionT = 1.4;
      }
    }
    this.yaw = dampAngle(this.yaw, this.targetYaw, 5, dt);
    this.root.rotation.y = this.yaw;
    // puff up + hop when startled
    this.puff = Math.max(0, this.puff - dt * 1.6);
    this.hopV -= 14 * dt;
    this.hop = Math.max(0, this.hop + this.hopV * dt);
    if (this.hop === 0 && this.hopV < 0) this.hopV = 0;
    this.breatheT += dt;
    const breathe = 1 + Math.sin(this.breatheT * 2.1) * 0.015;
    const pf = 1 + this.puff * 0.14;
    this.inner.scale.set(SCALE * pf, SCALE * breathe * (1 + this.puff * 0.08), SCALE * pf);
    this.inner.position.y = this.hop;
    // tail: slow sway + the occasional annoyed flick (faster while annoyed)
    this.flickT -= dt * (this.attentionT > 0 ? 3 : 1);
    if (this.flickT <= 0) {
      this.flickT = 1.5 + Math.random() * 3;
      this.flick = 1;
    }
    this.flick = Math.max(0, this.flick - dt * 2.4);
    const t = game.time;
    this.tailPivot.rotation.z = Math.sin(t * 1.3 + this.breatheT) * 0.18 + Math.sin(this.flick * Math.PI * 3) * 0.55 * this.flick;
    this.tailPivot.rotation.x = -0.1 + this.puff * 0.35;
  }
}

export class CatFeature implements ExtrasFeature {
  readonly id = 'cats';
  readonly cats: Cat[] = [];
  private metCount = 0;
  private metNames = new Set<string>();

  constructor(private host: ExtrasHost) {}

  get game() {
    return this.host.game;
  }

  async init() {
    const game = this.game;
    game.events.on('chitter', (p: any) => this.onChitter(p?.position));
    try {
      const saved = JSON.parse(localStorage.getItem('jimothy.cats.v1') || '[]');
      if (Array.isArray(saved)) for (const n of saved) this.metNames.add(String(n));
    } catch {
      /* fresh */
    }
    // resolve spots now (world is built); load the model in the background
    const spots: { s: Spot; pos: THREE.Vector3; yaw: number }[] = [];
    for (const s of SPOTS) {
      try {
        const r = s.place(this.host);
        if (r) spots.push({ s, ...r });
        else console.info(`[extras] cat "${s.name}" found no perch; skipped`);
      } catch (err) {
        console.warn('[extras] cat placement failed', err);
      }
    }
    game.assets
      .gltf(MODEL)
      .then((gltf) => this.spawnAll(gltf.scene, spots))
      .catch((err) => console.warn('[extras] cat model unavailable', err));
  }

  private spawnAll(scene: THREE.Object3D, spots: { s: Spot; pos: THREE.Vector3; yaw: number }[]) {
    // Bake the rest pose: everything but the tail into one geometry, the tail (with its pivot) into another.
    scene.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
    const bodyGeos: THREE.BufferGeometry[] = [];
    const found: { tail: THREE.BufferGeometry | null; tailMatrix: THREE.Matrix4; mat: THREE.MeshStandardMaterial | null } = {
      tail: null,
      tailMatrix: new THREE.Matrix4(),
      mat: null,
    };
    const clean = (g: THREE.BufferGeometry) => {
      const c = g.index ? g.toNonIndexed() : g.clone();
      for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') c.deleteAttribute(k);
      return c;
    };
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!found.mat) found.mat = m.material as THREE.MeshStandardMaterial;
      const rel = new THREE.Matrix4().multiplyMatrices(rootInv, m.matrixWorld);
      if (!found.tail && (/tail/i.test(m.name) || /tail/i.test(m.parent?.name ?? ''))) {
        found.tail = clean(m.geometry);
        found.tailMatrix = rel;
      } else {
        const g = clean(m.geometry);
        g.applyMatrix4(rel);
        bodyGeos.push(g);
      }
    });
    if (!found.mat || !bodyGeos.length) return;
    const bodyGeo = mergeGeometries(bodyGeos, false);
    if (!bodyGeo) return;
    bodyGeo.computeBoundingSphere();
    const tg = found.tail ?? new THREE.BufferGeometry();
    const tailMatrix = found.tailMatrix;
    const base = found.mat.clone();
    // palette texture: nearest filtering keeps the flat colours crisp (no palette bleeding in mips)
    if (base.map) {
      const map = base.map.clone();
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestFilter;
      map.generateMipmaps = false;
      map.needsUpdate = true;
      base.map = map;
    }
    const mats = new Map<string, THREE.Material>();
    for (const { s, pos, yaw } of spots) {
      let mat: THREE.Material = base;
      if (s.tint) {
        const key = s.tint.join(',');
        if (!mats.has(key)) {
          const m = base.clone() as THREE.MeshStandardMaterial;
          m.color.setRGB(s.tint[0], s.tint[1], s.tint[2]);
          mats.set(key, m);
        }
        mat = mats.get(key)!;
      }
      try {
        const cat = new Cat(this.host, s.name, pos, yaw, bodyGeo, tg, tailMatrix.clone(), mat);
        this.cats.push(cat);
        this.game.get<any>('world')?.poi?.set(`cat:${s.id}`, pos.clone());
      } catch (err) {
        console.warn('[extras] cat spawn failed', err);
      }
    }
  }

  private onChitter(pos?: THREE.Vector3) {
    if (!pos) return;
    const game = this.game;
    for (const cat of this.cats) {
      const d = Math.hypot(pos.x - cat.home.x, pos.z - cat.home.z);
      if (d > 6.5 || Math.abs(pos.y - cat.home.y) > 4) continue;
      cat.hiss(pos);
      const first = !cat.met;
      cat.met = true;
      this.metCount++;
      if (first) {
        const newName = !this.metNames.has(cat.name);
        this.metNames.add(cat.name);
        try {
          localStorage.setItem('jimothy.cats.v1', JSON.stringify([...this.metNames]));
        } catch {
          /* ignore */
        }
        game.score(newName ? 150 : 40, 'Actual Cat', cat.home.clone().setY(cat.home.y + 0.8));
        game.hint(`That's ${cat.name}. An actual cat. It is not impressed.`, 3);
      }
      game.events.emit('catMet', { entity: cat.entity, name: cat.name, first, count: this.metNames.size });
      // …and a human nearby finally sees a normal cat
      const npcs = game.get<any>('npcs');
      const list: any[] = npcs?.near?.(cat.home, 16, (n: any) => !n.ragdolled && !n.removed) ?? [];
      if (list.length && Math.random() < 0.85) {
        list.sort((a, b) => a.position.distanceToSquared(cat.home) - b.position.distanceToSquared(cat.home));
        const npc = list[0];
        setTimeoutGame(game, 1.3, () => {
          if (npc.removed || npc.ragdolled) return;
          try {
            npc.lookAt?.(cat.home.clone());
            npc.say?.(pick(NPC_LINES), 3);
            npc.setExpression?.('happy');
          } catch {
            /* optional */
          }
        });
      }
      break;
    }
  }

  update(dt: number) {
    const p = playerOf(this.game)?.position as THREE.Vector3 | undefined;
    for (const c of this.cats) {
      if (p && c.home.distanceToSquared(p) > 70 * 70) continue;
      c.update(dt, p);
    }
    tickGameTimers(this.game);
  }

  /** Debug/test: teleport next to a cat. */
  visit(i = 0) {
    const c = this.cats[i];
    const player = playerOf(this.game);
    if (!c || !player) return false;
    const fwd = _v.set(Math.sin(c.restYaw), 0, Math.cos(c.restYaw));
    const at = c.home.clone().addScaledVector(fwd, -1.8);
    at.y = groundY(this.game, at.x, at.z, c.home.y + 1.5) + 0.45;
    player.teleport(at, Math.atan2(c.home.x - at.x, c.home.z - at.z));
    return true;
  }
}

// tiny game-time timer list (NPC reaction delay)
const timers: { at: number; fn: () => void; game: unknown }[] = [];
function setTimeoutGame(game: { time: number }, secs: number, fn: () => void) {
  timers.push({ at: game.time + secs, fn, game });
}
function tickGameTimers(game: { time: number }) {
  for (let i = timers.length - 1; i >= 0; i--) {
    const t = timers[i];
    if (t.game !== game || t.at > game.time) continue;
    timers.splice(i, 1);
    try {
      t.fn();
    } catch (err) {
      console.warn('[extras] timer failed', err);
    }
  }
}
