import { CLIPS, type Clip } from '../anim';
import type { SpriteDirection } from '../camera';
import type { Pixels, SheetLayout, SheetRow } from './sheet';

/**
 * Free-form sprite sheets: sprites of any size laid out anywhere, all drawn
 * from one view (like a classic battle sheet). Find each sprite, line the
 * chosen frames up by their feet in square cells (so a sword or spear
 * sticking out doesn't make the body jump), and lay them out as a standard
 * sheet: a row per animation and view (side, front, back), the other side
 * mirrored.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Pieces this close (in pixels) are one sprite: a held weapon, a limb, an effect. */
const JOIN_GAP = 2;
/** Fewer drawn pixels than this is a stray speck, not a sprite. */
const MIN_PIXELS = 6;

const opaque = (image: Pixels, x: number, y: number) => (image.data[(y * image.width + x) * 4 + 3] ?? 0) > 0;

/**
 * A sheet drawn on a solid background (no transparency): the background
 * colour, taken from the top-left corner, becomes transparent. A sheet that
 * is already transparent there is returned as it is.
 */
export function clearBackground<T extends Pixels>(image: T): T {
  const { data } = image;
  if ((data[3] ?? 0) === 0) return image;
  const [r, g, b] = [data[0], data[1], data[2]];
  const cleared = new Uint8ClampedArray(data);
  for (let at = 0; at < cleared.length; at += 4) {
    if (cleared[at] === r && cleared[at + 1] === g && cleared[at + 2] === b) cleared[at + 3] = 0;
  }
  return { ...image, data: cleared };
}

