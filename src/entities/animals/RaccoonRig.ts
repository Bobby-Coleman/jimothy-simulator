import * as THREE from 'three';
import type { Assets } from '../../core/Assets';
import { furParts, PART_NAME_RE as PART_RE, type FurOpts } from './AnimalFur';

/**
 * Visual model + procedural animation for the raccoon family.
 *
 *  - 'quad' rigs (mom.glb, kit.glb): normal four-legged raccoons, origin on the ground between the feet.
 *    Nodes: Body > Head > (EarL EarR EyeL EyeR Nose Mouth), LegFL LegFR LegBL LegBR, Tail1 > … > Tail5.
 *  - 'round' rigs (danny.glb): round short-spined raccoons like Jimothy, origin at the ball centre.
 *    Nodes: Body > Head > (EarL EarR EyeL EyeR BrowL BrowR Nose Mouth), ArmL > HandL, ArmR > HandR, LegL, LegR, Tail1..5.
 *
 * Hierarchy: root (ground position + yaw, owned by the Animal) > pivot (at the body centre; tumbles / rolls /
 * lying on the back rotate this) > offset > model (scaled). Owners drive it through a RigPose each frame.
 */

export type RigKind = 'quad' | 'round';

export interface RigSpec {
  name: string;
  path: string;
  kind: RigKind;
  /** Uniform scale applied to the model (the Blender quadrupeds are authored at real-raccoon size). */
  scale: number;
  /** Height of the model origin above the ground (model units). */
  originY: number;
  /** Body centre relative to the model origin (model units): the pivot for tumbles and rolls. */
  centerY: number;
  /** Model-space shoulder / hind-hip joints (quad): pivots for sitting and standing up. */
  shoulder?: [number, number, number];
  hip?: [number, number, number];
  /** Model-space height of the animal (for proportional bobbing). */
  size: number;
  /** Stride length in world metres (gait frequency = speed / stride). */
  stride: number;
  fur?: FurOpts & { parts: string[] };
}

export const RIGS = {
  mom: {
    name: 'Mom',
    path: 'assets/models/mom.glb',
    kind: 'quad',
    scale: 1.9,
    originY: 0,
    centerY: 0.26,
    shoulder: [0, 0.22, 0.12],
    hip: [0, 0.25, -0.2],
    size: 0.42,
    stride: 0.95,
    fur: { parts: ['Body', 'Head'], shells: 6, length: 0.011, density: 620 },
  },
  kit: {
    name: 'Kit',
    path: 'assets/models/kit.glb',
    kind: 'quad',
    scale: 1.8,
    originY: 0,
    centerY: 0.085,
    shoulder: [0, 0.06, 0.02],
    hip: [0, 0.06, -0.07],
    size: 0.185,
    stride: 0.42,
    fur: { parts: ['Body', 'Head'], shells: 4, length: 0.0065, density: 1500 },
  },
  danny: {
    name: 'Danny',
    path: 'assets/models/danny.glb',
    kind: 'round',
    scale: 1,
    originY: 0.47,
    centerY: 0,
    size: 0.9,
    stride: 0.7,
    fur: { parts: ['Body', 'Head'], shells: 8, length: 0.03, density: 260 },
  },
} satisfies Record<string, RigSpec>;

/** Animation targets. Everything is smoothed inside the rig, so owners can snap values. */
export interface RigPose {
  /** Walk / trot amount 0..1 (legs swing with the stride phase). */
  gait: number;
  /** Bunny-hop gait amount 0..1 (kits). */
  hop: number;
  /** Quad: rump down, front paws planted. */
  sit: number;
  /** Quad: up on the hind legs (begging, grooming someone). */
  stand: number;
  /** Lying curled up (asleep) / round: lying on the back. */
  lie: number;
  /** Tucked into a ball. */
  tuck: number;
  /** Paws scrubbing at face height. */
  groom: number;
  /** Nibbling something held in the paws. */
  eat: number;
  /** Shake-off wiggle (after a tumble / washing). */
  shake: number;
  /** Tumbling, limbs everywhere. */
  flail: number;
  /** Round: wave one arm. */
  wave: number;
  lookYaw: number;
  /** + looks down. */
  lookPitch: number;
  tilt: number;
  /** 1 = open, 0 = closed. */
  eyes: number;
  /** 0..1 happy squint. */
  happy: number;
  earsBack: number;
  tailWag: number;
  /** -1..1, + lifts the tail. */
  tailUp: number;
  /** Quad legs pitch extra for climbing / swimming paddles (0..1). */
  paddle: number;
}

