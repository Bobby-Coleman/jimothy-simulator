import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { destroyProp } from '../../../entities/Props';
import { spawnItem } from '../../items';
import { Attachment, type HeadAnchors } from '../../mutators/accessories';
import {
  type CaperFeature, type Part, addObjective, objSet, paintMesh, T, TR, findClearSpot, groundY, playerOf, fx, celebrate, rand, pick,
  drawBoard, roundRect, FONT_DISPLAY, FONT_BOLD, Timers, nearCamera,
} from '../shared';
import { canvasPlane, loadState, saveState } from './common';

/**
 * TRASH KING'S THRONE. In the back alley behind the Old Ballard Ave shops (west of the den) a hazard-yellow ring and
 * a sign: "FUTURE SITE OF THE TRASH THRONE". Every trash / food item (tags `trash` or `food`) dropped or thrown into
 * the ring is accepted as royal tribute: the pile grows in five stages (bags → a heap → a milk-crate seat → a
 * pizza-box backrest with soda-can armrests → traffic-cone spire + hubcap crest). At 10 the throne is done; Jimothy
 * hops onto the seat and is crowned (a little gold crown on his head, via the mutator Attachment / head anchors),
 * nearby humans cheer and three loyal subjects turn up.
 *
 * Objective 'trashKing' (target 10; holds at 9 until he actually sits). Events: 'throneTribute' {count},
 * 'throneComplete', 'trashKingCrowned'.
 * Test hooks: `capers.byId.get('throne').fill()` (drops real items into the ring), `.addTribute(n)`, `.sit()`,
 * `.visit()` (stand by the ring).
 */

const NEED = 10;
const RING_R = 1.7;
const SEAT_Y = 0.8;
const STAGES = [1, 3, 5, 7, 10];
const SUBJECT_LINES = ['All hail the Trash King!', 'Long live His Roundness!', 'Your Majesty! *curtsies*', 'He rules the alley now.', 'Bow to the bins!', 'The King has returned!'];

export class ThroneFeature implements CaperFeature {
  readonly id = 'throne';
  spot: THREE.Vector3 | null = null;
  count = 0;
  crowned = false;
  private root = new THREE.Group();
  private pile: THREE.Mesh | null = null;
  private stage = -1;
  private sign: ReturnType<typeof canvasPlane> | null = null;
  private crown: Attachment | null = null;
  private scanT = 0;
  private sitCd = 0;
  private sparkT = 0;
  private hintCd = 0;
  private seatColliders = false;
  private timers: Timers;
  private subjects: any[] = [];

  constructor(private game: Game) {
    this.timers = new Timers(game);
  }

  init() {
    const game = this.game;
    game.physics.refreshQueries(); // (zone colliders may not be in the query pipeline yet)
    addObjective(game, {
      id: 'trashKing',
      category: 'raccoon',
      points: 2500,
      target: NEED,
      title: 'Trash King',
      desc: 'Bring 10 bits of trash or snacks to the ring in the alley behind the Old Ballard Ave shops (west of the den). Then take your seat.',
    });
    const s = loadState('throne', { count: 0, crowned: false });
    this.count = Math.min(NEED, s.count);
    this.crowned = s.crowned;
    try {
      this.build();
    } catch (err) {
      console.warn('[capers] throne failed to build', err);
    }
    if (this.crowned) this.wearCrown();
  }

