import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import { G, groups } from '../core/Physics';
import type { Jimothy } from '../player/Jimothy';
import type { CameraRig } from '../player/CameraRig';
import type { World } from '../world/World';
import type { WaterSystem } from '../world/Water';
import { ParticlePool, Shape, glowTexture } from './mutators/fx';

/**
 * Golden Jimothy bobbleheads: 10 spinning statuettes hidden around the map.
 * Placed at world POIs named `bobblehead:*` (level builders); if fewer than 10 exist, the rest go to
 * open ground near landmarks (validated with physics raycasts). Walk into one to collect it:
 * score + 'collectible' {id, kind:'bobblehead', count, total, position}. Progress persists in localStorage.
 * UI helpers: `nearest(pos)`, and a small compass shown while the objectives key is held or after the
 * UI emits 'objectivesPanel' {open}.
 */

const STORE_KEY = 'jimothy.collectibles.v1';
const TOTAL = 10;
const PICKUP_R = 0.95;

/** Fallback spots (x, z) near landmarks, spread over the 3×3 zone map. Validated/nudged at placement time. */
const FALLBACKS: { name: string; x: number; z: number }[] = [
  { name: 'thrift', x: -14, z: 10 },
  { name: 'pond', x: -121, z: 35 },
  { name: 'playground', x: -98, z: -22 },
  { name: 'hills', x: 18, z: -132 },
  { name: 'slopcorp', x: -128, z: -108 },
  { name: 'quad', x: 118, z: -124 },
  { name: 'plaza', x: 104, z: 18 },
  { name: 'stadium', x: 121, z: 116 },
  { name: 'market', x: 12, z: 142 },
  { name: 'locks', x: -112, z: 136 },
  { name: 'crossroads', x: 60, z: -62 },
  { name: 'bayview', x: -62, z: 150 },
  { name: 'backstreet', x: 36, z: 72 },
];

const QUIPS = [
  'Limited edition!',
  'Mint condition!',
  'Head still bobbling.',
  'Certified round.',
  'The resemblance is uncanny.',
  'Proceeds go to animal rescue!',
  'Collect them all!',
  'Solid gold. Probably.',
  'He nods approvingly.',
];

interface Bobble {
  id: string;
  pos: THREE.Vector3;
  root: THREE.Group;
  statue: THREE.Group;
  head: THREE.Group;
  glow: THREE.Sprite;
  beam: THREE.Mesh;
  beamMat: THREE.ShaderMaterial;
  phase: number;
  collected: boolean;
  /** Collect animation time (>= 0 while animating). */
  anim: number;
  sparkleT: number;
}

