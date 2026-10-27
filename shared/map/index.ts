import { type Cell, type Grid, type GridKind, cell, cellKey, createGrid } from '../grid';
import { type CustomObject, MAX_CUSTOM_OBJECTS, type MapObjectInfo, customObjectProblem, objectInfoIn } from './objects';

/**
 * The world map: which cells exist (the world bounds), how high each one is,
 * what it's made of, and where walls stand. Walls sit on the edge between two
 * neighboring cells.
 */

export const MAP_FORMAT_VERSION = 1;

/** Height range in whole levels. */
export const MIN_HEIGHT = 0;
export const MAX_HEIGHT = 30;
/** 100 x 100: big enough for a battle map, small enough for a phone to draw. */
export const MAX_TILES = 10_000;
/** Terrain ids are looked up in the active style pack for how they look. */
export const DEFAULT_TERRAIN = 'grass';

const TERRAIN_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface TileData {
  readonly q: number;
  readonly r: number;
  /** Height in whole levels; tokens step up and down between levels. */
  readonly height: number;
  /** A solid tile (pillar, boulder, deep water) nothing can enter. */
  readonly blocked?: boolean;
  /** Terrain id such as "grass" or "water"; defaults to grass. Cosmetic for now. */
  readonly terrain?: string;
  /** Something standing on the tile, such as "tree" or "barrel" (see objects.ts). */
  readonly object?: string;
}

export type WallData = readonly [Cell, Cell];

/** Plain, JSON-friendly map data for saving, export, and sync. */
export interface MapData {
  readonly formatVersion: typeof MAP_FORMAT_VERSION;
  readonly grid: GridKind;
  readonly tiles: readonly TileData[];
  readonly walls: readonly WallData[];
  /** Objects made for this map (see objects.ts), placed on its tiles by id. */
  readonly objects?: readonly CustomObject[];
  /** A picture laid on the ground (a book's map art), on square maps. */
  readonly backdrop?: MapBackdrop;
}

/**
 * A picture laid on the ground, lined up with the tiles: its top-left
 * corner at tile (0, 0)'s, `width` by `height` tiles across (a book's map
 * art, traced into this map: the map looks like the book).
 */
export interface MapBackdrop {
  /** A JPEG, PNG, or WebP data URL. */
  readonly image: string;
  readonly width: number;
  readonly height: number;
}

/** The largest backdrop picture, in characters of its data URL (about 1.2 MB). */
export const MAX_BACKDROP_CHARS = 1_600_000;
const BACKDROP_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** What's wrong with a backdrop, if anything. */
export function backdropProblem(backdrop: unknown, grid: GridKind): string | null {
  if (typeof backdrop !== 'object' || backdrop === null) return 'is malformed';
  const { image, width, height } = backdrop as Record<string, unknown>;
  if (grid !== 'square') return 'only goes on square maps';
  if (typeof image !== 'string' || image.length > MAX_BACKDROP_CHARS || !BACKDROP_URL.test(image)) return 'must be a JPEG, PNG, or WebP picture under about 1.2 MB';
  for (const size of [width, height]) if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > 100) return 'must be 1 to 100 tiles across';
  return null;
}

export interface Tile {
  readonly height: number;
  readonly blocked: boolean;
  readonly terrain: string;
  readonly object: string | null;
}

