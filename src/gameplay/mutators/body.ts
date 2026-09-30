import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { hasFurShells, setFurLength } from '../../player/Fur';
import { Attachment, glbOr, buildBubbleHelmet, modelParts } from './accessories';
import { Shape } from './fx';
import { sharedFx } from './shared';
import { getPlayer, PLAYER_R, type MutatorImpl } from './types';

const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const Z = new THREE.Vector3(0, 0, 1);

// ------------------------------------------------------------------ Space Jimothy

export function spaceJimothy(): MutatorImpl {
  const names = ['BubbleHelmet', 'SpaceHelmet', 'Helmet'];
  const helmet = new Attachment('Head', (a) => glbOr(names, 'helmet', a, () => buildBubbleHelmet(a)), names);
  const G_MUL = 0.3;
  let applied = false;
  let starT = 0;
  const fixRagdollGravity = (game: Game) => {
    const p = getPlayer(game);
    if (p?.mode === 'ragdoll') p.body.setGravityScale(p.gravityMul, true);
  };
  return {
    def: {
      id: 'spaceJimothy',
      name: 'Space Jimothy',
      desc: '30% gravity and a fishbowl helmet. NASA noticed him. (A different NASA. A parody one.)',
      unlockHint: "Complete 'Climb the Space Noodle'.",
    },
    enable(game) {
      const p = getPlayer(game);
      if (p) {
        p.gravityMul *= G_MUL;
        applied = true;
      }
      fixRagdollGravity(game);
      game.hint('Space Jimothy: one small hop for raccoon, one giant bounce for raccoonkind.', 3.5);
    },
    disable(game) {
      const p = getPlayer(game);
      if (p && applied) {
        p.gravityMul /= G_MUL;
        if (Math.abs(p.gravityMul - 1) < 1e-6) p.gravityMul = 1;
      }
      applied = false;
      fixRagdollGravity(game);
      helmet.remove();
    },
    post(game, dt) {
      const p = getPlayer(game);
      if (!p) return;
      const obj = helmet.ensure(p.model);
      const blink = obj?.getObjectByName('Blinker') as THREE.Mesh | undefined;
      if (blink) {
        const m = blink.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = Math.sin(game.time * 5) > 0.3 ? 3 : 0.2;
      }
      // twinkly stardust while floating around
      if (!p.grounded && p.mode !== 'swim') {
        starT -= dt;
        if (starT <= 0) {
          starT = 0.07;
          const fx = sharedFx(game);
          _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(PLAYER_R * p.sizeMul * 1.3);
          _a.add(p.position);
          _a.y += PLAYER_R * (p.sizeMul - 1);
          fx.glow.spawn(_a, new THREE.Vector3(0, 0.15, 0), Math.random() < 0.5 ? 0xbfe3ff : 0xfff3c4, 0.14, 0.9, { shape: Shape.Star, fadeIn: 0.3 });
        }
      }
    },
  };
}

// ------------------------------------------------------------------ Wet Jimothy

