// competition.js
// Self-contained 2-player split-screen "race" mode. Kept independent from
// main.js's single-player state so it can't regress the core game - it
// reuses the same pure logic (geometry.js / levels.js / icons.js) but
// drives its own pair of Three.js scenes, one per canvas/player.
//
// Because each player gets their OWN <canvas> element, the browser's own
// hit-testing keeps their touches separate automatically - two students
// can rotate their own block at the same time on a shared touchscreen
// without any extra pointer-partitioning code.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LEVELS_BY_MODE, VIEW_LABELS, VIEW_EXPLAIN } from './levels.js';
import {
  rotateX, rotateY, rotateZ, project,
  canonicalize2D, silhouettesMatch, boundingSize,
} from './geometry.js';
import { rotateIconSVG, AXIS_META } from './icons.js';

const PANEL_SIZE = 5;
const UNIT = 0.92;
const SLIDE_DIST = 4.2;
const ROTATE_FN = { x: rotateX, y: rotateY, z: rotateZ };
const AXIS_INFO = {
  front: { slide: 'z', a: 'x', b: 'y' },
  top: { slide: 'y', a: 'x', b: 'z' },
  side: { slide: 'x', a: 'y', b: 'z' },
};

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
function boxSizeForSlideAxis(axis) {
  const thin = 0.3, thick = 0.96;
  if (axis === 'x') return [thin, thick, thick];
  if (axis === 'y') return [thick, thin, thick];
  return [thick, thick, thin];
}
function scrambleShape(shape) {
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

// Shared geometries/materials - fine to reuse across both independent
// scenes since Three.js materials/geometries aren't tied to one scene.
const boxGeo = new THREE.BoxGeometry(UNIT, UNIT, UNIT);
const edgesGeo = new THREE.EdgesGeometry(boxGeo);
const pieceMaterialP1 = new THREE.MeshStandardMaterial({ color: 0x4fd1c5, roughness: 0.35, metalness: 0.05 });
const pieceMaterialP2 = new THREE.MeshStandardMaterial({ color: 0xff8a8a, roughness: 0.35, metalness: 0.05 });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0a1a2b });
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 });
const wallMaterialBad = new THREE.MeshStandardMaterial({ color: 0xc0524f, roughness: 0.7 });

function createPane(canvas, pieceMaterial) {
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

  const pieceGroup = new THREE.Group();
  scene.add(pieceGroup);

  const pane = {
    canvas, renderer, scene, camera, controls, pieceGroup, pieceMaterial,
    wallGroups: {}, xrayState: {}, level: null, shape: [],
    animating: false, finished: false,
    activePointers: new Map(), swipeTracking: null,
  };
  wirePointerEvents(pane);
  return pane;
}

function resizePane(pane) {
  const wrap = pane.canvas.parentElement;
  const w = wrap.clientWidth || 1;
  const h = wrap.clientHeight || 1;
  pane.renderer.setSize(w, h, false);
  pane.camera.aspect = w / h;
  pane.camera.updateProjectionMatrix();
}

function buildPiece(pane, shape) {
  pane.pieceGroup.clear();
  pane.pieceGroup.rotation.set(0, 0, 0);
  pane.pieceGroup.position.set(0, 0, 0);
  pane.pieceGroup.scale.set(1, 1, 1);
  for (const [x, y, z] of shape) {
    const cube = new THREE.Mesh(boxGeo, pane.pieceMaterial);
    cube.position.set(x, y, z);
    pane.pieceGroup.add(cube);
    const edges = new THREE.LineSegments(edgesGeo, edgeMaterial);
    edges.position.set(x, y, z);
    pane.pieceGroup.add(edges);
  }
}

function buildWalls(pane, level) {
  for (const g of Object.values(pane.wallGroups)) pane.scene.remove(g);
  pane.wallGroups = {};

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
        pos[info.slide] = -SLIDE_DIST;
        tile.position.set(pos.x, pos.y, pos.z);
        group.add(tile);
        group.userData.tiles.push(tile);
      }
    }
    group.position[info.slide] = -SLIDE_DIST;
    pane.scene.add(group);
    pane.wallGroups[view] = group;
  }
}

