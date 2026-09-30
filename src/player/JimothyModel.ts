import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import { applyFur } from './Fur';
import { makeShadowOnly, shadowOnlyMaterial } from '../world/shadowOnly';
import { JimothyQuad } from './JimothyQuad';

export interface AnimState {
  mode: string;
  speed: number;
  vy: number;
  grounded: boolean;
  carrying: boolean;
  washing: boolean;
  flop: boolean;
  time: number;
  sinceChitter: number;
  sinceBonk: number;
  climbSpeed: number;
  /** Seconds without player input/movement (idle animations). */
  idleTime?: number;
  /** 0..1 night factor (eyeshine). */
  night?: number;
  /** Turn rate (rad/s, + = turning to his left). */
  turn?: number;
}

export type FormName = 'body' | 'ball';

/** One of Jimothy's bodies: the four-legged walker, or the ball he tucks into to roll. */
interface Form {
  name: FormName;
  /** What sits under the pivot (positioned so its feet rest on the collider's bottom). */
  root: THREE.Object3D;
  parts: Partial<Record<PartName, THREE.Object3D>>;
  rest: Map<THREE.Object3D, THREE.Quaternion>;
  restPos: Map<THREE.Object3D, THREE.Vector3>;
  furMats: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[];
  eyeMats: THREE.MeshStandardMaterial[];
  quad: JimothyQuad | null;
}

/** The walking model's ground (y = 0) sits this far below the collider centre (the pivot adds +0.02 while walking). */
const BODY_OFFSET = new THREE.Vector3(0, -0.4, -0.03);

type PartName =
  | 'Body'
  | 'Head'
  | 'EarL'
  | 'EarR'
  | 'EyeL'
  | 'EyeR'
  | 'Nose'
  | 'Mouth'
  | 'ArmL'
  | 'ArmR'
  | 'HandL'
  | 'HandR'
  | 'LegL'
  | 'LegR'
  | 'Tail1'
  | 'Tail2'
  | 'Tail3'
  | 'Tail4'
  | 'Tail5';

const PART_NAMES: PartName[] = [
  'Body', 'Head', 'EarL', 'EarR', 'EyeL', 'EyeR', 'Nose', 'Mouth', 'ArmL', 'ArmR', 'HandL', 'HandR', 'LegL', 'LegR',
  'Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5',
];

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

/**
 * Jimothy's visual model + procedural animation. He has two bodies:
 * - `body`: the real, four-legged Jimothy (`assets/models/jimothy.glb`, skinned; animated by JimothyQuad)
 * - `ball`: the round ball he tucks into to roll (`assets/models/jimothy_ball.glb`, rigid parts)
 * Only the current one is attached to the pivot (so `pivot.children[0]` is always the visible model), and `parts`
 * points at its parts. A primitive ball-shaped placeholder is used until the GLBs arrive.
 */
export class JimothyModel {
  /** Placed at the physics body center each frame. */
  readonly root = new THREE.Group();
  /** Inner pivot that we rotate for facing / climbing / rolling. */
  readonly pivot = new THREE.Group();
  parts: Partial<Record<PartName, THREE.Object3D>> = {};
  private rest = new Map<THREE.Object3D, THREE.Quaternion>();
  private restPos = new Map<THREE.Object3D, THREE.Vector3>();
  private cur: Record<string, number> = {};
  private phase = 0;
  private blinkT = 2;
  private earTwitch = 0;
  private earTwitchSide = 1;
  /** Extra offset so feet touch the ground. */
  footOffset = 0.0;
  headPivot: THREE.Object3D | null = null;
  usingGlb = false;
  modelName = 'jimothy';
  private forms: Partial<Record<FormName, Form>> = {};
  private current: Form | null = null;
  private wantForm: FormName = 'body';
  /** The form on screen ('ball' while rolling, and for the placeholder). */
  form: FormName = 'ball';
  /** The walking form's animator (null until jimothy.glb has loaded). */
  quad: JimothyQuad | null = null;
  /** Show this form whatever his mode (e.g. the cannon tucks him into a ball); null = the ball only while rolling. */
  formOverride: FormName | null = null;

  constructor() {
    this.root.name = 'JimothyRoot';
    this.root.add(this.pivot);
    this.setModel(buildPlaceholder());
  }

