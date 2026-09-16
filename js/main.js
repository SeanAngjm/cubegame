import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LEVELS, VIEW_LABELS, VIEW_EXPLAIN } from './levels.js';
import {
  rotateX, rotateY, rotateZ, projectFront,
  canonicalize2D, cellsToKey, silhouettesMatch, boundingSize,
} from './geometry.js';

// ---------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------
const SAVE_KEY = 'cubefit-progress-v1';

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { unlocked: 1, stars: {}, bestMoves: {} };
    const parsed = JSON.parse(raw);
    return {
      unlocked: parsed.unlocked || 1,
      stars: parsed.stars || {},
      bestMoves: parsed.bestMoves || {},
    };
  } catch (e) {
    return { unlocked: 1, stars: {}, bestMoves: {} };
  }
}

function saveProgress(p) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(p));
  } catch (e) {
    /* storage unavailable - ignore, game still works this session */
  }
}

let progress = loadProgress();

// ---------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------
const PANEL_SIZE = 5;
const UNIT = 0.92; // cube visual size, slightly under 1 to show gaps

let levelIndex = 0;       // 0-based index into LEVELS
let currentShape = [];    // live rotated coordinates of the piece
let moveCount = 0;
let animating = false;
let solvedThisAttempt = false;

// ---------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------
const el = (id) => document.getElementById(id);
const levelNumEl = el('levelNum');
const levelTotalEl = el('levelTotal');
const viewLabelEl = el('viewLabel');
const viewExplainEl = el('viewExplain');
const xrayGridEl = el('xrayGrid');
const moveCountEl = el('moveCount');
const feedbackEl = el('feedbackMsg');
const resultOverlay = el('resultOverlay');
const resultTitle = el('resultTitle');
const resultStars = el('resultStars');
const resultMoves = el('resultMoves');
const introToast = el('introToast');

levelTotalEl.textContent = LEVELS.length;

// Build the 5x5 x-ray grid cells once.
const xrayCells = [];
for (let j = PANEL_SIZE - 1; j >= 0; j--) {
  for (let i = 0; i < PANEL_SIZE; i++) {
    const cell = document.createElement('div');
    cell.className = 'xcell';
    xrayGridEl.appendChild(cell);
    xrayCells.push({ i, j, el: cell });
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
camera.position.set(3.4, 2.6, 6.2);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, -1.2);
controls.minDistance = 3.5;
controls.maxDistance = 12;
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(4, 6, 5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x88aaff, 0.4);
rimLight.position.set(-4, -2, -4);
scene.add(rimLight);

// Backdrop glow behind the wall so the hole visibly lets light through.
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 20),
  new THREE.MeshBasicMaterial({ color: 0xfff3c4 })
);
backdrop.position.set(0, 0, -6);
scene.add(backdrop);

const wallGroup = new THREE.Group();
scene.add(wallGroup);

const pieceGroup = new THREE.Group();
scene.add(pieceGroup);

const pieceMaterial = new THREE.MeshStandardMaterial({
  color: 0x4fd1c5, roughness: 0.35, metalness: 0.05,
});
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0a2b28 });
const wallMaterial = new THREE.MeshStandardMaterial({
  color: 0xb08a5a, roughness: 0.9,
});

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
// Building the wall for a level
// ---------------------------------------------------------------------
const WALL_Z = -3;

