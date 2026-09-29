import * as THREE from 'three';
import type { Entity } from '../../../core/Entities';
import { destroyProp } from '../../../entities/Props';
import { Emote } from '../../../entities/animals';
import type { HeartCtx, HeartQuest } from './ctx';
import { buildTeddy, mudPuddle, spawnFallbackTeddy } from './props';
import { buildKid, type Figure } from './humans';

/**
 * Teddy Rescue: a kid is crying because their teddy fell in the mud. The muddy teddy lies at POI `teddy`;
 * wash it (carry it to water, hold Wash) and bring it back → the kid hugs Jimothy.
 * An unwashed teddy gets "Ew, he's still muddy…".
 *
 * Emits: 'teddyReturned', 'questComplete' {id:'teddy'}.
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

/** Little falling tear drops for an NPC's face. */
class Tears {
  private drops: { m: THREE.Mesh; t: number; side: number }[] = [];
  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fd3ff, roughness: 0.05, emissive: 0x2a6fb0, emissiveIntensity: 0.5 });
    const geo = new THREE.SphereGeometry(0.018, 8, 6);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(1, 1.5, 1);
      m.visible = false;
      scene.add(m);
      this.drops.push({ m, t: i / 6, side: i % 2 ? 1 : -1 });
    }
  }
  update(dt: number, head: THREE.Vector3 | null, yaw: number, headR: number) {
    for (const d of this.drops) {
      if (!head) {
        d.m.visible = false;
        continue;
      }
      d.t = (d.t + dt * 0.9) % 1;
      const ox = d.side * headR * 0.45;
      const oz = headR * 0.85;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      d.m.visible = true;
      d.m.position.set(head.x + ox * c + oz * s, head.y + headR * 0.05 - d.t * headR * 1.6, head.z - ox * s + oz * c);
      const k = 1 - d.t * 0.6;
      d.m.scale.set(k, 1.5 * k, k);
    }
  }
  hide() {
    for (const d of this.drops) d.m.visible = false;
  }
}

export class TeddyQuest implements HeartQuest {
  readonly id = 'teddy' as const;
  readonly title = 'Teddy Rescue';
  readonly objective = {
    ids: ['teddyRescue', 'teddy_rescue'],
    def: { id: 'teddy_rescue', category: 'heart' as const, points: 2500, title: 'Teddy Rescue', desc: 'Wash the muddy teddy bear and return it to the sad kid.' },
  };
  done = false;
  private ctx!: HeartCtx;
  readonly kidPos = new THREE.Vector3();
  private kidYaw = 0;
  readonly teddySpot = new THREE.Vector3();
  npc: any = null;
  fig: Figure | null = null;
  private emote: Emote | null = null;
  teddy: Entity | null = null;
  private tears: Tears | null = null;
  private lineCd = 3;
  private ewCd = 0;
  private respawnT = 0;
  private exprT = 0;
  private helloCd = 0;
  private hugT = 0;
  private washedHint = false;

  init(ctx: HeartCtx) {
    this.ctx = ctx;
    const sp = ctx.spawnPoint();
    const kid = ctx.poi('sadKid', () => sp.clone().add(new THREE.Vector3(14, 0, 18)));
    this.kidPos.copy(kid.pos);
    const teddy = ctx.poi('teddy', () => kid.pos.clone().add(new THREE.Vector3(-8, 0, 6)));
    this.teddySpot.copy(teddy.pos);
    this.kidYaw = Math.atan2(this.teddySpot.x - this.kidPos.x, this.teddySpot.z - this.kidPos.z);
    // the mud the teddy fell into
    const mud = mudPuddle(0.85);
    mud.position.copy(this.teddySpot).setY(this.teddySpot.y + 0.015);
    ctx.game.scene.add(mud);
    ctx.game.events.on('wash', (p: any) => {
      if (!this.done && p?.entity && p.entity === this.teddy && !this.washedHint) {
        this.washedHint = true;
        this.ctx.onProgress('teddy', this.step());
      }
    });
  }

  setup(ctx: HeartCtx) {
    this.spawnKid(ctx);
    if (this.done) {
      this.becomeHappy();
      return;
    }
    const existing = ctx.game.entities.withTag('teddy').find((e) => e.alive && !e.data.clean && !e.data.washed);
    this.teddy = existing ?? this.spawnTeddy();
  }

