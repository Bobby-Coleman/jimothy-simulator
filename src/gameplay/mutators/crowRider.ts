import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { disposeTree } from './fx';
import { getPlayer, PLAYER_R, type MutatorImpl } from './types';

interface Crow {
  root: THREE.Group;
  wingL: THREE.Group;
  wingR: THREE.Group;
  legs: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  flap: number;
}

function buildCrow(): Crow {
  const root = new THREE.Group();
  root.name = 'Crow';
  const black = new THREE.MeshStandardMaterial({ color: 0x17181f, roughness: 0.42, metalness: 0.15 });
  const beakMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), black);
  body.scale.set(0.85, 0.8, 1.45);
  root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 10), black);
  head.position.set(0, 0.07, 0.14);
  root.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.085, 8), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.06, 0.225);
  root.add(beak);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyeMat);
    eye.position.set(sx * 0.04, 0.09, 0.18);
    root.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.015, 0.16), black);
  tail.position.set(0, 0.0, -0.2);
  tail.rotation.x = -0.15;
  root.add(tail);
  const wing = (sx: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.07, 0.04, 0.02);
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6), black);
    w.scale.set(1.9, 0.14, 0.95);
    w.position.set(sx * 0.17, 0, -0.02);
    pivot.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.09), black);
    tip.position.set(sx * 0.34, 0, -0.05);
    tip.rotation.y = sx * 0.3;
    pivot.add(tip);
    root.add(pivot);
    return pivot;
  };
  const wingL = wing(1);
  const wingR = wing(-1);
  const legs = new THREE.Group();
  legs.position.set(0, -0.06, 0.02);
  for (const sx of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.11, 5), beakMat);
    l.position.set(sx * 0.03, -0.055, 0);
    legs.add(l);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.05), beakMat);
    foot.position.set(sx * 0.03, -0.11, 0.015);
    legs.add(foot);
  }
  root.add(legs);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  root.scale.setScalar(1.35);
  return { root, wingL, wingR, legs, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, flap: Math.random() * 6 };
}

const _t = new THREE.Vector3();
const _d = new THREE.Vector3();

/**
 * Crow Rider: two crow pals circle overhead. Hold Jump while falling and they swoop in, grab Jimothy by the
 * scruff and glide him forward (slow descent + forward speed).
 */
export function crowRider(): MutatorImpl {
  let crows: Crow[] = [];
  let gliding = false;
  let blend = 0;
  let orbit = 0;
  let nextCaw = 4;
  let glideTime = 0;

  return {
    def: {
      id: 'crowRider',
      name: 'Crow Rider',
      desc: 'Your crow pals carry you: hold Jump while falling to glide. Payment accepted in shiny things.',
      unlockHint: "Complete 'Crow Deals' (trade with the crows 3 times).",
    },
    enable(game) {
      const p = getPlayer(game);
      crows = [buildCrow(), buildCrow()];
      crows.forEach((c, i) => {
        c.pos.copy(p?.position ?? new THREE.Vector3()).add(new THREE.Vector3(i ? 2 : -2, 4, 0));
        c.root.position.copy(c.pos);
        game.scene.add(c.root);
      });
      gliding = false;
      blend = 0;
      game.hint('Crow Rider: hold Jump while falling and your crow pals will carry you.', 3.5);
      game.sfx('crow_caw', p?.position, 0.8);
    },
    disable() {
      for (const c of crows) {
        c.root.removeFromParent();
        disposeTree(c.root);
      }
      crows = [];
      gliding = false;
    },
    update(game, dt) {
      const p = getPlayer(game);
      if (!p) return;
      const jumpHeld = game.input.held('jump') && !p.frozen;
      const canGlide = p.mode === 'walk' && !p.grounded && jumpHeld;
      if (!gliding && canGlide && p.velocity.y < -0.3) {
        gliding = true;
        glideTime = 0;
        game.sfx('crow_caw', p.position, 0.7, 1.1);
        game.events.emit('crowGlide', { start: true });
      } else if (gliding && !canGlide) {
        gliding = false;
        game.events.emit('crowGlide', { start: false, time: glideTime });
      }
      if (!gliding) return;
      glideTime += dt;
      const v = p.body.linvel();
      const f = p.forwardVec(_d);
      const speed = 8.5 * Math.max(0.6, Math.min(2, p.speedMul));
      const k = 1 - Math.exp(-dt * 2.2);
      const vx = v.x + (f.x * speed - v.x) * k;
      const vz = v.z + (f.z * speed - v.z) * k;
      const sink = -1.3;
      const vy = v.y < sink ? v.y + (sink - v.y) * (1 - Math.exp(-dt * 9)) : Math.min(v.y, 2);
      p.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    },
    post(game, dt) {
      const p = getPlayer(game);
      if (!p || !crows.length) return;
      blend = THREE.MathUtils.clamp(blend + (gliding ? dt * 4 : -dt * 1.5), 0, 1);
      orbit += dt * (0.9 + blend);
      const s = p.sizeMul;
      const top = PLAYER_R * (2 * s - 1);
      const right = _d.set(-Math.cos(p.facing), 0, Math.sin(p.facing));
      crows.forEach((c, i) => {
        const side = i ? 1 : -1;
        // orbit target: lazy circles overhead
        const a = orbit + i * Math.PI;
        const orbitPos = _t.set(p.position.x + Math.cos(a) * 1.8, p.position.y + top + 2 + Math.sin(orbit * 1.3 + i) * 0.3, p.position.z + Math.sin(a) * 1.8);
        // carry target: gripping the scruff, one on each side
        const carry = p.position.clone().addScaledVector(right, side * 0.2 * s);
        carry.y += top + 0.22;
        const target = orbitPos.lerp(carry, blend);
        const follow = 1 - Math.exp(-dt * (blend > 0.5 ? 18 : 3.5));
        const before = c.pos.clone();
        c.pos.lerp(target, follow);
        c.vel.copy(c.pos).sub(before).divideScalar(Math.max(dt, 1e-3));
        c.root.position.copy(c.pos);
        const hv = Math.hypot(c.vel.x, c.vel.z);
        const wantYaw = blend > 0.5 ? p.facing : hv > 0.2 ? Math.atan2(c.vel.x, c.vel.z) : c.yaw;
        let dy = wantYaw - c.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        c.yaw += dy * (1 - Math.exp(-dt * 6));
        c.root.rotation.set(blend > 0.5 ? -0.25 : THREE.MathUtils.clamp(-c.vel.y * 0.08, -0.5, 0.5), c.yaw, blend > 0.5 ? side * 0.12 : -dy * 0.6);
        c.flap += dt * (blend > 0.5 ? 13 : 6.5);
        const amp = blend > 0.5 ? 1.0 : 0.75;
        const w = Math.sin(c.flap) * amp;
        c.wingL.rotation.z = w;
        c.wingR.rotation.z = -w;
        c.legs.rotation.x = blend * 0.9;
        c.legs.scale.y = 1 + blend * 0.6;
      });
      nextCaw -= dt;
      if (nextCaw <= 0) {
        nextCaw = 7 + Math.random() * 10;
        game.sfx('crow_caw', crows[0].pos, 0.5);
      }
    },
  };
}
