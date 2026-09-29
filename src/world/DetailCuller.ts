import * as THREE from 'three';
import type { Game, System } from '../core/Game';

/**
 * Distance culling for small dynamic things (props, items, animals) — the fog hides them anyway, and each one
 * costs draw calls in both the main and the shadow pass. Only toggles objects it hid itself (`userData.culled`),
 * so systems that hide things on purpose keep control.
 *
 * Perf pass additions:
 *  - STATIC DETAILS: after the StaticBatcher has merged what it can, what is still drawn one-by-one under
 *    `world.staticRoot` is mostly small stuff (animated decor, glowing signs, unique-texture posters, small
 *    instanced clusters) plus the little water surfaces (puddles, fountains, birdbaths). Those are dropped by
 *    projected size: an object of world radius r is hidden beyond max(MIN_D, r × K) metres (≈ under 5 px).
 *    This uses `layers.mask = 0` instead of `visible`, so it can never fight gameplay code that shows/hides things
 *    (a layer-less object is skipped by both the colour and the shadow pass). Tag an object `userData.noCull` to opt out,
 *    or give it `userData.cullDist` (metres from its bounding surface) to override the size rule.
 *  - FOG: anything (incl. the StaticBatcher's merged batches) entirely beyond the fog's far distance is invisible
 *    anyway — it is culled too. Matters on low quality / in the rain, where the fog closes in to ~250 m.
 *  - PROPS/ITEMS: their range also scales with their size (a phone is gone at ~25 m, a dumpster at 85 m).
 *  - PROP SHADOWS: small props/items only cast shadows within a few metres of Jimothy (the shadow box is ~70 m
 *    wide and lawns full of gnomes/mailboxes/bins cost 40–60 shadow draws for specks nobody sees).
 */
const RANGE: Record<string, number> = {
  prop: 85,
  item: 70,
  collectible: 140,
  animal: 90,
  vehicle: 190,
  slop: 110,
};

/**
 * Projected-size factor per quality: an object of radius r is hidden beyond r × K metres from its bounding
 * surface (K = 100 ≈ 6 px radius at 720p). Instanced clusters (flowers, fruit piles, seats…) are judged by the
 * size of ONE instance with a 3× more tolerant factor (≈ 2 px per instance) — they read as a mass.
 */
const SIZE_K = { high: 100, medium: 80, low: 50 } as const;
const INST_K_MUL = 3;
/** Never size-cull closer than this. */
const MIN_D = 30;
/** Props/items: range = clamp(radius × K × ENT_K_MUL, ENT_MIN_D, RANGE[kind]). */
const ENT_K_MUL = 1.2;
const ENT_MIN_D = 24;
/** Props/items cast shadows only this close to Jimothy. */
const PROP_SHADOW_D = { high: 22, medium: 16, low: 11 } as const;

const _wp = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _box = new THREE.Box3();

interface Unit {
  obj: THREE.Object3D;
  /** Instanced cluster that casts shadows (turned off on the low preset). */
  instShadow?: boolean;
  center: THREE.Vector3; // local-space bounding sphere
  radius: number;
  /** For instanced clusters: local radius of one instance (sampled). */
  inst?: number;
  /** Explicit max distance (from the bounding surface) — `userData.cullDist`. */
  cullDist?: number;
  mask: number; // original layers mask
  culled: boolean;
}

export class DetailCuller implements System {
  name = 'culler';
  private t = 0;
  /** Multiplier (low quality shrinks view distance). */
  scale = 1;
  private sizeK = 120;
  private shadowD = 22;
  private units: Unit[] = [];
  private unitSet = new WeakSet<THREE.Object3D>();
  private collectT = 6; // fallback if the batcher never reports (worldBatched resets it to 0)
  private game!: Game;
  /** Debug: disable static-detail culling (`jimothy.get('culler').staticCull = false`). */
  staticCull = true;

