import { LINE_NUDGE, assertRadius, cell, lerp } from './cell';
import type { Cell, Grid, WorldPoint } from './types';

// Axial coordinates, pointy-top. The third cube coordinate is s = -q - r.
// Reference: https://www.redblobgames.com/grids/hexagons/

const DIRECTIONS: readonly Cell[] = [
  cell(1, 0),
  cell(1, -1),
  cell(0, -1),
  cell(-1, 0),
  cell(-1, 1),
  cell(0, 1),
];

const SQRT3 = Math.sqrt(3);

/** Rounds fractional cube coordinates to the nearest hex. */
function roundHex(q: number, r: number): Cell {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  // Rounding all three can break q + r + s = 0; recompute the one that moved most.
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return cell(rq, rr);
}

function distance(a: Cell, b: Cell): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export const hexGrid: Grid = {
  kind: 'hex',

  neighbors(c) {
    return DIRECTIONS.map((d) => cell(c.q + d.q, c.r + d.r));
  },

  distance,

  line(a, b) {
    const steps = distance(a, b);
    if (steps === 0) return [cell(a.q, a.r)];
    // Nudge both ends identically (keeping q + r + s = 0) so lines along hex
    // edges always round to the same side.
    const aq = a.q + LINE_NUDGE;
    const ar = a.r + 2 * LINE_NUDGE;
    const bq = b.q + LINE_NUDGE;
    const br = b.r + 2 * LINE_NUDGE;
    const cells: Cell[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      cells.push(roundHex(lerp(aq, bq, t), lerp(ar, br, t)));
    }
    return cells;
  },

  range(center, radius) {
    assertRadius(radius);
    const cells: Cell[] = [];
    for (let dq = -radius; dq <= radius; dq++) {
      const minR = Math.max(-radius, -dq - radius);
      const maxR = Math.min(radius, -dq + radius);
      for (let dr = minR; dr <= maxR; dr++) cells.push(cell(center.q + dq, center.r + dr));
    }
    return cells;
  },

  toWorld(c, cellSize): WorldPoint {
    return {
      x: cellSize * SQRT3 * (c.q + c.r / 2),
      z: cellSize * 1.5 * c.r,
    };
  },

  fromWorld(point, cellSize) {
    const q = ((SQRT3 / 3) * point.x - point.z / 3) / cellSize;
    const r = ((2 / 3) * point.z) / cellSize;
    return roundHex(q, r);
  },
};