/** Every sprite on the sheet, as a box, in reading order (rows top to bottom, then left to right). */
export function findSprites(image: Pixels): Box[] {
  const { width, height } = image;
  const seen = new Uint8Array(width * height);
  const pieces: { box: { x0: number; y0: number; x1: number; y1: number }; pixels: number }[] = [];
  // Connected pieces of drawn pixels (touching on a side or a corner).
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !opaque(image, start % width, Math.floor(start / width))) continue;
    const box = { x0: width, y0: height, x1: -1, y1: -1 };
    let pixels = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      const x = at % width;
      const y = Math.floor(at / width);
      pixels++;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!seen[next] && opaque(image, nx, ny)) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    pieces.push({ box, pixels });
  }

  // Pieces within a couple of pixels of each other are one sprite.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < pieces.length && !merged; i++) {
      for (let j = i + 1; j < pieces.length && !merged; j++) {
        const a = pieces[i]!.box;
        const b = pieces[j]!.box;
        const gapX = Math.max(0, b.x0 - a.x1 - 1, a.x0 - b.x1 - 1);
        const gapY = Math.max(0, b.y0 - a.y1 - 1, a.y0 - b.y1 - 1);
        if (gapX <= JOIN_GAP - 1 && gapY <= JOIN_GAP - 1) {
          pieces[i] = {
            box: { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) },
            pixels: pieces[i]!.pixels + pieces[j]!.pixels,
          };
          pieces.splice(j, 1);
          merged = true;
        }
      }
    }
  }

  const boxes = pieces
    .filter((piece) => piece.pixels >= MIN_PIXELS)
    .map(({ box }) => ({ x: box.x0, y: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 }));

  // Reading order: a box joins the row above if it overlaps it enough, then rows go left to right.
  boxes.sort((a, b) => a.y - b.y);
  const rows: Box[][] = [];
  for (const box of boxes) {
    const row = rows[rows.length - 1];
    const bottom = row ? Math.max(...row.map((entry) => entry.y + entry.height)) : -1;
    if (row && box.y < bottom - box.height * 0.25) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/** Where a sprite stands: the middle of its lowest drawn pixels (not where its weapon reaches), at its bottom edge. */
export function footAnchor(image: Pixels, box: Box): { x: number; y: number } {
  let total = 0;
  let count = 0;
  const lowest = box.y + box.height - 1;
  for (let y = lowest; y >= Math.max(box.y, lowest - 1); y--) {
    for (let x = box.x; x < box.x + box.width; x++) {
      if (opaque(image, x, y)) {
        total += x + 0.5;
        count++;
      }
    }
  }
  return { x: Math.round(count > 0 ? total / count : box.x + box.width / 2), y: box.y + box.height };
}

/**
 * Square cells for a set of frames, big enough for every one, and where each
 * goes in its cell: feet at the middle of the cell's bottom edge.
 */
export function planCells(image: Pixels, frames: readonly Box[]): { size: number; placements: { dx: number; dy: number }[] } {
  const feet = frames.map((box) => footAnchor(image, box));
  const reach = Math.max(1, ...frames.map((box, index) => Math.max(feet[index]!.x - box.x, box.x + box.width - feet[index]!.x)));
  const tallest = Math.max(1, ...frames.map((box) => box.height));
  const size = Math.ceil(Math.max(reach * 2, tallest) / 4) * 4;
  return {
    size,
    placements: frames.map((box, index) => ({ dx: size / 2 - (feet[index]!.x - box.x), dy: size - box.height })),
  };
}

/** Which way picked frames look: from the side (mirrored for the other side), from the front, or from the back. */
export type View = 'side' | 'front' | 'back';
export const VIEWS: readonly View[] = ['side', 'front', 'back'];

/** How many frames were picked for each animation, from each view. */
export type FrameCounts = Readonly<Partial<Record<Clip, Readonly<Partial<Record<View, number>>>>>>;

/** The rows of an assembled sheet, top to bottom: by animation (in the usual order), then side, front, back. */
export function sheetRows(counts: FrameCounts): { clip: Clip; view: View; frames: number }[] {
  return CLIPS.flatMap((clip) => VIEWS.flatMap((view) => ((counts[clip]?.[view] ?? 0) > 0 ? [{ clip, view, frames: counts[clip]?.[view] ?? 0 }] : [])));
}

/** A run of frames (an animation from one view) and where it goes on the sheet. */
export interface PlacedRun {
  readonly clip: Clip;
  readonly view: View;
  readonly frames: number;
  readonly row: number;
  readonly column: number;
}

/**
 * Where each run goes on a sheet at most `columns` frames wide: in order, each
 * in the first row with room, so short animations share rows. Throws if a
 * run is wider than the sheet.
 */
export function packRows(counts: FrameCounts, columns: number): PlacedRun[] {
  const used: number[] = [];
  return sheetRows(counts).map((run) => {
    if (run.frames > columns) throw new Error(`${run.clip} (${run.view} view) has too many frames for sprites this big: at most ${columns}`);
    let row = used.findIndex((width) => width + run.frames <= columns);
    if (row < 0) row = used.push(0) - 1;
    const column = used[row]!;
    used[row] = column + run.frames;
    return { ...run, row, column };
  });
}

/** Which views stand in for each direction, best first. */
const STAND_INS: Readonly<Record<SpriteDirection, readonly View[]>> = {
  down: ['front', 'side', 'back'],
  up: ['back', 'side', 'front'],
  left: ['side', 'front', 'back'],
  right: ['side', 'front', 'back'],
};

/**
 * The standard layout for picked frames: each animation and view a run of
 * frames across, packed into rows (see `packRows`; by default as wide as the
 * longest run). Facing down uses the front view, up the
 * back, left and right the side (mirrored for the side the sprites don't
 * face); a missing view is stood in for by another. Throws without idle frames.
 */
export function assembleLayout(
  counts: FrameCounts,
  frameSize: number,
  faces: 'left' | 'right',
  options: { bodySize?: number; columns?: number } = {},
): SheetLayout {
  const { bodySize } = options;
  const rows = packRows(counts, options.columns ?? Math.max(1, ...sheetRows(counts).map((run) => run.frames)));
  if (!rows.some((row) => row.clip === 'idle')) throw new Error('Pick at least one idle frame');
  const clips: Partial<Record<Clip, Record<SpriteDirection, SheetRow>>> = {};
  for (const clip of CLIPS) {
    const own = rows.filter((row) => row.clip === clip);
    if (own.length === 0) continue;
    const entry = {} as Record<SpriteDirection, SheetRow>;
    for (const direction of ['down', 'left', 'right', 'up'] as const) {
      const view = STAND_INS[direction].find((candidate) => own.some((row) => row.view === candidate)) as View;
      const row = own.find((candidate) => candidate.view === view)!;
      const flipped = view === 'side' && (direction === 'left' || direction === 'right') && direction !== faces;
      entry[direction] = row.column > 0 ? { row: row.row, column: row.column, frames: row.frames, mirror: flipped } : { row: row.row, frames: row.frames, mirror: flipped };
    }
    clips[clip] = entry;
  }
  return bodySize === undefined ? { frameSize, clips } : { frameSize, clips, bodySize };
}
