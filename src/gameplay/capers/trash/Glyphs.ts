import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import { spawnItemFlying } from '../../items';
import { drawJimothy } from '../../../fx/jimothyArt';
import {
  type CaperFeature, addObjective, objSet, paintMesh, T, TR, surfaceAt, groundY, playerOf, fx, celebrate, rand, nearCamera, Timers,
} from '../shared';
import { canvasPlane, loadState, saveState, showCard } from './common';

/**
 * ANCIENT RACCOON GLYPHS (a secret). Seven small stone tablets carved with glowing raccoon cave paintings, tucked into
 * out-of-the-way places: an Old Ballard rooftop, under the waterfront boardwalk (on the pontoon), behind the stadium
 * scoreboard, out on a branch of the Crow Tree, inside the Locks' fish viewing room, on the SlopCorp data-center
 * roof and on the Library tower's buttress at the University. No map icons; they glint, and hum softly within 8 m.
 * Touching one shows its picture and a line of lore on a card. All seven: a golden aura for a few minutes and a stash
 * of golden trash in the den's alley. Hidden objective 'raccoonArchaeologist' (secret).
 *
 * Events: 'glyphFound' {index, count}, 'glyphsComplete'.
 * Test hooks: `capers.byId.get('glyphs').visit(i)` (teleports next to tablet i and touches it), `.goTo(i)` (just
 * teleports), `.spots` (positions).
 */

interface GlyphDef {
  id: string;
  /** x, z and the height to cast down from (picks the surface under it), facing yaw. */
  at: [number, number, number];
  yaw: number;
  title: string;
  lore: string;
  /** Where Jimothy stands to look at it (offset along the facing). */
}

const DEFS: GlyphDef[] = [
  { id: 'roof', at: [-48, 16, 12], yaw: Math.PI, title: 'The Prophecy', lore: '“The Round One shall come. He shall have no neck, and no notes.”' },
  { id: 'pier', at: [22.2, 167.75, 0.0], yaw: 0, title: 'The First Wash', lore: '“They washed before washing was cool.”' },
  { id: 'stadium', at: [133.5, 69.2, 3], yaw: Math.PI, title: 'Manna From the Stands', lore: '“A dropped hot dog is a gift from the sky. Give thanks. Then run.”' },
  { id: 'tree', at: [-109.5, -33.4, 12], yaw: Math.PI / 2, title: 'The Black-Winged Ones', lore: '“The crows keep our secrets. For a fee. Always pay in shiny.”' },
  { id: 'locks', at: [-169, 155, 2.5], yaw: Math.PI / 2, title: 'The Great Ladder', lore: '“The fish climb the ladder. We wait at the top. Patience is a snack.”' },
  { id: 'slop', at: [-136, -157, 40], yaw: Math.PI, title: 'The Sky Bins', lore: '“The Sky Bins came from beyond the stars. They will come again. Keep a snack ready.”' },
  { id: 'uni', at: [118, -166, 30], yaw: 0, title: 'The Learned Ones', lore: '“Knowledge is knowing where the snacks are. Wisdom is sharing them with Mom.”' },
];

const AURA_SECS = 240;

export class GlyphsFeature implements CaperFeature {
  readonly id = 'glyphs';
  readonly spots: THREE.Vector3[] = [];
  readonly found = new Set<number>();
  private tablets: { root: THREE.Group; face: ReturnType<typeof canvasPlane> }[] = [];
  private humT = 0;
  private sparkT: number[] = [];
  private auraUntil = 0;
  private auraT = 0;
  private timers: Timers;
  private checkT = 0;

  constructor(private game: Game) {
    this.timers = new Timers(game);
  }

