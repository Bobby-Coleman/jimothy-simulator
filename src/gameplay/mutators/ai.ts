import * as THREE from 'three';
import type { JimothyModel } from '../../player/JimothyModel';
import type { JimothyQuad } from '../../player/JimothyQuad';
import { applyFur } from '../../player/Fur';
import { headAnchors, isOurs, markOurs, modelParts, type HeadAnchors } from './accessories';
import { makeLabelSprite, disposeSprite, Shape } from './fx';
import { sharedFx } from './shared';
import { getPlayer, PLAYER_R, type ModelMods, type MutatorImpl } from './types';

/** Shell fur length (m) where `_furlen` = 1 (src/player/Fur.ts). */
const FUR_LEN = 0.035;

/**
 * The shimmer: an additive fresnel shell pushed out along the normals. Works on skinned meshes too (bound to the same
 * skeleton: pushed along the bind-pose normal, then skinned); with FUR_PUSH it also rides out past the fur (`_furlen`).
 */
const OVERLAY_VERT = /* glsl */ `
uniform float uPush;
#ifdef FUR_PUSH
attribute float _furlen;
uniform float uFurPush;
#endif
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
#include <common>
#include <skinning_pars_vertex>
void main() {
  vec3 objectNormal = vec3(normal);
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  float push = uPush;
  #ifdef FUR_PUSH
  push += _furlen * uFurPush;
  #endif
  vec3 transformed = position + normal * push;
  #include <skinning_vertex>
  vec4 w = modelMatrix * vec4(transformed, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vN = normalize(normalMatrix * objectNormal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const OVERLAY_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uGain;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float hue = fract(f * 0.9 + uTime * 0.18 + vW.y * 1.6 + vW.x * 0.7 + vW.z * 0.4);
  vec3 col = hsv2rgb(vec3(hue, 0.7, 1.0));
  float scan = step(0.9, fract(vW.y * 16.0 - uTime * 2.2)) * 0.16;
  float a = (0.05 + f * 0.62 + scan) * uIntensity * uGain;
  gl_FragColor = vec4(col * a, 1.0);
}`;

const SLOP_LINES = [
  '(generated)',
  'Enhanced by AI™',
  '✨ AI Jimothy ✨',
  '[image may contain: raccoon]',
  'Certainly! Here is a raccoon:',
  '(generated)',
  '97% raccoon',
  'legs: approximately 7',
];

const _v = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/** Recent poses of a few bones (quaternions), so a copy can play them back a moment late. */
class PoseHistory {
  private t: number[] = [];
  private q: Float32Array[] = [];
  private head = 0;
  private filled = 0;
  constructor(
    private bones: THREE.Object3D[],
    private size = 64,
  ) {
    for (let i = 0; i < size; i++) {
      this.t.push(-1e9);
      this.q.push(new Float32Array(bones.length * 4));
    }
  }
  push(time: number) {
    const a = this.q[this.head];
    this.bones.forEach((b, i) => b.quaternion.toArray(a, i * 4));
    this.t[this.head] = time;
    this.head = (this.head + 1) % this.size;
    this.filled = Math.min(this.size, this.filled + 1);
  }
  /** The newest pose at or before `time` (else the oldest kept). */
  at(time: number): Float32Array {
    let best = (this.head - 1 + this.size) % this.size;
    for (let k = 1; k <= this.filled; k++) {
      const i = (this.head - k + this.size) % this.size;
      best = i;
      if (this.t[i] <= time) break;
    }
    return this.q[best];
  }
}

/** A copy of one of his real legs (cut out of his skinned body) on its own bone chain, echoing the real leg late. */
interface EchoLeg {
  mesh: THREE.SkinnedMesh;
  /** [root, upper, lower, end(, toes)]; the root hangs from `attach`. */
  bones: THREE.Bone[];
  /** The real leg's bones, same order ([0] = its parent: a shoulder blade or the hips). */
  src: THREE.Object3D[];
  attach: THREE.Object3D;
  hist: PoseHistory;
  delay: number;
}

