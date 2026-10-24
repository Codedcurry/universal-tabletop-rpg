/**
 * A style pack decides how everything looks. The renderer never hard-codes an
 * art style: it asks the active pack. This placeholder pack uses flat colors;
 * the HD-2D pack (step 13) will add pixel-art textures, sprites, and effects.
 */
export interface TerrainLook {
  /** CSS-style hex color, e.g. "#5f9e4a". */
  readonly color: string;
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
  readonly blockedColor: string;
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
  blockedColor: '#3a3440',
};
