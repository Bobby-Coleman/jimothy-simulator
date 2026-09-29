import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
  ToneMappingEffect,
  ToneMappingMode,
  HueSaturationEffect,
  BrightnessContrastEffect,
  Effect,
  Pass,
} from 'postprocessing';

/**
 * Clamps HDR colours (and squashes NaN/Inf, which D3D maps to the clamp bounds) BEFORE bloom.
 * Without this, one Inf pixel (e.g. a sun glint on smooth water overflowing half floats) gets
 * smeared by the bloom blur over the entire screen.
 * Art pass: also applies the (half-res) ambient occlusion and the scene exposure, both in HDR before bloom/tone mapping.
 */
class SanitizeEffect extends Effect {
  constructor(readonly aoTex: THREE.Uniform<THREE.Texture | null>, readonly aoAmount: THREE.Uniform<number>, readonly exposure: THREE.Uniform<number>) {
    super(
      'SanitizeEffect',
      `uniform sampler2D tAO; uniform float uAO; uniform float uExposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = max(min(inputColor.rgb, vec3(40.0)), vec3(0.0));
        if (uAO > 0.0) c *= mix(1.0, texture2D(tAO, uv).r, uAO);
        outputColor = vec4(c * uExposure, inputColor.a);
      }`,
      {
        uniforms: new Map<string, THREE.Uniform<any>>([
          ['tAO', aoTex],
          ['uAO', aoAmount],
          ['uExposure', exposure],
        ]),
      },
    );
  }
}

/**
 * Split-tone colour grade in LDR (after tone mapping + saturation/contrast): tints shadows and highlights separately.
 * Environment drives it through the day (warm golden highlights at sunset, cool blue shadows at night).
 */
class GradeEffect extends Effect {
  constructor(readonly shadows: THREE.Uniform<THREE.Color>, readonly highlights: THREE.Uniform<THREE.Color>) {
    super(
      'GradeEffect',
      `uniform vec3 uShadows; uniform vec3 uHighlights;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c *= mix(uShadows, uHighlights, smoothstep(0.02, 0.55, l));
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`,
      {
        uniforms: new Map<string, THREE.Uniform<any>>([
          ['uShadows', shadows],
          ['uHighlights', highlights],
        ]),
      },
    );
  }
}

const FS_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

/**
 * Cheap depth-only ambient occlusion (N8AO-style, 'high' preset only): normals reconstructed from the depth buffer,
 * 12 spiral samples at HALF resolution, then a depth-aware separable blur. 3 fullscreen draws at quarter pixel count,
 * no normal pass (a normal pass would re-render the whole scene = double the draw calls).
 */
class AOPass extends Pass {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private aoMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;

