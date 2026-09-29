import { esc } from './dom';

/** Which input device the player is currently using (drives key/button glyphs). */
export type Device = 'kbm' | 'pad' | 'touch';

interface GlyphDef {
  kbm: string;
  pad: string;
  touch: string;
  /** Human name for the controls reference. */
  name?: string;
}

/**
 * Button labels per action. The pad column mirrors PADMAP in src/core/Input.ts (the source of truth),
 * which differs slightly from DESIGN.md §3 (B = Tuck & Roll, LB = Flop there).
 */
export const GLYPHS: Record<string, GlyphDef> = {
  move: { kbm: 'WASD', pad: 'LS', touch: 'Stick' },
  look: { kbm: 'Mouse', pad: 'RS', touch: 'Drag' },
  jump: { kbm: 'Space', pad: 'A', touch: 'Jump' },
  sprint: { kbm: 'Shift', pad: 'LT', touch: 'Stick' },
  grab: { kbm: 'E', pad: 'X', touch: 'Grab' },
  bonk: { kbm: 'F', pad: 'RB', touch: 'Bonk' },
  wash: { kbm: 'R', pad: 'Y', touch: 'Wash' },
  roll: { kbm: 'Q', pad: 'B', touch: 'Roll' },
  flop: { kbm: 'Z', pad: 'LB', touch: 'Flop' },
  chitter: { kbm: 'C', pad: 'D↑', touch: 'Chitter' },
  objectives: { kbm: 'Tab', pad: 'View', touch: 'Instincts' },
  pause: { kbm: 'Esc', pad: 'Menu', touch: 'II' },
  slowmo: { kbm: 'T', pad: '', touch: '' },
  respawn: { kbm: 'H', pad: '', touch: '' },
  map: { kbm: 'M', pad: '', touch: 'Minimap' },
  photo: { kbm: 'V', pad: 'R3', touch: 'Photo' },
  click: { kbm: 'Click', pad: 'A', touch: 'Tap' },
  lmb: { kbm: 'LMB', pad: 'X', touch: 'Grab' },
  rmb: { kbm: 'RMB', pad: 'RB', touch: 'Bonk' },
  back: { kbm: 'Esc', pad: 'B', touch: 'Back' },
  confirm: { kbm: 'Enter', pad: 'A', touch: 'Tap' },
};

const FACE: Record<string, string> = { A: 'pad-a', B: 'pad-b', X: 'pad-x', Y: 'pad-y' };

/** A single key/button chip (HTML string). */
export function keyChip(label: string, device: Device): string {
  if (!label) return '';
  if (device === 'pad') {
    if (FACE[label]) return `<span class="kc pad-face ${FACE[label]}">${label}</span>`;
    if (/^[LR][BT]$/.test(label)) return `<span class="kc pad-shoulder">${label}</span>`;
    if (/^D[↑↓←→]$/.test(label)) return `<span class="kc pad-dpad">${label.slice(1)}</span>`;
    if (label === 'LS' || label === 'RS') return `<span class="kc pad-stick">${label[0]}</span>`;
    return `<span class="kc pad-menu">${esc(label)}</span>`;
  }
  if (device === 'touch') return `<span class="kc touch-chip">${esc(label)}</span>`;
  if (label === 'Mouse' || label === 'LMB' || label === 'RMB' || label === 'Click') {
    const side = label === 'RMB' ? 'r' : label === 'Mouse' ? 'n' : 'l';
    return `<span class="kc kc-mouse kc-mouse-${side}" title="${label}"><i></i></span>`;
  }
  return `<span class="kc${label.length > 1 ? ' kc-wide' : ''}">${esc(label)}</span>`;
}

/** Chip for an action on a device (falls back to keyboard labels when the device has none). */
export function glyph(action: string, device: Device): string {
  const g = GLYPHS[action];
  if (!g) return `<span class="kc kc-wide">${esc(action)}</span>`;
  const label = g[device] || g.kbm;
  return keyChip(label, g[device] ? device : 'kbm');
}

/**
 * Escape `text` and replace `{action}` tokens with key/button chips for the current device.
 * e.g. "Hold {wash} near water" → "Hold [R] near water" / "Hold (Y) near water".
 */
export function fillTokens(text: string, device: Device): string {
  return esc(text).replace(/\{([a-z]+)\}( ([A-Za-z]+))?/g, (m, a: string, sp?: string, word?: string) => {
    if (!GLYPHS[a]) return m;
    const chip = glyph(a, device);
    // Touch chips are words: "{grab} Grab food" would read "[Grab] Grab food" — drop the echo.
    if (word && device === 'touch' && GLYPHS[a].touch.toLowerCase() === word.toLowerCase()) return chip;
    return chip + (sp ?? '');
  });
}