function buildWall(holeCanonical) {
  wallGroup.clear();
  const { width, height } = boundingSize(holeCanonical);
  const margin = 1;
  const gridW = width + margin * 2;
  const gridH = height + margin * 2;
  const holeSet = new Set(holeCanonical.map(([a, b]) => `${a},${b}`));

  const offsetX = (gridW - 1) / 2;
  const offsetY = (gridH - 1) / 2;

  for (let i = 0; i < gridW; i++) {
    for (let j = 0; j < gridH; j++) {
      const holeA = i - margin;
      const holeB = j - margin;
      const isHole = holeSet.has(`${holeA},${holeB}`);
      if (isHole) continue; // gap - lets backdrop show through
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.96, 0.96, 0.3),
        wallMaterial
      );
      tile.position.set(i - offsetX, j - offsetY, WALL_Z);
      wallGroup.add(tile);
    }
  }
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
// X-ray panel + feedback
// ---------------------------------------------------------------------
function updateXray(shape, holeCanonical) {
  const shapeCanonical = canonicalize2D(projectFront(shape));
  const shapeSize = boundingSize(shapeCanonical);
  const holeSize = boundingSize(holeCanonical);

  const shapeOffsetA = Math.floor((PANEL_SIZE - shapeSize.width) / 2);
  const shapeOffsetB = Math.floor((PANEL_SIZE - shapeSize.height) / 2);
  const holeOffsetA = Math.floor((PANEL_SIZE - holeSize.width) / 2);
  const holeOffsetB = Math.floor((PANEL_SIZE - holeSize.height) / 2);

  const holeMap = new Set();
  for (const [a, b] of holeCanonical) {
    holeMap.add(`${a + holeOffsetA},${b + holeOffsetB}`);
  }
  const shapeMap = new Set();
  for (const [a, b] of shapeCanonical) {
    shapeMap.add(`${a + shapeOffsetA},${b + shapeOffsetB}`);
  }

  let blockedCount = 0;
  let openCount = 0;

  for (const cell of xrayCells) {
    const key = `${cell.i},${cell.j}`;
    const inHole = holeMap.has(key);
    const inShape = shapeMap.has(key);
    cell.el.classList.remove('match', 'open', 'block');
    if (inHole && inShape) {
      cell.el.classList.add('match');
    } else if (inHole && !inShape) {
      cell.el.classList.add('open');
      openCount++;
    } else if (!inHole && inShape) {
      cell.el.classList.add('block');
      blockedCount++;
    }
  }
  return { blockedCount, openCount };
}

// ---------------------------------------------------------------------
// Level loading
// ---------------------------------------------------------------------
function scramble(shape) {
  let s = shape;
  const moves = [
    (s) => rotateX(s, 1), (s) => rotateX(s, -1),
    (s) => rotateY(s, 1), (s) => rotateY(s, -1),
    (s) => rotateZ(s, 1), (s) => rotateZ(s, -1),
  ];
  const steps = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < steps; i++) {
    const m = moves[Math.floor(Math.random() * moves.length)];
    s = m(s);
  }
  return s;
}

function loadLevel(index, { keepScramble = false } = {}) {
  levelIndex = index;
  const level = LEVELS[levelIndex];
  currentShape = keepScramble ? currentShape : scramble(level.shape);
  moveCount = 0;
  solvedThisAttempt = false;

  levelNumEl.textContent = level.number;
  viewLabelEl.textContent = VIEW_LABELS[level.view];
  viewExplainEl.textContent = VIEW_EXPLAIN[level.view];
  moveCountEl.textContent = '0';
  feedbackEl.textContent = '';
  feedbackEl.className = '';
  resultOverlay.classList.add('hidden');

  const holeCanonical = canonicalize2D(level.hole);
  buildWall(holeCanonical);
  buildPiece(currentShape);
  updateXray(currentShape, holeCanonical);

  if (level.intro) {
    showToast(level.intro);
  }

  refreshLevelBadgeState();
}

let toastTimer = null;
function showToast(msg) {
  introToast.textContent = msg;
  introToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => introToast.classList.add('hidden'), 4200);
}

// ---------------------------------------------------------------------
// Rotation handling (animated, then baked into exact grid coords)
// ---------------------------------------------------------------------
const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const ROTATE_FN = { x: rotateX, y: rotateY, z: rotateZ };

