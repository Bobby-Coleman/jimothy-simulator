import * as THREE from 'three';
import type { Game, System } from '../../core/Game';
import { G, groups } from '../../core/Physics';
import type { ObjectivesSystem, ObjectiveDef } from '../Objectives';
import type { Jimothy } from '../../player/Jimothy';
import { slopTime } from './SlopMaterial';
import { loadSlopothyModel } from './SlopGeometry';
import { SlopothyManager, type Slopothy } from './Slopothys';
import { SlopDragon } from './SlopDragon';
import { SlopBillboard } from './Billboard';
import { PowerDimmer, ServerPlug } from './ServerPlug';
import { PromptPortal } from './PromptPortal';
import { SlopProps } from './SlopProps';
import { SlopFx } from './SlopFx';
import { drawPadDecal, loadSlopFonts } from './SlopArt';
import { TECHBRO_PIVOT, TECHBRO_UNPLUGGED } from './lines';
import { canvasTexture, findClearSpot, findNpcs, markOwned, pick, poi, rand, randInt, say, surfaceY, terrainY, Timeline, toast, worldOf } from './util';

/** Objective ids the objectives agent is expected to use (we add them ourselves if they're missing). */
const OBJECTIVES: ObjectiveDef[] = [
  {
    id: 'wash_away_the_slop',
    title: 'Wash Away The Slop',
    desc: 'Wash 10 Slopothys. They were never real. Neither was their LinkedIn.',
    category: 'slop',
    points: 600,
    target: 10,
  },
  {
    id: 'touch_grass',
    title: 'Touch Grass',
    desc: 'Pull SlopCorp’s giant power plug. The internet gets 4% less weird.',
    category: 'slop',
    points: 1000,
  },
  {
    id: 'hallucination',
    title: 'Hallucination',
    desc: 'Ride the Slop Dragon: the only AI clip that was actually real.',
    category: 'slop',
    points: 750,
  },
  {
    id: 'human_made',
    title: 'Human Made',
    desc: 'Wash the six-fingered AI billboard until something real shows up.',
    category: 'slop',
    points: 600,
  },
];

/**
 * All the AI-slop content: Slopothys (fake Jimothys), the Slop Dragon, the washable AI billboard, the giant
 * server plug ("Touch Grass"), the Prompt Portal, AI posters + NFT kiosks, and the SlopBot burst.
 *
 * Emits: 'speech' {entity,text}, 'slopDissolve' {position}, 'slopWashed' {count:1,total}, 'slopSpawned',
 * 'rodeSlopDragon', 'billboardWashed', 'serverUnplugged', 'questComplete' {id:'unplug'}, 'serverReplugged',
 * 'slopPosterWashed', 'nftMinted', 'slopBonked', 'slopCheered'.
 *
 * Debug from the console: jimothy.get('slop').spawnAt(x, z) / .unplugNow() / .replugNow() / .rideDragon() /
 * .washBillboard() / .slopBot()
 */
export class SlopSystem implements System {
  name = 'slop';
  game!: Game;
  timeline!: Timeline;
  fx!: SlopFx;
  slopothys!: SlopothyManager;
  dragon: SlopDragon | null = null;
  billboard: SlopBillboard | null = null;
  plug: ServerPlug | null = null;
  portal: PromptPortal | null = null;
  props: SlopProps | null = null;
  dimmer: PowerDimmer | null = null;
  unplugged = false;
  unplugCount = 0;
  replugAt = 0;
  /** Seconds SlopCorp stays unplugged before it "pivots" and plugs back in. */
  pivotDelay = 180;
  readonly campus = new THREE.Vector3(-120, 0, -120);
  readonly dataCenter = new THREE.Vector3();
  private dataCenterFound = false;
  private nextWave = 0;
  private objectivesChecked = false;
  readonly ownObjectives = new Set<string>();
  private portalHintAt = -999;
  private ready = false;

