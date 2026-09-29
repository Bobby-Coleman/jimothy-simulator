import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { JimothyModel } from '../../player/JimothyModel';
import { disposeTree } from './fx';

/**
 * Head accessories for mutators (grad cap, sunglasses, baseball cap, beanie, bubble helmet, …).
 *
 * Accessories come from `assets/models/accessories.glb` (nodes GradCap / Sunglasses / BaseballCap / Beanie /
 * BubbleHelmet …) when that file exists, otherwise from the primitive builders below. Everything is placed in the
 * Head part's local space using anchors measured from the *current* Jimothy model (works for both the primitive
 * placeholder and jimothy.glb), and re-attached automatically when the model is swapped.
 */

export type Parts = Record<string, THREE.Object3D | undefined>;

export interface HeadAnchors {
  head: THREE.Object3D;
  /** Head-local point on top of the head (fur included) where a hat's bottom-center sits. */
  crown: THREE.Vector3;
  eyeMid: THREE.Vector3;
  eyeSep: number;
  eyeR: number;
  earMid: THREE.Vector3 | null;
  /** Bounding sphere of the whole head (ears, nose) in head-local space. */
  center: THREE.Vector3;
  radius: number;
  /** Size relative to the reference jimothy.glb head. */
  scale: number;
}

const REF_EYE_SEP = 0.186;
const anchorCache = new WeakMap<THREE.Object3D, HeadAnchors>();

export const isOurs = (o: THREE.Object3D) => !!(o.userData.furShell || o.userData.jimAccessory);

function walk(o: THREE.Object3D, fn: (o: THREE.Object3D) => void) {
  if (isOurs(o)) return;
  fn(o);
  for (const c of o.children) walk(c, fn);
}

/** Mark a subtree as ours (excluded from anchor measurement, fur, overlays). */
export function markOurs(obj: THREE.Object3D) {
  obj.traverse((o) => (o.userData.jimAccessory = true));
  return obj;
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

function localPos(part: THREE.Object3D | undefined, frame: THREE.Object3D): THREE.Vector3 | null {
  if (!part) return null;
  return frame.worldToLocal(part.getWorldPosition(new THREE.Vector3()));
}

/** Bounding box of obj's meshes (not ours) in `frame` local space. */
function boxIn(obj: THREE.Object3D, frame: THREE.Object3D): THREE.Box3 {
  const out = new THREE.Box3();
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  walk(obj, (o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!.clone().applyMatrix4(_m.multiplyMatrices(inv, m.matrixWorld));
    out.union(b);
  });
  return out;
}

export function modelParts(model: JimothyModel): Parts {
  return model.parts as Parts;
}

/** Measure the current model's head (cached per Head object). */
export function headAnchors(model: JimothyModel): HeadAnchors | null {
  const parts = modelParts(model);
  const head = parts.Head;
  if (!head) return null;
  const cached = anchorCache.get(head);
  if (cached) return cached;

  // Measure in rest pose, unscaled (bobblehead may be active)
  const savedQ = head.quaternion.clone();
  const savedS = head.scale.clone();
  head.quaternion.identity();
  head.scale.set(1, 1, 1);
  model.root.updateMatrixWorld(true);

  const eyeL = localPos(parts.EyeL, head);
  const eyeR = localPos(parts.EyeR, head);
  const earL = localPos(parts.EarL, head);
  const earR = localPos(parts.EarR, head);
  const headBox = boxIn(head, head);
  const eyeMid = eyeL && eyeR ? eyeL.clone().add(eyeR).multiplyScalar(0.5) : new THREE.Vector3(0, 0.07, 0.2);
  const eyeSep = eyeL && eyeR ? eyeL.distanceTo(eyeR) : REF_EYE_SEP;
  let eyeRad = 0.05 * (eyeSep / REF_EYE_SEP);
  if (parts.EyeL) {
    const eb = boxIn(parts.EyeL, head);
    if (!eb.isEmpty()) eyeRad = Math.max(0.01, (eb.max.x - eb.min.x) / 2);
  }
  const earMid = earL && earR ? earL.clone().add(earR).multiplyScalar(0.5) : null;
  const scale = eyeSep / REF_EYE_SEP;

  // Crown: cast a ray straight down (head-local) between the ears and the eyes
  const crownZ = earMid ? THREE.MathUtils.lerp(earMid.z, eyeMid.z, 0.35) : eyeMid.z - 0.16 * scale;
  const top = headBox.isEmpty() ? 0.3 : headBox.max.y;
  const from = head.localToWorld(new THREE.Vector3(0, top + 1, crownZ));
  const to = head.localToWorld(new THREE.Vector3(0, top - 1, crownZ));
  const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0, from.distanceTo(to));
  const hits = ray.intersectObject(model.pivot, true).filter((h) => !isOurs(h.object) && (h.object as THREE.Mesh).isMesh);
  const crown = hits.length ? head.worldToLocal(hits[0].point.clone()) : new THREE.Vector3(0, top, crownZ);
  crown.x = 0;
  crown.y += 0.022 * scale; // sit on top of the fur

  // Bounding sphere of the head (sampled vertices)
  const center = headBox.isEmpty() ? new THREE.Vector3(0, 0.08, 0.15) : headBox.getCenter(new THREE.Vector3());
  let radius = 0;
  const inv = new THREE.Matrix4().copy(head.matrixWorld).invert();
  walk(head, (o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    _m.multiplyMatrices(inv, m.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 600));
    for (let i = 0; i < pos.count; i += step) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
      radius = Math.max(radius, _v.distanceTo(center));
    }
  });
  if (radius <= 0) radius = 0.34 * scale;

  head.quaternion.copy(savedQ);
  head.scale.copy(savedS);
  model.root.updateMatrixWorld(true);

  const a: HeadAnchors = { head, crown, eyeMid, eyeSep, eyeR: eyeRad, earMid, center, radius, scale };
  anchorCache.set(head, a);
  return a;
}