function doRotate(axis, dir) {
  if (animating || solvedThisAttempt) return;
  animating = true;
  setControlsEnabled(false);

  const duration = 260;
  const start = performance.now();
  const targetAngle = (Math.PI / 2) * dir;
  const axisVec = AXIS_VECTORS[axis];

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    pieceGroup.setRotationFromAxisAngle(axisVec, targetAngle * eased);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      // Bake the rotation into the logical grid model and rebuild
      // the mesh from exact integer coordinates - no drift.
      currentShape = ROTATE_FN[axis](currentShape, dir);
      buildPiece(currentShape);
      moveCount++;
      moveCountEl.textContent = moveCount;
      const holeCanonical = canonicalize2D(LEVELS[levelIndex].hole);
      updateXray(currentShape, holeCanonical);
      animating = false;
      setControlsEnabled(true);
    }
  }
  requestAnimationFrame(frame);
}

function setControlsEnabled(enabled) {
  document.querySelectorAll('.rotbtn, #pushBtn, #resetBtn, #hintBtn').forEach((b) => {
    b.disabled = !enabled;
  });
}

// ---------------------------------------------------------------------
// Push / win-lose logic
// ---------------------------------------------------------------------
function attemptPush() {
  if (animating || solvedThisAttempt) return;
  const level = LEVELS[levelIndex];
  const matches = silhouettesMatch(projectFront(currentShape), level.hole);

  if (matches) {
    solvedThisAttempt = true;
    animatePushThrough(() => onLevelSolved(level));
  } else {
    const holeCanonical = canonicalize2D(level.hole);
    const { blockedCount, openCount } = updateXray(currentShape, holeCanonical);
    animateBounce();
    feedbackEl.className = 'bad';
    if (blockedCount > 0) {
      feedbackEl.textContent = `Not yet - ${blockedCount} cube${blockedCount === 1 ? '' : 's'} would hit the wall. Check the red squares!`;
    } else if (openCount > 0) {
      feedbackEl.textContent = `Close! ${openCount} part${openCount === 1 ? '' : 's'} of the hole ${openCount === 1 ? 'is' : 'are'} still open (amber). Keep rotating.`;
    } else {
      feedbackEl.textContent = 'Not quite lined up yet - try another rotation.';
    }
  }
}

function animateBounce() {
  const start = performance.now();
  const duration = 260;
  const origZ = 0;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const bump = Math.sin(t * Math.PI) * 0.35;
    pieceGroup.position.z = origZ + bump;
    if (t < 1) requestAnimationFrame(frame);
    else pieceGroup.position.z = origZ;
  }
  requestAnimationFrame(frame);
}

function animatePushThrough(onDone) {
  setControlsEnabled(false);
  const start = performance.now();
  const duration = 700;
  const startZ = 0;
  const endZ = WALL_Z - 1.6;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = t * t;
    pieceGroup.position.z = startZ + (endZ - startZ) * eased;
    pieceGroup.scale.setScalar(1 - 0.4 * eased);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      onDone();
    }
  }
  requestAnimationFrame(frame);
}

function starsFor(level, moves) {
  if (moves <= level.par) return 3;
  if (moves <= level.par + 2) return 2;
  return 1;
}

