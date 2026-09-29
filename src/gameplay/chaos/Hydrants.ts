import * as THREE from 'three';
import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { Game } from '../../core/Game';
import { G, groups } from '../../core/Physics';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { audio, type SoundHandle } from '../../audio/AudioManager';
import type { WaterVolume } from '../../world/Water';
import {
  type ChaosFeature, scanStaticCuboids, overlapBox, objProgress, addObjective, playerFree, nearCamera,
  clamp, rand, pick, fx, playerOf, rigOf, uiOf, groundY, paintMesh, T, Timers,
} from './shared';

/**
 * HYDRANT HYDRAULICS. Every fire hydrant in town (the chunky yellow ones on the avenue sidewalks, found by their
 * static colliders — no zone edits) bursts into a geyser when Jimothy bonks it, rolls into it, or when anything fast
 * (thrown props, flying humans, wrecked cars, explosions) hits it:
 *
 *  - a 7.5 m water column; Jimothy is launched and then bobs on top of it like a ping-pong ball on a fountain until
 *    the jet hiccups and yeets him (Geyser Rider / Hydrant Yeet); props and people float up there too
 *  - a puddle water volume ('sprinkler') around it for ~20 s, so he can WASH things in it (Fire Hydrant Laundromat)
 *  - re-arms ~20 s after bursting
 *
 * Events: 'hydrantBurst' { position, cause, index, byPlayer }, 'hydrantWash' { position }.
 * Objective: 'hydrantHydraulics' (pop 3 hydrants).
 */

const JET_H = 7.5;
const BURST_SECS = 13;
const FADE_SECS = 2.5;
const REARM_SECS = 20;
const PUDDLE_R = 1.75;
const COLUMN_R = 0.85;
const RIDE_YEET = 4.5;
const NOZZLE_H = 0.86;

const NPC_LINES = [
  'My SHOES!',
  'Free shower! Thanks, Jimothy!',
  'Is this a raccoon car wash?',
  'Somebody call the city!',
  '*gets soaked, maintains composure*',
  'Honestly? Refreshing.',
  'That hydrant had it coming.',
];

