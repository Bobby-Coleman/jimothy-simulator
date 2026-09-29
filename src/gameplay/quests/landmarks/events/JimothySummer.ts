import * as THREE from 'three';
import { Landmark } from '../Landmark';
import type { Actor } from '../kit/Actors';
import { Crowd } from '../kit/Crowd';
import { buildPodium, local, setSignTexture, summerBackdrop } from '../kit/Props';

const SPEECH_FIRST = [
  'Citizens of Ballard-ish! Settle down. Yes, he is here. Yes, he is round.',
  'WHEREAS Jimothy is round;',
  'WHEREAS he is perfect;',
  'WHEREAS he has washed at least one phone per day, which is honestly more than most of us;',
  'I hereby declare… JIMOTHY SUMMER!',
];
const SPEECH_AGAIN = ['It is STILL Jimothy Summer!', 'It will remain Jimothy Summer until further notice. Possibly forever.'];
const NAGS = [
  'Is that him? Places, everyone! Up here on the podium, please!',
  'The proclamation is ready! We just need the honoree. On the podium!',
  'Mr. Jimothy! Your summer awaits! Up the steps!',
];
const CHEERS = ['JIMOTHY SUMMER!', 'Best. Summer. Ever.', 'We love you Jimothy!', 'He looked at me!', 'Round boy summer!'];
const FAN_NAMES = ['Superfan', 'Fan', 'Local Resident', 'Tourist', 'Fan', 'Superfan'];

/**
 * "Jimothy Summer" proclamation @ City Hall (POI `cityHallPodium`, optional `mayor`).
 * idle → (Jimothy climbs onto the podium) → speech → climax (confetti, JIM-O-THY! chant, golden sky) → celebrate → cooldown.
 */
export class JimothySummer extends Landmark {
  readonly id = 'summer';
  readonly title = 'Jimothy Summer';
  private podium = new THREE.Vector3(120, 1, 0);
  private mayorSpot = new THREE.Vector3(120, 1, -2);
  private audience = new THREE.Vector3(120, 0, 8);
  private facing = 0;
  private mayor: Actor | null = null;
  private crowd!: Crowd;
  private backdrop: THREE.Object3D | null = null;
  private nagT = 3;
  private first = true;

  setup() {
    this.crowd = new Crowd(this.kit);
    const k = this.kit;
    const pod = k.poi('cityHallPodium');
    const mayor = k.poi('mayor');
    if (pod) {
      this.podium.copy(pod);
      const statue = k.poi('jimothyStatue');
      // Audience side: away from the mayor, else toward the statue (plaza), else toward the map centre.
      if (mayor) this.facing = Math.atan2(pod.x - mayor.x, pod.z - mayor.z);
      else if (statue) this.facing = Math.atan2(statue.x - pod.x, statue.z - pod.z);
      else this.facing = Math.atan2(-pod.x, -pod.z);
      this.mayorSpot.copy(k.onGround(mayor ?? local(pod, this.facing, 0, 0, -1.8), 1.2, 4));
      const aud = local(pod, this.facing, 0, 0, 8);
      this.audience.copy(k.onGround(aud.setY(pod.y + 1), 3, 12));
    } else {
      const spot = k.findClearSpot(112, 12, 7);
      k.reserve(spot, 9);
      this.facing = Math.atan2(-spot.x, -spot.z);
      const built = buildPodium(k.world, spot, this.facing);
      this.podium.copy(built.top);
      this.mayorSpot.copy(built.mayor);
      this.audience.copy(k.onGround(built.audience, 2, 6));
      this.backdrop = built.backdrop;
      if (this.done) setSignTexture(this.backdrop, summerBackdrop(true));
      k.world.poi.set('cityHallPodium', built.top.clone());
    }
  }

  anchor() {
    return this.podium;
  }

  hint() {
    if (this.done) return 'It is officially Jimothy Summer. Enjoy it responsibly.';
    return 'Climb onto the podium at City Hall, Downtown (east).';
  }

  debugSpot() {
    return { pos: local(this.podium, this.facing, 0, 1.2, 5), facing: this.facing + Math.PI };
  }

  private onPodium() {
    const p = this.player;
    if (!p) return false;
    return this.flatDist(this.podium) < 3.6 && p.position.y > this.podium.y - 0.9 && p.position.y < this.podium.y + 3 && p.mode !== 'ragdoll';
  }

