import * as THREE from 'three';
import type { Game } from '../../core/Game';
import {
  type ChaosFeature, objProgress, addObjective, pick, rand, fx, playerOf, uiOf, poi, groundY, paintMesh, T, Timers,
  footprintClear,
} from './shared';

/**
 * TOUR GROUP BOWLING. A walking tour ("Ballard-ish Walking Tours") stands in a tight cluster at the foot of the
 * Space Noodle, phones up, while their guide waves a little orange flag. They never move. They are pins.
 * Tuck & Roll into them: knock 4+ of the 9 (guide included) over within a couple of seconds → TOUR GROUP STRIKE (all of them = PERFECT GAME).
 * They get back up and shuffle back into formation; the guide carries on with the spiel.
 *
 * Events: 'tourStrike' { count, perfect, position }. Objective: 'tourStrike'.
 */

const GUIDE_LINES = [
  "On your left: the Space Noodle. On your right: a suspiciously round raccoon.",
  'The Noodle is 100% hand-made. No AI was used. Mostly.',
  'Please stay together, and do not feed the raccoon.',
  'Fun fact: Seattle has more espresso stands than raccoons. For now.',
  "Group photo! Everyone say 'JIMOTHY!'",
  'If you look closely, you can see a raccoon rolling toward us at speed.',
];
const TOURIST_LINES = ['JIMOTHY!!', 'Is that the raccoon from the internet?', 'Get one of me AND the Noodle!', "He's so round!", 'Hold still, Jimothy!'];
const AFTER_LINES = ['Five stars!', 'Best tour ever!', 'Worth every penny!', 'Can we do that again?', 'I felt that in my fanny pack.', 'Was that included?'];
const GUIDE_AFTER = ['...and that concludes our tour.', 'Please keep your arms inside the raccoon at all times.', 'Gift shop is to your left. Mind the raccoon.'];

const STRIKE_WINDOW = 2.6;
const STRIKE_MIN = 4;

interface Member {
  npc: any;
  home: THREE.Vector3;
  yaw: number;
  walking: boolean;
  guide: boolean;
  walkT: number;
  token: number;
}

export class TourGroupFeature implements ChaosFeature {
  readonly id = 'tourGroup';
  readonly members: Member[] = [];
  center: THREE.Vector3 | null = null;
  private target = new THREE.Vector3();
  private knocks = new Map<number, number>();
  private lastStrike = -100;
  private spielT = 4;
  private cheerT = 0;
  private flag: THREE.Object3D | null = null;
  private timers: Timers;
  private spawned = false;
  private retryAt = 0;

  constructor(private game: Game) {
    this.timers = new Timers(game);
  }

  init() {
    const game = this.game;
    addObjective(game, {
      id: 'tourStrike',
      category: 'chaos',
      points: 1500,
      title: 'Tour Group Strike',
      desc: 'Tuck & Roll into the walking tour at the Space Noodle and knock 4 of them over at once. They are basically pins.',
    });
    game.events.on('npcRagdoll', (e: any) => this.onRagdoll(e));
  }

