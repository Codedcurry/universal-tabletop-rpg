import { describe, expect, it } from 'vitest';
import { PIXEL_TILE_SIZE, PIXEL_TILE_VARIANTS, pixelTile, tileSideColor } from './pixelTiles';

// The HD-2D pack's tile art: small pixel-art textures drawn in code (no
// image files), a few variants per terrain so fields don't look stamped.

const colors = (pixels: Uint8ClampedArray) => {
  const seen = new Set<string>();
  for (let i = 0; i < pixels.length; i += 4) seen.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`);
  return seen;
};

describe('pixelTile', () => {
  const terrains = ['grass', 'dirt', 'sand', 'stone', 'water', 'snow', 'wood'];

  it.each(terrains)('%s is a full, opaque square of pixels', (terrain) => {
    const pixels = pixelTile(terrain, 0);
    expect(pixels).toHaveLength(PIXEL_TILE_SIZE * PIXEL_TILE_SIZE * 4);
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
  });

  it.each(terrains)('%s keeps to a small palette, like real pixel art', (terrain) => {
    const used = colors(pixelTile(terrain, 1)).size;
    expect(used).toBeGreaterThanOrEqual(3); // some texture, not a flat fill
    expect(used).toBeLessThanOrEqual(8);
  });

  it('is the same every time, and the variants differ', () => {
    expect(pixelTile('grass', 2)).toEqual(pixelTile('grass', 2));
    const variants = Array.from({ length: PIXEL_TILE_VARIANTS }, (_, variant) => pixelTile('grass', variant).join(','));
    expect(new Set(variants).size).toBe(PIXEL_TILE_VARIANTS);
  });

  it('looks different for each terrain', () => {
    expect(new Set(terrains.map((terrain) => pixelTile(terrain, 0).join(','))).size).toBe(terrains.length);
  });

  it('draws something for a terrain it has no look for', () => {
    expect(pixelTile('lava', 0)).toHaveLength(PIXEL_TILE_SIZE * PIXEL_TILE_SIZE * 4);
  });

  it('gives each terrain a side color darker than its top', () => {
    for (const terrain of terrains) {
      const top = pixelTile(terrain, 0);
      let brightness = 0;
      for (let i = 0; i < top.length; i += 4) brightness += top[i]! + top[i + 1]! + top[i + 2]!;
      brightness /= top.length / 4;
      const side = tileSideColor(terrain);
      expect(side[0] + side[1] + side[2]).toBeLessThan(brightness);
    }
  });
});
