import { seededRandom } from '../random';

/**
 * The HD-2D pack's tile art: small pixel-art textures drawn in code, so the
 * first real style pack needs no image files. Each terrain has its own small
 * palette and pattern (grass blades, cobbles, planks...), and a few variants
 * so a field doesn't look stamped. Pure: RGBA pixels, no browser needed.
 */

export const PIXEL_TILE_SIZE = 16;
export const PIXEL_TILE_VARIANTS = 4;

type Rgb = readonly [number, number, number];

const hex = (value: string): Rgb => [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];

/** Each terrain's palette: the first color is its base (and gives the tile's side color). */
const PALETTES: Readonly<Record<string, readonly Rgb[]>> = {
  grass: ['#5f9e4a', '#6aad52', '#4f8a3e', '#7cc25e', '#3f7432', '#f2d24a', '#f4f0e8'].map(hex),
  dirt: ['#8a6a45', '#977552', '#7a5c3a', '#a3825e', '#5f4a32'].map(hex),
  sand: ['#d8c48a', '#e2d09a', '#cbb67a', '#efe0b0', '#b9a46a'].map(hex),
  stone: ['#8d8a93', '#9c99a2', '#7e7b84', '#adaab3', '#5d5a63'].map(hex),
  water: ['#3f78b5', '#4a86c4', '#356aa3', '#8fc0ea', '#2d5d92'].map(hex),
  snow: ['#e8eef2', '#f6f9fb', '#d6e0e8', '#c4d2de'].map(hex),
  wood: ['#a0703c', '#ad7c46', '#8f6232', '#6e4a24', '#c8a070'].map(hex),
};
const UNKNOWN: readonly Rgb[] = ['#c04fc0', '#2a1a2a'].map(hex);

function seedOf(terrain: string, variant: number): number {
  let hash = 2166136261;
  for (const char of `${terrain}:${variant}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** A 16x16 pixel-art tile top for a terrain, as RGBA bytes (row by row). */
export function pixelTile(terrain: string, variant: number): Uint8ClampedArray<ArrayBuffer> {
  const size = PIXEL_TILE_SIZE;
  const palette = PALETTES[terrain] ?? UNKNOWN;
  const random = seededRandom(seedOf(terrain, variant));
  const chance = (percent: number) => random.nextInt(100) < percent;
  const grid: number[] = new Array<number>(size * size).fill(0);
  const set = (x: number, y: number, color: number) => {
    grid[((y + size) % size) * size + ((x + size) % size)] = color;
  };

  // A base of the main color, lightly mottled with its neighbors.
  for (let i = 0; i < grid.length; i++) grid[i] = chance(70) ? 0 : chance(50) ? 1 : 2;

  switch (terrain) {
    case 'grass':
      // Blades: short light strokes with a dark root; now and then a flower.
      for (let blade = 0; blade < 14; blade++) {
        const x = random.nextInt(size);
        const y = random.nextInt(size);
        set(x, y, 3);
        set(x, y + 1, 1);
        set(x, y + 2, 4);
      }
      if (variant % 2 === 1) for (let flower = 0; flower < 2; flower++) set(random.nextInt(size), random.nextInt(size), 5 + random.nextInt(2));
      break;
    case 'dirt':
      for (let pebble = 0; pebble < 6; pebble++) {
        const x = random.nextInt(size);
        const y = random.nextInt(size);
        set(x, y, 3);
        set(x + 1, y + 1, 4);
      }
      break;
    case 'sand':
      // Wind ripples: gentle diagonal lines.
      for (let ripple = 0; ripple < 3; ripple++) {
        const y0 = random.nextInt(size);
        for (let x = 0; x < size; x++) set(x, y0 + Math.floor(x / 4), x % 4 === 0 ? 4 : 3);
      }
      break;
    case 'stone': {
      // Cobbles: rows of stones, every other row shifted, dark joints between.
      const rows = 4;
      const height = size / rows;
      for (let row = 0; row < rows; row++) {
        const shift = row % 2 === 0 ? 0 : 4 + random.nextInt(2);
        for (let x = 0; x < size; x++) set(x, row * height, 4);
        for (let x = shift; x < size + shift; x += 8) for (let y = 0; y < height; y++) set(x, row * height + y, 4);
        for (let x = 0; x < size; x++) if (chance(20)) set(x, row * height + 1, 3);
      }
      break;
    }
    case 'water':
      // Little wave highlights.
      for (let wave = 0; wave < 5; wave++) {
        const x = random.nextInt(size);
        const y = random.nextInt(size);
        set(x, y, 3);
        set(x + 1, y, 3);
        set(x + 2, y + 1, 1);
        set(x - 1, y + 1, 4);
      }
      break;
    case 'snow':
      for (let shadow = 0; shadow < 8; shadow++) {
        const x = random.nextInt(size);
        const y = random.nextInt(size);
        set(x, y, 2);
        if (chance(50)) set(x + 1, y, 3);
      }
      break;
    case 'wood': {
      // Planks across, dark seams between, grain along, and a nail at each end.
      const plank = 4;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (y % plank === plank - 1) set(x, y, 3);
          else if (chance(12)) set(x, y, 2);
        }
      }
      for (let y = 1; y < size; y += plank) {
        set(1, y, 4);
        set(size - 2, y, 4);
      }
      break;
    }
    default:
      // Unknown terrain: a plain checker, plainly a placeholder.
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) grid[y * size + x] = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
  }

  const pixels = new Uint8ClampedArray(size * size * 4);
  grid.forEach((index, i) => {
    const [r, g, b] = palette[Math.min(index, palette.length - 1)] as Rgb;
    pixels.set([r, g, b, 255], i * 4);
  });
  return pixels;
}

/** The color for the sides of a terrain's tiles: its base, in shadow. */
export function tileSideColor(terrain: string): Rgb {
  const [r, g, b] = (PALETTES[terrain] ?? UNKNOWN)[0] as Rgb;
  return [Math.round(r * 0.62), Math.round(g * 0.62), Math.round(b * 0.62)];
}
