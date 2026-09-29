import * as THREE from 'three';
import type { Actor } from './Actors';
import type { Outfit } from './Figure';
import type { Kit } from './Kit';

export interface GatherOpts {
  /** Where the crowd stands (ground point). */
  center: THREE.Vector3;
  /** What they look at (the stage / podium). */
  faceTo: THREE.Vector3;
  count: number;
  /** Radius of the arc of spots around `center`. */
  radius?: number;
  /** Total arc angle (radians). */
  arc?: number;
  type: string;
  names?: string[];
  outfit?: Partial<Outfit>;
  look?: Record<string, any>;
  /** Spawn this far behind their spot and jog in (0 = appear in place). */
  from?: number;
}

/** A temporary crowd (students, fans) that gathers, cheers, chants and disperses. */
export class Crowd {
  readonly actors: Actor[] = [];
  private spots: THREE.Vector3[] = [];
  private faceTo = new THREE.Vector3();
  private leaving = false;

  constructor(private kit: Kit) {}

  get size() {
    return this.actors.length;
  }

  gather(o: GatherOpts) {
    this.clear();
    this.leaving = false;
    this.faceTo.copy(o.faceTo);
    const r = o.radius ?? 3;
    const arc = o.arc ?? Math.PI * 0.6;
    // "back" direction: from the stage toward the crowd
    const back = new THREE.Vector3().subVectors(o.center, o.faceTo).setY(0);
    if (back.lengthSq() < 1e-4) back.set(0, 0, 1);
    back.normalize();
    const baseAng = Math.atan2(back.x, back.z);
    for (let i = 0; i < o.count; i++) {
      const t = o.count === 1 ? 0.5 : i / (o.count - 1);
      const a = baseAng + (t - 0.5) * arc;
      const rr = r * (0.75 + ((i * 37) % 10) / 20);
      // arc around a point in front of the crowd center so they bunch facing the stage
      const spot = new THREE.Vector3(o.center.x + Math.sin(a) * rr - back.x * r * 0.7, 0, o.center.z + Math.cos(a) * rr - back.z * r * 0.7);
      const g = this.kit.onGround(spot.setY(o.center.y), 2.5, 6);
      this.spots.push(g);
      const start = o.from ? g.clone().addScaledVector(back, o.from + (i % 3) * 1.5).add(new THREE.Vector3((i % 2 ? 1 : -1) * 1.5, 0, 0)) : g.clone();
      const sg = this.kit.onGround(start.setY(o.center.y), 3, 8);
      const face = Math.atan2(o.faceTo.x - g.x, o.faceTo.z - g.z);
      const a2 = this.kit.spawnActor({
        type: o.type,
        name: o.names?.[i % o.names.length] ?? 'Fan',
        position: sg,
        facing: face,
        stationary: true,
        lookAtPlayer: true,
        outfit: o.outfit,
        look: o.look,
        passive: true,
      });
      if (o.from) a2.moveTo(g, 3.2 + (i % 3) * 0.4);
      this.actors.push(a2);
    }
  }

  /** Everyone cheers; a few shout one of `lines`. */
  cheer(lines: string[] = [], talkers = 3, secs = 2.2) {
    const idx = this.shuffled();
    idx.forEach((i, k) => {
      const a = this.actors[i];
      if (!a.alive || a.down) return;
      this.kit.after(k * 0.18, () => {
        if (!a.alive) return;
        a.cheer(secs);
        a.expression('happy');
        if (k < talkers && lines.length) a.say(lines[(k + Math.floor(Math.random() * lines.length)) % lines.length], secs);
      });
    });
  }

  /** Staggered chant bubbles, e.g. "JIM-", "O-", "THY!" */
  chant(parts: string[], every = 0.55, repeats = 2) {
    let t = 0;
    for (let r = 0; r < repeats; r++) {
      for (const part of parts) {
        const who = this.actors.filter((a) => a.alive && !a.down);
        this.kit.after(t, () => {
          for (let i = 0; i < who.length; i += 2) {
            const a = who[(i + r) % who.length];
            if (a?.alive) a.say(part, every * 1.3, true);
          }
          who.forEach((a) => a.alive && a.cheer(every));
        });
        t += every;
      }
      t += every * 0.6;
    }
    return t;
  }

  /** Throw grad caps (or anything) up from each head. */
  toss(make: () => THREE.Object3D, perActor = 1) {
    for (const a of this.actors) {
      if (!a.alive) continue;
      const head = a.headPos(new THREE.Vector3());
      for (let i = 0; i < perActor; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 2.2, 7 + Math.random() * 3, (Math.random() - 0.5) * 2.2);
        this.kit.particles.toss(make(), head.clone().add(new THREE.Vector3(0, 0.3, 0)), v, { life: 3.2 + Math.random(), floorY: a.position.y + 0.03 });
      }
    }
  }

  /** Walk away and vanish after `secs`. */
  disperse(secs = 6) {
    if (this.leaving) return;
    this.leaving = true;
    const actors = [...this.actors];
    for (const a of actors) {
      if (!a.alive) continue;
      const away = new THREE.Vector3().subVectors(a.position, this.faceTo).setY(0);
      if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
      away.normalize().multiplyScalar(14);
      away.x += (Math.random() - 0.5) * 8;
      away.z += (Math.random() - 0.5) * 8;
      a.moveTo(a.position.clone().add(away), 1.6 + Math.random() * 0.8);
    }
    this.kit.after(secs, () => {
      for (const a of actors) this.kit.removeActor(a);
      if (this.actors.every((a) => actors.includes(a))) this.actors.length = 0;
    });
  }

  clear() {
    for (const a of this.actors) this.kit.removeActor(a);
    this.actors.length = 0;
    this.spots.length = 0;
  }

  private shuffled() {
    const idx = this.actors.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx;
  }
}
