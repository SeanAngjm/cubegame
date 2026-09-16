import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LEVELS_BY_MODE, MODE_INFO, VIEW_LABELS, VIEW_EXPLAIN, VIEW_AXIS } from './levels.js';
import {
  rotateX, rotateY, rotateZ, project,
  canonicalize2D, silhouettesMatch, boundingSize,
} from './geometry.js';
import { rotateIconSVG } from './icons.js';

// ---------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------
const SAVE_KEY = 'cubefit-progress-v2';
const MODES = ['easy', 'medium', 'hard'];

function defaultModeProgress() {
  return { stars: {}, bestMoves: {} };
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const modes = {};
    for (const m of MODES) modes[m] = { ...defaultModeProgress(), ...(parsed.modes && parsed.modes[m]) };
    return { lastMode: parsed.lastMode || 'easy', modes };
  } catch (e) {
    const modes = {};
    for (const m of MODES) modes[m] = defaultModeProgress();
    return { lastMode: 'easy', modes };
  }
}

function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(progress));
  } catch (e) { /* storage unavailable - game still works this session */ }
}

let progress = loadProgress();

// ---------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------
const PANEL_SIZE = 5;
const UNIT = 0.92;
const SLIDE_DIST = 4.2; // how far a wall travels from/to, each side of center

let mode = MODES.includes(progress.lastMode) ? progress.lastMode : 'easy';
let LEVELS = LEVELS_BY_MODE[mode];
let levelIndex = 0;
let currentShape = [];
let moveCount = 0;
let animating = false;
let solvedThisAttempt = false;

// ---------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const modeBadgeLabel = el('modeBadgeLabel');
const levelNumEl = el('levelNum');
const levelTotalEl = el('levelTotal');
const viewChipsEl = el('viewChips');
const viewExplainEl = el('viewExplain');
const xrayPanelsEl = el('xrayPanels');
const moveCountEl = el('moveCount');
const feedbackEl = el('feedbackMsg');
const resultOverlay = el('resultOverlay');
const resultTitle = el('resultTitle');
const resultStars = el('resultStars');
const resultMoves = el('resultMoves');
const introToast = el('introToast');

// Per-view x-ray panel DOM state, rebuilt each level load.
let xrayPanelState = {}; // view -> { cells: [{i,j,el}], holeCanonical }

function buildXrayPanels(level) {
  xrayPanelsEl.innerHTML = '';
  xrayPanelState = {};
  const axisClass = { front: 'axis-front', top: 'axis-top', side: 'axis-side' };
  for (const view of level.views) {
    const panel = document.createElement('div');
    panel.className = 'xrayPanel';
    panel.innerHTML = `
      <h2><span class="axisDot ${axisClass[view]}"></span>${VIEW_LABELS[view]}</h2>
      <div class="xrayGrid"></div>
      <div class="legend">
        <span><i class="swatch match"></i> lines up</span>
        <span><i class="swatch open"></i> open</span>
        <span><i class="swatch block"></i> blocks</span>
      </div>`;
    xrayPanelsEl.appendChild(panel);
    const grid = panel.querySelector('.xrayGrid');
    const cells = [];
    for (let j = PANEL_SIZE - 1; j >= 0; j--) {
      for (let i = 0; i < PANEL_SIZE; i++) {
        const cell = document.createElement('div');
        cell.className = 'xcell';
        grid.appendChild(cell);
        cells.push({ i, j, el: cell });
      }
    }
    xrayPanelState[view] = { cells, holeCanonical: canonicalize2D(level.holes[view]) };
  }
}

// ---------------------------------------------------------------------
// Three.js setup
// ---------------------------------------------------------------------
const canvas = el('three-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0e1e);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(3.2, 2.6, 5.6);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.minDistance = 3;
controls.maxDistance = 10.5;
// One-finger touch is reserved for swiping the PIECE (see the pointer
// handlers below), so map it to PAN and then disable panning outright -
// that keeps OrbitControls' own pointer bookkeeping/capture correct
// (it still "sees" the first finger land) without actually moving the
// camera. Two fingers still orbit + zoom the camera as normal.
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.enablePan = false;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(4, 6, 5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x88aaff, 0.4);
rimLight.position.set(-4, -3, -4);
scene.add(rimLight);
const fillLight = new THREE.DirectionalLight(0xfff3c4, 0.3);
fillLight.position.set(0, -6, 2);
scene.add(fillLight);

const pieceGroup = new THREE.Group();
scene.add(pieceGroup);

const pieceMaterial = new THREE.MeshStandardMaterial({
  color: 0x4fd1c5, roughness: 0.35, metalness: 0.05,
});
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0a2b28 });
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
const wallMaterialBad = new THREE.MeshStandardMaterial({ color: 0xc0524f, roughness: 0.7 });

