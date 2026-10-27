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
  /** Thin walls drawn along grid lines (a building's), between a square and the one east or south of it. */
  readonly walls?: readonly TracedWall[];
}

export interface TracedWall {
  readonly x: number;
  readonly y: number;
  readonly side: 'east' | 'south';
}

/** Darker than this is ink: walls, outlines, text. */
const INK = 100;
/** Grid lines are faint grey: a little darker than the paper, not ink, not coloured. */
const GRID_LOW = 150;
const GRID_HIGH = 248;
/** A thin grid line has paper (this light) this many pixels to either side. */
const LINE_SIDE = 3;
const PAPER = 200;
/** On a cave map, a square this inked (or this shaded, ink and grey together) is rock. */
const CAVE_ROCK_INK = 0.25;
const CAVE_ROCK_SHADE = 0.55;
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
  // Only where the lines are: a grid over part of the page (a cave's floor) has none in the margins,
  // where a wide spacing would otherwise score well by landing on just a few lines.
  const highest = Math.max(0, ...profile);
  const first = highest > 0 ? profile.findIndex((value) => value >= highest * 0.2) : 0;
  const last = highest > 0 ? profile.length - 1 - [...profile].reverse().findIndex((value) => value >= highest * 0.2) : profile.length - 1;
  const scores: { square: number; offset: number; score: number }[] = [];
  for (let tenths = MIN_SQUARE * 10; tenths <= Math.min(MAX_SQUARE, profile.length / 3) * 10; tenths++) {
    const square = tenths / 10;
    let best = { offset: 0, score: -Infinity };
    for (let offset = 0; offset < square; offset++) {
      let total = 0;
      let count = 0;
      for (let index = offset; index < profile.length; index += square) {
        if (index < first - 1 || index > last + 1) continue;
        total += at(index);
        count++;
      }
      if (count === 0) continue;
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

/**
 * The grid in a picture: the square's size and offset. Null when there's no
 * clear grid. Grids are drawn two ways: faint grey lines over the whole page,
 * or thin dark lines (often among heavy ink, like a cave's hatched rock). The
 * faint count is used when it finds a grid both ways that agrees (it's the
 * more precise); the thin one otherwise.
 */
export function findGrid(image: Pixels): { square: number; x: number; y: number } | null {
  const faint = { columns: new Array<number>(image.width).fill(0), rows: new Array<number>(image.height).fill(0) };
  const thin = { columns: new Array<number>(image.width).fill(0), rows: new Array<number>(image.height).fill(0) };
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      const value = luminance(image, at);
      if (value >= GRID_LOW && value <= GRID_HIGH && saturation(image, at) < 30) {
        faint.columns[x]!++;
        faint.rows[y]!++;
      }
      if (onLine(image, x, y, true) && runsOn(image, x, y, true)) thin.columns[x]!++;
      if (onLine(image, x, y, false) && runsOn(image, x, y, false)) thin.rows[y]!++;
    }
  }
  const found = [faint, thin].map((profile) => ({ across: period(profile.columns), down: period(profile.rows) }));
  const agrees = (entry: (typeof found)[number]) => entry.across.strength >= 0.5 && entry.down.strength >= 0.5 && Math.abs(entry.across.square - entry.down.square) <= 0.5;
  const { across, down } = agrees(found[0]!) || !agrees(found[1]!) ? found[0]! : found[1]!;
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
  return traceLined(image, grid) ?? traceWalled(image, grid);
}

/** Whether a pixel is on a thin line running down (or, with `down` false, across): darker than the paper a few pixels to either side. */
function onLine(image: Pixels, x: number, y: number, down: boolean): boolean {
  const [ax, ay, bx, by] = down ? [x - LINE_SIDE, y, x + LINE_SIDE, y] : [x, y - LINE_SIDE, x, y + LINE_SIDE];
  if (ax < 0 || ay < 0 || bx >= image.width || by >= image.height) return false;
  const value = luminance(image, (y * image.width + x) * 4);
  const a = luminance(image, (ay * image.width + ax) * 4);
  const b = luminance(image, (by * image.width + bx) * 4);
  return value < a - 12 && value < b - 12 && Math.min(a, b) > PAPER;
}

/** Whether a thin line goes on along its way (a grid line does; a letter's stroke, a few pixels long, doesn't), wandering a pixel at most. */
function runsOn(image: Pixels, x: number, y: number, down: boolean): boolean {
  let found = 0;
  for (const step of [-6, -3, 3, 6]) {
    const near = [-1, 0, 1].some((side) => (down ? onLine(image, x + side, y + step, true) : onLine(image, x + step, y + side, false)));
    if (near) found++;
  }
  return found >= 3;
}