  async load(assets: Assets) {
    const [ball, body] = await Promise.all([assets.tryModel('assets/models/jimothy_ball.glb'), assets.tryModel('assets/models/jimothy.glb')]);
    if (ball) this.addForm('ball', ball);
    if (body && JimothyQuad.fits(body)) this.addForm('body', body);
    else if (body) this.addForm('ball', body);
    this.usingGlb = !!(ball || body);
    this.setForm(this.wantForm);
    return this.usingGlb;
  }

  /** Replace the ball form (the placeholder, or a mutator's model). */
  setModel(model: THREE.Object3D) {
    this.addForm('ball', model);
    this.current = null;
    this.setForm(this.wantForm);
  }

  /** Show the four-legged body or the rolling ball (falls back to whichever exists). */
  setForm(name: FormName) {
    this.wantForm = name;
    const f = this.forms[name] ?? this.forms[name === 'body' ? 'ball' : 'body'];
    if (!f || f === this.current) return;
    if (this.current) this.pivot.remove(this.current.root);
    this.pivot.add(f.root);
    this.current = f;
    this.form = f.name;
    this.parts = f.parts;
    this.rest = f.rest;
    this.restPos = f.restPos;
    this.furMats = f.furMats;
    this.eyeMats = f.eyeMats;
    this.quad = f.quad;
    this.headPivot = this.parts.Head ?? null;
    this.cur = {};
  }

