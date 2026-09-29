import * as THREE from 'three';
import type { Entity } from '../../../core/Entities';
import { G, groups } from '../../../core/Physics';
import { destroyProp } from '../../../entities/Props';
import { Emote } from '../../../entities/animals';
import type { HeartCtx, HeartQuest } from './ctx';
import { buildBowl, buildKnittedHat, buildRockingChair, mergeVertexColored, spawnFallbackGrapes, type RockingChair } from './props';
import { buildGrandma, buildKnitting, type Figure } from './humans';

/**
 * Grandma's Favorite: Grandma Rosie rocks and knits on her porch. At night she leaves out a bowl of grapes,
 * and if Jimothy visits her at night she gives him the knitted hat she made (unlocks + equips the
 * 'grandmaHat' mutator). During the day: "Come back tonight, dear. Raccoons are nocturnal!"
 *
 * Emits: 'grandmaVisit', 'questComplete' {id:'grandma'}.
 */

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const WORLD_ONLY = groups(G.ALL, G.WORLD);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();

export class GrandmaQuest implements HeartQuest {
  readonly id = 'grandma' as const;
  readonly title = "Grandma's Favorite";
  readonly objective = {
    ids: ['grandmasFavorite', 'grandmas_favorite'],
    def: {
      id: 'grandmas_favorite',
      category: 'heart' as const,
      points: 2500,
      title: "Grandma's Favorite",
      desc: "Visit Grandma Rosie at night. She's been knitting something.",
      reward: 'grandmaHat',
    },
  };
  done = false;
  private ctx!: HeartCtx;
  readonly porch = new THREE.Vector3();
  yaw = 0;
  chair!: RockingChair;
  npc: any = null;
  fig: Figure | null = null;
  private emote: Emote | null = null;
  private bowl!: THREE.Group;
  private bowlPos = new THREE.Vector3();
  private grapes: Entity | null = null;
  private wasNight: boolean | null = null;
  private near = false;
  private lineCd = 0;
  private rockT = Math.random() * 5;
  private rock = 0;
  private visiting = false;
  private hatFlight: { obj: THREE.Object3D; t: number; from: THREE.Vector3 } | null = null;
  private fallbackHat: THREE.Object3D | null = null;
  private waveT = 0;

