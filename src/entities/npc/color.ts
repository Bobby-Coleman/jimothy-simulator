import * as THREE from 'three';

/**
 * Post-processing-safe color.
 *
 * The renderer's HueSaturationEffect (saturation +0.18) computes `c += (avg - c) * -0.218`, which drives a channel
 * negative when it is below ~18% of the color's average; a later effect then turns that pixel black. Pure/strong
 * colors (neon green, pure red, saturated orange…) would render as black patches. Lift weak channels just enough
 * (in linear space) to survive; the saturation boost restores most of the punch.
 */
export function safeColor(hex: number, out = new THREE.Color()): THREE.Color {
  out.setHex(hex);
  for (let i = 0; i < 2; i++) {
    const floor = ((out.r + out.g + out.b) / 3) * 0.26;
    out.r = Math.max(out.r, floor);
    out.g = Math.max(out.g, floor);
    out.b = Math.max(out.b, floor);
  }
  return out;
}
