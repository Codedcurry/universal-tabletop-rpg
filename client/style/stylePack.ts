import { placeholderObjects, unknownObject } from './placeholderObjects';

/**
 * A style pack decides how everything looks. The renderer never hard-codes an
 * art style: it asks the active pack. This placeholder pack uses flat colors;
 * the HD-2D pack (step 13) will add pixel-art textures, sprites, and effects.
 */
export interface TerrainLook {
  /** CSS-style hex color, e.g. "#5f9e4a". */
  readonly color: string;
}

export interface SolidLook {
  readonly color: string;
  /** Height of the block on top, in levels; 0 draws no block, just the tile in `color`. */
  readonly height: number;
  /** Share of the tile's width the block covers. */
  readonly fill: number;
}

/** One shape of an object's model. Sizes in tiles (1 = a tile across). */
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

/** How an object on a tile looks. */
export interface ObjectModel {
  readonly parts: readonly ObjectPart[];
  /** Natural things get a random turn and size, so a forest doesn't look stamped. */
  readonly natural?: boolean;
}

export interface StylePack {
  readonly id: string;
  readonly name: string;
  readonly background: string;
  /** World units per tile (hex outer radius, or square side). */
  readonly cellSize: number;
  /** World units per height level. */
  readonly levelHeight: number;
  /** Fraction of the cell each tile fills; the gap draws the grid. */
  readonly tileFill: number;
  readonly terrain: Readonly<Record<string, TerrainLook>>;
  /** Used for terrain ids the pack doesn't know. */
  readonly unknownTerrain: TerrainLook;
  readonly wallColor: string;
  readonly highlightColor: string;
  /** Tiles and creatures you can act on: where you can move, who you can hurt, who you can help. */
  readonly actionColors: { readonly move: string; readonly harm: string; readonly help: string };
  /** The ring under the creature whose turn it is (kept apart from the move color so it stands out). */
  readonly activeColor: string;
  /**
   * How solid tiles look, by terrain: a block on top (a tree's canopy, a boulder, a
   * snowy peak), or with `height` 0 the tile itself in another color (deep water).
   */
  readonly solid: Readonly<Record<string, SolidLook>>;
  /** Solid tiles of terrains the pack doesn't list. */
  readonly unknownSolid: SolidLook;
  /** Models for objects on tiles, by object id. */
  readonly objects: Readonly<Record<string, ObjectModel>>;
  readonly unknownObject: ObjectModel;
}

/** Terrain ids the editor offers; packs should define a look for each. */
export const TERRAINS = ['grass', 'dirt', 'sand', 'stone', 'water', 'snow', 'wood'] as const;

export const placeholderStyle: StylePack = {
  id: 'placeholder',
  name: 'Placeholder colors',
  background: '#14121c',
  cellSize: 1,
  levelHeight: 0.5,
  tileFill: 0.94,
  terrain: {
    grass: { color: '#5f9e4a' },
    dirt: { color: '#8a6a45' },
    sand: { color: '#d8c48a' },
    stone: { color: '#8d8a93' },
    water: { color: '#3f78b5' },
    snow: { color: '#e8eef2' },
    wood: { color: '#a0703c' },
  },
  unknownTerrain: { color: '#c04fc0' },
  wallColor: '#d9cdb4',
  highlightColor: '#e0b44c',
  actionColors: { move: '#e0b44c', harm: '#e8432f', help: '#3fa9f5' },
  activeColor: '#ffffff',
  solid: {
    water: { color: '#2b5a8c', height: 0, fill: 1 }, // deep water
    wood: { color: '#2f6e35', height: 2.2, fill: 0.8 }, // a tree's canopy
    grass: { color: '#3f7d38', height: 1.2, fill: 0.8 }, // a bush
    stone: { color: '#6f6b75', height: 1.3, fill: 0.85 }, // a boulder
    snow: { color: '#e2e9ef', height: 1.3, fill: 0.85 }, // a snowy crag
    sand: { color: '#9c8a5c', height: 1, fill: 0.7 },
    dirt: { color: '#5c4630', height: 1, fill: 0.7 },
  },
  unknownSolid: { color: '#3a3440', height: 1.5, fill: 0.55 },
  objects: placeholderObjects,
  unknownObject,
};
