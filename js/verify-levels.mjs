// verify-levels.mjs - standalone correctness check for the puzzle math.
// Run with: node js/verify-levels.mjs
// No browser/Three.js needed - this only exercises geometry.js + levels.js.
// Confirms every level is solvable (there's a rotation sequence that makes
// the block's silhouette match the hole) before you ever open the game.

import { rotateX, rotateY, rotateZ, projectFront, silhouettesMatch, cellsToKey } from './geometry.js';
import { LEVELS, VIEW_LABELS } from './levels.js';

function allOrientations(shape) {
  const seen = new Map();
  const start = shape;
  const startKey = key3d(start);
  seen.set(startKey, start);
  let frontier = [start];
  const moves = [
    s => rotateX(s, 1), s => rotateX(s, -1),
    s => rotateY(s, 1), s => rotateY(s, -1),
    s => rotateZ(s, 1), s => rotateZ(s, -1),
  ];
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      for (const m of moves) {
        const r = m(s);
        const k = key3d(r);
        if (!seen.has(k)) {
          seen.set(k, r);
          next.push(r);
        }
      }
    }
    frontier = next;
  }
  return [...seen.values()];
}

function key3d(shape) {
  return shape
    .map(([x, y, z]) => `${x},${y},${z}`)
    .sort()
    .join('|');
}

let failures = 0;
let totalOrientationsSeen = null;

console.log(`Checking ${LEVELS.length} levels...\n`);

for (const level of LEVELS) {
  const orientations = allOrientations(level.shape);
  if (totalOrientationsSeen === null) totalOrientationsSeen = orientations.length;

  const solvable = orientations.some(o => silhouettesMatch(projectFront(o), level.hole));

  // Count how many of the 24 orientations actually solve it (multiple
  // correct answers are fine and expected for symmetric pieces).
  const solutionCount = orientations.filter(o => silhouettesMatch(projectFront(o), level.hole)).length;

  const status = solvable ? 'OK' : 'FAIL';
  if (!solvable) failures++;

  console.log(
    `Level ${String(level.number).padStart(2)} (${VIEW_LABELS[level.view].padEnd(10)}) ` +
    `hole=${cellsToKey(level.hole).padEnd(20)} orientations=${orientations.length} ` +
    `solutions=${solutionCount} -> ${status}`
  );
}

console.log('');
console.log(`Rotation group size sampled: ${totalOrientationsSeen} (expected 24 for an asymmetric cube arrangement)`);

if (failures > 0) {
  console.error(`\n${failures} level(s) are UNSOLVABLE. Fix the shape/view data.`);
  process.exit(1);
} else {
  console.log('\nAll levels are solvable. ✓');
  process.exit(0);
}
