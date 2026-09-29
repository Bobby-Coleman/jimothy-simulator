import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Procedural item models (charming, cheap, no files). Each builder returns a Group whose parts are
 * merged per material (1–4 draw calls per item). Named sub-groups ('lid', 'scoops', 'screen', …)
 * survive merging so wash reactions can poke at them.
 */

// ------------------------------------------------------------------ materials & textures
const mats = new Map<string, THREE.Material>();

/** Cached MeshStandardMaterial by key. */
export function M(key: string, p: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  let m = mats.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ roughness: 0.7, ...p });
    m.name = key;
    mats.set(key, m);
  }
  return m;
}

const texCache = new Map<string, THREE.CanvasTexture>();

/** Cached canvas texture. */
export function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

const FONT = '"Luckiest Guy", "Arial Black", Impact, sans-serif';
const SANS = '"Nunito", "Segoe UI", Arial, sans-serif';

/** Deterministic pseudo-random (so every copy of a texture looks the same). */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], pos?: [number, number, number], rot?: [number, number, number], scale?: [number, number, number] | number) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale != null) {
    if (typeof scale === 'number') m.scale.setScalar(scale);
    else m.scale.set(scale[0], scale[1], scale[2]);
  }
  return m;
}

const SPH = new THREE.SphereGeometry(1, 16, 12);
const SPH_LO = new THREE.SphereGeometry(1, 10, 8);
const BOX = new THREE.BoxGeometry(1, 1, 1);

// ------------------------------------------------------------------ merging
function attrSig(g: THREE.BufferGeometry) {
  return Object.keys(g.attributes).sort().join(',');
}

/**
 * Merge all meshes under `root` that share a material (and attribute layout) into one mesh each.
 * Children flagged `userData.keep` (and their subtrees) are kept as-is. Returns a new Group.
 */
export function mergeByMaterial(root: THREE.Object3D, name = root.name): THREE.Group {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  out.name = name;
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const kept: THREE.Object3D[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o !== root && o.userData.keep) {
      kept.push(o);
      return;
    }
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) {
      let g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
      const key = `${m.material.uuid}|${attrSig(g)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat: m.material, geos: [] }));
      b.geos.push(g);
    } else if (m.isMesh) {
      // multi-material meshes stay as they are
      kept.push(m);
      return;
    }
    for (const ch of o.children) visit(ch);
  };
  visit(root);
  for (const { mat, geos } of buckets.values()) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const mm = new THREE.Mesh(merged, mat);
    mm.castShadow = true;
    mm.receiveShadow = true;
    out.add(mm);
  }
  for (const k of kept) {
    // keep world placement relative to root
    k.updateMatrixWorld(true);
    const mtx = new THREE.Matrix4().multiplyMatrices(inv, k.matrixWorld);
    k.removeFromParent();
    mtx.decompose(k.position, k.quaternion, k.scale);
    out.add(k);
  }
  return out;
}

// ------------------------------------------------------------------ textures
function billTex() {
  return canvasTex('bill', 256, 120, (g, w, h) => {
    g.fillStyle = '#9cc98a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3d6b35';
    g.lineWidth = 6;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.lineWidth = 2;
    g.strokeRect(13, 13, w - 26, h - 26);
    // portrait oval: a round raccoon
    g.fillStyle = '#d7e8c9';
    g.beginPath();
    g.ellipse(w / 2, h / 2, 34, 40, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3d6b35';
    g.stroke();
    g.fillStyle = '#7d8a78';
    g.beginPath();
    g.arc(w / 2, h / 2 + 6, 22, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(w / 2 - 14, h / 2 - 14, 7, 0, Math.PI * 2);
    g.arc(w / 2 + 14, h / 2 - 14, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b3a28';
    g.fillRect(w / 2 - 17, h / 2, 34, 8);
    g.fillStyle = '#e8f0e0';
    g.fillRect(w / 2 - 5, h / 2 + 12, 10, 8);
    g.fillStyle = '#2f5a29';
    g.font = `700 13px ${SANS}`;
    g.textAlign = 'center';
    g.fillText('RACCOON RESERVE NOTE', w / 2, 27);
    g.fillText('IN TRASH WE TRUST', w / 2, h - 18);
    g.font = `900 26px ${FONT}`;
    g.fillText('1', 30, 44);
    g.fillText('1', w - 30, h - 24);
  });
}

function phoneScreenTex() {
  return canvasTex('phoneScreen', 128, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#6a5cff');
    gr.addColorStop(1, '#23b7e8');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.font = `800 30px ${SANS}`;
    g.fillText('12:34', w / 2, 52);
    // notification
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(10, 72, w - 20, 34);
    g.fillStyle = '#333';
    g.font = `700 11px ${SANS}`;
    g.fillText('#Jimothy is trending', w / 2, 93);
    const cols = ['#ff5a5f', '#ffd23f', '#3bd16f', '#3fa7ff', '#ff66c4', '#ff9a3c', '#a56bff', '#2ec4b6'];
    for (let i = 0; i < 8; i++) {
      g.fillStyle = cols[i];
      const x = 16 + (i % 4) * 26;
      const y = 130 + Math.floor(i / 4) * 30;
      g.fillRect(x, y, 20, 20);
    }
  });
}

function phoneBrokenTex() {
  return canvasTex('phoneBroken', 128, 256, (g, w, h) => {
    g.fillStyle = '#0c0d10';
    g.fillRect(0, 0, w, h);
    const r = prng(7);
    g.strokeStyle = 'rgba(220,230,255,0.75)';
    g.lineWidth = 1.5;
    const cx = w * 0.62;
    const cy = h * 0.35;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.moveTo(cx, cy);
      let x = cx;
      let y = cy;
      const a = (i / 9) * Math.PI * 2 + r();
      for (let k = 0; k < 5; k++) {
        x += Math.cos(a + (r() - 0.5)) * 22;
        y += Math.sin(a + (r() - 0.5)) * 22;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

function furTex(key: string, base: string, blotch: string[], n: number, alpha: number) {
  return canvasTex(key, 128, 128, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const r = prng(key.length * 97 + n);
    for (let i = 0; i < n; i++) {
      g.fillStyle = blotch[i % blotch.length];
      g.globalAlpha = alpha * (0.4 + r() * 0.6);
      g.beginPath();
      g.ellipse(r() * w, r() * h, 3 + r() * 16, 2 + r() * 11, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // fur strokes
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 160; i++) {
      const x = r() * w;
      const y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 6, y + 3 + r() * 5);
      g.stroke();
    }
  });
}

function cupTex() {
  return canvasTex('coffeeCup', 256, 128, (g, w, h) => {
    g.fillStyle = '#f7f5f0';
    g.fillRect(0, 0, w, h);
    const cx = w * 0.25;
    const cy = h * 0.52;
    g.fillStyle = '#1e7a4c';
    g.beginPath();
    g.arc(cx, cy, 34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f7f5f0';
    g.beginPath();
    g.arc(cx, cy, 26, 0, Math.PI * 2);
    g.fill();
    // tiny raccoon mask in the logo
    g.fillStyle = '#1e7a4c';
    g.beginPath();
    g.arc(cx, cy + 4, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f7f5f0';
    g.fillRect(cx - 12, cy - 1, 24, 5);
    g.fillStyle = '#1e7a4c';
    g.font = `800 15px ${SANS}`;
    g.textAlign = 'center';
    g.fillText('STARBREWS', w * 0.7, cy + 5);
  });
}

function waffleTex() {
  return canvasTex('waffle', 64, 64, (g, w, h) => {
    g.fillStyle = '#d99a4e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a8692c';
    g.lineWidth = 3;
    for (let i = -w; i < w * 2; i += 12) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h, h);
      g.stroke();
      g.beginPath();
      g.moveTo(i, h);
      g.lineTo(i + h, 0);
      g.stroke();
    }
  });
}

function cardFront(g: CanvasRenderingContext2D, w: number, h: number) {
  const gold = g.createLinearGradient(0, 0, w, h);
  gold.addColorStop(0, '#f7d56b');
  gold.addColorStop(0.5, '#c8961e');
  gold.addColorStop(1, '#ffe38a');
  g.fillStyle = gold;
  g.fillRect(0, 0, w, h);
  const sky = g.createLinearGradient(0, 20, 0, h - 60);
  sky.addColorStop(0, '#6ec3ff');
  sky.addColorStop(1, '#bfe6ff');
  g.fillStyle = sky;
  g.fillRect(18, 18, w - 36, h - 36);
  g.fillStyle = '#4c9a3f';
  g.fillRect(18, h * 0.62, w - 36, h * 0.38 - 18);
  // the round boy
  const cx = w / 2;
  const cy = h * 0.52;
  g.fillStyle = '#8d8f93';
  g.beginPath();
  g.arc(cx, cy, 62, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(cx - 44, cy - 50, 18, 0, Math.PI * 2);
  g.arc(cx + 44, cy - 50, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#23252a';
  g.beginPath();
  g.ellipse(cx, cy - 8, 50, 16, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(cx - 20, cy - 8, 7, 0, Math.PI * 2);
  g.arc(cx + 20, cy - 8, 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f2f2f2';
  g.beginPath();
  g.ellipse(cx, cy + 22, 22, 16, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(cx, cy + 16, 6, 0, Math.PI * 2);
  g.fill();
  // cap
  g.fillStyle = '#1c4f8a';
  g.beginPath();
  g.arc(cx, cy - 46, 34, Math.PI, 0);
  g.fill();
  g.fillRect(cx - 4, cy - 50, 50, 8);
  // banner
  g.fillStyle = '#1c4f8a';
  g.fillRect(18, h - 78, w - 36, 44);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = `900 34px ${FONT}`;
  g.fillText('JIMOTHY', w / 2, h - 44);
  g.fillStyle = '#c8961e';
  g.beginPath();
  g.arc(48, 52, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `900 13px ${SANS}`;
  g.fillText('ROOKIE', 48, 57);
  g.fillStyle = '#1c4f8a';
  g.font = `800 12px ${SANS}`;
  g.fillText('BALLARD BARNACLES  #1', w / 2, h - 22);
}

function cardFrontTex() {
  return canvasTex('cardFront', 256, 362, cardFront);
}

function cardDevaluedTex() {
  return canvasTex('cardDevalued', 256, 362, (g, w, h) => {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    cardFront(tmp.getContext('2d')!, w, h);
    g.filter = 'saturate(0.25) sepia(0.45) blur(1.2px)';
    g.drawImage(tmp, 0, 0);
    g.filter = 'none';
    const r = prng(42);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(120,85,40,${0.15 + r() * 0.2})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, 12 + r() * 40, 8 + r() * 30, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(r() * w, 0);
      g.lineTo(r() * w, h);
      g.stroke();
    }
  });
}

function cardBackTex() {
  return canvasTex('cardBack', 256, 362, (g, w, h) => {
    g.fillStyle = '#e9e1c9';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c8961e';
    g.lineWidth = 12;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#1c4f8a';
    g.textAlign = 'center';
    g.font = `900 24px ${FONT}`;
    g.fillText('JIMOTHY', w / 2, 56);
    g.font = `700 15px ${SANS}`;
    const lines = ['POS: Trash Panda', 'HT: Round', 'WT: Yes', 'BATS: Paws', 'SPECIAL: Washes things', '', '"Not a cat."'];
    lines.forEach((l, i) => g.fillText(l, w / 2, 100 + i * 28));
  });
}

function sodaTex() {
  return canvasTex('soda', 256, 128, (g, w, h) => {
    g.fillStyle = '#d42a2a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, h * 0.72);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.72 + Math.sin(x / 20) * 8);
    g.lineTo(w, h * 0.8);
    for (let x = w; x >= 0; x -= 8) g.lineTo(x, h * 0.8 + Math.sin(x / 20) * 8);
    g.fill();
    g.font = `900 34px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('RACCOLA', w * 0.3, h * 0.55);
    g.fillText('RACCOLA', w * 0.8, h * 0.55);
  });
}