function resizeRenderer() {
  const wrap = el('canvasWrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);

// ---------------------------------------------------------------------
// Small tween helper - returns a Promise that resolves when done.
// ---------------------------------------------------------------------
function tween(duration, onFrame) {
  return new Promise((resolve) => {
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      onFrame(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}
function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------
// Multi-axis wall system
// ---------------------------------------------------------------------
// For each view, which world axis its wall slides along, and which two
// world axes span the wall's own flat plane (matching geometry.js's
// project() definitions: front->[x,y], top->[x,z], side->[y,z]).
const AXIS_INFO = {
  front: { slide: 'z', a: 'x', b: 'y' },
  top: { slide: 'y', a: 'x', b: 'z' },
  side: { slide: 'x', a: 'y', b: 'z' },
};

function boxSizeForSlideAxis(axis) {
  const thin = 0.3, thick = 0.96;
  if (axis === 'x') return [thin, thick, thick];
  if (axis === 'y') return [thick, thin, thick];
  return [thick, thick, thin];
}

// Active wall groups this level, keyed by view name.
let wallGroups = {};

function buildWalls(level) {
  for (const g of Object.values(wallGroups)) scene.remove(g);
  wallGroups = {};

  for (const view of level.views) {
    const info = AXIS_INFO[view];
    const holeCanonical = canonicalize2D(level.holes[view]);
    const { width, height } = boundingSize(holeCanonical);
    const margin = 1;
    const gridW = width + margin * 2;
    const gridH = height + margin * 2;
    const holeSet = new Set(holeCanonical.map(([a, b]) => `${a},${b}`));
    const offsetA = (gridW - 1) / 2;
    const offsetB = (gridH - 1) / 2;
    const boxSize = boxSizeForSlideAxis(info.slide);

    const group = new THREE.Group();
    group.userData.view = view;
    group.userData.tiles = [];

    for (let i = 0; i < gridW; i++) {
      for (let j = 0; j < gridH; j++) {
        const holeA = i - margin;
        const holeB = j - margin;
        if (holeSet.has(`${holeA},${holeB}`)) continue;
        const tile = new THREE.Mesh(new THREE.BoxGeometry(...boxSize), wallMaterial);
        const pos = { x: 0, y: 0, z: 0 };
        pos[info.a] = i - offsetA;
        pos[info.b] = j - offsetB;
        pos[info.slide] = -SLIDE_DIST; // start position, set properly below
        tile.position.set(pos.x, pos.y, pos.z);
        group.add(tile);
        group.userData.tiles.push(tile);
      }
    }
    group.position[info.slide] = -SLIDE_DIST;
    group.visible = true;
    scene.add(group);
    wallGroups[view] = group;
  }
}

function setWallTilesMaterial(view, bad) {
  const group = wallGroups[view];
  if (!group) return;
  for (const tile of group.userData.tiles) tile.material = bad ? wallMaterialBad : wallMaterial;
}

// Slide a wall in from -SLIDE_DIST to 0 (approach), used while "waiting".
async function positionWallAtStart(view) {
  const info = AXIS_INFO[view];
  const group = wallGroups[view];
  if (!group) return;
  group.position[info.slide] = -SLIDE_DIST;
  setWallTilesMaterial(view, false);
}

// Animate a wall sliding all the way through from -SLIDE_DIST to +SLIDE_DIST.
async function animateWallPass(view) {
  const info = AXIS_INFO[view];
  const group = wallGroups[view];
  await tween(900, (t) => {
    const e = easeInOutQuad(t);
    group.position[info.slide] = -SLIDE_DIST + (2 * SLIDE_DIST) * e;
  });
}

// Animate a wall approaching, hitting the piece, and bouncing back out.
async function animateWallBlocked(view) {
  const info = AXIS_INFO[view];
  const group = wallGroups[view];
  setWallTilesMaterial(view, true);
  await tween(450, (t) => {
    const e = easeInOutQuad(Math.min(1, t / 0.7));
    group.position[info.slide] = -SLIDE_DIST + SLIDE_DIST * e * 0.92;
  });
  // little shake
  const base = group.position[info.slide];
  await tween(220, (t) => {
    group.position[info.slide] = base + Math.sin(t * Math.PI * 4) * 0.08 * (1 - t);
  });
  await tween(500, (t) => {
    const e = easeInOutQuad(t);
    group.position[info.slide] = base - (base + SLIDE_DIST) * e;
  });
}

// ---------------------------------------------------------------------
// Building the piece
// ---------------------------------------------------------------------
function buildPiece(shape) {
  pieceGroup.clear();
  pieceGroup.rotation.set(0, 0, 0);
  pieceGroup.position.set(0, 0, 0);
  pieceGroup.scale.set(1, 1, 1);
  const boxGeo = new THREE.BoxGeometry(UNIT, UNIT, UNIT);
  const edgesGeo = new THREE.EdgesGeometry(boxGeo);
  for (const [x, y, z] of shape) {
    const cube = new THREE.Mesh(boxGeo, pieceMaterial);
    cube.position.set(x, y, z);
    pieceGroup.add(cube);
    const edges = new THREE.LineSegments(edgesGeo, edgeMaterial);
    edges.position.set(x, y, z);
    pieceGroup.add(edges);
  }
}

// ---------------------------------------------------------------------
// X-ray panels
// ---------------------------------------------------------------------
function updateXrayForView(view, shape) {
  const state = xrayPanelState[view];
  if (!state) return { blockedCount: 0, openCount: 0 };
  const shapeCanonical = canonicalize2D(project(shape, view));
  const shapeSize = boundingSize(shapeCanonical);
  const holeSize = boundingSize(state.holeCanonical);

  const shapeOffsetA = Math.floor((PANEL_SIZE - shapeSize.width) / 2);
  const shapeOffsetB = Math.floor((PANEL_SIZE - shapeSize.height) / 2);
  const holeOffsetA = Math.floor((PANEL_SIZE - holeSize.width) / 2);
  const holeOffsetB = Math.floor((PANEL_SIZE - holeSize.height) / 2);

  const holeMap = new Set(state.holeCanonical.map(([a, b]) => `${a + holeOffsetA},${b + holeOffsetB}`));
  const shapeMap = new Set(shapeCanonical.map(([a, b]) => `${a + shapeOffsetA},${b + shapeOffsetB}`));

  let blockedCount = 0, openCount = 0;
  for (const cell of state.cells) {
    const key = `${cell.i},${cell.j}`;
    const inHole = holeMap.has(key);
    const inShape = shapeMap.has(key);
    cell.el.classList.remove('match', 'open', 'block');
    if (inHole && inShape) cell.el.classList.add('match');
    else if (inHole) { cell.el.classList.add('open'); openCount++; }
    else if (inShape) { cell.el.classList.add('block'); blockedCount++; }
  }
  return { blockedCount, openCount };
}

function updateAllXray(level, shape) {
  const results = {};
  for (const view of level.views) results[view] = updateXrayForView(view, shape);
  return results;
}

// ---------------------------------------------------------------------
// Level / mode loading
// ---------------------------------------------------------------------
function scramble(shape) {
  let s = shape;
  const moves = [
    (s) => rotateX(s, 1), (s) => rotateX(s, -1),
    (s) => rotateY(s, 1), (s) => rotateY(s, -1),
    (s) => rotateZ(s, 1), (s) => rotateZ(s, -1),
  ];
  const steps = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < steps; i++) s = moves[Math.floor(Math.random() * moves.length)](s);
  return s;
}

function loadLevel(index) {
  levelIndex = index;
  const level = LEVELS[levelIndex];
  currentShape = scramble(level.shape);
  moveCount = 0;
  solvedThisAttempt = false;

  modeBadgeLabel.textContent = MODE_INFO[mode].label;
  levelNumEl.textContent = level.number;
  levelTotalEl.textContent = LEVELS.length;

  viewChipsEl.innerHTML = level.views
    .map((v) => `<span class="viewChip">${VIEW_LABELS[v]}</span>`)
    .join('');
  viewExplainEl.textContent = level.views.map((v) => VIEW_EXPLAIN[v]).join('  ·  ');

  moveCountEl.textContent = '0';
  feedbackEl.textContent = '';
  feedbackEl.className = '';
  resultOverlay.classList.add('hidden');

  buildXrayPanels(level);
  buildWalls(level);
  buildPiece(currentShape);
  updateAllXray(level, currentShape);

  if (level.intro) showToast(level.intro);
}

let toastTimer = null;
function showToast(msg) {
  introToast.textContent = msg;
  introToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => introToast.classList.add('hidden'), 4200);
}

function switchMode(newMode) {
  mode = newMode;
  progress.lastMode = newMode;
  saveProgress();
  LEVELS = LEVELS_BY_MODE[mode];
  loadLevel(0);
}

// ---------------------------------------------------------------------
// Rotation handling
// ---------------------------------------------------------------------
const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1),
};
const ROTATE_FN = { x: rotateX, y: rotateY, z: rotateZ };

async function doRotate(axis, dir) {
  if (animating || solvedThisAttempt) return;
  animating = true;
  setControlsEnabled(false);

  const axisVec = AXIS_VECTORS[axis];
  const targetAngle = (Math.PI / 2) * dir;
  await tween(240, (t) => {
    pieceGroup.setRotationFromAxisAngle(axisVec, targetAngle * easeInOutQuad(t));
  });

  currentShape = ROTATE_FN[axis](currentShape, dir);
  buildPiece(currentShape);
  moveCount++;
  moveCountEl.textContent = moveCount;
  updateAllXray(LEVELS[levelIndex], currentShape);
  animating = false;
  setControlsEnabled(true);
}

function setControlsEnabled(enabled) {
  document.querySelectorAll('.rotbtn, #pushBtn, #resetBtn, #hintBtn').forEach((b) => { b.disabled = !enabled; });
}

// ---------------------------------------------------------------------
// Test Fit: sequential multi-wall check
// ---------------------------------------------------------------------
async function attemptTestFit() {
  if (animating || solvedThisAttempt) return;
  animating = true;
  setControlsEnabled(false);
  feedbackEl.className = '';
  feedbackEl.textContent = '';

  const level = LEVELS[levelIndex];
  const order = ['front', 'top', 'side'].filter((v) => level.views.includes(v));

  for (const view of order) {
    const matches = silhouettesMatch(project(currentShape, view), level.holes[view]);
    if (matches) {
      await animateWallPass(view);
      await delay(120);
    } else {
      const { blockedCount, openCount } = updateXrayForView(view, currentShape);
      await animateWallBlocked(view);
      feedbackEl.className = 'bad';
      if (blockedCount > 0) {
        feedbackEl.textContent = `${VIEW_LABELS[view]} wall: ${blockedCount} cube${blockedCount === 1 ? '' : 's'} would hit it. Check that panel!`;
      } else if (openCount > 0) {
        feedbackEl.textContent = `${VIEW_LABELS[view]} wall: ${openCount} part${openCount === 1 ? '' : 's'} of the hole still open.`;
      } else {
        feedbackEl.textContent = `${VIEW_LABELS[view]} wall: not lined up yet.`;
      }
      animating = false;
      setControlsEnabled(true);
      return;
    }
  }

  // All active walls passed.
  solvedThisAttempt = true;
  onLevelSolved(level);
  animating = false;
}

function starsFor(level, moves) {
  if (moves <= level.par) return 3;
  if (moves <= level.par + 2) return 2;
  return 1;
}

function onLevelSolved(level) {
  const stars = starsFor(level, moveCount);
  const key = String(level.number);
  const modeProgress = progress.modes[mode];
  modeProgress.stars[key] = Math.max(modeProgress.stars[key] || 0, stars);
  const prevBest = modeProgress.bestMoves[key];
  modeProgress.bestMoves[key] = prevBest === undefined ? moveCount : Math.min(prevBest, moveCount);
  saveProgress();

  resultTitle.textContent = pickWinTitle(stars);
  resultStars.textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
  const wallWord = level.views.length === 1 ? 'wall' : 'walls';
  resultMoves.textContent = `Fit through ${level.views.length} ${wallWord} in ${moveCount} rotation${moveCount === 1 ? '' : 's'} (par: ${level.par}).`;
  resultOverlay.classList.remove('hidden');

  const isLast = level.number >= LEVELS.length;
  el('nextLevelBtn').style.display = isLast ? 'none' : 'inline-block';
  setControlsEnabled(true);
}

function pickWinTitle(stars) {
  if (stars === 3) return 'Perfect Fit! 🎉';
  if (stars === 2) return 'Great Fit!';
  return 'It Fits!';
}

// ---------------------------------------------------------------------
// Hint
// ---------------------------------------------------------------------
function giveHint() {
  if (animating || solvedThisAttempt) return;
  const level = LEVELS[levelIndex];
  const moves = [
    { axis: 'x', dir: 1, fn: (s) => rotateX(s, 1) }, { axis: 'x', dir: -1, fn: (s) => rotateX(s, -1) },
    { axis: 'y', dir: 1, fn: (s) => rotateY(s, 1) }, { axis: 'y', dir: -1, fn: (s) => rotateY(s, -1) },
    { axis: 'z', dir: 1, fn: (s) => rotateZ(s, 1) }, { axis: 'z', dir: -1, fn: (s) => rotateZ(s, -1) },
  ];
  const satisfiesAll = (s) => level.views.every((v) => silhouettesMatch(project(s, v), level.holes[v]));

  const visited = new Set([key3d(currentShape)]);
  let frontier = [{ shape: currentShape, path: [] }];
  for (let depth = 0; depth < 6; depth++) {
    for (const node of frontier) {
      if (node.path.length > 0 && satisfiesAll(node.shape)) {
        const first = node.path[0];
        const dirWord = first.dir > 0 ? 'clockwise ⟳' : 'counter-clockwise ⟲';
        feedbackEl.className = 'good';
        feedbackEl.textContent = `Hint: try rotating the ${first.axis.toUpperCase()} axis ${dirWord}.`;
        return;
      }
    }
    const next = [];
    for (const node of frontier) {
      for (const m of moves) {
        const r = m.fn(node.shape);
        const k = key3d(r);
        if (!visited.has(k)) { visited.add(k); next.push({ shape: r, path: [...node.path, { axis: m.axis, dir: m.dir }] }); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  feedbackEl.className = 'good';
  feedbackEl.textContent = 'Hint: it already matches - hit Test Fit!';
}
function key3d(shape) { return shape.map(([x, y, z]) => `${x},${y},${z}`).sort().join('|'); }

// ---------------------------------------------------------------------
// Mode select + level select UI
// ---------------------------------------------------------------------
function buildModeGrid() {
  const grid = el('modeGrid');
  grid.innerHTML = '';
  const icons = { easy: '🟩', medium: '🟧', hard: '🟥' };
  for (const m of MODES) {
    const info = MODE_INFO[m];
    const mp = progress.modes[m];
    const totalLevels = LEVELS_BY_MODE[m].length;
    const totalStars = Object.values(mp.stars).reduce((a, b) => a + b, 0);
    const card = document.createElement('button');
    card.className = 'modeCard' + (m === mode ? ' current' : '');
    card.innerHTML = `
      <div class="modeIcon">${icons[m]}</div>
      <div class="modeName">${info.label}</div>
      <div class="modeSubtitle">${info.subtitle}</div>
      <div class="modeDesc">${info.desc}</div>
      <div class="modeProgress">${totalStars > 0 ? `${totalStars}/${totalLevels * 3} ⭐ · ${totalLevels} levels` : `${totalLevels} levels · Not started`}</div>
    `;
    card.addEventListener('click', () => {
      switchMode(m);
      closeModal('modeModal');
    });
    grid.appendChild(card);
  }
}

function buildLevelGrid() {
  const grid = el('levelGrid');
  grid.innerHTML = '';
  el('levelModalMode').textContent = MODE_INFO[mode].label;
  const modeProgress = progress.modes[mode];
  LEVELS.forEach((level, idx) => {
    const btn = document.createElement('button');
    btn.className = 'levelTile';
    if (idx === levelIndex) btn.classList.add('current');
    const stars = modeProgress.stars[String(level.number)] || 0;
    btn.innerHTML = `<span>${level.number}</span>` +
      `<span class="stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`;
    btn.addEventListener('click', () => {
      loadLevel(idx);
      closeModal('levelModal');
    });
    grid.appendChild(btn);
  });
}

function openModal(id) {
  el(id).classList.remove('hidden');
  if (id === 'levelModal') buildLevelGrid();
  if (id === 'modeModal') buildModeGrid();
}
function closeModal(id) { el(id).classList.add('hidden'); }

// ---------------------------------------------------------------------
// Touch swipe-to-rotate (single finger) vs orbit (two fingers)
// ---------------------------------------------------------------------
const activePointers = new Map(); // pointerId -> {x,y,type}
let swipeTracking = null; // {pointerId, startX, startY, startT} or null

const SWIPE_MIN_PX = 32;

// This runs alongside OrbitControls' own pointerdown handler (we never
// touch controls.enabled - see the touches/enablePan setup above), so
// OrbitControls' internal pointer bookkeeping always stays correct for
// real multi-touch hardware.
canvas.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (e.pointerType === 'touch' && activePointers.size === 1) {
    swipeTracking = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startT: performance.now() };
  } else {
    swipeTracking = null;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  }
});

function endPointer(e) {
  if (swipeTracking && swipeTracking.pointerId === e.pointerId && activePointers.size === 1) {
    const dx = e.clientX - swipeTracking.startX;
    const dy = e.clientY - swipeTracking.startY;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) >= SWIPE_MIN_PX && !animating && !solvedThisAttempt) {
      if (adx > ady) doRotate('y', dx > 0 ? 1 : -1);
      else doRotate('x', dy > 0 ? -1 : 1);
    }
  }
  activePointers.delete(e.pointerId);
  if (activePointers.size === 0) swipeTracking = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'touch') endPointer(e);
});