// ------------------------------------------------------------------ optional GLB accessories

let accState: 'idle' | 'loading' | 'ready' | 'missing' = 'idle';
let accScene: THREE.Object3D | null = null;

export function loadAccessories(game: Game) {
  if (accState !== 'idle') return;
  accState = 'loading';
  game.assets
    .gltf('assets/models/accessories.glb')
    .then((g) => {
      accScene = g.scene;
      accScene.updateMatrixWorld(true);
      accState = 'ready';
      console.info('[mutators] accessories.glb loaded:', accScene.children.map((c) => c.name).join(', '));
    })
    .catch(() => {
      accState = 'missing';
    });
}

export function accessoriesState() {
  return accState;
}

function findNode(names: string[]): THREE.Object3D | null {
  if (!accScene) return null;
  const want = names.map((n) => n.toLowerCase());
  let found: THREE.Object3D | null = null;
  accScene.traverse((o) => {
    if (!found && want.includes(o.name.toLowerCase())) found = o;
  });
  return found;
}

export function hasGlbAccessory(names: string[]) {
  return accState === 'ready' && !!findNode(names);
}

export type FitKind = 'hat' | 'face' | 'helmet';

/**
 * Clone a GLB accessory node and place it in head-local space. If the node already sits where it should (authored
 * relative to jimothy.glb's Head) it is kept as-is, otherwise it's scaled/moved onto our anchor.
 */
export function glbAccessory(names: string[], kind: FitKind, a: HeadAnchors): THREE.Object3D | null {
  const node = findNode(names);
  if (!node) return null;
  const clone = node.clone(true);
  node.updateWorldMatrix(true, false);
  node.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
  const g = new THREE.Group();
  g.name = node.name;
  g.add(clone);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  if (box.isEmpty()) return g;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  let expected: THREE.Vector3;
  let targetW: number;
  if (kind === 'hat') {
    expected = a.crown.clone().add(new THREE.Vector3(0, size.y / 2, 0));
    targetW = a.eyeSep * 1.75;
  } else if (kind === 'face') {
    expected = a.eyeMid.clone().add(new THREE.Vector3(0, 0, a.eyeR));
    targetW = a.eyeSep * 2.3;
  } else {
    expected = a.center.clone();
    targetW = a.radius * 2.1;
  }
  const authored = c.distanceTo(expected) < 0.1 * a.scale + Math.max(size.x, size.y, size.z) * 0.25;
  if (authored) return g;
  const s = targetW / Math.max(1e-4, Math.max(size.x, size.z));
  clone.scale.multiplyScalar(s);
  clone.position.multiplyScalar(s);
  const anchor = kind === 'hat' ? a.crown.clone().add(new THREE.Vector3(0, (size.y * s) / 2, 0)) : expected;
  clone.position.add(anchor.sub(c.multiplyScalar(s)));
  return g;
}

