import { describe, expect, it } from 'vitest';
import { findGrid, traceMap, tracedText } from './trace';

// Tracing a battle map picture: its grid, then walls, floor, and outside,
// square by square. A drawn test map stands in for a book's page.

const PAPER = 253;
const GRID = 228;
const INKED = 30;

/** A page: paper with faint grid lines every `square` pixels (fractional, as a scaled page would be). */
function page(width: number, height: number, square: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  const set = (x: number, y: number, value: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    data.set([value, value, value, 255], (y * width + x) * 4);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, PAPER);
  for (let line = 0; line < width; line += square) for (let y = 0; y < height; y++) set(Math.round(line), y, GRID);
  for (let line = 0; line < height; line += square) for (let x = 0; x < width; x++) set(x, Math.round(line), GRID);
  /** Fills squares (column, row, how many across and down) with ink. */
  const ink = (column: number, row: number, across = 1, down = 1) => {
    for (let y = Math.round(row * square); y < Math.round((row + down) * square); y++) for (let x = Math.round(column * square); x < Math.round((column + across) * square); x++) set(x, y, INKED);
  };
  return { image: { width, height, data }, ink, set };
}

describe('findGrid', () => {
  it('finds the squares, to a fraction of a pixel', () => {
    const { image } = page(400, 300, 21.4);
    expect(findGrid(image)?.square).toBeCloseTo(21.4, 0);
  });

  it('finds no grid on a blank page', () => {
    const { image } = page(200, 200, 1000);
    expect(findGrid(image)).toBeNull();
  });
});

describe('traceMap', () => {
  /** A room 6 squares by 4 inside its walls, at column 3, row 2, with a doorway in its south wall. */
  function room() {
    const drawn = page(14 * 22.5, 10 * 22.5, 22.5);
    drawn.ink(3, 2, 8, 1); // north wall
    drawn.ink(3, 7, 3, 1); // south wall, west of the door
    drawn.ink(7, 7, 4, 1); // south wall, east of the door
    drawn.ink(3, 2, 1, 6); // west wall
    drawn.ink(10, 2, 1, 6); // east wall
    // The door: a thin line across the gap.
    for (let x = Math.round(6 * 22.5); x < Math.round(7 * 22.5); x++) drawn.set(x, Math.round(7.5 * 22.5), INKED);
    return drawn;
  }

  it('finds the walls and the floor inside them, cut to the map', () => {
    const traced = traceMap(room().image);
    expect(traced).not.toBeNull();
    expect(traced?.outdoor).toBe(false);
    expect(tracedText(traced!)).toBe(
      ['', ' ########', ' #......#', ' #......#', ' #......#', ' #......#', ' ########', ''].join('\n'),
    );
  });

  it('treats specks of grey (rock, rubble) inside the walls as solid, and clean paper as floor', () => {
    const drawn = room();
    // Rubble in two by two squares of the room: speckles of grey.
    for (let y = Math.round(3 * 22.5); y < Math.round(5 * 22.5); y += 2) for (let x = Math.round(5 * 22.5); x < Math.round(7 * 22.5); x += 2) drawn.set(x, y, 160);
    const rows = tracedText(traceMap(drawn.image)!).split('\n');
    expect(rows.slice(2, 4)).toEqual([' #.##...#', ' #.##...#']);
  });

  it('has no map without a grid', () => {
    expect(traceMap(page(200, 200, 1000).image)).toBeNull();
  });
});
