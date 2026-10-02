import * as THREE from 'three';
import { T, TR, paintMesh, paintMat, mergeParts, type Part } from '../shared';

/**
 * Geometry for the alien landing: a chunky toy flying saucer and the little green trash enthusiasts.
 * Everything is merged vertex-coloured geometry (the shared paint material) + a few tiny glow materials.
 *
 * Saucer local frame: origin = ground centre under the ship, +Z = the ramp side.
 */

/** Disc radius / heights (saucer-local, metres). */
export const DISC_R = 4.5;
export const DISC_Y = 3.2;
export const DISC_BOTTOM = 2.62;
export const DISC_HALF = 0.62;
/** Hatch (top of the ramp) and the ramp foot on the ground. */
export const HATCH = new THREE.Vector3(0, DISC_BOTTOM, 1.1);
export const RAMP_FOOT = new THREE.Vector3(0, 0.04, 5.5);
export const LEG_R = 3.25;

export interface SaucerParts {
  root: THREE.Group;
  /** Wobble / tilt group (everything visual). */
  body: THREE.Group;
  legs: THREE.Group;
  ramp: THREE.Group;
  hatch: THREE.Mesh;
  lightsA: THREE.MeshBasicMaterial;
  lightsB: THREE.MeshBasicMaterial;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  /** Thin beam that lifts items (positioned per use). */
  itemBeam: THREE.Mesh;
  pilotGlow: THREE.MeshBasicMaterial;
  dispose(): void;
}

function glow(r: number, g: number, b: number) {
  const m = new THREE.MeshBasicMaterial({ toneMapped: false });
  m.color.setRGB(r, g, b);
  return m;
}

