import { describe, expect, it } from 'vitest';
import { createWorldMap } from '../map';
import { type AiProvider, type AiRequest, areasOf, buildFromReply, buildMapFromPlan, furnishMap, placeLabels, planMap, previewTiles } from './index';

// Maps from a book: the AI writes a map plan (rows and columns: ground,
// areas, walls with doors, objects) from an encounter's text or a picture of
// its map; it's built into a real map, or the AI explains how to set one up.

const chapel = {
  possible: true,
  name: 'Ruined Chapel',
  grid: 'square',
  width: 10,
  height: 8,
  ground: 'grass',
  areas: [
    { terrain: 'stone', x: 2, y: 1, w: 6, h: 5 },
    { shape: 'circle', terrain: 'water', x: 9, y: 7, r: 1 },
    { terrain: 'wood', x: 3, y: 2, w: 2, h: 1, height: 1 },
  ],
  walls: [{ x1: 2, y1: 1, x2: 7, y2: 1 }],
  doors: [{ x: 4, y: 1 }],
  objects: [
    { kind: 'pillar', x: 5, y: 3 },
    { kind: 'altar', x: 6, y: 4 },
  ],
  notes: 'The book gives no size for the yard; I assumed 10 by 8.',
};

const tileAt = (result: ReturnType<typeof buildMapFromPlan>, x: number, y: number) => previewTiles(result.map).find((tile) => tile.x === x && tile.y === y);

describe('building a map plan', () => {
  it('lays out the ground, areas (later ones on top), and heights', () => {
    const result = buildMapFromPlan(chapel);
    expect(result.name).toBe('Ruined Chapel');
    expect(result.map.grid).toBe('square');
    expect(result.map.tiles).toHaveLength(80);
    expect(tileAt(result, 0, 0)).toMatchObject({ terrain: 'grass', height: 0, blocked: false });
    expect(tileAt(result, 6, 5)).toMatchObject({ terrain: 'stone' });
    expect(tileAt(result, 3, 2)).toMatchObject({ terrain: 'wood', height: 1 });
    // Water is solid.
    expect(tileAt(result, 9, 7)).toMatchObject({ terrain: 'water', blocked: true });
  });

  it('lays walls as solid stone with a doorway left open', () => {
    const result = buildMapFromPlan(chapel);
    expect(tileAt(result, 2, 1)).toMatchObject({ terrain: 'stone', blocked: true, height: 2 });
    expect(tileAt(result, 4, 1)).toMatchObject({ blocked: false, height: 0 });
  });

  it('places known objects (a pillar blocks the way), and notes what it left out', () => {
    const result = buildMapFromPlan(chapel);
    expect(tileAt(result, 5, 3)).toMatchObject({ object: 'pillar', blocked: true });
    expect(tileAt(result, 6, 4)?.object).toBeNull();
    expect(result.notes).toEqual(['The book gives no size for the yard; I assumed 10 by 8.', 'Left out (not in this tool yet): altar.']);
  });

  it('lays hex rows the way the map editor does, and keeps sizes within limits', () => {
    const hex = buildMapFromPlan({ grid: 'hex', width: 200, height: 2 });
    expect(hex.map.tiles).toHaveLength(60 * 4);
    expect(hex.notes).toContain('The map is 60 by 4 tiles (kept within 4 to 60).');
    // A valid map, with every tile where the editor would put it.
    expect(() => createWorldMap(hex.map)).not.toThrow();
    expect(previewTiles(hex.map).some((tile) => tile.x === 59 && tile.y === 3)).toBe(true);
  });
});

