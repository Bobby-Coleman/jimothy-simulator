import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import { G, groups } from '../core/Physics';

export type WeatherKind = 'clear' | 'drizzle' | 'rain';

const DROPS = 3500;
const BOX = 36; // half-size of the rain box around the camera

/**
 * Seattle weather. Mostly clear ("Jimothy Summer"), sometimes drizzle or rain.
 * While it rains outdoors the whole city counts as water: Jimothy can wash anything anywhere.
 * Emits 'weather' { kind }.
 */
export class WeatherSystem implements System {
  name = 'weather';
  kind: WeatherKind = 'clear';
  /** 0..1 smoothed rain intensity. */
  intensity = 0;
  private target = 0;
  private timer = 150;
  /** Force a weather kind (mutators / debug). null = natural cycle. */
  forced: WeatherKind | null = null;
  private rain!: THREE.InstancedMesh;
  private mat!: THREE.ShaderMaterial;
  private game!: Game;
  private coverCheckT = 0;
  private covered = false;

  init(game: Game) {
    this.game = game;
    const q = new URLSearchParams(location.search).get('weather') as WeatherKind | null;
    if (q === 'clear' || q === 'drizzle' || q === 'rain') this.forced = q;

    const geo = new THREE.PlaneGeometry(0.02, 0.7);
    geo.translate(0, 0.35, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color(0xc8d6e8) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform float uIntensity;
        attribute vec4 aSeed;
        varying float vAlpha;
        void main() {
          float box = ${BOX.toFixed(1)};
          float speed = 16.0 + aSeed.w * 6.0;
          // wrap each drop inside a box that follows the camera
          vec3 p = vec3(aSeed.x * box * 2.0, 0.0, aSeed.z * box * 2.0);
          p.y = mod(aSeed.y * 40.0 - uTime * speed, 40.0) - 12.0;
          p.x = mod(p.x - uCam.x + box, box * 2.0) - box + uCam.x;
          p.z = mod(p.z - uCam.z + box, box * 2.0) - box + uCam.z;
          p.y += uCam.y;
          // slight wind slant
          vec3 local = position;
          local.x += local.y * 0.12;
          // billboard around Y toward the camera
          vec3 toCam = normalize(vec3(uCam.x - p.x, 0.0, uCam.z - p.z));
          vec3 right = vec3(toCam.z, 0.0, -toCam.x);
          vec3 world = p + right * local.x + vec3(0.0, local.y, 0.0);
          vAlpha = step(aSeed.w, uIntensity) * 0.55;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vAlpha;
        void main() { if (vAlpha < 0.01) discard; gl_FragColor = vec4(uColor, vAlpha); }`,
    });
    this.rain = new THREE.InstancedMesh(geo, this.mat, DROPS);
    const seeds = new Float32Array(DROPS * 4);
    for (let i = 0; i < DROPS; i++) seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.renderOrder = 5;
    game.scene.add(this.rain);
  }

  /** True when it's raining on Jimothy (not under cover). */
  get rainingOnPlayer() {
    return this.intensity > 0.35 && !this.covered;
  }

  set(kind: WeatherKind) {
    this.kind = kind;
    this.target = kind === 'rain' ? 1 : kind === 'drizzle' ? 0.45 : 0;
    this.game.events.emit('weather', { kind });
    if (kind === 'rain') this.game.hint('It’s raining. The whole city is a sink now. Wash anything!', 3.5);
    else if (kind === 'drizzle') this.game.hint('A classic Seattle drizzle rolls in.', 2.5);
  }

  update(dt: number, game: Game) {
    const summer = game.get<any>('mutators')?.get?.('jimothySummer')?.enabled;
    if (summer) {
      if (this.kind !== 'clear') this.set('clear');
    } else if (this.forced) {
      if (this.kind !== this.forced) this.set(this.forced);
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        const r = Math.random();
        const next: WeatherKind = this.kind !== 'clear' ? 'clear' : r < 0.6 ? 'drizzle' : 'rain';
        this.set(next);
        this.timer = next === 'clear' ? 180 + Math.random() * 240 : 60 + Math.random() * 70;
      }
    }
    this.intensity += (this.target - this.intensity) * (1 - Math.exp(-dt * 0.35));
    if (Math.abs(this.intensity - this.target) < 0.002) this.intensity = this.target;

    // Is Jimothy under a roof?
    this.coverCheckT -= dt;
    const p = game.get<any>('player');
    if (p && this.coverCheckT <= 0) {
      this.coverCheckT = 0.4;
      const hit = game.physics.raycast(p.position, new THREE.Vector3(0, 1, 0), 40, groups(G.ALL, G.WORLD | G.VEHICLE), p.body);
      this.covered = !!hit;
    }
  }

  lateUpdate(_dt: number, game: Game) {
    const k = this.intensity;
    this.rain.visible = k > 0.02;
    this.mat.uniforms.uTime.value = game.time;
    this.mat.uniforms.uCam.value.copy(game.camera.position);
    this.mat.uniforms.uIntensity.value = k;
    const env = game.get<any>('environment');
    if (env) {
      // Overcast: dim the sun, grey the fog, thicken it
      env.sun.intensity *= 1 - 0.7 * k;
      env.hemi.intensity *= 1 - 0.25 * k;
      const fog = game.scene.fog as THREE.Fog;
      fog.color.lerp(new THREE.Color(0x8e99a6), 0.75 * k);
      fog.far = THREE.MathUtils.lerp(fog.far, 260, k);
      fog.near = THREE.MathUtils.lerp(fog.near, 25, k);
      (game.scene.background as THREE.Color).copy(fog.color);
      const su = env.sky?.material?.uniforms;
      if (su) su.turbidity.value = 3.5 + 8 * k;
      env.overcastU.value = 0.9 * k;
      env.overcastColorU.value.setRGB(0.55, 0.6, 0.67).multiplyScalar(0.25 + 0.85 * (1 - env.nightFactor));
    }
    // Wet world: shinier, darker ground
    const terrain = game.get<any>('world')?.terrain as THREE.Mesh | undefined;
    if (terrain) {
      const m = terrain.material as THREE.MeshStandardMaterial;
      m.roughness = 0.95 - 0.45 * k;
    }
  }
}
