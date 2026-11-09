// A real 3D book: hinged hard covers, two page blocks whose thickness follows
// the reading position, a flexible spine, and deformable leaves that bend
// like paper while you drag them.
//
// Local frame: spine along z (top of the page at z = -H/2), pages extend
// along +x (right) and -x (left), page normal is +y. Page-block heights are
// exact: leaf i lies at height (N - i) * lt on the right, (i + 1) * lt on the left.
import * as THREE from 'three';

const GUT = 0.24;    // fraction of the page width that curves down into the gutter
const BOW = 0.04;    // how much an open page domes up (fraction of page width)
const GAPX = 0.00035; // half-width of the slit between the two page stacks at the binding (m)
const BEND = 0.5;    // how much the paper bends while turning (0 = rigid)
const SX = 40, SZ = 12;
const EPS = 0.00025;
const K_MAX = 0.34;  // max tilt (radians) of the fold lines: how diagonal a corner curl can get

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = (x) => clamp(x, 0, 1);
const sstep = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
// pages leave the spine steeply and roll over into the flat page, like a sewn binding
const gutter = (t) => 1 - Math.pow(1 - clamp01(t / GUT), 2.6);
// gentle dome across the open page, back to the stack height at the fore-edge
const bow = (t) => Math.sin(Math.PI * clamp01(t)) * (0.55 + 0.45 * (1 - t));
const shadeAt = (t) => (0.55 + 0.45 * sstep(t / 0.3)) * (0.55 + 0.45 * sstep(t / 0.035));
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));

// Tangent angle of the leaf at distance t (0..1) from the spine, for turn progress p (0 = right, 1 = left).
// The edge that is being pulled leads, the part near the spine follows: a constant-curvature arc.
function phiF(t, p, b) { return Math.PI * sstep(p * (1 + b) - b * (1 - t)); }
function phi(t, p, dir, b = BEND) { return dir > 0 ? phiF(t, p, b) : Math.PI - phiF(t, 1 - p, b); }

// ---- developable sheet deformation (see LeafMesh.update)
const TBL = 64;
const OUT = new Float32Array(4);
const _F = { tA: new Float32Array(TBL + 1), tB: new Float32Array(TBL + 1), tD: new Float32Array(TBL + 1) };
function sheetFrame(W, H, p, dir, alpha, b, flap = 0) {
  const F = _F;
  F.ca = Math.cos(alpha); F.sa = Math.sin(alpha);
  F.sb = (H / 2) * Math.abs(F.sa);                 // fold lines start beyond every spine point
  F.se = W * F.ca + (H / 2) * Math.abs(F.sa);      // farthest point of the sheet along the fold direction
  F.theta = phi(0, p, dir, b);
  F.ct = Math.cos(F.theta); F.st = Math.sin(F.theta);
  F.ds = (F.se - F.sb) / TBL;
  F.tA[0] = 0; F.tB[0] = 0; F.tD[0] = 0;
  for (let m = 1; m <= TBL; m++) {
    const tm = (m - 0.5) / TBL;
    const d = phi(tm, p, dir, b) - F.theta + flap * tm * tm;
    F.tA[m] = F.tA[m - 1] + Math.cos(d) * F.ds;
    F.tB[m] = F.tB[m - 1] + Math.sin(d) * F.ds;
    F.tD[m] = d;
  }
  return F;
}
// u = distance from the spine, w = position along the spine -> OUT = [x, y, z, angle]
function sheetPoint(F, u, w, out) {
  const s = u * F.ca + w * F.sa, q = -u * F.sa + w * F.ca;
  let a = s, n = 0, d = 0;
  if (s > F.sb) {
    const f = (s - F.sb) / F.ds;
    const m = Math.min(TBL - 1, Math.floor(f)), fr = Math.min(f - m, 1);
    a = F.sb + F.tA[m] + (F.tA[m + 1] - F.tA[m]) * fr;
    n = F.tB[m] + (F.tB[m + 1] - F.tB[m]) * fr;
    d = F.tD[m] + (F.tD[m + 1] - F.tD[m]) * fr;
  }
  const lx = a * F.ca - q * F.sa, ly = n, lz = a * F.sa + q * F.ca;
  out[0] = lx * F.ct - ly * F.st;
  out[1] = lx * F.st + ly * F.ct;
  out[2] = lz;
  out[3] = F.theta + d;
  return out;
}