/** Vertical gradient + soft stripes for the tractor beams (alpha via the texture's luminance on additive blending). */
function beamTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(200,200,200,0.75)');
  g.addColorStop(1, 'rgba(60,60,60,0.25)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 128);
  // horizontal rings (scroll down the beam)
  x.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 128; i += 16) {
    x.fillStyle = 'rgba(120,120,120,1)';
    x.fillRect(0, i, 64, 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let sharedBeamTex: THREE.CanvasTexture | null = null;

export function buildSaucer(): SaucerParts {
  const root = new THREE.Group();
  root.name = 'ufo';
  const body = new THREE.Group();
  root.add(body);

  const silver = 0xd8dfea;
  const silver2 = 0xaab6c8;
  const teal = 0x25c2b0;
  const yellow = 0xffc23a;
  const dark = 0x3b4252;
  const parts: Part[] = [
    // lower bowl, upper bowl, chunky rim
    { g: new THREE.CylinderGeometry(DISC_R, 2.9, 0.62, 44), c: silver2, m: T(0, DISC_Y - 0.31, 0) },
    { g: new THREE.CylinderGeometry(3.1, DISC_R, 0.6, 44), c: silver, m: T(0, DISC_Y + 0.3, 0) },
    { g: new THREE.TorusGeometry(DISC_R, 0.2, 8, 48).rotateX(Math.PI / 2), c: teal, m: T(0, DISC_Y, 0) },
    { g: new THREE.CylinderGeometry(3.15, 3.15, 0.12, 44), c: yellow, m: T(0, DISC_Y + 0.62, 0) },
    // underside hub ring around the hatch + engine glow housing
    { g: new THREE.CylinderGeometry(2.9, 2.9, 0.08, 40), c: dark, m: T(0, DISC_BOTTOM + 0.02, 0) },
    // dome base collar
    { g: new THREE.TorusGeometry(2.05, 0.16, 8, 36).rotateX(Math.PI / 2), c: silver2, m: T(0, DISC_Y + 0.7, 0) },
    // little antenna on the dome
    { g: new THREE.CylinderGeometry(0.04, 0.06, 0.8, 8), c: silver2, m: T(0, DISC_Y + 3.0, 0) },
    // pilot (sits in the dome): green blob with three eyes, staring at the town
    { g: new THREE.SphereGeometry(0.62, 16, 12), c: 0x7bd94a, m: TR(0, DISC_Y + 1.25, 0, 0, 0, 0, [1, 0.9, 1]) },
    { g: new THREE.CylinderGeometry(0.4, 0.5, 0.5, 14), c: 0x5bbf3a, m: T(0, DISC_Y + 0.85, 0) },
  ];
  for (const [ex, ey] of [[-0.24, 1.32], [0, 1.42], [0.24, 1.32]] as const) {
    parts.push({ g: new THREE.SphereGeometry(0.12, 10, 8), c: 0x15151c, m: T(ex, DISC_Y + ey, 0.5) });
    parts.push({ g: new THREE.SphereGeometry(0.04, 6, 4), c: 0xffffff, m: T(ex + 0.04, DISC_Y + ey + 0.05, 0.6) });
  }
  // portholes around the upper bowl
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    parts.push({ g: new THREE.CylinderGeometry(0.2, 0.2, 0.08, 12).rotateX(Math.PI / 2), c: 0x27303f, m: TR(Math.sin(a) * 3.85, DISC_Y + 0.3, Math.cos(a) * 3.85, -0.6, a, 0) });
  }
  const hull = paintMesh(parts);
  body.add(hull);

  // glass dome
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.0, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.position.y = DISC_Y + 0.66;
  dome.renderOrder = 2;
  body.add(dome);

  // blinking rim lights (two alternating sets) + antenna tip
  const lightsA = glow(2.4, 2.0, 0.6);
  const lightsB = glow(0.6, 2.4, 1.8);
  const la: Part[] = [];
  const lb: Part[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    (i % 2 ? lb : la).push({ g: new THREE.SphereGeometry(0.17, 8, 6), c: 0xffffff, m: T(Math.sin(a) * (DISC_R + 0.16), DISC_Y, Math.cos(a) * (DISC_R + 0.16)) });
  }
  la.push({ g: new THREE.SphereGeometry(0.14, 8, 6), c: 0xffffff, m: T(0, DISC_Y + 3.45, 0) });
  const mA = new THREE.Mesh(mergeParts(la), lightsA);
  const mB = new THREE.Mesh(mergeParts(lb), lightsB);
  body.add(mA, mB);
  // engine glow under the hull
  const pilotGlow = glow(0.5, 1.6, 1.2);
  const under = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.6, 36).rotateX(Math.PI / 2), pilotGlow);
  under.position.y = DISC_BOTTOM - 0.01;
  body.add(under);

  // hatch door (drops open)
  const hatch = new THREE.Mesh(
    mergeParts([{ g: new THREE.CylinderGeometry(0.85, 0.85, 0.08, 20), c: 0x56607a }]),
    hull.material,
  );
  hatch.position.copy(HATCH).setY(DISC_BOTTOM - 0.02);
  body.add(hatch);

  // landing legs (scale.y 0.1 = tucked)
  const legs = new THREE.Group();
  legs.position.y = DISC_BOTTOM;
  const lp: Part[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const top = new THREE.Vector3(s * 2.6, 0.05, c * 2.6);
    const foot = new THREE.Vector3(s * LEG_R, -DISC_BOTTOM + 0.12, c * LEG_R);
    const d = foot.clone().sub(top);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    lp.push({ g: new THREE.CylinderGeometry(0.11, 0.14, len, 10), c: silver2, m: new THREE.Matrix4().compose(top.clone().lerp(foot, 0.5), q, new THREE.Vector3(1, 1, 1)) });
    lp.push({ g: new THREE.CylinderGeometry(0.42, 0.5, 0.14, 14), c: teal, m: T(foot.x, foot.y - 0.05, foot.z) });
  }
  legs.add(paintMesh(lp));
  legs.scale.y = 0.1;
  root.add(legs);

  // telescoping ramp: pivot at the hatch, local +Z runs down the slope; scale.z grows when it extends
  const ramp = new THREE.Group();
  ramp.position.copy(HATCH);
  const d = RAMP_FOOT.clone().sub(HATCH);
  ramp.rotation.x = Math.atan2(-d.y, d.z);
  const L = d.length();
  ramp.add(
    paintMesh([
      { g: new THREE.BoxGeometry(1.5, 0.1, L), c: 0xc9d1dd, m: T(0, -0.05, L / 2) },
      { g: new THREE.BoxGeometry(0.1, 0.18, L), c: teal, m: T(-0.75, 0.0, L / 2) },
      { g: new THREE.BoxGeometry(0.1, 0.18, L), c: teal, m: T(0.75, 0.0, L / 2) },
      ...[0.2, 0.4, 0.6, 0.8].map((f) => ({ g: new THREE.BoxGeometry(1.3, 0.04, 0.12), c: yellow, m: T(0, 0.01, L * f) })),
    ]),
  );
  ramp.scale.z = 0.01;
  ramp.visible = false;
  root.add(ramp);

  // tractor beam (cone, additive, no light)
  if (!sharedBeamTex) sharedBeamTex = beamTexture();
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x8dffb8,
    map: sharedBeamTex,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  // unit-height cone hanging down from y = 0 (scale.y = length)
  const beamGeo = new THREE.CylinderGeometry(1.2, 3.3, 1, 32, 1, true).translate(0, -0.5, 0);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = DISC_BOTTOM;
  beam.visible = false;
  beam.renderOrder = 3;
  beam.castShadow = false;
  root.add(beam);

  const itemBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 1, 16, 1, true).translate(0, -0.5, 0), beamMat);
  itemBeam.visible = false;
  itemBeam.renderOrder = 3;
  itemBeam.castShadow = false;

  return {
    root,
    body,
    legs,
    ramp,
    hatch,
    lightsA,
    lightsB,
    beam,
    beamMat,
    itemBeam,
    pilotGlow,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      itemBeam.geometry.dispose();
      glass.dispose();
      lightsA.dispose();
      lightsB.dispose();
      pilotGlow.dispose();
      beamMat.dispose();
    },
  };
}

