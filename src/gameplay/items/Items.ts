import * as THREE from 'three';
import type { Game } from '../../core/Game';
import type { Entity } from '../../core/Entities';
import { spawnProp, destroyProp, type ColliderShape } from '../../entities/Props';
import { BUILD, brokenScreenMaterial, devaluedCardMaterial, teddyCleanMaterials, buildBow } from './models';
import { registry, after, fxOf, entityPos, releaseIfHeld, heldByPlayer, emoteState, playerOf, rand } from './shared';

/**
 * Items: small grabbable, washable props with charming procedural models and special wash reactions.
 *
 *   import { spawnItem } from '../gameplay/items';
 *   spawnItem(game, 'cottonCandy', new THREE.Vector3(x, groundY, z), rotY);
 *
 * Every wash emits `itemWashed { kind, entity, count }` and scores a named popup; washing the same
 * thing again gives diminishing returns (same rule as defaultWash in Jimothy.ts).
 * Tags follow the conventions other systems look for: teddy, fish, pizza, diploma, rookiecard, shiny,
 * grapes, slippery, cash, cottoncandy, food, trash, fragile, explosive, …  All items also get
 * `grabbable`, `washable` and `item`, and `entity.data.itemKind = kind`.
 */
export type ItemKind =
  | 'cottonCandy'
  | 'cash'
  | 'phone'
  | 'teddy'
  | 'fish'
  | 'soap'
  | 'rubberDuck'
  | 'pizza'
  | 'sandwich'
  | 'coffee'
  | 'iceCream'
  | 'diploma'
  | 'rookieCard'
  | 'spoon'
  | 'bottleCap'
  | 'key'
  | 'ring'
  | 'marble'
  | 'grapes'
  | 'bananaPeel'
  | 'sodaCan'
  | 'appleCore'
  | 'fishBones'
  | 'takeout'
  | 'newspaper'
  | 'goldenTrophy'
  | 'vase'
  | 'glassBottle'
  | 'tv'
  | 'glassPane'
  | 'propaneTank'
  | 'gasCan'
  | 'fireworksCrate';

interface WashSpec {
  points: number;
  label: string;
  /** Label for washes 2–3 (default "<label> Again"). */
  again?: string;
  /** First wash (after scoring). */
  react?: (game: Game, e: Entity) => void;
  /** Every later wash (n = wash count, 2+). */
  reactAgain?: (game: Game, e: Entity, n: number) => void;
  /** Skip the generic sparkle (item destroyed / has its own FX). */
  noSparkle?: boolean;
}

interface ItemDef {
  name: string;
  tags: string[];
  mass: number;
  shape?: ColliderShape;
  /** >1 floats (default 1.4), <1 sinks. */
  buoyancy?: number;
  friction?: number;
  restitution?: number;
  ccd?: boolean;
  data?: Record<string, any>;
  wash: WashSpec;
  onImpact?: (game: Game, e: Entity, other: Entity | undefined, strength: number) => void;
  onBonk?: (game: Game, e: Entity, impulse: THREE.Vector3, point: THREE.Vector3) => boolean | void;
}

// ------------------------------------------------------------------ reaction helpers
const _v = new THREE.Vector3();

function at(e: Entity) {
  return entityPos(e) ?? undefined;
}