export function defaultPose(): RigPose {
  return {
    gait: 0, hop: 0, sit: 0, stand: 0, lie: 0, tuck: 0, groom: 0, eat: 0, shake: 0, flail: 0, wave: 0,
    lookYaw: 0, lookPitch: 0, tilt: 0, eyes: 1, happy: 0, earsBack: 0, tailWag: 0.25, tailUp: 0, paddle: 0,
  };
}

/** Reset the transient channels of a pose object (owners reuse one pose per animal). */
export function clearPose(p: RigPose) {
  Object.assign(p, defaultPose());
  return p;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

export class RaccoonRig {
  readonly root = new THREE.Group();
  readonly pivot = new THREE.Group();
  readonly offset = new THREE.Group();
  model: THREE.Object3D = new THREE.Group();
  readonly spec: RigSpec;
  parts: Record<string, THREE.Object3D | undefined> = {};
  usingGlb = false;
  /** Stride phase (radians); advanced by animate() from the owner's speed. */
  phase = 0;
  private rest = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3; s: THREE.Vector3 }>();
  private cur: Record<string, number> = {};
  private blinkT = 1 + Math.random() * 3;
  private earT = 0;
  private earSide = 1;
  private eyeMats: THREE.MeshStandardMaterial[] = [];
  private seed = Math.random() * 100;
  /** Extra per-frame night glow for eyes (0..1), set by the owner. */
  night = 0;

  constructor(spec: RigSpec) {
    this.spec = spec;
    this.root.name = spec.name + 'Root';
    this.root.rotation.order = 'YXZ';
    this.root.add(this.pivot);
    this.pivot.add(this.offset);
    this.pivot.position.y = (spec.originY + spec.centerY) * spec.scale;
    this.offset.position.y = -spec.centerY * spec.scale;
    this.setModel(spec.kind === 'quad' ? buildQuadPlaceholder(spec) : buildRoundPlaceholder(spec), false);
  }

  /** Swap in the Blender model when it loads (keeps the placeholder on failure). */
  async load(assets: Assets, furOn = true): Promise<boolean> {
    const m = await assets.tryModel(this.spec.path);
    if (!m) return false;
    this.setModel(m, furOn);
    this.usingGlb = true;
    return true;
  }

  /** Height of the pivot (body centre) above the ground in world metres. */
  get centerHeight() {
    return this.pivot.position.y;
  }

  /** World-space top of the head (approx), for emote bubbles. */
  get height() {
    return this.spec.size * this.spec.scale + (this.spec.kind === 'round' ? 0.05 : 0.02);
  }

  private setModel(model: THREE.Object3D, furOn: boolean) {
    this.offset.clear();
    this.model = model;
    model.scale.setScalar(this.spec.scale);
    this.offset.add(model);
    this.parts = {};
    this.rest.clear();
    this.eyeMats = [];
    model.traverse((o) => {
      if (o.name && !this.parts[o.name]) this.parts[o.name] = o;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && !Array.isArray(mat) && /^Eye$/i.test(mat.name)) {
          const c = mat.clone();
          mesh.material = c;
          this.eyeMats.push(c);
        }
      }
    });
    for (const o of Object.values(this.parts)) {
      if (!o) continue;
      this.rest.set(o, { q: o.quaternion.clone(), p: o.position.clone(), s: o.scale.clone() });
    }
    // The model itself is also a "part" (the placeholder root may share a name) — never animate its transform.
    this.rest.delete(model);
    if (furOn && this.spec.fur) furParts(model, this.spec.fur.parts, this.spec.fur);
    // Level-of-detail bookkeeping: fur shells, and which meshes are worth a shadow.
    this.shells = [];
    this.shadowMeshes = [];
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.userData.furShell) {
        this.shells.push(mesh);
        return;
      }
      // the rig part this mesh belongs to (the mesh itself, or its parent for multi-material nodes)
      const part = PART_RE.test(mesh.name) ? mesh.name : (mesh.parent?.name ?? '');
      const tier = /^(Body|Head)$/.test(part) ? 2 : /^(Leg|Arm|Tail[123]$)/.test(part) ? 1 : 0;
      this.shadowMeshes.push({ mesh, tier });
    });
    this.detail = -1;
    this.setDetail(0);
  }

  private shells: THREE.Object3D[] = [];
  private shadowMeshes: { mesh: THREE.Mesh; tier: number }[] = [];
  private detail = -1;

  /**
   * 0 = close-up (fur, shadows from body/head/limbs), 1 = mid (no fur, body/head shadows), 2 = far (no fur,
   * no shadows). Eyes, noses, ears and tail tips never cast shadows (invisible at this scale anyway).
   */
  setDetail(level: 0 | 1 | 2) {
    if (level === this.detail) return;
    this.detail = level;
    for (const s of this.shells) s.visible = level === 0;
    for (const m of this.shadowMeshes) m.mesh.castShadow = level === 0 ? m.tier >= 1 : level === 1 ? m.tier >= 2 : false;
  }

  get detailLevel() {
    return this.detail;
  }

  private pose(name: string, x: number, y = 0, z = 0) {
    const p = this.parts[name];
    if (!p) return;
    const r = this.rest.get(p);
    if (!r) return;
    _e.set(x, y, z, 'XYZ');
    _q.setFromEuler(_e);
    p.quaternion.copy(r.q).multiply(_q);
  }

  private sm(key: string, target: number, k: number, dt: number) {
    const v = damp(this.cur[key] ?? target, target, k, dt);
    this.cur[key] = v;
    return v;
  }

  /** Smoothed channel value (e.g. for owners that want to know how "lying" the rig currently is). */
  channel(key: string) {
    return this.cur[key] ?? 0;
  }

  /**
   * @param speed ground speed in m/s (drives the stride phase)
   * @param t game time (s)
   */
  animate(dt: number, p: RigPose, speed: number, t: number) {
    const moving = p.gait > 0.05 || p.hop > 0.05 || p.paddle > 0.05;
    if (moving) this.phase += (dt * Math.max(speed, 0.6) * Math.PI * 2) / this.spec.stride;
    if (this.spec.kind === 'quad') this.animateQuad(dt, p, t);
    else this.animateRound(dt, p, t);
    this.animateFace(dt, p, t);
  }

  // ---------------------------------------------------------------------------------------------- quadrupeds
  private animateQuad(dt: number, p: RigPose, t: number) {
    const S = this.spec;
    const size = S.size;
    const gait = this.sm('gait', p.gait, 10, dt);
    const hop = this.sm('hop', p.hop, 10, dt);
    const sit = this.sm('sit', p.sit, 6, dt);
    const stand = this.sm('stand', p.stand, 6, dt);
    const lie = this.sm('lie', p.lie, 3.5, dt);
    const tuck = this.sm('tuck', p.tuck, 12, dt);
    const groom = this.sm('groom', p.groom, 8, dt);
    const eat = this.sm('eat', p.eat, 8, dt);
    const shake = this.sm('shake', p.shake, 14, dt);
    const flail = this.sm('flail', p.flail, 12, dt);
    const paddle = this.sm('paddle', p.paddle, 8, dt);
    const tailWag = this.sm('tailWag', p.tailWag, 6, dt);
    const tailUp = this.sm('tailUp', p.tailUp, 5, dt);
    const ph = this.phase;

    // ---- legs (rotation about X: negative swings the paw forward)
    let fl = 0, fr = 0, bl = 0, br = 0;
    const tr = Math.sin(ph) * 0.62 * gait * (1 - hop);
    fl -= tr;
    br -= tr;
    fr += tr;
    bl += tr;
    const hp = Math.sin(ph) * 0.75 * hop;
    fl -= hp;
    fr -= hp * 0.9;
    bl += hp;
    br += hp * 0.9;
    const pd = Math.sin(ph * 1.3) * 0.8 * paddle;
    fl -= 0.5 * paddle + pd;
    fr -= 0.5 * paddle - pd;
    bl += 0.4 * paddle - pd;
    br += 0.4 * paddle + pd;

    // ---- posture: rotate the body about the shoulders (sit) or hips (stand / eat / groom)
    const up = Math.min(1, stand + eat * 0.55 + groom * 0.35);
    const pitch = -(0.46 * sit * (1 - up) + 1.2 * up);
    const shoulder = _v.fromArray(S.shoulder ?? [0, 0, 0]);
    const hip = _v2.fromArray(S.hip ?? [0, 0, 0]);
    const w = up > 0.001 || sit > 0.001 ? up / (up + sit * (1 - up) + 1e-6) : 1;
    const pivot = shoulder.lerp(hip, w);
    let lower = lie * size * 0.24 + tuck * size * 0.12;
    const bob = Math.abs(Math.sin(ph)) * 0.035 * size * gait + Math.max(0, Math.sin(ph)) * 0.09 * size * hop;
    // legs follow the body pitch back to vertical, then fold
    const comp = -pitch;
    fl += comp;
    fr += comp;
    bl += comp - 1.12 * sit * (1 - up) - 0.15 * up;
    br += comp - 1.12 * sit * (1 - up) - 0.15 * up;
    // front paws up: reaching (stand), to the mouth (eat), scrubbing (groom)
    const scrub = Math.sin(t * 15) * 0.35 * groom;
    const reach = -1.35 * stand * (1 - groom) - 1.75 * eat - 1.5 * groom;
    fl += reach + scrub + Math.sin(t * 17) * 0.07 * eat;
    fr += reach - scrub - Math.sin(t * 17) * 0.07 * eat;
    // lying down: legs tucked under, body on the ground
    fl -= 1.25 * lie;
    fr -= 1.15 * lie;
    bl += 1.3 * lie;
    br += 1.2 * lie;
    // tumbling
    fl += Math.sin(t * 17 + 0.3) * 1.1 * flail;
    fr += Math.sin(t * 15 + 1.9) * 1.1 * flail;
    bl += Math.sin(t * 16 + 2.6) * 1.1 * flail;
    br += Math.sin(t * 14 + 0.9) * 1.1 * flail;
    fl -= 1.2 * tuck;
    fr -= 1.2 * tuck;
    bl += 1.2 * tuck;
    br += 1.2 * tuck;

    const spread = 0.25 * flail;
    this.pose('LegFL', fl, 0, -spread);
    this.pose('LegFR', fr, 0, spread);
    this.pose('LegBL', bl, 0, -spread);
    this.pose('LegBR', br, 0, spread);
    const legScale = 1 - 0.45 * tuck;
    for (const n of ['LegFL', 'LegFR', 'LegBL', 'LegBR']) {
      const part = this.parts[n];
      const r = part && this.rest.get(part);
      if (part && r) part.scale.copy(r.s).multiplyScalar(legScale);
    }

    // ---- body transform (Body is the rig root: its rest transform is identity at the model origin)
    const body = this.parts.Body;
    if (body) {
      const roll = Math.sin(t * 31) * 0.28 * shake + Math.sin(ph) * 0.035 * gait;
      _e.set(pitch + 0.25 * tuck, Math.sin(t * 31 + 1) * 0.12 * shake, roll, 'XYZ');
      _q.setFromEuler(_e);
      // rotate about `pivot`: pos = pivot - R * pivot
      const rp = _v2.copy(pivot).applyQuaternion(_q);
      body.quaternion.copy(_q);
      body.position.set(pivot.x - rp.x, pivot.y - rp.y - lower + bob, pivot.z - rp.z);
      const breathe = 1 + Math.sin(t * (lie > 0.5 ? 1.6 : 2.6) + this.seed) * (0.014 + 0.02 * lie);
      body.scale.set(breathe, 1 / breathe, 1);
    }

    // ---- head: look + counteract the body pitch a little so the face stays level
    const look = this.sm('lookYaw', THREE.MathUtils.clamp(p.lookYaw, -1.2, 1.2), 7, dt);
    const lookP = this.sm('lookPitch', THREE.MathUtils.clamp(p.lookPitch, -0.9, 0.9), 7, dt);
    const tilt = this.sm('tilt', p.tilt, 9, dt);
    const nib = Math.sin(t * 17) * 0.09 * eat;
    const headPitch = lookP - pitch * 0.55 + 0.35 * eat + 0.3 * groom * (1 - stand) + nib + 0.42 * lie + 0.55 * tuck;
    const headYaw = look + 0.75 * lie;
    const headRoll = tilt - Math.sin(t * 31) * 0.25 * shake;
    this.pose('Head', headPitch, headYaw, headRoll);

    // ---- ears
    const earsBack = this.sm('earsBack', Math.max(p.earsBack, tuck, lie * 0.4), 10, dt);
    this.animateEars(dt, earsBack, shake, t);

    // ---- tail: lift + travelling sway; curls around the body when lying down
    for (let i = 1; i <= 5; i++) {
      const sway = Math.sin(t * (2.2 + tailWag * 5) - i * 0.7 + this.seed) * (0.08 + tailWag * 0.35) * (0.6 + i * 0.14);
      const whip = Math.sin(t * 30 - i) * 0.35 * shake;
      // lying down: the tail droops onto the floor, then wraps around toward the nose
      const lift = (i === 1 ? tailUp * 0.5 + 0.12 * gait - lie * 0.5 : tailUp * 0.12 + lie * 0.06) + 0.35 * tuck;
      const curl = 0.42 * lie + 0.45 * tuck;
      this.pose(`Tail${i}`, lift + (i > 1 ? 0.05 * flail * Math.sin(t * 13 + i) : 0), sway + whip - curl, 0);
    }
  }

  // ---------------------------------------------------------------------------------------------- round boys
  private animateRound(dt: number, p: RigPose, t: number) {
    const gait = this.sm('gait', Math.max(p.gait, p.hop), 12, dt);
    const tuck = this.sm('tuck', p.tuck, 12, dt);
    const lie = this.sm('lie', p.lie, 4, dt);
    const groom = this.sm('groom', Math.max(p.groom, p.eat), 8, dt);
    const flail = this.sm('flail', p.flail, 12, dt);
    const shake = this.sm('shake', p.shake, 14, dt);
    const wave = this.sm('wave', p.wave, 8, dt);
    const tailWag = this.sm('tailWag', p.tailWag, 6, dt);
    const tailUp = this.sm('tailUp', p.tailUp, 5, dt);
    const ph = this.phase;
    const amp = gait;

    let armL = Math.sin(ph) * 0.95 * amp;
    let armR = -armL;
    let legL = -Math.sin(ph) * 0.95 * amp;
    let legR = -legL;
    let spread = 0;
    // face wash
    if (groom > 0.01) {
      const w = Math.sin(t * 16) * 0.35;
      armL = armL * (1 - groom) + (-2.2 + w) * groom;
      armR = armR * (1 - groom) + (-2.2 - w) * groom;
      spread -= 0.45 * groom;
    }
    // wave hello with the right arm
    armR = armR * (1 - wave) + (-2.7 + Math.sin(t * 11) * 0.35) * wave;
    // lying on the back: paws up, lazily paddling the air
    const air = Math.sin(t * 2.2 + this.seed) * 0.35;
    armL += (-0.4 + air) * lie;
    armR += (-0.4 - air) * lie;
    legL += (0.3 - air) * lie;
    legR += (0.3 + air) * lie;
    // tumbling
    armL += (Math.sin(t * 17) * 1.4 - 0.5) * flail;
    armR += (Math.sin(t * 15 + 1.3) * 1.4 - 0.5) * flail;
    legL += Math.sin(t * 14 + 0.7) * 1.2 * flail;
    legR += Math.sin(t * 16 + 2.1) * 1.2 * flail;
    spread += 0.6 * flail;

    this.pose('ArmL', armL, 0, -spread);
    this.pose('ArmR', armR, 0, spread + 0.5 * wave);
    this.pose('LegL', legL, 0, 0);
    this.pose('LegR', legR, 0, 0);
    const limbScale = 1 - 0.75 * tuck;
    for (const n of ['ArmL', 'ArmR', 'LegL', 'LegR']) {
      const part = this.parts[n];
      const r = part && this.rest.get(part);
      if (part && r) part.scale.copy(r.s).multiplyScalar(limbScale);
    }
    const hand = groom > 0.1 ? Math.sin(t * 16) * 0.5 * groom : 0;
    this.pose('HandL', hand, 0, 0);
    this.pose('HandR', hand, 0, 0);

    const body = this.parts.Body;
    if (body) {
      const r = this.rest.get(body);
      const bob = Math.abs(Math.sin(ph)) * 0.04 * amp;
      if (r) body.position.set(r.p.x, r.p.y + bob, r.p.z);
      const breathe = 1 + Math.sin(t * (lie > 0.5 ? 1.7 : 2.6) + this.seed) * 0.013;
      body.scale.set(breathe, 1 / breathe, breathe);
      const roll = Math.sin(ph) * 0.05 * amp + Math.sin(t * 31) * 0.22 * shake;
      this.pose('Body', 0.06 * amp, Math.sin(t * 31 + 1) * 0.1 * shake, roll);
    }

    const look = this.sm('lookYaw', THREE.MathUtils.clamp(p.lookYaw, -0.9, 0.9), 6, dt);
    const lookP = this.sm('lookPitch', THREE.MathUtils.clamp(p.lookPitch, -0.6, 0.6), 6, dt);
    const tilt = this.sm('tilt', p.tilt, 9, dt);
    this.pose('Head', lookP + 0.3 * groom, look, tilt - Math.sin(t * 31) * 0.2 * shake);

    const earsBack = this.sm('earsBack', Math.max(p.earsBack, tuck), 10, dt);
    this.animateEars(dt, earsBack, shake, t);

    // Brows bounce when chirping / surprised (Danny's bushy "old man" eyebrows)
    for (const n of ['BrowL', 'BrowR']) {
      const b = this.parts[n];
      const r = b && this.rest.get(b);
      if (b && r) b.position.set(r.p.x, r.p.y + Math.max(0, this.cur.chirp ?? 0) * 0.025, r.p.z);
    }

    const tailCurl = tuck * 0.85;
    const tailLift = 0.12 + tailUp * 0.3 - lie * 0.5 - 0.3 * amp;
    for (let i = 1; i <= 5; i++) {
      const sway = Math.sin(t * (2.4 + tailWag * 4) - i * 0.65 + this.seed) * (0.2 + tailWag * 0.3) * (0.6 + i * 0.12) * (1 - tuck * 0.8);
      const lift = i === 1 ? tailLift : tailLift * 0.35;
      this.pose(`Tail${i}`, lift + tailCurl * 0.55, sway + Math.sin(t * 30 - i) * 0.3 * shake, 0);
    }
  }

  // ---------------------------------------------------------------------------------------------- shared face
  private animateEars(dt: number, back: number, shake: number, t: number) {
    this.earT -= dt;
    if (this.earT < -Math.random() * 7 - 1.5) {
      this.earT = 0.25;
      this.earSide = Math.random() < 0.5 ? 1 : -1;
    }
    const tw = this.earT > 0 ? Math.sin(this.earT * 40) * 0.35 : 0;
    const flap = Math.sin(t * 34) * 0.5 * shake;
    this.pose('EarL', -back * 1.0 + (this.earSide > 0 ? tw : 0) + flap, 0, 0);
    this.pose('EarR', -back * 1.0 + (this.earSide < 0 ? tw : 0) - flap, 0, 0);
  }

  private animateFace(dt: number, p: RigPose, t: number) {
    // Blink every few seconds; squint when happy; shut when asleep
    this.blinkT -= dt;
    let blink = 1;
    if (this.blinkT < 0) {
      blink = 0.1;
      if (this.blinkT < -0.12) this.blinkT = 1.8 + Math.random() * 4;
    }
    const open = this.sm('eyes', p.eyes, 10, dt);
    const happy = this.sm('happy', p.happy, 8, dt);
    const y = Math.max(0.06, Math.min(blink, open) * (1 - 0.72 * happy));
    for (const n of ['EyeL', 'EyeR']) {
      const e = this.parts[n];
      const r = e && this.rest.get(e);
      if (e && r) e.scale.set(r.s.x, r.s.y * y, r.s.z);
    }
    this.sm('chirp', 0, 6, dt);
    for (const m of this.eyeMats) {
      m.emissive.setRGB(0.55, 0.62, 0.28);
      m.emissiveIntensity = this.night * 0.9 * (y > 0.3 ? 1 : 0);
    }
  }

  /** Kick a quick chirp (brow/head bob) — decays by itself. */
  chirp() {
    this.cur.chirp = 1;
  }

  /** Current world position of a named part (e.g. 'Head' for close-up cameras). */
  partWorld(name: string, out = new THREE.Vector3()) {
    const p = this.parts[name];
    if (!p) return this.root.getWorldPosition(out);
    return p.getWorldPosition(out);
  }

  setVisible(v: boolean) {
    this.root.visible = v;
  }
}

