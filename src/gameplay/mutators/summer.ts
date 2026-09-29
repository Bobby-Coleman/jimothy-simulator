import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../../core/Game';
import { G, groups } from '../../core/Physics';
import type { Environment } from '../../world/Environment';
import { Attachment, glbOr, buildSunglasses } from './accessories';
import { getPlayer, PLAYER_R, type MutatorImpl } from './types';

const FLOWER_COLORS = [0xff8fc7, 0xfff4e6, 0xffe066, 0xc9a0ff, 0xff7a59, 0x8fd3ff, 0xff5d8f];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

interface Flower {
  pos: THREE.Vector3;
  rot: number;
  size: number;
  age: number;
  life: number;
  alive: boolean;
}

/** A pool of instanced little flowers that pop up behind Jimothy and wilt away after a few seconds. */
class FlowerField {
  private petals: THREE.InstancedMesh;
  private stems: THREE.InstancedMesh;
  private items: Flower[] = [];
  private next = 0;
  constructor(
    private game: Game,
    private max = 180,
  ) {
    const petalParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.SphereGeometry(0.045, 8, 6);
      g.scale(1, 0.3, 0.62);
      g.translate(0.048, 0, 0);
      g.rotateY((i / 5) * Math.PI * 2);
      petalParts.push(g);
    }
    const petalGeo = mergeGeometries(petalParts)!;
    petalGeo.translate(0, 0.14, 0);
    const stem = new THREE.CylinderGeometry(0.006, 0.008, 0.14, 5);
    stem.translate(0, 0.07, 0);
    const core = new THREE.SphereGeometry(0.026, 8, 6);
    core.scale(1, 0.6, 1);
    core.translate(0, 0.148, 0);
    const leaf = new THREE.SphereGeometry(0.03, 6, 4);
    leaf.scale(1, 0.25, 0.45);
    leaf.translate(0.03, 0.05, 0);
    const colorize = (g: THREE.BufferGeometry, hex: number) => {
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      _c.set(hex);
      for (let i = 0; i < n; i++) arr.set([_c.r, _c.g, _c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      return g;
    };
    const stemGeo = mergeGeometries([colorize(stem, 0x4f9a3a), colorize(leaf, 0x5cae42), colorize(core, 0xffc629)])!;
    for (const g of petalParts) g.dispose();
    stem.dispose();
    core.dispose();
    leaf.dispose();
    this.petals = new THREE.InstancedMesh(petalGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), max);
    this.stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), max);
    for (const im of [this.petals, this.stems]) {
      im.castShadow = false;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      game.scene.add(im);
    }
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.items.push({ pos: new THREE.Vector3(), rot: 0, size: 1, age: 0, life: 0, alive: false });
      this.petals.setMatrixAt(i, _m);
      this.stems.setMatrixAt(i, _m);
      this.petals.setColorAt(i, _c.set(0xffffff));
    }
    this.petals.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  spawn(pos: THREE.Vector3, size: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const f = this.items[i];
    f.pos.copy(pos);
    f.rot = Math.random() * Math.PI * 2;
    f.size = size * (0.8 + Math.random() * 0.5);
    f.age = 0;
    f.life = 6 + Math.random() * 3;
    f.alive = true;
    this.petals.setColorAt(i, _c.set(FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)]));
    this.petals.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      const f = this.items[i];
      if (!f.alive) continue;
      any = true;
      f.age += dt;
      let k: number;
      if (f.age < 0.35) {
        const t = f.age / 0.35;
        k = 1 + Math.sin(t * Math.PI) * 0.25 - (1 - t) * (1 - t); // springy pop
        k = Math.max(0, k);
      } else if (f.age > f.life - 0.8) k = Math.max(0, (f.life - f.age) / 0.8);
      else k = 1;
      if (f.age >= f.life) {
        f.alive = false;
        k = 0;
      }
      _q.setFromAxisAngle(UP, f.rot + Math.sin(f.age * 2 + i) * 0.1);
      _s.setScalar(k * f.size);
      _m.compose(f.pos, _q, _s);
      this.petals.setMatrixAt(i, _m);
      this.stems.setMatrixAt(i, _m);
    }
    if (any) {
      this.petals.instanceMatrix.needsUpdate = true;
      this.stems.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const im of [this.petals, this.stems]) {
      im.removeFromParent();
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.dispose();
    }
  }
}

export function jimothySummer(): MutatorImpl {
  const names = ['Sunglasses', 'Shades', 'Glasses'];
  const glasses = new Attachment('Head', (a) => glbOr(names, 'face', a, () => buildSunglasses(a)), names);
  let flowers: FlowerField | null = null;
  let saved: { time: number; frozen: boolean } | null = null;
  let savedSat: number | null = null;
  let travel = 0;

  return {
    def: {
      id: 'jimothySummer',
      name: 'Jimothy Summer',
      desc: "Shades on. It's 1 PM forever, colors pop, and flowers bloom wherever you waddle.",
      unlockHint: "Complete 'Jimothy Summer' (attend your proclamation at City Hall).",
    },
    enable(game) {
      const env = game.get<Environment>('environment');
      if (env) {
        saved = { time: env.timeOfDay, frozen: env.frozen };
        env.setTime(13);
        env.frozen = true;
      }
      const sat = game.renderer?.saturation;
      if (sat) {
        savedSat = sat.saturation;
        sat.saturation = Math.min(0.9, savedSat + 0.15);
      }
      flowers = new FlowerField(game);
      travel = 0;
      game.hint('Jimothy Summer: officially declared. It is 1 PM forever.', 3);
    },
    disable(game) {
      const env = game.get<Environment>('environment');
      if (env && saved) {
        env.frozen = saved.frozen;
        env.setTime(saved.time);
      }
      saved = null;
      const sat = game.renderer?.saturation;
      if (sat && savedSat != null) sat.saturation = savedSat;
      savedSat = null;
      glasses.remove();
      flowers?.dispose();
      flowers = null;
    },
    update(game, dt) {
      const p = getPlayer(game);
      if (!p || !flowers) return;
      if (!p.grounded || (p.mode !== 'walk' && p.mode !== 'roll') || p.speed < 0.7) return;
      travel += p.speed * dt;
      const step = 0.42 * Math.max(0.6, p.sizeMul);
      const water = game.get<any>('water');
      let n = 0;
      while (travel > step && n < 4) {
        travel -= step;
        n++;
        const side = new THREE.Vector3(Math.cos(p.facing), 0, -Math.sin(p.facing));
        const off = (Math.random() - 0.5) * 0.9 * p.sizeMul;
        _p.copy(p.position).addScaledVector(side, off);
        _p.x += (Math.random() - 0.5) * 0.25;
        _p.z += (Math.random() - 0.5) * 0.25;
        const hit = game.physics.raycast(_p, DOWN, PLAYER_R * 2 + 1.5, groups(G.ALL, G.WORLD));
        if (!hit || hit.normal.y < 0.6) continue;
        if (water?.nearWater?.(hit.point, 0.3)) continue;
        flowers.spawn(hit.point, 0.9 + Math.random() * 0.5);
      }
    },
    post(game, dt) {
      const p = getPlayer(game);
      if (p) glasses.ensure(p.model);
      flowers?.update(dt);
    },
  };
}