/** Give an item its own material copies with the colour multiplied (wet / soggy / faded looks). */
export function tintItem(e: Entity, mul: THREE.ColorRepresentation | number, opts: { roughness?: number; metalness?: number } = {}) {
  const c = typeof mul === 'number' ? new THREE.Color(mul, mul, mul) : new THREE.Color(mul);
  e.object?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const conv = (mat: THREE.Material) => {
      const s = (mat as THREE.MeshStandardMaterial).clone();
      if (s.color) s.color.multiply(c);
      if (opts.roughness != null && 'roughness' in s) s.roughness = opts.roughness;
      if (opts.metalness != null && 'metalness' in s) s.metalness = opts.metalness;
      return s;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
}

/** Washed shiny things: mirror-polished, a little glow, and they twinkle (crows love these). */
export function makeExtraShiny(e: Entity) {
  e.data.extraShiny = true;
  e.tags.add('shiny');
  e.object?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const conv = (mat: THREE.Material) => {
      const s = (mat as THREE.MeshStandardMaterial).clone();
      if ('roughness' in s) s.roughness = Math.min(s.roughness, 0.06);
      if ('envMapIntensity' in s) s.envMapIntensity = 2.2;
      if (s.emissive && s.color) s.emissive.copy(s.color).multiplyScalar(0.12);
      return s;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
  registry.shiny.add(e);
}

function setScreen(e: Entity, mat: THREE.Material) {
  const s = e.object?.getObjectByName('screen') as THREE.Mesh | undefined;
  if (s) s.material = mat;
}

/** Short-circuit an electronic item: zap sparks, dead screen. */
function shortCircuit(game: Game, e: Entity, label: string, points: number) {
  if (!e.alive || e.data.broken) return;
  e.data.broken = true;
  const p = at(e);
  if (p) fxOf(game)?.emit('zap', p, { duration: 0.9 });
  game.sfx('short_circuit', p);
  if (points > 0) game.score(points, label, p);
  setScreen(e, brokenScreenMaterial());
  if (e.body && !heldByPlayer(game, e) && e.body.isDynamic()) e.body.applyImpulse({ x: 0, y: e.mass * 2.2, z: 0 }, true);
  game.events.emit('shortCircuit', { entity: e });
}

/** Animate something over `secs` via a temporary entity update hook (t goes 0 → 1). */
function animate(game: Game, e: Entity, secs: number, fn: (t: number) => void, done?: () => void) {
  const t0 = game.time;
  const prev = e.update;
  e.update = (g) => {
    const t = Math.min(1, (g.time - t0) / secs);
    fn(t);
    if (t >= 1) {
      e.update = prev;
      if (!prev) g.entities.setUpdatable(e, false);
      done?.();
    }
  };
  game.entities.setUpdatable(e, true);
}

/** Jimothy stares at his (now empty) paws for a moment. */
export function stareAtHands(game: Game, secs = 2.4) {
  const p = playerOf(game);
  if (!p) return;
  emoteState.kind = 'stare';
  emoteState.t0 = game.time;
  emoteState.until = game.time + secs;
  emoteState.froze = !p.frozen;
  if (emoteState.froze) p.frozen = true;
}

function squeak(game: Game, e: Entity, vol = 0.8) {
  if (game.time - (e.data.lastSqueak ?? -9) < 0.25) return;
  e.data.lastSqueak = game.time;
  const p = at(e);
  game.sfx('squeak', p, vol, rand(0.9, 1.25));
  if (p) fxOf(game)?.emit('notes', p.add(_v.set(0, 0.15, 0)), { count: 2 });
}

// ------------------------------------------------------------------ definitions
const DEFS: Record<ItemKind, ItemDef> = {
  cottonCandy: {
    name: 'Cotton Candy',
    tags: ['food', 'cottoncandy', 'sweet'],
    mass: 0.2,
    buoyancy: 2,
    wash: {
      points: 250,
      label: "Where'd It Go?",
      noSparkle: true,
      react(game, e) {
        const p = at(e);
        if (p) fxOf(game)?.emit('cottonPoof', p);
        releaseIfHeld(game, e);
        destroyProp(game, e);
        game.sfx('sad_trombone');
        game.hint('Jimothy washed the cotton candy. It is gone. He stares at his empty hands.', 4);
        game.events.emit('cottonCandyGone', { entity: e });
        stareAtHands(game, 2.4);
        after(game, 0.45, () => {
          const pl = playerOf(game);
          if (pl) fxOf(game)?.emit('question', new THREE.Vector3(pl.position.x, pl.position.y + 0.85, pl.position.z));
        });
      },
    },
  },
  cash: {
    name: 'Wad of Cash',
    tags: ['cash', 'money', 'paper', 'valuable'],
    mass: 0.3,
    buoyancy: 1.5,
    ccd: true,
    wash: {
      points: 300,
      label: 'Money Laundering',
      again: 'Extra Rinse Cycle',
      react(game, e) {
        const p = at(e);
        if (p) fxOf(game)?.emit('money', p);
        game.sfx('cha_ching', p);
        e.data.laundered = true;
        e.name = 'Laundered Cash';
        game.hint('Squeaky clean money. Totally legit now. (It is not.)', 3);
      },
    },
  },
  phone: {
    name: 'Smartphone',
    tags: ['phone', 'electronic'],
    mass: 0.3,
    buoyancy: 0.6,
    ccd: true,
    wash: {
      points: 60,
      label: 'Sparkly Clean Phone',
      again: 'Still Broken, Now Cleaner',
      react(game, e) {
        e.data.sparklyClean = true;
        const p = at(e);
        if (p) fxOf(game)?.emit('sparkles', p, { count: 18, radius: 0.35 });
        game.sfx('sparkle', p);
        after(game, 0.9, () => shortCircuit(game, e, 'Water Resistant (It Was Not)', 150));
      },
    },
  },
  teddy: {
    name: 'Dirty Teddy Bear',
    tags: ['teddy', 'toy', 'plush'],
    mass: 0.6,
    buoyancy: 1.6,
    data: { clean: false },
    wash: {
      points: 150,
      label: 'Teddy Spa Day',
      again: 'Extra Fluffy',
      react(game, e) {
        const clean = teddyCleanMaterials();
        e.object?.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || Array.isArray(m.material)) return;
          const rep = clean[m.material.name];
          if (rep) m.material = rep;
        });
        const model = e.object?.children[0];
        if (model) {
          model.scale.multiplyScalar(1.07);
          const bow = buildBow();
          bow.position.set(0, 0.255, 0.085);
          model.add(bow);
        }
        e.data.clean = true;
        e.name = 'Clean Teddy Bear';
        e.tags.add('clean');
        const p = at(e);
        if (p) fxOf(game)?.emit('hearts', p.add(_v.set(0, 0.2, 0)), { count: 6 });
        game.sfx('sparkle', p);
        game.hint('The teddy bear is clean and fluffy again! Somebody out there must be missing it…', 4);
        game.events.emit('teddyCleaned', { entity: e });
      },
    },
  },
  fish: {
    name: 'Fish',
    tags: ['fish', 'food'],
    mass: 1.2,
    buoyancy: 1.1,
    wash: {
      points: 100,
      label: 'Freshly Washed Fish',
      again: 'Even Fresher Fish',
      react(game, e) {
        e.data.fresh = true;
        e.name = 'Freshly Washed Fish';
        const p = at(e);
        game.sfx('splash', p, 0.5, 1.3);
        if (p) fxOf(game)?.emit('droplets', p, { count: 10 });
        // a happy flop once it's put down
        after(game, 0.35, () => {
          if (!e.alive || !e.body || heldByPlayer(game, e) || !e.body.isDynamic()) return;
          e.body.applyImpulse({ x: rand(-0.5, 0.5), y: e.mass * 3.2, z: rand(-0.5, 0.5) }, true);
          e.body.applyTorqueImpulse({ x: rand(-0.2, 0.2), y: 0, z: rand(-0.3, 0.3) }, true);
        });
      },
    },
  },
  soap: {
    name: 'Bar of Soap',
    tags: ['soap'],
    mass: 0.2,
    friction: 0.12,
    ccd: true,
    wash: {
      points: 120,
      label: 'Maximum Lather',
      again: 'More Lather',
      react(game, e) {
        const p = at(e);
        if (p) fxOf(game)?.emit('bigBubbles', p);
        game.sfx('bubble_burst', p);
        e.object?.children[0]?.scale.multiplyScalar(0.85);
      },
      reactAgain(game, e, n) {
        const p = at(e);
        if (p) fxOf(game)?.emit('bigBubbles', p, { scale: 0.8 });
        game.sfx('bubble_burst', p, 0.8, 1.15);
        if (n >= 3) {
          game.score(50, 'Used Up The Soap', p);
          releaseIfHeld(game, e);
          destroyProp(game, e);
          game.hint('Jimothy used up the entire bar of soap. Very thorough.', 3);
        } else {
          e.object?.children[0]?.scale.multiplyScalar(0.8);
        }
      },
    },
  },
  rubberDuck: {
    name: 'Rubber Duck',
    tags: ['duck', 'toy'],
    mass: 0.12,
    buoyancy: 5,
    restitution: 0.5,
    wash: {
      points: 80,
      label: 'Squeaky Clean Duck',
      again: 'Squeakier',
      react(game, e) {
        squeak(game, e, 1);
      },
      reactAgain(game, e) {
        squeak(game, e, 1);
      },
    },
    onImpact(game, e, _o, s) {
      if (s > 2.5) squeak(game, e, Math.min(1, s / 8));
    },
    onBonk(game, e) {
      squeak(game, e, 1);
    },
  },
  pizza: {
    name: 'Whole Pizza',
    tags: ['pizza', 'food'],
    mass: 1.0,
    ccd: true,
    wash: {
      points: 120,
      label: 'Soggy Pizza (Worth It)',
      again: 'Pizza Soup',
      react(game, e) {
        tintItem(e, 0.82, { roughness: 0.25 });
        e.data.soggy = true;
        e.name = 'Soggy Pizza';
      },
    },
  },
  sandwich: {
    name: 'Sandwich',
    tags: ['sandwich', 'food'],
    mass: 0.4,
    wash: {
      points: 80,
      label: 'Sandwich Soup',
      react(game, e) {
        tintItem(e, 0.85, { roughness: 0.3 });
        e.data.soggy = true;
        e.name = 'Soggy Sandwich';
      },
    },
  },
  coffee: {
    name: 'Coffee',
    tags: ['coffee', 'drink', 'food'],
    mass: 0.4,
    shape: 'cylinder',
    wash: {
      points: 90,
      label: 'Decaf Now',
      again: 'Basically Water',
      react(game, e) {
        e.data.decaf = true;
        e.name = 'Decaf Coffee';
        const p = at(e);
        if (p) fxOf(game)?.emit('droplets', p, { count: 8, color: 0x8a5a3c });
        game.hint('Jimothy diluted the coffee down to decaf. Somewhere, Seattle weeps.', 3);
      },
    },
  },
  iceCream: {
    name: 'Ice Cream Cone',
    tags: ['icecream', 'food', 'sweet'],
    mass: 0.25,
    wash: {
      points: 120,
      label: 'Ice Cream Soup',
      again: 'Rinsed The Cone',
      react(game, e) {
        const scoops = e.object?.getObjectByName('scoops');
        const p = at(e);
        if (p) fxOf(game)?.emit('melt', p.add(_v.set(0, 0.05, 0)), { duration: 1.3 });
        game.sfx('fizz', p, 0.6);
        e.data.melted = true;
        animate(
          game,
          e,
          1.3,
          (t) => {
            if (!scoops) return;
            const k = 1 - t;
            scoops.scale.set(1 + t * 0.35, Math.max(0.001, k), 1 + t * 0.35);
          },
          () => {
            if (scoops) scoops.visible = false;
            e.name = 'Empty Cone';
          },
        );
        game.hint('The ice cream melted away. Jimothy is left holding a very clean cone.', 3);
      },
    },
  },
  diploma: {
    name: 'Honorary Diploma',
    tags: ['diploma', 'paper'],
    mass: 0.2,
    wash: {
      points: 200,
      label: 'Degree In Soggy',
      again: 'Masters In Soggy',
      react(game, e) {
        const L = e.object?.getObjectByName('scrollL');
        const R = e.object?.getObjectByName('scrollR');
        tintItem(e, new THREE.Color(0.82, 0.8, 0.74), { roughness: 0.3 });
        animate(game, e, 0.7, (t) => {
          const k = Math.sin(t * Math.PI * 0.5) * 0.4;
          if (L) L.rotation.z = k;
          if (R) R.rotation.z = -k;
        });
        e.data.soggy = true;
        e.name = 'Soggy Diploma';
        const p = at(e);
        if (p) fxOf(game)?.emit('droplets', p, { count: 10 });
        game.hint('The University of Washing would like to know what Jimothy did to his honorary degree.', 4);
      },
    },
  },
  rookieCard: {
    name: 'Gold Rookie Card',
    tags: ['rookiecard', 'collectible', 'paper', 'valuable'],
    mass: 0.05,
    ccd: true,
    data: { value: 20000 },
    wash: {
      points: 200,
      label: 'Devalued',
      again: 'Further Devalued',
      react(game, e) {
        const card = e.object?.getObjectByName('card') as THREE.Mesh | undefined;
        if (card && Array.isArray(card.material)) {
          const mats = card.material.slice();
          mats[2] = devaluedCardMaterial();
          card.material = mats;
        }
        e.data.devalued = true;
        e.data.value = 3;
        e.name = 'Devalued Rookie Card';
        game.hint('The $20,000 gold rookie card is now worth about $3. Mint condition: gone.', 4);
      },
    },
  },
  spoon: shiny('Spoon', 0.1, { shape: 'box' }),
  bottleCap: shiny('Bottle Cap', 0.03, { shape: 'cylinder', tags: ['trash'] }),
  key: shiny('Key', 0.05, {}),
  ring: shiny('Ring', 0.03, { tags: ['valuable'] }),
  marble: shiny('Marble', 0.05, { shape: 'ball', restitution: 0.6, tags: ['glass'] }),
  grapes: {
    name: 'Grapes',
    tags: ['grapes', 'food', 'fruit'],
    mass: 0.5,
    wash: { points: 60, label: 'Washed Grapes (Responsible)', again: 'Very Responsible' },
  },
  bananaPeel: {
    name: 'Banana Peel',
    tags: ['slippery', 'trash', 'compost'],
    mass: 0.08,
    friction: 0.05,
    wash: {
      points: 50,
      label: 'Slippery When Wet',
      react(game, e) {
        e.data.extraSlippery = true;
      },
    },
  },
  sodaCan: {
    name: 'Soda Can',
    tags: ['trash', 'can', 'metal', 'recyclable'],
    mass: 0.1,
    shape: 'cylinder',
    restitution: 0.35,
    wash: { points: 40, label: 'Recycling (Sort Of)' },
  },
  appleCore: {
    name: 'Apple Core',
    tags: ['trash', 'food', 'compost'],
    mass: 0.08,
    wash: { points: 40, label: 'Core Values' },
  },
  fishBones: {
    name: 'Fish Bones',
    tags: ['trash', 'compost'],
    mass: 0.15,
    ccd: true,
    wash: { points: 40, label: 'Fish, Formerly' },
  },
  takeout: {
    name: 'Takeout Box',
    tags: ['trash', 'food', 'takeout'],
    mass: 0.3,
    wash: { points: 40, label: 'Takeout, Rinsed' },
  },
  newspaper: {
    name: 'Newspaper',
    tags: ['trash', 'paper'],
    mass: 0.3,
    ccd: true,
    wash: {
      points: 50,
      label: 'Wet News',
      react(game, e) {
        tintItem(e, 0.8, { roughness: 0.4 });
        e.name = 'Soggy Newspaper';
      },
    },
  },
  goldenTrophy: {
    name: 'Golden Garbage Trophy',
    tags: ['shiny', 'golden', 'trophy', 'collectible', 'valuable', 'metal'],
    mass: 2,
    buoyancy: 0.5,
    wash: {
      points: 300,
      label: 'Polished To Perfection',
      react(game, e) {
        makeExtraShiny(e);
        const p = at(e);
        if (p) fxOf(game)?.emit('sparkles', p, { count: 28, radius: 0.5 });
        game.sfx('sparkle', p, 1);
        game.hint('Polished to a blinding shine. The crows are going to lose their minds.', 3);
      },
    },
  },
  vase: {
    name: 'Vase',
    tags: ['fragile', 'ceramic'],
    mass: 2,
    shape: 'cylinder',
    data: { shatterLabel: 'Oops, The Vase', shatterPoints: 60, shatterColor: 0xeef2fa },
    wash: { points: 60, label: 'Fine China Rinse' },
  },
  glassBottle: {
    name: 'Glass Bottle',
    tags: ['fragile', 'glass', 'bottle', 'trash'],
    mass: 0.5,
    shape: 'cylinder',
    data: { shatterLabel: 'Smashed A Bottle', shatterPoints: 30, shatterColor: 0x5fbf7a },
    wash: { points: 40, label: 'Rinsed For Recycling' },
  },
  tv: {
    name: 'Old TV',
    tags: ['fragile', 'electronic', 'tv', 'glass'],
    mass: 12,
    data: { shatterLabel: 'Screen Time Over', shatterPoints: 120, shatterColor: 0x9fb4c8 },
    wash: {
      points: 60,
      label: 'Washed The TV',
      again: 'Still Unplugged',
      react(game, e) {
        after(game, 0.4, () => shortCircuit(game, e, 'Unplugged (Permanently)', 120));
      },
    },
  },
  glassPane: {
    name: 'Glass Pane',
    tags: ['fragile', 'glass'],
    mass: 6,
    data: { shatterLabel: 'Pane In The Glass', shatterPoints: 80, shatterColor: 0xcdeeff },
    wash: { points: 60, label: 'Streak-Free Shine' },
  },
  propaneTank: {
    name: 'Propane Tank',
    tags: ['explosive', 'metal', 'propane'],
    mass: 9,
    shape: 'cylinder',
    buoyancy: 1.2,
    data: { explosionRadius: 7 },
    wash: { points: 60, label: 'Clean Propane (Still Explosive)' },
  },
  gasCan: {
    name: 'Gas Can',
    tags: ['explosive', 'metal'],
    mass: 5,
    buoyancy: 1.2,
    data: { explosionRadius: 6 },
    wash: { points: 50, label: 'Scrubbed The Gas Can' },
  },
  fireworksCrate: {
    name: 'Fireworks Crate',
    tags: ['explosive', 'fireworks', 'wood'],
    mass: 8,
    data: { explosionRadius: 6, fireworks: true },
    wash: {
      points: 80,
      label: 'Damp Squib',
      react(game, e) {
        e.data.damp = true;
        e.name = 'Damp Fireworks';
        game.hint('The fireworks are soggy now. That is… probably safer?', 3);
      },
    },
  },
};

