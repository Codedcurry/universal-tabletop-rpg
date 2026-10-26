import type { Pixels } from '../style/sheet';

/**
 * Tracing a battle map picture (a page of an adventure: walls drawn dark on
 * a light grid): find the grid's squares, then for each square whether it's
 * wall, floor inside the walls, or outside. No AI: the same picture always
 * gives the same map, which the DM's text AI then furnishes.
 */

export type TracedCell = 'floor' | 'wall' | 'outside';

export interface TracedMap {
  /** Squares across and down (the part of the page with the map on it, plus a square of margin). */
  readonly width: number;
  readonly height: number;
  /** Row by row. */
  readonly cells: readonly TracedCell[];
  /** The grid square's size in picture pixels, and where square (0, 0) starts. */
  readonly square: number;
  readonly origin: { readonly x: number; readonly y: number };
  /** Walls enclose nothing (an outdoor map): every square counts as ground. */
  readonly outdoor: boolean;
}

/** Darker than this is ink: walls, outlines, text. */
const INK = 100;
/** Grid lines are faint grey: a little darker than the paper, not ink, not coloured. */
const GRID_LOW = 150;
const GRID_HIGH = 248;
/** A square this inked is wall (brick outlines are about a fifth ink). */
const WALL_INK = 0.15;
/** Less ink than this in a wall square between two floors is a door (a dashed line), not a wall. */
const DOOR_INK = 0.12;
/** A square this full of grey speckle is solid: wall shading, or rock between rooms. */
const SOLID_SPECKLE = 0.08;
/** Smallest and largest grid squares looked for, in pixels. */
const MIN_SQUARE = 8;
const MAX_SQUARE = 120;

function luminance(image: Pixels, at: number): number {
  const d = image.data;
  return 0.299 * (d[at] ?? 0) + 0.587 * (d[at + 1] ?? 0) + 0.114 * (d[at + 2] ?? 0);
}

function saturation(image: Pixels, at: number): number {
  const d = image.data;
  const r = d[at] ?? 0;
  const g = d[at + 1] ?? 0;
  const b = d[at + 2] ?? 0;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * The period and offset of evenly spaced lines in a profile (how many
 * grid-line pixels each column or row has). Periods are found to a tenth of
 * a pixel: a page drawn at any size rarely has whole-pixel squares.
 */
function period(profile: readonly number[]): { square: number; offset: number; strength: number } {
  const mean = profile.reduce((total, value) => total + value, 0) / Math.max(1, profile.length);
  const at = (index: number) => {
    const i = Math.round(index);
    // A line can be a pixel either way.
    return Math.max(profile[i] ?? 0, profile[i - 1] ?? 0, profile[i + 1] ?? 0);
  };
  const scores: { square: number; offset: number; score: number }[] = [];
  for (let tenths = MIN_SQUARE * 10; tenths <= Math.min(MAX_SQUARE, profile.length / 3) * 10; tenths++) {
    const square = tenths / 10;
    let best = { offset: 0, score: -Infinity };
    for (let offset = 0; offset < square; offset++) {
      let total = 0;
      let count = 0;
      for (let index = offset; index < profile.length; index += square) {
        total += at(index);
        count++;
      }
      const score = total / count - mean;
      if (score > best.score) best = { offset, score };
    }
    scores.push({ square, ...best });
  }
  const top = Math.max(...scores.map((entry) => entry.score));
  // Twice the true square also lines up (every other line): take the smallest that scores nearly as well.
  const chosen = scores.find((entry) => entry.score >= top * 0.8) ?? scores[0]!;
  // A grid has lines all the way across: at least four that stand out.
  let lines = 0;
  for (let index = chosen.offset; index < profile.length; index += chosen.square) if (at(index) >= mean + chosen.score / 2) lines++;
  return { square: chosen.square, offset: chosen.offset, strength: mean > 0 && lines >= 4 ? top / mean : 0 };
}

/** The grid in a picture: the square's size and offset. Null when there's no clear grid. */
export function findGrid(image: Pixels): { square: number; x: number; y: number } | null {
  const columns = new Array<number>(image.width).fill(0);
  const rows = new Array<number>(image.height).fill(0);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      const value = luminance(image, at);
      if (value >= GRID_LOW && value <= GRID_HIGH && saturation(image, at) < 30) {
        columns[x]!++;
        rows[y]!++;
      }
    }
  }
  const across = period(columns);
  const down = period(rows);
  if (across.strength < 0.5 || down.strength < 0.5) return null;
  // Squares are square: trust the clearer axis if they disagree.
  const square = Math.abs(across.square - down.square) <= 0.5 ? (across.square + down.square) / 2 : across.strength >= down.strength ? across.square : down.square;
  return { square, x: across.offset, y: down.offset };
}

