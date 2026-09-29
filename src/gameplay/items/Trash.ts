import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import { spawnProp } from '../../entities/Props';
import { buildTrashCan, buildTrashLid, buildDumpster, DUMPSTER } from './models';
import { spawnItemFlying, type ItemKind } from './Items';
import { registry, after, fxOf, entityPos, playerOf, rand, weighted, surfaceY } from './shared';

/**
 * Trash cans & dumpsters — the preferred way to put bins in a level:
 *
 *   spawnTrashCan(game, bottomPos, rotY?)  // 9 kg galvanised can; tip it over (>60°) the first time →
 *                                          // 'trashTipped' {entity}, +40 "Trash Panda!", lid pops off,
 *                                          // 2–3 random trash/food items spill out
 *   spawnDumpster(game, bottomPos, rotY?)  // 250 kg hollow green bin with a hinged lid (bonk it open/shut);
 *                                          // jump/fall inside → 'dumpsterDive' {entity}, "Dumpster Dive",
 *                                          // 1–3 weighted loot items pop out (cooldown per dumpster)
 *
 * Plain props tagged `trashcan` / `dumpster` made by other builders also work: tipping is detected for
 * any `trashcan`, and landing on top of a non-hollow `dumpster` counts as a dive.
 */

// ------------------------------------------------------------------ loot
export const TRASH_LOOT: readonly (readonly [ItemKind, number])[] = [
  ['sodaCan', 14],
  ['appleCore', 12],
  ['bananaPeel', 9],
  ['fishBones', 8],
  ['takeout', 8],
  ['newspaper', 7],
  ['glassBottle', 4],
];
export const FOOD_LOOT: readonly (readonly [ItemKind, number])[] = [
  ['pizza', 3],
  ['sandwich', 5],
  ['grapes', 4],
  ['fish', 4],
  ['coffee', 3],
  ['cottonCandy', 1],
];
export const SHINY_LOOT: readonly (readonly [ItemKind, number])[] = [
  ['spoon', 3],
  ['bottleCap', 4],
  ['key', 2],
  ['ring', 1],
  ['marble', 2],
];
export const RARE_LOOT: readonly (readonly [ItemKind, number])[] = [
  ['cash', 1.2],
  ['rubberDuck', 1.2],
  ['phone', 0.8],
  ['teddy', 0.6],
  ['soap', 1],
];

/** Roll one dumpster loot item. Night makes the trash juicier (more food & rares). */
export function rollDumpsterLoot(game: Game): ItemKind {
  const night = (game.get<any>('environment')?.nightFactor ?? 0) > 0.5;
  const k = night ? 1.7 : 1;
  const bucket = weighted([
    ['trash', 58],
    ['food', 22 * k],
    ['shiny', 12 * k],
    ['rare', 5.5 * k],
    ['golden', 0.5 * k],
  ] as const);
  switch (bucket) {
    case 'food':
      return weighted(FOOD_LOOT);
    case 'shiny':
      return weighted(SHINY_LOOT);
    case 'rare':
      return weighted(RARE_LOOT);
    case 'golden':
      return 'goldenTrophy';
    default:
      return weighted(TRASH_LOOT);
  }
}

/** Roll one trash-can spill item (mostly trash, some food, the odd shiny). */
export function rollTrashCanLoot(): ItemKind {
  const b = weighted([
    ['trash', 70],
    ['food', 25],
    ['shiny', 5],
  ] as const);
  return b === 'food' ? weighted(FOOD_LOOT) : b === 'shiny' ? weighted(SHINY_LOOT) : weighted(TRASH_LOOT);
}

// ------------------------------------------------------------------ trash can
const CAN_SIZE = new THREE.Vector3(0.62, 1.03, 0.62);
let canTemplate: THREE.Group | null = null;
let lidTemplate: THREE.Group | null = null;

/**
 * Spawn a galvanised trash can with its lid. `bottomPos.y` ≈ ground height; the real surface under the
 * can's footprint is found with a raycast so it starts upright and never inside a curb.
 */
