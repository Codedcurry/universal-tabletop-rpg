import { hexGrid } from './hex';
import { squareGrid } from './square';
import type { Cell, Grid, GridKind } from './types';

export type { Cell, Grid, GridKind, WorldPoint } from './types';
export { cell, cellKey, cellsEqual, parseCellKey } from './cell';

export function createGrid(kind: GridKind): Grid {
  switch (kind) {
    case 'hex':
      return hexGrid;
    case 'square':
      return squareGrid;
    default:
      throw new Error(`Unknown grid kind: ${String(kind satisfies never)}`);
  }
}

/** Compass heading from one cell toward another: 0 = north (toward row 0), PI/2 = east, PI = south. */
export function headingBetween(grid: Grid, from: Cell, to: Cell): number {
  const a = grid.toWorld(from, 1);
  const b = grid.toWorld(to, 1);
  return Math.atan2(b.x - a.x, -(b.z - a.z));
}
