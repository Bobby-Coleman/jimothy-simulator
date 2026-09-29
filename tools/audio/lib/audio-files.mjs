/**
 * Dependency-free helpers for the audio tools: 16-bit WAV writer and spectrogram PNG renderer
 * (so sounds can be sanity-checked visually by someone who can't listen).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

/** Writes interleaved 16-bit PCM WAV from Float32Array channels. */
export function writeWav(file, chans, sr) {
  const n = chans[0].length;
  const ch = chans.length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * ch * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i] || 0));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  fs.writeFileSync(file, buf);
}

/** Reads a 16-bit PCM WAV back into Float32Array channels (for round-trip checks). */
export function readWav(file) {
  const b = fs.readFileSync(file);
  const ch = b.readUInt16LE(22);
  const sr = b.readUInt32LE(24);
  let p = 12;
  while (p < b.length && b.toString('ascii', p, p + 4) !== 'data') p += 8 + b.readUInt32LE(p + 4);
  const len = b.readUInt32LE(p + 4) / (2 * ch);
  const chans = Array.from({ length: ch }, () => new Float32Array(len));
  let o = p + 8;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++, o += 2) chans[c][i] = b.readInt16LE(o) / 32768;
  return { chans, sr };
}

// ------------------------------------------------------------------ FFT / spectrogram

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}

function colormap(v) {
  // v in [0,1] -> dark blue -> purple -> orange -> yellow-white
  const stops = [
    [0, 0, 0, 12],
    [0.25, 40, 10, 90],
    [0.5, 160, 30, 110],
    [0.75, 250, 120, 30],
    [1, 255, 250, 200],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const t = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return [255, 250, 200];
}

/**
 * Renders a PNG with one spectrogram row per entry (log-frequency 50 Hz..Nyquist, time on x,
 * 0..`secs` seconds), with a waveform strip under each. rows: [{ chans, sr }].
 */
export function spectrogramPng(file, rows, opts = {}) {
  const W = opts.width ?? 640;
  const H = opts.height ?? 120;
  const WAVE = 28;
  const GAP = 4;
  const secs = opts.secs ?? Math.max(...rows.map((r) => r.chans[0].length / r.sr), 0.2);
  const totalH = rows.length * (H + WAVE + GAP);
  const img = Buffer.alloc(W * totalH * 3);
  rows.forEach((row, ri) => {
    const { chans, sr } = row;
    const n = chans[0].length;
    const mono = new Float32Array(n);
    for (const c of chans) for (let i = 0; i < n; i++) mono[i] += c[i] / chans.length;
    const N = 1024;
    const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    const y0 = ri * (H + WAVE + GAP);
    const fMin = 50;
    const fMax = sr / 2;
    for (let x = 0; x < W; x++) {
      const center = Math.floor(((x + 0.5) / W) * secs * sr);
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const j = center - N / 2 + i;
        re[i] = j >= 0 && j < n ? mono[j] * win[i] : 0;
      }
      fft(re, im);
      for (let y = 0; y < H; y++) {
        const f = fMin * Math.pow(fMax / fMin, 1 - (y + 0.5) / H);
        const bin = Math.min(N / 2 - 1, Math.round((f / sr) * N));
        const mag = Math.hypot(re[bin], im[bin]) / (N / 4);
        const dbv = 20 * Math.log10(mag + 1e-9);
        const v = Math.max(0, Math.min(1, (dbv + 90) / 90));
        const [r, g, b] = colormap(v);
        const o = ((y0 + y) * W + x) * 3;
        img[o] = r;
        img[o + 1] = g;
        img[o + 2] = b;
      }
      // waveform strip (peak per column)
      const a = Math.floor((x / W) * secs * sr);
      const bnd = Math.floor(((x + 1) / W) * secs * sr);
      let pk = 0;
      for (let i = a; i < bnd && i < n; i++) pk = Math.max(pk, Math.abs(mono[i]));
      const hpx = Math.round(pk * (WAVE / 2));
      for (let y = 0; y < WAVE; y++) {
        const on = Math.abs(y - WAVE / 2) <= hpx;
        const o = ((y0 + H + y) * W + x) * 3;
        img[o] = on ? 120 : 20;
        img[o + 1] = on ? 220 : 24;
        img[o + 2] = on ? 160 : 30;
      }
    }
  });
  writePng(file, W, totalH, img);
}
