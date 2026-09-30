import * as THREE from 'three';

/**
 * Shell fur: for every mesh whose material is named "Fur…" (or "Slop…"), render SHELLS extra copies pushed out
 * along the normals with an alpha-tested strand pattern. All shells of a mesh are ONE instanced draw call
 * (the shell height comes from gl_InstanceID), so fur costs 1 extra draw per fur mesh.
 *
 * Skinned meshes (the walking Jimothy) get a SkinnedMesh shell bound to the same skeleton, drawn instanced through
 * an InstancedBufferGeometry that shares the base geometry's buffers. Shells are offset along the bind-pose normal
 * before skinning, so the fur follows the pose.
 *
 * Per-vertex length: a float attribute `_furlen` (glTF `_FURLEN`) multiplies the fur length (0 = bare skin).
 * Per-vertex comb: a vec3 attribute `_furcomb` (glTF `_FURCOMB`, model space) is the direction the fur lies in: the
 * shell tips lean that far (x the local fur length), curving like real strands. Without it, fur just droops a little.
 */
const DEFAULT_SHELLS = 10;
const FUR_LENGTH = 0.035;

let noiseTex: THREE.DataTexture | null = null;
function getNoise(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.floor(Math.random() * 255);
    data[i * 4 + 1] = Math.floor(Math.random() * 255);
    data[i * 4 + 2] = Math.floor(Math.random() * 255);
    data[i * 4 + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.NearestFilter;
  noiseTex.minFilter = THREE.NearestFilter;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

let tuftTex: THREE.DataTexture | null = null;
/** Smooth, tileable noise (a blurred random field): the tufts, small clumps where the coat ends a bit shorter. */
function getTufts(): THREE.DataTexture {
  if (tuftTex) return tuftTex;
  const n = 64;
  let a = Float32Array.from({ length: n * n }, () => Math.random());
  for (let pass = 0; pass < 3; pass++) {
    const b = new Float32Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += a[((y + dy + n) % n) * n + ((x + dx + n) % n)];
        b[y * n + x] = s / 9;
      }
    a = b;
  }
  let lo = 1;
  let hi = 0;
  for (const v of a) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const v = Math.round(((a[i] - lo) / (hi - lo)) * 255);
    data.set([v, v, v, 255], i * 4);
  }
  tuftTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tuftTex.wrapS = tuftTex.wrapT = THREE.RepeatWrapping;
  tuftTex.magFilter = THREE.LinearFilter;
  tuftTex.minFilter = THREE.LinearFilter;
  tuftTex.needsUpdate = true;
  return tuftTex;
}

export const furUniforms = {
  uFurWind: { value: new THREE.Vector3() },
  uFurTime: { value: 0 },
  /** Global fur length multiplier (e.g. wet fur = 0.5). */
  uFurScale: { value: 1 },
  /** Art pass: rim/sheen light colour (HDR, linear) so Jimothy pops off any background; Environment sets it per time of day. */
  uFurRim: { value: new THREE.Color(0.55, 0.5, 0.42) },
};

/** GLSL: soft fresnel rim (view-space normal vs view dir), added to the lit colour. */
const RIM_GLSL = /* glsl */ `
  float furNdV = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  float furRim = pow(1.0 - furNdV, 2.6);`;

/** Rim on the base (under-shell) fur material too: low quality has no shells, and it keeps silhouettes consistent. */
function addBaseRim(base: THREE.MeshStandardMaterial) {
  if (base.userData.furRim) return;
  base.userData.furRim = true;
  base.onBeforeCompile = (shader) => {
    shader.uniforms.uFurRim = furUniforms.uFurRim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uFurRim;`)
      .replace('#include <opaque_fragment>', `${RIM_GLSL}\n  outgoingLight += uFurRim * furRim * diffuseColor.rgb * 1.6;\n#include <opaque_fragment>`);
  };
  base.customProgramCacheKey = () => 'fur_base_rim';
  base.needsUpdate = true;
}

/** Quality knob: 0 disables fur for newly furred models. */
export const furSettings = { shells: DEFAULT_SHELLS };

/**
 * `clip` (optional): matrix from the fur mesh's object space (bind space for skinned meshes) into a hat's "footprint"
 * space; shells whose root lies under the hat (y > 0 and x² + z² < 1) are discarded, so fur doesn't poke through beanies.
 * `lenAttr`: the geometry has a per-vertex `_furlen` multiplier.
 */
