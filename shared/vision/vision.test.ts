import { describe, expect, it } from 'vitest';
import { type Cell, type GridKind, cellKey } from '../grid';
import { type MapData, type TileData, createWorldMap, objectInfo, rectangleTiles } from '../map';
import { VISION_RANGE, hasLineOfSight, sightOf, visibleCells } from './index';

// Who can see whom: walls, tall objects (trees, boulders), solid rock, and
// higher ground block the view; low things (crates, flowers) and deep water
// don't. Used for targeting and for fog of war.

const c = (q: number, r: number): Cell => ({ q, r });

/** A flat map with some tiles changed. */
function world(grid: GridKind, width: number, height: number, changes: Record<string, Partial<TileData>> = {}, walls: MapData['walls'] = []) {
  const tiles = rectangleTiles(grid, width, height).map((cell) => ({ ...cell, height: 0, ...changes[cellKey(cell)] }));
  return createWorldMap({ formatVersion: 1, grid, tiles, walls });
}

describe('hasLineOfSight', () => {
  it('sees across open ground, both ways, and always sees its own tile', () => {
    const map = world('square', 8, 3);
    expect(hasLineOfSight(map, c(0, 1), c(7, 1))).toBe(true);
    expect(hasLineOfSight(map, c(7, 1), c(0, 1))).toBe(true);
    expect(hasLineOfSight(map, c(3, 1), c(3, 1))).toBe(true);
  });

  it('is blocked by a wall in the way, even between neighbors', () => {
    const map = world('square', 8, 3, {}, [[c(3, 1), c(4, 1)]]);
    expect(hasLineOfSight(map, c(0, 1), c(7, 1))).toBe(false);
    expect(hasLineOfSight(map, c(3, 1), c(4, 1))).toBe(false);
    expect(hasLineOfSight(map, c(0, 0), c(7, 0))).toBe(true); // the wall is only on the middle row
  });

  it('is blocked by tall objects, but not by low ones', () => {
    const tree = world('hex', 8, 3, { '3,1': { object: 'tree', blocked: true } });
    expect(hasLineOfSight(tree, c(0, 1), c(6, 1))).toBe(false);
    const crate = world('hex', 8, 3, { '3,1': { object: 'crate', blocked: true } });
    expect(hasLineOfSight(crate, c(0, 1), c(6, 1))).toBe(true);
    const flowers = world('hex', 8, 3, { '3,1': { object: 'flowers' } });
    expect(hasLineOfSight(flowers, c(0, 1), c(6, 1))).toBe(true);
  });

  it('is blocked by solid rock, but sees across deep water', () => {
    const rock = world('square', 8, 3, { '3,1': { blocked: true, terrain: 'stone' } });
    expect(hasLineOfSight(rock, c(0, 1), c(7, 1))).toBe(false);
    const lake = world('square', 8, 3, { '3,1': { blocked: true, terrain: 'water' }, '4,1': { blocked: true, terrain: 'water' } });
    expect(hasLineOfSight(lake, c(0, 1), c(7, 1))).toBe(true);
  });

  it('is blocked by higher ground in between, but a small bump is seen over', () => {
    const hill = world('square', 9, 3, { '4,1': { height: 4 } });
    expect(hasLineOfSight(hill, c(0, 1), c(8, 1))).toBe(false);
    const bump = world('square', 9, 3, { '4,1': { height: 1 } });
    expect(hasLineOfSight(bump, c(0, 1), c(8, 1))).toBe(true);
  });

  it('sees down from a height over what would hide a creature on the ground', () => {
    const map = world('square', 9, 3, { '0,1': { height: 6 }, '4,1': { height: 2 } });
    expect(hasLineOfSight(map, c(0, 1), c(8, 1))).toBe(true);
    const low = world('square', 9, 3, { '4,1': { height: 2 } });
    expect(hasLineOfSight(low, c(0, 1), c(8, 1))).toBe(false);
  });

  it('on a square grid, slips past a corner if either way round is open', () => {
    // A diagonal step from (2,2) to (3,1) passes the corner between (2,1) and (3,2).
    const oneSide = world('square', 6, 4, {}, [[c(2, 2), c(2, 1)]]);
    expect(hasLineOfSight(oneSide, c(2, 2), c(3, 1))).toBe(true);
    const bothSides = world('square', 6, 4, {}, [
      [c(2, 2), c(2, 1)],
      [c(2, 2), c(3, 2)],
    ]);
    expect(hasLineOfSight(bothSides, c(2, 2), c(3, 1))).toBe(false);
  });

  it('knows which objects block sight', () => {
    expect(objectInfo('tree')?.blocksSight).toBe(true);
    expect(objectInfo('boulder')?.blocksSight).toBe(true);
    expect(objectInfo('crate')?.blocksSight).toBe(false);
    expect(objectInfo('flowers')?.blocksSight).toBe(false);
  });
});

describe('visibleCells', () => {
  it('is everything in sight within range, including where the viewer stands', () => {
    const map = world('square', 9, 5, {}, [[c(4, 2), c(5, 2)]]);
    const seen = new Set(visibleCells(map, c(2, 2), 3).map(cellKey));
    expect(seen.has('2,2')).toBe(true);
    expect(seen.has('4,2')).toBe(true);
    expect(seen.has('5,2')).toBe(false); // behind the wall
    expect(seen.has('6,0')).toBe(false); // out of range
    for (const key of seen) {
      const [q, r] = key.split(',').map(Number);
      expect(map.grid.distance(c(2, 2), c(q!, r!))).toBeLessThanOrEqual(3);
    }
  });
});

describe('sightOf (fog of war)', () => {
  it('is what any of the viewers can see together, within the vision range', () => {
    const map = world('square', 30, 3, {}, [[c(4, 1), c(5, 1)]]);
    const one = new Set(sightOf(map, [c(0, 1)], VISION_RANGE));
    const two = new Set(sightOf(map, [c(0, 1), c(20, 1)], VISION_RANGE));
    expect(one.has('3,1')).toBe(true);
    expect(one.has('5,1')).toBe(false); // behind the wall
    expect(two.has('22,1')).toBe(true); // seen by the second viewer
    expect(two.size).toBeGreaterThan(one.size);
  });

  it('sees nothing without viewers', () => {
    expect(sightOf(world('hex', 4, 4), [], VISION_RANGE)).toEqual([]);
  });
});