/** A wobbly capsule leg (the ball form). */
interface BallLeg {
  g: THREE.Group;
  base: THREE.Euler;
  f1: number;
  f2: number;
  ph: number;
}

/** Everything the mutator added to one of his two forms. */
interface FormKit {
  root: THREE.Object3D;
  quad: JimothyQuad | null;
  overlays: THREE.Mesh[];
  ballLegs: BallLeg[];
  echo: EchoLeg[];
  eye: THREE.Object3D | null;
  /** Called on disable. */
  dispose: (() => void)[];
}

/**
 * Cut one of his real legs out of the skinned body: the triangles whose vertices mostly follow `src[1..]`, re-skinned
 * onto a fresh copy of that chain (whatever else they are weighted to follows the copy's root, `src[0]`'s stand-in).
 * Shares the body's material (coat texture, wetness), gets its own shell fur.
 */
function cutLeg(sk: THREE.SkinnedMesh, src: THREE.Object3D[]): { mesh: THREE.SkinnedMesh; bones: THREE.Bone[] } | null {
  const skel = sk.skeleton;
  const idx = src.map((b) => skel.bones.indexOf(b as THREE.Bone));
  if (idx.some((i) => i < 0)) return null;
  const geo = sk.geometry;
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const index = geo.index;
  if (!si || !sw || !index) return null;
  const n = si.count;
  const own = new Set(idx.slice(1));
  const on = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) {
        bw = w;
        best = si.getComponent(i, k);
      }
    }
    on[i] = own.has(best) ? 1 : 0;
  }
  const remap = new Int32Array(n).fill(-1);
  const tris: number[] = [];
  let count = 0;
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    if (!on[a] || !on[b] || !on[c]) continue;
    for (const v of [a, b, c]) {
      if (remap[v] < 0) remap[v] = count++;
      tris.push(remap[v]);
    }
  }
  if (!tris.length) return null;
  const out = new THREE.BufferGeometry();
  const toNew = new Map(idx.map((b, k) => [b, k]));
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const s = a.itemSize;
    const arr = name === 'skinIndex' ? new Uint16Array(count * s) : new Float32Array(count * s);
    for (let i = 0; i < n; i++) {
      const j = remap[i];
      if (j < 0) continue;
      for (let k = 0; k < s; k++) {
        const v = a.getComponent(i, k);
        arr[j * s + k] = name === 'skinIndex' ? (toNew.get(v) ?? 0) : v;
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  out.setIndex(tris);
  out.computeBoundingSphere();
  const bones = src.map((b, k) => {
    const nb = new THREE.Bone();
    nb.name = 'AI_' + b.name;
    if (k > 0) nb.position.copy(b.position);
    return nb;
  });
  for (let k = 1; k < bones.length; k++) bones[k - 1].add(bones[k]);
  const skeleton = new THREE.Skeleton(bones, idx.map((i) => skel.boneInverses[i].clone()));
  const mesh = new THREE.SkinnedMesh(out, sk.material);
  mesh.name = 'AILeg';
  mesh.bind(skeleton, sk.bindMatrix);
  mesh.bindMode = sk.bindMode;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, bones };
}

/** Rest (bind-pose) position of a bone in the mesh's (= the model's) frame. */
function bindPos(sk: THREE.SkinnedMesh, bone: THREE.Object3D) {
  const i = sk.skeleton.bones.indexOf(bone as THREE.Bone);
  _m.copy(sk.skeleton.boneInverses[i]).invert().premultiply(_m2.copy(sk.bindMatrix).invert());
  return new THREE.Vector3().setFromMatrixPosition(_m);
}
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

/** The rotation of `to` relative to `from` (an ancestor), from the local rotations in between. */
function relQuat(from: THREE.Object3D, to: THREE.Object3D, out: THREE.Quaternion) {
  out.identity();
  const chain: THREE.Object3D[] = [];
  for (let o: THREE.Object3D | null = to; o && o !== from; o = o.parent) chain.unshift(o);
  for (const o of chain) out.multiply(o.quaternion);
  return out;
}

