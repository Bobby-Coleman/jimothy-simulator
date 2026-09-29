import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { drawLabel } from './SlopArt';
import type { SlopFx } from './SlopFx';
import { canvasTexture, markOwned, terrainY, worldOf } from './util';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The Prompt Portal: a swirling, pixelated ring where SlopCorp's Slopothys come out. Opens / closes with the
 * power (unplug SlopCorp → it fizzles shut).
 */
export class PromptPortal {
  readonly group = new THREE.Group();
  private disc: THREE.Mesh;
  private discMat: THREE.ShaderMaterial;
  private ringMat: THREE.MeshStandardMaterial;
  private signMat: THREE.MeshStandardMaterial;
  private openTex: THREE.Texture;
  private closedTex: THREE.Texture;
  private open = 1;
  private openTarget = 1;
  private flashT = 0;
  readonly center = new THREE.Vector3();
  readonly facing = new THREE.Vector3();
  private sparkT = 0;

  constructor(
    private game: Game,
    private fx: SlopFx,
    ground: THREE.Vector3,
    faceDir: THREE.Vector3,
  ) {
    const world = worldOf(game)!;
    const base = ground.clone();
    base.y = terrainY(game, base.x, base.z);
    const yaw = Math.atan2(faceDir.x, faceDir.z);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.facing.set(0, 0, 1).applyQuaternion(q);
    const R = 1.9;
    const H = R + 0.55;
    this.center.copy(base).add(new THREE.Vector3(0, H, 0));
    this.group.position.copy(base);
    this.group.quaternion.copy(q);

    // ring + stand
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0x3a2a6a, roughness: 0.3, metalness: 0.7, emissive: new THREE.Color(0x7df9ff), emissiveIntensity: 1.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.22, 12, 48), this.ringMat);
    ring.position.y = H;
    const standMat = world.material(0x2b2f36, { roughness: 0.5, metalness: 0.6 });
    const legs: THREE.Mesh[] = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, H - R * 0.6, 0.5), standMat);
      leg.position.set(s * R * 0.75, (H - R * 0.6) / 2, 0);
      legs.push(leg);
    }
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(R * 2.4, 0.3, 1.4), standMat);
    plinth.position.y = 0.15;

    // swirl
    this.discMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uOpen: { value: 1 }, uFlash: { value: 0 } }]),
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
        uniform float uTime;
        uniform float uOpen;
        uniform float uFlash;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          if (r > uOpen) discard;
          vec2 q = floor(p * 18.0) / 18.0;
          float rq = length(q);
          float a = atan(q.y, q.x);
          float sw = sin(a * 5.0 + rq * 13.0 - uTime * 4.0);
          vec3 col = mix(vec3(0.42, 0.1, 0.9), vec3(0.1, 0.95, 1.0), 0.5 + 0.5 * sw);
          col = mix(col, vec3(1.0, 0.35, 0.75), smoothstep(0.55, 1.0, rq) * 0.6);
          float h = fract(sin(dot(floor(p * 18.0), vec2(12.9898, 78.233)) + floor(uTime * 9.0)) * 43758.5453);
          col += step(0.94, h) * vec3(1.2);
          col += smoothstep(0.55, 0.0, r) * vec3(0.9, 0.8, 1.0);
          gl_FragColor = vec4(col * (1.1 + uFlash * 2.5), 1.0);
          #include <fog_fragment>
        }
      `,
      side: THREE.DoubleSide,
      fog: true,
      toneMapped: false,
    });
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(R - 0.1, 48), this.discMat);
    this.disc.position.y = H;

    // prompt box sign
    this.openTex = canvasTexture(640, 200, (c, w, h) => drawLabel(c, w, h, ['PROMPT PORTAL', '> jimothy but more round, 8k, real_|'], { bg: '#120c24', accent: '#7df9ff' }));
    this.closedTex = canvasTexture(640, 200, (c, w, h) => drawLabel(c, w, h, ['PORTAL OFFLINE', 'out of office: touching grass'], { bg: '#241212', fg: '#ffd0d0', accent: '#ff6b6b' }));
    this.signMat = new THREE.MeshStandardMaterial({ map: this.openTex, emissive: new THREE.Color(0xffffff), emissiveMap: this.openTex, emissiveIntensity: 0.6 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), this.signMat);
    sign.position.set(0, H + R + 0.9, 0);
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.1, 0.08), standMat);
    signBack.position.set(0, H + R + 0.9, -0.05);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), standMat);
    pole.position.set(0, H + R + 0.2, -0.05);

    this.group.add(ring, ...legs, plinth, this.disc, sign, signBack, pole);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = m !== this.disc;
        m.receiveShadow = true;
      }
    });
    this.group.name = 'PromptPortal';
    markOwned(this.group);
    game.scene.add(this.group);
    // colliders: legs + plinth (the ring itself is walk-through, it's a portal)
    for (const s of [-1, 1]) {
      const p = new THREE.Vector3(s * R * 0.75, (H - R * 0.6) / 2, 0).applyQuaternion(q).add(base);
      world.collider(p, new THREE.Vector3(0.3, H - R * 0.6, 0.5), yaw);
    }
    world.collider(base.clone().add(new THREE.Vector3(0, 0.15, 0)), new THREE.Vector3(R * 2.4, 0.3, 1.4), yaw);
  }

  /** Ground point just in front of the portal where new slop steps out. */
  spawnPoint(out = new THREE.Vector3()) {
    out.copy(this.center).addScaledVector(this.facing, 2.2);
    out.y = terrainY(this.game, out.x, out.z);
    return out;
  }

  flash() {
    this.flashT = 1;
    this.fx.burst(this.center, 40, 0x7df9ff, 6, 2, 0.9, 6, 1.2);
    this.fx.burst(this.center, 25, 0xff6bd6, 5, 2, 0.9, 6, 1.2);
    this.game.sfx('slop_glitch', this.center, 0.9, 0.7);
  }

  setOpen(on: boolean) {
    this.openTarget = on ? 1 : 0;
    this.signMat.map = on ? this.openTex : this.closedTex;
    this.signMat.emissiveMap = this.signMat.map;
    this.signMat.needsUpdate = true;
    if (!on) {
      this.fx.burst(this.center, 60, 0xff4040, 5, 1, 0.8, 8, 1.5);
      this.game.sfx('slop_glitch', this.center, 1, 0.5);
    } else this.flash();
  }

  get isOpen() {
    return this.openTarget > 0.5;
  }

  update(dt: number) {
    const u = this.discMat.uniforms;
    u.uTime.value = this.game.time;
    this.open += (this.openTarget - this.open) * (1 - Math.exp(-dt * 2.5));
    u.uOpen.value = this.open;
    this.disc.visible = this.open > 0.02;
    this.flashT = Math.max(0, this.flashT - dt * 1.5);
    u.uFlash.value = this.flashT;
    this.ringMat.emissiveIntensity = 0.1 + this.open * (1.3 + Math.sin(this.game.time * 3) * 0.3) + this.flashT * 2;
    if (this.open > 0.5) {
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.35;
        const a = Math.random() * Math.PI * 2;
        const p = this.center.clone().add(new THREE.Vector3(Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0).applyQuaternion(this.group.quaternion));
        this.fx.burst(p, 2, Math.random() < 0.5 ? 0x7df9ff : 0xff6bd6, 1.2, 0.5, 0.7, 1, 0.05);
      }
    }
  }
}
