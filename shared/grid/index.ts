import { hexGrid } from './hex';
import { squareGrid } from './square';
import type { Grid, GridKind } from './types';

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
