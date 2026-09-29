import * as THREE from 'three';
import type { Entity } from '../../../../core/Entities';
import { destroyProp, spawnProp } from '../../../../entities/Props';
import { Landmark } from '../Landmark';
import type { Actor } from '../kit/Actors';
import { Crowd } from '../kit/Crowd';
import { buildGradStage, diplomaObject, gradCap, local, soggify } from '../kit/Props';

const SPEECH_FIRST = [
  'Ahem. Graduates, faculty, and one extremely round raccoon…',
  'By the power vested in me by the Department of Laundry Sciences…',
  'For his groundbreaking thesis, "Wash It: A Critical Examination of Things"…',
  'I hereby confer upon Jimothy the degree of Doctor of Washing, honoris causa. SUMMA CUM RACCOON!',
];
const SPEECH_AGAIN = [
  'Back again, Doctor? We have a printer. Here, have another one.',
  'Please do not wash this one either. (He will wash this one.)',
];
const NAGS = [
  'Ah! Our honorary graduate! Please, come up to the stage!',
  'The ceremony cannot start without the guest of honor. That is you. The round one.',
  'Up the steps, Doctor! Your diploma is getting cold.',
];
const CHEERS = ['WOOO!', 'Summa cum raccoon!', 'DOCTOR JIMOTHY!', "He's so round!", 'Class of 2026!', 'Go Huskies… er, Raccoons!'];
const STUDENT_NAMES = ['Grad Student', 'Undergrad', 'Valedictorian', 'Exchange Student', 'Grad Student'];

/**
 * Honorary Degree @ University of Washing (POIs `gradStage`, `dean`).
 * idle → (Jimothy steps onto the stage) → speech → handoff (diploma into his paws, caps fly) → celebrate → cooldown.
 * Washing a diploma afterwards → "Degree In Soggy".
 */
export class HonoraryDegree extends Landmark {
  readonly id = 'degree';
  readonly title = 'Honorary Degree';
  private stage = new THREE.Vector3(120, 1, -120);
  private deanSpot = new THREE.Vector3(120, 1, -122);
  private audience = new THREE.Vector3(120, 0, -112);
  private facing = 0;
  private dean: Actor | null = null;
  private crowd!: Crowd;
  private diplomas: Entity[] = [];
  private nagT = 4;
  private first = true;
  private usedFallback = false;

  setup() {
    this.crowd = new Crowd(this.kit);
    const k = this.kit;
    const stage = k.poi('gradStage');
    const dean = k.poi('dean');
    if (stage) {
      this.stage.copy(stage);
      // Face the audience: away from the dean if we know where he stands, else toward the map centre.
      this.facing = dean ? Math.atan2(stage.x - dean.x, stage.z - dean.z) : Math.atan2(-stage.x, -stage.z);
      this.deanSpot.copy(k.onGround(dean ?? local(stage, this.facing, 0, 0, -2), 1.2, 4));
      const aud = local(stage, this.facing, 0, 0, 8);
      this.audience.copy(k.onGround(aud.setY(stage.y + 1), 2, 10));
    } else {
      this.usedFallback = true;
      const spot = k.findClearSpot(118, -118, 8);
      k.reserve(spot, 10);
      this.facing = Math.atan2(-spot.x, -spot.z);
      const built = buildGradStage(k.world, spot, this.facing);
      this.stage.copy(built.top);
      this.deanSpot.copy(built.dean);
      this.audience.copy(k.onGround(built.audience, 2, 6));
      k.world.poi.set('gradStage', built.top.clone());
      k.world.poi.set('dean', built.dean.clone());
    }
    this.game.events.on('wash', (p: { entity?: Entity }) => {
      // only ceremony diplomas (the Honorary Grad mutator flings its own, with its own soggy joke)
      if (p?.entity && (this.diplomas.includes(p.entity) || p.entity.data?.landmarkDiploma)) this.onDiplomaWashed(p.entity);
    });
  }

  anchor() {
    return this.stage;
  }

  hint() {
    if (this.step === 'soggy') return 'Doctor of Washing (Soggy). Your parents are so proud.';
    if (this.done) return 'You have a degree. Now wash it. For science.';
    return 'Walk onto the graduation stage at the University of Washing (north-east).';
  }

  debugSpot() {
    return { pos: local(this.stage, this.facing, 0, 1.2, 4.5), facing: this.facing + Math.PI };
  }

  private onStage() {
    const p = this.player;
    if (!p) return false;
    return this.flatDist(this.stage) < 3.4 && Math.abs(p.position.y - this.stage.y) < 1.7 && p.mode !== 'ragdoll';
  }

  update(dt: number) {
    this.stateTime += dt;
    const d = this.flatDist(this.stage);
    // Keep the dean around while Jimothy is in the neighbourhood.
    if (d < 75 && (!this.dean || !this.dean.alive)) {
      this.dean = this.kit.spawnActor({ type: 'dean', name: 'Dean Suds', position: this.deanSpot, facing: this.facing, outfit: { gown: 0x3b1f6b, hat: 'mortarboard', shirt: 0x3b1f6b, pants: 0x2b2b2b, shoes: 0x151515, hair: 0x9d9d9d } });
    } else if (d > 110 && this.dean && this.state === 'idle') {
      this.kit.removeActor(this.dean);
      this.dean = null;
    }
    const dean = this.dean;

    switch (this.state) {
      case 'idle': {
        if (dean && d < 18) {
          this.nagT -= dt;
          if (this.nagT <= 0) {
            this.nagT = 9;
            dean.say(NAGS[Math.floor(Math.random() * NAGS.length)], 3.2);
          }
        }
        if (this.onStage()) this.startCeremony();
        break;
      }
      case 'speech': {
        if (d > 16) this.abandon();
        break;
      }
      case 'celebrate': {
        if (this.stateTime > 7) {
          this.crowd.disperse(7);
          this.go('cooldown');
        }
        break;
      }
      case 'cooldown': {
        if (d > 11 || this.stateTime > 60) this.go('idle');
        break;
      }
    }
  }

