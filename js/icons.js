// icons.js
// Generates small curved-arrow SVG icons for the rotate buttons, so a
// student who doesn't know "X/Y/Z axis" yet can still see, at a glance,
// which way a button will spin the block.
//
// Three "shapes" of ellipse hint at the three rotation planes:
//   - tall & narrow  -> looking at it from the side (tipping forward/back)
//   - wide & short    -> looking down at it from above (spinning left/right)
//   - a full circle    -> looking straight at it (rolling like a wheel)
// Each is drawn as a ring with a gap and an arrowhead, so the direction
// of spin is unambiguous.

function describeArc(cx, cy, rx, ry, gapDeg, ccw) {
  const sweep = 360 - gapDeg;
  const startDeg = 90 + gapDeg / 2;
  const toRad = (d) => (d * Math.PI) / 180;
  const pt = (deg) => [cx + rx * Math.cos(toRad(deg)), cy + ry * Math.sin(toRad(deg))];

  // In SVG (y-down) screen space, INCREASING angle by our pt() formula
  // sweeps visually CLOCKWISE. So: ccw=false (clockwise icon) increases
  // the angle; ccw=true decreases it.
  const endDeg = ccw ? startDeg - sweep : startDeg + sweep;
  const [x1, y1] = pt(startDeg);
  const [x2, y2] = pt(endDeg);
  const largeArc = sweep > 180 ? 1 : 0;
  const sweepFlag = ccw ? 0 : 1;
  const path = `M ${x1.toFixed(2)},${y1.toFixed(2)} A ${rx},${ry} 0 ${largeArc} ${sweepFlag} ${x2.toFixed(2)},${y2.toFixed(2)}`;

  // Tangent direction of travel at the end point (arrowhead sits here).
  const theta = toRad(endDeg);
  const dirSign = ccw ? -1 : 1;
  let tx = -rx * Math.sin(theta) * dirSign;
  let ty = ry * Math.cos(theta) * dirSign;
  const len = Math.hypot(tx, ty) || 1;
  tx /= len; ty /= len;
  // perpendicular for the arrowhead's base width
  const px = -ty, py = tx;

  const tipX = x2 + tx * 6;
  const tipY = y2 + ty * 6;
  const baseX = x2 - tx * 4;
  const baseY = y2 - ty * 4;
  const w = 5.2;
  const arrow = `${tipX.toFixed(2)},${tipY.toFixed(2)} ` +
    `${(baseX + px * w).toFixed(2)},${(baseY + py * w).toFixed(2)} ` +
    `${(baseX - px * w).toFixed(2)},${(baseY - py * w).toFixed(2)}`;

  return { path, arrow };
}

function ringIcon(rx, ry, ccw, color) {
  const { path, arrow } = describeArc(32, 32, rx, ry, 62, ccw);
  return `
    <svg viewBox="0 0 64 64" class="rotIcon" aria-hidden="true">
      <ellipse cx="32" cy="32" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-opacity="0.18" stroke-width="4"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="4.6" stroke-linecap="round"/>
      <polygon points="${arrow}" fill="${color}"/>
    </svg>`;
}

// axis: 'x' (tip, side ellipse) | 'y' (spin, top ellipse) | 'z' (roll, circle)
// dir: 1 or -1 (matches the existing rotateX/Y/Z(shape, dir) convention)
const SHAPE = {
  x: { rx: 11, ry: 22 },
  y: { rx: 22, ry: 11 },
  z: { rx: 17, ry: 17 },
};
const COLOR = { x: '#ff8a8a', y: '#8affa0', z: '#8ab4ff' };

// Which on-screen visual direction dir=+1/-1 should draw as an arrow,
// tuned per axis so the icon matches how the block actually appears to
// move from the game's default camera angle.
const CCW_FOR_DIR = {
  x: { 1: true, '-1': false },
  y: { 1: false, '-1': true },
  z: { 1: false, '-1': true },
};

export function rotateIconSVG(axis, dir) {
  const { rx, ry } = SHAPE[axis];
  const ccw = CCW_FOR_DIR[axis][dir];
  return ringIcon(rx, ry, ccw, COLOR[axis]);
}

export const AXIS_META = {
  x: { name: 'Tip', hint: 'tips the block forward / back' },
  y: { name: 'Spin', hint: 'spins the block left / right' },
  z: { name: 'Roll', hint: 'rolls the block like a wheel' },
};
