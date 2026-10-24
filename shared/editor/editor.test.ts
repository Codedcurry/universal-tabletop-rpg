import { describe, expect, it } from 'vitest';
import { type Cell, cellKey } from '../grid';
import { MAX_HEIGHT, MAX_TILES, MIN_HEIGHT, type MapData, MapError, createWorldMap } from '../map';
import {
  EMPTY_HISTORY,
  MAX_HISTORY,
  applyEdit,
  applyPatch,
  blankMap,
  diffMaps,
  isEmptyPatch,
  recordChange,
  redo,
  undo,
} from './index';

const c = (q: number, r: number): Cell => ({ q, r });

function heightAt(map: MapData, cell: Cell): number | undefined {
  return map.tiles.find((tile) => cellKey(tile) === cellKey(cell))?.height;
}

const base = blankMap('square', 4, 4);

describe('blankMap', () => {
  it('makes a flat grass map of the given size', () => {
    const map = blankMap('hex', 4, 3);
    expect(map.grid).toBe('hex');
    expect(map.tiles).toHaveLength(12);
    expect(map.tiles.every((tile) => tile.height === 0 && tile.terrain === 'grass' && !tile.blocked)).toBe(true);
    expect(map.walls).toEqual([]);
  });

  it('can start at another height and terrain', () => {
    const map = blankMap('square', 2, 2, { height: 3, terrain: 'stone' });
    expect(map.tiles.every((tile) => tile.height === 3 && tile.terrain === 'stone')).toBe(true);
  });

  it('is already in canonical form', () => {
    expect(createWorldMap(base).toData()).toEqual(base);
  });
});