function onLevelSolved(level) {
  const stars = starsFor(level, moveCount);
  const key = String(level.number);
  const prevStars = progress.stars[key] || 0;
  progress.stars[key] = Math.max(prevStars, stars);
  const prevBest = progress.bestMoves[key];
  progress.bestMoves[key] = prevBest === undefined ? moveCount : Math.min(prevBest, moveCount);
  if (level.number + 1 > progress.unlocked) {
    progress.unlocked = Math.min(level.number + 1, LEVELS.length);
  }
  saveProgress(progress);

  resultTitle.textContent = pickWinTitle(stars);
  resultStars.textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
  resultMoves.textContent = `Solved in ${moveCount} rotation${moveCount === 1 ? '' : 's'} (par: ${level.par}).`;
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
// Hint: BFS over the 24 orientations to find the shortest fix, then
// reveal just the first move so the student still does the thinking.
// ---------------------------------------------------------------------
function giveHint() {
  if (animating || solvedThisAttempt) return;
  const level = LEVELS[levelIndex];
  const moves = [
    { axis: 'x', dir: 1, fn: (s) => rotateX(s, 1) },
    { axis: 'x', dir: -1, fn: (s) => rotateX(s, -1) },
    { axis: 'y', dir: 1, fn: (s) => rotateY(s, 1) },
    { axis: 'y', dir: -1, fn: (s) => rotateY(s, -1) },
    { axis: 'z', dir: 1, fn: (s) => rotateZ(s, 1) },
    { axis: 'z', dir: -1, fn: (s) => rotateZ(s, -1) },
  ];

  const startKey = key3d(currentShape);
  const visited = new Set([startKey]);
  let frontier = [{ shape: currentShape, path: [] }];

  for (let depth = 0; depth < 6; depth++) {
    for (const node of frontier) {
      if (silhouettesMatch(projectFront(node.shape), level.hole) && node.path.length > 0) {
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
        if (!visited.has(k)) {
          visited.add(k);
          next.push({ shape: r, path: [...node.path, { axis: m.axis, dir: m.dir }] });
        }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  feedbackEl.className = 'good';
  feedbackEl.textContent = 'Hint: it already matches - hit Push Through!';
}

function key3d(shape) {
  return shape.map(([x, y, z]) => `${x},${y},${z}`).sort().join('|');
}

// ---------------------------------------------------------------------
// Level select + progress UI
// ---------------------------------------------------------------------
function refreshLevelBadgeState() {
  // no-op placeholder for future badge animations
}

function buildLevelGrid() {
  const grid = el('levelGrid');
  grid.innerHTML = '';
  LEVELS.forEach((level, idx) => {
    const btn = document.createElement('button');
    btn.className = 'levelTile';
    if (idx === levelIndex) btn.classList.add('current');
    const locked = level.number > progress.unlocked;
    btn.disabled = locked;
    const stars = progress.stars[String(level.number)] || 0;
    btn.innerHTML = `<span>${locked ? '🔒' : level.number}</span>` +
      (locked ? '' : `<span class="stars">${'⭐'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`);
    btn.addEventListener('click', () => {
      if (locked) return;
      loadLevel(idx);
      closeModal('levelModal');
    });
    grid.appendChild(btn);
  });
}

function openModal(id) {
  el(id).classList.remove('hidden');
  if (id === 'levelModal') buildLevelGrid();
}
function closeModal(id) {
  el(id).classList.add('hidden');
}

// ---------------------------------------------------------------------
// Wire up UI events
// ---------------------------------------------------------------------
document.querySelectorAll('.rotbtn').forEach((btn) => {
  btn.addEventListener('click', () => {
    doRotate(btn.dataset.axis, parseInt(btn.dataset.dir, 10));
  });
});

el('pushBtn').addEventListener('click', attemptPush);
el('resetBtn').addEventListener('click', () => loadLevel(levelIndex));
el('hintBtn').addEventListener('click', giveHint);
el('nextLevelBtn').addEventListener('click', () => {
  loadLevel(Math.min(levelIndex + 1, LEVELS.length - 1));
});
el('retryBtn').addEventListener('click', () => loadLevel(levelIndex));

el('levelSelectBtn').addEventListener('click', () => openModal('levelModal'));
el('helpBtn').addEventListener('click', () => openModal('helpModal'));
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
});

window.addEventListener('keydown', (e) => {
  if (!resultOverlay.classList.contains('hidden')) return;
  const map = {
    q: ['x', -1], w: ['x', 1],
    a: ['y', -1], s: ['y', 1],
    z: ['z', -1], x: ['z', 1],
  };
  if (map[e.key.toLowerCase()]) {
    const [axis, dir] = map[e.key.toLowerCase()];
    doRotate(axis, dir);
  } else if (e.code === 'Space') {
    e.preventDefault();
    attemptPush();
  } else if (e.key.toLowerCase() === 'r') {
    loadLevel(levelIndex);
  }
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
  const startIndex = 0;
  loadLevel(startIndex);
  animate();

  if (!localStorage.getItem(SAVE_KEY)) {
    setTimeout(() => showToast('Welcome! Tap the ? button any time for how to play.'), 600);
  }
}

boot();
