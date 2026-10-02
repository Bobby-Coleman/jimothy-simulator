import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import type { Entity } from '../../../core/Entities';
import { RAPIER, G, groups } from '../../../core/Physics';
import { spawnProp, destroyProp } from '../../../entities/Props';
import { spawnItem, makeExtraShiny } from '../../items';
import {
  type CaperFeature, addObjective, objProgress, toast, celebrate, prompt, fx, poi, groundY, findClearSpot, paintMesh, T,
  Timers, playerOf, rigOf, uiOf, hudShown, pick, damp, type Part,
} from '../shared';
import {
  Museum, F, WALL_TOP, HALF_W, HALF_D, WALL_A_Z, WALL_B_Z, DOOR_A, DOOR_B, VENT_Z, VENT_H, SKY_X, SKY_Z, PEDESTAL,
  GUARD_POST, DESK, LOOT,
} from './build';
import { LaserHall } from './lasers';
import { HeistHud } from './hud';

/**
 * THE SHINY JOB. The Ballard Museum of Extremely Shiny Things (waterfront lawn west of Pike's Plaice) is CLOSED FOR
 * GALA: the front doors are locked. Raccoon entrances: the vent on the south wall at raccoon height (bonk the grille
 * off) or the drainpipe on the north-east corner up to the open skylight over the lobby.
 * Inside: Night Guard Gus snoozes at his desk in the lobby (sprinting / chittering / bonking near him wakes him), a
 * laser hallway (hop, limbo-roll, wait, duck, dodge), and the vault: the Golden Trash Can Lid under glass on a
 * pressure-sensitive pedestal, plus shiny exhibits to pocket.
 * Lifting the Lid → ALARM: red lights, siren, the doors fly open, Gus gives chase and a 75 s timer starts: carry the
 * Lid to Mom's den. Caught by Gus → the Lid goes back on its pedestal (try again). Tripping a laser or waking Gus
 * early raises the alarm too (he chases you out; it calms down after a while).
 *
 * Objectives: heistShiny (complete it), heistGhost (complete it without any alarm before lifting the Lid),
 * heistGiftShop (pocket 5 exhibits), heistSpa (secret: wash the sleeping guard's face).
 * Events: 'heistAlarm' {cause}, 'heistComplete' {clean, timeLeft}, 'heistCaught' {withPrize}.
 * Test hooks (capers.byId.get('heist')): enter(), atVent(), triggerAlarm(cause?), grabPrize(), reset(), status().
 */

const ESCAPE_SECS = 75;
const GUARD_RUN = 5.4;
const DEN_RADIUS = 4.5;
const SITE = new THREE.Vector3(-18, 0, 122);
const SITE_YAW = Math.PI / 2; // front (local +z) faces east, toward the market promenade

const GUARD_SNORES = ['Zzz…', 'zzZZzz…', '*snort* …five more minutes…', 'Zzz… shiny… zzz…', 'mmh… no, YOU guard the lid…', 'Zzzzzz…'];
const GUARD_SPOT = ["HEY! THAT'S A RACCOON!", 'A RACCOON?! IN MY MUSEUM?!', "HEY! Is that… a very round raccoon?!"];
const GUARD_CHASE = ['Come back here!', 'Drop the lid, round boy!', "You can't roll away from justice!", 'I was on my BREAK!'];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _l = new THREE.Vector3();
const _l2 = new THREE.Vector3();

type GuardState = 'asleep' | 'waking' | 'chase' | 'return' | 'busy';

export class HeistFeature implements CaperFeature {
  readonly id = 'heist';
  museum: Museum | null = null;
  lasers: LaserHall | null = null;
  private timers: Timers;
  private hud = new HeistHud();
  // the prize
  prize: Entity | null = null;
  private prizeHome = new THREE.Vector3();
  private caseEnt: Entity | null = null;
  private caseMesh: THREE.Object3D | null = null;
  private grilleEnt: Entity | null = null;
  private grilleMesh: THREE.Object3D | null = null;
  // state
  alarm = false;
  alarmCause = '';
  private alarmAt = 0;
  prizeTaken = false;
  private deadline = 0;
  /** No alarm since this attempt started (Ghost Raccoon). */
  clean = true;
  private wasInside = false;
  inside = false;
  private resetting = false;
  // guard
  guard: any = null;
  guardState: GuardState = 'asleep';
  private guardT = 0;
  private snoreT = 2;
  private stirCd = 0;
  private passing: { room: number; to: THREE.Vector3; until: number } | null = null;
  private lostT = 0;
  // loot
  private loot: (Entity | null)[] = [];
  private restockT = 0;
  // misc
  private hintAt: Record<string, number> = {};
  private bannerShown = false;
  private sirenT = 0;
  private sirenHi = false;
  private evictT = 0;
  private denDisplay: THREE.Object3D | null = null;
  private wins = 0;

  constructor(private game: Game) {
    this.timers = new Timers(game);
  }

  init() {
    const game = this.game;
    addObjective(game, {
      id: 'heistShiny',
      category: 'raccoon',
      points: 4000,
      title: 'The Shiny Job',
      desc: "Steal the Golden Trash Can Lid from the Ballard Museum of Extremely Shiny Things (waterfront lawn, west of Pike's Plaice) and get it to Mom's den before time runs out.",
    });
    addObjective(game, {
      id: 'heistGhost',
      category: 'raccoon',
      points: 6000,
      title: 'Ghost Raccoon',
      desc: 'Pull off the museum heist without tripping a single laser or waking the guard before you lift the Lid.',
    });
    addObjective(game, {
      id: 'heistGiftShop',
      category: 'raccoon',
      points: 1500,
      target: 5,
      title: 'Gift Shop',
      desc: 'Pocket 5 shiny exhibits from the Ballard Museum. Everything in there is for sale if you believe hard enough.',
    });
    addObjective(game, {
      id: 'heistSpa',
      category: 'secret',
      points: 1500,
      hidden: true,
      title: 'Spa Night Security',
      desc: 'Washed the sleeping museum guard\'s face without waking him. He has never looked so refreshed.',
    });
    try {
      this.build();
    } catch (err) {
      console.warn('[capers] heist museum failed to build', err);
      return;
    }
    game.events.on('grab', (e: any) => this.onGrab(e?.entity));
    game.events.on('npcRagdoll', (e: any) => {
      if (this.guard && e?.entity === this.guard.entity) this.onGuardKnocked();
    });
    game.events.on('chitter', () => this.noise('chitter'));
    game.events.on('land', (e: any) => {
      if ((e?.height ?? 0) > 2.2) this.noise('land');
    });
  }

