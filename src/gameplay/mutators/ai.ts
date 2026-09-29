import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { JimothyModel } from '../../player/JimothyModel';
import { headAnchors, isOurs, markOurs, modelParts } from './accessories';
import { makeLabelSprite, disposeSprite, Shape } from './fx';
import { sharedFx } from './shared';
import { getPlayer, PLAYER_R, type ModelMods, type MutatorImpl } from './types';

const OVERLAY_VERT = /* glsl */ `
uniform float uPush;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  vec3 p = position + normal * uPush;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const OVERLAY_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float hue = fract(f * 0.9 + uTime * 0.18 + vW.y * 1.6 + vW.x * 0.7 + vW.z * 0.4);
  vec3 col = hsv2rgb(vec3(hue, 0.7, 1.0));
  float scan = step(0.9, fract(vW.y * 16.0 - uTime * 2.2)) * 0.22;
  float a = (0.07 + f * 0.85 + scan) * uIntensity;
  gl_FragColor = vec4(col * a, 1.0);
}`;

const SLOP_LINES = [
  '(generated)',
  'Enhanced by AI™',
  '✨ AI Jimothy ✨',
  '[image may contain: raccoon]',
  'Certainly! Here is a raccoon:',
  '(generated)',
  '97% raccoon',
  'legs: approximately 7',
];

interface Leg {
  g: THREE.Group;
  base: THREE.Euler;
  f1: number;
  f2: number;
  ph: number;
}