export function wetJimothy(): MutatorImpl {
  let wet = 0;
  let shake = 0;
  let dripT = 0;
  let off: (() => void) | null = null;
  let hinted = false;
  /** Every furry mesh whose coat we've flattened (either form), to fluff back up on disable. */
  const flattened = new Set<THREE.Object3D>();

  function restoreFur() {
    for (const m of flattened) setFurLength(m, 1);
    flattened.clear();
  }

  return {
    def: {
      id: 'wetJimothy',
      name: 'Wet Jimothy',
      desc: 'After a swim he goes flat, skinny and drippy. Still round though. Chitter to shake off.',
      unlockHint: "Complete 'Bath Time' (swim in 4 kinds of water).",
    },
    enable(game) {
      wet = 1;
      hinted = false;
      const p = getPlayer(game);
      if (p) p.wetness = Math.max(p.wetness ?? 0, 1);
      off = game.events.on('chitter', () => {
        const pl = getPlayer(game);
        const w = Math.max(wet, pl?.wetness ?? 0);
        if (!pl || w < 0.2) return;
        shake = 0.8;
        wet = 0;
        pl.wetness = 0;
        const fx = sharedFx(game);
        const c = pl.position.clone();
        c.y += PLAYER_R * (pl.sizeMul - 1);
        for (let i = 0; i < 40; i++) {
          const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize();
          fx.puffs.spawn(c.clone().addScaledVector(d, PLAYER_R * pl.sizeMul), d.multiplyScalar(3 + Math.random() * 3), 0x9fd8ff, 0.07 + Math.random() * 0.05, 0.6, { gravity: 9, alpha: 0.85 });
        }
        game.sfx('splash', pl.position, 0.5, 1.5);
        game.score(40, 'Shake It Off', pl.position.clone());
      });
      game.hint('Wet Jimothy: less fluff when wet. Still round though.', 3);
    },
    disable() {
      off?.();
      off = null;
      restoreFur();
      wet = 0;
      shake = 0;
    },
    update(game, dt) {
      const p = getPlayer(game);
      if (!p) return;
      if (p.mode === 'swim') wet = 1;
      else if (p.washing) wet = Math.max(wet, 0.6);
      else wet = Math.max(0, wet - dt / 32);
      if (wet > 0.9 && !hinted && p.mode === 'swim') {
        hinted = true;
        game.hint('Drenched! 40% less fluff. Still round though. (Chitter to shake off.)', 3);
      }
    },
    post(game, dt, mods) {
      const p = getPlayer(game);
      if (!p) return;
      const w = Math.max(wet, p.wetness ?? 0);
      // skinny & slick
      mods.scale.x *= 1 - 0.17 * w;
      mods.scale.z *= 1 - 0.13 * w;
      mods.scale.y *= 1 - 0.06 * w;
      if (shake > 0) {
        mods.rot.y += Math.sin(shake * 60) * 0.45 * shake;
        mods.rot.z += Math.sin(shake * 47) * 0.12 * shake;
        shake -= dt;
      }
      // flatten the fur: soaked, his coat lies short and slick (only the inner shells)
      const k = THREE.MathUtils.lerp(1, 0.3, THREE.MathUtils.smoothstep(w, 0.1, 0.7));
      if (k > 0.999) restoreFur();
      else {
        p.model.pivot.children[0]?.traverse((o) => {
          if (o.userData.furShell || !hasFurShells(o)) return;
          setFurLength(o, k);
          flattened.add(o);
        });
      }
      // drips
      if (w > 0.05 && p.mode !== 'swim') {
        dripT -= dt * (6 + 26 * w);
        const fx = sharedFx(game);
        while (dripT < 0) {
          dripT += 1;
          const d = _a.set(Math.random() - 0.5, -Math.random() * 0.9 - 0.1, Math.random() - 0.5).normalize();
          const pos = p.position.clone().addScaledVector(d, PLAYER_R * p.sizeMul * 0.92);
          pos.y += PLAYER_R * (p.sizeMul - 1);
          fx.puffs.spawn(pos, new THREE.Vector3(p.velocity.x * 0.3, -0.4, p.velocity.z * 0.3), 0x8fcfff, 0.05 + Math.random() * 0.03, 0.55, { gravity: 9.8, alpha: 0.85 });
        }
      }
    },
  };
}

// ------------------------------------------------------------------ Bobblehead

