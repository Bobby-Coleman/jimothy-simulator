import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import type { World } from '../world/World';

/**
 * Minimap (bottom-left; top-left under the score on touch) + full-screen map (M, or tap the minimap). The map image
 * is a top-down orthographic render of the world, captured once a few seconds after load (and again when opening
 * the big map if it's stale).
 *
 * The big map shows area names, labelled quest givers / landmarks (✓ once their Instinct is done), the tracked goal
 * (ui/Guide.ts, gold ring) and Jimothy. Click / tap an icon to track it; click / tap elsewhere, M or Esc to close.
 * The minimap shows the tracked goal as a star (clamped to the rim when it's further away).
 */
const HALF = 190;
const RES = 1024;
const IS_TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

interface PoiDef {
  re: RegExp;
  icon: string;
  label: string;
  /** Objective whose completion puts a ✓ on the icon. */
  obj?: string;
}

const POIS: PoiDef[] = [
  { re: /^den$/, icon: '🏠', label: 'Mom', obj: 'mamasBoy' },
  { re: /^cottonCandyCart$/, icon: '🍭', label: 'Cotton candy', obj: 'cottonCandy' },
  { re: /^grandmaPorch$/, icon: '🧶', label: 'Grandma Rosie', obj: 'grandmasFavorite' },
  { re: /^dannyLawn$/, icon: '🦝', label: 'Danny', obj: 'familyReunion' },
  { re: /^crowTree$/, icon: '🐦', label: 'Crows', obj: 'crowDeals' },
  { re: /^sadKid$/, icon: '🧸', label: 'Sad kid', obj: 'teddyRescue' },
  { re: /^cityHallPodium$/, icon: '🏛️', label: 'City Hall', obj: 'jimothySummer' },
  { re: /^spaceNoodleBase$/, icon: '🍜', label: 'Space Noodle', obj: 'spaceNoodle' },
  { re: /^gradStage$/, icon: '🎓', label: 'Graduation', obj: 'honoraryDegree' },
  { re: /^serverPlug$/, icon: '🔌', label: 'SlopCorp plug', obj: 'touchGrass' },
  { re: /^slopBillboard$/, icon: '🤖', label: 'Slop billboard', obj: 'countToFive' },
  { re: /^fishMarket$/, icon: '🐟', label: "Pike's Plaice", obj: 'catchOfTheDay' },
  { re: /^gumWall$/, icon: '🍬', label: 'Gum Wall', obj: 'stickySituation' },
  { re: /^salmonRunStart$/, icon: '⚾', label: 'Salmon Run', obj: 'salmonRun' },
  { re: /^mural$/, icon: '🎨', label: 'Mural' },
  { re: /^locks$/, icon: '⚓', label: 'The Locks' },
  { re: /^cannon:stadium$/, icon: '💥', label: 'Raccoon Cannon' },
  { re: /^cannon:noodle$/, icon: '💥', label: 'Bay Blaster' },
  { re: /^wheelGondola$/, icon: '🎡', label: 'Pretty Good Wheel' },
  { re: /^dragonPad$/, icon: '🐉', label: 'Slop Dragon', obj: 'dragonRider' },
  { re: /^espressoStand$/, icon: '☕', label: 'Espresso', obj: 'tripleShot' },
  { re: /^tourGroup$/, icon: '🎳', label: 'Tour group', obj: 'tourStrike' },
];

interface DrawnPoi {
  name: string;
  label: string;
  x: number;
  y: number;
  r: number;
}

export class MapSystem implements System {
  name = 'map';
  private game!: Game;
  private mapCanvas = document.createElement('canvas');
  private captured = false;
  private captureAt = 6;
  private mini!: HTMLCanvasElement;
  private big!: HTMLDivElement;
  private bigCanvas!: HTMLCanvasElement;
  private legend!: HTMLDivElement;
  private bigOpenFlag = false;
  private freedMouse = false;
  private drawn: DrawnPoi[] = [];
  private hover: string | null = null;
  private photo = false;
  showMinimap = true;

  get bigOpen() {
    return this.bigOpenFlag;
  }