  async init(game: Game) {
    this.game = game;
    this.timeline = new Timeline(game);
    this.fx = new SlopFx(game.scene);
    this.slopothys = new SlopothyManager(game, this.timeline);
    this.slopothys.init();
    await loadSlopFonts();
    try {
      this.slopothys.model = await loadSlopothyModel(game);
    } catch (err) {
      console.error('[slop] no slopothy model', err);
    }
    this.buildCampus();
    try {
      this.spawnInitial();
    } catch (err) {
      console.error('[slop] initial spawn failed', err);
    }
    game.events.on('slopbotGenerate', () => this.slopBot());
    game.events.on('slopbotDismissed', () => {
      const tiny = this.slopothys.alive().filter((s) => s.role === 'tiny');
      if (tiny.length) this.slopothys.talk(pick(tiny), 'SlopBot was my mentor.', true);
    });
    this.nextWave = rand(25, 35);
    this.ready = true;
  }

  // ---------------------------------------------------------------- campus layout
  private buildCampus() {
    const game = this.game;
    const spawner = poi(game, 'slopSpawner', -106, -110);
    const dc = poi(game, 'dataCenter', -140, -132);
    const bb = poi(game, 'slopBillboard', -96, -148);
    const sp = poi(game, 'serverPlug', -126, -104);
    const found = [spawner, dc, bb, sp].filter((p) => p.found).map((p) => p.pos);
    if (found.length >= 2) {
      this.campus.set(0, 0, 0);
      for (const p of found) this.campus.add(p);
      this.campus.divideScalar(found.length);
    }
    this.campus.y = terrainY(game, this.campus.x, this.campus.z);
    this.slopothys.campusCenter.copy(this.campus);
    this.dataCenter.copy(dc.pos);
    this.dataCenterFound = dc.found;
    const avoid: THREE.Vector3[] = [];
    const clear = (p: { pos: THREE.Vector3; found: boolean }, hx: number, hz: number, h: number, r = 18) =>
      p.found ? p.pos.clone() : (findClearSpot(game, p.pos, 0, r, hx, hz, h, 50, avoid, 10) ?? p.pos.clone());

    // Prompt Portal
    try {
      const at = clear(spawner, 2.8, 1.2, 5.5);
      const face = new THREE.Vector3(this.campus.x - at.x, 0, this.campus.z - at.z);
      if (face.lengthSq() < 9) face.set(-at.x, 0, -at.z);
      this.portal = new PromptPortal(game, this.fx, at, face.normalize());
      this.slopothys.portal = this.portal.spawnPoint();
      avoid.push(at);
    } catch (err) {
      console.error('[slop] portal failed', err);
    }
    // Server plug + transformer
    try {
      const at = clear(sp, 2.2, 3.2, 3.5);
      let face = new THREE.Vector3(at.x - dc.pos.x, 0, at.z - dc.pos.z);
      if (face.lengthSq() < 1) face = new THREE.Vector3(this.campus.x - at.x, 0, this.campus.z - at.z);
      if (face.lengthSq() < 1) face.set(0, 0, 1);
      this.plug = new ServerPlug(game, this.fx, at, face.normalize(), () => this.onUnplugged());
      avoid.push(at);
    } catch (err) {
      console.error('[slop] server plug failed', err);
    }
    this.dimmer = new PowerDimmer(game, this.dataCenterFound ? this.dataCenter : this.campus, this.dataCenterFound ? 45 : 60);
    // Billboard
    try {
      const at = bb.found ? bb.pos : clear(bb, 7, 2.5, 12, 25);
      this.billboard = new SlopBillboard(game, this.fx, this.timeline, at, bb.found, this.campus);
      avoid.push(at);
    } catch (err) {
      console.error('[slop] billboard failed', err);
    }
    // Dragon pad + dragon
    try {
      const pad = findClearSpot(game, this.campus, 10, 48, 5.5, 5.5, 9, 80, avoid, 14) ?? findClearSpot(game, this.campus, 30, 70, 5, 5, 8, 60) ?? this.campus.clone().add(new THREE.Vector3(22, 0, 22));
      pad.y = terrainY(game, pad.x, pad.z);
      this.buildPad(pad);
      avoid.push(pad);
      this.dragon = new SlopDragon(game, this.timeline, this.campus, pad.clone().add(new THREE.Vector3(0, 0.12, 0)));
      if (this.billboard) this.dragon.swoopTargets.push(this.billboard.catwalkPoint.clone());
      if (this.dataCenterFound) {
        const roof = surfaceY(game, this.dataCenter.x, this.dataCenter.z, terrainY(game, this.dataCenter.x, this.dataCenter.z) + 120);
        if (roof > terrainY(game, this.dataCenter.x, this.dataCenter.z) + 3) this.dragon.swoopTargets.push(new THREE.Vector3(this.dataCenter.x, roof + 0.4, this.dataCenter.z));
      }
    } catch (err) {
      console.error('[slop] dragon failed', err);
    }
    // Flavor props
    try {
      this.props = new SlopProps(game, this.fx);
      const k1 = this.props.kioskSpot(this.portal ? this.portal.center.clone().setY(this.campus.y) : this.campus, 6, 16, avoid);
      if (k1) {
        this.props.makeKiosk(k1.ground, k1.yaw);
        avoid.push(k1.ground);
      }
      const town = this.slopothys.townSpots().filter((p) => p.distanceTo(this.campus) > 60);
      const central = town.sort((a, b) => a.length() - b.length())[0] ?? new THREE.Vector3(6, 0, -10);
      const k2 = this.props.kioskSpot(central, 3, 20);
      if (k2) this.props.makeKiosk(k2.ground, k2.yaw);
      this.props.placePosters(town, 4);
    } catch (err) {
      console.error('[slop] props failed', err);
    }
  }