function setWallTilesMaterial(pane, view, bad) {
  const group = pane.wallGroups[view];
  if (!group) return;
  for (const tile of group.userData.tiles) tile.material = bad ? wallMaterialBad : wallMaterial;
}

async function animateWallPass(pane, view) {
  const info = AXIS_INFO[view];
  const group = pane.wallGroups[view];
  await tween(900, (t) => {
    const e = easeInOutQuad(t);
    group.position[info.slide] = -SLIDE_DIST + (2 * SLIDE_DIST) * e;
  });
}

async function animateWallBlocked(pane, view) {
  const info = AXIS_INFO[view];
  const group = pane.wallGroups[view];
  setWallTilesMaterial(pane, view, true);
  await tween(450, (t) => {
    const e = easeInOutQuad(Math.min(1, t / 0.7));
    group.position[info.slide] = -SLIDE_DIST + SLIDE_DIST * e * 0.92;
  });
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
// X-ray panels (small DOM copies of main.js's, scoped per pane)
// ---------------------------------------------------------------------
function buildXray(pane, level, containerEl) {
  containerEl.innerHTML = '';
  pane.xrayState = {};
  const axisClass = { front: 'axis-front', top: 'axis-top', side: 'axis-side' };
  for (const view of level.views) {
    const panel = document.createElement('div');
    panel.className = 'raceXrayPanel';
    panel.innerHTML = `<div class="raceXrayGrid"></div>`;
    panel.title = VIEW_LABELS[view];
    const dot = document.createElement('span');
    dot.className = `axisDot ${axisClass[view]}`;
    containerEl.appendChild(panel);
    const grid = panel.querySelector('.raceXrayGrid');
    const cells = [];
    for (let j = PANEL_SIZE - 1; j >= 0; j--) {
      for (let i = 0; i < PANEL_SIZE; i++) {
        const cell = document.createElement('div');
        cell.className = 'raceXcell';
        grid.appendChild(cell);
        cells.push({ i, j, el: cell });
      }
    }
    pane.xrayState[view] = { cells, holeCanonical: canonicalize2D(level.holes[view]) };
  }
}

function updateXrayForView(pane, view) {
  const state = pane.xrayState[view];
  if (!state) return;
  const shapeCanonical = canonicalize2D(project(pane.shape, view));
  const shapeSize = boundingSize(shapeCanonical);
  const holeSize = boundingSize(state.holeCanonical);
  const shapeOffsetA = Math.floor((PANEL_SIZE - shapeSize.width) / 2);
  const shapeOffsetB = Math.floor((PANEL_SIZE - shapeSize.height) / 2);
  const holeOffsetA = Math.floor((PANEL_SIZE - holeSize.width) / 2);
  const holeOffsetB = Math.floor((PANEL_SIZE - holeSize.height) / 2);
  const holeMap = new Set(state.holeCanonical.map(([a, b]) => `${a + holeOffsetA},${b + holeOffsetB}`));
  const shapeMap = new Set(shapeCanonical.map(([a, b]) => `${a + shapeOffsetA},${b + shapeOffsetB}`));
  for (const cell of state.cells) {
    const key = `${cell.i},${cell.j}`;
    const inHole = holeMap.has(key);
    const inShape = shapeMap.has(key);
    cell.el.classList.remove('match', 'open', 'block');
    if (inHole && inShape) cell.el.classList.add('match');
    else if (inHole) cell.el.classList.add('open');
    else if (inShape) cell.el.classList.add('block');
  }
}
function updateAllXray(pane, level) {
  for (const view of level.views) updateXrayForView(pane, view);
}

// ---------------------------------------------------------------------
// Touch swipe-to-rotate (mirrors main.js's approach, scoped per canvas)
// ---------------------------------------------------------------------
const SWIPE_MIN_PX = 32;
function wirePointerEvents(pane) {
  pane.canvas.addEventListener('pointerdown', (e) => {
    pane.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (e.pointerType === 'touch' && pane.activePointers.size === 1) {
      pane.swipeTracking = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
    } else {
      pane.swipeTracking = null;
    }
  });
  pane.canvas.addEventListener('pointermove', (e) => {
    if (pane.activePointers.has(e.pointerId)) {
      pane.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    }
  });
  function endPointer(e) {
    if (pane.swipeTracking && pane.swipeTracking.pointerId === e.pointerId && pane.activePointers.size === 1) {
      const dx = e.clientX - pane.swipeTracking.startX;
      const dy = e.clientY - pane.swipeTracking.startY;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) >= SWIPE_MIN_PX && !pane.animating && !pane.finished && !race.winner) {
        if (adx > ady) doRotate(pane, 'y', dx > 0 ? 1 : -1);
        else doRotate(pane, 'x', dy > 0 ? -1 : 1);
      }
    }
    pane.activePointers.delete(e.pointerId);
    if (pane.activePointers.size === 0) pane.swipeTracking = null;
  }
  pane.canvas.addEventListener('pointerup', endPointer);
  pane.canvas.addEventListener('pointercancel', endPointer);
  pane.canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') endPointer(e); });
}

