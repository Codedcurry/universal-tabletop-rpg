import { describe, expect, it } from 'vitest';
import { type Cell, cellKey, createGrid } from '../grid';
import { rayPick } from './raypick';

// Which cell the pointer is over: walk the line of sight until it drops
// below a surface. Tiles have tops; empty cells count as ground level.

const c = (q: number, r: number): Cell => ({ q, r });
const LEVEL = 0.5; // world height per level
const EMPTY_LEVEL = LEVEL; // the ground in empty space: the top of a level-0 tile

function heights(entries: Array<[Cell, number]>) {
  const map = new Map(entries.map(([cell, height]) => [cellKey(cell), height]));
  return (cell: Cell) => {
    const height = map.get(cellKey(cell));
    return height === undefined ? undefined : (height + 1) * LEVEL;
  };
}

function flat(width: number, depth: number, overrides: Array<[Cell, number | null]> = []) {
  const entries: Array<[Cell, number]> = [];
  const skip = new Set(overrides.filter(([, h]) => h === null).map(([cell]) => cellKey(cell)));
  const raised = new Map(overrides.filter(([, h]) => h !== null).map(([cell, h]) => [cellKey(cell), h as number]));
  for (let q = 0; q < width; q++) {
    for (let r = 0; r < depth; r++) {
      if (!skip.has(cellKey(c(q, r)))) entries.push([c(q, r), raised.get(cellKey(c(q, r))) ?? 0]);
    }
  }
  return heights(entries);
}

const square = createGrid('square');

describe('rayPick', () => {
  it('finds the tile straight below', () => {
    const hit = rayPick(square, flat(5, 5), { x: 2, y: 10, z: 3 }, { x: 0, y: -1, z: 0 }, 1, EMPTY_LEVEL);
    expect(hit?.cell).toEqual(c(2, 3));
    expect(hit?.point.x).toBeCloseTo(2);
    expect(hit?.point.z).toBeCloseTo(3);
  });

  it('finds a tile when looking at a slant', () => {
    // From above (2, 0), looking down and toward +z at 45 degrees: lands on (2, 3) at y = 0.5.
    const hit = rayPick(square, flat(5, 5), { x: 2, y: 3.5, z: 0 }, { x: 0, y: -1, z: 1 }, 1, EMPTY_LEVEL);
    expect(hit?.cell).toEqual(c(2, 3));
  });

  it('looks down into a hole instead of hitting the far side of it', () => {
    const tiles = flat(7, 7, [[c(3, 3), null]]);
    const hit = rayPick(square, tiles, { x: 3, y: 3.5, z: 0 }, { x: 0, y: -1, z: 1 }, 1, EMPTY_LEVEL);
    expect(hit?.cell).toEqual(c(3, 3));
  });

  it('stops at the face of a cliff it runs into', () => {
    // A tall tile at (2, 2): the slanted ray passes over (2, 1) and hits the tall tile's side.
    const tiles = flat(5, 5, [[c(2, 2), 8]]);
    const hit = rayPick(square, tiles, { x: 2, y: 3, z: 0 }, { x: 0, y: -1, z: 1 }, 1, EMPTY_LEVEL);
    expect(hit?.cell).toEqual(c(2, 2));
  });

  it('reports empty cells outside the world at ground level', () => {
    const hit = rayPick(square, flat(3, 3), { x: 8, y: 5, z: 1 }, { x: 0, y: -1, z: 0 }, 1, EMPTY_LEVEL);
    expect(hit?.cell).toEqual(c(8, 1));
  });

  it('never lands in the gaps between tiles', () => {
    // Points near a tile corner still belong to a tile.
    const hit = rayPick(square, flat(5, 5), { x: 2.49, y: 10, z: 2.49 }, { x: 0, y: -1, z: 0 }, 1, EMPTY_LEVEL);
    expect(hit?.cell).toEqual(c(2, 2));
  });

  it('works on hexes', () => {
    const hex = createGrid('hex');
    const target = c(2, 1);
    const { x, z } = hex.toWorld(target, 1);
    const tiles = heights([[target, 2], [c(1, 1), 0], [c(3, 1), 0]]);
    expect(rayPick(hex, tiles, { x, y: 10, z }, { x: 0, y: -1, z: 0 }, 1, EMPTY_LEVEL)?.cell).toEqual(target);
  });

  it('finds nothing when looking up or level', () => {
    expect(rayPick(square, flat(3, 3), { x: 1, y: 2, z: 1 }, { x: 0, y: 1, z: 0 }, 1, EMPTY_LEVEL)).toBeNull();
    expect(rayPick(square, flat(3, 3), { x: 1, y: 2, z: 1 }, { x: 1, y: 0, z: 0 }, 1, EMPTY_LEVEL)).toBeNull();
  });
});
