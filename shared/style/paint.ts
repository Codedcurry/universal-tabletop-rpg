import { CLIPS, type Clip } from '../anim';
import type { SpriteDirection } from '../camera';
import type { Image } from './pixelate';
import type { Pixels, SheetLayout } from './sheet';

/**
 * The mini pixel editor's work on a character's sheet: its frames (each
 * square cell the layout uses, once), and painting, filling, and recolouring
 * in one frame or the same spot of many (frames are lined up by the feet,
 * so fixing an eye in one place fixes it everywhere).
 */

export type Rgba = readonly [number, number, number, number];

export interface Frame {
  readonly row: number;
  readonly column: number;
  /** The animation it first belongs to ("idle"), and which frame of it (from 1). */
  readonly clip: Clip;
  readonly index: number;
  /** The directions that show it. */
  readonly facing: readonly SpriteDirection[];
}

/** Every frame cell the layout uses, once, in animation order. */
export function sheetFrames(layout: SheetLayout): Frame[] {
  const frames: Frame[] = [];
  const seen = new Set<string>();
  for (const clip of CLIPS) {
    const rows = layout.clips[clip];
    if (!rows) continue;
    // Each run once, with every direction that shows it.
    const runs = new Map<string, { run: (typeof rows)[SpriteDirection]; facing: SpriteDirection[] }>();
    for (const direction of ['down', 'left', 'right', 'up'] as const) {
      const run = rows[direction];
      const key = `${run.row}:${run.column ?? 0}`;
      const entry = runs.get(key);
      if (entry) entry.facing.push(direction);
      else runs.set(key, { run, facing: [direction] });
    }
    for (const { run, facing } of runs.values()) {
      for (let index = 0; index < run.frames; index++) {
        const column = (run.column ?? 0) + index;
        const key = `${run.row}:${column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        frames.push({ row: run.row, column, clip, index: index + 1, facing });
      }
    }
  }
  return frames;
}

/** A frame's name: "walk 2", with its facing ("walk 2, left") when the animation has more than one view. */
export function frameLabel(frame: Frame, frames: readonly Frame[]): string {
  const views = new Set(frames.filter((other) => other.clip === frame.clip).map((other) => other.facing.join('/')));
  return views.size > 1 ? `${frame.clip} ${frame.index}, ${frame.facing.join('/')}` : `${frame.clip} ${frame.index}`;
}

/** Which frames a stroke lands on: just the one, every frame of its animation, or all of them. */
export type PaintScope = 'frame' | 'animation' | 'all';

export function framesInScope(frames: readonly Frame[], frame: Frame, scope: PaintScope): Frame[] {
  if (scope === 'frame') return [frame];
  if (scope === 'animation') return frames.filter((other) => other.clip === frame.clip);
  return [...frames];
}

const copy = (image: Pixels): Image => ({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) });

export function colorAt(image: Pixels, x: number, y: number): Rgba {
  const at = (y * image.width + x) * 4;
  return [image.data[at] ?? 0, image.data[at + 1] ?? 0, image.data[at + 2] ?? 0, image.data[at + 3] ?? 0];
}

/** Whether two colours are the same (every clear pixel is the same "colour"). */
const same = (a: Rgba, b: Rgba) => (a[3] === 0 && b[3] === 0) || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);

/** Sets one spot (x, y within a frame) of every given frame; a clear colour erases. */
export function paint(image: Pixels, size: number, frames: readonly Frame[], x: number, y: number, color: Rgba): Image {
  const out = copy(image);
  if (x < 0 || y < 0 || x >= size || y >= size) return out;
  for (const frame of frames) {
    const at = ((frame.row * size + y) * image.width + frame.column * size + x) * 4;
    out.data.set(color, at);
  }
  return out;
}

/** Fills the patch of one colour around a spot (touching on a side), in each given frame, without leaving the frame. */
export function fill(image: Pixels, size: number, frames: readonly Frame[], x: number, y: number, color: Rgba): Image {
  const out = copy(image);
  if (x < 0 || y < 0 || x >= size || y >= size) return out;
  for (const frame of frames) {
    const left = frame.column * size;
    const top = frame.row * size;
    const target = colorAt(out, left + x, top + y);
    if (same(target, color)) continue;
    const stack = [[x, y] as const];
    const seen = new Uint8Array(size * size);
    while (stack.length > 0) {
      const [px, py] = stack.pop()!;
      if (px < 0 || py < 0 || px >= size || py >= size || seen[py * size + px]) continue;
      seen[py * size + px] = 1;
      if (!same(colorAt(out, left + px, top + py), target)) continue;
      out.data.set(color, ((top + py) * image.width + left + px) * 4);
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
  }
  return out;
}

/** Every pixel of one colour turned to another, in the given frames (a quick recolour). */
export function replaceColor(image: Pixels, size: number, frames: readonly Frame[], from: Rgba, to: Rgba): Image {
  const out = copy(image);
  for (const frame of frames) {
    for (let y = frame.row * size; y < (frame.row + 1) * size; y++) {
      for (let x = frame.column * size; x < (frame.column + 1) * size; x++) {
        if (same(colorAt(out, x, y), from)) out.data.set(to, (y * image.width + x) * 4);
      }
    }
  }
  return out;
}

/** The sheet's colours, most used first (up to `limit`), for the palette. */
export function sheetColors(image: Pixels, limit = 32): Rgba[] {
  const counts = new Map<number, number>();
  for (let at = 0; at < image.data.length; at += 4) {
    if ((image.data[at + 3] ?? 0) === 0) continue;
    const key = ((image.data[at] ?? 0) << 16) | ((image.data[at + 1] ?? 0) << 8) | (image.data[at + 2] ?? 0);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => [(key >> 16) & 255, (key >> 8) & 255, key & 255, 255] as const);
}

export const toHex = (color: Rgba) => `#${[color[0], color[1], color[2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

export function fromHex(hex: string): Rgba {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}
