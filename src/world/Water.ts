import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import { RAPIER, G, groups } from '../core/Physics';

export type WaterKind = 'bay' | 'pond' | 'fountain' | 'puddle' | 'pool' | 'sink' | 'sprinkler' | 'birdbath' | 'toilet' | 'ladder' | 'server-coolant';

export interface WaterVolume {
  id: number;
  name: string;
  kind: WaterKind;
  /** Surface center. */
  center: THREE.Vector3;
  /** Box half extents in XZ (ignored if radius is set). */
  halfX: number;
  halfZ: number;
  /** Circular volume radius (optional). */
  radius?: number;
  depth: number;
  surfaceY: number;
  mesh?: THREE.Mesh;
  /** Disabled volumes (e.g. switched-off sprinkler) are ignored. */
  enabled: boolean;
}

let normalTex: THREE.DataTexture | null = null;
function waterNormalTexture() {
  if (normalTex) return normalTex;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const waves: [number, number, number, number][] = [];
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const k = (1 + Math.floor(Math.random() * 6)) * 2 * Math.PI;
    waves.push([Math.cos(a) * k, Math.sin(a) * k, Math.random() * Math.PI * 2, 1 / (1 + i * 0.35)]);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0,
        dy = 0;
      const u = x / size,
        v = y / size;
      for (const [kx, ky, p, amp] of waves) {
        // integer wave numbers keep it tileable
        const c = Math.cos(Math.round(kx / (2 * Math.PI)) * 2 * Math.PI * u + Math.round(ky / (2 * Math.PI)) * 2 * Math.PI * v + p);
        dx += c * Math.round(kx / (2 * Math.PI)) * amp;
        dy += c * Math.round(ky / (2 * Math.PI)) * amp;
      }
      const n = new THREE.Vector3(-dx * 0.04, -dy * 0.04, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  normalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.generateMipmaps = true;
  normalTex.minFilter = THREE.LinearMipmapLinearFilter;
  normalTex.magFilter = THREE.LinearFilter;
  normalTex.needsUpdate = true;
  return normalTex;
}

const _v = new THREE.Vector3();

/** Art pass: shared water uniforms — time for the second wave layer, and the sky colour the fresnel reflects. */
const waterUniforms = {
  uWaterTime: { value: 0 },
  uWaterSky: { value: new THREE.Color(0.75, 0.85, 0.95) },
};
const _sky = new THREE.Color();

/**
 * Stylised water: a second, slower normal-map layer crossing the first (gentle cross-waves instead of one sliding
 * texture), and a fresnel blend toward the horizon colour — calm reflective sheen at grazing angles, clear colour when
 * looking down. Pure shader math on the existing material: no extra passes or draw calls.
 */
function stylizeWater(m: THREE.MeshStandardMaterial, fresnelAmt: number) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = waterUniforms.uWaterTime;
    shader.uniforms.uWaterSky = waterUniforms.uWaterSky;
    const maps = THREE.ShaderChunk.normal_fragment_maps.replace(
      'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
      `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
       vec3 mapN2 = texture2D( normalMap, vNormalMapUv * 0.61 + vec2( -uWaterTime * 0.009, uWaterTime * 0.013 ) ).xyz * 2.0 - 1.0;
       mapN = vec3( mapN.xy + mapN2.xy, mapN.z * mapN2.z );`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWaterTime;\nuniform vec3 uWaterSky;')
      .replace('#include <normal_fragment_maps>', maps)
      .replace(
        '#include <opaque_fragment>',
        `float wF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
         outgoingLight = mix(outgoingLight, uWaterSky, clamp(wF * ${fresnelAmt.toFixed(2)}, 0.0, 0.9));
         diffuseColor.a = mix(diffuseColor.a, 1.0, wF);
         #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'water_stylized_' + fresnelAmt.toFixed(2);
}

export class WaterSystem implements System {
  name = 'water';
  readonly volumes: WaterVolume[] = [];
  private nextId = 1;
  private game!: Game;
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private scroll = 0;

  init(game: Game) {
    this.game = game;
  }

  material(kind: WaterKind): THREE.MeshStandardMaterial {
    const key = kind === 'bay' || kind === 'pond' ? kind : kind === 'puddle' ? 'puddle' : kind === 'server-coolant' ? 'coolant' : 'clear';
    let m = this.materials.get(key);
    if (m) return m;
    const tex = waterNormalTexture().clone();
    tex.needsUpdate = true;
    // art pass: richer, more saturated Goat-Sim water (bay: deep teal-blue, pond: green-teal, pools: bright aqua)
    const color = key === 'bay' ? 0x1b6d99 : key === 'pond' ? 0x2c7c74 : key === 'puddle' ? 0x6d7f8c : key === 'coolant' ? 0x39e6ff : 0x4fc4e6;
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: key === 'puddle' ? 0.14 : 0.1,
      metalness: 0.05,
      transparent: true,
      opacity: key === 'puddle' ? 0.6 : key === 'bay' ? 0.88 : 0.78,
      normalMap: tex,
      normalScale: new THREE.Vector2(0.3, 0.3),
      envMapIntensity: 1.4,
      depthWrite: false,
    });
    if (key === 'coolant') {
      m.emissive = new THREE.Color(0x0bb8d6);
      m.emissiveIntensity = 0.6;
    } else {
      stylizeWater(m, key === 'puddle' ? 0.45 : 0.5);
    }
    tex.repeat.set(key === 'bay' ? 40 : 4, key === 'bay' ? 40 : 4);
    this.materials.set(key, m);
    return m;
  }

  /**
   * Add a rectangular water body. `center` is the center of the water SURFACE.
   * size = [width X, depth (down from surface), length Z].
   */
  addBox(opts: {
    name: string;
    kind: WaterKind;
    center: THREE.Vector3;
    size: [number, number, number];
    visual?: boolean;
    rotationY?: number;
  }): WaterVolume {
    const vol: WaterVolume = {
      id: this.nextId++,
      name: opts.name,
      kind: opts.kind,
      center: opts.center.clone(),
      halfX: opts.size[0] / 2,
      halfZ: opts.size[2] / 2,
      depth: opts.size[1],
      surfaceY: opts.center.y,
      enabled: true,
    };
    if (opts.visual !== false) {
      const geo = new THREE.PlaneGeometry(opts.size[0], opts.size[2]);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.material(opts.kind));
      mesh.position.copy(opts.center);
      mesh.receiveShadow = true;
      mesh.renderOrder = 2;
      this.game.scene.add(mesh);
      vol.mesh = mesh;
    }
    this.volumes.push(vol);
    return vol;
  }

  /** Add a circular water body (fountain basin, pond, puddle). */
  addCircle(opts: { name: string; kind: WaterKind; center: THREE.Vector3; radius: number; depth: number; visual?: boolean }): WaterVolume {
    const vol: WaterVolume = {
      id: this.nextId++,
      name: opts.name,
      kind: opts.kind,
      center: opts.center.clone(),
      halfX: opts.radius,
      halfZ: opts.radius,
      radius: opts.radius,
      depth: opts.depth,
      surfaceY: opts.center.y,
      enabled: true,
    };
    if (opts.visual !== false) {
      const geo = new THREE.CircleGeometry(opts.radius, 40);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, this.material(opts.kind));
      mesh.position.copy(opts.center);
      mesh.receiveShadow = true;
      mesh.renderOrder = 2;
      this.game.scene.add(mesh);
      vol.mesh = mesh;
    }
    this.volumes.push(vol);
    return vol;
  }

  remove(vol: WaterVolume) {
    const i = this.volumes.indexOf(vol);
    if (i >= 0) this.volumes.splice(i, 1);
    if (vol.mesh) vol.mesh.removeFromParent();
  }

  private insideXZ(v: WaterVolume, x: number, z: number, pad = 0) {
    const dx = x - v.center.x;
    const dz = z - v.center.z;
    if (v.radius != null) return dx * dx + dz * dz <= (v.radius + pad) * (v.radius + pad);
    return Math.abs(dx) <= v.halfX + pad && Math.abs(dz) <= v.halfZ + pad;
  }

  /** The water volume containing point p (below its surface), if any. */
  volumeAt(p: THREE.Vector3): WaterVolume | null {
    for (const v of this.volumes) {
      if (!v.enabled || v.depth < 0.25) continue;
      if (p.y > v.surfaceY + 0.05 || p.y < v.surfaceY - v.depth - 0.6) continue;
      if (this.insideXZ(v, p.x, p.z)) return v;
    }
    return null;
  }

  /** Any water surface within `r` meters of p (for washing). */
  nearWater(p: THREE.Vector3, r: number): WaterVolume | null {
    let best: WaterVolume | null = null;
    let bestD = Infinity;
    for (const v of this.volumes) {
      if (!v.enabled) continue;
      const dy = p.y - v.surfaceY;
      if (dy > r + 0.2 || dy < -v.depth - 0.5) continue;
      let dxz: number;
      const dx = p.x - v.center.x;
      const dz = p.z - v.center.z;
      if (v.radius != null) dxz = Math.max(0, Math.hypot(dx, dz) - v.radius);
      else dxz = Math.hypot(Math.max(0, Math.abs(dx) - v.halfX), Math.max(0, Math.abs(dz) - v.halfZ));
      const d = Math.hypot(dxz, Math.max(0, dy));
      if (d <= r && d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  update(dt: number) {
    const game = this.game;
    this.scroll += dt;
    for (const m of this.materials.values()) {
      if (m.normalMap) {
        m.normalMap.offset.set(this.scroll * 0.012, this.scroll * 0.008);
      }
    }
    // fresnel reflects the horizon haze (peach at golden hour, deep blue at night), lifted a touch toward the sky
    waterUniforms.uWaterTime.value = this.scroll;
    const fog = game.scene.fog as THREE.Fog | null;
    const env = game.get<any>('environment');
    if (fog) {
      const night = env?.nightFactor ?? 0;
      _sky.copy(fog.color);
      if (env?.hemi) _sky.lerp(env.hemi.color, 0.6 * (1 - 0.7 * night));
      waterUniforms.uWaterSky.value.copy(_sky).multiplyScalar(0.95 - 0.35 * night);
    }
    // Buoyancy for dynamic things in deep-ish water.
    // NOTE: never modify bodies inside a Rapier query callback — collect first, apply after.
    const world = game.physics.world;
    const seen = new Set<number>();
    const g = -game.physics.gravity;
    for (const v of this.volumes) {
      if (!v.enabled || v.depth < 0.35) continue;
      const hx = v.radius ?? v.halfX;
      const hz = v.radius ?? v.halfZ;
      const shape = new RAPIER.Cuboid(hx, v.depth / 2 + 0.3, hz);
      const found: RAPIER.Collider[] = [];
      world.intersectionsWithShape(
        { x: v.center.x, y: v.surfaceY - v.depth / 2 + 0.3, z: v.center.z },
        { x: 0, y: 0, z: 0, w: 1 },
        shape,
        (c) => {
          found.push(c);
          return true;
        },
        undefined,
        groups(G.ALL, G.PROP | G.RAGDOLL | G.NPC | G.ANIMAL | G.VEHICLE),
      );
      for (const c of found) {
        const b = c.parent();
        if (!b || !b.isDynamic() || seen.has(b.handle)) continue;
        seen.add(b.handle);
        const e = game.entities.fromCollider(c);
        if (e?.kind === 'player') continue;
        const t = b.translation();
        if (!this.insideXZ(v, t.x, t.z)) continue;
        const r = (e?.data.floatRadius as number) ?? 0.3;
        const sub = THREE.MathUtils.clamp((v.surfaceY - (t.y - r)) / (2 * r), 0, 1);
        if (sub <= 0) continue;
        const mass = b.mass();
        const density = (e?.data.buoyancy as number) ?? 1.4; // >1 floats
        b.applyImpulse({ x: 0, y: mass * g * density * sub * dt, z: 0 }, true);
        const lv = b.linvel();
        const damp = Math.exp(-2.2 * sub * dt);
        b.setLinvel({ x: lv.x * damp, y: lv.y * damp, z: lv.z * damp }, true);
        const av = b.angvel();
        b.setAngvel({ x: av.x * damp, y: av.y * damp, z: av.z * damp }, true);
        if (e && !e.data.inWater) {
          e.data.inWater = true;
          if (Math.abs(lv.y) > 3) game.events.emit('splash', { position: new THREE.Vector3(t.x, v.surfaceY, t.z), strength: Math.abs(lv.y), volume: v });
        }
      }
    }
  }
}