  init(game: Game) {
    this.game = game;
    this.mapCanvas.width = this.mapCanvas.height = RES;
    this.mini = document.createElement('canvas');
    this.mini.width = this.mini.height = 200;
    this.mini.setAttribute('aria-label', 'Minimap');
    this.mini.style.cssText =
      'position:fixed;left:16px;bottom:16px;width:160px;height:160px;border-radius:50%;border:4px solid rgba(255,255,255,.9);box-shadow:0 4px 14px rgba(0,0,0,.45);z-index:20;pointer-events:none;background:#6aa84f';
    document.body.appendChild(this.mini);
    // Touch devices: smaller minimap tucked under the score/combo, tap it (ui/Touch.ts .touch-map) for the big map
    if (IS_TOUCH) {
      this.mini.style.left = 'max(12px, env(safe-area-inset-left))';
      this.mini.style.bottom = 'auto';
      this.mini.style.top = 'calc(118px + env(safe-area-inset-top))'; // below the score + combo bar
      this.mini.style.width = '104px';
      this.mini.style.height = '104px';
      this.mini.style.pointerEvents = 'auto';
      this.mini.addEventListener('click', () => {
        if (game.state === 'playing') this.toggleBig();
      });
    }
    this.big = document.createElement('div');
    this.big.style.cssText =
      'position:fixed;inset:0;display:none;place-items:center;align-content:center;gap:1.2vh;background:rgba(8,12,20,.78);z-index:45;font:700 15px system-ui,sans-serif;color:#fff;user-select:none;-webkit-user-select:none';
    this.bigCanvas = document.createElement('canvas');
    this.bigCanvas.style.cssText = 'border-radius:18px;border:5px solid #fff;box-shadow:0 20px 60px rgba(0,0,0,.6);touch-action:none';
    this.big.appendChild(this.bigCanvas);
    this.legend = document.createElement('div');
    this.legend.style.cssText = 'max-width:92vw;text-align:center;line-height:1.35;text-shadow:0 1px 3px #000;font-size:clamp(12px,1.9vmin,17px);opacity:.92';
    this.big.appendChild(this.legend);
    this.big.addEventListener('click', (e) => {
      if (!this.bigOpenFlag) return;
      const hit = e.target === this.bigCanvas ? this.hitTest(e) : null;
      if (hit) this.trackPoi(hit);
      else this.toggleBig();
    });
    this.bigCanvas.addEventListener('mousemove', (e) => {
      const hit = this.hitTest(e);
      const name = hit?.name ?? null;
      this.bigCanvas.style.cursor = name ? 'pointer' : 'default';
      if (name !== this.hover) {
        this.hover = name;
        this.drawBig();
      }
    });
    document.body.appendChild(this.big);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat && ((game.state === 'playing' && !this.photo) || this.bigOpenFlag)) this.toggleBig();
    });
    window.addEventListener('resize', () => {
      if (this.bigOpenFlag) this.drawBig();
    });
    game.events.on('photoMode', (e: { active: boolean }) => {
      this.photo = !!e?.active;
      if (this.photo && this.bigOpenFlag) this.toggleBig();
    });
    game.events.on('guideTrack', () => {
      if (this.bigOpenFlag) this.drawBig();
    });
  }

  toggleBig() {
    const ui = this.game.get<any>('ui');
    if (!this.bigOpenFlag && (ui?.dialog?.open || (ui && ui.mode !== 'play'))) return; // not over dialogue / menus
    this.bigOpenFlag = !this.bigOpenFlag;
    this.big.style.display = this.bigOpenFlag ? 'grid' : 'none';
    if (this.bigOpenFlag) {
      if (!this.captured) this.capture();
      ui?.drawer?.hide?.();
      // Free the mouse so icons can be clicked (the UI treats this as intentional: no pause menu).
      this.freedMouse = !IS_TOUCH && !!ui?.releasePointer?.();
      this.hover = null;
      this.drawBig();
      this.game.sfx('ui_open', undefined, 0.6);
    } else {
      if (this.freedMouse) ui?.relock?.();
      this.freedMouse = false;
      this.game.sfx('ui_close', undefined, 0.5);
    }
  }

  private trackPoi(p: DrawnPoi) {
    const guide = this.game.get<any>('ui')?.guide;
    if (!guide) return;
    guide.trackPoi(p.name, p.label);
    this.game.sfx('ui_toggle');
    this.drawBig();
  }

  private hitTest(e: MouseEvent): DrawnPoi | null {
    const r = this.bigCanvas.getBoundingClientRect();
    if (!r.width) return null;
    const k = this.bigCanvas.width / r.width;
    const x = (e.clientX - r.left) * k;
    const y = (e.clientY - r.top) * k;
    let best: DrawnPoi | null = null;
    let bd = Infinity;
    for (const p of this.drawn) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < p.r * 1.45 && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Top-down render of the static world into mapCanvas. */
  capture() {
    const game = this.game;
    const r = game.renderer.renderer;
    const scene = game.scene;
    const cam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, 600);
    cam.position.set(0, 300, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    const rt = new THREE.WebGLRenderTarget(RES, RES, { colorSpace: THREE.SRGBColorSpace });
    // perf: keep the Fog OBJECT (its presence is part of every material's program key, like shadowMap.enabled) and
    // just push it out of range for the capture.
    const fog = scene.fog as THREE.Fog | null;
    const fogNear = fog?.near ?? 0;
    const fogFar = fog?.far ?? 0;
    const bg = scene.background;
    const env = game.get<any>('environment');
    const skyVis = env?.sky?.visible;
    if (fog) {
      fog.near = 1e6;
      fog.far = 2e6;
    }
    scene.background = new THREE.Color(0x2b6f8f);
    if (env?.sky) env.sky.visible = false;
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    // perf: DON'T toggle shadowMap.enabled — it is part of every lit material's shader program key, so the capture
    // compiled ~50 programs synchronously (a 5+ s freeze a few seconds into the game on a fast desktop). Keeping it
    // enabled and just not re-rendering the shadow map costs nothing (only the area around Jimothy shows shadows).
    // (toneMapping is ignored for render-target renders anyway.)
    const prevAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = false;
    try {
      r.setRenderTarget(rt);
      // include small far details the DetailCuller has currently layer-culled
      const culler = game.get<any>('culler');
      if (culler?.suspend) culler.suspend(() => r.render(scene, cam));
      else r.render(scene, cam);
      const px = new Uint8Array(RES * RES * 4);
      r.readRenderTargetPixels(rt, 0, 0, RES, RES, px);
      const ctx = this.mapCanvas.getContext('2d')!;
      const img = ctx.createImageData(RES, RES);
      // flip Y
      for (let y = 0; y < RES; y++) {
        img.data.set(px.subarray((RES - 1 - y) * RES * 4, (RES - y) * RES * 4), y * RES * 4);
      }
      ctx.putImageData(img, 0, 0);
      // stylize: slight saturation boost + vignette border
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(255,245,225,1)';
      ctx.fillRect(0, 0, RES, RES);
      ctx.globalCompositeOperation = 'source-over';
      this.captured = true;
    } catch (err) {
      console.warn('[map] capture failed', err);
    } finally {
      r.setRenderTarget(null);
      rt.dispose();
      if (fog) {
        fog.near = fogNear;
        fog.far = fogFar;
      }
      scene.background = bg;
      if (env?.sky) env.sky.visible = skyVis;
      r.toneMapping = prevTone;
      r.shadowMap.autoUpdate = prevAuto;
      r.shadowMap.needsUpdate = true;
    }
  }

  private worldToMap(x: number, z: number, size: number) {
    return [((x + HALF) / (HALF * 2)) * size, ((z + HALF) / (HALF * 2)) * size];
  }

  /** Size the big canvas to its on-screen size × DPR so labels stay crisp and readable on phones. */
  private sizeBig(): number {
    const css = Math.floor(Math.min(window.innerHeight * (IS_TOUCH ? 0.8 : 0.84), window.innerWidth * 0.94));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(css * dpr);
    if (this.bigCanvas.width !== px) this.bigCanvas.width = this.bigCanvas.height = px;
    this.bigCanvas.style.width = this.bigCanvas.style.height = `${css}px`;
    return dpr;
  }

  private drawBig() {
    const dpr = this.sizeBig();
    const ctx = this.bigCanvas.getContext('2d')!;
    const S = this.bigCanvas.width;
    const css = S / dpr;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.mapCanvas, 0, 0, S, S);
    const world = this.game.get<World>('world');
    const ui = this.game.get<any>('ui');
    const guide = ui?.guide;
    const objectives = this.game.get<any>('objectives');
    const cur = guide?.current?.() as { pos: THREE.Vector3; id: string; title: string; label: string } | null;
    this.drawn = [];
    if (world) {
      const r = Math.max(10, Math.min(17, css / 40)) * dpr;
      const labelPx = Math.max(10, Math.min(14, css / 52)) * dpr;
      // Label placement: every icon and placed label is an obstacle; each label tries below / above / right / left.
      const boxes: number[][] = [];
      const free = (b: number[]) => !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
      const pois: { name: string; def: PoiDef; x: number; y: number; ox: number; oy: number }[] = [];
      // Most important first (POIS order), so the den / cotton candy keep their true spots and others get nudged.
      const entries = [...world.poi].filter(([n]) => POIS.some((d) => d.re.test(n)));
      entries.sort((x, y) => POIS.findIndex((d) => d.re.test(x[0])) - POIS.findIndex((d) => d.re.test(y[0])));
      for (const [name, pos] of entries) {
        const def = POIS.find((d) => d.re.test(name));
        if (!def) continue;
        const [ox, oy] = this.worldToMap(pos.x, pos.z, S);
        // Nudge icons that would sit on top of another one (e.g. the mural right next to the cotton candy cart).
        let mx = ox;
        let my = oy;
        for (let i = 0; i < 8 && pois.some((q) => Math.hypot(q.x - mx, q.y - my) < r * 1.9); i++) {
          const a = -Math.PI / 4 + i * (Math.PI / 4);
          mx = ox + Math.cos(a) * r * 2.1;
          my = oy + Math.sin(a) * r * 2.1;
        }
        pois.push({ name, def, x: mx, y: my, ox, oy });
        boxes.push([mx - r, my - r, mx + r, my + r]);
      }
      // Area names along the top of each area (their centres are where the landmarks are)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const areaPx = Math.round(Math.max(9, Math.min(15, css / 50)) * dpr);
      ctx.font = `900 ${areaPx}px system-ui, sans-serif`;
      for (const a of world.areas) {
        const cx = (a.min.x + a.max.x) / 2;
        const [mx] = this.worldToMap(cx, 0, S);
        let [, my] = this.worldToMap(0, a.min.y, S);
        my = Math.max(my, 0) + areaPx * 1.1;
        const text = a.name.toUpperCase();
        const w = ctx.measureText(text).width;
        const box = [mx - w / 2, my - areaPx * 0.6, mx + w / 2, my + areaPx * 0.6];
        if (!free(box)) {
          // slide down a little until it clears the icons; skip the name if it still collides (small maps)
          for (let i = 0; i < 4 && !free(box); i++) {
            box[1] += areaPx * 1.4;
            box[3] += areaPx * 1.4;
          }
          if (!free(box)) continue;
          my = (box[1] + box[3]) / 2;
        }
        boxes.push(box);
        ctx.lineWidth = 3.5 * dpr;
        ctx.strokeStyle = 'rgba(0,0,0,.5)';
        ctx.strokeText(text, mx, my);
        ctx.fillStyle = 'rgba(255,255,255,.88)';
        ctx.fillText(text, mx, my);
      }
      // Icons
      for (const p of pois) {
        const { name, def } = p;
        const mx = p.x;
        const my = p.y;
        if (mx !== p.ox || my !== p.oy) {
          // leader line + dot at the real spot
          ctx.strokeStyle = 'rgba(29,26,38,.8)';
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          ctx.moveTo(p.ox, p.oy);
          ctx.lineTo(mx, my);
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(p.ox, p.oy, 3 * dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        const done = def.obj ? !!objectives?.isDone?.(def.obj) : false;
        const tracked = !!cur && (cur.id === 'poi:' + name || guide?.entryForPoi?.(name) === cur.id);
        const hot = this.hover === name;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.45)';
        ctx.shadowBlur = 6 * dpr;
        ctx.fillStyle = tracked ? '#ffd23f' : hot ? '#fff4c2' : 'rgba(255,255,255,.93)';
        ctx.beginPath();
        ctx.arc(mx, my, r * (hot ? 1.12 : 1), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = '#1d1a26';
        ctx.stroke();
        ctx.font = `${Math.round(r * 1.1)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", system-ui, sans-serif`;
        ctx.fillStyle = '#1d1a26';
        ctx.globalAlpha = done ? 0.55 : 1;
        ctx.fillText(def.icon, mx, my + r * 0.06);
        ctx.globalAlpha = 1;
        if (done) {
          // ✓ badge
          const bx = mx + r * 0.72;
          const by = my - r * 0.72;
          ctx.fillStyle = '#3fcf66';
          ctx.beginPath();
          ctx.arc(bx, by, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1.6 * dpr;
          ctx.strokeStyle = '#1d1a26';
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2.2 * dpr;
          ctx.beginPath();
          ctx.moveTo(bx - r * 0.2, by);
          ctx.lineTo(bx - r * 0.04, by + r * 0.17);
          ctx.lineTo(bx + r * 0.22, by - r * 0.16);
          ctx.stroke();
        }
        this.drawn.push({ name, label: def.label, x: mx, y: my, r });
      }
      // Labels (tracked one first so it gets the best spot)
      ctx.font = `800 ${Math.round(labelPx)}px system-ui, sans-serif`;
      const order = [...pois].sort((a, b) => Number(guide?.entryForPoi?.(b.name) === cur?.id) - Number(guide?.entryForPoi?.(a.name) === cur?.id));
      for (const p of order) {
        const tracked = !!cur && (cur.id === 'poi:' + p.name || guide?.entryForPoi?.(p.name) === cur.id);
        const w = ctx.measureText(p.def.label).width;
        const hh = labelPx * 1.15;
        const gap = 2 * dpr;
        const cands = [
          [p.x, p.y + r + gap + hh / 2],
          [p.x, p.y - r - gap - hh / 2],
          [p.x + r + gap + w / 2, p.y],
          [p.x - r - gap - w / 2, p.y],
        ];
        let best = cands[0];
        for (const c of cands) {
          const b = [c[0] - w / 2, c[1] - hh / 2, c[0] + w / 2, c[1] + hh / 2];
          if (b[0] >= 0 && b[2] <= S && b[1] >= 0 && b[3] <= S && free(b)) {
            best = c;
            break;
          }
        }
        boxes.push([best[0] - w / 2, best[1] - hh / 2, best[0] + w / 2, best[1] + hh / 2]);
        ctx.lineWidth = 3.5 * dpr;
        ctx.strokeStyle = 'rgba(20,18,30,.85)';
        ctx.strokeText(p.def.label, best[0], best[1]);
        ctx.fillStyle = tracked ? '#ffd23f' : '#fff';
        ctx.fillText(p.def.label, best[0], best[1]);
      }
      // Tracked goal (may be a POI or something dynamic like the nearest trash can)
      if (cur?.pos) {
        const [tx, ty] = this.worldToMap(cur.pos.x, cur.pos.z, S);
        const pulse = 1 + 0.12 * Math.sin(performance.now() / 180);
        ctx.lineWidth = 3.5 * dpr;
        ctx.strokeStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(tx, ty, r * 1.55 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        this.star(ctx, tx, ty - r * 1.9, r * 0.75, dpr);
      }
    }
    this.drawPlayer(ctx, S, 1.6 * dpr * Math.max(0.7, css / 700));
    // Legend
    const how = IS_TOUCH ? 'Tap an icon to track it · tap outside to close' : 'Click an icon to track it · M / Esc to close';
    const tracking = cur ? `★ Tracking: <b style="color:#ffd23f">${escapeHtml(cur.title)}</b>${cur.label && cur.label !== cur.title ? ` — ${escapeHtml(cur.label)}` : ''}<br>` : '';
    const html = `${tracking}<span style="opacity:.85">${how} · 🏠 = Mom's den, ✓ = done</span>`;
    if (this.legend.innerHTML !== html) this.legend.innerHTML = html;
  }

  private star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dpr: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = '#1d1a26';
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, S: number, scale: number, cx?: number, cy?: number) {
    const p = this.game.get<any>('player');
    if (!p) return;
    const [mx, my] = cx != null && cy != null ? [cx, cy] : this.worldToMap(p.position.x, p.position.z, S);
    ctx.save();
    ctx.translate(mx, my);
    // facing: model forward (sin f, cos f) in x/z; map y = z
    ctx.rotate(Math.atan2(Math.cos(p.facing), Math.sin(p.facing)) - Math.PI / 2 + Math.PI);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#ffcf33';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  lateUpdate(dt: number, game: Game) {
    if (!this.captured) {
      this.captureAt -= dt;
      if (this.captureAt <= 0 && game.state !== 'boot') this.capture();
    }
    const ui = game.get<any>('ui');
    // The big map belongs to free play: close it if a cutscene / menu takes over.
    if (this.bigOpenFlag && (game.state !== 'playing' || (ui && ui.mode !== 'play'))) this.toggleBig();
    const hudOff = !!ui && (!ui.hudVisible || ui.settings?.showHud === false);
    const hidden = !this.showMinimap || hudOff || this.photo || game.state === 'title' || game.state === 'cutscene' || game.state === 'boot' || (ui && ui.mode !== 'play' && ui.mode !== 'pause');
    const disp = hidden ? 'none' : 'block';
    if (this.mini.style.display !== disp) this.mini.style.display = disp;
    if (this.bigOpenFlag && game.frame % 6 === 0) this.drawBig();
    if (hidden || game.frame % 3 !== 0) return;
    const p = game.get<any>('player');
    if (!p) return;
    const ctx = this.mini.getContext('2d')!;
    const S = this.mini.width;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
    // 70 m view radius around the player, rotated so camera-forward is up
    const viewR = 70;
    const k = RES / (HALF * 2);
    const [px, py] = this.worldToMap(p.position.x, p.position.z, RES);
    const cam = game.get<any>('camera');
    const yaw = cam ? cam.yaw : 0;
    ctx.translate(S / 2, S / 2);
    ctx.rotate(yaw);
    const src = viewR * k;
    ctx.drawImage(this.mapCanvas, px - src, py - src, src * 2, src * 2, -S / 2, -S / 2, S, S);
    ctx.restore();
    // Tracked goal: star inside the view, or a star pinned to the rim pointing the way.
    const cur = ui?.guide?.current?.() as { pos: THREE.Vector3 } | null;
    if (cur?.pos && ui?.settings?.showGuide !== false) {
      const dx = cur.pos.x - p.position.x;
      const dz = cur.pos.z - p.position.z;
      // Same rotation as the map image: world (x, z) → minimap (x, y), then rotate by yaw.
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      let mx = (dx * c - dz * s) * (S / 2 / viewR);
      let my = (dx * s + dz * c) * (S / 2 / viewR);
      const lim = S / 2 - 14;
      const l = Math.hypot(mx, my);
      if (l > lim) {
        mx *= lim / l;
        my *= lim / l;
      }
      this.star(ctx, S / 2 + mx, S / 2 + my, l > lim ? 9 : 11, 1);
    }
    // player arrow always points up relative to camera (draw facing relative to camera yaw)
    ctx.save();
    ctx.translate(S / 2, S / 2);
    const rel = -(p.facing - (yaw + Math.PI));
    ctx.rotate(rel);
    ctx.fillStyle = '#ffcf33';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // North marker
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(yaw);
    ctx.fillStyle = '#fff';
    ctx.font = '900 16px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -S / 2 + 18);
    ctx.restore();
  }
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
