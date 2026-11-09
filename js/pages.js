// Page textures. Two sources:
//  - procedural placeholder pages (default)
//  - scanned images (set `pages` in config.js)
// Textures are created lazily and kept in a small LRU cache, so books with
// hundreds of pages only hold the handful near the open spread in memory.
import * as THREE from 'three';
import { GFX, SERIF, rng, makeCanvas, overlayNoise } from './textures.js';
import { asset } from './assets.js';

const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus gravida orci a odio nullam varius turpis et commodo pharetra est eros bibendum elit nec luctus magna felis sollicitudin mauris integer in eu nibh euismod duis ac tellus risus vulputate vehicula donec lobortis etiam ullamcorper ligula congue sapien quam maecenas fermentum mi pellentesque malesuada sem aliquet eget neque aliquam faucibus silva nox umbra lumen aqua terra ventus mare stella via domus porta memoria').split(' ');

const INK = 'rgba(32,25,18,0.93)';

// Scans are tiny JPEGs; fetch them all once at startup and keep the compressed bytes,
// so a page is only ever a quick off-thread decode away from being shown.
const blobCache = new Map(); // url -> Promise<Blob>
export function preloadImages(urls) {
  let i = 0;
  const next = () => {
    if (i >= urls.length) return;
    const url = urls[i++];
    if (!blobCache.has(url)) {
      const p = fetch(asset(url)).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
      blobCache.set(url, p);
      p.catch(() => blobCache.delete(url)).finally(next);
    } else next();
  };
  for (let k = 0; k < 6; k++) next(); // 6 parallel requests
}
export function imageUrls(images, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(urlFor(images, i));
  return out;
}
function urlFor(p, i) {
  if (Array.isArray(p)) return p[i];
  const n = (p.start ?? 1) + i;
  return p.pattern.replace(/\{(#+)\}/, (_, hashes) => String(n).padStart(hashes.length, '0'));
}
function blobFor(url) {
  if (!blobCache.has(url)) blobCache.set(url, fetch(asset(url)).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); }));
  return blobCache.get(url);
}

function sentence(r) {
  const n = 5 + Math.floor(r() * 14);
  const out = [];
  for (let i = 0; i < n; i++) {
    let w = WORDS[Math.floor(r() * WORDS.length)];
    if (i === 0) w = w[0].toUpperCase() + w.slice(1);
    if (i < n - 1 && r() < 0.08) w += r() < 0.8 ? ',' : ';';
    out.push(w);
  }
  out[n - 1] += r() < 0.9 ? '.' : (r() < 0.5 ? '?' : '!');
  return out;
}
function paragraph(r) {
  const s = 2 + Math.floor(r() * 6);
  let words = [];
  for (let i = 0; i < s; i++) words = words.concat(sentence(r));
  return words;
}
function titleWords(r, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const w = WORDS[Math.floor(r() * WORDS.length)]; out.push(w[0].toUpperCase() + w.slice(1)); }
  return out.join(' ');
}
function roman(n) {
  const m = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, l] of m) while (n >= v) { s += l; n -= v; }
  return s;
}

export class PageProvider {
  constructor({ aspect, pageCount, title, author, seed = 1, images = null, maxCache = 24, onReady = null }) {
    this.onReady = onReady;  // called with each finished texture (used to pre-upload it to the GPU)
    this.aspect = aspect;          // height / width
    this.pageCount = pageCount;
    this.title = title;
    this.author = author;
    this.seed = seed;
    this.images = images;
    this.maxCache = maxCache;
    this.pxW = 1024;
    this.pxH = Math.round(1024 * aspect);
    this.cache = new Map();        // index -> texture (Map keeps insertion order = LRU)
    this.queue = [];
    this.protected = new Set();
    this._blank = null;
    // chapter starts (recto pages only)
    const r = rng(seed * 31 + 5);
    this.chapters = [];
    let p = 2, n = 1;
    while (p < pageCount - 2) {
      this.chapters.push({ page: p, n, title: titleWords(r, 1 + Math.floor(r() * 3)) });
      p += 12 + 2 * Math.floor(r() * 6);
      n++;
    }
  }

  chapterAt(i) {
    let c = null;
    for (const ch of this.chapters) if (ch.page <= i) c = ch;
    return c;
  }