// ------------------------------------------------------------------ attachment helper

/**
 * Keeps one accessory attached to a model part, rebuilding it when the model is swapped (placeholder → GLB) or
 * when accessories.glb finishes loading.
 */
export class Attachment {
  obj: THREE.Object3D | null = null;
  private parent: THREE.Object3D | null = null;
  private fromGlb = false;
  constructor(
    private partName: string,
    private build: (a: HeadAnchors, model: JimothyModel) => { obj: THREE.Object3D; glb: boolean } | null,
    private glbNames: string[] = [],
  ) {}

  /** Call every frame while enabled. Returns the attached object (or null if the model isn't ready). */
  ensure(model: JimothyModel): THREE.Object3D | null {
    const part = modelParts(model)[this.partName];
    if (!part) return null;
    const upgrade = !this.fromGlb && this.glbNames.length > 0 && hasGlbAccessory(this.glbNames);
    if (this.obj && this.parent === part && !upgrade) return this.obj;
    this.remove();
    const a = headAnchors(model);
    if (!a) return null;
    const r = this.build(a, model);
    if (!r) return null;
    markOurs(r.obj);
    r.obj.userData.ownsResources = !r.glb;
    part.add(r.obj);
    this.obj = r.obj;
    this.parent = part;
    this.fromGlb = r.glb;
    return r.obj;
  }

  remove() {
    if (!this.obj) return;
    this.obj.removeFromParent();
    if (this.obj.userData.ownsResources) disposeTree(this.obj);
    this.obj = null;
    this.parent = null;
    this.fromGlb = false;
  }
}

/** Helper: GLB node if available, else a primitive fallback. */
export function glbOr(names: string[], kind: FitKind, a: HeadAnchors, fallback: () => THREE.Object3D) {
  const g = glbAccessory(names, kind, a);
  if (g) return { obj: g, glb: true };
  return { obj: fallback(), glb: false };
}

// ------------------------------------------------------------------ primitive accessories

