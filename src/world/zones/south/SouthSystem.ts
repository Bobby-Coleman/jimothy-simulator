import * as THREE from 'three';
import type { Game, System } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { southState, type SouthState, type LadderPool } from './state';
import { updateFlock } from './decor';
import { fish } from './props';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * Runtime for the west/south zones (park, locks, waterfront, stadium):
 *  - night glow (neon, lamps, stadium lights) driven by environment.nightFactor
 *  - decor animation: bobbing boats, swaying swings/kites/flags, spinning things, bird flocks, the bobblehead statue
 *  - fish ladder: every couple of seconds a salmon leaps up to the next pool
 *  - the Gum Wall: touch it and Jimothy is stuck for ~2 s (+150 "Stuck To The Gum Wall", emits 'gumWall')
 *  - occasional ambient sounds (crows, gulls, crowd)
 */
export class SouthSystem implements System {
  name = 'south';
  private game!: Game;
  private st!: SouthState;
  private lastNight = -1;
  private stuckUntil = 0;
  private stuckPos = new THREE.Vector3();
  private gumCooldown = 0;
  private froze = false;
  private strands: THREE.Mesh[] = [];
  private strandMat = new THREE.MeshStandardMaterial({ color: 0xff7ab8, roughness: 0.5 });
  private salmonSpawned = 0;

  init(game: Game) {
    this.game = game;
    this.st = southState(game);
    // Everything we animate must stay out of the StaticBatcher's merge.
    const st = this.st;
    const flag = (o: THREE.Object3D) => o.traverse((c) => (c.userData.noMerge = true));
    for (const b of st.bobbers) flag(b.obj);
    for (const s of st.swayers) flag(s.obj);
    for (const s of st.spinners) flag(s.obj);
    for (const w of st.wobblers) flag(w.obj);
  }

  update(dt: number, game: Game) {
    const st = this.st;
    const t = game.time;
    const player = game.get<any>('player');
    const pp: THREE.Vector3 | undefined = player?.position;

    // --- night glow
    const nf: number = game.get<any>('environment')?.nightFactor ?? 0;
    if (Math.abs(nf - this.lastNight) > 0.003) {
      this.lastNight = nf;
      for (const g of st.glows) {
        const v = g.day + (g.night - g.day) * nf;
        if (g.prop === 'opacity') {
          g.mat.opacity = v;
          g.mat.visible = v > 0.004;
        } else g.mat.emissiveIntensity = v;
      }
    }

    // --- decor animation
    for (const b of st.bobbers) {
      b.obj.position.y = b.baseY + Math.sin(t * b.speed + b.phase) * b.amp;
      b.obj.rotation.x = b.baseRotX + Math.sin(t * b.speed * 0.8 + b.phase) * b.roll;
      b.obj.rotation.z = b.baseRotZ + Math.cos(t * b.speed * 0.63 + b.phase) * b.roll;
    }
    for (const s of st.swayers) s.obj.rotation[s.axis] = s.base + Math.sin(t * s.speed + s.phase) * s.amp;
    for (const s of st.spinners) s.obj.rotation[s.axis] += s.speed * dt;
    for (const w of st.wobblers) {
      w.obj.rotation.z = Math.sin(t * w.speed) * w.amp;
      w.obj.rotation.x = Math.sin(t * w.speed * 0.71 + 1.3) * w.amp * 0.7;
    }
    for (const f of st.flocks) if (!pp || pp.distanceToSquared(f.center) < f.range * f.range) updateFlock(f, t);

    // --- ambience
    if (pp) {
      for (const a of st.ambience) {
        if (t < a.next) continue;
        a.next = t + a.every * (0.7 + Math.random() * 0.6);
        if (pp.distanceTo(a.pos) < a.radius) game.sfx(a.key, a.pos, a.volume);
      }
    }

    this.updateSalmon(t);
    this.updateGumWall(t, player);
  }

  // ---------------------------------------------------------------- fish ladder
  private poolIndex(p: { x: number; y: number; z: number }) {
    const pools = this.st.ladder.pools;
    for (let i = 0; i < pools.length; i++) {
      const c = pools[i];
      if (Math.abs(p.x - c.center.x) <= c.halfX + 0.15 && Math.abs(p.z - c.center.z) <= c.halfZ + 0.15 && p.y <= c.center.y + 0.45 && p.y >= c.floorY - 0.3) return i;
    }
    return -1;
  }