// Paper is slightly translucent: the reverse page shows through faintly (mirrored),
// and a lifted sheet catching the spotlight glows warm. Patched into the standard material.
function paperMaterial(opts, blank) {
  const m = new THREE.MeshStandardMaterial(opts);
  m.userData.uOther = { value: blank };
  m.userData.uShow = { value: 0.045 };
  m.userData.uGlow = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOther = m.userData.uOther;
    sh.uniforms.uShow = m.userData.uShow;
    sh.uniforms.uGlow = m.userData.uGlow;
    sh.fragmentShader = 'uniform sampler2D uOther;\nuniform float uShow;\nuniform float uGlow;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 othr = texture2D(uOther, vec2(1.0 - vMapUv.x, vMapUv.y)).rgb;
        diffuseColor.rgb *= 1.0 - (1.0 - dot(othr, vec3(0.299, 0.587, 0.114))) * uShow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlow * vec3(1.0, 0.84, 0.62) * diffuseColor.rgb;`);
  };
  m.customProgramCacheKey = () => 'paper-v1';
  return m;
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function pushQuad(A, c, uvs, n, color = 1) {
  const base = A.P.length / 3;
  for (let k = 0; k < 4; k++) { A.P.push(...c[k]); A.U.push(...uvs[k]); A.C.push(color, color, color); }
  const ok = dot(cross(sub(c[2], c[0]), sub(c[3], c[1])), n) >= 0;
  if (ok) A.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else A.I.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

// Box with per-face material groups (px, nx, py, ny, pz, nz) and optional per-face UV functions.
export function slabGeometry(x0, x1, y0, y1, z0, z1, uvf = {}) {
  const P = [], N = [], U = [], I = [];
  const g = new THREE.BufferGeometry();
  const faces = [
    ['px', [1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    ['nx', [-1, 0, 0], [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]]],
    ['py', [0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]],
    ['ny', [0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    ['pz', [0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    ['nz', [0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]],
  ];
  const nrm = (v, a, b) => (v - a) / (b - a || 1);
  faces.forEach(([name, n, c], fi) => {
    const base = P.length / 3;
    for (const p of c) {
      P.push(...p); N.push(...n);
      let uv;
      if (uvf[name]) uv = uvf[name](p);
      else if (n[0]) uv = [nrm(p[2], z0, z1), nrm(p[1], y0, y1)];
      else if (n[1]) uv = [nrm(p[0], x0, x1), nrm(p[2], z0, z1)];
      else uv = [nrm(p[0], x0, x1), nrm(p[1], y0, y1)];
      U.push(...uv);
    }
    const start = I.length;
    if (dot(cross(sub(c[1], c[0]), sub(c[2], c[0])), n) > 0) I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else I.push(base, base + 2, base + 1, base, base + 3, base + 2);
    g.addGroup(start, 6, fi);
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  return g;
}

// Page block of unit thickness (scaled in y by the real thickness).
// Group 0 = top page, group 1 = paper edges.
function blockGeometry(W, H, side, h, bw) {
  const NX = 36;
  const top = (t) => h * gutter(t) + bw * bow(t);
  const hh = Math.max(h, 1e-6);
  const A = { P: [], U: [], C: [], I: [] };
  const ts = [];
  for (let i = 0; i <= NX; i++) ts.push(Math.pow(i / NX, 1.4));
  for (let j = 0; j <= 1; j++) {
    for (const t of ts) {
      A.P.push(side * (GAPX + t * (W - GAPX)), top(t), -H / 2 + j * H);
      A.U.push(side > 0 ? t : 1 - t, 1 - j);
      const s = shadeAt(t); A.C.push(s, s, s);
    }
  }
  for (let i = 0; i < NX; i++) {
    const a = i, b = i + 1, c = NX + 1 + i, d = c + 1;
    if (side > 0) A.I.push(a, c, b, b, c, d);
    else A.I.push(a, b, c, b, d, c);
  }
  const topCount = A.I.length;
  const xE = side * W;
  pushQuad(A, [[xE, 0, -H / 2], [xE, h, -H / 2], [xE, h, H / 2], [xE, 0, H / 2]], [[0, 0], [0, 1], [1, 1], [1, 0]], [side, 0, 0]);
  for (let i = 0; i < NX; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    const xa = side * (GAPX + t0 * (W - GAPX)), xb = side * (GAPX + t1 * (W - GAPX));
    for (const [z, nz] of [[-H / 2, -1], [H / 2, 1]]) {
      pushQuad(A, [[xa, 0, z], [xb, 0, z], [xb, top(t1), z], [xa, top(t0), z]],
        [[t0, 0], [t1, 0], [t1, top(t1) / hh], [t0, top(t0) / hh]], [0, 0, nz]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(A.P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(A.U, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(A.C, 3));
  g.setIndex(A.I);
  g.addGroup(0, topCount, 0);
  g.addGroup(topCount, A.I.length - topCount, 1);
  g.computeVertexNormals();
  return g;
}

// One flexible sheet: a front mesh (recto) and a back mesh (verso) sharing positions and normals.
class LeafMesh {
  constructor(book, blank) {
    this.book = book;
    const nV = (SX + 1) * (SZ + 1);
    const pos = new Float32Array(nV * 3), uvF = new Float32Array(nV * 2), uvB = new Float32Array(nV * 2), col = new Float32Array(nV * 3);
    const idx = [];
    for (let j = 0; j <= SZ; j++) {
      for (let i = 0; i <= SX; i++) {
        const k = j * (SX + 1) + i, t = i / SX, v = j / SZ;
        uvF[k * 2] = t; uvF[k * 2 + 1] = 1 - v;
        uvB[k * 2] = 1 - t; uvB[k * 2 + 1] = 1 - v;
        const s = shadeAt(t); col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = s;
      }
    }
    for (let j = 0; j < SZ; j++) {
      for (let i = 0; i < SX; i++) {
        const a = j * (SX + 1) + i, b = a + 1, c = a + SX + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.pos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.BufferAttribute(col, 3);
    this.gF = new THREE.BufferGeometry();
    this.gF.setAttribute('position', this.pos);
    this.gF.setAttribute('uv', new THREE.BufferAttribute(uvF, 2));
    this.gF.setAttribute('color', color);
    this.gF.setIndex(idx);
    this.gF.computeVertexNormals();
    this.gB = new THREE.BufferGeometry();
    this.gB.setAttribute('position', this.pos);
    this.gB.setAttribute('normal', this.gF.getAttribute('normal'));
    this.gB.setAttribute('uv', new THREE.BufferAttribute(uvB, 2));
    this.gB.setAttribute('color', color);
    this.gB.setIndex(idx);
    this.mF = paperMaterial({ map: blank, roughness: 0.96, vertexColors: true, side: THREE.FrontSide, shadowSide: THREE.DoubleSide }, blank);
    this.mB = paperMaterial({ map: blank, roughness: 0.96, vertexColors: true, side: THREE.BackSide }, blank);
    this.front = new THREE.Mesh(this.gF, this.mF);
    this.back = new THREE.Mesh(this.gB, this.mB);
    this.front.castShadow = true;
    this.front.receiveShadow = this.back.receiveShadow = true;
    this.front.frustumCulled = this.back.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.front, this.back);
  }

  setPages(f, b) {
    this.mF.map = f; this.mB.map = b;
    this.mF.userData.uOther.value = b; this.mB.userData.uOther.value = f;
  }

  // Shape the sheet. It is always an exact isometry of the flat page (no stretching):
  //   1. a rigid hinge rotation (angle theta) about the spine, then
  //   2. a cylindrical bend whose fold lines are tilted by `alpha` in the page plane,
  //      applied only beyond the last spine point so the binding stays put.
  // alpha != 0 makes the grabbed corner lead: a real diagonal curl.
  update(index, p, dir, alpha, b = BEND, flap = 0) {
    const { W, H, N, lt } = this.book;
    const bw = this.book.bowAmp();
    const yR = (N - index) * lt + EPS, yL = (index + 1) * lt + EPS;
    // the sheet hinges at the edge of the binding slit, exactly like the page stacks,
    // so the dark line down the middle keeps its width while a page turns
    const Wb = W - GAPX;
    const F = sheetFrame(Wb, H, p, dir, alpha, b, flap);
    const a = this.pos.array;
    for (let j = 0; j <= SZ; j++) {
      const z = -H / 2 + (j / SZ) * H;
      for (let i = 0; i <= SX; i++) {
        const t = i / SX;
        sheetPoint(F, t * Wb, z, OUT);
        const w = OUT[3] / Math.PI;
        const off = (yR + (yL - yR) * w) * gutter(t) + bw * bow(t) * Math.abs(Math.cos(Math.PI * w));
        const o = (j * (SX + 1) + i) * 3;
        a[o] = OUT[0] + GAPX * Math.cos(OUT[3]); a[o + 1] = OUT[1] + off; a[o + 2] = OUT[2];
      }
    }
    this.pos.needsUpdate = true;
    this.gF.computeVertexNormals();
    // light through the lifted sheet
    const lift = Math.sin(Math.PI * clamp01(p));
    this.mF.userData.uShow.value = this.mB.userData.uShow.value = 0.05 + 0.08 * lift;
    this.mF.userData.uGlow.value = this.mB.userData.uGlow.value = 0.16 * lift;
  }

  dispose() { this.gF.dispose(); this.gB.dispose(); this.mF.dispose(); this.mB.dispose(); }
}

// Spine: a rounded strip connecting the back-cover hinge with the front-cover hinge.
class Spine {
  constructor(book, mat) {
    this.book = book;
    this.S = 16;
    const n = (this.S + 1) * 2;
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const uv = [], idx = [];
    for (let r = 0; r < 2; r++) for (let i = 0; i <= this.S; i++) uv.push(i / this.S, 1 - r);
    for (let i = 0; i < this.S; i++) { const a = i, b = i + 1, c = this.S + 1 + i, d = c + 1; idx.push(a, c, b, b, c, d); }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  update(gamma) {
    const { T, ct, Hc } = this.book;
    const py = T / 2, Bx = 0, By = -ct / 2, ry = -ct / 2 - py;
    const Fx = ry * Math.sin(gamma), Fy = ry * Math.cos(gamma) + py;
    const dx = Fx - Bx, dy = Fy - By, len = Math.hypot(dx, dy);
    if (len < 1e-4) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const nx = -dy / len, ny = dx / len;
    const bulge = len * 0.1 + ct * 0.6 * clamp01(len / (T * 0.3));
    const a = this.pos.array;
    for (let r = 0; r < 2; r++) {
      const z = r === 0 ? -Hc / 2 : Hc / 2;
      for (let i = 0; i <= this.S; i++) {
        const s = i / this.S, prof = 1 - Math.pow(2 * s - 1, 4);
        const o = (r * (this.S + 1) + i) * 3;
        a[o] = Bx + dx * s + nx * bulge * prof;
        a[o + 1] = By + dy * s + ny * bulge * prof;
        a[o + 2] = z;
      }
    }
    this.pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

export class Book {
  // spec: { W, H, T, leaves, ct, oh, startLeft, color }
  // tex:  { cover, back, spine, endpaper, edge }
  constructor(spec, provider, tex) {
    this.spec = spec;
    this.provider = provider;
    const W = (this.W = spec.W), H = (this.H = spec.H), T = (this.T = spec.T);
    const N = (this.N = spec.leaves);
    this.lt = T / N;
    const ct = (this.ct = spec.ct), oh = (this.oh = spec.oh);
    const L = (this.L = W + oh), Hc = (this.Hc = H + 2 * oh);

    this.side = new Uint8Array(N); // 0 right, 1 left, 2 in the air
    for (let i = 0; i < Math.min(spec.startLeft || 0, N); i++) this.side[i] = 1;
    this.a = 0;            // 0 = closed, 1 = open
    this.aVel = 0;
    this.aGoal = null;
    this.centerBlend = 0;  // 1 when in front of the reader (centres the closed book)
    this.flying = [];
    this.pool = [];
    this.drag = null;
    this.riffle = 0;
    this.rock = 0;
    this.rockV = 0;
    this.onEvent = () => {};
    this._gamma = -1;

    this.root = new THREE.Group();
    this.inner = new THREE.Group();
    this.root.add(this.inner);

    const blank = provider.blank();
    this.blank = blank;
    const coverMat = new THREE.MeshStandardMaterial({ map: tex.cover, roughness: 0.6 });
    const backMat = new THREE.MeshStandardMaterial({ map: tex.back, roughness: 0.6 });
    const endMat = new THREE.MeshStandardMaterial({ map: tex.endpaperBack || tex.endpaper, roughness: 0.85 });
    const endMatF = new THREE.MeshStandardMaterial({ map: tex.endpaperFront || tex.endpaper, roughness: 0.85 });
    const boardMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color).multiplyScalar(0.6), roughness: 0.7 });
    const spineMat = new THREE.MeshStandardMaterial({ map: tex.spine, roughness: 0.6, side: THREE.DoubleSide });
    this._mats = [coverMat, backMat, endMat, endMatF, boardMat, spineMat];

    const z0 = -Hc / 2;
    const vz = (p) => 1 - (p[2] - z0) / Hc;
    this.backCover = new THREE.Mesh(
      slabGeometry(0, L, -ct, 0, z0, -z0, { py: (p) => [p[0] / L, vz(p)], ny: (p) => [1 - p[0] / L, vz(p)] }),
      [boardMat, boardMat, endMat, backMat, boardMat, boardMat]
    );
    this.inner.add(this.backCover);

    this.leftHalf = new THREE.Group();
    this.leftHalf.position.y = T / 2;
    const lh = new THREE.Group();
    lh.position.y = -T / 2;
    this.leftHalf.add(lh);
    this.inner.add(this.leftHalf);
    this.frontCover = new THREE.Mesh(
      slabGeometry(-L, 0, -ct, 0, z0, -z0, { py: (p) => [(p[0] + L) / L, vz(p)], ny: (p) => [-p[0] / L, vz(p)] }),
      [boardMat, boardMat, endMatF, coverMat, boardMat, boardMat]
    );
    lh.add(this.frontCover);

    const mkBlock = (side) => {
      const top = paperMaterial({ map: blank, roughness: 0.96, vertexColors: true }, blank);
      const edgeTex = tex.edge.clone();
      edgeTex.wrapS = edgeTex.wrapT = THREE.RepeatWrapping;
      const edge = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.95, vertexColors: true });
      const m = new THREE.Mesh(blockGeometry(W, H, side, 0, 0), [top, edge]);
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      m.userData = { top, edge, edgeTex, side, key: '' };
      return m;
    };
    this.leftBlock = mkBlock(-1);
    this.rightBlock = mkBlock(1);
    lh.add(this.leftBlock);
    this.inner.add(this.rightBlock);

    this.spine = new Spine(this, spineMat);
    this.inner.add(this.spine.mesh);

    // binding: a dark slit between the stacks and a striped headband at head and tail
    this.binding = new THREE.Group();
    const slit = new THREE.Mesh(
      new THREE.PlaneGeometry(GAPX * 2 + 0.0002, H).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x120c08 }));
    slit.position.y = 0.00004;
    this.binding.add(slit);
    const hb = document.createElement('canvas'); hb.width = 64; hb.height = 8;
    const hctx = hb.getContext('2d');
    for (let i = 0; i < 16; i++) { hctx.fillStyle = i % 2 ? (spec.headband || '#7a2a22') : '#efe6d2'; hctx.fillRect(i * 4, 0, 4, 8); }
    const hbTex = new THREE.CanvasTexture(hb);
    hbTex.colorSpace = THREE.SRGBColorSpace;
    const hbMat = new THREE.MeshStandardMaterial({ map: hbTex, roughness: 0.75 });
    for (const zs of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0017, 0.0017, GAPX * 2 + 0.003, 12, 1).rotateZ(Math.PI / 2), hbMat);
      band.position.set(0, 0.0011, zs * (H / 2 + 0.0006));
      band.castShadow = true;
      this.binding.add(band);
    }
    this._mats.push(slit.material, hbMat);
    this._hbTex = hbTex;
    this.inner.add(this.binding);

    for (const m of [this.backCover, this.frontCover]) { m.castShadow = m.receiveShadow = true; }

    // two ready-made leaves so the first page turn doesn't allocate or compile anything
    for (let i = 0; i < 2; i++) this.pool.push(new LeafMesh(this, blank));

    this._applyA();
    this._refresh();
  }

  // ---------- state ----------
  _refresh() {
    const N = this.N;
    let lt = -1, rt = N;
    for (let i = 0; i < N; i++) if (this.side[i] === 1) lt = i;
    for (let i = N - 1; i >= 0; i--) if (this.side[i] === 0) rt = i;
    this.leftTop = lt;
    this.rightTop = rt;
    const setBlock = (m, h, page, count, reverse) => {
      m.visible = h > 1e-6;
      m.userData.h = h;
      this._shapeBlock(m);
      const tex = this.provider.get(page);
      if (m.userData.top.map !== tex) m.userData.top.map = tex;
      m.userData.top.userData.uOther.value = this.provider.get(reverse);
      m.userData.edgeTex.repeat.set(1, Math.max(0.15, count / 90));
    };
    setBlock(this.leftBlock, (lt + 1) * this.lt, 2 * lt + 1, lt + 1, 2 * lt);
    setBlock(this.rightBlock, (N - rt) * this.lt, 2 * rt, N - rt, 2 * rt + 1);
    const used = [2 * lt + 1, 2 * rt];
    for (const f of this.flying) used.push(2 * f.index, 2 * f.index + 1);
    this.provider.protect(used);
    // nearest pages first, then a wider ring (a fast riffle or slider jump needs them)
    const ahead = [];
    for (let k = 1; k <= 8; k++) ahead.push(2 * rt + k, 2 * lt + 1 - k);
    this.provider.prefetch(ahead);
    this.onEvent('pages');
  }

  bowAmp() { return this.W * BOW * this.a * this.a; }

  _shapeBlock(m) {
    const h = m.userData.h || 0, bw = this.bowAmp();
    const key = h.toFixed(6) + '|' + bw.toFixed(5);
    if (m.userData.key === key) return;
    m.userData.key = key;
    // same topology every time: rewrite the vertex data instead of reallocating GPU buffers
    const g = blockGeometry(this.W, this.H, m.userData.side, h, bw);
    for (const name of ['position', 'normal', 'uv']) {
      const dst = m.geometry.getAttribute(name);
      dst.array.set(g.getAttribute(name).array);
      dst.needsUpdate = true;
    }
    m.geometry.index.array.set(g.index.array);
    m.geometry.index.needsUpdate = true;
    g.dispose();
  }

  _applyA() {
    const gamma = Math.PI * (1 - this.a);
    if (this.leftBlock) { this._shapeBlock(this.leftBlock); this._shapeBlock(this.rightBlock); }
    if (this.binding) this.binding.visible = this.a > 0.6;
    this.leftHalf.rotation.z = -gamma;
    this.inner.position.x = -(this.L / 2) * (1 - this.a) * this.centerBlend;
    if (Math.abs(gamma - this._gamma) > 1e-5) { this.spine.update(gamma); this._gamma = gamma; }
  }

  pageInfo() {
    return {
      closed: this.a < 0.5,
      left: this.leftTop >= 0 ? 2 * this.leftTop + 2 : null,
      right: this.rightTop < this.N && 2 * this.rightTop < this.provider.pageCount ? 2 * this.rightTop + 1 : null,
      total: this.provider.pageCount,
    };
  }

  leftCount() { let n = 0; for (let i = 0; i < this.N; i++) if (this.side[i] === 1) n++; return n; }

  isBusy() { return !!this.drag || this.flying.length > 0 || this.aGoal !== null || this.riffle > 0; }

  // ---------- leaves ----------
  _spawn(index, dir, follower = false) {
    this.side[index] = 2;
    const mesh = this.pool.pop() || new LeafMesh(this, this.blank);
    mesh.setPages(this.provider.get(2 * index), this.provider.get(2 * index + 1));
    this.inner.add(mesh.group);
    const p = dir > 0 ? 0 : 1;
    const f = { index, dir, p, v: 0, target: null, k: 0, kTarget: 0, bend: BEND * 0.8, rate: 0, mesh, dragging: false,
      from: dir > 0 ? 0 : 1, follower, wob: Math.random() * 6 };
    mesh.update(index, p, dir, 0);
    this.flying.push(f);
    this._refresh();
    if (!follower) this.onEvent('lift');
    return f;
  }

  // put any lifted 'follower' sheets straight back (they are only an air effect)
  _dropFollowers() {
    for (const f of [...this.flying]) if (f.follower) { f.target = f.from; f.p = f.from; this._settle(f); }
  }

  _settle(f) {
    this.side[f.index] = f.target === 1 ? 1 : 0;
    this.inner.remove(f.mesh.group);
    this.pool.push(f.mesh);
    this.flying.splice(this.flying.indexOf(f), 1);
    this._refresh();
    if (f.target !== f.from && !f.cued) this.onEvent('land', f.target === 1 ? 1 : -1);
  }

  snapAll() {
    if (this.drag && this.drag.type === 'leaf') this.drag = null;
    for (const f of [...this.flying]) {
      f.dragging = false;
      if (f.target === null) f.target = f.p > 0.5 ? 1 : 0;
      f.p = f.target;
      this._settle(f);
    }
  }

  _leafX(u0, w0, p, dir, alpha, b) {
    sheetPoint(sheetFrame(this.W, this.H, p, dir, alpha, b), u0, w0, OUT);
    return OUT[0];
  }

  _solveP(u0, w0, x, dir, alpha, b) {
    let lo = 0, hi = 1;
    for (let it = 0; it < 20; it++) {
      const mid = (lo + hi) / 2;
      if (this._leafX(u0, w0, mid, dir, alpha, b) > x) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  _coverX(a, r) {
    const g = Math.PI * (1 - a);
    return -(this.L / 2) * (1 - a) * this.centerBlend - r * this.L * Math.cos(g) - (this.T / 2) * Math.sin(g);
  }

  _solveA(X, r) {
    let lo = 0, hi = 1;
    for (let it = 0; it < 22; it++) {
      const mid = (lo + hi) / 2;
      if (this._coverX(mid, r) > X) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---------- gestures (X, Z in root-local coordinates) ----------
  beginDrag(X, Z) {
    if (this.centerBlend < 0.999) return false;
    this.riffle = 0;
    const x = X - this.inner.position.x;
    const gv = clamp01((Z + this.H / 2) / this.H);
    const startCover = (r) => {
      if (this.flying.length) this.snapAll();
      this.aGoal = null;
      this.drag = { type: 'cover', r: clamp(r, 0.3, 1), target: this.a, samples: [[performance.now(), this.a]] };
      this.onEvent('lift');
      return true;
    };
    if (this.a < 0.999) {
      // while the cover is still swinging open, ignore touches (a quick swipe would grab the cover
      // and drag the book shut); once it has settled, pages turn normally
      if (this.aGoal === 1) return false;
      return startCover(Math.abs(x) / this.L);
    }
    let f;
    this._dropFollowers();
    if (x >= 0) {
      if (this.flying.some((q) => q.target !== 1)) this.snapAll();
      if (this.rightTop >= this.N) return false;
      f = this._spawn(this.rightTop, 1);

    } else {
      if (this.flying.some((q) => q.target !== 0)) this.snapAll();
      if (this.leftTop < 0) return this.flying.length ? false : startCover(-x / this.L);
      f = this._spawn(this.leftTop, -1);

    }
    f.dragging = true;
    // a little diagonal lean when grabbed near a corner; kept small because paper cannot stretch
    // grabbing near a corner tilts the fold so that corner leads
    f.k = f.kTarget = clamp((gv - 0.5) * 0.5, -K_MAX, K_MAX);
    const u0 = clamp(Math.abs(x), 0.25 * this.W, this.W), w0 = clamp(Z, -this.H / 2, this.H / 2);
    this.drag = { type: 'leaf', f, u0, w0, gv, target: f.p, samples: [[performance.now(), f.p]] };
    return true;
  }

  dragTo(X, Z) {
    const d = this.drag;
    if (!d) return;
    const now = performance.now();
    if (d.type === 'cover') {
      d.target = this._solveA(X, d.r);
    } else {
      const f = d.f;
      const x = X - this.inner.position.x;
      const fv = (Z + this.H / 2) / this.H;
      f.kTarget = clamp((d.gv - 0.5) * 0.5 + (fv - d.gv) * 0.6, -K_MAX, K_MAX);
      d.target = this._solveP(d.u0, d.w0, x, f.dir, f.k, f.bend);
    }
    d.samples.push([now, d.target]);
    while (d.samples.length > 2 && now - d.samples[0][0] > 110) d.samples.shift();
  }

  endDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const s = d.samples, a = s[0], b = s[s.length - 1];
    const dtS = Math.max((b[0] - a[0]) / 1000, 1 / 120);
    const vel = performance.now() - b[0] > 120 ? 0 : (b[1] - a[1]) / dtS;
    if (d.type === 'cover') {
      this.aGoal = vel > 1.2 ? 1 : vel < -1.2 ? 0 : this.a > 0.5 ? 1 : 0;
      this.aVel = clamp(vel, -6, 6);
    } else {
      const f = d.f;
      f.dragging = false;
      f.p = d.target;
      // easy to complete: a third of the way, or a gentle flick, is enough;
      // only a clear pull back the other way cancels the turn
      const toward = f.from === 0 ? 1 : -1;                 // direction that completes the turn
      const progress = f.from === 0 ? f.p : 1 - f.p;
      const v = vel * toward;
      const complete = v > 0.45 || (v > -1.2 && progress > 0.32);
      f.target = complete ? 1 - f.from : f.from;
      // calm release: keep only part of the finger's speed
      f.v = clamp(vel * 0.45, -2.2, 2.2);
    }
  }

  // Jump to a spread (number of leaves on the left). Far jumps move the stacks directly
  // and riffle only the last few leaves, so any distance takes well under a second.
  goTo(target) {
    target = clamp(Math.round(target), 0, this.N);
    if (this.centerBlend < 0.999 || this.a < 0.999 || this.drag) return;
    this.snapAll();
    this.riffle = 0;
    const cur = this.leftCount();
    const dir = Math.sign(target - cur);
    if (!dir) return;
    const steps = Math.abs(target - cur);
    const shown = Math.min(steps, 5);
    for (let k = 0; k < steps - shown; k++) {
      if (dir > 0) this.side[cur + k] = 1; else this.side[cur - 1 - k] = 0;
    }
    if (steps > shown) this._refresh();
    this.riffle = shown;
    this.riffleDir = dir;
    this.riffleT = 0;
  }

  autoTurn(dir, gv = 0.5, speed = 1.7, straight = false) {
    if (this.centerBlend < 0.999 || this.drag) return;
    if (this.a < 0.999) {
      if (dir > 0 && this.a < 0.5 && this.aGoal === null) { this.aGoal = 1; this.aVel = 1.8; this.onEvent('lift'); }
      return; // still opening: ignore until the cover has settled
    }
    this._dropFollowers();
    // riffled sheets share one straight fold so sheets in the air together never cross
    const lean = straight ? 0 : clamp((gv - 0.5) * 0.35 + (Math.random() - 0.5) * 0.12, -K_MAX, K_MAX);
    if (dir > 0) {
      if (this.flying.some((q) => q.target !== 1)) this.snapAll();
      if (this.rightTop >= this.N) return;
      const f = this._spawn(this.rightTop, 1);
      f.target = 1; f.v = speed; f.k = lean; f.fast = straight;
    } else {
      if (this.flying.some((q) => q.target !== 0)) this.snapAll();
      if (this.leftTop < 0) {
        if (!this.flying.length) { this.aGoal = 0; this.aVel = -1.8; this.onEvent('lift'); }
        return;
      }
      const f = this._spawn(this.leftTop, -1);
      f.target = 0; f.v = -speed; f.k = lean; f.fast = straight;
    }
  }

  closeBook() {
    this.snapAll();
    this.drag = null;
    if (this.a > 0) { this.aGoal = 0; this.aVel = -1.2; }
  }

  isClosed() { return this.a === 0 && this.aGoal === null && !this.drag && !this.flying.length; }

  // ---------- simulation ----------
  update(dt) {
    if (this.riffle > 0 && !this.drag) {
      this.riffleT -= dt;
      if (this.riffleT <= 0) {
        this.autoTurn(this.riffleDir, 0.5, 5.5, true);
        this.riffle--;
        this.riffleT = 0.075;
      }
    }
    // cover / left half
    if (this.drag && this.drag.type === 'cover') {
      this.a = damp(this.a, this.drag.target, 28, dt);
    } else if (this.aGoal !== null) {
      const r = spring(this.a, this.aVel, this.aGoal, 9, dt);
      this.a = r.p; this.aVel = r.v;
      if (r.done) {
        this.a = this.aGoal;
        this.onEvent(this.aGoal === 1 ? 'opened' : 'closed');
        this.aGoal = null;
      }
    }
    this._applyA();

    // leaves
    for (let n = this.flying.length - 1; n >= 0; n--) {
      const f = this.flying[n];
      const p0 = f.p;
      if (f.dragging) {
        f.p = damp(f.p, this.drag.target, 30, dt);
        f.k = damp(f.k, f.kTarget, 12, dt);
      } else {
        // released sheets drift down a touch slower than a riffle
        const r = spring(f.p, f.v, f.target, f.follower ? 14 : f.fast ? 10 : 6.8, dt);
        const speed = Math.abs(f.v);
        f.p = r.p; f.v = r.v;
        f.k = damp(f.k, 0, 2.5, dt);
        if (r.done) {
          f.p = f.target;
          if (f.target !== f.from && !f.follower) this.kick(f.target === 1 ? 1 : -1, speed);
          if (!f.cued && f.target !== f.from) { f.cued = true; this.onEvent('land', f.target === 1 ? 1 : -1); }
          this._settle(f);
          continue;
        }
        if (!f.cued && f.target !== f.from && Math.abs(f.p - f.target) < 0.07) { f.cued = true; this.onEvent('land', f.target === 1 ? 1 : -1); }
      }
      // paper bends more the faster it moves through the air, flutters a little at speed, relaxes when slow
      f.rate = damp(f.rate, Math.abs(f.p - p0) / Math.max(dt, 1e-3), 8, dt);
      f.wob += dt * 17;
      const lift = Math.sin(Math.PI * f.p);
      const flutter = 0.03 * Math.sin(f.wob) * Math.min(1, f.rate / 4) * lift;
      f.bend = damp(f.bend, 0.36 + Math.min(0.14, f.rate * 0.045) + 0.06 * lift, 4, dt);
      f.mesh.update(f.index, f.p, f.dir, f.k, f.bend + flutter);
      // a fast turn drags the next sheet up a little (air and friction), then it drops back
      if (!f.follower && !f.pulled && this.riffle === 0 && f.k !== 0 && f.rate > 2.2 && lift > 0.15 && lift < 0.8) {
        f.pulled = true;
        const next = f.dir > 0 ? this.rightTop : this.leftTop;
        if (next >= 0 && next < this.N && this.side[next] !== 2) {
          const g = this._spawn(next, f.dir, true);
          g.target = g.from; g.v = f.dir * Math.min(1.2, 0.35 + f.rate * 0.12); g.k = f.k * 0.5;
        }
      }
    }
    // the whole book rocks a touch when a page lands and leans toward the heavier side
    const heavy = this.centerBlend * this.a * ((this.leftCount() / this.N) - 0.5) * 0.012;
    const acc = 70 * (heavy - this.rock) - 5 * this.rockV;
    this.rockV += acc * dt;
    this.rock += this.rockV * dt;
    this.inner.rotation.z = this.rock * this.centerBlend;
    this.provider.tick(!this.isBusy());
  }

  kick(side, speed) { this.rockV += side * Math.min(0.05, 0.012 + speed * 0.006); }

  dispose() {
    this.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    for (const m of this.pool) m.dispose();
    for (const f of this.flying) f.mesh.dispose();
    for (const m of this._mats) m.dispose();
    for (const b of [this.leftBlock, this.rightBlock]) { b.userData.top.dispose(); b.userData.edge.dispose(); b.userData.edgeTex.dispose(); }
    if (this._hbTex) this._hbTex.dispose();
    this.provider.dispose();
  }
}

// Critically damped spring with hard stops at 0 and 1.
function spring(p, v, target, w, dt) {
  const steps = Math.max(1, Math.ceil(dt * 240));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    const acc = w * w * (target - p) - 2 * w * v;
    v += acc * h;
    p += v * h;
    if ((target === 1 && p >= 1) || (target === 0 && p <= 0)) return { p: target, v: 0, done: true };
  }
  if (p < 0) { p = 0; v = Math.max(v, 0); }
  if (p > 1) { p = 1; v = Math.min(v, 0); }
  const done = Math.abs(p - target) < 0.0015 && Math.abs(v) < 0.03;
  return { p, v, done };
}
