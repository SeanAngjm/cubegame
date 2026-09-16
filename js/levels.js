// levels.js
// Shape library + level list for Cube Fit.
//
// Each shape is a list of unit-cube coordinates [x, y, z] (integers).
// Levels reuse a handful of shapes but ask for a different target view
// (front / top / side) each time, so students see how the SAME 3D object
// produces a DIFFERENT flat picture depending on which way it's facing.

import { centerShape, project } from './geometry.js';

// ---- Shape library -------------------------------------------------

// Flat pieces (1 cube thick) - great first lessons: two of the three
// views collapse into a plain rectangle, and only the "true" view shows
// the interesting outline. This mirrors the classic paper-and-pencil
// orthographic-view exercise.
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

// Genuinely 3D pieces - now every view is a distinct, non-trivial shape.
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

// ---- Level list ------------------------------------------------------
// `par` is the minimum number of quarter-turns a perfect run needs -
// used only for the star rating, never to block play.

const RAW_LEVELS = [
  { id: 1, shape: L_TETROMINO, view: 'front', par: 0,
    intro: "Rotate the block so its FRONT matches the hole. Watch the x-ray panel!" },
  { id: 2, shape: L_TETROMINO, view: 'top', par: 1,
    intro: "This hole is shaped like the TOP VIEW - looking straight down on the block." },
  { id: 3, shape: L_TETROMINO, view: 'side', par: 1,
    intro: "Now fit it through the SIDE VIEW hole - looking at it from the side." },

  { id: 4, shape: T_TETROMINO, view: 'front', par: 2,
    intro: "A new block! Find the rotation that makes the FRONT VIEW match." },
  { id: 5, shape: T_TETROMINO, view: 'top', par: 2 },
  { id: 6, shape: S_TETROMINO, view: 'front', par: 2 },

  { id: 7, shape: PLUS_PENTOMINO, view: 'front', par: 1,
    intro: "This plus-shape looks the same from a few angles - can you find one?" },
  { id: 8, shape: PLUS_PENTOMINO, view: 'side', par: 1 },

  { id: 9, shape: STEP_3D, view: 'front', par: 2,
    intro: "This block is truly 3D now - every view looks different. Take your time." },
  { id: 10, shape: STEP_3D, view: 'top', par: 2 },
  { id: 11, shape: STEP_3D, view: 'side', par: 3 },

  { id: 12, shape: CORNER_3D, view: 'front', par: 2 },
  { id: 13, shape: CORNER_3D, view: 'top', par: 2 },

  { id: 14, shape: SOMA_L_3D, view: 'front', par: 3,
    intro: "Challenge block! Plan your rotations before you spin." },
  { id: 15, shape: SOMA_L_3D, view: 'side', par: 3 },

  { id: 16, shape: CHUNKY_3D, view: 'front', par: 3,
    intro: "Final challenge - the trickiest block in the game. Good luck!" },
  { id: 17, shape: CHUNKY_3D, view: 'top', par: 3 },
  { id: 18, shape: CHUNKY_3D, view: 'side', par: 4 },
];

// Build the full level objects: center the shape, and derive the hole
// pattern directly from the geometry helpers so it's always guaranteed
// to be an achievable, exact silhouette of that shape.
export const LEVELS = RAW_LEVELS.map((lvl, i) => {
  const shape = centerShape(lvl.shape);
  const hole = project(shape, lvl.view);
  return {
    number: i + 1,
    id: lvl.id,
    shape,
    view: lvl.view,
    hole,
    par: lvl.par,
    intro: lvl.intro || null,
  };
});

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
