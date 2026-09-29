import * as THREE from 'three';
import type { Game, System } from '../core/Game';
import type { World } from '../world/World';

/**
 * Minimap (bottom-left) + full-screen map (M). The map image is a top-down orthographic render of the world,
 * captured once a few seconds after load (and again when opening the big map if it's stale).
 */
const HALF = 190;
const RES = 1024;

const POI_ICONS: [RegExp, string, string][] = [
  [/^den$/, '🏠', 'Home (Mom)'],
  [/^grandmaPorch$/, '🧶', 'Grandma Rosie'],
  [/^dannyLawn$/, '🦝', 'Danny'],
  [/^crowTree$/, '🐦‍⬛', 'Crow Tree'],
  [/^sadKid$/, '🧸', 'Sad Kid'],
  [/^cityHallPodium$/, '🏛️', 'City Hall'],
  [/^spaceNoodleBase$/, '🍜', 'Space Noodle'],
  [/^gradStage$/, '🎓', 'Graduation'],
  [/^slopBillboard$/, '🤖', 'SlopCorp'],
  [/^fishMarket$/, '🐟', "Pike's Plaice"],
  [/^gumWall$/, '🍬', 'Gum Wall'],
  [/^salmonRunStart$/, '⚾', 'Tee-Hee Park'],
  [/^mural$/, '🎨', 'Mural'],
  [/^locks$/, '⚓', 'The Locks'],
];

export class MapSystem implements System {
  name = 'map';
  private game!: Game;
  private mapCanvas = document.createElement('canvas');
  private captured = false;
  private captureAt = 6;
  private mini!: HTMLCanvasElement;
  private big!: HTMLDivElement;
  private bigCanvas!: HTMLCanvasElement;
  private bigOpen = false;
  showMinimap = true;

  init(game: Game) {
    this.game = game;
    this.mapCanvas.width = this.mapCanvas.height = RES;
    this.mini = document.createElement('canvas');
    this.mini.width = this.mini.height = 200;
    this.mini.style.cssText =
      'position:fixed;left:16px;bottom:16px;width:160px;height:160px;border-radius:50%;border:4px solid rgba(255,255,255,.9);box-shadow:0 4px 14px rgba(0,0,0,.45);z-index:20;pointer-events:none;background:#6aa84f';
    document.body.appendChild(this.mini);
    // Touch devices: smaller minimap tucked under the score, tap it to open the big map
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      this.mini.style.left = '12px';
      this.mini.style.bottom = 'auto';
      this.mini.style.top = '92px';
      this.mini.style.width = '104px';
      this.mini.style.height = '104px';
      this.mini.style.pointerEvents = 'auto';
      this.mini.addEventListener('click', () => this.toggleBig());
    }
    this.big = document.createElement('div');
    this.big.style.cssText =
      'position:fixed;inset:0;display:none;place-items:center;background:rgba(8,12,20,.72);z-index:45;font:700 15px system-ui,sans-serif;color:#fff';
    this.bigCanvas = document.createElement('canvas');
    this.bigCanvas.width = this.bigCanvas.height = 900;
    this.bigCanvas.style.cssText = 'width:min(88vh,92vw);height:min(88vh,92vw);border-radius:18px;border:5px solid #fff;box-shadow:0 20px 60px rgba(0,0,0,.6)';
    this.big.appendChild(this.bigCanvas);
    const tip = document.createElement('div');
    tip.textContent = window.matchMedia?.('(pointer: coarse)').matches ? 'Tap to close' : 'M to close';
    this.big.addEventListener('click', () => {
      if (this.bigOpen) this.toggleBig();
    });
    tip.style.cssText = 'position:absolute;bottom:3vh;left:0;right:0;text-align:center;opacity:.8';
    this.big.appendChild(tip);
    document.body.appendChild(this.big);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && (game.state === 'playing' || this.bigOpen)) this.toggleBig();
    });
    game.events.on('photoMode', (e: { active: boolean }) => (this.mini.style.display = e.active ? 'none' : 'block'));
  }

  toggleBig() {
    this.bigOpen = !this.bigOpen;
    this.big.style.display = this.bigOpen ? 'grid' : 'none';
    if (this.bigOpen) {
      if (!this.captured) this.capture();
      this.drawBig();
    }
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
    const fog = scene.fog;
    const bg = scene.background;
    const env = game.get<any>('environment');
    const skyVis = env?.sky?.visible;
    scene.fog = null;
    scene.background = new THREE.Color(0x2b6f8f);
    if (env?.sky) env.sky.visible = false;
    const prevTone = r.toneMapping;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const prevShadow = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    try {
      r.setRenderTarget(rt);
      r.render(scene, cam);
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
      scene.fog = fog;
      scene.background = bg;
      if (env?.sky) env.sky.visible = skyVis;
      r.toneMapping = prevTone;
      r.shadowMap.enabled = prevShadow;
      r.shadowMap.needsUpdate = true;
    }
  }

  private worldToMap(x: number, z: number, size: number) {
    return [((x + HALF) / (HALF * 2)) * size, ((z + HALF) / (HALF * 2)) * size];
  }

  private drawBig() {
    const ctx = this.bigCanvas.getContext('2d')!;
    const S = this.bigCanvas.width;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.mapCanvas, 0, 0, S, S);
    const world = this.game.get<World>('world');
    // Area labels
    if (world) {
      ctx.font = '900 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const a of world.areas) {
        const cx = (a.min.x + a.max.x) / 2;
        const cz = (a.min.y + a.max.y) / 2;
        const [mx, my] = this.worldToMap(cx, cz, S);
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(0,0,0,.65)';
        ctx.strokeText(a.name.toUpperCase(), mx, my);
        ctx.fillStyle = '#fff';
        ctx.fillText(a.name.toUpperCase(), mx, my);
      }
      // POIs
      ctx.font = '26px system-ui, "Segoe UI Emoji", sans-serif';
      for (const [name, pos] of world.poi) {
        const icon = POI_ICONS.find(([re]) => re.test(name));
        if (!icon) continue;
        const [mx, my] = this.worldToMap(pos.x, pos.z, S);
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath();
        ctx.arc(mx, my - 8, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(icon[1], mx, my + 1);
      }
    }
    this.drawPlayer(ctx, S, 1.6);
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
    const hidden = !this.showMinimap || game.state === 'title' || game.state === 'cutscene';
    this.mini.style.display = hidden ? 'none' : 'block';
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
    // 90 m view radius around the player, rotated so camera-forward is up
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
    if (this.bigOpen && game.frame % 6 === 0) this.drawBig();
  }
}
