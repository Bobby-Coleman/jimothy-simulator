// Re-encode public/assets/textures/*/*.jpg smaller (no native deps: uses headless Chrome's canvas encoder).
//   node tools/compress-textures.mjs            (idempotent-ish: skips files already at/below target size)
// color: 1024 px, q 0.74 · normal: 512 px, q 0.82 · rough: 256 px, q 0.7
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = 'public/assets/textures';
const plan = { color: [1024, 0.74], normal: [512, 0.82], rough: [256, 0.7] };
const files = [];
for (const dir of fs.readdirSync(root)) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    const kind = path.basename(f, path.extname(f));
    if (/\.jpe?g$/i.test(f) && plan[kind]) files.push({ file: path.join(root, dir, f), kind });
  }
}
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
let before = 0, after = 0;
for (const { file, kind } of files) {
  const buf = fs.readFileSync(file);
  before += buf.length;
  const [size, q] = plan[kind];
  const out = await page.evaluate(async ({ b64, size, q }) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/jpeg' }));
    const w = Math.min(size, bmp.width), h = Math.min(size, bmp.height);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: q });
    const ab = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < ab.length; i += 0x8000) s += String.fromCharCode(...ab.subarray(i, i + 0x8000));
    return { b64: btoa(s), w, h };
  }, { b64: buf.toString('base64'), size, q });
  const nb = Buffer.from(out.b64, 'base64');
  if (nb.length < buf.length) {
    fs.writeFileSync(file, nb);
    after += nb.length;
    console.log(`${file}  ${(buf.length / 1024) | 0}KB -> ${(nb.length / 1024) | 0}KB (${out.w}x${out.h})`);
  } else {
    after += buf.length;
  }
}
console.log(`total ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB`);
await browser.close();