  init() {
    const game = this.game;
    game.physics.refreshQueries(); // (zone colliders may not be in the query pipeline yet)
    addObjective(game, {
      id: 'raccoonArchaeologist',
      category: 'secret',
      points: 5000,
      target: DEFS.length,
      hidden: true,
      title: 'Raccoon Archaeologist',
      desc: 'Find all 7 Ancient Raccoon Glyphs. The ancestors were round too.',
    });
    const s = loadState('glyphs', { found: [] as number[] });
    for (const i of s.found) if (i >= 0 && i < DEFS.length) this.found.add(i);
    DEFS.forEach((d, i) => {
      try {
        this.build(d, i);
      } catch (err) {
        console.warn('[capers] glyph failed', d.id, err);
      }
    });
  }

  private build(d: GlyphDef, i: number) {
    const game = this.game;
    const [x, z, from] = d.at;
    const y = surfaceAt(game, x, z, from, 30) ?? groundY(game, x, z, from);
    const pos = new THREE.Vector3(x, y, z);
    this.spots[i] = pos;
    this.sparkT[i] = rand(0, 1);
    const root = new THREE.Group();
    root.position.copy(pos);
    root.rotation.y = d.yaw;
    // the tablet: a weathered slab on a little plinth, leaning back a touch
    const slab = paintMesh(
      [
        { g: new THREE.BoxGeometry(0.62, 0.12, 0.34), c: 0x6f6a62, m: T(0, 0.06, 0) },
        { g: new THREE.BoxGeometry(0.5, 0.62, 0.1), c: 0x8a8378, m: TR(0, 0.42, 0, -0.08, 0, 0) },
        { g: new THREE.CylinderGeometry(0.25, 0.25, 0.1, 14, 1, false, -Math.PI / 2, Math.PI), c: 0x8a8378, m: TR(0, 0.72, -0.025, -Math.PI / 2 - 0.08, 0, 0) },
        { g: new THREE.IcosahedronGeometry(0.07, 0), c: 0x5e5a53, m: T(0.27, 0.13, 0.08) },
        { g: new THREE.IcosahedronGeometry(0.05, 0), c: 0x5e5a53, m: T(-0.25, 0.12, 0.1) },
      ],
      true,
    );
    root.add(slab);
    const face = canvasPlane(0.42, 0.54, 256, 330, (c, w, h) => drawGlyph(c, w, h, i, 'stone'), this.found.has(i) ? 0.35 : 0.9);
    face.mesh.position.set(0, 0.45, 0.056);
    face.mesh.rotation.x = -0.08;
    root.add(face.mesh);
    game.scene.add(root);
    this.tablets[i] = { root, face };
  }

  /** Touch glyph i. */
  touch(i: number) {
    const game = this.game;
    const d = DEFS[i];
    if (!d || this.found.has(i)) return false;
    this.found.add(i);
    saveState('glyphs', { found: [...this.found] });
    const p = this.spots[i].clone().setY(this.spots[i].y + 0.6);
    const n = this.found.size;
    fx(game, 'sparkles', p, { count: 26, radius: 0.5, color: 0xffd36a });
    game.sfx('sparkle', p, 0.9, 0.7);
    game.sfx('mutator_unlock');
    game.score(300, 'Ancient Glyph!', p);
    const t = this.tablets[i];
    if (t) t.face.mat.emissiveIntensity = 0.35;
    showCard(game, {
      kicker: `Ancient Raccoon Glyph · ${n}/${DEFS.length}`,
      title: d.title,
      text: d.lore,
      draw: (c, w, h) => drawGlyph(c, w, h, i, 'card'),
      secs: 7,
      tint: '#8a8378',
    });
    objSet(game, 'raccoonArchaeologist', n);
    game.events.emit('glyphFound', { index: i, count: n });
    if (n >= DEFS.length) this.timers.after(2.5, () => this.reward());
    else if (n === 1) this.timers.after(2.2, () => game.hint('A glyph… there must be more of these hidden around town. Listen for the hum.', 4));
    return true;
  }

