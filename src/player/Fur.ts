import * as THREE from 'three';

/**
 * Shell fur: for every mesh whose material is named "Fur…" (or "Slop…"), render SHELLS extra copies pushed out
 * along the normals with an alpha-tested strand pattern. All shells of a mesh are ONE instanced draw call
 * (the shell height comes from gl_InstanceID), so fur costs 1 extra draw per fur mesh.
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

export const furUniforms = {
  uFurWind: { value: new THREE.Vector3() },
  uFurTime: { value: 0 },
  /** Global fur length multiplier (e.g. wet fur = 0.5). */
  uFurScale: { value: 1 },
};

/** Quality knob: 0 disables fur for newly furred models. */
export const furSettings = { shells: DEFAULT_SHELLS };

function makeShellMaterial(base: THREE.MeshStandardMaterial, shells: number): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.name = base.name + '_shell';
  m.transparent = false;
  m.alphaTest = 0.5;
  m.side = THREE.FrontSide;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uShells = { value: shells };
    shader.uniforms.uFurLen = { value: FUR_LENGTH };
    shader.uniforms.uNoise = { value: getNoise() };
    shader.uniforms.uFurWind = furUniforms.uFurWind;
    shader.uniforms.uFurTime = furUniforms.uFurTime;
    shader.uniforms.uFurScale = furUniforms.uFurScale;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uShells; uniform float uFurLen; uniform vec3 uFurWind; uniform float uFurTime; uniform float uFurScale;
         varying vec3 vFurObjPos; varying float vShellH;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float shellH = (float(gl_InstanceID) + 1.0) / uShells;
         vFurObjPos = position;
         vShellH = shellH;
         float furLen = uFurLen * uFurScale;
         transformed += normalize(objectNormal) * shellH * furLen;
         transformed.y -= shellH * shellH * furLen * 0.5;
         transformed += uFurWind * shellH * shellH * 0.02 * (0.6 + 0.4 * sin(uFurTime * 7.0 + position.x * 40.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uNoise; varying vec3 vFurObjPos; varying float vShellH;`,
      )
      .replace(
        '#include <alphatest_fragment>',
        `vec3 fp = vFurObjPos * 260.0;
         float n1 = texture2D(uNoise, fp.xy / 128.0).r;
         float n2 = texture2D(uNoise, fp.yz / 128.0 + 0.37).r;
         float n3 = texture2D(uNoise, fp.zx / 128.0 + 0.71).r;
         float strand = max(n1, max(n2, n3) * 0.92);
         if (strand < vShellH * 0.9 + 0.12) discard;
         diffuseColor.rgb *= mix(0.72, 1.12, vShellH);
         #include <alphatest_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'fur_instanced_' + shells;
  return m;
}

const _ident = new THREE.Matrix4();

export function applyFur(root: THREE.Object3D, enabled = true) {
  const shells = furSettings.shells;
  if (!enabled || shells <= 0) return;
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.furShell || (m as any).isInstancedMesh || (m as any).isSkinnedMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat || Array.isArray(mat)) return;
    if (!/^(Fur|Slop)/i.test(mat.name)) return;
    targets.push(m);
  });
  const matCache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  for (const mesh of targets) {
    const base = mesh.material as THREE.MeshStandardMaterial;
    let sm = matCache.get(base);
    if (!sm) {
      sm = makeShellMaterial(base, shells);
      matCache.set(base, sm);
    }
    const inst = new THREE.InstancedMesh(mesh.geometry, sm, shells);
    for (let i = 0; i < shells; i++) inst.setMatrixAt(i, _ident);
    inst.instanceMatrix.needsUpdate = true;
    inst.userData.furShell = true;
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false; // bounding sphere of instanced mesh isn't updated for skinned-ish parts
    inst.renderOrder = 1;
    mesh.add(inst);
  }
}
