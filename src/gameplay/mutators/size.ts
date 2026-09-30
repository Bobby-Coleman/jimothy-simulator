import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { G, groups } from '../../core/Physics';
import type { CameraRig } from '../../player/CameraRig';
import type { Jimothy } from '../../player/Jimothy';
import { sharedFx } from './shared';
import { getPlayer, PLAYER_R, type MutatorImpl } from './types';

const CRUSH_FILTER = groups(G.ALL, G.NPC | G.PROP | G.RAGDOLL | G.ANIMAL);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

interface SizeOpts {
  id: string;
  name: string;
  desc: string;
  unlockHint: string;
  hint: string;
  /** Visual size multiplier. */
  k: number;
  /** Also grow the physics collider (Chonk). */
  physics: boolean;
  /** Extra body mass while big (kg). */
  extraMass?: number;
  camMul: number;
  crush: boolean;
}

/** Top of the (lifted) visual ball relative to the physics body center. */
export const visualTop = (k: number) => PLAYER_R * (2 * k - 1);

/**
 * Resizes Jimothy. Visual size uses player.sizeMul; the model is lifted so his feet stay on the ground.
 * With `physics`, the ball collider is enlarged *and offset upward* (bottom stays where it was) while walking,
 * so the player controller's ground check / jump / coyote logic — which measure from the body center with the base
 * radius — keep working untouched. In every other mode (roll/ragdoll/swim/climb/hang) the collider returns to base size (roll physics are
 * tuned for it) and only the visual stays big.
 */
