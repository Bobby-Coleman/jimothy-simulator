import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import { MAP } from './terrain';
import type { World } from './World';
import { northMaterials } from './zones/north/kit';
import { plantTrees } from './zones/north/flora';

/**
 * Cheap distant scenery so the edge of the world never shows: a ring of rolling hills around the map (open to the
 * bay in the south), the jagged Olympics to the west, and a big snow-capped "Mount Rainier-ish" across the bay to the
 * south-east (it's Seattle; the mountain is out). ~3k triangles, 3 draw calls, no shadows.
 */
export class Horizon implements System {
  name = 'horizon';
  private mountainMat: THREE.MeshStandardMaterial | null = null;

  async init(game: Game) {
    await this.plantSideForests(game).catch((err) => console.warn('[horizon] side forests failed', err));
    // Low quality has a short far plane + thick fog: no horizon needed (and mountains would sit too close)
    if (game.renderer.quality === 'low') return;
    const far = game.camera.far;
    const group = new THREE.Group();
    group.name = 'horizon';

    // --- hill ring (radial grid), fogged like the world so it melts into the haze
    const rings = 14;
    const segs = 96;
    const inner = MAP.terrainHalf - 12;
    const outer = Math.min(far * 0.92, 1300);
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const green = new THREE.Color(0x5f8f4a);
    const dark = new THREE.Color(0x3f6a45);
    const shore = new THREE.Color(0x8a9a78);
    const c = new THREE.Color();
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const rad = inner + (outer - inner) * t * t;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const x = Math.cos(a) * rad;
        const z = Math.sin(a) * rad;
        // south (bay side, +z): stay under water until the far shore
        const south = THREE.MathUtils.smoothstep(z / rad, 0.25, 0.75);
        const noise = Math.sin(a * 7.3 + 1.1) * 0.5 + Math.sin(a * 13.1 + 2.3) * 0.3 + Math.sin(a * 23.7) * 0.2;
        let h = (18 + 40 * THREE.MathUtils.smoothstep(t, 0.05, 0.8)) * (0.75 + 0.25 * noise);
        const farShore = THREE.MathUtils.smoothstep(t, 0.55, 0.9) * (10 + 8 * noise);
        h = THREE.MathUtils.lerp(h, rad < 700 ? MAP.seabedY - 2 : farShore, south);
        pos.push(x, h, z);
        c.copy(green).lerp(dark, THREE.MathUtils.clamp(0.4 + noise * 0.5, 0, 1)).lerp(shore, south * 0.6);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segs; s++) {
        const a = r * (segs + 1) + s;
        const b = a + segs + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const hills = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    hills.position.y = -0.5; // tuck under the real terrain where they overlap
    hills.name = 'horizon-hills';
    hills.userData.noCull = true;
    group.add(hills);

    // --- mountains: fog off (they'd vanish), hazy colours baked in instead
    // Aerial-perspective haze: a bluish emissive lift (faded at night in lateUpdate) so far peaks read light and the snow pops
    const mountainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, fog: false, flatShading: true, emissive: 0x5a6d88, emissiveIntensity: 0.55 });
    this.mountainMat = mountainMat;
    const peak = (height: number, radius: number, jag: number, seed: number) => {
      const g = new THREE.ConeGeometry(radius, height, 40, 8, false);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const colors = new Float32Array(p.count * 3);
      const rock = new THREE.Color(0x7c8fa8);
      const snow = new THREE.Color(0xf4f7fb);
      const cc = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const a = Math.atan2(z, x);
        const k = (y + height / 2) / height; // 0 base .. 1 tip
        const wob = 1 + jag * (Math.sin(a * 5 + seed) * 0.5 + Math.sin(a * 11 + seed * 2) * 0.3) * (1 - k);
        p.setXYZ(i, x * wob, y + Math.sin(a * 3 + seed) * height * 0.03 * (1 - k), z * wob);
        const snowLine = 0.55 + Math.sin(a * 9 + seed) * 0.06;
        cc.copy(rock).lerp(snow, THREE.MathUtils.smoothstep(k, snowLine, snowLine + 0.08));
        colors.set([cc.r, cc.g, cc.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.computeVertexNormals();
      return g;
    };
    // Rainier-ish across the bay to the south-east, sized to stay inside the camera's far plane
    const dist = Math.min(far * 0.8, 1150);
    const rainier = new THREE.Mesh(peak(dist * 0.2, dist * 0.42, 0.18, 1.7), mountainMat);
    rainier.position.set(dist * 0.45, dist * 0.1 - 6, dist * 0.82);
    rainier.name = 'mount-rainierish';
    rainier.userData.noCull = true;
    group.add(rainier);
    // The Olympics: a ridge of smaller jagged peaks to the west
    for (let i = 0; i < 6; i++) {
      const h = dist * (0.07 + ((i * 37) % 5) * 0.012);
      const m = new THREE.Mesh(peak(h, h * 1.6, 0.35, i * 2.3), mountainMat);
      m.position.set(-dist * (0.8 + (i % 2) * 0.06), h / 2 - 8, -dist * 0.35 + i * dist * 0.14);
      m.userData.noCull = true;
      group.add(m);
    }
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    game.scene.add(group);
  }

  lateUpdate(_dt: number, game: Game) {
    if (!this.mountainMat) return;
    const night = game.get<any>('environment')?.nightFactor ?? 0;
    this.mountainMat.emissiveIntensity = 0.55 * (1 - night);
    // darker silhouette at night (otherwise the moon + sky grade make it read pale lavender)
    this.mountainMat.color.setScalar(1 - 0.62 * night);
  }

  /** Forest on the east/west edge berms (the north builder covers the north edge) so they read as wooded hills. */
  private async plantSideForests(game: Game) {
    const world = game.get<World>('world');
    if (!world) return;
    const mats = await northMaterials(game);
    let seed = 91;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const firs: [number, number][] = [];
    const cedars: [number, number][] = [];
    for (const side of [-1, 1]) {
      for (let z = -62; z < 158; z += 8) {
        for (let x = 201; x <= 257; x += 8) {
          if (rand() < 0.18) continue; // gaps so it reads as a natural treeline
          (rand() < 0.6 ? firs : cedars).push([side * (x + (rand() - 0.5) * 5), z + (rand() - 0.5) * 5]);
        }
      }
    }
    plantTrees(game, world, mats, 'fir', firs, { seed: 411, scale: [1.0, 1.8], collider: false, castShadow: false, lowPoly: true });
    plantTrees(game, world, mats, 'cedar', cedars, { seed: 412, scale: [1.0, 1.7], collider: false, castShadow: false, lowPoly: true });
  }
}