  // --------------------------------------------------------------------------------------------- building
  private build() {
    const game = this.game;
    const half = new THREE.Vector3(3.9, 1.2, 2.2);
    let spot: THREE.Vector3 | null = null;
    for (const [x, z] of [
      [-40, 28.5],
      [-34, 28.5],
      [-46, 28.5],
      [-28, 28.5],
      [-20, 28.5],
    ]) {
      const y = groundY(game, x, z, 20);
      spot = findClearSpot(game, new THREE.Vector3(x, y, z), half, 0, { maxR: 3, step: 0.75, fromY: y + 6 });
      if (spot) break;
    }
    if (!spot) {
      console.info('[capers] no room for the trash throne; skipped');
      return;
    }
    this.spot = spot;
    this.root.position.copy(spot);
    game.scene.add(this.root);
    // the ring (hazard yellow, with black dashes) + a few crushed cans around it
    const parts: Part[] = [{ g: new THREE.TorusGeometry(RING_R, 0.07, 6, 48), c: 0xffcf2e, m: TR(0, 0.03, 0, Math.PI / 2, 0, 0, [1, 1, 0.35]) }];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      parts.push({ g: new THREE.BoxGeometry(0.18, 0.03, 0.16), c: 0x1d1a26, m: TR(Math.cos(a) * RING_R, 0.05, Math.sin(a) * RING_R, 0, -a, 0) });
    }
    // the sign on two posts, off to the side of the ring and angled toward the alley (the finished throne would hide it)
    const SX = -2.75,
      SZ = -1.0,
      SY = 0.45;
    const sm = TR(SX, 0, SZ, 0, SY, 0);
    const signParts: Part[] = [
      { g: new THREE.BoxGeometry(0.09, 2.2, 0.09), c: 0x6b4a2a, m: T(-1.0, 1.1, -0.03) },
      { g: new THREE.BoxGeometry(0.09, 2.2, 0.09), c: 0x6b4a2a, m: T(1.0, 1.1, -0.03) },
      { g: new THREE.BoxGeometry(2.36, 1.26, 0.05), c: 0x3a2a1a, m: T(0, 1.55, -0.03) },
    ];
    for (const p of signParts) parts.push({ ...p, m: sm.clone().multiply(p.m!) });
    this.root.add(paintMesh(parts, false));
    this.sign = canvasPlane(2.3, 1.2, 512, 268, (c, w, h) => this.drawSign(c, w, h));
    this.sign.mesh.position.set(SX + Math.sin(SY) * 0.005, 1.55, SZ + Math.cos(SY) * 0.005);
    this.sign.mesh.rotation.y = SY;
    this.root.add(this.sign.mesh);
    game.get<any>('world')?.collider?.(spot.clone().add(new THREE.Vector3(SX, 1.1, SZ - 0.03)), new THREE.Vector3(2.2, 2.2, 0.12), SY);
    game.physics.refreshQueries();
    game.get<any>('world')?.poi?.set('trashThrone', spot.clone().add(new THREE.Vector3(0, 0.1, 1.8)));
    this.setStage();
  }

  private drawSign(c: CanvasRenderingContext2D, w: number, h: number) {
    const done = this.count >= NEED;
    drawBoard(done ? 'TRASH THRONE' : 'TRASH THRONE', '', done ? '#6b2f8f' : '#2f5a3a', '#ffcf2e', '#fff6d8')(c, w, h);
    c.fillStyle = '#ffe9a8';
    c.textAlign = 'center';
    c.font = `30px ${FONT_BOLD}`;
    c.textBaseline = 'middle';
    c.fillText(done ? 'BY ORDER OF HIS ROUNDNESS' : 'FUTURE SITE OF THE', w / 2, h * 0.2, w * 0.7);
    // progress pips
    const n = NEED;
    const pw = (w * 0.72) / n;
    for (let i = 0; i < n; i++) {
      c.fillStyle = i < this.count ? '#ffcf2e' : 'rgba(255,255,255,.22)';
      roundRect(c, w * 0.14 + i * pw + 3, h * 0.62, pw - 6, h * 0.1, 6);
      c.fill();
    }
    c.fillStyle = '#fff';
    c.font = `26px ${FONT_BOLD}`;
    c.fillText(done ? (this.crowned ? 'Long live the Trash King!' : 'Now take your seat, Your Majesty.') : `Tribute ${this.count}/${n}: drop trash or snacks in the ring!`, w / 2, h * 0.83, w * 0.88);
    // tiny crown doodle
    c.fillStyle = '#ffcf2e';
    c.beginPath();
    const cx = w * 0.88,
      cy = h * 0.14;
    c.moveTo(cx - 22, cy + 12);
    c.lineTo(cx - 22, cy - 8);
    c.lineTo(cx - 11, cy + 2);
    c.lineTo(cx, cy - 14);
    c.lineTo(cx + 11, cy + 2);
    c.lineTo(cx + 22, cy - 8);
    c.lineTo(cx + 22, cy + 12);
    c.closePath();
    c.fill();
    void FONT_DISPLAY;
  }

  /** Cumulative pile parts up to stage `s` (0..4). Throne faces +Z. */
  private pileParts(s: number): Part[] {
    const P: Part[] = [];
    const bag = (x: number, y: number, z: number, r: number, c = 0x22252b, ry = 0, sy = 0.82) => {
      P.push({ g: new THREE.IcosahedronGeometry(r, 1), c, m: TR(x, y, z, 0.15, ry, -0.1, [1, sy, 1.05]) });
      P.push({ g: new THREE.ConeGeometry(r * 0.28, r * 0.5, 6), c, m: TR(x + 0.02, y + r * sy + r * 0.12, z, 0, ry, 0.2) });
      P.push({ g: new THREE.TorusGeometry(r * 0.12, r * 0.04, 4, 8), c: 0xffcf2e, m: TR(x + 0.02, y + r * sy + 0.02, z, Math.PI / 2, 0, 0) });
    };
    const can = (x: number, y: number, z: number, c: number, rx = 0, rz = 0) => {
      P.push({ g: new THREE.CylinderGeometry(0.065, 0.065, 0.2, 10), c, m: TR(x, y, z, rx, 0, rz) });
      P.push({ g: new THREE.CylinderGeometry(0.066, 0.066, 0.03, 10), c: 0xc9ced6, m: TR(x, y, z, rx, 0, rz).multiply(T(0, 0.085, 0)) });
    };
    // stage 0: a couple of bags
    bag(0.38, 0.24, 0.15, 0.3);
    bag(-0.32, 0.22, -0.12, 0.28, 0x2f4a2f);
    can(0.1, 0.07, 0.55, 0xd8412f, Math.PI / 2, 0.4);
    if (s >= 1) {
      bag(0.0, 0.26, -0.42, 0.32, 0x22252b, 1);
      bag(-0.58, 0.22, 0.32, 0.27, 0x2a2d35, 2);
      bag(0.62, 0.22, -0.32, 0.27, 0x2f4a2f, 3);
      can(-0.25, 0.07, 0.62, 0x2f7de1, Math.PI / 2, -0.9);
      P.push({ g: new THREE.BoxGeometry(0.3, 0.04, 0.3), c: 0xe8e2d0, m: TR(0.55, 0.03, 0.45, 0, 0.5, 0) }); // napkins
    }
    if (s >= 2) {
      // the seat: a blue milk crate on the heap, with a squashed bag as the royal cushion
      P.push({ g: new THREE.BoxGeometry(0.95, 0.42, 0.75), c: 0x2f6fb5, m: T(0, 0.42, 0) });
      for (const x of [-0.3, 0, 0.3]) P.push({ g: new THREE.BoxGeometry(0.08, 0.3, 0.77), c: 0x24578f, m: T(x, 0.42, 0) });
      P.push({ g: new THREE.IcosahedronGeometry(0.4, 1), c: 0x7b3fa0, m: TR(0, SEAT_Y - 0.08, 0.02, 0, 0, 0, [1.12, 0.22, 0.9]) });
      bag(-0.62, 0.25, -0.2, 0.3, 0x22252b, 4);
      bag(0.66, 0.25, 0.12, 0.29, 0x22252b, 5);
      bag(0.0, 0.18, 0.62, 0.22, 0x2f4a2f, 6, 0.7); // the front step
    }
    if (s >= 3) {
      // pizza-box backrest (lid open), soda-can armrests
      P.push({ g: new THREE.BoxGeometry(1.05, 1.15, 0.07), c: 0xc9a26b, m: TR(0, 1.33, -0.42, -0.12, 0, 0) });
      P.push({ g: new THREE.BoxGeometry(0.98, 0.14, 0.072), c: 0xd8412f, m: TR(0, 1.78, -0.405, -0.12, 0, 0) });
      P.push({ g: new THREE.BoxGeometry(1.0, 1.05, 0.05), c: 0xb88e58, m: TR(0, 1.3, -0.5, -0.2, 0, 0) });
      for (const sx of [-1, 1]) {
        for (let k = 0; k < 3; k++) can(sx * 0.56, 0.72 + k * 0.2, 0.05, [0xd8412f, 0x35b36a, 0xc9ced6][(k + (sx > 0 ? 1 : 0)) % 3]);
        P.push({ g: new THREE.BoxGeometry(0.2, 0.05, 0.42), c: 0xc9a26b, m: T(sx * 0.56, 1.24, 0.05) });
      }
    }
    if (s >= 4) {
      // the traffic-cone spire, the hubcap crest, banana-peel garnish, bottle-cap jewels
      P.push({ g: new THREE.CylinderGeometry(0.2, 0.2, 0.05, 4), c: 0xff7a1a, m: TR(0, 1.97, -0.48, 0, Math.PI / 4, 0) });
      P.push({ g: new THREE.ConeGeometry(0.17, 0.7, 14), c: 0xff7a1a, m: T(0, 2.34, -0.48) });
      P.push({ g: new THREE.CylinderGeometry(0.116, 0.13, 0.09, 14), c: 0xf4f4f0, m: T(0, 2.27, -0.48) });
      P.push({ g: new THREE.CylinderGeometry(0.06, 0.075, 0.07, 14), c: 0xf4f4f0, m: T(0, 2.5, -0.48) });
      P.push({ g: new THREE.CylinderGeometry(0.3, 0.3, 0.04, 22), c: 0xd9dde0, m: TR(0, 1.33, -0.36, Math.PI / 2 - 0.12, 0, 0) });
      P.push({ g: new THREE.CylinderGeometry(0.12, 0.12, 0.05, 16), c: 0x9aa3ad, m: TR(0, 1.33, -0.34, Math.PI / 2 - 0.12, 0, 0) });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        P.push({ g: new THREE.BoxGeometry(0.05, 0.16, 0.03), c: 0x6b7480, m: TR(Math.cos(a) * 0.2, 1.33 + Math.sin(a) * 0.2, -0.33, -0.12, 0, a) });
      }
      P.push({ g: new THREE.TorusGeometry(0.12, 0.035, 5, 10, Math.PI), c: 0xf2d23a, m: TR(0.56, 1.29, 0.12, 0, 0.4, 0) });
      for (let i = 0; i < 7; i++) {
        const x = -0.45 + i * 0.15;
        P.push({ g: new THREE.CylinderGeometry(0.035, 0.035, 0.015, 10), c: 0xffcf2e, m: TR(x, 1.86 - Math.abs(x) * 0.1, -0.395, Math.PI / 2 - 0.12, 0, 0) });
      }
    }
    return P;
  }

  private stageFor(n: number) {
    let s = -1;
    for (let i = 0; i < STAGES.length; i++) if (n >= STAGES[i]) s = i;
    return s;
  }

  private setStage() {
    const s = this.stageFor(this.count);
    if (s === this.stage) return;
    this.stage = s;
    if (this.pile) {
      this.pile.geometry.dispose();
      this.root.remove(this.pile);
      this.pile = null;
    }
    if (s >= 0) {
      this.pile = paintMesh(this.pileParts(s));
      this.root.add(this.pile);
    }
    if (s >= 4 && !this.seatColliders && this.spot) {
      this.seatColliders = true;
      const w = this.game.get<any>('world');
      const at = (x: number, y: number, z: number) => this.spot!.clone().add(new THREE.Vector3(x, y, z));
      w?.collider?.(at(0, SEAT_Y / 2 - 0.02, 0), new THREE.Vector3(1.0, SEAT_Y - 0.04, 0.8), 0);
      w?.collider?.(at(0, 1.3, -0.45), new THREE.Vector3(1.05, 1.2, 0.2), 0);
      w?.collider?.(at(0, 0.17, 0.62), new THREE.Vector3(0.6, 0.34, 0.42), 0);
      for (const sx of [-1, 1]) w?.collider?.(at(sx * 0.62, 0.35, -0.1), new THREE.Vector3(0.5, 0.7, 0.8), 0);
      this.game.physics.refreshQueries();
    }
  }

  // --------------------------------------------------------------------------------------------- tribute
  private accept(e: Entity) {
    const game = this.game;
    const t = e.body!.translation();
    const p = new THREE.Vector3(t.x, t.y, t.z);
    destroyProp(game, e);
    this.count = Math.min(NEED, this.count + 1);
    saveState('throne', { count: this.count, crowned: this.crowned });
    this.sign?.redraw();
    fx(game, 'trash', p, { scale: 0.6 });
    fx(game, 'sparkles', p.clone().setY(p.y + 0.3), { count: 8, color: 0xffcf2e, radius: 0.4 });
    game.sfx('rummage', p, 0.8, 1.2);
    game.score(60, 'Royal Tribute', p.clone().setY(p.y + 0.8));
    objSet(game, 'trashKing', Math.min(this.count, NEED - 1));
    game.events.emit('throneTribute', { count: this.count });
    const before = this.stage;
    this.setStage();
    if (this.stage !== before && this.spot) {
      fx(game, 'puff', this.spot.clone().setY(this.spot.y + 0.4), { scale: 1.4 });
      game.sfx('boing', this.spot, 0.6, 0.8);
    }
    if (this.count >= NEED) this.complete();
    else if (this.count === 1) game.hint('The ring accepts your tribute. The throne… begins. (1/10)', 3);
    else if (this.stage !== before) game.hint(`The pile grows more regal. (${this.count}/${NEED})`, 2.4);
  }

  private complete() {
    const game = this.game;
    if (!this.spot) return;
    celebrate(game, 'THRONE COMPLETE', 'A seat fit for a round boy.', '#ffcf2e');
    fx(game, 'confetti', this.spot.clone().setY(this.spot.y + 2), { count: 60, radius: 1.5 });
    fx(game, 'sparkles', this.spot.clone().setY(this.spot.y + 1.2), { count: 30, radius: 1, color: 0xffcf2e });
    game.sfx('jingle_win');
    game.events.emit('throneComplete', {});
    this.timers.after(1.6, () => game.hint('The Trash Throne is ready. Hop onto the seat, Your Majesty.', 4));
  }

  /** Test hook: add tribute without items. */
  addTribute(n = 1) {
    for (let i = 0; i < n && this.count < NEED; i++) {
      this.count++;
      objSet(this.game, 'trashKing', Math.min(this.count, NEED - 1));
    }
    saveState('throne', { count: this.count, crowned: this.crowned });
    this.sign?.redraw();
    this.setStage();
    if (this.count >= NEED) this.complete();
  }

  /** Test hook: drop real trash/food items into the ring (one every 0.3 s). */
  fill(n = NEED - this.count) {
    if (!this.spot) return false;
    const kinds = ['sodaCan', 'appleCore', 'takeout', 'newspaper', 'fishBones', 'pizza', 'sandwich', 'bananaPeel', 'glassBottle', 'grapes'];
    for (let i = 0; i < n; i++) {
      this.timers.after(0.3 * i, () => {
        const a = rand(0, Math.PI * 2);
        const p = this.spot!.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, 0.5, Math.sin(a) * 0.5 + 0.5));
        try {
          spawnItem(this.game, kinds[i % kinds.length], p, a);
        } catch (err) {
          console.warn('[capers] throne fill', err);
        }
      });
    }
    return true;
  }

  // --------------------------------------------------------------------------------------------- crowning
  private wearCrown() {
    if (this.crown) return;
    this.crown = new Attachment('Head', (a) => ({ obj: buildCrown(a), glb: false }), [], false);
  }

  private crownMe() {
    const game = this.game;
    const pl = playerOf(game);
    if (!pl || !this.spot) return;
    const first = !this.crowned;
    this.crowned = true;
    saveState('throne', { count: this.count, crowned: true });
    this.sign?.redraw();
    this.wearCrown();
    const top = pl.position.clone().setY(pl.position.y + 0.7);
    fx(game, 'sparkles', top, { count: 40, radius: 0.6, color: 0xffcf2e });
    fx(game, 'confetti', top.clone().setY(top.y + 1.5), { count: 50, radius: 1.2 });
    game.sfx('crowd_cheer', this.spot, 0.9);
    game.sfx('happy', pl.position, 0.9, 1.1);
    if (first) {
      celebrate(game, 'ALL HAIL THE TRASH KING', 'Long may he rummage.', '#ffcf2e');
      objSet(game, 'trashKing', NEED);
      game.events.emit('trashKingCrowned', {});
      this.spawnSubjects();
    } else {
      game.score(150, 'Royal Audience', top);
    }
    this.bowNearby();
  }

  private bowNearby() {
    const game = this.game;
    const pl = playerOf(game);
    const npcs = game.get<any>('npcs');
    if (!npcs?.near || !pl || !this.spot) return;
    const list = npcs.near(this.spot, 22) as any[];
    list.forEach((n, i) => {
      if (n.removed || n.ragdolled) return;
      this.timers.after(0.2 + i * 0.25, () => {
        if (n.removed || n.ragdolled) return;
        n.face?.(pl.position);
        n.lookAt?.('player');
        if (i % 3 === 1) n.emote?.('aww', 2.5);
        else n.cheer?.(2.5);
        if (i < 4) n.say?.(SUBJECT_LINES[(i + Math.floor(rand(0, 6))) % SUBJECT_LINES.length], 2.8);
      });
    });
  }

  private spawnSubjects() {
    const game = this.game;
    const npcs = game.get<any>('npcs');
    if (!npcs?.spawn || !this.spot || this.subjects.length) return;
    const names = ['Loyal Subject', 'Royal Fan', 'Alley Courtier'];
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i - 1) * 0.7;
      const p = this.spot.clone().add(new THREE.Vector3(Math.cos(a) * 3.6, 0, Math.sin(a) * 3.6));
      try {
        const n = npcs.spawn({ type: 'fan', name: names[i], position: p, wander: { center: this.spot.clone().add(new THREE.Vector3(0, 0, 3.2)), radius: 2.5 }, lookAtPlayer: true, seed: 7100 + i });
        this.subjects.push(n);
        this.timers.after(0.8 + i * 0.3, () => {
          n.cheer?.(3);
          n.say?.(pick(SUBJECT_LINES), 3);
        });
      } catch (err) {
        console.warn('[capers] throne subjects', err);
      }
    }
  }

  /** Test hook: put Jimothy on the seat. */
  sit() {
    const pl = playerOf(this.game);
    if (!pl || !this.spot) return false;
    pl.teleport(this.spot.clone().add(new THREE.Vector3(0, SEAT_Y + 0.45, 0.05)), 0);
    return true;
  }

  /** Test hook: stand in front of the ring, facing the sign. */
  visit() {
    const pl = playerOf(this.game);
    if (!pl || !this.spot) return false;
    pl.teleport(this.spot.clone().add(new THREE.Vector3(0, 0.5, 3.2)), Math.PI);
    return true;
  }

  // --------------------------------------------------------------------------------------------- per frame
  update(dt: number) {
    const game = this.game;
    this.timers.tick();
    if (!this.spot) return;
    const pl = playerOf(game);
    if (!pl) return;
    const d = pl.position.distanceTo(this.spot);
    this.sitCd -= dt;
    this.hintCd -= dt;
    if (d > 45) return;
    // tribute scan
    this.scanT -= dt;
    if (this.scanT <= 0 && this.count < NEED) {
      this.scanT = 0.25;
      const hits: Entity[] = [];
      for (const e of game.entities.list) {
        if (!e.alive || !e.body || !e.body.isDynamic()) continue;
        if (!(e.tags.has('trash') || e.tags.has('food')) || e.tags.has('keep') || e.tags.has('quest')) continue;
        if (e.data.heldByPlayer || e.data.heldByNpc || e.data.npcHeld || e.data.heldBy || e.data.consumed) continue;
        const t = e.body.translation();
        if (Math.abs(t.y - this.spot.y) > 1.3) continue;
        if ((t.x - this.spot.x) ** 2 + (t.z - this.spot.z) ** 2 > RING_R * RING_R) continue;
        hits.push(e);
      }
      for (const e of hits) if (this.count < NEED) this.accept(e);
    }
    if (d < 6 && this.hintCd <= 0 && this.count < NEED && !pl.held?.entity) {
      this.hintCd = 30;
      game.hint('FUTURE SITE OF THE TRASH THRONE. Drop trash or snacks in the ring. The throne will rise.', 4);
    }
    // sitting on the finished throne
    if (this.count >= NEED && this.sitCd <= 0 && pl.mode === 'walk') {
      const dx = pl.position.x - this.spot.x;
      const dz = pl.position.z - (this.spot.z + 0.05);
      const dy = pl.position.y - (this.spot.y + SEAT_Y);
      if (dx * dx + dz * dz < 0.5 * 0.5 && dy > 0 && dy < 0.75 && pl.grounded) {
        this.sitCd = this.crowned ? 20 : 4;
        this.crownMe();
      }
    }
    // a little royal sparkle on the finished throne
    if (this.count >= NEED && nearCamera(game, this.spot, 40)) {
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT = 0.7;
        fx(game, 'glint', this.spot.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(1.2, 2.6), -0.4)), {});
      }
    }
  }

  lateUpdate() {
    if (!this.crown) return;
    const pl = playerOf(this.game);
    const model = pl?.model;
    if (!model) return;
    const mut = this.game.get<any>('mutators');
    const hatOn = !!mut?.list?.some?.((m: any) => m.enabled && m.group === 'hat');
    if (hatOn) this.crown.remove();
    else this.crown.ensure(model);
  }
}

