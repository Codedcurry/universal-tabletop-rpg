import { describe, expect, it } from 'vitest';
import { type Cell, type Grid, type GridKind, cellKey, cellsEqual, createGrid, headingBetween, parseCellKey } from './index';

const c = (q: number, r: number): Cell => ({ q, r });

const sampleCells: Cell[] = [c(0, 0), c(1, 0), c(0, 1), c(-3, 2), c(4, -5), c(-2, -2), c(7, 3), c(-6, 6)];

function sortCells(cells: Cell[]): Cell[] {
  return [...cells].sort((a, b) => a.q - b.q || a.r - b.r);
}

function hasNegativeZero(cells: Cell[]): boolean {
  return cells.some((cell) => Object.is(cell.q, -0) || Object.is(cell.r, -0));
}

// Every grid type must satisfy the same contract so the rules engine,
// movement, line of sight, and map editor can treat them interchangeably.
describe.each<[GridKind, number]>([
  ['hex', 6],
  ['square', 8],
])('%s grid contract', (kind, neighborCount) => {
  const grid: Grid = createGrid(kind);

  it('reports its kind', () => {
    expect(grid.kind).toBe(kind);
  });

  describe('neighbors', () => {
    it.each(sampleCells)('(%o) has the right number of distinct neighbors, all at distance 1', (cell) => {
      const neighbors = grid.neighbors(cell);
      expect(neighbors).toHaveLength(neighborCount);
      expect(new Set(neighbors.map(cellKey)).size).toBe(neighborCount);
      for (const n of neighbors) expect(grid.distance(cell, n)).toBe(1);
      expect(neighbors.some((n) => cellsEqual(n, cell))).toBe(false);
    });

    it('is symmetric: if B neighbors A then A neighbors B', () => {
      for (const cell of sampleCells) {
        for (const n of grid.neighbors(cell)) {
          expect(grid.neighbors(n).some((back) => cellsEqual(back, cell))).toBe(true);
        }
      }
    });
  });

  describe('distance', () => {
    it('is zero from a cell to itself', () => {
      for (const cell of sampleCells) expect(grid.distance(cell, cell)).toBe(0);
    });

    it('is symmetric and satisfies the triangle inequality', () => {
      for (const a of sampleCells) {
        for (const b of sampleCells) {
          expect(grid.distance(a, b)).toBe(grid.distance(b, a));
          for (const m of sampleCells) {
            expect(grid.distance(a, b)).toBeLessThanOrEqual(grid.distance(a, m) + grid.distance(m, b));
          }
        }
      }
    });
  });

  describe('line', () => {
    it('from a cell to itself is just that cell', () => {
      expect(grid.line(c(2, -1), c(2, -1))).toEqual([c(2, -1)]);
    });

    it('starts at A, ends at B, has distance+1 cells, and every step moves to a neighbor', () => {
      for (const a of sampleCells) {
        for (const b of sampleCells) {
          const line = grid.line(a, b);
          expect(line).toHaveLength(grid.distance(a, b) + 1);
          expect(line[0]).toEqual(a);
          expect(line[line.length - 1]).toEqual(b);
          for (let i = 1; i < line.length; i++) {
            expect(grid.distance(line[i - 1] as Cell, line[i] as Cell)).toBe(1);
          }
          expect(hasNegativeZero(line)).toBe(false);
        }
      }
    });
  });

  describe('range', () => {
    it('with radius 0 is just the center', () => {
      expect(grid.range(c(3, -4), 0)).toEqual([c(3, -4)]);
    });

    it('contains exactly the cells within the radius, without duplicates', () => {
      const center = c(-2, 5);
      const radius = 3;
      const cells = grid.range(center, radius);
      expect(new Set(cells.map(cellKey)).size).toBe(cells.length);
      for (const cell of cells) expect(grid.distance(center, cell)).toBeLessThanOrEqual(radius);
      // Brute force over a box big enough for both grid types.
      let expected = 0;
      for (let q = center.q - 2 * radius; q <= center.q + 2 * radius; q++) {
        for (let r = center.r - 2 * radius; r <= center.r + 2 * radius; r++) {
          if (grid.distance(center, c(q, r)) <= radius) expected++;
        }
      }
      expect(cells).toHaveLength(expected);
      expect(hasNegativeZero(cells)).toBe(false);
    });

    it('rejects a negative or fractional radius', () => {
      expect(() => grid.range(c(0, 0), -1)).toThrow(RangeError);
      expect(() => grid.range(c(0, 0), 1.5)).toThrow(RangeError);
    });
  });

  describe('world conversion', () => {
    it.each([1, 2.5])('round-trips every cell center (cell size %d)', (size) => {
      for (const cell of sampleCells) {
        expect(grid.fromWorld(grid.toWorld(cell, size), size)).toEqual(cell);
      }
    });

    it('maps points near a cell center back to that cell', () => {
      const size = 2;
      // Safely inside both a hex (inner radius = size * sqrt(3) / 2) and a square (half side = size / 2).
      const offset = size * 0.4;
      for (const cell of sampleCells) {
        const center = grid.toWorld(cell, size);
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
          const point = { x: center.x + Math.cos(angle) * offset, z: center.z + Math.sin(angle) * offset };
          expect(grid.fromWorld(point, size)).toEqual(cell);
        }
      }
    });

    it('never returns negative zero', () => {
      expect(hasNegativeZero([grid.fromWorld({ x: -0.01, z: -0.01 }, 1)])).toBe(false);
    });
  });
});

