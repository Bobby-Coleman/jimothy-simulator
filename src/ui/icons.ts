/**
 * Inline SVG art for the UI: small monochrome icons (currentColor) plus the two mascots
 * (Jimothy's face for the logo/portraits, and SlopBot™). All original, drawn by hand in SVG.
 */

const s = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;
const stroke = (d: string, w = 2.6) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

export const ICONS = {
  paw: s(
    '<ellipse cx="5.6" cy="10" rx="2.2" ry="2.8" transform="rotate(-18 5.6 10)"/><ellipse cx="9.6" cy="5.6" rx="2.2" ry="2.9"/><ellipse cx="14.4" cy="5.6" rx="2.2" ry="2.9"/><ellipse cx="18.4" cy="10" rx="2.2" ry="2.8" transform="rotate(18 18.4 10)"/><path d="M12 11.2c3.3 0 6.2 3.5 6.2 6.2 0 2-1.6 3.2-3.3 3.2-1.3 0-1.8-.7-2.9-.7s-1.6.7-2.9.7c-1.7 0-3.3-1.2-3.3-3.2 0-2.7 2.9-6.2 6.2-6.2z"/>',
  ),
  heart: s('<path d="M12 21s-8.4-5.3-8.4-11.4C3.6 6.4 6 4.3 8.8 4.3c1.5 0 2.5.7 3.2 1.7.7-1 1.7-1.7 3.2-1.7 2.8 0 5.2 2.1 5.2 5.3C20.4 15.7 12 21 12 21z"/>'),
  boom: s(
    '<path d="M12 1.2l2.1 5.4 5.1-2.7-1.5 5.5 5.3 1.5-4.8 3 3.2 4.7-5.7-.6-.4 5.6L12 19.4l-3.3 3.2-.4-5.6-5.7.6 3.2-4.7-4.8-3 5.3-1.5-1.5-5.5 5.1 2.7z"/>',
  ),
  slop: s(
    '<path d="M10.5 1.8l1.9 6.3 6.3 1.9-6.3 1.9-1.9 6.3-1.9-6.3L2.3 10l6.3-1.9z"/><rect x="14.6" y="14.8" width="7" height="2.3" rx=".5"/><rect x="17.2" y="18.6" width="5" height="2.3" rx=".5"/><rect x="12.4" y="19.4" width="3.4" height="1.7" rx=".5"/>',
  ),
  secret: s(
    '<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm.1 13.9a1.45 1.45 0 1 0 0 2.9 1.45 1.45 0 0 0 0-2.9zm-.2-10c-2.3 0-4 1.3-4.1 3.5h2.4c.1-.9.7-1.4 1.6-1.4.9 0 1.4.5 1.4 1.1 0 .6-.3.9-1.1 1.4-1.1.7-1.6 1.4-1.6 2.8v.6h2.3v-.5c0-.7.2-1 1-1.5 1.2-.8 1.9-1.6 1.9-2.9 0-1.9-1.6-3.1-3.8-3.1z"/>',
  ),
  check: s(stroke('M4.5 12.5l4.8 4.8L19.8 6.8', 3.4)),
  lock: s('<path d="M7 10V7.6a5 5 0 0 1 10 0V10h.9A1.6 1.6 0 0 1 19.5 11.6v8A1.6 1.6 0 0 1 17.9 21.2H6.1a1.6 1.6 0 0 1-1.6-1.6v-8A1.6 1.6 0 0 1 6.1 10H7zm2.5 0h5V7.6a2.5 2.5 0 0 0-5 0V10z"/>'),
  star: s('<path d="M12 2.2l2.95 6.1 6.7.85-4.95 4.6 1.3 6.65L12 17.2l-6 3.2 1.3-6.65L2.35 9.15l6.7-.85z"/>'),
  wand: s('<path d="M3.2 19.6l10.4-10.4 1.9 1.9L5.1 21.5z"/><path d="M16.8 1.8l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9zM20.5 9.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5zM9.5 2.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z"/>'),
  hand: s(
    '<path d="M7.2 11.5V5.4a1.4 1.4 0 0 1 2.8 0v5.2-6.8a1.4 1.4 0 0 1 2.8 0v6.8-5.9a1.4 1.4 0 0 1 2.8 0v6.4-3.8a1.4 1.4 0 0 1 2.8 0v7.3c0 4.2-2.9 7.1-6.7 7.1-2.6 0-4.2-1.2-5.6-3.4l-2.4-3.8a1.4 1.4 0 0 1 2.3-1.6z"/>',
  ),
  bubbles: s(
    '<circle cx="8.5" cy="14.5" r="5.2" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="17" cy="7.5" r="3.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="17.5" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 12.4a2.8 2.8 0 0 1 2.2-1.6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  ),
  pin: s('<path fill-rule="evenodd" d="M12 1.8a7.2 7.2 0 0 0-7.2 7.2c0 5.2 7.2 13.2 7.2 13.2s7.2-8 7.2-13.2A7.2 7.2 0 0 0 12 1.8zm0 4.6a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z"/>'),
  pause: s('<rect x="5.5" y="4" width="4.6" height="16" rx="1.4"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.4"/>'),
  list: s('<rect x="3" y="4" width="3.4" height="3.4" rx="1"/><rect x="8.5" y="4.6" width="12.5" height="2.3" rx="1.1"/><rect x="3" y="10.3" width="3.4" height="3.4" rx="1"/><rect x="8.5" y="10.9" width="12.5" height="2.3" rx="1.1"/><rect x="3" y="16.6" width="3.4" height="3.4" rx="1"/><rect x="8.5" y="17.2" width="12.5" height="2.3" rx="1.1"/>'),
  close: s(stroke('M6 6l12 12M18 6L6 18', 3.2)),
  back: s(stroke('M14.5 5l-7 7 7 7', 3.2)),
  play: s('<path d="M7 4.6v14.8a1 1 0 0 0 1.5.9l12-7.4a1 1 0 0 0 0-1.8l-12-7.4A1 1 0 0 0 7 4.6z"/>'),
  gear: s(
    '<path fill-rule="evenodd" d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.8c.1.6.1 1.3 0 1.9l2 1.8-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-2.9 2-1.8a6 6 0 0 1 0-1.9l-2-1.8 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9zM12 8.3a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z" transform="translate(0 1)"/>',
  ),
  keyboard: s('<path fill-rule="evenodd" d="M3 6h18a1.6 1.6 0 0 1 1.6 1.6v9A1.6 1.6 0 0 1 21 18.2H3a1.6 1.6 0 0 1-1.6-1.6v-9A1.6 1.6 0 0 1 3 6zm2 2.6v2h2v-2zm3.5 0v2h2v-2zm3.5 0v2h2v-2zm3.5 0v2h2v-2zM5 12.3v2h2v-2zm3.5 3.3v1.2h7v-1.2zm0-3.3v2h2v-2zm3.5 0v2h2v-2zm3.5 0v2h3.5v-2z"/>'),
  gamepad: s('<path fill-rule="evenodd" d="M7 6.5h10c3 0 5.2 3 5.8 7.6.4 3-1.4 4.7-3.1 4.7-1.5 0-2.4-1-3.4-2.3-.5-.6-1-.9-1.8-.9h-5c-.8 0-1.3.3-1.8.9-1 1.3-1.9 2.3-3.4 2.3-1.7 0-3.5-1.7-3.1-4.7C1.8 9.5 4 6.5 7 6.5zm0 3v1.6H5.4v1.8H7v1.6h1.8v-1.6h1.6v-1.8H8.8V9.5zm9.9-.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm-2.3 2.4a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z"/>'),
  fullscreen: s(stroke('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', 2.8)),
  next: s('<path d="M4 5.2v13.6a1 1 0 0 0 1.5.86L15 13.9V18a1 1 0 0 0 1 1h2.6a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H16a1 1 0 0 0-1 1v4.1L5.5 4.34A1 1 0 0 0 4 5.2z"/>'),
  prev: s('<path d="M20 5.2v13.6a1 1 0 0 1-1.5.86L9 13.9V18a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H8a1 1 0 0 1 1 1v4.1l9.5-5.76A1 1 0 0 1 20 5.2z"/>'),
  note: s('<circle cx="6.6" cy="17.6" r="3"/><circle cx="17" cy="15.6" r="3"/><path d="M7.6 17.6V6.4L20 3.7v11.9h-2V7.1l-8.4 1.8v8.7z"/>'),
  fullscreenExit:s(stroke('M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5', 2.8)),
  trophy: s('<path d="M7 3h10v2h3.2v2.5c0 2.6-1.9 4.6-4.4 4.9A5.6 5.6 0 0 1 13 15.5V18h3.5v3h-9v-3H11v-2.5a5.6 5.6 0 0 1-2.8-3.1C5.7 12.1 3.8 10.1 3.8 7.5V5H7zm0 4.3H6v.2c0 1.2.6 2.1 1.5 2.6A6 6 0 0 1 7 8zm10 0v.7c0 .7-.1 1.4-.4 2.1.9-.5 1.4-1.4 1.4-2.6v-.2z"/>'),
  camera: s('<path fill-rule="evenodd" d="M8.5 4h7l1.4 2.2H20a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.2a2 2 0 0 1 2-2h3.1zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>'),
  info: s('<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.3 8.2v7.6h2.6v-7.6zM12 5.6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/>'),
  dice: s('<path fill-rule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.8 3a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm8.4 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM12 10.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm-4.2 4.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm8.4 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z"/>'),
  home: s('<path d="M12 2.8l10 8.6h-2.9v9.4h-5v-6.2H9.9v6.2h-5v-9.4H2z"/>'),
  map: s('<path fill-rule="evenodd" d="M2.5 5.4l6-2.4 7 2.6 6-2.4v15.4l-6 2.4-7-2.6-6 2.4zm7 .1v12.6l5 1.9V7.4z"/>'),
  volume: s('<path d="M3 9.2h3.6L11.8 5a.8.8 0 0 1 1.3.6v12.8a.8.8 0 0 1-1.3.6l-5.2-4.2H3a1 1 0 0 1-1-1V10.2a1 1 0 0 1 1-1z"/>' + stroke('M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8', 2.2)),
  mute: s('<path d="M3 9.2h3.6L11.8 5a.8.8 0 0 1 1.3.6v12.8a.8.8 0 0 1-1.3.6l-5.2-4.2H3a1 1 0 0 1-1-1V10.2a1 1 0 0 1 1-1z"/>' + stroke('M16.2 9.4l5 5.2M21.2 9.4l-5 5.2', 2.4)),
  shuffle: s(stroke('M3 7h3.6c4.4 0 6.4 10 10.8 10H20M3 17h3.6c1.6 0 2.8-1.3 3.8-3M13.6 10c1-1.7 2.2-3 3.8-3H20M17.6 4.4L20.4 7l-2.8 2.6M17.6 14.4l2.8 2.6-2.8 2.6', 2.3)),
  chevron: s(stroke('M6 9.5l6 6 6-6', 3)),
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: string | undefined, fallback: IconName = 'star'): string {
  if (name && name in ICONS) return ICONS[name as IconName];
  return ICONS[fallback];
}

/**
 * Icon markup from a loose spec: a known icon name, an image URL, or a short text/emoji.
 */
export function iconFromSpec(spec: string | undefined, fallback: IconName = 'star'): string {
  if (!spec) return ICONS[fallback];
  if (spec in ICONS) return ICONS[spec as IconName];
  if (/[/.](png|svg|jpe?g|webp|gif)$/i.test(spec) || spec.startsWith('data:')) {
    return `<img src="${spec.replace(/"/g, '&quot;')}" alt="">`;
  }
  if (spec.startsWith('<svg')) return spec;
  return `<span class="icon-text">${spec.replace(/[<>&]/g, '')}</span>`;
}

/** Jimothy's round face (logo "O", dialog portraits). viewBox 0 0 100 100. */
export const JIMOTHY_FACE = `<svg class="jim-face" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <circle cx="21" cy="25" r="14.5" fill="#8d8479" stroke="#1d1a26" stroke-width="5"/>
  <circle cx="21" cy="25" r="7" fill="#efe6d8"/>
  <circle cx="79" cy="25" r="14.5" fill="#8d8479" stroke="#1d1a26" stroke-width="5"/>
  <circle cx="79" cy="25" r="7" fill="#efe6d8"/>
  <circle cx="50" cy="55" r="42" fill="#9b9287" stroke="#1d1a26" stroke-width="5"/>
  <path d="M26 71 Q50 96 74 71 Q70 90 50 93 Q30 90 26 71Z" fill="#b8afa3" opacity=".55"/>
  <path d="M21 40 Q31 30 44 38" stroke="#fbf7ef" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M56 38 Q69 30 79 40" stroke="#fbf7ef" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M11 53 Q13 42 28 43 Q41 44 50 50.5 Q59 44 72 43 Q87 42 89 53 Q87 65 72 65 Q59 65 50 58.5 Q41 65 28 65 Q13 65 11 53Z" fill="#1d1a26"/>
  <circle cx="31" cy="53.5" r="6.3" fill="#3a3342"/><circle cx="31" cy="53.5" r="4.6" fill="#050507"/><circle cx="33.2" cy="51.3" r="1.9" fill="#fff"/>
  <circle cx="69" cy="53.5" r="6.3" fill="#3a3342"/><circle cx="69" cy="53.5" r="4.6" fill="#050507"/><circle cx="71.2" cy="51.3" r="1.9" fill="#fff"/>
  <ellipse cx="50" cy="75" rx="17.5" ry="13.5" fill="#f6f0e6"/>
  <path d="M43.5 66.5 Q50 63 56.5 66.5 Q54.5 72.5 50 73.5 Q45.5 72.5 43.5 66.5Z" fill="#1d1a26"/>
  <circle cx="47.8" cy="66.6" r="1.2" fill="#fff" opacity=".7"/>
  <path d="M50 73.5 V77.5 M43.5 78.5 Q50 83.5 56.5 78.5" stroke="#1d1a26" stroke-width="2.6" fill="none" stroke-linecap="round"/>
</svg>`;

/** SlopBot™: a smug paperclip-ish blob with googly eyes and one suspicious six-fingered hand. */
export const SLOPBOT_ART = `<svg class="sb-art" viewBox="0 0 150 150" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="sbBody" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e2d6ff"/><stop offset=".5" stop-color="#9c86ff"/><stop offset="1" stop-color="#37d3c5"/>
    </linearGradient>
    <linearGradient id="sbWire" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#a4acd0"/>
    </linearGradient>
  </defs>
  <g class="sb-clip">
    <path d="M62 52 V18 a10 10 0 0 1 20 0 V42 a6.5 6.5 0 0 1 -13 0 V22" fill="none" stroke="#231c44" stroke-width="9" stroke-linecap="round"/>
    <path d="M62 52 V18 a10 10 0 0 1 20 0 V42 a6.5 6.5 0 0 1 -13 0 V22" fill="none" stroke="url(#sbWire)" stroke-width="4.5" stroke-linecap="round"/>
  </g>
  <g class="sb-arm">
    <path d="M112 96 C124 90 128 78 130 68" fill="none" stroke="#231c44" stroke-width="9" stroke-linecap="round"/>
    <path d="M112 96 C124 90 128 78 130 68" fill="none" stroke="#9c86ff" stroke-width="4.5" stroke-linecap="round"/>
    <g stroke="#231c44" stroke-width="3.2" stroke-linecap="round">
      <path d="M130 66 L121 55"/><path d="M130 65 L125 51"/><path d="M131 64 L130 49"/><path d="M132 65 L135 50"/><path d="M133 66 L140 53"/><path d="M134 68 L143 60"/>
    </g>
    <circle cx="131" cy="67" r="6.5" fill="#c6b8ff" stroke="#231c44" stroke-width="3"/>
  </g>
  <path class="sb-body" d="M66 46 C98 43 118 66 115 97 C112 127 92 142 64 140 C35 138 17 123 18 94 C19 64 35 48 66 46 Z" fill="url(#sbBody)" stroke="#231c44" stroke-width="4.5"/>
  <path d="M33 72 C37 61 48 54 59 53" stroke="#fff" stroke-opacity=".75" stroke-width="5.5" fill="none" stroke-linecap="round"/>
  <g class="sb-eye">
    <circle cx="47" cy="87" r="16" fill="#fff" stroke="#231c44" stroke-width="3.2"/>
    <circle class="sb-pupil" cx="51" cy="91" r="6.4" fill="#141219"/>
    <path d="M31 85 A16 16 0 0 1 63 85 Z" fill="#8b74f5" stroke="#231c44" stroke-width="3.2" stroke-linejoin="round"/>
  </g>
  <g class="sb-eye sb-eye-r">
    <circle cx="84" cy="84" r="12.5" fill="#fff" stroke="#231c44" stroke-width="3.2"/>
    <circle class="sb-pupil" cx="87" cy="88" r="5.2" fill="#141219"/>
    <path d="M71.5 81 A12.5 12.5 0 0 1 96.5 81 Z" fill="#8b74f5" stroke="#231c44" stroke-width="3.2" stroke-linejoin="round"/>
  </g>
  <path d="M50 114 C60 121 76 119 87 107" stroke="#231c44" stroke-width="4.5" fill="none" stroke-linecap="round"/>
  <path d="M85 105 l6 -2" stroke="#231c44" stroke-width="4" stroke-linecap="round"/>
  <text x="96" y="132" font-size="13" font-weight="900" font-family="Arial, sans-serif" fill="#231c44">TM</text>
</svg>`;
