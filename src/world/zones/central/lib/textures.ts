import * as THREE from 'three';
import type { Game } from '../../../../core/Game';
import { assetUrl } from '../../../../core/Assets';
import { Rng } from './util';

/** Shared material cache for the central zones (textured materials can't go through world.material). */
const cache = new Map<string, any>();

export function cached<T>(key: string, make: () => T): T {
  let v = cache.get(key) as T | undefined;
  if (v === undefined) {
    v = make();
    cache.set(key, v);
  }
  return v;
}

export function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return { c, ctx };
}

export function canvasTexture(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  t.needsUpdate = true;
  return t;
}

export interface PBRSet {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

/** Load a Poly Haven style texture set from public/assets/textures/<name>/. Missing files resolve to null. */
export function loadPBR(game: Game, name: string): Promise<PBRSet> {
  return cached(`pbr:${name}`, async () => {
    const base = `assets/textures/${name}/`;
    const [map, normalMap, roughnessMap] = await Promise.all([
      game.assets.tryTexture(base + 'color.jpg'),
      game.assets.tryTexture(base + 'normal.jpg', { srgb: false }),
      game.assets.tryTexture(base + 'rough.jpg', { srgb: false }),
    ]);
    return { map, normalMap, roughnessMap } as PBRSet;
  });
}

/** Load an image element (for canvas processing). */
export function loadImage(path: string): Promise<HTMLImageElement | null> {
  return cached(`img:${path}`, () =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = assetUrl(path);
    }),
  );
}

/**
 * Colour-graded copy of an image texture: saturation multiplier, gain, and a tint.
 * Used to turn the warm Poly Haven concrete into bright neutral sidewalk slabs etc.
 */
export async function gradedTexture(
  path: string,
  o: { sat?: number; gain?: number; tint?: string; size?: number; contrast?: number } = {},
): Promise<THREE.Texture | null> {
  const key = `graded:${path}:${JSON.stringify(o)}`;
  return cached(key, async () => {
    const img = await loadImage(path);
    if (!img) return null;
    const S = o.size ?? 512;
    const { c, ctx } = canvas(S, S);
    ctx.drawImage(img, 0, 0, S, S);
    const data = ctx.getImageData(0, 0, S, S);
    const d = data.data;
    const sat = o.sat ?? 1;
    const gain = o.gain ?? 1;
    const con = o.contrast ?? 1;
    const t = new THREE.Color(o.tint ?? '#ffffff');
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      let nr = l + (r - l) * sat,
        ng = l + (g - l) * sat,
        nb = l + (b - l) * sat;
      nr = (nr - 128) * con + 128;
      ng = (ng - 128) * con + 128;
      nb = (nb - 128) * con + 128;
      d[i] = Math.min(255, Math.max(0, nr * gain * t.r));
      d[i + 1] = Math.min(255, Math.max(0, ng * gain * t.g));
      d[i + 2] = Math.min(255, Math.max(0, nb * gain * t.b));
    }
    ctx.putImageData(data, 0, 0);
    return canvasTexture(c);
  });
}

// --------------------------------------------------------------------------------------------- procedural

/** Fallback asphalt if the texture set is missing. */
export function proceduralAsphalt(): THREE.Texture {
  return cached('tex:asphalt', () => {
    const { c, ctx } = canvas(512, 512);
    ctx.fillStyle = '#4a4d52';
    ctx.fillRect(0, 0, 512, 512);
    const r = new Rng(7);
    for (let i = 0; i < 9000; i++) {
      const v = r.int(50, 120);
      ctx.fillStyle = `rgba(${v},${v},${v + 4},${r.range(0.15, 0.5)})`;
      ctx.fillRect(r.int(0, 511), r.int(0, 511), r.int(1, 3), r.int(1, 3));
    }
    return canvasTexture(c);
  });
}

/**
 * Recolor the Poly Haven brick texture: brick pixels (saturated) take `color`, mortar stays greyish.
 * Returns null if the source image is missing.
 */
export async function recoloredBrick(color: string, mortar = '#b9b2a6', painted = false): Promise<THREE.Texture | null> {
  const key = `brick:${color}:${mortar}:${painted}`;
  return cached(key, async () => {
    const img = await loadImage('assets/textures/brick/color.jpg');
    if (!img) return null;
    const S = 512;
    const { c, ctx } = canvas(S, S);
    ctx.drawImage(img, 0, 0, S, S);
    const data = ctx.getImageData(0, 0, S, S);
    const d = data.data;
    const tc = new THREE.Color(color);
    const mc = new THREE.Color(mortar);
    const tr = tc.r * 255,
      tg = tc.g * 255,
      tb = tc.b * 255;
    const mr = mc.r * 255,
      mg = mc.g * 255,
      mb = mc.b * 255;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i],
        g = d[i + 1],
        b = d[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      const luma = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      // brickness: saturated warm pixels
      let k = Math.min(1, Math.max(0, (sat - 0.22) / 0.2));
      if (r < g) k *= 0.3;
      const shade = painted ? 0.9 + (luma - 0.4) * 0.35 : 0.55 + luma * 1.05;
      const br = tr * shade,
        bg = tg * shade,
        bb = tb * shade;
      const ms = 0.75 + luma * 0.5;
      const ar = mr * ms,
        ag = mg * ms,
        ab = mb * ms;
      d[i] = Math.min(255, ar + (br - ar) * k);
      d[i + 1] = Math.min(255, ag + (bg - ag) * k);
      d[i + 2] = Math.min(255, ab + (bb - ab) * k);
    }
    ctx.putImageData(data, 0, 0);
    return canvasTexture(c);
  });
}