export function aiEnhanced(): MutatorImpl {
  let overlayMat: THREE.ShaderMaterial | null = null;
  let overlayFurMat: THREE.ShaderMaterial | null = null;
  const kits: FormKit[] = [];
  let kit: FormKit | null = null;
  let label: THREE.Sprite | null = null;
  let labelT = 0;
  let nextLabel = 2;
  let nextGlitch = 1;
  let glitch: {
    kind: number;
    t: number;
    dur: number;
    a: THREE.Vector3;
    /** What dropped out: a mesh we hid, or a bone we collapsed (they all rest at scale 1). */
    hidden?: { obj: THREE.Object3D; collapsed?: boolean };
  } | null = null;
  let blinkT = 0;

  function endGlitch() {
    const h = glitch?.hidden;
    if (h) {
      if (h.collapsed) h.obj.scale.setScalar(1);
      else h.obj.visible = true;
    }
    glitch = null;
  }

  function overlay(mesh: THREE.Mesh, k: FormKit) {
    const sk = mesh as THREE.SkinnedMesh;
    const fur = !!mesh.geometry.getAttribute('_furlen');
    const mat = fur ? overlayFurMat! : overlayMat!;
    let ov: THREE.Mesh;
    if (sk.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(sk.geometry, mat);
      s.bind(sk.skeleton, sk.bindMatrix);
      s.bindMode = sk.bindMode;
      s.frustumCulled = false;
      ov = s;
    } else ov = new THREE.Mesh(mesh.geometry, mat);
    ov.renderOrder = 6;
    ov.castShadow = false;
    ov.receiveShadow = false;
    markOurs(ov);
    mesh.add(ov);
    k.overlays.push(ov);
  }

  /** The walking Jimothy: shimmer on his skinned body, three echo legs cut from his own, a third eye on his forehead. */
  function buildQuad(model: JimothyModel, quad: JimothyQuad, k: FormKit) {
    const sk = quad.skinned;
    if (!sk) return;
    overlay(sk, k);
    const b = quad.bones;
    // extra legs: a copy of each front leg under his belly (between his front and hind legs), and a spare right hind
    // leg beside the real one, each replaying the real leg's pose a moment late (the famous AI walk cycle)
    const specs: { src: string[]; attach: string; at: (joint: THREE.Vector3) => THREE.Vector3; delay: number }[] = [
      { src: ['ScapulaL', 'ArmL', 'ForearmL', 'HandL'], attach: 'Spine1', at: (j) => j.set(j.x, j.y, -0.005), delay: 0.14 },
      { src: ['ScapulaR', 'ArmR', 'ForearmR', 'HandR'], attach: 'Spine1', at: (j) => j.set(j.x, j.y, -0.005), delay: 0.14 },
      { src: ['Hips', 'ThighR', 'ShinR', 'FootR', 'ToesR'], attach: 'Hips', at: (j) => j.add(_v.set(-0.07, 0.01, 0.09)), delay: 0.3 },
    ];
    const legRoot = new THREE.Group();
    for (const s of specs) {
      const src = s.src.map((n) => b[n]);
      const attach = b[s.attach];
      if (src.some((o) => !o) || !attach) continue;
      const cut = cutLeg(sk, src);
      if (!cut) continue;
      // place the copy's first joint (shoulder / hip) where `at` says, in the model frame at rest
      const joint = bindPos(sk, src[1]);
      const want = s.at(joint.clone());
      const rootAt = want.sub(joint.sub(bindPos(sk, src[0])));
      cut.bones[0].position.copy(rootAt.sub(bindPos(sk, attach)));
      markOurs(cut.bones[0]);
      attach.add(cut.bones[0]);
      legRoot.add(cut.mesh);
      k.echo.push({ mesh: cut.mesh, bones: cut.bones, src, attach, hist: new PoseHistory(src.slice(1)), delay: s.delay });
    }
    // they're him, so they get his fur (one shell draw each)
    applyFur(legRoot);
    for (const e of k.echo) {
      e.mesh.removeFromParent();
      quad.arm.add(e.mesh);
      markOurs(e.mesh);
      overlay(e.mesh, k);
    }
    k.dispose.push(() => {
      const mats = new Set<THREE.Material>();
      for (const e of k.echo) {
        e.mesh.removeFromParent();
        e.bones[0].removeFromParent();
        for (const c of e.mesh.children) {
          if (!c.userData.furShell) continue;
          (c as THREE.Mesh).geometry.dispose();
          mats.add((c as THREE.Mesh).material as THREE.Material);
        }
        e.mesh.geometry.dispose();
        e.mesh.skeleton.dispose();
      }
      for (const m of mats) m.dispose();
      k.echo.length = 0;
    });
    // a third eye in the middle of his forehead, between and a little above the others
    const a = headAnchors(model);
    if (a) {
      const spot = foreheadSpot(quad, a);
      if (spot) {
        const e = buildEye(a.eyeR * 1.25);
        e.position.copy(spot.pos);
        e.quaternion.setFromUnitVectors(Z, spot.normal);
        markOurs(e);
        b.Head.add(e);
        k.eye = e;
      }
    }
  }

  /** The ball: shimmer on every rigid part, three wobbly capsule legs, a third eye found by raycast. */
  function buildBall(model: JimothyModel, k: FormKit) {
    const targets: THREE.Mesh[] = [];
    const walk = (o: THREE.Object3D) => {
      if (isOurs(o)) return;
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry?.getAttribute('normal')) targets.push(m);
      for (const c of o.children) walk(c);
    };
    walk(k.root);
    for (const m of targets) overlay(m, k);
    const parts = modelParts(model);
    const body = parts.Body;
    const a = headAnchors(model);
    const s = a?.scale ?? 1;
    if (body) {
      const fur = new THREE.MeshStandardMaterial({ color: 0x8e877e, roughness: 0.95 });
      const paw = new THREE.MeshStandardMaterial({ color: 0x241f1c, roughness: 0.8 });
      const legGeo = new THREE.CapsuleGeometry(0.052 * s, 0.13 * s, 4, 10);
      const pawGeo = new THREE.SphereGeometry(0.056 * s, 12, 8);
      k.dispose.push(() => {
        for (const l of k.ballLegs) l.g.removeFromParent();
        k.ballLegs.length = 0;
        fur.dispose();
        paw.dispose();
        legGeo.dispose();
        pawGeo.dispose();
      });
      const specs: [number, number, number, number, number, number][] = [
        // x, y, z, rotX, rotZ, length scale
        [0.3, -0.1, 0.06, 0.1, 0.95, 1],
        [-0.29, -0.02, -0.08, -0.2, -1.2, 0.8],
        [0.12, 0.27, -0.2, 2.35, 0.2, 1.1],
      ];
      specs.forEach(([x, y, z, rx, rz, len], i) => {
        const g = new THREE.Group();
        g.position.set(x * s, y * s, z * s);
        const leg = new THREE.Mesh(legGeo, fur);
        leg.position.y = -0.1 * s * len;
        leg.scale.set(1, len, 1);
        const p = new THREE.Mesh(pawGeo, paw);
        p.position.y = -0.2 * s * len;
        p.scale.set(1.1, 0.6, 1.35);
        g.add(leg, p);
        g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        markOurs(g);
        body.add(g);
        const base = new THREE.Euler(rx, 0, rz);
        g.rotation.copy(base);
        k.ballLegs.push({ g, base, f1: 7 + i * 2.3, f2: 9.5 - i * 1.7, ph: i * 1.9 });
        overlay(leg, k);
      });
    }
    // the third eye: find the forehead surface by casting backwards from in front of the face
    const head = parts.Head;
    if (head && a) {
      const e = buildEye(a.eyeR * 0.85);
      const y = a.eyeMid.y + a.eyeSep * 0.55;
      head.updateWorldMatrix(true, true);
      const from = head.localToWorld(new THREE.Vector3(0, y, a.eyeMid.z + 1));
      const to = head.localToWorld(new THREE.Vector3(0, y, a.eyeMid.z - 1));
      const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0, 2 * head.getWorldScale(new THREE.Vector3()).x + 2);
      const hit = ray.intersectObject(head, true).find((h) => !isOurs(h.object));
      const z = hit ? head.worldToLocal(hit.point.clone()).z : a.eyeMid.z;
      e.position.set(0, y, z - a.eyeR * 0.35);
      markOurs(e);
      head.add(e);
      k.eye = e;
    }
  }

  function buildEye(r: number) {
    const e = new THREE.Group();
    e.name = 'AIThirdEye';
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.08, metalness: 0.2 }));
    const hl = new THREE.Mesh(new THREE.SphereGeometry(r * 0.26, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    hl.position.set(r * 0.3, r * 0.35, r * 0.65);
    e.add(ball, hl);
    e.userData.ownsResources = true;
    return e;
  }

  /**
   * Where the third eye goes on the walking Jimothy (Head-bone frame): on his forehead, between and a little above his
   * eyes, sunk a little into the fur there. Cast at his bind-pose skin (a head vertex's bind → Head-bone map is fixed).
   */
  function foreheadSpot(quad: JimothyQuad, a: HeadAnchors) {
    const sk = quad.skinned!;
    const hi = sk.skeleton.bones.indexOf(quad.bones.Head as THREE.Bone);
    if (hi < 0) return null;
    const H = new THREE.Matrix4().multiplyMatrices(sk.skeleton.boneInverses[hi], sk.bindMatrix);
    const Hi = H.clone().invert();
    const tilt = a.quad?.faceTilt ?? 0;
    const face = new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt));
    const up = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
    const aim = a.eyeMid.clone().addScaledVector(up, a.eyeSep * 0.62);
    const from = aim.clone().addScaledVector(face, 0.3).applyMatrix4(Hi);
    const dir = face.clone().negate().transformDirection(Hi);
    const probe = new THREE.Mesh(sk.geometry);
    const hit = new THREE.Raycaster(from, dir, 0, 0.6).intersectObject(probe, false)[0];
    if (!hit?.face) return null;
    const fl = sk.geometry.getAttribute('_furlen');
    const fur = fl ? ((fl.getX(hit.face.a) + fl.getX(hit.face.b) + fl.getX(hit.face.c)) / 3) * FUR_LEN : 0;
    const normal = hit.face.normal.clone().transformDirection(H).lerp(face, 0.5).normalize();
    return { pos: hit.point.applyMatrix4(H).addScaledVector(normal, fur * 0.45), normal };
  }

  function build(model: JimothyModel, root: THREE.Object3D): FormKit {
    const k: FormKit = { root, quad: model.quad, overlays: [], ballLegs: [], echo: [], eye: null, dispose: [] };
    if (model.quad) buildQuad(model, model.quad, k);
    else buildBall(model, k);
    k.dispose.push(() => {
      for (const o of k.overlays) o.removeFromParent();
      k.overlays.length = 0;
      if (k.eye) {
        k.eye.removeFromParent();
        k.eye.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        });
        k.eye = null;
      }
    });
    return k;
  }

  function disposeKit(k: FormKit) {
    for (const f of k.dispose) f();
    k.dispose.length = 0;
  }

  /** The kit for the form on screen (each form keeps its own: rolling doesn't rebuild the walker's legs). */
  function kitFor(model: JimothyModel): FormKit | null {
    const root = model.pivot.children[0];
    if (!root || !overlayMat) return null;
    let k = kits.find((x) => x.root === root) ?? null;
    if (!k) {
      // one kit per form (walker / ball): a replaced form (placeholder → GLB) drops what hung on the old one
      for (let i = kits.length - 1; i >= 0; i--) {
        if (!!kits[i].quad !== !!model.quad) continue;
        disposeKit(kits[i]);
        kits.splice(i, 1);
      }
      k = build(model, root);
      kits.push(k);
    }
    return k;
  }

  function animateEcho(k: FormKit, t: number) {
    for (const e of k.echo) {
      e.hist.push(t);
      const q = e.hist.at(t - e.delay);
      // the copy's root turns like the real leg's parent (relative to the bone it hangs from), so its paw lands flat
      relQuat(e.attach, e.src[0], e.bones[0].quaternion);
      for (let i = 1; i < e.bones.length; i++) e.bones[i].quaternion.fromArray(q, (i - 1) * 4);
    }
  }

  return {
    def: {
      id: 'aiEnhanced',
      name: 'AI Enhanced',
      desc: 'Enhanced by AI™. Now with 75% more legs, a bonus eye and a shimmer nobody asked for.',
      unlockHint: "Complete 'Touch Grass' (unplug SlopCorp).",
    },
    enable(game) {
      const opts = { vertexShader: OVERLAY_VERT, fragmentShader: OVERLAY_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
      const time = { value: 0 };
      const intensity = { value: 1 };
      overlayMat = new THREE.ShaderMaterial({ ...opts, uniforms: { uTime: time, uIntensity: intensity, uGain: { value: 1 }, uPush: { value: 0.028 } } });
      // (on his fur: a snug sheen just inside the tips, not a bubble around him; softer, as fur is all rims)
      overlayFurMat = new THREE.ShaderMaterial({
        ...opts,
        defines: { FUR_PUSH: '' },
        uniforms: { uTime: time, uIntensity: intensity, uGain: { value: 0.62 }, uPush: { value: 0.004 }, uFurPush: { value: FUR_LEN * 0.7 } },
      });
      nextLabel = 1.5;
      nextGlitch = 0.8;
      game.hint('AI Enhanced™: now with 75% more legs. Results may vary. Always check the leg count.', 3.5);
      game.sfx('slop_glitch', undefined, 0.6);
    },
    disable() {
      endGlitch();
      for (const k of kits) disposeKit(k);
      kits.length = 0;
      kit = null;
      overlayMat?.dispose();
      overlayFurMat?.dispose();
      overlayMat = overlayFurMat = null;
      if (label) disposeSprite(label);
      label = null;
    },
    post(game, dt, mods: ModelMods) {
      const p = getPlayer(game);
      if (!p || !overlayMat || !overlayFurMat) return;
      const k = kitFor(p.model);
      if (k !== kit) {
        endGlitch();
        kit = k;
      }
      if (!k) return;
      const t = game.time;
      overlayMat.uniforms.uTime.value = t;
      overlayMat.uniforms.uIntensity.value = 1;
      animateEcho(k, t);
      // wobbly capsule legs on the ball (the "AI walk cycle")
      const moving = Math.min(1, p.speed / 3);
      for (const l of k.ballLegs) {
        l.g.rotation.set(
          l.base.x + Math.sin(t * l.f1 + l.ph) * (0.35 + moving * 0.5),
          Math.sin(t * 3.1 + l.ph) * 0.3,
          l.base.z + Math.sin(t * l.f2 + l.ph * 2) * (0.3 + moving * 0.3),
        );
      }
      // third eye blinks out of sync with the others
      if (k.eye) {
        blinkT -= dt;
        let sy = 1;
        if (blinkT < 0) {
          sy = 0.1;
          if (blinkT < -0.14) blinkT = 1.2 + Math.random() * 3.5;
        }
        k.eye.scale.set(1, sy, 1);
      }
      // glitches
      nextGlitch -= dt;
      if (!glitch && nextGlitch <= 0) {
        const kind = Math.floor(Math.random() * 4);
        glitch = {
          kind,
          t: 0,
          dur: 0.06 + Math.random() * 0.14,
          a: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
        };
        if (kind === 2) {
          // a bit of him drops out for a moment: a leg, an ear, the tail, an eye (bones collapse, meshes hide)
          const hide: THREE.Object3D[] = [...k.echo.map((e) => e.mesh), ...k.ballLegs.map((l) => l.g), ...(k.eye ? [k.eye] : [])];
          const collapse: THREE.Object3D[] = [];
          if (k.quad) {
            const b = k.quad.bones;
            for (const n of ['EarL', 'EarR', 'Tail', 'ArmL', 'ThighR']) if (b[n]) collapse.push(b[n]);
            for (const n of ['EyeL', 'EyeR']) if (b[n]) hide.push(b[n]);
          } else {
            const parts = modelParts(p.model);
            for (const n of ['EarL', 'EarR', 'Tail1', 'ArmL', 'LegR']) if (parts[n]) hide.push(parts[n]!);
          }
          const all = [...hide, ...collapse];
          const v = all[Math.floor(Math.random() * all.length)];
          if (v && collapse.includes(v)) {
            glitch.hidden = { obj: v, collapsed: true };
            v.scale.setScalar(0.001);
          } else if (v) {
            glitch.hidden = { obj: v };
            v.visible = false;
          }
        }
        nextGlitch = 0.4 + Math.random() * 2;
        const fx = sharedFx(game);
        const c = p.position.clone();
        c.y += PLAYER_R * (p.sizeMul - 1);
        const cols = [0xff2bd6, 0x2bfff1, 0xb6ff3b, 0x7a5cff];
        for (let i = 0; i < 7; i++) {
          const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
          fx.glow.spawn(c.clone().addScaledVector(d, PLAYER_R * p.sizeMul * (0.8 + Math.random() * 0.5)), d.multiplyScalar(0.4), cols[i % 4], 0.07 * p.sizeMul + 0.03, 0.25 + Math.random() * 0.2, { shape: Shape.Square });
        }
        if (Math.random() < 0.3) game.sfx('slop_glitch', p.position, 0.25, 1.4);
      }
      if (glitch) {
        glitch.t += dt;
        const g = glitch;
        if (g.kind === 0) mods.offset.addScaledVector(g.a, 0.12);
        else if (g.kind === 1) mods.scale.multiply(new THREE.Vector3(1 + g.a.x * 0.5, 1 + g.a.y * 0.4, 1 + g.a.z * 0.5));
        else if (g.kind === 3) {
          overlayMat.uniforms.uIntensity.value = 3.2;
          mods.rot.y += g.a.y * 0.5;
        }
        if (g.t >= g.dur) endGlitch();
      }
      // occasional "(generated)" caption
      nextLabel -= dt;
      if (!label && nextLabel <= 0) {
        label = makeLabelSprite(SLOP_LINES[Math.floor(Math.random() * SLOP_LINES.length)], {
          height: 0.2,
          color: '#2b2b33',
          bg: 'rgba(255,255,255,0.88)',
          border: '#b79cff',
          italic: true,
        });
        game.scene.add(label);
        labelT = 0;
      }
      if (label) {
        labelT += dt;
        const top = PLAYER_R * (p.sizeMul - 1) + p.model.backTop() * p.sizeMul + 0.5;
        label.position.set(p.position.x, p.position.y + top + Math.sin(labelT * 3) * 0.03, p.position.z);
        const kk = labelT < 0.15 ? labelT / 0.15 : labelT > 2.1 ? Math.max(0, 1 - (labelT - 2.1) / 0.3) : 1;
        label.material.opacity = kk * (Math.random() < 0.04 ? 0.3 : 1);
        if (labelT > 2.4) {
          disposeSprite(label);
          label = null;
          nextLabel = 6 + Math.random() * 9;
        }
      }
    },
  };
}
