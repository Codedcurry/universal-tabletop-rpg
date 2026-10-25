import { describe, expect, it } from 'vitest';
import { assembleLayout, clearBackground, findSprites, footAnchor, packRows, planCells, sheetRows } from './frames';

// Free-form sprite sheets (sprites of any size, anywhere, one view): find
// each sprite, line chosen frames up by their feet in square cells, and lay
// them out as a standard sheet (one row per animation, mirrored for the
// other side).

/** A transparent image with opaque rectangles drawn on it. */
function image(width: number, height: number, rects: readonly [number, number, number, number][]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x0, y0, w, h] of rects) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data[(y * width + x) * 4 + 3] = 255;
  }
  return { width, height, data };
}

describe('findSprites', () => {
  it('finds each sprite as a box, in reading order (rows, then left to right)', () => {
    const sheet = image(60, 40, [
      [30, 2, 8, 12], // top row, right
      [2, 4, 10, 12], // top row, left
      [5, 24, 6, 12], // bottom row
    ]);
    expect(findSprites(sheet)).toEqual([
      { x: 2, y: 4, width: 10, height: 12 },
      { x: 30, y: 2, width: 8, height: 12 },
      { x: 5, y: 24, width: 6, height: 12 },
    ]);
  });

  it('keeps a weapon or limb a pixel or two away as part of the same sprite', () => {
    const sheet = image(40, 20, [
      [10, 2, 8, 14], // body
      [2, 8, 7, 2], // a spear held out in front, 1 pixel away
    ]);
    expect(findSprites(sheet)).toEqual([{ x: 2, y: 2, width: 16, height: 14 }]);
  });

  it('ignores stray specks', () => {
    const sheet = image(40, 20, [
      [10, 2, 8, 14],
      [30, 15, 1, 1],
    ]);
    expect(findSprites(sheet)).toHaveLength(1);
  });

  it('finds nothing on an empty sheet', () => {
    expect(findSprites(image(16, 16, []))).toEqual([]);
  });
});

describe('footAnchor', () => {
  it('is the middle of the sprite\'s lowest pixels: where it stands, not where its weapon reaches', () => {
    // A body 8 wide with feet at x 10..17, and a spear reaching left to x 2.
    const sheet = image(40, 20, [
      [10, 2, 8, 14],
      [2, 8, 8, 2],
    ]);
    const [sprite] = findSprites(sheet);
    expect(footAnchor(sheet, sprite!)).toEqual({ x: 14, y: 16 });
  });
});

describe('planCells', () => {
  it('uses square cells big enough for every frame, with every frame standing on the same spot', () => {
    const sheet = image(60, 30, [
      [2, 2, 8, 20], // a plain stance: feet centered at x 6
      [30, 6, 8, 16], // a lunge: body at 30..37 ...
      [16, 12, 14, 2], // ... spear reaching left to x 16 (touching the body)
    ]);
    const sprites = findSprites(sheet);
    expect(sprites).toHaveLength(2);
    const { size, placements } = planCells(sheet, sprites);
    // The spear sticks out 18 pixels left of the feet (x 34): the cell is twice that wide, at least.
    expect(size).toBeGreaterThanOrEqual(36);
    expect(size % 4).toBe(0);
    for (const [index, placement] of placements.entries()) {
      const foot = footAnchor(sheet, sprites[index]!);
      // The feet land at the middle of the cell's bottom.
      expect(placement.dx + (foot.x - sprites[index]!.x)).toBe(size / 2);
      expect(placement.dy + (foot.y - sprites[index]!.y)).toBe(size);
    }
  });
});

