import * as THREE from 'three';
import { Kit, CongaLine } from '../../../entities/animals';
import type { HeartCtx, HeartQuest } from './ctx';
import type { MamaQuest } from './MamaQuest';

/**
 * Lost kits: five baby raccoons whimpering at POIs kit:1..5. Touch (or grab / chitter at) one and it follows
 * Jimothy in a conga line. Kits that get within 4 m of the den run to Mom and snuggle. If Jimothy flops or
 * rolls, the line scatters comically and regroups.
 *
 * Emits: 'kitFound' {count, name}, 'kitRescued' {count, name}, 'questComplete' {id:'kits'}.
 */
export class KitsQuest implements HeartQuest {
  readonly id = 'kits' as const;
  readonly title = 'Lost Kits';
  readonly objective = {
    ids: ['kitCollector', 'kit_collector'],
    def: { id: 'kit_collector', category: 'heart' as const, points: 3000, target: 5, title: 'Kit Collector', desc: 'Bring all 5 lost kits home to Mom. Count them twice.' },
  };
  done = false;
  readonly kits: Kit[] = [];
  line!: CongaLine;
  private ctx!: HeartCtx;
  private rescued = new Set<number>();
  private homeOrder: number[] = [];
  private foundCount = 0;
  private prevMode = 'walk';
  private scatterCd = 0;
  private hinted = { found: false, scatter: false, carry: false };

  constructor(private mama: MamaQuest) {}

  init(ctx: HeartCtx) {
    this.ctx = ctx;
    this.line = new CongaLine(ctx.game);
    const sp = ctx.spawnPoint();
    const mom = this.mama.mom;
    for (let i = 1; i <= 5; i++) {
      const { pos } = ctx.poi(`kit:${i}`, () => {
        const a = i * 1.37 + 0.5;
        const r = 14 + i * 5;
        return sp.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      });
      // babies don't belong in traffic: scoot onto the curb if the spot is in a car lane
      ctx.clearOfTraffic(pos);
      const kit = ctx.animals.add(new Kit(ctx.game, i, pos));
      kit.onFound = (k, how) => this.onFound(k, how);
      kit.onArrivedHome = (k) => this.onArrived(k);
      this.kits.push(kit);
    }
    // restore kits that were already brought home
    for (const idx of [...this.rescued]) {
      const k = this.kits.find((kk) => kk.index === idx);
      if (!k) continue;
      const slot = this.homeOrder.push(idx) - 1;
      const spot = mom.kitSpot(slot);
      k.settleHome(spot, Math.atan2(mom.home.x - spot.x, mom.home.z - spot.z), mom.home);
    }
    ctx.game.events.on('chitter', (p: any) => this.onChitter(p?.position));
    ctx.game.events.on('respawn', () => this.line.reset());
  }

  get following() {
    return this.line.members.length;
  }

  private onChitter(pos?: THREE.Vector3) {
    if (!pos) return;
    for (const k of this.kits) {
      if (k.isLost && Math.hypot(k.pos.x - pos.x, k.pos.z - pos.z) < 7) k.find('chitter');
      else if (k.state === 'follow' && Math.random() < 0.6) {
        // the line chirps back
        this.ctx.after(0.15 + Math.random() * 0.4, () => {
          k.say('note', 1);
          this.ctx.game.sfx('kit_chirp', k.pos, 0.5, 1.2 + Math.random() * 0.2);
        });
      }
    }
  }

  private onFound(k: Kit, how: string) {
    const ctx = this.ctx;
    this.line.add(k);
    this.foundCount++;
    ctx.game.events.emit('kitFound', { count: this.foundCount, name: k.kitName, index: k.index, how });
    ctx.game.score(100, `Found ${k.kitName}`, k.pos.clone());
    if (!this.hinted.found) {
      this.hinted.found = true;
      ctx.hint(`A lost kit! ${k.kitName} follows you now. Lead the kits home to Mom at the den.`, 4.5);
    } else ctx.hint(`${k.kitName} joins the conga line! (${this.following} following)`, 2.5);
    ctx.onProgress('kits', this.step());
  }

  private sendHome(k: Kit) {
    if (k.state === 'toMom' || k.state === 'home') return;
    const mom = this.mama.mom;
    let slot = this.homeOrder.indexOf(k.index);
    if (slot < 0) slot = this.homeOrder.push(k.index) - 1;
    const spot = mom.kitSpot(slot);
    k.goHome(spot, Math.atan2(mom.home.x - spot.x, mom.home.z - spot.z), mom.home, mom.entrance());
    k.say('heart', 1.5);
    this.ctx.game.sfx('kit_chirp', k.pos, 0.8, 1.1);
  }

