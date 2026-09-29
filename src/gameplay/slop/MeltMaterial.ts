import * as THREE from 'three';

/**
 * "Wash the slop off" material for billboards / posters: the AI image (uSlop) melts and drips down in pixelated
 * streaks as uMelt goes 0 → 1, revealing the hand-made image underneath (uReal). Unlit (it's a lit sign) but fogged.
 */
export function makeMeltMaterial(slop: THREE.Texture, real: THREE.Texture, brightness = 0.9): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSlop: { value: slop },
        uReal: { value: real },
        uMelt: { value: 0 },
        uTime: { value: 0 },
        uBright: { value: brightness },
        uGlitch: { value: 0 },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uSlop;
      uniform sampler2D uReal;
      uniform float uMelt;
      uniform float uTime;
      uniform float uBright;
      uniform float uGlitch;
      varying vec2 vUv;
      float mh(float x) { return fract(sin(x * 127.1) * 43758.5453); }
      float mn(float x) { float i = floor(x); float f = fract(x); return mix(mh(i), mh(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main() {
        vec2 uv = vUv;
        // melt front sweeps from the top down, with drips
        float drip = mn(uv.x * 38.0) * 0.35 + mn(uv.x * 9.0 + 3.0) * 0.25;
        float front = 1.05 - uMelt * 1.3 + (drip - 0.3) * 0.55 * sin(clamp(uMelt, 0.0, 1.0) * 3.14159);
        float melted = smoothstep(front - 0.015, front + 0.015, uv.y);
        // below the front: the slop smears downward and pixelates ("low bitrate")
        float smear = clamp((uv.y - front + 0.3) * 2.2, 0.0, 1.0) * step(0.001, uMelt);
        vec2 suv = vec2(uv.x + sin(uv.y * 40.0 + uTime * 3.0) * 0.004 * smear, uv.y + smear * 0.2);
        float px = mix(640.0, 40.0, smear * smear);
        vec2 grid = vec2(px, px * 0.5);
        suv = (floor(suv * grid) + 0.5) / grid;
        // occasional horizontal glitch tear on the slop layer
        float row = floor(uv.y * 60.0);
        float tear = step(0.93, mh(row + floor(uTime * 12.0))) * uGlitch;
        suv.x += (mh(row * 3.1 + floor(uTime * 12.0)) - 0.5) * 0.08 * tear;
        vec3 slop = texture2D(uSlop, suv).rgb;
        vec3 real = texture2D(uReal, uv).rgb;
        vec3 col = mix(slop, real, melted);
        float wet = exp(-abs(uv.y - front) * 28.0) * step(0.001, uMelt) * step(uMelt, 0.999);
        col += vec3(0.25, 0.55, 0.8) * wet * 0.4;
        gl_FragColor = vec4(col * uBright, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    fog: true,
  });
  return m;
}
