import * as THREE from 'three';
import type { Entity } from '../../../core/Entities';
import { destroyProp } from '../../../entities/Props';
import { CrowFlock, type Crow } from '../../../entities/animals';
import type { HeartCtx, HeartQuest } from './ctx';
import { GIFTS, spawnFallbackGift, type GiftDef } from './props';

/**
 * Crow Deals: Seattle crows famously bring gifts. Drop a washed or shiny thing near the crow tree; a crow
 * takes it, flies off, and comes back with a present that it drops at Jimothy's feet. 3 deals completes it.
 * Crows also sometimes swoop on someone's fries (flavor).
 *
 * Emits: 'crowTrade' {count, gift}, 'crowSteal' {npc}, 'questComplete' {id:'crows'}.
 */

const _v = new THREE.Vector3();

function entityPos(e: Entity, out: THREE.Vector3): THREE.Vector3 | null {
  if (!e.alive) return null;
  if (e.body) {
    try {
      const t = e.body.translation();
      return out.set(t.x, t.y, t.z);
    } catch {
      return null;
    }
  }
  return e.object ? out.copy(e.object.position) : null;
}

export class CrowQuest implements HeartQuest {
  readonly id = 'crows' as const;
  readonly title = 'Crow Deals';
  readonly objective = {
    ids: ['crowDeals', 'crow_deals'],
    def: { id: 'crow_deals', category: 'heart' as const, points: 2000, target: 3, title: 'Crow Deals', desc: 'Trade shiny (or freshly washed) things with the crows 3 times.' },
  };
  done = false;
  trades = 0;
  flock!: CrowFlock;
  private ctx!: HeartCtx;
  private offered = new Map<Entity, number>();
  private claimed = new Set<Entity>();
  private meh = new WeakSet<Entity>();
  private stealT = 45 + Math.random() * 30;
  private lastGift = '';
  private hinted = { first: false, meh: 0, near: false };

  init(ctx: HeartCtx) {
    this.ctx = ctx;
    const sp = ctx.spawnPoint();
    const tree = ctx.poi('crowTree', () => sp.clone().add(new THREE.Vector3(-18, 0, 16)));
    this.flock = new CrowFlock(ctx.game, tree.pos, 6);
    for (const c of this.flock.crows) ctx.animals.add(c);
    ctx.game.events.on('release', (p: any) => {
      const e = p?.entity as Entity | undefined;
      if (e && e.kind !== 'animal' && e.kind !== 'npc' && e.kind !== 'player') this.offered.set(e, ctx.time);
    });
  }

  get tree() {
    return this.flock.tree;
  }

  private qualifies(e: Entity) {
    return e.tags.has('shiny') || !!e.data.washed || !!e.data.clean;
  }

  update(dt: number) {
    const ctx = this.ctx;
    this.flock.update(dt);
    const tree = this.tree;

    if (!this.hinted.near && ctx.distToPlayer(tree) < 9) {
      this.hinted.near = true;
      if (!this.done) ctx.hint('The crows eye you. Seattle crows trade gifts for shiny things... Leave something shiny (or freshly washed) by their tree.', 5);
    }

    for (const [e, t] of this.offered) {
      if (!e.alive || ctx.time - t > 45 || this.claimed.has(e)) {
        this.offered.delete(e);
        continue;
      }
      if (e.data.heldByPlayer) continue;
      const p = entityPos(e, _v);
      if (!p || Math.hypot(p.x - tree.x, p.z - tree.z) > 5.5 || Math.abs(p.y - tree.y) > 3) continue;
      const lv = e.body?.linvel();
      if (lv && Math.hypot(lv.x, lv.y, lv.z) > 1.2) continue; // still bouncing
      if (!this.qualifies(e)) {
        if (!this.meh.has(e)) {
          this.meh.add(e);
          const c = this.flock.freeCrow(p);
          c?.cawNow();
          c?.say('dots', 1.4);
          if (ctx.time - this.hinted.meh > 20) {
            this.hinted.meh = ctx.time;
            ctx.hint('The crows inspect it... not shiny, not clean. Unimpressed. (Try washing it first!)', 3.5);
          }
        }
        continue;
      }
      const crow = this.flock.freeCrow(p);
      if (!crow) continue;
      this.claimed.add(e);
      this.offered.delete(e);
      this.startDeal(crow, e);
    }

    // flavor: now and then a crow swoops on somebody's fries
    this.stealT -= dt;
    if (this.stealT <= 0) {
      this.stealT = 55 + Math.random() * 60;
      this.tryStealFries();
    }
  }

  private given = new Set<string>();

  private pickGift(): GiftDef {
    // the first present is always the iconic golden bottle cap; then something new each time if possible
    let opts = !this.lastGift ? [GIFTS[0]] : GIFTS.filter((g) => !this.given.has(g.kind));
    if (!opts.length) opts = GIFTS.filter((g) => g.kind !== this.lastGift);
    const pick = opts[Math.floor(Math.random() * opts.length)];
    this.given.add(pick.kind);
    return pick;
  }