describe('edits', () => {
  it('raises only the chosen tiles', () => {
    const map = applyEdit(base, { type: 'raise', cells: [c(0, 0), c(1, 0)], amount: 2 });
    expect(heightAt(map, c(0, 0))).toBe(2);
    expect(heightAt(map, c(1, 0))).toBe(2);
    expect(heightAt(map, c(2, 0))).toBe(0);
  });

  it('keeps heights within the allowed range', () => {
    const high = applyEdit(base, { type: 'raise', cells: [c(0, 0)], amount: MAX_HEIGHT + 5 });
    expect(heightAt(high, c(0, 0))).toBe(MAX_HEIGHT);
    const low = applyEdit(base, { type: 'raise', cells: [c(0, 0)], amount: -3 });
    expect(heightAt(low, c(0, 0))).toBe(MIN_HEIGHT);
    expect(heightAt(applyEdit(base, { type: 'setHeight', cells: [c(1, 1)], height: 99 }), c(1, 1))).toBe(MAX_HEIGHT);
  });

  it('ignores cells outside the world for tile edits', () => {
    expect(applyEdit(base, { type: 'raise', cells: [c(50, 50)], amount: 1 })).toEqual(base);
    expect(applyEdit(base, { type: 'setTerrain', cells: [c(-1, 0)], terrain: 'sand' })).toEqual(base);
  });

  it('paints terrain and blocks tiles', () => {
    let map = applyEdit(base, { type: 'setTerrain', cells: [c(2, 2)], terrain: 'water' });
    map = applyEdit(map, { type: 'setBlocked', cells: [c(2, 2)], blocked: true });
    expect(createWorldMap(map).tile(c(2, 2))).toEqual({ height: 0, terrain: 'water', blocked: true });
  });

  it('adds tiles only where there are none, and removes tiles', () => {
    const raised = applyEdit(base, { type: 'raise', cells: [c(0, 0)], amount: 1 });
    const grown = applyEdit(raised, { type: 'addTiles', cells: [c(0, 0), c(4, 0)], height: 2, terrain: 'sand' });
    expect(heightAt(grown, c(0, 0))).toBe(1);
    expect(createWorldMap(grown).tile(c(4, 0))).toEqual({ height: 2, terrain: 'sand', blocked: false });
    const shrunk = applyEdit(grown, { type: 'removeTiles', cells: [c(4, 0), c(3, 3)] });
    expect(shrunk.tiles).toHaveLength(15);
    expect(createWorldMap(shrunk).inBounds(c(3, 3))).toBe(false);
  });

  it('refuses to grow the world past the tile limit', () => {
    const big = blankMap('square', 100, 100);
    expect(big.tiles).toHaveLength(MAX_TILES);
    expect(() => applyEdit(big, { type: 'addTiles', cells: [c(100, 0)], height: 0, terrain: 'grass' })).toThrow(MapError);
  });

  it('adds and removes walls on shared edges only', () => {
    const walled = applyEdit(base, { type: 'setWall', a: c(1, 1), b: c(2, 1), present: true });
    expect(createWorldMap(walled).hasWall(c(2, 1), c(1, 1))).toBe(true);
    const cleared = applyEdit(walled, { type: 'setWall', a: c(2, 1), b: c(1, 1), present: false });
    expect(cleared.walls).toEqual([]);
    expect(() => applyEdit(base, { type: 'setWall', a: c(0, 0), b: c(2, 0), present: true })).toThrow(MapError);
  });

  it('never changes the map it was given', () => {
    const before = JSON.stringify(base);
    applyEdit(base, { type: 'raise', cells: [c(0, 0)], amount: 1 });
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('patches', () => {
  // Every change is sent and undone as a patch: just the tiles and walls that differ.
  const after = [
    { type: 'raise', cells: [c(0, 0), c(1, 1)], amount: 2 },
    { type: 'setTerrain', cells: [c(2, 2)], terrain: 'stone' },
    { type: 'setBlocked', cells: [c(3, 0)], blocked: true },
    { type: 'removeTiles', cells: [c(3, 3)] },
    { type: 'addTiles', cells: [c(4, 1)], height: 1, terrain: 'sand' },
    { type: 'setWall', a: c(0, 1), b: c(0, 2), present: true },
  ].reduce((map, edit) => applyEdit(map, edit as Parameters<typeof applyEdit>[1]), base);

  it('is empty between identical maps', () => {
    expect(isEmptyPatch(diffMaps(base, base))).toBe(true);
  });

  it('turns one map into the other', () => {
    expect(applyPatch(base, diffMaps(base, after))).toEqual(after);
    expect(applyPatch(after, diffMaps(after, base))).toEqual(base);
  });

  it('only carries what changed', () => {
    const patch = diffMaps(base, after);
    expect(patch.tiles).toHaveLength(5); // 2 raised, 1 painted, 1 blocked, 1 added
    expect(patch.removeTiles).toEqual([c(3, 3)]);
    expect(patch.addWalls).toHaveLength(1);
    expect(patch.removeWalls).toEqual([]);
  });

  it('survives being sent as JSON', () => {
    const patch = JSON.parse(JSON.stringify(diffMaps(base, after)));
    expect(applyPatch(base, patch)).toEqual(after);
  });

  it('refuses a patch that would make an invalid map', () => {
    const bad = { tiles: [{ q: 0, r: 0, height: MAX_HEIGHT + 1 }], removeTiles: [], addWalls: [], removeWalls: [] };
    expect(() => applyPatch(base, bad)).toThrow(MapError);
  });
});

describe('undo and redo', () => {
  const raised = applyEdit(base, { type: 'raise', cells: [c(0, 0)], amount: 1 });
  const painted = applyEdit(raised, { type: 'setTerrain', cells: [c(1, 0)], terrain: 'sand' });

  it('undoes and redoes a change, returning the patch it applied', () => {
    const history = recordChange(EMPTY_HISTORY, base, raised);
    const undone = undo(history, raised);
    expect(undone?.map).toEqual(base);
    expect(applyPatch(raised, undone!.patch)).toEqual(base);
    const redone = redo(undone!.history, undone!.map);
    expect(redone?.map).toEqual(raised);
  });

  it('steps back through several changes in order', () => {
    let history = recordChange(EMPTY_HISTORY, base, raised);
    history = recordChange(history, raised, painted);
    const first = undo(history, painted)!;
    expect(first.map).toEqual(raised);
    const second = undo(first.history, first.map)!;
    expect(second.map).toEqual(base);
    expect(undo(second.history, second.map)).toBeNull();
  });

  it('forgets redo once a new change is made', () => {
    let history = recordChange(EMPTY_HISTORY, base, raised);
    history = undo(history, raised)!.history;
    history = recordChange(history, base, painted);
    expect(redo(history, painted)).toBeNull();
  });

  it('has nothing to undo or redo at first', () => {
    expect(undo(EMPTY_HISTORY, base)).toBeNull();
    expect(redo(EMPTY_HISTORY, base)).toBeNull();
  });

  it('ignores changes that change nothing', () => {
    expect(recordChange(EMPTY_HISTORY, base, base)).toEqual(EMPTY_HISTORY);
  });

  it(`keeps the last ${MAX_HISTORY} changes`, () => {
    let map = base;
    let history = EMPTY_HISTORY;
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      const next = applyEdit(map, { type: 'setHeight', cells: [c(0, 0)], height: (i % 5) + 1 });
      history = recordChange(history, map, next);
      map = next;
    }
    let undos = 0;
    for (let step = undo(history, map); step; step = undo(step.history, step.map)) undos++;
    expect(undos).toBe(MAX_HISTORY);
  });
});
