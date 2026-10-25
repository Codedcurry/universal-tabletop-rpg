import { CLIPS, type Clip } from '../anim';
import type { SpriteDirection } from '../camera';

/**
 * Character sprite sheets, as the importer reads them: every animation takes
 * 4 rows (facing down, left, right, up), animations in the standard order
 * (idle first, the only one required), frames running across. Slicing finds
 * which animations are there and how many frames each row has; a missing
 * left or right row mirrors the other side, any other missing direction
 * borrows the facing-down row, and a missing animation is left out so the
 * procedural fallback motion plays instead.
 */

export const SHEET_DIRECTIONS: readonly SpriteDirection[] = ['down', 'left', 'right', 'up'];
/** Frame sizes the importer tries, largest first. */
const FRAME_SIZES = [128, 96, 64, 48, 32, 24, 16];
const MAX_COLUMNS = 16;
/** Frames per second when an animation plays, unless the sheet says otherwise. */
export const DEFAULT_FPS = 8;
export const MIN_FPS = 1;
export const MAX_FPS = 30;

export interface SheetRow {
  /** The sheet row to draw from (0 is the top). */
  readonly row: number;
  readonly frames: number;
  /** The column of its first frame, if not the first: short animations can share a row. */
  readonly column?: number;
  /** Draw it flipped (a left row standing in for right, or the other way). */
  readonly mirror: boolean;
}

export interface SheetLayout {
  readonly frameSize: number;
  /**
   * How tall the character itself is in the frames, if the frames have room
   * for more (weapons reaching out): the sprite is drawn so the body, not
   * the whole frame, matches other characters' height.
   */
  readonly bodySize?: number;
  /** How fast animations play, in frames per second, where not the default 8. */
  readonly fps?: Readonly<Partial<Record<Clip, number>>>;
  /** The animations the sheet has, each with a row for every direction. */
  readonly clips: Readonly<Partial<Record<Clip, Readonly<Record<SpriteDirection, SheetRow>>>>>;
}

export interface Pixels {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes, row by row. */
  readonly data: Uint8ClampedArray;
}

/**
 * The likely frame size of a sheet: square frames that fill it, 4 rows per
 * animation. From the size alone, the largest that fits. With the pixels, the
 * one whose grid lines cut through the fewest drawn pixels (a too-small grid
 * slices sprites in half); among equally clean grids, the smallest (a
 * too-large grid only lumps several frames together).
 */
export function guessFrameSize(width: number, height: number, image?: Pixels): number | null {
  const fitting = FRAME_SIZES.filter((size) => width % size === 0 && height % (size * 4) === 0 && width / size <= MAX_COLUMNS);
  if (fitting.length === 0) return null;
  if (!image) return fitting[0] ?? null;
  const alpha = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3] ?? 0;
  const cut = (size: number) => {
    let drawn = 0;
    let total = 0;
    for (let x = size; x < width; x += size) {
      for (let y = 0; y < height; y++, total++) if (alpha(x, y) > 0 || alpha(x - 1, y) > 0) drawn++;
    }
    for (let y = size; y < height; y += size) {
      for (let x = 0; x < width; x++, total++) if (alpha(x, y) > 0 || alpha(x, y - 1) > 0) drawn++;
    }
    return total === 0 ? 0 : drawn / total;
  };
  const scored = fitting.map((size) => ({ size, cut: cut(size) }));
  const cleanest = Math.min(...scored.map((entry) => entry.cut));
  return Math.min(...scored.filter((entry) => entry.cut <= cleanest + 0.02).map((entry) => entry.size));
}

/** Whether a frame cell has any visible pixel. */
function cellFilled(image: Pixels, frame: number, row: number, column: number): boolean {
  for (let y = row * frame; y < (row + 1) * frame; y++) {
    for (let x = column * frame; x < (column + 1) * frame; x++) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) > 0) return true;
    }
  }
  return false;
}