const std = (color: THREE.ColorRepresentation, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/** Mortarboard in University of Washing purple & gold. Tassel pivot is named "TasselPivot". */
export function buildGradCap(a: HeadAnchors): THREE.Object3D {
  const s = a.scale;
  const g = new THREE.Group();
  g.name = 'GradCap';
  const cloth = std(0x3d2677, { roughness: 0.85 });
  const gold = std(0xf0c040, { roughness: 0.4, metalness: 0.35, emissive: 0x3a2800, emissiveIntensity: 0.25 });
  const capR = 0.13 * s;
  const skull = mesh(new THREE.SphereGeometry(capR, 26, 10, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
  skull.scale.set(1.05, 0.62, 1.1);
  g.add(skull);
  const boardY = capR * 0.62 + 0.012 * s;
  const board = mesh(new THREE.BoxGeometry(0.36 * s, 0.022 * s, 0.36 * s), cloth, 0, boardY, 0);
  g.add(board);
  const button = mesh(new THREE.CylinderGeometry(0.018 * s, 0.018 * s, 0.014 * s, 14), gold, 0, boardY + 0.016 * s, 0);
  g.add(button);
  // cord across the board to the side edge
  const edgeX = 0.17 * s;
  const cord = mesh(new THREE.CylinderGeometry(0.005 * s, 0.005 * s, edgeX, 6), gold, edgeX / 2, boardY + 0.014 * s, 0.02 * s);
  cord.rotation.z = Math.PI / 2;
  g.add(cord);
  const pivot = new THREE.Group();
  pivot.name = 'TasselPivot';
  pivot.position.set(edgeX, boardY + 0.012 * s, 0.02 * s);
  const hang = mesh(new THREE.CylinderGeometry(0.005 * s, 0.005 * s, 0.1 * s, 6), gold, 0, -0.05 * s, 0);
  pivot.add(hang);
  const tuft = mesh(new THREE.ConeGeometry(0.02 * s, 0.07 * s, 10), gold, 0, -0.12 * s, 0);
  pivot.add(tuft);
  g.add(pivot);
  g.position.copy(a.crown).add(new THREE.Vector3(0, -0.035 * s, 0.005 * s));
  g.rotation.set(-0.1, 0, 0.06);
  return g;
}

/** Summer shades: coral frames, dark glossy lenses with a cartoon glint. */
export function buildSunglasses(a: HeadAnchors): THREE.Object3D {
  const s = a.scale;
  const g = new THREE.Group();
  g.name = 'Sunglasses';
  const frameMat = std(0xff5f7e, { roughness: 0.35, metalness: 0.1 });
  const lensMat = std(0x120d1c, { roughness: 0.06, metalness: 0.55 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
  const lensR = Math.max(a.eyeR * 1.3, a.eyeSep * 0.3);
  const half = a.eyeSep / 2;
  for (const sx of [-1, 1]) {
    const lens = mesh(new THREE.CylinderGeometry(lensR, lensR, 0.01 * s, 28), lensMat, sx * half, 0, 0);
    lens.rotation.x = Math.PI / 2;
    lens.scale.set(1.12, 1, 0.92);
    g.add(lens);
    const rim = mesh(new THREE.TorusGeometry(lensR, 0.011 * s, 8, 30), frameMat, sx * half, 0, 0.002 * s);
    rim.scale.set(1.12, 0.92, 1);
    g.add(rim);
    const glint = mesh(new THREE.PlaneGeometry(lensR * 0.22, lensR * 0.9), glintMat, sx * half - lensR * 0.35, lensR * 0.15, 0.007 * s);
    glint.rotation.z = -0.6;
    glint.castShadow = false;
    g.add(glint);
    // temple arm going back toward the ear
    const arm = mesh(new THREE.BoxGeometry(0.01 * s, 0.014 * s, 0.22 * s), frameMat, sx * (half + lensR * 1.08), lensR * 0.25, -0.11 * s);
    arm.rotation.y = sx * 0.18;
    g.add(arm);
  }
  const bridge = mesh(new THREE.TorusGeometry(half - lensR * 0.95, 0.009 * s, 6, 12, Math.PI), frameMat, 0, lensR * 0.25, 0.002 * s);
  g.add(bridge);
  g.position.set(0, a.eyeMid.y + 0.006 * s, a.eyeMid.z + a.eyeR + 0.014 * s);
  return g;
}

/** Ballard Barnacles cap: navy crown, teal brim, "B" patch. */
export function buildBaseballCap(a: HeadAnchors): THREE.Object3D {
  const s = a.scale;
  const g = new THREE.Group();
  g.name = 'BaseballCap';
  const navy = std(0x1c2c55, { roughness: 0.8 });
  const teal = std(0x13a39a, { roughness: 0.7 });
  const r = 0.14 * s;
  const dome = mesh(new THREE.SphereGeometry(r, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), navy);
  dome.scale.set(1, 0.74, 1.08);
  g.add(dome);
  const btn = mesh(new THREE.SphereGeometry(0.014 * s, 10, 8), teal, 0, r * 0.74, 0);
  g.add(btn);
  const brim = mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.012 * s, 26, 1, false, -Math.PI / 2, Math.PI), teal, 0, 0.006 * s, r * 0.42);
  brim.scale.set(1, 1, 0.95);
  brim.rotation.x = 0.1;
  g.add(brim);
  const logo = canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = '#f4f1e6';
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#13a39a';
    ctx.beginPath();
    ctx.arc(64, 64, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f1e6';
    ctx.font = '900 78px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('B', 64, 70);
  });
  const patch = mesh(new THREE.CircleGeometry(0.042 * s, 24), new THREE.MeshStandardMaterial({ map: logo, roughness: 0.8, transparent: true }), 0, r * 0.4, r * 0.96);
  patch.rotation.x = -0.62;
  patch.castShadow = false;
  g.add(patch);
  g.position.copy(a.crown).add(new THREE.Vector3(0, -0.04 * s, 0.015 * s));
  g.rotation.set(0.08, 0, 0);
  return g;
}

/** Grandma Rosie's hand-knitted beanie (red & cream stripes, pom-pom, ear holes implied). */
export function buildBeanie(a: HeadAnchors): THREE.Object3D {
  const s = a.scale;
  const g = new THREE.Group();
  g.name = 'Beanie';
  const knit = canvasTex(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#c23a2e';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#f3e7cf';
      ctx.fillRect(0, 70, 256, 26);
      ctx.fillRect(0, 150, 256, 26);
      // knit "v" stitches
      for (let y = 0; y < 256; y += 12) {
        for (let x = 0; x < 256; x += 12) {
          ctx.strokeStyle = 'rgba(0,0,0,0.16)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 1, y + 2);
          ctx.lineTo(x + 6, y + 10);
          ctx.lineTo(x + 11, y + 2);
          ctx.stroke();
        }
      }
    },
    [3, 1],
  );
  const cuffTex = canvasTex(
    256,
    64,
    (ctx) => {
      ctx.fillStyle = '#f3e7cf';
      ctx.fillRect(0, 0, 256, 64);
      for (let x = 0; x < 256; x += 8) {
        ctx.fillStyle = 'rgba(0,0,0,0.13)';
        ctx.fillRect(x, 0, 3, 64);
      }
    },
    [4, 1],
  );
  const r = 0.14 * s;
  const dome = mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), std(0xffffff, { map: knit, roughness: 1 }));
  dome.scale.set(1, 1.08, 1.05);
  g.add(dome);
  const cuff = mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.07, r * 0.42, 28, 1, true), std(0xffffff, { map: cuffTex, roughness: 1, side: THREE.DoubleSide }), 0, r * 0.1, 0);
  cuff.scale.set(1, 1, 1.05);
  g.add(cuff);
  const pomGeo = new THREE.IcosahedronGeometry(r * 0.34, 2);
  const pos = pomGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    const k = 1 + (Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453) - 0.5) * 0.35;
    _v.multiplyScalar(k);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  pomGeo.computeVertexNormals();
  const pom = mesh(pomGeo, std(0xf6ecd8, { roughness: 1, flatShading: true }), 0, r * 1.12 + r * 0.22, 0);
  g.add(pom);
  g.position.copy(a.crown).add(new THREE.Vector3(0, -0.05 * s, 0));
  g.rotation.set(-0.06, 0, -0.08);
  return g;
}

