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
  /** Made for one map (see CustomObject). */
  readonly category: 'nature' | 'built' | 'custom';
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

/** One simple shape of an object's 3D model. Sizes are in tiles (1 = a tile across). */
export interface ObjectPart {
  readonly shape: 'box' | 'cylinder' | 'cone' | 'sphere';
  /** Width (x), height (y), depth (z); for round shapes, their diameters. */
  readonly size: readonly [number, number, number];
  /** Where the bottom middle of the part sits: across, up from the tile's top, and along. */
  readonly at?: readonly [number, number, number];
  /** Lean (radians, around the depth axis), e.g. a branch. */
  readonly tilt?: number;
  /** Turn (radians, around the vertical), e.g. crossed logs. */
  readonly turn?: number;
  readonly color: string;
  /** Fewer sides look more low-poly. */
  readonly sides?: number;
  /** Gets a soft glow halo (a flame, a crystal). */
  readonly glow?: boolean;
}

/**
 * An object made for one map (by the DM's AI for an encounter: a crystal
 * head on an altar, a sarcophagus), carried with the map: what it is,
 * whether it's in the way, and its model, built from simple shapes.
 */
export interface CustomObject {
  readonly id: string;
  readonly name: string;
  readonly blocks: boolean;
  readonly blocksSight: boolean;
  readonly parts: readonly ObjectPart[];
}

/** Limits that keep a made-up object small and cheap to draw. */
export const MAX_CUSTOM_OBJECTS = 24;
export const MAX_OBJECT_PARTS = 12;
const SHAPES = new Set(['box', 'cylinder', 'cone', 'sphere']);
const COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z][a-z0-9_]*$/;
const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** What's wrong with a custom object, if anything. */
export function customObjectProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'is not an object';
  const object = value as Record<string, unknown>;
  if (typeof object.id !== 'string' || !ID.test(object.id) || object.id.length > 40) return 'has an invalid id';
  if (objectInfo(object.id)) return `has the same id as the built-in "${object.id}"`;
  if (typeof object.name !== 'string' || object.name.trim() === '' || object.name.length > 60) return 'needs a name';
  if (typeof object.blocks !== 'boolean' || typeof object.blocksSight !== 'boolean') return 'must say whether it blocks the way and the view';
  if (!Array.isArray(object.parts) || object.parts.length < 1 || object.parts.length > MAX_OBJECT_PARTS) return `needs 1 to ${MAX_OBJECT_PARTS} parts`;
  for (const part of object.parts as Record<string, unknown>[]) {
    if (typeof part !== 'object' || part === null || !SHAPES.has(part.shape as string)) return 'has a part of an unknown shape';
    if (!Array.isArray(part.size) || part.size.length !== 3 || !part.size.every((n) => finite(n, 0.02, 3))) return 'has a part of an invalid size';
    if (part.at !== undefined && (!Array.isArray(part.at) || part.at.length !== 3 || !part.at.every((n) => finite(n, -2, 4)))) return 'has a part in an invalid place';
    if (typeof part.color !== 'string' || !COLOR.test(part.color)) return 'has a part with an invalid colour';
    for (const key of ['tilt', 'turn'] as const) if (part[key] !== undefined && !finite(part[key], -7, 7)) return 'has a part at an invalid angle';
    if (part.sides !== undefined && !(Number.isInteger(part.sides) && finite(part.sides, 3, 24))) return 'has a part with an invalid number of sides';
    if (part.glow !== undefined && typeof part.glow !== 'boolean') return 'has an invalid glow';
  }
  return null;
}

/** An object's facts: built-in, or one of the map's own. */
export function objectInfoIn(objects: readonly CustomObject[] | undefined, id: string): MapObjectInfo | undefined {
  const custom = objects?.find((entry) => entry.id === id);
  return custom ? { id: custom.id, name: custom.name, category: 'custom', blocks: custom.blocks, blocksSight: custom.blocksSight } : objectInfo(id);
}