export function bobblehead(): MutatorImpl {
  const SCALE = 2.2;
  /**
   * The walking Jimothy's head joint is at the back of his skull (his head hangs forward off a very short neck), so
   * growing the head about it would swing his face down onto the ground. Grow it about his chin instead (Head-bone
   * frame): the big head rises up over his shoulders like a figurine's.
   */
  const CHIN = new THREE.Vector3(0, -0.13, 0.09);
  let headRef: THREE.Object3D | null = null;
  let savedScale = new THREE.Vector3(1, 1, 1);
  let savedPos = new THREE.Vector3();
  let th = 0; // pitch
  let tr = 0; // roll
  let wp = 0;
  let wr = 0;
  const prevVel = new THREE.Vector3();
  const accF = new THREE.Vector3();
  const offs: (() => void)[] = [];

  function release() {
    if (headRef) {
      headRef.scale.copy(savedScale);
      headRef.position.copy(savedPos);
    }
    headRef = null;
  }

  return {
    def: {
      id: 'bobblehead',
      name: 'Bobblehead',
      desc: 'Collector-edition head: 2.2× size, fully spring-loaded. Boing.',
      unlockHint: "Complete 'Bobblehead Collector' (all 10 golden bobbleheads).",
    },
    enable(game) {
      offs.push(
        game.events.on('land', (e) => (wp += Math.min(9, 2 + (e?.height ?? 0) * 1.6))),
        game.events.on('jump', () => (wp -= 3.5)),
        game.events.on('bonkStart', () => (wp += 6)),
        game.events.on('chitter', () => (wr += Math.random() < 0.5 ? 7 : -7)),
      );
      const p = getPlayer(game);
      if (p) prevVel.copy(p.velocity);
      game.hint('Bobblehead: now in collectible form. Boing.', 2.5);
    },
    disable() {
      for (const f of offs) f();
      offs.length = 0;
      release();
      th = tr = wp = wr = 0;
    },
    post(game, dt) {
      const p = getPlayer(game);
      if (!p || dt <= 0) return;
      const head = modelParts(p.model).Head;
      if (!head) return;
      if (head !== headRef) {
        release();
        headRef = head;
        savedScale = head.scale.clone();
        savedPos = head.position.clone();
      }
      head.scale.copy(savedScale).multiplyScalar(SCALE);
      // acceleration in Jimothy's facing frame drives the spring
      const acc = _a.copy(p.velocity).sub(prevVel).divideScalar(dt).clampLength(0, 80);
      prevVel.copy(p.velocity);
      accF.lerp(acc, 1 - Math.exp(-dt * 20));
      const fwd = Math.sin(p.facing) * accF.x + Math.cos(p.facing) * accF.z;
      const side = Math.cos(p.facing) * accF.x - Math.sin(p.facing) * accF.z;
      const walkBob = p.grounded && p.mode === 'walk' ? Math.sin(game.time * 11) * Math.min(1, p.speed / 4) * 0.6 : 0;
      const k = 120;
      const c = 4.2;
      wp += (-k * th - c * wp - fwd * 0.9 + walkBob * 8) * dt;
      wr += (-k * tr - c * wr + side * 0.9) * dt;
      th = THREE.MathUtils.clamp(th + wp * dt, -0.75, 0.75);
      tr = THREE.MathUtils.clamp(tr + wr * dt, -0.75, 0.75);
      _q.setFromEuler(_e.set(th, 0, tr));
      head.quaternion.multiply(_q);
      // (scaling about the chin = scaling about the joint, then sliding the head back by (s - 1) x the chin offset)
      if (p.model.quad) head.position.copy(savedPos).addScaledVector(_a.copy(CHIN).multiply(savedScale).applyQuaternion(head.quaternion), 1 - SCALE);
    },
  };
}

// ------------------------------------------------------------------ Zoomies

/** Soft rotor-blur disc: a bright ring with a few swept streaks, fading to nothing at the hub and the rim. */
function rotorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 63);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.lineWidth = 3 - i * 0.6;
    ctx.beginPath();
    ctx.arc(64, 64, 50 - i * 9, i * 2.1, i * 2.1 + 1.3);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.center.set(0.5, 0.5); // spins about the hub
  return t;
}