  private spawnKid(ctx: HeartCtx) {
    const npc = ctx.spawnNpc({
      type: 'kid',
      position: this.kidPos.clone(),
      name: 'Sad Kid',
      stationary: true,
      lookAtPlayer: true,
      passive: true,
      holding: null,
      facing: this.kidYaw,
    });
    if (npc) {
      this.npc = npc;
      npc.onInteract = (kind: string, item?: Entity) => this.onInteract(kind, item);
      try {
        npc.setExpression?.('sad');
      } catch {
        /* optional */
      }
      this.tears ??= new Tears(ctx.game.scene);
    } else if (!this.fig) {
      const fig = buildKid();
      fig.root.position.copy(this.kidPos);
      fig.root.rotation.y = this.kidYaw;
      ctx.game.scene.add(fig.root);
      fig.setExpression('sad');
      this.fig = fig;
      this.emote = new Emote(fig.root, 1.3, 0.34);
    }
  }

  private spawnTeddy(): Entity {
    const ctx = this.ctx;
    const at = this.teddySpot.clone().setY(this.teddySpot.y + 0.02);
    const e = ctx.spawnItem('teddy', at, () => spawnFallbackTeddy(ctx.game, at));
    if (!e.tags.has('teddy')) e.tags.add('teddy');
    if (!e.data.washed && !e.data.clean) e.data.dirty = true;
    return e;
  }

  private onInteract(kind: string, item?: Entity): boolean | void {
    const ctx = this.ctx;
    if (kind === 'give' && item?.tags?.has('teddy')) {
      this.checkTeddy(item);
      return true;
    }
    if (kind === 'chitter') {
      this.say(this.done ? 'Hi Jimothy!! Teddy says hi too!' : '...hi, raccoon. *sniff*', 2.5);
      return true;
    }
    if (kind === 'grab') {
      this.say(this.done ? 'Hehe! That tickles!' : "Not now, raccoon... I'm sad.", 2.2);
      return true;
    }
  }

  private say(text: string, secs = 3) {
    this.ctx.speak({ npc: this.npc, object: this.fig?.root, emote: this.emote ?? undefined, offsetY: 1.35 }, text, secs);
  }

  private kidHead(out: THREE.Vector3) {
    if (this.npc?.headPosition) return this.npc.headPosition(out);
    return out.copy(this.kidPos).setY(this.kidPos.y + 1.0);
  }

  update(dt: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    this.lineCd -= dt;
    this.ewCd -= dt;
    this.helloCd -= dt;
    const d = ctx.distToPlayer(this.kidPos);
    // someone cleared the NPCs? The kid comes back (with the teddy, if we already returned it).
    if (this.npc?.removed) {
      this.npc = null;
      this.spawnKid(ctx);
      if (this.done) this.becomeHappy();
    }

    if (this.done) {
      this.hugT = Math.max(0, this.hugT - dt);
      if (d < 5 && this.helloCd <= 0 && this.hugT <= 0) {
        this.helloCd = 25;
        this.say(Math.random() < 0.5 ? 'Hi Jimothy!' : 'Teddy and me say hi!', 2.2);
      }
      this.fig?.animate(dt, ctx.time, { hug: this.hugT > 0 ? 1 : 0.6, bounce: this.hugT > 0 ? 1 : 0, lookYaw: player ? this.lookYaw(player.position) : 0 });
      return;
    }

    // crying
    this.exprT -= dt;
    if (this.exprT <= 0) {
      this.exprT = 2;
      try {
        if (this.npc && !this.npc.ragdolled) this.npc.setExpression?.('sad');
      } catch {
        /* optional */
      }
    }
    if (this.tears) {
      const npc = this.npc;
      const visible = npc && !npc.removed && !npc.ragdolled && npc.visible !== false;
      this.tears.update(dt, visible ? this.kidHead(_v) : null, npc?.yaw ?? this.kidYaw, npc?.rig?.dims?.headR ?? 0.14);
    }
    if (d < 8 && this.lineCd <= 0) {
      this.lineCd = 8;
      const t = this.teddy;
      const held = !!t && player?.held?.entity === t;
      this.say(held && (t!.data.washed || t!.data.clean) ? 'Is that... TEDDY?!' : 'My teddy fell in the mud… *sniff*', 3);
    }
    this.fig?.animate(dt, ctx.time, { lookYaw: player && d < 10 ? this.lookYaw(player.position) : 0 });

    // the teddy
    const t = this.teddy;
    if (!t || !t.alive) {
      this.respawnT += dt;
      if (this.respawnT > 8) {
        this.respawnT = 0;
        this.teddy = this.spawnTeddy();
        ctx.hint('Somehow the muddy teddy is back in the mud. Teddies are like that.', 3);
      }
      return;
    }
    const p = entityPos(t, _v);
    if (p && Math.hypot(p.x - this.kidPos.x, p.z - this.kidPos.z) < 2.4 && Math.abs(p.y - this.kidPos.y) < 2.5) this.checkTeddy(t);
  }

