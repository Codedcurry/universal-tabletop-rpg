import { describe, expect, it } from 'vitest';
import { EMPTY_ART, MAX_IMAGE_CHARS, MAX_IMAGE_SIDE, tileWarnings, validateCustomArt, withCharacter, withTile } from './art';

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

describe('character art', () => {
  const layout = {
    frameSize: 16,
    clips: {
      idle: {
        down: { row: 0, frames: 2, mirror: false },
        left: { row: 1, frames: 2, mirror: false },
        right: { row: 1, frames: 2, mirror: true },
        up: { row: 3, frames: 2, mirror: false },
      },
    },
  };
  const character = { image: tile(32, 64), layout, token: tile(24, 24) };

  it('adds (and removes) a character\'s sprite sheet and token, by art key', () => {
    const art = withCharacter(EMPTY_ART, 'goblin', character);
    expect(art.characters.goblin).toEqual(character);
    expect(validateCustomArt(JSON.parse(JSON.stringify(art)))).toEqual({ ok: true, art });
    expect(withCharacter(art, 'goblin', null).characters).toEqual({});
  });

  it('keeps animation speeds and the body size', () => {
    const art = withCharacter(EMPTY_ART, 'goblin', { ...character, layout: { ...layout, bodySize: 12, fps: { idle: 4 } } });
    expect(validateCustomArt(JSON.parse(JSON.stringify(art)))).toEqual({ ok: true, art });
  });

  it.each<[string, unknown]>([
    ['a row past the bottom of the sheet', { ...layout, clips: { idle: { ...layout.clips.idle, up: { row: 4, frames: 2, mirror: false } } } }],
    ['more frames than the sheet is wide', { ...layout, clips: { idle: { ...layout.clips.idle, down: { row: 0, frames: 3, mirror: false } } } }],
    ['an animation that doesn\'t exist', { ...layout, clips: { ...layout.clips, dance: layout.clips.idle } }],
    ['no idle animation', { ...layout, clips: {} }],
    ['an animation speed out of range', { ...layout, fps: { idle: 0 } }],
    ['a body taller than the frames', { ...layout, bodySize: 17 }],
  ])('refuses a layout with %s', (_name, badLayout) => {
    const art = { ...EMPTY_ART, characters: { goblin: { ...character, layout: badLayout } } };
    expect(validateCustomArt(art).ok).toBe(false);
  });
});