export const RAMP_LEN = RAMP_FOOT.clone().sub(HATCH).length();

// ------------------------------------------------------------------------------------------------ aliens

export interface AlienModel {
  root: THREE.Group;
  /** Tumble / bow / waddle pivot (at the feet). */
  pivot: THREE.Group;
  tips: THREE.MeshBasicMaterial;
}

let alienGeo: THREE.BufferGeometry[] = [];
let tipGeo: THREE.BufferGeometry | null = null;
const SKINS = [0x7bd94a, 0x5fd38a, 0xa6e34f];
const SUITS = [0xb48cff, 0xff8fb8, 0x6fc8ff];

/** One little green alien (≈1.1 m tall incl. antennae; Jimothy is 0.7 m). Feet at y = 0, facing +Z. */
export function buildAlien(i: number): AlienModel {
  const k = i % 3;
  if (!alienGeo[k]) {
    const skin = SKINS[k];
    const suit = SUITS[k];
    const s = 0.82;
    const p: Part[] = [
      // feet + stubby legs
      { g: new THREE.SphereGeometry(0.09, 10, 6), c: 0x2a2f3a, m: TR(-0.1, 0.05, 0.03, 0, 0, 0, [1, 0.6, 1.4]) },
      { g: new THREE.SphereGeometry(0.09, 10, 6), c: 0x2a2f3a, m: TR(0.1, 0.05, 0.03, 0, 0, 0, [1, 0.6, 1.4]) },
      { g: new THREE.CylinderGeometry(0.06, 0.07, 0.18, 8), c: skin, m: T(-0.1, 0.15, 0) },
      { g: new THREE.CylinderGeometry(0.06, 0.07, 0.18, 8), c: skin, m: T(0.1, 0.15, 0) },
      // pear body in a little space suit
      { g: new THREE.SphereGeometry(0.23, 16, 12), c: suit, m: TR(0, 0.38, 0, 0, 0, 0, [1, 1.12, 0.92]) },
      { g: new THREE.TorusGeometry(0.2, 0.035, 6, 18).rotateX(Math.PI / 2), c: 0xffd23f, m: T(0, 0.36, 0) },
      { g: new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10).rotateX(Math.PI / 2), c: 0xffd23f, m: T(0, 0.46, 0.2) },
      // arms (mitten hands)
      { g: new THREE.CylinderGeometry(0.045, 0.05, 0.24, 8), c: suit, m: TR(-0.25, 0.43, 0.02, 0, 0, -0.75) },
      { g: new THREE.CylinderGeometry(0.045, 0.05, 0.24, 8), c: suit, m: TR(0.25, 0.43, 0.02, 0, 0, 0.75) },
      { g: new THREE.SphereGeometry(0.06, 8, 6), c: skin, m: T(-0.34, 0.34, 0.03) },
      { g: new THREE.SphereGeometry(0.06, 8, 6), c: skin, m: T(0.34, 0.34, 0.03) },
      // big head
      { g: new THREE.SphereGeometry(0.31, 20, 14), c: skin, m: TR(0, 0.84, 0, 0, 0, 0, [1.12, 0.94, 1]) },
      // smile
      { g: new THREE.TorusGeometry(0.07, 0.016, 6, 12, Math.PI), c: 0x234a1a, m: TR(0, 0.72, 0.28, Math.PI, 0, 0) },
      // antennae
      { g: new THREE.CylinderGeometry(0.018, 0.022, 0.3, 6), c: skin, m: TR(-0.12, 1.2, 0, 0, 0, 0.35) },
      { g: new THREE.CylinderGeometry(0.018, 0.022, 0.3, 6), c: skin, m: TR(0.12, 1.2, 0, 0, 0, -0.35) },
    ];
    // three eyes
    for (const [ex, ey, r] of [[-0.13, 0.88, 0.075], [0, 0.97, 0.085], [0.13, 0.88, 0.075]] as const) {
      p.push({ g: new THREE.SphereGeometry(r, 12, 8), c: 0xffffff, m: T(ex, ey, 0.25) });
      p.push({ g: new THREE.SphereGeometry(r * 0.62, 10, 6), c: 0x111118, m: T(ex, ey, 0.25 + r * 0.55) });
      p.push({ g: new THREE.SphereGeometry(r * 0.2, 6, 4), c: 0xffffff, m: T(ex + r * 0.2, ey + r * 0.25, 0.25 + r * 0.98) });
    }
    const g = mergeParts(p);
    g.scale(s, s, s);
    alienGeo[k] = g;
  }
  if (!tipGeo) {
    const s = 0.82;
    tipGeo = mergeParts([
      { g: new THREE.SphereGeometry(0.065, 10, 6), c: 0xffffff, m: T(-0.175, 1.34, 0) },
      { g: new THREE.SphereGeometry(0.065, 10, 6), c: 0xffffff, m: T(0.175, 1.34, 0) },
    ]);
    tipGeo.scale(s, s, s);
  }
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const body = new THREE.Mesh(alienGeo[k], paintMat());
  body.castShadow = true;
  body.receiveShadow = true;
  pivot.add(body);
  const tips = glow(...([[2.2, 2.6, 0.5], [0.6, 2.6, 2.0], [2.6, 0.9, 2.2]][k] as [number, number, number]));
  const t = new THREE.Mesh(tipGeo, tips);
  pivot.add(t);
  return { root, pivot, tips };
}

export function disposeAlienShared() {
  for (const g of alienGeo) g?.dispose();
  alienGeo = [];
  tipGeo?.dispose();
  tipGeo = null;
}
