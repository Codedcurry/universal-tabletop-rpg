import type { ObjectModel } from './stylePack';

// Placeholder 3D models for map objects: each a few low-poly shapes in flat
// colors. Sizes are in tiles (1 = a tile across); `at` is where the bottom
// of the part sits, above the tile's top. The HD-2D pack (step 13) can swap
// these for sprites or real models.

const BARK = '#6b4a2b';
const LEAVES = '#3f8a3a';
const NEEDLES = '#2e6b3b';
const STONE = '#8a8790';
const WOOD = '#a07040';
const DARK_WOOD = '#6e4a28';
const METAL = '#3c3a40';

export const placeholderObjects: Readonly<Record<string, ObjectModel>> = {
  tree: {
    natural: true,
    parts: [
      { shape: 'cylinder', size: [0.16, 0.5, 0.16], color: BARK, sides: 6 },
      { shape: 'sphere', size: [0.78, 0.7, 0.78], at: [0, 0.4, 0], color: LEAVES, sides: 6 },
      { shape: 'sphere', size: [0.5, 0.45, 0.5], at: [0.08, 0.85, -0.05], color: '#4c9c44', sides: 6 },
    ],
  },
  pine: {
    natural: true,
    parts: [
      { shape: 'cylinder', size: [0.13, 0.3, 0.13], color: BARK, sides: 6 },
      { shape: 'cone', size: [0.72, 0.6, 0.72], at: [0, 0.22, 0], color: NEEDLES, sides: 7 },
      { shape: 'cone', size: [0.55, 0.5, 0.55], at: [0, 0.55, 0], color: '#367a45', sides: 7 },
      { shape: 'cone', size: [0.36, 0.45, 0.36], at: [0, 0.88, 0], color: '#3f8a4e', sides: 7 },
    ],
  },
  dead_tree: {
    natural: true,
    parts: [
      { shape: 'cylinder', size: [0.14, 1.0, 0.14], color: '#5b4a3c', sides: 5 },
      { shape: 'cylinder', size: [0.07, 0.45, 0.07], at: [0.12, 0.45, 0], tilt: -0.7, color: '#5b4a3c', sides: 5 },
      { shape: 'cylinder', size: [0.06, 0.35, 0.06], at: [-0.1, 0.65, 0.02], tilt: 0.8, color: '#5b4a3c', sides: 5 },
    ],
  },
  bush: {
    natural: true,
    parts: [
      { shape: 'sphere', size: [0.6, 0.42, 0.6], color: '#3f7d38', sides: 6 },
      { shape: 'sphere', size: [0.38, 0.32, 0.38], at: [0.2, 0.08, 0.12], color: '#4a8f40', sides: 6 },
    ],
  },
  flowers: {
    natural: true,
    parts: [
      { shape: 'sphere', size: [0.13, 0.13, 0.13], at: [-0.18, 0.02, 0.1], color: '#e86aa0', sides: 5 },
      { shape: 'sphere', size: [0.12, 0.12, 0.12], at: [0.15, 0.02, -0.12], color: '#f2d24a', sides: 5 },
      { shape: 'sphere', size: [0.12, 0.12, 0.12], at: [0.05, 0.02, 0.2], color: '#ffffff', sides: 5 },
      { shape: 'sphere', size: [0.13, 0.13, 0.13], at: [-0.12, 0.02, -0.18], color: '#9a7af0', sides: 5 },
    ],
  },
  mushrooms: {
    natural: true,
    parts: [
      { shape: 'cylinder', size: [0.07, 0.16, 0.07], at: [-0.08, 0, 0], color: '#efe6d6', sides: 6 },
      { shape: 'sphere', size: [0.22, 0.12, 0.22], at: [-0.08, 0.13, 0], color: '#c8342c', sides: 6 },
      { shape: 'cylinder', size: [0.05, 0.1, 0.05], at: [0.12, 0, 0.08], color: '#efe6d6', sides: 6 },
      { shape: 'sphere', size: [0.15, 0.09, 0.15], at: [0.12, 0.08, 0.08], color: '#d2582c', sides: 6 },
    ],
  },
  stump: {
    natural: true,
    parts: [
      { shape: 'cylinder', size: [0.36, 0.18, 0.36], color: '#7a5634', sides: 7 },
      { shape: 'cylinder', size: [0.3, 0.02, 0.3], at: [0, 0.18, 0], color: '#c9a36b', sides: 7 },
    ],
  },
  rock: {
    natural: true,
    parts: [{ shape: 'sphere', size: [0.38, 0.22, 0.32], color: STONE, sides: 5 }],
  },
  boulder: {
    natural: true,
    parts: [
      { shape: 'sphere', size: [0.82, 0.6, 0.72], color: '#7d7a83', sides: 5 },
      { shape: 'sphere', size: [0.4, 0.32, 0.36], at: [0.28, 0, 0.2], color: STONE, sides: 5 },
    ],
  },
  crystal: {
    natural: true,
    parts: [
      { shape: 'cone', size: [0.24, 0.85, 0.24], color: '#7fd6f0', sides: 5, glow: true },
      { shape: 'cone', size: [0.16, 0.5, 0.16], at: [0.16, 0, 0.08], tilt: -0.35, color: '#a8e6f7', sides: 5, glow: true },
    ],
  },
  crate: {
    parts: [
      { shape: 'box', size: [0.52, 0.5, 0.52], color: WOOD },
      { shape: 'box', size: [0.54, 0.06, 0.54], at: [0, 0.22, 0], color: DARK_WOOD },
    ],
  },
  barrel: {
    parts: [
      { shape: 'cylinder', size: [0.42, 0.56, 0.42], color: '#8a5a30', sides: 10 },
      { shape: 'cylinder', size: [0.44, 0.04, 0.44], at: [0, 0.1, 0], color: METAL, sides: 10 },
      { shape: 'cylinder', size: [0.44, 0.04, 0.44], at: [0, 0.42, 0], color: METAL, sides: 10 },
    ],
  },
  chest: {
    parts: [
      { shape: 'box', size: [0.52, 0.28, 0.34], color: '#8b5a2b' },
      { shape: 'box', size: [0.54, 0.1, 0.36], at: [0, 0.28, 0], color: DARK_WOOD },
      { shape: 'box', size: [0.08, 0.1, 0.38], at: [0, 0.2, 0], color: '#d8b04a' },
    ],
  },
  table: {
    parts: [
      { shape: 'box', size: [0.72, 0.06, 0.5], at: [0, 0.38, 0], color: WOOD },
      { shape: 'box', size: [0.06, 0.38, 0.06], at: [-0.3, 0, -0.19], color: DARK_WOOD },
      { shape: 'box', size: [0.06, 0.38, 0.06], at: [0.3, 0, -0.19], color: DARK_WOOD },
      { shape: 'box', size: [0.06, 0.38, 0.06], at: [-0.3, 0, 0.19], color: DARK_WOOD },
      { shape: 'box', size: [0.06, 0.38, 0.06], at: [0.3, 0, 0.19], color: DARK_WOOD },
    ],
  },
  pillar: {
    parts: [
      { shape: 'box', size: [0.52, 0.12, 0.52], color: '#b9b2a6' },
      { shape: 'cylinder', size: [0.36, 1.25, 0.36], at: [0, 0.12, 0], color: '#d4cdc1', sides: 10 },
      { shape: 'box', size: [0.5, 0.12, 0.5], at: [0, 1.37, 0], color: '#b9b2a6' },
    ],
  },
  statue: {
    parts: [
      { shape: 'box', size: [0.5, 0.25, 0.5], color: '#9f9a92' },
      { shape: 'cylinder', size: [0.3, 0.6, 0.24], at: [0, 0.25, 0], color: '#bdb8b0', sides: 8 },
      { shape: 'sphere', size: [0.22, 0.22, 0.22], at: [0, 0.85, 0], color: '#bdb8b0', sides: 8 },
    ],
  },
  campfire: {
    parts: [
      { shape: 'box', size: [0.5, 0.08, 0.1], turn: 0.5, color: DARK_WOOD },
      { shape: 'box', size: [0.5, 0.08, 0.1], turn: -0.6, color: DARK_WOOD },
      { shape: 'cone', size: [0.24, 0.36, 0.24], at: [0, 0.04, 0], color: '#ff8a2a', sides: 6, glow: true },
      { shape: 'cone', size: [0.12, 0.24, 0.12], at: [0.03, 0.12, 0.02], color: '#ffd24a', sides: 6, glow: true },
    ],
  },
  well: {
    parts: [
      { shape: 'cylinder', size: [0.66, 0.36, 0.66], color: STONE, sides: 10 },
      { shape: 'cylinder', size: [0.5, 0.02, 0.5], at: [0, 0.36, 0], color: '#203a5c', sides: 10 },
      { shape: 'box', size: [0.06, 0.6, 0.06], at: [-0.3, 0.36, 0], color: DARK_WOOD },
      { shape: 'box', size: [0.06, 0.6, 0.06], at: [0.3, 0.36, 0], color: DARK_WOOD },
      { shape: 'box', size: [0.8, 0.06, 0.4], at: [0, 0.96, 0], color: '#8a3a2a' },
    ],
  },
  signpost: {
    parts: [
      { shape: 'box', size: [0.07, 0.8, 0.07], color: DARK_WOOD },
      { shape: 'box', size: [0.46, 0.17, 0.04], at: [0.12, 0.56, 0], color: WOOD },
    ],
  },
  tent: {
    parts: [{ shape: 'cone', size: [0.95, 0.8, 0.95], color: '#c9b48a', sides: 4 }],
  },
};

/** Anything a pack doesn't know: a plain marker block. */
export const unknownObject: ObjectModel = { parts: [{ shape: 'box', size: [0.4, 0.4, 0.4], color: '#c04fc0' }] };