  // ============================================================================================ build
  private build() {
    const game = this.game;
    const half = new THREE.Vector3(10.6, 2.5, 8.6);
    // the open waterfront lawn west of the market (its diagonal path leads right up the steps)
    let spot: THREE.Vector3 | null = null;
    const y = groundY(game, SITE.x, SITE.z, 30);
    // footprint centre is 1.6 m in front of the local origin (steps); check around it
    const fc = new THREE.Vector3(SITE.x + 1.6 * Math.sin(SITE_YAW), y, SITE.z + 1.6 * Math.cos(SITE_YAW));
    const found = findClearSpot(game, fc, half, SITE_YAW, { maxR: 4, step: 1, fromY: y + 8 });
    if (found) spot = found.sub(_v.set(1.6 * Math.sin(SITE_YAW), 0, 1.6 * Math.cos(SITE_YAW)));
    if (!spot) {
      console.info('[capers] heist: no room for the museum; skipped');
      return;
    }
    const m = new Museum(game, spot, SITE_YAW);
    m.build();
    this.museum = m;
    const lasers = new LaserHall(m);
    lasers.build();
    this.lasers = lasers;
    this.buildCase();
    this.buildGrille();
    this.spawnPrize();
    this.spawnLoot();
    this.spawnGuard();
    const world = game.get<any>('world');
    world?.poi?.set('museumHeist', m.toWorld(0, 0, 11.5));
    world?.poi?.set('museumVent', m.toWorld(-HALF_W - 1.6, 0, (VENT_Z[0] + VENT_Z[1]) / 2));
    game.physics.refreshQueries();
    console.info(`[capers] heist museum at (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}), ${m.colliderCount} colliders`);
  }