interface Hydrant {
  i: number;
  base: THREE.Vector3;
  nozzle: THREE.Vector3;
  /** Horizontal unit vector toward the road (hydrants face it). */
  roadDir: THREE.Vector3;
  active: boolean;
  t0: number;
  rearmAt: number;
  height: number;
  byPlayer: boolean;
  jet: THREE.Group | null;
  column: THREE.Mesh | null;
  crown: THREE.Mesh | null;
  puddle: THREE.Mesh | null;
  puddleR: number;
  vol: WaterVolume | null;
  hiss: SoundHandle | null;
  fxAcc: number;
  ringAcc: number;
  riding: number;
  rideScored: boolean;
  yeeted: boolean;
  ignorePlayerUntil: number;
  washed: boolean;
  knocked: Map<number, number>;
  own: boolean;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class HydrantFeature implements ChaosFeature {
  readonly id = 'hydrants';
  readonly list: Hydrant[] = [];
  private byHandle = new Map<number, Hydrant>();
  private bonkWindow = 0;
  private frame = 0;
  private bursts = 0;
  private timers: Timers;
  private tex: THREE.CanvasTexture | null = null;
  private jetMat: THREE.MeshStandardMaterial | null = null;
  private columnGeo: THREE.BufferGeometry | null = null;
  private crownGeo: THREE.BufferGeometry | null = null;
  private puddleGeo: THREE.BufferGeometry | null = null;

  constructor(private game: Game) {
    this.timers = new Timers(game);
  }

  init() {
    const game = this.game;
    addObjective(game, {
      id: 'hydrantHydraulics',
      category: 'chaos',
      points: 1200,
      target: 3,
      title: 'Hydrant Hydraulics',
      desc: "Pop 3 fire hydrants (bonk 'em!). The city's water bill is not a raccoon problem.",
    });
    const found = scanStaticCuboids(game, (h) => Math.abs(h.x - 0.2) < 0.012 && Math.abs(h.y - 0.4) < 0.012 && Math.abs(h.z - 0.2) < 0.012);
    for (const f of found) {
      this.addHydrant(f.center.clone().setY(f.center.y - f.half.y), f.yaw, false);
      this.byHandle.set(f.handle, this.list[this.list.length - 1]);
    }
    // hard hits on a hydrant's own collider (a rolling / flying Jimothy, thrown props, flying people, wrecked cars)
    game.physics.onContactForce((info) => {
      const h = this.byHandle.get(info.c1.handle) ?? this.byHandle.get(info.c2.handle);
      if (!h || !this.armed(h)) return;
      const other = this.byHandle.has(info.c1.handle) ? info.c2 : info.c1;
      this.onHit(h, other, info.force);
    });
    if (!this.list.length) this.buildFallback();
    const world = game.get<any>('world');
    // a POI for the nearest-to-spawn hydrant (maps / guides / tests)
    const spawn: THREE.Vector3 | undefined = world?.poi?.get('spawn');
    if (spawn && this.list.length) {
      const best = [...this.list].sort((a, b) => a.base.distanceToSquared(spawn) - b.base.distanceToSquared(spawn))[0];
      world.poi.set('hydrant', best.base.clone());
    }
    game.events.on('bonkStart', () => (this.bonkWindow = 0.36));
    game.events.on('explosion', (e: any) => this.onExplosion(e));
    game.events.on('wash', (e: any) => this.onWash(e));
    console.info(`[chaos] ${this.list.length} fire hydrants armed`);
  }

  private addHydrant(base: THREE.Vector3, yaw: number, own: boolean) {
    const roadDir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    if (!Number.isFinite(roadDir.x + roadDir.z) || roadDir.lengthSq() < 0.5) roadDir.set(0, 0, 1);
    this.list.push({
      i: this.list.length,
      base,
      nozzle: base.clone().setY(base.y + NOZZLE_H),
      roadDir,
      active: false,
      t0: -100,
      rearmAt: 0,
      height: 0,
      byPlayer: false,
      jet: null,
      column: null,
      crown: null,
      puddle: null,
      puddleR: 0,
      vol: null,
      hiss: null,
      fxAcc: 0,
      ringAcc: 0,
      riding: 0,
      rideScored: false,
      yeeted: false,
      ignorePlayerUntil: 0,
      washed: false,
      knocked: new Map(),
      own,
    });
  }

  /** No hydrants in the world (zone changed?): place three of our own on Ballard Ave. */
  private buildFallback() {
    const game = this.game;
    const Y = 0xf2c230;
    const R = 0xd8412f;
    for (const [x, z, yaw] of [
      [-36.5, -6.1, 0],
      [11.5, 6.1, Math.PI],
      [37.5, -6.1, 0],
    ]) {
      const y = groundY(game, x, z, 6);
      const mesh = paintMesh([
        { g: new THREE.CylinderGeometry(0.2, 0.22, 0.07, 12), c: Y, m: T(0, 0.035, 0) },
        { g: new THREE.CylinderGeometry(0.15, 0.16, 0.55, 12), c: Y, m: T(0, 0.34, 0) },
        { g: new THREE.CylinderGeometry(0.19, 0.19, 0.06, 12), c: Y, m: T(0, 0.62, 0) },
        { g: new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), c: R, m: T(0, 0.64, 0) },
      ]);
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      game.scene.add(mesh);
      game.get<any>('world')?.collider?.(new THREE.Vector3(x, y + 0.4, z), new THREE.Vector3(0.4, 0.8, 0.4), yaw);
      this.addHydrant(new THREE.Vector3(x, y, z), yaw, true);
    }
  }

