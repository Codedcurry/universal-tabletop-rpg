import { describe, expect, it } from 'vitest';
import { type Cell, type GridKind, cellKey, createGrid } from '../grid';
import { createWorldMap, rectangleTiles } from '../map';
import { applyEdit, blankMap, convertGrid, edgeNeighbor, fillCells, fillEmptyCells, frontierCells, shapeCells } from './index';

const c = (q: number, r: number): Cell => ({ q, r });
const keys = (cells: readonly Cell[]) => new Set(cells.map(cellKey));

/** On-screen column/row to a cell, matching rectangleTiles' layout. */
function at(kind: GridKind, column: number, row: number): Cell {
  return kind === 'hex' ? c(column - Math.floor(row / 2), row) : c(column, row);
}

describe.each<GridKind>(['hex', 'square'])('shapes on a %s grid', (kind) => {
  const grid = createGrid(kind);

  it('single picks just the start cell', () => {
    expect(shapeCells(grid, 'single', c(2, 2), c(5, 5))).toEqual([c(2, 2)]);
  });

  it('line follows the grid line', () => {
    expect(shapeCells(grid, 'line', c(0, 0), c(4, 2))).toEqual(grid.line(c(0, 0), c(4, 2)));
  });

  it('circle covers everything within the dragged radius', () => {
    const cells = shapeCells(grid, 'circle', c(3, 3), c(5, 3));
    expect(keys(cells)).toEqual(keys(grid.range(c(3, 3), 2)));
  });

  it('rectangle matches the on-screen rectangle, whichever corner you start from', () => {
    const from = at(kind, 1, 1);
    const to = at(kind, 4, 3);
    const expected = rectangleTiles(kind, 4, 3).map((cell) => {
      // rectangleTiles starts at column 0, row 0; shift it to start at column 1, row 1.
      const column = kind === 'hex' ? cell.q + Math.floor(cell.r / 2) : cell.q;
      return at(kind, column + 1, cell.r + 1);
    });
    expect(keys(shapeCells(grid, 'rectangle', from, to))).toEqual(keys(expected));
    expect(keys(shapeCells(grid, 'rectangle', to, from))).toEqual(keys(expected));
  });

  it('fill spreads over the connected area that looks the same', () => {
    let map = blankMap(kind, 6, 6);
    const plateau = [at(kind, 2, 2), at(kind, 3, 2), at(kind, 2, 3), at(kind, 3, 3)];
    map = applyEdit(map, { type: 'raise', cells: plateau, amount: 2 });
    map = applyEdit(map, { type: 'setTerrain', cells: [at(kind, 0, 0)], terrain: 'stone' });
    const world = createWorldMap(map);
    expect(keys(fillCells(world, plateau[0] as Cell))).toEqual(keys(plateau));
    // Ground minus the plateau and the one stone tile.
    expect(fillCells(world, at(kind, 5, 5))).toHaveLength(36 - 4 - 1);
    expect(fillCells(world, c(40, 40))).toEqual([]);
  });
});

describe('edgeNeighbor (for placing walls)', () => {
  it('on hexes, picks the neighbor across the nearest of six edges', () => {
    const grid = createGrid('hex');
    const center = c(2, 2);
    const origin = grid.toWorld(center, 1);
    for (const neighbor of grid.neighbors(center)) {
      const toward = grid.toWorld(neighbor, 1);
      // A point 40% of the way toward the neighbor's center.
      const point = { x: origin.x + (toward.x - origin.x) * 0.4, z: origin.z + (toward.z - origin.z) * 0.4 };
      expect(edgeNeighbor(grid, center, point, 1)).toEqual(neighbor);
    }
  });

  it('on squares, picks one of the four sides, never a corner', () => {
    const grid = createGrid('square');
    expect(edgeNeighbor(grid, c(2, 2), { x: 2.4, z: 2.1 }, 1)).toEqual(c(3, 2));
    expect(edgeNeighbor(grid, c(2, 2), { x: 2.1, z: 1.6 }, 1)).toEqual(c(2, 1));
    expect(edgeNeighbor(grid, c(2, 2), { x: 1.55, z: 2.4 }, 1)).toEqual(c(1, 2));
    expect(edgeNeighbor(grid, c(2, 2), { x: 2.0, z: 2.4 }, 1)).toEqual(c(2, 3));
  });
});