// ---------------------------------------------------------------------
// Fullscreen
// ---------------------------------------------------------------------
el('fullscreenBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.();
  }
});

// ---------------------------------------------------------------------
// Wire up UI events
// ---------------------------------------------------------------------
document.querySelectorAll('.rotbtn').forEach((btn) => {
  btn.innerHTML = rotateIconSVG(btn.dataset.axis, parseInt(btn.dataset.dir, 10));
  btn.addEventListener('click', () => doRotate(btn.dataset.axis, parseInt(btn.dataset.dir, 10)));
});

el('pushBtn').addEventListener('click', attemptTestFit);
el('resetBtn').addEventListener('click', () => loadLevel(levelIndex));
el('hintBtn').addEventListener('click', giveHint);
el('nextLevelBtn').addEventListener('click', () => loadLevel(Math.min(levelIndex + 1, LEVELS.length - 1)));
el('retryBtn').addEventListener('click', () => loadLevel(levelIndex));

el('modeBadgeBtn').addEventListener('click', () => openModal('modeModal'));
el('levelSelectBtn').addEventListener('click', () => openModal('levelModal'));
el('helpBtn').addEventListener('click', () => openModal('helpModal'));
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
});

window.addEventListener('keydown', (e) => {
  if (!resultOverlay.classList.contains('hidden')) return;
  const map = { q: ['x', -1], w: ['x', 1], a: ['y', -1], s: ['y', 1], z: ['z', -1], x: ['z', 1] };
  if (map[e.key.toLowerCase()]) doRotate(...map[e.key.toLowerCase()]);
  else if (e.code === 'Space') { e.preventDefault(); attemptTestFit(); }
  else if (e.key.toLowerCase() === 'r') loadLevel(levelIndex);
});

// ---------------------------------------------------------------------
// Render loop + boot
// ---------------------------------------------------------------------
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function boot() {
  resizeRenderer();
  loadLevel(0);
  animate();

  // Menu-first: always greet the player with the difficulty picker so the
  // modes are showcased up front, rather than dropping them straight into
  // a level they may not have chosen.
  openModal('modeModal');

  if (!localStorage.getItem(SAVE_KEY)) {
    setTimeout(() => showToast('Pick a difficulty above, or tap the ? button any time for how to play.'), 600);
  }
}

boot();
