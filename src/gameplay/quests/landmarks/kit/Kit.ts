import * as THREE from 'three';
import type { Game } from '../../../../core/Game';
import type { Entity } from '../../../../core/Entities';
import { RAPIER, G, groups } from '../../../../core/Physics';
import type { World } from '../../../../world/World';
import type { Jimothy } from '../../../../player/Jimothy';
import { MAP, onMainRoad } from '../../../../world/terrain';
import { Overlay } from './Overlay';
import { Particles } from './Particles';
import { FigureActor, NpcActor, type Actor, type ActorOpts } from './Actors';

const WORLD_ONLY = groups(G.ALL, G.WORLD);
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();

const GOLD_SUN = new THREE.Color(1, 0.72, 0.32);
const GOLD_SKY = new THREE.Color(1, 0.8, 0.45);
const GOLD_FOG = new THREE.Color(1, 0.78, 0.5);

/**
 * Shared toolbox for landmark events: POI lookup with fallbacks, ground queries, clear-spot search,
 * UI adapters (dialog / banner / toast) that use the real UI when present and a local overlay otherwise,
 * FX adapters with local fallbacks, actors (NPCs or stand-ins), game-time timers and the golden sky flash.
 */
export class Kit {
  readonly overlay: Overlay;
  readonly particles: Particles;
  readonly actors = new Set<Actor>();
  private timers: { at: number; fn: () => void }[] = [];
  private reserved: { x: number; z: number; r: number }[] = [];
  private goldT = 0;
  private goldDur = 0;

  private itemsMod: any = null;
  private handoffs: { e: Entity; phase: number; cb?: (ok: boolean) => void }[] = [];

  constructor(readonly game: Game) {
    this.overlay = new Overlay(game);
    this.particles = new Particles(game.scene);
    // The items module is optional (built by another helper): load it if it exists.
    const mods = import.meta.glob('../../../items/Items.ts');
    for (const k in mods)
      mods[k]()
        .then((m) => (this.itemsMod = m))
        .catch(() => {});
  }

  // ------------------------------------------------------------------ items
  /**
   * Spawn an item of `kind` ('fish' | 'diploma' | 'rookiecard' …) from the items system when it exists,
   * otherwise via `fallback()`. `cb` receives the entity (possibly later, if the items system is async).
   */
  spawnItem(kind: string, pos: THREE.Vector3, fallback: () => Entity, cb: (e: Entity) => void) {
    const take = (e: any) => {
      if (e && typeof e === 'object' && e.body && e.kind) {
        cb(e as Entity);
        return true;
      }
      return false;
    };
    try {
      const sys = this.game.get<any>('items');
      const fn = sys?.spawn ?? sys?.spawnItem;
      let r: any = typeof fn === 'function' ? fn.call(sys, kind, pos.clone()) : undefined;
      if (r == null && typeof this.itemsMod?.spawnItem === 'function') r = this.itemsMod.spawnItem(this.game, kind, pos.clone());
      if (r && typeof r.then === 'function') {
        r.then((e: any) => {
          if (!take(e)) cb(fallback());
        }).catch(() => cb(fallback()));
        return;
      }
      if (take(r)) return;
    } catch (err) {
      console.warn(`[landmarks] spawnItem(${kind}) failed, using fallback`, err);
    }
    cb(fallback());
  }

  /** Jimothy's grab point (mirrors the private Jimothy.handPoint). */
  handPoint(out = new THREE.Vector3()): THREE.Vector3 {
    const p = this.player;
    if (!p) return out;
    return out.copy(p.position).addScaledVector(p.forwardVec(_v), 0.5).add(_v.set(0, 0.02, 0));
  }

  /** Can Jimothy take something into his paws right now? */
  canTake(): boolean {
    const p = this.player;
    return !!p && (p.mode === 'walk' || p.mode === 'swim' || p.mode === 'climb');
  }

  /**
   * Put a prop entity into Jimothy's paws using his own grab logic: this frame the prop is parked at his
   * hand point; after the physics step (so scene queries see it there) `player.tryGrab()` picks it up.
   * If he can't hold things right now it's dropped in front of him instead. cb(true) when he holds it.
   */
  handToPlayer(e: Entity, cb?: (ok: boolean) => void) {
    this.handoffs = this.handoffs.filter((h) => h.e !== e);
    this.handoffs.push({ e, phase: 0, cb });
  }

