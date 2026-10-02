import * as THREE from 'three';
import type { Game } from '../../../core/Game';
import { RAPIER, G, groups } from '../../../core/Physics';
import type { Entity } from '../../../core/Entities';
import { hudShown, roundRect, FONT_DISPLAY, FONT_BOLD, FONT_BODY } from '../shared';

/**
 * Little toolbox shared by the trash capers (throne, midnight buffet, treasure map, raccoon glyphs, bulletin board):
 * per-caper saved state, a canvas-textured plane (signs), a fixed "touchable" entity (bonk / grab targets that never
 * move) and the parchment "card" popup that shows a canvas picture (map, glyph) for a few seconds.
 */

const STORE = 'jimothy.capers.trash.v1';

export function loadState<T extends object>(key: string, fallback: T): T {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}');
    return { ...fallback, ...(all[key] ?? {}) };
  } catch {
    return { ...fallback };
  }
}

export function saveState(key: string, value: object) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}');
    all[key] = value;
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

/** A plane (w × h metres, facing +Z) with its own small canvas texture. `redraw()` repaints it. */
export function canvasPlane(w: number, h: number, pxW: number, pxH: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, glow = 0.12) {
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const redraw = () => {
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, pxW, pxH);
    try {
      draw(c, pxW, pxH);
    } catch (err) {
      console.warn('[capers] sign draw failed', err);
    }
    tex.needsUpdate = true;
  };
  redraw();
  try {
    (document as any).fonts?.ready?.then(redraw);
  } catch {
    /* no font API */
  }
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow, roughness: 0.7, side: THREE.DoubleSide, transparent: true, alphaTest: 0.05 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return { mesh, redraw, canvas, mat };
}

/**
 * A fixed (never moving) box the player can bonk / grab: aim-assist finds it like a prop. `onGrab` returns false so
 * Jimothy never picks it up. Returns the entity (remove with `removeTouchable`).
 */
export function touchable(
  game: Game,
  name: string,
  center: THREE.Vector3,
  half: THREE.Vector3,
  opts: { onBonk?: () => void; onGrab?: () => void; tags?: string[]; label?: string; yaw?: number; object?: THREE.Object3D },
): Entity {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.yaw ?? 0);
  const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  const cd = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
    .setCollisionGroups(groups(G.PROP, G.PLAYER | G.PROP | G.RAGDOLL | G.HELD | G.NPC))
    .setFriction(0.8);
  const body = game.physics.createBody(desc, [cd]);
  return game.entities.create({
    kind: 'static',
    name,
    body,
    object: opts.object,
    mass: 500,
    tags: new Set(['grabbable', 'noclimb', 'keep', ...(opts.tags ?? [])]),
    data: { grabLabel: opts.label ?? name, size: half.clone().multiplyScalar(2) },
    onGrab: () => {
      opts.onGrab?.();
      return false;
    },
    onBonk: () => {
      opts.onBonk?.();
      return true;
    },
  });
}

export function removeTouchable(game: Game, e: Entity | null) {
  if (!e || !e.alive) return;
  e.alive = false;
  const b = e.body;
  game.entities.remove(e);
  if (b) game.physics.removeBody(b);
}

// ------------------------------------------------------------------------------------------------ the card popup
let cardEl: HTMLDivElement | null = null;
let cardT = 0;
let cardTimer = 0;

/**
 * Parchment card with a canvas picture (treasure map, glyph), a title and a line of text. Stays `secs` seconds.
 * The picture canvas is drawn by `draw` at 2× for crispness.
 */
export function showCard(
  game: Game,
  o: { kicker?: string; title: string; text: string; draw: (c: CanvasRenderingContext2D, w: number, h: number) => void; secs?: number; tint?: string },
) {
  if (typeof document === 'undefined') return;
  if (!cardEl) {
    cardEl = document.createElement('div');
    cardEl.className = 'capers-trash-card';
    cardEl.style.cssText =
      'position:fixed;left:50%;top:15%;transform:translateX(-50%) scale(.85);opacity:0;transition:opacity .35s, transform .35s;' +
      'width:min(340px,86vw);padding:12px 14px 14px;border-radius:18px;background:#f4e6c4;border:4px solid #6b4a2a;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.45);pointer-events:none;z-index:30;text-align:center;color:#3a2614';
    (document.getElementById('ui') ?? document.body).append(cardEl);
  }
  const el = cardEl;
  el.textContent = '';
  if (o.tint) el.style.borderColor = o.tint;
  else el.style.borderColor = '#6b4a2a';
  if (o.kicker) {
    const k = document.createElement('div');
    k.textContent = o.kicker;
    k.style.cssText = `font:13px ${FONT_BOLD};letter-spacing:1.5px;text-transform:uppercase;opacity:.75`;
    el.append(k);
  }
  const t = document.createElement('div');
  t.textContent = o.title;
  t.style.cssText = `font:24px ${FONT_DISPLAY};color:#5a2a14;margin:2px 0 8px`;
  el.append(t);
  const cv = document.createElement('canvas');
  cv.width = 600;
  cv.height = 400;
  cv.style.cssText = 'width:100%;aspect-ratio:3/2;border-radius:10px;display:block';
  try {
    o.draw(cv.getContext('2d')!, cv.width, cv.height);
  } catch (err) {
    console.warn('[capers] card draw failed', err);
  }
  el.append(cv);
  const p = document.createElement('div');
  p.textContent = o.text;
  p.style.cssText = `font:italic 700 16px ${FONT_BODY};margin-top:9px;line-height:1.25`;
  el.append(p);
  el.style.display = hudShown(game) ? 'block' : 'none';
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) scale(1)';
  });
  cardT = game.time + (o.secs ?? 6);
  window.clearTimeout(cardTimer);
  const check = () => {
    if (game.time >= cardT || game.state === 'title') {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) scale(.9)';
      return;
    }
    el.style.display = hudShown(game) || game.state === 'paused' ? 'block' : 'none';
    cardTimer = window.setTimeout(check, 250);
  };
  cardTimer = window.setTimeout(check, 250);
}

/** Aged-paper background for canvas pictures (map, glyphs on the card). */
export function paper(c: CanvasRenderingContext2D, w: number, h: number, color = '#e9d3a3') {
  c.fillStyle = color;
  c.fillRect(0, 0, w, h);
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(110,70,30,.45)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // speckles (deterministic)
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  c.fillStyle = 'rgba(90,60,30,.12)';
  for (let i = 0; i < 160; i++) c.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
}

/** A pinned note (bulletin board / signs). */
export function note(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, title: string, lines: string[], rot = 0) {
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate(rot);
  c.translate(-w / 2, -h / 2);
  c.fillStyle = 'rgba(0,0,0,.25)';
  c.fillRect(5, 6, w, h);
  c.fillStyle = color;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#d8342c';
  c.beginPath();
  c.arc(w / 2, 12, 8, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#2a1d12';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.font = `${Math.round(h * 0.13)}px ${FONT_DISPLAY}`;
  c.fillText(title, w / 2, 26, w - 16);
  c.font = `700 ${Math.round(h * 0.085)}px ${FONT_BODY}`;
  lines.forEach((l, i) => c.fillText(l, w / 2, 30 + h * 0.16 + i * h * 0.105, w - 14));
  c.restore();
}

export { roundRect };
