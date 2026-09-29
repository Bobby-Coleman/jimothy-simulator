import * as THREE from 'three';
import { Danny } from '../../../entities/animals';
import type { HeartCtx, HeartQuest } from './ctx';
import type { MamaQuest } from './MamaQuest';

/**
 * Family Reunion: Danny rolls around lazily on his lawn. Chitter at him and he chitters back, then invites
 * Jimothy to roll together — roll within 3 m of him for 5 s. Afterwards he sometimes visits the den.
 *
 * Emits: 'dannyReunion', 'questComplete' {id:'danny'}, 'dannyVisit' {atDen}.
 */
export class DannyQuest implements HeartQuest {
  readonly id = 'danny' as const;
  readonly title = 'Family Reunion';
  readonly objective = {
    ids: ['familyReunion', 'family_reunion'],
    def: { id: 'family_reunion', category: 'heart' as const, points: 3000, title: 'Family Reunion', desc: 'Roll together with Danny, the other round raccoon. The resemblance is uncanny.' },
  };
  done = false;
  danny!: Danny;
  private ctx!: HeartCtx;
  private together = 0;
  private inviteT = 0;
  private shown = -1;
  private playing = false;
  private atDen = false;
  private visitT = 45;
  private hinted = false;
  private nearHint = false;

  constructor(private mama: MamaQuest) {}

  init(ctx: HeartCtx) {
    this.ctx = ctx;
    const sp = ctx.spawnPoint();
    const lawn = ctx.poi('dannyLawn', () => sp.clone().add(new THREE.Vector3(-26, 0, -22)));
    this.danny = ctx.animals.add(new Danny(ctx.game, lawn.pos, Math.random() * Math.PI * 2));
    ctx.game.events.on('chitter', (p: any) => this.onChitter(p?.position));
  }

  private onChitter(pos?: THREE.Vector3) {
    if (!pos || this.playing) return;
    const d = this.danny;
    if (Math.hypot(pos.x - d.pos.x, pos.z - d.pos.z) > 9) return;
    if (!d.hearChitter()) return;
    const ctx = this.ctx;
    ctx.game.events.emit('dannyChitter', {});
    this.inviteT = 0;
    this.together = 0;
    this.shown = -1;
    if (!this.done) {
      if (!this.hinted) {
        this.hinted = true;
        ctx.hint('Danny chitters back! He wants to roll with you. Tuck & Roll (Q) right next to him!', 5);
      }
      ctx.onProgress('danny', 'Danny wants to roll! Tuck & Roll (Q) next to him.');
    } else {
      ctx.after(0.6, () => ctx.hearts(d.pos.clone().setY(d.pos.y + 1), 4));
    }
  }

  update(dt: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    const danny = this.danny;
    if (!player || !danny) return;

    // nudge the player the first time they're close
    if (!this.done && !this.nearHint && ctx.distToPlayer(danny.pos) < 7) {
      this.nearHint = true;
      ctx.hint("It's Danny, the other round raccoon! He looks... familiar. Try chittering at him (C).", 4.5);
    }

    if (danny.inviting && !this.playing) {
      this.inviteT += dt;
      const d = ctx.distToPlayer(danny.pos);
      if (player.mode === 'roll' && d < 3) {
        this.together += dt;
        const s = Math.floor(this.together);
        if (s !== this.shown) {
          this.shown = s;
          if (s > 0 && s < 5) {
            if (!this.done) ctx.onProgress('danny', this.step());
            const mid = player.position.clone().lerp(danny.pos, 0.5).setY(player.position.y + 0.6);
            ctx.hearts(mid, 2 + s);
            ctx.game.sfx('boing', mid, 0.3, 1 + s * 0.12);
          }
        }
        if (this.together >= 5) {
          if (!this.done) this.reunion();
          else {
            // rolling together again: a small happy moment, no cutscene
            danny.giveUp();
            danny.say('heart', 2);
            ctx.hearts(danny.pos.clone().setY(danny.pos.y + 1), 8);
            ctx.game.score(150, 'Rolled With Danny Again', danny.pos.clone());
            this.together = 0;
          }
        }
      }
      if (this.inviteT > 45 && this.together < 5) {
        danny.giveUp();
        this.together = 0;
        if (!this.done) {
          ctx.hint('Danny got dizzy waiting. Chitter at him again!', 3);
          ctx.onProgress('danny', this.step());
        }
      }
    }

    if (this.done && !this.playing) this.updateVisits(dt);
  }

