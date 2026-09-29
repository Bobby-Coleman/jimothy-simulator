import * as THREE from 'three';
import type { Entity } from '../../../core/Entities';
import { Mom } from '../../../entities/animals';
import type { HeartCtx, HeartQuest } from './ctx';

/**
 * "Mama's Boy": Mom lives at the den. Drop 3 snacks (anything tagged `food`) near her; she eats each one
 * (happy chirr, hearts) and after the third she grooms Jimothy's face in a little close-up moment.
 * She also greets him warmly whenever he comes home at night.
 *
 * Emits: 'momFed' {count, food} (+ 'momSnack' alias for ObjectiveContent), 'momGreeting', 'questComplete' {id:'mama'}.
 */

const _v = new THREE.Vector3();

function entityPos(e: Entity, out: THREE.Vector3): THREE.Vector3 | null {
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

export class MamaQuest implements HeartQuest {
  readonly id = 'mama' as const;
  readonly title = "Mama's Boy";
  readonly objective = {
    ids: ['mamasBoy', 'mamas_boy'],
    def: { id: 'mamas_boy', category: 'heart' as const, points: 2000, target: 3, title: "Mama's Boy", desc: "Bring Mom 3 snacks. She's so proud of you." },
  };
  done = false;
  fed = 0;
  mom!: Mom;
  private ctx!: HeartCtx;
  private watch = new Map<Entity, number>();
  private away = false;
  private hintCd = 0;
  private greetCd = 0;
  grooming = false;
  private groomT = 0;

  init(ctx: HeartCtx) {
    this.ctx = ctx;
    const sp = ctx.spawnPoint();
    const den = ctx.poi('den', () => sp.clone().add(new THREE.Vector3(6, 0, -5)));
    const dx = sp.x - den.pos.x;
    const dz = sp.z - den.pos.z;
    const yaw = Math.hypot(dx, dz) > 2 ? Math.atan2(dx, dz) : Math.PI;
    this.mom = ctx.animals.add(new Mom(ctx.game, den.pos, yaw));
    ctx.game.events.on('release', (p: any) => {
      const e = p?.entity as Entity | undefined;
      if (e && e.tags?.has('food')) this.watch.set(e, ctx.time);
    });
    this.away = ctx.distToPlayer(den.pos) > 25;
  }

  get den() {
    return this.mom.home;
  }

  update(dt: number) {
    const ctx = this.ctx;
    const mom = this.mom;
    const player = ctx.player;
    if (!player || !mom) return;
    this.hintCd -= dt;
    this.greetCd -= dt;

    // --- snacks dropped near Mom
    if (!this.grooming && !mom.isBusy) {
      for (const [e, t] of this.watch) {
        if (!e.alive || ctx.time - t > 30 || e.data.momClaimed) {
          this.watch.delete(e);
          continue;
        }
        if (e.data.heldByPlayer) continue;
        const p = entityPos(e, _v);
        if (!p) continue;
        if (Math.hypot(p.x - mom.pos.x, p.z - mom.pos.z) < 3.4 && Math.abs(p.y - mom.pos.y) < 2.5) {
          this.watch.delete(e);
          const name = e.name;
          mom.takeFood(e, () => this.onFed(name));
          break;
        }
      }
    }

    // --- carrying food near Mom: tell the player what to do
    const held = player.held?.entity as Entity | undefined;
    const dMom = ctx.distToPlayer(mom.pos);
    if (held && held.tags.has('food') && dMom < 3.2 && !this.grooming) {
      ctx.prompt('{grab} Give Mom the snack', 0.3);
      if (this.hintCd <= 0 && this.fed < 3) {
        this.hintCd = 14;
        ctx.hint('Mom sniffs the snack hopefully. Drop it for her!', 3);
        mom.say('heart', 1.5);
      }
    }

    // --- coming home at night: a warm hello
    const dDen = ctx.distToPlayer(mom.home);
    if (dDen > 25) this.away = true;
    else if (this.away && dDen < 7) {
      this.away = false;
      if (ctx.isNight && !mom.isBusy && !this.grooming && this.greetCd <= 0) {
        this.greetCd = 25;
        mom.greet();
        ctx.game.events.emit('momGreeting', {});
        ctx.game.score(25, 'Home Sweet Home', mom.pos.clone());
        ctx.hint('Mom chirrs happily. You\'re home!', 2.5);
      }
    }

    // --- grooming safety net (never leave Jimothy frozen)
    if (this.grooming) {
      this.groomT += dt;
      if (this.groomT > 14) this.finishGrooming();
    }
  }

  private onFed(food: string) {
    const ctx = this.ctx;
    const game = ctx.game;
    this.fed++;
    game.events.emit('momFed', { count: this.fed, food });
    game.events.emit('momSnack', { count: this.fed, food });
    game.score(150, this.fed <= 3 ? `Fed Mom ${Math.min(this.fed, 3)}/3` : 'Spoiled Mom Rotten', this.mom.pos.clone());
    ctx.onProgress('mama', this.step());
    ctx.onSave();
    if (!this.done) {
      if (this.fed >= 3) ctx.after(0.7, () => this.startGrooming());
      else ctx.hint(this.fed === 1 ? `Mom loved the ${food.toLowerCase()}! (${this.fed}/3 snacks)` : `Nom. Mom is getting cozy. (${this.fed}/3 snacks)`, 3);
    }
  }

  private startGrooming() {
    const ctx = this.ctx;
    const player = ctx.player;
    const mom = this.mom;
    if (!player || this.grooming) return;
    this.grooming = true;
    this.groomT = 0;
    if (player.held) player.release(false);
    if (player.mode !== 'walk' && typeof player.setMode === 'function') player.setMode('walk');
    mom.groomJimothy(5.2, () => this.finishGrooming());
    ctx.hint('Mom grooms Jimothy\'s face with her tiny paws. Scrub scrub scrub.', 5);
    const mid = new THREE.Vector3();
    const focus = () => mid.copy(player.position).lerp(mom.pos, 0.45).setY(Math.max(player.position.y, mom.pos.y + 0.4) + 0.12);
    const dx = mom.pos.x - player.position.x;
    const dz = mom.pos.z - player.position.z;
    const a0 = Math.atan2(dz, -dx); // perpendicular to the Jimothy→Mom line
    ctx.cutscene({
      duration: 11,
      focus,
      camPos: ctx.orbit(focus, 2.3, 0.45, a0, 0.09, [
        player.position.clone().setY(player.position.y + 0.3),
        mom.pos.clone().setY(mom.pos.y + 0.6),
      ]),
      fov: 48,
    });
  }

  private finishGrooming() {
    if (!this.grooming) return;
    const ctx = this.ctx;
    const player = ctx.player;
    this.grooming = false;
    ctx.endCutscene();
    const first = !this.done;
    this.done = true;
    if (player) {
      ctx.hearts(player.position.clone().setY(player.position.y + 0.7), 14);
      ctx.confetti(player.position.clone().setY(player.position.y + 0.5), 1.2);
    }
    this.mom.say('heart', 2.5);
    ctx.game.sfx('happy', this.mom.pos, 0.9, 1.05);
    if (first) {
      ctx.onComplete('mama');
      ctx.hint("Mama's Boy! Jimothy's face is spotless. Mom is so proud of her round little guy.", 4.5);
    }
  }

  /** Happy squint + little head tilt while Mom scrubs his face (after the player's own animation). */
  postPhysics() {
    if (!this.grooming) return;
    const player = this.ctx.player;
    const mom = this.mom;
    if (!player?.model) return;
    const d = Math.hypot(mom.pos.x - player.position.x, mom.pos.z - player.position.z);
    player.facing = Math.atan2(mom.pos.x - player.position.x, mom.pos.z - player.position.z);
    if (d > 1.6) return;
    const parts = player.model.parts ?? {};
    for (const n of ['EyeL', 'EyeR']) {
      const e = parts[n] as THREE.Object3D | undefined;
      if (e) e.scale.y = Math.min(e.scale.y, 0.22);
    }
    const head = parts.Head as THREE.Object3D | undefined;
    if (head) head.rotateZ(Math.sin(this.ctx.time * 2.2) * 0.12);
  }

  step() {
    if (this.grooming) return 'Mom is grooming you. Hold still, sweetie.';
    if (this.done) return this.fed > 3 ? `Mom is well fed (${this.fed} snacks) and very proud of you.` : 'Mom is well fed and very proud of you.';
    return `Bring Mom snacks: ${this.fed}/3. Drop food near her at the den.`;
  }

  target() {
    return this.mom?.home ?? null;
  }

  save() {
    return { fed: this.fed, done: this.done };
  }

  load(d: any) {
    this.fed = Number(d?.fed) || 0;
    this.done = !!d?.done;
  }
}