// ---------------------------------------------------------------------
// Rotation + test fit
// ---------------------------------------------------------------------
const AXIS_VECTORS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

async function doRotate(pane, axis, dir) {
  if (pane.animating || pane.finished || race.winner || race.countdownActive) return;
  pane.animating = true;
  const axisVec = AXIS_VECTORS[axis];
  const targetAngle = (Math.PI / 2) * dir;
  await tween(240, (t) => {
    pane.pieceGroup.setRotationFromAxisAngle(axisVec, targetAngle * easeInOutQuad(t));
  });
  pane.shape = ROTATE_FN[axis](pane.shape, dir);
  buildPiece(pane, pane.shape);
  updateAllXray(pane, pane.level);
  pane.animating = false;
}

async function attemptTestFit(pane, feedbackEl, playerNum) {
  if (pane.animating || pane.finished || race.winner) return;
  pane.animating = true;
  feedbackEl.className = 'raceFeedback';
  feedbackEl.textContent = '';
  const level = pane.level;
  const order = ['front', 'top', 'side'].filter((v) => level.views.includes(v));
  for (const view of order) {
    const matches = silhouettesMatch(project(pane.shape, view), level.holes[view]);
    if (matches) {
      await animateWallPass(pane, view);
      await delay(100);
    } else {
      updateXrayForView(pane, view);
      await animateWallBlocked(pane, view);
      feedbackEl.className = 'raceFeedback bad';
      feedbackEl.textContent = `${VIEW_LABELS[view]}: not lined up yet.`;
      pane.animating = false;
      return;
    }
  }
  pane.finished = true;
  pane.animating = false;
  feedbackEl.className = 'raceFeedback good';
  feedbackEl.textContent = 'Fits! 🎉';
  declareWinner(playerNum);
}

// ---------------------------------------------------------------------
// Race controller
// ---------------------------------------------------------------------
const el = (id) => document.getElementById(id);
let pane1, pane2;
const race = { mode: 'easy', level: null, winner: null, countdownActive: false };

function buildRaceControls(containerEl, pane, doTestFit) {
  containerEl.innerHTML = '';
  for (const axis of ['x', 'y', 'z']) {
    const group = document.createElement('div');
    group.className = 'raceAxisGroup';
    for (const dir of [-1, 1]) {
      const btn = document.createElement('button');
      btn.className = 'raceRotBtn';
      btn.title = AXIS_META[axis].name;
      btn.innerHTML = rotateIconSVG(axis, dir);
      btn.addEventListener('click', () => doRotate(pane, axis, dir));
      group.appendChild(btn);
    }
    containerEl.appendChild(group);
  }
  const testBtn = document.createElement('button');
  testBtn.className = 'raceTestBtn';
  testBtn.textContent = 'Test Fit ➜';
  testBtn.addEventListener('click', doTestFit);
  containerEl.appendChild(testBtn);
}

function setPaneControlsEnabled(containerEl, enabled) {
  containerEl.querySelectorAll('button').forEach((b) => { b.disabled = !enabled; });
}

function renderViewBanner(bannerEl, level) {
  bannerEl.textContent = level.views.map((v) => VIEW_LABELS[v]).join(' + ');
}

function loadPaneLevel(pane, level, xrayEl, bannerEl) {
  pane.level = level;
  pane.shape = scrambleShape(level.shape);
  pane.finished = false;
  pane.animating = false;
  buildXray(pane, level, xrayEl);
  buildWalls(pane, level);
  buildPiece(pane, pane.shape);
  updateAllXray(pane, level);
  renderViewBanner(bannerEl, level);
}