  private startCeremony() {
    const k = this.kit;
    this.first = !this.done;
    this.go('speech');
    this.crowd.gather({
      center: this.audience,
      faceTo: this.stage,
      count: 5,
      radius: 3.2,
      type: 'pedestrian',
      names: STUDENT_NAMES,
      outfit: { gown: 0x3b1f6b, hat: 'mortarboard' },
      look: { topStyle: 'gown', top: 0x3b1f6b, topAccent: 0xd4a52a, hat: 'mortarboard', hatColor: 0x222222 },
      from: 9,
    });
    this.dean?.face(this.stage);
    this.dean?.expression('happy');
    this.frameCeremony(this.facing);
    this.game.sfx('crowd_ooh', this.stage, 0.7);
    const lines = this.first ? SPEECH_FIRST : SPEECH_AGAIN;
    k.dialog('Dean Suds, University of Washing', lines, () => {
      if (this.state === 'speech') this.handoff();
    }, { portrait: '🎓', color: '#7a4fd1' });
  }

  private abandon() {
    this.dean?.say('…and he has left. Classic graduate.', 3);
    this.crowd.disperse(5);
    this.go('cooldown');
  }

  private handoff() {
    const k = this.kit;
    const dean = this.dean;
    this.go('celebrate');
    const from = dean?.alive ? dean.handPos(new THREE.Vector3()) : this.stage.clone().add(new THREE.Vector3(0, 1.2, 0));
    dean?.say(this.first ? 'Congratulations, Doctor Jimothy!' : 'Congratulations… again!', 2.8);
    dean?.throwAnim();
    // at most 3 of our diplomas lying around
    this.diplomas = this.diplomas.filter((e) => e.alive);
    while (this.diplomas.length >= 3) {
      const old = this.diplomas.shift()!;
      if (old.alive && !old.data.heldByPlayer) destroyProp(this.game, old);
    }
    k.spawnItem('diploma', from, () => this.fallbackDiploma(from), (e) => {
      e.tags.add('diploma');
      e.data.landmarkDiploma = true;
      this.diplomas.push(e);
      k.handToPlayer(e, (ok) => {
        if (!ok) k.hint('Your diploma! Grab it (E / left click).', 3);
      });
    });
    // party
    const top = this.stage.clone().add(new THREE.Vector3(0, 1.5, 0));
    k.fx('confetti', top, { count: 140 });
    k.fx('fireworks', this.stage.clone().add(new THREE.Vector3(0, 6, 0)), { count: 5 });
    this.crowd.toss(gradCap);
    this.crowd.cheer(CHEERS, 4, 2.4);
    this.game.sfx('crowd_cheer', this.stage, 1);
    this.game.sfx('firework', this.stage, 0.7);
    k.banner(this.first ? 'HONORARY DEGREE!' : 'ANOTHER DEGREE!', 'Doctor of Washing (Hon.)', 3.5, 'University of Washing');
    if (this.first) {
      this.game.score(500, 'Summa Cum Raccoon', this.stage.clone());
      this.game.events.emit('degreeReceived', { first: true });
      this.setStep('received');
      this.complete('honoraryGrad');
      k.after(3.8, () => k.hint('You got a degree! Now… maybe wash it? What could go wrong.', 4));
    } else {
      this.game.score(50, 'Encore Graduate', this.stage.clone());
      this.game.events.emit('degreeReceived', { first: false });
    }
  }

  private fallbackDiploma(at: THREE.Vector3): Entity {
    const game = this.game;
    const e = spawnProp(
      game,
      {
        name: 'Diploma',
        object: diplomaObject(),
        mass: 0.3,
        shape: 'box',
        tags: ['grabbable', 'washable', 'diploma', 'paper'],
        sleeping: false,
        data: { buoyancy: 2 },
        onWash: (g) => {
          if (e.data.soggy) {
            g.score(10, 'Still Soggy');
            return;
          }
          e.data.soggy = true;
          if (e.object) soggify(e.object);
          g.sfx('splash', undefined, 0.5, 1.4);
          g.events.emit('itemWashed', { kind: 'diploma', entity: e });
        },
      },
      at.clone().add(new THREE.Vector3(0, -0.1, 0)),
    );
    return e;
  }

  private onDiplomaWashed(e: Entity) {
    if (e.data.lmSoggyAwarded) return;
    e.data.lmSoggyAwarded = true;
    e.data.soggy = true;
    const k = this.kit;
    const firstSoggy = this.step !== 'soggy';
    // Items-system diplomas already score their own "Degree In Soggy": don't double-award.
    const itemScored = !!e.data.itemKind;
    if (firstSoggy) {
      if (!itemScored) this.game.score(300, 'Degree In Soggy');
      k.shout('DEGREE IN SOGGY', 'Your diploma is now a papier-mâché burrito.', '#4ac1ff');
      this.game.sfx('sad_trombone', undefined, 0.6);
      this.game.events.emit('degreeSoggy', {});
      this.setStep('soggy');
    } else if (!itemScored) {
      this.game.score(40, 'Another Soggy Degree');
    }
    if (this.dean?.alive && this.flatDist(this.deanSpot) < 25) this.dean.say(firstSoggy ? 'Did he… did he just wash his diploma?' : '…we are not printing a fourth one.', 3);
  }
}
