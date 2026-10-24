import { describe, expect, it } from 'vitest';
import {
  GRAPHICS_QUALITIES,
  SlowFrameDetector,
  blurAt,
  defaultQuality,
  depthOfFieldLens,
  effectsFor,
  lowerQuality,
  parseQuality,
} from './index';

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

describe('SlowFrameDetector', () => {
  /** Feeds frames `ms` apart for `seconds`, starting at `from`; returns whether it asked to lower, and the end time. */
  function feed(detector: SlowFrameDetector, ms: number, seconds: number, from = 0): { lowered: boolean; end: number } {
    let now = from;
    let lowered = false;
    while (now < from + seconds * 1000) {
      now += ms;
      if (detector.frame(now, true)) lowered = true;
    }
    return { lowered, end: now };
  }

  it('stays put while frames are smooth', () => {
    expect(feed(new SlowFrameDetector(), 16, 10).lowered).toBe(false);
  });

  it('asks to lower even when frames are very slow (a few per second)', () => {
    expect(feed(new SlowFrameDetector(), 350, 5).lowered).toBe(true);
  });

  it('asks to lower after a few seconds of slow frames (under 25 per second)', () => {
    const detector = new SlowFrameDetector();
    expect(feed(detector, 50, 1).lowered).toBe(false); // too soon to judge
    expect(feed(detector, 50, 4, 1000).lowered).toBe(true);
  });

  it('ignores a few hitches among smooth frames', () => {
    const detector = new SlowFrameDetector();
    let now = 0;
    let lowered = false;
    for (let i = 0; i < 600; i++) {
      now += i % 20 === 0 ? 200 : 16;
      if (detector.frame(now, true)) lowered = true;
    }
    expect(lowered).toBe(false);
  });

  it("doesn't count idle time: the view draws only when something changes", () => {
    const detector = new SlowFrameDetector();
    let now = 0;
    let lowered = false;
    for (let burst = 0; burst < 20; burst++) {
      for (let i = 0; i < 10; i++) {
        now += 16;
        // The first frame after a pause follows idle time, not a slow frame.
        if (detector.frame(now, i > 0)) lowered = true;
      }
      now += 2000; // nothing moving for two seconds
    }
    expect(lowered).toBe(false);
  });

  it('starts judging afresh after asking (the lower setting gets its own chance)', () => {
    const detector = new SlowFrameDetector();
    const first = feed(detector, 50, 5);
    expect(first.lowered).toBe(true);
    expect(feed(detector, 16, 5, first.end).lowered).toBe(false);
  });
});

describe('lowerQuality', () => {
  it('steps down one level, and stops at low', () => {
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('medium')).toBe('low');
    expect(lowerQuality('low')).toBeNull();
  });
});
