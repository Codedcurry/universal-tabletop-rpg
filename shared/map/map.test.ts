import { describe, expect, it } from 'vitest';
import { type Cell, type GridKind, cellKey, createGrid } from '../grid';
import {
  DEFAULT_TERRAIN,
  MAX_HEIGHT,
  MAX_TILES,
  MIN_HEIGHT,
  type MapData,
  MapError,
  createWorldMap,
  rectangleTiles,
  validateMapData,
} from './index';

const c = (q: number, r: number): Cell => ({ q, r });

function flatMap(grid: GridKind, width = 4, height = 4): MapData {
  return {
    formatVersion: 1,
    grid,
    tiles: rectangleTiles(grid, width, height).map((cell) => ({ ...cell, height: 0 })),
    walls: [],
  };
}

describe('rectangleTiles', () => {
  it.each<GridKind>(['hex', 'square'])('makes width x height distinct %s cells', (grid) => {
    const cells = rectangleTiles(grid, 5, 3);
    expect(cells).toHaveLength(15);
    expect(new Set(cells.map(cellKey)).size).toBe(15);
  });

  it('lays hex rows out as a rectangle on screen, not a slanted rhombus', () => {
    const hex = createGrid('hex');
    const xs = rectangleTiles('hex', 6, 6).map((cell) => hex.toWorld(cell, 1).x);
    const width = Math.max(...xs) - Math.min(...xs);
    // Six columns plus at most a half-hex row offset.
    expect(width).toBeLessThanOrEqual(Math.sqrt(3) * 5.5 + 1e-9);
  });

  it('rejects non-positive or fractional sizes', () => {
    expect(() => rectangleTiles('hex', 0, 3)).toThrow(RangeError);
    expect(() => rectangleTiles('square', 2, 1.5)).toThrow(RangeError);
  });
});