function canTopTex() {
  return canvasTex('canTop', 64, 64, (g, w, h) => {
    g.fillStyle = '#c9ced3';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9aa1a8';
    g.beginPath();
    g.arc(w / 2, h / 2, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d7dbe0';
    g.beginPath();
    g.arc(w / 2, h / 2, 23, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#26282b';
    g.beginPath();
    g.ellipse(w / 2, h / 2 - 9, 7, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#aab1b8';
    g.fillRect(w / 2 - 5, h / 2 - 2, 10, 12);
  });
}

function newspaperTex() {
  return canvasTex('newspaper', 256, 352, (g, w, h) => {
    g.fillStyle = '#eeeae0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#222';
    g.textAlign = 'center';
    g.font = `900 22px Georgia, serif`;
    g.fillText('THE BALLARD BUGLE', w / 2, 32);
    g.fillRect(14, 40, w - 28, 3);
    g.font = `900 24px ${SANS}`;
    g.fillText('ROUND RACCOON', w / 2, 72);
    g.fillText('SPOTTED:', w / 2, 98);
    g.font = `900 20px ${SANS}`;
    g.fillText('"IS IT A CAT?"', w / 2, 124);
    // blurry cryptid photo
    g.fillStyle = '#9a9a9a';
    g.fillRect(20, 136, 110, 90);
    g.filter = 'blur(3px)';
    g.fillStyle = '#4a4a4a';
    g.beginPath();
    g.arc(75, 185, 26, 0, Math.PI * 2);
    g.fill();
    g.filter = 'none';
    g.fillStyle = '#777';
    for (let i = 0; i < 16; i++) g.fillRect(140, 140 + i * 11, 96, 4);
    for (let i = 0; i < 10; i++) g.fillRect(20, 236 + i * 11, 216, 4);
  });
}

function takeoutTex() {
  return canvasTex('takeout', 128, 128, (g, w, h) => {
    g.fillStyle = '#f7f4ee';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c62828';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(24, 60);
    g.lineTo(64, 36);
    g.lineTo(104, 60);
    g.stroke();
    g.strokeRect(38, 60, 52, 30);
    g.fillStyle = '#c62828';
    g.font = `800 13px ${SANS}`;
    g.textAlign = 'center';
    g.fillText('THANK YOU', w / 2, 112);
  });
}

function marbleTex() {
  return canvasTex('marble', 128, 64, (g, w, h) => {
    g.fillStyle = '#3aa0e8';
    g.fillRect(0, 0, w, h);
    const cols = ['#ffffff', '#ffd23f', '#ff5a8a'];
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = cols[k];
      g.lineWidth = 6;
      g.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = h / 2 + Math.sin((x / w) * Math.PI * 4 + k * 2) * (14 + k * 4);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

function crateTex() {
  return canvasTex('fireworksCrate', 256, 160, (g, w, h) => {
    g.fillStyle = '#b7803f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7d5226';
    g.lineWidth = 4;
    for (let y = 40; y < h; y += 40) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#d62828';
    g.font = `900 52px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('BOOM!', w / 2, 92);
    g.fillStyle = '#2b1a0c';
    g.font = `800 15px ${SANS}`;
    g.fillText('FIREWORKS  ·  DO NOT BONK', w / 2, 128);
  });
}

function propaneLabelTex() {
  return canvasTex('propaneLabel', 128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#d62828';
    g.fillRect(-40, -40, 80, 80);
    g.restore();
    g.fillStyle = '#fff';
    g.font = `900 16px ${SANS}`;
    g.textAlign = 'center';
    g.fillText('FLAMMABLE', w / 2, h / 2 + 6);
  });
}

function tvScreenTex() {
  return canvasTex('tvScreen', 256, 192, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#6fd0ff');
    gr.addColorStop(1, '#2a7bd1');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#7d7f84';
    g.beginPath();
    g.arc(w / 2, h * 0.45, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#23252a';
    g.fillRect(w / 2 - 34, h * 0.4, 68, 12);
    g.fillStyle = '#d62828';
    g.fillRect(0, h - 48, w, 34);
    g.fillStyle = '#fff';
    g.font = `900 17px ${SANS}`;
    g.textAlign = 'center';
    g.fillText('BREAKING: IT IS NOT A CAT', w / 2, h - 25);
  });
}

function vaseTex() {
  return canvasTex('vase', 128, 128, (g, w, h) => {
    g.fillStyle = '#f4f6fb';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2d5fb5';
    g.fillRect(0, 18, w, 8);
    g.fillRect(0, h - 26, w, 8);
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.arc(8 + i * 16, h / 2, 6, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(8 + i * 16, h / 2 - 16);
      g.quadraticCurveTo(16 + i * 16, h / 2 - 8, 8 + i * 16, h / 2);
      g.lineWidth = 2;
      g.strokeStyle = '#2d5fb5';
      g.stroke();
    }
  });
}

function dumpsterSignTex() {
  return canvasTex('dumpsterSign', 256, 112, (g, w, h) => {
    g.fillStyle = '#f2f2ee';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f5130';
    g.font = `900 20px ${SANS}`;
    g.textAlign = 'center';
    g.fillText('BALLARD DISPOSAL', w / 2 + 34, 34);
    g.fillStyle = '#c62828';
    g.font = `900 30px ${FONT}`;
    g.fillText('NO RACCOONS', w / 2 + 34, 76);
    // crossed-out round raccoon
    g.fillStyle = '#7d8086';
    g.beginPath();
    g.arc(46, 58, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#23252a';
    g.fillRect(24, 50, 44, 10);
    g.strokeStyle = '#c62828';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(46, 58, 34, 0, Math.PI * 2);
    g.moveTo(22, 34);
    g.lineTo(70, 82);
    g.stroke();
  });
}

// ------------------------------------------------------------------ wash-state materials

/** Cracked black screen (phones / TVs after a wash). */
export function brokenScreenMaterial() {
  return M('screenBroken', { map: phoneBrokenTex(), roughness: 0.15, metalness: 0.2 });
}

/** Faded, water-stained rookie card front. */
export function devaluedCardMaterial() {
  return M('cardDevalued', { map: cardDevaluedTex(), roughness: 0.9 });
}

/** Clean & fluffy teddy materials, keyed by the dirty material names they replace. */
export function teddyCleanMaterials(): Record<string, THREE.Material> {
  return {
    teddyDirty: M('teddyClean', { map: furTex('teddyCleanTex', '#cf9152', ['#e6b273', '#b97b40', '#f0c890'], 50, 0.35), roughness: 1 }),
    teddyMuzzleDirty: M('teddyMuzzleClean', { color: 0xf3dfbd, roughness: 1 }),
  };
}

/** A little pink bow (added to the teddy once it's clean). */
export function buildBow(): THREE.Group {
  const g = new THREE.Group();
  const pink = M('bow', { color: 0xff6fae, roughness: 0.5 });
  g.add(mesh(new THREE.ConeGeometry(0.035, 0.06, 8), pink, [0.032, 0, 0], [0, 0, Math.PI / 2]));
  g.add(mesh(new THREE.ConeGeometry(0.035, 0.06, 8), pink, [-0.032, 0, 0], [0, 0, -Math.PI / 2]));
  g.add(mesh(SPH_LO, pink, [0, 0, 0], undefined, 0.018));
  return mergeByMaterial(g, 'bow');
}

// ------------------------------------------------------------------ small shape helpers
function lathe(points: [number, number][], seg = 20) {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    seg,
  );
}

function blob(g: THREE.Group, mat: THREE.Material, x: number, y: number, z: number, r: number, sx = 1, sy = 1, sz = 1, lo = false) {
  g.add(mesh(lo ? SPH_LO : SPH, mat, [x, y, z], undefined, [r * sx, r * sy, r * sz]));
}

// ------------------------------------------------------------------ item builders
export const BUILD: Record<string, () => THREE.Object3D> = {
  cottonCandy() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.ConeGeometry(0.038, 0.26, 12), M('paperCone', { color: 0xf6efe0, roughness: 0.9 }), [0, 0.13, 0], [Math.PI, 0, 0]));
    const pink = M('cottonCandy', { color: 0xff8fcb, roughness: 1, emissive: 0x4a1030 });
    const pink2 = M('cottonCandy2', { color: 0xffb8de, roughness: 1, emissive: 0x3a1028 });
    const puffs: [number, number, number, number, number][] = [
      [0, 0.37, 0, 0.12, 0],
      [0.075, 0.34, 0.035, 0.095, 1],
      [-0.075, 0.35, -0.02, 0.1, 0],
      [0.02, 0.45, -0.05, 0.085, 1],
      [-0.03, 0.44, 0.06, 0.08, 0],
      [0.055, 0.29, -0.06, 0.07, 1],
      [-0.05, 0.3, 0.06, 0.075, 0],
      [0.06, 0.41, 0.06, 0.06, 1],
    ];
    for (const [x, y, z, r, k] of puffs) blob(g, k ? pink2 : pink, x, y, z, r);
    return mergeByMaterial(g);
  },

  cash() {
    const g = new THREE.Group();
    const bill = M('bill', { map: billTex(), roughness: 0.85 });
    for (let i = 0; i < 3; i++) g.add(mesh(BOX, bill, [0, 0.008 + i * 0.013, 0], [0, (i - 1) * 0.12, 0], [0.3, 0.012, 0.14]));
    g.add(mesh(BOX, M('cashBand', { color: 0xe8d38a, roughness: 0.8 }), [0, 0.022, 0], undefined, [0.05, 0.042, 0.146]));
    return mergeByMaterial(g);
  },

  phone() {
    const g = new THREE.Group();
    g.add(mesh(new RoundedBoxGeometry(0.17, 0.024, 0.32, 2, 0.02), M('phoneBody', { color: 0x23262b, roughness: 0.35, metalness: 0.4 }), [0, 0.012, 0]));
    const body = mergeByMaterial(g);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.29).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: phoneScreenTex(), emissive: 0xffffff, emissiveMap: phoneScreenTex(), emissiveIntensity: 0.85, roughness: 0.15 }),
    );
    screen.name = 'screen';
    screen.position.y = 0.0245;
    body.add(screen);
    return body;
  },

  teddy() {
    const g = new THREE.Group();
    const fur = M('teddyDirty', { map: furTex('teddyDirtyTex', '#6e5236', ['#3b2a1a', '#4a3a2a', '#7d776a', '#2f2418'], 60, 0.75), roughness: 1 });
    const muzzle = M('teddyMuzzleDirty', { color: 0x8a7358, roughness: 1 });
    const dark = M('teddyEye', { color: 0x151515, roughness: 0.3 });
    blob(g, fur, 0, 0.15, 0, 0.125, 1, 1.1, 0.9);
    blob(g, fur, 0, 0.335, 0.005, 0.1);
    blob(g, fur, 0.075, 0.415, 0, 0.042, 1, 1, 0.6);
    blob(g, fur, -0.075, 0.415, 0, 0.042, 1, 1, 0.6);
    blob(g, muzzle, 0.075, 0.415, 0.012, 0.024, 1, 1, 0.5);
    blob(g, muzzle, -0.075, 0.415, 0.012, 0.024, 1, 1, 0.5);
    blob(g, muzzle, 0, 0.31, 0.078, 0.046, 1, 0.8, 0.75);
    blob(g, muzzle, 0, 0.15, 0.085, 0.075, 1, 1.1, 0.4);
    blob(g, dark, 0, 0.325, 0.118, 0.016, 1.2, 1, 1, true);
    blob(g, dark, 0.036, 0.365, 0.085, 0.014, 1, 1, 1, true);
    blob(g, dark, -0.036, 0.365, 0.085, 0.014, 1, 1, 1, true);
    for (const s of [-1, 1]) {
      const arm = mesh(SPH, fur, [s * 0.125, 0.2, 0.02], [0, 0, s * 0.55], [0.045, 0.075, 0.045]);
      g.add(arm);
      g.add(mesh(SPH, fur, [s * 0.068, 0.045, 0.055], undefined, [0.055, 0.05, 0.075]));
      g.add(mesh(SPH_LO, muzzle, [s * 0.068, 0.04, 0.125], undefined, [0.035, 0.032, 0.012]));
    }
    return mergeByMaterial(g);
  },

  fish() {
    const g = new THREE.Group();
    const bodyGeo = new THREE.SphereGeometry(1, 20, 14);
    const pos = bodyGeo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x3d5a70);
    const side = new THREE.Color(0xc9d6de);
    const belly = new THREE.Color(0xf2c7bc);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 0.15) c.copy(side).lerp(top, Math.min(1, (y - 0.15) / 0.55));
      else c.copy(side).lerp(belly, Math.min(1, (0.15 - y) / 0.7));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    bodyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.add(mesh(bodyGeo, M('fishBody', { vertexColors: true, roughness: 0.35, metalness: 0.25 }), [0, 0.11, 0], undefined, [0.07, 0.11, 0.26]));
    const fin = M('fishFin', { color: 0x6f8797, roughness: 0.5, side: THREE.DoubleSide });
    g.add(mesh(new THREE.ConeGeometry(0.1, 0.14, 4), fin, [0, 0.11, -0.3], [Math.PI / 2, 0, 0], [0.18, 1, 1]));
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.1, 4), fin, [0, 0.22, -0.02], [-0.5, 0, 0], [0.15, 1, 1]));
    const eye = M('fishEye', { color: 0x111111, roughness: 0.2 });
    g.add(mesh(SPH_LO, eye, [0.055, 0.14, 0.19], undefined, 0.014));
    g.add(mesh(SPH_LO, eye, [-0.055, 0.14, 0.19], undefined, 0.014));
    return mergeByMaterial(g);
  },

  soap() {
    const g = new THREE.Group();
    const tex = canvasTex('soapTex', 128, 64, (c, w, h) => {
      c.fillStyle = '#ff9ec7';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffc9df';
      c.font = `900 30px ${FONT}`;
      c.textAlign = 'center';
      c.fillText('SOAP', w / 2, h / 2 + 11);
    });
    g.add(mesh(new RoundedBoxGeometry(0.2, 0.08, 0.13, 3, 0.03), M('soap', { map: tex, roughness: 0.3 }), [0, 0.04, 0]));
    return mergeByMaterial(g);
  },

  rubberDuck() {
    const g = new THREE.Group();
    const yellow = M('duck', { color: 0xffd21f, roughness: 0.35 });
    const orange = M('duckBeak', { color: 0xff8a1e, roughness: 0.4 });
    const dark = M('teddyEye', { color: 0x151515, roughness: 0.3 });
    blob(g, yellow, 0, 0.095, 0, 0.12, 1, 0.78, 1.25);
    blob(g, yellow, 0, 0.2, 0.08, 0.075);
    blob(g, yellow, 0.1, 0.11, -0.01, 0.05, 0.5, 0.7, 1.3);
    blob(g, yellow, -0.1, 0.11, -0.01, 0.05, 0.5, 0.7, 1.3);
    g.add(mesh(new THREE.ConeGeometry(0.045, 0.09, 10), yellow, [0, 0.16, -0.15], [-2.2, 0, 0]));
    blob(g, orange, 0, 0.19, 0.155, 0.035, 1.2, 0.5, 1.4);
    blob(g, dark, 0.035, 0.225, 0.13, 0.012, 1, 1, 1, true);
    blob(g, dark, -0.035, 0.225, 0.13, 0.012, 1, 1, 1, true);
    return mergeByMaterial(g);
  },

  pizza() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.035, 28), M('crust', { color: 0xdca35a, roughness: 0.85 }), [0, 0.0175, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.012, 28), M('cheese', { color: 0xf7c948, roughness: 0.6 }), [0, 0.04, 0]));
    const pep = M('pepperoni', { color: 0xb8402e, roughness: 0.55 });
    const disc = new THREE.CylinderGeometry(0.036, 0.036, 0.008, 12);
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i === 8 ? 0 : i % 2 ? 0.17 : 0.1;
      g.add(mesh(disc, pep, [Math.cos(a) * r, 0.049, Math.sin(a) * r]));
    }
    return mergeByMaterial(g);
  },

  sandwich() {
    const g = new THREE.Group();
    const bread = M('bread', { color: 0xe8c07a, roughness: 0.9 });
    g.add(mesh(new RoundedBoxGeometry(0.26, 0.04, 0.26, 2, 0.015), bread, [0, 0.02, 0]));
    g.add(mesh(BOX, M('lettuce', { color: 0x7cc44a, roughness: 0.7 }), [0, 0.045, 0], [0, 0.1, 0], [0.285, 0.012, 0.285]));
    const tom = M('tomato', { color: 0xd9412e, roughness: 0.5 });
    for (const [x, z] of [
      [-0.06, -0.05],
      [0.06, 0.03],
      [-0.02, 0.07],
    ])
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14), tom, [x, 0.057, z]));
    g.add(mesh(BOX, M('cheese', { color: 0xf7c948, roughness: 0.6 }), [0, 0.066, 0], [0, Math.PI / 4, 0], [0.25, 0.008, 0.25]));
    g.add(mesh(new RoundedBoxGeometry(0.26, 0.04, 0.26, 2, 0.015), bread, [0, 0.09, 0]));
    return mergeByMaterial(g);
  },

  coffee() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.075, 0.056, 0.2, 20), [M('cupSide', { map: cupTex(), roughness: 0.6 }), M('cupWhite', { color: 0xf7f5f0, roughness: 0.6 }), M('cupWhite', {})], [0, 0.1, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.0725, 0.066, 0.07, 20, 1, true), M('cupSleeve', { color: 0xb07b4f, roughness: 0.9, side: THREE.DoubleSide }), [0, 0.09, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.079, 0.079, 0.018, 20), M('cupLid', { color: 0xf2efe9, roughness: 0.5 }), [0, 0.205, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.014, 20), M('cupLid', {}), [0, 0.219, 0]));
    const merged = mergeByMaterial(g);
    return merged;
  },

  iceCream() {
    const root = new THREE.Group();
    const cone = new THREE.Group();
    cone.add(mesh(new THREE.ConeGeometry(0.062, 0.2, 16), M('waffle', { map: waffleTex(), roughness: 0.9 }), [0, 0.1, 0], [Math.PI, 0, 0]));
    root.add(mergeByMaterial(cone, 'cone'));
    const scoops = new THREE.Group();
    const pink = M('scoopPink', { color: 0xff9ec4, roughness: 0.55 });
    const mint = M('scoopMint', { color: 0x9ff0cf, roughness: 0.55 });
    blob(scoops, pink, 0, 0.215, 0, 0.068);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      blob(scoops, pink, Math.cos(a) * 0.058, 0.195, Math.sin(a) * 0.058, 0.02, 1, 1.4, 1, true);
    }
    blob(scoops, mint, 0, 0.3, 0.005, 0.062);
    blob(scoops, M('cherry', { color: 0xd62839, roughness: 0.3 }), 0, 0.372, 0, 0.02);
    scoops.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.05), M('stem', { color: 0x5b3a1e }), [0.01, 0.4, 0], [0, 0, -0.4]));
    const s = mergeByMaterial(scoops, 'scoops');
    root.add(s);
    return root;
  },

  diploma() {
    const root = new THREE.Group();
    const paper = M('diplomaPaper', { color: 0xf4ecd4, roughness: 0.85 });
    const endTex = canvasTex('scrollEnd', 64, 64, (g, w, h) => {
      g.fillStyle = '#f4ecd4';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#b9ab85';
      g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * Math.PI * 6;
        const r = 3 + (i / 60) * 26;
        const x = w / 2 + Math.cos(a) * r;
        const y = h / 2 + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    });
    const endMat = M('diplomaEnd', { map: endTex, roughness: 0.85 });
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.name = s < 0 ? 'scrollL' : 'scrollR';
      const half = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.17, 18), [paper, endMat, endMat]);
      half.rotation.z = Math.PI / 2;
      half.position.x = s * 0.1;
      half.castShadow = true;
      pivot.add(half);
      pivot.position.y = 0.036;
      root.add(pivot);
    }
    const red = M('ribbon', { color: 0xc62828, roughness: 0.5 });
    root.add(mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.035, 18), red, [0, 0.036, 0], [0, 0, Math.PI / 2]));
    root.add(mesh(BOX, red, [0.012, 0.0, 0.03], [0.4, 0, 0.3], [0.016, 0.07, 0.004]));
    root.add(mesh(BOX, red, [-0.012, 0.0, 0.03], [0.4, 0, -0.3], [0.016, 0.07, 0.004]));
    return root;
  },

  rookieCard() {
    const g = new THREE.Group();
    const gold = M('cardGold', { color: 0xe0b23a, metalness: 0.8, roughness: 0.3 });
    const front = new THREE.MeshStandardMaterial({ map: cardFrontTex(), roughness: 0.35, metalness: 0.1 });
    front.name = 'cardFront';
    const back = M('cardBack', { map: cardBackTex(), roughness: 0.6 });
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.008, 0.24), [gold, gold, front, back, gold, gold]);
    card.position.y = 0.004;
    card.name = 'card';
    card.castShadow = true;
    g.add(card);
    return g;
  },

  spoon() {
    const g = new THREE.Group();
    const silver = M('silver', { color: 0xdfe3e8, metalness: 1, roughness: 0.22 });
    g.add(mesh(new RoundedBoxGeometry(0.024, 0.01, 0.2, 2, 0.004), silver, [0, 0.006, -0.06]));
    g.add(mesh(SPH, silver, [0, 0.012, 0.09], undefined, [0.046, 0.016, 0.062]));
    return mergeByMaterial(g);
  },

  bottleCap() {
    const g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.05, 0.052, 0.022, 28, 1);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r > 0.045) {
        const a = Math.atan2(z, x);
        const k = 1 + 0.07 * Math.sign(Math.sin(a * 14));
        p.setX(i, x * k);
        p.setZ(i, z * k);
      }
    }
    geo.computeVertexNormals();
    const topTex = canvasTex('capTop', 64, 64, (c, w, h) => {
      c.fillStyle = '#c0392b';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffd23f';
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 ? 9 : 20;
        c.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      }
      c.fill();
    });
    const gold = M('capGold', { color: 0xd4a93b, metalness: 1, roughness: 0.28 });
    g.add(mesh(geo, [gold, M('capTop', { map: topTex, metalness: 0.6, roughness: 0.3 }), gold], [0, 0.011, 0]));
    return g;
  },

  key() {
    const g = new THREE.Group();
    const brass = M('brass', { color: 0xd9b44a, metalness: 1, roughness: 0.3 });
    g.add(mesh(new THREE.TorusGeometry(0.036, 0.012, 8, 20), brass, [0, 0.012, 0.1], [Math.PI / 2, 0, 0]));
    g.add(mesh(BOX, brass, [0, 0.012, -0.005], undefined, [0.018, 0.014, 0.14]));
    g.add(mesh(BOX, brass, [0.014, 0.012, -0.05], undefined, [0.014, 0.012, 0.018]));
    g.add(mesh(BOX, brass, [0.012, 0.012, -0.068], undefined, [0.01, 0.012, 0.014]));
    return mergeByMaterial(g);
  },

  ring() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.TorusGeometry(0.046, 0.012, 10, 28), M('gold', { color: 0xf2c14e, metalness: 1, roughness: 0.18 }), [0, 0.012, 0], [Math.PI / 2, 0, 0]));
    g.add(mesh(new THREE.OctahedronGeometry(0.028), M('gem', { color: 0x6fd6ff, metalness: 0.2, roughness: 0.05, emissive: 0x0b3a52 }), [0, 0.03, 0.05], [0, 0.4, 0], [1, 1.2, 1]));
    return mergeByMaterial(g);
  },

  marble() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.06, 20, 14), M('marble', { map: marbleTex(), roughness: 0.05, metalness: 0.1 }), [0, 0.06, 0]));
    return g;
  },

  grapes() {
    const g = new THREE.Group();
    const purple = M('grape', { color: 0x7a3aa0, roughness: 0.35 });
    const rows = [
      [0.26, 4, 0.06],
      [0.2, 5, 0.055],
      [0.14, 4, 0.04],
      [0.085, 3, 0.025],
      [0.04, 1, 0],
    ] as const;
    let k = 0;
    for (const [y, n, r] of rows) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + k * 0.7;
        blob(g, purple, Math.cos(a) * r, y, Math.sin(a) * r, 0.036, 1, 1.08, 1, true);
      }
      k++;
    }
    g.add(mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.07), M('stem', { color: 0x5b3a1e }), [0, 0.32, 0]));
    blob(g, M('leaf', { color: 0x4f9a3a, roughness: 0.6 }), 0.04, 0.33, 0, 0.05, 1, 0.2, 0.7, true);
    return mergeByMaterial(g);
  },

  bananaPeel() {
    const g = new THREE.Group();
    const yellow = M('peel', { color: 0xf2d544, roughness: 0.55 });
    const brown = M('peelTip', { color: 0x5b3b1a, roughness: 0.7 });
    blob(g, yellow, 0, 0.022, 0, 0.042, 1, 0.55, 1);
    for (let i = 0; i < 4; i++) {
      const flap = new THREE.Group();
      flap.rotation.y = (i / 4) * Math.PI * 2 + 0.3;
      flap.add(mesh(SPH, yellow, [0, 0.014, 0.085], [0.12, 0, 0], [0.036, 0.011, 0.085]));
      flap.add(mesh(SPH_LO, brown, [0, 0.006, 0.165], undefined, [0.02, 0.008, 0.02]));
      g.add(flap);
    }
    g.add(mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.05, 8), brown, [0, 0.05, 0], [0.3, 0, 0]));
    return mergeByMaterial(g);
  },

  sodaCan() {
    const g = new THREE.Group();
    const top = M('canTop', { map: canTopTex(), metalness: 0.8, roughness: 0.3 });
    g.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.19, 20), [M('soda', { map: sodaTex(), metalness: 0.5, roughness: 0.35 }), top, top], [0, 0.095, 0]));
    return g;
  },

  appleCore() {
    const pts: [number, number][] = [
      [0.0, 0],
      [0.035, 0.004],
      [0.05, 0.02],
      [0.047, 0.036],
      [0.027, 0.052],
      [0.021, 0.08],
      [0.025, 0.11],
      [0.045, 0.13],
      [0.05, 0.146],
      [0.034, 0.162],
      [0.0, 0.166],
    ];
    const geo = lathe(pts.map(([x, y]) => [x * 1.4, y * 1.4]) as [number, number][], 16);
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const red = new THREE.Color(0xc0392b);
    const flesh = new THREE.Color(0xf1e3b0);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1.4;
      const t = y < 0.03 ? 1 - y / 0.03 : y > 0.136 ? (y - 0.136) / 0.03 : 0;
      c.copy(flesh).lerp(red, Math.min(1, t));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const g = new THREE.Group();
    g.add(mesh(geo, M('appleCore', { vertexColors: true, roughness: 0.7 })));
    g.add(mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.05), M('stem', { color: 0x5b3a1e }), [0, 0.25, 0], [0.3, 0, 0]));
    const seed = M('seed', { color: 0x2b1a0c, roughness: 0.5 });
    g.add(mesh(SPH_LO, seed, [0.026, 0.12, 0.012], undefined, [0.006, 0.011, 0.005]));
    g.add(mesh(SPH_LO, seed, [-0.02, 0.1, 0.02], undefined, [0.006, 0.011, 0.005]));
    return mergeByMaterial(g);
  },

  fishBones() {
    const g = new THREE.Group();
    const bone = M('bone', { color: 0xeee6d2, roughness: 0.6 });
    g.add(mesh(BOX, bone, [0, 0.012, 0], undefined, [0.016, 0.016, 0.34]));
    for (let i = 0; i < 6; i++) {
      const z = -0.11 + i * 0.045;
      const len = 0.06 + Math.sin((i / 5) * Math.PI) * 0.05;
      for (const s of [-1, 1]) g.add(mesh(BOX, bone, [s * len * 0.5, 0.012, z], [0, s * 0.35, 0], [len, 0.008, 0.008]));
    }
    g.add(mesh(new THREE.ConeGeometry(0.06, 0.12, 8), bone, [0, 0.03, 0.22], [Math.PI / 2, 0, 0], [0.5, 1, 1]));
    g.add(mesh(new THREE.ConeGeometry(0.06, 0.08, 4), bone, [0, 0.02, -0.21], [-Math.PI / 2, 0, 0], [0.15, 1, 1]));
    g.add(mesh(SPH_LO, M('teddyEye', { color: 0x151515 }), [0.02, 0.045, 0.22], undefined, 0.012));
    return mergeByMaterial(g);
  },

  takeout() {
    const g = new THREE.Group();
    const box = new THREE.CylinderGeometry(0.11, 0.08, 0.16, 4, 1);
    box.rotateY(Math.PI / 4);
    g.add(mesh(box, [M('takeout', { map: takeoutTex(), roughness: 0.8 }), M('takeoutPlain', { color: 0xf7f4ee, roughness: 0.8 }), M('takeoutPlain', {})], [0, 0.08, 0]));
    g.add(mesh(new THREE.TorusGeometry(0.075, 0.004, 4, 16, Math.PI), M('wire', { color: 0x8a8f96, metalness: 0.8, roughness: 0.4 }), [0, 0.16, 0]));
    return mergeByMaterial(g);
  },

  newspaper() {
    const g = new THREE.Group();
    const plain = M('newsPlain', { color: 0xe9e5da, roughness: 0.9 });
    const top = M('news', { map: newspaperTex(), roughness: 0.9 });
    g.add(mesh(new THREE.BoxGeometry(0.24, 0.025, 0.33), [plain, plain, top, plain, plain, plain], [0, 0.0125, 0]));
    return g;
  },

  goldenTrophy() {
    const g = new THREE.Group();
    const gold = M('trophyGold', { color: 0xffc83d, metalness: 1, roughness: 0.2, emissive: 0x3a2400 });
    g.add(mesh(BOX, M('trophyWood', { color: 0x5a3a1e, roughness: 0.6 }), [0, 0.025, 0], undefined, [0.15, 0.05, 0.15]));
    g.add(mesh(BOX, gold, [0, 0.065, 0], undefined, [0.105, 0.03, 0.105]));
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.07, 12), gold, [0, 0.115, 0]));
    const cupGeo = lathe(
      [
        [0.0, 0],
        [0.025, 0.0],
        [0.05, 0.03],
        [0.066, 0.08],
        [0.072, 0.13],
        [0.064, 0.132],
        [0.058, 0.09],
      ],
      20,
    );
    g.add(mesh(cupGeo, gold, [0, 0.15, 0]));
    for (const s of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(0.035, 0.009, 8, 14, Math.PI), gold, [s * 0.07, 0.23, 0], [0, 0, s * -Math.PI / 2]));
    // a tiny golden round boy peeking out of the cup
    blob(g, gold, 0, 0.29, 0, 0.045);
    blob(g, gold, 0.03, 0.33, 0, 0.014, 1, 1, 1, true);
    blob(g, gold, -0.03, 0.33, 0, 0.014, 1, 1, 1, true);
    return mergeByMaterial(g);
  },

  vase() {
    const g = new THREE.Group();
    const geo = lathe(
      [
        [0.0, 0],
        [0.07, 0],
        [0.085, 0.03],
        [0.12, 0.13],
        [0.112, 0.24],
        [0.065, 0.32],
        [0.052, 0.37],
        [0.07, 0.42],
        [0.064, 0.425],
        [0.046, 0.38],
      ],
      24,
    );
    g.add(mesh(geo, M('vase', { map: vaseTex(), roughness: 0.2, side: THREE.DoubleSide })));
    return g;
  },

  glassBottle() {
    const g = new THREE.Group();
    const geo = lathe(
      [
        [0.0, 0],
        [0.05, 0],
        [0.056, 0.01],
        [0.056, 0.19],
        [0.045, 0.24],
        [0.02, 0.28],
        [0.018, 0.33],
        [0.022, 0.34],
        [0.0, 0.342],
      ],
      18,
    );
    g.add(mesh(geo, M('glassGreen', { color: 0x2f8f4a, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.75 })));
    g.add(mesh(new THREE.CylinderGeometry(0.0575, 0.0575, 0.07, 18, 1, true), M('label', { color: 0xf1e6c8, roughness: 0.8 }), [0, 0.1, 0]));
    return mergeByMaterial(g);
  },

  tv() {
    const root = new THREE.Group();
    const g = new THREE.Group();
    const shell = M('tvShell', { color: 0x4a4d52, roughness: 0.55 });
    g.add(mesh(new RoundedBoxGeometry(0.52, 0.42, 0.34, 2, 0.03), shell, [0, 0.21, 0.05]));
    g.add(mesh(BOX, M('tvBack', { color: 0x36383c, roughness: 0.6 }), [0, 0.2, -0.19], undefined, [0.38, 0.3, 0.14]));
    const knob = M('tvKnob', { color: 0xc9ccd1, metalness: 0.6, roughness: 0.35 });
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 10), knob, [0.21, 0.28, 0.225], [Math.PI / 2, 0, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 10), knob, [0.21, 0.2, 0.225], [Math.PI / 2, 0, 0]));
    g.add(mesh(new THREE.SphereGeometry(0.04, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell, [0, 0.42, 0]));
    const ant = M('antenna', { color: 0xb8bcc2, metalness: 0.9, roughness: 0.3 });
    g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3), ant, [0.07, 0.55, 0], [0, 0, -0.5]));
    g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3), ant, [-0.07, 0.55, 0], [0, 0, 0.5]));
    root.add(mergeByMaterial(g, 'shell'));
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.38, 0.29),
      new THREE.MeshStandardMaterial({ map: tvScreenTex(), emissive: 0xffffff, emissiveMap: tvScreenTex(), emissiveIntensity: 0.8, roughness: 0.1 }),
    );
    screen.name = 'screen';
    screen.position.set(-0.03, 0.22, 0.2215);
    root.add(screen);
    return root;
  },

  glassPane() {
    const g = new THREE.Group();
    const wood = M('paneFrame', { color: 0xf0ede4, roughness: 0.6 });
    g.add(mesh(BOX, M('glassPane', { color: 0xcdeeff, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.35 }), [0, 0.45, 0], undefined, [0.92, 0.72, 0.02]));
    g.add(mesh(BOX, wood, [0, 0.03, 0], undefined, [1.0, 0.06, 0.05]));
    g.add(mesh(BOX, wood, [0, 0.84, 0], undefined, [1.0, 0.06, 0.05]));
    g.add(mesh(BOX, wood, [-0.47, 0.45, 0], undefined, [0.06, 0.78, 0.05]));
    g.add(mesh(BOX, wood, [0.47, 0.45, 0], undefined, [0.06, 0.78, 0.05]));
    return mergeByMaterial(g);
  },

  propaneTank() {
    const root = new THREE.Group();
    const g = new THREE.Group();
    const white = M('propane', { color: 0xf0f0ee, roughness: 0.4, metalness: 0.3 });
    const grey = M('propaneGrey', { color: 0x8d9298, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
    const brass = M('brass', { color: 0xd9b44a, metalness: 1, roughness: 0.3 });
    g.add(mesh(new THREE.CapsuleGeometry(0.15, 0.26, 6, 16), white, [0, 0.29, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.07, 20, 1, true), grey, [0, 0.035, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.1, 16, 1, true), grey, [0, 0.61, 0]));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10), brass, [0, 0.6, 0]));
    g.add(mesh(new THREE.TorusGeometry(0.032, 0.008, 6, 14), brass, [0, 0.64, 0], [Math.PI / 2, 0, 0]));
    root.add(mergeByMaterial(g));
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1515, 0.1515, 0.2, 16, 1, true, -0.55, 1.1),
      new THREE.MeshStandardMaterial({ map: propaneLabelTex(), transparent: true, roughness: 0.5, alphaTest: 0.2 }),
    );
    label.position.y = 0.3;
    root.add(label);
    return root;
  },

  gasCan() {
    const g = new THREE.Group();
    const red = M('gasCan', { color: 0xc62828, roughness: 0.45 });
    const dark = M('gasCanDark', { color: 0x9b1c1c, roughness: 0.5 });
    g.add(mesh(new RoundedBoxGeometry(0.32, 0.36, 0.15, 2, 0.025), red, [0, 0.18, 0]));
    for (const s of [-1, 1]) {
      g.add(mesh(BOX, dark, [0, 0.18, s * 0.076], [0, 0, 0.85], [0.36, 0.03, 0.01]));
      g.add(mesh(BOX, dark, [0, 0.18, s * 0.076], [0, 0, -0.85], [0.36, 0.03, 0.01]));
    }
    g.add(mesh(BOX, dark, [-0.03, 0.4, 0], undefined, [0.16, 0.025, 0.035]));
    g.add(mesh(BOX, dark, [-0.1, 0.38, 0], undefined, [0.025, 0.05, 0.035]));
    g.add(mesh(BOX, dark, [0.04, 0.38, 0], undefined, [0.025, 0.05, 0.035]));
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.1, 10), M('gasSpout', { color: 0xf2c12e, roughness: 0.5 }), [0.13, 0.4, 0], [0, 0, -0.6]));
    return mergeByMaterial(g);
  },

  fireworksCrate() {
    const g = new THREE.Group();
    const side = M('crateSide', { map: crateTex(), roughness: 0.8 });
    const plain = M('cratePlain', { color: 0x9a6a35, roughness: 0.85 });
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.32, 0.34), [side, side, plain, plain, side, side], [0, 0.16, 0]));
    const cols = [0xff4d4d, 0xffd23f, 0x3fa7ff, 0x3bd16f, 0xff66c4, 0xa56bff, 0xff9a3c];
    const tube = new THREE.CylinderGeometry(0.022, 0.022, 0.22, 10);
    const tip = new THREE.ConeGeometry(0.03, 0.06, 10);
    const fuse = M('fuse', { color: 0x222222, roughness: 0.8 });
    for (let i = 0; i < 7; i++) {
      const x = -0.17 + (i % 4) * 0.11 + (i >= 4 ? 0.055 : 0);
      const z = i >= 4 ? 0.06 : -0.06;
      const m = M(`rocket${i}`, { color: cols[i], roughness: 0.5 });
      g.add(mesh(tube, m, [x, 0.33 + (i % 3) * 0.02, z], [(i % 2 ? 0.08 : -0.08), 0, (i % 3 - 1) * 0.08]));
      g.add(mesh(tip, m, [x, 0.47 + (i % 3) * 0.02, z]));
    }
    g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12), fuse, [0.2, 0.36, 0.12], [0.5, 0, -0.4]));
    return mergeByMaterial(g);
  },
};

// ------------------------------------------------------------------ trash can / dumpster parts

/** Galvanised trash can (1 m). Returns root with children 'body' and 'lid'. */
export function buildTrashCan(): THREE.Group {
  const root = new THREE.Group();
  const metal = M('canMetal', { color: 0x9aa3a8, metalness: 0.7, roughness: 0.42, side: THREE.DoubleSide });
  const dark = M('canInside', { color: 0x2c2f33, roughness: 0.9 });
  const body = new THREE.Group();
  body.add(mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.9, 24, 1, true), metal, [0, 0.45, 0]));
  body.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 24), metal, [0, 0.01, 0]));
  for (const y of [0.22, 0.46, 0.7]) {
    const r = 0.27 + 0.03 * (y / 0.9) + 0.004;
    body.add(mesh(new THREE.TorusGeometry(r, 0.012, 6, 28), metal, [0, y, 0], [Math.PI / 2, 0, 0]));
  }
  for (const s of [-1, 1]) body.add(mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), metal, [s * 0.305, 0.78, 0], [0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0]));
  body.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.01, 20), dark, [0, 0.82, 0]));
  const paper = M('paperBall', { color: 0xefeee8, roughness: 0.95 });
  blob(body, paper, 0.08, 0.85, 0.05, 0.06, 1, 1, 1, true);
  blob(body, M('bag', { color: 0x2b2f2a, roughness: 0.6 }), -0.07, 0.84, -0.04, 0.09, 1, 0.6, 1, true);
  root.add(mergeByMaterial(body, 'body'));
  const lid = new THREE.Group();
  lid.add(mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.035, 24), metal, [0, 0.918, 0]));
  lid.add(mesh(new THREE.SphereGeometry(0.33, 24, 6, 0, Math.PI * 2, 0, 0.35), metal, [0, 0.87, 0]));
  lid.add(mesh(new THREE.TorusGeometry(0.06, 0.013, 6, 12, Math.PI), metal, [0, 0.98, 0]));
  root.add(mergeByMaterial(lid, 'lid'));
  return root;
}

/** Just the lid (spawned as its own prop when a can tips). */
export function buildTrashLid(): THREE.Group {
  const metal = M('canMetal', {});
  const lid = new THREE.Group();
  lid.add(mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.035, 24), metal, [0, 0.0175, 0]));
  lid.add(mesh(new THREE.SphereGeometry(0.33, 24, 6, 0, Math.PI * 2, 0, 0.35), metal, [0, -0.031, 0]));
  lid.add(mesh(new THREE.TorusGeometry(0.06, 0.013, 6, 12, Math.PI), metal, [0, 0.08, 0]));
  return mergeByMaterial(lid, 'trashLid');
}

export const DUMPSTER = { W: 2.0, H: 1.2, D: 1.2, T: 0.08, wheel: 0.12 };

/**
 * Big green dumpster, body-local coordinates (origin = centre of the bin box).
 * Returns { root, lidPivot } — lidPivot sits on the back top edge; rotate.x = -angle to open.
 */
export function buildDumpster(): { root: THREE.Group; lidPivot: THREE.Group } {
  const { W, H, D, T, wheel } = DUMPSTER;
  const root = new THREE.Group();
  const green = M('dumpster', { color: 0x2f7d45, metalness: 0.35, roughness: 0.55 });
  const lip = M('dumpsterLip', { color: 0x245f36, metalness: 0.35, roughness: 0.55 });
  const inside = M('dumpsterInside', { color: 0x1f3526, roughness: 0.9 });
  const b = new THREE.Group();
  b.add(mesh(BOX, green, [0, -H / 2 + 0.05, 0], undefined, [W, 0.1, D]));
  b.add(mesh(BOX, green, [0, 0, D / 2 - T / 2], undefined, [W, H, T]));
  b.add(mesh(BOX, green, [0, 0, -D / 2 + T / 2], undefined, [W, H, T]));
  b.add(mesh(BOX, green, [W / 2 - T / 2, 0, 0], undefined, [T, H, D - 2 * T]));
  b.add(mesh(BOX, green, [-W / 2 + T / 2, 0, 0], undefined, [T, H, D - 2 * T]));
  // inner faces a touch darker so the inside reads as a hole
  b.add(mesh(BOX, inside, [0, -H / 2 + 0.101, 0], undefined, [W - 2 * T, 0.002, D - 2 * T]));
  // top lip
  b.add(mesh(BOX, lip, [0, H / 2 - 0.03, D / 2 - 0.02], undefined, [W + 0.04, 0.08, 0.1]));
  b.add(mesh(BOX, lip, [0, H / 2 - 0.03, -D / 2 + 0.02], undefined, [W + 0.04, 0.08, 0.1]));
  b.add(mesh(BOX, lip, [W / 2 - 0.02, H / 2 - 0.03, 0], undefined, [0.1, 0.08, D]));
  b.add(mesh(BOX, lip, [-W / 2 + 0.02, H / 2 - 0.03, 0], undefined, [0.1, 0.08, D]));
  // fork pockets
  for (const s of [-1, 1]) b.add(mesh(BOX, lip, [s * 0.55, -0.18, 0], undefined, [0.3, 0.14, D + 0.06]));
  // wheels
  const wheelM = M('tire', { color: 0x1b1b1b, roughness: 0.8 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(mesh(new THREE.CylinderGeometry(wheel / 2, wheel / 2, 0.06, 12), wheelM, [sx * (W / 2 - 0.2), -H / 2 - wheel / 2, sz * (D / 2 - 0.18)], [0, 0, Math.PI / 2]));
  // garbage bags inside
  const bag = M('bag', { color: 0x2b2f2a, roughness: 0.6 });
  const bag2 = M('bagGreen', { color: 0x3f5a35, roughness: 0.6 });
  blob(b, bag, -0.5, -H / 2 + 0.3, 0.1, 0.28, 1, 0.75, 1);
  blob(b, bag2, 0.2, -H / 2 + 0.28, -0.15, 0.3, 1.1, 0.7, 1);
  blob(b, bag, 0.6, -H / 2 + 0.25, 0.2, 0.24, 1, 0.75, 1);
  blob(b, M('paperBall', {}), -0.1, -H / 2 + 0.2, 0.3, 0.1, 1, 1, 1, true);
  root.add(mergeByMaterial(b, 'bin'));
  // sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.48), M('dumpsterSign', { map: dumpsterSignTex(), roughness: 0.7 }));
  sign.position.set(0, 0.05, D / 2 + 0.002);
  root.add(sign);
  // lid on a pivot at the back top edge
  const lidPivot = new THREE.Group();
  lidPivot.name = 'lidPivot';
  lidPivot.position.set(0, H / 2, -D / 2);
  const lidMat = M('dumpsterLid', { color: 0x1d3b27, roughness: 0.65 });
  const lid = new THREE.Group();
  lid.add(mesh(BOX, lidMat, [0, 0.03, D / 2], undefined, [W - 0.02, 0.05, D + 0.02]));
  lid.add(mesh(BOX, lidMat, [0, 0.07, D / 2 + 0.3], undefined, [W * 0.5, 0.03, 0.06]));
  lidPivot.add(mergeByMaterial(lid, 'lid'));
  root.add(lidPivot);
  return { root, lidPivot };
}