  private addForm(name: FormName, model: THREE.Object3D) {
    const old = this.forms[name];
    if (old && old.root !== model) this.pivot.remove(old.root);
    const f: Form = { name, root: model, parts: {}, rest: new Map(), restPos: new Map(), furMats: [], eyeMats: [], quad: null };
    if (name === 'body') {
      f.quad = new JimothyQuad(model);
      model.position.copy(BODY_OFFSET);
      f.parts = f.quad.parts() as Form['parts'];
    } else {
      model.traverse((o) => {
        const n = o.name as PartName;
        if (PART_NAMES.includes(n) && !f.parts[n]) f.parts[n] = o;
      });
    }
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    for (const p of Object.values(f.parts)) {
      if (!p) continue;
      f.rest.set(p, p.quaternion.clone());
      f.restPos.set(p, p.position.clone());
    }
    applyFur(model);
    // Perf: shadows come from one cheap caster per form: the ball's shadow-only sphere (+ a tail blob); the walking
    // body's own skinned mesh (its long legs need a real silhouette). Everything else (fur shells, eyes, …) doesn't.
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.shadowOnly) m.castShadow = !!(f.quad && m === f.quad.skinned);
    });
    if (!f.quad) {
      const ball = makeShadowOnly(new THREE.Mesh(new THREE.SphereGeometry(0.37, 16, 12), shadowOnlyMaterial()));
      ball.name = 'ShadowBall';
      f.parts.Body ? f.parts.Body.add(ball) : model.add(ball);
      const tail = f.parts.Tail2 ?? f.parts.Tail1;
      if (tail) {
        const blob = makeShadowOnly(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), shadowOnlyMaterial()));
        blob.scale.set(1, 1, 3.2);
        blob.position.z = -0.12;
        tail.add(blob);
      }
    }
    // Collect materials for wetness / eyeshine effects (clone so we don't touch shared assets)
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material) || m.userData.furShell) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (/^(Fur|Slop)/i.test(mat.name)) {
        f.furMats.push({ mat, base: mat.color.clone() });
      } else if (/^Eye$/i.test(mat.name) || o.name === 'EyeL' || o.name === 'EyeR') {
        if (!mat.userData.eyeClone) {
          const c = mat.clone();
          c.userData.eyeClone = true;
          m.material = c;
          f.eyeMats.push(c);
        }
      }
    });
    this.forms[name] = f;
    if (this.current?.name === name) this.current = null;
  }

  /** Height above the collider centre where carried things rest on him: the ball's top, or the walker's arched back. */
  backTop() {
    return this.quad ? 0.33 : 0.42;
  }

  private furMats: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[] = [];
  private eyeMats: THREE.MeshStandardMaterial[] = [];
  private squashV = 0;
  private clock = 0;
  private squashX = 0;
  private wetness = 0;

  /** Kick the squash-and-stretch spring: positive = squash (landing), negative = stretch (jump). */
  squash(amount: number) {
    this.squashV += amount * 9;
  }

  // Feel: paw gestures (grab miss = one-paw swipe at the air, grab = quick two-paw snatch)
  private swipeT = 9;
  private swipeSide = 1;
  private reachT = 9;
  /** A little paw swipe at nothing (grab missed). */
  swipe() {
    this.swipeT = 0;
    this.swipeSide = -this.swipeSide;
    for (const f of Object.values(this.forms)) {
      if (!f?.quad) continue;
      f.quad.swipeT = 0;
      f.quad.swipeSide = this.swipeSide;
    }
  }
  /** Both paws snatch forward (grab landed). */
  reach() {
    this.reachT = 0;
    for (const f of Object.values(this.forms)) if (f?.quad) f.quad.reachT = 0;
  }

  /** 0 = dry, 1 = soaked (darker, flatter fur). */
  setWetness(w: number) {
    if (Math.abs(w - this.wetness) < 0.01) return;
    this.wetness = w;
    const k = 1 - w * 0.35;
    for (const f of this.furMats) f.mat.color.copy(f.base).multiplyScalar(k);
  }

  /** Rotate a part by an euler offset relative to its rest pose. */
  private pose(name: PartName, x: number, y = 0, z = 0) {
    const p = this.parts[name];
    if (!p) return;
    const r = this.rest.get(p)!;
    _e.set(x, y, z, 'XYZ');
    _q.setFromEuler(_e);
    p.quaternion.copy(r).multiply(_q);
  }

  private sm(key: string, target: number, k: number, dt: number) {
    const v = damp(this.cur[key] ?? target, target, k, dt);
    this.cur[key] = v;
    return v;
  }

  animate(dt: number, s: AnimState) {
    // Idle motion (breathing, glances, tail sway…) runs on the model's own clock: on the title screen the game clock
    // is stopped, but he should still stand there breathing
    this.clock += dt;
    s.time = this.clock;
    // the ball while rolling, the real Jimothy otherwise
    this.setForm(this.formOverride ?? (s.mode === 'roll' ? 'ball' : 'body'));
    if (this.quad) {
      this.quad.animate(dt, s);
      this.animateShared(dt, s);
      return;
    }
    this.animateBall(dt, s);
    this.animateShared(dt, s);
  }

  /** Squash & stretch and eyeshine (both forms). */
  private animateShared(dt: number, s: AnimState) {
    this.squashV += (-this.squashX * 160 - this.squashV * 14) * dt;
    this.squashX += this.squashV * dt;
    const sq = THREE.MathUtils.clamp(this.squashX, -0.35, 0.35);
    this.pivot.scale.set(1 + sq * 0.55, 1 - sq, 1 + sq * 0.55);
    const night = s.night ?? 0;
    for (const m of this.eyeMats) {
      m.emissive.setRGB(0.55, 0.62, 0.28);
      m.emissiveIntensity = night * 0.9;
    }
  }

  private animateBall(dt: number, s: AnimState) {
    const t = s.time;
    const moving = s.speed > 0.3;
    const amp = Math.min(s.speed / 4.5, 1.25);
    const gaitRate = s.mode === 'swim' ? 7 : s.mode === 'climb' ? 5 + s.climbSpeed * 2 : 3 + s.speed * 2.1;
    if (moving || s.mode === 'climb' || s.mode === 'swim') this.phase += dt * gaitRate;
    const ph = this.phase;

    let armL = 0, armR = 0, legL = 0, legR = 0, armSpread = 0;
    let bob = 0, bodyPitch = 0, bodyRoll = 0;
    let tailLift = 0.12, tailSwayAmp = 0.2, tailCurl = 0;
    let limbScale = 1;
    let earFlat = 0;
    let headTilt = 0, headYaw = 0, headPitch = 0;

    switch (s.mode) {
      case 'walk':
        if (!s.grounded) {
          // superhero-ish airborne pose: front arms forward, legs back
          armL = armR = -1.0;
          legL = legR = 0.8;
          armSpread = 0.35;
          tailLift = -0.35;
        } else if (moving) {
          armL = Math.sin(ph) * 0.95 * amp;
          armR = -armL;
          legL = -Math.sin(ph) * 0.95 * amp;
          legR = -legL;
          bob = Math.abs(Math.sin(ph)) * 0.04 * amp;
          bodyPitch = 0.06 * amp;
          bodyRoll = Math.sin(ph) * 0.05 * amp;
          tailLift = -0.1 - 0.25 * amp;
          tailSwayAmp = 0.28 + 0.2 * amp;
        } else {
          headYaw = Math.sin(t * 0.7) * 0.25 + Math.sin(t * 1.9) * 0.08;
          headPitch = Math.sin(t * 0.5) * 0.06;
          // Idle: every so often Jimothy washes his face with his little hands
          const idle = s.idleTime ?? 0;
          const cyc = (idle - 4) % 9;
          if (idle > 4 && cyc < 3.2) {
            const w = Math.sin(t * 16) * 0.35;
            armL = -2.2 + w;
            armR = -2.2 - w;
            armSpread = -0.45;
            headPitch = 0.3;
            headYaw = 0;
          }
        }
        break;
      case 'swim':
        armL = Math.sin(ph) * 1.1 - 0.4;
        armR = Math.sin(ph + Math.PI) * 1.1 - 0.4;
        legL = Math.sin(ph + Math.PI) * 0.9;
        legR = Math.sin(ph) * 0.9;
        tailLift = -0.2;
        bob = Math.sin(t * 3) * 0.02;
        break;
      case 'climb':
        armL = -2.1 + Math.sin(ph) * 0.55;
        armR = -2.1 - Math.sin(ph) * 0.55;
        legL = -1.0 - Math.sin(ph) * 0.5;
        legR = -1.0 + Math.sin(ph) * 0.5;
        tailLift = 0.5;
        break;
      case 'roll':
        limbScale = 0.25;
        tailCurl = 0.85;
        earFlat = 1;
        tailSwayAmp = 0.05;
        break;
      case 'ragdoll':
      case 'hang':
        armL = Math.sin(t * 17) * 1.4 - 0.5;
        armR = Math.sin(t * 15 + 1.3) * 1.4 - 0.5;
        legL = Math.sin(t * 14 + 0.7) * 1.2;
        legR = Math.sin(t * 16 + 2.1) * 1.2;
        armSpread = 0.6;
        tailSwayAmp = 0.9;
        headTilt = Math.sin(t * 9) * 0.3;
        break;
    }

    if (s.carrying && s.mode !== 'roll' && s.mode !== 'ragdoll') {
      armL = armR = -2.75;
      armSpread = 0.15;
    }
    if (s.washing) {
      const w = Math.sin(t * 24) * 0.4;
      armL = -1.35 + w;
      armR = -1.35 - w;
      armSpread = -0.25;
      headPitch = 0.25;
    }
    if (s.sinceBonk < 0.3) {
      bodyPitch += 0.35 * (1 - s.sinceBonk / 0.3);
      armL = armR = -1.4;
    }
    // Feel: grab-miss swipe (one paw lashes out and back, body leans in) and grab snatch
    this.swipeT += dt;
    this.reachT += dt;
    if (this.swipeT < 0.32 && s.mode !== 'roll' && s.mode !== 'ragdoll') {
      const u = this.swipeT / 0.32;
      const out = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
      if (this.swipeSide > 0) armL = -2.3 * out + armL * (1 - out);
      else armR = -2.3 * out + armR * (1 - out);
      armSpread = -0.35 * out;
      bodyPitch += 0.22 * out;
      bodyRoll += 0.12 * out * this.swipeSide;
    }
    if (this.reachT < 0.18 && !s.carrying && s.mode !== 'roll' && s.mode !== 'ragdoll') {
      armL = armR = -2.0;
      bodyPitch += 0.15;
    }
    if (s.sinceChitter < 0.8) {
      headTilt += Math.sin(s.sinceChitter * 30) * 0.12 * (1 - s.sinceChitter / 0.8);
      headPitch -= 0.15;
    }

    const k = 16;
    armL = this.sm('armL', armL, k, dt);
    armR = this.sm('armR', armR, k, dt);
    legL = this.sm('legL', legL, k, dt);
    legR = this.sm('legR', legR, k, dt);
    armSpread = this.sm('armSpread', armSpread, 10, dt);
    bodyPitch = this.sm('bodyPitch', bodyPitch, 8, dt);
    bodyRoll = this.sm('bodyRoll', bodyRoll, 8, dt);
    limbScale = this.sm('limbScale', limbScale, 14, dt);
    tailLift = this.sm('tailLift', tailLift, 6, dt);
    tailCurl = this.sm('tailCurl', tailCurl, 10, dt);
    earFlat = this.sm('earFlat', earFlat, 10, dt);
    headYaw = this.sm('headYaw', headYaw, 5, dt);
    headPitch = this.sm('headPitch', headPitch, 6, dt);
    headTilt = this.sm('headTilt', headTilt, 10, dt);

    this.pose('ArmL', armL, 0, -armSpread);
    this.pose('ArmR', armR, 0, armSpread);
    this.pose('LegL', legL, 0, 0);
    this.pose('LegR', legR, 0, 0);
    for (const n of ['ArmL', 'ArmR', 'LegL', 'LegR'] as PartName[]) {
      const p = this.parts[n];
      if (p) p.scale.setScalar(limbScale);
    }
    const hand = s.carrying ? -0.6 : s.washing ? Math.sin(t * 24) * 0.5 : 0;
    this.pose('HandL', hand, 0, 0);
    this.pose('HandR', hand, 0, 0);

    // Body breathing + bob
    const body = this.parts.Body;
    if (body) {
      const rp = this.restPos.get(body)!;
      body.position.set(rp.x, rp.y + bob, rp.z);
      const breathe = 1 + Math.sin(t * 2.6) * 0.012;
      body.scale.set(breathe, 1 / breathe, breathe);
      this.pose('Body', bodyPitch, 0, bodyRoll);
    }

    // Head
    this.pose('Head', headPitch, headYaw, headTilt);

    // Ears: occasional twitch
    this.earTwitch -= dt;
    if (this.earTwitch < -Math.random() * 6 - 1.5) {
      this.earTwitch = 0.25;
      this.earTwitchSide = Math.random() < 0.5 ? 1 : -1;
    }
    const tw = this.earTwitch > 0 ? Math.sin(this.earTwitch * 40) * 0.35 : 0;
    this.pose('EarL', -earFlat * 1.1 + (this.earTwitchSide > 0 ? tw : 0), 0, 0);
    this.pose('EarR', -earFlat * 1.1 + (this.earTwitchSide < 0 ? tw : 0), 0, 0);

    // Blink
    this.blinkT -= dt;
    let eyeY = 1;
    if (this.blinkT < 0) {
      eyeY = 0.1;
      if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 4;
    }
    if (s.mode === 'ragdoll') eyeY = 0.25 + Math.abs(Math.sin(t * 3)) * 0.3;
    for (const n of ['EyeL', 'EyeR'] as PartName[]) {
      const e = this.parts[n];
      if (e) e.scale.set(1, eyeY, 1);
    }

    // Chitter: little mouth chatters
    const mouth = this.parts.Mouth;
    if (mouth) {
      const open = s.sinceChitter < 0.7 ? Math.abs(Math.sin(s.sinceChitter * 34)) * (1 - s.sinceChitter / 0.7) : 0;
      mouth.scale.set(1 + open * 0.3, 1 + open * 2.2, 1);
    }

    // Tail chain
    for (let i = 1; i <= 5; i++) {
      const sway = Math.sin(t * 2.4 - i * 0.65) * tailSwayAmp * (0.6 + i * 0.12);
      const lift = i === 1 ? tailLift : tailLift * 0.35;
      this.pose(`Tail${i}` as PartName, lift + tailCurl * 0.55, sway, 0);
    }
  }
}

