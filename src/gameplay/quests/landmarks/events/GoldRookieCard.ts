import * as THREE from 'three';
import type { Entity } from '../../../../core/Entities';
import { spawnProp } from '../../../../entities/Props';
import { Landmark } from '../Landmark';
import { buildDugout, glowSprite, rookieCardObject } from '../kit/Props';

/**
 * The gold-bordered Jimothy rookie card (real one sold for $20,000+) hidden in the dugout (POI `rookieCard`).
 * First pickup → toast + 'collectible' { id: 'rookieCard', kind: 'rookieCard' }. Washing it → "Devalued".
 */
export class GoldRookieCard extends Landmark {
  readonly id = 'rookieCard';
  readonly title = 'Gold Rookie Card';
  private spot = new THREE.Vector3(140, 0, 100);
  private card: Entity | null = null;
  private glow: THREE.Sprite | null = null;
  private goneAt = -1;
  private glintT = 0;
  private pickedThisSession = false;
  private spawning = false;

  setup() {
    const k = this.kit;
    const poi = k.poi('rookieCard');
    if (poi) this.spot.copy(k.onGround(poi, 0.6, 3));
    else {
      const s = k.findClearSpot(146, 96, 4, 60);
      k.reserve(s, 5);
      const yaw = Math.atan2(118 - s.x, 118 - s.z); // open side toward the field
      const built = buildDugout(k.world, s, yaw);
      this.spot.copy(k.onGround(built.card, 0.3, 2));
      k.world.poi.set('rookieCard', this.spot.clone());
    }
    this.game.events.on('grab', (p: { entity?: Entity }) => {
      if (p?.entity && p.entity === this.card) this.onPickup();
    });
    this.game.events.on('wash', (p: { entity?: Entity }) => {
      const e = p?.entity;
      if (e && (e === this.card || e.tags?.has('rookiecard'))) this.onWashed(e);
    });
  }

  anchor() {
    return this.spot;
  }

  hint() {
    if (this.step === 'devalued') return 'You washed a $20,000 card. It is now worth $3. Worth it.';
    if (this.done) return 'Gold Jimothy Rookie Card (est. value $20,000). Please do not wash it.';
    return 'A legendary gold rookie card is hidden in a dugout at Tee-Hee Park (south-east).';
  }

  debugSpot() {
    return { pos: this.spot.clone().add(new THREE.Vector3(0, 1.0, 1.6)), facing: Math.PI };
  }

  update(dt: number) {
    const d = this.flatDist(this.spot);
    if ((!this.card || !this.card.alive) && d < 70 && !this.spawning) {
      if (this.card && !this.card.alive && this.goneAt < 0) this.goneAt = this.game.time;
      // respawn a lost card only when nobody's looking
      if (!this.card || (this.game.time - this.goneAt > 30 && d > 35)) this.spawnCard();
    }
    const c = this.card;
    if (this.glow) {
      if (!c || !c.alive || c.data.heldByPlayer || this.pickedThisSession) {
        this.glow.removeFromParent();
        this.glow = null;
      } else if (c.body) {
        const t = c.body.translation();
        this.glow.position.set(t.x, t.y + 0.12, t.z);
        const s = 0.55 + Math.sin(this.game.time * 3) * 0.12;
        this.glow.scale.setScalar(s);
      }
    }
    if (c?.alive && c.body && !c.data.heldByPlayer && d < 25) {
      this.glintT -= dt;
      if (this.glintT <= 0) {
        this.glintT = 2.2;
        const t = c.body.translation();
        this.kit.fx('glint', new THREE.Vector3(t.x, t.y + 0.1, t.z), { scale: 1.2 });
      }
    }
  }

  private spawnCard() {
    this.goneAt = -1;
    const at = this.spot.clone();
    this.card = null;
    this.spawning = true;
    this.kit.spawnItem('rookiecard', at, () => this.fallbackCard(at), (e) => {
      this.spawning = false;
      e.tags.add('rookiecard');
      e.tags.add('shiny');
      this.card = e;
      if (!this.pickedThisSession && !this.glow) {
        this.glow = glowSprite(0xffd84a, 0.6);
        this.game.scene.add(this.glow);
      }
    });
  }

  private fallbackCard(at: THREE.Vector3): Entity {
    const e = spawnProp(
      this.game,
      {
        name: 'Gold Rookie Card',
        object: rookieCardObject(),
        mass: 0.1,
        tags: ['grabbable', 'washable', 'shiny', 'rookiecard', 'collectible'],
        friction: 0.8,
        data: { value: 20000 },
        onWash: (g) => {
          if (!e.data.devalued) {
            e.data.devalued = true;
            e.data.value = 3;
            e.object?.traverse((o) => {
              const me = o as THREE.Mesh;
              if (!me.isMesh || !Array.isArray(me.material)) return;
              me.material = me.material.map((m) => {
                const c = (m as THREE.MeshStandardMaterial).clone();
                c.color.lerp(new THREE.Color(0x8a8f96), 0.55);
                c.emissiveIntensity = 0;
                c.roughness = 0.9;
                return c;
              });
            });
          }
          g.sfx('sad_trombone', undefined, 0.5);
          g.events.emit('itemWashed', { kind: 'rookiecard', entity: e });
        },
      },
      at,
    );
    return e;
  }

  private onPickup() {
    if (this.pickedThisSession) return;
    this.pickedThisSession = true;
    const k = this.kit;
    const first = !this.done;
    k.toast('Gold Jimothy Rookie Card', 'est. value $20,000', '🃏');
    this.game.sfx('cha_ching', this.player?.position, 0.9);
    k.fx('money', k.handPoint(new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0)), { count: 10 });
    this.game.events.emit('collectible', { id: 'rookieCard', kind: 'rookieCard' });
    if (first) {
      this.game.score(400, 'Est. Value $20,000', this.player?.position.clone());
      this.setStep('found');
      this.complete();
    }
  }

  private onWashed(e: Entity) {
    if (e.data.lmDevaluedAwarded) return;
    e.data.lmDevaluedAwarded = true;
    e.data.devalued = true;
    this.kit.shout('CARD DEVALUED', 'est. value: $3 (water damage). Worth it.', '#9aa3ad');
    this.game.score(150, 'Mint Condition? Not Anymore.');
    this.game.events.emit('rookieCardWashed', {});
    if (this.step !== 'devalued') this.setStep('devalued');
  }
}
