import { type Cell, type GridKind, cellKey } from '../grid';
import {
  DEFAULT_TERRAIN,
  MAP_FORMAT_VERSION,
  MAX_HEIGHT,
  MIN_HEIGHT,
  type MapData,
  type TileData,
  type WallData,
  createWorldMap,
  rectangleTiles,
} from '../map';

/**
 * A change to a map: only the tiles and walls that differ. Edits become
 * patches, patches sync to players, and inverse patches power undo.
 */
export interface MapPatch {
  /** Tiles to add or overwrite. */
  readonly tiles: readonly TileData[];
  readonly removeTiles: readonly Cell[];
  readonly addWalls: readonly WallData[];
  readonly removeWalls: readonly WallData[];
}

export const EMPTY_PATCH: MapPatch = { tiles: [], removeTiles: [], addWalls: [], removeWalls: [] };

export function isEmptyPatch(patch: MapPatch): boolean {
  return (
    patch.tiles.length === 0 &&
    patch.removeTiles.length === 0 &&
    patch.addWalls.length === 0 &&
    patch.removeWalls.length === 0
  );
}

/** One tool action in the editor. Tile edits skip cells outside the world. */
export type MapEdit =
  | { readonly type: 'raise'; readonly cells: readonly Cell[]; readonly amount: number }
  | { readonly type: 'setHeight'; readonly cells: readonly Cell[]; readonly height: number }
  | { readonly type: 'setTerrain'; readonly cells: readonly Cell[]; readonly terrain: string }
  | { readonly type: 'setBlocked'; readonly cells: readonly Cell[]; readonly blocked: boolean }
  | { readonly type: 'addTiles'; readonly cells: readonly Cell[]; readonly height: number; readonly terrain: string }
  | { readonly type: 'removeTiles'; readonly cells: readonly Cell[] }
  | { readonly type: 'setWall'; readonly a: Cell; readonly b: Cell; readonly present: boolean };

/** A tile with every optional field spelled out, for comparing. */
function normalizeTile(tile: TileData): Required<TileData> {
  return {
    q: tile.q,
    r: tile.r,
    height: tile.height,
    blocked: tile.blocked === true,
    terrain: tile.terrain ?? DEFAULT_TERRAIN,
  };
}

/** Tile data in the same shape createWorldMap's toData produces. */
function canonicalTile(tile: Required<TileData>): TileData {
  const { blocked, ...rest } = tile;
  return blocked ? { ...rest, blocked } : rest;
}

function sameTile(a: TileData, b: TileData): boolean {
  const x = normalizeTile(a);
  const y = normalizeTile(b);
  return x.height === y.height && x.blocked === y.blocked && x.terrain === y.terrain;
}

function wallKey([a, b]: WallData): string {
  const keyA = cellKey(a);
  const keyB = cellKey(b);
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}

const clampHeight = (height: number) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)));

export function blankMap(
  grid: GridKind,
  width: number,
  height: number,
  options: { height?: number; terrain?: string } = {},
): MapData {
  const tiles = rectangleTiles(grid, width, height).map((cell) => ({
    ...cell,
    height: options.height ?? 0,
    terrain: options.terrain ?? DEFAULT_TERRAIN,
  }));
  return createWorldMap({ formatVersion: MAP_FORMAT_VERSION, grid, tiles, walls: [] }).toData();
}

/** The patch that turns `before` into `after`. */
export function diffMaps(before: MapData, after: MapData): MapPatch {
  const beforeTiles = new Map(before.tiles.map((tile) => [cellKey(tile), tile]));
  const afterKeys = new Set(after.tiles.map(cellKey));
  const beforeWalls = new Set(before.walls.map(wallKey));
  const afterWalls = new Set(after.walls.map(wallKey));
  return {
    tiles: after.tiles
      .filter((tile) => {
        const old = beforeTiles.get(cellKey(tile));
        return !old || !sameTile(old, tile);
      })
      .map((tile) => canonicalTile(normalizeTile(tile))),
    removeTiles: before.tiles.filter((tile) => !afterKeys.has(cellKey(tile))).map(({ q, r }) => ({ q, r })),
    addWalls: after.walls.filter((wall) => !beforeWalls.has(wallKey(wall))),
    removeWalls: before.walls.filter((wall) => !afterWalls.has(wallKey(wall))),
  };
}

