import { cell } from '../grid';
import { type MapData, MAX_TILES, type TileData, type WallData } from './index';

/**
 * A square map made bigger: each square becomes `factor` by `factor` tiles
 * (a book's 5-foot squares as room to move about in). Ground, rock, water,
 * and heights are copied to every new tile; a wall along a square's side runs
 * the whole new side; the map's art is stretched to match. Each object stays
 * one tile, in the middle of its old square (a statue doesn't grow).
 */
export function enlargeMap(map: MapData, factor: number): MapData {
  if (map.grid !== 'square' || factor <= 1) return map;
  const k = Math.round(factor);
  const middle = Math.floor(k / 2);
  const tiles: TileData[] = [];
  for (const tile of map.tiles) {
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < k; i++) {
        const centre = i === middle && j === middle;
        const { object, blocked, ...rest } = tile;
        // A tile solid only for its object (a crate) isn't solid around it.
        const solid = blocked === true && (centre || !object);
        tiles.push({ ...rest, q: tile.q * k + i, r: tile.r * k + j, ...(solid ? { blocked: true } : {}), ...(centre && object ? { object } : {}) });
      }
    }
  }
  const walls: WallData[] = map.walls.flatMap(([a, b]): WallData[] => {
    const [from, to] = a.q + a.r <= b.q + b.r ? [a, b] : [b, a];
    // Along x (east of `from`), or along y (south of it).
    return Array.from({ length: k }, (_, step): WallData =>
      to.q > from.q ? [cell(from.q * k + k - 1, from.r * k + step), cell(to.q * k, to.r * k + step)] : [cell(from.q * k + step, from.r * k + k - 1), cell(to.q * k + step, to.r * k)],
    );
  });
  return {
    ...map,
    tiles,
    walls,
    ...(map.backdrop ? { backdrop: { ...map.backdrop, width: map.backdrop.width * k, height: map.backdrop.height * k } } : {}),
  };
}

/** The largest factor a map can be enlarged by and stay within the tile limit (1 if it can't grow). */
export function largestEnlargement(map: MapData, wanted: number): number {
  if (map.grid !== 'square') return 1;
  let factor = Math.max(1, Math.round(wanted));
  while (factor > 1 && map.tiles.length * factor * factor > MAX_TILES) factor--;
  return factor;
}
