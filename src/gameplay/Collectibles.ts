import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game, System } from '../core/Game';
import { G, groups } from '../core/Physics';
import type { Jimothy } from '../player/Jimothy';
import type { CameraRig } from '../player/CameraRig';
import type { World } from '../world/World';
import type { WaterSystem } from '../world/Water';
import { jimothyBobble, BOBBLEHEAD } from '../world/zones/south/props';
import { ParticlePool, Shape } from './mutators/fx';

/**
 * Golden Jimothy bobbleheads: 10 spinning statuettes hidden around the map.
 * Placed at world POIs named `bobblehead:*` (level builders); if fewer than 10 exist, the rest go to open ground near
 * landmarks (validated with physics raycasts). POIs registered later replace still-uncollected fallback spots.
 * Walk into one to collect it: score + 'collectible' {id, kind:'bobblehead', count, total, position}.
 * Progress persists in localStorage. UI helpers: `nearest(pos)`, `collectedCount`, and a small compass shown while
 * the objectives key is held or after the UI emits 'objectivesPanel' {open}.
 *
 * The statuette is the real Jimothy, baked from his model (`jimothyBobble`): mid-stride with a front paw up (his
 * walk) on an oval base, his head twice size on the "spring" at his neck. Solid gold, toned by his coat so the mask,
 * dark paws and pale brows still read (see goldMaterial). The bake is awaited in init (cached, and the stadium's giant
 * bobblehead already made it while the world was built).
 *
 * Draw calls: 2 per visible bobblehead (merged statue + merged bobbing head, one shared material), plus one shared
 * draw each for all light beams, all glows and the sparkles. Statues beyond 120 m are hidden.
 */

const STORE_KEY = 'jimothy.collectibles.v1';
const TOTAL = 10;
const PICKUP_R = 0.95;
const SCALE = 1.35;
const CULL_DIST = 120;

/** Model metres → statue units (× SCALE in the world): he stands ~0.7 m tall (base and big head included). */
const FIG = 0.58;
/** The giveaway bobblehead's big head (about his neck) and its upward tip (the design is shared with the stadium's). */
const HEAD = BOBBLEHEAD.headScale;
const HEAD_PITCH = BOBBLEHEAD.headPitch;
/** Height of the oval base (statue units). */
const BASE_H = 0.055;

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

interface BobbleRes {
  statueGeo: THREE.BufferGeometry;
  headGeo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  /** The head's pivot (his neck) in statue units. */
  neck: THREE.Vector3;
}

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

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Ready a piece for the merged statue: `tone` = its shade of gold (0 antique … 1 bright; -1 = from his coat texture),
 * `color` = a multiplier (dark eyes, bright glints). Every piece gets the same attributes (uv, aTone, color, index).
 */
function tone(geo: THREE.BufferGeometry, t: number, color = 1) {
  const n = geo.getAttribute('position').count;
  geo.setAttribute('aTone', new THREE.BufferAttribute(new Float32Array(n).fill(t), 1));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(color), 3));
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!geo.index) geo.setIndex(Array.from({ length: n }, (_, i) => i));
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'aTone', 'color'].includes(k)) geo.deleteAttribute(k);
  return geo;
}

/** A primitive piece for the fallback statue (model metres). */
function part(geo: THREE.BufferGeometry, t: number, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]) {
  _m.compose(new THREE.Vector3(...pos), _q.setFromEuler(_e.set(...rot)), new THREE.Vector3(...scale));
  return tone(geo.applyMatrix4(_m), t);
}

/**
 * Solid gold toned by his coat: the coat texture's brightness picks the shade between antique and bright gold, so
 * the black mask, dark paws and white brows still read on a gold statue (flat gold turns his face into a blank). The
 * coat also carves his fur as a bump map. `aTone` ≥ 0 fixes the shade instead (base, eyes, nose); vertex colours
 * darken the eyes and light the glints. The emissive glow follows the shade so the mask stays dark.
 */
