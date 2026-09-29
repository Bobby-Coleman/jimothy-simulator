import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { G, groups } from '../../../core/Physics';
import type { ObjectiveDef } from '../../Objectives';
import type { CameraRig } from '../../../player/CameraRig';
import { hasListener, type AnimalSystem } from '../../../entities/animals';

/**
 * Shared toolbox for the heartwarming quests: POIs with fallbacks, ground queries, FX / UI / NPC / item
 * adapters (every other system is optional — we degrade to hints, our own emotes and primitive props),
 * game-time timers and a tiny camera cutscene helper.
 */

export type QuestId = 'mama' | 'kits' | 'danny' | 'crows' | 'grandma' | 'teddy';

export interface QuestStatus {
  id: QuestId;
  title: string;
  step: string;
  done: boolean;
  /** Where to go next (for waypoints / the map), if known. */
  position: THREE.Vector3 | null;
}

export interface HeartQuest {
  readonly id: QuestId;
  readonly title: string;
  /** Objective ids to look for (ObjectiveContent's camelCase first); `def` is registered only if none exist. */
  readonly objective: { ids: string[]; def: ObjectiveDef };
  done: boolean;
  /** Spawn characters/props (world is built; NPC/item systems may not be ready yet). */
  init(ctx: HeartCtx): void | Promise<void>;
  /** First frame: every system is initialised (NPCs, items, objective content). */
  setup?(ctx: HeartCtx): void;
  update(dt: number): void;
  postPhysics?(dt: number): void;
  lateUpdate?(dt: number): void;
  step(): string;
  target?(): THREE.Vector3 | null;
  save(): any;
  load(data: any): void;
}

export interface SpeakTarget {
  npc?: any;
  entity?: Entity;
  object?: THREE.Object3D;
  position?: THREE.Vector3;
  /** Fallback bubble (our canvas emote) when the UI speech layer is missing. */
  emote?: { show(what: string, secs: number): void };
  offsetY?: number;
}

const WORLD_ONLY = groups(G.ALL, G.WORLD);
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();

interface Cut {
  until: number;
  fn: (cam: THREE.PerspectiveCamera, dt: number) => void;
  onEnd?: () => void;
  prevFrozen: boolean;
  prevState: string;
  froze: boolean;
}

export class HeartCtx {
  readonly game: Game;
  itemsMod: any = null;
  private timers: { at: number; fn: () => void }[] = [];
  private cut: Cut | null = null;
  /** Quest system callbacks. */
  readonly onSave: () => void;
  readonly onProgress: (id: QuestId, text: string) => void;
  readonly onComplete: (id: QuestId) => void;

  constructor(
    game: Game,
    cb: { save: () => void; progress: (id: QuestId, text: string) => void; complete: (id: QuestId) => void },
  ) {
    this.game = game;
    this.onSave = cb.save;
    this.onProgress = cb.progress;
    this.onComplete = cb.complete;
  }

  // ------------------------------------------------------------------------------------------- systems
  get player(): any {
    return this.game.get<any>('player');
  }
  get animals(): AnimalSystem {
    return this.game.get<AnimalSystem>('animals')!;
  }
  get world(): any {
    return this.game.get<any>('world');
  }
  get env(): any {
    return this.game.get<any>('environment');
  }
  get isNight(): boolean {
    return !!this.env?.isNight;
  }
  get ui(): any {
    return this.game.get<any>('ui');
  }
  get npcSys(): any {
    return this.game.get<any>('npcs');
  }
  get time() {
    return this.game.time;
  }

  // ------------------------------------------------------------------------------------------- places
  spawnPoint(): THREE.Vector3 {
    const sp = this.world?.poi?.get('spawn') as THREE.Vector3 | undefined;
    if (sp) return sp.clone();
    const p = this.player?.spawn as THREE.Vector3 | undefined;
    return p ? p.clone() : new THREE.Vector3();
  }

  /** POI by name; if missing, uses (and registers, so the map shows it) a fallback spot. Ground-snapped. */
  poi(name: string, fallback: () => THREE.Vector3): { pos: THREE.Vector3; real: boolean } {
    const p = this.world?.poi?.get(name) as THREE.Vector3 | undefined;
    if (p) {
      // snap from just above the POI (it may be under a porch / awning; don't land on top of it)
      const out = p.clone();
      out.y = this.ground(out.x, out.z, out.y + 0.45, out.y);
      return { pos: out, real: true };
    }
    const f = fallback();
    f.y = this.ground(f.x, f.z, f.y + 30);
    this.world?.poi?.set(name, f.clone());
    return { pos: f, real: false };
  }

