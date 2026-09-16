// verify-levels.mjs - standalone correctness check for the puzzle math.
// Run with: node js/verify-levels.mjs
// No browser/Three.js needed - this only exercises geometry.js + levels.js.
// Confirms every level, in every difficulty mode, is solvable - i.e. some
// one of the 24 possible orientations makes ALL of that level's required
// views match their holes simultaneously - and reports the worst-case
// number of quarter-turns needed from any scrambled starting orientation,
// which is what the star-rating "par" values should be based on.

import { rotateX, rotateY, rotateZ, project, silhouettesMatch } from './geometry.js';
import { LEVELS_BY_MODE } from './levels.js';

const MOVES = [
  { axis: 'x', dir: 1, fn: (s) => rotateX(s, 1) },
  { axis: 'x', dir: -1, fn: (s) => rotateX(s, -1) },
  { axis: 'y', dir: 1, fn: (s) => rotateY(s, 1) },
  { axis: 'y', dir: -1, fn: (s) => rotateY(s, -1) },
  { axis: 'z', dir: 1, fn: (s) => rotateZ(s, 1) },
  { axis: 'z', dir: -1, fn: (s) => rotateZ(s, -1) },
];

function key3d(shape) {
  return shape.map(([x, y, z]) => `${x},${y},${z}`).sort().join('|');
}

function allOrientations(shape) {
  const seen = new Map([[key3d(shape), shape]]);
  let frontier = [shape];
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      for (const m of MOVES) {
        const r = m.fn(s);
        const k = key3d(r);
        if (!seen.has(k)) { seen.set(k, r); next.push(r); }
      }
    }
    frontier = next;
  }
  return [...seen.values()];
}

function satisfiesAll(shape, level) {
  return level.views.every((v) => silhouettesMatch(project(shape, v), level.holes[v]));
}

let totalFailures = 0;

for (const mode of ['easy', 'medium', 'hard']) {
  const levels = LEVELS_BY_MODE[mode];
  console.log(`\n=== ${mode.toUpperCase()} (${levels.length} levels) ===`);

  for (const level of levels) {
    const orientations = allOrientations(level.shape);
    const solved = orientations.filter((o) => satisfiesAll(o, level));
    const solvable = solved.length > 0;
    if (!solvable) totalFailures++;

    // Worst-case shortest distance from any orientation to a solved one.
    let worst = 0;
    if (solvable) {
      const solvedKeys = new Set(solved.map(key3d));
      for (const start of orientations) {
        if (solvedKeys.has(key3d(start))) continue;
        const dist = new Map([[key3d(start), 0]]);
        let frontier = [start];
        let d = 0;
        let found = false;
        while (frontier.length && !found) {
          d++;
          const next = [];
          for (const s of frontier) {
            for (const m of MOVES) {
              const r = m.fn(s);
              const k = key3d(r);
              if (!dist.has(k)) {
                dist.set(k, d);
                if (solvedKeys.has(k)) found = true;
                next.push(r);
              }
            }
          }
          frontier = next;
        }
        if (found) worst = Math.max(worst, d);
      }
    }

    const viewsStr = level.views.join('+').padEnd(16);
    const status = solvable ? 'OK' : 'FAIL (UNSOLVABLE)';
    console.log(
      `  L${String(level.number).padStart(2)} ${level.shapeKey.padEnd(14)} ${viewsStr} ` +
      `orientations=${String(orientations.length).padStart(2)} solutions=${String(solved.length).padStart(2)} ` +
      `worstCase=${worst} par=${level.par} -> ${status}`
    );
  }
}

console.log('');
if (totalFailures > 0) {
  console.error(`${totalFailures} level(s) are UNSOLVABLE. Fix the shape/view data.`);
  process.exit(1);
} else {
  console.log('All levels, in every mode, are solvable. ✓');
  process.exit(0);
}