  update(dt: number) {
    this.stateTime += dt;
    const d = this.flatDist(this.podium);
    if (d < 75 && (!this.mayor || !this.mayor.alive)) {
      this.mayor = this.kit.spawnActor({
        type: 'mayor',
        name: 'Mayor Puddlesworth',
        position: this.mayorSpot,
        facing: this.facing,
        outfit: { shirt: 0x1f2d4d, pants: 0x1f2d4d, sash: 0xd4a017, hair: 0x9d9d9d, hat: 'tophat', hatColor: 0x1a1a1a, shoes: 0x151515 },
      });
    } else if (d > 110 && this.mayor && this.state === 'idle') {
      this.kit.removeActor(this.mayor);
      this.mayor = null;
    }
    const mayor = this.mayor;
    switch (this.state) {
      case 'idle':
        if (mayor && d < 20) {
          this.nagT -= dt;
          if (this.nagT <= 0) {
            this.nagT = 9;
            mayor.say(NAGS[Math.floor(Math.random() * NAGS.length)], 3.2);
          }
        }
        if (this.onPodium()) this.start();
        break;
      case 'speech':
        if (d > 18) {
          mayor?.say('He… left? Should I keep reading? I will keep reading.', 3);
          this.crowd.disperse(5);
          this.go('cooldown');
        }
        break;
      case 'celebrate':
        if (this.stateTime > 8) {
          this.mayor?.armsUp(0);
          this.crowd.disperse(7);
          this.go('cooldown');
        }
        break;
      case 'cooldown':
        if (d > 12 || this.stateTime > 60) this.go('idle');
        break;
    }
  }

  private start() {
    const k = this.kit;
    this.first = !this.done;
    this.go('speech');
    this.crowd.gather({
      center: this.audience,
      faceTo: this.podium,
      count: 6,
      radius: 3.6,
      type: 'fan',
      names: FAN_NAMES,
      outfit: { jimothyTee: true, shirt: 0xffffff },
      look: { print: 'jimothy' },
      from: 10,
    });
    this.mayor?.face(this.podium);
    this.mayor?.expression('happy');
    this.game.sfx('crowd_ooh', this.podium, 0.8);
    k.dialog('Mayor Puddlesworth', this.first ? SPEECH_FIRST : SPEECH_AGAIN, () => {
      if (this.state === 'speech') this.climax();
    }, { portrait: '🏛️', color: '#2f7de1' });
  }

  private climax() {
    const k = this.kit;
    this.go('celebrate');
    const top = this.podium.clone().add(new THREE.Vector3(0, 1.4, 0));
    this.mayor?.armsUp(1);
    this.mayor?.say(this.first ? 'JIMOTHY SUMMER!!' : 'STILL JIMOTHY SUMMER!', 3, true);
    k.fx('confetti', top, { count: 160, scale: 1.4 });
    k.fx('fireworks', this.podium.clone().add(new THREE.Vector3(0, 8, 0)), { count: 8, duration: 2.4 });
    k.fx('hearts', top, { count: 10 });
    k.goldenFlash(this.first ? 7 : 4);
    this.game.sfx('crowd_cheer', this.podium, 1);
    this.game.sfx('firework', this.podium, 0.8);
    k.after(0.7, () => this.game.sfx('firework', this.podium, 0.7));
    this.crowd.cheer(CHEERS, 3, 2);
    k.after(1.2, () => this.crowd.chant(['JIM-', 'O-', 'THY!'], 0.5, 3));
    k.banner(this.first ? 'JIMOTHY SUMMER!' : 'STILL JIMOTHY SUMMER!', 'By order of the Mayor · Sunglasses mandatory', 3.8, 'Official Proclamation');
    if (this.backdrop) setSignTexture(this.backdrop, summerBackdrop(true));
    this.game.events.emit('proclamation', { first: this.first });
    if (this.first) {
      this.game.score(600, 'Proclaimed Round And Perfect', this.podium.clone());
      this.setStep('proclaimed');
      this.complete('jimothySummer');
    } else {
      this.game.score(60, 'Encore Proclamation', this.podium.clone());
    }
  }
}