  private reunion() {
    const ctx = this.ctx;
    const player = ctx.player;
    const danny = this.danny;
    this.playing = true;
    if ((player.mode === 'roll' || player.mode === 'ragdoll') && typeof player.setMode === 'function') player.setMode('walk');
    danny.reunion();
    this.done = true;
    ctx.game.events.emit('dannyReunion', {});
    ctx.onComplete('danny');
    const mid = player.position.clone().lerp(danny.pos, 0.5).setY(player.position.y + 0.8);
    ctx.hearts(mid, 16);
    ctx.confetti(mid, 1.2);
    ctx.game.score(300, 'Rolled With Danny', mid);
    const focus = () => new THREE.Vector3().copy(player.position).lerp(danny.pos, 0.5).setY(Math.max(player.position.y, danny.pos.y + 0.45) + 0.1);
    const dx = danny.pos.x - player.position.x;
    const dz = danny.pos.z - player.position.z;
    // the camera stays on the two round boys through the little chat; its end hands control back
    ctx.cutscene({
      duration: 60,
      focus,
      camPos: ctx.orbit(focus, 3.1, 0.7, Math.atan2(dz, -dx), 0.1),
      fov: 50,
      onEnd: () => {
        this.playing = false;
        this.visitT = 40;
      },
    });
    ctx.after(2.4, () => {
      ctx.dialog(
        'Danny',
        [
          'Chrrr-chrrr! *happy chitter*',
          '(He rolls exactly like you do. Same wobble. Same little tail flip at the end.)',
          '(Neither of you knows for sure. Neither of you minds one bit.)',
        ],
        () => {
          ctx.endCutscene();
          ctx.hint('Danny might drop by the den to visit sometimes.', 3);
        },
        { portrait: '🦝', color: '#8b8680' },
      );
    });
  }

  /** Jimothy faces Danny during the reunion close-up. */
  postPhysics() {
    if (!this.playing || !this.ctx.inCutscene) return;
    const player = this.ctx.player;
    if (!player) return;
    player.facing = Math.atan2(this.danny.pos.x - player.position.x, this.danny.pos.z - player.position.z);
  }

  /** On the doorstep beside the den entrance (the den itself is full of kits). */
  private denSpot() {
    const mom = this.mama.mom;
    const e = mom.entrance();
    const side = new THREE.Vector3(Math.cos(mom.homeYaw), 0, -Math.sin(mom.homeYaw));
    return e.addScaledVector(side, 1.35);
  }

  private updateVisits(dt: number) {
    this.visitT -= dt;
    if (this.visitT > 0) return;
    const ctx = this.ctx;
    const danny = this.danny;
    const den = this.denSpot();
    const dest = this.atDen ? danny.lawn : den;
    // only pop between places while nobody's watching
    if (ctx.distToPlayer(danny.pos) > 35 && ctx.distToPlayer(dest) > 35) {
      this.atDen = !this.atDen;
      const mom = this.mama.mom;
      if (this.atDen) danny.relocate(den, 1.0, Math.atan2(mom.home.x - den.x, mom.home.z - den.z));
      else danny.relocate(danny.lawn, 5, Math.random() * Math.PI * 2);
      this.visitT = this.atDen ? 70 + Math.random() * 60 : 80 + Math.random() * 90;
      ctx.game.events.emit('dannyVisit', { atDen: this.atDen });
      ctx.onProgress('danny', this.step());
    } else this.visitT = 6;
  }

  step() {
    if (this.done) return this.atDen ? 'Danny is visiting the den. Family time!' : 'Danny is back on his lawn. He visits the den sometimes.';
    if (this.danny?.inviting) return `Roll with Danny! Tuck & Roll (Q) next to him: ${Math.min(5, Math.floor(this.together))}/5 s`;
    return 'Find Danny, the other round raccoon, on his lawn in the Hills. Chitter at him (C).';
  }

  target() {
    return this.danny?.pos ?? null;
  }

  save() {
    return { done: this.done };
  }

  load(d: any) {
    this.done = !!d?.done;
  }
}