  /** Spawn the group (first frame, once the NPC system is populated). */
  private spawnGroup() {
    const game = this.game;
    const npcs = game.get<any>('npcs');
    if (!npcs?.spawn) return false;
    const base = poi(game, 'spaceNoodleBase', new THREE.Vector3(143, 0.2, -38));
    // the Noodle stands east of its base POI; the group stands back from it, facing it
    const noodle = base.clone().add(new THREE.Vector3(7, 0, 0));
    const away = base.clone().sub(noodle).setY(0).normalize();
    let c: THREE.Vector3 | null = null;
    for (const d of [3.5, 5, 6.5, 2.5, 8]) {
      for (const side of [0, 2.5, -2.5, 5, -5]) {
        const p = base.clone().addScaledVector(away, d).add(new THREE.Vector3(-away.z * side, 0, away.x * side));
        p.y = groundY(game, p.x, p.z, base.y + 6);
        if (npcs.onRoad?.(p.x, p.z, 5.5)) continue;
        if (!footprintClear(game, p, new THREE.Vector3(1.9, 0.9, 1.9))) continue;
        c = p;
        break;
      }
      if (c) break;
    }
    if (!c) {
      console.info('[chaos] no room for the tour group; skipped');
      return true;
    }
    this.center = c;
    this.target.copy(noodle);
    const yaw = Math.atan2(noodle.x - c.x, noodle.z - c.z);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    // two tight rows (4 + 4, staggered), guide in front facing them
    const spots: [number, number][] = [
      [-1.05, 0.35], [-0.35, 0.35], [0.35, 0.35], [1.05, 0.35],
      [-0.7, -0.35], [0, -0.35], [0.7, -0.35], [0, -1.05],
    ];
    const outfits = [0x3fa7ff, 0xff66c4, 0x3bd16f, 0xffd23f, 0xa56bff, 0xff9a3c, 0x55b8ff, 0xf4f4f4];
    spots.forEach(([x, z], i) => {
      const home = c!.clone().addScaledVector(right, x).addScaledVector(fwd, z);
      home.y = groundY(game, home.x, home.z, c!.y + 3);
      this.addMember(npcs, home, yaw, false, i, outfits[i % outfits.length]);
    });
    const gHome = c.clone().addScaledVector(fwd, 1.7);
    gHome.y = groundY(game, gHome.x, gHome.z, c.y + 3);
    this.addMember(npcs, gHome, yaw + Math.PI, true, 99, 0xff8a2a);
    game.get<any>('world')?.poi?.set('tourGroup', c.clone());
    this.buildFlag();
    console.info(`[chaos] tour group of ${this.members.length} at the Space Noodle`);
    return true;
  }

  private addMember(npcs: any, home: THREE.Vector3, yaw: number, guide: boolean, i: number, top: number) {
    try {
      const npc = npcs.spawn({
        type: guide ? 'pedestrian' : 'tourist',
        position: home.clone(),
        name: guide ? 'the Tour Guide' : 'a Tourist',
        outfit: guide ? { top, hat: 'cap' } : { top },
        stationary: true,
        passive: true,
        holding: guide ? null : 'phone',
        facing: yaw,
        seed: 777 + i,
      });
      const m: Member = { npc, home, yaw, walking: false, guide, walkT: 0, token: 0 };
      npc.setCustom((n: any, dt: number) => this.control(m, n, dt));
      this.members.push(m);
    } catch (err) {
      console.warn('[chaos] tour member spawn failed', err);
    }
  }

  /** Custom brain: stand in formation, phone up; walk back into formation after a knockdown. */
  private control(m: Member, n: any, dt: number) {
    if (n.ragdolled || n.removed) return;
    const d = Math.hypot(n.position.x - m.home.x, n.position.z - m.home.z);
    if (d > 0.5) {
      m.walkT += dt || 1 / 60;
      // stuck behind something (or knocked far away)? retry, and eventually just shuffle back into place
      if (m.walking && m.walkT > 9) m.walking = false;
      if (m.walkT > 24) {
        m.walkT = 0;
        m.walking = false;
        n.teleport?.(m.home, m.yaw);
        return;
      }
      if (!m.walking) {
        m.walking = true;
        const token = ++m.token;
        n.walkTo(m.home, { speed: d > 6 ? 2.6 : 1.5, arrive: 0.3 }).then(() => {
          if (m.token === token) m.walking = false;
        });
      }
      return;
    }
    m.walkT = 0;
    if (m.walking) return;
    n.face(m.yaw);
    const want = m.guide ? 'point' : 'film';
    if (n.gesture !== want && n.gesture !== 'cheer' && n.gesture !== 'wave') n.gesture = want;
  }

