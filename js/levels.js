// levels.js
// Shape library + level campaigns for Cube Fit.
//
// Each shape is a list of unit-cube coordinates [x, y, z] (integers).
// A level names one or more VIEWS (front / top / side). The wall for each
// named view slides through the piece from that view's direction, and the
// piece's silhouette from that direction must exactly match the hole -
// which is always derived directly from the shape's own (unrotated)
// projection, so a level can never be impossible.
//
//   Easy   - one view.  The classic single-wall challenge.
//   Medium - two views at once. The player must find ONE orientation that
//            satisfies both walls simultaneously.
//   Hard   - all three views at once - effectively "put it back exactly
//            the way it started" (or an equivalent symmetric orientation).

import { centerShape, project } from './geometry.js';

// ---- Shape library ---------------------------------------------------

const L_TETROMINO = [
  [0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 0, 0],
];
const T_TETROMINO = [
  [0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0],
];
const S_TETROMINO = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0],
];
const PLUS_PENTOMINO = [
  [1, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [1, 2, 0],
];
const STEP_3D = [
  [0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1],
];
const CORNER_3D = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
];
const SOMA_L_3D = [
  [0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 2, 0], [1, 2, 1],
];
const CHUNKY_3D = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1], [2, 1, 1], [1, 0, 1],
];

export const SHAPE_LIB = {
  L_TETROMINO, T_TETROMINO, S_TETROMINO, PLUS_PENTOMINO,
  STEP_3D, CORNER_3D, SOMA_L_3D, CHUNKY_3D,
};

export const VIEW_LABELS = {
  front: 'FRONT VIEW',
  top: 'TOP VIEW',
  side: 'SIDE VIEW',
};

export const VIEW_EXPLAIN = {
  front: 'Looking straight AT the block, face-on.',
  top: 'Looking straight DOWN on the block from above.',
  side: 'Looking at the block from its LEFT or RIGHT side.',
};

// The world axis each view's wall slides along.
export const VIEW_AXIS = { front: 'z', top: 'y', side: 'x' };

function buildLevel(id, shapeKey, views, par, intro) {
  const shape = centerShape(SHAPE_LIB[shapeKey]);
  const holes = {};
  for (const v of views) holes[v] = project(shape, v);
  return { id, shapeKey, shape, views, holes, par, intro: intro || null };
}

// ---- EASY: one wall -----------------------------------------------------
const EASY_RAW = [
  ['L_TETROMINO', ['front'], 0, 'Rotate the block so its FRONT matches the hole. Watch the x-ray panel!'],
  ['L_TETROMINO', ['top'], 1, 'This hole is shaped like the TOP VIEW - looking straight down on the block.'],
  ['L_TETROMINO', ['side'], 1, 'Now fit it through the SIDE VIEW hole - looking at it from the side.'],
  ['T_TETROMINO', ['front'], 2, 'A new block! Find the rotation that makes the FRONT VIEW match.'],
  ['T_TETROMINO', ['top'], 2],
  ['S_TETROMINO', ['front'], 2],
  ['PLUS_PENTOMINO', ['front'], 1, 'This plus-shape looks the same from a few angles - can you find one?'],
  ['PLUS_PENTOMINO', ['side'], 1],
  ['STEP_3D', ['front'], 2, 'This block is truly 3D now - every view looks different. Take your time.'],
  ['STEP_3D', ['top'], 2],
  ['STEP_3D', ['side'], 3],
  ['CORNER_3D', ['front'], 2],
  ['CORNER_3D', ['top'], 2],
  ['SOMA_L_3D', ['front'], 3, 'Challenge block! Plan your rotations before you spin.'],
  ['SOMA_L_3D', ['side'], 3],
  ['CHUNKY_3D', ['front'], 3, 'Final challenge - the trickiest block in the game. Good luck!'],
  ['CHUNKY_3D', ['top'], 3],
  ['CHUNKY_3D', ['side'], 4],
];

// ---- MEDIUM: two walls at once ------------------------------------------
const MEDIUM_RAW = [
  ['L_TETROMINO', ['front', 'top'], 2, 'Two walls this time! Your rotation must satisfy BOTH at once.'],
  ['L_TETROMINO', ['front', 'side'], 2],
  ['T_TETROMINO', ['front', 'top'], 3],
  ['S_TETROMINO', ['front', 'side'], 3],
  ['PLUS_PENTOMINO', ['top', 'side'], 2, 'Check both x-ray panels before you test - every square must be green on both.'],
  ['STEP_3D', ['front', 'top'], 3],
  ['STEP_3D', ['top', 'side'], 3],
  ['CORNER_3D', ['front', 'side'], 3],
  ['CORNER_3D', ['front', 'top'], 3],
  ['SOMA_L_3D', ['front', 'top'], 4, 'Getting tougher - plan for both walls before you spin.'],
  ['SOMA_L_3D', ['top', 'side'], 4],
  ['CHUNKY_3D', ['front', 'side'], 4, 'Toughest medium block - take it slow.'],
];

// ---- HARD: all three walls at once --------------------------------------
const HARD_RAW = [
  ['L_TETROMINO', ['front', 'top', 'side'], 3, 'All three walls at once! Find the ONE orientation that fits every view.'],
  ['T_TETROMINO', ['front', 'top', 'side'], 3],
  ['S_TETROMINO', ['front', 'top', 'side'], 3],
  ['PLUS_PENTOMINO', ['front', 'top', 'side'], 3],
  ['STEP_3D', ['front', 'top', 'side'], 4],
  ['CORNER_3D', ['front', 'top', 'side'], 4],
  ['SOMA_L_3D', ['front', 'top', 'side'], 4, 'Final stretch!'],
  ['CHUNKY_3D', ['front', 'top', 'side'], 5, 'The ultimate block. Good luck!'],
];

function build(raw) {
  return raw.map(([shapeKey, views, par, intro], i) =>
    ({ number: i + 1, ...buildLevel(i + 1, shapeKey, views, par, intro) })
  );
}

export const LEVELS_BY_MODE = {
  easy: build(EASY_RAW),
  medium: build(MEDIUM_RAW),
  hard: build(HARD_RAW),
};

export const MODE_INFO = {
  easy: {
    label: 'Easy',
    subtitle: '1 wall',
    desc: 'Rotate the block to match one view - front, top, or side.',
  },
  medium: {
    label: 'Medium',
    subtitle: '2 walls',
    desc: 'Find one rotation that fits through two walls at once.',
  },
  hard: {
    label: 'Hard',
    subtitle: '3 walls',
    desc: 'Fit through all three walls at once - front, top, AND side.',
  },
};
