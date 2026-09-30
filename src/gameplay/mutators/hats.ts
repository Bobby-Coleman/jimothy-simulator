import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { spawnProp, destroyProp } from '../../entities/Props';
import type { CameraRig } from '../../player/CameraRig';
import { Attachment, glbOr, buildGradCap, buildBaseballCap, buildBeanie } from './accessories';
import { makeLabelSprite, disposeSprite, Shape } from './fx';
import { sharedFx } from './shared';
import { getPlayer, PLAYER_R, type MutatorImpl } from './types';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Pendulum for dangly bits (tassels): swings against the parent's acceleration, settles toward gravity. */
export class Dangle {
  private dir = new THREE.Vector3(0, -1, 0);
  private vel = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  private prevVel = new THREE.Vector3();
  private init = false;

  update(pivot: THREE.Object3D, dt: number, stiffness = 55, damping = 5) {
    if (!pivot.parent || dt <= 0) return;
    pivot.parent.updateWorldMatrix(true, false);
    const wp = pivot.getWorldPosition(_a);
    if (!this.init) {
      this.init = true;
      this.prevPos.copy(wp);
      this.prevVel.set(0, 0, 0);
    }
    const v = _b.copy(wp).sub(this.prevPos).divideScalar(dt);
    const acc = v.clone().sub(this.prevVel).divideScalar(dt).clampLength(0, 60);
    this.prevPos.copy(wp);
    this.prevVel.copy(v);
    const target = new THREE.Vector3(0, -14, 0).sub(acc.multiplyScalar(0.8)).normalize();
    this.vel.addScaledVector(target.sub(this.dir), stiffness * dt);
    this.vel.multiplyScalar(Math.exp(-damping * dt));
    this.dir.addScaledVector(this.vel, dt).normalize();
    pivot.parent.getWorldQuaternion(_q).invert();
    const local = this.dir.clone().applyQuaternion(_q);
    pivot.quaternion.setFromUnitVectors(DOWN, local);
  }
}

// ------------------------------------------------------------------ Honorary Grad

function buildDiploma(): THREE.Object3D {
  const g = new THREE.Group();
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.34, 14), new THREE.MeshStandardMaterial({ color: 0xf5edd6, roughness: 0.85 }));
  paper.rotation.z = Math.PI / 2;
  g.add(paper);
  const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.049, 0.049, 0.05, 14), new THREE.MeshStandardMaterial({ color: 0x5b2c8f, roughness: 0.6 }));
  ribbon.rotation.z = Math.PI / 2;
  g.add(ribbon);
  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.01, 12), new THREE.MeshStandardMaterial({ color: 0xe8b93a, metalness: 0.4, roughness: 0.4 }));
  seal.position.set(0, 0, 0.05);
  seal.rotation.x = Math.PI / 2;
  g.add(seal);
  return g;
}

