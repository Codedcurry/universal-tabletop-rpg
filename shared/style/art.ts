/**
 * The DM's own art for a game: imported tile textures (and, later,
 * characters). Plain, checked data, saved with the game and sent to every
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
}

export const EMPTY_ART: CustomArt = { format: ART_FORMAT, version: ART_VERSION, tiles: {} };

/** The art with a terrain's tile texture set (or removed, with null). */
export function withTile(art: CustomArt, terrain: string, image: ImageAsset | null): CustomArt {
  const tiles = { ...art.tiles };
  if (image) tiles[terrain] = image;
  else delete tiles[terrain];
  return { ...art, tiles };
}

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
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
  return { ok: true, art: data as unknown as CustomArt };
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
