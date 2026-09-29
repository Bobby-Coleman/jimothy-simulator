import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import type { Entity } from '../core/Entities';
import { G, groups } from '../core/Physics';
import { SpriteLayer, MODE, SIZE, ALPHA, type SpriteParticle } from './SpriteLayer';
import { MeshLayer, type MeshParticle } from './MeshLayer';
import { SPR } from './atlas';

/**
 * Particle effects ("juice"). Pooled, instanced, hard-capped: 6 draw calls max, zero when idle.
 *
 *   import { fx } from '../fx/FX';
 *   fx(game)?.emit('hearts', position, { count: 8 });
 *   fx(game)?.emitOn('sparkles', entity);
 *
 * Listens to: washing, wash, sparkle, splash, land, bonk, objective, cameraFlash, explosion,
 * slopDissolve, hearts, steal, grab.  (See FxKind for everything `emit` can do.)
 */
export type FxKind =
  | 'bubbles' // soap bubbles rising
  | 'foam' // white foam blobs (washing)
  | 'washBurst' // burst of bubbles + sparkles (wash complete)
  | 'sparkles' // twinkly clean sparkles (opts.radius, opts.color)
  | 'glint' // single twinkle (shiny things)
  | 'splash' // water droplets + ring (opts.strength ≈ impact speed)
  | 'droplets' // a few water drips/flicks
  | 'dust' // ground dust puff ring (landing)
  | 'puff' // tiny puff (grab)
  | 'smoke' // grey smoke puffs
  | 'bonk' // cartoon impact burst + stars
  | 'confetti' // party confetti burst
  | 'flash' // camera flash
  | 'explosion' // cartoon fireball + smoke + debris + sparks (opts.radius)
  | 'fireworks' // colourful rockets that burst (opts.count, opts.duration)
  | 'fizzle' // sad damp-firework fizzle
  | 'slopDissolve' // magenta/cyan pixel cubes glitching away upward (opts.scale)
  | 'hearts' // floating hearts (opts.count)
  | 'whoosh' // swipe speed lines (opts.dir)
  | 'zap' // electric short-circuit sparks (opts.duration)
  | 'money' // floating $ signs
  | 'bigBubbles' // giant soap bubble burst
  | 'notes' // music notes (squeak!)
  | 'question' // "?" pop above a head
  | 'exclaim' // "!" pop above a head
  | 'melt' // pastel drips (ice cream) (opts.duration, opts.color)
  | 'shatter' // glass/ceramic shards (opts.color)
  | 'trash' // garbage bits flying out (trash can tip / dumpster dive)
  | 'stink' // green stink lines (opts.duration)
  | 'slip' // dizzy spiral + stars (banana peel)
  | 'cottonPoof' // pink cotton-candy fluff dissolving
  | 'petals'; // flower petals drifting (opts.color)

export interface FxOpts {
  /** Overall size multiplier. */
  scale?: number;
  /** Particle count override (effect-specific). */
  count?: number;
  color?: THREE.ColorRepresentation;
  /** Direction (whoosh). */
  dir?: THREE.Vector3;
  radius?: number;
  strength?: number;
  duration?: number;
}