export function honoraryGrad(): MutatorImpl {
  const names = ['GradCap', 'MortarBoard', 'Mortarboard'];
  const cap = new Attachment('Head', (a) => glbOr(names, 'hat', a, () => buildGradCap(a)), names, true);
  const tassel = new Dangle();
  const diplomas: Entity[] = [];
  let off: (() => void) | null = null;
  let pending = 0;

  function fling(game: Game) {
    const p = getPlayer(game);
    if (!p) return;
    const f = p.forwardVec(new THREE.Vector3());
    const reach = PLAYER_R * p.sizeMul + 0.3;
    const pos = p.position.clone().addScaledVector(f, reach);
    pos.y += 0.25 * p.sizeMul;
    const e = spawnProp(
      game,
      {
        name: 'Diploma',
        object: buildDiploma(),
        mass: 0.25,
        sleeping: false,
        ccd: true,
        restitution: 0.35,
        tags: ['grabbable', 'washable', 'diploma', 'paper'],
        data: { buoyancy: 2 },
        onWash(g) {
          const n = (e.data.washCount = (e.data.washCount ?? 0) + 1);
          if (n === 1) {
            g.score(120, 'Soggy Diploma', e.object?.position);
            g.hint('The diploma is soggy now. It still counts. Probably.', 2.5);
            e.object?.traverse((o) => {
              const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
              if (m?.color) m.color.multiplyScalar(0.72);
            });
            if (e.object) e.object.scale.set(1, 0.8, 1);
          } else g.score(10, 'Extremely Soggy Diploma', e.object?.position);
          g.events.emit('itemWashed', { kind: 'diploma', entity: e });
        },
      },
      pos,
      p.facing + Math.PI / 2,
    );
    const v = p.velocity;
    e.body?.setLinvel({ x: v.x * 0.5 + f.x * 8.5, y: Math.max(0, v.y) * 0.3 + 4.2, z: v.z * 0.5 + f.z * 8.5 }, true);
    e.body?.setAngvel({ x: (Math.random() - 0.5) * 16, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 16 }, true);
    diplomas.push(e);
    while (diplomas.length > 12) {
      const old = diplomas.shift()!;
      if (p.held?.entity === old) p.release(false);
      destroyProp(game, old);
    }
    game.sfx('throw', pos, 0.7, 1.2);
  }

  return {
    def: {
      id: 'honoraryGrad',
      name: 'Honorary Grad',
      desc: 'Mortarboard on, tassel swinging. Every bonk flings a diploma. Magna cum raccoon.',
      unlockHint: "Complete 'Honorary Degree' at the University of Washing.",
      group: 'hat',
    },
    enable(game) {
      off = game.events.on('bonkStart', () => pending++);
      game.hint('Honorary Grad: every bonk hands out a diploma. Education for everyone!', 3);
    },
    disable(game) {
      off?.();
      off = null;
      pending = 0;
      cap.remove();
      const p = getPlayer(game);
      for (const d of diplomas) {
        if (p?.held?.entity === d) p.release(false);
        destroyProp(game, d);
      }
      diplomas.length = 0;
    },
    update(game) {
      while (pending > 0) {
        pending--;
        fling(game);
      }
    },
    post(game, dt) {
      const p = getPlayer(game);
      if (!p) return;
      const obj = cap.ensure(p.model);
      const tp = obj?.getObjectByName('TasselPivot') ?? obj?.getObjectByName('Tassel');
      if (tp) tassel.update(tp, dt);
    },
  };
}

// ------------------------------------------------------------------ Rookie

/** Floating world-space text that rises and fades ("HOME RUN!"). */
class FloatingLabels {
  private items: { s: THREE.Sprite; t: number; life: number; v: number }[] = [];
  spawn(game: Game, text: string, pos: THREE.Vector3, color = '#ffe25c') {
    const s = makeLabelSprite(text, { height: 0.42, color });
    s.position.copy(pos);
    game.scene.add(s);
    this.items.push({ s, t: 0, life: 1.3, v: 1.6 });
  }
  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.s.position.y += it.v * dt;
      it.v *= Math.exp(-dt * 2);
      const k = it.t / it.life;
      it.s.material.opacity = k < 0.6 ? 1 : Math.max(0, 1 - (k - 0.6) / 0.4);
      const pop = Math.min(1, it.t * 8);
      it.s.material.rotation = Math.sin(it.t * 9) * 0.05 * (1 - k);
      if (pop < 1) it.s.material.opacity *= pop;
      if (it.t >= it.life) {
        disposeSprite(it.s);
        this.items.splice(i, 1);
      }
    }
  }
  clear() {
    for (const it of this.items) disposeSprite(it.s);
    this.items.length = 0;
  }
}

function buildBat(): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'RookieBat';
  const wood = new THREE.MeshStandardMaterial({ color: 0xc8955a, roughness: 0.55 });
  const tape = new THREE.MeshStandardMaterial({ color: 0x1c2c55, roughness: 0.9 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.014, 0.3, 12), wood);
  barrel.position.y = 0.17;
  g.add(barrel);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), wood);
  cap.position.y = 0.32;
  g.add(cap);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.07, 10), tape);
  grip.position.y = 0.0;
  g.add(grip);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12), wood);
  knob.position.y = -0.04;
  g.add(knob);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  return g;
}