// ================================================================================================ placeholders
// Primitive stand-ins with the same node names, used only if a GLB fails to load.

function furMat(color: number) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, name: 'Fur' });
}
function plainMat(color: number, name = 'Plain', rough = 0.8) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, name });
}
function ell(r: number, mat: THREE.Material, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat);
  m.scale.set(sx, sy, sz);
  return m;
}
function node(parent: THREE.Object3D, name: string, x: number, y: number, z: number) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function buildQuadPlaceholder(spec: RigSpec): THREE.Object3D {
  const root = new THREE.Group();
  root.name = spec.name;
  const s = spec.size / 0.42; // proportions of Mom
  const fur = furMat(0x837a70);
  const light = plainMat(0xdcd3c4);
  const dark = plainMat(0x1f1b19);
  const eye = plainMat(0x050505, 'Eye', 0.1);
  const body = node(root, 'Body', 0, 0, 0);
  const torso = ell(0.14 * s, fur, 1, 0.85, 2.0);
  torso.position.set(0, 0.25 * s, -0.04 * s);
  body.add(torso);
  const head = node(body, 'Head', 0, 0.285 * s, 0.15 * s);
  const skull = ell(0.085 * s, fur, 1.1, 0.9, 1);
  skull.position.set(0, 0.03 * s, 0.12 * s);
  head.add(skull);
  const snout = ell(0.04 * s, light, 1, 0.8, 1.4);
  snout.position.set(0, 0.0, 0.2 * s);
  head.add(snout);
  const mask = ell(0.05 * s, dark, 1.9, 0.5, 0.8);
  mask.position.set(0, 0.04 * s, 0.17 * s);
  head.add(mask);
  const nose = node(head, 'Nose', 0, 0.0, 0.26 * s);
  nose.add(ell(0.012 * s, dark));
  for (const [n, sx] of [['EyeL', 1], ['EyeR', -1]] as [string, number][]) {
    const e = node(head, n, sx * 0.035 * s, 0.05 * s, 0.19 * s);
    e.add(ell(0.014 * s, eye));
  }
  for (const [n, sx] of [['EarL', 1], ['EarR', -1]] as [string, number][]) {
    const e = node(head, n, sx * 0.055 * s, 0.09 * s, 0.1 * s);
    const m = ell(0.028 * s, fur, 1, 1.1, 0.4);
    m.position.y = 0.02 * s;
    e.add(m);
  }
  for (const [n, x, y, z] of [
    ['LegFL', 0.07, 0.22, 0.12],
    ['LegFR', -0.07, 0.22, 0.12],
    ['LegBL', 0.08, 0.25, -0.2],
    ['LegBR', -0.08, 0.25, -0.2],
  ] as [string, number, number, number][]) {
    const l = node(body, n, x * s, y * s, z * s);
    const len = y * s - 0.02 * s;
    const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.028 * s, Math.max(0.01, len - 0.05 * s), 5, 10), fur);
    c.position.y = -len / 2;
    l.add(c);
    const paw = ell(0.03 * s, dark, 1, 0.6, 1.3);
    paw.position.set(0, -len, 0.01 * s);
    l.add(paw);
  }
  let parent: THREE.Object3D = body;
  for (let i = 1; i <= 5; i++) {
    const seg = node(parent, `Tail${i}`, 0, i === 1 ? 0.3 * s : 0, i === 1 ? -0.3 * s : -0.088 * s);
    const m = ell(0.045 * s, i % 2 ? fur : dark, 1, 1, 1.4);
    m.position.z = -0.04 * s;
    seg.add(m);
    parent = seg;
  }
  return root;
}

