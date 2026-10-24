import { LINE_NUDGE, assertRadius, cell, lerp } from './cell';
import type { Cell, Grid, WorldPoint } from './types';

// q = column, r = row. 8-way movement where a diagonal step costs 1
// (Chebyshev distance), matching common d20 grid rules.

// Orthogonal directions come first so that, between equally cheap paths,
// pathfinding prefers straight steps over zigzagging diagonals.
const DIRECTIONS: readonly Cell[] = [
  cell(1, 0),
  cell(0, 1),
  cell(-1, 0),
  cell(0, -1),
  cell(1, -1),
  cell(1, 1),
  cell(-1, 1),
  cell(-1, -1),
];

function distance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
}

export const squareGrid: Grid = {
  kind: 'square',

  neighbors(c) {
    return DIRECTIONS.map((d) => cell(c.q + d.q, c.r + d.r));
  },

  distance,

  line(a, b) {
    const steps = distance(a, b);
    if (steps === 0) return [cell(a.q, a.r)];
    const cells: Cell[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // The nudge makes exact .5 ties round the same way every time.
      cells.push(
        cell(Math.round(lerp(a.q, b.q, t) + LINE_NUDGE), Math.round(lerp(a.r, b.r, t) + LINE_NUDGE)),
      );
    }
    return cells;
  },

  range(center, radius) {
    assertRadius(radius);
    const cells: Cell[] = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) cells.push(cell(center.q + dq, center.r + dr));
    }
    return cells;
  },

  toWorld(c, cellSize): WorldPoint {
    return { x: c.q * cellSize, z: c.r * cellSize };
  },

  fromWorld(point, cellSize) {
    return cell(Math.round(point.x / cellSize), Math.round(point.z / cellSize));
  },
};
