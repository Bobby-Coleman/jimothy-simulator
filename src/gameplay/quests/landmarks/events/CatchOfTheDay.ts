import * as THREE from 'three';
import type { Entity } from '../../../../core/Entities';
import { RAPIER } from '../../../../core/Physics';
import { destroyProp, spawnProp } from '../../../../entities/Props';
import { Landmark } from '../Landmark';
import type { Actor } from '../kit/Actors';
import { buildFishStall, fishObject, landingRing, local } from '../kit/Props';

const GRAVITY = 14;
const THROW_EVERY = 8;
const RANGE = 12;

interface Flying {
  e: Entity;
  t0: number;
  T: number;
  marker: THREE.Mesh | null;
  catching: boolean;
}
interface Flopper {
  e: Entity;
  until: number;
  next: number;
}
interface Returning {
  e: Entity;
  until: number;
}

const YELLS = ['FISH INCOMING!', 'HEADS UP, LITTLE GUY!', 'ONE KING SALMON, FLYIIING!', 'CATCH OF THE DAY!'];
const MISSES = ['Butterfingers!', 'Soft hands, buddy, soft hands!', 'It\'s okay, the fish forgives you.', 'Close one!'];
const CATCHES = ['NICE HANDS!', 'HE CAUGHT IT! Somebody hire this raccoon!', 'Look at that form!', 'THAT’S A KEEPER!'];

/**
 * Catch of the Day @ Pike's Plaice Market (POIs `fishMarket`, `fishCatch`).
 * While Jimothy is within 12 m the fishmonger lobs a fish at him every ~8 s (a ring marks where it will land).
 * A fish passing within ~1 m of his paws while they're empty is caught ("CAUGHT IT!"). Missed fish flop around.
 * Throwing a fish back at the fishmonger: he catches it deftly… or gets bonked.
 */
export class CatchOfTheDay extends Landmark {
  readonly id = 'catch';
  readonly title = 'Catch of the Day';
  private market = new THREE.Vector3(0, 0, 120);
  private catchSpot = new THREE.Vector3(0, 0, 126);
  private facing = 0;
  private monger: Actor | null = null;
  private throwT = 2;
  private windup = -1;
  private flying: Flying[] = [];
  private floppers: Flopper[] = [];
  private returning: Returning[] = [];
  private mine: Entity[] = [];
  private returns = 0;
  private missLineT = 0;

  setup() {
    const k = this.kit;
    const market = k.poi('fishMarket');
    const spot = k.poi('fishCatch');
    if (market) {
      this.market.copy(k.onGround(market, 1.5, 6));
      this.catchSpot.copy(spot ? k.onGround(spot, 1.5, 6) : local(this.market, Math.atan2(-market.x, 120 - market.z), 0, 0, 5));
      this.facing = Math.atan2(this.catchSpot.x - this.market.x, this.catchSpot.z - this.market.z);
    } else {
      const s = k.findClearSpot(6, 116, 6);
      k.reserve(s, 7);
      this.facing = Math.PI; // customers on the north side (toward town)
      const built = buildFishStall(k.world, s, this.facing);
      this.market.copy(k.onGround(built.monger, 1.5, 4));
      this.catchSpot.copy(k.onGround(built.catchSpot, 1.5, 4));
      k.world.poi.set('fishMarket', this.market.clone());
      k.world.poi.set('fishCatch', this.catchSpot.clone());
    }
    this.game.events.on('release', (p: { entity?: Entity; thrown?: boolean }) => {
      const e = p?.entity;
      if (!e || !p.thrown || !(e.tags.has('fish') || this.mine.includes(e))) return;
      if (!this.monger?.alive || this.flatDist(this.market) > 30) return;
      this.returning.push({ e, until: this.game.time + 3 });
    });
  }

  anchor() {
    return this.market;
  }

  hint() {
    const n = Number(this.saved.caught ?? 0);
    if (this.done) return `Fish caught: ${n}. The fishmonger respects you.`;
    return "Stand near the fishmonger at Pike's Plaice Market (south waterfront) with empty paws and catch a flying fish.";
  }

  debugSpot() {
    return { pos: this.catchSpot.clone().add(new THREE.Vector3(0, 1.2, 0)), facing: Math.atan2(this.market.x - this.catchSpot.x, this.market.z - this.catchSpot.z) };
  }