  /** The glass case on the pedestal: 5 panes in one fixed body, bonk to shatter. */
  private buildCase() {
    const game = this.game;
    const m = this.museum!;
    const p = PEDESTAL;
    if (!this.caseMesh) {
      const g = new THREE.Group();
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(0.78, 0.66, 0.78),
        new THREE.MeshStandardMaterial({ color: 0xcfeaf5, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false }),
      );
      glass.position.y = 0.33;
      const edges: Part[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) edges.push({ g: new THREE.BoxGeometry(0.03, 0.66, 0.03), c: 0xc9a24a, m: T(sx * 0.39, 0.33, sz * 0.39) });
      for (const s of [-1, 1]) {
        edges.push({ g: new THREE.BoxGeometry(0.8, 0.03, 0.03), c: 0xc9a24a, m: T(0, 0.665, s * 0.39) });
        edges.push({ g: new THREE.BoxGeometry(0.03, 0.03, 0.8), c: 0xc9a24a, m: T(s * 0.39, 0.665, 0) });
      }
      g.add(glass, paintMesh(edges, false));
      g.position.set(p.x, p.y, p.z);
      m.root.add(g);
      this.caseMesh = g;
    }
    this.caseMesh.visible = true;
    const c = m.toWorld(p.x, p.y + 0.33, p.z);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.yaw);
    const body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    const grp = groups(G.PROP, G.ALL);
    const panes: [number, number, number, number, number, number][] = [
      [0.39, 0, 0, 0.02, 0.33, 0.39],
      [-0.39, 0, 0, 0.02, 0.33, 0.39],
      [0, 0, 0.39, 0.39, 0.33, 0.02],
      [0, 0, -0.39, 0.39, 0.33, 0.02],
      [0, 0.33, 0, 0.39, 0.02, 0.39],
    ];
    for (const [x, yy, z, hx, hy, hz] of panes) game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, yy, z).setCollisionGroups(grp), body);
    this.caseEnt = game.entities.create({
      kind: 'static',
      name: 'Display Case',
      body,
      mass: 500,
      tags: new Set(['noclimb']),
      onBonk: () => {
        this.timers.after(0, () => this.breakCase());
        return true;
      },
    });
  }

  private breakCase() {
    const game = this.game;
    const e = this.caseEnt;
    if (!e || !this.museum) return;
    this.caseEnt = null;
    const body = e.body;
    game.entities.remove(e);
    if (body) game.physics.removeBody(body);
    if (this.caseMesh) this.caseMesh.visible = false;
    const p = this.museum.toWorld(PEDESTAL.x, PEDESTAL.y + 0.35, PEDESTAL.z);
    game.sfx('glass_break', p, 0.9);
    fx(game, 'sparkles', p, { count: 22, color: 0xcfeaf5, radius: 0.6 });
    game.score(150, 'Smash & Grab (mostly smash)', p);
    game.hint('The glass is gone! {grab} Grab the Golden Trash Can Lid… that pedestal looks pressure-sensitive.', 4);
  }

  /** The vent grille: a fixed plate in the vent opening; bonk it off. */
  private buildGrille() {
    const game = this.game;
    const m = this.museum!;
    const vz = (VENT_Z[0] + VENT_Z[1]) / 2;
    const vw = VENT_Z[1] - VENT_Z[0];
    if (!this.grilleMesh) {
      this.grilleMesh = this.grilleObject(vw);
      this.grilleMesh.rotation.y = Math.PI / 2;
      this.grilleMesh.position.set(-HALF_W - 0.12, F + VENT_H / 2, vz);
      m.root.add(this.grilleMesh);
    }
    this.grilleMesh.visible = true;
    const c = m.toWorld(-HALF_W - 0.12, F + VENT_H / 2, vz);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.yaw);
    const body = game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.04, VENT_H / 2, vw / 2).setCollisionGroups(groups(G.PROP, G.ALL)), body);
    this.grilleEnt = game.entities.create({
      kind: 'static',
      name: 'Vent Grille',
      body,
      mass: 200,
      tags: new Set(['noclimb']),
      onBonk: () => {
        this.timers.after(0, () => this.popGrille());
        return true;
      },
    });
  }

  private grilleObject(vw: number): THREE.Object3D {
    const parts: Part[] = [{ g: new THREE.BoxGeometry(vw, VENT_H, 0.03), c: 0x7d848e }];
    for (let k = 0; k < 6; k++) parts.push({ g: new THREE.BoxGeometry(vw - 0.08, 0.05, 0.06), c: 0x5b616a, m: T(0, -VENT_H / 2 + 0.12 + k * 0.15, 0.02) });
    const g = new THREE.Group();
    g.add(paintMesh(parts));
    return g;
  }

  private popGrille() {
    const game = this.game;
    const e = this.grilleEnt;
    if (!e || !this.museum) return;
    this.grilleEnt = null;
    const body = e.body;
    game.entities.remove(e);
    if (body) game.physics.removeBody(body);
    if (this.grilleMesh) this.grilleMesh.visible = false;
    const vz = (VENT_Z[0] + VENT_Z[1]) / 2;
    const at = this.museum.toWorld(-HALF_W - 0.7, 0, vz);
    at.y = groundY(game, at.x, at.z, 3);
    const out = spawnProp(game, { name: 'Vent Grille', object: this.grilleObject(VENT_Z[1] - VENT_Z[0]), shape: 'box', mass: 3, tags: ['grabbable', 'washable'], sleeping: false }, at, this.museum.wyaw(Math.PI / 2));
    out.body?.setLinvel({ x: -Math.sin(this.museum.yaw + Math.PI / 2) * 2, y: 2.5, z: -Math.cos(this.museum.yaw + Math.PI / 2) * 2 }, true);
    game.sfx('impact_metal', at, 0.8);
    game.hint('The grille clattered off! Squeeze through the vent, you magnificent round boy.', 3.5);
    this.hintAt.vent = game.time + 999;
  }

  private prizeObject(): THREE.Object3D {
    const gold = new THREE.MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.9, roughness: 0.18, emissive: 0x6b4a10, emissiveIntensity: 0.35 });
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.32), gold);
    dome.scale.y = 0.75;
    dome.position.y = -0.09;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.022, 8, 28), gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.01;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 16, Math.PI), gold);
    handle.position.y = 0.13;
    g.add(dome, rim, handle);
    return g;
  }

  private spawnPrize() {
    const game = this.game;
    const m = this.museum!;
    this.prizeHome = m.toWorld(PEDESTAL.x, PEDESTAL.y, PEDESTAL.z);
    let ent!: Entity;
    ent = spawnProp(
      game,
      {
        name: 'The Golden Trash Can Lid',
        object: this.prizeObject(),
        shape: 'cylinder',
        mass: 3,
        tags: ['grabbable', 'washable', 'keep', 'heistPrize'],
        data: { grabLabel: 'Grab the Golden Trash Can Lid', heistPrize: true },
        onGrab: () => {
          if (this.caseEnt) {
            game.hint("It's under glass. {bonk} Bonk the display case first!", 2.5);
            return false;
          }
          return undefined;
        },
        onWash: () => {
          game.score(100, 'Polished the Lid', this.prize?.object?.position);
          game.sfx('sparkle', this.prize?.object?.position);
        },
      },
      this.prizeHome.clone(),
      m.yaw,
    );
    this.prize = ent;
  }

  private spawnLoot() {
    const m = this.museum!;
    for (let i = 0; i < LOOT.length; i++) this.loot[i] = this.spawnLootAt(i);
  }

  private spawnLootAt(i: number): Entity | null {
    const m = this.museum!;
    const [x, y, z, kind] = LOOT[i];
    try {
      const e = spawnItem(this.game, kind, m.toWorld(x, y, z), Math.random() * Math.PI * 2);
      if (kind !== 'vase') makeExtraShiny(e);
      e.data.heistLoot = true;
      e.data.heistSlot = i;
      e.tags.add('keep');
      e.name = `${e.name} (Exhibit)`;
      return e;
    } catch (err) {
      console.warn('[capers] heist loot spawn failed', kind, err);
      return null;
    }
  }

  private spawnGuard() {
    const game = this.game;
    const npcs = game.get<any>('npcs');
    const m = this.museum!;
    if (!npcs?.spawn) return;
    try {
      const pos = m.toWorld(GUARD_POST.x, GUARD_POST.y, GUARD_POST.z);
      this.guard = npcs.spawn({
        type: 'pedestrian',
        position: pos,
        name: 'Night Guard Gus',
        outfit: { top: 0x2a3550, topAccent: 0xdfe3ea, bottom: 0x23283a, hat: 'cap', hatColor: 0x2a3550, badge: true, tie: 0x1d1d2b, build: 1.25 },
        stationary: true,
        passive: true,
        holding: null,
        facing: m.wyaw(0),
        wander: { center: pos, radius: 0.1 },
        seed: 7171,
      });
      this.guard.setCustom(() => {});
      this.guard.onInteract = (kind: string) => this.onGuardInteract(kind);
      this.sleepPose();
    } catch (err) {
      console.warn('[capers] heist guard spawn failed', err);
    }
  }

  private sleepPose() {
    const g = this.guard;
    const m = this.museum;
    if (!g || !m || g.removed) return;
    g.stop?.();
    g.setExpression?.('neutral');
    g.gesture = 'none';
    g.lookAt?.(m.toWorld(DESK.x, F + 0.3, DESK.z - 0.1));
    this.guardState = 'asleep';
  }

  // ============================================================================================ queries
  private local(p: THREE.Vector3, out = _l) {
    return this.museum!.toLocal(p, out);
  }

  /** Inside the walls (below the roof). */
  isInsideLocal(l: THREE.Vector3) {
    return Math.abs(l.x) < HALF_W - 0.1 && Math.abs(l.z) < HALF_D - 0.1 && l.y < WALL_TOP - 0.1;
  }

  /** 0 outside, 1 lobby, 2 hallway, 3 vault. */
  private roomOf(l: THREE.Vector3) {
    if (Math.abs(l.x) > HALF_W || Math.abs(l.z) > HALF_D || l.y > WALL_TOP) return 0;
    if (l.z > WALL_A_Z) return 1;
    if (l.z > WALL_B_Z) return 2;
    return 3;
  }

  /** Door waypoints between room r and r+1: [point in room r, point in room r+1] (local). */
  private door(r: number): [THREE.Vector3, THREE.Vector3] {
    const ax = (DOOR_A[0] + DOOR_A[1]) / 2;
    const bx = (DOOR_B[0] + DOOR_B[1]) / 2;
    if (r === 0) return [new THREE.Vector3(0, F, 9.8), new THREE.Vector3(0, F, 6.0)];
    if (r === 1) return [new THREE.Vector3(ax, F, WALL_A_Z + 0.7), new THREE.Vector3(ax, F, WALL_A_Z - 0.75)];
    return [new THREE.Vector3(bx, F, WALL_B_Z + 0.7), new THREE.Vector3(bx, F, WALL_B_Z - 0.8)];
  }

  /** Next point (world) for the guard heading to `target` (world), routed through the doorways. */
  private navTarget(from: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
    const m = this.museum!;
    const fl = this.local(from, new THREE.Vector3());
    const tl = this.local(target, new THREE.Vector3());
    const fr = this.roomOf(fl);
    let tr = this.roomOf(tl);
    const onRoof = tl.y > WALL_TOP - 0.2 && Math.abs(tl.x) < HALF_W + 0.5 && Math.abs(tl.z) < HALF_D + 0.5;
    if (onRoof) tr = 0;
    if (this.passing && (this.passing.room !== fr || this.game.time > this.passing.until)) this.passing = null;
    if (this.passing) return m.toWorld(this.passing.to.x, this.passing.to.y, this.passing.to.z);
    if (fr === tr) {
      if (onRoof) return m.toWorld(0, F, 11);
      return target.clone();
    }
    const [a, b] = fr < tr ? this.door(fr) : this.door(fr - 1);
    const near = fr < tr ? a : b;
    const far = fr < tr ? b : a;
    if (Math.hypot(fl.x - near.x, fl.z - near.z) < 0.7) {
      this.passing = { room: fr, to: far, until: this.game.time + 3 };
      return m.toWorld(far.x, far.y, far.z);
    }
    return m.toWorld(near.x, near.y, near.z);
  }

  private prizeHeld() {
    const pl = playerOf(this.game);
    return !!this.prize && pl?.held?.entity === this.prize;
  }

  private prizePos(out = _w) {
    const t = this.prize?.body?.translation();
    return t ? out.set(t.x, t.y, t.z) : out.copy(this.prizeHome);
  }

  // ============================================================================================ events
  private onGrab(e: Entity | undefined) {
    if (!e || !this.museum) return;
    if (e === this.prize && !this.prizeTaken) this.takePrize();
    if (e.data?.heistLoot && !e.data.heistCounted) {
      e.data.heistCounted = true;
      e.tags.delete('keep');
      const n = this.loot.indexOf(e);
      if (n >= 0) this.loot[n] = null;
      objProgress(this.game, 'heistGiftShop');
      this.game.score(120, 'Gift Shop', e.object?.position);
      if (Math.random() < 0.5) this.game.hint(pick(['"Exhibit" is a strong word. "Snack" is stronger.', 'The museum will understand. Probably.', 'Into the pocket. Raccoons have pockets now.']), 2.2);
    }
  }

  private onGuardInteract(kind: string): boolean | void {
    const game = this.game;
    if (kind === 'wash' && this.guardState === 'asleep') {
      const g = this.guard;
      g.rig?.setExpression?.('happy', true);
      g.say('Zzz… mmh… lavender… zzz…', 2.6);
      game.events.emit('sparkle', { entity: g.entity, position: g.headPos(new THREE.Vector3()) });
      game.score(250, 'Spa Night', g.headPos(new THREE.Vector3()));
      objProgress(game, 'heistSpa');
      return true;
    }
    if (kind === 'chitter' && this.guardState === 'asleep') {
      this.noise('chitter');
      return true;
    }
    if (kind === 'grab' && this.guardState === 'asleep') {
      this.timers.after(0.1, () => this.triggerAlarm('guard'));
    }
    return undefined;
  }

  private onGuardKnocked() {
    if (this.guardState === 'asleep' || this.guardState === 'waking') {
      this.timers.after(0.2, () => this.triggerAlarm('guard'));
    } else if (this.guardState === 'chase') {
      this.guard?.say?.(pick(['OOF!', 'Not the face!', 'I bruise like a peach!']), 1.6);
    }
  }

  /** Loud stuff near the sleeping guard. */
  private noise(kind: 'chitter' | 'land' | 'sprint') {
    if (!this.guard || this.guardState !== 'asleep' || !this.museum) return;
    const pl = playerOf(this.game);
    if (!pl) return;
    const d = pl.position.distanceTo(this.guard.position);
    const r = kind === 'chitter' ? 6 : kind === 'land' ? 7 : 4.5;
    if (d > r) return;
    if (kind === 'land') {
      this.stir('Wha—? …zzz… just the wind… zzz…');
      return;
    }
    this.triggerAlarm(kind === 'chitter' ? 'chitter' : 'noise');
  }

  private stir(line: string) {
    if (this.stirCd > this.game.time) return;
    this.stirCd = this.game.time + 6;
    this.guard?.say?.(line, 2.4);
  }

  private takePrize() {
    const game = this.game;
    this.prizeTaken = true;
    this.deadline = game.time + ESCAPE_SECS;
    if (!this.alarm) this.triggerAlarm('prize');
    else {
      this.alarmCause = 'prize';
      this.museum?.openDoors();
    }
    celebrate(game, 'ALARM!', 'Get the Lid to Mom\'s den!', '#ff5a4a');
    game.hint(`RUN! Carry the Golden Trash Can Lid to Mom's den before the timer runs out. The front doors just flew open!`, 4.5);
    // a Wildlife Officer nearby comes to see what the fuss is about
    try {
      const npcs = game.get<any>('npcs');
      const o = npcs?.byType?.('officer')?.find((n: any) => !n.removed && !n.ragdolled && !n.isCustom && n.position.distanceTo(this.prizeHome) < 90);
      if (o && this.museum) {
        const steps = this.museum.toWorld(2.5, 0, 12);
        o.walkTo(steps, { run: true }).then((ok: boolean) => {
          if (ok && !o.removed) {
            o.say(this.prizeTaken ? 'Wildlife Officer! Is that raccoon carrying a… LID?!' : 'False alarm, folks. Probably.', 2.8);
            game.sfx('officer_whistle', o.position, 0.8);
          }
          o.release?.();
        });
      }
    } catch {
      /* optional */
    }
  }

  // ============================================================================================ alarm
  /** Raise the alarm (`cause`: laser | guard | noise | chitter | prize | test). */
  triggerAlarm(cause = 'test') {
    const game = this.game;
    if (!this.museum) return false;
    if (this.alarm) return true;
    this.alarm = true;
    this.alarmCause = cause;
    this.alarmAt = game.time;
    if (cause !== 'prize') this.clean = false;
    this.lasers && (this.lasers.armed = false);
    this.lasers?.setAlarm(true);
    this.museum.openDoors();
    const p = this.museum.toWorld(0, F + 3, 0);
    rigOf(game)?.shake(0.3);
    if (cause === 'laser') {
      celebrate(game, 'BEEP BEEP BEEP', 'You touched a laser.', '#ff5a4a');
      game.hint('You tripped a laser! The guard is awake. Get out (or grab the Lid anyway and RUN).', 4);
    } else if (cause !== 'prize') {
      celebrate(game, 'BUSTED-ISH', 'The guard is awake!', '#ff5a4a');
      game.hint('The guard woke up! Run, hide, or grab the Lid and make a break for it.', 4);
    }
    game.events.emit('heistAlarm', { cause, position: p });
    this.wakeGuard();
    return true;
  }

  private wakeGuard() {
    const g = this.guard;
    if (!g || g.removed) return;
    this.guardState = 'waking';
    g.lookAt?.('player');
    g.setExpression?.('shock');
    g.gesture = 'shock';
    g.say?.(pick(GUARD_SPOT), 2.4);
    this.timers.after(0.9, () => {
      if (this.guardState !== 'waking') return;
      this.guardState = 'chase';
      g.gesture = 'none';
      g.setExpression?.('angry');
      this.guardT = 0;
      this.lostT = 0;
    });
  }

  /** Back to normal: prize on the pedestal, glass restored, guard asleep, doors shut, lasers armed. */
  reset() {
    const game = this.game;
    if (!this.museum) return false;
    const pl = playerOf(game);
    if (this.prize && pl?.held?.entity === this.prize) pl.release(false);
    if (this.prize?.alive) destroyProp(game, this.prize);
    this.prize = null;
    this.spawnPrize();
    if (!this.caseEnt) this.buildCase();
    this.alarm = false;
    this.alarmCause = '';
    this.prizeTaken = false;
    this.resetting = false;
    this.passing = null;
    this.lasers && (this.lasers.armed = true);
    this.lasers?.setAlarm(false);
    this.museum.beaconMat.color.setRGB(0.35, 0.08, 0.08);
    this.tryCloseDoors();
    const g = this.guard;
    if (g && !g.removed) {
      if (g.ragdolled) g.getUp?.();
      g.teleport(this.museum.toWorld(GUARD_POST.x, GUARD_POST.y, GUARD_POST.z), this.museum.wyaw(0));
      this.sleepPose();
    }
    this.clean = !this.inside;
    this.hud.hide();
    return true;
  }

  private tryCloseDoors() {
    const m = this.museum!;
    const pl = playerOf(this.game);
    const l = pl ? this.local(pl.position, _l2) : null;
    if (l && Math.abs(l.x) < 2 && Math.abs(l.z - HALF_D) < 1.2) {
      this.timers.after(2, () => {
        if (!this.alarm) this.tryCloseDoors();
      });
      return;
    }
    m.closeDoors();
  }

  /** The guard got you. */
  private caught() {
    const game = this.game;
    const pl = playerOf(game);
    const g = this.guard;
    if (!pl || !this.museum || this.resetting) return;
    this.resetting = true;
    const withPrize = this.prizeTaken;
    this.guardState = 'busy';
    g?.stop?.();
    g?.lookAt?.('player');
    game.events.emit('heistCaught', { withPrize });
    if (withPrize) {
      if (this.prizeHeld()) pl.release(false);
      g?.say?.('GOTCHA! This goes BACK in the vault.', 2.6);
      g && (g.gesture = 'scold');
      const dir = _v.copy(pl.position).sub(g?.position ?? pl.position).setY(0);
      if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
      dir.normalize().multiplyScalar(30).setY(40);
      pl.ragdoll('heistCaught', 1.4, dir.clone());
      game.sfx('jingle_fail', pl.position, 0.8);
      celebrate(game, 'BUSTED!', 'Night Guard Gus took the Lid back.', '#ff5a4a');
      this.timers.after(1.8, () => {
        this.reset();
        toast(game, 'Busted!', 'The Golden Trash Can Lid is back on its pedestal. Try again: sneakier, rounder, faster.', '🚨');
      });
    } else {
      g?.say?.("Museum's CLOSED, little buddy. Out you go.", 2.6);
      g && (g.gesture = 'point');
      game.sfx('jingle_fail', pl.position, 0.6);
      this.timers.after(1.2, () => {
        if (!this.museum) return;
        if (pl.held?.entity?.data?.heistLoot) pl.release(false);
        const out = this.museum.toWorld(0, 0, 11.6);
        out.y = groundY(game, out.x, out.z, 4) + 0.45;
        pl.teleport(out, this.museum.wyaw(0));
        rigOf(game)?.snapBehind?.(this.museum.wyaw(0));
        this.reset();
        game.hint('Escorted out. The doors are locked again. There is always the vent…', 3.5);
      });
    }
  }

  private fail() {
    const game = this.game;
    if (this.resetting) return;
    this.resetting = true;
    const pl = playerOf(game);
    if (this.prizeHeld()) pl.release(false);
    game.sfx('sad_trombone', pl?.position, 0.7);
    celebrate(game, "TIME'S UP", 'Museum security found the Lid.', '#ff5a4a');
    this.timers.after(1.5, () => {
      this.reset();
      toast(game, "Time's up!", 'The Golden Trash Can Lid has been returned to its pedestal. The guard is back to "guarding".', '🚨');
    });
  }

  private success() {
    const game = this.game;
    const pl = playerOf(game);
    if (this.resetting || !this.museum) return;
    this.resetting = true;
    const left = Math.max(0, this.deadline - game.time);
    const clean = this.clean;
    this.wins++;
    const at = this.prizePos(new THREE.Vector3());
    if (this.prizeHeld()) pl.release(false);
    if (this.prize?.alive) destroyProp(game, this.prize);
    this.prize = null;
    celebrate(game, 'HEIST COMPLETE', clean ? 'Not a single beep. A ghost. A round ghost.' : 'The Golden Trash Can Lid is home!', '#f2c14e');
    game.sfx('crowd_cheer', at, 0.8);
    game.sfx('happy', at, 1);
    fx(game, 'sparkles', at.clone().setY(at.y + 0.6), { count: 40, color: 0xf2c14e, radius: 1.2 });
    game.score(Math.round(500 + left * 20), 'Heist Bonus', at.clone().setY(at.y + 1));
    objProgress(game, 'heistShiny');
    if (clean) objProgress(game, 'heistGhost');
    game.events.emit('heistComplete', { clean, timeLeft: left });
    this.showAtDen();
    this.timers.after(2.5, () =>
      toast(
        game,
        'THE BALLARD BUGLE',
        pick([
          'PRICELESS LID SWIPED FROM MUSEUM GALA. Suspect described as "extremely round." Mom: "He\'s a good boy."',
          'MUSEUM HEIST! Golden Trash Can Lid now on display "under a porch, somewhere." Gala cancelled; snacks eaten.',
          'GUARD "RESTED, ALERT" DURING HEIST, SOURCES SAY. Sources are the guard. Lid still missing.',
        ]),
        '📰',
      ),
    );
    // the museum quietly gets a "replica" back on the pedestal once nobody is looking
    this.alarm = false;
    this.prizeTaken = false;
    this.hud.hide();
    this.lasers?.setAlarm(false);
    this.museum.beaconMat.color.setRGB(0.35, 0.08, 0.08);
    this.guardState = 'return';
    this.guard?.say?.("I'm… not paid… enough for this…", 2.6);
    this.timers.after(1, () => {
      this.resetting = false;
    });
  }

  /** The Lid on a little crate stand by Mom's den (once). */
  private showAtDen() {
    const game = this.game;
    if (this.denDisplay) return;
    const den = poi(game, 'den', new THREE.Vector3(9, 0.4, 23));
    const cands = [[2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2], [2.2, 2.2], [-2.2, -2.2]];
    let at: THREE.Vector3 | null = null;
    for (const [dx, dz] of cands) {
      const p = new THREE.Vector3(den.x + dx, den.y, den.z + dz);
      p.y = groundY(game, p.x, p.z, den.y + 3);
      const ok = findClearSpot(game, p, new THREE.Vector3(0.3, 0.4, 0.3), 0, { maxR: 1, step: 0.5, fromY: p.y + 1.5 });
      if (ok) {
        at = ok;
        break;
      }
    }
    if (!at) return;
    const g = new THREE.Group();
    g.add(paintMesh([
      { g: new THREE.BoxGeometry(0.5, 0.36, 0.5), c: 0x2f6fb0, m: T(0, 0.18, 0) },
      { g: new THREE.BoxGeometry(0.42, 0.04, 0.42), c: 0xb3203a, m: T(0, 0.38, 0) },
    ]));
    const lid = this.prizeObject();
    lid.position.y = 0.48;
    lid.rotation.x = -0.35;
    g.add(lid);
    g.position.copy(at);
    game.scene.add(g);
    this.denDisplay = g;
  }

  // ============================================================================================ update
  update(dt: number) {
    const game = this.game;
    this.timers.tick();
    const m = this.museum;
    const pl = playerOf(game);
    if (!m || !pl) return;
    m.animateDoors(dt);
    const dist = pl.position.distanceTo(m.origin);
    const l = this.local(pl.position, new THREE.Vector3());
    this.inside = this.isInsideLocal(l);
    if (this.inside && !this.wasInside && !this.alarm && !this.prizeTaken) this.clean = true;
    this.wasInside = this.inside;
    if (dist < 70) {
      this.lasers?.update(dt);
      this.discover(l, dist);
    }
    // lasers
    if (this.inside && this.lasers?.armed && !this.alarm) {
      const k = this.lasers.hit(l, pl.mode === 'roll');
      if (k >= 0) {
        game.sfx('short_circuit', pl.position, 0.6);
        this.triggerAlarm('laser');
      }
    }
    // sleeping guard
    this.updateGuard(dt, pl, l);
    // the prize
    if (this.prize && !this.prize.alive) this.prize = null;
    if (this.prize && !this.prizeTaken && !this.resetting) {
      const p = this.prizePos();
      if (p.distanceTo(this.prizeHome) > 0.45) this.takePrize();
    }
    if (this.prizeTaken && !this.resetting) {
      if (this.prize) {
        const den = poi(game, 'den', new THREE.Vector3(9, 0.4, 23));
        const p = this.prizePos();
        if (Math.hypot(p.x - den.x, p.z - den.z) < DEN_RADIUS && Math.abs(p.y - den.y) < 4) this.success();
      }
      if (this.prizeTaken && game.time > this.deadline) this.fail();
    }
    // alarm without the prize calms down after a while if you got away
    if (this.alarm && !this.prizeTaken && !this.resetting) {
      const away = !this.inside && (!this.guard || this.guard.position.distanceTo(pl.position) > 18);
      if (game.time - this.alarmAt > 40 || (away && game.time - this.alarmAt > 12)) {
        this.alarm = false;
        this.lasers && (this.lasers.armed = true);
        this.lasers?.setAlarm(false);
        m.beaconMat.color.setRGB(0.35, 0.08, 0.08);
        this.tryCloseDoors();
        if (this.guardState === 'chase' || this.guardState === 'waking') {
          this.guardState = 'return';
          this.guard?.say?.('…must have been a big cat. Back to my, uh, post.', 2.6);
        }
        if (dist < 60) game.hint('The alarm stopped. The museum is "secure" again.', 2.5);
      }
    }
    // alarm lights + siren
    if (this.alarm) {
      const on = Math.floor(game.time * 3) % 2 === 0;
      m.beaconMat.color.setRGB(on ? 4 : 0.6, on ? 0.3 : 0.05, on ? 0.25 : 0.05);
      this.sirenT -= dt;
      if (this.sirenT <= 0 && dist < 90) {
        this.sirenT = 0.55;
        this.sirenHi = !this.sirenHi;
        game.sfx('car_horn', m.toWorld(0, F + 3.4, HALF_D), 0.32, this.sirenHi ? 1.55 : 1.18);
      }
    }
    // keep wandering pedestrians out of the building (they don't use vents)
    this.evictT -= dt;
    if (this.evictT <= 0 && dist < 80) {
      this.evictT = 1;
      this.evict();
    }
    // restock the exhibits when nobody is around
    this.restockT -= dt;
    if (this.restockT <= 0) {
      this.restockT = 5;
      if (dist > 70 && !this.alarm) this.restock();
    }
  }

  private discover(l: THREE.Vector3, dist: number) {
    const game = this.game;
    const pl = playerOf(game);
    if (!this.bannerShown && dist < 30 && !this.inside) {
      this.bannerShown = true;
      try {
        uiOf(game)?.banner?.('Ballard Museum', 'of Extremely Shiny Things', 'CLOSED FOR GALA');
      } catch {
        /* optional */
      }
    }
    if (this.inside || pl.mode === 'ragdoll') return;
    const vz = (VENT_Z[0] + VENT_Z[1]) / 2;
    const once = (key: string, text: string, secs = 4) => {
      if ((this.hintAt[key] ?? 0) > game.time) return;
      this.hintAt[key] = game.time + 45;
      game.hint(text, secs);
    };
    if (l.x < -HALF_W && l.x > -HALF_W - 2.6 && Math.abs(l.z - vz) < 1.8 && l.y < 1.6) {
      if (this.grilleEnt) {
        once('vent', 'A vent at exactly raccoon height! {bonk} Bonk the grille off and squeeze in.');
        prompt(game, '{bonk} Bonk the vent grille', 0.3);
      }
    } else if (l.x > HALF_W && l.x < HALF_W + 2.4 && Math.abs(l.z - 5.6) < 1.8 && l.y < 2) {
      once('pipe', 'A drainpipe! Hold {jump} and push into it to climb to the roof. Rumour has it the skylight is open.');
    } else if (Math.abs(l.x) < 2.2 && l.z > HALF_D && l.z < HALF_D + 3.5 && !this.alarm) {
      once('door', '"CLOSED FOR GALA". Locked. Good thing raccoons never use doors. Try the vent on the south wall, or the roof.', 4.5);
    } else if (l.y > WALL_TOP && l.x > SKY_X[0] - 2.5 && l.x < SKY_X[1] + 2.5 && l.z > SKY_Z[0] - 2.5 && l.z < SKY_Z[1] + 2.5) {
      once('sky', 'An open skylight! Drop in onto the Giant Bottle Cap. Quietly. The guard is right there.');
    }
  }

  private updateGuard(dt: number, pl: any, l: THREE.Vector3) {
    const game = this.game;
    const g = this.guard;
    const m = this.museum!;
    if (!g || g.removed) return;
    if (this.guardState === 'asleep') {
      this.snoreT -= dt;
      const d = pl.position.distanceTo(g.position);
      if (this.snoreT <= 0 && (this.inside ? d < 22 : d < 9)) {
        this.snoreT = 3.2 + Math.random() * 1.5;
        g.say?.(pick(GUARD_SNORES), 2.2);
      }
      if (this.inside && pl.speed > 6.5 && pl.mode !== 'roll' && d < 4.5) this.noise('sprint');
      else if (this.inside && pl.mode === 'roll' && pl.speed > 6 && d < 3) this.noise('sprint');
      else if (d < 1.4) this.stir('mmh… five more minutes… zzz…');
      return;
    }
    if (this.guardState === 'chase') {
      this.guardT -= dt;
      const target = this.prizeTaken && this.prize && !this.prizeHeld() ? this.prizePos(new THREE.Vector3()) : pl.position;
      const d = Math.hypot(target.x - g.position.x, target.z - g.position.z);
      if (this.guardT <= 0) {
        this.guardT = 0.2;
        if (d > 42) {
          this.lostT += 0.2;
          if (this.lostT > 1) {
            this.guardState = 'return';
            g.say?.(pick(["I'm… not paid… enough for this…", 'He rolls faster than I run. Noted.', 'Too… round… too… fast…']), 2.6);
            g.setExpression?.('sad');
          }
        } else {
          this.lostT = 0;
          const to = this.navTarget(g.position, target);
          g.walkTo(to, { speed: GUARD_RUN, arrive: 0.2 });
          if (Math.random() < 0.03) g.say?.(pick(GUARD_CHASE), 1.8);
        }
      }
      // caught?
      if (!g.ragdolled && !this.resetting) {
        if (target === pl.position) {
          if (d < 1.05 && Math.abs(pl.position.y - g.position.y - 0.4) < 1.3 && pl.mode !== 'ragdoll') this.caught();
        } else if (d < 0.9) {
          // he picked up the Lid you dropped
          this.resetting = true;
          g.say?.('And THIS goes back where it belongs.', 2.4);
          if (this.prize?.alive) destroyProp(game, this.prize);
          this.prize = null;
          celebrate(game, 'BUSTED!', 'Gus got the Lid back.', '#ff5a4a');
          this.timers.after(1.5, () => {
            this.reset();
            toast(game, 'Busted!', 'You dropped the Lid and the guard took it back. Hold on to it next time!', '🚨');
          });
        }
      }
      return;
    }
    if (this.guardState === 'return') {
      this.guardT -= dt;
      const post = m.toWorld(GUARD_POST.x, GUARD_POST.y, GUARD_POST.z);
      if (this.guardT <= 0) {
        this.guardT = 0.35;
        const gl = this.local(g.position, _l2);
        if (Math.hypot(gl.x - GUARD_POST.x, gl.z - GUARD_POST.z) < 0.5) {
          g.teleport(post, m.wyaw(0));
          this.sleepPose();
          return;
        }
        // nobody watching and far away: just be back at the desk
        if (g.position.distanceTo(game.camera.position) > 60 && !this.inside) {
          g.teleport(post, m.wyaw(0));
          this.sleepPose();
          return;
        }
        g.walkTo(this.navTarget(g.position, post), { speed: 1.6, arrive: 0.3 });
      }
      // spot Jimothy again while the alarm is still on
      if (this.alarm && pl.position.distanceTo(g.position) < 14) {
        this.guardState = 'chase';
        g.setExpression?.('angry');
        g.say?.('THERE you are!', 1.8);
      }
    }
  }

  private evict() {
    const npcs = this.game.get<any>('npcs');
    const m = this.museum!;
    if (!npcs?.near) return;
    const list = npcs.near(m.toWorld(0, 0, 0), 13) as any[];
    for (const n of list) {
      if (n === this.guard || n.removed || n.ragdolled) continue;
      const l = this.local(n.position, _l2);
      if (Math.abs(l.x) < HALF_W + 0.3 && Math.abs(l.z) < HALF_D + 0.3) {
        const out = m.toWorld((Math.random() - 0.5) * 6, 0, 12 + Math.random() * 2);
        n.teleport(out);
      }
    }
  }

  private restock() {
    for (let i = 0; i < LOOT.length; i++) {
      const e = this.loot[i];
      if (e && e.alive) continue;
      this.loot[i] = this.spawnLootAt(i);
    }
    if (!this.prize && !this.prizeTaken && !this.resetting) this.reset();
  }

  // ============================================================================================ camera / roof / HUD
  lateUpdate(dt: number) {
    const game = this.game;
    const m = this.museum;
    const pl = playerOf(game);
    if (!m || !pl) return;
    const dist = pl.position.distanceTo(m.origin);
    if (dist > 45 && !this.alarm) {
      this.hud.hide();
      if (!m.roof.visible) m.roof.visible = true;
      for (const w of m.walls) if (w.opacity < 1) this.setWallOpacity(w, 1);
      return;
    }
    const inside = this.inside;
    m.roof.visible = !inside;
    // fade the walls between the camera and Jimothy (only while he's inside or squeezing through the vent)
    const tl = this.local(rigOf(game)?.pivot ?? pl.position, new THREE.Vector3());
    const cl = this.local(game.camera.position, new THREE.Vector3());
    const ventSqueeze = tl.x < -HALF_W + 0.8 && tl.x > -HALF_W - 1.2 && tl.z > VENT_Z[0] - 0.3 && tl.z < VENT_Z[1] + 0.3 && tl.y < F + 1.2;
    const active = inside || ventSqueeze;
    for (const w of m.walls) {
      const want = active && this.crosses(cl, tl, w.a, w.b) ? 0 : 1;
      const op = damp(w.opacity, want, 10, dt);
      this.setWallOpacity(w, Math.abs(op - want) < 0.01 ? want : op);
    }
    // laser stations right at the camera would fill the screen: hide those
    if (this.lasers) {
      const [hz0, hz1] = [WALL_B_Z, WALL_A_Z];
      const inHall = cl.z > hz0 - 0.5 && cl.z < hz1 + 0.5;
      for (const s of this.lasers.stations) if (inHall && Math.abs(cl.x - s.x) < 1.0) s.group.visible = false;
    }
    // a slightly higher camera indoors so the rooms read from above
    const rig = rigOf(game);
    if (inside && rig && !rig.override && rig.pitch > -0.42) rig.pitch = damp(rig.pitch, -0.42, 2.5, dt);
    // HUD
    if (this.alarm && hudShown(game)) {
      const reduce = !!(rig as any)?.motionReduced;
      if (this.prizeTaken) this.hud.show("🚨 GET THE LID TO MOM'S DEN", Math.max(0, this.deadline - game.time), ESCAPE_SECS, reduce);
      else this.hud.show('🚨 ALARM! The guard is awake', null, 1, reduce);
    } else this.hud.hide();
  }

  private setWallOpacity(w: { mat: THREE.MeshStandardMaterial; glow: THREE.Mesh | null; opacity: number; mesh: THREE.Mesh; extras: THREE.Object3D[] }, op: number) {
    w.opacity = op;
    const transparent = op < 0.995;
    if (w.mat.transparent !== transparent) {
      w.mat.transparent = transparent;
      w.mat.depthWrite = !transparent;
      w.mat.needsUpdate = true;
    }
    w.mat.opacity = op;
    w.mesh.visible = op > 0.03;
    if (w.glow) w.glow.visible = op > 0.5;
    for (const e of w.extras) e.visible = op > 0.5;
  }

  /** Does the XZ segment camera→target cross (or graze) the wall segment a–b? */
  private crosses(c: THREE.Vector3, t: THREE.Vector3, a: THREE.Vector2, b: THREE.Vector2) {
    const horiz = Math.abs(a.y - b.y) < 1e-3; // runs along x
    if (horiz) {
      const w = a.y;
      const x0 = Math.min(a.x, b.x) - 0.3;
      const x1 = Math.max(a.x, b.x) + 0.3;
      if (Math.abs(c.z - w) < 0.35 && c.x > x0 && c.x < x1) return true;
      if ((c.z - w) * (t.z - w) >= 0) return false;
      const k = (w - c.z) / (t.z - c.z);
      const x = c.x + k * (t.x - c.x);
      return x > x0 && x < x1;
    }
    const w = a.x;
    const z0 = Math.min(a.y, b.y) - 0.3;
    const z1 = Math.max(a.y, b.y) + 0.3;
    if (Math.abs(c.x - w) < 0.35 && c.z > z0 && c.z < z1) return true;
    if ((c.x - w) * (t.x - w) >= 0) return false;
    const k = (w - c.x) / (t.x - c.x);
    const z = c.z + k * (t.z - c.z);
    return z > z0 && z < z1;
  }

  // ============================================================================================ test hooks
  /** Teleport Jimothy just inside the vent (lobby, west end), camera behind him. */
  enter() {
    const m = this.museum;
    const pl = playerOf(this.game);
    if (!m || !pl) return false;
    const vz = (VENT_Z[0] + VENT_Z[1]) / 2;
    pl.teleport(m.toWorld(-HALF_W + 1.0, F + 0.45, vz), m.wyaw(Math.PI / 2));
    rigOf(this.game)?.snapBehind?.(m.wyaw(Math.PI / 2));
    return true;
  }

  /** Teleport Jimothy outside the vent, facing it. */
  atVent() {
    const m = this.museum;
    const pl = playerOf(this.game);
    if (!m || !pl) return false;
    const vz = (VENT_Z[0] + VENT_Z[1]) / 2;
    const p = m.toWorld(-HALF_W - 2.0, 0, vz);
    p.y = groundY(this.game, p.x, p.z, 3) + 0.45;
    pl.teleport(p, m.wyaw(Math.PI / 2));
    rigOf(this.game)?.snapBehind?.(m.wyaw(Math.PI / 2));
    return true;
  }

  /** Stand at the pedestal, smash the glass and grab the Lid (the real grab path). */
  grabPrize() {
    const m = this.museum;
    const pl = playerOf(this.game);
    if (!m || !pl) return false;
    if (!this.prize) this.reset();
    if (this.caseEnt) this.breakCase();
    pl.teleport(m.toWorld(PEDESTAL.x, F + 0.45, PEDESTAL.z + 0.85), m.wyaw(Math.PI));
    rigOf(this.game)?.snapBehind?.(m.wyaw(Math.PI));
    (this.game as any).advance?.(0.1);
    pl.tryGrab?.();
    return this.prizeHeld();
  }

  status() {
    const pl = playerOf(this.game);
    return {
      built: !!this.museum,
      inside: this.inside,
      alarm: this.alarm,
      cause: this.alarmCause,
      prizeTaken: this.prizeTaken,
      held: this.prizeHeld(),
      timeLeft: this.prizeTaken ? +(this.deadline - this.game.time).toFixed(1) : null,
      guard: this.guardState,
      guardPos: this.guard ? this.local(this.guard.position, new THREE.Vector3()).toArray().map((v: number) => +v.toFixed(2)) : null,
      clean: this.clean,
      caseIntact: !!this.caseEnt,
      grille: !!this.grilleEnt,
      local: pl ? this.local(pl.position, new THREE.Vector3()).toArray().map((v: number) => +v.toFixed(2)) : null,
      wins: this.wins,
    };
  }
}
