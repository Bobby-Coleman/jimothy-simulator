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
  /**
   * Ladder volumes (world space). Climbing inside one costs the old, gentle stamina rate; bare walls, poles and
   * trees tire Jimothy 4× faster, so tall landmarks are climbed by ladder (or in stages, via ledges).
   */
  readonly ladders: THREE.Box3[] = [];
  addLadder(min: THREE.Vector3, max: THREE.Vector3) {
    this.ladders.push(new THREE.Box3(min.clone(), max.clone()));
  }
  onLadder(p: THREE.Vector3) {
    for (const b of this.ladders) if (b.containsPoint(p)) return true;
    return false;
  }
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
      // Make this zone's colliders visible to raycasts done by later zones / systems during setup
      game.physics.refreshQueries();
    }
  }

  /** Name of the area containing (x, z), for the HUD. */
  areaAt(x: number, z: number): string | null {
    for (const a of this.areas) if (x >= a.min.x && x <= a.max.x && z >= a.min.y && z <= a.max.y) return a.name;
    return null;
  }

  // ------------------------------------------------------------------ terrain
  /** Visual terrain chunks (4×4) so the camera frustum can cull what's off-screen; `terrain` = first chunk. */
  readonly terrainChunks: THREE.Mesh[] = [];

  private buildTerrain() {
    const half = MAP.terrainHalf;
    const n = Math.round((half * 2) / MAP.cell);
    const CH = 4;
    const per = Math.round(n / CH);
    const chunkSize = (half * 2) / CH;
    const tintA = new THREE.Color(0xcfeeb0);
    const tintB = new THREE.Color(0xf4f7c0);
    const c = new THREE.Color();
    const eps = 0.6;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, color: 0xa6d46e });
    for (let cz = 0; cz < CH; cz++) {
      for (let cx = 0; cx < CH; cx++) {
        const geo = new THREE.PlaneGeometry(chunkSize, chunkSize, per, per);
        geo.rotateX(-Math.PI / 2);
        geo.translate(-half + chunkSize * (cx + 0.5), 0, -half + chunkSize * (cz + 0.5));
        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
        const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
        const colors = new Float32Array(pos.count * 3);
        // splat weights: x = grass, y = dirt, z = sand
        const splat = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          const h = terrainHeight(x, z);
          pos.setY(i, h);
          // world-space UVs (one continuous texture mapping across chunks)
          uv.setXY(i, (x + half) / (half * 2), (half - z) / (half * 2));
          // analytic normals: seamless across chunk borders
          const hx = (terrainHeight(x + eps, z) - terrainHeight(x - eps, z)) / (2 * eps);
          const hz = (terrainHeight(x, z + eps) - terrainHeight(x, z - eps)) / (2 * eps);
          const il = 1 / Math.hypot(hx, 1, hz);
          nrm.setXYZ(i, -hx * il, il, -hz * il);
          const noise = Math.sin(x * 0.13) * Math.sin(z * 0.11) * 0.5 + Math.sin(x * 0.037 + z * 0.041) * 0.5;
          // Macro tint to break up tiling (Goat-Sim-ish sunny greens)
          c.copy(tintA).lerp(tintB, 0.5 + noise * 0.45);
          colors.set([c.r, c.g, c.b], i * 3);
          let g = 1,
            d = 0,
            sa = 0;
          if (h < -0.35) d = THREE.MathUtils.clamp((-0.35 - h) / 1.0, 0, 1);
          if (z > MAP.seawallZ - 3) sa = THREE.MathUtils.clamp((z - (MAP.seawallZ - 3)) / 3, 0, 1);
          g = Math.max(0, 1 - d - sa);
          const sum = g + d + sa || 1;
          splat.set([g / sum, d / sum, sa / sum], i * 3);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('splat', new THREE.BufferAttribute(splat, 3));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.name = 'terrain';
        mesh.userData.noCull = true;
        this.game.scene.add(mesh);
        this.terrainChunks.push(mesh);
      }
    }
    this.terrain = this.terrainChunks[0];
    this.applyTerrainTextures(mat, half * 2);

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

  /** Grass/dirt/sand splat blending with anti-tiling; falls back to flat colors until textures load. */
  private applyTerrainTextures(mat: THREE.MeshStandardMaterial, size: number) {
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    const uniforms = {
      tDirt: { value: white as THREE.Texture },
      tSand: { value: white as THREE.Texture },
      uTexOn: { value: 0 },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tDirt;\nuniform sampler2D tSand;\nuniform float uTexOn;\nvarying vec3 vSplat;')
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 gA = texture2D( map, vMapUv );
            vec4 gB = texture2D( map, vMapUv * 0.231 + 0.37 );
            vec4 grassC = mix( gA, gB, 0.4 );
            // Re-colour the (dry) photo grass into lush Goat-Sim green, keeping its detail
            float gl = dot( grassC.rgb, vec3( 0.3, 0.59, 0.11 ) );
            grassC.rgb = mix( vec3( gl ), grassC.rgb, 0.25 ) * vec3( 0.5, 1.0, 0.3 ) * 1.22;
            vec4 dirtC = texture2D( tDirt, vMapUv * 0.8 );
            vec4 sandC = texture2D( tSand, vMapUv * 0.7 );
            vec4 texC = grassC * vSplat.x + dirtC * vSplat.y + sandC * vSplat.z;
            // Without textures loaded, tint by splat colors instead
            vec4 flatC = vec4( vec3(0.55, 0.78, 0.36) * vSplat.x + vec3(0.55, 0.45, 0.32) * vSplat.y + vec3(0.85, 0.78, 0.58) * vSplat.z, 1.0 );
            diffuseColor *= mix( flatC, texC * 1.9, uTexOn );
          #endif`,
        );
    };
    mat.customProgramCacheKey = () => 'terrain-splat';
    // A 1×1 map so USE_MAP is defined from the start (keeps a single shader variant)
    const placeholder = white.clone();
    placeholder.needsUpdate = true;
    mat.map = placeholder;
    mat.color.set(0xffffff);
    const rep = size / 7;
    const a = this.game.assets;
    Promise.all([
      a.tryTexture('assets/textures/grass/color.jpg', { repeat: rep }),
      a.tryTexture('assets/textures/grass/normal.jpg', { srgb: false, repeat: rep }),
      a.tryTexture('assets/textures/dirt/color.jpg'),
      a.tryTexture('assets/textures/sand/color.jpg'),
    ]).then(([grass, normal, dirt, sand]) => {
      if (!grass || !dirt || !sand) return;
      mat.map = grass;
      if (normal) {
        mat.normalMap = normal;
        mat.normalScale.set(0.6, 0.6);
      }
      uniforms.tDirt.value = dirt;
      uniforms.tSand.value = sand;
      uniforms.uTexOn.value = 1;
      mat.needsUpdate = true;
    });
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
    // (unclimbable: scaling an invisible 60 m wall looks like a bug, not a raccoon)
    for (const c of [
      ph.staticBox(new THREE.Vector3(-L - 1, H / 2, 40), new THREE.Vector3(1, H, 260)),
      ph.staticBox(new THREE.Vector3(L + 1, H / 2, 40), new THREE.Vector3(1, H, 260)),
      ph.staticBox(new THREE.Vector3(0, H / 2, -L - 1), new THREE.Vector3(L + 2, H, 1)),
      ph.staticBox(new THREE.Vector3(0, H / 2, MAP.seawallZ + 70), new THREE.Vector3(L + 2, H, 1)),
    ])
      ph.noClimb.add(c.handle);
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