const RIM_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const RIM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uIntensity;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
  gl_FragColor = vec4(uColor * f * uIntensity, 1.0);
}`;

export function rimMaterial(color: THREE.ColorRepresentation, power = 2.5, intensity = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: power }, uIntensity: { value: intensity } },
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** Fishbowl space helmet with collar and a blinking antenna. Blinker mesh is named "Blinker". */
export function buildBubbleHelmet(a: HeadAnchors): THREE.Object3D {
  const s = a.scale;
  const g = new THREE.Group();
  g.name = 'BubbleHelmet';
  const R = a.radius * 1.03;
  const glassGeo = new THREE.SphereGeometry(R, 40, 28);
  const glass = new THREE.Mesh(
    glassGeo,
    new THREE.MeshPhysicalMaterial({
      color: 0xd8f1ff,
      transparent: true,
      opacity: 0.14,
      roughness: 0.02,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      depthWrite: false,
      envMapIntensity: 4,
    }),
  );
  glass.renderOrder = 3;
  g.add(glass);
  const rim = new THREE.Mesh(glassGeo, rimMaterial(0xbfe8ff, 2.8, 0.9));
  rim.scale.setScalar(1.003);
  rim.renderOrder = 4;
  g.add(rim);
  // big soft window glint
  const glint = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.004, 20, 12, -0.25, 0.5, 0.55, 0.45),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  glint.renderOrder = 4;
  g.add(glint);
  const white = std(0xf1f1ee, { roughness: 0.5 });
  const grey = std(0x8d96a3, { roughness: 0.4, metalness: 0.5 });
  const collar = mesh(new THREE.TorusGeometry(R * 0.66, 0.03 * s, 10, 40), white, 0, -R * 0.74, 0);
  collar.rotation.x = Math.PI / 2;
  g.add(collar);
  const collar2 = mesh(new THREE.TorusGeometry(R * 0.66, 0.012 * s, 8, 40), grey, 0, -R * 0.74 - 0.03 * s, 0);
  collar2.rotation.x = Math.PI / 2;
  g.add(collar2);
  const ant = mesh(new THREE.CylinderGeometry(0.004 * s, 0.005 * s, 0.12 * s, 6), grey, 0, R + 0.05 * s, -0.02 * s);
  g.add(ant);
  const blinker = mesh(
    new THREE.SphereGeometry(0.016 * s, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 2 }),
    0,
    R + 0.115 * s,
    -0.02 * s,
  );
  blinker.name = 'Blinker';
  g.add(blinker);
  g.position.copy(a.center);
  return g;
}
