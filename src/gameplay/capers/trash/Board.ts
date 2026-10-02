import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import { drawJimothy } from '../../../fx/jimothyArt';
import { type CaperFeature, paintMesh, T, findClearSpot, groundY, playerOf, FONT_DISPLAY } from '../shared';
import { canvasPlane, note } from './common';

/**
 * RACCOON BULLETIN BOARD. A cork board on two posts in the alley right by the den, with pinned notes advertising the
 * trash capers (Trash Throne, Midnight Buffet, the lost treasure map, the Ancient Glyphs rumour) and their progress.
 * Redrawn when any of them progresses. Walking up to it gives a one-line hint. Test hook: `capers.byId.get('board').visit()`.
 */
export class BoardFeature implements CaperFeature {
  readonly id = 'board';
  spot: THREE.Vector3 | null = null;
  private board: ReturnType<typeof canvasPlane> | null = null;
  private hintCd = 0;
  private dirty = false;

  constructor(private game: Game) {}

  init() {
    const game = this.game;
    game.physics.refreshQueries(); // (zone colliders may not be in the query pipeline yet)
    const half = new THREE.Vector3(1.2, 1.1, 0.25);
    for (const [x, z] of [
      [3.2, 25.2],
      [1.0, 25.2],
      [5.5, 26.0],
      [-2, 26],
    ]) {
      const y = groundY(game, x, z, 10);
      this.spot = findClearSpot(game, new THREE.Vector3(x, y, z), half, 0, { maxR: 2, step: 0.5, fromY: y + 4 });
      if (this.spot) break;
    }
    if (!this.spot) {
      console.info('[capers] no room for the bulletin board; skipped');
      return;
    }
    const root = new THREE.Group();
    root.position.copy(this.spot);
    root.add(
      paintMesh([
        { g: new THREE.BoxGeometry(0.1, 2.0, 0.1), c: 0x5a3d22, m: T(-1.05, 1.0, -0.05) },
        { g: new THREE.BoxGeometry(0.1, 2.0, 0.1), c: 0x5a3d22, m: T(1.05, 1.0, -0.05) },
        { g: new THREE.BoxGeometry(2.3, 1.45, 0.06), c: 0x6b4a2a, m: T(0, 1.25, -0.04) },
        { g: new THREE.BoxGeometry(2.45, 0.1, 0.22), c: 0x5a3d22, m: T(0, 2.02, 0.0) },
      ]),
    );
    this.board = canvasPlane(2.16, 1.32, 640, 392, (c, w, h) => this.draw(c, w, h), 0.15);
    this.board.mesh.position.set(0, 1.25, 0.0);
    root.add(this.board.mesh);
    game.scene.add(root);
    game.get<any>('world')?.collider?.(this.spot.clone().add(new THREE.Vector3(0, 1.0, -0.04)), new THREE.Vector3(2.3, 2.0, 0.12), 0);
    game.physics.refreshQueries();
    game.get<any>('world')?.poi?.set('raccoonBoard', this.spot.clone().add(new THREE.Vector3(0, 0.1, 1)));
    for (const ev of ['throneTribute', 'trashKingCrowned', 'buffetRaid', 'buffetComplete', 'treasureScrap', 'treasureDug', 'glyphFound', 'objective']) game.events.on(ev, () => (this.dirty = true));
  }

  private draw(c: CanvasRenderingContext2D, w: number, h: number) {
    const game = this.game;
    const caps = game.get<any>('capers');
    const th = caps?.byId?.get('throne');
    const tr = caps?.byId?.get('treasure');
    const gl = caps?.byId?.get('glyphs');
    const obj = game.get<any>('objectives');
    // cork
    c.fillStyle = '#c99a5b';
    c.fillRect(0, 0, w, h);
    let s = 3;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(${r() < 0.5 ? '120,80,40' : '230,190,130'},.35)`;
      c.fillRect(r() * w, r() * h, 3, 3);
    }
    c.fillStyle = '#3a2614';
    c.font = `34px ${FONT_DISPLAY}`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText('RACCOON BULLETIN BOARD', w / 2, 10, w - 20);
    const nw = w * 0.225;
    const nh = h * 0.72;
    const y = 58;
    const done = (id: string) => !!obj?.isDone?.(id);
    const tick = (id: string) => (done(id) ? '✔ DONE!' : '');
    note(c, 12, y, nw, nh, '#fff4a8', 'TRASH THRONE', ['Bring 10 trash', 'or snacks to the', 'ring (alley, west)', done('trashKing') ? '✔ ALL HAIL!' : `${th?.count ?? 0}/10`], -0.04);
    note(c, 24 + nw, y, nw, nh, '#cfe3ff', 'MIDNIGHT BUFFET', ['Hills backyards', 'NIGHT ONLY', '6 gourmet bags', tick('midnightBuffet') || 'in ONE night'], 0.03);
    note(c, 36 + nw * 2, y, nw, nh, '#ffd3d3', 'LOST: MAP', ['Torn to bits!', 'Check the', 'dumpsters.', done('xMarksTheTrash') ? '✔ FOUND IT' : `scraps ${tr?.scraps ?? 0}/3`], -0.02);
    const g = gl?.found?.size ?? 0;
    note(c, 48 + nw * 3, y, nw, nh, '#d9f2c9', 'THE ANCIENTS', ['7 glowing stones.', 'They hum. Look', 'up. Look down.', g > 0 ? `${g}/7` : '???'], 0.05);
    try {
      drawJimothy(c, w - 46, h - 34, 26, { flat: true });
    } catch {
      /* optional doodle */
    }
  }

  visit() {
    const pl = playerOf(this.game);
    if (!pl || !this.spot) return false;
    pl.teleport(this.spot.clone().add(new THREE.Vector3(0, 0.5, 2.2)), Math.PI);
    return true;
  }

  update(dt: number) {
    if (!this.spot) return;
    this.hintCd -= dt;
    if (this.dirty) {
      this.dirty = false;
      this.board?.redraw();
    }
    const pl = playerOf(this.game);
    if (pl && this.hintCd <= 0 && pl.position.distanceToSquared(this.spot) < 6) {
      this.hintCd = 60;
      this.board?.redraw();
      this.game.hint('Raccoon Bulletin Board: a throne to build, a midnight buffet, a lost treasure map… and something ancient.', 4.5);
    }
  }
}