/** Striped awning canvas (vertical stripes). */
export function stripeTexture(a: string, b: string, stripes = 8): THREE.Texture {
  return cached(`stripe:${a}:${b}:${stripes}`, () => {
    const { c, ctx } = canvas(256, 64);
    const w = 256 / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? b : a;
      ctx.fillRect(i * w, 0, w + 1, 64);
    }
    // subtle fabric shading
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 64);
    return canvasTexture(c);
  });
}

/** Radial glow for fake light pools on the ground. */
export function glowTexture(): THREE.Texture {
  return cached('tex:glow', () => {
    const { c, ctx } = canvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,220,160,1)');
    g.addColorStop(0.35, 'rgba(255,200,130,0.55)');
    g.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return canvasTexture(c, { repeat: false });
  });
}

/**
 * Sash window textures: 'dark' = daytime glass with sky reflection, 'lit' = warm interior w/ curtains.
 * Both share the same frame so they can be swapped.
 */
export function windowTexture(kind: 'dark' | 'lit', frame = '#f1e9d8'): THREE.Texture {
  return cached(`win:${kind}:${frame}`, () => {
    const W = 128,
      H = 224;
    const { c, ctx } = canvas(W, H);
    ctx.fillStyle = frame;
    ctx.fillRect(0, 0, W, H);
    const pad = 10;
    const mid = H / 2;
    for (const [y0, y1] of [
      [pad, mid - 4],
      [mid + 4, H - pad],
    ]) {
      const g = ctx.createLinearGradient(0, y0, W, y1);
      if (kind === 'dark') {
        g.addColorStop(0, '#9fc3dd');
        g.addColorStop(0.45, '#35556f');
        g.addColorStop(1, '#1c2c3c');
      } else {
        g.addColorStop(0, '#ffe2a3');
        g.addColorStop(1, '#f0a55a');
      }
      ctx.fillStyle = g;
      ctx.fillRect(pad, y0, W - pad * 2, y1 - y0);
      if (kind === 'lit') {
        // curtains
        ctx.fillStyle = 'rgba(190,70,60,0.55)';
        ctx.fillRect(pad, y0, 18, y1 - y0);
        ctx.fillRect(W - pad - 18, y0, 18, y1 - y0);
        // a lamp or a plant silhouette
        ctx.fillStyle = 'rgba(90,50,30,0.45)';
        ctx.beginPath();
        ctx.ellipse(W / 2, y1 - 14, 14, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // reflection streak
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.moveTo(pad + 12, y0);
        ctx.lineTo(pad + 34, y0);
        ctx.lineTo(pad + 4, y1);
        ctx.lineTo(pad, y1 - 20);
        ctx.fill();
      }
      // mullion
      ctx.fillStyle = frame;
      ctx.fillRect(W / 2 - 3, y0, 6, y1 - y0);
    }
    return canvasTexture(c, { repeat: false });
  });
}

/** Curtain-wall office tower facade (glass grid). lit=true returns the emissive map (random lit windows). */
export function towerTexture(kind: 'color' | 'emissive', seed = 3): THREE.Texture {
  return cached(`tower:${kind}:${seed}`, () => {
    const cols = 8,
      rows = 16;
    const W = 512,
      H = 1024;
    const { c, ctx } = canvas(W, H);
    const r = new Rng(seed);
    const cw = W / cols,
      rh = H / rows;
    ctx.fillStyle = kind === 'color' ? '#c9d3dc' : '#000';
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const x0 = x * cw + 4,
          y0 = y * rh + 6;
        const w = cw - 8,
          h = rh - 12;
        if (kind === 'color') {
          const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
          const t = r.range(0, 0.15);
          g.addColorStop(0, `rgb(${150 + t * 200},${190 + t * 150},${215})`);
          g.addColorStop(0.5, '#46708f');
          g.addColorStop(1, '#23405a');
          ctx.fillStyle = g;
          ctx.fillRect(x0, y0, w, h);
        } else if (r.chance(0.38)) {
          const warm = r.chance(0.7);
          ctx.fillStyle = warm ? `rgb(255,${r.int(190, 225)},${r.int(120, 160)})` : 'rgb(190,225,255)';
          ctx.fillRect(x0, y0, w, h);
        }
      }
    }
    return canvasTexture(c);
  });
}

/** Plaid blanket. */
export function plaidTexture(): THREE.Texture {
  return cached('tex:plaid', () => {
    const { c, ctx } = canvas(256, 256);
    ctx.fillStyle = '#a4343a';
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < 256; i += 64) {
      ctx.fillStyle = '#1f3b2c';
      ctx.fillRect(i + 8, 0, 24, 256);
      ctx.fillRect(0, i + 8, 256, 24);
      ctx.fillStyle = '#f2d06b';
      ctx.fillRect(i + 44, 0, 4, 256);
      ctx.fillRect(0, i + 44, 256, 4);
    }
    ctx.globalAlpha = 1;
    return canvasTexture(c);
  });
}

/** Lattice skirting (diagonal wood lattice) with alpha holes. */
export function latticeTexture(): THREE.Texture {
  return cached('tex:lattice', () => {
    const { c, ctx } = canvas(256, 256);
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = '#e9e1cf';
    ctx.lineWidth = 16;
    for (let i = -256; i < 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 256, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i + 256, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
    }
    return canvasTexture(c);
  });
}
