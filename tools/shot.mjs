// Headless playtest/screenshot helper.
//
//   node tools/shot.mjs [--url http://127.0.0.1:5173/] [--out tools/shots/shot.png]
//                       [--js "jimothy.advance(1)"] [--js-file path.js] [--wait 1500] [--size 1280x720]
//
// Loads the game (adds ?skipintro), waits for boot, optionally runs JS in the page (its return value is
// printed as JSON), takes a screenshot, and prints console errors/warnings. Uses the installed Chrome.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
let url = opt('url', 'http://127.0.0.1:5173/');
if (!/[?&]skipintro/.test(url)) url += (url.includes('?') ? '&' : '?') + 'skipintro';
const out = opt('out', 'tools/shots/shot.png');
const jsFile = opt('js-file', null);
const js = jsFile ? fs.readFileSync(jsFile, 'utf8') : opt('js', '');
const wait = Number(opt('wait', '1500'));
const [w, h] = opt('size', '1280x720').split('x').map(Number);

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) =>
  fs.existsSync(p),
);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push('[pageerror] ' + (e.stack || e.message)));
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.jimothy && window.jimothy.state !== 'boot', null, { timeout: 90000 });
  await page.waitForTimeout(wait);
  if (js) {
    const r = await page.evaluate(`(async () => { const g = window.jimothy; ${js.includes('return') ? js : 'return (' + js + ')'} })()`);
    if (r !== undefined) console.log('result:', JSON.stringify(r, null, 0).slice(0, 4000));
    await page.waitForTimeout(250);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log('screenshot:', out);
} catch (err) {
  console.log('ERROR:', err.message);
}
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
await browser.close();
