import * as THREE from 'three';

/**
 * Stand-in chunky toy human used by the landmark events when the NPC system isn't available
 * (or for bespoke costumes like the salmon racers). Feet at y = 0, faces +Z.
 */
export interface Outfit {
  skin: number;
  shirt: number;
  pants: number;
  shoes: number;
  hair?: number;
  hat?: 'mortarboard' | 'tophat' | 'cap' | 'none';
  hatColor?: number;
  /** Long robe (dean / students). */
  gown?: number;
  /** Diagonal sash (mayor). */
  sash?: number;
  /** Apron (fishmonger). */
  apron?: number;
  /** Full-body salmon costume (Salmon Run racers). */
  salmon?: number;
  /** Print a tiny raccoon on the shirt (fans). */
  jimothyTee?: boolean;
  scale?: number;
}

const SKINS = [0xf1c7a5, 0xd9a47e, 0xb77b55, 0x8d5a3c, 0x5e3a26, 0xf5d6c0];
const HAIRS = [0x2b1d14, 0x5a3a22, 0x9a6a3a, 0xd9b36b, 0x1a1a1a, 0x8a8a8a, 0xb5482a];
const SHIRTS = [0x3d7dd8, 0xd8453d, 0x2fa35a, 0xf2b632, 0x8a4fd1, 0xef7fb0, 0x2a9fb0, 0xffffff];
const PANTS = [0x2d3a55, 0x3b3b3b, 0x6b5b45, 0x1f4d7a, 0x55624a];

export function randomOutfit(rand = Math.random): Outfit {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  return { skin: pick(SKINS), hair: pick(HAIRS), shirt: pick(SHIRTS), pants: pick(PANTS), shoes: 0x2a2a2a };
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function m(color: number, opts: { rough?: number; metal?: number; emissive?: number; double?: boolean } = {}) {
  const key = `${color}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.emissive ?? 0}|${opts.double ? 2 : 1}`;
  let mat = matCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0,
      side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (opts.emissive) {
      mat.emissive = new THREE.Color(opts.emissive);
      mat.emissiveIntensity = 0.6;
    }
    matCache.set(key, mat);
  }
  return mat;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g as T;
}

function mesh(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const me = new THREE.Mesh(g, mat);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}

