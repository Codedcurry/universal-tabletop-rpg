import { describe, expect, it } from 'vitest';
import { type Cell, type GridKind, cellKey } from '../grid';
import { type MapData, type TileData, type WallData, createWorldMap, rectangleTiles } from '../map';
import { type MovementContext, type MovementRules, type Occupant, findPath, reachable, stepCost } from './index';

const c = (q: number, r: number): Cell => ({ q, r });

const rules: MovementRules = { maxStepUp: 1, maxStepDown: 2, climb: { maxHeight: 3, costPerLevel: 1 } };
const noClimb: MovementRules = { maxStepUp: 1, maxStepDown: 2 };

interface MapOptions {
  width?: number;
  height?: number;
  heights?: Array<[Cell, number]>;
  blocked?: Cell[];
  walls?: WallData[];
}

function context(grid: GridKind, options: MapOptions = {}, extra: Partial<MovementContext> = {}): MovementContext {
  const heights = new Map((options.heights ?? []).map(([cell, h]) => [cellKey(cell), h]));
  const blocked = new Set((options.blocked ?? []).map(cellKey));
  const tiles: TileData[] = rectangleTiles(grid, options.width ?? 7, options.height ?? 7).map((cell) => ({
    ...cell,
    height: heights.get(cellKey(cell)) ?? 0,
    blocked: blocked.has(cellKey(cell)),
  }));
  const data: MapData = { formatVersion: 1, grid, tiles, walls: options.walls ?? [] };
  return { map: createWorldMap(data), rules, ...extra };
}

function occupants(entries: Array<[Cell, Occupant]>): ReadonlyMap<string, Occupant> {
  return new Map(entries.map(([cell, occupant]) => [cellKey(cell), occupant]));
}

// Neighbor pairs that exist on both grid types (and inside a 7x7 rectangle).
const from = c(3, 3);
const east = c(4, 3);
const farEast = c(5, 3);

