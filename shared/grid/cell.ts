import type { Cell } from './types';

/** Builds a cell, normalizing -0 (which rounding can produce) to 0. */
export function cell(q: number, r: number): Cell {
  return { q: q + 0, r: r + 0 };
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Stable string key, for use in Maps and Sets. */
export function cellKey(c: Cell): string {
  return `${c.q + 0},${c.r + 0}`;
}

const KEY_PATTERN = /^(-?\d+),(-?\d+)$/;

export function parseCellKey(key: string): Cell {
  const match = KEY_PATTERN.exec(key);
  if (!match) throw new Error(`Invalid cell key: "${key}"`);
  return cell(Number(match[1]), Number(match[2]));
}

export function assertRadius(radius: number): void {
  if (!Number.isInteger(radius) || radius < 0) {
    throw new RangeError(`radius must be a non-negative integer, got ${radius}`);
  }
}

/** Linear interpolation along a line, nudged off exact ties so rounding is consistent. */
export const LINE_NUDGE = 1e-6;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
