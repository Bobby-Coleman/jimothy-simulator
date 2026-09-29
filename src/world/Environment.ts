import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Game, System } from '../core/Game';

const _v = new THREE.Vector3();

/**
 * Sky, sun/moon, hemisphere light, fog, stars and the day/night cycle.
 * timeOfDay is in hours [0, 24). Raccoons are nocturnal, so night matters for gameplay.
 */
export class Environment implements System {
  name = 'environment';
  timeOfDay = 16.2;
  /** Real minutes for a full 24h cycle. */
  dayLengthMinutes = 20;
  frozen = false;
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a45, 1.0);
  readonly sky = new Sky();
  readonly sunDir = new THREE.Vector3();
  private stars!: THREE.Points;
  private moon!: THREE.Mesh;
  private pmrem!: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky = new Sky();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTimer = 0;
  private lastEnvTime = -100;
  private game!: Game;
  /** 0 = full day, 1 = full night */
  nightFactor = 0;
  /** Forced weather tint etc. can hook here */
  fogNear = 70;
  fogFar = 480;

  get isNight() {
    return this.timeOfDay < 5.5 || this.timeOfDay > 20.5;
  }

  init(game: Game) {
    this.game = game;
    const scene = game.scene;
    this.sky.scale.setScalar(1200);
    this.sky.frustumCulled = false;
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.5;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.envSky.scale.setScalar(100);
    const eu = this.envSky.material.uniforms;
    eu.turbidity.value = 3.5;
    eu.rayleigh.value = 1.3;
    eu.mieCoefficient.value = 0.004;
    eu.mieDirectionalG.value = 0.82;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(game.renderer.renderer);

    const sun = this.sun;
    sun.castShadow = true;
    const size = game.renderer.shadowMapSize;
    sun.shadow.mapSize.set(size, size);
    const ext = 38;
    sun.shadow.camera.left = -ext;
    sun.shadow.camera.right = ext;
    sun.shadow.camera.top = ext;
    sun.shadow.camera.bottom = -ext;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    scene.add(sun);
    scene.add(sun.target);
    scene.add(this.hemi);

    scene.fog = new THREE.Fog(0xbcd3e8, this.fogNear, this.fogFar);
    scene.background = new THREE.Color(0x87a9d6);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      _v.set(Math.random() * 2 - 1, Math.random() * 0.9 + 0.08, Math.random() * 2 - 1).normalize().multiplyScalar(1000);
      pos.set([_v.x, _v.y, _v.z], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    );
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(28, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff6dc, fog: false, transparent: true, opacity: 0 }),
    );
    scene.add(this.moon);

    this.applyTime(true);
  }

  update(dt: number) {
    if (!this.frozen) this.timeOfDay = (this.timeOfDay + (dt * 24) / (this.dayLengthMinutes * 60)) % 24;
  }

  setTime(h: number) {
    this.timeOfDay = ((h % 24) + 24) % 24;
    this.applyTime(true);
  }

  lateUpdate(dt: number) {
    this.applyTime(false);
    // Shadow camera follows the player, snapped to texels to avoid shimmer
    const player = this.game.get<any>('player');
    const focus: THREE.Vector3 | undefined = player?.position;
    if (focus) {
      const sun = this.sun;
      const texel = (sun.shadow.camera.right * 2) / sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / texel) * texel;
      const fz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(fx, focus.y, fz);
      sun.position.set(fx, focus.y, fz).addScaledVector(this.lightDir(), 120);
      sun.target.updateMatrixWorld();
    }
    const cam = this.game.camera;
    this.stars.position.copy(cam.position);
    this.sky.position.copy(cam.position);
    this.moon.position.copy(cam.position).addScaledVector(_v.copy(this.sunDir).negate(), 900);
    this.moon.lookAt(cam.position);
  }

  /** Direction the active light (sun by day, moon by night) comes FROM. */
  lightDir(out = new THREE.Vector3()) {
    return this.sunDir.y > -0.02 ? out.copy(this.sunDir) : out.copy(this.sunDir).negate();
  }

  private applyTime(force: boolean) {
    const h = this.timeOfDay;
    const elev = Math.sin(((h - 6) / 24) * Math.PI * 2) * THREE.MathUtils.degToRad(62);
    const az = ((h - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) * 0.7 + 0.3).normalize();
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(this.sunDir);

    const e = this.sunDir.y; // -1..1
    const day = THREE.MathUtils.smoothstep(e, -0.08, 0.18);
    const golden = 1 - THREE.MathUtils.smoothstep(e, 0.02, 0.32);
    this.nightFactor = 1 - THREE.MathUtils.smoothstep(e, -0.2, 0.02);

    // Sun / moon light
    const sunCol = new THREE.Color(1, 0.96, 0.9).lerp(new THREE.Color(1, 0.62, 0.36), golden * day);
    const moonCol = new THREE.Color(0.55, 0.65, 1.0);
    const light = this.sun;
    if (e > -0.02) {
      light.color.copy(sunCol);
      light.intensity = 0.2 + 3.2 * day;
    } else {
      light.color.copy(moonCol);
      light.intensity = 0.55 * this.nightFactor;
    }
    // Hemisphere fill
    const skyDay = new THREE.Color(0xb7d4ff);
    const skyGold = new THREE.Color(0xffc9a0);
    const skyNight = new THREE.Color(0x2a3b66);
    const hemiSky = skyNight.clone().lerp(skyDay.clone().lerp(skyGold, golden * 0.6), day);
    this.hemi.color.copy(hemiSky);
    this.hemi.groundColor.set(0x5b4c3a).lerp(new THREE.Color(0x1b1f2a), this.nightFactor);
    this.hemi.intensity = 0.55 + 0.75 * day;

    // Fog & background
    const fogDay = new THREE.Color(0xc5dcef);
    const fogGold = new THREE.Color(0xf2c29d);
    const fogNight = new THREE.Color(0x121a2c);
    const fogCol = fogNight.clone().lerp(fogDay.clone().lerp(fogGold, golden * 0.75), day);
    const fog = this.game.scene.fog as THREE.Fog;
    fog.color.copy(fogCol);
    fog.near = this.fogNear;
    fog.far = this.fogFar;
    (this.game.scene.background as THREE.Color).copy(fogCol);

    // Sky shader looks odd at night; fade it and show stars
    (this.sky.material as THREE.ShaderMaterial).uniforms.rayleigh.value = 0.4 + 1.0 * day;
    const starMat = this.stars.material as THREE.PointsMaterial;
    starMat.opacity = this.nightFactor * 0.9;
    const moonMat = this.moon.material as THREE.MeshBasicMaterial;
    moonMat.opacity = this.nightFactor;
    this.game.renderer.bloom.intensity = 0.5 + this.nightFactor * 0.5;

    // Environment map (reflections) — regenerate occasionally
    const now = this.game.realTime;
    if (force || (now - this.lastEnvTime > 6 && Math.abs(now - this.lastEnvTime) > 0)) {
      this.lastEnvTime = now;
      const eu = this.envSky.material.uniforms;
      eu.sunPosition.value.copy(this.sunDir);
      eu.rayleigh.value = 0.4 + 1.0 * day;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.game.scene.environment = rt.texture;
      // The Sky shader is very HDR; keep image-based lighting subtle (mostly for reflections).
      this.game.scene.environmentIntensity = 0.025 + 0.05 * day;
    }
  }
}
