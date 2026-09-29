import * as THREE from 'three';

/**
 * Simple chunky stand-in humans (Grandma Rosie, the sad kid) used only when the NPC system isn't available.
 * Feet at y = 0, facing +Z. Expressions: neutral / happy / sad (with tears) / aww.
 */

export type FigureExpression = 'neutral' | 'happy' | 'sad' | 'aww';

export interface FigureOpts {
  height: number;
  skin: number;
  top: number;
  bottom: number;
  shoes: number;
  hair: number;
  grandma?: boolean;
  kid?: boolean;
}

export class Figure {
  readonly root = new THREE.Group();
  /** Hip pivot (sitting lowers / tilts this). */
  readonly hips = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly head = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly thighL = new THREE.Group();
  readonly thighR = new THREE.Group();
  readonly shinL = new THREE.Group();
  readonly shinR = new THREE.Group();
  /** Between the hands (hugging / holding a teddy). */
  readonly hold = new THREE.Group();
  readonly tears: THREE.Mesh[] = [];
  private faces: Record<string, THREE.Object3D[]> = {};
  expression: FigureExpression = 'neutral';
  readonly height: number;
  private tearT = 0;
  sitting = false;
  private rest = new Map<THREE.Object3D, THREE.Euler>();

  constructor(o: FigureOpts) {
    const H = o.height;
    this.height = H;
    const k = H / 1.7;
    const mat = (c: number, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const mesh = (g: THREE.BufferGeometry, mm: THREE.Material, x = 0, y = 0, z = 0) => {
      const me = new THREE.Mesh(g, mm);
      me.position.set(x, y, z);
      me.castShadow = true;
      me.receiveShadow = true;
      return me;
    };
    const skin = mat(o.skin, 0.7);
    const top = mat(o.top, 0.9);
    const bottom = mat(o.bottom, 0.85);
    const shoes = mat(o.shoes, 0.6);
    const hair = mat(o.hair, 0.95);
    const dark = mat(0x201814, 0.4);
    const hipY = 0.82 * k;
    this.root.add(this.hips);
    this.hips.position.y = hipY;
    // legs (thigh → knee → shin)
    for (const [thigh, shin, sx] of [
      [this.thighL, this.shinL, 1],
      [this.thighR, this.shinR, -1],
    ] as [THREE.Group, THREE.Group, number][]) {
      thigh.position.set(sx * 0.1 * k, 0, 0);
      this.hips.add(thigh);
      thigh.add(mesh(new THREE.CapsuleGeometry(0.075 * k, 0.28 * k, 4, 10), bottom, 0, -0.2 * k, 0));
      shin.position.set(0, -0.41 * k, 0);
      thigh.add(shin);
      shin.add(mesh(new THREE.CapsuleGeometry(0.065 * k, 0.26 * k, 4, 10), bottom, 0, -0.18 * k, 0));
      shin.add(mesh(new THREE.BoxGeometry(0.12 * k, 0.08 * k, 0.24 * k), shoes, 0, -0.37 * k, 0.05 * k));
    }
    // torso
    this.hips.add(this.torso);
    const body = mesh(new THREE.CapsuleGeometry(0.2 * k, 0.32 * k, 6, 14), top, 0, 0.3 * k, 0);
    body.scale.set(1, 1, 0.8);
    this.torso.add(body);
    // arms
    for (const [arm, sx] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as [THREE.Group, number][]) {
      arm.position.set(sx * 0.25 * k, 0.56 * k, 0);
      this.torso.add(arm);
      arm.add(mesh(new THREE.CapsuleGeometry(0.06 * k, 0.4 * k, 4, 10), top, 0, -0.24 * k, 0));
      arm.add(mesh(new THREE.SphereGeometry(0.065 * k, 10, 8), skin, 0, -0.5 * k, 0));
      arm.rotation.z = sx * 0.12;
    }
    this.hold.position.set(0, 0.28 * k, 0.26 * k);
    this.torso.add(this.hold);
    // head
    this.head.position.set(0, 0.78 * k, 0);
    this.torso.add(this.head);
    const headR = (o.kid ? 0.2 : 0.17) * k * (o.kid ? 1.15 : 1);
    this.head.add(mesh(new THREE.SphereGeometry(headR, 20, 16), skin, 0, headR, 0));
    // hair cap
    const cap = mesh(new THREE.SphereGeometry(headR * 1.04, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, headR * 1.02, -headR * 0.06);
    cap.rotation.x = -0.25;
    this.head.add(cap);
    if (o.grandma) {
      this.head.add(mesh(new THREE.SphereGeometry(headR * 0.45, 12, 10), hair, 0, headR * 1.9, -headR * 0.45));
      // glasses
      const gl = mat(0xb8a27a, 0.3);
      for (const sx of [-1, 1]) {
        const ring = mesh(new THREE.TorusGeometry(headR * 0.24, headR * 0.035, 6, 16), gl, sx * headR * 0.36, headR * 1.08, headR * 0.93);
        this.head.add(ring);
      }
      this.head.add(mesh(new THREE.BoxGeometry(headR * 0.25, headR * 0.05, headR * 0.05), gl, 0, headR * 1.1, headR * 0.98));
      // shawl
      const shawl = mesh(new THREE.TorusGeometry(0.2 * k, 0.07 * k, 8, 20), mat(0x7e9fd6, 0.95), 0, 0.62 * k, 0);
      shawl.rotation.x = Math.PI / 2;
      shawl.scale.set(1, 0.85, 1);
      this.torso.add(shawl);
    }
    // face features (swap per expression)
    const eyeY = headR * 1.08;
    const eyeZ = headR * 0.93;
    const eyeG = new THREE.SphereGeometry(headR * 0.1, 8, 6);
    const mkEyes = (squint: boolean) => {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const e = mesh(eyeG, dark, sx * headR * 0.36, eyeY, eyeZ);
        if (squint) e.scale.set(1.3, 0.35, 1);
        g.add(e);
      }
      return g;
    };
    const mouthArc = (smile: boolean, open = false) => {
      const t = new THREE.TorusGeometry(headR * 0.22, headR * 0.035, 6, 14, Math.PI * 0.8);
      const mm = mesh(t, open ? mat(0x8a2b2b, 0.6) : dark, 0, headR * (smile ? 0.72 : 0.6), headR * 0.95);
      mm.rotation.z = smile ? Math.PI + Math.PI * 0.1 : Math.PI * 0.1;
      return mm;
    };
    const brows = (sad: boolean) => {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const b = mesh(new THREE.BoxGeometry(headR * 0.28, headR * 0.05, headR * 0.05), hair, sx * headR * 0.36, eyeY + headR * 0.22, eyeZ * 0.98);
        b.rotation.z = sad ? sx * -0.35 : sx * 0.08;
        g.add(b);
      }
      return g;
    };
    const faceSet = (name: string, parts: THREE.Object3D[]) => {
      for (const p of parts) this.head.add(p);
      this.faces[name] = parts;
    };
    faceSet('neutral', [mkEyes(false), brows(false), (() => {
      const mm = mesh(new THREE.BoxGeometry(headR * 0.3, headR * 0.04, headR * 0.04), dark, 0, headR * 0.66, headR * 0.97);
      return mm;
    })()]);
    faceSet('happy', [mkEyes(true), brows(false), mouthArc(true, true)]);
    faceSet('sad', [mkEyes(false), brows(true), mouthArc(false)]);
    faceSet('aww', [mkEyes(true), brows(true), mouthArc(true)]);
    // tears
    const tearM = new THREE.MeshStandardMaterial({ color: 0x7ec8ff, roughness: 0.1, emissive: 0x2a6fb0, emissiveIntensity: 0.4 });
    for (let i = 0; i < 4; i++) {
      const t = mesh(new THREE.SphereGeometry(headR * 0.07, 6, 5), tearM);
      t.scale.set(1, 1.5, 1);
      t.castShadow = false;
      t.visible = false;
      this.head.add(t);
      this.tears.push(t);
    }
    // blush for the kid
    if (o.kid) {
      const blush = mat(0xf29a9a, 0.9);
      for (const sx of [-1, 1]) {
        const b = mesh(new THREE.SphereGeometry(headR * 0.12, 8, 6), blush, sx * headR * 0.55, headR * 0.85, headR * 0.8);
        b.scale.set(1, 0.6, 0.3);
        this.head.add(b);
      }
    }
    for (const g of [this.hips, this.torso, this.head, this.armL, this.armR, this.thighL, this.thighR, this.shinL, this.shinR]) this.rest.set(g, g.rotation.clone());
    this.setExpression('neutral');
  }

