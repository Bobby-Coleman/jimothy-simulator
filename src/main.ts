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
  game.renderer.domElement.addEventListener('click', () => {
    if (game.state === 'playing') game.input.requestPointerLock();
  });
  game.start();
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot');
  if (el) el.textContent = 'Jimothy tripped over something while loading: ' + (err?.message ?? err);
});
