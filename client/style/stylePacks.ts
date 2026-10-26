import { type ObjectModel, type SolidLook, type StylePack, placeholderStyle } from './stylePack';

/**
 * The style packs the DM can draw the world in, for the whole table: the
 * usual look, and others made from it by recolouring everything (ground,
 * rocks, water, trees, objects, the sky behind) with one colour shift, so a
 * pack never misses something the usual look has.
 */

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const rgbToHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`;

/** Hue (0 to 360), saturation and lightness (0 to 1). */
function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const delta = max - min;
  const saturation = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return [hue * 60, saturation, light];
}

function fromHsl(hue: number, saturation: number, light: number): Rgb {
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const part = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const base = light - chroma / 2;
  const sector = Math.floor((((hue % 360) + 360) % 360) / 60);
  const [r, g, b] = [
    [chroma, part, 0],
    [part, chroma, 0],
    [0, chroma, part],
    [0, part, chroma],
    [part, 0, chroma],
    [chroma, 0, part],
  ][sector] as [number, number, number];
  return [(r + base) * 255, (g + base) * 255, (b + base) * 255];
}

/** Green things: leaves, grass, moss (what autumn and winter change most). */
const isGreen = (hue: number, saturation: number) => hue >= 70 && hue <= 170 && saturation > 0.15;

/** A colour shift: one colour in, its look in the pack out. */
export type ColorShift = (rgb: Rgb) => Rgb;

const SHIFTS: Readonly<Record<string, ColorShift>> = {
  // Torchlit stone: everything darker and colder, a little blue.
  dungeon: (rgb) => {
    const [hue, saturation, light] = toHsl(rgb);
    const [r, g, b] = fromHsl(hue, saturation * 0.45, light * 0.55);
    return [r * 0.92, g * 0.95, b * 1.1];
  },
  // Leaves turn orange and red, grass goes gold, the rest warms up.
  autumn: (rgb) => {
    const [hue, saturation, light] = toHsl(rgb);
    if (isGreen(hue, saturation)) return fromHsl(10 + ((hue - 70) / 100) * 35, Math.min(1, saturation * 1.15), light * 0.95);
    const [r, g, b] = rgb;
    return [r * 1.06, g * 1.0, b * 0.88];
  },
  // Snow on the green, the rest pale and cold.
  winter: (rgb) => {
    const [hue, saturation, light] = toHsl(rgb);
    if (isGreen(hue, saturation)) return fromHsl(205, 0.2, Math.min(0.92, 0.72 + light * 0.25));
    return fromHsl(hue, saturation * 0.55, Math.min(0.95, light * 0.9 + 0.12));
  },
};

const shiftHex = (shift: ColorShift, hex: string) => rgbToHex(shift(hexToRgb(hex)));

/** The usual look, every colour run through a shift. */
function shifted(id: string, name: string, shift: ColorShift, background: string): StylePack {
  const base = placeholderStyle;
  const recolor = (hex: string) => shiftHex(shift, hex);
  const model = (look: ObjectModel): ObjectModel => ({ ...look, parts: look.parts.map((part) => ({ ...part, color: part.glow ? part.color : recolor(part.color) })) });
  const solid = (look: SolidLook): SolidLook => ({ ...look, color: recolor(look.color) });
  return {
    ...base,
    id,
    name,
    background,
    terrain: Object.fromEntries(Object.entries(base.terrain).map(([terrain, look]) => [terrain, { color: recolor(look.color) }])),
    wallColor: recolor(base.wallColor),
    solid: Object.fromEntries(Object.entries(base.solid).map(([terrain, look]) => [terrain, solid(look)])),
    unknownSolid: solid(base.unknownSolid),
    objects: Object.fromEntries(Object.entries(base.objects).map(([id, look]) => [id, model(look)])),
    shift,
  };
}

export const STYLE_PACKS: readonly StylePack[] = [
  placeholderStyle,
  shifted('dungeon', 'Dungeon dark', SHIFTS.dungeon as ColorShift, '#07060b'),
  shifted('autumn', 'Autumn', SHIFTS.autumn as ColorShift, '#1c120c'),
  shifted('winter', 'Winter', SHIFTS.winter as ColorShift, '#1a2230'),
];

/** The pack with this id, or the usual look for none or one this version doesn't have. */
export function stylePackFor(id: string | null | undefined): StylePack {
  return STYLE_PACKS.find((pack) => pack.id === id) ?? placeholderStyle;
}

/** A colour as the pack draws it. */
export function packColor(pack: StylePack, rgb: Rgb): Rgb {
  return pack.shift ? pack.shift(rgb) : rgb;
}