  setExpression(e: FigureExpression) {
    this.expression = e;
    for (const [name, parts] of Object.entries(this.faces)) for (const p of parts) p.visible = name === e;
    if (e !== 'sad') for (const t of this.tears) t.visible = false;
  }

  /** Per-frame animation. `wave` 0..1, `hug` 0..1, `rock` rocking angle (sitting). */
  animate(dt: number, t: number, o: { wave?: number; hug?: number; knit?: number; bounce?: number; lookYaw?: number } = {}) {
    const R = (g: THREE.Object3D) => this.rest.get(g)!;
    const k = this.height / 1.7;
    // breathing / idle sway
    this.torso.rotation.set(R(this.torso).x + Math.sin(t * 1.6) * 0.015, 0, Math.sin(t * 0.9) * 0.02);
    this.head.rotation.set(Math.sin(t * 1.1) * 0.03, (o.lookYaw ?? 0) * 0.8, Math.sin(t * 0.7) * 0.04);
    if (this.sitting) {
      this.hips.position.y = 0.52 * k;
      this.thighL.rotation.set(-1.45, 0, 0.05);
      this.thighR.rotation.set(-1.45, 0, -0.05);
      this.shinL.rotation.set(1.35, 0, 0);
      this.shinR.rotation.set(1.35, 0, 0);
      this.torso.rotation.x -= 0.12;
    } else {
      this.hips.position.y = 0.82 * k + Math.abs(Math.sin(t * 7)) * 0.06 * (o.bounce ?? 0);
      for (const g of [this.thighL, this.thighR, this.shinL, this.shinR]) g.rotation.copy(R(g));
    }
    let aL = R(this.armL).z;
    let aR = R(this.armR).z;
    let fL = 0;
    let fR = 0;
    const knit = o.knit ?? 0;
    if (knit > 0) {
      fL = -0.9 - Math.sin(t * 7) * 0.12 * knit;
      fR = -0.9 + Math.sin(t * 7) * 0.12 * knit;
      aL = 0.35;
      aR = -0.35;
    }
    const hug = o.hug ?? 0;
    if (hug > 0) {
      fL = fL * (1 - hug) - 1.25 * hug;
      fR = fR * (1 - hug) - 1.25 * hug;
      aL = aL * (1 - hug) - 0.5 * hug;
      aR = aR * (1 - hug) + 0.5 * hug;
    }
    const wave = o.wave ?? 0;
    if (wave > 0) {
      fR = fR * (1 - wave) - 2.6 * wave;
      aR = aR * (1 - wave) + (-0.4 + Math.sin(t * 10) * 0.35) * wave;
    }
    this.armL.rotation.set(fL, 0, aL);
    this.armR.rotation.set(fR, 0, aR);
    // tears roll down the cheeks while sad
    if (this.expression === 'sad') {
      this.tearT += dt;
      this.tears.forEach((tr, i) => {
        const ph = (this.tearT * 0.8 + i * 0.5) % 1;
        const sx = i % 2 ? 1 : -1;
        const headR = (this.height / 1.7) * 0.2;
        tr.visible = true;
        tr.position.set(sx * headR * 0.42, headR * (1.0 - ph * 0.9), headR * 0.93);
        tr.scale.setScalar(1 - ph * 0.5).setY(1.5 * (1 - ph * 0.5));
      });
    }
  }
}