  blank() {
    if (!this._blank) {
      const c = makeCanvas(256, Math.round(256 * this.aspect));
      paper(c.getContext('2d'), c.width, c.height, rng(1), true);
      this._blank = tex(c);
    }
    return this._blank;
  }

  get(i) {
    if (i < 0 || i >= this.pageCount) return this.blank();
    let t = this.cache.get(i);
    if (t) { this.cache.delete(i); this.cache.set(i, t); return t; }
    t = this.images ? this._image(i) : this._draw(i);
    this.cache.set(i, t);
    this._evict();
    return t;
  }

  protect(indices) { this.protected = new Set(indices); }

  prefetch(indices) {
    for (const i of indices) if (i >= 0 && i < this.pageCount && !this.cache.has(i) && !this.queue.includes(i)) this.queue.push(i);
  }

  // Generate at most one queued page per frame, and only while nothing is moving,
  // so drawing a page never lands in the middle of a page-turn animation.
  tick(idle) {
    // decoding scans happens off the main thread, so it may run while pages move;
    // drawing placeholder pages is main-thread work and waits for a calm moment
    if (!idle && !this.images) return;
    while (this.queue.length) {
      const i = this.queue.shift();
      if (!this.cache.has(i)) { this.get(i); return; }
    }
  }

  _evict() {
    if (this.cache.size <= this.maxCache) return;
    for (const [k, t] of this.cache) {
      if (this.cache.size <= this.maxCache) break;
      if (this.protected.has(k)) continue;
      t.userData.disposed = true;
      if (t.image && t.image.close) t.image.close();
      t.dispose();
      this.cache.delete(k);
    }
  }

  _draw(i) {
    const c = makeCanvas(this.pxW, this.pxH);
    drawPage(c, i, this);
    const t = tex(c);
    if (this.onReady) this.onReady(t);
    return t;
  }

  _image(i) {
    const c = makeCanvas(256, Math.round(256 * this.aspect));
    paper(c.getContext('2d'), c.width, c.height, rng(i + 1), i % 2 === 0);
    const t = tex(c);
    const url = this._url(i);
    // decode off the main thread, already flipped for WebGL
    blobFor(url)
      .then((b) => createImageBitmap(b, { imageOrientation: 'flipY' }))
      .then((bmp) => {
        if (t.userData.disposed) { bmp.close(); return; }
        t.image = bmp; t.flipY = false; t.needsUpdate = true;
        if (this.onReady) this.onReady(t);
      })
      .catch(() => console.warn('Missing page scan:', url));
    return t;
  }

  _url(i) { return urlFor(this.images, i); }

  dispose() {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
    if (this._blank) this._blank.dispose();
  }
}

function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = GFX.maxAniso;
  return t;
}

