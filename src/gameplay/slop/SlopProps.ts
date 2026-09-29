import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { RAPIER, G, groups } from '../../core/Physics';
import { destroyProp, spawnProp } from '../../entities/Props';
import { makeMeltMaterial } from './MeltMaterial';
import { drawKioskScreen, drawLabel, drawPosterReal, drawSpellPoster } from './SlopArt';
import type { SlopFx } from './SlopFx';
import { canvasTexture, findClearSpot, markOwned, pick, rand, say, worldOf } from './util';

const UP = new THREE.Vector3(0, 1, 0);

interface Poster {
  mat: THREE.ShaderMaterial;
  melt: number;
  target: number;
  entity: Entity;
  center: THREE.Vector3;
}

const KIOSK_LINES = [
  'Congratulations! You now own a receipt for a picture of a coin.',
  'Minted! Estimated value: vibes.',
  'Your token was added to the blockchain (a chain of blocks behind the kiosk).',
  'Thank you for your bonk. Please bonk again for utility.',
  'This NFT is 100% unique. Like the other 4,000.',
]

/**
 * Flavor slop around town: AI "Jimothy Casting Spells" posters on bus stops (washable — they melt into a
 * hand-drawn doodle), and NFT kiosks that dispense worthless shiny tokens when bonked.
 */
