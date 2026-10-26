import { describe, expect, it } from 'vitest';
import { applyPatch, diffMaps, recordChange, undo, EMPTY_HISTORY } from '../editor';
import { hasLineOfSight } from '../vision';
import { type CustomObject, type MapData, createWorldMap, customObjectProblem, rectangleTiles, validateMapData } from './index';

// Objects made for one map (by the AI, for an encounter): carried with the
// map, checked, looked up like built-in ones, saved, and undoable.

const sarcophagus: CustomObject = {
  id: 'sarcophagus',
  name: 'Stone sarcophagus',
  blocks: true,
  blocksSight: true,
  parts: [{ shape: 'box', size: [0.9, 1.4, 0.5], color: '#6a6670' }],
};

const map = (objects?: CustomObject[], object?: string): MapData => ({
  formatVersion: 1,
  grid: 'square',
  tiles: rectangleTiles('square', 5, 1).map((cell) => ({ ...cell, height: 0, ...(object && cell.q === 2 ? { object, blocked: true } : {}) })),
  walls: [],
  ...(objects ? { objects } : {}),
});

describe('a map\'s own objects', () => {
  it('are looked up like built-in ones, and kept with the map', () => {
    const world = createWorldMap(map([sarcophagus], 'sarcophagus'));
    expect(world.object('sarcophagus')).toEqual({ id: 'sarcophagus', name: 'Stone sarcophagus', category: 'custom', blocks: true, blocksSight: true });
    expect(world.object('tree')?.name).toBe('Tree');
    expect(world.toData().objects).toEqual([sarcophagus]);
    expect(createWorldMap(map()).toData()).not.toHaveProperty('objects');
  });

  it('block the view when they say so', () => {
    const seeThrough = { ...sarcophagus, id: 'rug', name: 'Rug', blocks: false, blocksSight: false };
    expect(hasLineOfSight(createWorldMap(map([sarcophagus], 'sarcophagus')), { q: 0, r: 0 }, { q: 4, r: 0 })).toBe(false);
    expect(hasLineOfSight(createWorldMap(map([seeThrough], 'rug')), { q: 0, r: 0 }, { q: 4, r: 0 })).toBe(true);
  });

  it('are checked: sensible sizes and colours, no clash with built-in names', () => {
    expect(customObjectProblem(sarcophagus)).toBeNull();
    expect(customObjectProblem({ ...sarcophagus, id: 'tree' })).toMatch(/built-in/);
    expect(customObjectProblem({ ...sarcophagus, parts: [{ ...sarcophagus.parts[0]!, size: [9, 1, 1] }] })).toMatch(/size/);
    expect(customObjectProblem({ ...sarcophagus, parts: [{ ...sarcophagus.parts[0]!, color: 'red' }] })).toMatch(/colour/);
    expect(validateMapData(map([sarcophagus, sarcophagus]))).toMatchObject({ ok: false, error: 'The map has two objects called "sarcophagus"' });
    expect(validateMapData(JSON.parse(JSON.stringify(map([sarcophagus], 'sarcophagus'))))).toMatchObject({ ok: true });
  });

  it('travel in map patches, and come and go with undo', () => {
    const before = map();
    const after = createWorldMap(map([sarcophagus], 'sarcophagus')).toData();
    const patch = diffMaps(before, after);
    expect(patch.objects).toEqual([sarcophagus]);
    expect(applyPatch(before, patch)).toEqual(after);
    const back = undo(recordChange(EMPTY_HISTORY, before, after), after);
    expect(back?.map).not.toHaveProperty('objects');
  });
});

describe('a change of grid', () => {
  it('is one patch (the whole map), and undoes back to the old grid', () => {
    const square = map();
    const hex: MapData = { formatVersion: 1, grid: 'hex', tiles: rectangleTiles('hex', 3, 2).map((cell) => ({ ...cell, height: 1 })), walls: [] };
    const patch = diffMaps(square, hex);
    expect(patch.replace?.grid).toBe('hex');
    const after = applyPatch(square, patch);
    expect(after.grid).toBe('hex');
    expect(undo(recordChange(EMPTY_HISTORY, square, after), after)?.map).toEqual(createWorldMap(square).toData());
  });
});

describe('a backdrop (a book\'s map art on the ground)', () => {
  const picture = { image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', width: 5, height: 1 };

  it('is kept with a square map, and checked', () => {
    expect(createWorldMap({ ...map(), backdrop: picture }).toData().backdrop).toEqual(picture);
    expect(() => createWorldMap({ ...map(), grid: 'hex', backdrop: picture })).toThrow(/only goes on square maps/);
    expect(() => createWorldMap({ ...map(), backdrop: { ...picture, image: 'https://example.com/a.png' } })).toThrow(/JPEG, PNG, or WebP/);
    expect(() => createWorldMap({ ...map(), backdrop: { ...picture, width: 0 } })).toThrow(/1 to 100 tiles/);
  });

  it('travels in patches, and comes and goes with undo', () => {
    const before = map();
    const after = createWorldMap({ ...before, backdrop: picture }).toData();
    expect(diffMaps(before, after).backdrop).toEqual(picture);
    expect(applyPatch(before, diffMaps(before, after)).backdrop).toEqual(picture);
    expect(diffMaps(after, before).backdrop).toBeNull();
    expect(undo(recordChange(EMPTY_HISTORY, before, after), after)?.map).not.toHaveProperty('backdrop');
  });
});
