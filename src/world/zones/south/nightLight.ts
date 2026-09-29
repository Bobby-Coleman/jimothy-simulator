import * as THREE from 'three';
import type { Game } from '../../../core/Game';

/**
 * Lighting pass: ONE shared real-time PointLight for the south zones' big night set-pieces (the stadium field and the
 * market hall), which fake light pools alone can't make readable (vertical faces, stalls, Jimothy himself).
 *
 * The light is always in the scene — a constant light count means no shader recompiles when it switches on — but its
 * intensity is 0 unless it's night (environment.nightFactor) AND the player is near a registered rig; it then parks at
 * that rig. Rigs are further apart than their ranges (radius + fade), so at most one is active at a time.
 * Idle cost: one extra point light in the lit shaders; no extra draw calls, no shadows.
 */
export interface NightRig {
  pos: THREE.Vector3;
  color: THREE.ColorRepresentation;
  intensity: number;
  /** Light cutoff distance (m). */
  distance: number;
  decay: number;
  /** Full strength while the player is within `radius` (XZ) of `pos`, fading to 0 over the next `fade` metres. */
  radius: number;
  fade: number;
}

const shared = new WeakMap<Game, { light: THREE.PointLight; rigs: (NightRig & { col: THREE.Color })[] }>();

export function addNightRig(game: Game, rig: NightRig) {
  let s = shared.get(game);
  if (!s) {
    const light = new THREE.PointLight(0xffffff, 0, 10, 0);
    light.name = 'south-night-light';
    game.scene.add(light);
    const state = { light, rigs: [] as (NightRig & { col: THREE.Color })[] };
    s = state;
    shared.set(game, state);
    game.add({
      name: 'southNightLight',
      lateUpdate(_dt: number, g: Game) {
        const nf: number = g.get<any>('environment')?.nightFactor ?? 0;
        const p: THREE.Vector3 | undefined = g.get<any>('player')?.position;
        let best: (typeof state.rigs)[number] | null = null;
        let bw = 0;
        if (nf > 0.01 && p) {
          for (const r of state.rigs) {
            const w = 1 - THREE.MathUtils.smoothstep(Math.hypot(p.x - r.pos.x, p.z - r.pos.z), r.radius, r.radius + r.fade);
            if (w > bw) {
              bw = w;
              best = r;
            }
          }
        }
        if (!best) {
          light.intensity = 0;
          return;
        }
        light.position.copy(best.pos);
        light.color.copy(best.col);
        light.distance = best.distance;
        light.decay = best.decay;
        light.intensity = best.intensity * bw * nf;
      },
    });
  }
  s.rigs.push({ ...rig, col: new THREE.Color(rig.color) });
}

let multTex: THREE.CanvasTexture | null = null;
/** Radial falloff (alpha) for multiply-add light pools. */
function poolTexture() {
  if (multTex) return multTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  multTex = new THREE.CanvasTexture(c);
  multTex.colorSpace = THREE.SRGBColorSpace;
  return multTex;
}

/**
 * Ground light-pool material that MULTIPLIES what's already there: result = dst × (1 + colour × opacity × falloff).
 * Unlike an additive pool it keeps the surface's own colour (green grass stays green instead of turning beige) and does
 * nothing on black. Drive `opacity` from the night glow list (0 by day hides it).
 */
export function multiplyPoolMaterial(color: THREE.ColorRepresentation) {
  return new THREE.MeshBasicMaterial({
    map: poolTexture(),
    color,
    transparent: true,
    opacity: 0,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.OneFactor,
    depthWrite: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
}
