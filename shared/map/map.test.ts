import { describe, expect, it } from 'vitest';
import { type Cell, type GridKind, cellKey, createGrid } from '../grid';
import { type MapData, MapError, createWorldMap, rectangleTiles } from './index';

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
    const map = createWorldMap({ ...data, tiles: [...data.tiles, { q: 9, r: 9, height: 3, blocked: true }] });
    expect(map.grid.kind).toBe('square');
    expect(map.tile(c(1, 2))).toEqual({ height: 0, blocked: false });
    expect(map.tile(c(9, 9))).toEqual({ height: 3, blocked: true });
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
