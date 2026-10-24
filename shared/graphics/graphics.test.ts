import { describe, expect, it } from 'vitest';
import { GRAPHICS_QUALITIES, blurAt, defaultQuality, depthOfFieldLens, effectsFor, parseQuality } from './index';

// The 2.5D polish (bloom, depth of field, soft shadows, glows) and how much
// of it each graphics setting turns on. Phones start on "low".

describe('effectsFor', () => {
  it('turns every effect off on low, keeping the game fully playable', () => {
    const low = effectsFor('low');
    expect(low.bloom).toBeNull();
    expect(low.depthOfField).toBeNull();
    expect(low.shadows).toBeNull();
    expect(low.glow).toBeNull();
    expect(low.msaaSamples).toBe(1);
    expect(low.maxPixelRatio).toBe(1);
  });

  it('adds more as quality rises', () => {
    const [low, medium, high] = GRAPHICS_QUALITIES.map(effectsFor);
    const count = (effects: ReturnType<typeof effectsFor>) =>
      [effects.bloom, effects.depthOfField, effects.shadows, effects.glow].filter((effect) => effect !== null).length;
    expect(count(low!)).toBeLessThan(count(medium!));
    expect(count(medium!)).toBeLessThanOrEqual(count(high!));
    expect(high!.shadows!.mapSize).toBeGreaterThan(medium!.shadows!.mapSize);
    expect(high!.maxPixelRatio).toBeGreaterThan(medium!.maxPixelRatio);
    expect(high!.msaaSamples).toBeGreaterThanOrEqual(medium!.msaaSamples);
  });

  it('never uses smoothing anti-aliasing (FXAA), which would blur pixel art', () => {
    for (const quality of GRAPHICS_QUALITIES) expect(effectsFor(quality)).not.toHaveProperty('fxaa');
  });

  it('has depth of field on high', () => {
    expect(effectsFor('high').depthOfField).not.toBeNull();
  });
});

describe('defaultQuality', () => {
  it('starts phones and small touch screens on low', () => {
    expect(defaultQuality({ touch: true, screenWidth: 390 })).toBe('low');
  });

  it('starts desktops on high', () => {
    expect(defaultQuality({ touch: false, screenWidth: 1920, cores: 8, memoryGb: 16 })).toBe('high');
  });

  it('starts tablets and weak computers on medium', () => {
    expect(defaultQuality({ touch: true, screenWidth: 1024 })).toBe('medium');
    expect(defaultQuality({ touch: false, screenWidth: 1920, cores: 2 })).toBe('medium');
    expect(defaultQuality({ touch: false, screenWidth: 1920, memoryGb: 2 })).toBe('medium');
  });
});

describe('parseQuality', () => {
  it('accepts a saved setting, and ignores anything else', () => {
    expect(parseQuality('medium')).toBe('medium');
    expect(parseQuality('ultra')).toBeNull();
    expect(parseQuality(null)).toBeNull();
  });
});

describe('depth of field', () => {
  const settings = effectsFor('high').depthOfField!;

  it('is sharp where the camera looks, and blurs nearer and farther', () => {
    const lens = depthOfFieldLens(10, settings);
    expect(blurAt(lens, 10)).toBeCloseTo(0, 6);
    expect(blurAt(lens, 7)).toBeGreaterThan(0);
    expect(blurAt(lens, 14)).toBeGreaterThan(0);
    expect(blurAt(lens, 5)).toBeGreaterThan(blurAt(lens, 7));
  });

  it('keeps a soft area around the focus, so the tiles near the action stay crisp', () => {
    const lens = depthOfFieldLens(10, settings);
    expect(blurAt(lens, 9.5)).toBeLessThan(blurAt(lens, 6) / 4);
  });

  it('looks the same at any zoom: blur depends on how far, relative to the focus', () => {
    const near = depthOfFieldLens(8, settings);
    const far = depthOfFieldLens(40, settings);
    expect(blurAt(far, 40 * 0.7)).toBeCloseTo(blurAt(near, 8 * 0.7), 6);
    expect(blurAt(far, 40 * 1.3)).toBeCloseTo(blurAt(near, 8 * 1.3), 6);
  });

  it('gets stronger with the strength setting', () => {
    const soft = depthOfFieldLens(10, { ...settings, strength: 0.5 });
    const strong = depthOfFieldLens(10, { ...settings, strength: 1 });
    expect(blurAt(strong, 6)).toBeGreaterThan(blurAt(soft, 6));
  });
});
