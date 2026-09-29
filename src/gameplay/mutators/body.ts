import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { Attachment, glbOr, buildBubbleHelmet, modelParts } from './accessories';
import { Shape } from './fx';
import { sharedFx } from './shared';
import { getPlayer, PLAYER_R, type MutatorImpl } from './types';

const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

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
  let shellsFor: THREE.Object3D | null = null;
  let shellLists: THREE.Object3D[][] = [];
  let hiddenShells: THREE.Object3D[] = [];

  function collectShells(model: THREE.Object3D) {
    shellLists = [];
    const walk = (o: THREE.Object3D) => {
      if (o.userData.jimAccessory) return;
      const shells = o.children.filter((c) => c.userData.furShell);
      if (shells.length) shellLists.push(shells);
      for (const c of o.children) if (!c.userData.furShell) walk(c);
    };
    walk(model);
  }
  function restoreShells() {
    for (const s of hiddenShells) s.visible = true;
    hiddenShells = [];
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
      restoreShells();
      shellsFor = null;
      shellLists = [];
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
      // flatten the fur: hide the outer shells
      const child = p.model.pivot.children[0];
      if (child && child !== shellsFor) {
        restoreShells();
        collectShells(child);
        shellsFor = child;
      }
      const keep = Math.round(THREE.MathUtils.lerp(10, 3, THREE.MathUtils.smoothstep(w, 0.1, 0.7)));
      restoreShells();
      if (keep < 10) {
        for (const list of shellLists) {
          for (let i = keep; i < list.length; i++) {
            if (list[i].visible) {
              list[i].visible = false;
              hiddenShells.push(list[i]);
            }
          }
        }
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
  let headRef: THREE.Object3D | null = null;
  let savedScale = new THREE.Vector3(1, 1, 1);
  let th = 0; // pitch
  let tr = 0; // roll
  let wp = 0;
  let wr = 0;
  const prevVel = new THREE.Vector3();
  const accF = new THREE.Vector3();
  const offs: (() => void)[] = [];

  function release() {
    if (headRef) headRef.scale.copy(savedScale);
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
    },
  };
}

// ------------------------------------------------------------------ Zoomies

export function zoomies(): MutatorImpl {
  const MUL = 2;
  let applied = false;
  let dustT = 0;
  return {
    def: {
      id: 'zoomies',
      name: 'Zoomies',
      desc: '2× speed. He cannot stop. He will not stop.',
      unlockHint: "Complete 'Tiny Legs, Big Journey' (walk 2 km).",
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
      // tail helicopter
      const tail = modelParts(p.model).Tail1;
      if (tail && p.speed > 1 && p.mode !== 'roll') {
        _q.setFromAxisAngle(_a.set(0, 1, 0), Math.sin(game.time * 26) * 0.55);
        tail.quaternion.multiply(_q);
      }
    },
  };
}