describe('frontierCells (where "Add tiles" can build)', () => {
  it('lists empty cells within a few steps of the world, once each', () => {
    const world = createWorldMap(blankMap('square', 3, 3));
    const ring = frontierCells(world, 1);
    expect(ring).toHaveLength(5 * 5 - 9);
    expect(new Set(ring.map(cellKey)).size).toBe(ring.length);
    expect(ring.some((cell) => world.inBounds(cell))).toBe(false);
    expect(frontierCells(world, 2)).toHaveLength(7 * 7 - 9);
  });

  it('follows the grid shape on hexes', () => {
    const world = createWorldMap({ formatVersion: 1, grid: 'hex', tiles: [{ q: 0, r: 0, height: 0 }], walls: [] });
    expect(keys(frontierCells(world, 1))).toEqual(keys(createGrid('hex').neighbors(c(0, 0))));
  });

  it('is empty for an empty world or zero depth', () => {
    expect(frontierCells(createWorldMap({ formatVersion: 1, grid: 'hex', tiles: [], walls: [] }), 2)).toEqual([]);
    expect(frontierCells(createWorldMap(blankMap('hex', 2, 2)), 0)).toEqual([]);
  });
});

describe('fill on squares behaves like a paint bucket', () => {
  it('spreads only through shared edges, so a diagonal line holds it in', () => {
    let map = blankMap('square', 5, 5);
    // A diagonal of stone from bottom-left to top-right.
    map = applyEdit(map, { type: 'setTerrain', cells: [c(0, 4), c(1, 3), c(2, 2), c(3, 1), c(4, 0)], terrain: 'stone' });
    const filled = fillCells(createWorldMap(map), c(0, 0));
    // Only the cells above the diagonal (q + r < 4).
    expect(filled).toHaveLength(10);
    expect(filled.every((cell) => cell.q + cell.r < 4)).toBe(true);
  });
});

describe.each<GridKind>(['hex', 'square'])('ring shape on a %s grid', (kind) => {
  const grid = createGrid(kind);

  it('is the outline of the circle: every cell exactly at the dragged distance', () => {
    const ring = shapeCells(grid, 'ring', c(3, 3), c(5, 3));
    expect(ring.every((cell) => grid.distance(c(3, 3), cell) === 2)).toBe(true);
    expect(ring).toHaveLength(kind === 'hex' ? 12 : 16);
  });

  it('is just the center cell for a zero-size drag', () => {
    expect(shapeCells(grid, 'ring', c(3, 3), c(3, 3))).toEqual([c(3, 3)]);
  });

  it('holds a fill inside it', () => {
    let map = blankMap(kind, 11, 11);
    const center = at(kind, 5, 5);
    const ring = shapeCells(grid, 'ring', center, { q: center.q + 3, r: center.r });
    map = applyEdit(map, { type: 'setTerrain', cells: ring, terrain: 'stone' });
    const inside = fillCells(createWorldMap(map), center);
    expect(keys(inside)).toEqual(keys(grid.range(center, 2)));
  });
});