export function spawnTrashCan(game: Game, bottomPos: THREE.Vector3, rotY = 0): Entity {
  if (!canTemplate) canTemplate = buildTrashCan();
  bottomPos = new THREE.Vector3(bottomPos.x, Math.max(bottomPos.y, surfaceY(game, bottomPos.x, bottomPos.y, bottomPos.z, 0.27)), bottomPos.z);
  const obj = canTemplate.clone(true);
  const e = spawnProp(
    game,
    {
      name: 'Trash Can',
      object: obj,
      shape: 'cylinder',
      size: CAN_SIZE.clone(),
      mass: 9,
      tags: ['grabbable', 'trashcan', 'washable', 'metal'],
      friction: 0.6,
      restitution: 0.25,
      data: { hasLid: true, buoyancy: 1.2 },
      onBonk(g, impulse) {
        // Hit it up high so it topples instead of just sliding.
        const b = e.body;
        if (!b || !b.isDynamic()) return false;
        const t = b.translation();
        b.applyImpulseAtPoint({ x: impulse.x, y: impulse.y * 0.6, z: impulse.z }, { x: t.x, y: t.y + 0.38, z: t.z }, true);
        return true;
      },
    },
    bottomPos,
    rotY,
  );
  registry.trashCans.add(e);
  return e;
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Tilt check for one can; handles the first tip-over. Call every frame (cheap when asleep).
 * A tip only counts if the can was disturbed within the last 10 s (see markDisturbed), and during the
 * first 5 s of play only player-caused tips count. Cans that fall over on their own are marked
 * silently and re-arm once they're standing again.
 */
export function checkTrashCan(game: Game, e: Entity) {
  const b = e.body;
  if (!e.alive || !b || e.data.heldByPlayer) return;
  if (b.isSleeping() || !b.isDynamic()) return;
  const r = b.rotation();
  const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
  if (e.data.tipped) {
    if (e.data.tipSilent && upY > 0.9) e.data.tipped = e.data.tipSilent = false;
    return;
  }
  if (upY > 0.5) return; // < 60° tilt
  e.data.tipped = true;
  const d = e.data.disturbedAt as number | undefined;
  const valid = d != null && game.time - d < 10 && (game.time > 5 || !!e.data.disturbedByPlayer);
  if (!valid) {
    e.data.tipSilent = true;
    return;
  }
  tipTrashCan(game, e);
}

function tipTrashCan(game: Game, e: Entity) {
  const b = e.body!;
  const t = b.translation();
  const r = b.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
  const half = ((e.data.size as THREE.Vector3 | undefined)?.y ?? 1) / 2;
  const mouth = new THREE.Vector3(t.x, t.y, t.z).addScaledVector(up, half + 0.18);
  const lv = b.linvel();
  game.events.emit('trashTipped', { entity: e });
  game.score(40, 'Trash Panda!', mouth);
  game.sfx('impact_metal', mouth, 0.8, 0.9);
  game.sfx('rummage', mouth, 0.7);
  fxOf(game)?.emit('trash', mouth, { scale: 0.8 });
  // lid pops off (our cans only)
  if (e.data.hasLid) {
    e.data.hasLid = false;
    const lidMesh = e.object?.getObjectByName('lid');
    if (lidMesh) lidMesh.visible = false;
    if (!lidTemplate) lidTemplate = buildTrashLid();
    const lid = spawnProp(game, { name: 'Trash Can Lid', object: lidTemplate.clone(true), shape: 'cylinder', mass: 1.2, tags: ['grabbable', 'washable', 'metal', 'lid'], restitution: 0.35, sleeping: false }, mouth, 0);
    const lb = lid.body!;
    lb.setTranslation({ x: mouth.x + up.x * 0.1, y: mouth.y + 0.05, z: mouth.z + up.z * 0.1 }, true);
    lb.setRotation({ x: r.x, y: r.y, z: r.z, w: r.w }, true);
    lb.setLinvel({ x: lv.x + up.x * 3, y: Math.max(lv.y, 0) + 3.2, z: lv.z + up.z * 3 }, true);
    lb.setAngvel({ x: rand(-6, 6), y: rand(-10, 10), z: rand(-6, 6) }, true);
  }
  // spill 2–3 items out of the mouth, one after another
  const n = 2 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    after(game, 0.08 + i * 0.12, () => {
      const side = new THREE.Vector3(-up.z, 0, up.x).multiplyScalar(rand(-0.25, 0.25));
      const p = mouth.clone().add(side).addScaledVector(up, 0.15 + i * 0.05);
      p.y = Math.max(p.y, t.y + 0.1);
      const v = new THREE.Vector3(up.x * rand(2.2, 3.6) + lv.x * 0.5, rand(1.5, 3), up.z * rand(2.2, 3.6) + lv.z * 0.5).add(side.multiplyScalar(4));
      spawnItemFlying(game, rollTrashCanLoot(), p, v);
    });
  }
}

// ------------------------------------------------------------------ dumpster
export interface DumpsterState {
  lidAngle: number;
  lidVel: number;
  lidCollider: RAPIER.Collider;
  lidPivot: THREE.Group;
  lastDive: number;
  playerInside: boolean;
  lastSlam: number;
}

const LID_MAX = 1.95;
const LID_G = 18; // 3g/(2L) for the lid plate

