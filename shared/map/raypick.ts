import type { Cell, Grid, WorldPoint } from '../grid';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Fraction of a cell per step: small enough not to skip a tile corner. */
const STEP = 0.05;

/**
 * Which cell a line of sight (e.g. from the camera through the pointer) is
 * over: walks along it from `origin` and returns the first cell where it
 * drops to that cell's surface. `topOf` gives a tile's top surface height,
 * or undefined for an empty cell, which counts as ground at `emptyLevel`.
 *
 * Walking the grid instead of hit-testing meshes means holes, cliffs, the
 * gaps drawn between tiles, and empty space all behave predictably.
 */
export function rayPick(
  grid: Grid,
  topOf: (cell: Cell) => number | undefined,
  origin: Vec3,
  direction: Vec3,
  cellSize: number,
  emptyLevel: number,
  /** Highest surface in the scene; the walk starts there instead of at the origin. */
  ceiling = origin.y,
): { cell: Cell; point: WorldPoint } | null {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length === 0) return null;
  const dx = direction.x / length;
  const dy = direction.y / length;
  const dz = direction.z / length;
  if (dy >= -1e-9) return null; // never comes down

  const step = cellSize * STEP;
  // Skip the empty air above the tallest surface.
  let t = origin.y > ceiling ? (ceiling - origin.y) / dy : 0;
  // Nothing is below empty ground, so the walk always ends by then.
  const end = (Math.min(emptyLevel, 0) - origin.y) / dy + step;
  for (; t <= end; t += step) {
    const x = origin.x + dx * t;
    const y = origin.y + dy * t;
    const z = origin.z + dz * t;
    const cell = grid.fromWorld({ x, z }, cellSize);
    const top = topOf(cell) ?? emptyLevel;
    if (y <= top) return { cell, point: { x, z } };
  }
  return null;
}