function goldMaterial(coat: THREE.Texture | null) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: coat, metalness: 0.5, roughness: 0.32, emissive: 0x6b4300, emissiveIntensity: 0.4 });
  if (coat) {
    m.bumpMap = coat;
    m.bumpScale = 1.5;
  }
  const uniforms = {
    uGoldDark: { value: new THREE.Color(0x3a2206) },
    uGoldBright: { value: new THREE.Color(0xffc43d) },
    uGoldRamp: { value: new THREE.Vector2(0.015, 0.28) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTone;\nvarying float vTone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTone = aTone;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGoldDark;\nuniform vec3 uGoldBright;\nuniform vec2 uGoldRamp;\nvarying float vTone;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `float toneK = vTone;
        #ifdef USE_MAP
          if ( vTone < 0.0 ) toneK = smoothstep( uGoldRamp.x, uGoldRamp.y, dot( texture2D( map, vMapUv ).rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) );
        #endif
        vec3 goldTone = mix( uGoldDark, uGoldBright, clamp( toneK, 0.0, 1.0 ) );
        diffuseColor.rgb *= goldTone;`,
      )
      // grazing reflections of the pale sky (Fresnel → white) outlined his fluffy silhouette in grey: keep them gold
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularF90 = 0.3;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= goldTone / uGoldBright;\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif',
      );
  };
  m.customProgramCacheKey = () => 'goldBobblehead';
  m.name = 'GoldenBobblehead';
  return m;
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
  private res: BobbleRes | null = null;
  private beams: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial; template: Float32Array; vpb: number } | null = null;
  private glows: { points: THREE.Points; geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial } | null = null;
  private freeSlots: number[] = [];
  private compassEl: HTMLDivElement | null = null;
  private compassWanted = false;

  /** Bobbleheads collected so far (persisted; capped at 10). */
  get collectedCount() {
    return Math.min(TOTAL, this.collected.size);
  }

  async init(game: Game) {
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
    // the statuettes are placed once the game is playing: have the (async) bake ready by then
    this.res = await this.buildResources().catch((err) => {
      console.warn('[collectibles] bobblehead bake failed, using the simple statuette', err);
      return this.fallbackResources();
    });
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
    const pois = [...world.poi.entries()].filter(([k]) => /^bobblehead[:_\-]/i.test(k)).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
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

  /**
   * Pick at most `n` POI spots: already-collected ones first (keeps saved progress stable), then round-robin across
   * zones (`bobblehead:<zone><n>`) so the set is spread over the map even when builders add more than 10.
   */
  private choose(spots: { id: string; pos: THREE.Vector3 }[], n: number) {
    const out = spots.filter((s) => this.collected.has(s.id)).slice(0, n);
    const groups = new Map<string, { id: string; pos: THREE.Vector3 }[]>();
    for (const s of spots) {
      if (out.includes(s)) continue;
      const zone = s.id.replace(/^bobblehead[:_\-]/i, '').replace(/[\d_\-]+$/, '') || '?';
      if (!groups.has(zone)) groups.set(zone, []);
      groups.get(zone)!.push(s);
    }
    const lists = [...groups.values()];
    for (let i = 0; out.length < n && lists.some((l) => l.length > i); i++) {
      for (const l of lists) if (l[i] && out.length < n) out.push(l[i]);
    }
    return out;
  }

  private place() {
    this.placed = true;
    const world = this.game.get<World>('world');
    if (!world) return;
    const spots = this.choose(this.poiSpots(world), TOTAL);
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
    const fresh = this.poiSpots(world).filter((s) => !have.has(s.id));
    if (!fresh.length || (this.items.length >= TOTAL && !this.items.some((b) => b.auto && !b.collected))) return;
    for (const s of this.choose(fresh, TOTAL)) {
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
    return (this.res ??= this.fallbackResources());
  }

  /** The statuette from the baked model: one statue geometry (base + body), one head geometry, one material. */
  private async buildResources(): Promise<BobbleRes> {
    const parts = await jimothyBobble(this.game, BOBBLEHEAD);
    if (!parts) return this.fallbackResources();
    const bb = parts.bodyBox;
    // his feet centred on the base (and the spin axis), standing on its top; then everything to statue units
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const toStatue = new THREE.Matrix4().makeScale(FIG, FIG, FIG).multiply(new THREE.Matrix4().makeTranslation(-cx, BASE_H / FIG, -cz));
    const s: THREE.BufferGeometry[] = parts.body.map((p) => tone(p.geometry.clone().applyMatrix4(toStatue), -1));
    const rx = ((bb.max.x - bb.min.x) / 2 + 0.07) * FIG;
    const rz = ((bb.max.z - bb.min.z) / 2 + 0.05) * FIG;
    s.push(tone(new THREE.CylinderGeometry(1, 1.07, BASE_H, 44).scale(rx, 1, rz).translate(0, BASE_H / 2, 0), 0.4));
    s.push(tone(new THREE.TorusGeometry(1, 0.011 / rx, 6, 56).rotateX(Math.PI / 2).scale(rx, rx, rz).translate(0, BASE_H, 0), 1));
    // the head in its own (neck) frame: eyes near-black, glints bright, nose dark
    const h = parts.head.map((p) => {
      const g = p.geometry.clone().scale(FIG, FIG, FIG);
      if (/^Eye[LR]$/.test(p.name)) return tone(g, 0, 0.3);
      if (/Glint/.test(p.name)) return tone(g, 1, 1.6);
      if (p.name === 'Nose') return tone(g, 0, 0.5);
      return tone(g, -1);
    });
    const statueGeo = mergeGeometries(s)!;
    const headGeo = mergeGeometries(h)!;
    for (const g of [...s, ...h]) g.dispose();
    statueGeo.computeBoundingSphere();
    headGeo.computeBoundingSphere();
    return { statueGeo, headGeo, mat: goldMaterial(parts.coat), neck: parts.neck.clone().applyMatrix4(toStatue) };
  }

  /** If his model can't be baked: a simple gold Jimothy (domed back, long legs, tail puff, masked face). */
  private fallbackResources(): BobbleRes {
    const k = FIG;
    const s = [
      part(new THREE.CylinderGeometry(0.26 * k, 0.28 * k, BASE_H, 32), 0.4, [0, BASE_H / 2, 0], [1, 1, 1.5]),
      part(new THREE.SphereGeometry(0.22 * k, 20, 14), 0.8, [0, BASE_H + 0.36 * k, -0.03 * k], [0.95, 0.85, 1.35]),
      part(new THREE.SphereGeometry(0.08 * k, 12, 10), 0.7, [0, BASE_H + 0.42 * k, -0.33 * k]),
      ...[-1, 1].flatMap((x) => [-1, 1].map((z) => part(new THREE.CylinderGeometry(0.045 * k, 0.035 * k, 0.32 * k, 10), 0.15, [x * 0.11 * k, BASE_H + 0.16 * k, z * 0.2 * k]))),
    ];
    const h = [
      part(new THREE.SphereGeometry(0.13 * k, 20, 14), 0.8, [0, -0.03 * k, 0.08 * k]),
      part(new THREE.SphereGeometry(0.1 * k, 16, 8), 0, [0, -0.02 * k, 0.135 * k], [1.2, 0.4, 0.9]),
      part(new THREE.SphereGeometry(0.02 * k, 10, 8), 0, [0, -0.07 * k, 0.22 * k]),
      ...[-1, 1].map((x) => part(new THREE.SphereGeometry(0.04 * k, 10, 8), 0.8, [x * 0.08 * k, 0.1 * k, 0.03 * k], [1, 1, 0.5])),
    ];
    const statueGeo = mergeGeometries(s)!;
    const headGeo = mergeGeometries(h)!;
    for (const g of [...s, ...h]) g.dispose();
    for (const g of [statueGeo, headGeo]) g.computeBoundingSphere();
    return { statueGeo, headGeo, mat: goldMaterial(null), neck: new THREE.Vector3(0, BASE_H + 0.45 * k, 0.2 * k) };
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
    head.name = 'GoldenBobbleheadHead';
    head.position.copy(r.neck);
    head.scale.setScalar(HEAD);
    head.rotation.x = -HEAD_PITCH;
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
        // nods and wobbles on the spring at his neck
        b.head.rotation.set(-HEAD_PITCH + Math.sin(t * 5.3 + b.phase) * 0.13, 0, Math.sin(t * 4.4 + b.phase) * 0.2);
        b.head.position.y = (this.res?.neck.y ?? 0) + Math.sin(t * 7 + b.phase) * 0.006;
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
        'position:absolute;left:50%;bottom:31%;transform:translateX(-50%);pointer-events:none;z-index:30;' + // below the goal pill/toasts
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