  private buildFlag() {
    const pole = 0xdedede;
    const cloth = 0xff8a2a;
    const f = paintMesh(
      [
        { g: new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6), c: pole, m: T(0, 0.45, 0) },
        { g: new THREE.BoxGeometry(0.02, 0.22, 0.34), c: cloth, m: T(0, 0.9, 0.18) },
      ],
      false,
    );
    f.name = 'tourFlag';
    this.game.scene.add(f);
    this.flag = f;
  }

  private onRagdoll(e: any) {
    const game = this.game;
    const id = e?.entity?.id;
    if (id == null || !this.members.some((m) => m.npc?.entity?.id === id)) return;
    const t = game.time;
    this.knocks.set(id, t);
    for (const [k, at] of this.knocks) if (t - at > STRIKE_WINDOW) this.knocks.delete(k);
    const n = this.knocks.size;
    const byPlayer = e.byPlayer !== false;
    if (n >= STRIKE_MIN && t - this.lastStrike > 12 && byPlayer) {
      this.lastStrike = t;
      // let the rest of the dominoes land before judging "perfect"
      this.timers.after(0.9, () => this.strike());
    }
  }

  private strike() {
    const game = this.game;
    const t = game.time;
    let n = 0;
    for (const [, at] of this.knocks) if (t - at < STRIKE_WINDOW + 1) n++;
    const perfect = n >= this.members.length;
    const pos = (this.center ?? playerOf(game)?.position ?? new THREE.Vector3()).clone();
    pos.y += 2;
    game.score(perfect ? 3000 : 1500, perfect ? 'PERFECT GAME' : 'TOUR GROUP STRIKE', pos);
    uiOf(game)?.celebrate?.(perfect ? 'PERFECT GAME!' : 'TOUR GROUP STRIKE!', perfect ? `All ${n} pins. The tour is cancelled.` : `${n} tourists down`, '#ffd23f');
    game.sfx('crowd_cheer', pos, 0.9);
    game.sfx('bonk', pos, 0.8, 0.7);
    fx(game, 'confetti', pos, { count: 90 });
    objProgress(game, 'tourStrike');
    game.events.emit('tourStrike', { count: n, perfect, position: pos });
    // once they're back up: reviews
    this.timers.after(6, () => {
      for (const m of this.members) {
        const npc = m.npc;
        if (!npc || npc.removed || npc.ragdolled) continue;
        if (m.guide) npc.say(pick(GUIDE_AFTER), 3);
        else if (Math.random() < 0.4) this.timers.after(rand(0.3, 1.6), () => !npc.removed && !npc.ragdolled && npc.say(pick(AFTER_LINES), 2.4));
      }
    });
  }

  update(dt: number) {
    const game = this.game;
    this.timers.tick();
    if (!this.spawned) {
      if (game.time < this.retryAt) return;
      const npcs = game.get<any>('npcs');
      // wait until the NPC system has populated (it spawns on its first frame)
      if (!npcs || !(npcs.list?.length > 0)) {
        this.retryAt = game.time + 0.5;
        return;
      }
      this.spawned = true;
      try {
        this.spawnGroup();
      } catch (err) {
        console.warn('[chaos] tour group failed', err);
      }
      return;
    }
    if (!this.center) return;
    const pl = playerOf(game);
    const near = pl?.position && pl.position.distanceTo(this.center) < 30;
    if (!near) return;
    // the spiel
    this.spielT -= dt;
    if (this.spielT <= 0) {
      this.spielT = rand(6.5, 9.5);
      const g = this.members.find((m) => m.guide)?.npc;
      if (g && !g.removed && !g.ragdolled) g.say(pick(GUIDE_LINES), 3.2);
    }
    this.cheerT -= dt;
    if (this.cheerT <= 0 && pl.position.distanceTo(this.center) < 12) {
      this.cheerT = rand(5, 9);
      const list = this.members.filter((m) => !m.guide && !m.npc.removed && !m.npc.ragdolled && !m.walking);
      if (list.length) {
        const m = pick(list);
        m.npc.say(pick(TOURIST_LINES), 2.2);
        m.npc.emote?.('cheer', 1.2);
        game.events.emit('cameraFlash', { position: m.npc.position.clone().setY(m.npc.position.y + 1.4), by: m.npc.entity });
      }
    }
  }

  lateUpdate() {
    const f = this.flag;
    if (!f) return;
    const g = this.members.find((m) => m.guide)?.npc;
    if (!g || g.removed) {
      f.visible = false;
      return;
    }
    f.visible = true;
    try {
      g.handPos(f.position);
      f.position.y -= 0.05;
      f.rotation.set(0, g.yaw ?? 0, Math.sin(this.game.time * 3) * 0.12);
    } catch {
      f.visible = false;
    }
  }

  /** Debug/test: stand `dist` m back from the group, facing it (lined up for a bowling run). */
  lineUp(dist = 12) {
    const pl = playerOf(this.game);
    if (!pl || !this.center) return false;
    const away = this.center.clone().sub(this.target).setY(0).normalize();
    const at = this.center.clone().addScaledVector(away, dist);
    at.y = groundY(this.game, at.x, at.z, this.center.y + 4) + 0.45;
    pl.teleport(at, Math.atan2(this.center.x - at.x, this.center.z - at.z));
    return true;
  }
}
