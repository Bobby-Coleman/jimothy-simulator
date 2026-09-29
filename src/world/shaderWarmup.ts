import type * as THREE from 'three';
import type { Game } from '../core/Game';

/**
 * perf: compile every material's shader program up front, in the background.
 *
 * Without this, each material compiles the first time it comes into view — on Windows/ANGLE that's ~50–150 ms per
 * program, so walking into a new area (or the map's top-down capture, which sees the whole world at once) froze the
 * game for up to several seconds. `compileAsync` uses KHR_parallel_shader_compile where available, so this mostly
 * runs off the main thread.
 *
 * Program keys depend on the bound render target (the game renders the scene into the postprocessing composer's
 * buffer, never straight to the screen), so the composer's input buffer is bound while compiling.
 */
export function warmShaders(game: Game) {
  const r = game.renderer.renderer as THREE.WebGLRenderer & { compileAsync?: THREE.WebGLRenderer['compileAsync'] };
  const target = ((game.renderer as any).composer?.inputBuffer ?? null) as THREE.WebGLRenderTarget | null;
  const prev = r.getRenderTarget();
  const t0 = performance.now();
  const before = r.info.programs?.length ?? 0;
  try {
    r.setRenderTarget(target);
    const p = r.compileAsync ? r.compileAsync(game.scene, game.camera, game.scene) : (r.compile(game.scene, game.camera, game.scene), Promise.resolve());
    r.setRenderTarget(prev);
    void Promise.resolve(p).then(() => {
      (game as any).debug.shaderWarmup = { programs: (r.info.programs?.length ?? 0) - before, ms: Math.round(performance.now() - t0) };
    });
  } catch (err) {
    r.setRenderTarget(prev);
    console.warn('[warmup] shader precompile failed (continuing)', err);
  }
}