describe('createWorldMap', () => {
  it('looks up tiles and knows the world bounds', () => {
    const data = flatMap('square');
    const map = createWorldMap({
      ...data,
      tiles: [...data.tiles, { q: 9, r: 9, height: 3, blocked: true, terrain: 'stone' }],
    });
    expect(map.grid.kind).toBe('square');
    expect(map.tile(c(1, 2))).toEqual({ height: 0, blocked: false, terrain: DEFAULT_TERRAIN });
    expect(map.tile(c(9, 9))).toEqual({ height: 3, blocked: true, terrain: 'stone' });
    expect(map.tile(c(5, 5))).toBeUndefined();
    expect(map.inBounds(c(0, 0))).toBe(true);
    expect(map.inBounds(c(-1, 0))).toBe(false);
  });

  it('lists every tile', () => {
    const map = createWorldMap(flatMap('hex', 3, 2));
    expect(map.cells()).toHaveLength(6);
  });

  it('knows which edges have walls, in both directions', () => {
    const map = createWorldMap({ ...flatMap('hex'), walls: [[c(1, 1), c(2, 1)]] });
    expect(map.hasWall(c(1, 1), c(2, 1))).toBe(true);
    expect(map.hasWall(c(2, 1), c(1, 1))).toBe(true);
    expect(map.hasWall(c(1, 1), c(1, 2))).toBe(false);
  });

  it('copies its input so later changes to the data do not leak in', () => {
    const data = flatMap('square');
    const map = createWorldMap(data);
    (data.tiles[0] as { height: number }).height = 99;
    expect(map.tile(c(0, 0))?.height).toBe(0);
  });

  it('round-trips through plain data', () => {
    const map = createWorldMap({
      ...flatMap('square'),
      tiles: [...flatMap('square').tiles.slice(1), { q: 0, r: 0, height: 2, blocked: true }],
      walls: [
        [c(0, 0), c(1, 0)],
        [c(2, 1), c(2, 2)],
      ],
    });
    const data = map.toData();
    expect(createWorldMap(data).toData()).toEqual(data);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('stores each wall once even if listed twice', () => {
    const map = createWorldMap({
      ...flatMap('hex'),
      walls: [
        [c(1, 1), c(2, 1)],
        [c(2, 1), c(1, 1)],
      ],
    });
    expect(map.toData().walls).toHaveLength(1);
  });

  describe('rejects invalid maps', () => {
    it.each<[string, MapData]>([
      ['an unsupported format version', { ...flatMap('hex'), formatVersion: 2 as 1 }],
      ['an unknown grid', { ...flatMap('hex'), grid: 'triangle' as GridKind }],
      ['a duplicate tile', { ...flatMap('hex'), tiles: [...flatMap('hex').tiles, { q: 0, r: 0, height: 1 }] }],
      ['a fractional height', { ...flatMap('hex'), tiles: [{ q: 0, r: 0, height: 0.5 }] }],
      ['a fractional coordinate', { ...flatMap('hex'), tiles: [{ q: 0.5, r: 0, height: 0 }] }],
      ['a wall between cells that are not neighbors', { ...flatMap('hex'), walls: [[c(0, 0), c(2, 0)]] }],
      ['a wall from a cell to itself', { ...flatMap('hex'), walls: [[c(1, 1), c(1, 1)]] }],
      ['a wall on a square diagonal (walls sit on edges)', { ...flatMap('square'), walls: [[c(0, 0), c(1, 1)]] }],
    ])('%s', (_name, data) => {
      expect(() => createWorldMap(data)).toThrow(MapError);
    });
  });
});

describe('map limits', () => {
  it('uses grass when a tile names no terrain', () => {
    expect(DEFAULT_TERRAIN).toBe('grass');
  });

  it('rejects heights outside the allowed range', () => {
    expect(() => createWorldMap({ ...flatMap('hex'), tiles: [{ q: 0, r: 0, height: MAX_HEIGHT }] })).not.toThrow();
    expect(() => createWorldMap({ ...flatMap('hex'), tiles: [{ q: 0, r: 0, height: MAX_HEIGHT + 1 }] })).toThrow(MapError);
    expect(() => createWorldMap({ ...flatMap('hex'), tiles: [{ q: 0, r: 0, height: MIN_HEIGHT - 1 }] })).toThrow(MapError);
  });

  it('rejects maps too big for a phone', () => {
    expect(MAX_TILES).toBe(10_000);
    expect(() => createWorldMap(flatMap('square', 100, 100))).not.toThrow();
    expect(() => createWorldMap(flatMap('square', 101, 100))).toThrow(MapError);
  });

  it('rejects a badly formed terrain id', () => {
    expect(() => createWorldMap({ ...flatMap('hex'), tiles: [{ q: 0, r: 0, height: 0, terrain: 'Lava!' }] })).toThrow(MapError);
  });

  it('puts tiles and walls in a fixed order, so equal maps produce equal data', () => {
    const base = flatMap('square', 3, 3);
    // Same tiles and walls, listed in a different order and direction.
    const a = createWorldMap({ ...base, walls: [[c(0, 0), c(1, 0)], [c(2, 1), c(2, 2)]] });
    const b = createWorldMap({ ...base, tiles: [...base.tiles].reverse(), walls: [[c(2, 2), c(2, 1)], [c(1, 0), c(0, 0)]] });
    expect(a.toData()).toEqual(b.toData());
  });
});

describe('validateMapData', () => {
  // Imported map files are untrusted: anything that isn't a valid map is refused with a reason.
  it('accepts a valid map and returns it normalized', () => {
    const data = JSON.parse(JSON.stringify(flatMap('hex', 3, 2)));
    const result = validateMapData(data);
    expect(result).toEqual({ ok: true, map: createWorldMap(flatMap('hex', 3, 2)).toData() });
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'map'],
    ['no tiles list', { formatVersion: 1, grid: 'hex', walls: [] }],
    ['no walls list', { formatVersion: 1, grid: 'hex', tiles: [] }],
    ['a tile that is not an object', { formatVersion: 1, grid: 'hex', tiles: [5], walls: [] }],
    ['a tile with string coordinates', { formatVersion: 1, grid: 'hex', tiles: [{ q: '0', r: 0, height: 0 }], walls: [] }],
    ['a non-boolean blocked flag', { formatVersion: 1, grid: 'hex', tiles: [{ q: 0, r: 0, height: 0, blocked: 1 }], walls: [] }],
    ['a malformed wall', { formatVersion: 1, grid: 'hex', tiles: [], walls: [[{ q: 0, r: 0 }]] }],
    ['an unknown grid', { formatVersion: 1, grid: 'triangle', tiles: [], walls: [] }],
    ['a newer format version', { formatVersion: 2, grid: 'hex', tiles: [], walls: [] }],
  ])('refuses %s, with a reason', (_name, data) => {
    const result = validateMapData(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
