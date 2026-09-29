import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import { RAPIER, G, groups } from '../core/Physics';
import { MAP, terrainHeight } from './terrain';
import type { WaterSystem } from './Water';

export interface ZoneBuilder {
  /** Display name, e.g. "Old Ballard Ave". */
  name: string;
  /** Build static geometry, props, NPC spawn points etc. May be async (loading models). */
  build(game: Game, world: World): void | Promise<void>;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * The static world: terrain, the bay, map bounds and helper methods zone builders use.
 * Zones register themselves via world.addZone() (see src/world/zones/index.ts).
 */
export class World implements System {
  name = 'world';
  game!: Game;
  readonly zones: ZoneBuilder[] = [];
  terrain!: THREE.Mesh;
  readonly staticRoot = new THREE.Group();
  /** Named points of interest (spawn, quest spots). Zone builders fill this. */
  readonly poi = new Map<string, THREE.Vector3>();
  /** Areas for zone-name HUD display. */
  readonly areas: { name: string; min: THREE.Vector2; max: THREE.Vector2 }[] = [];
  /**
   * Where the NPC system should populate humans. Zone builders push entries.
   * `walkable` rectangles/circles NPCs wander in; `types` e.g. ['pedestrian','tourist','fan','jogger'].
   */
  readonly npcSpawns: {
    zone: string;
    center: THREE.Vector3;
    radius: number;
    count: number;
    types?: string[];
    /** Optional polyline NPCs stroll along (sidewalks). */
    path?: THREE.Vector3[];
  }[] = [];
  /** Driveable lanes for the vehicle system: polylines (closed loops preferred), y = road surface. */
  readonly lanes: { points: THREE.Vector3[]; loop: boolean; speed?: number }[] = [];
  private matCache = new Map<string, THREE.MeshStandardMaterial>();

  heightAt(x: number, z: number) {
    return terrainHeight(x, z);
  }

  addZone(z: ZoneBuilder) {
    this.zones.push(z);
  }

  async init(game: Game) {
    this.game = game;
    this.staticRoot.name = 'static';
    game.scene.add(this.staticRoot);
    this.buildTerrain();
    this.buildBay();
    this.buildBounds();
    for (const z of this.zones) {
      try {
        await z.build(game, this);
      } catch (err) {
        console.error(`[world] zone "${z.name}" failed to build`, err);
      }
    }
  }

  /** Name of the area containing (x, z), for the HUD. */
  areaAt(x: number, z: number): string | null {
    for (const a of this.areas) if (x >= a.min.x && x <= a.max.x && z >= a.min.y && z <= a.max.y) return a.name;
    return null;
  }

  // ------------------------------------------------------------------ terrain
  private buildTerrain() {
    const half = MAP.terrainHalf;
    const n = Math.round((half * 2) / MAP.cell);
    const geo = new THREE.PlaneGeometry(half * 2, half * 2, n, n);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(0x6aa84f);
    const grass2 = new THREE.Color(0x86b85a);
    const dirt = new THREE.Color(0x8d7a5b);
    const sand = new THREE.Color(0xc9b98f);
    const rock = new THREE.Color(0x6f6a64);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const noise = Math.sin(x * 0.13) * Math.sin(z * 0.11) * 0.5 + Math.sin(x * 0.037 + z * 0.041) * 0.5;
      c.copy(grass).lerp(grass2, 0.5 + noise * 0.5);
      if (h < -0.4) c.lerp(dirt, THREE.MathUtils.clamp((-0.4 - h) / 1.2, 0, 1));
      if (z > MAP.seawallZ - 2) c.lerp(sand, 0.6).lerp(rock, THREE.MathUtils.clamp((h + 2) / -5, 0, 1));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.game.scene.add(this.terrain);

    // Heightfield collider. Rapier: heights in column-major order, rows along Z, columns along X.
    const rows = n;
    const cols = n;
    const heights = new Float32Array((rows + 1) * (cols + 1));
    for (let j = 0; j <= cols; j++) {
      for (let i = 0; i <= rows; i++) {
        const x = -half + (j / cols) * half * 2;
        const z = -half + (i / rows) * half * 2;
        heights[j * (rows + 1) + i] = terrainHeight(x, z);
      }
    }
    const cd = RAPIER.ColliderDesc.heightfield(rows, cols, heights, { x: half * 2, y: 1, z: half * 2 })
      .setFriction(0.9)
      .setCollisionGroups(groups(G.WORLD));
    this.game.physics.staticCollider(cd);
  }

