import { describe, expect, it } from 'vitest';
import { cell } from '../grid';
import { enlargeMap, largestEnlargement } from './enlarge';
import { MAP_FORMAT_VERSION, MAX_TILES, type MapData, createWorldMap } from './index';

// Making a map from a book bigger: each square as 2 by 2 (or 3 by 3) tiles.

const map: MapData = {
  formatVersion: MAP_FORMAT_VERSION,
  grid: 'square',
  tiles: [
    { q: 0, r: 0, height: 2, blocked: true, terrain: 'stone' },
    { q: 1, r: 0, height: 0, terrain: 'water', blocked: true },
    { q: 0, r: 1, height: 0, object: 'crate', blocked: true },
    { q: 1, r: 1, height: 1 },
  ],
  walls: [[cell(0, 1), cell(1, 1)]],
  backdrop: { image: 'data:image/jpeg;base64,AAAA', width: 2, height: 2 },
};

describe('enlargeMap', () => {
  it('makes each square k by k tiles, walls run the whole side, the art stretches, objects stay one tile', () => {
    const big = createWorldMap(enlargeMap(map, 3)).toData();
    expect(big.tiles).toHaveLength(36);
    const at = (q: number, r: number) => big.tiles.find((tile) => tile.q === q && tile.r === r);
    // Rock and water are solid everywhere in their square.
    expect([at(0, 0), at(2, 2)].every((tile) => tile?.blocked && tile.terrain === 'stone' && tile.height === 2)).toBe(true);
    expect(at(5, 0)).toMatchObject({ terrain: 'water', blocked: true });
    // The crate: one tile, in the middle of its old square; the rest of the square is open.
    expect(big.tiles.filter((tile) => tile.object === 'crate')).toEqual([{ q: 1, r: 4, height: 0, terrain: 'grass', object: 'crate', blocked: true }]);
    expect(at(0, 3)?.blocked).toBeUndefined();
    // The wall between (0, 1) and (1, 1): three wall pieces, between columns 2 and 3.
    expect(big.walls).toEqual([0, 1, 2].map((step) => [cell(2, 3 + step), cell(3, 3 + step)]));
    expect(big.backdrop).toMatchObject({ width: 6, height: 6 });
  });

  it('leaves a hex map, or a factor of 1, as it is; and keeps within the tile limit', () => {
    expect(enlargeMap({ ...map, grid: 'hex' }, 2)).toEqual({ ...map, grid: 'hex' });
    expect(enlargeMap(map, 1)).toBe(map);
    const huge = { ...map, tiles: Array.from({ length: Math.floor(MAX_TILES / 3) }, (_, q) => ({ q, r: 0, height: 0 })) };
    expect(largestEnlargement(huge, 3)).toBe(1);
    expect(largestEnlargement(map, 3)).toBe(3);
  });
});