export function zoomies(): MutatorImpl {
  const MUL = 2;
  /** The tail's rest direction in its own bone frame (from the joint to the middle of the puff): back and up. */
  const QUAD_TAIL = new THREE.Vector3(0, 0.046, -0.047);
  const BALL_TAIL = new THREE.Vector3(0, 0.25, -1);
  let applied = false;
  let dustT = 0;
  let heli = 0;
  let rotor = 0;
  let tailRef: THREE.Object3D | null = null;
  let blur: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null = null;
  const _d = new THREE.Vector3();
  const _u = new THREE.Vector3();
  const _w = new THREE.Vector3();

  // (both forms' tails rest at scale 1; nothing else scales them except an AI glitch, which puts it back itself)
  function releaseTail() {
    tailRef?.scale.setScalar(1);
    tailRef = null;
    blur?.removeFromParent();
  }

  /** Tail helicopter: his little tail puff swells and whirls round like a rotor, with a faint motion-blur disc. */
  function helicopter(game: Game, dt: number) {
    const p = getPlayer(game)!;
    const tail = modelParts(p.model).Tail1 ?? null;
    if (tail !== tailRef) {
      releaseTail();
      tailRef = tail;
    }
    const want = tail && p.speed > 1 && p.mode !== 'roll' ? Math.min(1, (p.speed - 1) / 3) : 0;
    heli = THREE.MathUtils.damp(heli, want, 6, dt);
    if (!tail) return;
    const k = 1 + 0.7 * heli;
    tail.scale.setScalar(k);
    if (heli < 0.02 || !tail.parent) {
      blur?.removeFromParent();
      return;
    }
    rotor += dt * 32; // ~5 turns a second
    const rest = p.model.quad ? QUAD_TAIL : BALL_TAIL;
    const len = rest.length() * k;
    // tilt the tail off its rest axis by A, the tilt direction going round: the puff's middle traces a circle
    const A = 0.75 * heli;
    _d.copy(rest).normalize();
    _u.set(1, 0, 0);
    _w.crossVectors(_d, _u).normalize();
    const axis = _u.multiplyScalar(Math.cos(rotor)).addScaledVector(_w, Math.sin(rotor)).normalize();
    // the rotor disc sits across the tail's current (pre-whirl) axis, in the tail's parent frame
    const dq = _d.applyQuaternion(tail.quaternion);
    tail.quaternion.multiply(_q.setFromAxisAngle(axis, A));
    if (!blur) {
      const map = rotorTexture();
      blur = new THREE.Mesh(
        new THREE.CircleGeometry(1, 36),
        new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0 }),
      );
      blur.name = 'ZoomiesRotor';
      blur.renderOrder = 5;
      blur.userData.jimAccessory = true;
    }
    if (blur.parent !== tail.parent) tail.parent.add(blur);
    blur.position.copy(tail.position).addScaledVector(dq, len * Math.cos(A));
    blur.quaternion.setFromUnitVectors(Z, dq);
    blur.scale.setScalar(len * Math.sin(A) + 0.075 * k + 0.01);
    blur.material.opacity = 0.4 * heli;
    blur.material.map!.rotation = -rotor;
  }

  return {
    def: {
      id: 'zoomies',
      name: 'Zoomies',
      desc: '2× speed. He cannot stop. He will not stop.',
      unlockHint: "Complete 'Legs For Days' (walk 2 km).",
    },
    enable(game) {
      const p = getPlayer(game);
      if (p) {
        p.speedMul *= MUL;
        applied = true;
      }
      game.hint('ZOOMIES! He cannot stop. He will not stop.', 2.5);
    },
    disable(game) {
      const p = getPlayer(game);
      if (p && applied) {
        p.speedMul /= MUL;
        if (Math.abs(p.speedMul - 1) < 1e-6) p.speedMul = 1;
      }
      applied = false;
      releaseTail();
      heli = 0;
      if (blur) {
        blur.geometry.dispose();
        blur.material.map?.dispose();
        blur.material.dispose();
        blur = null;
      }
    },
    post(game, dt) {
      const p = getPlayer(game);
      if (!p) return;
      const fast = p.grounded && p.speed > 6 && (p.mode === 'walk' || p.mode === 'roll');
      if (fast) {
        dustT -= dt * (10 + p.speed);
        const fx = sharedFx(game);
        while (dustT < 0) {
          dustT += 1;
          const pos = p.position.clone();
          pos.y -= PLAYER_R * 0.85;
          pos.x += (Math.random() - 0.5) * 0.5 * p.sizeMul;
          pos.z += (Math.random() - 0.5) * 0.5 * p.sizeMul;
          fx.puffs.spawn(pos, new THREE.Vector3(-p.velocity.x * 0.15, 0.6 + Math.random() * 0.5, -p.velocity.z * 0.15), 0xd9cdb8, 0.2 + Math.random() * 0.15, 0.55, { drag: 2.5, grow: 2.5, alpha: 0.55 });
        }
      }
      helicopter(game, dt);
    },
  };
}

