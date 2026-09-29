import * as THREE from 'three';
import type { Game, System } from '../core/Game';

/**
 * Keeps heartfelt cutscenes (Mom's grooming, the kits' family portrait, Danny, the finale) free of wandering
 * AI-slop "Slopothys": while the game is in a cutscene, any slop creature near Jimothy is quietly relocated to a
 * far-away town spot (off camera). They wander back later — they always do.
 */
export class CutsceneTidy implements System {
  name = 'cutsceneTidy';
  private t = 0;

  lateUpdate(dt: number, game: Game) {
    if (game.state !== 'cutscene') {
      this.t = 0;
      return;
    }
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    try {
      this.tidy(game);
    } catch (err) {
      console.warn('[cutsceneTidy]', err);
    }
  }

  private tidy(game: Game) {
    const mgr = game.get<any>('slop')?.slopothys;
    const player = game.get<any>('player');
    if (!mgr?.alive || !player) return;
    const focus: THREE.Vector3 = player.position;
    const cam = game.camera.position;
    const spots: THREE.Vector3[] = (mgr.townSpots?.() ?? []).filter(
      (p: THREE.Vector3) => p.distanceTo(focus) > 90 && p.distanceTo(cam) > 90,
    );
    if (!spots.length) return;
    for (const s of mgr.alive()) {
      const pos: THREE.Vector3 | undefined = s.pos ?? s.root?.position;
      if (!pos) continue;
      if (pos.distanceTo(focus) > 45 && pos.distanceTo(cam) > 45) continue;
      s.relocate(spots[Math.floor(Math.random() * spots.length)]);
    }
  }
}
