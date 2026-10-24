import { type Cell, type Grid, type GridKind, cell, cellKey, createGrid, parseCellKey } from '../grid';

/**
 * The world map: which cells exist (the world bounds), how high each one is,
 * and where walls stand. Walls sit on the edge between two neighboring cells.
 */

export const MAP_FORMAT_VERSION = 1;

export interface TileData {
  readonly q: number;
  readonly r: number;
  /** Height in whole levels; tokens step up and down between levels. */
  readonly height: number;
  /** A solid tile (pillar, boulder) nothing can enter. */
  readonly blocked?: boolean;
}

export type WallData = readonly [Cell, Cell];

/** Plain, JSON-friendly map data for saving, export, and sync. */
export interface MapData {
  readonly formatVersion: typeof MAP_FORMAT_VERSION;
  readonly grid: GridKind;
  readonly tiles: readonly TileData[];
  readonly walls: readonly WallData[];
}

export interface Tile {
  readonly height: number;
  readonly blocked: boolean;
}

export interface WorldMap {
  readonly grid: Grid;
  /** The tile at a cell, or undefined if the cell is outside the world. */
  tile(cell: Cell): Tile | undefined;
  inBounds(cell: Cell): boolean;
  hasWall(a: Cell, b: Cell): boolean;
  cells(): Cell[];
  toData(): MapData;
}

export class MapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MapError';
  }
}

/**
 * Cells for a map that looks rectangular on screen: `width` columns by
 * `height` rows. Hex rows are shifted so the area doesn't slant.
 */
export function rectangleTiles(kind: GridKind, width: number, height: number): Cell[] {
  for (const size of [width, height]) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError(`Map size must be a positive whole number, got ${size}`);
  }
  const cells: Cell[] = [];
  for (let r = 0; r < height; r++) {
    const offset = kind === 'hex' ? -Math.floor(r / 2) : 0;
    for (let col = 0; col < width; col++) cells.push(cell(col + offset, r));
  }
  return cells;
}

function wallKey(a: Cell, b: Cell): string {
  const keyA = cellKey(a);
  const keyB = cellKey(b);
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}

/** Walls sit on shared edges: any hex neighbor, but only orthogonal square neighbors. */
function sharesEdge(grid: Grid, a: Cell, b: Cell): boolean {
  if (grid.distance(a, b) !== 1) return false;
  return grid.kind === 'hex' || Math.abs(a.q - b.q) + Math.abs(a.r - b.r) === 1;
}

export function createWorldMap(data: MapData): WorldMap {
  if (data.formatVersion !== MAP_FORMAT_VERSION) {
    throw new MapError(`Unsupported map format version ${String(data.formatVersion)}`);
  }
  let grid: Grid;
  try {
    grid = createGrid(data.grid);
  } catch {
    throw new MapError(`Unknown grid type "${String(data.grid)}"`);
  }

  const tiles = new Map<string, Tile>();
  for (const tile of data.tiles) {
    if (!Number.isInteger(tile.q) || !Number.isInteger(tile.r)) {
      throw new MapError(`Tile coordinates must be whole numbers, got (${tile.q}, ${tile.r})`);
    }
    if (!Number.isInteger(tile.height)) {
      throw new MapError(`Tile (${tile.q}, ${tile.r}) has a non-whole height ${tile.height}`);
    }
    const key = cellKey(tile);
    if (tiles.has(key)) throw new MapError(`Tile (${tile.q}, ${tile.r}) is listed twice`);
    tiles.set(key, { height: tile.height, blocked: tile.blocked === true });
  }

  const walls = new Set<string>();
  for (const [a, b] of data.walls) {
    if (!sharesEdge(grid, a, b)) {
      throw new MapError(`A wall must sit between two cells sharing an edge: (${a.q}, ${a.r}) and (${b.q}, ${b.r})`);
    }
    walls.add(wallKey(a, b));
  }

  return {
    grid,
    tile: (c) => tiles.get(cellKey(c)),
    inBounds: (c) => tiles.has(cellKey(c)),
    hasWall: (a, b) => walls.has(wallKey(a, b)),
    cells: () => [...tiles.keys()].map(parseCellKey),
    toData: () => ({
      formatVersion: MAP_FORMAT_VERSION,
      grid: grid.kind,
      tiles: [...tiles].map(([key, tile]) => ({
        ...parseCellKey(key),
        height: tile.height,
        ...(tile.blocked ? { blocked: true } : {}),
      })),
      walls: [...walls].map((key) => {
        const [a, b] = key.split('|') as [string, string];
        return [parseCellKey(a), parseCellKey(b)] as const;
      }),
    }),
  };
}
