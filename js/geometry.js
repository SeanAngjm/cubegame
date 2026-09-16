// geometry.js
// Pure, framework-free math for the polycube grid model.
// Kept separate from Three.js/DOM code so it can be unit-tested with plain Node.
//
// A "shape" is an array of [x, y, z] integer cube coordinates.
// Rotations are exact 90-degree steps (swap + negate only), so there is
// zero floating point drift no matter how many times a shape is rotated.

export function rotateX(shape, dir = 1) {
  // dir = +1 (90 deg) or -1 (-90 deg)
  return shape.map(([x, y, z]) =>
    dir > 0 ? [x, -z, y] : [x, z, -y]
  );
}

export function rotateY(shape, dir = 1) {
  return shape.map(([x, y, z]) =>
    dir > 0 ? [z, y, -x] : [-z, y, x]
  );
}

export function rotateZ(shape, dir = 1) {
  return shape.map(([x, y, z]) =>
    dir > 0 ? [-y, x, z] : [y, -x, z]
  );
}

// Projections: drop one axis to get the 2D silhouette as seen from that
// direction. Front = looking along -Z (you see the x/y face).
// Top = looking along -Y (you see the x/z face).
// Side = looking along -X (you see the y/z face).
export function projectFront(shape) {
  return dedupe(shape.map(([x, y]) => [x, y]));
}
export function projectTop(shape) {
  return dedupe(shape.map(([x, , z]) => [x, z]));
}
export function projectSide(shape) {
  return dedupe(shape.map(([, y, z]) => [y, z]));
}

export function project(shape, view) {
  if (view === 'front') return projectFront(shape);
  if (view === 'top') return projectTop(shape);
  if (view === 'side') return projectSide(shape);
  throw new Error('Unknown view: ' + view);
}

function dedupe(cells) {
  const seen = new Set();
  const out = [];
  for (const [a, b] of cells) {
    const key = a + ',' + b;
    if (!seen.has(key)) {
      seen.add(key);
      out.push([a, b]);
    }
  }
  return out;
}

// Shift a set of 2D cells so its minimum corner sits at (0,0).
// This lets us compare silhouettes regardless of where the shape
// happens to sit in space after a sequence of rotations.
export function canonicalize2D(cells) {
  let minA = Infinity, minB = Infinity;
  for (const [a, b] of cells) {
    if (a < minA) minA = a;
    if (b < minB) minB = b;
  }
  return cells.map(([a, b]) => [a - minA, b - minB]);
}

export function cellsToKey(cells) {
  return canonicalize2D(cells)
    .map(([a, b]) => `${a},${b}`)
    .sort()
    .join('|');
}

// True if two 2D silhouettes are the same shape (ignoring translation).
export function silhouettesMatch(cellsA, cellsB) {
  return cellsToKey(cellsA) === cellsToKey(cellsB);
}

// Center a 3D shape's coordinates around its own bounding-box center.
// Needed so 90-degree rotations spin the piece in place rather than
// swinging it away from the origin.
export function centerShape(shape) {
  const xs = shape.map(c => c[0]);
  const ys = shape.map(c => c[1]);
  const zs = shape.map(c => c[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  return shape.map(([x, y, z]) => [x - cx, y - cy, z - cz]);
}

export function boundingSize(cells2d) {
  const as = cells2d.map(c => c[0]);
  const bs = cells2d.map(c => c[1]);
  return {
    width: Math.max(...as) - Math.min(...as) + 1,
    height: Math.max(...bs) - Math.min(...bs) + 1,
  };
}
