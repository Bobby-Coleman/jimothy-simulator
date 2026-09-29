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
} from 'postprocessing';

export type Quality = 'low' | 'medium' | 'high';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private effectPass!: EffectPass;
  private renderPass: RenderPass;
  quality: Quality = 'medium';
  readonly bloom: BloomEffect;
  readonly vignette: VignetteEffect;
  readonly saturation: HueSaturationEffect;
  readonly contrast: BrightnessContrastEffect;
  private toneMapping: ToneMappingEffect;
  private smaa: SMAAEffect;

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
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.45 });
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.saturation = new HueSaturationEffect({ saturation: 0.18 });
    this.contrast = new BrightnessContrastEffect({ contrast: 0.06, brightness: 0.0 });
    this.smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });

    this.setQuality(this.detectQuality());
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get domElement() {
    return this.renderer.domElement;
  }

  private detectQuality(): Quality {
    try {
      const saved = localStorage.getItem('jimothy.quality') as Quality | null;
      if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
    } catch {
      /* ignore */
    }
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return mobile ? 'low' : 'high';
  }

  setQuality(q: Quality) {
    this.quality = q;
    try {
      localStorage.setItem('jimothy.quality', q);
    } catch {
      /* ignore */
    }
    if (this.effectPass) {
      this.composer.removePass(this.effectPass);
      this.effectPass.dispose();
    }
    const effects =
      q === 'low'
        ? [this.saturation, this.toneMapping]
        : q === 'medium'
          ? [this.bloom, this.saturation, this.contrast, this.vignette, this.toneMapping, this.smaa]
          : [this.bloom, this.saturation, this.contrast, this.vignette, this.toneMapping, this.smaa];
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
    this.composer.render(dt);
  }
}