  private runHandoffsPre() {
    for (const h of this.handoffs) {
      if (h.phase !== 0) continue;
      const e = h.e;
      const b = e.body;
      if (!e.alive || !b || !this.game.physics.world.getRigidBody(b.handle)) {
        h.phase = -1;
        h.cb?.(false);
        continue;
      }
      const hp = this.handPoint(new THREE.Vector3());
      if (!this.canTake()) {
        b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        b.setTranslation({ x: hp.x, y: hp.y + 0.5, z: hp.z }, true);
        b.setLinvel({ x: 0, y: 1, z: 0 }, true);
        h.phase = -1;
        h.cb?.(false);
        continue;
      }
      const p = this.player!;
      if (p.held && p.held.entity !== e) p.release(false);
      b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      b.setTranslation({ x: hp.x, y: hp.y, z: hp.z }, true);
      b.setNextKinematicTranslation({ x: hp.x, y: hp.y, z: hp.z });
      h.phase = 1;
    }
  }

  postPhysics() {
    for (const h of this.handoffs) {
      if (h.phase !== 1) continue;
      h.phase = -1;
      const e = h.e;
      const b = e.body;
      const p = this.player;
      if (!e.alive || !b || !p || !this.game.physics.world.getRigidBody(b.handle)) {
        h.cb?.(false);
        continue;
      }
      b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (!p.held) p.tryGrab();
      const ok = p.held?.entity === e;
      h.cb?.(ok);
    }
    this.handoffs = this.handoffs.filter((h) => h.phase >= 0);
  }

  get world() {
    return this.game.get<World>('world')!;
  }
  get player() {
    return this.game.get<Jimothy>('player');
  }
  get npcs(): any {
    return this.game.get<any>('npcs');
  }
  get ui(): any {
    return this.game.get<any>('ui');
  }

  // ------------------------------------------------------------------ places
  /** A copy of a named POI, or undefined. */
  poi(name: string): THREE.Vector3 | undefined {
    const p = this.game.get<World>('world')?.poi.get(name);
    return p ? p.clone() : undefined;
  }

  /** Surface height below (x, fromY, z) — static world only; falls back to the terrain. */
  groundY(x: number, z: number, fromY = 160, maxDist = 400): number {
    const hit = this.game.physics.raycast(_v.set(x, fromY, z), DOWN, maxDist, WORLD_ONLY);
    if (hit) return hit.point.y;
    return this.world.heightAt(x, z);
  }

  /** True if nothing static stands on the ground around (x, z) within `r`, it's dry land and not on a main road. */
  isClear(x: number, z: number, r: number): boolean {
    if (z > MAP.seawallZ - 6 - r || Math.abs(x) > MAP.half - 6 - r || Math.abs(z) > MAP.half + 6) return false;
    for (const q of this.reserved) if (Math.hypot(q.x - x, q.z - z) < q.r + r) return false;
    const pts: [number, number][] = [[0, 0]];
    for (let i = 0; i < 8; i++) pts.push([Math.cos((i / 8) * Math.PI * 2) * r, Math.sin((i / 8) * Math.PI * 2) * r]);
    for (let i = 0; i < 4; i++) pts.push([Math.cos((i / 4) * Math.PI * 2 + 0.6) * r * 0.5, Math.sin((i / 4) * Math.PI * 2 + 0.6) * r * 0.5]);
    const h0 = this.world.heightAt(x, z);
    for (const [dx, dz] of pts) {
      const px = x + dx;
      const pz = z + dz;
      if (onMainRoad(px, pz)) return false;
      const th = this.world.heightAt(px, pz);
      if (Math.abs(th - h0) > 1.2) return false;
      const gy = this.groundY(px, pz, th + 60, 90);
      if (gy > th + 0.25) return false;
    }
    return true;
  }

