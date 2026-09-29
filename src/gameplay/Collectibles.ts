import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game, System } from '../core/Game';
import { G, groups } from '../core/Physics';
import type { Jimothy } from '../player/Jimothy';
import type { CameraRig } from '../player/CameraRig';
import type { World } from '../world/World';
import type { WaterSystem } from '../world/Water';
import { ParticlePool, Shape } from './mutators/fx';

/**
 * Golden Jimothy bobbleheads: 10 spinning statuettes hidden around the map.
 * Placed at world POIs named `bobblehead:*` (level builders); if fewer than 10 exist, the rest go to open ground near
 * landmarks (validated with physics raycasts). POIs registered later replace still-uncollected fallback spots.
 * Walk into one to collect it: score + 'collectible' {id, kind:'bobblehead', count, total, position}.
 * Progress persists in localStorage. UI helpers: `nearest(pos)`, `collectedCount`, and a small compass shown while
 * the objectives key is held or after the UI emits 'objectivesPanel' {open}.
 *
 * Draw calls: 2 per visible bobblehead (merged statue + merged bobbing head, one vertex-coloured material), plus one
 * shared draw each for all light beams, all glows and the sparkles. Statues beyond 120 m are hidden.
 */

const STORE_KEY = 'jimothy.collectibles.v1';
const TOTAL = 10;
const PICKUP_R = 0.95;
const SCALE = 1.35;
const CULL_DIST = 120;

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
  /** Fallback spot (can be replaced by a POI that registers later). */
  auto: boolean;
  /** Merged pedestal + body (spins). */
  statue: THREE.Mesh;
  /** Merged bobbing head (child of statue). */
  head: THREE.Mesh;
  slot: number;
  phase: number;
  collected: boolean;
  /** Collect animation time (>= 0 while animating). */
  anim: number;
  sparkleT: number;
}

const HEAD_POS = new THREE.Vector3(0, 0.41, 0.08);