  /**
   * Static-world ground height under (x, z), raycasting down from `fromY`. If the ray starts inside a solid
   * collider, returns `insideY` (default: the terrain height).
   */
  ground(x: number, z: number, fromY = 60, insideY?: number): number {
    const hit = this.game.physics.raycast(_v.set(x, fromY, z), DOWN, fromY + 80, WORLD_ONLY);
    if (hit && hit.distance < 0.004) return insideY ?? this.world?.heightAt?.(x, z) ?? 0;
    if (hit) return hit.point.y;
    return this.world?.heightAt?.(x, z) ?? 0;
  }

  /**
   * Nudge a spot out of car lanes (world.lanes) so nobody small sits in traffic. Returns true if it moved.
   * Re-snaps the height if moved.
   */
  clearOfTraffic(p: THREE.Vector3, clearance = 4.6): boolean {
    const lanes = (this.world?.lanes ?? []) as { points: THREE.Vector3[]; loop: boolean }[];
    if (!lanes.length) return false;
    const laneDist = (x: number, z: number) => {
      let best = Infinity;
      for (const lane of lanes) {
        const pts = lane.points;
        const n = pts.length;
        for (let i = 0; i < n - (lane.loop ? 0 : 1); i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          const abx = b.x - a.x;
          const abz = b.z - a.z;
          const len2 = abx * abx + abz * abz;
          if (len2 < 1e-6) continue;
          const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1);
          const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
          if (d < best) best = d;
        }
      }
      return best;
    };
    if (laneDist(p.x, p.z) >= clearance) return false;
    // nearest clear spot on growing rings around the original point (bounded: never more than 14 m)
    for (let r = 2; r <= 14; r += 1.5) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (laneDist(x, z) < clearance) continue;
        const y = this.ground(x, z, p.y + 1.5, p.y);
        if (Math.abs(y - p.y) > 1.2) continue;
        p.set(x, y, z);
        return true;
      }
    }
    return false;
  }

  /** Horizontal distance from the player. */
  distToPlayer(p: THREE.Vector3) {
    const pl = this.player?.position as THREE.Vector3 | undefined;
    return pl ? Math.hypot(pl.x - p.x, pl.z - p.z) : Infinity;
  }

  // ------------------------------------------------------------------------------------------- FX
  hearts(pos: THREE.Vector3, count = 6) {
    this.animals?.hearts(pos, count);
  }

  sparkle(pos: THREE.Vector3, opts: { radius?: number; count?: number; color?: number } = {}) {
    this.game.events.emit('sparkle', { position: pos.clone(), ...opts });
  }

  confetti(pos: THREE.Vector3, scale = 1) {
    const fx = this.game.get<any>('fx');
    if (fx && typeof fx.emit === 'function') {
      try {
        fx.emit('confetti', pos.clone(), { scale });
        return;
      } catch {
        /* fall through */
      }
    }
    this.game.events.emit('confetti', { position: pos.clone(), scale });
    if (!hasListener(this.game, 'confetti')) this.hearts(pos, 10);
  }

  // ------------------------------------------------------------------------------------------- talking
  hint(text: string, secs = 3) {
    this.game.hint(text, secs);
  }

  toast(title: string, text?: string, icon = 'heart') {
    const ui = this.ui;
    if (ui?.toast) ui.toast(title, text, icon);
    else this.game.events.emit('toast', { title, text, icon });
  }

  /** Context prompt (e.g. '{grab} Give Mom the snack'); falls back to nothing (hints cover it). */
  prompt(text: string | null, ttl = 0.4) {
    try {
      this.ui?.setPrompt?.(text, ttl);
    } catch {
      /* optional */
    }
  }

  /** A speech bubble over a character: NPC.say → UI speech layer → our emote → HUD hint. */
  speak(t: SpeakTarget, text: string, secs = 3) {
    if (t.npc && typeof t.npc.say === 'function' && !t.npc.removed) {
      t.npc.say(text, secs);
      return;
    }
    if (hasListener(this.game, 'speech') && (t.object || t.entity || t.position)) {
      this.game.events.emit('speech', {
        entity: t.entity,
        object: t.object,
        position: t.position,
        text,
        duration: secs,
        offsetY: t.offsetY,
      });
      return;
    }
    if (t.emote) {
      t.emote.show(text, secs);
      return;
    }
    this.hint(text, secs);
  }

  /** Quest dialogue via the UI dialog box, or a paced sequence of hints. */
  dialog(speaker: string, lines: string[], onDone?: () => void, opts: { portrait?: string; color?: string } = {}) {
    const ui = this.ui;
    if (ui && typeof ui.showDialog === 'function') {
      let called = false;
      const done = () => {
        if (called) return;
        called = true;
        onDone?.();
      };
      try {
        const r = ui.showDialog({ speaker, lines, onDone: done, portrait: opts.portrait, color: opts.color });
        if (r && typeof r.then === 'function') r.then(done, done);
        return;
      } catch (err) {
        console.warn('[heart] ui.showDialog failed, using hints', err);
      }
    }
    let t = 0;
    for (const l of lines) {
      const secs = Math.min(5, 1.6 + l.length * 0.045);
      this.after(t, () => this.hint(`${speaker}: ${l}`, secs));
      t += secs;
    }
    this.after(t, () => onDone?.());
  }

  get dialogOpen(): boolean {
    return !!this.ui?.dialog?.open;
  }

  // ------------------------------------------------------------------------------------------- timers
  after(secs: number, fn: () => void) {
    this.timers.push({ at: this.game.time + secs, fn });
  }

  tick() {
    const now = this.game.time;
    // never pull the camera away (or unfreeze Jimothy) while a dialog is still on screen
    if (this.cut && now >= this.cut.until && !this.dialogOpen) this.endCutscene();
    if (!this.timers.length) return;
    const due = this.timers.filter((t) => t.at <= now);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.at > now);
    for (const t of due) {
      try {
        t.fn();
      } catch (err) {
        console.error('[heart] timer failed', err);
      }
    }
  }

  // ------------------------------------------------------------------------------------------- items
  /**
   * Spawn an item from the items system (game.get('items').spawn / src/gameplay/items spawnItem) when it
   * knows `kind`, else from `fallback()`.
   */
  spawnItem(kind: string, pos: THREE.Vector3, fallback: () => Entity): Entity {
    const ok = (e: any): e is Entity => !!e && typeof e === 'object' && !!e.body && !!e.kind && e.alive !== false;
    try {
      const sys = this.game.get<any>('items');
      const fn = sys?.spawn ?? sys?.spawnItem;
      let r: any = typeof fn === 'function' ? fn.call(sys, kind, pos.clone()) : undefined;
      if (!ok(r) && typeof this.itemsMod?.spawnItem === 'function') r = this.itemsMod.spawnItem(this.game, kind, pos.clone());
      if (ok(r)) return r;
    } catch {
      /* unknown kind → fallback */
    }
    return fallback();
  }

  // ------------------------------------------------------------------------------------------- NPCs
  /** Spawn an NPC via the NPC system; null if it isn't available. */
  spawnNpc(opts: Record<string, any>): any | null {
    const sys = this.npcSys;
    if (!sys || typeof sys.spawn !== 'function') return null;
    try {
      return sys.spawn(opts) ?? null;
    } catch (err) {
      console.warn('[heart] npc spawn failed, using a stand-in', err);
      return null;
    }
  }

  // ------------------------------------------------------------------------------------------- cutscenes
  get inCutscene() {
    return !!this.cut;
  }

  /**
   * Freeze Jimothy and fly the camera: `camPos(t)` gives the wanted camera position at time t (s), the camera
   * glides there and looks at `focus()`. Ends after `duration` s (game time) and hands the camera back.
   */
  cutscene(o: {
    duration: number;
    focus: () => THREE.Vector3;
    camPos: (t: number) => THREE.Vector3;
    fov?: number;
    freeze?: boolean;
    onEnd?: () => void;
  }) {
    if (this.cut) this.endCutscene();
    const game = this.game;
    const rig = game.get<CameraRig>('camera');
    const player = this.player;
    const freeze = o.freeze !== false;
    const prevFrozen = !!player?.frozen;
    if (player && freeze) player.frozen = true;
    const prevState = game.state;
    if (game.state === 'playing') game.state = 'cutscene';
    let t = 0;
    const look = o.focus().clone();
    const baseFov = rig?.baseFov ?? 62;
    const fn = (cam: THREE.PerspectiveCamera, dt: number) => {
      const d = Math.min(dt, 0.1);
      t += d;
      const want = o.camPos(t);
      // keep a clear view: pull in front of walls / railings between the subject and the camera
      const f = o.focus();
      const dir = _v.copy(want).sub(f);
      const len = dir.length();
      if (len > 0.3) {
        const hit = game.physics.sphereCast(f, dir, 0.18, len, groups(G.ALL, G.WORLD | G.VEHICLE));
        if (hit) want.copy(f).addScaledVector(dir.normalize(), Math.max(1.2, hit.distance - 0.05));
      }
      cam.position.lerp(want, 1 - Math.exp(-d * (t < 0.8 ? 3 : 5)));
      look.lerp(f, 1 - Math.exp(-d * 6));
      cam.lookAt(look);
      cam.fov += ((o.fov ?? baseFov * 0.82) - cam.fov) * (1 - Math.exp(-d * 3));
      cam.updateProjectionMatrix();
    };
    this.cut = { until: game.time + o.duration, fn, onEnd: o.onEnd, prevFrozen, prevState, froze: freeze };
    if (rig) rig.override = fn;
  }

  endCutscene() {
    const c = this.cut;
    if (!c) return;
    this.cut = null;
    const game = this.game;
    const rig = game.get<CameraRig>('camera');
    const player = this.player;
    if (rig && rig.override === c.fn) {
      rig.override = null;
      // hand back without a jump: orbit angles from where the camera is now
      const target = player?.cameraTarget as THREE.Vector3 | undefined;
      if (target) {
        const dir = _v.copy(game.camera.position).sub(target);
        const len = dir.length();
        if (len > 0.01) {
          dir.divideScalar(len);
          rig.yaw = Math.atan2(dir.x, dir.z);
          rig.pitch = THREE.MathUtils.clamp(-Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), -1.35, 0.75);
        }
      }
    }
    if (player && c.froze) player.frozen = c.prevFrozen;
    if (game.state === 'cutscene' && c.prevState === 'playing') game.state = 'playing';
    try {
      c.onEnd?.();
    } catch (err) {
      console.error('[heart] cutscene onEnd failed', err);
    }
  }

  /**
   * Orbiting close-up camera helper: circle around `center` at radius r, height h, starting at angle a0.
   * The start angle is nudged (once) to the nearest angle with a clear view — physics colliders *and* visible
   * meshes (signs, fences without colliders…).
   */
  orbit(center: () => THREE.Vector3, r: number, h: number, a0: number, speed = 0.12, subjects: THREE.Vector3[] = []) {
    const out = new THREE.Vector3();
    const start = this.clearAngle(center().clone(), r, h, a0, speed, subjects);
    return (t: number) => {
      const c = center();
      const a = start + t * speed;
      return out.set(c.x + Math.sin(a) * r, c.y + h, c.z + Math.cos(a) * r);
    };
  }

  /**
   * Angle nearest `a0` from which a camera at (radius r, height h around `focus`) sees `focus` — and each of
   * `subjects` (e.g. both characters' heads) — unobstructed.
   */
  clearAngle(focus: THREE.Vector3, r: number, h: number, a0: number, speed = 0, subjects: THREE.Vector3[] = []): number {
    const rc = new THREE.Raycaster();
    rc.camera = this.game.camera; // sprites need it (otherwise three logs 'Raycaster.camera needs to be set')
    const player = this.player;
    const skip = new Set<THREE.Object3D>();
    if (player?.model?.root) skip.add(player.model.root);
    for (const a of this.animals?.list ?? []) {
      const root = (a as any).rig?.root ?? (a as any).parts?.root;
      if (root) skip.add(root);
    }
    const isSkipped = (o: THREE.Object3D | null) => {
      for (let p = o; p; p = p.parent) if (skip.has(p)) return true;
      return false;
    };
    const targets = this.game.scene.children.filter((c) => !skip.has(c) && c.visible);
    const sightBlocked = (from: THREE.Vector3, cam: THREE.Vector3, near: number) => {
      const dir = cam.clone().sub(from);
      const len = dir.length();
      if (len < 0.2) return false;
      if (this.game.physics.sphereCast(from, dir, 0.12, len, groups(G.ALL, G.WORLD | G.VEHICLE))) return true;
      rc.set(from, dir.normalize());
      rc.near = near;
      rc.far = len;
      let hits: THREE.Intersection[] = [];
      try {
        hits = rc.intersectObjects(targets, true);
      } catch {
        return false;
      }
      for (const hit of hits) {
        const o = hit.object as THREE.Mesh;
        if ((o as any).isSprite || (o as any).isPoints || (o as any).isLine || isSkipped(o)) continue;
        const mat = o.material as THREE.Material | undefined;
        if (mat && !Array.isArray(mat) && mat.transparent && mat.opacity < 0.6) continue;
        return true;
      }
      return false;
    };
    const blocked = (a: number) => {
      // check where the camera starts and where it will be a few seconds later
      for (const k of [0, 2.5]) {
        const aa = a + k * speed;
        const cam = new THREE.Vector3(focus.x + Math.sin(aa) * r, focus.y + h, focus.z + Math.cos(aa) * r);
        if (sightBlocked(focus, cam, 0.9)) return true;
        for (const s of subjects) if (sightBlocked(s, cam, 0.45)) return true;
      }
      return false;
    };
    // Both sides of the preferred angle first (a0 and a0 + π are equally good "side-on" views of two
    // characters facing each other), then progressively further round; last resort: the original angle.
    const P = Math.PI;
    const offsets = [0, P, P / 6, -P / 6, P + P / 6, P - P / 6, P / 3, -P / 3, P + P / 3, P - P / 3, P / 2, -P / 2];
    for (const o of offsets) {
      if (!blocked(a0 + o)) return a0 + o;
    }
    return a0;
  }
}