describe('reading the AI\'s answer', () => {
  it('builds the plan in the reply, chatter and all', () => {
    expect(buildFromReply(`Here is the map:\n\`\`\`json\n${JSON.stringify(chapel)}\n\`\`\``)).toMatchObject({ kind: 'map', name: 'Ruined Chapel' });
  });

  it('passes on why there\'s no map, and the guide to setting one up', () => {
    const reply = JSON.stringify({ possible: false, reason: 'The pages only describe the villain.', guide: ['Make a 20 by 20 map of forest.', 'Put the cart in the middle.'] });
    expect(buildFromReply(reply)).toEqual({ kind: 'guide', reason: 'The pages only describe the villain.', guide: ['Make a 20 by 20 map of forest.', 'Put the cart in the middle.'] });
  });

  it('says so when the answer can\'t be read', () => {
    expect(() => buildFromReply('I am not sure what you mean.')).toThrow(/couldn't be read/);
  });
});

describe('planMap', () => {
  const recorder = (reply: string): AiProvider & { requests: AiRequest[] } => {
    const requests: AiRequest[] = [];
    return { label: 'Fake', requests, complete: async (request) => (requests.push(request), reply) };
  };

  it('sends an encounter\'s text with the instructions for describing a place', async () => {
    const ai = recorder(JSON.stringify(chapel));
    const result = await planMap(ai, { text: 'The chapel is 30 feet across...' });
    expect(result.kind).toBe('map');
    expect(ai.requests[0]?.system).toMatch(/description of a tabletop RPG encounter area/);
    expect(ai.requests[0]?.prompt).toContain('The chapel is 30 feet across...');
    expect(ai.requests[0]?.images).toBeUndefined();
  });

  it('sends map pictures, for an AI that can see, with the instructions for recreating a map', async () => {
    const ai = recorder(JSON.stringify(chapel));
    await planMap(ai, { pictures: ['iVBORw0KGgo='], text: 'Area 1: the chapel' });
    expect(ai.requests[0]?.system).toMatch(/picture of a tabletop RPG battle map/);
    expect(ai.requests[0]?.images).toEqual(['iVBORw0KGgo=']);
    expect(ai.requests[0]?.prompt).toContain('Area 1: the chapel');
  });

  it('needs some text', async () => {
    expect(await planMap(recorder('{}'), { text: '   ' })).toEqual({ kind: 'guide', reason: 'Those pages have no text to read.', guide: [] });
  });
});

describe('the grid', () => {
  it('builds on the grid asked for (the current map\'s, so Undo works), whatever the plan says', () => {
    expect(buildMapFromPlan({ grid: 'square', width: 6, height: 6 }, 'hex').map.grid).toBe('hex');
    expect(buildMapFromPlan({ grid: 'hex', width: 6, height: 6 }).map.grid).toBe('hex');
  });
});

describe('objects the plan makes', () => {
  const plan = {
    width: 6,
    height: 4,
    newObjects: [
      {
        name: 'Altar with crystal skull',
        blocks: true,
        blocksSight: false,
        parts: [
          { shape: 'box', size: [0.8, 0.45, 0.5], color: '#7d7a85' },
          { shape: 'sphere', size: [0.3, 0.32, 0.28], at: [0, 0.45, 0], color: '#bfe9ff', glow: true },
        ],
      },
      { name: 'Tree', parts: [{ shape: 'pyramid', size: [9, 1, 1], color: 'green' }] },
      { name: 'Unused cage', parts: [{ shape: 'box', size: [1, 1, 1], color: '#333333' }] },
    ],
    objects: [
      { kind: 'Altar with crystal skull', x: 2, y: 1 },
      { kind: 'tree', x: 4, y: 2 },
      { kind: 'TREE', x: 0, y: 0 },
    ],
  };

  it('makes the objects the encounter needs, places them by name, and keeps them with the map', () => {
    const result = buildMapFromPlan(plan);
    const altar = result.map.objects?.find((object) => object.name === 'Altar with crystal skull');
    expect(altar).toMatchObject({ id: 'altar_with_crystal_skull', blocks: true, blocksSight: false });
    expect(altar?.parts[1]).toMatchObject({ shape: 'sphere', glow: true, color: '#bfe9ff' });
    expect(previewTiles(result.map).find((tile) => tile.x === 2 && tile.y === 1)).toMatchObject({ object: 'altar_with_crystal_skull', blocked: true });
    // The built-in tree is used for "tree"; a made one called Tree gets its own id.
    expect(previewTiles(result.map).find((tile) => tile.x === 4 && tile.y === 2)?.object).toBe('tree');
    expect(result.notes).toContain('Made for this map: Altar with crystal skull, Tree, Unused cage.');
  });

  it('tidies what it can\'t use as given, and leaves out objects never placed', () => {
    const result = buildMapFromPlan(plan);
    const tree = result.map.objects?.find((object) => object.name === 'Tree');
    expect(tree?.id).toBe('tree_made');
    expect(tree?.parts[0]).toMatchObject({ shape: 'box', size: [3, 1, 1], color: '#8a8790' });
    expect(result.map.objects?.map((object) => object.name)).not.toContain('Unused cage');
  });
});

describe('furnishing a traced map', () => {
  // Two rooms: a west room (x 1-3) and an east room (x 5-7), rows 1-3, split by a wall, with a doorway at (4, 2).
  const rows = ['#########', '#...#...#', '#.......#', '#...#...#', '#########'];
  const traced = {
    width: 9,
    height: 5,
    cells: rows.join('').split('').map((c) => (c === '#' ? 'wall' : 'floor')) as ('wall' | 'floor')[],
    square: 20,
    origin: { x: 0, y: 0 },
    outdoor: false,
  };
  const labels = [
    { key: '1', name: 'West Room', x: 2, y: 2 },
    { key: '2', name: 'East Room', x: 6, y: 1 },
  ];

  it('knows each area\'s squares: the room its label is in', () => {
    // The doorway joins the rooms into one: both labels share it.
    const areas = areasOf(traced, labels);
    expect(areas['1']).toHaveLength(19);
    const split = { ...traced, cells: traced.cells.map((cell, at) => (at === 2 * 9 + 4 ? 'wall' : cell)) as ('wall' | 'floor')[] };
    expect(areasOf(split, labels)['2']?.every((cell) => cell.x >= 5)).toBe(true);
  });

  it('builds a traced building\'s thin walls, and leaves out a floor patch over too much of it', () => {
    const result = buildMapFromPlan(
      { areas: [{ terrain: 'water', x: 0, y: 0, w: 9, h: 5 }] },
      'square',
      { ...traced, walls: [{ x: 3, y: 1, side: 'east' }] },
    );
    expect(result.map.walls).toEqual([[{ q: 3, r: 1 }, { q: 4, r: 1 }]]);
    expect(previewTiles(result.map).some((tile) => tile.terrain === 'water')).toBe(false);
    expect(result.notes.join(' ')).toMatch(/Left out water covering too much of the floor/);
  });

  it('furnishes a map with no labels by the part of it things are in, and makes what the AI names but doesn\'t build', async () => {
    const requests: AiRequest[] = [];
    const provider: AiProvider = {
      label: 'Fake',
      complete: async (request) => {
        requests.push(request);
        return JSON.stringify({ objects: [{ kind: 'catBed', area: 'map', where: 'northeast' }, { kind: 'barrel', area: 'map', where: 'southwest' }] });
      },
    };
    const asked: string[] = [];
    const result = await furnishMap(provider, traced, {
      text: 'A cat bed in the corner.',
      grid: 'square',
      makeThing: async (description) => {
        asked.push(description);
        return { id: 'cat_bed', name: 'Cat bed', blocks: false, blocksSight: false, parts: [{ shape: 'box', size: [0.6, 0.2, 0.6], color: '#aa3355' }] };
      },
    });
    expect(requests[0]?.prompt).toContain('map: the whole floor');
    expect(asked).toEqual(['cat bed']);
    const at = (x: number, y: number) => previewTiles(result.map).find((tile) => tile.x === x && tile.y === y);
    expect(at(7, 1)?.object).toBe('cat_bed');
    expect(at(1, 3)?.object).toBe('barrel');
    expect(result.notes).toContain('Made for this map: Cat bed.');
  });

  it('keeps the traced walls, and places objects by area and spot', () => {
    const split = { ...traced, cells: traced.cells.map((cell, at) => (at === 2 * 9 + 4 ? 'wall' : cell)) as ('wall' | 'floor')[] };
    const result = buildMapFromPlan(
      {
        areas: [{ terrain: 'water', x: 0, y: 0, w: 9, h: 1 }],
        objects: [
          { kind: 'chest', area: '2', where: 'northeast' },
          { kind: 'barrel', area: '1', where: 'centre' },
          { kind: 'crate', area: '1', where: 'centre' },
          { kind: 'statue', x: 0, y: 0 },
        ],
      },
      'square',
      split,
      areasOf(split, labels),
    );
    const at = (x: number, y: number) => previewTiles(result.map).find((tile) => tile.x === x && tile.y === y);
    expect(at(0, 0)).toMatchObject({ terrain: 'stone', blocked: true }); // walls stay walls
    expect(at(7, 1)?.object).toBe('chest');
    expect(at(2, 2)?.object).toBe('barrel');
    // The centre was taken: the crate goes beside it.
    expect(previewTiles(result.map).filter((tile) => tile.object === 'crate')).toHaveLength(1);
    // Put on a wall by square: moved to the floor beside it.
    expect(at(1, 1)?.object).toBe('statue');
  });
});

describe('placeLabels', () => {
  it('pins each area\'s label (its key beside a word of its name) to the map\'s squares', () => {
    const traced = { width: 10, height: 10, cells: new Array(100).fill('floor'), square: 20, origin: { x: 100, y: 50 }, outdoor: false } as const;
    const words = [
      { text: 'Black Tomb', x: 230, y: 115 },
      { text: '25', x: 190, y: 115 },
      { text: '25', x: 500, y: 900 }, // a page number, far away
      { text: 'Antechamber', x: 230, y: 215 },
      { text: '24', x: 185, y: 215 },
    ];
    expect(placeLabels(words, [{ key: '25', name: 'The Black Tomb', page: 40 }, { key: '24', name: 'Antechamber', page: 39 }], traced)).toEqual([
      { key: '25', name: 'The Black Tomb', x: 5, y: 3 },
      { key: '24', name: 'Antechamber', x: 5, y: 8 },
    ]);
  });
});
