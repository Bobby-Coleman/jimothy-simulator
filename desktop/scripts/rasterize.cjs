'use strict';
// Electron helper used by make-icons.mjs: rasterises an SVG or PNG into square PNGs.
//
//   electron scripts/rasterize.cjs <input.svg|png> <outDir> <size,size,...>
//
// Writes <outDir>/<size>.png for each size. Runs a hidden window with a 2D canvas (software rendering), so it works
// on any machine that can run the game's Electron — no system browser needed.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const [input, outDir, sizesArg] = process.argv.slice(2);
const sizes = String(sizesArg || '256')
  .split(',')
  .map(Number)
  .filter((n) => n > 0 && n <= 1024);

// Don't leave an %APPDATA%\Electron folder behind (make-icons.mjs passes a temp dir and deletes it afterwards).
const tmp = process.env.JIMOTHY_RASTER_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'jimothy-rasterize-'));
app.setPath('userData', tmp);
app.disableHardwareAcceleration();

function sourcesFor(file) {
  const buf = fs.readFileSync(file);
  if (/\.svg$/i.test(file)) {
    // Give the root <svg> an explicit size per output so each size is rendered from the vectors.
    let text = buf.toString('utf8');
    const sizeAttr = /(<svg\b[^>]*?)\s(?:width|height)="[^"]*"/i;
    while (sizeAttr.test(text)) text = text.replace(sizeAttr, '$1');
    return Object.fromEntries(
      sizes.map((n) => {
        const sized = text.replace(/<svg\b/i, `<svg width="${n}" height="${n}"`);
        return [n, 'data:image/svg+xml;base64,' + Buffer.from(sized).toString('base64')];
      }),
    );
  }
  const mime = /\.png$/i.test(file) ? 'image/png' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'application/octet-stream';
  const url = `data:${mime};base64,${buf.toString('base64')}`;
  return Object.fromEntries(sizes.map((n) => [n, url]));
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    if (!input || !outDir || !sizes.length) throw new Error('usage: electron rasterize.cjs <input> <outDir> <sizes>');
    const srcs = sourcesFor(input);
    const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL('data:text/html,<!doctype html><title>r</title>');
    const result = await win.webContents.executeJavaScript(`(async () => {
      const srcs = ${JSON.stringify(srcs)};
      const out = {};
      for (const n of Object.keys(srcs).map(Number)) {
        const img = new Image();
        img.src = srcs[n];
        await img.decode();
        // Downscale large rasters in halving steps (sharper small icons than one big drawImage).
        let cur = img, w = img.naturalWidth || n, h = img.naturalHeight || n;
        while (w / 2 >= n && h / 2 >= n) {
          const c = document.createElement('canvas');
          c.width = Math.round(w / 2); c.height = Math.round(h / 2);
          const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, c.width, c.height);
          cur = c; w = c.width; h = c.height;
        }
        const c = document.createElement('canvas');
        c.width = c.height = n;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        // Fit (contain) non-square images.
        const s = Math.min(n / w, n / h), dw = w * s, dh = h * s;
        ctx.drawImage(cur, (n - dw) / 2, (n - dh) / 2, dw, dh);
        out[n] = c.toDataURL('image/png');
      }
      return out;
    })()`);
    fs.mkdirSync(outDir, { recursive: true });
    for (const [n, url] of Object.entries(result)) {
      fs.writeFileSync(path.join(outDir, `${n}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(`[rasterize] ${path.basename(input)} -> ${Object.keys(result).join(', ')} px`);
  } catch (err) {
    console.error('[rasterize] failed:', err && err.message);
    code = 1;
  }
  app.exit(code);
});