function buildRoundPlaceholder(spec: RigSpec): THREE.Object3D {
  const root = new THREE.Group();
  root.name = spec.name;
  const fur = furMat(0x8b8680);
  const light = plainMat(0xefeeea);
  const dark = plainMat(0x292522);
  const eye = plainMat(0x050505, 'Eye', 0.1);
  const body = node(root, 'Body', 0, 0, 0);
  body.add(ell(0.4, fur, 1.03, 0.96, 1.05));
  const head = node(body, 'Head', 0, 0.056, 0.157);
  const face = ell(0.2, fur, 1.2, 0.95, 0.9);
  face.position.set(0, 0.05, 0.12);
  head.add(face);
  const mask = ell(0.13, dark, 1.8, 0.5, 0.7);
  mask.position.set(0, 0.08, 0.26);
  head.add(mask);
  const muzzle = ell(0.08, light, 1.1, 0.8, 1);
  muzzle.position.set(0, -0.01, 0.33);
  head.add(muzzle);
  const nose = node(head, 'Nose', 0, 0.0, 0.4);
  nose.add(ell(0.03, dark));
  for (const [n, sx] of [['EyeL', 1], ['EyeR', -1]] as [string, number][]) {
    const e = node(head, n, sx * 0.1, 0.08, 0.3);
    e.add(ell(0.04, eye));
  }
  for (const [n, sx] of [['EarL', 1], ['EarR', -1]] as [string, number][]) {
    const e = node(head, n, sx * 0.19, 0.26, -0.06);
    e.add(ell(0.07, fur, 1, 1.1, 0.4));
  }
  for (const [n, h, x, y, z] of [
    ['ArmL', 'HandL', 0.137, -0.224, 0.146],
    ['ArmR', 'HandR', -0.137, -0.224, 0.146],
    ['LegL', '', 0.148, -0.202, -0.134],
    ['LegR', '', -0.148, -0.202, -0.134],
  ] as [string, string, number, number, number][]) {
    const l = node(body, n, x, y, z);
    const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.12, 5, 10), fur);
    c.position.y = -0.11;
    l.add(c);
    const paw = node(l, h || n + 'Foot', 0, -0.23, 0.04);
    paw.add(ell(0.055, dark, 1.1, 0.6, 1.3));
  }
  let parent: THREE.Object3D = body;
  for (let i = 1; i <= 5; i++) {
    const seg = node(parent, `Tail${i}`, 0, i === 1 ? -0.112 : 0.01, i === 1 ? -0.325 : -0.17);
    const m = ell(0.09, i % 2 ? fur : dark, 1, 1, 1.4);
    m.position.z = -0.08;
    seg.add(m);
    parent = seg;
  }
  return root;
}