let shinyHintShown = false;

function shiny(name: string, mass: number, o: { shape?: ColliderShape; restitution?: number; tags?: string[] }): ItemDef {
  return {
    name,
    tags: ['shiny', 'metal', 'trinket', ...(o.tags ?? [])],
    mass,
    shape: o.shape,
    restitution: o.restitution,
    buoyancy: 0.5,
    ccd: true,
    wash: {
      points: 70,
      label: `Extra Shiny ${name}`,
      again: `Blindingly Shiny ${name}`,
      react(game, e) {
        makeExtraShiny(e);
        game.sfx('sparkle', at(e), 0.8, 1.2);
        if (!shinyHintShown) {
          shinyHintShown = true;
          game.hint('Extra shiny! Seattle crows go absolutely wild for shiny things…', 3);
        }
      },
    },
  };
}

/** Every item kind (e.g. for debug spawners). */
export const ITEM_KINDS = Object.keys(DEFS) as ItemKind[];

const ALIASES: Record<string, ItemKind> = {
  rookiecard: 'rookieCard',
  card: 'rookieCard',
  goldcard: 'rookieCard',
  cottoncandy: 'cottonCandy',
  duck: 'rubberDuck',
  rubberduck: 'rubberDuck',
  dollar: 'cash',
  money: 'cash',
  smartphone: 'phone',
  teddybear: 'teddy',
  icecream: 'iceCream',
  bottlecap: 'bottleCap',
  cap: 'bottleCap',
  earring: 'ring',
  banana: 'bananaPeel',
  bananapeel: 'bananaPeel',
  peel: 'bananaPeel',
  soda: 'sodaCan',
  sodacan: 'sodaCan',
  can: 'sodaCan',
  apple: 'appleCore',
  applecore: 'appleCore',
  bones: 'fishBones',
  fishbones: 'fishBones',
  salmon: 'fish',
  chinese: 'takeout',
  paper: 'newspaper',
  trophy: 'goldenTrophy',
  goldentrophy: 'goldenTrophy',
  golden: 'goldenTrophy',
  bottle: 'glassBottle',
  glassbottle: 'glassBottle',
  television: 'tv',
  pane: 'glassPane',
  glasspane: 'glassPane',
  window: 'glassPane',
  propane: 'propaneTank',
  propanetank: 'propaneTank',
  gascan: 'gasCan',
  gas: 'gasCan',
  fireworks: 'fireworksCrate',
  fireworkscrate: 'fireworksCrate',
  coffeecup: 'coffee',
  cup: 'coffee',
  degree: 'diploma',
};
for (const k of ITEM_KINDS) ALIASES[k.toLowerCase()] = k;

