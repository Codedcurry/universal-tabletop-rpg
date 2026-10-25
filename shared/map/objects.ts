/**
 * Things that stand on tiles: trees, rocks, crates, campfires. A tile holds
 * at most one. Whether a tile can be entered is still its own "solid" flag;
 * each object only gives the default when it's placed (a tree blocks the
 * way, flowers don't). Tall objects also block the view (see shared/vision);
 * low ones, like crates, can be seen over. How objects look comes from the
 * style pack, like terrain; unknown ids are allowed (a pack may add its own).
 */

export interface MapObjectInfo {
  readonly id: string;
  readonly name: string;
  readonly category: 'nature' | 'built';
  /** Whether placing it makes the tile solid. */
  readonly blocks: boolean;
  /** Whether it hides what is behind it. */
  readonly blocksSight: boolean;
}

export const MAP_OBJECTS: readonly MapObjectInfo[] = [
  { id: 'tree', name: 'Tree', category: 'nature', blocks: true, blocksSight: true },
  { id: 'pine', name: 'Pine', category: 'nature', blocks: true, blocksSight: true },
  { id: 'dead_tree', name: 'Dead tree', category: 'nature', blocks: true, blocksSight: false },
  { id: 'bush', name: 'Bush', category: 'nature', blocks: false, blocksSight: false },
  { id: 'flowers', name: 'Flowers', category: 'nature', blocks: false, blocksSight: false },
  { id: 'mushrooms', name: 'Mushrooms', category: 'nature', blocks: false, blocksSight: false },
  { id: 'stump', name: 'Stump', category: 'nature', blocks: false, blocksSight: false },
  { id: 'rock', name: 'Rock', category: 'nature', blocks: false, blocksSight: false },
  { id: 'boulder', name: 'Boulder', category: 'nature', blocks: true, blocksSight: true },
  { id: 'crystal', name: 'Crystal', category: 'nature', blocks: true, blocksSight: true },
  { id: 'crate', name: 'Crate', category: 'built', blocks: true, blocksSight: false },
  { id: 'barrel', name: 'Barrel', category: 'built', blocks: true, blocksSight: false },
  { id: 'chest', name: 'Chest', category: 'built', blocks: false, blocksSight: false },
  { id: 'table', name: 'Table', category: 'built', blocks: true, blocksSight: false },
  { id: 'pillar', name: 'Pillar', category: 'built', blocks: true, blocksSight: true },
  { id: 'statue', name: 'Statue', category: 'built', blocks: true, blocksSight: true },
  { id: 'campfire', name: 'Campfire', category: 'built', blocks: false, blocksSight: false },
  { id: 'well', name: 'Well', category: 'built', blocks: true, blocksSight: true },
  { id: 'signpost', name: 'Signpost', category: 'built', blocks: false, blocksSight: false },
  { id: 'tent', name: 'Tent', category: 'built', blocks: true, blocksSight: true },
];

export function objectInfo(id: string): MapObjectInfo | undefined {
  return MAP_OBJECTS.find((entry) => entry.id === id);
}
