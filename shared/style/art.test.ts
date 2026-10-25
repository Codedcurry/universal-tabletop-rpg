import { describe, expect, it } from 'vitest';
import { EMPTY_ART, MAX_IMAGE_CHARS, MAX_IMAGE_SIDE, tileWarnings, validateCustomArt, withTile } from './art';

// The DM's own art for a game (tile textures now; characters later): plain,
// checked data that is saved with the game and sent to every player.

const png = (chars = 200) => `data:image/png;base64,${'A'.repeat(chars)}`;
const tile = (width = 16, height = 16, dataUrl = png()) => ({ dataUrl, width, height });

describe('custom art', () => {
  it('starts empty, and gains (or drops) a tile per terrain', () => {
    const art = withTile(EMPTY_ART, 'grass', tile());
    expect(Object.keys(art.tiles)).toEqual(['grass']);
    expect(withTile(art, 'grass', null).tiles).toEqual({});
    expect(EMPTY_ART.tiles).toEqual({}); // unchanged
  });

  it('checks out when it is well formed', () => {
    const art = withTile(withTile(EMPTY_ART, 'grass', tile()), 'stone', tile(32, 32));
    expect(validateCustomArt(JSON.parse(JSON.stringify(art)))).toEqual({ ok: true, art });
  });

  it.each<[string, unknown]>([
    ['something else', { hello: 1 }],
    ['an image that is not a data URL', { ...EMPTY_ART, tiles: { grass: tile(16, 16, 'https://example.com/grass.png') } }],
    ['a non-image data URL', { ...EMPTY_ART, tiles: { grass: tile(16, 16, 'data:text/html;base64,AAAA') } }],
    ['an image too big to send', { ...EMPTY_ART, tiles: { grass: tile(16, 16, png(MAX_IMAGE_CHARS)) } }],
    ['an image too large across', { ...EMPTY_ART, tiles: { grass: tile(MAX_IMAGE_SIDE + 1, 16) } }],
    ['a bad terrain id', { ...EMPTY_ART, tiles: { 'Grass!': tile() } }],
  ])('refuses %s', (_name, data) => {
    expect(validateCustomArt(data).ok).toBe(false);
  });
});

describe('tileWarnings', () => {
  it('is happy with small square pixel art', () => {
    expect(tileWarnings(16, 16)).toEqual([]);
    expect(tileWarnings(32, 32)).toEqual([]);
  });

  it('warns about a tile that is not square', () => {
    expect(tileWarnings(32, 16).join(' ')).toMatch(/square/i);
  });

  it('warns about odd sizes and very large images', () => {
    expect(tileWarnings(20, 20).join(' ')).toMatch(/16, 32, or 64/);
    expect(tileWarnings(512, 512).join(' ')).toMatch(/large/i);
  });
});
