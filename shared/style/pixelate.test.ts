import { describe, expect, it } from 'vitest';
import { findSprites, picksFromLayout } from './frames';
import { breathe, palette, pixelArt, removeBackground, stillSheet, trim } from './pixelate';

// One picture into a character: background away, shrunk to pixel art with a
// limited palette, and a still sheet with a breathing idle.

type Rgba = readonly [number, number, number, number];

/** A picture filled with `fill`, with rectangles painted on it. */
function picture(width: number, height: number, fill: Rgba, rects: readonly [number, number, number, number, Rgba][] = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < width * height; at++) data.set(fill, at * 4);
  for (const [x0, y0, w, h, color] of rects) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set(color, (y * width + x) * 4);
  }
  return { width, height, data };
}

const at = (image: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const WHITE: Rgba = [255, 255, 255, 255];
const RED: Rgba = [200, 30, 30, 255];
const CLEAR: Rgba = [0, 0, 0, 0];

describe('removeBackground', () => {
  it('clears the background colour joined to the edges, within the tolerance', () => {
    const photo = picture(10, 10, [250, 250, 250, 255], [
      [0, 0, 1, 10, [240, 245, 250, 255]], // a slightly different strip of background
      [3, 3, 4, 4, RED],
    ]);
    const cleared = removeBackground(photo, 16);
    expect(at(cleared, 0, 5)[3]).toBe(0);
    expect(at(cleared, 9, 9)[3]).toBe(0);
    expect(at(cleared, 4, 4)).toEqual([...RED]);
  });

  it('keeps background-coloured pixels inside the subject (an eye, a buckle)', () => {
    const photo = picture(10, 10, WHITE, [
      [2, 2, 6, 6, RED],
      [4, 4, 2, 2, WHITE], // white inside the red, not touching the edge
    ]);
    expect(at(removeBackground(photo, 10), 4, 4)).toEqual([...WHITE]);
  });
});

describe('trim', () => {
  it('cuts the picture down to its drawn pixels', () => {
    const cut = trim(picture(10, 8, CLEAR, [[3, 2, 4, 5, RED]]));
    expect([cut.width, cut.height]).toEqual([4, 5]);
    expect(at(cut, 0, 0)).toEqual([...RED]);
  });
});

describe('palette', () => {
  it('finds the main colours, at most as many as asked', () => {
    const image = picture(4, 2, RED, [[2, 0, 2, 2, [20, 40, 220, 255]]]);
    const colors = palette(image, 8);
    expect(colors).toHaveLength(2);
    expect(colors).toContainEqual([200, 30, 30]);
    expect(palette(picture(4, 4, RED, [[0, 0, 1, 1, [10, 200, 10, 255]], [1, 0, 1, 1, [10, 10, 200, 255]]]), 2)).toHaveLength(2);
  });
});

describe('pixelArt', () => {
  it('shrinks the picture to the height asked, keeping its shape', () => {
    const art = pixelArt(picture(40, 80, CLEAR, [[0, 0, 40, 80, RED]]), { height: 20, colors: 8, outline: false });
    expect([art.width, art.height]).toEqual([10, 20]);
    expect(at(art, 5, 10)).toEqual([...RED]);
  });

  it('never enlarges a small picture', () => {
    const art = pixelArt(picture(6, 10, CLEAR, [[0, 0, 6, 10, RED]]), { height: 64, colors: 8, outline: false });
    expect(art.height).toBe(10);
  });

  it('uses at most the colours asked for', () => {
    // A smooth gradient: many colours in, few out.
    const image = picture(32, 32, RED);
    for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) image.data.set([x * 8, y * 8, 100, 255], (y * 32 + x) * 4);
    const art = pixelArt(image, { height: 32, colors: 4, outline: false });
    const used = new Set<string>();
    for (let i = 0; i < art.data.length; i += 4) used.add(art.data.slice(i, i + 3).join());
    expect(used.size).toBeLessThanOrEqual(4);
  });

  it('draws a dark outline around the character, a pixel wider on each side', () => {
    const art = pixelArt(picture(4, 4, CLEAR, [[0, 0, 4, 4, RED]]), { height: 4, colors: 4, outline: true });
    expect([art.width, art.height]).toEqual([6, 6]);
    expect(at(art, 0, 2)[3]).toBe(255); // outline beside the body
    expect(at(art, 0, 0)[3]).toBe(0); // corners stay clear
    expect(at(art, 2, 2)).toEqual([...RED]);
  });
});

describe('breathe', () => {
  it('sinks the upper body a pixel, leaving the feet where they are', () => {
    const body = picture(2, 10, CLEAR, [
      [0, 0, 2, 1, WHITE], // head top
      [0, 1, 2, 9, RED],
    ]);
    const breath = breathe(body);
    expect(at(breath, 0, 0)[3]).toBe(0);
    expect(at(breath, 0, 1)).toEqual([...WHITE]);
    expect(at(breath, 0, 9)).toEqual([...RED]);
  });
});

describe('stillSheet', () => {
  it('makes a breathing idle from the front, feet at the bottom middle of square frames', () => {
    const front = picture(8, 20, RED);
    const { image, layout } = stillSheet(front);
    expect(layout.frameSize).toBe(24); // with room between frames
    expect([image.width, image.height]).toEqual([48, 24]);
    expect(layout.clips.idle?.down).toEqual({ row: 0, frames: 2, mirror: false });
    // No side view: left and right show the front.
    expect(layout.clips.idle?.left).toEqual({ row: 0, frames: 2, mirror: false });
    expect(layout.fps?.idle).toBe(3);
    expect(layout.bodySize).toBe(20);
    expect(at(image, 12, 23)).toEqual([...RED]); // standing at the bottom middle
    expect(at(image, 2, 23)[3]).toBe(0);
  });

  it('adds the back view, facing up, when there is one', () => {
    const { image, layout } = stillSheet(picture(8, 20, RED), picture(8, 18, WHITE));
    expect(image.height).toBe(48);
    expect(layout.clips.idle?.up).toEqual({ row: 1, frames: 2, mirror: false });
  });

  it('leaves room between frames, so they can be found apart to edit them', () => {
    const { image, layout } = stillSheet(picture(8, 20, RED), picture(8, 20, WHITE));
    expect(findSprites(image)).toHaveLength(4);
    expect(picksFromLayout(layout, findSprites(image)).picks).toEqual({ side: { idle: [0, 1] }, back: { idle: [2, 3] } });
  });

  it('keeps a wide creature\'s body the usual height', () => {
    expect(stillSheet(picture(30, 12, RED)).layout.bodySize).toBe(12);
  });
});
