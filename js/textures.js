// Procedural canvas textures: covers, spines, endpapers, page edges, wood.
import * as THREE from 'three';

export const GFX = { maxAniso: 8 };
export const SERIF = '"EB Garamond", Garamond, Georgia, "Times New Roman", serif';

export function rng(seed) {
  let a = (seed | 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTexture(c, { srgb = true, wrap = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = GFX.maxAniso;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let noiseC = null;
export function noise() {
  if (noiseC) return noiseC;
  const s = 256, c = makeCanvas(s, s), ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s), r = rng(7);
  for (let i = 0; i < s * s; i++) {
    const v = (r() * 255) | 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (noiseC = c);
}

export function overlayNoise(ctx, w, h, alpha, scale = 1, mode = 'overlay') {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = mode;
  const pat = ctx.createPattern(noise(), 'repeat');
  if (scale !== 1 && pat.setTransform) pat.setTransform(new DOMMatrix().scale(scale));
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function gold(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#f8e7a8');
  g.addColorStop(0.45, '#d4ae55');
  g.addColorStop(0.7, '#a07c2c');
  g.addColorStop(1, '#e9cf83');
  return g;
}

function leather(ctx, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  overlayNoise(ctx, w, h, 0.35, 3, 'overlay');
  overlayNoise(ctx, w, h, 0.12, 1, 'overlay');
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

function wrapLines(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function embossText(ctx, text, x, y, fill) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export function coverCanvas(spec) {
  const w = 1024, h = Math.round(1024 * spec.Hc / spec.L);
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  leather(ctx, w, h, spec.color);
  // hinge crease near the spine (left)
  const cr = ctx.createLinearGradient(0, 0, w * 0.07, 0);
  cr.addColorStop(0, 'rgba(0,0,0,0.35)');
  cr.addColorStop(0.55, 'rgba(255,255,255,0.06)');
  cr.addColorStop(0.62, 'rgba(0,0,0,0.25)');
  cr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cr; ctx.fillRect(0, 0, w * 0.07, h);
  // gold frame
  const g = gold(ctx, 0, 0, w, h);
  ctx.strokeStyle = g;
  ctx.lineWidth = 7; ctx.strokeRect(w * 0.12, h * 0.05, w * 0.82, h * 0.9);
  ctx.lineWidth = 2.5; ctx.strokeRect(w * 0.135, h * 0.062, w * 0.79, h * 0.876);
  // corner diamonds
  ctx.fillStyle = g;
  for (const [cx, cy] of [[0.12, 0.05], [0.94, 0.05], [0.12, 0.95], [0.94, 0.95]]) {
    ctx.save(); ctx.translate(cx * w, cy * h); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-14, -14, 28, 28); ctx.restore();
  }
  // title
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(w * 0.085)}px ${SERIF}`;
  const lines = wrapLines(ctx, spec.title.toUpperCase(), w * 0.62);
  const lh = w * 0.1;
  let y = h * 0.3 - ((lines.length - 1) * lh) / 2;
  for (const l of lines) { embossText(ctx, l, w * 0.53, y, g); y += lh; }
  // ornament
  const oy = h * 0.52;
  ctx.strokeStyle = g; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(w * 0.3, oy); ctx.lineTo(w * 0.46, oy); ctx.moveTo(w * 0.6, oy); ctx.lineTo(w * 0.76, oy); ctx.stroke();
  ctx.save(); ctx.translate(w * 0.53, oy); ctx.rotate(Math.PI / 4);
  ctx.strokeRect(-22, -22, 44, 44); ctx.fillStyle = g; ctx.fillRect(-9, -9, 18, 18); ctx.restore();
  if (spec.subtitle) {
    ctx.font = `italic ${Math.round(w * 0.04)}px ${SERIF}`;
    embossText(ctx, spec.subtitle, w * 0.53, h * 0.6, g);
  }
  ctx.font = `italic ${Math.round(w * 0.05)}px ${SERIF}`;
  embossText(ctx, spec.author, w * 0.53, h * 0.8, g);
  return c;
}

export function backCoverCanvas(spec) {
  const w = 512, h = Math.round(512 * spec.Hc / spec.L);
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  leather(ctx, w, h, spec.color);
  ctx.strokeStyle = gold(ctx, 0, 0, w, h);
  ctx.lineWidth = 3; ctx.strokeRect(w * 0.06, h * 0.05, w * 0.82, h * 0.9);
  return c;
}

export function spineCanvas(spec) {
  const thick = spec.T + 2 * spec.ct;
  const h = 512;
  const w = Math.max(32, Math.min(160, Math.round((h * thick) / spec.Hc)));
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  leather(ctx, w, h, spec.color);
  // rounded spine shading
  const sg = ctx.createLinearGradient(0, 0, w, 0);
  sg.addColorStop(0, 'rgba(0,0,0,0.45)');
  sg.addColorStop(0.3, 'rgba(255,255,255,0.10)');
  sg.addColorStop(0.55, 'rgba(255,255,255,0.0)');
  sg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
  const g = spec.ink || gold(ctx, 0, 0, w, h);
  const r = rng(spec.seed);
  const style = spec.style;
  const title = spec.spineTitle || spec.title;
  const lightLabel = style === 1 && r() < 0.5;
  if (style === 1) {
    ctx.fillStyle = lightLabel ? '#e9dfc4' : '#1b1712';
    ctx.fillRect(w * 0.1, h * 0.18, w * 0.8, h * 0.5);
    ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.strokeRect(w * 0.1, h * 0.18, w * 0.8, h * 0.5);
  }
  ctx.strokeStyle = g;
  for (const yy of [0.05, 0.075, 0.925, 0.95]) {
    ctx.lineWidth = style === 2 ? 5 : 2;
    ctx.beginPath(); ctx.moveTo(0, h * yy); ctx.lineTo(w, h * yy); ctx.stroke();
  }
  if (style === 2) {
    for (const yy of [0.2, 0.75]) { ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, h * yy); ctx.lineTo(w, h * yy); ctx.stroke(); }
  }
  // title, reading top-to-bottom
  ctx.save();
  ctx.translate(w / 2, h * 0.43);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let fs = Math.min(w * 0.5, 40);
  ctx.font = `600 ${fs}px ${SERIF}`;
  const tw = ctx.measureText(title).width;
  if (tw > h * 0.5) { fs *= (h * 0.5) / tw; ctx.font = `600 ${fs}px ${SERIF}`; }
  const fill = lightLabel ? '#2a2018' : g;
  if (!spec.ink) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(title, 1.5, 1.5); }
  ctx.fillStyle = fill; ctx.fillText(title, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(w / 2, h * 0.84);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `italic ${Math.min(w * 0.34, 22)}px ${SERIF}`;
  ctx.fillStyle = g; ctx.fillText(spec.author.split(' ').pop(), 0, 0);
  ctx.restore();
  return c;
}

export function endpaperCanvas(seed, c1 = '#2f3e52', c2 = '#c9b48a') {
  const s = 256, c = makeCanvas(s, s), ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const A = hexToRgb(c1), B = hexToRgb(c2);
  const ph = seed * 1.7;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x / s) * Math.PI * 2, v = (y / s) * Math.PI * 2;
      const val = Math.sin(u * 2 + 2.4 * Math.sin(v + 1.3 * Math.sin(u * 3 + ph)) + ph + 1.1 * Math.sin(v * 2 + u));
      let t = (val + 1) / 2;
      const vein = Math.abs(((t * 7) % 1) - 0.5) < 0.05 ? 0.25 : 0;
      t = t * t * (3 - 2 * t);
      const i = (y * s + x) * 4;
      for (let k = 0; k < 3; k++) img.data[i + k] = Math.min(255, A[k] + (B[k] - A[k]) * t + vein * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  overlayNoise(ctx, s, s, 0.15, 1);
  return c;
}

export function pageEdgeCanvas() {
  const w = 16, h = 128, c = makeCanvas(w, h), ctx = c.getContext('2d');
  const r = rng(3);
  for (let y = 0; y < h; y++) {
    const v = 214 + r() * 30 - (y % 2 ? 10 : 0);
    ctx.fillStyle = `rgb(${v},${v - 8},${v - 26})`;
    ctx.fillRect(0, y, w, 1);
  }
  return c;
}

export function woodCanvas(w, h, seed, base = [92, 58, 34]) {
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const r = rng(seed);
  ctx.fillStyle = `rgb(${base})`;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const y0 = r() * h, amp = 1 + r() * 8, f = 0.002 + r() * 0.012, ph = r() * 6.28;
    const dark = r() < 0.65, a = 0.04 + r() * 0.12;
    ctx.strokeStyle = dark ? `rgba(30,15,5,${a})` : `rgba(255,215,160,${a * 0.5})`;
    ctx.lineWidth = 0.5 + r() * 2.5;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * 0.3;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  overlayNoise(ctx, w, h, 0.12, 1);
  return c;
}
