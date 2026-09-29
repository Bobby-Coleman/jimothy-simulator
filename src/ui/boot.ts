import { assetUrl } from '../core/Assets';
import { tipSequence } from './content';

const FONTS: { family: string; file: string; weight?: string }[] = [
  { family: 'Luckiest Guy', file: 'LuckiestGuy-Regular.ttf' },
  { family: 'Lilita One', file: 'LilitaOne-Regular.ttf' },
  { family: 'Nunito', file: 'Nunito-VariableFont_wght.ttf', weight: '200 1000' },
];

let fontsStarted = false;

/** Register the display/body fonts (public/assets/fonts). Falls back to system fonts if missing. */
export function loadFonts() {
  if (fontsStarted || typeof document === 'undefined' || !('fonts' in document) || typeof FontFace === 'undefined') return;
  fontsStarted = true;
  for (const f of FONTS) {
    try {
      const face = new FontFace(f.family, `url("${assetUrl('assets/fonts/' + f.file)}") format("truetype")`, {
        weight: f.weight ?? '400',
        display: 'swap',
      });
      document.fonts.add(face);
      face.load().catch(() => console.warn(`[ui] font ${f.family} unavailable, using fallback`));
    } catch {
      /* ignore */
    }
  }
}

/**
 * While main.ts shows its "Loading Jimothy… (N%)" text, rotate slop tips under it (CSS ::after reads data-tip).
 * Stops by itself once #boot is removed.
 */
export function installBootTips() {
  const boot = typeof document !== 'undefined' ? document.getElementById('boot') : null;
  if (!boot) return;
  boot.classList.add('jui-boot');
  const tips = tipSequence().map((t) => t.replace(/\{(\w+)\}/g, (_m, a: string) => BOOT_KEYS[a] ?? a));
  let i = 0;
  boot.dataset.tip = tips[0];
  const id = window.setInterval(() => {
    if (!document.body.contains(boot)) {
      window.clearInterval(id);
      return;
    }
    i = (i + 1) % tips.length;
    boot.dataset.tip = tips[i];
  }, 2600);
}

const BOOT_KEYS: Record<string, string> = {
  wash: 'R',
  roll: 'Q',
  jump: 'Space',
  objectives: 'Tab',
  grab: 'E',
  bonk: 'F',
  chitter: 'C',
};