  init(game: Game) {
    this.game = game;
    this.applyQuality();
    // Collect once the batcher has merged (whatever it left separate is what we cull), then re-scan now and then
    // for things systems add later.
    game.events.on('worldBatched', () => (this.collectT = 0));
  }

  private quality = '';
  private applyQuality() {
    const q = this.game.renderer.quality;
    this.quality = q;
    this.scale = q === 'low' ? 0.6 : q === 'medium' ? 0.85 : 1;
    this.sizeK = SIZE_K[q] ?? 120;
    this.shadowD = PROP_SHADOW_D[q] ?? 22;
    // low: instanced static clusters (trees, flowers, seats…) stop casting shadows (≈15 shadow draws in leafy areas)
    for (const u of this.units) if (u.instShadow) (u.obj as THREE.Mesh).castShadow = q !== 'low';
  }

  private collect(game: Game) {
    const world = game.get<any>('world');
    const add = (o: THREE.Object3D) => {
      if (this.unitSet.has(o)) return;
      const m = o as THREE.Mesh;
      if (!(m.isMesh || (o as any).isPoints || (o as any).isLine || (o as any).isSprite)) return;
      if ((m as any).isSkinnedMesh || o.userData.batched || o.userData.shadowOnly || o.userData.noCull) return;
      let sphere: THREE.Sphere | null;
      let inst: number | undefined;
      const g = m.geometry;
      if (!g?.attributes?.position) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      if ((m as any).isInstancedMesh) {
        const im = m as unknown as THREE.InstancedMesh;
        if (!im.boundingSphere) im.computeBoundingSphere(); // covers every instance
        sphere = im.boundingSphere;
        // size of one instance: geometry radius × the largest scale among a few sampled instance matrices
        let sc = 0;
        const n = Math.min(im.count, 12);
        for (let i = 0; i < n; i++) {
          im.getMatrixAt(Math.floor((i * im.count) / n), _m4);
          sc = Math.max(sc, _m4.getMaxScaleOnAxis());
        }
        inst = g.boundingSphere!.radius * (sc || 1);
      } else sphere = g.boundingSphere;
      if (!sphere || !Number.isFinite(sphere.radius)) return;
      o.getWorldScale(_s);
      const r = sphere.radius * Math.max(_s.x, _s.y, _s.z);
      if (!Number.isFinite(r)) return;
      const cullDist = typeof o.userData.cullDist === 'number' ? o.userData.cullDist : undefined;
      this.unitSet.add(o);
      this.units.push({
        obj: o,
        center: sphere.center.clone(),
        radius: sphere.radius,
        inst,
        cullDist,
        mask: o.layers.mask,
        culled: false,
        instShadow: inst != null && (m as THREE.Mesh).castShadow,
      });
      if (inst != null && this.quality === 'low') (m as THREE.Mesh).castShadow = false;
    };
    world?.staticRoot?.traverse(add);
    // the StaticBatcher's merged batches (big: only the fog rule really applies to them)
    game.scene.getObjectByName('static-batched')?.traverse(add);
    for (const v of game.get<any>('water')?.volumes ?? []) if (v.mesh) add(v.mesh);
    // forget objects that left the scene
    this.units = this.units.filter((u) => {
      let p: THREE.Object3D | null = u.obj;
      while (p && p !== game.scene) p = p.parent;
      if (p) return true;
      if (u.culled) u.obj.layers.mask = u.mask;
      this.unitSet.delete(u.obj);
      return false;
    });
  }