  private reward() {
    const game = this.game;
    celebrate(game, 'THE ANCIENTS APPROVE', 'Jimothy glows with ancestral roundness.', '#ffd36a');
    game.sfx('objective_complete');
    this.auraUntil = game.time + AURA_SECS;
    game.events.emit('glyphsComplete', {});
    // the golden stash, behind the den in the alley
    const at = new THREE.Vector3(4, 0, 29);
    at.y = groundY(game, at.x, at.z, 10) + 0.6;
    const loot = ['goldenTrophy', 'goldenTrophy', 'goldenTrophy', 'cash', 'ring', 'bottleCap'];
    loot.forEach((k, j) =>
      this.timers.after(0.2 * j, () => {
        try {
          const e = spawnItemFlying(game, k, at.clone().add(new THREE.Vector3(rand(-0.6, 0.6), 0.3, rand(-0.6, 0.6))), new THREE.Vector3(rand(-1, 1), 3, rand(-1, 1)));
          e.tags.add('keep');
        } catch (err) {
          console.warn('[capers] golden stash', err);
        }
      }),
    );
    game.get<any>('world')?.poi?.set('goldenStash', at.clone());
    this.timers.after(4, () => game.hint('A stash of GOLDEN TRASH has appeared in the alley behind the den. The ancestors provide.', 5));
  }

  /** Test hook: teleport next to glyph i (facing it). */
  goTo(i: number) {
    const pl = playerOf(this.game);
    const p = this.spots[i];
    const d = DEFS[i];
    if (!pl || !p || !d) return false;
    const f = new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw));
    pl.teleport(p.clone().addScaledVector(f, 1.4).setY(p.y + 0.5), d.yaw + Math.PI);
    return true;
  }

  /** Test hook: teleport to glyph i and touch it. */
  visit(i: number) {
    this.goTo(i);
    return this.touch(i);
  }

  private snapped = false;

  /** Re-snap every tablet to its surface once play starts (some zone colliders arrive after the capers init). */
  private snap() {
    DEFS.forEach((d, i) => {
      const [x, z, from] = d.at;
      const y = surfaceAt(this.game, x, z, from, 30);
      const t = this.tablets[i];
      if (y == null || !t || Math.abs(y - this.spots[i].y) < 0.01) return;
      this.spots[i].y = y;
      t.root.position.y = y;
    });
  }

  update(dt: number) {
    const game = this.game;
    this.timers.tick();
    if (!this.snapped && game.state === 'playing') {
      this.snapped = true;
      this.snap();
    }
    const pl = playerOf(game);
    if (!pl) return;
    const pp = pl.position as THREE.Vector3;
    this.humT -= dt;
    this.checkT -= dt;
    let nearest = Infinity;
    for (let i = 0; i < this.spots.length; i++) {
      const p = this.spots[i];
      if (!p) continue;
      const d2 = p.distanceToSquared(pp);
      if (this.found.has(i) || d2 > 40 * 40) continue;
      nearest = Math.min(nearest, d2);
      // touch (center of the slab ~0.4 up)
      if (d2 < 1.6 * 1.6 && Math.abs(pp.y - (p.y + 0.4)) < 1.0 && Math.hypot(pp.x - p.x, pp.z - p.z) < 0.95) this.touch(i);
      if (!nearCamera(game, p, 40)) continue;
      this.sparkT[i] -= dt;
      if (this.sparkT[i] <= 0) {
        this.sparkT[i] = d2 < 64 ? 0.35 : 0.9;
        fx(game, 'glint', p.clone().add(new THREE.Vector3(rand(-0.25, 0.25), rand(0.3, 0.85), rand(-0.1, 0.2))), {});
      }
    }
    // the hum: a low sparkle within 8 m
    if (nearest < 64 && this.humT <= 0) {
      const k = 1 - Math.sqrt(nearest) / 8;
      this.humT = 1.8 - k * 0.9;
      game.sfx('sparkle', undefined, 0.12 + 0.25 * k, 0.45);
    }
    // the golden aura
    if (game.time < this.auraUntil) {
      this.auraT -= dt;
      if (this.auraT <= 0) {
        this.auraT = 0.12;
        const a = rand(0, Math.PI * 2);
        fx(game, 'glint', pp.clone().add(new THREE.Vector3(Math.cos(a) * 0.45, rand(0.1, 0.8), Math.sin(a) * 0.45)), { color: 0xffd36a });
      }
      if (Math.random() < dt * 2) fx(game, 'sparkles', pp.clone().setY(pp.y + 0.4), { count: 4, radius: 0.5, color: 0xffd36a });
    }
  }
}

