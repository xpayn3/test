import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/three/addons/environments/RoomEnvironment.js';
import { asset } from './assets.js';
import { Book, slabGeometry } from './book.js';
import { PageProvider, preloadImages, imageUrls } from './pages.js';
import * as TX from './textures.js';
import { CONFIG } from './config.js';
import { Sound } from './sound.js';

const $ = (s) => document.querySelector(s);
const ui = { back: $('#back'), hint: $('#hint'), pager: $('#pager'), title: $('#title'), loader: $('#loader'), mute: $('#mute') };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

async function loadFonts() {
  if (!document.fonts) return;
  const fams = ['400 30px "EB Garamond"', 'italic 400 30px "EB Garamond"', '600 30px "EB Garamond"'];
  await Promise.race([Promise.all(fams.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
}
await loadFonts();

// ---------------------------------------------------------------- renderer
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Big kiosk screens: cap the render resolution, and lower it automatically if frames get slow.
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 1.5);
let dpr = MAX_DPR;
renderer.setPixelRatio(dpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
TX.GFX.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const BG = 0x090706;
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.FogExp2(BG, 0.17);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.12;

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.02, 60);
scene.add(camera);

const sound = new Sound(CONFIG.sound, CONFIG.sounds);

// ---------------------------------------------------------------- lights
scene.add(new THREE.HemisphereLight(0xffe2c0, 0x120c08, 0.22));

const shelfSpot = new THREE.SpotLight(0xffd3a0, 3.4, 0, 0.6, 0.8, 0);
shelfSpot.position.set(0.25, 3.0, 1.9);
shelfSpot.target.position.set(0, 1.3, 0);
shelfSpot.castShadow = true;
shelfSpot.shadow.mapSize.set(2048, 2048);
shelfSpot.shadow.bias = -0.0004;
shelfSpot.shadow.normalBias = 0.01;
shelfSpot.shadow.radius = 3;
shelfSpot.shadow.camera.near = 1;
shelfSpot.shadow.camera.far = 6;
shelfSpot.shadow.autoUpdate = false;  // re-rendered only when something on the shelf moves
shelfSpot.shadow.needsUpdate = true;
scene.add(shelfSpot, shelfSpot.target);

const rim = new THREE.DirectionalLight(0x8ea4c8, 0.25);
rim.position.set(-3, 2, 3);
scene.add(rim);

// reading spotlight + visible beam
const READ_ANGLE = 0.3;
const readSpot = new THREE.SpotLight(0xfff0da, 0, 0, READ_ANGLE, 0.55, 0);
readSpot.castShadow = true;
readSpot.shadow.mapSize.set(2048, 2048);
readSpot.shadow.bias = -0.0001;
readSpot.shadow.normalBias = 0.0012;
readSpot.shadow.radius = 3;
readSpot.shadow.camera.near = 0.2;
readSpot.shadow.camera.far = 4;
scene.add(readSpot, readSpot.target);

const beamGeo = new THREE.ConeGeometry(1, 1, 64, 1, true);
beamGeo.translate(0, -0.5, 0);
const beamMat = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(0xffe6c4) }, uOpacity: { value: 0 } },
  vertexShader: `
    varying float vY; varying vec3 vN; varying vec3 vV;
    void main() {
      vY = -position.y;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uOpacity;
    varying float vY; varying vec3 vN; varying vec3 vV;
    void main() {
      float facing = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
      float along = smoothstep(0.0, 0.25, vY) * (1.0 - smoothstep(0.75, 1.0, vY));
      gl_FragColor = vec4(uColor, uOpacity * facing * along);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});
const beam = new THREE.Mesh(beamGeo, beamMat);
beam.renderOrder = 10;
scene.add(beam);
// dust motes drifting in the beam
{
  const n = 260, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = -0.15 - Math.random() * 0.8, r = Math.sqrt(Math.random()) * -y * 0.9, a = Math.random() * Math.PI * 2;
    p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = y; p[i * 3 + 2] = Math.sin(a) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color: 0xffe7c2, size: 0.0022, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  beam.userData.dust = new THREE.Points(g, m);
  beam.add(beam.userData.dust);
}

// darkness that falls over the world while reading (sits just behind the book)
const dimMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false, fog: false });
const dim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), dimMat);
dim.renderOrder = 5;
camera.add(dim);

// ---------------------------------------------------------------- two floating wall shelves
const BW = 1.15, BD = 0.26, BT = 0.036, BH = 1.78;
const BOARD_TOPS = [1.0, 1.4];
const SHELF_CY = 1.36;
const FRONT_Z = BD / 2;
const ROW_X0 = -BW / 2 + 0.07, ROW_X1 = BW / 2 - 0.09;
const metalMat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.35, metalness: 0.8 });
{
  const woodTex = TX.canvasTexture(TX.woodCanvas(1024, 256, 11), { wrap: true });
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.5, color: 0xb88f6c });
  for (const t of BOARD_TOPS) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(BW, BT, BD), wood);
    b.position.set(0, t - BT / 2, 0);
    b.castShadow = b.receiveShadow = true;
    scene.add(b);
  }
}
function addBookend(x, y, flip) {
  const g = new THREE.Group();
  const upright = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.15, 0.11), metalMat);
  upright.position.set(0, 0.075, 0);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.003, 0.11), metalMat);
  foot.position.set(flip * 0.035, 0.0015, 0);
  g.add(upright, foot);
  g.position.set(x, y, FRONT_Z - 0.075);
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  scene.add(g);
}

// ---------------------------------------------------------------- shelf books
const PALETTE = ['#5e1a17', '#1f2f4a', '#24402c', '#5a3a1e', '#7a5a18', '#1b1a1d', '#4a1630', '#1d4a4a', '#6b5e4a', '#3a2a4a', '#8a3a1e', '#2e3b2a'];
const TITLE_W = ['Silent', 'Orchard', 'River', 'Winter', 'Letters', 'Garden', 'Night', 'Salt', 'Lantern', 'Hours', 'Stone', 'Shadows', 'Glass', 'Northern', 'Light', 'Harbour', 'Clocks', 'Sea', 'Forest', 'Ashes', 'Atlas', 'Birds', 'Memory', 'Paper', 'Maps', 'Silver'];
const NAMES = ['Novak', 'Horvat', 'Kranjc', 'Zupan', 'Kos', 'Vidmar', 'Golob', 'Turk', 'Bizjak', 'Mlakar', 'Hribar', 'Potočnik', 'Lesar', 'Bevk'];
const UPRIGHT_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)));

// standing face-out (cover towards the viewer), leaning back slightly like a display copy
const FACEOUT_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.06).multiply(
  new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0))));

const texLoader = new THREE.TextureLoader();
const coverLoads = [];  // shelf covers: the loader screen waits for these
function imageTexture(url, track = null) {
  let done;
  if (track) track.push(new Promise((r) => { done = r; }));
  const t = texLoader.load(asset(url), (tt) => { renderer.initTexture(tt); if (done) done(); }, undefined,
    () => { console.warn('Missing image:', url); if (done) done(); });
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = TX.GFX.maxAniso;
  return t;
}

const paperMat = new THREE.MeshStandardMaterial({ color: 0xe2d6bb, roughness: 0.95 });
const edgeTex = TX.canvasTexture(TX.pageEdgeCanvas());
const coverMats = new Map();
const shelfBooks = [];
const r = TX.rng(2026);

function makeSpec(over = {}) {
  const H = 0.19 + r() * 0.09;
  const W = H * (0.62 + r() * 0.1);
  const T = 0.014 + Math.pow(r(), 1.6) * 0.045;
  const spec = {
    id: shelfBooks.length,
    H, W, T,
    ct: 0.0024 + r() * 0.0012,
    oh: 0.003,
    color: PALETTE[Math.floor(r() * PALETTE.length)],
    title: TITLE_W[Math.floor(r() * TITLE_W.length)] + (r() < 0.5 ? ' ' + TITLE_W[Math.floor(r() * TITLE_W.length)] : ''),
    author: String.fromCharCode(65 + Math.floor(r() * 26)) + '. ' + NAMES[Math.floor(r() * NAMES.length)],
    style: Math.floor(r() * 3),
    seed: Math.floor(r() * 1e9),
    pages: null,
    ...over,
  };
  spec.L = spec.W + spec.oh;
  spec.Hc = spec.H + 2 * spec.oh;
  spec.leaves = over.leaves ?? clamp(Math.round(spec.T / 0.00024), 30, 220);
  return spec;
}

function addShelfBook(spec, pos, quat) {
  const { L, Hc, T, ct } = spec;
  const z0 = -Hc / 2;
  const geo = slabGeometry(-ct, L, -ct, T + ct, z0, -z0, {
    nx: (p) => [(p[1] + ct) / (T + 2 * ct), 1 - (p[2] - z0) / Hc],
    py: (p) => [(p[0] + ct) / (L + ct), 1 - (p[2] - z0) / Hc],
  });
  const spineTex = TX.canvasTexture(TX.spineCanvas(spec));
  const spineMat = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.6 });
  if (!coverMats.has(spec.color)) coverMats.set(spec.color, new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.65 }));
  const cm = coverMats.get(spec.color);
  const front = spec.coverTex ? new THREE.MeshStandardMaterial({ map: spec.coverTex.shelf || spec.coverTex.front, roughness: 0.7 }) : cm;
  const back = spec.coverTex ? new THREE.MeshStandardMaterial({ map: spec.coverTex.back, roughness: 0.7 }) : cm;
  const mesh = new THREE.Mesh(geo, [paperMat, spineMat, front, back, paperMat, paperMat]);
  mesh.position.copy(pos);
  mesh.quaternion.copy(quat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const bd = { spec, mesh, spineTex, pos: pos.clone(), quat: quat.clone(), pull: 0, pullT: 0, state: { left: 0 } };
  mesh.userData.bd = bd;
  shelfBooks.push(bd);
  return bd;
}

// readable books (scanned), shown face-out on the top shelf
function pageCountOf(B) { return B.pages ? (Array.isArray(B.pages) ? B.pages.length : B.pages.count) : B.leaves * 2; }
const readableSpecs = CONFIG.books.map((B, i) => {
  const count = pageCountOf(B);
  // scanned covers/endpapers are loaded once and kept for the lifetime of the app;
  // the small shelf cover comes first, the reading-size cover right after
  const coverTex = B.cover ? {
    shelf: B.cover.shelf ? imageTexture(B.cover.shelf, coverLoads) : null,
    front: imageTexture(B.cover.front, B.cover.shelf ? null : coverLoads),
    back: imageTexture(B.cover.back),
    endFront: imageTexture(B.cover.endpaperFront),
    endBack: imageTexture(B.cover.endpaperBack),
  } : null;
  return () => makeSpec({
    title: B.title, subtitle: B.subtitle, author: B.author, color: B.color, ink: B.spineInk, spineTitle: B.spineTitle,
    W: B.pageWidth, H: B.pageHeight, T: B.thickness, ct: B.boardThickness ?? 0.003, style: B.cover ? 3 : 0, seed: 77 + i,
    leaves: Math.ceil(count / 2), pageCount: count, pages: B.pages, featured: true, coverTex,
    chapters: B.chapters || [], key: B.id || 'book' + i,
  });
});

// page scans start downloading only once the covers are in, so they never queue ahead of them
Promise.all(coverLoads).then(() => {
  CONFIG.books.forEach((B) => { if (B.pages) preloadImages(imageUrls(B.pages, pageCountOf(B))); });
});

const readables = [];
const FACE_GAP = 0.035;
const faceWidth = readableSpecs.reduce((w, mk) => { const sp = mk(); return w + sp.L + sp.ct + FACE_GAP; }, 0);
for (let s = 0; s < BOARD_TOPS.length; s++) {
  const y = BOARD_TOPS[s];
  const clear = (s + 1 < BOARD_TOPS.length ? BOARD_TOPS[s + 1] - BT : BH) - y - 0.02;
  const xEnd = ROW_X1 - (s === 0 ? 0.05 : 0);
  let x = ROW_X0 + 0.003;
  addBookend(ROW_X0, y, -1);
  let placed = false;
  while (x < xEnd - 0.012) {
    if (s === 1 && !placed && x > -faceWidth / 2 - 0.02) {
      // the readable books stand face-out, centred on the top shelf
      placed = true;
      x += FACE_GAP / 2;
      for (const mk of readableSpecs) {
        const spec = mk();
        const pos = new THREE.Vector3(x + spec.ct, y + (spec.Hc / 2) * Math.cos(0.06) + 0.002, FRONT_Z - 0.07 - spec.T);
        readables.push(addShelfBook(spec, pos, FACEOUT_Q));
        x += spec.L + spec.ct + FACE_GAP;
      }
      continue;
    }
    const spec = makeSpec();
    if (spec.Hc > clear) continue;
    const w = spec.T + 2 * spec.ct;
    if (x + w > xEnd) break;
    const pos = new THREE.Vector3(x + spec.ct, y + spec.Hc / 2, FRONT_Z - 0.012 - spec.ct - r() * 0.014);
    addShelfBook(spec, pos, UPRIGHT_Q);
    x += w + 0.0008 + r() * 0.003;
  }
  addBookend(x + 0.003, y, 1);
}
const shelfMeshes = shelfBooks.map((b) => b.mesh);

if (CONFIG.kiosk.rememberPage) try {
  const saved = JSON.parse(localStorage.getItem('knjiga.pages') || '{}');
  for (const bd of readables) bd.state.left = saved[bd.spec.key] || 0;
} catch { /* storage unavailable */ }

// ---------------------------------------------------------------- camera / framing
const view = { camX: 0, camY: SHELF_CY, camXT: 0, camYT: SHELF_CY, vx: 0, vy: 0, dist: 1.6, limX: 0, yMin: SHELF_CY, yMax: SHELF_CY };
const zoom = { z: 1, zT: 1, fx: 0, fz: 0, fxT: 0, fzT: 0 };

function frame() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  const tanh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  view.dist = clamp(Math.max(1.0 / (2 * tanh), 1.32 / (2 * tanh * camera.aspect)), 1.0, 2.7);
  const halfW = view.dist * tanh * camera.aspect, halfH = view.dist * tanh;
  view.limX = Math.max(0, BW / 2 + 0.05 - halfW);
  view.yMin = Math.min(SHELF_CY, Math.max(halfH - 0.05, 0.25));
  view.yMax = Math.max(SHELF_CY, Math.min(BH + 0.05 - halfH, 0.65));
  view.camXT = clamp(view.camXT, -view.limX, view.limX);
  view.camYT = clamp(view.camYT, view.yMin, view.yMax);
  setShelfHint();
  measureLayout();
  if (active && mode === 'reading') applyFocus();
}
window.addEventListener('resize', frame);

function placeCamera() {
  camera.position.set(view.camX, view.camY, FRONT_Z + view.dist);
  camera.lookAt(view.camX, view.camY - 0.06, 0);
  camera.updateMatrixWorld();
}

// ---------------------------------------------------------------- reading pose
const TILT = 0.42;
const Q_TILT = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, Math.sin(TILT), Math.cos(TILT)), new THREE.Vector3(0, -Math.cos(TILT), Math.sin(TILT))));
const _v = new THREE.Vector3();

// Screen layout while reading: a band at the top (headline + buttons), a band at the bottom
// (slider, hint, page numbers); the open book is sized and centred in the space between.
const layout = { top: 190, bottom: 160, buttonsTop: 110, sliderTop: 0 };
function measureLayout() {
  const H = window.innerHeight;
  const titleBottom = ui.title.offsetTop + ui.title.offsetHeight;   // laid out even while faded out
  layout.buttonsTop = Math.round(titleBottom + 12);
  layout.top = layout.buttonsTop + (ui.back.offsetHeight || 46) + 26;
  layout.sliderTop = Math.round(H - 136);
  layout.bottom = H - layout.sliderTop + 20;
}

function readingDistance(book) {
  const tanh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const H = window.innerHeight, W = window.innerWidth;
  const availH = Math.max(140, H - layout.top - layout.bottom), availW = Math.max(200, W - 80);
  // the tilted book's near (bottom) edge is a little closer, so leave a few percent extra
  const fitH = book.Hc * Math.cos(TILT) * 1.1 * (H / availH);
  const fitW = 2 * book.L * 1.04 * (W / availW);
  return Math.max(fitH / (2 * tanh), fitW / (2 * tanh * camera.aspect));
}

function readingPose(book, pos, quat) {
  const d = readingDistance(book) / zoom.z;
  const tanh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const c = Math.cos(TILT), s = Math.sin(TILT);
  // centre the book in the free band between the top and bottom UI
  const H = window.innerHeight;
  const centrePx = layout.top + (H - layout.top - layout.bottom) / 2;
  const up = (H / 2 - centrePx) * (2 * d * tanh / H);
  _v.set(-zoom.fx, zoom.fz * c + up, -d - zoom.fz * s);
  pos.copy(camera.localToWorld(_v));
  quat.copy(camera.quaternion).multiply(Q_TILT);
  return d;
}

// ---------------------------------------------------------------- app state
let mode = 'shelf';      // shelf | out | reading | closing | in
let active = null;       // { bd, book }
let flight = 0;
let blend = 0;           // 0 shelf ... 1 reading
let shownOpenHint = false;
const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), PR = new THREE.Vector3();
const QR = new THREE.Quaternion(), QT = new THREE.Quaternion();
const endpaperTex = TX.canvasTexture(TX.endpaperCanvas(3), { wrap: true });
endpaperTex.repeat.set(2, 3);

function startReading(bd) {
  if (mode !== 'shelf') return;
  const spec = bd.spec;
  const provider = new PageProvider({
    aspect: spec.H / spec.W,
    pageCount: spec.pageCount ?? spec.leaves * 2,
    title: spec.title, author: spec.author, seed: spec.seed,
    images: spec.pages || null,
    onReady: (t) => renderer.initTexture(t),
    maxCache: spec.pages ? 40 : 24,
  });
  const ct = spec.coverTex;
  const tex = {
    cover: ct ? ct.front : TX.canvasTexture(TX.coverCanvas(spec)),
    back: ct ? ct.back : TX.canvasTexture(TX.backCoverCanvas(spec)),
    spine: bd.spineTex,
    endpaper: endpaperTex,
    endpaperFront: ct ? ct.endFront : endpaperTex,
    endpaperBack: ct ? ct.endBack : endpaperTex,
    edge: edgeTex,
  };
  const book = new Book({ ...spec, startLeft: bd.state.left }, provider, tex);
  book.onEvent = (e, arg) => {
    if (e === 'lift') sound.lift();
    else if (e === 'land') { sound.land(); if (isPortrait()) setFocus(arg > 0 ? 'left' : 'right'); }
    else if (e === 'opened') setFocus('right');
    else if (e === 'closed' && mode === 'reading') { sound.thud(); setFocus(null); }
    if (e === 'pages' || e === 'opened' || e === 'closed') updatePager();
  };
  book.root.position.copy(bd.mesh.position);
  book.root.quaternion.copy(bd.mesh.quaternion);
  active = { bd, book, covTex: ct ? [] : [tex.cover, tex.back] };
  mode = 'loading';
  // compile every shader this book will need (incl. turning leaves) without blocking a frame
  const warm = new THREE.Group();
  warm.add(book.root);
  for (const m of book.pool) warm.add(m.group);
  for (const t of [tex.cover, tex.back, tex.spine, tex.endpaperFront, tex.endpaperBack, tex.edge]) if (t.image) renderer.initTexture(t);
  renderer.compileAsync(warm, camera, scene).catch(() => {}).then(() => {
    for (const m of book.pool) warm.remove(m.group);
    scene.add(book.root);
    bd.mesh.visible = false;
    mode = 'out';
    flight = 0;
    sound.slide();
  });
  P0.copy(bd.pos);
  P1.copy(bd.pos).add(new THREE.Vector3(0, 0.004, spec.L + 0.05));
  zoom.zT = zoom.z = 1; zoom.fx = zoom.fy = zoom.fxT = zoom.fzT = zoom.fz = 0;
  focus = null; applyFocus(); zoom.z = zoom.zT;
  Object.assign(inspect, { yaw: 0, pitch: 0, yawT: 0, pitchT: 0, vy: 0, vp: 0, gv: 0, lift: 0, dragging: false, goal: null, openAfter: false });
  setTitle(spec.title, null);
  hint('');
}

function backToShelf() {
  if (mode !== 'reading') return;
  mode = 'closing';
  active.book.closeBook();
  zoom.zT = 1; zoom.fxT = zoom.fzT = 0;
  hint('');
}

function finishReturn() {
  const { bd, book, covTex } = active;
  bd.state.left = CONFIG.kiosk.rememberPage ? book.leftCount() : 0;
  if (bd.spec.featured && CONFIG.kiosk.rememberPage) {
    try {
      const saved = JSON.parse(localStorage.getItem('knjiga.pages') || '{}');
      saved[bd.spec.key] = bd.state.left;
      localStorage.setItem('knjiga.pages', JSON.stringify(saved));
    } catch { /* ignore */ }
  }
  scene.remove(book.root);
  book.dispose();
  covTex.forEach((t) => t.dispose());
  bd.mesh.visible = true;
  active = null;
  mode = 'shelf';
  sound.thud();
  setShelfHint();
}

function updateFlight(dt) {
  const { book } = active;
  const root = book.root;
  if (mode === 'out') {
    flight += dt;
    const t1 = 0.55, t2 = 1.15;
    if (flight < t1) {
      root.position.lerpVectors(P0, P1, easeOut(flight / t1));
      root.quaternion.copy(active.bd.quat);
    } else {
      const t = Math.min((flight - t1) / t2, 1), e = easeInOut(t);
      readingPose(book, PR, QR);
      root.position.lerpVectors(P1, PR, e);
      root.position.y += Math.sin(Math.PI * e) * 0.07;
      QT.copy(active.bd.quat).slerp(QR, easeInOut(clamp(t * 1.1 - 0.05, 0, 1)));
      root.quaternion.copy(QT);
      book.centerBlend = e;
      blend = e;
      if (t >= 1) { mode = 'reading'; hint(book.a < 0.5 ? 'Tap or swipe the cover to open the book' : 'Drag a page to turn it'); updatePager(); }
    }
  } else if (mode === 'reading' || mode === 'closing') {
    zoom.z = damp(zoom.z, zoom.zT, 10, dt);
    zoom.fx = damp(zoom.fx, zoom.fxT, 10, dt);
    zoom.fz = damp(zoom.fz, zoom.fzT, 10, dt);
    readingPose(book, root.position, root.quaternion);
    applyHoverTilt(book, root, dt);
    applyInspect(book, root, dt);
    if (mode === 'closing' && inspect.goal === null && (inspect.yaw || inspect.pitch)) faceFront(false);
    if (mode === 'closing' && book.isClosed() && Math.abs(zoom.z - 1) < 0.01 && inspect.goal === null && !inspect.yaw) { mode = 'in'; flight = 0; }
  } else if (mode === 'in') {
    flight += dt;
    const t2 = 1.0, t1 = 0.5;
    if (flight < t2) {
      const t = flight / t2, e = easeInOut(t);
      readingPose(book, PR, QR);
      root.position.lerpVectors(PR, P1, e);
      root.position.y += Math.sin(Math.PI * e) * 0.07;
      QT.copy(QR).slerp(active.bd.quat, easeInOut(clamp(t * 1.1, 0, 1)));
      root.quaternion.copy(QT);
      book.centerBlend = 1 - e;
      blend = 1 - e;
    } else {
      const t = Math.min((flight - t2) / t1, 1);
      root.position.lerpVectors(P1, P0, easeInOut(t));
      root.quaternion.copy(active.bd.quat);
      book.centerBlend = 0; blend = 0;
      if (t >= 1) { finishReturn(); return; }
    }
  }
  root.updateMatrixWorld();
  book.update(dt);
}

// ---------------------------------------------------------------- hover tilt
// While the book is closed in front of you it leans toward the cursor, as if pressed
// there, and the cover catches the light. No mouse (touch kiosk): a slow idle sway.
const tilt = { x: 0, y: 0, tx: 0, ty: 0, mouseAt: -1e9 };
const _qTilt = new THREE.Quaternion(), _eTilt = new THREE.Euler();
function applyHoverTilt(book, root, dt) {
  const closed = 1 - book.a;                      // full effect closed, a hint when open
  const strength = closed * 1 + book.a * 0.12;
  let tx = inspect.dragging ? 0 : tilt.tx, ty = inspect.dragging ? 0 : tilt.ty;
  if (performance.now() - tilt.mouseAt > 2500) {  // no recent mouse: gentle breathing sway
    const t = performance.now() / 1000;
    tx = Math.sin(t * 0.55) * 0.35 * closed;
    ty = Math.sin(t * 0.37 + 1.3) * 0.25 * closed;
  }
  tilt.x = damp(tilt.x, tx, 6, dt);
  tilt.y = damp(tilt.y, ty, 6, dt);
  // expressed around the screen's axes (applied together with the hand rotation), so the
  // lean always follows the cursor, however the book has been turned
  tilt.yawW = tilt.x * 0.28 * strength;
  tilt.pitchW = -tilt.y * 0.2 * strength;
}

// ---------------------------------------------------------------- turning the closed book in your hands
// While closed, a drag spins the book (yaw all the way round, limited pitch) with a little inertia.
// Tapping the front cover turns it back to face you and opens it; tapping its back or spine just
// brings the front round. Once open, everything works as normal.
const inspect = { yaw: 0, pitch: 0, yawT: 0, pitchT: 0, vy: 0, vp: 0, gv: 0, lift: 0, dragging: false, goal: null, openAfter: false };
const PITCH_MAX = 0.55;
// rubber band: free in the middle, ever stiffer towards the limit
const softPitch = (p) => PITCH_MAX * Math.tanh(p / PITCH_MAX);
const _qi = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _ax = new THREE.Vector3();
// drag-to-rotate of the closed book is switched off: a drag on the closed cover swipes it open
function canInspect() { return false; }
function applyInspect(book, root, dt) {
  if (inspect.goal !== null) {
    // eased turn back to the front (critically damped spring: starts gently, lands softly)
    const w = 9, h = Math.min(dt, 1 / 30);
    inspect.gv += (w * w * (inspect.goal - inspect.yaw) - 2 * w * inspect.gv) * h;
    inspect.yaw += inspect.gv * h;
    inspect.pitch = damp(inspect.pitch, 0, 7, dt);
    if (Math.abs(inspect.yaw - inspect.goal) < 0.004 && Math.abs(inspect.gv) < 0.05 && Math.abs(inspect.pitch) < 0.004) {
      inspect.yaw = inspect.pitch = inspect.gv = 0; inspect.goal = null;
      inspect.yawT = inspect.pitchT = 0;
      if (inspect.openAfter) { inspect.openAfter = false; book.autoTurn(1); }
    }
  } else if (inspect.dragging) {
    // glide after the finger instead of snapping to it
    inspect.yaw = damp(inspect.yaw, inspect.yawT, 18, dt);
    inspect.pitch = damp(inspect.pitch, inspect.pitchT, 18, dt);
  } else {
    // let go: keep spinning with friction, and slowly come back to level
    inspect.yaw += inspect.vy * dt;
    inspect.vy *= Math.exp(-2.4 * dt);
    inspect.pitch = softPitch(inspect.pitch + inspect.vp * dt);
    inspect.vp *= Math.exp(-5 * dt);
    inspect.pitch = damp(inspect.pitch, 0, 1.4, dt);
    inspect.yawT = inspect.yaw; inspect.pitchT = inspect.pitch;
  }
  // picked up: rises a little toward you while held
  inspect.lift = damp(inspect.lift, inspect.dragging ? 1 : 0, inspect.dragging ? 10 : 5, dt);
  if (inspect.lift > 1e-4) {
    _ax.set(0, 0, 1).applyQuaternion(camera.quaternion);
    root.position.addScaledVector(_ax, inspect.lift * 0.035 * book.L);
  }
  const yaw = inspect.yaw + (tilt.yawW || 0), pitch = inspect.pitch + (tilt.pitchW || 0);
  if (Math.abs(yaw) < 1e-5 && Math.abs(pitch) < 1e-5) return;
  // rotate about the book's own centre, around the screen's vertical and horizontal axes
  _ax.set(0, 1, 0).applyQuaternion(camera.quaternion);
  _qi.setFromAxisAngle(_ax, yaw);
  _ax.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _qp.setFromAxisAngle(_ax, pitch);
  _qi.multiply(_qp);
  _v.set(0, book.T / 2, 0).applyQuaternion(root.quaternion);   // centre of the closed book
  root.position.add(_v);
  root.quaternion.premultiply(_qi);
  _v.set(0, book.T / 2, 0).applyQuaternion(root.quaternion);
  root.position.sub(_v);
}
function faceFront(open) {
  // nearest full turn, so it never spins the long way round
  inspect.goal = Math.round(inspect.yaw / (Math.PI * 2)) * Math.PI * 2;
  inspect.vy = inspect.vp = 0; inspect.gv = 0;
  inspect.openAfter = open;
}
function frontCoverFacing(book) {
  // the closed front cover's outward normal is the book's local +y
  _v.set(0, 1, 0).applyQuaternion(book.root.quaternion);
  const toCam = new THREE.Vector3().subVectors(camera.position, book.root.position).normalize();
  return _v.dot(toCam) > 0.35;
}

// ---------------------------------------------------------------- spotlight follow
const _up = new THREE.Vector3(), _fw = new THREE.Vector3(), _rt = new THREE.Vector3();
function updateLights(dt) {
  shelfSpot.intensity = 3.4 * (1 - 0.8 * blend);
  dimMat.opacity = 0.9 * blend;
  dim.visible = blend > 0.001;
  readSpot.intensity = 4.2 * blend;
  beamMat.uniforms.uOpacity.value = 0.09 * blend;
  beam.userData.dust.material.opacity = 0.3 * blend;
  beam.visible = readSpot.visible = blend > 0.001;
  if (!active || blend <= 0.001) return;
  const book = active.book;
  const d = readingDistance(book);
  // anchor = where the open spread sits in front of the camera
  readingPose(book, PR, QR);
  _rt.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  _fw.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const target = PR;
  readSpot.position.copy(target).addScaledVector(_up, d * 1.15).addScaledVector(_fw, -d * 0.35).addScaledVector(_rt, d * 0.04);
  readSpot.target.position.copy(target);
  readSpot.target.updateMatrixWorld();
  readSpot.shadow.camera.far = readSpot.position.distanceTo(target) + 0.4; // only the book, never the shelf
  const dir = _v.copy(target).sub(readSpot.position);
  const len = dir.length() * 1.18;
  dir.normalize();
  beam.position.copy(readSpot.position);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  const rad = len * Math.tan(READ_ANGLE) * 0.95;
  beam.scale.set(rad, len, rad);
  beam.userData.dust.rotation.y += dt * 0.04;
  // the dark veil sits behind the book
  const dd = d / zoom.z + 0.18;
  const tanh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  dim.position.set(0, 0, -dd);
  dim.scale.set(dd * tanh * camera.aspect * 2.4, dd * tanh * 2.4, 1);
}

// ---------------------------------------------------------------- UI
let hintTimer = 0;
function hint(text) {
  ui.hint.textContent = text;
  ui.hint.classList.toggle('show', !!text);
  clearTimeout(hintTimer);
  if (text && mode !== 'shelf') hintTimer = setTimeout(() => ui.hint.classList.remove('show'), 5000);
}
function setShelfHint() {
  if (mode !== 'shelf') return;
  hint(CONFIG.onlyFeatured && readables.length ? 'Tap one of the books on the top shelf to read it' : 'Tap a book to take it off the shelf');
}
function updatePager() {
  if (!active) return;
  const info = active.book.pageInfo();
  let t;
  if (info.closed) t = active.book.leftTop >= 0 ? 'Bookmark kept' : 'Cover';
  else if (info.left && info.right) t = `${info.left} – ${info.right}  /  ${info.total}`;
  else if (info.right) t = `${info.right}  /  ${info.total}`;
  else if (info.left) t = `${info.left}  /  ${info.total}`;
  else t = '';
  ui.pager.textContent = t;
  const ch = info.closed ? null : chapterAt(active.book.leftTop + 1);
  setTitle(active.bd.spec.title, ch);
  if (!info.closed && !shownOpenHint && mode === 'reading') {
    shownOpenHint = true;
    hint('Drag a page to turn it · tap the edges · pinch to zoom');
  }
}
// Back button: centred just above the book's resting top edge (whole pixels, no jitter).
const backPos = { top: -1, left: -1 };
function placeBackButton() {
  if (!active || (mode !== 'reading' && mode !== 'closing')) return;
  const h = ui.back.offsetHeight || 44, w = ui.back.offsetWidth || 160;
  const top = layout.buttonsTop;                      // fixed row right under the headline
  const left = Math.round(window.innerWidth / 2 - w / 2);
  if (Math.abs(top - backPos.top) >= 2 || left !== backPos.left) {
    backPos.top = top; backPos.left = left;
    ui.back.style.top = top + 'px';
    ui.back.style.left = left + 'px';
  }
  // sound button sits just to the right of the back button, vertically centred with it
  const mh = ui.mute.offsetHeight || 40;
  ui.mute.style.top = Math.round(top + (h - mh) / 2) + 'px';
  ui.mute.style.left = Math.round(left + w + 10) + 'px';
  ui.mute.style.right = 'auto';
}
function resetMutePosition() { ui.mute.style.top = ui.mute.style.left = ui.mute.style.right = ''; }
function setTitle(book, poem) {
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<span class="book">${esc(book)}</span><span class="poem">${poem ? esc(poem) : ''}</span>`;
  if (ui.title.innerHTML !== html) { ui.title.innerHTML = html; measureLayout(); }
}
ui.back.addEventListener('click', (e) => { e.stopPropagation(); backToShelf(); });
ui.mute.addEventListener('click', (e) => {
  e.stopPropagation();
  sound.enabled = !sound.enabled;
  ui.mute.classList.toggle('off', !sound.enabled);
});