/** Spawn a 250 kg green dumpster with a hinged lid. `bottomPos.y` = ground height. */
export function spawnDumpster(game: Game, bottomPos: THREE.Vector3, rotY = 0): Entity {
  const { W, H, D, T, wheel } = DUMPSTER;
  const { root, lidPivot } = buildDumpster();
  bottomPos = new THREE.Vector3(bottomPos.x, Math.max(bottomPos.y, surfaceY(game, bottomPos.x, bottomPos.y, bottomPos.z, 0.55)), bottomPos.z);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  const cy = bottomPos.y + wheel + H / 2 + 0.01;
  root.position.set(bottomPos.x, cy, bottomPos.z);
  root.rotation.y = rotY;
  game.scene.add(root);

  const grp = groups(G.PROP);
  const thr = 250 * 60;
  const mk = (hx: number, hy: number, hz: number, x: number, y: number, z: number, mass: number) =>
    RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(x, y, z)
      .setMass(mass)
      .setFriction(0.8)
      .setRestitution(0.1)
      .setCollisionGroups(grp)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(thr);
  const colliders = [
    mk(W / 2, (0.1 + wheel) / 2, D / 2, 0, -H / 2 + (0.1 - wheel) / 2, 0, 130), // floor (+wheels)
    mk(W / 2, H / 2, T / 2, 0, 0, D / 2 - T / 2, 30),
    mk(W / 2, H / 2, T / 2, 0, 0, -D / 2 + T / 2, 30),
    mk(T / 2, H / 2, D / 2 - T, W / 2 - T / 2, 0, 0, 30),
    mk(T / 2, H / 2, D / 2 - T, -W / 2 + T / 2, 0, 0, 30),
    mk(W / 2 - 0.01, 0.025, D / 2, 0, H / 2 + 0.03, 0, 1), // lid (posed every frame)
  ];
  const body = game.physics.createDynamic(root, colliders, { linearDamping: 0.3, angularDamping: 0.6, sleeping: true });
  const lidCollider = body.collider(5);

  let ent!: Entity;
  const state: DumpsterState = { lidAngle: 0, lidVel: 0, lidCollider, lidPivot, lastDive: -99, playerInside: false, lastSlam: -9 };
  ent = game.entities.create({
    kind: 'prop',
    name: 'Dumpster',
    object: root,
    body,
    mass: 250,
    tags: new Set(['dumpster', 'grabbable', 'washable', 'metal', 'noclimb']),
    data: { size: new THREE.Vector3(W, H + wheel, D), floatRadius: 1.0, buoyancy: 0.9, hollow: true, dumpster: state },
    onBonk(g, impulse, point) {
      bonkDumpster(g, ent, impulse, point);
      return true;
    },
  });
  // (the lid collider desc already has the closed pose; only the visual needs syncing)
  lidPivot.rotation.x = 0;
  registry.dumpsters.add(ent);
  return ent;
}