function sizeMutator(o: SizeOpts): MutatorImpl {
  let cfg: 'base' | 'big' | null = null;
  let offLand: (() => void) | null = null;
  let shock = 0;
  const cool = new WeakMap<Entity, number>();
  let lastScore = -10;
  let camApplied = 1;

  function setCollider(p: Jimothy, want: 'base' | 'big') {
    if (cfg === want) return;
    const c = p.collider;
    if (!c || !p.body) return;
    if (want === 'big') {
      c.setRadius(PLAYER_R * o.k);
      c.setTranslationWrtParent({ x: 0, y: PLAYER_R * o.k - PLAYER_R, z: 0 });
      p.body.setAdditionalMass(o.extraMass ?? 0, true);
    } else {
      c.setRadius(PLAYER_R);
      c.setTranslationWrtParent({ x: 0, y: 0, z: 0 });
      p.body.setAdditionalMass(0, true);
    }
    cfg = want;
  }

  function crush(game: Game, p: Jimothy, center: THREE.Vector3, radius: number, power: number, label: string | null) {
    const cols = game.physics.overlapSphere(center, radius, CRUSH_FILTER, p.body);
    const hit = new Set<Entity>();
    for (const c of cols) {
      const e = game.entities.fromCollider(c);
      if (!e || !e.alive || hit.has(e) || e.kind === 'player' || e.data.heldByPlayer) continue;
      hit.add(e);
    }
    let npcs = 0;
    for (const e of hit) {
      if ((cool.get(e) ?? -1) > game.time) continue;
      cool.set(e, game.time + 0.9);
      const t = e.body?.translation();
      const ep = t ? _a.set(t.x, t.y, t.z) : (e.object?.getWorldPosition(_a) ?? _a.copy(center));
      const dir = _b.copy(ep).sub(center).setY(0);
      if (dir.lengthSq() < 1e-4) dir.set(Math.sin(p.facing), 0, Math.cos(p.facing));
      dir.normalize().setY(0.5).normalize();
      const isNpc = e.kind === 'npc' || e.tags.has('npc');
      const impulse = dir.clone().multiplyScalar(Math.min(e.mass, 80) * power);
      if (isNpc) {
        const handled = e.onBonk?.(game, impulse, ep.clone()) === true;
        if (!handled && e.body?.isDynamic()) e.body.applyImpulse(impulse, true);
        game.events.emit('bonk', { entity: e, impulse, rolling: false, source: 'chonk' });
        game.sfx('impact_body', ep.clone(), 0.8);
        npcs++;
      } else if (e.body?.isDynamic() && e.mass < 250) {
        e.body.applyImpulse(impulse.multiplyScalar(0.55), true);
      }
    }
    if (npcs && label && game.time - lastScore > 0.6) {
      lastScore = game.time;
      game.score(40 * npcs, label, center.clone());
    }
  }

  return {
    def: { id: o.id, name: o.name, desc: o.desc, unlockHint: o.unlockHint, group: 'size' },
    enable(game) {
      const p = getPlayer(game);
      if (p) {
        p.sizeMul *= o.k;
        if (o.physics) setCollider(p, p.mode === 'walk' ? 'big' : 'base');
      }
      const cam = game.get<CameraRig>('camera');
      if (cam) {
        const before = cam.targetDistance;
        cam.targetDistance = THREE.MathUtils.clamp(before * o.camMul, cam.minDistance, cam.maxDistance);
        camApplied = cam.targetDistance / before;
      }
      if (o.crush) offLand = game.events.on('land', (ev) => (shock = Math.max(shock, ev?.height ?? 0)));
      game.hint(o.hint, 3);
    },
    disable(game) {
      const p = getPlayer(game);
      if (p) {
        p.sizeMul /= o.k;
        if (Math.abs(p.sizeMul - 1) < 1e-6) p.sizeMul = 1;
        if (o.physics) {
          cfg = null;
          setCollider(p, 'base');
          cfg = null;
        }
      }
      const cam = game.get<CameraRig>('camera');
      if (cam && camApplied) cam.targetDistance = THREE.MathUtils.clamp(cam.targetDistance / camApplied, cam.minDistance, cam.maxDistance);
      camApplied = 1;
      offLand?.();
      offLand = null;
      shock = 0;
    },
    update(game) {
      const p = getPlayer(game);
      if (!p) return;
      const walkLike = p.mode === 'walk';
      if (o.physics) setCollider(p, p.mode === 'walk' ? 'big' : 'base');

      // Carried items ride on top of the (resized) head instead of floating/clipping
      const h = p.held;
      if (h && h.kind === 'carry' && h.entity.body && h.entity.alive) {
        const size = (h.entity.data.size as THREE.Vector3 | undefined)?.y ?? 0.3;
        const f = p.forwardVec(_a);
        const target = _b.copy(p.position);
        if (p.washing) {
          target.addScaledVector(f, PLAYER_R * o.k + 0.15);
          target.y += PLAYER_R * (o.k - 1) - 0.1 * o.k + Math.sin(game.time * 24) * 0.04;
        } else {
          target.addScaledVector(f, 0.06 * o.k);
          target.y += visualTop(o.k) - (0.42 - p.model.backTop()) * o.k + size * 0.5 + 0.04;
        }
        h.entity.body.setNextKinematicTranslation({ x: target.x, y: target.y, z: target.z });
      }

      if (!o.crush) return;
      const center = _a.copy(p.position);
      center.y += PLAYER_R * (o.k - 1);
      if (walkLike && (p.speed > 2.2 || p.velocity.y < -4)) crush(game, p, center.clone(), PLAYER_R * o.k + 0.15, 3.5 + p.speed * 0.7, 'Chonked');
      if (shock > 2.5) {
        const hgt = shock;
        shock = 0;
        const feet = p.position.clone();
        feet.y -= PLAYER_R * 0.8;
        crush(game, p, feet, 2.6 + Math.min(4, hgt * 0.15), 6 + Math.min(10, hgt), null);
        game.get<CameraRig>('camera')?.shake(Math.min(1.1, 0.4 + hgt * 0.05));
        game.sfx('land_heavy', feet, 1, 0.7);
        game.sfx('impact_heavy', feet, 0.8, 0.6);
        game.score(Math.round(60 + hgt * 10), 'SEISMIC CHONK', feet);
        const fx = sharedFx(game);
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2;
          const d = new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a));
          fx.puffs.spawn(feet.clone().addScaledVector(d, PLAYER_R * o.k * 0.8), d.multiplyScalar(4 + Math.random() * 2), 0xcdbfa8, 0.5 + Math.random() * 0.3, 0.8, { drag: 3.5, grow: 2.2, alpha: 0.7 });
        }
      } else shock = 0;
    },
    post(_game, _dt, mods) {
      mods.lift += PLAYER_R * (o.k - 1);
    },
  };
}

export function chonk(): MutatorImpl {
  return sizeMutator({
    id: 'chonk',
    name: 'Chonk',
    desc: 'Maximum round: 2.4× Jimothy. Heavier, bigger hitbox, and people just sort of bounce off.',
    unlockHint: "Complete 'Round Boy' (roll 500 m).",
    hint: 'CHONK MODE: maximum round. Structural engineers are concerned.',
    k: 2.4,
    physics: true,
    extraMass: 18,
    camMul: 1.75,
    crush: true,
  });
}

export function tiny(): MutatorImpl {
  return sizeMutator({
    id: 'tiny',
    name: 'Tiny',
    desc: 'Half-size Jimothy. Same amount of round, just less of it.',
    unlockHint: "Complete 'Kit Collector' (bring all 5 kits home).",
    hint: 'Tiny Jimothy: fun-sized, fully round.',
    k: 0.5,
    physics: false,
    camMul: 0.7,
    crush: false,
  });
}

