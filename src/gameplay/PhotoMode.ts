import type { Game, System } from '../core/Game';

const CAPTIONS = [
  'what am I looking at',
  'he just looks like a Jimothy',
  'real or AI?? (it is real. we checked. twice.)',
  'round boy spotted in Ballard #JimothySummer',
  'this raccoon has no neck and no notes',
  'POV: you thought it was a cat',
  'not a cat. never was a cat.',
  'honorary graduate, full-time sphere',
  'caught in 4K (the K stands for Kinda blurry)',
  'please do not approach Jimothy (I zoomed in)',
];

const IS_TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** Round phone-camera style button for the touch photo UI. */
function touchBtn(label: string, html: string, css: string, onTap: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.setAttribute('aria-label', label);
  b.innerHTML = html;
  b.style.cssText =
    'position:absolute;pointer-events:auto;touch-action:none;display:grid;place-items:center;border-radius:50%;' +
    'border:3px solid #1d1a26;background:rgba(255,244,220,.94);color:#1d1a26;font:900 20px system-ui,sans-serif;' +
    'box-shadow:0 4px 0 #1d1a26;padding:0;' +
    css;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onTap();
  });
  return b;
}

/**
 * Phone photo mode (V / R3 / the touch camera button): freezes time, orbit the camera, snap a picture, get a fake
 * viral post you can save. Canon nod: Jimothy was discovered by someone filming him on a phone.
 * Touch: drag anywhere to orbit (ui/Touch look area stays live), big shutter button, zoom +/−, ✕ to leave.
 */
export class PhotoModeSystem implements System {
  name = 'photomode';
  active = false;
  private root: HTMLDivElement | null = null;
  private game!: Game;
  private prevTimeScale = 1;
  private prevFrozen = false;
  private photos = 0;
  private preview: HTMLDivElement | null = null;

  init(game: Game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;display:none;z-index:40;font:700 14px system-ui,sans-serif;color:#fff';
    const help = IS_TOUCH
      ? 'Drag to orbit · <b>◉ snap</b> · ✕ exit'
      : 'Mouse / right stick: orbit · Wheel: zoom · <b>Click / A: snap</b> · V / Esc: exit';
    this.root.innerHTML = `
      <div style="position:absolute;inset:4vh 14vw;border:3px solid rgba(255,255,255,.85);border-radius:28px;box-shadow:0 0 0 100vmax rgba(0,0,0,.35)"></div>
      <div style="position:absolute;top:calc(4vh + 16px);left:calc(14vw + 22px);display:flex;align-items:center;gap:8px;text-shadow:0 1px 3px #000"><span style="width:12px;height:12px;border-radius:50%;background:#ff3b30;display:inline-block"></span>PHOTO</div>
      <div style="position:absolute;top:calc(4vh + 16px);right:calc(14vw + 22px);text-shadow:0 1px 3px #000">JIMOTHY CAM · 100%</div>
      <div style="position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border:2px solid rgba(255,255,255,.7);border-radius:8px"></div>
      <div style="position:absolute;bottom:calc(4vh + 18px);left:0;right:0;text-align:center;text-shadow:0 1px 3px #000">${help}</div>`;
    if (IS_TOUCH) {
      // The frame's side margins are tiny on phones: put the buttons on the frame instead.
      const shutter = touchBtn(
        'Snap photo',
        '<span style="width:44px;height:44px;border-radius:50%;background:#ff3b30;border:3px solid #1d1a26;display:block"></span>',
        'right:max(18px,env(safe-area-inset-right));top:50%;width:74px;height:74px;margin-top:-37px',
        () => {
          if (this.active && !this.preview) this.snap();
        },
      );
      const exit = touchBtn('Leave photo mode', '✕', 'left:max(18px,env(safe-area-inset-left));top:max(14px,env(safe-area-inset-top));width:48px;height:48px', () => {
        if (this.active) this.exit();
      });
      const zoom = (d: number) => () => {
        if (this.active) this.game.input.wheel += d;
      };
      const zin = touchBtn('Zoom in', '+', 'right:max(30px,env(safe-area-inset-right));top:calc(50% - 104px);width:48px;height:48px', zoom(-2));
      const zout = touchBtn('Zoom out', '−', 'right:max(30px,env(safe-area-inset-right));top:calc(50% + 56px);width:48px;height:48px', zoom(2));
      this.root.append(shutter, exit, zin, zout);
    }
    document.body.appendChild(this.root);
    window.addEventListener('mousedown', (e) => {
      if (this.active && !this.preview && e.button === 0 && !IS_TOUCH) this.snap();
    });
  }

  update(_dt: number, game: Game) {
    this.handleInput(game);
  }

