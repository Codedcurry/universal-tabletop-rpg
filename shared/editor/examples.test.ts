import { describe, expect, it } from 'vitest';
import { cellKey } from '../grid';
import { MAX_TILES, createWorldMap, objectInfo, validateMapData } from '../map';
import { reachable } from '../movement';
import { skirmish } from '../system/samples/skirmish';
import { EXAMPLE_MAPS, exampleMap } from './examples';

// Ready-made example maps (small, medium, large) that show what maps can
// hold: terrain, height, solid tiles, walls, water, on both grid types.

const SIZES = { small: [60, 200], medium: [201, 700], large: [701, MAX_TILES] } as const;

describe('example maps', () => {
  it('come in every size, on both grid types', () => {
    expect(new Set(EXAMPLE_MAPS.map((example) => example.size))).toEqual(new Set(['small', 'medium', 'large']));
    expect(new Set(EXAMPLE_MAPS.map((example) => exampleMap(example.id).grid))).toEqual(new Set(['hex', 'square']));
    for (const example of EXAMPLE_MAPS) {
      expect(example.name.length).toBeGreaterThan(0);
      expect(example.description.length).toBeGreaterThan(10);
    }
  });

  for (const example of EXAMPLE_MAPS) {
    describe(example.name, () => {
      const map = exampleMap(example.id);

      it('is a valid map of its size', () => {
        expect(validateMapData(map)).toEqual({ ok: true, map });
        const [min, max] = SIZES[example.size];
        expect(map.tiles.length).toBeGreaterThanOrEqual(min);
        expect(map.tiles.length).toBeLessThanOrEqual(max);
      });

      it('shows off what maps can hold: terrain, height, solid tiles, walls, water', () => {
        const terrains = new Set(map.tiles.map((tile) => tile.terrain ?? 'grass'));
        expect(terrains.size).toBeGreaterThanOrEqual(4);
        expect(terrains.has('water')).toBe(true);
        const heights = map.tiles.map((tile) => tile.height);
        expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThanOrEqual(3);
        expect(map.tiles.filter((tile) => tile.blocked).length).toBeGreaterThanOrEqual(5);
        expect(map.walls.length).toBeGreaterThanOrEqual(6);
      });

      it('is dressed with objects, natural and built', () => {
        const objects = map.tiles.flatMap((tile) => (tile.object ? [tile.object] : []));
        expect(new Set(objects).size).toBeGreaterThanOrEqual(5);
        const categories = new Set(objects.map((id) => objectInfo(id)?.category));
        expect(categories).toEqual(new Set(['nature', 'built']));
        // Solid exactly where a blocking object stands (or for terrain like deep water).
        for (const tile of map.tiles.filter((entry) => entry.object)) {
          expect(tile.blocked === true, `${tile.object} at ${tile.q},${tile.r}`).toBe(objectInfo(tile.object!)?.blocks);
        }
      });

      it('has no stranded ground: every open tile can be walked to from every other', () => {
        const world = createWorldMap(map);
        const open = map.tiles.filter((tile) => !tile.blocked);
        const start = open[0]!;
        const reached = reachable({ map: world, rules: skirmish.movement }, start, Number.POSITIVE_INFINITY);
        const stranded = open.filter((tile) => !reached.has(cellKey(tile)) && cellKey(tile) !== cellKey(start));
        expect(stranded.map(cellKey)).toEqual([]);
      });

      it('is the same every time', () => {
        expect(exampleMap(example.id)).toEqual(map);
      });
    });
  }

  it('refuses an unknown example', () => {
    expect(() => exampleMap('atlantis')).toThrow(/atlantis/);
  });
});