  init(ctx: HeartCtx) {
    this.ctx = ctx;
    const sp = ctx.spawnPoint();
    const { pos } = ctx.poi('grandmaPorch', () => sp.clone().add(new THREE.Vector3(26, 0, -22)));
    this.porch.copy(pos);
    this.yaw = this.faceOpen(pos, sp);
    // rocking chair (visual only; she sits in it)
    this.chair = buildRockingChair(0.42);
    this.chair.root.position.copy(pos);
    this.chair.root.rotation.y = this.yaw;
    ctx.game.scene.add(this.chair.root);
    const knit = mergeVertexColored(buildKnitting(), { roughness: 0.9 });
    knit.position.set(0, 0.1, 0.2);
    this.chair.seat.add(knit);
    // a bowl for the night-time grapes, beside the chair
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(-0.75);
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.35);
    this.bowlPos.copy(pos).add(side).add(fwd);
    this.bowlPos.y = ctx.ground(this.bowlPos.x, this.bowlPos.z, pos.y + 1.2);
    this.bowl = new THREE.Group();
    this.bowl.add(mergeVertexColored(buildBowl(), { roughness: 0.35, side: THREE.DoubleSide }));
    this.bowl.position.copy(this.bowlPos);
    ctx.game.scene.add(this.bowl);
    // A warm porch light so her porch glows at night (the only light we add; on only at night, nearby).
    this.lamp = new THREE.PointLight(0xffc27a, 0, 7.5, 1.6);
    this.lamp.castShadow = false;
    const up = new THREE.Vector3(0, 2.1, 0);
    this.lamp.position.copy(pos).add(up).addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 1.1);
    this.lamp.visible = false;
    ctx.game.scene.add(this.lamp);
  }

  private lamp!: THREE.PointLight;

  /** Face away from the nearest wall (the house) — porches look out at the street. */
  private faceOpen(p: THREE.Vector3, fallbackTarget: THREE.Vector3): number {
    let best = Infinity;
    let bestA = 0;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const dir = _v.set(Math.sin(a), 0, Math.cos(a));
      const hit = this.ctx.game.physics.raycast(new THREE.Vector3(p.x, p.y + 0.9, p.z), dir, 6, WORLD_ONLY);
      if (hit && hit.distance < best) {
        best = hit.distance;
        bestA = a;
      }
    }
    if (best < 6) return bestA + Math.PI;
    return Math.atan2(fallbackTarget.x - p.x, fallbackTarget.z - p.z);
  }

  setup(ctx: HeartCtx) {
    this.spawnGrandma(ctx);
  }

  private spawnGrandma(ctx: HeartCtx) {
    const npc = ctx.spawnNpc({
      type: 'grandma',
      position: this.porch.clone(),
      name: 'Grandma Rosie',
      stationary: true,
      lookAtPlayer: true,
      passive: true,
      holding: null,
      facing: this.yaw,
    });
    if (npc) {
      this.npc = npc;
      const seat = this.porch.clone();
      const yaw = this.yaw;
      // sit still in the chair: pin her in place, the pose itself is applied in lateUpdate()
      npc.setCustom?.((n: any) => {
        n.sep?.set?.(0, 0, 0);
        n.velocity?.set?.(0, 0, 0);
        n.position.x = seat.x;
        n.position.z = seat.z;
        n.yaw = yaw;
      });
      npc.onInteract = (kind: string) => this.onInteract(kind);
      try {
        npc.setExpression?.('happy');
      } catch {
        /* optional */
      }
    } else if (!this.fig) {
      // stand-in figure sitting in the chair
      const fig = buildGrandma();
      fig.sitting = true;
      fig.root.position.set(0, 0, -0.04);
      this.chair.rocker.add(fig.root);
      this.fig = fig;
      fig.setExpression('happy');
      this.emote = new Emote(fig.root, 1.45, 0.36);
    }
  }

  private onInteract(kind: string): boolean | void {
    const ctx = this.ctx;
    if (kind === 'chitter') {
      ctx.speak({ npc: this.npc }, ctx.isNight ? 'Oh, listen to you! Precious.' : 'Hello, sweet pea! Shouldn\'t you be asleep?', 2.6);
      return true;
    }
    if (kind === 'grab') {
      ctx.speak({ npc: this.npc }, 'Gentle, dear! These are my good slippers.', 2.4);
      return true;
    }
    if (kind === 'wash') {
      ctx.speak({ npc: this.npc }, 'Oh my! Thank you, dear.', 2);
      return; // default face-wash reaction is fine
    }
  }

  private say(text: string, secs = 3) {
    this.ctx.speak({ npc: this.npc, object: this.fig?.root, emote: this.emote ?? undefined, offsetY: 1.45 }, text, secs);
  }

  private seatWorld(out: THREE.Vector3) {
    this.chair.root.updateMatrixWorld(true);
    return this.chair.seat.getWorldPosition(out);
  }

  update(dt: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    const night = ctx.isNight;
    this.lineCd -= dt;
    this.waveT = Math.max(0, this.waveT - dt);
    // someone cleared the NPCs? Grandma comes right back to her chair.
    if (this.npc?.removed) {
      this.npc = null;
      this.spawnGrandma(ctx);
    }

    // porch light: fades in at night while Jimothy is in the neighbourhood
    const nf = ctx.env?.nightFactor ?? (night ? 1 : 0);
    const lampOn = nf > 0.2 && ctx.distToPlayer(this.porch) < 45;
    const want = lampOn ? 9 * Math.min(1, nf * 1.3) : 0;
    this.lamp.intensity += (want - this.lamp.intensity) * Math.min(1, dt * 2);
    this.lamp.visible = this.lamp.intensity > 0.05;
    // rocking
    this.rockT += dt * (this.visiting ? 0.8 : 1.5);
    this.rock = Math.sin(this.rockT) * 0.11;
    this.chair.rocker.rotation.x = this.rock;

    // grapes at night, taken back in during the day
    if (this.wasNight !== night) {
      this.wasNight = night;
      if (night) this.putOutGrapes();
      else this.takeInGrapes();
    }

    // visits
    const d = ctx.distToPlayer(this.porch);
    if (player && d < 3.2 && !this.near && !this.visiting) {
      this.near = true;
      this.onApproach(night);
    }
    if (d > 7) this.near = false;

    // the hat flying from her lap onto Jimothy's head
    const hf = this.hatFlight;
    if (hf && player) {
      hf.t += dt / 1.0;
      const k = Math.min(1, hf.t);
      const to = this.headTop(_v);
      const p = hf.from.clone().lerp(to, k);
      p.y += Math.sin(k * Math.PI) * 1.0;
      hf.obj.position.copy(p);
      hf.obj.rotation.set(0, k * Math.PI * 4, Math.sin(k * Math.PI) * 0.6);
      if (k >= 1) {
        hf.obj.removeFromParent();
        this.hatFlight = null;
        this.hatOn();
      }
    }
    this.fig?.animate(dt, ctx.time, { knit: this.visiting ? 0 : 1, wave: this.waveT > 0 ? 1 : 0, lookYaw: player ? this.lookYawTo(player.position) : 0 });
  }

  private lookYawTo(p: THREE.Vector3) {
    const a = Math.atan2(p.x - this.porch.x, p.z - this.porch.z) - this.yaw;
    return Math.atan2(Math.sin(a), Math.cos(a));
  }

  private onApproach(night: boolean) {
    const ctx = this.ctx;
    if (!night) {
      if (this.lineCd <= 0) {
        this.lineCd = 8;
        this.waveT = 2;
        this.say('Come back tonight, dear. Raccoons are nocturnal!', 3.5);
        if (!this.done) ctx.onProgress('grandma', this.step());
      }
      return;
    }
    if (!this.done) {
      this.visit();
      return;
    }
    if (this.lineCd <= 0) {
      this.lineCd = 10;
      this.waveT = 2;
      this.say(this.grapes?.alive ? "There's my sweet pea! Help yourself to the grapes, dear." : "There's my sweet pea! Staying out of trouble?", 3.5);
    }
  }

  private visit() {
    const ctx = this.ctx;
    const player = ctx.player;
    this.visiting = true;
    this.waveT = 1.5;
    ctx.game.sfx('happy', this.porch, 0.4, 1.3);
    const head = new THREE.Vector3();
    const focus = () => head.copy(this.porch).lerp(player.position, 0.35).setY(Math.max(this.porch.y + 1.0, player.position.y + 0.4));
    // Her chair faces the street (away from the house): look in from out front, over the railing and under the
    // porch roof, from whichever angle isn't blocked by a column.
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const sgn = side.dot(new THREE.Vector3(player.position.x - this.porch.x, 0, player.position.z - this.porch.z)) >= 0 ? -1 : 1;
    const f0 = focus().clone();
    const a = ctx.clearAngle(f0, 4.2, 0.65, Math.atan2(fwd.x, fwd.z) + sgn * 0.45, 0, [
      this.porch.clone().setY(this.porch.y + 1.15),
      player.position.clone().setY(player.position.y + 0.3),
    ]);
    const base = new THREE.Vector3(f0.x + Math.sin(a) * 4.2, f0.y + 0.65, f0.z + Math.cos(a) * 4.2);
    const cam = new THREE.Vector3();
    // the camera stays on the porch through the dialog and the hat toss; hatOn() ends the scene
    ctx.cutscene({
      duration: 60,
      focus,
      camPos: (t) => cam.copy(base).addScaledVector(side, -sgn * Math.min(t, 12) * 0.03),
      fov: 52,
      onEnd: () => {
        if (!this.done && this.visiting) {
          // cut short (shouldn't happen): finish the gift without the flourish
          this.hatFlight?.obj.removeFromParent();
          this.hatFlight = null;
          this.hatOn(false);
        }
      },
    });
    ctx.after(0.9, () => {
      ctx.dialog(
        'Grandma Rosie',
        ["Oh! It's you, sweet pea. I made you something.", 'A little hat, for that perfectly round head of yours. Hold still now...'],
        () => this.throwHat(),
        { portrait: '👵', color: '#b05a7a' },
      );
    });
  }

  private throwHat() {
    const ctx = this.ctx;
    const hat = buildKnittedHat();
    const from = this.seatWorld(new THREE.Vector3()).add(new THREE.Vector3(0, 0.25, 0));
    hat.position.copy(from);
    ctx.game.scene.add(hat);
    this.hatFlight = { obj: hat, t: 0, from };
    ctx.game.sfx('whoosh', from, 0.4, 1.3);
  }

  private headTop(out: THREE.Vector3) {
    const player = this.ctx.player;
    const head = player?.model?.headPivot as THREE.Object3D | undefined;
    if (head) {
      head.updateMatrixWorld(true);
      return head.localToWorld(out.set(0, 0.22, 0));
    }
    return out.copy(player.position).setY(player.position.y + 0.7);
  }

  private hatOn(endScene = true) {
    const ctx = this.ctx;
    const game = ctx.game;
    const player = ctx.player;
    if (this.done) return;
    this.visiting = false;
    this.done = true;
    // linger a moment on the new hat, then hand the camera back
    if (endScene) ctx.after(1.6, () => ctx.endCutscene());
    game.events.emit('grandmaVisit', {});
    const mut = game.get<any>('mutators');
    let equipped = false;
    try {
      if (mut?.get?.('grandmaHat')) {
        mut.unlock('grandmaHat');
        mut.setEnabled('grandmaHat', true);
        equipped = !!mut.get('grandmaHat')?.enabled;
      }
    } catch (err) {
      console.warn('[heart] grandmaHat mutator failed', err);
    }
    if (!equipped) this.attachFallbackHat();
    ctx.onComplete('grandma');
    if (player) {
      const top = player.position.clone().setY(player.position.y + 0.8);
      ctx.hearts(top, 12);
      ctx.sparkle(top, { radius: 0.5 });
    }
    game.sfx('purr', this.porch, 0.5, 1.2);
    this.say('There! Perfect. Now you run along, and mind the cars.', 3.5);
    ctx.hint("Grandma's Favorite! She knitted you a hat. (Toggle it in the pause menu: Mutators)", 4.5);
  }

  /** If the mutator isn't available, just stick a knitted hat on his head ourselves. */
  private attachFallbackHat() {
    const head = this.ctx.player?.model?.headPivot as THREE.Object3D | undefined;
    if (!head || this.fallbackHat) return;
    const hat = buildKnittedHat();
    hat.position.set(0, 0.2, -0.02);
    hat.rotation.x = -0.12;
    head.add(hat);
    this.fallbackHat = hat;
  }

  private putOutGrapes() {
    const ctx = this.ctx;
    if (this.grapes?.alive) return;
    const at = this.bowlPos.clone().setY(this.bowlPos.y + 0.03);
    this.grapes = ctx.spawnItem('grapes', at, () => spawnFallbackGrapes(ctx.game, at));
    this.grapes.data.fromGrandma = true;
  }

  private takeInGrapes() {
    const g = this.grapes;
    if (!g?.alive || g.data.heldByPlayer || !g.body) return;
    const t = g.body.translation();
    if (Math.hypot(t.x - this.bowlPos.x, t.z - this.bowlPos.z) < 1.2) destroyProp(this.ctx.game, g);
    this.grapes = null;
  }

  /** Seat the NPC grandma (bones) + rock with the chair. Runs after the NPC animator. */
  lateUpdate() {
    const npc = this.npc;
    if (!npc || npc.removed || npc.ragdolled) return;
    const rig = npc.rig;
    const B = rig?.bones;
    if (!B || !rig.bindLocal || !rig.dims) return;
    const root = rig.root as THREE.Object3D;
    // rock with the chair (both pivot on the ground under the seat)
    _q.setFromAxisAngle(UP, this.yaw);
    _q2.setFromAxisAngle(X, this.rock);
    root.quaternion.copy(_q).multiply(_q2);
    const d = rig.dims;
    const sx = (bone: THREE.Bone, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ') => {
      _e.set(x, y, z, order);
      bone.quaternion.setFromEuler(_e);
    };
    const seatTop = 0.47; // cushion top above the porch floor
    B.pelvis.position.set(rig.bindLocal.pelvis.x, seatTop + d.pelvisH * 0.42, rig.bindLocal.pelvis.z - 0.06);
    _e.setFromQuaternion(B.pelvis.quaternion, 'YXZ');
    sx(B.pelvis, 0, _e.y, 0, 'YXZ');
    sx(B.thighL, -1.32, 0, 0.1);
    sx(B.thighR, -1.32, 0, -0.1);
    sx(B.shinL, 1.42, 0, 0);
    sx(B.shinR, 1.42, 0, 0);
    // knitting (unless she's waving / handing over the hat)
    if (!this.visiting && this.waveT <= 0) {
      const t = this.ctx.time;
      sx(B.uArmL, -0.45, 0, -0.35);
      sx(B.uArmR, -0.45, 0, 0.35);
      sx(B.lArmL, -1.25 - Math.sin(t * 7) * 0.12, 0, 0);
      sx(B.lArmR, -1.25 + Math.sin(t * 7) * 0.12, 0, 0);
    }
  }

  step() {
    if (this.done) return 'Grandma Rosie knitted you a hat. Visit at night for grapes!';
    return this.ctx.isNight ? "Visit Grandma Rosie on her porch. She's up late knitting!" : 'Visit Grandma Rosie at night (raccoons are nocturnal).';
  }

  target() {
    return this.porch;
  }

  save() {
    return { done: this.done };
  }

  load(d: any) {
    this.done = !!d?.done;
  }
}