// ------------------------------------------------------------------------------------------------ glyph art
const OCHRE = '#ffcf6a';

function stoneBg(c: CanvasRenderingContext2D, w: number, h: number) {
  c.fillStyle = '#4a4640';
  c.fillRect(0, 0, w, h);
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    c.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.04 + r() * 0.06})`;
    c.beginPath();
    c.arc(r() * w, r() * h, 2 + r() * 10, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = 'rgba(0,0,0,.35)';
  c.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    c.beginPath();
    let x = r() * w,
      y = r() * h;
    c.moveTo(x, y);
    for (let k = 0; k < 4; k++) c.lineTo((x += (r() - 0.5) * 50), (y += r() * 30));
    c.stroke();
  }
}

function stick(c: CanvasRenderingContext2D, x: number, y: number, s: number, arms: 'up' | 'bow' | 'down' = 'down') {
  c.beginPath();
  c.arc(x, y - s * 1.6, s * 0.35, 0, Math.PI * 2);
  c.moveTo(x, y - s * 1.25);
  if (arms === 'bow') c.lineTo(x + s * 0.5, y - s * 0.6);
  else c.lineTo(x, y - s * 0.5);
  const hx = arms === 'bow' ? x + s * 0.5 : x;
  c.moveTo(hx, y - s * 0.6);
  c.lineTo(hx - s * 0.35, y);
  c.moveTo(hx, y - s * 0.6);
  c.lineTo(hx + s * 0.35, y);
  const ay = arms === 'bow' ? y - s * 0.9 : y - s * 1.1;
  const ax = arms === 'bow' ? x + s * 0.3 : x;
  c.moveTo(ax, ay);
  c.lineTo(ax - s * 0.45, arms === 'up' ? ay - s * 0.6 : ay + s * 0.45);
  c.moveTo(ax, ay);
  c.lineTo(ax + s * 0.45, arms === 'up' ? ay - s * 0.6 : ay + s * 0.45);
  c.stroke();
}

/** One glyph picture: `stone` (the tablet face, portrait) or `card` (the popup, 3:2). */
export function drawGlyph(c: CanvasRenderingContext2D, w: number, h: number, i: number, style: 'stone' | 'card') {
  stoneBg(c, w, h);
  const S = Math.min(w, h);
  const cx = w / 2;
  const cy = h * 0.52;
  c.save();
  c.strokeStyle = OCHRE;
  c.fillStyle = OCHRE;
  c.lineWidth = Math.max(3, S * 0.022);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.shadowColor = 'rgba(255,200,90,.9)';
  c.shadowBlur = S * 0.04;
  const jim = (x: number, y: number, r: number, facing: 1 | -1 = 1) =>
    drawJimothy(c, x, y, r, { flat: true, body: '#d98a3a', mask: '#5a2a14', outline: '#ffcf6a', smile: true, facing });
  // frame
  c.strokeRect(S * 0.05, S * 0.05, w - S * 0.1, h - S * 0.1);
  switch (i) {
    case 0: {
      // the Round One under a great sun, little humans bowing
      c.beginPath();
      c.arc(cx, h * 0.24, S * 0.09, 0, Math.PI * 2);
      c.stroke();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * S * 0.12, h * 0.24 + Math.sin(a) * S * 0.12);
        c.lineTo(cx + Math.cos(a) * S * 0.17, h * 0.24 + Math.sin(a) * S * 0.17);
        c.stroke();
      }
      jim(cx, cy + S * 0.08, S * 0.18);
      stick(c, cx - S * 0.32, h * 0.86, S * 0.09, 'bow');
      stick(c, cx + S * 0.32, h * 0.86, S * 0.09, 'up');
      break;
    }
    case 1: {
      // washing at the water
      jim(cx - S * 0.05, cy - S * 0.02, S * 0.17);
      for (let k = 0; k < 3; k++) {
        c.beginPath();
        for (let x = S * 0.1; x <= w - S * 0.1; x += 4) c.lineTo(x, h * (0.74 + k * 0.06) + Math.sin(x * 0.08 + k) * S * 0.015);
        c.stroke();
      }
      for (const [bx, by, br] of [
        [0.72, 0.42, 0.035],
        [0.8, 0.32, 0.025],
        [0.68, 0.25, 0.02],
      ]) {
        c.beginPath();
        c.arc(w * bx, h * by, S * br, 0, Math.PI * 2);
        c.stroke();
      }
      break;
    }
    case 2: {
      // the diamond, a hot dog falling from the sky into waiting paws
      c.beginPath();
      c.moveTo(cx - S * 0.3, h * 0.3);
      c.lineTo(cx - S * 0.18, h * 0.18);
      c.lineTo(cx - S * 0.06, h * 0.3);
      c.lineTo(cx - S * 0.18, h * 0.42);
      c.closePath();
      c.stroke();
      c.beginPath();
      c.ellipse(cx + S * 0.18, h * 0.22, S * 0.12, S * 0.04, -0.4, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.ellipse(cx + S * 0.18, h * 0.22, S * 0.1, S * 0.018, -0.4, 0, Math.PI * 2);
      c.fill();
      c.setLineDash([S * 0.03, S * 0.03]);
      c.beginPath();
      c.moveTo(cx + S * 0.15, h * 0.3);
      c.lineTo(cx + S * 0.05, h * 0.5);
      c.stroke();
      c.setLineDash([]);
      jim(cx, h * 0.68, S * 0.16, -1);
      break;
    }
    case 3: {
      // crows in a tree, a shiny offering
      c.beginPath();
      c.moveTo(cx - S * 0.05, h * 0.9);
      c.lineTo(cx - S * 0.05, h * 0.35);
      c.moveTo(cx - S * 0.05, h * 0.5);
      c.lineTo(cx + S * 0.25, h * 0.32);
      c.moveTo(cx - S * 0.05, h * 0.45);
      c.lineTo(cx - S * 0.3, h * 0.3);
      c.stroke();
      for (const [x, y] of [
        [0.66, 0.24],
        [0.3, 0.22],
        [0.5, 0.16],
      ]) {
        c.beginPath();
        c.moveTo(w * x - S * 0.06, h * y);
        c.quadraticCurveTo(w * x - S * 0.02, h * y + S * 0.03, w * x, h * y + S * 0.01);
        c.quadraticCurveTo(w * x + S * 0.02, h * y + S * 0.03, w * x + S * 0.06, h * y);
        c.stroke();
      }
      jim(cx + S * 0.2, h * 0.76, S * 0.12, -1);
      c.beginPath();
      c.arc(cx + S * 0.02, h * 0.8, S * 0.035, 0, Math.PI * 2);
      c.fill();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        c.beginPath();
        c.moveTo(cx + S * 0.02 + Math.cos(a) * S * 0.05, h * 0.8 + Math.sin(a) * S * 0.05);
        c.lineTo(cx + S * 0.02 + Math.cos(a) * S * 0.08, h * 0.8 + Math.sin(a) * S * 0.08);
        c.stroke();
      }
      break;
    }
    case 4: {
      // the fish ladder: steps, fish leaping up, a raccoon waiting at the top
      c.beginPath();
      let x = S * 0.12,
        y = h * 0.86;
      c.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        c.lineTo((x += S * 0.13), y);
        c.lineTo(x, (y -= h * 0.1));
      }
      c.lineTo(w - S * 0.08, y);
      c.stroke();
      for (const [fx0, fy0] of [
        [0.28, 0.66],
        [0.5, 0.52],
      ]) {
        c.beginPath();
        c.ellipse(w * fx0, h * fy0, S * 0.05, S * 0.022, -0.6, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.moveTo(w * fx0 - S * 0.04, h * fy0 + S * 0.03);
        c.lineTo(w * fx0 - S * 0.08, h * fy0 + S * 0.02);
        c.lineTo(w * fx0 - S * 0.06, h * fy0 + S * 0.07);
        c.closePath();
        c.fill();
      }
      jim(w * 0.8, y - S * 0.12, S * 0.11, -1);
      break;
    }
    case 5: {
      // THE SKY BINS: a flying saucer beaming up a trash can, a raccoon pointing
      c.beginPath();
      c.ellipse(cx, h * 0.24, S * 0.26, S * 0.06, 0, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(cx, h * 0.22, S * 0.1, Math.PI, 0);
      c.stroke();
      for (let k = -2; k <= 2; k++) {
        c.beginPath();
        c.arc(cx + k * S * 0.1, h * 0.25, S * 0.012, 0, Math.PI * 2);
        c.fill();
      }
      c.save();
      c.globalAlpha = 0.35;
      c.beginPath();
      c.moveTo(cx - S * 0.08, h * 0.29);
      c.lineTo(cx + S * 0.08, h * 0.29);
      c.lineTo(cx + S * 0.16, h * 0.62);
      c.lineTo(cx - S * 0.16, h * 0.62);
      c.closePath();
      c.fill();
      c.restore();
      c.strokeRect(cx - S * 0.06, h * 0.44, S * 0.12, S * 0.14);
      c.beginPath();
      c.moveTo(cx - S * 0.08, h * 0.44);
      c.lineTo(cx + S * 0.08, h * 0.44);
      c.stroke();
      jim(cx - S * 0.25, h * 0.78, S * 0.12);
      stick(c, cx + S * 0.3, h * 0.88, S * 0.08, 'up');
      for (const [sx, sy] of [
        [0.12, 0.12],
        [0.85, 0.16],
        [0.9, 0.42],
      ]) {
        c.beginPath();
        c.arc(w * sx, h * sy, S * 0.01, 0, Math.PI * 2);
        c.fill();
      }
      break;
    }
    default: {
      // the Learned One: a mortarboard, a scroll, an apple core
      jim(cx - S * 0.1, cy + S * 0.1, S * 0.16);
      c.beginPath();
      c.moveTo(cx - S * 0.28, h * 0.3);
      c.lineTo(cx - S * 0.1, h * 0.24);
      c.lineTo(cx + S * 0.08, h * 0.3);
      c.lineTo(cx - S * 0.1, h * 0.36);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(cx + S * 0.05, h * 0.31);
      c.lineTo(cx + S * 0.08, h * 0.44);
      c.stroke();
      c.strokeRect(cx + S * 0.18, h * 0.55, S * 0.14, S * 0.06);
      c.beginPath();
      c.moveTo(cx + S * 0.24, h * 0.76);
      c.quadraticCurveTo(cx + S * 0.2, h * 0.82, cx + S * 0.24, h * 0.88);
      c.moveTo(cx + S * 0.3, h * 0.76);
      c.quadraticCurveTo(cx + S * 0.34, h * 0.82, cx + S * 0.3, h * 0.88);
      c.moveTo(cx + S * 0.27, h * 0.76);
      c.lineTo(cx + S * 0.27, h * 0.72);
      c.stroke();
    }
  }
  c.restore();
  if (style === 'card') {
    c.fillStyle = 'rgba(255,207,106,.6)';
    c.font = `bold ${Math.round(S * 0.06)}px 'Luckiest Guy', 'Arial Black', sans-serif`;
    c.textAlign = 'right';
    c.fillText(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i] ?? '', w - S * 0.08, h - S * 0.08);
  }
}