/** Primitive stand-in used until/unless jimothy.glb exists. Same part names & pivots as the GLB spec. */
function buildPlaceholder(): THREE.Object3D {
  const root = new THREE.Group();
  root.name = 'Jimothy';
  const fur = new THREE.MeshStandardMaterial({ color: 0x8a8177, roughness: 0.95, name: 'Fur' });
  const belly = new THREE.MeshStandardMaterial({ color: 0xcfc6b8, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.9 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.08, metalness: 0.2 });
  const ringDark = new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.95 });
  const ringLight = new THREE.MeshStandardMaterial({ color: 0xb2a898, roughness: 0.95 });

  const add = (parent: THREE.Object3D, name: string, obj: THREE.Object3D, x: number, y: number, z: number) => {
    obj.name = name;
    obj.position.set(x, y, z);
    parent.add(obj);
    return obj;
  };
  const sphere = (r: number, mat: THREE.Material, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat);
    m.scale.set(sx, sy, sz);
    return m;
  };

  const body = add(root, 'Body', new THREE.Group(), 0, 0, 0);
  body.add(sphere(0.35, fur, 1.04, 0.95, 1.08));
  const bel = sphere(0.3, belly, 0.9, 0.8, 0.95);
  bel.position.set(0, -0.08, 0.04);
  body.add(bel);

  const head = add(body, 'Head', new THREE.Group(), 0, 0.08, 0.2);
  const skull = sphere(0.2, fur, 1.1, 0.95, 1.0);
  skull.position.set(0, 0.03, 0.06);
  head.add(skull);
  // mask band + eyebrows + muzzle
  const mask = sphere(0.13, dark, 1.75, 0.55, 0.8);
  mask.position.set(0, 0.05, 0.17);
  head.add(mask);
  for (const sx of [-1, 1]) {
    const brow = sphere(0.05, white, 1.4, 0.6, 0.6);
    brow.position.set(sx * 0.08, 0.13, 0.2);
    head.add(brow);
  }
  const muzzle = sphere(0.085, white, 1.1, 0.85, 1.1);
  muzzle.position.set(0, -0.025, 0.22);
  head.add(muzzle);
  add(head, 'Nose', sphere(0.03, eyeMat, 1.2, 0.9, 1), 0, 0.0, 0.31);
  add(head, 'EyeL', sphere(0.034, eyeMat), 0.075, 0.055, 0.265);
  add(head, 'EyeR', sphere(0.034, eyeMat), -0.075, 0.055, 0.265);
  for (const [n, sx] of [['EarL', 1], ['EarR', -1]] as [string, number][]) {
    const ear = add(head, n, new THREE.Group(), sx * 0.12, 0.19, 0.05);
    const outer = sphere(0.065, fur, 1, 1.1, 0.45);
    outer.position.y = 0.04;
    ear.add(outer);
    const inner = sphere(0.045, white, 1, 1.05, 0.35);
    inner.position.set(0, 0.04, 0.012);
    ear.add(inner);
  }

  const limb = (parent: THREE.Object3D, name: string, handName: string | null, x: number, y: number, z: number, len: number) => {
    const g = add(parent, name, new THREE.Group(), x, y, z);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, len, 6, 12), fur);
    leg.position.y = -len / 2;
    g.add(leg);
    const handObj = new THREE.Group();
    handObj.name = handName ?? name + 'Foot';
    handObj.position.y = -len - 0.03;
    g.add(handObj);
    const paw = sphere(0.055, dark, 1.1, 0.6, 1.3);
    paw.position.z = 0.02;
    handObj.add(paw);
    return g;
  };
  limb(body, 'ArmL', 'HandL', 0.15, -0.2, 0.17, 0.1);
  limb(body, 'ArmR', 'HandR', -0.15, -0.2, 0.17, 0.1);
  limb(body, 'LegL', null, 0.17, -0.22, -0.14, 0.09);
  limb(body, 'LegR', null, -0.17, -0.22, -0.14, 0.09);

  // his very short tail: one fluffy puff with a faint darker ring and tip
  const tail = add(body, 'Tail1', new THREE.Group(), 0, -0.08, -0.33);
  tail.rotation.x = 0.3;
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), fur);
  puff.scale.set(1, 0.95, 1.2);
  puff.position.z = -0.075;
  tail.add(puff);
  const ring = new THREE.Mesh(new THREE.SphereGeometry(0.092, 14, 10), ringLight);
  ring.scale.set(1, 0.95, 0.4);
  ring.position.z = -0.15;
  tail.add(ring);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.082, 12, 10), ringDark);
  tip.scale.set(1, 0.95, 0.9);
  tip.position.z = -0.2;
  tail.add(tip);
  return root;
}