/** Resolve a kind name leniently ('rookiecard', 'Rubber Duck', 'propane' …); undefined if unknown. */
export function resolveItemKind(kind: string): ItemKind | undefined {
  return ALIASES[String(kind).toLowerCase().replace(/[^a-z]/g, '')];
}

/** Display name / tags / mass of a kind (without spawning). */
export function itemInfo(kind: ItemKind) {
  const d = DEFS[kind];
  return d ? { name: d.name, tags: [...d.tags], mass: d.mass } : undefined;
}

// ------------------------------------------------------------------ spawning
const modelCache = new Map<ItemKind, THREE.Object3D>();

function modelFor(kind: ItemKind): THREE.Object3D {
  let m = modelCache.get(kind);
  if (!m) {
    m = BUILD[kind]();
    modelCache.set(kind, m);
  }
  return m.clone(true);
}

function washItem(game: Game, e: Entity, kind: ItemKind) {
  if (!e || !e.alive) return;
  const w = DEFS[kind].wash;
  const n = (e.data.washCount = (e.data.washCount ?? 0) + 1);
  e.data.washed = true;
  const p = at(e);
  if (n === 1) game.score(w.points, w.label, p);
  else if (n < 4) game.score(Math.max(5, Math.round(w.points * 0.2)), w.again ?? `${w.label} Again`, p);
  else game.score(5, `${e.name} Is Very Clean Now`, p);
  game.events.emit('itemWashed', { kind, entity: e, count: n });
  try {
    if (n === 1) w.react?.(game, e);
    else w.reactAgain?.(game, e, n);
  } catch (err) {
    console.error('[items] wash reaction failed', kind, err);
  }
  if (!w.noSparkle && e.alive) game.events.emit('sparkle', { entity: e });
}