  lateUpdate(_dt: number, game: Game) {
    // update() doesn't run while paused; still allow leaving photo mode
    if (this.active && game.paused) this.handleInput(game);
    if (this.active && game.input.pressed('jump') && !this.preview) this.snap();
  }

  private handleInput(game: Game) {
    if (game.input.pressed('camera') && game.state === 'playing') {
      if (this.active) this.exit();
      else this.enter();
    } else if (this.active && game.input.pressed('pause')) {
      this.exit();
    }
  }

  enter() {
    const game = this.game;
    const ui = game.get<any>('ui');
    // Not over a dialogue or a menu (the dialogue box would sit in the photo, and unfreezing on exit would
    // let Jimothy walk off mid-conversation).
    if (ui?.dialog?.open || (ui && ui.mode !== 'play')) return;
    const map = game.get<any>('map');
    if (map?.bigOpen) map.toggleBig();
    this.active = true;
    this.prevTimeScale = game.timeScale || 1;
    game.timeScale = 0;
    const p = game.get<any>('player');
    if (p) {
      this.prevFrozen = !!p.frozen;
      p.frozen = true;
    }
    if (ui && 'hudVisible' in ui) ui.hudVisible = false;
    if (this.root) this.root.style.display = 'block';
    game.events.emit('photoMode', { active: true });
  }

  exit() {
    const game = this.game;
    this.active = false;
    game.timeScale = this.prevTimeScale || 1;
    const p = game.get<any>('player');
    if (p) p.frozen = this.prevFrozen;
    const ui = game.get<any>('ui');
    if (ui && 'hudVisible' in ui) ui.hudVisible = true;
    if (this.root) this.root.style.display = 'none';
    this.closePreview();
    game.events.emit('photoMode', { active: false });
  }

  private snap() {
    const game = this.game;
    if (this.root) this.root.style.visibility = 'hidden';
    // Render and grab the frame in the same task (drawing buffer is still valid)
    game.renderer.render(0);
    let url = '';
    try {
      url = game.renderer.domElement.toDataURL('image/jpeg', 0.92);
    } catch {
      /* ignore */
    }
    if (this.root) this.root.style.visibility = 'visible';
    game.sfx('camera_shutter');
    game.events.emit('cameraFlash', { position: game.camera.position.clone() });
    this.photos++;
    game.events.emit('photoTaken', { count: this.photos });
    if (this.photos === 1) game.score(100, 'First Photo');
    this.showPreview(url);
  }

  private showPreview(url: string) {
    this.closePreview();
    const cap = CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)];
    const views = (Math.random() * 9 + 1).toFixed(1);
    const d = document.createElement('div');
    d.style.cssText =
      'position:fixed;inset:0;display:grid;place-items:center;background:rgba(10,14,24,.6);z-index:60;font:600 15px system-ui,sans-serif;pointer-events:auto;overflow:auto;padding:12px 0';
    // Height-capped image so the card (and its buttons) always fit on landscape phones.
    d.innerHTML = `
      <div style="background:#fff;color:#111;border-radius:18px;padding:14px 14px 16px;width:min(560px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.5);transform:rotate(-1.2deg)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:34px;height:34px;border-radius:50%;background:#8a8178;display:grid;place-items:center;color:#fff;font-weight:900">J</div>
          <div><div style="font-weight:800">nice_lady_with_a_phone</div><div style="font-size:12px;color:#777">Ballard, Seattle · just now</div></div>
        </div>
        ${url ? `<img src="${url}" style="width:100%;max-height:calc(100vh - 230px);min-height:120px;object-fit:cover;border-radius:10px;display:block" alt="Photo of Jimothy">` : '<div style="height:200px;display:grid;place-items:center;background:#eee;border-radius:10px">(the camera shy-ed)</div>'}
        <div style="margin:10px 2px 4px;font-size:16px">${cap}</div>
        <div style="font-size:12px;color:#777;margin:0 2px 12px">${views}M views · 100% real raccoon · 0% AI</div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <a data-act="save" style="background:#1d9bf0;color:#fff;padding:11px 16px;border-radius:999px;text-decoration:none;cursor:pointer">Save photo</a>
          <a data-act="close" style="background:#eee;color:#111;padding:11px 16px;border-radius:999px;cursor:pointer">Back</a>
        </div>
      </div>`;
    document.body.appendChild(d);
    this.preview = d;
    const save = d.querySelector('[data-act="save"]') as HTMLAnchorElement;
    if (url) {
      save.href = url;
      save.download = `jimothy-${Date.now()}.jpg`;
    } else save.style.display = 'none';
    (d.querySelector('[data-act="close"]') as HTMLElement).onclick = () => this.closePreview();
    this.game.input.exitPointerLock();
  }

  private closePreview() {
    if (this.preview) {
      this.preview.remove();
      this.preview = null;
      if (this.active) this.game.input.requestPointerLock();
    }
  }
}
