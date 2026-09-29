import * as THREE from 'three';
import { furUniforms } from '../../player/Fur';

/**
 * Light shell fur for the family animals (Mom, kits, Danny).
 * Same idea as the player's Fur.ts (alpha-tested noise shells pushed out along the normals) but applied to
 * chosen meshes only, with a configurable shell count / length so tiny kits don't turn into dandelions.
 * Shell materials are cached per (base material, layer, settings) so identical animals share them.
 */

let noiseTex: THREE.DataTexture | null = null;
function getNoise(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  // Deterministic hash noise (no Math.random so every load looks the same).
  let s = 1234567;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.floor(rnd() * 255);
    data[i * 4 + 1] = Math.floor(rnd() * 255);
    data[i * 4 + 2] = Math.floor(rnd() * 255);
    data[i * 4 + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.NearestFilter;
  noiseTex.minFilter = THREE.NearestFilter;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

export interface FurOpts {
  /** Number of shells (draw calls per mesh). */
  shells: number;
  /** Fur length in the mesh's own (object) units. */
  length: number;
  /** Strand frequency in object units (higher = finer strands). */
  density: number;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

function shellMaterial(base: THREE.MeshStandardMaterial, layer: number, o: FurOpts): THREE.MeshStandardMaterial {
  const key = `${base.uuid}|${layer}|${o.shells}|${o.length}|${o.density}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m = base.clone();
  m.name = base.name + '_animalShell';
  m.transparent = false;
  m.alphaTest = 0.5;
  m.side = THREE.FrontSide;
  const h = (layer + 1) / o.shells;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uShellH = { value: h };
    shader.uniforms.uFurLen = { value: o.length };
    shader.uniforms.uFurDensity = { value: o.density };
    shader.uniforms.uNoise = { value: getNoise() };
    shader.uniforms.uFurWind = furUniforms.uFurWind;
    shader.uniforms.uFurTime = furUniforms.uFurTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uShellH; uniform float uFurLen; uniform vec3 uFurWind; uniform float uFurTime;
         varying vec3 vFurObjPos; varying float vShellH;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vFurObjPos = position;
         vShellH = uShellH;
         transformed += normalize(objectNormal) * uShellH * uFurLen;
         transformed.y -= uShellH * uShellH * uFurLen * 0.45;
         transformed += uFurWind * uShellH * uShellH * uFurLen * 0.6 * (0.6 + 0.4 * sin(uFurTime * 7.0 + position.x * 40.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uNoise; uniform float uFurDensity; varying vec3 vFurObjPos; varying float vShellH;`,
      )
      .replace(
        '#include <alphatest_fragment>',
        `vec3 fp = vFurObjPos * uFurDensity;
         float n1 = texture2D(uNoise, fp.xy / 128.0).r;
         float n2 = texture2D(uNoise, fp.yz / 128.0 + 0.37).r;
         float n3 = texture2D(uNoise, fp.zx / 128.0 + 0.71).r;
         float strand = max(n1, max(n2, n3) * 0.92);
         if (strand < vShellH * 0.9 + 0.12) discard;
         diffuseColor.rgb *= mix(0.74, 1.1, vShellH);
         #include <alphatest_fragment>`,
      );
  };
  // Shader code is identical for every layer (only uniforms differ) → one shared program.
  m.customProgramCacheKey = () => 'animalFur';
  cache.set(key, m);
  return m;
}

/** Add fur shells to one mesh (not its children). */
export function furShells(mesh: THREE.Mesh, o: FurOpts) {
  if (!mesh.isMesh || mesh.userData.furShell || mesh.userData.hasAnimalFur) return;
  const base = mesh.material as THREE.MeshStandardMaterial;
  if (!base || Array.isArray(base) || !(base as any).isMeshStandardMaterial) return;
  mesh.userData.hasAnimalFur = true;
  for (let i = 0; i < o.shells; i++) {
    const shell = new THREE.Mesh(mesh.geometry, shellMaterial(base, i, o));
    shell.userData.furShell = true;
    shell.castShadow = false;
    shell.receiveShadow = true;
    shell.renderOrder = 1;
    shell.raycast = () => {};
    mesh.add(shell);
  }
}

/** Names of rig nodes (anything else under a node is one of its own mesh primitives). */
export const PART_NAME_RE = /^(Body|Head|Ear[LR]|Eye[LR]|Nose|Mouth|Brow[LR]|Arm[LR]|Hand[LR]|Leg[FB]?[LR]|Tail\d+|Wing[LR]|Beak)$/;

/**
 * Fur the Fur-material meshes directly owned by the named parts (e.g. ['Body', 'Head']).
 * Only the part's own mesh (or its primitive child meshes for multi-material nodes) gets shells.
 */
export function furParts(root: THREE.Object3D, parts: string[], o: FurOpts) {
  const want = new Set(parts);
  const targets: THREE.Mesh[] = [];
  const consider = (m: THREE.Object3D) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.furShell) return;
    const mat = mesh.material as THREE.Material;
    if (!mat || Array.isArray(mat) || !/^Fur/i.test(mat.name)) return;
    targets.push(mesh);
  };
  root.traverse((obj) => {
    if (!want.has(obj.name)) return;
    consider(obj);
    for (const c of obj.children) if (!PART_NAME_RE.test(c.name) && c.children.length === 0) consider(c);
  });
  for (const t of targets) furShells(t, o);
}