/**
 * Spawn an item so its bottom rests at `bottomPos`. Returns the entity (kind 'item').
 * Safe to call from zone builders (before the items system initialises).
 */
export function spawnItem(game: Game, kindName: ItemKind | string, bottomPos: THREE.Vector3, rotY = 0): Entity {
  const kind = resolveItemKind(kindName);
  const def = kind && DEFS[kind];
  if (!kind || !def) throw new Error(`[items] unknown item kind "${kindName}"`);
  let ent!: Entity;
  const e = spawnProp(
    game,
    {
      name: def.name,
      object: modelFor(kind),
      shape: def.shape ?? 'box',
      mass: def.mass,
      kind: 'item',
      tags: ['grabbable', 'washable', 'item', ...def.tags],
      friction: def.friction,
      restitution: def.restitution,
      ccd: def.ccd,
      data: { itemKind: kind, buoyancy: def.buoyancy ?? 1.4, ...(def.data ?? {}) },
      onWash: (g) => washItem(g, ent, kind),
      onImpact: def.onImpact ? (g, o, s) => def.onImpact!(g, ent, o, s) : undefined,
      onBonk: def.onBonk ? (g, imp, pt) => def.onBonk!(g, ent, imp, pt) : undefined,
    },
    bottomPos,
    rotY,
  );
  ent = e;
  if (e.tags.has('slippery')) registry.slippery.add(e);
  return e;
}

/** Spawn an item and fling it (loot popping out of a bin, spills). Wakes the body. */
export function spawnItemFlying(game: Game, kind: ItemKind | string, center: THREE.Vector3, vel: THREE.Vector3, spin = 6): Entity {
  const e = spawnItem(game, kind, center, Math.random() * Math.PI * 2);
  const b = e.body!;
  // spawnItem places the bottom at `center`; recentre on it exactly
  b.setTranslation({ x: center.x, y: center.y, z: center.z }, true);
  b.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
  b.setAngvel({ x: rand(-spin, spin), y: rand(-spin, spin), z: rand(-spin, spin) }, true);
  return e;
}