interface Delayed {
  at: number;
  fn: () => void;
}
interface Emitter {
  until: number;
  rate: number;
  acc: number;
  pos: THREE.Vector3;
  fn: (pos: THREE.Vector3) => void;
  follow?: Entity;
}
interface Rocket {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  color: THREE.Color;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/**
 * Make a linear colour survive the post chain. At medium/high quality the renderer applies
 * HueSaturation(+0.18, which also clamps to 1) and BrightnessContrast(0.06) BEFORE AgX; any channel
 * pushed below ~0 by those renders the whole pixel pure black. So every channel is lifted to a
 * floor that depends on the colour's average. `k` = darkest expected lighting factor (lit meshes).
 */
function postSafe(c: THREE.Color, k = 1): THREE.Color {
  for (let i = 0; i < 2; i++) {
    const avg = (c.r + c.g + c.b) / 3;
    const floor = (0.085 / k + 0.218 * avg) / 1.218;
    c.r = Math.max(c.r, floor);
    c.g = Math.max(c.g, floor);
    c.b = Math.max(c.b, floor);
  }
  return c;
}
const col = (hex: THREE.ColorRepresentation, k = 1) => postSafe(new THREE.Color(hex), k);

const CONFETTI = [0xff4d4d, 0xffd23f, 0x3bd16f, 0x3fa7ff, 0xff66c4, 0xff9a3c, 0xa56bff, 0xffffff].map((h) => col(h, 0.6));
const BRIGHT = [0xff5566, 0xffd84a, 0x5cff8a, 0x55b8ff, 0xff77d6, 0xffa040, 0xb88cff].map((h) => col(h));
const HEARTS = [0xff3d6e, 0xff6f9f, 0xe8174a, 0xff8fbd].map((h) => col(h));
const TWINKLE = [
  [1, 1, 0.92],
  [1, 0.94, 0.62],
  [0.88, 0.97, 1],
];
const BUBBLE_TINTS = [
  [0.85, 0.95, 1.0],
  [1.0, 0.86, 0.96],
  [0.86, 1.0, 0.92],
  [1.0, 1.0, 0.88],
];
/** Glitch colours: red/blue > 1 so they bloom; still readable after the post chain's clamp to 1. */
const SLOP = [
  [2.4, 0.4, 2.2],
  [0.4, 2.0, 2.4],
  [2.0, 2.0, 2.4],
  [1.6, 0.45, 2.4],
];

/** GLSL: lift channels of `c` so the post chain can't blacken the pixel (see postSafe). */
export const POST_SAFE_GLSL = 'c = max(c, vec3((0.085 + 0.218 * (c.r + c.g + c.b) / 3.0) / 1.218));';

/**
 * Cartoon fireball material for the instanced fire blobs: bright core facing the camera, darker/redder
 * faceted rim. Instance colour = core colour (red channel may be > 1 so it blooms).
 */
function fireMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vCol;
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vN = normalize(normalMatrix * n);
        gl_Position = projectionMatrix * modelViewMatrix * p;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vCol;
      void main() {
        float facing = clamp(abs(normalize(vN).z), 0.0, 1.0);
        vec3 rim = vCol * vec3(0.78, 0.42, 0.5);
        vec3 c = mix(rim, vCol, smoothstep(0.25, 0.8, facing));
        ${POST_SAFE_GLSL}
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** 3-tone ramp for cartoon puffs (smoke, dust, foam). */
function toonRamp() {
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Cartoon self-illumination: shaded sides keep `k` of their albedo (confetti never goes muddy). */
function selfLit<T extends THREE.MeshStandardMaterial | THREE.MeshToonMaterial>(m: T, k: number): T {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * ${k.toFixed(3)};`,
      )
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n\t{ vec3 c = gl_FragColor.rgb; ${POST_SAFE_GLSL} gl_FragColor.rgb = c; }`);
  };
  m.customProgramCacheKey = () => `fxSelfLit${k}`;
  return m;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const FLOOR_FILTER = groups(G.ALL, G.WORLD | G.PROP | G.VEHICLE);

function randSphere(out: THREE.Vector3, r = 1) {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const k = Math.sqrt(1 - u * u);
  const rr = r * Math.cbrt(Math.random());
  return out.set(k * Math.cos(th) * rr, u * rr, k * Math.sin(th) * rr);
}
function randDir(out: THREE.Vector3) {
  const u = Math.random() * 2 - 1;
  const th = Math.random() * Math.PI * 2;
  const k = Math.sqrt(1 - u * u);
  return out.set(k * Math.cos(th), u, k * Math.sin(th));
}
/** Random unit vector within `angle` radians of +Y. */
function randCone(out: THREE.Vector3, angle: number) {
  const cosA = Math.cos(angle);
  const z = cosA + Math.random() * (1 - cosA);
  const th = Math.random() * Math.PI * 2;
  const k = Math.sqrt(1 - z * z);
  return out.set(k * Math.cos(th), z, k * Math.sin(th));
}

export class FxSystem implements System {
  name = 'fx';
  game!: Game;
  /** Alpha-blended sprites (bubbles, hearts, stars, droplets, glyphs, twinkles). */
  sprites!: SpriteLayer;
  /** Additive sprites (glows, flashes, sparks). */
  glow!: SpriteLayer;
  /** Lit round puffs (smoke, dust, foam, cotton candy). */
  puffs!: MeshLayer;
  /** Unlit HDR blobs (fireballs). */
  fire!: MeshLayer;
  /** Lit little boxes (confetti, debris, garbage bits). */
  chunks!: MeshLayer;
  /** Unlit HDR cubes (slop glitch pixels). */
  cubes!: MeshLayer;
  /** 0.45 (low) … 1 (high): multiplies particle counts. */
  quality = 1;
  private clock = 0;
  private delayed: Delayed[] = [];
  private emitters: Emitter[] = [];
  private rockets: Rocket[] = [];
  private washAcc = 0;
  private foamAcc = 0;
  private dropAcc = 0;
  private ringAcc = 0;
  private ready = false;

  init(game: Game) {
    this.game = game;
    const root = new THREE.Group();
    root.name = 'fx';
    this.sprites = new SpriteLayer(1800, false);
    this.glow = new SpriteLayer(1400, true);
    const blob = new THREE.IcosahedronGeometry(1, 1);
    const round = new THREE.IcosahedronGeometry(1, 2);
    const cube = new THREE.BoxGeometry(1, 1, 1);
    this.puffs = new MeshLayer(round, selfLit(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonRamp() }), 0.3), 500, 'fx-puffs');
    this.fire = new MeshLayer(blob, fireMaterial(), 160, 'fx-fire');
    this.chunks = new MeshLayer(cube, selfLit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }), 0.5), 700, 'fx-chunks');
    this.cubes = new MeshLayer(cube, new THREE.MeshBasicMaterial({ color: 0xffffff }), 400, 'fx-cubes');
    for (const m of [this.puffs.mesh, this.fire.mesh, this.chunks.mesh, this.cubes.mesh, this.sprites.mesh, this.glow.mesh]) root.add(m);
    game.scene.add(root);
    this.ready = true;
    this.wire(game);
  }

  // ------------------------------------------------------------------ event wiring
  private wire(game: Game) {
    const ev = game.events;
    ev.on('washing', (p) => {
      if (p?.position) this.washing(p.position, p.dt ?? game.dt, p.volume?.surfaceY);
    });
    ev.on('wash', (p) => {
      const pos = p?.entity ? this.entityPos(p.entity) : null;
      const at = pos ?? this.handPos();
      if (!at) return;
      if (p?.entity?.kind === 'npc') at.y += 0.7;
      this.emit('washBurst', at);
    });
    ev.on('sparkle', (p) => {
      const e: Entity | undefined = p?.entity;
      const pos: THREE.Vector3 | null = p?.position ? p.position.clone() : e ? this.entityPos(e) : null;
      if (pos) this.emit('sparkles', pos, { radius: p?.radius ?? (e ? this.entityRadius(e) : 0.3), count: p?.count, color: p?.color });
    });
    ev.on('splash', (p) => {
      if (p?.position) this.emit('splash', p.position, { strength: p.strength ?? 4 });
    });
    ev.on('land', (p) => {
      const h = p?.height ?? 0;
      if (h <= 1.5) return;
      const pl = game.get<any>('player');
      if (!pl) return;
      const pos = pl.position.clone();
      pos.y -= 0.34 * (pl.sizeMul ?? 1);
      this.emit('dust', pos, { scale: clamp(0.5 + h / 6, 0.7, 2.2) });
    });
    ev.on('bonk', (p) => {
      const e: Entity | undefined = p?.entity;
      let pos = e ? this.entityPos(e) : null;
      const hand = this.handPos();
      if (hand) pos = pos ? pos.lerp(hand, 0.5) : hand;
      if (pos) this.emit('bonk', pos, { scale: p?.rolling ? 0.8 : 1 });
    });
    ev.on('objective', () => {
      const pl = game.get<any>('player');
      if (pl) this.emit('confetti', new THREE.Vector3(pl.position.x, pl.position.y + 0.5, pl.position.z));
    });
    ev.on('cameraFlash', (p) => {
      if (p?.position) this.emit('flash', p.position, { scale: p.scale });
    });
    ev.on('explosion', (p) => {
      if (p?.position) this.emit('explosion', p.position, { radius: p.radius ?? 7 });
    });
    ev.on('slopDissolve', (p) => {
      if (p?.position) this.emit('slopDissolve', p.position, { scale: p.scale });
    });
    ev.on('hearts', (p) => {
      if (p?.position) this.emit('hearts', p.position, { count: p.count, scale: p.scale });
    });
    ev.on('steal', () => {
      const pl = game.get<any>('player');
      const hand = this.handPos();
      if (pl && hand) this.emit('whoosh', hand, { dir: pl.forwardVec(new THREE.Vector3()) });
    });
    ev.on('grab', (p) => {
      const pos = p?.entity ? this.entityPos(p.entity) : this.handPos();
      if (pos) this.emit('puff', pos, { scale: 0.8 });
    });
  }

  // ------------------------------------------------------------------ helpers
  /** World-space centre of an entity (null if it has neither body nor object). */
  entityPos(e: Entity, out = new THREE.Vector3()): THREE.Vector3 | null {
    if (e.alive && e.body) {
      try {
        const t = e.body.translation();
        return out.set(t.x, t.y, t.z);
      } catch {
        /* body already gone */
      }
    }
    if (e.object) return e.object.getWorldPosition(out);
    return null;
  }

  entityRadius(e: Entity) {
    return clamp((e.data?.floatRadius as number) ?? 0.3, 0.12, 1.6);
  }

  /** Point just in front of Jimothy's paws. */
  handPos(out = new THREE.Vector3()): THREE.Vector3 | null {
    const pl = this.game.get<any>('player');
    if (!pl) return null;
    const f = pl.forwardVec(new THREE.Vector3());
    return out.copy(pl.position).addScaledVector(f, 0.5);
  }

  /** Ground height below p (raycast against world/props; terrain fallback). */
  floorAt(p: THREE.Vector3, maxDown = 8): number {
    const pl = this.game.get<any>('player');
    const from = new THREE.Vector3(p.x, p.y + 0.3, p.z);
    const hit = this.game.physics.raycast(from, _down, maxDown, FLOOR_FILTER, pl?.body);
    if (hit) return hit.point.y;
    const world = this.game.get<any>('world');
    return world?.heightAt ? world.heightAt(p.x, p.z) : p.y - 1;
  }

  /** Run fn after `delay` seconds of (unpaused) game time. */
  later(delay: number, fn: () => void) {
    this.delayed.push({ at: this.clock + delay, fn });
  }

  /** Spawn fn(pos) `rate` times per second for `duration` s (optionally following an entity). */
  stream(pos: THREE.Vector3, duration: number, rate: number, fn: (pos: THREE.Vector3) => void, follow?: Entity) {
    if (this.emitters.length > 64) return;
    this.emitters.push({ until: this.clock + duration, rate, acc: 0.999, pos: pos.clone(), fn, follow });
  }

  private n(count: number) {
    const k = count * this.quality;
    const i = Math.floor(k);
    return i + (Math.random() < k - i ? 1 : 0);
  }

  private visible(p: THREE.Vector3, range = 140) {
    return p.distanceToSquared(this.game.camera.position) < range * range;
  }

  private sprite(frame: number, p: THREE.Vector3, additive = false): SpriteParticle | null {
    const s = (additive ? this.glow : this.sprites).spawn();
    if (!s) return null;
    s.frame = frame;
    s.x = p.x;
    s.y = p.y;
    s.z = p.z;
    return s;
  }

  private meshP(layer: MeshLayer, p: THREE.Vector3): MeshParticle | null {
    const m = layer.spawn();
    if (!m) return null;
    m.x = p.x;
    m.y = p.y;
    m.z = p.z;
    return m;
  }

  private tint(s: SpriteParticle, c: THREE.Color | number[]) {
    if (Array.isArray(c)) {
      s.r = c[0];
      s.g = c[1];
      s.b = c[2];
    } else {
      s.r = c.r;
      s.g = c.g;
      s.b = c.b;
    }
  }

  /** Emit an effect on an entity (uses its centre and size). */
  emitOn(kind: FxKind, e: Entity, opts: FxOpts = {}) {
    const p = this.entityPos(e);
    if (!p) return;
    this.emit(kind, p, { radius: this.entityRadius(e), ...opts });
  }

  // ------------------------------------------------------------------ main API
  emit(kind: FxKind, position: THREE.Vector3, opts: FxOpts = {}) {
    if (!this.ready || !position) return;
    const big = kind === 'explosion' || kind === 'fireworks';
    if (!this.visible(position, big ? 320 : 140)) return;
    const q = this.game.renderer?.quality;
    this.quality = q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1;
    const pos = position.clone();
    const sc = opts.scale ?? 1;
    try {
      switch (kind) {
        case 'bubbles':
          return this.bubbles(pos, opts.count ?? 8, opts.radius ?? 0.15, sc);
        case 'foam':
          return this.foam(pos, opts.count ?? 6, sc);
        case 'washBurst':
          return this.washBurst(pos, sc);
        case 'sparkles':
          return this.sparkles(pos, opts.count ?? 12, opts.radius ?? 0.3, sc, opts.color);
        case 'glint':
          return this.glint(pos, sc);
        case 'splash':
          return this.splash(pos, opts.strength ?? 5, sc);
        case 'droplets':
          return this.droplets(pos, opts.count ?? 8, 2.5 * sc, opts.color);
        case 'dust':
          return this.dust(pos, sc);
        case 'puff':
          return this.puff(pos, sc, opts.color);
        case 'smoke':
          return this.smoke(pos, sc, opts.count ?? 8);
        case 'bonk':
          return this.bonk(pos, sc);
        case 'confetti':
          return this.confetti(pos, sc, opts.count ?? 110);
        case 'flash':
          return this.flash(pos, sc);
        case 'explosion':
          return this.explosion(pos, opts.radius ?? 7);
        case 'fireworks':
          return this.fireworks(pos, opts.count ?? 8, opts.duration ?? 1.8);
        case 'fizzle':
          return this.fizzle(pos, sc);
        case 'slopDissolve':
          return this.slopDissolve(pos, sc);
        case 'hearts':
          return this.hearts(pos, opts.count ?? 7, sc);
        case 'whoosh':
          return this.whoosh(pos, opts.dir, sc);
        case 'zap':
          return this.zap(pos, opts.duration ?? 0.8, sc);
        case 'money':
          return this.money(pos, sc);
        case 'bigBubbles':
          return this.bigBubbles(pos, sc);
        case 'notes':
          return this.notes(pos, opts.count ?? 3, sc);
        case 'question':
          return this.glyphPop(SPR.question, pos, sc, col(0xffd84a));
        case 'exclaim':
          return this.glyphPop(SPR.exclaim, pos, sc, col(0xff5a36));
        case 'melt':
          return this.melt(pos, opts.duration ?? 1.2, sc, opts.color);
        case 'shatter':
          return this.shatter(pos, sc, opts.color);
        case 'trash':
          return this.trash(pos, sc);
        case 'stink':
          return this.stink(pos, opts.duration ?? 2.5, sc);
        case 'slip':
          return this.slip(pos, sc);
        case 'cottonPoof':
          return this.cottonPoof(pos, sc);
        case 'petals':
          return this.petals(pos, opts.count ?? 10, sc, opts.color);
      }
    } catch (err) {
      console.error('[fx] effect failed', kind, err);
    }
  }

  // ------------------------------------------------------------------ continuous washing
  private washing(hand: THREE.Vector3, dt: number, surfaceY?: number) {
    if (!this.ready || !this.visible(hand, 60)) return;
    const q = this.quality;
    this.washAcc += dt * 26 * q;
    this.foamAcc += dt * 12 * q;
    this.dropAcc += dt * 7 * q;
    this.ringAcc += dt * 3.5;
    const p = hand.clone();
    while (this.washAcc >= 1) {
      this.washAcc -= 1;
      this.bubbles(p, 1, 0.16, 1, 0.9);
    }
    while (this.foamAcc >= 1) {
      this.foamAcc -= 1;
      this.foam(p, 1, 1);
    }
    while (this.dropAcc >= 1) {
      this.dropAcc -= 1;
      this.droplets(p, 1, 2.2);
    }
    if (this.ringAcc >= 1 && surfaceY != null && Math.abs(surfaceY - hand.y) < 0.6) {
      this.ringAcc = 0;
      const s = this.sprite(SPR.ring, _v.set(hand.x + rand(-0.1, 0.1), surfaceY + 0.015, hand.z + rand(-0.1, 0.1)));
      if (s) {
        s.mode = MODE.flat;
        s.s0 = 0.08;
        s.s1 = rand(0.45, 0.7);
        s.sc = SIZE.easeOut;
        s.life = 0.7;
        s.a = 0.55;
        this.tint(s, [0.9, 0.97, 1]);
      }
    }
  }

  // ------------------------------------------------------------------ recipes
  private bubbles(p: THREE.Vector3, count: number, spread: number, sc: number, speed = 1) {
    const n = count === 1 ? 1 : this.n(count);
    for (let i = 0; i < n; i++) {
      const s = this.sprite(SPR.bubble, randSphere(_v, spread).add(p));
      if (!s) return;
      s.vx = rand(-0.3, 0.3) * speed;
      s.vy = rand(0.25, 0.9) * speed;
      s.vz = rand(-0.3, 0.3) * speed;
      s.grav = -0.5;
      s.drag = 1.2;
      s.wob = 0.22;
      s.wobF = rand(4, 8);
      s.s1 = rand(0.04, 0.11) * sc;
      s.sc = SIZE.pop;
      s.life = rand(0.7, 1.6);
      s.ac = ALPHA.late;
      this.tint(s, pick(BUBBLE_TINTS));
      s.a = 0.95;
    }
  }

  private foam(p: THREE.Vector3, count: number, sc: number) {
    const n = count === 1 ? 1 : this.n(count);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.2;
      const m = this.meshP(this.puffs, _v.set(p.x + Math.cos(a) * r, p.y + rand(-0.04, 0.05), p.z + Math.sin(a) * r));
      if (!m) return;
      const s = rand(0.035, 0.075) * sc;
      m.sx = m.sy = m.sz = s;
      m.sy *= 0.8;
      m.s0 = 0.3;
      m.s1 = 1;
      m.sc = 1;
      m.vx = Math.cos(a) * 0.15;
      m.vz = Math.sin(a) * 0.15;
      m.vy = rand(0.02, 0.15);
      m.drag = 2;
      m.life = rand(0.45, 0.9);
      MeshLayer.color(m, col(0xf4f8ff));
    }
  }

  private droplets(p: THREE.Vector3, count: number, speed: number, color?: THREE.ColorRepresentation) {
    const n = count === 1 ? 1 : this.n(count);
    const c = color != null ? col(color) : null;
    for (let i = 0; i < n; i++) {
      const s = this.sprite(SPR.drop, randSphere(_v, 0.08).add(p));
      if (!s) return;
      randCone(_w, 0.9).multiplyScalar(speed * rand(0.5, 1.1));
      s.vx = _w.x;
      s.vy = _w.y;
      s.vz = _w.z;
      s.mode = MODE.stretch;
      s.stretch = 0.03;
      s.grav = 11;
      s.s0 = s.s1 = rand(0.03, 0.06);
      s.life = rand(0.35, 0.75);
      s.ac = ALPHA.late;
      this.tint(s, c ?? [0.62, 0.84, 1]);
      s.a = 0.9;
    }
  }

  private washBurst(p: THREE.Vector3, sc: number) {
    this.bubbles(p, 22 * sc, 0.25, sc * 1.2, 1.8);
    this.sparkles(p, 9, 0.35, sc);
    this.droplets(p, 8, 2.8);
    this.foam(p, 6, sc);
  }

  /** Crisp outlined twinkle (reads in daylight) + faint additive halo (blooms at night). */
  private twinkle(p: THREE.Vector3, size: number, life: number, c: THREE.Color | number[], vx = 0, vy = 0, vz = 0, drag = 0) {
    const s = this.sprite(SPR.twinkle, p);
    if (!s) return;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
    s.drag = drag;
    s.spin = rand(-2.5, 2.5);
    s.rot = rand(-0.3, 0.3);
    s.s1 = size;
    s.sc = SIZE.pop;
    s.life = life;
    s.ac = ALPHA.inOut;
    this.tint(s, c);
    const h = this.sprite(SPR.soft, p, true);
    if (!h) return;
    h.vx = vx;
    h.vy = vy;
    h.vz = vz;
    h.drag = drag;
    h.s1 = size * 1.5;
    h.sc = SIZE.pop;
    h.life = life;
    h.ac = ALPHA.inOut;
    h.r = 0.55;
    h.g = 0.5;
    h.b = 0.35;
  }

  private sparkles(p: THREE.Vector3, count: number, radius: number, sc: number, color?: THREE.ColorRepresentation) {
    const n = this.n(count);
    const c = color != null ? col(color) : null;
    for (let i = 0; i < n; i++) {
      randSphere(_v, radius * 1.1).add(p);
      this.twinkle(_v, rand(0.13, 0.28) * sc, rand(0.5, 1.0), c ?? pick(TWINKLE), rand(-0.2, 0.2), rand(0.15, 0.7), rand(-0.2, 0.2), 2);
    }
  }

  private glint(p: THREE.Vector3, sc: number) {
    this.twinkle(p, rand(0.18, 0.3) * sc, rand(0.4, 0.6), TWINKLE[0]);
  }

  private splash(p: THREE.Vector3, strength: number, sc: number) {
    const k = clamp(Math.abs(strength) / 7, 0.3, 1.7) * sc;
    const nd = this.n(10 + 22 * k);
    for (let i = 0; i < nd; i++) {
      const s = this.sprite(SPR.drop, _v.set(p.x + rand(-0.25, 0.25) * k, p.y + 0.05, p.z + rand(-0.25, 0.25) * k));
      if (!s) break;
      randCone(_w, 0.75).multiplyScalar((2.4 + 3.6 * k) * rand(0.45, 1.1));
      s.vx = _w.x;
      s.vy = _w.y;
      s.vz = _w.z;
      s.mode = MODE.stretch;
      s.stretch = 0.04;
      s.grav = 13;
      s.s0 = s.s1 = rand(0.045, 0.09) * Math.sqrt(k);
      s.life = rand(0.45, 0.95);
      s.ac = ALPHA.late;
      this.tint(s, [0.7, 0.88, 1]);
      s.a = 0.95;
    }
    for (let j = 0; j < 2; j++) {
      const r = this.sprite(SPR.ring, _v.set(p.x, p.y + 0.02, p.z));
      if (!r) break;
      r.mode = MODE.flat;
      r.s0 = 0.2;
      r.s1 = (0.9 + 1.4 * k) * (j ? 0.6 : 1);
      r.sc = SIZE.easeOut;
      r.life = j ? 0.5 : 0.75;
      r.a = 0.8;
      this.tint(r, [0.92, 0.98, 1]);
    }
    const nf = this.n(5 + 6 * k);
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2 + rand(-0.3, 0.3);
      const m = this.meshP(this.puffs, _v.set(p.x + Math.cos(a) * 0.2 * k, p.y, p.z + Math.sin(a) * 0.2 * k));
      if (!m) break;
      m.vx = Math.cos(a) * rand(0.8, 1.6) * k;
      m.vz = Math.sin(a) * rand(0.8, 1.6) * k;
      m.vy = rand(0.3, 0.9);
      m.drag = 4;
      m.sx = m.sy = m.sz = rand(0.06, 0.12) * Math.sqrt(k);
      m.s0 = 0.4;
      m.s1 = 1;
      m.sc = 1;
      m.life = rand(0.4, 0.75);
      MeshLayer.color(m, col(0xeef7ff));
    }
  }

  private dust(p: THREE.Vector3, sc: number) {
    const n = this.n(7 + 5 * sc);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
      const m = this.meshP(this.puffs, _v.set(p.x + Math.cos(a) * 0.22, p.y + 0.05, p.z + Math.sin(a) * 0.22));
      if (!m) return;
      const sp = rand(1.2, 2.6) * Math.sqrt(sc);
      m.vx = Math.cos(a) * sp;
      m.vz = Math.sin(a) * sp;
      m.vy = rand(0.25, 0.8);
      m.drag = 4;
      const s = rand(0.07, 0.15) * sc;
      m.sx = s * rand(1, 1.3);
      m.sy = s * rand(0.7, 1);
      m.sz = s * rand(1, 1.3);
      m.s0 = 0.4;
      m.s1 = 1;
      m.sc = 1;
      m.life = rand(0.45, 0.9);
      MeshLayer.color(m, col(0xb3a58c, 0.6), col(0xd6cdbd, 0.6));
    }
  }

  private puff(p: THREE.Vector3, sc: number, color?: THREE.ColorRepresentation) {
    const n = this.n(7);
    const c = col(color ?? 0xf0efea, 0.6);
    for (let i = 0; i < n; i++) {
      const m = this.meshP(this.puffs, randSphere(_v, 0.1 * sc).add(p));
      if (!m) return;
      randDir(_w).multiplyScalar(rand(0.9, 1.8) * sc);
      m.vx = _w.x;
      m.vy = Math.abs(_w.y) * 0.6 + 0.25;
      m.vz = _w.z;
      m.drag = 5;
      m.sx = m.sy = m.sz = rand(0.07, 0.12) * sc;
      m.s0 = 0.5;
      m.s1 = 1;
      m.sc = 1;
      m.life = rand(0.3, 0.5);
      MeshLayer.color(m, c);
    }
  }

  private smoke(p: THREE.Vector3, sc: number, count: number) {
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const m = this.meshP(this.puffs, randSphere(_v, 0.2 * sc).add(p));
      if (!m) return;
      m.vx = rand(-0.4, 0.4) * sc;
      m.vy = rand(0.6, 1.6) * sc;
      m.vz = rand(-0.4, 0.4) * sc;
      m.grav = -0.4;
      m.drag = 1.5;
      m.sx = m.sy = m.sz = rand(0.12, 0.24) * sc;
      m.s0 = 0.4;
      m.s1 = 1.2;
      m.sc = 1;
      m.life = rand(0.9, 1.6);
      MeshLayer.color(m, col(0x4a4a4a, 0.6), col(0x9a9894, 0.6));
    }
  }

  private bonk(p: THREE.Vector3, sc: number) {
    const b = this.sprite(SPR.burst, p);
    if (b) {
      b.s1 = 0.72 * sc;
      b.sc = SIZE.pop;
      b.life = 0.38;
      b.rot = rand(-0.5, 0.5);
      b.spin = rand(-2, 2);
      b.ac = ALPHA.late;
      this.tint(b, col(0xffa81f));
    }
    const nStars = this.n(5);
    for (let i = 0; i < nStars; i++) {
      const s = this.sprite(SPR.star, p);
      if (!s) break;
      randDir(_w);
      s.vx = _w.x * 3.2;
      s.vy = Math.abs(_w.y) * 2 + 1.2;
      s.vz = _w.z * 3.2;
      s.drag = 4;
      s.grav = 3;
      s.s1 = rand(0.14, 0.22) * sc;
      s.sc = SIZE.pop;
      s.spin = rand(-8, 8);
      s.life = rand(0.45, 0.65);
      s.ac = ALPHA.late;
      this.tint(s, i % 2 ? col(0xffffff) : col(0xffe066));
    }
    const f = this.sprite(SPR.flash, p, true);
    if (f) {
      f.s0 = 0.2;
      f.s1 = 0.8 * sc;
      f.sc = SIZE.easeOut;
      f.life = 0.14;
      f.r = 1.4;
      f.g = 1.35;
      f.b = 1.2;
    }
    const nl = this.n(6);
    for (let i = 0; i < nl; i++) {
      const s = this.sprite(SPR.streak, p);
      if (!s) break;
      randDir(_w).multiplyScalar(rand(4, 7) * sc);
      s.vx = _w.x;
      s.vy = _w.y * 0.6;
      s.vz = _w.z;
      s.mode = MODE.stretch;
      s.stretch = 0.06;
      s.drag = 9;
      s.s0 = s.s1 = 0.05 * sc;
      s.life = 0.22;
      s.a = 0.95;
    }
    this.puff(p, 0.8 * sc);
  }

  private confetti(p: THREE.Vector3, sc: number, count: number) {
    const floor = this.floorAt(p) + 0.012;
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const m = this.meshP(this.chunks, randSphere(_v, 0.25).add(p));
      if (!m) break;
      const a = Math.random() * Math.PI * 2;
      const h = rand(1, 3.8) * sc;
      m.vx = Math.cos(a) * h;
      m.vz = Math.sin(a) * h;
      m.vy = rand(4.5, 9) * sc;
      m.grav = 7;
      m.drag = 1.6;
      m.flutter = rand(0.3, 0.8);
      m.sx = 0.085;
      m.sy = 0.008;
      m.sz = rand(0.11, 0.16);
      m.s0 = m.s1 = sc;
      m.sc = 3;
      m.spin = rand(6, 14);
      m.floor = floor;
      m.life = rand(2.4, 3.8);
      MeshLayer.color(m, pick(CONFETTI));
    }
    this.sparkles(new THREE.Vector3(p.x, p.y + 0.6, p.z), 12, 0.8, sc);
    const f = this.sprite(SPR.flash, p, true);
    if (f) {
      f.s1 = 1.4 * sc;
      f.sc = SIZE.easeOut;
      f.life = 0.25;
      f.r = 1.5;
      f.g = 1.4;
      f.b = 1.2;
    }
  }

  private flash(p: THREE.Vector3, sc: number) {
    const f = this.sprite(SPR.flash, p, true);
    if (f) {
      f.s0 = 0.3 * sc;
      f.s1 = 1.3 * sc;
      f.sc = SIZE.easeOut;
      f.life = 0.18;
      f.rot = Math.random() * Math.PI;
      f.r = f.g = 9;
      f.b = 10;
    }
    const g = this.sprite(SPR.soft, p, true);
    if (g) {
      g.s0 = 0.8 * sc;
      g.s1 = 2.4 * sc;
      g.sc = SIZE.easeOut;
      g.life = 0.3;
      g.r = g.g = 2.2;
      g.b = 2.6;
      g.a = 0.7;
    }
    this.twinkle(p, 0.55 * sc, 0.25, TWINKLE[0]);
  }

  private explosion(p: THREE.Vector3, radius: number) {
    const s = clamp(radius / 7, 0.35, 2.2);
    const floor = this.floorAt(p, 12);
    const nearGround = p.y - floor < 2.5;
    // flash
    const f = this.sprite(SPR.flash, p, true);
    if (f) {
      f.s0 = 1.5 * s;
      f.s1 = 6 * s;
      f.sc = SIZE.easeOut;
      f.life = 0.3;
      f.r = 6;
      f.g = 3.2;
      f.b = 1.2;
    }
    const glowBall = this.sprite(SPR.soft, p, true);
    if (glowBall) {
      glowBall.s0 = 3 * s;
      glowBall.s1 = 7 * s;
      glowBall.sc = SIZE.easeOut;
      glowBall.life = 0.5;
      glowBall.r = 2.2;
      glowBall.g = 0.9;
      glowBall.b = 0.35;
      glowBall.a = 0.7;
    }
    if (nearGround) {
      const r = this.sprite(SPR.ring, _v.set(p.x, floor + 0.06, p.z), true);
      if (r) {
        r.mode = MODE.flat;
        r.s0 = 0.5;
        r.s1 = radius * 2.3;
        r.sc = SIZE.easeOut;
        r.life = 0.5;
        r.r = 2.4;
        r.g = 1.2;
        r.b = 0.5;
      }
    }
    // fireball: only red is HDR so the colour survives the post chain's clamp and still blooms
    const nf = this.n(16);
    for (let i = 0; i < nf; i++) {
      const m = this.meshP(this.fire, randSphere(_v, 0.8 * s).add(p));
      if (!m) break;
      randDir(_w).multiplyScalar(rand(2, 6) * s);
      m.vx = _w.x;
      m.vy = Math.abs(_w.y) * 0.8 + 1.4 * s;
      m.vz = _w.z;
      m.drag = 3.5;
      const k = rand(0.65, 1.3) * s;
      m.sx = k * rand(0.9, 1.15);
      m.sy = k;
      m.sz = k * rand(0.9, 1.15);
      m.s0 = 0.25;
      m.s1 = 1;
      m.sc = 1;
      m.life = rand(0.5, 0.9);
      m.r0 = 1.8;
      m.g0 = rand(0.7, 0.85);
      m.b0 = 0.22;
      m.r1 = 1.35;
      m.g1 = 0.3;
      m.b1 = 0.14;
    }
    const nc = this.n(5);
    for (let i = 0; i < nc; i++) {
      const m = this.meshP(this.fire, randSphere(_v, 0.35 * s).add(p));
      if (!m) break;
      m.vy = 1.5 * s;
      m.drag = 3;
      m.sx = m.sy = m.sz = rand(0.6, 0.95) * s;
      m.s0 = 0.4;
      m.s1 = 1;
      m.sc = 1;
      m.life = rand(0.25, 0.4);
      m.r0 = 2.4;
      m.g0 = 1.5;
      m.b0 = 0.6;
      m.r1 = 1.7;
      m.g1 = 0.7;
      m.b1 = 0.22;
    }
    // smoke rises out of the fireball as it fades
    this.later(0.22, () => {
      const ns = this.n(16);
      for (let i = 0; i < ns; i++) {
        const m = this.meshP(this.puffs, randSphere(_v, 0.9 * s).add(p).add(_w.set(0, rand(0.2, 1.0) * s, 0)));
        if (!m) break;
        m.vx = rand(-1.2, 1.2) * s;
        m.vy = rand(1.5, 3.2) * s;
        m.vz = rand(-1.2, 1.2) * s;
        m.grav = -0.5;
        m.drag = 1.4;
        const k = rand(0.3, 0.62) * s;
        m.sx = k * rand(1, 1.25);
        m.sy = k * rand(0.8, 1);
        m.sz = k * rand(1, 1.25);
        m.s0 = 0.5;
        m.s1 = 1.2;
        m.sc = 1;
        m.life = rand(1.6, 2.6);
        MeshLayer.color(m, new THREE.Color(0.05, 0.047, 0.045), new THREE.Color(0.3, 0.29, 0.28));
      }
    });
    // debris chunks
    const nd = this.n(14);
    for (let i = 0; i < nd; i++) {
      const m = this.meshP(this.chunks, randSphere(_v, 0.4 * s).add(p));
      if (!m) break;
      randCone(_w, 1.2).multiplyScalar(rand(5, 12) * s);
      m.vx = _w.x;
      m.vy = _w.y;
      m.vz = _w.z;
      m.grav = 14;
      m.bounce = 0.35;
      m.floor = floor + 0.04;
      m.spin = rand(8, 20);
      m.sx = rand(0.06, 0.18) * s;
      m.sy = rand(0.04, 0.12) * s;
      m.sz = rand(0.06, 0.16) * s;
      m.sc = 3;
      m.life = rand(1.8, 3.2);
      const k = rand(0.12, 0.3);
      MeshLayer.color(m, new THREE.Color(k * 1.15, k, k * 0.85));
    }
    // sparks
    const nk = this.n(30);
    for (let i = 0; i < nk; i++) {
      const sp = this.sprite(SPR.streak, p, true);
      if (!sp) break;
      randCone(_w, 1.45).multiplyScalar(rand(6, 16) * s);
      sp.vx = _w.x;
      sp.vy = _w.y;
      sp.vz = _w.z;
      sp.mode = MODE.stretch;
      sp.stretch = 0.035;
      sp.grav = 10;
      sp.drag = 1.2;
      sp.s0 = sp.s1 = 0.06 * s;
      sp.life = rand(0.4, 1.0);
      sp.ac = ALPHA.late;
      sp.r = 3;
      sp.g = 1.3;
      sp.b = 0.45;
    }
    // embers
    const ne = this.n(12);
    for (let i = 0; i < ne; i++) {
      const e = this.sprite(SPR.dot, randSphere(_v, 1.2 * s).add(p), true);
      if (!e) break;
      e.vy = rand(0.6, 2);
      e.wob = 0.4;
      e.wobF = rand(2, 4);
      e.s0 = e.s1 = rand(0.03, 0.06);
      e.life = rand(1.2, 2.4);
      e.ac = ALPHA.lateFlicker;
      e.r = 2.5;
      e.g = 0.8;
      e.b = 0.35;
    }
  }

  private fireworks(p: THREE.Vector3, count: number, duration: number) {
    const n = Math.max(1, Math.round(count * (0.6 + 0.4 * this.quality)));
    for (let i = 0; i < n; i++) {
      this.later(i === 0 ? 0 : rand(0, duration), () => {
        if (this.rockets.length > 40) return;
        this.rockets.push({
          x: p.x + rand(-0.2, 0.2),
          y: p.y + 0.3,
          z: p.z + rand(-0.2, 0.2),
          vx: rand(-3.5, 3.5),
          vy: rand(10, 16),
          vz: rand(-3.5, 3.5),
          fuse: rand(0.55, 1.0),
          color: pick(BRIGHT).clone(),
        });
        this.game.sfx('whoosh', p, 0.35, 1.6);
      });
    }
  }

  private burstRocket(r: Rocket) {
    const p = new THREE.Vector3(r.x, r.y, r.z);
    const n = this.n(42);
    const c2 = Math.random() < 0.4 ? pick(BRIGHT) : r.color;
    for (let i = 0; i < n; i++) {
      const s = this.sprite(SPR.streak, p, true);
      if (!s) break;
      randDir(_w).multiplyScalar(rand(4.5, 7.5));
      s.vx = _w.x + r.vx * 0.3;
      s.vy = _w.y + r.vy * 0.3;
      s.vz = _w.z + r.vz * 0.3;
      s.mode = MODE.stretch;
      s.stretch = 0.03;
      s.grav = 3.5;
      s.drag = 1.7;
      s.s0 = s.s1 = 0.07;
      s.life = rand(0.9, 1.5);
      s.ac = ALPHA.lateFlicker;
      const c = i % 3 === 0 ? c2 : r.color;
      // dominant channel HDR (blooms), others kept < 1 so the hue survives the post clamp
      const mx = Math.max(c.r, c.g, c.b);
      s.r = c.r >= mx ? 2.4 : c.r * 0.9;
      s.g = c.g >= mx ? 2.4 : c.g * 0.9;
      s.b = c.b >= mx ? 2.4 : c.b * 0.9;
    }
    const f = this.sprite(SPR.flash, p, true);
    if (f) {
      f.s1 = 2.4;
      f.sc = SIZE.easeOut;
      f.life = 0.22;
      f.r = r.color.r * 2 + 0.6;
      f.g = r.color.g * 2 + 0.6;
      f.b = r.color.b * 2 + 0.6;
    }
    this.game.sfx('firework', p, 0.8, rand(0.85, 1.15));
  }

  private fizzle(p: THREE.Vector3, sc: number) {
    this.smoke(p, 0.7 * sc, 5);
    const n = this.n(5);
    for (let i = 0; i < n; i++) {
      const s = this.sprite(SPR.streak, p, true);
      if (!s) break;
      randCone(_w, 0.5).multiplyScalar(rand(1, 2.2));
      s.vx = _w.x;
      s.vy = _w.y;
      s.vz = _w.z;
      s.mode = MODE.stretch;
      s.stretch = 0.03;
      s.grav = 6;
      s.s0 = s.s1 = 0.035;
      s.life = rand(0.3, 0.6);
      s.r = 1.2;
      s.g = 0.6;
      s.b = 0.25;
    }
  }

  private slopDissolve(p: THREE.Vector3, sc: number) {
    const n = this.n(46 * sc);
    for (let i = 0; i < n; i++) {
      const m = this.meshP(this.cubes, _v.set(p.x + rand(-0.35, 0.35) * sc, p.y + rand(-0.5, 0.6) * sc, p.z + rand(-0.35, 0.35) * sc));
      if (!m) break;
      m.vx = rand(-0.35, 0.35);
      m.vy = rand(0.3, 1.6);
      m.vz = rand(-0.35, 0.35);
      m.grav = -0.4;
      m.quant = 0.06;
      m.flicker = 0.12;
      m.ax = 0;
      m.ay = 1;
      m.az = 0;
      m.ang = 0;
      m.sx = m.sy = m.sz = rand(0.045, 0.13) * sc;
      m.s0 = 1;
      m.s1 = 0.3;
      m.sc = 3;
      m.life = rand(0.8, 1.9);
      const c = pick(SLOP);
      m.r0 = m.r1 = c[0];
      m.g0 = m.g1 = c[1];
      m.b0 = m.b1 = c[2];
    }
    const np = this.n(18 * sc);
    for (let i = 0; i < np; i++) {
      const s = this.sprite(SPR.pixel, _v.set(p.x + rand(-0.4, 0.4) * sc, p.y + rand(-0.4, 0.7) * sc, p.z + rand(-0.4, 0.4) * sc));
      if (!s) break;
      s.vy = rand(0.4, 1.3);
      s.s0 = s.s1 = rand(0.04, 0.09) * sc;
      s.life = rand(0.6, 1.4);
      s.ac = ALPHA.flicker;
      const c = pick(SLOP);
      this.tint(s, [Math.min(1, c[0] / 2.2), Math.min(1, c[1] / 2.2), Math.min(1, c[2] / 2.2)]);
    }
    const g = this.sprite(SPR.soft, p, true);
    if (g) {
      g.s0 = 0.6 * sc;
      g.s1 = 2 * sc;
      g.sc = SIZE.easeOut;
      g.life = 0.4;
      g.r = 1.6;
      g.g = 0.4;
      g.b = 1.5;
    }
  }

  private hearts(p: THREE.Vector3, count: number, sc: number) {
    const n = Math.max(1, this.n(count));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.3 * sc;
      const s = this.sprite(SPR.heart, _v.set(p.x + Math.cos(a) * r, p.y + rand(-0.1, 0.2), p.z + Math.sin(a) * r));
      if (!s) break;
      s.vy = rand(0.5, 1.1);
      s.drag = 0.4;
      s.wob = 0.3;
      s.wobF = rand(2.5, 4);
      s.s1 = rand(0.24, 0.4) * sc;
      s.sc = SIZE.pop;
      s.rot = rand(-0.3, 0.3);
      s.life = rand(1.3, 2.1);
      s.ac = ALPHA.late;
      this.tint(s, pick(HEARTS));
    }
    this.sparkles(p, 4, 0.35 * sc, sc, 0xffd6e8);
  }

  private whoosh(p: THREE.Vector3, dir: THREE.Vector3 | undefined, sc: number) {
    const d = (dir ? dir.clone() : randDir(new THREE.Vector3())).normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x);
    const n = this.n(7);
    for (let i = 0; i < n; i++) {
      const o = rand(-0.25, 0.25);
      const s = this.sprite(SPR.streak, _v.copy(p).addScaledVector(side, o).add(_w.set(0, rand(-0.12, 0.25), 0)));
      if (!s) break;
      const sp = rand(5, 8);
      s.vx = d.x * sp;
      s.vy = d.y * sp;
      s.vz = d.z * sp;
      s.mode = MODE.stretch;
      s.stretch = 0.09;
      s.drag = 8;
      s.s0 = s.s1 = 0.06 * sc;
      s.life = 0.3;
      s.a = 0.95;
    }
    const a = this.sprite(SPR.arc, p);
    if (a) {
      a.s0 = 0.4 * sc;
      a.s1 = 0.9 * sc;
      a.sc = SIZE.easeOut;
      a.rot = rand(-0.5, 0.5);
      a.spin = -6;
      a.life = 0.32;
      a.a = 0.95;
    }
    this.puff(p, 0.7 * sc);
  }

  private zap(p: THREE.Vector3, duration: number, sc: number) {
    const f = this.sprite(SPR.flash, p, true);
    if (f) {
      f.s1 = 0.9 * sc;
      f.sc = SIZE.easeOut;
      f.life = 0.18;
      f.r = 1.3;
      f.g = 1.6;
      f.b = 2.4;
    }
    const yellow = col(0xffd000);
    const cyan = col(0x3fd0ff);
    this.stream(p, duration, 20, (at) => {
      if (Math.random() < 0.7) {
        const b = this.sprite(SPR.zapBolt, randSphere(_v, 0.2 * sc).add(at));
        if (b) {
          b.rot = rand(-0.9, 0.9) + (Math.random() < 0.5 ? Math.PI : 0);
          b.s1 = rand(0.3, 0.46) * sc;
          b.sc = SIZE.pop;
          b.life = rand(0.12, 0.22);
          b.ac = ALPHA.late;
          this.tint(b, Math.random() < 0.6 ? yellow : cyan);
        }
      }
      const s = this.sprite(SPR.streak, at, true);
      if (s) {
        randDir(_w).multiplyScalar(rand(2, 5));
        s.vx = _w.x;
        s.vy = Math.abs(_w.y) * 1.5;
        s.vz = _w.z;
        s.mode = MODE.stretch;
        s.stretch = 0.035;
        s.grav = 9;
        s.s0 = s.s1 = 0.04;
        s.life = rand(0.2, 0.4);
        s.r = 2.6;
        s.g = 2.1;
        s.b = 0.7;
      }
      if (Math.random() < 0.12) this.smoke(at, 0.35 * sc, 1);
    });
  }

  private money(p: THREE.Vector3, sc: number) {
    const n = this.n(11);
    const green = col(0x2fc45a);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = this.sprite(SPR.dollar, randSphere(_v, 0.15).add(p));
      if (!s) break;
      s.vx = Math.cos(a) * rand(0.3, 1);
      s.vz = Math.sin(a) * rand(0.3, 1);
      s.vy = rand(0.9, 1.8);
      s.drag = 1;
      s.wob = 0.15;
      s.wobF = 3;
      s.s1 = rand(0.22, 0.36) * sc;
      s.sc = SIZE.pop;
      s.spin = rand(-1.2, 1.2);
      s.life = rand(1.2, 1.9);
      s.ac = ALPHA.late;
      this.tint(s, green);
    }
    this.sparkles(p, 8, 0.4, sc, 0xfff0a0);
    const nb = this.n(8);
    for (let i = 0; i < nb; i++) {
      const m = this.meshP(this.chunks, randSphere(_v, 0.1).add(p));
      if (!m) break;
      m.vx = rand(-1.2, 1.2);
      m.vy = rand(2, 3.5);
      m.vz = rand(-1.2, 1.2);
      m.grav = 4;
      m.drag = 1.8;
      m.flutter = 0.5;
      m.sx = 0.16;
      m.sy = 0.005;
      m.sz = 0.075;
      m.spin = rand(4, 9);
      m.sc = 3;
      m.life = rand(1.5, 2.4);
      MeshLayer.color(m, col(0x8fcf7a, 0.6));
    }
  }

  private bigBubbles(p: THREE.Vector3, sc: number) {
    const n = this.n(38);
    for (let i = 0; i < n; i++) {
      const s = this.sprite(SPR.bubble, randSphere(_v, 0.25).add(p));
      if (!s) break;
      randDir(_w).multiplyScalar(rand(0.8, 2.6) * sc);
      s.vx = _w.x;
      s.vy = Math.abs(_w.y) + rand(0.4, 1.6);
      s.vz = _w.z;
      s.grav = -0.25;
      s.drag = 1.4;
      s.wob = 0.3;
      s.wobF = rand(2, 5);
      s.s1 = (Math.random() < 0.3 ? rand(0.25, 0.45) : rand(0.08, 0.22)) * sc;
      s.sc = SIZE.pop;
      s.life = rand(1.6, 3.2);
      s.ac = ALPHA.late;
      this.tint(s, pick(BUBBLE_TINTS));
      s.a = 0.95;
    }
    this.bubbles(p, 20, 0.3, sc, 2.2);
    this.foam(p, 12, 1.4 * sc);
    this.sparkles(p, 6, 0.5, sc);
  }

  private notes(p: THREE.Vector3, count: number, sc: number) {
    for (let i = 0; i < count; i++) {
      this.later(i * 0.12, () => {
        const s = this.sprite(SPR.note, _v.set(p.x + rand(-0.15, 0.15), p.y + 0.1, p.z + rand(-0.15, 0.15)));
        if (!s) return;
        s.vx = rand(-0.3, 0.3);
        s.vy = rand(0.7, 1.1);
        s.vz = rand(-0.3, 0.3);
        s.wob = 0.35;
        s.wobF = 5;
        s.s1 = rand(0.26, 0.34) * sc;
        s.sc = SIZE.pop;
        s.rot = rand(-0.4, 0.4);
        s.life = 1.2;
        s.ac = ALPHA.late;
        this.tint(s, pick(BRIGHT));
      });
    }
  }

  private glyphPop(frame: number, p: THREE.Vector3, sc: number, c: THREE.Color) {
    const s = this.sprite(frame, p);
    if (!s) return;
    s.vy = 0.18;
    s.s1 = 0.5 * sc;
    s.sc = SIZE.pop;
    s.life = 1.7;
    s.rot = rand(-0.2, 0.2);
    s.ac = ALPHA.late;
    this.tint(s, c);
  }

  private melt(p: THREE.Vector3, duration: number, sc: number, color?: THREE.ColorRepresentation) {
    const base = color != null ? col(color) : null;
    const pastel = [0xffa8d0, 0xb4f5d8, 0xfff3d6, 0x8a5a3c].map((h) => col(h, 0.6));
    this.stream(p, duration, 20, (at) => {
      const c = base ?? pick(pastel);
      const s = this.sprite(SPR.drop, randSphere(_v, 0.08 * sc).add(at));
      if (s) {
        s.vx = rand(-0.2, 0.2);
        s.vy = rand(-0.6, 0);
        s.vz = rand(-0.2, 0.2);
        s.mode = MODE.stretch;
        s.stretch = 0.04;
        s.grav = 9;
        s.s0 = s.s1 = rand(0.04, 0.06) * sc;
        s.life = rand(0.4, 0.6);
        this.tint(s, c);
      }
      if (Math.random() < 0.35) {
        const m = this.meshP(this.puffs, randSphere(_v, 0.06 * sc).add(at));
        if (m) {
          m.vy = rand(-0.8, -0.2);
          m.grav = 4;
          m.sx = m.sy = m.sz = rand(0.025, 0.045) * sc;
          m.sc = 3;
          m.life = rand(0.4, 0.7);
          MeshLayer.color(m, c);
        }
      }
    });
  }

  private shatter(p: THREE.Vector3, sc: number, color?: THREE.ColorRepresentation) {
    const c = col(color ?? 0xcff0ff, 0.6);
    const floor = this.floorAt(p) + 0.01;
    const n = this.n(16);
    for (let i = 0; i < n; i++) {
      const s = this.sprite(SPR.shard, randSphere(_v, 0.15 * sc).add(p));
      if (!s) break;
      randCone(_w, 1.3).multiplyScalar(rand(1.5, 4.5) * sc);
      s.vx = _w.x;
      s.vy = _w.y;
      s.vz = _w.z;
      s.grav = 12;
      s.floor = floor;
      s.spin = rand(-12, 12);
      s.rot = Math.random() * 6.28;
      s.s0 = s.s1 = rand(0.06, 0.13) * sc;
      s.life = rand(0.5, 1.1);
      s.ac = ALPHA.late;
      this.tint(s, [Math.min(1, c.r * 1.1 + 0.1), Math.min(1, c.g * 1.1 + 0.1), Math.min(1, c.b * 1.1 + 0.1)]);
      s.a = 0.95;
    }
    const nc = this.n(10);
    for (let i = 0; i < nc; i++) {
      const m = this.meshP(this.chunks, randSphere(_v, 0.12 * sc).add(p));
      if (!m) break;
      randCone(_w, 1.2).multiplyScalar(rand(1.5, 4) * sc);
      m.vx = _w.x;
      m.vy = _w.y;
      m.vz = _w.z;
      m.grav = 13;
      m.bounce = 0.3;
      m.floor = floor;
      m.spin = rand(10, 20);
      m.sx = rand(0.03, 0.09) * sc;
      m.sy = 0.01 * sc;
      m.sz = rand(0.03, 0.07) * sc;
      m.sc = 3;
      m.life = rand(1, 1.8);
      MeshLayer.color(m, c);
    }
    this.sparkles(p, 6, 0.25 * sc, sc, 0xe8fbff);
  }

  private trash(p: THREE.Vector3, sc: number) {
    const floor = this.floorAt(p) + 0.02;
    const palette = [0xf2efe6, 0xd9d2c0, 0x8a6a45, 0x6f8f45, 0x9aa0a6, 0xc9a45a, 0xd46a5a].map((h) => col(h, 0.6));
    const n = this.n(18 * sc);
    for (let i = 0; i < n; i++) {
      const m = this.meshP(this.chunks, randSphere(_v, 0.15).add(p));
      if (!m) break;
      randCone(_w, 0.8).multiplyScalar(rand(3, 6.5) * sc);
      m.vx = _w.x;
      m.vy = _w.y;
      m.vz = _w.z;
      m.grav = 12;
      m.bounce = 0.3;
      m.floor = floor;
      m.spin = rand(5, 15);
      m.sx = rand(0.05, 0.13);
      m.sy = rand(0.01, 0.06);
      m.sz = rand(0.05, 0.12);
      m.sc = 3;
      m.life = rand(1.4, 2.4);
      MeshLayer.color(m, pick(palette));
    }
    this.dust(new THREE.Vector3(p.x, floor, p.z), 0.8 * sc);
    // a couple of flies
    const nf = this.n(3);
    for (let i = 0; i < nf; i++) {
      const s = this.sprite(SPR.dot, randSphere(_v, 0.3).add(p));
      if (!s) break;
      s.vy = 0.1;
      s.wob = 1.3;
      s.wobF = rand(9, 14);
      s.s0 = s.s1 = 0.03;
      s.life = rand(2.5, 3.5);
      s.ac = ALPHA.late;
      s.r = s.g = s.b = 0.06;
    }
    this.stink(p, 2, sc);
  }

  private stink(p: THREE.Vector3, duration: number, sc: number) {
    const green = col(0x8fd14f);
    this.stream(p, duration, 3.2, (at) => {
      const s = this.sprite(SPR.squiggle, _v.set(at.x + rand(-0.35, 0.35) * sc, at.y + rand(0, 0.2), at.z + rand(-0.35, 0.35) * sc));
      if (!s) return;
      s.vy = rand(0.4, 0.7);
      s.wob = 0.12;
      s.wobF = 3;
      s.s1 = rand(0.26, 0.38) * sc;
      s.asp = 0.55;
      s.sc = SIZE.pop;
      s.life = rand(1.1, 1.6);
      s.ac = ALPHA.inOut;
      this.tint(s, green);
      s.a = 0.9;
    });
  }

  private slip(p: THREE.Vector3, sc: number) {
    const sp = this.sprite(SPR.spiral, new THREE.Vector3(p.x, p.y + 0.55, p.z));
    if (sp) {
      sp.s1 = 0.36 * sc;
      sp.sc = SIZE.pop;
      sp.spin = 9;
      sp.life = 1;
      sp.ac = ALPHA.late;
      this.tint(sp, [1, 1, 0.75]);
    }
    for (let i = 0; i < 3; i++) {
      const s = this.sprite(SPR.star, _v.set(p.x + Math.cos(i * 2.1) * 0.25, p.y + 0.5, p.z + Math.sin(i * 2.1) * 0.25));
      if (!s) break;
      s.wob = 0.9;
      s.wobF = 9;
      s.vy = 0.1;
      s.s1 = 0.16 * sc;
      s.sc = SIZE.pop;
      s.spin = 6;
      s.life = 1.1;
      s.ac = ALPHA.late;
      this.tint(s, col(0xffe066));
    }
    this.puff(p, 0.9 * sc, 0xd8d0b8);
  }

  private cottonPoof(p: THREE.Vector3, sc: number) {
    const n = this.n(16);
    for (let i = 0; i < n; i++) {
      const m = this.meshP(this.puffs, randSphere(_v, 0.18 * sc).add(p));
      if (!m) break;
      randDir(_w).multiplyScalar(rand(0.5, 1.6) * sc);
      m.vx = _w.x;
      m.vy = _w.y + 0.6;
      m.vz = _w.z;
      m.grav = -0.4;
      m.drag = 3;
      m.sx = m.sy = m.sz = rand(0.055, 0.12) * sc;
      m.s0 = 0.7;
      m.s1 = 1;
      m.sc = 1;
      m.life = rand(0.6, 1.2);
      MeshLayer.color(m, col(0xff9fd2, 0.6), col(0xffe6f3, 0.6));
    }
    const ns = this.n(8);
    for (let i = 0; i < ns; i++) {
      const s = this.sprite(SPR.soft, randSphere(_v, 0.2 * sc).add(p));
      if (!s) break;
      s.vy = rand(0.2, 0.6);
      s.s0 = 0.15 * sc;
      s.s1 = 0.4 * sc;
      s.life = rand(0.5, 0.9);
      this.tint(s, [1, 0.62, 0.84]);
      s.a = 0.6;
    }
    this.sparkles(p, 6, 0.3, sc, 0xffc2e4);
    this.bubbles(p, 10, 0.2, sc, 1.4);
  }

  private petals(p: THREE.Vector3, count: number, sc: number, color?: THREE.ColorRepresentation) {
    const n = this.n(count);
    const cs = color != null ? [col(color)] : [0xffb7d5, 0xfff0f6, 0xffd1e3].map((h) => col(h));
    for (let i = 0; i < n; i++) {
      const s = this.sprite(SPR.petal, randSphere(_v, 0.4 * sc).add(p));
      if (!s) break;
      s.vx = rand(-0.4, 0.4);
      s.vy = rand(-0.2, 0.6);
      s.vz = rand(-0.4, 0.4);
      s.grav = 0.9;
      s.drag = 1.5;
      s.wob = 0.5;
      s.wobF = rand(2, 4);
      s.spin = rand(-3, 3);
      s.s0 = s.s1 = rand(0.05, 0.08) * sc;
      s.asp = 0.6;
      s.life = rand(1.8, 3);
      s.ac = ALPHA.late;
      this.tint(s, pick(cs));
    }
  }

  // ------------------------------------------------------------------ frame update
  postPhysics(dt: number) {
    if (!this.ready) return;
    this.clock += dt;
    // delayed one-shots
    if (this.delayed.length) {
      const due = this.delayed.filter((d) => d.at <= this.clock);
      if (due.length) {
        this.delayed = this.delayed.filter((d) => d.at > this.clock);
        for (const d of due) {
          try {
            d.fn();
          } catch (err) {
            console.error('[fx] delayed effect failed', err);
          }
        }
      }
    }
    // streams
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (this.clock > e.until || (e.follow && !e.follow.alive)) {
        this.emitters.splice(i, 1);
        continue;
      }
      if (e.follow) this.entityPos(e.follow, e.pos);
      e.acc += dt * e.rate * (0.5 + 0.5 * this.quality);
      while (e.acc >= 1) {
        e.acc -= 1;
        try {
          e.fn(e.pos);
        } catch (err) {
          console.error('[fx] stream failed', err);
          e.until = 0;
          break;
        }
      }
    }
    // rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.vy -= 6 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      r.fuse -= dt;
      const t = this.sprite(SPR.dot, _v.set(r.x, r.y, r.z), true);
      if (t) {
        t.vx = rand(-0.3, 0.3);
        t.vy = rand(-0.8, -0.2);
        t.vz = rand(-0.3, 0.3);
        t.s0 = 0.08;
        t.s1 = 0.02;
        t.life = 0.35;
        t.r = 2.6;
        t.g = 1.6;
        t.b = 0.7;
      }
      if (r.fuse <= 0) {
        this.rockets.splice(i, 1);
        this.burstRocket(r);
      }
    }
    this.sprites.update(dt);
    this.glow.update(dt);
    this.puffs.update(dt);
    this.fire.update(dt);
    this.chunks.update(dt);
    this.cubes.update(dt);
  }

  lateUpdate() {
    if (!this.ready) return;
    const fog = this.game.scene.fog as THREE.Fog | null;
    if (fog && (fog as any).isFog) {
      this.sprites.setFog(fog.near, fog.far, fog.color);
      this.glow.setFog(fog.near, fog.far, fog.color);
    }
  }

  /** Live particle counts (debug). */
  stats() {
    return {
      sprites: this.sprites.n,
      glow: this.glow.n,
      puffs: this.puffs.n,
      fire: this.fire.n,
      chunks: this.chunks.n,
      cubes: this.cubes.n,
      emitters: this.emitters.length,
      rockets: this.rockets.length,
    };
  }

  /** Remove every live particle (e.g. on teleport / zone change). */
  clear() {
    for (const l of [this.sprites, this.glow]) l.clear();
    for (const l of [this.puffs, this.fire, this.chunks, this.cubes]) l.clear();
    this.emitters.length = 0;
    this.rockets.length = 0;
    this.delayed.length = 0;
  }
}

/** Convenience accessor: `fx(game)?.emit('hearts', pos)`. */
export function fx(game: Game): FxSystem | undefined {
  return game.get<FxSystem>('fx');
}