  lateUpdate(dt: number, game: Game) {
    this.t -= dt;
    if (this.collectT >= 0) {
      this.collectT -= dt;
      if (this.collectT <= 0) {
        this.collectT = 8;
        this.collect(game);
      }
    }
    if (this.t > 0) return;
    this.t = 0.25;
    if (game.renderer.quality !== this.quality) this.applyQuality(); // settings / AutoQuality can change it live
    const cam = game.camera.position;
    const ppos: THREE.Vector3 | undefined = game.get<any>('player')?.position;
    const sd2 = this.shadowD * this.shadowD;
    for (const e of game.entities.list) {
      const obj = e.object;
      if (!obj || !e.alive) continue;
      const r = RANGE[e.kind];
      if (!r) continue;
      const held = e.data.heldByPlayer;
      // World position (objects may be parented under something else)
      const wp = obj.parent === game.scene ? obj.position : obj.getWorldPosition(_wp);
      if (!held) {
        const d2 = wp.distanceToSquared(cam);
        let range = r * this.scale;
        if (e.kind === 'prop' || e.kind === 'item') {
          // size-aware: small things vanish sooner (radius cached on first visit)
          let rad = obj.userData.cullRadius as number | undefined;
          if (rad == null) {
            _box.setFromObject(obj);
            rad = obj.userData.cullRadius = _box.isEmpty() ? 0.5 : _box.getSize(_s).length() / 2;
          }
          range = Math.min(range, Math.max(ENT_MIN_D, rad * this.sizeK * ENT_K_MUL));
        }
        const far = d2 > range * range;
        if (far) {
          if (obj.visible) {
            obj.visible = false;
            obj.userData.culled = true;
          }
        } else if (obj.userData.culled) {
          obj.visible = true;
          obj.userData.culled = false;
        }
      }
      // Prop/item shadows only near Jimothy (animals/NPCs/vehicles manage their own shadow LOD)
      if ((e.kind === 'prop' || e.kind === 'item') && ppos) {
        const near = held || wp.distanceToSquared(ppos) < sd2;
        this.setPropShadow(obj, near);
      }
    }
    if (this.staticCull) this.cullStatic(cam, (game.scene.fog as THREE.Fog | null)?.far ?? Infinity);
  }

  /** Run `fn` with every size/fog-culled static object drawable again (e.g. the map's top-down capture). */
  suspend<T>(fn: () => T): T {
    const restore: Unit[] = [];
    for (const u of this.units) {
      if (!u.culled) continue;
      u.obj.layers.mask = u.mask;
      restore.push(u);
    }
    try {
      return fn();
    } finally {
      for (const u of restore) u.obj.layers.mask = 0;
    }
  }

  private setPropShadow(obj: THREE.Object3D, on: boolean) {
    const ud = obj.userData;
    if (ud.shadowFar === !on) return;
    let list = ud.shadowMeshes as THREE.Mesh[] | undefined;
    if (!list) {
      // remember which meshes cast shadows in the first place (noTinyShadows etc. already turned some off)
      list = [];
      obj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).castShadow) list!.push(o as THREE.Mesh);
      });
      ud.shadowMeshes = list;
    }
    for (const m of list) m.castShadow = on;
    ud.shadowFar = !on;
  }

  private cullStatic(cam: THREE.Vector3, fogFar: number) {
    const K = this.sizeK;
    for (const u of this.units) {
      const o = u.obj;
      _c.copy(u.center).applyMatrix4(o.matrixWorld); // last rendered matrix is plenty for culling

      const e = o.matrixWorld.elements;
      const sc = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
      const r = u.radius * sc;
      const d = _c.distanceTo(cam) - r; // distance to the bounding surface
      const limit = u.cullDist ?? Math.max(MIN_D, u.inst != null ? u.inst * sc * K * INST_K_MUL : r * K);
      const cull = d > limit || d > fogFar;
      if (cull === u.culled) continue;
      u.culled = cull;
      if (cull) {
        u.mask = o.layers.mask;
        o.layers.mask = 0;
      } else o.layers.mask = u.mask;
    }
  }
}

/** Utility: disable shadow casting on tiny meshes of an object (saves shadow-pass draws). */
export function noTinyShadows(obj: THREE.Object3D, minSize = 0.35) {
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.copy(m.geometry.boundingBox!);
    box.getSize(size).multiply(m.getWorldScale(new THREE.Vector3()));
    if (Math.max(size.x, size.y, size.z) < minSize) m.castShadow = false;
  });
}