  constructor(private cam: THREE.PerspectiveCamera) {
    super('AOPass');
    this.needsSwap = false;
    this.needsDepthTexture = true;
    const opts = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtA.texture.name = 'AO.A';
    this.rtB.texture.name = 'AO.B';
    this.aoMat = new THREE.ShaderMaterial({
      name: 'AOMaterial',
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDepth: { value: null },
        uProj: { value: new THREE.Matrix4() },
        uInvProj: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: 1.0 },
        uIntensity: { value: 3.2 },
        uFade: { value: 75 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform highp sampler2D tDepth; uniform mat4 uProj; uniform mat4 uInvProj; uniform vec2 uTexel;
        uniform float uRadius; uniform float uIntensity; uniform float uFade;
        varying vec2 vUv;
        vec3 viewPos(vec2 uv, float d) { vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
        vec3 viewPosAt(vec2 uv) { return viewPos(uv, textureLod(tDepth, uv, 0.0).r); }
        void main() {
          float d = textureLod(tDepth, vUv, 0.0).r;
          if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
          vec3 P = viewPos(vUv, d);
          float dist = -P.z;
          if (dist > uFade) { gl_FragColor = vec4(1.0); return; }
          vec3 pr = viewPosAt(vUv + vec2(uTexel.x, 0.0)), pl = viewPosAt(vUv - vec2(uTexel.x, 0.0));
          vec3 pt = viewPosAt(vUv + vec2(0.0, uTexel.y)), pb = viewPosAt(vUv - vec2(0.0, uTexel.y));
          vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
          vec3 dy = abs(pt.z - P.z) < abs(P.z - pb.z) ? pt - P : P - pb;
          vec3 N = normalize(cross(dx, dy));
          float rPx = min(uRadius * uProj[1][1] * 0.5 / (dist * uTexel.y), 80.0);
          if (rPx < 1.5) { gl_FragColor = vec4(1.0); return; }
          float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          float occ = 0.0;
          float r2 = uRadius * uRadius;
          for (int i = 0; i < 12; i++) {
            float fi = float(i);
            float a = fi * 2.39996323 + noise * 6.2831853;
            float t = (fi + 0.5) / 12.0;
            vec2 off = vec2(cos(a), sin(a)) * (0.08 + 0.92 * t * t) * rPx * uTexel;
            vec3 v = viewPosAt(vUv + off) - P;
            float vv = dot(v, v);
            float f = max(0.0, 1.0 - vv / r2);
            occ += max(0.0, dot(v, N) * inversesqrt(vv + 1e-5) - 0.15) * f;
          }
          float ao = 1.0 - clamp(occ / 12.0 * uIntensity, 0.0, 1.0);
          ao = mix(ao, 1.0, smoothstep(uFade * 0.55, uFade, dist));
          gl_FragColor = vec4(ao, ao, ao, 1.0);
        }`,
    });
    this.blurMat = new THREE.ShaderMaterial({
      name: 'AOBlurMaterial',
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tAO: { value: null },
        tDepth: { value: null },
        uDir: { value: new THREE.Vector2() },
        uNearFar: { value: new THREE.Vector2(0.1, 1000) },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tAO; uniform highp sampler2D tDepth; uniform vec2 uDir; uniform vec2 uNearFar;
        varying vec2 vUv;
        float lin(vec2 uv) { float d = textureLod(tDepth, uv, 0.0).r; return (uNearFar.x * uNearFar.y) / (uNearFar.y - (uNearFar.y - uNearFar.x) * d); }
        void main() {
          float c = lin(vUv);
          float sum = 0.0, wsum = 0.0;
          for (int i = -3; i <= 3; i++) {
            vec2 uv = vUv + uDir * float(i);
            float w = exp(-float(i * i) * 0.12) * max(0.0, 1.0 - abs(lin(uv) - c) / (0.06 * c + 0.05));
            sum += textureLod(tAO, uv, 0.0).r * w;
            wsum += w;
          }
          float ao = wsum > 0.001 ? sum / wsum : texture2D(tAO, vUv).r;
          gl_FragColor = vec4(ao, ao, ao, 1.0);
        }`,
    });
    this.fullscreenMaterial = this.aoMat;
  }

  get texture() {
    return this.rtA.texture;
  }

  override setDepthTexture(depthTexture: THREE.Texture) {
    this.aoMat.uniforms.tDepth.value = depthTexture;
    this.blurMat.uniforms.tDepth.value = depthTexture;
  }

  override setSize(width: number, height: number) {
    const w = Math.max(1, Math.ceil(width / 2));
    const h = Math.max(1, Math.ceil(height / 2));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.aoMat.uniforms.uTexel.value.set(1 / width, 1 / height);
  }

  override render(renderer: THREE.WebGLRenderer) {
    const cam = this.cam;
    const u = this.aoMat.uniforms;
    u.uProj.value.copy(cam.projectionMatrix);
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    const b = this.blurMat.uniforms;
    b.uNearFar.value.set(cam.near, cam.far);
    this.fullscreenMaterial = this.aoMat;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.camera);
    this.fullscreenMaterial = this.blurMat;
    b.tAO.value = this.rtA.texture;
    b.uDir.value.set(1 / this.rtA.width, 0);
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.scene, this.camera);
    b.tAO.value = this.rtB.texture;
    b.uDir.value.set(0, 1 / this.rtA.height);
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.camera);
  }

  override dispose() {
    this.rtA.dispose();
    this.rtB.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
    super.dispose();
  }
}