/** Where the walking Jimothy grips the bat (Head-bone frame): crosswise in his mouth, behind the muzzle. */
const BAT_GRIP = new THREE.Vector3(0.005, -0.152, 0.082);
/** Which way the barrel sticks out of his mouth at rest (Head-bone frame): out past his right cheek and up, square
 * to the camera behind him so it shows its full length. */
const BAT_OUT = new THREE.Vector3(-1, 0.58, -0.06).normalize();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * The Rookie's swing (the walking Jimothy swings the bat in his teeth): turn of the bat about his head's up axis
 * (+ = from his right side round the front to his left) and a downward chop, `t` seconds after the bonk.
 */
function swingPose(t: number): [number, number] {
  if (t < 0.08) {
    const u = t / 0.08;
    return [-0.35 * u, 0];
  }
  if (t < 0.2) {
    const u = (t - 0.08) / 0.12;
    const e = 1 - (1 - u) * (1 - u);
    return [-0.35 + 3.05 * e, 0.35 * Math.sin(Math.PI * u)];
  }
  const u = Math.min(1, (t - 0.2) / 0.45);
  const e = u * u * (3 - 2 * u);
  return [2.7 * (1 - e), 0];
}

export function rookie(): MutatorImpl {
  const names = ['BaseballCap', 'RookieCap', 'Cap'];
  const cap = new Attachment('Head', (a) => glbOr(names, 'hat', a, () => buildBaseballCap(a)), names, true);
  // the ball holds its bat up in a paw
  const batHand = new Attachment('HandR', (a) => {
    const b = buildBat();
    b.scale.setScalar(a.scale);
    b.position.set(0, -0.01 * a.scale, 0.03 * a.scale);
    b.rotation.set(1.1, 0, 0);
    return { obj: b, glb: false };
  });
  // the walking Jimothy's front paws are for walking: he carries the bat in his mouth like a stick (grip crosswise
  // in his teeth, the barrel sticking out past his right cheek) and swings it round with a twist of his head
  const batMouth = new Attachment('Head', () => {
    const pivot = new THREE.Group();
    pivot.name = 'RookieBatGrip';
    pivot.position.copy(BAT_GRIP);
    const b = buildBat();
    b.scale.setScalar(0.9);
    b.quaternion.setFromUnitVectors(Y_AXIS, BAT_OUT);
    pivot.add(b);
    return { obj: pivot, glb: false };
  });
  const labels = new FloatingLabels();
  let off: (() => void) | null = null;
  let offSwing: (() => void) | null = null;
  let swingT = 9;
  let lastHR = -10;
  let hrCount = 0;

  function onBonk(game: Game, ev: { entity?: Entity; impulse?: THREE.Vector3; source?: string }) {
    if (ev?.source === 'chonk') return;
    const e = ev?.entity;
    const p = getPlayer(game);
    if (!e || !e.alive || !p || e.kind === 'player') return;
    const imp = ev.impulse ? ev.impulse.clone() : p.forwardVec(new THREE.Vector3()).multiplyScalar(e.mass * 9);
    const b = e.body;
    if (b && b.isDynamic()) {
      const m = Math.min(b.mass(), 90);
      const f = p.forwardVec(new THREE.Vector3());
      b.applyImpulse({ x: imp.x * 1.6 + f.x * m * 4, y: imp.y * 1.2 + m * 7.5, z: imp.z * 1.6 + f.z * m * 4 }, true);
      b.setAngvel({ x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 20 }, true);
    }
    game.events.emit('homeRun', { entity: e, impulse: imp });
    const bt = b?.translation();
    const pos = bt ? new THREE.Vector3(bt.x, bt.y, bt.z) : p.position.clone();
    game.sfx('bat_crack', pos, 1);
    game.get<CameraRig>('camera')?.shake(0.35);
    const fx = sharedFx(game);
    for (let i = 0; i < 10; i++) {
      _a.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 3);
      fx.glow.spawn(pos, _a, i % 2 ? 0xfff1a8 : 0xffffff, 0.22, 0.45, { shape: Shape.Star, drag: 3 });
    }
    if (game.time - lastHR > 0.7) {
      lastHR = game.time;
      hrCount++;
      game.score(150, 'HOME RUN!', pos);
      labels.spawn(game, hrCount % 5 === 0 ? 'GRAND SLAM!' : 'HOME RUN!', pos.clone().add(new THREE.Vector3(0, 0.8, 0)));
      if (hrCount % 4 === 1) game.sfx('crowd_cheer', pos, 0.6);
    }
  }

  return {
    def: {
      id: 'rookie',
      name: 'Rookie',
      desc: 'Ballard Barnacles cap and a tiny bat. Every bonk is a HOME RUN.',
      unlockHint: "Complete 'Rookie Card' (find the gold-bordered card).",
      group: 'hat',
    },
    enable(game) {
      off = game.events.on('bonk', (ev) => onBonk(game, ev));
      offSwing = game.events.on('bonkStart', () => (swingT = 0));
      game.hint('Rookie: batter up! Bonks now hit it out of the park.', 3);
    },
    disable() {
      off?.();
      off = null;
      offSwing?.();
      offSwing = null;
      swingT = 9;
      cap.remove();
      batHand.remove();
      batMouth.remove();
      labels.clear();
    },
    post(game, dt) {
      const p = getPlayer(game);
      if (!p) return;
      cap.ensure(p.model);
      swingT += dt;
      const quad = p.model.quad;
      if (quad) {
        // (each form keeps its own bat: rolling in and out doesn't rebuild them)
        const grip = batMouth.ensure(p.model);
        if (grip) {
          const [turn, chop] = swingT < 1 ? swingPose(swingT) : [0, 0];
          grip.quaternion.setFromAxisAngle(Y_AXIS, turn).multiply(_q.setFromAxisAngle(X_AXIS, chop));
        }
        // jaws parted round the grip
        quad.bones.Jaw?.rotateX(0.12);
      } else batHand.ensure(p.model);
      labels.update(dt);
    },
  };
}