/**
 * Cave-style maps (Dyson Logos' and many others): rock drawn as heavy
 * hatching, the grid drawn only on the floor, blank paper outside. A square
 * is rock if it's inked, floor if its grid lines show, and outside if it's
 * blank paper reached from the page's edge without crossing rock or floor.
 * Buildings' walls are thick lines along the grid, found between squares.
 * Null when the picture isn't drawn this way (the grid covers the outside too).
 */
function traceLined(image: Pixels, grid: { square: number; x: number; y: number }): TracedMap | null {
  const { square } = grid;
  const startX = grid.x - Math.ceil(grid.x / square) * square;
  const startY = grid.y - Math.ceil(grid.y / square) * square;
  const across = Math.ceil((image.width - startX) / square);
  const down = Math.ceil((image.height - startY) / square);
  const lum = (x: number, y: number) => luminance(image, (y * image.width + x) * 4);
  const inPicture = (x: number, y: number) => x >= 0 && y >= 0 && x < image.width && y < image.height;

  const rock = new Uint8Array(across * down);
  const lined = new Uint8Array(across * down);
  /** Empty paper: no grid, no drawing. */
  const blank = new Uint8Array(across * down);
  for (let row = 0; row < down; row++) {
    for (let column = 0; column < across; column++) {
      const left = startX + column * square;
      const top = startY + row * square;
      // Ink and grey shading in the middle of the square.
      let ink = 0;
      let grey = 0;
      let count = 0;
      for (let y = Math.round(top + square * 0.15); y < Math.round(top + square * 0.85); y++) {
        for (let x = Math.round(left + square * 0.15); x < Math.round(left + square * 0.85); x++) {
          if (!inPicture(x, y)) continue;
          count++;
          const value = lum(x, y);
          if (value < INK) ink++;
          else if (value < 215) grey++;
        }
      }
      const at = row * across + column;
      if (count > 0 && (ink / count >= CAVE_ROCK_INK || (ink + grey) / count >= CAVE_ROCK_SHADE)) rock[at] = 1;
      if (count > 0 && (ink + grey) / count < 0.03) blank[at] = 1;
      // Grid lines along its edges (hand-drawn lines wander a few pixels).
      let edges = 0;
      for (const [vertical, line] of [
        [true, left],
        [true, left + square],
        [false, top],
        [false, top + square],
      ] as const) {
        let hits = 0;
        for (let step = 0; step <= 12; step++) {
          const along = 0.2 + (0.6 * step) / 12;
          const [x, y] = vertical ? [Math.round(line), Math.round(top + square * along)] : [Math.round(left + square * along), Math.round(line)];
          if ([-3, -2, -1, 0, 1, 2, 3].some((shift) => (vertical ? onLine(image, x + shift, y, true) : onLine(image, x, y + shift, false)))) hits++;
        }
        if (hits / 13 >= 0.4) edges++;
      }
      if (edges >= 2) lined[at] = 1;
    }
  }
  // Drawn this way only if the outside is blank: a fair share of the uninked squares have no grid
  // (not counting the picture's edge, where a square's lines may be cut off).
  let open = 0;
  let unlined = 0;
  for (let at = 0; at < rock.length; at++) {
    const column = at % across;
    const row = Math.floor(at / across);
    if (rock[at] || column === 0 || row === 0 || column === across - 1 || row === down - 1) continue;
    open++;
    if (!lined[at]) unlined++;
  }
  if (open === 0 || unlined / open < 0.15 || unlined / open > 0.85) return null;

  // Outside: blank squares reached from the edge through blank squares.
  const outside = new Uint8Array(across * down);
  const stack: number[] = [];
  const visit = (column: number, row: number) => {
    const at = row * across + column;
    if (column < 0 || row < 0 || column >= across || row >= down || outside[at] || rock[at] || lined[at]) return;
    outside[at] = 1;
    stack.push(at);
  };
  for (let column = 0; column < across; column++) {
    visit(column, 0);
    visit(column, down - 1);
  }
  for (let row = 0; row < down; row++) {
    visit(0, row);
    visit(across - 1, row);
  }
  while (stack.length > 0) {
    const at = stack.pop() as number;
    const column = at % across;
    const row = Math.floor(at / across);
    visit(column - 1, row);
    visit(column + 1, row);
    visit(column, row - 1);
    visit(column, row + 1);
  }
  // Pockets of empty paper walled in by rock (unmapped, not floor): ungridded patches that are mostly blank.
  const seen = new Uint8Array(across * down);
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || rock[start] || lined[start] || outside[start]) continue;
    const pocket: number[] = [];
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const at = queue.pop() as number;
      pocket.push(at);
      const column = at % across;
      const row = Math.floor(at / across);
      for (const [nx, ny] of [
        [column - 1, row],
        [column + 1, row],
        [column, row - 1],
        [column, row + 1],
      ] as const) {
        const next = ny * across + nx;
        if (nx >= 0 && ny >= 0 && nx < across && ny < down && !seen[next] && !rock[next] && !lined[next] && !outside[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    if (pocket.length >= 4 && pocket.filter((at) => blank[at]).length >= pocket.length * 0.7) for (const at of pocket) outside[at] = 1;
  }
  // Specks of floor out among the rock (a line or two of hatching that looked like grid) are outside; a small cave walled in by rock is kept.
  const all = withoutSpecks(
    Array.from(rock, (solid, at): TracedCell => (solid ? 'wall' : outside[at] ? 'outside' : 'floor')),
    across,
    down,
    true,
  );
  const kindAt = (column: number, row: number) => (column < 0 || row < 0 || column >= across || row >= down ? 'outside' : all[row * across + column]);
  // Rock only where it borders floor (the rest is the drawing's edge).
  const marked = all.map((cell, at): TracedCell => {
    if (cell !== 'wall') return cell;
    const column = at % across;
    const row = Math.floor(at / across);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (kindAt(column + dx, row + dy) === 'floor') return cell;
    return 'outside';
  });
  if (!marked.includes('floor')) return null;

  // Thick walls along grid lines between two floor squares (a building's), with gaps for doors.
  const walls: TracedWall[] = [];
  const thick = Math.max(3, Math.round(square * 0.1));
  for (let row = 0; row < down; row++) {
    for (let column = 0; column < across; column++) {
      if (marked[row * across + column] !== 'floor') continue;
      for (const side of ['east', 'south'] as const) {
        const [nx, ny] = side === 'east' ? [column + 1, row] : [column, row + 1];
        if (nx >= across || ny >= down || marked[ny * across + nx] !== 'floor') continue;
        const line = side === 'east' ? startX + nx * square : startY + ny * square;
        let solid = 0;
        for (let step = 0; step <= 14; step++) {
          const fixed = Math.round((side === 'east' ? startY + row * square : startX + column * square) + square * (0.15 + (0.7 * step) / 14));
          // Across the line: a run of ink at least `thick` wide, close to it.
          let run = 0;
          let best = 0;
          for (let offset = -thick * 2; offset <= thick * 2; offset++) {
            const [x, y] = side === 'east' ? [Math.round(line) + offset, fixed] : [fixed, Math.round(line) + offset];
            run = inPicture(x, y) && lum(x, y) < INK ? run + 1 : 0;
            best = Math.max(best, run);
          }
          if (best >= thick) solid++;
        }
        if (solid / 15 >= 0.6) walls.push({ x: column, y: row, side });
      }
    }
  }

  const used = marked.map((cell, at) => (cell !== 'outside' ? at : -1)).filter((at) => at >= 0);
  const xs = used.map((at) => at % across);
  const ys = used.map((at) => Math.floor(at / across));
  const [x0, x1, y0, y1] = [Math.max(0, Math.min(...xs) - 1), Math.min(across - 1, Math.max(...xs) + 1), Math.max(0, Math.min(...ys) - 1), Math.min(down - 1, Math.max(...ys) + 1)];
  const cells: TracedCell[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(marked[y * across + x] ?? 'outside');
  return {
    width: x1 - x0 + 1,
    height: y1 - y0 + 1,
    cells,
    square,
    origin: { x: startX + x0 * square, y: startY + y0 * square },
    outdoor: false,
    walls: walls.map((wall) => ({ ...wall, x: wall.x - x0, y: wall.y - y0 })),
  };
}

/** The squares with floor patches of fewer than 4 squares made outside (with `keepEnclosed`, only those that touch the outside). */
function withoutSpecks(cells: readonly TracedCell[], across: number, down: number, keepEnclosed = false): TracedCell[] {
  const isOut = (x: number, y: number) => x < 0 || y < 0 || x >= across || y >= down || cells[y * across + x] === 'outside';
  const keep = new Uint8Array(cells.length);
  const seen = new Uint8Array(cells.length);
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] !== 'floor' || seen[start]) continue;
    const patch: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      patch.push(at);
      const x = at % across;
      const y = Math.floor(at / across);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        const next = ny * across + nx;
        if (nx >= 0 && ny >= 0 && nx < across && ny < down && !seen[next] && cells[next] === 'floor') {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    const enclosed = patch.every((at) => {
      const x = at % across;
      const y = Math.floor(at / across);
      return !isOut(x - 1, y) && !isOut(x + 1, y) && !isOut(x, y - 1) && !isOut(x, y + 1);
    });
    if (patch.length >= 4 || (keepEnclosed && enclosed)) for (const at of patch) keep[at] = 1;
  }
  return cells.map((cell, at) => (cell === 'floor' && !keep[at] ? 'outside' : cell));
}

/** Building maps: walls drawn dark on a grid that covers the whole page. */
function traceWalled(image: Pixels, grid: { square: number; x: number; y: number }): TracedMap | null {
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
  const cleaned = withoutSpecks(all, across, down);
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