describe('convertGrid', () => {
  it('keeps the on-screen layout, heights, terrain, and solid tiles', () => {
    let hex = blankMap('hex', 4, 3);
    hex = applyEdit(hex, { type: 'raise', cells: [at('hex', 2, 1)], amount: 3 });
    hex = applyEdit(hex, { type: 'setTerrain', cells: [at('hex', 0, 2)], terrain: 'water' });
    hex = applyEdit(hex, { type: 'setBlocked', cells: [at('hex', 3, 0)], blocked: true });
    const { map: square } = convertGrid(hex, 'square');
    const world = createWorldMap(square);
    expect(square.grid).toBe('square');
    expect(square.tiles).toHaveLength(12);
    expect(world.tile(at('square', 2, 1))).toMatchObject({ height: 3 });
    expect(world.tile(at('square', 0, 2))).toMatchObject({ terrain: 'water' });
    expect(world.tile(at('square', 3, 0))).toMatchObject({ blocked: true });
  });

  it('round-trips back to the same map', () => {
    const hex = applyEdit(blankMap('hex', 5, 4), { type: 'raise', cells: [at('hex', 1, 3)], amount: 2 });
    expect(convertGrid(convertGrid(hex, 'square').map, 'hex').map).toEqual(hex);
  });

  it('keeps walls that still sit on an edge and reports the ones it had to drop', () => {
    let hex = blankMap('hex', 4, 4);
    // Same row: still neighbors on squares. Across rows: a hex neighbor that is diagonal on squares.
    hex = applyEdit(hex, { type: 'setWall', a: at('hex', 1, 1), b: at('hex', 2, 1), present: true });
    hex = applyEdit(hex, { type: 'setWall', a: at('hex', 1, 1), b: c(at('hex', 1, 1).q + 1, at('hex', 1, 1).r - 1), present: true });
    const result = convertGrid(hex, 'square');
    expect(result.map.walls).toHaveLength(1);
    expect(result.droppedWalls).toBe(1);
  });

  it('returns the map unchanged when it already uses that grid', () => {
    const square = blankMap('square', 3, 3);
    expect(convertGrid(square, 'square')).toEqual({ map: square, droppedWalls: 0 });
  });
});

describe('fillEmptyCells (Fill with "Add tiles")', () => {
  it.each<GridKind>(['hex', 'square'])('fills the empty inside of a ring of tiles built in empty space (%s)', (kind) => {
    const grid = createGrid(kind);
    const center = c(0, 0);
    const ring = shapeCells(grid, 'ring', center, c(3, 0));
    const world = createWorldMap({ formatVersion: 1, grid: kind, tiles: ring.map((cell) => ({ ...cell, height: 0 })), walls: [] });
    expect(keys(fillEmptyCells(world, center) ?? [])).toEqual(keys(grid.range(center, 2)));
  });

  it('fills a hole in the middle of a map', () => {
    const hole = [c(2, 2), c(3, 2), c(2, 3)];
    const map = applyEdit(blankMap('square', 6, 6), { type: 'removeTiles', cells: hole });
    expect(keys(fillEmptyCells(createWorldMap(map), c(2, 2)) ?? [])).toEqual(keys(hole));
  });

  it('refuses an area that is open to the outside', () => {
    const world = createWorldMap(blankMap('square', 4, 4));
    expect(fillEmptyCells(world, c(6, 1))).toBeNull();
    // A gap in the ring lets the fill escape.
    const grid = createGrid('hex');
    const broken = shapeCells(grid, 'ring', c(0, 0), c(3, 0)).slice(1);
    const leaky = createWorldMap({ formatVersion: 1, grid: 'hex', tiles: broken.map((cell) => ({ ...cell, height: 0 })), walls: [] });
    expect(fillEmptyCells(leaky, c(0, 0))).toBeNull();
  });

  it('on squares, a diagonal outline holds the fill, like a paint bucket', () => {
    // The fill spreads only through shared edges, so it can't slip between tiles that touch at corners.
    const diamond = [c(2, 0), c(3, 1), c(4, 2), c(3, 3), c(2, 4), c(1, 3), c(0, 2), c(1, 1)];
    const world = createWorldMap({ formatVersion: 1, grid: 'square', tiles: diamond.map((cell) => ({ ...cell, height: 0 })), walls: [] });
    expect(keys(fillEmptyCells(world, c(2, 2)) ?? [])).toEqual(keys([c(2, 2), c(2, 1), c(3, 2), c(2, 3), c(1, 2)]));
  });

  it('refuses to start on a tile that already exists', () => {
    expect(fillEmptyCells(createWorldMap(blankMap('hex', 3, 3)), c(1, 1))).toBeNull();
  });
});
