import { type GridKind, createGrid } from '../grid';
import { MAP_FORMAT_VERSION, MAX_HEIGHT, MAX_TILES, type MapData, MapError, type TileData, createWorldMap, rectangleTiles } from '../map';
import { seededRandom } from '../random';

/** Procedural maps from seeded value noise: the same seed always makes the same map. */

export type GeneratePreset = 'flat' | 'hills' | 'islands';

export interface GenerateOptions {
  readonly grid: GridKind;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly preset: GeneratePreset;
  /** Highest terrain level; defaults to 6, capped at MAX_HEIGHT. */
  readonly maxHeight?: number;
}

/** Feature size in tiles: bigger means broader, gentler hills. */
const WAVELENGTH = 16;
const OCTAVES = 3;
const LATTICE = 256;

/** Smooth 2D value noise in [0, 1], with a few octaves of finer detail. */
function noiseField(seed: number): (x: number, z: number) => number {
  const random = seededRandom(seed);
  const values = Array.from({ length: LATTICE }, () => random.nextInt(1_000_000) / 1_000_000);
  const permutation = Array.from({ length: LATTICE }, (_, i) => i);
  for (let i = LATTICE - 1; i > 0; i--) {
    const j = random.nextInt(i + 1);
    [permutation[i], permutation[j]] = [permutation[j] as number, permutation[i] as number];
  }
  const hash = (ix: number, iz: number) => {
    const a = permutation[((ix % LATTICE) + LATTICE) % LATTICE] as number;
    return values[(((a + iz) % LATTICE) + LATTICE) % LATTICE] as number;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const octave = (x: number, z: number) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = smooth(x - ix);
    const fz = smooth(z - iz);
    return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), fx), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx), fz);
  };
  return (x, z) => {
    let total = 0;
    let amplitude = 1;
    let frequency = 1 / WAVELENGTH;
    let norm = 0;
    for (let i = 0; i < OCTAVES; i++) {
      total += octave(x * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude /= 2;
      frequency *= 2;
    }
    return total / norm;
  };
}

/** Rescales values to fill [0, 1]. */
function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values.map((value) => (max > min ? (value - min) / (max - min) : 0));
}

export function generateMap(options: GenerateOptions): MapData {
  const { grid: kind, width, height, seed, preset } = options;
  if (width * height > MAX_TILES) throw new MapError(`A map can have at most ${MAX_TILES} tiles`);
  const maxHeight = Math.max(1, Math.min(MAX_HEIGHT, Math.round(options.maxHeight ?? 6)));
  const grid = createGrid(kind);
  const cells = rectangleTiles(kind, width, height);
  const points = cells.map((cell) => grid.toWorld(cell, 1));
  const noise = noiseField(seed);

  let tiles: TileData[];
  switch (preset) {
    case 'flat':
      tiles = cells.map((cell) => ({ ...cell, height: 0, terrain: 'grass' }));
      break;

    case 'hills': {
      const levels = normalize(points.map((p) => noise(p.x, p.z)));
      tiles = cells.map((cell, i) => {
        const level = Math.round((levels[i] as number) * maxHeight);
        return { ...cell, height: level, terrain: level >= Math.ceil(maxHeight * 0.75) ? 'stone' : 'grass' };
      });
      break;
    }

    case 'islands': {
      // Noise plus a falloff toward the edge, so the border is always sea.
      const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const cz = points.reduce((sum, p) => sum + p.z, 0) / points.length;
      const radius = Math.max(...points.map((p) => Math.hypot(p.x - cx, p.z - cz)));
      const SEA = 0.55;
      const land = points.map((p) => 0.5 * noise(p.x, p.z) + 0.5 * (1 - Math.hypot(p.x - cx, p.z - cz) / radius));
      const peak = Math.max(...land, SEA + 0.01);
      tiles = cells.map((cell, i) => {
        const value = land[i] as number;
        if (value <= SEA) return { ...cell, height: 0, terrain: 'water', blocked: true };
        const level = 1 + Math.round(((value - SEA) / (peak - SEA)) * (maxHeight - 1));
        const terrain = level === 1 ? 'sand' : level >= Math.ceil(maxHeight * 0.75) ? 'stone' : 'grass';
        return { ...cell, height: level, terrain };
      });
      break;
    }
  }

  return createWorldMap({ formatVersion: MAP_FORMAT_VERSION, grid: kind, tiles, walls: [] }).toData();
}