  /** Spiral search for a clear, flat spot near (x, z). Returns a ground point. */
  findClearSpot(x: number, z: number, r: number, maxRadius = 90): THREE.Vector3 {
    for (let ring = 0; ring * 5 <= maxRadius; ring++) {
      const rad = ring * 5;
      const n = ring === 0 ? 1 : Math.max(6, Math.round((rad * Math.PI * 2) / 6));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.37;
        const px = x + Math.cos(a) * rad;
        const pz = z + Math.sin(a) * rad;
        if (this.isClear(px, pz, r)) return new THREE.Vector3(px, this.world.heightAt(px, pz), pz);
      }
    }
    return new THREE.Vector3(x, this.world.heightAt(x, z), z);
  }

  reserve(p: THREE.Vector3, r: number) {
    this.reserved.push({ x: p.x, z: p.z, r });
  }

  /** Snap a point to the surface under it (searching from a bit above). */
  onGround(p: THREE.Vector3, above = 1.5, maxDown = 6): THREE.Vector3 {
    return new THREE.Vector3(p.x, this.groundY(p.x, p.z, p.y + above, above + maxDown), p.z);
  }

  // ------------------------------------------------------------------ timing
  after(secs: number, fn: () => void) {
    this.timers.push({ at: this.game.time + secs, fn });
  }

  // ------------------------------------------------------------------ UI adapters
  /**
   * Show dialogue lines. Uses ui.showDialog when present; otherwise the local overlay.
   * `onDone` is guaranteed to fire (once): when the dialog finishes or after a game-time safety timeout,
   * so a ceremony never gets stuck.
   */
  dialog(speaker: string, lines: string[], onDone?: () => void, opts: { maxSecs?: number; portrait?: string; color?: string } = {}) {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      onDone?.();
    };
    const ui = this.ui;
    if (ui && typeof ui.showDialog === 'function') {
      try {
        // The real dialog waits for the player (E / Space / click); the timeout only prevents a stuck ceremony.
        const max = opts.maxSecs ?? 40 + lines.length * 8;
        this.after(max, () => {
          if (finished) return;
          const box = ui.dialog;
          if (box?.open && box.cur?.speaker === speaker && typeof box.close === 'function') box.close();
          done();
        });
        ui.showDialog({ speaker, lines, onDone: done, portrait: opts.portrait, color: opts.color });
        return;
      } catch (err) {
        console.warn('[landmarks] ui.showDialog failed, using fallback', err);
      }
    }
    const max = opts.maxSecs ?? lines.reduce((a, l) => a + 2 + l.length * 0.05, 0) + 4;
    this.after(max, () => {
      if (finished) return;
      if (this.overlay.dialogOpen) this.overlay.closeDialog();
      done();
    });
    this.overlay.dialog(speaker, lines, done);
  }

  /** Big announcement banner (title + subtitle, optional small kicker line above). */
  banner(title: string, sub?: string, secs = 3, kicker = '') {
    const ui = this.ui;
    if (ui && typeof ui.banner === 'function') {
      try {
        ui.banner(title, sub, kicker);
        return;
      } catch (err) {
        console.warn('[landmarks] ui.banner failed, using fallback', err);
      }
    }
    this.overlay.banner(title, sub, secs);
  }

  /** Short big centre shout ("3", "GO!", "CAUGHT IT!"). */
  shout(word: string, sub?: string, color?: string) {
    const ui = this.ui;
    if (ui && typeof ui.celebrate === 'function') {
      try {
        ui.celebrate(word, sub, color);
        return;
      } catch (err) {
        console.warn('[landmarks] ui.celebrate failed, using fallback', err);
      }
    }
    this.overlay.banner(word, sub, 1.1);
  }

  /**
   * Speech bubble over a 3D object (stand-in figures, crowd chants): the UI's bubbles when present,
   * else the local overlay.
   */
  speech(object: THREE.Object3D, anchor: () => THREE.Vector3 | null, text: string, secs = 2.6, style?: 'shout' | 'whisper', key?: unknown) {
    if (this.hasListeners('speech')) {
      this.game.events.emit('speech', { object, text, duration: secs, style, key: key ?? object });
      return;
    }
    this.overlay.clearBubbles(anchor);
    this.overlay.bubble(anchor, text, secs, { big: style === 'shout' });
  }

  /** Toast card (objective-style). Emits the shared 'toast' event when someone listens, else local. */
  toast(title: string, text?: string, icon?: string) {
    const ui = this.ui;
    if (ui && typeof ui.toast === 'function') {
      try {
        ui.toast(title, text, icon);
        return;
      } catch (err) {
        console.warn('[landmarks] ui.toast failed, using fallback', err);
      }
    }
    if (this.hasListeners('toast')) this.game.events.emit('toast', { title, text, icon });
    else this.overlay.toast(title, text);
  }

  hint(text: string, secs = 3) {
    this.game.hint(text, secs);
  }

  hasListeners(name: string): boolean {
    const map = (this.game.events as any).map as Map<string, Set<unknown>> | undefined;
    return !!map?.get(name)?.size;
  }

  /**
   * Particle effect. Uses the FX system (`game.get('fx').emit(kind, pos, opts)`, kinds like 'confetti',
   * 'fireworks', 'sparkles', 'hearts', 'exclaim', 'money', 'splash') when present; otherwise the matching
   * event if anyone listens; otherwise a local confetti fallback for the celebratory kinds.
   */
  fx(kind: string, position: THREE.Vector3, opts: Record<string, any> = {}) {
    const fx = this.game.get<any>('fx');
    if (fx && typeof fx.emit === 'function') {
      try {
        fx.emit(kind, position.clone(), opts);
        return;
      } catch (err) {
        console.warn('[landmarks] fx.emit failed', kind, err);
      }
    }
    const evName = kind === 'sparkles' ? 'sparkle' : kind;
    if (this.hasListeners(evName)) {
      this.game.events.emit(evName, { position: position.clone(), ...opts });
      return;
    }
    if (kind === 'confetti' || kind === 'fireworks') this.particles.confetti(position, opts.count ? Math.max(40, opts.count * 12) : 90, opts.scale ?? 1);
  }

  /** Warm golden wash over the sky/lights for `secs` (Jimothy Summer). */
  goldenFlash(secs = 6) {
    this.goldT = 0;
    this.goldDur = secs;
  }

  // ------------------------------------------------------------------ actors
  spawnActor(opts: ActorOpts): Actor {
    const npcs = this.npcs;
    if (!opts.figureOnly && npcs && typeof npcs.spawn === 'function') {
      try {
        const npc = npcs.spawn({
          type: opts.type,
          position: opts.position.clone(),
          name: opts.name,
          stationary: opts.stationary ?? true,
          lookAtPlayer: opts.lookAtPlayer ?? true,
          facing: opts.facing,
          passive: opts.passive ?? true,
          holding: null,
          ...(opts.look ? { outfit: opts.look } : {}),
        });
        if (npc && typeof npc === 'object' && typeof npc.then !== 'function') {
          // npcs.spawn snaps to the first surface below +30 m, which puts NPCs on the roof when the spot
          // is under cover (City Hall portico). Re-seat from just above the spot and fix their home.
          if (typeof npc.teleport === 'function') {
            npc.teleport(opts.position.clone(), opts.facing);
            if (npc.home?.center && npc.position) npc.home.center.copy(npc.position);
          }
          const a = new NpcActor(this, npc, opts);
          if (opts.facing != null) a.face(opts.facing);
          this.actors.add(a);
          return a;
        }
      } catch (err) {
        console.warn('[landmarks] npcs.spawn failed, using a stand-in figure', err);
      }
    }
    const a = new FigureActor(this, opts);
    this.actors.add(a);
    return a;
  }

  removeActor(a: Actor | null | undefined) {
    if (!a) return;
    this.actors.delete(a);
    try {
      a.dispose();
    } catch (err) {
      console.warn('[landmarks] actor dispose failed', err);
    }
  }

  // ------------------------------------------------------------------ ticking
  update(dt: number) {
    this.runHandoffsPre();
    const now = this.game.time;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= now);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > now);
        for (const t of due) {
          try {
            t.fn();
          } catch (err) {
            console.error('[landmarks] timer failed', err);
          }
        }
      }
    }
    for (const a of this.actors) {
      if (!a.alive) {
        this.actors.delete(a);
        continue;
      }
      a.update(dt);
    }
    this.particles.update(dt);
    this.overlay.update(dt);
  }

  lateUpdate(dt: number) {
    this.overlay.lateUpdate(dt);
    if (this.goldDur > 0) {
      this.goldT += dt;
      const t = this.goldT;
      const d = this.goldDur;
      const w = t < 0.7 ? t / 0.7 : t > d - 1.6 ? Math.max(0, (d - t) / 1.6) : 1;
      if (t >= d) this.goldDur = 0;
      const env = this.game.get<any>('environment');
      if (env) {
        env.sun?.color?.lerp(GOLD_SUN, 0.65 * w);
        if (env.sun) env.sun.intensity *= 1 + 0.3 * w;
        env.hemi?.color?.lerp(GOLD_SKY, 0.5 * w);
        const fog = this.game.scene.fog as THREE.Fog | null;
        fog?.color.lerp(GOLD_FOG, 0.45 * w);
        const bg = this.game.scene.background as THREE.Color | null;
        if (bg && (bg as any).isColor) bg.lerp(GOLD_FOG, 0.45 * w);
        const bloom = this.game.renderer?.bloom;
        if (bloom) bloom.intensity += 0.35 * w;
      }
    }
  }
}