// The paper itself (colour, grain, aged edges, gutter shade) is identical on every page,
// so it is rendered once per size/side and then just copied.
const paperCache = new Map();
function paper(ctx, w, h, r, recto) {
  const key = w + 'x' + h + (recto ? 'r' : 'v');
  let base = paperCache.get(key);
  if (!base) {
    base = makeCanvas(w, h);
    paperBase(base.getContext('2d'), w, h, recto);
    paperCache.set(key, base);
  }
  ctx.drawImage(base, 0, 0);
  // foxing differs per page
  for (let k = 0; k < 6; k++) {
    const x = r() * w, y = r() * h, rad = (2 + r() * 10) * (w / 1000);
    ctx.fillStyle = `rgba(150,105,50,${0.03 + r() * 0.05})`;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
}

function paperBase(ctx, w, h, recto) {
  ctx.fillStyle = '#f1e7d0';
  ctx.fillRect(0, 0, w, h);
  overlayNoise(ctx, w, h, 0.07, 6, 'multiply');
  overlayNoise(ctx, w, h, 0.05, 1, 'multiply');
  // aged edges
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  vg.addColorStop(0, 'rgba(120,85,40,0)');
  vg.addColorStop(1, 'rgba(120,85,40,0.16)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  // gutter shade
  const gw = w * 0.08;
  const g = recto ? ctx.createLinearGradient(0, 0, gw, 0) : ctx.createLinearGradient(w, 0, w - gw, 0);
  g.addColorStop(0, 'rgba(60,40,20,0.16)');
  g.addColorStop(1, 'rgba(60,40,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(recto ? 0 : w - gw, 0, gw, h);
}

function drawPage(c, i, P) {
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height, S = w / 1000;
  const r = rng(P.seed * 7919 + i * 104729 + 1);
  const recto = i % 2 === 0;
  paper(ctx, w, h, r, recto);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';

  const left = recto ? 125 * S : 95 * S;
  const right = w - (recto ? 95 * S : 125 * S);
  const top = 120 * S, bottom = h - 135 * S;
  const fs = 30 * S, lh = fs * 1.45;
  const cx = (left + right) / 2;

  if (i === 0) return titlePage(ctx, w, h, S, P);
  if (i === 1) return colophon(ctx, left, bottom, S, P);
  if (i === P.pageCount - 1) return endPage(ctx, cx, h, S);

  const ch = P.chapterAt(i);
  const isStart = ch && ch.page === i;

  // folio
  ctx.textAlign = 'center';
  ctx.font = `${24 * S}px ${SERIF}`;
  ctx.fillText(String(i + 1), cx, h - 70 * S);

  let y0 = top;
  let dropCap = null;
  if (isStart) {
    ctx.font = `${28 * S}px ${SERIF}`;
    spaced(ctx, `CHAPTER ${roman(ch.n)}`, cx, h * 0.2, 6 * S);
    ctx.font = `italic ${52 * S}px ${SERIF}`;
    ctx.fillText(ch.title, cx, h * 0.2 + 75 * S);
    ornament(ctx, cx, h * 0.2 + 120 * S, S);
    y0 = h * 0.2 + 190 * S;
    dropCap = { lines: 3 };
  } else {
    ctx.font = `italic ${22 * S}px ${SERIF}`;
    if (recto && ch) ctx.fillText(ch.title, cx, 72 * S);
    else { ctx.font = `${20 * S}px ${SERIF}`; spaced(ctx, P.title.toUpperCase(), cx, 72 * S, 4 * S); }
  }

  ctx.textAlign = 'left';
  ctx.font = `${fs}px ${SERIF}`;
  const zones = [];
  if (!isStart && r() < 0.16) {
    const fh = (bottom - top) * (0.3 + r() * 0.12);
    const fy = r() < 0.5 ? top + lh * 2 : bottom - fh - lh * 1.2;
    zones.push({ y0: fy, y1: fy + fh, draw: () => figure(ctx, left, fy, right - left, fh - 50 * S, S, r, i) });
  }
  flow(ctx, r, { left, right, top: y0, bottom, fs, lh, dropCap, firstIndent: isStart ? false : r() < 0.6, zones, S });
}

function spaced(ctx, text, cx, y, sp) {
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
  let x = cx - total / 2;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((ch, k) => { ctx.fillText(ch, x, y); x += widths[k] + sp; });
  ctx.textAlign = prev;
}

function ornament(ctx, cx, y, S) {
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5 * S;
  ctx.beginPath(); ctx.moveTo(cx - 90 * S, y); ctx.lineTo(cx - 14 * S, y); ctx.moveTo(cx + 14 * S, y); ctx.lineTo(cx + 90 * S, y); ctx.stroke();
  ctx.translate(cx, y); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = INK; ctx.fillRect(-5 * S, -5 * S, 10 * S, 10 * S);
  ctx.restore();
}

function flow(ctx, r, o) {
  const { left, right, bottom, fs, lh, zones, S } = o;
  let y = o.top + fs;
  let firstPara = true;
  let dropCap = o.dropCap;
  const space = ctx.measureText(' ').width;
  const widths = new Map();
  const measure = (word) => { let v = widths.get(word); if (v === undefined) { v = ctx.measureText(word).width; widths.set(word, v); } return v; };
  while (y <= bottom) {
    const words = paragraph(r);
    let wi = 0, lineIdx = 0;
    let capW = 0;
    if (dropCap) {
      const letter = words[0][0];
      words[0] = words[0].slice(1);
      const capSize = lh * 2.6;
      ctx.save();
      ctx.font = `${capSize}px ${SERIF}`;
      ctx.fillStyle = '#5b1d17';
      ctx.fillText(letter, left, y + lh * 2 - 4 * S);
      capW = ctx.measureText(letter).width + 12 * S;
      ctx.restore();
    }
    while (wi < words.length && y <= bottom) {
      const z = zones.find((zz) => !zz.done && y + fs * 0.2 > zz.y0);
      if (z) { z.draw(); z.done = true; y = z.y1 + fs; continue; }
      let lx = left;
      if (dropCap && lineIdx < dropCap.lines) lx = left + capW;
      else if (lineIdx === 0 && (!firstPara || o.firstIndent)) lx = left + fs * 1.5;
      const maxW = right - lx;
      const line = [];
      let width = 0;
      while (wi < words.length) {
        const word = words[wi];
        const ww = measure(word);
        const add = (line.length ? space : 0) + ww;
        if (width + add > maxW && line.length) break;
        line.push([word, ww]); width += add; wi++;
      }
      const last = wi >= words.length;
      let gap = space;
      if (!last && line.length > 1) gap = space + (maxW - width) / (line.length - 1);
      let x = lx;
      for (const [word, ww] of line) { ctx.fillText(word, x, y); x += ww + gap; }
      y += lh; lineIdx++;
    }
    if (dropCap) dropCap = null;
    firstPara = false;
  }
}

function figure(ctx, x, y, w, h, S, r, i) {
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = 2 * S;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.lineWidth = 0.9 * S;
  ctx.strokeStyle = 'rgba(32,25,18,0.55)';
  // sky hatching
  for (let yy = y + 6 * S; yy < y + h * 0.55; yy += 7 * S) {
    const fade = (yy - y) / (h * 0.55);
    if (r() < 0.25 + fade * 0.2) continue;
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy + (r() - 0.5) * 2 * S); ctx.stroke();
  }
  // sun
  ctx.fillStyle = '#f1e7d0';
  ctx.beginPath(); ctx.arc(x + w * (0.2 + r() * 0.6), y + h * 0.25, h * 0.09, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // mountains
  for (let layer = 0; layer < 3; layer++) {
    const base = y + h * (0.5 + layer * 0.15);
    ctx.beginPath(); ctx.moveTo(x, y + h);
    let px = x;
    ctx.lineTo(x, base);
    while (px < x + w) { px += w * (0.05 + r() * 0.12); ctx.lineTo(px, base - r() * h * 0.25); }
    ctx.lineTo(x + w, y + h); ctx.closePath();
    ctx.fillStyle = '#f1e7d0'; ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip();
    for (let k = 0; k < 120; k += 1 + layer) {
      const hx = x + (k / 120) * w;
      ctx.beginPath(); ctx.moveTo(hx, y); ctx.lineTo(hx - h * 0.4, y + h); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
  ctx.font = `italic ${22 * S}px ${SERIF}`;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.fillText(`Fig. ${Math.floor(i / 7) + 1}. ${titleWords(r, 3).toLowerCase()}`, x + w / 2, y + h + 32 * S);
  ctx.textAlign = 'left';
}

function titlePage(ctx, w, h, S, P) {
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `600 ${70 * S}px ${SERIF}`;
  spaced(ctx, P.title.toUpperCase(), w / 2, h * 0.32, 10 * S);
  ornament(ctx, w / 2, h * 0.37, S);
  ctx.font = `italic ${38 * S}px ${SERIF}`;
  ctx.fillText(P.author, w / 2, h * 0.45);
  ctx.font = `${22 * S}px ${SERIF}`;
  spaced(ctx, 'LJUBLJANA', w / 2, h * 0.86, 6 * S);
  ctx.fillText('MMXXVI', w / 2, h * 0.86 + 36 * S);
}

function colophon(ctx, left, bottom, S, P) {
  ctx.textAlign = 'left';
  ctx.fillStyle = INK;
  ctx.font = `${19 * S}px ${SERIF}`;
  const lines = [`${P.title} — placeholder edition`, 'Pages are generated; replace them with scans in js/config.js.', '', '© 2026'];
  lines.forEach((l, k) => ctx.fillText(l, left, bottom - (lines.length - k) * 28 * S));
}

function endPage(ctx, cx, h, S) {
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `italic ${40 * S}px ${SERIF}`;
  ctx.fillText('Finis', cx, h * 0.45);
  ornament(ctx, cx, h * 0.45 + 40 * S, S);
}
