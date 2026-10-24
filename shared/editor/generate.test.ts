import { describe, expect, it } from 'vitest';
import { type GridKind, cellKey, createGrid } from '../grid';
import { MAX_HEIGHT, type MapData, createWorldMap } from '../map';
import { generateMap } from './index';

// Procedural maps: seeded noise, so a seed is a shareable, repeatable map.

const options = (overrides: Partial<Parameters<typeof generateMap>[0]> = {}) => ({
  grid: 'hex' as GridKind,
  width: 20,
  height: 16,
  seed: 42,
  preset: 'hills' as const,
  ...overrides,
});

function neighborSteps(map: MapData): number[] {
  const world = createWorldMap(map);
  const heights = new Map(map.tiles.map((tile) => [cellKey(tile), tile.height]));
  const steps: number[] = [];
  for (const tile of map.tiles) {
    for (const neighbor of world.grid.neighbors(tile)) {
      const other = heights.get(cellKey(neighbor));
      if (other !== undefined) steps.push(Math.abs(other - tile.height));
    }
  }
  return steps;
}

describe('generateMap', () => {
  it('makes a valid map of the requested size and grid', () => {
    for (const grid of ['hex', 'square'] as const) {
      const map = generateMap(options({ grid }));
      expect(map.grid).toBe(grid);
      expect(map.tiles).toHaveLength(20 * 16);
      expect(createWorldMap(map).toData()).toEqual(map);
    }
  });

  it('repeats exactly for the same seed and differs for another', () => {
    expect(generateMap(options())).toEqual(generateMap(options()));
    expect(generateMap(options({ seed: 43 }))).not.toEqual(generateMap(options()));
  });

  it('keeps heights between 0 and the chosen maximum', () => {
    const map = generateMap(options({ maxHeight: 6 }));
    expect(Math.min(...map.tiles.map((tile) => tile.height))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...map.tiles.map((tile) => tile.height))).toBeLessThanOrEqual(6);
    const tall = generateMap(options({ maxHeight: 999 }));
    expect(Math.max(...tall.tiles.map((tile) => tile.height))).toBeLessThanOrEqual(MAX_HEIGHT);
  });

  it('makes hills with real variety', () => {
    const heights = new Set(generateMap(options()).tiles.map((tile) => tile.height));
    expect(heights.size).toBeGreaterThanOrEqual(4);
  });

  it('makes smooth, walkable slopes rather than random spikes', () => {
    const steps = neighborSteps(generateMap(options()));
    const average = steps.reduce((sum, step) => sum + step, 0) / steps.length;
    expect(average).toBeLessThan(1);
    // Mostly steps a creature can walk (1) rather than cliffs.
    expect(steps.filter((step) => step <= 1).length / steps.length).toBeGreaterThan(0.85);
  });

  it('makes a flat field on the flat preset', () => {
    const map = generateMap(options({ preset: 'flat' }));
    expect(map.tiles.every((tile) => tile.height === 0 && tile.terrain === 'grass')).toBe(true);
  });

  it('surrounds islands with impassable water', () => {
    const map = generateMap(options({ preset: 'islands', width: 30, height: 30 }));
    const water = map.tiles.filter((tile) => tile.terrain === 'water');
    expect(water.length).toBeGreaterThan(map.tiles.length * 0.2);
    expect(water.every((tile) => tile.blocked === true && tile.height === 0)).toBe(true);
    expect(map.tiles.some((tile) => tile.terrain === 'grass')).toBe(true);
    // The map's border is sea.
    const grid = createGrid('hex');
    const center = map.tiles.reduce((acc, tile) => {
      const p = grid.toWorld(tile, 1);
      return { x: acc.x + p.x / map.tiles.length, z: acc.z + p.z / map.tiles.length };
    }, { x: 0, z: 0 });
    const far = [...map.tiles]
      .sort((a, b) => {
        const pa = grid.toWorld(a, 1);
        const pb = grid.toWorld(b, 1);
        return Math.hypot(pb.x - center.x, pb.z - center.z) - Math.hypot(pa.x - center.x, pa.z - center.z);
      })
      .slice(0, 20);
    expect(far.every((tile) => tile.terrain === 'water')).toBe(true);
  });

  it('picks terrain by height on hills: stone on the peaks', () => {
    const map = generateMap(options({ maxHeight: 8 }));
    const top = Math.max(...map.tiles.map((tile) => tile.height));
    expect(map.tiles.filter((tile) => tile.height === top).every((tile) => tile.terrain === 'stone')).toBe(true);
  });

  it('rejects sizes past the tile limit', () => {
    expect(() => generateMap(options({ width: 101, height: 100 }))).toThrow();
  });
});
