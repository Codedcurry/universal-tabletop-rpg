import type { Clip } from '../anim';
import { FRAME_GAP, assembleLayout } from './frames';
import type { Pixels, SheetLayout } from './sheet';

/**
 * One picture into a character: the background taken away, the picture
 * shrunk to pixel art (a set height, a limited palette, an optional dark
 * outline), and a still sheet made from it (front, and back if given), with
 * a gentle breathing idle; the procedural motions act out everything else.
 */

/** RGBA pixels that can be written to (what the converter makes). */
export interface Image {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

const blank = (width: number, height: number): Image => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

const alphaAt = (image: Pixels, x: number, y: number) => image.data[(y * image.width + x) * 4 + 3] ?? 0;

/**
 * Takes away the background: everything joined to the picture's edges that
 * is clear already, or within `tolerance` (0 to 255, per colour channel) of
 * the top-left corner's colour. The subject's own pixels of that colour stay
 * unless they touch the background.
 */
export function removeBackground(image: Pixels, tolerance: number): Image {
  const { width, height } = image;
  const data = new Uint8ClampedArray(image.data);
  const [r0, g0, b0] = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
  const isBackground = (at: number) =>
    (data[at * 4 + 3] ?? 0) === 0 ||
    (Math.abs((data[at * 4] ?? 0) - r0) <= tolerance && Math.abs((data[at * 4 + 1] ?? 0) - g0) <= tolerance && Math.abs((data[at * 4 + 2] ?? 0) - b0) <= tolerance);
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const visit = (x: number, y: number) => {
    const at = y * width + x;
    if (seen[at] || !isBackground(at)) return;
    seen[at] = 1;
    stack.push(at);
  };
  for (let x = 0; x < width; x++) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    visit(0, y);
    visit(width - 1, y);
  }
  while (stack.length > 0) {
    const at = stack.pop() as number;
    data[at * 4 + 3] = 0;
    const x = at % width;
    const y = Math.floor(at / width);
    if (x > 0) visit(x - 1, y);
    if (x < width - 1) visit(x + 1, y);
    if (y > 0) visit(x, y - 1);
    if (y < height - 1) visit(x, y + 1);
  }
  return { width, height, data };
}

/** The picture cut down to its drawn pixels (a 1x1 clear image if there are none). */
export function trim(image: Pixels): Image {
  let [x0, y0, x1, y1] = [image.width, image.height, -1, -1];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (alphaAt(image, x, y) === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return blank(1, 1);
  const out = blank(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = 0; y < out.height; y++) {
    const from = ((y + y0) * image.width + x0) * 4;
    out.data.set(image.data.subarray(from, from + out.width * 4), y * out.width * 4);
  }
  return out;
}

/** Shrinks to `height` pixels tall (never enlarges): each pixel the average of the ones it covers, drawn if mostly drawn. */
function shrink(image: Pixels, height: number): Image {
  const scale = Math.min(1, height / image.height);
  const out = blank(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  for (let y = 0; y < out.height; y++) {
    const sy0 = Math.floor((y * image.height) / out.height);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * image.height) / out.height));
    for (let x = 0; x < out.width; x++) {
      const sx0 = Math.floor((x * image.width) / out.width);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * image.width) / out.width));
      let [r, g, b, a, count] = [0, 0, 0, 0, 0];
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const at = (sy * image.width + sx) * 4;
          const alpha = (image.data[at + 3] ?? 0) / 255;
          r += (image.data[at] ?? 0) * alpha;
          g += (image.data[at + 1] ?? 0) * alpha;
          b += (image.data[at + 2] ?? 0) * alpha;
          a += alpha;
          count++;
        }
      }
      if (a / count < 0.5) continue;
      const at = (y * out.width + x) * 4;
      out.data.set([r / a, g / a, b / a, 255], at);
    }
  }
  return out;
}

type Color = readonly [number, number, number];

/** A palette of at most `count` colours for the drawn pixels (median cut: split the widest group of colours in half, again and again). */
export function palette(image: Pixels, count: number): Color[] {
  const colors: Color[] = [];
  for (let at = 0; at < image.data.length; at += 4) {
    if ((image.data[at + 3] ?? 0) > 0) colors.push([image.data[at] ?? 0, image.data[at + 1] ?? 0, image.data[at + 2] ?? 0]);
  }
  if (colors.length === 0) return [];
  const spread = (group: readonly Color[]) =>
    ([0, 1, 2] as const).map((channel) => {
      const values = group.map((color) => color[channel]);
      return { channel, range: Math.max(...values) - Math.min(...values) };
    });
  let groups: Color[][] = [colors];
  while (groups.length < count) {
    // The group with the widest spread of any channel, split at its median along that channel.
    const ranked = groups.map((group) => ({ group, widest: spread(group).sort((a, b) => b.range - a.range)[0]! }));
    const best = ranked.reduce((a, b) => (b.widest.range > a.widest.range ? b : a));
    if (best.widest.range === 0) break;
    const sorted = [...best.group].sort((a, b) => a[best.widest.channel] - b[best.widest.channel]);
    const half = Math.ceil(sorted.length / 2);
    groups = [...groups.filter((group) => group !== best.group), sorted.slice(0, half), sorted.slice(half)];
  }
  return groups.map((group) => {
    const sum = group.reduce((total, color) => [total[0] + color[0], total[1] + color[1], total[2] + color[2]] as const, [0, 0, 0] as const);
    return [Math.round(sum[0] / group.length), Math.round(sum[1] / group.length), Math.round(sum[2] / group.length)] as const;
  });
}

