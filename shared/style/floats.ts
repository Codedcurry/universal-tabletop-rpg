/**
 * How the numbers floating over creatures look (damage, healing, a miss, a
 * condition, XP): the DM's choice for the whole table, from a preset or their
 * own mix of colours, size, lettering, and motion. Saved and sent with the
 * game's art.
 */

export type FloatKind = 'damage' | 'heal' | 'miss' | 'status' | 'xp';
export const FLOAT_KINDS: readonly FloatKind[] = ['damage', 'heal', 'miss', 'status', 'xp'];

export type FloatFont = 'bold' | 'serif' | 'pixel' | 'comic' | 'mono';
export const FLOAT_FONTS: readonly FloatFont[] = ['bold', 'serif', 'pixel', 'comic', 'mono'];

export type FloatMotion = 'rise' | 'pop' | 'bounce' | 'shake';
export const FLOAT_MOTIONS: readonly FloatMotion[] = ['rise', 'pop', 'bounce', 'shake'];

export interface FloatStyle {
  /** Which preset it started from ("custom" once changed). */
  readonly preset: string;
  /** A #rrggbb colour for each kind of number. */
  readonly colors: Readonly<Record<FloatKind, string>>;
  /** Size, as a share of the usual (0.6 to 2). */
  readonly size: number;
  readonly font: FloatFont;
  readonly motion: FloatMotion;
  /** A dark outline around the letters, to read over anything. */
  readonly outline: boolean;
}

export const FLOAT_PRESETS: Readonly<Record<string, FloatStyle>> = {
  classic: {
    preset: 'classic',
    colors: { damage: '#ff6b5b', heal: '#6fe08c', miss: '#d8d4e2', status: '#c99bff', xp: '#e0b44c' },
    size: 1,
    font: 'bold',
    motion: 'rise',
    outline: true,
  },
  comic: {
    preset: 'comic',
    colors: { damage: '#ffd23f', heal: '#7cff6b', miss: '#ffffff', status: '#ff7ad9', xp: '#5fd3ff' },
    size: 1.35,
    font: 'comic',
    motion: 'pop',
    outline: true,
  },
  pixel: {
    preset: 'pixel',
    colors: { damage: '#ff4d4d', heal: '#5dff7a', miss: '#c8c8c8', status: '#b98cff', xp: '#ffe066' },
    size: 1.1,
    font: 'pixel',
    motion: 'bounce',
    outline: true,
  },
  elegant: {
    preset: 'elegant',
    colors: { damage: '#e8a0a0', heal: '#a8e0b8', miss: '#e8e4f0', status: '#d0b8f0', xp: '#f0d898' },
    size: 0.9,
    font: 'serif',
    motion: 'rise',
    outline: false,
  },
  arcade: {
    preset: 'arcade',
    colors: { damage: '#ff2e63', heal: '#08f7a0', miss: '#eaeaea', status: '#a259ff', xp: '#fff200' },
    size: 1.2,
    font: 'mono',
    motion: 'shake',
    outline: true,
  },
};

export const DEFAULT_FLOAT_STYLE = FLOAT_PRESETS.classic as FloatStyle;

const COLOR = /^#[0-9a-fA-F]{6}$/;

/** What's wrong with a float style, if anything. */
export function floatStyleProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'is malformed';
  const style = value as Record<string, unknown>;
  if (typeof style.preset !== 'string' || style.preset.length > 20) return 'has an invalid preset';
  if (typeof style.colors !== 'object' || style.colors === null) return 'has no colours';
  for (const kind of FLOAT_KINDS) if (!COLOR.test(String((style.colors as Record<string, unknown>)[kind]))) return `has an invalid ${kind} colour`;
  if (typeof style.size !== 'number' || !(style.size >= 0.6 && style.size <= 2)) return 'has an invalid size';
  if (!FLOAT_FONTS.includes(style.font as FloatFont)) return 'has an unknown lettering';
  if (!FLOAT_MOTIONS.includes(style.motion as FloatMotion)) return 'has an unknown motion';
  if (typeof style.outline !== 'boolean') return 'must say whether it has an outline';
  return null;
}

/**
 * Where a floating number is and how it looks, `age` of the way through its
 * life (0 to 1): an offset in pixels (up is negative), a scale, and opacity.
 */
export function floatMotion(motion: FloatMotion, age: number): { dx: number; dy: number; scale: number; opacity: number } {
  const t = Math.min(1, Math.max(0, age));
  const opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  switch (motion) {
    case 'rise':
      return { dx: 0, dy: -50 * t, scale: 1, opacity };
    case 'pop':
      // Bursts big, settles, then drifts up.
      return { dx: 0, dy: -35 * t, scale: t < 0.15 ? 0.6 + (t / 0.15) * 1.0 : t < 0.3 ? 1.6 - ((t - 0.15) / 0.15) * 0.6 : 1, opacity };
    case 'bounce':
      // Hops up and lands twice, a little lower each time.
      return { dx: 0, dy: -30 * Math.abs(Math.sin(t * Math.PI * 2.5)) * (1 - t * 0.6) - 15 * t, scale: 1, opacity };
    case 'shake':
      // Shakes side to side at first, then rises.
      return { dx: t < 0.35 ? Math.sin(t * 90) * 6 * (1 - t / 0.35) : 0, dy: -45 * t, scale: 1, opacity };
  }
}

/** The kind of style a floating number takes ("level" numbers look like XP). */
export const floatKindOf = (kind: string): FloatKind => (kind === 'level' ? 'xp' : (FLOAT_KINDS as readonly string[]).includes(kind) ? (kind as FloatKind) : 'status');
