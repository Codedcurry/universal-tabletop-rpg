import { describe, expect, it } from 'vitest';
import { placeholderStyle } from './stylePack';
import { STYLE_PACKS, packColor, stylePackFor } from './stylePacks';

describe('style packs', () => {
  it('each has a look for everything the usual one has, in other colours', () => {
    for (const pack of STYLE_PACKS.slice(1)) {
      expect(Object.keys(pack.terrain)).toEqual(Object.keys(placeholderStyle.terrain));
      expect(Object.keys(pack.objects)).toEqual(Object.keys(placeholderStyle.objects));
      expect(pack.terrain.grass?.color).not.toBe(placeholderStyle.terrain.grass?.color);
      for (const look of Object.values(pack.terrain)) expect(look.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(STYLE_PACKS.map((entry) => entry.id)).size).toBe(STYLE_PACKS.length);
    }
  });

  it('turns leaves orange in autumn and white in winter', () => {
    const [r, g] = packColor(stylePackFor('autumn'), [63, 125, 56]);
    expect(r).toBeGreaterThan(g);
    const winter = packColor(stylePackFor('winter'), [63, 125, 56]);
    expect(Math.min(...winter)).toBeGreaterThan(170);
  });

  it('falls back to the usual look for a pack this version does not have', () => {
    expect(stylePackFor('neon')).toBe(placeholderStyle);
    expect(stylePackFor(undefined)).toBe(placeholderStyle);
    expect(packColor(placeholderStyle, [1, 2, 3])).toEqual([1, 2, 3]);
  });
});
