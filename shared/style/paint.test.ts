import { describe, expect, it } from 'vitest';
import { assembleLayout } from './frames';
import { type Rgba, colorAt, fill, frameLabel, framesInScope, fromHex, paint, replaceColor, sheetColors, sheetFrames, toHex } from './paint';

// The mini pixel editor: a sheet's frames, and painting, filling, and
// recolouring in one frame or the same spot of many.

const RED: Rgba = [200, 30, 30, 255];
const BLUE: Rgba = [20, 40, 220, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

/** A sheet of 8-pixel frames, every pixel `color`. */
function sheet(columns: number, rows: number, color: Rgba = CLEAR) {
  const width = columns * 8;
  const height = rows * 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < width * height; at++) data.set(color, at * 4);
  return { width, height, data };
}

// idle: 2 side frames, then walk: 3 side frames on the next row.
const layout = assembleLayout({ idle: { side: 2 }, walk: { side: 3 } }, 8, 'left', { columns: 3 });
const frames = sheetFrames(layout);

describe('sheetFrames', () => {
  it('lists each frame once, whichever directions share it', () => {
    expect(frames.map(({ clip, index, row, column }) => [clip, index, row, column])).toEqual([
      ['idle', 1, 0, 0],
      ['idle', 2, 0, 1],
      ['walk', 1, 1, 0],
      ['walk', 2, 1, 1],
      ['walk', 3, 1, 2],
    ]);
  });

  it('names frames, with their facing when an animation has more than one view', () => {
    expect(frameLabel(frames[0]!, frames)).toBe('idle 1');
    const viewed = sheetFrames(assembleLayout({ idle: { side: 1, front: 1 } }, 8, 'left', { columns: 2 }));
    expect(viewed.map((frame) => frameLabel(frame, viewed))).toEqual(['idle 1, down', 'idle 1, left/right/up']);
  });

  it('picks the frames a stroke lands on', () => {
    expect(framesInScope(frames, frames[2]!, 'frame')).toEqual([frames[2]]);
    expect(framesInScope(frames, frames[2]!, 'animation')).toHaveLength(3);
    expect(framesInScope(frames, frames[2]!, 'all')).toHaveLength(5);
  });
});

describe('paint', () => {
  it('sets the same spot in every frame given, and nowhere else', () => {
    const painted = paint(sheet(3, 2), 8, framesInScope(frames, frames[0]!, 'animation'), 3, 4, RED);
    expect(colorAt(painted, 3, 4)).toEqual(RED);
    expect(colorAt(painted, 8 + 3, 4)).toEqual(RED);
    expect(colorAt(painted, 3, 8 + 4)).toEqual(CLEAR); // walk is untouched
    expect(colorAt(painted, 4, 4)).toEqual(CLEAR);
  });

  it('erases with a clear colour, and leaves the original alone', () => {
    const original = sheet(3, 2, RED);
    const erased = paint(original, 8, [frames[0]!], 0, 0, CLEAR);
    expect(colorAt(erased, 0, 0)[3]).toBe(0);
    expect(colorAt(original, 0, 0)).toEqual(RED);
  });
});

describe('fill', () => {
  it('fills the patch around a spot, stopping at other colours and at the frame\'s edge', () => {
    const image = paint(sheet(3, 2, RED), 8, [frames[0]!], 4, 0, BLUE);
    // A wall of blue down column 4 of the first frame.
    let walled = image;
    for (let y = 1; y < 8; y++) walled = paint(walled, 8, [frames[0]!], 4, y, BLUE);
    const filled = fill(walled, 8, [frames[0]!], 0, 0, CLEAR);
    expect(colorAt(filled, 3, 7)[3]).toBe(0);
    expect(colorAt(filled, 5, 7)).toEqual(RED); // past the wall
    expect(colorAt(filled, 8, 0)).toEqual(RED); // the next frame
  });
});

describe('replaceColor', () => {
  it('recolours every pixel of one colour in the frames given', () => {
    const recoloured = replaceColor(sheet(3, 2, RED), 8, framesInScope(frames, frames[0]!, 'all'), RED, BLUE);
    expect(colorAt(recoloured, 0, 0)).toEqual(BLUE);
    expect(colorAt(recoloured, 23, 15)).toEqual(BLUE);
    // The unused corner cell (row 0, column 2) isn't a frame.
    expect(colorAt(recoloured, 16, 0)).toEqual(RED);
  });
});

describe('colours', () => {
  it('lists the sheet\'s colours, most used first', () => {
    const image = paint(sheet(1, 1, RED), 8, [{ row: 0, column: 0, clip: 'idle', index: 1, facing: ['down'] }], 0, 0, BLUE);
    expect(sheetColors(image)).toEqual([RED, BLUE]);
  });

  it('converts to and from #rrggbb', () => {
    expect(toHex(RED)).toBe('#c81e1e');
    expect(fromHex('#c81e1e')).toEqual(RED);
  });
});