  private startDeal(crow: Crow, item: Entity) {
    const ctx = this.ctx;
    const gift = this.pickGift();
    this.lastGift = gift.kind;
    crow.assign(
      {
        item,
        onTaken: (_c, it) => this.take(it),
        giftVisual: () => gift.build(),
        onDeliver: (pos) => this.deliver(gift, pos),
        onAbort: () => this.claimed.delete(item),
      },
      'fetch',
    );
    if (!this.hinted.first) {
      this.hinted.first = true;
      ctx.hint('A crow eyes your shiny offering... and snatches it! A deal is a deal. Wait for it.', 4);
    }
  }

  private take(item: Entity): THREE.Object3D | null {
    const game = this.ctx.game;
    const vis = item.object ? item.object.clone(true) : null;
    const player = this.ctx.player;
    if (player?.held?.entity === item) player.release(false);
    game.events.emit('crowTook', { entity: item, name: item.name });
    destroyProp(game, item);
    this.claimed.delete(item);
    return vis;
  }

  private deliver(gift: GiftDef, pos: THREE.Vector3) {
    const ctx = this.ctx;
    const game = ctx.game;
    const player = ctx.player;
    const at = pos.clone();
    if (player) {
      // right at his feet, just in front
      const f = player.forwardVec ? player.forwardVec(new THREE.Vector3()) : new THREE.Vector3(0, 0, 1);
      at.set(player.position.x + f.x * 0.75, Math.max(pos.y - 0.4, player.position.y), player.position.z + f.z * 0.75);
    }
    const e = gift.item ? ctx.spawnItem(gift.item, at, () => spawnFallbackGift(game, gift, at)) : spawnFallbackGift(game, gift, at);
    e.data.crowGift = true;
    e.name = gift.name;
    // a crow's present is always extra special
    const mod = ctx.itemsMod;
    try {
      if (gift.tint && e.data.itemKind === gift.item && typeof mod?.tintItem === 'function') mod.tintItem(e, gift.tint, { metalness: 1, roughness: 0.2 });
      if (e.tags.has('shiny') && typeof mod?.makeExtraShiny === 'function') mod.makeExtraShiny(e);
    } catch {
      /* cosmetic only */
    }
    this.trades++;
    game.events.emit('crowTrade', { count: this.trades, gift: gift.name, kind: gift.kind, entity: e });
    game.score(150, `Crow Deal: ${gift.name}`, at.clone());
    ctx.sparkle(at, { radius: 0.4 });
    ctx.onProgress('crows', this.step());
    ctx.onSave();
    if (this.trades >= 3 && !this.done) {
      this.done = true;
      ctx.hearts(at.clone().setY(at.y + 0.6), 10);
      ctx.confetti(at, 1);
      ctx.onComplete('crows');
      ctx.hint('Three deals! The crows now consider you a trusted business partner.', 4);
    } else if (!this.done) ctx.hint(`A crow brought you a ${gift.name}! (${this.trades}/3 deals)`, 3);
    else ctx.hint(`Another crow deal: a ${gift.name}!`, 2.5);
  }

  private tryStealFries() {
    const ctx = this.ctx;
    const sys = ctx.npcSys;
    const list: any[] = Array.isArray(sys?.list) ? sys.list : [];
    const player = ctx.player?.position as THREE.Vector3 | undefined;
    if (!list.length || !player) return;
    const tree = this.tree;
    const cands = list.filter(
      (n) =>
        !n.removed &&
        !n.ragdolled &&
        !n.isCustom &&
        n.position &&
        Math.hypot(n.position.x - tree.x, n.position.z - tree.z) < 45 &&
        Math.hypot(n.position.x - player.x, n.position.z - player.z) < 40,
    );
    if (!cands.length) return;
    const npc = cands[Math.floor(Math.random() * cands.length)];
    const crow = this.flock.freeCrow(npc.position);
    if (!crow) return;
    const head = new THREE.Vector3();
    crow.assign(
      {
        victim: () => (npc.removed || npc.ragdolled ? null : typeof npc.headPosition === 'function' ? npc.headPosition(head) : head.copy(npc.position).setY(npc.position.y + 1.6)),
        onSnatch: () => {
          ctx.speak({ npc }, Math.random() < 0.5 ? 'Hey! My fries!' : 'That crow took my fries!', 2.5);
          try {
            npc.setExpression?.('shock');
            ctx.after(2.5, () => npc.setExpression?.('neutral'));
          } catch {
            /* optional */
          }
          ctx.game.events.emit('crowSteal', { npc, entity: npc.entity });
        },
      },
      'steal',
    );
  }

  step() {
    if (this.done) return `The crows trust you (${this.trades} deals). Shiny things = presents.`;
    return `Drop washed or shiny things by the crow tree: ${this.trades}/3 deals.`;
  }

  target() {
    return this.flock?.tree ?? null;
  }

  save() {
    return { trades: this.trades, done: this.done };
  }

  load(d: any) {
    this.trades = Number(d?.trades) || 0;
    this.done = !!d?.done || this.trades >= 3;
    if (this.trades > 0) this.lastGift = 'x';
  }
}