// ------------------------------------------------------------------ Grandma's Hat

export function grandmaHat(): MutatorImpl {
  const names = ['Beanie', 'KnitHat', 'GrandmaHat'];
  const hat = new Attachment('Head', (a) => glbOr(names, 'hat', a, () => buildBeanie(a)), names, true);
  let off: (() => void) | null = null;
  return {
    def: {
      id: 'grandmaHat',
      name: "Grandma's Hat",
      desc: "Hand-knitted by Grandma Rosie. Humans find you even more adorable (if that's possible).",
      unlockHint: "Complete 'Grandma's Favorite' (visit Grandma Rosie at night).",
      group: 'hat',
    },
    enable(game) {
      off = game.events.on('chitter', () => {
        const p = getPlayer(game);
        if (!p) return;
        const fx = sharedFx(game);
        const top = p.position.clone();
        top.y += PLAYER_R * (2 * p.sizeMul - 1) + 0.12;
        for (let i = 0; i < 4; i++) {
          _a.set((Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.35, (Math.random() - 0.5) * 0.6);
          fx.puffs.spawn(top, _a, i % 2 ? 0xff4d7d : 0xff8fb1, 0.13 + Math.random() * 0.05, 1.1, { shape: Shape.Heart, drag: 1.2, gravity: -0.15, fadeIn: 0.15 });
        }
      });
      game.hint("Grandma's Hat: hand-knitted with love. Everyone thinks you're precious.", 3);
    },
    disable() {
      off?.();
      off = null;
      hat.remove();
    },
    post(game) {
      const p = getPlayer(game);
      if (p) hat.ensure(p.model);
    },
  };
}