function makeShellMaterial(
  base: THREE.MeshStandardMaterial,
  shells: number,
  clip?: { value: THREE.Matrix4 },
  lenAttr = false,
  combAttr = false,
): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.name = base.name + '_shell';
  m.transparent = false;
  m.alphaTest = 0.5;
  m.side = THREE.FrontSide;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uShells = { value: shells };
    shader.uniforms.uFurLen = { value: FUR_LENGTH };
    shader.uniforms.uNoise = { value: getNoise() };
    shader.uniforms.uTufts = { value: getTufts() };
    shader.uniforms.uFurWind = furUniforms.uFurWind;
    shader.uniforms.uFurTime = furUniforms.uFurTime;
    shader.uniforms.uFurScale = furUniforms.uFurScale;
    shader.uniforms.uFurRim = furUniforms.uFurRim;
    if (clip) shader.uniforms.uFurClip = clip;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uShells; uniform float uFurLen; uniform vec3 uFurWind; uniform float uFurTime; uniform float uFurScale;
         varying vec3 vFurObjPos; varying float vShellH; varying float vFurLen;
         ${lenAttr ? 'attribute float _furlen;' : ''}
         ${combAttr ? 'attribute vec3 _furcomb;' : ''}
         ${clip ? 'uniform mat4 uFurClip; varying vec3 vFurClip;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float shellH = (float(gl_InstanceID) + 1.0) / uShells;
         vFurObjPos = position;
         ${clip ? 'vFurClip = (uFurClip * vec4(position, 1.0)).xyz;' : ''}
         vShellH = shellH;
         vFurLen = ${lenAttr ? '_furlen' : '1.0'};
         float furLen = uFurLen * uFurScale * vFurLen;
         // bind-pose normal (objectNormal is already skinned here), so skinned shells follow the pose
         transformed += normalize(normal) * shellH * furLen;
         ${combAttr ? 'transformed += _furcomb * (shellH * shellH * furLen);' : 'transformed.y -= shellH * shellH * furLen * 0.5;'}
         transformed += uFurWind * shellH * shellH * 0.02 * vFurLen * (0.6 + 0.4 * sin(uFurTime * 7.0 + position.x * 40.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uNoise; uniform sampler2D uTufts; uniform vec3 uFurRim; varying vec3 vFurObjPos; varying float vShellH; varying float vFurLen;
         ${clip ? 'varying vec3 vFurClip;' : ''}`,
      )
      .replace(
        '#include <alphatest_fragment>',
        `${clip ? 'if (vFurClip.y > 0.0 && dot(vFurClip.xz, vFurClip.xz) < 1.0) discard;' : ''}
         if (vFurLen < 0.04) discard;
         vec3 fp = vFurObjPos * 260.0;
         float n1 = texture2D(uNoise, fp.xy / 128.0).r;
         float n2 = texture2D(uNoise, fp.yz / 128.0 + 0.37).r;
         float n3 = texture2D(uNoise, fp.zx / 128.0 + 0.71).r;
         float strand = max(n1, max(n2, n3) * 0.92);
         // (long fur, like the belly fringe, stays denser toward its ends so it reads as a hanging mass)
         if (strand < vShellH * mix(0.9, 0.62, smoothstep(1.3, 2.6, vFurLen)) + 0.12) discard;
         // an uneven coat: ~4 cm tufts, some ending a little shorter than others
         vec3 tp = vFurObjPos * (60.0 / 64.0);
         float tuft = (texture2D(uTufts, tp.xy).r + texture2D(uTufts, tp.yz + 0.31).r + texture2D(uTufts, tp.zx + 0.67).r) / 3.0;
         if (vShellH > mix(0.78, 1.05, smoothstep(0.3, 0.7, tuft))) discard;
         // art pass: darker roots (self-shadowing), lighter slightly warm tips that catch the light = fluffier
         diffuseColor.rgb *= mix(0.68, 1.16, vShellH) * mix(vec3(1.0), vec3(1.05, 1.02, 0.96), vShellH);
         #include <alphatest_fragment>`,
      )
      .replace(
        '#include <opaque_fragment>',
        `${RIM_GLSL}
         outgoingLight += uFurRim * furRim * diffuseColor.rgb * (0.9 + 1.4 * vShellH);
         #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'fur_instanced_' + shells + (clip ? '_clip' : '') + (lenAttr ? '_len' : '') + (combAttr ? '_comb' : '');
  return m;
}

const _ident = new THREE.Matrix4();
const noRaycast = () => {};

/** Instanced shell copy of a skinned mesh: shares its buffers and skeleton. */
function skinnedShell(mesh: THREE.SkinnedMesh, mat: THREE.Material, shells: number) {
  const g = mesh.geometry;
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = g.index;
  for (const [k, a] of Object.entries(g.attributes)) ig.setAttribute(k, a);
  ig.instanceCount = shells;
  ig.drawRange = { ...g.drawRange };
  if (!g.boundingSphere) g.computeBoundingSphere();
  ig.boundingSphere = g.boundingSphere!.clone();
  const s = new THREE.SkinnedMesh(ig, mat);
  s.bind(mesh.skeleton, mesh.bindMatrix);
  s.bindMode = mesh.bindMode;
  return s;
}

export function applyFur(root: THREE.Object3D, enabled = true) {
  const shells = furSettings.shells;
  if (!enabled) return;
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.furShell || (m as any).isInstancedMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat || Array.isArray(mat)) return;
    if (!/^(Fur|Slop)/i.test(mat.name)) return;
    targets.push(m);
  });
  for (const mesh of targets) if ((mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) addBaseRim(mesh.material as THREE.MeshStandardMaterial);
  if (shells <= 0) return;
  const matCache = new Map<string, THREE.MeshStandardMaterial>();
  for (const mesh of targets) {
    const base = mesh.material as THREE.MeshStandardMaterial;
    const lenA = mesh.geometry.getAttribute('_furlen') as THREE.BufferAttribute | undefined;
    const lenAttr = !!lenA;
    const combAttr = !!mesh.geometry.getAttribute('_furcomb');
    // long fur (the walking Jimothy's belly fringe) gets more shells, so its layers don't gap
    let maxLen = 1;
    if (lenA) for (let i = 0; i < lenA.count; i++) maxLen = Math.max(maxLen, lenA.getX(i));
    const n = maxLen > 1.6 ? Math.min(16, Math.round(shells * 1.4)) : shells;
    const key = base.uuid + (lenAttr ? '_len' : '') + (combAttr ? '_comb' : '') + '_' + n;
    let sm = matCache.get(key);
    if (!sm) {
      sm = makeShellMaterial(base, n, undefined, lenAttr, combAttr);
      matCache.set(key, sm);
    }
    let inst: THREE.Mesh;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      inst = skinnedShell(mesh as THREE.SkinnedMesh, sm, n);
    } else {
      const im = new THREE.InstancedMesh(mesh.geometry, sm, n);
      for (let i = 0; i < n; i++) im.setMatrixAt(i, _ident);
      im.instanceMatrix.needsUpdate = true;
      inst = im;
    }
    inst.userData.furShell = true;
    inst.userData.furBase = base;
    inst.userData.furShells = n;
    inst.userData.furMat = sm;
    inst.userData.furLenAttr = lenAttr;
    inst.userData.furCombAttr = combAttr;
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false; // bounding sphere of instanced mesh isn't updated for skinned-ish parts
    inst.renderOrder = 1;
    inst.raycast = noRaycast;
    mesh.add(inst);
  }
}

/**
 * Hide the shell fur of `mesh` under a hat: `clip` maps the mesh's object space (bind space for skinned meshes) into
 * the hat's footprint space (see makeShellMaterial). Pass null to restore. No-op for meshes without shells (low quality).
 */
export function setFurClip(mesh: THREE.Object3D, clip: THREE.Matrix4 | null) {
  const inst = mesh.children.find((c) => c.userData.furShell) as THREE.Mesh | undefined;
  if (!inst) return;
  const u = inst.userData;
  if (!clip) {
    if (u.furMat) inst.material = u.furMat;
    return;
  }
  if (!u.clipMat) {
    u.clipU = { value: new THREE.Matrix4() };
    u.clipMat = makeShellMaterial(u.furBase, u.furShells, u.clipU, !!u.furLenAttr, !!u.furCombAttr);
  }
  u.clipU.value.copy(clip);
  inst.material = u.clipMat;
}

/** True if this mesh has instanced shell fur. */
export const hasFurShells = (mesh: THREE.Object3D) => mesh.children.some((c) => c.userData.furShell);