export function aiEnhanced(): MutatorImpl {
  let overlayMat: THREE.ShaderMaterial | null = null;
  const overlays: THREE.Mesh[] = [];
  const legs: Leg[] = [];
  let eye: THREE.Group | null = null;
  let appliedTo: THREE.Object3D | null = null;
  let legMats: THREE.Material[] = [];
  let legGeos: THREE.BufferGeometry[] = [];
  let label: THREE.Sprite | null = null;
  let labelT = 0;
  let nextLabel = 2;
  let nextGlitch = 1;
  let glitch: { kind: number; t: number; dur: number; a: THREE.Vector3; hidden?: THREE.Object3D } | null = null;
  let blinkT = 0;

  function clearModel() {
    for (const o of overlays) o.removeFromParent();
    overlays.length = 0;
    for (const l of legs) l.g.removeFromParent();
    legs.length = 0;
    eye?.removeFromParent();
    eye = null;
    for (const m of legMats) m.dispose();
    for (const g of legGeos) g.dispose();
    legMats = [];
    legGeos = [];
    if (glitch?.hidden) glitch.hidden.visible = true;
    glitch = null;
    appliedTo = null;
  }

  function applyModel(model: JimothyModel) {
    const child = model.pivot.children[0];
    if (!child || !overlayMat) return;
    appliedTo = child;
    // iridescent "enhanced" sheen over every base mesh
    const targets: THREE.Mesh[] = [];
    const walk = (o: THREE.Object3D) => {
      if (isOurs(o)) return;
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as any).isSkinnedMesh && m.geometry?.getAttribute('normal')) targets.push(m);
      for (const c of o.children) walk(c);
    };
    walk(child);
    for (const m of targets) {
      const ov = new THREE.Mesh(m.geometry, overlayMat);
      ov.renderOrder = 6;
      ov.castShadow = false;
      ov.receiveShadow = false;
      markOurs(ov);
      m.add(ov);
      overlays.push(ov);
    }
    const parts = modelParts(model);
    const body = parts.Body;
    const a = headAnchors(model);
    const s = a?.scale ?? 1;
    if (body) {
      const fur = new THREE.MeshStandardMaterial({ color: 0x8e877e, roughness: 0.95 });
      const paw = new THREE.MeshStandardMaterial({ color: 0x241f1c, roughness: 0.8 });
      legMats = [fur, paw];
      const legGeo = new THREE.CapsuleGeometry(0.052 * s, 0.13 * s, 4, 10);
      const pawGeo = new THREE.SphereGeometry(0.056 * s, 12, 8);
      legGeos = [legGeo, pawGeo];
      const specs: [number, number, number, number, number, number][] = [
        // x, y, z, rotX, rotZ, length scale
        [0.3, -0.1, 0.06, 0.1, 0.95, 1],
        [-0.29, -0.02, -0.08, -0.2, -1.2, 0.8],
        [0.12, 0.27, -0.2, 2.35, 0.2, 1.1],
      ];
      specs.forEach(([x, y, z, rx, rz, len], i) => {
        const g = new THREE.Group();
        g.position.set(x * s, y * s, z * s);
        const leg = new THREE.Mesh(legGeo, fur);
        leg.position.y = -0.1 * s * len;
        leg.scale.set(1, len, 1);
        const p = new THREE.Mesh(pawGeo, paw);
        p.position.y = -0.2 * s * len;
        p.scale.set(1.1, 0.6, 1.35);
        g.add(leg, p);
        g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
        markOurs(g);
        body.add(g);
        const base = new THREE.Euler(rx, 0, rz);
        g.rotation.copy(base);
        legs.push({ g, base, f1: 7 + i * 2.3, f2: 9.5 - i * 1.7, ph: i * 1.9 });
        // overlay on the extra legs too
        for (const mesh of [leg]) {
          const ov = new THREE.Mesh(mesh.geometry, overlayMat!);
          ov.renderOrder = 6;
          markOurs(ov);
          mesh.add(ov);
          overlays.push(ov);
        }
      });
    }
    // a third eye in the middle of the forehead
    const head = parts.Head;
    if (head && a) {
      const e = new THREE.Group();
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(a.eyeR * 0.85, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.08, metalness: 0.2 }),
      );
      const hl = new THREE.Mesh(new THREE.SphereGeometry(a.eyeR * 0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      hl.position.set(a.eyeR * 0.3, a.eyeR * 0.35, a.eyeR * 0.65);
      e.add(ball, hl);
      // find the forehead surface by casting backwards from in front of the face
      const y = a.eyeMid.y + a.eyeSep * 0.55;
      head.updateWorldMatrix(true, true);
      const from = head.localToWorld(new THREE.Vector3(0, y, a.eyeMid.z + 1));
      const to = head.localToWorld(new THREE.Vector3(0, y, a.eyeMid.z - 1));
      const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0, 2 * head.getWorldScale(new THREE.Vector3()).x + 2);
      const hit = ray.intersectObject(head, true).find((h) => !isOurs(h.object));
      const z = hit ? head.worldToLocal(hit.point.clone()).z : a.eyeMid.z;
      e.position.set(0, y, z - a.eyeR * 0.35);
      markOurs(e);
      e.userData.ownsResources = true;
      head.add(e);
      eye = e;
    }
  }

  function removeEye() {
    if (!eye) return;
    eye.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    eye.removeFromParent();
    eye = null;
  }

  return {
    def: {
      id: 'aiEnhanced',
      name: 'AI Enhanced',
      desc: 'Enhanced by AI™. Now with 75% more legs, a bonus eye and a shimmer nobody asked for.',
      unlockHint: "Complete 'Touch Grass' (unplug SlopCorp).",
    },
    enable(game) {
      overlayMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 }, uPush: { value: 0.028 } },
        vertexShader: OVERLAY_VERT,
        fragmentShader: OVERLAY_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      nextLabel = 1.5;
      nextGlitch = 0.8;
      game.hint('AI Enhanced™: now with 75% more legs. Results may vary. Always check the leg count.', 3.5);
      game.sfx('slop_glitch', undefined, 0.6);
    },
    disable() {
      removeEye();
      clearModel();
      overlayMat?.dispose();
      overlayMat = null;
      if (label) disposeSprite(label);
      label = null;
    },
    post(game, dt, mods: ModelMods) {
      const p = getPlayer(game);
      if (!p || !overlayMat) return;
      const child = p.model.pivot.children[0];
      if (child !== appliedTo) {
        removeEye();
        clearModel();
        applyModel(p.model);
      }
      const t = game.time;
      overlayMat.uniforms.uTime.value = t;
      overlayMat.uniforms.uIntensity.value = 1;
      // wobbly legs (the "AI walk cycle")
      const moving = Math.min(1, p.speed / 3);
      for (const l of legs) {
        l.g.rotation.set(
          l.base.x + Math.sin(t * l.f1 + l.ph) * (0.35 + moving * 0.5),
          Math.sin(t * 3.1 + l.ph) * 0.3,
          l.base.z + Math.sin(t * l.f2 + l.ph * 2) * (0.3 + moving * 0.3),
        );
      }
      // third eye blinks out of sync with the others
      if (eye) {
        blinkT -= dt;
        let sy = 1;
        if (blinkT < 0) {
          sy = 0.1;
          if (blinkT < -0.14) blinkT = 1.2 + Math.random() * 3.5;
        }
        eye.scale.set(1, sy, 1);
      }
      // glitches
      nextGlitch -= dt;
      if (!glitch && nextGlitch <= 0) {
        const kind = Math.floor(Math.random() * 4);
        glitch = {
          kind,
          t: 0,
          dur: 0.06 + Math.random() * 0.14,
          a: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5),
        };
        if (kind === 2 && overlays.length) {
          const victims = [...legs.map((l) => l.g as THREE.Object3D), ...(eye ? [eye] : [])];
          const parts = modelParts(p.model);
          for (const n of ['EarL', 'EarR', 'Tail3', 'ArmL', 'LegR']) if (parts[n]) victims.push(parts[n]!);
          const v = victims[Math.floor(Math.random() * victims.length)];
          if (v) {
            v.visible = false;
            glitch.hidden = v;
          }
        }
        nextGlitch = 0.4 + Math.random() * 2;
        const fx = sharedFx(game);
        const c = p.position.clone();
        c.y += PLAYER_R * (p.sizeMul - 1);
        const cols = [0xff2bd6, 0x2bfff1, 0xb6ff3b, 0x7a5cff];
        for (let i = 0; i < 7; i++) {
          const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
          fx.glow.spawn(c.clone().addScaledVector(d, PLAYER_R * p.sizeMul * (0.8 + Math.random() * 0.5)), d.multiplyScalar(0.4), cols[i % 4], 0.07 * p.sizeMul + 0.03, 0.25 + Math.random() * 0.2, { shape: Shape.Square });
        }
        if (Math.random() < 0.3) game.sfx('slop_glitch', p.position, 0.25, 1.4);
      }
      if (glitch) {
        glitch.t += dt;
        const g = glitch;
        if (g.kind === 0) mods.offset.addScaledVector(g.a, 0.12);
        else if (g.kind === 1) mods.scale.multiply(new THREE.Vector3(1 + g.a.x * 0.5, 1 + g.a.y * 0.4, 1 + g.a.z * 0.5));
        else if (g.kind === 3) {
          overlayMat.uniforms.uIntensity.value = 3.2;
          mods.rot.y += g.a.y * 0.5;
        }
        if (g.t >= g.dur) {
          if (g.hidden) g.hidden.visible = true;
          glitch = null;
        }
      }
      // occasional "(generated)" caption
      nextLabel -= dt;
      if (!label && nextLabel <= 0) {
        label = makeLabelSprite(SLOP_LINES[Math.floor(Math.random() * SLOP_LINES.length)], {
          height: 0.2,
          color: '#2b2b33',
          bg: 'rgba(255,255,255,0.88)',
          border: '#b79cff',
          italic: true,
        });
        game.scene.add(label);
        labelT = 0;
      }
      if (label) {
        labelT += dt;
        const top = PLAYER_R * (2 * p.sizeMul - 1) + 0.45;
        label.position.set(p.position.x, p.position.y + top + Math.sin(labelT * 3) * 0.03, p.position.z);
        const k = labelT < 0.15 ? labelT / 0.15 : labelT > 2.1 ? Math.max(0, 1 - (labelT - 2.1) / 0.3) : 1;
        label.material.opacity = k * (Math.random() < 0.04 ? 0.3 : 1);
        if (labelT > 2.4) {
          disposeSprite(label);
          label = null;
          nextLabel = 6 + Math.random() * 9;
        }
      }
    },
  };
}
