import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOAT_STYLE, FLOAT_MOTIONS, FLOAT_PRESETS, floatKindOf, floatMotion, floatStyleProblem } from './floats';
import { EMPTY_ART, validateCustomArt, withFloats, withLook } from './art';

describe('number styles', () => {
  it('has presets that are all valid', () => {
    for (const style of Object.values(FLOAT_PRESETS)) expect(floatStyleProblem(style)).toBeNull();
  });

  it.each([
    ['a colour that is not #rrggbb', { ...DEFAULT_FLOAT_STYLE, colors: { ...DEFAULT_FLOAT_STYLE.colors, heal: 'green' } }, /heal colour/],
    ['a size out of range', { ...DEFAULT_FLOAT_STYLE, size: 0.1 }, /size/],
    ['an unknown lettering', { ...DEFAULT_FLOAT_STYLE, font: 'wingdings' }, /lettering/],
    ['an unknown motion', { ...DEFAULT_FLOAT_STYLE, motion: 'spin' }, /motion/],
  ])('refuses %s', (_name, style, error) => {
    expect(floatStyleProblem(style)).toMatch(error);
  });

  it('moves every way from the number to gone', () => {
    for (const motion of FLOAT_MOTIONS) {
      expect(floatMotion(motion, 0).opacity).toBe(1);
      expect(floatMotion(motion, 1).opacity).toBeCloseTo(0);
      expect(floatMotion(motion, 0.9).dy).toBeLessThan(0); // up, by the end
    }
    expect(floatMotion('pop', 0.15).scale).toBeGreaterThan(1.3);
    expect(Math.abs(floatMotion('shake', 0.05).dx)).toBeGreaterThan(0);
  });

  it('styles a level-up like XP, and anything unknown like a condition', () => {
    expect(floatKindOf('level')).toBe('xp');
    expect(floatKindOf('damage')).toBe('damage');
    expect(floatKindOf('whatever')).toBe('status');
  });

  it('is kept with the art, and checked there', () => {
    const art = withLook(withFloats(EMPTY_ART, FLOAT_PRESETS.pixel ?? null), 'autumn');
    expect(validateCustomArt(JSON.parse(JSON.stringify(art)))).toEqual({ ok: true, art });
    expect(withLook(withFloats(art, null), null)).toEqual(EMPTY_ART);
    expect(validateCustomArt({ ...EMPTY_ART, floats: { ...DEFAULT_FLOAT_STYLE, size: 5 } })).toMatchObject({ ok: false });
    expect(validateCustomArt({ ...EMPTY_ART, look: '../evil' })).toMatchObject({ ok: false });
  });
});