/** Pixels of the picture that can be reached from its edges without crossing ink (thickened by `reach`, to close gaps such as dashed doors). */
function outsidePixels(image: Pixels, reach: number): Uint8Array {
  const { width, height } = image;
  const ink = new Uint8Array(width * height);
  // Ink, and strongly coloured marks (an area's label is often drawn over its walls).
  for (let at = 0; at < width * height; at++) if (luminance(image, at * 4) < INK || saturation(image, at * 4) > 60) ink[at] = 1;
  // Thicken ink, so a gap in a wall (a dashed door, a crack) doesn't let the outside in.
  const solid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink[y * width + x]) continue;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) solid[ny * width + nx] = 1;
        }
      }
    }
  }
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    const at = y * width + x;
    if (solid[at] || outside[at]) return;
    outside[at] = 1;
    stack.push(at);
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    visit(0, y);
    visit(width - 1, y);
  }
  while (stack.length > 0) {
    const at = stack.pop() as number;
    const x = at % width;
    const y = Math.floor(at / width);
    if (x > 0) visit(x - 1, y);
    if (x < width - 1) visit(x + 1, y);
    if (y > 0) visit(x, y - 1);
    if (y < height - 1) visit(x, y + 1);
  }
  return outside;
}

/** Traces a map picture into squares of wall, floor, and outside. Null when it has no clear grid. */
export function traceMap(image: Pixels): TracedMap | null {
  const grid = findGrid(image);
  if (!grid) return null;
  const { square } = grid;
  const outside = outsidePixels(image, Math.max(2, Math.round(square * 0.15)));
  const startX = grid.x - Math.ceil(grid.x / square) * square;
  const startY = grid.y - Math.ceil(grid.y / square) * square;
  const across = Math.ceil((image.width - startX) / square);
  const down = Math.ceil((image.height - startY) / square);

  const all: TracedCell[] = [];
  /** How inked each square's middle is (doors are lightly inked). */
  const inkiness: number[] = [];
  for (let row = 0; row < down; row++) {
    for (let column = 0; column < across; column++) {
      let ink = 0;
      let speckle = 0;
      let out = 0;
      let count = 0;
      let centre = 0;
      for (let y = Math.max(0, Math.round(startY + row * square)); y < Math.min(image.height, Math.round(startY + (row + 1) * square)); y++) {
        for (let x = Math.max(0, Math.round(startX + column * square)); x < Math.min(image.width, Math.round(startX + (column + 1) * square)); x++) {
          const at = y * image.width + x;
          const value = luminance(image, at * 4);
          if (outside[at] && value >= INK) out++;
          count++;
          // What the square holds is judged by its middle: a wall along its edge (and its shadow) spills a little over.
          const middle = Math.abs(x - (startX + (column + 0.5) * square)) < square * 0.3 && Math.abs(y - (startY + (row + 0.5) * square)) < square * 0.3;
          if (!middle) continue;
          centre++;
          if (value < INK) ink++;
          else if (value < 215 && saturation(image, at * 4) < 40) speckle++;
        }
      }
      // Inside the building (walls included) or out.
      const inside = count > 0 && 1 - out / count >= 0.5;
      // Floor is clean paper (grid lines aside); walls, their shading, and rock are inked or speckled grey.
      const solid = centre > 0 && (ink / centre >= WALL_INK || speckle / centre >= SOLID_SPECKLE);
      all.push(!inside ? 'outside' : solid ? 'wall' : 'floor');
      inkiness.push(centre > 0 ? ink / centre : 0);
    }
  }

  // Doorways: a lightly inked square of wall (a dashed door line) with floor on both sides.
  const kindAt = (x: number, y: number) => (x < 0 || y < 0 || x >= across || y >= down ? 'outside' : all[y * across + x]);
  for (let at = 0; at < all.length; at++) {
    if (all[at] !== 'wall' || (inkiness[at] ?? 1) >= DOOR_INK) continue;
    const x = at % across;
    const y = Math.floor(at / across);
    const across2 = kindAt(x - 1, y) === 'floor' && kindAt(x + 1, y) === 'floor';
    const down2 = kindAt(x, y - 1) === 'floor' && kindAt(x, y + 1) === 'floor';
    if (across2 || down2) all[at] = 'floor';
  }

  // Specks of "inside" (in a scale box, a rubble ring) are outside: floor counts only in rooms of a few squares.
  const keep = new Uint8Array(all.length);
  const seen = new Uint8Array(all.length);
  for (let start = 0; start < all.length; start++) {
    if (all[start] !== 'floor' || seen[start]) continue;
    const room: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      room.push(at);
      const x = at % across;
      const y = Math.floor(at / across);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        const next = ny * across + nx;
        if (nx >= 0 && ny >= 0 && nx < across && ny < down && !seen[next] && all[next] === 'floor') {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (room.length >= 4) for (const at of room) keep[at] = 1;
  }
  const cleaned = all.map((cell, at): TracedCell => (cell === 'floor' && !keep[at] ? 'outside' : cell));
  // The building's edge is its wall: every square of it that touches the outside.
  const isOut = (x: number, y: number) => x < 0 || y < 0 || x >= across || y >= down || cleaned[y * across + x] === 'outside';
  const edged = cleaned.map((cell, at): TracedCell => {
    if (cell !== 'floor') return cell;
    const x = at % across;
    const y = Math.floor(at / across);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isOut(x + dx, y + dy)) return 'wall';
    return cell;
  });
  const floors = edged.filter((cell) => cell === 'floor').length;
  const outdoor = floors < edged.length * 0.03;

  // Walls only where they border floor (lone ink, like text or rubble, is outside); then cut to the map, plus a margin.
  const near = (at: number) => {
    const x = at % across;
    const y = Math.floor(at / across);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (edged[(y + dy) * across + x + dx] === 'floor' && x + dx >= 0 && x + dx < across) return true;
    return false;
  };
  const marked = outdoor ? all.map((cell): TracedCell => (cell === 'wall' ? 'wall' : 'floor')) : edged.map((cell, at): TracedCell => (cell === 'wall' && !near(at) ? 'outside' : cell));
  const used = marked.map((cell, at) => (cell !== 'outside' ? at : -1)).filter((at) => at >= 0);
  if (used.length === 0) return null;
  const xs = used.map((at) => at % across);
  const ys = used.map((at) => Math.floor(at / across));
  const [x0, x1, y0, y1] = [Math.max(0, Math.min(...xs) - 1), Math.min(across - 1, Math.max(...xs) + 1), Math.max(0, Math.min(...ys) - 1), Math.min(down - 1, Math.max(...ys) + 1)];
  const cells: TracedCell[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(marked[y * across + x] ?? 'outside');
  return { width: x1 - x0 + 1, height: y1 - y0 + 1, cells, square, origin: { x: startX + x0 * square, y: startY + y0 * square }, outdoor };
}

/** A traced map as text, a row of letters per row: # wall, . floor, space outside (for the AI, and for checking). */
export function tracedText(traced: TracedMap): string {
  const rows: string[] = [];
  for (let y = 0; y < traced.height; y++) {
    rows.push(
      traced.cells
        .slice(y * traced.width, (y + 1) * traced.width)
        .map((cell) => (cell === 'wall' ? '#' : cell === 'floor' ? '.' : ' '))
        .join('')
        .replace(/\s+$/, ''),
    );
  }
  return rows.join('\n');
}