const BEAM_VERT = /* glsl */ `
attribute vec3 aBase;
attribute float aAlive;
varying float vY;
varying float vFade;
void main() {
  vY = uv.y;
  float d = distance(cameraPosition, aBase);
  vFade = aAlive * clamp((d - 5.0) / 12.0, 0.0, 1.0) * (1.0 - smoothstep(170.0, 240.0, d));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying float vY;
varying float vFade;
void main() {
  float a = pow(1.0 - vY, 1.8) * uOpacity * vFade * (0.75 + 0.25 * sin(uTime * 3.0 - vY * 14.0));
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const GLOW_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, d));
  a = a * a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function part(geo: THREE.BufferGeometry, color: number, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]) {
  _m.compose(new THREE.Vector3(...pos), _q.setFromEuler(_e.set(...rot)), new THREE.Vector3(...scale));
  geo.applyMatrix4(_m);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) arr.set([_c.r, _c.g, _c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export class Collectibles implements System {
  name = 'collectibles';
  readonly total = TOTAL;
  readonly items: Bobble[] = [];
  private collected = new Set<string>();
  private placed = false;
  private warmup = 0;
  private rescanT = 5;
  private game!: Game;
  private sparkles: ParticlePool | null = null;
  private res: { statueGeo: THREE.BufferGeometry; headGeo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } | null = null;
  private beams: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial; template: Float32Array; vpb: number } | null = null;
  private glows: { points: THREE.Points; geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial } | null = null;
  private freeSlots: number[] = [];
  private compassEl: HTMLDivElement | null = null;
  private compassWanted = false;

  /** Bobbleheads collected so far (persisted; capped at 10). */
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
    for (let i = TOTAL - 1; i >= 0; i--) this.freeSlots.push(i);
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

  /** Dev/test: forget collected state and place everything again. */
  resetAll() {
    this.collected.clear();
    this.save();
    for (const b of [...this.items]) this.removeItem(b);
    this.placed = false;
  }

  // ------------------------------------------------------------------ placement
  private poiSpots(world: World) {
    const game = this.game;
    const down = new THREE.Vector3(0, -1, 0);
    const out: { id: string; pos: THREE.Vector3 }[] = [];
    const pois = [...world.poi.entries()].filter(([k]) => /^bobblehead[:_\-]/i.test(k)).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [id, v] of pois) {
      const pos = v.clone();
      const gy = world.heightAt(pos.x, pos.z);
      if (pos.y < gy) pos.y = gy;
      // POIs are usually a little above the surface: settle onto whatever is underneath
      const hit = game.physics.raycast(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), down, 1.6, groups(G.ALL, G.WORLD));
      if (hit && hit.normal.y > 0.5) pos.y = hit.point.y;
      out.push({ id, pos });
    }
    return out;
  }

  private place() {
    this.placed = true;
    const world = this.game.get<World>('world');
    if (!world) return;
    const spots = this.poiSpots(world).slice(0, TOTAL);
    const taken = spots.map((s) => ({ pos: s.pos }));
    const auto: { id: string; pos: THREE.Vector3 }[] = [];
    for (const f of FALLBACKS) {
      if (spots.length + auto.length >= TOTAL) break;
      const pos = this.findSpot(world, f.x, f.z, taken);
      if (!pos) continue;
      taken.push({ pos });
      auto.push({ id: `bobblehead:auto-${f.name}`, pos });
    }
    for (const s of spots) this.spawn(s.id, s.pos, false);
    for (const s of auto) this.spawn(s.id, s.pos, true);
    if (this.items.length < TOTAL) console.warn(`[collectibles] only ${this.items.length} bobblehead spots found`);
  }

  /** Zones/quests may register bobblehead POIs late: swap them in for uncollected fallback spots. */
  private rescan() {
    const world = this.game.get<World>('world');
    if (!world) return;
    const have = new Set(this.items.map((b) => b.id));
    for (const s of this.poiSpots(world)) {
      if (have.has(s.id)) continue;
      const victim = this.items.find((b) => b.auto && !b.collected && b.anim < 0);
      if (!victim && this.items.length >= TOTAL) break;
      if (victim) this.removeItem(victim);
      this.spawn(s.id, s.pos, false);
      have.add(s.id);
    }
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

  // ------------------------------------------------------------------ shared GPU resources
  private resources() {
    if (this.res) return this.res;
    const GOLD = 0xffc43d;
    const DARK = 0xa8741a;
    const BASE = 0x7a4c12;
    const INK = 0x140f08;
    const s: THREE.BufferGeometry[] = [
      part(new THREE.CylinderGeometry(0.2, 0.23, 0.1, 28), BASE, [0, 0.05, 0]),
      part(new THREE.TorusGeometry(0.2, 0.012, 8, 36), GOLD, [0, 0.1, 0], [1, 1, 1], [Math.PI / 2, 0, 0]),
      part(new THREE.SphereGeometry(0.15, 24, 16), GOLD, [0, 0.25, 0], [1.05, 0.95, 1.08]),
      part(new THREE.SphereGeometry(0.035, 10, 8), GOLD, [0.08, 0.12, 0.08]),
      part(new THREE.SphereGeometry(0.035, 10, 8), GOLD, [-0.08, 0.12, 0.08]),
      part(new THREE.SphereGeometry(0.05, 12, 10), GOLD, [0, 0.22, -0.15]),
      part(new THREE.SphereGeometry(0.05, 12, 10), DARK, [0, 0.265, -0.2], [0.88, 0.88, 0.88]),
      part(new THREE.SphereGeometry(0.05, 12, 10), GOLD, [0, 0.31, -0.25], [0.76, 0.76, 0.76]),
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 10), DARK, [0, 0.38, 0.07]),
    ];
    const h: THREE.BufferGeometry[] = [
      part(new THREE.SphereGeometry(0.1, 22, 16), GOLD, [0, 0.05, 0], [1.12, 0.96, 1]),
      part(new THREE.SphereGeometry(0.036, 12, 10), GOLD, [0.075, 0.13, -0.01]),
      part(new THREE.SphereGeometry(0.036, 12, 10), GOLD, [-0.075, 0.13, -0.01]),
      part(new THREE.SphereGeometry(0.06, 16, 10), DARK, [0, 0.065, 0.055], [1.6, 0.5, 0.75]),
      part(new THREE.SphereGeometry(0.014, 10, 8), INK, [0.038, 0.068, 0.1]),
      part(new THREE.SphereGeometry(0.014, 10, 8), INK, [-0.038, 0.068, 0.1]),
      part(new THREE.SphereGeometry(0.015, 10, 8), INK, [0, 0.03, 0.105]),
    ];
    const statueGeo = mergeGeometries(s)!;
    const headGeo = mergeGeometries(h)!;
    for (const g of [...s, ...h]) g.dispose();
    statueGeo.computeBoundingSphere();
    headGeo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.28, emissive: 0x6b4300, emissiveIntensity: 0.4 });
    mat.name = 'GoldenBobblehead';
    this.res = { statueGeo, headGeo, mat };
    return this.res;
  }

  private beamRes() {
    if (this.beams) return this.beams;
    const tpl = new THREE.CylinderGeometry(0.28, 0.28, 12, 16, 1, true);
    tpl.translate(0, 6, 0);
    const tplPos = tpl.getAttribute('position').array as Float32Array;
    const tplUv = tpl.getAttribute('uv').array as Float32Array;
    const tplIdx = tpl.getIndex()!.array;
    const vpb = tplPos.length / 3;
    const pos = new Float32Array(vpb * 3 * TOTAL);
    const uv = new Float32Array(vpb * 2 * TOTAL);
    const base = new Float32Array(vpb * 3 * TOTAL);
    const alive = new Float32Array(vpb * TOTAL);
    const idx: number[] = [];
    for (let s = 0; s < TOTAL; s++) {
      uv.set(tplUv, s * vpb * 2);
      for (let i = 0; i < tplIdx.length; i++) idx.push(tplIdx[i] + s * vpb);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    geo.setAttribute('aAlive', new THREE.BufferAttribute(alive, 1));
    geo.setIndex(idx);
    tpl.dispose();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffc94a) }, uOpacity: { value: 0.32 }, uTime: { value: 0 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'BobbleheadBeams';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 4;
    this.game.scene.add(mesh);
    this.beams = { mesh, geo, mat, template: tplPos.slice(), vpb };
    return this.beams;
  }

  private glowRes() {
    if (this.glows) return this.glows;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TOTAL * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(TOTAL), 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(TOTAL), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffc94a) }, uScale: { value: 400 } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.name = 'BobbleheadGlows';
    points.frustumCulled = false;
    points.renderOrder = 4;
    this.game.scene.add(points);
    this.glows = { points, geo, mat };
    return this.glows;
  }

  private setSlot(slot: number, pos: THREE.Vector3 | null) {
    const b = this.beamRes();
    const P = b.geo.getAttribute('position') as THREE.BufferAttribute;
    const B = b.geo.getAttribute('aBase') as THREE.BufferAttribute;
    const A = b.geo.getAttribute('aAlive') as THREE.BufferAttribute;
    const o = slot * b.vpb;
    for (let i = 0; i < b.vpb; i++) {
      const t = b.template;
      P.setXYZ(o + i, t[i * 3] + (pos?.x ?? 0), t[i * 3 + 1] + (pos?.y ?? -500), t[i * 3 + 2] + (pos?.z ?? 0));
      B.setXYZ(o + i, pos?.x ?? 0, pos?.y ?? -500, pos?.z ?? 0);
      A.setX(o + i, pos ? 1 : 0);
    }
    P.needsUpdate = B.needsUpdate = A.needsUpdate = true;
    const gl = this.glowRes();
    const GP = gl.geo.getAttribute('position') as THREE.BufferAttribute;
    const GS = gl.geo.getAttribute('aSize') as THREE.BufferAttribute;
    const GA = gl.geo.getAttribute('aAlpha') as THREE.BufferAttribute;
    GP.setXYZ(slot, pos?.x ?? 0, (pos?.y ?? -500) + 0.5, pos?.z ?? 0);
    GS.setX(slot, pos ? 1.9 : 0);
    GA.setX(slot, pos ? 0.5 : 0);
    GP.needsUpdate = GS.needsUpdate = GA.needsUpdate = true;
  }

  private spawn(id: string, pos: THREE.Vector3, auto: boolean) {
    if (this.items.some((b) => b.id === id) || !this.freeSlots.length) return;
    const collected = this.collected.has(id);
    const r = this.resources();
    const statue = new THREE.Mesh(r.statueGeo, r.mat);
    statue.name = 'GoldenBobblehead';
    statue.position.copy(pos);
    statue.scale.setScalar(SCALE);
    statue.castShadow = true;
    statue.receiveShadow = true;
    const head = new THREE.Mesh(r.headGeo, r.mat);
    head.position.copy(HEAD_POS);
    head.castShadow = true;
    statue.add(head);
    const slot = this.freeSlots.pop()!;
    const b: Bobble = { id, pos: pos.clone(), auto, statue, head, slot, phase: Math.random() * 10, collected, anim: -1, sparkleT: 0 };
    this.items.push(b);
    if (!collected) {
      this.game.scene.add(statue);
      this.setSlot(slot, pos);
    } else this.setSlot(slot, null);
  }

  private removeItem(b: Bobble) {
    b.statue.removeFromParent();
    this.setSlot(b.slot, null);
    this.freeSlots.push(b.slot);
    const i = this.items.indexOf(b);
    if (i >= 0) this.items.splice(i, 1);
  }

  // ------------------------------------------------------------------ runtime
  postPhysics() {
    // Place once playing, after a few physics steps (scene queries don't see static colliders before the broad
    // phase has run), then keep re-checking for POIs registered late by zones/quests.
    if (!this.placed) {
      if (this.game.state === 'playing' && ++this.warmup > 3) this.place();
      return;
    }
    this.rescanT -= this.game.dt;
    if (this.rescanT <= 0) {
      this.rescanT = 5;
      this.rescan();
    }
  }

  update(dt: number, game: Game) {
    if (!this.placed) return;
    const p = game.get<Jimothy>('player');
    const t = game.time;
    const cam = game.camera.position;
    if (!this.sparkles && this.items.some((b) => !b.collected)) this.sparkles = new ParticlePool(game, 160, { additive: true });
    if (this.beams) this.beams.mat.uniforms.uTime.value = t;
    const GA = this.glows?.geo.getAttribute('aAlpha') as THREE.BufferAttribute | undefined;
    const center = new THREE.Vector3();
    for (const b of [...this.items]) {
      if (b.collected && b.anim < 0) continue;
      if (b.anim >= 0) {
        b.anim += dt;
        const k = Math.min(1, b.anim / 0.8);
        b.statue.rotation.y += dt * (8 + k * 20);
        b.statue.position.y = b.pos.y + k * 1.4;
        b.statue.scale.setScalar(SCALE * Math.max(0.001, 1 + Math.sin(k * Math.PI) * 0.6 - k));
        if (GA) GA.setX(b.slot, 0.9 * (1 - k));
        if (k >= 1) {
          b.anim = -1;
          b.statue.removeFromParent();
          this.setSlot(b.slot, null);
        }
        continue;
      }
      const dCam = cam.distanceTo(b.pos);
      const visible = dCam < CULL_DIST;
      b.statue.visible = visible;
      if (visible) {
        b.statue.rotation.y += dt * 1.3;
        b.head.rotation.set(Math.sin(t * 5.3 + b.phase) * 0.16, 0, Math.sin(t * 4.4 + b.phase) * 0.24);
        b.head.position.y = HEAD_POS.y + Math.sin(t * 7 + b.phase) * 0.01;
        if (GA) GA.setX(b.slot, 0.42 + Math.sin(t * 3 + b.phase) * 0.12);
      } else if (GA) GA.setX(b.slot, 0);
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
        center.y += 0.5;
        const reach = PICKUP_R + 0.38 * Math.max(0.5, p.sizeMul);
        const pc = p.position.clone();
        pc.y += 0.38 * (p.sizeMul - 1);
        if (pc.distanceTo(center) < reach) this.collect(b);
      }
    }
    if (GA) GA.needsUpdate = true;
    if (this.glows) {
      const h = game.renderer?.renderer.domElement.height ?? window.innerHeight;
      this.glows.mat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(game.camera.fov) / 2));
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
    // camera forward = (-sin yaw, -cos yaw); angle of the target relative to it (positive = to the right)
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
