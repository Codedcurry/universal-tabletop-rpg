import { type Cell, cell, cellKey, cellsEqual } from '../grid';
import type { WorldMap } from '../map';

/** Height rules for walking, taken from the game system's movement section. */
export interface MovementRules {
  readonly maxStepUp: number;
  readonly maxStepDown: number;
  readonly climb?: { readonly maxHeight: number; readonly costPerLevel: number };
}

/** Who stands on a cell, from the mover's point of view. Allies can be passed through; enemies block. */
export type Occupant = 'ally' | 'enemy';

export interface MovementContext {
  readonly map: WorldMap;
  readonly rules: MovementRules;
  /** Occupied cells, keyed by cellKey. Nobody can end a move on an occupied cell. */
  readonly occupants?: ReadonlyMap<string, Occupant>;
}

export interface Reach {
  readonly cell: Cell;
  readonly cost: number;
  /** From the start to this cell, inclusive. */
  readonly path: readonly Cell[];
}

/**
 * Movement cost of one step between neighboring cells, or null if the step is
 * not allowed (outside the world, blocked, walled off, too steep, an enemy in
 * the way, or cutting a corner on a square grid).
 */
export function stepCost(ctx: MovementContext, from: Cell, to: Cell): number | null {
  const { map, rules } = ctx;
  if (map.grid.distance(from, to) !== 1) return null;
  const fromTile = map.tile(from);
  const toTile = map.tile(to);
  if (!fromTile || !toTile || toTile.blocked) return null;
  if (map.hasWall(from, to)) return null;
  if (ctx.occupants?.get(cellKey(to)) === 'enemy') return null;

  if (map.grid.kind === 'square' && from.q !== to.q && from.r !== to.r) {
    // A diagonal step passes the shared corner of two other cells. It can't
    // cut past a solid or missing cell there, or touch the end of a wall.
    for (const corner of [cell(to.q, from.r), cell(from.q, to.r)]) {
      const tile = map.tile(corner);
      if (!tile || tile.blocked) return null;
      if (map.hasWall(from, corner) || map.hasWall(to, corner)) return null;
    }
  }

  const rise = toTile.height - fromTile.height;
  if (-rise > rules.maxStepDown) return null;
  if (rise <= rules.maxStepUp) return 1;
  if (rules.climb && rise <= rules.climb.maxHeight) {
    return 1 + (rise - rules.maxStepUp) * rules.climb.costPerLevel;
  }
  return null;
}

// ---------------------------------------------------------------------------

interface QueueEntry {
  readonly key: string;
  readonly cost: number;
  readonly order: number;
}

/** Min-heap by cost, then insertion order, so results are deterministic. */
class PriorityQueue {
  private readonly heap: QueueEntry[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(entry: QueueEntry): void {
    const heap = this.heap;
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(heap[i] as QueueEntry, heap[parent] as QueueEntry)) break;
      [heap[i], heap[parent]] = [heap[parent] as QueueEntry, heap[i] as QueueEntry];
      i = parent;
    }
  }

  pop(): QueueEntry | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && this.less(heap[left] as QueueEntry, heap[smallest] as QueueEntry)) smallest = left;
        if (right < heap.length && this.less(heap[right] as QueueEntry, heap[smallest] as QueueEntry)) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest] as QueueEntry, heap[i] as QueueEntry];
        i = smallest;
      }
    }
    return top;
  }

  private less(a: QueueEntry, b: QueueEntry): boolean {
    return a.cost < b.cost || (a.cost === b.cost && a.order < b.order);
  }
}

interface Visit {
  readonly cell: Cell;
  readonly cost: number;
  readonly previous: string | null;
}

/** Dijkstra from `from` out to `budget`, stopping early once `target` is settled. */
function explore(ctx: MovementContext, from: Cell, budget: number, target?: Cell): Map<string, Visit> {
  const startKey = cellKey(from);
  const best = new Map<string, Visit>([[startKey, { cell: from, cost: 0, previous: null }]]);
  const settled = new Set<string>();
  const queue = new PriorityQueue();
  let order = 0;
  queue.push({ key: startKey, cost: 0, order: order++ });

  while (queue.size > 0) {
    const { key, cost } = queue.pop() as QueueEntry;
    if (settled.has(key)) continue;
    settled.add(key);
    const current = (best.get(key) as Visit).cell;
    if (target && cellsEqual(current, target)) break;

    for (const next of ctx.map.grid.neighbors(current)) {
      const step = stepCost(ctx, current, next);
      if (step === null) continue;
      const nextCost = cost + step;
      if (nextCost > budget) continue;
      const nextKey = cellKey(next);
      const known = best.get(nextKey);
      if (known && known.cost <= nextCost) continue;
      best.set(nextKey, { cell: next, cost: nextCost, previous: key });
      queue.push({ key: nextKey, cost: nextCost, order: order++ });
    }
  }
  return best;
}

function pathTo(visits: Map<string, Visit>, key: string): Cell[] {
  const path: Cell[] = [];
  for (let visit = visits.get(key); visit; visit = visit.previous === null ? undefined : visits.get(visit.previous)) {
    path.push(visit.cell);
  }
  return path.reverse();
}

function canStopOn(ctx: MovementContext, key: string): boolean {
  return !ctx.occupants?.has(key);
}

/** Every cell the mover can end on within `budget`, with the cheapest path to each. Excludes the start. */
export function reachable(ctx: MovementContext, from: Cell, budget: number): Map<string, Reach> {
  const visits = explore(ctx, from, budget);
  const result = new Map<string, Reach>();
  const startKey = cellKey(from);
  for (const [key, visit] of visits) {
    if (key === startKey || !canStopOn(ctx, key)) continue;
    result.set(key, { cell: visit.cell, cost: visit.cost, path: pathTo(visits, key) });
  }
  return result;
}

/** The cheapest path from `from` to `to` within `budget`, or null if the mover can't end there. */
export function findPath(
  ctx: MovementContext,
  from: Cell,
  to: Cell,
  budget = Infinity,
): { path: Cell[]; cost: number } | null {
  if (cellsEqual(from, to)) return { path: [from], cost: 0 };
  const key = cellKey(to);
  if (!ctx.map.inBounds(to) || !canStopOn(ctx, key)) return null;
  const visits = explore(ctx, from, budget, to);
  const visit = visits.get(key);
  if (!visit) return null;
  return { path: pathTo(visits, key), cost: visit.cost };
}