export class SlopProps {
  private posters: Poster[] = [];
  private tokens: Entity[] = [];
  private kiosks: Entity[] = [];
  private coinGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.03, 20).rotateX(Math.PI / 2);
  private coinMat = new THREE.MeshStandardMaterial({ color: 0xf3c043, metalness: 1, roughness: 0.22, emissive: new THREE.Color(0x3a2400), emissiveIntensity: 0.4 });
  private coinFace: THREE.MeshStandardMaterial;

  constructor(
    private game: Game,
    private fx: SlopFx,
  ) {
    this.coinFace = new THREE.MeshStandardMaterial({
      map: canvasTexture(128, 128, (c, w, h) => {
        const g = c.createRadialGradient(w * 0.4, h * 0.4, 4, w / 2, h / 2, w / 2);
        g.addColorStop(0, '#fff6b0');
        g.addColorStop(1, '#c98a12');
        c.fillStyle = g;
        c.beginPath();
        c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#7a5208';
        c.font = '900 44px "Lilita One", Impact, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('NFT', w / 2, h / 2 + 2);
      }),
      metalness: 0.9,
      roughness: 0.25,
    });
  }

  // ---------------------------------------------------------------- posters
  /** Put AI posters on bus stops (if the level has any), else on sidewalk A-frames around town. */
  placePosters(townSpots: THREE.Vector3[], max = 4) {
    const game = this.game;
    const world = worldOf(game);
    if (!world) return 0;
    const stops: THREE.Vector3[] = [];
    for (const [name, p] of world.poi) if (/bus/i.test(name)) stops.push(p.clone());
    world.staticRoot.traverse((o) => {
      if (stops.length >= 12) return;
      if (/bus.?stop|bus.?shelter|busstop/i.test(o.name)) stops.push(o.getWorldPosition(new THREE.Vector3()));
    });
    const spots = stops.length ? stops : townSpots;
    const used: THREE.Vector3[] = [];
    let made = 0;
    for (const s of spots.sort(() => Math.random() - 0.5)) {
      if (made >= max) break;
      const g = findClearSpot(game, s, stops.length ? 1.5 : 2, stops.length ? 4 : 12, 0.8, 0.4, 2.4, 20, used, 25);
      if (!g) continue;
      used.push(g);
      // face the map centre-ish so people walking by see it
      const yaw = Math.atan2(-g.x, -g.z) + rand(-0.5, 0.5);
      this.makePoster(g, yaw, made);
      made++;
    }
    return made;
  }

  private makePoster(ground: THREE.Vector3, yaw: number, variant: number) {
    const game = this.game;
    const world = worldOf(game)!;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const L = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(ground);
    const W = 1.3;
    const H = 1.9;
    const y0 = 0.35;
    const frame = world.material(0x2a2a33, { roughness: 0.5, metalness: 0.5 });
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, y0 + H + 0.1, 0.07), frame);
      leg.position.set(s * (W / 2 + 0.05), (y0 + H + 0.1) / 2, -0.03);
      g.add(leg);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, H + 0.12, 0.05), frame);
    back.position.set(0, y0 + H / 2, -0.04);
    g.add(back);
    const slopTex = canvasTexture(384, 560, (c, w, h) => drawSpellPoster(c, w, h, variant));
    const realTex = canvasTexture(384, 560, drawPosterReal);
    const mat = makeMeltMaterial(slopTex, realTex, 0.85);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    face.position.set(0, y0 + H / 2, 0.005);
    g.add(face);
    g.position.copy(ground);
    g.quaternion.copy(q);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    g.name = 'SlopPoster';
    world.staticRoot.add(markOwned(g));
    world.collider(L(0, (y0 + H) / 2, -0.03), new THREE.Vector3(W + 0.2, y0 + H, 0.1), yaw);
    // wash sensor in front of the poster (down to the ground: raccoons are short)
    const sc = L(0, (y0 + H) / 2, 0.35);
    const body = game.physics.createBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(sc.x, sc.y, sc.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      [RAPIER.ColliderDesc.cuboid(W / 2 + 0.1, (y0 + H) / 2, 0.35).setSensor(true).setCollisionGroups(groups(G.PROP, G.PLAYER))],
    );
    const poster: Poster = { mat, melt: 0, target: 0, center: L(0, y0 + H / 2, 0.1), entity: null as unknown as Entity };
    const self = this;
    poster.entity = game.entities.create({
      kind: 'static',
      name: 'AI Poster',
      body,
      object: face,
      mass: 1000,
      tags: new Set(['slop', 'poster']),
      data: { slopPoster: true },
      onWash(gm) {
        self.washPoster(gm, poster);
      },
      onBonk() {
        return true;
      },
    });
    this.posters.push(poster);
  }

  private washPoster(game: Game, p: Poster) {
    if (p.target >= 1) {
      game.score(5, 'Admired A Doodle', p.center.clone());
      return;
    }
    p.target = 1;
    game.score(150, 'Poster Unslopped', p.center.clone());
    game.sfx('scrub', p.center, 0.8);
    game.sfx('slop_glitch', p.center, 0.4, 1.2);
    this.fx.burst(p.center, 20, 0x7fd8ff, 1.5, 0, 0.9, 10, 0.5);
    game.events.emit('slopPosterWashed', { position: p.center.clone() });
  }

  // ---------------------------------------------------------------- NFT kiosks
  makeKiosk(ground: THREE.Vector3, yaw: number) {
    const game = this.game;
    const world = worldOf(game)!;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const L = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(ground);
    const g = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0x2b1d4f, roughness: 0.35, metalness: 0.4 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(0xff5fd0), emissiveIntensity: 1.6 });
    const bodyM = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.9), shell);
    bodyM.position.y = 1.15;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.25, 1.05), shell);
    top.position.y = 2.42;
    const led = new THREE.Mesh(new THREE.BoxGeometry(1.47, 0.06, 1.07), trim);
    led.position.y = 2.28;
    const screenTex = canvasTexture(512, 400, drawKioskScreen);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.82), new THREE.MeshStandardMaterial({ map: screenTex, emissive: new THREE.Color(0xffffff), emissiveMap: screenTex, emissiveIntensity: 0.9 }));
    screen.position.set(0, 1.65, 0.452);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.4, metalness: 0.6 }));
    tray.position.set(0, 0.55, 0.55);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.02), trim);
    slot.position.set(0, 1.1, 0.46);
    const headerTex = canvasTexture(512, 96, (c, w, h) => drawLabel(c, w, h, ['NFT KIOSK · BONK TO MINT'], { bg: '#120c24', accent: '#ff5fd0' }));
    const header = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.24), new THREE.MeshStandardMaterial({ map: headerTex, emissive: new THREE.Color(0xffffff), emissiveMap: headerTex, emissiveIntensity: 0.8 }));
    header.position.set(0, 2.42, 0.53);
    g.add(bodyM, top, led, screen, tray, slot, header);
    g.position.copy(ground);
    g.quaternion.copy(q);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    g.name = 'NftKiosk';
    world.staticRoot.add(markOwned(g));
    // solid + bonkable (PROP group on a fixed body)
    const c = L(0, 1.2, 0);
    const body = game.physics.createBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }), [
      RAPIER.ColliderDesc.cuboid(0.65, 1.2, 0.45).setCollisionGroups(groups(G.PROP)),
    ]);
    const self = this;
    let last = -10;
    const trayPos = L(0, 0.7, 0.75);
    const kiosk = game.entities.create({
      kind: 'static',
      name: 'NFT Kiosk',
      body,
      object: g,
      mass: 400,
      tags: new Set(['slop', 'kiosk']),
      data: { nftKiosk: true },
      onBonk(gm) {
        if (gm.time - last < 0.7) return true;
        last = gm.time;
        self.mint(gm, trayPos, q, kiosk);
        return true;
      },
    });
    this.kiosks.push(kiosk);
    return kiosk;
  }

  private mint(game: Game, at: THREE.Vector3, q: THREE.Quaternion, kiosk: Entity) {
    const coin = new THREE.Group();
    const rim = new THREE.Mesh(this.coinGeo, this.coinMat);
    const faceA = new THREE.Mesh(new THREE.CircleGeometry(0.125, 20), this.coinFace);
    faceA.position.z = 0.016;
    const faceB = faceA.clone();
    faceB.position.z = -0.016;
    faceB.rotation.y = Math.PI;
    coin.add(rim, faceA, faceB);
    const e = spawnProp(
      game,
      {
        name: 'Worthless NFT Token',
        object: coin,
        shape: 'box',
        size: new THREE.Vector3(0.26, 0.26, 0.05),
        mass: 0.15,
        restitution: 0.5,
        sleeping: false,
        tags: ['grabbable', 'shiny', 'nft', 'washable'],
        data: { nft: true, buoyancy: 0.5 },
        onWash(gm) {
          gm.score(25, 'Laundered An NFT', at.clone());
          gm.hint('It was a JPEG of a coin. Now it’s a wet JPEG of a coin.', 3);
          gm.sfx('sparkle', at, 0.5);
          gm.events.emit('nftWashed', {});
        },
      },
      at.clone().add(new THREE.Vector3(0, -0.1, 0)),
    );
    const out = new THREE.Vector3(rand(-0.6, 0.6), 1, 1.6).applyQuaternion(q);
    e.body!.setLinvel({ x: out.x * 2.2, y: 3.2, z: out.z * 2.2 }, true);
    e.body!.setAngvel({ x: rand(-8, 8), y: rand(-8, 8), z: rand(-8, 8) }, true);
    this.tokens.push(e);
    while (this.tokens.length > 12) {
      const old = this.tokens.shift()!;
      if (old.alive && !old.data.heldByPlayer) destroyProp(game, old);
    }
    this.tokens = this.tokens.filter((t) => t.alive);
    game.sfx('coins', at, 0.7);
    game.sfx('cha_ching', at, 0.4, 1.3);
    this.fx.burst(at, 16, 0xffd23a, 3, 2, 0.7, 9, 0.1);
    say(game, kiosk, pick(KIOSK_LINES), 3);
    game.score(20, 'Minted A Worthless NFT', at.clone());
    game.events.emit('nftMinted', { entity: e });
  }

  /** SlopCorp pivots: posters get re-slopped. */
  reslop() {
    for (const p of this.posters) p.target = 0;
  }

  update(dt: number) {
    const now = this.game.time;
    for (const p of this.posters) {
      p.melt += THREE.MathUtils.clamp(p.target - p.melt, -0.3 * dt, 0.55 * dt);
      p.mat.uniforms.uMelt.value = p.melt;
      p.mat.uniforms.uTime.value = now;
      p.mat.uniforms.uGlitch.value = p.melt < 0.01 && Math.sin(now * 2.3 + p.center.x) > 0.95 ? 1 : 0;
    }
  }

  kioskSpot(center: THREE.Vector3, rMin: number, rMax: number, avoid: THREE.Vector3[] = []) {
    const g = findClearSpot(this.game, center, rMin, rMax, 1.2, 1.0, 2.6, 30, avoid, 8);
    if (!g) return null;
    return { ground: g, yaw: Math.atan2(center.x - g.x, center.z - g.z) };
  }
}