const BEAM_VERT = /* glsl */ `
varying float vY;
void main() {
  vY = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying float vY;
void main() {
  float a = pow(1.0 - vY, 1.8) * uOpacity * (0.75 + 0.25 * sin(uTime * 3.0 - vY * 14.0));
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export class Collectibles implements System {
  name = 'collectibles';
  readonly total = TOTAL;
  readonly items: Bobble[] = [];
  private collected = new Set<string>();
  private placed = false;
  private warmup = 0;
  private game!: Game;
  private sparkles: ParticlePool | null = null;
  private res: {
    gold: THREE.MeshStandardMaterial;
    darkGold: THREE.MeshStandardMaterial;
    black: THREE.MeshStandardMaterial;
    wood: THREE.MeshStandardMaterial;
    geos: Record<string, THREE.BufferGeometry>;
  } | null = null;
  private compassEl: HTMLDivElement | null = null;
  private compassWanted = false;

  get collectedCount() {
    return Math.min(TOTAL, this.collected.size);
  }

  init(game: Game) {
    this.game = game;
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (Array.isArray(s.bobblehead)) for (const id of s.bobblehead) if (typeof id === 'string') this.collected.add(id);
    } catch {
      /* ignore */
    }
    const panel = (p: any) => (this.compassWanted = !!(p?.open ?? p?.visible));
    game.events.on('objectivesPanel', panel);
    game.events.on('ui:objectives', panel);
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ bobblehead: [...this.collected] }));
    } catch {
      /* ignore */
    }
  }

  isCollected(id: string) {
    return this.collected.has(id);
  }

  /** Nearest uncollected bobblehead (for compass/UI hints). */
  nearest(from: THREE.Vector3): { id: string; position: THREE.Vector3; distance: number } | null {
    let best: Bobble | null = null;
    let bd = Infinity;
    for (const b of this.items) {
      if (b.collected) continue;
      const d = b.pos.distanceTo(from);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best ? { id: best.id, position: best.pos.clone(), distance: bd } : null;
  }

  /** Dev/test: forget collected state and respawn every bobblehead. */
  resetAll() {
    this.collected.clear();
    this.save();
    for (const b of this.items) b.root.removeFromParent();
    this.items.length = 0;
    this.placed = false;
  }

  // ------------------------------------------------------------------ placement
  private place() {
    this.placed = true;
    const game = this.game;
    const world = game.get<World>('world');
    const spots: { id: string; pos: THREE.Vector3 }[] = [];
    if (world) {
      const pois = [...world.poi.entries()].filter(([k]) => /^bobblehead[:_\-]/i.test(k)).sort((a, b) => a[0].localeCompare(b[0]));
      const down = new THREE.Vector3(0, -1, 0);
      for (const [id, v] of pois.slice(0, TOTAL)) {
        const pos = v.clone();
        const gy = world.heightAt(pos.x, pos.z);
        if (pos.y < gy) pos.y = gy;
        // POIs are usually a little above the surface: settle onto whatever is underneath
        const hit = game.physics.raycast(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), down, 1.6, groups(G.ALL, G.WORLD));
        if (hit && hit.normal.y > 0.5) pos.y = hit.point.y;
        spots.push({ id, pos });
      }
      for (const f of FALLBACKS) {
        if (spots.length >= TOTAL) break;
        const pos = this.findSpot(world, f.x, f.z, spots);
        if (pos) spots.push({ id: `bobblehead:auto-${f.name}`, pos });
      }
    }
    if (spots.length < TOTAL) console.warn(`[collectibles] only ${spots.length} bobblehead spots found`);
    for (const s of spots) this.spawn(s.id, s.pos, this.collected.has(s.id));
  }

  private findSpot(world: World, x: number, z: number, taken: { pos: THREE.Vector3 }[]): THREE.Vector3 | null {
    const ph = this.game.physics;
    const water = this.game.get<WaterSystem>('water');
    const down = new THREE.Vector3(0, -1, 0);
    const probe = new THREE.Vector3();
    for (let ring = 0; ring < 7; ring++) {
      const n = ring === 0 ? 1 : ring * 6;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + ring * 0.9;
        const px = x + Math.cos(a) * ring * 3.2;
        const pz = z + Math.sin(a) * ring * 3.2;
        if (Math.abs(px) > 172 || Math.abs(pz) > 172 || pz > 160) continue;
        const gy = world.heightAt(px, pz);
        const hit = ph.raycast(probe.set(px, gy + 80, pz), down, 90, groups(G.ALL, G.WORLD | G.VEHICLE));
        if (!hit || hit.point.y > gy + 0.5 || hit.normal.y < 0.8) continue; // covered by a building / steep
        if (ph.overlapSphere(probe.set(px, hit.point.y + 1.0, pz), 0.75, groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE)).length) continue;
        if (water?.nearWater(probe.set(px, hit.point.y, pz), 1.5)) continue;
        if (taken.some((t) => Math.hypot(t.pos.x - px, t.pos.z - pz) < 14)) continue;
        return new THREE.Vector3(px, hit.point.y, pz);
      }
    }
    return null;
  }

  private resources() {
    if (this.res) return this.res;
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc43d, metalness: 0.55, roughness: 0.26, emissive: 0x7a4c00, emissiveIntensity: 0.55 });
    const darkGold = new THREE.MeshStandardMaterial({ color: 0x9c6a12, metalness: 0.6, roughness: 0.35, emissive: 0x3a2200, emissiveIntensity: 0.4 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.55 });
    const geos: Record<string, THREE.BufferGeometry> = {
      base: new THREE.CylinderGeometry(0.2, 0.23, 0.1, 28),
      rim: new THREE.TorusGeometry(0.2, 0.012, 8, 36),
      body: new THREE.SphereGeometry(0.15, 26, 18),
      head: new THREE.SphereGeometry(0.1, 22, 16),
      ear: new THREE.SphereGeometry(0.036, 12, 10),
      mask: new THREE.SphereGeometry(0.06, 16, 10),
      eye: new THREE.SphereGeometry(0.014, 10, 8),
      nose: new THREE.SphereGeometry(0.015, 10, 8),
      tail: new THREE.SphereGeometry(0.05, 14, 10),
      foot: new THREE.SphereGeometry(0.035, 12, 8),
      spring: new THREE.CylinderGeometry(0.02, 0.02, 0.06, 10),
      beam: new THREE.CylinderGeometry(0.28, 0.28, 12, 20, 1, true),
    };
    this.res = { gold, darkGold, black, wood, geos };
    return this.res;
  }

  private spawn(id: string, pos: THREE.Vector3, collected: boolean) {
    const r = this.resources();
    const g = r.geos;
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };
    const root = new THREE.Group();
    root.name = 'GoldenBobblehead';
    root.position.copy(pos);
    root.add(mk(g.base, r.wood, 0, 0.05, 0));
    const rim = mk(g.rim, r.gold, 0, 0.1, 0);
    rim.rotation.x = Math.PI / 2;
    root.add(rim);
    const statue = new THREE.Group();
    statue.position.y = 0.1;
    root.add(statue);
    const body = mk(g.body, r.gold, 0, 0.15, 0);
    body.scale.set(1.05, 0.95, 1.08);
    statue.add(body);
    for (const sx of [-1, 1]) statue.add(mk(g.foot, r.gold, sx * 0.08, 0.02, 0.08));
    // ringed tail
    for (let i = 0; i < 3; i++) {
      const t = mk(g.tail, i % 2 ? r.darkGold : r.gold, 0, 0.12 + i * 0.045, -0.15 - i * 0.05);
      t.scale.setScalar(1 - i * 0.12);
      statue.add(t);
    }
    // spring + bobbling head
    statue.add(mk(g.spring, r.darkGold, 0, 0.28, 0.07));
    const head = new THREE.Group();
    head.position.set(0, 0.31, 0.08);
    statue.add(head);
    const skull = mk(g.head, r.gold, 0, 0.05, 0);
    skull.scale.set(1.12, 0.96, 1);
    head.add(skull);
    for (const sx of [-1, 1]) head.add(mk(g.ear, r.gold, sx * 0.075, 0.13, -0.01));
    const mask = mk(g.mask, r.darkGold, 0, 0.065, 0.055);
    mask.scale.set(1.6, 0.5, 0.75);
    head.add(mask);
    for (const sx of [-1, 1]) head.add(mk(g.eye, r.black, sx * 0.038, 0.068, 0.1));
    head.add(mk(g.nose, r.black, 0, 0.03, 0.105));
    // glow + beam
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc94a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.scale.setScalar(1.5);
    glow.position.y = 0.35;
    root.add(glow);
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffc94a) }, uOpacity: { value: 0.3 }, uTime: { value: 0 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(g.beam, beamMat);
    beam.position.y = 6;
    beam.castShadow = false;
    beam.receiveShadow = false;
    root.add(beam);
    root.scale.setScalar(1.35);
    const b: Bobble = { id, pos: pos.clone(), root, statue, head, glow, beam, beamMat, phase: Math.random() * 10, collected, anim: -1, sparkleT: 0 };
    this.items.push(b);
    if (!collected) this.game.scene.add(root);
  }

  // ------------------------------------------------------------------ runtime
  postPhysics() {
    // Place after a few physics steps: scene queries don't see static colliders until the broad phase has run.
    if (!this.placed && ++this.warmup > 3) this.place();
  }

  update(dt: number, game: Game) {
    if (!this.placed) return;
    const p = game.get<Jimothy>('player');
    const t = game.time;
    const cam = game.camera.position;
    if (!this.sparkles && this.items.some((b) => !b.collected)) this.sparkles = new ParticlePool(game, 160, { additive: true });
    const center = new THREE.Vector3();
    for (const b of this.items) {
      if (b.collected && b.anim < 0) continue;
      if (b.anim >= 0) {
        b.anim += dt;
        const k = b.anim / 0.8;
        b.statue.rotation.y += dt * (8 + k * 20);
        b.statue.position.y = 0.1 + k * 1.2;
        b.statue.scale.setScalar(Math.max(0.001, 1 + Math.sin(k * Math.PI) * 0.6 - k));
        b.glow.material.opacity = 0.9 * (1 - k);
        b.beamMat.uniforms.uOpacity.value = 0.6 * (1 - k);
        if (k >= 1) {
          b.anim = -1;
          b.root.removeFromParent();
          b.beamMat.dispose();
          b.glow.material.dispose();
        }
        continue;
      }
      const dCam = cam.distanceTo(b.pos);
      if (dCam < 140) {
        b.statue.rotation.y += dt * 1.3;
        b.head.rotation.set(Math.sin(t * 5.3 + b.phase) * 0.16, 0, Math.sin(t * 4.4 + b.phase) * 0.24);
        b.head.position.y = 0.31 + Math.sin(t * 7 + b.phase) * 0.01;
        b.glow.material.opacity = 0.42 + Math.sin(t * 3 + b.phase) * 0.12;
      }
      b.beamMat.uniforms.uTime.value = t;
      b.beamMat.uniforms.uOpacity.value = THREE.MathUtils.clamp((dCam - 5) / 12, 0, 1) * 0.32;
      if (this.sparkles && dCam < 60) {
        b.sparkleT -= dt;
        if (b.sparkleT <= 0) {
          b.sparkleT = 0.18 + Math.random() * 0.2;
          const a = Math.random() * Math.PI * 2;
          center.set(b.pos.x + Math.cos(a) * 0.45, b.pos.y + 0.25 + Math.random() * 0.6, b.pos.z + Math.sin(a) * 0.45);
          this.sparkles.spawn(center, new THREE.Vector3(0, 0.35, 0), Math.random() < 0.5 ? 0xfff2a8 : 0xffffff, 0.16 + Math.random() * 0.1, 0.9, { shape: Shape.Star, fadeIn: 0.3 });
        }
      }
      if (p) {
        center.copy(b.pos);
        center.y += 0.45;
        const reach = PICKUP_R + 0.38 * Math.max(0.5, p.sizeMul);
        const pc = p.position.clone();
        pc.y += 0.38 * (p.sizeMul - 1);
        if (pc.distanceTo(center) < reach) this.collect(b);
      }
    }
    this.sparkles?.update(dt);
  }

  private collect(b: Bobble) {
    const game = this.game;
    b.collected = true;
    b.anim = 0;
    this.collected.add(b.id);
    this.save();
    const n = this.collectedCount;
    const pos = b.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
    game.score(1000, `Golden Bobblehead ${n}/${TOTAL}`, pos);
    game.sfx('coin', pos, 1);
    game.sfx('sparkle', pos, 0.8);
    game.get<CameraRig>('camera')?.shake(0.15);
    game.hint(
      n >= TOTAL
        ? 'All 10 golden bobbleheads! The complete set. Proceeds go to raccoon rescue.'
        : `Golden bobblehead ${n}/${TOTAL}! ${QUIPS[(n - 1) % QUIPS.length]}`,
      3,
    );
    if (this.sparkles) {
      for (let i = 0; i < 26; i++) {
        const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
        this.sparkles.spawn(pos, d.multiplyScalar(2 + Math.random() * 3), i % 3 ? 0xffd75a : 0xffffff, 0.22 + Math.random() * 0.12, 0.8, { shape: Shape.Star, drag: 2.5 });
      }
    }
    game.events.emit('collectible', { id: b.id, kind: 'bobblehead', count: n, total: TOTAL, position: b.pos.clone() });
  }

  // ------------------------------------------------------------------ compass (UI helper)
  lateUpdate(_dt: number, game: Game) {
    const want = (this.compassWanted || game.input?.held('objectives')) && this.placed && this.collectedCount < TOTAL;
    if (!want) {
      if (this.compassEl) this.compassEl.style.display = 'none';
      return;
    }
    const p = game.get<Jimothy>('player');
    const near = p ? this.nearest(p.position) : null;
    if (!near || !p) {
      if (this.compassEl) this.compassEl.style.display = 'none';
      return;
    }
    if (!this.compassEl) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;left:50%;top:12%;transform:translateX(-50%);pointer-events:none;z-index:30;' +
        'font:800 15px system-ui,sans-serif;color:#ffe08a;text-shadow:0 2px 0 #000,0 0 6px #000;display:flex;align-items:center;gap:8px;white-space:nowrap';
      el.innerHTML = '<span data-a style="display:inline-block;font-size:22px;transition:transform .1s">➤</span><span data-t></span>';
      (document.getElementById('ui') ?? document.body).appendChild(el);
      this.compassEl = el;
    }
    const cam = game.get<CameraRig>('camera');
    const dx = near.position.x - p.position.x;
    const dz = near.position.z - p.position.z;
    const yaw = cam ? cam.yaw : 0;
    // camera forward = (-sin yaw, -cos yaw); angle of target relative to it, clockwise
    const fwdA = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
    const tgtA = Math.atan2(dx, dz);
    let rel = fwdA - tgtA;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const arrow = this.compassEl.querySelector('[data-a]') as HTMLElement;
    const text = this.compassEl.querySelector('[data-t]') as HTMLElement;
    arrow.style.transform = `rotate(${(-90 + (rel * 180) / Math.PI).toFixed(1)}deg)`;
    text.textContent = `Golden bobblehead · ${Math.round(near.distance)} m · ${this.collectedCount}/${TOTAL}`;
    this.compassEl.style.display = 'flex';
  }
}