describe('assembleLayout', () => {
  it('puts each animation on its own row, and fills in the other sides by mirroring', () => {
    const layout = assembleLayout({ idle: { side: 2 }, walk: { side: 4 } }, 32, 'left');
    expect(layout.frameSize).toBe(32);
    expect(layout.clips.idle).toEqual({
      down: { row: 0, frames: 2, mirror: false },
      left: { row: 0, frames: 2, mirror: false },
      right: { row: 0, frames: 2, mirror: true },
      up: { row: 0, frames: 2, mirror: false },
    });
    expect(layout.clips.walk?.left.row).toBe(1);
  });

  it('mirrors the other way for sprites that face right', () => {
    const layout = assembleLayout({ idle: { side: 1 } }, 16, 'right');
    expect(layout.clips.idle?.left.mirror).toBe(true);
    expect(layout.clips.idle?.right.mirror).toBe(false);
  });

  it('uses front frames facing down and back frames facing up, each on its own row', () => {
    const counts = { idle: { side: 2, front: 3, back: 1 }, walk: { side: 4 } };
    expect(sheetRows(counts).map((row) => `${row.clip}:${row.view}`)).toEqual(['idle:side', 'idle:front', 'idle:back', 'walk:side']);
    const layout = assembleLayout(counts, 16, 'left', { columns: 8 });
    expect(layout.clips.idle?.right).toEqual({ row: 0, frames: 2, mirror: true });
    // Short runs share a row: front after side, back after front.
    expect(layout.clips.idle?.down).toEqual({ row: 0, column: 2, frames: 3, mirror: false });
    expect(layout.clips.idle?.up).toEqual({ row: 0, column: 5, frames: 1, mirror: false });
    // Walk has only the side view: it stands in for front and back. It doesn't fit the first row.
    expect(layout.clips.walk?.down).toEqual({ row: 1, frames: 4, mirror: false });
  });

  it('stands in for a missing side view with the front, unmirrored', () => {
    const layout = assembleLayout({ idle: { front: 2 } }, 16, 'left');
    expect(layout.clips.idle?.left).toEqual({ row: 0, frames: 2, mirror: false });
    expect(layout.clips.idle?.up).toEqual({ row: 0, frames: 2, mirror: false });
  });

  it('leaves out animations with no frames, and needs idle', () => {
    expect(Object.keys(assembleLayout({ idle: { side: 1 }, walk: { side: 0 } }, 16, 'left').clips)).toEqual(['idle']);
    expect(() => assembleLayout({ walk: { side: 2 } }, 16, 'left')).toThrow(/idle/i);
  });
});

describe('packRows', () => {
  it('puts each run in the first row with room, so a one-frame animation never needs a row of its own', () => {
    const counts = { idle: { side: 4 }, walk: { side: 6 }, victory: { side: 1 } };
    expect(packRows(counts, 8).map(({ clip, row, column }) => [clip, row, column])).toEqual([
      ['idle', 0, 0],
      ['walk', 1, 0],
      ['victory', 0, 4],
    ]);
  });

  it('refuses a run wider than the sheet', () => {
    expect(() => packRows({ idle: { side: 12 } }, 11)).toThrow(/idle.*at most 11/);
  });
});

describe('body size', () => {
  it('records how tall the body is, so frames with room for weapons draw the body at the usual height', () => {
    expect(assembleLayout({ idle: { side: 1 } }, 92, 'left', { bodySize: 33 }).bodySize).toBe(33);
    expect(assembleLayout({ idle: { side: 1 } }, 32, 'left')).not.toHaveProperty('bodySize');
  });
});

describe('clearBackground', () => {
  it('makes a solid background colour transparent, so the sprites on it can be found', () => {
    const sheet = image(20, 10, [[0, 0, 20, 10]]); // all opaque black
    for (let y = 2; y < 8; y++) for (let x = 4; x < 8; x++) sheet.data[(y * 20 + x) * 4] = 200; // a red sprite
    expect(findSprites(clearBackground(sheet))).toEqual([{ x: 4, y: 2, width: 4, height: 6 }]);
  });

  it('leaves a transparent sheet alone', () => {
    const sheet = image(10, 10, [[2, 2, 4, 4]]);
    expect(clearBackground(sheet)).toBe(sheet);
  });
});
