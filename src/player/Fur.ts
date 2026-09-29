import * as THREE from 'three';

/**
 * Shell fur: renders extra copies of every mesh whose material is named "Fur" (or "Slop"),
 * pushed out along the normals with an alpha-tested noise pattern. Cheap fluffy look.
 */
const SHELLS = 10;
const FUR_LENGTH = 0.035;

let noiseTex: THREE.DataTexture | null = null;
function getNoise(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.random();
    const s = Math.floor(v * 255);
    data[i * 4] = s;
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
};

function makeShellMaterial(base: THREE.MeshStandardMaterial, layer: number): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.name = base.name + '_shell';
  m.transparent = false;
  m.alphaTest = 0.5;
  m.side = THREE.FrontSide;
  const h = (layer + 1) / SHELLS;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uShellH = { value: h };
    shader.uniforms.uFurLen = { value: FUR_LENGTH };
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
         float furK = uShellH * uFurLen;
         transformed += normalize(objectNormal) * furK;
         // gravity droop + wind in object space (approx)
         transformed.y -= uShellH * uShellH * uFurLen * 0.5;
         transformed += uFurWind * uShellH * uShellH * 0.02 * (0.6 + 0.4 * sin(uFurTime * 7.0 + position.x * 40.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uNoise; varying vec3 vFurObjPos; varying float vShellH;`,
      )
      .replace(
        '#include <alphatest_fragment>',
        `// triplanar-ish hash lookup of strand density
         vec3 fp = vFurObjPos * 260.0;
         float n1 = texture2D(uNoise, fp.xy / 128.0).r;
         float n2 = texture2D(uNoise, fp.yz / 128.0 + 0.37).r;
         float n3 = texture2D(uNoise, fp.zx / 128.0 + 0.71).r;
         float strand = max(n1, max(n2, n3) * 0.92);
         if (strand < vShellH * 0.9 + 0.12) discard;
         diffuseColor.rgb *= mix(0.72, 1.12, vShellH);
         #include <alphatest_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'fur_' + layer;
  return m;
}

export function applyFur(root: THREE.Object3D, enabled = true) {
  if (!enabled) return;
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.furShell) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat || Array.isArray(mat)) return;
    if (!/^(Fur|Slop)/i.test(mat.name)) return;
    targets.push(m);
  });
  for (const mesh of targets) {
    const base = mesh.material as THREE.MeshStandardMaterial;
    for (let i = 0; i < SHELLS; i++) {
      const shell = new THREE.Mesh(mesh.geometry, makeShellMaterial(base, i));
      shell.userData.furShell = true;
      shell.castShadow = false;
      shell.receiveShadow = true;
      shell.renderOrder = 1;
      if ((mesh as any).isSkinnedMesh) continue; // skinned shells not supported
      mesh.add(shell);
    }
  }
}
