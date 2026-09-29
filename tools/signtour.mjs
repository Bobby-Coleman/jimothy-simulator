// Sign readability tour: visits every registered sign face head-on and writes contact sheets.
//
//   node tools/signtour.mjs [--url http://127.0.0.1:5173/?time=12] [--out tools/shots/signs] [--only 3,17,40]
//                           [--near x,z,r] [--src south.sign] [--cols 3] [--rows 3] [--cell 480x360] [--fill 0.7]
//
// Signs come from the dev-only registry in src/world/signRegistry.ts (window.__signs) plus a scan of loose meshes
// that carry a CanvasTexture map or an atlas-tagged geometry. Writes <out>/sheet-NN.png and <out>/signs.json.
// Each cell is labelled with the sign index, source helper, calling function, size, and warnings
// (texture aspect mismatch = stretched text; face height above terrain).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
let url = opt('url', 'http://127.0.0.1:5173/?time=12');
if (!/[?&]skipintro/.test(url)) url += (url.includes('?') ? '&' : '?') + 'skipintro';
const out = opt('out', 'tools/shots/signs');
const cols = Number(opt('cols', '3'));
const rows = Number(opt('rows', '3'));
const [cw, ch] = opt('cell', '480x360').split('x').map(Number);
const fill = Number(opt('fill', '0.7'));
const only = opt('only', null);
const near = opt('near', null);
const srcF = opt('src', null);

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) =>
  fs.existsSync(p),
);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: cw * 2, height: ch * 2 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message)));
fs.mkdirSync(out, { recursive: true });
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.jimothy && window.jimothy.state !== 'boot', null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const list = await page.evaluate(
    ({ only, near, srcF }) => {
      const g = window.jimothy;
      const V3 = g.get('player').position.constructor;
      const signs = (globalThis.__signs || []).map((s) => ({ ...s }));
      // loose meshes: atlas-tagged geometry or CanvasTexture maps that no helper registered
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const tag = o.geometry.userData?.sign;
        // (tiling canvas patterns and NPC faces / shirt prints are not signs)
        const canvasMap = mats.some((m) => m?.map?.isCanvasTexture && m.map.wrapS !== 1000) && !/^(face|print)$/.test(o.name);
        if (!tag && !canvasMap) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const r = o.geometry.boundingSphere.radius * o.getWorldScale(new V3()).x;
        if (r > 12 || r < 0.05) return;
        if (!o.visible) return;
        const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
        const nor = o.geometry.getAttribute('normal');
        if (!nor) return;
        const n = new V3().fromBufferAttribute(nor, tag?.nIdx ?? (o.geometry.type === 'BoxGeometry' ? 16 : 0)).transformDirection(o.matrixWorld);
        if (signs.some((s) => Math.hypot(s.center[0] - c.x, s.center[1] - c.y, s.center[2] - c.z) < 0.35)) return;
        const im = mats.find((m) => m?.map)?.map?.image;
        const p = o.geometry.parameters || {};
        signs.push({
          src: tag ? tag.src + '(mesh)' : 'mesh:' + (o.name || o.geometry.type),
          center: [c.x, c.y, c.z],
          normal: [n.x, n.y, n.z],
          w: tag?.w ?? p.width ?? r * 1.4,
          h: tag?.h ?? p.height ?? r * 1.4,
          texAspect: tag?.texAspect ?? (im?.width && im?.height && !tag ? im.width / im.height : undefined),
          caller: o.parent?.name || '',
          loose: true,
        });
      });
      signs.forEach((s, i) => (s.i = i));
      let sel = signs;
      if (only) {
        const set = new Set(only.split(',').map(Number));
        sel = sel.filter((s) => set.has(s.i));
      }
      if (near) {
        const [x, z, r] = near.split(',').map(Number);
        sel = sel.filter((s) => Math.hypot(s.center[0] - x, s.center[2] - z) < r);
      }
      if (srcF) sel = sel.filter((s) => s.src.includes(srcF));
      window.__tourSel = sel;
      return { all: signs, sel: sel.map((s) => s.i) };
    },
    { only, near, srcF },
  );
  fs.writeFileSync(path.join(out, 'signs.json'), JSON.stringify(list.all, null, 1));
  console.log(`signs registered: ${list.all.length}, selected: ${list.sel.length}`);
  const per = cols * rows;
  for (let s0 = 0, sheet = 0; s0 < list.sel.length; s0 += per, sheet++) {
    const data = await page.evaluate(
      async ({ s0, per, cols, rows, cw, ch, fill }) => {
        const g = window.jimothy;
        const THREE_V = g.get('player').position.constructor;
        const player = g.get('player');
        const rig = g.get('camera');
        const sheet = document.createElement('canvas');
        sheet.width = cols * cw;
        sheet.height = rows * ch;
        const sx = sheet.getContext('2d');
        sx.fillStyle = '#222';
        sx.fillRect(0, 0, sheet.width, sheet.height);
        const sel = window.__tourSel.slice(s0, s0 + per);
        const world = g.get('world');
        for (let k = 0; k < sel.length; k++) {
          const s = sel[k];
          const c = new THREE_V(...s.center);
          const n = new THREE_V(...s.normal).normalize();
          const fov = 50;
          const aspect = cw / ch;
          const t = Math.tan(((fov / 2) * Math.PI) / 180);
          const dist = Math.max(1.5, s.h / fill / (2 * t), s.w / fill / (2 * t * aspect));
          const cam = c.clone().addScaledVector(n, dist);
          // park the (hidden) player well behind the camera: the rig fades meshes between the camera and him
          const pp = cam.clone().addScaledVector(n, 4);
          player.teleport(new THREE_V(pp.x, (world.heightAt?.(pp.x, pp.z) ?? 0) + 0.5, pp.z));
          player.frozen = true;
          if (player.model?.root) player.model.root.visible = false;
          rig.override = (camera) => {
            camera.fov = fov;
            camera.updateProjectionMatrix();
            camera.position.copy(cam);
            if (Math.abs(n.y) > 0.9) camera.up.set(0, 0, -1);
            else camera.up.set(0, 1, 0);
            camera.lookAt(c);
          };
          g.advance(0.3); // > DetailCuller's 0.25 s refresh, so small static details near the new camera are shown
          sx.drawImage(g.renderer.domElement, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch);
          const ground = world.heightAt ? world.heightAt(c.x, c.z) : 0;
          const warn = [];
          if (s.texAspect && Math.abs(Math.log(s.texAspect / (s.w / s.h))) > 0.12) warn.push(`STRETCH tex ${s.texAspect.toFixed(2)} vs face ${(s.w / s.h).toFixed(2)}`);
          const hy = c.y - ground;
          warn.push(`y+${hy.toFixed(1)}`);
          s.warn = warn;
          const x0 = (k % cols) * cw;
          const y0 = Math.floor(k / cols) * ch;
          sx.fillStyle = 'rgba(0,0,0,0.65)';
          sx.fillRect(x0, y0, cw, 34);
          sx.fillStyle = warn.some((w) => w.startsWith('STRETCH')) ? '#ff8' : '#fff';
          sx.font = 'bold 13px Arial';
          sx.textAlign = 'left';
          sx.textBaseline = 'top';
          sx.fillText(`#${s.i} ${s.src} ${s.w.toFixed(2)}x${s.h.toFixed(2)} @${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)}`, x0 + 4, y0 + 2);
          sx.font = '11px Arial';
          sx.fillText(`${(s.caller || '').slice(0, 70)} ${warn.join(' ')}`, x0 + 4, y0 + 19);
          sx.strokeStyle = '#000';
          sx.strokeRect(x0 + 0.5, y0 + 0.5, cw - 1, ch - 1);
        }
        rig.override = null;
        return { url: sheet.toDataURL('image/png'), meta: sel.map((s) => ({ i: s.i, src: s.src, caller: s.caller, warn: s.warn })) };
      },
      { s0, per, cols, rows, cw, ch, fill },
    );
    const file = path.join(out, `sheet-${String(sheet).padStart(2, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(data.url.split(',')[1], 'base64'));
    console.log(file, data.meta.map((m) => `#${m.i}${m.warn.some((w) => w.startsWith('STRETCH')) ? '!' : ''}`).join(' '));
  }
} catch (err) {
  console.log('ERROR:', err.message);
}
if (logs.length) console.log(logs.slice(0, 30).join('\n'));
await browser.close();