describe('hex grid (axial, pointy-top)', () => {
  const hex = createGrid('hex');

  it('has the six axial neighbors', () => {
    expect(sortCells(hex.neighbors(c(0, 0)))).toEqual(
      sortCells([c(1, 0), c(1, -1), c(0, -1), c(-1, 0), c(-1, 1), c(0, 1)]),
    );
  });

  it('measures distance in hex steps', () => {
    expect(hex.distance(c(0, 0), c(3, -1))).toBe(3);
    expect(hex.distance(c(0, 0), c(2, 2))).toBe(4);
    expect(hex.distance(c(-1, 3), c(2, -1))).toBe(4);
  });

  it('draws a straight line along an axis', () => {
    expect(hex.line(c(0, 0), c(3, 0))).toEqual([c(0, 0), c(1, 0), c(2, 0), c(3, 0)]);
    expect(hex.line(c(0, 0), c(0, -2))).toEqual([c(0, 0), c(0, -1), c(0, -2)]);
  });

  it('has 3r(r+1)+1 cells in range r', () => {
    expect(hex.range(c(0, 0), 1)).toHaveLength(7);
    expect(hex.range(c(0, 0), 2)).toHaveLength(19);
    expect(hex.range(c(5, -2), 4)).toHaveLength(61);
  });

  it('places pointy-top centers on the x/z plane', () => {
    const size = 2;
    const east = hex.toWorld(c(1, 0), size);
    expect(east.x).toBeCloseTo(size * Math.sqrt(3));
    expect(east.z).toBeCloseTo(0);
    const southEast = hex.toWorld(c(0, 1), size);
    expect(southEast.x).toBeCloseTo((size * Math.sqrt(3)) / 2);
    expect(southEast.z).toBeCloseTo(size * 1.5);
  });
});

describe('square grid (8-way, Chebyshev)', () => {
  const square = createGrid('square');

  it('includes diagonals as neighbors', () => {
    expect(sortCells(square.neighbors(c(0, 0)))).toEqual(
      sortCells([c(-1, -1), c(0, -1), c(1, -1), c(-1, 0), c(1, 0), c(-1, 1), c(0, 1), c(1, 1)]),
    );
  });

  it('counts a diagonal step as 1', () => {
    expect(square.distance(c(0, 0), c(3, 1))).toBe(3);
    expect(square.distance(c(-2, 5), c(1, 1))).toBe(4);
    expect(square.distance(c(0, 0), c(4, 4))).toBe(4);
  });

  it('draws straight and diagonal lines', () => {
    expect(square.line(c(0, 0), c(0, 3))).toEqual([c(0, 0), c(0, 1), c(0, 2), c(0, 3)]);
    expect(square.line(c(0, 0), c(3, 3))).toEqual([c(0, 0), c(1, 1), c(2, 2), c(3, 3)]);
  });

  it('has (2r+1)^2 cells in range r', () => {
    expect(square.range(c(0, 0), 1)).toHaveLength(9);
    expect(square.range(c(3, 3), 2)).toHaveLength(25);
  });

  it('places centers at column * size, row * size', () => {
    expect(square.toWorld(c(2, 3), 2)).toEqual({ x: 4, z: 6 });
  });
});

describe('cell keys', () => {
  it('round-trip through a string', () => {
    for (const cell of sampleCells) expect(parseCellKey(cellKey(cell))).toEqual(cell);
  });

  it('treat negative zero as zero', () => {
    expect(cellKey({ q: -0, r: 0 })).toBe('0,0');
  });

  it.each(['', '1', '1,', 'a,b', '1,2,3', '1.5,2'])('reject malformed key %j', (key) => {
    expect(() => parseCellKey(key)).toThrow();
  });
});

describe('createGrid', () => {
  it('rejects an unknown grid kind', () => {
    expect(() => createGrid('triangle' as GridKind)).toThrow();
  });
});

describe('headingBetween', () => {
  // Compass heading from one cell toward another: 0 = north (toward row 0), PI/2 = east.
  it('points the four main ways on squares', () => {
    const square = createGrid('square');
    expect(headingBetween(square, c(2, 2), c(3, 2))).toBeCloseTo(Math.PI / 2);
    expect(headingBetween(square, c(2, 2), c(2, 1))).toBeCloseTo(0);
    expect(Math.abs(headingBetween(square, c(2, 2), c(2, 3)))).toBeCloseTo(Math.PI);
    expect(headingBetween(square, c(2, 2), c(1, 2))).toBeCloseTo(-Math.PI / 2);
  });

  it('points between them for hex neighbors off the row', () => {
    const hex = createGrid('hex');
    const northWest = headingBetween(hex, c(2, 3), c(2, 2));
    expect(northWest).toBeLessThan(0);
    expect(northWest).toBeGreaterThan(-Math.PI / 2);
  });
});