function setLidPose(e: Entity, s: DumpsterState) {
  const { H, D } = DUMPSTER;
  const a = s.lidAngle;
  // hinge at (0, H/2, -D/2); lid centre sits D/2 in front of it, 0.03 above
  const cy = H / 2 + 0.03 * Math.cos(a) + (D / 2) * Math.sin(a);
  const cz = -D / 2 - 0.03 * Math.sin(a) + (D / 2) * Math.cos(a);
  s.lidCollider.setTranslationWrtParent({ x: 0, y: cy, z: cz });
  _q.setFromAxisAngle(_up.set(1, 0, 0), -a);
  s.lidCollider.setRotationWrtParent({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  s.lidPivot.rotation.x = -a;
}

/** Player (or anything) bonked the dumpster: flip the lid, rock the bin a little. */
function bonkDumpster(game: Game, e: Entity, impulse: THREE.Vector3, point: THREE.Vector3) {
  const s = e.data.dumpster as DumpsterState;
  const b = e.body;
  if (!s || !b) return;
  if (s.lidAngle < 1.0) s.lidVel = Math.max(s.lidVel, 7.2);
  else s.lidVel = Math.min(s.lidVel, -3.2);
  b.wakeUp();
  if (b.isDynamic()) b.applyImpulseAtPoint({ x: impulse.x * 0.35, y: impulse.y * 0.2, z: impulse.z * 0.35 }, { x: point.x, y: point.y, z: point.z }, true);
  game.sfx('impact_metal', point, 0.9, 0.8);
  if (s.lidAngle < 1.0) game.events.emit('dumpsterOpen', { entity: e });
}

/** Lid physics + dive detection. Call every frame. */
export function updateDumpster(game: Game, e: Entity, dt: number) {
  const s = e.data.dumpster as DumpsterState | undefined;
  const b = e.body;
  if (!e.alive || !s || !b) return;
  // --- lid: gravity torque about the hinge, with stops
  const r = b.rotation();
  const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
  const moving = Math.abs(s.lidVel) > 0.01 || (s.lidAngle > 0.001 && s.lidAngle < LID_MAX - 0.001);
  if (moving && upY > 0.7) {
    // never re-pose a collider of a sleeping body (Rapier gets its broad-phase state wrong)
    b.wakeUp();
    s.lidVel += -LID_G * Math.cos(s.lidAngle) * dt;
    s.lidVel *= Math.exp(-0.6 * dt);
    s.lidAngle += s.lidVel * dt;
    if (s.lidAngle <= 0) {
      s.lidAngle = 0;
      if (s.lidVel < -2.5 && game.time - s.lastSlam > 0.3) {
        s.lastSlam = game.time;
        const p = entityPos(e) ?? undefined;
        game.sfx('impact_metal', p, Math.min(1, -s.lidVel / 8), 0.7);
        game.get<any>('camera')?.shake(0.12);
      }
      s.lidVel = s.lidVel < -1.5 ? -s.lidVel * 0.22 : 0;
    } else if (s.lidAngle >= LID_MAX) {
      s.lidAngle = LID_MAX;
      if (s.lidVel > 2.5 && game.time - s.lastSlam > 0.3) {
        s.lastSlam = game.time;
        game.sfx('impact_metal', entityPos(e) ?? undefined, 0.5, 0.9);
      }
      s.lidVel = s.lidVel > 1.5 ? -s.lidVel * 0.2 : 0;
    }
    setLidPose(e, s);
  }
  // --- dive detection
  const pl = playerOf(game);
  if (!pl) return;
  const t = b.translation();
  const pp = pl.position as THREE.Vector3;
  const dx = pp.x - t.x;
  const dz = pp.z - t.z;
  if (dx * dx + dz * dz > 9) {
    s.playerInside = false;
    return;
  }
  _q.set(r.x, r.y, r.z, r.w).invert();
  const local = _p.set(dx, pp.y - t.y, dz).applyQuaternion(_q);
  const { W, H, D, T } = DUMPSTER;
  const inside = Math.abs(local.x) < W / 2 - T && Math.abs(local.z) < D / 2 - T && local.y < H / 2 - 0.05 && local.y > -H / 2 - 0.1;
  if (inside && !s.playerInside) {
    s.playerInside = true;
    dumpsterDive(game, e, s);
  } else if (!inside) s.playerInside = false;
}

/** Jimothy dove in (or landed on a plain dumpster prop): score + loot, with a per-dumpster cooldown. */
export function dumpsterDive(game: Game, e: Entity, s?: DumpsterState) {
  const now = game.time;
  const last = s ? s.lastDive : (e.data.lastDive ?? -99);
  const top = entityPos(e) ?? new THREE.Vector3();
  const size = (e.data.size as THREE.Vector3 | undefined) ?? new THREE.Vector3(2, 1.3, 1.2);
  top.y += size.y / 2;
  fxOf(game)?.emit('trash', top, { scale: 0.9 });
  game.sfx('rummage', top, 1);
  if (now - last < 15) {
    game.hint('Jimothy already picked this one clean. Come back later.', 2);
    return;
  }
  if (s) s.lastDive = now;
  else e.data.lastDive = now;
  game.events.emit('dumpsterDive', { entity: e });
  game.score(100, 'Dumpster Dive', top);
  fxOf(game)?.emit('stink', top, { duration: 3 });
  const n = 1 + Math.floor(Math.random() * 3);
  const b = e.body;
  for (let i = 0; i < n; i++) {
    after(game, 0.35 + i * 0.3, () => {
      if (!e.alive) return;
      const c = entityPos(e) ?? top;
      const p = new THREE.Vector3(c.x + rand(-0.4, 0.4), c.y + size.y / 2 + 0.35, c.z + rand(-0.2, 0.2));
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * rand(1.6, 2.6), rand(4.5, 6), Math.sin(a) * rand(1.6, 2.6));
      const kind = rollDumpsterLoot(game);
      spawnItemFlying(game, kind, p, v);
      game.sfx('boing', p, 0.5, rand(1.2, 1.5));
      if (kind === 'goldenTrophy') {
        game.score(500, 'Golden Garbage!', p);
        fxOf(game)?.emit('sparkles', p, { count: 30, radius: 0.6 });
        game.hint('A GOLDEN GARBAGE TROPHY. One raccoon’s trash is… also this raccoon’s treasure.', 4);
      }
    });
  }
  if (b) b.wakeUp();
}