/** Reads a sheet\'s layout, with friendly warnings. Throws if there are no idle frames. */
export function sliceSheet(image: Pixels, frameSize: number): { layout: SheetLayout; warnings: string[] } {
  const warnings: string[] = [];
  if (!Number.isInteger(frameSize) || frameSize < 4) throw new Error('Frames must be at least 4 pixels across');
  const columns = Math.floor(image.width / frameSize);
  const rows = Math.floor(image.height / frameSize);
  if (columns < 1 || rows < 4) throw new Error(`The sheet is too small for ${frameSize}-pixel frames: it needs at least 4 rows (facing down, left, right, up)`);
  if (image.width % frameSize !== 0 || image.height % frameSize !== 0) {
    warnings.push(`The sheet (${image.width} x ${image.height}) isn't a whole number of ${frameSize}-pixel frames; the edges are ignored.`);
  }
  if (rows % 4 !== 0) {
    warnings.push(`The sheet has ${rows} rows of frames; animations take 4 rows each (down, left, right, up), so the last ${rows % 4} are ignored.`);
  }

  const counts = (row: number) => {
    let frames = 0;
    while (frames < columns && cellFilled(image, frameSize, row, frames)) frames++;
    return frames;
  };

  const clips: Partial<Record<Clip, Record<SpriteDirection, SheetRow>>> = {};
  CLIPS.forEach((clip, index) => {
    if ((index + 1) * 4 > rows) return;
    const found = SHEET_DIRECTIONS.map((direction, offset) => ({ direction, row: index * 4 + offset, frames: counts(index * 4 + offset) }));
    if (found.every((entry) => entry.frames === 0)) return;
    // In SHEET_DIRECTIONS order: down, left, right, up.
    const byDirection = { down: found[0]!, left: found[1]!, right: found[2]!, up: found[3]! };
    const fallback = found.find((entry) => entry.frames > 0) as { row: number; frames: number };
    const result = {} as Record<SpriteDirection, SheetRow>;
    for (const { direction, row, frames } of found) {
      if (frames > 0) {
        result[direction] = { row, frames, mirror: false };
        continue;
      }
      const opposite = direction === 'left' ? byDirection.right : direction === 'right' ? byDirection.left : null;
      if (opposite && opposite.frames > 0) {
        result[direction] = { row: opposite.row, frames: opposite.frames, mirror: true };
        continue;
      }
      const down = byDirection.down.frames > 0 ? byDirection.down : fallback;
      result[direction] = { row: down.row, frames: down.frames, mirror: false };
      warnings.push(`${clip} has no frames facing ${direction}; it uses its facing-${down === byDirection.down ? 'down' : 'other'} frames.`);
    }
    clips[clip] = result;
  });

  if (!clips.idle) {
    throw new Error('The sheet has no idle frames: its first 4 rows (facing down, left, right, up) must hold the idle animation');
  }
  return { layout: { frameSize, clips }, warnings };
}

/**
 * The frame of an animation to show `elapsedMs` after it started, or null if
 * the sheet doesn't have that animation (the fallback motion plays instead).
 * At the sheet's speed for that animation; looping by default, a one-off
 * holds its last frame.
 */
export function frameAt(
  layout: SheetLayout,
  clip: Clip,
  direction: SpriteDirection,
  elapsedMs: number,
  options: { loop?: boolean } = {},
): { row: number; column: number; mirror: boolean } | null {
  const row = layout.clips[clip]?.[direction];
  if (!row) return null;
  const fps = layout.fps?.[clip] ?? DEFAULT_FPS;
  const step = Math.floor((Math.max(0, elapsedMs) * fps) / 1000);
  const column = options.loop === false ? Math.min(step, row.frames - 1) : step % row.frames;
  return { row: row.row, column: (row.column ?? 0) + column, mirror: row.mirror };
}

/**
 * Where the face is for a round token: the top of the first facing-down idle
 * frame (of the body, in frames with room for more, where it stands at the
 * bottom middle).
 */
export function portraitRect(layout: SheetLayout): { x: number; y: number; size: number } {
  const frame = layout.frameSize;
  const body = layout.bodySize ?? frame;
  const size = Math.round(body * 0.75);
  const row = layout.clips.idle?.down.row ?? 0;
  return { x: Math.round((frame - size) / 2), y: row * frame + frame - body, size };
}

/**
 * Which art a creature uses: its own, or that of its kind (goblin-2 uses
 * "goblin"), or none.
 */
export function artKeyFor(combatantId: string, keys: readonly string[]): string | null {
  if (keys.includes(combatantId)) return combatantId;
  const kind = combatantId.replace(/-\d+$/, '');
  return keys.includes(kind) ? kind : null;
}