// ---------------------------------------------------------------- page slider
// A scrubber under the open book: drag to pick a spread (with the poem/chapter shown),
// release to riffle there. Chapter starts are marked on the rail.
const scrub = {
  el: $('#scrub'), track: $('#scrub .track'), fill: $('#scrub .fill'), thumb: $('#scrub .thumb'),
  tip: $('#scrub .tip'), marks: $('#scrub .marks'), dragging: false, value: 0, built: null, shown: -1,
};
// printed page number -> spread index (number of leaves on the left) that shows it
function spreadOfPage(printed) { const i = printed - 1; return i % 2 === 0 ? i / 2 : (i + 1) / 2; }
function chapterAt(spread) {
  let ch = null;
  if (!active) return ch;
  for (const [t, p] of active.bd.spec.chapters || []) if (spreadOfPage(p) <= spread) ch = t;
  return ch;
}
// Marks and thumb are placed in whole CSS pixels so the thin lines stay crisp.
function buildScrub() {
  const b = active.book;
  if (scrub.built === b) return;
  scrub.built = b;
  scrub.layoutW = -1;
  scrub.marks.innerHTML = '';
  scrub.markEls = [];
  const seen = new Set();
  for (const [, page] of active.bd.spec.chapters || []) {
    const sp = spreadOfPage(page);
    if (seen.has(sp)) continue;          // two poems on one spread share a mark
    seen.add(sp);
    const m = document.createElement('div');
    m.className = 'mark';
    m.dataset.spread = sp;
    scrub.marks.appendChild(m);
    scrub.markEls.push(m);
  }
}
function trackWidth() { return Math.max(1, (scrub.width || 300) - 28); }
function layoutMarks() {
  const tw = trackWidth();
  if (tw === scrub.layoutW) return;
  scrub.layoutW = tw;
  for (const m of scrub.markEls) m.style.left = Math.round((m.dataset.spread / active.book.N) * tw) + 'px';
  if (scrub.shownV !== undefined) setScrubVisual(scrub.shownV);
}
function setScrubVisual(v) {
  scrub.shownV = v;
  const px = Math.round((v / active.book.N) * trackWidth());
  scrub.fill.style.width = px + 'px';
  scrub.thumb.style.left = px + 'px';
}
function scrubValue(e) {
  const r = scrub.track.getBoundingClientRect();
  return clamp(Math.round(((e.clientX - r.left) / r.width) * active.book.N), 0, active.book.N);
}
function showTip(v) {
  const b = active.book, total = b.provider.pageCount;
  const L = v > 0 ? 2 * v : null, R = 2 * v + 1 <= total ? 2 * v + 1 : null;
  const pages = L && R ? `${L} – ${R}` : L || R;
  const ch = chapterAt(v);
  scrub.tip.innerHTML = `<b>${pages}</b>${ch ? `<span>${ch}</span>` : ''}`;
}
function updateScrub() {
  const on = !!active && mode === 'reading' && active.book.a > 0.9;
  scrub.el.classList.toggle('hidden', !on);
  if (!on) { scrub.dragging = false; scrub.el.classList.remove('active'); return; }
  buildScrub();
  // fixed band at the bottom of the screen, as wide as the open book
  const bk = active.book;
  readingPose(bk, PR, QR);
  const edge = (x, z) => _v.set(x, 0, z).applyQuaternion(QR).add(PR).project(camera);
  const xR = (edge(bk.L, bk.Hc / 2).x * 0.5 + 0.5) * window.innerWidth;
  const xL = (edge(-bk.L, bk.Hc / 2).x * 0.5 + 0.5) * window.innerWidth;
  const width = Math.round(clamp((xR - xL) * 0.92, 280, window.innerWidth - 32));
  const top = layout.sliderTop;
  const left = Math.round(window.innerWidth / 2 - width / 2);
  if (top !== scrub.top || width !== scrub.width || left !== scrub.left) {
    scrub.top = top; scrub.width = width; scrub.left = left;
    scrub.el.style.top = top + 'px';
    scrub.el.style.left = left + 'px';
    scrub.el.style.width = width + 'px';
  }
  layoutMarks();
  if (scrub.dragging) return;
  // where the book is heading: settled leaves on the left plus leaves flying there
  const b = active.book;
  let v = 0;
  for (let i = 0; i < b.N; i++) if (b.side[i] === 1) v++;
  for (const f of b.flying) if (f.target === 1) v++;
  v += b.riffle > 0 ? b.riffle * b.riffleDir : 0;
  if (v !== scrub.shown) { scrub.shown = v; setScrubVisual(v); }
}
scrub.el.addEventListener('pointerdown', (e) => {
  if (!active || mode !== 'reading') return;
  e.preventDefault();
  try { scrub.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  sound.unlock();
  scrub.dragging = true;
  scrub.el.classList.add('active');
  scrub.value = scrubValue(e);
  setScrubVisual(scrub.value);
  showTip(scrub.value);
});
scrub.el.addEventListener('pointermove', (e) => {
  if (!scrub.dragging) return;
  const v = scrubValue(e);
  if (v === scrub.value) return;
  scrub.value = v;
  setScrubVisual(v);
  showTip(v);
  sound.tick();
});
const endScrub = (e) => {
  if (!scrub.dragging) return;
  scrub.dragging = false;
  scrub.el.classList.remove('active');
  scrub.shown = -1;
  if (e.type !== 'pointercancel' && active) active.book.goTo(scrub.value);
};
scrub.el.addEventListener('pointerup', endScrub);
scrub.el.addEventListener('pointercancel', endScrub);

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointers = new Map();
let gesture = null;
let pinch = null;
const TAP_SLOP = 14; // px a finger may wobble and still count as a tap
const _inv = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3();

function setRay(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

function hitBook(x, y) {
  const book = active.book;
  setRay(x, y);
  book.root.updateMatrixWorld();
  _inv.copy(book.root.matrixWorld).invert();
  _o.copy(raycaster.ray.origin).applyMatrix4(_inv);
  _d.copy(raycaster.ray.direction).transformDirection(_inv);
  const planeY = book.a < 0.5 ? book.T + book.ct : book.T * 0.5;
  if (Math.abs(_d.y) < 1e-6) return null;
  const s = (planeY - _o.y) / _d.y;
  if (s < 0) return null;
  return { X: _o.x + _d.x * s, Z: _o.z + _d.z * s };
}

function nudgeFeatured() {
  if (!readables.length) return;
  readables.forEach((bd, i) => setTimeout(() => {
    bd.pullT = 0.035;
    setTimeout(() => { if (bd.pullT === 0.035) bd.pullT = 0; }, 380);
  }, i * 120));
  hint('Tap one of the books on the top shelf to read it');
  setTimeout(setShelfHint, 3000);
}

function pickShelf(x, y) {
  setRay(x, y);
  const hit = raycaster.intersectObjects(shelfMeshes, false)[0];
  return hit ? hit.object.userData.bd : null;
}

// ---- kiosk: no context menus / selection, return to shelf when idle
let lastInput = performance.now();
const touch = () => { lastInput = performance.now(); };
window.addEventListener('pointerdown', touch, true);
window.addEventListener('keydown', touch, true);
window.addEventListener('wheel', touch, true);
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('selectstart', (e) => e.preventDefault());
window.addEventListener('dragstart', (e) => e.preventDefault());
if (CONFIG.kiosk.hideCursor) document.body.style.cursor = 'none';
function checkIdle() {
  const idle = (performance.now() - lastInput) / 1000;
  if (idle < CONFIG.kiosk.idleSeconds) return;
  if (mode === 'reading' && !active.book.isBusy()) backToShelf();
  else if (mode === 'shelf') { view.camXT = 0; view.camYT = SHELF_CY; lastInput = performance.now(); }
}

function resetInput() {
  pointers.clear();
  pinch = null;
  gesture = null;
  if (active && active.book.drag) active.book.endDrag();
}

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  sound.unlock();
  // A primary pointer starts a new interaction: nothing else can be down,
  // so anything still tracked is stale (a lost pointerup) and must go.
  if (e.isPrimary || pointers.size >= 2) resetInput();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (pointers.size === 2) {
    if (gesture && gesture.started && mode === 'reading') active.book.endDrag();
    gesture = null;
    if (mode === 'reading') startPinch();
    return;
  }
  if (pointers.size > 2) return;
  gesture = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), started: false };
  if (mode === 'shelf') { gesture.cx = view.camXT; gesture.cy = view.camYT; view.vx = view.vy = 0; }
  if (mode === 'reading') gesture.hit = hitBook(e.clientX, e.clientY);
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    tilt.tx = (e.clientX / window.innerWidth) * 2 - 1;
    tilt.ty = -((e.clientY / window.innerHeight) * 2 - 1);
    tilt.mouseAt = performance.now();
  }
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (e.pointerType === 'mouse' && mode === 'shelf') hover(e.clientX, e.clientY);
    return;
  }
  p.x = e.clientX; p.y = e.clientY;
  if (pinch) { movePinch(); return; }
  if (!gesture) return;
  const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
  if (!gesture.started && Math.hypot(dx, dy) > TAP_SLOP) {
    gesture.started = true;
    if (mode === 'reading') {
      const b = active.book, hh = gesture.hit, horiz = Math.abs(dx) > Math.abs(dy);
      if (isPortrait() && focus && hh && b.a > 0.99 && horiz) {
        if (focus === 'left' && hh.X < 0 && dx < 0) gesture.swipe = 'right';
        else if (focus === 'right' && hh.X > 0 && dx > 0 && b.leftTop >= 0) gesture.swipe = 'left';
        gesture.fx0 = zoom.fxT;
      }
      if (!gesture.swipe && canInspect(b) && inspect.goal === null) {
        gesture.inspect = true; inspect.dragging = true;
        inspect.vy = inspect.vp = 0;
        gesture.y0 = inspect.yaw; gesture.p0 = inspect.pitch; gesture.lx = e.clientX; gesture.ly = e.clientY; gesture.lt2 = performance.now();
      } else if (!gesture.swipe) gesture.turning = hh ? b.beginDrag(hh.X, hh.Z) : false;
    }
  }
  if (!gesture.started) return;
  if (mode === 'shelf') {
    const mpp = (2 * view.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
    const nx = clamp(gesture.cx - dx * mpp, -view.limX, view.limX);
    const ny = clamp(gesture.cy + dy * mpp, view.yMin, view.yMax);
    const now = performance.now(), ddt = Math.max((now - (gesture.lt || gesture.t)) / 1000, 1 / 120);
    view.vx = (nx - view.camXT) / ddt; view.vy = (ny - view.camYT) / ddt;
    gesture.lt = now;
    view.camXT = nx; view.camYT = ny;
  } else if (mode === 'reading' && gesture.swipe) {
    const L = active.book.L;
    const mpp = (2 * (readingDistance(active.book) / zoom.zT) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
    zoom.fxT = clamp(gesture.fx0 - dx * mpp, -L / 2, L / 2);
  } else if (mode === 'reading' && gesture.inspect) {
    const k = 3.2 / window.innerWidth * Math.PI;           // a full screen-width drag ≈ 1.6 turns
    inspect.yawT = gesture.y0 + dx * k;
    inspect.pitchT = softPitch(gesture.p0 + dy * k * 0.8);
    const now = performance.now(), ddt = Math.max((now - gesture.lt2) / 1000, 1 / 120);
    inspect.vy = damp(inspect.vy, ((e.clientX - gesture.lx) * k) / ddt, 14, ddt);
    inspect.vp = damp(inspect.vp, ((e.clientY - gesture.ly) * k * 0.8) / ddt, 14, ddt);
    gesture.lx = e.clientX; gesture.ly = e.clientY; gesture.lt2 = now;
  } else if (mode === 'reading' && gesture.turning) {
    const h = hitBook(e.clientX, e.clientY);
    if (h) active.book.dragTo(h.X, h.Z);
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (!gesture) return;
  const g = gesture;
  gesture = null;
  if (g.started) {
    if (mode === 'reading' && g.swipe) {
      if (Math.abs(e.clientX - g.sx) / window.innerWidth > 0.12) setFocus(g.swipe); else applyFocus();
      return;
    }
    if (g.inspect) {
      inspect.dragging = false;
      if (performance.now() - g.lt2 > 90) inspect.vy = inspect.vp = 0;
      inspect.vy = clamp(inspect.vy, -14, 14); inspect.vp = clamp(inspect.vp, -6, 6);
      return;
    }
    if (mode === 'reading' && g.turning) active.book.endDrag();
    if (mode === 'shelf' && performance.now() - (g.lt || 0) > 80) view.vx = view.vy = 0;
    return;
  }
  if (e.type === 'pointercancel') return;
  onTap(e.clientX, e.clientY, g);
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('lostpointercapture', (e) => { if (pointers.has(e.pointerId)) endPointer(e); });
window.addEventListener('blur', resetInput);
canvas.addEventListener('pointerleave', () => { tilt.tx = tilt.ty = 0; });
document.addEventListener('visibilitychange', resetInput);

function onTap(x, y, g) {
  if (mode === 'shelf') {
    const bd = pickShelf(x, y);
    if (bd && CONFIG.onlyFeatured && readables.length && !bd.spec.featured) nudgeFeatured();
    else if (bd) startReading(bd);
    return;
  }
  if (mode !== 'reading') return;
  const book = active.book;
  const h = g.hit || { X: 0, Z: 0 };
  const L = book.L, gv = clamp((h.Z + book.H / 2) / book.H, 0, 1);
  if (book.a >= 0.5 && (!g.hit || Math.abs(h.Z) > book.Hc / 2 + 0.03)) return;
  if (book.a < 0.5) {
    if (book.aGoal !== null) return;
    setRay(x, y);
    if (raycaster.intersectObject(book.root, true).length) book.autoTurn(1, gv);   // tap the cover: open
    return;
  }
  if (isPortrait() && focus) {
    const sx = x / window.innerWidth;
    if (sx > 0.62) { if (focus === 'left') setFocus('right'); else book.autoTurn(1, gv); }
    else if (sx < 0.38) { if (focus === 'right' && book.leftTop >= 0) setFocus('left'); else book.autoTurn(-1, gv); }
    return;
  }
  if (Math.abs(h.X) > L + 0.05) return;
  // anywhere on the right page turns forward, anywhere on the left page turns back
  book.autoTurn(h.X >= 0 ? 1 : -1, gv);
}

function clampZoom() {
  if (!active) return;
  const b = active.book, k = Math.max(0, 1 - 1 / zoom.zT);
  zoom.fxT = clamp(zoom.fxT, -b.L * k * 1.05, b.L * k * 1.05);
  zoom.fzT = clamp(zoom.fzT, -(b.Hc / 2) * k * 1.1, (b.Hc / 2) * k * 1.1);
}

// ---- portrait phones: read one page at a time, the spread pans between pages
const isPortrait = () => camera.aspect < 0.8;
let focus = null; // 'left' | 'right' | null
function singleZoom(book) {
  const tanh = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dS = Math.max((book.Hc * Math.cos(TILT) * 1.3) / (2 * tanh), (book.L * 1.06) / (2 * tanh * camera.aspect));
  return Math.max(1, readingDistance(book) / dS);
}
function applyFocus() {
  if (!active || mode === 'closing' || mode === 'in') return;
  if (!isPortrait()) { focus = null; return; }
  const b = active.book;
  zoom.zT = singleZoom(b);
  zoom.fzT = 0;
  zoom.fxT = b.a < 0.5 || !focus ? 0 : focus === 'right' ? b.L / 2 : -b.L / 2;
}
function setFocus(f) { focus = f; applyFocus(); }

function pinchState() {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}
function startPinch() {
  const s = pinchState();
  pinch = { ...s, z0: zoom.zT, fx0: zoom.fxT, fz0: zoom.fzT };
}
function movePinch() {
  if (mode !== 'reading') return;
  const s = pinchState();
  zoom.zT = clamp(pinch.z0 * (s.d / Math.max(pinch.d, 1)), 1, 3.5);
  const dd = readingDistance(active.book) / zoom.zT;
  const mpp = (2 * dd * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
  zoom.fxT = pinch.fx0 - (s.mx - pinch.mx) * mpp;
  zoom.fzT = pinch.fz0 - ((s.my - pinch.my) * mpp) / Math.cos(TILT);
  clampZoom();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mode !== 'reading') return;
  const h = hitBook(e.clientX, e.clientY);
  const old = zoom.zT;
  zoom.zT = clamp(zoom.zT * Math.exp(-e.deltaY * 0.0015), 1, 3.5);
  if (h) {
    const f = 1 - old / zoom.zT;
    zoom.fxT += (h.X - zoom.fxT) * f;
    zoom.fzT += (h.Z - zoom.fzT) * f;
  }
  if (zoom.zT <= 1.001) { zoom.fxT = zoom.fzT = 0; }
  clampZoom();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (mode !== 'reading') return;
  if (e.key === 'ArrowRight' || e.key === ' ') active.book.autoTurn(1);
  else if (e.key === 'ArrowLeft') active.book.autoTurn(-1);
  else if (e.key === 'Escape') backToShelf();
});

let hovered = null;
function hover(x, y) {
  const bd = pickShelf(x, y);
  if (hovered && hovered !== bd) hovered.pullT = 0;
  hovered = bd;
  if (bd) bd.pullT = 0.02;
  canvas.style.cursor = bd ? 'pointer' : 'default';
}

// ---------------------------------------------------------------- loop
frame();
const clock = new THREE.Clock();
let first = true;
let closingFor = 0;

// adaptive resolution: average the frame time; step the pixel ratio down when slow, back up when there is headroom
let ftAvg = 1 / 60, ftTimer = 0;
function adaptResolution(rawDt) {
  ftAvg += (rawDt - ftAvg) * 0.05;
  ftTimer += rawDt;
  if (ftTimer < 1.5) return;
  let next = dpr;
  if (ftAvg > 1 / 50 && dpr > 0.75) next = Math.max(0.75, dpr - 0.125);
  else if (ftAvg < 1 / 70 && dpr < MAX_DPR) next = Math.min(MAX_DPR, dpr + 0.125);
  if (next !== dpr) { dpr = next; renderer.setPixelRatio(dpr); renderer.setSize(window.innerWidth, window.innerHeight); ftTimer = 0; }
  else ftTimer = 1; // keep checking roughly every half second
}

function tick() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 1 / 20);
  if (!first && rawDt < 0.5) adaptResolution(rawDt);

  if (mode === 'shelf' && !gesture) {
    view.camXT = clamp(view.camXT + view.vx * dt, -view.limX, view.limX);
    view.camYT = clamp(view.camYT + view.vy * dt, view.yMin, view.yMax);
    view.vx *= Math.exp(-5 * dt); view.vy *= Math.exp(-5 * dt);
  }
  view.camX = damp(view.camX, view.camXT, 12, dt);
  view.camY = damp(view.camY, view.camYT, 12, dt);
  placeCamera();

  if (mode === 'out' || mode === 'in') shelfSpot.shadow.needsUpdate = true;
  for (const bd of shelfBooks) {
    if (bd.pull === 0 && bd.pullT === 0) continue;
    shelfSpot.shadow.needsUpdate = true;
    bd.pull = damp(bd.pull, mode === 'shelf' ? bd.pullT : 0, 14, dt);
    if (Math.abs(bd.pull) < 1e-5 && bd.pullT === 0) bd.pull = 0;
    bd.mesh.position.copy(bd.pos).z += bd.pull;
  }

  checkIdle();
  if (active && active.book.drag && !gesture && pointers.size === 0) active.book.endDrag();
  if (mode === 'closing') {
    closingFor += dt;
    if (closingFor > 4) { active.book.snapAll(); active.book.a = 0; active.book.aGoal = null; active.book.drag = null; zoom.z = zoom.zT = 1; }
  } else closingFor = 0;
  if (active) updateFlight(dt);
  updateLights(dt);

  updateScrub();
  if (active && (mode === 'reading' || mode === 'closing')) placeBackButton(); else if (ui.mute.style.left) resetMutePosition();
  ui.back.classList.toggle('hidden', mode !== 'reading');
  ui.title.classList.toggle('hidden', mode !== 'reading');
  ui.pager.classList.toggle('hidden', mode !== 'reading');

  renderer.render(scene, camera);
  if (first) { first = false; Promise.race([Promise.all(coverLoads), new Promise((r) => setTimeout(r, 4000))]).then(() => ui.loader.classList.add('gone')); }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

