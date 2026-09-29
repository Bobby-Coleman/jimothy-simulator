import * as THREE from 'three';

/**
 * Visual-only ballistic bits (tossed grad caps, fallback confetti). No physics bodies: cheap, and they
 * can never jam the simulation. Gravity matches the physics world (-14).
 */
const GRAVITY = -14;

interface Toss {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  max: number;
  floorY: number;
  scale: number;
}

interface ConfettiBurst {
  mesh: THREE.InstancedMesh;
  pos: Float32Array;
  vel: Float32Array;
  rot: Float32Array;
  life: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

const CONFETTI_COLORS = [0xffd84a, 0xff5a7a, 0x4ac1ff, 0x7cf07a, 0xb07cff, 0xffffff, 0xff9f3a];

export class Particles {
  private tosses: Toss[] = [];
  private bursts: ConfettiBurst[] = [];
  private confettiGeo = new THREE.PlaneGeometry(0.11, 0.07);
  private confettiMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });

  constructor(private scene: THREE.Scene) {}

  /** Throw a visual object; it falls, bounces once or twice and shrinks away. */
  toss(obj: THREE.Object3D, pos: THREE.Vector3, vel: THREE.Vector3, opts: { spin?: THREE.Vector3; life?: number; floorY?: number } = {}) {
    obj.position.copy(pos);
    this.scene.add(obj);
    const life = opts.life ?? 4;
    this.tosses.push({
      obj,
      vel: vel.clone(),
      spin: opts.spin?.clone() ?? new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
      life,
      max: life,
      floorY: opts.floorY ?? pos.y - 3,
      scale: obj.scale.x,
    });
  }

  /** Fallback confetti (used only when no FX system listens to 'confetti'). */
  confetti(pos: THREE.Vector3, count = 90, spread = 1) {
    const n = Math.min(160, count);
    const mesh = new THREE.InstancedMesh(this.confettiGeo, this.confettiMat, n);
    mesh.frustumCulled = false;
    const pos3 = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const rot = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos3[i * 3] = pos.x + (Math.random() - 0.5) * 0.6 * spread;
      pos3[i * 3 + 1] = pos.y + Math.random() * 0.4;
      pos3[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.6 * spread;
      const a = Math.random() * Math.PI * 2;
      const h = (2 + Math.random() * 4) * spread;
      vel[i * 3] = Math.cos(a) * h;
      vel[i * 3 + 1] = 6 + Math.random() * 6;
      vel[i * 3 + 2] = Math.sin(a) * h;
      rot[i * 3] = Math.random() * 6;
      rot[i * 3 + 1] = Math.random() * 6;
      rot[i * 3 + 2] = Math.random() * 6;
      mesh.setColorAt(i, c.setHex(CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
    }
    this.scene.add(mesh);
    this.bursts.push({ mesh, pos: pos3, vel, rot, life: 3.6 });
  }

  update(dt: number) {
    for (let i = this.tosses.length - 1; i >= 0; i--) {
      const t = this.tosses[i];
      t.life -= dt;
      t.vel.y += GRAVITY * dt;
      t.obj.position.addScaledVector(t.vel, dt);
      t.obj.rotation.x += t.spin.x * dt;
      t.obj.rotation.y += t.spin.y * dt;
      t.obj.rotation.z += t.spin.z * dt;
      if (t.obj.position.y < t.floorY) {
        t.obj.position.y = t.floorY;
        if (t.vel.y < -1.5) {
          t.vel.y *= -0.35;
          t.vel.x *= 0.6;
          t.vel.z *= 0.6;
          t.spin.multiplyScalar(0.5);
        } else {
          t.vel.set(0, 0, 0);
          t.spin.multiplyScalar(0.8);
        }
      }
      if (t.life < 0.6) t.obj.scale.setScalar(t.scale * Math.max(0.001, t.life / 0.6));
      if (t.life <= 0) {
        t.obj.removeFromParent();
        this.tosses.splice(i, 1);
      }
    }
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const burst = this.bursts[b];
      burst.life -= dt;
      const n = burst.mesh.count;
      const fade = Math.min(1, burst.life / 0.8);
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        // flutter: strong drag once falling
        burst.vel[k + 1] += GRAVITY * 0.35 * dt;
        const drag = burst.vel[k + 1] < 0 ? 2.2 : 0.6;
        burst.vel[k] *= 1 - drag * dt;
        burst.vel[k + 2] *= 1 - drag * dt;
        if (burst.vel[k + 1] < -1.6) burst.vel[k + 1] = -1.6;
        burst.pos[k] += (burst.vel[k] + Math.sin(burst.life * 5 + i) * 0.4) * dt;
        burst.pos[k + 1] += burst.vel[k + 1] * dt;
        burst.pos[k + 2] += (burst.vel[k + 2] + Math.cos(burst.life * 4 + i) * 0.4) * dt;
        burst.rot[k] += dt * 7;
        burst.rot[k + 1] += dt * 5;
        _p.set(burst.pos[k], burst.pos[k + 1], burst.pos[k + 2]);
        _q.setFromEuler(_e.set(burst.rot[k], burst.rot[k + 1], burst.rot[k + 2]));
        _s.setScalar(fade);
        _m.compose(_p, _q, _s);
        burst.mesh.setMatrixAt(i, _m);
      }
      burst.mesh.instanceMatrix.needsUpdate = true;
      if (burst.life <= 0) {
        burst.mesh.removeFromParent();
        burst.mesh.dispose();
        this.bursts.splice(b, 1);
      }
    }
  }

  clear() {
    for (const t of this.tosses) t.obj.removeFromParent();
    this.tosses.length = 0;
    for (const b of this.bursts) {
      b.mesh.removeFromParent();
      b.mesh.dispose();
    }
    this.bursts.length = 0;
  }
}