export type Quality = 'low' | 'medium' | 'high';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private effectPass!: EffectPass;
  private sanitizePass: EffectPass | null = null;
  private aoPass: AOPass | null = null;
  private renderPass: RenderPass;
  quality: Quality = 'medium';
  readonly bloom: BloomEffect;
  readonly vignette: VignetteEffect;
  readonly saturation: HueSaturationEffect;
  readonly contrast: BrightnessContrastEffect;
  private toneMapping: ToneMappingEffect;
  private smaa: SMAAEffect;
  /** Scene exposure (HDR multiplier before bloom / tone mapping). Environment drives it through the day. */
  readonly exposure = new THREE.Uniform(1);
  /** Ambient-occlusion strength (0..1, 'high' only). */
  readonly aoStrength = new THREE.Uniform(1.0);
  /** Split-tone grade multipliers (linear, ~1 = neutral). Environment/Weather drive them. */
  readonly gradeShadows = new THREE.Uniform(new THREE.Color(1, 1, 1));
  readonly gradeHighlights = new THREE.Uniform(new THREE.Color(1, 1, 1));
  private aoTex = new THREE.Uniform<THREE.Texture | null>(null);
  private aoAmount = new THREE.Uniform(0);
  private grade: GradeEffect;

  constructor(
    container: HTMLElement,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    const r = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    r.domElement.tabIndex = 0;
    this.renderer = r;

    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new BloomEffect({
      intensity: 0.55,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
      radius: 0.7,
    });
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: 0.42 });
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.saturation = new HueSaturationEffect({ saturation: 0.3 });
    // HueSaturationEffect only clamps the top (min(color,1.0)); on bright saturated HDR colours (yellow, orange,
    // gold) it pushes the weak channel negative, which turns those pixels BLACK further down the chain. Clamp at 0.
    const sat = this.saturation as unknown as { getFragmentShader(): string; setFragmentShader(s: string): void };
    sat.setFragmentShader(sat.getFragmentShader().replace('min(color,1.0)', 'clamp(color,0.0,1.0)'));
    this.contrast = new BrightnessContrastEffect({ contrast: 0.12, brightness: 0.0 });
    this.grade = new GradeEffect(this.gradeShadows, this.gradeHighlights);
    this.smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });

    this.setQuality(this.detectQuality(), false);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get domElement() {
    return this.renderer.domElement;
  }

  private detectQuality(): Quality {
    try {
      const saved = localStorage.getItem('jimothy.quality') as Quality | null;
      if (saved === 'low' || saved === 'medium' || saved === 'high') {
        this.qualityWasSaved = true;
        return saved;
      }
    } catch {
      /* ignore */
    }
    // UX pass: also treat touch-only devices as mobile — iPadOS Safari reports a Mac user agent, and some
    // Android browsers hide the model. A coarse primary pointer + a touch screen ≈ phone/tablet → 'low'.
    let touchOnly = false;
    try {
      touchOnly = !!window.matchMedia?.('(pointer: coarse)').matches && (navigator.maxTouchPoints ?? 0) > 0;
    } catch {
      /* ignore */
    }
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || touchOnly;
    return mobile ? 'low' : 'high';
  }

  /** True if the quality came from a saved (user/auto) choice rather than device detection. */
  qualityWasSaved = false;

  setQuality(q: Quality, persist = true) {
    this.quality = q;
    try {
      if (persist) localStorage.setItem('jimothy.quality', q);
    } catch {
      /* ignore */
    }
    // Rebuild the post chain: [AO (high only)] → sanitize(+AO apply, exposure) → bloom/tone mapping/grade/...
    for (const p of [this.aoPass, this.sanitizePass, this.effectPass]) {
      if (!p) continue;
      this.composer.removePass(p);
      if (p !== this.aoPass) p.dispose();
    }
    if (q === 'high') {
      this.aoPass ??= new AOPass(this.camera);
      this.composer.addPass(this.aoPass);
      this.aoTex.value = this.aoPass.texture;
    } else {
      this.aoPass?.dispose();
      this.aoPass = null;
      this.aoTex.value = null;
    }
    this.aoAmount.value = q === 'high' ? this.aoStrength.value : 0;
    this.sanitizePass = new EffectPass(this.camera, new SanitizeEffect(this.aoTex, this.aoAmount, this.exposure));
    this.composer.addPass(this.sanitizePass);
    // Colour grading (saturation/contrast/split-tone) happens AFTER tone mapping, in LDR: grading HDR values before
    // AgX pushed saturated colours negative and they came out black.
    const effects =
      q === 'low'
        ? [this.toneMapping, this.saturation, this.grade]
        : [this.bloom, this.toneMapping, this.saturation, this.contrast, this.grade, this.vignette, this.smaa];
    this.effectPass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.effectPass);
    this.smaa.applyPreset(q === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM);
    this.renderer.shadowMap.enabled = true;
    this.resize();
  }

  get shadowMapSize() {
    return this.quality === 'high' ? 4096 : this.quality === 'medium' ? 2048 : 1024;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const maxDpr = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.25 : 0.85;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    if (this.aoPass) this.aoAmount.value = this.aoStrength.value;
    this.composer.render(dt);
  }
}