/** Every drawn pixel in the nearest palette colour. */
function quantize(image: Image, colors: readonly Color[]): Image {
  const data = new Uint8ClampedArray(image.data);
  for (let at = 0; at < data.length; at += 4) {
    if ((data[at + 3] ?? 0) === 0) continue;
    let best = colors[0]!;
    let distance = Infinity;
    for (const color of colors) {
      const d = ((data[at] ?? 0) - color[0]) ** 2 + ((data[at + 1] ?? 0) - color[1]) ** 2 + ((data[at + 2] ?? 0) - color[2]) ** 2;
      if (d < distance) [best, distance] = [color, d];
    }
    data.set(best, at);
  }
  return { ...image, data };
}

const OUTLINE: Color = [26, 20, 32];

/** A dark 1-pixel outline around the drawn pixels (the image grows by a pixel on each side). */
function outline(image: Image): Image {
  const out = blank(image.width + 2, image.height + 2);
  for (let y = 0; y < image.height; y++) out.data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + 1) * out.width + 1) * 4);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (alphaAt(out, x, y) > 0) continue;
      const touching = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx, ny]) => nx! >= 0 && ny! >= 0 && nx! < out.width && ny! < out.height && alphaAt(out, nx!, ny!) > 0 && !isOutline(out, nx!, ny!));
      if (touching) out.data.set([...OUTLINE, 255], (y * out.width + x) * 4);
    }
  }
  return out;
}

const isOutline = (image: Pixels, x: number, y: number) => {
  const at = (y * image.width + x) * 4;
  return image.data[at] === OUTLINE[0] && image.data[at + 1] === OUTLINE[1] && image.data[at + 2] === OUTLINE[2];
};

export interface PixelArtOptions {
  /** How tall the character is, in pixels. */
  readonly height: number;
  /** At most this many colours. */
  readonly colors: number;
  readonly outline: boolean;
}

/** A picture (background already taken away) as pixel art: trimmed, shrunk, in a limited palette, and outlined if asked. */
export function pixelArt(image: Pixels, options: PixelArtOptions): Image {
  const small = shrink(trim(image), options.height);
  const flat = quantize(small, palette(small, options.colors));
  return options.outline ? outline(flat) : flat;
}

/** The breath in: the top part of the body sinks by a pixel (what's above it clears). */
export function breathe(image: Pixels): Image {
  const out = blank(image.width, image.height);
  out.data.set(image.data);
  const chest = Math.floor(image.height * 0.6);
  for (let y = chest; y >= 1; y--) {
    out.data.set(image.data.subarray((y - 1) * image.width * 4, y * image.width * 4), y * image.width * 4);
  }
  out.data.fill(0, 0, image.width * 4);
  return out;
}

/** Idle plays slowly, like breathing. */
const BREATH_FPS = 3;

/**
 * A still character's sheet: idle from the front (and the back, if given),
 * two frames each (resting, and breathing in), feet at the bottom middle of
 * square frames. Left and right use the front; every other animation is the
 * procedural motion.
 */
export function stillSheet(front: Pixels, back?: Pixels): { image: Image; layout: SheetLayout } {
  const views = back ? [front, back] : [front];
  const tallest = Math.max(...views.map((view) => view.height));
  // With a gap between frames, so they can be found apart again (to edit the character).
  const size = Math.ceil((Math.max(tallest, ...views.map((view) => view.width)) + FRAME_GAP) / 4) * 4;
  const image = blank(size * 2, size * views.length);
  views.forEach((view, row) => {
    [view, breathe(view)].forEach((frame, column) => {
      const left = column * size + Math.floor((size - frame.width) / 2);
      const top = row * size + size - frame.height;
      for (let y = 0; y < frame.height; y++) image.data.set(frame.data.subarray(y * frame.width * 4, (y + 1) * frame.width * 4), ((top + y) * image.width + left) * 4);
    });
  });
  const counts = { idle: back ? { front: 2, back: 2 } : { front: 2 } };
  const fps: Partial<Record<Clip, number>> = { idle: BREATH_FPS };
  const layout = assembleLayout(counts, size, 'left', { columns: 2, ...(tallest < size ? { bodySize: tallest } : {}) });
  return { image, layout: { ...layout, fps } };
}