  private lookYaw(p: THREE.Vector3) {
    const a = Math.atan2(p.x - this.kidPos.x, p.z - this.kidPos.z) - this.kidYaw;
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  private checkTeddy(t: Entity) {
    if (this.done || t !== this.teddy) return;
    if (t.data.washed || t.data.clean) {
      this.returnTeddy(t);
      return;
    }
    if (this.ewCd <= 0) {
      this.ewCd = 6;
      this.say("Ew, he's still muddy…", 2.6);
      this.ctx.hint('Wash the teddy first: carry it to water and hold Wash (R).', 3.5);
    }
  }

  private returnTeddy(t: Entity) {
    const ctx = this.ctx;
    const game = ctx.game;
    const player = ctx.player;
    if (player?.held?.entity === t) player.release(false);
    destroyProp(game, t);
    this.teddy = null;
    this.done = true;
    this.becomeHappy();
    this.say('You washed him! Thank you, Jimothy!', 3.5);
    game.events.emit('teddyReturned', {});
    ctx.onComplete('teddy');
    game.score(200, 'Returned The Teddy', this.kidPos.clone().setY(this.kidPos.y + 1));
    const head = this.kidHead(new THREE.Vector3());
    ctx.hearts(head, 14);
    ctx.confetti(head, 1);
    game.sfx('crowd_aww', this.kidPos, 0.5, 1.2);
    this.hug();
  }

  /** The kid hugs Jimothy (walks over if it can), with a short close-up. */
  private hug() {
    const ctx = this.ctx;
    const player = ctx.player;
    if (!player) return;
    this.hugT = 3.2;
    const npc = this.npc;
    if (npc && typeof npc.walkTo === 'function') {
      // run up to just in front of Jimothy (not onto whatever he's standing next to)
      const from = npc.position as THREE.Vector3;
      const to = player.position.clone();
      const d = Math.hypot(to.x - from.x, to.z - from.z);
      if (d > 1.1) to.lerp(from, 0.9 / d);
      else to.copy(from);
      npc.walkTo(to, { arrive: 0.3, run: true }).then((ok: boolean) => {
        if (npc.removed) return;
        const yaw = Math.atan2(player.position.x - npc.position.x, player.position.z - npc.position.z);
        npc.setCustom?.((n: any) => {
          n.sep?.set?.(0, 0, 0);
          n.yaw = yaw;
          n.gesture = 'aww';
        });
        ctx.hearts(this.kidHead(new THREE.Vector3()), 8);
        ctx.after(2.6, () => {
          if (npc.removed) return;
          npc.setCustom?.(null);
          npc.walkTo(this.kidPos.clone(), { arrive: 0.4 }).then(() => npc.release?.());
        });
        void ok;
      });
    }
    const focus = () => new THREE.Vector3().copy(this.npc?.position ?? this.kidPos).lerp(player.position, 0.4).setY(player.position.y + 0.45);
    const dx = player.position.x - this.kidPos.x;
    const dz = player.position.z - this.kidPos.z;
    ctx.cutscene({ duration: 3.6, focus, camPos: ctx.orbit(focus, 3, 0.6, Math.atan2(dz, -dx), 0.12), fov: 52 });
  }

  private becomeHappy() {
    this.tears?.hide();
    const teddy = buildTeddy(false).root;
    teddy.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    if (this.npc) {
      try {
        this.npc.setExpression?.('happy');
      } catch {
        /* optional */
      }
      const rig = this.npc.rig;
      const dims = rig?.dims;
      if (rig?.root && dims) {
        teddy.position.set(0, dims.waistY + 0.02, 0.22);
        teddy.scale.setScalar(0.85);
        rig.root.add(teddy);
      }
    } else if (this.fig) {
      this.fig.setExpression('happy');
      teddy.position.set(0, -0.28, 0.05);
      teddy.scale.setScalar(0.8);
      this.fig.hold.add(teddy);
    }
  }

  step() {
    if (this.done) return 'The kid has their (very clean) teddy back.';
    const t = this.teddy;
    if (t && (t.data.washed || t.data.clean)) return 'The teddy is clean! Bring it back to the sad kid.';
    const held = t && this.ctx.player?.held?.entity === t;
    if (held) return 'Wash the muddy teddy: carry it to water and hold Wash (R).';
    return 'A kid lost their teddy in the mud. Find it, wash it, bring it back.';
  }

  target() {
    if (this.done) return null;
    const t = this.teddy;
    if (t && (t.data.washed || t.data.clean)) return this.kidPos;
    return t ? (entityPos(t, new THREE.Vector3()) ?? this.teddySpot) : this.teddySpot;
  }

  save() {
    return { done: this.done };
  }

  load(d: any) {
    this.done = !!d?.done;
  }
}