  update(dt: number) {
    this.stateTime += dt;
    const d = this.monger?.alive ? this.flatDist(this.monger.position) : this.flatDist(this.market);
    if (this.flatDist(this.market) < 75 && (!this.monger || !this.monger.alive)) {
      this.monger = this.kit.spawnActor({
        type: 'fishmonger',
        name: 'Fishmonger Finn',
        position: this.market,
        facing: this.facing,
        outfit: { apron: 0xf07a24, shirt: 0x8a9ba8, pants: 0xf07a24, shoes: 0x1e1e1e, hat: 'cap', hatColor: 0x1d3557 },
      });
    } else if (this.flatDist(this.market) > 110 && this.monger && !this.flying.length) {
      this.kit.removeActor(this.monger);
      this.monger = null;
    }
    const m = this.monger;
    switch (this.state) {
      case 'idle':
        if (m && !m.down && d < RANGE) {
          this.go('armed');
          this.throwT = 1.6;
          m.say(this.done ? 'The fish catcher returns!' : 'Hey! You! Round fella! Hands up, I got a fish for ya!', 3);
        }
        break;
      case 'armed':
        if (!m || !m.alive || d > RANGE + 4) {
          if (m?.alive && !m.down) m.say('Come back! The fish miss you!', 2.5);
          this.windup = -1;
          this.go('idle');
          break;
        }
        if (m.down) break;
        if (this.windup >= 0) {
          this.windup -= dt;
          if (this.windup < 0) this.launch();
        } else {
          this.throwT -= dt;
          if (this.throwT <= 0) {
            this.throwT = THROW_EVERY;
            this.windup = 0.6;
            const p = this.player;
            if (p) m.face(p.position);
            m.say(YELLS[Math.floor(Math.random() * YELLS.length)], 1.8, true);
            m.throwAnim();
          }
        }
        break;
    }
    this.updateFloppers();
  }

  // ------------------------------------------------------------------ throwing
  private launch() {
    const m = this.monger;
    const p = this.player;
    if (!m || !m.alive || !p) return;
    const k = this.kit;
    const head = m.headPos(new THREE.Vector3());
    const hp = k.handPoint(new THREE.Vector3());
    const dist = Math.hypot(hp.x - head.x, hp.z - head.z);
    const T = THREE.MathUtils.clamp(0.8 + dist * 0.07, 1.0, 1.7);
    // Lead the target a bit, then offset it so Jimothy has to move to make the catch.
    const target = hp.clone().addScaledVector(p.velocity.clone().setY(0), T * 0.5);
    const off = 0.5 + Math.random() * 1.4;
    const a = Math.random() * Math.PI * 2;
    target.x += Math.cos(a) * off;
    target.z += Math.sin(a) * off;
    target.y = k.groundY(target.x, target.z, hp.y + 2, 8) + 0.4;
    const dir = new THREE.Vector3(target.x - head.x, 0, target.z - head.z).normalize();
    const start = head.clone().addScaledVector(dir, 0.45).add(new THREE.Vector3(0, 0.15, 0));
    k.spawnItem('fish', start, () => this.fallbackFish(start), (e) => {
      if (!e.body) return;
      e.tags.add('fish');
      this.mine.push(e);
      this.trimFish();
      const b = e.body;
      if (b.bodyType() !== RAPIER.RigidBodyType.Dynamic) b.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      b.setTranslation({ x: start.x, y: start.y, z: start.z }, true);
      b.setLinearDamping(0);
      b.enableCcd(true);
      b.setGravityScale(1, true);
      b.wakeUp();
      const v = new THREE.Vector3((target.x - start.x) / T, (target.y - start.y) / T + 0.5 * GRAVITY * T, (target.z - start.z) / T);
      b.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      b.setAngvel({ x: (Math.random() - 0.5) * 6, y: 4 + Math.random() * 4, z: (Math.random() - 0.5) * 6 }, true);
      const marker = landingRing();
      marker.position.set(target.x, target.y - 0.37, target.z);
      this.game.scene.add(marker);
      this.flying.push({ e, t0: this.game.time, T, marker, catching: false });
      this.game.sfx('throw', start, 0.8);
      this.game.events.emit('fishThrown', {});
    });
  }

  private fallbackFish(at: THREE.Vector3): Entity {
    return spawnProp(
      this.game,
      { name: 'Fish', object: fishObject(), mass: 1.2, tags: ['grabbable', 'washable', 'fish', 'food'], sleeping: false, friction: 0.6, restitution: 0.3, data: { buoyancy: 6 } },
      at.clone().add(new THREE.Vector3(0, -0.1, 0)),
    );
  }

  /** Keep at most 6 of our fish around. */
  private trimFish() {
    this.mine = this.mine.filter((e) => e.alive);
    while (this.mine.length > 6) {
      const i = this.mine.findIndex((e) => !e.data.heldByPlayer && !this.flying.some((f) => f.e === e));
      if (i < 0) break;
      const [old] = this.mine.splice(i, 1);
      this.floppers = this.floppers.filter((f) => f.e !== old);
      destroyProp(this.game, old);
    }
  }

