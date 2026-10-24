/**
 * A grid cell. Hex grids use axial coordinates (pointy-top); square grids use
 * q = column, r = row.
 */
export interface Cell {
  readonly q: number;
  readonly r: number;
}

export type GridKind = 'hex' | 'square';

/** A point on the ground plane. Babylon's y axis is height, so the grid lies on x/z. */
export interface WorldPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * The one grid interface the rules engine, movement, line of sight, and map
 * editor work against, so every feature supports both hex and square maps.
 */
export interface Grid {
  readonly kind: GridKind;
  /** Cells one step away. */
  neighbors(cell: Cell): Cell[];
  /** Number of steps between two cells. */
  distance(a: Cell, b: Cell): number;
  /** Cells on the straight line from a to b, inclusive, each a neighbor of the previous one. */
  line(a: Cell, b: Cell): Cell[];
  /** Every cell within `radius` steps of `center`, including the center. */
  range(center: Cell, radius: number): Cell[];
  /**
   * Center of a cell on the ground plane. `cellSize` is the hex outer radius
   * (center to corner) or the square side length.
   */
  toWorld(cell: Cell, cellSize: number): WorldPoint;
  /** The cell containing a ground-plane point. */
  fromWorld(point: WorldPoint, cellSize: number): Cell;
}
