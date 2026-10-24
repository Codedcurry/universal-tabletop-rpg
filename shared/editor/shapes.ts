import { type Cell, type Grid, type GridKind, type WorldPoint, cell, cellKey, createGrid } from '../grid';
import { MAX_TILES, type MapData, type WallData, type WorldMap, createWorldMap, sharesEdge } from '../map';

/** How a tool picks cells: from where the pointer went down to where it is now. */
export type ShapeKind = 'single' | 'line' | 'rectangle' | 'circle' | 'ring' | 'fill';

/** Hex rows are offset on screen (see rectangleTiles); this is the on-screen column. */
function column(grid: Grid, c: Cell): number {
  return grid.kind === 'hex' ? c.q + Math.floor(c.r / 2) : c.q;
}

/**
 * Cells covered by a shape dragged from `from` to `to`. Geometric only: it
 * may include cells outside the world (needed for growing the world).
 */
export function shapeCells(grid: Grid, kind: Exclude<ShapeKind, 'fill'>, from: Cell, to: Cell): Cell[] {
  switch (kind) {
    case 'single':
      return [cell(from.q, from.r)];
    case 'line':
      return grid.line(from, to);
    case 'circle':
      return grid.range(from, grid.distance(from, to));
    case 'ring': {
      // Just the outline: every cell exactly at the dragged distance.
      const radius = grid.distance(from, to);
      if (radius === 0) return [cell(from.q, from.r)];
      return grid.range(from, radius).filter((c) => grid.distance(from, c) === radius);
    }
    case 'rectangle': {
      const [rowMin, rowMax] = [Math.min(from.r, to.r), Math.max(from.r, to.r)];
      const [colMin, colMax] = [Math.min(column(grid, from), column(grid, to)), Math.max(column(grid, from), column(grid, to))];
      const cells: Cell[] = [];
      for (let r = rowMin; r <= rowMax; r++) {
        const offset = grid.kind === 'hex' ? Math.floor(r / 2) : 0;
        for (let col = colMin; col <= colMax; col++) cells.push(cell(col - offset, r));
      }
      return cells;
    }
  }
}

/**
 * Neighbors across a shared edge. Fills spread only this way, like a paint
 * bucket: on squares, tiles touching only at a corner don't leak.
 */
function edgeNeighbors(grid: Grid, of: Cell): Cell[] {
  return grid.neighbors(of).filter((neighbor) => sharesEdge(grid, of, neighbor));
}

/** The connected area around `start` that looks the same (height, terrain, blocked), not crossing walls. */
export function fillCells(map: WorldMap, start: Cell): Cell[] {
  const origin = map.tile(start);
  if (!origin) return [];
  const matches = (c: Cell) => {
    const tile = map.tile(c);
    return (
      tile !== undefined &&
      tile.height === origin.height &&
      tile.terrain === origin.terrain &&
      tile.blocked === origin.blocked
    );
  };
  const seen = new Set([cellKey(start)]);
  const result: Cell[] = [];
  const queue: Cell[] = [cell(start.q, start.r)];
  for (let next = queue.shift(); next; next = queue.shift()) {
    result.push(next);
    for (const neighbor of edgeNeighbors(map.grid, next)) {
      const key = cellKey(neighbor);
      if (seen.has(key) || map.hasWall(next, neighbor) || !matches(neighbor)) continue;
      seen.add(key);
      queue.push(neighbor);
    }
  }
  return result;
}

/**
 * For placing walls: the neighbor across the edge of `of` nearest to a point
 * on the ground. Square grids only use their four sides.
 */
export function edgeNeighbor(grid: Grid, of: Cell, point: WorldPoint, cellSize: number): Cell {
  const center = grid.toWorld(of, cellSize);
  const dx = point.x - center.x;
  const dz = point.z - center.z;
  let best: Cell | undefined;
  let bestScore = -Infinity;
  for (const neighbor of grid.neighbors(of)) {
    if (!sharesEdge(grid, of, neighbor)) continue;
    const toward = grid.toWorld(neighbor, cellSize);
    const nx = toward.x - center.x;
    const nz = toward.z - center.z;
    const score = (dx * nx + dz * nz) / Math.hypot(nx, nz);
    if (score > bestScore) {
      bestScore = score;
      best = neighbor;
    }
  }
  return best as Cell;
}

/** Empty cells within `depth` steps of the world: where "Add tiles" can build. */
export function frontierCells(map: WorldMap, depth: number): Cell[] {
  const found = new Map<string, Cell>();
  for (const tile of map.cells()) {
    for (const nearby of map.grid.range(tile, depth)) {
      if (!map.inBounds(nearby)) found.set(cellKey(nearby), nearby);
    }
  }
  return [...found.values()];
}

/**
 * For "Add tiles" with Fill: the empty area around `start` that is fully
 * enclosed by tiles (or walls). Returns null if `start` is already a tile or
 * the area is open to the outside, since empty space goes on forever.
 */
export function fillEmptyCells(map: WorldMap, start: Cell): Cell[] | null {
  const cells = map.cells();
  if (cells.length === 0 || map.inBounds(start)) return null;
  // An enclosed area lies within the tiles' bounding box; reaching past it means the area is open.
  const qs = cells.map((c) => c.q);
  const rs = cells.map((c) => c.r);
  const [minQ, maxQ, minR, maxR] = [Math.min(...qs), Math.max(...qs), Math.min(...rs), Math.max(...rs)];
  const outside = (c: Cell) => c.q < minQ || c.q > maxQ || c.r < minR || c.r > maxR;
  if (outside(start)) return null;

  const seen = new Set([cellKey(start)]);
  const result: Cell[] = [];
  const queue: Cell[] = [cell(start.q, start.r)];
  for (let next = queue.shift(); next; next = queue.shift()) {
    result.push(next);
    if (result.length > MAX_TILES) return null;
    for (const neighbor of edgeNeighbors(map.grid, next)) {
      const key = cellKey(neighbor);
      if (seen.has(key) || map.inBounds(neighbor) || map.hasWall(next, neighbor)) continue;
      if (outside(neighbor)) return null;
      seen.add(key);
      queue.push(neighbor);
    }
  }
  return result;
}

/**
 * Re-lays a map on another grid type, keeping each tile at the same on-screen
 * column and row. Walls that no longer sit on a shared edge are dropped.
 */
export function convertGrid(map: MapData, to: GridKind): { map: MapData; droppedWalls: number } {
  if (map.grid === to) return { map, droppedWalls: 0 };
  const from = createGrid(map.grid);
  const target = createGrid(to);
  const move = (c: Cell): Cell => {
    const col = column(from, c);
    return cell(to === 'hex' ? col - Math.floor(c.r / 2) : col, c.r);
  };
  const walls: WallData[] = [];
  let droppedWalls = 0;
  for (const [a, b] of map.walls) {
    const [na, nb] = [move(a), move(b)];
    if (sharesEdge(target, na, nb)) walls.push([na, nb]);
    else droppedWalls++;
  }
  const tiles = map.tiles.map((tile) => ({ ...tile, ...move(tile) }));
  return { map: createWorldMap({ ...map, grid: to, tiles, walls }).toData(), droppedWalls };
}
