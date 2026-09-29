import { Game } from './core/Game';
import { registerSystems } from './systems';

async function boot() {
  const bootEl = document.getElementById('boot');
  const game = new Game();
  // Handy for debugging from the console: jimothy.get('player') etc.
  (window as any).jimothy = game;
  await game.init(document.getElementById('app')!);
  registerSystems(game);
  await game.initSystems((name, i, n) => {
    if (bootEl) bootEl.textContent = `Loading Jimothy… (${Math.round((i / n) * 100)}%)`;
  });
  bootEl?.remove();
  // A title screen system (if registered) takes over from here; otherwise start playing.
  if (game.state === 'boot') game.state = 'playing';
  applyDevParams(game);
  game.renderer.domElement.addEventListener('click', () => {
    if (game.state === 'playing') game.input.requestPointerLock();
  });
  game.start();
}

/**
 * Dev/test URL params:
 *   ?skipintro        skip title/intro, start playing immediately (title system reads this too)
 *   ?spawn=x,z        teleport Jimothy (y from terrain)
 *   ?time=21.5        set time of day (hours)
 *   ?quality=low|medium|high
 */
function applyDevParams(game: Game) {
  const q = new URLSearchParams(location.search);
  if (q.has('skipintro') && game.state !== 'playing') game.state = 'playing';
  const quality = q.get('quality');
  if (quality === 'low' || quality === 'medium' || quality === 'high') game.renderer.setQuality(quality);
  const time = q.get('time');
  if (time) game.get<any>('environment')?.setTime(Number(time));
  const spawn = q.get('spawn');
  if (spawn) {
    const [x, z] = spawn.split(',').map(Number);
    const world = game.get<any>('world');
    const p = game.get<any>('player');
    if (p && world && Number.isFinite(x) && Number.isFinite(z)) {
      const pos = p.position.clone().set(x, world.heightAt(x, z) + 1.2, z);
      p.teleport(pos);
    }
  }
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot');
  if (el) el.textContent = 'Jimothy tripped over something while loading: ' + (err?.message ?? err);
});