/** A little gold crown (5 points, red and blue gems), fitted to the head like the mutator hats. */
function buildCrown(a: HeadAnchors): THREE.Object3D {
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2c230, metalness: 0.75, roughness: 0.28, emissive: 0x5a3a00, emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const ruby = new THREE.MeshStandardMaterial({ color: 0xd8213a, roughness: 0.2, metalness: 0.1, emissive: 0x500010, emissiveIntensity: 0.5 });
  const saph = new THREE.MeshStandardMaterial({ color: 0x2f6fe1, roughness: 0.2, metalness: 0.1, emissive: 0x001850, emissiveIntensity: 0.5 });
  const g = new THREE.Group();
  g.name = 'TrashKingCrown';
  const R = 0.5;
  const H = 0.36;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.94, H, 20, 1, true), gold);
  band.position.y = H / 2;
  g.add(band);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.98, 0.04, 6, 24), gold);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.03;
  g.add(rim);
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 4), gold);
    spike.position.set(Math.sin(ang) * R * 0.97, H + 0.14, Math.cos(ang) * R * 0.97);
    g.add(spike);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), gold);
    ball.position.set(Math.sin(ang) * R * 0.97, H + 0.32, Math.cos(ang) * R * 0.97);
    g.add(ball);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), i % 2 ? saph : ruby);
    gem.position.set(Math.sin(ang + Math.PI / 5) * R * 1.0, H * 0.5, Math.cos(ang + Math.PI / 5) * R * 1.0);
    gem.scale.set(1, 1, 0.6);
    gem.lookAt(gem.position.clone().multiplyScalar(2));
    g.add(gem);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });
  const holder = new THREE.Group();
  holder.add(g);
  if (a.quad) {
    // the walking Jimothy: a touch narrower than his head between the ears, sat on his crown, tilted with his head
    g.scale.setScalar((a.quad.hatWidth * 0.78) / (R * 2));
    holder.position.copy(a.quad.hatBase);
    holder.rotation.x = a.quad.tilt;
  } else {
    g.scale.setScalar(0.12 * a.scale);
    holder.position.copy(a.crown).add(new THREE.Vector3(0, -0.02 * a.scale, 0));
    holder.rotation.x = -0.12;
  }
  return holder;
}