/** Applies a patch and returns the new map in canonical form. Throws MapError if the result is invalid. */
export function applyPatch(map: MapData, patch: MapPatch): MapData {
  const tiles = new Map(map.tiles.map((tile) => [cellKey(tile), tile]));
  for (const cell of patch.removeTiles) tiles.delete(cellKey(cell));
  for (const tile of patch.tiles) tiles.set(cellKey(tile), tile);

  const walls = new Map(map.walls.map((wall) => [wallKey(wall), wall]));
  for (const wall of patch.removeWalls) walls.delete(wallKey(wall));
  for (const wall of patch.addWalls) walls.set(wallKey(wall), wall);

  return createWorldMap({ ...map, tiles: [...tiles.values()], walls: [...walls.values()] }).toData();
}

function unique(cells: readonly Cell[]): Cell[] {
  const seen = new Map<string, Cell>();
  for (const cell of cells) seen.set(cellKey(cell), cell);
  return [...seen.values()];
}

/** The patch a tool action makes. Only includes real changes. */
export function editPatch(map: MapData, edit: MapEdit): MapPatch {
  const existing = new Map(map.tiles.map((tile) => [cellKey(tile), normalizeTile(tile)]));

  /** Changes existing tiles; cells outside the world are skipped. */
  const modify = (cells: readonly Cell[], change: (tile: Required<TileData>) => Required<TileData>): MapPatch => {
    const tiles: TileData[] = [];
    for (const cell of unique(cells)) {
      const tile = existing.get(cellKey(cell));
      if (!tile) continue;
      const next = change(tile);
      if (!sameTile(tile, next)) tiles.push(canonicalTile(next));
    }
    return { ...EMPTY_PATCH, tiles };
  };

  switch (edit.type) {
    case 'raise':
      return modify(edit.cells, (tile) => ({ ...tile, height: clampHeight(tile.height + edit.amount) }));
    case 'setHeight':
      return modify(edit.cells, (tile) => ({ ...tile, height: clampHeight(edit.height) }));
    case 'setTerrain':
      return modify(edit.cells, (tile) => ({ ...tile, terrain: edit.terrain }));
    case 'setBlocked':
      return modify(edit.cells, (tile) => ({ ...tile, blocked: edit.blocked }));
    case 'addTiles':
      return {
        ...EMPTY_PATCH,
        tiles: unique(edit.cells)
          .filter((cell) => !existing.has(cellKey(cell)))
          .map(({ q, r }) => ({ q, r, height: clampHeight(edit.height), terrain: edit.terrain })),
      };
    case 'removeTiles':
      return {
        ...EMPTY_PATCH,
        removeTiles: unique(edit.cells)
          .filter((cell) => existing.has(cellKey(cell)))
          .map(({ q, r }) => ({ q, r })),
      };
    case 'setWall': {
      const wall: WallData = [edit.a, edit.b];
      const present = map.walls.some((existingWall) => wallKey(existingWall) === wallKey(wall));
      if (edit.present === present) {
        // Still validate, so a wall between non-neighbors is always an error.
        createWorldMap({ ...map, tiles: [], walls: [wall] });
        return EMPTY_PATCH;
      }
      return edit.present ? { ...EMPTY_PATCH, addWalls: [wall] } : { ...EMPTY_PATCH, removeWalls: [wall] };
    }
  }
}

/** Applies a tool action and returns the new map. Throws MapError if it would make the map invalid. */
export function applyEdit(map: MapData, edit: MapEdit): MapData {
  return applyPatch(map, editPatch(map, edit));
}