export interface WorldMap {
  readonly grid: Grid;
  /** The tile at a cell, or undefined if the cell is outside the world. */
  tile(cell: Cell): Tile | undefined;
  inBounds(cell: Cell): boolean;
  hasWall(a: Cell, b: Cell): boolean;
  cells(): Cell[];
  /** An object's facts: built-in, or one of the map's own. */
  object(id: string): MapObjectInfo | undefined;
  /** Canonical data: tiles by row then column, walls in a fixed order, so equal maps give equal data. */
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

function compareCells(a: Cell, b: Cell): number {
  return a.r - b.r || a.q - b.q;
}

/** Each wall stored once, with its two cells in a fixed order. */
function orderedWall(a: Cell, b: Cell): [Cell, Cell] {
  return compareCells(a, b) <= 0 ? [cell(a.q, a.r), cell(b.q, b.r)] : [cell(b.q, b.r), cell(a.q, a.r)];
}

function wallKey(a: Cell, b: Cell): string {
  const [first, second] = orderedWall(a, b);
  return `${cellKey(first)}|${cellKey(second)}`;
}

/** Walls sit on shared edges: any hex neighbor, but only orthogonal square neighbors. */
export function sharesEdge(grid: Grid, a: Cell, b: Cell): boolean {
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
  if (data.tiles.length > MAX_TILES) {
    throw new MapError(`A map can have at most ${MAX_TILES} tiles (this one has ${data.tiles.length})`);
  }

  const tiles = new Map<string, Tile & { readonly cell: Cell }>();
  for (const tile of data.tiles) {
    const where = `(${tile.q}, ${tile.r})`;
    if (!Number.isInteger(tile.q) || !Number.isInteger(tile.r)) {
      throw new MapError(`Tile coordinates must be whole numbers, got ${where}`);
    }
    if (!Number.isInteger(tile.height) || tile.height < MIN_HEIGHT || tile.height > MAX_HEIGHT) {
      throw new MapError(`Tile ${where} has height ${tile.height}; heights are whole numbers from ${MIN_HEIGHT} to ${MAX_HEIGHT}`);
    }
    const terrain = tile.terrain ?? DEFAULT_TERRAIN;
    if (!TERRAIN_PATTERN.test(terrain)) throw new MapError(`Tile ${where} has an invalid terrain "${terrain}"`);
    const object = tile.object ?? null;
    if (object !== null && !TERRAIN_PATTERN.test(object)) throw new MapError(`Tile ${where} has an invalid object "${object}"`);
    const key = cellKey(tile);
    if (tiles.has(key)) throw new MapError(`Tile ${where} is listed twice`);
    tiles.set(key, { cell: cell(tile.q, tile.r), height: tile.height, blocked: tile.blocked === true, terrain, object });
  }

  const objects = data.objects ?? [];
  if (objects.length > MAX_CUSTOM_OBJECTS) throw new MapError(`A map can have at most ${MAX_CUSTOM_OBJECTS} objects of its own`);
  const objectIds = new Set<string>();
  for (const object of objects) {
    const problem = customObjectProblem(object);
    if (problem) throw new MapError(`The map's object "${String(object?.name ?? object?.id)}" ${problem}`);
    if (objectIds.has(object.id)) throw new MapError(`The map has two objects called "${object.id}"`);
    objectIds.add(object.id);
  }

  if (data.backdrop !== undefined) {
    const problem = backdropProblem(data.backdrop, data.grid);
    if (problem) throw new MapError(`The map's picture ${problem}`);
  }

  const walls = new Map<string, [Cell, Cell]>();
  for (const [a, b] of data.walls) {
    if (!sharesEdge(grid, a, b)) {
      throw new MapError(`A wall must sit between two cells sharing an edge: (${a.q}, ${a.r}) and (${b.q}, ${b.r})`);
    }
    walls.set(wallKey(a, b), orderedWall(a, b));
  }

  return {
    grid,
    tile: (c) => {
      const tile = tiles.get(cellKey(c));
      return tile && { height: tile.height, blocked: tile.blocked, terrain: tile.terrain, object: tile.object };
    },
    inBounds: (c) => tiles.has(cellKey(c)),
    hasWall: (a, b) => walls.has(wallKey(a, b)),
    cells: () => [...tiles.values()].map((tile) => tile.cell),
    object: (id) => objectInfoIn(objects, id),
    toData: () => ({
      formatVersion: MAP_FORMAT_VERSION,
      grid: grid.kind,
      tiles: [...tiles.values()]
        .sort((a, b) => compareCells(a.cell, b.cell))
        .map((tile) => ({
          q: tile.cell.q,
          r: tile.cell.r,
          height: tile.height,
          terrain: tile.terrain,
          ...(tile.blocked ? { blocked: true } : {}),
          ...(tile.object ? { object: tile.object } : {}),
        })),
      walls: [...walls.values()].sort(([a1, a2], [b1, b2]) => compareCells(a1, b1) || compareCells(a2, b2)),
      ...(objects.length > 0 ? { objects: [...objects] } : {}),
      ...(data.backdrop ? { backdrop: data.backdrop } : {}),
    }),
  };
}

// ---------------------------------------------------------------------------
// Untrusted map files

export type MapValidation = { readonly ok: true; readonly map: MapData } | { readonly ok: false; readonly error: string };

type Data = Record<string, unknown>;
const isObject = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCell = (value: unknown): value is Cell => isObject(value) && typeof value.q === 'number' && typeof value.r === 'number';

/** Checks an imported map file and returns it in canonical form, or a reason it can't be used. */
export function validateMapData(data: unknown): MapValidation {
  if (!isObject(data)) return { ok: false, error: 'This is not a map file' };
  const { formatVersion, grid, tiles, walls, objects, backdrop } = data;
  if (objects !== undefined && !Array.isArray(objects)) return { ok: false, error: "The map's objects are malformed" };
  if (!Array.isArray(tiles)) return { ok: false, error: 'The map has no tile list' };
  if (!Array.isArray(walls)) return { ok: false, error: 'The map has no wall list' };
  for (const [index, tile] of tiles.entries()) {
    if (!isObject(tile) || typeof tile.q !== 'number' || typeof tile.r !== 'number' || typeof tile.height !== 'number') {
      return { ok: false, error: `Tile ${index + 1} is malformed` };
    }
    if (tile.blocked !== undefined && typeof tile.blocked !== 'boolean') {
      return { ok: false, error: `Tile ${index + 1} has a malformed "blocked" flag` };
    }
    if (tile.terrain !== undefined && typeof tile.terrain !== 'string') {
      return { ok: false, error: `Tile ${index + 1} has a malformed terrain` };
    }
    if (tile.object !== undefined && typeof tile.object !== 'string') {
      return { ok: false, error: `Tile ${index + 1} has a malformed object` };
    }
  }
  for (const [index, wall] of walls.entries()) {
    if (!Array.isArray(wall) || wall.length !== 2 || !isCell(wall[0]) || !isCell(wall[1])) {
      return { ok: false, error: `Wall ${index + 1} is malformed` };
    }
  }
  try {
    const map = createWorldMap({
      formatVersion: formatVersion as typeof MAP_FORMAT_VERSION,
      grid: grid as GridKind,
      tiles: tiles as TileData[],
      walls: walls as WallData[],
      ...(Array.isArray(objects) ? { objects: objects as CustomObject[] } : {}),
      ...(backdrop !== undefined ? { backdrop: backdrop as MapBackdrop } : {}),
    });
    return { ok: true, map: map.toData() };
  } catch (error) {
    if (error instanceof MapError) return { ok: false, error: error.message };
    throw error;
  }
}
export { type Vec3, rayPick } from './raypick';
export { enlargeMap, largestEnlargement } from './enlarge';
export {
  type CustomObject,
  MAP_OBJECTS,
  MAX_CUSTOM_OBJECTS,
  MAX_OBJECT_PARTS,
  type MapObjectInfo,
  type ObjectPart,
  customObjectProblem,
  objectInfo,
  objectInfoIn,
} from './objects';
