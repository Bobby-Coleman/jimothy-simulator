import * as THREE from 'three';
import { Physics } from './Physics';
import { Input } from './Input';
import { Assets } from './Assets';
import { Events } from './Events';
import { EntityRegistry } from './Entities';
import { Renderer } from './Renderer';

/**
 * A game system. All hooks are optional.
 *  - init:        once, after the core is ready (awaited in registration order)
 *  - update:      every frame before the physics step (read input, drive bodies)
 *  - postPhysics: after the physics step (sync visuals, react to contacts)
 *  - lateUpdate:  after everything else (camera, HUD)
 * `update`/`postPhysics` are skipped while the game is paused; `lateUpdate` always runs.
 */
export interface System {
  name: string;
  init?(game: Game): void | Promise<void>;
  update?(dt: number, game: Game): void;
  postPhysics?(dt: number, game: Game): void;
  lateUpdate?(dt: number, game: Game): void;
}

export type GameState = 'boot' | 'title' | 'playing' | 'paused' | 'cutscene';

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500);
  readonly events = new Events();
  readonly entities = new EntityRegistry();
  readonly assets = new Assets();
  renderer!: Renderer;
  physics!: Physics;
  input!: Input;
  readonly systems: System[] = [];
  private byName = new Map<string, System>();

  state: GameState = 'boot';
  /** Scaled game time in seconds. */
  time = 0;
  /** Unscaled real time in seconds. */
  realTime = 0;
  timeScale = 1;
  frame = 0;
  dt = 0;
  /** Debug flags toggled from the console: `jimothy.debug.x = true`. */
  debug: Record<string, any> = {};

  private last = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  fps = 60;

  async init(container: HTMLElement) {
    this.renderer = new Renderer(container, this.scene, this.camera);
    this.physics = await Physics.create();
    this.input = new Input(this.renderer.domElement);
    this.assets.maxAnisotropy = Math.min(8, this.renderer.renderer.capabilities.getMaxAnisotropy());
  }

  /** Register a system. Returns it for chaining. */
  add<T extends System>(system: T): T {
    this.systems.push(system);
    this.byName.set(system.name, system);
    return system;
  }

  get<T extends System = System>(name: string): T | undefined {
    return this.byName.get(name) as T | undefined;
  }

  async initSystems(onProgress?: (name: string, i: number, n: number) => void) {
    for (let i = 0; i < this.systems.length; i++) {
      const s = this.systems[i];
      onProgress?.(s.name, i, this.systems.length);
      try {
        await s.init?.(this);
      } catch (err) {
        console.error(`[game] init of system "${s.name}" failed`, err);
      }
    }
  }

  get paused() {
    return this.state === 'paused' || this.state === 'title';
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.tick(now);
    };
    requestAnimationFrame(loop);
  }

  private tick(now: number) {
    // rAF timestamps can be slightly EARLIER than performance.now() taken in start(): never allow dt < 0
    const rawDt = Math.min(Math.max(0, (now - this.last) / 1000), 0.1);
    this.last = now;
    this.frameStep(rawDt, true);
  }

  /**
   * Advance the simulation by `seconds` using fixed 60 Hz frames, independent of requestAnimationFrame.
   * Used by automated playtests (rAF is throttled in hidden tabs). Renders only the final frame.
   */
  advance(seconds: number, dt = 1 / 60) {
    const n = Math.max(1, Math.round(seconds / dt));
    for (let i = 0; i < n; i++) this.frameStep(dt, i === n - 1);
    this.last = performance.now();
  }

  private frameStep(rawDt: number, render: boolean) {
    this.realTime += rawDt;
    this.fpsAccum += rawDt;
    this.fpsFrames++;
    if (this.fpsAccum > 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    let dt = rawDt * this.timeScale;
    // Feel pass: hit-stop multiplies on top of timeScale (so it never fights SlowMo/PhotoMode, which own timeScale)
    // and counts down in unscaled frame time, i.e. a fixed number of frames under advance() too.
    if (this.hitStopLeft > 0) {
      dt *= this.hitStopScale;
      this.hitStopLeft -= rawDt;
    }
    this.dt = dt;
    this.frame++;

    this.input.update(rawDt);
    const running = !this.paused;
    if (running) {
      this.time += dt;
      for (const s of this.systems) this.safe(s, 'update', dt);
      this.entities.update(this, dt);
      if (dt > 0) this.physics.step(dt);
      for (const s of this.systems) this.safe(s, 'postPhysics', dt);
    }
    for (const s of this.systems) this.safe(s, 'lateUpdate', rawDt);
    if (render) this.renderer.render(rawDt);
    this.input.endFrame();
  }

  private errorCounts = new Map<string, number>();
  private safe(s: System, hook: 'update' | 'postPhysics' | 'lateUpdate', dt: number) {
    const fn = s[hook];
    if (!fn) return;
    try {
      fn.call(s, dt, this);
    } catch (err) {
      const key = `${s.name}.${hook}`;
      const n = (this.errorCounts.get(key) ?? 0) + 1;
      this.errorCounts.set(key, n);
      if (n <= 3) console.error(`[game] ${key} threw`, err);
    }
  }

  /** Convenience for score popups. */
  score(points: number, label: string, position?: THREE.Vector3) {
    this.events.emit('score', { points, label, position });
  }

  /** Feel pass: remaining real seconds of hit-stop and the game-time multiplier while it lasts (see hitStop()). */
  hitStopLeft = 0;
  hitStopScale = 1;
  /**
   * Feel pass: a tiny freeze-frame on bonks / big impacts. For `seconds` of real time the game runs at `scale` speed.
   * A longer request wins; overlapping ones don't stack. Used by src/player/Jimothy.ts.
   */
  hitStop(seconds: number, scale = 0.08) {
    if (!(seconds > this.hitStopLeft)) return;
    this.hitStopLeft = Math.min(0.15, seconds);
    this.hitStopScale = THREE.MathUtils.clamp(scale, 0, 1);
  }

  hint(text: string, duration = 2.5) {
    this.events.emit('hint', { text, duration });
  }

  sfx(key: string, position?: THREE.Vector3, volume?: number, pitch?: number) {
    this.events.emit('sfx', { key, position, volume, pitch });
  }
}