  // --------------------------------------------------------------------------------------------- visuals
  private ensureShared() {
    if (this.jetMat) return;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgb(165,165,165)';
    ctx.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * 64;
      const w = 2 + Math.random() * 8;
      const y = Math.random() * 128;
      const h = 30 + Math.random() * 90;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      const a = 0.6 + Math.random() * 0.4;
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillRect(x, y - 128, w, h); // wrap vertically
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2.5);
    this.tex = tex;
    this.jetMat = new THREE.MeshStandardMaterial({
      color: 0xeaf8ff,
      emissive: 0x9fd8ff,
      emissiveIntensity: 0.4,
      map: tex,
      alphaMap: tex,
      transparent: true,
      opacity: 0.94,
      roughness: 0.1,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.CylinderGeometry(0.3, 0.17, 1, 16, 1, true);
    outer.translate(0, 0.5, 0);
    const core = new THREE.CylinderGeometry(0.15, 0.09, 1, 10, 1, true);
    core.translate(0, 0.5, 0);
    this.columnGeo = mergeGeometries([outer, core], false) ?? outer;
    // crown: a dome of spray + an umbrella skirt of water falling back down (UVs flipped so it flows downward)
    const dome = new THREE.SphereGeometry(0.46, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.75, 1);
    const skirt = new THREE.CylinderGeometry(0.42, 1.2, 1.2, 18, 1, true);
    skirt.translate(0, -0.6, 0);
    const uv = skirt.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.crownGeo = mergeGeometries([dome.toNonIndexed(), skirt.toNonIndexed()], false) ?? dome;
    const pud = new THREE.CircleGeometry(1, 28);
    pud.rotateX(-Math.PI / 2);
    this.puddleGeo = pud;
  }

  private ensureJet(h: Hydrant) {
    if (h.jet) return;
    this.ensureShared();
    const g = new THREE.Group();
    g.name = `hydrantJet${h.i}`;
    const column = new THREE.Mesh(this.columnGeo!, this.jetMat!);
    column.position.copy(h.nozzle).setY(h.nozzle.y - 0.12);
    column.castShadow = false;
    column.renderOrder = 3;
    const crown = new THREE.Mesh(this.crownGeo!, this.jetMat!);
    crown.castShadow = false;
    crown.renderOrder = 3;
    g.add(column, crown);
    g.visible = false;
    this.game.scene.add(g);
    h.jet = g;
    h.column = column;
    h.crown = crown;
    const water = this.game.get<any>('water');
    const pm: THREE.Material = water?.material?.('puddle') ?? this.jetMat!;
    const puddle = new THREE.Mesh(this.puddleGeo!, pm);
    puddle.position.copy(this.puddleCenter(h, _v));
    puddle.receiveShadow = true;
    puddle.renderOrder = 2;
    puddle.visible = false;
    this.game.scene.add(puddle);
    h.puddle = puddle;
  }

  /** Puddle centre: a little behind the hydrant (away from the curb) so it stays on the sidewalk. */
  private puddleCenter(h: Hydrant, out: THREE.Vector3) {
    out.copy(h.base).addScaledVector(h.roadDir, -0.75);
    out.y = h.base.y + 0.035;
    return out;
  }

  // --------------------------------------------------------------------------------------------- triggers
  /** Burst a hydrant (tests: `chaos.hydrants.burst(0)`). */
  burst(h: Hydrant | number, cause = 'script', byPlayer = true) {
    const game = this.game;
    const hy = typeof h === 'number' ? this.list[h] : h;
    if (!hy || hy.active || game.time < hy.rearmAt) return false;
    hy.active = true;
    hy.t0 = game.time;
    hy.rearmAt = game.time + REARM_SECS;
    hy.byPlayer = byPlayer;
    hy.riding = 0;
    hy.rideScored = false;
    hy.yeeted = false;
    hy.washed = false;
    hy.knocked.clear();
    this.ensureJet(hy);
    hy.jet!.visible = true;
    hy.puddle!.visible = true;
    // the puddle: a real (shallow) water volume, so Jimothy can wash things in it
    const water = game.get<any>('water');
    if (!hy.vol && water?.addCircle) {
      const c = this.puddleCenter(hy, _v);
      hy.vol = water.addCircle({ name: 'Hydrant Puddle', kind: 'sprinkler', center: c.clone(), radius: 0.5, depth: 0.12, visual: false });
    }
    if (hy.vol) hy.vol.enabled = true;
    const top = hy.nozzle.clone().setY(hy.nozzle.y + 0.3);
    game.sfx('impact_metal', hy.nozzle, 1, 0.8);
    game.sfx('splash_big', top, 0.9, 1.15);
    try {
      hy.hiss?.stop(0.1);
      hy.hiss = audio.play('water_loop', { position: hy.nozzle.clone(), loop: true, volume: 1.4, pitch: 1.75 });
    } catch {
      hy.hiss = null;
    }
    fx(game, 'splash', top, { strength: 12 });
    fx(game, 'droplets', top, { count: 14 });
    const pl = playerOf(game);
    if (pl?.position && pl.position.distanceTo(hy.nozzle) < 14) rigOf(game)?.shake(0.35);
    const npcs = game.get<any>('npcs');
    try {
      npcs?.alarm?.(hy.nozzle, 10, 'hydrant');
      const near: any[] = npcs?.near?.(hy.nozzle, 12, (n: any) => !n.ragdolled && !n.removed && !n.isCustom) ?? [];
      if (near.length) {
        const n = pick(near);
        this.timers.after(0.5, () => {
          if (!n.removed && !n.ragdolled) {
            n.say?.(pick(NPC_LINES), 2.6);
            n.setExpression?.(Math.random() < 0.5 ? 'shock' : 'happy');
          }
        });
      }
    } catch {
      /* optional */
    }
    this.bursts++;
    if (byPlayer || (pl?.position && pl.position.distanceTo(hy.nozzle) < 30)) {
      game.score(250, 'Hydrant Hydraulics', top.clone().setY(top.y + 1));
      objProgress(game, 'hydrantHydraulics');
    }
    if (this.bursts === 1) game.hint("The city's water bill is not Jimothy's problem. Wash things in the puddle!", 3.5);
    game.events.emit('hydrantBurst', { position: hy.nozzle.clone(), cause, index: hy.i, byPlayer });
    return true;
  }

  private armed(h: Hydrant) {
    return !h.active && this.game.time >= h.rearmAt;
  }

  /** Contact-force hit on a hydrant collider (called after the physics step; safe to act). */
  private onHit(h: Hydrant, other: RAPIER_T.Collider, force: number) {
    const game = this.game;
    const b = other.parent();
    if (!b) return;
    const e = game.entities.fromCollider(other);
    const pl = playerOf(game);
    if (e?.kind === 'player') {
      // walking into it is just bumping; a ball or a flying raccoon pops it
      if (!pl || (pl.mode !== 'roll' && pl.mode !== 'ragdoll') || !playerFree(game)) return;
      if (force < 1800) return;
      this.burst(h, pl.mode === 'roll' ? 'roll' : 'player', true);
      if (pl.mode === 'roll') h.ignorePlayerUntil = game.time + 0.45;
      return;
    }
    if (!b.isDynamic() || e?.data?.heldByPlayer) return;
    // estimated impact speed (Δv from the impulse + what's left)
    const m = Math.max(0.05, b.mass());
    const J = force * (game.physics.world.timestep || 1 / 60);
    const lv = b.linvel();
    const pre = Math.hypot(lv.x, lv.y, lv.z) + J / m;
    if (pre < 4.5) return;
    const near = !!pl?.position && pl.position.distanceTo(h.base) < 35;
    this.burst(h, e?.kind === 'vehicle' ? 'vehicle' : e?.kind === 'npc' ? 'ragdoll' : 'prop', near);
  }

  private onExplosion(e: any) {
    const p: THREE.Vector3 | undefined = e?.position;
    if (!p) return;
    const r = (e.radius ?? 6) + 1.5;
    for (const h of this.list) if (this.armed(h) && h.base.distanceTo(p) < r) this.timers.after(0.15 + Math.random() * 0.25, () => this.burst(h, 'explosion', true));
  }

  private onWash(e: any) {
    if (e?.water !== 'sprinkler') return;
    const pl = playerOf(this.game);
    if (!pl?.position) return;
    for (const h of this.list) {
      if (!h.active || h.washed) continue;
      if (Math.hypot(pl.position.x - h.base.x, pl.position.z - h.base.z) > 3.6) continue;
      h.washed = true;
      this.game.score(150, 'Fire Hydrant Laundromat', pl.position.clone().setY(pl.position.y + 1));
      this.game.events.emit('hydrantWash', { position: h.base.clone(), entity: e.entity });
      break;
    }
  }

  private checkTriggers(dt: number) {
    const game = this.game;
    const pl = playerOf(game);
    if (!pl?.position || !playerFree(game)) return;
    const pos: THREE.Vector3 = pl.position;
    this.bonkWindow -= dt;
    const bonking = this.bonkWindow > 0;
    const rolling = pl.mode === 'roll' && pl.speed > 4.5;
    const flying = pl.mode === 'ragdoll' && pl.velocity?.length?.() > 7;
    if (bonking || rolling || flying) {
      const f = _w.set(Math.sin(pl.facing), 0, Math.cos(pl.facing));
      const probe = _v.copy(pos).addScaledVector(f, bonking ? 0.45 : 0.1);
      for (const h of this.list) {
        if (!this.armed(h)) continue;
        const d = Math.hypot(probe.x - h.base.x, probe.z - h.base.z);
        if (d > (bonking ? 0.8 : 0.72) || Math.abs(probe.y - (h.base.y + 0.45)) > 0.95) continue;
        this.burst(h, bonking ? 'bonk' : rolling ? 'roll' : 'player', true);
        if (bonking) this.bonkWindow = 0;
        // a ball rolling into it bounces off first (only lingering in the column gets him lifted)
        if (rolling) h.ignorePlayerUntil = game.time + 0.45;
        break;
      }
    }
    // fast things hitting hydrants (thrown props, flying humans, wrecked cars)
    this.frame++;
    if (this.frame % 4 !== 0) return;
    const filter = groups(G.ALL, G.PROP | G.RAGDOLL | G.VEHICLE);
    for (const h of this.list) {
      if (!this.armed(h) || !nearCamera(game, h.base, 80)) continue;
      const cols = game.physics.overlapSphere(_v.copy(h.base).setY(h.base.y + 0.45), 0.6, filter);
      let hit: { cause: string } | null = null;
      for (const c of cols) {
        const b = c.parent();
        if (!b) continue;
        const e = game.entities.fromCollider(c);
        let speed = 0;
        if (b.isDynamic()) {
          const lv = b.linvel();
          speed = Math.hypot(lv.x, lv.y, lv.z);
        } else if (e?.kind === 'vehicle') {
          const v = e.data?.velocity as THREE.Vector3 | undefined;
          speed = v ? v.length() : 0;
        }
        if (e?.data?.heldByPlayer) continue;
        if (speed > 4.5) {
          hit = { cause: e?.kind === 'vehicle' ? 'vehicle' : e?.kind === 'npc' ? 'ragdoll' : 'prop' };
          break;
        }
      }
      if (hit) this.burst(h, hit.cause, pos.distanceTo(h.base) < 35);
    }
  }

  // --------------------------------------------------------------------------------------------- update
  update(dt: number) {
    const game = this.game;
    this.timers.tick();
    this.checkTriggers(dt);
    let anyActive = false;
    for (const h of this.list) {
      if (h.active) {
        anyActive = true;
        this.stepJet(h, dt);
      } else if (h.puddleR > 0) {
        this.dryPuddle(h, dt);
      }
    }
    if (anyActive && this.tex) this.tex.offset.y = (this.tex.offset.y - dt * 3.2) % 1;
  }

  private stepJet(h: Hydrant, dt: number) {
    const game = this.game;
    const age = game.time - h.t0;
    if (age > BURST_SECS + FADE_SECS) {
      this.endJet(h);
      return;
    }
    const up = clamp(age / 0.3, 0, 1);
    let down = 1;
    if (age > BURST_SECS) {
      const k = (age - BURST_SECS) / FADE_SECS;
      down = Math.max(0, 1 - k) * (0.65 + 0.35 * Math.abs(Math.sin(age * 11)));
    }
    const wob = 1 + 0.06 * Math.sin(age * 8.3 + h.i) + 0.03 * Math.sin(age * 21);
    h.height = JET_H * up * down * wob;
    const hh = Math.max(0.02, h.height);
    const col = h.column!;
    const pulse = 1 + 0.08 * Math.sin(age * 31);
    col.scale.set(pulse, hh + 0.12, pulse);
    const crown = h.crown!;
    crown.position.set(h.nozzle.x, h.nozzle.y + hh, h.nozzle.z);
    const cs = clamp(hh / 2.5, 0.15, 1) * (1 + 0.14 * Math.sin(age * 13 + 1));
    crown.scale.set(cs, cs * (1 + 0.2 * Math.sin(age * 17)), cs);
    // puddle grows
    h.puddleR = Math.min(PUDDLE_R, h.puddleR + dt * 1.1);
    this.applyPuddle(h);
    // spray
    if (nearCamera(game, h.nozzle, 90)) {
      h.fxAcc += dt;
      h.ringAcc += dt;
      if (h.fxAcc > 0.08 && hh > 0.5) {
        h.fxAcc = 0;
        fx(game, 'droplets', _v.set(h.nozzle.x, h.nozzle.y + hh, h.nozzle.z), { count: 5 });
      }
      if (h.ringAcc > 0.55) {
        h.ringAcc = 0;
        fx(game, 'splash', this.puddleCenter(h, _v).setY(h.base.y + 0.05), { strength: 2.5 + Math.random() * 2 });
      }
    }
    if (h.hiss) {
      h.hiss.setVolume(1.4 * clamp(hh / 3, 0.2, 1));
      h.hiss.setPitch(1.5 + 0.35 * (hh / JET_H));
    }
    if (hh > 0.4) this.push(h, dt, hh);
  }

  private endJet(h: Hydrant) {
    h.active = false;
    h.height = 0;
    if (h.jet) h.jet.visible = false;
    try {
      h.hiss?.stop(0.4);
    } catch {
      /* ignore */
    }
    h.hiss = null;
  }

  private applyPuddle(h: Hydrant) {
    const r = Math.max(0.01, h.puddleR);
    if (h.puddle) h.puddle.scale.set(r, 1, r);
    if (h.vol) {
      h.vol.radius = r;
      h.vol.halfX = r;
      h.vol.halfZ = r;
    }
  }

  private dryPuddle(h: Hydrant, dt: number) {
    // the puddle lingers a little, then shrinks away
    if (this.game.time - h.t0 < BURST_SECS + FADE_SECS + 3) return;
    h.puddleR = Math.max(0, h.puddleR - dt * 0.45);
    this.applyPuddle(h);
    if (h.puddleR <= 0.05) {
      h.puddleR = 0;
      if (h.puddle) h.puddle.visible = false;
      if (h.vol) {
        try {
          this.game.get<any>('water')?.remove?.(h.vol);
        } catch {
          /* ignore */
        }
        h.vol = null;
      }
    }
  }

  // --------------------------------------------------------------------------------------------- physics
  /** Everything in the column floats up to the crown and bobs there. */
  private push(h: Hydrant, dt: number, hh: number) {
    const game = this.game;
    const top = h.nozzle.y + hh;
    // Jimothy
    const pl = playerOf(game);
    if (pl?.body && playerFree(game) && game.time >= h.ignorePlayerUntil) {
      const p: THREE.Vector3 = pl.position;
      const dx = p.x - h.nozzle.x;
      const dz = p.z - h.nozzle.z;
      if (dx * dx + dz * dz < COLUMN_R * COLUMN_R && p.y > h.base.y - 0.3 && p.y < top + 1.3 && pl.mode !== 'swim') this.pushPlayer(h, pl, dt, top);
      else if (h.riding > 0 && (dx * dx + dz * dz > 2.2 * 2.2 || p.y < h.base.y + 0.3)) h.riding = 0;
    }
    // props, ragdolls, walking humans
    const center = _v.set(h.nozzle.x, (h.base.y + top) / 2 + 0.4, h.nozzle.z);
    const half = _w.set(COLUMN_R * 0.85, (top - h.base.y) / 2 + 0.7, COLUMN_R * 0.85);
    const cols = overlapBox(game, center, half, 0, groups(G.ALL, G.PROP | G.RAGDOLL | G.NPC));
    const seen = new Set<number>();
    const bodies: RAPIER_T.RigidBody[] = [];
    const walkers: any[] = [];
    const npcs = game.get<any>('npcs');
    for (const c of cols) {
      const b = c.parent();
      if (!b || seen.has(b.handle)) continue;
      seen.add(b.handle);
      const e = game.entities.fromCollider(c);
      if (e?.kind === 'player' || e?.data?.heldByPlayer) continue;
      if (b.isDynamic()) {
        if (bodies.length < 24) bodies.push(b);
      } else if (e?.kind === 'npc') {
        const npc = npcs?.fromEntity?.(e);
        if (npc && !npc.ragdolled && !npc.removed) walkers.push(npc);
      }
    }
    for (const npc of walkers) {
      const last = h.knocked.get(npc.entity.id) ?? -10;
      if (game.time - last < 1.5) continue;
      h.knocked.set(npc.entity.id, game.time);
      try {
        npc.knockDown({ cause: 'hydrant', dv: new THREE.Vector3(rand(-1.5, 1.5), 12, rand(-1.5, 1.5)), byPlayer: h.byPlayer, flail: 1 });
      } catch {
        /* optional */
      }
    }
    for (const b of bodies) this.hover(b, h, dt, top + 0.3, 1);
  }

  private hover(b: RAPIER_T.RigidBody, h: Hydrant, dt: number, targetY: number, strength: number, lateral = 1) {
    const m = b.mass();
    if (!(m > 0)) return;
    const t = b.translation();
    const v = b.linvel();
    const lift = m > 160 ? 0.55 : 1;
    const err = targetY - t.y;
    const ay = clamp((14 + 12 * err - 4.6 * v.y) * lift * strength, -2, 46);
    const ax = (-(t.x - h.nozzle.x) * 7 - v.x * 1.3 + rand(-3, 3)) * lateral;
    const az = (-(t.z - h.nozzle.z) * 7 - v.z * 1.3 + rand(-3, 3)) * lateral;
    b.applyImpulse({ x: m * ax * dt, y: m * ay * dt, z: m * az * dt }, true);
    if (Math.random() < 0.05) b.applyTorqueImpulse({ x: rand(-1, 1) * m * 0.05, y: rand(-1, 1) * m * 0.05, z: rand(-1, 1) * m * 0.05 }, true);
  }

  private pushPlayer(h: Hydrant, pl: any, dt: number, top: number) {
    const game = this.game;
    const body = pl.body as RAPIER_T.RigidBody;
    const M = body.mass() || 12;
    pl.wetness = 1;
    // A tucked-up Jimothy stays a ball on the jet (bowling combos survive) and can steer off it; anyone else flops.
    const rolling = pl.mode === 'roll';
    if (pl.mode !== 'ragdoll' && !rolling) {
      // WHOOSH: straight up the jet
      if (pl.held) pl.release?.(false);
      pl.ragdoll('hydrant', 1.2, new THREE.Vector3(rand(-0.4, 0.4) * M, 13 * M, rand(-0.4, 0.4) * M));
      game.sfx('squeak', pl.position, 0.9, 1.1);
      game.sfx('whoosh', pl.position, 0.8);
      if (h.riding <= 0) h.riding = 0.001;
      return;
    }
    if (rolling && h.riding <= 0) {
      body.applyImpulse({ x: 0, y: M * 9, z: 0 }, true);
      game.sfx('boing', pl.position, 0.8, 1.2);
    }
    if (!rolling) pl.ragdoll('hydrant', 0.6); // keep flopping while on the jet
    h.riding += dt;
    const steering = rolling && game.input.move.lengthSq() > 0.09;
    this.hover(body, h, dt, top + 0.55 + Math.sin(game.time * 7) * 0.22, 1, steering ? 0.15 : 1);
    if (h.riding > 1.4 && !h.rideScored) {
      h.rideScored = true;
      game.score(150, 'Geyser Rider', pl.position.clone().setY(pl.position.y + 1));
      game.hint('Jimothy is a ping-pong ball now. This is his life.', 2.6);
    }
    if (h.riding > RIDE_YEET && !h.yeeted) {
      // the jet hiccups and yeets him
      h.yeeted = true;
      h.ignorePlayerUntil = game.time + 3;
      const a = Math.random() * Math.PI * 2;
      body.applyImpulse({ x: Math.cos(a) * M * 9, y: M * 11, z: Math.sin(a) * M * 9 }, true);
      game.score(250, 'Hydrant Yeet', pl.position.clone().setY(pl.position.y + 1));
      game.sfx('boing', pl.position, 1, 0.8);
      game.sfx('crowd_ooh', pl.position, 0.6);
      fx(game, 'splash', pl.position, { strength: 9 });
      uiOf(game)?.celebrate?.('YEET!', 'Hydrant Hydraulics', '#5cc8ff');
    }
  }

  /** Debug/test: teleport next to hydrant i (facing it). */
  visit(i = 0) {
    const h = this.list[i];
    const pl = playerOf(this.game);
    if (!h || !pl) return false;
    const at = h.base.clone().addScaledVector(h.roadDir, -1.1);
    at.y = groundY(this.game, at.x, at.z, h.base.y + 2) + 0.45;
    pl.teleport(at, Math.atan2(h.base.x - at.x, h.base.z - at.z));
    return true;
  }

  /** Nearest hydrant to a point. */
  nearest(p: THREE.Vector3) {
    let best: Hydrant | null = null;
    let bd = Infinity;
    for (const h of this.list) {
      const d = h.base.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }
}

