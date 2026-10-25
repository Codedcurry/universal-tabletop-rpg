import { CLIPS } from '../anim';
import type { SheetLayout } from './sheet';

/**
 * The DM's own art for a game: imported tile textures and characters'
 * sprite sheets (with round tokens). Plain, checked data, saved with the game and sent to every
 * player over the game connection; nothing is uploaded anywhere. Images are
 * kept as data URLs, within limits so a game stays quick to send.
 */

export const ART_FORMAT = 'universal-tabletop-rpg/art';
export const ART_VERSION = 1;

/** A data URL of at most this many characters (about 500 KB of image). */
export const MAX_IMAGE_CHARS = 700_000;
/** Images at most this many pixels across. */
export const MAX_IMAGE_SIDE = 1024;

export interface ImageAsset {
  /** The image as a data URL (PNG, JPEG, GIF, or WebP). */
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface CustomArt {
  readonly format: typeof ART_FORMAT;
  readonly version: typeof ART_VERSION;
  /** Tile top textures, by terrain id. */
  readonly tiles: Readonly<Record<string, ImageAsset>>;
  /** Characters' sprite sheets, by art key (a monster kind like "goblin", or one creature's id). */
  readonly characters: Readonly<Record<string, CharacterArt>>;
}

export interface CharacterArt {
  readonly image: ImageAsset;
  readonly layout: SheetLayout;
  /** A round token for top-down view (cut from the portrait), if there is one. */
  readonly token: ImageAsset | null;
}

export const EMPTY_ART: CustomArt = { format: ART_FORMAT, version: ART_VERSION, tiles: {}, characters: {} };

/** The art with a character's sprite sheet set (or removed, with null). */
export function withCharacter(art: CustomArt, key: string, character: CharacterArt | null): CustomArt {
  const characters = { ...art.characters };
  if (character) characters[key] = character;
  else delete characters[key];
  return { ...art, characters };
}

/** The art with a terrain's tile texture set (or removed, with null). */
export function withTile(art: CustomArt, terrain: string, image: ImageAsset | null): CustomArt {
  const tiles = { ...art.tiles };
  if (image) tiles[terrain] = image;
  else delete tiles[terrain];
  return { ...art, tiles };
}

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
/** Art keys: monster kinds and creature ids ("goblin", "goblin-2", "pc-p1"). */
const KEY_PATTERN = /^[a-z][a-z0-9_-]*$/;
const DIRECTIONS = ['down', 'left', 'right', 'up'];
const IMAGE_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
type Data = Record<string, unknown>;
const isObject = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);

function imageProblem(value: unknown): string | null {
  if (!isObject(value)) return 'is not an image';
  const { dataUrl, width, height } = value;
  if (typeof dataUrl !== 'string' || !IMAGE_URL.test(dataUrl)) return 'is not a PNG, JPEG, GIF, or WebP image';
  if (dataUrl.length >= MAX_IMAGE_CHARS) return 'is too big (keep images under about 500 KB)';
  for (const side of [width, height]) {
    if (typeof side !== 'number' || !Number.isInteger(side) || side < 1 || side > MAX_IMAGE_SIDE) {
      return `must be 1 to ${MAX_IMAGE_SIDE} pixels across`;
    }
  }
  return null;
}

export type ArtValidation = { readonly ok: true; readonly art: CustomArt } | { readonly ok: false; readonly error: string };

export function validateCustomArt(data: unknown): ArtValidation {
  if (!isObject(data) || data.format !== ART_FORMAT || data.version !== ART_VERSION) return { ok: false, error: 'This is not art for this app' };
  if (!isObject(data.tiles)) return { ok: false, error: 'The tile art is missing' };
  for (const [terrain, image] of Object.entries(data.tiles)) {
    if (!ID_PATTERN.test(terrain)) return { ok: false, error: `"${terrain}" is not a terrain id` };
    const problem = imageProblem(image);
    if (problem) return { ok: false, error: `The ${terrain} tile ${problem}` };
  }
  // Art saved before characters existed has none.
  const characters = data.characters ?? {};
  if (!isObject(characters)) return { ok: false, error: 'The character art is broken' };
  for (const [key, character] of Object.entries(characters)) {
    if (!KEY_PATTERN.test(key)) return { ok: false, error: `"${key}" is not a creature` };
    if (!isObject(character)) return { ok: false, error: `The art for ${key} is broken` };
    const problem = imageProblem(character.image) ?? (character.token === null ? null : imageProblem(character.token)) ?? layoutProblem(character.layout, character.image as ImageAsset);
    if (problem) return { ok: false, error: `The art for ${key}: ${problem}` };
  }
  return { ok: true, art: { ...(data as unknown as CustomArt), characters: characters as CustomArt['characters'] } };
}

/** What's wrong with a sheet layout for its image, if anything. */
function layoutProblem(layout: unknown, image: ImageAsset): string | null {
  if (!isObject(layout) || !isObject(layout.clips)) return 'the sheet layout is missing';
  const frame = layout.frameSize;
  if (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 4 || frame > 256) return 'the frame size is invalid';
  const body = layout.bodySize;
  if (body !== undefined && (typeof body !== 'number' || !Number.isInteger(body) || body < 1 || body > frame)) return 'the body size is invalid';
  const rows = Math.floor(image.height / frame);
  const columns = Math.floor(image.width / frame);
  if (!isObject(layout.clips.idle)) return 'the sheet has no idle animation';
  for (const [clip, directions] of Object.entries(layout.clips)) {
    if (!(CLIPS as readonly string[]).includes(clip)) return `"${clip}" is not an animation`;
    if (!isObject(directions)) return `the ${clip} animation is broken`;
    for (const direction of DIRECTIONS) {
      const row = directions[direction];
      if (!isObject(row) || typeof row.row !== 'number' || typeof row.frames !== 'number' || typeof row.mirror !== 'boolean') {
        return `the ${clip} animation has no ${direction} row`;
      }
      if (!Number.isInteger(row.row) || row.row < 0 || row.row >= rows) return `the ${clip} animation's ${direction} row is off the sheet`;
      if (!Number.isInteger(row.frames) || row.frames < 1 || row.frames > columns) return `the ${clip} animation has more frames than the sheet is wide`;
    }
  }
  return null;
}

/** Friendly warnings about a tile image's size (it is still usable). */
export function tileWarnings(width: number, height: number): string[] {
  const warnings: string[] = [];
  if (width !== height) warnings.push(`Tiles should be square; this one is ${width} x ${height}, so it will be stretched.`);
  const side = Math.max(width, height);
  if (side > 256) warnings.push(`This is a large image (${side} px); pixel art tiles are usually 16, 32, or 64 pixels.`);
  else if (![16, 32, 64, 128, 256].includes(side)) warnings.push(`Pixel art tiles are usually 16, 32, or 64 pixels; ${side} may look uneven.`);
  return warnings;
}
