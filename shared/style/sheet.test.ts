import { describe, expect, it } from 'vitest';
import { SHEET_DIRECTIONS, artKeyFor, frameAt, guessFrameSize, portraitRect, sliceSheet } from './sheet';

// Character sprite sheets: 4 rows per animation (down, left, right, up),
// animations in the standard order (idle first), frames across. The importer
// guesses the frame size, counts each row's frames, and mirrors or borrows
// a missing direction; missing animations fall back to procedural motion.

/** A test sheet: `filled(anim, dirRow, column)` says which frames have pixels. */
function sheet(frame: number, columns: number, rows: number, filled: (row: number, column: number) => boolean) {
  const width = frame * columns;
  const height = frame * rows;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!filled(row, column)) continue;
      // One opaque pixel in the middle of the frame is enough to count.
      const x = column * frame + frame / 2;
      const y = row * frame + frame / 2;
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('guessFrameSize', () => {
  it('finds the frame size from a sheet that is 4 rows per animation', () => {
    expect(guessFrameSize(128, 128)).toBe(32); // 4 frames x idle
    expect(guessFrameSize(192, 512)).toBe(64); // 3 frames x idle + walk
    expect(guessFrameSize(64, 128)).toBe(32);
  });

  it('with the pixels, picks the size whose grid lines don\x27t cut through the sprites', () => {
    // 32-pixel frames, two across, each sprite drawn in the middle of its frame: 64 also "fits" the
    // sheet, but would put two sprites in one frame; 16 would cut every sprite in half.
    const width = 64;
    const height = 256;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inFrameX = x % 32;
        const inFrameY = y % 32;
        if (inFrameX >= 8 && inFrameX < 24 && inFrameY >= 4 && inFrameY < 30) data[(y * width + x) * 4 + 3] = 255;
      }
    }
    expect(guessFrameSize(width, height, { width, height, data })).toBe(32);
  });

  it('gives up on sizes that fit no frame grid', () => {
    expect(guessFrameSize(100, 70)).toBeNull();
  });
});

describe('sliceSheet', () => {
  it('counts the frames in each row, and finds which animations are there', () => {
    // idle: 2 frames each way; walk: 4 frames each way.
    const image = sheet(16, 4, 8, (row, column) => (row < 4 ? column < 2 : true));
    const { layout, warnings } = sliceSheet(image, 16);
    expect(warnings).toEqual([]);
    expect(layout.frameSize).toBe(16);
    expect(Object.keys(layout.clips)).toEqual(['idle', 'walk']);
    expect(layout.clips.idle?.down).toEqual({ row: 0, frames: 2, mirror: false });
    expect(layout.clips.walk?.up).toEqual({ row: 7, frames: 4, mirror: false });
  });

  it('mirrors a missing left or right row from the other side', () => {
    // idle with "left" (row 1) empty.
    const image = sheet(16, 2, 4, (row) => row !== 1);
    const { layout } = sliceSheet(image, 16);
    expect(layout.clips.idle?.left).toEqual({ row: 2, frames: 2, mirror: true });
  });

  it('borrows the facing-down row for any other missing direction', () => {
    const image = sheet(16, 2, 4, (row) => row === 0);
    const { layout, warnings } = sliceSheet(image, 16);
    expect(layout.clips.idle?.up).toEqual({ row: 0, frames: 2, mirror: false });
    expect(warnings.join(' ')).toMatch(/idle.*up/i);
  });

  it('refuses a sheet without idle frames', () => {
    const image = sheet(16, 2, 4, () => false);
    expect(() => sliceSheet(image, 16)).toThrow(/idle/i);
  });

  it('warns when the sheet doesn\'t fit the frame grid, and uses what does', () => {
    const image = sheet(16, 2, 5, (row) => row < 4); // a stray fifth row
    const { layout, warnings } = sliceSheet(image, 16);
    expect(layout.clips.idle).toBeDefined();
    expect(warnings.join(' ')).toMatch(/rows/i);
  });

  it('uses the direction order down, left, right, up', () => {
    expect(SHEET_DIRECTIONS).toEqual(['down', 'left', 'right', 'up']);
  });
});

describe('frameAt', () => {
  const image = sheet(16, 4, 8, () => true);
  const { layout } = sliceSheet(image, 16);

  it('steps through the frames at a steady rate, looping', () => {
    expect(frameAt(layout, 'walk', 'down', 0)).toEqual({ row: 4, column: 0, mirror: false });
    expect(frameAt(layout, 'walk', 'down', 130)?.column).toBe(1);
    expect(frameAt(layout, 'walk', 'down', 4 * 125 + 10)?.column).toBe(0);
  });

  it('plays each animation at the speed the sheet gives it', () => {
    const slow = { ...layout, fps: { walk: 2 } };
    expect(frameAt(slow, 'walk', 'down', 400)?.column).toBe(0);
    expect(frameAt(slow, 'walk', 'down', 600)?.column).toBe(1);
    // Others keep the default 8 a second.
    expect(frameAt(slow, 'idle', 'down', 130)?.column).toBe(1);
  });

  it('holds the last frame of a one-off animation instead of looping', () => {
    expect(frameAt(layout, 'walk', 'down', 10_000, { loop: false })?.column).toBe(3);
  });

  it('has nothing for an animation the sheet lacks (the fallback motion takes over)', () => {
    expect(frameAt(layout, 'victory', 'down', 0)).toBeNull();
  });
});

describe('portraits and art keys', () => {
  it('takes the top of the first facing-down idle frame for a round token', () => {
    const { layout } = sliceSheet(sheet(32, 2, 4, () => true), 32);
    expect(portraitRect(layout)).toEqual({ x: 4, y: 0, size: 24 });
  });

  it('takes the body top, not the frame top, when the frames have room for weapons', () => {
    const { layout } = sliceSheet(sheet(32, 2, 4, () => true), 32);
    // A 20-pixel body standing at the bottom middle of 32-pixel frames.
    expect(portraitRect({ ...layout, bodySize: 20 })).toEqual({ x: 9, y: 12, size: 15 });
  });

  it('shares art between creatures of a kind: goblin-2 uses goblin\'s art unless it has its own', () => {
    expect(artKeyFor('goblin-2', ['goblin'])).toBe('goblin');
    expect(artKeyFor('goblin-2', ['goblin', 'goblin-2'])).toBe('goblin-2');
    expect(artKeyFor('pc-p1', ['pc-p1'])).toBe('pc-p1');
    expect(artKeyFor('ogre-1', ['goblin'])).toBeNull();
  });
});