  private buildBay() {
    const water = this.game.get<WaterSystem>('water');
    if (!water) return;
    const zc = (MAP.seawallZ + MAP.terrainHalf) / 2 + 30;
    water.addBox({
      name: 'Salmon Bay',
      kind: 'bay',
      center: new THREE.Vector3(0, MAP.bayY, zc),
      size: [MAP.terrainHalf * 2 + 800, 8, (MAP.terrainHalf - MAP.seawallZ) + 60],
    });
    // Visual extension of the sea to the horizon
    const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 2000).rotateX(-Math.PI / 2), water.material('bay'));
    far.position.set(0, MAP.bayY - 0.02, zc + 1100);
    this.game.scene.add(far);
    // Pond
    const p = MAP.pond;
    water.addCircle({ name: 'Park Pond', kind: 'pond', center: new THREE.Vector3(p.x, p.waterY, p.z), radius: p.r + 1.5, depth: p.depth });
  }

  private buildBounds() {
    const ph = this.game.physics;
    const H = 60;
    const L = MAP.half + 18;
    // invisible walls around the playable area (the bay side is further out so you can swim)
    ph.staticBox(new THREE.Vector3(-L - 1, H / 2, 40), new THREE.Vector3(1, H, 260));
    ph.staticBox(new THREE.Vector3(L + 1, H / 2, 40), new THREE.Vector3(1, H, 260));
    ph.staticBox(new THREE.Vector3(0, H / 2, -L - 1), new THREE.Vector3(L + 2, H, 1));
    ph.staticBox(new THREE.Vector3(0, H / 2, MAP.seawallZ + 70), new THREE.Vector3(L + 2, H, 1));
  }

  // ------------------------------------------------------------------ helpers for zone builders

  /** Cached standard material by color/options key. */
  material(color: THREE.ColorRepresentation, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const key = `${new THREE.Color(color).getHexString()}|${JSON.stringify(opts)}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts });
      this.matCache.set(key, m);
    }
    return m;
  }

  /**
   * Static box: visible mesh + collider. `center` is the box center.
   * Returns the mesh (added to the static root).
   */
  box(
    center: THREE.Vector3,
    size: THREE.Vector3,
    material: THREE.Material,
    opts: { rotY?: number; collide?: boolean; castShadow?: boolean; name?: string } = {},
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(center);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = true;
    if (opts.name) mesh.name = opts.name;
    this.staticRoot.add(mesh);
    if (opts.collide !== false) {
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotY ?? 0);
      this.game.physics.staticBox(center, size.clone().multiplyScalar(0.5), _q);
    }
    return mesh;
  }

  /** Static collider only (no visual). */
  collider(center: THREE.Vector3, size: THREE.Vector3, rotY = 0) {
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    return this.game.physics.staticBox(center, size.clone().multiplyScalar(0.5), _q);
  }

  /** Add an arbitrary static visual object; optionally give it a box collider from its bounds. */
  addStatic(obj: THREE.Object3D, opts: { collider?: 'box' | 'trimesh' | 'none'; shadows?: boolean } = {}) {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = opts.shadows ?? true;
        m.receiveShadow = true;
      }
    });
    this.staticRoot.add(obj);
    obj.updateMatrixWorld(true);
    const mode = opts.collider ?? 'box';
    if (mode === 'box') {
      const b = new THREE.Box3().setFromObject(obj);
      const size = b.getSize(new THREE.Vector3());
      const c = b.getCenter(new THREE.Vector3());
      // Use the object's yaw so rotated buildings get oriented boxes
      const yaw = new THREE.Euler().setFromQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      if (Math.abs(yaw) > 0.01 && Math.abs(Math.abs(yaw) - Math.PI) > 0.01) {
        // compute local-space bounds for a tight oriented box
        const inv = new THREE.Matrix4().makeRotationY(-yaw);
        const lb = new THREE.Box3();
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry.computeBoundingBox();
          const gb = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld).applyMatrix4(inv);
          lb.union(gb);
        });
        const ls = lb.getSize(new THREE.Vector3());
        const lc = lb.getCenter(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
        this.collider(lc, ls, yaw);
      } else {
        this.collider(c, size, 0);
      }
    } else if (mode === 'trimesh') {
      this.trimeshCollider(obj);
    }
    return obj;
  }

  /** Exact trimesh collider for an object (use for irregular static things; costs more). */
  trimeshCollider(obj: THREE.Object3D) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry.index ? m.geometry : m.geometry;
      const pos = g.getAttribute('position');
      const verts = new Float32Array(pos.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        verts.set([v.x, v.y, v.z], i * 3);
      }
      let idx: Uint32Array;
      if (g.index) idx = new Uint32Array(g.index.array);
      else {
        idx = new Uint32Array(pos.count);
        for (let i = 0; i < pos.count; i++) idx[i] = i;
      }
      const cd = RAPIER.ColliderDesc.trimesh(verts, idx).setCollisionGroups(groups(G.WORLD)).setFriction(0.8);
      this.game.physics.staticCollider(cd);
    });
  }

  /**
   * Instanced static copies of a single-mesh-ish object (trees, lamps, fences).
   * transforms: [x, z, rotY, scale?] — y from terrain (+ yOffset).
   * collider: optional box size (full) per instance, centered at y + size.y/2.
   */
  instanced(
    template: THREE.Object3D,
    transforms: [number, number, number, number?][],
    opts: { collider?: THREE.Vector3; yOffset?: number; castShadow?: boolean } = {},
  ) {
    const meshes: THREE.Mesh[] = [];
    template.updateMatrixWorld(true);
    template.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) meshes.push(m);
    });
    const group = new THREE.Group();
    for (const src of meshes) {
      const im = new THREE.InstancedMesh(src.geometry, src.material, transforms.length);
      im.castShadow = opts.castShadow ?? true;
      im.receiveShadow = true;
      const local = src.matrixWorld.clone();
      transforms.forEach(([x, z, ry, sc], i) => {
        const y = terrainHeight(x, z) + (opts.yOffset ?? 0);
        _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        _s.setScalar(sc ?? 1);
        _p.set(x, y, z);
        _m.compose(_p, _q, _s).multiply(local);
        im.setMatrixAt(i, _m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    }
    this.staticRoot.add(group);
    if (opts.collider) {
      for (const [x, z, ry, sc] of transforms) {
        const s = opts.collider.clone().multiplyScalar(sc ?? 1);
        const y = terrainHeight(x, z) + (opts.yOffset ?? 0);
        this.collider(new THREE.Vector3(x, y + s.y / 2, z), s, ry);
      }
    }
    return group;
  }
}
