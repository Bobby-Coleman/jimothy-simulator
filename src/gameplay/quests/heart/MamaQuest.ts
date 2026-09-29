import * as THREE from 'three';
import type { Entity } from '../../../core/Entities';
import { G, groups } from '../../../core/Physics';
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
    // Height check like the drop test above: from the thrift-store roof right over the den (where following the
    // star in a straight line leads you) this used to say "Give Mom the snack", and the snack just landed on the roof.
    const sameLevel = Math.abs(player.position.y - mom.pos.y) < 2.5;
    if (held && held.tags.has('food') && dMom < 3.2 && sameLevel && !this.grooming) {
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
    // Final pass: the 3rd snack completes the "Mama's Boy" Instinct (toast, +2,000, combo shout, "Next up…") 0.7 s
    // before the grooming close-up — hold all of that until the moment is over (the cutscene keeps holding it).
    if (this.fed >= 3 && !this.done) ctx.hush(2);
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
    // Final pass (playtest: the close-up showed the back of Jimothy's head — in the doorway the den's lattice blocks
    // every side view): Jimothy steps back out onto the alley so Mom comes *out* of the den to groom him, and the
    // camera sits side-on and a little raised, so both faces are in the shot.
    const out = new THREE.Vector3(Math.sin(mom.homeYaw), 0, Math.cos(mom.homeYaw));
    const phys = ctx.game.physics;
    if (Math.hypot(player.position.x - mom.home.x, player.position.z - mom.home.z) < 3.3) {
      const spot = mom.home.clone().addScaledVector(out, 3.4);
      const from = mom.entrance().setY(mom.home.y + 0.4);
      const blocked = phys.raycast(from, out, 1.7, groups(G.ALL, G.WORLD));
      const ground = blocked ? null : phys.raycast(spot.clone().setY(mom.home.y + 2), new THREE.Vector3(0, -1, 0), 4, groups(G.ALL, G.WORLD));
      if (ground && Math.abs(ground.point.y - mom.home.y) < 0.8) player.teleport(spot.setY(ground.point.y + 0.45), mom.homeYaw + Math.PI);
    }
    mom.groomJimothy(5.2, () => this.finishGrooming());
    ctx.hint('Mom grooms Jimothy\'s face with her tiny paws. Scrub scrub scrub.', 5);
    const mid = new THREE.Vector3();
    const focus = () => mid.copy(player.position).lerp(mom.pos, 0.45).setY(Math.max(player.position.y, mom.pos.y + 0.4) + 0.12);
    // where Mom will stand (1.05 m in front of him, see Mom 'groom') — frame the shot for that, not her bed
    const toMom = new THREE.Vector3(mom.pos.x - player.position.x, 0, mom.pos.z - player.position.z).normalize();
    const momSpot = player.position.clone().addScaledVector(toMom, 1.05).setY(mom.pos.y + 0.6);
    const side = new THREE.Vector3(toMom.z, 0, -toMom.x);
    // side-on two-shot (both faces in profile, nose to nose), raised a bit
    const a0 = Math.atan2(side.x, side.z);
    ctx.cutscene({
      duration: 11,
      focus,
      camPos: ctx.orbit(focus, 2.5, 0.8, a0, 0.04, [player.position.clone().setY(player.position.y + 0.3), momSpot]),
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