describe.each<GridKind>(['hex', 'square'])('movement on a %s grid', (grid) => {
  describe('stepCost', () => {
    it('costs 1 to step onto a flat neighbor', () => {
      expect(stepCost(context(grid), from, east)).toBe(1);
    });

    it('refuses cells that are not neighbors', () => {
      expect(stepCost(context(grid), from, c(5, 3))).toBeNull();
      expect(stepCost(context(grid), from, from)).toBeNull();
    });

    it('refuses to leave the world', () => {
      expect(stepCost(context(grid), c(0, 0), c(-1, 0))).toBeNull();
    });

    it('refuses blocked tiles', () => {
      expect(stepCost(context(grid, { blocked: [east] }), from, east)).toBeNull();
    });

    it('refuses to cross a wall, in either direction', () => {
      const ctx = context(grid, { walls: [[from, east]] });
      expect(stepCost(ctx, from, east)).toBeNull();
      expect(stepCost(ctx, east, from)).toBeNull();
    });

    it('walks up a small step', () => {
      expect(stepCost(context(grid, { heights: [[east, 1]] }), from, east)).toBe(1);
    });

    it('climbs higher steps at extra cost, up to the climb limit', () => {
      expect(stepCost(context(grid, { heights: [[east, 2]] }), from, east)).toBe(2);
      expect(stepCost(context(grid, { heights: [[east, 3]] }), from, east)).toBe(3);
      expect(stepCost(context(grid, { heights: [[east, 4]] }), from, east)).toBeNull();
    });

    it('cannot climb at all without climbing rules', () => {
      expect(stepCost(context(grid, { heights: [[east, 2]] }, { rules: noClimb }), from, east)).toBeNull();
    });

    it('steps down within the drop limit only', () => {
      expect(stepCost(context(grid, { heights: [[from, 2]] }), from, east)).toBe(1);
      expect(stepCost(context(grid, { heights: [[from, 3]] }), from, east)).toBeNull();
    });

    it('cannot enter an enemy but can pass an ally', () => {
      expect(stepCost(context(grid, {}, { occupants: occupants([[east, 'enemy']]) }), from, east)).toBeNull();
      expect(stepCost(context(grid, {}, { occupants: occupants([[east, 'ally']]) }), from, east)).toBe(1);
    });
  });

  describe('reachable', () => {
    it('finds every cell within the budget on open ground, excluding the start', () => {
      const ctx = context(grid);
      const cells = reachable(ctx, from, 2);
      const expected = ctx.map.grid.range(from, 2).length - 1;
      expect(cells.size).toBe(expected);
      expect(cells.has(cellKey(from))).toBe(false);
      for (const entry of cells.values()) expect(entry.cost).toBeLessThanOrEqual(2);
    });

    it('gives each cell a valid cheapest path', () => {
      const ctx = context(grid, { heights: [[east, 2]] });
      for (const entry of reachable(ctx, from, 3).values()) {
        expect(entry.path[0]).toEqual(from);
        expect(entry.path[entry.path.length - 1]).toEqual(entry.cell);
        let total = 0;
        for (let i = 1; i < entry.path.length; i++) {
          const cost = stepCost(ctx, entry.path[i - 1] as Cell, entry.path[i] as Cell);
          expect(cost).not.toBeNull();
          total += cost as number;
        }
        expect(total).toBe(entry.cost);
      }
    });

    it('returns nothing with a zero budget', () => {
      expect(reachable(context(grid), from, 0).size).toBe(0);
    });

    it('passes through allies but never stops on them', () => {
      const ctx = context(grid, { width: 5, height: 1 }, { occupants: occupants([[c(1, 0), 'ally']]) });
      const cells = reachable(ctx, c(0, 0), 3);
      expect(cells.has(cellKey(c(1, 0)))).toBe(false);
      expect(cells.get(cellKey(c(3, 0)))?.cost).toBe(3);
    });

    it('is stopped by enemies', () => {
      const ctx = context(grid, { width: 5, height: 1 }, { occupants: occupants([[c(1, 0), 'enemy']]) });
      expect(reachable(ctx, c(0, 0), 4).size).toBe(0);
    });
  });

  describe('findPath', () => {
    it('finds a straight path on open ground', () => {
      const result = findPath(context(grid), from, farEast);
      expect(result?.cost).toBe(2);
      expect(result?.path).toEqual([from, east, farEast]);
    });

    it('returns just the start for a zero-length move', () => {
      expect(findPath(context(grid), from, from)).toEqual({ path: [from], cost: 0 });
    });

    it('respects the budget', () => {
      expect(findPath(context(grid), from, farEast, 1)).toBeNull();
      expect(findPath(context(grid), from, farEast, 2)?.cost).toBe(2);
    });

    it('refuses destinations it cannot stop on', () => {
      const ctx = context(grid, {}, { occupants: occupants([[east, 'ally']]) });
      expect(findPath(ctx, from, east)).toBeNull();
      expect(findPath(context(grid, { blocked: [east] }), from, east)).toBeNull();
      expect(findPath(context(grid), from, c(20, 20))).toBeNull();
    });

    it('is deterministic', () => {
      const ctx = context(grid, { blocked: [c(4, 3), c(4, 2)] });
      expect(findPath(ctx, from, farEast)).not.toBeNull();
      expect(findPath(ctx, from, farEast)).toEqual(findPath(ctx, from, farEast));
    });

    it('goes around a cliff it cannot cross', () => {
      // East is too high to climb onto cheaply and too high to step down from.
      const result = findPath(context(grid, { heights: [[east, 3]] }), from, farEast);
      expect(result?.path).not.toContainEqual(east);
      expect(result?.cost).toBe(grid === 'hex' ? 3 : 2);
    });
  });
});

describe('hex specifics', () => {
  it('walks around a single wall in two steps', () => {
    const ctx = context('hex', { walls: [[c(3, 3), c(4, 3)]] });
    expect(findPath(ctx, c(3, 3), c(4, 3))?.cost).toBe(2);
  });
});

describe('square specifics', () => {
  it('moves diagonally for the cost of one step', () => {
    expect(stepCost(context('square'), c(3, 3), c(4, 4))).toBe(1);
  });

  it('cannot cut the corner of a blocked tile', () => {
    expect(stepCost(context('square', { blocked: [c(4, 3)] }), c(3, 3), c(4, 4))).toBeNull();
    expect(stepCost(context('square', { blocked: [c(3, 4)] }), c(3, 3), c(4, 4))).toBeNull();
  });

  it('cannot squeeze diagonally past the end of a wall', () => {
    expect(stepCost(context('square', { walls: [[c(3, 3), c(4, 3)]] }), c(3, 3), c(4, 4))).toBeNull();
    expect(stepCost(context('square', { walls: [[c(4, 3), c(4, 4)]] }), c(3, 3), c(4, 4))).toBeNull();
  });

  it('walks around a single wall segment without cutting its ends', () => {
    const ctx = context('square', { walls: [[c(3, 3), c(4, 3)]] });
    expect(findPath(ctx, c(3, 3), c(4, 3))?.cost).toBe(3);
  });
});