  private onArrived(k: Kit) {
    const ctx = this.ctx;
    if (this.rescued.has(k.index)) return;
    this.rescued.add(k.index);
    const mom = this.mama.mom;
    mom.welcome(k.pos);
    ctx.hearts(k.pos.clone().setY(k.pos.y + 0.4), 7);
    const count = this.rescued.size;
    ctx.game.events.emit('kitRescued', { count, name: k.kitName, index: k.index });
    ctx.game.score(250, `${k.kitName} Is Home`, k.pos.clone());
    ctx.onProgress('kits', this.step());
    ctx.onSave();
    if (count >= 5 && !this.done) this.complete();
    else ctx.hint(`${k.kitName} snuggles up to Mom. ${count}/5 kits home!`, 3);
  }

  private complete() {
    const ctx = this.ctx;
    this.done = true;
    const mom = this.mama.mom;
    const top = mom.home.clone().setY(mom.home.y + 0.9);
    ctx.hearts(top, 16);
    ctx.confetti(top, 1.4);
    for (let i = 1; i <= 4; i++) ctx.after(i * 0.6, () => ctx.hearts(top, 6));
    ctx.game.sfx('happy', mom.pos, 1, 1.0);
    ctx.onComplete('kits');
    ctx.hint('All five kits are home! Mom counts them twice. Everyone is accounted for.', 5);
    // a little family portrait moment, looking in through the den entrance (unless something else has the camera)
    if (!ctx.inCutscene && !this.mama.grooming) {
      const fwd = new THREE.Vector3(Math.sin(mom.homeYaw), 0, Math.cos(mom.homeYaw));
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const focus = () => mom.home.clone().setY(mom.home.y + 0.3);
      const base = mom.home.clone().addScaledVector(fwd, 2.8).setY(mom.home.y + 1.15);
      const cam = new THREE.Vector3();
      ctx.cutscene({ duration: 4.5, focus, camPos: (t) => cam.copy(base).addScaledVector(side, Math.sin(t * 0.5) * 0.5), fov: 55 });
    }
  }

  update(dt: number) {
    const ctx = this.ctx;
    const player = ctx.player;
    if (!player) return;
    this.line.update();

    // Flop / roll → the line scatters (then regroups by itself)
    this.scatterCd -= dt;
    const mode = player.mode as string;
    if ((mode === 'ragdoll' || mode === 'roll') && mode !== this.prevMode && this.following > 0 && this.scatterCd <= 0) {
      this.scatterCd = 2.5;
      this.line.scatter(player.position);
      if (!this.hinted.scatter) {
        this.hinted.scatter = true;
        ctx.hint("The kits scattered! Don't worry, they'll regroup.", 3);
      }
    }
    this.prevMode = mode;

    // Kits reaching the den run to Mom
    const den = this.mama.mom.home;
    for (const k of [...this.line.members]) {
      if (Math.hypot(k.pos.x - den.x, k.pos.z - den.z) < 4 && !k.entity.data.heldByPlayer) this.sendHome(k);
    }
    const held = player.held?.entity;
    const hk = held?.data?.animal;
    if (hk instanceof Kit && Math.hypot(player.position.x - den.x, player.position.z - den.z) < 4) this.sendHome(hk);
    if (hk instanceof Kit && !this.hinted.carry) {
      this.hinted.carry = true;
      ctx.hint(`Jimothy carries ${hk.kitName} like a precious snack. Bring them home!`, 3);
    }
  }

  step() {
    if (this.done) return 'All 5 kits are home safe with Mom.';
    const home = this.rescued.size;
    const f = this.following;
    return `Find the lost kits and lead them home: ${home}/5 home${f ? `, ${f} following you` : ''}. Listen for tiny squeaks!`;
  }

  target(): THREE.Vector3 | null {
    if (this.done) return null;
    if (this.following > 0) return this.mama.mom.home;
    const p = this.ctx.player?.position as THREE.Vector3 | undefined;
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const k of this.kits) {
      if (!k.isLost) continue;
      const d = p ? k.pos.distanceToSquared(p) : 0;
      if (d < bd) {
        bd = d;
        best = k.pos;
      }
    }
    return best;
  }

  save() {
    return { rescued: [...this.rescued], done: this.done };
  }

  load(d: any) {
    this.rescued = new Set<number>((Array.isArray(d?.rescued) ? d.rescued : []).map(Number).filter((n: number) => n >= 1 && n <= 5));
    this.done = !!d?.done || this.rescued.size >= 5;
  }
}
