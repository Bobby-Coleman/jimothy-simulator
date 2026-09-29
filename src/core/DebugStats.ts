import type { Game, System } from './Game';

/** Performance overlay: `?stats` URL param or F3 toggles it. Also exposes `game.debug.perf()` for tests. */
export class DebugStats implements System {
  name = 'debugstats';
  private el: HTMLDivElement | null = null;
  private visible = false;
  private frameTimes: number[] = [];
  private last = performance.now();

  init(game: Game) {
    this.visible = new URLSearchParams(location.search).has('stats');
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        this.visible = !this.visible;
        e.preventDefault();
      }
    });
    game.debug.perf = () => this.snapshot(game);
  }

  snapshot(game: Game) {
    const info = game.renderer.renderer.info;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    let meshes = 0;
    let visibleMeshes = 0;
    game.scene.traverse((o) => {
      if ((o as any).isMesh) {
        meshes++;
        if (o.visible) visibleMeshes++;
      }
    });
    return {
      fps: Math.round(game.fps),
      frameMsP50: +p(0.5).toFixed(2),
      frameMsP95: +p(0.95).toFixed(2),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      meshes,
      visibleMeshes,
      bodies: game.physics.world.bodies.len(),
      colliders: game.physics.world.colliders.len(),
      entities: game.entities.list.length,
      heapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : undefined,
    };
  }

  lateUpdate(_dt: number, game: Game) {
    const now = performance.now();
    this.frameTimes.push(now - this.last);
    this.last = now;
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    if (!this.visible) {
      if (this.el) this.el.style.display = 'none';
      return;
    }
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.style.cssText =
        'position:fixed;left:8px;bottom:8px;z-index:50;font:600 11px monospace;color:#bfffbf;background:rgba(0,0,0,.55);padding:6px 8px;border-radius:6px;white-space:pre;pointer-events:none';
      document.body.appendChild(this.el);
    }
    this.el.style.display = 'block';
    if (game.frame % 15 === 0) {
      const s = this.snapshot(game);
      this.el.textContent = Object.entries(s)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    }
  }
}