  // ------------------------------------------------------------------ per step
  postPhysics() {
    const now = this.game.time;
    const k = this.kit;
    const p = this.player;
    const hand = k.handPoint(new THREE.Vector3());
    for (const f of [...this.flying]) {
      const e = f.e;
      const b = e.body;
      const done = (landed: boolean) => {
        f.marker?.removeFromParent();
        f.marker = null;
        this.flying.splice(this.flying.indexOf(f), 1);
        if (e.alive && e.body) e.body.setLinearDamping(0.05);
        if (landed && e.alive) {
          this.floppers.push({ e, until: now + 9, next: now + 0.4 });
          if (now > this.missLineT && this.monger?.alive && !this.monger.down) {
            this.missLineT = now + 6;
            this.monger.say(MISSES[Math.floor(Math.random() * MISSES.length)], 2.4);
          }
        }
      };
      if (!e.alive || !b) {
        done(false);
        continue;
      }
      if (e.data.heldByPlayer) {
        // grabbed out of the air with E: counts!
        done(false);
        if (!f.catching) this.caught(e);
        continue;
      }
      if (f.catching) continue;
      const t = b.translation();
      const v = b.linvel();
      const age = now - f.t0;
      if (f.marker) {
        const s = 1 + Math.sin(now * 12) * 0.12;
        f.marker.scale.set(s, 1, s);
      }
      if (p && age > 0.35 && v.y < 2 && !p.held && k.canTake()) {
        const dx = t.x - hand.x;
        const dy = t.y - (hand.y + 0.15);
        const dz = t.z - hand.z;
        if (dx * dx + dy * dy * 0.6 + dz * dz < 1.0) {
          f.catching = true;
          k.handToPlayer(e, (ok) => {
            done(false);
            if (ok) this.caught(e);
          });
          continue;
        }
      }
      const speed = Math.hypot(v.x, v.y, v.z);
      if (age > f.T + 0.15 && (speed < 4 || age > f.T + 1.2)) done(true);
      else if (t.y < -20) done(false);
    }
    // fish thrown back at the fishmonger
    const m = this.monger;
    if (m?.alive && !m.down) {
      const chest = m.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      for (const r of [...this.returning]) {
        const e = r.e;
        if (!e.alive || !e.body || now > r.until || e.data.heldByPlayer) {
          this.returning.splice(this.returning.indexOf(r), 1);
          continue;
        }
        const t = e.body.translation();
        if ((t.x - chest.x) ** 2 + (t.y - chest.y) ** 2 * 0.5 + (t.z - chest.z) ** 2 < 1.3 * 1.3) {
          this.returning.splice(this.returning.indexOf(r), 1);
          this.onReturned(e);
        }
      }
    }
  }

  private caught(e: Entity) {
    const k = this.kit;
    const n = (this.saved.caught = Number(this.saved.caught ?? 0) + 1);
    this.floppers = this.floppers.filter((f) => f.e !== e);
    k.shout('CAUGHT IT!', n > 1 ? `Fish caught: ${n}` : 'Catch of the Day!', '#4ac1ff');
    this.game.score(150, 'CAUGHT IT!', this.player?.position.clone());
    this.game.sfx('crowd_cheer', this.market, 0.6);
    this.game.sfx('happy', this.player?.position, 0.8);
    k.fx('sparkles', k.handPoint(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0)), { radius: 0.5 });
    if (this.monger?.alive && !this.monger.down) {
      this.monger.say(CATCHES[Math.floor(Math.random() * CATCHES.length)], 2.6);
      this.monger.cheer(1.4);
    }
    this.game.events.emit('fishCaught', { count: n });
    if (!this.done) {
      this.setStep('caught');
      this.complete();
    } else this.save();
  }

  private onReturned(e: Entity) {
    const m = this.monger!;
    this.returns++;
    const deft = this.returns === 1 || Math.random() < 0.5;
    if (deft) {
      m.say('Thanks, little buddy! Right back atcha!', 2.6);
      m.cheer(0.8);
      this.floppers = this.floppers.filter((f) => f.e !== e);
      this.mine = this.mine.filter((x) => x !== e);
      destroyProp(this.game, e);
      this.game.sfx('grab', m.position, 0.8, 0.9);
      this.game.score(80, 'Returned To Sender', m.position.clone());
      this.throwT = Math.min(this.throwT, 1.4);
      this.game.events.emit('fishReturned', { caught: true });
    } else {
      const v = e.body!.linvel();
      m.ragdoll(new THREE.Vector3(v.x * 6, 160, v.z * 6));
      m.say('OOF. Fair.', 2);
      this.game.sfx('bonk', m.position, 1);
      this.game.score(120, 'Fish Slapped The Fishmonger', m.position.clone());
      this.game.events.emit('fishReturned', { caught: false });
    }
  }

  private updateFloppers() {
    const now = this.game.time;
    for (const f of [...this.floppers]) {
      const e = f.e;
      if (!e.alive || !e.body || now > f.until || e.data.heldByPlayer) {
        this.floppers.splice(this.floppers.indexOf(f), 1);
        continue;
      }
      if (now < f.next) continue;
      f.next = now + 0.35 + Math.random() * 0.55;
      const b = e.body;
      const mass = b.mass() || 1.2;
      const v = b.linvel();
      if (Math.abs(v.y) > 1.5) continue; // still bouncing
      const flop = 2 + Math.random() * 1.2;
      b.applyImpulse({ x: (Math.random() - 0.5) * 2.2 * mass, y: flop * mass, z: (Math.random() - 0.5) * 2.2 * mass }, true);
      b.applyTorqueImpulse({ x: (Math.random() - 0.5) * 0.12, y: (Math.random() - 0.5) * 0.05, z: (Math.random() - 0.5) * 0.12 }, true);
      if (Math.random() < 0.3) {
        const t = b.translation();
        this.game.sfx('flop', new THREE.Vector3(t.x, t.y, t.z), 0.3, 1.6);
      }
    }
  }
}