export function buildGrandma(): Figure {
  return new Figure({ height: 1.58, skin: 0xf0cdb4, top: 0xb05a7a, bottom: 0x5d6b8a, shoes: 0x6b4a3a, hair: 0xdedad6, grandma: true });
}

export function buildKid(): Figure {
  return new Figure({ height: 1.12, skin: 0xd9a47e, top: 0x3d9ad8, bottom: 0x3a4a6a, shoes: 0xd84a3a, hair: 0x5a3a22, kid: true });
}

/** Knitting needles + a yarn ball (Grandma's lap). */
export function buildKnitting(): THREE.Group {
  const g = new THREE.Group();
  const yarn = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd8425a, roughness: 1 }));
  yarn.position.set(0.12, 0.02, 0.05);
  yarn.castShadow = true;
  g.add(yarn);
  const needleM = new THREE.MeshStandardMaterial({ color: 0xc9c9d4, roughness: 0.3, metalness: 0.8 });
  for (const sx of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 5), needleM);
    n.rotation.z = sx * 0.9;
    n.rotation.x = 0.3;
    n.position.set(sx * 0.03, 0.08, 0.1);
    g.add(n);
  }
  const knit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.02), new THREE.MeshStandardMaterial({ color: 0xf6ead2, roughness: 1 }));
  knit.position.set(0, 0.03, 0.12);
  knit.rotation.x = -0.5;
  g.add(knit);
  return g;
}
