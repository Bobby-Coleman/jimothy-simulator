/**
 * Backyard trampolines: Jimothy bounces (linvel.y = 14, 17 while holding jump) when he lands on the mat.
 *
 * The mat collider only collides with props/NPC ragdolls/animals (bouncy restitution) — the player passes
 * through it and this system detects the plane crossing *after* the physics step, so the controller's
 * "big velocity change = got hit" ragdoll check and its slope feet-planting never fight the bounce.
 */
import * as THREE from 'three';
import type { Game, System } from '../../../core/Game';
import { RAPIER, G, groups } from '../../../core/Physics';
import type { World } from '../../World';
import { Batch, GEO, colliderRing, colliderBox, trs, type MatSet } from './kit';

export interface TrampolineDef {
  /** Mat center; y = mat surface height. */
  center: THREE.Vector3;
  radius: number;
  mat?: THREE.Object3D;
  sag: number;
}

const registry: TrampolineDef[] = [];
export function registerTrampoline(t: TrampolineDef) {
  registry.push(t);
}
export function trampolines(): readonly TrampolineDef[] {
  return registry;
}

const PLAYER_R = 0.38;
const BOUNCE_V = 14;
const SUPER_V = 17;

export class TrampolineSystem implements System {
  name = 'trampolines';
  /** All registered trampolines (debug: jimothy.get('trampolines').list). */
  get list(): readonly TrampolineDef[] {
    return registry;
  }
  private preY = 0;
  private preVy = 0;
  private chain = 0;
  private lastBounce = -10;
  private lastBonus = -10;

  update(_dt: number, game: Game) {
    const p = game.get<any>('player');
    if (!p?.body) return;
    const t = p.body.translation();
    this.preY = t.y;
    this.preVy = p.body.linvel().y;
  }

  postPhysics(dt: number, game: Game) {
    for (const tr of registry) {
      if (tr.sag > 0.001) {
        tr.sag *= Math.exp(-9 * dt);
        if (tr.mat) tr.mat.position.y = tr.center.y - tr.sag;
      }
    }
    const p = game.get<any>('player');
    if (!p?.body || p.frozen) return;
    const mode: string = p.mode;
    if (mode === 'climb' || mode === 'swim' || mode === 'hang') return;
    const t = p.body.translation();
    const v = p.body.linvel();
    const r = PLAYER_R * (p.sizeMul ?? 1);
    for (const tr of registry) {
      const c = tr.center;
      const dx = t.x - c.x,
        dz = t.z - c.z;
      if (dx * dx + dz * dz > (tr.radius - 0.12) * (tr.radius - 0.12)) continue;
      const bottomPrev = this.preY - r;
      const bottomNow = t.y - r;
      if (!(bottomPrev >= c.y - 0.06 && bottomNow < c.y + 0.03)) continue;
      const incoming = -Math.min(this.preVy, v.y);
      if (incoming < -0.5) continue; // moving up through it (jumped from below?)
      const boost = game.input.held('jump');
      const vy = incoming > 2 ? (boost ? SUPER_V : BOUNCE_V) : boost ? 9 : 5.5;
      const y = c.y + r + 0.02;
      p.body.setTranslation({ x: t.x, y, z: t.z }, true);
      p.body.setLinvel({ x: v.x * 0.9, y: vy, z: v.z * 0.9 }, true);
      p.position?.set?.(t.x, y, t.z);
      p.velocity?.set?.(v.x * 0.9, vy, v.z * 0.9);
      if (p.model?.root) p.model.root.position.y = y;
      tr.sag = Math.min(0.35, 0.08 + incoming * 0.018);
      if (incoming > 2) {
        const now = game.time;
        this.chain = now - this.lastBounce < 3.2 ? this.chain + 1 : 1;
        this.lastBounce = now;
        game.sfx('boing', new THREE.Vector3(t.x, c.y, t.z), 0.8, 0.9 + Math.min(0.5, this.chain * 0.05));
        game.score(boost ? 40 : 25, boost ? 'Mega Boing' : 'Boing');
        if (this.chain >= 5 && now - this.lastBonus > 8) {
          this.lastBonus = now;
          game.score(150, 'Trampoline Pro');
        }
        game.events.emit('trampoline', { position: new THREE.Vector3(t.x, c.y, t.z), vy, chain: this.chain });
      }
      break;
    }
  }
}

/**
 * Build a backyard trampoline at (x, z) (legs adapt to the slope). Static parts go into `batch`;
 * the mat is its own mesh so it can sag. Registers it with the system.
 */
export function buildTrampoline(game: Game, world: World, mats: MatSet, batch: Batch, x: number, z: number, radius = 1.9, color = 0x2f7de1) {
  let maxH = -Infinity;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    maxH = Math.max(maxH, world.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius));
  }
  maxH = Math.max(maxH, world.heightAt(x, z));
  const matY = maxH + 0.85;
  // legs (W-shaped in reality, straight here) down to the local ground
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const lx = x + Math.cos(a) * (radius - 0.05),
      lz = z + Math.sin(a) * (radius - 0.05);
    const g = world.heightAt(lx, lz);
    const h = matY - g;
    batch.add('metal', GEO.cyl8, trs(lx, g + h / 2, lz, 0.07, h, 0.07), 0x9aa3ad);
  }
  // steel ring + padded rim
  batch.add('metal', new THREE.TorusGeometry(radius, 0.045, 6, 36), trs(x, matY - 0.02, z, 1, 1, 1, 0, Math.PI / 2), 0x9aa3ad, { uvTile: 0 });
  const pad = new THREE.TorusGeometry(radius, 0.16, 6, 36);
  batch.add('gloss', pad, trs(x, matY + 0.05, z, 1, 1, 0.55, 0, Math.PI / 2), color, { uvTile: 0 });
  // springs (little stripes)
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    batch.add('metal', GEO.box, trs(x + Math.cos(a) * (radius - 0.18), matY - 0.01, z + Math.sin(a) * (radius - 0.18), 0.3, 0.02, 0.03, -a), 0xc8ccd0);
  }
  // mat
  const matMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius - 0.3, radius - 0.3, 0.03, 32), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.75 }));
  matMesh.position.set(x, matY, z);
  matMesh.receiveShadow = true;
  matMesh.castShadow = true;
  matMesh.userData.noMerge = true;
  world.staticRoot.add(matMesh);

  // colliders: rim ring (solid for everybody), bouncy mat for props/ragdolls only
  colliderRing(game, x, matY - 0.05, z, radius - 0.02, 0.3, 0.3, 18);
  const cd = RAPIER.ColliderDesc.cylinder(0.05, radius - 0.15)
    .setTranslation(x, matY - 0.05, z)
    .setRestitution(0.92)
    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
    .setFriction(0.6)
    .setCollisionGroups(groups(G.DEBRIS, G.PROP | G.RAGDOLL | G.NPC | G.ANIMAL));
  game.physics.staticCollider(cd);

  registerTrampoline({ center: new THREE.Vector3(x, matY, z), radius: radius - 0.25, mat: matMesh, sag: 0 });
  return matY;
}