let teeTex: THREE.CanvasTexture | null = null;
function jimothyTeeTexture() {
  if (teeTex) return teeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#6d6259';
  ctx.beginPath();
  ctx.arc(32, 34, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1d1a18';
  ctx.fillRect(16, 28, 32, 8);
  ctx.fillStyle = '#fff';
  ctx.fillRect(22, 30, 4, 4);
  ctx.fillRect(38, 30, 4, 4);
  teeTex = new THREE.CanvasTexture(c);
  teeTex.colorSpace = THREE.SRGBColorSpace;
  return teeTex;
}

export class Figure {
  readonly root = new THREE.Group();
  /** Everything above the feet; bobbed for hops. */
  readonly body = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly head = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  /** Where held props attach (right hand). */
  readonly handR = new THREE.Group();
  readonly height: number;
  private phase = Math.random() * 10;
  private cheerT = 0;
  private talkT = 0;
  private flail = 0;
  private armsUp = 0;
  private throwT = -1;

  constructor(readonly outfit: Outfit) {
    const s = outfit.scale ?? 1;
    this.height = 1.75 * s;
    this.root.add(this.body);
    this.body.scale.setScalar(s);
    this.body.add(this.hips);
    this.hips.position.y = 0.86;

    const pantsM = m(outfit.pants);
    const shoeM = m(outfit.shoes, { rough: 0.6 });
    const skinM = m(outfit.skin, { rough: 0.7 });
    const shirtM = m(outfit.shirt);
    // legs
    for (const [leg, x] of [
      [this.legL, 0.12],
      [this.legR, -0.12],
    ] as [THREE.Group, number][]) {
      leg.position.set(x, 0, 0);
      this.hips.add(leg);
      leg.add(mesh(geo('leg', () => new THREE.BoxGeometry(0.17, 0.78, 0.2)), pantsM, 0, -0.39, 0));
      leg.add(mesh(geo('shoe', () => new THREE.BoxGeometry(0.19, 0.1, 0.3)), shoeM, 0, -0.81, 0.05));
    }
    // torso
    this.hips.add(this.torso);
    const torsoGeo = geo('torso', () => new THREE.CapsuleGeometry(0.25, 0.32, 4, 12).scale(1, 1, 0.68));
    const torsoMesh = mesh(torsoGeo, shirtM, 0, 0.33, 0);
    this.torso.add(torsoMesh);
    if (outfit.jimothyTee) {
      const print = new THREE.Mesh(
        geo('teeprint', () => new THREE.PlaneGeometry(0.24, 0.24)),
        new THREE.MeshStandardMaterial({ map: jimothyTeeTexture(), roughness: 0.9 }),
      );
      print.position.set(0, 0.36, 0.172);
      this.torso.add(print);
    }
    if (outfit.gown != null) {
      const gownM = m(outfit.gown, { rough: 0.85 });
      const gown = mesh(geo('gown', () => new THREE.CylinderGeometry(0.3, 0.42, 1.18, 14, 1, true)), m(outfit.gown, { rough: 0.85, double: true }), 0, -0.08, 0);
      this.torso.add(gown);
      this.torso.add(mesh(geo('gownTop', () => new THREE.CylinderGeometry(0.27, 0.3, 0.1, 14)), gownM, 0, 0.53, 0));
    }
    if (outfit.sash != null) {
      const sash = mesh(geo('sash', () => new THREE.BoxGeometry(0.1, 0.7, 0.4)), m(outfit.sash, { rough: 0.5 }), 0, 0.33, 0);
      sash.rotation.z = 0.75;
      sash.scale.set(1, 1, 0.95);
      this.torso.add(sash);
      // gold medallion
      this.torso.add(mesh(geo('medal', () => new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16).rotateX(Math.PI / 2)), m(0xf2c14e, { rough: 0.3, metal: 0.8 }), -0.08, 0.28, 0.19));
    }
    if (outfit.apron != null) {
      const apron = mesh(geo('apron', () => new THREE.BoxGeometry(0.44, 0.78, 0.04)), m(outfit.apron, { rough: 0.5 }), 0, 0.02, 0.19);
      this.torso.add(apron);
    }
    // arms
    for (const [arm, x] of [
      [this.armL, 0.33],
      [this.armR, -0.33],
    ] as [THREE.Group, number][]) {
      arm.position.set(x, 0.58, 0);
      this.torso.add(arm);
      arm.add(mesh(geo('arm', () => new THREE.CapsuleGeometry(0.07, 0.42, 3, 8)), outfit.gown != null ? m(outfit.gown) : shirtM, 0, -0.27, 0));
      arm.add(mesh(geo('hand', () => new THREE.SphereGeometry(0.075, 10, 8)), skinM, 0, -0.56, 0));
    }
    this.handR.position.set(0, -0.6, 0.04);
    this.armR.add(this.handR);
    // head
    this.head.position.set(0, 0.82, 0);
    this.torso.add(this.head);
    this.head.add(mesh(geo('neck', () => new THREE.CylinderGeometry(0.08, 0.09, 0.14, 10)), skinM, 0, -0.1, 0));
    this.head.add(mesh(geo('head', () => new THREE.SphereGeometry(0.2, 18, 14)), skinM, 0, 0.12, 0));
    const eyeM = m(0x151515, { rough: 0.3 });
    for (const x of [0.07, -0.07]) this.head.add(mesh(geo('eye', () => new THREE.SphereGeometry(0.026, 8, 6)), eyeM, x, 0.15, 0.18));
    this.head.add(mesh(geo('nose', () => new THREE.SphereGeometry(0.035, 8, 6)), skinM, 0, 0.1, 0.2));
    const mouth = mesh(geo('mouth', () => new THREE.BoxGeometry(0.08, 0.018, 0.02)), m(0x7a2b2b), 0, 0.04, 0.185);
    mouth.name = 'mouth';
    this.head.add(mouth);
    if (outfit.hair != null && outfit.hat !== 'tophat') {
      const hair = mesh(geo('hair', () => new THREE.SphereGeometry(0.212, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)), m(outfit.hair, { rough: 0.9 }), 0, 0.13, -0.01);
      this.head.add(hair);
    }
    this.addHat(outfit);
    if (outfit.salmon != null) this.addSalmonCostume(outfit.salmon);
  }

  private addHat(o: Outfit) {
    const hatM = m(o.hatColor ?? 0x1a1a1a, { rough: 0.6 });
    if (o.hat === 'mortarboard') {
      this.head.add(mesh(geo('mbCap', () => new THREE.CylinderGeometry(0.19, 0.2, 0.12, 14)), hatM, 0, 0.27, 0));
      const board = mesh(geo('mbBoard', () => new THREE.BoxGeometry(0.5, 0.03, 0.5)), hatM, 0, 0.34, 0);
      board.rotation.y = Math.PI / 4;
      this.head.add(board);
      const tassel = mesh(geo('tassel', () => new THREE.CylinderGeometry(0.012, 0.012, 0.2, 5)), m(0xf2c14e, { rough: 0.5 }), 0.2, 0.25, 0.05);
      this.head.add(tassel);
    } else if (o.hat === 'tophat') {
      this.head.add(mesh(geo('thBrim', () => new THREE.CylinderGeometry(0.3, 0.3, 0.03, 18)), hatM, 0, 0.29, 0));
      this.head.add(mesh(geo('thTop', () => new THREE.CylinderGeometry(0.19, 0.19, 0.34, 18)), hatM, 0, 0.46, 0));
      this.head.add(mesh(geo('thBand', () => new THREE.CylinderGeometry(0.195, 0.195, 0.06, 18)), m(0xb3262b), 0, 0.33, 0));
    } else if (o.hat === 'cap') {
      this.head.add(mesh(geo('capTop', () => new THREE.SphereGeometry(0.215, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), hatM, 0, 0.15, 0));
      const bill = mesh(geo('capBill', () => new THREE.BoxGeometry(0.28, 0.025, 0.2)), hatM, 0, 0.17, 0.2);
      this.head.add(bill);
    }
  }

  private addSalmonCostume(color: number) {
    const fishM = m(color, { rough: 0.55 });
    const bellyM = m(0xf6e3d0, { rough: 0.7 });
    const finM = m(0xb8404b, { rough: 0.6 });
    // big fish body covering torso + head, face hole at the front
    const bodyGeo = geo('salmonBody', () => new THREE.SphereGeometry(0.42, 22, 16).scale(0.95, 1.55, 0.85));
    const body = mesh(bodyGeo, fishM, 0, 0.55, -0.02);
    this.torso.add(body);
    const belly = mesh(geo('salmonBelly', () => new THREE.SphereGeometry(0.34, 18, 12).scale(0.9, 1.4, 0.6)), bellyM, 0, 0.42, 0.16);
    this.torso.add(belly);
    // tail fin on top (fish is "standing on its tail" upside down: mouth at bottom? no: head up, tail down behind)
    const tail = mesh(geo('salmonTail', () => new THREE.ConeGeometry(0.28, 0.42, 4).scale(1, 1, 0.25)), finM, 0, 1.2, -0.05);
    this.torso.add(tail);
    const dorsal = mesh(geo('salmonDorsal', () => new THREE.ConeGeometry(0.12, 0.3, 3).scale(0.3, 1, 1)), finM, 0, 0.7, -0.38);
    dorsal.rotation.x = -0.6;
    this.torso.add(dorsal);
    // spots
    const spotM = m(0x5a2a2a, { rough: 0.8 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 1.4 - Math.PI * 0.7 + Math.PI;
      const sp = mesh(geo('spot', () => new THREE.SphereGeometry(0.03, 6, 4)), spotM, Math.sin(a) * 0.38, 0.75 + (i % 3) * 0.14, Math.cos(a) * 0.33);
      this.torso.add(sp);
    }
    // big googly fish eyes above the face hole
    const eyeW = m(0xffffff, { rough: 0.3 });
    const eyeB = m(0x111111, { rough: 0.3 });
    for (const x of [0.17, -0.17]) {
      this.torso.add(mesh(geo('fishEye', () => new THREE.SphereGeometry(0.08, 12, 8)), eyeW, x, 1.02, 0.28));
      this.torso.add(mesh(geo('fishPupil', () => new THREE.SphereGeometry(0.04, 8, 6)), eyeB, x * 1.1, 1.03, 0.35));
    }
    // the wearer's face pokes out of the costume's face hole
    this.head.position.set(0, 0.68, 0.3);
    this.head.scale.setScalar(0.8);
  }

  /** Start a cheering hop (arms up) for `secs`. */
  cheer(secs = 1.6) {
    this.cheerT = Math.max(this.cheerT, secs);
  }
  talk(secs = 1.5) {
    this.talkT = Math.max(this.talkT, secs);
  }
  throwAnim() {
    this.throwT = 0;
  }
  /** Raise both arms (0..1) — e.g. mayor proclaiming. */
  setArmsUp(v: number) {
    this.armsUp = v;
  }

  /**
   * Animate. speed = ground speed (m/s). down = ragdolled (limbs flail).
   */
  animate(dt: number, speed: number, down = false) {
    const run = Math.min(1, speed / 6);
    this.phase += dt * (speed > 0.2 ? 3 + speed * 1.35 : 1.2);
    const p = this.phase;
    this.cheerT = Math.max(0, this.cheerT - dt);
    this.talkT = Math.max(0, this.talkT - dt);
    this.flail = down ? Math.min(1, this.flail + dt * 4) : Math.max(0, this.flail - dt * 3);
    const walkAmp = speed > 0.2 ? 0.35 + run * 0.55 : 0;
    let legSwing = Math.sin(p) * walkAmp;
    let armSwing = -Math.sin(p) * walkAmp * 0.9;
    let bob = speed > 0.2 ? Math.abs(Math.sin(p)) * 0.05 * (0.5 + run) : Math.sin(p * 0.9) * 0.008;
    let armLx = armSwing;
    let armRx = -armSwing;
    let armLz = 0.08;
    let armRz = -0.08;
    if (this.cheerT > 0 && speed < 0.5) {
      const k = Math.min(1, this.cheerT * 3);
      bob += Math.abs(Math.sin(this.cheerT * 9)) * 0.22 * k;
      armLx = -2.9 * k + Math.sin(this.cheerT * 18) * 0.25;
      armRx = -2.9 * k + Math.cos(this.cheerT * 18) * 0.25;
      armLz = 0.35 * k;
      armRz = -0.35 * k;
    } else if (this.armsUp > 0) {
      armLx = -2.6 * this.armsUp;
      armRx = -2.6 * this.armsUp;
      armLz = 0.3 * this.armsUp;
      armRz = -0.3 * this.armsUp;
    }
    if (this.throwT >= 0) {
      this.throwT += dt;
      const t = this.throwT;
      armRx = t < 0.35 ? -2.4 * (t / 0.35) : -2.4 + Math.min(1, (t - 0.35) / 0.15) * 3.2;
      if (t > 0.9) this.throwT = -1;
    }
    if (this.flail > 0) {
      const f = this.flail;
      const t = p * 3.1;
      legSwing = legSwing * (1 - f) + Math.sin(t) * 0.9 * f;
      armLx = armLx * (1 - f) + Math.sin(t * 1.3) * 1.6 * f;
      armRx = armRx * (1 - f) + Math.cos(t * 1.1) * 1.6 * f;
      armLz = armLz * (1 - f) + 1.1 * f;
      armRz = armRz * (1 - f) - 1.1 * f;
    }
    this.legL.rotation.x = legSwing;
    this.legR.rotation.x = -legSwing;
    this.armL.rotation.set(armLx, 0, armLz);
    this.armR.rotation.set(armRx, 0, armRz);
    this.body.position.y = bob;
    this.torso.rotation.x = run * 0.18;
    const talk = this.talkT > 0 ? Math.sin(this.talkT * 22) * 0.06 : 0;
    this.head.rotation.x = talk;
  }
}
