import { type Cell, cellKey } from '../grid';
import { type Tile, type WorldMap, objectInfo, sharesEdge } from '../map';

/**
 * Line of sight on the map: walls, tall objects (trees, boulders, pillars),
 * solid rock, and higher ground block the view; low objects (crates,
 * flowers) and deep water don't. Creatures don't block it. Used for
 * targeting and for fog of war.
 */

/** Eye height above the tile a creature stands on, in levels. */
export const EYE_HEIGHT = 1.5;
/** Where a viewer aims at a target: about the middle of its body, in levels above its tile. */
export const TARGET_HEIGHT = 1;

/** Whether a tile in between hides what is behind it (heights aside). */
function hidesView(tile: Tile): boolean {
  if (tile.object) return objectInfo(tile.object)?.blocksSight ?? true;
  // Solid tiles with nothing on them are rock or crags, except deep water, which is flat.
  return tile.blocked && tile.terrain !== 'water';
}

/** Whether the view passes from one cell to the next along a line. */
function stepIsOpen(map: WorldMap, from: Cell, to: Cell): boolean {
  if (sharesEdge(map.grid, from, to)) return !map.hasWall(from, to);
  // A diagonal step on a square grid slips past a corner: open if either way round is.
  const viaColumn = { q: to.q, r: from.r };
  const viaRow = { q: from.q, r: to.r };
  const around = (via: Cell) => {
    const tile = map.tile(via);
    return !map.hasWall(from, via) && !map.hasWall(via, to) && !(tile && hidesView(tile));
  };
  return around(viaColumn) || around(viaRow);
}

export function hasLineOfSight(map: WorldMap, from: Cell, to: Cell): boolean {
  if (from.q === to.q && from.r === to.r) return true;
  const line = map.grid.line(from, to);
  const eye = (map.tile(from)?.height ?? 0) + EYE_HEIGHT;
  const aim = (map.tile(to)?.height ?? 0) + TARGET_HEIGHT;
  const steps = line.length - 1;
  for (let i = 1; i < line.length; i++) {
    const here = line[i] as Cell;
    if (!stepIsOpen(map, line[i - 1] as Cell, here)) return false;
    if (i === steps) break; // the target's own tile never hides it
    const tile = map.tile(here);
    if (!tile) continue; // a gap in the world hides nothing
    if (hidesView(tile)) return false;
    // The line from the eye to the target, at this point along the way.
    const sight = eye + ((aim - eye) * i) / steps;
    if (tile.height > sight) return false;
  }
  return true;
}

/** Every cell on the map within `range` steps that can be seen from `from` (including itself). */
export function visibleCells(map: WorldMap, from: Cell, range: number): Cell[] {
  const seen = new Map<string, Cell>();
  for (const cell of map.grid.range(from, range)) {
    if (map.inBounds(cell) && hasLineOfSight(map, from, cell)) seen.set(cellKey(cell), cell);
  }
  return [...seen.values()];
}

/** How far creatures see, in tiles, when fog of war is on. */
export const VISION_RANGE = 10;

/** Keys of every cell any of the viewers can see (fog of war: what a player's creatures see together). */
export function sightOf(map: WorldMap, viewers: readonly Cell[], range: number): string[] {
  const seen = new Set<string>();
  for (const viewer of viewers) {
    for (const cell of visibleCells(map, viewer, range)) seen.add(cellKey(cell));
  }
  return [...seen];
}