  private updateSalmon(t: number) {
    const L = this.st.ladder;
    if (!L.pools.length) return;
    if (t - L.lastLeap < 1.7) return;
    L.salmon = L.salmon.filter((e) => e.alive);
    const cands: { e: Entity; i: number }[] = [];
    let inLadder = 0;
    for (const e of L.salmon) {
      if (!e.body || e.data.heldByPlayer || e.data.draggedByPlayer) continue;
      const p = e.body.translation();
      const i = this.poolIndex(p);
      if (i < 0) {
        e.data.pool = -1;
        continue;
      }
      inLadder++;
      if (e.data.pool !== i) {
        e.data.pool = i;
        e.data.poolSince = t;
        continue;
      }
      const v = e.body.linvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z > 2.5) continue;
      if (t - (e.data.poolSince ?? t) < 1.4) continue;
      cands.push({ e, i });
    }
    // keep the ladder stocked if Jimothy walks off with the fish
    if (inLadder < 4 && this.salmonSpawned < 14 && L.spawnAt) {
      const s = fish(this.game, L.spawnAt.x + (Math.random() - 0.5) * 1.5, L.spawnAt.y, L.spawnAt.z + (Math.random() - 0.5) * 1.5, Math.PI, 'salmon', { sleeping: false });
      s.tags.add('salmonRun');
      L.salmon.push(s);
      this.salmonSpawned++;
      L.lastLeap = t;
      return;
    }
    if (!cands.length) return;
    const c = cands[Math.floor(Math.random() * cands.length)];
    L.lastLeap = t;
    if (c.i >= L.pools.length - 1) {
      // made it to the top → "swims upstream" and a new challenger appears at the bottom
      const b0 = L.pools[0];
      c.e.body!.setTranslation({ x: b0.center.x + (Math.random() - 0.5) * b0.halfX, y: b0.center.y - 0.1, z: b0.center.z + (Math.random() - 0.5) * b0.halfZ }, true);
      c.e.body!.setLinvel({ x: 0, y: 0, z: 0 }, true);
      c.e.data.pool = 0;
      c.e.data.poolSince = t;
      return;
    }
    this.leap(c.e, L.pools[c.i], L.pools[c.i + 1]);
  }

  private leap(e: Entity, from: LadderPool, to: LadderPool) {
    const body = e.body!;
    const p = body.translation();
    const g = -this.game.physics.gravity;
    const tx = to.center.x + (Math.random() - 0.5) * to.halfX;
    const tz = to.center.z + (Math.random() - 0.5) * to.halfZ * 0.8;
    const ty = to.center.y;
    const apex = Math.max(p.y, ty) + 1.0 + Math.random() * 0.5;
    const vy = Math.sqrt(2 * g * (apex - p.y));
    const T = vy / g + Math.sqrt((2 * (apex - ty)) / g);
    const vx = (tx - p.x) / T;
    const vz = (tz - p.z) / T;
    const yaw = Math.atan2(vx, vz);
    _q.setFromAxisAngle(Y, yaw).multiply(_q2.setFromAxisAngle(X, -0.9));
    body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    body.setLinvel({ x: vx, y: vy, z: vz }, true);
    _v.set(1, 0, 0).applyAxisAngle(Y, yaw).multiplyScalar(1.8 / T);
    body.setAngvel({ x: _v.x, y: _v.y, z: _v.z }, true);
    this.game.events.emit('salmonLeap', { entity: e, from: from.center, to: to.center });
    const pl = this.game.get<any>('player')?.position as THREE.Vector3 | undefined;
    if (pl && pl.distanceToSquared(from.center) < 900) this.game.sfx('splash', from.center, 0.35, 1.3);
  }

  // ---------------------------------------------------------------- gum wall
  private updateGumWall(t: number, player: any) {
    const gw = this.st.gumWall;
    if (!gw || !player?.body) return;
    const game = this.game;
    if (this.stuckUntil > 0) {
      if (t < this.stuckUntil) {
        if (this.froze) player.frozen = true;
        player.body.setTranslation({ x: this.stuckPos.x, y: this.stuckPos.y, z: this.stuckPos.z }, true);
        player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        player.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        player.body.setGravityScale(0, true);
        const k = 1 + Math.sin(t * 9) * 0.06;
        for (const s of this.strands) s.scale.set(k, 1, k);
        return;
      }
      this.stuckUntil = 0;
      if (this.froze) player.frozen = false;
      this.froze = false;
      player.body.setGravityScale(1.25 * (player.gravityMul ?? 1), true);
      player.body.setLinvel({ x: gw.normal * 3.2, y: 3, z: 0 }, true);
      this.gumCooldown = t + 2.5;
      for (const s of this.strands) s.removeFromParent();
      this.strands.length = 0;
      game.sfx('boing', player.position, 0.5, 1.5);
      return;
    }
    if (t < this.gumCooldown || game.state === 'cutscene') return;
    const p: THREE.Vector3 = player.position;
    const d = (p.x - gw.faceX) * gw.normal;
    if (d > 0.52 || d < -0.2 || p.z < gw.minZ || p.z > gw.maxZ || p.y < gw.minY || p.y > gw.maxY) return;
    this.stuckUntil = t + 2;
    this.stuckPos.set(gw.faceX + gw.normal * 0.42, p.y, p.z);
    this.froze = !player.frozen;
    player.frozen = true;
    if (player.held) player.release(false);
    game.score(150, 'Stuck To The Gum Wall', p.clone());
    game.events.emit('gumWall', { position: p.clone() });
    game.sfx('boing', p, 0.7, 0.55);
    game.hint('Jimothy is stuck to the Gum Wall. This is his life now. (For about two seconds.)', 2.5);
    // stretchy gum strands between Jimothy and the wall
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const from = new THREE.Vector3(gw.faceX + gw.normal * 0.02, this.stuckPos.y + Math.sin(a) * 0.3, this.stuckPos.z + Math.cos(a) * 0.3);
      const to = new THREE.Vector3(this.stuckPos.x - gw.normal * 0.2, this.stuckPos.y + Math.sin(a) * 0.18, this.stuckPos.z + Math.cos(a) * 0.18);
      const len = from.distanceTo(to);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, len, 5), this.strandMat);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(Y, to.clone().sub(from).normalize());
      game.scene.add(m);
      this.strands.push(m);
    }
  }
}