  private buildPad(p: THREE.Vector3) {
    const world = worldOf(this.game)!;
    const concrete = world.material(0x8d8f93, { roughness: 0.9 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.4, 0.24, 40), concrete);
    pad.position.set(p.x, p.y + 0.02, p.z);
    pad.receiveShadow = true;
    world.staticRoot.add(markOwned(pad));
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(9.4, 9.4).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: canvasTexture(512, 512, drawPadDecal), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    decal.position.set(p.x, p.y + 0.15, p.z);
    decal.receiveShadow = true;
    world.staticRoot.add(markOwned(decal));
    world.collider(new THREE.Vector3(p.x, p.y + 0.02, p.z), new THREE.Vector3(9.6, 0.24, 9.6));
    // four little runway lights
    const lamp = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(0xffc23a), emissiveIntensity: 2 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lamp);
      l.position.set(p.x + Math.cos(a) * 5.0, p.y + 0.2, p.z + Math.sin(a) * 5.0);
      world.staticRoot.add(markOwned(l));
    }
  }

  private spawnInitial() {
    const m = this.slopothys;
    if (!m.model) return;
    if (this.portal) m.spawnCampus(2, this.portal.spawnPoint());
    else m.spawnCampus(2, this.campus);
    m.spawnRoamers(4);
  }

  // ---------------------------------------------------------------- SlopBot
  slopBot() {
    const p = this.game.get<Jimothy>('player');
    if (!p) return 0;
    const n = this.slopothys.spawnTinyBurst(p.position.clone(), 12);
    this.game.hint('Generating 12 raccoons… 11 of them are wrong.', 3.5);
    this.game.sfx('slop_glitch', p.position, 0.9, 1.2);
    this.fx.burst(p.position, 50, 0x7df9ff, 5, 3, 0.8, 8, 1);
    return n;
  }

  // ---------------------------------------------------------------- unplug / pivot
  private onUnplugged() {
    const game = this.game;
    this.unplugged = true;
    this.unplugCount++;
    const first = this.unplugCount === 1;
    const pos = this.plug ? this.plug.socketMouth.clone() : this.campus.clone();
    game.events.emit('serverUnplugged', { position: pos, count: this.unplugCount });
    game.events.emit('questComplete', { id: 'unplug' });
    game.score(first ? 1000 : 250, first ? 'Touch Grass' : 'Unplugged SlopCorp Again', pos);
    const tl = this.timeline;
    tl.later(0.3, () => {
      this.dimmer?.switchOff();
      this.plug?.setAlarm(true);
      game.sfx('slop_glitch', pos, 1, 0.6);
    });
    tl.later(0.8, () => {
      game.hint('⚠ SLOP GENERATION HALTED ⚠', 4);
      toast(game, 'SLOP GENERATION HALTED', 'SlopCorp servers offline. All generated raccoons are being… un-generated.', 'warning');
      game.sfx('jingle_fail');
    });
    for (let i = 0; i < 30; i++) tl.later(1 + i * 0.22 + rand(0, 0.1), () => this.serverSpark());
    tl.later(1.5, () => this.slopothys.dissolveAll('unplug', 0.3));
    tl.later(2.2, () => this.portal?.setOpen(false));
    tl.later(3.2, () => this.techbrosSay(TECHBRO_UNPLUGGED, true));
    tl.later(5.5, () => toast(game, 'Touch Grass', 'SlopCorp unplugged. The internet is 4% less weird.', 'grass'));
    tl.later(10, () => this.plug?.setAlarm(false));
    this.replugAt = game.time + this.pivotDelay;
  }

  private replug() {
    const game = this.game;
    this.unplugged = false;
    this.plug?.replug();
    this.dimmer?.switchOn();
    this.portal?.setOpen(true);
    const p = game.get<Jimothy>('player');
    const far = (v: THREE.Vector3 | undefined) => !p || !v || p.position.distanceTo(v) > 40;
    if (far(this.billboard?.catwalkPoint)) this.billboard?.reslop();
    this.props?.reslop();
    toast(game, 'SlopCorp Has Pivoted', 'They plugged it back in. “We’re an AI-first raccoon company now.” Slop generation resumed.', 'slop');
    this.techbrosSay(TECHBRO_PIVOT, false);
    this.nextWave = game.time + 2;
    game.events.emit('serverReplugged', {});
  }

  private techbrosSay(lines: string[], fallbackHint: boolean) {
    const game = this.game;
    const bros = findNpcs(game, this.campus, 110, 'techbro').slice(0, 5);
    if (!bros.length) {
      const p = game.get<Jimothy>('player');
      if (fallbackHint && p && p.position.distanceTo(this.campus) < 90) game.hint(`Somewhere on campus, a tech bro whispers: “${lines[0]}”`, 4);
      return;
    }
    bros.forEach((b, i) => this.timeline.later(i * 0.9, () => say(game, b, i === 0 ? lines[0] : pick(lines), 3.5)));
  }

  private serverSpark() {
    const game = this.game;
    let p: THREE.Vector3 | null = null;
    if (this.dataCenterFound) {
      const c = this.dataCenter;
      const a = Math.random() * Math.PI * 2;
      const gy = terrainY(game, c.x, c.z);
      const h = rand(1, 7);
      const from = new THREE.Vector3(c.x + Math.cos(a) * 30, gy + h, c.z + Math.sin(a) * 30);
      const dir = new THREE.Vector3(c.x, gy + h, c.z).sub(from);
      const hit = game.physics.raycast(from, dir, 32, groups(G.ALL, G.WORLD));
      if (hit) p = hit.point.addScaledVector(hit.normal, 0.15);
    }
    if (!p && this.plug) p = this.plug.socketMouth.clone().add(new THREE.Vector3(rand(-1.4, 1.4), rand(0, 1.8), rand(-0.2, 0.4)));
    if (!p) return;
    this.fx.burst(p, randInt(12, 26), Math.random() < 0.6 ? 0xbff8ff : 0xffc040, 5, 2, 0.7);
    if (Math.random() < 0.5) game.sfx('short_circuit', p, 0.5);
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    if (!this.ready) return;
    const game = this.game;
    slopTime.value = game.time;
    this.timeline.run();
    this.slopothys.update(dt);
    this.dragon?.update(dt);
    this.plug?.update(dt);
    this.waves();
    if (this.unplugged && game.time > this.replugAt) this.replug();
    if (!this.objectivesChecked && game.time > 2) this.checkObjectives();
  }

  postPhysics(dt: number) {
    if (!this.ready) return;
    this.plug?.postPhysics();
    this.slopothys.animate(dt);
    this.billboard?.update(dt);
    this.portal?.update(dt);
    this.props?.update(dt);
    this.fx.update(dt);
  }

  private waves() {
    const game = this.game;
    const m = this.slopothys;
    if (this.unplugged || !m.model || game.time < this.nextWave) return;
    this.nextWave = game.time + rand(38, 55);
    const free = m.maxRegular - m.regularCount;
    if (free <= 0) return;
    const n = Math.min(randInt(2, 3), free);
    const at = this.portal ? this.portal.spawnPoint() : this.campus;
    this.portal?.flash();
    const made = m.spawnCampus(n, at, true);
    // too crowded on campus → the oldest wander off into town
    const campus = m.alive().filter((s) => s.role === 'campus').sort((a, b) => a.bornAt - b.bornAt);
    for (let i = 0; i < campus.length - 6; i++) campus[i].role = 'roamer';
    // keep a minimum population in town
    if (m.regularCount < 5) m.spawnRoamers(2);
    const p = game.get<Jimothy>('player');
    if (made && p && p.position.distanceTo(at) < 60 && game.time - this.portalHintAt > 120) {
      this.portalHintAt = game.time;
      game.hint(`The Prompt Portal generated ${made} new Jimothys. None of them are Jimothy.`, 3.5);
    }
  }

  private checkObjectives() {
    this.objectivesChecked = true;
    const obj = this.game.get<ObjectivesSystem>('objectives');
    if (!obj || typeof obj.add !== 'function') return;
    for (const d of OBJECTIVES) {
      if (!obj.get(d.id)) {
        obj.add(d);
        this.ownObjectives.add(d.id);
      }
    }
    if (!this.ownObjectives.size) return;
    const ev = this.game.events;
    const own = (id: string) => this.ownObjectives.has(id);
    if (own('wash_away_the_slop')) ev.on('slopWashed', (p: { count?: number }) => obj.progress('wash_away_the_slop', p?.count ?? 1));
    if (own('touch_grass')) ev.on('serverUnplugged', () => obj.complete('touch_grass'));
    if (own('hallucination')) ev.on('rodeSlopDragon', () => obj.complete('hallucination'));
    if (own('human_made')) ev.on('billboardWashed', () => obj.complete('human_made'));
  }

  // ---------------------------------------------------------------- debug helpers
  spawnAt(x: number, z: number, n = 1, role: 'campus' | 'roamer' | 'tiny' = 'roamer'): Slopothy[] {
    const out: Slopothy[] = [];
    for (let i = 0; i < n; i++) {
      const gx = x + (n > 1 ? rand(-2, 2) : 0);
      const gz = z + (n > 1 ? rand(-2, 2) : 0);
      const s = this.slopothys.spawn(new THREE.Vector3(gx, surfaceY(this.game, gx, gz), gz), { role, announce: true, home: new THREE.Vector3(gx, 0, gz) });
      if (s) out.push(s);
    }
    return out;
  }

  unplugNow() {
    this.plug?.forceUnplug();
  }

  replugNow() {
    if (this.unplugged) this.replug();
  }

  /** Land the dragon, put Jimothy next to it and hop on. */
  rideDragon() {
    const d = this.dragon;
    const p = this.game.get<Jimothy>('player');
    if (!d || !p) return false;
    d.landNow();
    const at = d.pos.clone().add(new THREE.Vector3(2.5, 0, 0));
    at.y = terrainY(this.game, at.x, at.z) + 0.6;
    p.teleport(at);
    p.attachTo(d.entity, d.saddleWorld(new THREE.Vector3()));
    return p.mode === 'hang';
  }

  washBillboard() {
    this.billboard?.entity.onWash?.(this.game);
  }
}