function showCountdown(text) {
  const cd = el('raceCountdown');
  cd.textContent = text;
  cd.classList.remove('hidden');
}
function hideCountdown() { el('raceCountdown').classList.add('hidden'); }

function runCountdown() {
  race.countdownActive = true;
  setPaneControlsEnabled(el('raceControls1'), false);
  setPaneControlsEnabled(el('raceControls2'), false);
  let n = 3;
  showCountdown(n);
  const timer = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(timer);
      showCountdown('GO!');
      setTimeout(() => {
        hideCountdown();
        race.countdownActive = false;
        setPaneControlsEnabled(el('raceControls1'), true);
        setPaneControlsEnabled(el('raceControls2'), true);
      }, 500);
    } else {
      showCountdown(n);
    }
  }, 700);
}

function newRace(mode) {
  race.mode = mode;
  race.winner = null;
  document.querySelectorAll('.raceDiffBtn').forEach((b) => b.classList.toggle('current', b.dataset.mode === mode));
  const pool = LEVELS_BY_MODE[mode];
  race.level = pool[Math.floor(Math.random() * pool.length)];

  loadPaneLevel(pane1, race.level, el('raceXray1'), el('raceView1'));
  loadPaneLevel(pane2, race.level, el('raceXray2'), el('raceView2'));
  el('raceFeedback1').textContent = '';
  el('raceFeedback2').textContent = '';
  resizePane(pane1);
  resizePane(pane2);
  el('raceWinnerOverlay').classList.add('hidden');
  runCountdown();
}

function declareWinner(playerNum) {
  if (race.winner) return;
  race.winner = playerNum;
  setPaneControlsEnabled(el('raceControls1'), false);
  setPaneControlsEnabled(el('raceControls2'), false);
  el('raceWinnerTitle').textContent = `Player ${playerNum} Wins! 🎉`;
  el('raceWinnerOverlay').classList.remove('hidden');
}

function animate() {
  requestAnimationFrame(animate);
  if (!el('competitionArea').classList.contains('hidden')) {
    pane1.controls.update();
    pane2.controls.update();
    pane1.renderer.render(pane1.scene, pane1.camera);
    pane2.renderer.render(pane2.scene, pane2.camera);
  }
}

function initDom() {
  pane1 = createPane(el('raceCanvas1'), pieceMaterialP1);
  pane2 = createPane(el('raceCanvas2'), pieceMaterialP2);
  buildRaceControls(el('raceControls1'), pane1, () => attemptTestFit(pane1, el('raceFeedback1'), 1));
  buildRaceControls(el('raceControls2'), pane2, () => attemptTestFit(pane2, el('raceFeedback2'), 2));

  document.querySelectorAll('.raceDiffBtn').forEach((btn) => {
    btn.addEventListener('click', () => newRace(btn.dataset.mode));
  });
  el('raceStartBtn').addEventListener('click', () => newRace(race.mode));
  el('raceAgainBtn').addEventListener('click', () => newRace(race.mode));
  el('raceBackBtn').addEventListener('click', closeCompetition);
  el('raceMenuBtn').addEventListener('click', closeCompetition);

  window.addEventListener('resize', () => {
    if (!el('competitionArea').classList.contains('hidden')) {
      resizePane(pane1);
      resizePane(pane2);
    }
  });

  animate();
}

export function openCompetition() {
  el('topbar').classList.add('hidden');
  el('gameArea').classList.add('hidden');
  el('competitionArea').classList.remove('hidden');
  newRace(race.mode || 'easy');
  // sizes are only correct once the canvas wrap has real layout dimensions
  requestAnimationFrame(() => { resizePane(pane1); resizePane(pane2); });
}

function closeCompetition() {
  el('competitionArea').classList.add('hidden');
  el('topbar').classList.remove('hidden');
  el('gameArea').classList.remove('hidden');
  window.dispatchEvent(new Event('resize'));
}

// Module scripts execute after the document has been parsed, so the DOM
// elements this module needs already exist - safe to init right away.
initDom();

el('raceModeBtn').addEventListener('click', () => {
  document.getElementById('modeModal').classList.add('hidden');
  openCompetition();
});
